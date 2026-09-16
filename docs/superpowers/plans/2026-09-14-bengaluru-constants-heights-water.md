# Bengaluru Constants, Heights Cross-Check and Water Lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Replace the inherited 32 °C fallback with measured IMD month × hour normals for every city.
- Record MG Road's UT-GLOBUS height cross-check offline.
- Draw MG Road's open drains and streams as illustrative ribbons.
- Stop calling the 50 m pocket-park radius a measurement.

**Architecture:**
- **Fallback air temperature.** A pure `fallbackTair(normals, clock)` in `heat-map-model.ts` replaces a scalar. The registry carries `airNormals` per city, and `ScenarioState` gains a required `clock`.
- **Height cross-check.** It moves out of the Earth-Engine-bound heights layer into an offline `--layer crosscheck`, guarded against erasing evidence.
- **Water lines.** They reach the browser as an optional `lines` field. They are drawn through a ribbon builder extracted from the road code and never rasterised.
- **Park radius.** No code change, only its justification.

**Tech Stack:** TypeScript (Astro, `node:test` via `tsx`), three.js, Python 3.12 under strict mypy, DuckDB over Overture S3, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-14-bengaluru-constants-heights-water-design.md`](../specs/2026-09-14-bengaluru-constants-heights-water-design.md)

---

## Conventions this plan assumes

- **Branch.** `feat/bangalore-wards`, repo root `/Volumes/VSTSAMPLES/Projects/Angad`. Do not create a worktree. **Do not `git push`.**
- **Gates.**

  | Command | What it runs |
  |---|---|
  | `npm run check` | The TypeScript gate (expect `0 errors`). |
  | `npm run typecheck` | **mypy** (`files = scripts`, strict), not TypeScript. |
  | `npm run test:unit` | All unit tests. |
  | `npm run test:py` | The Python chain. |
  | `npx tsx --test tests/unit/<file>.test.mjs` | A single unit file. |

- **e2e.** This machine has **no bundled Playwright browsers**. Use a temporary untracked config, and delete it afterwards:

  ```bash
  cat > .pw-chrome.config.ts <<'EOF'
  import { defineConfig } from '@playwright/test';
  import base from './playwright.config';
  export default defineConfig({ ...base, projects: (base.projects ?? []).map((p) => ({ ...p, use: { ...p.use, channel: 'chrome' } })) });
  EOF
  npm run build && npx playwright test <spec> --config=.pw-chrome.config.ts --project=chromium-tier0 --reporter=line
  rm -f .pw-chrome.config.ts
  ```

  Run Playwright in the **foreground**. Never background it and wait for it.
- **Shell.** The shell is zsh.
  - A command stored in a variable does not word-split, so write commands inline.
  - There is no `timeout` binary.
  - Never assign to `path`.
- **Git safety.** **Never** use bare `git stash` or `git stash pop`, and **never** `git commit --amend`.
- **exFAT volume.** Write into `public/` with `cat src > dst` or a script, never `cp`.
- **"A gate that cannot fail is not a gate."** Prove every new test by breaking what it covers, watching it fail, then restoring.
- **Comments.** Say **why**, and name the defect they prevent. Match the surrounding comment density.
- **Commit messages.** End every commit message with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **The dev server** runs on `http://localhost:4321` (Astro dev). Do not stop it.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/scripts/climate-engine/types.ts` | Modify | `AirNormals` type; `ClimateConstants.airNormals` replaces `fallbackTairC`; `parkRadiusM` doc |
| `src/scripts/climate-engine/heat-map-model.ts` | Modify | `ScenarioClock`, `fallbackTair`, `currentParams` reads it; self-check; header comments |
| `src/scripts/climate-engine/scope/registry.ts` | Modify | `airNormals` for Kolkata, Bengaluru and Dubai; comments |
| `src/scripts/climate-engine/scope/resolve.ts` | Modify | Resolves `airNormals`; header comment |
| `src/scripts/climate-engine/heat-map-app.ts` | Modify | `scenarioClock()`, passed to both `currentParams` calls |
| `scripts/validate-model.mjs`, `scripts/geometry-sim-delta.mjs`, `scripts/dump-obos-golden.mjs` | Modify | Explicit clocks |
| `data/calibration/golden-params.json` | Regenerate | Deliberate re-freeze |
| `tests/unit/heat-map-air-normals.test.mjs` | **Create** | Curve and registry transcription |
| `tests/unit/obos-scope.test.mjs` | Modify | Asserts `airNormals` |
| `docs/evidence/data-sources.md`, `docs/evidence/known-limitations.md` | Modify | Normals, UT-GLOBUS results, park size |
| `scripts/fetch-bangalore.py` | Modify | `cross_check`, `run_crosscheck`, `crosscheck_would_erase`, `--layer crosscheck`; `source_tags` + `covered_reach` |
| `data/bangalore/*-buildings.json` | Regenerate | MG Road gains its cross-check |
| `scripts/check-bangalore-artefacts.py` | Modify | Refuses a skipped or empty cross-check |
| `src/scripts/climate-engine/road-ribbon.ts` | Modify | `buildRibbonMesh` extracted; `buildRoadMesh` wraps it |
| `tests/unit/heat-map-roads.test.mjs` | Modify | Byte-identical road-mesh pins |
| `data/bangalore/*-context.json` | Regenerate | Lines carry `covered` |
| `scripts/export-bangalore-obos.py` | Modify | Writes `lines`, `coveredDropped`, `fieldM` |
| `public/heat-map/data/{indiranagar,mg-road,whitefield}-water.json` | Regenerate | Line field |
| `src/scripts/climate-engine/heat-map-model.ts` (`WaterData`) | Modify | Optional `lines` and `fieldM` |
| `src/scripts/climate-engine/water-depth.ts` | Modify | `waterFieldM` |
| `src/scripts/climate-engine/water-layer.ts` | Modify | Draws ribbons; depth field sized per artefact; stale header fixed |
| `tests/unit/bangalore-water-lines.test.mjs` | **Create** | Artefact shape, pins, raster-unchanged |
| `docs/heat-map-intervention-model.md` | Modify | Park-size correction |
| `docs/evidence/park-size-tvoe-preregistration.md` | **Create** | Saved, not-run method |

## Commit order

Each task commits on its own.
- **Task 2 is one atomic commit.** Removing `fallbackTairC` breaks every consumer at once.
- **Task 7 must land before Task 8.** Task 8 draws what Task 7 exports.

---

### Task 1: The fallback curve, as a pure function

**Files:**
- Modify: `src/scripts/climate-engine/types.ts` (add `AirNormals` directly above `export interface ClimateConstants {`, around line 203)
- Modify: `src/scripts/climate-engine/heat-map-model.ts` (import; add `ScenarioClock` and `fallbackTair` directly above `export interface ScenarioState {`, around line 211)
- Test: `tests/unit/heat-map-air-normals.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/heat-map-air-normals.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';

import { fallbackTair, T_MAX_HOUR, T_MIN_HOUR } from '../../src/scripts/climate-engine/heat-map-model.ts';

/* A flat-by-month fixture so the diurnal shape is the only thing under test. */
const N = {
  station: 'fixture', period: 'fixture', source: 'fixture', measured: false,
  maxC: Array(12).fill(30), minC: Array(12).fill(20),
};
const at = (hour, month = 4) => fallbackTair(N, { month, hour });

test('the curve hits the minimum at dawn and the maximum mid-afternoon', () => {
  assert.equal(T_MIN_HOUR, 6);
  assert.equal(T_MAX_HOUR, 14);
  assert.equal(at(6), 20);
  assert.equal(at(14), 30);
  assert.ok(Math.abs(at(10) - 25) < 1e-9, 'halfway up the morning rise is the midpoint');
  assert.ok(Math.abs(at(22) - 25) < 1e-9, 'halfway down the evening fall is the midpoint');
});

test('the curve is continuous at both joins', () => {
  assert.ok(Math.abs(at(5.9999) - at(6)) < 1e-3, 'jump at dawn');
  assert.ok(Math.abs(at(13.9999) - at(14)) < 1e-3, 'jump at the afternoon peak');
});

test('the month picks the row, and hours wrap', () => {
  const byMonth = { ...N, maxC: N.maxC.map((_, i) => 20 + i), minC: N.minC.map((_, i) => 10 + i) };
  assert.equal(fallbackTair(byMonth, { month: 1, hour: 14 }), 20);
  assert.equal(fallbackTair(byMonth, { month: 12, hour: 14 }), 31);
  assert.equal(at(30), at(6), 'hour 30 is 06:00 the next day');
  assert.equal(at(-2), at(22), 'hour -2 is 22:00 the day before');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx tsx --test tests/unit/heat-map-air-normals.test.mjs`
Expected: FAIL, with `does not provide an export named 'fallbackTair'`.

- [ ] **Step 3: Add the type**

In `src/scripts/climate-engine/types.ts`, directly above `export interface ClimateConstants {`, add:

```typescript
/**
 * A city's monthly air-temperature climatology: the mean daily maximum and minimum
 * for each calendar month, from a named station and period.
 *
 * `measured: false` marks a placeholder that has not been sourced (Dubai), so no
 * consumer can mistake a flat invented table for a climatology.
 */
export interface AirNormals {
  readonly station: string;
  readonly period: string;
  readonly source: string;
  readonly measured: boolean;
  /** 12 values, January first: mean daily maximum, °C */
  readonly maxC: readonly number[];
  /** 12 values, January first: mean daily minimum, °C */
  readonly minC: readonly number[];
}
```

- [ ] **Step 4: Add the curve**

In `src/scripts/climate-engine/heat-map-model.ts`, change the types import on line 12 from

```typescript
import { requireGrid, DEFAULT_PARAMS, STORE_NIGHT, type ClimateConstants, type Costs, type SimParams, type SimLayers } from './types.ts';
```

to

```typescript
import { requireGrid, DEFAULT_PARAMS, STORE_NIGHT, type AirNormals, type ClimateConstants, type Costs, type SimParams, type SimLayers } from './types.ts';
```

Directly above `export interface ScenarioState {`, add:

```typescript
/** The moment a scenario describes, in the ward's own time zone. */
export interface ScenarioClock {
  /** 1–12 */
  readonly month: number;
  /** 0 ≤ hour < 24, fractional; out-of-range values wrap */
  readonly hour: number;
}

/** When the diurnal fallback reaches its daily minimum and maximum, local hours. */
export const T_MIN_HOUR = 6;
export const T_MAX_HOUR = 14;

/**
 * Air temperature, °C, from a city's monthly normals at a month and hour.
 *
 * THE SHAPE IS AN ASSUMPTION, THE ENDPOINTS ARE NOT. The station tables give only
 * each month's mean daily maximum and minimum. The minimum is placed at 06:00 and
 * the maximum at 14:00, joined by half-cosines: the textbook diurnal cycle, stated
 * here rather than passed off as observed. Used only when there is no live reading.
 */
export function fallbackTair(normals: AirNormals, clock: ScenarioClock): number {
  const m = Math.min(12, Math.max(1, Math.round(clock.month))) - 1;
  const lo = normals.minC[m], hi = normals.maxC[m];
  const h = ((clock.hour % 24) + 24) % 24;
  if (h >= T_MIN_HOUR && h < T_MAX_HOUR) {
    const t = (h - T_MIN_HOUR) / (T_MAX_HOUR - T_MIN_HOUR);
    return lo + (hi - lo) * (1 - Math.cos(Math.PI * t)) / 2;
  }
  const t = ((h - T_MAX_HOUR + 24) % 24) / (24 - (T_MAX_HOUR - T_MIN_HOUR));
  return hi - (hi - lo) * (1 - Math.cos(Math.PI * t)) / 2;
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx tsx --test tests/unit/heat-map-air-normals.test.mjs`
Expected: 3 pass.

- [ ] **Step 6: Prove the test can fail**

