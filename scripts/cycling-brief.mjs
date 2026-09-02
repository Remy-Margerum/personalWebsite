/* Weekly training note for /cycling/.
   Reads the season's rides from assets/data/cycling/feed.json (kept
   current by scripts/cycling-rides.mjs and its hourly workflow) and the
   week's riding weather from Open-Meteo, has Claude draft a short note on
   where training stands against the Ride Santa Barbara 100, and writes
   assets/data/cycling-brief.json for the page to display.
   Run by .github/workflows/cycling-brief.yml (Wednesday mornings).

   Requires ANTHROPIC_API_KEY (repo secret); exits cleanly without it. */
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const FEED = "assets/data/cycling/feed.json";
const OUT = "assets/data/cycling-brief.json";
/* Ride Santa Barbara 100 — the date the page counts down to. The note's
   job is the route decision: the flat-ish 100 km, or the same distance
   with the timed Gibraltar ascent in it. Figures from ridesb100.com. */
const EVENT = {
  name: "Ride Santa Barbara 100",
  date: "2026-10-17",
  routes: [
    { name: "100 KM Coastal", miles: 62, climb_ft: 4000, gibraltar: false },
    { name: "100 KM + Climb", miles: 62, climb_ft: 6600, gibraltar: true },
  ],
  gibraltar: "6.1 miles at about 8%, gaining 2,551 ft — the ride's only " +
    "competitively timed segment",
};
/* Santa Barbara, for the week's riding weather */
const HOME = { lat: 34.42, lon: -119.7 };

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
function daysBetween(aIso, bIso) {
  const p = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(bIso) - p(aIso)) / 86400000);
}
function fmtHM(sec) {
  const m = Math.floor(sec / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function getJson(url, headers = {}) {
  let lastErr;
  for (const backoff of [0, 5000, 20000]) {
    if (backoff) await sleep(backoff);
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return r.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function gather() {
  /* the ride feed is the whole point of the note — no feed, no brief */
  let feed = null;
  try {
    feed = JSON.parse(fs.readFileSync(FEED, "utf8"));
  } catch (err) {
    throw new Error(`${FEED} unreadable (${err.message}) — has the cycling-rides workflow run?`);
  }
  if (!feed || !feed.season || !Array.isArray(feed.weeks)) {
    throw new Error("ride feed missing season/weeks");
  }

  /* the week ahead: today (Wednesday) through next Tuesday */
  const days = [];
  for (let i = 0; i < 7; i++) days.push(laDate(i));

  let wx = null;
  try {
    wx = await getJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${HOME.lat}&longitude=${HOME.lon}` +
      `&timezone=America%2FLos_Angeles&forecast_days=8&wind_speed_unit=mph` +
      `&temperature_unit=fahrenheit&precipitation_unit=inch` +
      `&daily=temperature_2m_max,temperature_2m_min,wind_speed_10m_max,` +
      `wind_gusts_10m_max,precipitation_probability_max,sunrise,sunset`);
  } catch (e) {
    console.error("weather:", e.message); /* a note on training alone still beats none */
  }

  const forecast = [];
  if (wx?.daily) {
    days.forEach((day) => {
      const i = wx.daily.time.indexOf(day);
      if (i < 0) return;
      forecast.push({
        day: fmtDay(day),
        high_f: Math.round(wx.daily.temperature_2m_max[i]),
        low_f: Math.round(wx.daily.temperature_2m_min[i]),
        wind_mph: Math.round(wx.daily.wind_speed_10m_max[i]),
        gust_mph: Math.round(wx.daily.wind_gusts_10m_max[i]),
        rain_pct: wx.daily.precipitation_probability_max?.[i] ?? null,
        sunrise: wx.daily.sunrise?.[i]?.slice(11),
        sunset: wx.daily.sunset?.[i]?.slice(11),
      });
    });
  }

  return { feed, forecast, days };
}

async function main() {
  const { feed, forecast, days } = await gather();
  const today = laDate(0);
  const week = `${fmtDay(days[0])}–${fmtDay(days[6])}`;
  const toEvent = daysBetween(today, EVENT.date);

  /* last 6 weeks of volume is the useful trend; the whole season is noise */
  const recentWeeks = feed.weeks.slice(-6).map((w) => ({
    week_of: fmtDay(w.start), miles: w.mi,
  }));
  const rides = (feed.rides || []).slice(0, 6).map((r) => ({
    day: fmtDay(r.date), name: r.name, miles: r.mi,
    climb_ft: r.ft, time: fmtHM(r.sec), avg_mph: r.mph,
  }));

  console.log(`Week ${week}: ${recentWeeks.length} weeks of volume, ` +
    `${rides.length} recent rides, ${forecast.length} forecast days, ` +
    `${toEvent} days to the event.`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("ANTHROPIC_API_KEY not set — data gathered, skipping generation.");
    return;
  }

  const system =
    "You write the weekly training note for remymargerum.com/cycling — a personal training log " +
    "for one rider preparing for the Ride Santa Barbara 100. The rider trains on local loops: " +
    "the Mesa, More Mesa, Hope Ranch, Goleta Beach, Butterfly Beach, and the foothill climbs " +
    "behind town.\n\n" +
    "THE CENTRAL QUESTION, and the spine of every note you write: the rider is choosing between " +
    "two routes of the same distance — the 100 KM Coastal, and the 100 KM + Climb, which is the " +
    "same 62 miles with the timed Gibraltar ascent in it. Gibraltar is the whole difference: " +
    "about 2,600 ft of the route's extra climbing in one 6.1-mile, 8% push. So judge the training " +
    "on two axes, and say plainly where it stands on each: DISTANCE — do the weekly volume and " +
    "the longest single ride support 62 miles at all; and CLIMBING — does the elevation gain per " +
    "ride, and the biggest climb done so far, support Gibraltar on tired legs after 30+ miles. " +
    "Volume that supports the coastal route does not by itself support the climb. Name which " +
    "route the current training actually points to, and what would have to change in the weeks " +
    "left for the climb version to be the honest call.\n\n" +
    "Write the note for the week ahead from ONLY the data provided: 1) where training stands " +
    "against those two routes, reading the weekly mileage and climbing trend honestly — building, " +
    "flat, or dropped off — and what that means with the event this close; 2) what this week " +
    "should look like, using the forecast to say which days suit a long ride or a climbing day " +
    "and which suit a short spin, mentioning heat, wind or rain only when the numbers warrant it. " +
    "Address the rider as 'you'. Be direct and encouraging without flattery — if the training is " +
    "behind for the route in question, say so plainly and say what would help most. Never invent " +
    "numbers, ride names, routes, or events not in the data, and never give medical or injury " +
    "advice. Output format: first line is a headline under 70 characters (no quotes, no trailing " +
    "period); then a blank line; then the body, 110–170 words, plain prose, no headings or " +
    "bullet lists.";

  /* longest ride and biggest single climb are the two numbers the route
     decision actually turns on, so hand them over already computed */
  const allRides = feed.rides || [];
  const longest = allRides.reduce((a, r) => (r.mi > (a?.mi ?? -1) ? r : a), null);
  const steepest = allRides.reduce((a, r) => (r.ft > (a?.ft ?? -1) ? r : a), null);

  const user =
    `Week ahead: ${week} (note drafted ${fmtDay(today)}).\n` +
    `${EVENT.name} is ${EVENT.date} — ${toEvent} days out.\n\n` +
    `Route options being weighed:\n` +
    EVENT.routes.map((r) => ` - ${r.name}: ${r.miles} miles, about ${r.climb_ft} ft of climbing` +
      (r.gibraltar ? ` (includes Gibraltar — ${EVENT.gibraltar})` : "")).join("\n") + `\n\n` +
    (longest ? `Longest ride in the recent list: ${longest.mi} mi with ${longest.ft} ft climbed ` +
      `(${fmtDay(longest.date)}).\n` : "") +
    (steepest ? `Most climbing in a single recent ride: ${steepest.ft} ft over ${steepest.mi} mi ` +
      `(${fmtDay(steepest.date)}).\n\n` : "\n") +
    `Season to date: ${feed.season.rides} rides, ${feed.season.mi} miles, ` +
    `${feed.season.ft} ft climbed, ${fmtHM(feed.season.sec)} riding time.\n\n` +
    `Miles per week, oldest to newest (the last entry is the week in progress):\n` +
    `${JSON.stringify(recentWeeks, null, 1)}\n\n` +
    `Most recent rides:\n${JSON.stringify(rides, null, 1)}\n\n` +
    (forecast.length
      ? `Santa Barbara daily forecast for the week ahead:\n${JSON.stringify(forecast, null, 1)}`
      : `(No weather forecast available this week — write about training only.)`);

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
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("empty response");
  const nl = text.indexOf("\n");
  const headline = (nl > 0 ? text.slice(0, nl) : "").trim();
  const body = (nl > 0 ? text.slice(nl) : text).trim();

  fs.mkdirSync("assets/data", { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    generated: new Date().toISOString(),
    week,
    days_to_event: toEvent,
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
