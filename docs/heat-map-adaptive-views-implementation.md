# Urban Heat Explorer adaptive views

## Astro integration plan

**Status:** Implemented, verification complete

**Implementation status:** In branch review; not yet merged

**Depends on:** [`heat-map-adaptive-views-spec.md`](heat-map-adaptive-views-spec.md)

**Prototype reference:** `previews/heat-map-p2-p7/`

**Working branch:** `agent/heat-map-adaptive-views`

**Last updated:** 2026-07-25

This document records how the approved adaptive views are integrated into the Astro
application. The Paired Thermal Observatory section supersedes the earlier 2D-only
renderer plan while keeping its Canvas implementation as the progressive fallback.

The existing prototype remains isolated under `previews/`. No production file should copy
the prototype's synthetic calculations or schematic maps.

---

## 1. Engineering principles

1. **Preserve the current Explore route.** Extract shared contracts before changing its
   visual behavior.
2. **One analytical state system.** Desktop and mobile render the same state; they do not
   run separate calculations.
3. **One model implementation.** Comparison adapts coverage units into
   `heat-map-model.ts`; it does not port the prototype formulas.
4. **Atomic paired results.** A comparison publishes only when both ward runs use the same
   forcing and release contract.
5. **Thin Astro, vanilla TypeScript core.** Keep the standing architecture unless a later
   decision explicitly changes it.
6. **Progressive resilience.** Semantic content and controls exist without 3D or animated
   rendering.
7. **Honesty is state, not copy.** Live, stale, fallback, model, data, and backend identity
   are typed values used by every surface.
8. **No P6 work in this plan.** The deferred loading and bundle strategy remains untouched.
9. **One calibrated analytical grid.** V1 runs every analytical result at the canonical
   192 × 192 grid. Device tiers may change only display resolution and resampling.
10. **Denominators follow the data and application.** Each control, model selector, and
    delivered quantity uses one versioned stock basis. Mapped/modelled language remains
    mandatory unless a real eligibility inventory exists.
11. **Mode-specific forcing.** Explore may use per-ward live, stale, or fallback ambient
    conditions. Compare uses one named regional reference heat-day record for both wards.
12. **Static-build boundaries stay explicit.** The brief's shell is available without
    JavaScript; arbitrary numeric results are reproduced in the client unless SSR/API and
    retained storage are separately approved.
13. **Analytical rasterisation is browser-independent.** Footprint coverage uses the pure
    2×2 supersampled polygon raster in `ward-raster.ts`; native Canvas antialiasing is
    display-only and cannot change roof area, selected cells, or model statistics.

---

## 2. Recommended route architecture

```text
/heat-map/             Explore route, existing 3D instrument
/heat-map/compare/     Paired Ward Bench
/heat-map/brief/       Scenario or paired printable record
```

Recommended Astro pages:

```text
src/pages/
  heat-map.astro
  heat-map/
    compare.astro
    brief.astro
```

Why separate routes:

- Compare has a different rendering contract: two linked ward scenes governed by one
  paired view state, with two fixed Canvas fields as the resilient floor.
- The URL becomes a durable analytical record.
- Each page mounts one lifecycle controller.
- Compare can fail or roll back without destabilizing Explore.
- The brief can render readable metadata and method copy before client enhancement.

All three routes remain behind the existing `noindex` publication gate.

---

## 3. Proposed production file tree

The exact names may change during implementation review, but ownership should remain this
clear.

```text
src/components/ClimateEngine/
  explore/
    HeatMapStage.astro
    ExploreControls.astro
    ExploreEvidence.astro
  compare/
    PairedBench.astro
    PairedMaps.astro
    PairedControls.astro
    PairedEvidence.astro
    PairedWardPicker.astro
    MobileComparisonSheet.astro
  brief/
    HeatMapBrief.astro
  shared/
    HeatMapModeNav.astro
    HeatMapEvidenceStamp.astro
    HeatMapLegend.astro
    HeatMapHonestyNote.astro
    HeatMapStatus.astro

src/scripts/climate-engine/
  heat-map-app.ts                    existing Explore entry during migration
  heat-map-model.ts                  existing model source of truth
  types.ts                           existing HeatSim ABI
  sim-ts.ts                          required non-GPU backend
  sim-host.ts                        backend selection and lifecycle
  wards.ts                           ward metadata and stable IDs
  ward-loader.ts                     versioned asset loading and cancellation
  ward-raster.ts                     canonical-grid base-layer preparation
  forcing.ts                         mode-specific forcing contracts and Explore service
  evidence.ts                        version and publication evidence contract
  scenario/
    coverage.ts                      comparison coverage adapters
    scenario-state.ts                normalized scenario types and defaults
    scenario-url.ts                  parse, sanitize, and serialize URL state
  compare/
    reference-forcing.ts             immutable Compare reference-record resolver
    paired-runner.ts                 coordinated ward runs and cancellation
    paired-controller.ts             DOM lifecycle and event ownership
    paired-map-2d.ts                 fixed-scale 2D field rendering
    paired-map-3d.ts                 linked optional Three.js observatory
    paired-brief.ts                  brief data projection

src/styles/heat-map/
  tokens.css
  explore.css
  compare.css
  brief.css

public/heat-map/data/
  manifest.json                      immutable data-release metadata
  existing ward and roads assets

tests/unit/
  heat-map-coverage.test.mjs
  heat-map-scenario-url.test.mjs
  heat-map-paired-runner.test.mjs
  heat-map-evidence.test.mjs

tests/e2e/
  heat-map-explore.spec.ts
  heat-map-compare.spec.ts
  heat-map-mobile.spec.ts
```

