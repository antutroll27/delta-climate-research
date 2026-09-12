# Project Bangalore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Bengaluru's three wards in OBOS alongside Kolkata's, with named landmarks, without changing a single Kolkata number.

**Architecture:** The engine stops assuming one city, one ward size and one grid. A `country → city → ward` registry replaces four hard-coded ward lists including a TypeScript union type. `SIM_N` becomes per-ward. Buildings are drawn from a Draco-compressed glTF exported from Blender, while the footprint rings still ship because the solver rasterises them — nothing is drawn from the rings and nothing is solved from the model.

**Tech Stack:** TypeScript (Astro + three.js + MapLibre), Python 3.12 under strict mypy, `node:test` via tsx, Blender 5.2 headless.

**Spec:** [2026-09-11-project-bangalore-obos-design.md](../specs/2026-09-11-project-bangalore-obos-design.md)

---

## Conventions this plan assumes

- **Tests** live in `tests/unit/*.test.mjs`, use `node:test` + `node:assert/strict`, and import `.ts` directly (tsx handles it). Run one with:
  `node --import tsx --test tests/unit/<name>.test.mjs`
  Run all with: `npm run test:unit`
- **Every `.py` must pass strict mypy.** Run `npm run typecheck` (which is `python3 -m mypy`) before any Python commit.
- **TS type gate** is `npm run check` (astro check).
- **Never** `git stash` / `git stash pop` — this repo shares a stash stack across worktrees. Use a WIP commit instead.
- **Run `npm install` first.** On 2026-09-12 `check` failed with 2 errors, `build`
  failed outright and `test:unit` had 10 failures — all one cause, `mapillary-js`
  declared in `package.json` but absent from `node_modules`. After installing:
  **check 0 errors, build OK, test:unit 506 pass / 0 fail, mypy clean on 81
  files.** That is the real baseline every task must hold.
- Branch is `feat/bangalore-wards`, already checked out.

---

## File Structure

**Phase 1 — foundations (no visible change)**

| file | responsibility |
|---|---|
| `src/data/cities.ts` | **new.** The `country → city → ward` registry. Single source of truth. |
| `src/data/wards.ts` | **modify.** Re-export ward records derived from `cities.ts`; keep the existing `Ward` shape so its 12 consumers do not change. |
| `src/scripts/climate-engine/wards.ts` | **modify.** Delete the `WardId` union; derive ids from the registry. |
| `src/scripts/climate-engine/types.ts` | **modify.** `CANONICAL_GRID_N` → an admitted `(n, sizeM)` pair set. |
| `src/scripts/climate-engine/sim-protocol.ts` | **modify.** The guard checks the pair, not the constant. |
| `src/scripts/climate-engine/heat-map-model.ts` | **modify.** `SIM_N` stops being a module constant. |
| `tests/unit/heat-grid-pairs.test.mjs` | **new.** The pairing gate, mutation-checked. |
| `tests/unit/city-registry.test.mjs` | **new.** Registry invariants. |

**Phase 2 — data**

| file | responsibility |
|---|---|
| `scripts/_sentinel.py` | **modify.** `FOOTPRINT_M` per-ward; ward table from a shared source. |
| `scripts/export-bangalore-obos.py` | **new.** Bangalore artefacts → the shapes OBOS fetches. |
| `scripts/check-bangalore-artefacts.py` | **new.** Gate: every required artefact present and self-consistent. |

**Phases 3–5 — render, landmarks, UI**

| file | responsibility |
|---|---|
| `src/scripts/climate-engine/explore/building-model.ts` | **new.** Load the glTF, fall back to extrusion. |
| `src/scripts/climate-engine/explore/relief-renderer.ts` | **modify.** Call the model loader instead of extruding inline. |
| `src/scripts/climate-engine/explore/landmark-layer.ts` | **new.** Named landmark nodes, labels, selection. |
| `src/components/ClimateEngine/HeatMapStage.astro` | **modify.** City chip; tabs and cards rendered from the registry. |

---

# PHASE 1 — Foundations

Nothing visible changes. Kolkata must pass every gate at the end of every task.

---

### Task 1: The admitted grid pairs

**Files:**
- Modify: `src/scripts/climate-engine/types.ts:25-30`
- Test: `tests/unit/heat-grid-pairs.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/heat-grid-pairs.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';

import { ADMITTED_GRIDS, isAdmittedGrid, gridVersion } from '../../src/scripts/climate-engine/types.ts';

/* THE PAIR IS THE CONTRACT, NOT THE GRID SIZE. A grid without its matching ward
   size silently changes what a cell means while every array length still checks
   out — 384 cells over a 1400 m ward is 3.65 m cells, which no calibration in
   this repo describes. Both halves must agree or the request is refused. */

test('the two real city configurations are admitted', () => {
  assert.ok(isAdmittedGrid({ n: 192, cellMeters: 1400 / 192 }, 1400), 'Kolkata: 192 over 1400 m');
  assert.ok(isAdmittedGrid({ n: 384, cellMeters: 2800 / 384 }, 2800), 'Bengaluru: 384 over 2800 m');
});

test('a grid paired with the WRONG ward size is refused', () => {
  assert.equal(isAdmittedGrid({ n: 384, cellMeters: 1400 / 384 }, 1400), false,
    '384 cells over a 1400 m ward must not be admitted');
  assert.equal(isAdmittedGrid({ n: 192, cellMeters: 2800 / 192 }, 2800), false,
    '192 cells over a 2800 m ward must not be admitted');
});

test('cellMeters must actually equal sizeM / n', () => {
  assert.equal(isAdmittedGrid({ n: 192, cellMeters: 99 }, 1400), false,
    'a cell size that disagrees with sizeM/n is incoherent even on an admitted pair');
});

test('every admitted pair yields the same cell size, so cities are comparable', () => {
  const sizes = ADMITTED_GRIDS.map((g) => g.sizeM / g.n);
  for (const s of sizes) assert.ok(Math.abs(s - sizes[0]) < 1e-9,
    `admitted pairs must share one cell size; got ${sizes.join(', ')}`);
});

test('the grid version names the pair, not just the grid', () => {
  assert.equal(gridVersion(1400), 'hm-grid-192-v1', 'Kolkata keeps its existing version string');
  assert.equal(gridVersion(2800), 'hm-grid-384-2800-v1');
  assert.throws(() => gridVersion(999), /admitted/i);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --import tsx --test tests/unit/heat-grid-pairs.test.mjs`
Expected: FAIL — `SyntaxError: The requested module ... does not provide an export named 'ADMITTED_GRIDS'`

- [ ] **Step 3: Implement**

In `src/scripts/climate-engine/types.ts`, replace lines 25-30 (the `CANONICAL_GRID_N`, `CANONICAL_GRID_VERSION` and `isCanonicalGrid` block) with:

```typescript
/**
 * The admitted (grid, ward size) PAIRS.
 *
 * This was a single constant, `CANONICAL_GRID_N = 192`, from the day the model
 * was calibrated in cell units. That was correct while every ward was 1400 m.
 * Bengaluru's are 2800 m, and 192 cells there would be 14.58 m per cell — a
 * different physical quantity wearing the same name.
 *
 * BOTH HALVES ARE CHECKED TOGETHER because the failure mode is silent: 384
 * cells over a 1400 m ward produces arrays of exactly the right length, passes
 * every bounds check, and models 3.65 m cells that no calibration in this repo
 * describes.
 *
 * Every admitted pair yields 7.29 m per cell. That is deliberate: it is what
 * makes a Bengaluru cell and a Kolkata cell the same measurement.
 */
export interface AdmittedGrid {
  readonly n: number;
  readonly sizeM: number;
  readonly version: string;
}

export const ADMITTED_GRIDS: readonly AdmittedGrid[] = [
  { n: 192, sizeM: 1400, version: 'hm-grid-192-v1' },
  { n: 384, sizeM: 2800, version: 'hm-grid-384-2800-v1' },
] as const;

/** Cells per side for a ward of this size, or undefined if unsupported. */
export function gridFor(sizeM: number): AdmittedGrid | undefined {
  return ADMITTED_GRIDS.find((g) => g.sizeM === sizeM);
}

export function gridVersion(sizeM: number): string {
  const g = gridFor(sizeM);
  if (!g) throw new RangeError(`No admitted grid for a ${sizeM} m ward.`);
  return g.version;
}

export function isAdmittedGrid(grid: GridSpec, sizeM: number): boolean {
  const g = gridFor(sizeM);
  if (!g || grid.n !== g.n) return false;
  return Math.abs(grid.cellMeters - sizeM / g.n) < 1e-6;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --import tsx --test tests/unit/heat-grid-pairs.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Mutation-check the gate**

Temporarily change `if (!g || grid.n !== g.n) return false;` to `if (!g) return false;`.
Run the test again. Expected: FAIL on "a grid paired with the WRONG ward size is refused".
**Revert the mutation.** A gate that cannot fail is not a gate.

- [ ] **Step 6: Fix the call sites that referenced the old names**

Run: `npm run check`
Expected: errors in `heat-map-model.ts`, `ward-raster.ts`, `sim-protocol.ts`, `compare/paired-core.ts` — every `CANONICAL_GRID_N` and `isCanonicalGrid` reference.
Fix each by taking the grid from the ward's size via `gridFor(sizeM).n`. Do not reintroduce a module-level default; Task 3 removes the last one.

- [ ] **Step 7: Commit**

```bash
git add src/scripts/climate-engine/types.ts tests/unit/heat-grid-pairs.test.mjs
git commit -m "feat(heat): the grid contract becomes a set of (grid, ward size) pairs

