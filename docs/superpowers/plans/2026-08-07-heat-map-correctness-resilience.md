# Heat-map correctness and runtime resilience — implementation plan

**Date:** 2026-08-07

**Status:** implementation pending; do not execute until the companion specification is approved

**Goal:** deliver the first three heat-map audit fixes in order: correct the
all-green reference, give Explore a real CPU fallback, then make ward/style loading
generation-safe.

**Contract:**
[`../specs/2026-08-07-heat-map-correctness-resilience-design.md`](../specs/2026-08-07-heat-map-correctness-resilience-design.md)

**Tech stack:** Astro 7, TypeScript, MapLibre GL, Three.js, Web Workers,
`node:test`, Playwright.

## Working rules

- Implement test-first. Every task starts with a reproducer that fails for the
  intended reason.
- Do not change model constants, forcing records, the canonical 192×192 grid,
  DC-URS, accuracy bands, or data artefacts.
- Preserve unrelated and pre-existing working-tree changes.
- Keep the app usable after every task. Do not leave half-migrated sync/async APIs
  between commits.
- An aborted or stale request is normal control flow and must not be logged as an
  application failure.
- Do not “fix” parity by loosening the approved numerical ceilings.
- Do not commit generated screenshots, traces, videos, build output, or local test
  artefacts.
- Run the focused gate after each task and the full repository gate at the end.

## Target file map

```text
src/scripts/climate-engine/
  types.ts                         EDIT metric helper + metric version
  caps.ts                          EDIT executable backend selection
  sim-protocol.ts                  NEW async host/worker contracts
  sim-worker.ts                    NEW worker-owned TsHeatSim
  sim-host.ts                      NEW GPU, worker, emergency hosts
  ward-session.ts                  NEW request-generation state machine
  explore-ward-loader.ts           NEW abort-aware Explore bundle loader
  heat-map-app.ts                  EDIT orchestration and transactional commit
  compare/paired-runner.ts         EDIT metric field + evidence
  compare/paired-controller.ts     EDIT metric binding

src/components/ClimateEngine/
  HeatMapStage.astro               EDIT backend/load/error states
  compare/PairedBench.astro        EDIT metric label + integrity row
  brief/HeatMapBrief.astro         EDIT metric evidence where applicable

tests/unit/
  heat-map-metrics.test.mjs        NEW metric invariants
  heat-map-compare.test.mjs        EDIT capability/result contract
  heat-sim-protocol.test.mjs       NEW worker/host ownership tests
  heat-ward-session.test.mjs       NEW generation state-machine tests
  heat-ward-loader.test.mjs        NEW abort/fallback/cache tests
  heat-map-roads.test.mjs          EDIT style-lifecycle guard

tests/e2e/
  heat-map-resilience.spec.ts      NEW fallback, race, style, disposal tests

scripts/
  verify-heat-backend-parity.mjs   NEW browser parity gate

docs/
  heat-map-feature.md              EDIT backend/metric reality
  heat-map-adaptive-views-spec.md  EDIT fulfilled contracts/terminology
  heat-map-adaptive-views-implementation.md EDIT fulfilled contracts/terminology
```

File names may change only if the implementation exposes a materially cleaner seam;
the responsibilities and test boundaries must remain as specified.

---

## Phase 0 — freeze the baseline

### Task 0.1: record repository and numerical baselines

**Files changed:** none.

- [ ] Record `git status --short`, current branch, and current commit. Identify every
  pre-existing modified/untracked file before editing.
- [ ] Run the focused existing unit suite:

  ```bash
  node --import tsx --test tests/unit/heat-map-compare.test.mjs
  node --import tsx --test tests/unit/heat-map-roads.test.mjs
  ```

- [ ] Run type checking:

  ```bash
  npm run check
  ```

- [ ] Capture the current peak and retained Compare values for the shipped default
  scenario. Save them in implementation notes, not as an unexplained golden fixture.
  Expected interpretation:

  - peak all-green contrast should not change;
  - retained all-green contrast should change only by the corrected reference;
  - means, cooling, hot area, capital, and delivered quantities must not change.

- [ ] Reproduce the runtime defects before changing code:

  1. deny `EXT_color_buffer_float` and observe blank Explore analytical values;
  2. delay an older ward response, select a newer ward, then release the older
     response and observe the stale overwrite;
  3. toggle dark/studio and record ward/network/layer behaviour.

**Exit gate:** baseline commands pass, defects are reproducible, and no repository
file was changed.

---

## Phase 1 — task 1: correct and centralise the all-green reference

### Task 1.1: pin the scientific metric with failing tests

