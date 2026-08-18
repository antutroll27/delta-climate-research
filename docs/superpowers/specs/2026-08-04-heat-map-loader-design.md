# Heat-map boot loader — "ground rise" ward point cloud

**Date:** 2026-08-04
**Status:** **AMENDED after audit.** v1 (Worker + OffscreenCanvas) was built, audited,
and rejected on the rendering. v2 moves the point cloud into the map's own three.js
scene. The wiring, the progress module and the overlay DOM survive unchanged.
**Prototype:** `previews/heat-loader/particles.html` (style: **ground rise**) — the
reference for choreography and density only. Its projection is NOT the reference; that
is the whole point of this amendment.
**Lineage:** the hero hologram loader (`public/holo-engine.js`) — real-progress stages,
honest telemetry, dissolve handoff. v2 keeps its grammar and drops its architecture.

## 1 · Why this was amended

v1 rendered in a Worker on its own OffscreenCanvas, with a hand-rolled projection. An
audit measured what that produced over the real map:

| finding | measured |
|---|---|
| **Perspective inverted** | far/near = 1.66 where the map is near/far = 2.24 — the ward drew as a trapezoid wide at the top |
| **DPR counted twice** | ward 1,299 px wide on DPR-2 against the map's 1,023 px; on a Pixel 7, 846 CSS px on a 619 px stage |
| **Camera unrelated to the map's** | bearing jump at handoff of 1.2° / 6.4° / 23.4° / **60°** across four boot speeds — a linear function of how slow the network was |
| **Handoff overlapped the finished map** | map grow-in 96 % complete when the loader began fading; **3.4 s of two misaligned cities** at 4× CPU throttle |

One mistake produced the first three: a second projection existed at all. A further fact
the audit surfaced makes a constants-only fix impossible — **the map idle-orbits at
−1.4°/s** (`ORBIT_DEG_PER_SEC`), so even a correctly-initialised fixed bearing separates
from the map at ~4.9°/s.

**So v2 removes the second projection rather than correcting it.** The camera cannot
disagree with the map's camera when there is only one camera.

## 2 · Architecture (v2)

```
public/heat-loader-engine.js            DELETE  the worker, and with it the second projection
src/scripts/climate-engine/loader-points.ts
                                        NEW     builds ONE THREE.Points mesh from the
                                                already-parsed ward data; all motion in the
                                                vertex shader; pure builder, node-testable
src/scripts/climate-engine/loader-progress.ts
                                        KEEP    unchanged; already audited sound
src/components/ClimateEngine/HeatMapStage.astro
                                        KEEP    overlay DOM (ticker/rail/telemetry) unchanged;
                                                canvas element removed
src/scripts/climate-engine/heat-map-app.ts
                                        EDIT    mesh into the existing threeScene; uniforms
                                                driven from the existing render loop
```

The points are added to the **same `threeScene`** the buildings live in, drawn by the
**same custom layer**, through **MapLibre's own matrix**. When the idle orbit turns the
map, the points turn with it — because they are in it.

**All motion lives in the vertex shader.** Per-point attributes: target position, radial
distance, seed, class, height, and for building points the **same `aDelay`** the facade
shader already uses. Uniforms: `uProgress`, the shared `uSize`, and the shared **`growU`**.
The rise wave is computed per-point on the GPU — zero per-frame CPU, one draw call. The
130-point wavefront band rides in the same geometry, class-tagged.

**Time-based, not frame-based.** v1 advanced `settleT += 0.02` and `pShown += Δ*0.06`
per frame, on a thread whose frame rate the audit measured at **28.5 fps (DPR 1) /
17.2 fps (DPR 2)** in situ against 60–75 fps in isolation — so every duration stretched
2–3× exactly when the machine was busiest, and 1 run in 7 overran the 4 s backstop. v2
pursues on elapsed time.

## 3 · The handoff: per-building dissolve

**There is no settle phase.** The point cloud holds the risen massing, and each building's
points fade at the exact moment that building's real extrusion grows up through them —
because both read the identical expression:

