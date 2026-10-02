// ==================== НАСТРОЙКИ ====================
const GRID_SIZE = 7;
const CELL_SIZE = 45;
const PADDING = 25;
const CANVAS_SIZE = PADDING + GRID_SIZE * CELL_SIZE + 5;
const COL_LABELS = ['А','Б','В','Г','Д','Е','Ж'];
const SHIPS_CONFIG = [3, 2, 2, 1, 1, 1];

// ⚠️ Замени на свою ссылку WebSocket-сервера на Render:
const WS_URL = 'wss://seabattle-server-XXXX.onrender.com';

// ==================== ЦВЕТА ====================
const COLORS = {
    bg:       '#0a1128',
    grid:     '#1a3a5c',
    water:    '#0d2137',
    ship:     '#2e7d32',
    shipHL:   '#4caf50',
    hit:      '#d32f2f',
    miss:     '#546e7a',
    hover:    'rgba(76,175,80,0.35)',
    hoverBad: 'rgba(255,50,50,0.3)',
    text:     '#90caf9',
    sunk:     '#b71c1c',
};

// ==================== СОСТОЯНИЕ ====================
let ws = null;
let myBoard = Array.from({length: GRID_SIZE}, () => Array(GRID_SIZE).fill(0));
let enemyBoard = Array.from({length: GRID_SIZE}, () => Array(GRID_SIZE).fill(0));
let myShips = [];
let placedShips = [];
let currentShipIndex = 0;
let isHorizontal = true;
let hoverCell = null;
let myTurn = false;
let gameId = null;
let playerNum = 0;

// ==================== ЭКРАНЫ ====================
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// ==================== CANVAS УТИЛИТЫ ====================
function getCanvas(id) {
    const c = document.getElementById(id);
    c.width = CANVAS_SIZE;
    c.height = CANVAS_SIZE;
    return c;
}

function cellFromMouse(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    const col = Math.floor((mx - PADDING) / CELL_SIZE);
    const row = Math.floor((my - PADDING) / CELL_SIZE);
    if (row >= 0 && row < GRID_SIZE && col >= 0 && col < GRID_SIZE) return {row, col};
    return null;
}

// ==================== ОТРИСОВКА ====================
function drawGrid(ctx, board, showShips, highlightCells, highlightOk) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Подписи
    ctx.fillStyle = COLORS.text;
    ctx.font = '13px Segoe UI';
    ctx.textAlign = 'center';
    for (let c = 0; c < GRID_SIZE; c++) {
        ctx.fillText(COL_LABELS[c], PADDING + c * CELL_SIZE + CELL_SIZE/2, PADDING - 7);
    }
    for (let r = 0; r < GRID_SIZE; r++) {
        ctx.fillText(r + 1, PADDING/2, PADDING + r * CELL_SIZE + CELL_SIZE/2 + 4);
    }

    for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
            const x = PADDING + c * CELL_SIZE;
            const y = PADDING + r * CELL_SIZE;
            const val = board[r][c];

            // Фон клетки
            if (val === 2) ctx.fillStyle = COLORS.hit;
            else if (val === 3) ctx.fillStyle = COLORS.miss;
            else if (val === 4) ctx.fillStyle = COLORS.sunk;
            else if (val === 1 && showShips) ctx.fillStyle = COLORS.ship;
            else ctx.fillStyle = COLORS.water;

            ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);

            // Иконки
            ctx.textAlign = 'center';
            ctx.font = '20px serif';
            if (val === 2) ctx.fillText('🔥', x + CELL_SIZE/2, y + CELL_SIZE/2 + 7);
            else if (val === 3) ctx.fillText('•', x + CELL_SIZE/2, y + CELL_SIZE/2 + 6);
            else if (val === 4) ctx.fillText('💥', x + CELL_SIZE/2, y + CELL_SIZE/2 + 7);

            // Сетка
            ctx.strokeStyle = COLORS.grid;
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
        }
    }

    // Подсветка при наведении
    if (highlightCells) {
        for (const {row: r, col: c} of highlightCells) {
            if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
                const x = PADDING + c * CELL_SIZE;
                const y = PADDING + r * CELL_SIZE;
                ctx.fillStyle = highlightOk ? COLORS.hover : COLORS.hoverBad;
                ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
            }
        }
    }
}

// ==================== РАССТАНОВКА КОРАБЛЕЙ ====================
function getShipCells(row, col, size, horiz) {
    const cells = [];
    for (let i = 0; i < size; i++) {
        cells.push({row: horiz ? row : row + i, col: horiz ? col + i : col});
    }
    return cells;
}

function canPlace(board, cells, placedList) {
    for (const {row: r, col: c} of cells) {
        if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) return false;
        if (board[r][c] !== 0) return false;
        // Проверка соседних клеток
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
                    if (board[nr][nc] === 1) {
                        // Проверяем, что это не наш же корабль
                        const isOwn = cells.some(x => x.row === nr && x.col === nc);
                        if (!isOwn) return false;
                    }
                }
            }
        }
    }
    return true;
}

