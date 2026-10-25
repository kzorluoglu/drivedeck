(function () {
  'use strict';

  // The browser as an app of its own. The assistant drives the same browser (open, click, type),
  // the driver sees and touches it here. Layouts: split (map left, browser right), window (over the
  // map) and full (16:9 at the right edge, the map keeps the rest).
  const { device, state: carState } = window.core;
  const MAX_PARKED_SPEED = 5;
  const LAYOUT_KEY = 'browserLayout';
  const HOME = 'https://www.google.com';

  const ICONS = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    reload: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg>',
    split: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/></svg>',
    window: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/></svg>',
    full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  let view = null;
  let waiting = [];
  // sound may go on while driving only when the driver asked for it (music while driving, "in the background")
  let audioOk = false;

  function isMoving() {
    return carState.driveLock && carState.speed > MAX_PARKED_SPEED;
  }

  function storedLayout() {
    try {
      return localStorage.getItem(LAYOUT_KEY) || 'split';
    } catch (e) {
      return 'split';
    }
  }

  window.core.browserView = {
    /** Opens the browser window (other app windows close) and resolves once it shows the page, false while driving. */
    open() {
      if (isMoving()) {
        return Promise.resolve(false);
      }
      if (view) {
        view.show();
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        waiting.push(resolve);
        window.WebApps.open('browser');
      });
    },
    isOpen: () => Boolean(view),
    setLayout(mode) {
      if (view) {
        view.setLayout(mode);
      }
    },
    allowAudio(on) {
      audioOk = on;
    },
  };

  // Driving starts: a video stops unless the driver asked for its sound
  let moving = false;
  setInterval(() => {
    const now = isMoving();
    if (now && !moving && window.core.browser.used && !audioOk) {
      window.core.browser.eval('__ai.video("pause")');
    }
    moving = now;
  }, 1000);

  window.WebApps.register({
    id: 'browser',
    label: 'Browser',
    color: '#2563eb',
    parkedOnly: true,
    icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    mount(el) {
      if (!device || !device.browserShow) {
        el.innerHTML = '<p class="as-note">Der Browser läuft nur in der App.</p>';
        return null;
      }
      el.innerHTML = `
        <div class="br">
          <div class="br-bar">
            <button data-act="back">${ICONS.back}</button>
            <button data-act="reload">${ICONS.reload}</button>
            <form class="br-url"><input type="text" autocomplete="off" spellcheck="false" placeholder="Suchen oder Adresse"></form>
            <button data-layout="split">${ICONS.split}</button>
            <button data-layout="window">${ICONS.window}</button>
            <button data-layout="full">${ICONS.full}</button>
            <button data-act="close">${ICONS.close}</button>
          </div>
          <div class="br-pane"></div>
        </div>`;

      const appRoot = document.getElementById('app');
      const appWindow = document.getElementById('app-window');
      const mapPanel = document.getElementById('map-panel');
      const bar = el.querySelector('.br-bar');
      const form = el.querySelector('.br-url');
      const input = form.querySelector('input');
      const pane = window.core.browser.attach(el.querySelector('.br-pane'));
      let layout = storedLayout();
      let layoutBeforeVideo = null;
      let sheetOpen = false;

      // the window brings its own bar, the title bar of the app window is not needed
      appWindow.classList.add('br-open');

      const controls = document.createElement('div');
      controls.className = 'cinema-controls';
      controls.innerHTML = `
        <button data-layout="window">Fenster</button>
        <button data-layout="split">Halb</button>
        <button data-act="close" class="danger">&times;</button>`;
      window.i18n.apply(controls);

      // 16:9 area on the right edge, full height. The rest of the width stays for the map.
      function cinemaRect() {
        const h = window.innerHeight;
        const w = Math.min(Math.round((h * 16) / 9), window.innerWidth - 420);
        return { x: window.innerWidth - w, y: 0, w, h };
      }

      function setLayout(mode) {
        layout = ['split', 'window', 'full'].includes(mode) ? mode : 'split';
        if (layout !== 'full') {
          try {
            localStorage.setItem(LAYOUT_KEY, layout);
          } catch (e) {
            // the default then
          }
        }
        appWindow.classList.toggle('as-split', layout === 'split');
        appWindow.classList.toggle('as-full', layout === 'full');
        appRoot.classList.toggle('cinema', layout === 'full');
        if (layout === 'full') {
          const r = cinemaRect();
          Object.assign(appWindow.style, { left: `${r.x}px`, top: '0px', width: `${r.w}px`, height: `${r.h}px`, right: 'auto', bottom: 'auto' });
          mapPanel.appendChild(controls);
        } else {
          appWindow.removeAttribute('style');
          controls.remove();
        }
        // the player of a page that goes fullscreen itself gets the same area
        const fs = cinemaRect();
        device.browserFullscreenRect(fs.x, fs.y, fs.w, fs.h, window.innerWidth);
        bar.querySelectorAll('[data-layout]').forEach((b) => b.classList.toggle('on', b.dataset.layout === layout));
        if (window.core.map) {
          setTimeout(() => window.core.map.invalidateSize(), 50);
        }
      }

      function close() {
        document.getElementById('app-close').click();
      }

      function onClick(e) {
        const b = e.target.closest('button');
        if (!b) {
          return;
        }
        if (b.dataset.layout) {
          setLayout(b.dataset.layout);
        } else if (b.dataset.act === 'back') {
          window.core.browser.back();
        } else if (b.dataset.act === 'reload') {
          window.core.browser.eval('location.reload()');
        } else if (b.dataset.act === 'close') {
          close();
        }
      }
      bar.addEventListener('click', onClick);
      controls.addEventListener('click', onClick);

      // an address opens directly, anything else is searched on Google
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) {
          return;
        }
        input.blur();
        const url = /^https?:\/\//i.test(text) ? text
          : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text) ? `https://${text}`
            : `https://www.google.com/search?hl=${window.i18n.lang}&q=${encodeURIComponent(text)}`;
        window.core.browser.navigate(url);
      });

      const offEvent = window.core.onEvent((e) => {
        if (e.event === 'loaded' && e.url && document.activeElement !== input) {
          input.value = e.url;
        } else if (e.event === 'fullscreen') {
          // video fullscreen of the page (e.g. the YouTube button) shows the cinema layout too
          if (e.on && layout !== 'full') {
            layoutBeforeVideo = layout;
            setLayout('full');
          } else if (!e.on && layoutBeforeVideo) {
            setLayout(layoutBeforeVideo);
            layoutBeforeVideo = null;
          }
        }
      });

      // the native browser lies above the page, it steps aside while a sheet of the dock is open
      function onSheet(e) {
        if (e.detail.open && !sheetOpen) {
          sheetOpen = true;
          pane.suspend();
        } else if (!e.detail.open && sheetOpen) {
          sheetOpen = false;
          pane.resume();
        }
      }
      window.addEventListener('sheet', onSheet);

      setLayout(layout);
      pane.show();
      if (!window.core.browser.used) {
        window.core.browser.navigate(HOME);
      }

      view = {
        show() {
          if (!sheetOpen) {
            pane.show();
          }
        },
        setLayout,
      };
      waiting.forEach((resolve) => resolve(true));
      waiting = [];

      return () => {
        view = null;
        offEvent();
        window.removeEventListener('sheet', onSheet);
        pane.destroy();
        appWindow.classList.remove('as-split', 'as-full', 'br-open');
        appWindow.removeAttribute('style');
        appRoot.classList.remove('cinema');
        controls.remove();
        if (window.core.map) {
          setTimeout(() => window.core.map.invalidateSize(), 50);
        }
      };
    },
  });
})();
