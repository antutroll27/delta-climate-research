# Urban Heat Island Simulator — `/heat-map`

**Status:** ✅ **Production page shipped at `/heat-map`** (Astro route + climate-engine modules, noindex) — ported from the prototype, verified in the production build. Instrument prototype runs on a **live MapLibre basemap** with real footprints +
**Google-measured heights**, live GPU sim, **live Met Norway ambient forcing**, clay-city
live-data building tint, 60fps interaction · intervention model formalised in
[`heat-map-intervention-model.md`](heat-map-intervention-model.md) · Astro page integration pending
**Owner brief:** CEO-assigned. Interactive urban-heat visualisation for the site.
**Prototype:** [`previews/heat-map/index.html`](../previews/heat-map/index.html) (open via
`python3 -m http.server 8099` from repo root → `/previews/heat-map/`).
**Full plan (verbose):** `~/.claude/plans/got-this-piece-of-calm-porcupine.md` (local, not committed).

---

## Why this exists

Delta's flagship niche is **street-scale urban-heat vulnerability** — see
`src/data/papers.ts` ("Street-scale heat vulnerability from ECOSTRESS") and
`src/data/projects.ts` ("Project Kolkata — ECOSTRESS LST fused with ward-level census").
A working, touchable heat simulator *is* that pitch made real. It also creates a genuinely
indexable, linkable page — directly attacking the SEO gap (`site:deltaclimate.earth` = 0
indexed pages; only ~2 indexable routes today).

Origin: the CEO vibe-coded a **Streamlit** prototype (3 Kolkata wards — Ballygunge,
Baruipur, Barrackpore — intervention sliders, gamified green score, tabbed dashboard).
This feature is the production re-think of that, in Delta's brand and stack.

Two empty scaffolds already exist in the repo: `src/pages/HeatMapVisualizer.astro` (0 bytes)
and `src/components/ClimateEngine/` (empty dir).

---

## Decisions taken

| Decision | Choice | Rationale |
|---|---|---|
| Engine workload | **Live simulation** (per-frame physics + scenario sliders) | genuine compute → worth a real engine, not just a shader |
| Placement | **Standalone `/heat-map` page** | room for a full-bleed instrument + its own SEO surface |
| UI shell | **Vanilla TS core + Astro** (no Vue) | repo has React islands + zero Vue; a 2nd framework runtime for one feature contradicts the perf discipline everywhere else. Codex proposed Vue; rejected |
| 3D geometry source | **DELIVERED: Microsoft ML footprints, extruded (all 3 wards, real data, in `previews/heat-map-3d/`)** — upgrading to **Google Open Buildings v3 + Temporal heights via EE** once IAM lands (better India recall, CC BY 4.0, REAL heights). NOT Google photoreal tiles (see below) |
| °C data source | **direct thermal measurement** (ECOSTRESS/Landsat LST), not AlphaEarth | AlphaEarth is a general embedding; needs a trained classifier before it means °C |
| WASM toolchain | **deliberately deferred** | design a swappable engine ABI; only pay the emscripten/wasm-pack cost if profiling justifies it |

### Why not Google Photorealistic 3D Tiles (the CEO's instinct)
The three wards are scattered — Ballygunge (core), Baruipur (~25 km S), Barrackpore
(~25 km N). Photogrammetric coverage follows dense metro cores, so Google would at best
cover **one of three**. For a *comparison instrument* that is disqualifying: one ward
photoreal + two as grey blocks makes users compare **render quality**, not temperature.
A uniform source that covers all three beats a prettier source that covers one. Google
also fails the architecture on runtime-only ToS (no caching → breaks the static-asset
pattern), per-session billing (uncapped on a public page), and absent building IDs.
→ **Photoreal stays available as a *separate* showcase** (one drone capture of Ballygunge
→ Gaussian splat, reusing the river-scan photogrammetry capability), never the comparison tool.

### Data layering (all Earth Engine → build-time export → versioned static asset)
| Layer | Source | Drives |
|---|---|---|
| Footprints | Microsoft Global ML Building Footprints (tile `123133323`, verified covers all 3 wards) | massing |
| Heights | **LANDED: Google Open Buildings 2.5D Temporal** (2023 epoch, ~4 m, public GCS bucket — **no EE needed**); 98-99 % of buildings got a direct zonal-mean measurement | massing |
| Semantic IDs | OSM / Overpass (Ballygunge only, ~9k buildings) | per-building analytics where available |
| Land surface temp | ECOSTRESS (70 m), Landsat 8/9 TIRS | the °C field |
| Canopy | Sentinel-2 NDVI (10 m) | the `veg` term |
| Land cover | ESA WorldCover / Dynamic World | `albedo` / `built` |
| Neighbourhood similarity | **AlphaEarth embeddings** (phase 2+, the novel differentiator) | "find wards like Ballygunge" |

---

## Architecture (mirrors `river-scene.ts`: framework-agnostic core, thin Astro shell)

```
src/pages/heat-map.astro                 ← route (rename from HeatMapVisualizer.astro; lowercase slug)
src/components/ClimateEngine/
  HeatMapStage.astro                     ← canvas + controls markup, mounts the core
src/scripts/climate-engine/
  caps.ts                                ← device capability probe → tier/backend/grid (BUILT)
  heat-map-scene.ts                      ← three.js render layer (DataTexture + colormap shader)
  sim-client.ts                          ← worker bridge (postMessage + transferable Float32Array)
  sim.worker.ts                          ← worker host, runs the engine loop off the main thread
  sim-ts.ts                              ← TS reference impl of the HeatSim interface
  types.ts                               ← GridSpec / SimParams / SimStats / HeatSim ABI
```

### Swappable engine ABI — keeps the WASM decision cheap
```ts
export interface HeatSim {
  reset(grid: GridSpec, params: SimParams): void;
  setParams(p: Partial<SimParams>): void;   // slider change, no realloc
  step(dt: number, steps?: number): void;
  temperature(): Float32Array;              // N*N, °C
  stats(): SimStats;                        // mean/peak, ΔT vs baseline, % area > threshold
  dispose(): void;
}
```
Ship `sim-ts.ts` first. A future `sim-wasm.ts` (AssemblyScript / Rust / C++) implements the
**same** interface; the worker picks whichever is available and the page never knows.

### Device tiering & sim backend (`caps.ts` — BUILT)
The floor is **never GPU compute**. On the exact devices we worry about (2015 igpu
laptops, old Android phones) GPU compute is frequently *absent* (no WebGPU; WebGL2
without `EXT_color_buffer_float`; driver-blocklisted context) or *slower than the CPU*
(shared-memory ping-pong + readback beats a small stencil loop only on discrete GPUs
/ unified-memory Macs). So GPU is an **opt-in accelerator**, not the baseline.

`caps.ts` reuses `render-quality.ts`'s device verdict (it already classifies hardware +
GPU into `RenderTier` 0/1/2) and adds only the two sim-specific probes — WebGPU adapter,
WebGL2 float render targets — then maps tier → workload:

| Tier | Grid | Backend | Map mode | Typical device |
|---|---|---|---|---|
| 2 full | 256² | `gpu` if a compute path exists, else `ts` | relief | RTX / M-series / modern discrete |
| 1 balanced | 128² | `ts` (worker CPU) | relief | modern igpu / recent phone |
| 0 low | 64² | `ts` (worker CPU) | isotherm | 2015 igpu / old Xiaomi |
| reduced-motion | tier grid | `ts`, one static frame (`animate:false`) | tier mode | any |

