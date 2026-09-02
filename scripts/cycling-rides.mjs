/* Pulls the season's rides from Intervals.icu into assets/data/cycling/ for
   the cycling page, and bakes the current numbers into cycling/index.html.

     feed.json          season totals, miles per Monday-week, and every ride
                        of the season with an elevation sparkline
     rides/<id>.json    what the page shows when a ride is opened: the
                        distance / altitude / speed / heart-rate / power
                        streams (downsampled), mile splits, climbs, best
                        efforts, time in zones and laps

   Detail files are cached: a ride is fetched again only when Intervals.icu
   re-analyzes it or its headline numbers change, so an hourly run normally
   costs one API call. Rides that drop out of the season are pruned. No GPS
   coordinates are stored — only aggregates and curves.

   Run by .github/workflows/cycling-rides.yml. Needs INTERVALS_API_KEY (repo
   secret; Intervals.icu → Settings → Developer Settings). Optional:
   INTERVALS_ATHLETE_ID (default 0 = the key's owner), SEASON_START
   (YYYY-MM-DD, default January 1 of the current year), RIDE_TYPES (default
   Ride,GravelRide,MountainBikeRide — add EBikeRide or VirtualRide if rides
   are missing from the page), INTERVALS_API (base URL, for testing). */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const R = createRequire(import.meta.url)("../assets/js/cycling-render.js");

const API = (process.env.INTERVALS_API || "https://intervals.icu/api/v1").replace(/\/+$/, "");
const KEY = process.env.INTERVALS_API_KEY || "";
const ATHLETE = process.env.INTERVALS_ATHLETE_ID || "0";
const RIDE_TYPES = (process.env.RIDE_TYPES || "Ride,GravelRide,MountainBikeRide")
  .split(",").map((s) => s.trim()).filter(Boolean);

const DATA_DIR = "assets/data/cycling";
const RIDES_DIR = path.join(DATA_DIR, "rides");
const FEED = path.join(DATA_DIR, "feed.json");
const PAGE = "cycling/index.html";
export const RECENT = 8;          /* rides baked into the page; the page offers the rest */
const WEEKS = 12;                 /* weekly-miles chart span */
const SPARK_PTS = 100;            /* points per elevation sparkline */
const CHART_PTS = 480;            /* points per detail-chart stream */
const DETAIL_VERSION = 1;         /* bump to rebuild every rides/<id>.json */
const STREAM_TYPES = ["time", "distance", "altitude", "velocity_smooth", "heartrate",
  "watts", "cadence", "grade_smooth", "temp"];
const PEAK_SECS = [5, 60, 300, 1200, 3600];
const M_TO_MI = 0.000621371, M_TO_FT = 3.28084, MPS_TO_MPH = 2.23694, MI_M = 1609.344;

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const cToF = (c) => Math.round(c * 9 / 5 + 32);

/* drop null/undefined object fields; arrays keep their nulls (gaps matter) */
function strip(o) {
  if (Array.isArray(o)) return o;
  if (o && typeof o === "object") {
    const out = {};
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v == null) continue;
      out[k] = strip(v);
    }
    return out;
  }
  return o;
}

/* ---------- Intervals.icu ---------- */
const AUTH = "Basic " + Buffer.from("API_KEY:" + KEY).toString("base64");

async function api(p) {
  let lastErr;
  for (const backoff of [0, 3000, 15000, 45000]) {
    if (backoff) await sleep(backoff);
    let r;
    try {
      r = await fetch(API + p, { headers: { Authorization: AUTH } });
    } catch (err) {
      lastErr = err;
      continue;
    }
    if (r.ok) return r.json();
    lastErr = new Error(`intervals.icu ${r.status} on ${p.split("?")[0]}`);
    if (r.status === 401 || r.status === 403) {
      throw new Error(`${lastErr.message} — is INTERVALS_API_KEY a valid Intervals.icu API key?`);
    }
    if (r.status === 404) throw lastErr;
  }
  throw lastErr;
}

