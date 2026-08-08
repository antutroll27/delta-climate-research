# Heat-map correctness and runtime resilience — design specification

**Date:** 2026-08-07

**Status:** proposed; implementation intentionally not started pending review

**Scope:** the first three items from the 2026-08-07 climate-engine audit

**Surfaces:** `/heat-map/` Explore and `/heat-map/compare/` Compare

## 1. Executive decision

This tranche fixes three related trust failures without changing the calibrated heat
field, intervention model, canonical grid, or visual language:

1. Correct and centralise the synthetic all-green reference calculation.
2. Make Explore select an executable simulation backend and use `TsHeatSim` in a
   worker whenever the WebGL2 float solver is unavailable.
3. Make ward changes abortable, generation-safe, and transactional so an older
   request can never overwrite a newer selection.

The unifying rule is simple: **a displayed result must identify the calculation that
produced it and the current user request that owns it**. The first task establishes
one metric identity; the second establishes one backend identity; the third
establishes one request identity.

No Python, Go, WASM, model recalibration, visual redesign, or Compare performance work
belongs in this tranche.

## 2. Why these three belong together

The current application has three different ways to show a result that is plausible
but not the result the interface claims:

- Explore and Compare duplicate an all-green reference formula. Both omit the
  nocturnal `store` term, and Compare calls the synthetic value “Rural contrast”.
- `caps.ts` promises a TypeScript floor, but Explore constructs only `GpuHeatSim`.
  On a browser without `EXT_color_buffer_float`, the map can render while the
  analytical readouts remain `—`.
- `loadWard(name)` mutates shared state through a long chain of awaits. A slow older
  ward request can finish after a newer one and become the visible ward.

These are provenance failures rather than cosmetic defects. A result needs three
answers: *what metric is this, which engine ran it, and which request does it belong
to?* This design makes all three explicit.

## 3. Current evidence and affected code

| Finding | Current location | Consequence |
|---|---|---|
| Explore hand-writes the green-reference formula | `heat-map-app.ts`, `refreshStats()` | Night reference omits `SimParams.store` |
| Compare repeats the same formula | `compare/paired-runner.ts`, `ruralContrast()` | The same numerical defect has a second implementation |
| Compare labels the value “Rural contrast” | `PairedBench.astro` | A synthetic all-green cell can be mistaken for measured rural evidence |
| The actual equilibrium helper already includes storage | `types.ts`, `equilibriumC()` | The correct primitive exists but is bypassed |
| Capability policy selects `ts` on most devices | `caps.ts`, `resolveHeatCaps()` | Policy and runtime disagree |
| Explore only constructs `GpuHeatSim` | `heat-map-app.ts` | Unsupported float targets produce blank analytical values |
| `webgpu || floatRenderTargets` selects `gpu` | `caps.ts` | WebGPU can select a backend that does not exist; `GpuHeatSim` is WebGL2-only |
| Ward loads carry neither `AbortSignal` nor generation | `heat-map-app.ts`, `loadWard()` | Last response wins instead of last request |
| `style.load` calls `loadWard('ballygunge')` | `heat-map-app.ts` | A style change can reset geography and trigger duplicate work |
| `dispose()` cannot stop in-flight ward work | `heat-map-app.ts` | Late callbacks can mutate a torn-down view |

The night defect is material. For a reference cell it adds exactly
`store / (kRad + h × wind)` to the correct reference temperature when omitted. Under
the shipped retained-phase reference forcing that is approximately **3.51 °C**; under
the default Explore wind it is approximately **1.75 °C**. The heat field itself is
not wrong because both solvers already include `store`; the derived contrast is.

## 4. Goals

### 4.1 Scientific correctness

- One exported function defines the all-green reference and its contrast.
- Peak results remain numerically unchanged because peak `store` is zero.
- Retained/night results include `store` through `equilibriumC()`.
- The application never calls this value observed rural temperature, rural UHI, or
  rural contrast.