The knob for weak hardware is the **grid** (FD is O(N²): 256²→64² is ~16× cheaper), not
the language. GPU is gated on tier 2 on purpose — render-quality already demotes software
renderers/old igpus to 0/1, so `gpu` is only ever chosen on hardware that earned full
fidelity. `backend` is a `SimBackend` (`gpu|wasm|ts|baked`); `sim-wasm.ts` swaps into the
`ts` slot later behind the same ABI, and `baked` (cross-fade prebaked scenario frames) is
the runtime-demotion escape hatch when even 64²/TS can't hold frame budget.
Detected once on the main thread; `HeatCaps` is postMessage'd into the worker, which never
re-probes. Pure decision logic is `resolveHeatCaps()`, checked by `assertCapsLogic()`.

### Simulation model
2D grid (start 256², tier-scaled). Per-cell `T` (°C) + input layers `albedo`, `veg`,
`built`, `water`. Explicit finite-difference step:
```
dT/dt = D∇²T + S·(1-albedo) - k_rad·(T-T_sky) - L·veg - h·wind·(T-T_air) + Q_anthro·built
```
Euler with CFL-stable dt (`D·dt/dx² ≤ 0.25`); optional upwind advection for a wind plume.
**Scenario sliders:** tree canopy %, cool-roof albedo, wind, time-of-day, anthropogenic heat.
**Readouts** (why CPU-side beats a pure GPU ping-pong — cheap to read numbers out):
mean/peak temp, ΔT vs baseline, % area above heat-stress threshold (maps onto the HVI language).

### Render layer
Three.js displaced plane (2.5D relief) + colormap fragment shader; temperature uploaded as a
`DataTexture` (`RedFormat` + `FloatType`), `needsUpdate` per frame.
**Facade gap** — `src/scripts/three-runtime.ts` must gain: `DataTexture`, `ShaderMaterial`,
`OrthographicCamera`, `FloatType`, `RedFormat`, `NearestFilter`.

### Reuse (do not reinvent)
`createFrameGate` (`src/utils/frame-gate.ts`), `getRenderQuality`/`subscribeRenderQuality`
(`src/utils/render-quality.ts`), `motionOK` (`src/utils/motion.ts`), the facade
(`three-runtime.ts`), and the lifecycle template in `src/components/visuals/HeroRiver.tsx`
(IO gate → visibility pause → contextlost → dispose). Pause **sim AND render** when offscreen
or tab-hidden; drop grid + relief on low tier; reduced-motion → one static frame; dispose must
terminate the worker.

---

## UI direction — "cartographic instrument"

Mood board (COSMO, Traffic Management, USER INSIGHTS, Dune, NUASCII, RENON, Weather Report)
split into a **dashboard** cluster and an **editorial-cartographic** cluster. Synthesis: not a
dashboard, not an editorial piece — a **survey plate that happens to be live**, which is exactly
Delta's existing language (corner ticks, mono readouts, coordinate strip, hairlines).

Moves pulled: **isotherm contours** over the heat field (legitimate: LST isotherms *are* contour
lines), **ward name as hero type** (COSMO), **edge-docked glass panels** over a full-bleed map
stage, **Delta-rendered gauges** (hand SVG, cyan→bronze→red ramp — never Plotly defaults).

### Prototype state (`previews/heat-map/index.html`)
Static look-study, brand-accurate, 3 wards **live-switchable** (tabs top / strip bottom) — the
core-vs-fringe contrast reads in one glance (Ballygunge 42.5 °C red core ↔ Baruipur 34.1 °C cool
fringe; LST, UHI Δ, %-area, coordinates, isotherms all update). **Fake by design:** heat field is
layered gradients, isotherms are procedural wobble-rings, map is 2D. The **chrome/layout/type/
interaction language is the real deliverable** and carries straight to production.

**User change requests already applied:** removed the four bronze corner L-brackets; added a
plain-language **colour index** ("What the colours mean": Comfortable → Warm → Hot → Severe →
Extreme) above the technical °C ramp, so non-specialists can read the map.

### ⚠️ Honesty requirement (non-negotiable)
No real geo data is wired yet; the field is procedural. Delta sells "decision-grade, defensible,
standards-aligned" rigour to municipalities — a map that *looks* like measured Kolkata data but
is synthetic is a credibility risk with exactly the clients being pitched. The prototype states
**"Modelled scenario · synthetic inputs — not measured data"** in the frame (pulsing bronze
banner), not a footnote. This must persist until a real raster is wired in.

---

## Real geometry — LANDED (2026-07-23)

**`previews/heat-map-3d/` renders all three wards from real Microsoft footprints, interactive
(orbit/zoom/pan), heat-tinted, in-brand.** Pipeline (scratchpad `extract-wards.mjs`):
quadkey L9 per ward → `dataset-links.csv` → India tiles `123133323` (Bally+Baruipur) +
`123133321` (Barrackpore), 338MB → stream-gunzip, bbox-clip 1.4km per ward → compact JSON
(metres rel. centre, 0.1m quantised) in `previews/heat-map-3d/data/` (~190-270KB/ward).
Extracted counts: **Ballygunge 2,048 · Baruipur 3,528 · Barrackpore 3,003** — note the fringe
has MORE buildings than the core (many small houses vs fewer large blocks): authentic
morphology signal. Viewer: ExtrudeGeometry → vertex-colour heat ramp → ONE merged mesh per
ward (~1 draw call), ODbL attribution on-screen, honesty chip "real footprints · heights
modelled — pending EE grant". Heights = deterministic per-ward profile (hash-seeded, skewed).

### EE / AlphaEarth access — verified, one IAM grant missing
- Service-account key **authenticates** (OAuth token mint 200) and can read the public EE
  catalog: `GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL` (AlphaEarth) confirmed visible.
- `ee.Initialize(project='deltaclimate-503222')` fails 403 `USER_PROJECT_DENIED` — the SA
  lacks `roles/serviceusage.serviceUsageConsumer` on the project. **Fix (user, ~30s):**
  IAM console → grant that role to `alphaearth-service-account@deltaclimate-503222.iam.gserviceaccount.com`.
- Once granted: server-side `filterBounds` export of **Open Buildings v3** polygons +
  **Open Buildings Temporal** real heights for the 3 bboxes (no bulk download), and the
  LST/NDVI/AlphaEarth raster exports. `earthengine-api` venv already set up in scratchpad.

### Corrections of record (asked + answered)
- **EE/AlphaEarth serves NO 3D models** — rasters/embeddings only. Geometry never comes from EE;
  footprints do (MS today, OB v3 next).
- **Gaussian splats need multi-view imagery** — nothing to train from footprint extrusions;
  Google's photoreal mesh is non-exportable by ToS. Splats remain the separate drone-capture
  showcase only.

---

## Secrets

The AlphaEarth / Earth Engine service-account key was moved OUT of the repo (it briefly sat at
`src/utils/deltaclimate-503222-*.json`, which is bundler-visible AND not `.vercelignore`d → would
have shipped to the client). Now at **`~/.config/delta-climate/ee-service-account.json`** (0600),
read via `GOOGLE_APPLICATION_CREDENTIALS`. `.gitignore` now blocks `*service-account*.json`,
`*-credentials.json`, `gcp-*.json`, `deltaclimate-*.json`. It was never committed → no rotation
needed. **Never** reference a key by a repo path; in CI use Vercel env secrets.

---

