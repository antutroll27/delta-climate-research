# 3D terrain under the real map stack — preview design

**Date:** 2026-08-04
**Status:** approved direction, prototype-only — nothing in this spec touches the live `/heat-map` route
**Origin:** CEO email proposing a "hyper-realistic digital twin" stack (Overture buildings, Copernicus DEM, AWS terrain tiles, Mapbox). Most of it was already shipped or already ruled out; this spec covers the one genuinely new piece — terrain — and records the measurements that killed the rest.

## 1 · Evidence this design stands on

All measured 2026-08-03/04, on this machine, keyless:

- **Overture has zero heights here.** Release `2026-07-22.0`, Ballygunge window:
  3,591 buildings, **0 with `height`**, 6 with `num_floors`. Sources inside Overture:
  OSM 2,297 · Google Open Buildings 1,081 · Microsoft ML 213 — none carry height into
  the merge for Kolkata. Ballygunge is the densest, best-mapped of the three wards; the
  other two were not probed because they cannot beat it. **Decision: building heights
  stay as they are** (Google 2.5D Temporal zonal means per Microsoft footprint, 100 %
  coverage, med 6.9/4.6/4.3 m, max 54.4/20.3/15.4 m).
- **Relief across each 1400 m window** (AWS terrarium z15, p5–p95): Ballygunge 8.9 m,
  Baruipur 7.5 m, Barrackpore 6.4 m. Caveat that shapes the whole design: every free
  DEM of this delta is a **surface** model (terrarium is SRTM-derived; Copernicus
  GLO-30 is TanDEM-X) — rooftops and canopy contaminate the "ground". Honest bare-earth
  relief is ~3–5 m.
- **Access:** terrarium tiles and Copernicus GLO-30 are keyless (verified 200/206);
  Mapbox Terrain-RGB is 401 without a token and is not used. Copernicus is not used
  either: over Kolkata it is the same class of data as terrarium in a harder format
  (GeoTIFF + rasterio vs a PNG decode).

## 2 · What this is, in one sentence

A render-only terrain layer under the existing buildings, roads, water and heat
surface, judged in a preview that clones the live map stack — because the user chose
truth-to-shipping over speed, and terrain's real risks are integration risks (camera,
draping) rather than data risks.

## 3 · Decisions, all locked with the user

1. **Prototype first** in `previews/terrain-3d/` — nothing ships from this round; the
   user judges the preview and a separate decision promotes it.
2. **Clone of the live stack** — MapLibre + the custom three.js layer sharing its GL
   context, not a standalone orbit-camera scene.
3. **Exaggerated terrain, labelled** — ground displacement scaled by a single uniform;
   the preview carries ×3/×4/×5 buttons so the user picks the value that would ship as
   the visible label ("ground relief ×N"). True-scale and an unlabelled slider were
   both explicitly rejected.
4. **Building heights are never exaggerated and never replaced.** Terrain moves the
   base of things; the measured heights stay exactly as shipped.

## 4 · Data artefact — `{ward}-terrain.json`

Produced offline by `scripts/fetch-terrain.py` (house acquisition idiom: named
constants, `--check`, byte-stable regeneration, provenance in band). One per ward.

```
{
  ward: "ballygunge",
  source: "AWS Open Data terrain tiles (terrarium z15; SRTM-derived over India)",
  licence: "elevation data public domain (SRTM/NASA); tile assembly per Mapzen attribution list",
  retrieved: "2026-08-04",       // constant, not date.today() — the byte-stability rule
  n: 128,                    // 128×128 over the 1400 m window ≈ 11 m/texel
  medianM: <window median elevation, metres ASL>,
  smoothRadiusM: 40,         // median filter radius that strips rooftop contamination
  clampM: 12,                // residual clamped to ±clampM around the median
  note: "smoothed surface model, indicative — not surveyed ground",
  h: [128*128 values, metres relative to medianM, 0.1 m precision]
}
```

