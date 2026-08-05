// Generative tree for the home hero — adapted from the santirosina.com
// coming-soon page (canvas recursive tree with wind sway + falling leaves),
// contained to the hero panel and recolored to the site palette.
(function () {
  const canvas = document.getElementById('hero-tree');
  if (!canvas) return;
  const box = canvas.parentElement;
  const ctx = canvas.getContext('2d');
  // Animation is always on (matches the original's deliberate choice).
  const reduceMotion = false;

  const LEAF_COLORS = [
    'rgba(127, 76, 41, 0.55)',    // saddle brown (brand accent)
    'rgba(165, 99, 54, 0.50)',    // lighter brown (brand hover)
    'rgba(139, 128, 96, 0.50)',   // muted olive
    'rgba(168, 112, 96, 0.45)',   // dusty rose
    'rgba(120, 110, 84, 0.50)'
  ];
  const BRANCH_COLOR = 'rgba(84, 56, 34, 0.9)';

  let W, H, DPR;
  let branches = [];
  let leaves = [];
  let falling = [];
  let windT = 0;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = box.clientWidth;
    H = box.clientHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildTree();
    // Always paint one static frame immediately — rAF may be throttled or
    // suspended (hidden/background tab) and the tree should still appear.
    ctx.clearRect(0, 0, W, H);
    drawBranches();
    drawAttachedLeaves();
  }

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function buildTree() {
    branches = [];
    leaves = [];
    falling = [];

    // Root toward the right of the block (clamped so it hugs the content
    // column's right edge on very wide screens), like the original.
    const rootX = W > 700 ? Math.min(W * 0.82, W / 2 + 430) : W * 0.9;
    const rootY = H + 10;
    const trunkLen = Math.min(H * 0.32, 300);
    const maxDepth = W > 700 ? 9 : 8;

    grow(rootX, rootY, -Math.PI / 2 + rand(-0.05, 0.05), trunkLen, Math.max(8, trunkLen * 0.06), 0, maxDepth);

    // The random growth can overshoot the block and get clipped flat at the
    // top — measure the tree and rescale it around the root so it fits with
    // a margin (leaf sway needs ~4px of headroom on top of the margin).
    const margin = Math.max(16, H * 0.06);
    let minY = Infinity;
    for (const b of branches) minY = Math.min(minY, b.y1, b.y2);
    for (const l of leaves) minY = Math.min(minY, l.y - l.size - 6);
    if (minY < margin) {
      const s = (rootY - margin) / (rootY - minY);
      for (const b of branches) {
        b.x1 = rootX + (b.x1 - rootX) * s; b.y1 = rootY + (b.y1 - rootY) * s;
        b.x2 = rootX + (b.x2 - rootX) * s; b.y2 = rootY + (b.y2 - rootY) * s;
        b.width *= s;
      }
      for (const l of leaves) {
        l.x = rootX + (l.x - rootX) * s;
        l.y = rootY + (l.y - rootY) * s;
        l.size *= s;
      }
    }
  }

  function grow(x, y, angle, len, width, depth, maxDepth) {
    const x2 = x + Math.cos(angle) * len;
    const y2 = y + Math.sin(angle) * len;
    branches.push({ x1: x, y1: y, x2, y2, width, depth });

    if (depth >= maxDepth || len < 6) {
      const n = Math.floor(rand(5, 10));
      for (let i = 0; i < n; i++) {
        leaves.push({
          x: x2 + rand(-16, 16),
          y: y2 + rand(-16, 16),
          size: rand(4, 9),
          color: pick(LEAF_COLORS),
          angle: rand(0, Math.PI * 2),
          phase: rand(0, Math.PI * 2),
          sway: rand(0.4, 1.0)
        });
      }
      return;
    }

    const nBranches = depth < 2 ? 2 : (Math.random() < 0.75 ? 2 : 3);
    for (let i = 0; i < nBranches; i++) {
      const spread = rand(0.25, 0.55);
      const newAngle = angle + rand(-spread, spread) + (i === 0 ? -spread * 0.6 : spread * 0.6);
      grow(x2, y2, newAngle, len * rand(0.68, 0.8), width * 0.68, depth + 1, maxDepth);
    }

    if (depth >= maxDepth - 4 && Math.random() < 0.8) {
      const t = Math.floor(rand(1, 4));
      for (let i = 0; i < t; i++) {
        leaves.push({
          x: x2 + rand(-13, 13),
          y: y2 + rand(-13, 13),
          size: rand(3.5, 8),
          color: pick(LEAF_COLORS),
          angle: rand(0, Math.PI * 2),
          phase: rand(0, Math.PI * 2),
          sway: rand(0.4, 1.0)
        });
      }
    }
  }

  function drawBranches() {
    ctx.lineCap = 'round';
    ctx.strokeStyle = BRANCH_COLOR;
    for (const b of branches) {
      const swayAmt = b.depth > 4 ? Math.sin(windT * 0.7 + b.x2 * 0.01) * (b.depth - 4) * 0.6 : 0;
      ctx.beginPath();
      ctx.lineWidth = b.width;
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2 + swayAmt, b.y2);
      ctx.stroke();
    }
  }

  function drawLeaf(x, y, size, angle, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.quadraticCurveTo(size * 0.8, 0, 0, size);
    ctx.quadraticCurveTo(-size * 0.8, 0, 0, -size);
    ctx.fill();
    ctx.restore();
  }

  function drawAttachedLeaves() {
    for (const l of leaves) {
      const sway = reduceMotion ? 0 : Math.sin(windT + l.phase) * 3 * l.sway;
      const flutter = reduceMotion ? 0 : Math.sin(windT * 1.6 + l.phase) * 0.15 * l.sway;
      drawLeaf(l.x + sway, l.y + Math.cos(windT * 0.8 + l.phase) * 1.2, l.size, l.angle + flutter, l.color);
    }
  }

  function spawnFallingLeaf() {
    if (!leaves.length) return;
    const src = pick(leaves);
    falling.push({
      x: src.x, y: src.y,
      size: src.size,
      color: src.color,
      angle: rand(0, Math.PI * 2),
      spin: rand(-0.03, 0.03),
      vy: rand(0.35, 0.8),
      drift: rand(0.5, 1.6),
      phase: rand(0, Math.PI * 2),
      alpha: 1
    });
  }

  function drawFallingLeaves() {
    for (let i = falling.length - 1; i >= 0; i--) {
      const f = falling[i];
      f.y += f.vy;
      f.x += Math.sin(windT * 1.2 + f.phase) * f.drift + 0.15;
      f.angle += f.spin + Math.sin(windT + f.phase) * 0.01;
      if (f.y > H * 0.92) f.alpha -= 0.01;

      if (f.alpha <= 0 || f.y > H + 30) {
        falling.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = f.alpha;
      drawLeaf(f.x, f.y, f.size, f.angle, f.color);
      ctx.globalAlpha = 1;
    }
  }

  let lastSpawn = 0;
  function frame(t) {
    windT = t / 1000;
    ctx.clearRect(0, 0, W, H);

    drawBranches();
    drawAttachedLeaves();

    if (!reduceMotion) {
      if (t - lastSpawn > rand(600, 1800) && falling.length < 12) {
        spawnFallingLeaf();
        lastSpawn = t;
      }
      drawFallingLeaves();
      requestAnimationFrame(frame);
    }
  }

  let resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });

  resize();
  if (!reduceMotion) requestAnimationFrame(frame);
})();
