# Heat-map vegetation layer — design spec

*Delta Climate Research · 2026-08-10 · status: approved for planning*

Research backing: [`docs/research/2026-08-10-kolkata-vegetation-data.md`](../../research/2026-08-10-kolkata-vegetation-data.md)
Co-founder briefing: `docs/briefings/2026-08-10-vegetation-data-sourcing-briefing.html`

---

## 1. Context & goal

Vegetation is the biggest physical term the twin still under-represents. Today the
only greenery in the model is a Sentinel-2 NDVI-derived `veg[]` fraction feeding
evapotranspiration cooling (`ward-raster.ts`, `heat-map-model.ts`); "trees" exist
only as an abstract intervention count (`iv.trees`). There is **no tree geometry
anywhere in the render**.

Goal: add a **green layer** that (a) sharpens the physics with measured canopy
data and (b) makes the green *visible* on the map as believable trees — under the
twin's constraints (no photogrammetry over Indian cities, commercial-clean data
only, 60 fps degrading to mobile, receipts/measured-vs-modelled honesty).

## 2. Accuracy calibration (decided)

Two levels, held to different standards:

- **Measured, more-or-less accurate (aggregate):** *where* canopy is, *how much*,
  and roughly *how tall* — from the Meta/WRI 1 m canopy-height model (CHM,
  ~2018–2020, error a few m). Tree count/density track reality. This is the only
  part that feeds the **physics**, and it is gated by accuracy re-validation.
- **Illustrative, deliberately not accurate (individual tree):** exact trunk
  position, species, and crown shape are **modelled**, not surveyed. Receipted as
  such. No species dataset exists for Kolkata; species is assigned for variety.

This is the same measured-vs-modelled honesty the rest of the twin runs on.

## 3. Decisions (from the brainstorm)

| # | Decision | Choice |
|---|----------|--------|
| Q1 | What the canopy data does | **Sharpen `veg[]` (physics) + drive render.** One source, both jobs. |
| Q2 | Tree look | **ez-tree (MIT) species archetypes**, rendered in the volumetric-crown look (soft crowns, contact shadows, per-instance variation, wind). Previewed & approved. |
| Q3 | Placement | **CHM-driven** — canopy pixels → tree positions + heights. |
| a | Placement compute | **Precompute at build** (deterministic, zero runtime sampling). |
| b | Canopy-data overlay | **Defer to Phase 2** (YAGNI now). |
| c | Scope | **Ballygunge first**, then baruipur + barrackpore. |
| UX | Toggle location | **New widget directly below the clock widget** (`#clockw`), styled to match. |

Explicitly **out of scope**: AQI / pollution-dispersion / wind-CFD (the 2-D
physics cannot represent it — honesty line). No shadow/SVF cooling term
(measured dead-end). No photogrammetry. No runtime ez-tree dependency (baked).

## 4. Data flow

```
Meta/WRI 1m CHM (AWS Open Data, CC BY 4.0)
        │  scripts/fetch-canopy.py  (build-time, Python, strict mypy)
        ▼
 {ward}-canopy raster  (clipped + regridded to the 192² model grid)
        │
        ├─▶ veg[] correction        → physics (ET cooling)      [ward-raster.ts]
        │      (gated: re-run accuracy LOO, no regression)
        │
        └─▶ {ward}-trees.json       → render (positions·heights·species)
               (sampled from canopy pixels at build)

ez-tree (dev-dep) ──bake──▶ public/heat-map/models/{neem,gulmohar,palm}.glb
        │  scripts/bake-trees.mjs (headless Playwright + GLTFExporter)
        ▼
 vegetation-layer.ts → InstancedMesh per species → three.js scene
```

## 5. Components

Each unit: purpose · interface · dependencies.

### 5.1 `scripts/fetch-canopy.py` (new)
- **Purpose:** fetch the Meta/WRI 1 m CHM for each ward bbox from anonymous AWS
  Open Data (`s3://dataforgood-fb-data/forests/v2/…`), clip, reproject/regrid to
  the ward's model grid; emit the canopy raster and the tree-instance list.
