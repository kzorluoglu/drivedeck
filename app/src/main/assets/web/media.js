(function () {
  'use strict';

  // Play/pause button in the dock for whatever plays in the assistant's browser (music or video),
  // also while the browser itself is hidden.
  const { $ } = window.core;
  const POLL_MS = 3000;
  const PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>';
  const PAUSE = '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>';

  const button = $('media-btn');
  let paused = true;

  async function poll() {
    if (!window.core.browser.used) {
      return;
    }
    const status = await window.core.browser.eval('__ai.video("status")');
    if (!status || status.error || !status.duration) {
      button.hidden = true;
      return;
    }
    paused = status.paused;
    button.hidden = false;
    button.innerHTML = paused ? PLAY : PAUSE;
    button.title = status.title || '';
  }

  button.addEventListener('click', async () => {
    await window.core.browser.eval(`__ai.video(${JSON.stringify(paused ? 'play' : 'pause')})`);
    poll();
  });

  setInterval(poll, POLL_MS);
})();