A single CANONICAL_GRID_N was right while every ward was 1400 m. Bengaluru's
are 2800 m, where 192 cells would be 14.58 m — a different physical quantity
under the same name. The pair is now checked together, because the failure
mode is silent: 384 cells over a 1400 m ward yields arrays of exactly the
right length and passes every bounds check.

Mutation-checked: dropping the n comparison fails the wrong-size test."
```

---

### Task 2: The country → city → ward registry

**Files:**
- Create: `src/data/cities.ts`
- Modify: `src/data/wards.ts`
- Test: `tests/unit/city-registry.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/city-registry.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';

import { CITIES, CITY_OF, wardsOfCity, allWards } from '../../src/data/cities.ts';
import { gridFor } from '../../src/scripts/climate-engine/types.ts';

/* Four places used to hard-code the ward list, and one of them was a TYPE:
   `type WardId = 'ballygunge' | 'baruipur' | 'barrackpore'`. That wrote "there
   are exactly three wards and they are Kolkata's" into the type system, so a
   second city was not a data change but a type change rippling through every
   switch. This registry is the one source; these tests keep it honest. */

test('both cities are present with three wards each', () => {
  assert.deepEqual(Object.keys(CITIES).sort(), ['bengaluru', 'kolkata']);
  assert.equal(wardsOfCity('kolkata').length, 3);
  assert.equal(wardsOfCity('bengaluru').length, 3);
});

