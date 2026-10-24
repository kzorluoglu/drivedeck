(function () {
  'use strict';

  const STORAGE_KEY = 'notes';

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function save(notes) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    } catch (e) {
      window.core.toast(window.i18n.t('Notiz konnte nicht gespeichert werden'));
    }
  }

  function title(note) {
    return note.text.split('\n')[0].trim() || window.i18n.t('Neue Notiz');
  }

  // Used by the assistant. Works on the stored notes, the notes app reloads them when it opens.
  window.core.notes = {
    list() {
      return load().map((n) => ({ id: n.id, title: title(n), text: n.text.slice(0, 300), updated: new Date(n.updated).toLocaleString('de-DE') }));
    },
    read(id) {
      const note = load().find((n) => n.id === id);
      return note ? { id: note.id, text: note.text } : { error: 'Notiz nicht gefunden' };
    },
    add(text) {
      const notes = load();
      const note = { id: Date.now(), text, updated: Date.now() };
      notes.unshift(note);
      save(notes);
      return { ok: true, id: note.id };
    },
    append(id, text) {
      const notes = load();
      const note = notes.find((n) => n.id === id);
      if (!note) {
        return { error: 'Notiz nicht gefunden' };
      }
      note.text = note.text ? `${note.text}\n${text}` : text;
      note.updated = Date.now();
      save(notes);
      return { ok: true };
    },
    remove(id) {
      const notes = load();
      if (!notes.some((n) => n.id === id)) {
        return { error: 'Notiz nicht gefunden' };
      }
      save(notes.filter((n) => n.id !== id));
      return { ok: true };
    },
  };

  window.WebApps.register({
    id: 'notes',
    label: 'Notizen',
    color: '#ca8a04',
    icon: '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7M9 7h4"/></svg>',
    mount(el) {
      el.innerHTML = `
        <div class="notes">
          <aside>
            <button class="notes-new">+ Neue Notiz</button>
            <div class="notes-list"></div>
          </aside>
          <div class="notes-editor">
            <textarea placeholder="${window.i18n.t('Notiz schreiben ...')}"></textarea>
            <button class="notes-delete">Löschen</button>
          </div>
        </div>`;
      const list = el.querySelector('.notes-list');
      const editor = el.querySelector('textarea');
      let notes = load();
      let active = notes[0] || null;

      function renderList() {
        list.innerHTML = '';
        notes.forEach((note) => {
          const item = document.createElement('button');
          item.className = 'notes-item';
          item.classList.toggle('on', note === active);
          item.innerHTML = '<b></b><small></small>';
          item.querySelector('b').textContent = title(note);
          item.querySelector('small').textContent = new Date(note.updated).toLocaleString(window.i18n.tag, {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
          });
          item.addEventListener('click', () => select(note));
          list.appendChild(item);
        });
      }

      function select(note) {
        active = note;
        editor.value = note ? note.text : '';
        editor.disabled = !note;
        renderList();
      }

      el.querySelector('.notes-new').addEventListener('click', () => {
        const note = { id: Date.now(), text: '', updated: Date.now() };
        notes.unshift(note);
        save(notes);
        select(note);
        editor.focus();
      });

      el.querySelector('.notes-delete').addEventListener('click', () => {
        if (!active) {
          return;
        }
        notes = notes.filter((n) => n !== active);
        save(notes);
        select(notes[0] || null);
      });

      editor.addEventListener('input', () => {
        if (!active) {
          return;
        }
        active.text = editor.value;
        active.updated = Date.now();
        save(notes);
        renderList();
      });

      select(active);
    },
  });
})();
