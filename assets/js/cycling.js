/* Live ride feed for /cycling/ — pulls season stats, weekly miles and
   recent rides from the Strava relay (infra/strava-relay) and re-renders
   the numbers baked into the page. The relay hears about new activities
   from Strava's webhook the moment they upload, so every page view is
   current. If the relay is unreachable the baked HTML simply stays as
   it is. */
(function () {
  var FEED_URL = 'https://strava-relay-924564512726.us-central1.run.app/feed';
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
    el.textContent = 'Ride data synced from Strava · Updated ' +
      MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() +
      ', ' + h + ':' + ('0' + d.getMinutes()).slice(-2) + ' ' + ampm;
  }

  function render(feed) {
    renderSeason(feed.season);
    renderWeeks(feed.weeks);
    renderRides(feed.rides);
    renderUpdated(feed.updated);
  }

  updateDaysOut();
  fetch(FEED_URL)
    .then(function (r) {
      if (!r.ok) throw new Error('feed ' + r.status);
      return r.json();
    })
    .then(render)
    .catch(function () { /* relay down or not deployed yet — baked page stands */ });
})();