**Files:**

- Create: `tests/unit/heat-map-metrics.test.mjs`
- Edit: `tests/unit/heat-map-compare.test.mjs`

- [ ] Add a peak-phase identity test using `store: 0`:

  ```js
  test('all-green reference delegates to equilibriumC at the declared cell', () => {
    const p = { ...DEFAULT_PARAMS, store: 0 };
    assert.equal(
      allGreenReferenceC(p),
      equilibriumC(p, 0.25, 1, 0),
    );
  });
  ```

- [ ] Add a retained-phase test that constructs the legacy omission explicitly and
  proves the correction:

  ```js
  const legacy = (
    p.S * 0.75 * p.sun - p.L
    + p.kRad * p.tSky + p.h * p.wind * p.tAir
  ) / (p.kRad + p.h * p.wind);

  assert.ok(Math.abs(
    allGreenReferenceC(p) - legacy
    - p.store / (p.kRad + p.h * p.wind)
  ) < 1e-10);
  ```

- [ ] Add tests for `greenReferenceContrastC(mean, params)` and
  `HEAT_METRICS_VERSION === 'heat-metrics-v2'`.
- [ ] Add a Compare test that expects the renamed result field and metric evidence.
- [ ] Add a narrow source guard, with comments stripped, proving the old expanded
  formula no longer lives in `heat-map-app.ts` or `compare/paired-runner.ts`. Match
  the distinctive combined terms, not ordinary words such as `rural` used by DC-URS.
- [ ] Run the tests and confirm they fail because the exports/renamed field do not
  exist—not because of fixture or loader errors.

  ```bash
  node --import tsx --test tests/unit/heat-map-metrics.test.mjs tests/unit/heat-map-compare.test.mjs
  ```

### Task 1.2: add the single equation-level helper

**Files:**

- Edit: `src/scripts/climate-engine/types.ts`

- [ ] Export `ALL_GREEN_REFERENCE` with albedo `0.25`, vegetation `1`, and built `0`.
- [ ] Export `HEAT_METRICS_VERSION = 'heat-metrics-v2'`.
- [ ] Implement `allGreenReferenceC(params)` only by calling `equilibriumC()`.
- [ ] Implement `greenReferenceContrastC(meanC, params)` only by subtracting the
  helper.
- [ ] Extend `assertSimLogic()` with peak and retained identities. Keep these as
  runnable internal assertions in addition to the external test.
- [ ] Explain in the docblock that the value is a synthetic land-cover reference and
  is unrelated to the observed DC-URS rural input.
- [ ] Run the new metric test; the pure helper assertions should now pass while the
  Compare renaming assertions still fail.

### Task 1.3: migrate Explore and Compare atomically

**Files:**

- Edit: `src/scripts/climate-engine/heat-map-app.ts`
- Edit: `src/scripts/climate-engine/compare/paired-runner.ts`
- Edit: `src/scripts/climate-engine/compare/paired-controller.ts`
- Edit: `src/components/ClimateEngine/compare/PairedBench.astro`
- Edit: `src/components/ClimateEngine/brief/HeatMapBrief.astro`
- Possibly edit: `src/components/ClimateEngine/HeatMapStage.astro` if the `uhi` id is
  renamed

- [ ] Replace Explore's expanded formula with
  `greenReferenceContrastC(st.meanC, p)`.
- [ ] Delete local `ruralContrast()` from `paired-runner.ts`.
- [ ] Rename `WardScenarioResult.ruralContrastC` to
  `greenReferenceContrastC` and compute it with the shared helper.
- [ ] Add `metricsVersion: typeof HEAT_METRICS_VERSION` to `ReleaseEvidence` and
  populate it from the constant.
- [ ] Keep `PairedScenarioState.contract` and the shared-link parameter at
  `paired-coverage-v1`. Do not conflate input coverage versioning with evidence
  metric versioning.
- [ ] Rename Compare selectors from `a-rural`/`b-rural` to
  `a-green-reference`/`b-green-reference`.
- [ ] Change the row label to “Δ vs all-green ref”. Add the approved explanatory
  copy as a title/description accessible to pointer and keyboard users.
- [ ] Add `Metrics / heat-metrics-v2` to Compare's integrity block and brief.
- [ ] Keep Explore's already-correct visible label and tooltip wording. If its DOM id
  is renamed, update all styles, bindings, and tests in the same change.
- [ ] Search for stale public/internal terminology:

  ```bash
  rg -n "Rural contrast|ruralContrastC|data-value=\"[ab]-rural\"" src tests
  ```

  Expected: no matches. References to DC-URS rural baselines are valid and must
  remain.

