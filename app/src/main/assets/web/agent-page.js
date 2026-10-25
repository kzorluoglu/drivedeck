// Injected by the app into every page of the assistant's browser, defines window.__ai (idempotent).
(function () {
  if (window.__ai) {
    return;
  }
  var elements = [];

  function visible(el) {
    var r = el.getBoundingClientRect();
    var st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  }

  function setValue(el, value) {
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function label(el) {
    var text = el.getAttribute('aria-label') || el.innerText || el.placeholder || el.title || el.name || '';
    if (!text && el.type !== 'password') {
      text = el.value || '';
    }
    return String(text).replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  window.__ai = {
    read: function () {
      elements = Array.prototype.slice
        .call(document.querySelectorAll('a[href],button,input,textarea,select,[role=button],[role=link],[onclick]'))
        .filter(visible)
        .slice(0, 80);
      return {
        url: location.href,
        title: document.title,
        text: (document.body ? document.body.innerText : '').replace(/\n\s*\n+/g, '\n').slice(0, 3500),
        elements: elements.map(function (el, i) {
          return { id: i + 1, tag: el.tagName.toLowerCase(), type: el.type || undefined, label: label(el) };
        }),
      };
    },
    click: function (id) {
      var el = elements[id - 1];
      if (!el) {
        return { error: 'Unbekannte id, erst read_page aufrufen' };
      }
      el.scrollIntoView({ block: 'center' });
      el.click();
      return { ok: true };
    },
    type: function (id, text, submit) {
      var el = elements[id - 1];
      if (!el) {
        return { error: 'Unbekannte id, erst read_page aufrufen' };
      }
      el.scrollIntoView({ block: 'center' });
      el.focus();
      setValue(el, text);
      if (submit) {
        if (el.form && el.form.requestSubmit) {
          el.form.requestSubmit();
        } else {
          ['keydown', 'keypress', 'keyup'].forEach(function (type) {
            el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          });
        }
      }
      return { ok: true };
    },
    scroll: function (dir) {
      window.scrollBy(0, (dir === 'up' ? -1 : 1) * window.innerHeight * 0.8);
      return { y: Math.round(window.scrollY), max: Math.round(document.documentElement.scrollHeight - window.innerHeight) };
    },
    // Label and kind of an element of the last read, to check it before a click.
    info: function (id) {
      var el = elements[id - 1];
      if (!el) {
        return { error: 'Unbekannte id, erst read_page aufrufen' };
      }
      return { label: label(el), tag: el.tagName.toLowerCase(), type: el.type || '', form: Boolean(el.form), href: el.href || '' };
    },
    video: function (action) {
      var videos = Array.prototype.slice.call(document.querySelectorAll('video'));
      // a hidden player (music in the background) has no size, so fall back to the first video
      var v = videos.filter(visible)[0] || videos[0];
      if (!v) {
        return { error: 'Kein Video auf der Seite' };
      }
      if (action === 'pause') {
        v.pause();
      } else if (action === 'play') {
        v.play();
      } else if (action === 'mute') {
        v.muted = true;
      } else if (action === 'unmute') {
        v.muted = false;
      }
      return { paused: v.paused, muted: v.muted, time: Math.round(v.currentTime), duration: Math.round(v.duration || 0), title: document.title };
    },
    // Leaves only the video player on the page, filling the whole browser (YouTube and the like).
    minimal: function () {
      var v = document.querySelector('video');
      if (!v) {
        return { error: 'Kein Video auf der Seite' };
      }
      var box = v.closest('#player-container-id, .player-container, #player, .html5-video-player') || v.parentElement;
      box.setAttribute('data-ai-player', '');
      var style = document.getElementById('__ai-minimal') || document.createElement('style');
      style.id = '__ai-minimal';
      style.textContent =
        'html,body{overflow:hidden!important;background:#000!important}' +
        '[data-ai-player]{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;' +
        'max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;transform:none!important;' +
        'z-index:2147483647!important;background:#000!important}' +
        '[data-ai-player] video{left:0!important;top:0!important;width:100%!important;height:100%!important;object-fit:contain!important}';
      document.head.appendChild(style);
      window.scrollTo(0, 0);
      window.dispatchEvent(new Event('resize'));
      return { ok: true };
    },
    // Fills the user name and, when the page already shows it, the password (Google asks in two steps).
    fill: function (user, pass) {
      var inputs = Array.prototype.slice.call(document.querySelectorAll('input')).filter(visible);
      var passField = inputs.filter(function (i) { return i.type === 'password'; })[0];
      var userField = inputs.filter(function (i) {
        return /^(email|text|tel)$/.test(i.type) || !i.type;
      })[0];
      if (userField && !passField) {
        setValue(userField, user);
      } else if (userField && passField) {
        setValue(userField, user);
      }
      if (passField) {
        setValue(passField, pass);
      }
      return { user: Boolean(userField), pass: Boolean(passField) };
    },
  };
})();
