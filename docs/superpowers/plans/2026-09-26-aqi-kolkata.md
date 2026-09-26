# OBOS Air Quality (Kolkata) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show live and 30-day CPCB air quality for the three Kolkata OBOS areas: a folded block in the right panel and an "Air" pane in the left rail, fed by one server-side TypeScript function over OpenAQ.

**Architecture:** Pure, unit-tested modules in `src/lib/aqi/` (CPCB arithmetic, IST hour-building, station registry, OpenAQ client, response builder), one Vercel Function `api/air-quality.ts` that composes them and caches at the CDN, and one painter `src/scripts/climate-engine/air/air-panel.ts` that turns the typed response into the approved markup. The browser never talks to OpenAQ and never computes an AQI.

**Tech Stack:** TypeScript (Node 24 type stripping, `.ts` import specifiers), Astro, Vercel Functions, `node --test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-26-aqi-kolkata-design.md`. **Approved preview:** `previews/aqi-kolkata/template.html` (git-ignored; copy styles and copy from it, never link it).

**Worktree:** `~/delta-worktrees/aqi-kolkata`, branch `feat/aqi-kolkata`. Never switch the main checkout; never push without the founder's word.

---

## Ground rules for every task

- Run commands from the worktree root. zsh: never assign a lowercase variable named `path`.
- Stage files by name; never `git add -A`.
- A task is done only when its own tests pass AND `npm run check` passes (Astro type-checks every `.ts` in the tree, including `api/`).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- The OpenAQ key lives in `~/.config/delta-climate/openaq-key` (dev) and in the Vercel env var `OPENAQ_API_KEY` (preview/production, added by the founder). Never print it, log it, commit it or put it in a fixture.

## File map

| File | Responsibility |
|---|---|
| `src/lib/aqi/types.ts` (exists; amend in Task 1) | The contract shared by function and UI |
| `src/lib/aqi/cpcb.ts` | CPCB breakpoints, sub-index, category, publish rule. Pure. |
| `src/lib/aqi/hours.ts` | Raw 15-min readings → IST clock-hour means → CPCB window values. Pure. |
| `src/lib/aqi/stations.ts` | The three Kolkata areas → station, sensors and **true units** |
| `src/lib/aqi/openaq.ts` | Fetch + validate OpenAQ measurements for one sensor window |
| `src/lib/aqi/build.ts` | Assemble `AirQualityPayload` (current state + 30-day history) from hours, `now` injected |
| `api/air-quality.ts` | HTTP boundary: method, area allowlist, key, timeouts, cache headers |
| `astro.config.mjs` | Mount the function in `devApiProxies()` |
| `src/components/ClimateEngine/shell/IconRail.astro` | Add the **Air** section |
| `src/components/ClimateEngine/HeatMapStage.astro` | Air pane markup, right-panel `#aqiBlock`, CSS |
| `src/scripts/climate-engine/air/air-panel.ts` | Pure HTML builders for card and pane, per state |
| `src/scripts/climate-engine/heat-map-app.ts` | Fetch on area load; place the block like Solar's |
| `tests/unit/aqi-*.test.mjs` | Unit tests per module |
| `tests/fixtures/aqi/*.json` | Recorded OpenAQ responses (no key inside) |
| `tests/unit/obos-shell.test.mjs` | Rail now has seven sections |
| `docs/AQI/05-research-register.md` | Record every gate outcome |

---

### Task 1: Close the CPCB workbook gate and fix the contract's final shape

This is a research task with a written outcome, not code. Nothing in Task 2 may be committed before it.

**Files:**
- Modify: `docs/AQI/05-research-register.md` (new rows AQI-R33…)
- Modify: `src/lib/aqi/types.ts`
- Modify: `docs/superpowers/specs/2026-09-26-aqi-kolkata-design.md` §3

- [ ] **Step 1: Fetch the official workbook and report**

```bash
mkdir -p ~/.cache/delta-climate/cpcb && cd ~/.cache/delta-climate/cpcb
curl -sL -o AQI-Calculator.xls https://app.cpcbccr.com/ccr_docs/AQI-Calculator.xls
curl -sL -o FINAL-REPORT_AQI_.pdf https://app.cpcbccr.com/ccr_docs/FINAL-REPORT_AQI_.pdf
file AQI-Calculator.xls FINAL-REPORT_AQI_.pdf
shasum -a 256 AQI-Calculator.xls FINAL-REPORT_AQI_.pdf
```

Expected: an Excel 97 file and a PDF. If either download fails, stop and report; do not proceed on memory.

- [ ] **Step 2: Read the workbook's formulas**

```bash
python3 -m venv /tmp/xlsvenv && /tmp/xlsvenv/bin/pip -q install xlrd==2.0.1
/tmp/xlsvenv/bin/python - <<'EOF'
import os, xlrd
b = xlrd.open_workbook(os.path.expanduser("~/.cache/delta-climate/cpcb/AQI-Calculator.xls"), formatting_info=False)
for sh in b.sheets():
    print("=== SHEET", sh.name, sh.nrows, "x", sh.ncols)
    for r in range(min(sh.nrows, 80)):
        row = [str(sh.cell_value(r, c)) for c in range(min(sh.ncols, 14))]
        if any(x.strip() for x in row): print(r, " | ".join(row))
EOF
pdftotext -layout ~/.cache/delta-climate/cpcb/FINAL-REPORT_AQI_.pdf /tmp/cpcb.txt && grep -n -i -E "8-hour|8 hour|16 hour|minimum|rolling|maximum" /tmp/cpcb.txt | head -40
```

Answer, with quoted evidence (sheet/cell or PDF page), each of:
1. The concentration breakpoints for PM10, PM2.5, NO₂, SO₂, CO, O₃, NH₃ (compare with `BREAKPOINTS` in Task 2; list any difference).
2. For CO and O₃: is the value the **maximum of the rolling 8-hour means within the 24 hours**, or the latest 8-hour mean?
3. How many valid hours a 24-hour pollutant needs (expected 16), and what an 8-hour value needs.
4. How a concentration falling between two published bands (e.g. PM2.5 = 30.5) is treated.
5. Whether the sub-index is rounded, and how.

- [ ] **Step 3: Record the outcome**

Add one register row per answer (`AQI-R33` onward, status "Verified <date>"), quoting the evidence. If any answer differs from Task 2's code below, edit Task 2's code in this plan **before** starting Task 2, and say so in the commit message.

- [ ] **Step 4: Fix the contract's final shape**

One fetch of 31 days serves both the current state and the history, so the endpoint returns both. Area ids use OBOS's existing `AreaKey` form. Append to `src/lib/aqi/types.ts`:

```ts
/** What `GET /api/air-quality?area=in/kolkata/ballygunge` returns. */
export interface AirQualityPayload {
  current: AirQualityResponse;
  history: HistoryResponse | null;
}
```

In the same file change `PollutantReading.value` from `number` to `number | null`: a pollutant with no readings in its window carries `null`, never 0 (spec §3: "Missing is null, never 0").

In the spec §3/§6, replace `area_id=kolkata/ballygunge` with `area=in/kolkata/ballygunge` and `&view=history` with "the same response carries `history`".

- [ ] **Step 5: Verify and commit**

Run: `npm run check`
Expected: `0 errors`.

