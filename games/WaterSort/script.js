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
        restart: "Заново",
        lockHintSingular: "Заполните полностью ещё {n} колбу, чтобы снять замок",
        lockHintPlural: "Заполните полностью ещё {n} колбы, чтобы снять замок",
        lockUnlockedToast: "🔓 Замок снят!"
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
        restart: "Restart",
        lockHintSingular: "Fully sort {n} more tube to release the lock",
        lockHintPlural: "Fully sort {n} more tubes to release the lock",
        lockUnlockedToast: "🔓 Lock released!"
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
let requiredCompletedTubes = 0; // how many OTHER tubes must be fully sorted to release the locks
let levelNumColors = 0; // color count of the current level, used to gate the pattern overlay

// Properly store original hidden colors during generation
let hiddenColorMap = new Map(); // tubeIndex -> array of hidden colors

// Colors palette
const COLORS = [
    '#FF3366', '#33CCFF', '#33FF66', '#FFCC00',
    '#9933FF', '#FF6600', '#00FFCC', '#FF99FF',
    '#6666FF', '#CCFF33'
];

// Colors that read as too similar once many are on screen at once (cyan/green/teal/blue) get a
// small shimmering emoji overlay instead of relying on hue alone to distinguish them.
const PATTERNED_COLORS = new Map([
    [1, '❄️'],
    [2, '🌸'],
    [6, '💠'],
    [8, '⭐']
]);
const PATTERN_MIN_COLORS = 7; // only decorate once the board is crowded enough to actually confuse

