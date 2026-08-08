# Climate engine: closures and interfaces instead of classes — design

**Date:** 2026-08-08
**Status:** proposed; implementation not started pending review
**Scope:** `src/scripts/climate-engine/` — the 2026-08-07 refactor's new modules
**Behaviour change:** none. This is a pure structural refactor.

---

## 1 · Executive decision

The 2026-08-07 engine refactor introduced **13 classes** into a codebase whose established
idiom is **a factory function returning a documented interface**. This spec converts the
nine that earn nothing from being classes, leaves the four that do, and adopts one pattern
across the engine.

**It changes no behaviour, no physics, no published number, and no honesty invariant.**
If any of those move, the refactor is wrong and must be reverted rather than accommodated.

## 2 · The measurement

### 2.1 The decisive fact

**There are no class hierarchies.** A repo-wide search for `extends` in
`src/scripts/climate-engine/` returns only three things: `Error` subclasses, generic
constraints (`<T extends Element>`), and two *interface* extensions in
`paired-protocol.ts` (`WardScenarioWireResult extends Omit<…>`). **Not one class inherits
from another; not one is subclassed.**

The `class` keyword is therefore providing **no capability a closure does not already
provide** — no inheritance, no `super`, no protected members, no `instanceof` dispatch.

Worth noting that the two interface extensions are the pattern this spec is arguing *for*:
`paired-protocol.ts` composes wire types out of existing ones with `extends Omit<…>`, which
is structural typing doing real work. Interfaces compose; these classes do not.

### 2.2 What exists

| class | LOC | instances | genuinely polymorphic? | verdict |
|---|---|---|---|---|
| `TsHeatSim` | 96 | 3 | **yes** — `HeatSim` ABI | **keep** |
| `WebGl2HeatSim` | 153 | 1 | **yes** — 2nd `HeatSim` impl | **keep** |
| `SimulationCancelled` | — | — | `extends Error` | **keep** |
| `SimUnsupported` | — | — | `extends Error` | **keep** |
| `WorkerHeatSimHost` | 126 | 1 | interface only, **no shared behaviour** | convert |
| `GpuHeatSimHost` | 53 | 1 | interface only | convert |
| `StaticTsHeatSimHost` | 20 | 3 | interface only | convert |
| `WardSession<T>` | 44 | 1 | none | convert |
| `PairedScenarioCache` | 138 | 2 | none | convert |
| `PairedScenarioClient` | 116 | 2 | none | convert |
| `ExploreFrameScheduler` | 83 | 1 | none | convert |
| `CoreFieldLayer` | 65 | 1 | none | convert |
| `ThreeReliefRenderer` | 323 | 1 | already wrapped by `createReliefRenderer` | convert internals |

**The two `HeatSim` backends are legitimate and predate this refactor.** `types.ts` documents
the contract — *"Every backend implements HeatSim, so the worker/stage can swap engines
without knowing which one it holds"* — and two implementations are selected at runtime by
`caps.ts`. That is real polymorphism against a real ABI. **Do not touch them.** Error
subclasses are likewise correct as classes.

### 2.3 Three pieces of evidence that this is not taste

**(a) The classes are already fighting `this`.** Six arrow-function class properties exist
solely to dodge binding:

```ts
sim-host.ts:30      private onMessage = (event) => { ... }
sim-host.ts:39      private onError = () => this.failAll(...)
sim-host.ts:101     private onContextLost = (event) => { ... }
paired-client.ts:49 private onMessage = (event) => this.handleMessage(event.data)
paired-client.ts:50 private onError = () => this.demote()
paired-map-3d.ts:743 private onFrame = (time) => { ... }
```

And `frame-scheduler.ts:28-30` carries an explicit apology for the class form:

> *"Browser animation methods require Window as their receiver in some engines, so retain
> them behind **lexical wrappers** rather than storing the host methods directly on this
> scheduler instance."*

That is a closure, written inside a class, to work around the class.

**(b) `WardSession<T extends string>` is generic and instantiated exactly once**, as
`<string>`, at `heat-map-app.ts:72`. A type parameter with one call site is ceremony.

**(c) An injectable seam exists that no test uses.** `WorkerHeatSimHost`'s constructor takes
a `WorkerFactory` specifically so a fake worker can be injected — and `tests/` never does.
With a factory function the dependency is an ordinary argument; there is no seam to
remember to design.

## 3 · The pattern (already proven in this codebase)

`cloud-layer.ts`, `water-layer.ts` and `road-layer.ts` all follow it: a documented
`interface`, then `createX(deps): X`. The interface carries the prose; the factory closes
over its state.

```ts
export interface FrameScheduler {
  /** Coalesce one-shot visual work into the NEXT display frame. */
  request(reason: FrameReason): void;
  /** Ask for a frame in `delayMs`. NEVER pass a non-zero delay for continuous
   *  motion — see the 144 Hz quantisation note on nextFrameDelayMs. */
  requestAfter(reason: FrameReason, delayMs: number): void;
  cancelPending(): void;
  dispose(): void;
}

/** Injected so tests drive the clock; production passes nothing. */
export interface FrameHost {
  requestFrame(cb: FrameRequestCallback): number;
  cancelFrame(id: number): void;
  setTimer(cb: () => void, ms: number): number;
  clearTimer(id: number): void;
  now(): number;
}

export function createFrameScheduler(
  onFrame: (time: number, reasons: ReadonlySet<FrameReason>) => void,
  host: FrameHost = browserFrameHost,
): FrameScheduler {
  const pending = new Set<FrameReason>();
  let frame: number | null = null;          // genuinely private — not `private`
  // ... no `this`, no binding workarounds
  return { request, requestAfter, cancelPending, dispose };
}
```

