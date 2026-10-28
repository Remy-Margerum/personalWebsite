// A pigeon for the home hero: it flies in from the left, lands on a branch of
// the generative tree (hero-tree.js), rides that branch in the wind and looks
// around, and takes off when the pointer comes close — coming back a little
// later to another branch. The bird is photographic: each clip is a sprite
// sheet of green-screen-keyed frames from an AI-animated video, all sharing
// one coordinate system so the clips hand off seamlessly.
(function () {
  const tree = window.heroTree;
  if (!tree) return;
  const ctx = tree.ctx;
  const box = tree.box;
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Generated with the sprite sheets — see assets/img/pigeon/README.md.
  // Coordinates are source-video pixels; anchor is where the perched feet
  // grip the branch; each clip's cell is its frames' shared bounding box.
  const SPRITE = {
    scale: 0.26,
    anchor: [525, 788],
    bodyH: 401,        // perched bird, beak to tail tip
    bodyW: 600,        // flying bird, wingtip to tail
    clips: {
      fly:     { src: 'fly.webp', w: 155, h: 186, cols: 12, n: 12, ox: 192, oy: 142, fps: 24 },
      land:    { src: 'land.webp', w: 245, h: 214, cols: 16, n: 49, ox: 20, oy: 114, fps: 12, touch: 0.63 },
      idle:    { src: 'idle.webp', w: 107, h: 107, cols: 38, n: 73, ox: 258, oy: 416, fps: 12 },
      takeoff: { src: 'takeoff.webp', w: 214, h: 215, cols: 19, n: 49, ox: 140, oy: 0, fps: 12, lift: 0.18 }
    }
  };
  const DIR = '/assets/img/pigeon/';

  const FLY_SPEED = 2.4;     // fly-cycle playback rate (~5 wingbeats/s)
  const LAND_SPEED = 1.6;
  const TAKEOFF_SPEED = 1.7;
  const IDLE_SPEED = 1;

  const sheets = {};
  let state = 'loading';     // loading | waiting | flyIn | landing | perched | takeoff | flyOut
  let clock = 0;             // ms, advances only while frames are drawn
  let lastT = null;
  let stateAt = 0;           // clock when the current state began
  let s = 0.1;               // display px per source px
  let pos = { x: 0, y: 0 };  // anchor position in CSS px
  let perch = null;          // { b, t }: branch and fraction along it
  let path = null;           // flight: cubic Bézier + duration
  let landFrom = null;
  let idleHold = 0;          // ms to hold the rest pose before the next look-around
  let idleAt = 0;
  let leaveAt = 0;           // clock when a perched bird leaves on its own
  let returnAt = 0;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clipDur(name, speed) { const c = SPRITE.clips[name]; return c.n / (c.fps * speed) * 1000; }

  function setState(next) { state = next; stateAt = clock; }

  // Size the bird from the hero's height: a perched bird about an eighth of it.
  function resizeBird() {
    const H = tree.size().H;
    const perchedH = Math.max(44, Math.min(72, H * 0.13));
    s = perchedH / SPRITE.bodyH;
  }

  // Pick a near-level branch with room above it and few leaves in the way,
  // so the bird reads clearly. The tree's level branches are its outer twigs
  // (the thick limbs all climb steeply), so prefer the flattest and thickest
  // of those, and take a steeper one only when nothing level is free.
  function choosePerch() {
    return findPerch(0.85) || findPerch(1.3);
  }

  function findPerch(maxSlope) {
    const W = tree.size().W, H = tree.size().H;
    const birdH = SPRITE.bodyH * s;
    const birdW = SPRITE.bodyW * s;
    // the perched bird's extent either side of its feet — it must fit on
    // screen (on phones the tree runs off the right edge)
    const idle = SPRITE.clips.idle;
    const left = (SPRITE.anchor[0] - idle.ox) * s + 4;
    const right = (idle.ox + idle.w / SPRITE.scale - SPRITE.anchor[0]) * s + 4;
    const leaves = tree.leaves();
    // On phones the tree sits behind the headline, whose cream halo would
    // wash the bird out — keep clear of the text.
    let clear = null;
    const o = box.getBoundingClientRect();
    box.querySelectorAll('.hero-content > *').forEach(function (el) {
      const r = el.getBoundingClientRect();
      // inline-size the headline: its box is full-width but its words aren't
      const range = document.createRange(); range.selectNodeContents(el);
      const t = el.tagName === 'H1' ? range.getBoundingClientRect() : r;
      const c = { x0: t.left - o.left - 28, x1: t.right - o.left + 28, y0: t.top - o.top - 28, y1: t.bottom - o.top + 28 };
      clear = clear ? { x0: Math.min(clear.x0, c.x0), x1: Math.max(clear.x1, c.x1), y0: Math.min(clear.y0, c.y0), y1: Math.max(clear.y1, c.y1) } : c;
    });
    let best = null, bestScore = Infinity;
    for (const b of tree.branches()) {
      if (b.depth < 3 || b.depth > 7) continue;
      const dx = b.x2 - b.x1, dy = b.y2 - b.y1, len = Math.hypot(dx, dy);
      if (len < birdW * 0.12) continue;
      const slope = Math.abs(dy) / len;
      if (slope > maxSlope) continue;
      for (const t of [0.35, 0.55, 0.75]) {
        const x = b.x1 + dx * t, y = b.y1 + dy * t;
        if (y - birdH < 4 || y > H * 0.85 || x < left || x > W - right) continue;
        if (clear && x + right > clear.x0 && x - left < clear.x1 && y > clear.y0 && y - birdH < clear.y1) continue;
        let crowd = 0;
        for (const l of leaves) {
          if (Math.abs(l.x - x) < birdW * 0.3 && l.y < y + 4 && l.y > y - birdH) crowd++;
        }
        const score = slope * slope * 60 + crowd * 1.5 + Math.abs(b.depth - 5) * 3 +
          Math.abs(y - H * 0.45) * 0.03 + Math.random() * 3;
        if (score < bestScore) { bestScore = score; best = { b: b, t: t }; }
      }
    }
    return best;
  }

  // Where the feet go on the perch right now — the branch tip sways in the
  // wind and its base doesn't, so a point partway along moves partway.
  function perchPoint() {
    const b = perch.b, t = perch.t;
    return {
      x: b.x1 + (b.x2 - b.x1) * t + tree.branchSway(b) * t,
      y: b.y1 + (b.y2 - b.y1) * t - b.width * 0.3
    };
  }

  function bezier(p, u) {
    const v = 1 - u;
    return {
      x: v * v * v * p[0].x + 3 * v * v * u * p[1].x + 3 * v * u * u * p[2].x + u * u * u * p[3].x,
      y: v * v * v * p[0].y + 3 * v * v * u * p[1].y + 3 * v * u * u * p[2].y + u * u * u * p[3].y
    };
  }
  function bezierLength(p) {
    let L = 0, prev = p[0];
    for (let i = 1; i <= 24; i++) { const q = bezier(p, i / 24); L += Math.hypot(q.x - prev.x, q.y - prev.y); prev = q; }
    return L;
  }
  // A whole number of wingbeats, so the flight ends on the frame the next
  // clip starts from.
  function flightDuration(len, speed) {
    const cycle = clipDur('fly', FLY_SPEED);
    return Math.max(1, Math.round(len / speed * 1000 / cycle)) * cycle;
  }

  function flySpeed() { return Math.max(260, tree.size().W * 0.3); }  // px/s

  // Fly in along a gentle arc to a point just short of the perch, coming
  // from the upper left so the landing reads as a descending approach.
  function planArrival(from) {
    const H = tree.size().H;
    perch = choosePerch();
    if (!perch) { setState('waiting'); returnAt = clock + 20000; return; }
    const p = perchPoint();
    const v = flySpeed();
    const tLand = clipDur('land', LAND_SPEED) * SPRITE.clips.land.touch;
    // The landing eases out over tLand; starting it this far back keeps the
    // speed continuous (ease-out-cubic starts at 3x its average speed).
    const dLand = v * tLand / 1000 / 3;
    const dir = { x: 0.94, y: 0.34 };
    const a = { x: p.x - dir.x * dLand, y: p.y - dir.y * dLand };
    // y is the feet; the flying body rides ~0.7 of a perched height above them
    const start = from || { x: -SPRITE.bodyW * s * 1.5, y: H * rand(0.3, 0.42) };
    const span = Math.max(80, a.x - start.x);
    const pts = [start,
      { x: start.x + span * 0.35, y: start.y - H * rand(0.02, 0.06) },
      { x: a.x - dir.x * span * 0.3, y: a.y - dir.y * span * 0.3 },
      a];
    const len = bezierLength(pts);
    path = { pts: pts, dur: flightDuration(len, v) };
    landFrom = a;
    setState('flyIn');
  }

  function planDeparture() {
    const W = tree.size().W, H = tree.size().H;
    const start = { x: pos.x, y: pos.y };
    const end = { x: W + SPRITE.bodyW * s * 2, y: H * rand(-0.15, 0.2) };
    const pts = [start,
      { x: start.x + (end.x - start.x) * 0.35, y: start.y - H * 0.08 },
      { x: start.x + (end.x - start.x) * 0.7, y: end.y + H * 0.05 },
      end];
    path = { pts: pts, dur: flightDuration(bezierLength(pts), flySpeed()) };
    setState('flyOut');
  }

  function scare() {
    if (state !== 'perched') return;
    const p = perchPoint();
    tree.dropLeaf(p.x, p.y - 4);
    setState('takeoff');
  }

  function drawFrame(name, i) {
    const c = SPRITE.clips[name], img = sheets[name];
    if (!img) return;
    i = Math.max(0, Math.min(c.n - 1, i));
    const k = s / SPRITE.scale;   // display px per sheet px
    ctx.drawImage(img, (i % c.cols) * c.w, Math.floor(i / c.cols) * c.h, c.w, c.h,
      pos.x + (c.ox - SPRITE.anchor[0]) * s, pos.y + (c.oy - SPRITE.anchor[1]) * s, c.w * k, c.h * k);
  }

  function frameAt(name, ms, speed) {
    const c = SPRITE.clips[name];
    return Math.floor(ms / 1000 * c.fps * speed);
  }

  function update() {
    const age = clock - stateAt;
    switch (state) {
      case 'waiting':
        if (clock >= returnAt) planArrival(null);
        return;

      case 'flyIn':
      case 'flyOut': {
        const u = Math.min(1, age / path.dur);
        const q = bezier(path.pts, u);
        pos.x = q.x; pos.y = q.y;
        drawFrame('fly', frameAt('fly', age, FLY_SPEED) % SPRITE.clips.fly.n);
        if (u >= 1) {
          if (state === 'flyIn') { setState('landing'); }
          else { setState('waiting'); returnAt = clock + rand(25000, 45000); }
        }
        return;
      }

      case 'landing': {
        const dur = clipDur('land', LAND_SPEED);
        const tTouch = dur * SPRITE.clips.land.touch;
        const p = perchPoint();
        const k = Math.min(1, age / tTouch);
        const e = 1 - Math.pow(1 - k, 3);
        pos.x = landFrom.x + (p.x - landFrom.x) * e;
        pos.y = landFrom.y + (p.y - landFrom.y) * e;
        const f = frameAt('land', age, LAND_SPEED);
        drawFrame('land', f);
        if (k >= 1 && !landFrom.touched) { landFrom.touched = true; tree.dropLeaf(p.x, p.y - 4); }
        if (f >= SPRITE.clips.land.n - 1) {
          setState('perched');
          idleAt = clock; idleHold = rand(1200, 2500);
          leaveAt = clock + rand(70000, 120000);
        }
        return;
      }

      case 'perched': {
        const p = perchPoint();
        pos.x = p.x; pos.y = p.y;
        if (reduceMotion) { drawFrame('idle', 0); return; }
        const look = clock - idleAt - idleHold;
        const n = SPRITE.clips.idle.n;
        const f = look > 0 ? frameAt('idle', look, IDLE_SPEED) : 0;
        if (f >= n) { idleAt = clock; idleHold = rand(800, 3500); drawFrame('idle', 0); }
        else drawFrame('idle', f);
        if (clock >= leaveAt) scare();
        return;
      }

      case 'takeoff': {
        const dur = clipDur('takeoff', TAKEOFF_SPEED);
        const tLift = dur * SPRITE.clips.takeoff.lift;
        const p = perchPoint();
        // Feet stay on the branch until lift-off, then the bird accelerates
        // up and away, reaching cruising speed as the clip ends.
        const k = Math.max(0, (age - tLift) / (dur - tLift));
        const d = flySpeed() * (dur - tLift) / 1000 / 2 * k * k;
        pos.x = p.x + 0.9 * d;
        pos.y = p.y - 0.44 * d;
        const f = frameAt('takeoff', age, TAKEOFF_SPEED);
        drawFrame('takeoff', f);
        if (f >= SPRITE.clips.takeoff.n - 1) planDeparture();
        return;
      }
    }
  }

  tree.onDraw = function (t) {
    if (state === 'loading') return;
    if (lastT !== null) clock += Math.min(Math.max(t - lastT, 0), 50);   // no jumps after a hidden tab
    lastT = t;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    update();
    ctx.restore();
  };

  // The tree regrows on resize, so the bird needs a new branch.
  tree.onBuild = function () {
    if (state === 'loading') return;
    resizeBird();
    if (state === 'perched' || state === 'landing' || state === 'takeoff') {
      perch = choosePerch();
      if (!perch) { setState('waiting'); returnAt = clock + 20000; return; }
      if (state === 'landing') { setState('perched'); leaveAt = clock + rand(70000, 120000); }
      const p = perchPoint(); pos.x = p.x; pos.y = p.y;
      idleAt = clock; idleHold = rand(800, 2500);
    } else if (state === 'flyIn') {
      planArrival({ x: pos.x, y: pos.y });
    }
  };

  function near(e) {
    const r = box.getBoundingClientRect();
    const c = SPRITE.clips.idle;
    const cx = pos.x + (c.ox + c.w / SPRITE.scale / 2 - SPRITE.anchor[0]) * s;
    const cy = pos.y + (c.oy + c.h / SPRITE.scale / 2 - SPRITE.anchor[1]) * s;
    const reach = Math.max(70, SPRITE.bodyH * s * 1.3);
    return Math.hypot(e.clientX - r.left - cx, e.clientY - r.top - cy) < reach;
  }
  if (!reduceMotion) {
    const spook = function (e) { if (state === 'perched' && near(e)) scare(); };
    box.addEventListener('pointermove', spook, { passive: true });
    box.addEventListener('pointerdown', spook, { passive: true });
  }

  function load() {
    const names = Object.keys(SPRITE.clips);
    let left = names.length;
    names.forEach(function (name) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = function () {
        sheets[name] = img;
        if (--left === 0) start();
      };
      img.src = DIR + SPRITE.clips[name].src;
    });
  }

  function start() {
    resizeBird();
    if (reduceMotion) {
      perch = choosePerch();
      if (!perch) return;
      setState('perched');
      leaveAt = Infinity;
      return;
    }
    setState('waiting');
    returnAt = clock + 900;
  }

  // Sheets are fetched after the page has loaded so they never compete with
  // the content for bandwidth.
  if (document.readyState === 'complete') load();
  else window.addEventListener('load', load);
})();
