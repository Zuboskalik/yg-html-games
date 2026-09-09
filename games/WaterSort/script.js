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
        lockUnlockedToast: "🔓 Замок снят!",
        skinTube: "Колба",
        skinBottle: "Бутылка"
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
        lockUnlockedToast: "🔓 Lock released!",
        skinTube: "Tube",
        skinBottle: "Bottle"
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
let particles = []; // celebratory particle effects fired when a patterned color's tube completes

// Properly store original hidden colors during generation
let hiddenColorMap = new Map(); // tubeIndex -> array of hidden colors

// Colors palette — muted/varied rather than neon, spaced around the hue wheel. The first
// 6 (indices 0-5) are introduced from level 1 and chosen to be maximally distinct alone;
// indices 6-9 are only reached at higher levels and lean on PATTERNED_COLORS below once
// they'd otherwise be too close to an earlier hue (e.g. pink vs purple, indigo vs blue).
const COLORS = [
    '#E05C5C', // 0 red
    '#E3B23C', // 1 amber
    '#4FAE6E', // 2 green
    '#4A80D9', // 3 blue
    '#8C63C9', // 4 purple
    '#3FAFAF', // 5 teal
    '#E0793D', // 6 orange
    '#D9689D', // 7 pink       — close to purple(4)
    '#6E6FCB', // 8 indigo     — close to blue(3)/purple(4)
    '#A9C24A'  // 9 lime       — close to green(2)/amber(1)
];