### Task 1.4: verify the metric-only change

- [ ] Run:

  ```bash
  node --import tsx --test tests/unit/heat-map-metrics.test.mjs tests/unit/heat-map-compare.test.mjs
  npm run check
  ```

- [ ] Re-run the default peak and retained scenario. Compare every non-reference
  output to Phase 0.
- [ ] Confirm peak contrast is unchanged within `1e-9`.
- [ ] Confirm retained reference changed by the analytically expected storage term.
- [ ] Confirm the URL remains `paired-coverage-v1` and the evidence shows
  `heat-metrics-v2`.

**Stop condition:** any raw field, mean, cooling, hot-area metric, DC-URS value, cost,
or delivered quantity changes.

**Suggested commit:** `fix(heat-map): centralise all-green reference metric`

---

## Phase 2 — task 2: execute the declared TypeScript fallback

### Task 2.1: correct capability selection before adding hosts

**Files:**

- Edit: `src/scripts/climate-engine/caps.ts`
- Edit: `tests/unit/heat-map-compare.test.mjs`

- [ ] Add failing capability cases:

  | Tier | Motion | WebGPU | Float targets | Expected |
  |---:|---|---|---|---|
  | 2 | yes | no | yes | `gpu` |
  | 2 | yes | yes | no | `ts` |
  | 2 | yes | yes | yes | `gpu` |
  | 1 | yes | yes | yes | `ts` |
  | 2 | no | yes | yes | `ts`, `animate=false` |

- [ ] Change the current backend predicate so only the executable WebGL2 float path
  selects `GpuHeatSim`. Keep WebGPU in diagnostics, with a comment that it cannot
  select a solver until a WebGPU implementation ships.
- [ ] Preserve grid `192` for every case.
- [ ] Run:

  ```bash
  node --import tsx --test tests/unit/heat-map-compare.test.mjs
  ```

### Task 2.2: define the async protocol as a pure module

**Files:**

- Create: `src/scripts/climate-engine/sim-protocol.ts`
- Create: `tests/unit/heat-sim-protocol.test.mjs`

- [ ] Define the request, snapshot, backend, host, main-to-worker, and
  worker-to-main discriminated unions from the specification.
- [ ] Add pure guards:

  - finite non-negative integer `requestId` and `generation`;
  - canonical grid version and expected array lengths;
  - valid message type;
  - serialisable failure message with no raw stack requirement.

- [ ] Add `isCurrentSnapshot(snapshot, generation)` or an equivalent pure helper.
- [ ] Test malformed arrays, mismatched grid sizes, stale generations, and unknown
  messages.
- [ ] Ensure this module imports no DOM, Worker, MapLibre, or Three.js APIs.
- [ ] Run:

  ```bash
  node --import tsx --test tests/unit/heat-sim-protocol.test.mjs
  ```

### Task 2.3: implement the worker-owned `TsHeatSim`

**Files:**

- Create: `src/scripts/climate-engine/sim-worker.ts`
- Edit: `tests/unit/heat-sim-protocol.test.mjs`

- [ ] Keep worker message handling thin. Move the deterministic message-to-solver
  operation into an exported pure/testable function or class that accepts a
  `TsHeatSim` instance.
- [ ] On `reset`:

  1. validate request and layer lengths;
  2. remember generation;
  3. reset `TsHeatSim` on the canonical grid;
  4. execute `settleSteps`;
  5. compute stats;
  6. return a copied/transferred field snapshot.

- [ ] On `advance`, ignore an older generation, step the current solver, and return a
  snapshot.
- [ ] On a newer reset, make queued older advances stale.
- [ ] On dispose, release the solver and reject further operations.
- [ ] Catch solver/message errors at the worker boundary and return the typed failure
  shape. Do not echo arbitrary object contents.
- [ ] Test the handler directly in Node on the canonical grid with `settleSteps` kept
  deliberately small for protocol mechanics. A smaller analytical grid is not a
  valid production request and must be rejected.
- [ ] Add one test proving the source contains no `fetch(` or capability probe.

### Task 2.4: implement hosts with dependency injection

**Files:**

- Create: `src/scripts/climate-engine/sim-host.ts`
- Edit: `tests/unit/heat-sim-protocol.test.mjs`

- [ ] Implement `WorkerHeatSimHost` around:

  ```ts
  new Worker(new URL('./sim-worker.ts', import.meta.url), { type: 'module' })
  ```

- [ ] Inject a `WorkerLike` factory in tests so Node unit tests never require a real
  browser worker.