```glsl
float gT = clamp((uGrow - aDelay*0.55)/0.45, 0.0, 1.0);
```

The facade shader uses it to scale `transformed.y`; the points use it to fade alpha. Same
uniform, same per-building stagger, same clock. A building and its own preview cannot
desynchronise, and the "two cities" state is not merely avoided — it is unbuildable.

## 4 · Honesty (the three fixes, and the one deletion)

**Buildings are cyan → white by height.** v1 coloured height with `RAMP`, byte-identical
to the map's temperature ramp, while the "Extreme / Severe / Hot / Warm / Comfortable"
legend was on screen throughout — a red-and-blue city that read as a heat map and was a
height map. Monochrome reads as *structure assembling*. Roads keep ink, water keeps
turquoise; neither resembles the ramp.

**Callouts read `~87 m`, not `86.9 M`.** The value is a zonal **p65** of Google Open
Buildings 2.5D Temporal (2023 epoch, ~4 m raster) over an Overture footprint, computed by
`scripts/compute-heights.py`. The ward artefact's own `heightsNote` records that the OSM
validation was **underpowered** (6 matched pairs against a threshold of 8). A decimal
place on that is a precision the measurement does not have.

**Land dust is deleted.** 3,400 invented particles — ~10 % of the advertised `pts` count,
and on a 400 kbit/s connection the audit measured **12 seconds in which they were the only
thing drawn**, the building payload never having arrived. Every remaining particle is real
data, so the count needs no asterisk. Before building data lands: ticker, rail and phase
text only. The darkening basemap beneath is the ground.

**Telemetry derives, never hardcodes.** Coordinates from `WARDS[state.ward]`, provenance
from `d.source`, `pts` from the real particle count. v1 hardcoded `22.528°N 88.366°E` —
true only because the cold boot happens to load Ballygunge.

## 5 · Lifecycle

No worker, no canvas transfer, no second rAF. The points ride the map's existing repaint
loop; `growU < 1` already forces continuous repaint, and that same condition keeps the
wave animating. Teardown: remove the mesh, dispose the geometry, clear the overlay DOM,
and **clear the backstop timers** — v1 left `setTimeout(bootEnd, 4000)` and `12000`
uncleared, so on an Astro soft nav they fired against a detached element and held the
whole `mountHeatMap` closure alive for up to 12.3 s.

**Reduced motion:** the grow-in is already instant (`growU = 1`), so the points never
appear at all. Ticker and rail only — honestly static, rather than v1's four-distinct-
frames-in-540 ms (the water shimmer was not gated on `reduce`).

**`#loadchip` hides** while the loader owns the story; v1 ran both indicators at once.

## 6 · What survives untouched

`loader-progress.ts` and its 6 tests · the overlay's ticker, rail and telemetry DOM ·
skip-fast at 400 ms · cold-boot-only (`firstBoot`) · fire-and-forget wiring. The audit
called all of this good — it measured the worker at **0 ms** main-thread cost on desktop
and found the teardown latched and leak-free. None of it changes.

## 7 · Tests

The wiring tripwires are rewritten for the new shape, and the audit's parting observation
is answered directly — its complaint was that nine source-text guards could not have
caught an inverted perspective, a doubled DPR or a 60° bearing jump. In v2 **there is no
projection to test**, which is the structural point. What replaces them:

- `loader-points.ts` builds no invented particles — a grep guard for the deleted dust
- no `RAMP` / heat-ramp constant in `loader-points.ts` (the mono-colour guard)
- the `(uGrow - aDelay*0.55)/0.45` expression appears in **both** the facade shader and
  the points shader (the interlock guard — if they drift, the dissolve desynchronises)
- callout text matches `/^~\d+ m$/` — no decimal place
- backstop timers cleared on dispose
- telemetry reads `WARDS[state.ward]`, never a coordinate literal

## 8 · Out of scope

The 2D→3D grow-in itself (unchanged) · ward-switch UX · the hero hologram · what
`loadWard` fetches or in what order · other pages' loaders · `accuracy.ts`, the sim, and
every published figure.
