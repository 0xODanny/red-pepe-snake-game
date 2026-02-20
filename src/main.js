import "./style.css";
import phoneUrl from "./assets/nokia3310.png";

// ------------------------------------------------------------
// Overlay tuning constants (DESIGN SPACE)
//
// The Nokia image is 1600x1600. These coordinates are in that
// same coordinate space, and get scaled to the displayed size.
// ------------------------------------------------------------
const DESIGN_SIZE = 1600;

// Screen rectangle (game playable area) in DESIGN px
const SCREEN_LEFT = 580;
const SCREEN_TOP = 308;
const SCREEN_WIDTH = 450;
const SCREEN_HEIGHT = 390;

// Keep gameplay pixels slightly away from the screen edge so
// the Nokia bezel/mask doesn't visually clip edge food.
const BOARD_MARGIN_PX = 14;

// Keypad button rectangles in DESIGN px (tap targets)
const KEY_SIZE = 150;
const KEY_WIDE = 195;
const KEYS = {
  // Nudged down a bit for better alignment.
  "2": { cx: 800, cy: 1135, w: KEY_SIZE, h: KEY_SIZE },
  // D-pad outward + a touch higher
  "4": { cx: 610, cy: 1225, w: KEY_WIDE, h: KEY_SIZE },
  "6": { cx: 990, cy: 1225, w: KEY_WIDE, h: KEY_SIZE },
  // Pause key on the real "*" button (bottom-left), moved outward
  "*": { cx: 610, cy: 1465, w: KEY_WIDE, h: KEY_SIZE },
  "8": { cx: 800, cy: 1350, w: KEY_SIZE, h: KEY_SIZE },
};

// Board grid (classic snake)
const GRID_COLS = 20;
const GRID_ROWS = 16;

const COLOR_BG = "#0b120c";
const COLOR_SNAKE = "#7CFF9D";
const COLOR_FOOD = "#D6FFD9";
const COLOR_TEXT = "rgba(214,255,217,0.95)";
const COLOR_OVERLAY = "rgba(0,0,0,0.65)";

// Food is drawn at 0.7x cell size; pad by half-food (0.35 cell)
// so edge food never gets visually clipped by the Nokia screen mask.
const FOOD_DRAW_SCALE = 0.7;
const HALF_FOOD_PAD_CELLS = FOOD_DRAW_SCALE / 2;

const phoneImg = document.getElementById("phoneImg");
const phone = document.getElementById("phone");
const canvas = document.getElementById("screenCanvas");
const restartBtn = document.getElementById("restartBtn");

const hudScore = document.getElementById("hudScore");
const hudBest = document.getElementById("hudBest");
const hudAttempts = document.getElementById("hudAttempts");

const key2 = document.getElementById("key2");
const key4 = document.getElementById("key4");
const key6 = document.getElementById("key6");
const keyStar = document.getElementById("keyStar");
const key8 = document.getElementById("key8");

/** @type {CanvasRenderingContext2D} */
const ctx = canvas.getContext("2d", { alpha: false });

let dpr = 1;

let screenCss = { left: 0, top: 0, width: 1, height: 1 };
let board = { cell: 1, offX: 0, offY: 0, w: 1, h: 1 };

let score = 0;
let gameOver = false;

let gameState = "idle"; // idle | playing | paused | over
let uiScreen = "menu"; // menu | instructions | none
let menuIndex = 2; // default highlight: New game

/** @type {{x:number,y:number}[]} */
let snake = [];
let dir = { x: 1, y: 0 };
let nextDir = { x: 1, y: 0 };
let food = { x: 0, y: 0 };

let lastMs = 0;
let accMs = 0;

const STATS_KEY = "redpepe.snake.stats.v1";

function getLocalDateKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function loadStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return { bestScore: 0, attemptsByDay: {} };
    const parsed = JSON.parse(raw);
    return {
      bestScore: typeof parsed.bestScore === "number" ? parsed.bestScore : 0,
      attemptsByDay: typeof parsed.attemptsByDay === "object" && parsed.attemptsByDay ? parsed.attemptsByDay : {},
    };
  } catch {
    return { bestScore: 0, attemptsByDay: {} };
  }
}