The current `HeatMapStage.astro` may move under `explore/` only after import paths and
regression tests are green. A move is not required for the first functional milestone.

---

## 4. Current-code gap map

| Current location | Current behavior | Required change | Preserve |
|---|---|---|---|
| `src/pages/heat-map.astro` | Mounts one Explore controller | Add mode navigation; later share route-level metadata helpers | Existing dispose hooks and `noindex` |
| `HeatMapStage.astro` | One desktop-first full-screen shell | Extract shared chrome; add complete Explore mobile contract later | Current 3D instrument and heat-map tokens |
| `heat-map-app.ts` | Owns state, data loading, model, rendering, DOM, and lifecycle | Expose shared ward/data/forcing services without a big-bang rewrite | Stable Explore behavior |
| `heat-map-app.ts` ward strip | Updates only the active ward result | Do not reuse as a comparison cache | Current single-ward navigation |
| `heat-map-app.ts` live fetch | Direct Met Norway call; console-only fallback | Return typed live/stale/fallback state and visible evidence | Current ambient-to-model mapping |
| `heat-map-model.ts` | Pure model and economics | Add or consume a pure coverage adapter; keep formulas centralized | Existing citations and assertions |
| `types.ts` | Swappable `HeatSim` ABI | Use it in the paired runner; avoid binding compare to GPU details | ABI and stability limits |
| `sim-gpu.ts` and `caps.ts` | GPU backend exists; capability policy is not wired into the app | Add `sim-ts.ts` and one backend-selecting host | Existing GPU implementation |
| `heat-map-model.ts` and field textures | Grid size is globally fixed at 192 and physics constants are calibrated in cell units | Make the 192 × 192 `GridSpec` explicit and versioned throughout analytics; let capability policy alter only backend and display sampling | Existing calibrated analytical behavior |
| Ward roads, footprint, height, and façade assets | Support mapped/model stock but contain no programme-eligibility masks | Use mapped/model labels, or add versioned predicates, masks, and inventories before using eligible/priority language | Existing source geometry |
| `buildSpatial`, `applyInterventions`, and `computeCost` | Tree effects select ranked corridor cells while reported cost scales total road length; façade effects use built cells while cost scales a geometry-derived area | Add aligned segment/surface selectors, or report modelled cell/intensity coverage and omit unsupported physical quantities | Existing model coefficients |
| Park intervention model | Applies whole 0.785 ha sites | Implement an approved fractional final patch, or snap the control before simulation and disclose the applied area | Existing whole-site kernel |
| `Base.astro` | Global skip link targets `#main`; Lenis starts on every route | Add a valid tool landmark and native-scroll route opt-out | Shared layout and metadata |
| `astro.config.mjs` | Sitemap exclusion covers only the exact `/heat-map/` path | Exclude every noindex heat-map route, including Compare and Brief | Existing publication gate |
| `scripts/check-publication-contract.mjs` | Does not inspect the new route contracts | Add Compare and Brief assertions for noindex, canonical metadata, and sitemap exclusion | Existing publication check |
| Static Astro output | Cannot server-render arbitrary URL-driven scenario results | Render a durable Brief shell and reproduce numbers client-side; treat SSR/API as separate scope | Current static deployment |
| Prototype `prototype.js` | Synthetic paired heuristics | Use only as interaction reference | State names and proven UX behavior |
| Prototype SVG maps | Schematic approval visuals | Replace with real model fields over ward geometry | Equal extent, fixed scale, north-up contract |
| Current test suite | No heat-map-specific Playwright coverage | Add route, lifecycle, responsive, and WCAG tests | Existing Playwright and Axe setup |

---

## 5. Core type contracts

The implementation should begin with types and pure functions. Representative contracts:

```ts
type WardId = 'ballygunge' | 'baruipur' | 'barrackpore';
type Phase = 'peak' | 'retained';
type ExploreForcingStatus = 'live' | 'stale' | 'fallback';
type CompareForcingStatus = 'reference' | 'fallback-reference';

interface CanonicalGridSpec {
  gridVersion: 'hm-grid-192-v1';
  cellsPerSide: 192;
  extentM: 1400;
  analytical: true;
}

interface ExploreForcingEvidence {
  kind: 'ward-ambient';
  id: string;
  ward: WardId;
  status: ExploreForcingStatus;
  observedAt: string | null;
}

interface CompareForcingEvidence {
  kind: 'reference-heat-day';
  id: string;
  status: CompareForcingStatus;
  referenceLocation: string;
  referenceDate: string;
  source: string;
  phaseValues: Record<Phase, Ambient>;
}

type ForcingEvidence = ExploreForcingEvidence | CompareForcingEvidence;

interface StockBasisVersions {
  trees: string;
  roofs: string;
  parks: 'study-window-196ha-v1';
  facades: string;
}

interface CoverageScenario {
  treesPct: number;
  roofsPct: number;
  parksAreaPct: number;
  facadesPct: number;
  stockBasis: StockBasisVersions;
  phase: Phase;
  pathway: '2025';
}

interface ReleaseEvidence<TForcing extends ForcingEvidence> {
  forcing: TForcing;
  modelVersion: string;
  grid: CanonicalGridSpec;
  dataVersion: string;
  stockBasis: StockBasisVersions;
  backendVersion: string;
  screening: true;
}

interface WardScenarioResult<TForcing extends ForcingEvidence> {
  ward: WardId;
  baselineMeanC: number;
  scenarioMeanC: number;
  coolingC: number;
  baselineHotAreaPct: MetricValue<number>;
  scenarioHotAreaPct: MetricValue<number>;
  hotAreaChangePp: MetricValue<number>;
  ruralContrastC: number;
  capitalCost: CapitalCostEvidence;
  delivered: DeliveredQuantities;
  scenarioField: Float32Array;
  evidence: ReleaseEvidence<TForcing>;
}

interface PairedResult {
  a: WardScenarioResult<CompareForcingEvidence>;
  b: WardScenarioResult<CompareForcingEvidence>;
  contract: 'paired-coverage-v1';
  settledAt: string;
}
```

The exact type syntax is not locked by this document. The invariants are.

`MetricValue<T>` represents either an evaluated value with provenance or an explicit
unavailable state such as `not-evaluated-for-retained-phase`. A missing or unavailable
metric is never represented as zero or an unlabeled dash.

`DeliveredQuantities` must distinguish physical delivery from modelled coverage and carry
the matching `stockBasis` version for each lever. Unsupported corridor kilometres or
façade square metres use a typed unavailable state; they are never inferred from an
unrelated total or coerced to zero.

`CanonicalGridSpec` must travel with prepared ward layers and results. Comparison code
cannot read `SIM_N` as an implicit global when allocating arrays or applying
interventions. In v1, a non-192 analytical grid is rejected rather than silently selected
for a lower-capability device. Supporting another analytical resolution requires a new
model/grid release and cross-grid convergence evidence. Renderers may independently
resample the settled 192 × 192 field.

---

## 6. Coverage adapter

The Compare UI uses matched coverage against a documented stock basis while the current
model uses mixed input units. A pure adapter must be the only conversion point.

### Required conversions

```text
trees model input   = corridorCellPct / 100 × 50
roof model input    = roofsPct
parks planted ha    = parksAreaPct / 100 × 196 ha
parks site eq.      = parks planted ha / 0.785 ha
parks whole patches = floor(clamp(site eq., 0, 10))
parks final fraction = fractional part of clamped site eq.
facades model input = facadeIntensityPct / 100 × 15
```

The tree and façade formulas above are valid only when the UI explicitly uses the current
modelled corridor-cell and façade-intensity bases. They do not by themselves substantiate
treated kilometres or square metres. The 196 ha value follows the fixed 1.4 × 1.4 km
window.

Reference test vector:

```text
55% modelled corridor cells -> 27.5 tree model units
65% roofs    -> 65 model units
3% parks     -> 5.88 ha -> approximately 7.49 site equivalents
35% façade intensity -> 5.25 façade model units
```

The park conversion above describes the proposed continuous-control option, not current
production behavior. If R10 selects fractional application, the intervention layer applies
the whole patches plus one partial-area final patch and records the exact applied hectares.
If R10 selects snapped or whole-site behavior, scenario normalization changes the control
value before simulation so requested, applied, and displayed area cannot disagree.

The adapter computes a physical delivered quantity only from the same versioned inventory
used to select and rasterize the intervention. It must not multiply a model-cell percentage
by total road length, or a global built-cell intensity by total façade area, and present the
result as delivered work. Corridor kilometres and façade square metres require aligned
segment/surface selectors; otherwise the UI reports modelled cell/intensity coverage and
omits those physical quantities. It may use an eligible inventory only when the data
release includes the eligibility predicate or mask and its denominator. The chosen stock
basis and version are part of the evidence contract.

