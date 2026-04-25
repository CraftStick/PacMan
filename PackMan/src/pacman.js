/* ============================================================
   pacman.js — класс студента (Pac-Man) с неоновой отрисовкой
   ============================================================ */

(function (global) {
  'use strict';
  const { TILE, W, DIR, COLORS, tileCenter, pixelToTile, wrapC } = global.App;

  class Pacman {
    constructor(maze, baseSpeed) {
      this.maze = maze;
      const p = tileCenter(maze.pacmanStart.r, maze.pacmanStart.c);
      this.startX = p.x; this.startY = p.y;
      this.x = p.x; this.y = p.y;
      this.dir = DIR.NONE;
      this.nextDir = DIR.NONE;
      this.baseSpeed = baseSpeed ?? 95;
      this.speed = this.baseSpeed;
      this.alive = true;
      this.deathTimer = 0;
      this.mouth = 0;
      this.mouthDir = 1;
    }

    reset() {
      this.x = this.startX;
      this.y = this.startY;
      this.dir = DIR.NONE;
      this.nextDir = DIR.NONE;
      this.alive = true;
      this.deathTimer = 0;
      this.mouth = 0;
      this.mouthDir = 1;
    }

    tile() { return pixelToTile(this.x, this.y); }

    update(dt) {
      if (!this.alive) { this.deathTimer += dt; return; }

      const t = this.tile();
      const centerX = t.c * TILE + TILE / 2;
      const centerY = t.r * TILE + TILE / 2;
      const onCenter = Math.abs(this.x - centerX) < 2 && Math.abs(this.y - centerY) < 2;

      // смена направления
      if (this.nextDir !== DIR.NONE) {
        const rev =
          (this.nextDir === DIR.LEFT  && this.dir === DIR.RIGHT) ||
          (this.nextDir === DIR.RIGHT && this.dir === DIR.LEFT)  ||
          (this.nextDir === DIR.UP    && this.dir === DIR.DOWN)  ||
          (this.nextDir === DIR.DOWN  && this.dir === DIR.UP);
        if (rev) {
          this.dir = this.nextDir;
          this.nextDir = DIR.NONE;
        } else if (onCenter) {
          const nr = t.r + this.nextDir.y;
          const nc = wrapC(t.c + this.nextDir.x);
          if (!this.maze.isWall(nr, nc, false, this.nextDir)) {
            this.dir = this.nextDir;
            this.nextDir = DIR.NONE;
            this.x = centerX; this.y = centerY;
          }
        }
      }

      // движение
      if (this.dir !== DIR.NONE) {
        const step = this.speed * dt;
        let nx = this.x + this.dir.x * step;
        let ny = this.y + this.dir.y * step;

        const ahead = pixelToTile(
          this.x + this.dir.x * (TILE / 2),
          this.y + this.dir.y * (TILE / 2)
        );
        const wallAhead = this.maze.isWall(ahead.r, wrapC(ahead.c), false, this.dir);
        if (wallAhead) {
          if (this.dir.x !== 0) nx = centerX;
          if (this.dir.y !== 0) ny = centerY;
          if (Math.abs(this.x - centerX) < 1 && Math.abs(this.y - centerY) < 1) {
            this.dir = DIR.NONE;
          }
        }
        this.x = nx; this.y = ny;

        // туннель
        if (this.x < -TILE / 2) this.x = W + TILE / 2 - 1;
        else if (this.x > W + TILE / 2) this.x = -TILE / 2 + 1;
      }

      // анимация рта
      this.mouth += this.mouthDir * dt * 6;
      if (this.mouth > 1) { this.mouth = 1; this.mouthDir = -1; }
      if (this.mouth < 0) { this.mouth = 0; this.mouthDir = 1; }
    }

    draw(ctx) {
      const radius = TILE * 0.5 - 1;

      ctx.save();
      ctx.translate(this.x, this.y);

      if (!this.alive) {
        const t = Math.min(this.deathTimer / 1.2, 1);
        const open = Math.PI * t;
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = COLORS.pacman;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, radius * (1 - t * 0.1), open, Math.PI * 2 - open);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        return;
      }

      let angle = 0;
      if (this.dir === DIR.RIGHT)      angle = 0;
      else if (this.dir === DIR.LEFT)  angle = Math.PI;
      else if (this.dir === DIR.UP)    angle = -Math.PI / 2;
      else if (this.dir === DIR.DOWN)  angle = Math.PI / 2;
      ctx.rotate(angle);

      const open = 0.08 + 0.35 * this.mouth;
      ctx.fillStyle = COLORS.pacman;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, open * Math.PI, (2 - open) * Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  global.App.Pacman = Pacman;
})(window);
