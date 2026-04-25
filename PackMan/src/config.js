/* ============================================================
   config.js — геометрия, направления, палитра, глобальные параметры.
   Лейауты этажей лежат в src/floors.js.
   Экспортируется через глобальный объект window.App
   ============================================================ */

(function (global) {
  'use strict';

  // --- Геометрия (единая для всех этажей) ---
  const TILE = 16;
  const COLS = 28;
  const ROWS = 31;
  const W = COLS * TILE;           // 448
  const H = ROWS * TILE;           // 496

  // --- Направления ---
  const DIR = {
    NONE:  { x: 0,  y: 0  },
    LEFT:  { x: -1, y: 0  },
    RIGHT: { x: 1,  y: 0  },
    UP:    { x: 0,  y: -1 },
    DOWN:  { x: 0,  y: 1  },
  };
  const DIRS = [DIR.LEFT, DIR.RIGHT, DIR.UP, DIR.DOWN];

  // --- Палитра (базовые цвета, темы этажей перекрывают в maze.js) ---
  const COLORS = {
    bg:         '#000000',
    wallFill:   '#0a1260',
    wallStroke: '#1e2aff',
    door:       '#ffb8ff',
    pellet:     '#ffd9a8',
    power:      '#ffb8ff',
    pacman:     '#ffeb3b',
    text:       '#ffffff',
    ready:      '#ffeb3b',
    gameOver:   '#ff2b2b',
    win:        '#6dffb8',
    timeLow:    '#ff8a4d',
    ghost: {
      blinky:{ body: '#ff2b2b' },
      pinky: { body: '#ffb8ff' },
      inky:  { body: '#00e6ff' },
      clyde: { body: '#ffb852' },
      strict: { body: '#ff2b2b' }, // legacy
      coder:  { body: '#00e6ff' },
      dean:   { body: '#b468ff' },
      fright: { body: '#2121ff' },
      flash:  { body: '#ffffff' },
      eyes:   { sclera: '#ffffff', iris: '#1e2aff' },
    },
  };

  // --- Общие константы геймплея (перекрываются per-floor difficulty) ---
  const GAME = {
    frightTime:      6,
    semesterTime:    130,          // fallback, каждый этаж выставляет свой
    speedBoostTime:  5,
    speedBoostMult:  1.5,
    examScore:       100,
    bonusLifetime:   10,
    bonusInterval:   15,
    // Fallback-тайл спавна бонуса. Если он неподходящий (стена) — BonusSystem
    // сам найдёт ближайшую проходимую клетку.
    bonusSpawnTile:  { r: 17, c: 13 },
    // Визуальный отклик на Ноутбук (power-pellet).
    powerFlashTime:  0.12,         // длительность белой вспышки
    powerFreezeTime: 0.08,         // короткая заморозка сущностей
    // Пауза-оверлей при переходе между этажами.
    floorTransitionTime: 1.8,
    // Дефолтное расписание фаз (если у этажа не задано своё).
    defaultPhases: [
      ['scatter', 7], ['chase', 20],
      ['scatter', 7], ['chase', 20],
      ['scatter', 5], ['chase', Infinity],
    ],
  };

  const BONUS = {
    COFFEE: 'coffee',
    EXAM:   'exam',
  };

  // --- Утилиты ---
  function wrapC(c) {
    if (c < 0) return COLS - 1;
    if (c >= COLS) return 0;
    return c;
  }
  function tileCenter(r, c) {
    return { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 };
  }
  function pixelToTile(x, y) {
    return { r: Math.floor(y / TILE), c: Math.floor(x / TILE) };
  }
  function sameDir(a, b) {
    return a && b && a.x === b.x && a.y === b.y;
  }

  // --- Экспорт ---
  const App = global.App || (global.App = {});
  App.TILE = TILE;
  App.COLS = COLS;
  App.ROWS = ROWS;
  App.W = W;
  App.H = H;
  App.DIR = DIR;
  App.DIRS = DIRS;
  App.COLORS = COLORS;
  App.GAME = GAME;
  App.BONUS = BONUS;
  App.wrapC = wrapC;
  App.tileCenter = tileCenter;
  App.pixelToTile = pixelToTile;
  App.sameDir = sameDir;
})(window);