No UI component performs these conversions.

---

## 7. Paired calculation pipeline

### 7.1 Data flow

```text
URL
  -> parse and sanitize
  -> PairedScenarioState
  -> coverage adapter
  -> controlled reference forcing record
  -> paired runner
       -> Ward A baseline and scenario
       -> Ward B baseline and scenario
  -> invariant check
  -> atomic PairedResult
  -> desktop and mobile projections
  -> share and brief serializers
```

### 7.2 Runner behavior

- Resolve one immutable, named reference heat-day record before either ward run.
- Load and cache ward data by immutable data-release key.
- Derive baseline and scenario layers independently for each ward.
- Reuse the `HeatSim` interface.
- Select GPU or TypeScript through one `sim-host.ts` boundary.
- Avoid two simultaneous WebGL simulation contexts.
- Run or read the ward fields sequentially through one engine host unless profiling proves
  another strategy safe.
- Retain only the scenario field needed for each 2D map plus numeric baseline statistics.
- Abort or invalidate in-flight work when scenario state changes.
- Publish only if the completion token still matches current state.
- Validate that both results share every `ReleaseEvidence` field.
- Cache by ward, normalized scenario, reference-forcing ID, model, grid, data, and backend.
- Treat the absence of a supported backend as a typed fallback or error state.

The v1 runner always computes at the canonical `SIM_N = 192`; `caps.ts` may select the
backend and the 2D display resolution, but not the analytical grid. A device that cannot
run the canonical grid receives a typed cannot-calculate state. It may show a retained
result only when the approved share architecture can verify and resolve that exact result.
The field is small enough to retain provisionally, but implementation must record actual
memory and timing before finalizing cache policy.

### 7.3 Atomic rendering

While work is pending:

- Both sides expose the same pending generation ID.
- Existing values are marked previous or replaced by skeletons.
- Share and Brief actions do not serialize a mixed state.

On success:

- One render transaction updates maps, evidence rows, delivered quantities, summary bands,
  links, and the status announcement.

On partial failure:

- The comparison is invalid.
- The successful side may be shown diagnostically, but synthesis and share actions remain
  unavailable.

---

## 8. Forcing and evidence layer

Do not force Explore and Compare through one ambiguous weather contract. They share
evidence vocabulary and versioning rules, but represent different analytical inputs.

```ts
interface ExploreForcingSnapshot {
  kind: 'ward-ambient';
  ward: WardId;
  status: 'live' | 'stale' | 'fallback';
  id: string;
  observedAt: string | null;
  fetchedAt: string;
  source: 'met-no' | 'fallback';
  values: Ambient;
  ageSeconds: number | null;
}

interface CompareReferenceForcing {
  kind: 'reference-heat-day';
  status: 'reference' | 'fallback-reference';
  id: string;
  referenceLocation: string;
  referenceDate: string;
  source: string;
  phaseValues: Record<Phase, Ambient>;
}
```

Explore requirements:

- Resolve the active ward's ambient condition as live, stale, or fallback.
- Surface request failure and staleness in the UI rather than only in the console.
- Include fallback constants in the evidence ID.
- Keep proxy migration compatible with the existing implementation plan.

Compare requirements:

- Resolve one immutable, named regional reference heat-day record before either ward run.
- Store its reference location, calendar date, source, and actual 13:00 and 22:00 values.
- Apply the same record and selected phase to both wards.
- Do not issue independent live-weather requests inside the paired run.
- Never describe an inferred `latest observation - 2.5°C` value as an observed retained
  condition.
- Treat the comparison as approval/synthetic until a defensible reference record exists.
- If a fallback reference is approved, identify it as `fallback-reference` and expose its
  exact values.

Shared evidence requirements:

- The Brief consumes the same Compare reference record as the paired result.
- A share link either encodes normalized reference values plus provenance and checksum, or
  resolves an immutable retained record ID. An unresolvable ID is not reproducible.
- Add a build-generated data manifest for ward asset versioning.
- Add explicit model and backend release constants.

Explore, Compare, and Brief use the same evidence components only where labels are
semantically valid. Shared presentation must not imply that per-ward live weather and a
controlled regional reference record are the same kind of forcing.

---

## 9. Astro component responsibilities

### Astro owns

- Landmarks, headings, route links, labels, tab and panel skeletons.
- Initial honesty, method, fallback, and error copy.
- Static source attribution.
- Route metadata and `noindex`.
- Stable IDs and static-build-readable shell structure.

### TypeScript owns

- URL normalization and history updates.
- Ward and scenario state.
- Model orchestration.
- DOM state projection.
- Canvas or SVG field rendering.
- Sheet and tab interaction.
- Focus restoration.
- Status announcements.
- Disposal and request cancellation.

### CSS owns

