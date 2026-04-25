/* ============================================================
   input.js — клавиатура (стрелки / WASD / P / R)
   ============================================================ */

(function (global) {
  'use strict';
  const { DIR } = global.App;

  const KEY_TO_DIR = {
    ArrowLeft:  DIR.LEFT,  a: DIR.LEFT,  A: DIR.LEFT,
    ArrowRight: DIR.RIGHT, d: DIR.RIGHT, D: DIR.RIGHT,
    ArrowUp:    DIR.UP,    w: DIR.UP,    W: DIR.UP,
    ArrowDown:  DIR.DOWN,  s: DIR.DOWN,  S: DIR.DOWN,
  };

  function bind(game) {
    // Во время межэтажного перехода (transitionTimer > 0) игра формально
    // не running, но пользователь не должен случайно рестартовать всё
    // нажатием клавиши — эту фазу трактуем как «внутри игры».
    const inTransition = () => (game.state.transitionTimer || 0) > 0;
    const isGameEnded = () =>
      !inTransition() &&
      (!game.state.running || game.state.gameOver || game.state.win || game.state.failed);

    const handler = (e) => {
      if (KEY_TO_DIR[e.key]) {
        if (isGameEnded()) game.newGame();
        game.setPacmanDir(KEY_TO_DIR[e.key]);
        e.preventDefault();
      } else if (e.key === 'p' || e.key === 'P') {
        if (!inTransition()) game.togglePause();
        e.preventDefault();
      } else if (e.key === 'r' || e.key === 'R') {
        game.newGame();
        e.preventDefault();
      } else if (e.key === ' ' || e.key === 'Enter') {
        if (isGameEnded()) game.newGame();
        else if (!inTransition()) game.togglePause();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handler);
  }

  global.App.Input = { bind };
})(window);
