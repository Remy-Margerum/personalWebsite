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
privacy-policy/         Privacy policy
lottery/                CA Lottery EV — offline stub (not in nav; app lives in the
                        separate ca-scratchers repo, currently disabled)
404.html                Not-found page (GitHub Pages picks this up automatically)
assets/css/style.css    All styling; design tokens in :root
assets/js/pdf-viewer.js Pager logic for the document viewers
assets/img/             Photos + favicon; assets/img/pdf/<slug>/ holds pre-rendered
                        page images (150 DPI JPGs, generated with PyMuPDF)
assets/files/           Resume + academic PDFs (download links)
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

DNS for `remymargerum.com` (at the domain registrar): `@` A records →
185.199.108.153 / 185.199.109.153 / 185.199.110.153 / 185.199.111.153,
`www` CNAME → `remy-margerum.github.io`. Once the certificate is issued,
enable "Enforce HTTPS" in the repo's Pages settings.

## Local preview

Any static server works, e.g.:

```
npx serve .
```