- Desktop versus mobile structural layout.
- Collapsed, half, and full sheet geometry.
- 200% text reflow.
- Safe-area insets.
- Focus, selected, pending, disabled, error, and fallback visual states.

CSS must not be the only owner of semantic hidden state. `hidden`, `inert`, and ARIA state
must remain synchronized by the controller.

All new selectors are scoped beneath an explicit heat-map root. Existing broad global
selectors such as `.panel`, `.map`, `.left`, `.right`, and `.ward` must not leak into the
new Compare route.

---

## 10. Paired Thermal Observatory

The controller first paints each settled `Float32Array` into the deterministic Canvas
relief, then dynamically imports the optional Three.js observatory. Canvas therefore
remains visible while geometry prepares and immediately becomes active if WebGL fails.

Required behavior:

- Fixed 26–48°C ramp from `heat-map-model.ts`.
- Equal 1.4 km extent for both sides.
- Deterministic output for the same state.
- Device-pixel-ratio cap consistent with the existing quality system.
- One shared view state for azimuth, pitch, zoom, Relief/Top mode, and motion.
- Two WebGL renderers at most, with no MapLibre instances and no duplicate GPU simulation.
- Merged building geometry, merged road linework, and one field texture per ward.
- Synchronous camera and field transitions across the two ward scenes.
- Tier 2 at a capped 60 fps; Tier 1 at a capped 30 fps with reduced geometry and no
  particles; Tier 0 uses Canvas only.
- Render only while visible, dirty, transitioning, or actively animated.
- Static output under reduced motion, with the motion control disabled.
- Context-loss and initialization-failure demotion back to Canvas.
- Text-equivalent spatial pattern summary.

Implemented layering:

1. Canvas relief paints first and owns the universal fallback.
2. `paired-map-3d.ts` is loaded by dynamic import after the paired result settles.
3. Real footprint/height geometry is merged into one building buffer per ward.
4. The canonical 192 × 192 result is uploaded as a display texture; shaders never alter
   analytical values.
5. Relief, contours, sheen, and sparse hot-cell particles are explicitly illustrative.
6. Direct pointer, wheel, and keyboard interactions mutate the one shared camera state.

---

## 11. Responsive implementation

### Breakpoint contract

```text
0–767 px    dedicated mobile Paired Ward Bench
768 px+     desktop Paired Ward Bench
```

At the breakpoint:

- Only one complete interface is exposed to assistive technology.
- State is not recalculated.
- Focus remains valid.
- No duplicate ID exists if both DOM structures are rendered.

Prefer one semantic control set projected into different layout regions. If separate
desktop and mobile controls are necessary, they must bind to one store and inactive
duplicates must be hidden and inert.

### Mobile sheet controller

State:

```ts
type MobileSheetState = 'collapsed' | 'half' | 'full';
type MobileBenchTab = 'settings' | 'evidence' | 'wards';
```

Controller responsibilities:

- Restore valid session preferences.
- Normalize half to full at 200% text.
- Set `aria-expanded`, `aria-hidden`, `inert`, and focus.
- Collapse on Escape if proposed hardening R7 is approved.
- Return focus to the summary opener.
- Toggle stage inertness whenever the sheet covers it.
- Reset active panel scroll on tab change.
- Allow short-screen full mode to scroll as one surface.

Do not lock document scrolling in the 200% collapsed reflow state.

---

## 12. Reset, undo, and state transitions

Keep one intervention-only undo checkpoint:

```text
non-zero state
  -> Reset
  -> zero state + Reset disabled + Undo available
  -> Undo
  -> exact checkpoint + Undo cleared
```

Invalidation:

```text
Reset
  -> any subsequent intervention edit
  -> checkpoint cleared + Undo hidden
```

The implementation must share the checkpoint between desktop and mobile projections.
Calling reset while already at zero is a no-op and cannot replace the checkpoint.

Unit tests cover the transition table before UI work begins.

---

## 13. URL, history, and brief implementation

### Parser

- Parse into typed values.
- Clamp numeric ranges.
- Normalize ward IDs to lowercase stable slugs.
- Guarantee distinct wards.
- Reject unknown comparison-contract versions.
- Preserve only known parameters when serializing.
- Deliberately translate or reject the prototype-only `pairTrees`, `pairRoof`,
  `pairParks`, `pairFacades`, capitalized ward names, `returnView`, and
  `prototype=synthetic` parameters.

### History

- Use `replaceState` for continuous slider settlement.
- Use `pushState` for ward changes, phase changes, mode changes, and explicit Reset.
- Handle `popstate` through the same normalized state transition.

### Share

- Serialize only a settled `PairedResult`.
- Include evidence release IDs.
- Include sufficient forcing information to reproduce the run. An ID is sufficient only
  if an immutable retained forcing record can resolve it.
- Copy the absolute canonical URL.
- Provide a non-Clipboard fallback.

### Brief