### What the conversion actually buys

- **State becomes genuinely private.** TypeScript's `private` is erased at runtime; a
  closure variable does not exist outside the closure. For a module that other agents will
  edit, that is a real boundary rather than a documented one.
- **`this` disappears**, and with it all six binding workarounds.
- **Dependencies become arguments.** `createFrameScheduler(onFrame, fakeHost)` is a test.
  No constructor seam to invent, which is exactly the seam that went unused.
- **The engine reads as one thing.** Nine modules stop being a second dialect inside a
  codebase that already had a working one.

### The `HeatSimHost` trio specifically

Three classes implement one interface with **no shared behaviour** — no base class, no
common helper. That is three unrelated implementations agreeing on a shape, which is what a
discriminated union expresses:

```ts
export type SimBackendId = 'gpu-webgl2' | 'ts-worker' | 'ts-main';
export interface HeatSimHost {
  readonly backend: SimBackendId;
  reset(request: HeatSimRequest): Promise<HeatSimSnapshot>;
  advance(generation: number, steps: number): Promise<HeatSimSnapshot | null>;
  dispose(): void;
}
export function createWorkerHost(makeWorker?: () => WorkerLike): HeatSimHost;
export function createGpuHost(canvas: HTMLCanvasElement): HeatSimHost;
export function createStaticHost(): HeatSimHost;
```

This also lets the **demotion ladder** (`gpu-webgl2 → ts-worker → ts-main`) be written as
data in one place, instead of being implied across three class definitions and
`demoteSimHost()`.

## 4 · Order of work — by risk, lowest first

Each step is its own commit, so a regression bisects cleanly. `npm run verify` must pass at
every step.

| # | target | LOC | tests today | risk | note |
|---|---|---|---|---|---|
| 1 | `ward-session.ts` | 51 | 1 | **lowest** | one call site; drop the unused generic |
| 2 | `explore/core-field-layer.ts` | 109 | 2 | low | pure raster writer |
| 3 | `compare/paired-client.ts` | 157 | 1 | low | 2 binding workarounds removed |
| 4 | `explore/frame-scheduler.ts` | 94 | 1 | medium | **animation hot path** — the 144 Hz cadence must not move |
| 5 | `compare/paired-core.ts` | 189 | 1 | medium | contains the cache fix from `aa89a71`; its eviction test must stay green |
| 6 | `sim-host.ts` | 147 | **0** | **highest** | **write tests first** — see §5 |
| 7 | `explore/relief-renderer.ts` | 343 | 2 | high | biggest; already factory-wrapped so the public API does not move |

**Steps 1–5 are the recommended first tranche.** 6 and 7 should be a separate decision once
1–5 have proven the pattern holds.

## 5 · `sim-host.ts` has no tests, and must get them before conversion

It is the only target with **zero** direct test coverage, and it holds the worker protocol,
generation guards, and the demotion path — the machinery an audit found to be correct by
inspection but which nothing defends. Converting it untested would be refactoring blind.

**Prerequisite:** tests exercising request/response pairing, the stale-snapshot guard,
`failAll` on worker error, dispose/terminate, and `advancing` coalescing — using a fake
worker through the seam that already exists. These are worth writing whether or not the
refactor proceeds.

## 6 · Non-goals

- **No behaviour change.** Not one observable difference in the instrument.
- **No physics.** `heat-map-model.ts` and `types.ts`'s calculation helpers are untouched.
- **No `HeatSim` backends.** `TsHeatSim` and `WebGl2HeatSim` stay classes.
- **No error types.** `SimulationCancelled` and `SimUnsupported` stay classes.
- **No file moves or renames**, so the diff is readable as a shape change only.
- **No new abstraction.** This removes a layer; it does not add one.
- **No honesty invariant may move** — `HEIGHTS.note` on `#bcH`, `SPATIAL.note` on the
  confidence/LST tooltips, the synthetic banner, the `Δ vs all-green ref` tooltip.

## 7 · Verification

1. `npm run verify` green at **every** commit — currently 261 tests, 0 type errors,
   publication contract 80/80.
2. **The GPU↔TS parity test must still pass unchanged.** It is the strongest guarantee that
   nothing numeric moved.
3. **The cadence test must still pin `animating → 0`** after step 4. That test exists
   because a 16 ms delay costs ~3× frame rate at 144 Hz while being invisible at 60 Hz.
4. **The cache-eviction test must still pass** after step 5.
5. Browser check after steps 4, 5 and 7: orbit and drag stay smooth; Compare completes; the
   building card opens on the right building in both view modes.
6. `git diff --stat` per commit should show **roughly balanced** insertions and deletions.
   A step that adds significantly more than it removes has misunderstood the goal.

## 8 · Risks, stated plainly

**This refactors code that was audited and fixed hours ago.** Six defects were found in it
by hand, and the 261-test suite caught **none** of them. So the suite is a weaker safety net
here than its size suggests, and the browser checks in §7 are not optional.

**Nothing about this makes the instrument better for a user.** It makes the engine cheaper
to reason about and to test — worth doing, but it is maintenance, not product. If it has to
compete for attention with the unresolved peak `−0.4 °C` contrast or the re-derivation of
`L`, **it should lose**: those are possible defects in published numbers, and this is not.

**The tempting scope creep is to "improve" logic while converting it.** Do not. A pure
shape change can be reviewed by reading the diff; a shape change carrying behaviour edits
cannot, and this codebase has just demonstrated how expensive an unreviewed behaviour edit
is.