```bash
git add docs/AQI/05-research-register.md src/lib/aqi/types.ts docs/superpowers/specs/2026-09-26-aqi-kolkata-design.md
git commit -m "docs(aqi): CPCB workbook gate closed; one payload carries current and history

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: CPCB arithmetic

**Decisions from the Task 1 gate (register AQI-R33–R39), fixed here:**
- **Continuous bands, as CPCB's official calculator computes them** (workbook Sheet1 D8–D20): each band starts at the previous band's top edge, so PM2.5 = 31 gives 51.67 → 52. The "31–60" style table edges are display rounding and are NOT used.
- **Severe is open-ended and uncapped**, as in the calculator: above the last edge the Very Poor slope continues (PM2.5 300 → 438). Ozone uses its own Very Poor slope (100/540) above 748 µg/m³, not the workbook's defective `400+(C-400)*100/539` formula (register AQI-R34).
- **Rounding** only at the end (`Math.round`), which matches the workbook's integer display and cannot change which sub-index is largest.
- Algorithm id stays `cpcb-aqi-1` and means exactly the above.

**Files:**
- Create: `src/lib/aqi/cpcb.ts`
- Test: `tests/unit/aqi-cpcb.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/aqi-cpcb.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { subIndex, category, combine, MIN_HOURS } from '../../src/lib/aqi/cpcb.ts';

test('sub-index hits every band edge exactly (calculator edges)', () => {
  assert.equal(subIndex('pm25', 0), 0);
  assert.equal(subIndex('pm25', 30), 50);
  assert.equal(subIndex('pm25', 60), 100);
  assert.equal(subIndex('pm25', 90), 200);
  assert.equal(subIndex('pm25', 120), 300);
  assert.equal(subIndex('pm25', 250), 400);
  assert.equal(subIndex('pm10', 100), 100);
  assert.equal(subIndex('pm10', 250), 200);
  assert.equal(subIndex('no2', 80), 100);
  assert.equal(subIndex('co', 2.0), 100);
  assert.equal(subIndex('o3', 168), 200);
  assert.equal(subIndex('so2', 380), 200);
});

test('bands are continuous, as the CPCB calculator computes them (not the 31/51 table form)', () => {
  assert.equal(subIndex('pm25', 31), 52);    // 50 + (31-30) × 50/30 = 51.67
  assert.equal(subIndex('pm25', 45), 75);    // 50 + 15 × 50/30 = 75
  assert.equal(subIndex('pm25', 61.1), 104); // 100 + 1.1 × 100/30 = 103.67
  assert.equal(subIndex('co', 1.09), 55);    // 50 + 0.09 × 50/1 = 54.5 → 55 (round half up)
});

test('Severe is open-ended: the Very Poor slope continues with no cap', () => {
  assert.equal(subIndex('pm25', 300), 438);  // 400 + 50 × 100/130 = 438.46
  assert.equal(subIndex('pm10', 600), 613);  // 400 + 170 × 100/80 = 612.5 → 613
  assert.equal(subIndex('o3', 800), 410);    // 400 + 52 × 100/540 = 409.6 (not the workbook's defective 474)
});

test('category follows the index bands; above 500 is still Severe', () => {
  assert.equal(category(50), 'good');
  assert.equal(category(51), 'satisfactory');
  assert.equal(category(100), 'satisfactory');
  assert.equal(category(101), 'moderate');
  assert.equal(category(200), 'moderate');
  assert.equal(category(201), 'poor');
  assert.equal(category(400), 'very_poor');
  assert.equal(category(401), 'severe');
  assert.equal(category(900), 'severe');
});

const r = (parameter, value, hours, sub) => ({ parameter, value, unit: parameter === 'co' ? 'mg_m3' : 'ug_m3',
  window_h: ['co', 'o3'].includes(parameter) ? 8 : 24, hours_present: hours, sub_index: sub });

test('the AQI is the MAXIMUM valid sub-index, never an average', () => {
  const out = combine([r('pm25', 45, 24, 75), r('no2', 20, 24, 25), r('o3', 90, 24, 90)]);
  assert.equal(out.ok, true);
  assert.equal(out.ok && out.aqi, 90);
  assert.equal(out.ok && out.dominant, 'o3');
});

test('publishing needs three valid pollutants, one of them PM', () => {
  assert.equal(combine([r('pm25', 45, 24, 75), r('no2', 20, 24, 25)]).ok, false);
  const noPm = combine([r('no2', 20, 24, 25), r('so2', 5, 24, 6), r('o3', 90, 24, 90)]);
  assert.equal(noPm.ok, false);
  assert.match(noPm.ok ? '' : noPm.reasons.join(' '), /PM2\.5 or PM10/);
});

