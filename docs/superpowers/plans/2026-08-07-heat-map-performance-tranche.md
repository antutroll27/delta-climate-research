# Heat-map performance tranche: implementation plan

**Date:** 2026-08-07

**Status:** implemented locally; validation and audit complete 2026-08-08

**Goal:** implement the first three remaining climate-engine audit tasks in order:
move Compare and Brief calculation into a cancellable paired worker, budget Explore
runtime work, then split heat-map startup into a small shell, MapLibre core, worker
calculation path, and optional Three.js relief enhancement.

**Contract:**
[`../specs/2026-08-07-heat-map-performance-tranche-design.md`](../specs/2026-08-07-heat-map-performance-tranche-design.md)

**Prior contract:**
[`../specs/2026-08-07-heat-map-correctness-resilience-design.md`](../specs/2026-08-07-heat-map-correctness-resilience-design.md)

**Tech stack:** Astro 7, TypeScript, MapLibre GL, Three.js, raw WebGL2, module Web
Workers, `node:test`, Playwright, and the repository build-report tooling.

## Implementation record — 2026-08-08

The three approved tasks were implemented without changing the analytical model or
evidence contract:

1. Compare and Brief now call `PairedScenarioClient`, which owns a module worker,
   latest-request cancellation, transfer-safe result transport, and a bounded-slice
   main-thread fallback. Immutable prepared wards and baseline statistics persist
   for the worker lifetime; scenario fields never enter that cache.
2. Explore now has a pure runtime admission policy and one coalescing frame
   scheduler. Drag, orbit, growth, cloud motion, and simulation cadence all pass
   through it. Hidden documents suspend application work and resume with one fresh
   frame, never a wall-clock catch-up burst.
3. Each heat route now boots through a small dynamic route shell. The existing GPU
   analytical solver was replaced by `sim-gpu-webgl2.ts`, a raw WebGL2 ping-pong
   implementation which does not allocate a second Three.js renderer. The large
   visual instrument remains a single lazy Explore module; further extraction of
   the MapLibre and relief display internals is deliberately a follow-up because
   it is not required for the route-startup boundary already shipped here.

Local validation on 2026-08-08: `astro check` (0 errors), focused unit contracts,
production build, build report, and five built-site Playwright checks all passed.
The only existing diagnostic is an unused `require` hint in
`tests/unit/heat-map-surface-orientation.test.mjs`.

## Working rules

- Execute phases strictly in order. Task 1 must settle before Task 2; Task 2 must
  settle before Task 3.
- Implement test-first. Each task begins with a failing contract or reproducer and
  ends with a focused passing gate.
- Preserve `heat-model-v1`, `heat-metrics-v2`, `paired-coverage-v1`, forcing records,
  intervention constants, `RESET_BURST`, DC-URS, and the canonical 192×192 grid.
- Preserve unrelated working-tree changes. Record the initial status and review the
  path-limited diff after every phase.
- Keep all three routes usable after every commit-sized unit of work. Do not leave a
  controller half-migrated between direct and worker execution.
- Treat cancellation, supersession, suspension, capability demotion, and route
  disposal as normal control flow. They must not create user-facing errors or noisy
  console warnings.
- Keep the last valid evidence visible during updates. Never substitute an empty
  skeleton for a valid committed result.
- Do not lower numerical or performance ceilings to make a test pass. Investigate
  the regression or stop the phase.
- Do not commit traces, screenshots, videos, generated `dist/`, browser profiles, or
  temporary benchmark artefacts.
- Update generated PDFs only after their Markdown sources and measured claims have
  passed review.
- Do not implement deferred task 4, the complete no-WebGL analytical equivalent.
- Do not implement deferred task 5, hosted multi-browser production parity and
  resilience CI. Local build and browser gates required by this tranche remain in
  scope.
- Stop if the raw WebGL2 solver cannot match the existing GPU solver within the
  approved parity limits. Do not put Three.js back into the core bundle as a quiet
  workaround.

## Architectural clarification discovered during planning

The specification requires a first usable top-down field that does not wait for
Three.js. The current `GpuHeatSim` imports rendering primitives from
`three-runtime.ts`, so extracting only the visual relief layer would leave the full
Three runtime in the analytical core whenever tier 2 selects `gpu-webgl2`.

Task 3 therefore includes a narrow, parity-gated refactor of the existing ping-pong
solver from Three wrappers to raw WebGL2 objects. It preserves:

- the existing vertex and fragment shader equations;
- float render-target capability requirements;
- initial equilibrium seeding;
- step order and `stableDt()` use;
- temperature readback and statistics;
- the `HeatSim` behavioural contract;
- one detached simulation context, independent from MapLibre's display context.

This is dependency removal, not a new backend or model. During migration the old
Three-backed implementation remains available only as a test oracle. It is deleted
after browser parity passes.

## Target file map

The final names may vary if implementation reveals a cleaner seam, but these
responsibilities must remain separate.

```text
src/scripts/climate-engine/
  sim-ts.ts                              KEEP canonical CPU kernel
  sim-cooperative.ts                     NEW bounded-slice TypeScript executor
  sim-protocol.ts                        KEEP Explore reset/advance protocol
  sim-host.ts                            EDIT CPU/GPU host imports and injection
  sim-gpu.ts                             EDIT or REPLACE with raw WebGL2 solver
  sim-gpu-three-oracle.ts                TEMP migration oracle; DELETE before final

  compare/
    paired-protocol.ts                   NEW job/progress/wire contracts
    paired-core.ts                       NEW DOM-free paired orchestration
    paired-job-coordinator.ts            NEW latest-only queue + cache owner
    paired-worker.ts                     NEW thin module-worker entry
    paired-client.ts                     NEW worker client + cooperative fallback
    paired-runner.ts                     EDIT compatibility/direct test facade
    paired-controller.ts                 EDIT client, pending, retry, evidence
    paired-brief.ts                      EDIT one-shot paired client
    bootstrap.ts                         NEW small route bootstrap
    brief-bootstrap.ts                   NEW small Brief bootstrap

  explore/
    runtime-budget.ts                    NEW pure budget reducer
    frame-scheduler.ts                   NEW reason-based on-demand scheduler
    runtime-signals.ts                   NEW visibility/intersection adapter
    core-field-layer.ts                  NEW MapLibre top-down field layer
    relief-contract.ts                   NEW Three-free renderer interface
    relief-renderer.ts                   NEW extracted Three.js relief runtime
    bootstrap.ts                         NEW small Explore route bootstrap
    explore-core.ts                      NEW/EXTRACTED MapLibre/data/control core

  heat-map-app.ts                        SHRINK to compatibility facade or DELETE

src/pages/
  heat-map.astro                         EDIT eager CSS + small bootstrap only
  heat-map/compare.astro                 EDIT small bootstrap only
  heat-map/brief.astro                   EDIT small bootstrap only

src/components/ClimateEngine/
  HeatMapStage.astro                     EDIT boot/runtime states and core canvas
  compare/PairedBench.astro              EDIT busy, retry, backend evidence
  brief/HeatMapBrief.astro               EDIT busy, retry, backend evidence

tests/unit/
  heat-sim-cooperative.test.mjs          NEW slice, parity, cancellation
  heat-paired-protocol.test.mjs          NEW wire validation and asset keys
  heat-paired-core.test.mjs              NEW orchestration/evidence parity
  heat-paired-client.test.mjs            NEW worker lifecycle/fallback/transfer
  heat-paired-coordinator.test.mjs       NEW latest queue and bounded caches
  heat-runtime-budget.test.mjs           NEW state matrix
  heat-frame-scheduler.test.mjs          NEW rAF reason ownership
  heat-core-field-layer.test.mjs         NEW orientation/ramp/update contract
  build-report.test.mjs                  NEW graph parser fixtures if extracted
  build-contracts.test.mjs               EDIT source/module boundary guards
  heat-map-compare.test.mjs              EDIT backend evidence and parity
  heat-sim-protocol.test.mjs             EDIT host split regressions

tests/e2e/
  heat-map-compare.spec.ts               EDIT latest-only and responsive jobs
  heat-map-resilience.spec.ts            EDIT budget, fallback, lifecycle
  heat-map-performance.spec.ts           NEW trace/network/runtime budgets
  runtime-performance.spec.ts            EDIT only shared helper if needed

scripts/
  report-build.mjs                       EDIT dynamic/worker reachability if needed
  lib/module-graph.mjs                   NEW only if parser extraction is clean
  check-heat-route-budgets.mjs           NEW route and graph budget gate
  verify-heat-gpu-parity.mjs             NEW temporary/retained local parity gate

docs/
  heat-map-feature.md                    EDIT shipped ownership and states
  heat-map-adaptive-views-spec.md        EDIT fulfilled budget/request matrix
  heat-map-adaptive-views-implementation.md EDIT measured implementation record
  heat-map-intervention-model.md         EDIT backend evidence only
```

