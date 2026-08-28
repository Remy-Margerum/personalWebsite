/* Weekly training note for /cycling/.
   Reads the season's rides and daily wellness straight from Intervals.icu —
   power, heart rate, cadence, training load, fitness/fatigue/form, resting
   HR, HRV and sleep — plus the week's Santa Barbara weather, and has Claude
   draft a note on which Ride Santa Barbara 100 route the training actually
   supports and what to do in the week ahead. Writes
   assets/data/cycling-brief.json. Run by .github/workflows/cycling-brief.yml.

   This talks to Intervals.icu directly rather than through the public relay
   on purpose: the rich metrics inform the prose but never land in the
   published JSON, so heart rate and power stay off the website.

   Requires INTERVALS_API_KEY and ANTHROPIC_API_KEY (repo secrets). */
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const API = "https://intervals.icu/api/v1";
const KEY = process.env.INTERVALS_API_KEY || "";
const ATHLETE = process.env.INTERVALS_ATHLETE_ID || "0";
const OUT = "assets/data/cycling-brief.json";
const RIDE_TYPES = (process.env.RIDE_TYPES || "Ride,GravelRide,MountainBikeRide")
  .split(",").map((s) => s.trim()).filter(Boolean);

/* Ride Santa Barbara 100 — figures from ridesb100.com */
const EVENT = {
  name: "Ride Santa Barbara 100",
  date: "2026-10-17",
  routes: [
    { name: "100 KM Coastal", miles: 62, climb_ft: 4000, gibraltar: false },
    { name: "100 KM + Climb", miles: 62, climb_ft: 6600, gibraltar: true },
  ],
  gibraltar: "6.1 miles at about 8%, gaining 2,551 ft — the ride's only " +
    "competitively timed segment, and a sustained 45–60 minute effort",
};
const HOME = { lat: 34.42, lon: -119.7 };
const M_TO_MI = 0.000621371, M_TO_FT = 3.28084, MPS_TO_MPH = 2.23694;

function laDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}
function dow(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function fmtDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow(iso)]} ${m}/${d}`;
}
function mondayOf(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 86400000)
    .toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  const p = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 86400000);
}
function fmtHM(sec) {
  const m = Math.floor(sec / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}
function round(n, p = 0) {
  return n == null || Number.isNaN(n) ? null : Math.round(n * 10 ** p) / 10 ** p;
}

/* Intervals.icu has renamed and aliased several of these over time and the
   docs disagree, so take the first alias that is actually present rather
   than betting the note on one spelling. */
function pick(obj, names) {
  for (const n of names) {
    if (obj && obj[n] != null && obj[n] !== "") return obj[n];
  }
  return null;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function api(path) {
  const auth = "Basic " + Buffer.from("API_KEY:" + KEY).toString("base64");
  let lastErr;
  for (const backoff of [0, 5000, 20000]) {
    if (backoff) await sleep(backoff);
    try {
      const r = await fetch(API + path, { headers: { Authorization: auth } });
      if (!r.ok) throw new Error(`${r.status} on ${path.split("?")[0]}`);
      return r.json();
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}
async function getJson(url) {
  let lastErr;
  for (const backoff of [0, 5000, 20000]) {
    if (backoff) await sleep(backoff);
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return r.json();
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

/* same rule as the relay: one ride can arrive twice by different paths */
function dedupe(acts) {
  const seen = new Set();
  return acts.filter((a) => {
    const key = [a.start_date_local.slice(0, 10), Math.round(a.distance || 0),
      a.moving_time || 0, Math.round(a.total_elevation_gain || 0)].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* what each ride actually says about fitness, not just how far it went */
function rideSummary(a) {
  const mps = a.average_speed != null ? a.average_speed
    : (a.moving_time ? (a.distance || 0) / a.moving_time : null);
  return {
    day: fmtDay(a.start_date_local.slice(0, 10)),
    name: String(a.name || "Ride").slice(0, 60),
    miles: round((a.distance || 0) * M_TO_MI, 1),
    climb_ft: round((a.total_elevation_gain || 0) * M_TO_FT),
    time: fmtHM(a.moving_time || 0),
    avg_mph: round(mps * MPS_TO_MPH, 1),
    avg_watts: round(pick(a, ["icu_average_watts", "average_watts"])),
    norm_watts: round(pick(a, ["icu_weighted_avg_watts", "weighted_average_watts"])),
    avg_hr: round(pick(a, ["average_heartrate", "icu_average_heartrate"])),
    max_hr: round(pick(a, ["max_heartrate", "icu_max_heartrate"])),
    avg_cadence: round(pick(a, ["average_cadence", "icu_average_cadence"])),
    training_load: round(pick(a, ["icu_training_load", "training_load"])),
    intensity: round(pick(a, ["icu_intensity", "intensity"]), 2),
    /* aerobic decoupling: HR drifting up as power holds = fading endurance */
    decoupling_pct: round(pick(a, ["icu_decoupling", "decoupling"]), 1),
    efficiency_factor: round(pick(a, ["icu_efficiency_factor", "efficiency_factor"]), 2),
  };
}

async function gather() {
  const today = laDate(0);
  const newest = laDate(2); /* pad for timezone skew */
  const seasonStart = process.env.SEASON_START || today.slice(0, 4) + "-01-01";

  const raw = await api(`/athlete/${ATHLETE}/activities` +
    `?oldest=${seasonStart}&newest=${newest}`);
  const all = Array.isArray(raw) ? raw : [];
  const rides = dedupe(all.filter((a) =>
    RIDE_TYPES.includes(a.type) && !a.trainer && !a.indoor));
  const dropped = all.filter((a) =>
    RIDE_TYPES.includes(a.type) && !a.trainer && !a.indoor).length - rides.length;
  if (dropped) console.log(`dropped ${dropped} duplicate activities`);
  if (!rides.length) throw new Error("no rides in range");

  /* last 6 weeks of daily wellness carries fitness, fatigue and recovery */
  let wellness = [];
  try {
    const w = await api(`/athlete/${ATHLETE}/wellness` +
      `?oldest=${laDate(-42)}&newest=${newest}`);
    wellness = Array.isArray(w) ? w : [];
  } catch (e) {
    console.error("wellness:", e.message); /* the note survives without it */
  }

  let weather = null;
  try {
    weather = await getJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${HOME.lat}&longitude=${HOME.lon}` +
      `&timezone=America%2FLos_Angeles&forecast_days=8&wind_speed_unit=mph` +
      `&temperature_unit=fahrenheit` +
      `&daily=temperature_2m_max,temperature_2m_min,wind_speed_10m_max,` +
      `precipitation_probability_max`);
  } catch (e) {
    console.error("weather:", e.message);
  }

  return { rides, wellness, weather, today };
}

