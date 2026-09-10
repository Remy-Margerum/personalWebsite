/* Daily weekend-outlook brief for /fishing/.
   Gathers the NWS coastal waters forecast and Open-Meteo wind/wave/SST
   model data for the chart's grounds, has Claude draft a short brief for
   the coming weekend, and writes assets/data/fishing-brief.json for the
   page to display. Run by .github/workflows/fishing-brief.yml.

   Requires ANTHROPIC_API_KEY (repo secret); exits cleanly without it. */
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const UA = { "User-Agent": "remymargerum.com fishing brief" };
const OUT = "assets/data/fishing-brief.json";
/* Optional one-off override of the outlook window and focus, e.g.
   { "days": ["2026-09-14", "2026-09-15"], "focus": "bluefin" }.
   Honored until the last listed day has passed (Pacific time), then
   ignored — so the file can simply be deleted once the trip is over. */
const OVERRIDE = "scripts/fishing-brief-override.json";

const SPOTS = [
  { id: "harbor", name: "Santa Barbara Harbor", lat: 34.4, lon: -119.69 },
  { id: "flats", name: "Santa Rosa Flats (bluefin A / rockfish)", lat: 33.835, lon: -120.1 },
  { id: "backside", name: "Backside of Santa Cruz (yellowtail)", lat: 33.95, lon: -119.65 },
  { id: "osborn", name: "Osborn Bank SW flank (bluefin B / yellowtail)", lat: 33.357, lon: -119.046 },
  { id: "sni", name: "San Nicolas Island (bluefin C)", lat: 33.21, lon: -119.39 },
  { id: "goleta", name: "Goleta–Carpinteria flats (halibut)", lat: 34.4, lon: -119.75 },
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

// the coming weekend: the next Saturday (today, if it is Saturday) + Sunday;
// on a Sunday, cover today and next weekend's Saturday is too far — use today + next Sat? no:
// on Sunday the "coming weekend" is the one starting in 6 days.
function weekendDates() {
  const today = laDate(0);
  const wd = dow(today);
  const toSat = (6 - wd + 7) % 7; // 0 when today is Saturday
  const sat = laDate(toSat);
  const sun = laDate(toSat + 1);
  return [sat, sun];
}

function readOverride() {
  if (!fs.existsSync(OVERRIDE)) return null;
  let o;
  try {
    o = JSON.parse(fs.readFileSync(OVERRIDE, "utf8"));
  } catch (err) {
    console.error(`${OVERRIDE}: ${err.message} — ignoring.`);
    return null;
  }
  const days = (Array.isArray(o.days) ? o.days : [])
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!days.length) return null;
  if (laDate(0) > days[days.length - 1]) {
    console.log(`${OVERRIDE}: last day ${days[days.length - 1]} has passed — ignoring.`);
    return null;
  }
  return { days, focus: typeof o.focus === "string" ? o.focus : null };
}

const FOCUS = {
  bluefin:
    "This edition is a bluefin-tuna special: the reader is planning a dedicated bluefin " +
    "trip on the listed days. Make the whole brief about the bluefin call — which of the " +
    "three bluefin grounds has 64–68 °F water and a workable wind and sea window to get " +
    "there and back, which day is the better call, and whether the long run is worth it " +
    "at all. Mention other species only in a closing sentence, as a fallback if bluefin " +
    "is not reachable.",
};

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

