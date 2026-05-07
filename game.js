const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const scoreNode = document.getElementById("score");
const livesNode = document.getElementById("lives");
const statusNode = document.getElementById("status");

const TILE = 40;
const ROWS = 10;
const COLS = 14;

const mapRows = [
  "##############",
  "#............#",
  "#.####.##.##.#",
  "#.#....##....#",
  "#.#.##....##.#",
  "#....#.##.#..#",
  "#.##.#.##.#.##",
  "#....#....#..#",
  "#.####.##.##.#",
  "##############"
];

const MAP = mapRows.map((row) => row.split(""));
const pelletsTotal = MAP.reduce(
  (sum, row) => sum + row.filter((c) => c === ".").length,
  0
);

const DIRS = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 }
};

const inputMap = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  a: "left",
  d: "right",
  w: "up",
  s: "down"
};

const state = {
  score: 0,
  lives: 3,
  eaten: 0,
  gameOver: false,
  win: false,
  player: { x: 1, y: 1, prevX: 1, prevY: 1, dir: "right", next: "right", mouthTick: 0 },
  ghosts: [
    { x: COLS - 2, y: 1, prevX: COLS - 2, prevY: 1, dir: "left", color: "#ff4f5e" },
    { x: COLS - 2, y: ROWS - 2, prevX: COLS - 2, prevY: ROWS - 2, dir: "up", color: "#67dbff" }
  ]
};

let lastFrame = 0;
let accumulator = 0;
const stepMs = 110;

function resetRound() {
  state.player.x = 1;
  state.player.y = 1;
  state.player.prevX = 1;
  state.player.prevY = 1;
  state.player.dir = "right";
  state.player.next = "right";

  state.ghosts[0].x = COLS - 2;
  state.ghosts[0].y = 1;
  state.ghosts[0].prevX = COLS - 2;
  state.ghosts[0].prevY = 1;
  state.ghosts[0].dir = "left";

  state.ghosts[1].x = COLS - 2;
  state.ghosts[1].y = ROWS - 2;
  state.ghosts[1].prevX = COLS - 2;
  state.ghosts[1].prevY = ROWS - 2;
  state.ghosts[1].dir = "up";
}

function resetGame() {
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      MAP[y][x] = mapRows[y][x];
    }
  }

  state.score = 0;
  state.lives = 3;
  state.eaten = 0;
  state.gameOver = false;
  state.win = false;
  resetRound();
  renderHud();
}

function canMove(x, y) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) {
    return false;
  }
  return MAP[y][x] !== "#";
}

function randomDirectionChoices(x, y) {
  return Object.keys(DIRS).filter((name) => {
    const d = DIRS[name];
    return canMove(x + d.x, y + d.y);
  });
}

function tick() {
  if (state.gameOver || state.win) {
    return;
  }

  const player = state.player;
  player.prevX = player.x;
  player.prevY = player.y;
  const nextDir = DIRS[player.next];

  if (nextDir && canMove(player.x + nextDir.x, player.y + nextDir.y)) {
    player.dir = player.next;
  }

  const move = DIRS[player.dir];
  if (move && canMove(player.x + move.x, player.y + move.y)) {
    player.x += move.x;
    player.y += move.y;
  }

  if (MAP[player.y][player.x] === ".") {
    MAP[player.y][player.x] = " ";
    state.score += 10;
    state.eaten += 1;
  }

  for (const ghost of state.ghosts) {
    ghost.prevX = ghost.x;
    ghost.prevY = ghost.y;
    const candidates = randomDirectionChoices(ghost.x, ghost.y);
    if (candidates.length === 0) {
      continue;
    }

    const straight = DIRS[ghost.dir];
    const canContinue = straight && canMove(ghost.x + straight.x, ghost.y + straight.y);

    if (!canContinue || Math.random() < 0.35) {
      ghost.dir = candidates[Math.floor(Math.random() * candidates.length)];
    }

    const gMove = DIRS[ghost.dir];
    if (gMove && canMove(ghost.x + gMove.x, ghost.y + gMove.y)) {
      ghost.x += gMove.x;
      ghost.y += gMove.y;
    }
  }

  const hit = state.ghosts.some((g) => g.x === player.x && g.y === player.y);
  if (hit) {
    state.lives -= 1;
    if (state.lives <= 0) {
      state.gameOver = true;
      statusNode.textContent = "Поражение";
    } else {
      resetRound();
      statusNode.textContent = "Осторожно!";
    }
  } else if (state.eaten >= pelletsTotal) {
    state.win = true;
    statusNode.textContent = "Победа";
  } else {
    statusNode.textContent = "Играем";
  }

  player.mouthTick += 1;
  renderHud();
}