function buildFacts({ rides, wellness, weather, today }) {
  const summaries = rides
    .slice()
    .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))
    .map(rideSummary);

  /* season totals */
  let mi = 0, ft = 0, sec = 0, load = 0;
  for (const a of rides) {
    mi += (a.distance || 0) * M_TO_MI;
    ft += (a.total_elevation_gain || 0) * M_TO_FT;
    sec += a.moving_time || 0;
    load += pick(a, ["icu_training_load", "training_load"]) || 0;
  }

  /* miles and climbing per Monday week, last 8 */
  const byWeek = new Map();
  for (const a of rides) {
    const k = mondayOf(a.start_date_local.slice(0, 10));
    const w = byWeek.get(k) || { week_of: fmtDay(k), miles: 0, climb_ft: 0, rides: 0, load: 0 };
    w.miles += (a.distance || 0) * M_TO_MI;
    w.climb_ft += (a.total_elevation_gain || 0) * M_TO_FT;
    w.load += pick(a, ["icu_training_load", "training_load"]) || 0;
    w.rides += 1;
    byWeek.set(k, w);
  }
  const weeks = [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-8).map(([, w]) => ({
      week_of: w.week_of, miles: round(w.miles, 1),
      climb_ft: round(w.climb_ft), rides: w.rides, load: round(w.load),
    }));

  /* the numbers the route decision turns on */
  const best = (fn) => summaries.reduce((a, r) => (fn(r) != null && (a == null || fn(r) > fn(a)) ? r : a), null);
  const longest = best((r) => r.miles);
  const steepest = best((r) => r.climb_ft);
  const hardest = best((r) => r.norm_watts);

  /* wellness: latest values plus how fitness has moved over six weeks */
  const wOf = (d) => ({
    date: d.id || d.date,
    ctl: round(pick(d, ["ctl", "ctlLoad", "icu_ctl"]), 1),
    atl: round(pick(d, ["atl", "atlLoad", "icu_atl"]), 1),
    ramp_rate: round(pick(d, ["rampRate", "ramp_rate"]), 1),
    resting_hr: round(pick(d, ["restingHR", "restingHr", "resting_hr"])),
    hrv: round(pick(d, ["hrv", "hrvSDNN"]), 1),
    sleep_hrs: (() => { const s = pick(d, ["sleepSecs", "sleep_secs"]); return s ? round(s / 3600, 1) : null; })(),
    weight_kg: round(pick(d, ["weight"]), 1),
  });
  const wRows = wellness.map(wOf).filter((r) => r.ctl != null || r.resting_hr != null || r.hrv != null);
  const latest = [...wRows].reverse().find((r) => r.ctl != null) || wRows[wRows.length - 1] || null;
  const form = latest && latest.ctl != null && latest.atl != null
    ? round(latest.ctl - latest.atl, 1) : null;
  const sixWeeksAgo = wRows.find((r) => r.ctl != null) || null;

  /* threshold power per kg is the single most decision-relevant number for a
     sustained 8% climb, when both halves are available */
  const ftp = rides.map((a) => pick(a, ["icu_ftp", "icu_eftp", "eftp", "ftp"]))
    .filter((v) => v != null).pop() || null;
  const weightKg = [...wRows].reverse().find((r) => r.weight_kg != null)?.weight_kg || null;
  const wPerKg = ftp && weightKg ? round(ftp / weightKg, 2) : null;

  /* say out loud which rich fields actually arrived, so a rename upstream
     shows up in the action log instead of silently thinning the note */
  const have = (k) => summaries.some((r) => r[k] != null);
  console.log("field coverage — " + ["avg_watts", "norm_watts", "avg_hr", "avg_cadence",
    "training_load", "intensity", "decoupling_pct"].map((k) => `${k}:${have(k) ? "yes" : "NO"}`).join(" ") +
    ` | wellness rows:${wRows.length} ctl:${latest?.ctl ?? "NO"} ftp:${ftp ?? "NO"} weight:${weightKg ?? "NO"}`);

  const days = [];
  for (let i = 0; i < 7; i++) days.push(laDate(i));
  const forecast = [];
  if (weather?.daily) {
    for (const day of days) {
      const i = weather.daily.time.indexOf(day);
      if (i < 0) continue;
      forecast.push({
        day: fmtDay(day),
        high_f: round(weather.daily.temperature_2m_max[i]),
        low_f: round(weather.daily.temperature_2m_min[i]),
        wind_mph: round(weather.daily.wind_speed_10m_max[i]),
        rain_pct: weather.daily.precipitation_probability_max?.[i] ?? null,
      });
    }
  }

  return {
    week: `${fmtDay(days[0])}–${fmtDay(days[6])}`,
    toEvent: daysBetween(today, EVENT.date),
    season: {
      rides: rides.length, miles: round(mi), climb_ft: round(ft),
      time: fmtHM(sec), training_load: round(load) || null,
    },
    weeks,
    recent: summaries.slice(0, 8),
    longest, steepest, hardest,
    fitness: latest ? {
      fitness_ctl: latest.ctl, fatigue_atl: latest.atl, form_tsb: form,
      ramp_rate: latest.ramp_rate,
      ctl_six_weeks_ago: sixWeeksAgo?.ctl ?? null,
      resting_hr: latest.resting_hr, hrv: latest.hrv,
      sleep_hrs: latest.sleep_hrs, weight_kg: weightKg,
      ftp_watts: ftp, w_per_kg: wPerKg,
    } : null,
    recovery_trend: wRows.slice(-10),
    forecast,
  };
}

