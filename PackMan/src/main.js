/* ============================================================
   main.js — точка входа: собираем UI-элементы, создаём игру
   ============================================================ */

(function (global) {
  'use strict';
  const { Game, Input } = global.App;

  function boot() {
    const canvas = document.getElementById('game');
    const ui = {
      overlay:  document.getElementById('overlay'),
      startBtn: document.getElementById('startBtn'),
      score:    document.getElementById('score'),
      high:     document.getElementById('high'),
      lives:    document.getElementById('lives'),
      floor:    document.getElementById('floor'),
      time:     document.getElementById('time'),
    };

    const game = new Game(canvas, ui);
    Input.bind(game);
    ui.startBtn.addEventListener('click', () => game.newGame());

    // Клик по оверлею/канвасу тоже стартует игру, если она не идёт —
    // чтобы не пришлось «попадать» по кнопке. Во время межэтажного
    // перехода клики игнорируем — оверлей сам закроется по таймеру.
    const inTransition = () => (game.state.transitionTimer || 0) > 0;
    ui.overlay.addEventListener('click', (e) => {
      if (e.target === ui.startBtn) return;
      if (inTransition()) return;
      game.newGame();
    });
    canvas.addEventListener('click', () => {
      if (inTransition()) return;
      const s = game.state;
      if (!s.running || s.gameOver || s.failed || s.win) game.newGame();
    });

    // Гарантируем, что клавиатурный фокус — у окна, иначе стрелки могут
    // не ловиться, если фокус «застрял» на кнопке после клика.
    window.addEventListener('click', () => {
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
    });

    game.start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
