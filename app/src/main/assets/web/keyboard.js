(function () {
  'use strict';

  // On-screen keyboard in the style of the car UI. The Android keyboard covers half of the 720 px
  // display and squeezes the whole page, so text fields use this one instead (inputmode="none").
  const LAYOUTS = {
    de: [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'ß'],
      ['q', 'w', 'e', 'r', 't', 'z', 'u', 'i', 'o', 'p', 'ü'],
      ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ö', 'ä'],
      ['shift', 'y', 'x', 'c', 'v', 'b', 'n', 'm', '-', 'backspace'],
      ['lang', ',', 'space', '.', 'enter', 'hide'],
    ],
    tr: [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'ğ'],
      ['q', 'w', 'e', 'r', 't', 'y', 'u', 'ı', 'o', 'p', 'ü'],
      ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ş', 'i'],
      ['shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'ö', 'ç', 'backspace'],
      ['lang', ',', 'space', '.', 'enter', 'hide'],
    ],
  };
  const LABELS = { shift: '⇧', backspace: '⌫', space: ' ', enter: '↵', hide: '⌄', lang: 'DE' };
  const UPPER = { i: 'İ', ı: 'I' };

  const panel = document.getElementById('map-panel');
  const osk = document.getElementById('osk');
  let target = null;
  // the keyboard starts in the app language, Turkish has its own letters
  let layout = window.i18n.lang === 'tr' ? 'tr' : 'de';
  let shift = false;

  function isEditable(el) {
    return el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search)$/.test(el.type)));
  }

  function upper(ch) {
    if (layout === 'tr' && UPPER[ch]) {
      return UPPER[ch];
    }
    return ch.toLocaleUpperCase(layout);
  }

  function render() {
    osk.innerHTML = '';
    LAYOUTS[layout].forEach((row) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'osk-row';
      row.forEach((key) => {
        const btn = document.createElement('button');
        btn.className = `osk-key key-${key.length > 1 ? key : 'char'}`;
        btn.dataset.key = key;
        if (key === 'lang') {
          btn.textContent = layout === 'de' ? 'TR' : 'DE';
        } else if (LABELS[key] !== undefined) {
          btn.textContent = LABELS[key];
        } else {
          btn.textContent = shift ? upper(key) : key;
        }
        btn.classList.toggle('on', key === 'shift' && shift);
        rowEl.appendChild(btn);
      });
      osk.appendChild(rowEl);
    });
  }

  function insert(text) {
    const start = target.selectionStart;
    target.setRangeText(text, start, target.selectionEnd, 'end');
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function press(key) {
    switch (key) {
      case 'shift':
        shift = !shift;
        render();
        return;
      case 'lang':
        layout = layout === 'de' ? 'tr' : 'de';
        render();
        return;
      case 'hide':
        target.blur();
        return;
      case 'space':
        insert(' ');
        return;
      case 'backspace': {
        const start = target.selectionStart;
        const end = target.selectionEnd;
        if (start === end && start > 0) {
          target.setRangeText('', start - 1, end, 'end');
        } else {
          target.setRangeText('', start, end, 'end');
        }
        target.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      case 'enter':
        if (target.tagName === 'TEXTAREA') {
          insert('\n');
          return;
        }
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        if (target.form) {
          target.form.requestSubmit();
        }
        return;
      default:
        insert(shift ? upper(key) : key);
        if (shift) {
          shift = false;
          render();
        }
    }
  }

  // keep the focus in the text field while keys are tapped
  osk.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const btn = e.target.closest('.osk-key');
    if (btn && target) {
      btn.classList.add('pressed');
      setTimeout(() => btn.classList.remove('pressed'), 120);
      press(btn.dataset.key);
    }
  });

  // Android decides on the touch itself whether its keyboard opens, so this must run before focus.
  document.addEventListener('pointerdown', (e) => {
    if (isEditable(e.target)) {
      e.target.setAttribute('inputmode', 'none');
    }
  }, true);

  document.addEventListener('focusin', (e) => {
    if (!isEditable(e.target)) {
      return;
    }
    target = e.target;
    target.setAttribute('inputmode', 'none');
    shift = target.tagName === 'TEXTAREA' && !target.value;
    render();
    osk.hidden = false;
    panel.classList.add('osk-open');
  });

  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!isEditable(document.activeElement)) {
        osk.hidden = true;
        panel.classList.remove('osk-open');
        target = null;
      }
    }, 0);
  });
})();
