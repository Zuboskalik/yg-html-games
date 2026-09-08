// Localization
const locales = {
    ru: {
        title: "Water Sort",
        desc: "Сортируй разноцветную жидкость по пробиркам!",
        play: "Играть",
        level: "Уровень ",
        moves: "Ходы: ",
        undo: "Отмена",
        addTube: "Колба",
        revealHidden: "Открыть",
        unlockTube: "Разблок.",
        winTitle: "🎉 Уровень пройден!",
        winDesc: "Отличная работа! Все цвета аккуратно отсортированы.",
        nextLevel: "Следующий уровень",
        failTitle: "💥 Ходы закончились!",
        failDesc: "Время бомбы истекло. Хотите продолжить или начать заново?",
        reviveBtn: "🎁 До +15 ходов (Реклама)",
        restart: "Заново"
    },
    en: {
        title: "Water Sort",
        desc: "Sort the colored liquids into separate tubes!",
        play: "Play",
        level: "Level ",
        moves: "Moves: ",
        undo: "Undo",
        addTube: "Tube",
        revealHidden: "Reveal",
        unlockTube: "Unlock",
        winTitle: "🎉 Level Complete!",
        winDesc: "Great job! All colors are perfectly sorted.",
        nextLevel: "Next Level",
        failTitle: "💥 Out of Moves!",
        failDesc: "Bomb timer expired. Watch ad to get +15 moves or restart?",
        reviveBtn: "🎁 +15 Moves (Watch Ad)",
        restart: "Restart"
    }
};

let currentLang = 'ru';
let yandexSDK = null;
let player = null;
let currentLevelIndex = 0;
let movesCount = 0;
let isPaused = false;

// Game state
let tubes = []; // Array of tubes, each tube is { colors: [...], hiddenCount: N }
let history = []; // Stack of previous states for Undo
let selectedTubeIndex = null;
let animating = false;
let pouringData = null;

let tubeLocks = []; // boolean array
let moveLimit = null; // null or remaining moves

// Properly store original hidden colors during generation
let hiddenColorMap = new Map(); // tubeIndex -> array of hidden colors

// Colors palette
const COLORS = [
    '#FF3366', '#33CCFF', '#33FF66', '#FFCC00',
    '#9933FF', '#FF6600', '#00FFCC', '#FF99FF',
    '#6666FF', '#CCFF33'
];

// DOM Elements
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const mainMenu = document.getElementById('main-menu');
const victoryModal = document.getElementById('victory-modal');
const defeatModal = document.getElementById('defeat-modal');
const startBtn = document.getElementById('start-btn');
const nextLevelBtn = document.getElementById('next-level-btn');
const undoBtn = document.getElementById('undo-btn');
const addTubeBtn = document.getElementById('add-tube-btn');
const revealHiddenBtn = document.getElementById('reveal-hidden-btn');
const unlockTubeBtn = document.getElementById('unlock-tube-btn');
const reviveBtn = document.getElementById('revive-btn');
const restartLevelBtn = document.getElementById('restart-level-btn');
const levelTitle = document.getElementById('level-title');
const movesCountDisplay = document.getElementById('moves-count');
const movesLimitDisplay = document.getElementById('moves-limit-display');
const menuDesc = document.getElementById('menu-desc');
const currentLevelPreview = document.getElementById('current-level-preview');
const txtUndo = document.getElementById('txt-undo');
const txtAddTube = document.getElementById('txt-add-tube');
const txtRevealHidden = document.getElementById('txt-reveal-hidden');
const txtUnlockTube = document.getElementById('txt-unlock-tube');
const levelSelectContainer = document.getElementById('level-select');
const menuLevelSelectContainer = document.getElementById('menu-level-select');

// Quick-jump level buttons. Today (before a real progress system exists) every
// milestone is always selectable for testing; once player progress is persisted,
// gate each button on `milestone <= highestUnlockedLevel` instead of always-enabled.
const LEVEL_MILESTONES = [1, 5, 10, 15, 20, 25, 30];

function renderLevelSelectButtons(container, onSelect) {
    container.innerHTML = '';
    for (const milestone of LEVEL_MILESTONES) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'level-select-btn';
        btn.textContent = milestone;
        btn.addEventListener('click', () => onSelect(milestone));
        container.appendChild(btn);
    }
}