function todayPacific() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
function seasonStart() {
  return process.env.SEASON_START || todayPacific().slice(0, 4) + "-01-01";
}
function addDays(ymd, n) {
  return new Date(Date.parse(ymd) + n * 86400000).toISOString().slice(0, 10);
}
/* YYYY-MM-DD of the Monday of the week containing the given local date */
function mondayOf(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - dow * 86400000).toISOString().slice(0, 10);
}

/* every outdoor ride of the season, newest first, in one call */
async function seasonRides() {
  const list = await api(`/athlete/${ATHLETE}/activities?oldest=${seasonStart()}&newest=${addDays(todayPacific(), 2)}`);
  if (!Array.isArray(list)) throw new Error("activities: unexpected response");
  const seen = new Set(), out = [];
  for (const a of list) {
    if (!a || a.id == null || !a.start_date_local) continue;
    if (!RIDE_TYPES.includes(a.type) || a.trainer) continue;
    /* the same ride uploaded twice (two apps syncing) is one ride */
    const key = `${a.start_date_local.slice(0, 16)}|${Math.round(a.distance || 0)}|${a.moving_time || 0}`;
    if (seen.has(key)) {
      console.log(`  skipping duplicate upload ${a.id} (${a.name})`);
      continue;
    }
    seen.add(key);
    out.push(a);
  }
  out.sort((x, y) => y.start_date_local.localeCompare(x.start_date_local));
  return out;
}

/* ---------- streams ---------- */
/* the streams response has been served both as an array of {type,data} and
   as an object keyed by stream name, so accept either */
function streamData(payload, name) {
  if (Array.isArray(payload)) {
    const s = payload.find((x) => x && (x.type === name || x.name === name));
    return s ? (s.data || s.values || null) : null;
  }
  if (payload && payload[name]) return payload[name].data || payload[name];
  return null;
}
function series(arr, n) {            /* numeric-or-null of the right length, else null */
  if (!Array.isArray(arr) || arr.length !== n) return null;
  const out = arr.map(num);
  return out.some((v) => v != null) ? out : null;
}
function fill(arr) {                 /* carry the last value across gaps */
  let last = 0;
  return arr.map((v) => (v == null ? last : (last = v)));
}
function smooth(arr, k) {            /* centered moving average, gap-aware */
  const n = arr.length, half = Math.floor(k / 2), out = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      if (arr[j] != null) { s += arr[j]; c++; }
    }
    out[i] = c ? s / c : null;
  }
  return out;
}

async function fetchStreams(id) {
  const payload = await api(`/activity/${id}/streams.json?types=${STREAM_TYPES.join(",")}`);
  const rawDist = streamData(payload, "distance");
  if (!Array.isArray(rawDist) || rawDist.length < 3) return null;
  const n = rawDist.length;
  const dist = fill(rawDist.map(num));
  for (let i = 1; i < n; i++) if (dist[i] < dist[i - 1]) dist[i] = dist[i - 1];
  let time = series(streamData(payload, "time"), n);
  time = time ? fill(time) : dist.map((_, i) => i);
  const altRaw = series(streamData(payload, "altitude"), n);
  const vel = series(streamData(payload, "velocity_smooth"), n);
  const w = series(streamData(payload, "watts"), n);
  const S = {
    n, dist, time,
    altS: altRaw ? smooth(fill(altRaw), 7) : null,
    hr: series(streamData(payload, "heartrate"), n),
    cad: series(streamData(payload, "cadence"), n),
    grade: series(streamData(payload, "grade_smooth"), n),
    temp: series(streamData(payload, "temp"), n),
    w, wS: w ? smooth(w, 5) : null,
    dt: new Array(n).fill(0), spd: new Array(n).fill(0),
  };
  for (let i = 1; i < n; i++) {
    const gap = time[i] - time[i - 1];
    S.dt[i] = Math.min(Math.max(gap, 0), 10);     /* a pause counts for at most 10 s */
    const v = vel && vel[i] != null ? vel[i] : (dist[i] - dist[i - 1]) / Math.max(gap, 1);
    S.spd[i] = Math.min(Math.max(v, 0), 30);      /* 30 m/s: anything faster is a GPS jump */
  }
  S.spdS = smooth(S.spd, 5);
  S.moving = S.spd.map((v) => v > 0.5);
  return S;
}