function placeShipOnBoard(board, cells) {
    for (const {row: r, col: c} of cells) board[r][c] = 1;
}

function autoPlace() {
    const board = Array.from({length: GRID_SIZE}, () => Array(GRID_SIZE).fill(0));
    const ships = [];

    for (const size of SHIPS_CONFIG) {
        let placed = false;
        let attempts = 0;
        while (!placed && attempts < 200) {
            attempts++;
            const horiz = Math.random() > 0.5;
            const row = Math.floor(Math.random() * GRID_SIZE);
            const col = Math.floor(Math.random() * GRID_SIZE);
            const cells = getShipCells(row, col, size, horiz);
            if (canPlace(board, cells, ships)) {
                placeShipOnBoard(board, cells);
                ships.push(cells);
                placed = true;
            }
        }
        if (!placed) return autoPlace(); // Перезапуск, если не удалось
    }
    return {board, ships};
}

// ==================== SETUP ЭКРАН ====================
function initSetup() {
    showScreen('screen-setup');
    myBoard = Array.from({length: GRID_SIZE}, () => Array(GRID_SIZE).fill(0));
    placedShips = [];
    currentShipIndex = 0;
    isHorizontal = true;
    hoverCell = null;
    updateSetupInfo();

    const canvas = getCanvas('setup-canvas');
    const ctx = canvas.getContext('2d');
    drawGrid(ctx, myBoard, true, null, false);

    canvas.onmousemove = (e) => {
        const cell = cellFromMouse(canvas, e);
        hoverCell = cell;
        renderSetup();
    };
    canvas.onmouseleave = () => { hoverCell = null; renderSetup(); };

    canvas.onclick = (e) => {
        const cell = cellFromMouse(canvas, e);
        if (!cell || currentShipIndex >= SHIPS_CONFIG.length) return;

        const size = SHIPS_CONFIG[currentShipIndex];
        const cells = getShipCells(cell.row, cell.col, size, isHorizontal);
        if (canPlace(myBoard, cells, placedShips)) {
            placeShipOnBoard(myBoard, cells);
            placedShips.push(cells);
            currentShipIndex++;
            updateSetupInfo();
            renderSetup();
        }
    };

    // Обработка тач-событий для мобильных
    canvas.ontouchend = (e) => {
        e.preventDefault();
        const touch = e.changedTouches[0];
        const cell = cellFromMouse(canvas, touch);
        if (!cell || currentShipIndex >= SHIPS_CONFIG.length) return;

        const size = SHIPS_CONFIG[currentShipIndex];
        const cells = getShipCells(cell.row, cell.col, size, isHorizontal);
        if (canPlace(myBoard, cells, placedShips)) {
            placeShipOnBoard(myBoard, cells);
            placedShips.push(cells);
            currentShipIndex++;
            updateSetupInfo();
            renderSetup();
        }
    };

    document.getElementById('btn-rotate').onclick = () => {
        isHorizontal = !isHorizontal;
        renderSetup();
    };

    document.getElementById('btn-auto-place').onclick = () => {
        const result = autoPlace();
        myBoard = result.board;
        placedShips = result.ships;
        currentShipIndex = SHIPS_CONFIG.length;
        myShips = result.ships;
        updateSetupInfo();
        renderSetup();
    };

    document.getElementById('btn-ready').onclick = () => {
        myShips = placedShips;
        const flat = myBoard.map(r => r.slice());
        ws.send(JSON.stringify({type: 'ready', board: flat}));
        document.getElementById('setup-instruction').textContent = '⏳ Ожидаем готовности соперника...';
        document.getElementById('btn-ready').disabled = true;
        document.getElementById('btn-auto-place').disabled = true;
        document.getElementById('btn-rotate').disabled = true;
    };
}

function updateSetupInfo() {
    const info = document.getElementById('setup-ship-info');
    const btn = document.getElementById('btn-ready');

    if (currentShipIndex < SHIPS_CONFIG.length) {
        const size = SHIPS_CONFIG[currentShipIndex];
        const names = {1: 'Однопалубный', 2: 'Двухпалубный', 3: 'Трёхпалубный'};
        info.textContent = `Поставьте: ${names[size]} (${size} клетки) — корабль ${currentShipIndex + 1} из ${SHIPS_CONFIG.length}`;
        btn.disabled = true;
    } else {
        info.textContent = '✅ Все корабли расставлены!';
        btn.disabled = false;
    }
}

function renderSetup() {
    const canvas = document.getElementById('setup-canvas');
    const ctx = canvas.getContext('2d');

    let highlight = null;
    let ok = false;

    if (hoverCell && currentShipIndex < SHIPS_CONFIG.length) {
        const size = SHIPS_CONFIG[currentShipIndex];
        const cells = getShipCells(hoverCell.row, hoverCell.col, size, isHorizontal);
        ok = canPlace(myBoard, cells, placedShips);
        highlight = cells;
    }

    drawGrid(ctx, myBoard, true, highlight, ok);
}

