(function () {
  'use strict';

  const SUGGESTIONS = [
    'Tarkan Şımarık',
    'Sezen Aksu Gidiyorum',
    'Barış Manço Gülpembe',
    'Queen Bohemian Rhapsody',
    'Helene Fischer Atemlos',
    'ABBA Dancing Queen',
    'Adele Someone Like You',
    'Bon Jovi Livin on a Prayer',
  ];

  window.WebApps.register({
    id: 'karaoke',
    label: 'Karaoke',
    color: '#7c3aed',
    parkedOnly: true,
    icon: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    mount(el) {
      let pane = null;

      // Karaoke runs on YouTube in the in-app browser, which has instrumental versions with lyrics.
      function play(song) {
        if (!window.core.browser.available) {
          window.core.toast('Nur in der App verfügbar');
          return;
        }
        el.innerHTML = `
          <div class="karaoke-player">
            <button class="karaoke-back">Zurück zur Liste</button>
            <div class="karaoke-pane"></div>
          </div>`;
        el.querySelector('.karaoke-back').addEventListener('click', () => {
          pane.destroy();
          pane = null;
          list();
        });
        pane = window.core.browser.attach(el.querySelector('.karaoke-pane'));
        pane.show();
        window.core.browser.navigate(`https://m.youtube.com/results?search_query=${encodeURIComponent(`${song} karaoke`)}`);
      }

      function list() {
        el.innerHTML = `
          <div class="karaoke">
            <form class="karaoke-search">
              <input type="text" placeholder="Song oder Interpret" autocomplete="off">
              <button type="submit">Singen</button>
            </form>
            <h3>Vorschläge</h3>
            <div class="karaoke-list"></div>
          </div>`;
        const input = el.querySelector('input');
        el.querySelector('form').addEventListener('submit', (e) => {
          e.preventDefault();
          if (input.value.trim()) {
            play(input.value.trim());
          }
        });
        const songs = el.querySelector('.karaoke-list');
        SUGGESTIONS.forEach((song) => {
          const item = document.createElement('button');
          item.className = 'karaoke-song';
          item.textContent = song;
          item.addEventListener('click', () => play(song));
          songs.appendChild(item);
        });
      }

      list();
      return () => {
        if (pane) {
          pane.destroy();
        }
      };
    },
  });
})();