/* altitude resampled evenly by distance, for the card sparkline */
function sparkline(S) {
  if (!S.altS) return null;
  const total = S.dist[S.n - 1] || 1, out = [];
  let j = 0;
  for (let i = 0; i < SPARK_PTS; i++) {
    const target = total * i / (SPARK_PTS - 1);
    while (j < S.n - 1 && S.dist[j] < target) j++;
    out.push(r1(S.altS[j] * M_TO_FT));
  }
  return out;
}

/* the detail charts: every stream at CHART_PTS points, aligned by index */
function downsample(S) {
  const idx = [];
  const step = Math.max(1, Math.ceil((S.n - 1) / (CHART_PTS - 1)));
  for (let i = 0; i < S.n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== S.n - 1) idx.push(S.n - 1);
  const pick = (arr, f) => (arr ? idx.map((i) => (arr[i] == null ? null : f(arr[i]))) : null);
  return strip({
    mi: idx.map((i) => r2(S.dist[i] * M_TO_MI)),
    sec: idx.map((i) => Math.round(S.time[i] - S.time[0])),
    ft: S.altS ? idx.map((i) => Math.round(S.altS[i] * M_TO_FT)) : null,
    mph: idx.map((i) => r1(S.spdS[i] * MPS_TO_MPH)),
    hr: pick(S.hr, Math.round),
    w: pick(S.wS, Math.round),
    cad: pick(S.cad, Math.round),
    grade: pick(S.grade, r1),
    temp_f: pick(S.temp, cToF),
  });
}

/* per-mile: moving time, speed, climb/descent, average HR and power. Gains
   come from the smoothed altitude with a 2 m threshold and are then scaled
   so the splits add up to the ride's own elevation figure. */
function mileSplits(S, totalGainM) {
  const TH = 2, out = [];
  const fresh = (i) => ({ i0: i, sec: 0, gain: 0, loss: 0, hrS: 0, hrT: 0, wS: 0, wT: 0, ref: S.altS ? S.altS[i] : 0 });
  let cur = fresh(0), next = MI_M, mile = 1;
  for (let i = 1; i < S.n; i++) {
    const dt = S.dt[i];
    if (S.moving[i]) cur.sec += dt;
    if (S.altS) {
      const diff = S.altS[i] - cur.ref;
      if (diff >= TH) { cur.gain += diff; cur.ref = S.altS[i]; }
      else if (diff <= -TH) { cur.loss -= diff; cur.ref = S.altS[i]; }
    }
    if (S.hr && S.hr[i] != null) { cur.hrS += S.hr[i] * dt; cur.hrT += dt; }
    if (S.w && S.w[i] != null) { cur.wS += S.w[i] * dt; cur.wT += dt; }
    const last = i === S.n - 1;
    if (S.dist[i] >= next || last) {
      const len = (S.dist[i] - S.dist[cur.i0]) * M_TO_MI;
      if (len > 0.05) {
        out.push({
          mile, len: r2(len), sec: Math.round(cur.sec),
          mph: cur.sec > 0 ? r1(len / (cur.sec / 3600)) : null,
          up: cur.gain, down: cur.loss,
          hr: cur.hrT ? Math.round(cur.hrS / cur.hrT) : null,
          w: cur.wT ? Math.round(cur.wS / cur.wT) : null,
        });
      }
      if (last) break;
      cur = fresh(i);
      mile++;
      next += MI_M;
    }
  }
  const sumUp = out.reduce((s, x) => s + x.up, 0);
  let scale = 1;
  if (sumUp > 0 && totalGainM > 0) scale = Math.min(Math.max(totalGainM / sumUp, 0.5), 2);
  return out.map((x) => strip({ ...x, up: Math.round(x.up * scale * M_TO_FT), down: Math.round(x.down * scale * M_TO_FT) }));
}

