/* ============================================================================
   Yarn — the picture at the heart of Sankalpa mode.

   A tangled lump of thread in the three area colours, one knot per tangle.
   Each sankalpa you keep pulls one knot out of the lump and lays it down as a
   neat stretch of thread on the coil wound around it. Keep them all and the
   lump is gone: only the tidy coil is left.

   Drawn on a canvas; anime.js (anime.min.js) runs the motion. Everything is
   worked out in "unit" coordinates (the picture is 1 x 1) and scaled to fit.

     Yarn.show(holder)                     put the canvas inside this element
     Yarn.set({ total, freed, colors, animate })
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

  const PTS = 48;                 // points along one knot / one stretch of coil
  const TAU = Math.PI * 2;
  const C = 0.5;                  // centre of the picture
  const COIL_IN = 0.352, COIL_OUT = 0.478;
  const WRIGGLERS = 16;           // knots that squirm on their own
  const SPIN = TAU / 300;         // the lump turns once in five minutes

  let holder = null, canvas = null, ctx = null;
  let S = 0, dpr = 1;
  let model = null;               // { total, tangles, order, coil }
  let colors = {};
  let trackColor = 'rgba(138, 143, 152, 0.16)', glintColor = 'rgba(255, 255, 255, 0.85)';   // used only if main.css gives none
  let slots = [];                 // slots[j] = index of the tangle freed j-th
  let taken = null;               // Set of freed tangle indexes
  let ballImg = null, coilImg = null;
  let wrigglers = [], moving = [];
  let loop = null, anims = [];
  let t0 = 0;
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

  function build(total, areas) {
    const rand = rng(total * 7919 + 17);
    const a1 = rand() * TAU, a2 = rand() * TAU;
    const tangles = [];
    for (let i = 0; i < total; i++) {
      const ang = rand() * TAU;
      const edge = 0.265 * (1 + 0.17 * Math.sin(3 * ang + a1) + 0.1 * Math.sin(5 * ang + a2));   // a lump, not a ball
      const dist = Math.sqrt(rand()) * edge;
      const stray = rand() < 0.045;                                                           // a loop hanging out
      tangles.push({
        i,
        cat: areas[i % areas.length],
        x: C + Math.cos(ang) * dist, y: C + Math.sin(ang) * dist, dist,
        size: (0.024 + rand() * 0.03) * (stray ? 2.3 : 1) * Math.min(3, Math.max(1, Math.sqrt(600 / total))),
        m: 2 + Math.floor(rand() * 3),
        k: 0.55 + rand() * 0.55,
        squash: 0.55 + rand() * 0.75,
        p1: rand() * TAU, p2: rand() * TAU, rot: rand() * TAU,
      });
    }
    // which knot comes out first: the outermost of its colour, so the lump wears away from the outside
    const order = {};
    for (const a of areas) order[a] = tangles.filter(t => t.cat === a).sort((p, q) => q.dist - p.dist).map(t => t.i);
    const any = tangles.slice().sort((p, q) => q.dist - p.dist).map(t => t.i);

    // the coil: one long spiral, cut into `total` equal stretches
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

  /* The knot of one tangle, as PTS points. `wob` makes it squirm. */
  function knot(t, wob) {
    const out = new Array(PTS * 2);
    const cs = Math.cos(t.rot), sn = Math.sin(t.rot), sc = t.size / (1 + t.k);
    for (let j = 0; j < PTS; j++) {
      const a = (j / (PTS - 1)) * TAU;
      const u = Math.cos(a) + t.k * Math.cos(t.m * a + t.p1 + wob);
      const v = Math.sin(a) * t.squash + t.k * Math.sin((t.m + 1) * a + t.p2 - wob * 0.7);
      out[j * 2] = t.x + (u * cs - v * sn) * sc;
      out[j * 2 + 1] = t.y + (u * sn + v * cs) * sc;
    }
    return out;
  }

  /* The stretch of coil a freed tangle becomes, as PTS points. */
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
    c.beginPath();
    c.moveTo(pts[0], pts[1]);
    for (let n = 2; n < pts.length; n += 2) c.lineTo(pts[n], pts[n + 1]);
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

  function sheet() {
    const c = document.createElement('canvas');
    c.width = c.height = Math.max(1, Math.round(S * dpr));
    const x = c.getContext('2d');
    x.scale(S * dpr, S * dpr);
    x.lineJoin = x.lineCap = 'round';
    return [c, x];
  }

  const thin = () => Math.max(1.1, S * 0.0028) / S;
  const thick = () => Math.max(2, S * 0.0062) / S;
  const colorOf = t => colors[t.cat] || glintColor;

  /* Everything that is not moving is painted once and reused every frame. */
  function paint() {
    if (!model || !S) return;
    const busy = new Set(moving.map(m => m.t.i).concat(wrigglers.map(w => w.t.i)));

    let pair = sheet();
    const b = pair[1];
    b.lineWidth = thin();
    b.globalAlpha = 0.92;
    for (const t of model.tangles) {
      if (taken.has(t.i) || busy.has(t.i)) continue;
      b.strokeStyle = colorOf(t);
      trace(b, knot(t, 0));
      b.stroke();
    }
    ballImg = pair[0];

    pair = sheet();
    const k = pair[1];
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
      trace(k, stretch(j));
      k.stroke();
    });
    coilImg = pair[0];
  }

  function frame() {
    if (!ctx || !model || !S) return;
    const now = performance.now();
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

    // the lump: turning slowly, breathing a little
    const ang = still ? 0 : ((now - t0) / 1000) * SPIN;
    const breath = still ? 1 : 1 + 0.013 * Math.sin(now / 1900);
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(ang);
    ctx.scale(breath, breath);
    ctx.translate(-C, -C);
    if (ballImg) ctx.drawImage(ballImg, 0, 0, 1, 1);
    ctx.lineWidth = thin();
    ctx.globalAlpha = 0.92;
    for (const w of wrigglers) {
      ctx.strokeStyle = colorOf(w.t);
      trace(ctx, knot(w.t, w.wob));
      ctx.stroke();
    }
    ctx.restore();

    // knots on their way out: the loop opens and stretches into its place on the coil
    for (const m of moving) {
      const u = m.u, pts = new Array(PTS * 2);
      for (let n = 0; n < PTS * 2; n++) pts[n] = m.from[n] + (m.to[n] - m.from[n]) * u;
      ctx.save();
      ctx.strokeStyle = colorOf(m.t);
      ctx.lineWidth = thin() + (thick() - thin()) * u;
      ctx.shadowColor = colorOf(m.t);
      ctx.shadowBlur = Math.sin(Math.PI * u) * px * 0.03;
      trace(ctx, pts);
      ctx.stroke();
      ctx.restore();
    }
  }

  function stopAnims() {
    for (const a of anims) a.pause();
    anims = [];
  }

  function pickWrigglers() {
    const left = model.tangles.filter(t => !taken.has(t.i) && !moving.some(m => m.t.i === t.i));
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

  function show(el) {
    if (holder === el && canvas) return;
    hide();
    holder = el;
    canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    ctx = canvas.getContext('2d');
    holder.replaceChildren(canvas);
    t0 = performance.now();
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
    if (holder) holder.replaceChildren();
    holder = canvas = ctx = null;
    ballImg = coilImg = null;
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
    canvas.setAttribute('aria-label', slots.length + ' of ' + total + ' tangles untangled');

    // play the newest ones coming out of the lump
    const n = typeof anime === 'function' && !still && S ? Math.min(opts.animate | 0, slots.length, 6) : 0;
    const ang = ((performance.now() - t0) / 1000) * SPIN, cs = Math.cos(ang), sn = Math.sin(ang);
    for (let q = 0; q < n; q++) {
      const j = slots.length - n + q, t = model.tangles[slots[j]];
      const from = knot(t, 0);
      for (let p = 0; p < PTS * 2; p += 2) {       // where the turning lump has carried it by now
        const dx = from[p] - C, dy = from[p + 1] - C;
        from[p] = C + dx * cs - dy * sn;
        from[p + 1] = C + dx * sn + dy * cs;
      }
      const m = { t, j, u: 0, from, to: stretch(j) };
      moving.push(m);
      anims.push(anime({
        targets: m, u: [0, 1], duration: 3400, delay: 500 + q * 650, easing: 'easeInOutCubic',
        complete: () => { moving = moving.filter(x => x !== m); paint(); },
      }));
    }

    pickWrigglers();
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
