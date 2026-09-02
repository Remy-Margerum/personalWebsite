/* /cycling/ page script. Loads assets/data/cycling/feed.json — written by
   the cycling-rides GitHub Action from Intervals.icu — and re-renders the
   season stats, weekly chart and ride list with the shared renderer
   (cycling-render.js); the HTML baked into the page is the no-JS fallback.
   "Ride details" opens a panel built from assets/data/cycling/rides/<id>.json:
   stat tiles, distance-aligned charts with a shared crosshair, climbs, best
   efforts, time in zones, laps and mile splits. Also the days-out counter,
   the weekly AI note and today's temperature curve. */
(function () {
  var R = window.CyclingRender;
  if (!R) return;
  var FEED_URL = '/assets/data/cycling/feed.json';
  var RIDE_DIR = '/assets/data/cycling/rides/';
  var RECENT = 8;                             /* rides shown before "show all" */
  var EVENT = { y: 2026, m: 9, d: 17 };       /* Ride Santa Barbara 100 (m is 0-based) */
  var BROWN = R.colors.brown, INK = R.colors.ink, MUTED = R.colors.muted, LINE = R.colors.line;
  var PAPER = '#ffffff';
  /* ordered ramp for zone bars, light → dark */
  var ZONE_RAMP = ['#cbaa89', '#bb9370', '#a97c58', '#956542', '#7f4f2f', '#67391f', '#4d2712'];
  var MONTHS = R.MONTHS;
  var esc = R.esc, fmtInt = R.fmtInt, fmtHMS = R.fmtHMS, longDate = R.longDate;
  var DASH = '–';
  var feed = null, showingAll = false;

  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
  function closest(el, cls) {
    while (el && el.nodeType === 1) {
      if (el.classList && el.classList.contains(cls)) return el;
      el = el.parentNode;
    }
    return null;
  }

  /* "October 17, 2026 — 53 days out." — recount on every visit */
  function updateDaysOut() {
    var el = document.getElementById('days-out');
    if (!el) return;
    var now = new Date();
    var days = Math.round((Date.UTC(EVENT.y, EVENT.m, EVENT.d) -
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    if (days > 1) el.textContent = days + ' days out';
    else if (days === 1) el.textContent = 'tomorrow';
    else if (days === 0) el.textContent = 'today';
  }

  /* ---------- weekly miles: hover readout on the bars ---------- */
  function weekLabel(start) {
    var p = R.parseYMD(start);
    var end = new Date(Date.UTC(p.y, p.m, p.d + 6));
    return R.MONTHS_SHORT[p.m] + ' ' + p.d + '–' +
      (end.getUTCMonth() === p.m ? '' : R.MONTHS_SHORT[end.getUTCMonth()] + ' ') + end.getUTCDate();
  }
  function bindWeeks(weeks) {
    var svg = document.querySelector('#weekly-chart svg');
    if (!svg || !weeks) return;
    var hover = svg.querySelector('.wk-hover');
    if (!hover) return;
    var bars = svg.querySelectorAll('.wk-bar'), k;
    function leave() {
      hover.setAttribute('opacity', '0');
      for (k = 0; k < bars.length; k++) bars[k].classList.remove('is-hot');
    }
    svg.addEventListener('pointermove', function (ev) {
      var hit = closest(ev.target, 'wk-hit');
      var i = hit ? +hit.getAttribute('data-i') : -1, w = weeks[i];
      if (!w) { leave(); return; }
      var span = 740 / weeks.length;
      hover.setAttribute('x', clamp(10 + span * (i + 0.5), 120, 640).toFixed(1));
      hover.textContent = weekLabel(w.start) + ' · ' + (+w.mi).toFixed(1) + ' mi' +
        (w.rides != null ? ' · ' + w.rides + (w.rides === 1 ? ' ride' : ' rides') : '') +
        (w.ft ? ' · ' + fmtInt(w.ft) + ' ft' : '');
      hover.setAttribute('opacity', '1');
      for (k = 0; k < bars.length; k++) {
        bars[k].classList.toggle('is-hot', +bars[k].getAttribute('data-i') === i);
      }
    });
    svg.addEventListener('pointerleave', leave);
  }

  /* ---------- ride list ---------- */
  function renderRides() {
    var list = document.getElementById('ride-list');
    if (!list || !feed || !feed.rides) return;
    list.innerHTML = feed.rides.length ? R.rideListHTML(feed.rides, showingAll ? 0 : RECENT)
      : '<p class="event-note">No rides logged yet this season.</p>';
    var more = document.getElementById('ride-more');
    if (more) {
      var show = feed.rides.length > RECENT && !showingAll;
      more.hidden = !show;
      if (show) more.textContent = 'Show all ' + feed.rides.length + ' rides';
    }
  }

  function setOpen(card, open, updateHash) {
    var btn = card.querySelector('.ride-toggle'), panel = card.querySelector('.ride-detail');
    var id = card.getAttribute('data-id');
    if (!btn || !panel || !id) return;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.textContent = open ? 'Hide details' : 'Ride details';
    panel.hidden = !open;
    if (open) loadDetail(id, panel);
    if (updateHash && window.history && history.replaceState) {
      if (open) history.replaceState(null, '', '#ride-' + id);
      else if (location.hash === '#ride-' + id) history.replaceState(null, '', location.pathname + location.search);
    }
  }

  function loadDetail(id, panel) {
    if (panel.getAttribute('data-state')) return;
    panel.setAttribute('data-state', 'loading');
    panel.innerHTML = '<p class="detail-note">Loading ride…</p>';
    fetch(RIDE_DIR + encodeURIComponent(id) + '.json').then(function (r) {
      if (!r.ok) throw new Error('detail ' + r.status);
      return r.json();
    }).then(function (d) {
      panel.setAttribute('data-state', 'ready');
      renderDetail(panel, d);
    }).catch(function () {
      panel.removeAttribute('data-state');
      panel.innerHTML = '<p class="detail-note">Details for this ride aren’t available yet — ' +
        'the next sync should add them.</p>';
    });
  }

  function bindList() {
    var list = document.getElementById('ride-list');
    if (list) {
      list.addEventListener('click', function (ev) {
        var btn = closest(ev.target, 'ride-toggle');
        var card = btn && closest(btn, 'ride');
        if (card) setOpen(card, btn.getAttribute('aria-expanded') !== 'true', true);
      });
    }
    var more = document.getElementById('ride-more');
    if (more) {
      more.addEventListener('click', function () {
        showingAll = true;
        renderRides();
      });
    }
  }

  /* #ride-<id> deep-links straight to an open ride */
  function openFromHash() {
    var m = /^#ride-([A-Za-z0-9_-]+)$/.exec(location.hash || '');
    if (!m) return;
    var id = m[1], i;
    if (feed && feed.rides && !showingAll) {
      for (i = RECENT; i < feed.rides.length; i++) {
        if (String(feed.rides[i].id) === id) { showingAll = true; renderRides(); break; }
      }
    }
    var card = document.getElementById('ride-' + id);
    if (!card) return;
    setOpen(card, true, false);
    setTimeout(function () { card.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 50);
  }

  /* ---------- ride detail ---------- */
  function tile(label, value, unit) {
    return '<div><div class="num">' + value + (unit ? '<small>' + unit + '</small>' : '') +
      '</div><div class="lbl">' + label + '</div></div>';
  }
  function statTiles(s) {
    var h = '';
    if (s.mi != null) h += tile('Distance', s.mi.toFixed(1), 'mi');
    if (s.moving != null) h += tile('Moving time', fmtHMS(s.moving));
    if (s.elapsed != null && s.moving != null && s.elapsed - s.moving >= 60) {
      h += tile('Stopped', fmtHMS(s.elapsed - s.moving));
    }
    if (s.ft != null) h += tile('Climbed', fmtInt(s.ft), 'ft');
    if (s.ft_down != null) h += tile('Descended', fmtInt(s.ft_down), 'ft');
    if (s.mph != null) h += tile('Avg speed', s.mph.toFixed(1), 'mph');
    if (s.max_mph != null) h += tile('Max speed', s.max_mph.toFixed(1), 'mph');
    if (s.avg_hr != null) h += tile('Avg heart rate', fmtInt(s.avg_hr), 'bpm');
    if (s.max_hr != null) h += tile('Max heart rate', fmtInt(s.max_hr), 'bpm');
    if (s.avg_w != null) h += tile('Avg power', fmtInt(s.avg_w), 'W');
    if (s.np != null) h += tile('Normalized power', fmtInt(s.np), 'W');
    if (s.intensity != null) {
      h += tile('Intensity', Math.round(s.intensity <= 2 ? s.intensity * 100 : s.intensity), '% of FTP');
    }
    if (s.kj != null) h += tile('Work', fmtInt(s.kj), 'kJ');
    if (s.load != null) h += tile('Training load', fmtInt(s.load));
    if (s.avg_cad != null) h += tile('Avg cadence', fmtInt(s.avg_cad), 'rpm');
    if (s.cal != null) h += tile('Calories', fmtInt(s.cal), 'kcal');
    if (s.max_ft != null) h += tile('High point', fmtInt(s.max_ft), 'ft');
    var t = s.wx && s.wx.temp_f != null ? s.wx.temp_f : s.temp_f;
    if (t != null) h += tile('Temperature', fmtInt(t), '°F');
    if (s.wx && s.wx.wind_mph != null) {
      h += tile('Wind', fmtInt(s.wx.wind_mph), 'mph' +
        (s.wx.headwind_pct != null ? ' · ' + Math.round(s.wx.headwind_pct) + '% headwind' : ''));
    }
    if (s.ef != null) h += tile('Efficiency factor', s.ef.toFixed(2));
    if (s.decoupling != null) h += tile('HR decoupling', s.decoupling.toFixed(1), '%');
    return h;
  }

  /* stacked small multiples sharing the distance axis: elevation (area),
     speed, heart rate, power, cadence — whichever the ride recorded — with
     one crosshair reading every series into the line above the chart */
  function tickStep(maxMi) {
    return maxMi <= 8 ? 1 : maxMi <= 16 ? 2 : maxMi <= 40 ? 5 : maxMi <= 80 ? 10 : 20;
  }
  function buildCharts(wrap, readout, st) {
    var n = st.mi.length, i, k;
    var defs = [
      { key: 'ft', title: 'Elevation', unit: 'ft', area: true, h: 150, minSpan: 60,
        fmt: function (v) { return fmtInt(v) + ' ft'; } },
      { key: 'mph', title: 'Speed', unit: 'mph', h: 110, minSpan: 6,
        fmt: function (v) { return v.toFixed(1) + ' mph'; } },
      { key: 'hr', title: 'Heart rate', unit: 'bpm', h: 110, minSpan: 25,
        fmt: function (v) { return fmtInt(v) + ' bpm'; } },
      { key: 'w', title: 'Power', unit: 'W', h: 110, minSpan: 60,
        fmt: function (v) { return fmtInt(v) + ' W'; } },
      { key: 'cad', title: 'Cadence', unit: 'rpm', h: 90, minSpan: 20,
        fmt: function (v) { return fmtInt(v) + ' rpm'; } }
    ];
    var W = 760, L = 10, RX = 750, HEAD = 30, AXIS = 28;
    var maxMi = Math.max(st.mi[n - 1], 0.1);
    var X = function (mi) { return L + (RX - L) * mi / maxMi; };
    var panels = [], y = 0, s = '';

    defs.forEach(function (p) {
      var vals = st[p.key];
      if (!vals) return;
      var lo = Infinity, hi = -Infinity, iHi = -1, v;
      for (i = 0; i < n; i++) {
        v = vals[i];
        if (v == null) continue;
        if (v < lo) lo = v;
        if (v > hi) { hi = v; iHi = i; }
      }
      if (!isFinite(lo)) return;
      if (p.key === 'hr') lo = Math.max(Math.floor((lo - 5) / 10) * 10, 0);
      else if (p.key !== 'ft') lo = 0;
      var span = Math.max(hi - lo, p.minSpan);
      var top = y + HEAD, base = top + p.h;
      var Y = (function (top, base, lo, span, h) {
        return function (val) { return base - (val - lo) / span * h; };
      }(top, base, lo, span, p.h));
      var segs = [], pts = [];
      for (i = 0; i < n; i++) {
        if (vals[i] == null) { if (pts.length) { segs.push(pts); pts = []; } continue; }
        pts.push([X(st.mi[i]), Y(vals[i])]);
      }
      if (pts.length) segs.push(pts);

      s += '<text x="' + L + '" y="' + (y + 19) + '" font-size="11.5" letter-spacing="1.8" fill="' + MUTED + '">' +
        p.title.toUpperCase() + ' · ' + p.unit.toUpperCase() + '</text>';
      s += '<line x1="' + L + '" y1="' + top + '" x2="' + RX + '" y2="' + top + '" stroke="' + LINE + '" stroke-width="1"/>';
      s += '<line x1="' + L + '" y1="' + base + '" x2="' + RX + '" y2="' + base + '" stroke="' + LINE + '" stroke-width="1"/>';
      segs.forEach(function (seg) {
        var line = seg.map(function (q) { return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' ');
        if (p.area) {
          s += '<polygon points="' + seg[0][0].toFixed(1) + ',' + base + ' ' + line + ' ' +
            seg[seg.length - 1][0].toFixed(1) + ',' + base + '" fill="' + BROWN + '" opacity="0.10"/>';
        }
        if (seg.length > 1) {
          s += '<polyline points="' + line + '" fill="none" stroke="' + BROWN + '" stroke-width="' +
            (p.area ? 1.6 : 1.7) + '" stroke-linejoin="round" stroke-linecap="round"/>';
        }
      });
      s += '<text class="ch-y" x="' + (L + 4) + '" y="' + (top + 13) + '" font-size="11" fill="' + MUTED + '">' + fmtInt(lo + span) + '</text>';
      s += '<text class="ch-y" x="' + (L + 4) + '" y="' + (base - 4) + '" font-size="11" fill="' + MUTED + '">' + fmtInt(lo) + '</text>';
      if (iHi >= 0) {                        /* the one direct label: the high */
        var hx = X(st.mi[iHi]), hy = Y(hi);
        s += '<g class="ch-max"><circle cx="' + hx.toFixed(1) + '" cy="' + hy.toFixed(1) + '" r="3.5" fill="' + BROWN +
          '" stroke="' + PAPER + '" stroke-width="2"/><text class="ch-halo" x="' + clamp(hx, 60, 700).toFixed(1) +
          '" y="' + Math.max(hy - 9, top + 13).toFixed(1) + '" text-anchor="middle" font-size="12" fill="' + INK + '">' +
          p.fmt(hi) + '</text></g>';
      }
      panels.push({ def: p, vals: vals, Y: Y });
      y = base;
    });
    if (!panels.length) return;

    var step = tickStep(maxMi);
    for (var m = 0; m <= maxMi + 1e-9; m += step) {
      var tx = X(m), anchor = m === 0 ? 'start' : (tx > RX - 30 ? 'end' : 'middle');
      s += '<text x="' + tx.toFixed(1) + '" y="' + (y + 19) + '" text-anchor="' + anchor + '" font-size="12" fill="' + MUTED + '">' +
        m + (m === 0 ? ' mi' : '') + '</text>';
    }
    s += '<g class="ch-hover" opacity="0"><line x1="0" x2="0" y1="' + HEAD + '" y2="' + y + '" stroke="' + BROWN +
      '" stroke-width="1" opacity="0.4"/>';
    panels.forEach(function () {
      s += '<circle r="4" fill="' + BROWN + '" stroke="' + PAPER + '" stroke-width="2"/>';
    });
    s += '</g><rect class="ch-hit" x="' + L + '" y="0" width="' + (RX - L) + '" height="' + y + '" fill="transparent"/>';
    wrap.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + (y + AXIS) + '" role="img" aria-label="' +
      panels.map(function (p) { return p.def.title.toLowerCase(); }).join(', ') +
      ' over the ' + maxMi.toFixed(1) + ' miles of the ride">' + s + '</svg>';

    var svg = wrap.querySelector('svg'), hov = svg.querySelector('.ch-hover');
    var hLine = hov.querySelector('line'), dots = hov.querySelectorAll('circle');
    var maxes = svg.querySelectorAll('.ch-max');
    var idle = '<span class="detail-hint">Hover or touch the charts to read the ride at any mile.</span>';
    readout.innerHTML = idle;
    function nearest(mi) {               /* st.mi never decreases */
      var lo = 0, hi = n - 1;
      while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (st.mi[mid] < mi) lo = mid + 1; else hi = mid;
      }
      if (lo > 0 && mi - st.mi[lo - 1] < st.mi[lo] - mi) lo--;
      return lo;
    }
    function show(i) {
      var px = X(st.mi[i]).toFixed(1);
      hLine.setAttribute('x1', px);
      hLine.setAttribute('x2', px);
      var parts = ['<span><b>' + st.mi[i].toFixed(1) + '</b> mi</span>'];
      if (st.sec) parts.push('<span><b>' + fmtHMS(st.sec[i]) + '</b> elapsed</span>');
      panels.forEach(function (p, j) {
        var v = p.vals[i];
        if (v == null) { dots[j].setAttribute('opacity', '0'); return; }
        dots[j].setAttribute('opacity', '1');
        dots[j].setAttribute('cx', px);
        dots[j].setAttribute('cy', p.Y(v).toFixed(1));
        parts.push('<span><b>' + (p.def.key === 'mph' ? v.toFixed(1) : fmtInt(v)) + '</b> ' + p.def.unit + '</span>');
      });
      if (st.grade && st.grade[i] != null) parts.push('<span><b>' + st.grade[i].toFixed(1) + '%</b> grade</span>');
      hov.setAttribute('opacity', '1');
      for (k = 0; k < maxes.length; k++) maxes[k].setAttribute('opacity', '0');
      readout.innerHTML = parts.join('');
    }
    function hide() {
      hov.setAttribute('opacity', '0');
      for (k = 0; k < maxes.length; k++) maxes[k].setAttribute('opacity', '1');
      readout.innerHTML = idle;
    }
    svg.addEventListener('pointermove', function (ev) {
      var box = svg.getBoundingClientRect();
      var vx = (ev.clientX - box.left) / box.width * W;
      if (vx < L || vx > RX) { hide(); return; }
      show(nearest((vx - L) / (RX - L) * maxMi));
    });
    svg.addEventListener('pointerleave', hide);
  }

  function table(head, rows) {
    return '<table class="detail-table"><thead><tr>' +
      head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
  }
  function has(list, key) {
    for (var i = 0; i < list.length; i++) if (list[i][key] != null) return true;
    return false;
  }

  function climbsHTML(cl) {
    var hr = has(cl, 'hr'), w = has(cl, 'w');
    var head = ['Starts at', 'Length', 'Gain', 'Avg grade', 'Steepest', 'Time', 'Climb rate'];
    if (hr) head.push('Avg HR');
    if (w) head.push('Avg power');
    return table(head, cl.map(function (c) {
      var r = ['mile ' + c.start_mi.toFixed(1), c.len_mi.toFixed(2) + ' mi', fmtInt(c.gain_ft) + ' ft',
        c.grade.toFixed(1) + '%', c.max_grade != null ? c.max_grade.toFixed(1) + '%' : DASH,
        fmtHMS(c.sec), c.fph != null ? fmtInt(c.fph) + ' ft/hr' : DASH];
      if (hr) r.push(c.hr != null ? fmtInt(c.hr) + ' bpm' : DASH);
      if (w) r.push(c.w != null ? fmtInt(c.w) + ' W' : DASH);
      return r;
    }));
  }

  function durLabel(sec) {
    return sec < 60 ? sec + ' s' : sec < 3600 ? (sec / 60) + ' min' : (sec / 3600) + ' hr';
  }
  function peaksHTML(pk) {
    var cols = [], secs = [], i, j;
    if (pk.mph) cols.push({ key: 'mph', label: 'Speed', fmt: function (v) { return v.toFixed(1) + ' mph'; } });
    if (pk.hr) cols.push({ key: 'hr', label: 'Heart rate', fmt: function (v) { return fmtInt(v) + ' bpm'; } });
    if (pk.w) cols.push({ key: 'w', label: 'Power', fmt: function (v) { return fmtInt(v) + ' W'; } });
    if (!cols.length) return '';
    cols.forEach(function (c) {
      pk[c.key].forEach(function (e) { if (secs.indexOf(e.sec) < 0) secs.push(e.sec); });
    });
    secs.sort(function (a, b) { return a - b; });
    var rows = [];
    for (i = 0; i < secs.length; i++) {
      var row = ['Best ' + durLabel(secs[i])];
      for (j = 0; j < cols.length; j++) {
        var hit = null, list = pk[cols[j].key];
        for (k = 0; k < list.length; k++) if (list[k].sec === secs[i]) hit = list[k];
        row.push(hit ? cols[j].fmt(hit.v) : DASH);
      }
      rows.push(row);
    }
    var k;
    return table([''].concat(cols.map(function (c) { return c.label; })), rows);
  }

  function zoneBlock(title, secs, bounds, unit, ids) {
    var total = 0, i;
    for (i = 0; i < secs.length; i++) if (!ids || /^Z\d+$/.test(ids[i])) total += secs[i];
    if (!total) return '';
    var h = '<p class="detail-h">' + title + '</p><div class="zone-bars">';
    var count = ids ? ids.filter(function (id) { return /^Z\d+$/.test(id); }).length : secs.length;
    var zi = 0;
    for (i = 0; i < secs.length; i++) {
      if (ids && !/^Z\d+$/.test(ids[i])) continue;      /* "SS" overlaps Z3/Z4 — not a slice */
      var name = ids ? ids[i] : 'Z' + (i + 1), range = '';
      if (bounds && bounds.length) {
        var lo = i === 0 ? null : bounds[i - 1], hi = i < bounds.length ? bounds[i] : null;
        if (hi != null && hi < 900) range = (lo == null ? '≤ ' : (lo + 1) + '–') + hi;
        else if (lo != null) range = '> ' + lo;
        if (range) range += ' ' + unit;
      }
      var pct = secs[i] / total * 100;
      var color = ZONE_RAMP[Math.round(zi * (ZONE_RAMP.length - 1) / Math.max(count - 1, 1))];
      h += '<span class="zl">' + esc(name) + (range ? ' <small>' + range + '</small>' : '') + '</span>' +
        '<span class="zb"><i style="width:' + pct.toFixed(1) + '%;background:' + color + '"></i></span>' +
        '<span class="zv"><b>' + Math.round(pct) + '%</b> ' + fmtHMS(secs[i]) + '</span>';
      zi++;
    }
    return h + '</div>';
  }
  function zonesHTML(z) {
    var h = '';
    if (z.hr && z.hr.secs) h += zoneBlock('Heart rate zones', z.hr.secs, z.hr.bounds, 'bpm', null);
    if (z.power && z.power.secs) h += zoneBlock('Power zones', z.power.secs, z.power.bounds, '% FTP', z.power.ids);
    return h;
  }

  function lapsHTML(laps) {
    var ft = has(laps, 'ft'), hr = has(laps, 'hr'), w = has(laps, 'w');
    var head = ['Lap', 'Distance', 'Time', 'Speed'];
    if (ft) head.push('Climb');
    if (hr) head.push('Avg HR');
    if (w) head.push('Avg power');
    return table(head, laps.map(function (l) {
      var r = [esc(l.label || 'Lap'), l.mi != null ? l.mi.toFixed(2) + ' mi' : DASH,
        l.sec != null ? fmtHMS(l.sec) : DASH, l.mph != null ? l.mph.toFixed(1) + ' mph' : DASH];
      if (ft) r.push(l.ft != null ? fmtInt(l.ft) + ' ft' : DASH);
      if (hr) r.push(l.hr != null ? fmtInt(l.hr) + ' bpm' : DASH);
      if (w) r.push(l.w != null ? fmtInt(l.w) + ' W' : DASH);
      return r;
    }));
  }

  function splitsHTML(sp) {
    var hr = has(sp, 'hr'), w = has(sp, 'w'), maxMph = 0, i;
    for (i = 0; i < sp.length; i++) if (sp[i].mph > maxMph) maxMph = sp[i].mph;
    var head = ['Mile', 'Time', 'Speed', 'Climb', 'Descent'];
    if (hr) head.push('Avg HR');
    if (w) head.push('Avg power');
    return table(head, sp.map(function (x) {
      var r = [x.len < 0.95 ? x.mile + ' <small>(' + x.len.toFixed(1) + ' mi)</small>' : String(x.mile),
        fmtHMS(x.sec),
        x.mph != null ? '<span class="sp"><span class="sp-bar"><i style="width:' +
          (maxMph ? (x.mph / maxMph * 100).toFixed(0) : 0) + '%"></i></span>' + x.mph.toFixed(1) + ' mph</span>' : DASH,
        x.up ? '+' + fmtInt(x.up) + ' ft' : DASH,
        x.down ? '−' + fmtInt(x.down) + ' ft' : DASH];
      if (hr) r.push(x.hr != null ? fmtInt(x.hr) + ' bpm' : DASH);
      if (w) r.push(x.w != null ? fmtInt(x.w) + ' W' : DASH);
      return r;
    }));
  }

  function renderDetail(panel, d) {
    var h = '<div class="detail-stats">' + statTiles(d.stats || {}) + '</div>';
    var charts = d.streams && d.streams.mi && d.streams.mi.length > 2;
    if (charts) {
      h += '<p class="detail-h">Along the ride</p><p class="detail-readout" data-role="readout"></p>' +
        '<div class="detail-charts" data-role="charts"></div>';
    }
    if (d.climbs && d.climbs.length) h += '<p class="detail-h">Climbs</p><div class="detail-scroll">' + climbsHTML(d.climbs) + '</div>';
    if (d.peaks) {
      var pk = peaksHTML(d.peaks);
      if (pk) h += '<p class="detail-h">Best efforts</p>' + pk;
    }
    if (d.zones) h += zonesHTML(d.zones);
    if (d.laps && d.laps.length > 1) h += '<p class="detail-h">Laps</p><div class="detail-scroll">' + lapsHTML(d.laps) + '</div>';
    if (d.splits && d.splits.length) h += '<p class="detail-h">Mile splits</p><div class="detail-scroll">' + splitsHTML(d.splits) + '</div>';
    var foot = [];
    if (d.device) foot.push('Recorded on ' + esc(d.device));
    foot.push('<a href="https://intervals.icu/activities/' + encodeURIComponent(String(d.id)) +
      '" target="_blank" rel="noopener">Open on Intervals.icu</a>');
    h += '<p class="detail-foot">' + foot.join(' · ') + '</p>';
    panel.innerHTML = h;
    if (charts) {
      buildCharts(panel.querySelector('[data-role="charts"]'), panel.querySelector('[data-role="readout"]'), d.streams);
    }
  }

  /* ---------- today's temperature, sunrise to sunset ----------
     One series, so no legend: the section heading names it. Direct labels
     only on the day's high and the two ends; the axis stays recessive.
     Geometry matches the weekly-miles chart (760x230, baseline y=200). */
  var WX_URL = 'https://api.open-meteo.com/v1/forecast?latitude=34.42&longitude=-119.7' +
    '&timezone=America%2FLos_Angeles&forecast_days=1&temperature_unit=fahrenheit' +
    '&hourly=temperature_2m&daily=sunrise,sunset';

  function hhmmToMin(s) {          /* "2026-08-28T06:32" -> minutes past midnight */
    var t = s.slice(11);
    return +t.slice(0, 2) * 60 + +t.slice(3, 5);
  }
  function clockLabel(min) {
    var h = Math.floor(min / 60), m = min % 60;
    var ampm = h < 12 ? 'AM' : 'PM';
    return (h % 12 || 12) + (m ? ':' + ('0' + m).slice(-2) : '') + ' ' + ampm;
  }

  function renderWx(j) {
    var sec = document.getElementById('ride-wx-section');
    var wrap = document.getElementById('ride-wx-chart');
    if (!sec || !wrap || !j || !j.hourly || !j.daily) return;
    var rise = hhmmToMin(j.daily.sunrise[0]), set = hhmmToMin(j.daily.sunset[0]);
    var pts = [], i;
    for (i = 0; i < j.hourly.time.length; i++) {
      var min = hhmmToMin(j.hourly.time[i]), t = j.hourly.temperature_2m[i];
      if (min >= rise && min <= set && t != null) pts.push({ min: min, t: t });
    }
    if (pts.length < 3) return;

    var L = 10, R = 750, TOP = 34, BASE = 200;
    var lo = pts[0].t, hi = pts[0].t, iHi = 0;
    for (i = 1; i < pts.length; i++) {
      if (pts[i].t < lo) lo = pts[i].t;
      if (pts[i].t > hi) { hi = pts[i].t; iHi = i; }
    }
    var span = Math.max(hi - lo, 1);
    var X = function (min) { return L + (R - L) * (min - rise) / Math.max(set - rise, 1); };
    var Y = function (t) { return BASE - (t - lo) / span * (BASE - TOP); };

    var line = pts.map(function (p) { return X(p.min).toFixed(1) + ',' + Y(p.t).toFixed(1); }).join(' ');
    var x0 = X(pts[0].min).toFixed(1), x1 = X(pts[pts.length - 1].min).toFixed(1);

    var s = '<svg viewBox="0 0 760 230" role="img" aria-label="Hourly temperature in Santa Barbara from ' +
      clockLabel(rise) + ' to ' + clockLabel(set) + ', low ' + Math.round(lo) +
      ' to high ' + Math.round(hi) + ' degrees Fahrenheit">' +
      '<defs><linearGradient id="wxfill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#7f4c29" stop-opacity="0.18"/>' +
      '<stop offset="1" stop-color="#7f4c29" stop-opacity="0.02"/>' +
      '</linearGradient></defs>' +
      '<polygon points="' + x0 + ',' + BASE + ' ' + line + ' ' + x1 + ',' + BASE + '" fill="url(#wxfill)"/>' +
      '<polyline points="' + line + '" fill="none" stroke="#7f4c29" stroke-width="2" ' +
      'stroke-linejoin="round" stroke-linecap="round"/>';

    /* the day's high, direct-labelled — the one number worth reading off */
    var hx = X(pts[iHi].min), hy = Y(pts[iHi].t);
    s += '<g id="wx-high"><circle cx="' + hx.toFixed(1) + '" cy="' + hy.toFixed(1) + '" r="4.5" fill="#7f4c29"/>' +
      '<text x="' + hx.toFixed(1) + '" y="' + (hy - 12).toFixed(1) + '" text-anchor="middle" ' +
      'font-size="14" fill="#222222">' + Math.round(hi) + '&#176;</text></g>';

    /* ends: sunrise and sunset, labelled with their clock times */
    s += '<line x1="10" y1="' + BASE + '" x2="750" y2="' + BASE + '" stroke="#e8e2da" stroke-width="1"/>' +
      '<text x="' + x0 + '" y="222" text-anchor="start" font-size="12" fill="#6b6560">&#9788; ' +
      clockLabel(rise) + '</text>' +
      '<text x="' + x1 + '" y="222" text-anchor="end" font-size="12" fill="#6b6560">' +
      clockLabel(set) + ' &#9790;</text>';

    /* hover crosshair — the chart is on a page, so let people read any hour */
    s += '<g id="wx-hover" opacity="0">' +
      '<line y1="' + TOP + '" y2="' + BASE + '" stroke="#7f4c29" stroke-width="1" opacity="0.35"/>' +
      '<circle r="4" fill="#7f4c29"/>' +
      '<text text-anchor="middle" font-size="13" fill="#222222"></text></g>' +
      '<rect x="10" y="0" width="740" height="' + BASE + '" fill="transparent" id="wx-hit"/></svg>';
    wrap.innerHTML = s;
    sec.hidden = false;

    var svg = wrap.querySelector('svg');
    var g = svg.querySelector('#wx-hover');
    var hLine = g.querySelector('line'), hDot = g.querySelector('circle'), hText = g.querySelector('text');
    var high = svg.querySelector('#wx-high'); /* hidden while hovering: the
      crosshair label would otherwise collide with it at the peak */
    function move(ev) {
      var box = svg.getBoundingClientRect();
      var vx = (ev.clientX - box.left) / box.width * 760;
      var best = 0, bestD = Infinity;
      for (var k = 0; k < pts.length; k++) {
        var d = Math.abs(X(pts[k].min) - vx);
        if (d < bestD) { bestD = d; best = k; }
      }
      var px = X(pts[best].min), py = Y(pts[best].t);
      hLine.setAttribute('x1', px); hLine.setAttribute('x2', px);
      hDot.setAttribute('cx', px); hDot.setAttribute('cy', py);
      hText.setAttribute('x', Math.min(Math.max(px, 40), 720));
      hText.setAttribute('y', Math.max(py - 14, 14));
      hText.textContent = Math.round(pts[best].t) + '° at ' + clockLabel(pts[best].min);
      g.setAttribute('opacity', '1');
      high.setAttribute('opacity', '0');
    }
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerleave', function () {
      g.setAttribute('opacity', '0');
      high.setAttribute('opacity', '1');
    });
  }

  function loadWx() {
    fetch(WX_URL).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(renderWx).catch(function () { /* no forecast — section stays hidden */ });
  }

  /* ---------- weekly AI training note (written by a scheduled action) ---------- */
  function loadBrief() {
    fetch('/assets/data/cycling-brief.json').then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (j) {
      if (!j || !j.generated || !j.body) return;
      var age = (Date.now() - new Date(j.generated).getTime()) / 86400000;
      /* drafted Wednesday mornings for the week ahead; a missed run drops
         off after about a week rather than showing a stale plan */
      if (age > 8) return;
      var wrap = document.getElementById('ride-brief');
      var body = document.getElementById('ride-brief-body');
      if (!wrap || !body) return;
      body.textContent = j.body;
      wrap.title = (j.week ? 'Week of ' + j.week + ' — ' : '') +
        'AI-drafted ' + longDate(j.generated.slice(0, 10)) + ' from this page’s ride data';
      wrap.hidden = false;
    }).catch(function () {});
  }

  /* ---------- the ride feed ---------- */
  function render(f) {
    feed = f;
    var row = document.querySelector('.stat-row');
    if (row && f.season) row.innerHTML = R.seasonHTML(f.season);
    var wk = document.getElementById('weekly-chart');
    if (wk && f.weeks && f.weeks.length) {
      wk.innerHTML = R.weeksSVG(f.weeks);
      bindWeeks(f.weeks);
    }
    renderRides();
    var up = document.getElementById('ride-updated-text');
    if (up && f.updated) up.textContent = R.updatedText(f.updated);
    openFromHash();
  }

  updateDaysOut();
  loadBrief();
  loadWx();
  bindList();
  window.addEventListener('hashchange', openFromHash);
  fetch(FEED_URL, { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('feed ' + r.status);
      return r.json();
    })
    .then(render)
    .catch(function () { openFromHash(); /* no feed yet — the baked page stands */ });
})();