Do not create all files up front. Add each only when its task begins and its test
requires the seam.

---

## Phase 0: freeze the baseline

### Task 0.1: record repository state and existing gates

**Files changed:** none.

- [ ] Record current branch, commit, remote tracking state, and all modified/untracked
  files:

  ```bash
  git status --short --branch
  git rev-parse --short HEAD
  git diff --stat
  ```

- [ ] Confirm which modified heat-map files belong to the completed correctness and
  resilience tranche. Do not overwrite or re-stage them accidentally.
- [ ] Run the fastest existing heat-map gates:

  ```bash
  node --import tsx --test \
    tests/unit/heat-map-compare.test.mjs \
    tests/unit/heat-sim-protocol.test.mjs \
    tests/unit/heat-ward-session.test.mjs \
    tests/unit/heat-map-metrics.test.mjs
  npm run check
  ```

- [ ] If an existing test fails, determine whether it is a known pre-existing
  failure. Do not begin performance refactoring on an unexplained red baseline.

**Exit gate:** current correctness/resilience tests and type checking pass, or every
pre-existing failure is documented and explicitly accepted before implementation.

### Task 0.2: regenerate bundle and route baselines

**Files changed:** build output/report only; do not commit.

- [ ] Run a clean project build through the repository command:

  ```bash
  npm run build
  npm run report:build
  ```

- [ ] Record from `.astro/reports/build-report.json`:

  - `/heat-map/` startup raw/gzip and all-reachable raw/gzip;
  - `/heat-map/compare/` startup raw/gzip;
  - `/heat-map/brief/` startup raw/gzip;
  - Explore page-entry raw/gzip;
  - Three runtime raw/gzip;
  - MapLibre-containing chunk raw/gzip;
  - paired-map-3D lazy chunk raw/gzip;
  - Explore and paired worker chunks;
  - homepage, Team, and CBAM reachable totals as non-regression controls.

- [ ] Verify whether the reporter recognises the current
  `import('./paired-map-3d.ts')` and module-worker URLs. Record any parser blind spot
  before relying on graph categories.
- [ ] Save the figures in implementation notes, not as manually copied constants in
  tests. Budget tests read the generated JSON.

**Exit gate:** a reproducible baseline exists and its measurement limitations are
known.

### Task 0.3: freeze numerical and runtime behaviour

**Files changed:** none; local traces only.

- [ ] Record deterministic paired results for the default peak and retained
  scenarios:

  - both baseline means;
  - both scenario means;
  - cooling;
  - hot-area values/states;
  - all-green contrast;
  - capital and delivered quantities;
  - evidence versions;
  - SHA-256 or a stable numerical digest of both scenario fields.

- [ ] Use the existing `TsHeatSim` direct runner as the oracle. Do not make UI text a
  numerical fixture.
- [ ] Capture one Compare performance trace while changing a coverage slider during
  an active solve. Record long tasks and input-to-next-paint.
- [ ] Capture one Explore trace for 10 seconds in each state:

  - visible and idle;
  - pointer interaction;
  - fully offscreen;
  - document hidden where the browser permits recording;
  - reduced motion.

- [ ] Record application-created frame/repaint and simulation-advance behaviour by
  source where possible. The current expectation is that orbit, drag, and simulation
  loops continue scheduling while idle.

**Stop condition:** the baseline field or evidence cannot be reproduced
deterministically. Resolve that before moving execution between threads.

---

## Phase 1: task 1, move Compare and Brief to a cancellable paired worker

### Task 1.1: pin cooperative solver parity with failing tests

**Files:**

- Create: `tests/unit/heat-sim-cooperative.test.mjs`
- Read only: `src/scripts/climate-engine/sim-ts.ts`

- [ ] Build deterministic canonical-grid fixtures for:

  - all-green uniform cells;
  - mixed built/vegetation/water cells;
  - peak forcing;
  - retained forcing with non-zero storage.

- [ ] Run each fixture directly for exactly `RESET_BURST` steps and retain field and
  statistics as the in-test oracle.
- [ ] Add failing expectations for `runTsFieldCooperatively()` using injected
  `now()`, `yieldControl()`, and `isCancelled()` functions.
- [ ] Assert:

  - exactly 600 total steps;
  - no slice exceeds 48 steps;
  - a yield occurs between bounded slices;
  - the field and statistics equal the direct runner within existing CPU tolerance;
  - the solver is disposed on success and cancellation;
  - cancellation before start, mid-run, and before output copy produces the typed
    cancellation result;
  - no partial field/statistics are returned after cancellation.

- [ ] Confirm the tests fail because the module/API is absent.

```bash
node --import tsx --test tests/unit/heat-sim-cooperative.test.mjs
```

### Task 1.2: implement the bounded-slice executor

**Files:**

- Create: `src/scripts/climate-engine/sim-cooperative.ts`
- Edit: `tests/unit/heat-sim-cooperative.test.mjs`

- [ ] Add a typed `SimulationCancelled` error or result guard whose only public
  semantic is `AbortError`/superseded control flow.
- [ ] Implement a task-queue yield helper:

  1. use `globalThis.scheduler?.yield()` when available;
  2. otherwise use `MessageChannel` where available;
  3. otherwise use `setTimeout(resolve, 0)`.

- [ ] Do not use `await Promise.resolve()` as the yield. It cannot process a worker
  `message` task while the current task remains active.
- [ ] In each slice, stop when either 48 steps or 8 ms of injected monotonic time is
  reached.
- [ ] Check cancellation before the first step, after every slice, and before copying
  the field.
- [ ] Dispose in `finally` so exceptions cannot retain large typed arrays.
- [ ] Keep `TsHeatSim`, shader equations, `stableDt`, and `RESET_BURST` unchanged.
- [ ] Add tests for a thrown solver/yield error and prove disposal still occurs.

```bash
node --import tsx --test tests/unit/heat-sim-cooperative.test.mjs
```

**Stop condition:** sliced execution changes the direct CPU result outside the
existing floating-point tolerance.

### Task 1.3: define and validate the paired wire protocol

**Files:**

- Create: `src/scripts/climate-engine/compare/paired-protocol.ts`
- Create: `tests/unit/heat-paired-protocol.test.mjs`

- [ ] Define discriminated unions for `run`, `cancel`, `dispose`, `progress`,
  `result`, `cancelled`, and `failure`.
- [ ] Carry both `requestId` and `generation` on every job-owned message.
- [ ] Define the five approved progress stages exactly as the spec states.
- [ ] Define `PairedBackendVersion` as:

  ```ts
  'ts-worker-v1' | 'ts-main-cooperative-v1'
  ```