// ==================== BATTLE ЭКРАН ====================
function initBattle() {
    showScreen('screen-battle');
    enemyBoard = Array.from({length: GRID_SIZE}, () => Array(GRID_SIZE).fill(0));
    renderBattle();

    const eCanvas = getCanvas('enemy-canvas');

    eCanvas.onclick = (e) => {
        if (!myTurn) return;
        const cell = cellFromMouse(eCanvas, e);
        if (!cell) return;
        if (enemyBoard[cell.row][cell.col] !== 0) return;

        ws.send(JSON.stringify({type: 'shoot', row: cell.row, col: cell.col}));
        myTurn = false;
        updateBattleStatus();
    };

    eCanvas.ontouchend = (e) => {
        e.preventDefault();
        if (!myTurn) return;
        const touch = e.changedTouches[0];
        const cell = cellFromMouse(eCanvas, touch);
        if (!cell) return;
        if (enemyBoard[cell.row][cell.col] !== 0) return;

        ws.send(JSON.stringify({type: 'shoot', row: cell.row, col: cell.col}));
        myTurn = false;
        updateBattleStatus();
    };

    getCanvas('own-canvas');
}

function renderBattle() {
    const eCtx = document.getElementById('enemy-canvas').getContext('2d');
    const oCtx = document.getElementById('own-canvas').getContext('2d');
    drawGrid(eCtx, enemyBoard, false, null, false);
    drawGrid(oCtx, myBoard, true, null, false);
}

function updateBattleStatus() {
    const el = document.getElementById('battle-status');
    if (myTurn) {
        el.textContent = '🎯 Ваш ход! Выберите клетку на поле противника.';
        el.style.background = 'rgba(46,125,50,0.3)';
    } else {
        el.textContent = '⏳ Ход соперника...';
        el.style.background = 'rgba(255,255,255,0.1)';
    }
}

function animateCell(canvasId, row, col) {
    const canvas = document.getElementById(canvasId);
    canvas.classList.remove('shake', 'explode');
    void canvas.offsetWidth;
    canvas.classList.add('explode');
    setTimeout(() => canvas.classList.remove('explode'), 400);
}

// ==================== ВЕБСОКЕТ ====================
function connectWS() {
    const status = document.getElementById('lobby-status');
    status.textContent = 'Подключение к серверу...';

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        status.textContent = '✅ Подключено! Нажмите кнопку для поиска.';
        document.getElementById('btn-find-game').disabled = false;
    };

    ws.onclose = () => {
        status.textContent = '❌ Соединение потеряно. Обновите страницу.';
        document.getElementById('btn-find-game').disabled = true;
    };

    ws.onerror = () => {
        status.textContent = '❌ Ошибка соединения.';
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleMessage(data);
    };
}

function handleMessage(data) {
    switch(data.type) {
        case 'waiting':
            document.getElementById('lobby-info').textContent = '⏳ Ищем соперника...';
            break;

        case 'game_start':
            gameId = data.gameId;
            playerNum = data.player;
            document.getElementById('lobby-info').textContent = '';
            initSetup();
            break;

        case 'both_ready':
            myTurn = data.first === playerNum;
            initBattle();
            updateBattleStatus();
            break;

        case 'shot_result':
            if (data.shooter === playerNum) {
                // Мой выстрел — обновляю доску врага
                if (data.result === 'miss') enemyBoard[data.row][data.col] = 3;
                else if (data.result === 'hit') enemyBoard[data.row][data.col] = 2;
                else if (data.result === 'kill') {
                    for (const {row: r, col: c} of data.sunkCells) enemyBoard[r][c] = 4;
                }
                animateCell('enemy-canvas', data.row, data.col);
            } else {
                // Выстрел соперника по мне
                if (data.result === 'miss') myBoard[data.row][data.col] = 3;
                else if (data.result === 'hit') myBoard[data.row][data.col] = 2;
                else if (data.result === 'kill') {
                    for (const {row: r, col: c} of data.sunkCells) myBoard[r][c] = 4;
                }
                animateCell('own-canvas', data.row, data.col);
            }

            // Чей ход следующий
            myTurn = data.nextTurn === playerNum;
            renderBattle();
            updateBattleStatus();
            break;

        case 'game_over':
            showScreen('screen-result');
            const isWinner = data.winner === playerNum;
            document.getElementById('result-title').textContent = isWinner ? '🏆 Победа!' : '😢 Поражение';
            document.getElementById('result-text').textContent = isWinner
                ? 'Все корабли противника потоплены!'
                : 'Ваш флот потоплен... В следующий раз повезёт!';
            break;

        case 'opponent_disconnected':
            showScreen('screen-result');
            document.getElementById('result-title').textContent = '🏃 Соперник сбежал!';
            document.getElementById('result-text').textContent = 'Победа присуждается вам.';
            break;
    }
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
document.getElementById('btn-find-game').onclick = () => {
    ws.send(JSON.stringify({type: 'find_game'}));
    document.getElementById('btn-find-game').disabled = true;
};

document.getElementById('btn-play-again').onclick = () => {
    showScreen('screen-lobby');
    document.getElementById('btn-find-game').disabled = false;
    document.getElementById('lobby-info').textContent = '';
};

connectWS();
