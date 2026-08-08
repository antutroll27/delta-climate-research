# Heat-map performance tranche — design specification

**Date:** 2026-08-07

**Status:** implemented locally on 2026-08-08; retained as the governing contract

**Scope:** the first three remaining items from the 2026-08-07 climate-engine audit

**Surfaces:** `/heat-map/` Explore, `/heat-map/compare/` Compare, and
`/heat-map/brief/` Brief

**Depends on:**
[`2026-08-07-heat-map-correctness-resilience-design.md`](./2026-08-07-heat-map-correctness-resilience-design.md)

**Implementation plan:**
[`../plans/2026-08-07-heat-map-performance-tranche.md`](../plans/2026-08-07-heat-map-performance-tranche.md)

## 1. Executive decision

This tranche makes the urban-heat instrument responsive under real interaction and
honest about the work it performs, without changing the canonical model, calibrated
inputs, evidence contract, or visual language:

1. Move Compare's paired TypeScript calculation into a cancellable, job-oriented
   worker host shared by Compare and Brief.
2. Give Explore one explicit runtime budget that stops unnecessary simulation and
   animation work while the stage is hidden, offscreen, or being manipulated.
3. Turn the heat-map JavaScript into a progressive route graph: a small Astro boot
   shell, a MapLibre/data core, a worker calculation path, and an optional Three.js
   relief enhancement.

The unifying rule is:

> **The main thread serves the decision-maker first. Model work, ambient motion,
> and enhanced rendering may consume only the time and code that the current view
> can use.**

These are performance changes, not scientific shortcuts. Every evaluated result
continues to use `heat-model-v1`, `heat-metrics-v2`, the canonical 192×192 grid, the
same forcing records, the same intervention equations, and the same evidence
checks.

## Implementation note — 2026-08-08

The paired-worker, Explore runtime-budget, raw WebGL2 solver, and route-bootstrap
boundaries described here are now implemented. The complete later split of the
lazy Explore module into separate MapLibre-core and optional relief modules is
follow-up work; route startup already defers that module, so no heat-map engine
code enters the initial shell.

Tasks 4 and 5 from the remaining audit list are deliberately deferred. This document
does not design the full no-WebGL analytical fallback or the production parity and
resilience CI programme.

## 2. Why these three belong together

The current bottlenecks are connected by module ownership:

- Compare imports its runner into the route entry and performs two simulations per
  ward—baseline and scenario—for both wards on the main thread. A paired update is
  therefore four canonical 600-step solves plus rasterisation and metric assembly.
- `AbortController` protects Compare from committing a stale result, but it cannot
  interrupt the synchronous work already occupying the main thread. A newer slider
  state waits behind the obsolete calculation.
- Explore owns independent perpetual animation loops for orbit, drag/inertia, and
  simulation polling. Its custom Three.js layer can also request continuous MapLibre
  repaints for cloud drift.
- The Explore route statically imports MapLibre, the Three.js namespace, its
  simulation hosts, and all relief layers from one application module. The browser
  must parse most of the complete instrument before it can present the first usable
  state.

Moving only the solver would leave wasted animation and startup work. Pausing only
the loops would leave Compare's long tasks. Splitting only bundles would distribute
the same unbudgeted work across more files. The correct boundary is a small main
thread that coordinates independently budgeted calculation and rendering hosts.

## 3. Current evidence and baseline

### 3.1 Runtime evidence

| Finding | Current location | Consequence |
|---|---|---|
| Compare calls `TsHeatSim.step(1, RESET_BURST)` synchronously | `compare/paired-runner.ts`, `runField()` | Each field solve blocks the main thread |
| Compare solves baseline and scenario for ward A, then ward B | `compare/paired-runner.ts`, `runWard()` and `runPairedScenario()` | One update performs four 192×192 × 600-step solves sequentially |
| Abort is checked only between large synchronous phases | `compare/paired-runner.ts`, `assertNotAborted()` | Superseded work cannot stop promptly |
| The controller yields one frame before starting the calculation | `compare/paired-controller.ts`, `run()` | Pending paint appears, then interaction can freeze |
| Coverage input is debounced by 160 ms | `compare/paired-controller.ts`, `scheduleRun()` | Debouncing reduces starts but does not cancel active CPU work |
| Explore schedules orbit, drag, and simulation frames continuously | `heat-map-app.ts` | Empty frames still wake the page |
| Cloud drift can trigger another map repaint from the custom layer | `heat-map-app.ts`, `customLayer.render()` | An otherwise idle map can render continuously |
| Explore's visibility handler is intentionally empty | `heat-map-app.ts`, `onVis()` | Browser throttling is relied upon instead of owning suspension |
| Compare's 3D observatory already invalidates on demand and observes visibility | `compare/paired-map-3d.ts` | This design should be preserved, not replaced |

### 3.2 Bundle evidence

The latest local `.astro/reports/build-report.json` is the measurement baseline for
this specification. Gzip numbers include the route's external startup modules and
executable inline scripts as defined by `scripts/report-build.mjs`.

| Route/module | Raw bytes | Gzip bytes | Interpretation |
|---|---:|---:|---|
| `/heat-map/` startup total | 1,648,462 | 460,592 | All Explore application code is startup-reachable |
| Explore page-entry chunk | 859,808 | 236,219 | MapLibre and the monolithic application dominate |
| shared `three.module` chunk | 586,236 | 147,020 | Required at Explore startup today |
| `/heat-map/compare/` startup total | 216,346 | 83,542 | Includes the synchronous paired runner and raster path |
| `/heat-map/brief/` startup total | 203,297 | 78,451 | Includes the same calculation path despite no interactive map |
| lazy `paired-map-3d` module | 18,702 | 6,024 | Compare already keeps the observatory enhancement separate |
| site-wide application JavaScript | 2,113,793 | 624,390 | Reference only; this tranche is route-focused |