Temporarily change `export const T_MAX_HOUR = 14;` to `15` and run the test. It must FAIL. Restore `14`.
Then temporarily delete `/ 2` from the **first** return line and run the test. It must FAIL. Restore it and re-run: 3 pass.

- [ ] **Step 7: Gates**

Run `npm run check`. Expected: `0 errors`.

- [ ] **Step 8: Commit**

```bash
git add src/scripts/climate-engine/types.ts src/scripts/climate-engine/heat-map-model.ts tests/unit/heat-map-air-normals.test.mjs
git commit -m "feat(heat-map): a month x hour fallback air-temperature curve

Pure fallbackTair(normals, clock): each month's mean daily minimum at 06:00 and
maximum at 14:00, half-cosine between. The endpoints come from station normals;
the diurnal shape is the textbook assumption and the comment says so. Not wired
yet -- the next commit replaces the scalar fallbackTairC with it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Replace `fallbackTairC` with `airNormals`, everywhere, in one commit

**Files:**
- Modify: `src/scripts/climate-engine/types.ts` (`ClimateConstants`)
- Modify: `src/scripts/climate-engine/scope/registry.ts` (import; `CityEntry`; three city entries; Bengaluru comment)
- Modify: `src/scripts/climate-engine/scope/resolve.ts` (line ~376; header line 11)
- Modify: `src/scripts/climate-engine/heat-map-model.ts` (`ScenarioState`; `currentParams` line ~539; self-check ~657–713; header line 84)
- Modify: `src/scripts/climate-engine/heat-map-app.ts` (after `const WARD_TZ = SCOPE.city.tz;`, line ~2265; the two `M.currentParams(state)` calls)
- Modify: `scripts/validate-model.mjs`, `scripts/geometry-sim-delta.mjs`, `scripts/dump-obos-golden.mjs`
- Modify: `tests/unit/obos-scope.test.mjs` (lines ~307 and ~324), `tests/unit/heat-map-air-normals.test.mjs`
- Regenerate: `data/calibration/golden-params.json`

- [ ] **Step 1: Write the failing registry tests**

Append to `tests/unit/heat-map-air-normals.test.mjs`:

```javascript
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';

/* THE TRANSCRIPTION PIN. IMD, Climatological Tables of Observatories in India
   1991–2020 (National Data Centre, Pune). If a registry number drifts from the
   published table, this fails; it is the table, not a copy of the registry. */
const IMD = {
  bengaluru: {
    maxC: [28.4, 30.9, 33.4, 34.1, 33.1, 29.7, 28.3, 28.1, 28.6, 28.5, 27.4, 26.9],
    minC: [16.1, 17.6, 20.2, 22.1, 21.8, 20.6, 20.1, 20.0, 20.0, 19.8, 18.3, 16.4],
  },
  kolkata: {
    maxC: [25.5, 29.4, 33.7, 35.4, 35.5, 34.1, 32.5, 32.3, 32.6, 32.3, 30.2, 26.7],
    minC: [14.3, 18.1, 22.9, 25.7, 26.8, 27.1, 26.7, 26.6, 26.3, 24.4, 20.1, 15.5],
  },
};

test('every city carries twelve sane normals', () => {
  for (const key of ['in/kolkata/ballygunge', 'in/bengaluru/indiranagar', 'ae/dubai/creek']) {
    const n = resolve(key).climate.airNormals;
    assert.equal(n.maxC.length, 12, key);
    assert.equal(n.minC.length, 12, key);
    for (let i = 0; i < 12; i++) {
      assert.ok(Number.isFinite(n.maxC[i]) && Number.isFinite(n.minC[i]), `${key} month ${i + 1}`);
      assert.ok(n.minC[i] <= n.maxC[i], `${key} month ${i + 1}: min above max`);
      assert.ok(n.minC[i] > 0 && n.maxC[i] < 50, `${key} month ${i + 1}: implausible`);
    }
  }
});

test('the Indian normals are IMD 1991–2020, transcribed exactly', () => {
  const b = resolve('in/bengaluru/indiranagar').climate.airNormals;
  const k = resolve('in/kolkata/ballygunge').climate.airNormals;
  assert.deepEqual([...b.maxC], IMD.bengaluru.maxC);
  assert.deepEqual([...b.minC], IMD.bengaluru.minC);
  assert.deepEqual([...k.maxC], IMD.kolkata.maxC);
  assert.deepEqual([...k.minC], IMD.kolkata.minC);
  assert.equal(b.measured, true);
  assert.equal(k.measured, true);
  assert.equal(resolve('ae/dubai/creek').climate.airNormals.measured, false, 'Dubai is a flagged placeholder');
});

