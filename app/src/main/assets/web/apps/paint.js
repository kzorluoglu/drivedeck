(function () {
  'use strict';

  const COLORS = ['#f2f2f4', '#e5484d', '#f59e0b', '#facc15', '#22c55e', '#3e6ae1', '#a855f7', '#ec4899'];
  const SIZES = [4, 10, 24];
  const BACKGROUND = '#16171a';
  const MAX_UNDO = 20;

  window.WebApps.register({
    id: 'paint',
    label: 'Malen',
    color: '#db2777',
    parkedOnly: true,
    icon: '<svg viewBox="0 0 24 24"><path d="M14 4l6 6-9 9H5v-6z"/><path d="M12 6l6 6"/></svg>',
    mount(el) {
      el.innerHTML = `
        <div class="paint">
          <div class="paint-tools">
            <div class="paint-colors"></div>
            <div class="paint-sizes"></div>
            <button data-tool="eraser">Radierer</button>
            <button data-tool="undo">Rückgängig</button>
            <button data-tool="clear">Leeren</button>
          </div>
          <canvas></canvas>
        </div>`;
      const canvas = el.querySelector('canvas');
      const ctx = canvas.getContext('2d');
      const undo = [];
      let color = COLORS[0];
      let size = SIZES[1];
      let eraser = false;
      let last = null;

      const colorBox = el.querySelector('.paint-colors');
      COLORS.forEach((c, i) => {
        const swatch = document.createElement('button');
        swatch.className = 'swatch';
        swatch.style.background = c;
        swatch.classList.toggle('on', i === 0);
        swatch.addEventListener('click', () => {
          color = c;
          eraser = false;
          colorBox.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('on', s === swatch));
          el.querySelector('[data-tool="eraser"]').classList.remove('on');
        });
        colorBox.appendChild(swatch);
      });

      const sizeBox = el.querySelector('.paint-sizes');
      SIZES.forEach((s, i) => {
        const dot = document.createElement('button');
        dot.className = 'size';
        dot.innerHTML = `<i style="width:${s}px;height:${s}px"></i>`;
        dot.classList.toggle('on', i === 1);
        dot.addEventListener('click', () => {
          size = s;
          sizeBox.querySelectorAll('.size').forEach((d) => d.classList.toggle('on', d === dot));
        });
        sizeBox.appendChild(dot);
      });

      function clear() {
        ctx.fillStyle = BACKGROUND;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // the canvas only gets its final size after the window is laid out
      requestAnimationFrame(() => {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        clear();
      });

      el.querySelector('.paint-tools').addEventListener('click', (e) => {
        const tool = e.target.closest('[data-tool]');
        if (!tool) {
          return;
        }
        if (tool.dataset.tool === 'eraser') {
          eraser = !eraser;
          tool.classList.toggle('on', eraser);
        } else if (tool.dataset.tool === 'undo' && undo.length) {
          ctx.putImageData(undo.pop(), 0, 0);
        } else if (tool.dataset.tool === 'clear') {
          undo.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
          clear();
        }
      });

      function point(e) {
        const rect = canvas.getBoundingClientRect();
        return [e.clientX - rect.left, e.clientY - rect.top];
      }

      canvas.addEventListener('pointerdown', (e) => {
        canvas.setPointerCapture(e.pointerId);
        undo.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
        if (undo.length > MAX_UNDO) {
          undo.shift();
        }
        last = point(e);
        ctx.fillStyle = eraser ? BACKGROUND : color;
        ctx.beginPath();
        ctx.arc(last[0], last[1], (eraser ? size * 2 : size) / 2, 0, Math.PI * 2);
        ctx.fill();
      });

      canvas.addEventListener('pointermove', (e) => {
        if (!last) {
          return;
        }
        const next = point(e);
        ctx.strokeStyle = eraser ? BACKGROUND : color;
        ctx.lineWidth = eraser ? size * 2 : size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(last[0], last[1]);
        ctx.lineTo(next[0], next[1]);
        ctx.stroke();
        last = next;
      });

      const stop = () => { last = null; };
      canvas.addEventListener('pointerup', stop);
      canvas.addEventListener('pointercancel', stop);
    },
  });
})();