- **Outputs:** `public/heat-map/data/{ward}-canopy.png` (or compact JSON of the
  canopy-height field at grid resolution), `public/heat-map/data/{ward}-trees.json`
  (`[{x, y, h, species}]` in ward-local coords), and a provenance record.
- **Interface:** CLI like the other fetchers; `--check` for byte-stable re-emit
  (pin `retrieved`, round values, per `fetch-terrain.py` convention).
- **Deps:** `rasterio`/GDAL (already core), anonymous S3 (boto3 or direct HTTPS
  to the public bucket — no credentials). Strict mypy (repo rule).
- **Placement rule (build-time, simple):** threshold CHM (e.g. height ≥ ~2 m),
  cluster/downsample to a target instance density, one tree per cluster with
  `h` = local CHM value, `species` assigned by a deterministic rule (seeded by
  position; broadleaf-dominant mix, occasional palm). Cap instances per ward.

### 5.2 `veg[]` correction (edit `ward-raster.ts`)
- **Purpose:** blend CHM into the NDVI-derived `veg[]` where NDVI mis-reads (e.g.
  tall canopy over dark roads). Documented, bounded rule; never invents veg a
  cell cannot physically have (respects the existing "no floor no city has" note).
- **Interface:** unchanged public contract; `veg[]` values shift only.
- **Parity:** this is a **physics input change** → §7.

### 5.3 ez-tree bake pipeline (new `scripts/bake-trees.mjs`)
- **Purpose:** generate the 3 species archetypes with ez-tree and export committed
  GLBs, so **nothing ships at runtime** (ez-tree stays a `devDependency`).
- **How:** headless Playwright loads a tiny generator page (reuse the
  `veg-species` params: neem/gulmohar/palm, scaled ~0.14, tuned leaf density),
  `GLTFExporter` → `public/heat-map/models/{species}.glb`. Deterministic seeds.
- **Deps:** `@dgreenheck/ez-tree@1.1.0` (MIT, dev-only), `@playwright/test`
  (present), three GLTFExporter.

### 5.4 `src/scripts/climate-engine/vegetation-layer.ts` (new)
- **Purpose:** load `{ward}-trees.json` + the species GLBs; build one
  `InstancedMesh` per species; apply per-instance TRS + tint/scale variation;
  contact shadows; vertex-shader wind sway (transform-only, matches the site's
  motion signature). Expose `setVisible(bool)` and `dispose()`.
- **Interface:** `createVegetationLayer(ward, scene, quality) → { group, setVisible, dispose }`.
  Null-safe loader mirroring `terrain.ts:asTerrainField` (malformed → no layer,
  never half-rendered). `assertVegetationLogic()` self-check.
- **Deps:** three, `ward-loader` pattern, the render-quality controller.
- **Performance (§6).**