These values are a local build baseline, not universal network timings. The build
report must be regenerated immediately before implementation so existing unrelated
changes are not mistaken for this tranche's effect.

## 4. Goals

### 4.1 Interaction continuity

- Compare never runs the canonical paired solve as one main-thread task.
- A superseded Compare state stops at the next bounded worker slice and can never
  commit, update evidence, or announce an error.
- Controls, linked camera interaction, scrolling, and navigation remain responsive
  while Compare calculates.
- Explore prioritises pointer and camera work over optional simulation advances and
  ambient motion.
- No application-owned animation loop runs indefinitely without a current reason.

### 4.2 Work proportionality

- Hidden and fully offscreen Explore stages perform no continuous simulation
  advances, orbit, cloud drift, grow animation, or app-requested map repaint.
- Reduced-motion sessions have no ambient orbit, cloud drift, grow animation, or
  continuous simulation advance.
- Capability tier may change frame cadence and visual motion, but never the grid,
  equations, forcing, or settled-step count.
- A return from suspension requests one fresh paint; it does not simulate elapsed
  wall-clock time in a burst.

### 4.3 Progressive startup

- Server-rendered structure, labels, caveats, and controls paint before heavy map or
  rendering libraries execute.
- MapLibre is requested only on Explore.
- Three.js is requested only when a relief renderer is usable or explicitly
  requested; it is not part of the Explore startup graph and is not requested for a
  tier-0 isotherm session.
- The Explore simulation worker is requested only when the selected backend needs
  it.
- Compare's paired model and TypeScript solver live in the paired worker chunk, not
  the route's main-thread startup graph.
- Brief reuses the paired worker client without loading Compare controls, Canvas
  interaction, MapLibre, or Three.js.

### 4.4 Trust and accessibility

- Existing evidence, warnings, measurement names, and analytical states remain
  visible and unchanged.
- Pending work preserves the last valid field and values instead of replacing useful
  evidence with a blank skeleton.
- Loading, fallback, failure, and settled states are represented in text and ARIA,
  not only through animation or opacity.
- Performance adaptation is local. GPU labels, capability tiers, and raw timings are
  not transmitted as analytics dimensions.

## 5. Non-goals

- Change `heat-model-v1`, `heat-metrics-v2`, reference forcing, intervention
  constants, `RESET_BURST`, surface inputs, DC-URS, or the canonical 192×192 grid.
- Port the solver to Go, WASM, WebGPU, Python, or a remote API.
- Make two wards calculate concurrently in two workers. The paired contract remains
  one bounded job so devices are not oversubscribed.
- Add speculative service-worker caching or persistent simulation-result storage.
- Redesign the Field Instrument, Research Console, Compare workbench, mobile sheet,
  typography, colour, or information hierarchy.
- Remove the live/2.5D/3D character from capable devices.
- Build the complete no-WebGL analytical equivalent. Task 4 remains separate.
- Build production browser/device parity automation, alerting, or release blocking
  across hosted environments. Task 5 remains separate.
- Optimise the homepage, CBAM routes, blog, or general Base layout.

## 6. Shared performance invariants

The following rules apply across all three tasks:

1. **Fidelity is invariant.** Scheduling and module loading may change when work
   happens, not what the model evaluates.
2. **Latest request wins.** Every asynchronous result carries both a request ID and
   generation. A stale result is ordinary control flow, not an error.
3. **One expensive owner per surface.** Explore owns at most one simulation command;
   Compare owns at most one active paired job and one queued latest job.
4. **No wall-clock catch-up.** Hidden time is not physical model time. Resume from the
   current field and continue only if the active budget permits it.
5. **Useful state survives pending work.** Keep the last committed result visible,
   mark it as updating, and replace both paired wards atomically.
6. **Motion has a reason.** A frame exists for interaction, an explicit transition,
   or approved ambient motion. No empty polling frame is allowed.
7. **Enhancement may fail independently.** Calculation, MapLibre core, and Three.js
   relief each expose their own health. A failed relief import must not erase a valid
   map or calculation.
8. **Dispose is final.** Astro navigation cancels requests, terminates workers,
   disconnects observers, cancels frames/timers, and makes late completions inert.

## 7. Decision 1 — a cancellable paired-simulation worker

### 7.1 Architectural boundary

Compare does not reuse `WorkerHeatSimHost` directly. That host deliberately owns one
persistent Explore simulation with `reset()` and `advance()`. A paired run is a
different workload: it prepares two wards, evaluates four fields, caches immutable
ward inputs, and commits one atomic result.

The correct design uses a separate worker entry and client while sharing the same
canonical kernel and scheduling primitives:

```text
compare route / brief route
          |
          v
PairedScenarioClient              main thread; request ownership only
          |
          | paired-run / cancel / dispose
          v
paired-worker.ts                  one job-oriented module worker
          |
          v
paired-core.ts                    pure orchestration and evidence assembly
          |
          +--> ward loaders / raster / intervention model
          +--> cooperative TsHeatSim executor
          +--> canonical types and metrics
```

“Shared simulation host” therefore means shared solver, canonical types, cooperative
execution helper, lifecycle rules, and result invariants. It does not mean forcing
both UI surfaces through an unsuitable single-instance API.

### 7.2 File responsibilities

The intended seam is:

```text
src/scripts/climate-engine/
  sim-ts.ts                         existing canonical CPU solver
  sim-cooperative.ts                new bounded-slice TsHeatSim executor
  compare/
    paired-protocol.ts              new job/request/progress/result contracts
    paired-core.ts                  new DOM-free paired orchestration
    paired-worker.ts                new worker owner, latest-job queue and caches
    paired-client.ts                new browser client + cooperative fallback
    paired-runner.ts                compatibility export for Node/tests if needed
    paired-controller.ts            edit: consume PairedScenarioClient
    paired-brief.ts                 edit: consume PairedScenarioClient
```

