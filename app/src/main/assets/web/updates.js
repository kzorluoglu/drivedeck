(function () {
  'use strict';

  // Updates from the GitHub releases without Google Play: the app looks for a newer release, asks, downloads
  // it and hands it to the Android installer, which asks for a last confirmation.
  const core = window.core;
  const { device, state } = core;
  const { t } = window.i18n;
  const CHECK_EVERY_MS = 6 * 3600 * 1000;
  const FIRST_CHECK_MS = 30000;
  const SKIP_KEY = 'updateSkip';
  const LAST_KEY = 'updateLast';
  const MAX_PARKED_SPEED = 5;

  let dialog = null;

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
      // without storage the question simply comes again
    }
  }

  function close() {
    if (dialog) {
      dialog.remove();
      dialog = null;
    }
  }

  function show(title, text, buttons) {
    close();
    dialog = document.createElement('div');
    dialog.id = 'update-dialog';
    dialog.innerHTML = `<div class="update-card"><h2></h2><p></p><div class="update-buttons"></div></div>`;
    dialog.querySelector('h2').textContent = title;
    dialog.querySelector('p').textContent = text;
    const row = dialog.querySelector('.update-buttons');
    buttons.forEach(([label, primary, action]) => {
      const button = document.createElement('button');
      button.textContent = label;
      button.className = primary ? 'primary' : '';
      button.addEventListener('click', action);
      row.appendChild(button);
    });
    document.body.appendChild(dialog);
  }

  async function install(release) {
    const text = t('Wird heruntergeladen ... {0} %', 0);
    show(t('Update {0}', release.version), text, []);
    const off = core.onEvent((e) => {
      if (e.event === 'update' && dialog) {
        if (e.status === 'downloading') {
          dialog.querySelector('p').textContent = t('Wird heruntergeladen ... {0} %', e.percent);
        } else if (e.status === 'failed') {
          show(t('Update fehlgeschlagen'), String(e.message || ''), [[t('Schließen'), true, close]]);
        }
      }
    });
    const result = await core.nativeCall((id) => device.updateInstall(id, release.url));
    off();
    if (result.needsPermission) {
      show(t('Berechtigung nötig'), t('Erlaube DriveDeck in den Android-Einstellungen, Apps zu installieren, und tippe danach noch einmal auf Installieren.'), [
        [t('Installieren'), true, () => install(release)],
        [t('Später'), false, close],
      ]);
    } else if (result.error) {
      show(t('Update fehlgeschlagen'), result.error, [[t('Schließen'), true, close]]);
    } else if (dialog) {
      dialog.querySelector('p').textContent = t('Bestätige die Installation auf dem Bildschirm. Danach die App neu öffnen.');
      dialog.querySelector('.update-buttons').innerHTML = '';
    }
  }

  function offer(release) {
    const size = release.size ? ` (${(release.size / 1048576).toFixed(1)} MB)` : '';
    show(t('Update {0}', release.version), t('Version {0} ist verfügbar, installiert ist {1}.', release.version, release.current) + size, [
      [t('Installieren'), true, () => install(release)],
      [t('Später'), false, close],
      [t('Diese Version überspringen'), false, () => {
        write(SKIP_KEY, release.version);
        close();
      }],
    ]);
  }

  // manual: from the settings, always answers. Automatic: only while parked and not for a skipped version.
  async function check(manual) {
    if (!device || !device.updateCheck) {
      return;
    }
    if (!manual) {
      write(LAST_KEY, String(Date.now()));
      if (!state.autoUpdate || state.speed > MAX_PARKED_SPEED || dialog || document.body.classList.contains('intro-open')) {
        return;
      }
    }
    const release = await core.nativeCall((id) => device.updateCheck(id));
    if (release.error) {
      if (manual) {
        core.toast(t('Update-Suche fehlgeschlagen'));
      }
      return;
    }
    if (!release.available) {
      if (manual) {
        core.toast(t('Die App ist aktuell ({0})', release.current));
      }
      return;
    }
    if (manual || read(SKIP_KEY) !== release.version) {
      offer(release);
    }
  }

  core.updates = { check };

  if (device && device.updateCheck) {
    setTimeout(() => {
      if (Date.now() - Number(read(LAST_KEY) || 0) > CHECK_EVERY_MS) {
        check(false);
      }
    }, FIRST_CHECK_MS);
    setInterval(() => check(false), CHECK_EVERY_MS);
  }
})();