// In-game HUD: jumping to a milestone starts it immediately.
renderLevelSelectButtons(levelSelectContainer, (milestone) => {
    currentLevelIndex = milestone - 1;
    startLevel();
});

// Main menu: picking a milestone just selects it — the player still presses "Играть".
renderLevelSelectButtons(menuLevelSelectContainer, (milestone) => {
    currentLevelIndex = milestone - 1;
    updateUILanguage();
});

function updateLevelSelectHighlight() {
    document.querySelectorAll('.level-select-btn').forEach(btn => {
        btn.classList.toggle('current', Number(btn.textContent) === currentLevelIndex + 1);
    });
}

// Tube skin (transparent glass overlay drawn on top of the liquid layers).
// Swappable for future skins (flask/glass/bottle/etc. in images/water2.png..water5.png).
const tubeSkin = new Image();
let tubeSkinReady = false;
const tubeSkinLoaded = new Promise(resolve => {
    tubeSkin.onload = () => { tubeSkinReady = true; resolve(); };
    tubeSkin.onerror = () => resolve();
});
tubeSkin.src = 'images/water1.png';

// Interior liquid channel of images/water1.png, measured as fractions of its full
// bounding box: the glass walls take up roughly a quarter of the width on each side,
// and the straight part of the tube ends about 85% down before the rounded bottom tip.
const TUBE_LIQUID_MARGIN_X = 0.263;
const TUBE_LIQUID_TOP = 0.075;
const TUBE_LIQUID_BOTTOM = 0.94;

document.addEventListener('contextmenu', e => e.preventDefault());

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Pause/resume on tab focus loss (platform events + browser fallback)
function pauseGame() {
    isPaused = true;
}
function resumeGame() {
    isPaused = false;
}
document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseGame();
    else resumeGame();
});
window.addEventListener('blur', pauseGame);
window.addEventListener('focus', resumeGame);

// SDK Initialization
document.addEventListener('DOMContentLoaded', () => {
    if (typeof YaGames !== 'undefined') {
        YaGames.init().then(ysdk => {
            yandexSDK = ysdk;
            currentLang = ysdk.environment.i18n?.lang?.startsWith('en') ? 'en' : 'ru';
            updateUILanguage();

            ysdk.on('game_api_pause', pauseGame);
            ysdk.on('game_api_resume', resumeGame);

            ysdk.getPlayer().then(_player => {
                player = _player;
                loadProgress();
            }).catch(err => console.log('Offline player', err));

            tubeSkinLoaded.then(() => {
                ysdk.features.LoadingAPI?.ready();
            });
        }).catch(err => {
            console.warn('SDK Init error', err);
            updateUILanguage();
        });
    } else {
        updateUILanguage();
    }
});

function updateUILanguage() {
    const loc = locales[currentLang] || locales.ru;
    const menuTitleEl = document.getElementById('menu-title');
    if (menuTitleEl) menuTitleEl.textContent = loc.title;
    if (menuDesc) menuDesc.textContent = loc.desc;
    if (startBtn) startBtn.textContent = loc.play;
    if (nextLevelBtn) nextLevelBtn.textContent = loc.nextLevel;
    if (txtUndo) txtUndo.textContent = loc.undo;
    if (txtAddTube) txtAddTube.textContent = loc.addTube;
    if (txtRevealHidden) txtRevealHidden.textContent = loc.revealHidden;
    if (txtUnlockTube) txtUnlockTube.textContent = loc.unlockTube;
    if (currentLevelPreview) currentLevelPreview.textContent = loc.level + (currentLevelIndex + 1);
    if (levelTitle) levelTitle.textContent = loc.level + (currentLevelIndex + 1);
    if (movesCountDisplay) movesCountDisplay.textContent = `🔄 ${movesCount}`;

    if (moveLimit !== null) {
        movesLimitDisplay.classList.remove('hidden');
        movesLimitDisplay.textContent = `💣 ${moveLimit}`;
    } else {
        movesLimitDisplay.classList.add('hidden');
    }

    updateActionButtonsVisibility();
    updateLevelSelectHighlight();
}