- [ ] Maintain one monotonically increasing request id and a map of pending promises.
- [ ] Coalesce `advance()` calls while one is in flight. Do not queue per-frame work.
- [ ] Copy layer arrays before posting/transferring; assert the caller's source arrays
  remain attached after reset.
- [ ] Ignore stale generation snapshots even if their request id is recognised.
- [ ] Reject pending promises on worker error/disposal with a typed host error.
- [ ] Implement `GpuHeatSimHost`, wrapping the existing `GpuHeatSim` and renderer but
  returning the same promise/snapshot contract.
- [ ] Add a context-loss listener to the GPU renderer's canvas and convert it into a
  typed backend failure.
- [ ] Implement `StaticTsHeatSimHost` as the last-resort main-thread path. It must:

  - run one settled result only;
  - split work into bounded batches with `scheduler.yield`, `requestIdleCallback`, or
    `setTimeout(0)` fallback;
  - honour generation/disposal between batches;
  - never enter the continuous animation loop.

- [ ] Implement a factory that accepts `HeatCaps` and returns an executable host. A
  failed GPU factory demotes to worker; a failed worker factory demotes to static TS.
- [ ] Unit-test host promise ownership, source-array preservation, coalescing,
  disposal, GPU failure demotion, worker failure demotion, and one-way demotion.

### Task 2.5: integrate the async host into Explore

**Files:**

- Edit: `src/scripts/climate-engine/heat-map-app.ts`
- Edit: `src/components/ClimateEngine/HeatMapStage.astro`

- [ ] Call `detectHeatCaps()` once during mount before choosing the sim host.
- [ ] Apply the resolved default `mode` and `animate` policy. Do not lower `SIM_N`.
- [ ] Replace direct `GpuHeatSim` ownership with `HeatSimHost` ownership.
- [ ] Introduce one `simGeneration` immediately; Task 3 will unify it with ward
  generation. Increment it on every reset-worthy state change.
- [ ] Convert `resetSim()` into an async request builder:

  1. refresh forcing/sun;
  2. compute baseline and intervention layers;
  3. increment/capture generation;
  4. await `host.reset()`;
  5. discard stale snapshot;
  6. bridge field and refresh stats from that snapshot.

- [ ] Refactor `bridgeField()` and `refreshStats()` to accept a
  `HeatSimSnapshot`/field/stats rather than synchronously reading the solver.
- [ ] Keep the render blur/presentation texture exactly as shipped.
- [ ] Replace per-frame solver stepping with a sparse, coalesced host `advance()` at
  the existing effective bridge cadence. No `postMessage` per animation frame.
- [ ] When `animate=false`, perform reset/settle once and schedule no advances,
  grow-in, or orbit.
- [ ] On typed GPU failure, create the worker host, replay the latest request under
  its existing generation, and change the label. Do not promote again in-session.
- [ ] On static emergency fallback, show a settled result and no continuous stepping.
- [ ] Dispose the host before renderer/map teardown.

### Task 2.6: expose honest backend and failure states

**Files:**

- Edit: `src/components/ClimateEngine/HeatMapStage.astro`
- Edit: `src/scripts/climate-engine/heat-map-app.ts`
- Edit or create focused unit/source contract tests as needed

- [ ] Replace hard-coded `GPU SIM` with a target element, initially
  `SELECTING ENGINE`.
- [ ] Add a polite status region and root attributes such as:

  ```text
  data-sim-backend="gpu-webgl2|ts-worker|ts-main"
  data-sim-state="selecting|ready|degraded|error"
  ```

- [ ] Map backend names to the approved compact labels and accessible descriptions.
- [ ] Announce only initial selection, demotion, and terminal failure—not each reset.
- [ ] If MapLibre construction itself fails, catch at the application boundary and
  render an explicit analytical/degraded explanation. Do not leave a dead black map
  with `GPU SIM` or unexplained `—` values.
- [ ] Preserve the existing no-JavaScript/methodology content.
- [ ] Ensure controls that cannot operate in a renderer-less state are disabled with
  an explanation rather than disappearing without context.

### Task 2.7: focused fallback verification

- [ ] Run:

  ```bash
  node --import tsx --test tests/unit/heat-map-compare.test.mjs tests/unit/heat-sim-protocol.test.mjs
  npm run check
  npm run build
  ```

- [ ] Manually deny `EXT_color_buffer_float`. Expected:

  - `CPU SIM` is visible;
  - canonical grid remains 192;
  - mean, all-green contrast, hot area, and resilience are populated;
  - map controls remain responsive;
  - no uncaught GPU exception occurs.