function drawMap() {
  ctx.fillStyle = "#05070f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const tile = MAP[y][x];
      const px = x * TILE;
      const py = y * TILE;

      if (tile === "#") {
        ctx.fillStyle = "#273b8a";
        ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
      } else if (tile === ".") {
        ctx.fillStyle = "#ffd66d";
        ctx.beginPath();
        ctx.arc(px + TILE / 2, py + TILE / 2, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function lerp(from, to, alpha) {
  return from + (to - from) * alpha;
}

function drawPacman(alpha) {
  const p = state.player;
  const ix = lerp(p.prevX, p.x, alpha);
  const iy = lerp(p.prevY, p.y, alpha);
  const cx = ix * TILE + TILE / 2;
  const cy = iy * TILE + TILE / 2;

  const mouthPhase = (p.mouthTick % 8) / 8;
  const mouth = 0.2 + Math.sin(mouthPhase * Math.PI) * 0.45;

  const angleByDir = {
    right: 0,
    left: Math.PI,
    up: -Math.PI / 2,
    down: Math.PI / 2
  };
  const baseAngle = angleByDir[p.dir] || 0;

  ctx.fillStyle = "#ffd12f";
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, TILE / 2 - 5, baseAngle + mouth, baseAngle - mouth + Math.PI * 2);
  ctx.closePath();
  ctx.fill();
}

function drawGhost(ghost, alpha) {
  const ix = lerp(ghost.prevX, ghost.x, alpha);
  const iy = lerp(ghost.prevY, ghost.y, alpha);
  const x = ix * TILE;
  const y = iy * TILE;
  const r = TILE / 2 - 5;
  const cx = x + TILE / 2;
  const cy = y + TILE / 2 - 2;

  ctx.fillStyle = ghost.color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.lineTo(cx + r, y + TILE - 6);
  ctx.lineTo(cx + r / 2, y + TILE - 12);
  ctx.lineTo(cx, y + TILE - 6);
  ctx.lineTo(cx - r / 2, y + TILE - 12);
  ctx.lineTo(cx - r, y + TILE - 6);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(cx - 7, cy - 2, 4, 0, Math.PI * 2);
  ctx.arc(cx + 7, cy - 2, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#24315c";
  ctx.beginPath();
  ctx.arc(cx - 7, cy - 2, 2, 0, Math.PI * 2);
  ctx.arc(cx + 7, cy - 2, 2, 0, Math.PI * 2);
  ctx.fill();
}

function drawOverlay() {
  if (!state.gameOver && !state.win) {
    return;
  }

  ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = "bold 40px Arial";
  ctx.fillText(state.win ? "YOU WIN" : "GAME OVER", canvas.width / 2, canvas.height / 2 - 10);

  ctx.font = "20px Arial";
  ctx.fillText("Нажмите R для новой игры", canvas.width / 2, canvas.height / 2 + 30);
}

function renderHud() {
  scoreNode.textContent = String(state.score);
  livesNode.textContent = String(state.lives);
}

function render(alpha) {
  drawMap();
  drawPacman(alpha);
  for (const ghost of state.ghosts) {
    drawGhost(ghost, alpha);
  }
  drawOverlay();
}

function loop(ts) {
  if (!lastFrame) {
    lastFrame = ts;
  }

  accumulator += ts - lastFrame;
  lastFrame = ts;

  while (accumulator >= stepMs) {
    tick();
    accumulator -= stepMs;
  }

  const alpha = Math.min(accumulator / stepMs, 1);
  render(alpha);
  requestAnimationFrame(loop);
}

window.addEventListener("keydown", (event) => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === "r") {
    resetGame();
    return;
  }

  const dir = inputMap[key];
  if (dir) {
    state.player.next = dir;
    event.preventDefault();
  }
});

resetGame();
requestAnimationFrame(loop);
