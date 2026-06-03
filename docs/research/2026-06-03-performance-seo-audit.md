# Performance & SEO Audit — Delta Climate Research

**Date:** 2026-06-03
**Scope:** Production build (`dist/`) of the current site, plus config and source.
**Method:** Direct inspection of built HTML/assets, bundle composition, fonts, meta, headings.
**Companion:** Keyword + content-strategy section sourced from a deep-research pass (appended below).

---

## Executive summary

The site is **technically fast and clean** (zero raster images, deferred JS, small CSS, good
heading hierarchy, reduced-motion safe) but has **critical SEO gaps that actively suppress
indexing and rich results**, plus a few easy performance wins. Nothing here is architectural —
all fixes are small and low-risk.

**Severity tally:** 🔴 4 critical · 🟠 6 important · 🟡 5 minor · ✅ 8 already-good

---

## 🔴 Critical (fix before any marketing push)

1. **Placeholder site URL → broken canonical & Open Graph.**
   `astro.config.mjs` has `site: 'https://delta-climate-research.example'` (a non-existent
   domain). Every page emits `<link rel="canonical" href="https://delta-climate-research.example/">`
   and `og:url` to that dead domain. Google will see canonicals pointing off-site → indexing
   harm. **Fix:** set `site` to the real production domain (the Vercel domain or a custom domain).
   *Files: `astro.config.mjs`.*

2. **No `sitemap.xml`.** No `@astrojs/sitemap` integration → search engines have no crawl map.
   **Fix:** `npx astro add sitemap` (auto-generates from `site`), then reference it in robots.txt.

3. **No `robots.txt`.** Nothing tells crawlers what to index or where the sitemap is.
   **Fix:** add `public/robots.txt` with `Sitemap:` line + allow-all (or staging disallow).

4. **No structured data (JSON-LD).** Zero `application/ld+json`. For a consultancy this is the
   single biggest rich-result/knowledge-panel lever. **Fix:** add `Organization` +
   `ProfessionalService` (with `areaServed`, `serviceType`, `sameAs`), a `WebSite` node, and
   per-service `Service` schema. (Schema types confirmed by research section below.)

---

## 🟠 Important

5. **Geist Mono ships all 6 Unicode subsets (~45 KB in `dist/`).** `Base.astro` imports
   `@fontsource-variable/geist-mono/index.css`, copying cyrillic, cyrillic-ext, vietnamese,
   latin-ext, symbols2 and latin woff2 into the build. **CORRECTION (verified):** these
   `@font-face` rules carry `unicode-range`, so an English-content browser **only downloads the
   latin subset** — the other 5 are never fetched by users. So this is ~45 KB of unused *CDN
   storage*, **not** user bandwidth; there is no real-world perf win. The package also ships no
   `latin.css` entry point. **Verdict: leave as-is** (a dist-trim would require self-hosting the
   latin woff2 — not worth it for zero UX gain). Reclassified from 🟠 to non-issue.

6. **Duplicate meta description.** `/white-papers` reuses the generic home description verbatim.
   Duplicate descriptions dilute relevance. **Fix:** pass a unique `description` to the
   `<Base>` layout on every page.

7. **No social share image (`og:image` / `twitter:image`).** `twitter:card` is
   `summary_large_image` but no image is set → links unfurl with no preview card. **Fix:** add a
   1200×630 OG image (can be a static brand card) + the two meta tags.

8. **Headings are keyword-empty.** H1 = "Navigating the systems of a changing planet"; H2s =
   "Proof, before theory", "The thinking behind the work", "Living intelligence, by location".
   Brand-strong but they carry **none** of the terms people search (climate risk, embodied
   carbon, CBAM, urban heat). Body copy has the keywords; headings don't. **Fix (brand-safe
   options):** keep the poetic line as a styled kicker/eyebrow and make the semantic H1 a
   keyword-bearing line; or add a keyword-rich H2 lead-in per section. (Exact targets in the
   keyword section.)

9. **Missing standard head tags:** `og:site_name`, `og:locale`, `twitter:site`, `theme-color`,
   `meta name="author"`. Cheap to add; improve unfurls and browser chrome.

10. **Thin content footprint for topical authority.** Only 2 routes; the white-papers are
    titled but stubbed. Climate/ESG SERPs reward depth. **Fix:** the content strategy from the
    research section (publish the white-papers as real long-form, cluster by service).

---

## 🟡 Minor

