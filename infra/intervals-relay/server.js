/* Intervals.icu relay for remymargerum.com/cycling/
   Holds the Intervals.icu API key (env var, never in this repo) and serves
   the cycling page a small, sanitized JSON feed: season totals, miles per
   week, and the last few rides with their elevation profiles. No GPS
   coordinates, route maps, or start locations ever leave the relay — only
   aggregates and altitude-vs-distance curves.

   /feed          → the feed, cached 15 minutes so page loads don't touch
                    Intervals.icu at all
   /feed?fresh=1  → allowed to rebuild early, but never more than once
                    every 2 minutes (handy for debugging)
   /webhook       → Intervals.icu push subscription. Its POST body carries
                    the shared secret, which is what authenticates the
                    call; an ACTIVITY_UPLOADED/ANALYZED event busts the
                    cache and rebuilds, so the page is current the moment
                    a ride finishes uploading.

   Env: INTERVALS_API_KEY (Settings → Developer Settings),
        INTERVALS_WEBHOOK_SECRET, and optionally INTERVALS_ATHLETE_ID
        (default 0 = "the key's owner"), SEASON_START (YYYY-MM-DD),
        RIDE_TYPES (comma-separated). See the README's setup steps. */
'use strict';
const http = require('http');

const API = 'https://intervals.icu/api/v1';
const KEY = process.env.INTERVALS_API_KEY || '';
const ATHLETE = process.env.INTERVALS_ATHLETE_ID || '0';
const WEBHOOK_SECRET = process.env.INTERVALS_WEBHOOK_SECRET || '';

/* Intervals.icu mirrors Strava's sport names. Outdoor human-powered rides
   only by default; override with RIDE_TYPES to add e.g. EBikeRide. */
const RIDE_TYPES = (process.env.RIDE_TYPES || 'Ride,GravelRide,MountainBikeRide')
  .split(',').map(s => s.trim()).filter(Boolean);

const TTL_MS = 15 * 60 * 1000;       /* normal cache life of the feed */
const FRESH_MS = 2 * 60 * 1000;      /* floor between ?fresh=1 rebuilds */
const EVENT_DELAY_MS =               /* settle time before a webhook rebuild,
                                        coalescing upload/analyze bursts */
  +process.env.EVENT_DELAY_MS || 15 * 1000;
const RECENT = +process.env.RECENT_RIDES || 8;  /* rides shown on the page */
const WEEKS = 12;                    /* weekly-miles chart span */
const PROFILE_PTS = 124;             /* points per elevation sparkline */
const M_TO_MI = 0.000621371, M_TO_FT = 3.28084, MPS_TO_MPH = 2.23694;

let feed = null, feedAt = 0, building = null;
const profileCache = new Map();      /* activity id → altitude curve (ft) */

const AUTH = 'Basic ' + Buffer.from('API_KEY:' + KEY).toString('base64');

async function api(path) {
  const r = await fetch(API + path, { headers: { Authorization: AUTH } });
  if (!r.ok) throw new Error('intervals ' + r.status + ' on ' + path.split('?')[0]);
  return r.json();
}

function todayPacific() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}
function seasonStart() {
  return process.env.SEASON_START || todayPacific().slice(0, 4) + '-01-01';
}

/* every outdoor ride of the season — one call, and the first build after a
   deploy backfills the whole season in it */
async function seasonRides() {
  const newest = new Date(Date.parse(todayPacific()) + 2 * 86400000)
    .toISOString().slice(0, 10); /* pad for timezone skew */
  const all = await api('/athlete/' + ATHLETE + '/activities' +
    '?oldest=' + seasonStart() + '&newest=' + newest);
  return (Array.isArray(all) ? all : []).filter(a =>
    RIDE_TYPES.includes(a.type) && !a.trainer && !a.indoor);
}

/* the streams response has been served both as an array of {type,data} and
   as an object keyed by stream name, so accept either */
function streamData(payload, name) {
  if (Array.isArray(payload)) {
    const s = payload.find(x => x && (x.type === name || x.name === name));
    return s ? (s.data || s.values || null) : null;
  }
  if (payload && payload[name]) return payload[name].data || payload[name] || null;
  return null;
}

/* altitude-vs-distance curve, resampled evenly and cached per activity —
   only rides that have never been seen cost a streams call */
