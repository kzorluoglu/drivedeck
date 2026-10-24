(function () {
  'use strict';

  const { device } = window.core;
  const CALL_TIMEOUT_MS = 12000;
  const LOAD_TIMEOUT_MS = 15000;

  const pending = new Map();
  const listeners = [];
  let nextId = 1;

  /**
   * MainActivity answers every bridge call with window.core.native(id, payload). Id 0 carries
   * events from the native side: {event: 'loaded' | 'paired'}.
   */
  window.core.native = function (id, payload) {
    let data;
    try {
      data = JSON.parse(payload);
    } catch (e) {
      data = null;
    }
    if (id === 0) {
      listeners.forEach((fn) => fn(data || {}));
      return;
    }
    const done = pending.get(id);
    if (done) {
      pending.delete(id);
      done(data);
    }
  };

  function onEvent(fn) {
    listeners.push(fn);
    return () => listeners.splice(listeners.indexOf(fn), 1);
  }

  function call(start) {
    return new Promise((resolve) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ error: 'Zeitüberschreitung' });
      }, CALL_TIMEOUT_MS);
      pending.set(id, (data) => {
        clearTimeout(timer);
        resolve(data === null ? { error: 'Keine Antwort' } : data);
      });
      start(id);
    });
  }

  const browser = {
    available: Boolean(device && device.browserShow),
    // set once a page was loaded, so other modules only talk to a browser that exists
    used: false,

    eval(expression) {
      return call((id) => device.browserEval(id, expression));
    },

    fillLogin() {
      return call((id) => device.browserFillLogin(id));
    },

    llm(request) {
      return new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, (data) => resolve(data || { error: 'Keine Antwort' }));
        device.llm(id, JSON.stringify(request));
      });
    },

    /**
     * Speech to text, resolves {text} or {error}. Language as tag like "de-DE".
     */
    listen(languageTag) {
      return new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, (data) => resolve(data || { error: 'Keine Antwort' }));
        device.listen(id, languageTag);
      });
    },

    /**
     * Loads a page and resolves when it has finished loading (or after a timeout).
     */
    navigate(url) {
      browser.used = true;
      return new Promise((resolve) => {
        const timer = setTimeout(done, LOAD_TIMEOUT_MS);
        const off = onEvent((e) => {
          if (e.event === 'loaded') {
            done();
          }
        });
        function done() {
          clearTimeout(timer);
          off();
          resolve();
        }
        device.browserLoad(url);
      });
    },

    back() {
      device.browserBack();
    },

    /**
     * Lets the native browser follow a placeholder element, shown once show() is called.
     */
    attach(el) {
      let shown = false;
      let wasShown = false;
      let last = '';

      function place() {
        if (!shown) {
          return;
        }
        const r = el.getBoundingClientRect();
        const key = [r.left, r.top, r.width, r.height].map(Math.round).join();
        if (key !== last) {
          last = key;
          device.browserShow(r.left, r.top, r.width, r.height, window.innerWidth);
        }
      }

      const timer = setInterval(place, 300);
      return {
        show() {
          shown = true;
          last = '';
          place();
        },
        // hides the browser (it keeps running, so music goes on) and shows it again later
        suspend() {
          wasShown = shown;
          shown = false;
          device.browserHide();
        },
        resume() {
          if (wasShown) {
            this.show();
          }
        },
        destroy() {
          clearInterval(timer);
          shown = false;
          device.browserHide();
        },
      };
    },
  };

  window.core.browser = browser;
  window.core.onEvent = onEvent;
})();
