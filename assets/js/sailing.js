/* Sailing chart — SBYC race courses off Leadbetter Beach.
   Draws the course chart as a live line drawing: real coastline geometry,
   marks at their charted coordinates, animated course routes, and a wind
   field driven by the Open-Meteo forecast sampled at every mark. */
(function () {
  'use strict';
  var D = window.SAILING_DATA;
  var frame = document.getElementById('sail-frame');
  if (!D || !frame) return;

  var svg = document.getElementById('sail-svg');
  var canvas = document.getElementById('sail-wind');
  var ctx = canvas.getContext('2d');
  var tooltip = document.getElementById('sail-tooltip');
  var NS = 'http://www.w3.org/2000/svg';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- projection: lon/lat -> world px (north up, y down) ---------- */
  var COSL = Math.cos(34.4 * Math.PI / 180);
  var SCALE = 22000;
  var REF = { lon: -119.76, lat: 34.46 };
  function P(lon, lat) {
    return [(lon - REF.lon) * COSL * SCALE, (REF.lat - lat) * SCALE];
  }
  function pOf(m) { return P(m.lon, m.lat); }
  var NM_PER_WORLD = 1 / (SCALE / 60);

  var MARKS = D.marks;
  var startMid = {
    lon: (MARKS.G.lon + MARKS.F.lon) / 2,
    lat: (MARKS.G.lat + MARKS.F.lat) / 2
  };
  var gateMid = {
    lon: (MARKS.F.lon + MARKS.X.lon) / 2,
    lat: (MARKS.F.lat + MARKS.X.lat) / 2
  };

  /* ---------- svg scaffolding ---------- */
  function el(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  var gLand = el('g', { 'class': 'ch-land' }, svg);
  var gWater = el('g', { 'class': 'ch-water' }, svg);
  var gStruct = el('g', { 'class': 'ch-struct' }, svg);
  var gGeoLabels = el('g', { 'class': 'ch-geolabels' }, svg);
  var gRoute = el('g', { 'class': 'ch-route' }, svg);
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

  /* land: close the coastline chain over the top of the world */
  var coast = D.geo.coast[0];
  var first = P(coast[0][0], coast[0][1]);
  var last = P(coast[coast.length - 1][0], coast[coast.length - 1][1]);
  var landD = pathFrom([coast]) +
    'L' + (last[0] + 800) + ' ' + last[1] +
    'L' + (last[0] + 800) + ' -900' +
    'L' + (first[0] - 800) + ' -900' +
    'L' + (first[0] - 800) + ' ' + first[1] + 'Z';
  el('path', { d: landD, 'class': 'ch-landfill' }, gLand);
  var coastPath = el('path', { d: pathFrom([coast]), 'class': 'ch-coast' }, gLand);

  D.geo.islets.forEach(function (i) {
    el('path', { d: pathFrom([i], true), 'class': 'ch-islet' }, gLand);
  });
  el('path', { d: pathFrom(D.geo.wharf, true), 'class': 'ch-wharf' }, gStruct);
  el('path', { d: pathFrom(D.geo.breakwater), 'class': 'ch-breakwater' }, gStruct);

  /* start / finish line G-F */
  var gPt = pOf(MARKS.G), fPt = pOf(MARKS.F), xPt = pOf(MARKS.X);
  el('line', {
    x1: gPt[0], y1: gPt[1], x2: fPt[0], y2: fPt[1], 'class': 'ch-startline'
  }, gWater);
  var startLbl = el('text', {
    x: (gPt[0] + fPt[0]) / 2 - 14, y: (gPt[1] + fPt[1]) / 2 + 4,
    'class': 'ch-startlbl', 'text-anchor': 'end'
  }, gWater);
  startLbl.textContent = 'start · finish';
  var gateLine = el('line', {
    x1: fPt[0], y1: fPt[1], x2: xPt[0], y2: xPt[1],
    'class': 'ch-gateline', style: 'display:none'
  }, gWater);

  /* decorative soundings (fathoms, from the NOAA base chart) */
  var SOUNDINGS = [
    ['G', 0.0022, -0.0013, '5', '4'], ['F', 0.0019, -0.0009, '6', '5'],
    ['B', -0.0042, 0.0009, '7', '2'], ['B', 0.0010, -0.0019, '8', '4'],
    ['C', 0.0016, -0.0011, '8', '4'], ['M', -0.0021, 0.0011, '10', '2'],
    ['M', 0.0006, -0.0031, '11', ''], ['H', -0.0032, 0.0013, '10', '5'],
    ['H', 0.0021, -0.0042, '12', ''], ['D', 0.0011, -0.0013, '6', '3'],
    ['K', 0.0009, -0.0013, '6', '5'], ['A', 0.0026, -0.0006, '9', '']
  ];
  SOUNDINGS.forEach(function (s) {
    var m = MARKS[s[0]];
    var w = P(m.lon + s[1], m.lat + s[2]);
    var t = el('text', { x: w[0], y: w[1], 'class': 'ch-sound' }, gWater);
    t.appendChild(document.createTextNode(s[3]));
    if (s[4]) {
      var sub = el('tspan', { dy: 3, 'class': 'ch-sound-sub' }, t);
      sub.textContent = s[4];
    }
  });
  var wreck = el('text', {
    x: P(MARKS.A.lon - 0.0012, 0)[0], y: P(0, MARKS.A.lat - 0.0013)[1],
    'class': 'ch-note'
  }, gWater);
  wreck.textContent = 'subm. structure';
  var kelp = el('text', {
    x: P(-119.708, 0)[0], y: P(0, 34.3939)[1], 'class': 'ch-note'
  }, gWater);
  kelp.textContent = 'kelp';

  /* geographic labels (scale with the chart, like printed text) */
  function geoLabel(text, lon, lat, cls, rotate) {
    var w = P(lon, lat);
    var t = el('text', {
      x: w[0], y: w[1], 'class': cls,
      transform: rotate ? 'rotate(' + rotate + ' ' + w[0] + ' ' + w[1] + ')' : ''
    }, gGeoLabels);
    t.textContent = text;
    return t;
  }
  geoLabel('S A N T A   B A R B A R A', -119.703, 34.4275, 'ch-city');
  geoLabel('Leadbetter Beach', -119.7085, 34.4001, 'ch-place', -7);
  geoLabel('Stearns Wharf', -119.6851, 34.4099, 'ch-place', 47);
  geoLabel('Harbor', -119.6893, 34.4058, 'ch-place-sm', 0);

  /* ---------- marks ---------- */
  var INSHORE = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'K', 'M', 'X'];
  var markEls = {};
  Object.keys(MARKS).forEach(function (id) {
    var m = MARKS[id];
    var w = pOf(m);
    var g = el('g', { 'class': 'ch-mark' + (m.wp ? ' ch-mark--wp' : ''), 'data-id': id }, gMarks);
    if (/^Pltf/.test(id)) {
      el('rect', { x: w[0] - 5, y: w[1] - 5, width: 10, height: 10, 'class': 'ch-platform' }, g);
      el('line', { x1: w[0], y1: w[1] - 5, x2: w[0], y2: w[1] - 12, 'class': 'ch-platform-mast' }, g);
    } else {
      el('circle', { cx: w[0], cy: w[1], r: 4.6, 'class': 'ch-buoy' }, g);
      el('circle', { cx: w[0], cy: w[1], r: 1.4, 'class': 'ch-buoy-dot' }, g);
    }
    var lbl = el('text', {
      x: w[0] + 8, y: w[1] + (id === 'G' ? -7 : 4), 'class': 'ch-marklbl'
    }, g);
    lbl.textContent = m.name;
    var hit = el('circle', { cx: w[0], cy: w[1], r: 14, 'class': 'ch-hit' }, g);
    hit.addEventListener('mouseenter', function () { showTip(m, w); });
    hit.addEventListener('mouseleave', hideTip);
    hit.addEventListener('click', function (ev) { showTip(m, w); ev.stopPropagation(); });
    markEls[id] = g;
  });
  svg.addEventListener('click', hideTip);

  function fmtCoord(m) {
    function dmf(v, isLat) {
      var a = Math.abs(v), d = Math.floor(a), mn = (a - d) * 60;
      return (isLat ? (v >= 0 ? 'N ' : 'S ') : (v >= 0 ? 'E ' : 'W ')) +
        d + '° ' + mn.toFixed(3) + '′';
    }
    return dmf(m.lat, true) + ' · ' + dmf(m.lon, false);
  }
  function showTip(m, w) {
    var s = worldToScreen(w);
    tooltip.innerHTML = '<strong>' + m.name + '</strong> ' + fmtCoord(m);
    tooltip.style.display = 'block';
    var tw = tooltip.offsetWidth;
    tooltip.style.left = Math.max(6, Math.min(frame.clientWidth - tw - 6, s[0] - tw / 2)) + 'px';
    tooltip.style.top = Math.max(6, s[1] - 40) + 'px';
  }
  function hideTip() { tooltip.style.display = 'none'; }

  /* ---------- viewBox management ---------- */
  var vb = { x: 0, y: 0, w: 100, h: 100 };
  var viewAnim = null;

  function inshoreBBox() {
    var pts = INSHORE.map(function (id) { return pOf(MARKS[id]); });
    D.geo.breakwater.forEach(function (l) { l.forEach(function (p) { pts.push(P(p[0], p[1])); }); });
    D.geo.wharf.forEach(function (l) { l.forEach(function (p) { pts.push(P(p[0], p[1])); }); });
    return bboxOf(pts);
  }
  function bboxOf(pts) {
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function fitBBox(bb) {
    var cw = frame.clientWidth || 800, chh = frame.clientHeight || 520;
    var aspect = cw / chh;
    var padX = bb.w * 0.10 + 40, padT = bb.h * 0.16 + 30, padB = bb.h * 0.12 + 30;
    var w = bb.w + padX * 2, h = bb.h + padT + padB;
    var cx = bb.x + bb.w / 2, cy = bb.y - padT / 2 + padB / 2 + bb.h / 2;
    if (w / h < aspect) w = h * aspect; else h = w / aspect;
    return { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
  }
  function zoomOf(v) { return v.w / (frame.clientWidth || 800); }

  function applyView(v) {
    vb = v;
    svg.setAttribute('viewBox', v.x + ' ' + v.y + ' ' + v.w + ' ' + v.h);
    var z = zoomOf(v);
    gMarks.style.fontSize = (11.5 * z) + 'px';
    gWater.style.fontSize = (10 * z) + 'px';
    gMarkWind.style.fontSize = (8.5 * z) + 'px';
    Array.prototype.forEach.call(gMarks.querySelectorAll('.ch-buoy'), function (c) {
      c.setAttribute('r', 4.6 * z);
    });
    Array.prototype.forEach.call(gMarks.querySelectorAll('.ch-buoy-dot'), function (c) {
      c.setAttribute('r', 1.4 * z);
    });
    Array.prototype.forEach.call(gMarks.querySelectorAll('.ch-hit'), function (c) {
      c.setAttribute('r', 14 * z);
    });
    var sd = (7 * z) + ' ' + (5 * z);
    Array.prototype.forEach.call(gWater.querySelectorAll('.ch-startline,.ch-gateline'), function (l) {
      l.style.strokeDasharray = sd;
    });
  }
  function worldToScreen(w) {
    var cw = frame.clientWidth, chh = frame.clientHeight;
    return [(w[0] - vb.x) / vb.w * cw, (w[1] - vb.y) / vb.h * chh];
  }
  function animateView(target, ms) {
    if (viewAnim) cancelAnimationFrame(viewAnim.raf);
    if (reduceMotion || !ms) { applyView(target); return; }
    var from = { x: vb.x, y: vb.y, w: vb.w, h: vb.h };
    var t0 = performance.now();
    var anim = {};
    viewAnim = anim;
    function step(now) {
      var t = Math.min(1, (now - t0) / ms);
      var e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      applyView({
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        w: from.w + (target.w - from.w) * e,
        h: from.h + (target.h - from.h) * e
      });
      if (t < 1) anim.raf = requestAnimationFrame(step);
      else viewAnim = null;
    }
    anim.raf = requestAnimationFrame(step);
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

  /* ---------- course routing ---------- */
  function resolveToken(tok) {
    if (tok === 'St') return { pt: pOf(startMid), label: 'Start', kind: 'line', key: 'ST' };
    if (tok === 'Fin') return { pt: pOf(startMid), label: 'Finish', kind: 'line', key: 'ST' };
    if (tok === 'Gt') return { pt: pOf(gateMid), label: 'Gate', kind: 'gate', key: 'GT' };
    var m = tok.match(/^([A-Za-z]+?)([ps])$/);
    var mk = m && MARKS[m[1]];
    if (!mk) return null;
    return { pt: pOf(mk), label: mk.name, kind: 'mark', id: m[1], dir: m[2], key: m[1] };
  }

  function bearingTrue(a, b) {
    var brg = Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180 / Math.PI;
    return (brg + 360) % 360;
  }
  function norm(v) {
    var l = Math.hypot(v[0], v[1]) || 1;
    return [v[0] / l, v[1] / l];
  }
  function angDiff(a, b) {
    return Math.abs(((a - b + 540) % 360) - 180);
  }

  /* waypoints with rounding-side offsets */
  function routeWaypoints(course) {
    var wps = course.seq.split('-').map(resolveToken).filter(Boolean);
    return wps;
  }
  function offsetVertices(wps, z) {
    var rad = 10 * z;
    return wps.map(function (w, i) {
      if (w.kind !== 'mark' || i === 0 || i === wps.length - 1) return w.pt.slice();
      var a = wps[i - 1].pt, b = wps[i + 1].pt, c = w.pt;
      var u = norm([c[0] - a[0], c[1] - a[1]]);
      var v = norm([b[0] - c[0], b[1] - c[1]]);
      var wdir = norm([u[0] + v[0], u[1] + v[1]]);
      var right = [-wdir[1], wdir[0]];
      var side = w.dir === 'p' ? 1 : -1; /* mark to port => fleet passes on its right */
      return [c[0] + right[0] * rad * side, c[1] + right[1] * rad * side];
    });
  }

  /* legs with lap lanes: repeated segments spread into parallel lanes */
  function routeLegs(wps, verts, z) {
    var laneGap = 7.5 * z;
    var counts = {}, seen = {};
    for (var i = 1; i < wps.length; i++) {
      var key = [wps[i - 1].key, wps[i].key].sort().join('|');
      counts[key] = (counts[key] || 0) + 1;
    }
    var legs = [];
    for (var j = 1; j < wps.length; j++) {
      var k2 = [wps[j - 1].key, wps[j].key].sort().join('|');
      var idx = (seen[k2] = (seen[k2] || 0) + 1) - 1;
      var m = counts[k2];
      var a = verts[j - 1].slice(), b = verts[j].slice();
      var off = [0, 0];
      if (m > 1) {
        /* fixed perpendicular of the canonical direction so lanes are parallel */
        var canon = wps[j - 1].key < wps[j].key ? norm([b[0] - a[0], b[1] - a[1]])
                                               : norm([a[0] - b[0], a[1] - b[1]]);
        var perp = [-canon[1], canon[0]];
        var lane = (idx - (m - 1) / 2) * laneGap;
        off = [perp[0] * lane, perp[1] * lane];
      }
      legs.push({
        a: [a[0] + off[0], a[1] + off[1]],
        b: [b[0] + off[0], b[1] + off[1]],
        vA: verts[j - 1], vB: verts[j]
      });
    }
    return legs;
  }

  /* rounded path: legs trimmed at the corners, joined with quadratics
     through the (rounding-offset) mark vertex */
  function routePath(legs, z) {
    var r = 16 * z;
    var d = '';
    for (var i = 0; i < legs.length; i++) {
      var g = legs[i];
      var dir = norm([g.b[0] - g.a[0], g.b[1] - g.a[1]]);
      var len = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]);
      var tA = i === 0 ? 0 : Math.min(r, len * 0.35);
      var tB = i === legs.length - 1 ? 0 : Math.min(r, len * 0.35);
      var pA = [g.a[0] + dir[0] * tA, g.a[1] + dir[1] * tA];
      var pB = [g.b[0] - dir[0] * tB, g.b[1] - dir[1] * tB];
      if (i === 0) d += 'M' + pA[0].toFixed(1) + ' ' + pA[1].toFixed(1);
      else {
        /* corner control point: the mark vertex, nudged midway between lanes */
        var prev = legs[i - 1];
        var c = [(prev.vB[0] + g.vA[0]) / 2 + (prev.b[0] - prev.vB[0] + g.a[0] - g.vA[0]) / 2,
                 (prev.vB[1] + g.vA[1]) / 2 + (prev.b[1] - prev.vB[1] + g.a[1] - g.vA[1]) / 2];
        d += 'Q' + c[0].toFixed(1) + ' ' + c[1].toFixed(1) + ' ' +
             pA[0].toFixed(1) + ' ' + pA[1].toFixed(1);
      }
      d += 'L' + pB[0].toFixed(1) + ' ' + pB[1].toFixed(1);
      g.mid = [(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2];
      g.ang = Math.atan2(dir[1], dir[0]) * 180 / Math.PI;
      g.len = len;
    }
    return d;
  }

  var routeState = { flow: null, raf: null, offset: 0, dash: 20 };

  function clearRoute() {
    if (routeState.raf) cancelAnimationFrame(routeState.raf);
    routeState.raf = null;
    routeState.flow = null;
    while (gRoute.firstChild) gRoute.removeChild(gRoute.firstChild);
    while (gMarkWind.firstChild) gMarkWind.removeChild(gMarkWind.firstChild);
    markWindEls = {};
    gateLine.style.display = 'none';
    Object.keys(markEls).forEach(function (id) {
      markEls[id].classList.remove('ch-mark--active');
    });
  }

  function drawCourse(course) {
    clearRoute();
    if (!course) {
      animateView(fitBBox(inshoreBBox()), 700);
      buildMarkWindArrows(INSHORE, zoomOf(fitBBox(inshoreBBox())));
      updateMarkWinds();
      return;
    }

    var wps = routeWaypoints(course);
    var fitPts = wps.map(function (w) { return w.pt; }).concat([pOf(MARKS.G), pOf(MARKS.F)]);
    var target = fitBBox(bboxOf(fitPts));
    var z = zoomOf(target);
    var verts = offsetVertices(wps, z);
    var legs = routeLegs(wps, verts, z);
    var d = routePath(legs, z);

    if (course.seq.indexOf('Gt') >= 0) gateLine.style.display = '';

    var guide = el('path', { d: d, 'class': 'ch-guide' }, gRoute);
    var flow = el('path', { d: d, 'class': 'ch-flow' }, gRoute);

    /* leg direction arrows at midpoints */
    legs.forEach(function (g) {
      if (g.len < 30 * z) return;
      var s = 5 * z;
      el('path', {
        d: 'M' + (-s) + ' ' + (-s * 0.75) + 'L' + (s * 1.1) + ' 0L' + (-s) + ' ' + (s * 0.75) + 'Z',
        'class': 'ch-legarrow',
        transform: 'translate(' + g.mid[0] + ' ' + g.mid[1] + ') rotate(' + g.ang + ')'
      }, gRoute);
    });

    /* rounding arrows: CCW for port, CW for starboard */
    var courseMarks = [];
    wps.forEach(function (w) {
      if (w.kind !== 'mark') return;
      if (courseMarks.indexOf(w.id) < 0) courseMarks.push(w.id);
      if (markEls[w.id]) markEls[w.id].classList.add('ch-mark--active');
      var rr = 13 * z, c = pOf(MARKS[w.id]);
      var ccw = w.dir === 'p';
      var sweep = ccw ? 0 : 1;
      var a0 = ccw ? 40 : 140, a1 = ccw ? -160 : 340;
      var p0 = arcPt(c, rr, a0), p1 = arcPt(c, rr, a1);
      el('path', {
        d: 'M' + p0[0] + ' ' + p0[1] + 'A' + rr + ' ' + rr + ' 0 1 ' + sweep + ' ' + p1[0] + ' ' + p1[1],
        'class': 'ch-round'
      }, gRoute);
      var tangent = a1 + (ccw ? -90 : 90);
      var s2 = 3.6 * z;
      el('path', {
        d: 'M' + (-s2) + ' ' + (-s2 * 0.8) + 'L' + (s2 * 1.1) + ' 0L' + (-s2) + ' ' + (s2 * 0.8) + 'Z',
        'class': 'ch-round-arrow',
        transform: 'translate(' + p1[0] + ' ' + p1[1] + ') rotate(' + tangent + ')'
      }, gRoute);
    });

    buildMarkWindArrows(courseMarks, z);
    updateMarkWinds();
    animateView(target, 700);

    routeState.dash = 13 * z;
    routeState.flow = flow;
    var Lr = flow.getTotalLength();
    if (!reduceMotion) {
      guide.style.strokeDasharray = Lr + ' ' + Lr;
      guide.style.strokeDashoffset = Lr;
      guide.getBoundingClientRect();
      guide.style.transition = 'stroke-dashoffset 1.1s ease-in-out .25s';
      guide.style.strokeDashoffset = '0';
      flow.style.opacity = '0';
      flow.getBoundingClientRect();
      flow.style.transition = 'opacity .5s ease 1.15s';
      flow.style.opacity = '1';
      startFlow(z);
    } else {
      flow.style.strokeDasharray = routeState.dash + ' ' + routeState.dash * 0.9;
    }
  }
  function arcPt(c, r, deg) {
    var a = deg * Math.PI / 180;
    return [(c[0] + r * Math.cos(a)).toFixed(1), (c[1] + r * Math.sin(a)).toFixed(1)];
  }
  function startFlow(z) {
    var last = performance.now();
    function tick(now) {
      var dt = (now - last) / 1000; last = now;
      routeState.offset -= dt * 26 * z;
      if (routeState.flow) {
        routeState.flow.style.strokeDasharray = routeState.dash + ' ' + routeState.dash * 0.9;
        routeState.flow.style.strokeDashoffset = routeState.offset;
      }
      routeState.raf = requestAnimationFrame(tick);
    }
    routeState.raf = requestAnimationFrame(tick);
  }

  /* ---------- per-mark wind arrows ---------- */
  var markWindEls = {};
  function buildMarkWindArrows(ids, z) {
    while (gMarkWind.firstChild) gMarkWind.removeChild(gMarkWind.firstChild);
    markWindEls = {};
    ids.forEach(function (id) {
      var w = pOf(MARKS[id]);
      var g = el('g', { 'class': 'ch-mwind', style: 'display:none' }, gMarkWind);
      var rot = el('g', {}, g);
      var line = el('line', { x1: 0, y1: 0, x2: 1, y2: 0, 'class': 'ch-mwind-line' }, rot);
      var head = el('path', { d: '', 'class': 'ch-mwind-head' }, rot);
      var txt = el('text', { x: w[0], y: w[1] + 30 * z, 'class': 'ch-mwind-txt', 'text-anchor': 'middle' }, g);
      markWindEls[id] = { g: g, rot: rot, line: line, head: head, txt: txt, w: w, z: z };
    });
  }
  function updateMarkWinds() {
    var i = scrub.valueAsNumber;
    Object.keys(markWindEls).forEach(function (id) {
      var e = markWindEls[id];
      var s = wx.samples && wx.samples[id];
      if (!s || s.ws[i] == null) { e.g.style.display = 'none'; return; }
      e.g.style.display = '';
      var ws = s.ws[i], wd = s.wd[i];
      var z = e.z;
      var len = Math.min(26, 9 + ws * 1.1) * z;
      var toDeg = (wd + 180) % 360; /* arrow points downwind */
      var screenAng = toDeg - 90;   /* compass 0=N(up) -> screen rotate */
      e.rot.setAttribute('transform',
        'translate(' + e.w[0] + ' ' + (e.w[1] + 19 * z) + ') rotate(' + screenAng + ')');
      e.line.setAttribute('x1', -len / 2); e.line.setAttribute('x2', len / 2 - 3 * z);
      var s2 = 3 * z;
      e.head.setAttribute('d', 'M' + (len / 2 - s2 * 1.4) + ' ' + (-s2 * 0.8) +
        'L' + (len / 2) + ' 0L' + (len / 2 - s2 * 1.4) + ' ' + (s2 * 0.8) + 'Z');
      e.txt.textContent = Math.round(ws);
      e.txt.setAttribute('y', e.w[1] + 30 * z);
    });
  }

  /* ---------- course selector + legs panel ---------- */
  var select = document.getElementById('sail-course');
  D.courses.forEach(function (grp) {
    var og = document.createElement('optgroup');
    og.label = grp.group;
    grp.items.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.id + ' · ' + c.seq + ' · ' + c.nm + ' nm';
      og.appendChild(o);
    });
    select.appendChild(og);
  });
  function findCourse(id) {
    for (var i = 0; i < D.courses.length; i++) {
      var hit = D.courses[i].items.filter(function (c) { return c.id === id; })[0];
      if (hit) return hit;
    }
    return null;
  }

  var legsEl = document.getElementById('sail-legs');
  var summaryEl = document.getElementById('sail-summary');
  var currentLegs = [];

  /* display legs: nearly-collinear pass-through marks (e.g. B–Xp–K) merge
     into one leg with the direct bearing */
  function displayLegs(course) {
    var wps = routeWaypoints(course);
    var out = [];
    var i = 0;
    while (i < wps.length - 1) {
      var a = wps[i];
      var j = i + 1;
      var via = [];
      var dist = Math.hypot(wps[j].pt[0] - a.pt[0], wps[j].pt[1] - a.pt[1]);
      while (j < wps.length - 1 && wps[j].kind === 'mark') {
        var b1 = bearingTrue(wps[j - 1].pt, wps[j].pt);
        var b2 = bearingTrue(wps[j].pt, wps[j + 1].pt);
        if (angDiff(b1, b2) >= 28) break;
        via.push(wps[j]);
        dist += Math.hypot(wps[j + 1].pt[0] - wps[j].pt[0], wps[j + 1].pt[1] - wps[j].pt[1]);
        j++;
      }
      var b = wps[j];
      out.push({
        from: a, to: b, via: via,
        nm: dist * NM_PER_WORLD,
        bt: bearingTrue(a.pt, b.pt),
        mid: [(a.pt[0] + b.pt[0]) / 2, (a.pt[1] + b.pt[1]) / 2]
      });
      i = j;
    }
    return out;
  }

  function updateLegs(course) {
    currentLegs = [];
    if (!course) {
      summaryEl.innerHTML = 'Pick a course above to lay it on the chart. ' +
        'Start and finish are the middle of the G–F line; the gate is the middle of F–X.';
      legsEl.innerHTML = '';
      return;
    }
    currentLegs = displayLegs(course);
    var rows = '', total = 0;
    currentLegs.forEach(function (leg, n) {
      var bm = Math.round((leg.bt - D.meta.variationE + 360) % 360);
      total += leg.nm;
      var name = leg.from.label + ' → ' + leg.to.label;
      if (leg.via.length) {
        name += ' <span class="muted">· past ' + leg.via.map(function (v) {
          return v.label + ' (' + v.dir + ')';
        }).join(', ') + '</span>';
      }
      rows += '<tr><td>' + (n + 1) + '</td><td>' + name +
        '</td><td>' + leg.nm.toFixed(2) + '</td><td>' + String(bm).padStart(3, '0') +
        '°M</td><td class="sail-windcell" data-leg="' + n + '">—</td></tr>';
    });
    summaryEl.innerHTML = '<strong>' + course.id + '</strong> · ' +
      course.seq.split('-').join(' – ') + ' · <strong>' + course.nm +
      ' nm</strong> published <span class="muted">(' + total.toFixed(2) + ' computed)</span>';
    legsEl.innerHTML = '<table class="sail-table"><thead><tr><th>leg</th><th></th>' +
      '<th>nm</th><th>brg</th><th>wind</th></tr></thead><tbody>' +
      rows + '</tbody></table>';
    paintLegWinds();
  }
  function paintLegWinds() {
    if (!wx.samples) return;
    var i = scrub.valueAsNumber;
    currentLegs.forEach(function (leg, n) {
      var windCell = legsEl.querySelector('.sail-windcell[data-leg="' + n + '"]');
      if (!windCell) return;
      var wv = windAtHour(i, leg.mid);
      if (!wv) { windCell.textContent = '—'; return; }
      windCell.innerHTML = Math.round(wv.ws) + ' kn <span class="muted">' + compass16(wv.wd) + '</span>';
    });
  }

  select.addEventListener('change', function () {
    var c = findCourse(select.value);
    drawCourse(c);
    updateLegs(c);
  });

  /* ---------- wind field: forecast sampled at every mark, IDW between ---------- */
  var wx = { hours: [], samples: null, sampleIds: [] };

  function windVector(spdKn, dirFrom) {
    var to = (dirFrom + 180) * Math.PI / 180;
    return [Math.sin(to) * spdKn, -Math.cos(to) * spdKn];
  }
  function vecToWind(u, v) {
    var spd = Math.hypot(u, v);
    var toDeg = (Math.atan2(u, -v) * 180 / Math.PI + 360) % 360;
    return { ws: spd, wd: (toDeg + 180) % 360 };
  }
  /* inverse-distance-weighted wind vector at a world point, for hour i */
  function windAtHour(i, world) {
    if (!wx.samples) return null;
    var su = 0, sv = 0, sw = 0;
    for (var k = 0; k < wx.sampleIds.length; k++) {
      var s = wx.samples[wx.sampleIds[k]];
      if (s.ws[i] == null) continue;
      var dx = world[0] - s.world[0], dy = world[1] - s.world[1];
      var wgt = 1 / (dx * dx + dy * dy + 900);
      var vec = windVector(s.ws[i], s.wd[i]);
      su += vec[0] * wgt; sv += vec[1] * wgt; sw += wgt;
    }
    if (!sw) return null;
    return vecToWind(su / sw, sv / sw);
  }
  /* field for particles: current (smoothed) per-sample vectors */
  function fieldAt(x, y) {
    var su = 0, sv = 0, sw = 0;
    for (var k = 0; k < wx.sampleIds.length; k++) {
      var s = wx.samples[wx.sampleIds[k]];
      var dx = x - s.world[0], dy = y - s.world[1];
      var wgt = 1 / (dx * dx + dy * dy + 900);
      su += s.cu * wgt; sv += s.cv * wgt; sw += wgt;
    }
    return sw ? [su / sw, sv / sw] : [0, 0];
  }

  var particles = [];
  var PCOUNT = 130;
  function seedParticle(p) {
    p.x = vb.x + Math.random() * vb.w;
    p.y = vb.y + Math.random() * vb.h;
    p.life = 0;
    p.ttl = 3 + Math.random() * 5;
  }
  for (var pi = 0; pi < PCOUNT; pi++) particles.push({ x: 0, y: 0, life: 0, ttl: 0 });

  function resizeCanvas() {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = frame.clientWidth * dpr;
    canvas.height = frame.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  var lastT = performance.now();
  function windTick(now) {
    var dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    var cw = frame.clientWidth, chh = frame.clientHeight;
    ctx.clearRect(0, 0, cw, chh);
    if (wx.samples) {
      var k = reduceMotion ? 1 : 1 - Math.exp(-dt / 1.0);
      for (var si = 0; si < wx.sampleIds.length; si++) {
        var s = wx.samples[wx.sampleIds[si]];
        s.cu += (s.tu - s.cu) * k;
        s.cv += (s.tv - s.cv) * k;
      }
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
    if (!reduceMotion) requestAnimationFrame(windTick);
  }

  /* ---------- wind rose ---------- */
  var roseNeedle = document.getElementById('rose-needle');
  var roseSpd = document.getElementById('rose-spd');
  var roseDir = document.getElementById('rose-dir');
  function compass16(deg) {
    var pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return pts[Math.round(deg / 22.5) % 16];
  }

  /* ---------- forecast ---------- */
  var scrub = document.getElementById('sail-time');
  var scrubLabel = document.getElementById('sail-time-label');
  var condEl = document.getElementById('sail-conditions');

  function fmtHour(iso) {
    var dpart = iso.split('T')[0].split('-'), tpart = iso.split('T')[1];
    var wd = new Date(Date.UTC(+dpart[0], +dpart[1] - 1, +dpart[2])).getUTCDay();
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var hh = +tpart.slice(0, 2);
    var h12 = hh % 12 === 0 ? 12 : hh % 12;
    return days[wd] + ' ' + (+dpart[1]) + '/' + (+dpart[2]) + ' · ' + h12 + (hh < 12 ? ' AM' : ' PM');
  }

  /* Santa Barbara "now" as {iso, y, m, d, dow, hour} */
  function sbNow() {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', hour12: false
    }).formatToParts(new Date()).reduce(function (o, p) { o[p.type] = p.value; return o; }, {});
    var hour = parts.hour === '24' ? 0 : +parts.hour;
    var dow = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day)).getUTCDay();
    return {
      iso: parts.year + '-' + parts.month + '-' + parts.day + 'T' + String(hour).padStart(2, '0') + ':00',
      y: +parts.year, m: +parts.month, d: +parts.day, dow: dow, hour: hour
    };
  }
  /* next Wednesday 17:00 Pacific — beer can race time */
  function nextWedIso(now) {
    var delta = (3 - now.dow + 7) % 7;
    if (delta === 0 && now.hour >= 17) delta = 7;
    var t = new Date(Date.UTC(now.y, now.m - 1, now.d + delta));
    return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(t.getUTCDate()).padStart(2, '0') + 'T17:00';
  }

  function loadForecast() {
    /* one multi-point call: forecast at every mark */
    wx.sampleIds = Object.keys(MARKS);
    var lats = wx.sampleIds.map(function (id) { return MARKS[id].lat; }).join(',');
    var lons = wx.sampleIds.map(function (id) { return MARKS[id].lon; }).join(',');
    var fUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + lats + '&longitude=' + lons +
      '&timezone=America%2FLos_Angeles&forecast_days=8' +
      '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m' +
      '&wind_speed_unit=kn&temperature_unit=fahrenheit';
    var mUrl = 'https://marine-api.open-meteo.com/v1/marine?latitude=34.392&longitude=-119.687' +
      '&timezone=America%2FLos_Angeles&forecast_days=8' +
      '&hourly=wave_height,wave_period,wave_direction,sea_surface_temperature' +
      '&length_unit=imperial&temperature_unit=fahrenheit&cell_selection=sea';
    return Promise.all([
      fetch(fUrl).then(function (r) { return r.json(); }),
      fetch(mUrl).then(function (r) { return r.json(); }).catch(function () { return null; })
    ]).then(function (res) {
      var fArr = Array.isArray(res[0]) ? res[0] : [res[0]];
      var m = res[1];
      var mh = m && m.hourly;
      var mFt = !m || /ft/.test((m.hourly_units || {}).wave_height || 'ft');
      var mF = !m || /F/.test((m.hourly_units || {}).sea_surface_temperature || 'F');

      var times = fArr[0].hourly.time;
      wx.samples = {};
      wx.sampleIds.forEach(function (id, k) {
        var h = (fArr[k] || fArr[0]).hourly;
        wx.samples[id] = {
          world: pOf(MARKS[id]),
          ws: h.wind_speed_10m, wd: h.wind_direction_10m, wg: h.wind_gusts_10m,
          at: h.temperature_2m,
          cu: 0, cv: 0, tu: 0, tv: 0
        };
      });

      var startW = pOf(startMid);
      wx.hours = times.map(function (t, i) {
        var mi = mh ? mh.time.indexOf(t) : -1;
        var wh = mi >= 0 ? mh.wave_height[mi] : null;
        var sst = mi >= 0 ? mh.sea_surface_temperature[mi] : null;
        return {
          iso: t, i: i,
          wh: wh == null ? null : (mFt ? wh : wh * 3.28084),
          wp: mi >= 0 ? mh.wave_period[mi] : null,
          wvd: mi >= 0 ? mh.wave_direction[mi] : null,
          sst: sst == null ? null : (mF ? sst : sst * 9 / 5 + 32)
        };
      });
      wx.startW = startW;

      var now = sbNow();
      var nowIdx = wx.hours.findIndex(function (h) { return h.iso >= now.iso; });
      if (nowIdx < 0) nowIdx = 0;
      var wedIso = nextWedIso(now);
      var wedIdx = wx.hours.findIndex(function (h) { return h.iso === wedIso; });
      scrub.min = nowIdx;
      scrub.max = wx.hours.length - 1;
      scrub.value = wedIdx >= nowIdx ? wedIdx : nowIdx;
      scrub.disabled = false;
      applyHour();
    }).catch(function () {
      condEl.innerHTML = '<span class="muted">Live forecast unavailable right now — ' +
        'the chart still works; conditions will return when the connection does.</span>';
      scrubLabel.textContent = '—';
    });
  }

  function applyHour() {
    var i = scrub.valueAsNumber;
    var h = wx.hours[i];
    if (!h) return;
    scrubLabel.textContent = fmtHour(h.iso);

    /* per-sample targets for the particle field */
    wx.sampleIds.forEach(function (id) {
      var s = wx.samples[id];
      if (s.ws[i] == null) return;
      var v = windVector(s.ws[i], s.wd[i]);
      s.tu = v[0]; s.tv = v[1];
    });

    /* conditions at the start line (IDW of the mark samples) */
    var rep = windAtHour(i, wx.startW);
    var gRef = wx.samples.G;
    var parts = [];
    if (rep) {
      parts.push('<span><b>' + Math.round(rep.ws) + ' kn</b> from ' + compass16(rep.wd) +
        ' (' + String(Math.round(rep.wd)).padStart(3, '0') + '°) at the line</span>');
      if (gRef && gRef.wg[i] != null) parts.push('<span>gusts <b>' + Math.round(gRef.wg[i]) + ' kn</b></span>');
    }
    if (h.wh != null) {
      parts.push('<span>seas <b>' + h.wh.toFixed(1) + ' ft</b>' +
        (h.wp ? ' @ ' + Math.round(h.wp) + ' s' : '') +
        (h.wvd != null ? ' from ' + compass16(h.wvd) : '') + '</span>');
    }
    if (h.sst != null) parts.push('<span>water <b>' + Math.round(h.sst) + '°F</b></span>');
    if (gRef && gRef.at[i] != null) parts.push('<span>air <b>' + Math.round(gRef.at[i]) + '°F</b></span>');
    condEl.innerHTML = parts.join('<span class="sail-dot">·</span>');

    if (rep && roseNeedle) {
      roseNeedle.style.transform = 'rotate(' + ((rep.wd + 180) % 360) + 'deg)';
      roseSpd.textContent = Math.round(rep.ws);
      roseDir.textContent = compass16(rep.wd);
    }
    updateMarkWinds();
    if (reduceMotion) windTick(performance.now());
    paintLegWinds();
  }
  scrub.addEventListener('input', applyHour);

  /* ---------- boot ---------- */
  function boot() {
    resizeCanvas();
    applyView(fitBBox(inshoreBBox()));
    var initial = findCourse('A 4');
    if (initial) {
      select.value = 'A 4';
      drawCourse(initial);
      updateLegs(initial);
    } else {
      updateLegs(null);
    }
    loadForecast();
    if (!reduceMotion) requestAnimationFrame(windTick);
    else windTick(performance.now());
  }
  var resizeT;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () {
      resizeCanvas();
      var c = findCourse(select.value);
      if (c) drawCourse(c); else applyView(fitBBox(inshoreBBox()));
      if (reduceMotion) windTick(performance.now());
    }, 150);
  });
  boot();
})();
