(function () {
  'use strict';

  // Things the phone sends through the pairing page: a destination starts the navigation, text
  // and links become a note.
  const { device, toast } = window.core;
  const { t } = window.i18n;

  async function destination(text) {
    try {
      const places = await window.core.nav.lookup(text);
      const saved = window.core.nav.places.find(text);
      const spot = saved || places[0];
      if (!spot) {
        toast(t('Ziel nicht gefunden: {0}', text));
        return;
      }
      const result = await window.core.nav.start(spot);
      if (result.error) {
        toast(result.error);
      } else {
        toast(t('Ziel vom Handy: {0}', spot.title));
      }
    } catch (e) {
      toast(t('Ziel vom Handy konnte nicht gesucht werden'));
    }
  }

  window.core.onEvent((e) => {
    if (e.event !== 'inbox' || !e.message) {
      return;
    }
    const { type, text } = e.message;
    if (type === 'destination') {
      destination(String(text));
    } else if (type === 'note') {
      window.core.notes.add(String(text));
      toast(t('Notiz vom Handy gespeichert'));
      if (device) {
        device.speak(t('Notiz vom Handy gespeichert'));
      }
    }
  });
})();