- Parse the same state contract at `/heat-map/brief/`.
- Render title, method, caveats, attribution, and invalid-state help in the static Astro
  shell.
- With JavaScript available, re-run the canonical calculation or retrieve a verifiable
  retained result using the same release and reference-forcing contract.
- Render a readable invalid-state response when reproduction is impossible.
- Use print CSS rather than client-side image capture.

In the current static deployment, arbitrary numeric scenario evidence is not available
without JavaScript. Server-rendered URL-specific results require an approved SSR/API
architecture and immutable forcing/result storage; that is not implicit in this plan.

The prototype `<dialog>` may remain a short preview affordance only if the route is still
the canonical brief.

---

## 14. Implementation stages

No stage begins until this plan and the product specification are approved.

### Stage A: contracts and tests

Files:

- `wards.ts`
- `forcing.ts`
- `evidence.ts`
- `compare/reference-forcing.ts`
- `scenario/coverage.ts`
- `scenario/scenario-state.ts`
- `scenario/scenario-url.ts`
- matching unit tests

Exit criteria:

- Every numbered decision in the product specification is recorded.
- Conversion vectors pass.
- The canonical `hm-grid-192-v1` contract rejects analytical grid drift.
- Each percentage control names a versioned stock basis; its selector and delivered
  quantity use that same inventory, or the unsupported physical quantity is absent.
- The approved park policy proves requested, applied, and reported hectares are equal.
- Compare forcing fixtures include an immutable ID, location, date, source, and actual
  peak and retained phase values.
- URL round trips pass.
- Duplicate wards cannot enter normalized state.
- Evidence status is never represented by `null`.
- Existing unit tests remain green.

### Stage B: shared engine and production services

Scope:

- Extract reusable ward metadata and asset loading from `heat-map-app.ts`.
- Extract grid-aware ward raster preparation.
- Introduce the approved stock-selection contract. If physical tree/façade quantities are
  retained, the selected road segments or façade surfaces must drive both raster
  application and delivery calculations.
- Pass the explicit `CanonicalGridSpec` through model loops, spatial preparation,
  textures, and result fields without enabling alternate analytical sizes in v1.
- Add the TypeScript simulation backend promised by the existing `HeatSim` ABI.
- Add one capability-aware simulation host around GPU and TypeScript backends; capability
  selects backend and display quality, never the analytical grid.
- Add the per-ward Explore forcing service and shared evidence vocabulary.
- Keep the current Explore DOM and visuals unchanged.
- Preserve Explore disposal and soft-navigation behavior.

Exit criteria:

- Explore visual screenshots are unchanged within tolerance.
- Explore values match before and after extraction.
- Stock-basis fixtures prove that applied and reported coverage refer to the same selected
  primitives.
- GPU and TypeScript fixtures satisfy the same model assertions within documented tolerance.
- Live, stale, and fallback Explore forcing are visibly differentiated.
- All analytical results carry `hm-grid-192-v1`, regardless of capability profile.
- No new lifecycle leaks.

### Stage C: paired runner and adaptive renderer

Scope:

- Implement coordinated baseline/scenario runs.
- Apply the approved stock-basis adapter without synthesizing corridor kilometres or
  façade square metres from unrelated totals.
- Resolve and pin the approved regional reference heat-day record.
- Implement the approved fractional park patch or normalize the UI to the approved snapped
  behavior.
- Add cancellation and result caching.
- Implement fixed-scale north-up Canvas field rendering.
- Add the dynamically imported linked Three.js observatory without a MapLibre dependency.
- Add deterministic text descriptions.

Exit criteria:

- Both wards share the exact same reference-forcing record and release contract.
- Requested, applied, and displayed park area match in every boundary fixture.
- Reference model fixtures match direct single-ward runs.
- No more than the intentional paired WebGL contexts and no MapLibre instance.
- WebGL failure preserves the complete Canvas comparison.
- Partial failure never produces a valid comparison.

### Stage D: desktop Paired Ward Bench

Scope:

- Add `/heat-map/compare/`.
- Build desktop settings, paired maps, evidence table, delivered quantities, and method.
- Add mode navigation and state handoff.
- Add Reset, Swap, and Share.
- Add a native-scroll layout option to `Base.astro` and a valid `<main id="main">`.
- Extend `astro.config.mjs` so every heat-map tool route stays out of the sitemap.
- Extend `scripts/check-publication-contract.mjs` with Compare route metadata, noindex, and
  sitemap assertions.

Exit criteria:

- Desktop approval prototype hierarchy is preserved.
- All controls are semantic and keyboard operable.
- State and share URL round trip.
- Compare does not import or mount the Explore MapLibre stack; its isolated Three.js
  renderer is loaded only after a settled result and capability check.
- Compare is noindex and absent from the generated sitemap.
- Explore has no regression.

### Stage E: mobile Paired Ward Bench

Scope:

- Add stacked maps and summary dock.
- Add collapsed, half, and full sheet.
- Add Settings, Evidence, and Wards tabs.
- Add one-level Undo and session preferences.
- Implement 200% and short-screen reflow.
- Verify the TypeScript simulation path on a coarse-pointer, low-capability profile.
- Add Escape handling only if proposed hardening R7 is approved.

Exit criteria:

- 320 × 568 and 390 × 844 flows pass.
- No horizontal overflow.
- Visible targets are at least 44 × 44 CSS pixels.
- Covered maps are inert.
- Focus entry, restoration, and tab keys pass; Escape also passes if R7 is approved.
- Low-capability results still use `hm-grid-192-v1`; only backend and map sampling differ.
- Lenis and home-page scroll effects are absent from the tool routes.

### Stage F: brief and automatic fallback

Scope:

- Add `/heat-map/brief/`.
- Project the Research Console design into automatic fallback.
- Add the static title/method/caveat shell, client result reproduction, print layout, and
  invalid-state handling.
- Extend the sitemap filter and publication checker to cover the Brief route.

Exit criteria:

- With JavaScript, Brief state reproduces from its URL and pins the same release and
  reference-forcing record.
- Without JavaScript, the title, method, caveats, attribution, and recovery guidance remain
  readable; numeric scenario evidence is not falsely presented as server-rendered.
- WebGL failure produces a useful instrument rather than an empty canvas.
- Brief is noindex and absent from the generated sitemap.

### Stage G: verification and controlled exposure

Scope:

- Run the full matrix in section 16.
- Record performance and payload observations without executing the deferred P6 strategy.
- Keep the feature under `noindex`.
- Run the publication contract against Explore, Compare, and Brief and inspect the built
  sitemap.
- Expose Compare navigation only after all release gates pass.

---

## 15. Test strategy

### Unit tests

- Coverage conversion boundaries and the approved reference vector.
- Delivered quantities by the same selected primitives used for raster application.
- Unsupported corridor-kilometre or façade-square-metre projections remain absent when
  modelled cell/intensity bases are selected.
- Requested, normalized, applied, and reported park area, including fractional and maximum
  boundaries.
- Canonical analytical-grid acceptance and non-192 rejection.
- URL parse, clamp, serialize, and round trip.
- Prototype-format URL translation or explicit rejection.
- Duplicate-ward correction.
- Reset and one-level Undo transition table.
- Explore forcing live, stale, and fallback state.
- Compare reference-forcing identity, phase values, and fallback-reference state.
- Evidence-contract equality.
- Paired-run cancellation and stale-completion rejection.
- Atomic publish after two successful results.
- Partial-failure invalidation.
- Cost range provenance or point-estimate fallback.

### Model regression tests

- A paired ward result equals the same ward run directly with identical inputs.
- The same scenario produces the same analytical result across device capability profiles.
- Tree and façade applied coverage agrees with the selected stock basis and its reported
  quantity.
- Zero interventions produce scenario equal to baseline within numeric tolerance.
- Increasing each intervention remains monotonic for model fixtures.
- Fractional park application preserves the requested area and does not add a whole site,
  if that R10 option is approved.
- Hot-area change equals scenario percentage minus baseline percentage.
- Output precision is applied only in presentation, not model state.

### End-to-end tests

- Explore to Compare state handoff.
- Compare to Explore return handoff.
- Ward selection, duplicate prevention, and Swap.
- Shared slider synchronization at desktop and mobile widths.
- Reset, disabled second reset, Undo restore, and edit invalidation.
- Phase switch updates both sides and removes stale peak-only labels.
- Retained phase exposes typed Not evaluated states where threshold metrics are unavailable.
- Share URL copied and reopened into the same state.
- Both columns identify the same named Compare reference heat-day and selected phase.
- Brief URL reproduces the settled state with JavaScript.
- Brief without JavaScript exposes the static method/caveat shell, not fabricated numbers.
- Explore live-forcing failure exposes fallback state.
- Explore retains per-ward forcing when navigating independently.
- One-ward failure disables synthesis and sharing.
- WebGL failure activates fallback content.
- Back and Forward restore state.
- Explore, Compare, and Brief are noindex and absent from the built sitemap.
- No page or console errors across repeated Astro soft navigation.

### Accessibility tests

- Axe tags: `wcag2a`, `wcag2aa`, `wcag22aa`.
- Keyboard-only complete scenario flow.
- Tab roving focus in horizontal and vertical layouts.
- Sheet focus entry and restoration; Escape when R7 is approved.
- `inert` and `aria-hidden` synchronization.
- Status-announcement cadence after settlement.
- Reduced-motion settled result.
- 200% text and 320-pixel reflow.
- Forced-colours visibility.
- Contrast checks for text, focus, selected, pending, and disabled states.

### Visual viewport matrix

