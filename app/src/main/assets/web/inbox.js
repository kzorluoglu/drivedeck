(function () {
  'use strict';

  // Things the phone sends through the pairing page: a destination starts the navigation, text
  // and links become a note.
  const { device, toast } = window.core;

  async function destination(text) {
    try {
      const places = await window.core.nav.lookup(text);
      const saved = window.core.nav.places.find(text);
      const spot = saved || places[0];
      if (!spot) {
        toast(`Ziel nicht gefunden: ${text}`);
        return;
      }
      const result = await window.core.nav.start(spot);
      if (result.error) {
        toast(result.error);
      } else {
        toast(`Ziel vom Handy: ${spot.title}`);
      }
    } catch (e) {
      toast('Ziel vom Handy konnte nicht gesucht werden');
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
      toast('Notiz vom Handy gespeichert');
      if (device) {
        device.speak('Notiz vom Handy gespeichert');
      }
    }
  });
})();
