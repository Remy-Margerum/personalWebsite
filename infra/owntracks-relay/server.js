/* OwnTracks relay for remymargerum.com/sailing/
   Accepts location pings from OwnTracks (HTTP mode) and serves the latest
   position to the sailing chart — but only when the ping arrives during
   Wet Wednesdays (Wed 4–7 PM Pacific) AND inside the chart's race area.
   Anything else is dropped before it is ever stored. The POST path is
   gated by a secret token (env TOKEN, never in this repo); ?force=1 on a
   token-valid POST bypasses the time window for testing. */
'use strict';
const http = require('http');

const TOKEN = process.env.TOKEN || '';
const BBOX = { s: 34.345, w: -119.742, n: 34.428, e: -119.638 };
const STALE_MS = 10 * 60 * 1000;

let latest = null; /* { lat, lon, ts, vel, heading } */
let prev = null;

function inWindow() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'short', hour: '2-digit', hour12: false
  }).formatToParts(new Date()).reduce((o, x) => { o[x.type] = x.value; return o; }, {});
  const hour = p.hour === '24' ? 0 : +p.hour;
  return p.weekday === 'Wed' && hour >= 16 && hour < 19;
}

function bearing(a, b) {
  const toR = d => d * Math.PI / 180;
  const dLon = toR(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(toR(b.lat));
  const x = Math.cos(toR(a.lat)) * Math.sin(toR(b.lat)) -
    Math.sin(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

const server = http.createServer((req, res) => {
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
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    if (!latest || Date.now() - latest.ts > STALE_MS) {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      lat: latest.lat, lon: latest.lon,
      t: new Date(latest.ts).toISOString(),
      vel: latest.vel, heading: latest.heading
    }));
    return;
  }

  if (req.method === 'POST' && TOKEN && url.pathname === '/pub/' + TOKEN) {
    let body = '';
    req.on('data', c => {
      body += c;
      if (body.length > 65536) req.destroy();
    });
    req.on('end', () => {
      /* OwnTracks expects a JSON array back no matter what */
      const ok = () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      };
      let msg = null;
      try { msg = JSON.parse(body); } catch (e) { ok(); return; }
      if (!msg || msg._type !== 'location' ||
          typeof msg.lat !== 'number' || typeof msg.lon !== 'number') { ok(); return; }
      const force = url.searchParams.get('force') === '1';
      if (!force && !inWindow()) { ok(); return; }
      if (msg.lat < BBOX.s || msg.lat > BBOX.n ||
          msg.lon < BBOX.w || msg.lon > BBOX.e) { ok(); return; }
      latest = {
        lat: msg.lat, lon: msg.lon, ts: Date.now(),
        /* OwnTracks vel is km/h -> knots */
        vel: typeof msg.vel === 'number' && msg.vel >= 0
          ? Math.round(msg.vel * 0.539957 * 10) / 10 : null,
        /* course over ground if the phone reports it, else derive from the previous ping */
        heading: typeof msg.cog === 'number' && msg.cog >= 0
          ? Math.round(msg.cog)
          : (prev ? Math.round(bearing(prev, msg)) : null)
      };
      prev = { lat: msg.lat, lon: msg.lon };
      ok();
    });
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(process.env.PORT || 8080);
