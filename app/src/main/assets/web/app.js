/* global L */
(function () {
  'use strict';

  const DEFAULT_POS = [52.52, 13.405];
  const COMPASS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
  const TYPE_STORAGE_KEY = 'carTypeV2';
  const PAINT_STORAGE_KEY = 'paint';
  const ECO_STORAGE_KEY = 'eco3d';

  // Native bridge from MainActivity, missing when the page is opened in a desktop browser.
  const device = window.TBox || null;

  const state = {
    speed: 0,
    gpsSpeed: 0,
    carType: readStored(TYPE_STORAGE_KEY, 'concept011'),
    doorsOpen: false,
    paint: readStored(PAINT_STORAGE_KEY, 'silver'),
    orbit: false,
    fpsVisible: true,
    eco: readStored(ECO_STORAGE_KEY, '1') === '1',
    vmouse: readStored('vmouse', '0') === '1',
    // above 5 km/h the browser, games and text input are locked, on by default
    driveLock: readStored('driveLock', '1') === '1',
    // listens for "DriveDeck" and hands what follows to the assistant
    wake: readStored('wake', '1') === '1',
    // looks for a newer release on GitHub now and then and asks before installing
    autoUpdate: readStored('autoUpdate', '1') === '1',
  };

  const labels = {
    orbit: (v) => (v ? 'An' : 'Aus'),
    doorsOpen: (v) => (v ? 'Offen' : 'Zu'),
    fpsVisible: (v) => (v ? 'Sichtbar' : 'Versteckt'),
    eco: (v) => (v ? 'Sparsam (30 FPS)' : 'Volle Qualität'),
    vmouse: (v) => (v ? 'An' : 'Aus'),
    driveLock: (v) => (v ? 'An (ab 5 km/h)' : 'Aus'),
    wake: (v) => (v ? 'An' : 'Aus'),
    autoUpdate: (v) => (v ? 'An' : 'Aus'),
  };

  const $ = (id) => document.getElementById(id);

  let toastTimer = null;
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2500);
  }

  // Shared with nav.js, apps.js and the web apps, which load after this file.
  window.core = { state, device, $, toast, t: window.i18n.t, lang: window.i18n.lang };

  function readStored(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function store(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      // storage is a convenience only
    }
  }

  // Clock

  function updateClock() {
    $('clock').textContent = new Date().toLocaleTimeString(window.i18n.tag, { hour: '2-digit', minute: '2-digit' });
  }
  updateClock();
  setInterval(updateClock, 10000);

  // Map

  const map = L.map('map', { zoomControl: false }).setView(DEFAULT_POS, 16);
  const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
  const tileOptions = { maxZoom: 19, maxNativeZoom: 16, attribution: 'Tiles &copy; Esri' };
  L.tileLayer(`${esri}World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, tileOptions).addTo(map);
  L.tileLayer(`${esri}World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, tileOptions).addTo(map);

  const marker = L.marker(DEFAULT_POS, {
    icon: L.divIcon({ className: 'car-marker', html: '<div class="arrow"></div>', iconSize: [30, 30] }),
  }).addTo(map);
  window.core.map = map;
  window.core.carMarker = marker;

  let follow = true;
  window.core.setFollow = (on) => {
    follow = on;
    $('recenter').hidden = on;
  };
  map.on('dragstart', () => {
    follow = false;
    $('recenter').hidden = false;
    window.core.navCamera.release();
  });
  $('recenter').addEventListener('click', () => {
    follow = true;
    $('recenter').hidden = true;
    if (window.core.navCamera.active()) {
      window.core.navCamera.resume();
    } else {
      map.setView(marker.getLatLng(), 16);
    }
  });

  function setHeading(deg) {
    const arrow = marker.getElement() && marker.getElement().querySelector('.arrow');
    if (arrow) {
      arrow.style.transform = `rotate(${deg}deg)`;
    }
    window.core.lastHeading = deg;
    $('course').textContent = `${COMPASS[Math.round(deg / 45) % 8]} ${Math.round(deg)}°`;
  }

  // GPS is the only source for position and speed until an OBD adapter is connected.

  let lastFix = null;

  /**
   * Speed in km/h. Uses the receiver's Doppler speed when the fix has one, otherwise derives it
   * from the distance to the previous fix. Movement within the accuracy radius counts as standing.
   */
  function speedFromFix(pos) {
    const c = pos.coords;
    const previous = lastFix;
    const seconds = previous ? (pos.timestamp - previous.time) / 1000 : 0;
    if (previous && seconds < 0.5) {
      // too close to the previous fix for a stable estimate, keep the last value
      return state.gpsSpeed;
    }
    lastFix = { lat: c.latitude, lng: c.longitude, time: pos.timestamp };
    if (c.speed != null && !Number.isNaN(c.speed)) {
      return c.speed * 3.6;
    }
    if (!previous) {
      return 0;
    }
    const cos = Math.cos((c.latitude * Math.PI) / 180);
    const meters = Math.hypot(c.latitude - previous.lat, (c.longitude - previous.lng) * cos) * 111320;
    if (meters < Math.max(c.accuracy, 5) * 0.5) {
      return 0;
    }
    return (meters / seconds) * 3.6;
  }

  if ('geolocation' in navigator) {
    const onFix = (pos) => {
      const c = pos.coords;
      const latLng = [c.latitude, c.longitude];
      marker.setLatLng(latLng);
      state.gpsSpeed = speedFromFix(pos);
      const course = c.heading != null && !Number.isNaN(c.heading) ? c.heading : null;
      if (course !== null) {
        setHeading(course);
      }
      if (follow) {
        if (window.core.navCamera.active()) {
          window.core.navCamera.update(marker.getLatLng(), course, state.gpsSpeed);
        } else {
          map.setView(latLng, map.getZoom(), { animate: true });
        }
      }
      $('altitude').textContent = c.altitude != null ? `${Math.round(c.altitude)} m` : '--';
      $('accuracy').textContent = `±${Math.round(c.accuracy)} m`;
      $('gps-state').textContent = 'GPS';
      window.dispatchEvent(new CustomEvent('gps', { detail: c }));
    };
    navigator.geolocation.watchPosition(onFix, (err) => {
      $('gps-state').textContent = `GPS: ${err.message}`;
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 });
    // lets tests and tools feed a position
    window.core.gpsFix = onFix;
  } else {
    $('gps-state').textContent = window.i18n.t('Kein GPS');
  }

  function updateSpeed(dt) {
    // smooths the 1 Hz GPS updates into a steady readout
    state.speed += (state.gpsSpeed - state.speed) * Math.min(1, dt * 2);
    if (state.speed < 0.5) {
      state.speed = 0;
    }
    $('speed').textContent = Math.round(state.speed);

    // without OBD the real gear is unknown, so this only tells standing from moving
    const gear = state.speed > 2 ? 'D' : 'P';
    document.querySelectorAll('.gears span').forEach((el) => {
      el.classList.toggle('active', el.dataset.gear === gear);
    });
  }

  // Car type

  const car = window.createCarScene($('car3d'), { eco: state.eco });

  function selectType(key) {
    if (!window.CAR_TYPES[key]) {
      key = 'concept011';
    }
    state.carType = key;
    $('car-type').textContent = window.CAR_TYPES[key].label;
    store(TYPE_STORAGE_KEY, key);
    car.setType(key);
    renderSheet();
  }

  function selectPaint(key) {
    state.paint = key;
    store(PAINT_STORAGE_KEY, key);
    car.setPaint(key);
    renderSheet();
  }

  // Volume, backed by the real Android media volume

  function showVolume() {
    $('vol').textContent = device ? device.getVolume() : '-';
  }

  document.querySelectorAll('[data-vol]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!device) {
        return;
      }
      const next = Math.min(device.getMaxVolume(), Math.max(0, device.getVolume() + Number(btn.dataset.vol)));
      device.setVolume(next);
      showVolume();
    });
  });
  showVolume();
  setInterval(showVolume, 2000);

  // Sheets

  function canOpenDoors() {
    if (state.speed > 2) {
      window.core.toast(window.i18n.t('Türen nur im Stand'));
      return false;
    }
    if (!car.hasDoors()) {
      window.core.toast(window.i18n.t('Dieses Modell hat keine beweglichen Türen'));
      return false;
    }
    return true;
  }

  // Tap on the car toggles the doors, like on the real thing.
  $('car3d').addEventListener('click', () => {
    if (state.doorsOpen || canOpenDoors()) {
      state.doorsOpen = !state.doorsOpen;
      renderSheet();
    }
  });

  setInterval(() => {
    if (state.doorsOpen && state.speed > 2) {
      state.doorsOpen = false;
      renderSheet();
    }
  }, 500);

  // the voice of the navigation follows the app language from the start, not only after the assistant was opened
  if (device && device.setSpeechLanguage) {
    device.setSpeechLanguage(window.i18n.tag);
    if (device.setWake) {
      device.setWake(state.wake, window.i18n.tag);
    }
  }

  const effects = {
    fpsVisible(on) {
      $('fps').hidden = !on;
    },
    driveLock(on) {
      store('driveLock', on ? '1' : '0');
    },
    autoUpdate(on) {
      store('autoUpdate', on ? '1' : '0');
    },
    wake(on) {
      store('wake', on ? '1' : '0');
      if (device && device.setWake) {
        device.setWake(on, window.i18n.tag);
      }
    },
    vmouse(on) {
      window.core.setMouse(on);
    },
    eco(on) {
      // antialiasing and render scale are fixed when the renderer is created
      store(ECO_STORAGE_KEY, on ? '1' : '0');
      location.reload();
    },
  };

  let openSheet = null;
  const sheet = $('sheet');

  function renderSheet() {
    const launcher = sheet.querySelector('#launcher');
    if (launcher && window.core.renderLauncher) {
      window.core.renderLauncher(launcher);
    }
    const tiles = sheet.querySelector('#type-tiles');
    if (tiles) {
      tiles.innerHTML = '';
      Object.entries(window.CAR_TYPES).forEach(([key, type]) => {
        const tile = document.createElement('button');
        tile.className = 'tile';
        tile.dataset.type = key;
        tile.classList.toggle('on', key === state.carType);
        tile.innerHTML = `<b>${window.i18n.t(type.label)}</b><small>${type.length.toFixed(1)} m</small>`;
        tiles.appendChild(tile);
      });
    }
    const paintTiles = sheet.querySelector('#paint-tiles');
    if (paintTiles) {
      const paintable = window.CAR_TYPES[state.carType].paint;
      paintTiles.parentElement.querySelector('.paint-title').hidden = !paintable;
      paintTiles.hidden = !paintable;
      paintTiles.innerHTML = '';
      Object.entries(window.PAINT_COLORS).forEach(([key, paint]) => {
        const tile = document.createElement('button');
        tile.className = 'tile paint-tile';
        tile.dataset.paint = key;
        tile.classList.toggle('on', key === state.paint);
        tile.innerHTML = `<i style="background:#${paint.color.toString(16).padStart(6, '0')}"></i><b>${window.i18n.t(paint.label)}</b>`;
        paintTiles.appendChild(tile);
      });
    }
    sheet.querySelectorAll('[data-label]').forEach((el) => {
      const key = el.dataset.label;
      el.textContent = window.i18n.t(labels[key](state[key]));
      el.parentElement.classList.toggle('on', !!state[key]);
    });
    const version = sheet.querySelector('[data-app-version]');
    if (version) {
      version.textContent = device && device.appVersion ? `Version ${device.appVersion()}` : '';
    }
    const langName = sheet.querySelector('[data-lang-name]');
    if (langName) {
      langName.textContent = { de: 'Deutsch', tr: 'Türkçe', en: 'English' }[window.i18n.lang];
    }
    window.i18n.apply(sheet);
  }

  function showSheet(name) {
    const closing = openSheet === name;
    document.querySelectorAll('.dock-btn').forEach((b) => {
      b.classList.toggle('active', !closing && b.dataset.sheet === name);
    });
    if (closing) {
      sheet.hidden = true;
      openSheet = null;
      return;
    }
    openSheet = name;
    sheet.innerHTML = '';
    sheet.appendChild($(`sheet-${name}`).content.cloneNode(true));
    sheet.hidden = false;
    renderSheet();
  }

  sheet.addEventListener('click', (e) => {
    const tile = e.target.closest('[data-toggle], [data-action], [data-type], [data-paint]');
    if (!tile) {
      return;
    }
    if (tile.dataset.paint) {
      selectPaint(tile.dataset.paint);
      return;
    }
    if (tile.dataset.type) {
      selectType(tile.dataset.type);
      return;
    }
    if (tile.dataset.action === 'update') {
      closeSheet();
      window.core.updates.check(true);
      return;
    }
    if (tile.dataset.action === 'lang') {
      const order = window.i18n.langs;
      window.i18n.setLang(order[(order.indexOf(window.i18n.lang) + 1) % order.length]);
      location.reload();
      return;
    }
    if (tile.dataset.action === 'history' || tile.dataset.action === 'pair') {
      closeSheet();
      window.core.assistant.open(tile.dataset.action);
      return;
    }
    if (tile.dataset.action === 'intro') {
      closeSheet();
      window.core.intro.open();
      return;
    }
    if (tile.dataset.action === 'reload') {
      location.reload();
      return;
    }
    const key = tile.dataset.toggle;
    if (key === 'doorsOpen' && !state.doorsOpen && !canOpenDoors()) {
      return;
    }
    state[key] = !state[key];
    if (effects[key]) {
      effects[key](state[key]);
    }
    renderSheet();
  });

  document.querySelectorAll('.dock-btn').forEach((btn) => {
    btn.addEventListener('click', () => showSheet(btn.dataset.sheet));
  });

  function closeSheet() {
    if (openSheet) {
      showSheet(openSheet);
    }
  }
  window.core.closeSheet = closeSheet;

  map.on('click', closeSheet);

  window.addEventListener('lanehint', (e) => car.setLanes(e.detail));

  car.setPaint(state.paint);
  selectType(state.carType);

  // Render loop with FPS counter

  let last = performance.now();
  let fpsWindowStart = last;
  let framesInWindow = 0;
  let totalFrames = 0;
  let maxFps = 0;

  function frame(now) {
    requestAnimationFrame(frame);

    // nothing to draw while the car panel is hidden (cinema layout) or the app is in the background
    if (document.hidden || !$('car3d').offsetParent) {
      last = now;
      return;
    }
    const interval = state.eco ? 1000 / 30 : 0;
    if (now - last < interval - 4) {
      return;
    }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    updateSpeed(dt);
    car.render(dt, state);

    totalFrames++;
    framesInWindow++;
    if (now - fpsWindowStart >= 1000) {
      const fps = Math.round((framesInWindow * 1000) / (now - fpsWindowStart));
      maxFps = Math.max(maxFps, fps);
      $('fps').textContent = `FPS ${fps} | max ${maxFps} | frames ${totalFrames}`;
      fpsWindowStart = now;
      framesInWindow = 0;
    }
  }
  requestAnimationFrame(frame);
})();
