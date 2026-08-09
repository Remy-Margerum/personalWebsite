/* OwnTracks relay for remymargerum.com/sailing/
   Accepts location pings from OwnTracks (HTTP mode) and serves them to the
   sailing chart — but only when a ping arrives during Wet Wednesdays
   (Wed 4–7 PM Pacific) AND inside the chart's race area. Everything else
   is dropped before it is ever stored.

   /latest  → the boat's current position (hidden when >10 min stale)
   /track   → the breadcrumb of the current race week, a dotted trail of
              every point sailed. Keyed by the week's Wednesday, so the
              trail on the map resets each Wednesday; past weeks stay saved
              in Firestore. The POST path is gated by a secret token (env
              TOKEN); ?force=1 on a token-valid POST bypasses the window
              for testing. */
'use strict';
const http = require('http');

const TOKEN = process.env.TOKEN || '';
const BBOX = { s: 34.345, w: -119.742, n: 34.428, e: -119.638 };
const STALE_MS = 10 * 60 * 1000;
const MAX_POINTS = 4000;
const MIN_SEP_M = 8; /* skip points closer than this to the last one */

/* Firestore is optional: if it can't init (e.g. local dev) the relay still
   works in-memory, it just won't survive a cold start. */
let db = null;
try {
  const { Firestore } = require('@google-cloud/firestore');
  db = new Firestore();
} catch (e) { db = null; }

let latest = null;               /* { lat, lon, ts, vel, heading } */
let prev = null;
let track = { week: null, points: [] }; /* points: [{ lat, lon, t }] */

function pacificParts(d) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false
  }).formatToParts(d).reduce((o, x) => { o[x.type] = x.value; return o; }, {});
}
function inWindow(d) {
  const p = pacificParts(d);
  const hour = p.hour === '24' ? 0 : +p.hour;
  return p.weekday === 'Wed' && hour >= 16 && hour < 19;
}
/* date (YYYY-MM-DD, Pacific) of the Wednesday of the current week — the
   trail's key. Resets when the calendar rolls to the next Wednesday. */
function weekKey(d) {
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[pacificParts(d).weekday];
  const back = (dow - 3 + 7) % 7; /* days since this week's Wednesday */
  const wed = new Date(d.getTime() - back * 86400000);
  const p = pacificParts(wed);
  return p.year + '-' + p.month + '-' + p.day;
}
function bearing(a, b) {
  const toR = x => x * Math.PI / 180;
  const dLon = toR(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(toR(b.lat));
  const x = Math.cos(toR(a.lat)) * Math.sin(toR(b.lat)) -
    Math.sin(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function metersBetween(a, b) {
  const toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
  const m = Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(m), Math.sqrt(1 - m));
}

async function loadWeek(wk) {
  if (track.week === wk) return;
  track = { week: wk, points: [] };
  if (!db) return;
  try {
    const snap = await db.collection('tracks').doc(wk).get();
    if (snap.exists && Array.isArray(snap.data().points)) track.points = snap.data().points;
  } catch (e) { /* keep the empty in-memory trail */ }
}
async function saveWeek() {
  if (!db) return;
  try {
    await db.collection('tracks').doc(track.week)
      .set({ points: track.points, updated: Date.now() }, { merge: true });
  } catch (e) { /* in-memory copy survives until the next successful write */ }
}

function send(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(obj == null ? '' : JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': '*'
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/latest') {
    if (!latest || Date.now() - latest.ts > STALE_MS) { send(res, 204, null); return; }
    send(res, 200, {
      lat: latest.lat, lon: latest.lon,
      t: new Date(latest.ts).toISOString(), vel: latest.vel, heading: latest.heading
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/track') {
    const wk = weekKey(new Date());
    await loadWeek(wk);
    send(res, 200, { week: wk, points: track.points });
    return;
  }

  if (req.method === 'POST' && TOKEN && url.pathname === '/pub/' + TOKEN) {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 65536) req.destroy(); });
    req.on('end', async () => {
      let msg = null;
      try { msg = JSON.parse(body); } catch (e) {}
      const done = () => send(res, 200, []); /* OwnTracks always wants an array */
      if (!msg || msg._type !== 'location' ||
          typeof msg.lat !== 'number' || typeof msg.lon !== 'number') { done(); return; }
      const now = new Date();
      const force = url.searchParams.get('force') === '1';
      if (!force && !inWindow(now)) { done(); return; }
      if (msg.lat < BBOX.s || msg.lat > BBOX.n ||
          msg.lon < BBOX.w || msg.lon > BBOX.e) { done(); return; }

      latest = {
        lat: msg.lat, lon: msg.lon, ts: Date.now(),
        vel: typeof msg.vel === 'number' && msg.vel >= 0
          ? Math.round(msg.vel * 0.539957 * 10) / 10 : null,
        heading: typeof msg.cog === 'number' && msg.cog >= 0
          ? Math.round(msg.cog) : (prev ? Math.round(bearing(prev, msg)) : null)
      };
      prev = { lat: msg.lat, lon: msg.lon };

      /* extend the week's breadcrumb */
      await loadWeek(weekKey(now));
      const last = track.points[track.points.length - 1];
      if (!last || metersBetween(last, msg) >= MIN_SEP_M) {
        track.points.push({
          lat: Math.round(msg.lat * 1e5) / 1e5,
          lon: Math.round(msg.lon * 1e5) / 1e5,
          t: latest.ts
        });
        if (track.points.length > MAX_POINTS) track.points.shift();
        await saveWeek();
      }
      done();
    });
    return;
  }

  send(res, 404, null);
});

server.listen(process.env.PORT || 8080);