test('every ward id is unique across cities', () => {
  const ids = allWards().map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate ward id: ${ids.join(', ')}`);
});

test('every ward maps back to exactly one city', () => {
  for (const w of allWards()) {
    const city = CITY_OF[w.id];
    assert.ok(city, `${w.id} has no city`);
    assert.ok(wardsOfCity(city).some((x) => x.id === w.id), `${w.id} not in ${city}`);
  }
});

test('every ward size has an admitted grid', () => {
  for (const w of allWards()) {
    assert.ok(gridFor(w.footprintM), `${w.id}: ${w.footprintM} m has no admitted grid`);
  }
});

test('each city declares its own resolution, and it is honest', () => {
  for (const [id, city] of Object.entries(CITIES)) {
    const sizes = wardsOfCity(id).map((w) => w.footprintM);
    assert.equal(new Set(sizes).size, 1, `${id}: wards of differing size cannot share one declared resolution`);
    const g = gridFor(sizes[0]);
    assert.ok(Math.abs(city.cellMeters - sizes[0] / g.n) < 1e-6,
      `${id}: declares ${city.cellMeters} m cells but its wards compute ${sizes[0] / g.n}`);
  }
});

test('Bengaluru and Kolkata resolve to the same cell size', () => {
  assert.ok(Math.abs(CITIES.kolkata.cellMeters - CITIES.bengaluru.cellMeters) < 1e-6,
    'the whole point of 384 was that a cell means one thing in both cities');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --import tsx --test tests/unit/city-registry.test.mjs`
Expected: FAIL — cannot find module `../../src/data/cities.ts`.

- [ ] **Step 3: Implement the registry**

Create `src/data/cities.ts`:

```typescript
/**
 * country → city → ward. The single source of truth for what OBOS can render.
 *
 * WHY THIS REPLACES FOUR LISTS. Wards were hard-coded in src/data/wards.ts, in
 * src/scripts/climate-engine/wards.ts as a UNION TYPE, and twice more as
 * hand-written markup in HeatMapStage.astro. The union type was the blocker: it
 * made a second city a type change rather than a data change.
 *
 * COUNTRY IS MODELLED BUT NOT RENDERED. There is one country. A switcher with a
 * single entry is dead UI. Modelling it now means the control can appear when a
 * second country exists without restructuring the registry underneath it.
 */
import { gridFor } from '../scripts/climate-engine/types.ts';

export interface WardRecord {
  readonly id: string;
  /** display name; `<em>` marks the syllable the wordmark emphasises */
  readonly name: string;
  readonly zone: string;
  /** the local body whose statistical returns cover this ward */
  readonly body: string;
  readonly coord: string;
  readonly lat: number;
  readonly lon: number;
  /**
   * Measured Sentinel-2 fractional vegetation cover.
   *
   * NOTE: the field this replaces claimed to be "the thermal model's layer
   * seed" and was read by NOTHING — the solver takes vegetation from the
   * per-ward surface raster. Kolkata's stored values (0.12 / 0.62 / 0.28) do
   * not match its measured fractions (0.329 / 0.447 / 0.309). Those are left
   * alone here rather than silently corrected; Bengaluru's carry the measured
   * value so the field is at least true. Removing it is its own change.
   */
  readonly veg: number;
  /** analysis footprint, metres. Must have an admitted grid. */
  readonly footprintM: number;
}

export interface CityRecord {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  /** declared instrument resolution, metres per solver cell */
  readonly cellMeters: number;
  readonly wards: readonly WardRecord[];
}

const KOLKATA_WARDS: readonly WardRecord[] = [
  { id: 'ballygunge', name: 'Bally<em>gunge</em>', zone: 'Urban Core · Ward 68',
    body: 'Kolkata Municipal Corporation, Ward 68', coord: '22.528° N · 88.366° E',
    lat: 22.528, lon: 88.3659, veg: 0.12, footprintM: 1400 },
  { id: 'baruipur', name: 'Baru<em>ipur</em>', zone: 'Peri-Urban Fringe',
    body: 'Baruipur Municipality', coord: '22.365° N · 88.432° E',
    lat: 22.3654, lon: 88.4319, veg: 0.62, footprintM: 1400 },
  { id: 'barrackpore', name: 'Barrack<em>pore</em>', zone: 'Industrial River Corridor',
    body: 'Barrackpore Municipality', coord: '22.762° N · 88.371° E',
    lat: 22.7621, lon: 88.3713, veg: 0.28, footprintM: 1400 },
];

const BENGALURU_WARDS: readonly WardRecord[] = [
  { id: 'indiranagar', name: 'Indira<em>nagar</em>', zone: 'Dense Low-Rise',
    body: 'Greater Bengaluru Authority (GBA-2025)', coord: '12.978° N · 77.641° E',
    lat: 12.9784, lon: 77.6408, veg: 0.344, footprintM: 2800 },
  { id: 'mg-road', name: 'MG <em>Road</em>', zone: 'Mixed Downtown',
    body: 'Greater Bengaluru Authority (GBA-2025)', coord: '12.976° N · 77.603° E',
    lat: 12.9755, lon: 77.6030, veg: 0.344, footprintM: 2800 },
  { id: 'whitefield', name: 'White<em>field</em>', zone: 'Sparse High-Rise',
    body: 'Greater Bengaluru Authority (GBA-2025)', coord: '12.970° N · 77.750° E',
    lat: 12.9698, lon: 77.7500, veg: 0.344, footprintM: 2800 },
];

function declaredCellMeters(wards: readonly WardRecord[]): number {
  const g = gridFor(wards[0].footprintM);
  if (!g) throw new RangeError(`No admitted grid for a ${wards[0].footprintM} m ward.`);
  return wards[0].footprintM / g.n;
}

export const CITIES: Record<string, CityRecord> = {
  kolkata: { id: 'kolkata', name: 'Kolkata', country: 'India',
    cellMeters: declaredCellMeters(KOLKATA_WARDS), wards: KOLKATA_WARDS },
  bengaluru: { id: 'bengaluru', name: 'Bengaluru', country: 'India',
    cellMeters: declaredCellMeters(BENGALURU_WARDS), wards: BENGALURU_WARDS },
};

export const CITY_OF: Record<string, string> = Object.fromEntries(
  Object.values(CITIES).flatMap((c) => c.wards.map((w) => [w.id, c.id])),
);

export function wardsOfCity(cityId: string): readonly WardRecord[] {
  return CITIES[cityId]?.wards ?? [];
}

export function allWards(): readonly WardRecord[] {
  return Object.values(CITIES).flatMap((c) => c.wards);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --import tsx --test tests/unit/city-registry.test.mjs`
Expected: PASS, 6 tests.

**If "each city declares its own resolution" fails**, the two cities do not resolve to the same cell size — check `ADMITTED_GRIDS` from Task 1.

- [ ] **Step 5: Point the old registry at the new one, keeping its shape**

`src/data/wards.ts` has 12 consumers (standards, API routes, attribution page). Do **not** change its exported shape. Replace its hard-coded body with a derivation:

```typescript
import { allWards, type WardRecord } from './cities.ts';

export type Ward = WardRecord;

/** Kept keyed-by-id because 12 consumers index it that way. */
export const WARDS: Record<string, Ward> = Object.fromEntries(
  allWards().map((w) => [w.id, w]),
);
```

- [ ] **Step 6: Verify nothing downstream broke**

Run: `npm run check`
Expected: PASS.
Run: `npm run test:unit`
Expected: PASS — all 54 existing tests plus the two new files.

- [ ] **Step 7: Commit**

```bash
git add src/data/cities.ts src/data/wards.ts tests/unit/city-registry.test.mjs
git commit -m "feat(obos): one country > city > ward registry replaces four ward lists

One of the four was a TYPE — WardId as a union of three Kolkata ward ids —
which made a second city a type change rippling through every switch rather
than a data change.

wards.ts keeps its exported shape because 12 consumers index it by id; it now
derives from the registry instead of restating it.

Country is modelled and NOT rendered: one country, and a switcher with one
entry is dead UI. Modelling it now avoids restructuring later."
```

---

### Task 2b: Delete the `WardId` union

**Files:**
- Modify: `src/scripts/climate-engine/wards.ts:12`

**WHY THIS EXISTS AS ITS OWN TASK.** The plan's file table says "delete the
`WardId` union; derive ids from the registry", and the Task 2 commit message
calls that union *the* blocker — but it was in no numbered task, so Task 2
correctly stayed inside its file list and left it standing. A spec review caught
the gap. Task 12 renders a second city's tabs and would hit a type admitting
only three Kolkata ids.

```typescript
export type WardId = 'ballygunge' | 'baruipur' | 'barrackpore';
```

- [ ] **Step 1: See how far it reaches**

`grep -rn "WardId" src/ tests/`. Every switch and `Record<WardId, …>` narrows on
these three literals; widening the type is what surfaces the places that assume
three Kolkata wards.

- [ ] **Step 2: Widen it to the registry**

```typescript
import { allWards } from '../../data/cities.ts';

/** Any ward in the registry, published or not. WAS a union of three Kolkata
 *  ids, which wrote "there are exactly three wards and they are Kolkata's"
 *  into the type system — so a second city was a type change rippling through
 *  every switch rather than a data change. */
export type WardId = string;
```

If a `Record<WardId, …>` becomes unsound once `WardId` widens, that record was
silently asserting completeness over three ids. Make it `Partial<Record<…>>` or
key it off `allWards()`, and say which in your commit.

- [ ] **Step 3: Gates**

`npm run check` 0 errors, `npm run test:unit` 512+/0, `npm run typecheck` clean.

- [ ] **Step 4: Commit**

---

### Task 3: `SIM_N` becomes per-ward

**Files:**
- Modify: `src/scripts/climate-engine/heat-map-model.ts:15` and its ~20 readers
- Modify: `src/scripts/climate-engine/sim-protocol.ts:56`
- Modify: `src/scripts/climate-engine/heat-map-app.ts:160`

- [ ] **Step 1: Read what you are about to change**

Run: `grep -rn "SIM_N\|Task 3" src/ | tee /tmp/sim-n-sites.txt && wc -l /tmp/sim-n-sites.txt`
You will see roughly 20 `SIM_N` sites across `heat-map-model.ts` and
`heat-map-app.ts`, **plus four pieces of scaffolding Task 1 left behind and
marked for you**: `KOLKATA_WARD_M`, `KOLKATA_GRID`, `SIM_N` itself (all adjacent
in `heat-map-model.ts`) and **`gridVersionOf` in `sim-protocol.ts`**.

`gridVersionOf` is the one that gets missed: it sits sixty lines from any
`SIM_N`, and after you edit `HeatSimRequest` it still compiles perfectly, so
nothing forces its removal. Replace its callers with `gridVersion(request.sizeM)`
and delete it. Its name is also two characters from `gridVersion` with the same
return type, which is a trap for the next reader either way.
**Read every one before editing any.** Several compute `d.sizeM / n` already and are correct once `n` is per-ward; a few use `SIM_N` as an array stride and must take the same value the layers were built with, or they will read the wrong row.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/heat-sim-per-ward-grid.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';

import { assertHeatRequest } from '../../src/scripts/climate-engine/sim-protocol.ts';
import { gridFor } from '../../src/scripts/climate-engine/types.ts';

function request(n, sizeM) {
  const count = n * n;
  const layer = () => new Float32Array(count);
  return {
    generation: 0,
    grid: { n, cellMeters: sizeM / n },
    layers: { albedo: layer(), veg: layer(), built: layer(), water: layer() },
    params: {}, settleSteps: 10, thresholdC: 30, sizeM,
  };
}

test('a 2800 m ward at 384 cells is accepted', () => {
  assert.doesNotThrow(() => assertHeatRequest(request(384, 2800)));
});

test('a 1400 m ward at 192 cells is still accepted', () => {
  assert.doesNotThrow(() => assertHeatRequest(request(192, 1400)));
});

test('a mismatched pair is refused, even though every array length is right', () => {
  assert.throws(() => assertHeatRequest(request(384, 1400)), /grid/i);
  assert.throws(() => assertHeatRequest(request(192, 2800)), /grid/i);
});

test('gridFor is the only place ward size maps to cells', () => {
  assert.equal(gridFor(1400).n, 192);
  assert.equal(gridFor(2800).n, 384);
  assert.equal(gridFor(700), undefined);
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --import tsx --test tests/unit/heat-sim-per-ward-grid.test.mjs`
Expected: FAIL — the 2800/384 case throws "The heat model requires the canonical grid."

- [ ] **Step 4: Implement — the request carries its ward size**

In `src/scripts/climate-engine/sim-protocol.ts`, add `sizeM: number;` to the `HeatSimRequest` interface, then replace line 56:

```typescript
  if (!isAdmittedGrid(request.grid, request.sizeM))
    throw new RangeError(
      `Grid ${request.grid.n} does not pair with a ${request.sizeM} m ward. ` +
      `A mismatched pair produces arrays of the right length and models a cell ` +
      `size no calibration describes.`);
```

Update the import on line 2 from `CANONICAL_GRID_N` to `isAdmittedGrid`.

- [ ] **Step 5: Implement — `SIM_N` stops being a constant**

In `heat-map-model.ts`, delete line 15 (`export const SIM_N = CANONICAL_GRID_N;`). Every function that used it takes `n` as a parameter, derived by the caller from `gridFor(ward.footprintM).n`. In `heat-map-app.ts`, replace the module-level `SIM_N` destructure at line 51 with a mutable `let simN = gridFor(WARDS.ballygunge.footprintM).n;` set alongside `currentWardSizeM` (line 160) whenever a ward loads.

- [ ] **Step 6: Run the tests**

Run: `node --import tsx --test tests/unit/heat-sim-per-ward-grid.test.mjs`
Expected: PASS, 4 tests.
Run: `npm run check && npm run test:unit`
Expected: PASS.

- [ ] **Step 6b: The Kolkata grid facts still hard-coded in production code**

**PARTLY DONE ALREADY — read this before you start.** Task 1's follow-up commit
`4643a01` fixed the two logic sites while it was in those files. Verify rather
than redo:

    paired-protocol.ts   FIXED — now `requireGrid(result.a.wardData.sizeM).n`
    scenario-url.ts      FIXED — now `gridVersion(wardA.footprintM)`, and it
                         OMITS the stamp for an unidentifiable ward rather than
                         asserting a grid it cannot know
    PairedBench.astro    STILL STALE — 2 sites, deferred to Task 12
    HeatMapBrief.astro   STILL STALE — deferred to Task 12

Your job here is only to confirm the first two still hold after your `SIM_N`
changes. The table below records what was found and why it mattered:

| file:line | what | effect on a Bengaluru ward |
|---|---|---|
| `compare/paired-protocol.ts:99` | `field.length !== 192 * 192` | **throws** — rejects every Bengaluru paired result |
| `scenario/scenario-url.ts:49` | `grid: 'hm-grid-192-v1'` | a shared scenario link claims the wrong grid |
| `components/ClimateEngine/compare/PairedBench.astro:95,162` | `192 × 192, canonical` / `hm-grid-192-v1` | on-screen copy becomes false |
| `components/ClimateEngine/brief/HeatMapBrief.astro:22` | `192 × 192, hm-grid-192-v1` | printed brief becomes false |

Fix the first two here, because they are logic. For `paired-protocol.ts:99`, check
the length against the ward's own pair rather than a literal:

```typescript
  const expect = requireGrid(result.a.wardData.sizeM).n;
  if (result.a.field.length !== expect * expect || result.b.field.length !== expect * expect) {
    throw new Error(`The paired result does not match the ${result.a.wardData.sizeM} m ward's admitted grid.`);
  }
```

For `scenario-url.ts:49`, take the version from `gridVersion(sizeM)`.

**Leave the two Astro files' display copy to Task 12**, which already rewrites
that component from the registry — note it there rather than fixing it twice.

- [ ] **Step 7: Commit**

```bash
git add src/scripts/climate-engine/ tests/unit/heat-sim-per-ward-grid.test.mjs
git commit -m "feat(heat): SIM_N becomes per-ward, and the guard checks the pair

The request now carries its ward size so the protocol can check the pair
rather than a constant. A mismatched pair is the bug worth guarding: it
produces arrays of exactly the right length and models a cell size no
calibration in this repo describes."
```

---

### Task 4: Kolkata regression — prove nothing moved

**Files:**
- Test: `tests/unit/kolkata-unchanged.test.mjs` (create)

This is the task that makes "Kolkata inherits later" mean "Kolkata is untouched now".

- [ ] **Step 1: Capture the current field BEFORE trusting the refactor**

```bash
git stash list   # must be empty of your work; never pop another session's entry
node --import tsx -e "
import { rasterizeWardBuilt } from './src/scripts/climate-engine/ward-raster.ts';
import { readFileSync, writeFileSync } from 'node:fs';
const ward = JSON.parse(readFileSync('public/heat-map/data/ballygunge.json','utf8'));
const built = rasterizeWardBuilt(ward, 192);
let sum = 0; for (const v of built) sum += v;
writeFileSync('/tmp/kolkata-baseline.json', JSON.stringify({
  n: 192, count: built.length, sum, mean: sum / built.length,
  head: Array.from(built.slice(0, 24)),
}, null, 1));
console.log('baseline written');
"
cat /tmp/kolkata-baseline.json
```

- [ ] **Step 2: Write the test against that captured baseline**

Create `tests/unit/kolkata-unchanged.test.mjs`, pasting the numbers printed above into `EXPECTED`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { rasterizeWardBuilt } from '../../src/scripts/climate-engine/ward-raster.ts';
import { gridFor } from '../../src/scripts/climate-engine/types.ts';
import { CITIES } from '../../src/data/cities.ts';

/* The city refactor must not move a single Kolkata number. This pins the
   rasterised built field — the dominant solver input — for one ward. If a
   future change to the grid, the registry or the rasteriser shifts Kolkata,
   this fails and the change has to be justified rather than discovered. */

// PASTE the values printed by the baseline command in the plan's Step 1.
const EXPECTED = { count: 36864, mean: 0, head: [] };

test('Ballygunge rasterises identically after the city refactor', () => {
  const ward = JSON.parse(readFileSync('public/heat-map/data/ballygunge.json', 'utf8'));
  const n = gridFor(1400).n;
  assert.equal(n, 192, 'Kolkata must still be a 192 grid');
  const built = rasterizeWardBuilt(ward, n);
  assert.equal(built.length, EXPECTED.count);
  let sum = 0; for (const v of built) sum += v;
  assert.ok(Math.abs(sum / built.length - EXPECTED.mean) < 1e-9,
    `mean built moved: ${sum / built.length} vs ${EXPECTED.mean}`);
  for (let i = 0; i < EXPECTED.head.length; i++) {
    assert.ok(Math.abs(built[i] - EXPECTED.head[i]) < 1e-9, `cell ${i} moved`);
  }
});

test('every Kolkata ward still declares 1400 m and 7.29 m cells', () => {
  for (const w of CITIES.kolkata.wards) {
    assert.equal(w.footprintM, 1400);
  }
  assert.ok(Math.abs(CITIES.kolkata.cellMeters - 1400 / 192) < 1e-9);
});
```

- [ ] **Step 3: Run it**

Run: `node --import tsx --test tests/unit/kolkata-unchanged.test.mjs`
Expected: PASS. If it fails, **the refactor changed Kolkata** — fix the refactor, do not adjust EXPECTED.

- [ ] **Step 4: Full gate**

Run: `npm run check && npm run test:unit && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/kolkata-unchanged.test.mjs
git commit -m "test(heat): pin Kolkata's rasterised field across the city refactor

Captured before the refactor was trusted. If the grid, the registry or the
rasteriser ever shifts Kolkata, this fails and the change must be justified
rather than discovered later."
```

---

# PHASE 2 — Data

---

### Task 4b: A dangling cross-language contract

**File:** `scripts/measure-shipped-amplitude.py:56-57`

```python
#: Must match SIM_N in heat-map-model.ts. Asserted against the dump, not trusted.
SIM_N = 192
```

**`heat-map-model.ts` no longer has `SIM_N`** — Task 3 deleted it. This comment
now points at a constant that does not exist, so the contract it describes
cannot be checked by the next reader.

The good news, and the reason this is not urgent: line 96 asserts the value
against the dumped field and exits with a message rather than trusting it, so
it fails **loudly** if the grid ever moves. This is a documentation defect, not
a live bug.

- [ ] **Step 1:** Point the comment at the real source of truth —
  `ADMITTED_GRIDS` in `src/scripts/climate-engine/types.ts` — and say that
  192 is Kolkata's half of the `(192, 1400)` pair, not a global constant.
- [ ] **Step 2:** `npm run typecheck` clean, then commit.

---

### Task 5: Sentinel footprint becomes per-ward

**Files:**
- Modify: `scripts/_sentinel.py:52` (`FOOTPRINT_M`), `:63` (`WARDS`), `:104` (`GRID`)

The pipeline is already coordinate-driven — `search()` and `read_window()` both take a lat/lon and work anywhere. Only the footprint constant and the private ward table are Kolkata-specific.

- [ ] **Step 1: Write the failing self-test**

Add to the bottom of `scripts/_sentinel.py`:

```python
def _self_test() -> None:
    """Grid must derive from the ward, not from a module constant.

    Bengaluru's wards are 2800 m; at Kolkata's fixed 1400 m the window would be
    read a quarter of the size and silently mis-scaled onto a 140 grid.
    """
    assert grid_for(1400) == 140, grid_for(1400)
    assert grid_for(2800) == 280, grid_for(2800)
    try:
        grid_for(1234)
    except ValueError:
        pass
    else:
        raise AssertionError("a footprint that is not a whole number of 10 m cells must raise")
    print("  _sentinel: grid derives from the ward footprint")


if __name__ == "__main__":
    _self_test()
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python3 scripts/_sentinel.py`
Expected: FAIL — `NameError: name 'grid_for' is not defined`

- [ ] **Step 3: Implement**

Replace `GRID = FOOTPRINT_M // 10` (line 104) with:

```python
def grid_for(footprint_m: float) -> int:
    """Cells per side at Sentinel-2's 10 m native posting.

    WAS `GRID = FOOTPRINT_M // 10`, a module constant baked at Kolkata's 1400 m.
    Bengaluru's wards are 2800 m and need 280, and the failure mode of getting
    this wrong is not an exception — it is a correctly-shaped array holding the
    wrong quarter of the ward.
    """
    if footprint_m % 10 != 0:
        raise ValueError(f"footprint {footprint_m} m is not a whole number of 10 m cells")
    return int(footprint_m // 10)
```

Change `read_window(href, lat, lon)` to `read_window(href, lat, lon, footprint_m)`, replacing its internal `FOOTPRINT_M` with the parameter and `GRID` with `grid_for(footprint_m)`. Update both callers in `fetch-sentinel-composites.py` and `export-surface-rasters.py`.

- [ ] **Step 4: Run it and watch it pass**

Run: `python3 scripts/_sentinel.py`
Expected: `_sentinel: grid derives from the ward footprint`

- [ ] **Step 5: Prove Kolkata is unchanged**

Run: `npm run typecheck && npm run test:py`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/_sentinel.py scripts/fetch-sentinel-composites.py scripts/export-surface-rasters.py
git commit -m "refactor(sentinel): the grid derives from the ward footprint

GRID was a module constant baked at Kolkata's 1400 m. Getting it wrong for a
2800 m ward does not raise — it returns a correctly-shaped array holding the
wrong quarter of the ward."
```

---

### Task 6: Build Bengaluru's surface rasters

**Files:**
- Modify: `scripts/export-surface-rasters.py` (ward source)

The endmembers were verified to transfer on 2026-09-11: NDVI p99 0.741 against an 0.8 upper endmember, 0.03 % saturating, mean FVC 0.344 between Ballygunge's 0.329 and Baruipur's 0.447. **No recalibration.**

- [ ] **Step 1: Point the exporter at the Bengaluru registry**

**This step's premise is out of date — read this before following it.** It told
you to replace `_sentinel.py`'s module-level `WARDS` dict. **That dict no longer
exists**: Task 5 deleted it (`fbb0c39`) because it was a third copy of
`_types.WARDS`, already flagged as diverged at `dump-parity-oracle.py:69`. The
remaining seam is the exporter's own ward source, plus a CLI.

**The real work is a type bridge, and it needs doing deliberately.** The two
Python ward tables are *different NamedTuples with different field names and
different types*:

| | table | field | type |
|---|---|---|---|
| Kolkata | `scripts/_types.py:80` | `footprint_m` | **`int`** |
| Bengaluru | `scripts/_bangalore.py:70` | `size_m` | **`float`** (`2800.0`) |

So `uniform_grid(Iterable[_types.Ward])` **cannot accept `_bangalore.WARDS`
at all**, and `grid_for` demands an `int` on purpose — a float `%` is a trap in
both directions (`1400.0000000001` raises where it should pass, `1399.9999`
passes where it should fail).

**Do not sprinkle a silent `int()` at the call site.** Convert once, and assert
wholeness where you convert, so a non-integral ward size is a named refusal
rather than a truncation:

```python
size = w.size_m
if size != int(size):
    raise ValueError(f"{w.id}: ward size {size} m is not a whole number of metres")
n = grid_for(int(size))
```

Also note `search()` gained a required `footprint_m` in `f0cc26f` — it now
refuses scenes that merely *touch* the search box instead of containing the
ward. Pass the Bengaluru footprint, not a Kolkata default.

**If Bengaluru comes back with too few scenes, suspect that filter first.**
`export-surface-rasters.py` refuses a composite under three scenes, by design.
A thin result means the containment filter is rejecting partial-coverage tiles
— check how many candidates it dropped before loosening anything, because
loosening it is how a quarter-empty raster gets shipped.

- [ ] **Step 2: Run it for the three Bengaluru wards**

**No credentials are needed.** This line used to say to export
`GOOGLE_APPLICATION_CREDENTIALS`; that was wrong. `export-surface-rasters.py`
imports only argparse/json/os/sys/numpy/PIL/`_types`/`_sentinel`, and `_sentinel`
reads the unauthenticated AWS `earth-search` STAC over plain `curl`. Earth Engine
is not on this path — don't go hunting for a service account.

```bash
python3 scripts/export-surface-rasters.py --ward indiranagar
python3 scripts/export-surface-rasters.py --ward mg-road
python3 scripts/export-surface-rasters.py --ward whitefield
```

Expected: three files at `public/heat-map/data/<ward>-surface.png`, each 280×280.

- [ ] **Step 3: Verify the vegetation is plausible, not just present**

```bash
python3 - <<'EOF'
from PIL import Image
import numpy as np
for w in ("indiranagar","mg-road","whitefield"):
    a = np.asarray(Image.open(f"public/heat-map/data/{w}-surface.png")).astype(float)
    veg = a[:,:,0] / 255.0
    print(f"{w:<12} {a.shape[0]}x{a.shape[1]}  veg mean {veg.mean():.3f}  "
          f"p5 {np.percentile(veg,5):.3f}  p95 {np.percentile(veg,95):.3f}")
EOF
```

Expected: 280×280, veg mean roughly 0.25–0.45.
**A mean within 0.001 of a single value across all three wards means the raster is uniform and the fetch silently failed** — that is the exact failure this artefact exists to prevent.

- [ ] **Step 4: Commit**

```bash
git add public/heat-map/data/*-surface.png scripts/export-surface-rasters.py scripts/_sentinel.py
git commit -m "feat(bangalore): Sentinel-2 surface rasters for the three wards

Endmembers verified to transfer before running: NDVI p99 0.741 against an 0.8
upper endmember, 0.03 % saturating, mean FVC 0.344 — between Ballygunge's
0.329 and Baruipur's 0.447. No recalibration.

Without this the ward collapses to ONE uniform vegetation value and nothing
errors, which is why the check asserts spatial variance rather than presence."
```

---

### Task 7: Export the Bangalore artefacts into OBOS's shapes

**Files:**
- Create: `scripts/export-bangalore-obos.py`

- [ ] **Step 1: Write the script**

Create `scripts/export-bangalore-obos.py`:

```python
"""data/bangalore/* -> the shapes public/heat-map/data/ serves.

THE RINGS SHIP EVEN THOUGH THEY ARE NOT DRAWN. `rasterizeWardBuilt` stamps every
ring into the `built` grid the heat model solves on, and `building-pick.ts`
projects their centroids to hit-test a click. The glTF is what gets DRAWN; this
file is what gets SOLVED and PICKED.

    python3 scripts/export-bangalore-obos.py
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _bangalore as blr                            # noqa: E402

OUT = os.path.join(blr.ROOT, "public", "heat-map", "data")


def export_buildings(w: blr.Ward) -> None:
    with open(os.path.join(blr.DATA, f"{w.id}-buildings.json"), encoding="utf-8") as fh:
        src = json.load(fh)
    # OBOS's `b` row is [height, x, z, x, z, ...]. Our `p` is [x, y, x, y, ...]
    # with +y north, and OBOS's z IS that y — verified against the exported glTF
    # bounds, which run -1400..1431 on x and -1416..1434 on z.
    rows: list[list[float]] = []
    for b in src["b"]:
        p = b["p"]
        if len(p) < 6:
            continue
        rows.append([round(float(b["h"]), 2), *[round(float(v), 1) for v in p]])
    doc: dict[str, Any] = {
        "name": w.id, "type": src.get("zone", ""),
        "center": [w.centre.lat, w.centre.lon], "sizeM": w.size_m,
        "count": len(rows), "source": src["source"],
        "heightsNote": src["heightNote"],
        "heightTiers": src.get("heightTiers", {}),
        "b": rows,
    }
    with open(os.path.join(OUT, f"{w.id}.json"), "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    print(f"  {w.id:<12} {len(rows):6,} buildings -> {w.id}.json")


def export_context(w: blr.Ward) -> None:
    """roads and water, in the contracts RoadsData and WaterData describe."""
    path = os.path.join(blr.DATA, f"{w.id}-context.json")
    with open(path, encoding="utf-8") as fh:
        ctx = json.load(fh)
    roads = {"ways": [{"w": 2.0, "p": r["line"]} for r in ctx.get("roads", []) if r.get("line")]}
    with open(os.path.join(OUT, f"{w.id}-roads.json"), "w", encoding="utf-8") as fh:
        json.dump(roads, fh, separators=(",", ":"))
    water = {"polys": [{"k": str(x.get("cls", "water")), "p": x["p"]}
                       for x in ctx.get("water", []) if x.get("p")]}
    with open(os.path.join(OUT, f"{w.id}-water.json"), "w", encoding="utf-8") as fh:
        json.dump(water, fh, separators=(",", ":"))
    print(f"  {w.id:<12} roads {len(roads['ways']):5,}  water {len(water['polys']):4,}")


def export_trees(w: blr.Ward) -> None:
    with open(os.path.join(blr.DATA, f"{w.id}-canopy.json"), encoding="utf-8") as fh:
        cn = json.load(fh)
    doc = {"ward": w.id, "grid": cn["grid"], "sizeM": w.size_m,
           "retrieved": "2026-09-11", "source": cn["source"],
           "densityRefM": cn["densityRefM"],
           "trees": [{"x": t["x"], "y": t["y"], "h": t["h"], "r": t["r"],
                      "species": "neem"} for t in cn["trees"]]}
    with open(os.path.join(OUT, f"{w.id}-trees.json"), "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    print(f"  {w.id:<12} trees {len(doc['trees']):6,}")


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    for w in blr.WARDS.values():
        export_buildings(w)
        export_context(w)
        export_trees(w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Type-check and run**

Run: `npm run typecheck`
Expected: PASS.
Run: `python3 scripts/export-bangalore-obos.py`
Expected: three wards, each printing building, road, water and tree counts.

- [ ] **Step 3: Verify the frame survived the conversion**

```bash
node --import tsx -e "
import { readFileSync } from 'node:fs';
const w = JSON.parse(readFileSync('public/heat-map/data/mg-road.json','utf8'));
const xs = w.b.flatMap(r => r.slice(1).filter((_,i)=>i%2===0));
const zs = w.b.flatMap(r => r.slice(1).filter((_,i)=>i%2===1));
console.log('x', Math.min(...xs).toFixed(0), Math.max(...xs).toFixed(0));
console.log('z', Math.min(...zs).toFixed(0), Math.max(...zs).toFixed(0));
console.log('sizeM', w.sizeM, 'count', w.count);
"
```

Expected: x and z both roughly −1400 to +1400, `sizeM` 2800.
**If either axis spans −2800 to 0 the frame is offset**, and the mirror gate in Task 8 will catch it.

- [ ] **Step 4: Commit**

```bash
git add scripts/export-bangalore-obos.py public/heat-map/data/
git commit -m "feat(bangalore): export the ward artefacts into OBOS's shapes

The rings ship even though the glTF is what gets drawn: the solver rasterises
them into `built`, and picking projects their centroids to hit-test a click.
Drawn and solved are different jobs from the same measurement."
```

---

**Before this task flips `PUBLISHED_CITIES`, fix the sibling fallback.**
The Task 2b review found `src/scripts/climate-engine/compare/scenario-url.ts:21-22`:

```typescript
const a = isWardId(requestedA) ? requestedA : DEFAULT_PAIRED_SCENARIO.a;
```

The requested ward is gated against the published set; **the default it falls
back to is not**. Task 2b fixed exactly this bug class in `nextDistinctWard`
(which now throws a `RangeError` naming `PUBLISHED_CITIES`) and left this
instance, in a file it did not touch.

Harmless while both defaults are published Kolkata wards. **The event that
makes it live is this task** — the moment `PUBLISHED_CITIES` gains a city, a
default that names an unpublished ward puts a 404 behind the opening view.
Assert `DEFAULT_PAIRED_SCENARIO`'s two wards are published, at module load, so
it fails at build rather than in a user's browser.

---

**THE RASTERS TASK 6 BUILT ARE CURRENTLY INERT, AND THE FALLBACK RUNS HOT.**

`src/scripts/climate-engine/surface-raster.ts:221`, `loadWardSurface`:

```typescript
const record = inputs?.[ward];
if (!surface || !record) return { means, surface: null };
```

`inputs` is `dc-urs-inputs.json`, which is **Kolkata-only**. So for every
Bengaluru ward the measured texture is fetched, decoded, and then **thrown
away**, and the ward falls back to a uniform field at `fvc: 0, albedo: 0.2`.

**Zero vegetation is a hot-biased fallback.** This is the worst failure shape
this project knows: Bengaluru would render, would look plausible, would run
warm, and every number would be fabricated. Nothing throws. The measured
0.401 / 0.388 / 0.370 would never reach a pixel.

Fix it in this task, before anything draws a Bengaluru ward. Two routes:

- **Teach `loadWardSurface` to accept `level: "measured"`** from
  `surface-meta.json`, which is where Bengaluru's real means already live
  (`fvc_mean` / `albedo_mean` rather than `fvc_target` / `albedo_target`). This
  is preferred — it keeps the measured path first-class instead of making every
  new city wait for a DC-URS scalar.
- Or give the Bengaluru wards `dc-urs-inputs.json` records. **Do not invent the
  numbers to do it** — see Task 12b on `Ward.veg`, where exactly this shortcut
  was refused.

Whichever you pick, prove it: assert a Bengaluru ward's loaded surface is NOT
uniform and NOT `fvc: 0`. A test that only checks "a surface came back" passes
against the bug.

---

### Task 8: The artefact gate

**Files:**
- Create: `scripts/check-bangalore-artefacts.py`
- Modify: `src/scripts/climate-engine/explore/relief-renderer.ts` (Step 4b)

- [ ] **Step 1: Write the gate**

Create `scripts/check-bangalore-artefacts.py`:

```python
"""Every artefact OBOS fetches for a Bengaluru ward is present and coherent.

THE SURFACE RASTER IS THE POINT. `loadSurfaceRaster` returns null when it is
missing and the ward silently collapses to ONE uniform vegetation value — the
heat field driven by buildings alone, no error anywhere. This gate refuses that.

    python3 scripts/check-bangalore-artefacts.py
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _bangalore as blr                            # noqa: E402

OUT = os.path.join(blr.ROOT, "public", "heat-map", "data")
REQUIRED = ("{w}.json", "{w}-roads.json", "{w}-water.json",
            "{w}-trees.json", "{w}-surface.png")


def main() -> int:
    failures: list[str] = []
    for w in blr.WARDS.values():
        for pattern in REQUIRED:
            path = os.path.join(OUT, pattern.format(w=w.id))
            if not os.path.exists(path):
                failures.append(f"{w.id}: missing {os.path.basename(path)}")
                continue
            if os.path.getsize(path) == 0:
                failures.append(f"{w.id}: {os.path.basename(path)} is empty")

        bpath = os.path.join(OUT, f"{w.id}.json")
        if os.path.exists(bpath):
            with open(bpath, encoding="utf-8") as fh:
                doc = json.load(fh)
            if abs(float(doc["sizeM"]) - w.size_m) > 1e-6:
                failures.append(f"{w.id}: sizeM {doc['sizeM']} != registry {w.size_m}")
            if doc["count"] != len(doc["b"]):
                failures.append(f"{w.id}: count {doc['count']} != {len(doc['b'])} rows")
            # NOT an absolute bound, and NOT a sample. Both were wrong:
            #   · `size/2 + 40` is 1440 m, and Whitefield's z legitimately
            #     reaches 1443 — a building whose centroid sits inside the box
            #     carries ring vertices up to its own width past the edge. The
            #     old bound refused correct data.
            #   · `doc["b"][:2000]` inspected 13 % of 14,867 rows, so whether
            #     the gate fired at all was luck.
            # What this gate is FOR is a mirrored or offset frame — the failure
            # this codebase has shipped twice. |lo + hi| is ~0 when centred and
            # ~size when offset, separating the two by three orders of
            # magnitude instead of quibbling over a few metres of overhang.
            xs = [float(row[i]) for row in doc["b"] for i in range(1, len(row), 2)]
            zs = [float(row[i]) for row in doc["b"] for i in range(2, len(row), 2)]
            for axis, vals in (("x", xs), ("z", zs)):
                lo, hi = min(vals), max(vals)
                skew = abs(lo + hi) / w.size_m
                if skew > 0.05:
                    failures.append(
                        f"{w.id}: {axis} spans {lo:.0f}..{hi:.0f}, skew {skew:.1%} — "
                        f"the frame is offset or mirrored, not merely overhanging")
                if max(abs(lo), abs(hi)) > w.size_m / 2 + 120.0:
                    failures.append(
                        f"{w.id}: {axis} reaches {max(abs(lo), abs(hi)):.0f} m, beyond "
                        f"any plausible building overhang")

        spath = os.path.join(OUT, f"{w.id}-surface.png")
        if os.path.exists(spath):
            a = np.asarray(Image.open(spath)).astype(float)
            veg = a[:, :, 0] / 255.0
            if float(veg.std()) < 0.01:
                failures.append(
                    f"{w.id}: surface raster has no spatial variance (std "
                    f"{veg.std():.4f}) — this is the silent-uniform-vegetation "
                    f"failure the artefact exists to prevent")
            print(f"  {w.id:<12} veg mean {veg.mean():.3f} std {veg.std():.3f} "
                  f"grid {a.shape[0]}x{a.shape[1]}")

    if failures:
        for f in failures:
            print(f"  FAIL {f}")
        return 1
    print("\n  every Bengaluru artefact present, sized and spatially varying")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Type-check and run**

Run: `npm run typecheck && python3 scripts/check-bangalore-artefacts.py`
Expected: three lines of veg statistics, then the success line.

- [ ] **Step 3: Mutation-check the uniform-vegetation trap**

```bash
python3 - <<'EOF'
from PIL import Image
import numpy as np, shutil
shutil.copy('public/heat-map/data/mg-road-surface.png', '/tmp/mg-surface-backup.png')
a = np.asarray(Image.open('public/heat-map/data/mg-road-surface.png')).copy()
a[:, :, 0] = 88                       # flatten vegetation to one value
Image.fromarray(a).save('public/heat-map/data/mg-road-surface.png')
EOF
python3 scripts/check-bangalore-artefacts.py; echo "exit=$? (want 1)"
cp /tmp/mg-surface-backup.png public/heat-map/data/mg-road-surface.png
python3 scripts/check-bangalore-artefacts.py >/dev/null; echo "restored exit=$? (want 0)"
```

- [ ] **Step 3b: Mutation-check the frame invariant too**

The variance trap above proves the surface half of the gate. The frame half
needs its own proof, and this codebase has shipped a mirrored render twice —
measured spans on the real artefacts are `indiranagar` x −1422…1417,
`mg-road` z −1434…1416, `whitefield` z −1400…1443, all under 1.6 % skew.

```bash
python3 - <<'EOF'
import json, shutil
p = 'public/heat-map/data/whitefield.json'
shutil.copy(p, '/tmp/whitefield-backup.json')
doc = json.load(open(p))
for row in doc['b']:                       # offset every x by half a ward
    for i in range(1, len(row), 2):
        row[i] = row[i] - 1400.0
json.dump(doc, open(p, 'w'), separators=(',', ':'))
EOF
python3 scripts/check-bangalore-artefacts.py; echo "exit=$? (want 1, naming skew)"
cp /tmp/whitefield-backup.json public/heat-map/data/whitefield.json
python3 scripts/check-bangalore-artefacts.py >/dev/null; echo "restored exit=$? (want 0)"
```

Then repeat with a MIRROR (`row[i] = -row[i]` on one axis) and record what
happens. A pure mirror about a centred origin leaves the skew unchanged, so if
it passes, say so plainly rather than claiming the gate catches mirrors — the
mirror guard for Bengaluru is `scripts/check-bangalore-frame.py`, and this step
is where you confirm which of the two actually owns that job.

- [ ] **Step 4: Wire it into the verify chain**

In `package.json`, add `"check:bangalore": "python3 scripts/check-bangalore-artefacts.py"` and append ` && npm run check:bangalore` to the `verify` script.

- [ ] **Step 4b: The relief renderer still sizes its field buffers once**

A comment is not a task. `src/scripts/climate-engine/heat-map-app.ts:866-871`
states this defect plainly — "the day a city with a different pair ships, this
must be re-read on setWard" — and assigns it to nobody. It is assigned here.

`src/scripts/climate-engine/explore/relief-renderer.ts:63-67` allocates
`heatData`, `blur` and `heatTexture` in the constructor, from the
`simulationGridSize` of whichever ward was open when the Three chunk resolved.
`setWard` (`:78-86`) updates `size.value` and rebuilds the scene but never
resizes those three, so the first Bengaluru ward opened after a Kolkata one
pours a 384² field into 192² buffers.

**What must change:** `setWard` re-reads the pair from `bundle.wardData.sizeM`
and, when `n` differs, reallocates `heatData` and `blur` and replaces
`heatTexture` — a `DataTexture`'s dimensions are fixed at construction, so it is
disposed and rebuilt, and every material holding it re-pointed. `updateField`
then reads that `n` rather than `this.options.simulationGridSize`.

**Why it is safe to defer until here:** the failure is LOUD. `updateField`
already throws a `RangeError` on a field whose length is not `n * n`, so a
mismatched ward cannot mis-stride a buffer and draw a plausible-looking wrong
city — it refuses to draw at all. That is the opposite of the silent failure the
grid-pair work exists to prevent, where a wrong grid produces arrays of exactly
the right length and passes every bounds check. It must land before a Bengaluru
ward becomes selectable in Task 12, and the standing comment in `heat-map-app.ts`
is deleted when it does.

Commit this separately from the gate — it is renderer work, not artefact work.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-bangalore-artefacts.py package.json
git commit -m "test(bangalore): gate the artefacts, especially the surface raster

A missing surface raster does not error — the ward collapses to one uniform
vegetation value and the heat field is driven by buildings alone. The gate
asserts spatial VARIANCE rather than presence, and is mutation-checked by
flattening a raster and confirming it fails."
```

---

# PHASE 3 — Render

---

### Task 8b: Bengaluru's canopy is one species, and the founder asked for the best visuals

**Files:** `scripts/export-bangalore-obos.py` (the `species` field), reusing
`scripts/fetch-canopy.py:236`

Task 7 shipped **59,184 Bengaluru trees, every one `"neem"`**, because the
plan's snippet hard-coded it. Kolkata draws from a deterministic mix:

```python
SPECIES = ("neem", "neem", "gulmohar", "palm")   # deterministic broadleaf-dominant mix
```

giving Ballygunge 6,101 neem / 3,065 palm / 2,993 gulmohar. So Bengaluru — the
city briefed as *"this city shall have the best visuals and UX"* — will render
a visibly more monotone canopy than the city it is meant to surpass.

**The constraint that decides the fix.** `src/scripts/climate-engine/vegetation-layer.ts:3`
declares a CLOSED union:

```typescript
export type Species = 'neem' | 'gulmohar' | 'palm';
```

and `asTreesFile` rejects **the whole file** on a single unrecognised species
(`fetch-canopy.py:474-478` records this trap explicitly). So a botanically
truer Bengaluru palette — jacaranda, rain tree, African tulip — is **not** a
data change. It needs the union, the GLB templates and the loader widened
first. Do not reach for it here.

- [ ] **Step 1:** Reuse `fetch-canopy.py`'s existing `SPECIES` tuple and its
  deterministic per-tree draw, so Bengaluru gets Kolkata's mix from the same
  function rather than a second copy of the rule.
- [ ] **Step 2:** Assert the drawn set is a subset of the union, the way
  `fetch-canopy.py:478` already does — one bad species silently voids the
  entire canopy layer.
- [ ] **Step 3:** Print the per-ward species counts, and confirm no ward is
  single-species.

**Say plainly what this is.** Species is a DISPLAY DRAW in both cities — the
canopy height model gives height, never taxon. This is not a measurement and
must never be described as one; it is a plausible palette, chosen the same
deterministic way for both cities. Widening the union to real Bengaluru species
would make it *look* more authoritative while remaining just as invented, which
is the argument for leaving the union alone until someone has actual species
data.

---

### Task 8c: MG Road loses 41 % of its water features, and it shows

**File:** `scripts/export-bangalore-obos.py` (`export_context`)

Task 7 exported water **polygons** and dropped water **centrelines**, because
`WaterData.polys` has nowhere to put a line and buffering one would invent a
width nobody measured. Measured losses:

| ward | source features | exported polys | centrelines dropped |
|---|---|---|---|
| indiranagar | 39 | 13 | 26 (67 %) |
| mg-road | 90 | 53 | **37 (41 %)** |
| whitefield | 92 | 63 | 29 (32 %) |

**Nothing is lost from the physics today** — `rasterizeWardWater` is gated off
behind `WATER_LAYER_ENABLED = false`. The loss is to the RENDERED layer, and at
MG Road it is largely the storm canals. A local would notice they are missing,
in the city briefed for the best visuals.

Until now this existed only in a docstring and a commit message. Recording it
the way [[Task 8b]] records the neem canopy, because an invisible omission that
only the author knows about is how a render quietly stops matching the place.

- [ ] **Step 1:** Decide deliberately between three options, and say which:
  (a) leave it, and note the omission in the ward's provenance so the gap is
  stated rather than hidden; (b) widen `WaterData` to carry a line plus a
  rendered width, marking the width as a DISPLAY choice, never a measurement;
  (c) buffer the centrelines at a documented nominal width — **only** if that
  width is sourced, not guessed.
- [ ] **Step 2:** Whatever is chosen, the dropped count must be visible outside
  the exporter's stdout — in the artefact gate, the provenance manifest, or
  both. The lines remain in `data/bangalore/`, so nothing needs re-fetching.

---

### Task 9: Export the web models

**Files:**
- Modify: `scripts/blender_bangalore.py` (already has `export_web_glb`)

- [ ] **Step 1: Export all three, and the master**

```bash
mkdir -p public/heat-map/models
for w in indiranagar mg-road whitefield; do
  /Applications/Blender.app/Contents/MacOS/Blender --background \
    --python scripts/blender_bangalore.py -- --ward $w --webglb 1 --samples 4 --res 400 --out /tmp/x.png
  cp data/bangalore/scenes/$w-web.glb public/heat-map/models/$w.glb
done
ls -la public/heat-map/models/
```

Expected: three files, each roughly 0.2–0.4 MB.

- [ ] **Step 2: Verify each carries its landmarks as named nodes**

```bash
python3 - <<'EOF'
import struct, json, glob, os
for p in sorted(glob.glob("public/heat-map/models/*.glb")):
    b = open(p, "rb").read(); ln = struct.unpack_from("<I", b, 12)[0]
    j = json.loads(b[20:20+ln])
    lm = [n["name"] for n in j.get("nodes", []) if n.get("name", "").startswith("lm.")]
    print(f"  {os.path.basename(p):<20} {os.path.getsize(p)/1e6:5.2f} MB  "
          f"{len(j.get('nodes',[])):3d} nodes  {len(lm):3d} landmarks  "
          f"{j.get('extensionsUsed',[])}")
EOF
```

Expected: `KHR_draco_mesh_compression` on each; landmark counts 0 for Indiranagar, 12 for MG Road, 35 for Whitefield.
**Indiranagar's zero is correct** — 142 named buildings on measured evidence, none over 40 m.

- [ ] **Step 3: Commit**

```bash
git add public/heat-map/models/
git commit -m "feat(bangalore): web models for the three wards

Buildings merged, landmarks as named nodes, Draco-compressed. 11,025 buildings
and 12 landmarks reach 0.27 MB, against a 2.00 MB river model the site already
streams on mobile."
```

---

### Task 10: The model loader, with fallback

**Files:**
- Create: `src/scripts/climate-engine/explore/building-model.ts`
- Modify: `src/scripts/climate-engine/explore/relief-renderer.ts` (the extrusion at ~line 240)

- [ ] **Step 1: Read the code you are replacing**

Run: `sed -n '230,260p' src/scripts/climate-engine/explore/relief-renderer.ts`
You will see a loop over `bundle.wardData.b` building a `THREE.Shape` per footprint and an `ExtrudeGeometry` with bevels. **Keep that code** — it becomes the fallback path, not deleted code.

- [ ] **Step 2: Write the loader**

Create `src/scripts/climate-engine/explore/building-model.ts`:

```typescript
/**
 * Buildings as a Draco-compressed glTF, with extrusion as the fallback.
 *
 * WHY A MODEL AND NOT EXTRUSION. The Blender scenes carry landmark massing and
 * authored form that a footprint ring cannot express — an extruded outline can
 * never be a stepped dome.
 *
 * WHY THE RINGS STILL SHIP. The solver rasterises them into `built`, and
 * building-pick.ts projects their centroids to hit-test a click. Picking never
 * touched the mesh, so swapping the geometry breaks no interaction.
 *
 * WHY THE FALLBACK IS FREE. The rings are already loaded for those two reasons,
 * so a missing model or a low device tier degrades to exactly what Kolkata
 * renders today rather than to nothing.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export interface BuildingModel {
  /** merged building mesh, ward-local metres, x east / y up / z north */
  buildings: THREE.Object3D;
  /** one entry per `lm.` node, in the same frame */
  landmarks: { name: string; object: THREE.Object3D; heightM: number; source: string }[];
}

export async function loadBuildingModel(
  ward: string, signal?: AbortSignal,
): Promise<BuildingModel | null> {
  try {
    const response = await fetch(`/heat-map/models/${ward}.glb`, { signal });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('/draco/');
    loader.setDRACOLoader(draco);
    const gltf = await loader.parseAsync(buffer, '');
    const group = new THREE.Group();
    const landmarks: BuildingModel['landmarks'] = [];
    for (const child of [...gltf.scene.children]) {
      if (child.name.startsWith('lm.')) {
        const extras = (child.userData ?? {}) as Record<string, unknown>;
        landmarks.push({
          name: child.name.slice(3),
          object: child,
          heightM: Number(extras.height_m ?? 0),
          source: String(extras.height_source ?? ''),
        });
      }
      group.add(child);
    }
    return { buildings: group, landmarks };
  } catch {
    return null;                 // any failure falls back to extrusion
  }
}
```

- [ ] **Step 3: Wire it in, keeping extrusion as the fallback**

In `relief-renderer.ts`, wrap the existing extrusion loop in a function `extrudeBuildings(bundle)` returning the same object it produces today. Then at the call site:

```typescript
const model = deviceTier === 'low' ? null : await loadBuildingModel(wardId, signal);
const buildings = model ? model.buildings : extrudeBuildings(bundle);
```

- [ ] **Step 4: Verify the type gate and the module boundary**

Run: `npm run check`
Expected: PASS.
Run: `node --import tsx --test tests/unit/heat-explore-module-boundary.test.mjs`
Expected: PASS — this test guards what the explore module may import; if it fails, the loader is importing something the boundary forbids.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/climate-engine/explore/
git commit -m "feat(heat): draw buildings from a glTF, falling back to extrusion

Picking is untouched: it projects footprint centroids from the ring array and
never read the mesh. The rings ship regardless because the solver rasterises
them, which is what makes the fallback free — a missing model or a low device
tier degrades to exactly what Kolkata renders today."
```

---

# PHASE 4 — Landmarks

---

### Task 11: The landmark layer

**Files:**
- Create: `src/scripts/climate-engine/explore/landmark-layer.ts`

- [ ] **Step 1: Write the test first**

Create `tests/unit/landmark-provenance.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/* A height with no stated source is not shown as a landmark. That is the rule
   the Dubai scenes enforce, and the reason the stadium's estimated roof line is
   flagged as estimated rather than cited. */

function landmarksOf(ward) {
  const out = execSync(`python3 - <<'EOF'
import struct, json
b = open("public/heat-map/models/${ward}.glb","rb").read()
ln = struct.unpack_from("<I", b, 12)[0]
j = json.loads(b[20:20+ln])
print(json.dumps([n for n in j.get("nodes",[]) if n.get("name","").startswith("lm.")]))
EOF`, { encoding: 'utf8' });
  return JSON.parse(out);
}

test('every landmark node carries a height and a source', () => {
  for (const ward of ['mg-road', 'whitefield']) {
    for (const node of landmarksOf(ward)) {
      const extras = node.extras ?? {};
      assert.ok(Number(extras.height_m) > 0, `${ward}/${node.name}: no height_m`);
      assert.ok(String(extras.height_source ?? '').length > 3,
        `${ward}/${node.name}: no height_source — a height with no stated source is not a landmark`);
    }
  }
});

test('Indiranagar has no landmarks, and that is correct', () => {
  assert.equal(landmarksOf('indiranagar').length, 0,
    '142 named buildings on measured evidence, none over 40 m — a low-rise ward');
});
```

- [ ] **Step 2: Run it**

Run: `node --import tsx --test tests/unit/landmark-provenance.test.mjs`
Expected: FAIL if the Blender exporter is not writing `extras` onto the glTF nodes.

- [ ] **Step 3: Make Blender write the custom properties into the glTF**

In `scripts/blender_bangalore.py`, the landmark objects already carry `height_m` and `height_source` as Blender custom properties. The glTF exporter maps custom properties to node `extras` only when `export_extras=True`. Add it to the `export_web_glb` call:

```python
            export_extras=True,
```

Re-run Task 9's export, then re-run this test. Expected: PASS.

- [ ] **Step 4: Build the layer**

Create `src/scripts/climate-engine/explore/landmark-layer.ts` exposing:

```typescript
export interface LandmarkPick { name: string; heightM: number; source: string; }

/** Screen-space labels for landmark nodes, and hit-testing by projected centroid —
 *  the same technique building-pick.ts uses, and for the same reason: the camera
 *  inside MapLibre's custom layer cannot support a raycaster. */
export function createLandmarkLayer(
  landmarks: { name: string; object: THREE.Object3D; heightM: number; source: string }[],
): {
  labelsFor(clip: { elements: number[] }, width: number, height: number):
    { name: string; x: number; y: number }[];
  pick(clip: { elements: number[] }, x: number, y: number, width: number, height: number,
       radiusPx: number): LandmarkPick | null;
  dispose(): void;
};
```

Reuse `projectWard` from `building-pick.ts` rather than writing a second projection — two copies of a projection is how the frame drifts.

- [ ] **Step 5: Run the gates and commit**

Run: `npm run check && npm run test:unit`

```bash
git add src/scripts/climate-engine/explore/landmark-layer.ts tests/unit/landmark-provenance.test.mjs scripts/blender_bangalore.py public/heat-map/models/
git commit -m "feat(heat): the landmark layer, and the rule that gates it

A height with no stated source is not drawn as a landmark. Indiranagar's zero
landmarks is asserted as CORRECT rather than tolerated: 142 named buildings on
measured evidence, none over 40 m.

Projection is reused from building-pick rather than reimplemented — two copies
of a projection is how a frame drifts."
```

---

# PHASE 5 — The city chip

---

### Task 12: Render tabs and cards from the registry

**READ FIRST — which list do you render?** Task 2 filters the *publication*
surface: `allWards()` and `CITIES` hold all six wards, while `WARDS` in
`src/data/wards.ts` is gated by `PUBLISHED_CITIES` to Kolkata only until
Bengaluru's artefacts land (Tasks 7–8).

So: render the **city chip and its wards from `CITIES` / `wardsOfCity()`**, not
from `WARDS`. Reading `WARDS` would render three tabs and Bengaluru would
silently never appear no matter how much data existed. Reading `allWards()`
flat would render six tabs with no data behind three.

**Files:**
- Modify: `src/components/ClimateEngine/HeatMapStage.astro:19-21` (tabs), `:290-292` (cards)

- [ ] **Step 1: Replace the hard-coded tabs**

```astro
---
import { CITIES, wardsOfCity } from '../../data/cities.ts';
const activeCity = 'bengaluru';
const wards = wardsOfCity(activeCity);
---
<div class="cityChip" id="cityChip" data-city={activeCity}>
  {CITIES[activeCity].name} <span class="car">▾</span>
</div>
<div class="tabs" id="tabs">
  {wards.map((w, i) => (
    <button class={`tab${i === 0 ? ' on' : ''}`} data-w={w.id} set:html={w.name} />
  ))}
</div>
```

- [ ] **Step 2: Replace the hard-coded ward cards** at line 290 with the same `wards.map(...)`, keeping the existing `.ward`, `.sw`, `.nm`, `.ty` and `.big` classes and their inline gradients moved into a per-ward `swatch` field on the registry.

- [ ] **Step 3: Add the chip's CSS**, matching the tab strip it sits beside:

```css
.cityChip{font-family:var(--mono);font-size:.6rem;letter-spacing:.14em;
  text-transform:uppercase;color:var(--paper);background:var(--surface2);
  border:1px solid var(--line);border-radius:10px;padding:.62rem 1rem;cursor:pointer}
.cityChip .car{color:var(--cyan);margin-left:.5rem}
```

- [ ] **Step 4: Declare the resolution in the readout**

In the `.read` block, add the city's declared cell size:

```astro
<span id="cityRes">{CITIES[activeCity].cellMeters.toFixed(2)} m cells</span>
```

- [ ] **Step 5: Verify and commit**

Run: `npm run check && npm run build`
Expected: PASS.

```bash
git add src/components/ClimateEngine/HeatMapStage.astro src/data/cities.ts
git commit -m "feat(obos): the city chip, and tabs rendered from the registry

Two of the four hard-coded ward lists were hand-written markup in this file.
Both now derive from the registry, so a fourth ward is a data change.

The readout declares the city's cell size, because a third city may not have
the data for 7.29 m and the instrument should say so rather than degrade."
```

---

### Task 12b: `Ward.veg` — measured, and do NOT just overwrite it

**File:** `src/data/cities.ts:50, 67-85`

Task 6 measured Bengaluru's real vegetation fraction, so the registry's
`veg: 0.344` on all three Bengaluru rows is now *provably* wrong per ward
(measured 0.401 / 0.388 / 0.370). The obvious fix — paste the measured numbers
in — is wrong, and here is the measurement that says so:

| ward | registry `veg` | measured `fvc_target` |
|---|---|---|
| ballygunge | 0.12 | **0.3291** |
| baruipur | 0.62 | **0.4469** |
| barrackpore | 0.28 | **0.3089** |
| indiranagar | 0.344 | 0.401 (measured, unpinned) |
| mg-road | 0.344 | 0.388 (measured, unpinned) |
| whitefield | 0.344 | 0.370 (measured, unpinned) |

**Kolkata's `veg` is not a vegetation fraction.** It disagrees with measured FVC
by −64 %, +39 % and −9 %, and it does not even preserve the rank order
(registry says Baruipur ≫ Barrackpore > Ballygunge; FVC says Baruipur >
Ballygunge > Barrackpore). Writing measured FVC into the Bengaluru rows would
put **three rows in one unit and three in another**, inside a single column —
worse than a uniform placeholder, because it would look authoritative.

**The field is read by nothing.** Verified across `src/`, `scripts/` and
`tests/`: no `ward.veg`, no `WARD_MAP[…].veg`, no destructure, no mention in
`src/data/wards.ts`. Every `.veg` hit in the tree is a different thing — the
`base.veg` / `surface.veg` Float32Array raster layers, the three.js vegetation
layer, or a `.veg-lab` CSS class.

- [ ] **Step 1:** Establish what Kolkata's numbers actually are before writing
  any. Check the spec and `git log -S "veg: 0.12" -- src/data/cities.ts` for
  their provenance. They may be a hand-set display seed or an artefact of an
  older model.
- [ ] **Step 2:** Then pick ONE of: delete the column (it has no reader and the
  measured value already lives in `surface-meta.json`), or define its unit in a
  comment and populate all six rows consistently. **Do not populate three.**

---

### Task 13: Measure the browser load before tuning it

**Files:** none — this is a measurement.

- [ ] **Step 1: Build and serve**

```bash
npm run build && npx serve dist -p 4321 &
```

- [ ] **Step 2: Measure first paint and frame time for the heaviest ward**

Open `http://localhost:4321/heat-map/`, switch to Indiranagar (14,774 buildings, the heaviest), and record from the browser's performance panel: time to first rendered frame, and the frame time at rest with relief on.

- [ ] **Step 3: Compare against Kolkata**

Repeat for Ballygunge (3,527 buildings). **Record both numbers before changing anything.** The existing demotion tiers in `explore/runtime-budget.ts` exist for exactly this, and tuning them without a measurement is how a tier gets set to a number nobody can justify.

- [ ] **Step 4: Commit the measurement into the spec**

Append the two numbers to §10 of the design spec under "browser load measured", then:

```bash
git add docs/superpowers/specs/2026-09-11-project-bangalore-obos-design.md
git commit -m "docs(bangalore): browser load measured for the heaviest ward"
```

---

## Self-Review

**Spec coverage.** §1 decisions → Tasks 1, 2, 12. §2 architecture → Tasks 7, 9, 10. §3 picking unchanged → Task 10 Step 5 and the boundary test. §4 registry → Task 2. §5 grid → Tasks 1, 3. §6 artefacts → Tasks 5, 6, 7, 8. §7 landmarks → Task 11. §8 phasing → the phase headers. §9 failure modes → Tasks 1 (pair), 8 (surface raster), 10 (fallback), 11 (provenance). §10 testing → Tasks 1, 4, 8, 11, 13.

**Gaps found and closed while reviewing:** road-name labels and the layers/provenance manifests are named in §6 but had no task. They are **deliberately deferred** — both are cosmetic-to-degrading rather than blocking, and OBOS renders without them. Add them once Bangalore is on screen, so a missing label does not hold up the launch.

**Type consistency checked:** `gridFor`/`gridVersion`/`isAdmittedGrid`/`ADMITTED_GRIDS` are used identically in Tasks 1, 2 and 3. `WardRecord` in Task 2 is what `Ward` aliases. `loadBuildingModel` returns `BuildingModel | null` in Task 10 and is consumed as nullable at its call site.
