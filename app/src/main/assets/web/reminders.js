(function () {
  'use strict';

  // Timers and reminders, kept over restarts. When one is due the car speaks it and shows a banner.
  const { device, toast } = window.core;
  const { t } = window.i18n;
  const KEY = 'reminders';
  const SHOW_MS = 60000;

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function save(items) {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch (e) {
      toast(t('Erinnerung konnte nicht gespeichert werden'));
    }
  }

  const banner = document.createElement('div');
  banner.className = 'reminder-banner';
  banner.hidden = true;
  banner.innerHTML = '<b></b><button>OK</button>';
  document.getElementById('app').appendChild(banner);
  let hideTimer = null;
  banner.querySelector('button').addEventListener('click', () => { banner.hidden = true; });

  function fire(item) {
    banner.querySelector('b').textContent = item.label;
    banner.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { banner.hidden = true; }, SHOW_MS);
    if (device) {
      device.speak(item.label);
    }
  }

  setInterval(() => {
    const now = Date.now();
    const items = load();
    const due = items.filter((i) => i.due <= now);
    if (due.length) {
      save(items.filter((i) => i.due > now));
      due.forEach(fire);
    }
  }, 3000);

  function describe(item) {
    return { id: item.id, label: item.label, at: new Date(item.due).toLocaleTimeString(window.i18n.tag, { hour: '2-digit', minute: '2-digit' }) };
  }

  window.core.reminders = {
    /**
     * minutes from now, or at: "HH:MM" today (tomorrow if already past).
     */
    add({ minutes, at, label }) {
      let due;
      if (at) {
        const [h, m] = String(at).split(':').map(Number);
        const date = new Date();
        date.setHours(h, m || 0, 0, 0);
        if (date.getTime() <= Date.now()) {
          date.setDate(date.getDate() + 1);
        }
        due = date.getTime();
      } else if (minutes > 0) {
        due = Date.now() + minutes * 60000;
      } else {
        return { error: 'minutes oder at angeben' };
      }
      const item = { id: Date.now(), due, label: label || t('Erinnerung') };
      save([...load(), item]);
      return { ok: true, ...describe(item) };
    },
    list: () => load().map(describe),
    cancel(id) {
      const items = load();
      save(items.filter((i) => i.id !== id));
      return { ok: items.some((i) => i.id === id) };
    },
  };
})();
