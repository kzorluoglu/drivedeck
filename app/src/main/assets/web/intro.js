(function () {
  'use strict';

  // bump the version when the tour gets new slides worth showing again
  const SEEN_KEY = 'introSeen';
  const SEEN_VERSION = '1';
  const core = window.core;

  const ICONS = {
    welcome: '<path d="M3 15l2-5a3 3 0 0 1 3-2h8a3 3 0 0 1 3 2l2 5v3H3z"/><circle cx="7" cy="16" r="1.5"/><circle cx="17" cy="16" r="1.5"/>',
    car: '<path d="M3 15l2-5a3 3 0 0 1 3-2h8a3 3 0 0 1 3 2l2 5v3H3z"/><circle cx="7" cy="16" r="1.5"/><circle cx="17" cy="16" r="1.5"/><path d="M12 3v3M8 4l1 2M16 4l-1 2"/>',
    nav: '<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
    dock: '<rect x="3" y="15" width="18" height="5" rx="2"/><rect x="5" y="16.4" width="3" height="2.2" rx="0.6"/><rect x="10.5" y="16.4" width="3" height="2.2" rx="0.6"/><rect x="16" y="16.4" width="3" height="2.2" rx="0.6"/><path d="M12 4v7M9 8l3 3 3-3"/>',
    assistant: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/><path d="M4 8c-1.2 2.4-1.2 5.6 0 8M20 8c1.2 2.4 1.2 5.6 0 8"/>',
    mouse: '<path d="M6 3l13 8-6 1.5L10 19z"/><path d="M14 15l4 5"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  };

  const TEXT = {
    de: {
      name: 'DE', next: 'Weiter', back: 'Zurück', skip: 'Überspringen', done: "Los geht's",
      slides: [
        ['welcome', 'Willkommen bei DriveDeck', 'Dein Cockpit im Stil des Tesla-UI: 3D-Fahrzeug, Navigation, ein KI-Assistent und kleine Apps. In wenigen Schritten siehst du, was alles geht.'],
        ['car', 'Dein Fahrzeug', 'Tippe unten links auf das Auto-Symbol, um Fahrzeugtyp und Lackfarbe zu wählen. Im Stand öffnest du die Scissor-Türen mit einem Tipp auf das Auto. Beim Fahren drehen sich die Räder mit der GPS-Geschwindigkeit.'],
        ['nav', 'Navigation', 'Tippe auf "Navigieren" und gib ein Ziel ein. Die Route wird mit Sprachansagen geführt und bei Abweichung neu berechnet. Orte lassen sich speichern, Tankstellen oder Ladesäulen findest du in der Nähe und entlang der Route.'],
        ['dock', 'Dock und Apps', 'Unten liegen deine Kurzbefehle. Mit "Apps" siehst du alle Anwendungen und die Einstellungen. Ein langer Druck auf eine App legt sie ins Dock oder nimmt sie wieder heraus.'],
        ['assistant', 'Der Assistent', 'Halte eine Taste der Bedienung 3 Sekunden gedrückt und sag, was du brauchst: Orte suchen, navigieren, Notizen und Timer, Wetter, Musik und Video. Der Assistent bedient einen eingebauten Browser. Dein Passwort sieht er nie.'],
        ['phone', 'Handy koppeln', 'Unter Apps → Einstellungen → Koppeln zeigt die Box einen QR-Code. Scanne ihn mit dem Handy (selbes WLAN oder Hotspot), trage deinen OpenRouter-Schlüssel ein und schicke später Ziele und Links direkt ans Auto.'],
        ['mouse', 'Virtuelle Maus', 'Unter Apps → Einstellungen → Maus, oder die Mitteltaste des Steuerkreuzes etwa eine Sekunde halten. Pfeiltasten bewegen den Zeiger, Mitte klickt, Mitte halten zieht, Mitte zweimal schnell schaltet auf Scrollen.'],
        ['lock', 'Sicher unterwegs', 'Über 5 km/h sind Browser, Spiele und Texteingabe gesperrt, nur Sprache bleibt (abschaltbar unter Apps → Einstellungen → Fahrsperre). Diese Einführung findest du jederzeit unter Apps → Einstellungen → Einführung.'],
      ],
    },
    tr: {
      name: 'TR', next: 'İleri', back: 'Geri', skip: 'Atla', done: 'Başlayalım',
      slides: [
        ['welcome', "DriveDeck'e hoş geldin", 'Tesla arayüzü tarzında kokpit: 3D araç, navigasyon, bir yapay zekâ asistanı ve küçük uygulamalar. Birkaç adımda neler yapabildiğini göreceksin.'],
        ['car', 'Aracın', 'Sol alttaki araba simgesine dokunarak araç tipini ve boya rengini seç. Dururken arabaya dokunursan makas kapılar açılır. Sürerken tekerlekler GPS hızıyla döner.'],
        ['nav', 'Navigasyon', '"Navigasyon" alanına dokun ve bir hedef yaz. Rota sesli yönlendirmeyle takip edilir, sapınca yeniden hesaplanır. Yerleri kaydedebilir, yakındaki ve rota üzerindeki benzinlik ya da şarj istasyonlarını bulabilirsin.'],
        ['dock', 'Dock ve uygulamalar', 'Altta kısayolların var. "Uygulamalar" ile tüm uygulamaları ve ayarları görürsün. Bir uygulamaya uzun basarak onu dock\'a ekleyebilir ya da kaldırabilirsin.'],
        ['assistant', 'Asistan', 'Kumandadaki bir tuşu 3 saniye basılı tut ve ne istediğini söyle: yer ara, navigasyon başlat, not ve zamanlayıcı, hava durumu, müzik ve video. Asistan yerleşik bir tarayıcıyı kullanır. Şifreni hiçbir zaman görmez.'],
        ['phone', 'Telefonu eşleştir', 'Uygulamalar → Ayarlar → Eşleştir altında kutu bir QR kodu gösterir. Telefonla tara (aynı Wi-Fi ya da hotspot), OpenRouter anahtarını gir. Sonra hedefleri ve bağlantıları doğrudan arabaya gönderebilirsin.'],
        ['mouse', 'Sanal fare', 'Uygulamalar → Ayarlar → Fare ile aç ya da yön tuşunun orta tuşunu yaklaşık bir saniye basılı tut. Ok tuşları imleci oynatır, orta tuş tıklar, orta tuşu basılı tutmak sürükler, hızlı iki kez basmak kaydırmaya geçirir.'],
        ['lock', 'Güvenli sürüş', '5 km/s üzerinde tarayıcı, oyunlar ve yazı girişi kilitlenir, sadece ses kalır (isteğe bağlı: Uygulamalar → Ayarlar → Sürüş kilidi). Bu tanıtıma istediğin zaman Uygulamalar → Ayarlar → Tanıtım ile ulaşabilirsin.'],
      ],
    },
    en: {
      name: 'EN', next: 'Next', back: 'Back', skip: 'Skip', done: "Let's go",
      slides: [
        ['welcome', 'Welcome to DriveDeck', 'A Tesla-style cockpit: 3D car, navigation, an AI assistant and small apps. A few steps will show you what it can do.'],
        ['car', 'Your car', 'Tap the car icon at the bottom left to pick the car type and paint colour. When parked, tap the car to open the scissor doors. While driving, the wheels turn with the GPS speed.'],
        ['nav', 'Navigation', 'Tap "Navigate" and enter a destination. The route is guided with voice prompts and recalculated when you leave it. You can save places and find fuel stations or chargers nearby and along the route.'],
        ['dock', 'Dock and apps', 'Your shortcuts sit at the bottom. "Apps" shows every app and the settings. Long press an app to pin it to the dock or remove it.'],
        ['assistant', 'The assistant', 'Hold a key of the controls for 3 seconds and say what you need: find places, navigate, notes and timers, weather, music and video. The assistant operates a built-in browser. It never sees your passwords.'],
        ['phone', 'Pair your phone', 'Under Apps → Settings → Pair the box shows a QR code. Scan it with your phone (same Wi-Fi or hotspot), enter your OpenRouter key, and later send destinations and links straight to the car.'],
        ['mouse', 'Virtual mouse', 'Turn it on under Apps → Settings → Mouse, or hold the centre key of the direction pad for about a second. Arrow keys move the pointer, centre clicks, holding centre drags, pressing centre twice quickly switches to scrolling.'],
        ['lock', 'Safe on the road', 'Above 5 km/h the browser, games and text input are locked, only voice remains (optional: Apps → Settings → Driving lock). You can open this tour any time under Apps → Settings → Intro tour.'],
      ],
    },
  };

  let overlay = null;
  let index = 0;
  let lang = 'de';

  function read(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      // a convenience only, the tour then simply shows again next time
    }
  }

  function render() {
    const t = TEXT[lang];
    const [icon, title, body] = t.slides[index];
    const last = index === t.slides.length - 1;
    overlay.innerHTML = `
      <div class="intro-top">
        <div></div>
        <button class="intro-skip" data-act="close">${last ? '' : t.skip}</button>
      </div>
      <div class="intro-slide">
        <div class="intro-icon"><svg viewBox="0 0 24 24">${ICONS[icon]}</svg></div>
        <h1>${title}</h1>
        <p>${body}</p>
      </div>
      <div class="intro-bottom">
        <button class="intro-btn" data-act="back" ${index === 0 ? 'style="visibility:hidden"' : ''}>${t.back}</button>
        <div class="intro-dots">${t.slides.map((s, i) => `<i class="${i === index ? 'on' : ''}"></i>`).join('')}</div>
        <button class="intro-btn primary" data-act="next">${last ? t.done : t.next}</button>
      </div>`;
  }

  function close() {
    write(SEEN_KEY, SEEN_VERSION);
    document.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('intro-open');
    overlay.remove();
    overlay = null;
  }

  function step(delta) {
    const count = TEXT[lang].slides.length;
    if (index + delta >= count) {
      close();
      return;
    }
    index = Math.max(0, index + delta);
    render();
  }

  // the arrow keys and the centre key of the car work here as well, and must not reach the mouse
  function onKey(e) {
    const action = { ArrowRight: 1, Enter: 1, ArrowLeft: -1 }[e.key];
    if (action === undefined) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'keydown' && !e.repeat) {
      step(action);
    }
  }

  function open() {
    if (overlay) {
      return;
    }
    lang = TEXT[window.i18n.lang] ? window.i18n.lang : 'de';
    index = 0;
    overlay = document.createElement('div');
    overlay.id = 'intro';
    overlay.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) {
        return;
      }
      if (btn.dataset.act === 'next') {
        step(1);
      } else if (btn.dataset.act === 'back') {
        step(-1);
      } else if (btn.dataset.act === 'close') {
        close();
      }
    });
    document.body.append(overlay);
    document.body.classList.add('intro-open');
    document.addEventListener('keydown', onKey, true);
    render();
  }

  // First start: the language of the whole app is chosen once, then the page reloads in it.
  function pickLanguage() {
    let selected = 0;
    const names = { de: 'Deutsch', tr: 'Türkçe', en: 'English' };
    const picker = document.createElement('div');
    picker.id = 'intro';
    function paint() {
      picker.innerHTML = `
        <div></div>
        <div class="intro-slide">
          <div class="intro-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg></div>
          <h1>Sprache · Dil · Language</h1>
          <div class="intro-choices">${window.i18n.langs.map((k, i) => `<button class="intro-btn ${i === selected ? 'primary' : ''}" data-pick="${k}">${names[k]}</button>`).join('')}</div>
        </div>
        <div></div>`;
    }
    function choose(k) {
      window.i18n.setLang(k);
      location.reload();
    }
    picker.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pick]');
      if (btn) {
        choose(btn.dataset.pick);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (!document.body.contains(picker)) {
        return;
      }
      const move = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (move) {
        selected = (selected + move + window.i18n.langs.length) % window.i18n.langs.length;
        paint();
      } else if (e.key === 'Enter') {
        choose(window.i18n.langs[selected]);
      } else {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    }, true);
    paint();
    document.body.append(picker);
    document.body.classList.add('intro-open');
  }

  core.intro = { open };

  window.addEventListener('load', () => {
    if (!window.i18n.chosen) {
      pickLanguage();
    } else if (read(SEEN_KEY) !== SEEN_VERSION) {
      open();
    }
  });
})();