Names may change during implementation, but the boundaries may not collapse back
into the controller or DOM.

### 7.3 Cooperative solver primitive

`TsHeatSim.step()` remains synchronous and unchanged. A new executor owns the loop:

```ts
export interface CooperativeRunOptions {
  totalSteps: number;
  maxSliceMs: number;
  isCancelled(): boolean;
  yieldControl(): Promise<void>;
}

export async function runTsFieldCooperatively(
  layers: SimLayers,
  params: SimParams,
  grid: GridSpec,
  options: CooperativeRunOptions,
): Promise<{ field: Float32Array; stats: SimStats }>;
```

Rules:

- Each slice runs steps until it reaches the smaller of a step ceiling and an
  8 ms time budget. The initial ceiling is 48 steps and must be tuned with traces,
  not increased blindly.
- `yieldControl()` must yield to the worker task queue, not merely the microtask
  queue. Prefer `scheduler.yield()` when present and a `MessageChannel`/timer-based
  fallback otherwise.
- Cancellation is checked before a slice, after a slice, and before copying the
  output field.
- Cancellation disposes the active `TsHeatSim` and throws an internal typed
  cancellation result. It never assembles partial metrics.
- The same helper powers the emergency main-thread fallback with a stricter 8 ms
  maximum slice. The fallback is slower but remains interactive.
- Solver parity tests compare the cooperative result with one direct 600-step run;
  slicing must be bit-identical or within the existing floating-point tolerance if
  engine internals make exact identity impossible.

The worker must yield because a `cancel` message cannot be processed while one large
synchronous `step()` call monopolises its event loop.

### 7.4 Worker protocol

The paired protocol is versioned and separate from Explore's reset/advance protocol:

```ts
export type PairedJobStage =
  | 'loading-inputs'
  | 'preparing-wards'
  | 'solving-baselines'
  | 'solving-scenarios'
  | 'assembling-evidence';

export type PairedWorkerRequest =
  | { type: 'run'; requestId: number; generation: number; state: PairedScenarioState;
      knownAssetKeys: string[] }
  | { type: 'cancel'; requestId: number }
  | { type: 'dispose' };

export type PairedWorkerResponse =
  | { type: 'progress'; requestId: number; generation: number; stage: PairedJobStage }
  | { type: 'result'; requestId: number; generation: number; result: PairedWireResult }
  | { type: 'cancelled'; requestId: number; generation: number }
  | { type: 'failure'; requestId: number; generation: number; code: PairedFailureCode;
      message: string };
```

Progress uses truthful named stages, not invented percentages. The UI may display a
short “Updating comparison…” state; it must not announce every progress message to
screen readers.

### 7.5 Latest-only queue and cancellation

The worker owns one active job and at most one pending job:

1. A new `run` becomes the pending latest job.
2. If another job is active, mark it cancelled.
3. At the next cooperative yield, the active executor observes cancellation,
   disposes its solver, and does not emit a result.
4. Replace any older pending job with the newest state.
5. Start the pending job after cleanup.

No FIFO queue is allowed. Moving a slider through five values should calculate the
last value, not replay four obsolete scenarios.

The client also keeps its existing generation check. Worker cancellation saves CPU;
the main-thread generation check remains the final commit barrier.

### 7.6 Preparation and bounded caching

The worker performs same-origin data loading and CPU preparation so JSON parsing,
rasterisation, spatial targeting, and the model all leave the main thread.

The following immutable caches are permitted for the worker lifetime:

- ward asset bundle keyed by `wardId + dataVersion`;
- raster base and spatial targeting keyed by `wardId + dataVersion + gridVersion`;
- baseline result keyed by
  `wardId + forcingId + phase + modelVersion + gridVersion`.

Coverage does not belong in the baseline key because the baseline always uses zero
interventions. Scenario fields are not cached across slider values; their key space
is effectively unbounded and each latest job is cheap enough after preparation.

Cache rules:

- Load both selected ward asset bundles in parallel.
- Run field solves sequentially inside the one worker to avoid device
  oversubscription and excess peak memory.
- Retain no historical scenario fields.
- Bound structural caches to the shipped ward catalogue or an LRU of three wards,
  whichever is smaller once the catalogue grows.
- A model, grid, metrics, forcing, or data-version change creates a different key.
- Clear all caches on worker disposal or unrecoverable worker error.

### 7.7 Static render assets and transfer cost

Each 192×192 `Float32Array` is approximately 144 KiB. The two scenario fields may be
transferred to the main thread because the worker does not need those copies after
result assembly.

Ward geometry and roads are substantially larger and do not change with coverage.
They must not be structured-cloned on every slider update:

- The client keeps a `WardRenderAsset` cache keyed by ward/data version.
- A request declares its `knownAssetKeys`.
- The result includes render assets only for missing keys.
- Fields are always transferred; render assets are sent once per client lifetime.
- A missing or mismatched asset key fails closed and requests the complete asset on
  the next run; it never pairs a field with another ward's geometry.

The main thread combines the wire result with its cached render assets before the
controller receives the existing `PairedResult` view model.

### 7.8 Result atomicity and visible state

While a job is pending:

- keep the previous two fields, metrics, evidence, and 3D scenes visible;
- set the compare root to `aria-busy="true"` and `data-pending="true"`;
- show “Updating comparison…” without blanking the workbench;
- allow controls to accept a newer state;
- do not update only ward A or only one evidence column.

