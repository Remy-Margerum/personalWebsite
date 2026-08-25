/* Fishing chart — bluefin water from Santa Barbara Harbor.
   Draws the Channel Islands as a line chart in the style of the sailing
   page, then lays the NOAA/NESDIS Geo-Polar blended 5 km sea-surface
   temperature analysis over it: a soft temperature wash, isotherms at
   60 / 64 / 68 / 72 °F, and the Open-Meteo wind field as drifting
   particles. Fish stack on the 64–68 °F break; the chart shows where
   that break sits today, and where it sat each day this week. */
(function () {
  'use strict';
  var D = window.FISHING_DATA;
  var frame = document.getElementById('fish-frame');
  if (!D || !frame) return;

  var svg = document.getElementById('fish-svg');
  var canvas = document.getElementById('fish-canvas');
  var ctx = canvas.getContext('2d');
  var tooltip = document.getElementById('fish-tooltip');
  var NS = 'http://www.w3.org/2000/svg';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- projection: lon/lat -> world px (north up, y down) ---------- */
  var COSL = Math.cos(33.7 * Math.PI / 180);
  var SCALE = 1000;
  var REF = { lon: -121.4, lat: 34.9 };
  function P(lon, lat) {
    return [(lon - REF.lon) * COSL * SCALE, (REF.lat - lat) * SCALE];
  }
  function pOf(m) { return P(m.lon, m.lat); }
  var WORLD_PER_NM = SCALE / 60;

  var HARBOR = D.harbor;
  var harborW = pOf(HARBOR);
  var programs = D.programs;
  var prog = programs[0];

  /* ---------- svg scaffolding (bottom to top) ---------- */
  function el(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  var gBathy = el('g', { 'class': 'ch-bathyg' }, svg);     /* depth contours — bottom of the stack */
  var gIso = el('g', { 'class': 'ch-isog' }, svg);        /* isotherms — under land so they never cross the beach */
  var gWater = el('g', { 'class': 'ch-water' }, svg);      /* range rings — under land too */
  var gBound = el('g', { 'class': 'ch-boundg' }, svg);     /* sanctuary + MPA boundaries, land covers the shore side */
  var gLand = el('g', { 'class': 'ch-land' }, svg);
  var gGeoFixed = el('g', { 'class': 'ch-geofixed' }, svg);/* big printed names, scale with the chart */
  var gGeoLabels = el('g', { 'class': 'ch-geolabels' }, svg);
  var gMpaLbl = el('g', { 'class': 'ch-mpalbls' }, svg);   /* MPA names, only when zoomed right in */
  var gBathyLbl = el('g', { 'class': 'ch-bathylbls' }, svg);
  var gIsoLbl = el('g', { 'class': 'ch-isolbls' }, svg);
  var gMarkWind = el('g', { 'class': 'ch-markwind' }, svg);
  var gMarks = el('g', { 'class': 'ch-marks' }, svg);

  function pathFrom(lines, close) {
    var d = '';
    lines.forEach(function (line) {
      line.forEach(function (pt, i) {
        var w = P(pt[0], pt[1]);
        d += (i ? 'L' : 'M') + w[0].toFixed(1) + ' ' + w[1].toFixed(1);
      });
      if (close) d += 'Z';
    });
    return d;
  }

  /* mainland: close the coastline chain over the top of the world */
  var coast = D.geo.mainland[0];
  var first = P(coast[0][0], coast[0][1]);
  var last = P(coast[coast.length - 1][0], coast[coast.length - 1][1]);
  var landD = pathFrom([coast]) +
    'L' + (last[0] + 600) + ' ' + last[1] +
    'L' + (last[0] + 600) + ' -700' +
    'L' + (first[0] - 600) + ' -700' +
    'L' + (first[0] - 600) + ' ' + first[1] + 'Z';
  el('path', { d: landD, 'class': 'ch-landfill' }, gLand);
  var coastPath = el('path', { d: pathFrom([coast]), 'class': 'ch-coast' }, gLand);
  D.geo.mainland.slice(1).forEach(function (c) {
    el('path', { d: pathFrom([c]), 'class': 'ch-coast' }, gLand);
  });
  D.geo.islands.forEach(function (i) {
    el('path', { d: pathFrom([i], true), 'class': 'ch-islet' }, gLand);
  });

  /* range rings from the harbor mouth — 20 / 40 / 60 nm */
  var ringLbls = [];
  /* fill="none" attributes double the stylesheet rules: if a stale cached
     CSS ever loads with this page, the chart degrades to plain lines
     instead of black-filled shapes */
  [20, 40, 60].forEach(function (nm) {
    var r = nm * WORLD_PER_NM;
    el('circle', { cx: harborW[0], cy: harborW[1], r: r, fill: 'none', stroke: '#b6bfc9', 'class': 'ch-ring' }, gWater);
    var az = 170 * Math.PI / 180; /* labels run down between the islands, over open water */
    var t = el('text', {
      x: harborW[0] + r * Math.sin(az), y: harborW[1] - r * Math.cos(az),
      'class': 'ch-ringlbl', 'text-anchor': 'middle'
    }, gWater);
    t.textContent = nm + ' nm';
    ringLbls.push(t);
  });

  /* ---------- bathymetry: GMRT isobaths + a packed hover-depth grid ---------- */
  var BG = D.bathy.grid;
  function depthFm(lon, lat) {
    var a = Math.floor((lat - BG.lat0) / BG.d), b = Math.floor((lon - BG.lon0) / BG.d);
    if (a < 0 || b < 0 || a >= BG.nlat || b >= BG.nlon) return null;
    var s = BG.enc.substr((a * BG.nlon + b) * 2, 2);
    return s === 'zz' ? null : parseInt(s, 36);
  }
  function fmtDepth(fm) {
    if (fm == null) return null;
    return fm < 100 ? fm + ' fm (' + Math.round(fm * 6) + ' ft)' : fm + ' fm';
  }
  Object.keys(D.bathy.iso).forEach(function (fm) {
    var chains = D.bathy.iso[fm];
    var d = '';
    chains.forEach(function (c) {
      c.forEach(function (p, i) {
        var w = P(p[0], p[1]);
        d += (i ? 'L' : 'M') + w[0].toFixed(1) + ' ' + w[1].toFixed(1);
      });
    });
    el('path', {
      d: d, fill: 'none', 'vector-effect': 'non-scaling-stroke',
      'class': 'ch-bathy ch-bathy--' + fm
    }, gBathy);
    /* a couple of inline depth figures per contour, chart-style */
    chains.slice().sort(function (a, b) { return b.length - a.length; })
      .slice(0, 2).forEach(function (c) {
        var i = Math.max(1, Math.min(c.length - 2, Math.round(c.length * 0.4)));
        var a = P(c[i - 1][0], c[i - 1][1]), b = P(c[i + 1][0], c[i + 1][1]);
        var ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
        if (ang > 90) ang -= 180;
        if (ang < -90) ang += 180;
        var w = P(c[i][0], c[i][1]);
        var t = el('text', {
          x: w[0], y: w[1] - 2, 'class': 'ch-bathylbl', 'text-anchor': 'middle',
          transform: 'rotate(' + ang.toFixed(1) + ' ' + w[0] + ' ' + w[1] + ')'
        }, gBathyLbl);
        t.textContent = fm + ' fm';
      });
  });

  /* ---------- sanctuary + MPA boundaries (indicative, not navigational) ---------- */
  var sanctPaths = [];
  (D.sanctuary || []).forEach(function (r) {
    sanctPaths.push(el('path', {
      d: pathFrom([r], true), fill: 'none', 'class': 'ch-sanct'
    }, gBound));
  });
  var mpaLblEls = [];
  (D.mpas || []).forEach(function (m) {
    el('path', {
      d: pathFrom(m.rings, true),
      'class': 'ch-mpa ch-mpa--' + m.kind
    }, gBound);
    var w = P(m.c[0], m.c[1]);
    var t = el('text', { x: w[0], y: w[1], 'class': 'ch-mpalbl', 'text-anchor': 'middle' }, gMpaLbl);
    t.textContent = m.name;
    mpaLblEls.push(t);
  });

  /* which MPA (if any) is the cursor inside — bbox test, then ray-cast */
  var mpaBoxes = (D.mpas || []).map(function (m) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    m.rings.forEach(function (r) {
      r.forEach(function (p) {
        if (p[0] < x0) x0 = p[0];
        if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1];
        if (p[1] > y1) y1 = p[1];
      });
    });
    return [x0, y0, x1, y1];
  });
  function inRing(ring, x, y) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function mpaAt(lon, lat) {
    for (var k = 0; k < (D.mpas || []).length; k++) {
      var bb = mpaBoxes[k];
      if (lon < bb[0] || lon > bb[2] || lat < bb[1] || lat > bb[3]) continue;
      var m = D.mpas[k];
      for (var r = 0; r < m.rings.length; r++) {
        if (inRing(m.rings[r], lon, lat)) return m;
      }
    }
    return null;
  }

  /* ---------- printed names ---------- */
  var chanLbl = el('text', {
    x: P(-120.02, 0)[0], y: P(0, 34.21)[1], 'class': 'ch-city', 'text-anchor': 'middle',
    transform: 'rotate(12 ' + P(-120.02, 0)[0] + ' ' + P(0, 34.21)[1] + ')'
  }, gGeoFixed);
  chanLbl.textContent = 'S A N T A   B A R B A R A   C H A N N E L';
  chanLbl.style.fontSize = '26px'; /* world units — printed on the chart */

  /* the sailing stylesheet sizes these classes for its own chart scale, so
     size them per-zoom inline instead (screen-constant, like mark labels) */
  var geoLblEls = [];
  function geoLabel(text, lon, lat, cls) {
    var w = P(lon, lat);
    var t = el('text', { x: w[0], y: w[1], 'class': cls, 'text-anchor': 'middle' }, gGeoLabels);
    t.textContent = text;
    geoLblEls.push({ el: t, size: cls === 'ch-place' ? 11.5 : 10 });
    return t;
  }
  /* level of detail: shore names only when the chart is big enough to hold them */
  function lodLabels(z) {
    var v = z <= 3.4 ? '' : 'none';
    geoLblEls.forEach(function (l) { l.el.style.display = v; });
  }
  geoLabel('Pt. Conception', -120.36, 34.375, 'ch-place');
  geoLabel('Santa Barbara', -119.70, 34.485, 'ch-place');
  geoLabel('Ventura', -119.10, 34.355, 'ch-place');
  geoLabel('San Miguel I.', -120.37, 34.115, 'ch-place');
  geoLabel('Santa Rosa I.', -120.10, 34.085, 'ch-place');
  geoLabel('Santa Cruz I.', -119.72, 34.10, 'ch-place');
  geoLabel('Anacapa I.', -119.36, 34.055, 'ch-place');
  geoLabel('Santa Barbara I.', -119.08, 33.555, 'ch-place-sm');
  geoLabel('Begg Rock', -119.696, 33.388, 'ch-note');
  geoLabel('Channel Is. National Marine Sanctuary', -120.42, 33.885, 'ch-note');

  /* Begg Rock — a charted high spot between the grounds, too small for
     the coastline extract */
  var beggW = P(-119.696, 33.365);
  el('path', {
    d: 'M' + (beggW[0] - 4) + ' ' + beggW[1] + 'H' + (beggW[0] + 4) +
       'M' + beggW[0] + ' ' + (beggW[1] - 4) + 'V' + (beggW[1] + 4),
    fill: 'none', 'class': 'ch-rock'
  }, gGeoLabels);

  /* ---------- harbor origin + fishing spots ---------- */
  function fmtCoord(m) {
    function dmf(v, isLat) {
      var a = Math.abs(v), d = Math.floor(a), mn = (a - d) * 60;
      return (isLat ? (v >= 0 ? 'N ' : 'S ') : (v >= 0 ? 'E ' : 'W ')) +
        d + '° ' + mn.toFixed(1) + '′';
    }
    return dmf(m.lat, true) + ' · ' + dmf(m.lon, false);
  }
  function distNm(w) {
    return Math.hypot(w[0] - harborW[0], w[1] - harborW[1]) / WORLD_PER_NM;
  }
  function brgTrue(w) {
    var b = Math.atan2(w[0] - harborW[0], -(w[1] - harborW[1])) * 180 / Math.PI;
    return (b + 360) % 360;
  }
  function brgMag(w) {
    return Math.round((brgTrue(w) - D.meta.variationE + 360) % 360);
  }
  function compass16(deg) {
    var pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return pts[Math.round(deg / 22.5) % 16];
  }

  function placeTipAt(s) {
    var tw = tooltip.offsetWidth;
    tooltip.style.left = Math.max(6, Math.min(frame.clientWidth - tw - 6, s[0] - tw / 2)) + 'px';
    tooltip.style.top = Math.max(6, s[1] - 44) + 'px';
  }
  function hideTip() { tooltip.style.display = 'none'; }
  svg.addEventListener('click', hideTip);

  var gObs = el('g', { 'class': 'ch-obs' }, gMarks);
  var obsPulse = el('circle', { cx: harborW[0], cy: harborW[1], r: 6.5, 'class': 'ch-obs-pulse' }, gObs);
  var obsRing = el('circle', { cx: harborW[0], cy: harborW[1], r: 6.5, 'class': 'ch-obs-ring' }, gObs);
  var obsDot = el('circle', { cx: harborW[0], cy: harborW[1], r: 2.2, 'class': 'ch-obs-dot' }, gObs);
  var harborLbl = el('text', { x: 0, y: 0, 'class': 'ch-marklbl' }, gObs);
  harborLbl.textContent = 'S.B. Harbor';
  var obsHit = el('circle', { cx: harborW[0], cy: harborW[1], r: 13, 'class': 'ch-hit' }, gObs);
  obsHit.addEventListener('mouseenter', function () {
    tooltip.innerHTML = '<strong>Santa Barbara Harbor</strong> ' + fmtCoord(HARBOR) +
      ' · every run starts here';
    tooltip.style.display = 'block';
    placeTipAt(worldToScreen(harborW));
  });
  obsHit.addEventListener('mouseleave', hideTip);

  /* program spots + troll routes — rebuilt whenever the target changes */
  var gSpots = el('g', {}, gMarks);
  var spotEls = [];
  var trollEls = [];
  function drawProgram() {
    while (gSpots.firstChild) gSpots.removeChild(gSpots.firstChild);
    spotEls = [];
    trollEls = [];
    (prog.routes || []).forEach(function (rt) {
      var d = '';
      rt.pts.forEach(function (p, i) {
        var w = P(p[0], p[1]);
        d += (i ? 'L' : 'M') + w[0].toFixed(1) + ' ' + w[1].toFixed(1);
      });
      trollEls.push(el('path', { d: d, fill: 'none', 'class': 'ch-troll' }, gSpots));
      /* direction arrow + name at the route's midpoint */
      var mi = Math.max(1, Math.floor(rt.pts.length / 2));
      var a = P(rt.pts[mi - 1][0], rt.pts[mi - 1][1]);
      var b = P(rt.pts[mi][0], rt.pts[mi][1]);
      var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      var ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
      var arr = el('path', {
        d: 'M-5 -3.5L5 0L-5 3.5Z', 'class': 'ch-trollarrow',
        transform: 'translate(' + mx + ' ' + my + ') rotate(' + ang + ')'
      }, gSpots);
      var lblAng = ang > 90 ? ang - 180 : ang < -90 ? ang + 180 : ang;
      var tl = el('text', {
        x: mx, y: my, 'class': 'ch-trolllbl', 'text-anchor': 'middle',
        transform: 'rotate(' + lblAng.toFixed(1) + ' ' + mx + ' ' + my + ')'
      }, gSpots);
      tl.textContent = rt.name;
      trollEls.push({ arr: arr, lbl: tl, mx: mx, my: my });
    });
    prog.spots.forEach(function (s) {
      var w = pOf(s);
      var g2 = el('g', { 'class': 'ch-mark' }, gSpots);
      el('circle', { cx: w[0], cy: w[1], r: 5, 'class': 'ch-buoy ch-spot' }, g2);
      el('circle', { cx: w[0], cy: w[1], r: 1.5, 'class': 'ch-buoy-dot' }, g2);
      var lbl = el('text', {
        x: 0, y: 0, 'class': 'ch-marklbl',
        'text-anchor': (s.side || 1) < 0 ? 'end' : 'start'
      }, g2);
      lbl.textContent = s.opt + ' · ' + s.name;
      var hit = el('circle', { cx: w[0], cy: w[1], r: 15, 'class': 'ch-hit' }, g2);
      var tip = function () {
        var t = sstAtLonLat(s.lon, s.lat);
        var dep = fmtDepth(depthFm(s.lon, s.lat));
        tooltip.innerHTML = '<strong>' + s.name + '</strong> ' + fmtCoord(s) +
          ' · ' + Math.round(distNm(w)) + ' nm' +
          (dep ? ' · ' + dep : '') +
          (t == null ? '' : ' · ' + t.toFixed(1) + ' °F');
        tooltip.style.display = 'block';
        placeTipAt(worldToScreen(w));
      };
      hit.addEventListener('mouseenter', tip);
      hit.addEventListener('mouseleave', hideTip);
      hit.addEventListener('click', function (ev) { tip(); ev.stopPropagation(); });
      spotEls.push({ lbl: lbl, w: w, side: s.side || 1 });
    });
    applyView(vb); /* size the fresh elements for the current zoom */
  }

  /* ---------- view: fitted per target, zoomable from there ---------- */
  var vb = { x: 0, y: 0, w: 100, h: 100 };
  var baseView = null;   /* the whole chart — panning is clamped to this */
  var homeView = null;   /* the active target's fit — reset returns here */
  function computeFit(pts) {
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var bb = {
      x: Math.min.apply(null, xs), y: Math.min.apply(null, ys),
      w: Math.max.apply(null, xs) - Math.min.apply(null, xs),
      h: Math.max.apply(null, ys) - Math.min.apply(null, ys)
    };
    var cw = frame.clientWidth || 800, chh = frame.clientHeight || 600;
    var aspect = cw / chh;
    var padX = bb.w * 0.06 + 14, padT = bb.h * 0.06 + 14, padB = bb.h * 0.05 + 12;
    var w = bb.w + padX * 2, h = bb.h + padT + padB;
    var cx = bb.x + bb.w / 2, cy = bb.y - padT / 2 + padB / 2 + bb.h / 2;
    if (w / h < aspect) w = h * aspect; else h = w / aspect;
    return { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
  }
  function fitView() {
    baseView = computeFit([harborW, P(-120.72, 34.47), P(-118.92, 33.16),
      P(-120.47, 33.9), P(-119.39, 33.21), P(-120.10, 33.835)]);
    if (prog && prog.fit) {
      var f = prog.fit;
      homeView = computeFit([P(f[0], f[1]), P(f[2], f[3])]);
      /* a target fit may poke past the chart edge — pull it back in */
      homeView = clampView(homeView);
    } else {
      homeView = baseView;
    }
    applyView(homeView);
  }
  function clampView(v) {
    if (!baseView) return v;
    var w = Math.min(baseView.w, Math.max(baseView.w / 12, v.w));
    var h = w * (baseView.h / baseView.w);
    return {
      w: w, h: h,
      x: Math.min(Math.max(v.x, baseView.x), baseView.x + baseView.w - w),
      y: Math.min(Math.max(v.y, baseView.y), baseView.y + baseView.h - h)
    };
  }
  function zoomAt(factor, sx, sy) {
    var wpt = screenToWorld(sx, sy);
    var w = vb.w * factor, h = vb.h * factor;
    applyView(clampView({
      x: wpt[0] - sx / frame.clientWidth * w,
      y: wpt[1] - sy / frame.clientHeight * h,
      w: w, h: h
    }));
    scheduleRebuild();
    if (reduceMotion) tick(performance.now());
  }
  function zoomOf(v) { return v.w / (frame.clientWidth || 800); }
  function worldToScreen(w) {
    return [(w[0] - vb.x) / vb.w * frame.clientWidth, (w[1] - vb.y) / vb.h * frame.clientHeight];
  }
  function screenToWorld(x, y) {
    return [vb.x + x / frame.clientWidth * vb.w, vb.y + y / frame.clientHeight * vb.h];
  }

  function applyView(v) {
    vb = v;
    svg.setAttribute('viewBox', v.x + ' ' + v.y + ' ' + v.w + ' ' + v.h);
    var z = zoomOf(v);
    gMarks.style.fontSize = (11.5 * z) + 'px';
    gGeoLabels.style.fontSize = (11 * z) + 'px';
    geoLblEls.forEach(function (l) { l.el.style.fontSize = (l.size * z) + 'px'; });
    lodLabels(z);
    gIsoLbl.style.fontSize = (9.5 * z) + 'px';
    gMarkWind.style.fontSize = (8.5 * z) + 'px';
    gWater.style.fontSize = (9 * z) + 'px';
    Array.prototype.forEach.call(gMarks.querySelectorAll('.ch-buoy'), function (c) {
      c.setAttribute('r', 5 * z);
    });
    Array.prototype.forEach.call(gMarks.querySelectorAll('.ch-buoy-dot'), function (c) {
      c.setAttribute('r', 1.5 * z);
    });
    Array.prototype.forEach.call(gMarks.querySelectorAll('.ch-hit'), function (c) {
      c.setAttribute('r', 15 * z);
    });
    spotEls.forEach(function (e) {
      e.lbl.setAttribute('x', e.w[0] + e.side * 9 * z);
      e.lbl.setAttribute('y', e.w[1] - 6 * z);
    });
    /* troll routes: dash + arrow + label scale with the screen */
    var td = (8 * z) + ' ' + (5 * z);
    trollEls.forEach(function (t) {
      if (t.style) { t.style.strokeDasharray = td; return; }
      t.arr.setAttribute('transform', t.arr.getAttribute('transform')
        .replace(/scale\([^)]*\)/, '').trim() + ' scale(' + z + ')');
      t.lbl.style.fontSize = (9.5 * z) + 'px';
      t.lbl.setAttribute('y', t.my - 6 * z);
    });
    harborLbl.setAttribute('x', harborW[0] + 8 * z);
    harborLbl.setAttribute('y', harborW[1] - 6 * z);
    obsRing.setAttribute('r', 6.5 * z);
    obsPulse.setAttribute('r', 6.5 * z);
    obsDot.setAttribute('r', 2.2 * z);
    obsHit.setAttribute('r', 13 * z);
    var rd = (5 * z) + ' ' + (6 * z);
    Array.prototype.forEach.call(gWater.querySelectorAll('.ch-ring'), function (c) {
      c.style.strokeDasharray = rd;
    });
    /* sanctuary boundary: chart-style long dash, screen-constant */
    var sd = (9 * z) + ' ' + (4 * z) + ' ' + (2 * z) + ' ' + (4 * z);
    sanctPaths.forEach(function (p) { p.style.strokeDasharray = sd; });
    /* MPA names only when zoomed right in */
    gMpaLbl.style.fontSize = (9.5 * z) + 'px';
    gMpaLbl.style.display = z <= 1.35 ? '' : 'none';
    /* depth figures: with the structure view they surface much earlier */
    gBathyLbl.style.fontSize = (9 * z) + 'px';
    gBathyLbl.style.display =
      (prog.view === 'structure' && z <= 3.2) || z <= 1.35 ? '' : 'none';
    placeBoat(z);
    var zoomedIn = homeView && vb.w < homeView.w * 0.985;
    var offHome = homeView && (zoomedIn ||
      Math.abs(vb.x - homeView.x) > homeView.w * 0.01 ||
      Math.abs(vb.y - homeView.y) > homeView.h * 0.01);
    if (resetBtn) resetBtn.style.display = offHome ? '' : 'none';
    /* zoomed in on touch: claim the finger for panning */
    frame.style.touchAction = baseView && vb.w < baseView.w * 0.985 ? 'none' : 'pan-y';
  }

  /* ---------- coastline draw-on ---------- */
  if (!reduceMotion) {
    var L = coastPath.getTotalLength();
    coastPath.style.strokeDasharray = L + ' ' + L;
    coastPath.style.strokeDashoffset = L;
    requestAnimationFrame(function () {
      coastPath.style.transition = 'stroke-dashoffset 2.2s ease-out';
      coastPath.style.strokeDashoffset = '0';
      setTimeout(function () {
        coastPath.style.strokeDasharray = 'none';
        coastPath.style.transition = '';
      }, 2400);
    });
  }

  /* ---------- NOAA SST: Geo-Polar blended 5 km analysis via ERDDAP ----------
     ERDDAP doesn't send CORS headers, but it speaks JSONP — good enough
     for a static page. One request per analysis day, cached. */
  var ERDDAP = 'https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsstDNDaily.json' +
    '?analysed_sst%5Blast{B}%5D%5B(32.7):(34.8)%5D%5B(-121.4):(-118.35)%5D';
  var LEVELS = [60, 64, 68, 72];
  var jsonpSeq = 0;
  function jsonp(url, cb) {
    var name = 'FISH_SST_' + (jsonpSeq++);
    var s = document.createElement('script');
    var to = setTimeout(function () { cleanup(); cb(new Error('timeout')); }, 25000);
    function cleanup() {
      clearTimeout(to);
      try { delete window[name]; } catch (e) { window[name] = undefined; }
      if (s.parentNode) s.parentNode.removeChild(s);
    }
    window[name] = function (data) { cleanup(); cb(null, data); };
    s.onerror = function () { cleanup(); cb(new Error('load failed')); };
    s.src = url + '&.jsonp=' + name;
    document.head.appendChild(s);
  }

  var sstCache = {};       /* daysBack -> grid */
  var sst = null;          /* active grid */
  var condEl = document.getElementById('fish-conditions');
  var dayScrub = document.getElementById('fish-day');
  var dayLabel = document.getElementById('fish-day-label');
  var backBtn = document.getElementById('fish-back');
  var fwdBtn = document.getElementById('fish-fwd');

  /* shared grid finisher: min/max plus land cells filled from their water
     neighbours so isotherms and the wash run to the beach; the land fill
     covers the made-up part. fcst marks model output (vs NOAA analysis). */
  function finishGrid(lats, lons, v, date, fcst) {
    var min = Infinity, max = -Infinity;
    for (var i = 0; i < v.length; i++) {
      if (isNaN(v[i])) continue;
      if (v[i] < min) min = v[i];
      if (v[i] > max) max = v[i];
    }
    var vf = new Float64Array(v);
    for (var pass = 0; pass < 2; pass++) {
      var src = new Float64Array(vf);
      for (var a = 0; a < lats.length; a++) {
        for (var b = 0; b < lons.length; b++) {
          var k = a * lons.length + b;
          if (!isNaN(src[k])) continue;
          var s = 0, n = 0;
          for (var da = -1; da <= 1; da++) {
            for (var db = -1; db <= 1; db++) {
              var aa = a + da, bb = b + db;
              if (aa < 0 || bb < 0 || aa >= lats.length || bb >= lons.length) continue;
              var q = src[aa * lons.length + bb];
              if (!isNaN(q)) { s += q; n++; }
            }
          }
          if (n) vf[k] = s / n;
        }
      }
    }
    return { lats: lats, lons: lons, v: v, vf: vf, min: min, max: max, date: date, fcst: !!fcst };
  }

  function parseGrid(tbl) {
    var rows = tbl.table.rows;
    var latSet = {}, lonSet = {};
    rows.forEach(function (r) { latSet[r[1]] = 1; lonSet[r[2]] = 1; });
    var lats = Object.keys(latSet).map(Number).sort(function (a, b) { return a - b; });
    var lons = Object.keys(lonSet).map(Number).sort(function (a, b) { return a - b; });
    var li = {}, gi = {};
    lats.forEach(function (v, i) { li[v] = i; });
    lons.forEach(function (v, i) { gi[v] = i; });
    var v = new Float64Array(lats.length * lons.length);
    for (var i = 0; i < v.length; i++) v[i] = NaN;
    rows.forEach(function (r) {
      if (r[3] == null) return;
      v[li[r[1]] * lons.length + gi[r[2]]] = r[3] * 1.8 + 32;
    });
    return finishGrid(lats, lons, v, rows.length ? rows[0][0].slice(0, 10) : null, false);
  }

  /* bilinear sample of the raw (not land-filled) grid, °F or null */
  function sstAtLonLat(lon, lat) {
    if (!sst) return null;
    var lats = sst.lats, lons = sst.lons;
    var fy = (lat - lats[0]) / (lats[1] - lats[0]);
    var fx = (lon - lons[0]) / (lons[1] - lons[0]);
    var y0 = Math.floor(fy), x0 = Math.floor(fx);
    if (y0 < 0 || x0 < 0 || y0 >= lats.length - 1 || x0 >= lons.length - 1) return null;
    var q = [], w = [], ty = fy - y0, tx = fx - x0;
    [[y0, x0, (1 - ty) * (1 - tx)], [y0, x0 + 1, (1 - ty) * tx],
     [y0 + 1, x0, ty * (1 - tx)], [y0 + 1, x0 + 1, ty * tx]].forEach(function (c) {
      var val = sst.v[c[0] * lons.length + c[1]];
      if (!isNaN(val)) { q.push(val * c[2]); w.push(c[2]); }
    });
    if (!q.length) return null;
    var sw = w.reduce(function (a, b) { return a + b; }, 0);
    if (sw < 0.25) return null;
    return q.reduce(function (a, b) { return a + b; }, 0) / sw;
  }

  /* ---------- isotherms: marching squares on a 3× bilinear upsample ---------- */
  function upsample(g, F) {
    var nl = (g.lats.length - 1) * F + 1, ng = (g.lons.length - 1) * F + 1;
    var u = new Float64Array(nl * ng);
    for (var i = 0; i < nl; i++) {
      var fy = i / F, y0 = Math.min(Math.floor(fy), g.lats.length - 2), ty = fy - y0;
      for (var j = 0; j < ng; j++) {
        var fx = j / F, x0 = Math.min(Math.floor(fx), g.lons.length - 2), tx = fx - x0;
        var a = g.vf[y0 * g.lons.length + x0], b = g.vf[y0 * g.lons.length + x0 + 1];
        var c = g.vf[(y0 + 1) * g.lons.length + x0], d = g.vf[(y0 + 1) * g.lons.length + x0 + 1];
        u[i * ng + j] = (isNaN(a) || isNaN(b) || isNaN(c) || isNaN(d)) ? NaN :
          a * (1 - ty) * (1 - tx) + b * (1 - ty) * tx + c * ty * (1 - tx) + d * ty * tx;
      }
    }
    return { v: u, nl: nl, ng: ng, F: F };
  }

  function marchLevel(u, g, level) {
    /* returns chained polylines in [lon,lat] */
    var segs = [];
    var F = u.F, dlat = (g.lats[1] - g.lats[0]) / F, dlon = (g.lons[1] - g.lons[0]) / F;
    function pt(j, i) { return [g.lons[0] + j * dlon, g.lats[0] + i * dlat]; }
    for (var i = 0; i < u.nl - 1; i++) {
      for (var j = 0; j < u.ng - 1; j++) {
        var v00 = u.v[i * u.ng + j], v01 = u.v[i * u.ng + j + 1];
        var v10 = u.v[(i + 1) * u.ng + j], v11 = u.v[(i + 1) * u.ng + j + 1];
        if (isNaN(v00) || isNaN(v01) || isNaN(v10) || isNaN(v11)) continue;
        var idx = (v00 >= level ? 1 : 0) | (v01 >= level ? 2 : 0) |
                  (v11 >= level ? 4 : 0) | (v10 >= level ? 8 : 0);
        if (idx === 0 || idx === 15) continue;
        var ix = function (va, vb, ja, ia, jb, ib) {
          var t = (level - va) / (vb - va);
          return [ja + (jb - ja) * t, ia + (ib - ia) * t];
        };
        var B = ix(v00, v01, j, i, j + 1, i);       /* bottom edge (south) */
        var R = ix(v01, v11, j + 1, i, j + 1, i + 1);
        var T = ix(v10, v11, j, i + 1, j + 1, i + 1);
        var Le = ix(v00, v10, j, i, j, i + 1);
        var add = function (p, q) { segs.push([p, q]); };
        switch (idx) {
          case 1: case 14: add(Le, B); break;
          case 2: case 13: add(B, R); break;
          case 3: case 12: add(Le, R); break;
          case 4: case 11: add(R, T); break;
          case 6: case 9: add(B, T); break;
          case 7: case 8: add(Le, T); break;
          case 5: case 10:
            var mid = (v00 + v01 + v10 + v11) / 4;
            if ((mid >= level) === (idx === 5)) { add(Le, T); add(B, R); }
            else { add(Le, B); add(R, T); }
            break;
        }
      }
    }
    /* chain segments by shared endpoints */
    var key = function (p) { return Math.round(p[0] * 1000) + '_' + Math.round(p[1] * 1000); };
    var byEnd = {};
    segs.forEach(function (s, n) {
      [key(s[0]), key(s[1])].forEach(function (k) {
        (byEnd[k] = byEnd[k] || []).push(n);
      });
    });
    var used = new Array(segs.length);
    var chains = [];
    for (var n = 0; n < segs.length; n++) {
      if (used[n]) continue;
      used[n] = true;
      var chain = [segs[n][0], segs[n][1]];
      var grow = function (head) {
        for (;;) {
          var p = head ? chain[0] : chain[chain.length - 1];
          var cands = byEnd[key(p)] || [];
          var found = -1;
          for (var c = 0; c < cands.length; c++) if (!used[cands[c]]) { found = cands[c]; break; }
          if (found < 0) return;
          used[found] = true;
          var s = segs[found];
          var nxt = key(s[0]) === key(p) ? s[1] : s[0];
          if (head) chain.unshift(nxt); else chain.push(nxt);
        }
      };
      grow(false); grow(true);
      if (chain.length > 3) chains.push(chain.map(function (c) { return pt(c[0], c[1]); }));
    }
    return chains;
  }

  function upFactor(g) { return g.fcst ? 6 : 3; }

  function drawIso(g, u) {
    while (gIso.firstChild) gIso.removeChild(gIso.firstChild);
    while (gIsoLbl.firstChild) gIsoLbl.removeChild(gIsoLbl.firstChild);
    if (!g) return;
    var z = zoomOf(vb);
    LEVELS.forEach(function (level) {
      var chains = marchLevel(u, g, level);
      if (!chains.length) return;
      var d = '';
      chains.forEach(function (ch) {
        ch.forEach(function (p, i) {
          var w = P(p[0], p[1]);
          d += (i ? 'L' : 'M') + w[0].toFixed(1) + ' ' + w[1].toFixed(1);
        });
      });
      var ISO_INK = { 60: '#33517a', 64: '#222222', 68: '#a03a2c', 72: '#c07b3a' };
      var attrs = {
        d: d, fill: 'none', stroke: ISO_INK[level],
        'stroke-width': level === 64 || level === 68 ? 1.7 : 1.1,
        'vector-effect': 'non-scaling-stroke',
        'class': 'ch-iso ch-iso--' + level
      };
      /* model output draws dashed — an analysis is drawn firm */
      if (g.fcst) attrs['stroke-dasharray'] = (6 * z) + ' ' + (4 * z);
      el('path', attrs, gIso);
      /* label the longest chain, at points that are really over water */
      chains.sort(function (a, b) { return b.length - a.length; });
      var main = chains[0];
      [0.28, 0.72].forEach(function (f) {
        var i = Math.max(1, Math.min(main.length - 2, Math.round(main.length * f)));
        var p = main[i];
        if (sstAtLonLat(p[0], p[1]) == null) return;
        var a = P(main[i - 1][0], main[i - 1][1]), b = P(main[i + 1][0], main[i + 1][1]);
        var ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
        if (ang > 90) ang -= 180;
        if (ang < -90) ang += 180;
        var w = P(p[0], p[1]);
        var t = el('text', {
          x: w[0], y: w[1] - 3 * z, 'class': 'ch-isolbl ch-isolbl--' + level,
          'text-anchor': 'middle',
          transform: 'rotate(' + ang.toFixed(1) + ' ' + w[0] + ' ' + w[1] + ')'
        }, gIsoLbl);
        t.textContent = level + '°';
      });
    });
  }

  /* ---------- temperature wash (offscreen, blitted under the particles) ---------- */
  var tintC = document.createElement('canvas');
  var RAMP = [
    [50, [70, 105, 140]], [58, [96, 130, 152]], [63, [150, 168, 163]],
    [66, [196, 186, 152]], [69, [210, 166, 116]], [73, [198, 122, 82]],
    [80, [172, 84, 58]]
  ];
  function rampColor(f) {
    if (f <= RAMP[0][0]) return RAMP[0][1];
    for (var i = 1; i < RAMP.length; i++) {
      if (f <= RAMP[i][0]) {
        var t = (f - RAMP[i - 1][0]) / (RAMP[i][0] - RAMP[i - 1][0]);
        var a = RAMP[i - 1][1], b = RAMP[i][1];
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      }
    }
    return RAMP[RAMP.length - 1][1];
  }
  function buildTint(g, u) {
    /* rasterize the upsampled field so the coarse forecast grid still
       washes smoothly */
    tintC.width = u.ng; tintC.height = u.nl;
    var tc = tintC.getContext('2d');
    var img = tc.createImageData(u.ng, u.nl);
    for (var i = 0; i < u.nl; i++) {
      for (var j = 0; j < u.ng; j++) {
        var f = u.v[i * u.ng + j];
        var o = ((u.nl - 1 - i) * u.ng + j) * 4; /* row 0 = north */
        if (isNaN(f)) { img.data[o + 3] = 0; continue; }
        var c = rampColor(f);
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2];
        /* the structure view lets the bottom carry the story */
        img.data[o + 3] = prog.view === 'structure' ? 56 : 96;
      }
    }
    tc.putImageData(img, 0, 0);
  }
  function tintRect() {
    /* screen rect of the grid extent (cell-centre grid, pad half an
       upsampled cell) */
    var F = upFactor(sst);
    var dlat = (sst.lats[1] - sst.lats[0]) / F, dlon = (sst.lons[1] - sst.lons[0]) / F;
    var tl = worldToScreen(P(sst.lons[0] - dlon / 2, sst.lats[sst.lats.length - 1] + dlat / 2));
    var br = worldToScreen(P(sst.lons[sst.lons.length - 1] + dlon / 2, sst.lats[0] - dlat / 2));
    return [tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]];
  }

  /* ---------- wind field: Open-Meteo sampled offshore, drawn as drifting
     particles exactly like the sailing chart ---------- */
  var wx = { samples: null, ids: [], times: null, nowI: 0, qual: 'now' };
  function windVector(spdKn, dirFrom) {
    var to = (dirFrom + 180) * Math.PI / 180;
    return [Math.sin(to) * spdKn, -Math.cos(to) * spdKn];
  }
  function fieldAt(x, y) {
    if (!wx.samples) return [0, 0];
    var su = 0, sv = 0, sw = 0;
    for (var k = 0; k < wx.ids.length; k++) {
      var s = wx.samples[wx.ids[k]];
      var dx = x - s.world[0], dy = y - s.world[1];
      var wgt = 1 / (dx * dx + dy * dy + 2500);
      su += s.u * wgt; sv += s.v * wgt; sw += wgt;
    }
    return sw ? [su / sw, sv / sw] : [0, 0];
  }
  function nowIdx(times) {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', hour12: false
    }).formatToParts(new Date()).reduce(function (o, p) { o[p.type] = p.value; return o; }, {});
    var hour = parts.hour === '24' ? '00' : parts.hour;
    var iso = parts.year + '-' + parts.month + '-' + parts.day + 'T' + hour + ':00';
    var i = times.indexOf(iso);
    return i < 0 ? 0 : i;
  }
  var roseNeedle = document.getElementById('rose-needle');
  var roseSpd = document.getElementById('rose-spd');
  var roseDir = document.getElementById('rose-dir');

  /* one fetch covers the whole scrubber: ten past days through five days
     out, hourly, so the wind layer follows whatever day the water shows */
  function loadWind() {
    var lats = D.windPts.map(function (p) { return p.lat; }).join(',');
    var lons = D.windPts.map(function (p) { return p.lon; }).join(',');
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lats + '&longitude=' + lons +
      '&timezone=America%2FLos_Angeles&past_days=10&forecast_days=6' +
      '&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn';
    fetch(url).then(function (r) { return r.json(); }).then(function (res) {
      var arr = Array.isArray(res) ? res : [res];
      wx.times = arr[0].hourly.time;
      wx.nowI = nowIdx(wx.times);
      wx.samples = {};
      wx.ids = [];
      D.windPts.forEach(function (p, k) {
        var h = (arr[k] || arr[0]).hourly;
        wx.samples[p.id] = {
          world: P(p.lon, p.lat),
          wsArr: h.wind_speed_10m, wdArr: h.wind_direction_10m,
          ws: null, wd: null, u: 0, v: 0
        };
        wx.ids.push(p.id);
      });
      setWindForGrid(sst);
      if (reduceMotion) tick(performance.now());
    }).catch(function () { /* the chart works without wind */ });
  }

  /* interpolated wind at any world point, as speed + from-direction */
  function windAtWorld(w) {
    if (!wx.samples) return null;
    var f = fieldAt(w[0], w[1]);
    var spd = Math.hypot(f[0], f[1]);
    if (spd < 0.3) return null;
    var toDeg = (Math.atan2(f[0], -f[1]) * 180 / Math.PI + 360) % 360;
    return { ws: spd, wd: (toDeg + 180) % 360 };
  }
  /* mean wind over the active target's spots — the rose and the strip */
  function groundsWind() {
    if (!wx.samples) return null;
    var su = 0, sv = 0, n = 0;
    prog.spots.forEach(function (s) {
      var f = fieldAt(pOf(s)[0], pOf(s)[1]);
      su += f[0]; sv += f[1]; n++;
    });
    if (!n) return null;
    var spd = Math.hypot(su / n, sv / n);
    if (spd < 0.3) return null;
    var toDeg = (Math.atan2(su / n, -(sv / n)) * 180 / Math.PI + 360) % 360;
    return { ws: spd, wd: (toDeg + 180) % 360 };
  }
  function applyWindIdx(i, qual) {
    wx.qual = qual;
    wx.ids.forEach(function (id) {
      var s = wx.samples[id];
      if (s.wsArr[i] == null) {
        s.ws = null; s.wd = null; s.u = 0; s.v = 0;
        return;
      }
      s.ws = s.wsArr[i];
      s.wd = s.wdArr[i];
      var vec = windVector(s.ws, s.wd);
      s.u = vec[0];
      s.v = vec[1];
    });
    var gw = groundsWind();
    if (gw && roseNeedle) {
      roseNeedle.style.transform = 'rotate(' + ((gw.wd + 180) % 360) + 'deg)';
      roseSpd.textContent = Math.round(gw.ws);
      roseDir.textContent = compass16(gw.wd);
    }
    buildWindArrows();
    paintTable();
    paintConditions();
  }

  /* which hour matches the day on the chart: current conditions when the
     chart shows the latest analysis or today, that day's midday otherwise */
  function setWindForGrid(g) {
    if (!wx.samples) return;
    var i = wx.nowI, qual = 'now';
    if (g && g.date && !(g.date === latestNoaaDate) && g.date !== laToday()) {
      var mi = wx.times.indexOf(g.date + 'T12:00');
      if (mi >= 0) {
        i = mi;
        qual = 'midday ' + fmtDay(g.date);
      }
    }
    applyWindIdx(i, qual);
  }

  /* small wind arrows at the harbor and each of the target's spots */
  function buildWindArrows() {
    while (gMarkWind.firstChild) gMarkWind.removeChild(gMarkWind.firstChild);
    if (!wx.samples) return;
    var z = zoomOf(vb);
    var pts = [{ w: harborW }];
    prog.spots.forEach(function (s) { pts.push({ w: pOf(s) }); });
    pts.forEach(function (p) {
      var wv = windAtWorld(p.w);
      if (!wv) return;
      var g = el('g', { 'class': 'ch-mwind' }, gMarkWind);
      var rot = el('g', {}, g);
      var len = Math.min(26, 9 + wv.ws * 1.1) * z;
      var toDeg = (wv.wd + 180) % 360;
      rot.setAttribute('transform',
        'translate(' + p.w[0] + ' ' + (p.w[1] + 19 * z) + ') rotate(' + (toDeg - 90) + ')');
      el('line', { x1: -len / 2, y1: 0, x2: len / 2 - 3 * z, y2: 0, 'class': 'ch-mwind-line' }, rot);
      var s2 = 3 * z;
      el('path', {
        d: 'M' + (len / 2 - s2 * 1.4) + ' ' + (-s2 * 0.8) +
           'L' + (len / 2) + ' 0L' + (len / 2 - s2 * 1.4) + ' ' + (s2 * 0.8) + 'Z',
        'class': 'ch-mwind-head'
      }, rot);
      var txt = el('text', {
        x: p.w[0], y: p.w[1] + 30 * z, 'class': 'ch-mwind-txt', 'text-anchor': 'middle'
      }, g);
      txt.textContent = Math.round(wv.ws);
    });
  }

  /* ---------- particles over the wash ---------- */
  var particles = [];
  var PCOUNT = 150;
  function seedParticle(p) {
    p.x = vb.x + Math.random() * vb.w;
    p.y = vb.y + Math.random() * vb.h;
    p.ttl = 3 + Math.random() * 5;
    p.life = reduceMotion ? 0.4 + Math.random() * p.ttl * 0.5 : 0;
  }
  for (var pi = 0; pi < PCOUNT; pi++) particles.push({ x: 0, y: 0, life: 0, ttl: 0 });

  function resizeCanvas() {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = frame.clientWidth * dpr;
    canvas.height = frame.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  var lastT = performance.now();
  function tick(now) {
    var dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    var cw = frame.clientWidth, chh = frame.clientHeight;
    ctx.clearRect(0, 0, cw, chh);
    if (sst) {
      var r = tintRect();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tintC, r[0], r[1], r[2], r[3]);
    }
    if (wx.samples) {
      if (reduceMotion) dt = 0.2;
      var z = zoomOf(vb);
      var wps = 3.2 * z;
      ctx.lineWidth = 1;
      for (var i = 0; i < particles.length; i++) {
        var q = particles[i];
        q.life += dt;
        if (q.life > q.ttl || q.x < vb.x - 60 || q.x > vb.x + vb.w + 60 ||
            q.y < vb.y - 60 || q.y > vb.y + vb.h + 60) seedParticle(q);
        var f = fieldAt(q.x, q.y);
        var spd = Math.hypot(f[0], f[1]);
        q.x += f[0] * wps * dt;
        q.y += f[1] * wps * dt;
        if (spd < 0.5) continue;
        var fade = Math.min(q.life / 0.8, (q.ttl - q.life) / 0.8, 1);
        if (fade <= 0) continue;
        var streak = Math.min(3.2, 0.9 + spd * 0.12);
        var sx = (q.x - vb.x) / vb.w * cw, sy = (q.y - vb.y) / vb.h * chh;
        var ex = sx - (f[0] / spd) * streak * 9;
        var ey = sy - (f[1] / spd) * streak * 9;
        ctx.strokeStyle = 'rgba(107, 101, 96,' + (0.30 * fade).toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
    }
    if (!reduceMotion) requestAnimationFrame(tick);
  }

  /* ---------- hover: read the water under the cursor ---------- */
  var hoverRaf = null;
  frame.addEventListener('mousemove', function (ev) {
    if (ev.target.classList && ev.target.classList.contains('ch-hit')) return;
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(function () {
      hoverRaf = null;
      var r = frame.getBoundingClientRect();
      var sx = ev.clientX - r.left, sy = ev.clientY - r.top;
      var w = screenToWorld(sx, sy);
      var lon = REF.lon + w[0] / (COSL * SCALE);
      var lat = REF.lat - w[1] / SCALE;
      var t = sstAtLonLat(lon, lat);
      var dep = depthFm(lon, lat);
      if (t == null && dep == null) { hideTip(); return; }
      var parts = [];
      if (t != null) parts.push('<strong>' + t.toFixed(1) + ' °F</strong>');
      if (dep != null) parts.push(fmtDepth(dep));
      parts.push(Math.round(distNm(w)) + ' nm ' + compass16(brgTrue(w)) + ' of the harbor');
      var html = parts.join(' · ');
      var mpa = mpaAt(lon, lat);
      if (mpa) {
        html += '<br><span class="tt-mpa">inside ' + mpa.name +
          (mpa.kind === 'smr' ? ' — no take' : ' — restricted take, check the regs') + '</span>';
      }
      tooltip.innerHTML = html;
      tooltip.style.display = 'block';
      placeTipAt([sx, sy]);
    });
  });
  frame.addEventListener('mouseleave', function () {
    if (hoverRaf) { cancelAnimationFrame(hoverRaf); hoverRaf = null; }
    hideTip();
  });

  /* ---------- zoom + pan: wheel, drag, pinch, double-click, reset ----------
     the labels and arrows are rebuilt once the gesture settles */
  var resetBtn = document.getElementById('fish-reset');
  var rebuildT = null;
  function scheduleRebuild() {
    clearTimeout(rebuildT);
    rebuildT = setTimeout(function () {
      if (sst && sstU) drawIso(sst, sstU);
      buildWindArrows();
    }, 200);
  }
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      fitView();
      scheduleRebuild();
      if (reduceMotion) tick(performance.now());
    });
  }
  frame.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var r = frame.getBoundingClientRect();
    zoomAt(Math.pow(1.0016, ev.deltaY), ev.clientX - r.left, ev.clientY - r.top);
  }, { passive: false });
  frame.addEventListener('dblclick', function (ev) {
    var r = frame.getBoundingClientRect();
    zoomAt(0.5, ev.clientX - r.left, ev.clientY - r.top);
  });
  var pointers = {}, pCount = 0, pinch = null, drag = null;
  frame.addEventListener('pointerdown', function (ev) {
    if (ev.button !== 0) return;
    /* leave the frame's buttons and controls their clicks */
    if (ev.target.closest && ev.target.closest('button')) return;
    pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    pCount++;
    /* mouse always drags; a finger drags once the chart is zoomed in */
    if (pCount === 1 && (ev.pointerType === 'mouse' ||
        (baseView && vb.w < baseView.w * 0.985))) {
      drag = { x: ev.clientX, y: ev.clientY, vb: { x: vb.x, y: vb.y, w: vb.w, h: vb.h }, moved: false };
    }
    if (pCount === 2) {
      var ids = Object.keys(pointers);
      var a = pointers[ids[0]], b = pointers[ids[1]];
      pinch = {
        d: Math.hypot(a.x - b.x, a.y - b.y),
        vb: { x: vb.x, y: vb.y, w: vb.w, h: vb.h }
      };
      drag = null;
    }
  });
  frame.addEventListener('pointermove', function (ev) {
    var p = pointers[ev.pointerId];
    if (!p) return;
    if (drag && ev.pointerType === 'mouse' && ev.buttons === 0) {
      /* released outside the frame — stale drag */
      endPointer(ev);
      return;
    }
    if (drag && ev.pointerType !== 'mouse') hideTip();
    p.x = ev.clientX;
    p.y = ev.clientY;
    if (pinch && pCount >= 2) {
      var ids = Object.keys(pointers);
      var a = pointers[ids[0]], b = pointers[ids[1]];
      var d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      var r = frame.getBoundingClientRect();
      var mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
      var w = pinch.vb.w * (pinch.d / d);
      var scale = w / vb.w;
      var wpt = screenToWorld(mx, my);
      applyView(clampView({
        x: wpt[0] - mx / frame.clientWidth * vb.w * scale,
        y: wpt[1] - my / frame.clientHeight * vb.h * scale,
        w: vb.w * scale, h: vb.h * scale
      }));
      scheduleRebuild();
    } else if (drag) {
      var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true;
      hideTip();
      applyView(clampView({
        x: drag.vb.x - dx / frame.clientWidth * drag.vb.w,
        y: drag.vb.y - dy / frame.clientHeight * drag.vb.h,
        w: drag.vb.w, h: drag.vb.h
      }));
      scheduleRebuild();
    }
    if ((pinch || (drag && drag.moved)) && reduceMotion) tick(performance.now());
  });
  function endPointer(ev) {
    if (pointers[ev.pointerId]) {
      delete pointers[ev.pointerId];
      pCount = Math.max(0, pCount - 1);
    }
    if (pCount < 2) pinch = null;
    if (pCount === 0) drag = null;
  }
  document.addEventListener('pointerup', endPointer);
  document.addEventListener('pointercancel', endPointer);
  /* let one finger scroll the page; claim the gesture only when two land */
  frame.addEventListener('touchmove', function (ev) {
    if (ev.touches.length >= 2) ev.preventDefault();
  }, { passive: false });

  /* ---------- live position, same relay as the sailing chart ----------
     the relay only reports when the tracker is on and inside its window;
     when it has nothing, the marker simply stays hidden */
  var BOAT_URL = 'https://owntracks-relay-924564512726.us-central1.run.app/latest';
  var boat = null;
  var gBoat = el('g', { 'class': 'ch-boat', style: 'display:none' }, gMarks);
  var boatTri = el('path', { d: 'M0 -7.5L5.2 6.5L0 3.6L-5.2 6.5Z', 'class': 'ch-boat-tri' }, gBoat);
  var boatHit = el('circle', { cx: 0, cy: 0, r: 13, 'class': 'ch-hit' }, gBoat);
  function placeBoat(z) {
    if (!boat) return;
    gBoat.setAttribute('transform',
      'translate(' + boat.w[0] + ' ' + boat.w[1] + ') scale(' + z + ')');
    boatTri.setAttribute('transform', boat.heading != null ? 'rotate(' + boat.heading + ')' : '');
  }
  boatHit.addEventListener('mouseenter', function () {
    if (!boat) return;
    var when = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit'
    }).format(new Date(boat.t));
    tooltip.innerHTML = '<strong>Remy</strong> live · ' + when +
      (boat.vel != null ? ' · ' + boat.vel.toFixed(1) + ' kn' : '');
    tooltip.style.display = 'block';
    placeTipAt(worldToScreen(boat.w));
  });
  boatHit.addEventListener('mouseleave', hideTip);
  function loadBoat() {
    if (document.hidden) return;
    fetch(BOAT_URL).then(function (r) {
      return r.status === 200 ? r.json() : null;
    }).then(function (j) {
      if (!j) { boat = null; gBoat.style.display = 'none'; return; }
      boat = { w: P(j.lon, j.lat), heading: j.heading, vel: j.vel, t: j.t };
      gBoat.style.display = '';
      placeBoat(zoomOf(vb));
    }).catch(function () {});
  }

  /* ---------- day scrubber: NOAA analyses back, model days forward ---------- */
  var MAXBACK = 7;
  function fmtDay(iso) {
    var p = iso.split('-');
    var wd = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][wd] + ' ' + (+p[1]) + '/' + (+p[2]);
  }
  function addDays(iso, n) {
    var p = iso.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * 86400000).toISOString().slice(0, 10);
  }
  function laToday() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
  }
  var creditDate = document.getElementById('fish-credit-date');
  var creditSrc = document.getElementById('fish-credit-src');

  /* one slider across the whole story: 8 NOAA analysis days back, then the
     ocean model bridging the analysis lag and running five days out */
  var timeline = [];
  for (var tb = MAXBACK; tb >= 0; tb--) timeline.push({ kind: 'noaa', back: tb });
  var latestNoaaDate = null;
  function extendTimeline(latestDate) {
    if (latestNoaaDate) return;
    latestNoaaDate = latestDate;
    var d = addDays(latestDate, 1), end = addDays(laToday(), 5);
    while (d <= end) {
      timeline.push({ kind: 'model', date: d });
      d = addDays(d, 1);
    }
    dayScrub.max = timeline.length - 1;
  }

  function labelFor(g) {
    if (!g || !g.date) return '—';
    if (!g.fcst) return 'analysis ' + fmtDay(g.date);
    return (g.date > laToday() ? 'forecast ' : 'model ') + fmtDay(g.date);
  }
  var sstU = null;
  function activateGrid(g) {
    sst = g;
    var u = upsample(g, upFactor(g));
    sstU = u;
    buildTint(g, u);
    drawIso(g, u);
    setWindForGrid(g);
    paintConditions();
    paintTable();
    paintWx();
    dayLabel.textContent = labelFor(g);
    if (creditSrc) {
      creditSrc.textContent = g.fcst
        ? 'SST forecast · Open-Meteo marine / MeteoFrance ocean model'
        : 'NOAA Geo-Polar blended 5 km SST';
    }
    if (creditDate) creditDate.textContent = g.date ? ' · ' + fmtDay(g.date) : '';
    if (reduceMotion) tick(performance.now());
  }
  /* be a polite guest on NOAA's server: besides the in-memory cache, keep
     each day's grid in localStorage for the rest of the day, so revisits
     and scrubbing cost them nothing */
  function utcToday() { return new Date().toISOString().slice(0, 10); }
  function lsGet(back) {
    try {
      var raw = localStorage.getItem('fishsst:' + back);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      return obj.d === utcToday() ? obj.t : null;
    } catch (e) { return null; }
  }
  function lsPut(back, tbl) {
    try {
      localStorage.setItem('fishsst:' + back, JSON.stringify({ d: utcToday(), t: tbl }));
    } catch (e) { /* private mode / quota — the fetch cache still works */ }
  }

  function loadDay(back) {
    if (sstCache[back]) { activateGrid(sstCache[back]); return; }
    var stored = lsGet(back);
    if (stored) {
      var cached = parseGrid(stored);
      sstCache[back] = cached;
      if (back === 0 && cached.date) extendTimeline(cached.date);
      activateGrid(cached);
      return;
    }
    dayLabel.textContent = 'loading…';
    jsonp(ERDDAP.replace('{B}', back ? '-' + back : ''), function (err, data) {
      if (err || !data || !data.table) {
        if (!sst) {
          condEl.innerHTML = '<span class="muted">NOAA’s SST server isn’t answering right now ' +
            '— the chart still works; the temperature layer will return when it does.</span>';
        }
        dayLabel.textContent = labelFor(sst);
        return;
      }
      var g = parseGrid(data);
      sstCache[back] = g;
      lsPut(back, data);
      if (back === 0 && g.date) extendTimeline(g.date);
      /* only show it if the scrubber still points at this day */
      var cur = timeline[dayScrub.valueAsNumber];
      if (cur && cur.kind === 'noaa' && cur.back === back) activateGrid(g);
    });
  }

  /* ---------- forward days: Open-Meteo marine SST (MeteoFrance ocean model)
     — one 6-hourly batch over a 0.25° grid, noon value per day, cached in
     localStorage for the rest of the day like the analyses ---------- */
  var MG = { lat0: 32.75, dlat: 0.25, nlat: 9, lon0: -121.35, dlon: 0.25, nlon: 13 };
  var marinePromise = null;
  function loadMarine() {
    if (marinePromise) return marinePromise;
    var stored = null;
    try {
      var raw = localStorage.getItem('fishsstf');
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj.d === utcToday()) stored = obj.g;
      }
    } catch (e) {}
    if (stored) {
      marinePromise = Promise.resolve(stored);
      return marinePromise;
    }
    var lats = [], lons = [];
    for (var a = 0; a < MG.nlat; a++) {
      for (var b = 0; b < MG.nlon; b++) {
        lats.push((MG.lat0 + a * MG.dlat).toFixed(2));
        lons.push((MG.lon0 + b * MG.dlon).toFixed(2));
      }
    }
    var url = 'https://marine-api.open-meteo.com/v1/marine?latitude=' + lats.join(',') +
      '&longitude=' + lons.join(',') +
      '&hourly=sea_surface_temperature&temperature_unit=fahrenheit' +
      '&timezone=America%2FLos_Angeles&past_days=5&forecast_days=6' +
      '&temporal_resolution=hourly_6&cell_selection=sea';
    marinePromise = fetch(url).then(function (r) { return r.json(); }).then(function (res) {
      var arr = Array.isArray(res) ? res : [res];
      var times = arr[0].hourly.time;
      var inC = /C/.test((arr[0].hourly_units || {}).sea_surface_temperature || '°F');
      var byDate = {};
      times.forEach(function (t, i) {
        if (t.slice(11) !== '12:00') return;
        byDate[t.slice(0, 10)] = arr.map(function (loc) {
          var v = loc.hourly.sea_surface_temperature[i];
          if (v == null) return null;
          if (inC) v = v * 1.8 + 32;
          return Math.round(v * 10) / 10;
        });
      });
      try {
        localStorage.setItem('fishsstf', JSON.stringify({ d: utcToday(), g: byDate }));
      } catch (e) {}
      return byDate;
    });
    marinePromise.catch(function () { marinePromise = null; }); /* allow a retry */
    return marinePromise;
  }
  function marineGrid(date, byDate) {
    var vals = byDate[date];
    if (!vals) return null;
    var lats = [], lons = [];
    for (var a = 0; a < MG.nlat; a++) lats.push(MG.lat0 + a * MG.dlat);
    for (var b = 0; b < MG.nlon; b++) lons.push(MG.lon0 + b * MG.dlon);
    var v = new Float64Array(vals.length);
    for (var k = 0; k < vals.length; k++) v[k] = vals[k] == null ? NaN : vals[k];
    return finishGrid(lats, lons, v, date, true);
  }
  function loadModelDay(date) {
    var key = 'm' + date;
    if (sstCache[key]) { activateGrid(sstCache[key]); return; }
    dayLabel.textContent = 'loading…';
    loadMarine().then(function (byDate) {
      var g = marineGrid(date, byDate);
      if (!g) throw new Error('no data for ' + date);
      sstCache[key] = g;
      var cur = timeline[dayScrub.valueAsNumber];
      if (cur && cur.kind === 'model' && cur.date === date) activateGrid(g);
    }).catch(function () {
      dayLabel.textContent = labelFor(sst);
      condEl.innerHTML = '<span class="muted">The forecast model isn’t answering right now — ' +
        'the analysis days still work; try forward again in a bit.</span>';
    });
  }

  function onScrub() {
    var t = timeline[dayScrub.valueAsNumber];
    if (!t) return;
    if (t.kind === 'noaa') loadDay(t.back);
    else loadModelDay(t.date);
  }
  dayScrub.addEventListener('input', onScrub);
  backBtn.addEventListener('click', function () {
    dayScrub.value = Math.max(0, dayScrub.valueAsNumber - 1);
    onScrub();
  });
  fwdBtn.addEventListener('click', function () {
    dayScrub.value = Math.min(+dayScrub.max, dayScrub.valueAsNumber + 1);
    onScrub();
  });

  /* ---------- conditions strip + options table ---------- */
  function paintConditions() {
    if (!sst) return;
    var parts = [];
    parts.push('<span>chart water <b>' + sst.min.toFixed(0) + '–' + sst.max.toFixed(0) +
      ' °F</b></span>');
    parts.push('<span>the zone: <b>64–68 °F</b> over structure, fish the cool side</span>');
    var gw = groundsWind();
    if (gw) {
      parts.push('<span>wind on the grounds ' + wx.qual + ' <b>' + Math.round(gw.ws) +
        ' kn</b> from ' + compass16(gw.wd) + '</span>');
    }
    condEl.innerHTML = parts.join('<span class="sail-dot">·</span>');
  }

  var tableEl = document.getElementById('fish-table');
  function paintTable() {
    if (!tableEl) return;
    var rows = '';
    prog.spots.forEach(function (m) {
      var w = pOf(m);
      var t = sstAtLonLat(m.lon, m.lat);
      var dep = depthFm(m.lon, m.lat);
      var wv = windAtWorld(w);
      rows += '<tr><td>' + m.opt + '</td><td>' + m.name +
        '</td><td>' + Math.round(distNm(w)) + ' nm</td><td>' +
        String(brgMag(w)).padStart(3, '0') + '°M</td><td>' +
        (dep == null ? '—' : dep + ' fm') + '</td><td>' +
        (t == null ? '—' : '<b>' + t.toFixed(1) + '°</b>') + '</td><td>' +
        (wv ? Math.round(wv.ws) + ' kn <span class="muted">' + compass16(wv.wd) + '</span>' : '—') +
        '</td></tr>';
    });
    tableEl.innerHTML = '<table class="sail-table"><thead><tr><th></th><th>spot</th>' +
      '<th>run</th><th>brg</th><th>depth</th><th>sst</th><th>wind</th></tr></thead><tbody>' +
      rows + '</tbody></table>';
  }

  /* ---------- offshore weather: NWS LOX coastal waters forecast ----------
     one product fetch carries the synopsis and every zone's day-by-day
     text; the panel windows it to the selected water day + 3 */
  var CWF_ZONES = [
    { id: 'PZZ650', label: 'Channel' },
    { id: 'PZZ673', label: 'Outer waters' }
  ];
  var cwf = null;
  var wxZone = 'PZZ650';
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function wdOf(iso) {
    var p = iso.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
  }
  function parseCwf(text, issuanceIso) {
    var issued = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(issuanceIso));
    var WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    var out = { synopsis: '', updated: '', zones: {} };
    text.split(/^\$\$\s*$/m).forEach(function (blk) {
      var zm = blk.match(/^(PZZ\d{3})-[\d-]+\s*$/m);
      if (!zm) return;
      var zone = zm[1];
      if (!out.updated) {
        var um = blk.match(/^\d{3,4} [AP]M [A-Z]{3,4} \w{3} \w{3} \d+ \d{4}$/m);
        if (um) out.updated = um[0];
      }
      var periods = [], headlines = [], cur = null;
      blk.split('\n').forEach(function (ln) {
        var hm = ln.match(/^\.\.\.(.+?)(\.\.\.)?\s*$/);
        if (hm) {
          /* ...SMALL CRAFT ADVISORY... style headline, not a period */
          headlines.push(hm[1]);
          cur = null;
          return;
        }
        var m = ln.match(/^\.(.+?)\.\.\.(.*)$/);
        if (m) {
          cur = { name: m[1].trim(), text: m[2] };
          periods.push(cur);
        } else if (cur) {
          cur.text += ' ' + ln.trim();
        }
      });
      periods.forEach(function (p) { p.text = p.text.replace(/\s+/g, ' ').trim(); });
      if (zone === 'PZZ600') {
        /* the synopsis header wraps over several lines before its '...' */
        var sm = blk.match(/\.Synopsis[\s\S]*?\.\.\.([\s\S]*)$/i);
        if (sm) out.synopsis = sm[1].replace(/\s+/g, ' ').trim();
        return;
      }
      /* walk the periods onto calendar days: night periods close a day,
         weekday names snap the cursor (holiday names just flow through) */
      var cursor = issued;
      periods.forEach(function (p) {
        var U = p.name.toUpperCase();
        var wd = WD.indexOf(U.split(' ')[0]);
        if (wd >= 0) {
          /* snap to that weekday, but never commit a failed search */
          var probe = cursor;
          for (var s = 0; s < 7 && wdOf(probe) !== wd; s++) probe = addDays(probe, 1);
          if (wdOf(probe) === wd) cursor = probe;
        }
        p.date = cursor;
        p.night = /NIGHT$|^TONIGHT$|^OVERNIGHT$/.test(U);
        if (p.night) cursor = addDays(cursor, 1);
      });
      out.zones[zone] = periods;
      out.zones[zone].headlines = headlines;
    });
    return out;
  }
  function paintWx() {
    if (!cwf) return;
    var wrap = document.getElementById('fish-wx');
    var daysEl = document.getElementById('fish-wx-days');
    var noteEl = document.getElementById('fish-wx-note');
    if (!wrap || !daysEl) return;
    var periods = cwf.zones[wxZone] || [];
    var base = laToday();
    var note = '';
    if (sst && sst.date) {
      if (sst.date > base) base = sst.date;
      else if (sst.date < base) note = 'the zone forecast starts today — showing ' + fmtDay(base) + ' on';
    }
    var end = addDays(base, 3);
    var order = [], byDay = {};
    periods.forEach(function (p) {
      if (!p.date || p.date < base || p.date > end) return;
      if (!byDay[p.date]) { byDay[p.date] = { day: null, night: null }; order.push(p.date); }
      if (p.night) { if (!byDay[p.date].night) byDay[p.date].night = p; }
      else if (!byDay[p.date].day) byDay[p.date].day = p;
    });
    var html = '';
    (periods.headlines || []).forEach(function (h) {
      html += '<div class="fish-wx-alert">' + esc(h) + '</div>';
    });
    order.forEach(function (d) {
      var e = byDay[d];
      html += '<div class="fish-wx-day"><b>' + fmtDay(d) + '</b> — ' +
        (e.day ? esc(e.day.text) : '') +
        (e.night ? ' <span class="fish-wx-night">' + (e.day ? 'Night: ' : '(night) ') +
          esc(e.night.text) + '</span>' : '') +
        '</div>';
    });
    if (!html) {
      html = '<div class="fish-wx-day muted">The selected day is beyond the zone forecast, ' +
        'which runs about five days out.</div>';
    }
    daysEl.innerHTML = html;
    if (noteEl) noteEl.textContent = note;
    wrap.hidden = false;
  }
  function loadWx() {
    fetch('https://api.weather.gov/products/types/CWF/locations/LOX/latest')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.productText) return;
        cwf = parseCwf(j.productText, j.issuanceTime);
        var syn = document.getElementById('fish-wx-synopsis');
        if (syn) syn.textContent = cwf.synopsis;
        var upd = document.getElementById('fish-wx-updated');
        if (upd && cwf.updated) upd.textContent = 'updated ' + cwf.updated;
        var zw = document.getElementById('fish-wx-zones');
        if (zw && !zw.firstChild) {
          CWF_ZONES.forEach(function (zn) {
            if (!cwf.zones[zn.id]) return;
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'fish-wx-zone' + (zn.id === wxZone ? ' is-active' : '');
            b.textContent = zn.label + ' · ' + zn.id;
            b.addEventListener('click', function () {
              wxZone = zn.id;
              Array.prototype.forEach.call(zw.children, function (c) {
                c.classList.toggle('is-active', c === b);
              });
              paintWx();
            });
            zw.appendChild(b);
          });
        }
        paintWx();
      }).catch(function () { /* the panel just stays hidden */ });
  }

  /* ---------- target species programs ---------- */
  var speciesSel = document.getElementById('fish-species');
  var summaryEl = document.getElementById('fish-summary');
  var notesEl = document.getElementById('fish-notes');
  function applyProgram(id) {
    prog = programs.filter(function (p) { return p.id === id; })[0] || programs[0];
    svg.setAttribute('data-view', prog.view);
    hideTip();
    drawProgram();
    if (summaryEl) summaryEl.innerHTML = prog.summary;
    if (notesEl) {
      notesEl.innerHTML = prog.spots.map(function (s) {
        return '<p><strong>' + s.opt + ' &middot; ' + s.name + '.</strong> ' + s.note + '</p>';
      }).join('');
    }
    fitView();
    if (sst) activateGrid(sst); /* re-tint for the view, repaint everything */
    else {
      buildWindArrows();
      paintTable();
      paintConditions();
    }
    if (reduceMotion) tick(performance.now());
  }
  if (speciesSel) {
    programs.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.label;
      speciesSel.appendChild(o);
    });
    speciesSel.addEventListener('change', function () {
      applyProgram(speciesSel.value);
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    resizeCanvas();
    applyProgram(programs[0].id);
    loadDay(0);
    loadWind();
    loadWx();
    loadBoat();
    setInterval(loadBoat, 60000);
    if (!reduceMotion) requestAnimationFrame(tick);
    else tick(performance.now());
  }
  var resizeT;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () {
      resizeCanvas();
      fitView();
      if (sst) activateGrid(sst);
      else buildWindArrows();
      if (reduceMotion) tick(performance.now());
    }, 150);
  });
  boot();
})();