11. **No custom `404.html`.** Add `src/pages/404.astro` for a branded, link-back 404.
12. **`/fonts/*.woff2` (self-hosted Satoshi) not fingerprinted** → no `immutable` caching by
    default on Vercel. Add a `vercel.json` `headers` rule for `/fonts/(.*)` with
    `cache-control: public, max-age=31536000, immutable`. (`/_astro/*` is already hashed/immutable.)
13. **`three` + `@types/three` are dead dependencies** — not imported anywhere in `src`, not in
    the client bundle (verified). Harmless at runtime but remove for hygiene/install speed.
14. **GSAP+ScrollTrigger+Lenis = ~130 KB uncompressed JS** (~50 KB brotli via Vercel) loads on
    every page. Acceptable for the effects; if Lighthouse TBT becomes an issue, lazy-init the
    scroll-effects below the fold. Low priority — measure first.
15. **Satoshi italic woff2 (42.8 KB) shipped but likely unused** (italic accents use Spectral).
    Only fetched if referenced; confirm and drop the `@font-face` if truly unused.

---

## ✅ Already good (keep)

- **Zero raster images** — gradients/SVG only → excellent LCP, no image pipeline needed.
- **Heading hierarchy** — exactly one H1, well-ordered H2s, no skipped levels.
- **`lang="en"`**, valid `<title>` per page, viewport meta present.
- **JS is deferred** (`type="module"`), CSS is small (~33 KB), pre-paint inline script is tiny.
- **`font-display: swap`** + Satoshi preload (LCP font hinted).
- **Accessibility:** `:focus-visible` ring, `prefers-reduced-motion` fully respected across all
  animations, decorative nodes `aria-hidden`.