- The synthetic metric remains distinct from the observed `ruralBaseC` used by
  DC-URS.

### 4.2 Runtime continuity

- Every supported browser gets an analytical result on the canonical 192×192 grid.
- A capable WebGL2 float path may accelerate the calculation; it does not define the
  scientific result.
- A missing extension, GPU initialisation error, or GPU context loss demotes to a
  worker-hosted `TsHeatSim` instead of leaving readouts blank.
- Reduced-motion sessions receive one settled TypeScript result and no continuous
  simulation animation.
- The visible interface names the active execution backend honestly.

### 4.3 Request correctness

- The last valid ward request wins regardless of response order.
- Superseded requests are aborted and stale completions are ignored even if abort is
  too late to stop a synchronous preparation step.
- The currently committed ward remains usable while a replacement is loading.
- A ward commits atomically: geometry, surface, labels, simulation, provenance, and
  visible ward name change together.
- Style changes rebuild style-bound render layers only. They never change or reload
  the selected ward.
- Disposal invalidates all pending work before releasing render resources.

## 5. Non-goals

- Refit or recalibrate `heat-model-v1`.
- Change `STORE_NIGHT`, forcing records, intervention constants, DC-URS, accuracy
  bands, rasterisation, or the 192×192 analytical grid.
- Rename or reinterpret DC-URS's observed rural baseline.
- Port Compare's synchronous solver to a worker. That remains the next performance
  tranche and can reuse the protocol introduced here.
- Add a WebGPU solver. WebGPU remains diagnostic until a real implementation exists.
- Add Go, WASM, Python services, server APIs, or network telemetry.
- Redesign the map, the Field Instrument, the Research Console, or mobile layout.
- Build the full mapless/static heat-map visualisation. If WebGL itself is missing,
  this tranche must show an explicit degraded state rather than an empty instrument;
  the complete static equivalent remains governed by the adaptive-views design.

## 6. Decision 1 — one metric with one honest name

### 6.1 Canonical definition

The metric is the modelled ward mean minus a synthetic, fully vegetated reference
cell under identical forcing:

```text
Tgreen(p) = equilibriumC(p, albedo = 0.25, vegetation = 1, built = 0)

Δgreen(mean, p) = mean − Tgreen(p)
```

`equilibriumC()` is the canonical equation and already includes solar gain,
evapotranspiration, radiative and convective exchange, anthropogenic heat, and
nocturnal storage. No caller may re-expand that equation.

The reference is illustrative and synthetic. It is not a sampled rural site, an
urban–rural pair, an air-temperature UHI, or the observed DC-URS `ruralBaseC`.

### 6.2 API

The equation-level helper belongs beside `equilibriumC()` in `types.ts`:

```ts
export const ALL_GREEN_REFERENCE = {
  albedo: 0.25,
  vegetation: 1,
  built: 0,
} as const;

export function allGreenReferenceC(params: SimParams): number;

export function greenReferenceContrastC(
  meanC: number,
  params: SimParams,
): number;
```

Both functions are pure. `greenReferenceContrastC()` must call
`allGreenReferenceC()`, which must call `equilibriumC()`. Explore and Compare must
import the helper; neither may contain a local equivalent.

### 6.3 Public terminology

Every visible occurrence uses:

> **Δ vs all-green ref**

The explanatory text uses:

> Modelled ward-mean surface temperature minus a fully vegetated reference cell
> under identical forcing. This is not a measured urban–rural heat-island value.

Internal names change accordingly:

| Existing | Replacement |
|---|---|
| `ruralContrast()` | deleted |
| `ruralContrastC` | `greenReferenceContrastC` |
| `a-rural`, `b-rural` | `a-green-reference`, `b-green-reference` |
| “Rural contrast” | “Δ vs all-green ref” |

The `uhi` DOM id in Explore may be renamed to `greenContrast` if all CSS/tests are
updated in the same commit. It must never appear in explanatory copy as a measured
UHI.

