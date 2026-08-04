# Heat-map cloud layer — the measured sky, drawn

**Date:** 2026-08-05
**Status:** design approved from a live preview; spec for review.
**Preview:** `previews/sky-3d/index.html` — the real ward (3,527 Overture footprints,
the shipped roads, the real terrain field, the map's own three lights) with the
cloud deck over it. Approved constants read off that preview:
**round 0.62 · oval 0.72 · size 0.72× · deck 320 m.**
**Lineage:** `water-layer.ts` and `road-layer.ts` — render-only siblings that draw a
measured artefact and deliberately do not touch the simulation.

## 1 · What this is, in one sentence

The ward's **measured cloud cover**, drawn as a drifting deck above the city with its
shadows falling on the massing — because that number is already a boundary condition of
the shipped physics, and nothing on screen currently shows it.

## 2 · Why this is not decoration

`heat-map-model.ts` already does this, today, in the shipped model:

```ts
const wind = …, cloud = L ? L.cloud / 100 : 0;          // heat-map-model.ts:338
const tSky = skyTemperatureC(baseTair, rh, cloud);      //                 :360
return { …, sun: 1 * (1 - 0.6 * cloud), tAir: baseTair, tSky: … };   //     :367
```

met.no's `cloud_area_fraction` does **two** things in the shipped model: it raises T_sky,
cutting radiative cooling, and it cuts direct sun by up to 60 %. Both move every surface
temperature on the page. **The layer draws the input the simulation is already using.**
That is the strongest honesty framing available to any visual on this map, and it is the
reason this feature exists rather than a weather-app instinct.

It also fixes the render's own dimming coefficients: the sprite deck darkens the key light
on the same `cloud` scalar the physics reads, so what the eye infers about sunlight and
what the model computes cannot drift apart.

It follows that the layer **must read `state.live.cloud` and nothing else**. A second
cloud source — a GIBS raster, a forecast, a decorative constant — would put a sky on
screen that the model is not using, which is worse than no sky at all.

## 3 · The resolution rule, which decides the whole design

A Himawari pixel is ~2 km at Kolkata. The ward window is 1,400 m. **One cloud pixel is
wider than the entire ward.** So satellite cloud imagery cannot be draped on this map at
ward zoom — at that scale it is a flat grey wash, scenery pretending to be data.

The layer therefore renders cloud as **sky**, not as **map**:

- sprites live at altitude in the three.js scene, never on the ground plane
- they claim *cover* (a scalar met.no measures), never *spatial structure inside the ward*
- the deck sits at a **compressed altitude** — 320 m drawn against a real base near
  700 m — and the label says so, the same contract `terrain.ts` keeps for its ×4

## 4 · Cover changes character, not just opacity

Broken cloud and overcast are physically different skies. Rendering 100 % as "the same
puffs, more opaque" would waste the only atmospheric input we hold.

```
cover ≤ 42 %   discrete cumulus   lobed, top-lit, hard-ish shadows
cover ≥ 86 %   merged veils       layered, translucent, broad soft shadows
between        cross-fade         fuse = clamp((cover − 0.42) / 0.44, 0, 1)
```

Sun intensity falls with cover (`key.intensity = 2.1 × (1 − cover × 0.62)`) and the
hemisphere light rises, so the massing genuinely flattens under overcast — which is what
the model does to T_sky at the same moment.

## 5 · Sprite construction (the part that took four iterations)

Two failures are recorded here so they are not repeated.

**Lobes must be fitted, not placed.** The first version positioned lobes in canvas pixel
coordinates; outer lobes ran past the bitmap bounds and the texture's own rectangle
became the cloud's silhouette. Every sprite is now built in abstract coordinates,
measured, then fitted with a margin wide enough for the alpha falloff, the rim stroke and
the blur. **Guarded by a test** — no lobe may come within 8 % of a sprite border.

**Alpha needs a plateau.** A gradient that fades from the centre reads as haze. Alpha
holds near-full to `P = 0.46 + round × 0.40` of the radius, then falls — that plateau is
what draws a curved edge. Plus a blurred rim-light arc on the upper side of the main
lobes only.

Lobes are **ellipses**, squashed hardest at the base (0.60) and nearly round at the crown
(0.86), laid out wide and shallow. Measured silhouette at the approved settings:
**389 × 113 px, 3.44 : 1**. A second octave of 26 smaller bumps rides the silhouette;
a handful of big shapes alone reads as a cartoon.

## 6 · Architecture

```
src/scripts/climate-engine/cloud-sprites.ts   NEW  pure sprite generation — lobe layout,
                                                   fit(), gradients. Returns canvases.
                                                   No THREE, no DOM beyond OffscreenCanvas.
src/scripts/climate-engine/cloud-layer.ts     NEW  THREE wrapper: sprites, shadow planes,
                                                   drift, dispose. Sibling of water-layer.ts.
src/scripts/climate-engine/heat-map-app.ts    EDIT ~6 lines: create on ward load, advance
                                                   from the existing render callback, dispose.
```

Sprites are baked **once per session**, not per ward — they are weather, not geography.
26 clouds × (1 cumulus sprite + 1 veil sprite + 1 shadow plane) from a pool of 4 + 3 + 1
textures. Drift and opacity are per-frame transform writes only; **no geometry is rebuilt
and no texture is re-uploaded after boot.**

The layer rides the map's existing repaint loop exactly as `water-layer.ts` does — no rAF
of its own. Because the deck must keep moving when nothing else is changing, the layer
requests a repaint while `wind > 0`; that is the one new source of continuous repaint and
it is the reason §9 measures frame cost before this ships.

**Drift direction** comes from met.no's `wind_from_direction`, which we already receive
and currently discard at the parse. Cloud advection is a real use of that field —
**unlike wind streaks, which are cut from this spec** (see §10).

## 7 · Honesty

| on screen | says |
|---|---|
| deck | `cloud 83 % · met.no · drives T_sky` |
| altitude | `deck at compressed altitude` |
| provenance | `observed, not forecast` |
| absent reading | no deck at all — never a default sky |

**A missing or stale met.no reading draws nothing.** The loaders in this engine swallow
to empty; a cloud deck invented while `state.live` is null would be a sky nobody measured,
the same failure as the loader's deleted land dust.

## 8 · Reduced motion

Drift and cross-fade stop; the deck renders as a **still frame at the measured cover**.
Honestly static rather than animated-but-slower. `prefers-reduced-motion` already gates
the map's orbit and the water shimmer; this joins that branch.

## 9 · Tests

- `fit()` keeps every lobe ≥ 8 % of the sprite inside its border, across the round/oval
  range — the clipping bug that produced straight edges
- the cross-fade is continuous and monotonic in cover; `fuse(0) === 0`, `fuse(1) === 1`
- `cloud-layer.ts` contains no `SimLayers`, no `Spatial`, no second cloud source — a grep
  guard, comments stripped, as `heat-map-roads.test.mjs` does
- `skyTemperatureC(t, rh, cloud)` still consumes the same `L.cloud / 100` — the tripwire
  that this layer is the model's input and not a parallel one
- a null `state.live` yields no sprites
- **frame budget**: the layer costs < 1.5 ms/frame at DPR 2 on the reference machine,
  measured, or it does not ship in this form

## 10 · Out of scope, with reasons

**Wind streaks — cut.** Previewed and liked, but the model uses wind as a **scalar**
(`p.h * p.wind`); direction never enters the physics. Drawing streaks at 183° would show a
real quantity the simulation is blind to, and the caveat needed to say so out-loud on
screen costs more than the visual earns. Cloud advection uses the same field without the
problem, because a cloud genuinely does move with the wind.

**GIBS Himawari raster — deferred.** ~2 km per pixel against a 1,400 m ward (§3). It only
works in a flown-out regional view, which is its own feature with its own camera state.

**MODIS AOD — deferred, and here is the measurement so nobody repeats it.** MAIAC
(`MODIS/061/MCD19A2_GRANULES`, `Optical_Depth_055`, 1 km) over Ballygunge, measured
2026-08-05:

| window | valid obs / pixel | mean AOD |
|---|---|---|
| dry, 2025-11-01 → 2026-02-01 | **108.6** | 0.806 |
| monsoon, 2026-06-01 → 2026-08-05 | **2** | 1.044 |

It is a **dry-season instrument** — monsoon cloud masks the retrieval, so shipping it in
August would show an empty field. Note the sampling trap: per-granule `reduceRegion`
returns null for every granule because a granule's *footprint* covers the ward while its
*retrieval* there is masked; aggregate across the collection instead.

**Also out:** kepler.gl / deck.gl (449 KB gzip against our 633 KB total, and interleaved
mode wants the WebGL context our custom layer already owns) · any Windy product (free tier
is barred from production and returns modified data) · `accuracy.ts`, `SimLayers`,
`Spatial`, the cost model, and every published figure.
