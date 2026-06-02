# Scroll-Linked Effects — Design Spec

**Date:** 2026-06-02
**Status:** Approved for planning
**Author:** Brainstormed with Claude (superpowers:brainstorming)
**Preview:** [`previews/scroll-effects.html`](../../../previews/scroll-effects.html)

## 1. Goal

Adopt the scroll-driven techniques from Olivier Larose's smooth-scroll tutorial
(https://blog.olivierlarose.com/tutorials/smooth-scroll) into the Delta Climate
Research site, adapted to its restrained, editorial aesthetic.

The site already has the tutorial's smooth scroll (Lenis) and a staggered-reveal
system (IntersectionObserver). This work adds the three techniques it lacks:

1. **Parallax depth** — differential scroll-speed on text and layered media.
2. **Scrub clip-path reveals** — large visual blocks "wipe open" as they enter.
3. **Scroll progress cues** — a page progress line + per-section divider draws.

Intensity is locked at **editorial-noticeable** (≈10% parallax travel, ≈16% clip
inset). The pinned-section technique from the tutorial was deliberately **excluded**
as too aggressive for the brand.

## 2. Stack Decision

- **Engine:** GSAP + ScrollTrigger (the tutorial's stack), chosen over a native
  Lenis-driven approach for battle-tested scrub behavior. Adds the `gsap` dependency
  (ScrollTrigger is in GSAP's free tier).
- **Smooth scroll:** existing **Lenis**, rewired to drive ScrollTrigger.

### Lenis ↔ ScrollTrigger integration (canonical pattern)

The current manual `requestAnimationFrame` loop in [`Base.astro`](../../../src/layouts/Base.astro)
is replaced by GSAP's ticker so Lenis and ScrollTrigger share one clock:

```js
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((time) => lenis.raf(time * 1000));
gsap.ticker.lagSmoothing(0);
```

## 3. Architecture

Scroll logic moves out of the inline `<script>` in `Base.astro` into two focused
ES modules under `src/scripts/`:

| Module | Responsibility |
| --- | --- |
| `src/scripts/smooth-scroll.ts` | Create/destroy Lenis, wire the GSAP ticker, handle smooth same-page anchor clicks. Exposes `initSmoothScroll()` / `destroySmoothScroll()` and the active `lenis` instance. |
| `src/scripts/scroll-effects.ts` | Register ScrollTrigger; scan the DOM for the declarative attributes (below) and build the parallax/clip/draw/progress tweens. Exposes `initScrollEffects()` / `destroyScrollEffects()`. |

`Base.astro` keeps a thin orchestration `<script>` that:
- runs both `init*` functions on first load and on `astro:page-load`,
- runs both `destroy*` functions on `astro:before-swap` (extends the existing teardown),
- keeps the existing IntersectionObserver reveal system (`setupReveals`) **unchanged**.

The existing pre-paint `reveal-ready` gate stays. A parallel guard governs the new
effects: they initialize **only** when `prefers-reduced-motion: no-preference`.

## 4. Declarative Attribute API

Components opt into effects with data attributes; no per-component GSAP code. The
driver in `scroll-effects.ts` reads them on init.

| Attribute | Effect | Value |
| --- | --- | --- |
| `data-parallax="-0.05"` | Element drifts vertically at `factor` of its scroll span (negative = rises faster than scroll). Scrubbed over `top bottom → bottom top`. | signed float |
| `data-clip` | `clip-path: inset()` wipe-open + slight opacity fade-in on entry. Scrubbed over `top 85% → top 45%`. | (boolean) |
| `data-draw` | Hairline overlay scales `scaleX 0→1` left→right. Scrubbed over `top 95% → top 60%`. | (boolean) |
| `data-progress` | Page progress line scales `scaleX 0→1` over the full document scroll. | (boolean, single element) |

### Locked intensity constants (editorial-noticeable)

```
PARALLAX_SCALE = 2.0     // multiplies each element's data-parallax factor (~10% travel)
CLIP_INSET     = 16      // starting inset %, animates to 0
CLIP_OPACITY   = 0.6     // starting opacity, animates to 1
```

These live as named constants at the top of `scroll-effects.ts`.

## 5. Effect Placement (element-by-element)

| Section / element | Attribute(s) |
| --- | --- |
| Hero `.kicker`, `.headline` span, `.accent`, `.lede`, `.corner` | `data-parallax` at staggered factors (−0.04 / −0.02 / −0.06 / −0.08 / +0.06) |
| About `.about-visual` (FIG.01 panel) | `data-clip`; inner gradient layer gets `data-parallax="-0.05"` |
| Medni `.dashboard` | `data-clip` |
| Each `.divider-top` section | a `.draw-line` hairline overlay with `data-draw` |
| New progress line under the nav | `data-progress` |
| Project rail `.cover`s | **none** — excluded (horizontal-scroll context would feel busy) |

### Markup additions
- A `data-parallax` wrapper/attribute on the hero text spans (Hero already splits
  words; we add attributes without restructuring).
- A `<span class="visual-bg" data-parallax="-0.05">` layer inside `.about-visual`.
- A `<span class="draw-line" data-draw>` inside each `divider-top` section.
- A `<div class="progress" data-progress>` element in [`Nav.astro`](../../../src/components/Nav.astro),
  positioned at the nav's bottom edge.

## 6. Accessibility & Fallbacks (non-negotiable)

- **Reduced motion:** `scroll-effects.ts` early-returns; no tweens are created. All
  affected elements rest in their natural, fully-visible final state. Initial CSS
  must never hide content — GSAP sets the "from" state at runtime only when motion
  is allowed (mirrors the `reveal-ready` discipline already in the codebase).
- **No-JS:** content fully visible, native scroll (unchanged from today).
- **clip-path safety:** the `data-clip` elements are fully visible by default in CSS;
  the inset "from" state is applied by GSAP, so a JS/library failure degrades to
  visible content, never a blank panel.
- **No double-animation:** GSAP owns only `data-parallax` / `data-clip` / `data-draw`
  / `data-progress`. The IntersectionObserver system keeps owning `data-reveal` /
  `data-reveal-group`. The two never touch the same property on the same element.

## 7. View-Transition Lifecycle

Astro's `ClientRouter` swaps pages without a full reload. On every swap:
- `astro:before-swap` → `destroyScrollEffects()` (`ScrollTrigger.getAll().forEach(t => t.kill())`)
  and `destroySmoothScroll()` (`lenis.destroy()`, cancel ticker hookup).
- `astro:page-load` → `initSmoothScroll()` then `initScrollEffects()` then
  `ScrollTrigger.refresh()`.

This prevents orphaned triggers/tickers accumulating across navigations.

## 8. Performance

- All animated properties are compositor-friendly: `transform` (parallax/draw/progress)
  and `clip-path` + `opacity` (reveals). No layout-thrashing properties.
- `scrub: true` ties progress to Lenis's smoothed scroll; one ticker drives everything.
- `ScrollTrigger.refresh()` runs after fonts/layout settle (on `page-load`) to fix
  measured start/end positions.

## 9. Verification

- `npm run build` passes; `npm run check` (astro check) passes.
- Manual desktop pass: parallax reads as depth, both clip blocks wipe cleanly,
  progress line tracks scroll, divider draws fire per section.
- Manual mobile (≤720px) pass: effects degrade gracefully, no horizontal overflow.
- Reduced-motion emulation: a clean, fully static site with native scroll.
- View-transition pass: navigate to `/white-papers` and back; no duplicated triggers
  (check `ScrollTrigger.getAll().length` is stable).

## 10. Out of Scope

- Pinned/sticky scroll sections (tutorial technique, intentionally excluded).
- Effects on the horizontal project rail.
- Any change to the existing IntersectionObserver reveal behavior or timing.