### 6.4 Versioning and reproducibility

The scenario input contract remains `paired-coverage-v1`: its wards, forcing,
coverage, and grid have not changed. The model remains `heat-model-v1`: the simulated
field has not changed.

The derived evidence contract does change. Add:

```ts
export const HEAT_METRICS_VERSION = 'heat-metrics-v2' as const;
```

`ReleaseEvidence` records `metricsVersion: 'heat-metrics-v2'`, and Compare's
integrity block/brief exposes it. This separates an input schema version from a
derived-metric correction. Old shared URLs remain valid and recompute with the
correct current metric; no old result value is embedded in those URLs.

### 6.5 Numerical invariants

- With `store = 0`, the helper equals the legacy formula within floating-point
  tolerance.
- With `store > 0`, the correct reference exceeds the legacy reference by exactly
  `store / (kRad + h × wind)`.
- No baseline mean, scenario mean, cooling, heat field, hot-area metric, cost, or
  DC-URS value changes because of this task.
- The Explore and Compare value must agree when given the same mean and parameters.

## 7. Decision 2 — capability-driven simulation host

### 7.1 Backend policy

Capability changes execution and display fidelity, never the grid or equations.

| Condition | Simulation backend | Motion | Default map mode |
|---|---|---|---|
| Tier 2 + WebGL2 float render targets | `gpu-webgl2` | live | relief |
| Any tier without executable float solver | `ts-worker` | live | tier policy |
| Reduced motion | `ts-worker` | one settled snapshot | tier policy |
| Worker construction/runtime failure | `ts-main` emergency path | one settled snapshot | tier policy |
| GPU initialisation/context failure | demote once to `ts-worker` | live/static per preference | unchanged |
| MapLibre/WebGL unavailable | TS calculation may complete; show explicit analytical degraded state | none | none |

Until a WebGPU solver exists, `navigator.gpu` must **not** select `GpuHeatSim`.
`resolveHeatCaps()` may keep probing WebGPU for diagnostics, but the current GPU
selection predicate is `floatRenderTargets`, not
`webgpu || floatRenderTargets`.

The emergency main-thread TypeScript path is not an animation backend. It runs one
settled calculation through scheduled chunks/yields so a blocked worker cannot turn
into an inert instrument or a permanent main-thread loop.

### 7.2 Host contract

The synchronous `HeatSim` ABI remains the solver contract. Explore consumes a new
asynchronous host contract:

```ts
export type ExploreBackend = 'gpu-webgl2' | 'ts-worker' | 'ts-main';

export interface HeatSimRequest {
  generation: number;
  grid: GridSpec;
  layers: SimLayers;
  params: SimParams;
  settleSteps: number;
  thresholdC: number;
}

export interface HeatSimSnapshot {
  generation: number;
  backend: ExploreBackend;
  field: Float32Array;
  stats: SimStats;
  gridVersion: typeof CANONICAL_GRID_VERSION;
}

export interface HeatSimHost {
  readonly backend: ExploreBackend;
  reset(request: HeatSimRequest): Promise<HeatSimSnapshot>;
  advance(generation: number, steps: number): Promise<HeatSimSnapshot | null>;
  dispose(): void;
}
```

The host normalises GPU and CPU timing behind promises. Callers never branch on
solver methods. They branch only on declared capabilities and received snapshots.

### 7.3 Worker protocol

`sim-worker.ts` owns exactly one `TsHeatSim`. Messages use a discriminated union:

```text
main -> worker: reset { requestId, generation, grid, layers, params, settleSteps }
main -> worker: advance { requestId, generation, steps, thresholdC }
main -> worker: dispose

worker -> main: snapshot { requestId, generation, field, stats, backend }
worker -> main: failure { requestId, generation, message }
```

Rules:

