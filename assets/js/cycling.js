/* Live ride feed for /cycling/ — pulls season stats, weekly miles and
   recent rides from the Intervals.icu relay (infra/intervals-relay) and
   re-renders the numbers baked into the page. The relay hears about new
   activities from Intervals.icu's webhook the moment they upload, so
   every page view is current. If the relay is unreachable the baked HTML
   simply stays as it is. */
(function () {
  var FEED_URL = 'https://intervals-relay-924564512726.us-central1.run.app/feed';
  var EVENT = { y: 2026, m: 9, d: 17 }; /* Ride Santa Barbara 100 (m is 0-based) */
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul',
    'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
  function fmtHM(sec) {
    var m = Math.floor(sec / 60);
    return Math.floor(m / 60) + ':' + ('0' + (m % 60)).slice(-2);
  }
  function parseYMD(s) {
    var p = s.split('-');
    return { y: +p[0], m: +p[1] - 1, d: +p[2] };
  }
  function longDate(s) {
    var p = parseYMD(s);
    return MONTHS[p.m] + ' ' + p.d + ', ' + p.y;
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

  function renderSeason(season) {
    var vals = {
      rides: fmtInt(season.rides),
      miles: fmtInt(season.mi),
      feet: fmtInt(season.ft),
      hours: fmtHM(season.sec)
    };
    var els = document.querySelectorAll('.stat-row [data-stat]');
    for (var i = 0; i < els.length; i++) {
      var k = els[i].getAttribute('data-stat');
      if (vals[k] != null) els[i].textContent = vals[k];
    }
  }

  /* bar chart, same geometry as the baked SVG: 760×230 box, baseline at
     y=200, 12 Monday-week slots, value labels on the biggest week and the
     current (in-progress, faded) one */
  function renderWeeks(weeks) {
    var wrap = document.getElementById('weekly-chart');
    if (!wrap || !weeks || !weeks.length) return;
    var SPAN = 740 / weeks.length, BAR = 34.5, MAXH = 152;
    var maxMi = 0, iMax = 0, i;
    for (i = 0; i < weeks.length; i++) {
      if (weeks[i].mi > maxMi) { maxMi = weeks[i].mi; iMax = i; }
    }
    var s = '<svg viewBox="0 0 760 230" role="img" aria-label="Miles ridden per week, last ' +
      weeks.length + ' weeks">';
    for (i = 0; i < weeks.length; i++) {
      var cx = (10 + SPAN * (i + 0.5)).toFixed(1);
      var cur = i === weeks.length - 1;
      var mi = weeks[i].mi;
      if (mi > 0 && maxMi > 0) {
        var h = Math.max(mi / maxMi * MAXH, 2);
        var top = 200 - h;
        s += '<rect x="' + (10 + SPAN * (i + 0.5) - BAR / 2).toFixed(1) + '" y="' + top.toFixed(1) +
          '" width="' + BAR + '" height="' + h.toFixed(1) + '" rx="1" fill="#7f4c29"' +
          (cur ? ' opacity="0.45"' : '') + '/>';
        if (i === iMax || cur) {
          s += '<text x="' + cx + '" y="' + (top - 7).toFixed(1) +
            '" text-anchor="middle" font-size="13" fill="#222222">' + Math.round(mi) + '</text>';
        }
      }
      if (i % 2 === 0) {
        var p = parseYMD(weeks[i].start);
        s += '<text x="' + cx + '" y="222" text-anchor="middle" font-size="12" fill="#6b6560">' +
          MONTHS_SHORT[p.m] + ' ' + p.d + '</text>';
      }
    }
    s += '<line x1="10" y1="200" x2="750" y2="200" stroke="#e8e2da" stroke-width="1"/></svg>';
    wrap.innerHTML = s;
  }

  /* elevation sparkline, same geometry as the baked SVGs: 280×64 box,
     x 4→276, min altitude at y=60, max at y=4 */
  function spark(alt) {
    if (!alt || alt.length < 2) return '';
    var min = alt[0], max = alt[0], i;
    for (i = 1; i < alt.length; i++) {
      if (alt[i] < min) min = alt[i];
      if (alt[i] > max) max = alt[i];
    }
    var range = max - min;
    var pts = [];
    for (i = 0; i < alt.length; i++) {
      var x = (4 + 272 * i / (alt.length - 1)).toFixed(1);
      var y = range < 1 ? '32.0' : (60 - (alt[i] - min) / range * 56).toFixed(1);
      pts.push(x + ',' + y);
    }
    var line = pts.join(' ');
    return '<div class="ride-spark"><svg viewBox="0 0 280 64" role="img" aria-label="Elevation profile, ' +
      Math.round(range) + ' ft range" preserveAspectRatio="none">' +
      '<polygon points="4,60 ' + line + ' 276,60" fill="#7f4c29" opacity="0.10"/>' +
      '<polyline points="' + line + '" fill="none" stroke="#7f4c29" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<line x1="4" y1="60" x2="276" y2="60" stroke="#e8e2da" stroke-width="1"/></svg></div>';
  }

  function renderRides(rides) {
    var list = document.getElementById('ride-list');
    if (!list || !rides || !rides.length) return;
    var s = '';
    for (var i = 0; i < rides.length; i++) {
      var r = rides[i];
      s += '<article class="ride"><div class="ride-info">' +
        '<p class="ride-date">' + longDate(r.date) + '</p>' +
        '<h3>' + esc(r.name) + '</h3>' +
        '<p class="ride-stats">' +
        '<span><b>' + r.mi.toFixed(1) + '</b> mi</span>' +
        '<span><b>' + fmtInt(r.ft) + '</b> ft climbed</span>' +
        '<span><b>' + fmtHM(r.sec) + '</b> riding</span>' +
        '<span><b>' + r.mph.toFixed(1) + '</b> mph</span>' +
        '</p></div>' + spark(r.alt) + '</article>';
    }
    list.innerHTML = s;
  }

  function renderUpdated(iso) {
    var el = document.getElementById('ride-updated-text');
    if (!el) return;
    var d = new Date(iso);
    var h = d.getHours() % 12 || 12;
    var ampm = d.getHours() < 12 ? 'AM' : 'PM';
    el.textContent = 'Ride data synced from Intervals.icu · Updated ' +
      MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() +
      ', ' + h + ':' + ('0' + d.getMinutes()).slice(-2) + ' ' + ampm;
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
      hText.textContent = Math.round(pts[best].t) + '\u00b0 at ' + clockLabel(pts[best].min);
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
      wrap.title = (j.week ? 'Week of ' + j.week + ' \u2014 ' : '') +
        'AI-drafted ' + longDate(j.generated.slice(0, 10)) + ' from this page\u2019s ride data';
      wrap.hidden = false;
    }).catch(function () {});
  }

  function render(feed) {
    renderSeason(feed.season);
    renderWeeks(feed.weeks);
    renderRides(feed.rides);
    renderUpdated(feed.updated);
  }

  updateDaysOut();
  loadBrief();
  loadWx();
  fetch(FEED_URL)
    .then(function (r) {
      if (!r.ok) throw new Error('feed ' + r.status);
      return r.json();
    })
    .then(render)
    .catch(function () { /* relay down or not deployed yet — baked page stands */ });
})();
