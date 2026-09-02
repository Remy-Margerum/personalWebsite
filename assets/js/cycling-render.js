/* Shared markup for /cycling/. The page (assets/js/cycling.js) uses it to
   re-render from assets/data/cycling/feed.json, and scripts/cycling-rides.mjs
   uses the very same functions to bake that markup into cycling/index.html
   as the no-JS/SEO fallback, so the two never drift. Plain ES5: it runs
   unchanged in the browser and in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CyclingRender = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul',
    'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var INK = '#222222', MUTED = '#6b6560', LINE = '#e8e2da', BROWN = '#7f4c29';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad2(n) { return ('0' + n).slice(-2); }
  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
  function fmtHM(sec) {                       /* 1:05 */
    var m = Math.floor(sec / 60);
    return Math.floor(m / 60) + ':' + pad2(m % 60);
  }
  function fmtHMS(sec) {                      /* 1:05:09, or 12:34 under an hour */
    sec = Math.round(sec);
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return h ? h + ':' + pad2(m) + ':' + pad2(s) : m + ':' + pad2(s);
  }
  function parseYMD(s) {
    var p = String(s).split('-');
    return { y: +p[0], m: +p[1] - 1, d: +p[2] };
  }
  function longDate(s) { var p = parseYMD(s); return MONTHS[p.m] + ' ' + p.d + ', ' + p.y; }
  function shortDate(s) { var p = parseYMD(s); return MONTHS_SHORT[p.m] + ' ' + p.d; }

  /* the four season figures, in the page's .stat-row */
  function seasonHTML(season) {
    return '<div><div class="num" data-stat="rides">' + fmtInt(season.rides) + '</div><div class="lbl">Rides</div></div>' +
      '<div><div class="num" data-stat="miles">' + fmtInt(season.mi) + '</div><div class="lbl">Miles</div></div>' +
      '<div><div class="num" data-stat="feet">' + fmtInt(season.ft) + '</div><div class="lbl">Feet Climbed</div></div>' +
      '<div><div class="num" data-stat="hours">' + fmtHM(season.sec) + '</div><div class="lbl">Hours</div></div>';
  }

  /* miles per Monday-week: 760×230 box, baseline at y=200, value labels on
     the biggest week and the current (in-progress, faded) one. Each slot
     also gets an invisible hit rect so the page can add a hover readout. */
  function weeksSVG(weeks) {
    if (!weeks || !weeks.length) return '';
    var SPAN = 740 / weeks.length, BAR = 34.5, MAXH = 152;
    var maxMi = 0, iMax = 0, i;
    for (i = 0; i < weeks.length; i++) {
      if (weeks[i].mi > maxMi) { maxMi = weeks[i].mi; iMax = i; }
    }
    var s = '<svg viewBox="0 0 760 230" role="img" aria-label="Miles ridden per week, last ' +
      weeks.length + ' weeks">';
    for (i = 0; i < weeks.length; i++) {
      var cx = 10 + SPAN * (i + 0.5);
      var cur = i === weeks.length - 1;
      var mi = weeks[i].mi;
      if (mi > 0 && maxMi > 0) {
        var h = Math.max(mi / maxMi * MAXH, 2), top = 200 - h;
        s += '<rect class="wk-bar" data-i="' + i + '" x="' + (cx - BAR / 2).toFixed(1) + '" y="' + top.toFixed(1) +
          '" width="' + BAR + '" height="' + h.toFixed(1) + '" rx="1" fill="' + BROWN + '"' +
          (cur ? ' opacity="0.45"' : '') + '/>';
        if (i === iMax || cur) {
          s += '<text class="wk-lbl" x="' + cx.toFixed(1) + '" y="' + (top - 7).toFixed(1) +
            '" text-anchor="middle" font-size="13" fill="' + INK + '">' + Math.round(mi) + '</text>';
        }
      }
      if (i % 2 === 0) {
        s += '<text x="' + cx.toFixed(1) + '" y="222" text-anchor="middle" font-size="12" fill="' + MUTED + '">' +
          shortDate(weeks[i].start) + '</text>';
      }
    }
    s += '<line x1="10" y1="200" x2="750" y2="200" stroke="' + LINE + '" stroke-width="1"/>';
    for (i = 0; i < weeks.length; i++) {
      s += '<rect class="wk-hit" data-i="' + i + '" x="' + (10 + SPAN * i).toFixed(1) +
        '" y="0" width="' + SPAN.toFixed(1) + '" height="230" fill="transparent"/>';
    }
    s += '<text class="wk-hover" x="0" y="18" text-anchor="middle" font-size="13" fill="' + INK +
      '" opacity="0"></text></svg>';
    return s;
  }

  /* elevation sparkline: 280×64 box, x 4→276, min altitude at y=60, max at y=4 */
  function sparkSVG(alt) {
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
      '<polygon points="4,60 ' + line + ' 276,60" fill="' + BROWN + '" opacity="0.10"/>' +
      '<polyline points="' + line + '" fill="none" stroke="' + BROWN + '" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<line x1="4" y1="60" x2="276" y2="60" stroke="' + LINE + '" stroke-width="1"/></svg></div>';
  }

  function rideStatsHTML(r) {
    var s = '<span><b>' + (+r.mi).toFixed(1) + '</b> mi</span>' +
      '<span><b>' + fmtInt(r.ft) + '</b> ft climbed</span>' +
      '<span><b>' + fmtHM(r.sec) + '</b> riding</span>' +
      '<span><b>' + (+r.mph).toFixed(1) + '</b> mph</span>';
    if (r.hr) s += '<span><b>' + fmtInt(r.hr) + '</b> bpm</span>';
    if (r.w) s += '<span><b>' + fmtInt(r.w) + '</b> W</span>';
    return s;
  }

  /* one ride card. With an id it gets a details toggle and an empty panel
     the page fills from rides/<id>.json; without one (older baked markup)
     it is just the summary. */
  function rideCardHTML(r) {
    var id = r.id != null ? esc(String(r.id)) : '';
    return '<article class="ride"' + (id ? ' id="ride-' + id + '" data-id="' + id + '"' : '') + '>' +
      '<div class="ride-info">' +
      '<p class="ride-date">' + longDate(r.date) + '</p>' +
      '<h3>' + esc(r.name) + '</h3>' +
      '<p class="ride-stats">' + rideStatsHTML(r) + '</p>' +
      (id ? '<button type="button" class="ride-toggle" aria-expanded="false" aria-controls="ride-' + id +
        '-detail">Ride details</button>' : '') +
      '</div>' + sparkSVG(r.alt) +
      (id ? '<div class="ride-detail" id="ride-' + id + '-detail" hidden></div>' : '') +
      '</article>';
  }

  function rideListHTML(rides, limit) {
    if (!rides) return '';
    var n = limit ? Math.min(limit, rides.length) : rides.length, s = '';
    for (var i = 0; i < n; i++) s += rideCardHTML(rides[i]);
    return s;
  }

  /* "Ride data synced from Intervals.icu · Updated September 2, 2026, 11:33 AM PT" —
     Pacific in both the browser and Node so the baked text matches */
  function updatedText(iso) {
    var base = 'Ride data synced from Intervals.icu';
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return base;
    var parts = {}, list, i;
    try {
      list = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
      }).formatToParts(d);
    } catch (e) {
      return base + ' · Updated ' + longDate(String(iso).slice(0, 10));
    }
    for (i = 0; i < list.length; i++) parts[list[i].type] = list[i].value;
    return base + ' · Updated ' + parts.month + ' ' + parts.day + ', ' + parts.year + ', ' +
      parts.hour + ':' + parts.minute + ' ' + parts.dayPeriod + ' PT';
  }

  return {
    esc: esc, fmtInt: fmtInt, fmtHM: fmtHM, fmtHMS: fmtHMS, parseYMD: parseYMD,
    longDate: longDate, shortDate: shortDate,
    seasonHTML: seasonHTML, weeksSVG: weeksSVG, sparkSVG: sparkSVG,
    rideCardHTML: rideCardHTML, rideListHTML: rideListHTML, updatedText: updatedText,
    MONTHS: MONTHS, MONTHS_SHORT: MONTHS_SHORT,
    colors: { ink: INK, muted: MUTED, line: LINE, brown: BROWN }
  };
}));
