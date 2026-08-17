# Santi Rosina — santirosina.com

The website of Santi Rosina, a family winery in Santa Barbara, California.
Hand-built static HTML/CSS (no frameworks, no build step) served by **GitHub Pages**.

## Structure

```
index.html            Landing page
wine-club/index.html  Wine Club (coming soon)
shop/index.html       Shop (coming soon)
about/index.html      Our story (filler copy, ready to replace)
contact/index.html    Contact
404.html              Not-found page
assets/css/style.css  The whole design system (colors, type, components)
assets/js/main.js     Nav, header, scroll-reveal (progressive enhancement)
assets/fonts/         Self-hosted Bodoni Moda + Jost (variable woff2)
assets/img/           Stock photography (Unsplash license) + favicon
.github/workflows/deploy.yml  Auto-deploys main → GitHub Pages
```

## Brand quick reference

| Token | Value | Use |
|---|---|---|
| Nero di Notte | `#171310` | dark grounds, heroes, footer |
| Carta | `#F4EEE3` | cream editorial sections |
| Rosa Antica | `#B4766B` / deep `#96584E` | signature accent (from "Rosina") |
| Oro Antico | `#C2A265` | hairlines, rules, stamp |
| Cipresso | `#50543F` | supporting green |

Type: **Bodoni Moda** (display, italics) + **Jost** (letterspaced caps, body).
Motifs: double hairline rules, ✦ fleurons, the SR roundel stamp.

## Editing

Every page is plain HTML — edit and push to `main`; the workflow deploys automatically.
Design tokens live at the top of `assets/css/style.css`.

## Placeholders to replace before/at launch

- `hello@santirosina.com` — set up this mailbox (or change the address in all pages)
- Tasting-room address, phone, hours (contact page + landing "Visit" strip)
- Instagram handle on the contact page (currently text-only)
- About-page story copy is intentional filler
- Wine list on the shop page is illustrative
- `MMXXVI` / "© 2026" in footers if the launch year changes

## Going live on santirosina.com

DNS stays at Cloudflare; only the records change. Zero-downtime order:

1. Site is already live at the github.io preview URL — approve it first.
2. **GitHub** → repo **Settings → Pages → Custom domain** → enter `santirosina.com` → Save.
3. **Cloudflare DNS** for santirosina.com — remove existing `A`/`AAAA`/`CNAME` records on `@` and `www` that point at the old hosting, then add (all **DNS only** / grey cloud):
   - `A @ 185.199.108.153`
   - `A @ 185.199.109.153`
   - `A @ 185.199.110.153`
   - `A @ 185.199.111.153`
   - `CNAME www remy-margerum.github.io`
   - Leave MX/TXT (email) records untouched.
4. Back in GitHub Pages settings, wait for the DNS check ✓ and the certificate, then tick **Enforce HTTPS**.
5. Optional hardening: GitHub account **Settings → Pages → Verified domains** → verify `santirosina.com` (adds a TXT record at Cloudflare).

Rollback at any time: restore the old Cloudflare records.

## Photo credits

Photography via [Unsplash](https://unsplash.com) (Unsplash License — free for commercial use):
photo IDs `1662624335971`, `1600672220645`, `1561906814`, `1561668137`, `1554230561`,
`1781090876896`, `1689781307118`, `1563514227147`, `1510812431401`, `1506377247377`,
`1474722883778`, `1568213816046`, `1547595628`.
