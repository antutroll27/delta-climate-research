# Scroll-Linked Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add parallax depth, scrub clip-path reveals, and scroll progress cues to the Delta Climate Research site using GSAP + ScrollTrigger driven by the existing Lenis smooth scroll.

**Architecture:** Two new ES modules (`smooth-scroll.ts` rewires Lenis onto GSAP's ticker; `scroll-effects.ts` builds ScrollTrigger tweens from declarative `data-*` attributes). `Base.astro` orchestrates their lifecycle across Astro view transitions. Components opt in via attributes; the existing IntersectionObserver reveal system is left untouched. Effects initialize only when `prefers-reduced-motion: no-preference`.

**Tech Stack:** Astro, GSAP 3.13 + ScrollTrigger, Lenis 1.3, TypeScript.

**Spec:** [`docs/superpowers/specs/2026-06-02-scroll-effects-design.md`](../specs/2026-06-02-scroll-effects-design.md)
**Preview:** [`previews/scroll-effects.html`](../../../previews/scroll-effects.html)

**Verification note:** This is front-end animation work; behavior is verified by `npm run build`, `npm run check` (astro check / tsc), and a manual browser pass (including a reduced-motion emulation). There are no unit tests in this codebase, so steps use build/type gates + an explicit manual checklist rather than fabricated test files.

**Intensity constants (locked — "editorial-noticeable"):**
- `PARALLAX_SCALE = 2.0`
- `CLIP_INSET = 16` (percent; must match the `16%` literal in `global.css` — see Task 5)
- `CLIP_OPACITY = 0.6`

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `package.json` | Declare the `gsap` dependency | Modify |
| `src/scripts/smooth-scroll.ts` | Lenis lifecycle + GSAP-ticker wiring + smooth anchors | Create |
| `src/scripts/scroll-effects.ts` | ScrollTrigger driver reading `data-parallax/clip/draw/progress` | Create |
| `src/layouts/Base.astro` | Orchestrate init/destroy across view transitions | Modify |
| `src/styles/global.css` | `.section` positioning, `.draw-line`, clip pre-paint state | Modify |
| `src/components/Nav.astro` | Add the page-progress line element + its scoped style | Modify |
| `src/components/Hero.astro` | `data-parallax` on kicker / headline / lede-wrap / corner | Modify |
| `src/components/About.astro` | `data-clip` panel + `.visual-bg` parallax + `data-draw` | Modify |
| `src/components/Projects.astro` | `data-draw` line | Modify |
| `src/components/WhitePapers.astro` | `data-draw` line | Modify |
| `src/components/Medni.astro` | `data-clip` dashboard + `data-draw` line | Modify |
| `src/components/CtaClose.astro` | `data-draw` line | Modify |
| `src/components/Footer.astro` | `data-draw` line + positioning context | Modify |

---

## Task 1: Add the GSAP dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add gsap to dependencies**

In `package.json`, add `"gsap": "^3.13.0"` to the `dependencies` block (alphabetical order — after `astro`, before `lenis`):

```json
  "dependencies": {
    "@fontsource-variable/geist-mono": "^5.2.8",
    "@fontsource/spectral": "^5.2.8",
    "astro": "^6.4.2",
    "gsap": "^3.13.0",
    "lenis": "^1.3.23",
    "tailwindcss": "^4.3.0",
    "three": "^0.184.0"
  },
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: completes without error; `node_modules/gsap` now exists.

- [ ] **Step 3: Verify install**

Run: `ls node_modules/gsap/dist/ScrollTrigger.min.js && echo OK`
Expected: prints the path and `OK`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add gsap dependency for scroll effects"
```

---

## Task 2: Create the smooth-scroll module

Moves Lenis out of `Base.astro`'s inline script and rewires it onto GSAP's ticker (the canonical Lenis↔ScrollTrigger integration), so one clock drives both.

**Files:**
- Create: `src/scripts/smooth-scroll.ts`

- [ ] **Step 1: Write the module**

```ts
// src/scripts/smooth-scroll.ts
// Lenis smooth scroll, wired to drive GSAP's ScrollTrigger off a single ticker.
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

let lenis: Lenis | undefined;
let tickerFn: ((time: number) => void) | undefined;

const motionOK = () =>
  window.matchMedia('(prefers-reduced-motion: no-preference)').matches;

function onAnchorClick(e: MouseEvent) {
  const a = e.currentTarget as HTMLAnchorElement;
  const hash = a.getAttribute('href')!.split('#')[1];
  const target = hash ? document.getElementById(hash) : null;
  if (target && lenis) {
    e.preventDefault();
    lenis.scrollTo(target, { offset: -80, duration: 1.1 });
  }
}

export function initSmoothScroll() {
  // Respect reduced motion: leave native scroll entirely alone.
  if (!motionOK()) return;
  destroySmoothScroll(); // idempotent re-init

  lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1, smoothWheel: true });

  // Keep ScrollTrigger in sync with Lenis's smoothed scroll position.
  lenis.on('scroll', ScrollTrigger.update);
  tickerFn = (time: number) => lenis!.raf(time * 1000);
  gsap.ticker.add(tickerFn);
  gsap.ticker.lagSmoothing(0);

  // Smooth same-page anchor navigation (nav links, CTAs).
  document
    .querySelectorAll<HTMLAnchorElement>('a[href^="#"], a[href^="/#"]')
    .forEach((a) => a.addEventListener('click', onAnchorClick));
}

export function destroySmoothScroll() {
  if (tickerFn) {
    gsap.ticker.remove(tickerFn);
    tickerFn = undefined;
  }
  lenis?.destroy();
  lenis = undefined;
}
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: PASS (no type errors). If `astro check` reports the module is unused, that is fine — Task 4 imports it.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/smooth-scroll.ts
git commit -m "feat: extract Lenis into smooth-scroll module wired to GSAP ticker"
```

---

## Task 3: Create the scroll-effects driver

Reads declarative attributes and builds the ScrollTrigger tweens. Clip elements read their own computed corner radius so the wipe preserves rounded corners (panels are 14px, the Medni dashboard is 16px).

**Files:**
- Create: `src/scripts/scroll-effects.ts`

- [ ] **Step 1: Write the module**

```ts
// src/scripts/scroll-effects.ts
// Declarative scroll-linked effects: parallax, clip-path reveals, draw lines,
// page progress. Driven by data-* attributes; built only when motion is allowed.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// "editorial-noticeable" intensity (see spec §4). CLIP_INSET must stay in sync
// with the 16% literal in global.css's pre-paint rule.
const PARALLAX_SCALE = 2.0;
const CLIP_INSET = 16;
const CLIP_OPACITY = 0.6;

const motionOK = () =>
  window.matchMedia('(prefers-reduced-motion: no-preference)').matches;

export function initScrollEffects() {
  if (!motionOK()) return;

  // PARALLAX — drift vertically across the element's scroll span.
  document.querySelectorAll<HTMLElement>('[data-parallax]').forEach((el) => {
    const factor = parseFloat(el.dataset.parallax || '0') * PARALLAX_SCALE;
    if (!factor) return;
    gsap.fromTo(
      el,
      { yPercent: 0 },
      {
        yPercent: factor * 100,
        ease: 'none',
        scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true },
      }
    );
  });

  // CLIP-PATH wipe-open + slight fade, scrubbed over the entrance.
  document.querySelectorAll<HTMLElement>('[data-clip]').forEach((el) => {
    const radius = getComputedStyle(el).borderTopLeftRadius || '0px';
    gsap.fromTo(
      el,
      { clipPath: `inset(${CLIP_INSET}% round ${radius})`, opacity: CLIP_OPACITY },
      {
        clipPath: `inset(0% round ${radius})`,
        opacity: 1,
        ease: 'none',
        scrollTrigger: { trigger: el, start: 'top 85%', end: 'top 45%', scrub: true },
      }
    );
  });

  // DRAW — hairline overlay scales in left→right.
  document.querySelectorAll<HTMLElement>('[data-draw]').forEach((el) => {
    gsap.fromTo(
      el,
      { scaleX: 0 },
      {
        scaleX: 1,
        ease: 'none',
        scrollTrigger: { trigger: el, start: 'top 95%', end: 'top 60%', scrub: true },
      }
    );
  });

  // PAGE PROGRESS line (single element).
  const progress = document.querySelector<HTMLElement>('[data-progress]');
  if (progress) {
    gsap.fromTo(
      progress,
      { scaleX: 0 },
      {
        scaleX: 1,
        ease: 'none',
        scrollTrigger: {
          trigger: document.documentElement,
          start: 'top top',
          end: 'bottom bottom',
          scrub: true,
        },
      }
    );
  }

  ScrollTrigger.refresh();
}

export function destroyScrollEffects() {
  ScrollTrigger.getAll().forEach((t) => t.kill());
}
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/scroll-effects.ts
git commit -m "feat: add declarative scroll-effects driver (parallax/clip/draw/progress)"
```

---

## Task 4: Wire lifecycle into Base.astro

Replace the inline Lenis block with module orchestration. The IntersectionObserver `setupReveals` block stays exactly as-is.

**Files:**
- Modify: `src/layouts/Base.astro:62-113` (the first `<script>` — the Lenis block only)

- [ ] **Step 1: Replace the Lenis inline script**

Find the first `<script>` block (the one that begins `import Lenis from 'lenis';` and ends just before `function setupReveals()`). Replace **only that Lenis script block** with:

```astro
    <script>
      import { initSmoothScroll, destroySmoothScroll } from '../scripts/smooth-scroll';
      import { initScrollEffects, destroyScrollEffects } from '../scripts/scroll-effects';

      function initScroll() {
        // destroy-first makes init idempotent (page-load can fire after a prior init)
        destroyScrollEffects();
        destroySmoothScroll();
        initSmoothScroll();
        initScrollEffects();
      }

      function teardownScroll() {
        destroyScrollEffects();
        destroySmoothScroll();
      }

      // astro:page-load fires on first load AND after every view-transition nav.
      document.addEventListener('astro:page-load', initScroll);
      // Kill triggers/ticker before the DOM is swapped out.
      document.addEventListener('astro:before-swap', teardownScroll);
    </script>
```

Leave the **second** `<script>` (the `setupReveals` IntersectionObserver block) untouched.

- [ ] **Step 2: Confirm no leftover Lenis references**

Run: `grep -n "Lenis\|lenis" src/layouts/Base.astro`
Expected: only the CSS import line `import 'lenis/dist/lenis.css';` in frontmatter remains. No `new Lenis`, no `rafId`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds; `dist/` regenerated.

- [ ] **Step 4: Commit**

```bash
git add src/layouts/Base.astro
git commit -m "feat: orchestrate scroll modules across Astro view transitions"
```

---

## Task 5: Global CSS — positioning, draw-line, progress, clip pre-paint

**Files:**
- Modify: `src/styles/global.css` (inside the existing `@layer base { … }`, after the `.divider-top` rule near line 104)

- [ ] **Step 1: Add the effect styles**

Add this block inside `@layer base`, immediately after the `.divider-top { … }` rule:

```css
  /* --- scroll effects --- */

  /* sections become the positioning context for their draw-line overlay */
  .section { position: relative; }

  /* draw-line: cyan accent overlaying the divider hairline, scaled in on scroll */
  .draw-line {
    position: absolute;
    top: -1px;
    left: 0;
    height: 1px;
    width: 100%;
    background: var(--color-cyan);
    opacity: 0.6;
    transform: scaleX(0);
    transform-origin: 0 50%;
    pointer-events: none;
  }

  /* clip-path reveal: hide the "from" state pre-paint so there is no first-load
     flash. Reuses the existing reveal-ready gate (added only when motion is OK),
     so no-JS / reduced-motion keeps the panels fully visible.
     NOTE: 16% must match CLIP_INSET in scroll-effects.ts. */
  @media (prefers-reduced-motion: no-preference) {
    .reveal-ready [data-clip] {
      clip-path: inset(16% round var(--clip-radius, 14px));
      opacity: 0.6;
    }
  }

  /* reduced motion: decorative scaled-from-zero overlays would otherwise sit
     invisible; hide them outright for tidiness. */
  @media (prefers-reduced-motion: reduce) {
    .draw-line,
    .nav-progress { display: none; }
  }
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds (Tailwind/PostCSS compiles the new rules).

- [ ] **Step 3: Commit**

```bash
git add src/styles/global.css
git commit -m "feat: base styles for draw-line, progress, and clip pre-paint state"
```

---

## Task 6: Nav — page-progress line

**Files:**
- Modify: `src/components/Nav.astro` (markup after `</header>`, line ~39; scoped style)

- [ ] **Step 1: Add the progress element**

Immediately after the closing `</header>` tag (before the `<!-- mobile full-screen overlay -->` comment), add:

```astro
<!-- page scroll-progress line (driven by scroll-effects.ts) -->
<div class="nav-progress" data-progress aria-hidden="true"></div>
```

- [ ] **Step 2: Add the scoped style**

Inside Nav's `<style>` block, after the `.site-nav { … }` rule, add:

```css
  .nav-progress {
    position: fixed;
    top: 80px; /* sits at the nav's bottom edge */
    left: 0;
    z-index: 50;
    height: 2px;
    width: 100%;
    background: var(--color-cyan);
    box-shadow: 0 0 12px rgb(111 202 214 / 0.5);
    transform: scaleX(0);
    transform-origin: 0 50%;
    pointer-events: none;
  }
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/Nav.astro
git commit -m "feat: add scroll-progress line to nav"
```

---

## Task 7: Hero — parallax depth

Parallax is applied to elements **without** the CSS entrance animation (kicker, corner) directly, and to a **wrapper** around the animated `.lede` so GSAP's transform doesn't collide with the CSS `rise` animation. The `<h1>` itself has no animation (only its `.word` children do), so it takes the attribute directly.

**Files:**
- Modify: `src/components/Hero.astro:11-25`

- [ ] **Step 1: Add parallax to the kicker**

Change line 11 from:

```astro
    <p class="kicker" style="--i:0">Research-led climate intelligence</p>
```

to:

```astro
    <p class="kicker" style="--i:0" data-parallax="-0.04">Research-led climate intelligence</p>
```

- [ ] **Step 2: Add parallax to the headline**

Change the opening `<h1 class="headline">` tag (line 13) to:

```astro
    <h1 class="headline" data-parallax="-0.06">
```

- [ ] **Step 3: Wrap the lede in a parallax container**

Replace the lede block (lines 20-22):

```astro
    <p class="lede word" style="--i:9">
      Decision-grade climate-risk and embodied-carbon intelligence, interpreted with rigor.
    </p>
```

with:

```astro
    <div data-parallax="-0.08">
      <p class="lede word" style="--i:9">
        Decision-grade climate-risk and embodied-carbon intelligence, interpreted with rigor.
      </p>
    </div>
```

- [ ] **Step 4: Add parallax to the corner note**

Change line 25 from:

```astro
  <p class="corner" style="--i:10">Built for the frontier.</p>
```

to:

```astro
  <p class="corner" style="--i:10" data-parallax="0.06">Built for the frontier.</p>
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/Hero.astro
git commit -m "feat: parallax depth on hero text"
```

---

## Task 8: About — clip reveal, layered parallax, draw-line

**Files:**
- Modify: `src/components/About.astro` (section tag line 10; visual aside lines 35-37; scoped style)

- [ ] **Step 1: Add the draw-line to the section**

Change the opening section tag + add the draw-line as its first child. Replace line 10:

```astro
<section id="about" class="section divider-top" aria-labelledby="about-title">
```

with:

```astro
<section id="about" class="section divider-top" aria-labelledby="about-title">
  <span class="draw-line" data-draw aria-hidden="true"></span>
```

- [ ] **Step 2: Add clip + inner parallax layer to the visual**

Replace the `.about-visual` aside (lines 35-37):

```astro
    <aside class="about-visual" aria-hidden="true" data-reveal>
      <span class="visual-tag">FIG. 01 — SYSTEMS MAP</span>
    </aside>
```

with:

```astro
    <aside class="about-visual" aria-hidden="true" data-reveal data-clip>
      <span class="visual-bg" data-parallax="-0.05"></span>
      <span class="visual-tag">FIG. 01 — SYSTEMS MAP</span>
    </aside>
```

- [ ] **Step 3: Add visual-bg style + overflow clipping**

In About's `<style>`, change the `.about-visual` rule to add `overflow: hidden`, and add a `.visual-bg` rule after it:

```css
  .about-visual {
    position: relative;
    min-height: 320px;
    overflow: hidden;
    border: 1px solid var(--color-hairline);
    border-radius: 14px;
    background:
      radial-gradient(80% 80% at 70% 20%, rgb(111 202 214 / 0.08), transparent 60%),
      var(--color-surface);
  }
  /* parallax layer — drifts slower than the frame for depth */
  .visual-bg {
    position: absolute;
    inset: -12% -4%;
    background: radial-gradient(40% 50% at 30% 30%, rgb(176 141 87 / 0.22), transparent 70%);
    pointer-events: none;
  }
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/About.astro
git commit -m "feat: clip reveal + layered parallax + draw-line in About"
```

---

## Task 9: Projects — draw-line

**Files:**
- Modify: `src/components/Projects.astro:31`

- [ ] **Step 1: Add the draw-line**

Replace line 31:

```astro
<section id="projects" class="section divider-top" aria-labelledby="projects-title">
```

with:

```astro
<section id="projects" class="section divider-top" aria-labelledby="projects-title">
  <span class="draw-line" data-draw aria-hidden="true"></span>
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/Projects.astro
git commit -m "feat: draw-line on Projects divider"
```

---

## Task 10: White Papers — draw-line

**Files:**
- Modify: `src/components/WhitePapers.astro:34`

- [ ] **Step 1: Add the draw-line**

Replace line 34:

```astro
<section id="papers" class="section divider-top" aria-labelledby="papers-title">
```

with:

```astro
<section id="papers" class="section divider-top" aria-labelledby="papers-title">
  <span class="draw-line" data-draw aria-hidden="true"></span>
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/WhitePapers.astro
git commit -m "feat: draw-line on White Papers divider"
```

---

## Task 11: Medni — clip reveal + draw-line

The dashboard's `border-radius` is 16px, so set `--clip-radius: 16px` inline to keep the pre-paint CSS rounding correct (the JS reads the computed radius automatically).

**Files:**
- Modify: `src/components/Medni.astro` (section tag line 6; dashboard div line 16)

- [ ] **Step 1: Add the draw-line to the section**

Replace line 6:

```astro
<section id="medni" class="section divider-top" aria-labelledby="medni-title">
```

with:

```astro
<section id="medni" class="section divider-top" aria-labelledby="medni-title">
  <span class="draw-line" data-draw aria-hidden="true"></span>
```

- [ ] **Step 2: Add clip to the dashboard**

Replace line 16:

```astro
    <div class="dashboard" data-reveal>
```

with:

```astro
    <div class="dashboard" data-reveal data-clip style="--clip-radius: 16px;">
```

- [ ] **Step 3: Ensure the dashboard clips its content**

In Medni's `<style>`, add `overflow: hidden;` to the `.dashboard` rule (so the clip-path wipe has a clean edge). The rule becomes:

```css
  .dashboard {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.25rem;
    border: 1px solid var(--color-hairline);
    border-radius: 16px;
    overflow: hidden;
    padding: 1.25rem;
    background: var(--color-surface);
  }
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/Medni.astro
git commit -m "feat: clip reveal + draw-line in Medni"
```

---

## Task 12: CtaClose — draw-line

**Files:**
- Modify: `src/components/CtaClose.astro:5`

- [ ] **Step 1: Add the draw-line**

Replace line 5:

```astro
<section id="access" class="section divider-top cta-close" aria-labelledby="cta-title">
```

with:

```astro
<section id="access" class="section divider-top cta-close" aria-labelledby="cta-title">
  <span class="draw-line" data-draw aria-hidden="true"></span>
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/CtaClose.astro
git commit -m "feat: draw-line on CtaClose divider"
```

---

## Task 13: Footer — draw-line

The footer is a `<footer class="site-footer">`, not a `.section`, so it needs its own positioning context.

**Files:**
- Modify: `src/components/Footer.astro` (markup line 11; scoped style line 24)

- [ ] **Step 1: Add the draw-line**

Replace line 11:

```astro
<footer class="site-footer divider-top">
```

with:

```astro
<footer class="site-footer divider-top">
  <span class="draw-line" data-draw aria-hidden="true"></span>
```

- [ ] **Step 2: Give the footer a positioning context**

In Footer's `<style>`, change the `.site-footer` rule to add `position: relative;`:

```css
  .site-footer { position: relative; padding-block: clamp(2.5rem, 5vw, 4rem); }
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/Footer.astro
git commit -m "feat: draw-line on footer divider"
```

---

## Task 14: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type-check + build clean**

Run: `npm run check && npm run build`
Expected: both PASS, no errors.

- [ ] **Step 2: Manual desktop pass**

Run: `npm run dev` and open the printed localhost URL in a browser. Verify:
- Hero text shows subtle differential drift while scrolling (kicker/headline/lede/corner move at different rates).
- The About FIG.01 panel and the Medni dashboard **wipe open** (clip-path) as they scroll into view — and are fully visible at rest with correct rounded corners.
- The cyan progress line under the nav fills 0→100% across the full page scroll.
- Each section's divider hairline draws a cyan line left→right as it enters.
- No first-load flash of the clip panels (they should start clipped, not pop from full → clipped).

- [ ] **Step 3: Manual mobile pass**

In the browser devtools, switch to a ≤720px viewport. Verify: no horizontal overflow, effects still read cleanly, nothing overlaps the nav.

- [ ] **Step 4: Reduced-motion pass**

In devtools, emulate `prefers-reduced-motion: reduce` (Chrome: Rendering panel → "Emulate CSS prefers-reduced-motion"). Reload. Verify: native scroll (no smoothing), all content fully visible, no clip/parallax/draw/progress effects, progress line and draw-lines are hidden.

- [ ] **Step 5: View-transition pass**

With dev server running, navigate to `/white-papers` and back to `/`. In the console run `ScrollTrigger.getAll().length`. Verify the count is stable across navigations (no accumulation of orphaned triggers). Note: `ScrollTrigger` is on `window` only if exposed; if not accessible in console, instead confirm no console errors and that effects still work after navigating back.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "test: verify scroll effects across viewport, motion, and navigation" --allow-empty
```

---

## Self-Review Summary

- **Spec coverage:** parallax (Tasks 7, 8) · clip reveals (Tasks 8, 11) · progress line (Tasks 5, 6) · divider draws (Tasks 5, 8–13) · Lenis↔ScrollTrigger wiring (Task 2) · lifecycle across view transitions (Task 4) · reduced-motion & no-JS fallbacks (Tasks 2, 3, 5) · editorial-noticeable constants (Task 3). All spec §3–§7 items map to a task.
- **Excluded by spec:** pinned sections and project-rail effects — correctly absent.
- **Type/name consistency:** `initSmoothScroll`/`destroySmoothScroll`/`initScrollEffects`/`destroyScrollEffects` are defined in Tasks 2–3 and consumed verbatim in Task 4. `CLIP_INSET = 16` (Task 3) is explicitly coupled to the `16%` CSS literal (Task 5) with a NOTE in both places. `--clip-radius` is set on the only 16px element (Task 11) and defaulted to 14px in CSS (Task 5).
