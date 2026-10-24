(function () {
  'use strict';

  const { state, device, $, toast } = window.core;

  // Like in a Tesla, video and games are only available while standing still.
  const MAX_PARKED_SPEED = 5;
  const PARKED_ONLY_PACKAGES = ['com.google.android.youtube', 'com.netflix.mediaclient', 'org.videolan.vlc'];
  const BROWSER_PACKAGE = 'com.android.chrome';
  const DOCK_KEY = 'dockApps';
  const DOCK_MAX = 6;
  const DOCK_DEFAULT = ['pkg:com.spotify.music', 'pkg:com.google.android.youtube', 'web:notes'];
  const LONG_PRESS_MS = 550;

  const webApps = [];
  let current = null;
  let nativeApps = null;

  /**
   * Web apps register themselves with {id, label, color, icon (SVG markup), parkedOnly, mount(el)}.
   * mount may return a cleanup function that runs when the window closes.
   */
  window.WebApps = {
    register(app) {
      webApps.push(app);
    },
  };

  // The browser is the real Chrome, the tile only exists so it sits next to the other apps.
  window.WebApps.register({
    id: 'browser',
    label: 'Browser',
    color: '#2563eb',
    icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>',
    launch() {
      if (!device || !device.launchApp(BROWSER_PACKAGE)) {
        toast('Chrome ist nicht installiert');
      }
    },
  });

  function isMoving() {
    return state.speed > MAX_PARKED_SPEED;
  }

  function openWebApp(app) {
    if (app.parkedOnly && isMoving()) {
      toast('Nur im Stand verfügbar');
      return;
    }
    window.core.closeSheet();
    if (app.launch) {
      app.launch();
      return;
    }
    closeWindow();
    const body = $('app-body');
    $('app-title').textContent = app.label;
    $('app-window').hidden = false;
    current = { app, cleanup: app.mount(body) || null };
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
      toast('App wegen Fahrt geschlossen');
    }
  }, 1000);

  function loadNativeApps() {
    if (!nativeApps) {
      try {
        nativeApps = device ? JSON.parse(device.getApps()) : [];
      } catch (e) {
        nativeApps = [];
      }
      nativeApps.sort((a, b) => a.label.localeCompare(b.label, 'de'));
    }
    return nativeApps;
  }

  function launchNative(app) {
    if (PARKED_ONLY_PACKAGES.includes(app.pkg) && isMoving()) {
      toast('Video nur im Stand');
      return;
    }
    window.core.closeSheet();
    device.launchApp(app.pkg);
  }

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
      return Array.isArray(stored) ? stored : DOCK_DEFAULT.slice();
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
    const [kind, key] = [id.slice(0, 3), id.slice(4)];
    if (kind === 'web') {
      const app = webApps.find((a) => a.id === key);
      return app && { label: app.label, locked: Boolean(app.parkedOnly), web: app, launch: () => openWebApp(app) };
    }
    const app = loadNativeApps().find((a) => a.pkg === key);
    return app && { label: app.label, locked: PARKED_ONLY_PACKAGES.includes(app.pkg), icon: app.icon, launch: () => launchNative(app) };
  }

  function togglePin(id) {
    const entry = resolve(id);
    if (dockIds.includes(id)) {
      dockIds = dockIds.filter((d) => d !== id);
      toast(`${entry ? entry.label : 'App'} aus dem Dock entfernt`);
    } else if (dockIds.length >= DOCK_MAX) {
      toast(`Dock ist voll, höchstens ${DOCK_MAX} Apps`);
      return;
    } else {
      dockIds.push(id);
      toast(`${entry.label} zum Dock hinzugefügt`);
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
      let icon;
      if (entry.web) {
        icon = document.createElement('div');
        icon.style.background = entry.web.color;
        icon.innerHTML = entry.web.icon;
      } else {
        icon = document.createElement('img');
        icon.src = entry.icon;
        icon.alt = '';
      }
      icon.className = 'dock-app-icon';
      const btn = document.createElement('button');
      btn.className = 'dock-app';
      btn.title = entry.label;
      btn.classList.toggle('locked', entry.locked && dockMoving);
      btn.appendChild(icon);
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
    ownTitle.textContent = 'Apps';
    const ownGrid = document.createElement('div');
    ownGrid.className = 'app-grid';
    webApps.forEach((app) => {
      const icon = document.createElement('div');
      icon.className = 'app-icon';
      icon.style.background = app.color;
      icon.innerHTML = app.icon;
      ownGrid.appendChild(appTile(app.label, icon, Boolean(app.parkedOnly) && moving, () => openWebApp(app), `web:${app.id}`));
    });

    const nativeTitle = document.createElement('h2');
    nativeTitle.className = 'sub';
    nativeTitle.textContent = 'Installiert';
    const nativeGrid = document.createElement('div');
    nativeGrid.className = 'app-grid';
    loadNativeApps().forEach((app) => {
      const icon = document.createElement('img');
      icon.className = 'app-icon';
      icon.src = app.icon;
      icon.alt = '';
      const locked = PARKED_ONLY_PACKAGES.includes(app.pkg) && moving;
      nativeGrid.appendChild(appTile(app.label, icon, locked, () => launchNative(app), `pkg:${app.pkg}`));
    });

    const hint = document.createElement('p');
    hint.className = 'credits';
    hint.textContent = 'Lange drücken, um eine App ins Dock zu legen oder daraus zu entfernen.';
    container.append(hint, ownTitle, ownGrid, nativeTitle, nativeGrid);
  };
})();