On a valid result, both wards, the shared forcing label, evidence, URL state, Canvas
fields, and observatory data commit as one generation. The existing lazy Three.js
observatory then receives one paired update.

Cancelled jobs are silent. A genuine failure retains the last valid result and shows
one concise error with a retry action. Initial-load failure shows no invented values.

### 7.9 Backend evidence

Execution location does not create a new scientific model version, but it is useful
reproducibility evidence. Widen the backend identity from the current fixed
`'ts-v1'` value to an explicit execution value:

```ts
export type PairedBackendVersion = 'ts-worker-v1' | 'ts-main-cooperative-v1';
```

The evidence block and Brief print this value. No copy may imply that the worker is a
different model. Both paths run the same TypeScript kernel and must satisfy the same
parity tests.

### 7.10 Failure and fallback policy

| Condition | Behaviour | Visible result |
|---|---|---|
| Worker creation blocked | Start cooperative main-thread host once | Same canonical result; backend names fallback |
| Worker fails before first result | Retry once through cooperative host | Loading becomes fallback, then settled or error |
| Worker fails after a valid result | Keep current result; next job uses cooperative host | Previous result remains visible |
| Job superseded | Cancel at next slice; run latest | No error or stale commit |
| Asset fetch fails | Fail that generation; retain prior result | Concise unavailable/retry state |
| Evidence invariant fails | Reject the entire pair | No partial ward commit |
| Astro route swap | Cancel, dispose, terminate, ignore late messages | No leaked worker or handler |

There is no automatic worker recreation loop. One worker failure demotes for that
page lifetime.

## 8. Decision 2 — one Explore runtime budget

### 8.1 Architectural boundary

Explore currently lets several features decide independently whether to schedule the
next frame. The replacement is one pure state machine plus one on-demand scheduler:

```text
visibility + intersection + capability + motion preference + interaction
                                |
                                v
                     ExploreWorkBudget
                                |
          +---------------------+----------------------+
          v                     v                      v
   frame reasons          simulation policy      ambient policy
   drag/grow/camera       reset/advance cadence   orbit/cloud/water
```

The budget decides permission and cadence. Individual render features still own
their drawing code, but none may create an independent perpetual loop.

### 8.2 Inputs and outputs

```ts
export type RuntimePhase =
  | 'booting'
  | 'active'
  | 'interacting'
  | 'idle'
  | 'suspended'
  | 'disposed';

export interface ExploreBudgetInputs {
  documentVisible: boolean;
  stageIntersecting: boolean;
  interacting: boolean;
  explicitTransition: boolean;
  reduceMotion: boolean;
  tier: 0 | 1 | 2;
  mode: 'relief' | 'isotherm';
  simReady: boolean;
}

export interface ExploreBudget {
  phase: RuntimePhase;
  presentationFps: 0 | 30 | 60;
  allowAmbientMotion: boolean;
  allowSimulationAdvance: boolean;
  simulationCadenceMs: number | null;
  allowRequestedRepaint: boolean;
}
```

The reducer is DOM-free and accepts an injected monotonic clock for deterministic
tests.

### 8.3 Budget matrix

| State | Presentation | Simulation | Ambient motion | Resume rule |
|---|---|---|---|---|
| Tier 2, visible relief | Up to 60 fps while a reason exists | Existing advance size, no faster than current cadence | Allowed after idle delay | Continue from current field |
| Tier 1, visible relief | Cap app animation at 30 fps | At most 1 advance/second | Allowed at reduced cadence | Continue from current field |
| Tier 0/isotherm | Event-driven only | Initial/reset snapshot; at most 1 advance/2 seconds if explicitly retained | None | One repaint |
| User interacting | Pointer/camera frames only | Paused | Paused | Resume simulation after 250 ms quiet; orbit after existing 2.5 s delay |
| Reduced motion | Event-driven only | One settled reset; no continuous advance | None | One repaint per explicit change |
| Fully offscreen | No app-owned frames | Paused | None | One invalidation when intersecting again |
| Document hidden | No app-owned frames | Paused | None | Reset time baselines; one invalidation on visibility |
| Disposed | None | None | None | Never resumes |

“Existing advance size” means the current 80-step visual advance remains unchanged.
The budget changes when it may run, not the calculation performed by an approved
advance.

### 8.4 Suspension signals

- Use `document.visibilityState` for tab/window visibility.
- Observe the complete Explore stage root with `IntersectionObserver` at a low
  threshold such as `0.01`.
- Treat zero intersection as suspended after a 250 ms grace period so a boundary
  crossing does not thrash the scheduler.
- Visibility suspension is immediate.
- If `IntersectionObserver` is unavailable, use document visibility and assume the
  mounted route is intersecting. This is a performance fallback, not a content
  failure.
- Observer and visibility listeners are registered once per mount and removed by
  the returned disposer.

Required ward/data loads may finish while offscreen so the selected evidence is
ready when the user returns. Continuous `advance` commands and visual animation do
not continue. At most the latest settled snapshot is retained for presentation.

### 8.5 One on-demand frame scheduler

Replace perpetual orbit, drag, and simulation polling loops with one scheduler that
tracks frame reasons:

```ts
type FrameReason =
  | 'pointer'
  | 'inertia'
  | 'camera-transition'
  | 'grow-transition'
  | 'ambient-orbit'
  | 'ambient-cloud'
  | 'field-upload'
  | 'resize';
```

Rules:

- `requestFrame(reason)` sets a bit and queues at most one `requestAnimationFrame`.
- The frame consumes pending pointer deltas, updates approved transitions, and asks
  MapLibre for a repaint only if visible output changed.
- A reason requeues itself only while it remains active and budget-approved.
- Pointer move events accumulate deltas; they do not render directly.
- Inertia ends once velocity drops below the existing threshold and then removes its
  reason.
