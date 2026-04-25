/* ============================================================
   game.js — состояние, главный цикл, режимы, коллизии, UI.

   Floor state machine:
     • intro      — открытый оверлей «На пару!» (до первого старта)
     • ready      — отсчёт перед началом этажа («ЗВОНОК!»)
     • playing    — обычный геймплей
     • transition — межэтажный оверлей «ПЕРЕВОД НА N ЭТАЖ»
     • diploma    — финальный экран «ДИПЛОМ!» (или «С ОТЛИЧИЕМ»)
     • gameover   — ОТЧИСЛЕН
     • failed     — ЗВОНОК, не успел

   Секрет кафетерия:
     Если пройти 1..4 этажи идеально — без потерь пересдач и собрав
     все появившиеся бонусы — после 4-го этажа вместо «Диплома»
     открывается скрытый уровень «Секретная кухня» с боссом-Шефом.
   ============================================================ */

(function (global) {
  'use strict';
  const {
    W, H, TILE, ROWS, COLS,
    COLORS, DIR, GAME, BONUS,
    Maze, Pacman, Ghost, BonusSystem,
    FLOORS, SECRET_FLOOR,
  } = global.App;

  // Клонируем/нормализуем расписание фаз в унифицированный формат.
  // Принимает как [['scatter', 7], ...], так и [{ mode, t }, ...].
  function normalizePhases(schedule) {
    const src = Array.isArray(schedule) && schedule.length
      ? schedule
      : GAME.defaultPhases;
    return src.map((p) => Array.isArray(p)
      ? { mode: p[0], t: p[1] }
      : { mode: p.mode, t: p.t });
  }

  // Позиции в доме призраков — берём первые 4 клетки «G» из maze.ghostHouse.
  // Если на этаже меньше клеток — зацикливаем; если совсем нет — падаем
  // в середину карты.
  function pickGhostStartTile(maze, i) {
    const hs = maze.ghostHouse;
    if (hs && hs.length) return hs[i % hs.length];
    return { r: 14, c: 13 };
  }

  class Game {
    constructor(canvas, ui) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.ui = ui;

      // Лениво создаётся в _loadFloor — до первой игры здесь ничего нет.
      this.maze = null;
      this.pacman = null;
      this.bonuses = null;
      this.ghosts = [];

      this.state = this._initialState();
      this._lastTime = performance.now();

      // Загрузим первый этаж, чтобы был что рендерить на стартовом оверлее.
      this._loadFloor(0, { keepState: true, autoRun: false });
      this._updateHUD();
    }

    _initialState() {
      return {
        score: 0,
        high: Number(localStorage.getItem('pacsession_high') || 0),
        lives: 3,

        floorIdx: 0,           // индекс в FLOORS (0..3)
        isSecret: false,       // true когда играем на секретном этаже

        // Глобальные фазы scatter/chase
        mode: 'scatter',
        phases: normalizePhases(GAME.defaultPhases),
        phaseIdx: 0,
        phaseTimer: 7,

        frightTime: 0,         // активное время «Ноутбука»
        frightDuration: GAME.frightTime, // сколько длится fright на текущем этаже
        speedBoost: 0,
        ghostEatChain: 0,

        // Визуальный отклик на power-pellet.
        flashTimer: 0,
        freezeTimer: 0,

        semesterTimeLeft: GAME.semesterTime,
        readyTimer: 0,
        transitionTimer: 0,    // > 0 пока показываем «ПЕРЕВОД НА N ЭТАЖ»
        transitionTo: null,    // индекс следующего этажа (для оверлея)
        transitionSecret: false,

        // Условие «идеального прохождения» для секрета:
        //   livesLost     — сколько раз студента словили
        //   bonusesMissed — сколько бонусов проспавнилось и не съелось
        livesLost: 0,
        bonusesMissed: 0,
        _lastBonusActive: false,

        running: false,        // идёт ли симуляция (тикает ли цикл)
        paused: false,
        gameOver: false,
        win: false,            // полная победа (ДИПЛОМ)
        failed: false,
      };
    }

    // =========================================================
    //                    Публичный API
    // =========================================================
    start() {
      requestAnimationFrame((t) => this._loop(t));
      this._showOverlay(
        'IT Колледж',
        'Pac-Session',
        `Пройди <b>4 этажа</b> колледжа, собери все <b>знания</b> на каждом ` +
        `и не попадись преподам. На каждом этаже свой лабиринт, свои преподы ` +
        `и свой <b>лимит времени</b>.<br>` +
        `💻 Ноутбук — неуязвимость, ☕ Кофе — ускорение, 🧠 Экзамен — очки.<br>` +
        `<i>Говорят, за идеальное прохождение открывается что-то вкусное…</i>`,
        'На пару!'
      );
    }

    newGame() {
      const prevHigh = this.state.high;
      this.state = this._initialState();
      this.state.high = prevHigh;
      this._loadFloor(0, { keepState: true, autoRun: true });
      this.ui.overlay.classList.add('hidden');
      this._updateHUD();
    }

    togglePause() {
      if (this.state.running) this.state.paused = !this.state.paused;
    }

    setPacmanDir(dir) {
      if (!this.pacman) return;
      this.pacman.nextDir = dir;
      if (this.pacman.dir === DIR.NONE) this.pacman.dir = dir;
    }

    // =========================================================
    //                  Floor state machine
    // =========================================================
    // idx — индекс в FLOORS, или -1 для секретного этажа.
    // options.keepState — не трогать score/lives/high и т.п.
    // options.autoRun   — сразу перейти в 'ready' (игра пойдёт после звонка)
    _loadFloor(idx, options = {}) {
      const isSecret = (idx < 0);
      const floor = isSecret ? SECRET_FLOOR : FLOORS[idx];
      if (!floor) return;

      this.state.floorIdx = isSecret ? -1 : idx;
      this.state.isSecret = isSecret;

      this.maze = new Maze(floor);
      this.pacman = new Pacman(this.maze, floor.difficulty.pacmanSpeed);
      this.bonuses = new BonusSystem(this.maze);
      this.ghosts = floor.ghosts.map((gcfg, i) => {
        const start = pickGhostStartTile(this.maze, i);
        return new Ghost({
          personality:     gcfg.personality,
          displayName:     gcfg.displayName,
          tint:            gcfg.tint,
          scatterTile:     gcfg.scatterTile,
          releaseAfter:    gcfg.releaseAfter ?? i * 2,
          neverFrightens:  gcfg.neverFrightens,
          startTile:       start,
          baseSpeed:       floor.difficulty.ghostSpeed * (gcfg.personality === 'blinky' ? 0.9 : 1),
          tunnelSpeedMult: floor.difficulty.tunnelGhostMult,
          frightSpeedMult: floor.difficulty.ghostFrightMult ?? 0.55,
          elroy:           (gcfg.personality === 'blinky')
                             ? floor.difficulty.elroy
                             : null,
        }, this.maze);
      });

      this._loadPhases(floor.difficulty.scatterPhases);
      this.state.frightDuration = floor.difficulty.frightTime ?? GAME.frightTime;
      this.state.semesterTimeLeft = floor.difficulty.semesterTime ?? GAME.semesterTime;
      this.state.frightTime = 0;
      this.state.speedBoost = 0;
      this.state.ghostEatChain = 0;
      this.state.flashTimer = 0;
      this.state.freezeTimer = 0;
      this.state._lastBonusActive = false;

      if (options.autoRun) {
        this.state.running = true;
        this.state.paused = false;
        this.state.gameOver = false;
        this.state.win = false;
        this.state.failed = false;
        this.state.transitionTimer = 0;
        this.state.readyTimer = 0.8;
        if (this.pacman) this.pacman.speed = this.pacman.baseSpeed;
      }
      this._updateHUD();
    }

    // Перезапуск позиций на текущем этаже (после потери пересдачи).
    _resetPositionsOnly() {
      if (!this.maze) return;
      this.pacman.reset();
      this.ghosts.forEach((g, i) => {
        // Берём releaseAfter текущего призрака, если он явно задан
        // (0 — тоже валидно, поэтому не через `||`).
        const delay = (typeof g.releaseAfter === 'number') ? g.releaseAfter : i * 2;
        g.reset(delay);
      });
      this._loadPhases(this.state.phases.map((p) => [p.mode, p.t]));
      this.state.frightTime = 0;
      this.state.ghostEatChain = 0;
      this.state.flashTimer = 0;
      this.state.freezeTimer = 0;
      this.state.readyTimer = 0.8;
      this.pacman.speed = this.pacman.baseSpeed;
      this.state.speedBoost = 0;
    }

    _loadPhases(schedule) {
      const phases = normalizePhases(schedule);
      this.state.phases = phases;
      this.state.phaseIdx = 0;
      this.state.phaseTimer = phases[0].t;
      this.state.mode = phases[0].mode;
    }

    _setMode(mode) {
      const prev = this.state.mode;
      this.state.mode = mode;
      if (prev === mode) return;
      const swap = (prev === 'chase' && mode === 'scatter') ||
                   (prev === 'scatter' && mode === 'chase');
      if (!swap) return;
      for (const g of this.ghosts) {
        if (g.mode === 'chase' || g.mode === 'scatter') {
          g.mode = mode;
          if (typeof g.reverseDirection === 'function') g.reverseDirection();
          else g.dir = { x: -g.dir.x, y: -g.dir.y };
        }
      }
    }

    _updateGlobalMode(dt) {
      if (this.state.frightTime > 0) return;
      const phases = this.state.phases;
      if (!phases || !phases.length) return;

      this.state.phaseTimer -= dt;
      if (this.state.phaseTimer <= 0) {
        this.state.phaseIdx = Math.min(
          this.state.phaseIdx + 1, phases.length - 1
        );
        const next = phases[this.state.phaseIdx];
        this._setMode(next.mode);
        this.state.phaseTimer = next.t;
      }
    }

    _startFright(duration) {
      // fright=0 (как на уровне 17+ и на секретном этаже) — не активируем
      // режим испуга, но разрешаем форс-реверс (как в оригинале).
      this.state.ghostEatChain = 0;
      for (const g of this.ghosts) {
        if (g.neverFrightens || g.immuneToFright) continue;
        if (!g.eaten && (g.mode === 'chase' || g.mode === 'scatter')) {
          if (duration > 0) g.frightened = true;
          g.dir = { x: -g.dir.x, y: -g.dir.y };
        }
      }
      if (duration <= 0) return;
      this.state.frightTime = duration;
      // Pac-Man ускоряется во время fright (Dossier: Fright Pac-Man %).
      if (this.pacman) {
        const fs = this.currentFloor()?.difficulty?.pacmanFrightSpeed;
        if (fs) this.pacman.speed = fs;
      }
    }

    // Текущий конфиг этажа (FLOORS[idx] или SECRET_FLOOR).
    currentFloor() {
      return this.state.isSecret ? SECRET_FLOOR : FLOORS[this.state.floorIdx];
    }

    _eatPellet() {
      const t = this.pacman.tile();
      const kind = this.maze.eatAt(t.r, t.c, this.pacman.x, this.pacman.y);
      if (!kind) return;

      if (kind === 1) {
        this.state.score += 10;
      } else if (kind === 2) {
        this.state.score += 50;
        this._startFright(this.state.frightDuration);
        this.state.flashTimer = GAME.powerFlashTime;
        this.state.freezeTimer = GAME.powerFreezeTime;
      }

      this._bumpHigh();
      this._updateHUD();

      if (this.maze.pelletsLeft <= 0) this._onFloorCleared();
    }

    _eatBonus() {
      const type = this.bonuses.tryEat(this.pacman);
      if (!type) return;
      if (type === BONUS.COFFEE) {
        this.state.speedBoost = GAME.speedBoostTime;
      } else if (type === BONUS.EXAM) {
        this.state.score += GAME.examScore;
        this._bumpHigh();
        this._updateHUD();
      }
    }

    _bumpHigh() {
      if (this.state.score > this.state.high) {
        this.state.high = this.state.score;
        localStorage.setItem('pacsession_high', String(this.state.high));
      }
    }

    _checkGhostCollisions() {
      for (const g of this.ghosts) {
        if (g.mode === 'house' || g.mode === 'leaving') continue;
        if (g.eaten) continue;
        const d = Math.hypot(g.x - this.pacman.x, g.y - this.pacman.y);
        if (d < TILE * 0.55) {
          if (g.frightened) {
            g.eaten = true;
            g.frightened = false;
            this.state.ghostEatChain++;
            const bonus = 200 * Math.pow(2, this.state.ghostEatChain - 1);
            this.state.score += bonus;
            this._bumpHigh();
            this._updateHUD();
          } else {
            this._onPacmanCaught();
            return;
          }
        }
      }
    }

    _onPacmanCaught() {
      this.pacman.alive = false;
      this.state.running = false;
      this.state.livesLost++;
      setTimeout(() => {
        this.state.lives--;
        this._updateHUD();
        if (this.state.lives <= 0) {
          this.state.gameOver = true;
          this._showOverlay(
            'ОТЧИСЛЕН',
            `этаж ${this.currentFloorLabel()}`,
            `Деканат уже ждёт. Знаний накоплено: <b>${this.state.score}</b>.`,
            'Восстановиться'
          );
        } else {
          this.state.running = true;
          this._resetPositionsOnly();
        }
      }, 1300);
    }

    // Перешли на следующий этаж / финальный экран.
    _onFloorCleared() {
      this.state.running = false;
      if (this.state.isSecret) {
        this._onDiploma(true);
        return;
      }

      const nextIdx = this.state.floorIdx + 1;
      // После 4-го этажа — проверяем условие секрета.
      if (nextIdx >= FLOORS.length) {
        if (this._isPerfect()) {
          this._startTransition(-1, true);  // секрет
        } else {
          this._onDiploma(false);
        }
        return;
      }
      this._startTransition(nextIdx, false);
    }

    _startTransition(nextIdx, secret) {
      this.state.transitionTo = nextIdx;
      this.state.transitionSecret = !!secret;
      this.state.transitionTimer = GAME.floorTransitionTime;

      const nextFloor = secret ? SECRET_FLOOR : FLOORS[nextIdx];
      const title = secret ? 'СЕКРЕТНАЯ КУХНЯ' : `ПЕРЕВОД НА ${nextIdx + 1} ЭТАЖ`;
      this._showOverlay(
        title,
        secret ? 'Финальный экзамен' : (nextFloor ? nextFloor.subtitle : ''),
        secret
          ? `Ты собрал всё до крошки. За дверью столовой слышны шаги <b>Шеф-повара</b>…`
          : `Сдал <b>${this.state.floorIdx + 1}/${FLOORS.length}</b>. Готовимся к следующему…`,
        null
      );
      // Скрытая кнопка — оверлей сам исчезнет через transitionTimer секунд.
      if (this.ui.startBtn) this.ui.startBtn.style.display = 'none';
    }

    _finishTransition() {
      const nextIdx = this.state.transitionTo;
      const secret = this.state.transitionSecret;
      this.state.transitionTo = null;
      this.state.transitionSecret = false;
      this.state.transitionTimer = 0;

      // Показ оверлея закрываем, возвращаем кнопку.
      if (this.ui.startBtn) this.ui.startBtn.style.display = '';
      this.ui.overlay.classList.add('hidden');

      this._loadFloor(secret ? -1 : nextIdx, { keepState: true, autoRun: true });
    }

    _onDiploma(withHonors) {
      this.state.win = true;
      this.state.running = false;
      this._showOverlay(
        withHonors ? 'ДИПЛОМ С ОТЛИЧИЕМ!' : 'ДИПЛОМ!',
        withHonors ? 'Шеф-повар посрамлён' : 'IT Колледж закрыт',
        `Финальный счёт: <b>${this.state.score}</b>. ` +
        (withHonors
          ? `Ты прошёл все 4 этажа и победил босса в секретной кухне. Легенда.`
          : `Ты сдал все 4 сессии. А кухня… где-то ждёт достойного.`),
        'Новый год'
      );
    }

    _onTimeUp() {
      this.state.failed = true;
      this.state.running = false;
      this._showOverlay(
        'ЗВОНОК!',
        `этаж ${this.currentFloorLabel()}`,
        `Время сессии вышло. Знаний: <b>${this.state.score}</b>. ` +
        `Не сдано: <b>${this.maze.pelletsLeft}</b> предметов.`,
        'Пересдача'
      );
    }

    // 100% еды + ни одной потери пересдач = идеально.
    _isPerfect() {
      return this.state.livesLost === 0 && this.state.bonusesMissed === 0;
    }

    currentFloorLabel() {
      if (this.state.isSecret) return 'СЕКРЕТ';
      return `${this.state.floorIdx + 1}/${FLOORS.length}`;
    }

    // =========================================================
    //                       UI helpers
    // =========================================================
    _updateHUD() {
      this.ui.score.textContent = this.state.score;
      this.ui.high.textContent  = this.state.high;
      this.ui.lives.textContent = this.state.lives;
      if (this.ui.floor) {
        this.ui.floor.textContent = this.currentFloorLabel();
        if (this.state.isSecret) {
          this.ui.floor.style.color = '#ffb84d';
        } else {
          this.ui.floor.style.color = '';
        }
      }
      if (this.ui.time) {
        const s = Math.max(0, Math.ceil(this.state.semesterTimeLeft));
        const m = Math.floor(s / 60);
        const sec = s % 60;
        this.ui.time.textContent = `${m}:${sec.toString().padStart(2, '0')}`;
        this.ui.time.style.color = (s <= 15) ? COLORS.timeLow : '';
      }
    }

    _showOverlay(title, subtitle, text, btn) {
      this.ui.overlay.classList.remove('hidden');
      this.ui.overlay.querySelector('h1').textContent = title;
      const h2 = this.ui.overlay.querySelector('h2');
      if (h2) h2.textContent = subtitle || '';
      this.ui.overlay.querySelector('.lead').innerHTML = text;
      if (this.ui.startBtn) {
        if (btn) {
          this.ui.startBtn.textContent = btn;
          this.ui.startBtn.style.display = '';
        } else {
          this.ui.startBtn.style.display = 'none';
        }
      }
    }

    // =========================================================
    //                      Главный цикл
    // =========================================================
    _loop(now) {
      const dt = Math.min((now - this._lastTime) / 1000, 1 / 30);
      this._lastTime = now;
      const time = now;

      // Оверлей межэтажного перехода — тикаем таймер, даже если игра стоит.
      if (this.state.transitionTimer > 0) {
        this.state.transitionTimer -= dt;
        if (this.state.transitionTimer <= 0) this._finishTransition();
      } else if (this.state.running && !this.state.paused) {
        this._tickGameplay(dt);
      } else if (this.pacman && !this.pacman.alive) {
        this.pacman.update(dt);
      }

      this._render(time);
      requestAnimationFrame((t) => this._loop(t));
    }

    _tickGameplay(dt) {
      if (this.state.readyTimer > 0) {
        this.state.readyTimer -= dt;
        return;
      }

      // Визуальная вспышка идёт независимо от freeze.
      if (this.state.flashTimer > 0) {
        this.state.flashTimer = Math.max(0, this.state.flashTimer - dt);
      }

      if (this.state.freezeTimer > 0) {
        this.state.freezeTimer = Math.max(0, this.state.freezeTimer - dt);
        this._updateHUD();
        return;
      }

      this.state.semesterTimeLeft -= dt;
      if (this.state.semesterTimeLeft <= 0) {
        this.state.semesterTimeLeft = 0;
        this._onTimeUp();
        return;
      }

      this._updateGlobalMode(dt);

      // Таймер неуязвимости
      if (this.state.frightTime > 0) {
        this.state.frightTime -= dt;
        if (this.state.frightTime <= 0) {
          this.state.frightTime = 0;
          for (const g of this.ghosts) g.frightened = false;
          // Возвращаем пакману базовую скорость, если сверху не активен
          // кофе-буст (speedBoost обработается ниже и перезапишет).
          if (this.pacman && this.state.speedBoost <= 0) {
            this.pacman.speed = this.pacman.baseSpeed;
          }
        }
      }

      if (this.state.speedBoost > 0) {
        this.state.speedBoost -= dt;
        this.pacman.speed = this.pacman.baseSpeed * GAME.speedBoostMult;
        if (this.state.speedBoost <= 0) {
          this.state.speedBoost = 0;
          this.pacman.speed = this.pacman.baseSpeed;
        }
      }

      // Отслеживаем «пропущенные бонусы» (для секрет-ачивки).
      // Бонус исчезает сам по таймауту → learn by edge: active → null.
      const hadBonus = this.state._lastBonusActive;
      const hasBonus = !!(this.bonuses && this.bonuses.current);
      this.bonuses.update(dt);
      const stillHas = !!(this.bonuses && this.bonuses.current);
      if (hadBonus && hasBonus && !stillHas) {
        this.state.bonusesMissed++;
      }
      this.state._lastBonusActive = !!(this.bonuses && this.bonuses.current);

      this.pacman.update(dt);
      this._eatPellet();
      // Если съели последний пеллет — этаж уже зачтён, коллизии и ходы
      // призраков больше не интересны в этом кадре.
      if (!this.state.running) { this._updateHUD(); return; }

      this._eatBonus();
      for (const g of this.ghosts) {
        g.update(dt, this.state.mode, this.pacman, this.ghosts);
      }
      this._checkGhostCollisions();

      this._updateHUD();
    }

    // =========================================================
    //                        Render
    // =========================================================
    _render(time) {
      const ctx = this.ctx;
      if (!this.maze) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        return;
      }

      this.maze.render(ctx, time);
      if (this.bonuses) this.bonuses.draw(ctx, time);

      if (this.pacman) this.pacman.draw(ctx);
      for (const g of this.ghosts) {
        g.draw(ctx, this.state.mode, this.state.frightTime);
      }

      // Подписи состояния
      if (this.state.readyTimer > 0 && this.state.running) {
        drawLabel(ctx, 'ЗВОНОК!', W / 2, H / 2 + 2 * TILE, COLORS.ready, 14);
      }
      if (this.state.gameOver) {
        drawLabel(ctx, 'ОТЧИСЛЕН!', W / 2, H / 2 + 2 * TILE, COLORS.gameOver, 18);
      }
      if (this.state.failed) {
        drawLabel(ctx, 'ЗВОНОК!', W / 2, H / 2 + 2 * TILE, COLORS.gameOver, 14);
      }
      if (this.state.win) {
        drawLabel(ctx, this.state.isSecret ? 'ДИПЛОМ С ОТЛИЧИЕМ!' : 'ДИПЛОМ!',
                  W / 2, H / 2 + 2 * TILE, COLORS.win, 16);
      }

      if (this.state.running && this.state.speedBoost > 0) {
        drawLabel(ctx, `☕ ${this.state.speedBoost.toFixed(1)}s`, W / 2, 14, COLORS.ready, 10);
      }

      if (this.state.paused) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, W, H);
        drawLabel(ctx, 'ПЕРЕМЕНА', W / 2, H / 2, COLORS.ready, 20);
      }

      // Полу-прозрачная затемняющая дымка во время transition — поверх
      // канваса виден следующий этаж, но «утоплен» под оверлеем.
      if (this.state.transitionTimer > 0) {
        ctx.save();
        const a = this.state.transitionSecret ? 0.65 : 0.5;
        ctx.fillStyle = `rgba(0, 0, 0, ${a})`;
        ctx.fillRect(0, 0, W, H);
        drawLabel(
          ctx,
          this.state.transitionSecret ? 'СЕКРЕТ!' : `ЭТАЖ ${this.state.transitionTo + 1}`,
          W / 2, H / 2, this.state.transitionSecret ? '#ffb84d' : COLORS.ready, 22
        );
        ctx.restore();
      }

      if (this.state.flashTimer > 0) {
        const a = Math.min(1, this.state.flashTimer / GAME.powerFlashTime);
        ctx.save();
        ctx.globalAlpha = 0.35 * a;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    }
  }

  function drawLabel(ctx, text, x, y, color, size) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${size}px "Roboto", sans-serif`;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillText(text, x + 1, y + 2);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  global.App.Game = Game;
})(window);