## Engine status (2026-07-23)
`src/scripts/climate-engine/`: **caps.ts** (tier→backend mapping, self-checked) ·
**types.ts** (HeatSim ABI + CFL/decay bounds + equilibrium seed math, self-checked) ·
**sim-gpu.ts** (tier-2 backend: fragment-shader ping-pong on float RTs in the page's
renderer; zero per-frame readback — field texture consumed directly; throttled
readback only for stats(); throws SimUnsupported without EXT_color_buffer_float →
caller falls back to ts). Wired live into previews/heat-map-3d/ (esbuild bundle,
three external): real-footprint rasterised layers → 192² grid, ground plane =
ramped field texture, stats chip, idle auto-rotate (clockwise 0.45°/frame-ish,
pauses on interaction, 4s resume, reduced-motion → static). Verified: typecheck 0,
both asserts pass, console clean, rotation + field confirmed across 6s dual shots.

## Prototype convergence (2026-07-23)

`previews/heat-map/` is now the **merged instrument**: the real-footprint 3D massing
+ live GPU sim (from `previews/heat-map-3d/`) became its map stage, and the chrome
went functional — sliders re-rasterise intervention layers and `reset()` the sim
(equilibrium seeding = instant feedback), diurnal/pathway segs drive `SimParams`,
readouts/histogram/Green Score come from `stats()` + a pure-JS zero-intervention
baseline (`eqMean`). Verified: trees 45 + roofs 80% → 35.9→33.7°C mean, UHI +3.9→+1.7°,
score 81, console clean. Auto-rotate idles at −0.25 (pause on grab, resume 1.5s).
`heat-map-3d/` stays as the standalone massing viewer; ward JSONs + sim bundle are
shared from there.

## The 2026-07-24 arc (all in `previews/`, verified with screenshots + console-clean)

1. **Live ambient forcing** — Met Norway `locationforecast` fetched per-ward (browser-direct,
   CORS `*`, keyless; production proxies via a Vercel fn). Live `tAir`/`wind`/`cloud` drive
   `SimParams`; feels-like derived via NWS Rothfusz. Right rail shows *measured* ambient above
   the *modelled* surface temp. UHI Δ fixed to a modelled rural reference under the same live
   forcing (was a stale constant that went negative). Vetted API stack + license traps:
   memory `kolkata-realtime-apis` (Met Norway ✓ commercial · WAQI ✗ · Open-Meteo hosted tier ✗).
2. **Real heights** — Google Open Buildings 2.5D Temporal via public GCS bucket (`/vsicurl/`
   window reads + per-footprint `np.bincount` zonal means; originals kept as `.synthetic.bak`).
   Ward means: Bally 7.6 m (max 54) · Baruipur 4.6 · Barrackpore 4.9 — correct core→fringe gradient.
3. **MapLibre pivot (user-chosen)** — the instrument now renders ON a live basemap:
   MapLibre GL JS 4.7.1 (BSD, keyless) + OpenFreeMap styles (`dark` ↔ `positron`, MIT, no
   usage caps) + our buildings as a `CustomLayerInterface` three.js layer sharing the GL
   context; GPU sim runs on an offscreen renderer, field bridged via throttled readback into
   a `DataTexture` the draped overlay + facades sample. Georegistration verified against
   street labels in all wards. Mapbox GL rejected (proprietary + per-load billing).
