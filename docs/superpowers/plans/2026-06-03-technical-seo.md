# Technical SEO Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the critical technical-SEO gaps — real canonical domain, sitemap, robots, demo-safe JSON-LD, complete head tags, unique descriptions, dead-dep removal, custom 404 — with zero visual/behaviour change.

**Architecture:** Mostly `Base.astro` head + `astro.config.mjs` + two new static-ish files. JSON-LD is built from a small constants block in `Base.astro` frontmatter (one source of truth, emitted site-wide). Verification is build + `dist/` inspection (static site; no unit tests in this repo).

**Tech Stack:** Astro 6 (static), `@astrojs/sitemap`.

**Spec:** [`docs/superpowers/specs/2026-06-03-technical-seo-design.md`](../specs/2026-06-03-technical-seo-design.md)

**Canonical domain:** `https://delta-climate-research.vercel.app` (demo brand — JSON-LD asserts only truthful facts: name/url/logo/description/areaServed/knowsAbout; NO email/phone/address/sameAs).

---

## Task 1: Canonical site URL + sitemap

**Files:** Modify `astro.config.mjs`; add `@astrojs/sitemap` dependency.

- [ ] **Step 1: Install the sitemap integration**

Run: `npm install @astrojs/sitemap`
Expected: installs without error.

- [ ] **Step 2: Set the real site URL and register the integration**

Replace the entire contents of `astro.config.mjs` with:

```js
// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Tailwind v4 runs via PostCSS (postcss.config.mjs) rather than the Vite plugin,
// to avoid a rolldown-vite binding incompatibility in Astro 6.
// https://astro.build/config
export default defineConfig({
  site: 'https://delta-climate-research.vercel.app',
  integrations: [sitemap()],
});
```

- [ ] **Step 3: Build and verify sitemap + corrected canonical**

Run:
```bash
npm run build
ls dist/sitemap-index.xml dist/sitemap-0.xml
grep -o '<link rel="canonical" href="[^"]*"' dist/index.html | head -1
```
Expected: both sitemap files exist; canonical href is `https://delta-climate-research.vercel.app/` (NOT `.example`).

- [ ] **Step 4: Commit**

```bash
git add astro.config.mjs package.json package-lock.json
git commit -m "feat: set canonical site URL + add sitemap integration"
```

---

## Task 2: robots.txt

**Files:** Create `public/robots.txt`.

- [ ] **Step 1: Create the file**

Create `public/robots.txt` with exactly:

```
User-agent: *
Allow: /

Sitemap: https://delta-climate-research.vercel.app/sitemap-index.xml
```

- [ ] **Step 2: Build + verify it ships**

Run: `npm run build && cat dist/robots.txt`
Expected: prints the three directives; `dist/robots.txt` exists.

- [ ] **Step 3: Commit**

```bash
git add public/robots.txt
git commit -m "feat: add robots.txt pointing at sitemap"
```

---

## Task 3: Base.astro — head tags + JSON-LD

**Files:** Modify `src/layouts/Base.astro`.

Current frontmatter (lines 9–19) defines `title`/`description` props and `canonical`. We add a
shared `BRAND_DESCRIPTION` const (used as both the default prop AND the JSON-LD org description so
they never drift), and a JSON-LD `@graph` built from `Astro.site`.

- [ ] **Step 1: Update the frontmatter**

Replace the frontmatter block (from `interface Props {` through the `const canonical = ...` line) with:

```astro
interface Props {
  title?: string;
  description?: string;
}

const BRAND_DESCRIPTION =
  'A boutique consultancy turning decision-grade climate-risk and embodied-carbon intelligence into standards-aligned adaptation decisions.';

const {
  title = 'Delta Climate Research — Research-led climate intelligence',
  description = BRAND_DESCRIPTION,
} = Astro.props;

const canonical = new URL(Astro.url.pathname, Astro.site);

// Demo-safe structured data: only truthfully-assertable facts (no contact/socials).
const site = Astro.site!.href.replace(/\/$/, '');
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': ['Organization', 'ProfessionalService'],
      '@id': `${site}/#organization`,
      name: 'Delta Climate Research',
      url: `${site}/`,
      logo: `${site}/favicon.svg`,
      description: BRAND_DESCRIPTION,
      areaServed: ['India', 'United Arab Emirates'],
      knowsAbout: [
        'Urban heat vulnerability mapping',
        'Heat Vulnerability Index',
        'Blue carbon MRV',
        'Mangrove soil organic carbon',
        'Embodied carbon accounting',
        'Environmental Product Declarations',
        'Climate risk intelligence',
        'Carbon Border Adjustment Mechanism',
      ],
    },
    {
      '@type': 'WebSite',
      '@id': `${site}/#website`,
      url: `${site}/`,
      name: 'Delta Climate Research',
      publisher: { '@id': `${site}/#organization` },
    },
  ],
};
```

- [ ] **Step 2: Update the head meta block**

Replace the Open Graph block (the `<!-- Open Graph -->` comment through the
`<meta name="twitter:card" ... />` line) with:

```astro
    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Delta Climate Research" />
    <meta property="og:locale" content="en" />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:url" content={canonical} />
    <meta name="twitter:card" content="summary" />
    <meta name="author" content="Delta Climate Research" />
    <meta name="theme-color" content="#050606" />

    <!-- Structured data (demo-safe: only truthful facts) -->
    <script type="application/ld+json" set:html={JSON.stringify(jsonLd)} />
```

(Leave everything else — charset, viewport, icon, title, description, canonical, font preload,
`ClientRouter`, the pre-paint script — unchanged.)

- [ ] **Step 3: Build + verify**

Run:
```bash
npm run build
echo "--- og/meta ---"
for t in 'og:site_name' 'og:locale' 'theme-color' 'name="author"' 'content="summary"'; do grep -q "$t" dist/index.html && echo "OK $t" || echo "MISS $t"; done
echo "--- json-ld parses + has nodes ---"
node -e "const h=require('fs').readFileSync('dist/index.html','utf8');const m=h.match(/<script type=\"application\/ld\+json\">(.*?)<\/script>/s);const j=JSON.parse(m[1]);console.log('graph nodes:', j['@graph'].map(n=>n['@type']));console.log('org url:', j['@graph'][0].url);"
```
Expected: all meta `OK`; JSON-LD parses; graph nodes show `[ ['Organization','ProfessionalService'], 'WebSite' ]`; org url is the real domain.

- [ ] **Step 4: Commit**

```bash
git add src/layouts/Base.astro
git commit -m "feat: complete head meta + demo-safe JSON-LD structured data"
```

---

## Task 4: Unique per-page descriptions

**Files:** Modify `src/pages/white-papers/index.astro`.

The white-papers stub passes no `description`, so it inherits the home/brand default → duplicate
meta description. Give it a unique one. (The home `index.astro` correctly uses the default.)

- [ ] **Step 1: Pass a unique description**

In `src/pages/white-papers/index.astro`, change the opening Base tag:

```astro
<Base title="White Papers — Delta Climate Research">
```

to:

```astro
<Base
  title="White Papers — Delta Climate Research"
  description="Research notes from Delta Climate Research on urban-heat vulnerability mapping, blue-carbon MRV, and embodied-carbon accounting."
>
```

- [ ] **Step 2: Build + verify the two pages differ**

Run:
```bash
npm run build
echo "home: $(grep -o '<meta name=\"description\" content=\"[^\"]*\"' dist/index.html | head -1)"
echo "wp:   $(grep -o '<meta name=\"description\" content=\"[^\"]*\"' dist/white-papers/index.html | head -1)"
```
Expected: the two description strings are different.

- [ ] **Step 3: Commit**

```bash
git add src/pages/white-papers/index.astro
git commit -m "feat: unique meta description for white-papers page"
```

---

## Task 5: Remove dead dependencies

**Files:** Modify `package.json`.

`three` and `@types/three` are not imported in `src` and not in the client bundle (verified).

- [ ] **Step 1: Uninstall**

Run: `npm uninstall three @types/three`
Expected: removes both; updates `package.json` + lockfile.

- [ ] **Step 2: Verify gone + build still green**

Run:
```bash
grep -i "three" package.json || echo "no three in package.json"
npm run check 2>&1 | tail -2
npm run build 2>&1 | tail -2
```
Expected: "no three in package.json"; check + build succeed.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove dead three + @types/three dependencies"
```