- [ ] Test reduced motion. Expected one settled result, no orbit, no repeated advance.
- [ ] Test worker failure. Expected `CPU STATIC`, one result, no permanent placeholder.

**Suggested commit:** `feat(heat-map): run TypeScript fallback through async sim host`

---

## Phase 3 — task 3: make ward/style work generation-safe

### Task 3.1: build and test the request-generation state machine

**Files:**

- Create: `src/scripts/climate-engine/ward-session.ts`
- Create: `tests/unit/heat-ward-session.test.mjs`

- [ ] Write tests for:

  - initial generation and empty committed/requested ward;
  - beginning a valid request increments generation and creates a signal;
  - beginning B aborts pending A;
  - a stale A token fails `isCurrent()` after B begins;
  - duplicate pending B is a no-op;
  - selecting already committed B with no pending request is a no-op;
  - failed B clears pending state but retains committed A;
  - retrying B creates a new generation;
  - commit is accepted only for the current token;
  - dispose aborts, increments/invalidates, and is idempotent;
  - no begin/commit is accepted after dispose.

- [ ] Implement a DOM-free `WardSession` or equivalent small state machine. It owns
  generation and `AbortController`; it does not fetch, render, or write labels.
- [ ] Return opaque request tokens containing ward, generation, and signal. Avoid
  passing naked generation numbers across all call sites.
- [ ] Make `commit`, `fail`, and `isCurrent` require the exact token.
- [ ] Run:

  ```bash
  node --import tsx --test tests/unit/heat-ward-session.test.mjs
  ```

### Task 3.2: create an abort-aware Explore data repository

**Files:**

- Create: `src/scripts/climate-engine/explore-ward-loader.ts`
- Create: `tests/unit/heat-ward-loader.test.mjs`
- Reuse: `src/scripts/climate-engine/ward-loader.ts`
- Reuse: `src/scripts/climate-engine/surface-raster.ts`

- [ ] Inject `fetch` into the repository for deterministic unit tests.
- [ ] Validate `WardId` before building paths.
- [ ] Load required ward JSON and measured surface as required assets.
- [ ] Load terrain, water, roads, labels, and provenance as optional typed assets.
- [ ] Run independent requests in parallel under the same signal where dependencies
  permit.
- [ ] Implement `fallbackUnlessAborted(error, fallback, assetName)`. It must:

  - rethrow `AbortError` unchanged;
  - return only the declared fallback for other optional failures;
  - record the fallback in `bundle.fallbacks`.

- [ ] Check `response.ok` before parsing every direct fetch.
- [ ] Cache only successfully resolved immutable parsed values. Remove rejected
  promises from any in-flight cache.
- [ ] Do not cache Three.js objects or mutated `SimLayers`.
- [ ] Test:

  - all paths receive the exact signal;
  - required failure rejects;
  - optional 404/network failure yields a disclosed fallback;
  - cancellation is never converted to an empty optional asset;
  - rejected/aborted loads do not poison retry;
  - successful cache reuse does not share mutable render resources;
  - a malformed/unknown ward cannot construct a request URL.

- [ ] Keep global DC-URS/heatwave loading outside this repository. Give it the app
  lifecycle signal during integration, but do not make it a ward-commit prerequisite.

### Task 3.3: define a disposable prepared ward

**Files:**

- Edit: `src/scripts/climate-engine/heat-map-app.ts`
- Optionally create: `src/scripts/climate-engine/explore/prepared-ward.ts` if the
  extraction remains independent of live shader uniforms

- [ ] Introduce a local or extracted `PreparedWard` shape containing all values that
  must commit together:

  - parsed bundle and metadata;
  - building registry and merged geometry;
  - terrain-ground/water/road render objects;
  - model transform;
  - base `SimLayers`, spatial index, cooling masks/ranges;
  - label/provenance payloads;
  - explicit `dispose()`.

- [ ] Refactor the current `loadWard()` body into `prepareWard(bundle, token)` without
  global state/DOM writes.
- [ ] Build geometry into local variables. Check `session.isCurrent(token)` before
  expensive construction, after construction, and before simulation.
- [ ] Dispose every individual geometry after merge as today; if merge/preparation
  fails, dispose both individual and merged provisional objects exactly once.
- [ ] Do not dispose current committed resources during preparation.
- [ ] Keep terrain render-only and surface/raster contracts unchanged.
- [ ] Keep labels in lon/lat and building/road geometry in the existing ward frame.

### Task 3.4: replace `loadWard()` with two-phase request/commit

**Files:**

- Edit: `src/scripts/climate-engine/heat-map-app.ts`
- Edit: `src/components/ClimateEngine/HeatMapStage.astro`
- Edit: `tests/unit/heat-ward-session.test.mjs` if integration exposes missing pure
  invariants

