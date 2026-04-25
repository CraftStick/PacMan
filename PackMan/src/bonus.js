/* ============================================================
   bonus.js — система временных бонусов (кофе / экзамен)
   Бонусы появляются на фиксированной клетке и висят несколько секунд.
   ============================================================ */

(function (global) {
  'use strict';
  const { TILE, BONUS, GAME, ROWS, COLS, tileCenter } = global.App;

  class BonusSystem {
    // maze — опциональный маз, чтобы подобрать подходящий тайл спавна
    //        для текущего этажа (геометрия у всех разная).
    constructor(maze) {
      this.current = null;
      this.spawnTimer = 8;
      this.spawnTile = findSpawnTile(maze);
    }

    reset() {
      this.current = null;
      this.spawnTimer = 8;
    }

    setMaze(maze) {
      this.spawnTile = findSpawnTile(maze);
    }

    update(dt) {
      if (this.current) {
        this.current.timeLeft -= dt;
        if (this.current.timeLeft <= 0) this.current = null;
        return;
      }
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this._spawn();
        this.spawnTimer = GAME.bonusInterval;
      }
    }

    _spawn() {
      const type = Math.random() < 0.5 ? BONUS.COFFEE : BONUS.EXAM;
      const tile = this.spawnTile || GAME.bonusSpawnTile;
      this.current = {
        type,
        r: tile.r,
        c: tile.c,
        timeLeft: GAME.bonusLifetime,
      };
    }

    // проверка: наступил ли пакман на бонус; возвращает тип бонуса или null
    tryEat(pacman) {
      if (!this.current) return null;
      const center = tileCenter(this.current.r, this.current.c);
      const d = Math.hypot(pacman.x - center.x, pacman.y - center.y);
      if (d > TILE * 0.55) return null;
      const type = this.current.type;
      this.current = null;
      return type;
    }

    draw(ctx, time) {
      if (!this.current) return;
      const { type, r, c, timeLeft } = this.current;
      const center = tileCenter(r, c);

      // мигание, когда осталось < 3 секунд
      if (timeLeft < 3 && Math.floor(timeLeft * 6) % 2 === 0) return;

      const emoji = type === BONUS.COFFEE ? '☕'
                  : type === BONUS.EXAM   ? '🧠'
                  : '?';

      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // лёгкое подпрыгивание
      const bob = Math.sin(time / 200) * 1.5;
      ctx.font = '16px "Roboto", sans-serif';
      ctx.fillText(emoji, center.x, center.y + bob);
      ctx.restore();
    }
  }

  // Ищет подходящую клетку для спавна бонуса: ближайшую проходимую
  // клетку к GAME.bonusSpawnTile. Если maze не задан — возвращает fallback.
  function findSpawnTile(maze) {
    if (!maze) return { ...GAME.bonusSpawnTile };
    const target = GAME.bonusSpawnTile;
    // простой BFS-образный радиус: перебираем клетки по возрастающему manhattan
    for (let d = 0; d < Math.max(ROWS, COLS); d++) {
      for (let dr = -d; dr <= d; dr++) {
        const dcMax = d - Math.abs(dr);
        for (let dc = -dcMax; dc <= dcMax; dc++) {
          const r = target.r + dr;
          const c = target.c + dc;
          if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
          // подходят только чистые проходимые клетки (не стена, не дверь,
          // не oneway) — чтобы бонус был доступен с любой стороны.
          if (maze.grid[r][c] === 0) return { r, c };
        }
      }
    }
    return { ...GAME.bonusSpawnTile };
  }

  global.App.BonusSystem = BonusSystem;
})(window);