// Show the reveal/unlock ad-buttons only while their mechanic is actually present on screen
function anyHiddenLayersPresent() {
    return tubes.some(tube => tube.includes(-1));
}

function anyLockedTubesPresent() {
    return tubeLocks.some(locked => locked);
}

function updateActionButtonsVisibility() {
    revealHiddenBtn.classList.toggle('hidden', !anyHiddenLayersPresent());
    unlockTubeBtn.classList.toggle('hidden', !anyLockedTubesPresent());
}

async function loadProgress() {
    if (!player) return;
    try {
        const data = await player.getData();
        if (data && typeof data.level === 'number') {
            currentLevelIndex = data.level;
            updateUILanguage();
        }
    } catch (e) {
        console.error('Failed to load progress', e);
    }
}

async function saveProgress() {
    if (!player) return;
    try {
        if (typeof player.setData === 'function') {
            await player.setData({ level: currentLevelIndex }, true);
        }
    } catch (e) {
        console.error('Failed to save progress', e);
    }
}

// Level Generator with Level 3+ Hidden Layers and Level 7+ Locks & Level 10+ Bombs
function generateLevel(levelIdx) {
    const capacity = 4;
    let numColors = Math.min(3 + Math.floor(levelIdx / 3), COLORS.length);
    let numEmpty = 2;

    let colorPool = [];
    for (let c = 0; c < numColors; c++) {
        for (let i = 0; i < capacity; i++) {
            colorPool.push(c);
        }
    }
    // Fisher-Yates shuffle
    for (let i = colorPool.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [colorPool[i], colorPool[j]] = [colorPool[j], colorPool[i]];
    }

    let currentTubes = [];
    hiddenColorMap.clear();

    for (let c = 0; c < numColors; c++) {
        let tubeColors = colorPool.slice(c * capacity, (c + 1) * capacity);

        // From level 3+, introduce "Hidden" mystery layers (bottom 2 layers)
        if (levelIdx >= 2 && c % 2 === 0) {
            hiddenColorMap.set(c, [tubeColors[0], tubeColors[1]]);
            tubeColors[0] = -1;
            tubeColors[1] = -1;
        }

        currentTubes.push(tubeColors);
    }
    for (let i = 0; i < numEmpty; i++) {
        currentTubes.push([]);
    }

    // Tube locks setup for Level 7+
    tubeLocks = new Array(currentTubes.length).fill(false);
    if (levelIdx >= 6) {
        let lockTarget = Math.floor(Math.random() * numColors);
        tubeLocks[lockTarget] = true;
    }

    // Move limits setup for Level 10+
    if (levelIdx >= 9) {
        moveLimit = 30 + Math.max(0, (15 - levelIdx) * 2);
    } else {
        moveLimit = null;
    }

    return currentTubes;
}

function startLevel() {
    tubes = generateLevel(currentLevelIndex);
    history = [];
    selectedTubeIndex = null;
    animating = false;
    pouringData = null;
    movesCount = 0;
    updateUILanguage();
    mainMenu.classList.add('hidden');
    victoryModal.classList.add('hidden');
    defeatModal.classList.add('hidden');
}

// Check if level is solved
function isLevelSolved(currentTubes) {
    let activeTubesCount = 0;
    for (let tube of currentTubes) {
        if (tube.length === 0) continue;
        if (tube.length !== 4) return false;
        let firstColor = tube[0];
        if (firstColor === -1) return false; // Mystery layer still present
        for (let color of tube) {
            if (color !== firstColor) return false;
        }
        activeTubesCount++;
    }
    return activeTubesCount > 0;
}

function canPour(fromIdx, toIdx) {
    if (fromIdx === toIdx) return false;
    if (tubeLocks[fromIdx] || tubeLocks[toIdx]) return false;

    let fromTube = tubes[fromIdx];
    let toTube = tubes[toIdx];
    if (fromTube.length === 0) return false;
    if (toTube.length >= 4) return false;

    let topColor = fromTube[fromTube.length - 1];
    if (topColor === -1) return false; // Cannot pour mystery layer until revealed

    if (toTube.length === 0) return true;
    let targetTopColor = toTube[toTube.length - 1];
    return topColor === targetTopColor;
}