- [ ] Add one `WardSession` to the mount lifecycle.
- [ ] Make initial boot call `requestWard('ballygunge')` exactly once after minimum
  boot readiness—not from `style.load`.
- [ ] Make every ward tab invoke `requestWard(validWardId)`.
- [ ] Request flow:

  1. begin/get token;
  2. mark requested tab pending and show status;
  3. load bundle with token signal;
  4. prepare locally;
  5. build the latest scenario parameters/interventions at that point;
  6. call the sim host with `token.generation`;
  7. assert current after each await;
  8. perform one synchronous commit;
  9. mark session committed;
  10. dispose provisional data in `finally` unless ownership transferred.

- [ ] Unify `simGeneration` with the ward generation for ward reset. Non-ward control
  changes may create a child simulation generation, but they must remain comparable
  to the current ward token. A recommended key is `{ wardGeneration, simRevision }`.
  Do not allow a phase/slider result for an old ward to commit after a ward switch.
- [ ] Commit synchronously in the order defined by the spec. No awaits inside commit.
- [ ] Keep committed ward active/visible while the next ward loads.
- [ ] Give the requested tab `data-pending="true"` and an accessible “Loading …”
  label; only committed ward receives the active style/state.
- [ ] Keep all ward tabs operable so a slow request can be superseded.
- [ ] On required failure:

  - dispose provisional objects;
  - retain all old committed state and resources;
  - clear pending state;
  - show “X could not load. Y remains active.” and a Retry action.

- [ ] Treat abort/stale completion silently.
- [ ] Start `fetchLive()` only after commit, capture the committed generation, and
  ignore a late response if the ward has changed.

### Task 3.5: separate style rehydration from data loading

**Files:**

- Edit: `src/scripts/climate-engine/heat-map-app.ts`
- Edit: `tests/unit/heat-map-roads.test.mjs`

- [ ] First add failing source/lifecycle assertions:

  - the named `onStyleLoad` exists and is registered with `map.on`;
  - its body contains no `loadWard(` or `requestWard(`;
  - `setEnv()` contains no `map.once('style.load'` and no direct
    `map.addLayer(customLayer)`;
  - style restoration checks `map.getLayer(customLayer.id)` before adding;
  - initial `requestWard('ballygunge')` occurs outside the style handler.

- [ ] Extract one named `onStyleLoad` function.
- [ ] Make custom layer, label source, and label layer re-addition idempotent.
- [ ] Restore only the committed ward's cached labels.
- [ ] Keep replaced basemap road geometry/label hiding inside the recurring style
  handler as existing tests require.
- [ ] Reduce `setEnv()` to environment state/uniform changes plus `map.setStyle()`.
- [ ] Ensure rapid environment changes use the latest `env` value when rebuilding
  label style.
- [ ] Register and remove the same named handler during mount/dispose.

### Task 3.6: harden app disposal and global loads

**Files:**

- Edit: `src/scripts/climate-engine/heat-map-app.ts`

- [ ] Add an app-lifecycle `AbortController` for global DC-URS, heatwave, and any live
  fetch not owned by a ward token.
- [ ] Pass signals to those fetches and rethrow/ignore abort distinctly from failure.
- [ ] Reorder disposal:

  1. guard/idempotence flag;
  2. `wardSession.dispose()` and lifecycle abort;
  3. sim host disposal;
  4. listener removal;
  5. provisional/committed render disposal;
  6. map removal;
  7. final disposed state.

- [ ] Make every scheduled timeout, animation frame, worker callback, fetch callback,
  and MapLibre callback check the disposed/current guard before mutation.
- [ ] Ensure a late status update cannot find and mutate DOM from a newly mounted
  Astro page instance.
- [ ] Make double disposal a no-op and cover it in a unit/browser test.

### Task 3.7: focused generation/lifecycle verification

- [ ] Run:

  ```bash
  node --import tsx --test \
    tests/unit/heat-ward-session.test.mjs \
    tests/unit/heat-ward-loader.test.mjs \
    tests/unit/heat-map-roads.test.mjs
  npm run check
  npm run build
  ```

- [ ] Manually test rapid A → B → A with network throttling. Final A must own ward
  label, geometry, labels, stats, Compare link, live weather, and active tab.
- [ ] Fail one required B request. A must remain fully interactive.
- [ ] Fail optional roads/terrain. B may commit with the declared fallback and
  provenance disclosure.