function saveStats(stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // ignore
  }
}

let stats = loadStats();

function updateHud() {
  if (hudScore) hudScore.textContent = String(score);
  if (hudBest) hudBest.textContent = String(stats.bestScore ?? 0);
  if (hudAttempts) hudAttempts.textContent = String(stats.attemptsByDay?.[getLocalDateKey()] ?? 0);
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function randInt(min, maxInclusive) {
  return Math.floor(Math.random() * (maxInclusive - min + 1)) + min;
}

function isSameCell(a, b) {
  return a.x === b.x && a.y === b.y;
}

function stepMsForScore(s) {
  // Nokia-style speed rules (10 levels)
  // level = min(10, 1 + floor(score / 5))
  // tick = max(80, 220 - (level - 1) * 15)
  const level = Math.min(10, 1 + Math.floor(s / 5));
  const tick = Math.max(80, 220 - (level - 1) * 15);
  return tick;
}

function speedLevelForScore(s) {
  return Math.min(10, 1 + Math.floor(s / 5));
}

function setDirection(x, y) {
  // Prevent 180° reversal.
  if (x === -dir.x && y === -dir.y) return;
  nextDir = { x, y };
}

function spawnFood() {
  for (let tries = 0; tries < 5000; tries++) {
    const p = { x: randInt(0, GRID_COLS - 1), y: randInt(0, GRID_ROWS - 1) };
    if (snake.some((s) => isSameCell(s, p))) continue;
    food = p;
    return;
  }
  // Fallback
  food = { x: 0, y: 0 };
}

function resetGame() {
  score = 0;
  gameOver = false;
  dir = { x: 1, y: 0 };
  nextDir = { x: 1, y: 0 };

  const startX = Math.floor(GRID_COLS / 2) - 1;
  const startY = Math.floor(GRID_ROWS / 2);
  snake = [
    { x: startX, y: startY },
    { x: startX - 1, y: startY },
    { x: startX - 2, y: startY },
  ];

  spawnFood();
  restartBtn.classList.add("hidden");
  updateHud();
}

function recordAttemptStart() {
  const today = getLocalDateKey();
  if (!stats.attemptsByDay) stats.attemptsByDay = {};
  stats.attemptsByDay[today] = (stats.attemptsByDay[today] ?? 0) + 1;
  saveStats(stats);
  updateHud();
}

function maybeUpdateBest() {
  if (score > (stats.bestScore ?? 0)) {
    stats.bestScore = score;
    saveStats(stats);
    updateHud();
  }
}

function startNewGame() {
  resetGame();
  recordAttemptStart();
  gameState = "playing";
  uiScreen = "none";
}

function pauseGame() {
  if (gameState !== "playing") return;
  gameState = "paused";
  uiScreen = "menu";
  menuIndex = 1; // Continue
}

function resumeGame() {
  if (gameState !== "paused") return;
  gameState = "playing";
  uiScreen = "none";
}

function togglePause() {
  if (gameState === "playing") pauseGame();
  else if (gameState === "paused") resumeGame();
}

function selectMenuItem(index) {
  // 0: Instructions, 1: Continue, 2: New game
  if (index === 0) {
    uiScreen = "instructions";
    return;
  }
  if (index === 1) {
    if (gameState === "paused") resumeGame();
    return;
  }
  if (index === 2) {
    startNewGame();
  }
}

function recordAttemptAndBest() {
  // Deprecated (attempts now recorded on game start; best updates on food).
}

function tick() {
  if (gameOver || gameState !== "playing") return;

  dir = nextDir;
  const head = snake[0];
  const next = { x: head.x + dir.x, y: head.y + dir.y };

  // Wrap-around (classic Nokia Snake)
  next.x = (next.x + GRID_COLS) % GRID_COLS;
  next.y = (next.y + GRID_ROWS) % GRID_ROWS;

  const ate = isSameCell(next, food);
  const nextSnake = [next, ...snake];
  if (!ate) nextSnake.pop();

  // Self collision (check head vs body)
  for (let i = 1; i < nextSnake.length; i++) {
    if (isSameCell(nextSnake[i], next)) {
      gameOver = true;
      gameState = "over";
      restartBtn.classList.remove("hidden");
      return;
    }
  }

  snake = nextSnake;

  if (ate) {
    score += 1;
    spawnFood();
    maybeUpdateBest();
    updateHud();
  }
}

function draw() {
  // Clear screen
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, screenCss.width, screenCss.height);

  // Board background (slightly inset to feel like LCD)
  const inset = 6;
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(board.offX - inset, board.offY - inset, board.w + inset * 2, board.h + inset * 2);

  // Food
  ctx.fillStyle = COLOR_FOOD;
  drawCell(food.x, food.y, 0.7);

  // Snake
  ctx.fillStyle = COLOR_SNAKE;
  for (let i = 0; i < snake.length; i++) {
    drawCell(snake[i].x, snake[i].y, i === 0 ? 0.95 : 0.85);
  }

  // Optional UI: speed indicator (small, top-right)
  if (gameState === "playing") {
    const fs = getUiFontScale();
    ctx.fillStyle = "rgba(214,255,217,0.7)";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.font = `${px(10, fs)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    ctx.fillText(`SPEED: ${speedLevelForScore(score)}`, screenCss.width - 10, 8);
  }

  // Menu / instructions overlay
  if (uiScreen === "menu") {
    drawMenu();
    return;
  }

  if (uiScreen === "instructions") {
    drawInstructions();
    return;
  }

  if (gameOver) {
    ctx.fillStyle = COLOR_OVERLAY;
    ctx.fillRect(0, 0, screenCss.width, screenCss.height);
    ctx.fillStyle = COLOR_TEXT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fs = getUiFontScale();
    ctx.font = `bold ${px(22, fs)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    ctx.fillText("GAME OVER", screenCss.width / 2, screenCss.height / 2 - 16);
    ctx.font = `bold ${px(13, fs)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    ctx.fillText(`Final score: ${score}`, screenCss.width / 2, screenCss.height / 2 + 18);
    ctx.font = `${px(10, fs)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    ctx.fillText("Press R or tap Restart", screenCss.width / 2, screenCss.height / 2 + 44);
  }
}

function getUiFontScale() {
  // Based on the actual screen width in CSS pixels.
  // Always a bit smaller than previous defaults to avoid clipping.
  const s = (screenCss.width / SCREEN_WIDTH) * 0.88;
  return clamp(s, 0.62, 0.9);
}

function px(basePx, scale) {
  return Math.max(9, Math.floor(basePx * scale));
}

function drawWrappedText(text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(/\s+/).filter(Boolean);
  let line = "";
  let yy = y;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width <= maxWidth || !line) {
      line = test;
      continue;
    }
    ctx.fillText(line, x, yy);
    yy += lineHeight;
    line = words[i];
  }
  if (line) ctx.fillText(line, x, yy);
  return yy + lineHeight;
}

