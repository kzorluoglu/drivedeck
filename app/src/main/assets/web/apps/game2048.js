(function () {
  'use strict';

  const SIZE = 4;
  const BEST_KEY = 'best2048';
  const SWIPE_MIN_PX = 30;

  // index lists of each line in the direction the tiles slide towards
  function lines(direction) {
    const result = [];
    for (let a = 0; a < SIZE; a++) {
      const line = [];
      for (let b = 0; b < SIZE; b++) {
        if (direction === 'left') line.push(a * SIZE + b);
        if (direction === 'right') line.push(a * SIZE + (SIZE - 1 - b));
        if (direction === 'up') line.push(b * SIZE + a);
        if (direction === 'down') line.push((SIZE - 1 - b) * SIZE + a);
      }
      result.push(line);
    }
    return result;
  }

  function readBest() {
    try {
      return Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch (e) {
      return 0;
    }
  }

  window.WebApps.register({
    id: '2048',
    label: '2048',
    color: '#ea580c',
    parkedOnly: true,
    icon: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
    mount(el) {
      el.innerHTML = `
        <div class="g2048">
          <div class="g2048-board"></div>
          <div class="g2048-side">
            <div><small>Punkte</small><b class="g2048-score">0</b></div>
            <div><small>Rekord</small><b class="g2048-best">0</b></div>
            <button class="g2048-new">Neues Spiel</button>
            <p>Wischen zum Schieben</p>
          </div>
        </div>`;
      const boardEl = el.querySelector('.g2048-board');
      let cells = [];
      let score = 0;
      let best = readBest();

      function addTile() {
        const empty = cells.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
        if (empty.length) {
          cells[empty[Math.floor(Math.random() * empty.length)]] = Math.random() < 0.9 ? 2 : 4;
        }
      }

      function canMove() {
        return ['left', 'right', 'up', 'down'].some((d) => lines(d).some((line) => line.some((idx, i) => (
          !cells[idx] || (i > 0 && cells[idx] === cells[line[i - 1]])
        ))));
      }

      function render() {
        boardEl.innerHTML = '';
        cells.forEach((value) => {
          const tile = document.createElement('div');
          tile.className = `g2048-tile v${Math.min(value, 4096)}`;
          tile.textContent = value || '';
          boardEl.appendChild(tile);
        });
        el.querySelector('.g2048-score').textContent = score;
        el.querySelector('.g2048-best').textContent = best;
      }

      function move(direction) {
        let moved = false;
        lines(direction).forEach((line) => {
          const values = line.map((i) => cells[i]).filter(Boolean);
          const merged = [];
          for (let i = 0; i < values.length; i++) {
            if (values[i] === values[i + 1]) {
              merged.push(values[i] * 2);
              score += values[i] * 2;
              i++;
            } else {
              merged.push(values[i]);
            }
          }
          line.forEach((idx, i) => {
            const value = merged[i] || 0;
            if (cells[idx] !== value) {
              moved = true;
            }
            cells[idx] = value;
          });
        });
        if (!moved) {
          return;
        }
        addTile();
        if (score > best) {
          best = score;
          try {
            localStorage.setItem(BEST_KEY, String(best));
          } catch (e) {
            // the record is a convenience only
          }
        }
        render();
        if (!canMove()) {
          window.core.toast(`Spiel vorbei, ${score} Punkte`);
        }
      }

      function reset() {
        cells = new Array(SIZE * SIZE).fill(0);
        score = 0;
        addTile();
        addTile();
        render();
      }

      let start = null;
      boardEl.addEventListener('pointerdown', (e) => { start = [e.clientX, e.clientY]; });
      boardEl.addEventListener('pointerup', (e) => {
        if (!start) {
          return;
        }
        const dx = e.clientX - start[0];
        const dy = e.clientY - start[1];
        start = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) {
          return;
        }
        if (Math.abs(dx) > Math.abs(dy)) {
          move(dx > 0 ? 'right' : 'left');
        } else {
          move(dy > 0 ? 'down' : 'up');
        }
      });

      const keys = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
      const onKey = (e) => {
        if (keys[e.key]) {
          move(keys[e.key]);
        }
      };
      window.addEventListener('keydown', onKey);
      el.querySelector('.g2048-new').addEventListener('click', reset);

      reset();
      return () => window.removeEventListener('keydown', onKey);
    },
  });
})();
