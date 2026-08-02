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
  - **Recalibration pending.** POWER's hourly product lags real time, so two
    May-2026 overpasses gained forcing after `accuracy.ts` was written — the
    ECOSTRESS daytime set is 35 rows against a published `n = 29`. Recorded in
    `model-accuracy.json.ward_scale.pending_recalibration`; the unit guard fails if
    that record goes missing or stale. Adopting the figures is its own reviewed PR.
  - Spec + measured acceptance:
    [`superpowers/specs/2026-08-02-landsat-thermal-validation-design.md`](superpowers/specs/2026-08-02-landsat-thermal-validation-design.md)
    §9. Plan: [`heat-map-landsat-validation-implementation.md`](heat-map-landsat-validation-implementation.md).
    Evidence regenerates from `scripts/experiment-validation-uncertainty.py`, kept as
    an independent cross-check of the promoted machinery.

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
