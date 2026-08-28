# OBOS Scope Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OBOS's hardcoded three-Kolkata-ward model with a Country → City → Area registry, so a second city can be added by data rather than by construction — with Kolkata rendering byte-identically.

**Architecture:** One `as const` registry is the single source of truth; `AreaKey` (`'in/kolkata/ballygunge'`) is *derived* from it so the type cannot drift from the data. A single `paths()` builder replaces 17 raw string interpolations. Four constants that belong to India or Kolkata move out of the physics module and are passed in. City tier is a new field beside — never merged with — the existing phase confidence.

**Tech Stack:** TypeScript (strict), Astro 7 (static/SSG), Node's built-in test runner via tsx (`tests/unit/*.test.mjs`).

**Spec:** `docs/superpowers/specs/2026-08-27-obos-scope-model-design.md`

---

## File Structure

| Path | Responsibility | Status |
|---|---|---|
| `src/scripts/climate-engine/scope/registry.ts` | The `as const` registry, `AreaKey`, `assertRegistryLogic()` | create |
| `src/scripts/climate-engine/scope/paths.ts` | Every data URL, built from the registry | create |
| `src/scripts/climate-engine/scope/resolve.ts` | `resolve(key)` → metas, tier, `ClimateConstants` | create |
| `src/scripts/climate-engine/wards.ts` | **DELETED** — redundant with `src/data/wards.ts` | delete |
| `src/data/wards.ts` | Unchanged. Stays THE area table; Python mirrors it | read only |
| `src/scripts/climate-engine/scope/legacy.ts` | Bare-ward compat map for shipped compare links | create |
| `src/scripts/climate-engine/ward-loader.ts` | Takes `AreaKey`, uses `paths()` | modify |
| `src/scripts/climate-engine/surface-raster.ts` | `string` → `AreaKey`, uses `paths()` | modify |
| `src/scripts/climate-engine/provenance.ts` | `string` → `AreaKey`, uses `paths()` | modify |
| `src/scripts/climate-engine/heat-map-app.ts` | Uses `paths()` for the 9-file bundle | modify |
| `src/scripts/climate-engine/heat-map-model.ts` | Constants leave; takes `climate` | modify |
| `src/scripts/climate-engine/scenario/scenario-url.ts` | `isAreaKey` + bare-ward compat | modify |
| `src/pages/heat-map/[country]/[city]/[area].astro` | The scoped route | create |
| `tests/unit/obos-scope.test.mjs` | Registry, paths, guards | create |
| `tests/unit/obos-golden-params.test.mjs` | The 24 frozen cases | create |
| `data/calibration/golden-params.json` | The captured baseline | create |

A new `scope/` directory keeps the three new modules together — they change together and nothing else needs them.

---

## Task 1: Freeze the baseline BEFORE anything changes

This must be first. It captures what `currentParams()` produces today, so every later task can prove it did not drift.

**Files:**
- Create: `tests/unit/obos-golden-params.test.mjs`
- Create: `data/calibration/golden-params.json` (generated in step 3)

- [ ] **Step 1: Write the test that generates the baseline on first run and asserts it thereafter**

Create `tests/unit/obos-golden-params.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { currentParams } from '../../src/scripts/climate-engine/heat-map-model.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GOLDEN = join(ROOT, 'data/calibration/golden-params.json');

// currentParams is WARD-INDEPENDENT: ScenarioState carries
// {live, phase, path, iv, heatTairC, sunNow} and no ward. So the matrix varies
// only what actually reaches it. 2 phases x 3 pathways x 2 live x 2 heatwave.
const LIVE = { tAir: 31.2, rh: 74, wind: 2.4, cloud: 40 };
const IV = { trees: 12, roof: 40, parks: 2, facades: 0 };

function matrix() {
  const out = {};
  for (const phase of ['peak', 'night']) {
    for (const path of ['2025', 'ssp245', 'ssp585']) {
      for (const [liveName, live] of [['nolive', null], ['live', LIVE]]) {
        for (const [hwName, heatTairC] of [['plain', null], ['heatwave', 41.5]]) {
          const key = `${phase}/${path}/${liveName}/${hwName}`;
          out[key] = currentParams({ live, phase, path, iv: IV, heatTairC });
        }
      }
    }
  }
  return out;
}

test('currentParams output is frozen against the pre-migration baseline', async () => {
  const now = matrix();
  assert.equal(Object.keys(now).length, 24, 'the matrix must be 24 cases');

  if (!existsSync(GOLDEN)) {
    await writeFile(GOLDEN, JSON.stringify(now, null, 2) + '\n');
    assert.fail('golden-params.json did not exist; it has been written. '
      + 'Inspect it, commit it, and re-run. It must be captured BEFORE any '
      + 'scope-model change lands, or it freezes the wrong thing.');
  }

  const golden = JSON.parse(await readFile(GOLDEN, 'utf8'));
  assert.deepEqual(now, golden,
    'currentParams drifted from the frozen baseline. If the change was '
    + 'intentional, say so explicitly and regenerate — do not edit the JSON.');
});
```

- [ ] **Step 2: Run it to generate the baseline**

Run: `node --import tsx --test tests/unit/obos-golden-params.test.mjs`
Expected: FAIL with "golden-params.json did not exist; it has been written."

- [ ] **Step 3: Run it again to confirm it now passes**

Run: `node --import tsx --test tests/unit/obos-golden-params.test.mjs`
Expected: PASS, 1 test.

- [ ] **Step 4: Sanity-check the captured file is not empty or all-identical**

Run:
```bash
python3 -c "
import json; d=json.load(open('data/calibration/golden-params.json'))
print('cases:', len(d))
vals = {json.dumps(v, sort_keys=True) for v in d.values()}
print('distinct:', len(vals))
assert len(d) == 24 and len(vals) > 8, 'baseline looks degenerate'
print('OK')"
```
Expected: `cases: 24`, `distinct:` a number above 8, then `OK`.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/obos-golden-params.test.mjs data/calibration/golden-params.json
git commit -m "test(obos): freeze currentParams output before the scope migration

24 cases: 2 phases x 3 pathways x 2 live states x 2 heatwave states.
currentParams is ward-independent -- ScenarioState carries no ward -- so the
matrix varies only what reaches it. This must land BEFORE any scope change,
or it freezes the wrong thing."
```

---

## Task 2: The registry and its derived key

**Files:**
- Create: `src/scripts/climate-engine/scope/registry.ts`
- Create: `tests/unit/obos-scope.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/obos-scope.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REGISTRY, AREA_KEYS, isAreaKey, splitKey, assertRegistryLogic,
} from '../../src/scripts/climate-engine/scope/registry.ts';

test('registry invariants hold', () => {
  assertRegistryLogic();
});

test('every registered area produces a key', () => {
  assert.ok(AREA_KEYS.includes('in/kolkata/ballygunge'));
  assert.ok(AREA_KEYS.includes('ae/dubai/al-quoz'));
  assert.equal(AREA_KEYS.length, 6);
});

