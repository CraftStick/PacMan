/* ============================================================
   maze.js — парсинг карты этажа и пиксель-арт отрисовка.
   Поддерживает 4 темы (lobby / classroom / lab / deanery),
   односторонние двери-турникеты `<>^v`,
   туннельные тайлы (символ `-`) и анимированные мониторы.
   ============================================================ */

(function (global) {
  'use strict';
  const {
    ROWS, COLS, TILE, COLORS,
    DIR, tileCenter, sameDir,
  } = global.App;

  // Направления для oneway
  const ONEWAY_DIR = {
    '>': DIR.RIGHT,
    '<': DIR.LEFT,
    '^': DIR.UP,
    'v': DIR.DOWN,
  };

  // Текстурная палитра для signWood/signGold (дверь «КАФ»)
  const DOOR_COLORS = {
    wood:    '#6b3a1f',
    edge:    '#3a1f10',
    gold:    '#f2c94c',
  };

  class Maze {
    // floor — объект из floors.js
    constructor(floor) {
      this.floor      = floor;
      this.theme      = floor.theme;
      this.features   = floor.features || {};
      this.difficulty = floor.difficulty;
      this.layout     = floor.layout;

      this.grid            = [];          // 0 пусто, 1 стена, 2 дверь, 3 oneway
      this.onewayDir       = {};          // key = r*COLS+c  →  DIR (разрешённое направление)
      this.tunnels         = new Set();   // key = r*COLS+c — клетки-туннели
      this.pellets         = [];
      this.ghostHouseDoor  = null;
      this.ghostHouse      = [];          // клетки стартовых позиций призраков
      this.pacmanStart     = { r: 23, c: 14 };
      this.totalPellets    = 0;

      this._parse();

      // Ленивые паттерны (создаются при первом render когда есть ctx)
      this._wallPattern  = null;
      this._floorPattern = null;

      // Декорации стен
      this.decorations = this._generateDecorations();
    }

    _parse() {
      for (let r = 0; r < ROWS; r++) {
        const row = [];
        const pr  = [];
        for (let c = 0; c < COLS; c++) {
          const ch = this.layout[r][c];
          if (ch === '#') {
            row.push(1);
          } else if (ch === '=') {
            row.push(2);
            // запоминаем самую левую из «=» клеток
            if (!this.ghostHouseDoor) this.ghostHouseDoor = { r, c };
          } else if (ONEWAY_DIR[ch]) {
            row.push(3);
            this.onewayDir[r * COLS + c] = ONEWAY_DIR[ch];
          } else {
            row.push(0);
            if (ch === '-') this.tunnels.add(r * COLS + c);
          }

          if (ch === '.')      { pr.push(1); this.totalPellets++; }
          else if (ch === 'o') { pr.push(2); this.totalPellets++; }
          else                   pr.push(0);

          if (ch === 'P') this.pacmanStart = { r, c };
          if (ch === 'G') this.ghostHouse.push({ r, c });
        }
        this.grid.push(row);
        this.pellets.push(pr);
      }
      this.pelletsLeft = this.totalPellets;
      // Замечание: тайлы-туннели задаются явно символом `-` в layout.
      // На этажах без `-` (например, деканат) туннелей нет — призраки
      // нигде не замедляются, и Пакман никуда не спрячется.
    }

    // moveDir (опционально) — в каком направлении сущность хочет зайти в клетку (r,c).
    // Нужен для oneway-турникетов: заход «против шерсти» считается стеной.
    isWall(r, c, canPassDoor = false, moveDir) {
      if (r < 0 || r >= ROWS) return true;
      if (c < 0 || c >= COLS) return false; // туннельная обёртка по X
      const v = this.grid[r][c];
      if (v === 1) return true;
      if (v === 2) return !canPassDoor;
      if (v === 3) {
        if (!moveDir) return false; // без направления (например, bonus eat) — проходимо
        const allowed = this.onewayDir[r * COLS + c];
        if (!allowed) return false;
        return !sameDir(moveDir, allowed);
      }
      return false;
    }

    isWallCell(r, c) {
      return r >= 0 && r < ROWS && c >= 0 && c < COLS && this.grid[r][c] === 1;
    }

    isTunnel(r, c) {
      if (r < 0 || r >= ROWS) return false;
      if (c < 0 || c >= COLS) return true; // туннельная обёртка
      return this.tunnels.has(r * COLS + c);
    }

    reset() {
      this.totalPellets = 0;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const ch = this.layout[r][c];
          if (ch === '.')      { this.pellets[r][c] = 1; this.totalPellets++; }
          else if (ch === 'o') { this.pellets[r][c] = 2; this.totalPellets++; }
          else                   this.pellets[r][c] = 0;
        }
      }
      this.pelletsLeft = this.totalPellets;
    }

    eatAt(r, c, pacmanX, pacmanY) {
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return 0;
      const p = this.pellets[r][c];
      if (!p) return 0;
      const ct = tileCenter(r, c);
      if (Math.hypot(pacmanX - ct.x, pacmanY - ct.y) > TILE * 0.45) return 0;
      this.pellets[r][c] = 0;
      this.pelletsLeft--;
      return p;
    }

    // ===== ОТРИСОВКА =====
    render(ctx, time) {
      if (!this._wallPattern) this._buildPatterns(ctx);
      this._renderFloor(ctx);
      this._renderFloorMarker(ctx);
      this._renderWalls(ctx);
      this._renderDecorations(ctx, time);
      this._renderOneWayDoors(ctx, time);
      this._renderDoor(ctx, time);
      this._renderPellets(ctx, time);
    }

    _buildPatterns(ctx) {
      this._wallPattern  = buildWallPattern(ctx, this.theme);
      this._floorPattern = buildFloorPattern(ctx, this.theme);
    }

    _renderFloor(ctx) {
      ctx.fillStyle = this._floorPattern;
      ctx.fillRect(0, 0, COLS * TILE, ROWS * TILE);
    }

    // Крупная надпись «N ЭТАЖ» на полу — одна на всю карту (текущий этаж)
    _renderFloorMarker(ctx) {
      const W = COLS * TILE;
      const label = `${this.floor.id} ЭТАЖ`;
      const y = ROWS * TILE / 2;

      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 20px "Roboto", sans-serif';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillText(label, W / 2 + 2, y + 2);
      ctx.fillStyle = `rgba(${hexToRgb(this.theme.accent)}, 0.22)`;
      ctx.fillText(label, W / 2, y);
      ctx.restore();
    }

    _generateDecorations() {
      const decor = [];
      const density = (this.theme.decor && this.theme.decor.density) || 40;

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (this.grid[r][c] !== 1) continue;

          const sides = [];
          if (!this.isWallCell(r - 1, c) && (this.grid[r - 1]?.[c] ?? 0) !== 2) sides.push('top');
          if (!this.isWallCell(r + 1, c) && (this.grid[r + 1]?.[c] ?? 0) !== 2) sides.push('bottom');
          if (!this.isWallCell(r, c - 1) && (this.grid[r]?.[c - 1] ?? 0) !== 2) sides.push('left');
          if (!this.isWallCell(r, c + 1) && (this.grid[r]?.[c + 1] ?? 0) !== 2) sides.push('right');
          if (sides.length === 0) continue;

          const h = hash(r, c);
          const chance = h % 100;
          if (chance >= density) continue;

          // Распределение типов — зависит от темы
          const type = pickDecorType(this.theme, chance, h);
          // Для «висящих» на грани объектов предпочитаем нижнюю грань стены,
          // чтобы провода/лампы/ТВ смотрели в коридор (свет падает вниз).
          let side;
          if (type === 'wire' || type === 'lamp' || type === 'monitor') {
            side = sides.includes('bottom') ? 'bottom'
                 : sides.includes('top')    ? 'top'
                 : sides[0];
          } else {
            side = sides[h % sides.length];
          }

          decor.push({ r, c, side, type, seed: h });
        }
      }
      return decor;
    }

    _renderDecorations(ctx, time) {
      for (const d of this.decorations) {
        const x = d.c * TILE, y = d.r * TILE;
        switch (d.type) {
          case 'wire':    drawWire(ctx, x, y, d.side, d.seed, time); break;
          case 'lamp':    drawLamp(ctx, x, y, d.side, d.seed, time, this.theme); break;
          case 'monitor': drawMonitor(ctx, x, y, d.side, d.seed, time); break;
          case 'hole':    drawHole(ctx, x, y, d.seed); break;
          case 'crack':   drawCrack(ctx, x, y, d.seed); break;
          case 'stain':   drawStain(ctx, x, y, d.seed); break;
          case 'poster':  drawPoster(ctx, x, y, d.seed, this.theme); break;
        }
      }
    }

    _renderWalls(ctx) {
      ctx.fillStyle = this._wallPattern;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (this.grid[r][c] !== 1) continue;
          ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
        }
      }

      // Тёмный 1px контур между стенами и коридором
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
      ctx.lineWidth = 1;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (this.grid[r][c] !== 1) continue;
          const x = c * TILE, y = r * TILE;
          if (!this.isWallCell(r - 1, c) && (this.grid[r - 1]?.[c] ?? 0) !== 2) edge(ctx, x, y, x + TILE, y);
          if (!this.isWallCell(r + 1, c) && (this.grid[r + 1]?.[c] ?? 0) !== 2) edge(ctx, x, y + TILE, x + TILE, y + TILE);
          if (!this.isWallCell(r, c - 1) && (this.grid[r]?.[c - 1] ?? 0) !== 2) edge(ctx, x, y, x, y + TILE);
          if (!this.isWallCell(r, c + 1) && (this.grid[r]?.[c + 1] ?? 0) !== 2) edge(ctx, x + TILE, y, x + TILE, y + TILE);
        }
      }
      ctx.restore();
    }

    _renderOneWayDoors(ctx, time) {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (this.grid[r][c] !== 3) continue;
          const dir = this.onewayDir[r * COLS + c];
          drawTurnstile(ctx, c * TILE, r * TILE, dir, time);
        }
      }
    }

    _renderDoor(ctx) {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (this.grid[r][c] !== 2) continue;
          const x = c * TILE, y = r * TILE;
          ctx.fillStyle = DOOR_COLORS.wood;
          ctx.fillRect(x, y + 4, TILE, TILE - 8);
          ctx.fillStyle = DOOR_COLORS.edge;
          ctx.fillRect(x, y + 4, TILE, 1);
          ctx.fillRect(x, y + TILE - 5, TILE, 1);
        }
      }
      if (this.ghostHouseDoor) {
        // Метка двери отключена по запросу: без текстовой надписи.
      }
    }

    _renderPellets(ctx, time) {
      const theme = this.theme;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const p = this.pellets[r][c];
          if (!p) continue;
          const cx = c * TILE + TILE / 2;
          const cy = r * TILE + TILE / 2;

          if (p === 1) {
            drawPellet(ctx, cx, cy, theme.pellet);
          } else if (p === 2) {
            const pulse = 0.8 + 0.2 * Math.sin(time / 200);
            ctx.save();
            ctx.globalAlpha = pulse;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = '14px "Roboto", sans-serif';
            ctx.fillText(theme.power.emoji, cx, cy);
            ctx.restore();
          }
        }
      }
    }
  }

  // =================== ХЕЛПЕРЫ ===================

  function hash(r, c) {
    let h = (r * 73856093) ^ (c * 19349663);
    h = Math.imul(h ^ (h >>> 13), 1540483477);
    h = (h ^ (h >>> 15)) >>> 0;
    return h;
  }

  function edge(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function hexToRgb(hex) {
    if (!hex || hex[0] !== '#') return '255, 255, 255';
    const s = hex.slice(1);
    const r = parseInt(s.substring(0, 2), 16);
    const g = parseInt(s.substring(2, 4), 16);
    const b = parseInt(s.substring(4, 6), 16);
    return `${r}, ${g}, ${b}`;
  }

  // =================== ДЕКОР: ВЫБОР ТИПА ===================

  // Вероятности декора после удаления граффити. ТВ и лампы теперь есть
  // на всех этажах. Лампочки доминируют (пользователь хочет «много света»),
  // провода/ТВ работают как акценты, остальные — фоновая потёртость стен.
  function pickDecorType(theme, chance, h) {
    const density = (theme.decor && theme.decor.density) || 40;
    const p = chance / density; // 0..1 — нормированный бакет плотности

    if (p < 0.45) return 'lamp';      // 45% — много ламп, этаж всегда освещён
    if (p < 0.65) return 'wire';      // 20% — искрящиеся кабели
    if (p < 0.78) return 'monitor';   // 13% — ТВ с белым шумом
    if (p < 0.86) return 'hole';
    if (p < 0.92) return 'crack';
    if (p < 0.97) return 'stain';
    return 'poster';
  }

  // =================== ДЕКОР: ПРОВОДА ===================
  //
  // Провода ВСЕГДА рисуются в пределах тайла стены (2–3 px полоса вдоль
  // грани, смотрящей в коридор). Они НЕ заходят в проход — Пакман и его
  // дорожка всегда чётко видны. Искры вспыхивают периодически поверх.
  function drawWire(ctx, x, y, side, seed, time) {
    ctx.save();

    // Цвет изоляции — тёмный, чтобы не сливался с большинством стен.
    const insul = ['#0c0c0c', '#2a0f0f', '#0f2a1a', '#0f1a2e'][(seed >> 3) & 3];
    ctx.fillStyle = insul;

    // Координаты кабеля на грани стены (толщина 2 px, отступ 1 px от края тайла).
    let cableX, cableY, cableW, cableH;
    // Точка искры вдоль кабеля (в середине, смещение по seed).
    let sparkX, sparkY;

    switch (side) {
      case 'bottom': {
        cableX = x;          cableY = y + TILE - 3;
        cableW = TILE;       cableH = 2;
        sparkX = x + 3 + ((seed >> 2) & 7);
        sparkY = cableY - 1;
        break;
      }
      case 'top': {
        cableX = x;          cableY = y + 1;
        cableW = TILE;       cableH = 2;
        sparkX = x + 3 + ((seed >> 2) & 7);
        sparkY = cableY + 2;
        break;
      }
      case 'left': {
        cableX = x + 1;      cableY = y;
        cableW = 2;          cableH = TILE;
        sparkX = cableX + 2;
        sparkY = y + 3 + ((seed >> 2) & 7);
        break;
      }
      case 'right': {
        cableX = x + TILE - 3; cableY = y;
        cableW = 2;            cableH = TILE;
        sparkX = cableX - 1;
        sparkY = y + 3 + ((seed >> 2) & 7);
        break;
      }
      default:
        ctx.restore();
        return;
    }

    // Кабель + тёмная обводка снизу (даёт глубину на любом фоне стены).
    ctx.fillRect(cableX, cableY, cableW, cableH);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    if (side === 'bottom' || side === 'top') {
      ctx.fillRect(cableX, cableY + cableH, cableW, 1);
    } else {
      ctx.fillRect(cableX + cableW, cableY, 1, cableH);
    }

    // Искрение: детерминированный цикл по времени × seed.
    // «Вспышка» длится ~80 мс каждые ~400–800 мс, иначе только тлеющая точка.
    const cycle = 500 + (seed % 400);            // мс
    const phase = ((time + seed * 37) % cycle) / cycle;
    const sparking = phase < 0.18;
    if (sparking) {
      // Яркое ядро + горячий ореол.
      const flick = Math.floor(time / 40) & 1;
      ctx.fillStyle = flick ? '#fff0a0' : '#ffffff';
      ctx.fillRect(sparkX, sparkY, 1, 1);
      ctx.fillStyle = '#ffbd4a';
      ctx.fillRect(sparkX - 1, sparkY, 1, 1);
      ctx.fillRect(sparkX + 1, sparkY, 1, 1);
      ctx.fillRect(sparkX, sparkY - 1, 1, 1);
      ctx.fillRect(sparkX, sparkY + 1, 1, 1);
      // «Брызги» искр — мелкие точки вокруг (не заходят за грань тайла).
      ctx.fillStyle = '#ff8820';
      const spl = [[-2, -1], [2, -1], [-1, 1], [1, 1]];
      for (const [dx, dy] of spl) {
        const px = sparkX + dx, py = sparkY + dy;
        if (px >= x && px < x + TILE && py >= y && py < y + TILE) {
          ctx.fillRect(px, py, 1, 1);
        }
      }
    } else {
      // В «простое» — тусклая красная точка (намёк на искру).
      ctx.fillStyle = '#7a1a10';
      ctx.fillRect(sparkX, sparkY, 1, 1);
    }

    ctx.restore();
  }

  // =================== ДЕКОР: ЛАМПОЧКА (бра) ===================
  //
  // Маленький настенный светильник: металлический держатель и тёплый
  // мерцающий круглый плафон. Полностью в пределах тайла стены, но
  // отбрасывает мягкий полупрозрачный halo, слегка «подсвечивающий»
  // прилегающий пол — halo ограничен клеткой-соседом по alpha, чтобы
  // не закрывать пеллеты.
  function drawLamp(ctx, x, y, side, seed, time, theme) {
    const tint = (theme.decor && theme.decor.lampTint) || '#ffe6a3';

    // «Ритм» мерцания: у 1/6 ламп — частый флик (перегорает), остальные — ровный свет.
    const flicker = ((seed & 7) === 0);
    const phase   = (time + seed * 17) / 1000;
    let brightness;
    if (flicker) {
      const f = Math.sin(phase * 7.1) + Math.sin(phase * 3.3);
      brightness = 0.55 + 0.45 * (f > 0.3 ? 1 : (f > -0.5 ? 0.7 : 0.3));
    } else {
      brightness = 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(phase * 2.2));
    }

    // Позиция лампы на выбранной стороне — всегда внутри тайла.
    let bulbX, bulbY, armX1, armY1, armX2, armY2, haloDir;
    switch (side) {
      case 'bottom': {
        bulbX = x + 8;           bulbY = y + TILE - 3;
        armX1 = bulbX;           armY1 = y + TILE - 6;
        armX2 = bulbX;           armY2 = bulbY;
        haloDir = { dx: 0, dy: 1 };
        break;
      }
      case 'top': {
        bulbX = x + 8;           bulbY = y + 3;
        armX1 = bulbX;           armY1 = y + 6;
        armX2 = bulbX;           armY2 = bulbY;
        haloDir = { dx: 0, dy: -1 };
        break;
      }
      case 'left': {
        bulbX = x + 3;           bulbY = y + 8;
        armX1 = x + 6;           armY1 = bulbY;
        armX2 = bulbX;           armY2 = bulbY;
        haloDir = { dx: -1, dy: 0 };
        break;
      }
      case 'right': {
        bulbX = x + TILE - 3;    bulbY = y + 8;
        armX1 = x + TILE - 6;    armY1 = bulbY;
        armX2 = bulbX;           armY2 = bulbY;
        haloDir = { dx: 1, dy: 0 };
        break;
      }
      default: return;
    }

    ctx.save();

    // Мягкий halo — пиксель-арт радиальный «крестик» вне стены.
    // Alpha низкий → пеллеты/пакман отчётливо видны сквозь свет.
    const haloA = 0.22 + 0.18 * brightness;
    const haloX = bulbX + haloDir.dx * 3;
    const haloY = bulbY + haloDir.dy * 3;
    ctx.fillStyle = `rgba(${hexToRgb(tint)}, ${haloA.toFixed(2)})`;
    // «Крест» 5×5 без углов — имитирует круглый глоу.
    const halo = [
      [0, -2], [-1, -1], [0, -1], [1, -1],
      [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0],
      [-1, 1], [0, 1], [1, 1], [0, 2],
    ];
    for (const [dx, dy] of halo) {
      ctx.fillRect(haloX + dx, haloY + dy, 1, 1);
    }
    // Дополнительное тусклое эхо во второй ряд — создаёт ощущение пятна света.
    ctx.fillStyle = `rgba(${hexToRgb(tint)}, ${(haloA * 0.4).toFixed(2)})`;
    const haloOut = [
      [0, -3], [-3, 0], [3, 0], [0, 3],
      [-2, -1], [2, -1], [-2, 1], [2, 1],
      [-1, -2], [1, -2], [-1, 2], [1, 2],
    ];
    for (const [dx, dy] of haloOut) {
      ctx.fillRect(haloX + dx, haloY + dy, 1, 1);
    }

    // Держатель (ножка/кронштейн) — тёмный металл.
    ctx.fillStyle = '#1a1a1a';
    if (armX1 === armX2) ctx.fillRect(armX1, Math.min(armY1, armY2), 1, Math.abs(armY2 - armY1) + 1);
    else                  ctx.fillRect(Math.min(armX1, armX2), armY1, Math.abs(armX2 - armX1) + 1, 1);
    // Крепёж к стене (2×2 пластина).
    ctx.fillRect(armX1 - 1, armY1 - 1, 2, 2);

    // Плафон: ореол → стекло → сердцевина.
    const glowA = (0.45 + 0.35 * brightness).toFixed(2);
    ctx.fillStyle = `rgba(${hexToRgb(tint)}, ${glowA})`;
    ctx.fillRect(bulbX - 2, bulbY - 1, 5, 3);
    ctx.fillRect(bulbX - 1, bulbY - 2, 3, 5);

    ctx.fillStyle = tint;
    ctx.fillRect(bulbX - 1, bulbY - 1, 3, 3);

    // Раскалённая нить (белая точка), дрожит по brightness.
    ctx.fillStyle = brightness > 0.7 ? '#ffffff' : '#ffe8a8';
    ctx.fillRect(bulbX, bulbY, 1, 1);

    ctx.restore();
  }

  // =================== ДЕКОР: ДЫРА ===================

  function drawHole(ctx, x, y, seed) {
    const w = 4 + (seed & 3);
    const h = 3 + ((seed >> 2) & 3);
    const px = x + 2 + ((seed >> 4) % (TILE - w - 4));
    const py = y + 3 + ((seed >> 7) % (TILE - h - 6));

    ctx.save();
    ctx.fillStyle = '#050505';
    ctx.fillRect(px, py, w, h);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(px + w, py + 1, 1, 1);
    ctx.fillRect(px - 1, py + h - 1, 1, 1);
    ctx.fillStyle = '#3a2418';
    ctx.fillRect(px + 1, py + h, 2, 1);
    ctx.fillRect(px + w - 2, py + h, 1, 1);
    ctx.restore();
  }

  // =================== ДЕКОР: ТРЕЩИНА ===================

  function drawCrack(ctx, x, y, seed) {
    ctx.save();
    ctx.strokeStyle = '#0a0504';
    ctx.lineWidth = 1;
    ctx.beginPath();
    let cx = x + 2 + (seed % 4);
    let cy = y + 2 + ((seed >> 4) % 4);
    ctx.moveTo(cx, cy);
    for (let i = 0; i < 5; i++) {
      cx += 1 + ((seed >> (i * 2 + 1)) & 1);
      cy += 1 + ((seed >> (i * 3 + 2)) & 1);
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.restore();
  }

  // =================== ДЕКОР: ПЯТНО ===================

  function drawStain(ctx, x, y, seed) {
    ctx.save();
    const ox = seed & 5;
    const oy = (seed >> 3) & 3;
    ctx.fillStyle = 'rgba(10, 18, 8, 0.55)';
    const dots = [[2, 3], [3, 3], [4, 2], [5, 3], [3, 4], [4, 4], [5, 4], [4, 5], [6, 4]];
    for (const [dx, dy] of dots) ctx.fillRect(x + dx + ox, y + dy + oy, 1, 1);
    ctx.fillStyle = 'rgba(40, 80, 30, 0.55)';
    ctx.fillRect(x + 3 + ox, y + 3 + oy, 1, 1);
    ctx.fillRect(x + 5 + ox, y + 4 + oy, 1, 1);
    ctx.restore();
  }

  // =================== ДЕКОР: ОБЪЯВЛЕНИЕ ===================

  function drawPoster(ctx, x, y, seed, theme) {
    // цвет бумаги берётся из палитры декора или стандартной
    const papers = (theme.decor && theme.decor.posterColors)
                || ['#f4e9c1', '#e9d4a4', '#f0c4c4', '#cfe4b8'];
    const paper = papers[seed % papers.length];
    const w = 6, h = 8;
    const px = x + 2 + ((seed >> 2) % Math.max(1, TILE - w - 4));
    const py = y + 2 + ((seed >> 6) % Math.max(1, TILE - h - 4));

    ctx.save();
    const angle = ((((seed >> 10) & 7) - 3) * Math.PI) / 180;
    ctx.translate(px + w / 2, py + h / 2);
    ctx.rotate(angle);

    ctx.fillStyle = paper;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = 'rgba(30, 20, 10, 0.8)';
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(-w / 2 + 1, -h / 2 + 2 + i * 2, w - 2, 1);
    }
    ctx.fillStyle = paper;
    ctx.fillRect(-w / 2, h / 2 - 1, 2, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(-w / 2 + 3, h / 2 - 1, 1, 1);
    ctx.fillStyle = '#ff2c2c';
    ctx.fillRect(-1, -h / 2 - 1, 2, 2);
    ctx.fillStyle = '#ff8a8a';
    ctx.fillRect(-1, -h / 2 - 1, 1, 1);
    ctx.restore();
  }

  // =================== ДЕКОР: ТЕЛЕВИЗОР (белый шум) ===================
  //
  // Старый настенный ЭЛТ-ТВ с аналоговым «снегом». Целиком помещается в
  // тайл стены. Экран — ч/б псевдо-случайные пиксели, меняются каждый
  // кадр (детерминированно от времени + seed, чтобы не «плыло» целиком).
  function drawMonitor(ctx, x, y, side, seed, time) {
    // Корпус 12×9 располагается у выбранной грани стены (всегда в тайле).
    const w = 12, h = 9;
    let px, py;
    switch (side) {
      case 'top':    px = x + (TILE - w) / 2 | 0; py = y + 1;           break;
      case 'left':   px = x + 1;                 py = y + (TILE - h) / 2 | 0; break;
      case 'right':  px = x + TILE - w - 1;      py = y + (TILE - h) / 2 | 0; break;
      case 'bottom':
      default:       px = x + (TILE - w) / 2 | 0; py = y + TILE - h - 1;
    }

    ctx.save();

    // Корпус ТВ — тёмный пластик + тонкая обводка.
    ctx.fillStyle = '#0a0a0d';
    ctx.fillRect(px, py, w, h);
    ctx.fillStyle = '#1a1a20';
    ctx.fillRect(px, py, w, 1);                  // верхняя кромка
    ctx.fillRect(px, py + h - 1, w, 1);          // нижняя
    ctx.fillRect(px, py, 1, h);                  // левая
    ctx.fillRect(px + w - 1, py, 1, h);          // правая

    // Экран — тёмно-серый ч/б.
    const sx = px + 1, sy = py + 1;
    const sw = w - 2, sh = h - 3;
    ctx.fillStyle = '#151515';
    ctx.fillRect(sx, sy, sw, sh);

    // Белый шум: на каждый пиксель детерминируем яркость по (time, seed, x, y).
    // Обновляется ~25 раз в секунду (time / 40) — читается как аналоговый статик.
    const frame = Math.floor(time / 40);
    for (let j = 0; j < sh; j++) {
      for (let i = 0; i < sw; i++) {
        // Быстрый PRNG по смешиванию индексов. Достаточно «шумный».
        let n = (frame * 2654435761) ^ (seed * 374761393) ^
                (i * 668265263)  ^ (j * 2246822519);
        n = (n ^ (n >>> 13)) >>> 0;
        const v = n & 255;
        // 3 градации серого — чтобы пиксели были читаемо разные.
        let g;
        if (v < 90)       g = '#2a2a2a';
        else if (v < 180) g = '#7a7a7a';
        else              g = '#e4e4e4';
        ctx.fillStyle = g;
        ctx.fillRect(sx + i, sy + j, 1, 1);
      }
    }

    // Горизонтальная «помеха» — тонкая полоса, бегущая сверху вниз.
    const rollY = sy + ((frame + (seed & 7)) % sh);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(sx, rollY, sw, 1);

    // Подставка и индикатор питания под экраном.
    ctx.fillStyle = '#0a0a0d';
    ctx.fillRect(px + 2, py + h - 2, w - 4, 1);
    ctx.fillStyle = (frame & 1) ? '#ff4030' : '#a02010';
    ctx.fillRect(px + w - 2, py + h - 2, 1, 1);

    // Блик на «стекле» экрана — диагональный светлый пиксель.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fillRect(sx + 1, sy + 1, 1, 1);

    ctx.restore();
  }

  // =================== ДЕКОР: ТУРНИКЕТ (oneway-дверь) ===================

  function drawTurnstile(ctx, x, y, dir, time) {
    // рисуем «пол» — ничего не нужно, пол уже отрисован
    const cx = x + TILE / 2;
    const cy = y + TILE / 2;

    // Пульсация зелёного (разрешено проходить)
    const pulse = 0.5 + 0.5 * Math.sin(time / 300);
    const green = `rgba(64, 255, 154, ${0.5 + pulse * 0.4})`;
    const base  = 'rgba(20, 40, 30, 0.7)';

    ctx.save();
    // подложка-цоколь турникета: широкая полоса поперёк направления
    ctx.fillStyle = base;
    if (dir.y === 0) {
      // горизонтальное движение → рисуем вертикальные штанги слева/справа
      ctx.fillRect(x + 2, y + 4, 1, TILE - 8);
      ctx.fillRect(x + TILE - 3, y + 4, 1, TILE - 8);
    } else {
      ctx.fillRect(x + 4, y + 2, TILE - 8, 1);
      ctx.fillRect(x + 4, y + TILE - 3, TILE - 8, 1);
    }

    // Стрелка направления
    ctx.fillStyle = green;
    drawArrow(ctx, cx, cy, dir);

    // маленький «LED» индикатор
    ctx.fillStyle = (Math.sin(time / 220) > 0) ? '#b6ff33' : '#207a33';
    ctx.fillRect(x + 2, y + 2, 1, 1);
    ctx.fillRect(x + TILE - 3, y + TILE - 3, 1, 1);
    ctx.restore();
  }

  // Пиксельная стрелка 5x5 в заданном направлении
  function drawArrow(ctx, cx, cy, dir) {
    // шаблон — вверх-стрелка, потом поворачиваем
    ctx.save();
    ctx.translate(cx, cy);
    if (dir.x === 1) ctx.rotate(Math.PI / 2);
    else if (dir.x === -1) ctx.rotate(-Math.PI / 2);
    else if (dir.y === 1) ctx.rotate(Math.PI);
    // иначе up (default, поворот не нужен)

    // «стрелка вверх» из пикселей:
    //     x
    //    xxx
    //   xxxxx
    //     x
    //     x
    ctx.fillRect(-0.5, -4, 1, 1); // вершина
    ctx.fillRect(-1.5, -3, 3, 1);
    ctx.fillRect(-2.5, -2, 5, 1);
    ctx.fillRect(-0.5, -1, 1, 3); // древко
    ctx.restore();
  }

  // =================== ПЕЛЛЕТ-РИСОВАЛКИ ПО ТЕМЕ ===================

  function drawPellet(ctx, cx, cy, pelletCfg) {
    const kind = (pelletCfg && pelletCfg.kind) || 'dot';
    const color = (pelletCfg && pelletCfg.color) || '#fff';
    ctx.save();
    ctx.fillStyle = color;
    switch (kind) {
      case 'dot':
        ctx.fillRect(cx - 1, cy - 1, 2, 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx - 1, cy - 1, 1, 1);
        break;
      case 'note':
        // «конспект» — 3x3 бумажка с полоской
        ctx.fillRect(cx - 1, cy - 1, 3, 3);
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(cx - 1, cy, 3, 1);
        break;
      case 'chip':
        // «флешка» — маленький бирюзовый чип с «ножкой»
        ctx.fillRect(cx - 1, cy - 1, 2, 2);
        ctx.fillStyle = '#16a37a';
        ctx.fillRect(cx - 1, cy + 1, 2, 1);
        break;
      case 'doc':
        // «документ» — кремовый прямоугольник + тень
        ctx.fillRect(cx - 1, cy - 1, 3, 3);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(cx - 1, cy + 2, 3, 1);
        break;
      case 'dish':
        // «блюдо» — круглая тарелочка с золотым ободком
        ctx.fillStyle = '#fff4d0';
        ctx.fillRect(cx - 2, cy - 1, 4, 2);
        ctx.fillStyle = color;
        ctx.fillRect(cx - 1, cy, 2, 1);
        ctx.fillStyle = '#ff8a20';
        ctx.fillRect(cx, cy - 1, 1, 1);
        break;
      default:
        ctx.fillRect(cx - 1, cy - 1, 2, 2);
    }
    ctx.restore();
  }

  // =================== ПАТТЕРНЫ СТЕН И ПОЛА ===================

  // Универсальный билдер стены: рисует узор по типу темы, цвета из theme.wall.
  function buildWallPattern(ctx, theme) {
    const size = 16;
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const p = cv.getContext('2d');
    const w = theme.wall;

    // фон = затирка/грунт
    p.fillStyle = w.grout;
    p.fillRect(0, 0, size, size);

    switch (theme.type) {
      case 'lobby':      drawPlasterTiles(p, w); break;
      case 'classroom':  drawBricks(p, w);       break;
      case 'lab':        drawRivets(p, w);       break;
      case 'deanery':    drawWoodPanels(p, w);   break;
      case 'cafeteria':  drawKitchenTiles(p, w); break;
      default:           drawBricks(p, w);
    }

    return ctx.createPattern(cv, 'repeat');
  }

  // Кирпичи в английской перевязке (классическая шарага)
  function drawBricks(p, w) {
    const rowH = 4;
    const brickW = 7;
    const size = 16;
    for (let row = 0; row < size / rowH; row++) {
      const y = row * rowH;
      const offset = (row % 2 === 0) ? 0 : brickW / 2;
      for (let x = -brickW; x < size + brickW; x += brickW + 1) {
        const bx = Math.round(x + offset);
        const base = ((row * 7 + bx) % 5 === 0) ? w.light : w.base;
        p.fillStyle = base;
        p.fillRect(bx, y, brickW, rowH - 1);
        p.fillStyle = w.top;
        p.fillRect(bx, y, brickW, 1);
        p.fillStyle = w.shade;
        p.fillRect(bx, y + rowH - 2, brickW, 1);
      }
    }
  }

  // Вестибюль — крупные светлые плитки штукатурки 8x8 со швами
  function drawPlasterTiles(p, w) {
    const size = 16;
    p.fillStyle = w.base;
    p.fillRect(0, 0, size, size);
    // 2x2 плитки 8x8, швы по центру
    p.fillStyle = w.grout;
    p.fillRect(7, 0, 1, size);
    p.fillRect(15, 0, 1, size);
    p.fillRect(0, 7, size, 1);
    p.fillRect(0, 15, size, 1);
    // бликовые точки в центрах плиток
    p.fillStyle = w.top;
    p.fillRect(2, 1, 4, 1);
    p.fillRect(10, 1, 4, 1);
    p.fillRect(2, 9, 4, 1);
    p.fillRect(10, 9, 4, 1);
    // тени внизу
    p.fillStyle = w.shade;
    p.fillRect(0, 6, 7, 1);
    p.fillRect(8, 6, 7, 1);
    p.fillRect(0, 14, 7, 1);
    p.fillRect(8, 14, 7, 1);
    // капельки-потёртости
    p.fillStyle = w.light;
    p.fillRect(4, 3, 1, 1);
    p.fillRect(12, 11, 1, 1);
  }

  // Лаборатории — металлические листы с заклёпками
  function drawRivets(p, w) {
    const size = 16;
    // сплошной металлический фон
    p.fillStyle = w.base;
    p.fillRect(0, 0, size, size);
    // горизонтальные полосы (панели)
    p.fillStyle = w.grout;
    p.fillRect(0, 7, size, 1);
    p.fillRect(0, 15, size, 1);
    // вертикальные стыки
    p.fillRect(7, 0, 1, 7);
    p.fillRect(7, 8, 1, 7);
    // блики сверху каждой панели
    p.fillStyle = w.top;
    p.fillRect(0, 0, size, 1);
    p.fillRect(0, 8, size, 1);
    // тени снизу
    p.fillStyle = w.shade;
    p.fillRect(0, 6, size, 1);
    p.fillRect(0, 14, size, 1);
    // заклёпки (светлые точки в углах панелей)
    p.fillStyle = w.light;
    p.fillRect(1, 2, 1, 1);
    p.fillRect(6, 2, 1, 1);
    p.fillRect(9, 2, 1, 1);
    p.fillRect(14, 2, 1, 1);
    p.fillRect(1, 10, 1, 1);
    p.fillRect(6, 10, 1, 1);
    p.fillRect(9, 10, 1, 1);
    p.fillRect(14, 10, 1, 1);
    // блики на заклёпках
    p.fillStyle = w.top;
    p.fillRect(1, 2, 1, 1);
    p.fillRect(9, 2, 1, 1);
  }

  // Деканат — тёмные деревянные панели с прожилками
  function drawWoodPanels(p, w) {
    const size = 16;
    p.fillStyle = w.base;
    p.fillRect(0, 0, size, size);
    // 3 горизонтальные прожилки (разные оттенки)
    p.fillStyle = w.shade;
    p.fillRect(0, 3, size, 1);
    p.fillRect(0, 9, size, 1);
    p.fillStyle = w.light;
    p.fillRect(0, 2, size, 1);
    p.fillRect(0, 8, size, 1);
    p.fillRect(0, 13, size, 1);
    // вертикальный шов между панелями
    p.fillStyle = w.grout;
    p.fillRect(7, 0, 1, size);
    p.fillRect(15, 0, 1, size);
    // «сучки» — маленькие тёмные пятна
    p.fillStyle = w.shade;
    p.fillRect(3, 5, 1, 1);
    p.fillRect(11, 11, 1, 1);
    // блики сверху
    p.fillStyle = w.top;
    p.fillRect(0, 0, size, 1);
  }

  // Секретная кухня — яркие крупные золотисто-огненные плитки
  function drawKitchenTiles(p, w) {
    const size = 16;
    p.fillStyle = w.base;
    p.fillRect(0, 0, size, size);
    // крупные плитки 8x8 с чёткими швами
    p.fillStyle = w.grout;
    p.fillRect(7, 0, 1, size);
    p.fillRect(15, 0, 1, size);
    p.fillRect(0, 7, size, 1);
    p.fillRect(0, 15, size, 1);
    // яркие золотистые блики (как горячая лампа)
    p.fillStyle = w.top;
    p.fillRect(1, 1, 5, 1);
    p.fillRect(9, 1, 5, 1);
    p.fillRect(1, 9, 5, 1);
    p.fillRect(9, 9, 5, 1);
    // тени снизу плитки
    p.fillStyle = w.shade;
    p.fillRect(1, 6, 5, 1);
    p.fillRect(9, 6, 5, 1);
    p.fillRect(1, 14, 5, 1);
    p.fillRect(9, 14, 5, 1);
    // искры/капли жира
    p.fillStyle = w.light;
    p.fillRect(3, 3, 1, 1);
    p.fillRect(11, 11, 1, 1);
    p.fillRect(5, 12, 1, 1);
  }

  // Универсальный билдер пола — такая же 4-плитная схема, только меняем цвета
  function buildFloorPattern(ctx, theme) {
    const size = 16;
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const p = cv.getContext('2d');
    const f = theme.floor;

    p.fillStyle = f.base;
    p.fillRect(0, 0, size, size);
    p.fillStyle = f.tile;
    p.fillRect(1, 1, size - 2, size - 2);
    p.fillStyle = f.seam;
    p.fillRect(0, 0, size, 1);
    p.fillRect(0, 0, 1, size);
    p.fillStyle = f.speck;
    p.fillRect(3, 3, 1, 1);
    p.fillRect(size - 4, 3, 1, 1);
    p.fillRect(3, size - 4, 1, 1);
    p.fillRect(size - 4, size - 4, 1, 1);
    p.fillStyle = f.sheen;
    p.fillRect(size / 2 - 1, size / 2 - 1, 2, 1);

    return ctx.createPattern(cv, 'repeat');
  }

  global.App.Maze = Maze;
})(window);