- Simulation cadence uses a timeout or scheduler deadline that requests work; it
  does not keep a 60 fps polling loop alive to count every fortieth frame.
- The custom Three.js layer may not call `map.triggerRepaint()` merely because it was
  rendered. Cloud drift must receive budget-approved visual time and requeue through
  the scheduler.
- MapLibre remains responsible for its own internal style and camera transitions.
  This design governs application-created frames and repaints; it does not patch
  MapLibre internals.

### 8.6 Interaction priority

Interaction begins on pointer down, active wheel input, touch gesture, or keyboard
camera control. While interacting:

- pause simulation advances before the next command is posted;
- pause orbit and cloud drift;
- coalesce pointer movement into one update per frame;
- preserve the current heat field and readouts;
- do not cancel a required in-flight reset for the user's latest scenario;
- allow one pending reset result to commit if its generation is current;
- schedule no catch-up advances when interaction ends.

After 250 ms without interaction input, simulation eligibility returns. Ambient
orbit retains the existing longer 2.5 s quiet period so the camera does not begin
moving immediately under the reader's cursor.

### 8.7 Simulation command budget

The main thread may have:

- one reset in flight for the latest generation; and
- at most one advance in flight.

An advance due while another is active coalesces into one pending eligibility check,
not a queue of step counts. If the stage becomes suspended before dispatch, discard
the pending advance. If it becomes suspended after dispatch, accept the current
snapshot only when it is current, retain it, and do not dispatch another.

No hidden-time step debt is accumulated. The model uses stationary scenario forcing;
elapsed wall-clock time is not an input and must not be fabricated as one.

### 8.8 Stable evidence during ambient animation

The 600-step reset snapshot is the canonical settled result for a scenario
generation. Performance adaptation must not make published numbers depend on how
long a tab stayed visible.

Therefore:

- evidence readouts, shared URLs, and downloadable/printable values bind to the
  settled reset snapshot;
- optional post-settle advances may animate the heat texture on capable active
  sessions, but do not rewrite the committed analytical metrics;
- a probe may label its value as the current visual model cell if it samples an
  animated field;
- Compare and Brief remain fixed settled results.

This removes a subtle timing ambiguity in which two users could read different mean
values from the same scenario merely because one watched the animation longer. It
does not change the settled model or visual field sequence.

### 8.9 Motion and capability policy

- `prefers-reduced-motion: reduce` overrides all ambient motion regardless of tier.
- Tier 0 has no orbit, cloud drift, grow animation, or water-time advance.
- Tier 1 caps application presentation at 30 fps and uses a slower ambient tick.
- Tier 2 may use 60 fps while interacting or transitioning.
- Water and cloud time advance from scheduler-provided visual time, not direct
  `performance.now()` calls inside render functions.
- Suspended duration is excluded from visual time so returning to the page does not
  jump clouds, water, or grow transitions forward.
- User-triggered camera changes and field updates always request a paint even when
  ambient motion is disabled.

### 8.10 Visible states

The stage root exposes one state vocabulary:

```text
data-runtime="booting | active | interacting | idle | suspended | error"
data-motion="full | reduced | none"
data-sim="gpu-webgl2 | ts-worker | ts-main | unavailable"
```

`suspended` is an internal performance state and does not need a visible banner.
Backend and genuine loading/error states remain visible through the existing
instrument labels. State changes caused by scrolling or tab visibility are not
announced to assistive technology.

## 9. Decision 3 — progressive heat-map route graph

### 9.1 Loading sequence

The intended Explore sequence is:

```text
Astro HTML + route CSS
        |
        v
small heat-map bootstrap
        |
        +--> capability/motion decision
        +--> visibility and Astro lifecycle
        |
        v
MapLibre + data/controller core
        |
        +--> selected simulation host/worker
        +--> first settled field and analytical readouts
        |
        v
Three.js relief enhancement when eligible
```

The shell is not a fake loading experience. It is the real server-rendered
instrument structure, with its labels, caveats, controls, and status region present
before the runtime arrives.

### 9.2 Route bootstrap

`src/pages/heat-map.astro` statically imports only a small browser bootstrap. The
bootstrap:

1. verifies that the Explore root exists;
2. marks it `aria-busy="true"` and `data-boot="shell"`;
3. installs Astro page-load/before-swap ownership;
4. yields one animation frame so HTML and route CSS can paint;
5. resolves motion/capability policy;
6. dynamically imports the Explore core when the stage is intersecting;
7. disposes safely if navigation wins the import race.

The primary Explore stage must not wait behind `requestIdleCallback`. When visible,
it starts immediately after the first paint. If a soft navigation mounts it outside
the viewport or in a hidden document, loading may wait until visibility.

Compare and Brief use equivalent small bootstraps that dynamically import only their
controllers. Their paired worker is created by `PairedScenarioClient` when the first
job starts.

### 9.3 Module boundaries

The target module graph is:

```text
heat-map-bootstrap.ts              tiny; no MapLibre, Three or solver
  -> explore-core.ts               MapLibre, state, loaders, controls, 2D field path
       -> sim-host.ts              selected execution host
            -> sim-gpu.ts          raw WebGL2 GPU solver; no Three dependency
            -> sim-worker.ts       worker-only TypeScript solver
       -> explore-relief.ts        dynamic; Three and relief layers

compare-bootstrap.ts               tiny
  -> paired-controller.ts          DOM, Canvas baseline, URL state
       -> paired-client.ts         worker lifecycle
            -> paired-worker.ts    worker-only model/raster/solver
       -> paired-map-3d.ts         existing dynamic Three enhancement

brief-bootstrap.ts                 tiny
  -> paired-brief.ts               print DOM only
       -> paired-client.ts         same worker lifecycle
```