test('a Bengaluru December night is cooler than an April afternoon, and the cities differ', () => {
  const b = resolve('in/bengaluru/mg-road').climate.airNormals;
  const k = resolve('in/kolkata/ballygunge').climate.airNormals;
  assert.ok(fallbackTair(b, { month: 12, hour: 3 }) < fallbackTair(b, { month: 4, hour: 13 }) - 10);
  assert.notEqual(fallbackTair(b, { month: 5, hour: 14 }), fallbackTair(k, { month: 5, hour: 14 }));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx tsx --test tests/unit/heat-map-air-normals.test.mjs`
Expected: the three new tests FAIL (`airNormals` is undefined). The first three still pass.

- [ ] **Step 3: `ClimateConstants`**

In `src/scripts/climate-engine/types.ts`, replace

```typescript
  /** Air temperature, °C, used ONLY when the live met feed is down. */
  readonly fallbackTairC: number;
```

with

```typescript
  /**
   * Monthly air-temperature normals, used ONLY when there is no live reading —
   * which includes the first seconds of every page load, before the feed answers.
   * `fallbackTair` (heat-map-model.ts) turns them into a temperature for a month and
   * hour. They replaced one `fallbackTairC` that was 32 °C for Kolkata and, copied,
   * for Bengaluru: up to 16 °C too hot at night against IMD 1991–2020.
   */
  readonly airNormals: AirNormals;
```

- [ ] **Step 4: The registry**

In `src/scripts/climate-engine/scope/registry.ts`:

(a) Directly after `import { WARDS as WARD_TABLE } from '../../../data/wards.ts';`, add:

```typescript
import type { AirNormals } from '../types.ts';
```

(b) In `interface CityEntry`, replace `  readonly fallbackTairC: number;` with `  readonly airNormals: AirNormals;`.

(c) In the Kolkata entry, replace

```typescript
        /** used only when the live met feed is down */
        fallbackTairC: 32,
```

with

```typescript
        /** Monthly normals for the fallback air temperature — used only without a live reading. */
        airNormals: {
          station: 'IMD Kolkata (Alipore) 42807',
          period: '1991–2020',
          source: 'IMD, Climatological Tables of Observatories in India 1991–2020 (National Data Centre, Pune)',
          measured: true,
          maxC: [25.5, 29.4, 33.7, 35.4, 35.5, 34.1, 32.5, 32.3, 32.6, 32.3, 30.2, 26.7],
          minC: [14.3, 18.1, 22.9, 25.7, 26.8, 27.1, 26.7, 26.6, 26.3, 24.4, 20.1, 15.5],
        },
```

(d) In the Bengaluru entry, replace

```typescript
        tz: 'Asia/Kolkata',
        fallbackTairC: 32,
        parkRadiusM: 50,
        data: { heatwave: null, dcUrs: null },
```

with

```typescript
        tz: 'Asia/Kolkata',
        airNormals: {
          station: 'IMD Bengaluru City 43295',
          period: '1991–2020',
          source: 'IMD, Climatological Tables of Observatories in India 1991–2020 (National Data Centre, Pune), pp. 133–138',
          measured: true,
          maxC: [28.4, 30.9, 33.4, 34.1, 33.1, 29.7, 28.3, 28.1, 28.6, 28.5, 27.4, 26.9],
          minC: [16.1, 17.6, 20.2, 22.1, 21.8, 20.6, 20.1, 20.0, 20.0, 19.8, 18.3, 16.4],
        },
        parkRadiusM: 50,
        data: { heatwave: null, dcUrs: null },
```

(e) In the Dubai entry, replace `        fallbackTairC: 40,` with:

```typescript
        /* NOT MEASURED. A flat 40 °C carried from the old scalar so the type holds;
           `measured: false` is what stops it reading as a Gulf climatology. */
        airNormals: {
          station: 'none — placeholder',
          period: 'none',
          source: 'unsourced placeholder, carried from the previous fallbackTairC',
          measured: false,
          maxC: [40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40],
          minC: [40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40],
        },
```

(f) In the comment above the Bengaluru entry, replace the paragraph that begins `TWO NUMBERS HERE ARE INHERITED FROM KOLKATA AND ARE NOT MEASURED.` and ends `any Bengaluru number is quoted to anyone.` with:

```text
         ONE NUMBER HERE IS BORROWED, AND IT IS NOT A MEASUREMENT ANYWHERE.
         `airNormals` is Bengaluru's own: IMD Bengaluru City 1991–2020, which put
         the old inherited 32 °C fallback up to 16 °C too hot at night.
         `parkRadiusM` (50 m) is the pocket-park disc, shared with Kolkata, and it
         is a DESIGN DEFAULT: the "efficient park size" it was once justified by
         is a unit-dependent regression slope, not an area, and could not be
         reproduced from open data. See docs/evidence/park-size-tvoe-preregistration.md.
```

Keep the comment's `/*` / `*/` framing and the paragraph's indentation (9 spaces).

- [ ] **Step 5: `resolve.ts`**

In `src/scripts/climate-engine/scope/resolve.ts`, replace `      fallbackTairC: cityEntry.fallbackTairC,` with `      airNormals: cityEntry.airNormals,`. In the header, replace

```text
 *   FALLBACK_TAIR  32 °C, a Kolkata climatology — a CITY's
```

with

```text
 *   FALLBACK_TAIR  32 °C, a Kolkata climatology — a CITY's (now `airNormals`: IMD monthly normals)
```

- [ ] **Step 6: The model**

In `src/scripts/climate-engine/heat-map-model.ts`:

(a) In `ScenarioState`, directly after `  climate: ClimateConstants;`, add:

```typescript
  /**
   * The moment the scenario describes, in the ward's own time zone.
   *
   * REQUIRED, for the reason `climate` is: the fallback air temperature depends
   * on month and hour, and a default would silently model a moment nobody chose.
   * Read only when `live` is null.
   */
  clock: ScenarioClock;
```

(b) In `currentParams`, replace

```typescript
  const L = s.live, obsTair = L ? L.tAir : s.climate.fallbackTairC, obsRh = L ? L.rh : 60;
```

with

```typescript
  const L = s.live, obsTair = L ? L.tAir : fallbackTair(s.climate.airNormals, s.clock), obsRh = L ? L.rh : 60;
```

(c) In the header, replace

```text
 *   FALLBACK_TAIR  32 °C, Kolkata climatology → REGISTRY.<c>.cities.<y>.fallbackTairC
```

with

```text
 *   FALLBACK_TAIR  32 °C, Kolkata climatology → REGISTRY.<c>.cities.<y>.airNormals (monthly)
```

(d) In the self-check, which starts at the `const climate: ClimateConstants = {` fixture:
- Replace `    fallbackTairC: 32,` with:

  ```typescript
      /* Flat by month and hour, so the physical bars below see the 32 °C they were
         derived against whatever clock a case carries. */
      airNormals: { station: 'fixture', period: 'fixture', source: 'fixture', measured: false,
        maxC: Array(12).fill(32), minC: Array(12).fill(32) },
  ```

- Replace

  ```typescript
    const gulf: ClimateConstants = { pathDelta: {}, fallbackTairC: 40, parkRadiusM: 50, costs: null };
  ```

  with

  ```typescript
    const gulf: ClimateConstants = { pathDelta: {}, parkRadiusM: 50, costs: null,
      airNormals: { station: 'fixture', period: 'fixture', source: 'fixture', measured: false,
        maxC: Array(12).fill(40), minC: Array(12).fill(40) } };
  ```

- Directly above `const p: SimParams = currentParams(` in the self-check, add `  const CLOCK = { month: 4, hour: 13 };`. Then add `clock: CLOCK` to **every** `currentParams({ … })` object literal inside the self-check. Around lines 670, 682, 686, 689, 700, 701, 710 and 713 there are eight.

  `npm run check` in Step 11 lists any you miss as `Property 'clock' is missing`.

- [ ] **Step 7: The app**

In `src/scripts/climate-engine/heat-map-app.ts`, directly after `  const WARD_TZ = SCOPE.city.tz;`, add:

```typescript
  /* THE SCENARIO'S MOMENT, in the ward's own zone. The fallback air temperature is a
     month × hour climatology now, so the physics has to be told when it is modelling.
     "Now" (sunNow non-null) uses the real local hour; the two canonical views use the
     hours their chips print — 13:00 peak, 22:00 retained — in the current month. */
  const wardMonthHour = new Intl.DateTimeFormat('en-GB', {
    timeZone: WARD_TZ, month: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  });
  function scenarioClock(): M.ScenarioClock {
    const parts = wardMonthHour.formatToParts(new Date(now()));
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
    const localHour = part('hour') + part('minute') / 60;
    const hour = state.sunNow != null ? localHour : state.phase === 'night' ? 22 : 13;
    return { month: part('month'), hour };
  }
```

Then replace every `M.currentParams(state)` (two occurrences, around lines 2220 and 2621) with `M.currentParams({ ...state, clock: scenarioClock() })`.

- [ ] **Step 8: The scripts**

`scripts/validate-model.mjs`:
- Replace `const scen = (iv) => ({ live: null, phase: 'peak', path: '2025', climate: CLIMATE, iv });` with:

  ```javascript
  /* A FIXED hot-season canonical peak, so validation never depends on the date it runs. */
  const CLOCK = { month: 4, hour: 13 };
  const scen = (iv) => ({ live: null, phase: 'peak', path: '2025', climate: CLIMATE, iv, clock: CLOCK });
  ```

- In `etBars`, change `M.currentParams({ live, phase: 'peak', path: '2025', climate: CLIMATE, iv: ZERO, ...` to `M.currentParams({ live, phase: 'peak', path: '2025', climate: CLIMATE, iv: ZERO, clock: CLOCK, ...`.

`scripts/geometry-sim-delta.mjs`:
- Replace `M.currentParams({ live: null, phase, path: '2025', climate: CLIMATE, iv: ZERO })` with `M.currentParams({ live: null, phase, path: '2025', climate: CLIMATE, iv: ZERO, clock: { month: 4, hour: phase === 'night' ? 22 : 13 } })`.

`scripts/dump-obos-golden.mjs`:
- Replace `out[key] = currentParams({ live, phase, path, climate: CLIMATE, iv: IV, heatTairC });` with `out[key] = currentParams({ live, phase, path, climate: CLIMATE, iv: IV, heatTairC, clock: { month: 4, hour: phase === 'night' ? 22 : 13 } });`.
- In the Matrix 1 comment, replace `{live, phase, path, climate, iv, heatTairC, sunNow}` with `{live, phase, path, climate, iv, heatTairC, sunNow, clock}`, and add this sentence after it: `The clock is fixed at April (13:00 peak, 22:00 retained) so the frozen fallback cases name one moment.`

- [ ] **Step 9: The scope tests**

In `tests/unit/obos-scope.test.mjs`:
- Replace

  ```javascript
    assert.equal(c.fallbackTairC, REGISTRY.in.cities.kolkata.fallbackTairC);
  ```

  with

  ```javascript
    assert.deepEqual(c.airNormals, REGISTRY.in.cities.kolkata.airNormals);
  ```

- Replace

  ```javascript
    assert.equal(c.fallbackTairC, 40, 'Dubai is not 32 °C');
  ```

  with

  ```javascript
    assert.ok(c.airNormals.maxC.every((v) => v === 40) && c.airNormals.measured === false,
      'Dubai is a flagged placeholder, not Kolkata’s climatology');
  ```

- [ ] **Step 10: Capture the golden-params before and after**

```bash
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
const g = JSON.parse(readFileSync('data/calibration/golden-params.json', 'utf8'));
const cases = g.cases ?? g;
writeFileSync('/private/tmp/claude-501/-Volumes-VSTSAMPLES-Projects-Angad/133f1c21-12cb-4d13-b8aa-55c78df99785/scratchpad/golden-before.json', JSON.stringify(cases));"
node --import tsx scripts/dump-obos-golden.mjs
git diff --quiet data/calibration/golden-layers.json && echo "golden-layers byte-identical"
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const b = JSON.parse(readFileSync('/private/tmp/claude-501/-Volumes-VSTSAMPLES-Projects-Angad/133f1c21-12cb-4d13-b8aa-55c78df99785/scratchpad/golden-before.json', 'utf8'));
const a0 = JSON.parse(readFileSync('data/calibration/golden-params.json', 'utf8')); const a = a0.cases ?? a0;
for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log(k, 'tAir', b[k]?.tAir, '->', a[k].tAir);"
```

Expected:
- `golden-layers byte-identical`.
- Only `nolive` keys change `tAir`: peak cases go from 32 to about 35.03, and night cases from about 29.5 to about 28.05 (the retained convention subtracts 2.5 K).
- Every `live` key is unchanged.

**If a `live` key or golden-layers changed, stop and report.** Keep the printed lines for the commit message.

- [ ] **Step 11: Gates**

Run:
- `npx tsx --test tests/unit/heat-map-air-normals.test.mjs`: expect 6 pass.
- `npm run check`: expect `0 errors`.
- `npm run test:unit`: expect `fail 0`.
- `node --import tsx scripts/validate-model.mjs`: record its summary. **If a bar now fails, stop and report it with the output. Do not loosen it.**

- [ ] **Step 12: Prove the transcription pin can fail**

In `registry.ts`, temporarily change Bengaluru's April `34.1` to `34.2` and run the air-normals test. It must FAIL on `transcribed exactly`. Restore it and re-run: 6 pass.

- [ ] **Step 13: Commit**

```bash
git add src/scripts/climate-engine/types.ts src/scripts/climate-engine/scope/registry.ts src/scripts/climate-engine/scope/resolve.ts src/scripts/climate-engine/heat-map-model.ts src/scripts/climate-engine/heat-map-app.ts scripts/validate-model.mjs scripts/geometry-sim-delta.mjs scripts/dump-obos-golden.mjs tests/unit/obos-scope.test.mjs tests/unit/heat-map-air-normals.test.mjs data/calibration/golden-params.json
git commit -m "feat(heat-map): fallback air temperature from IMD 1991-2020 month x hour normals

fallbackTairC (32 C Kolkata, copied to Bengaluru; 40 C Dubai) becomes airNormals
per city: IMD Bengaluru City 43295 and Kolkata Alipore 42807, 1991-2020 mean
daily max/min by month; Dubai a flat 40 marked measured:false. ScenarioState
gains a required clock; the app passes the ward's local month and hour ('now')
or 13:00 / 22:00 for the canonical views. Scripts pass a fixed April clock.

golden-params re-frozen on purpose; only no-live cases move:
<paste the before -> after lines from Step 10>
golden-layers byte-identical. The published accuracy band does not read the
fallback (calibration uses observed met-forcing).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Evidence for the normals

**Files:**
- Modify: `docs/evidence/data-sources.md`
- Modify: `docs/evidence/known-limitations.md`

- [ ] **Step 1: Data source entry**

Find the Bangalore "### In use" section in `docs/evidence/data-sources.md`. Directly above the `**UT-GLOBUS (Urban Terrain and Global Building heights)**` paragraph, add:

```markdown
**IMD Climatological Tables of Observatories in India, 1991–2020** — India Meteorological Department,
National Data Centre, Pune (imdpune.gov.in, 844-page PDF) · **no licence stated; the monthly normals are
cited as published facts, not redistributed as a dataset** · **role:** the fallback air temperature when no
live reading exists (`airNormals` in `scope/registry.ts`) · stations: **Bengaluru City 43295** (pp. 133–138)
and **Kolkata (Alipore) 42807**, mean daily maximum and minimum by month.
*Cross-check:* GHCN-Daily `IN009010100` agrees within 0.4 °C for 1991–2020; its 2016–2025 mean is warmer
(April 34.9 °C against the normal's 34.1 °C). **Kempegowda International (43293) opened in 2014 — its
"1991–2020" column is a few years of data and must not be used.**
*Ruled out for this role:* the IMD Data Service Portal (commercial use is paid and forbids redistribution
and "consultancy fees"), NOAA GSOD/ISD for non-US stations (WMO Resolution 40 bars commercial re-export),
and Open-Meteo's free tier (non-commercial).
```

- [ ] **Step 2: Known limitation**

Append a new numbered section at the end of `docs/evidence/known-limitations.md`, using the next number after the last existing section:

```markdown
## <N>. The fallback air temperature is a climatology, not a forecast

**Status:** accepted · **See:** [data-sources.md](data-sources.md) (IMD 1991–2020)

When there is no live met.no reading — including the first seconds of every page load — the instrument
models air temperature from the city's IMD 1991–2020 monthly normals: that month's mean daily minimum at
06:00 and maximum at 14:00, joined by half-cosines. Three things this is not:

- **Not today's weather.** A heatwave day or a cool monsoon afternoon sits far from its monthly mean; the
  live reading replaces this the moment it arrives.
- **Not the recent climate.** The normals end in 2020, and the last decade has run warmer (GHCN-Daily,
  Bengaluru: April 2016–2025 averaged 34.9 °C against a normal of 34.1 °C).
- **Not an observed diurnal cycle.** The tables give only daily extremes; the 06:00 / 14:00 placement and
  the curve between them are the standard assumption.

It replaced a single 32 °C for both Indian cities, which ran up to 16 °C too hot at Bengaluru nights.
```

- [ ] **Step 3: Commit**

```bash
git add docs/evidence/data-sources.md docs/evidence/known-limitations.md
git commit -m "docs(evidence): IMD 1991-2020 normals as the fallback air temperature

Source, stations, the GHCN recent-decade cross-check, the Kempegowda trap, and
the sources ruled out for commercial use. A known-limitation entry says what a
climatological fallback is not.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: An offline cross-check that cannot erase evidence

**Files:**
- Modify: `scripts/fetch-bangalore.py`: the `compute_heights` cross-check block (lines ~1094–1122), new functions, `main()` choices and branch, `_self_test`

- [ ] **Step 1: Write the failing self-test**

In `scripts/fetch-bangalore.py`, inside `_self_test()`, directly above its final `print("  fetch-bangalore self-test OK")`, add:

```python
    real = "UT-GLOBUS Bangalore_2.gpkg: 2,274 of 14,867 matched, MAE 3.12 m"
    skip = "SKIPPED -- no UT-GLOBUS tile covering this ward was found."
    assert crosscheck_would_erase(real, None), "a missing tile must not overwrite real evidence"
    assert not crosscheck_would_erase(real, "/tiles/Bangalore_2.gpkg"), "a present tile may re-run"
    assert not crosscheck_would_erase(skip, None), "a skip may be re-recorded as a skip"
    assert not crosscheck_would_erase("", None), "a file with no cross-check may record a skip"
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python3 scripts/fetch-bangalore.py --self-test`
Expected: FAIL, `NameError: name 'crosscheck_would_erase' is not defined`.

- [ ] **Step 3: Extract `cross_check` and add the guard and the layer**

In `compute_heights`, replace the whole block from `    tile = utglobus_tile(w)` through the end of the `else:` branch that prints `cross-check SKIPPED (no covering tile)` with:

```python
    cross_check(w, doc, utglobus_tile(w))
```

Directly above `def compute_heights(w: blr.Ward) -> None:`, add:

```python
def crosscheck_would_erase(existing: str, tile: str | None) -> bool:
    """True when recording a cross-check now would replace real evidence with a skip."""
    return tile is None and bool(existing) and not existing.startswith("SKIPPED")


def cross_check(w: blr.Ward, doc: blr.BlrBuildingsFile, tile: str | None) -> None:
    """Attach UT-GLOBUS heights as `hUt` and `flag`, and write `crossCheck`.

    NEVER TOUCHES `h`. The cross-check is a flag, not a correction: two sources that
    disagree by more than DISAGREE_M are marked, never blended. Split out of
    compute_heights so it can run without Earth Engine (see run_crosscheck).
    """
    bs = doc["b"]
    if tile:
        ut = utglobus_heights(w, tile)
        mx, my = 0, 0
        diffs: list[float] = []
        for b in bs:
            cx, cy = blr.ring_centroid(b["p"])
            hu = ut.get((round(cx / 5.0), round(cy / 5.0)))
            if hu is None:
                continue
            mx += 1
            b["hUt"] = hu
            if not b["fill"] and abs(hu - b["h"]) > blr.DISAGREE_M:
                b["flag"] = True
                my += 1
            if not b["fill"]:
                diffs.append(abs(hu - b["h"]))
        mae = statistics.mean(diffs) if diffs else 0.0
        doc["crossCheck"] = (
            f"UT-GLOBUS {os.path.basename(tile)}: {mx:,} of {len(bs):,} matched, "
            f"MAE {mae:.2f} m, {my:,} flagged >{blr.DISAGREE_M:.0f} m. "
            "Flag only -- never blended into h.")
        print(f"  {w.id:<12} cross-check {mx:,} matched, MAE {mae:.2f} m, "
              f"{my:,} flagged")
    else:
        doc["crossCheck"] = (
            "SKIPPED -- no UT-GLOBUS tile covering this ward was found. "
            "This is a recorded skip, not an absence of disagreement.")
        print(f"  {w.id:<12} cross-check SKIPPED (no covering tile)")


def run_crosscheck(w: blr.Ward) -> None:
    """--layer crosscheck: re-run the UT-GLOBUS comparison on COMMITTED heights, offline.

    WHY THIS EXISTS. The comparison lived only inside compute_heights, which first
    re-reduces every footprint through Earth Engine -- so recording MG Road's check
    meant re-deriving (and possibly moving) every shipped height, on an account that
    now returns 403. This reads the committed file and changes only hUt, flag and
    crossCheck.
    """
    path = os.path.join(blr.DATA, f"{w.id}-buildings.json")
    with open(path, encoding="utf-8") as fh:
        doc = cast(blr.BlrBuildingsFile, json.load(fh))
    tile = utglobus_tile(w)
    existing = str(doc.get("crossCheck", ""))
    if crosscheck_would_erase(existing, tile):
        raise SystemExit(
            f"{w.id}: no UT-GLOBUS tile found, and the file already holds a real cross-check "
            f"({existing[:60]}...). Refusing to overwrite evidence with a skip.")
    for b in doc["b"]:
        loose = cast(dict[str, Any], b)
        loose.pop("hUt", None)
        loose.pop("flag", None)
    cross_check(w, doc, tile)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))
```

In `main()`, change the `choices` tuple to add `"crosscheck"`:

```python
                    choices=("buildings", "heights", "terrain", "context", "canopy",
                             "species", "crosscheck", "osm", "all"))
```

Directly after the `if a.layer == "species":` block, add:

```python
    if a.layer == "crosscheck":
        print("cross-check (UT-GLOBUS against committed heights, offline):")
        for w in wards:
            run_crosscheck(w)
```

- [ ] **Step 4: Run it and watch it pass**

Run: `python3 scripts/fetch-bangalore.py --self-test`
Expected: `  fetch-bangalore self-test OK`

- [ ] **Step 5: Prove the guard test can fail**

Temporarily change `return tile is None and bool(existing) and not existing.startswith("SKIPPED")` to `return False`. The self-test must FAIL on `a missing tile must not overwrite real evidence`. Restore it and re-run.

- [ ] **Step 6: Gates**

Run: `npm run typecheck`. Expected: `Success: no issues found`.
Run: `npm run test:py`. Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add scripts/fetch-bangalore.py
git commit -m "feat(bangalore): offline --layer crosscheck, guarded against erasing evidence

The UT-GLOBUS comparison lived inside compute_heights, which re-reduces every
footprint through Earth Engine (now 403) before comparing -- recording MG Road
meant re-deriving every shipped height. cross_check() is extracted unchanged;
run_crosscheck() reads the committed file and changes only hUt/flag/crossCheck.
A missing tile can no longer overwrite a real result with SKIPPED.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Record MG Road's cross-check and gate it

**Files:**
- Regenerate: `data/bangalore/{indiranagar,mg-road,whitefield}-buildings.json` (only `hUt`, `flag`, `crossCheck` may change; see Step 2b)
- Modify: `scripts/check-bangalore-artefacts.py`
- Modify: `docs/evidence/known-limitations.md` §8, `docs/evidence/data-sources.md`, `docs/superpowers/specs/2026-09-10-bangalore-obos-wards-design.md`

- [ ] **Step 1: Confirm both tiles are real files**

Run: `ls -l data/bangalore/raw/utglobus/ && md5 -q data/bangalore/raw/utglobus/Bangalore_1.gpkg data/bangalore/raw/utglobus/Bangalore_2.gpkg`

Expected:
- Two regular files, not symlinks: 273,190,912 B and 214,093,824 B.
- MD5s `6efdf6d82d8d2fe5b7dd95ddd3a9c45b` and `2fa854a9176cbdaf1af6ec4c626fc84f`.

If either is missing or differs, stop and report.

- [ ] **Step 2: Run the cross-check**

Run: `python3 scripts/fetch-bangalore.py --layer crosscheck`
Then: `git diff --stat data/bangalore/`

Expected (measured 2026-09-14; the command is deterministic):
- Indiranagar prints `2,274 matched, MAE 2.83 m, 302 flagged`.
- MG Road prints `2,100 matched, MAE 3.65 m, 339 flagged`.
- Whitefield prints `2,532 matched, MAE 2.80 m, 178 flagged`.
- `git diff --stat` shows all three `*-buildings.json` changed. Only `hUt`, `flag` and `crossCheck` may differ. Prove it with Step 2b.

**Why Indiranagar and Whitefield no longer read 3.12 m / 391 and 3.13 m / 295.** Those strings were written at `b740dbb` against Google 2.5D heights. `1fec16e` then gave 1,941 and 1,430 buildings OSM-measured heights. The same formula on the `b740dbb` heights reproduces 3.12 / 391 and 3.13 / 295 exactly, so the old strings and per-building `flag`s were stale. **Matched counts must still be 2,274 and 2,532 (same tile). If a matched count differs, stop and report.**

- [ ] **Step 2b: Prove nothing but the cross-check moved**

```bash
python3 - <<'EOF'
import json, subprocess
for w in ("indiranagar", "mg-road", "whitefield"):
    p = f"data/bangalore/{w}-buildings.json"
    old = json.loads(subprocess.check_output(["git", "show", f"HEAD:{p}"]))
    new = json.load(open(p))
    strip = lambda d: ({k: v for k, v in d.items() if k not in ("crossCheck", "b")},
                       [{k: v for k, v in b.items() if k not in ("hUt", "flag")} for b in d["b"]])
    assert strip(old) == strip(new), f"{w}: something other than hUt/flag/crossCheck changed"
    print(w, "only the cross-check moved")
EOF
```

Expected: three `only the cross-check moved` lines.

- [ ] **Step 3: Confirm the map did not change**

Run: `python3 scripts/export-bangalore-obos.py && git status --porcelain public/heat-map/data`
Expected: no output.

- [ ] **Step 4: Gate the artefact**

In `scripts/check-bangalore-artefacts.py`, add `import re` beside the other imports. Inside `for w in blr.WARDS.values():`, directly after the `for pattern in REQUIRED:` loop, add:

```python
        # THE HEIGHT CROSS-CHECK MUST EXIST. A "SKIPPED" here once meant only that a
        # tile was missing, and it read like "no disagreement". Every ward now has a
        # covering UT-GLOBUS tile, so a skip or zero matches is a regression.
        cpath = os.path.join(blr.DATA, f"{w.id}-buildings.json")
        with open(cpath, encoding="utf-8") as fh:
            cross = str(json.load(fh).get("crossCheck", ""))
        matched = re.match(r"UT-GLOBUS \S+: ([\d,]+) of", cross)
        if cross.startswith("SKIPPED") or not matched or int(matched.group(1).replace(",", "")) == 0:
            failures.append(f"{w.id}: no UT-GLOBUS cross-check recorded ({cross[:50]!r})")
```

Run: `python3 scripts/check-bangalore-artefacts.py; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 5: Prove the gate can fail**

```bash
SP=/private/tmp/claude-501/-Volumes-VSTSAMPLES-Projects-Angad/133f1c21-12cb-4d13-b8aa-55c78df99785/scratchpad
cat data/bangalore/mg-road-buildings.json > "$SP/mg-road-buildings.bak.json"
python3 -c "
import json; p='data/bangalore/mg-road-buildings.json'; d=json.load(open(p))
d['crossCheck']='SKIPPED -- no UT-GLOBUS tile covering this ward was found.'
json.dump(d, open(p,'w'), separators=(',',':'))"
python3 scripts/check-bangalore-artefacts.py; echo "exit=$?"
cat "$SP/mg-road-buildings.bak.json" > data/bangalore/mg-road-buildings.json
python3 scripts/check-bangalore-artefacts.py; echo "exit=$?"
```

Expected: the first run prints `FAIL mg-road: no UT-GLOBUS cross-check recorded` and `exit=1`. The restored run gives `exit=0`.

- [ ] **Step 6: Measure the tile margin**

```bash
python3 - <<'EOF'
import sqlite3
from pyproj import Transformer
con = sqlite3.connect("file:data/bangalore/raw/utglobus/Bangalore_1.gpkg?mode=ro", uri=True)
rt = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE name LIKE 'rtree_%' AND name NOT LIKE '%_node' AND name NOT LIKE '%_parent' AND name NOT LIKE '%_rowid'")][0]
to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)
x_edge, y_c = to_utm.transform(77.6159, 12.9755)
row = con.execute(f"SELECT MAX(maxx) FROM {rt} WHERE miny <= ? AND maxy >= ?", (y_c + 1400, y_c - 1400)).fetchone()
print(f"MG Road east edge x={x_edge:.0f} m, tile data max x in the ward's latitude band={row[0]:.0f} m, margin={row[0] - x_edge:.0f} m")
EOF
grep -n "59 m" docs/superpowers/specs/2026-09-10-bangalore-obos-wards-design.md
```

In the 2026-09-10 spec, replace the stated `59 m` margin with the measured value, and add `(measured 2026-09-14 from the tile's building extents)`.

- [ ] **Step 7: Docs**

In `docs/evidence/known-limitations.md` §8, directly after the paragraph that ends `**MAE is the honest statistic there, and 4.0 m on an 8 m building is a 50 % error.**`, add:

```markdown
**Full-ward results, 2026-09-14** (`python3 scripts/fetch-bangalore.py --layer crosscheck`, every
Overture footprint whose centroid matches a UT-GLOBUS building to 5 m; the table above is the earlier
385/373-building sample and stands as that):

| ward | tile | matched | MAE | flagged > 5 m |
|---|---|---:|---:|---:|
| Indiranagar | Bangalore_2 | 2,274 of 14,867 | 2.83 m | 302 |
| Whitefield | Bangalore_2 | 2,532 of 10,897 | 2.80 m | 178 |
| MG Road | Bangalore_1 | <from Step 2> | <from Step 2> | <from Step 2> |

These are measured against the **shipped** heights. The earlier strings (Indiranagar 3.12 m / 391, Whitefield
3.13 m / 295) were measured against the Google 2.5D baseline before OSM-measured heights replaced 1,941 and
1,430 buildings (`1fec16e`). They reproduce to the digit on those older heights, so they were stale, not wrong.
The two sets are not like-for-like (the fill set changed too), so read the drop as consistent with the OSM
heights, not as a measured improvement.
```

Fill MG Road's row with the exact numbers printed in Step 2. If Step 2 printed different Indiranagar or Whitefield numbers than the ones above, use the printed ones. Also in §8, the phrase is hard-wrapped across two lines. Replace

```text
the building carries a **flag and a
widened uncertainty band**
```

with

```text
the building carries a **flag** (a widened on-screen uncertainty band is
designed but not yet built)
```

In `docs/evidence/data-sources.md`, the status sentence is hard-wrapped across lines 507–508. Replace

```text
status: `Bangalore_2` tile in hand
(774,118 buildings, 100 % height coverage); `Bangalore_1` still to fetch for the MG Road ward.
```

with:

```markdown
status: **both tiles in hand**, fetched from `Asia.zip` by HTTP range and decompressed as Deflate64 —
`Bangalore_1.gpkg` (273,190,912 B, MD5 `6efdf6d82d8d2fe5b7dd95ddd3a9c45b`, 964,234 buildings, covers MG
Road) and `Bangalore_2.gpkg` (214,093,824 B, MD5 `2fa854a9176cbdaf1af6ec4c626fc84f`, 774,118 buildings,
covers Indiranagar and Whitefield). Validated only against US LiDAR (building RMSE 9.1 m); no Indian city.
```

- [ ] **Step 8: Gates and commit**

Run: `npm run typecheck`, then `npm run test:py`, then `python3 scripts/check-bangalore-frame.py; echo "exit=$?"`. All must pass (`exit=0`).

```bash
git add data/bangalore/mg-road-buildings.json scripts/check-bangalore-artefacts.py docs/evidence/known-limitations.md docs/evidence/data-sources.md docs/superpowers/specs/2026-09-10-bangalore-obos-wards-design.md
git commit -m "feat(bangalore): MG Road's UT-GLOBUS height cross-check, recorded and gated

--layer crosscheck against Bangalore_1: <paste MG Road's line from Step 2>.
Indiranagar and Whitefield re-recorded against the shipped heights (2.83 m /
302, 2.80 m / 178). Their old 3.12 / 3.13 m strings predate the OSM height
override (1fec16e) and reproduce exactly on the b740dbb heights. Matched
counts are unchanged, which proves Bangalore_2 is the original tile. Only
hUt/flag/crossCheck moved; served files unchanged. check-bangalore-artefacts now refuses a skipped or empty cross-check
(proven by reverting MG Road to SKIPPED). Tile margin re-measured.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: One ribbon builder for roads and water

**Files:**
- Modify: `src/scripts/climate-engine/road-ribbon.ts` (lines 55–129)
- Test: `tests/unit/heat-map-roads.test.mjs`

- [ ] **Step 1: Pin today's road meshes before touching them**

Append to `tests/unit/heat-map-roads.test.mjs`:

```javascript
import { createHash } from 'node:crypto';

/* BYTE-IDENTITY PIN FOR THE RIBBON EXTRACTION. Hashes of buildRoadMesh over every
   shipped roads file, on flat and on sloping ground, captured BEFORE the loop moved
   into buildRibbonMesh. A refactor that changes one vertex fails here. */
const ROAD_FILES = ['ballygunge', 'baruipur', 'barrackpore', 'indiranagar', 'mg-road', 'whitefield'];
const SLOPE = (x, y) => 0.01 * x - 0.005 * y;
const meshHash = (mesh) => createHash('sha256')
  .update(Buffer.from(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength))
  .update(Buffer.from(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength))
  .digest('hex');

const ROAD_MESH_HASHES = {
  /* filled in Step 2 */
};

test('road meshes are byte-identical to the pre-extraction builder', async () => {
  for (const ward of ROAD_FILES) {
    const data = JSON.parse(await readFile(join(ROOT, `public/heat-map/data/${ward}-roads.json`), 'utf8'));
    for (const [name, ground] of [['flat', FLAT], ['slope', SLOPE]]) {
      assert.equal(meshHash(buildRoadMesh(data, ground)), ROAD_MESH_HASHES[`${ward}/${name}`], `${ward}/${name}`);
    }
  }
});
```

- [ ] **Step 2: Capture the hashes with the current code**

```bash
node --import tsx --input-type=module -e "
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildRoadMesh } from './src/scripts/climate-engine/road-ribbon.ts';
const FLAT = () => 0, SLOPE = (x, y) => 0.01 * x - 0.005 * y;
const h = (m) => createHash('sha256').update(Buffer.from(m.positions.buffer, m.positions.byteOffset, m.positions.byteLength)).update(Buffer.from(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength)).digest('hex');
for (const w of ['ballygunge','baruipur','barrackpore','indiranagar','mg-road','whitefield']) {
  const d = JSON.parse(readFileSync('public/heat-map/data/' + w + '-roads.json', 'utf8'));
  for (const [n, g] of [['flat', FLAT], ['slope', SLOPE]]) console.log(\`  '\${w}/\${n}': '\${h(buildRoadMesh(d, g))}',\`);
}"
```

Paste the 12 printed lines into `ROAD_MESH_HASHES`. Then run `npx tsx --test tests/unit/heat-map-roads.test.mjs`. Expected: all pass.

- [ ] **Step 3: Extract the builder**

In `src/scripts/climate-engine/road-ribbon.ts`, replace the whole `export function buildRoadMesh(…) { … }`, including its doc comment, with:

```typescript
/** A polyline to draw as a flat ribbon: flat [x, y, …] in the data frame (x east, y north). */
export interface RibbonLine { readonly p?: readonly number[] }

/**
 * Every line as ONE indexed triangle soup, ready for a single draw call.
 *
 * Shared by roads and water centrelines. Both follow the land, so both drape per
 * vertex; only the width rule and the lift above the ground differ.
 *
 * @param halfWidthOf half the ribbon's width, metres, for one line
 * @param groundAt drawn ground height in metres at a point in the DATA frame
 * @param lift metres above the ground the ribbon sits at
 */
export function buildRibbonMesh<L extends RibbonLine>(
  lines: readonly L[],
  halfWidthOf: (line: L) => number,
  groundAt: (x: number, y: number) => number,
  lift: number,
): RoadMesh | null {
  const pos: number[] = [], idx: number[] = [];
  let ways = 0;

  for (const line of lines) {
    const pts = points(line.p ?? []);
    if (pts.length < 2) continue;
    const half = halfWidthOf(line);
    const base = pos.length / 3;

    /* Unit normal of each segment, left-hand side. */
    const segN: [number, number][] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
      const len = Math.hypot(dx, dy) || 1;
      segN.push([-dy / len, dx / len]);
    }

    for (let i = 0; i < pts.length; i++) {
      const a = segN[Math.max(0, i - 1)], b = segN[Math.min(segN.length - 1, i)];
      let nx = a[0] + b[0], ny = a[1] + b[1];
      const len = Math.hypot(nx, ny);
      /* A doubled-back join sums to zero; fall back to one side's normal. */
      if (len < 1e-6) { nx = b[0]; ny = b[1]; }
      else { nx /= len; ny /= len; }
      /* Exact mitre: scale by 1/cos(half-angle) = 1/(m · n). Clamped both ways. */
      const scale = Math.min(MITRE_MAX, 1 / Math.max(1e-3, nx * b[0] + ny * b[1]));
      const off = half * scale;
      for (const s of [1, -1]) {
        const x = pts[i][0] + nx * off * s, y = pts[i][1] + ny * off * s;
        pos.push(x, groundAt(x, y) + lift, y);
      }
    }

    for (let i = 0; i + 1 < pts.length; i++) {
      const q = base + i * 2;
      idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
    }
    ways++;
  }

  if (!ways) return null;
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), ways };
}

/**
 * Every way in the roads artefact as one ribbon mesh.
 *
 * @param groundAt drawn ground height in metres at a point in the DATA frame
 *   (x east, y north). Sampled per vertex, not per way: a road follows the land.
 */
export function buildRoadMesh(
  data: RoadsData,
  groundAt: (x: number, y: number) => number,
): RoadMesh | null {
  return buildRibbonMesh(data.ways ?? [], (way) => roadHalfWidthM(way.w), groundAt, ROAD_Y);
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx tsx --test tests/unit/heat-map-roads.test.mjs`. Expected: all pass, including the byte-identity pin.

- [ ] **Step 5: Prove the pin can fail**

Temporarily change `ROAD_Y` to `0.76` inside `buildRoadMesh`'s call, i.e. replace `ROAD_Y);` with `0.76);`. Run the test: it must FAIL on the hashes. Restore and re-run.

- [ ] **Step 6: Gates and commit**

Run `npm run check` (expect `0 errors`) and `npm run test:unit` (expect `fail 0`).

```bash
git add src/scripts/climate-engine/road-ribbon.ts tests/unit/heat-map-roads.test.mjs
git commit -m "refactor(heat-map): buildRibbonMesh shared by roads and water lines

The draped, mitre-clamped ribbon loop moves out of buildRoadMesh unchanged, so
water centrelines can use the same hardened code. Road meshes are pinned
byte-identical over all six shipped roads files on flat and sloping ground
(proven: a 1 cm lift change fails the pin).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Water lines in the artefacts (open reaches only)

**Files:**
- Modify: `scripts/fetch-bangalore.py`: `CONTEXT_THEMES` (line ~54); `download_context` cache check (~282); `build_context` water loop (~366); new `covered_reach`; `_self_test`
- Regenerate: `data/bangalore/raw/overture-water.parquet` (gitignored), `data/bangalore/*-context.json`
- Modify: `scripts/export-bangalore-obos.py`: `export_context` and `main()`
- Modify: `src/scripts/climate-engine/heat-map-model.ts` (`WaterData`, around line 190)
- Regenerate: `public/heat-map/data/{indiranagar,mg-road,whitefield}-water.json`
- Test: `tests/unit/bangalore-water-lines.test.mjs`

- [ ] **Step 1: Write the failing self-test**

In `scripts/fetch-bangalore.py` `_self_test()`, directly above its final print, add:

```python
    assert covered_reach({"tunnel": "culvert"}), "a culvert is covered"
    assert covered_reach({"tunnel": "yes"}), "a tunnel is covered"
    assert covered_reach({"covered": "yes"}), "covered=yes is covered"
    assert covered_reach({"culvert": "yes"}), "a culvert key is covered"
    assert not covered_reach({"tunnel": "no"}), "tunnel=no is open"
    assert not covered_reach({"waterway": "drain"}), "an untagged drain is open"
    assert not covered_reach(None), "no tags is open"
```

Run: `python3 scripts/fetch-bangalore.py --self-test`. Expected: FAIL, `NameError: name 'covered_reach' is not defined`.

- [ ] **Step 2: Tags, the covered rule, and a cache that knows its columns**

(a) In `CONTEXT_THEMES`, change the water entry to:

```python
    "water":   ("base", "water", "id, subtype, class, geometry, source_tags"),
```

(b) In `download_context`, replace

```python
        if os.path.exists(dst) and os.path.getsize(dst) > 0:
            print(f"  {name:<8} cache present ({os.path.getsize(dst) / 1e6:.1f} MB)")
            continue
```

with

```python
        if os.path.exists(dst) and os.path.getsize(dst) > 0:
            # A CACHE IS ONLY VALID FOR THE COLUMNS IT WAS SCANNED WITH. The water
            # cache predates `source_tags`, and reusing it would silently draw every
            # culverted drain as open water.
            have = [r[0] for r in con.execute(
                f"DESCRIBE SELECT * FROM read_parquet('{dst}')").fetchall()]
            want = [c.strip() for c in cols.split(",")]
            if have == want:
                print(f"  {name:<8} cache present ({os.path.getsize(dst) / 1e6:.1f} MB)")
                continue
            print(f"  {name:<8} cache columns {have} != {want} -- re-scanning")
```

(c) Directly above `def build_context(wards: list[blr.Ward]) -> None:`, add:

```python
def covered_reach(tags: dict[str, str] | None) -> bool:
    """True for a waterway reach that runs under a road or slab (OSM tunnel/culvert/covered).

    Such a reach is real but invisible from above, so it is not drawn; the exporter
    counts it as `coveredDropped` rather than losing it silently. About 40 % of MG
    Road's reaches are culverts or tunnels (Overpass, 2026-09-14).
    """
    if not tags:
        return False
    return (tags.get("tunnel", "no") not in ("no", "")
            or tags.get("covered") == "yes"
            or "culvert" in tags)
```

(d) In `build_context`, replace

```python
        for _id, subtype, cls, geom in tables["water"]:
```

with

```python
        for _id, subtype, cls, geom, tags in tables["water"]:
```

and replace

```python
            for ln in lines(g):
                water.append({"cls": str(subtype or cls or "stream"), "line": ln})
```

with

```python
            for ln in lines(g):
                # CLASS FIRST for lines: Overture files a drain as subtype=canal,
                # class=drain, and "drain" is the fact worth keeping.
                water.append({"cls": str(cls or subtype or "stream"), "line": ln,
                              "covered": covered_reach(cast("dict[str, str] | None", tags))})
```

- [ ] **Step 3: Self-test and typecheck**

Run: `python3 scripts/fetch-bangalore.py --self-test`. Expected: `  fetch-bangalore self-test OK`.
Run: `npm run typecheck`. Expected: `Success: no issues found`.

- [ ] **Step 4: Re-scan the water, pinned to the release**

Run: `python3 scripts/fetch-bangalore.py --layer context`

Expected:
- `water    cache columns [...] != [...] -- re-scanning`, then `cached N features`.
- `landuse` and `roads` report `cache present`.
- One line per ward with water, green and road counts.

**If S3 returns 404 or 403 for release 2026-07-22.0, stop and report.** The fallback in the spec (re-pull all water from the newest release) needs the coordinator's go-ahead.

Then run: `git diff --stat data/bangalore/`. Expected: only the three `*-context.json` files change.

Check that `green` and `roads` did not move:

```bash
for w in indiranagar mg-road whitefield; do
python3 - "$w" <<'EOF'
import json, subprocess, sys
w = sys.argv[1]
old = json.loads(subprocess.run(["git", "show", f"HEAD:data/bangalore/{w}-context.json"], capture_output=True, text=True, check=True).stdout)
new = json.load(open(f"data/bangalore/{w}-context.json"))
assert old["green"] == new["green"] and old["roads"] == new["roads"], f"{w}: green/roads moved"
opoly = [x for x in old["water"] if "p" in x]; npoly = [x for x in new["water"] if "p" in x]
assert opoly == npoly, f"{w}: water polygons moved"
nl = [x for x in new["water"] if "line" in x]
print(w, "lines", len(nl), "covered", sum(1 for x in nl if x["covered"]))
EOF
done
```

Expected: no assertion error, and one line per ward. **Record MG Road's `lines` and `covered` counts.**

- [ ] **Step 5: `WaterData`**

In `src/scripts/climate-engine/heat-map-model.ts`, replace

```typescript
export interface WaterData { polys: { k: string; p: number[] }[]; }
```

with

```typescript
export interface WaterData {
  polys: { k: string; p: number[] }[];
  /** Open (not culverted) drain/stream/river centrelines, flat [x,y,…] ward metres.
   *  Bengaluru only. DRAWN as illustrative ribbons; never rasterised into SimLayers. */
  lines?: { k: string; p: number[] }[];
  /** Side of the box the artefact was clipped to, metres. Absent means Kolkata's 1520. */
  fieldM?: number;
}
```

- [ ] **Step 6: Write the failing artefact test**

Create `tests/unit/bangalore-water-lines.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { rasterizeWardWater } from '../../src/scripts/climate-engine/ward-raster.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = async (f) => JSON.parse(await readFile(join(ROOT, 'public/heat-map/data', f), 'utf8'));
const BENGALURU = ['indiranagar', 'mg-road', 'whitefield'];

/* MG Road's open-line and covered counts, as measured by the 2026-09-14 re-scan
   (Task 7 Step 4). A regression to dropping lines, or to drawing culverts, moves these. */
const MG_ROAD = { lines: /* Step 4 */ 0, coveredDropped: /* Step 4 */ 0 };

test('Bengaluru water artefacts carry open centrelines and their own field size', async () => {
  for (const ward of BENGALURU) {
    const d = await read(`${ward}-water.json`);
    assert.equal(d.fieldM, 2800, `${ward}: fieldM`);
    assert.ok(Array.isArray(d.lines), `${ward}: lines missing`);
    assert.ok(Number.isInteger(d.coveredDropped) && d.coveredDropped >= 0, `${ward}: coveredDropped`);
    for (const line of d.lines) {
      assert.ok(['drain', 'stream', 'river', 'canal'].includes(line.k), `${ward}: unexpected class ${line.k}`);
      assert.ok(line.p.length >= 4 && line.p.length % 2 === 0, `${ward}: a line needs two points`);
    }
  }
  const mg = await read('mg-road-water.json');
  assert.equal(mg.lines.length, MG_ROAD.lines, 'MG Road open lines');
  assert.equal(mg.coveredDropped, MG_ROAD.coveredDropped, 'MG Road covered reaches');
});

test('Kolkata water artefacts are untouched by the line contract', async () => {
  for (const ward of ['ballygunge', 'baruipur', 'barrackpore']) {
    const d = await read(`${ward}-water.json`);
    assert.equal(d.lines, undefined, `${ward} gained lines`);
    assert.equal(d.fieldM, undefined, `${ward} gained fieldM`);
  }
});

test('water lines never reach the heat model', async () => {
  const d = await read('mg-road-water.json');
  const withLines = rasterizeWardWater(d, 2800, 384);
  const polysOnly = rasterizeWardWater({ polys: d.polys }, 2800, 384);
  assert.deepEqual([...withLines], [...polysOnly], 'the solver raster changed when lines were present');
});
```

Replace the two `0`s in `MG_ROAD` with the counts recorded in Step 4.

Run: `npx tsx --test tests/unit/bangalore-water-lines.test.mjs`. Expected: FAIL, because `fieldM` and `lines` are not exported yet.

- [ ] **Step 7: The exporter**

In `scripts/export-bangalore-obos.py` `export_context`, replace the whole block from the comment `# WATER CENTRELINES ARE DROPPED, AND THAT IS A LOSS WORTH NAMING.` through `return (len(ways), len(polys), dropped)` with:

```python
    # OPEN CENTRELINES SHIP; COVERED ONES ARE COUNTED. Overture gives a drain or a
    # stream as a LINE. They used to be dropped because `WaterData` had nowhere to
    # put one (26 / 37 / 29 across the wards, mostly storm drains). They now travel
    # as `lines`, drawn as illustrative ribbons and never rasterised. A reach under a
    # road or slab (OSM tunnel/culvert/covered) is invisible from above, so it is
    # counted in `coveredDropped` rather than drawn. `fieldM` is the side of the box
    # this artefact was clipped to, which the depth field needs.
    polys: list[dict[str, Any]] = []
    lines: list[dict[str, Any]] = []
    covered = 0
    for x in ctx.get("water", []):
        if x.get("p"):
            polys.append({"k": str(x.get("cls", "water")), "p": x["p"]})
        elif x.get("line"):
            if x.get("covered"):
                covered += 1
                continue
            lines.append({"k": str(x.get("cls", "stream")), "p": x["line"]})
    water: dict[str, Any] = {
        "ward": w.id, "count": len(polys),
        "source": ctx["source"],
        "fieldM": w.size_m,
        "polys": polys,
        "lines": lines,
        "coveredDropped": covered,
    }
    with open(os.path.join(OUT, f"{w.id}-water.json"), "w", encoding="utf-8") as fh:
        json.dump(water, fh, separators=(",", ":"))
    return (len(ways), len(polys), len(lines), covered)
```

Change the function's signature line to `def export_context(w: blr.Ward) -> tuple[int, int, int, int]:`, and its docstring's second line to `Returns (ways, polygons, open lines, covered reaches dropped).`

In `main()`, replace

```python
        ways, polys, dropped = export_context(w)
```

with

```python
        ways, polys, nlines, covered = export_context(w)
```

and in the `print`, replace `f"{polys:3,} water polys ({dropped} centrelines dropped) · {trees:6,} trees · "` with `f"{polys:3,} water polys · {nlines:3,} open lines ({covered} covered dropped) · {trees:6,} trees · "`.

- [ ] **Step 8: Export and watch the test pass**

Run: `python3 scripts/export-bangalore-obos.py && git status --porcelain public/heat-map/data`
Expected: only the three Bengaluru `*-water.json` change.

Run: `npx tsx --test tests/unit/bangalore-water-lines.test.mjs`. Expected: 3 pass.

- [ ] **Step 9: Prove the tests can fail**

(a) In `export-bangalore-obos.py`, temporarily delete the `if x.get("covered"): covered += 1; continue` lines, re-export, and run the test. It must FAIL on the MG Road counts. Restore and re-export.

(b) In the test file, temporarily change the first `rasterizeWardWater(d, 2800, 384)` to `rasterizeWardWater({ polys: [...d.polys, ...d.lines] }, 2800, 384)` and run it. It must FAIL on `the solver raster changed`. Restore and re-run: 3 pass.

- [ ] **Step 10: Gates and commit**

Run `npm run typecheck`, `npm run check`, `npm run test:unit`, `npm run test:py`, and `python3 scripts/check-bangalore-artefacts.py; echo "exit=$?"`. All pass.

```bash
git add scripts/fetch-bangalore.py scripts/export-bangalore-obos.py src/scripts/climate-engine/heat-map-model.ts tests/unit/bangalore-water-lines.test.mjs data/bangalore/indiranagar-context.json data/bangalore/mg-road-context.json data/bangalore/whitefield-context.json public/heat-map/data/indiranagar-water.json public/heat-map/data/mg-road-water.json public/heat-map/data/whitefield-water.json
git commit -m "feat(bangalore): ship open water centrelines; count culverted reaches

Overture water is re-scanned with source_tags (release 2026-07-22.0 pinned); the
context cache now checks its columns. Reaches tagged tunnel/culvert/covered are
counted, not drawn. {ward}-water.json gains lines, coveredDropped and fieldM
(2800). MG Road: <paste lines / covered from Task 7 Step 4>. Polygons, green
and roads unchanged. Lines never reach the solver raster (proven).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Draw the lines; size the depth field per artefact

**Files:**
- Modify: `src/scripts/climate-engine/water-depth.ts` (add `waterFieldM`)
- Modify: `src/scripts/climate-engine/water-layer.ts` (header lines 1–35; `FIELD_SIZE_M`; `depthTexture`; `createWaterLayer`)
- Test: `tests/unit/bangalore-water-lines.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/bangalore-water-lines.test.mjs`:

```javascript
import { waterFieldM } from '../../src/scripts/climate-engine/water-depth.ts';

test('the depth field takes the artefact’s own size, and falls back to Kolkata’s', () => {
  assert.equal(waterFieldM({ polys: [], fieldM: 2800 }), 2800);
  assert.equal(waterFieldM({ polys: [] }), 1520, 'absent → Kolkata clip box');
  assert.equal(waterFieldM({ polys: [], fieldM: 0 }), 1520, 'zero → fallback');
  assert.equal(waterFieldM({ polys: [], fieldM: Number.NaN }), 1520, 'NaN → fallback');
});
```

Run: `npx tsx --test tests/unit/bangalore-water-lines.test.mjs`. Expected: FAIL, `does not provide an export named 'waterFieldM'`.

- [ ] **Step 2: `waterFieldM`**

In `src/scripts/climate-engine/water-depth.ts`, append:

```typescript
/** Kolkata's water artefacts are clipped to ±760 m (CLIP_M*2 in scripts/fetch-water.py). */
export const DEFAULT_WATER_FIELD_M = 1520;

/**
 * The side of the box a water artefact was clipped to, metres.
 *
 * WAS A CONSTANT 1520, which is Kolkata's box. Bengaluru's wards are 2800 m, so
 * every pond beyond 760 m from the centre sampled the depth texture's clamped edge
 * and lost its shading. The artefact now says its own size; files without it are
 * Kolkata's.
 */
export function waterFieldM(data: { readonly fieldM?: number }): number {
  const f = data.fieldM;
  return typeof f === 'number' && Number.isFinite(f) && f > 0 ? f : DEFAULT_WATER_FIELD_M;
}
```

Run the test. Expected: 4 pass.

- [ ] **Step 3: Draw the ribbons**

In `src/scripts/climate-engine/water-layer.ts`:

(a) Replace the header paragraph that runs from `* RENDER ONLY, STILL — but the sentence that followed is no longer true,` through `* file is the look, the rasteriser is the physics, and they share only the artefact.` with:

```text
 * RENDER ONLY. This module draws water polygons and, for Bengaluru, open drain and
 * stream centrelines ({ward}-water.json) and touches nothing in the physics. The
 * solver's water terms exist, but `WATER_LAYER_ENABLED` is false: feeding them was
 * measured and made agreement with ECOSTRESS worse (docs/evidence/known-limitations.md
 * §7). An earlier version of this header said that gate was opened; it was closed again.
```

(b) Change the imports:

```typescript
import { buildDepthField } from './water-depth';
```

to

```typescript
import { buildDepthField, waterFieldM } from './water-depth';
import { buildRibbonMesh } from './road-ribbon';
```

(c) Replace

```typescript
/** The frame the depth field covers. Matches CLIP_M*2 in scripts/fetch-water.py,
 *  so a polygon clipped at the artefact's edge is clipped at the field's edge. */
const FIELD_SIZE_M = 1520;
```

with

```typescript
/**
 * How wide a drawn centreline is. ILLUSTRATIVE, NOT MEASURED: no open source gives
 * Bengaluru drain widths (OSM tags one of 38 MG Road reaches). 3 m is the Blender
 * scenes' STREAM_WIDTH_M, so the web map and the offline renders agree.
 */
export const WATER_LINE_WIDTH_M = 3;
```

(d) In `depthTexture`, replace `const field = buildDepthField(data.polys, FIELD_SIZE_M);` with `const field = buildDepthField(data.polys, waterFieldM(data));`.

(e) In `createWaterLayer`, replace

```typescript
    const geometry = ringGeometry(poly.p);
    if (!geometry) continue;
```

with

```typescript
    const geometry = ringGeometry(poly.p);
    if (!geometry) continue;
    /* The shader reads only position and aFlow. Dropping the rest lets rings merge
       with centreline ribbons, which carry nothing else. */
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');
```

(f) In `createWaterLayer`, replace

```typescript
  if (!geometries.length) return null;
```

with

```typescript
  /* OPEN CENTRELINES, as ribbons that follow the land — a drain runs downhill, unlike
     a pond's level surface — through the same builder roads use. They flow. */
  const ribbons = buildRibbonMesh(data.lines ?? [], () => WATER_LINE_WIDTH_M / 2,
    groundAt ?? (() => 0), 0);
  if (ribbons) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(ribbons.positions, 3));
    g.setIndex(new THREE.BufferAttribute(ribbons.indices, 1));
    g.setAttribute('aFlow', new THREE.BufferAttribute(
      new Float32Array(ribbons.positions.length / 3).fill(1), 1));
    geometries.push(g);
  }
  if (!geometries.length) return null;
```

(g) In the material options, replace `uFieldSize: { value: FIELD_SIZE_M },` with `uFieldSize: { value: waterFieldM(data) },`. Directly after `depthWrite: false,                  /* buildings occlude; water never does */`, add:

```typescript
    side: THREE.DoubleSide,             /* a ribbon mitre can wind either way */
```

- [ ] **Step 4: Gates**

Run `npm run check` (expect `0 errors`) and `npm run test:unit` (expect `fail 0`).

- [ ] **Step 5: See it**

With the dev server on 4321, run:

```bash
SP=/private/tmp/claude-501/-Volumes-VSTSAMPLES-Projects-Angad/133f1c21-12cb-4d13-b8aa-55c78df99785/scratchpad
cat > "$SP/water-lines-shot.mjs" <<'EOF'
import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const c = await b.newContext({ viewport: { width: 1512, height: 900 }, reducedMotion: 'reduce' });
const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('http://localhost:4321/heat-map/in/bengaluru/mg-road/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.waitForFunction(() => /\d/.test(document.querySelector('#bcount')?.textContent ?? ''), null, { timeout: 120000 });
await p.waitForTimeout(12000);
await p.screenshot({ path: `${process.env.SP}/water-lines-mg-road.png` });
const box = await p.locator('#mlmap').boundingBox();
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
for (let i = 0; i < 3; i++) { await p.mouse.wheel(0, -120); await p.waitForTimeout(300); }
await p.waitForTimeout(2500);
await p.screenshot({ path: `${process.env.SP}/water-lines-mg-road-zoom.png` });
console.log(JSON.stringify({ pageErrors: errs }));
await b.close();
EOF
SP="$SP" node --input-type=module < "$SP/water-lines-shot.mjs"
```

Expected: `{"pageErrors":[]}`.

Open both PNGs with the Read tool and describe what you see:
- thin water-coloured lines along drains and streams, joining the ponds;
- no water drawn through buildings;
- ponds away from the centre still shaded.

**If the lines are invisible or wrong, stop and report with the screenshots.**

- [ ] **Step 5b: Drain evidence**

In `docs/evidence/data-sources.md`, directly after the UT-GLOBUS paragraph, which ends with the line `**0.0 m** and maximum **492 m**; both are artefacts and must be dropped or clipped before any comparison.`, leave one blank line and add:

```markdown
**Overture Maps `base/water` centrelines (OSM-derived), release 2026-07-22.0** — **ODbL 1.0**; a published
derived database must be shared alike · **role:** Bengaluru's open drains and streams, drawn as 3 m
**illustrative** ribbons, never in the solver · covered reaches (OSM `tunnel`/`culvert`/`covered=yes`)
counted and not drawn. **No defensible channel widths exist openly**: OSM tags one width in 38 MG Road
reaches; BBMP's 2022 storm-water-drain KMLs carry order only (and a portal-only licence label); the
"22 / 16 / 6–9 ft" primary/secondary/tertiary figures are blog-sourced. **Legal buffers are not widths** —
the current rule is Karnataka Gazette UDD 468 MNJ 2025(E), 15 Oct 2025: 15 / 10 / 5 m from the drain edge;
the NGT's 50 / 35 / 25 m (4 May 2016) was set aside by the Supreme Court in *Mantri Techzone v Forward
Foundation* (5 Mar 2019). BBMP's primary/secondary/tertiary order was considered and not adopted: its
licence is a portal label only, and its tertiary drains largely do not align with OSM outside MG Road.
```

- [ ] **Step 6: e2e and commit**

Run the e2e specs `tests/e2e/heat-map-ward-prefetch.spec.ts tests/e2e/heat-map-second-city.spec.ts` with the temporary config from Conventions. Expected: `7 passed`. Delete the config afterwards.

```bash
git add src/scripts/climate-engine/water-depth.ts src/scripts/climate-engine/water-layer.ts tests/unit/bangalore-water-lines.test.mjs docs/evidence/data-sources.md
git commit -m "feat(heat-map): draw open water centrelines; depth field sized per artefact

Bengaluru's open drains and streams render as 3 m illustrative ribbons (the
Blender scenes' width) through the shared ribbon builder, draped on the terrain
and merged into the water mesh. The depth field reads the artefact's fieldM, so
Bengaluru ponds beyond 760 m from the centre regain their shading. The stale
header claiming the solver reads water is corrected. Lines stay out of the heat
model.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The 50 m park radius, justified honestly

**Files:**
- Modify: `src/scripts/climate-engine/scope/registry.ts` (Kolkata `parkRadiusM` comment, line ~147)
- Modify: `src/scripts/climate-engine/types.ts` (`parkRadiusM` doc, line ~220)
- Modify: `src/scripts/climate-engine/heat-map-model.ts` (header line ~85; comment lines ~109–111)
- Modify: `src/scripts/climate-engine/scope/resolve.ts` (header line 10)
- Modify: `docs/heat-map-intervention-model.md` (lines ~91, ~162, ~166, ~170)
- Create: `docs/evidence/park-size-tvoe-preregistration.md`
- Modify: `docs/evidence/known-limitations.md`

- [ ] **Step 1: Code comments**

Make each replacement exactly:

| File | Replace | With |
|---|---|---|
| `registry.ts` | `        /** cooling-blob radius, metres — Kolkata's measured tree-void-effect scale */` | `        /** pocket-park disc radius, metres — a DESIGN DEFAULT (~0.8 ha), not a measurement; see docs/evidence/park-size-tvoe-preregistration.md */` |
| `types.ts` | `  /** Cooling-blob radius, metres — the city's measured tree-void-effect scale. */` | `  /** Pocket-park disc radius, metres — a design default, not a measured size. See docs/evidence/park-size-tvoe-preregistration.md. */` |
| `heat-map-model.ts` | ` *   PARK_R_M       50 m, Kolkata TVoE scale   → REGISTRY.<c>.cities.<y>.parkRadiusM` | ` *   PARK_R_M       50 m, pocket-park default  → REGISTRY.<c>.cities.<y>.parkRadiusM` |
| `resolve.ts` | ` *   PARK_R_M       50 m, measured as Kolkata's tree-void-effect scale — a CITY's` | ` *   PARK_R_M       50 m, a pocket-park design default — a CITY's` |

In `heat-map-model.ts`, replace

```typescript
/* §3.3's park blob radius is now `applyInterventions`' `parkRadiusM` parameter —
   it was 50 m, measured as KOLKATA's tree-void-effect scale, and a city's measured
   length is not a property of the operator that applies it. See the note above. */
```

with

```typescript
/* §3.3's park blob radius is now `applyInterventions`' `parkRadiusM` parameter — a
   CITY's value, not a property of the operator that applies it. It is a design
   default (50 m, a ~0.8 ha pocket park), NOT a measurement: the Li et al. 2022
   "efficient park size" it was once derived from is a regression slope whose value
   does not depend on the area unit. See docs/evidence/park-size-tvoe-preregistration.md. */
```

Run: `grep -rnE "TVoE|tree-void" src scripts --include='*.ts' --include='*.py' --include='*.mjs'`. Expected: no remaining claim that 50 m is measured. `validate-model.mjs`'s Li et al. references are about 8.07 °C maximum cooling, not TVoE, and stay.

- [ ] **Step 2: The intervention-model doc**

In `docs/heat-map-intervention-model.md`, directly after the `> Full record: \`green-score-methodology.md\` §4.2.` line of the 2026-08-08 correction in §3.3, add:

```markdown

> **CORRECTION 2026-09-14 — "TVoE 0.77 ha" is not a park size.** Li et al. 2022 define TVoE as the point
> where the slope of `UCI = a·ln(Area) + b` equals one, which makes **TVoE = a**: a cooling slope whose
> numeric value is the same whatever unit the area is in (0.77 would read as 0.77 m² or 0.77 km² just as
> well). It is also internally inconsistent in the paper (Table 7 gives Bangkok 0.62 against the text's
> 0.42), and Kolkata's sample cannot be reproduced from open data (the 90 parks were hand-picked in
> Google Earth; OSM with the stated rules yields 28). **The 50 m blob radius is therefore a design
> default — a ~0.8 ha pocket park — not a measured efficient size, for Kolkata or Bengaluru.** A
> pre-registered method to measure it properly is saved, not run:
> `docs/evidence/park-size-tvoe-preregistration.md`.
```

Then:
- In the line `blob radius r = 50 m (≈ 0.77 ha — Kolkata's TVoE = the efficient park size)`, replace the parenthetical with `(≈ 0.8 ha pocket park — a design default; see the 2026-09-14 correction)`.
- `TVoE ≈ 0.77 ha` occurs **twice**; change both, using these unique strings:
  - Line ~91: replace `max cooling distance ≈ 420 m, TVoE ≈ 0.77 ha** [4]` with `max cooling distance ≈ 420 m, TVoE ≈ 0.77 (a slope, not an area — see §3.3)** [4]`.
  - Line ~166: replace `**TVoE ≈ 0.77 ha**, reach ≤ 420 m` with `**TVoE ≈ 0.77** (a slope, not a park size — see the 2026-09-14 correction), reach ≤ 420 m`.
- Run `grep -c "TVoE ≈ 0.77 ha" docs/heat-map-intervention-model.md`. Expected: `0`.
- On the correction line ~162, change `**TVoE 0.77 ha and reach 420 m are genuinely Kolkata's and stand.**` to `**Reach 420 m is genuinely Kolkata's and stands; "TVoE 0.77 ha" does not mean a park size — see the 2026-09-14 correction.**`.

- [ ] **Step 3: The saved pre-registration**

Create `docs/evidence/park-size-tvoe-preregistration.md`:

```markdown
# Pocket-park size — a pre-registered measurement (NOT RUN)

**Status:** saved 2026-09-14, deliberately not run · **Decision:** keep `parkRadiusM = 50` as a design
default; see `docs/heat-map-intervention-model.md` §3.3 (2026-09-14 correction).

## Why it was not run

A feasibility study (2026-09-14) found three things:

1. **The quantity is ill-posed.** Li et al. 2022 (10.3389/fenvs.2022.1073914) define TVoE where the slope
   of `UCI = a·ln(Area) + b` is one, so TVoE = a — a regression slope whose value is unit-independent.
   Comparing a Bengaluru "TVoE" to Kolkata's "0.77 ha" compares slopes, not sizes.
2. **Kolkata cannot be reproduced.** Li hand-picked 90 tree-dominated parks in Google Earth (not usable
   here). OSM with Li's literal rules yields 28, none ≥ 5 ha (Li's ran to 39.42 ha).
3. **Bengaluru lacks the large parks a stable fit needs.** Under any isolation rule only 1–4 parks above
   5 ha survive; Li's own fits were weak (R² 0.08 / 0.31 / 0.12). An inconclusive interval was the likely
   outcome.

Yu et al. 2017's correct DOI is **10.1016/j.ecolind.2017.07.002** (`…06.037` is an unrelated paper).

## The method, fixed in advance, should it ever be run

- **Surface temperature:** Landsat Collection 2 Level-2 ST (`lwir11`) via Microsoft Planetary Computer
  (SAS token path `/token/landsat-c2-l2`), path/row 144/051, cloud < 20 %, **December–February 2019–2025**
  (41 L8/L9 scenes; Li used winter). QA_PIXEL bits 1, 3, 4, 7 masked. °C = DN × 0.00341802 + 149.0 − 273.15.
  Stated deviation: USGS ST product, not Li's ESTARFM-fused LST. Mar–May reported, not decisive.
- **Parks:** OSM `leisure=park|garden` ≥ 900 m²; ESA WorldCover 2021 tree cover (class 10) ≥ 50 %; no
  WorldCover water inside; ≥ 300 m from other park/garden/forest and water ≥ 1 ha. Per scene, drop a park
  with < 80 % clear pixels; require ≥ 3 valid scenes.
- **Cooling intensity (Li's):** 18 rings × 30 m; intensity = LST at the first turning point minus park
  LST; drop scenes cooler at ring 1 or without a turning point; per-park median across scenes.
- **Fit:** OLS `intensity = a·ln(area_ha) + b`; report `a` as °C per ln(ha); defined only if a > 0,
  p < 0.05.
- **Uncertainty:** 10,000 park-level bootstrap resamples (fixed seed), percentile 95 % CI; 2 km spatial
  block bootstrap as sensitivity.
- **Kolkata gate, run first:** same pipeline, winter 2020–21 (138/044–045), UTM 45N; must return a CI
  containing Li's 0.77 and excluding 0, or no Bengaluru number is used.
- **Placebo:** each selected park's shape pasted onto random built-up locations (WorldCover built-up ≥ 50 %,
  trees < 10 %); a placebo slope CI excluding 0 on the positive side voids the result.
- **Decision rule:** gate fails, placebo fires, < 60 parks, a ≤ 0 or p ≥ 0.05 → keep 50 m, "not
  measurable"; CI half-width > 0.5 → keep, "inconclusive"; CI contains 0.77 → keep, "consistent with
  Kolkata"; CI excludes 0.77 → Bengaluru-only radius √(a·10⁴/π) m.

## The better question, recorded beside it

Pocket parks are small, and Bengaluru has hundreds of them (OSM: 2,178 under 0.25 ha, 1,219 at 0.25–1 ha,
377 at 1–5 ha). A physically meaningful measurement is **cooling intensity by park-size band**
(0.1–0.25 / 0.25–1 / 1–5 ha) with the same ring metric, setting the pocket-park size to the smallest band
that reliably cools. It needs its own pre-registration before any number is looked at.
```

- [ ] **Step 4: Known limitation**

Append a new numbered section at the end of `docs/evidence/known-limitations.md`:

```markdown
## <N>. The pocket-park size is a design default, not a measurement

**Status:** accepted · **See:** [park-size-tvoe-preregistration.md](park-size-tvoe-preregistration.md)

The pocket-parks slider paints discs of 50 m radius (~0.8 ha) in every city. That number was justified as
Kolkata's "efficient park size" (TVoE 0.77 ha, Li et al. 2022). It is not one: TVoE is a regression slope
whose value does not change with the area unit, the paper is internally inconsistent, and the Kolkata
sample was hand-picked in Google Earth and cannot be reproduced from open data. The radius stands as a
reasonable pocket-park size; the cooling it produces comes from the solver running on the painted
vegetation, not from the radius itself.
```

- [ ] **Step 5: Gates and commit**

Run `npm run check` (expect `0 errors`) and `npm run test:unit` (expect `fail 0`).

```bash
git add src/scripts/climate-engine/scope/registry.ts src/scripts/climate-engine/types.ts src/scripts/climate-engine/heat-map-model.ts src/scripts/climate-engine/scope/resolve.ts docs/heat-map-intervention-model.md docs/evidence/park-size-tvoe-preregistration.md docs/evidence/known-limitations.md
git commit -m "docs(heat-map): the 50 m pocket-park radius is a design default, not a TVoE

Li et al. 2022's TVoE is where the log-fit slope equals one, i.e. the slope
itself, so '0.77 ha' is unit-independent and not a park size; the paper's
tables disagree and Kolkata's hand-picked sample is not reproducible from open
data. No value changes. Code comments and the intervention-model doc now say
so, and a pre-registered measurement is saved, not run.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Final verification

**Files:** none changed

- [ ] **Step 1: Every gate**

Run each one and confirm its result:

| Command | Expected |
|---|---|
| `npm run check` | `0 errors` |
| `npm run typecheck` | `Success: no issues found` |
| `npm run test:unit` | `fail 0` |
| `npm run test:py` | exit 0 |
| `python3 scripts/check-bangalore-artefacts.py; echo $?` | `0` |
| `python3 scripts/check-bangalore-frame.py; echo $?` | `0` |
| `node --import tsx scripts/validate-model.mjs` | summary recorded, no new failing bar |
| `npm run build` | completes |
| e2e: `tests/e2e/heat-map-ward-prefetch.spec.ts tests/e2e/heat-map-second-city.spec.ts` (temp config) | `7 passed` |

- [ ] **Step 2: The fallback on screen**

On the dev server, open `http://localhost:4321/heat-map/in/bengaluru/mg-road/`.
- Block the live feed with DevTools → Network → request blocking `*/api/live*`, then reload.
- Confirm "Mean surface temp" is lower on the `22:00 RETAINED` chip than on `13:00 PEAK`.
- Confirm there are no console errors.

Report both readings.

- [ ] **Step 3: Report**

Report:
- every gate result;
- the golden-params before → after lines;
- MG Road's cross-check line and the measured tile margin;
- MG Road's open-line and covered counts;
- what the water screenshots show;
- anything that deviated from this plan.

---

## Self-review

**Spec coverage.**

| Spec requirement | Task |
|---|---|
| `airNormals` per city (Bengaluru, Kolkata, Dubai placeholder) | 2 |
| Half-cosine curve, min 06:00, max 14:00 | 1 |
| Required `clock`; app local time; 13:00 / 22:00 canonical | 2 |
| Scripts use an explicit clock; golden-params re-frozen with before/after; golden-layers identical | 2 |
| Accuracy band untouched; validate bars reported, not loosened | 2, 10 |
| Transcription, curve, season and city tests, each proven | 1, 2 |
| Evidence: normals, recent decade, Kempegowda, licence traps | 3 |
| `cross_check` extracted; offline `--layer crosscheck`; never touches `h` | 4 |
| Guard against a SKIPPED overwrite | 4 |
| Match counts reproduce; all three re-recorded on shipped `h`; served files byte-identical | 5 |
| Artefact gate refuses skip or zero matches, proven | 5 |
| known-limitations §8, data-sources, tile margin | 5 |
| Overture re-scan with `source_tags`, release pinned; covered reaches excluded and counted | 7 |
| `lines`, `coveredDropped`, `fieldM`; Kolkata unchanged | 7 |
| Shared `buildRibbonMesh`; roads byte-identical | 6 |
| 3 m ribbons, draped, merged, water shader; depth field per `fieldM` | 8 |
| Lines never rasterised | 7 |
| Screenshot viewed | 8 |
| Park radius unchanged; justification rewritten; pre-registration saved; size-band alternative recorded | 9 |
| ODbL and no-defensible-widths evidence | 7 (source string), 8 (comment), 3/5 docs |

**Gap fixed inline:** the spec's evidence on drain widths, legal buffers and the unadopted BBMP drain order had no doc step. It is now Task 8 Step 5b, and `docs/evidence/data-sources.md` is in Task 8's commit.

**Placeholder scan.** The deliberate fill-ins are measured values the plan cannot know in advance. Each names the exact step that produces it:
- MG Road's cross-check numbers (Task 5 Step 2)
- the tile margin (Task 5 Step 6)
- MG Road's line counts (Task 7 Step 4)
- the golden before → after lines (Task 2 Step 10)
- the road-mesh hashes (Task 6 Step 2)
- the `<N>` section numbers (the next number in the file)

**Type consistency.**
- `AirNormals`, `ScenarioClock`, `fallbackTair`, `T_MIN_HOUR` and `T_MAX_HOUR` are defined in Task 1 and used in Task 2.
- `crosscheck_would_erase`, `cross_check(w, doc, tile)` and `run_crosscheck` are defined together in Task 4.
- `RibbonLine` and `buildRibbonMesh(lines, halfWidthOf, groundAt, lift)` are defined in Task 6 and used in Task 8.
- `WaterData.lines` and `WaterData.fieldM` are defined in Task 7 and read in Task 8.
- `waterFieldM` and `DEFAULT_WATER_FIELD_M` are defined in Task 8.
- `covered_reach` is defined and used in Task 7.