### 5.5 UI toggle (edit `HeatMapStage.astro` + `heat-map-app.ts`)
- **Purpose:** a **Vegetation on/off widget directly below `#clockw`** in the DOM
  (~`HeatMapStage.astro:96`, after the clock's closing `</div>`), styled in the
  same Braun/Rams control idiom (`.clockw` visual language) — a small labelled
  pill, `aria-pressed`, keyboard-focusable.
- **Wiring:** new `state.vegOn` in `heat-map-app.ts`; toggling calls
  `vegLayer.setVisible(state.vegOn)`. Default **on** (Phase 1). Persists in the
  same place other view toggles do. Hidden if the ward has no vegetation layer.

### 5.6 Provenance (edit `build-provenance-manifest.py`, `verify-served-data.mjs`)
- New `canopy` layer in `{ward}-layers.json`: Meta/WRI 1 m CHM, **CC BY 4.0**,
  `kind: measured` (raster) with the derived tree list `kind: modelled`; lineage
  = S3 path → clip → regrid, vintage ~2018–2020, MAE note.
- Add `canopy` to the `EXPECTED` layer list in `verify-served-data.mjs` so a
  missing manifest fails the build (drift guard).

## 6. Performance tiers

Reuses `window.__deltaRenderQualityController`.

- **Desktop (tier 2):** full ez-tree meshes near → **octahedral impostor** far →
  frustum-cull past a distance. Shadows on, wind on.
- **Mid:** fewer LOD bands; shadows optional.
- **Mobile / coarse-pointer:** billboard impostors only or a capped instance
  count; shadows off. (Cull to viewport, à la ExploreTrees.SG.)
- One `InstancedMesh` per species = 1 draw call/species; LOD + culling are what
  unlock scale (200k-tree browser precedent). Phase 1 may ship without impostors
  if ballygunge's instance count is comfortably within budget; §8.

## 7. Physics parity plan

- The `veg[]` change is the only parity-sensitive edit. **Gate:** re-run
  `measure-accuracy.py` (LOO-overpass, the only non-leaky split — see
  [[heat-map-accuracy-ceiling]]) before/after; **must not regress**. If it does,
  fall back to render-only canopy (trees + placement) and drop the `veg[]` blend.
- Sentinel/Landsat scene selection and `data/dc-urs/sentinel.json` stay
  **byte-identical** (the CHM is an independent input; it does not touch scene
  selection or calibration). Parity oracle unaffected.

## 8. Scope / phasing

**Phase 1 — ballygunge, full vertical slice**
`fetch-canopy.py` (ballygunge) → `veg[]` blend + accuracy re-validate → bake 3
GLBs → `vegetation-layer.ts` (InstancedMesh + shadows + wind, no impostor LOD
yet) → toggle below clock → `canopy` provenance + verify gate. Prove end-to-end.

**Phase 2 — scale & polish**
LOD/impostors + mobile tiers; roll to baruipur + barrackpore; canopy-data overlay
(the translucent CHM surface) as an interrogation view tied to the receipt.

**Phase 3 — optional**
Live intervention planting (`iv.trees` spawns/removes instances); palm refinement
(ez-tree's weakest output — hand-tune or supplement).

## 9. Verification

- **Python:** `python3 -m mypy` clean on `fetch-canopy.py` (+ any edited script).
- **TS:** `npm run check` 0 errors; `assertVegetationLogic()` passes.
- **Build gate:** `verify-served-data.mjs` green with `canopy` in EXPECTED.
- **Parity:** accuracy LOO not regressed; sentinel/Landsat outputs byte-identical.
- **Visual:** screenshot `/heat-map` (ballygunge) with vegetation on/off via the
  new toggle; console clean; 60 fps on desktop tier 2.
- **Perf:** frame-time within the existing budget with the layer on.

## 10. Files

**New:** `scripts/fetch-canopy.py`, `scripts/bake-trees.mjs`,
`src/scripts/climate-engine/vegetation-layer.ts`,
`public/heat-map/models/{neem,gulmohar,palm}.glb`,
`public/heat-map/data/{ward}-canopy.*`, `public/heat-map/data/{ward}-trees.json`.

**Edit:** `src/scripts/climate-engine/ward-raster.ts` (veg[] blend),
`src/components/ClimateEngine/HeatMapStage.astro` (toggle markup + styles),
`src/scripts/climate-engine/heat-map-app.ts` (state.vegOn + layer wiring),
`scripts/build-provenance-manifest.py` (canopy record),
`scripts/verify-served-data.mjs` (EXPECTED += canopy),
`scripts/measure-accuracy.py` (re-run; no code change expected).

**Dev-dep:** `@dgreenheck/ez-tree@1.1.0` (MIT, build-time only).

**Dev-only preview pages (delete or keep out of prod build):**
`src/pages/veg-styles.astro`, `src/pages/veg-species.astro`.

## 11. Deferred / YAGNI

- 3D-Tiles `EXT_mesh_gpu_instancing` streaming (only if we outgrow a single-city
  three.js scene).
- Canopy overlay (Phase 2). Live planting (Phase 3).
- Per-tree species accuracy (no dataset exists; not worth faking).

## 12. Risks

- **CHM coverage/quality over ballygunge** — cloud gaps or 150 m artefacts may
  need WorldCover gap-fill (already in the pipeline). Verify at fetch.
- **veg[] regression** — mitigated by the parity gate + render-only fallback.
- **Instance count on mobile** — mitigated by LOD/impostor/cap (Phase 2), Phase 1
  validated within budget first.
- **ez-tree palm quality** — accepted; refine in Phase 3.
