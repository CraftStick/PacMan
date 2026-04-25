/* ============================================================
   ghost.js — преподаватели-призраки с 4 классическими
   pac-man персоналиями:

     • blinky — цель = тайл Пакмана (прямая погоня)
     • pinky  — цель = тайл Пакмана + 4 клетки в текущем направлении
     • inky   — точка в 2 клетках впереди Пакмана, вектор от blinky
                до неё удваиваем и получаем цель
     • clyde  — если дальше 8 клеток от Пакмана — гонится; иначе
                уходит в свой scatter-угол

   Поддерживает обратную совместимость со старым API
   (type: 'strict'|'coder'|'dean' + alwaysRandom/immuneToFright).
   ============================================================ */

(function (global) {
  'use strict';
  const {
    TILE, W,
    DIR, DIRS, COLORS,
    tileCenter, pixelToTile, wrapC,
  } = global.App;

  // --- Карта старых типов → новых персоналий -----------------
  // Используется, если при создании призрака не задан `personality`.
  const LEGACY_TYPE_TO_PERSONALITY = {
    strict: 'blinky',
    coder:  'inky',
    dean:   'clyde',
  };

  class Ghost {
    // options:
    //   personality — 'blinky' | 'pinky' | 'inky' | 'clyde'
    //   type        — палитра/legacy-совместимость ('strict'|'coder'|'dean')
    //   displayName — подпись
    //   startTile   — {r,c} стартовой клетки
    //   scatterTile — {r,c} угла карты (цель в режиме scatter)
    //   baseSpeed   — px/s в обычном режиме chase/scatter
    //   releaseAfter— сек до выхода из дома
    //   tint        — дополнительный цвет тела (перекрывает палитру type)
    //   neverFrightens / immuneToFright — не боится Ноутбука (любое из двух)
    //   alwaysRandom — форс-рандом (legacy «айтишник»); перекрывает targeting
    constructor(options, maze) {
      this.personality = options.personality ||
                         LEGACY_TYPE_TO_PERSONALITY[options.type] ||
                         'blinky';
      this.type           = options.type || this.personality;
      this.displayName    = options.displayName || this.personality;
      this.startTile      = options.startTile;
      this.scatterTile    = options.scatterTile || { r: 0, c: 0 };
      this.baseSpeed       = options.baseSpeed ?? 85;
      this.tunnelSpeedMult = options.tunnelSpeedMult ?? 0.5;
      this.frightSpeedMult = options.frightSpeedMult ?? 0.55;
      this.elroy          = options.elroy || null;  // { phase1Dots, phase1Mult, phase2Dots, phase2Mult }
      this.neverFrightens = !!(options.neverFrightens || options.immuneToFright);
      this.alwaysRandom   = !!options.alwaysRandom;
      // Алиас для обратной совместимости со старым кодом, который
      // читает `.immuneToFright` (например, Game._startFright).
      this.immuneToFright = this.neverFrightens;

      this.bodyColor = options.tint ||
                       (COLORS.ghost[this.type]?.body) ||
                       '#ff2b2b';

      const p = tileCenter(this.startTile.r, this.startTile.c);
      this.x = p.x; this.y = p.y;
      this.dir = DIR.UP;
      this.maze = maze;
      this.mode = 'house';
      this.houseTimer = 0;
      this.releaseAfter = options.releaseAfter ?? 0;
      this.frightened = false;
      this.eaten = false;
      this.lastTile = { r: this.startTile.r, c: this.startTile.c };
    }

    tile() { return pixelToTile(this.x, this.y); }

    reset(releaseAfter) {
      const p = tileCenter(this.startTile.r, this.startTile.c);
      this.x = p.x; this.y = p.y;
      this.dir = DIR.UP;
      this.mode = 'house';
      this.houseTimer = 0;
      if (releaseAfter !== undefined) this.releaseAfter = releaseAfter;
      this.frightened = false;
      this.eaten = false;
      this.lastTile = { r: this.startTile.r, c: this.startTile.c };
    }

    currentSpeed() {
      if (this.eaten) return 180;                                          // «глаза» возвращаются домой
      if (this.frightened) return this.baseSpeed * this.frightSpeedMult;   // Fright Ghost % (Dossier)
      if (this.mode === 'house' || this.mode === 'leaving') return 55;

      let speed = this.baseSpeed;

      // Туннель: призраки замедляются до Tunnel % (Dossier: 40/45/50%).
      if (this.maze && typeof this.maze.isTunnel === 'function') {
        const t = this.tile();
        if (this.maze.isTunnel(t.r, t.c)) {
          return speed * this.tunnelSpeedMult;
        }
      }

      // Cruise Elroy — только Blinky. Когда остаётся мало еды, ускоряется:
      //   фаза 1 при pelletsLeft ≤ phase1Dots,
      //   фаза 2 при pelletsLeft ≤ phase2Dots (быстрее).
      // В scatter-режиме Элрой сохраняется (Dossier: «когда активирован,
      // держится до конца уровня»).
      if (this.personality === 'blinky' && this.elroy && this.maze) {
        const left = this.maze.pelletsLeft ?? Infinity;
        if (left <= this.elroy.phase2Dots) {
          speed *= this.elroy.phase2Mult;
        } else if (left <= this.elroy.phase1Dots) {
          speed *= this.elroy.phase1Mult;
        }
      }

      return speed;
    }

    // Разворот на 180° — вызывается при смене глобальной фазы
    // (chase↔scatter) и при старте Fright (оригинальное pac-man поведение).
    reverseDirection() {
      this.dir = { x: -this.dir.x, y: -this.dir.y };
    }

    // Цель погони — зависит от персоналии.
    // Параметры:
    //   pacman — объект Пакмана (нужны .tile() и .dir)
    //   ghosts — массив всех призраков (нужен для inky, опционально)
    chaseTarget(pacman, ghosts) {
      const pt = pacman.tile();
      const pd = pacman.dir || DIR.NONE;

      switch (this.personality) {
        case 'blinky': {
          return { r: pt.r, c: pt.c };
        }

        case 'pinky': {
          return { r: pt.r + pd.y * 4, c: pt.c + pd.x * 4 };
        }

        case 'inky': {
          // 2 клетки перед Пакманом
          const ahead = { r: pt.r + pd.y * 2, c: pt.c + pd.x * 2 };
          // Ищем blinky среди других призраков. Если нет —
          // честно падаем в blinky-таргет.
          const blinky = ghosts && ghosts.find(
            (g) => g !== this && g.personality === 'blinky'
          );
          if (!blinky) return { r: pt.r, c: pt.c };
          const bt = blinky.tile();
          // target = ahead + (ahead - bt) = 2*ahead - bt
          return { r: ahead.r * 2 - bt.r, c: ahead.c * 2 - bt.c };
        }

        case 'clyde': {
          // Близко к Пакману → убегаем в свой угол (scatter),
          // далеко → гонимся как blinky.
          const here = this.tile();
          const dx = here.c - pt.c;
          const dy = here.r - pt.r;
          const dist2 = dx * dx + dy * dy;
          if (dist2 > 64) return { r: pt.r, c: pt.c };
          return this.scatterTile;
        }

        default:
          return { r: pt.r, c: pt.c };
      }
    }

    pickDirection(globalMode, pacman, ghosts) {
      const t = this.tile();
      const choices = [];
      const back = { x: -this.dir.x, y: -this.dir.y };
      for (const d of DIRS) {
        if (d.x === back.x && d.y === back.y) continue;
        const nr = t.r + d.y;
        const nc = wrapC(t.c + d.x);
        const canDoor = this.eaten || this.mode === 'leaving';
        // AI учитывает турникеты: в клетку-стрелку можно войти только
        // по её направлению, иначе считаем её стеной.
        if (this.maze.isWall(nr, nc, canDoor, d)) continue;
        choices.push(d);
      }
      if (choices.length === 0) { this.dir = back; return; }

      // Легаси-«айтишник» — всегда случайно, игнорируя таргет
      if (this.alwaysRandom && !this.eaten) {
        this.dir = choices[Math.floor(Math.random() * choices.length)];
        return;
      }

      // Fright (не-иммунный) — всегда случайно
      if (this.frightened) {
        this.dir = choices[Math.floor(Math.random() * choices.length)];
        return;
      }

      let target;
      if (this.eaten) {
        target = { r: 14, c: 14 };
      } else if (globalMode === 'scatter') {
        target = this.scatterTile;
      } else {
        target = this.chaseTarget(pacman, ghosts);
      }

      // Выбираем направление, которое ближе всего к target.
      // При равенстве — приоритет UP, LEFT, DOWN, RIGHT (оригинал).
      const tgtX = target.c * TILE + TILE / 2;
      const tgtY = target.r * TILE + TILE / 2;
      let best = choices[0], bestD = Infinity;
      for (const d of choices) {
        const nx = (t.c + d.x) * TILE + TILE / 2;
        const ny = (t.r + d.y) * TILE + TILE / 2;
        const dd = (nx - tgtX) ** 2 + (ny - tgtY) ** 2;
        if (dd < bestD) { bestD = dd; best = d; }
      }
      this.dir = best;
    }

    update(dt, globalMode, pacman, ghosts) {
      const door = this.maze.ghostHouseDoor;

      if (this.mode === 'house') {
        this.houseTimer += dt;
        if (this.dir === DIR.NONE) this.dir = DIR.UP;
        const speed = 30;
        let ny = this.y + this.dir.y * speed * dt;
        const topY = this.startTile.r * TILE + TILE / 2 - 6;
        const botY = this.startTile.r * TILE + TILE / 2 + 6;
        if (ny < topY) { ny = topY; this.dir = DIR.DOWN; }
        if (ny > botY) { ny = botY; this.dir = DIR.UP; }
        this.y = ny;
        if (this.houseTimer >= this.releaseAfter) {
          this.mode = 'leaving';
          if (door) this.x = door.c * TILE + TILE / 2;
          this.dir = DIR.UP;
        }
        return;
      }

      if (this.mode === 'leaving') {
        const speed = this.currentSpeed();
        this.y -= speed * dt;
        const doorY = door ? door.r * TILE + TILE / 2 : 0;
        if (!door || this.y <= doorY - TILE) {
          this.mode = (globalMode === 'scatter') ? 'scatter' : 'chase';
          this.dir = Math.random() < 0.5 ? DIR.LEFT : DIR.RIGHT;
          const t = this.tile();
          this.x = t.c * TILE + TILE / 2;
          this.y = t.r * TILE + TILE / 2;
        }
        return;
      }

      if (this.eaten && door) {
        const doorT = { r: door.r + 1, c: door.c };
        const dc = tileCenter(doorT.r, doorT.c);
        if (Math.hypot(this.x - dc.x, this.y - dc.y) < 4) {
          this.eaten = false;
          this.frightened = false;
          this.mode = 'leaving';
          this.dir = DIR.UP;
          return;
        }
      }

      const speed = this.currentSpeed();
      const step = speed * dt;

      const t = this.tile();
      const cx = t.c * TILE + TILE / 2;
      const cy = t.r * TILE + TILE / 2;
      const crossedCenter =
        (this.lastTile.r !== t.r || this.lastTile.c !== t.c) ||
        (Math.abs(this.x - cx) < speed * dt && Math.abs(this.y - cy) < speed * dt);

      if (crossedCenter) {
        this.x = cx; this.y = cy;
        this.pickDirection(globalMode, pacman, ghosts);
        this.lastTile = { r: t.r, c: t.c };
      }

      this.x += this.dir.x * step;
      this.y += this.dir.y * step;

      if (this.x < -TILE / 2) this.x = W + TILE / 2 - 1;
      else if (this.x > W + TILE / 2) this.x = -TILE / 2 + 1;
    }

    draw(ctx, globalMode, frightTimeLeft) {
      const r = TILE * 0.5 - 1;
      const x = this.x, y = this.y;

      ctx.save();

      if (this.eaten) {
        drawGhostEyes(ctx, x, y, this.dir);
        ctx.restore();
        return;
      }

      let bodyColor = this.bodyColor;
      if (this.frightened) {
        const flash = frightTimeLeft < 2 && Math.floor(frightTimeLeft * 6) % 2 === 0;
        bodyColor = flash ? COLORS.ghost.flash.body : COLORS.ghost.fright.body;
      }

      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.arc(x, y - 1, r, Math.PI, 0);
      ctx.lineTo(x + r, y + r - 1);
      const waves = 3;
      const ww = (r * 2) / waves;
      for (let i = 0; i < waves; i++) {
        const x0 = x + r - i * ww;
        ctx.lineTo(x0 - ww * 0.5, y + r - 4);
        ctx.lineTo(x0 - ww, y + r - 1);
      }
      ctx.closePath();
      ctx.fill();

      if (this.frightened) {
        ctx.fillStyle = '#ffb8ff';
        ctx.fillRect(x - 4, y - 3, 2, 2);
        ctx.fillRect(x + 2, y - 3, 2, 2);
        ctx.strokeStyle = '#ffb8ff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 5, y + 3);
        ctx.lineTo(x - 3, y + 1);
        ctx.lineTo(x - 1, y + 3);
        ctx.lineTo(x + 1, y + 1);
        ctx.lineTo(x + 3, y + 3);
        ctx.lineTo(x + 5, y + 1);
        ctx.stroke();
      } else {
        drawGhostEyes(ctx, x, y, this.dir);
      }

      // Мантия-индикатор для иммунных к fright-боссов (раньше — только decан)
      if (this.neverFrightens && !this.frightened) {
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(x - 2, y - r - 3, 4, 2);
      }

      ctx.restore();
    }
  }

  function drawGhostEyes(ctx, x, y, dir) {
    const sc = COLORS.ghost.eyes;
    ctx.fillStyle = sc.sclera;
    ctx.beginPath();
    ctx.arc(x - 3, y - 2, 2.5, 0, Math.PI * 2);
    ctx.arc(x + 3, y - 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = sc.iris;
    const dx = dir.x * 1.3, dy = dir.y * 1.3;
    ctx.beginPath();
    ctx.arc(x - 3 + dx, y - 2 + dy, 1.3, 0, Math.PI * 2);
    ctx.arc(x + 3 + dx, y - 2 + dy, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }

  global.App.Ghost = Ghost;
})(window);