- **Astro static output** — fast TTFB on Vercel's edge, hashed immutable `_astro` assets.
- **Canonical + OG scaffolding exists** (just pointed at the wrong domain — see #1).

---

## Prioritized fix order (fastest ROI first)

1. Set real `site` URL (#1) — one line, unblocks canonicals/OG/sitemap.
2. `astro add sitemap` + `robots.txt` (#2, #3) — minutes.
3. JSON-LD Organization/ProfessionalService/Service (#4) — high SEO leverage.
4. Geist Mono `latin.css` only (#5) — one import, −45 KB.
5. Unique per-page descriptions + OG image + missing head tags (#6, #7, #9).
6. Keyword-bearing headings + publish real white-papers (#8, #10) — uses keyword section below.
7. Hygiene: remove `three`, add `vercel.json` font cache, custom 404 (#11–13).

---

## Keywords & content strategy
_(deep-research pass: 25 sources across 5 angles, 24/25 claims confirmed. Key verified insight:
**long-tail niche terms beat broad heads** — e.g. KD ~28 vs ~57 — so the niche clusters below are
the priority, not generic "climate consulting". CBAM-for-India is a dense, actively-marketed
high-intent cluster.)_

### A. Commercial / transactional (highest intent — the "money" terms)
Buyers ready to hire. Map these to **service pages** (one page per niche).

| Keyword cluster | Competition | Note |
| --- | --- | --- |
| `urban heat island mapping services`, `heat vulnerability assessment consultant` | **Low** | **★ Lead niche** — underserved, research-led, matches Kolkata/ECOSTRESS case study |
| `blue carbon project developer`, `blue carbon MRV services`, `mangrove carbon credit consultant` | Low–Med | **★ Lead niche** — matches the mangrove/VM0033 case study |
| `embodied carbon consultant`, `embodied carbon assessment services`, `EPD consultant India` | Low–Med (emerging 2026) | **★ Lead niche** — core service, rising demand, get in early |
| `climate risk assessment consultancy`, `climate risk advisory` | **High** (WTW, Jupiter, S&P) | Don't lead here — too competitive; win via the niches above |
| `CBAM consultant`, `CBAM compliance for steel/cement/aluminium exporters` | Med (live competitors: GreenSutra, Sentra, CleanCarbon) | **Adjacency, NOT a core niche** — high market intent but off the research-led positioning; pursue opportunistically via the materials-trading case study, don't lead with it |
| UAE corridor: `ESG consultant UAE`, `carbon accounting Dubai` | Med | Regional expansion terms |

### B. Informational (top-of-funnel — blog/white-paper targets, build authority)
Higher volume, lower intent → capture early, nurture to the service pages.
- CBAM: `what is CBAM`, `CBAM explained`, `CBAM India impact`, `CBAM default values`, `CBAM definitive period 2026`, `CBAM embedded emissions calculation`
- Embodied carbon: `how to calculate embodied carbon`, `EPD vs LCA`, `what is an Environmental Product Declaration`, `ISO 14025 EPD`
- Urban heat: `what is a heat vulnerability index`, `urban heat island causes`, `ECOSTRESS data explained`, `land surface temperature mapping`
- Blue carbon: `what is blue carbon`, `VM0033 methodology`, `soil organic carbon MRV`, `mangrove carbon sequestration`

### C. Long-tail niche (LOW competition, HIGH conversion — the recommended focus)
These are the verified opportunity. They're specific, low-KD, and **already match the existing
white-paper titles** — publishing those as full articles targets them directly:
- `CBAM compliance for Indian steel exporters`
- `embodied carbon dossier for CBAM exporters`
- `EPD ISO 14025 cement India`
- `ward-level heat vulnerability index India` / `street-scale heat mapping ECOSTRESS`
- `VM0033 soil organic carbon accounting` / `mangrove blue carbon credit India MRV`
- `cool roof intervention heat mitigation` + `[city]`

**High-value / low-competition flags:** lead the site's SEO with the three **research-led niches** —
**urban-heat/HVI**, **blue-carbon/VM0033**, and **embodied-carbon/EPD** — which are the least
contested relative to intent and match the brand's positioning + existing case studies. **CBAM**
stays as an opportunistic adjacency (high market intent, but off the research-led core — don't
anchor the brand on it). Avoid leading with generic "climate risk" (dominated by WTW/Jupiter/S&P).

### D. 2025–26 SEO tactics checklist (prioritised)

**Structured data (JSON-LD)** — for rich results + entity clarity. _Caveat: a direct lift in AI
Overviews / featured snippets from schema alone is **unproven** (contested in research); implement
for rich results and entity understanding, not as an AI-Overview guarantee._
- `Organization` + `ProfessionalService`: `name`, `url`, `logo`, `areaServed` (India, UAE),
  `serviceType` (the 5 niches), `knowsAbout` (CBAM, EPD, HVI, VM0033…), `sameAs` (LinkedIn, etc.).
- `WebSite` node (+ `SearchAction` if site search added).
- One `Service` node per service page.
- `Article` + `author` (named, credentialed) + `datePublished` on each white-paper → E-E-A-T.
- `BreadcrumbList` once there's depth.

**E-E-A-T for a research-led brand** (your core differentiator):
- Named authors with credentials and bios; an `/about`/`/research` with real depth.
- Cite + link primary sources (ECOSTRESS, Verra registry, EU CBAM regulation, peer-reviewed papers).
- Publish methodology transparently; show real datasets/figures. "Research-led" must be evidenced, not asserted.
- **Regional E-E-A-T gap (verified):** authority doesn't auto-transfer across regions. Build
  India/UAE-local signals — local case studies (you have Kolkata), regional citations, Google
  Business Profile, and `hreflang` if you add en-IN / en-AE variants.

**Topical authority / entity SEO:**
- Build **content clusters** per service: a pillar service page + 2–4 supporting articles, tightly
  internally linked. Expand the 2 stub white-papers into full clusters.
- Consistent entity naming across pages so search engines bind the brand to its topics.

**Technical (Astro static — mostly covered by the critical fixes above):**
- Fix `site` URL → correct canonicals/OG/sitemap (#1); add sitemap + robots (#2/#3); per-page
  unique titles+descriptions; JSON-LD (#4); OG images (#7). Core Web Vitals are already strong —
  preserve that edge (it's a ranking advantage vs slower competitors).

### Selected sources
CBAM: oneclicklca CBAM guide; icapcarbonaction (CBAM 2026 simplifications); greensutra / sentra
(India CBAM consulting). EPD: conserveconsultants (EPD India 2026). Urban heat: MDPI Remote Sensing
(ECOSTRESS/LST). Blue carbon: Verra (VM0033 revision); Nature (blue-carbon). SEO: Semrush (keyword
difficulty); seopital (sustainability keywords); neciudan (Astro SEO checklist 2026); cemkiray
(JSON-LD in Astro); martech / brandvm (B2B + service-business schema); searchengineland (global
E-E-A-T gap); eeatminds (E-E-A-T India); seeklab / growthsyndicate (B2B topical authority).