async function gather(days) {
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
    `&timezone=America%2FLos_Angeles&forecast_days=8` +
    `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn`);
  const marineP = getJson(
    `https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}` +
    `&timezone=America%2FLos_Angeles&forecast_days=8&cell_selection=sea` +
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

  const table = [];
  SPOTS.forEach((s, k) => {
    const wh = windArr[k]?.hourly, mh = marArr[k]?.hourly;
    days.forEach((day) => {
      const row = { spot: s.name, day: fmtDay(day) };
      if (wh) {
        for (const hh of ["07:00", "12:00", "16:00"]) {
          const i = wh.time.indexOf(`${day}T${hh}`);
          if (i >= 0 && wh.wind_speed_10m[i] != null) {
            row[`wind_${hh.slice(0, 2)}`] =
              `${Math.round(wh.wind_speed_10m[i])} kn ${compass(wh.wind_direction_10m[i])}` +
              (wh.wind_gusts_10m[i] != null ? ` g${Math.round(wh.wind_gusts_10m[i])}` : "");
          }
        }
      }
      if (mh) {
        const i = mh.time.indexOf(`${day}T12:00`);
        if (i >= 0) {
          if (mh.wave_height[i] != null) row.seas_ft = Math.round(mh.wave_height[i] * 10) / 10;
          if (mh.sea_surface_temperature[i] != null) {
            row.sst_f = Math.round(mh.sea_surface_temperature[i] * 10) / 10;
          }
        }
      }
      table.push(row);
    });
  });

  return { cwfText, table };
}

async function main() {
  const override = readOverride();
  const days = override ? override.days : weekendDates();
  const label = !override ? "Weekend outlook"
    : override.focus === "bluefin" ? "Bluefin outlook" : "Outlook";
  const { cwfText, table } = await gather(days);
  const weekend = `${fmtDay(days[0])}–${fmtDay(days[days.length - 1])}`;
  console.log(`${label} ${weekend}: ${table.length} forecast rows, ` +
    `CWF ${cwfText.length} chars.`);
  const covered = table.filter((r) => Object.keys(r).length > 2).length;
  if (!covered) {
    /* the point models reach 8 days out — an override farther than that
       (or a stale one) would have Claude writing from the NWS text alone */
    throw new Error(`no point-forecast data covers ${weekend}`);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("ANTHROPIC_API_KEY not set — data gathered, skipping generation.");
    return;
  }

  const system =
    "You write the daily 'weekend outlook' for remymargerum.com/fishing — a private-boater's " +
    "chart of the Santa Barbara Channel and outer islands. The audience runs a small sportboat " +
    "out of Santa Barbara Harbor. The chart's target programs and their grounds: bluefin tuna " +
    "on the 64–68 °F temperature break (Santa Rosa Flats ~40 nm, Osborn Bank SW flank ~68 nm, " +
    "San Nicolas Island ~73 nm); yellowtail on 80-ft troll lines (backside of Santa Cruz, " +
    "Santa Barbara Island west side, Osborn SW arc) in 66–74 °F water; rockfish on the banks " +
    "(Pt. Conception ledges, Santa Rosa Flats hard patches, south of San Miguel, Webster Point); " +
    "halibut on the 40–120 ft sand (Goleta–Carpinteria flats, Bechers Bay). " +
    "Write a brief for the outlook window given in the message from ONLY the forecast data " +
    "provided: 1) the weather " +
    "and sea state in plain terms, leading with any small-craft advisory or safety concern; " +
    "2) what to target and where, given the wind windows, seas, and water temperatures — be " +
    "specific about which day and which grounds are the better call, and say when the long runs " +
    "are not worth it; 3) note the Santa Barbara Island / Osborn area no-take reserve only if " +
    "you send readers there. Never invent numbers not in the data. Output format: first line is " +
    "a headline under 70 characters (no quotes, no trailing period); then a blank line; then " +
    "the body, 120–190 words, plain prose, no headings or bullet lists." +
    (override?.focus ? "\n\n" + (FOCUS[override.focus] ||
      `This edition should focus on ${override.focus}.`) : "");

  const user =
    `${label}: ${weekend} (analysis drafted ${fmtDay(laDate(0))}).\n\n` +
    `Point forecasts (Open-Meteo; wind kn with gusts, seas ft at midday, SST °F at midday):\n` +
    `${JSON.stringify(table, null, 1)}\n\n` +
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
    label,
    weekend, // the outlook window — the weekend unless overridden
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
