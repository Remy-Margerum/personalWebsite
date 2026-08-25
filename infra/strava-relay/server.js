/* Strava relay for remymargerum.com/cycling/
   Holds the Strava API credentials (env vars, never in this repo) and
   serves the cycling page a small, sanitized JSON feed: season totals,
   miles per week, and the last few rides with their elevation profiles.
   No GPS coordinates, route maps, or start locations ever leave the
   relay — only aggregates and altitude-vs-distance curves.

   /feed              → the feed, cached 15 minutes so page loads don't
                        touch Strava at all
   /feed?fresh=1      → allowed to rebuild early, but never more than
                        once every 2 minutes (handy for debugging)
   /webhook/<TOKEN>   → Strava's push subscription: the validation GET
                        echoes hub.challenge; activity POSTs bust the
                        cache and rebuild, so the page is current the
                        moment a ride finishes uploading. TOKEN is the
                        verify token, which keeps the URL unguessable.

   Env: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN
   (scope activity:read_all), STRAVA_VERIFY_TOKEN — see the README's
   setup steps. */
'use strict';
const http = require('http');

const CLIENT_ID = process.env.STRAVA_CLIENT_ID || '';
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET || '';
const VERIFY_TOKEN = process.env.STRAVA_VERIFY_TOKEN || '';
let refreshToken = process.env.STRAVA_REFRESH_TOKEN || '';

const RIDE_TYPES = ['Ride', 'GravelRide', 'MountainBikeRide'];
const TTL_MS = 15 * 60 * 1000;       /* normal cache life of the feed */
const FRESH_MS = 2 * 60 * 1000;      /* floor between ?fresh=1 rebuilds */
const EVENT_DELAY_MS =               /* settle time before a webhook rebuild,
                                        coalescing create/update bursts */
  +process.env.EVENT_DELAY_MS || 15 * 1000;
const RECENT = 8;                    /* rides shown on the page */
const WEEKS = 12;                    /* weekly-miles chart span */
const PROFILE_PTS = 124;             /* points per elevation sparkline */
const M_TO_MI = 0.000621371, M_TO_FT = 3.28084, MPS_TO_MPH = 2.23694;

let access = { token: '', expires: 0 };
let feed = null, feedAt = 0, building = null;
const profileCache = new Map();      /* activity id → altitude curve (ft) */

async function accessToken() {
  if (access.token && Date.now() < access.expires - 60000) return access.token;
  const r = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token', refresh_token: refreshToken
    })
  });
  if (!r.ok) throw new Error('token refresh failed: ' + r.status);
  const j = await r.json();
  access = { token: j.access_token, expires: (j.expires_at || 0) * 1000 };
  if (j.refresh_token) refreshToken = j.refresh_token;
  return access.token;
}

async function api(path) {
  const t = await accessToken();
  const r = await fetch('https://www.strava.com/api/v3' + path, {
    headers: { Authorization: 'Bearer ' + t }
  });
  if (!r.ok) throw new Error('strava ' + r.status + ' on ' + path.split('?')[0]);
  return r.json();
}

/* every outdoor ride since Jan 1 — one or two list calls a build */
async function ridesThisYear() {
  const after = Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000;
  let all = [];
  for (let page = 1; page <= 4; page++) {
    const batch = await api('/athlete/activities?per_page=200&after=' + after + '&page=' + page);
    all = all.concat(batch);
    if (batch.length < 200) break;
  }
  return all.filter(a => RIDE_TYPES.includes(a.sport_type) && !a.trainer);
}

/* altitude-vs-distance curve, resampled evenly and cached per activity —
   only rides that have never been seen cost a streams call */
async function profile(a) {
  if (profileCache.has(a.id)) return profileCache.get(a.id);
  let out = null;
  try {
    const s = await api('/activities/' + a.id +
      '/streams?keys=distance,altitude&key_by_type=true&resolution=medium');
    const dist = s.distance && s.distance.data, alt = s.altitude && s.altitude.data;
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
function todayPacific() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

async function build() {
  const acts = await ridesThisYear();

  let mi = 0, ft = 0, sec = 0;
  for (const a of acts) {
    mi += a.distance * M_TO_MI;
    ft += a.total_elevation_gain * M_TO_FT;
    sec += a.moving_time;
  }

  /* miles per Monday-start week, oldest → current */
  const currentMonday = Date.parse(mondayOf(todayPacific()));
  const weeks = [];
  for (let k = WEEKS - 1; k >= 0; k--) {
    weeks.push({ start: new Date(currentMonday - k * 7 * 86400000).toISOString().slice(0, 10), mi: 0 });
  }
  for (const a of acts) {
    const wk = mondayOf(a.start_date_local.slice(0, 10));
    const slot = weeks.find(w => w.start === wk);
    if (slot) slot.mi += a.distance * M_TO_MI;
  }
  for (const w of weeks) w.mi = Math.round(w.mi * 10) / 10;

  const recent = acts.slice()
    .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))
    .slice(0, RECENT);
  const rides = [];
  for (const a of recent) {
    rides.push({
      date: a.start_date_local.slice(0, 10),
      name: String(a.name || 'Ride').slice(0, 80),
      mi: Math.round(a.distance * M_TO_MI * 10) / 10,
      ft: Math.round(a.total_elevation_gain * M_TO_FT),
      sec: a.moving_time,
      mph: Math.round(a.average_speed * MPS_TO_MPH * 10) / 10,
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
function onActivityEvent(ev) {
  if (ev.aspect_type !== 'create') profileCache.delete(ev.object_id);
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
      'Access-Control-Allow-Methods': 'GET',
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
      else send(res, 503, { error: 'strava unavailable' });
    }
    return;
  }

  /* Strava's one-time subscription validation handshake */
  if (req.method === 'GET' && VERIFY_TOKEN && url.pathname === '/webhook/' + VERIFY_TOKEN) {
    if (url.searchParams.get('hub.verify_token') === VERIFY_TOKEN) {
      send(res, 200, { 'hub.challenge': url.searchParams.get('hub.challenge') || '' });
    } else send(res, 403, null);
    return;
  }

  /* Strava event push — must be acked within 2 s, so respond first and
     let the rebuild happen behind the timer */
  if (req.method === 'POST' && VERIFY_TOKEN && url.pathname === '/webhook/' + VERIFY_TOKEN) {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 65536) req.destroy(); });
    req.on('end', () => {
      send(res, 200, {});
      let ev = null;
      try { ev = JSON.parse(body); } catch (e) {}
      if (ev && ev.object_type === 'activity') onActivityEvent(ev);
    });
    return;
  }

  send(res, 404, null);
});

server.listen(process.env.PORT || 8080);