- `requestId` resolves one promise; `generation` establishes ownership of the result.
- Reset invalidates queued advances from older generations.
- At most one advance is in flight. Additional animation ticks coalesce instead of
  building an unbounded message queue.
- The worker never probes capabilities and never fetches data.
- Input layers are copied before transfer so the app's committed `state.base` and
  intervention data are never detached.
- The returned field may be transferred because the worker can retain its internal
  field and send a copy at the existing sparse bridge cadence.
- `dispose()` rejects outstanding promises, removes listeners, and terminates the
  worker idempotently.
- Error messages exposed to users are typed and generic; stack traces stay in the
  console during development only.

### 7.4 GPU host and demotion

The GPU host wraps the existing `GpuHeatSim` and its offscreen renderer. It uses the
same request/snapshot shapes as the worker host.

If construction, reset, readback, or context health fails:

1. Mark the GPU host failed and dispose it.
2. Create `ts-worker` once.
3. Replay the latest committed request with the same generation, layers, parameters,
   grid, and settle steps.
4. Accept the fallback result only if that generation is still current.
5. Update the visible backend label.

There is no automatic promotion back to GPU during the same page lifetime. Repeated
promotion/demotion is harder to reason about and risks oscillation.

### 7.5 UI states

The hard-coded `GPU SIM` label becomes a live, non-boastful backend state:

| State | Compact label | Accessible detail |
|---|---|---|
| detection | `SELECTING ENGINE` | Selecting a compatible simulation engine |
| GPU | `GPU SIM` | Canonical 192-cell model running on WebGL2 float targets |
| worker | `CPU SIM` | Same canonical model running in a background worker |
| main-thread emergency | `CPU STATIC` | Same model calculated once without live stepping |
| unavailable renderer | `ANALYTICAL MODE` | Map rendering is unavailable; calculated evidence remains labelled |

Backend changes are announced once through an existing or new `role="status"`
region with `aria-live="polite"`; animation ticks and routine resets are not
announced.

No state may leave temperature, contrast, resilience, and hot-area values permanently
as `—` without an adjacent explanation and retry/reload path.

### 7.6 Parity contract

For identical inputs after `RESET_BURST`:

- mean temperature difference: at most `0.02 °C`;
- peak temperature difference: at most `0.05 °C`;
- field root-mean-square difference: at most `0.03 °C`;
- hot-area classification difference: at most `0.1 percentage points`.

These are acceptance ceilings, not calibration targets. If browser evidence shows
that the current solvers cannot meet them, implementation stops for a solver audit;
the thresholds are not silently widened.

### 7.7 Performance contract

- The CPU solver does not execute `RESET_BURST` on the UI thread during the normal
  fallback path.
- Slider feedback, ward selection, and map controls remain visually responsive while
  a worker result is pending.
- Only one simulation request per generation may own a commit.
- Continuous worker stepping uses the existing sparse visual refresh cadence, not a
  request per animation frame.
- Tier and reduced-motion policy remain authoritative for animation and map mode.

## 8. Decision 3 — generation-safe ward coordinator

### 8.1 State model

Ward loading becomes an explicit session owned by Explore:

```ts
type WardLoadState = 'idle' | 'loading' | 'ready' | 'error' | 'disposed';

interface WardSessionState {
  lifecycle: 'mounted' | 'disposing' | 'disposed';
  generation: number;
  requestedWard: WardId | null;
  committedWard: WardId | null;
  loadState: WardLoadState;
  controller: AbortController | null;
}
```

“Last request wins” is defined by generation, not timing. Each valid, non-duplicate
ward request increments `generation`. Every asynchronous result, prepared render
object, and simulation snapshot carries that value.

### 8.2 Request algorithm

