# Technical SEO Foundation — Design Spec

**Date:** 2026-06-03
**Status:** Approved for planning
**Audit basis:** [`docs/research/2026-06-03-performance-seo-audit.md`](../../research/2026-06-03-performance-seo-audit.md)

## 1. Goal

Close the critical technical-SEO gaps found in the audit, pixel/behaviour-neutral, so the site is
correctly crawlable, indexable, and rich-result-eligible — without inventing any facts about the
(currently demo) brand.

## 2. Locked Decisions

| Decision | Choice |
| --- | --- |
| Canonical domain | `https://delta-climate-research.vercel.app` |
| Entity reality | **Portfolio/demo** — JSON-LD asserts ONLY truthful facts; no fabricated email/phone/address/`sameAs` |
| Scope | **Technical only** — no OG image, no copy/heading changes, no real white-paper content, no per-`Service` schema |
| Niche framing | Lead `serviceType`/`knowsAbout` with urban-heat, blue-carbon, embodied-carbon; CBAM last (per [[seo-niche-positioning]]) |

## 3. Changes

### 3.1 Canonical URL + crawlability
- **`astro.config.mjs`**: `site: 'https://delta-climate-research.vercel.app'` (replaces the
  `delta-climate-research.example` placeholder). This auto-corrects `<link rel="canonical">` and
  `og:url` already wired in `Base.astro` via `Astro.site`/`Astro.url`.
- **Sitemap**: add `@astrojs/sitemap` to `integrations`. Generates `/sitemap-index.xml` +
  `/sitemap-0.xml` at build from `site`. (Both static pages included.)
- **`public/robots.txt`** (new):
  ```
  User-agent: *
  Allow: /

  Sitemap: https://delta-climate-research.vercel.app/sitemap-index.xml
  ```

### 3.2 Structured data (JSON-LD) — `Base.astro`
A single `<script type="application/ld+json">` emitting an `@graph`, built from a small typed
constants object in `Base.astro` frontmatter (one source of truth). Truthful facts only:

- **Node `Organization`** (also typed `ProfessionalService`):
  - `@id`: `<site>/#organization`
  - `name`: "Delta Climate Research"
  - `url`: site
  - `logo`: `<site>/favicon.svg`
  - `description`: the brand description (same string as the meta description default)
  - `areaServed`: `["India", "United Arab Emirates"]`
  - `knowsAbout`: `["Urban heat vulnerability mapping", "Heat Vulnerability Index", "Blue carbon MRV", "Mangrove soil organic carbon", "Embodied carbon accounting", "Environmental Product Declarations", "Climate risk intelligence", "Carbon Border Adjustment Mechanism"]` (research-led niches first, CBAM last)
  - **No** `email`, `telephone`, `address`, `sameAs` (not truthful for a demo).
- **Node `WebSite`**:
  - `@id`: `<site>/#website`
  - `url`: site, `name`: "Delta Climate Research", `publisher`: `{ @id: <site>/#organization }`
  - No `SearchAction` (no site search exists).

The `@graph` is emitted once, site-wide, on every page (stable identifiers via `@id`).

### 3.3 Head/meta completeness — `Base.astro`
- Add: `<meta property="og:site_name" content="Delta Climate Research">`,
  `<meta property="og:locale" content="en">`,
  `<meta name="theme-color" content="#050606">`,
  `<meta name="author" content="Delta Climate Research">`.
- Change `<meta name="twitter:card" content="summary_large_image">` →
  `content="summary"` (no OG image in scope → avoid a blank large card).
- **Unique per-page descriptions:** `Base.astro` already accepts a `description` prop. Pass
  distinct values:
  - `src/pages/index.astro` → keep the existing default (home/brand description).
  - `src/pages/white-papers/index.astro` → a unique description about the white-papers/research feed.

### 3.4 Performance hygiene
- **Remove dead deps:** `package.json` — remove `three` (dependency) and `@types/three`
  (devDependency). Verified not imported in `src` and absent from the client bundle. Real cleanup.
- **Geist Mono subsets — CORRECTED (low value, optional):** the audit assumed a `−45 KB` fetch
  win via a `latin.css` import, but that import path **does not exist** (the package ships only
  `index.css`), and its `@font-face` rules already carry `unicode-range` — so an English-content
  browser **only downloads the latin subset**; the other 5 subsets are copied to `dist/` but
  **never fetched by users**. There is therefore **no user-bandwidth win** to be had here.
  **Decision: leave the `index.css` import as-is.** (A clean dist-trim would mean self-hosting
  just the latin woff2 with a hand-written `@font-face` named `'Geist Mono Variable'`, mirroring
  the Satoshi setup — deferred as not worth the risk/effort for zero UX gain.)

### 3.5 Custom 404 — `src/pages/404.astro` (new)
A branded 404 using the `Base` layout: short message + link back to `/`. Uses existing utility
classes / tokens (post-Tailwind-migration style). No new CSS system.

## 4. Verification

- `npm run check` + `npm run build` green.
- `dist/` contains `robots.txt`, `sitemap-index.xml`, `sitemap-0.xml`, `404.html`.
- Prod-HTML checks: `<link rel="canonical">` and `og:url` use the real domain (no `.example`);
  exactly one `application/ld+json` block that JSON-parses and contains the `Organization` +
  `WebSite` nodes with the correct `@id`s; the new meta tags present; `twitter:card` = `summary`;
  white-papers page description differs from home.
- No `three`/`@types/three` in `package.json`; build still succeeds.
- (Font subsets intentionally unchanged — see §3.4 correction.)

## 5. Out of Scope (future passes)
- OG/Twitter share image (1200×630).
- Keyword-bearing headings + real white-paper long-form content + per-`Service` schema + `Article`
  schema with named authors (the E-E-A-T content play).
- Custom domain (swap `site` later if acquired).

## 6. Risks & Mitigations
| Risk | Mitigation |
| --- | --- |
| JSON-LD asserts false facts | Demo-safe: only name/url/logo/description/areaServed/knowsAbout — nothing contactable invented |
| Sitemap integration changes build output | Standard `@astrojs/sitemap`; verify files in `dist/` |
| Font subset swap drops a needed glyph | Site is English; verify build + visual is unchanged (latin covers all current copy) |
| `twitter:card` downgrade | Intentional — `summary` is correct without an image; revisit when OG image is added |
