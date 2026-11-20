/* ============================================================================
   Yarn — the picture at the heart of Sankalpa mode.

   A tangled lump of thread in the three area colours, one knot per tangle.
   The lump is a real 3D shape: it turns slowly on its own, and you can grab
   it with the mouse or a finger and spin it any way you like.

   Each sankalpa you keep pulls one knot out of the lump and lays it down as a
   neat stretch of thread on the flat coil wound around it. Keep them all and
   the lump is gone: only the tidy coil is left.

   Drawn on a canvas; anime.js (anime.min.js) runs the motion. Everything is
   worked out in "unit" coordinates (the picture is 1 x 1) and scaled to fit.

     Yarn.show(holder)                     put the canvas inside this element
     Yarn.set({ total, freed, colors, track, glint, animate })
         total   : how many tangles there are in all
         freed   : area ids of the kept sankalpas, oldest first
         colors  : { areaId: '#hex' }
         track   : colour of the empty coil      (these all come from the
         glint   : colour of the moving bright dot  colour list in main.css)
         animate : how many of the newest freed ones to play the untangling for
     Yarn.resize()                         the holder changed size
     Yarn.hide()                           stop and remove
   ============================================================================ */

const Yarn = (function () {
  'use strict';

  const PTS = 44;                 // points along one knot / one stretch of coil
  const TAU = Math.PI * 2;
  const C = 0.5;                  // centre of the picture
  const COIL_IN = 0.352, COIL_OUT = 0.478;
  const LUMP = 0.235;             // how far the lump reaches from the centre
  const WRIGGLERS = 16;           // knots that squirm on their own
  const IDLE_SPIN = TAU / 70;     // left alone, the lump turns once in 70 seconds
  const DEPTH = 0.9;              // perspective: nearer thread is drawn a little bigger
  const BANDS = [0.3, 0.5, 0.74, 0.96];   // how solid the thread looks, from the far side to the near side

  let holder = null, canvas = null, ctx = null;
  let S = 0, dpr = 1;
  let model = null;               // { total, tangles, order, any, coil, areas }
  let colors = {};
  let trackColor = 'rgba(138, 143, 152, 0.16)', glintColor = 'rgba(255, 255, 255, 0.85)';   // used only if main.css gives none
  let slots = [];                 // slots[j] = index of the tangle freed j-th
  let taken = null;               // Set of freed tangle indexes
  let coilImg = null;
  let wrigglers = [], moving = [];
  let loop = null, anims = [];
  let queued = false;

  // which way the lump is facing, and how fast it is turning (radians a second)
  let R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let spinX = 0, spinY = 0;
  let dragging = false, lastX = 0, lastY = 0, lastMove = 0;
  let lastFrame = 0, lastDraw = 0;
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Same seed, same lump: it must look like the same yarn every time you open it. */
  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function unit(rand) {           // a random direction in space
    const z = rand() * 2 - 1, a = rand() * TAU, r = Math.sqrt(1 - z * z);
    return [r * Math.cos(a), r * Math.sin(a), z];
  }

  function build(total, areas) {
    const rand = rng(total * 7919 + 17);
    const a1 = rand() * TAU, a2 = rand() * TAU;
    const grow = Math.min(3, Math.max(1, Math.sqrt(600 / total)));     // fewer tangles, bigger knots
    const tangles = [];
    for (let i = 0; i < total; i++) {
      const dir = unit(rand);
      const ang = Math.atan2(dir[1], dir[0]);
      const edge = LUMP * (1 + 0.16 * Math.sin(3 * ang + a1) + 0.1 * Math.sin(4 * dir[2] * Math.PI + a2));   // a lump, not a ball
      const dist = Math.cbrt(rand()) * edge;
      const stray = rand() < 0.045;                                                                         // a loop hanging out
      // the knot's own three directions in space
      const e1 = unit(rand), q = unit(rand);
      let e2 = [e1[1] * q[2] - e1[2] * q[1], e1[2] * q[0] - e1[0] * q[2], e1[0] * q[1] - e1[1] * q[0]];
      const len = Math.hypot(e2[0], e2[1], e2[2]) || 1;
      e2 = [e2[0] / len, e2[1] / len, e2[2] / len];
      const e3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const t = {
        i,
        cat: areas[i % areas.length],
        x: dir[0] * dist, y: dir[1] * dist, z: dir[2] * dist, dist,
        size: (0.028 + rand() * 0.03) * (stray ? 2.2 : 1) * grow,
        m: 2 + Math.floor(rand() * 3),
        k: 0.55 + rand() * 0.55,
        squash: 0.55 + rand() * 0.75,
        p1: rand() * TAU, p2: rand() * TAU, p3: rand() * TAU,
        e1, e2, e3,
        pts: null,
      };
      t.pts = knot(t, 0);
      tangles.push(t);
    }
    // which knot comes out first: the outermost of its colour, so the lump wears away from the outside
    const order = {};
    for (const a of areas) order[a] = tangles.filter(t => t.cat === a).sort((p, q) => q.dist - p.dist).map(t => t.i);
    const any = tangles.slice().sort((p, q) => q.dist - p.dist).map(t => t.i);

    // the coil: one long flat spiral, cut into `total` equal stretches
    const turns = Math.min(12, Math.max(2, Math.round(total / 85)));
    const N = 6000, cum = new Float64Array(N + 1);
    const rAt = th => COIL_IN + (COIL_OUT - COIL_IN) * (th / (TAU * turns));
    let px = C + rAt(0), py = C;
    for (let n = 1; n <= N; n++) {
      const th = (n / N) * TAU * turns, r = rAt(th);
      const x = C + Math.cos(th) * r, y = C + Math.sin(th) * r;
      cum[n] = cum[n - 1] + Math.hypot(x - px, y - py);
      px = x; py = y;
    }
    const thetaAt = len => {                       // angle at a given length along the spiral
      let lo = 0, hi = N;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] < len) lo = mid; else hi = mid; }
      const f = cum[hi] > cum[lo] ? (len - cum[lo]) / (cum[hi] - cum[lo]) : 0;
      return ((lo + f) / N) * TAU * turns;
    };
    const step = cum[N] / total;
    const coil = { turns, rAt, max: TAU * turns, slot: [] };
    for (let j = 0; j < total; j++) coil.slot.push([thetaAt(j * step + step * 0.04), thetaAt((j + 1) * step - step * 0.04)]);
    return { total, tangles, order, any, coil, areas };
  }

  /* The knot of one tangle in space, as PTS points (x, y, z, x, y, z, ...). `wob` makes it squirm. */
  function knot(t, wob) {
    const out = new Float32Array(PTS * 3);
    const sc = t.size / (1 + t.k), e1 = t.e1, e2 = t.e2, e3 = t.e3;
    for (let j = 0; j < PTS; j++) {
      const a = (j / (PTS - 1)) * TAU;
      const u = (Math.cos(a) + t.k * Math.cos(t.m * a + t.p1 + wob)) * sc;
      const v = (Math.sin(a) * t.squash + t.k * Math.sin((t.m + 1) * a + t.p2 - wob * 0.7)) * sc;
      const w = (t.k * 0.9 * Math.sin((t.m + 2) * a + t.p3 + wob * 0.5)) * sc;
      out[j * 3] = t.x + u * e1[0] + v * e2[0] + w * e3[0];
      out[j * 3 + 1] = t.y + u * e1[1] + v * e2[1] + w * e3[1];
      out[j * 3 + 2] = t.z + u * e1[2] + v * e2[2] + w * e3[2];
    }
    return out;
  }

  /* Where a knot's points land on the flat picture, the way the lump is facing now. */
  function project(pts, scale, out) {
    for (let j = 0; j < PTS; j++) {
      const x = pts[j * 3], y = pts[j * 3 + 1], z = pts[j * 3 + 2];
      const rx = R[0] * x + R[1] * y + R[2] * z;
      const ry = R[3] * x + R[4] * y + R[5] * z;
      const rz = R[6] * x + R[7] * y + R[8] * z;
      const p = scale / (1 - rz * DEPTH);          // rz > 0 is the side facing you
      out[j * 2] = C + rx * p;
      out[j * 2 + 1] = C + ry * p;
    }
    return out;
  }

  /* The stretch of coil a freed tangle becomes, as PTS flat points. */
  function stretch(j) {
    const s = model.coil.slot[j], out = new Array(PTS * 2);
    for (let n = 0; n < PTS; n++) {
      const th = s[0] + (s[1] - s[0]) * (n / (PTS - 1)), r = model.coil.rAt(th);
      out[n * 2] = C + Math.cos(th) * r;
      out[n * 2 + 1] = C + Math.sin(th) * r;
    }
    return out;
  }

  function trace(c, pts) {
    c.moveTo(pts[0], pts[1]);
    for (let n = 2; n < PTS * 2; n += 2) c.lineTo(pts[n], pts[n + 1]);
  }

  /* Turn the lump: `ax` tips it towards / away from you, `ay` spins it left / right. */
  function turn(ax, ay) {
    const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay);
    // M = Ry(ay) * Rx(ax), then R = M * R
    const M = [cy, sy * sx, sy * cx, 0, cx, -sx, -sy, cy * sx, cy * cx];
    const n = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) n[r * 3 + c] = M[r * 3] * R[c] + M[r * 3 + 1] * R[3 + c] + M[r * 3 + 2] * R[6 + c];
    // keep it a clean rotation after thousands of small turns
    let l = Math.hypot(n[0], n[1], n[2]) || 1;
    n[0] /= l; n[1] /= l; n[2] /= l;
    const d = n[0] * n[3] + n[1] * n[4] + n[2] * n[5];
    n[3] -= d * n[0]; n[4] -= d * n[1]; n[5] -= d * n[2];
    l = Math.hypot(n[3], n[4], n[5]) || 1;
    n[3] /= l; n[4] /= l; n[5] /= l;
    n[6] = n[1] * n[5] - n[2] * n[4];
    n[7] = n[2] * n[3] - n[0] * n[5];
    n[8] = n[0] * n[4] - n[1] * n[3];
    R = n;
  }

  function assign(freed) {
    const next = {}, list = [];
    taken = new Set();
    let anyAt = 0;
    for (const cat of freed.slice(0, model.total)) {
      const own = model.order[cat] || [];
      next[cat] = next[cat] || 0;
      while (next[cat] < own.length && taken.has(own[next[cat]])) next[cat]++;
      let pick = own[next[cat]];
      if (pick == null) {                          // none of that colour left: take any
        while (anyAt < model.any.length && taken.has(model.any[anyAt])) anyAt++;
        pick = model.any[anyAt];
      }
      if (pick == null) break;
      taken.add(pick);
      list.push(pick);
    }
    slots = list;
  }

  const thin = () => Math.max(1.1, S * 0.0028) / S;
  const thick = () => Math.max(2, S * 0.0062) / S;
  const colorOf = t => colors[t.cat] || glintColor;

  /* The coil does not move, so it is painted once and reused every frame. */
  function paint() {
    if (!model || !S) return;
    const c = document.createElement('canvas');
    c.width = c.height = Math.max(1, Math.round(S * dpr));
    const k = c.getContext('2d');
    k.scale(S * dpr, S * dpr);
    k.lineJoin = k.lineCap = 'round';

    k.lineWidth = thin() * 0.8;                    // the empty track, waiting to be filled
    k.strokeStyle = trackColor;
    k.beginPath();
    for (let th = 0; th <= model.coil.max; th += 0.03) {
      const r = model.coil.rAt(th);
      k.lineTo(C + Math.cos(th) * r, C + Math.sin(th) * r);
    }
    k.stroke();

    k.lineWidth = thick();
    const arriving = new Set(moving.map(m => m.j));
    slots.forEach((ti, j) => {
      if (arriving.has(j)) return;
      k.strokeStyle = colorOf(model.tangles[ti]);
      k.beginPath();
      trace(k, stretch(j));
      k.stroke();
    });
    coilImg = c;
  }

  const flat = new Float32Array(PTS * 2);

  function frame() {
    queued = false;
    if (!ctx || !model || !S) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - (lastFrame || now)) / 1000);
    lastFrame = now;

    // keep turning: what is left of your push, easing back to the slow idle spin
    if (!dragging) {
      const ease = Math.exp(-dt * 1.6);
      spinX *= ease;
      spinY = IDLE_SPIN + (spinY - IDLE_SPIN) * ease;
      if (!still) turn(spinX * dt, spinY * dt);
    }

    // nothing is being pushed around: half the frames are plenty, and kinder to a phone
    const lively = dragging || moving.length || Math.abs(spinX) > 0.2 || Math.abs(spinY) > 0.4;
    if (!lively && now - lastDraw < 30) return;
    lastDraw = now;

    const px = S * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, px, px);
    if (coilImg) ctx.drawImage(coilImg, 0, 0);
    ctx.scale(px, px);
    ctx.lineJoin = ctx.lineCap = 'round';

    // a glint running along the thread already laid down
    const laid = slots.length - moving.length;
    if (laid > 0 && !still) {
      const end = model.coil.slot[laid - 1][1];
      const th = ((now / 1000) * 0.9) % Math.max(end, 0.001), r = model.coil.rAt(th);
      ctx.fillStyle = glintColor;
      ctx.beginPath();
      ctx.arc(C + Math.cos(th) * r, C + Math.sin(th) * r, thick() * 0.9, 0, TAU);
      ctx.fill();
    }

    // the lump. Sort the knots into slices from back to front, so the far side looks fainter.
    const breath = still ? 1 : 1 + 0.013 * Math.sin(now / 1900);
    const nb = BANDS.length, areas = model.areas, na = areas.length;
    const buckets = [];
    for (let b = 0; b < nb * na; b++) buckets.push([]);
    const busy = new Set(moving.map(m => m.t.i));
    const squirm = new Map(wrigglers.map(w => [w.t.i, w]));
    for (const t of model.tangles) {
      if (taken.has(t.i) && !busy.has(t.i)) continue;
      if (busy.has(t.i)) continue;                 // drawn below, on its way out
      const rz = R[6] * t.x + R[7] * t.y + R[8] * t.z;
      const b = Math.min(nb - 1, Math.max(0, Math.floor(((rz / LUMP) * 0.5 + 0.5) * nb)));
      buckets[b * na + areas.indexOf(t.cat)].push(t);
    }
    for (let b = 0; b < nb; b++) {
      ctx.globalAlpha = BANDS[b];
      ctx.lineWidth = thin() * (0.82 + 0.1 * b);
      for (let a = 0; a < na; a++) {
        const list = buckets[b * na + a];
        if (!list.length) continue;
        ctx.strokeStyle = colors[areas[a]] || glintColor;
        ctx.beginPath();
        for (const t of list) {
          const w = squirm.get(t.i);
          trace(ctx, project(w ? knot(t, w.wob) : t.pts, breath, flat));
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // knots on their way out: the loop opens and stretches into its place on the coil
    for (const m of moving) {
      const u = m.u, pts = new Array(PTS * 2);
      for (let n = 0; n < PTS * 2; n++) pts[n] = m.from[n] + (m.to[n] - m.from[n]) * u;
      ctx.save();
      ctx.strokeStyle = colorOf(m.t);
      ctx.lineWidth = thin() + (thick() - thin()) * u;
      ctx.shadowColor = colorOf(m.t);
      ctx.shadowBlur = Math.sin(Math.PI * u) * px * 0.03;
      ctx.beginPath();
      trace(ctx, pts);
      ctx.stroke();
      ctx.restore();
    }
  }

  /* Without the animation loop (reduced motion, or anime.js missing) draw only when asked. */
  function redraw() {
    if (loop || queued) return;
    queued = true;
    requestAnimationFrame(() => { lastDraw = 0; frame(); });
  }

  function stopAnims() {
    for (const a of anims) a.pause();
    anims = [];
  }

  function pickWrigglers() {
    const left = model.tangles.filter(t => !taken.has(t.i));
    const rand = rng(left.length * 31 + 5);
    wrigglers = [];
    if (still || typeof anime !== 'function') return;
    for (let n = 0; n < Math.min(WRIGGLERS, left.length); n++) {
      const t = left.splice(Math.floor(rand() * left.length), 1)[0];
      const w = { t, wob: 0 };
      wrigglers.push(w);
      anims.push(anime({ targets: w, wob: [-1.1, 1.1], duration: 2400 + rand() * 3200, direction: 'alternate', loop: true, easing: 'easeInOutSine' }));
    }
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

  /* --- grab it and spin it ------------------------------------------------- */

  function down(e) {
    dragging = true;
    lastX = e.clientX; lastY = e.clientY; lastMove = performance.now();
    spinX = spinY = 0;
    canvas.classList.add('grabbing');
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* older browsers: dragging still works inside the canvas */ }
    e.preventDefault();
  }

  function move(e) {
    if (!dragging || !S) return;
    const now = performance.now();
    const k = Math.PI / S;                         // dragging across the whole picture = half a turn
    const ax = -(e.clientY - lastY) * k, ay = (e.clientX - lastX) * k;
    turn(ax, ay);
    const dt = Math.max(0.008, (now - lastMove) / 1000);
    spinX = ax / dt; spinY = ay / dt;              // remembered, so it keeps going when you let go
    lastX = e.clientX; lastY = e.clientY; lastMove = now;
    redraw();
  }

  function up() {
    if (!dragging) return;
    dragging = false;
    if (canvas) canvas.classList.remove('grabbing');
    if (performance.now() - lastMove > 120 || still) spinX = spinY = 0;     // you stopped before letting go
    const cap = 9;
    spinX = Math.max(-cap, Math.min(cap, spinX));
    spinY = Math.max(-cap, Math.min(cap, spinY));
    redraw();
  }

  function show(el) {
    if (holder === el && canvas) return;
    hide();
    holder = el;
    canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.title = 'Drag to turn the yarn';
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    ctx = canvas.getContext('2d');
    holder.replaceChildren(canvas);
    lastFrame = lastDraw = 0;
    spinX = 0; spinY = IDLE_SPIN;
    measure();
    if (typeof anime === 'function' && !still) {
      loop = anime({ targets: { v: 0 }, v: 1, duration: 1000, loop: true, easing: 'linear', update: frame });
    }
  }

  function hide() {
    stopAnims();
    if (loop) loop.pause();
    loop = null;
    moving = [];
    wrigglers = [];
    dragging = false;
    if (holder) holder.replaceChildren();
    holder = canvas = ctx = null;
    coilImg = null;
  }

  function set(opts) {
    if (!canvas) return;
    colors = opts.colors || colors;
    trackColor = opts.track || trackColor;
    glintColor = opts.glint || glintColor;
    const total = Math.max(1, opts.total | 0);
    const areas = Object.keys(colors);
    if (!model || model.total !== total || model.areas.join() !== areas.join()) model = build(total, areas);

    stopAnims();
    moving = [];
    assign(opts.freed || []);
    canvas.setAttribute('aria-label', slots.length + ' of ' + total + ' tangles untangled. Drag to turn the yarn.');

    // play the newest ones coming out of the lump, from wherever the lump has turned them to
    const n = typeof anime === 'function' && !still && S ? Math.min(opts.animate | 0, slots.length, 6) : 0;
    for (let q = 0; q < n; q++) {
      const j = slots.length - n + q, t = model.tangles[slots[j]];
      const m = { t, j, u: 0, from: Array.from(project(t.pts, 1, new Float32Array(PTS * 2))), to: stretch(j) };
      moving.push(m);
      anims.push(anime({
        targets: m, u: [0, 1], duration: 3400, delay: 500 + q * 650, easing: 'easeInOutCubic',
        complete: () => { moving = moving.filter(x => x !== m); paint(); },
      }));
    }

    pickWrigglers();
    paint();
    lastDraw = 0;
    frame();
  }

  function resize() {
    if (!canvas) return;
    const before = S;
    measure();
    if (S !== before) { paint(); lastDraw = 0; frame(); }
  }

  return { show, set, resize, hide };
})();
