(function () {
  'use strict';

  // Navigation camera, like in Google Maps: the map follows the car at a close zoom, turns so that
  // the direction of travel points up, and keeps the car in the lower part of the screen.
  const CAR_OFFSET = 0.22; // share of the panel height between the centre and the car
  const MIN_COURSE_KMH = 3;
  const TURN_SMOOTHING = 0.65;

  const core = window.core;
  const map = core.map;
  const panel = document.getElementById('map-panel');
  const mapEl = document.getElementById('map');

  let active = false;
  let heading = 0; // direction of travel in degrees, smoothed
  let rotation = 0; // CSS rotation of the map, accumulated so it never spins the long way round
  core.mapRotation = 0;

  function zoomFor(speedKmh) {
    if (speedKmh < 25) {
      return 18;
    }
    if (speedKmh < 60) {
      return 17;
    }
    return speedKmh < 100 ? 16 : 15;
  }

  // The map is rotated as a whole, so it must be larger than the panel to cover the corners.
  function sizeMap() {
    const diagonal = Math.ceil(Math.hypot(panel.clientWidth, panel.clientHeight));
    mapEl.style.setProperty('--mapd', `${diagonal}px`);
    map.invalidateSize({ animate: false });
  }

  function turnTo(target) {
    rotation += ((target - rotation + 540) % 360) - 180;
    mapEl.style.transform = `rotate(${rotation}deg)`;
    core.mapRotation = rotation;
  }

  function setArrow(deg) {
    const marker = core.carMarker && core.carMarker.getElement();
    const arrow = marker && marker.querySelector('.arrow');
    if (arrow) {
      arrow.style.transform = `rotate(${deg}deg)`;
    }
  }

  const camera = {
    active: () => active,
    rotated: () => active && mapEl.style.transform !== '',

    start() {
      if (active) {
        return;
      }
      active = true;
      panel.classList.add('heading-up');
      sizeMap();
      core.setFollow(true);
      this.update(core.carMarker.getLatLng(), null, core.state.gpsSpeed);
    },

    stop() {
      if (!active) {
        return;
      }
      active = false;
      panel.classList.remove('heading-up');
      mapEl.style.transform = '';
      core.mapRotation = 0;
      rotation = 0;
      sizeMap();
      setArrow(core.lastHeading || 0);
      map.setView(core.carMarker.getLatLng(), 16, { animate: false });
    },

    // touching the map ends the rotation, the recenter button brings it back
    release() {
      if (active) {
        mapEl.style.transform = '';
        core.mapRotation = 0;
        setArrow(core.lastHeading || 0);
      }
    },

    resume() {
      if (active) {
        this.update(core.carMarker.getLatLng(), null, core.state.gpsSpeed);
      }
    },

    update(latLng, course, speedKmh) {
      if (course !== null && !Number.isNaN(course) && speedKmh > MIN_COURSE_KMH) {
        heading = (heading + (((course - heading + 540) % 360) - 180) * TURN_SMOOTHING + 360) % 360;
      }
      turnTo(-heading);
      setArrow(heading + rotation);

      const zoom = zoomFor(speedKmh);
      const rad = (heading * Math.PI) / 180;
      const offset = panel.clientHeight * CAR_OFFSET;
      const carPx = map.project(latLng, zoom);
      const center = map.unproject(carPx.subtract(L.point(-offset * Math.sin(rad), offset * Math.cos(rad))), zoom);
      map.setView(center, zoom, { animate: true, duration: 1, easeLinearity: 1 });
    },
  };

  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      if (active) {
        sizeMap();
      }
    }).observe(panel);
  }

  core.navCamera = camera;
})();
