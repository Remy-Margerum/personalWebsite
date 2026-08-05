# remymargerum.com

Personal website of Remy Margerum — plain static HTML/CSS, no build step.
Design system matches [margerumwines.com](https://www.margerumwines.com): EB Garamond,
white/cream palette, saddle-brown `#7F4C29` accents, squared corners.

Rebuilt 2026-08-05 from the old GoDaddy Website Builder site (content migrated 1:1).

## Structure

```
index.html              Home (hero, principles, about, resume CTA, social)
academic-work/          Three papers with embedded PDFs
resume/                 Resume embed + download
contact-me/             Contact form (Formspree) + direct email
vietnam/                "Northern Vietnam by Motorcycle" article
privacy-policy/         Privacy policy
lottery/                CA Lottery EV — offline stub (not in nav; app lives in the
                        separate ca-scratchers repo, currently disabled)
404.html                Not-found page (GitHub Pages picks this up automatically)
assets/css/style.css    All styling; design tokens in :root
assets/img/             Photos migrated from GoDaddy CDN + favicon
assets/files/           Resume + academic PDFs
CNAME                   Custom domain for GitHub Pages (remymargerum.com)
```

## TODO before/at launch

1. **Formspree**: create a free form at formspree.io (deliver to remymargerum@gmail.com),
   then replace `YOUR_FORM_ID` in `contact-me/index.html`.
2. **GitHub**: push this repo to `<username>.github.io`, enable Pages, set custom
   domain `remymargerum.com`, enforce HTTPS.
3. **DNS (GoDaddy)**: point `@` A records to GitHub Pages
   (185.199.108.153 / 185.199.109.153 / 185.199.110.153 / 185.199.111.153) and
   `www` CNAME to `<username>.github.io`. Keep the domain registration; the Website
   Builder subscription can be cancelled once the new site is live.

## Local preview

Any static server works, e.g.:

```
npx serve .
```