async function main() {
  if (!KEY) throw new Error("INTERVALS_API_KEY not set");
  const facts = buildFacts(await gather());
  console.log(`Week ${facts.week}: ${facts.season.rides} rides, ` +
    `${facts.weeks.length} weeks, ${facts.forecast.length} forecast days, ` +
    `${facts.toEvent} days out.`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("ANTHROPIC_API_KEY not set — data gathered, skipping generation.");
    return;
  }

  const system =
    "You write the weekly training note for remymargerum.com/cycling — a personal training log " +
    "for one rider preparing for the Ride Santa Barbara 100. The rider trains on local loops: " +
    "the Mesa, More Mesa, Hope Ranch, Goleta Beach, Butterfly Beach, and the foothill climbs " +
    "behind town.\n\n" +
    "THE CENTRAL QUESTION, and the spine of every note: the rider is choosing between two routes " +
    "of the same distance — the 100 KM Coastal, and the 100 KM + Climb, which is the same 62 " +
    "miles with the timed Gibraltar ascent in it. Gibraltar is the whole difference: about " +
    "2,600 ft of the extra climbing in one 6.1-mile, 8% push, a sustained 45–60 minute effort. " +
    "Judge the training on both axes and say plainly where it stands on each. DISTANCE — do " +
    "weekly volume, the longest single ride, and fitness (CTL) support 62 miles. CLIMBING — do " +
    "the elevation per ride, the biggest climb so far, threshold power and watts per kilogram, " +
    "and the cadence and heart rate on the hilliest rides support Gibraltar on tired legs after " +
    "30+ miles. Volume that supports the coastal route does not by itself support the climb. " +
    "Name which route the current training actually points to.\n\n" +
    "USE THE PHYSIOLOGY, not just the mileage. Power (average and normalised), heart rate, " +
    "cadence, per-ride training load, intensity, aerobic decoupling, fitness (CTL), fatigue " +
    "(ATL), form (TSB = CTL − ATL), ramp rate, resting heart rate, HRV and sleep are all " +
    "provided when available. Read them: rising CTL with sane ramp rate is a build working; " +
    "form deeply negative with resting HR up or HRV down is accumulated fatigue; decoupling " +
    "climbing through a ride is endurance not yet built; low cadence on climbs is a specific, " +
    "fixable weakness for a sustained 8% grade. Any metric absent from the data simply does not " +
    "exist for this rider — never guess at it, and never mention that it is missing.\n\n" +
    "END WITH A PLAN. Every note must give concrete guidance for the week ahead: which days to " +
    "ride and roughly how far or how long, which day carries the long ride or the climbing " +
    "session, and which days are easy or fully off. Say explicitly when to rest and why the data " +
    "supports resting — if form and recovery markers say the rider is buried, the honest " +
    "recommendation is rest, and you should say so. Use the forecast to place the hard days " +
    "sensibly, mentioning heat, wind or rain only when the numbers warrant it.\n\n" +
    "Address the rider as 'you'. Be direct and encouraging without flattery — if the training is " +
    "behind for the route in question, say so plainly and say what would help most. Never invent " +
    "numbers, ride names, routes or events not in the data. Give training guidance only, never " +
    "medical, injury or nutritional advice; if the recovery markers look genuinely alarming, say " +
    "the data looks off and suggest easing back, not a diagnosis. Output format: first line is a " +
    "headline under 70 characters (no quotes, no trailing period); then a blank line; then the " +
    "body, 150–220 words, plain prose, no headings or bullet lists.";

  const user =
    `Week ahead: ${facts.week} (note drafted ${fmtDay(laDate(0))}).\n` +
    `${EVENT.name} is ${EVENT.date} — ${facts.toEvent} days out.\n\n` +
    `Route options being weighed:\n` +
    EVENT.routes.map((r) => ` - ${r.name}: ${r.miles} miles, about ${r.climb_ft} ft of climbing` +
      (r.gibraltar ? ` (includes Gibraltar — ${EVENT.gibraltar})` : "")).join("\n") + "\n\n" +
    `Season to date: ${JSON.stringify(facts.season)}\n\n` +
    `Per week (oldest first; the last is the week in progress):\n` +
    `${JSON.stringify(facts.weeks, null, 1)}\n\n` +
    `Recent rides, newest first:\n${JSON.stringify(facts.recent, null, 1)}\n\n` +
    `Longest ride: ${JSON.stringify(facts.longest)}\n` +
    `Most climbing in one ride: ${JSON.stringify(facts.steepest)}\n` +
    `Highest normalised power ride: ${JSON.stringify(facts.hardest)}\n\n` +
    (facts.fitness ? `Current fitness and recovery: ${JSON.stringify(facts.fitness)}\n` +
      `Recent daily wellness:\n${JSON.stringify(facts.recovery_trend, null, 1)}\n\n` : "") +
    (facts.forecast.length
      ? `Santa Barbara daily forecast for the week ahead:\n${JSON.stringify(facts.forecast, null, 1)}`
      : `(No weather forecast available — write about training only.)`);

  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: "claude-opus-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-06-01"],
    fallbacks: [{ model: "claude-opus-4-8" }],
    system,
    messages: [{ role: "user", content: user }],
  });

  if (response.stop_reason === "refusal") {
    console.error("Model declined the request; keeping the previous note.");
    return;
  }
  const text = response.content.filter((b) => b.type === "text")
    .map((b) => b.text).join("").trim();
  if (!text) throw new Error("empty response");
  const nl = text.indexOf("\n");
  const headline = (nl > 0 ? text.slice(0, nl) : "").trim();
  const body = (nl > 0 ? text.slice(nl) : text).trim();

  fs.mkdirSync("assets/data", { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    generated: new Date().toISOString(),
    week: facts.week,
    days_to_event: facts.toEvent,
    headline,
    body,
    model: response.model,
  }, null, 2) + "\n");
  console.log(`Wrote ${OUT}: ${headline}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