// Colors that read as too similar once many are on screen at once get a small shimmering
// emoji overlay instead of relying on hue alone to distinguish them. Each emoji also drives
// a matching particle effect when that color's tube is completed (see triggerColorEffect).
const PATTERNED_COLORS = new Map([
    [5, '❄️'], // teal
    [7, '🌸'], // pink
    [8, '💎'], // indigo
    [9, '🍀']  // lime
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
const LEVEL_MILESTONES = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

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

// Clips the canvas to a straight tube's liquid channel (uniform width top to bottom,
// rounded bottom corners) — used by the "tube" skin (images/water1.png). Fractions
// measured from the PNG: the glass walls take up roughly a quarter of the width on
// each side, and the straight part ends about 85% down before the rounded tip.
function clipStraightChannel(tubeWidth, tubeHeight, p) {
    const innerWidth = tubeWidth * (1 - p.marginXFrac * 2);
    const top = tubeHeight * p.topFrac;
    const bottom = tubeHeight * p.bottomFrac;
    const radius = Math.min(innerWidth / 2, (bottom - top) * 0.25);
    ctx.beginPath();
    ctx.roundRect(-innerWidth / 2, top, innerWidth, bottom - top, [0, 0, radius, radius]);
    ctx.clip();
    return { top, bottom };
}

// Clips to a bottle's liquid channel: a narrow neck, a diagonal shoulder taper, then a
// wide rounded-bottom body — used by the "bottle" skin (images/water4.png). The clip only
// needs to be a reasonable envelope of the transparent area, not pixel-exact: anywhere it
// overlaps solid artwork (cap, shoulder outline) is simply painted over when the skin PNG
// is drawn on top afterward, so slight generosity here is harmless.
function clipBottleChannel(tubeWidth, tubeHeight, p) {
    const neckHalfW = tubeWidth * (0.5 - p.neckMarginXFrac);
    const bodyHalfW = tubeWidth * (0.5 - p.bodyMarginXFrac);
    const neckTop = tubeHeight * p.neckTopFrac;
    const taperTop = tubeHeight * p.taperTopFrac;
    const taperBottom = tubeHeight * p.taperBottomFrac;
    const bodyBottom = tubeHeight * p.bodyBottomFrac;
    // The bottle's base is only gently rounded — a small corner radius, not a semicircle
    // like the tube's — measured from the source art as ~10% of the container's width.
    const radius = Math.min(bodyHalfW, tubeWidth * p.bottomRadiusFrac, (bodyBottom - taperBottom) * 0.5);

    ctx.beginPath();
    ctx.moveTo(-neckHalfW, neckTop);
    ctx.lineTo(-neckHalfW, taperTop);
    ctx.lineTo(-bodyHalfW, taperBottom);
    ctx.lineTo(-bodyHalfW, bodyBottom - radius);
    ctx.arcTo(-bodyHalfW, bodyBottom, -bodyHalfW + radius, bodyBottom, radius);
    ctx.lineTo(bodyHalfW - radius, bodyBottom);
    ctx.arcTo(bodyHalfW, bodyBottom, bodyHalfW, bodyBottom - radius, radius);
    ctx.lineTo(bodyHalfW, taperBottom);
    ctx.lineTo(neckHalfW, taperTop);
    ctx.lineTo(neckHalfW, neckTop);
    ctx.closePath();
    ctx.clip();
    return { top: neckTop, bottom: bodyBottom };
}

// Container skins. `unlocked`/`unlockLevel`/`unlockAd`/`unlockPrice` are placeholders for
// a future unlock system (progress, rewarded ad, or IAP — exact mechanic TBD); today every
// skin is simply unlocked. A locked skin would render dimmed with a 🔒 badge in the picker
// (see updateSkinSelectionUI) and selectSkin() already refuses to switch to one, so wiring
// in a real gate later is just a matter of flipping `unlocked` based on that mechanic.
const SKINS = {
    tube: {
        id: 'tube',
        labelKey: 'skinTube',
        src: 'images/water1.png',
        unlocked: true,
        unlockLevel: null,
        unlockAd: null,
        unlockPrice: null,
        clipLiquid: clipStraightChannel,
        liquidParams: { marginXFrac: 0.263, topFrac: 0.075, bottomFrac: 0.94 }
    },
    bottle: {
        id: 'bottle',
        labelKey: 'skinBottle',
        src: 'images/water4.png',
        unlocked: true,
        unlockLevel: null,
        unlockAd: null,
        unlockPrice: null,
        clipLiquid: clipBottleChannel,
        liquidParams: {
            neckMarginXFrac: 0.36,
            bodyMarginXFrac: 0.145,
            neckTopFrac: 0.10,
            taperTopFrac: 0.27,
            taperBottomFrac: 0.40,
            bodyBottomFrac: 0.94,
            bottomRadiusFrac: 0.1 // small rounded corners, not a semicircle — a real bottle base
        }
    }
};

const SKIN_STORAGE_KEY = 'waterSortSkin';
function loadSavedSkinId() {
    try {
        const saved = localStorage.getItem(SKIN_STORAGE_KEY);
        if (saved && SKINS[saved] && SKINS[saved].unlocked) return saved;
    } catch (e) { /* localStorage unavailable (private mode, etc.) — fall back below */ }
    return 'tube';
}
let currentSkinId = loadSavedSkinId();

function selectSkin(skinId) {
    const skin = SKINS[skinId];
    if (!skin || !skin.unlocked) return;
    currentSkinId = skinId;
    try { localStorage.setItem(SKIN_STORAGE_KEY, skinId); } catch (e) { /* ignore */ }
    updateSkinSelectionUI();
}

const skinOptionButtons = document.querySelectorAll('.skin-option');
skinOptionButtons.forEach(btn => {
    btn.addEventListener('click', () => selectSkin(btn.dataset.skin));
});

function updateSkinSelectionUI() {
    skinOptionButtons.forEach(btn => {
        const skin = SKINS[btn.dataset.skin];
        btn.classList.toggle('selected', btn.dataset.skin === currentSkinId);
        btn.classList.toggle('locked', !skin.unlocked);
        const lockBadge = btn.querySelector('[data-lock-badge]');
        if (lockBadge) lockBadge.classList.toggle('hidden', skin.unlocked);
    });
}

// Preload every skin's artwork up front (small PNGs, and the player can switch skins from
// the main menu at any time) rather than only the currently-selected one.
const skinImages = {};
const skinImagesReady = {};
const skinLoadPromises = Object.values(SKINS).map(skin => new Promise(resolve => {
    const img = new Image();
    img.onload = () => { skinImagesReady[skin.id] = true; resolve(); };
    img.onerror = () => resolve();
    img.src = skin.src;
    skinImages[skin.id] = img;
}));
const allSkinsLoaded = Promise.all(skinLoadPromises);

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

            allSkinsLoaded.then(() => {
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
    const txtSkinTube = document.getElementById('txt-skin-tube');
    const txtSkinBottle = document.getElementById('txt-skin-bottle');
    if (txtSkinTube) txtSkinTube.textContent = loc.skinTube;
    if (txtSkinBottle) txtSkinBottle.textContent = loc.skinBottle;
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
    updateSkinSelectionUI();
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

// Which tube indices get hidden layers. Scrambling redistributes content across ALL tube
// slots — a tube's index no longer tells you how much is really in it — so candidates are
// chosen by actual content: strictly more than `hiddenLayersPerTube` units, so masking the
// bottom layers can never hide the whole tube and leave it with no visible top to pour from.
function pickHiddenTubeIndices(tubes, hiddenTubeCount, hiddenLayersPerTube) {
    const candidates = [];
    for (let i = 0; i < tubes.length; i++) {
        if (tubes[i].length > hiddenLayersPerTube) candidates.push(i);
    }
    shuffleArray(candidates);
    return candidates.slice(0, hiddenTubeCount);
}

function computeMoveLimit(levelIdx, numColors, hiddenLayerCount, lockedTubeCount) {
    if (levelIdx < 9) return null;
    const estimate = numColors * MOVE_ESTIMATE_PER_COLOR
        + hiddenLayerCount * MOVE_ESTIMATE_PER_HIDDEN_LAYER
        + lockedTubeCount * MOVE_ESTIMATE_PER_LOCK;
    return Math.ceil((estimate * MOVE_LIMIT_MULTIPLIER) / MOVE_LIMIT_ROUND_TO) * MOVE_LIMIT_ROUND_TO;
}

// Builds a puzzle that is GUARANTEED solvable: start from the fully-sorted end state (one
// color per tube, plus empties) and "unsolve" it by repeatedly moving a partial top run from
// one tube to another. Moving only PART of a run (not necessarily draining it) is what makes
// this safely reversible: the source tube's exposed top after the move is either the same
// color (if any was left behind) or empty — both are legal pour-back targets — so replaying
// the whole move log in reverse is always a 100% legal solve sequence for the real game rules.
// Returns the scrambled tubes plus the log needed to compute solve order (see below).
function buildSolvableTubes(numColors, capacity, numEmpty, scrambleMoves) {
    const tubes = [];
    for (let c = 0; c < numColors; c++) tubes.push(new Array(capacity).fill(c));
    for (let i = 0; i < numEmpty; i++) tubes.push([]);

    const log = [];
    let performed = 0;
    let attempts = 0;
    const maxAttempts = scrambleMoves * 20;

    while (performed < scrambleMoves && attempts < maxAttempts) {
        attempts++;
        const sources = [];
        for (let i = 0; i < tubes.length; i++) if (tubes[i].length > 0) sources.push(i);
        if (sources.length === 0) break;
        const from = sources[Math.floor(Math.random() * sources.length)];
        const fromTube = tubes[from];
        const topColor = fromTube[fromTube.length - 1];
        let runLen = 0;
        for (let i = fromTube.length - 1; i >= 0 && fromTube[i] === topColor; i--) runLen++;

        const dests = [];
        for (let i = 0; i < tubes.length; i++) {
            if (i === from) continue;
            if (tubes[i].length < capacity) dests.push(i);
        }
        if (dests.length === 0) continue;
        const to = dests[Math.floor(Math.random() * dests.length)];
        const room = capacity - tubes[to].length;
        const maxMove = Math.min(runLen, room);
        if (maxMove < 1) continue;
        const moveCount = 1 + Math.floor(Math.random() * maxMove);

        for (let k = 0; k < moveCount; k++) tubes[to].push(fromTube.pop());
        log.push({ from, to, count: moveCount });
        performed++;
    }

    // Scrambling uses empty tubes as scratch space, so the final state isn't guaranteed to
    // have any left empty. Guarantee at least `numEmpty` by undoing moves from the end (each
    // undo is the same legal partial-run pour, just reversed) until enough are free — worst
    // case this fully unwinds back to the pristine solved state, which trivially satisfies
    // `numEmpty` by construction, so this always terminates successfully.
    function countEmpty() {
        let n = 0;
        for (const t of tubes) if (t.length === 0) n++;
        return n;
    }
    while (countEmpty() < numEmpty && log.length > 0) {
        const mv = log.pop();
        const src = tubes[mv.to];
        const dst = tubes[mv.from];
        for (let k = 0; k < mv.count; k++) dst.push(src.pop());
    }

    return { tubes, log };
}


// Level Generator with Level 3+ Hidden Layers and Level 7+ Locks & Level 10+ Bombs.
// Difficulty keeps escalating past the point where numColors saturates at COLORS.length
// (level 22+, already at the MAX_TUBES cap) via more/deeper hidden layers, gated by
// `hiddenTier` — a step that advances every 4 levels past CAP_LEVEL_IDX. Locks grow on
// their own, smoother schedule (`lockTier`, +1 lock every 6 levels from level 7) so the
// count doesn't sit flat at 1 for a dozen levels and then jump straight to 3.
function generateLevel(levelIdx) {
    const capacity = 4;
    const numEmpty = 2;
    let numColors = Math.min(3 + Math.floor(levelIdx / 3), COLORS.length, MAX_TUBES - numEmpty);
    levelNumColors = numColors;

    const hiddenEnabled = levelIdx >= 2;
    const lockEnabled = levelIdx >= 6;
    const hiddenTier = Math.floor(Math.max(0, levelIdx - CAP_LEVEL_IDX) / 4);
    const lockTier = lockEnabled ? Math.floor((levelIdx - 6) / 6) : 0;

    const hiddenLayersPerTube = hiddenEnabled ? (hiddenTier >= 2 ? 3 : 2) : 0;
    const hiddenTubeCount = hiddenEnabled ? Math.min(numColors, Math.ceil(numColors / 2) + hiddenTier) : 0;
    const lockedTubeCount = lockEnabled ? Math.min(3, 1 + lockTier, numColors - 1) : 0;

    let currentTubes;
    let lockedIndices = new Set();

    if (lockedTubeCount > 0) {
        // Generate the "safe" colors (needed to satisfy the unlock condition) and the
        // "lockable" colors as two FULLY INDEPENDENT sub-puzzles, each with its own dedicated
        // empty tube. This guarantees the safe colors are sortable start to finish without ever
        // touching a locked tube — not just "their units happen to sit outside the locks"
        // (which doesn't guarantee they're actually gatherable), but genuinely self-contained.
        requiredCompletedTubes = Math.min(lockedTubeCount, Math.max(1, numColors - lockedTubeCount));
        const safeColorCount = requiredCompletedTubes;
        const lockableColorCount = numColors - safeColorCount;
        const safeEmpty = 1;
        const lockableEmpty = numEmpty - safeEmpty;

        const safeGroup = buildSolvableTubes(safeColorCount, capacity, safeEmpty, Math.max(20, safeColorCount * capacity * 3)).tubes;
        const lockableGroup = buildSolvableTubes(lockableColorCount, capacity, lockableEmpty, Math.max(20, lockableColorCount * capacity * 3)).tubes;

        // Re-number the lockable group's colors so they don't collide with the safe group's.
        for (const tube of lockableGroup) {
            for (let i = 0; i < tube.length; i++) tube[i] += safeColorCount;
        }

        // Concatenate whole groups as-is — scrambling (and the empty-count repair above)
        // already redistributed content across EVERY slot in each group, so there's no fixed
        // "first K are colors, rest are empties" split left to slice by position.
        currentTubes = [...safeGroup, ...lockableGroup];

        // Lock targets: any tube within the lockable group's own index range that actually has
        // content — safe by construction, since that group never shares a tube (or a color)
        // with the safe group.
        const lockCandidates = [];
        for (let i = safeGroup.length; i < currentTubes.length; i++) {
            if (currentTubes[i].length > 0) lockCandidates.push(i);
        }
        shuffleArray(lockCandidates);
        lockedIndices = new Set(lockCandidates.slice(0, Math.min(lockedTubeCount, lockCandidates.length)));
    } else {
        requiredCompletedTubes = 0;
        currentTubes = buildSolvableTubes(numColors, capacity, numEmpty, Math.max(30, numColors * capacity * 3)).tubes;
    }

    tubeLocks = new Array(currentTubes.length).fill(false);
    for (const idx of lockedIndices) tubeLocks[idx] = true;

    // Hidden mystery layers, applied last so -1 placeholders never interfere with the
    // group-splitting/re-numbering above (which needs real color values throughout).
    hiddenColorMap.clear();
    if (hiddenEnabled) {
        for (const c of pickHiddenTubeIndices(currentTubes, hiddenTubeCount, hiddenLayersPerTube)) {
            const tubeColors = currentTubes[c];
            const hidden = tubeColors.slice(0, hiddenLayersPerTube);
            hiddenColorMap.set(c, hidden);
            for (let i = 0; i < hiddenLayersPerTube; i++) tubeColors[i] = -1;
        }
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
    particles = [];
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

// Return to the main menu mid-game (e.g. to pick a different container skin). Reuses the
// existing main-menu overlay — pressing "Играть" there simply restarts the current level.
const openMenuBtn = document.getElementById('open-menu-btn');
openMenuBtn.addEventListener('click', () => {
    mainMenu.classList.remove('hidden');
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

// Celebratory particle effects, one style per patterned emoji, fired once when a tube of
// that color is completed (see triggerColorEffect, called from updateAndDrawPouring).
function spawnParticles(list) {
    const now = performance.now();
    for (const p of list) particles.push({ ...p, spawnTime: now });
}

function spawnSnowfall() {
    const list = [];
    for (let i = 0; i < 24; i++) {
        list.push({
            emoji: '❄️',
            x: Math.random() * canvas.width,
            y: -20 - Math.random() * 120,
            vx: (Math.random() - 0.5) * 20,
            vy: 70 + Math.random() * 50,
            size: 16 + Math.random() * 10,
            rotSpeed: (Math.random() - 0.5) * 2,
            maxLife: 2600 + Math.random() * 800
        });
    }
    spawnParticles(list);
}

function spawnFlowerRise() {
    const list = [];
    for (let i = 0; i < 20; i++) {
        list.push({
            emoji: '🌸',
            x: Math.random() * canvas.width,
            y: canvas.height + 20 + Math.random() * 60,
            vx: (Math.random() - 0.5) * 30,
            vy: -(70 + Math.random() * 50),
            size: 18 + Math.random() * 10,
            rotSpeed: (Math.random() - 0.5) * 3,
            maxLife: 2200 + Math.random() * 600
        });
    }
    spawnParticles(list);
}

function spawnCrystalBurst(cx, cy) {
    const list = [];
    const count = 18;
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
        const speed = 90 + Math.random() * 110;
        list.push({
            emoji: '💎',
            x: cx,
            y: cy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: 16 + Math.random() * 8,
            rotSpeed: (Math.random() - 0.5) * 4,
            maxLife: 900 + Math.random() * 300
        });
    }
    spawnParticles(list);
}

function spawnCloverSpiral(cx, cy) {
    const list = [];
    const count = 16;
    for (let i = 0; i < count; i++) {
        list.push({
            emoji: '🍀',
            x: cx,
            y: cy,
            angle: (Math.PI * 2 * i) / count,
            spiralSpeed: 70 + Math.random() * 40,
            vy: -(30 + Math.random() * 30),
            size: 16 + Math.random() * 8,
            rotSpeed: (Math.random() - 0.5) * 3,
            maxLife: 1500 + Math.random() * 400,
            kind: 'spiral'
        });
    }
    spawnParticles(list);
}

// Fires the effect matching a completed tube's color, anchored at that tube's on-screen
// position (screen-wide effects like snowfall/flower-rise ignore x/y). Only fires once the
// pattern overlay itself is actually visible (levelNumColors >= PATTERN_MIN_COLORS) so the
// effect always corresponds to a mark the player actually saw on the liquid.
function triggerColorEffect(colorIdx, x, y) {
    if (levelNumColors < PATTERN_MIN_COLORS) return;
    const emoji = PATTERNED_COLORS.get(colorIdx);
    if (emoji === '❄️') spawnSnowfall();
    else if (emoji === '🌸') spawnFlowerRise();
    else if (emoji === '💎') spawnCrystalBurst(x, y);
    else if (emoji === '🍀') spawnCloverSpiral(x, y);
}

function updateAndDrawParticles() {
    if (particles.length === 0) return;
    const now = performance.now();
    particles = particles.filter(p => (now - p.spawnTime) < p.maxLife);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of particles) {
        const age = now - p.spawnTime;
        const t = age / 1000;
        let x, y;
        if (p.kind === 'spiral') {
            const angle = p.angle + t * (p.spiralSpeed / 30);
            const radius = t * p.spiralSpeed;
            x = p.x + Math.cos(angle) * radius;
            y = p.y + Math.sin(angle) * radius + p.vy * t;
        } else {
            x = p.x + p.vx * t;
            y = p.y + p.vy * t;
        }

        const lifeFrac = age / p.maxLife;
        const alpha = lifeFrac < 0.75 ? 1 : Math.max(0, 1 - (lifeFrac - 0.75) / 0.25);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y);
        ctx.rotate(t * (p.rotSpeed || 0));
        ctx.font = `${p.size}px sans-serif`;
        ctx.fillText(p.emoji, 0, 0);
        ctx.restore();
    }
    ctx.restore();
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

        // Liquid is clipped to the current skin's transparent channel, not the full bounding
        // box, so it reads as being inside the glass, not under it. The clip shape itself
        // (straight tube vs. narrow-necked bottle) does the work of following the container's
        // silhouette — each layer just fills a full-width band and gets masked by it.
        const skin = SKINS[currentSkinId];
        const bandHalfWidth = tubeWidth / 2;

        ctx.save();
        const { top: liquidTop, bottom: liquidBottom } = skin.clipLiquid(tubeWidth, tubeHeight, skin.liquidParams);
        let layerHeight = (liquidBottom - liquidTop) / 4;

        for (let layerIdx = 0; layerIdx < tubeData.length; layerIdx++) {
            let colorIdx = tubeData[layerIdx];
            let yPos = liquidBottom - (layerIdx + 1) * layerHeight;

            if (colorIdx === -1) {
                ctx.fillStyle = 'rgba(140, 140, 150, 0.35)';
                ctx.fillRect(-bandHalfWidth, yPos, bandHalfWidth * 2, layerHeight + 1);
                ctx.fillStyle = getHiddenHatchPattern();
                ctx.fillRect(-bandHalfWidth, yPos, bandHalfWidth * 2, layerHeight + 1);
            } else {
                ctx.fillStyle = COLORS[colorIdx] || '#fff';
                ctx.fillRect(-bandHalfWidth, yPos, bandHalfWidth * 2, layerHeight + 1);
                if (levelNumColors >= PATTERN_MIN_COLORS) {
                    const emoji = PATTERNED_COLORS.get(colorIdx);
                    if (emoji) drawShimmerPattern(emoji, -bandHalfWidth, yPos, bandHalfWidth * 2, layerHeight, elapsed, i, layerIdx);
                }
            }
        }
        ctx.restore();

        // Draw the container skin (transparent glass/bottle PNG) on top of the poured liquid
        const skinImg = skinImages[currentSkinId];
        if (skinImagesReady[currentSkinId]) {
            ctx.save();
            if (isSelected) {
                ctx.shadowColor = '#00ffcc';
                ctx.shadowBlur = 16;
            } else if (isComplete) {
                ctx.shadowColor = COLORS[tubeData[0]] || '#fff';
                ctx.shadowBlur = 12;
            }
            ctx.drawImage(skinImg, -tubeWidth / 2, 0, tubeWidth, tubeHeight);
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

    updateAndDrawParticles();
}

function updateAndDrawPouring(layout) {
    const { tubesPos, tubeWidth, tubeHeight } = layout;
    let fromPos = tubesPos[pouringData.fromIdx];
    let toPos = tubesPos[pouringData.toIdx];

    if (!isPaused) {
        pouringData.progress += 0.08;
    }
    if (pouringData.progress >= 1) {
        const toIdx = pouringData.toIdx;
        let toTube = tubes[toIdx];
        for (let color of pouringData.movingBlock) {
            toTube.push(color);
        }

        // Check if any hidden layers are now exposed
        checkAndRevealHiddenLayers();
        checkLockConditions();

        if (isTubeComplete(toTube)) {
            const pos = tubesPos[toIdx];
            triggerColorEffect(toTube[0], pos.x, pos.y + tubeHeight / 2);
        }

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
