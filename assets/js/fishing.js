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
  var SPOT_IDS = ['flats', 'osborn', 'sni'];

  /* ---------- svg scaffolding (bottom to top) ---------- */
  function el(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  var gIso = el('g', { 'class': 'ch-isog' }, svg);        /* isotherms — under land so they never cross the beach */
  var gWater = el('g', { 'class': 'ch-water' }, svg);      /* range rings — under land too */
  var gLand = el('g', { 'class': 'ch-land' }, svg);
  var gGeoFixed = el('g', { 'class': 'ch-geofixed' }, svg);/* big printed names, scale with the chart */
  var gGeoLabels = el('g', { 'class': 'ch-geolabels' }, svg);
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

  var spotEls = {};
  /* the two eastern spots label leftward so nothing clips at the frame edge */
  var SPOT_SIDE = { flats: 1, osborn: -1, sni: -1 };
  SPOT_IDS.forEach(function (id) {
    var m = D.spots[id];
    var w = pOf(m);
    var g = el('g', { 'class': 'ch-mark' }, gMarks);
    el('circle', { cx: w[0], cy: w[1], r: 5, 'class': 'ch-buoy ch-spot' }, g);
    el('circle', { cx: w[0], cy: w[1], r: 1.5, 'class': 'ch-buoy-dot' }, g);
    var lbl = el('text', {
      x: 0, y: 0, 'class': 'ch-marklbl',
      'text-anchor': SPOT_SIDE[id] < 0 ? 'end' : 'start'
    }, g);
    lbl.textContent = m.opt + ' · ' + m.name;
    var hit = el('circle', { cx: w[0], cy: w[1], r: 15, 'class': 'ch-hit' }, g);
    function tip() {
      var t = sstAtLonLat(m.lon, m.lat);
      tooltip.innerHTML = '<strong>' + m.name + '</strong> ' + fmtCoord(m) +
        ' · ' + Math.round(distNm(w)) + ' nm ' +
        (t == null ? '' : '· ' + t.toFixed(1) + ' °F');
      tooltip.style.display = 'block';
      placeTipAt(worldToScreen(w));
    }
    hit.addEventListener('mouseenter', tip);
    hit.addEventListener('mouseleave', hideTip);
    hit.addEventListener('click', function (ev) { tip(); ev.stopPropagation(); });
    spotEls[id] = { g: g, lbl: lbl, w: w, hit: hit, dot: g.childNodes[1], buoy: g.childNodes[0] };
  });

  /* ---------- view: one fixed fit around the grounds ---------- */
  var vb = { x: 0, y: 0, w: 100, h: 100 };
  function fitView() {
    var pts = [harborW, P(-120.72, 34.47), P(-118.92, 33.16), P(-120.47, 33.9)];
    SPOT_IDS.forEach(function (id) { pts.push(pOf(D.spots[id])); });
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
    applyView({ x: cx - w / 2, y: cy - h / 2, w: w, h: h });
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
    Object.keys(spotEls).forEach(function (id) {
      var e = spotEls[id];
      e.lbl.setAttribute('x', e.w[0] + SPOT_SIDE[id] * 9 * z);
      e.lbl.setAttribute('y', e.w[1] - 6 * z);
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
    var min = Infinity, max = -Infinity;
    rows.forEach(function (r) {
      if (r[3] == null) return;
      var f = r[3] * 1.8 + 32;
      v[li[r[1]] * lons.length + gi[r[2]]] = f;
      if (f < min) min = f;
      if (f > max) max = f;
    });
    /* fill land cells from their water neighbours so isotherms and the
       wash run to the beach; the land fill covers the made-up part */
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
    return {
      lats: lats, lons: lons, v: v, vf: vf, min: min, max: max,
      date: rows.length ? rows[0][0].slice(0, 10) : null
    };
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

  function drawIso() {
    while (gIso.firstChild) gIso.removeChild(gIso.firstChild);
    while (gIsoLbl.firstChild) gIsoLbl.removeChild(gIsoLbl.firstChild);
    if (!sst) return;
    var u = upsample(sst, 3);
    var z = zoomOf(vb);
    LEVELS.forEach(function (level) {
      var chains = marchLevel(u, sst, level);
      if (!chains.length) return;
      var d = '';
      chains.forEach(function (ch) {
        ch.forEach(function (p, i) {
          var w = P(p[0], p[1]);
          d += (i ? 'L' : 'M') + w[0].toFixed(1) + ' ' + w[1].toFixed(1);
        });
      });
      var ISO_INK = { 60: '#33517a', 64: '#222222', 68: '#a03a2c', 72: '#c07b3a' };
      el('path', {
        d: d, fill: 'none', stroke: ISO_INK[level],
        'stroke-width': level === 64 || level === 68 ? 1.7 : 1.1,
        'vector-effect': 'non-scaling-stroke',
        'class': 'ch-iso ch-iso--' + level
      }, gIso);
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
  function buildTint() {
    if (!sst) return;
    var ng = sst.lons.length, nl = sst.lats.length;
    tintC.width = ng; tintC.height = nl;
    var tc = tintC.getContext('2d');
    var img = tc.createImageData(ng, nl);
    for (var i = 0; i < nl; i++) {
      for (var j = 0; j < ng; j++) {
        var f = sst.vf[i * ng + j];
        var o = ((nl - 1 - i) * ng + j) * 4; /* row 0 = north */
        if (isNaN(f)) { img.data[o + 3] = 0; continue; }
        var c = rampColor(f);
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2];
        img.data[o + 3] = 96;
      }
    }
    tc.putImageData(img, 0, 0);
  }
  function tintRect() {
    /* screen rect of the grid extent (cell-centre grid, pad half a cell) */
    var dlat = sst.lats[1] - sst.lats[0], dlon = sst.lons[1] - sst.lons[0];
    var tl = worldToScreen(P(sst.lons[0] - dlon / 2, sst.lats[sst.lats.length - 1] + dlat / 2));
    var br = worldToScreen(P(sst.lons[sst.lons.length - 1] + dlon / 2, sst.lats[0] - dlat / 2));
    return [tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]];
  }

  /* ---------- wind field: Open-Meteo sampled offshore, drawn as drifting
     particles exactly like the sailing chart ---------- */
  var wx = { samples: null, ids: [], hourLabel: null };
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

  function loadWind() {
    var lats = D.windPts.map(function (p) { return p.lat; }).join(',');
    var lons = D.windPts.map(function (p) { return p.lon; }).join(',');
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lats + '&longitude=' + lons +
      '&timezone=America%2FLos_Angeles&forecast_days=2&hourly=wind_speed_10m,wind_direction_10m' +
      '&wind_speed_unit=kn';
    fetch(url).then(function (r) { return r.json(); }).then(function (res) {
      var arr = Array.isArray(res) ? res : [res];
      var i = nowIdx(arr[0].hourly.time);
      wx.samples = {};
      wx.ids = [];
      D.windPts.forEach(function (p, k) {
        var h = (arr[k] || arr[0]).hourly;
        if (h.wind_speed_10m[i] == null) return;
        var vec = windVector(h.wind_speed_10m[i], h.wind_direction_10m[i]);
        wx.samples[p.id] = {
          world: P(p.lon, p.lat),
          ws: h.wind_speed_10m[i], wd: h.wind_direction_10m[i],
          u: vec[0], v: vec[1]
        };
        wx.ids.push(p.id);
      });
      /* rose: mean wind over the three grounds */
      var su = 0, sv = 0, n = 0;
      SPOT_IDS.forEach(function (id) {
        var s = wx.samples[id];
        if (s) { su += s.u; sv += s.v; n++; }
      });
      if (n && roseNeedle) {
        var spd = Math.hypot(su / n, sv / n);
        var toDeg = (Math.atan2(su / n, -(sv / n)) * 180 / Math.PI + 360) % 360;
        var wd = (toDeg + 180) % 360;
        roseNeedle.style.transform = 'rotate(' + ((wd + 180) % 360) + 'deg)';
        roseSpd.textContent = Math.round(spd);
        roseDir.textContent = compass16(wd);
      }
      buildWindArrows();
      paintTable();
      paintConditions();
      if (reduceMotion) tick(performance.now());
    }).catch(function () { /* the chart works without wind */ });
  }

  /* small wind arrows at the harbor and each spot */
  function buildWindArrows() {
    while (gMarkWind.firstChild) gMarkWind.removeChild(gMarkWind.firstChild);
    if (!wx.samples) return;
    var z = zoomOf(vb);
    ['harbor'].concat(SPOT_IDS).forEach(function (id) {
      var s = wx.samples[id];
      if (!s) return;
      var w = id === 'harbor' ? harborW : pOf(D.spots[id]);
      var g = el('g', { 'class': 'ch-mwind' }, gMarkWind);
      var rot = el('g', {}, g);
      var len = Math.min(26, 9 + s.ws * 1.1) * z;
      var toDeg = (s.wd + 180) % 360;
      rot.setAttribute('transform',
        'translate(' + w[0] + ' ' + (w[1] + 19 * z) + ') rotate(' + (toDeg - 90) + ')');
      el('line', { x1: -len / 2, y1: 0, x2: len / 2 - 3 * z, y2: 0, 'class': 'ch-mwind-line' }, rot);
      var s2 = 3 * z;
      el('path', {
        d: 'M' + (len / 2 - s2 * 1.4) + ' ' + (-s2 * 0.8) +
           'L' + (len / 2) + ' 0L' + (len / 2 - s2 * 1.4) + ' ' + (s2 * 0.8) + 'Z',
        'class': 'ch-mwind-head'
      }, rot);
      var txt = el('text', {
        x: w[0], y: w[1] + 30 * z, 'class': 'ch-mwind-txt', 'text-anchor': 'middle'
      }, g);
      txt.textContent = Math.round(s.ws);
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
      if (t == null) { hideTip(); return; }
      var nm = Math.round(distNm(w));
      tooltip.innerHTML = '<strong>' + t.toFixed(1) + ' °F</strong> · ' +
        nm + ' nm ' + compass16(brgTrue(w)) + ' of the harbor';
      tooltip.style.display = 'block';
      placeTipAt([sx, sy]);
    });
  });
  frame.addEventListener('mouseleave', function () {
    if (hoverRaf) { cancelAnimationFrame(hoverRaf); hoverRaf = null; }
    hideTip();
  });

  /* ---------- analysis-day scrubber ---------- */
  var MAXBACK = 7;
  function fmtDay(iso) {
    var p = iso.split('-');
    var wd = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][wd] + ' ' + (+p[1]) + '/' + (+p[2]);
  }
  var creditDate = document.getElementById('fish-credit-date');
  function activateGrid(g) {
    sst = g;
    buildTint();
    drawIso();
    paintConditions();
    paintTable();
    dayLabel.textContent = g.date ? fmtDay(g.date) : '—';
    if (creditDate) creditDate.textContent = g.date ? ' · analysis ' + fmtDay(g.date) : '';
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
        dayLabel.textContent = sst && sst.date ? fmtDay(sst.date) : '—';
        return;
      }
      var g = parseGrid(data);
      sstCache[back] = g;
      lsPut(back, data);
      /* only show it if the scrubber still points at this day */
      if (MAXBACK - dayScrub.valueAsNumber === back) activateGrid(g);
    });
  }
  dayScrub.addEventListener('input', function () {
    loadDay(MAXBACK - dayScrub.valueAsNumber);
  });
  backBtn.addEventListener('click', function () {
    dayScrub.value = Math.max(0, dayScrub.valueAsNumber - 1);
    loadDay(MAXBACK - dayScrub.valueAsNumber);
  });
  fwdBtn.addEventListener('click', function () {
    dayScrub.value = Math.min(MAXBACK, dayScrub.valueAsNumber + 1);
    loadDay(MAXBACK - dayScrub.valueAsNumber);
  });

  /* ---------- conditions strip + options table ---------- */
  function paintConditions() {
    if (!sst) return;
    var parts = [];
    parts.push('<span>chart water <b>' + sst.min.toFixed(0) + '–' + sst.max.toFixed(0) +
      ' °F</b></span>');
    parts.push('<span>the zone: <b>64–68 °F</b> over structure, fish the cool side</span>');
    var s = wx.samples && wx.samples.flats;
    if (s) {
      var su = 0, sv = 0, n = 0;
      SPOT_IDS.forEach(function (id) {
        var q = wx.samples[id];
        if (q) { su += q.u; sv += q.v; n++; }
      });
      if (n) {
        var spd = Math.hypot(su / n, sv / n);
        var toDeg = (Math.atan2(su / n, -(sv / n)) * 180 / Math.PI + 360) % 360;
        parts.push('<span>wind on the grounds now <b>' + Math.round(spd) + ' kn</b> from ' +
          compass16((toDeg + 180) % 360) + '</span>');
      }
    }
    condEl.innerHTML = parts.join('<span class="sail-dot">·</span>');
  }

  var tableEl = document.getElementById('fish-table');
  function paintTable() {
    if (!tableEl) return;
    var rows = '';
    SPOT_IDS.forEach(function (id) {
      var m = D.spots[id];
      var w = pOf(m);
      var t = sstAtLonLat(m.lon, m.lat);
      var s = wx.samples && wx.samples[id];
      rows += '<tr><td>' + m.opt + '</td><td>' + m.name +
        '</td><td>' + Math.round(distNm(w)) + ' nm</td><td>' +
        String(brgMag(w)).padStart(3, '0') + '°M</td><td>' +
        (t == null ? '—' : '<b>' + t.toFixed(1) + '°</b>') + '</td><td>' +
        (s ? Math.round(s.ws) + ' kn <span class="muted">' + compass16(s.wd) + '</span>' : '—') +
        '</td></tr>';
    });
    tableEl.innerHTML = '<table class="sail-table"><thead><tr><th></th><th>spot</th>' +
      '<th>run</th><th>brg</th><th>sst</th><th>wind</th></tr></thead><tbody>' +
      rows + '</tbody></table>';
  }

  /* ---------- boot ---------- */
  function boot() {
    resizeCanvas();
    fitView();
    paintTable();
    loadDay(0);
    loadWind();
    if (!reduceMotion) requestAnimationFrame(tick);
    else tick(performance.now());
  }
  var resizeT;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () {
      resizeCanvas();
      fitView();
      drawIso();
      buildWindArrows();
      if (reduceMotion) tick(performance.now());
    }, 150);
  });
  boot();
})();