---

## Task 6: Custom 404 page

**Files:** Create `src/pages/404.astro`.

Mirror the white-papers stub's structure/style (retained brand classes + inline layout styles —
this page is not part of the Tailwind-migrated component set, so matching the stub is consistent).

- [ ] **Step 1: Create the page**

Create `src/pages/404.astro` with:

```astro
---
import Base from '../layouts/Base.astro';
import Nav from '../components/Nav.astro';
import Footer from '../components/Footer.astro';
---

<Base
  title="Page not found — Delta Climate Research"
  description="The page you're looking for doesn't exist."
>
  <Nav />
  <main
    class="wrap"
    style="min-height:100dvh; display:flex; flex-direction:column; justify-content:center; padding-block:8rem;"
  >
    <p class="sec-index">404</p>
    <h1 class="sec-title" style="max-width:24ch;">This page drifted <em>off-map.</em></h1>
    <p style="margin-top:1.25rem; max-width:56ch; color:var(--color-ink-muted); line-height:1.6;">
      The page you're looking for doesn't exist or has moved. Head back to the
      <a class="accent-link" href="/">home page ↗</a>.
    </p>
  </main>
  <Footer />
</Base>
```

- [ ] **Step 2: Build + verify**

Run: `npm run build && ls dist/404.html && grep -o '<title>[^<]*</title>' dist/404.html`
Expected: `dist/404.html` exists; title is "Page not found — Delta Climate Research".

- [ ] **Step 3: Commit**

```bash
git add src/pages/404.astro
git commit -m "feat: branded custom 404 page"
```

---

## Task 7: Final verification

**Files:** none.

- [ ] **Step 1: Clean build + full SEO surface check**

Run:
```bash
npm run check && npm run build
echo "=== crawl files ==="
ls dist/robots.txt dist/sitemap-index.xml dist/sitemap-0.xml dist/404.html
echo "=== canonical/og use real domain, no .example anywhere ==="
grep -rl "delta-climate-research.example" dist/ && echo "LEAK: .example still present" || echo "OK no .example"
echo "=== sitemap lists both pages ==="
grep -o '<loc>[^<]*</loc>' dist/sitemap-0.xml
echo "=== one json-ld block, valid ==="
grep -c 'application/ld+json' dist/index.html
```
Expected: all files present; "OK no .example"; sitemap lists home + white-papers; exactly 1 JSON-LD block.

- [ ] **Step 2: Confirm no visual/behaviour regression (optional spot check)**

Run: `(npm run preview > /tmp/p.log 2>&1 &) ; sleep 4; curl -s -o /dev/null -w "home %{http_code}\n" http://localhost:4321/; curl -s -o /dev/null -w "404 %{http_code}\n" http://localhost:4321/nonexistent; pkill -f "astro preview"`
Expected: home 200; the 404 route serves the custom page (Astro preview returns 404 status with the page body).

- [ ] **Step 3: Final commit (if anything uncommitted)**

```bash
git status --porcelain
```
Expected: clean (all changes already committed in Tasks 1–6).

---

## Self-Review Summary

- **Spec coverage:** site URL + sitemap (Task 1) · robots (Task 2) · JSON-LD Org/ProfessionalService + WebSite, demo-safe, niche-led (Task 3) · head tags + twitter:card→summary (Task 3) · unique descriptions (Task 4) · remove three/@types/three (Task 5) · custom 404 (Task 6) · verification (Task 7). Font-subset item intentionally OMITTED per spec §3.4 correction (no real win).
- **Demo-safe schema:** no email/phone/address/sameAs anywhere in the JSON-LD; only name/url/logo/description/areaServed/knowsAbout.
- **DRY:** `BRAND_DESCRIPTION` const feeds both the default meta description and the JSON-LD org description; `Astro.site` feeds both canonical and JSON-LD `@id`s — domain defined once (in `astro.config.mjs`).
- **Consistency:** `site` URL string identical across config, robots.txt, and (derived) JSON-LD; `knowsAbout` order matches the positioning memory (research-led first, CBAM last).
