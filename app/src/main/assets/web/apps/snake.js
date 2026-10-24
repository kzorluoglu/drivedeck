(function () {
  'use strict';

  const COLS = 28;
  const ROWS = 15;
  const TICK_MS = 130;
  const SWIPE_MIN_PX = 20;
  const DIRS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

  window.WebApps.register({
    id: 'snake',
    label: 'Snake',
    color: '#16a34a',
    parkedOnly: true,
    icon: '<svg viewBox="0 0 24 24"><path d="M4 18h8a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h9"/><circle cx="19" cy="6" r="1"/></svg>',
    mount(el) {
      el.innerHTML = `
        <div class="snake">
          <canvas></canvas>
          <div class="snake-bar"><span>Punkte <b class="snake-score">0</b></span><button class="snake-new">Neu starten</button></div>
        </div>`;
      const canvas = el.querySelector('canvas');
      const ctx = canvas.getContext('2d');
      let snake;
      let dir;
      let nextDir;
      let food;
      let score;
      let alive;
      let cell = 20;

      function placeFood() {
        do {
          food = [Math.floor(Math.random() * COLS), Math.floor(Math.random() * ROWS)];
        } while (snake.some(([x, y]) => x === food[0] && y === food[1]));
      }

      function reset() {
        snake = [[6, 7], [5, 7], [4, 7]];
        dir = nextDir = 'right';
        score = 0;
        alive = true;
        placeFood();
        el.querySelector('.snake-score').textContent = score;
      }

      function draw() {
        ctx.fillStyle = '#16171a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#e5484d';
        ctx.beginPath();
        ctx.arc((food[0] + 0.5) * cell, (food[1] + 0.5) * cell, cell * 0.4, 0, Math.PI * 2);
        ctx.fill();
        snake.forEach(([x, y], i) => {
          ctx.fillStyle = i === 0 ? '#4ade80' : '#22c55e';
          ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
        });
        if (!alive) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#fff';
          ctx.font = `${cell * 1.4}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(window.i18n.t('Game over'), canvas.width / 2, canvas.height / 2);
        }
      }

      function tick() {
        if (!alive) {
          return;
        }
        dir = nextDir;
        const [dx, dy] = DIRS[dir];
        const head = [snake[0][0] + dx, snake[0][1] + dy];
        const hitWall = head[0] < 0 || head[1] < 0 || head[0] >= COLS || head[1] >= ROWS;
        if (hitWall || snake.some(([x, y]) => x === head[0] && y === head[1])) {
          alive = false;
          draw();
          return;
        }
        snake.unshift(head);
        if (head[0] === food[0] && head[1] === food[1]) {
          score++;
          el.querySelector('.snake-score').textContent = score;
          placeFood();
        } else {
          snake.pop();
        }
        draw();
      }

      function turn(next) {
        const [dx, dy] = DIRS[next];
        const [cx, cy] = DIRS[dir];
        if (dx !== -cx || dy !== -cy) {
          nextDir = next;
        }
      }

      requestAnimationFrame(() => {
        cell = Math.floor(Math.min(canvas.clientWidth / COLS, canvas.clientHeight / ROWS));
        canvas.width = cell * COLS;
        canvas.height = cell * ROWS;
        draw();
      });

      let start = null;
      canvas.addEventListener('pointerdown', (e) => { start = [e.clientX, e.clientY]; });
      canvas.addEventListener('pointermove', (e) => {
        if (!start) {
          return;
        }
        const dx = e.clientX - start[0];
        const dy = e.clientY - start[1];
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) {
          return;
        }
        if (Math.abs(dx) > Math.abs(dy)) {
          turn(dx > 0 ? 'right' : 'left');
        } else {
          turn(dy > 0 ? 'down' : 'up');
        }
        start = [e.clientX, e.clientY];
      });
      canvas.addEventListener('pointerup', () => { start = null; });

      const keys = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
      const onKey = (e) => {
        if (keys[e.key]) {
          turn(keys[e.key]);
        }
      };
      window.addEventListener('keydown', onKey);
      el.querySelector('.snake-new').addEventListener('click', reset);

      reset();
      const timer = setInterval(tick, TICK_MS);
      return () => {
        clearInterval(timer);
        window.removeEventListener('keydown', onKey);
      };
    },
  });
})();
