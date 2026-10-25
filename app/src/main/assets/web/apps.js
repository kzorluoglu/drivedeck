(function () {
  'use strict';

  const { state, $, toast } = window.core;
  const { t } = window.i18n;
  t.apply = window.i18n.apply;

  // Like in a Tesla, video, games and the browser are only available while standing still.
  const MAX_PARKED_SPEED = 5;
  const DOCK_KEY = 'dockApps';
  const DOCK_MAX = 6;
  const DOCK_DEFAULT = ['web:assistant', 'web:notes'];
  const LONG_PRESS_MS = 550;

  const webApps = [];
  let current = null;

  /**
   * Web apps register themselves with {id, label, color, icon (SVG markup), parkedOnly, mount(el)}.
   * mount may return a cleanup function that runs when the window closes.
   */
  window.WebApps = {
    register(app) {
      webApps.push(app);
    },
    open(id) {
      const app = webApps.find((a) => a.id === id);
      if (app) {
        openWebApp(app);
      }
    },
  };

  function isMoving() {
    return state.driveLock && state.speed > MAX_PARKED_SPEED;
  }

  function openWebApp(app) {
    if (app.parkedOnly && isMoving()) {
      toast(t('Nur im Stand verfügbar'));
      return;
    }
    window.core.closeSheet();
    if (app.launch) {
      app.launch();
      return;
    }
    closeWindow();
    const body = $('app-body');
    $('app-title').textContent = t(app.label);
    $('app-window').hidden = false;
    current = { app, cleanup: app.mount(body) || null };
    t.apply(body);
  }

  function closeWindow() {
    if (current && current.cleanup) {
      current.cleanup();
    }
    current = null;
    $('app-window').hidden = true;
    $('app-body').innerHTML = '';
  }

  $('app-close').addEventListener('click', closeWindow);

  setInterval(() => {
    if (current && current.app.parkedOnly && isMoving()) {
      closeWindow();
      toast(t('App wegen Fahrt geschlossen'));
    }
  }, 1000);

  /**
   * Calls onLongPress after a long touch and suppresses the click that follows it.
   */
  function onPress(el, onClick, onLongPress) {
    let timer = null;
    let fired = false;
    el.addEventListener('pointerdown', () => {
      fired = false;
      timer = setTimeout(() => {
        fired = true;
        onLongPress();
      }, LONG_PRESS_MS);
    });
    const cancel = () => clearTimeout(timer);
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('click', () => {
      if (!fired) {
        onClick();
      }
    });
  }

  function appTile(label, iconNode, locked, onClick, id) {
    const tile = document.createElement('button');
    tile.className = 'app-tile';
    tile.classList.toggle('locked', locked);
    tile.classList.toggle('pinned', dockIds.includes(id));
    tile.appendChild(iconNode);
    const name = document.createElement('span');
    name.textContent = label;
    tile.appendChild(name);
    onPress(tile, onClick, () => togglePin(id));
    return tile;
  }

  // Dock shortcuts, stored as "web:<id>" or "pkg:<package>"

  let dockIds = readDock();

  function readDock() {
    try {
      const stored = JSON.parse(localStorage.getItem(DOCK_KEY));
      // shortcuts to installed apps ("pkg:") from older versions are dropped
      return Array.isArray(stored) ? stored.filter((id) => id.startsWith('web:')) : DOCK_DEFAULT.slice();
    } catch (e) {
      return DOCK_DEFAULT.slice();
    }
  }

  function saveDock() {
    try {
      localStorage.setItem(DOCK_KEY, JSON.stringify(dockIds));
    } catch (e) {
      // the dock still works for this session
    }
  }

  function resolve(id) {
    const app = webApps.find((a) => `web:${a.id}` === id);
    return app && { label: app.label, locked: Boolean(app.parkedOnly), web: app, launch: () => openWebApp(app) };
  }

  function togglePin(id) {
    const entry = resolve(id);
    if (dockIds.includes(id)) {
      dockIds = dockIds.filter((d) => d !== id);
      toast(t('{0} aus dem Dock entfernt', t(entry ? entry.label : 'App')));
    } else if (dockIds.length >= DOCK_MAX) {
      toast(t('Dock ist voll, höchstens {0} Apps', DOCK_MAX));
      return;
    } else {
      dockIds.push(id);
      toast(t('{0} zum Dock hinzugefügt', t(entry.label)));
    }
    saveDock();
    renderDock();
    const launcher = document.getElementById('launcher');
    if (launcher) {
      window.core.renderLauncher(launcher);
    }
  }

  let dockMoving = null;

  function renderDock() {
    const dock = $('dock-apps');
    dockMoving = isMoving();
    dock.innerHTML = '';
    dockIds.forEach((id) => {
      const entry = resolve(id);
      if (!entry) {
        return;
      }
      const icon = document.createElement('div');
      icon.style.background = entry.web.color;
      icon.innerHTML = entry.web.icon;
      icon.className = 'dock-app-icon';
      const btn = document.createElement('button');
      btn.className = 'dock-app';
      btn.title = t(entry.label);
      btn.classList.toggle('locked', entry.locked && dockMoving);
      const caption = document.createElement('span');
      caption.className = 'dock-label';
      caption.textContent = t(entry.label);
      btn.appendChild(icon);
      btn.appendChild(caption);
      onPress(btn, entry.launch, () => togglePin(id));
      dock.appendChild(btn);
    });
  }

  // web apps register after this file, so the dock is built once everything has loaded
  window.addEventListener('load', renderDock);
  setInterval(() => {
    if (dockMoving !== isMoving()) {
      renderDock();
    }
  }, 1000);

  window.core.renderLauncher = function (container) {
    container.innerHTML = '';
    const moving = isMoving();

    const ownTitle = document.createElement('h2');
    ownTitle.textContent = t('Apps');
    const ownGrid = document.createElement('div');
    ownGrid.className = 'app-grid';
    webApps.forEach((app) => {
      const icon = document.createElement('div');
      icon.className = 'app-icon';
      icon.style.background = app.color;
      icon.innerHTML = app.icon;
      ownGrid.appendChild(appTile(t(app.label), icon, Boolean(app.parkedOnly) && moving, () => openWebApp(app), `web:${app.id}`));
    });

    const hint = document.createElement('p');
    hint.className = 'credits';
    hint.textContent = t('Lange drücken, um eine App ins Dock zu legen oder daraus zu entfernen.');
    container.append(hint, ownTitle, ownGrid);
  };
})();