function drawMenu() {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, screenCss.width, screenCss.height);

  const fs = getUiFontScale();
  const metrics = getMenuMetrics(fs);

  ctx.fillStyle = COLOR_TEXT;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `bold ${px(16, fs)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  ctx.fillText("Snake II", screenCss.width / 2, metrics.titleY);

  const items = [
    { label: "Instructions", enabled: true },
    { label: "Continue", enabled: gameState === "paused" },
    { label: "New game", enabled: true },
  ];

  const startY = metrics.startY;
  const rowH = metrics.rowH;
  for (let i = 0; i < items.length; i++) {
    const y = startY + i * rowH;
    const isSel = i === menuIndex;
    if (isSel) {
      ctx.fillStyle = "rgba(214,255,217,0.22)";
      ctx.fillRect(16, y - 4, screenCss.width - 32, rowH);
    }
    ctx.fillStyle = items[i].enabled ? COLOR_TEXT : "rgba(214,255,217,0.35)";
    ctx.font = `bold ${px(18, fs)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(items[i].label, 22, y);
  }
}

function getMenuMetrics(fs) {
  // Centralized so draw + pointer hit-testing stay consistent.
  return {
    titleY: Math.round(10 * fs),
    startY: Math.round(40 * fs),
    rowH: Math.max(22, Math.round(30 * fs)),
  };
}

