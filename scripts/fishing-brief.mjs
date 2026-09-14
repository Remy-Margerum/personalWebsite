/* Daily bluefin brief for /fishing/ — today and tomorrow.
   Gathers the NWS coastal waters forecast and Open-Meteo wind/wave/SST
   model data for the chart's bluefin grounds (with the corners of the
   highlighted Santa Cruz–Anacapa triangle sampled, so the note can say
   where the temperature break lies inside it), has Claude draft a short
   bluefin call for today and tomorrow, and writes
   assets/data/fishing-brief.json for the page to display.
   Run by .github/workflows/fishing-brief.yml each morning.

   Requires ANTHROPIC_API_KEY (repo secret); exits cleanly without it. */
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const UA = { "User-Agent": "remymargerum.com fishing brief" };
const OUT = "assets/data/fishing-brief.json";

/* the chart's bluefin program, in the order the page lists it; the
   triangle is the highlighted zone, and its corners are sampled too */
const SPOTS = [
  { id: "harbor", name: "Santa Barbara Harbor", lat: 34.4, lon: -119.69 },
  { id: "tri", name: "Santa Cruz–Anacapa triangle, middle (bluefin A — the highlighted zone, ~37 nm)", lat: 33.807, lon: -119.49 },
  { id: "triW", name: "triangle west corner (south of Santa Cruz)", lat: 33.89, lon: -119.66, corner: true },
  { id: "triE", name: "triangle east corner (south of Anacapa)", lat: 33.89, lon: -119.32, corner: true },
  { id: "triS", name: "triangle south point (Santa Cruz Basin)", lat: 33.64, lon: -119.49, corner: true },
  { id: "flats", name: "Santa Rosa Flats (bluefin B, ~40 nm)", lat: 33.835, lon: -120.1 },
  { id: "osborn", name: "Osborn Bank SW flank (bluefin C, ~68 nm)", lat: 33.357, lon: -119.046 },
  { id: "sni", name: "San Nicolas Island (bluefin D, ~73 nm)", lat: 33.21, lon: -119.39 },
];

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
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow(iso)];
  return `${wd} ${m}/${d}`;
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
  /* today and tomorrow, Pacific time */
  const days = [laDate(0), laDate(1)];

  // NWS coastal waters forecast — full product text (synopsis + zones)
  let cwfText = "(NWS coastal waters forecast unavailable)";
  try {
    const cwf = await getJson(
      "https://api.weather.gov/products/types/CWF/locations/LOX/latest", UA);
    cwfText = cwf.productText || cwfText;
  } catch {}

  // Open-Meteo wind + marine (waves, SST) at the chart's key points
  const lats = SPOTS.map((s) => s.lat).join(",");
  const lons = SPOTS.map((s) => s.lon).join(",");
  const windP = getJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
    `&timezone=America%2FLos_Angeles&forecast_days=3` +
    `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn`);
  const marineP = getJson(
    `https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}` +
    `&timezone=America%2FLos_Angeles&forecast_days=3&cell_selection=sea` +
    `&hourly=wave_height,sea_surface_temperature&length_unit=imperial` +
    `&temperature_unit=fahrenheit&temporal_resolution=hourly_6`);
  /* either model source may be down — a brief from the rest still beats none */
  const [wind, marine] = await Promise.all([
    windP.catch((e) => (console.error("wind:", e.message), null)),
    marineP.catch((e) => (console.error("marine:", e.message), null)),
  ]);
  if (!wind && !marine && cwfText.startsWith("(")) {
    throw new Error("no forecast source reachable");
  }
  const windArr = wind ? (Array.isArray(wind) ? wind : [wind]) : [];
  const marArr = marine ? (Array.isArray(marine) ? marine : [marine]) : [];

  const compass = (deg) =>
    ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW",
     "WSW", "W", "WNW", "NW", "NNW"][Math.round(deg / 22.5) % 16];

  /* grounds: wind through the day, seas and SST at midday.
     triangle corners: SST only — they are there to place the break. */
  const table = [], corners = [];
  SPOTS.forEach((s, k) => {
    const wh = windArr[k]?.hourly, mh = marArr[k]?.hourly;
    days.forEach((day) => {
      const row = { spot: s.name, day: fmtDay(day) };
      if (mh) {
        const i = mh.time.indexOf(`${day}T12:00`);
        if (i >= 0) {
          if (!s.corner && mh.wave_height[i] != null) row.seas_ft = Math.round(mh.wave_height[i] * 10) / 10;
          if (mh.sea_surface_temperature[i] != null) {
            row.sst_f = Math.round(mh.sea_surface_temperature[i] * 10) / 10;
          }
        }
      }
      if (s.corner) { corners.push(row); return; }
      if (wh) {
        for (const hh of ["06:00", "09:00", "12:00", "15:00"]) {
          const i = wh.time.indexOf(`${day}T${hh}`);
          if (i >= 0 && wh.wind_speed_10m[i] != null) {
            row[`wind_${hh.slice(0, 2)}`] =
              `${Math.round(wh.wind_speed_10m[i])} kn ${compass(wh.wind_direction_10m[i])}` +
              (wh.wind_gusts_10m[i] != null ? ` g${Math.round(wh.wind_gusts_10m[i])}` : "");
          }
        }
      }
      table.push(row);
    });
  });

  return { days, cwfText, table, corners };
}

