/* ============================================================================
   Lotus — the other picture for Sankalpa mode (the yarn is yarn.js).

   A lotus seen from above. It starts as a bare golden heart with no petals.
   Every sankalpa you keep opens one more petal; a broken one adds nothing.
   Petals are set the way a real flower sets them, each a golden angle further
   round than the last, so they spiral out from the heart. A thousand kept
   sankalpas and it is in full bloom.

   While the flower is small the view is drawn close up, and it eases back as
   the flower grows, so a new petal is always easy to see. The lotus turns
   slowly on its own; drag it to spin it.

   Drawn on a canvas; anime.js (anime.min.js) runs the motion. Same calls as
   the yarn, so main.js can swap one for the other:

     Lotus.show(holder)
     Lotus.set({ total, freed, lotus, heart, track, animate })
         total   : how many petals a full bloom has
         freed   : one entry per kept sankalpa (only the count matters here)
         lotus   : the petal colour, '#rrggbb'      (these come from the colour
         heart   : the colour of the heart            list in main.css, or from
         track   : the faint outline of full bloom    the picture's settings)
         animate : how many of the newest petals to play the opening for
     Lotus.resize()
     Lotus.hide()
   ============================================================================ */

const Lotus = (function () {
  'use strict';

  const TAU = Math.PI * 2;
  const C = 0.5;                          // centre of the picture
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));   // the angle between one petal and the next
  const REACH = 0.47;                     // how far the tips of a full bloom reach from the centre
  const CLOSE = 2.6;                      // how close the view gets while the flower is small
  const IDLE_SPIN = TAU / 260;            // left alone, it turns once in a little over four minutes

  let holder = null, canvas = null, ctx = null;
  let S = 0, dpr = 1;
  let model = null;                       // { total, petals, pod, reach }
  let count = 0;
  let petalColor = '#f29bb7', heartColor = '#f2c94c', trackColor = 'rgba(138, 143, 152, 0.16)';   // used only if nothing is given
  let img = null, imgZoom = 1;            // the settled petals, painted once
  let opening = [];                       // petals in the middle of opening
  let view = { zoom: CLOSE };
  let loop = null, anims = [];
  let queued = false;

  let angle = 0, spin = IDLE_SPIN;
  let dragging = false, lastA = 0, lastMove = 0, lastFrame = 0;
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- colour ---------------------------------------------------------------- */

  function rgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex).trim());
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
  }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function css(c, alpha) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (alpha == null ? 1 : alpha) + ')'; }
  const WHITE = [255, 255, 255], DEEP = [28, 10, 30];

  /* --- the flower ------------------------------------------------------------- */

  function build(total) {
    const gap = (REACH * 0.85) * Math.sqrt(Math.PI / total);          // room one petal has
    const len0 = Math.min(0.105, Math.max(0.05, gap * 3.3));          // length of the innermost petals
    const lenMax = len0 * 1.5;
    const pod = Math.max(0.03, Math.min(0.05, gap * 1.2));
    const rim = REACH - lenMax;                                       // where the outermost petals are rooted
    const petals = [];
    for (let k = 0; k < total; k++) {
      const f = Math.sqrt((k + 0.5) / total);                         // 0 at the heart, 1 at the rim
      const len = len0 * (0.95 + 0.5 * f);
      // rooted a little under the heart / the petals inside it, the way real petals overlap
      petals.push({ k, f, ang: k * GOLDEN, r: Math.max(0, pod * 0.5 + (rim - pod * 0.5) * f - len * 0.16), len, wid: len * (0.36 - 0.15 * f) });   // outer petals are slimmer, so their points show
    }
    return { total, petals, pod, reach: REACH };
  }

  /* How close the view is for a flower of n petals: near at first, full size once it has grown. */
  function zoomFor(n) {
    if (!model || !n) return CLOSE;
    const p = model.petals[Math.min(n, model.total) - 1];
    return Math.min(CLOSE, Math.max(1, (REACH * 0.94) / (p.r + p.len)));
  }

  /* One petal: rooted at the heart side, pointing outwards. `open` 0..1 is how far it has opened. */
  function petal(c, p, open, base) {
    const len = p.len * open, wid = p.wid * (0.35 + 0.65 * open);
    // the root lies in the shade of the petals above it; the tip catches the light.
    // petals near the heart are paler, the outer ones carry the full colour.
    const body = mix(base, WHITE, 0.45 * (1 - p.f));
    const shade = mix(body, DEEP, 0.4 + 0.2 * p.f);
    const tip = mix(body, WHITE, 0.5 - 0.22 * p.f);
    const turn = 0.42 + 0.3 * p.f;                 // further out, less of a petal shows, so the colour comes in later
    c.save();
    c.translate(C + Math.cos(p.ang) * p.r, C + Math.sin(p.ang) * p.r);
    c.rotate(p.ang);
    const g = c.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, css(shade));
    g.addColorStop(turn, css(body));
    g.addColorStop(1, css(tip));
    c.beginPath();
    c.moveTo(0, 0);
    c.bezierCurveTo(len * 0.22, -wid * 1.2, len * 0.74, -wid * 0.9, len, 0);
    c.bezierCurveTo(len * 0.74, wid * 0.9, len * 0.22, wid * 1.2, 0, 0);
    c.fillStyle = g;
    c.fill();
    c.lineWidth = Math.max(0.0009, p.len * 0.022);
    c.strokeStyle = css(mix(base, DEEP, 0.6), 0.55);
    c.stroke();
    c.beginPath();                                   // the fold down the middle
    c.moveTo(len * 0.12, 0);
    c.lineTo(len * 0.8, 0);
    c.lineWidth = Math.max(0.0006, p.len * 0.012);
    c.strokeStyle = css(mix(base, DEEP, 0.4), 0.22);
    c.stroke();
    c.restore();
  }

  function heart(c) {
    const r = model.pod, gold = rgb(heartColor) || [242, 201, 76];
    const g = c.createRadialGradient(C - r * 0.25, C - r * 0.25, r * 0.1, C, C, r);
    g.addColorStop(0, css(mix(gold, WHITE, 0.55)));
    g.addColorStop(0.7, css(gold));
    g.addColorStop(1, css(mix(gold, DEEP, 0.35)));
    c.beginPath();
    c.arc(C, C, r, 0, TAU);
    c.fillStyle = g;
    c.fill();
    c.fillStyle = css(mix(gold, DEEP, 0.45), 0.75);  // the seeds
    for (let n = 0; n < 13; n++) {
      const a = n * GOLDEN, d = r * 0.78 * Math.sqrt((n + 0.5) / 13);
      c.beginPath();
      c.arc(C + Math.cos(a) * d, C + Math.sin(a) * d, r * 0.085, 0, TAU);
      c.fill();
    }
  }

  /* The petals that have finished opening are painted once, at the size they are viewed at. */
  function paint() {
    if (!model || !S) return;
    const base = rgb(petalColor) || [242, 155, 183];
    const c = document.createElement('canvas');
    c.width = c.height = Math.max(1, Math.round(S * dpr));
    const x = c.getContext('2d');
    imgZoom = zoomFor(count);
    x.scale(S * dpr, S * dpr);
    x.translate(C, C);
    x.scale(imgZoom, imgZoom);
    x.translate(-C, -C);
    x.lineJoin = 'round';
    const busy = new Set(opening.map(o => o.p.k));
    for (let k = Math.min(count, model.total) - 1; k >= 0; k--) {     // outer ones first, so inner petals lie on top
      if (!busy.has(k)) petal(x, model.petals[k], 1, base);
    }
    heart(x);
    img = c;
  }

  function frame() {
    queued = false;
    if (!ctx || !model || !S) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - (lastFrame || now)) / 1000);
    lastFrame = now;
    if (!dragging && !still) {
      spin = IDLE_SPIN + (spin - IDLE_SPIN) * Math.exp(-dt * 1.4);    // your push fades back to the slow turn
      angle += spin * dt;
    }

    const px = S * dpr;
    const base = rgb(petalColor) || [242, 155, 183];
    const breath = still ? 1 : 1 + 0.012 * Math.sin(now / 2100);
    const z = view.zoom * breath;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, px, px);
    ctx.scale(px, px);

    // a soft light behind the flower
    const glow = (count ? 0.5 : 0.3) * (still ? 1 : 0.85 + 0.15 * Math.sin(now / 1500));
    const g = ctx.createRadialGradient(C, C, 0, C, C, 0.5);
    g.addColorStop(0, css(base, 0.2 * glow));
    g.addColorStop(0.6, css(base, 0.06 * glow));
    g.addColorStop(1, css(base, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1, 1);

    // where a full bloom will reach
    ctx.beginPath();
    ctx.arc(C, C, model.reach * view.zoom, 0, TAU);
    ctx.lineWidth = 1 / S;
    ctx.strokeStyle = trackColor;
    ctx.setLineDash([0.006, 0.012]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.translate(C, C);
    ctx.rotate(angle);
    ctx.scale(z, z);
    ctx.translate(-C, -C);

    // petals that are opening right now: they are the outermost, so they go underneath
    for (let n = opening.length - 1; n >= 0; n--) {
      const o = opening[n];
      if (o.open <= 0) continue;
      ctx.save();
      ctx.shadowColor = css(mix(base, WHITE, 0.5));
      ctx.shadowBlur = (1 - Math.min(1, o.glow)) * px * 0.035;
      petal(ctx, o.p, o.open, base);
      ctx.restore();
    }

    if (img) {
      const s = 1 / imgZoom;                       // the painted flower, brought to the current view
      ctx.translate(C, C);
      ctx.scale(s, s);
      ctx.translate(-C, -C);
      ctx.drawImage(img, 0, 0, 1, 1);
    }
  }

  function redraw() {                              // without the loop (reduced motion, or anime.js missing)
    if (loop || queued) return;
    queued = true;
    requestAnimationFrame(frame);
  }

  function stopAnims() {
    for (const a of anims) a.pause();
    anims = [];
  }

  function measure() {
    if (!holder || !canvas) return;
    const side = Math.floor(Math.min(holder.clientWidth, holder.clientHeight));
    if (side < 40) { S = 0; return; }
    S = side;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = canvas.height = Math.round(S * dpr);
    canvas.style.width = canvas.style.height = S + 'px';
  }

  /* --- grab it and spin it ----------------------------------------------------- */

  function pointerAngle(e) {
    const r = canvas.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  }

  function down(e) {
    dragging = true;
    lastA = pointerAngle(e);
    lastMove = performance.now();
    spin = 0;
    canvas.classList.add('grabbing');
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* dragging still works inside the canvas */ }
    e.preventDefault();
  }

  function move(e) {
    if (!dragging) return;
    const now = performance.now(), a = pointerAngle(e);
    let d = a - lastA;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    angle += d;
    spin = d / Math.max(0.008, (now - lastMove) / 1000);    // remembered, so it keeps turning when you let go
    lastA = a;
    lastMove = now;
    redraw();
  }

  function up() {
    if (!dragging) return;
    dragging = false;
    if (canvas) canvas.classList.remove('grabbing');
    if (performance.now() - lastMove > 120 || still) spin = 0;
    spin = Math.max(-8, Math.min(8, spin));
    redraw();
  }

  function show(el) {
    if (holder === el && canvas) return;
    hide();
    holder = el;
    canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.title = 'Drag to turn the lotus';
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    ctx = canvas.getContext('2d');
    holder.replaceChildren(canvas);
    lastFrame = 0;
    spin = IDLE_SPIN;
    measure();
    if (typeof anime === 'function' && !still) {
      loop = anime({ targets: { v: 0 }, v: 1, duration: 1000, loop: true, easing: 'linear', update: frame });
    }
  }

  function hide() {
    stopAnims();
    if (loop) loop.pause();
    loop = null;
    opening = [];
    dragging = false;
    if (holder) holder.replaceChildren();
    holder = canvas = ctx = null;
    img = null;
    model = null;
  }

  function set(opts) {
    if (!canvas) return;
    petalColor = opts.lotus || petalColor;
    heartColor = opts.heart || heartColor;
    trackColor = opts.track || trackColor;
    const total = Math.max(1, opts.total | 0);
    const fresh = !model || model.total !== total;
    if (fresh) model = build(total);

    stopAnims();
    opening = [];
    count = Math.min(total, (opts.freed || []).length);
    canvas.setAttribute('aria-label', 'A lotus with ' + count + ' of ' + total + ' petals open. Drag to turn it.');

    const lively = typeof anime === 'function' && !still && S;
    const n = lively ? Math.min(opts.animate | 0, count, 8) : 0;
    const target = zoomFor(count);
    if (fresh || !lively || !n) view.zoom = target;

    // the newest petals open one after another, and the view eases back to make room
    for (let q = 0; q < n; q++) {
      const o = { p: model.petals[count - n + q], open: 0, glow: 0 };
      opening.push(o);
      anims.push(anime({
        targets: o, open: [0, 1], glow: [0, 1], duration: 2200, delay: 400 + q * 500, easing: 'easeOutElastic(1, .7)',
        complete: () => { opening = opening.filter(x => x !== o); paint(); },
      }));
    }
    if (n) anims.push(anime({ targets: view, zoom: target, duration: 1800, delay: 300, easing: 'easeInOutSine' }));

    paint();
    frame();
  }

  function resize() {
    if (!canvas) return;
    const before = S;
    measure();
    if (S !== before) { paint(); frame(); }
  }

  return { show, set, resize, hide };
})();