`explore-core.ts` may begin as an extraction from `heat-map-app.ts`; a rewrite is not
required. The implementation must, however, remove all static Three imports from the
core boundary.

### 9.4 Explore core and relief boundary

The core owns:

- URL/DOM state and controls;
- capability and runtime budget;
- ward/data loading and transactional commit;
- MapLibre map lifecycle and top-down field presentation;
- simulation host selection and settled analytical values;
- the contract passed to a relief renderer.

The relief module owns:

- the Three.js custom layer and shared-context renderer;
- buildings/facades, terrain displacement, water, roads, clouds, picking, and
  relief-only uniforms;
- relief resource creation/update/disposal;
- its own context-loss signal back to the core.

The hand-off is a narrow interface rather than access to the complete application
closure:

```ts
export interface ReliefRenderer {
  updateWard(bundle: CommittedWardRenderBundle): Promise<void>;
  updateField(field: Float32Array, ramp: readonly [number, number]): void;
  updateEnvironment(environment: ReliefEnvironment): void;
  renderFrame(frame: BudgetedVisualFrame): boolean;
  setMode(mode: 'relief' | 'isotherm'): void;
  dispose(): void;
}
```

The boolean from `renderFrame` reports whether another frame is required. Relief
cannot schedule its own perpetual loop.

### 9.5 First usable map state

The first usable state must not depend on Three.js. The MapLibre core presents a
top-down heat field using a MapLibre-compatible image/canvas source or equivalent
core-owned layer while the relief module loads. This is still an interactive
WebGL-backed map; it is not the complete no-WebGL fallback deferred to task 4.

When relief is eligible:

- begin its dynamic import after MapLibre is ready and the first settled field is
  available;
- use an idle opportunity with a maximum 750 ms timeout, or start immediately when
  the user explicitly selects Relief;
- keep the usable top-down field visible during import and preparation;
- cross-fade only after the relief renderer has produced its first complete frame;
- preserve camera, selected ward, field, and environment state across the hand-off;
- if relief fails, keep the core map and name the fallback without clearing results.

Do not split every visual layer into a separate request. One relief island is the
default; split a layer further only if the build report proves a material optional
cost and the extra waterfall does not delay the first relief frame.

### 9.6 Capability-controlled requests

| Session | MapLibre core | Explore sim worker | Three relief |
|---|---|---|---|
| Tier 2 + GPU simulation | yes | no initially | yes |
| Tier 2 + TypeScript simulation | yes | yes | yes |
| Tier 1 | yes | yes | yes, 30 fps budget |
| Tier 0/isotherm | yes | yes | no |
| Reduced motion, relief-capable | yes | yes static unless GPU policy changes | yes, static |
| Compare Canvas state | no | paired worker only | no until enhancement eligibility |
| Compare relief state | no | paired worker only | existing lazy paired 3D module |
| Brief | no | paired worker only | no |

MapLibre and Three must remain absent from non-heat routes. The paired worker must
not import Three or MapLibre.

### 9.7 Build strategy

- Use source-level dynamic-import boundaries first. Do not begin with broad
  `manualChunks` rules that hide an incorrect dependency graph.
- The current GPU solver uses Three wrappers. Replace those wrappers with the same
  shader/equations expressed through raw WebGL2 before declaring the core
  Three-free. Old-vs-new GPU and CPU parity is a release gate; this is dependency
  removal, not a model/backend change.
- Keep one installed Three version and one shared Three runtime chunk.
- Continue prebundling the exact Three add-ons needed for dev reliability, but verify
  that prebundling does not make them route-startup dependencies in production.
- Keep MapLibre in its own route-only chunk where the bundler permits it.
- Worker entry points are loaded by `new Worker(new URL(..., import.meta.url),
  { type: 'module' })`; no remote code, `eval`, or blob-loaded dependency is allowed.
- Route CSS remains eager so the shell does not flash unstyled.
- Do not preload relief or worker chunks from Base. Any preload must be justified by
  a route-specific trace.
- Run the build report after every boundary extraction. A split that adds transfer
  bytes or creates a serial waterfall without improving the stated milestone is
  reverted.

### 9.8 Loading and failure UI

The server-rendered status region uses these concise states:

| State | Suggested copy | Controls |
|---|---|---|
| shell painted | “Preparing the map…” | Present; model-dependent controls disabled |
| core loading | “Loading the study area…” | Navigation remains available |
| model settling | “Running the canonical model…” | Scenario controls may queue latest state |
| first field ready | Existing settled/backend copy | Enabled |
| relief loading | “Preparing relief view…” in renderer state only | Core map remains interactive |
| relief unavailable | “2D map active · relief unavailable” | Map and evidence remain usable |
| core import/map failure | “Map unavailable. Reload to retry.” | Evidence is never invented |

Do not narrate every internal chunk or worker stage. The user needs the instrument's
state, not its bundler vocabulary.

## 10. Performance budgets and measurement

### 10.1 Build budgets

Budgets are checked from `scripts/report-build.mjs` and a new route-budget verifier.
They are ceilings, not targets to pad up to.

| Budget | Ceiling | Baseline |
|---|---:|---:|
| `/heat-map/` startup total | 110 KiB gzip | 449.8 KiB |
| `/heat-map/compare/` startup total | 78 KiB gzip | 81.6 KiB |
| `/heat-map/brief/` startup total | 74 KiB gzip | 76.6 KiB |
| Explore first-usable reachable total, excluding optional relief | 325 KiB gzip | Not separated today |
| Explore full relief reachable total | ≤ current baseline + 10% | 446.2 KiB module graph |

Required graph assertions:

- Explore startup has no static path to `maplibre-gl`, `three`, `sim-ts`, or a worker
  bundle.