async function main() {
  const { days, cwfText, table, corners } = await gather();
  const window_ = `${fmtDay(days[0])}–${fmtDay(days[1])}`;
  console.log(`Bluefin ${window_}: ${table.length} forecast rows, ${corners.length} corner samples, ` +
    `CWF ${cwfText.length} chars.`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("ANTHROPIC_API_KEY not set — data gathered, skipping generation.");
    return;
  }

  const system =
    "You write the daily bluefin note for remymargerum.com/fishing — a private-boater's chart " +
    "of the Santa Barbara Channel and outer islands. The audience runs a small sportboat out of " +
    "Santa Barbara Harbor, and right now the program is one thing: Pacific bluefin tuna, today " +
    "and tomorrow. Write about bluefin only — no yellowtail, rockfish or halibut fallbacks.\n\n" +
    "The chart's bluefin grounds, in the order the page lists them: A) the Santa Cruz–Anacapa " +
    "triangle, the zone being worked right now, drawn shaded on the chart — Santa Cruz Basin " +
    "water behind (south of) Santa Cruz and Anacapa, starting just below the Footprint reserve's " +
    "southern line (the Footprint itself is no-take), about 37 nm to its middle; B) Santa Rosa " +
    "Flats, ~40 nm; C) Osborn Bank's SW flank, ~68 nm (the bank's crown is inside the Santa " +
    "Barbara Island no-take reserve); D) San Nicolas Island, ~73 nm. Bluefin set up on the " +
    "temperature break — the 64–68 °F band the chart draws as its black (64) and red (68) " +
    "isotherms — usually on the cool side of it, and they follow bait. The triangle's three " +
    "corners are sampled so you can say where inside the zone the break lies: compare the " +
    "corner temperatures and name the corner, or edge, where the 64–68 water sits, and say " +
    "whether the break is inside the triangle at all or has slid off toward one of the other " +
    "grounds.\n\n" +
    "Write the note for today and tomorrow from ONLY the forecast data provided: 1) the weather " +
    "and sea state in plain terms for each of the two days, leading with any small-craft " +
    "advisory or safety concern; 2) the bluefin call — which day is the day, where in the " +
    "triangle to start (which corner or edge, on which temperatures), and whether one of the " +
    "farther grounds is the better water and worth the run, or not; say plainly if neither day " +
    "is a bluefin day. Never invent numbers not in the data, and do not name grounds, reserves " +
    "or conditions that are not in it. Output format: first line is a headline under 70 " +
    "characters (no quotes, no trailing period); then a blank line; then the body, 120–190 " +
    "words, plain prose, no headings or bullet lists.";

  const user =
    `Days: ${window_} (today is ${fmtDay(days[0])}; note drafted this morning).\n\n` +
    `Point forecasts at the bluefin grounds (Open-Meteo; wind kn with gusts at 6/9/12/15h, ` +
    `seas ft at midday, SST °F at midday):\n${JSON.stringify(table, null, 1)}\n\n` +
    `SST °F at midday at the three corners of the highlighted triangle (to place the break):\n` +
    `${JSON.stringify(corners, null, 1)}\n\n` +
    `NWS Los Angeles/Oxnard coastal waters forecast (synopsis + zones; PZZ650 = channel, ` +
    `PZZ673 = outer waters incl. San Miguel/Santa Rosa):\n${cwfText}`;

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
    console.error("Model declined the request; keeping the previous brief.");
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
    window: window_,
    target: "bluefin",
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
