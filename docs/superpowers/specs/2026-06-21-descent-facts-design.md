# Descent Facts — Climate Clock during the plunge · Design

**Status:** Approved feel (live-prototyped in `previews/facts.html`). **Date:** 2026-06-21. **Branch:** `feat/river-plunge-phase2`.

## Goal
Fix the "feels stuck" dead-scroll through the dark engulf: as you descend through the black water before 01, surface a sequence of **animated Climate Clock facts** — big editorial statements whose numbers count up as you sink, then sink away as the next surfaces. Turns empty scroll into a purposeful "descent through the data."

## Locked feel (from the approved preview)
- **Statements** style: one fact at a time, centred, huge value + cyan unit + small mono kicker + faint label + tiny source.
- **Count-up scrubbed to scroll** (number builds as you enter the fact's window), **sin fade** in→out, slight rise.
- **5 facts, in order:** `5 YRS` until the 1.5°C budget · `$32 TRILLION` saved if we act now · `11.4%` world energy from renewables · `17.6%` of land & waters protected · `$40.8 TRILLION` divested from fossil fuels.

## Architecture
Two new files + small edits, all desktop+motion only (the descent doesn't exist on mobile/RM):
- **`src/components/DescentFacts.astro`** — the overlay markup (a `position:absolute` layer in the hero, `pointer-events:none`, `z-[3]`, above the engulf canvas/dim/grain) with 5 `.dfact` nodes (kick / `[data-n]` value / unit / label / source), each `opacity:0`. Plus the scoped styles (the big-statement treatment from `previews/facts.html`).
- **`src/scripts/descent-facts.ts`** — `initDescentFacts()` / `destroyDescentFacts()`:
  - **Data:** fetch `https://api.climateclock.world/v2/clock.json` (open CORS, no key; sessionStorage-cached like `ClimateClock.astro`). Resolve each fact's current value via `initial + rate * secondsSince(origin)` (reuse the `LIFELINES`-style constants as the fallback so it works offline / on fetch failure). The deadline fact computes whole years left from the 2029-07-22 timestamp.
  - **Scrub:** one `ScrollTrigger.create({ trigger:'#hero-track', start:'top top', end:'bottom bottom', scrub:true, onUpdate })`. This is a SECOND, independent trigger on the same track — it reads the same scroll as the engulf (perfectly in sync) and never touches `activeST` or the seam-snap.
  - **Per-fact window:** the 5 facts span progress **0.58 → 0.92** (the dark-water + deep portion, after the water has engulfed, before the splash). Each fact `i` owns `[a, a+seg]` with `seg=(0.92-0.58)/5`. In `onUpdate(p)`: `local=smoothstep(a,b,p)`, `opacity=sin(π·local)`, `count=value·smoothstep(a, a+seg·0.55, p)`, `translateY=(0.5-local)·70px`. Write `count` (formatted, with thousands/decimals per fact) into `[data-n]`.
  - **Gating:** return early unless `motionOK()` && `matchMedia('(min-width: 768px)')`. `destroyDescentFacts` kills the trigger + `clearProps` the nodes.
- **`src/components/Hero.astro`** — mount `<DescentFacts />` as a hero layer (after `.grain`, before `data-hero-content`), and **extend the track**: `.hero-track { height: 250vh → 340vh; }` so the 0.58–0.92 window has real scroll room (~27vh per fact). The engulf phases are progress-space, so they just play over more scroll (a more deliberate plunge) — exact height is QA-tunable.
- **`src/layouts/Base.astro`** — import + wire `initDescentFacts`/`destroyDescentFacts` into `initScroll` (after `initSeamSnap`) and `teardownScroll`, mirroring the others.

## Data flow
`initDescentFacts` → fetch (or cache/fallback) → 5 resolved facts → build the scrub trigger → `onUpdate` drives opacity/count/translate per fact. No SSR data; the Astro component ships static markup + the fallback values are inlined so first paint never shows `0` if JS is slow (the `[data-n]` starts at the fallback value, count overrides it on scroll).

## Degradation
- **Reduced-motion / mobile (<768px):** `initDescentFacts` no-ops; the overlay stays `opacity:0` (or `display:none` via the gate) — no facts, no track extension effect (the engulf/seam-snap also don't build there; the static hero + the existing top-right `ClimateClock` widget already carry the data on mobile).
- **Fetch failure / offline:** fallback constants render; the facts still play.
- **60fps:** the overlay animates `opacity`/`transform` + a text node per frame (5 nodes) — trivial; the engulf keeps its steady-state scrub.

## Coexistence (verified-safe shape)
- Separate ScrollTrigger on `#hero-track` → in sync with the engulf, independent lifecycle. Does NOT touch `activeST` (engulf) or the seam-snap. The seam-snap fires at `#hero-track bottom 92%` → past the facts window (0.92), so the last fact has cleared as the throw begins.
- The headline (`data-hero-content`) fades out by ~0.4 (existing), so the facts (0.58+) never collide with it.

## Verification
- Live desktop scroll on `localhost:4321`: through the dark water the 5 facts surface in turn, numbers count up, fade through, clear before the splash into 01. No overlap with the headline; in sync with the engulf.
- Probe: at progress ~0.65 a fact is visible (opacity > 0.5); at ~0.99 all facts cleared (opacity ~0).
- Reduced-motion + <768px: no facts overlay, no errors, hero normal.
- `npm run build` green.

## Out of scope
The engulf shader + the seam-snap (done, untouched); the top-right ClimateClock widget (unchanged); a mobile-specific facts treatment.