- [ ] Define versioned `WardRenderAssetKey` and helpers. The key must include ward ID
  and data version; grid/model versions belong to prepared/baseline cache keys.
- [ ] Define a wire result that can omit already-known render assets but can never
  omit either field, either metric result, forcing, or evidence.
- [ ] Add pure assertions for:

  - distinct wards;
  - canonical grid/version;
  - two complete fields of canonical length;
  - matching forcing/grid/model/metrics evidence across the pair;
  - asset key and payload identity;
  - finite evaluated metrics;
  - valid not-evaluated states.

- [ ] User-facing failure messages remain generic. Failure codes retain diagnostic
  specificity for tests and development logging.

```bash
node --import tsx --test tests/unit/heat-paired-protocol.test.mjs
```

### Task 1.4: extract a DOM-free paired core without changing results

**Files:**

- Create: `src/scripts/climate-engine/compare/paired-core.ts`
- Create: `tests/unit/heat-paired-core.test.mjs`
- Edit: `src/scripts/climate-engine/compare/paired-runner.ts`
- Edit: `tests/unit/heat-map-compare.test.mjs`

- [ ] Move data loading, base rasterisation, spatial preparation, baseline/scenario
  assembly, metrics, cost, delivered quantities, and evidence construction out of
  `paired-runner.ts` into a DOM-free core.
- [ ] Inject the following responsibilities rather than importing browser globals:

  ```ts
  interface PairedCoreDependencies {
    loadWardBundle(id: WardId, signal?: AbortSignal): Promise<LoadedWardBundle>;
    prepareWard(bundle: LoadedWardBundle): PreparedPairedWard;
    runField(request: CooperativeFieldRequest): Promise<CooperativeFieldResult>;
    nowIso(): string;
    reportStage(stage: PairedJobStage): void;
    isCancelled(): boolean;
  }
  ```

- [ ] Load ward A and ward B bundles in parallel.
- [ ] Run field solves sequentially in this order unless profiling proves another
  order materially improves cancellation:

  1. ward A baseline if not cached;
  2. ward B baseline if not cached;
  3. ward A scenario;
  4. ward B scenario.

- [ ] Cache only baseline statistics, not baseline fields, because the public result
  does not render baseline fields.
- [ ] Preserve atomic evidence validation before returning.
- [ ] Keep `paired-runner.ts` as a small direct/cooperative compatibility facade for
  Node tests until both browser consumers migrate. Do not leave duplicate metric
  equations in it.
- [ ] Compare the new core against Phase 0 fixtures and assert every metric, field,
  cost, quantity, and evidence value remains unchanged except the explicit backend
  execution value.

```bash
node --import tsx --test \
  tests/unit/heat-paired-core.test.mjs \
  tests/unit/heat-map-compare.test.mjs
```

### Task 1.5: implement the latest-only coordinator and bounded caches

**Files:**

- Create: `src/scripts/climate-engine/compare/paired-job-coordinator.ts`
- Create: `tests/unit/heat-paired-coordinator.test.mjs`

- [ ] Keep coordination independent from `DedicatedWorkerGlobalScope` so it can be
  unit-tested with fake jobs and yields.
- [ ] Model exactly:

  - one active job;
  - zero or one latest pending job;
  - an abort controller for in-flight fetches;
  - a cancellation token checked by cooperative computation;
  - one terminal response per accepted request.

- [ ] When a new run arrives:

  - replace any older pending job;
  - abort active fetches;
  - mark active compute cancelled;
  - begin the latest pending job after active cleanup.

- [ ] Add versioned caches for loaded assets, prepared ward state, and baseline
  statistics.
- [ ] Bound structural caches to three wards through an explicit LRU or the complete
  shipped ward catalogue, whichever is smaller.
- [ ] Never cache scenario fields or arbitrary coverage states.
- [ ] Clear caches and cancel active/pending jobs on `dispose()`.
- [ ] Test rapid states A → B → C → D and prove only A may already be active and D
  may start next. B and C never execute.
- [ ] Test cancellation while fetching and while solving.
- [ ] Test version changes miss the correct cache and cannot mix assets.
- [ ] Test a failure clears active ownership and allows a later job.

```bash
node --import tsx --test tests/unit/heat-paired-coordinator.test.mjs
```

### Task 1.6: add the worker entry and browser client

**Files:**

- Create: `src/scripts/climate-engine/compare/paired-worker.ts`
- Create: `src/scripts/climate-engine/compare/paired-client.ts`
- Create: `tests/unit/heat-paired-client.test.mjs`

- [ ] Make `paired-worker.ts` a thin adapter:

  - validate incoming messages;
  - forward them to the coordinator;
  - post progress/terminal messages;
  - transfer the two field buffers;
  - include render assets only when the client did not declare their keys;
  - close cleanly on dispose.

- [ ] Implement `PairedScenarioClient` with injected `WorkerLike` and cooperative
  fallback factories.
- [ ] The default worker construction is local and static:

  ```ts
  new Worker(new URL('./paired-worker.ts', import.meta.url), { type: 'module' })
  ```

- [ ] The client owns:

  - monotonically increasing request IDs/generations;
  - one active promise;
  - `AbortSignal` integration;
  - client-side render-asset cache;
  - field/asset reassembly into `PairedResult`;
  - one-way demotion to the cooperative host;
  - idempotent disposal.

- [ ] A worker construction/runtime failure may demote once. It may not continually
  recreate workers.
- [ ] Cancellation rejects or resolves through the established `AbortError` path and
  never invokes the failure callback.
- [ ] Verify transfer lists contain both field buffers and that client-held render
  assets remain attached.
- [ ] Verify an asset is sent once, reused for coverage changes, and resent after a
  version/key mismatch.
- [ ] Verify disposal removes listeners, terminates the worker, rejects pending work,
  and ignores late messages.

```bash
node --import tsx --test \
  tests/unit/heat-paired-client.test.mjs \
  tests/unit/heat-paired-coordinator.test.mjs \
  tests/unit/heat-paired-protocol.test.mjs
```

### Task 1.7: migrate Compare atomically

**Files:**

- Edit: `src/scripts/climate-engine/compare/paired-controller.ts`
- Edit: `src/components/ClimateEngine/compare/PairedBench.astro`
- Edit: `tests/e2e/heat-map-compare.spec.ts`

- [ ] Construct exactly one `PairedScenarioClient` per `mountPairedBench()`.
- [ ] Replace direct `runPairedScenario()` calls with `client.run(state, signal)`.
- [ ] Retain the existing 160 ms coverage debounce unless interaction traces justify
  a smaller value. Worker cancellation does not make infinite starts desirable.
- [ ] Preserve the controller's generation check as the final commit barrier.
- [ ] While updating:

  - keep both existing fields and all evidence visible;
  - set `aria-busy="true"` and `data-pending="true"` on the root;
  - set the visible status once to `Updating comparison…`;
  - allow controls to schedule a newer state;
  - do not reinitialise the 3D observatory.

- [ ] On the first run, use `Running the canonical paired model…` rather than copy
  that implies a result already exists.
- [ ] Announce only initial start, settled, genuine error, and retry result. Progress
  stage changes may update a non-live diagnostic attribute but not the live region.
- [ ] Add a real retry button inline with the status. Do not introduce a modal.
- [ ] Print `ts-worker-v1` or `ts-main-cooperative-v1` in the integrity/evidence block
  with concise explanatory copy.
- [ ] Keep `applyResult()` atomic. Do not let progress or worker messages render an
  individual ward.
- [ ] Dispose the client before Canvas/Three resources during Astro teardown so no
  result can race into released canvases.

Focused browser assertions:

- [ ] A valid previous result remains visible during a coverage update.
- [ ] `aria-busy` is true only while the current generation is pending.
- [ ] Five rapid slider inputs settle only the final URL/value.
- [ ] Phase/ward changes supersede active calculation without mixed evidence.
- [ ] Genuine worker failure keeps the previous result and exposes retry.
- [ ] 3D camera state survives a paired data update.

```bash
npm run build
npx playwright test tests/e2e/heat-map-compare.spec.ts
```

### Task 1.8: migrate Brief through the same client

**Files:**

- Edit: `src/scripts/climate-engine/compare/paired-brief.ts`
- Edit: `src/components/ClimateEngine/brief/HeatMapBrief.astro`
- Edit: `tests/e2e/heat-map-compare.spec.ts`

- [ ] Construct the same `PairedScenarioClient` implementation, not a second worker
  wrapper.
- [ ] Run exactly one paired job for the parsed URL state.
- [ ] Bind the backend evidence value into the printable integrity section.
- [ ] Keep the status `aria-busy` until the complete pair commits.
- [ ] On success, terminate the worker after all field/asset data needed for the
  brief is copied and rendered. Brief has no reason to retain an idle worker.
- [ ] On failure, render no placeholder numbers and expose inline retry.
- [ ] If retry succeeds, terminate again after settlement.
- [ ] Verify printing does not race worker termination or hide evidence.

```bash
npm run build
npx playwright test tests/e2e/heat-map-compare.spec.ts
```

### Task 1.9: prove interaction continuity and worker ownership

**Files:**

- Create or edit: `tests/e2e/heat-map-performance.spec.ts`
- Edit: `tests/e2e/heat-map-compare.spec.ts`

- [ ] Add a test-only worker delay/cooperative fixture through dependency injection or
  same-origin test asset timing. Do not add a public `_test` route.
- [ ] During an active paired run, schedule a main-thread heartbeat and interact with
  controls/scroll. Assert:

  - no calculation-attributable task reaches 50 ms;
  - slider input reaches the next paint within the 50 ms reference budget;
  - the page remains scrollable;
  - only the final generation settles.

- [ ] Block worker construction before route boot and verify the cooperative fallback
  settles with `ts-main-cooperative-v1` and the same results.
- [ ] Navigate away during each progress stage and verify no page error, worker leak,
  late DOM mutation, or status announcement.
- [ ] Inspect the built Compare and Brief route graph. `sim-ts`, raster/model core,
  and `paired-worker` must not be static startup dependencies.

Focused gate:

```bash
node --import tsx --test \
  tests/unit/heat-sim-cooperative.test.mjs \
  tests/unit/heat-paired-*.test.mjs \
  tests/unit/heat-map-compare.test.mjs
npm run check
npm run build
npx playwright test \
  tests/e2e/heat-map-compare.spec.ts \
  tests/e2e/heat-map-performance.spec.ts
```

**Phase 1 stop conditions:** numerical/field parity changes; an obsolete job commits;
the fallback creates a ≥50 ms main-thread task; assets are cloned on every slider
change; Compare and Brief use different calculation paths; or a route swap leaks a
worker.

**Suggested commits:**

1. `refactor(heat-map): add cooperative paired simulation core`
2. `feat(heat-map): run compare and brief in a cancellable worker`
3. `test(heat-map): prove paired worker responsiveness and ownership`

---

## Phase 2: task 2, budget Explore runtime work

### Task 2.1: pin the pure runtime-budget matrix

**Files:**

- Create: `src/scripts/climate-engine/explore/runtime-budget.ts`
- Create: `tests/unit/heat-runtime-budget.test.mjs`

- [ ] Write reducer tests before implementation for every approved matrix row:

  - tier 2 visible relief;
  - tier 1 visible relief;
  - tier 0/isotherm;
  - active pointer/wheel/keyboard interaction;
  - 250 ms post-interaction quiet period;
  - reduced motion;
  - fully offscreen after grace;
  - hidden document;
  - resume;
  - disposal.

- [ ] Inject monotonic time. Do not read `performance.now()` inside the pure reducer.
- [ ] Assert exact outputs for presentation FPS, ambient permission, simulation
  permission/cadence, and repaint permission.
- [ ] Assert reduced motion overrides tier and hidden/offscreen overrides every
  active visual policy.
- [ ] Assert resume produces no elapsed-time step debt.
- [ ] Assert disposal is terminal.

```bash
node --import tsx --test tests/unit/heat-runtime-budget.test.mjs
```

### Task 2.2: implement a reason-owned frame scheduler

**Files:**

- Create: `src/scripts/climate-engine/explore/frame-scheduler.ts`
- Create: `tests/unit/heat-frame-scheduler.test.mjs`

- [ ] Inject `requestAnimationFrame`, `cancelAnimationFrame`, time, and frame callback
  so Node tests need no DOM.
- [ ] Represent reasons as a set/bitmask using the approved names:

  ```text
  pointer, inertia, camera-transition, grow-transition, ambient-orbit,
  ambient-cloud, field-upload, resize
  ```

- [ ] `request(reason)` queues at most one browser frame.
- [ ] A frame receives the current reasons and returns which continuous reasons
  remain.
- [ ] One-shot reasons clear after consumption.
- [ ] Suspension cancels a queued frame and retains only the latest required
  invalidation.
- [ ] Resume queues one frame, not one frame per previously active reason.
- [ ] Disposal cancels and prevents future requests.
- [ ] Tier 1 frame throttling is based on last presented time; pointer deltas may
  still accumulate between presentations.
- [ ] Test re-entrant requests from the frame callback and prove they cannot create
  two concurrent rAFs.

```bash
node --import tsx --test tests/unit/heat-frame-scheduler.test.mjs
```

### Task 2.3: add document/intersection runtime signals

**Files:**

- Create: `src/scripts/climate-engine/explore/runtime-signals.ts`
- Edit: `tests/unit/heat-runtime-budget.test.mjs`
- Edit later integration target: `src/scripts/climate-engine/heat-map-app.ts`

- [ ] Wrap `visibilitychange`, `IntersectionObserver`, the 250 ms offscreen grace,
  and disposal behind a small callback contract.
- [ ] Observe the complete Explore stage root, not the MapLibre canvas alone.
- [ ] Hidden document updates synchronously; zero intersection starts the grace
  timer; positive intersection cancels it.
- [ ] If `IntersectionObserver` is unavailable, assume intersecting and still honour
  visibility.
- [ ] Do not expose visibility/offscreen state through a live region.
- [ ] Unit-test observer absence, threshold jitter, hidden during grace, resume, and
  disposal with fake observers/timers.

### Task 2.4: replace perpetual drag and orbit loops

**Files:**

- Edit: `src/scripts/climate-engine/heat-map-app.ts`
- Edit: `tests/e2e/heat-map-resilience.spec.ts`

- [ ] Integrate one budget instance and one frame scheduler without changing module
  boundaries yet. Phase 2 proves behaviour before Phase 3 moves code.
- [ ] Delete the perpetual `dragFrame()` self-scheduling loop.
- [ ] Pointer moves continue accumulating one delta object; request the `pointer`
  reason once.
- [ ] On pointer release, request `inertia` only when velocity exceeds the existing
  threshold. Stop requesting when it falls below the threshold.
- [ ] Delete the perpetual `orbitFrame()` self-scheduling loop.
- [ ] Activate `ambient-orbit` only when mode, tier, motion preference, visibility,
  intersection, and the existing 2.5 s quiet delay allow it.
- [ ] Compass reset and explicit map transitions use `camera-transition` or
  MapLibre's own event lifecycle; they do not re-arm ambient work early.
- [ ] Keep current drag direction, pan button mapping, pitch bounds, inertia decay,
  compass synchronisation, keyboard interaction, and click-vs-drag slop.
- [ ] Add regression tests for keyboard camera control and building selection after
  the scheduler conversion.