Processing, in order, each recorded by the fields above: crop z15 tiles to the window →
median filter (~40 m radius — wide enough to remove a building, narrow enough to keep
the Hooghly embankment and swales) → subtract window median → clamp to ±12 m.
`--check` asserts: n = 128², |h| ≤ clampM, byte-identical regeneration, and that the
three artefacts' p5–p95 spans land within ±30 % of the measured relief above (drift
tripwire against a silently changed tile source).

Size: a few KB gzipped per ward. Artefacts live in `previews/terrain-3d/data/` — NOT
`public/` — because this is a prototype.

## 5 · Preview — `previews/terrain-3d/`

Follows the established preview pattern (self-contained dir, `npx serve`-able, no build
step). Clones the live stage: MapLibre map, custom layer, hand-assigned
`projectionMatrix` — copied, not imported, so the prototype cannot reach into live code.

**One sampling function, four consumers.** `terrainAt(x, z): metres` — bilinear over
the 128² field, times the exaggeration uniform. Consumers:

1. **Ground** — the existing flat overlay plane (live stage positions it at y 0.6)
   becomes a 128×128 displaced plane; the heat colouring drapes it unchanged.
2. **Buildings** — the live stage builds one merged `ExtrudeGeometry` per ward; the
   preview adds `terrainAt(centroid)` to each building's vertices **before the merge**,
   so the draw-call structure is untouched. Base offset only; extrusion depth (the
   measured height) untouched.
3. **Roads** — polyline vertices sample the field directly.
4. **Water** — the depth-banded water planes sit at `terrainAt` of their polygon
   centroid, slightly inset, so ponds sit *in* hollows rather than floating. The
   existing water shader is reused as-is.

**Controls:** ward switcher (all three) · exaggeration ×3/×4/×5 · **flat toggle** (the
A/B against today's look) · the terrain label rendered exactly as it would ship
("ground relief ×N · smoothed surface model").

**What the user judges:** does terrain earn its place — most plausibly at the
Barrackpore Hooghly embankment — and which exaggeration reads honest-but-legible.

## 6 · What could go wrong

| Risk | Answer |
|---|---|
| Rooftop bumps survive smoothing and read as phantom hills | `--check`'s relief-span tripwire, plus the flat toggle makes them obvious by comparison |
| Buildings float/clip on slopes | Base offset sampled at centroid; 11 m/texel over ≤12 m relief keeps neighbour deltas sub-metre at true scale — visually checked at ×5 in all three wards |
| Terrain fights the pinned camera/pick path | Displacement is model-space Y only; `projectionMatrix` and `pickMatrix` handling copied verbatim. Picking is out of scope in the preview |
| Prototype drifts into the live route | Nothing under `src/` or `public/` changes; artefacts live inside `previews/terrain-3d/` |
| Tile source changes under a future re-run | Pinned z15 tile URLs recorded in the artefact; `--check` relief-span assertion |

## 7 · Out of scope, recorded so nobody re-derives them

- **Overture footprints** (3,591 vs our 2,048 in Ballygunge) — a possible future
  geometry upgrade, but it changes building counts and the built raster, which is
  DC-URS territory: own spec, offline byte-identity oracle, not this round.
- **Any physics/sim change.** Terrain is render-only. `SimLayers`, `ward-raster.ts`,
  `accuracy.ts` untouched — a 3–5 m elevation range has no thermal significance at
  ward scale.
- **Copernicus GLO-30** — same underlying answer over Kolkata, harder format. Recorded
  as considered-and-declined, not banned; a future city with real relief may want it.
- **Mapbox anything** — commercial dependency for capabilities we either have
  (extrusions) or that do not exist for Kolkata (photorealistic 3D).
- **Promotion to the live map** — its own decision after the preview verdict, with its
  own spec if taken (mobile tiers, GPU budget on SwiftShader CI, attribution line).

## 8 · Verification

- `scripts/fetch-terrain.py --check` green; regenerate twice, byte-identical.
- Preview serves locally; all three wards load; flat toggle returns to a
  pixel-plausible match of today's look.
- Console clean on load and while switching wards/exaggeration (house preview bar).
- Screenshot set: each ward at chosen exaggeration + Barrackpore flat-vs-terrain pair.
