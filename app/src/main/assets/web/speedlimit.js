(function () {
  'use strict';

  // Speed limit of the current road from OpenStreetMap (maxspeed tag via Overpass). Shown as a sign
  // next to the speed, the sign turns red when the car is faster than allowed.
  const { state, $ } = window.core;
  const MIN_INTERVAL_MS = 15000;
  const MIN_MOVE_M = 120;
  const MIN_SPEED_KMH = 10;
  const STALE_MS = 90000;
  const TOLERANCE_KMH = 3;
  const IMPLICIT = { 'DE:urban': 50, 'DE:rural': 100, 'AT:urban': 50, 'AT:rural': 100, 'CH:urban': 50, 'CH:rural': 80 };

  const sign = $('speed-limit');
  let last = { at: 0, lat: 0, lng: 0 };
  let limit = null;
  let limitAt = 0;
  let busy = false;

  function parse(value) {
    if (IMPLICIT[value]) {
      return IMPLICIT[value];
    }
    const match = /^(\d+)(\s*mph)?$/.exec(String(value).trim());
    if (!match) {
      return null;
    }
    return Math.round(Number(match[1]) * (match[2] ? 1.609 : 1));
  }

  async function lookup(lat, lng) {
    const query = `[out:json][timeout:10];way(around:25,${lat},${lng})[highway][maxspeed];out tags 6;`;
    const data = await window.core.overpass(query);
    const found = data.elements.map((e) => parse(e.tags.maxspeed)).filter(Boolean);
    return found.length ? found[0] : null;
  }

  function render() {
    const fresh = limit && Date.now() - limitAt < STALE_MS && state.speed > 1;
    sign.hidden = !fresh;
    if (fresh) {
      sign.textContent = limit;
      sign.classList.toggle('over', state.speed > limit + TOLERANCE_KMH);
    }
  }

  window.addEventListener('gps', async (e) => {
    const { latitude, longitude } = e.detail;
    const moved = Math.hypot((latitude - last.lat) * 111000, (longitude - last.lng) * 75000);
    if (busy || state.speed < MIN_SPEED_KMH || Date.now() - last.at < MIN_INTERVAL_MS || moved < MIN_MOVE_M) {
      return;
    }
    busy = true;
    last = { at: Date.now(), lat: latitude, lng: longitude };
    try {
      limit = await lookup(latitude, longitude);
      limitAt = Date.now();
    } catch (err) {
      // no connection, the sign disappears after a while
    }
    busy = false;
  });

  setInterval(render, 500);
})();