### Task 2.5: replace frame-count simulation polling with a command cadence

**Files:**

- Edit: `src/scripts/climate-engine/heat-map-app.ts`
- Edit: `src/scripts/climate-engine/sim-host.ts` only if a coalescing hook is needed
- Edit: `tests/unit/heat-sim-protocol.test.mjs`
- Edit: `tests/e2e/heat-map-resilience.spec.ts`

- [ ] Remove the self-scheduling `simFrame()` and `++frame % 40` polling contract.
- [ ] Keep the existing 80-step advance size.
- [ ] Dispatch advances from a budget-approved timeout/deadline:

  - tier 2 no faster than the current effective cadence;
  - tier 1 at most once per second;
  - tier 0 at most once per two seconds only if animated isotherm remains explicitly
    approved;
  - reduced motion, interaction, offscreen, and hidden states dispatch none.

- [ ] Preserve `WorkerHeatSimHost`'s one-advance-in-flight coalescing. Add a guard so
  a due tick never becomes queued step debt.
- [ ] A current reset may finish while suspended, but no follow-up advance dispatches.
- [ ] Split snapshots into:

  - `settledSnapshot`, the 600-step analytical result that owns readouts/evidence;
  - `visualSnapshot`, the latest optional field used by heat textures/probes.

- [ ] Call `refreshStats()` only for a current reset. An advance may call
  `bridgeField()` but may not rewrite committed mean, peak, hot-area, all-green
  contrast, cost, or shared state.
- [ ] Add tests proving ten visual advances do not change the settled DOM values.

**Stop condition:** pausing/resuming changes the settled scenario result or creates a
burst of accumulated advances.

### Task 2.6: move grow, clouds, and water onto budgeted visual time

**Files:**

- Edit: `src/scripts/climate-engine/heat-map-app.ts`
- Edit only if required: `src/scripts/climate-engine/cloud-layer.ts`
- Edit only if required: `src/scripts/climate-engine/water-layer.ts`
- Edit: `tests/unit/heat-map-cloud.test.mjs`
- Edit: `tests/unit/heat-map-water.test.mjs`

- [ ] Replace direct `performance.now()` reads in the custom render path with a
  scheduler-owned `BudgetedVisualFrame` time.
- [ ] Exclude hidden/offscreen duration from visual time.
- [ ] `grow-transition` exists only until `growU` reaches 1, then clears.
- [ ] `ambient-cloud` exists only with a loaded cloud layer, relief mode, measured
  live conditions, wind above the existing zero threshold, and budget permission.
- [ ] Water time advances only when a visible render already occurs or an approved
  ambient reason requests one.
- [ ] Tier 0 and reduced motion hold still frames.
- [ ] Remove the custom layer's unconditional self-sustaining
  `map.triggerRepaint()` path. Repaint is requested by the central scheduler only
  when output changed.
- [ ] Verify field upload, environment tint, ward commit, and resize still request a
  one-shot repaint.

### Task 2.7: expose restrained runtime states and test diagnostics

**Files:**

- Edit: `src/components/ClimateEngine/HeatMapStage.astro`
- Edit: `src/scripts/climate-engine/heat-map-app.ts`
- Edit: `tests/e2e/heat-map-resilience.spec.ts`
- Edit: `tests/e2e/heat-map-performance.spec.ts`

- [ ] Bind approved state attributes on the stage root:

  ```text
  data-runtime="booting|active|interacting|idle|suspended|error"
  data-motion="full|reduced|none"
  data-sim="gpu-webgl2|ts-worker|ts-main|unavailable"
  ```

- [ ] Do not show a banner or live announcement when scrolling merely suspends work.
- [ ] Keep existing backend/load/error text visible and truthful.
- [ ] Add the approved Performance API milestone marks without ward/scenario/GPU
  labels.
- [ ] For E2E diagnostics only, allow `?debug=heat-runtime` to emit namespaced
  `performance.mark()` entries for app frames, repaint requests, and simulation
  commands. The flag creates no global object, sends no network data, and is inert
  without the explicit query.
- [ ] Clear debug marks and all scheduled work on disposal.
- [ ] Verify the debug flag is not linked or advertised in production UI.

### Task 2.8: focused runtime-budget proof

**Files:**

- Edit: `tests/e2e/heat-map-resilience.spec.ts`
- Edit: `tests/e2e/heat-map-performance.spec.ts`

- [ ] Visible idle tier 2 may animate, but owns only one queued frame at a time.
- [ ] Pointer interaction pauses simulation/orbit/cloud and remains responsive.
- [ ] After interaction, simulation waits 250 ms quiet and orbit waits the existing
  2.5 s.
- [ ] Fully offscreen reaches zero app frame/repaint/advance marks after the grace
  period.
- [ ] Returning onscreen produces one invalidation and no compute burst.
- [ ] Hidden/show resets visual time and does not jump grow/cloud/water state.
- [ ] Reduced motion produces one settled reset and no ambient marks.
- [ ] Tier 1 presents no more than 30 app frames/second.
- [ ] Tier 0 has no ambient source.
- [ ] Astro navigation away/back produces one budget, one observer, and one scheduler
  per mount with clean disposal.
- [ ] Settled values remain byte-for-byte text-stable while visual fields advance.

Focused gate:

```bash
node --import tsx --test \
  tests/unit/heat-runtime-budget.test.mjs \
  tests/unit/heat-frame-scheduler.test.mjs \
  tests/unit/heat-sim-protocol.test.mjs \
  tests/unit/heat-map-cloud.test.mjs \
  tests/unit/heat-map-water.test.mjs
npm run check
npm run build
npx playwright test \
  tests/e2e/heat-map-resilience.spec.ts \
  tests/e2e/heat-map-performance.spec.ts
```

**Phase 2 stop conditions:** any independent perpetual Explore loop remains; hidden
or reduced-motion sessions continue ambient work; input handling becomes less
responsive; resume accumulates time/steps; settled evidence drifts; or route disposal
leaks a scheduler/observer/timer.

**Suggested commits:**

1. `refactor(heat-map): add explicit explore runtime budget`
2. `perf(heat-map): replace perpetual loops with scheduled work`
3. `test(heat-map): prove suspension and stable settled evidence`

---

## Phase 3: task 3, split heavy startup and optional rendering

### Task 3.1: make the build report trustworthy before enforcing budgets

**Files:**

- Edit: `scripts/report-build.mjs`
- Create if useful: `scripts/lib/module-graph.mjs`
- Create: `tests/unit/build-report.test.mjs`
- Edit: `tests/unit/build-contracts.test.mjs`

- [ ] Extract or expose the module-reference parser behind a pure function.
- [ ] Add minified fixture coverage for:

  - static ESM imports;
  - plain dynamic `import()`;
  - Vite/Rolldown `__vitePreload(() => import(...))` output;
  - module-worker `new Worker(new URL(..., import.meta.url))` references;
  - public JavaScript loaded by URL;
  - imports containing hashed names and relative paths.

- [ ] Distinguish startup static reachability, lazy dynamic reachability, and worker
  reachability. Worker assets are not startup modules merely because a source URL is
  discoverable.
- [ ] Keep existing report fields compatible where possible. Add a schema version
  bump only if output semantics change.
- [ ] Rebuild the current app and verify the existing paired 3D dynamic import and
  simulation worker appear in the correct categories.
- [ ] Do not begin bundle optimisation until the reporter can see the intended split.

```bash
node --import tsx --test tests/unit/build-report.test.mjs tests/unit/build-contracts.test.mjs
npm run build
npm run report:build
```

### Task 3.2: remove Three.js from the GPU analytical solver

**Files:**

- Temporarily move/copy current implementation to:
  `src/scripts/climate-engine/sim-gpu-three-oracle.ts`