- Explore core has no static path to `three` or relief modules.
- Tier-0 browser traces request no Three chunk.
- Compare and Brief startup have no static path to `sim-ts`, `ward-raster`, or paired
  core/model implementation.
- Brief has no path to Canvas interaction or paired 3D.
- Homepage, Team, About, and CBAM routes gain no heat-map dependency.

The 110 KiB Explore startup ceiling includes the existing Base/ClientRouter cost and
the small route bootstrap. If unrelated Base changes make the ceiling impossible,
the verifier reports the shared delta separately; it is not silently raised.

### 10.2 Runtime budgets

| Measurement | Budget |
|---|---|
| Compare solver-created main-thread tasks | No task ≥50 ms attributable to paired calculation |
| Compare slider input to next paint | p75 ≤50 ms in the repository's local interaction trace |
| Worker cancellation latency | ≤ one 8 ms slice plus one worker task-queue yield, excluding platform scheduling |
| Active paired jobs | 1 active + 1 latest pending maximum |
| Explore simulation commands | 1 reset + 1 advance maximum; advances coalesce |
| Hidden/offscreen continuous app frames | 0 after suspension grace period |
| Reduced-motion ambient frames | 0 after explicit transition settles |
| Tier 1 application animation | ≤30 presentation frames/second |
| Tier 0 application animation | Event-driven; no ambient frame source |
| Resume work | One paint invalidation; no accumulated simulation step debt |

The 50 ms task boundary follows the browser long-task threshold. It is not permission
to schedule 49 ms slices; solver slices target 8 ms.

### 10.3 Performance marks

Add local marks and measures:

```text
heat:shell-ready
heat:core-requested
heat:map-ready
heat:first-field
heat:relief-ready
compare:job-start
compare:first-settled
compare:update-settled
```

Marks support development traces and E2E assertions. They contain no ward names,
scenario values, GPU labels, or personal data and are not automatically sent to
analytics.

Initial implementation records baselines for `shell -> first-field` and
`first-field -> relief-ready` under the repository's documented desktop and mobile
profiles. They become hard time ceilings only after three repeatable local/CI runs;
network timing should not be guessed into this specification.

### 10.4 Diagnostics

- A development-only `PerformanceObserver` may record long tasks and frame counts.
- Production code may expose aggregate marks through the browser Performance API but
  must not log every frame or worker slice.
- Vercel Analytics/Speed Insights remains independent. This tranche does not add
  custom device or capability telemetry.
- Console warnings are reserved for genuine worker/import/context failures, not
  cancellation, suspension, or capability demotion.

## 11. Combined state and lifecycle

### 11.1 Explore

```text
Astro mount
   -> shell paint
   -> capability + visibility decision
   -> dynamic core import
   -> map/data/model initialise
   -> settled field commits
   -> optional relief import and first frame
   -> active / interacting / idle / suspended
   -> Astro before-swap
   -> cancel + dispose + terminate
```

If navigation occurs during any import or worker operation, the mount generation is
invalidated. A module may finish downloading into the browser cache, but it may not
mount into the departed page.

### 11.2 Compare and Brief

```text
route mount
   -> controller/client import
   -> first paired job
   -> worker loads/prepares/solves
   -> atomic settled pair
   -> optional Compare 3D enhancement
   -> latest-only updates
   -> route disposal terminates worker
```

Brief terminates its paired worker after the one successful result unless it exposes
an in-page scenario-editing action in the future.

## 12. Error-state matrix

| Failure | Explore | Compare | Brief |
|---|---|---|---|
| Dynamic core import fails | Explicit map unavailable/reload state | Controller unavailable/reload state | Brief unavailable/reload state |
| Simulation worker unavailable | Existing cooperative static fallback | Cooperative paired fallback | Cooperative paired fallback |
| Worker fails mid-job | Demote once; replay latest reset | Retain previous pair; fallback on latest | Fallback once, then error |
| Three import fails | Core top-down map remains | Canvas relief remains | Not applicable |
| WebGL context loss | Existing backend demotion; map failure explicit | Canvas renderer remains | Not applicable |
| Ward/data fetch fails | Current committed ward remains | Previous pair remains | No invented brief values |
| Stage hidden/offscreen | Suspend optional work | Existing observatory suspension preserved | No animation exists |
| Route disposed | All completions ignored | Job cancelled and worker terminated | Worker terminated |

The complete analytical experience when MapLibre/WebGL itself is absent remains task
4. This tranche must expose the failure clearly and preserve any completed textual
calculation it already has, but it does not claim to finish that fallback.

## 13. Testing strategy

### 13.1 Unit and contract tests

- Cooperative direct-vs-sliced solver parity for peak and retained forcing.
- Cancellation before start, during each ward, between baseline/scenario, and before
  result transfer.
- Latest-only queue never runs an intermediate pending state.
- Bounded caches hit only for identical versioned keys and never cache scenario
  fields.
- Render assets are sent once and cannot pair with the wrong ward/version.
- Worker and cooperative fallback return identical metrics, fields, evidence, and
  delivered quantities within approved tolerances.
- Runtime-budget reducer covers every matrix row, visibility/intersection races,
  interaction quiet periods, reduced motion, and disposal.
- Frame-reason scheduler queues at most one rAF and stops after its final reason.
- Simulation advance coalescing never accumulates hidden-time debt.
- Settled metrics remain fixed while optional visual fields advance.
- Source/build contracts prove the required dynamic-import boundaries.

### 13.2 Browser tests

- Rapidly drag a Compare coverage slider; only the final state settles and the page
  remains scrollable/clickable during calculation.
- Change wards and phase while a previous paired run is active; no mixed pair or
  stale evidence appears.
- Block worker construction; Compare and Brief settle through the named cooperative
  fallback without a long task ≥50 ms.