function snapshotState() {
    return {
        tubes: tubes.map(t => [...t]),
        locks: [...tubeLocks],
        moves: movesCount,
        limit: moveLimit
    };
}

// Runs `onDone` after a rewarded ad completes (or immediately offline/on error) — rewards
// are still granted on error/no-fill so play isn't blocked by ad availability.
function showRewardedThen(onDone) {
    if (yandexSDK) {
        yandexSDK.adv.showRewardedVideo({
            callbacks: {
                onRewarded: onDone,
                onError: onDone
            }
        });
    } else {
        onDone();
    }
}

function executePour(fromIdx, toIdx) {
    history.push(snapshotState());

    let fromTube = tubes[fromIdx];
    let toTube = tubes[toIdx];
    let topColor = fromTube[fromTube.length - 1];

    let count = 0;
    for (let i = fromTube.length - 1; i >= 0; i--) {
        if (fromTube[i] === topColor && toTube.length + count < 4) {
            count++;
        } else {
            break;
        }
    }

    animating = true;
    pouringData = {
        fromIdx,
        toIdx,
        color: topColor,
        count,
        progress: 0
    };

    let movingBlock = [];
    for (let i = 0; i < count; i++) {
        movingBlock.push(fromTube.pop());
    }
    pouringData.movingBlock = movingBlock;

    movesCount++;
    if (moveLimit !== null) {
        moveLimit--;
        if (moveLimit <= 0 && !isLevelSolved(tubes)) {
            triggerDefeat();
        }
    }
    updateUILanguage();
}

// Undo action
undoBtn.addEventListener('click', () => {
    if (animating || history.length === 0) return;

    showRewardedThen(() => {
        let prevState = history.pop();
        tubes = prevState.tubes;
        tubeLocks = prevState.locks;
        movesCount = prevState.moves;
        moveLimit = prevState.limit;
        selectedTubeIndex = null;
        updateUILanguage();
    });
});

// Add Empty Tube via Ad
addTubeBtn.addEventListener('click', () => {
    if (animating) return;

    showRewardedThen(() => {
        history.push(snapshotState());
        tubes.push([]);
        tubeLocks.push(false);
        selectedTubeIndex = null;
        updateUILanguage();
    });
});

// Reveal all hidden mystery layers via Ad
revealHiddenBtn.addEventListener('click', () => {
    if (animating || !anyHiddenLayersPresent()) return;

    showRewardedThen(() => {
        history.push(snapshotState());
        for (let [tIdx, hidden] of hiddenColorMap.entries()) {
            let tube = tubes[tIdx];
            for (let i = 0; i < tube.length; i++) {
                if (tube[i] === -1) tube[i] = hidden[i];
            }
        }
        hiddenColorMap.clear();
        selectedTubeIndex = null;
        updateUILanguage();
    });
});

// Unlock all locked tubes via Ad
unlockTubeBtn.addEventListener('click', () => {
    if (animating || !anyLockedTubesPresent()) return;

    showRewardedThen(() => {
        history.push(snapshotState());
        tubeLocks = tubeLocks.map(() => false);
        selectedTubeIndex = null;
        updateUILanguage();
    });
});

reviveBtn.addEventListener('click', () => {
    showRewardedThen(() => {
        moveLimit = 15;
        defeatModal.classList.add('hidden');
        updateUILanguage();
    });
});

restartLevelBtn.addEventListener('click', () => {
    startLevel();
});

canvas.addEventListener('pointerdown', (e) => {
    if (isPaused || animating || !mainMenu.classList.contains('hidden') || !victoryModal.classList.contains('hidden') || !defeatModal.classList.contains('hidden')) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const layout = getTubeLayout();
    for (let i = 0; i < tubes.length; i++) {
        let pos = layout.tubesPos[i];
        if (x >= pos.x - layout.tubeWidth / 2 && x <= pos.x + layout.tubeWidth / 2 &&
            y >= pos.y && y <= pos.y + layout.tubeHeight) {

            // If tube is locked, clicking it attempts to unlock via ad / key
            if (tubeLocks[i]) {
                showRewardedThen(() => { tubeLocks[i] = false; updateUILanguage(); });
                return;
            }

            if (selectedTubeIndex === null) {
                if (tubes[i].length > 0 && tubes[i][tubes[i].length - 1] !== -1) {
                    selectedTubeIndex = i;
                }
            } else {
                if (selectedTubeIndex === i) {
                    selectedTubeIndex = null;
                } else {
                    if (canPour(selectedTubeIndex, i)) {
                        let from = selectedTubeIndex;
                        let to = i;
                        selectedTubeIndex = null;
                        executePour(from, to);
                    } else {
                        selectedTubeIndex = (tubes[i].length > 0 && tubes[i][tubes[i].length - 1] !== -1) ? i : null;
                    }
                }
            }
            break;
        }
    }
});