- Edit or replace: `src/scripts/climate-engine/sim-gpu.ts`
- Edit: `src/scripts/climate-engine/sim-host.ts`
- Create or edit: `scripts/verify-heat-gpu-parity.mjs`
- Edit: `tests/unit/heat-sim-protocol.test.mjs`

- [ ] Preserve the existing GLSL strings verbatim first. Any later shader cleanup is
  out of scope.
- [ ] Implement the minimum raw WebGL2 resources:

  - one detached canvas/context;
  - compiled fullscreen vertex/fragment programmes;
  - one vertex buffer/VAO;
  - layers texture;
  - seed texture;
  - two `RGBA32F` ping-pong textures/framebuffers;
  - uniform locations;
  - `readPixels` buffer;
  - explicit deletion/disposal.

- [ ] Require WebGL2 plus `EXT_color_buffer_float`, matching capability detection.
- [ ] Seed both targets from the same `equilibriumC()` values and preserve all layer
  packing/channel orientation.
- [ ] Restore the prior framebuffer/program/viewport state only within the detached
  context as necessary. Do not share MapLibre's context.
- [ ] Keep the public behavioural methods `reset`, `setParams`, `step`,
  `temperature`, `stats`, and `dispose`.
- [ ] Change `GpuHeatSimHost` to depend on a small GPU-solver factory instead of a
  Three `WebGLRenderer`.
- [ ] Attach context-loss handling to the detached canvas and preserve one-way
  demotion to the worker host.
- [ ] Run old and new GPU implementations in the same capable browser fixtures for
  peak/retained and uniform/mixed layers.
- [ ] Enforce the existing cross-backend limits, and prefer exact old-vs-new GPU
  equality where driver behaviour permits:

  ```text
  |meanNew − meanOld| <= 0.02 °C
  |peakNew − peakOld| <= 0.05 °C
  RMSE(fieldNew, fieldOld) <= 0.03 °C
  |hotAreaNew − hotAreaOld| <= 0.1 percentage points
  ```

- [ ] Verify CPU parity remains inside the same published limits.
- [ ] If the environment lacks float targets, name the GPU case as an environment
  skip; CPU/protocol tests still run.
- [ ] After parity passes on capable hardware, delete
  `sim-gpu-three-oracle.ts` and prove no analytical-core import reaches
  `three-runtime.ts`.

**Stop condition:** parity cannot be demonstrated on capable hardware. Keep the old
solver, stop Phase 3, and revisit the specification rather than weakening the
dependency boundary.

### Task 3.3: introduce small Astro route bootstraps

**Files:**

- Create: `src/scripts/climate-engine/explore/bootstrap.ts`
- Create: `src/scripts/climate-engine/compare/bootstrap.ts`
- Create: `src/scripts/climate-engine/compare/brief-bootstrap.ts`
- Edit: `src/pages/heat-map.astro`
- Edit: `src/pages/heat-map/compare.astro`
- Edit: `src/pages/heat-map/brief.astro`
- Edit: `tests/unit/build-contracts.test.mjs`

- [ ] Each page statically imports only its small bootstrap.
- [ ] Each bootstrap owns one mount generation, Astro page-load/before-swap
  listeners, dynamic controller import, and late-import disposal.
- [ ] Explore:

  - mark the server shell booting;
  - yield one animation frame for first paint;
  - resolve document/intersection eligibility;
  - dynamically import the core when visible;
  - do not wait for `requestIdleCallback` when the stage is on screen.

- [ ] Compare and Brief dynamically import their controller/client surface after the
  shell paint. Their workers still instantiate only when the first job starts.
- [ ] A navigation before dynamic import resolution invalidates that mount. The
  module may enter browser cache but cannot mount into the departed document.
- [ ] Avoid duplicate page-load listeners across soft navigation.
- [ ] Add source guards that page scripts no longer statically import
  `heat-map-app`, `paired-controller`, or `paired-brief`.
- [ ] Rebuild and confirm route startup drops before deeper splitting. Do not claim
  first-field improvement yet.

### Task 3.4: create the MapLibre core field layer

**Files:**

- Create: `src/scripts/climate-engine/explore/core-field-layer.ts`
- Create: `tests/unit/heat-core-field-layer.test.mjs`
- Edit: `src/scripts/climate-engine/ward-frame.ts` only if corner conversion belongs
  there
- Edit: `src/components/ClimateEngine/HeatMapStage.astro`
- Edit: `src/pages/heat-map.astro` to make MapLibre CSS eager if required

- [ ] Move `maplibre-gl/dist/maplibre-gl.css` to an eager route/component CSS import
  so dynamic JavaScript does not create an unstyled map-control flash.
- [ ] Implement a non-animated MapLibre canvas/image source for the canonical field:

  - one 192×192 presentation canvas;
  - the same heat ramp bounds and colour function used by relief;
  - north-up ward corner coordinates derived from the shared ward frame;
  - explicit alpha/opacity;
  - update without replacing the source on every snapshot;
  - idempotent style rehydration;
  - show/hide and dispose methods.

- [ ] The layer is a top-down analytical field, not the deferred no-WebGL fallback.
  MapLibre/WebGL remains required in this tranche.
- [ ] Unit-test colour endpoints, finite values, north/south/east/west orientation,
  coordinate order, rehydration, update reuse, and disposal.
- [ ] Compare the top-down core field with the existing relief top view using the
  same deterministic field. Reject mirror/rotation/channel swaps.
- [ ] Keep the core layer visible until relief has rendered one complete frame.

```bash
node --import tsx --test tests/unit/heat-core-field-layer.test.mjs
```

### Task 3.5: extract a Three-free Explore core and a relief renderer

**Files:**

- Create: `src/scripts/climate-engine/explore/relief-contract.ts`
- Create: `src/scripts/climate-engine/explore/relief-renderer.ts`
- Create/extract: `src/scripts/climate-engine/explore/explore-core.ts`
- Edit/shrink: `src/scripts/climate-engine/heat-map-app.ts`
- Edit as imports move: relief-specific layer modules
- Edit: `tests/unit/build-contracts.test.mjs`

- [ ] Define `relief-contract.ts` using platform/project types only. It must have no
  runtime Three import and no Three type in its public shape.
- [ ] Move these responsibilities into `relief-renderer.ts`:

  - Three custom layer/renderer/scene/camera;
  - terrain-displaced heat mesh;
  - buildings/facades;
  - roads and water;
  - clouds and lighting;
  - building registry/picking/projection;
  - relief-only uniforms and resource disposal.

- [ ] Keep these responsibilities in `explore-core.ts`:

  - MapLibre construction/style lifecycle;
  - URL/DOM/control state;
  - capability and runtime budget;
  - ward request/session ownership;
  - data preparation and analytical state;
  - simulation host selection;
  - settled metrics/evidence;
  - core field layer;
  - relief lifecycle and fallback status.

- [ ] Pass immutable `CommittedWardRenderBundle`, field/ramp, environment, and
  `BudgetedVisualFrame` through the narrow contract. Do not let relief close over
  arbitrary core state.
- [ ] `renderFrame()` returns whether relief needs another frame. It may not create
  its own rAF, interval, or repaint loop.
- [ ] Move all Three runtime imports, `BufferGeometryUtils`, and relief layer runtime
  imports behind the dynamic relief module.
- [ ] Type-only MapLibre imports are allowed in contracts; runtime imports must not
  flow from relief back into non-Explore routes.
- [ ] Keep `heat-map-app.ts` as a temporary re-export of `mountExploreCore()` if tests
  or soft-navigation code still reference it. Delete it only after semantic searches
  prove no consumer remains.
- [ ] Verify selection, compass, controls, style switching, ward transactions,
  clouds, terrain, road labels, and all existing analytical readouts after the move.

