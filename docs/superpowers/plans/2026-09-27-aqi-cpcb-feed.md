# CPCB published AQI as the current value — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OBOS's Kolkata air cards show CPCB's own published station AQI (live from CPCB's CAAQMS feed), keeping OpenAQ for the 30-day chart and as the fallback when CPCB's feed fails.

**Architecture:**
- A new pure module, `src/lib/aqi/cpcb-feed.ts`, fetches, parses and judges CPCB's XML feed.
- `api/air-quality.ts` fetches CPCB and OpenAQ in parallel.
  - When CPCB has a usable value, it becomes `current` (origin `cpcb`). OpenAQ supplies `history` if it answers within a short grace period; otherwise the OpenAQ fetch continues under `waitUntil` to warm the cache.
  - When CPCB fails, today's OpenAQ path runs unchanged (origin `obos`).
- `air-panel.ts` paints the new origin: CPCB's published line, a sub-index table, and a CPCB method note.

**Tech Stack:**
- TypeScript on Node 24 as a Vercel Function; the site is Astro.
- Tests run with `node --import tsx --test`.
- One new dependency: `@vercel/functions` (for `waitUntil`).

**Spec:** `docs/superpowers/specs/2026-09-27-aqi-cpcb-feed-design.md`. Read it first.

## Ground rules for every task

- **Where to work:** worktree `~/delta-worktrees/aqi-kolkata`, branch `feat/aqi-cpcb-feed`. Never push. Stage files by name; never `git add -A`.
- **Commit trailer:** `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Unit tests:** run with `node --import tsx --test tests/unit/<file>.test.mjs`.
- **TypeScript gate:** `npm run check` must report `0 errors`.
- **Test first:** each test must be seen failing before its code exists. After it passes, prove it with the mutation named in the task: apply the mutation, watch it go red, revert it. Record the red runs in the commit body.
- **Engine code never names a time zone.** The `obos-scope` guard forbids `Asia/Kolkata`. IST is always the fixed `+05:30` offset.
- **Never log or print the OpenAQ key** (`~/.config/delta-climate/openaq-key`).

## File map

| File | Change |
|---|---|
| `tests/fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz` | **new**: the real feed, 481 stations, captured 2026-09-26T23:55Z |
| `src/lib/aqi/stations.ts` | `cpcb_name` for each station |
| `src/lib/aqi/types.ts` | `SCHEMA` becomes 2; `origin`; `CpcbSubIndex`, `CpcbResult`; `insufficient_data` variants |
| `src/lib/aqi/build.ts` | marks its results `origin: 'obos'` |
| `src/lib/aqi/valid.ts` | accepts schema 1 and 2, and the CPCB shapes |
| `src/lib/aqi/cpcb-feed.ts` | **new**: `parseFeed`, `pick`, `currentFromFeed`, `fetchFeed`, `FeedError` |
| `api/air-quality.ts` | feed cache, parallel sources, grace + `waitUntil`, partial caching, no-key behaviour |
| `src/scripts/climate-engine/air/air-panel.ts` | CPCB hero line, time line, sub-index table, insufficient (CPCB), method note, history-null note |
| `tests/unit/aqi-cpcb-feed.test.mjs` | **new** |
| `tests/unit/aqi-stations.test.mjs`, `aqi-build.test.mjs`, `aqi-load.test.mjs`, `aqi-handler.test.mjs`, `aqi-panel.test.mjs` | extended or updated as each task says |
| `docs/AQI/05-research-register.md`, `docs/AQI/README.md`, the spec | the evidence rows and state |

---

### Task 1: Fixture and the relied-on fact

**Files:**
- Create: `tests/fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz`
- Create: `tests/unit/aqi-cpcb-feed.test.mjs`
- Modify: `docs/AQI/05-research-register.md` (add row AQI-R47a)

- [ ] **Step 1: Copy the real snapshot into the repo**

```bash
cp ~/.cache/delta-climate/cpcb-rss/feed-20260926T2355Z.xml.gz tests/fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz
gunzip -c tests/fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz | grep -c '<Station '
```

Expected: `481`.

- [ ] **Step 2: Write the test that pins what the feed's numbers mean.** It needs no production code, so it passes at once. It is a guard on CPCB, not on us.

```js
// tests/unit/aqi-cpcb-feed.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';

export const FEED_XML = gunzipSync(readFileSync(new URL('../fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz', import.meta.url))).toString('utf8');

