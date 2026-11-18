/* ============================================================================
   dot — engine + settings
   Defaults come from config.js. Anything changed in the Settings modal is
   stored in localStorage and wins until "Reset to file".
   ============================================================================ */

(function () {
  'use strict';

  const STORE_KEY = 'dot.settings.v1';

  const EASINGS = {
    sine:   t => 0.5 - Math.cos(Math.PI * t) / 2,
    linear: t => t,
    in:     t => t * t,
    out:    t => 1 - (1 - t) * (1 - t),
    inOut:  t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    hold:   () => 0,
  };

  const FALLBACK = {
    colors: { background: '#0d0f12', dot: '#e9e4da' },
    breath: [
      { label: 'Inhale', duration: 4, from: 18, to: 62, easing: 'sine' },
      { label: 'Hold',   duration: 8, from: 62, to: 62, easing: 'linear' },
      { label: 'Exhale', duration: 8, from: 62, to: 18, easing: 'sine' },
      { label: 'Hold',   duration: 4, from: 18, to: 18, easing: 'linear' },
    ],
    freeze: { enabled: false, size: 40 },
    labels: { show: false, countdown: false, color: '#6d7076', size: 13 },
    menu:   { show: true, position: 'bottom-right', autoHide: true },
    startDelay: 0,
    keepAwake: true,
  };

  const FILE_DEFAULTS = normalize(typeof CONFIG !== 'undefined' ? CONFIG : {}, FALLBACK);

  /* --- small helpers ------------------------------------------------------ */

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function isPlain(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  function merge(base, extra) {
    const out = clone(base);
    if (!isPlain(extra)) return out;
    for (const k of Object.keys(extra)) {
      out[k] = isPlain(out[k]) && isPlain(extra[k]) ? merge(out[k], extra[k]) : clone(extra[k]);
    }
    return out;
  }

  function num(v, min, max, fallback) {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    if (typeof n !== 'number' || !isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function hex(v, fallback) {
    if (typeof v !== 'string') return fallback;
    let s = v.trim();
    if (s[0] !== '#') s = '#' + s;
    if (/^#[0-9a-f]{3}$/i.test(s)) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : fallback;
  }

  /* Black or white, whichever stands out against the given color. */
  function contrastInk(color) {
    const r = parseInt(color.slice(1, 3), 16) / 255;
    const g = parseInt(color.slice(3, 5), 16) / 255;
    const b = parseInt(color.slice(5, 7), 16) / 255;
    const lin = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return L > 0.42 ? '#000000' : '#ffffff';
  }

  function get(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  }

  function set(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    let o = obj;
    for (const k of keys) { if (!isPlain(o[k])) o[k] = {}; o = o[k]; }
    o[last] = value;
  }

  /* Sanitise anything coming from config.js or localStorage. */
  function normalize(raw, base) {
    const d = clone(base || FALLBACK);
    const c = merge(d, raw || {});
    c.colors.background = hex(c.colors.background, d.colors.background);
    c.colors.dot        = hex(c.colors.dot, d.colors.dot);

    const steps = Array.isArray(c.breath) && c.breath.length ? c.breath : d.breath;
    c.breath = steps.filter(isPlain).map(p => ({
      label:    typeof p.label === 'string' ? p.label : '',
      duration: num(p.duration, 0, 3600, 4),
      from:     num(p.from, 1, 100, 20),
      to:       num(p.to, 1, 100, 60),
      easing:   EASINGS[p.easing] ? p.easing : 'sine',
    }));
    if (!c.breath.length) c.breath = clone(d.breath);

    c.freeze.enabled = !!c.freeze.enabled;
    c.freeze.size    = num(c.freeze.size, 1, 100, d.freeze.size);

    c.labels.show      = !!c.labels.show;
    c.labels.countdown = !!c.labels.countdown;
    c.labels.color     = hex(c.labels.color, d.labels.color);
    c.labels.size      = num(c.labels.size, 8, 80, d.labels.size);

    c.menu.show     = !!c.menu.show;
    c.menu.autoHide = !!c.menu.autoHide;
    if (!/^(top|bottom)-(left|right)$/.test(c.menu.position)) c.menu.position = d.menu.position;

    c.startDelay = num(c.startDelay, 0, 3600, 0);
    c.keepAwake  = !!c.keepAwake;
    return c;
  }

  /* --- state -------------------------------------------------------------- */

  let cfg = load();
  let idx = 0;          // current step
  let phaseT = 0;       // seconds into that step
  let delayLeft = 0;    // start delay remaining
  let paused = false;
  let last = 0;
  let vmin = 0;
  let lastLabel = null;
  let lastCount = null;
  let idleTimer = null;
  let wakeLock = null;

  const el = {};
  for (const id of ['dot', 'caption', 'label', 'countdown', 'menu', 'menu-btn', 'menu-list',
                    'modal', 'modal-scrim', 'modal-box', 'close', 'done', 'phases', 'add-phase',
                    'cycle-total', 'copy-config', 'show-config', 'reset', 'config-text']) {
    el[id] = document.getElementById(id);
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return normalize(JSON.parse(raw), FILE_DEFAULTS);
    } catch (e) { /* corrupt or blocked storage — fall through to the file */ }
    return clone(FILE_DEFAULTS);
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) { /* private mode */ }
  }

  /* --- the animation ------------------------------------------------------ */

  function totalDuration() {
    return cfg.breath.reduce((s, p) => s + p.duration, 0);
  }

  function restart() {
    idx = 0;
    phaseT = 0;
    delayLeft = cfg.startDelay;
    paused = false;
    syncPauseLabel();
  }

  function advance(dt) {
    if (delayLeft > 0) {
      delayLeft -= dt;
      if (delayLeft > 0) return;
      dt = -delayLeft;
      delayLeft = 0;
    }
    if (totalDuration() <= 0) return;   // every step is 0s — just sit still
    phaseT += dt;
    let guard = 0;
    while (phaseT >= cfg.breath[idx].duration && guard++ < 500) {
      phaseT -= cfg.breath[idx].duration;
      idx = (idx + 1) % cfg.breath.length;
    }
  }

  function currentSize() {
    if (cfg.freeze.enabled) return cfg.freeze.size;
    const p = cfg.breath[idx];
    if (!p) return 30;
    if (delayLeft > 0) return p.from;
    const t = p.duration > 0 ? Math.min(phaseT / p.duration, 1) : 1;
    return p.from + (p.to - p.from) * EASINGS[p.easing](t);
  }

  function frame(now) {
    const dt = last ? Math.min((now - last) / 1000, 0.25) : 0;
    last = now;
    if (!paused && !cfg.freeze.enabled) advance(dt);
    draw();
    requestAnimationFrame(frame);
  }

  function draw() {
    const px = (currentSize() / 100) * vmin;
    const s = px.toFixed(1) + 'px';
    el.dot.style.width = s;
    el.dot.style.height = s;

    if (!cfg.labels.show && !cfg.labels.countdown) return;

    const p = cfg.breath[idx];
    const name = cfg.freeze.enabled ? 'Frozen' : delayLeft > 0 ? '' : (p ? p.label : '');
    const text = cfg.labels.show ? name : '';
    if (text !== lastLabel) { el.label.textContent = text; lastLabel = text; }

    let cd = '';
    if (cfg.labels.countdown && !cfg.freeze.enabled) {
      const left = delayLeft > 0 ? delayLeft : (p ? p.duration - phaseT : 0);
      cd = left > 0 ? String(Math.ceil(left - 0.001)) : '';
    }
    if (cd !== lastCount) { el.countdown.textContent = cd; lastCount = cd; }
  }

  function measure() {
    vmin = Math.min(window.innerWidth, window.innerHeight);
  }

  /* --- applying config to the page ---------------------------------------- */

  function apply() {
    const root = document.documentElement.style;
    root.setProperty('--bg', cfg.colors.background);
    root.setProperty('--dot', cfg.colors.dot);
    root.setProperty('--onbg', contrastInk(cfg.colors.background));
    root.setProperty('--cap', cfg.labels.color);
    root.setProperty('--cap-size', cfg.labels.size + 'px');

    el.caption.style.display = (cfg.labels.show || cfg.labels.countdown) ? '' : 'none';
    if (!cfg.labels.show) { el.label.textContent = ''; lastLabel = ''; }
    if (!cfg.labels.countdown) { el.countdown.textContent = ''; lastCount = ''; }

    el.menu.hidden = !cfg.menu.show;
    el.menu.className = 'pos-' + cfg.menu.position;
    if (!cfg.menu.show) closeMenu();

    if (idx >= cfg.breath.length) { idx = 0; phaseT = 0; }
    requestWakeLock();
    draw();
  }

  /* --- three-dot menu ------------------------------------------------------ */

  function menuOpen() { return !el['menu-list'].hidden; }

  function openMenu() {
    el['menu-list'].hidden = false;
    el.menu.classList.add('open');
    el['menu-btn'].setAttribute('aria-expanded', 'true');
    syncPauseLabel();
  }

  function closeMenu() {
    el['menu-list'].hidden = true;
    el.menu.classList.remove('open');
    el['menu-btn'].setAttribute('aria-expanded', 'false');
  }

  function syncPauseLabel() {
    const b = el['menu-list'].querySelector('[data-act="pause"]');
    if (b) b.childNodes[0].nodeValue = paused ? 'Resume' : 'Pause';
  }

  function poke() {
    el.menu.classList.remove('idle');
    document.body.classList.remove('hide-cursor');
    clearTimeout(idleTimer);
    if (!cfg.menu.autoHide || menuOpen() || !el.modal.hidden) return;
    idleTimer = setTimeout(() => {
      el.menu.classList.add('idle');
      document.body.classList.add('hide-cursor');
    }, 2500);
  }

  /* --- settings modal ------------------------------------------------------ */

  function openModal() {
    el.modal.hidden = false;
    closeMenu();
    poke();
    syncInputs();
    renderPhases();
  }

  function closeModal() {
    el.modal.hidden = true;
    el['config-text'].hidden = true;
    poke();
  }

  const bound = Array.from(document.querySelectorAll('[data-bind]'));

  function syncInputs() {
    for (const input of bound) {
      const v = get(cfg, input.dataset.bind);
      if (input.type === 'checkbox') input.checked = !!v;
      else input.value = v;
    }
    updateCycleTotal();
  }

  function readInput(input) {
    const path = input.dataset.bind;
    if (input.type === 'checkbox') { set(cfg, path, input.checked); return; }
    if (input.type === 'color' || input.classList.contains('hex')) {
      const v = hex(input.value, get(cfg, path));
      set(cfg, path, v);
      return;
    }
    if (input.type === 'number' || input.type === 'range') {
      const lo = input.min === '' ? -Infinity : parseFloat(input.min);
      const hi = input.max === '' ? Infinity : parseFloat(input.max);
      set(cfg, path, num(input.value, lo, hi, get(cfg, path)));
      return;
    }
    set(cfg, path, input.value);
  }

  function commit(source) {
    save();
    apply();
    // mirror the change into the other inputs bound to the same value
    for (const other of bound) {
      if (other === source || other.dataset.bind !== source.dataset.bind) continue;
      const v = get(cfg, other.dataset.bind);
      if (other.type === 'checkbox') other.checked = !!v;
      else other.value = v;
    }
  }

  for (const input of bound) {
    const isText = input.type === 'text';
    const handle = () => {
      readInput(input);
      commit(input);
      // text fields get the tidied value back ('#f0f' -> '#ff00ff', junk -> previous)
      if (isText) input.value = get(cfg, input.dataset.bind);
    };
    // typing in a hex box only counts once you're done; everything else is live
    input.addEventListener(isText ? 'change' : 'input', handle);
    if (isText) input.addEventListener('blur', handle);
  }

  /* phase rows */

  const EASE_NAMES = { sine: 'Sine', linear: 'Linear', in: 'Ease in', out: 'Ease out', inOut: 'In-out', hold: 'Hold' };

  function renderPhases() {
    el.phases.textContent = '';
    cfg.breath.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'phase';
      row.innerHTML =
        '<input type="text" class="p-label" placeholder="Step">' +
        '<input type="number" class="p-duration" min="0" max="3600" step="0.5">' +
        '<input type="number" class="p-from" min="1" max="100" step="1">' +
        '<input type="number" class="p-to" min="1" max="100" step="1">' +
        '<select class="p-easing">' +
          Object.keys(EASE_NAMES).map(k => `<option value="${k}">${EASE_NAMES[k]}</option>`).join('') +
        '</select>' +
        '<span class="btns">' +
          '<button type="button" data-move="-1" title="Move up">&#9650;</button>' +
          '<button type="button" data-move="1" title="Move down">&#9660;</button>' +
          '<button type="button" data-del="1" class="del" title="Delete">&times;</button>' +
        '</span>';

      row.querySelector('.p-label').value    = p.label;
      row.querySelector('.p-duration').value = p.duration;
      row.querySelector('.p-from').value     = p.from;
      row.querySelector('.p-to').value       = p.to;
      row.querySelector('.p-easing').value   = p.easing;

      row.addEventListener('input', e => {
        const t = e.target;
        if (t.classList.contains('p-label'))         p.label = t.value;
        else if (t.classList.contains('p-duration')) p.duration = num(t.value, 0, 3600, p.duration);
        else if (t.classList.contains('p-from'))     p.from = num(t.value, 1, 100, p.from);
        else if (t.classList.contains('p-easing'))   p.easing = EASINGS[t.value] ? t.value : 'sine';
        else if (t.classList.contains('p-to')) {
          const old = p.to;
          p.to = num(t.value, 1, 100, p.to);
          // keep the sequence continuous: if the next step started where this
          // one used to end, move it along too
          const next = cfg.breath[(i + 1) % cfg.breath.length];
          if (next && next !== p && next.from === old) {
            next.from = p.to;
            const nextRow = el.phases.children[(i + 1) % cfg.breath.length];
            if (nextRow) nextRow.querySelector('.p-from').value = p.to;
          }
        }
        save();
        updateCycleTotal();
        draw();
      });

      row.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.move) {
          const j = i + parseInt(b.dataset.move, 10);
          if (j < 0 || j >= cfg.breath.length) return;
          cfg.breath.splice(j, 0, cfg.breath.splice(i, 1)[0]);
        } else if (b.dataset.del) {
          if (cfg.breath.length === 1) return;
          cfg.breath.splice(i, 1);
        }
        if (idx >= cfg.breath.length) { idx = 0; phaseT = 0; }
        save();
        renderPhases();
        updateCycleTotal();
      });

      el.phases.appendChild(row);
    });
  }

  function updateCycleTotal() {
    const t = totalDuration();
    el['cycle-total'].textContent = t > 0 ? '· one full cycle: ' + (+t.toFixed(1)) + 's' : '';
  }

  el['add-phase'].addEventListener('click', () => {
    const prev = cfg.breath[cfg.breath.length - 1];
    const at = prev ? prev.to : 30;
    cfg.breath.push({ label: 'Hold', duration: 4, from: at, to: at, easing: 'linear' });
    save();
    renderPhases();
    updateCycleTotal();
  });

  /* config export / reset */

  function configText() {
    return 'const CONFIG = ' + JSON.stringify(cfg, null, 2) + ';\n';
  }

  el['show-config'].addEventListener('click', () => {
    const t = el['config-text'];
    t.value = configText();
    t.hidden = !t.hidden;
    el['show-config'].textContent = t.hidden ? 'Show config' : 'Hide config';
    if (!t.hidden) { t.scrollIntoView({ block: 'nearest' }); t.select(); }
  });

  el['copy-config'].addEventListener('click', async () => {
    const text = configText();
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (e) {
      const ta = el['config-text'];
      ta.value = text;
      ta.hidden = false;
      ta.select();
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      el['show-config'].textContent = 'Hide config';
    }
    const btn = el['copy-config'];
    btn.textContent = ok ? 'Copied' : 'Copy it from below';
    setTimeout(() => { btn.textContent = 'Copy config'; }, 1600);
  });

  el.reset.addEventListener('click', () => {
    cfg = clone(FILE_DEFAULTS);
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
    restart();
    apply();
    syncInputs();
    renderPhases();
  });

  /* --- wiring -------------------------------------------------------------- */

  el['menu-btn'].addEventListener('click', e => {
    e.stopPropagation();
    menuOpen() ? closeMenu() : openMenu();
  });

  el['menu-list'].addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    closeMenu();
    action(b.dataset.act);
  });

  function action(name) {
    if (name === 'settings') openModal();
    else if (name === 'pause') { paused = !paused; syncPauseLabel(); }
    else if (name === 'restart') restart();
    else if (name === 'full') toggleFullscreen();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  document.addEventListener('click', e => {
    if (menuOpen() && !el.menu.contains(e.target)) closeMenu();
  });

  el['modal-scrim'].addEventListener('click', closeModal);
  el.close.addEventListener('click', closeModal);
  el.done.addEventListener('click', closeModal);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!el.modal.hidden) closeModal();
      else if (menuOpen()) closeMenu();
      return;
    }
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    if (typing || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === ' ') { e.preventDefault(); action('pause'); }
    else if (e.key === 'r' || e.key === 'R') action('restart');
    else if (e.key === 'f' || e.key === 'F') action('full');
    else if (e.key === 's' || e.key === 'S') { if (el.modal.hidden) openModal(); else closeModal(); }
  });

  window.addEventListener('resize', () => { measure(); draw(); });
  ['mousemove', 'mousedown', 'touchstart', 'keydown'].forEach(ev =>
    window.addEventListener(ev, poke, { passive: true }));

  /* Keep the screen on. Only works on localhost/https; silently skipped on file:// */
  async function requestWakeLock() {
    if (!cfg.keepAwake || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    if (wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { wakeLock = null; }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });

  /* --- go ------------------------------------------------------------------ */

  measure();
  restart();
  apply();
  poke();
  requestAnimationFrame(frame);
})();