**Stop condition:** the extraction changes map orientation, field values, control
semantics, style rehydration, or disposal ownership.

### Task 3.6: gate and hand off the relief enhancement

**Files:**

- Edit: `src/scripts/climate-engine/explore/explore-core.ts`
- Edit: `src/scripts/climate-engine/explore/bootstrap.ts`
- Edit: `src/components/ClimateEngine/HeatMapStage.astro`
- Edit: `tests/e2e/heat-map-resilience.spec.ts`
- Edit: `tests/e2e/heat-map-performance.spec.ts`

- [ ] After MapLibre and the first settled field are ready, decide relief eligibility
  from capability tier, mode, and current mount generation.
- [ ] Tier 0/isotherm never imports relief/Three.
- [ ] For eligible default relief, begin import at the first idle opportunity with a
  750 ms maximum timeout.
- [ ] If the user explicitly chooses Relief before that point, import immediately.
- [ ] While loading, keep the top-down field interactive and show only the restrained
  renderer status `Preparing relief view…`.
- [ ] Prepare relief off the visible path where possible, render one complete frame,
  then cross-fade using opacity only and the existing exponential/ease-out motion
  language.
- [ ] Under reduced motion, swap without animated cross-fade.
- [ ] Preserve camera, field, ward, environment, and selection state through handoff.
- [ ] On import, preparation, or context failure:

  - dispose partial relief resources;
  - restore/retain the core field;
  - set renderer state to `2D map active · relief unavailable`;
  - keep controls and analytical evidence usable;
  - do not retry automatically.

- [ ] If a user explicitly retries Relief, allow one fresh preparation attempt for
  the current module/mount; repeated context failures remain in core mode.
- [ ] A route swap during import/preparation disposes any completed late renderer
  without mounting it.

### Task 3.7: enforce route and graph budgets

**Files:**

- Create: `scripts/check-heat-route-budgets.mjs`
- Edit: `package.json`
- Edit: `tests/unit/build-contracts.test.mjs`
- Edit: `tests/e2e/heat-map-performance.spec.ts`

- [ ] Read `.astro/reports/build-report.json`; fail clearly if the report is missing
  or has an unsupported schema.
- [ ] Enforce:

  ```text
  /heat-map/ startup total       <= 110 KiB gzip
  /heat-map/compare/ startup     <= 78 KiB gzip
  /heat-map/brief/ startup       <= 74 KiB gzip
  Explore core first-usable      <= 325 KiB gzip
  Explore full relief reachable <= regenerated Phase 0 baseline + 10%
  ```

- [ ] Print actual, ceiling, delta, and the largest contributing modules on failure.
- [ ] Add graph assertions:

  - Explore startup has no MapLibre, Three, CPU/GPU solver, or worker execution
    module;
  - Explore core has no Three or relief runtime;
  - Compare/Brief startup has no paired core, raster, or `sim-ts`;
  - Brief cannot reach Compare Canvas or 3D modules;
  - non-heat routes do not gain heat runtime dependencies;
  - exactly one installed Three runtime is emitted.

- [ ] Add `check:heat-budgets` and place it after `report:build` in `npm run verify`
  only after the script passes repeatably.
- [ ] Do not use a broad manual-chunk rule to game reachability. Fix source imports.
- [ ] Browser network tests use generated report/module names to assert:

  - tier 0 requests no Three/relief chunk;
  - Compare Canvas and Brief request no MapLibre;
  - Brief requests no paired 3D;
  - worker chunks are local and requested only when instantiated.

```bash
npm run build
npm run report:build
npm run check:heat-budgets
npx playwright test tests/e2e/heat-map-performance.spec.ts
```

### Task 3.8: measure real milestones and guard startup states

**Files:**

- Edit: `src/scripts/climate-engine/explore/bootstrap.ts`
- Edit: `src/scripts/climate-engine/explore/explore-core.ts`
- Edit: `src/scripts/climate-engine/compare/paired-controller.ts`
- Edit: `src/scripts/climate-engine/compare/paired-brief.ts`
- Edit: `tests/e2e/heat-map-performance.spec.ts`

- [ ] Emit the approved milestone marks exactly once per successful mount/job:

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

- [ ] Marks contain no scenario values, ward IDs, capability labels, or personal
  data.
- [ ] Record three repeatable runs for desktop and mobile profiles:

  - shell to core requested;
  - shell to map ready;
  - shell to first field;
  - first field to relief ready;
  - Compare first settle;
  - Compare warm update settle.

- [ ] Treat timing as recorded evidence in this tranche, not a guessed hard network
  threshold. Keep deterministic byte/main-thread/frame budgets as release blockers.
- [ ] Verify shell/loading copy and `aria-busy` transitions:

  - `Preparing the map…` before core;
  - `Loading the study area…` during data;
  - `Running the canonical model…` during reset;
  - existing settled/backend copy after first field;
  - relief state local to the renderer indicator.

- [ ] Controls with model effects remain disabled or queue only the latest valid
  state before the model is ready. Navigation and caveat content remain usable.
- [ ] No loading state mentions chunks, Web Workers, imports, or bundler internals.

### Task 3.9: focused bundle/startup proof

Run:

```bash
node --import tsx --test \
  tests/unit/build-report.test.mjs \
  tests/unit/build-contracts.test.mjs \
  tests/unit/heat-core-field-layer.test.mjs \
  tests/unit/heat-sim-protocol.test.mjs
npm run check
npm run build
npm run report:build
npm run check:heat-budgets
npx playwright test \
  tests/e2e/heat-map-resilience.spec.ts \
  tests/e2e/heat-map-performance.spec.ts \
  tests/e2e/heat-map-compare.spec.ts
node scripts/verify-heat-gpu-parity.mjs
```

**Phase 3 stop conditions:** Three remains core/startup-reachable; first field waits
for relief; raw GPU parity fails; tier 0 requests Three; route startup exceeds an
approved ceiling; full relief grows by more than 10%; top-down and relief fields are
misaligned; or relief failure erases a valid map/result.

**Suggested commits:**

1. `test(build): make dynamic and worker reachability explicit`
2. `refactor(heat-map): decouple gpu simulation from three`
3. `perf(heat-map): split shell core and relief runtime`
4. `test(heat-map): enforce route and startup budgets`

---

## Release phase: combined audit, documentation, and proof

This release phase verifies tasks 1–3. It is not remaining audit task 4 or 5, both of
which stay deferred.

### Release task R.1: run semantic ownership searches

Review every match manually:

```bash
rg -n "runPairedScenario\(|new TsHeatSim|RESET_BURST" \
  src/scripts/climate-engine/compare src/pages src/components
rg -n "requestAnimationFrame|triggerRepaint|setInterval" \
  src/scripts/climate-engine/heat-map-app.ts \
  src/scripts/climate-engine/explore
rg -n "from 'three'|from \"three\"|three-runtime|BufferGeometryUtils" \
  src/scripts/climate-engine/explore \
  src/scripts/climate-engine/sim-gpu.ts \
  src/scripts/climate-engine/sim-host.ts
rg -n "maplibre-gl" \
  src/pages src/scripts/climate-engine/compare src/scripts/climate-engine/explore
rg -n "data-runtime|data-motion|data-sim|aria-busy|data-pending" \
  src/components/ClimateEngine src/scripts/climate-engine
```

Expected legitimate survivors:

- `TsHeatSim` in the canonical CPU kernel, cooperative executor, Explore worker, and
  paired worker/core only;
- rAF in the central Explore scheduler and the already-budgeted Compare 3D
  observatory;
- `triggerRepaint` in one-shot core/scheduler integration, not a self-sustaining
  custom render loop;
- Three imports in relief and paired 3D modules only, plus unrelated site visuals;
- MapLibre runtime in Explore core only;
- `aria-busy` on true pending roots, removed after the owning generation settles.