test("CPCB's feed carries SUB-INDICES: the published AQI is the largest Avg, and the predominant pollutant is the one holding it", () => {
  let n = 0;
  for (const m of FEED_XML.matchAll(/<Station id="([^"]+)"[^>]*>([\s\S]*?)<\/Station>/g)) {
    const a = /Air_Quality_Index Value="(\d+)" Predominant_Parameter="([^"]*)"/.exec(m[2]);
    if (!a) continue;
    const avgs = [...m[2].matchAll(/Pollutant_Index id="([^"]+)" Min="[^"]*" Max="[^"]*" Avg="(\d+)"/g)].map(([, p, v]) => [p, Number(v)]);
    const max = Math.max(...avgs.map(([, v]) => v));
    assert.equal(Number(a[1]), max, `${m[1]}: AQI ${a[1]} is not the largest Avg ${max}`);
    assert.ok(avgs.some(([p, v]) => p === a[2] && v === max), `${m[1]}: ${a[2]} does not hold the largest Avg`);
    n++;
  }
  assert.equal(n, 442, 'the capture had 442 stations with a numeric AQI');
});
```

- [ ] **Step 3: Run it**

Run `node --import tsx --test tests/unit/aqi-cpcb-feed.test.mjs`. Expected: 1 pass.

**Mutation:** change `assert.equal(Number(a[1]), max` to compare against `max - 1`. It must go red. Revert.

- [ ] **Step 4: Register row.** Add a row after the last `AQI-R4x` row in `docs/AQI/05-research-register.md`:

```markdown
| AQI-R47a | Verified 27 Sep | **CPCB's own CAAQMS feed is live and carries CPCB's published station AQI.** `https://airquality.cpcb.gov.in/caaqms/rss_feed` (XML, ~359 KB, no key, `Cache-Control: no-store`, accepts an identifying User-Agent) listed 481 stations at 05:00 IST on 27 Sep while the CPCB → OpenAQ relay had been down since 24 Sep 17:30 UTC. **Every Min/Max/Avg is a sub-index, not a concentration:** for 442/442 stations with a numeric AQI, `Value` = max `Avg` and `Predominant_Parameter` = its pollutant. 39 stations had `Value=""` (no valid PM); dead stations (Kasturi Nagar, City Railway Station) are absent; `lastupdate` is feed-wide and IST. Fixture: `tests/fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz`. | The headline AQI comes from this feed (spec 2026-09-27). Its pollutant table shows sub-indices only. The relationship is pinned by `aqi-cpcb-feed.test.mjs` and enforced at runtime by `pick()`. |
```

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz tests/unit/aqi-cpcb-feed.test.mjs docs/AQI/05-research-register.md
git commit -m "test(aqi): pin what CPCB's feed means — its numbers are sub-indices, AQI is the largest

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Station names in CPCB's feed

**Files:**
- Modify: `src/lib/aqi/stations.ts`
- Test: `tests/unit/aqi-stations.test.mjs`

- [ ] **Step 1: Failing test.** Append to `tests/unit/aqi-stations.test.mjs`:

```js
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

test("each station's CPCB name is in CPCB's feed, within 100 m of the registered position", () => {
  const xml = gunzipSync(readFileSync(new URL('../fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz', import.meta.url))).toString('utf8');
  for (const [key, st] of Object.entries(AREAS)) {
    if (!st) continue;
    const m = new RegExp(`<Station id="${st.cpcb_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*latitude="([\\d.]+)" longitude="([\\d.]+)"`).exec(xml);
    assert.ok(m, `${key}: "${st.cpcb_name}" not in the feed`);
    assert.ok(havM(st.lat, st.lon, Number(m[1]), Number(m[2])) <= 100, `${key}: feed position is more than 100 m from the registry`);
  }
});
```

`havM` is already defined in that file (line 9).

- [ ] **Step 2: Run it.** It fails on `st.cpcb_name` being `undefined`.

- [ ] **Step 3: Implement** in `src/lib/aqi/stations.ts`:

```ts
export interface StationEntry extends Omit<AqiStation, 'inside'> {
  owner: string;
  /** The station's exact `<Station id>` in CPCB's CAAQMS feed (register AQI-R47a). */
  cpcb_name: string;
  sensors: Readonly<Record<'pm25' | 'pm10' | 'no2' | 'so2' | 'co' | 'o3', SensorRef>>;
}
```

Then add `cpcb_name: 'Ballygunge, Kolkata - WBPCB',` to Ballygunge's entry and `cpcb_name: 'SVSPA Campus, Barrackpore - WBPCB',` to Barrackpore's, each after `owner`.

- [ ] **Step 4: Run it; it passes.** **Mutation:** change Barrackpore's name to `'SVSPA Campus, Barrackpore'`. It must go red. Revert.

- [ ] **Step 5: Commit** `src/lib/aqi/stations.ts` and `tests/unit/aqi-stations.test.mjs` with the message `feat(aqi): each station's name in CPCB's feed, checked against the capture`.

---

### Task 3: Contract, builder origin and validator

**Files:**
- Modify: `src/lib/aqi/types.ts`, `src/lib/aqi/build.ts`, `src/lib/aqi/valid.ts`
- Test: `tests/unit/aqi-build.test.mjs`, `tests/unit/aqi-load.test.mjs`

- [ ] **Step 1: Failing tests.**

Append to `tests/unit/aqi-build.test.mjs`. It already imports `buildPayload` and `stationFor` and defines the raw-series helper `rawUpTo(lastEnd)`.

```js
test('the builder marks its own results origin obos, schema 2', () => {
  const p = buildPayload('in/kolkata/ballygunge', stationFor('in/kolkata/ballygunge'), rawUpTo('2026-09-24T17:30:00Z'), new Date('2026-09-24T18:30:00Z'));
  assert.equal(p.current.schema, 2);
  assert.equal(p.current.result.origin, 'obos');
  assert.equal(p.history.schema, 2);
});
```

Append to `tests/unit/aqi-load.test.mjs`, and add `import { isAirPayload } from '../../src/lib/aqi/valid.ts';` to its imports (it does not import it yet).

```js
const cpcbLive = () => ({ current: { schema: 2, area_id: 'in/kolkata/ballygunge', served_at: '2026-09-27T00:00:00.000Z',
  source: { owner: 'West Bengal Pollution Control Board', via: 'CPCB', standard: 'CPCB National AQI' }, state: 'live',
  station: { id: 'openaq:10918', name: 'Ballygunge, Kolkata', lat: 22.5, lon: 88.3, distance_m: 993, inside: 'window_3km' },
  observed_at: '2026-09-26T23:30:00.000Z',
  result: { origin: 'cpcb', aqi: 38, category: 'good', dominant: 'pm10', window_h: 24,
    subindices: [{ parameter: 'pm10', avg: 38, min: 18, max: 53, hourly: 45 }, { parameter: 'pm25', avg: 24, min: 19, max: 37, hourly: null }] } }, history: null });

test('a CPCB-origin payload validates; a bad sub-index or unknown origin does not', () => {
  assert.equal(isAirPayload(cpcbLive()), true);
  const bad = cpcbLive(); bad.current.result.subindices[0].avg = 'x'; assert.equal(isAirPayload(bad), false);
  const odd = cpcbLive(); odd.current.result.origin = 'google'; assert.equal(isAirPayload(odd), false);
  const ins = cpcbLive(); ins.current = { ...ins.current, state: 'insufficient_data', origin: 'cpcb', reasons: ['No valid PM2.5 or PM10 reading'], subindices: ins.current.result.subindices };
  delete ins.current.result; assert.equal(isAirPayload(ins), true);
});

test('a schema-1 payload still validates (the CDN can serve pre-deploy answers for ~40 min)', () => {
  const p = cpcbLive(); p.current.schema = 1;
  p.current.result = { aqi: 28, category: 'good', dominant: 'o3', window_end_ist: '2026-09-24T23:00:00+05:30', algorithm: 'cpcb-aqi-1',
    pollutants: [{ parameter: 'o3', value: 28.45, unit: 'ug_m3', window_h: 8, hours_present: 24, sub_index: 28 }] };
  assert.equal(isAirPayload(p), true);
});
```

- [ ] **Step 2: Run both files.** The new tests fail: schema is 1, there is no `origin`, and the validator rejects the CPCB shape.

- [ ] **Step 3: Implement `types.ts`.** Replace `export const SCHEMA = 1 as const;` with:

```ts
export const SCHEMA = 2 as const;
/** Schema 1 (no `origin`) is still accepted by the browser validator: the CDN may hold pre-deploy answers for ~40 min. */
export type SchemaVersion = 1 | typeof SCHEMA;
```

Add `origin: 'obos';` as the first field of `AqiResult`, with a doc comment: `/** Computed by OBOS from OpenAQ's copy of the readings (the fallback since 2026-09-27). */`. Then add, after `AqiResult`:

```ts
/** One pollutant's sub-indices as CPCB publishes them (not concentrations: register AQI-R47a). */
export interface CpcbSubIndex {
  parameter: Pollutant;
  /** 24-hour sub-index; the largest across pollutants IS the AQI. */
  avg: number | null;
  min: number | null;
  max: number | null;
  /** The latest hour's sub-index. */
  hourly: number | null;
}

/** CPCB's own published station AQI, read from its CAAQMS feed. */
export interface CpcbResult {
  origin: 'cpcb';
  aqi: number;
  category: CpcbCategory;
  dominant: Pollutant;
  /** 8 when CO or O₃ leads (CPCB's value is then an 8-hour maximum), else 24. */
  window_h: 24 | 8;
  subindices: CpcbSubIndex[];
}

export type Result = AqiResult | CpcbResult;
```

Replace the `AirQualityResponse` union with:

```ts
export type AirQualityResponse = Common & (
  | { state: 'live'; station: AqiStation; result: Result; observed_at: string }
  | { state: 'stale'; station: AqiStation; result: Result; observed_at: string; age_h: number }
  | { state: 'unavailable'; station: AqiStation; last_observed_at: string | null; reason: UnavailableReason }
  | ({ state: 'insufficient_data'; station: AqiStation; reasons: string[]; observed_at: string }
      & ({ origin: 'obos'; pollutants: PollutantReading[] } | { origin: 'cpcb'; subindices: CpcbSubIndex[] }))
  | { state: 'no_station'; message: string }
);
```

- [ ] **Step 4: Implement `build.ts`.**
  - In `buildPayload`, the `insufficient_data` return gains `origin: 'obos' as const,` before `station`.
  - The `result` object gains `origin: 'obos' as const,` as its first property.
  - Then run `npm run check`. Every error it reports must be resolved in the file it names:
    - in `air-panel.ts`, `hero`/`windowOf`/`polTable` now see `Result`; for now, narrow with `if (r.origin === 'cpcb') return '';` so it compiles. Task 7 paints it;
    - in `insufficient_data` cases, `c.pollutants` needs `c.origin === 'obos'`, so narrow the same way.

- [ ] **Step 5: Implement `valid.ts`.** Replace the constant list, `isResult`, the schema checks and the `insufficient_data` case:

```ts
const ORIGINS = ['obos', 'cpcb'] as const;
const isSchema = (s: unknown): boolean => s === 1 || s === SCHEMA;

const isSub = (q: unknown): boolean =>
  obj(q) && oneOf(POLLUTANTS, q['parameter']) && ['avg', 'min', 'max', 'hourly'].every((k) => finOrNull(q[k]));

/** Schema 1 has no `origin`: it is an OBOS result. */
const isObosResult = (r: Obj): boolean =>
  (r['origin'] === undefined || r['origin'] === 'obos') && fin(r['aqi']) && oneOf(CATEGORIES, r['category']) && oneOf(POLLUTANTS, r['dominant']) &&
  arrOf(r['pollutants'], isReading) && str(r['window_end_ist']) && r['algorithm'] === 'cpcb-aqi-1';

const isCpcbResult = (r: Obj): boolean =>
  r['origin'] === 'cpcb' && fin(r['aqi']) && oneOf(CATEGORIES, r['category']) && oneOf(POLLUTANTS, r['dominant']) &&
  (r['window_h'] === 24 || r['window_h'] === 8) && arrOf(r['subindices'], isSub);

const isResult = (r: unknown): boolean => obj(r) && (r['origin'] === 'cpcb' ? isCpcbResult(r) : isObosResult(r));
```

- In `isCurrent`, replace `c['schema'] !== SCHEMA` with `!isSchema(c['schema'])`.
- In `isHistory`, replace `h['schema'] === SCHEMA` with `isSchema(h['schema'])`.
- Replace the `insufficient_data` case with:

```ts
    case 'insufficient_data': {
      if (!isStation(c['station']) || !arrOf(c['reasons'], str) || !date(c['observed_at'])) return false;
      return c['origin'] === 'cpcb' ? arrOf(c['subindices'], isSub)
        : (c['origin'] === undefined || c['origin'] === 'obos') && arrOf(c['pollutants'], isReading);
    }
```

`ORIGINS` is used by nothing else yet. Leave it out if unused; `npm run check` reports unused locals as hints only.

- [ ] **Step 6: Run** `node --import tsx --test tests/unit/aqi-*.test.mjs` (all pass) and `npm run check` (0 errors).
  - Existing tests that assert `schema: 1` or build payloads by hand may need `schema: 2` and `origin: 'obos'`. Update them, and list each one in the commit body.
  - **Mutations:** make `isSchema` accept only `SCHEMA`, so the schema-1 test goes red. Drop `isSub`'s `finOrNull`, so the bad-sub-index test goes red.

- [ ] **Step 7: Commit** `types.ts`, `build.ts`, `valid.ts`, `air-panel.ts` (the compile-only narrowing) and the tests, with the message `feat(aqi): schema 2 — every result names its origin; the validator accepts CPCB shapes and schema 1`.

---

### Task 4: Parse CPCB's feed

**Files:**
- Create: `src/lib/aqi/cpcb-feed.ts`
- Test: `tests/unit/aqi-cpcb-feed.test.mjs`

- [ ] **Step 1: Failing tests.** Append:

```js
import { FeedError, istStamp, parseFeed, pick } from '../../src/lib/aqi/cpcb-feed.ts';
import { stationFor } from '../../src/lib/aqi/stations.ts';

const one = (station, body) => `<?xml version='1.0'?><AqIndex><Country id="India"><State id="X"><City id="Y">${station.replaceAll('BODY', body)}</City></State></Country></AqIndex>`;
const ST = (name = 'Ballygunge, Kolkata - WBPCB', lat = '22.5367507', lon = '88.3638022') => `<Station id="${name}" lastupdate="27-09-2026 05:00:00" latitude="${lat}" longitude="${lon}">BODY</Station>`;
const POLS = '<Pollutant_Index id="PM2.5" Min="19" Max="37" Avg="24" Hourly_sub_index="26"/><Pollutant_Index id="PM10" Min="18" Max="53" Avg="38" Hourly_sub_index="45"/><Pollutant_Index id="NO2" Min="16" Max="36" Avg="23" Hourly_sub_index="16"/>';

test('parseFeed reads the real capture: Ballygunge 38 PM10 and Barrackpore 46 PM10, seven sub-index rows each', () => {
  const feed = parseFeed(FEED_XML);
  assert.equal(feed.length, 481);
  const b = feed.find((s) => s.name === 'Ballygunge, Kolkata - WBPCB');
  assert.deepEqual({ aqi: b.aqi, dominant: b.dominant, published_at: b.published_at }, { aqi: 38, dominant: 'pm10', published_at: '2026-09-26T23:30:00.000Z' });
  assert.equal(b.subindices.length, 7);
  assert.deepEqual(b.subindices.find((q) => q.parameter === 'pm25'), { parameter: 'pm25', avg: 24, min: 19, max: 37, hourly: 26 });
  const s = feed.find((x) => x.name === 'SVSPA Campus, Barrackpore - WBPCB');
  assert.deepEqual({ aqi: s.aqi, dominant: s.dominant }, { aqi: 46, dominant: 'pm10' });
  assert.equal(s.subindices.find((q) => q.parameter === 'pm25').hourly, null, 'NA is null, never 0');
});

test('a blank AQI is null with no dominant; OZONE is o3', () => {
  const [g] = parseFeed(one(ST('G'), '<Pollutant_Index id="OZONE" Min="11" Max="12" Avg="11" Hourly_sub_index="11"/><Air_Quality_Index Value="" Predominant_Parameter=""/>'));
  assert.deepEqual({ aqi: g.aqi, dominant: g.dominant, p: g.subindices[0].parameter }, { aqi: null, dominant: null, p: 'o3' });
});

test('entities in names are decoded', () => {
  const [s] = parseFeed(one(ST('A &amp; B, X - Y'), POLS + '<Air_Quality_Index Value="38" Predominant_Parameter="PM10"/>'));
  assert.equal(s.name, 'A & B, X - Y');
});

test('a station with a non-numeric value is dropped, never coerced; the rest survive', () => {
  const xml = one(ST('Bad') + ST('Good'), POLS + '<Air_Quality_Index Value="38" Predominant_Parameter="PM10"/>')
    .replace('Avg="24"', 'Avg="2x"');
  assert.deepEqual(parseFeed(xml).map((s) => s.name), ['Good']);
});

test('lastupdate is IST, whatever the machine zone', () => {
  assert.equal(istStamp('27-09-2026 05:00:00'), '2026-09-26T23:30:00.000Z');
  assert.throws(() => istStamp('2026-09-27 05:00'), FeedError);
});

test('not a feed, or no stations, is a FeedError', () => {
  assert.throws(() => parseFeed('<html>busy</html>'), FeedError);
  assert.throws(() => parseFeed('<AqIndex></AqIndex>'), FeedError);
});

test("pick finds our station by exact name within 100 m, and only if CPCB's AQI is the largest Avg", () => {
  const st = stationFor('in/kolkata/ballygunge');
  assert.equal(pick(parseFeed(FEED_XML), st).aqi, 38);
  const moved = parseFeed(one(ST('Ballygunge, Kolkata - WBPCB', '22.5400', '88.3638022'), POLS + '<Air_Quality_Index Value="38" Predominant_Parameter="PM10"/>'));
  assert.equal(pick(moved, st), null, '370 m away is not our station');
  const odd = parseFeed(one(ST(), POLS + '<Air_Quality_Index Value="99" Predominant_Parameter="PM10"/>'));
  assert.equal(pick(odd, st), null, 'an AQI that is not the largest Avg means the fields changed meaning');
  assert.equal(pick(parseFeed(one(ST('Other'), POLS)), st), null);
});
```

- [ ] **Step 2: Run it.** It fails: the module is missing.

- [ ] **Step 3: Implement** `src/lib/aqi/cpcb-feed.ts`:

```ts
/**
 * CPCB'S OWN CAAQMS FEED: the station AQI as CPCB publishes it.
 *
 * `https://airquality.cpcb.gov.in/caaqms/rss_feed` is XML, one snapshot of every
 * live station. MEASURED 2026-09-27 (register AQI-R47a): its Min/Max/Avg are
 * SUB-INDICES, not concentrations; the published AQI is the largest Avg and the
 * predominant pollutant holds it. `pick` enforces that at runtime, so a change of
 * meaning upstream falls back to OBOS's own calculation instead of painting a wrong number.
 *
 * Pure except `fetchFeed`. No XML library: a strict reader for exactly
 * <Station>, <Pollutant_Index/> and <Air_Quality_Index/>; a station with any
 * value that is not a whole number, "NA" or "" is dropped (never coerced).
 * IST is the fixed +05:30 offset (obos-scope forbids naming a zone).
 */
import type { StationEntry } from './stations.ts';
import type { CpcbSubIndex, Pollutant } from './types.ts';

export const FEED_URL = 'https://airquality.cpcb.gov.in/caaqms/rss_feed';
export const FEED_TIMEOUT_MS = 8_000;
export const FEED_MAX_BYTES = 2_000_000;
export const MATCH_M = 100;
const UA = 'delta-climate-research/1.0 (https://deltaclimate.earth)';

export class FeedError extends Error {
  constructor(message: string) { super(message); this.name = 'FeedError'; }
}

export interface FeedStation {
  name: string;
  /** `lastupdate` as ISO UTC. Feed-wide in practice. */
  published_at: string;
  lat: number;
  lon: number;
  /** null when CPCB published no AQI (`Value=""`). */
  aqi: number | null;
  dominant: Pollutant | null;
  subindices: CpcbSubIndex[];
}

const PARAM: Readonly<Record<string, Pollutant>> = { 'PM2.5': 'pm25', PM10: 'pm10', NO2: 'no2', SO2: 'so2', CO: 'co', OZONE: 'o3', NH3: 'nh3' };
const ENT: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string): string => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENT[e]!);