```text
requestWard(next)
  validate WardId
  no-op if next is already committed and nothing is pending
  no-op if next is already the pending request
  abort previous controller
  generation += 1
  create controller
  mark next pending; keep committed ward visible
  bundle = await loadExploreWardBundle(next, signal)
  assertCurrent(generation, signal)
  prepared = await prepareWard(bundle, generation)
  assertCurrent(generation, signal)
  snapshot = await simHost.reset(current scenario + prepared base, generation)
  assertCurrent(generation, signal)
  commitWard(prepared, snapshot) atomically
```

`AbortController` saves work. Generation checks guarantee correctness. Both are
required because abort cannot pre-empt synchronous geometry construction or a result
already queued to the main thread.

### 8.3 Data bundle

Ward data is loaded independently from map/style mutation:

```ts
interface ExploreWardBundle {
  wardId: WardId;
  ward: WardData;                 // required
  surface: WardSurface;           // required
  terrain: TerrainField | null;   // optional, disclosed fallback
  water: WaterData;               // optional, empty fallback
  roads: RoadsData;               // optional, empty fallback
  labels: GeoJSON.FeatureCollection; // optional, empty fallback
  provenance: ProvenanceData | null; // optional, unavailable fallback
  fallbacks: WardFallback[];
}
```

Required failures retain the current committed ward and show an actionable inline
error. Optional failures use typed fallbacks and record them for the provenance UI.

Every fetch receives the ward request's `AbortSignal`. A helper equivalent to
`fallbackUnlessAborted()` must rethrow `AbortError`; `.catch(() => fallback)` must
never turn cancellation into successful empty data.

Only successful, immutable parsed data may enter cache. Aborted/rejected promises and
Three.js render objects are never cached. Application-wide DC-URS and heatwave data
load under the app lifecycle rather than an individual ward request and do not gate a
ward commit.

### 8.4 Prepare, commit, rollback

Preparation may construct raster layers, spatial indexes, merged building geometry,
water/road layers, cooling masks, and the model transform, but it writes no global
state and no DOM.

`PreparedWard` owns a `dispose()` method. If its generation becomes stale or any
later stage fails, it disposes every provisional Three.js geometry/material/texture
it created.

Commit is synchronous and ordered:

1. Verify generation and lifecycle one final time.
2. Dispose the old ward-specific render resources.
3. Assign the complete new analytical/render state.
4. Attach geometry, water, roads, surface, and labels.
5. Bridge the accepted simulation snapshot and update evidence/statistics.
6. Update ward name, zone, coordinate, building count, provenance, tabs, and Compare
   link.
7. Move the camera and start the permitted grow/orbit choreography.
8. Mark the ward ready and clear pending UI.
9. Start optional live-weather refresh for the committed ward under the same
   generation guard.

No await is permitted inside commit. If preparation fails, the old committed ward
stays intact.

### 8.5 Interaction semantics

- The active tab continues to represent the committed ward.
- The requested tab receives `data-pending="true"` and an accessible loading label.
- Ward tabs remain available, so the user can supersede a slow request.
- Intervention/phase/pathway controls remain usable. The pending ward is simulated
  from the latest control state at commit time, not a stale snapshot captured at the
  initial click.
- Loading copy is concise: “Loading Baruipur…” followed by “Baruipur ready”. Asset
  micro-stages are not announced to assistive technology.
- Required failure copy names both states: “Baruipur could not load. Ballygunge
  remains active.” A retry targets the failed requested ward.
- A stale or aborted request is silent; it is expected control flow, not an error.

### 8.6 Style lifecycle

There is one named `onStyleLoad` handler. Its responsibilities are render-only:

- add the custom Three.js layer if absent;
- restore the road-label source/layer if absent;
- restore the committed ward's cached label data;
- hide replaced basemap road geometry and labels;
- trigger repaint.

It must never call `requestWard()` or `loadWard()`.

`setEnv()` updates environment state and calls `map.setStyle()` only. It does not
register a second `style.load` callback and does not add `customLayer` directly.
Layer/source existence checks make repeated style events idempotent.

Initial ward loading is triggered once by boot readiness, separately from style
rehydration.

### 8.7 Disposal lifecycle