### Release task R.2: reconcile documentation and implementation evidence

**Files:**

- Edit: `docs/heat-map-feature.md`
- Edit: `docs/heat-map-adaptive-views-spec.md`
- Edit: `docs/heat-map-adaptive-views-implementation.md`
- Edit: `docs/heat-map-intervention-model.md`
- Update corresponding PDFs only after Markdown review

- [ ] Document the paired worker, cooperative fallback, cancellation, and bounded
  caches.
- [ ] Document that Compare and Brief share one calculation client/core.
- [ ] Document the settled-vs-visual snapshot distinction. Make clear that evidence
  does not change with viewing duration.
- [ ] Document the Explore runtime matrix and which motion/work stops in each state.
- [ ] Document the shell/core/relief module graph and raw WebGL2 analytical solver.
- [ ] Record before/after route bytes from generated reports.
- [ ] Record three timing runs without turning unstable network values into claims.
- [ ] Record worker/fallback and GPU parity results, including hardware/browser and
  explicit capability skips.
- [ ] Preserve current limitations:

  - screening-grade model;
  - no complete no-WebGL analytical equivalent yet;
  - no hosted multi-device parity CI yet;
  - WebGPU remains diagnostic only.

- [ ] Do not rewrite history as though the performance architecture had always been
  worker-owned or progressively loaded.

### Release task R.3: run the full repository gate

Run fastest/highest-signal checks first:

```bash
npm run check
npm run test:unit
npm run build
npm run report:build
npm run check:heat-budgets
npm run check:publication
npm run test:e2e:built
node scripts/verify-heat-gpu-parity.mjs
```

If `verify-heat-gpu-parity` has become a stable named package script, use that command
instead.

### Release task R.4: manual product and accessibility audit

- [ ] Desktop/laptop, tier 2: first core field, relief handoff, GPU simulation,
  interaction, suspension, context loss.
- [ ] Desktop forced CPU: worker execution, latest-only Compare, worker failure and
  cooperative fallback.
- [ ] Tablet/coarse pointer: Explore drag/pan, Compare linked camera, mobile sheet,
  tier 1 cadence.
- [ ] Tier 0: top-down field, no Three request, no ambient work.
- [ ] Reduced motion: still core/relief, one settled result, no cross-fade/ambient
  animation.
- [ ] Keyboard only: controls, camera keys, reset, retry, focus visibility, no focus
  loss during dynamic handoff.
- [ ] Screen reader smoke test: shell, initial pending, settled, update pending with
  prior evidence, genuine error, retry, fallback backend.
- [ ] Slow network: server shell remains legible; core/relief states do not blank or
  reorder evidence.
- [ ] Offline after first result: previous evidence remains; retry state is honest.
- [ ] Astro navigation Explore ↔ Compare ↔ Brief ↔ another route: one mount/worker/
  scheduler/observer, complete disposal, no duplicate live announcements.
- [ ] Print Brief: complete fields/evidence, backend version, no loading controls or
  transient status.

### Release task R.5: final diff and scope audit

- [ ] Review `git diff --check` and path-limited diffs per phase.
- [ ] Confirm no model/data/forcing/metric constant changed.
- [ ] Confirm no canonical grid or settle-step reduction.
- [ ] Confirm no new API, remote service, analytics event, persistent cache, or
  personal-data surface.
- [ ] Confirm no task 4 no-WebGL fallback was smuggled in beyond the explicit failure
  state and MapLibre-backed core field.
- [ ] Confirm no task 5 hosted CI/device matrix was added.
- [ ] Confirm no test/debug route or permanent global hook remains.
- [ ] Confirm temporary GPU oracle, traces, screenshots, and generated build output
  are absent.
- [ ] Confirm no worker, context, observer, frame, timeout, listener, geometry,
  texture, or typed-array ownership leak remains.
- [ ] Summarise for review:

  - files changed;
  - numerical parity evidence;
  - worker cancellation/fallback evidence;
  - runtime-budget evidence;
  - before/after route bytes;
  - timing samples;
  - accessibility/manual checks;
  - explicit remaining tasks 4 and 5.

---

## Rollback boundaries

Each boundary is independently reversible if a later phase fails:

1. **After Phase 1:** the direct paired facade remains a test oracle until Compare
   and Brief pass worker/fallback parity. Reverting route consumers restores the old
   execution location without affecting Explore.
2. **After Phase 2:** runtime budgeting changes scheduling but not the module graph.
   Revert by reason source if one visual feature regresses; do not restore all
   perpetual loops to mask one faulty integration.
3. **Raw GPU migration:** retain the old implementation only until capable-hardware
   parity passes. If parity fails, stop before route splitting and keep the old
   backend; do not ship both implementations.
4. **Bootstrap split:** each route bootstrap can be reverted independently because
   controller public mount/dispose contracts remain stable.
5. **Relief extraction:** the core field is the safety state. A failed relief
   preparation never requires reverting valid analytical/core work at runtime.
6. **Budget enforcement:** thresholds are introduced only after the report accurately
   models dynamic and worker edges. Revert parser bugs, not the approved ceilings.

## Definition of done

### Task 1

- [ ] Compare and Brief use one paired worker client/core by default.
- [ ] A paired job evaluates four canonical 600-step fields on grid 192.
- [ ] One active and one latest pending job is the hard maximum.
- [ ] Superseded computation cancels cooperatively and cannot commit.
- [ ] Main-thread cooperative fallback creates no calculation task ≥50 ms.
- [ ] Structural and baseline caches are versioned/bounded; scenario fields are not
  retained.
- [ ] Field buffers transfer; render assets transfer once per version/client.
- [ ] Worker/fallback results match the direct oracle and evidence contract.
- [ ] Pending/failure keeps the last valid pair visible.

### Task 2

- [ ] Explore has one runtime-budget reducer and one reason-owned frame scheduler.
- [ ] No independent perpetual orbit, drag, simulation, grow, cloud, or water loop
  remains.
- [ ] Interaction pauses optional simulation and ambient motion.
- [ ] Hidden/offscreen/reduced-motion states reach zero ambient app work.
- [ ] Resume produces one repaint and no accumulated step/time burst.
- [ ] Tier 1 caps application presentation at 30 fps; tier 0 is event-driven.
- [ ] Settled evidence is fixed at the 600-step snapshot; optional visual advances do
  not rewrite it.
- [ ] Route disposal is leak-free.

### Task 3

- [ ] The GPU analytical solver no longer imports Three and passes parity.
- [ ] All three heat routes statically load only small bootstraps plus shared Base
  runtime.
- [ ] Server shell paints before MapLibre/Three/worker execution.
- [ ] First usable top-down field does not wait for Three.
- [ ] Relief is a capability-gated dynamic island with clean fallback/disposal.
- [ ] Tier 0 requests no Three; Compare Canvas and Brief request no MapLibre.
- [ ] `/heat-map/` startup is ≤110 KiB gzip.
- [ ] Compare startup is ≤78 KiB gzip; Brief startup is ≤74 KiB gzip.
- [ ] Explore first-usable reachable code is ≤325 KiB gzip.
- [ ] Full relief reachable bytes are no more than Phase 0 baseline +10%.
- [ ] Non-heat routes gain no heat-map dependency.

### Whole tranche

- [ ] Existing model, metric, grid, forcing, cost, delivered-quantity, validation, and
  provenance tests remain green.
- [ ] Type, unit, build, publication, E2E, route-budget, and parity gates pass.
- [ ] Loading, pending, failure, retry, fallback, reduced-motion, focus, keyboard,
  and screen-reader states are verified.
- [ ] Documentation matches measured shipped behaviour and generated PDFs match their
  approved Markdown sources.
- [ ] The final audit identifies tasks 4 and 5 as still deferred.