/* climbs of at least ~100 ft: a rise is one climb until the road drops more
   than 8 m (or a fifth of what it has gained) below its high point. The
   foot is the low point of the run-up, then any flat approach is walked off. */
function climbs(S) {
  if (!S.altS) return null;
  const A = S.altS, D = S.dist, n = S.n, MIN_GAIN = 30, found = [];
  function consider(s, p) {
    let lo = s;
    for (let k = s; k <= p; k++) if (A[k] < A[lo]) lo = k;
    let st = lo;
    while (st < p) {
      let k = st;
      while (k < p && D[k] - D[st] < 150) k++;
      if (k >= p) break;
      if ((A[k] - A[st]) / Math.max(D[k] - D[st], 1) >= 0.015) break;
      st = k;
    }
    const gain = A[p] - A[st], len = D[p] - D[st];
    if (gain < MIN_GAIN || len <= 0) return;
    if (gain / len < 0.02 && gain < 90) return;
    found.push({ s: st, p });
  }
  let s = 0, p = 0;
  for (let j = 1; j < n; j++) {
    if (A[j] > A[p]) p = j;
    const gain = A[p] - A[s], dip = A[p] - A[j];
    if (dip > Math.max(8, 0.2 * gain)) {
      if (gain >= MIN_GAIN) consider(s, p);
      s = j; p = j;
    } else if (A[j] < A[s]) {
      s = j; p = j;
    }
  }
  if (A[p] - A[s] >= MIN_GAIN) consider(s, p);

  const out = found.map(({ s, p }) => {
    const gainM = A[p] - A[s], lenM = D[p] - D[s];
    let sec = 0, hrS = 0, hrT = 0, wS = 0, wT = 0, maxG = 0;
    for (let k = s + 1; k <= p; k++) {
      const dt = S.dt[k];
      if (S.moving[k]) sec += dt;
      if (S.hr && S.hr[k] != null) { hrS += S.hr[k] * dt; hrT += dt; }
      if (S.w && S.w[k] != null) { wS += S.w[k] * dt; wT += dt; }
    }
    for (let k = s, m = s; k <= p; k++) {          /* steepest 100 m */
      while (m < p && D[m] - D[k] < 100) m++;
      if (D[m] - D[k] >= 60) maxG = Math.max(maxG, (A[m] - A[k]) / (D[m] - D[k]));
    }
    return strip({
      start_mi: r2(D[s] * M_TO_MI), len_mi: r2(lenM * M_TO_MI),
      gain_ft: Math.round(gainM * M_TO_FT), grade: r1(gainM / lenM * 100),
      max_grade: r1(Math.min(maxG, 0.35) * 100), sec: Math.round(sec),
      fph: sec > 0 ? Math.round(gainM * M_TO_FT / (sec / 3600)) : null,
      hr: hrT ? Math.round(hrS / hrT) : null, w: wT ? Math.round(wS / wT) : null,
    });
  });
  if (!out.length) return null;
  out.sort((a, b) => b.gain_ft - a.gain_ft);
  return out.slice(0, 6).sort((a, b) => a.start_mi - b.start_mi);
}

/* best time-weighted averages over fixed durations (a pause counts 10 s) */
function peaks(S) {
  const run = (vals, secsList, conv, dec) => {
    const n = S.n, T = new Float64Array(n), TV = new Float64Array(n), V = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const v = vals[i];
      T[i] = T[i - 1] + S.dt[i];
      TV[i] = TV[i - 1] + (v != null ? S.dt[i] : 0);
      V[i] = V[i - 1] + (v != null ? v * S.dt[i] : 0);
    }
    const res = [];
    for (const D of secsList) {
      if (T[n - 1] < D) continue;
      let best = -Infinity, i = 0;
      for (let j = 1; j < n; j++) {
        while (i + 1 < j && T[j] - T[i + 1] >= D) i++;
        if (T[j] - T[i] < D) continue;
        const tv = TV[j] - TV[i];
        if (tv < 0.8 * D) continue;
        const avg = (V[j] - V[i]) / tv;
        if (avg > best) best = avg;
      }
      if (best > -Infinity) res.push({ sec: D, v: dec ? r1(best * conv) : Math.round(best * conv) });
    }
    return res.length ? res : null;
  };
  const minute = PEAK_SECS.filter((s) => s >= 60);
  return strip({
    mph: run(S.spd, minute, MPS_TO_MPH, true),
    hr: S.hr ? run(S.hr, minute, 1, false) : null,
    w: S.w ? run(S.w, PEAK_SECS, 1, false) : null,
  });
}