function getTubeLayout() {
    const numTubes = tubes.length;
    const maxPerRow = numTubes > 6 ? Math.ceil(numTubes / 2) : numTubes;
    const rows = numTubes > 6 ? 2 : 1;

    const tubeWidth = Math.min(canvas.width / (maxPerRow + 1) * 0.6, 70);
    const tubeHeight = tubeWidth * 3.2;
    const spacingX = tubeWidth * 1.4;
    const spacingY = tubeHeight * 1.3;

    let tubesPos = [];
    for (let i = 0; i < numTubes; i++) {
        let row = Math.floor(i / maxPerRow);
        let col = i % maxPerRow;
        let countInRow = row === rows - 1 ? numTubes - row * maxPerRow : maxPerRow;
        let rowStartX = (canvas.width - (countInRow * spacingX)) / 2 + tubeWidth / 2;

        tubesPos.push({
            x: rowStartX + col * spacingX,
            y: (canvas.height - (rows * spacingY)) / 2 + tubeHeight * 0.2 + row * spacingY
        });
    }

    return { tubesPos, tubeWidth, tubeHeight };
}

// A tube is "complete" once fully filled with a single revealed color
function isTubeComplete(tube) {
    if (tube.length !== 4) return false;
    let firstColor = tube[0];
    if (firstColor === -1) return false;
    return tube.every(color => color === firstColor);
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const layout = getTubeLayout();
    const { tubesPos, tubeWidth, tubeHeight } = layout;
    const wallWidth = Math.max(4, tubeWidth * 0.08);
    const radius = wallWidth * 1.5;
    const elapsed = performance.now();

    for (let i = 0; i < tubes.length; i++) {
        let pos = tubesPos[i];
        let isSelected = (selectedTubeIndex === i);
        let tubeData = tubes[i];
        let isComplete = isTubeComplete(tubeData);
        let bounceY = isSelected ? -15 : (isComplete ? Math.sin(elapsed / 250 + i) * 4 : 0);

        ctx.save();
        ctx.translate(pos.x, pos.y + bounceY);

        // Liquid is confined to the transparent channel inside the tube skin artwork,
        // not the full bounding box, so it reads as being inside the glass, not under it.
        let innerWidth = tubeWidth * (1 - TUBE_LIQUID_MARGIN_X * 2);
        let liquidTop = tubeHeight * TUBE_LIQUID_TOP;
        let liquidBottom = tubeHeight * TUBE_LIQUID_BOTTOM;
        let innerHeight = liquidBottom - liquidTop;
        let layerHeight = innerHeight / 4;
        let liquidRadius = Math.min(innerWidth / 2, innerHeight * 0.25);

        ctx.save();
        ctx.beginPath();
        ctx.roundRect(-innerWidth / 2, liquidTop, innerWidth, innerHeight, [0, 0, liquidRadius, liquidRadius]);
        ctx.clip();

        for (let layerIdx = 0; layerIdx < tubeData.length; layerIdx++) {
            let colorIdx = tubeData[layerIdx];
            let yPos = liquidBottom - (layerIdx + 1) * layerHeight;

            if (colorIdx === -1) {
                ctx.fillStyle = '#e0e0e0';
                ctx.fillRect(-innerWidth / 2, yPos, innerWidth, layerHeight + 1);

                ctx.fillStyle = '#555';
                ctx.font = 'bold 16px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('?', 0, yPos + layerHeight / 2);
            } else {
                ctx.fillStyle = COLORS[colorIdx] || '#fff';
                ctx.fillRect(-innerWidth / 2, yPos, innerWidth, layerHeight + 1);
            }
        }
        ctx.restore();

        // Draw tube skin (transparent glass PNG) on top of the poured liquid
        if (tubeSkinReady) {
            ctx.save();
            if (isSelected) {
                ctx.shadowColor = '#00ffcc';
                ctx.shadowBlur = 16;
            } else if (isComplete) {
                ctx.shadowColor = COLORS[tubeData[0]] || '#fff';
                ctx.shadowBlur = 12;
            }
            ctx.drawImage(tubeSkin, -tubeWidth / 2, 0, tubeWidth, tubeHeight);
            ctx.restore();
        } else {
            // Fallback outline while the skin image hasn't loaded yet
            ctx.strokeStyle = isSelected ? '#00ffcc' : 'rgba(255, 255, 255, 0.6)';
            ctx.lineWidth = wallWidth;
            ctx.beginPath();
            ctx.moveTo(-tubeWidth / 2, 0);
            ctx.lineTo(-tubeWidth / 2, tubeHeight - radius);
            ctx.arcTo(-tubeWidth / 2, tubeHeight, -tubeWidth / 2 + radius, tubeHeight, radius);
            ctx.lineTo(tubeWidth / 2 - radius, tubeHeight);
            ctx.arcTo(tubeWidth / 2, tubeHeight, tubeWidth / 2, tubeHeight - radius, radius);
            ctx.lineTo(tubeWidth / 2, 0);
            ctx.stroke();
        }

        // Draw Lock if tube is locked
        if (tubeLocks[i]) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(-tubeWidth / 2, tubeHeight / 2 - 20, tubeWidth, 40);
            ctx.fillStyle = '#FFD700';
            ctx.font = '20px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🔒', 0, tubeHeight / 2);
        }

        ctx.restore();
    }

    if (animating && pouringData) {
        updateAndDrawPouring(layout);
    }
}

