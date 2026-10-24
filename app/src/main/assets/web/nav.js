/* global L */
(function () {
  'use strict';

  const { device, $, toast, map } = window.core;

  const PHOTON_URL = 'https://photon.komoot.io/api/';
  const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving/';
  const EARTH_RADIUS = 6371000;
  const STEP_DONE_M = 25;
  const OFF_ROUTE_M = 60;
  const OFF_ROUTE_FIXES = 3;
  const REROUTE_COOLDOWN_MS = 15000;
  const ANNOUNCE_AT_M = [800, 300, 60];

  const DIRECTION = {
    left: 'links',
    right: 'rechts',
    'slight left': 'leicht links',
    'slight right': 'leicht rechts',
    'sharp left': 'scharf links',
    'sharp right': 'scharf rechts',
    straight: 'geradeaus',
    uturn: 'wenden',
  };
  const ARROW_ANGLE = {
    left: -90,
    right: 90,
    'slight left': -45,
    'slight right': 45,
    'sharp left': -135,
    'sharp right': 135,
    straight: 0,
    uturn: 180,
  };

  let position = null;
  let route = null;
  let routeLayers = [];
  let stepIndex = 0;
  let announced = new Set();
  let offRouteFixes = 0;
  let lastReroute = 0;
  let voice = true;

  // Geometry, using a local flat projection which is precise enough for a few kilometres

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function project(origin, point) {
    const cos = Math.cos(toRad(origin[0]));
    return [
      toRad(point[1] - origin[1]) * cos * EARTH_RADIUS,
      toRad(point[0] - origin[0]) * EARTH_RADIUS,
    ];
  }

  function distance(a, b) {
    const [x, y] = project(a, b);
    return Math.hypot(x, y);
  }

  function distanceToSegment(p, a, b) {
    const [ax, ay] = project(p, a);
    const [bx, by] = project(p, b);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq)) : 0;
    return Math.hypot(ax + t * dx, ay + t * dy);
  }

  function distanceToRoute(p) {
    let best = Infinity;
    for (let i = 1; i < route.coords.length; i++) {
      best = Math.min(best, distanceToSegment(p, route.coords[i - 1], route.coords[i]));
    }
    return best;
  }

  // Formatting

  function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function formatDistance(m) {
    if (m >= 1000) {
      return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
    }
    return `${Math.max(0, Math.round(m / 10) * 10)} m`;
  }

  function spokenDistance(m) {
    if (m >= 1000) {
      return `${(m / 1000).toFixed(1).replace('.', ',')} Kilometern`;
    }
    return `${Math.round(m / 50) * 50 || 50} Metern`;
  }

  function formatDuration(seconds) {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
      return `${minutes} min`;
    }
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  }

  function spokenDuration(seconds) {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
      return `${minutes} Minuten`;
    }
    return `${Math.floor(minutes / 60)} Stunden ${minutes % 60} Minuten`;
  }

  /**
   * Turns an OSRM maneuver into a German instruction. OSRM's demo server only returns raw
   * maneuver types, so the wording is built here.
   */
  function instruction(step) {
    const dir = DIRECTION[step.modifier] || '';
    const onto = step.name ? ` auf ${step.name}` : '';
    switch (step.type) {
      case 'arrive':
        return 'Ziel erreicht';
      case 'depart':
        return `Losfahren${onto}`;
      case 'roundabout':
      case 'rotary':
      case 'roundabout turn':
        return step.exit ? `Im Kreisverkehr die ${step.exit}. Ausfahrt nehmen${onto}` : `In den Kreisverkehr${onto}`;
      case 'fork':
        return `An der Gabelung ${dir} halten${onto}`;
      case 'off ramp':
        return `Ausfahrt ${dir} nehmen${onto}`;
      case 'on ramp':
        return `Auffahrt ${dir} nehmen${onto}`;
      case 'merge':
        return `${capitalize(dir)} einfädeln${onto}`;
      case 'end of road':
        return `Am Ende der Straße ${dir} abbiegen${onto}`;
      case 'continue':
      case 'new name':
        return !step.modifier || step.modifier === 'straight' ? `Weiter geradeaus${onto}` : `${capitalize(dir)} halten${onto}`;
      default:
        if (step.modifier === 'uturn') {
          return `Wenden${onto}`;
        }
        if (!step.modifier || step.modifier === 'straight') {
          return `Geradeaus weiter${onto}`;
        }
        return `${capitalize(dir)} abbiegen${onto}`;
    }
  }

  function say(text) {
    if (voice && device) {
      device.speak(text);
    }
  }

  // Search

  const input = $('search-input');
  const results = $('search-results');
  let searchTimer = null;
  let searchRequest = 0;

  function placeLabel(props) {
    const street = [props.street, props.housenumber].filter(Boolean).join(' ');
    const title = props.name || street || props.city || 'Unbekannter Ort';
    const detail = [props.name ? street : null, props.postcode, props.city || props.town || props.village, props.country]
      .filter(Boolean)
      .join(', ');
    return { title, detail };
  }

  async function search(query) {
    const request = ++searchRequest;
    const params = new URLSearchParams({ q: query, limit: '6', lang: 'de' });
    if (position) {
      params.set('lat', position[0]);
      params.set('lon', position[1]);
    }
    try {
      const response = await fetch(`${PHOTON_URL}?${params}`);
      const data = await response.json();
      if (request !== searchRequest) {
        return;
      }
      showResults(data.features || []);
    } catch (e) {
      toast('Suche fehlgeschlagen, Internet prüfen');
    }
  }

  /**
   * Search without touching the search box, for the assistant: [{title, detail, lat, lng, distance}].
   */
  async function lookup(query) {
    const params = new URLSearchParams({ q: query, limit: '5', lang: 'de' });
    if (position) {
      params.set('lat', position[0]);
      params.set('lon', position[1]);
    }
    const response = await fetch(`${PHOTON_URL}?${params}`);
    const data = await response.json();
    return (data.features || []).map((feature) => {
      const { title, detail } = placeLabel(feature.properties);
      const [lng, lat] = feature.geometry.coordinates;
      return { title, detail, lat, lng, distance: position ? formatDistance(distance(position, [lat, lng])) : undefined };
    });
  }

  function showResults(features) {
    results.innerHTML = '';
    if (!features.length) {
      results.innerHTML = '<div class="result empty">Nichts gefunden</div>';
    }
    features.forEach((feature) => {
      const { title, detail } = placeLabel(feature.properties);
      const [lng, lat] = feature.geometry.coordinates;
      const item = document.createElement('button');
      item.className = 'result';
      item.innerHTML = '<b></b><small></small>';
      item.querySelector('b').textContent = title;
      item.querySelector('small').textContent = position
        ? `${formatDistance(distance(position, [lat, lng]))} · ${detail}`
        : detail;
      item.addEventListener('click', () => {
        closeSearch();
        startRoute({ lat, lng, title });
      });
      results.appendChild(item);
    });
    results.hidden = false;
  }

  function closeSearch() {
    results.hidden = true;
    input.value = '';
    input.blur();
  }

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const query = input.value.trim();
    if (query.length < 3) {
      results.hidden = true;
      return;
    }
    searchTimer = setTimeout(() => search(query), 400);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      clearTimeout(searchTimer);
      search(input.value.trim());
    }
  });

  map.on('click', () => {
    results.hidden = true;
  });

  // Long press on the map sets a destination directly.
  map.on('contextmenu', (e) => {
    if (window.core.navCamera.rotated()) {
      return;
    }
    startRoute({ lat: e.latlng.lat, lng: e.latlng.lng, title: 'Markierter Punkt' });
  });

  // Routing

  async function fetchRoute(destination) {
    const url = `${OSRM_URL}${position[1]},${position[0]};${destination.lng},${destination.lat}`
      + '?overview=full&geometries=geojson&steps=true';
    const response = await fetch(url);
    const data = await response.json();
    if (data.code !== 'Ok' || !data.routes.length) {
      throw new Error(data.message || data.code);
    }
    const best = data.routes[0];
    return {
      destination,
      coords: best.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      distance: best.distance,
      duration: best.duration,
      steps: best.legs[0].steps.map((s) => ({
        loc: [s.maneuver.location[1], s.maneuver.location[0]],
        type: s.maneuver.type,
        modifier: s.maneuver.modifier,
        exit: s.maneuver.exit,
        name: s.name,
        distance: s.distance,
        // lane layout at the junction, left to right, only where OpenStreetMap has it
        lanes: s.intersections[0].lanes || null,
      })),
    };
  }

  function drawRoute() {
    routeLayers.forEach((layer) => layer.remove());
    routeLayers = [
      L.polyline(route.coords, { color: '#1b2b57', weight: 12, opacity: 0.9 }).addTo(map),
      L.polyline(route.coords, { color: '#3e6ae1', weight: 7, opacity: 1 }).addTo(map),
      L.circleMarker([route.destination.lat, route.destination.lng], {
        radius: 9, color: '#fff', weight: 3, fillColor: '#e5484d', fillOpacity: 1,
      }).addTo(map),
    ];
  }

  async function startRoute(destination, isReroute) {
    if (!position) {
      toast('Noch kein GPS Signal');
      return false;
    }
    try {
      route = await fetchRoute(destination);
    } catch (e) {
      toast('Route konnte nicht berechnet werden');
      return false;
    }
    // step 0 is "depart" at the current position, the first real maneuver is step 1
    stepIndex = Math.min(1, route.steps.length - 1);
    announced = new Set();
    offRouteFixes = 0;
    drawRoute();
    $('nav-banner').hidden = false;
    $('nav-summary').hidden = false;
    $('search').hidden = true;
    chips.hidden = true;

    if (isReroute) {
      say('Route wird neu berechnet');
    } else {
      say(`Route nach ${destination.title}. ${spokenDuration(route.duration)}.`);
    }
    // the camera follows the car at street level instead of showing the whole route
    window.core.navCamera.start();
    update();
    return true;
  }

  function stopRoute() {
    route = null;
    routeLayers.forEach((layer) => layer.remove());
    routeLayers = [];
    $('nav-banner').hidden = true;
    $('nav-summary').hidden = true;
    $('search').hidden = false;
    showLanes(null);
    window.core.navCamera.stop();
    renderChips();
  }

  $('nav-stop').addEventListener('click', stopRoute);
  $('nav-mute').addEventListener('click', () => {
    voice = !voice;
    $('nav-mute').textContent = voice ? 'Ton an' : 'Ton aus';
  });

  // Lane guidance: shown shortly before a junction that has lane data with a lane to pick.
  const LANE_ANGLE = {
    'sharp left': -135, left: -90, 'slight left': -45, straight: 0, 'slight right': 45, right: 90, 'sharp right': 135, uturn: 180,
  };
  const LANE_SHOW_M = 500;
  let laneKey = '';

  function showLanes(lanes, toNext) {
    const usable = lanes && toNext < LANE_SHOW_M && lanes.length >= 2
      && lanes.some((l) => l.valid) && lanes.some((l) => !l.valid);
    const key = usable ? JSON.stringify(lanes) : '';
    if (key === laneKey) {
      return;
    }
    laneKey = key;
    const bar = $('lane-bar');
    bar.hidden = !usable;
    bar.innerHTML = usable ? lanes.map((lane) => {
      const arrows = lane.indications.filter((i) => LANE_ANGLE[i] !== undefined)
        .map((i) => `<path transform="rotate(${LANE_ANGLE[i]} 12 12)" d="M12 3l6 7h-4.5v11h-3V10H6z"/>`).join('');
      return `<div class="lane ${lane.valid ? 'on' : ''}"><svg viewBox="0 0 24 24">${arrows}</svg></div>`;
    }).join('') : '';
    window.dispatchEvent(new CustomEvent('lanehint', { detail: usable ? lanes : null }));
  }

  function update() {
    if (!route || !position) {
      return;
    }
    let next = route.steps[stepIndex];
    let toNext = distance(position, next.loc);

    if (toNext < STEP_DONE_M) {
      if (next.type === 'arrive') {
        say('Sie haben Ihr Ziel erreicht');
        toast('Ziel erreicht');
        stopRoute();
        return;
      }
      stepIndex++;
      announced = new Set();
      next = route.steps[stepIndex];
      toNext = distance(position, next.loc);
    }

    const text = instruction(next);
    // announce once per threshold, and only the closest one when several are passed at once
    const due = ANNOUNCE_AT_M.filter((m) => toNext <= m && !announced.has(m));
    if (due.length) {
      const closest = Math.min(...due);
      ANNOUNCE_AT_M.filter((m) => m >= closest).forEach((m) => announced.add(m));
      say(closest <= 60 ? text : `In ${spokenDistance(toNext)} ${text.charAt(0).toLowerCase()}${text.slice(1)}`);
    }

    showLanes(next.lanes, toNext);
    $('nav-dist').textContent = formatDistance(toNext);
    $('nav-text').textContent = text;
    const angle = next.type === 'arrive' ? 0 : ARROW_ANGLE[next.modifier] || 0;
    $('nav-arrow').style.transform = `rotate(${angle}deg)`;

    let remaining = toNext;
    for (let i = stepIndex; i < route.steps.length; i++) {
      remaining += route.steps[i].distance;
    }
    const seconds = route.duration * (remaining / route.distance);
    $('nav-km').textContent = formatDistance(remaining);
    $('nav-time').textContent = formatDuration(seconds);
    $('nav-eta').textContent = new Date(Date.now() + seconds * 1000)
      .toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }

  function status() {
    if (!route) {
      return { active: false };
    }
    const next = route.steps[stepIndex];
    let remaining = position ? distance(position, next.loc) : 0;
    for (let i = stepIndex; i < route.steps.length; i++) {
      remaining += route.steps[i].distance;
    }
    const seconds = route.duration * (remaining / route.distance);
    return {
      active: true,
      destination: route.destination.title,
      remaining: formatDistance(remaining),
      duration: formatDuration(seconds),
      arrival: new Date(Date.now() + seconds * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
      next: instruction(next),
      distanceToNext: position ? formatDistance(distance(position, next.loc)) : undefined,
      seconds,
    };
  }

  // Saved places ("Zuhause", "Arbeit", ...), stored as [{name, title, lat, lng}]

  const PLACES_KEY = 'places';
  const chips = document.createElement('div');
  chips.className = 'place-chips';
  $('map-panel').appendChild(chips);

  function loadPlaces() {
    try {
      return JSON.parse(localStorage.getItem(PLACES_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function savePlaces(places) {
    try {
      localStorage.setItem(PLACES_KEY, JSON.stringify(places));
    } catch (e) {
      toast('Ort konnte nicht gespeichert werden');
    }
    renderChips();
  }

  function renderChips() {
    chips.innerHTML = '';
    loadPlaces().forEach((place) => {
      const chip = document.createElement('button');
      chip.className = 'place-chip';
      chip.textContent = place.name;
      chip.addEventListener('click', () => startRoute(place));
      chips.appendChild(chip);
    });
    chips.hidden = !chips.childElementCount || Boolean(route);
  }
  renderChips();

  function normalize(text) {
    return text.trim().toLowerCase();
  }

  const places = {
    list: () => loadPlaces().map((p) => ({ name: p.name, title: p.title })),
    find(query) {
      const q = normalize(query);
      return loadPlaces().find((p) => normalize(p.name) === q) || null;
    },
    save(name, spot) {
      const rest = loadPlaces().filter((p) => normalize(p.name) !== normalize(name));
      rest.push({ name: name.trim(), title: spot.title || name, lat: spot.lat, lng: spot.lng });
      savePlaces(rest);
    },
    remove(name) {
      const before = loadPlaces();
      const rest = before.filter((p) => normalize(p.name) !== normalize(name));
      savePlaces(rest);
      return rest.length < before.length;
    },
  };

  // Nearby places from OpenStreetMap (Overpass), around the car or along the route

  // The public Overpass servers are often busy, so a few mirrors are tried one after the other.
  const OVERPASS_URLS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];

  async function overpass(query) {
    let failure;
    for (const url of OVERPASS_URLS) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          body: `data=${encodeURIComponent(query)}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: AbortSignal.timeout(12000),
        });
        if (response.ok) {
          return await response.json();
        }
        failure = new Error(`HTTP ${response.status}`);
      } catch (e) {
        failure = e;
      }
    }
    throw failure;
  }
  window.core.overpass = overpass;

  const POI_FILTERS = {
    fuel: '["amenity"="fuel"]',
    charging: '["amenity"="charging_station"]',
    parking: '["amenity"="parking"]',
    restaurant: '["amenity"="restaurant"]',
    cafe: '["amenity"="cafe"]',
    pharmacy: '["amenity"="pharmacy"]',
    supermarket: '["shop"="supermarket"]',
    hospital: '["amenity"="hospital"]',
    atm: '["amenity"="atm"]',
    toilets: '["amenity"="toilets"]',
  };
  const ALONG_ROUTE_M = 600;
  const ALONG_ROUTE_POINTS = 40;

  async function nearby(category, radius, alongRoute) {
    const filter = POI_FILTERS[category];
    if (!filter) {
      return { error: `Unbekannte Kategorie, erlaubt: ${Object.keys(POI_FILTERS).join(', ')}` };
    }
    if (!position) {
      return { error: 'Noch kein GPS Signal' };
    }
    let area = `around:${Math.min(Math.max(radius || 3000, 300), 20000)},${position[0]},${position[1]}`;
    if (alongRoute && route) {
      const step = Math.max(1, Math.floor(route.coords.length / ALONG_ROUTE_POINTS));
      const sampled = route.coords.filter((_, i) => i % step === 0);
      area = `around:${ALONG_ROUTE_M},${sampled.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(',')}`;
    }
    const query = `[out:json][timeout:15];nwr(${area})${filter};out center 60;`;
    try {
      const data = await overpass(query);
      return data.elements
        .map((e) => {
          const lat = e.lat !== undefined ? e.lat : e.center && e.center.lat;
          const lng = e.lon !== undefined ? e.lon : e.center && e.center.lon;
          const tags = e.tags || {};
          const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
          return {
            title: tags.name || tags.brand || tags.operator || category,
            detail: [street, tags['addr:city']].filter(Boolean).join(', '),
            lat,
            lng,
            meters: lat === undefined ? Infinity : distance(position, [lat, lng]),
            opening: tags.opening_hours,
          };
        })
        .filter((p) => p.lat !== undefined)
        .sort((a, b) => a.meters - b.meters)
        .slice(0, 8)
        .map((p) => ({ ...p, distance: formatDistance(p.meters) }));
    } catch (e) {
      return { error: 'Suche fehlgeschlagen, Internet prüfen' };
    }
  }

  // Used by the assistant
  window.core.nav = {
    places,
    nearby,
    position: () => position,
    destination: () => (route ? { ...route.destination, seconds: status().seconds } : null),
    lookup,
    async start(destination) {
      const ok = await startRoute(destination);
      return ok ? { ok: true, ...status() } : { error: position ? 'Route konnte nicht berechnet werden' : 'Noch kein GPS Signal' };
    },
    stop() {
      stopRoute();
      return { ok: true };
    },
    status,
  };

  window.addEventListener('gps', (e) => {
    position = [e.detail.latitude, e.detail.longitude];
    if (!route) {
      return;
    }
    if (distanceToRoute(position) > OFF_ROUTE_M) {
      offRouteFixes++;
      if (offRouteFixes >= OFF_ROUTE_FIXES && Date.now() - lastReroute > REROUTE_COOLDOWN_MS) {
        lastReroute = Date.now();
        startRoute(route.destination, true);
        return;
      }
    } else {
      offRouteFixes = 0;
    }
    update();
  });
})();