/* ---------- from the activity record ---------- */
function stats(a) {
  const mps = num(a.average_speed) ?? (a.moving_time ? (a.distance || 0) / a.moving_time : null);
  const power = !!a.device_watts;
  const s = {
    mi: r1((a.distance || 0) * M_TO_MI),
    ft: Math.round((a.total_elevation_gain || 0) * M_TO_FT),
    ft_down: num(a.total_elevation_loss) != null ? Math.round(a.total_elevation_loss * M_TO_FT) : null,
    moving: num(a.moving_time), elapsed: num(a.elapsed_time), coasting: num(a.coasting_time),
    mph: mps != null ? r1(mps * MPS_TO_MPH) : null,
    max_mph: num(a.max_speed) != null ? r1(a.max_speed * MPS_TO_MPH) : null,
    avg_hr: num(a.average_heartrate), max_hr: num(a.max_heartrate),
    avg_w: power ? num(a.icu_average_watts) : null,
    np: power ? num(a.icu_weighted_avg_watts) : null,
    kj: power && num(a.icu_joules) != null ? Math.round(a.icu_joules / 1000) : null,
    intensity: power ? num(a.icu_intensity) : null,
    ftp: power ? num(a.icu_ftp) : null,
    vi: power ? num(a.icu_variability_index) : null,
    ef: power ? num(a.icu_efficiency_factor) : null,
    decoupling: num(a.decoupling),
    load: num(a.icu_training_load),
    avg_cad: num(a.average_cadence), cal: num(a.calories),
    temp_f: num(a.average_temp) != null ? cToF(a.average_temp) : null,
    min_ft: num(a.min_altitude) != null ? Math.round(a.min_altitude * M_TO_FT) : null,
    max_ft: num(a.max_altitude) != null ? Math.round(a.max_altitude * M_TO_FT) : null,
    lthr: num(a.lthr), rpe: num(a.icu_rpe), feel: num(a.feel),
  };
  if (a.has_weather) {
    s.wx = {
      temp_f: num(a.average_weather_temp) != null ? cToF(a.average_weather_temp) : null,
      wind_mph: num(a.average_wind_speed) != null ? r1(a.average_wind_speed * MPS_TO_MPH) : null,
      gust_mph: num(a.average_wind_gust) != null ? r1(a.average_wind_gust * MPS_TO_MPH) : null,
      wind_deg: num(a.prevailing_wind_deg),
      headwind_pct: num(a.headwind_percent), tailwind_pct: num(a.tailwind_percent),
    };
  }
  return strip(s);
}

function zones(a) {
  const z = {};
  if (Array.isArray(a.icu_hr_zone_times) && a.icu_hr_zone_times.some((s) => s > 0)) {
    z.hr = {
      secs: a.icu_hr_zone_times.map((s) => Math.round(s || 0)),
      bounds: Array.isArray(a.icu_hr_zones) ? a.icu_hr_zones : null,
      lthr: num(a.lthr), max: num(a.athlete_max_hr),
    };
  }
  if (a.device_watts && Array.isArray(a.icu_zone_times) && a.icu_zone_times.length) {
    z.power = {
      secs: a.icu_zone_times.map((t) => Math.round((t && t.secs) || 0)),
      ids: a.icu_zone_times.map((t) => (t && t.id) || ""),
      bounds: Array.isArray(a.icu_power_zones) ? a.icu_power_zones : null,
      ftp: num(a.icu_ftp),
    };
  }
  return Object.keys(z).length ? z : null;
}

