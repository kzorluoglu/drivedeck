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
      return;
    }
    try {
      route = await fetchRoute(destination);
    } catch (e) {
      toast('Route konnte nicht berechnet werden');
      return;
    }
    // step 0 is "depart" at the current position, the first real maneuver is step 1
    stepIndex = Math.min(1, route.steps.length - 1);
    announced = new Set();
    offRouteFixes = 0;
    drawRoute();
    $('nav-banner').hidden = false;
    $('nav-summary').hidden = false;
    $('search').hidden = true;

    if (isReroute) {
      say('Route wird neu berechnet');
    } else {
      map.fitBounds(L.latLngBounds(route.coords), { padding: [80, 80] });
      say(`Route nach ${destination.title}. ${spokenDuration(route.duration)}.`);
    }
    update();
  }

  function stopRoute() {
    route = null;
    routeLayers.forEach((layer) => layer.remove());
    routeLayers = [];
    $('nav-banner').hidden = true;
    $('nav-summary').hidden = true;
    $('search').hidden = false;
  }

  $('nav-stop').addEventListener('click', stopRoute);
  $('nav-mute').addEventListener('click', () => {
    voice = !voice;
    $('nav-mute').textContent = voice ? 'Ton an' : 'Ton aus';
  });

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