- Navigate away during a job and verify no late DOM mutation, worker, listener, or
  console error.
- Scroll Explore fully offscreen and verify app-owned frame and advance counters stop
  after 250 ms; scroll back and verify one repaint with no burst.
- Hide/show the page and verify visual time excludes the hidden interval.
- Interact with Explore and verify simulation/orbit/cloud work pauses while pointer
  updates remain smooth.
- Emulate reduced motion and tier 0; verify no ambient frames and no Three network
  request for tier 0.
- Fail the relief import/context; verify the top-down core map, controls, evidence,
  and retry/fallback copy remain usable.
- Verify keyboard camera controls, focus visibility, live-region restraint, and
  `aria-busy` transitions.

### 13.3 Build and route tests

- Run `npm run build` and `npm run report:build`.
- Run the new route-budget verifier against the JSON report.
- Inspect module reachability and an actual Playwright network trace; a dynamic
  module's absence from a simplistic graph parser alone is not sufficient proof.
- Confirm source maps/minified chunks contain only one shipped Three version and no
  duplicate MapLibre runtime.
- Confirm worker chunks are local module assets with no unexpected external request.
- Confirm non-heat routes' reachable byte totals do not regress because of shared
  chunk promotion.

### 13.4 Repository gates

The implementation is complete only when these pass:

```bash
npm run check
npm run test:unit
npm run build
npm run report:build
npm run check:publication
npm run test:e2e:built
```

Focused performance and heat-map tests should run after each task before the full
gate.

## 14. Rollout order

The implementation should proceed in this order:

1. Add cooperative solver/protocol tests and freeze direct-solver parity.
2. Extract paired core, add worker/client, migrate Compare, then migrate Brief.
3. Add the pure Explore budget and on-demand scheduler while retaining the current
   module graph.
4. Move simulation cadence, orbit, inertia, grow, cloud, and water time behind the
   budget one source at a time.
5. Add route bootstraps and make controllers dynamically imported.
6. Extract the Explore core/relief interface and remove Three from the core graph.
7. Add the first-usable top-down core field and relief hand-off.
8. Add budget verification, browser traces, accessibility checks, and documentation.

This order proves calculation parity before moving execution, then proves runtime
behaviour before changing loading order. Each stage can be reviewed independently.

## 15. Documentation updates required after implementation

Update, but do not rewrite, the existing heat-map documents:

- `docs/heat-map-feature.md`: worker ownership, progressive loading, and stable
  settled metrics;
- `docs/heat-map-adaptive-views-spec.md`: fulfilled runtime-budget and tier request
  matrix;
- `docs/heat-map-adaptive-views-implementation.md`: actual module graph and measured
  bundle deltas;
- `docs/heat-map-intervention-model.md`: execution-location evidence only; no model
  equation change;
- the relevant PDFs generated from those Markdown sources, after the Markdown is
  approved and updated.

The implementation record must include before/after build-report values and three
repeatable runtime traces. Documentation may not claim a performance win based only
on source structure.

## 16. Acceptance criteria

### Task 1 — Compare worker

- Compare and Brief use the paired worker client by default.
- Paired calculation creates no main-thread task ≥50 ms in the reference trace.
- A superseded job cancels cooperatively and only the latest state may commit.
- Four canonical calculations still use 600 steps on the 192×192 grid.
- Baseline and structural caches are versioned and bounded; scenario fields are not
  retained.
- Render assets transfer once per client/version, while fields use transferable
  buffers.
- Worker and cooperative fallback results pass parity and evidence checks.
- Previous valid evidence remains visible during updates and genuine failures.

### Task 2 — Explore runtime budget

- There is one tested runtime-budget state machine and one app-owned frame
  scheduler.
- Orbit, drag/inertia, simulation polling, grow, cloud, and water do not own
  perpetual independent loops.
- Hidden/offscreen and reduced-motion sessions reach zero ambient app frames.
- Interaction pauses simulation and ambient work without delaying pointer/camera
  response.
- Resume performs one invalidation and no catch-up simulation burst.
- Settled analytical readouts do not drift with viewing duration.
- Tier and motion policies change cadence only, never analytical fidelity.

### Task 3 — bundle and startup diet

- The server-rendered shell paints before heavy route libraries execute.
- `/heat-map/` startup is at or below 110 KiB gzip under the build-report contract.
- MapLibre, Three, and solver code are absent from the Explore startup graph.
- First usable core map does not wait for Three.
- Tier 0 requests no Three chunk; Compare Canvas and Brief request no MapLibre.
- Relief failure leaves a usable top-down map and valid evidence.
- Full relief reachable bytes do not exceed the current baseline by more than 10%.
- Non-heat routes gain no heat-map runtime dependency.

### Whole tranche

- Current model, metric, grid, forcing, cost, delivered-quantity, and provenance
  tests remain unchanged and pass.
- No mixed-generation result, blank pending state, worker leak, frame leak, context
  leak, or soft-navigation remount leak remains.
- Keyboard, focus, reduced-motion, status, and `aria-busy` behaviour pass browser
  tests.
- Build, type, unit, E2E, publication, bundle, and performance gates pass.

## 17. Explicitly deferred work

After this tranche is implemented and audited, the remaining two tasks are:

4. **Full no-WebGL analytical fallback:** a complete, accessible static/Canvas
   equivalent that preserves the heat-map decision workflow when MapLibre/WebGL is
   unavailable.
5. **Production parity and resilience CI:** hosted multi-browser/device parity,
   deterministic artefact checks, release thresholds, failure injection, and
   production observability around the climate engine and heat-map routes.

Neither task should be pulled into this implementation through “temporary” fallback
UI or CI expansion. Their interfaces are respected here—the core calculation and
progressive module boundaries make them easier—but they require separate review.