const titleCase = (s) => String(s).toLowerCase().replace(/(^|_)(\w)/g, (m, p, c) => (p ? " " : "") + c.toUpperCase());
function needsLaps(a) {
  return (a.icu_lap_count || 0) > 1 || !!a.icu_intervals_edited || !!a.device_watts;
}
async function fetchLaps(id) {
  const dto = await api(`/activity/${id}/intervals`);
  const list = Array.isArray(dto && dto.icu_intervals) ? dto.icu_intervals : [];
  if (list.length < 2) return null;
  return list.slice(0, 80).map((iv, k) => strip({
    label: String(iv.label || `${iv.type ? titleCase(iv.type) : "Lap"} ${k + 1}`).slice(0, 40),
    type: iv.type || null,
    mi: num(iv.distance) != null ? r2(iv.distance * M_TO_MI) : null,
    sec: num(iv.moving_time) ?? num(iv.elapsed_time),
    mph: num(iv.average_speed) != null ? r1(iv.average_speed * MPS_TO_MPH) : null,
    ft: num(iv.total_elevation_gain) != null ? Math.round(iv.total_elevation_gain * M_TO_FT) : null,
    grade: num(iv.average_gradient),
    hr: num(iv.average_heartrate), max_hr: num(iv.max_heartrate),
    w: num(iv.average_watts), np: num(iv.weighted_average_watts), cad: num(iv.average_cadence),
  }));
}

/* ---------- assembly ---------- */
const safeId = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, "_");
const detailPath = (id) => path.join(RIDES_DIR, safeId(id) + ".json");
const signature = (a) => `${a.analyzed || a.icu_sync_date || ""}|${Math.round(a.distance || 0)}|` +
  `${a.moving_time || 0}|${Math.round(a.total_elevation_gain || 0)}|${a.name || ""}`;

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; }
}
function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj) + "\n");
}

async function buildDetail(a, sig) {
  const d = {
    v: DETAIL_VERSION, sig, id: a.id,
    name: String(a.name || "Ride").slice(0, 80),
    date: a.start_date_local.slice(0, 10), start: a.start_date_local,
    type: a.type, device: a.device_name || null, source: a.source || null,
    stats: stats(a), zones: zones(a),
  };
  let S = null;
  try {
    S = await fetchStreams(a.id);
  } catch (err) {
    console.log(`  no streams for ${a.id}: ${err.message}`);
  }
  if (S) {
    d.spark = sparkline(S);
    d.streams = downsample(S);
    d.splits = mileSplits(S, a.total_elevation_gain || 0);
    d.climbs = climbs(S);
    d.peaks = peaks(S);
  }
  if (needsLaps(a)) {
    try {
      d.laps = await fetchLaps(a.id);
    } catch (err) {
      console.log(`  no intervals for ${a.id}: ${err.message}`);
    }
  }
  return strip(d);
}

function feedRide(a, d) {
  const mps = num(a.average_speed) ?? (a.moving_time ? (a.distance || 0) / a.moving_time : 0);
  return strip({
    id: a.id,
    date: a.start_date_local.slice(0, 10),
    name: String(a.name || "Ride").slice(0, 80),
    mi: r1((a.distance || 0) * M_TO_MI),
    ft: Math.round((a.total_elevation_gain || 0) * M_TO_FT),
    sec: a.moving_time || 0,
    mph: r1(mps * MPS_TO_MPH),
    hr: num(a.average_heartrate) != null ? Math.round(a.average_heartrate) : null,
    w: a.device_watts ? num(a.icu_average_watts) : null,
    load: num(a.icu_training_load),
    alt: d.spark || null,
  });
}

/* the no-JS/SEO fallback: the same markup the page renders, between the
   cycling:* markers in cycling/index.html */