- [ ] Toggle styles repeatedly. No ward data request may occur because of the toggle.
- [ ] Navigate away during preparation and confirm no uncaught exception or late DOM
  mutation.

**Suggested commit:** `fix(heat-map): make ward and style lifecycle generation-safe`

---

## Phase 4 — combined browser and parity proof

### Task 4.1: create browser resilience tests

**Files:**

- Create: `tests/e2e/heat-map-resilience.spec.ts`

- [ ] Add a helper that records console errors and fails on uncaught exceptions while
  permitting explicitly asserted, typed fallback diagnostics.
- [ ] Add a route-delay helper that delays a named ward asset until the test releases
  it.
- [ ] Test CPU fallback by injecting a pre-navigation wrapper around
  `HTMLCanvasElement.prototype.getContext`/`getExtension` that denies
  `EXT_color_buffer_float` only for the capability/simulation contexts while leaving
  the display renderer viable. Assert:

  - `data-sim-backend="ts-worker"`;
  - `CPU SIM` label;
  - non-placeholder mean and contrast;
  - canonical grid evidence;
  - no uncaught error.

- [ ] Test worker construction failure by replacing `window.Worker` before navigation.
  If another site worker needs to remain available, fail only the URL ending in the
  sim-worker chunk. Assert `ts-main`, `CPU STATIC`, and one settled result.
- [ ] Emulate reduced motion. Assert no orbit/grow animation and no repeated advance
  status while values remain populated.
- [ ] Test delayed A then fast B. Release A last and assert B remains everywhere.
- [ ] Test A → B → A with two delayed assets. The final A must win.
- [ ] Test required failure retention and Retry.
- [ ] Test optional failure disclosure without ward failure.
- [ ] Test repeated dark/studio toggles:

  - selected ward unchanged;
  - no ward asset requests caused by the toggle;
  - one custom layer;
  - one label source/layer;
  - road geometry/labels remain hidden.

- [ ] Test navigation away mid-load and assert no post-navigation console/page error.
- [ ] Run axe against selecting, CPU fallback, ward loading, error, and ready states.

### Task 4.2: add the solver parity gate

**Files:**

- Create: `scripts/verify-heat-backend-parity.mjs`
- Edit: `package.json` only if the command proves stable enough for the full gate

- [ ] Run the browser-side `GpuHeatSimHost` and `WorkerHeatSimHost` against the same
  deterministic synthetic layer fixture and shipped fixed forcing.
- [ ] Use a temporary test harness served only by the verification script; do not add
  an indexable or production `_test` route and do not expose a permanent global debug
  hook.
- [ ] Compare snapshots before rendering blur:

  ```text
  |meanGPU − meanCPU| <= 0.02 °C
  |peakGPU − peakCPU| <= 0.05 °C
  RMSE(fieldGPU, fieldCPU) <= 0.03 °C
  |hotAreaGPU − hotAreaCPU| <= 0.1 percentage points
  ```

- [ ] Run at least:

  - all-green uniform fixture;
  - mixed built/vegetated/water fixture;
  - peak forcing;
  - retained forcing with non-zero storage.

- [ ] Exit non-zero and print the fixture/backend/difference on breach.
- [ ] If the local/CI browser has no float target, report the GPU parity case as a
  clearly named environment skip while all CPU/resilience tests still run. Never
  report an unavailable GPU as a parity pass.
- [ ] Once reliable locally and in CI, add `test:heat-parity` and include it in the
  release gate. If CI cannot provide the GPU capability, keep it as a documented
  pre-release hardware gate rather than weakening it.

### Task 4.3: test actual GPU context-loss demotion

**Files:**

- Edit: `tests/e2e/heat-map-resilience.spec.ts`

- [ ] Before navigation, wrap canvas `getContext` to retain test references to
  contexts without changing their behaviour.
- [ ] Start on `gpu-webgl2`, capture the current visible statistics, and call
  `WEBGL_lose_context` on the detached simulation context—not MapLibre's display
  context.
- [ ] Assert one-way demotion to `ts-worker`, a fresh current-generation result, and
  statistics within the approved visible tolerances.
- [ ] Wait through several bridge intervals and assert no attempted promotion or
  repeated demotion.
- [ ] If the browser lacks the extension, skip this case explicitly; the denied-float
  fallback case remains mandatory.

### Task 4.4: run the complete browser suite

```bash
npm run build
npm run test:e2e:built
```

**Stop conditions:** last-request-wins fails once; style switching fetches ward data;
the fallback lowers grid size; or a backend leaves unexplained placeholders.

**Suggested commit:** `test(heat-map): prove fallback and request ownership`

---

## Phase 5 — documentation and release audit

