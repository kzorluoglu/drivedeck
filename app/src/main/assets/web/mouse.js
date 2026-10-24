(function () {
  'use strict';

  // pointer speed in px/s: starts slow for precise aiming and ramps up while a key stays pressed
  const SPEED_MIN = 260;
  const SPEED_MAX = 1500;
  const RAMP_MS = 1100;
  const HOLD_MS = 450;
  const STEP_PX = 16;
  const REPEAT_DELAY_MS = 150;
  const DOUBLE_MS = 350;
  const TOGGLE_MS = 1200;
  const SCROLL_PER_S = 900;
  const DIRECTIONS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  const core = window.core;
  const state = { x: window.innerWidth / 2, y: window.innerHeight / 2, drag: false, scroll: false };
  const pressed = new Map();
  let cursor = null;
  let enabled = false;
  let frameId = 0;
  let lastFrame = 0;

  function targetAt() {
    cursor.hidden = true;
    const el = document.elementFromPoint(state.x, state.y);
    cursor.hidden = false;
    return el;
  }

  function fire(el, type, init) {
    const options = { bubbles: true, cancelable: true, view: window, clientX: state.x, clientY: state.y, button: 0, ...init };
    const event = type.startsWith('pointer')
      ? new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', isPrimary: true, ...options })
      : new MouseEvent(type, options);
    return el.dispatchEvent(event);
  }

  /**
   * The native browser is its own WebView above the page, so its clicks and scrolls are replayed
   * inside that page, at the same relative position.
   */
  function inPane() {
    const r = core.browser && core.browser.paneRect;
    if (!r || state.x < r.left || state.x > r.right || state.y < r.top || state.y > r.bottom) {
      return null;
    }
    return { fx: (state.x - r.left) / r.width, fy: (state.y - r.top) / r.height };
  }

  function paneCall(p, body) {
    core.browser.eval(
      `(function(){var x=${p.fx}*innerWidth,y=${p.fy}*innerHeight,el=document.elementFromPoint(x,y);${body}})()`,
    );
  }

  function click() {
    const p = inPane();
    if (p) {
      paneCall(p, 'if(el){el.focus&&el.focus();el.click();}');
      return;
    }
    const el = targetAt();
    if (!el) {
      return;
    }
    fire(el, 'pointerdown', { buttons: 1 });
    fire(el, 'mousedown', { buttons: 1 });
    if (el.focus && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
      el.focus();
    }
    fire(el, 'pointerup');
    fire(el, 'mouseup');
    fire(el, 'click');
  }

  function press() {
    const el = inPane() ? null : targetAt();
    if (el) {
      fire(el, 'pointerdown', { buttons: 1 });
      fire(el, 'mousedown', { buttons: 1 });
    }
    state.drag = true;
    cursor.classList.add('drag');
  }

  function release() {
    const el = inPane() ? null : targetAt();
    if (el) {
      fire(el, 'pointerup');
      fire(el, 'mouseup');
    }
    state.drag = false;
    cursor.classList.remove('drag');
  }

  function scroll(dy) {
    const p = inPane();
    if (p) {
      paneCall(p, `window.scrollBy(0,${dy});`);
      return;
    }
    const el = targetAt();
    if (!el) {
      return;
    }
    if (!fire(el, 'wheel', { deltaY: dy, deltaMode: 0 })) {
      return;
    }
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
        node.scrollTop += dy;
        return;
      }
    }
  }

  function draw() {
    cursor.style.transform = `translate(${state.x}px, ${state.y}px)`;
  }

  function moved() {
    draw();
    const el = inPane() ? null : targetAt();
    if (el) {
      fire(el, 'pointermove', { buttons: state.drag ? 1 : 0 });
      fire(el, 'mousemove', { buttons: state.drag ? 1 : 0 });
    }
  }

  function nudge(dx, dy) {
    state.x = Math.min(window.innerWidth - 1, Math.max(0, state.x + dx));
    state.y = Math.min(window.innerHeight - 1, Math.max(0, state.y + dy));
    moved();
  }

  // one loop moves the pointer while any arrow key is down, faster the longer it is held
  function tick(now) {
    frameId = 0;
    if (!enabled || !pressed.size) {
      return;
    }
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    let dx = 0;
    let dy = 0;
    let held = 0;
    pressed.forEach((since, key) => {
      if (now - since < REPEAT_DELAY_MS) {
        return;
      }
      dx += DIRECTIONS[key][0];
      dy += DIRECTIONS[key][1];
      held = Math.max(held, now - since - REPEAT_DELAY_MS);
    });
    if (state.scroll) {
      if (dy) {
        scroll(dy * SCROLL_PER_S * dt);
      }
    } else if (dx || dy) {
      const speed = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * Math.min(1, held / RAMP_MS) ** 2;
      nudge(dx * speed * dt, dy * speed * dt);
    }
    frameId = requestAnimationFrame(tick);
  }

  function typing() {
    const el = document.activeElement;
    return Boolean(el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable));
  }

  function setScroll(on) {
    state.scroll = on;
    cursor.classList.toggle('scroll', on);
    core.toast(on ? 'Maus: Scrollen (hoch/runter)' : 'Maus: Zeiger');
  }

  // centre key: a short press clicks, a long press holds the button (drag), two quick presses switch
  // between moving the pointer and scrolling
  let centerDownAt = 0;
  let centerTimer = null;
  let lastCenterUp = 0;

  function centerDown(e) {
    if (e.repeat) {
      return;
    }
    centerDownAt = performance.now();
    clearTimeout(centerTimer);
    centerTimer = setTimeout(() => {
      centerTimer = null;
      if (!state.scroll) {
        press();
      }
    }, HOLD_MS);
  }

  function centerUp() {
    const now = performance.now();
    if (state.drag) {
      release();
      return;
    }
    if (centerTimer === null && now - centerDownAt >= HOLD_MS) {
      return;
    }
    clearTimeout(centerTimer);
    centerTimer = null;
    if (now - lastCenterUp < DOUBLE_MS) {
      lastCenterUp = 0;
      setScroll(!state.scroll);
      return;
    }
    lastCenterUp = now;
    if (!state.scroll) {
      click();
    }
  }

  // with the mouse off, holding the centre key for a moment switches it on
  let enableTimer = null;

  function onKeyDown(e) {
    if (e.key !== 'Enter' && !(e.key in DIRECTIONS)) {
      return;
    }
    if (!enabled) {
      if (e.key === 'Enter' && !typing() && !e.repeat) {
        enableTimer = setTimeout(() => core.setMouse(true), TOGGLE_MS);
      }
      return;
    }
    if (typing()) {
      return;
    }
    e.preventDefault();
    if (e.key === 'Enter') {
      centerDown(e);
      return;
    }
    if (!pressed.has(e.key)) {
      pressed.set(e.key, performance.now());
      // a tap always moves a little, the loop only takes over when the key is held
      const [sx, sy] = DIRECTIONS[e.key];
      if (state.scroll) {
        scroll(sy * STEP_PX * 4);
      } else {
        nudge(sx * STEP_PX, sy * STEP_PX);
      }
    }
    if (!frameId) {
      lastFrame = performance.now();
      frameId = requestAnimationFrame(tick);
    }
  }

  function onKeyUp(e) {
    if (e.key === 'Enter') {
      clearTimeout(enableTimer);
    }
    if (!enabled) {
      return;
    }
    if (e.key === 'Enter') {
      if (!typing()) {
        e.preventDefault();
        centerUp();
      }
    } else if (e.key in DIRECTIONS) {
      pressed.delete(e.key);
    }
  }

  function build() {
    cursor = document.createElement('div');
    cursor.id = 'vmouse-cursor';
    cursor.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 3l13 8-6 1.5L9 19z"/></svg><span>&#8693;</span>';
    cursor.hidden = true;
    document.body.append(cursor);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', () => {
      pressed.clear();
      if (state.drag) {
        release();
      }
    });
  }

  function show(on) {
    if (!cursor) {
      build();
    }
    enabled = on;
    cursor.hidden = !on;
    if (on) {
      draw();
    } else {
      pressed.clear();
      state.scroll = false;
      cursor.classList.remove('scroll');
      if (state.drag) {
        release();
      }
    }
  }

  // the settings tile and the long press of the centre key both end up here
  core.setMouse = (on) => {
    core.state.vmouse = on;
    try {
      localStorage.setItem('vmouse', on ? '1' : '0');
    } catch (e) {
      // a convenience only
    }
    show(on);
    core.toast(on ? 'Maus an: Pfeiltasten bewegen, Mitte klickt' : 'Maus aus');
  };
  core.vmouse = { show };

  // the key listeners stay active even while the mouse is off, so the long press can switch it on
  build();
  show(Boolean(core.state.vmouse));
})();