export function bakePage(html, feed) {
  const put = (key, inner) => {
    const re = new RegExp(`(<!-- cycling:${key} -->)[\\s\\S]*?(<!-- /cycling:${key} -->)`);
    if (!re.test(html)) throw new Error(`${PAGE} is missing the cycling:${key} markers`);
    html = html.replace(re, (m, open, close) => `${open}\n${inner}\n${close}`);
  };
  put("season", R.seasonHTML(feed.season));
  put("weeks", R.weeksSVG(feed.weeks));
  put("rides", R.rideListHTML(feed.rides, RECENT));
  put("updated", R.updatedText(feed.updated));
  return html;
}

async function main() {
  if (!KEY) {
    console.error("::error::INTERVALS_API_KEY is not set. Generate a personal API key in " +
      "Intervals.icu (Settings → Developer Settings) and add it as a repository secret " +
      "named INTERVALS_API_KEY.");
    process.exit(1);
  }
  const acts = await seasonRides();
  console.log(`${acts.length} rides since ${seasonStart()}`);
  fs.mkdirSync(RIDES_DIR, { recursive: true });

  const rides = [], keep = new Set();
  let fetched = 0, reused = 0;
  for (const a of acts) {
    const p = detailPath(a.id), sig = signature(a);
    keep.add(path.basename(p));
    let d = readJSON(p);
    if (!d || d.v !== DETAIL_VERSION || d.sig !== sig) {
      console.log(`fetching ${a.id}: ${a.start_date_local.slice(0, 10)} ${a.name}`);
      d = await buildDetail(a, sig);
      writeJSON(p, d);
      fetched++;
      await sleep(150);
    } else {
      reused++;
    }
    rides.push(feedRide(a, d));
  }
  let pruned = 0;
  for (const f of fs.readdirSync(RIDES_DIR)) {
    if (f.endsWith(".json") && !keep.has(f)) {
      fs.unlinkSync(path.join(RIDES_DIR, f));
      pruned++;
    }
  }

  let mi = 0, ft = 0, sec = 0;
  for (const a of acts) {
    mi += (a.distance || 0) * M_TO_MI;
    ft += (a.total_elevation_gain || 0) * M_TO_FT;
    sec += a.moving_time || 0;
  }
  const currentMonday = Date.parse(mondayOf(todayPacific()));
  const weeks = [];
  for (let k = WEEKS - 1; k >= 0; k--) {
    weeks.push({ start: new Date(currentMonday - k * 7 * 86400000).toISOString().slice(0, 10), mi: 0, ft: 0, rides: 0 });
  }
  for (const a of acts) {
    const slot = weeks.find((w) => w.start === mondayOf(a.start_date_local.slice(0, 10)));
    if (!slot) continue;
    slot.mi += (a.distance || 0) * M_TO_MI;
    slot.ft += (a.total_elevation_gain || 0) * M_TO_FT;
    slot.rides++;
  }
  for (const w of weeks) { w.mi = r1(w.mi); w.ft = Math.round(w.ft); }

  const feed = {
    updated: new Date().toISOString(),
    season_start: seasonStart(),
    season: { rides: acts.length, mi: Math.round(mi), ft: Math.round(ft), sec },
    weeks, rides,
  };
  /* "updated" means the data changed — an unchanged feed keeps its stamp so
     an idle hourly run has nothing to commit */
  const prev = readJSON(FEED);
  if (prev && JSON.stringify({ ...prev, updated: null }) === JSON.stringify({ ...feed, updated: null })) {
    feed.updated = prev.updated;
  }
  writeJSON(FEED, feed);

  const html = fs.readFileSync(PAGE, "utf8");
  const baked = bakePage(html, feed);
  if (baked !== html) fs.writeFileSync(PAGE, baked);

  console.log(`Wrote ${FEED}: ${feed.season.rides} rides, ${feed.season.mi} mi, ${feed.season.ft} ft; ` +
    `${fetched} ride file(s) fetched, ${reused} reused, ${pruned} pruned; page ${baked !== html ? "re-baked" : "unchanged"}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
