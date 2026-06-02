# Hero v1 — animated WebGL field + frosted card (archived)

Saved 2026-06-01. Removed from the live hero so a different background can be tried.
This version had:
- `fluid-background.ts` — a Three.js Simplex-noise point-field ("climate currents"),
  cursor ripple, DPR cap, offscreen-pause, reduced-motion static fallback.
- `Hero.with-card-and-shader.astro` — hero with a `<canvas>` background + a frosted
  glass `.hero-card` wrapping the text for contrast over the animation.

## To restore
1. Copy `fluid-background.ts` back to `src/scripts/fluid-background.ts`.
2. Copy `Hero.with-card-and-shader.astro` back to `src/components/Hero.astro`.
3. `three` and `@types/three` are still in package.json (no reinstall needed).

The live hero now uses a static gradient background with no card.
