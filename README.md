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
assets/js/cycling.js    Live ride feed — re-renders the cycling page from the
                        Intervals.icu relay; baked HTML is the no-JS fallback
assets/js/fishing.js    Fishing chart engine (SST isotherms, wash, wind field)
assets/js/fishing-data.js Channel Islands shoreline + fishing spots (generated)
assets/img/             Photos + favicon; assets/img/pdf/<slug>/ holds pre-rendered
                        page images (150 DPI JPGs, generated with PyMuPDF)
assets/files/           Resume + academic PDFs (download links)
assets/data/            Generated data (fishing-brief.json, written daily
                        by the fishing-brief workflow)
scripts/                Node generators run by GitHub Actions
                        (fishing-brief.mjs drafts the weekend outlook with
                        the Claude API — needs the ANTHROPIC_API_KEY repo
                        secret; without it the workflow no-ops)
infra/owntracks-relay/  Cloud Run relay for the live boat marker (service
                        owntracks-relay, project margerum; POST token lives
                        only in the Cloud Run env var, never in this repo)
infra/intervals-relay/  Cloud Run relay for the cycling page's live ride feed
                        (service intervals-relay, project margerum; the
                        Intervals.icu API key lives only in Cloud Run env
                        vars, never in this repo)
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

## Cycling live data (Intervals.icu relay + webhook)

The cycling page loads its numbers live: `assets/js/cycling.js` fetches
`/feed` from `infra/intervals-relay` on every visit, and the relay hears
about new activities the moment they upload via an Intervals.icu webhook —
the event busts the relay's cache and rebuilds the feed, so the page is
current as soon as a ride posts, with no daily rebuild and no manual
refresh. Rides are recorded in the Cadence app, which auto-uploads to
Intervals.icu; nothing in this chain touches Strava, whose API now
requires a paid subscription.

The HTML baked into `cycling/index.html` is only the no-JS/SEO fallback;
refresh it occasionally (or leave a scheduled job doing so) so crawlers
see something reasonably fresh. The relay serves aggregates and
elevation-vs-distance curves only — no GPS coordinates, maps, or start
locations ever leave it.

One-time setup:

1. In Intervals.icu, open Settings and scroll to **Developer Settings**.
   Generate a personal API key. The relay authenticates with HTTP Basic
   auth as `API_KEY:<the key>`.
2. Pick any random string as the webhook shared secret, e.g.
   `openssl rand -hex 16`.
3. Deploy (the service name/region must stay `intervals-relay` /
   `us-central1` — the URL is hardcoded in `assets/js/cycling.js`):

   ```
   gcloud run deploy intervals-relay --source infra/intervals-relay \
     --project margerum --region us-central1 --allow-unauthenticated \
     --set-env-vars INTERVALS_API_KEY=<KEY>,INTERVALS_WEBHOOK_SECRET=<RANDOM>
   ```

   The first `/feed` request backfills the whole season in one API call,
   so every ride already in Intervals.icu shows up immediately.
4. **Webhook (optional, and it needs approval).** Intervals.icu attaches
   webhooks to OAuth apps, not to personal API keys, so a "Manage App"
   link only appears once you own an app. To get one, apply at
   <https://intervals.icu/oauth/apply> while logged in (name, description,
   website `https://remymargerum.com`, a square logo ≥128×128, the privacy
   policy URL, and a redirect URI — `https://remymargerum.com/cycling/`
   serves, since the relay never runs the OAuth flow). The app starts
   *Pending*; once approved it appears under `/settings/apps`, and its
   **Manage App** page is where the callback URL
   `https://intervals-relay-924564512726.us-central1.run.app/webhook`
   goes, with the same shared secret, subscribed to `ACTIVITY_UPLOADED`
   and `ACTIVITY_ANALYZED`.

   Skipping this step costs very little: without a webhook the relay simply
   rebuilds when its cache expires, so the page is at worst `FEED_TTL_MS`
   old (15 minutes by default) instead of instant.

Optional env vars: `INTERVALS_ATHLETE_ID` (defaults to `0`, meaning the
key's owner), `SEASON_START` (defaults to January 1 of the current year),
`RIDE_TYPES` (defaults to `Ride,GravelRide,MountainBikeRide` — add
`EBikeRide` or `VirtualRide` here if rides are missing from the page),
`RECENT_RIDES` (defaults to 8, the length of the Recent Rides list), and
`FEED_TTL_MS` (defaults to 900000 = 15 minutes).

Elevation profiles are cached per activity and the season list is one call
per rebuild, so API usage stays minimal even at a short TTL. Note that
Intervals.icu does not fire activity webhooks for rides that arrived there
from Strava — ours come straight from Cadence, so that limitation does not
apply.

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