function drawInstructions() {
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(0, 0, screenCss.width, screenCss.height);

  const fs = getUiFontScale();

  ctx.fillStyle = COLOR_TEXT;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `bold ${px(16, fs)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  ctx.fillText("Instructions", 16, Math.round(10 * fs));

  ctx.font = `${px(11, fs)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  const lines = [
    "- Arrow keys to move",
    "- Tap 2/4/6/8 on keypad",
    "- P or * to pause",
    "- Eat food to score",
    "- Don't hit yourself",
    "- Press Enter to go back",
  ];
  const lineHeight = Math.max(12, Math.round(15 * fs));
  const maxW = Math.max(1, screenCss.width - 32);
  let y = Math.round(38 * fs);
  for (let i = 0; i < lines.length; i++) {
    y = drawWrappedText(lines[i], 16, y, maxW, lineHeight);
  }
}

function drawCell(cx, cy, scale = 1) {
  const s = board.cell;
  const x = board.offX + cx * s;
  const y = board.offY + cy * s;
  const pad = Math.floor(((1 - scale) * s) / 2);
  ctx.fillRect(x + pad, y + pad, s - pad * 2, s - pad * 2);
}

function layout() {
  dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const imgW = phoneImg.clientWidth;
  const scale = imgW / DESIGN_SIZE;

  screenCss = {
    left: Math.round(SCREEN_LEFT * scale),
    top: Math.round(SCREEN_TOP * scale),
    width: Math.round(SCREEN_WIDTH * scale),
    height: Math.round(SCREEN_HEIGHT * scale),
  };

  // Canvas position
  canvas.style.left = `${screenCss.left}px`;
  canvas.style.top = `${screenCss.top}px`;
  canvas.style.width = `${screenCss.width}px`;
  canvas.style.height = `${screenCss.height}px`;
  canvas.width = Math.max(1, Math.floor(screenCss.width * dpr));
  canvas.height = Math.max(1, Math.floor(screenCss.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Grid fit
  const availW = Math.max(1, screenCss.width - BOARD_MARGIN_PX * 2);
  const availH = Math.max(1, screenCss.height - BOARD_MARGIN_PX * 2);

  // Account for extra padding (~0.35 cell on each side) so food/snake
  // never visually clip against the LCD bezel.
  const cellX = Math.floor(availW / (GRID_COLS + HALF_FOOD_PAD_CELLS * 2));
  const cellY = Math.floor(availH / (GRID_ROWS + HALF_FOOD_PAD_CELLS * 2));
  const cell = Math.max(8, Math.floor(Math.min(cellX, cellY)));

  const padX = Math.max(0, Math.ceil(cell * HALF_FOOD_PAD_CELLS));
  const padY = Math.max(0, Math.ceil(cell * HALF_FOOD_PAD_CELLS));
  const innerAvailW = Math.max(1, availW - padX * 2);
  const innerAvailH = Math.max(1, availH - padY * 2);

  const w = cell * GRID_COLS;
  const h = cell * GRID_ROWS;
  board = {
    cell,
    w,
    h,
    offX: BOARD_MARGIN_PX + padX + Math.floor((innerAvailW - w) / 2),
    offY: BOARD_MARGIN_PX + padY + Math.floor((innerAvailH - h) / 2),
  };

  // Restart button positioned below the screen
  restartBtn.style.left = `${screenCss.left + Math.floor(screenCss.width / 2) - 60}px`;
  restartBtn.style.top = `${screenCss.top + screenCss.height + Math.round(22 * scale)}px`;

  // Keypad keys
  const placeKey = (el, k) => {
    const w = Math.round((k.w ?? KEY_SIZE) * scale);
    const h = Math.round((k.h ?? KEY_SIZE) * scale);
    const left = Math.round((k.cx - (k.w ?? KEY_SIZE) / 2) * scale);
    const top = Math.round((k.cy - (k.h ?? KEY_SIZE) / 2) * scale);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.borderRadius = `${Math.round(Math.min(w, h) * 0.22)}px`;
    el.style.fontSize = `${Math.max(14, Math.round(Math.min(w, h) * 0.22))}px`;
  };

  placeKey(key2, KEYS["2"]);
  placeKey(key4, KEYS["4"]);
  placeKey(key6, KEYS["6"]);
  placeKey(keyStar, KEYS["*"]);
  placeKey(key8, KEYS["8"]);
}

function frame(ms) {
  if (!lastMs) lastMs = ms;
  const dt = ms - lastMs;
  lastMs = ms;
  accMs += dt;

  if (gameState === "playing") {
    const step = stepMsForScore(score);
    while (accMs >= step) {
      accMs -= step;
      tick();
    }
  }

  draw();
  requestAnimationFrame(frame);
}

function bindInputs() {
  window.addEventListener(
    "keydown",
    (e) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();

      // Global
      if (e.code === "KeyP") {
        togglePause();
        return;
      }

      // Menu navigation
      if (uiScreen === "menu") {
        if (e.code === "ArrowUp") menuIndex = (menuIndex + 2) % 3;
        if (e.code === "ArrowDown") menuIndex = (menuIndex + 1) % 3;
        if (e.code === "Enter" || e.code === "Space") selectMenuItem(menuIndex);
        if (e.code === "Escape") {
          if (gameState === "paused") resumeGame();
        }
        return;
      }

      if (uiScreen === "instructions") {
        if (e.code === "Enter" || e.code === "Escape" || e.code === "Backspace") {
          uiScreen = "menu";
          return;
        }
      }

      // Playing input
      if (gameState === "playing") {
        if (e.code === "ArrowUp") setDirection(0, -1);
        if (e.code === "ArrowDown") setDirection(0, 1);
        if (e.code === "ArrowLeft") setDirection(-1, 0);
        if (e.code === "ArrowRight") setDirection(1, 0);
      }

      if (e.code === "KeyR") {
        startNewGame();
      }
    },
    { passive: false }
  );

  const press = (x, y) => () => setDirection(x, y);
  key2.addEventListener("pointerdown", () => {
    if (gameState === "playing") press(0, -1)();
  });
  key4.addEventListener("pointerdown", () => {
    if (gameState === "playing") press(-1, 0)();
  });
  key6.addEventListener("pointerdown", () => {
    if (gameState === "playing") press(1, 0)();
  });
  key8.addEventListener("pointerdown", () => {
    if (gameState === "playing") press(0, 1)();
  });

  keyStar.addEventListener("pointerdown", () => {
    togglePause();
  });

  restartBtn.addEventListener("pointerdown", () => startNewGame());

  // Menu click support
  canvas.addEventListener("pointerdown", (e) => {
    if (uiScreen !== "menu") return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const fs = getUiFontScale();
    const metrics = getMenuMetrics(fs);
    const startY = metrics.startY;
    const rowH = metrics.rowH;
    const idx = Math.floor((y - startY) / rowH);
    if (x < 0 || x > rect.width) return;
    if (idx < 0 || idx > 2) return;
    menuIndex = idx;
    selectMenuItem(menuIndex);
  });
}

// Bootstrap
phoneImg.src = phoneUrl;
phoneImg.addEventListener("load", () => {
  layout();
});

window.addEventListener("resize", () => layout());
bindInputs();
resetGame();
gameState = "idle";
uiScreen = "menu";
menuIndex = 2;
updateHud();
requestAnimationFrame(frame);