test(`a pollutant with fewer than ${MIN_HOURS} hours does not count`, () => {
  const out = combine([r('pm25', 45, MIN_HOURS - 1, null), r('no2', 20, 24, 25), r('o3', 90, 24, 90), r('so2', 5, 24, 6)]);
  assert.equal(out.ok, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/unit/aqi-cpcb.test.mjs`
Expected: FAIL, `Cannot find module '.../src/lib/aqi/cpcb.ts'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/aqi/cpcb.ts
/**
 * CPCB National AQI arithmetic, as CPCB's official AQI calculator computes it
 * (cpcb.nic.in AQI-Calculator.xls, Sheet1 D8–D20; register AQI-R33–R39):
 * continuous bands, an open-ended uncapped Severe band continuing the Very Poor
 * slope, rounding only at the end. One deliberate deviation: ozone above 748 µg/m³
 * continues its own Very Poor slope instead of the workbook's defective formula.
 * Pure: no I/O, no clocks. Changing a number here is an algorithm change.
 */
import type { CpcbCategory, Pollutant, PollutantReading } from './types.ts';

export const ALGORITHM = 'cpcb-aqi-1' as const;
/** Valid IST hours a pollutant needs in its window (CPCB: "a minimum of 16 hours' data"). */
export const MIN_HOURS = 16;

/** Sub-index value at each concentration edge below. */
const INDEX_EDGES = [0, 50, 100, 200, 300, 400] as const;

/** Concentration edges: the tops of Good, Satisfactory, Moderate, Poor, Very Poor. µg/m³; CO in mg/m³. */
export const EDGES: Readonly<Record<Pollutant, readonly [number, number, number, number, number, number]>> = {
  pm10: [0, 50, 100, 250, 350, 430],
  pm25: [0, 30, 60, 90, 120, 250],
  no2: [0, 40, 80, 180, 280, 400],
  so2: [0, 40, 80, 380, 800, 1600],
  co: [0, 1, 2, 10, 17, 34],
  o3: [0, 50, 100, 168, 208, 748],
  nh3: [0, 200, 400, 800, 1200, 1800],
};

const CATEGORIES: readonly CpcbCategory[] = ['good', 'satisfactory', 'moderate', 'poor', 'very_poor', 'severe'];

export function subIndex(p: Pollutant, c: number): number {
  const e = EDGES[p];
  for (let i = 0; i < 5; i++) {
    if (c <= e[i + 1]!) {
      const x = Math.max(c, e[i]!);
      return Math.round(INDEX_EDGES[i]! + ((INDEX_EDGES[i + 1]! - INDEX_EDGES[i]!) * (x - e[i]!)) / (e[i + 1]! - e[i]!));
    }
  }
  // Severe: open-ended, the Very Poor slope continues with no cap.
  return Math.round(400 + ((c - e[5]) * 100) / (e[5] - e[4]));
}

export function category(aqi: number): CpcbCategory {
  const i = [50, 100, 200, 300, 400].findIndex((hi) => aqi <= hi);
  return CATEGORIES[i === -1 ? 5 : i]!;
}

export type Combined =
  | { ok: true; aqi: number; category: CpcbCategory; dominant: Pollutant }
  | { ok: false; reasons: string[] };

const LABEL: Readonly<Record<Pollutant, string>> = { pm25: 'PM2.5', pm10: 'PM10', no2: 'NO2', so2: 'SO2', co: 'CO', o3: 'O3', nh3: 'NH3' };

/** The CPCB publish rule (workbook G11/A21): at least three valid pollutants including PM2.5 or PM10; AQI = maximum sub-index. */
export function combine(readings: readonly PollutantReading[]): Combined {
  const reasons = readings
    .filter((q) => q.hours_present < MIN_HOURS)
    .map((q) => `${LABEL[q.parameter]} had ${q.hours_present} of ${MIN_HOURS} required hours`);
  const valid = readings.filter((q) => q.sub_index !== null && q.hours_present >= MIN_HOURS);
  const hasPm = valid.some((q) => q.parameter === 'pm25' || q.parameter === 'pm10');
  if (!hasPm) reasons.push('no valid PM2.5 or PM10');
  if (valid.length < 3) reasons.push(`${valid.length} valid pollutants; CPCB needs 3`);
  if (!hasPm || valid.length < 3) return { ok: false, reasons };
  const top = valid.reduce((a, b) => ((b.sub_index ?? -1) > (a.sub_index ?? -1) ? b : a));
  const aqi = top.sub_index!;
  return { ok: true, aqi, category: category(aqi), dominant: top.parameter };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test tests/unit/aqi-cpcb.test.mjs`
Expected: all tests PASS.

- [ ] **Step 5: Mutation proofs** (a gate that cannot fail is not a gate)

1. Replace the continuous interpolation with the table form (band start `e[i] + 1` above Good, index start `INDEX_EDGES[i] + 1`): the "continuous" test must FAIL.
2. Replace the Severe line with `return 500`: the "Severe is open-ended" test must FAIL.
3. Make `combine` average the sub-indices: the "MAXIMUM" test must FAIL.
Revert all three; rerun: PASS. Paste each red run's failing assertion into the commit message body.

- [ ] **Step 6: Commit**

```bash
git add src/lib/aqi/cpcb.ts tests/unit/aqi-cpcb.test.mjs
git commit -m "feat(aqi): CPCB sub-index, category and publish rule, as CPCB's calculator computes them

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: IST hours and CPCB windows

**Files:**
- Create: `src/lib/aqi/hours.ts`
- Create: `tests/fixtures/aqi/ballygunge-pm25-2025-12-15.json`
- Test: `tests/unit/aqi-hours.test.mjs`

- [ ] **Step 1: Record the real fixture** (OpenAQ raw PM2.5, Ballygunge, the morning already cross-checked against OpenCity)

```bash
K=$(tr -d '[:space:]' < ~/.config/delta-climate/openaq-key)
curl -s -H "X-API-Key: $K" "https://api.openaq.org/v3/sensors/12236012/measurements?datetime_from=2025-12-15T00:00:00Z&datetime_to=2025-12-15T06:00:00Z&limit=100" \
 | python3 -c "import json,sys; d=json.load(sys.stdin); json.dump([{'end_utc': m['period']['datetimeTo']['utc'], 'value': m['value']} for m in d['results']], open('tests/fixtures/aqi/ballygunge-pm25-2025-12-15.json','w'), indent=1)"
python3 -c "import json; d=json.load(open('tests/fixtures/aqi/ballygunge-pm25-2025-12-15.json')); print(len(d), d[0], d[-1])"
```

Expected: 18 readings, first `{'end_utc': '2025-12-15T00:30:00Z', 'value': 62.9}`.

- [ ] **Step 2: Write the failing test**

```js
// tests/unit/aqi-hours.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { istHours, istHourKey, window24, window8 } from '../../src/lib/aqi/hours.ts';

const raw = JSON.parse(readFileSync(new URL('../fixtures/aqi/ballygunge-pm25-2025-12-15.json', import.meta.url)));

test('a reading stamped at its END belongs to the IST hour it closes within', () => {
  // 00:30Z end = 06:00 IST end = the 05:45-06:00 quarter = IST hour 05:00
  assert.equal(istHourKey('2025-12-15T00:30:00Z'), '2025-12-15T05');
  assert.equal(istHourKey('2025-12-15T00:45:00Z'), '2025-12-15T06');
});

test('the dropped quarter-hour does not shift or blank an hour', () => {
  const h = istHours(raw);
  // IST 06:00-07:00: OpenAQ has 06:15, 06:30 (60.7, 60.7) and drops 06:45; 07:00 (60.0) belongs to it
  assert.equal(h.get('2025-12-15T06').n, 3);
  assert.equal(Math.round(h.get('2025-12-15T06').mean * 100) / 100, 60.47);
});

test('a reading of 0 counts as missing, as in the CPCB calculator', () => {
  const h = istHours([{ end_utc: '2025-12-15T00:30:00Z', value: 0 }, { end_utc: '2025-12-15T00:45:00Z', value: 5 }]);
  assert.equal(h.has('2025-12-15T05'), false);
  assert.equal(h.get('2025-12-15T06').n, 1);
});

test('a 24-hour window counts only hours present', () => {
  const hours = new Map([['2025-12-15T05', { mean: 10, n: 3 }], ['2025-12-15T06', { mean: 20, n: 3 }]]);
  assert.deepEqual(window24(hours, '2025-12-15T07'), { value: 15, hours: 2 });
});

test('an 8-hour value is the maximum rolling 8-hour mean inside the 24 hours', () => {
  const hours = new Map();
  for (let i = 0; i < 24; i++) hours.set(`2025-12-15T${String(i).padStart(2, '0')}`, { mean: i < 8 ? 100 : 10, n: 3 });
  assert.deepEqual(window8(hours, '2025-12-16T00'), { value: 100, hours: 24 });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --import tsx --test tests/unit/aqi-hours.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

```ts
// src/lib/aqi/hours.ts
/**
 * Raw OpenAQ readings -> IST clock-hour means -> CPCB window values. Pure.
 * Never use OpenAQ's /hours: it drops one quarter-hour in four and buckets by UTC
 * hours, which straddle IST hours (register AQI-R23).
 */
export interface Raw { end_utc: string; value: number }
export interface Hour { mean: number; n: number }
/** Hour keys are 'YYYY-MM-DDTHH' in IST, naming the hour's START. */
export type HourKey = string;

const IST_MS = 5.5 * 3_600_000;
const QUARTER_MS = 15 * 60_000;

export function istHourKey(endUtc: string): HourKey {
  const startIst = new Date(Date.parse(endUtc) + IST_MS - QUARTER_MS);
  return startIst.toISOString().slice(0, 13);
}

export function istHours(raw: readonly Raw[]): Map<HourKey, Hour> {
  const acc = new Map<HourKey, { sum: number; n: number }>();
  for (const r of raw) {
    if (!Number.isFinite(r.value) || r.value <= 0) continue; // CPCB's calculator counts 0 as missing (workbook E8)
    const k = istHourKey(r.end_utc);
    const a = acc.get(k) ?? { sum: 0, n: 0 };
    a.sum += r.value; a.n += 1; acc.set(k, a);
  }
  return new Map([...acc].map(([k, a]) => [k, { mean: a.sum / a.n, n: a.n }]));
}

/** The 24 hour keys before `endKey` (exclusive), oldest first. */
export function hoursBefore(endKey: HourKey, count = 24): HourKey[] {
  const end = Date.parse(`${endKey}:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(end - (count - i) * 3_600_000).toISOString().slice(0, 13));
}

export function window24(hours: ReadonlyMap<HourKey, Hour>, endKey: HourKey): { value: number | null; hours: number } {
  const vals = hoursBefore(endKey).map((k) => hours.get(k)?.mean).filter((v): v is number => v !== undefined);
  return { value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, hours: vals.length };
}

/** Minimum hours inside one 8-hour sub-window. CPCB states none (register AQI-R38); 6 of 8 is an OBOS choice, declared. */
export const MIN_8H = 6;

export function window8(hours: ReadonlyMap<HourKey, Hour>, endKey: HourKey): { value: number | null; hours: number } {
  const day = hoursBefore(endKey);
  let best: number | null = null;
  for (let s = 0; s + 8 <= day.length; s++) {
    const vals = day.slice(s, s + 8).map((k) => hours.get(k)?.mean).filter((v): v is number => v !== undefined);
    if (vals.length >= MIN_8H) {
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      best = best === null ? m : Math.max(best, m);
    }
  }
  return { value: best, hours: day.filter((k) => hours.has(k)).length };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `node --import tsx --test tests/unit/aqi-hours.test.mjs`
Expected: PASS. If the `60.47` assertion fails, print `istHours(raw)` and check the three readings against the OpenCity table recorded in register AQI-R22 before changing anything.

- [ ] **Step 6: Mutation proof, then commit**

Remove `- QUARTER_MS` from `istHourKey`: the first test must FAIL. Revert.

```bash
git add src/lib/aqi/hours.ts tests/unit/aqi-hours.test.mjs tests/fixtures/aqi/ballygunge-pm25-2025-12-15.json
git commit -m "feat(aqi): IST hour-building from raw readings and CPCB 24 h / 8 h windows

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Station registry with verified units

**Files:**
- Create: `src/lib/aqi/stations.ts`
- Test: `tests/unit/aqi-stations.test.mjs`

- [ ] **Step 1: Verify Barrackpore's units the same way Ballygunge's were** (register AQI-R31 marks them inferred)

OpenCity has no Barrackpore archive, so compare Barrackpore with the CPCB-native Ballygunge readings' **magnitudes** at the same hours instead:

```bash
K=$(tr -d '[:space:]' < ~/.config/delta-climate/openaq-key)
for s in 12236007 12238553; do curl -s -H "X-API-Key: $K" "https://api.openaq.org/v3/sensors/$s/measurements?datetime_from=2026-09-01T00:00:00Z&datetime_to=2026-09-08T00:00:00Z&limit=1000" | python3 -c "import json,sys,statistics as S; v=[m['value'] for m in json.load(sys.stdin)['results']]; print($s, len(v), 'median', round(S.median(v),3), 'range', min(v), max(v))"; done
```

Expected: both CO sensors report medians of the same order (about 0.3 to 1.5), which is mg/m³. A median in the hundreds would mean real ppb: stop and report. Record the outcome in the register (Barrackpore units verified or not).

- [ ] **Step 2: Write the failing test**

```js
// tests/unit/aqi-stations.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { AREAS, stationFor } from '../../src/lib/aqi/stations.ts';
import { allWards } from '../../src/data/cities.ts';

/* _types.py ward_bounds, restated: the square OBOS reads is built with this spherical factor. */
const mPerDeg = (lat) => [111_320 * Math.cos((lat * Math.PI) / 180), 110_540];
const havM = (a, b, c, d) => { const R = 6_371_008.8, r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };

test('every Kolkata area is registered, Baruipur deliberately without a station', () => {
  assert.deepEqual(Object.keys(AREAS).sort(), ['in/kolkata/ballygunge', 'in/kolkata/barrackpore', 'in/kolkata/baruipur']);
  assert.equal(stationFor('in/kolkata/baruipur'), null);
});

test('each station lies inside its area\'s 3 km window, at the distance it claims', () => {
  for (const [key, st] of Object.entries(AREAS)) {
    if (!st) continue;
    const w = allWards().find((x) => x.id === key.split('/')[2]);
    const [mx, my] = mPerDeg(w.lat);
    assert.ok(Math.abs(st.lon - w.lon) * mx <= 1500 && Math.abs(st.lat - w.lat) * my <= 1500, `${key}: station outside the 3 km window`);
    assert.ok(Math.abs(havM(w.lat, w.lon, st.lat, st.lon) - st.distance_m) <= 10, `${key}: distance_m disagrees with the coordinates`);
  }
});

test('no sensor is declared in ppb: units come from verification, never from OpenAQ labels', () => {
  for (const st of Object.values(AREAS)) {
    if (!st) continue;
    for (const s of Object.values(st.sensors)) assert.ok(s.unit === 'ug_m3' || s.unit === 'mg_m3');
    assert.equal(st.sensors.co.unit, 'mg_m3');
  }
});
```

- [ ] **Step 3: Run to verify it fails**, then **Step 4: implement**

```ts
// src/lib/aqi/stations.ts
/**
 * The three Kolkata areas and their government monitors. Positions verified
 * 2026-09-26 (register AQI-R20, R21); UNITS VERIFIED AGAINST OpenCity's native-unit
 * archive, not taken from OpenAQ's labels, which are wrong (AQI-R31). A change here
 * is a data claim: update the register in the same commit.
 */
import type { AqiStation, Pollutant } from './types.ts';

export interface SensorRef { id: number; unit: 'ug_m3' | 'mg_m3' }
export interface StationEntry extends Omit<AqiStation, 'inside'> {
  owner: string;
  sensors: Readonly<Record<'pm25' | 'pm10' | 'no2' | 'so2' | 'co' | 'o3', SensorRef>>;
}

export const AREAS: Readonly<Record<string, StationEntry | null>> = {
  'in/kolkata/ballygunge': {
    id: 'openaq:10918', name: 'Ballygunge, Kolkata', owner: 'West Bengal Pollution Control Board',
    lat: 22.5367507, lon: 88.3638022, distance_m: 993,
    sensors: { pm25: { id: 12236012, unit: 'ug_m3' }, pm10: { id: 12236011, unit: 'ug_m3' }, no2: { id: 12236009, unit: 'ug_m3' },
               so2: { id: 12236014, unit: 'ug_m3' }, co: { id: 12236007, unit: 'mg_m3' }, o3: { id: 12236010, unit: 'ug_m3' } },
  },
  'in/kolkata/barrackpore': {
    id: 'openaq:3409509', name: 'SVSPA Campus, Barrackpore', owner: 'West Bengal Pollution Control Board',
    lat: 22.7605581, lon: 88.3617589, distance_m: 995,
    sensors: { pm25: { id: 12238558, unit: 'ug_m3' }, pm10: { id: 12238557, unit: 'ug_m3' }, no2: { id: 12238555, unit: 'ug_m3' },
               so2: { id: 12238560, unit: 'ug_m3' }, co: { id: 12238553, unit: 'mg_m3' }, o3: { id: 12238556, unit: 'ug_m3' } },
  },
  'in/kolkata/baruipur': null,
};

export function isAirArea(key: string): boolean { return Object.hasOwn(AREAS, key); }
export function stationFor(key: string): StationEntry | null { return AREAS[key] ?? null; }
export const POLLUTANTS: readonly Pollutant[] = ['pm25', 'pm10', 'no2', 'so2', 'co', 'o3'];
```

- [ ] **Step 5: Run to verify it passes; commit**

Run: `node --import tsx --test tests/unit/aqi-stations.test.mjs` → PASS. If the distance test fails, recompute `distance_m` from the coordinates (never loosen the tolerance).

```bash
git add src/lib/aqi/stations.ts tests/unit/aqi-stations.test.mjs docs/AQI/05-research-register.md
git commit -m "feat(aqi): Kolkata station registry with verified sensor units

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: OpenAQ client

**Files:**
- Create: `src/lib/aqi/openaq.ts`
- Test: `tests/unit/aqi-openaq.test.mjs`

- [ ] **Step 1: Write the failing test** (a fake `fetch` is injected; no network in unit tests)

```js
// tests/unit/aqi-openaq.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchSensorWindow, OpenAqError } from '../../src/lib/aqi/openaq.ts';

const page = (n, from) => ({ results: Array.from({ length: n }, (_, i) => ({ value: i, period: { datetimeTo: { utc: new Date(Date.parse(from) + i * 900_000).toISOString() } } })) });

test('pages until a short page and sends the key only as a header', async () => {
  const calls = [];
  const fake = async (url, init) => { calls.push({ url: String(url), key: init.headers['X-API-Key'] });
    return new Response(JSON.stringify(calls.length === 1 ? page(1000, '2026-09-01T00:15:00Z') : page(3, '2026-09-12T00:15:00Z'))); };
  const rows = await fetchSensorWindow(123, '2026-09-01T00:00:00Z', '2026-09-25T00:00:00Z', { key: 'k', fetch: fake });
  assert.equal(rows.length, 1003);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.key === 'k' && !c.url.includes('k=') && !c.url.includes('api_key')));
});

test('malformed rows are dropped, not coerced to zero', async () => {
  const fake = async () => new Response(JSON.stringify({ results: [{ value: 'x', period: { datetimeTo: { utc: '2026-09-01T00:15:00Z' } } }, { value: 5, period: {} }, { value: 7, period: { datetimeTo: { utc: '2026-09-01T00:30:00Z' } } }] }));
  const rows = await fetchSensorWindow(1, 'a', 'b', { key: 'k', fetch: fake });
  assert.deepEqual(rows, [{ end_utc: '2026-09-01T00:30:00Z', value: 7 }]);
});

test('an upstream error becomes a typed OpenAqError', async () => {
  const fake = async () => new Response('nope', { status: 503 });
  await assert.rejects(fetchSensorWindow(1, 'a', 'b', { key: 'k', fetch: fake }), (e) => e instanceof OpenAqError && e.status === 503);
});
```

- [ ] **Step 2: Run to verify it fails**, then **Step 3: implement**

```ts
// src/lib/aqi/openaq.ts
/** OpenAQ v3 measurements for one sensor window. Server-side only: the key travels as a header, never in a URL. */
import type { Raw } from './hours.ts';

export class OpenAqError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export interface OpenAqOptions { key: string; fetch?: typeof fetch; timeoutMs?: number; maxPages?: number }

const BASE = 'https://api.openaq.org/v3/sensors';
const PAGE = 1000;

export async function fetchSensorWindow(sensorId: number, fromUtc: string, toUtc: string, o: OpenAqOptions): Promise<Raw[]> {
  const f = o.fetch ?? fetch;
  const out: Raw[] = [];
  for (let page = 1; page <= (o.maxPages ?? 6); page++) {
    const u = new URL(`${BASE}/${sensorId}/measurements`);
    u.searchParams.set('datetime_from', fromUtc); u.searchParams.set('datetime_to', toUtc);
    u.searchParams.set('limit', String(PAGE)); u.searchParams.set('page', String(page));
    const res = await f(u, { headers: { 'X-API-Key': o.key, Accept: 'application/json' }, signal: AbortSignal.timeout(o.timeoutMs ?? 10_000) });
    if (!res.ok) throw new OpenAqError(res.status, `OpenAQ ${res.status} for sensor ${sensorId}`);
    const body: unknown = await res.json();
    const results = (body as { results?: unknown }).results;
    if (!Array.isArray(results)) throw new OpenAqError(502, 'OpenAQ returned no results array');
    for (const m of results as { value?: unknown; period?: { datetimeTo?: { utc?: unknown } } }[]) {
      const end = m.period?.datetimeTo?.utc;
      if (typeof m.value === 'number' && Number.isFinite(m.value) && typeof end === 'string') out.push({ end_utc: end, value: m.value });
    }
    if (results.length < PAGE) return out;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes; commit**

Run: `node --import tsx --test tests/unit/aqi-openaq.test.mjs` → PASS.

```bash
git add src/lib/aqi/openaq.ts tests/unit/aqi-openaq.test.mjs
git commit -m "feat(aqi): OpenAQ measurements client, header-only key, typed errors

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Build the payload and its five states

**Files:**
- Create: `src/lib/aqi/build.ts`
- Test: `tests/unit/aqi-build.test.mjs`

- [ ] **Step 1: Write the failing test** (synthetic hours; `now` injected)

```js
// tests/unit/aqi-build.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPayload, LIVE_H, STALE_DAYS } from '../../src/lib/aqi/build.ts';
import { stationFor } from '../../src/lib/aqi/stations.ts';

const KEY = 'in/kolkata/ballygunge';
/** Every pollutant reporting every quarter-hour up to `lastEnd`, clean air. */
function rawUpTo(lastEnd, days = 31) {
  const end = Date.parse(lastEnd), out = {};
  for (const p of ['pm25', 'pm10', 'no2', 'so2', 'co', 'o3']) {
    out[p] = [];
    for (let t = end - days * 86_400_000; t <= end; t += 900_000) out[p].push({ end_utc: new Date(t).toISOString(), value: p === 'co' ? 0.5 : 20 });
  }
  return out;
}

test('fresh complete data is live', () => {
  const p = buildPayload(KEY, stationFor(KEY), rawUpTo('2026-09-24T17:30:00Z'), new Date('2026-09-24T18:30:00Z'));
  assert.equal(p.current.state, 'live');
  assert.equal(p.current.result.category, 'good');
  assert.equal(p.history.days.length, 30);
});

test(`older than ${LIVE_H} h is stale, with its age`, () => {
  const p = buildPayload(KEY, stationFor(KEY), rawUpTo('2026-09-24T17:30:00Z'), new Date('2026-09-26T08:30:00Z'));
  assert.equal(p.current.state, 'stale');
  assert.equal(p.current.age_h, 39);
});

test(`older than ${STALE_DAYS} days is unavailable and carries no AQI`, () => {
  const p = buildPayload(KEY, stationFor(KEY), rawUpTo('2026-09-24T17:30:00Z'), new Date('2026-10-02T18:00:00Z'));
  assert.equal(p.current.state, 'unavailable');
  assert.equal('result' in p.current, false);
});

test('a fresh window with too few hours is insufficient_data, with reasons', () => {
  const raw = rawUpTo('2026-09-24T17:30:00Z');
  for (const p of Object.keys(raw)) raw[p] = raw[p].filter((r) => Date.parse(r.end_utc) < Date.parse('2026-09-24T07:00:00Z') || Date.parse(r.end_utc) > Date.parse('2026-09-24T16:00:00Z'));
  const out = buildPayload(KEY, stationFor(KEY), raw, new Date('2026-09-24T18:00:00Z'));
  assert.equal(out.current.state, 'insufficient_data');
  assert.ok(out.current.reasons.length > 0);
});

test('no station is its own state and carries no history', () => {
  const p = buildPayload('in/kolkata/baruipur', null, {}, new Date());
  assert.equal(p.current.state, 'no_station');
  assert.equal(p.history, null);
});

test('no raw data at all is unavailable, never zero', () => {
  const p = buildPayload(KEY, stationFor(KEY), { pm25: [], pm10: [], no2: [], so2: [], co: [], o3: [] }, new Date());
  assert.equal(p.current.state, 'unavailable');
});
```

- [ ] **Step 2: Run to verify it fails**, then **Step 3: implement**

```ts
// src/lib/aqi/build.ts
/** Compose the payload from raw readings. Pure; the clock is a parameter. */
import { ALGORITHM, combine, subIndex, MIN_HOURS } from './cpcb.ts';
import { hoursBefore, istHourKey, istHours, window24, window8, type Hour, type HourKey, type Raw } from './hours.ts';
import { POLLUTANTS, type StationEntry } from './stations.ts';
import { SCHEMA, type AirQualityPayload, type AqiStation, type HistoryDay, type Pollutant, type PollutantReading, type SourceNote } from './types.ts';

export const LIVE_H = 2;
export const STALE_DAYS = 7;
const EIGHT_HOUR: ReadonlySet<Pollutant> = new Set(['co', 'o3']);

const SOURCE: SourceNote = { owner: 'West Bengal Pollution Control Board', via: 'CPCB via OpenAQ', standard: 'CPCB National AQI' };
const keyToIso = (k: HourKey): string => `${k}:00:00+05:30`;

function readings(hours: Record<string, Map<HourKey, Hour>>, st: StationEntry, endKey: HourKey): PollutantReading[] {
  return POLLUTANTS.map((p) => {
    const w = EIGHT_HOUR.has(p) ? window8(hours[p]!, endKey) : window24(hours[p]!, endKey);
    const ok = w.value !== null && w.hours >= MIN_HOURS;
    return { parameter: p, value: w.value === null ? null : Math.round(w.value * 100) / 100, unit: st.sensors[p as keyof StationEntry['sensors']].unit,
      window_h: EIGHT_HOUR.has(p) ? 8 : 24, hours_present: w.hours, sub_index: ok ? subIndex(p, w.value!) : null };
  });
}

export function buildPayload(areaKey: string, st: StationEntry | null, raw: Partial<Record<Pollutant, Raw[]>>, now: Date): AirQualityPayload {
  const served_at = now.toISOString();
  const common = { schema: SCHEMA, area_id: areaKey, served_at, source: SOURCE } as const;
  if (!st) return { current: { ...common, state: 'no_station', message: 'No government air monitor within 3 km of this area\'s centre.' }, history: null };

  const station: AqiStation = { id: st.id, name: st.name, lat: st.lat, lon: st.lon, distance_m: st.distance_m, inside: 'window_3km' };
  const hours = Object.fromEntries(POLLUTANTS.map((p) => [p, istHours(raw[p] ?? [])])) as Record<string, Map<HourKey, Hour>>;
  const lastMs = Math.max(-Infinity, ...POLLUTANTS.flatMap((p) => (raw[p] ?? []).map((r) => Date.parse(r.end_utc))));
  if (!Number.isFinite(lastMs)) return { current: { ...common, state: 'unavailable', station, last_observed_at: null }, history: null };

  const last = new Date(lastMs);
  const ageH = Math.floor((now.getTime() - lastMs) / 3_600_000);
  /* The window closes at the end of the IST hour holding the last reading. */
  const lastHourKey = istHourKey(last.toISOString());
  const nextHourKey: HourKey = new Date(Date.parse(`${lastHourKey}:00:00Z`) + 3_600_000).toISOString().slice(0, 13);
  const current = readings(hours, st, nextHourKey);
  const c = combine(current);

  const days: HistoryDay[] = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.parse(`${lastHourKey.slice(0, 10)}T00:00:00Z`) - (29 - i) * 86_400_000);
    const endOfDay = new Date(d.getTime() + 86_400_000).toISOString().slice(0, 13);
    const r = combine(readings(hours, st, endOfDay));
    return r.ok ? { date_ist: d.toISOString().slice(0, 10), aqi: r.aqi, category: r.category, dominant: r.dominant }
                : { date_ist: d.toISOString().slice(0, 10), aqi: null, category: null, dominant: null, reason: r.reasons.join('; ') };
  });
  const pm = hours['pm25']!;
  const history = { schema: SCHEMA, area_id: areaKey, station, days,
    pm25_24h: hoursBefore(nextHourKey).map((k) => ({ hour_ist: keyToIso(k), value: pm.has(k) ? Math.round(pm.get(k)!.mean * 10) / 10 : null })) };

  const observed_at = last.toISOString();
  if (ageH > STALE_DAYS * 24) return { current: { ...common, state: 'unavailable', station, last_observed_at: observed_at }, history };
  if (!c.ok) return { current: { ...common, state: 'insufficient_data', station, pollutants: current, reasons: c.reasons, observed_at }, history };
  const result = { aqi: c.aqi, category: c.category, dominant: c.dominant, pollutants: current, window_end_ist: keyToIso(nextHourKey), algorithm: ALGORITHM };
  return ageH <= LIVE_H
    ? { current: { ...common, state: 'live', station, result, observed_at }, history }
    : { current: { ...common, state: 'stale', station, result, observed_at, age_h: ageH }, history };
}
```

Add one more test to this file before implementing: a raw series whose last reading ends exactly on an IST hour (e.g. `2026-09-24T17:30:00Z` = 23:00 IST) must produce a 30-day history whose last `date_ist` is `2026-09-24`, not `2026-09-25`.

- [ ] **Step 4: Run to verify it passes; mutation proof; commit**

Run: `node --import tsx --test tests/unit/aqi-build.test.mjs` → PASS.
Mutation: set `LIVE_H = 48` → the stale test must FAIL. Revert.

```bash
git add src/lib/aqi/build.ts tests/unit/aqi-build.test.mjs
git commit -m "feat(aqi): payload builder with live, stale, unavailable, insufficient and no-station states

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The server function

**Files:**
- Create: `api/air-quality.ts`
- Modify: `astro.config.mjs` (inside `devApiProxies()`, beside the two existing `mount` lines)
- Test: `tests/unit/aqi-handler.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/aqi-handler.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { handle } from '../../api/air-quality.ts';

const res = () => { const r = { code: 0, headers: {}, body: null, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k] = v; }, json(b) { r.body = b; } }; return r; };

test('only GET', async () => { const r = res(); await handle({ method: 'POST', query: {} }, r, { key: 'k' }); assert.equal(r.code, 405); assert.equal(r.headers.Allow, 'GET'); });
test('unknown area is 404', async () => { const r = res(); await handle({ method: 'GET', query: { area: 'in/kolkata/nowhere' } }, r, { key: 'k' }); assert.equal(r.code, 404); });
test('missing key fails closed, with no upstream call', async () => { let called = false; const r = res();
  await handle({ method: 'GET', query: { area: 'in/kolkata/ballygunge' } }, r, { key: '', fetch: async () => { called = true; } }); assert.equal(r.code, 503); assert.equal(called, false); });
test('Baruipur answers no_station without calling OpenAQ, cacheable', async () => { const r = res();
  await handle({ method: 'GET', query: { area: 'in/kolkata/baruipur' } }, r, { key: 'k', fetch: async () => { throw new Error('must not fetch'); } });
  assert.equal(r.code, 200); assert.equal(r.body.current.state, 'no_station'); assert.match(r.headers['Cache-Control'], /s-maxage=600/); });
test('upstream failure is 200 unavailable, never cached long, never a number', async () => { const r = res();
  await handle({ method: 'GET', query: { area: 'in/kolkata/ballygunge' } }, r, { key: 'k', fetch: async () => new Response('x', { status: 503 }) });
  assert.equal(r.code, 200); assert.equal(r.body.current.state, 'unavailable'); assert.match(r.headers['Cache-Control'], /s-maxage=60\b/); });
```

- [ ] **Step 2: Run to verify it fails**, then **Step 3: implement**

```ts
// api/air-quality.ts
/**
 * GET /api/air-quality?area=in/kolkata/ballygunge
 * Government-station air quality for one OBOS area: current state + 30 days.
 * The OpenAQ key is read from OPENAQ_API_KEY and never leaves this function.
 * Spec: docs/superpowers/specs/2026-09-26-aqi-kolkata-design.md
 */
import { buildPayload } from '../src/lib/aqi/build.ts';
import { fetchSensorWindow } from '../src/lib/aqi/openaq.ts';
import { isAirArea, POLLUTANTS, stationFor } from '../src/lib/aqi/stations.ts';
import { SCHEMA } from '../src/lib/aqi/types.ts';

interface Req { method?: string; query: Record<string, string | string[] | undefined> }
interface Res { status(c: number): Res; setHeader(k: string, v: string): void; json(b: unknown): void }
interface Deps { key: string; fetch?: typeof fetch; now?: () => Date }

const OK_CACHE = 'public, max-age=60, s-maxage=600, stale-while-revalidate=1800';
const FAIL_CACHE = 'public, max-age=0, s-maxage=60';

export async function handle(req: Req, res: Res, d: Deps): Promise<void> {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); res.status(405).json({ error: 'GET only' }); return; }
  const area = typeof req.query.area === 'string' ? req.query.area : '';
  if (!isAirArea(area)) { res.status(404).json({ error: 'unknown area' }); return; }
  const st = stationFor(area), now = (d.now ?? (() => new Date()))();
  if (!st) { res.setHeader('Cache-Control', OK_CACHE); res.status(200).json(buildPayload(area, null, {}, now)); return; }
  if (!d.key) { res.status(503).json({ error: 'air quality not configured' }); return; }
  const to = new Date(Math.ceil(now.getTime() / 900_000) * 900_000).toISOString();
  const from = new Date(Date.parse(to) - 31 * 86_400_000).toISOString();
  try {
    const raw = Object.fromEntries(await Promise.all(POLLUTANTS.map(async (p) =>
      [p, await fetchSensorWindow(st.sensors[p as keyof typeof st.sensors].id, from, to, { key: d.key, fetch: d.fetch })] as const)));
    res.setHeader('Cache-Control', OK_CACHE);
    res.status(200).json(buildPayload(area, st, raw, now));
  } catch {
    res.setHeader('Cache-Control', FAIL_CACHE);
    const station = { id: st.id, name: st.name, lat: st.lat, lon: st.lon, distance_m: st.distance_m, inside: 'window_3km' as const };
    res.status(200).json({ current: { schema: SCHEMA, area_id: area, served_at: now.toISOString(),
      source: { owner: st.owner, via: 'CPCB via OpenAQ', standard: 'CPCB National AQI' }, state: 'unavailable', station, last_observed_at: null }, history: null });
  }
}

export default async function handler(req: Req, res: Res): Promise<void> {
  await handle(req, res, { key: process.env.OPENAQ_API_KEY ?? '' });
}
```

In `astro.config.mjs`, beside `mount('/api/climate-clock', …)`, add:

```js
      mount('/api/air-quality', () => import('./api/air-quality.ts'));
```

- [ ] **Step 4: Run tests and type-check**

Run: `node --import tsx --test tests/unit/aqi-handler.test.mjs && npm run check`
Expected: PASS; `0 errors`.

- [ ] **Step 5: Try it for real (development server, real key, current feed state)**

```bash
OPENAQ_API_KEY=$(tr -d '[:space:]' < ~/.config/delta-climate/openaq-key) npm run dev &   # stop it with kill %1 after
sleep 8; curl -s "http://localhost:4321/api/air-quality?area=in/kolkata/ballygunge" | python3 -c "import json,sys; p=json.load(sys.stdin); c=p['current']; print(c['state'], c.get('age_h'), (c.get('result') or {}).get('aqi')); print([d['aqi'] for d in p['history']['days']])"
kill %1
```

Expected: `stale` (or `live` if the CPCB feed has resumed) with an AQI, and 30 daily values matching the preview fixtures' pattern (27 numbers, 3 `None` for 26–28 Aug if still inside the window). Record the observed state in the register.

- [ ] **Step 6: Commit**

```bash
git add api/air-quality.ts astro.config.mjs tests/unit/aqi-handler.test.mjs
git commit -m "feat(aqi): /api/air-quality server function, fail-closed key, CDN caching

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The painter (pure HTML per state)

**Files:**
- Create: `src/scripts/climate-engine/air/air-panel.ts`
- Test: `tests/unit/aqi-panel.test.mjs`

Port the preview's `card()`, `pane()`, `polTable()`, `barChart()` and `line24()` from `previews/aqi-kolkata/template.html` into typed pure functions over `AirQualityPayload`. Keep every string, class and colour the founder approved (mono typography; units in Mona Sans via `.unit`; stale chip `chip old` with `Not Live<span class="sep">·</span><b>${age} h</b> Old`; hatched gaps; the 60 µg/m³ line). Replace the preview's fixture lookups with the payload's fields; drop the preview-only warning box.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/aqi-panel.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { cardHtml, paneHtml } from '../../src/scripts/climate-engine/air/air-panel.ts';
import { buildPayload } from '../../src/lib/aqi/build.ts';
import { stationFor } from '../../src/lib/aqi/stations.ts';

const raw = (lastEnd) => { const e = Date.parse(lastEnd), o = {}; for (const p of ['pm25','pm10','no2','so2','co','o3']) { o[p] = []; for (let t = e - 31*864e5; t <= e; t += 9e5) o[p].push({ end_utc: new Date(t).toISOString(), value: p === 'co' ? 0.5 : 20 }); } return o; };
const K = 'in/kolkata/ballygunge', st = stationFor(K);

test('stale shows the red label with the bold age and a muted number', () => {
  const html = cardHtml(buildPayload(K, st, raw('2026-09-24T17:30:00Z'), new Date('2026-09-26T08:30:00Z')), 'Ballygunge');
  assert.match(html, /class="chip old">Not Live<span class="sep">·<\/span><b>39 h<\/b> Old/);
  assert.match(html, /class="num muted"/);
});
test('no station never prints a number', () => {
  const html = cardHtml(buildPayload('in/kolkata/baruipur', null, {}, new Date()), 'Baruipur');
  assert.doesNotMatch(html, /class="num/);
  assert.match(html, /No government air monitor within 3 km/);
});
test('units are always the sans .unit span, never raw text in mono', () => {
  const html = paneHtml(buildPayload(K, st, raw('2026-09-24T17:30:00Z'), new Date('2026-09-24T18:00:00Z')), 'Ballygunge');
  assert.match(html, /<span class="unit">µg\/m³<\/span>/);
  assert.match(html, /<span class="unit">mg\/m³<\/span>/);
});
test('a pollutant with no hours shows a dash, never 0', () => {
  const r = raw('2026-09-24T17:30:00Z'); r.so2 = [];
  const html = paneHtml(buildPayload(K, st, r, new Date('2026-09-24T18:00:00Z')), 'Ballygunge');
  assert.match(html, /SO₂[\s\S]*?—/);
});
test('every category word is printed beside its colour', () => {
  const html = paneHtml(buildPayload(K, st, raw('2026-09-24T17:30:00Z'), new Date('2026-09-24T18:00:00Z')), 'Ballygunge');
  assert.match(html, /Good/);
});
```

- [ ] **Step 2: Run to verify it fails**; **Step 3: implement** the port (functions `cardHtml(p, placeName)` and `paneHtml(p, placeName)`, plus `wireBarTips(root: HTMLElement, days)` for the tooltip, which is the only DOM-touching export). Escape every string that came from the network with an `esc()` helper identical to the preview's.

- [ ] **Step 4: Run to verify it passes; commit**

```bash
git add src/scripts/climate-engine/air/air-panel.ts tests/unit/aqi-panel.test.mjs
git commit -m "feat(aqi): card and pane painters for all five states, approved design

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Rail, pane, block and wiring

**Files:**
- Modify: `src/components/ClimateEngine/shell/IconRail.astro` (the `SECTIONS` table and the `RailSection` type)
- Modify: `tests/unit/obos-shell.test.mjs` (six → seven sections; four → five pane-swappers)
- Modify: `src/components/ClimateEngine/HeatMapStage.astro` (pane markup after the Solar pane; `#aqiBlock` after `#solBlock`; CSS from the preview)
- Modify: `src/scripts/climate-engine/heat-map-app.ts` (fetch on area load; place the block)

- [ ] **Step 1: Update the rail test first (it must fail)**

In `tests/unit/obos-shell.test.mjs`: `SECTION_IDS` becomes `['air', 'analysis', 'layers', 'map', 'reports', 'scenarios', 'solar']`; `ids.length` 6 → 7 and the message "not 6" → "not 7"; the test titles and comments say seven; the two `for (const id of ['layers', 'solar', 'reports', 'scenarios'])` loops add `'air'`; the doc comment gains "Air joined on 2026-09-26 (spec 2026-09-26-aqi-kolkata-design.md §5)". Run `node --import tsx --test tests/unit/obos-shell.test.mjs` → FAIL (the rail has six).

- [ ] **Step 2: Add the rail section** (after Solar)

```ts
  /* AIR — a pane, not a route: government-station air quality for the area, with
     30 days of history. Kolkata only in the first release; elsewhere the pane says so. */
  { id: 'air', label: 'Air', href: null, body: 'always', icon: {
    d: 'M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8' } },
```

and add `'air'` to `RailSection`. Run the shell test → PASS.

- [ ] **Step 3: Pane and block markup** in `HeatMapStage.astro`, after the Solar pane:

```astro
      <div class="pane" data-pane="air">
        <section class="pane-body" id="airPane" aria-labelledby="pane-air-h" aria-live="polite">
          <p class="pane-h" id="pane-air-h">Air · <span id="airPaneArea">{scope.area.name}</span></p>
          <p class="pane-note" id="airPaneBody">{scope.city.id === 'kolkata' ? 'Loading air quality…' : 'Air quality covers Kolkata first; this city is not yet covered.'}</p>
        </section>
      </div>
```

and after `#solBlock`:

```astro
      <div class="aqblock legend-air" id="aqiBlock" role="region" aria-label="Air quality" hidden></div>
```

Copy the preview's `.aqblock`, `.chip*`, `.hero`, `.num*`, `.cat`, `.dot`, `.meta`, `.empty`, `table.pol*`, `.unit`, `.si*`, `.chart`, `.tip`, `.legend` rules and the six `--c-*` category tokens into the component's stylesheet, scoped as the Solar rules are. Add `.chip.old .sep{margin:0 .45em;opacity:.8}` and `.chip.old b{font-weight:800}`.

- [ ] **Step 4: Wire it in `heat-map-app.ts`**, next to `paintSolarWard()` (called where the area finishes loading, lines near 1221 and 2121):

```ts
  import { cardHtml, paneHtml, wireBarTips } from './air/air-panel.ts';
  import type { AirQualityPayload } from '../../lib/aqi/types.ts';
  // …
  let airAbort: AbortController | null = null;
  async function paintAir(): Promise<void> {
    airAbort?.abort(); airAbort = new AbortController();
    const block = el('aqiBlock'), pane = el('airPane');
    if (!block || !pane) return;
    if (!state.ward.startsWith('in/kolkata/')) { block.hidden = true; return; }
    try {
      const r = await fetch(`/api/air-quality?area=${encodeURIComponent(state.ward)}`, { signal: airAbort.signal });
      const p = (await r.json()) as AirQualityPayload;
      if (!r.ok || !('current' in p)) throw new Error(String(r.status));
      block.innerHTML = cardHtml(p, areaName()); block.hidden = false;
      pane.innerHTML = paneHtml(p, areaName()); wireBarTips(pane, p.history?.days ?? []);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      block.hidden = true;
      setText('airPaneBody', 'Air quality could not be loaded. The government feed or our service is unavailable.');
    }
  }
```

Call `paintAir()` beside each `paintSolarWard()` call. Reuse the Solar block's placement logic: when the open pane is `air`, move `#aqiBlock` above the colour key; otherwise keep it above the attribution (copy `placeSolarBlock` into `placeAirBlock` with `solBlock`→`aqiBlock` and `'solar'`→`'air'`, observed by the same `MutationObserver`).

- [ ] **Step 5: Gates**

```bash
npm run check && npm run test:unit && npm run build
```

Expected: 0 errors; all unit tests pass (count = previous + the new AQI tests); build succeeds.

- [ ] **Step 6: Look at it** (the founder approves visuals from the real app)

```bash
OPENAQ_API_KEY=$(tr -d '[:space:]' < ~/.config/delta-climate/openaq-key) npm run dev
```

Open `http://localhost:4321/heat-map/in/kolkata/ballygunge`, click **Air** in the rail, and screenshot: the pane, the right-panel block, Barrackpore, Baruipur, and one Bengaluru area. Compare against the approved preview; any difference is a bug unless the founder approves it.

- [ ] **Step 7: Commit**

```bash
git add src/components/ClimateEngine/shell/IconRail.astro tests/unit/obos-shell.test.mjs src/components/ClimateEngine/HeatMapStage.astro src/scripts/climate-engine/heat-map-app.ts
git commit -m "feat(obos): Air rail section, pane and right-panel block for Kolkata

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Release readiness (no push)

- [ ] **Step 1:** Full gates: `npm run check && npm run typecheck && npm run test:py && npm run test:unit && npm run build`. All pass.
- [ ] **Step 2:** Security check: `git grep -n -i "openaq-key\|X-API-Key" -- src api tests` shows only header code and test fakes; `K=$(tr -d '[:space:]' < ~/.config/delta-climate/openaq-key); git grep -F "$K"` finds nothing.
- [ ] **Step 3:** Update `docs/AQI/README.md` "Current state" and the register with what shipped and the feed state observed on the day.
- [ ] **Step 4:** Report to the founder: what was built, the gate results, screenshots, and what they must do before release: add `OPENAQ_API_KEY` to the Vercel project's Preview and Production environments; decide when to open the PR. Do not push.