4. **Clay City craft pass (from the user's 6 inspiration boards)** — buildings sample the
   **live field** at their own position: cool = clay, hot = bronze→red (colour is *data*;
   the static ward tint was deleted). Line-art facades (floor bands + mullions), bevelled
   edges, parapet caps, roof speckle. Env toggle **Dark map ↔ Clay studio**; grow-in
   entrance animation (staggered radial rise, easeOutBack) choreographed with the fly-to.
5. **Interaction & perf** — LEFT-drag orbits (rotate+tilt), RIGHT-drag pans (user muscle
   memory from OrbitControls; do not revert to MapLibre defaults). Buttery pass: drag deltas
   coalesced to one `jumpTo`/frame + inertia glide; GPU readbacks throttled ~1.5 Hz and
   paused mid-drag; `triggerRepaint` only while animating; `pixelRatio` capped 1.75.
   Measured ~7 ms/frame during active drag.
6. **Intervention model research (2 deepsearch agents)** — methods agent (spatial recipes,
   cooling kernels incl. Kolkata-specific park-cool-island parameters, scoring precedent,
   defensibility rules) + calibration agent (cited ₹ India costs + °C anchors; first run
   stalled on paywalls, relaunched anti-paywall → landed in ~3 min) → both formalised in
   **[`heat-map-intervention-model.md`](heat-map-intervention-model.md)**.
7. **Toolbox wired FUNCTIONAL** — the card now runs the model spec end-to-end: trees green
   the hottest real streets first (OSM centerlines fetched → `data/{ward}-roads.json`),
   cool roofs raise albedo on real footprints (aged α 0.60), parks land on ranked open
   land (r 50 m = Kolkata TVoE), facades cut Q on built cells; Green Score = BAF-grounded
   `0.40·greening + 0.40·cooling + 0.20·₹-efficiency`; budget in real ₹ from real
   quantities. Verified: per-lever monotonic cooling with the real HAP hierarchy emerging
   (roofs/trees ≫ parks), 46 ms reset, console clean.
8. **Heat legibility + display pipeline** — `D` 9.0→**2.5** (a single diffusion constant
   can't both spread park cooling ~90 m and keep sharp LST hot-roof contrast; contrast
   wins, reds returned: base ~39 °C, ~49 % > 40 °C). Buildings now sample the field **once
   per building** (centroid attribute) killing the per-pixel speckle; ground drape reads a
   3×3-blurred copy (R) while buildings read raw (G). New bottom chip: **Gradient |
   5-Class** building-tint toggle (user chose keep-both).

**Production docs:** [`heat-map-page-spec.md`](heat-map-page-spec.md) (what the page is) ·
[`heat-map-implementation.md`](heat-map-implementation.md) (how to build it in the repo).

## Validation status (2026-08-02) — and the next campaign

The accuracy story moved from "measured" to "measured, with known uncertainty":

- **Published figures now carry bootstrap CIs** (over overpasses, not ward-scenes):
  night 2.93 K → 95 % CI 1.90–3.64 (20 overpasses) · peak 4.42 K → **2.91–6.65 K
  (12 overpasses)**. The daytime error bar is uncertain by ±1.87 K; sample size, not
  physics, is the weakest daytime claim.
- **Validation protocol corrected.** Leave-one-scene/ward-out leaks weather through
  sibling wards on the same pass; the honest split is **leave-one-overpass-out**. A
  daytime statistical correction that looked worth 1.5 K under the leaky split is worth
  exactly nothing under the honest one — recorded as ruled-out in
  [`heat-map-calibration-spec.md`](heat-map-calibration-spec.md) §1. The night-phase
  weather regression survives (2.81 → 2.14–2.31 K) and awaits its own shipping decision.
- **Landsat campaign: LANDED (2026-08-02).** 213 ward-scenes over **50 overpasses**
  from Landsat 8/9 C2 L2 via Planetary Computer — no credentials, no new dependency.
  The daytime CI half-width goes **±1.87 K → ±0.49 K** on the Landsat morning
  stratum, better than the ±1.1 K the spec asked for. Strata are published
  separately by hour: night · morning_ecostress (7.1–11.1 h) · morning_landsat
  (10.4 h) · peak_ecostress (11.8–17.4 h).
  - **Sensor pooling is BLOCKED, honestly.** Only 2 ECOSTRESS overpasses fall in
    Landsat's 9.5–11.5 h window against a minimum of 5, so the offset is not
    measurable here. Comparing the two across all daytime hours produces a −3.73 K
    "sensor difference" that is really the diurnal cycle: a steady-state model runs
    cool against 10:30 readings and warm against afternoon ones. That number is a
    trap and is not published.
  - **Recalibration: MEASURED AND DECLINED (2026-08-03).** POWER's hourly product
    lags real time, so two May-2026 overpasses gained forcing after `accuracy.ts`
    was written — the ECOSTRESS daytime set is 35 rows against a published
    `n = 29`. Before opening a PR for it, the refit was actually run:

    | on | RMSE | bias | day bias | night bias | q_day |
    |---|---|---|---|---|---|
    | 79 rows (published) | 3.605 | +0.164 | +2.044 | −0.926 | 0.4134 |
    | 85 rows (refit) | 3.602 | +0.275 | +2.121 | −1.018 | 0.3949 |

    **0.003 K** on a figure published to ±4.5 K, and the bias moves the wrong way.
    `ratio` and `c` stay pinned to their bounds and `meets_all_criteria` stays null,
    so the refit does not move the fit out of the not-adopted state either. Six more
    ward-scenes is 7 % more data of the same instrument, same wards, same forcing —
    and it changes the answer by 0.08 %.

    So the published numbers are right and only their stated `n` is stale. The
    drift is recorded in `model-accuracy.json.ward_scale.pending_recalibration`, the
    unit guard fails if that record goes missing or goes stale, and the `n`
    correction rides along with whatever next touches `accuracy.ts` for a real
    reason. **Do not spend a PR on this in isolation** — the measurement above is
    what that PR would have produced.
  - Spec + measured acceptance:
    [`superpowers/specs/2026-08-02-landsat-thermal-validation-design.md`](superpowers/specs/2026-08-02-landsat-thermal-validation-design.md)
    §9. Plan: [`heat-map-landsat-validation-implementation.md`](heat-map-landsat-validation-implementation.md).
    Evidence regenerates from `scripts/experiment-validation-uncertainty.py`, kept as
    an independent cross-check of the promoted machinery.

### WBPCB air quality at Ballygunge — acquired, and what it can and cannot say (2026-08-03)

Seven West Bengal Pollution Control Board station archives are now derived into
`data/opencity/aqi-daily.json` (`scripts/build-aqi-daily.py`, pipeline-side, nothing
served). One of the seven — **Ballygunge** — is a ward the model simulates, which is why
this was worth acquiring at all: a measured multi-year record standing beside a
simulated one. `--check` asserts that mapping stays unique, because the entire reason
for holding this data rests on it.

**What the Ballygunge record actually is.** 1,550 daily records, **2019-08-01 →
2023-12-31**, 96 % of its own span, 83 days flagged sparse. Every day carries `hours`
alongside `mean` and `max`; days under 18 readings are **flagged, never dropped**, so a
thin day can never pass silently as a full one.

**The catalogue's advertised span is not the coverage.** OpenCity lists these as
2017–2023. Six of the seven stations do not reach 2017 — only rabindra-bharati does
(2017-09-26). Scored against the advertised window Ballygunge reads "61 % complete",
which would describe a reliable instrument as mostly broken; against its own span it is
96 %. The artefact therefore publishes `first`/`last`/`coverage` per station and labels
the 2017–2023 range a **filter window, not a coverage claim**.

**The unit is not stated and has not been invented.** The publisher does not say whether
these are AQI points or µg/m³. Values are plausible as either (Ballygunge p50 85,
p95 289). It is carried as a relative index and is never given a unit downstream.

**What it shows.** Strong, clean seasonality, in the direction one expects and the
opposite of the heat signal — Ballygunge monthly medians run 252 in December and 240 in
January against **37 in July**. The pre-monsoon heat season, when the thermal instrument
matters most, is among the *cleanest* parts of the year (Apr–May median 66).

**The honest limit, stated plainly: this is an air-quality series offered as evidence
about a thermal model, and it validates nothing about temperature.** It supports
co-exposure and seasonality claims only. And the seasonality above actively *weakens*
the naive co-exposure story — worst heat and worst air do not coincide here, so the two
are a sequence across the year, not a compounding pair.

The one place it could later bear on accuracy is aerosol loading against the documented
**+2.04 K daytime bias**: a heavy winter aerosol layer attenuates incoming shortwave,
which a clear-sky forcing model does not see. That is a real hypothesis and not a
finding — the daytime bias is measured on a Landsat morning stratum whose overpasses are
not season-matched to the pollution peak, and testing it needs a season-stratified
re-run plus an optical-depth source neither acquired nor specced. **It needs its own
spec; do not fold it into the calibration work.** No `accuracy.ts` change follows from
this note.

Licence: Public Domain, recorded in `data/opencity/manifest.json`. Tests:
`tests/unit/opencity-aqi.test.mjs` (the ward mapping, the sparse-flag contract, the
seasonality claim above) and `tests/unit/opencity-manifest.test.mjs`.

### Building geometry, first ever validation — one gap, one hypothesis (2026-08-04)

The footprints and heights have shipped since the beginning without ever being checked
against an independent source. They now have been. **Nothing was changed as a result;
this is the measurement, recorded so the decision can be taken deliberately.** Rerun
with `scripts/validate-geometry.py` and `scripts/validate-heights.py`.

**Completeness: we are missing about an eighth of the buildings.** Against Overture
2026-07-22.0 (which merges OSM + Google + Microsoft) over the identical Ballygunge
window: ours **2,048**, theirs **3,530**. Of theirs, **426 (12.1 %) sit more than 20 m
from anything we hold** — not matching artefacts, buildings we do not show. Where both
sources see a building, position agrees well: 97.2 % within 20 m, median centroid
offset 7.3 m (inflated by Overture splitting single Microsoft blobs into individually
mapped terraces, so it is an upper bound on positional error, not an estimate of it).

**Heights cannot be validated at all — there is no ground truth.** OSM carries
`building:levels` on **6** buildings in Ballygunge and **zero** in Barrackpore
(Baruipur hit an Overpass rate limit, unmeasured). Overture carries `height` on **0**
and `num_floors` on **5**. No free dataset can score our heights.

**The hypothesis that leaves, explicitly not a finding.** Across the eight comparisons
those two sources between them allow, our heights ran **22–40 % low** — an 8-storey
building (~25 m) where we say 14.8 m, a 3-storey (~9 m) where we say 7.0 m. n = 8 is
not evidence. But the direction is consistent and there is a mechanism: our heights are
Google 2.5D **zonal-averaged per footprint**, and averaging over a footprint pulls in
courtyards, annexes and shadow, which biases the mean down. Until something can test
it, heights are **unvalidated, with a suspected low bias** — not measured.

**Why the completeness fix is not free.** Footprints feed the `built` raster, which
feeds the DC-URS resilience score. Adding ~1,480 buildings moves published numbers, so
it needs the `export-built-raster.mjs` byte-identity oracle and a recalibration check —
the same gate the water activation carries. Not a quiet swap.

**What would fix heights: the same LiDAR flight that would fix terrain.** One survey,
two Tier-1 upgrades. That strengthens the procurement case recorded in
[`superpowers/specs/2026-08-04-terrain-3d-preview-design.md`](superpowers/specs/2026-08-04-terrain-3d-preview-design.md).

### Reproducing the shipped heights: one bug of ours, one real gap (2026-08-04)

The geometry-pipeline plan opened with a **parity oracle**: before a new pipeline may
generate heights, it must reproduce the committed ones over the committed footprints.
It ran, it failed, and the plan stopped — correctly. Two rounds of diagnosis followed.

**Round 1 was our own bug, and it invalidated its own conclusion.** The first run gave
median |Δ| = 4.00 m, 23.6 % within 2 m, and a percentile sweep appeared to show the
shipped heights sitting at **p85**. That conclusion was wrong. The local-metre →
lon/lat inverse used a SOUTHWARD y convention while the shipped geometry (like
`fetch-water.py`, like the roads fetcher, like `scripts/_types.m_per_deg`) is
**NORTHWARD** — so every footprint was mirrored about the ward's centre line and
sampled a different building. Verified empirically rather than by inspection: matching
Overture centroids against ours scores 8.1 m mean-nearest northward against 13.9 m
southward. With the sign corrected, parity improved to **median |Δ| = 1.40 m, 64.0 %
within 2 m**, and the apparent p85 signature vanished — higher percentiles had merely
been compensating for sampling the wrong, generally smaller, buildings.

**Round 2 is the real remaining gap.** Correctly registered, over 483 comparable
Ballygunge buildings:

| zonal statistic | median ratio to shipped | median Δ | within 2 m |
|---|---|---|---|
| mean | 0.834 | −1.20 m | 63 % |
| **p70** | **1.086** | **+0.62 m** | **67 %** |
| p75 | 1.143 | +0.96 m | 65 % |
| p85 | 1.264 | +1.85 m | 49 % |

The true statistic sits between `mean` and `p70` — the ratio crosses 1.0 in that gap —
so the documented *"zonal-mean"* is close to right, understating by ~17 % rather than
the 38 % round 1 claimed. But **no statistic exceeds 67 % of buildings within 2 m**
against a 90 % threshold, so per-building parity is still not achieved. What is left
is most plausibly footprint processing: the shipped Microsoft rings were simplified and
rounded by the original pipeline, and a slightly different ring samples a slightly
different pixel set.

**Status: the pipeline remains stopped at its gate.** No Overture heights generated,
nothing under `public/` touched. The lasting lessons are recorded in the scripts
themselves: `to_local`/`to_lonlat` now both use `_types.m_per_deg` with the sign
documented and its evidence cited, so this class of bug cannot recur silently.

**One earlier hypothesis is now settled as unsupported.** The note above suspected our
heights ran ~25 % low from zonal-averaging. At a true statistic near p65 the effect is
real but small (~17 %), and it is dwarfed by the ±2 m per-building scatter. Switching
mean → p75 would overshoot. No method change is warranted on this evidence.

### Why Overture's heights come out taller: Microsoft merges towers (2026-08-04)

Task 2 produced heights for all 12,767 Overture footprints. Gate A (distribution
parity) breached upward — p90 rose 12.5 / 14.1 / 8.7 % across the wards while p50 and
mean barely moved, and Ballygunge's tallest building went 54.4 → 86.9 m. Predicted
direction was **down** (5,200 extra small buildings); the prediction was wrong.

The twelve tallest new buildings were checked against the Microsoft footprint covering
the same ground:

- **6 of 12 sat inside a MERGED Microsoft blob** — one shipped footprint containing 2–7
  separate Overture buildings, and 1.9–4.7× its area. The dilution is severe: a tower
  Overture puts at 58.8 m sits inside a Microsoft blob scored at **18.9 m**; another at
  49.7 m inside a blob scored 20.6 m; one blob had swallowed **seven** buildings.
  Averaging a tower together with its low neighbours is exactly the mechanism that
  motivated this work, and it is now observed rather than suspected.
- **3 of 12 had no Microsoft footprint at all** — buildings we have never drawn.
- **3 of 12 were 1:1 and still rose sharply** (86.9 vs 54.4, 69.6 vs 44.0, 41.1 vs
  17.0 m) and are **not explained by merging**. In the largest case the Microsoft
  footprint is 143 m² against Overture's 1,397 m² — a tenfold area difference in the
  other direction, suggesting Microsoft also FRAGMENTS large buildings into pieces.

**Status: substantially explained, not fully.** Half the upper-tail rise is a
demonstrable correction of merge-dilution, and a quarter is buildings we simply lacked.
The remaining quarter — 1:1 matches rising 50–140 % — has no confirmed mechanism, so
the Gate A breach must NOT be waved through as "expected" on the strength of the merge
story alone. Resolving it is the precondition for shipping these heights.

#### The precondition, discharged (2026-08-05)

The heights shipped before this was resolved, which should not have happened. Settled
now, with two things that did not exist when the anomaly was written down: per-building
**provenance** and per-building **coordinates**.

**The "1:1 matches" were never 1:1.** The paragraph above records its own answer and
does not act on it: for the largest case, Microsoft's footprint is **143 m² against
Overture's 1,397 m²**. A tenfold area difference is not a one-to-one correspondence —
it is a fragment of a building matched to the whole of it. Whatever pairing rule
produced that label was matching by proximity, not by extent. Sampling a 143 m² sliver
of a tower returns the height of whichever part the sliver covers, typically a podium
or a setback edge; sampling the whole 1,397 m² footprint returns the tower. So the
remaining quarter is the SAME fragmentation mechanism already named one sentence
earlier, not a separate unexplained one.

**And the tall tail is our best geometry, not our worst** — which inverts the worry
entirely. Of the 38 Ballygunge buildings over 30 m, **35 (92.1 %) are hand-traced
OpenStreetMap footprints**, against 63.9 % ward-wide. All three of the "unexplained"
cases are OSM polygons. Tall buildings are exactly what human mappers bother to draw,
so the upper tail sits on the most reliable footprints in the set — the very opposite
of the direction the Gate A breach was feared to indicate.

**What this does NOT do is validate the heights.** Of the twelve tallest, exactly one
carries an independent height: Orbit Sky Garden, OSM `building:levels` 18 ≈ 55.8 m
against our 54.1 m — **agreement to 3 %**, and it is the same single corroboration
recorded before. The other eleven have no ground truth of any kind. `height-method.json`
still reads `underpowered: 6 matched pairs < 8`, and that is unchanged.

So: **the Gate A breach is explained and the precondition is discharged. The heights
remain unvalidated**, which is a different limitation, already stated, and one that
only finer ground truth fixes — a night UAV flight or the 360 street survey. Do not
read this section as evidence the numbers are right; read it as evidence the RISE was
not evidence they are wrong.

### ICESat-2: the heights are UNDERPOWERED — a same-day correction (2026-08-07)

> **CORRECTION 2026-08-07, replacing the `validated` verdict published earlier the same
> day.** This section first reported **n = 30 buildings — the pre-registered bar hit
> exactly — a median difference of +1.22 m, a p65 of +3.87 m with an interval excluding
> zero, and the verdict `validated`.** All of it is **withdrawn**. The ground reference
> those numbers were measured against was contaminated, the pre-registered gate that
> should have caught it was applied at the wrong granularity, and on the corrected ground
> line **n = 28, under the bar of 30, so the verdict is `underpowered` and no difference,
> interval or test statistic may be quoted from this cohort at all.** The withdrawn
> figures are left visible below rather than deleted: what they were is part of what went
> wrong. The one measurement that survives untouched is the terrain offset (win 4), and it
> survives because it never depended on the height comparison.

ICESat-2 ATL03 photon transects — a decimetre-class laser altimeter, free, already flown
over Kolkata since 2018 — are still the first independent height measurement this project
has ever had, and the verdicts and their thresholds were **pre-registered** in
[`superpowers/specs/2026-08-06-icesat2-height-validation-design.md`](superpowers/specs/2026-08-06-icesat2-height-validation-design.md)
§5.3 before a granule was downloaded. The pre-registered table has four outcomes and one
of them is `underpowered` at fewer than 30 crossed buildings. That is the outcome, and it
is being published exactly as written.

#### What went wrong: the ground line stood on rooftops nobody had mapped

The ground line is built from photons falling **outside every mapped footprint**, so it
inherits whatever the building map missed. Overture misses buildings. Where it misses one
in dense Ballygunge, a 30 m ground window can hold **~100 % roof returns** from that
unmapped structure — and both passes of the estimator then agree with each other about
the wrong surface: pass 1's rolling p10 lands on the roof, pass 2 medians the same roof
photons and re-centres on them, and the line settles at a **stable fixed point tens of
metres above true ground**. From inside the window there is no evidence anything is wrong.

Measured across the 31 committed subsets, **5 of 31 passes carried a ground line above
+25 m**, in wards whose true ground is 3–6 m:

| pass | ground-line median | worst window |
|---|---|---|
| ballygunge 2019-01-24 | 4.46 m | **84.68 m** |
| ballygunge 2022-01-18 | 2.96 m | 39.95 m |
| ballygunge 2019-04-25 | 3.56 m | 39.20 m |
| ballygunge 2020-04-22 | 4.18 m | 36.61 m |
| ballygunge 2024-04-14 | 3.11 m | 33.68 m |

**Spec §5.1's G1b gate was written for exactly this** — its third failure mode is "the
ground line has climbed onto rooftops (> +25 m)" — **and it could not see it, because it
tests the pass MEDIAN.** The pass carrying an 84.68 m window has a median of 4.46 m. A
handful of runaway windows cannot move a median, so all 31 passes sailed through a gate
aimed precisely at them. The idea was right; the granularity was wrong. That is recorded
as a dated in-place correction in
[spec §5.1 and §5.2.1a](superpowers/specs/2026-08-06-icesat2-height-validation-design.md).

#### The fix, and the allowance that is not a dial

The same test now runs **per window**: any window whose value departs from that pass's own
ground-line median by more than **10 m** is refused, and — this is the load-bearing half —
**the line is not bridged across a refusal.** Every photon whose two bracketing surviving
windows straddle a refused one comes back NaN, because interpolating over it would hand
those photons a ground value manufactured from two windows that never saw that ground.
The distances are not small: one refusal on the 84.68 m pass has **no honest window within
165 m**, and a Baruipur pass would have bridged **180 m**. Across the sweep the gate
refused **27 of 1,702 ground windows on 11 of 31 passes**, dropping 1,134 photons — all
counted in the artefact's `excluded` block, apart from the out-of-span ones, because a
short track and an unmapped building say different things.

**10 m is measured, not chosen.** The ward terrain artefacts record what relief these
wards actually have across a 1.4 km box — smoothed spans of 4.9, 6.7 and 7.7 m, raw spans
of 6.6, 7.4 and 8.9 m — with the DSM's own per-cell RMSE against Copernicus GLO-30 at
1.5–2.1 m. Real terrain therefore cannot put a window more than ~11 m from its pass
median, while the failure being caught starts at the 11–36 m these wards' roofs stand
above ground. 10 m sits above every measured relief span and below the shortest roof.

**And the verdict does not depend on it**, which is recorded rather than asserted. The
artefact's `method_stability.relief_allowances` re-runs the entire cohort at six
allowances:

| allowance | 6 m | 8 m | **10 m** | 12 m | 15 m | 20 m |
|---|---|---|---|---|---|---|
| windows refused | 67 | 42 | **27** | 20 | 16 | 12 |
| n buildings | 26 | 28 | **28** | 28 | 29 | 29 |
| verdict | `underpowered` | `underpowered` | **`underpowered`** | `underpowered` | `underpowered` | `underpowered` |

Nowhere in that range does the outcome move. The block ships with `published: false` and
none of its numbers may be quoted as a result — every row is a cohort below the bar — but
it exists so that "the allowance was not tuned to get an answer" is a checkable claim
rather than a promise.

#### The consequence: n = 28, and why that is the honest number

**n = 28 distinct buildings against a pre-registered minimum of 30**, pooled from 31
overpasses that re-fly **2** distinct reference ground tracks. **25 of the 28 are
Ballygunge**; Barrackpore contributed 1 and Baruipur 2. Two crossed buildings lost their
ground reference to the relief gate outright — they are counted in the artefact as
`n_ground_refused`, not bundled into "out of band", because more passes on the same track
would not recover them and mapping the missing buildings would.

**Those two are the whole story.** The earlier run reached exactly 30 — the bar, hit and
not cleared. Removing a corrupted ground reference removed the marginal buildings, and the
marginal buildings were the bar. **n = 30 was only ever reached because one or two
buildings were measured against ground that was standing on a roof.** Nothing was relaxed
to get it back: not the bar, not the 5 m erosion, not `MIN_ROOF_PH`, not the roof band,
not the relief allowance. Recovering 30 by moving any of them would be the exact failure
this workstream exists to avoid, and the pre-registration exists so that the temptation
has no purchase.

**Under `underpowered`, no statistic is published.** Not the median, not the intervals,
not the permutation p-value, not the effect size — and not in prose either. The
`floor_sensitivity` block is absent from the artefact for the same reason it always would
be below the bar, and `assertAccuracyLogic()` now fails if any field matching
`bias|ci95|permP|ksD` reappears in the `HEIGHTS` block, or if the user-facing note
reintroduces one in words.

**A second selection sits behind the erosion, and it is a size filter too.** Of the **59**
buildings the beams crossed, only **28** were measured. **26** were lost to
`MIN_ROOF_PH = 5` — fewer than five roof photons pooled across every pass — **3** more to
the 2.0 m roof-band floor, and **2** to the relief gate. Photon density over a roof scales
with roof area, so `MIN_ROOF_PH` selects on size on top of the 5 m erosion below: the
measured cohort is not the crossed cohort, it is the larger half of it. The causes are
counted apart in the artefact because they have different remedies.

#### Worth recording, and explicitly NOT a finding

Sweeping the ground line's **30 m rolling window** out to 200 m — a methodological choice,
not a physical one — moves n between 27 and 31 and **flips the pre-registered verdict**,
while the divergence high in the distribution stays roughly where it is:

| window | **30 m** | 50 m | 80 m | 120 m | 200 m |
|---|---|---|---|---|---|
| n buildings | **28** | 27 | 29 | 31 | 31 |
| verdict | **`underpowered`** | `underpowered` | `underpowered` | `validated` | `validated` |

**This is not publishable as a result and is not published as one.** Every row is either
below the bar or a cohort built by a window width nobody pre-registered, and §5.3 admits
no statistic below the bar. It is recorded in `method_stability.ground_window_widths`, and
here, for one reason: it says how far this method reaches. The median verdict is not
robust to a choice made for smoothing reasons; whatever is happening higher in the
distribution is steadier than the verdict is. That is a reason to **re-ask the question
when more passes arrive** — ICESat-2 is still flying these tracks and the beams wander
across-track between cycles (see error 4 below), so new passes really do bring new
buildings — and it is emphatically not a reason to pick a width.

**FAR is untouched, and now for two reasons.** Heights feed `compute-far.py` →
`far.json` → `build-dcurs-inputs.py`, which ships FAR labelled `"measured"` and carrying
0.35 × 0.30 = **0.105** of the DC-URS score. No correction was applied to `far.json` on
the strength of this cohort when it read `validated` at n = 30, and there is now no
statistic to apply.

**What this does NOT claim, and no sample size would earn:**

- **Not per building.** ATL03 horizontal geolocation is ~3–5 m against 10–20 m Kolkata
  buildings, so any photon may have landed on the neighbour. Per-building estimates exist
  only to build the distribution and none is published.
- **Not an accuracy improvement for the heat field.** `heat-map-model.ts` has no
  building-height term at all — `built` is an area fraction. This cannot move `r`, the
  ±3.0 K band, or the amplitude ratio, and must never be quoted as if it had.
- **Not a survey of the ward.** It is a survey of buildings a satellite ground track
  happened to cross, among buildings large enough to survive a 5 m erosion.

**How large that last qualifier is, measured.** The 5 m footprint erosion (5 m *is* the
geolocation error) admits only:

| ward | buildings | survive 5 m erosion | share |
|---|---|---|---|
| ballygunge | 3,527 | 995 | **28.2 %** |
| barrackpore | 4,702 | 719 | **15.3 %** |
| baruipur | 4,538 | 326 | **7.2 %** |

So the visible population is **the largest 7–28 % of each ward**, before a beam is even
considered. The erosion cannot be relaxed to widen it: shrinking it admits photons that
may belong to the next building, which trades a **disclosed selection effect for an
undisclosed attribution error** — the worse of the two.

#### Four errors caught on the way, each of which would have published a wrong number

**1 · The "closest track at 79 m" was a bounding box, not a laser.** The spec opened by
naming one granule 79 m from Ballygunge centre and staging the whole workstream on it.
That distance came from the granule's CMR bounding **polygon**, which spans the entire
six-beam swath; the beams are elsewhere. That granule's nearest strong beam is **6.27 km**
away and returns **zero** photons in the box. Compounding it: empty `geolocation` segments
carry placeholder coordinates on a shared line **~11 km** off, so they must be dropped
before any distance is computed or the minimum is meaningless.

**2 · The geoid gate was asking a surface model to be a ground model.** The known-answer
check originally required the photon ground line within ±5 m of `<ward>-terrain.json`'s
median. It failed **15 of 15** usable passes, always the same direction — photon ground
2.96–6.33 m against DEM medians 10.3–11.6 m — repeatable to ≤1.5 m across six years and
all three wards. That is a systematic offset, and the artefact's own `note` says why:
*"smoothed **surface** model … **NOT surveyed ground**"*. No tolerance makes that
comparison meaningful, so the fix was a different test, not a wider one: our hardcoded
EGM2008 constant is now checked against **ATL03's own `geophys_corr/geoid`** over the same
photons (agreement ≤ **15 mm** across all 31 subsets, against a 0.5 m tolerance), plus a
plausible-band check that the ground line lands in [−2, +25] m orthometric. A skipped
conversion lands near −52 m, a sign error near +61 m; both are caught by a wide margin.

**3 · The fill-cohort statistic could not return zero.** Win 2 was to audit Google's 2.5 m
fill (13 % of buildings in every ward) by taking the crossed fill buildings' ICESat-2
median minus 2.5 m. That statistic is invalid **in the direction that flatters the
finding**: the roof band's 2.0 m floor deletes photons below 2 m, and the fill cohort is
by definition made of buildings Google could not measure — disproportionately short ones.
The one crossed fill building at the time had **all 4 of its roof photons below 2 m** —
ICESat-2's evidence that the fill is approximately right — and was silently deleted
from the statistic designed to test the fill. Amended to a **proportion**: of the crossed
fill buildings, what fraction show roof evidence above 2.5 m, so a building whose photons
all sit low counts as evidence *for* the fill instead of vanishing. The floor did **not**
move; lowering it to rescue the cohort would be tuning a threshold to get an answer.
Under the amended definition the cohort is **n = 5** — the old statistic had deleted 4 of
those 5 — still **`underpowered`** against its bar of 10. **Wins 2 and 3 therefore did not
land**, and `compute-far.py --icesat2-correction` reports `no_correction_computable` with
no pool invented and the main cohort not substituted for it. The floor's effect on the
MAIN comparison used to be quantified here, at 1.0 / 0.5 / 0.0 m; those figures are
**withdrawn with the rest of the cohort's statistics** and the artefact's
`floor_sensitivity` block is now `null`, because a sensitivity table beside
`underpowered` publishes the number the verdict withheld. What survives is the count:
**313 roof photons** sit below the floor across the sweep, and the floor does not move.

**4 · "Coverage is capped by three beam lines" was wrong, and I asserted it confidently.**
The spec argued repeat passes re-fly one ground line, stacking photons on the same
buildings without sampling new ones — and I used that to predict `underpowered` at better
than even odds. The completed sweep refutes it. Closest approach across repeat passes of a
**single** track:

| ward / track | passes | closest approach, min → max | spread |
|---|---|---|---|
| ballygunge / 0416 | 11 | 125.7 → 851.8 m | **726 m** |
| baruipur / 0744 | 9 | 199.7 → 658.5 m | 459 m |
| barrackpore / 0744 | 6 | 649.6 → 1004.9 m | 355 m |

A 726 m spread across a 1,400 m ward is not pointing jitter: the beams genuinely wander
across-track between cycles, partly because the periodic yaw flip changes which beam of a
pair — and which pair, ~3.3 km apart — is nearest. Ballygunge's 12 passes crossed **50
distinct buildings** against the 4–13 a fixed line predicts, and passes turned up 663 m
from Baruipur centre on RGT 0416, a track the coverage table places 5 km away. **This
effect is the only reason the 30-building bar was ever within reach** — and, now that the
corrected cohort stands at 28, it is also the reason the question is worth re-running
rather than closed: new passes genuinely bring new buildings. Consequence for anyone reading
`icesat2-coverage.json`: it describes one representative granule per track, not that
track's envelope across cycles. It is a guide to which tracks are worth probing, never a
ceiling on what they can sample.

#### A statistical trap worth recording on its own

The omnibus check was originally scipy's two-sample KS test. Our two samples are the same
buildings measured twice — **paired and strongly correlated** — which drags both ECDFs
together and collapses the statistic. Measured under H₀ at n = 60, a nominal 5 % test
rejected **0 times in 2,000 draws**, and its power against a half-storey bias was 0.06. It
could not reject anything, so it would have returned a large comfortable p-value almost
regardless of the truth, and that would have been published as *"the omnibus check found
no significant difference"* — a broken null handing the model a free pass. Replaced with a
**paired permutation test** that randomises each pair's assignment over 10,000 draws.
(The p-value that test produced on the earlier, contaminated cohort is **withdrawn** along
with every other statistic: below the bar the script does not compute one, and the
artefact carries none.) The lesson stands on its own — it is about the null, not the
number.

The same class of defect sat in the ground line: a single-pass p10 quantile sits ~1.28× the
local photon spread **below** true ground, measured at **−1.19 m** on a 1 m spread, which
inflates every height-above-ground and cannot be seen by a bootstrap that resamples
buildings. The shipped line is two-pass (p10, then the median of candidates within ±1.5 m,
to convergence): **−1.19 → −0.49 → +0.05 m**. The residual error is *positive*, i.e.
heights come out slightly short — the conservative direction for a validation claim.

#### The free fourth win, arriving inverted

ICESat-2 ground photons were expected to validate our ~30 m relief surface. They did, in
the unflattering direction: **the shipped relief sits +6.55 m ABOVE decimetre-class laser
ground**, consistent across both independent ground tracks (**6.65 m** on RGT 0416, **6.45
m** on 0744, from 31 passes). **This is the one number the correction above leaves
standing**, and it stands because it never depended on the height comparison: it is the
per-pass DEM-minus-laser offset recorded when each subset was written, medianed per
distinct ground track, and it is unchanged to the last centimetre. It is a DSM by its own admission, and over the dense Ganges
delta a smoothed SRTM-derived surface sits metres above true ground on vegetation and
rooftops. This changes **nothing** in the model — `terrain.json` is explicitly "NOT used by
the simulation" — and **nothing** in the height comparison, whose ground line comes from
the photons themselves and never from the DEM. It is recorded because it is a real
measurement about a shipped artefact, and because it is the number to hand the LiDAR
procurement case.

#### The pipeline, and where to look

CMR granule search → **ranged-read prefilter** → subset → two-pass ground line →
**pointwise relief gate** → 5 m-eroded roof assignment (roof band [2, 120] m, ≥ 5 roof photons per building) → p75 per
crossed building → distributional comparison. The prefilter is the reason this was
affordable: ATL03 granules here run **285 MB to 1.82 GB** — a range recorded in
`fetch-icesat2.py`'s header comment, not measured into any artefact — and the same
`decide()` function run over HTTP range requests reaches the same verdict on a **median
30.4 MB and 57 s** per granule, measured over the 118 probes in
`icesat2-prefilter.json`.
**118 ward-granule evaluations were probed; 31 survived and were downloaded**, subset to
~200 KB each and committed. Nothing was relaxed to reach the bar — the granule that missed
the 100-confident-photon minimum by four photons stayed rejected. The committed subsets
make every rerun **fully offline**: no token, no network, no granule.

- Spec, with its dated in-place corrections: [`superpowers/specs/2026-08-06-icesat2-height-validation-design.md`](superpowers/specs/2026-08-06-icesat2-height-validation-design.md)
- Scripts: `scripts/_icesat2.py` (geometry + statistics, self-testing), `scripts/fetch-icesat2.py`
  (the only network script; `--prefilter` for the ranged-read sweep),
  `scripts/measure-height-accuracy.py` (offline, produces the verdict),
  `scripts/icesat2-coverage.py`, `scripts/diagnose-icesat2-transect.py`
- Artefacts: `data/calibration/icesat2-heights.json` (verdict, exclusions including the
  relief gate's ledger, terrain, and `method_stability` — which is method evidence flagged
  `published: false`, never a result), `data/calibration/icesat2-coverage.json`,
  `data/calibration/icesat2-prefilter.json`, `data/calibration/far-icesat2-sensitivity.json`,
  and the 31 committed subsets under `data/calibration/icesat2/`
- Published wording and its guards: the `HEIGHTS` block in
  `src/scripts/climate-engine/accuracy.ts`. Each clause of the user-facing note has an
  assertion behind it, and the guards were rewritten with this correction. The old set
  hung five of its checks off `verdict !== 'validated'`, so the moment the verdict moved
  **all five went vacuous at once** while the note went on making the claims they
  protected — the disclosures are unconditional now. Two new ones enforce the
  pre-registration directly: no field matching `bias|ci95|permP|ksD` may exist while the
  verdict is `underpowered`, and the note may not reintroduce a difference, an interval, a
  percentile or a significance claim in words. Every guard was mutation-tested — each was
  broken deliberately and confirmed to fire. `tests/unit/heat-map-accuracy.test.mjs` pins
  every published field to the artefact, checks the artefact itself is silent below the
  bar, and pins the one figure the verdict still permits: the terrain offset.


## The ward was drawn MIRRORED, and it took four attempts to see (2026-08-05)

**Every ward rendered reflected about its own east–west centre line.** MapLibre's
mercator y grows southward; every producer here puts the data's northing into world
`+z`. Composed, north drew south. Each building sat on the wrong side of its street.

This is the true cause of the "buildings are on the road" report. It was diagnosed
three times as something else — most recently as the basemap's painted road casing
being wider than the real carriageway, supported by setback statistics (median 5.75 m,
38.3 % within 4 m) that were **correct about the data and never described the screen**.
The road layer built on that diagnosis draws in the same mirrored frame, so our roads
and buildings agreed with each other while both disagreed with the basemap — and
hiding the basemap's casings removed the last visual evidence.

**How it was finally settled**, and the method is the point:

1. **The data was never wrong.** `data/geometry/{ward}-footprints.json` carries both
   `p` (ward metres) and `lonlat`. Buildings at local `y ≈ +500 m` measure latitude
   **22.53253** against a predicted **22.53252** — one centimetre.
2. **A numerical fit, not an eyeball.** Fitting the four ponds in a top-down capture
   against `{ward}-water.json` over every assignment: mirrored **8.9 px RMS**,
   north-up **479 px** — and the mirrored fit independently recovered the image
   centre. After the fix the same test gives north-up 8.3 px, mirrored 239 px.
3. **An independent landmark.** Garcha Road is really 249 m *south* of the ward
   centre, where the basemap draws it. The basemap was right; we were not.

**Why three earlier attempts failed:** each was a matrix reconstruction or a visual
impression. Both are unreliable here. The rule this leaves behind — already written
down once after the third failure and not then followed — is that a coordinate-frame
claim is only settled by a **numerical fit against an independently-known feature**.
Water is ideal: sparse, asymmetric, and present in the artefact.

**Two other flips were found in the same audit**, and one is not a rendering matter:

- `terrain.ts` read the heightfield rows inverted, which *cancelled* the render
  mirror. The relief was the one layer landing correctly, for the wrong reason.
  Both had to be fixed in the same commit — either alone mirrors the ground against
  the buildings standing on it.
- **The surface raster and the built raster disagreed about which row was north**,
  so `eqCell` combined a cell's real built fraction with another cell's vegetation.
  Measured: `corr(veg, built)` = **+0.071** as loaded, **−0.398** flipped. Dense
  building means low vegetation, so only the negative one is physical. This was a
  physics-input defect independent of the render, and it reached the corridor
  ranking, the facade tint, the building card's local temperature and the cooling
  distances. The published `SPATIAL` figures were re-measured because of it.

**Why nothing caught any of it:** no test asserted anything about the composed model
matrix, and the two self-checks that should have caught the row inversions were
structurally blind — `assertTerrainLogic` varied a ramp by *column* only, and
`assertWaterDepthLogic` probed a *centred* square. Both gaps are now closed, and the
terrain probe was watched failing against the old mapping before it was committed.


## Phases
1. **Skeleton + render** — route, canvas, Three scene, `DataTexture` static synthetic field, colormap shader.
2. **Sim in worker** — `sim-ts.ts` + `sim.worker.ts` + transferables; play/pause; prove 60fps, no main-thread contention.
3. **Controls + readouts** — sliders, ΔT vs baseline, % area above threshold. Becomes a tool.
4. **Perf + a11y** — tier-aware grid, reduced-motion, keyboard-first controls, dispose discipline, e2e test.
5. **Later (optional)** — WASM impl behind the ABI; real ECOSTRESS/GHSL/footprint ingestion; AlphaEarth similarity.

## Open decisions (from the last review — unresolved)
- **Default environment:** Dark map vs Clay studio (both built, toggle live; user comparing).
- **Palette:** dark (current) vs a warmer bronze-forward variant (COSMO/Dune in the board are cream).
- **Comparison model:** ward *switcher* (current) vs *side-by-side two-ward* split screen.
- **Default map mode:** now tier-driven in `caps.ts` (potato → 2D isotherm, tier 1–2 → 3D relief); only the *high-tier* default (relief vs isotherm on capable devices) is still open.
- **noindex** while the data story is synthetic; flip when real. (`Base.astro` already supports the prop.)
- **GHSL Kolkata tile** — recommended, not yet fetch-verified.

## Verification (when built)
- `npm run check` 0 errors; `npm run build` green.
- Extend `tests/e2e/core-accessibility.spec.ts`: `/heat-map` loads, canvas present, no console errors,
  controls keyboard-reachable, axe WCAG 2.2 AA clean.
- Frame-time probe (reuse the `/tmp/fpsprobe.mjs` CDP pattern from the river work): main-thread ≈60fps with sim running.
- Worker-leak check: navigate away → worker terminates, no orphaned rAF.
- Mobile emulation (390×844 DPR3): tier drop, reduced grid, no jank.
- Confirm the synthetic-data banner is visible and `/heat-map` is `noindex` until data is real.