// Difficulty tuning
const MAX_TUBES = 12;
const CAP_LEVEL_IDX = 21; // first levelIdx where numColors reaches COLORS.length (level 22)
const MOVE_ESTIMATE_PER_COLOR = 3;
const MOVE_ESTIMATE_PER_HIDDEN_LAYER = 1.5;
const MOVE_ESTIMATE_PER_LOCK = 2;
const MOVE_LIMIT_MULTIPLIER = 2;
const MOVE_LIMIT_ROUND_TO = 5;

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
const lockHintToast = document.getElementById('lockHintToast');

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

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Which tube indices get hidden layers, favoring even indices first (matches the original
// "every other tube" pattern), extended to however many tubes the current tier needs.
function computeHiddenTubeIndices(numColors, hiddenTubeCount) {
    const evens = [], odds = [];
    for (let c = 0; c < numColors; c++) (c % 2 === 0 ? evens : odds).push(c);
    return evens.concat(odds).slice(0, hiddenTubeCount);
}

// The shuffle-then-chunk step below can trap some of a color's units inside a locked tube,
// making that color impossible to ever fully sort while locked. Since the lock condition
// requires fully sorting `requiredCompletedTubes` OTHER colors, we must guarantee that many
// colors have ALL 4 of their units outside every locked tube. Swap any "safe" color unit that
// landed in a locked tube for a non-safe unit from an unlocked tube. Must run on raw color
// integers, before hidden-layer masking turns any slots into -1.
function ensureSafeColorsOutsideLocks(currentTubes, lockedIndices, safeColors) {
    for (const lockedIdx of lockedIndices) {
        const tube = currentTubes[lockedIdx];
        for (let slot = 0; slot < tube.length; slot++) {
            if (!safeColors.has(tube[slot])) continue;
            outer:
            for (let otherIdx = 0; otherIdx < currentTubes.length; otherIdx++) {
                if (lockedIndices.has(otherIdx)) continue;
                const otherTube = currentTubes[otherIdx];
                for (let otherSlot = 0; otherSlot < otherTube.length; otherSlot++) {
                    if (!safeColors.has(otherTube[otherSlot])) {
                        [tube[slot], otherTube[otherSlot]] = [otherTube[otherSlot], tube[slot]];
                        break outer;
                    }
                }
            }
        }
    }
}

function computeMoveLimit(levelIdx, numColors, hiddenLayerCount, lockedTubeCount) {
    if (levelIdx < 9) return null;
    const estimate = numColors * MOVE_ESTIMATE_PER_COLOR
        + hiddenLayerCount * MOVE_ESTIMATE_PER_HIDDEN_LAYER
        + lockedTubeCount * MOVE_ESTIMATE_PER_LOCK;
    return Math.ceil((estimate * MOVE_LIMIT_MULTIPLIER) / MOVE_LIMIT_ROUND_TO) * MOVE_LIMIT_ROUND_TO;
}

// Level Generator with Level 3+ Hidden Layers and Level 7+ Locks & Level 10+ Bombs.
// Difficulty keeps escalating past the point where numColors saturates at COLORS.length
// (level 22+, already at the MAX_TUBES cap) via more/deeper hidden layers and more locks,
// gated by `tier` — a step that advances every 4 levels past CAP_LEVEL_IDX.
function generateLevel(levelIdx) {
    const capacity = 4;
    const numEmpty = 2;
    let numColors = Math.min(3 + Math.floor(levelIdx / 3), COLORS.length, MAX_TUBES - numEmpty);
    levelNumColors = numColors;

    const hiddenEnabled = levelIdx >= 2;
    const lockEnabled = levelIdx >= 6;
    const tier = Math.floor(Math.max(0, levelIdx - CAP_LEVEL_IDX) / 4);

    const hiddenLayersPerTube = hiddenEnabled ? (tier >= 2 ? 3 : 2) : 0;
    const hiddenTubeCount = hiddenEnabled ? Math.min(numColors, Math.ceil(numColors / 2) + tier) : 0;
    const lockedTubeCount = lockEnabled ? Math.min(3, 1 + tier, numColors - 1) : 0;

    let colorPool = [];
    for (let c = 0; c < numColors; c++) {
        for (let i = 0; i < capacity; i++) {
            colorPool.push(c);
        }
    }
    shuffleArray(colorPool);

    let currentTubes = [];
    for (let c = 0; c < numColors; c++) {
        currentTubes.push(colorPool.slice(c * capacity, (c + 1) * capacity));
    }

    // Locks: pick unique random tube indices, then reserve enough "safe" colors that the
    // unlock condition (fully sort `requiredCompletedTubes` other tubes) stays achievable.
    tubeLocks = new Array(numColors).fill(false);
    const lockedIndices = new Set(shuffleArray([...Array(numColors).keys()]).slice(0, lockedTubeCount));
    for (const idx of lockedIndices) tubeLocks[idx] = true;

    requiredCompletedTubes = lockedTubeCount === 0 ? 0
        : Math.min(lockedTubeCount, Math.max(1, numColors - lockedTubeCount));

    if (requiredCompletedTubes > 0) {
        const safeColors = new Set(shuffleArray([...Array(numColors).keys()]).slice(0, requiredCompletedTubes));
        ensureSafeColorsOutsideLocks(currentTubes, lockedIndices, safeColors);
    }

    // Hidden mystery layers, applied after the lock repair pass so -1 placeholders are never
    // treated as swappable color units.
    hiddenColorMap.clear();
    if (hiddenEnabled) {
        for (const c of computeHiddenTubeIndices(numColors, hiddenTubeCount)) {
            const tubeColors = currentTubes[c];
            const hidden = tubeColors.slice(0, hiddenLayersPerTube);
            hiddenColorMap.set(c, hidden);
            for (let i = 0; i < hiddenLayersPerTube; i++) tubeColors[i] = -1;
        }
    }

    for (let i = 0; i < numEmpty; i++) {
        currentTubes.push([]);
        tubeLocks.push(false);
    }

    const hiddenLayerCount = hiddenTubeCount * hiddenLayersPerTube;
    moveLimit = computeMoveLimit(levelIdx, numColors, hiddenLayerCount, lockedTubeCount);

    return currentTubes;
}

function startLevel() {
    tubes = generateLevel(currentLevelIndex);
    history = [];
    selectedTubeIndex = null;
    animating = false;
    pouringData = null;
    movesCount = 0;
    lockHintToast.classList.remove('visible');
    clearTimeout(lockHintTimer);
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

// Locked tubes are released for free once the player fully sorts enough OTHER tubes —
// counted here excluding locked tubes themselves, since their contents are frozen, not
// something the player achieved.
function countCompletedTubes() {
    return tubes.filter((tube, i) => !tubeLocks[i] && isTubeComplete(tube)).length;
}

function checkLockConditions() {
    if (!anyLockedTubesPresent()) return;
    if (countCompletedTubes() >= requiredCompletedTubes) {
        tubeLocks = tubeLocks.map(() => false);
        showToast(locales[currentLang].lockUnlockedToast);
        updateUILanguage();
    }
}

let lockHintTimer = null;
function showToast(text, duration = 2200) {
    lockHintToast.textContent = text;
    lockHintToast.classList.add('visible');
    clearTimeout(lockHintTimer);
    lockHintTimer = setTimeout(() => lockHintToast.classList.remove('visible'), duration);
}

function showLockHint(remaining) {
    const loc = locales[currentLang] || locales.ru;
    const key = remaining === 1 ? 'lockHintSingular' : 'lockHintPlural';
    showToast(loc[key].replace('{n}', remaining));
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

            // Locked tubes are released by fully sorting other tubes first (see
            // checkLockConditions, called after every pour); clicking one before that
            // condition is met just shows a hint — no ad, no free unlock on click.
            if (tubeLocks[i]) {
                const remaining = Math.max(1, requiredCompletedTubes - countCompletedTubes());
                showLockHint(remaining);
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

// Tiles a small shimmering emoji across a liquid layer, so visually-similar colors
// (PATTERNED_COLORS) stay distinguishable even when their hues are close.
function drawShimmerPattern(emoji, x, y, w, h, elapsed, tubeIdx, layerIdx) {
    const fontSize = Math.max(10, h * 0.6);
    const stepX = fontSize * 1.1;
    const phase = tubeIdx * 0.7 + layerIdx * 1.3; // desyncs tubes so they don't pulse in lockstep
    const shimmer = 0.35 + 0.25 * Math.sin(elapsed / 600 + phase);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.globalAlpha = shimmer;
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let px = x + stepX / 2; px < x + w; px += stepX) {
        ctx.fillText(emoji, px, y + h / 2);
    }
    ctx.restore();
}

// Cached diagonal-hatch pattern for hidden ("mystery") liquid layers — built once since the
// texture is static, unlike the shimmer overlay above.
let hiddenHatchPattern = null;
function getHiddenHatchPattern() {
    if (hiddenHatchPattern) return hiddenHatchPattern;
    const size = 12;
    const off = document.createElement('canvas');
    off.width = size;
    off.height = size;
    const octx = off.getContext('2d');
    octx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    octx.lineWidth = 2;
    octx.beginPath();
    octx.moveTo(0, size); octx.lineTo(size, 0);
    octx.moveTo(-size / 2, size / 2); octx.lineTo(size / 2, -size / 2);
    octx.moveTo(size / 2, size * 1.5); octx.lineTo(size * 1.5, size / 2);
    octx.stroke();
    hiddenHatchPattern = ctx.createPattern(off, 'repeat');
    return hiddenHatchPattern;
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
                ctx.fillStyle = 'rgba(140, 140, 150, 0.35)';
                ctx.fillRect(-innerWidth / 2, yPos, innerWidth, layerHeight + 1);
                ctx.fillStyle = getHiddenHatchPattern();
                ctx.fillRect(-innerWidth / 2, yPos, innerWidth, layerHeight + 1);
            } else {
                ctx.fillStyle = COLORS[colorIdx] || '#fff';
                ctx.fillRect(-innerWidth / 2, yPos, innerWidth, layerHeight + 1);
                if (levelNumColors >= PATTERN_MIN_COLORS) {
                    const emoji = PATTERNED_COLORS.get(colorIdx);
                    if (emoji) drawShimmerPattern(emoji, -innerWidth / 2, yPos, innerWidth, layerHeight, elapsed, i, layerIdx);
                }
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

        // Draw Lock if tube is locked, with live progress toward the unlock condition
        if (tubeLocks[i]) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(-tubeWidth / 2, tubeHeight / 2 - 20, tubeWidth, 40);
            ctx.fillStyle = '#FFD700';
            ctx.font = 'bold 13px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`🔒 ${countCompletedTubes()}/${requiredCompletedTubes}`, 0, tubeHeight / 2);
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
        checkLockConditions();

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

// Reveal hidden layers automatically when top layers are poured out. Works for any hidden
// depth (2 or 3 layers), revealing each slot the instant it becomes the tube's top.
function checkAndRevealHiddenLayers() {
    for (const [tIdx, hidden] of hiddenColorMap.entries()) {
        const tube = tubes[tIdx];
        while (tube.length > 0 && tube.length <= hidden.length && tube[tube.length - 1] === -1) {
            tube[tube.length - 1] = hidden[tube.length - 1];
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