function updateAndDrawPouring(layout) {
    const { tubesPos, tubeWidth, tubeHeight } = layout;
    let fromPos = tubesPos[pouringData.fromIdx];
    let toPos = tubesPos[pouringData.toIdx];

    if (!isPaused) {
        pouringData.progress += 0.08;
    }
    if (pouringData.progress >= 1) {
        let toTube = tubes[pouringData.toIdx];
        for (let color of pouringData.movingBlock) {
            toTube.push(color);
        }

        // Check if any hidden layers are now exposed
        checkAndRevealHiddenLayers();

        animating = false;
        pouringData = null;

        if (isLevelSolved(tubes)) {
            triggerVictory();
        }
    } else {
        let p = pouringData.progress;
        let startX = fromPos.x;
        let startY = fromPos.y + tubeHeight * 0.1;
        let endX = toPos.x;
        let endY = toPos.y + tubeHeight * 0.1;

        let currX = startX + (endX - startX) * p;
        let currY = startY + (endY - startY) * p - Math.sin(p * Math.PI) * 40;

        ctx.fillStyle = COLORS[pouringData.color];
        ctx.beginPath();
        ctx.arc(currX, currY, tubeWidth * 0.3, 0, Math.PI * 2);
        ctx.fill();
    }
}

// Reveal hidden layers automatically when top layers are poured out
function checkAndRevealHiddenLayers() {
    for (let tIdx = 0; tIdx < tubes.length; tIdx++) {
        if (hiddenColorMap.has(tIdx)) {
            let tube = tubes[tIdx];
            let hidden = hiddenColorMap.get(tIdx);
            // If bottom layer 1 is -1 and index 1 is now top (length === 2) or empty
            if (tube.length === 2 && tube[1] === -1) {
                tube[1] = hidden[1];
            }
            if (tube.length === 1 && tube[0] === -1) {
                tube[0] = hidden[0];
            }
        }
    }
}

function triggerVictory() {
    victoryModal.classList.remove('hidden');
    if (yandexSDK) {
        yandexSDK.adv.showFullscreenAdv({
            callbacks: { onClose: () => {}, onError: () => {} }
        });
    }
}

function triggerDefeat() {
    defeatModal.classList.remove('hidden');
}

nextLevelBtn.addEventListener('click', () => {
    currentLevelIndex++;
    saveProgress();
    startLevel();
});

startBtn.addEventListener('click', () => {
    startLevel();
});

function gameLoop() {
    draw();
    requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);