async function profile(a) {
  if (profileCache.has(a.id)) return profileCache.get(a.id);
  let out = null;
  try {
    const s = await api('/activity/' + a.id + '/streams.json?types=distance,altitude');
    const dist = streamData(s, 'distance'), alt = streamData(s, 'altitude');
    if (dist && alt && alt.length > 1 && dist.length === alt.length) {
      const total = dist[dist.length - 1] || 1;
      const n = Math.min(PROFILE_PTS, alt.length);
      out = [];
      let j = 0;
      for (let i = 0; i < n; i++) {
        const target = total * i / (n - 1);
        while (j < dist.length - 1 && dist[j] < target) j++;
        out.push(Math.round(alt[j] * M_TO_FT * 10) / 10);
      }
    }
  } catch (e) { out = null; /* ride renders without a sparkline */ }
  profileCache.set(a.id, out);
  if (profileCache.size > 300) profileCache.delete(profileCache.keys().next().value);
  return out;
}

/* YYYY-MM-DD of the Monday of the week containing the given local date */
function mondayOf(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dow = (new Date(t).getUTCDay() + 6) % 7; /* Mon = 0 */
  return new Date(t - dow * 86400000).toISOString().slice(0, 10);
}

async function build() {
  const acts = await seasonRides();

  let mi = 0, ft = 0, sec = 0;
  for (const a of acts) {
    mi += (a.distance || 0) * M_TO_MI;
    ft += (a.total_elevation_gain || 0) * M_TO_FT;
    sec += a.moving_time || 0;
  }

  /* miles per Monday-start week, oldest → current */
  const currentMonday = Date.parse(mondayOf(todayPacific()));
  const weeks = [];
  for (let k = WEEKS - 1; k >= 0; k--) {
    weeks.push({ start: new Date(currentMonday - k * 7 * 86400000).toISOString().slice(0, 10), mi: 0 });
  }
  for (const a of acts) {
    const slot = weeks.find(w => w.start === mondayOf(a.start_date_local.slice(0, 10)));
    if (slot) slot.mi += (a.distance || 0) * M_TO_MI;
  }
  for (const w of weeks) w.mi = Math.round(w.mi * 10) / 10;

  const recent = acts.slice()
    .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))
    .slice(0, RECENT);
  const rides = [];
  for (const a of recent) {
    /* average_speed is usually present; derive it when it isn't */
    const mps = a.average_speed != null ? a.average_speed
      : (a.moving_time ? (a.distance || 0) / a.moving_time : 0);
    rides.push({
      date: a.start_date_local.slice(0, 10),
      name: String(a.name || 'Ride').slice(0, 80),
      mi: Math.round((a.distance || 0) * M_TO_MI * 10) / 10,
      ft: Math.round((a.total_elevation_gain || 0) * M_TO_FT),
      sec: a.moving_time || 0,
      mph: Math.round(mps * MPS_TO_MPH * 10) / 10,
      alt: await profile(a)
    });
  }

  return {
    updated: new Date().toISOString(),
    season: { rides: acts.length, mi: Math.round(mi), ft: Math.round(ft), sec: sec },
    weeks: weeks,
    rides: rides
  };
}

function getFeed(fresh) {
  const age = Date.now() - feedAt;
  if (feed && age < (fresh ? FRESH_MS : TTL_MS)) return Promise.resolve(feed);
  if (!building) {
    building = build().then(
      f => { feed = f; feedAt = Date.now(); building = null; return f; },
      e => { building = null; throw e; }
    );
  }
  return building;
}

/* a webhook event: forget what we know about the activity, then rebuild
   once the burst of events around an upload has settled */
let eventTimer = null;
function onEvents(events) {
  let touched = false;
  for (const ev of events) {
    if (!ev || !ev.type) continue;
    if (ev.type !== 'ACTIVITY_UPLOADED' && ev.type !== 'ACTIVITY_ANALYZED') continue;
    if (ev.activity_id) profileCache.delete(ev.activity_id);
    touched = true;
  }
  if (!touched) return;
  clearTimeout(eventTimer);
  eventTimer = setTimeout(() => {
    feedAt = 0;
    getFeed(false).catch(() => { /* next /feed will retry */ });
  }, EVENT_DELAY_MS);
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

  if (req.method === 'GET' && url.pathname === '/feed') {
    try {
      send(res, 200, await getFeed(url.searchParams.get('fresh') === '1'));
    } catch (e) {
      /* a stale feed beats an error page */
      if (feed) send(res, 200, feed);
      else send(res, 503, { error: 'intervals.icu unavailable' });
    }
    return;
  }

  /* Intervals.icu event push. The body's shared secret is what authorizes
     it; ack with 2xx or it retries with backoff. */
  if (req.method === 'POST' && WEBHOOK_SECRET && url.pathname === '/webhook') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 65536) req.destroy(); });
    req.on('end', () => {
      let msg = null;
      try { msg = JSON.parse(body); } catch (e) {}
      if (!msg || msg.secret !== WEBHOOK_SECRET) { send(res, 403, null); return; }
      send(res, 200, {});
      if (Array.isArray(msg.events)) onEvents(msg.events);
    });
    return;
  }

  send(res, 404, null);
});

server.listen(process.env.PORT || 8080);
