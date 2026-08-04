# Heat-map boot loader — "ground rise" ward point-cloud

**Date:** 2026-08-04
**Status:** design approved in preview; awaiting spec review
**Prototype:** `previews/heat-loader/particles.html` (style: ground rise) — the reference
for every visual constant; `previews/heat-loader/index.html` holds the three rejected
directions for the record.
**Lineage:** the hero hologram loader (`public/holo-engine.js`, Hero.astro) — Worker +
OffscreenCanvas, no WebGL, real-progress stages, dissolve handoff. Shipped and loved;
this is its sibling, not its copy.

## 1 · What it is

A loading animation over the map area of `/heat-map`, covering the gap between HTML
paint and the ward being ready — measured at ~1.5 s on broadband and 4–8 s on mobile
data. Today that gap shows one 0.52 rem text chip.

The ward is drawn as a point cloud of its own real data. A radial wave travels outward
from the ward centre and the city *prints upward* out of a breathing dust floor:
buildings rise as height-coloured columns with wireframe massing, roads resolve as ink
dots along the real ways, water fills turquoise, height callouts flicker onto the
tallest towers as the wave reaches each one. When every stage is done the massing
settles flat and the existing 2D→3D grow-in rises the real buildings out of it.

The user judged four condense choreographies (vortex, overpass sweep, ground rise,
orbital descent) at two durations; **ground rise** won. The settled final frame is
approved as-is and is the fixed target every refinement must preserve.

## 2 · Honesty rules, non-negotiable

- **Every number shown is true.** The stage ticker lines (`basemap · footprints ×3,527
  · google heights · roads ×500 · water ×7 · sim warm-up`) complete only when the real
  await they name resolves. The telemetry block (ward, coordinates, particle count,
  `overture 2026-07-22.0 · ee 2.5d 2023`) reads from the loaded artefacts, never from
  copy. Counts are per-ward and come from the data, so they can never drift stale.
- **No percentage, no fake progress.** The rail advances only on stage completion.
  The wave's radius pursues real progress (below) and simply arrives when loading
  arrives.
- **Every particle is real data.** Buildings from the ward JSON (position, measured
  height, heat-ramp colour by height), roads sampled along the real ways, water from
  the real polygons, plus a bounded land-dust scatter that is presentation, not data,
  and claims nothing.

## 3 · Choreography (constants from the prototype)

| phase | driver | what happens |
|---|---|---|
| dust | immediately, no data needed | dim cyan dust floor breathes; survey grid faintly present; ticker starts |
| rise | progress-driven radial wave, centre → 990 m | particle wavefront band (130 twinkling dots, golden-angle spread) travels outward; particles behind it rise into place with cubic ease-out and ~10 % overshoot; callouts appear as the wave reaches each of the 5 tallest buildings |
| settle | last ~18 % of progress | building particles sink flat (roads/water stay grounded), colours dim, grid fades |
| handoff | ward ready | overlay fades 300 ms; the existing grow-in plays unchanged |

**Progress, not clock.** The wave radius pursues a target derived from weighted real
stages (weights fixed in the pure module): app bundle + style load ·25, ward JSON ·20,
surface PNG ·20, roads + water ·15, sim warm-up ·20. Pursuit is the hologram's
pShown→pTarget pattern: monotonic, eased, never backwards. On a warm cache the whole
performance naturally compresses to under a second — which is why **there is no
session guard**: the animation is the wait made visible, so a short wait is a short
animation. If everything resolves in under 400 ms the overlay skips entirely.

**Ward switches do not replay it.** The loader belongs to the cold boot of the map
stack. Tab switches keep today's loadchip + grow-in; the overlay mounts once.

## 4 · Architecture (the hologram's, adapted)

```
public/heat-loader-engine.js          NEW  self-contained worker; OffscreenCanvas 2D;
                                           owns particles, wave, grid, callouts, telemetry text
src/scripts/climate-engine/loader-progress.ts
                                      NEW  pure: stage events → weighted monotonic progress;
                                           node-testable, no DOM
src/components/ClimateEngine/HeatMapStage.astro
                                      EDIT overlay markup (canvas + ticker + rail + telemetry,
                                           role="status" aria-live="polite"), above #mlmap,
                                           below the HUD chrome
src/scripts/climate-engine/heat-map-app.ts
                                      EDIT ~15 lines: post stage events + parsed ward data to
                                           the worker; remove overlay on ready; skip-fast rule
tests/unit/loader-progress.test.mjs   NEW  weights sum to 1 · monotonicity · skip-fast threshold
```

- **Worker + OffscreenCanvas, 2D only.** The page's WebGL context belongs to MapLibre;
  the hologram already proved the worker path and its main-thread fallback
  (`transferControlToOffscreen` absent → same engine on the main thread).
- **No double fetch.** The loader never fetches data itself. `loadWard` already
  fetches everything; the app posts the parsed buildings/roads/water to the worker as
  each arrives. The dust phase needs no data at all, which is what makes the first
  frame instant.
- **Particle budget by tier.** Desktop ~34k (measured 64 fps in the pessimistic CPU
  rasteriser); coarse-pointer / tier-0 devices halve stacking density (~17k). Constant
  cost: the wavefront band is a fixed 130 dots at any radius.
- **Reduced motion:** static settled frame + live ticker and rail, no animation —
  the same posture as the grow-in (`growU.value = 1`).
- **Failure is graceful.** Worker creation failing, or any stage failing, never blocks
  the map: the overlay just fades at ward-ready exactly as if loading were fast. The
  loader observes the boot; it must never be able to break it.

## 5 · What could go wrong

| risk | answer |
|---|---|
| loader delays the actual load | it renders on data the app already fetched; zero fetches, zero awaits of its own |
| stage never completes (offline, EE artefact 404) | pursuit holds at the last true stage; ward-ready (or ward-failed) always dissolves the overlay |
| astro view-transition remounts markup with no driver | the hologram's `data-astro-rerun` lesson — the boot script carries the same attribute |
| worker leaks on ward switch or nav | terminate on handoff, the hologram's cleanup pattern |
| jank on weak devices | tier-halved density; 2D canvas fillRect only; transform/opacity DOM |
| callout labels overlap on rotation | labels are placed in screen space after projection with a fixed stagger; the prototype's layout is the reference |

## 6 · Out of scope

The 2D→3D building grow-in (kept exactly as shipped) · ward-switch UX · the hero
hologram (untouched) · any change to what `loadWard` fetches or in what order · other
pages' loaders.
