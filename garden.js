/* ============================================================================
   Garden — the picture in Goals mode.

     one flower   for every long-term goal that is still running
     one petal    for every short-term goal inside it
     one dot      for every task in that short-term goal; the petal is made of
                  its dots. A dot is filled, in the colour of the task's area,
                  while the task is done, and an empty ring while it is not.

   So a flower fills in dot by dot, and is whole when everything in it is done.
   Tap a flower to open its goal's page.

   Garden.show(holder)   put the canvas into this element
   Garden.set(opts)      { flowers: [{ id, title, color, petals: [{ dots: [{ id, color, on }] }] }],
                           track, ink, onPick(id) }
   Garden.resize()       the holder changed size
   Garden.hide()         take the canvas away again
   ============================================================================ */

const Garden = (function () {
  'use strict';

  const TURN = 0.05;                // radians a second: how slowly the flowers turn
  const POP = 520;                  // ms a dot takes to fill in
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let holder = null, canvas = null, ctx = null;
  let W = 0, H = 0, dpr = 1;
  let flowers = [], cells = [];
  let track = '#8a8a93', ink = '#888';
  let onPick = null;
  let angle = 0, last = 0, lastDraw = 0, running = false;
  let known = null;                 // ids of the dots that were filled the last time we looked
  const popped = new Map();         // dot id -> when it began to fill in

  /* --- where things go ---------------------------------------------------------- */

  /* The grid that gives the flowers the most room. */
  function layout() {
    cells = [];
    const n = flowers.length;
    if (!n || !W || !H) return;
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const cw = W / cols, ch = H / rows;
      const label = Math.max(16, Math.min(30, ch * 0.16));
      const r = Math.min(cw, ch - label) * 0.46;
      if (!best || r > best.r) best = { cols, rows, cw, ch, label, r };
    }
    flowers.forEach((f, i) => {
      const col = i % best.cols, row = Math.floor(i / best.cols);
      const inRow = row === best.rows - 1 ? n - row * best.cols : best.cols;      // centre a short last row
      const x0 = (W - inRow * best.cw) / 2;
      cells.push({
        f, x: x0 + (col + 0.5) * best.cw, y: row * best.ch + (best.ch - best.label) / 2,
        r: Math.max(8, best.r), w: best.cw, label: best.label, top: row * best.ch, h: best.ch,
        dir: i % 2 ? -1 : 1,
      });
    });
  }

  const profile = t => Math.pow(Math.sin(Math.PI * t), 0.75);       // how wide a petal is along its length

  /* Where the n dots of one petal sit: rows across the petal, more dots where it is wide.
     Returns [{ t: 0..1 along the petal, u: -1..1 across it }] and the room each dot has. */
  function dotSpots(n, len, half) {
    if (!n) return { spots: [], pitch: 0 };
    let rows = 1, caps = [], total = 0;
    for (; rows <= n; rows++) {
      const pitch = len / rows;
      caps = [];
      total = 0;
      for (let j = 0; j < rows; j++) {
        const c = Math.max(1, Math.floor((2 * half * profile((j + 0.5) / rows)) / pitch));
        caps.push(c);
        total += c;
      }
      if (total >= n) break;
    }
    rows = Math.min(rows, n);
    // share the dots out over the rows in proportion to their width
    const give = caps.map(c => Math.floor((n * c) / total));
    let left = n - give.reduce((a, b) => a + b, 0);
    const order = caps.map((c, j) => j).sort((a, b) => caps[b] - give[b] - (caps[a] - give[a]));
    for (let k = 0; left > 0; k = (k + 1) % order.length) {
      const j = order[k];
      if (give[j] < caps[j] || k === order.length - 1) { give[j]++; left--; }
    }
    const spots = [];
    for (let j = 0; j < rows; j++) {
      const t = (j + 0.5) / rows, m = give[j];
      for (let i = 0; i < m; i++) spots.push({ t, u: m === 1 ? 0 : ((i + 0.5) / m) * 2 - 1 });
    }
    return { spots, pitch: len / rows };
  }

  /* --- drawing ------------------------------------------------------------------ */

  function ease(x) { const c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); }   // a little overshoot

  function flower(cell, now) {
    const f = cell.f, m = f.petals.length;
    const R = cell.r, core = R * (m ? 0.15 : 0.3);
    const len = R - core * 1.25;
    // petals may touch their neighbours but not cover them
    const half = Math.min(len * 0.3, m > 2 ? (core + len * 0.5) * Math.tan(Math.PI / m) * 0.74 : len * 0.3);
    const rot = angle * cell.dir;
    let all = 0, on = 0;

    for (let k = 0; k < m; k++) {
      const p = f.petals[k];
      const a = -Math.PI / 2 + rot + (k * 2 * Math.PI) / m;
      ctx.save();
      ctx.translate(cell.x, cell.y);
      ctx.rotate(a);
      // the petal itself, faintly: x runs from the heart outwards
      ctx.beginPath();
      ctx.moveTo(core, 0);
      ctx.bezierCurveTo(core + len * 0.3, -half * 1.5, core + len * 0.8, -half * 1.1, core + len * 1.04, 0);
      ctx.bezierCurveTo(core + len * 0.8, half * 1.1, core + len * 0.3, half * 1.5, core, 0);
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = f.color;
      ctx.fill();
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = Math.max(1, R * 0.008);
      ctx.stroke();
      ctx.globalAlpha = 1;

      const { spots, pitch } = dotSpots(p.dots.length, len * 0.9, half * 0.9);
      const rad = Math.max(1.2, Math.min(pitch * 0.36, half * 0.42, R * 0.075));
      p.dots.forEach((d, i) => {
        const s = spots[i];
        const x = core + len * 0.07 + s.t * len * 0.9;
        const y = s.u * half * 0.9 * profile(s.t) * (1 - rad / (half * 0.9 * profile(s.t) + rad));
        all++;
        if (d.on) {
          on++;
          const began = popped.get(d.id);
          let k2 = 1;
          if (began != null) {
            const x2 = (now - began) / POP;
            if (x2 >= 1) popped.delete(d.id); else k2 = Math.max(0.05, ease(Math.max(0, x2)));
          }
          ctx.beginPath();
          ctx.arc(x, y, rad * k2, 0, 2 * Math.PI);
          ctx.fillStyle = d.color;
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(x, y, rad * 0.82, 0, 2 * Math.PI);
          ctx.strokeStyle = track;
          ctx.lineWidth = Math.max(1, rad * 0.22);
          ctx.stroke();
        }
      });
      ctx.restore();
    }

    // the heart, in the colour of its flower: hollow until everything in the flower is done
    const whole = all > 0 && on === all;
    ctx.beginPath();
    ctx.arc(cell.x, cell.y, core * 0.82, 0, 2 * Math.PI);
    if (whole) {
      ctx.fillStyle = f.color;
      ctx.fill();
    } else {
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = f.color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = Math.max(1, R * 0.012);
      ctx.stroke();
    }

    // its name, and how far it is
    const size = Math.max(10, Math.min(14, cell.label * 0.5));
    ctx.font = '500 ' + size + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    const tail = all ? '  ' + on + '/' + all : '';
    let name = f.title;
    const room = cell.w - 12;
    if (ctx.measureText(name + tail).width > room) {
      while (name.length > 1 && ctx.measureText(name + '…' + tail).width > room) name = name.slice(0, -1);
      name = name.trimEnd() + '…';
    }
    ctx.fillText(name + tail, cell.x, cell.top + cell.h - cell.label / 2);
  }

  function draw(now) {
    if (!ctx || !W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (const c of cells) flower(c, now);
  }

  function frame() {
    if (!canvas) { running = false; return; }
    const now = performance.now();
    // 30 a second is plenty for a slow turn; every frame while a dot is filling in
    if (popped.size || now - lastDraw > 32) {
      if (!still) angle += TURN * Math.min(0.1, (now - (last || now)) / 1000);
      last = now;
      lastDraw = now;
      draw(now);
    }
    if (still && !popped.size) { running = false; return; }
    requestAnimationFrame(frame);
  }

  function start() {
    if (running || !canvas) return;
    running = true;
    last = 0;
    requestAnimationFrame(frame);
  }

  function measure() {
    if (!holder || !canvas) return;
    W = Math.floor(holder.clientWidth);
    H = Math.floor(holder.clientHeight);
    if (W < 40 || H < 40) { W = H = 0; return; }
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    layout();
  }

  function pick(e) {
    if (!onPick) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const c = cells.find(k => Math.abs(x - k.x) <= k.w / 2 && y >= k.top && y <= k.top + k.h);
    if (c) onPick(c.f.id);
  }

  /* --- the four calls ----------------------------------------------------------- */

  function show(el) {
    if (holder === el && canvas) return;
    hide();
    holder = el;
    canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.className = 'garden';
    canvas.title = 'One flower for each long-term goal. Tap one to open it.';
    canvas.addEventListener('click', pick);
    ctx = canvas.getContext('2d');
    holder.replaceChildren(canvas);
    measure();
  }

  function hide() {
    if (holder) holder.replaceChildren();
    holder = canvas = ctx = null;
    flowers = [];
    cells = [];
    known = null;
    popped.clear();
    running = false;
  }

  function set(opts) {
    if (!canvas) return;
    flowers = opts.flowers || [];
    track = opts.track || track;
    ink = opts.ink || ink;
    onPick = opts.onPick || null;

    // dots that have been filled since the last look fill in with a little pop
    const now = typeof performance === 'object' ? performance.now() : 0;
    const lit = new Set();
    for (const f of flowers) for (const p of f.petals) for (const d of p.dots) if (d.on) lit.add(d.id);
    if (known) for (const id of lit) if (!known.has(id)) popped.set(id, now);
    known = lit;

    measure();
    draw(now);
    start();
  }

  function resize() {
    if (!canvas) return;
    const w = W, h = H;
    measure();
    if (W !== w || H !== h) draw(typeof performance === 'object' ? performance.now() : 0);
  }

  return { show, set, resize, hide };
})();
