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
assets/js/fishing.js    Fishing chart engine (SST isotherms, wash, wind field)
assets/js/fishing-data.js Channel Islands shoreline + fishing spots (generated)
assets/img/             Photos + favicon; assets/img/pdf/<slug>/ holds pre-rendered
                        page images (150 DPI JPGs, generated with PyMuPDF)
assets/files/           Resume + academic PDFs (download links)
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
and state/federal MPA boundaries from OSM (ODbL, indicative only). Its
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