test('isAreaKey rejects anything not registered', () => {
  assert.equal(isAreaKey('in/kolkata/ballygunge'), true);
  assert.equal(isAreaKey('in/kolkata/typo'), false);
  assert.equal(isAreaKey('ballygunge'), false);
  assert.equal(isAreaKey(''), false);
  assert.equal(isAreaKey(null), false);
});

test('splitKey returns the three parts', () => {
  assert.deepEqual(splitKey('in/kolkata/ballygunge'),
    { country: 'in', city: 'kolkata', area: 'ballygunge' });
});

test('Kolkata ships data and Dubai does not', () => {
  assert.equal(REGISTRY.in.cities.kolkata.areas.ballygunge.shipsData, true);
  assert.equal(REGISTRY.ae.cities.dubai.areas['al-quoz'].shipsData, false);
});

test('every data-shipping area exists in src/data/wards.ts', () => {
  // The guard that stops a FOURTH ward table appearing. _types.py records that
  // five scripts once carried private copies which had already diverged, one by
  // 10-44 m of coordinate -- four pixels at Sentinel's 10 m.
  assertRegistryLogic();   // throws with the offending id if not
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test tests/unit/obos-scope.test.mjs`
Expected: FAIL — cannot find module `scope/registry.ts`.

- [ ] **Step 3: Write the registry**

Create `src/scripts/climate-engine/scope/registry.ts`:

```ts
/**
 * Country -> City -> Area. The single source of truth for scope.
 *
 * WHY THIS EXISTS. OBOS supported one city by CONSTRUCTION, not configuration:
 * WardId was a closed union of three Kolkata wards. A switcher bolted onto that
 * would have been a plausible facade -- Dubai would render while silently
 * running on Kolkata's heatwave percentiles, All-India warming deltas and
 * rupee-denominated costs, with nothing erroring.
 *
 * NOTHING ELSE DECLARES A COUNTRY, CITY OR AREA. `AreaKey` is DERIVED below, so
 * the type cannot drift from the data: adding a city is one edit, not an edit
 * plus a type that can silently disagree with it.
 */

export const REGISTRY = {
  in: {
    name: 'India',
    pathway: 'dhara2025',
    /* NOT just a currency symbol: the VALUES are Indian too. Relabelling
       Rs 150/m2 as AED 150/m2 would be a different kind of wrong. */
    costs: { currency: 'INR', roofM2: 150, tree: 1500, parkCr: 1.5 },
    cities: {
      kolkata: {
        name: 'Kolkata',
        koppen: 'Aw',
        tier: 'validated',
        fallbackTairC: 32,
        parkRadiusM: 50,
        /* CITY-LEVEL data. Both of these currently sit at paths that imply they
           are global and are not: heatwave-percentiles.json carries a `city`
           key and dc-urs-inputs.json a `wards` key, both Kolkata's. */
        data: { heatwave: 'heatwave-percentiles', dcUrs: 'dc-urs-inputs' },
        /* AREA IDS REFERENCE src/data/wards.ts. Name, lat, lon, footprintM,
           veg and body all live there, it is mirrored by scripts/_types.py, and
           its own header declares it the single place a ward set widens. A
           first draft of this registry redeclared that geography and would have
           become a FOURTH ward table -- the divergence _types.py already
           records once, at 10-44 m of coordinate error. */
        areas: {
          ballygunge:  { shipsData: true },
          baruipur:    { shipsData: true },
          barrackpore: { shipsData: true },
        },
      },
    },
  },
  ae: {
    name: 'United Arab Emirates',
    pathway: null,          // no Gulf pathway sourced -- the control disables
    costs: null,            // no AED figures sourced -- the control disables
    cities: {
      dubai: {
        name: 'Dubai',
        koppen: 'BWh',
        tier: 'geometry',
        fallbackTairC: 40,
        parkRadiusM: 50,
        data: { heatwave: null, dcUrs: null },
        /* Registry-only placeholders: Dubai ships no data, so these need not
           exist in src/data/wards.ts. Anything with shipsData: true must. */
        areas: {
          creek:     { shipsData: false, name: 'Dubai Creek', descriptor: 'area · our tiling' },
          'al-quoz': { shipsData: false, name: 'Al Quoz',     descriptor: 'area · our tiling' },
          south:     { shipsData: false, name: 'Dubai South', descriptor: 'area · our tiling' },
        },
      },
    },
  },
} as const;

export type Registry = typeof REGISTRY;
export type CountryId = keyof Registry;

/**
 * The derived composite key.
 *
 * The obvious form -- Registry[C]['cities'][Y]['areas'] -- does NOT compile:
 * TS2536, because TypeScript cannot prove ['areas'] indexes a type that is
 * still distributing over Y. `extends { areas: infer A }` gives it the proof.
 * Verified both ways: this compiles clean under --strict, rejects
 * 'in/kolkata/typo', and still drives switch exhaustiveness.
 */
export type AreaKey = {
  [C in keyof Registry]: {
    [Y in keyof Registry[C]['cities']]:
      Registry[C]['cities'][Y] extends { areas: infer A }
        ? { [N in keyof A]: `${C & string}/${Y & string}/${N & string}` }[keyof A]
        : never
  }[keyof Registry[C]['cities']]
}[keyof Registry];

/** Slugs that are real routes under /heat-map/ and would shadow a country. */
export const RESERVED_SLUGS = Object.freeze(['brief', 'compare', 'data']);

function buildKeys(): AreaKey[] {
  const out: string[] = [];
  for (const [c, country] of Object.entries(REGISTRY)) {
    for (const [y, city] of Object.entries(country.cities)) {
      for (const a of Object.keys(city.areas)) out.push(`${c}/${y}/${a}`);
    }
  }
  return out as AreaKey[];
}

export const AREA_KEYS: readonly AreaKey[] = Object.freeze(buildKeys());

export function isAreaKey(value: unknown): value is AreaKey {
  return typeof value === 'string' && (AREA_KEYS as readonly string[]).includes(value);
}

export interface ScopeParts { country: string; city: string; area: string }

export function splitKey(key: AreaKey): ScopeParts {
  const [country, city, area] = (key as string).split('/');
  return { country, city, area };
}

/** Runnable checks. Each one guards a way this silently breaks. */
export function assertRegistryLogic(): void {
  const fails: string[] = [];
  const a = (ok: boolean, msg: string) => { if (!ok) fails.push(msg); };

  // A country slugged `brief` or `compare` would be permanently shadowed by
  // Astro's static-beats-dynamic route resolution, and fail SILENTLY.
  for (const c of Object.keys(REGISTRY)) {
    a(!RESERVED_SLUGS.includes(c), `country slug "${c}" collides with a real route`);
  }

  a(AREA_KEYS.length === new Set(AREA_KEYS).size, 'duplicate area key');
  a(AREA_KEYS.length > 0, 'registry produced no keys');

  for (const [c, country] of Object.entries(REGISTRY)) {
    for (const [y, city] of Object.entries(country.cities)) {
      a(['validated', 'zone', 'geometry'].includes(city.tier),
        `${c}/${y}: tier "${city.tier}" is not a known tier`);
      // A city claiming validation must actually ship data to validate.
      const ships = Object.values(city.areas).map((x) => x.shipsData);
      a(city.tier !== 'validated' || ships.every(Boolean),
        `${c}/${y} claims tier "validated" while an area ships no data`);
      a(Object.keys(city.areas).length > 0, `${c}/${y} has no areas`);
    }
  }

  /* THE ANTI-DIVERGENCE GUARD. src/data/wards.ts is THE area table -- Python
     mirrors it, and _types.py records that five scripts once carried private
     copies which had already diverged, one by 10-44 m of coordinate. Any area
     that ships data must exist there, and Kolkata's ids must match it exactly,
     so a fourth table cannot appear by accident. */
  const tableIds = new Set(WARD_TABLE.map((w) => w.id));
  for (const [c, country] of Object.entries(REGISTRY)) {
    for (const [y, city] of Object.entries(country.cities)) {
      for (const [a, area] of Object.entries(city.areas)) {
        a2(!area.shipsData || tableIds.has(a),
          `${c}/${y}/${a} ships data but is absent from src/data/wards.ts`);
      }
    }
  }
  const kolkata = Object.keys(REGISTRY.in.cities.kolkata.areas).sort();
  a2(JSON.stringify(kolkata) === JSON.stringify([...tableIds].sort()),
    `registry Kolkata areas ${kolkata} do not match src/data/wards.ts`);

  for (const line of fails) console.error(`  FAIL ${line}`);
  if (fails.length) throw new Error(`${fails.length} registry check(s) failed`);
}
```

Rename the local helper `a` to `a2` throughout `assertRegistryLogic` (the loop
above binds `a` as an area id, which would shadow it), and add the import:

```ts
import { WARDS as WARD_TABLE } from '../../../data/wards.ts';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test tests/unit/obos-scope.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify the derived type actually constrains**

Run:
```bash
cat > /tmp/areakey-neg.ts <<'EOF'
import type { AreaKey } from './src/scripts/climate-engine/scope/registry.ts';
const bad: AreaKey = 'in/kolkata/typo';
export { bad };
EOF
npx tsc --noEmit --strict --target es2022 --moduleResolution bundler --module esnext /tmp/areakey-neg.ts
```
Expected: FAIL with `Type '"in/kolkata/typo"' is not assignable to type 'AreaKey'`. If it passes, the derived type is not constraining and the whole design is unguarded — stop and fix before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/scripts/climate-engine/scope/registry.ts tests/unit/obos-scope.test.mjs
git commit -m "feat(obos): Country/City/Area registry with a derived AreaKey

One as-const registry is the single source of truth; AreaKey is derived from
it so the type cannot drift from the data. Guards reserved route slugs
(brief/compare/data) which Astro would shadow silently, and refuses a city
claiming tier 'validated' while an area ships no data."
```

---

## Task 3: The path builder

**Files:**
- Create: `src/scripts/climate-engine/scope/paths.ts`
- Modify: `tests/unit/obos-scope.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/obos-scope.test.mjs`:

```js
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths, cityPaths } from '../../src/scripts/climate-engine/scope/paths.ts';

const ROOT2 = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('paths builds every ward URL from the registry', () => {
  const p = paths('in/kolkata/ballygunge');
  assert.equal(p.ward, '/heat-map/data/ballygunge.json');
  assert.equal(p.trees, '/heat-map/data/ballygunge-trees.json');
  assert.equal(p.surface, '/heat-map/data/ballygunge-surface.png');
  assert.equal(p.canopy, '/heat-map/data/ballygunge-canopy.png');
  assert.equal(p.layers, '/heat-map/data/ballygunge-layers.json');
});

test('an area with no data resolves to null, never a URL', () => {
  assert.equal(paths('ae/dubai/al-quoz'), null);
});

test('city-level files are city-scoped, not global', () => {
  assert.equal(cityPaths('in/kolkata/ballygunge').heatwave,
    '/heat-map/data/heatwave-percentiles.json');
  assert.equal(cityPaths('ae/dubai/al-quoz').heatwave, null);
});

test('every URL paths() emits exists on disk', async () => {
  const present = new Set(await readdir(join(ROOT2, 'public/heat-map/data')));
  for (const key of AREA_KEYS) {
    const p = paths(key);
    if (p === null) continue;
    for (const [name, url] of Object.entries(p)) {
      const file = url.replace('/heat-map/data/', '');
      assert.ok(present.has(file), `${key}: ${name} -> ${file} is missing on disk`);
    }
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test tests/unit/obos-scope.test.mjs`
Expected: FAIL — cannot find module `scope/paths.ts`.

- [ ] **Step 3: Write the builder**

Create `src/scripts/climate-engine/scope/paths.ts`:

```ts
/**
 * Every data URL in OBOS, built from the registry. The ONLY place a
 * /heat-map/data/ URL may be constructed.
 *
 * WHY A CHOKE POINT. 17 call sites across 5 files used to interpolate a bare
 * ward name into a URL. Most were wrapped in optional()/catch, so a change to
 * the id shape would not have errored -- it would have rendered a city with no
 * trees, no roads and no provenance. Silent degradation is the failure mode this
 * codebase keeps paying for, so raw interpolation is now a test failure.
 *
 * THE URL SHAPE IS DECOUPLED FROM THE KEY SHAPE. Files stay flat on disk at
 * /heat-map/data/ballygunge.json while the key is in/kolkata/ballygunge. Moving
 * 30+ shipped files would be risk with no user-visible benefit.
 */
import { REGISTRY, splitKey, type AreaKey } from './registry.ts';

const BASE = '/heat-map/data';

export interface AreaPaths {
  ward: string; terrain: string; water: string; roads: string;
  labels: string; provenance: string; trees: string;
  surface: string; canopy: string; layers: string;
}

export interface CityPaths {
  heatwave: string | null;
  dcUrs: string | null;
}

type AnyCity = { data: { heatwave: string | null; dcUrs: string | null };
                 areas: Record<string, { shipsData: boolean }> };

function city(key: AreaKey): AnyCity {
  const { country, city: cityId } = splitKey(key);
  const countries = REGISTRY as unknown as Record<string, { cities: Record<string, AnyCity> }>;
  return countries[country].cities[cityId];
}

/** Null when the area ships no data — callers must not fetch. */
export function paths(key: AreaKey): AreaPaths | null {
  const { area } = splitKey(key);
  if (!city(key).areas[area].shipsData) return null;
  /* THE AREA ID IS THE FILE STEM. Both come from src/data/wards.ts, which the
     registry self-test pins them to, so they cannot drift apart. */
  const stem = area;
  return {
    ward:       `${BASE}/${stem}.json`,
    terrain:    `${BASE}/${stem}-terrain.json`,
    water:      `${BASE}/${stem}-water.json`,
    roads:      `${BASE}/${stem}-roads.json`,
    labels:     `${BASE}/${stem}-road-labels.geojson`,
    provenance: `${BASE}/${stem}-provenance.json`,
    trees:      `${BASE}/${stem}-trees.json`,
    surface:    `${BASE}/${stem}-surface.png`,
    canopy:     `${BASE}/${stem}-canopy.png`,
    layers:     `${BASE}/${stem}-layers.json`,
  };
}

export function cityPaths(key: AreaKey): CityPaths {
  const d = city(key).data;
  return {
    heatwave: d.heatwave === null ? null : `${BASE}/${d.heatwave}.json`,
    dcUrs:    d.dcUrs === null ? null : `${BASE}/${d.dcUrs}.json`,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test tests/unit/obos-scope.test.mjs`
Expected: PASS, 9 tests. The "exists on disk" test proves all 10 file kinds are present for all 3 Kolkata areas.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/climate-engine/scope/paths.ts tests/unit/obos-scope.test.mjs
git commit -m "feat(obos): single path builder for every /heat-map/data URL

Decouples the URL shape from the key shape -- files stay flat on disk while
keys become hierarchical, so nothing shipped moves. Returns null for an area
that ships no data, so a disabled city cannot 404. City-level files
(heatwave-percentiles, dc-urs-inputs) become city-scoped: both carry Kolkata
data at paths that imply global."
```

---

## Task 4: Forbid raw interpolation

**Files:**
- Modify: `tests/unit/obos-scope.test.mjs`

- [ ] **Step 1: Write the guard test (it will fail — 17 sites still exist)**

Append to `tests/unit/obos-scope.test.mjs`:

```js
import { readFile } from 'node:fs/promises';

// Files allowed to name the data directory: the builder itself, and this test.
const PATH_ALLOWLIST = new Set(['scope/paths.ts']);

test('no module builds a /heat-map/data URL by hand', async () => {
  const dir = join(ROOT2, 'src/scripts/climate-engine');
  const offenders = [];
  const walk = async (d) => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!entry.name.endsWith('.ts') || entry.name.startsWith('._')) continue;
      const rel = full.slice(dir.length + 1);
      if (PATH_ALLOWLIST.has(rel)) continue;
      const src = await readFile(full, 'utf8');
      /* ANY data URL, not just interpolated ones. Three call sites fetch the
         two pseudo-global files by PLAIN STRING -- heatwave-percentiles.json
         and dc-urs-inputs.json -- so a ${-only pattern would have missed
         exactly the cases this migration is about. */
      if (/['"`]\/heat-map\/data\//.test(src)) offenders.push(rel);
    }
  };
  await walk(dir);
  assert.deepEqual(offenders, [],
    'these modules build a data URL by hand; use paths() from scope/paths.ts');
});
```

- [ ] **Step 2: Run it and record the offenders**

Run: `node --import tsx --test tests/unit/obos-scope.test.mjs`
Expected: FAIL listing exactly these 4 files (`ward-loader.ts`, `surface-raster.ts`, `provenance.ts`, `heat-map-app.ts`). Note the list — Task 6 clears it. `surface-raster.ts` and `heat-map-app.ts` appear for **two** reasons each: interpolated ward URLs *and* plain-string global ones.

- [ ] **Step 3: Mark the test as expected-failing until Task 6**

Change the test name so the suite stays green while the migration proceeds:

```js
test('no module builds a /heat-map/data URL by hand', { skip: 'enabled in Task 6' }, async () => {
```

- [ ] **Step 4: Run to confirm the suite is green with the guard skipped**

Run: `node --import tsx --test tests/unit/obos-scope.test.mjs`
Expected: PASS with 1 skipped.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/obos-scope.test.mjs
git commit -m "test(obos): guard against hand-built data URLs (skipped until Task 6)

Greps the engine for a template literal interpolating into /heat-map/data/.
Skipped while the 4 known offenders are migrated; Task 6 turns it on."
```

---

## Task 5: Move the four scoped constants out of the physics

**Files:**
- Create: `src/scripts/climate-engine/scope/resolve.ts`
- Modify: `src/scripts/climate-engine/heat-map-model.ts:70-82` and `:360-370`
- Modify: `tests/unit/obos-scope.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/obos-scope.test.mjs`:

```js
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';

test('resolve returns the scoped constants for a key', () => {
  const r = resolve('in/kolkata/ballygunge');
  assert.equal(r.country.name, 'India');
  assert.equal(r.city.name, 'Kolkata');
  assert.equal(r.area.name, 'Ballygunge');
  assert.equal(r.tier, 'validated');
  assert.equal(r.climate.fallbackTairC, 32);
  assert.equal(r.climate.pathDelta.ssp585, 4.1);
  assert.equal(r.climate.costs.currency, 'INR');
});

test('a country with no pathway resolves to an EMPTY pathway table', () => {
  const r = resolve('ae/dubai/al-quoz');
  assert.equal(r.tier, 'geometry');
  assert.equal(r.climate.fallbackTairC, 40);
  assert.deepEqual(r.climate.pathDelta, {});
  assert.equal(r.climate.costs, null);
});

test('the physics module no longer carries country constants', async () => {
  const src = await readFile(
    join(ROOT2, 'src/scripts/climate-engine/heat-map-model.ts'), 'utf8');
  // strip comments: the provenance notes legitimately name India and the paper
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!code.includes('₹'), 'a rupee sign remains in the physics module');
  assert.ok(!/PATH_DELTA\s*[:=]\s*\{/.test(code), 'PATH_DELTA is still declared here');
  assert.ok(!/FALLBACK_TAIR\s*=\s*\d/.test(code), 'FALLBACK_TAIR is still declared here');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test tests/unit/obos-scope.test.mjs`
Expected: FAIL — cannot find module `scope/resolve.ts`.

- [ ] **Step 3: Write resolve.ts**

Create `src/scripts/climate-engine/scope/resolve.ts`:

```ts
/**
 * Scope resolution: an AreaKey in, everything scoped to it out.
 *
 * CONSTANTS RESOLVE AT THE EDGE AND ARE PASSED IN. The physics knows data and
 * parameters, never identity -- heat-map-model.ts, dc-urs.ts and sim-ts.ts
 * contain zero identity references and this design keeps it that way.
 *
 * Four constants used to live inside the physics and belong to a country or a
 * city: PATH_DELTA (All-India, Dhara et al. 2025), COST (RUPEES -- a currency,
 * which a physics review would read straight past), PARK_R_M (Kolkata TVoE) and
 * FALLBACK_TAIR (32 C, a Kolkata climatology; Dubai's is ~40).
 */
import { wardById } from '../../../data/wards.ts';
import { REGISTRY, splitKey, type AreaKey } from './registry.ts';

/** All-India warming deltas, degC. Dhara et al. 2025, PLOS Climate 4(11):e0000724. */
const PATHWAYS: Record<string, Record<string, number>> = {
  dhara2025: {
    '2025': 0,      // observed baseline
    ssp245: 1.25,   // SSP2-4.5, 2041-2060 all-India mean
    ssp585: 4.1,    // SSP5-8.5, 2065-2094 max temperature vs 1985-2014
  },
};

export interface Costs {
  currency: string; roofM2: number; tree: number; parkCr: number;
}

export interface ClimateConstants {
  /** Empty when the country declares no pathway — NOT a silent zero. */
  pathDelta: Record<string, number>;
  fallbackTairC: number;
  parkRadiusM: number;
  costs: Costs | null;
}

export type CityTier = 'validated' | 'zone' | 'geometry';

export interface ResolvedScope {
  key: AreaKey;
  country: { id: string; name: string };
  city: { id: string; name: string; koppen: string };
  area: { id: string; name: string; descriptor: string; hasData: boolean };
  tier: CityTier;
  climate: ClimateConstants;
}

type AnyArea = { shipsData: boolean; name?: string; descriptor?: string };
type AnyCity = {
  name: string; koppen: string; tier: string;
  fallbackTairC: number; parkRadiusM: number;
  areas: Record<string, AnyArea>;
};
type AnyCountry = {
  name: string; pathway: string | null; costs: Costs | null;
  cities: Record<string, AnyCity>;
};

export function resolve(key: AreaKey): ResolvedScope {
  const { country: c, city: y, area: a } = splitKey(key);
  const countries = REGISTRY as unknown as Record<string, AnyCountry>;
  const country = countries[c];
  const city = country.cities[y];
  const area = city.areas[a];
  return {
    key,
    country: { id: c, name: country.name },
    city: { id: y, name: city.name, koppen: city.koppen },
    /* Name and descriptor come from src/data/wards.ts for data-shipping areas
       and from the registry for placeholders, which do not exist there. */
    area: {
      id: a,
      name: area.name ?? wardById(a)?.name.replace(/<\/?em>/g, '') ?? a,
      descriptor: area.descriptor ?? wardById(a)?.zone ?? '',
      hasData: area.shipsData,
    },
    tier: city.tier as CityTier,
    climate: {
      pathDelta: country.pathway === null ? {} : PATHWAYS[country.pathway],
      fallbackTairC: city.fallbackTairC,
      parkRadiusM: city.parkRadiusM,
      costs: country.costs,
    },
  };
}
```

- [ ] **Step 4: Delete the constants from the physics module**

In `src/scripts/climate-engine/heat-map-model.ts`, delete the `COST` line (line 70) and the whole `PATH_DELTA` block (lines 71-81) and the `FALLBACK_TAIR` line (line 82). Replace them with:

```ts
/**
 * COST, PATH_DELTA and FALLBACK_TAIR moved to scope/resolve.ts on 2026-08-27.
 *
 * All three were scoped to India or to Kolkata while living inside physics that
 * every city runs. COST was denominated in rupees -- a currency, not a
 * coefficient -- so a Dubai demo would have quoted DEWA rupee figures with
 * nothing erroring. They arrive now as ScenarioState.climate.
 */
```

- [ ] **Step 5: Add `climate` to ScenarioState and use it**

In `heat-map-model.ts`, add to the `ScenarioState` interface (after `path: string;`):

```ts
  /** Country/city constants, from scope/resolve.ts. */
  climate: import('./scope/resolve.ts').ClimateConstants;
```

Then replace line 367:

```ts
  const baseTair = (s.heatTairC ?? obsTair) + (PATH_DELTA[s.path] ?? 0);
```

with:

```ts
  /* FAIL CLOSED ON THE MISTAKE, OPEN ONLY WHERE DECLARED. The old form was
     `PATH_DELTA[s.path] ?? 0`, which treated an unrecognised pathway and a
     genuinely absent one identically -- a typo silently contributed zero
     warming. A country that declares no pathway resolves to an EMPTY table and
     its control is disabled upstream, so reaching here with an unknown key is
     always a bug. */
  const delta = s.climate.pathDelta[s.path];
  if (delta === undefined && Object.keys(s.climate.pathDelta).length > 0) {
    throw new Error(`unknown warming pathway "${s.path}"`);
  }
  const baseTair = (s.heatTairC ?? obsTair) + (delta ?? 0);
```

And replace the `FALLBACK_TAIR` use on line 361:

```ts
  const L = s.live, obsTair = L ? L.tAir : FALLBACK_TAIR, obsRh = L ? L.rh : 60;
```

with:

```ts
  const L = s.live, obsTair = L ? L.tAir : s.climate.fallbackTairC, obsRh = L ? L.rh : 60;
```

- [ ] **Step 6: Update the golden test to pass climate**

In `tests/unit/obos-golden-params.test.mjs`, add the import and pass it:

```js
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';
const CLIMATE = resolve('in/kolkata/ballygunge').climate;
```

and change the `currentParams` call inside `matrix()` to:

```js
          out[key] = currentParams({ live, phase, path, iv: IV, heatTairC, climate: CLIMATE });
```

- [ ] **Step 7: Run the golden test — this is the moment of truth**

Run: `node --import tsx --test tests/unit/obos-golden-params.test.mjs`
Expected: PASS. If it fails, the constants were transcribed wrong — compare the failing key against `data/calibration/golden-params.json` and fix the value in `resolve.ts`. **Do not edit the golden file.**

- [ ] **Step 8: Fix every other caller of currentParams**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "climate|currentParams" | head -20`
Expected: a list of call sites missing `climate`. Add `climate: resolve(currentKey).climate` at each. The self-tests inside `heat-map-model.ts` (around lines 464-485) need a literal instead, since they cannot import scope without a cycle:

```ts
const TEST_CLIMATE = { pathDelta: { '2025': 0, ssp245: 1.25, ssp585: 4.1 },
                       fallbackTairC: 32, parkRadiusM: 50,
                       costs: { currency: 'INR', roofM2: 150, tree: 1500, parkCr: 1.5 } };
```

- [ ] **Step 9: Run the whole unit suite**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/scripts/climate-engine/scope/resolve.ts src/scripts/climate-engine/heat-map-model.ts tests/unit/
git commit -m "refactor(obos): four scoped constants leave the physics module

PATH_DELTA (All-India), COST (RUPEES), PARK_R_M (Kolkata TVoE) and
FALLBACK_TAIR (32 C, Kolkata) all belonged to a country or a city while living
inside physics every city runs. They arrive now as ScenarioState.climate.

The pathway lookup also stops failing open: PATH_DELTA[s.path] ?? 0 treated a
typo and a genuinely absent pathway identically. A country that declares none
resolves to an empty table; an unknown key inside a populated table throws.

Guarded by the 24 frozen currentParams cases -- byte-identical after the move."
```

---

## Task 6: Migrate the loaders to `paths()`

**Files:**
- Modify: `src/scripts/climate-engine/ward-loader.ts`
- Modify: `src/scripts/climate-engine/surface-raster.ts:62,296`
- Modify: `src/scripts/climate-engine/provenance.ts:69-72`
- Modify: `src/scripts/climate-engine/heat-map-app.ts:786-820,863-877`
- Modify: `tests/unit/obos-scope.test.mjs`

**Note:** these four functions take `ward: string`, **not** `WardId` — so the compiler will NOT catch the key change here. Tightening the signature to `AreaKey` is what makes the migration compiler-enforced, and is the point of this task.

- [ ] **Step 1: Tighten `ward-loader.ts`**

Replace the whole body of `src/scripts/climate-engine/ward-loader.ts` with:

```ts
import type { RoadsData, WardData } from './heat-map-model.ts';
import { paths } from './scope/paths.ts';
import type { AreaKey } from './scope/registry.ts';

export interface LoadedWard {
  ward: WardData;
  roads: RoadsData;
}

const cache = new Map<AreaKey, Promise<LoadedWard>>();

async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Unable to load ${url}: ${response.status}`);
  return response.json() as Promise<T>;
}

export function loadArea(id: AreaKey, signal?: AbortSignal): Promise<LoadedWard> {
  const p = paths(id);
  /* An area with no data is unreachable by construction, so a disabled city
     cannot 404 in the console. Callers gate on resolve(id).area.hasData. */
  if (p === null) return Promise.reject(new Error(`${id} ships no data`));
  if (!signal && cache.has(id)) return cache.get(id)!;
  const load = Promise.all([
    json<WardData>(p.ward, signal),
    json<RoadsData>(p.roads, signal).catch(() => ({ ways: [] })),
  ]).then(([ward, roads]) => ({ ward, roads }));
  if (!signal) cache.set(id, load);
  return load;
}
```

- [ ] **Step 2: Tighten `surface-raster.ts`**

At line 62, change the signature and body:

```ts
export async function loadSurfaceRaster(ward: AreaKey, signal?: AbortSignal): Promise<SurfaceRaster | null> {
  try {
    const p = paths(ward);
    if (p === null) return null;
    const response = await fetch(p.surface, { signal });
```

At line 296, the same for canopy:

```ts
export async function loadCanopyRaster(ward: AreaKey, signal?: AbortSignal): Promise<CanopyRaster | null> {
  try {
    const p = paths(ward);
    if (p === null) return null;
    const response = await fetch(p.canopy, { signal });
```

Add at the top of the file:

```ts
import { paths } from './scope/paths.ts';
import type { AreaKey } from './scope/registry.ts';
```

- [ ] **Step 3: Tighten `provenance.ts`**

Replace lines 66-72:

```ts
const cache = new Map<AreaKey, Promise<LayerManifest | null>>();

/** Fetch + cache the manifest for an area; null on any failure (UI degrades). */
export function loadLayerManifest(ward: AreaKey): Promise<LayerManifest | null> {
  let pending = cache.get(ward);
  if (!pending) {
    const p = paths(ward);
    if (p === null) return Promise.resolve(null);
    pending = fetch(p.layers)
```

Add at the top:

```ts
import { paths } from './scope/paths.ts';
import type { AreaKey } from './scope/registry.ts';
```

- [ ] **Step 4: Migrate the 9-file bundle in `heat-map-app.ts`**

Change `async function loadWard(name: string)` at line 767 to:

```ts
async function loadWard(name: AreaKey) {
```

Immediately after the function opens, add:

```ts
  const P = paths(name);
  if (P === null) throw new Error(`${name} ships no data`);
```

Then replace each URL in the `Promise.all` block (lines 786-820):

| was | becomes |
|---|---|
| `` `/heat-map/data/${name}.json` `` | `P.ward` |
| `` `/heat-map/data/${name}-terrain.json` `` | `P.terrain` |
| `` `/heat-map/data/${name}-water.json` `` | `P.water` |
| `` `/heat-map/data/${name}-roads.json` `` | `P.roads` |
| `` `/heat-map/data/${name}-road-labels.geojson` `` | `P.labels` |
| `` `/heat-map/data/${name}-provenance.json` `` | `P.provenance` |
| `` `/heat-map/data/${name}-trees.json` `` | `P.trees` |

And the three cache-miss refetches at lines 863-877 — those build their own URLs and each needs `paths(name)` first:

```ts
    if (!roadsCache[name]) {
      const q = paths(name);
      try { roadsCache[name] = q === null ? { ways: [] } : await (await fetch(q.roads)).json(); }
      catch { roadsCache[name] = { ways: [] }; }
    }
```

Apply the same shape to the `labelCache` and `provCache` blocks, using `q.labels` and `q.provenance`.

Add at the top of the file:

```ts
import { paths } from './scope/paths.ts';
import type { AreaKey } from './scope/registry.ts';
```

- [ ] **Step 5: Migrate the three plain-string global fetches**

These are the two files that lie about their scope. They are fetched by **plain
string**, not interpolation, which is why the guard had to widen — a `${`-only
pattern would have missed exactly the cases this migration exists for.

In `heat-map-app.ts` line 754:

```ts
      const q = cityPaths(name);
      if (q.heatwave === null) return null;   // city has no heatwave record
      const r = await fetch(q.heatwave);
```

In `heat-map-app.ts` line 762:

```ts
      const q = cityPaths(name);
      if (q.dcUrs === null) return null;
      const r = await fetch(q.dcUrs);
```

In `surface-raster.ts` line 190, the module-level `inputsPromise` has no key in
scope. Change the function that owns it to take one:

```ts
export function loadDcUrsInputs(ward: AreaKey): Promise<DcUrsInputs | null> {
  const q = cityPaths(ward);
  if (q.dcUrs === null) return Promise.resolve(null);
  inputsPromise ??= fetch(q.dcUrs)
```

Add `import { cityPaths } from './scope/paths.ts';` to both files, and update
`loadDcUrsInputs` callers to pass the current key.

**A city with no heatwave file must disable the heatwave phase**, not fall back
to Kolkata's. Where the returned `null` is consumed, hide the Heatwave segmented
control rather than defaulting.

- [ ] **Step 6: Turn the guard test ON**

In `tests/unit/obos-scope.test.mjs`, remove the skip:

```js
test('no module builds a /heat-map/data URL by hand', async () => {
```

- [ ] **Step 7: Run the guard and the suite**

Run: `npm run test:unit`
Expected: PASS, with the guard now green — zero offenders.

- [ ] **Step 8: Typecheck**

Run: `npm run check`
Expected: errors ONLY where a bare ward string is still passed to a now-`AreaKey` parameter. Those are Task 7's job; note them and continue if they are all of that form.

- [ ] **Step 9: Commit**

```bash
git add src/scripts/climate-engine/ tests/unit/obos-scope.test.mjs
git commit -m "refactor(obos): every data URL now comes from paths()

17 raw interpolations across 5 files replaced. The four loader signatures
were 'ward: string', NOT WardId -- so the compiler would not have caught the
key change at any of them. Tightening them to AreaKey is what makes the
migration compiler-enforced; the grep guard is now on."
```

---

## Task 7: `WardId` → `AreaKey`, with compare-link compatibility

**Files:**
- Delete: `src/scripts/climate-engine/wards.ts`
- Create: `src/scripts/climate-engine/scope/legacy.ts`
- Modify: `src/scripts/climate-engine/scenario/scenario-url.ts:1,19-20`
- Modify: `src/scripts/climate-engine/compare/*` (mechanical)
- Modify: `tests/unit/obos-scope.test.mjs`

- [ ] **Step 1: Write the failing compat test**

Append to `tests/unit/obos-scope.test.mjs`:

```js
import { LEGACY_WARD_KEYS, fromLegacyWard } from '../../src/scripts/climate-engine/scope/legacy.ts';

test('old bare-ward compare links still resolve', () => {
  // /heat-map/compare?a=ballygunge&b=baruipur was shipped (noindexed) and
  // isWardId failed SOFT -- an unknown id fell back to a default, so stale
  // links would have shown the WRONG wards rather than erroring.
  assert.equal(fromLegacyWard('ballygunge'), 'in/kolkata/ballygunge');
  assert.equal(fromLegacyWard('baruipur'), 'in/kolkata/baruipur');
  assert.equal(fromLegacyWard('barrackpore'), 'in/kolkata/barrackpore');
  assert.equal(fromLegacyWard('nonsense'), null);
  assert.equal(LEGACY_WARD_KEYS.length, 3);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test tests/unit/obos-scope.test.mjs`
Expected: FAIL — `fromLegacyWard` is not exported.

- [ ] **Step 3: Create `scope/legacy.ts` and DELETE `climate-engine/wards.ts`**

`src/scripts/climate-engine/wards.ts` is redundant with `src/data/wards.ts` —
same three wards, fewer fields, no Python mirror. Delete it rather than adapt
it, so the count of ward tables goes down instead of up.

Run: `git rm src/scripts/climate-engine/wards.ts`

Create `src/scripts/climate-engine/scope/legacy.ts`:

```ts
/**
 * Compatibility for ward ids that were shipped in links.
 *
 * SEPARATE FILE ON PURPOSE. This is a migration shim with an expiry, not part
 * of the scope model. Keeping it out of registry.ts means deleting it later is
 * deleting a file, not editing one.
 */
import { AREA_KEYS, isAreaKey, splitKey, type AreaKey } from './registry.ts';

/**
 * BARE WARD IDS FROM SHIPPED LINKS. /heat-map/compare?a=ballygunge was live
 * (noindexed) and isWardId failed SOFT: an unrecognised id fell back to a
 * default, so a stale link would have shown the WRONG wards silently rather
 * than erroring. Three entries remove that risk outright.
 */
export const LEGACY_WARD_KEYS = Object.freeze(
  ['ballygunge', 'baruipur', 'barrackpore'] as const);

export function fromLegacyWard(value: string | null | undefined): AreaKey | null {
  if (typeof value !== 'string') return null;
  if (isAreaKey(value)) return value;
  return (LEGACY_WARD_KEYS as readonly string[]).includes(value)
    ? (`in/kolkata/${value}` as AreaKey)
    : null;
}

export function nextDistinctArea(key: AreaKey): AreaKey {
  const { country, city } = splitKey(key);
  const sameCity = AREA_KEYS.filter((k) => k.startsWith(`${country}/${city}/`));
  return sameCity.find((k) => k !== key) ?? AREA_KEYS.find((k) => k !== key)!;
}
```

- [ ] **Step 4: Update `scenario-url.ts`**

Replace lines 1 and 19-20 of `src/scripts/climate-engine/scenario/scenario-url.ts`:

```ts
import { fromLegacyWard, nextDistinctArea } from '../scope/legacy.ts';
```

```ts
  const a = fromLegacyWard(requestedA) ?? DEFAULT_PAIRED_SCENARIO.a;
  const bCandidate = fromLegacyWard(requestedB) ?? DEFAULT_PAIRED_SCENARIO.b;
  const b = bCandidate === a ? nextDistinctArea(a) : bCandidate;
```

- [ ] **Step 5: Repoint the six `WARDS[...]` lookups in `heat-map-app.ts`**

`heat-map-app.ts:48` aliases `const WARDS = WARD_MAP` from `src/data/wards.ts`,
which is keyed by **bare** id. Once `name` is an `AreaKey`, every one of these
returns `undefined` — and `WARDS[name].name` then throws at runtime rather than
failing the build, because `WARD_MAP` is a `Record<string, Ward>`.

Sites: lines 268, 768, 772, 827, 916, 1138, plus `WARDS.ballygunge.footprintM`
at line 126.

Add near the top:

```ts
import { splitKey } from './scope/registry.ts';
/* WARD_MAP is keyed by BARE id; our keys are hierarchical. One helper rather
   than splitKey() at six call sites. */
const wardOf = (key: AreaKey) => WARDS[splitKey(key).area];
```

Then replace each `WARDS[name]` with `wardOf(name)`, `WARDS[state.ward]` with
`wardOf(state.ward)`, and line 126 with:

```ts
  let currentWardSizeM = WARDS.ballygunge.footprintM;   // unchanged: a literal default, not a lookup
```

- [ ] **Step 6: Fix everything the compiler now flags**

Run: `npm run check`

Every remaining error is a bare ward string where an `AreaKey` is expected. Replace each `'ballygunge'` with `'in/kolkata/ballygunge'` (and likewise for the other two), and `WardId` with `AreaKey`. Also update `DEFAULT_PAIRED_SCENARIO` in `scenario/scenario-state.ts` to use full keys.

Repeat until `npm run check` is clean.

- [ ] **Step 7: Run the suite**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A src/scripts/climate-engine/ tests/unit/obos-scope.test.mjs
git commit -m "refactor(obos): WardId becomes AreaKey; compare links stay working

climate-engine/wards.ts is DELETED -- redundant with src/data/wards.ts, which
Python mirrors and which declares itself the single place a ward set widens.
The count of ward tables goes down, not up. /heat-map/compare ships
(noindexed) and read bare ward ids from ?a=/?b=, where isWardId failed SOFT --
a stale link would have shown the WRONG wards rather than erroring. A three-
entry compat map removes that risk."
```

---

## Task 8: The scoped route

**Files:**
- Create: `src/pages/heat-map/[country]/[city]/[area].astro`
- Modify: `src/pages/heat-map.astro`

- [ ] **Step 1: Read the existing page so the new route renders the same thing**

Run: `sed -n '1,40p' src/pages/heat-map.astro`
Note its frontmatter, layout import and props — the new route must use the same ones.

- [ ] **Step 2: Create the scoped route**

Create `src/pages/heat-map/[country]/[city]/[area].astro`:

```astro
---
// Scoped OBOS route. The site is static (no `output` in astro.config.mjs), so
// getStaticPaths enumerates the registry: 6 prerendered pages today. Each area
// gets real HTML for first paint instead of one JS-booted page.
//
// brief.astro and compare.astro are SIBLINGS of [country]. Astro resolves
// static routes before dynamic ones, so they keep winning -- and registry.ts
// refuses a country slugged `brief`, `compare` or `data` so this can never
// become ambiguous.
import { AREA_KEYS } from '../../../../scripts/climate-engine/scope/registry.ts';
import { resolve } from '../../../../scripts/climate-engine/scope/resolve.ts';
import HeatMapStage from '../../../../components/ClimateEngine/HeatMapStage.astro';

export function getStaticPaths() {
  return AREA_KEYS.map((key) => {
    const [country, city, area] = key.split('/');
    return { params: { country, city, area }, props: { key } };
  });
}

const { key } = Astro.props;
const scope = resolve(key);
---
<HeatMapStage scopeKey={key} scope={scope} />
```

- [ ] **Step 3: Make `heat-map.astro` redirect to the default scope**

Replace the body of `src/pages/heat-map.astro` with:

```astro
---
// The bare /heat-map URL keeps working and lands on the default scope, which is
// the ward this page opened on before the scope model existed.
return Astro.redirect('/heat-map/in/kolkata/ballygunge', 302);
---
```

- [ ] **Step 4: Build and confirm the pages exist**

Run: `npm run build`
Then: `ls dist/heat-map/in/kolkata/ dist/heat-map/ae/dubai/`
Expected: `ballygunge/`, `baruipur/`, `barrackpore/` under `in/kolkata/`, and `creek/`, `al-quoz/`, `south/` under `ae/dubai/`.

- [ ] **Step 5: Confirm the sibling routes still resolve**

Run: `ls dist/heat-map/brief dist/heat-map/compare`
Expected: both directories exist. If either is missing, a dynamic route has shadowed it — stop and check `RESERVED_SLUGS`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/heat-map.astro "src/pages/heat-map/[country]/[city]/[area].astro"
git commit -m "feat(obos): scoped route /heat-map/{country}/{city}/{area}

6 prerendered pages from the registry. /heat-map redirects to the previous
default. brief and compare are siblings of [country] and keep winning by
Astro's static-before-dynamic resolution; registry.ts refuses those slugs."
```

---

## Task 9: Dubai appears, disabled

**Files:**
- Modify: `src/components/ClimateEngine/HeatMapStage.astro`
- Modify: `tests/unit/obos-scope.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/obos-scope.test.mjs`:

```js
test('a city without data is never fetchable', () => {
  for (const key of AREA_KEYS) {
    const r = resolve(key);
    if (!r.area.hasData) {
      assert.equal(paths(key), null,
        `${key} has no data but paths() returned URLs — it could 404`);
    }
  }
});

test('tier and phase confidence remain separate concepts', async () => {
  const acc = await readFile(
    join(ROOT2, 'src/scripts/climate-engine/accuracy.ts'), 'utf8');
  // PhaseAccuracy.confidence is measured over 50 night / 29 peak ward-scenes.
  // It must not be renamed into, or replaced by, the city tier.
  assert.ok(acc.includes("'quantitative' | 'indicative'"),
    'PhaseAccuracy.confidence was changed — it is a different axis from CityTier');
  const res = await readFile(
    join(ROOT2, 'src/scripts/climate-engine/scope/resolve.ts'), 'utf8');
  assert.ok(res.includes("'validated' | 'zone' | 'geometry'"),
    'CityTier was changed');
});
```

- [ ] **Step 2: Run it**

Run: `node --import tsx --test tests/unit/obos-scope.test.mjs`
Expected: PASS both — the registry already enforces this. If `a city without data is never fetchable` fails, `paths()` has a bug; fix it before continuing.

- [ ] **Step 3: Accept the scope props in `HeatMapStage.astro`**

At the top of the component's frontmatter, add:

```astro
---
import type { AreaKey } from '../../scripts/climate-engine/scope/registry.ts';
import type { ResolvedScope } from '../../scripts/climate-engine/scope/resolve.ts';

interface Props { scopeKey: AreaKey; scope: ResolvedScope }
const { scopeKey, scope } = Astro.props;
---
```

- [ ] **Step 4: Replace the hardcoded readout**

Find line 23 (the `.read` div, containing `MEDNI · HEAT INSTRUMENT` and `22.528° N · 88.366° E`) and replace the coordinate with the resolved one:

```astro
<div class="read">OBOS · HEAT INSTRUMENT<br><b id="coord">{scope.city.name}</b><br>
  <span id="bcount">— buildings</span> · <span id="simBackend" aria-live="polite">SELECTING ENGINE</span></div>
```

- [ ] **Step 5: Replace the hardcoded ward strip**

Find the `.strip` block (around line 253) and generate it from the registry instead:

```astro
<div class="strip" id="strip">
  {AREA_KEYS.filter((k) => k.startsWith(`${scope.country.id}/${scope.city.id}/`)).map((k) => {
    const r = resolve(k);
    return (
      <button class="ward" data-w={k} aria-current={k === scopeKey}
              disabled={!r.area.hasData}>
        <span class="sw"></span>
        <div><div class="nm">{r.area.name}</div><div class="ty">{r.area.descriptor}</div></div>
        <div class="big" id={`big-${r.area.id}`}>{r.area.hasData ? '—' : 'no data'}<span>°C mean</span></div>
      </button>
    );
  })}
</div>
```

Add `AREA_KEYS` and `resolve` to the component's imports.

- [ ] **Step 6: Build and check both cities render**

Run: `npm run build && npm run test:e2e:built`
Expected: PASS. If an e2e test asserts on the old hardcoded coordinate string, update that assertion to match the new readout — note it in the commit message.

- [ ] **Step 7: Commit**

```bash
git add src/components/ClimateEngine/HeatMapStage.astro tests/unit/obos-scope.test.mjs
git commit -m "feat(obos): Dubai appears in the switcher, disabled and honest

Areas with no data render disabled and cannot be fetched -- paths() returns
null for them, so a greyed city cannot 404. The ward strip and the coordinate
readout are now generated from the registry rather than hardcoded.

CityTier and PhaseAccuracy.confidence are asserted to remain distinct: Kolkata
is 'validated' AND 'indicative' at midday, and collapsing the two would either
overclaim Dubai's nights or underclaim Kolkata's."
```

---

## Task 10: Full verification

- [ ] **Step 1: Run the whole gate**

Run: `npm run verify`
Expected: PASS end to end.

- [ ] **Step 2: Confirm the golden baseline never drifted**

Run: `node --import tsx --test tests/unit/obos-golden-params.test.mjs`
Expected: PASS — 24 cases byte-identical to the pre-migration capture.

- [ ] **Step 3: Confirm the done-criteria by hand**

Run:
```bash
npm run build
test -d dist/heat-map/in/kolkata/ballygunge && echo "  scoped route OK"
test -d dist/heat-map/brief && echo "  brief still resolves OK"
grep -rq "₹" src/scripts/climate-engine/heat-map-model.ts && echo "  FAIL rupee in physics" || echo "  no rupee in physics OK"
grep -rq '`/heat-map/data/${' src/scripts/climate-engine/ && echo "  FAIL raw path" || echo "  no raw data paths OK"
```
Expected: four OK lines, no FAIL.

- [ ] **Step 4: Commit any final fixes and push the branch**

```bash
git add -A && git commit -m "chore(obos): scope model green end to end"
git push -u origin feat/obos-scope-model
```

---

## Out of scope

Listed so their absence is not read as an oversight. Each is its own spec.

- The icon rail and tabbed sidebar (spec 2) — prototyped at `preview-obos/shell.html`
- Palette tokenisation; 12 hard-coded literals await promotion (spec 2)
- Dubai's real thermal data (spec 3)
- A manifest-driven registry — YAGNI at two cities
- Light theme, per-city basemap styling
- Removing the vertical-green-facades control from production
