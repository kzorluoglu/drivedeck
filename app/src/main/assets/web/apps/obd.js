(function () {
  'use strict';

  // OBD adapter (ELM327, Bluetooth). Shows live values in the app and in the dock. The adapter has to
  // be paired in the Android Bluetooth settings first.
  const { device, $ } = window.core;
  const POLL_MS = 1000;

  const dockRpm = $('obd-rpm');
  const dockCoolant = $('obd-coolant');
  let lastState = { connected: false };

  function read() {
    try {
      return JSON.parse(device.obdState());
    } catch (e) {
      return { connected: false, status: 'Getrennt' };
    }
  }

  setInterval(() => {
    if (!device || !device.obdState) {
      return;
    }
    lastState = read();
    document.querySelectorAll('.obd-extra').forEach((el) => { el.hidden = !lastState.connected; });
    if (lastState.connected) {
      dockRpm.textContent = lastState.rpm !== undefined ? lastState.rpm : '--';
      dockCoolant.textContent = lastState.coolant !== undefined ? `${lastState.coolant}°` : '--';
    }
  }, POLL_MS);

  window.core.obd = { state: () => lastState };

  window.WebApps.register({
    id: 'obd',
    label: 'OBD',
    color: '#475569',
    icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 12l4-4M12 4v2M4 12h2M18 12h2"/></svg>',
    mount(el) {
      if (!device || !device.obdDevices) {
        el.innerHTML = '<p class="as-note">OBD gibt es nur in der App.</p>';
        return null;
      }
      el.innerHTML = '<div class="obd"><div class="obd-live"></div><h3>Gekoppelte Geräte</h3><div class="obd-list"></div><p class="as-note">Den OBD Adapter zuerst in den Bluetooth Einstellungen von Android koppeln.</p></div>';
      const live = el.querySelector('.obd-live');
      const list = el.querySelector('.obd-list');

      JSON.parse(device.obdDevices()).forEach((d) => {
        const btn = document.createElement('button');
        btn.className = 'obd-device';
        btn.textContent = d.name;
        btn.addEventListener('click', () => device.obdConnect(d.address));
        list.appendChild(btn);
      });
      if (!list.childElementCount) {
        list.innerHTML = '<p class="as-note">Keine gekoppelten Bluetooth Geräte gefunden.</p>';
      }
      const stop = document.createElement('button');
      stop.className = 'obd-device danger';
      stop.textContent = window.i18n.t('Trennen');
      stop.addEventListener('click', () => device.obdDisconnect());
      list.appendChild(stop);

      function render() {
        const s = read();
        live.innerHTML = `<b>${s.status}</b>`
          + (s.connected
            ? `<div class="obd-grid"><span><small>Drehzahl</small><b>${s.rpm !== undefined ? s.rpm : '--'}</b></span>`
              + `<span><small>Tempo</small><b>${s.speed !== undefined ? `${s.speed} km/h` : '--'}</b></span>`
              + `<span><small>Kühlmittel</small><b>${s.coolant !== undefined ? `${s.coolant} °C` : '--'}</b></span>`
              + `<span><small>Tank</small><b>${s.fuel !== undefined ? `${s.fuel} %` : '--'}</b></span></div>`
            : '');
      }
      render();
      const timer = setInterval(render, POLL_MS);
      return () => clearInterval(timer);
    },
  });
})();