Disposal order is part of the contract:

1. Set lifecycle to `disposing`.
2. Increment generation and abort the active ward controller.
3. Dispose the simulation host, rejecting pending snapshots.
4. Remove named map, DOM, visibility, and pointer listeners.
5. Dispose provisional and committed render resources.
6. Remove the map.
7. Set lifecycle to `disposed`.

Every callback checks lifecycle/generation before touching DOM, MapLibre, Three.js,
or state. Calling `dispose()` twice is safe.

## 9. Combined architecture

```text
                          pure scientific contract
                 +-----------------------------------+
                 | greenReferenceContrastC(mean, p) |
                 +----------------+------------------+
                                  |
                         Explore and Compare

ward tab / initial boot
          |
          v
+----------------------+    AbortSignal    +---------------------------+
| Explore coordinator  |------------------>| Explore ward repository   |
| generation owner     |<------------------| immutable parsed bundle   |
+----------+-----------+                   +---------------------------+
           |
           | prepare locally; generation attached
           v
+----------------------+      same generation      +-------------------+
| PreparedWard         |-------------------------->| HeatSimHost       |
| disposable, no DOM   |                           | GPU or TS worker  |
+----------+-----------+<--------------------------+-------------------+
           |                       snapshot
           | assert current
           v
+----------------------+
| atomic commit        |
| renderer + evidence  |
+----------------------+
```

The generation travels from the user request through data, preparation, and
simulation. The only place shared application state changes is the final synchronous
commit.

## 10. Error and fallback matrix

| Failure | Behaviour | User-visible state | Current ward |
|---|---|---|---|
| Superseded ward fetch | abort + ignore | new request remains loading | unchanged |
| Required ward/surface fetch fails | rollback | named error + retry | retained |
| Optional terrain fails | flat terrain | provenance says terrain unavailable | new ward may commit |
| Optional road/water/label fails | typed empty layer | provenance discloses fallback | new ward may commit |
| Geometry preparation fails | dispose provisional objects | named error + retry | retained |
| GPU capability absent | choose worker | `CPU SIM` | unaffected |
| GPU runtime fails | one-way demotion and replay | brief backend update | unaffected |
| Worker fails | one settled main-thread run | `CPU STATIC` | unaffected |
| Stale simulation snapshot | discard | none | unaffected |
| Style reload | idempotent layer rehydrate | none | retained |
| Navigate away during load | abort + dispose | none | page disposed |
| WebGL/MapLibre unavailable | do not imply working map | explicit analytical degraded state | data may still be calculated |

## 11. Accessibility requirements

- WCAG 2.2 AA remains the baseline.
- Pending and active ward states are not communicated by colour alone.
- Loading/status uses `role="status"` and `aria-live="polite"`; errors use an
  appropriate persistent alert/status treatment without stealing focus.
- Ward buttons keep accessible names and expose busy/pending state.
- Reduced motion performs no orbit, grow, or continuous thermal animation.
- Backend identity and fallback explanations are text, not icon-only indicators.
- The instrument never traps keyboard focus while loading or during fallback.
- Existing 3D/canvas descriptive text remains available when the renderer is
  degraded.

## 12. Security and privacy

- The worker is a local Vite module worker with no `eval`, blob-loaded remote code,
  or network capability.
- Errors presented in the UI contain no URL query values, stack traces, device/GPU
  labels, or raw exception text.
- Capability/GPU labels remain local diagnostics and are never transmitted.
- This tranche adds no cookies, identifiers, analytics events, API routes, or
  third-party requests.
- Ward IDs are validated against `isWardId()` before being used to construct asset
  paths.

## 13. Verification strategy

### 13.1 Pure/unit tests

