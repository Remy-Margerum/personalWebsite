# remymargerum.com

Personal website of Remy Margerum — plain static HTML/CSS, no build step.
Design system matches [margerumwines.com](https://www.margerumwines.com): EB Garamond,
white/cream palette, saddle-brown `#7F4C29` accents.

## Structure

```
index.html              Home (hero, principles, about, resume CTA, social)
academic-work/          Three papers with paginated page-image viewers
resume/                 Resume viewer + download
contact-me/             Contact form (Formspree → remymargerum@gmail.com)
vietnam/                "Northern Vietnam by Motorcycle" article
sailing/                Live SBYC course chart with per-mark wind forecast
cycling/                SB100 training feed
fishing/                Fishing chart — target-species programs (bluefin,
                        yellowtail, rockfish, halibut) over the Channel
                        Islands with NOAA SST, GMRT depth contours, wind,
                        NWS offshore forecast, sanctuary/MPA boundaries
privacy-policy/         Privacy policy
lottery/                CA Lottery EV — offline stub (not in nav; app lives in the
                        separate ca-scratchers repo, currently disabled)
404.html                Not-found page (GitHub Pages picks this up automatically)
assets/css/style.css    All styling; design tokens in :root
assets/js/pdf-viewer.js Pager logic for the document viewers
assets/js/sailing.js    Sailing chart engine (projection, routes, wind field)
assets/js/sailing-data.js SBYC marks/courses + shoreline geometry (generated)
assets/js/cycling-render.js Shared cycling markup (season stats, weekly chart,
                        ride cards) used by the page and by the bake step
assets/js/cycling.js    Cycling page — renders assets/data/cycling/feed.json and
                        opens per-ride detail panels (charts, splits, climbs,
                        zones); the baked HTML is the no-JS fallback
assets/js/fishing.js    Fishing chart engine (SST isotherms, wash, wind field)
assets/js/fishing-data.js Channel Islands shoreline + fishing spots (generated)
assets/img/             Photos + favicon; assets/img/pdf/<slug>/ holds pre-rendered
                        page images (150 DPI JPGs, generated with PyMuPDF)
assets/files/           Resume + academic PDFs (download links)
assets/data/            Generated data: cycling/feed.json and
                        cycling/rides/<id>.json (hourly, from Intervals.icu),
                        cycling-brief.json and fishing-brief.json (weekly
                        AI notes)
scripts/                Node generators run by GitHub Actions:
                        cycling-rides.mjs pulls rides from Intervals.icu
                        (needs the INTERVALS_API_KEY repo secret);
                        cycling-brief.mjs / fishing-brief.mjs draft the
                        weekly notes with the Claude API (ANTHROPIC_API_KEY —
                        without it those workflows no-op)
infra/owntracks-relay/  Cloud Run relay for the live boat marker (service
                        owntracks-relay, project margerum; POST token lives
                        only in the Cloud Run env var, never in this repo)
CNAME                   Custom domain for GitHub Pages (remymargerum.com)
```

Deployed via GitHub Pages from `Remy-Margerum/personalWebsite` (main branch, root).
Deploy = `git push`.

## Regenerating PDF page images

If a PDF in `assets/files/` changes, re-render its page images:

```python
import fitz  # pip install pymupdf
doc = fitz.open("assets/files/<name>.pdf")
for i, page in enumerate(doc, 1):
    page.get_pixmap(matrix=fitz.Matrix(150/72, 150/72)).save(
        f"assets/img/pdf/<slug>/page-{i}.jpg", jpg_quality=80)
```

Then update `data-pages` on the matching `.pdf-viewer` if the page count changed.

## Launch checklist (remaining)

DNS for `remymargerum.com` is hosted at Cloudflare (domain registered at
GoDaddy — leave the nameservers alone): `@` A records →
185.199.108.153 / 185.199.109.153 / 185.199.110.153 / 185.199.111.153,
`www` CNAME → `remy-margerum.github.io`, all set to "DNS only" (grey cloud)
so GitHub can issue its certificate. Once the certificate is issued,
enable "Enforce HTTPS" in the repo's Pages settings.

## Cycling ride data (Intervals.icu via GitHub Actions)

The cycling page reads static JSON that a scheduled action keeps current.
`.github/workflows/cycling-rides.yml` runs `scripts/cycling-rides.mjs` every
hour (and on demand from the Actions tab); the script pulls the season's
rides from the Intervals.icu API and commits

- `assets/data/cycling/feed.json` — season totals, miles per Monday-week,
  and every ride of the season with an elevation sparkline;
- `assets/data/cycling/rides/<id>.json` — one file per ride with what the
  page's "Ride details" panel shows: downsampled distance / altitude /
  speed / heart-rate / power / cadence streams, mile splits, climbs, best
  efforts, time in zones and laps;
- the season stats, weekly chart and recent rides baked into
  `cycling/index.html` between the `<!-- cycling:… -->` markers, as the
  no-JS/SEO fallback (the page re-renders from the JSON when it loads).

Rides are recorded in the Cadence app, which auto-uploads to Intervals.icu;
nothing in this chain touches Strava. Only aggregates and curves are
stored — no GPS coordinates, maps or start locations. Per-ride files are
cached and fetched again only when Intervals.icu re-analyzes a ride or its
headline numbers change, so an idle hour is one API call and no commit
(a personal API key allows 5,000 calls a day). The weekly training note
(`cycling-brief.mjs`) reads the same `feed.json`. A ride can be linked
directly as `/cycling/#ride-<id>`.

Setup:

1. In Intervals.icu open Settings, scroll to **Developer Settings** and
   generate a personal API key.
2. Add it to the repo as an Actions secret named `INTERVALS_API_KEY`
   (Settings → Secrets and variables → Actions). Without it the workflow
   fails with a message saying so.
3. Run the **Cycling rides** workflow once from the Actions tab, or wait
   for the next hour; the first run backfills the whole season.

Optional env vars (set them on the workflow step): `INTERVALS_ATHLETE_ID`
(defaults to `0`, the key's owner), `SEASON_START` (defaults to January 1
of the current year), `RIDE_TYPES` (defaults to
`Ride,GravelRide,MountainBikeRide` — add `EBikeRide` or `VirtualRide` if
rides are missing from the page). Bump `DETAIL_VERSION` in the script to
rebuild every ride file after a format change.

## Local preview

Any static server works, e.g.:

```
npx serve .
```

## Data, licenses & attribution

This is a personal, non-commercial site. Content (text, photos) is
© LBIRI, LLC — all rights reserved. The sailing-chart code
(`assets/js/sailing.js`) is released under the MIT License: permission is
hereby granted, free of charge, to any person obtaining a copy of that
file, to deal in it without restriction, subject to the standard MIT
conditions and warranty disclaimer (https://opensource.org/license/mit).

The sailing page combines three third-party data sources, each credited
on the page itself as their licenses require:

- **Shoreline / breakwater / wharf geometry** — extracted from
  [OpenStreetMap](https://www.openstreetmap.org/copyright), © OpenStreetMap
  contributors, licensed under the [ODbL](https://opendatacommons.org/licenses/odbl/).
  The derived, simplified geometry in `sailing-data.js` remains subject to ODbL.
- **Weather & marine forecast** — [Open-Meteo](https://open-meteo.com/),
  data licensed CC-BY 4.0; the free API tier used here is for
  non-commercial use, which this site is.
- **Race marks & courses** — transcribed from the Santa Barbara Yacht Club
  course chart (effective 4/16/2025); coordinates and course sequences are
  factual data, credited to SBYC on the page. Not affiliated with or
  endorsed by SBYC.

The fishing page (`assets/js/fishing.js`, same MIT terms as the sailing
chart code) also shows the **NWS Los Angeles/Oxnard coastal waters
forecast** (api.weather.gov CWF product, public domain) as its offshore
weather panel, and draws the Channel Islands National Marine Sanctuary
boundary (OSM-derived, ODbL) with state/federal MPA and special-closure
polygons from the official CDFW ds582 dataset (still indicative only). Its
main overlay source is **sea-surface temperature** from the
NOAA/NESDIS Geo-Polar Blended 5 km analysis, fetched in the browser from
NOAA CoastWatch ERDDAP (`noaacwBLENDEDsstDNDaily`) via JSONP — the ERDDAP
server doesn't send CORS headers, but its JSONP support works from a
static page. US-government open data, credited on the page. Load on NOAA
is kept minimal: one small subset request per analysis day viewed (no
polling loop), cached in memory and in localStorage for the rest of the
day. Its shoreline
in `fishing-data.js` is OSM-derived and remains subject to ODbL; wind is
Open-Meteo, as above.