### Task 5.1: reconcile existing documentation

**Files:**

- Edit: `docs/heat-map-feature.md`
- Edit: `docs/heat-map-adaptive-views-spec.md`
- Edit: `docs/heat-map-adaptive-views-implementation.md`
- Edit any methodology file found by the terminology search

- [ ] Replace stale “rural contrast” wording only where it refers to the synthetic
  all-green metric. Preserve actual rural observations and DC-URS terminology.
- [ ] Document `heat-metrics-v2`, including why `heat-model-v1` and
  `paired-coverage-v1` did not change.
- [ ] Mark the worker-hosted TypeScript Explore fallback as implemented, with the
  exact capability boundary.
- [ ] State explicitly that WebGPU is diagnostic and does not execute a solver yet.
- [ ] Document the generation/transaction rule and style/data separation.
- [ ] Document optional asset fallbacks and current mapless-WebGL limitation honestly.
- [ ] Do not rewrite calibration history as if the old metric had always included
  storage. Record the correction date/version.

### Task 5.2: run semantic searches

```bash
rg -n "Rural contrast|ruralContrastC|data-value=\"[ab]-rural\"" src tests docs
rg -n "webgpu \|\||webgpu.*floatRenderTargets|GPU SIM" src/scripts src/components
rg -n "loadWard\('ballygunge'\)|map\.once\('style\.load'" src/scripts/climate-engine
rg -n "catch\(\(\) => \(\{.*ways|catch\(\(\) => EMPTY|catch\(\(\) => null" src/scripts/climate-engine
```

Review every match manually. Expected legitimate survivors:

- methodology discussion of measured rural evidence;
- the compact `GPU SIM` string in the backend label map;
- optional fallback helpers whose abort branch is explicit;
- exactly one initial ward request outside style rehydration.

### Task 5.3: full repository gate

Run in this order so the fastest/highest-signal checks fail first:

```bash
npm run check
npm run test:unit
npm run build
npm run report:build
npm run check:publication
npm run test:e2e:built
node scripts/verify-heat-backend-parity.mjs
```

If the parity script is added to `package.json`, use the named command instead.

### Task 5.4: final manual audit

- [ ] Desktop/laptop: GPU-capable and forced-CPU paths.
- [ ] Tablet/coarse pointer: tier policy, ward switching, style switching.
- [ ] Reduced motion: static settled output.
- [ ] Keyboard-only: ward tabs, retry, phase/pathway/slider controls, renderer state.
- [ ] Screen reader smoke test: selection, pending, ready, error, backend demotion.
- [ ] Slow 3G and offline transitions: old ward retention and typed failures.
- [ ] Astro client navigation away/back: one mount, one style handler, one host, clean
  disposal.
- [ ] Compare peak and retained: corrected label/value/version with no field drift.

### Task 5.5: review the final diff

- [ ] Confirm no model/data constant changed.
- [ ] Confirm no public asset or fixture was regenerated unexpectedly.
- [ ] Confirm no source arrays are detached after worker transfer.
- [ ] Confirm no worker, map, event listener, timeout, or provisional geometry leaks.
- [ ] Confirm no analytics/network addition occurred.
- [ ] Confirm existing user files and unrelated modifications are untouched.
- [ ] Summarise:

  - files changed;
  - tests run and results;
  - retained metric delta and why;
  - backend parity results/hardware;
  - fallback states tested;
  - remaining out-of-scope limitation.

**Suggested final docs commit:** `docs(heat-map): record metric and resilience contracts`

---

## Definition of done

- [ ] There is one all-green reference function and one public name.
- [ ] Retained calculations include nocturnal storage and expose
  `heat-metrics-v2`.
- [ ] Peak and every non-reference output remain unchanged.
- [ ] Explore chooses an executable backend from `detectHeatCaps()`.
- [ ] WebGPU alone cannot select the WebGL2 solver.
- [ ] Missing float targets produce a worker result on grid 192.
- [ ] GPU failure demotes once; worker failure produces a labelled static result.
- [ ] Reduced motion produces one settled, non-animated result.
- [ ] Ward requests are abortable and last-request-wins by generation.
- [ ] Prepare/commit is transactional; failure retains the old ward.
- [ ] Style reload is idempotent and cannot load/reset geography.
- [ ] Disposal invalidates all asynchronous work before releasing resources.
- [ ] Unit, type, build, publication, accessibility, browser, and parity gates pass.
- [ ] Existing documentation matches the shipped runtime and scientific terminology.
- [ ] The final audit reports no unexplained placeholders, stale commits, model drift,
  lowered grid, or new privacy surface.