| Viewport | Required states |
|---|---|
| 320 × 568 | Collapsed and full at normal and 200% text |
| 390 × 844 | Collapsed, half, full, all three tabs |
| 767 wide | Mobile boundary |
| 768 wide | Desktop boundary |
| 1024 × 768 | Compact desktop |
| 1440 × 900 | Full desktop |

The prototype's `?text=200` switch is not a production feature. Tests must enlarge text
through browser or injected accessibility conditions without adding analytical URL state.

---

## 16. Verification commands and gates

Expected repository checks:

```text
npm run check
npm run test:unit
npm run build
npm run test:e2e:built
```

Additional release gates:

- No duplicate IDs or broken ARIA references.
- No unexpected page-level horizontal overflow.
- Zero unhandled browser errors.
- Stable GL context and animation-frame counts across three route round trips.
- Compare creates exactly the paired render contexts on capable devices and disposes both
  on route teardown.
- Compare is complete when the GPU backend is unavailable.
- Both result columns carry the same evidence generation ID.
- Both result columns carry the same named reference-forcing ID and canonical grid version.
- Chromium and WebKit produce identical paired metrics and delivered quantities for the
  same versioned URL.
- Device capability cannot change the analytical result.
- Control labels, model selectors, and delivered quantities match the same supported stock
  denominators.
- Requested, applied, and reported park area match.
- Existing build and expanded publication checks remain green.
- Explore, Compare, and Brief are absent from the built sitemap while noindex is active.
- Existing large-chunk work remains recorded as deferred P6, not silently mixed into this
  feature.

---

## 17. Risk register

| Risk | Failure mode | Mitigation |
|---|---|---|
| Unit mismatch | Same slider label drives different physical meaning | One pure coverage adapter with fixtures |
| Stock-basis mismatch | Model selects cells but UI reports a proportional source length or area | One versioned selector drives raster application and reporting, or omit the physical quantity |
| Grid-dependent physics | A low-capability tier silently changes the model result | Canonical 192 × 192 analytical grid; tier only backend and display |
| Eligibility overclaim | Mapped assets are presented as programme-eligible stock | Honest mapped/model labels or versioned masks and predicates |
| Discrete park model | A 0.1% request applies an extra whole 0.785 ha site | Fractional final patch, or normalize and disclose a snapped value |
| Stale cross-ward state | Old value appears beside a fresh result | Atomic paired result and generation tokens |
| GPU pressure | Paired scenes exhaust contexts or degrade scrolling | Two-context ceiling, merged geometry, capped DPR/FPS, visibility pause, tiered density, and immediate Canvas demotion |
| Forcing drift | Wards use different observations or derived times look observed | Pin one named reference heat-day with actual phase values |
| False precision | Screening output looks engineering-grade | One-decimal temperatures, evidence labels, cited cost contract |
| CSS duplication | Desktop and mobile controls diverge | One store, shared components, synchronized projections |
| Bottom-sheet accessibility | Covered content remains focusable | `inert`, ARIA synchronization, focus tests |
| URL drift | Shared link no longer reproduces a result | Versioned contract and immutable release identifiers |
| Forcing ID without storage | Link identifies a snapshot that can no longer be resolved | Encode the snapshot or retain an immutable server record |
| Static Brief overpromise | No-JS users appear to receive reproduced numeric results | Static method shell plus explicit client calculation boundary |
| Publication leak | New noindex routes enter the sitemap | Prefix-aware sitemap exclusion and route-level publication tests |
| Cost-range invention | Prototype range appears authoritative | Cited lower/upper model or point estimate only |
| Big-bang refactor | Explore regresses while Compare is added | Stage B extraction with screenshot and model parity tests |
| Prototype leakage | Schematic maps or heuristic formulas ship | Explicit ban plus model parity tests |

---

## 18. Rollout and rollback

### Rollout

1. Land pure contracts and tests.
2. Land shared services with no Explore visual change.
3. Land Compare route without navigation exposure.
4. Complete desktop and mobile QA.
5. Add the Explore/Compare navigation.
6. Keep all routes `noindex`.
7. Revisit publication only through the existing measured-raster gate.

### Rollback

Because Compare is a separate route:

- Remove or hide the Compare navigation link.
- Leave `/heat-map/` and its current controller untouched.
- Preserve shared pure modules that Explore already uses.
- Keep old comparison URLs on a readable unavailable page rather than returning an
  unexplained 404.

---

## 19. Documentation updates after approval

Before implementation begins:

1. Record every numbered review decision from the product specification.
2. Fold accepted behavior into `heat-map-page-spec.md`.
3. Reconcile this staged plan with `heat-map-implementation.md`.
4. Update `heat-map-feature.md` so the side-by-side comparison decision is no longer open.
5. Add a design-system document if the heat-map tokens are intended for wider reuse.

Only documentation changes are in scope for the current review pass.