- All-green helper peak and retained-phase identities.
- Legacy omission delta equals `store / (kRad + h × wind)`.
- Compare result exposes `greenReferenceContrastC` and `heat-metrics-v2`.
- No source-level duplicate of the legacy expanded reference equation remains.
- Capability resolver never selects the current GPU backend from WebGPU alone.
- Capability resolver preserves grid 192 in every tier.
- Worker protocol resolves matching request IDs and rejects/ignores stale generations.
- Request coordinator obeys last-request-wins, duplicate no-op, abort, retry, and
  dispose invariants.
- Optional fallbacks rethrow `AbortError`.

### 13.2 Browser tests

- Remove/deny `EXT_color_buffer_float`: Explore identifies `CPU SIM` and renders
  non-placeholder analytical values.
- Simulate GPU constructor failure: one-way demotion produces the same scenario.
- Force worker construction failure: `CPU STATIC` produces one settled result and
  the page remains responsive.
- Emulate reduced motion: worker settles once; no repeated advances/orbit occur.
- Delay ward A, select B, then release A: B remains committed.
- Rapid A → B → A: final A wins and no stale labels/geometry appear.
- Fail a required B asset: A remains visible and retry succeeds.
- Abort while optional assets are pending: no empty bundle commits from swallowed
  cancellation.
- Toggle dark/studio styles repeatedly: selected ward stays selected and there is
  exactly one custom layer and one label source/layer.
- Navigate away mid-load: no uncaught exceptions or post-disposal mutations.
- Axe scan the pending, ready, error, CPU fallback, and reduced-motion states.

### 13.3 Numerical/browser parity

Run the same fixed ward, forcing, phase, and interventions through GPU and worker
hosts, then enforce the tolerances in section 7.6. Compare the raw field before
presentation blur so the test measures solver parity rather than rendering.

### 13.4 Repository gates

```bash
npm run check
npm run test:unit
npm run build
npm run test:e2e:built
npm run report:build
npm run check:publication
```

## 14. Rollout and stop conditions

Implementation should land as reviewable commits in the order in the companion plan.
The tasks are not released independently until the combined browser suite passes,
because the backend and ward-generation contracts share result ownership.

Stop and investigate instead of widening assertions if any of these occur:

- any simulated field, mean, cooling, cost, DC-URS score, or accuracy band changes as
  a side effect of the metric rename;
- GPU/CPU parity exceeds the fixed ceilings;
- a non-current generation changes any visible ward, label, statistic, URL, or map
  resource;
- a style toggle initiates a data fetch or changes the ward;
- a fallback reduces the canonical grid;
- the worker creates an unbounded queue or main-thread long-task regression;
- build output gains a remote worker or unexpected third-party request.

## 15. Acceptance criteria

The tranche is complete only when all of the following are true:

- Explore and Compare import the same correct all-green reference helper.
- No user-facing “Rural contrast” label remains for this synthetic metric.
- Retained/night calculations include storage and carry `heat-metrics-v2` evidence.
- Peak fields and all non-reference metrics remain unchanged.
- `detectHeatCaps()` governs Explore and cannot select an unimplemented WebGPU path.
- Unsupported WebGL2 float targets produce a worker-hosted canonical result, not `—`.
- GPU runtime failure demotes once and safely replays the current generation.
- Reduced-motion and worker-failure fallbacks are explicit and usable.
- Rapid ward selection is deterministically last-request-wins.
- Failed or aborted preparations cannot partly mutate the visible ward.
- Environment/style changes preserve the committed ward without a data reload.
- Navigation/disposal aborts pending work and produces no late mutation.
- Unit, browser, accessibility, build, performance, and publication gates pass.

## 16. Documentation consequences

Implementation must update existing heat-map methodology and adaptive-view documents
that use “rural contrast”, describe the TypeScript backend as merely future work, or
imply WebGPU currently executes the solver. This specification supersedes those
statements but does not silently rewrite the scientific calibration history.

The companion execution document is:
[`../plans/2026-08-07-heat-map-correctness-resilience.md`](../plans/2026-08-07-heat-map-correctness-resilience.md).