function attrs(tag: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const m of tag.matchAll(/([A-Za-z_][\w.-]*)="([^"]*)"/g)) o[m[1]!] = decode(m[2]!);
  return o;
}

/** "NA" and "" are missing; anything else must be a whole number. */
function whole(v: string | undefined): number | null {
  if (v === undefined || v === '' || v === 'NA') return null;
  if (!/^\d+$/.test(v)) throw new FeedError(`not a whole number: ${v}`);
  return Number(v);
}

/** "27-09-2026 05:00:00" (IST) → ISO UTC. */
export function istStamp(s: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  const t = m ? Date.parse(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+05:30`) : NaN;
  if (!Number.isFinite(t)) throw new FeedError(`bad lastupdate: ${s}`);
  return new Date(t).toISOString();
}

export function parseFeed(xml: string): FeedStation[] {
  if (!xml.includes('<AqIndex')) throw new FeedError('not a CPCB AQI feed');
  const out: FeedStation[] = [];
  for (const m of xml.matchAll(/<Station\b([^>]*)>([\s\S]*?)<\/Station>/g)) {
    try {
      const a = attrs(m[1]!), body = m[2]!;
      const lat = Number(a['latitude']), lon = Number(a['longitude']);
      if (!a['id'] || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const subindices: CpcbSubIndex[] = [];
      for (const p of body.matchAll(/<Pollutant_Index\b([^>]*)\/>/g)) {
        const q = attrs(p[1]!), parameter = PARAM[q['id'] ?? ''];
        if (parameter) subindices.push({ parameter, avg: whole(q['Avg']), min: whole(q['Min']), max: whole(q['Max']), hourly: whole(q['Hourly_sub_index']) });
      }
      const aq = /<Air_Quality_Index\b([^>]*)\/>/.exec(body), aa = aq ? attrs(aq[1]!) : {};
      const aqi = whole(aa['Value']), dominant = PARAM[aa['Predominant_Parameter'] ?? ''] ?? null;
      out.push({ name: a['id'], published_at: istStamp(a['lastupdate'] ?? ''), lat, lon,
        aqi: aqi !== null && dominant ? aqi : null, dominant: aqi !== null ? dominant : null, subindices });
    } catch {
      continue; // ponytail: one malformed station never poisons the rest; ours then falls back to OBOS's calculation
    }
  }
  if (out.length === 0) throw new FeedError('no stations parsed');
  return out;
}

const havM = (a: number, b: number, c: number, d: number): number => {
  const R = 6_371_008.8, r = Math.PI / 180;
  const x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

/**
 * Our station in the feed: exact name, within 100 m, and CPCB's AQI must be the
 * largest Avg held by the named pollutant (AQI-R47a). Otherwise null → fallback.
 */
export function pick(feed: readonly FeedStation[], st: StationEntry): FeedStation | null {
  const f = feed.find((s) => s.name === st.cpcb_name);
  if (!f || havM(st.lat, st.lon, f.lat, f.lon) > MATCH_M) return null;
  if (f.aqi === null) return f;
  const avgs = f.subindices.map((q) => q.avg).filter((v): v is number => v !== null);
  const max = avgs.length ? Math.max(...avgs) : -1;
  const held = f.subindices.some((q) => q.parameter === f.dominant && q.avg === max);
  return f.aqi === max && held ? f : null;
}

/** One request, 8 s, 2 MB cap, identifying User-Agent. Every failure is a FeedError (its message carries no secret). */
export async function fetchFeed(o: { fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<FeedStation[]> {
  const f = o.fetch ?? fetch;
  const timeout = AbortSignal.timeout(FEED_TIMEOUT_MS);
  const signal = o.signal ? AbortSignal.any([o.signal, timeout]) : timeout;
  let text: string;
  try {
    const res = await f(FEED_URL, { headers: { 'User-Agent': UA, Accept: 'application/xml' }, signal });
    if (!res.ok) throw new FeedError(`CPCB feed ${res.status}`);
    if (Number(res.headers.get('content-length') ?? 0) > FEED_MAX_BYTES) throw new FeedError('CPCB feed too large');
    const buf = await res.arrayBuffer(); // ponytail: read then measure; streaming cap only if CPCB ever lies about length
    if (buf.byteLength > FEED_MAX_BYTES) throw new FeedError('CPCB feed too large');
    text = new TextDecoder().decode(buf);
  } catch (e) {
    if (e instanceof FeedError) throw e;
    throw new FeedError(e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'CPCB feed timed out' : 'CPCB feed unreachable');
  }
  return parseFeed(text);
}
```

- [ ] **Step 4: Run it; all pass.** Also run under `TZ=UTC` and `TZ=America/New_York`.

**Mutations**, each red, then revert:
- drop the `/^\d+$/` check in `whole`;
- drop the `held` check in `pick`;
- change `+05:30` to `Z` in `istStamp`.

- [ ] **Step 5: Tests for `fetchFeed`.** Append these, then run and commit:

```js
import { FEED_MAX_BYTES, fetchFeed } from '../../src/lib/aqi/cpcb-feed.ts';

test('fetchFeed sends an identifying User-Agent and parses the body', async () => {
  let ua = '';
  const feed = await fetchFeed({ fetch: async (u, init) => { ua = init.headers['User-Agent']; return new Response(FEED_XML); } });
  assert.match(ua, /^delta-climate-research\//);
  assert.equal(feed.length, 481);
});

test('fetchFeed failures are FeedErrors: non-OK, oversize, network, timeout', async () => {
  await assert.rejects(fetchFeed({ fetch: async () => new Response('x', { status: 502 }) }), FeedError);
  await assert.rejects(fetchFeed({ fetch: async () => new Response('x'.repeat(FEED_MAX_BYTES + 1)) }), FeedError);
  await assert.rejects(fetchFeed({ fetch: async () => { throw new TypeError('fetch failed'); } }), FeedError);
  const ctl = new AbortController(); ctl.abort();
  await assert.rejects(fetchFeed({ signal: ctl.signal, fetch: async (_u, init) => { init.signal.throwIfAborted(); return new Response(FEED_XML); } }), FeedError);
});
```

**Mutation:** remove the byte-length check, so the oversize case goes red. Revert.

- [ ] **Step 6: Commit** `src/lib/aqi/cpcb-feed.ts` and `tests/unit/aqi-cpcb-feed.test.mjs` with the message `feat(aqi): read CPCB's CAAQMS feed — strict parser, station pick with the sub-index guard, bounded fetch`.

---

### Task 5: From feed station to current state

**Files:**
- Modify: `src/lib/aqi/cpcb-feed.ts`
- Test: `tests/unit/aqi-cpcb-feed.test.mjs`

- [ ] **Step 1: Failing tests.** Append:

```js
import { currentFromFeed } from '../../src/lib/aqi/cpcb-feed.ts';

const B = 'in/kolkata/ballygunge', stB = stationFor(B);
const at = (iso) => new Date(iso);
const bFeed = () => pick(parseFeed(FEED_XML), stB); // published 2026-09-26T23:30Z

test('≤ 2 h after publication is live, origin cpcb, with CPCB source', () => {
  const c = currentFromFeed(bFeed(), B, stB, at('2026-09-27T01:30:00Z'));
  assert.equal(c.state, 'live');
  assert.deepEqual({ o: c.result.origin, aqi: c.result.aqi, cat: c.result.category, dom: c.result.dominant, w: c.result.window_h }, { o: 'cpcb', aqi: 38, cat: 'good', dom: 'pm10', w: 24 });
  assert.equal(c.observed_at, '2026-09-26T23:30:00.000Z');
  assert.equal(c.source.via, 'CPCB');
  assert.equal(c.schema, 2);
});

test('2 h + 1 min is stale with its age; 7 days + 1 min falls back (null)', () => {
  const s = currentFromFeed(bFeed(), B, stB, at('2026-09-27T01:31:00Z'));
  assert.deepEqual({ st: s.state, age: s.age_h }, { st: 'stale', age: 2 });
  assert.equal(currentFromFeed(bFeed(), B, stB, at('2026-10-03T23:31:00Z')), null);
});

test('CO or O3 leading means an 8-hour window', () => {
  const f = { ...bFeed(), dominant: 'o3' };
  assert.equal(currentFromFeed(f, B, stB, at('2026-09-27T00:00:00Z')).result.window_h, 8);
});

test('a blank AQI is insufficient_data (origin cpcb) when fresh, unavailable no_valid_aqi when stale', () => {
  const f = { ...bFeed(), aqi: null, dominant: null, subindices: bFeed().subindices.map((q) => (q.parameter.startsWith('pm') ? { ...q, avg: null } : q)) };
  const fresh = currentFromFeed(f, B, stB, at('2026-09-27T00:00:00Z'));
  assert.equal(fresh.state, 'insufficient_data');
  assert.equal(fresh.origin, 'cpcb');
  assert.deepEqual(fresh.reasons, ['No valid PM2.5 or PM10 reading']);
  const stale = currentFromFeed(f, B, stB, at('2026-09-27T05:00:00Z'));
  assert.deepEqual({ st: stale.state, r: stale.reason, at: stale.last_observed_at }, { st: 'unavailable', r: 'no_valid_aqi', at: '2026-09-26T23:30:00.000Z' });
});

test('a publication stamped more than 15 min in the future is not trusted (null)', () => {
  assert.equal(currentFromFeed(bFeed(), B, stB, at('2026-09-26T23:00:00Z')), null);
});
```

- [ ] **Step 2: Run it.** It fails: `currentFromFeed` does not exist.

- [ ] **Step 3: Implement.** Append to `cpcb-feed.ts`, and add the imports at the top:

```ts
import { category } from './cpcb.ts';
import { LIVE_H, STALE_DAYS } from './build.ts';
import { SCHEMA, type AirQualityResponse, type AqiStation, type CpcbResult } from './types.ts';
```

Merge `CpcbSubIndex` and `Pollutant` into this `types.ts` import and delete the earlier type-only import line.

```ts
const HOUR_MS = 3_600_000, DAY_MS = 86_400_000, FUTURE_SLACK_MS = 15 * 60_000;

/** Why CPCB published no AQI, from what its own fields show. Plain sentences: the card prints the first. */
function cpcbReasons(f: FeedStation): string[] {
  const has = (p: Pollutant): boolean => f.subindices.some((q) => q.parameter === p && q.avg !== null);
  const valid = f.subindices.filter((q) => q.avg !== null).length;
  const out: string[] = [];
  if (!has('pm25') && !has('pm10')) out.push('No valid PM2.5 or PM10 reading');
  if (valid < 3) out.push(`${valid} valid pollutants; CPCB needs 3`);
  return out.length ? out : ['CPCB gave no reason'];
}

/**
 * The current state from CPCB's published values, or null when CPCB's answer
 * cannot be used (published more than 7 days ago, or stamped in the future):
 * the caller then falls back to OBOS's own calculation from OpenAQ.
 */
export function currentFromFeed(f: FeedStation, areaKey: string, st: StationEntry, now: Date): AirQualityResponse | null {
  const ageMs = now.getTime() - Date.parse(f.published_at);
  if (ageMs < -FUTURE_SLACK_MS || ageMs > STALE_DAYS * DAY_MS) return null;
  const fresh = ageMs <= LIVE_H * HOUR_MS;
  const station: AqiStation = { id: st.id, name: st.name, lat: st.lat, lon: st.lon, distance_m: st.distance_m, inside: 'window_3km' };
  const common = { schema: SCHEMA, area_id: areaKey, served_at: now.toISOString(),
    source: { owner: st.owner, via: 'CPCB', standard: 'CPCB National AQI' as const } };
  if (f.aqi === null || f.dominant === null) {
    return fresh
      ? { ...common, state: 'insufficient_data', origin: 'cpcb', station, subindices: f.subindices, reasons: cpcbReasons(f), observed_at: f.published_at }
      : { ...common, state: 'unavailable', station, last_observed_at: f.published_at, reason: 'no_valid_aqi' };
  }
  const result: CpcbResult = { origin: 'cpcb', aqi: f.aqi, category: category(f.aqi), dominant: f.dominant,
    window_h: f.dominant === 'co' || f.dominant === 'o3' ? 8 : 24, subindices: f.subindices };
  return fresh
    ? { ...common, state: 'live', station, result, observed_at: f.published_at }
    : { ...common, state: 'stale', station, result, observed_at: f.published_at, age_h: Math.floor(ageMs / HOUR_MS) };
}
```

If importing `build.ts` from `cpcb-feed.ts` creates a cycle `npm run check` complains about, move `LIVE_H`/`STALE_DAYS` into `cpcb.ts`, re-export them from `build.ts`, and say so in the commit body.

- [ ] **Step 4: Run it; all pass.**

**Mutations**, each red, then revert:
- `<=` to `<` on `fresh`;
- remove the future-slack check;
- hard-code `window_h: 24`.

Then run all `tests/unit/aqi-*.test.mjs` and `npm run check`.

- [ ] **Step 5: Commit** with the message `feat(aqi): CPCB's published values become the current state, with the same 2 h / 7 d rules`.

---

### Task 6: The endpoint uses both sources

**Files:**
- Modify: `api/air-quality.ts`, `package.json`, `package-lock.json`
- Test: `tests/unit/aqi-handler.test.mjs`

- [ ] **Step 1: Add the dependency**

```bash
npm install @vercel/functions@^3
```

Expected: `package.json` gains `"@vercel/functions": "^3.x"`.

- [ ] **Step 2: Make the existing handler tests CPCB-aware.** They assume every `fetch` call is OpenAQ. At the top of the test file, after `res`, add:

```js
import { gunzipSync } from 'node:zlib';
const FEED_XML = gunzipSync(readFileSync(new URL('../fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz', import.meta.url))).toString('utf8');
const isCpcb = (u) => String(u).includes('airquality.cpcb.gov.in');
/** Routes CPCB's URL to `cpcb` (a Response factory; default: CPCB down, 503) and everything else to `openaq`. */
const route = (openaq, cpcb = () => new Response('down', { status: 503 })) => (u, init) => (isCpcb(u) ? Promise.resolve(cpcb()) : openaq(u, init));
const freshFeed = () => ({ entry: null, inflight: null });
```

Then update these, keeping each test's intent:
- **`deps`:** becomes `const deps = (fetch, extra = {}) => ({ key: 'k', fetch: route(fetch), now: () => NOW, cache: new Map(), inflight: new Map(), feedCache: freshFeed(), ...extra });`. Now OpenAQ-counting tests (`n === 6`) count OpenAQ only, and CPCB is down, so today's OpenAQ path is exercised as before.
- **"missing key fails closed":** pass `fetch: route(async () => { called = true; })` and `feedCache: freshFeed()`. It still expects 503 `no-store` and `called === false`, because CPCB is down and OpenAQ is never called without a key.
- **"upstream failure is 200 unavailable upstream_error":** pass `feedCache: freshFeed()`. It can keep its fetch: a 503 for everything includes CPCB.
- **The log test:** pass `feedCache: freshFeed()`. Replace `assert.deepEqual(logged[0], …)` with `assert.deepEqual(logged.find((a) => a[0] === 'air-quality upstream failure'), ['air-quality upstream failure', 'in/kolkata/barrackpore', 401]);`. Keep its no-key and no-Error loop over all logged entries, which now also covers the CPCB failure line.

Run the file. Before any handler change it must still pass, apart from failures caused by the extra CPCB call, which the routing removes. If anything else fails, stop and report.

- [ ] **Step 3: Failing tests for the new behaviour.** Append:

```js
const cpcbOk = () => new Response(FEED_XML);
const CNOW = new Date('2026-09-27T00:30:00Z'); // CPCB published 23:30Z: 1 h old → live

test('CPCB ok, OpenAQ ok within the grace: live from CPCB, history from OpenAQ, full cache', async () => {
  const r = await get(deps(null, { fetch: route(async (u) => ok(u), cpcbOk), now: () => CNOW }));
  assert.equal(r.body.current.state, 'live');
  assert.equal(r.body.current.result.origin, 'cpcb');
  assert.equal(r.body.current.result.aqi, 38);
  assert.ok(r.body.history, 'history present');
  assert.match(r.headers['Cache-Control'], /s-maxage=600/);
});

test('CPCB ok, OpenAQ slower than the grace: answer without history, waitUntil keeps the fetch, 60 s cache', async () => {
  const kept = [];
  const slow = (u) => new Promise((f) => setTimeout(() => f(ok(u)), 200));
  const d = deps(null, { fetch: route(slow, cpcbOk), now: () => CNOW, graceMs: 20, waitUntil: (p) => kept.push(p) });
  const r = await get(d);
  assert.equal(r.body.current.result.origin, 'cpcb');
  assert.equal(r.body.history, null);
  assert.equal(r.headers['Cache-Control'], 'public, max-age=0, s-maxage=60');
  assert.equal(kept.length, 1, 'the OpenAQ fetch was handed to waitUntil');
  await kept[0];
  assert.ok(d.cache.get('in/kolkata/ballygunge'), 'it filled the raw cache for the next visitor');
});

test('CPCB ok, OpenAQ fails: CPCB current, no history, 60 s cache, failure logged', async () => {
  const r = await quiet(() => get(deps(null, { fetch: route(async () => new Response('x', { status: 503 }), cpcbOk), now: () => CNOW })));
  assert.equal(r.body.current.result.origin, 'cpcb');
  assert.equal(r.body.history, null);
  assert.equal(r.headers['Cache-Control'], 'public, max-age=0, s-maxage=60');
});

test('CPCB down, OpenAQ ok: today\'s path, origin obos', async () => {
  const r = await quiet(() => get(deps(async (u) => ok(u))));
  assert.equal(r.body.current.result.origin, 'obos');
  assert.match(r.headers['Cache-Control'], /s-maxage=600/);
});

test('no OpenAQ key but CPCB ok: CPCB current, no history, never an OpenAQ call', async () => {
  let openaq = 0;
  const r = await get(deps(null, { key: '', fetch: route(async (u) => { openaq++; return ok(u); }, cpcbOk), now: () => CNOW }));
  assert.equal(r.code, 200);
  assert.equal(r.body.current.result.origin, 'cpcb');
  assert.equal(r.body.history, null);
  assert.equal(openaq, 0);
});

test('the feed is fetched once per 10 minutes and shared by both areas', async () => {
  let cp = 0;
  const d = deps(null, { fetch: route(async (u) => ok(u), () => { cp++; return cpcbOk(); }), now: () => CNOW });
  await get(d); await get(d, { area: 'in/kolkata/barrackpore' });
  assert.equal(cp, 1);
});
```

`deps(null, { fetch: … })` overrides the routed `fetch`; that is intended in these tests.

- [ ] **Step 4: Run it.** The new tests fail.

- [ ] **Step 5: Implement in `api/air-quality.ts`.**

Add imports:

```ts
import { waitUntil } from '@vercel/functions';
import { currentFromFeed, fetchFeed, FeedError, pick, type FeedStation } from '../src/lib/aqi/cpcb-feed.ts';
```

Extend `Deps`:

```ts
  /** CPCB feed cache, injected by tests; production uses FEED below. */
  feedCache?: FeedCache;
  /** How long the answer waits for OpenAQ once CPCB has settled, ms. */
  graceMs?: number;
  /** Keeps work alive after the response (Vercel); injected by tests. */
  waitUntil?: (p: Promise<unknown>) => void;
```

Add, after the `CACHE`/`INFLIGHT` maps:

```ts
export interface FeedCache { entry: { at: number; stations: FeedStation[] } | null; inflight: Promise<FeedStation[]> | null }
const FEED: FeedCache = { entry: null, inflight: null };
export const GRACE_MS = 1_500;
/** An answer without history must not sit at the CDN for 10 minutes: the next visitor should get the chart. */
const PARTIAL_CACHE = 'public, max-age=0, s-maxage=60';

/** CPCB's whole feed, cached 10 min and shared by every area; null on any failure (logged, never cached). */
function feedFor(now: Date, d: Deps): Promise<FeedStation[] | null> {
  const c = d.feedCache ?? FEED;
  if (c.entry && now.getTime() - c.entry.at < CACHE_TTL_MS) return Promise.resolve(c.entry.stations);
  if (!c.inflight) {
    c.inflight = fetchFeed({ fetch: d.fetch })
      .then((stations) => { c.entry = { at: now.getTime(), stations }; return stations; })
      .finally(() => { c.inflight = null; });
  }
  return c.inflight.catch((e: unknown) => {
    console.error('air-quality cpcb feed failure', e instanceof FeedError ? e.message : 'unknown');
    return null;
  });
}

type Settled = { ok: true; raw: RawSet } | { ok: false; e: unknown };
const logUpstream = (area: string, e: unknown): void =>
  console.error('air-quality upstream failure', area, e instanceof OpenAqError ? e.status : 'unknown');
```

In `handle`, replace everything from the `if (!d.key) …` line to the end of the function with:

```ts
  const feedP = feedFor(now, d);
  const rawP: Promise<Settled> | null = d.key
    ? rawFor(area, st, now, d).then((raw) => ({ ok: true as const, raw }), (e: unknown) => ({ ok: false as const, e }))
    : null;
  const feed = await feedP;
  const f = feed ? pick(feed, st) : null;
  const current = f ? currentFromFeed(f, area, st, now) : null;

  if (current) {
    let history: AirQualityPayload['history'] = null;
    if (rawP) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<null>((r) => { timer = setTimeout(() => r(null), d.graceMs ?? GRACE_MS); });
      const r = await Promise.race([rawP, late]).finally(() => clearTimeout(timer));
      if (r === null) {
        try { (d.waitUntil ?? waitUntil)(rawP); } catch { /* no request context (tests, dev): the fetch simply finishes on its own */ }
      } else if (r.ok) {
        history = buildPayload(area, st, r.raw, now).history;
      } else {
        logUpstream(area, r.e);
      }
    }
    res.setHeader('Cache-Control', history ? OK_CACHE : PARTIAL_CACHE);
    res.status(200).json({ current, history } satisfies AirQualityPayload);
    return;
  }

  // CPCB unusable: today's path. A misconfiguration must never be cached at the CDN: it would outlive the fix.
  if (!rawP) { res.setHeader('Cache-Control', 'no-store'); res.status(503).json({ error: 'air quality not configured' }); return; }
  const r = await rawP;
  if (!r.ok) {
    // Never log `e` itself: only the area and the numeric status. OpenAqError messages carry no key.
    logUpstream(area, r.e);
    res.setHeader('Cache-Control', FAIL_CACHE);
    res.status(200).json(upstreamError(area, st, now));
    return;
  }
  res.setHeader('Cache-Control', OK_CACHE);
  res.status(200).json(buildPayload(area, st, r.raw, now));
```

Update the file's header comment. Add a paragraph:

"SOURCES (spec 2026-09-27): CPCB's own feed gives the current value (origin cpcb); OpenAQ gives the 30-day history and is the fallback (origin obos). They are fetched in parallel and fail independently."

- [ ] **Step 6: Run it.** All handler tests pass, and `npm run check` shows 0 errors.

**Mutations**, each red, then revert:
- make `PARTIAL_CACHE` equal to `OK_CACHE`;
- skip the `waitUntil` call;
- await `rawP` without the race;
- fetch the feed without the cache (call `fetchFeed` directly).

- [ ] **Step 7: Commit** `api/air-quality.ts`, `package.json`, `package-lock.json` and `tests/unit/aqi-handler.test.mjs` with the message `feat(aqi): /api/air-quality reads CPCB for the current value and OpenAQ for history, independently`.

---

### Task 7: Paint the CPCB origin

**Files:**
- Modify: `src/scripts/climate-engine/air/air-panel.ts`
- Test: `tests/unit/aqi-panel.test.mjs`

- [ ] **Step 1: Failing tests.** Append. Build payloads with the real functions: `pick`, `parseFeed` and `currentFromFeed` from the fixture, and `buildPayload` for history, as the handler does.

```js
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { currentFromFeed, parseFeed, pick } from '../../src/lib/aqi/cpcb-feed.ts';

const FEED = parseFeed(gunzipSync(readFileSync(new URL('../fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz', import.meta.url))).toString('utf8'));
const KB = 'in/kolkata/ballygunge', SB = stationFor(KB);
const cp = (now, hist = null) => ({ current: currentFromFeed(pick(FEED, SB), KB, SB, now), history: hist });
const C1 = new Date('2026-09-27T00:30:00Z');

test('CPCB live: published line, 24-hour average, published time, no concentration anywhere', () => {
  const card = cardHtml(cp(C1), 'Ballygunge', C1), pane = paneHtml(cp(C1), 'Ballygunge', C1);
  assert.match(card, /Led by <b>PM10<\/b> · CPCB published AQI · <span[^>]*>24-hour average<\/span>/);
  assert.match(card, /Published by CPCB at <b>27 Sept 05:00 IST<\/b>/);
  assert.match(pane, /Pollutants · CPCB sub-indices/);
  assert.match(pane, /<th>24-h sub-index<\/th><th>24-h range<\/th><th>Latest hour<\/th>/);
  assert.doesNotMatch(pane, /µg\/m³|mg\/m³/);
  assert.match(pane, /The largest is the AQI/);
});

test('CPCB table rows: PM10 38 with range 18–53 and latest 45; a null hourly is a dash', () => {
  const pane = paneHtml(cp(C1), 'Ballygunge', C1);
  assert.match(pane, /<td>PM10<\/td><td><span class="si">[^]*?38<\/span><\/td><td class="n">18–53<\/td><td class="n">45<\/td>/);
  const p = cp(C1); p.current.result.subindices = p.current.result.subindices.map((q) => ({ ...q, hourly: null }));
  assert.match(paneHtml(p, 'Ballygunge', C1), /<td class="n">—<\/td>/);
});

test('CPCB stale: red chip, muted number, "No update has reached us since"', () => {
  const T = new Date('2026-09-27T04:40:00Z');
  const card = cardHtml(cp(T), 'Ballygunge', T);
  assert.match(card, /Not Live<span class="sep">·<\/span><b>5 h<\/b> Old/);
  assert.match(card, /class="num muted"/);
  assert.match(card, /No update has reached us since\./);
});

test('O3-led CPCB value reads 8-hour maximum', () => {
  const p = cp(C1); p.current.result.dominant = 'o3'; p.current.result.window_h = 8;
  assert.match(cardHtml(p, 'Ballygunge', C1), /CPCB published AQI · <span[^>]*>8-hour maximum<\/span>/);
});

test('CPCB insufficient: No AQI chip, the reason, the sub-index table', () => {
  const f = { ...pick(FEED, SB), aqi: null, dominant: null };
  const p = { current: currentFromFeed(f, KB, SB, C1), history: null };
  const card = cardHtml(p, 'Ballygunge', C1), pane = paneHtml(p, 'Ballygunge', C1);
  assert.match(card, /chip old">No AQI</);
  assert.match(card, /CPCB published no AQI at/);
  assert.match(pane, /Pollutants · CPCB sub-indices/);
});

test('method note names CPCB as the source of the AQI and OpenAQ as the source of the chart', () => {
  const pane = paneHtml(cp(C1), 'Ballygunge', C1);
  assert.match(pane, /The AQI is CPCB's own published figure for this station/);
  assert.match(pane, /calculated by OBOS with CPCB's method from OpenAQ's copy/);
});

test('no history with a CPCB current says so instead of an empty chart', () => {
  assert.match(paneHtml(cp(C1), 'Ballygunge', C1), /History is loading or unavailable; it comes from OpenAQ\./);
});

test('OBOS fallback is labelled as ours', () => {
  const p = buildPayload(KB, SB, raw('2026-09-24T17:30:00Z'), new Date('2026-09-24T18:00:00Z'));
  assert.match(cardHtml(p, 'Ballygunge', new Date('2026-09-24T18:00:00Z')), /AQI computed by OBOS from OpenAQ \(CPCB feed unreachable\)/);
});
```

`raw` is the file's existing raw-series helper (line 8). Also update the two existing assertions (lines ~148 and ~152) from `AQI by CPCB's method` to `AQI computed by OBOS from OpenAQ \(CPCB feed unreachable\)`.

- [ ] **Step 2: Run it.** The new tests fail.

- [ ] **Step 3: Implement in `air-panel.ts`.**

(a) Imports: add `CpcbSubIndex` and `Result` to the type import.

(b) Replace `hero` and give `windowOf` a new type:

```ts
const windowOf = (r: AqiResult): string => (r.pollutants.find((q) => q.parameter === r.dominant)?.window_h === 8 ? 'maximum 8-hour mean' : '24-hour mean');

function hero(r: Result, muted: boolean): string {
  const meta = r.origin === 'cpcb'
    ? `Led by <b>${pol(r.dominant)}</b> · CPCB published AQI · <span style="white-space:nowrap">${r.window_h === 8 ? '8-hour maximum' : '24-hour average'}</span>`
    : `Led by <b>${pol(r.dominant)}</b> · AQI computed by OBOS from OpenAQ (CPCB feed unreachable) · <span style="white-space:nowrap">${windowOf(r)}</span>`;
  return `<div class="hero"><span class="num${muted ? ' muted' : ''}" style="color:${col(r.category)}">${num(r.aqi)}</span>
    <span class="cat"><span class="dot" style="background:${col(r.category)}"></span>${word(r.category)}</span></div>
    <p class="meta">${meta}</p>`;
}
```

(c) In `block`, the `live`/`stale` case's last line becomes:

```ts
      const t = `<b>${esc(istFmt(c.observed_at))}</b>`;
      const when = c.result.origin === 'cpcb'
        ? `Published by CPCB at ${t}${stale ? '. No update has reached us since.' : ''}`
        : `${stale ? 'No readings have reached us since' : 'Readings to'} ${t}${stale ? '.' : ''}`;
      return head(title, chip) + hero(c.result, stale) + stationLine(c.station, c.source.owner, place) + `<p class="meta">${when}</p>`;
```

(d) In `block`, at the top of the `insufficient_data` case:

```ts
      if (c.origin === 'cpcb') {
        return head(title, '<span class="chip old">No AQI</span>') +
          `<p class="empty">CPCB published no AQI at ${esc(istFmt(c.observed_at))}.</p>
     <p class="meta">${esc(c.reasons.join('; '))}.</p>` + stationLine(c.station, c.source.owner, place);
      }
```

The existing OBOS branch follows, unchanged; it reads `c.pollutants`, which TypeScript now allows because `origin` is narrowed.

(e) Add `subTable` and route `polTable` to it:

```ts
const SUB_ORDER: readonly Pollutant[] = ['pm25', 'pm10', 'no2', 'so2', 'co', 'o3', 'nh3'];

/** CPCB's sub-indices (never concentrations: CPCB's feed carries none). The biggest bar is the AQI. */
function subTable(subs: readonly CpcbSubIndex[]): string {
  const rows = SUB_ORDER.map((p) => subs.find((q) => q.parameter === p)).filter((q): q is CpcbSubIndex => !!q).map((q) => {
    const si = typeof q.avg === 'number' && Number.isFinite(q.avg) && q.avg >= 0 ? q.avg : null;
    const w = si === null ? 0 : Math.min(100, si / 2), bar = si === null ? 'transparent' : col(category(si));
    const range = q.min === null || q.max === null ? '—' : `${num(q.min)}–${num(q.max)}`;
    return `<tr><td>${pol(q.parameter)}</td><td><span class="si"><i style="width:${w}%;background:${bar}"></i>${num(q.avg)}</span></td><td class="n">${range}</td><td class="n">${num(q.hourly)}</td></tr>`;
  }).join('');
  return `<p class="pane-h">Pollutants · CPCB sub-indices</p><table class="pol"><thead><tr><th>Pollutant</th><th>24-h sub-index</th><th>24-h range</th><th>Latest hour</th></tr></thead><tbody>${rows}</tbody></table>` +
    `<p class="pane-note">Sub-indices on the AQI scale, as CPCB publishes them. The largest is the AQI. CPCB's feed carries no concentrations.</p>`;
}
```

At the top of `polTable`:

```ts
  if (c.state === 'insufficient_data' && c.origin === 'cpcb') return subTable(c.subindices);
  if ((c.state === 'live' || c.state === 'stale') && c.result.origin === 'cpcb') return subTable(c.result.subindices);
```

Remove the Task 3 compile-only `origin === 'cpcb'` early returns this replaces.

(f) Give `method` an origin:

```ts
function method(owner: string | null, origin: 'cpcb' | 'obos'): string {
  const who = !owner ? ''
    : origin === 'cpcb'
      ? `The AQI is CPCB's own published figure for this station (source: CPCB). Measured by the ${esc(owner)}. The 30-day chart and the PM2.5 line are calculated by OBOS with CPCB's method from OpenAQ's copy of the station's readings. `
      : `AQI calculated by OBOS with CPCB's National AQI method from the station's readings (received via CPCB and OpenAQ); it can differ slightly from CPCB's own published figure. Measured by the ${esc(owner)}. `;
  return `<p class="pane-note">${who}A monitor counts for a place when it stands inside the 3 km window around the OBOS centre. Air quality is a separate layer: it does not enter the heat model.</p>`;
}

const originOf = (c: Current): 'cpcb' | 'obos' =>
  (c.state === 'live' || c.state === 'stale') && c.result.origin === 'cpcb' ? 'cpcb'
    : c.state === 'insufficient_data' && c.origin === 'cpcb' ? 'cpcb' : 'obos';
```

In `paneHtml`:
- `method(null)` becomes `method(null, 'obos')`;
- the last line becomes `return s + method(c.source.owner, originOf(c));`;
- after `s += polTable(c);`, add:

```ts
  if (!p.history && (c.state === 'live' || c.state === 'stale' || c.state === 'insufficient_data')) {
    s += '<p class="pane-note">History is loading or unavailable; it comes from OpenAQ.</p>';
  }
```

(g) `statusText` needs no change: it reads `result.aqi` and `result.category`, which both origins share.

- [ ] **Step 4: Run** `tests/unit/aqi-panel.test.mjs`, `aqi-load.test.mjs` and `npm run check`. All pass, 0 errors.

**Mutations**, each red, then revert:
- print `µg/m³` in `subTable`;
- swap `24-hour average` and `8-hour maximum`;
- drop the history-null note;
- use the OBOS method text for CPCB.

- [ ] **Step 5: Look at it.** Render the states to a scratch page using the pattern in `previews/aqi-cpcb/index.html` (git-ignored; it holds the approved preview): CPCB live, CPCB stale, CPCB insufficient, OBOS fallback, and CPCB live with no history. Screenshot them with Playwright in the foreground; run the script from the worktree so `@playwright/test` resolves. Compare with the approved preview and fix any difference.

- [ ] **Step 6: Commit** `air-panel.ts` and `tests/unit/aqi-panel.test.mjs` with the message `feat(aqi): paint CPCB's published AQI — published line, sub-index table, CPCB method note`.

---

### Task 8: Gates, real build, live run

- [ ] **Step 1:** Run `npm run check && npm run typecheck && npm run test:py && npm run test:unit && npm run build`. Record the counts; all must pass.

- [ ] **Step 2:** Run `npx vercel build --yes`. Then check `.vercel/output/functions/api/air-quality.func/`:
  - no `.ts'` import specifiers;
  - `node_modules/@vercel/functions` present, or bundled.

  Then smoke-test with plain node, with no key and the real network:
  - `ballygunge` gives 200, origin `cpcb`, `history: null` (no key), and the partial cache header;
  - `baruipur` gives `no_station`.

  Delete `.vercel/output` afterwards.

- [ ] **Step 3: Dev run with the real key.**

```bash
OPENAQ_API_KEY=$(tr -d '[:space:]' < ~/.config/delta-climate/openaq-key) npm run dev
```

Run it in the background. Stop it by the PID found with `lsof -i :<port>`; never use a `pgrep -f` loop. Request all three areas twice and report:
- state, origin, aqi, dominant and `observed_at`;
- whether `history` is present on the first and second request;
- timing and `Cache-Control`;
- that the key appears 0 times in the bodies.

- [ ] **Step 4:** In the running dev app, open `/heat-map/in/kolkata/ballygunge` and click **Air**. Screenshot the pane and card, Barrackpore after an in-place switch, and Baruipur. The console should show 0 errors.

- [ ] **Step 5: Commit** nothing unless a gate forced a fix. Report the numbers.

---

### Task 9: Evidence and docs

**Files:**
- Modify: `docs/AQI/05-research-register.md`, `docs/AQI/README.md`, `docs/superpowers/specs/2026-09-27-aqi-cpcb-feed-design.md`

- [ ] **Step 1: Analyse the recorder.** Its snapshots are in `~/.cache/delta-climate/cpcb-rss/`, taken every 15 min from 2026-09-26T23:55Z for 6 h. Report:
  - each distinct `lastupdate`, and when it first appeared (the lag after the IST hour);
  - HTTP failures;
  - whether Ballygunge's and Barrackpore's values change between updates;
  - the station count per snapshot.

```bash
cd ~/.cache/delta-climate/cpcb-rss && cat log.txt && for f in feed-*.xml.gz; do printf '%s ' "$f"; gunzip -c "$f" | grep -o 'lastupdate="[^"]*"' | sort -u | tr '\n' ' '; gunzip -c "$f" | grep -A9 'Ballygunge, Kolkata' | grep -o 'Air_Quality_Index[^/]*'; done
```

- [ ] **Step 2:** Add register row **AQI-R47** ("CPCB feed cadence, measured") with those numbers. If the lag or cadence makes the 2 h live rule wrong (for example, updates only every 3 h), stop and report before changing `LIVE_H`. That change is the founder's call.

- [ ] **Step 3:** Update `docs/AQI/README.md` "Current state":
  - the current value now comes from CPCB's feed;
  - OpenAQ supplies history and the fallback;
  - the future PostgreSQL archive.

  Update the spec:
  - §3 "Gate before code" becomes "measured: see AQI-R47";
  - §4 drops `published_at` from `CpcbResult`, because `observed_at` carries it;
  - §6 records the no-key behaviour: CPCB current is still served, with history null.

- [ ] **Step 4: Commit** the three docs with the message `docs(aqi): CPCB feed cadence measured; README and spec match the build`.

---

### Task 10: Release

- [ ] **Step 1: Final audit.** An independent reviewer audits the whole branch (`git diff origin/main...HEAD`) against the spec, as the previous release's audit did:
  - an independent recomputation: CPCB's AQI must equal max(Avg) for the Kolkata stations on a fresh live fetch;
  - new mutations;
  - security: key, XSS, the feed as untrusted input;
  - failure matrix and deployability.

  Fix every Critical and Important finding, with tests.

- [ ] **Step 2: PR.** With the founder's go-ahead:
  - `git fetch origin`, merge `origin/main` if it has moved, and re-run the gates;
  - `git push -u origin feat/aqi-cpcb-feed`, then `gh pr create`, with a summary, the evidence (AQI-R47a, AQI-R47) and a test plan.

- [ ] **Step 3: Preview.** Wait for Vercel. Then query all three areas through `npx vercel curl "/api/air-quality?area=in/kolkata/<area>" --deployment <preview-url>`. Ballygunge and Barrackpore must be origin `cpcb`.

- [ ] **Step 4: Merge.** With the founder's go-ahead, merge, then verify on `https://deltaclimate.earth/api/air-quality?area=in/kolkata/ballygunge` and in the Air pane.
