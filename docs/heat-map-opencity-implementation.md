# OpenCity integration, remaining work — implementation plan

**Contract:** [`superpowers/specs/2026-08-03-opencity-integration-design.md`](superpowers/specs/2026-08-03-opencity-integration-design.md)
**Date:** 2026-08-03
**Predecessor:** water geometry + animation shipped (`water-3d`, 17adb7e) — contract §2 is
closed and is not re-planned here.
**Estimate:** ~2.5 days across four phases, each landing green before the next.

Every phase ends with its own `--check` passing, `npm run verify` green, and one commit.
**`accuracy.ts` is not modified in any phase.** Phase 4 is the only one that can move a
published number, which is why it is last.

---

## 0 · Code shape — the rule every phase is written to

The codebase is growing, so this plan is deliberately biased toward **many small named
functions over few clever ones**. Concretely, and non-negotiably:

- **One job per function, and the name says the job.** `parse_mixed_date`, not
  `handle_dates`. If a name needs "and" in it, it is two functions.
- **No function longer than roughly a screen.** A `main()` that reads as a table of
  contents — six or seven calls, each named — is the target shape. The existing
  `fetch-water.py` is the reference: `classify`, `query`, `to_metres`, `ring_area`,
  `clip_box`, `stitch_outers`, `fetch_ward`, `check`, `main`.
- **Pure core, effectful edge.** Parsing, maths and geometry take values and return
  values; only the outermost layer touches the network or the disk. That is what makes
  a unit test a three-line import instead of a fixture rig.
- **Optimisation stays, in the one place it pays.** Hot inner loops (rasterisation,
  per-cell passes) keep their typed arrays and their single allocation — but they get a
  doc comment saying *why* they are shaped that way, so nobody "tidies" them into
  something slower. Everything outside a hot loop is written for the reader.
- **A constant with a reason beats a literal with a comment.** `MIN_HOURS_PER_DAY = 18`
  at module scope, not `18` inline.

---

## File plan

```
scripts/
  build-heatwave-percentiles.py   NEW  P1 · IMD CSV → percentile artefact, --check
  fetch-opencity.py               NEW  P2 · table-driven acquisition + manifest, --check
  build-aqi-daily.py              NEW  P3 · 7 station CSVs → per-station daily, --check
  measure-water-delta.mjs         NEW  P4 · the gate's instrument
  export-built-raster.mjs         (unchanged — P4's byte-identity oracle)

data/opencity/
  imd-kolkata-daily.csv           NEW  P1 · 26,806 rows, pipeline-side, never public/
  manifest.json                   NEW  P2 · source_url/retrieved/licence/sha256/blockers
  water-census.kml · microwatersheds.geojson · kmc-parks.csv · aqi/*.csv   NEW  P2
  aqi-daily.json                  NEW  P3

data/calibration/
  water-activation.json           NEW  P4 · per-ward meanC with/without — the gate record

public/heat-map/data/
  heatwave-percentiles.json       NEW  P1 · ~1 KB — the ONLY new served artefact

src/scripts/climate-engine/
  phase-select.ts                 NEW  P1 · pure button → scenario selection (tier 2)
  sky.ts                          EDIT P1 · vapour-pressure-preserving heat shift
  heat-map-model.ts               EDIT P1 · ScenarioState.heatTairC; one line at :324
  heat-map-app.ts                 EDIT P1 · ~12 lines wiring; the blind cast dies
  ward-raster.ts                  EDIT P4 · extract rasterizePolygons; water producer
  explore/cooling-surfaces.ts     EDIT P4 · :10-16 and :35 become false

src/components/ClimateEngine/HeatMapStage.astro
                                  EDIT P1 · 4th seg button (:166) · P4 credits (:235)

tests/unit/
  heat-map-heatwave.test.mjs      NEW     P1 · union + cast tripwires, wet-bulb guard
  opencity-manifest.test.mjs      NEW     P2 · licence/blocker invariants
  opencity-aqi.test.mjs           NEW     P3
  heat-map-water.test.mjs         REWRITE P4 · the tripwire's job changes, never vanishes
```

---

## Phase 1 — Heatwave as a forcing override (~1 day)

### 1a · `build-heatwave-percentiles.py`

Function shape — `main()` reads as its own summary:

```
download_if_missing(url, dest)      → path        (effectful edge)
parse_mixed_date(raw)               → date|None   (pure)
read_temp_rows(path)                → (rows, exclusions)
percentiles(values, method)         → dict        (pure)
build_artefact(rows, exclusions)    → dict        (pure)
write_json_stable(path, doc)        → None
check()                             → int
```

Facts handled explicitly, not defensively:

- **The date column is mixed** — 26,803 `dd-mm-yyyy` and **3 Excel serials**.
  `parse_mixed_date` converts serials with the 1899-12-30 epoch; `read_temp_rows`
  asserts the three land inside the span and duplicate no existing date. Silently
  dropping them is the ECOSTRESS truncation lesson repeating.
- **59 unusable Temp Max** (58 `-----` markers, 1 empty). Every exclusion is counted
  with its reason and printed. Assert `total == 26806` and `usable == 26747` — a
  different denominator means the CKAN resource moved and the reviewed p99 is not the
  shipped p99.
- `PCTL_METHOD = "linear"` is a named constant; switching to `nearest` moves p99.

Artefact carries provenance **in band** — the rule `{ward}-water.json` already follows
and its test already asserts:

```json
{"city":"Kolkata","source":"…","licence":"Public Domain","retrieved":"2026-08-03",
 "span":{"from":"1951-01-01","to":"2024-12-31"},"rows":{"total":26806,"usable":26747},
 "method":"linear","tmaxC":{"p50":31.7,"p95":36.3,"p99":38.4,"max":43.0}}
```

**Byte-identical regeneration** (spec §9): `retrieved` is a constant in the script, not
`date.today()`; `write_json_stable` fixes key order, 1-dp rounding and a trailing
newline; `--check` compares the *serialised bytes*, not the parsed values.

### 1b · `sky.ts` — the humidity decision (CEO call: hold vapour pressure)

Heatwave preserves **absolute** humidity, not relative. Verified consequence of the
alternative: today 30 °C / 96 % RH → 38.4 °C at 96 % RH is a **wet-bulb of 37.9 °C**,
past the 35 °C human survivability limit and never observed on Earth — the model would
faithfully simulate an impossible atmosphere. Preserving vapour pressure gives 60 % RH
and a 31.6 °C wet-bulb.

One pure function beside `saturationVapourPressure`:

```ts
/** RH at `tTarget` that holds the same absolute humidity as `tNow`/`rhNow`. */
shiftAirPreservingVapour(tNow: number, rhNow: number, tTarget: number): number
```

`e = es(tNow) · rhNow/100`, return `clamp(100·e/es(tTarget), 5, 100)`. Four lines, pure,
node-tested. A self-check asserts the heatwave forcing never produces a wet-bulb above
35 °C across the live-ambient envelope.

This is what earns the framing *today's air mass, at 1-in-100 heat*: it invents nothing,
whereas holding RH invents the very heatwave-day humidity the honesty note says we do
not have.

### 1c · `phase-select.ts` — the pure module

The Now precedent's argument was *one flag, no fan-out*. Heatwave's risk is its mirror:
**three fields must move together** (`phase`, `sunNow`, `heatTairC`), and a click handler
setting them in sequence is three chances to strand one.

```ts
export interface PhaseSelection { phase: 'peak' | 'night'; sunNow: number | null; heatTairC: number | null }

export function selectPhase(id: string, heatTairC: number | null): PhaseSelection | null
//  'now'      → { 'peak',  0,    null }   // 0 = the live sentinel refreshNowSun corrects
//  'peak'     → { 'peak',  null, null }
//  'night'    → { 'night', null, null }
//  'heatwave' → heatTairC == null ? null : { 'peak', null, heatTairC }
//  otherwise  → null                      // "change nothing" — the blind cast's replacement
```

Every return has `phase ∈ {'peak','night'}` by construction, so the union cannot widen.
Returning `null` for an unknown id is the point: it is testable from node, which a cast
never was.

### 1d · `heat-map-model.ts` — two lines and a doc comment

`ScenarioState` gains `heatTairC?: number | null`, documented in the register of the
`sunNow` comment. Line 324 splits:

```ts
const L = s.live, obsTair = L ? L.tAir : FALLBACK_TAIR;
const baseTair = (s.heatTairC ?? obsTair) + (PATH_DELTA[s.path] ?? 0);
```

plus the RH substitution from 1b when `heatTairC` is set.

**`PATH_DELTA` stays additive on top, deliberately.** Replacing the whole expression
would make `#segPath` silently dead under heatwave — a button that does nothing and says
nothing, exactly the fan-out the Now note refuses. Composed it reads: *a 1-in-100 day
under SSP5-8.5*. Both are additive forcing shifts; composing them invents nothing.

Extend `assertInterventionLogic()`: the override changes `tAir` and `rh` and **nothing
else** — `sun` / `wind` / `Q` / `store` identical to plain peak.

### 1e · `heat-map-app.ts` — ~12 lines

The local `State` gains `heatTairC: number | null`. **Required, not cosmetic:**
`M.currentParams(state)` is structurally typed against `State`, so adding the field only
to `ScenarioState` would leave the override invisible to the model.

One cached fetch of the percentile artefact, swallow-to-empty like the water loader. The
handler becomes: read `dataset.p` → `selectPhase` → **`if (!sel) return` before the class
toggle** (an unknown id must not even move the highlight) → assign the three fields →
`refreshNowSun()` only when `sel.sunNow != null` → existing toggle / `updateCompareHref()`
/ `resetSim()`. No cast remains.

The `:1071` label gains `state.heatTairC != null ? 'modelled at 13:00 · 1-in-100 heat'`.
Without it a reader sees 39 °C labelled "modelled at 13:00" with no sign a scenario is
on — the exact failure the clock work fixed for Now. The conf chip keeps
`ACCURACY['peak']` (peak physics, scenario forcing) and appends `· scenario forcing`,
with one tooltip sentence saying the ±4.5 K band was measured under observed forcing.

### 1f · `HeatMapStage.astro`

One button at `:166`, label `Heatwave`, no number, placed **last** — the first three are
the diurnal axis and the fourth is a scenario, so it must not pretend to be a fourth
hour. `.seg button` is `flex:1` with no `white-space` rule, so at four across the widest
label (`22:00 RETAINED`) may wrap. **Measure at the narrowest supported width**; if it
wraps, the minimal fix is `white-space:nowrap` on `.seg button` plus tracking
`.1em → .06em` on `.seg` only.

### Tests — `heat-map-heatwave.test.mjs`

Each exists to catch a named regression:

1. Unknown ids return `null` (`'retained'`, `''`, `'Peak'`) — the cast's replacement.
2. Source grep: no `as 'peak' | 'night'` survives in `heat-map-app.ts`.
3. Source grep: the union is still binary in **both** `heat-map-model.ts` and
   `accuracy.ts`; the failure message names all five consumers (ACCURACY lookup,
   `bandLabel`, DC-URS split, Compare link, phase label) so a future widener sees the
   cost before paying it.
4. Mutual exclusion across every id: at most one of `sunNow != null`, `heatTairC != null`.
5. Heatwave vs plain peak differ in `tAir` and `rh` only.
6. Heatwave + `ssp585` → `tAir === p99 + 4.1` — pins the additive composition.
7. `selectPhase('heatwave', null) === null` — inert without data.
8. **Wet-bulb ≤ 35 °C** across the live-ambient envelope.
9. Artefact: ordering `p50 < p95 < p99 <= max`, `usable/total > 0.99`.

E2E (DOM-focused, generous budgets — CI is SwiftShader at ~0.8 fps): four buttons
present; clicking Heatwave moves `.on` off Now; `#lstPhase` names the scenario; `#conf`
still reads the peak band; **all four buttons share one `offsetTop`** (the row did not
wrap); clicking back to Now restores `modelled now`, proving the override clears.

**Exit:** `--check` green · generator run twice leaves `git diff --exit-code` clean ·
`npm run verify` green · the commit records the Peak→Heatwave ward-mean delta at one
live reading · a screenshot of the seg row at the narrowest width.

---

## Phase 2 — Acquisition fetcher + manifest (~½ day)

`fetch-opencity.py`, table-driven — one row per resource, so dataset #6 is a table row
rather than a new script.

```
DATASETS: tuple[Resource, ...]              # the table; id, url, dest, kind, licence, blockers
download(resource)      → bytes             (effectful edge)
describe(path, kind)    → dict              # rows|features, bytes, sha256   (pure)
build_manifest(results) → dict              (pure)
check()                 → int
```

Manifest entry: `{id, path, source_url, retrieved, licence, sha256, bytes, rows|features,
notes, blockers, display}`.

Three `--check` rules, each replacing a promise with an assertion:

- **Drift** — re-hash every file on disk against its recorded `sha256`; fail naming the id.
- **Blocked means blocked** — any row with a non-empty `blockers` list must have
  `display: false`. Parks carries exactly two: *licence not stated by the publisher* and
  *Area units unstated (present on 34/93 rows)*. This is the only thing standing between
  a licence-unknown dataset and a future UI, and prose cannot enforce it.
- **Nothing raw is served** — no manifest `path` may start with `public/`. That is the
  contract's "derived artefacts, never raw archives", made checkable.

`licence` is either a named licence or the literal string `"not stated"` — **never
absent**, because absence is how "we forgot to ask" quietly becomes "public domain".

`notes` records findings verbatim so nobody re-derives them: microwatersheds containment
(MWS `2A1A5k3` / `2A1A5h3` / `2A1C1a5`, basin 2A, all three wards, median polygon ~5–8×
the 196 ha window) and the parks KMC-keying that killed the DC-URS route.

**Exit:** `--check` green offline from a clean checkout; `npm run verify` green with
nothing in the build changed — this phase adds zero runtime code.

---

## Phase 3 — AQI derivation + findings note (~½ day)

`build-aqi-daily.py` reads `data/opencity/aqi/*.csv` and writes
`data/opencity/aqi-daily.json`. Pipeline-side only, no `public/` artefact, no UI.

```
read_station(path)          → rows          (pure once the file is open)
group_by_day(rows)          → dict[date, list]
summarise_day(readings)     → {d, mean, max, hours}
station_ward(station_name)  → WardId | None
check()                     → int
```

**`hours` is not optional.** A daily mean built from 4 readings is not a daily mean, and
without the count it is indistinguishable from one built from 24. Days below
`MIN_HOURS_PER_DAY = 18` are emitted flagged, never dropped — the calibration plan's rule
that the spec forbids invisible exclusions.

`--check`: 7 stations · dates within 2017-01-01…2023-12-31 · `mean <= max` every day ·
each station's `ward` is a known ward id or `null` · **exactly one station maps to a
modelled ward, and it is Ballygunge**. The whole "calibration-grade record beside a
modelled ward" claim rests on that single mapping; if it breaks it must break loudly.

**Findings note** — a new subsection in `docs/heat-map-feature.md` under *Validation
status*: what the Ballygunge record shows, over what span, at what completeness, and the
honest limit — this is an **air-quality** series offered as evidence about a **thermal**
model, so it supports co-exposure and seasonality, not temperature validation. Name the
one thing it could later bear on (the aerosol contribution to the 3.34 K daytime ceiling
`accuracy.ts` documents) and say plainly that it needs its own spec.

`opencity-aqi.test.mjs` restates the four `--check` invariants against the committed
JSON — the house pattern of asserting at build *and* on what was committed.

**Exit:** `--check` green; the note is in the doc; `npm run verify` green; the commit
carries per-station row counts and Ballygunge's completeness percentage.

---

## Phase 4 — Water physics 4B, calibration-gated (~½ day, plus whatever the gate demands)

### 4a · Measure before changing anything

`measure-water-delta.mjs` (node + tsx, same shape as `validate-model.mjs`): per ward,
build layers with and without the committed artefact, run `TsHeatSim` for `RESET_BURST`
steps at canonical peak and night, print `meanC` with/without and the delta, and write
`data/calibration/water-activation.json`. It stays in the repo so the number can be
re-measured rather than re-argued.

**Predict the gate, do not hope.** Measured artefact areas over the 196 ha window:
Ballygunge 1.41 ha (0.72 %), Baruipur 3.63 ha (1.85 %), **Barrackpore 12.01 ha
(6.13 %)**. Water cells relax 35 % per step toward `tAir − 1.5` and gain a `+0.65·water`
ventilation bonus, so they settle ~10 K below a typical open peak cell. Expected ward-mean
deltas: ~0.07 K, ~0.19 K, ~0.6 K. **Two of three breach the 0.1 K gate** — budget the
`measure-accuracy.py` re-run as work *inside* this phase, not as a contingency.

### 4b · Producer — `ward-raster.ts`

Extract `rasterizePolygons(rings, sizeM, n)` from `rasterizeWardBuilt`; the
`pointInPolygon` core is already generic. `rasterizeWardBuilt` becomes a ~10-line adapter
mapping `ward.b` (stride 2 from index 1; `b[0]` is height); `rasterizeWardWater` is a
second adapter mapping `WaterData.polys[].p` — **already flat `[x,y,…]` in the identical
ward-centred metre frame, so no transform**, and the doc comment must say so.

The supersampling loop keeps its typed arrays and its single allocation, with a comment
saying why — it is the one genuinely hot path here and must not be "tidied" into
something slower.

Class filter: include `water` and `river`, exclude `pool`. Today all 86 polygons across
the three wards are class `water`, so the rule costs nothing now and prevents a future
Overpass run quietly putting private swimming pools into the ward mean. `river` must stay
— Barrackpore's 12.01 ha is the Hooghly edge, the largest thermal feature in the set.

**Byte-identity gate on the refactor:** `node scripts/export-built-raster.mjs` prints
mean-built per ward to 4 dp and feeds the DC-URS `far` pipeline. Record before, record
after, they must match exactly. That one command is the difference between a refactor and
a silent recalibration of the resilience score.

### 4c · Wiring — one signature, one line

`rasterWardBase(ward, means, surface, water = null)`; the app passes
`waterCache[name] ?? null` (populated before the call — verified).

**`compare/paired-runner.ts` is not touched.** The `null` default keeps Compare on zeros,
so its published pair numbers cannot move and the reference-forcing contract stays pinned
for free. That default *is* the contract, so a test pins it — a future "tidy-up" making
water required would move Compare's numbers with no diff line that looks like it did.

### 4d · The tripwire changes job

`heat-map-water.test.mjs` currently asserts (a) nothing assigns into a water array and
(b) the zero-fill is literally present. Both become false in this phase. **Deleting it
would delete the gate** — rewrite it in the same commit to assert what is true
afterwards:

- three-argument `rasterWardBase` still yields an all-zero water layer — the Compare
  contract, mechanically;
- with an artefact passed, water ∈ [0,1] everywhere and the raster's ward mean is within
  10 % of `Σ ring area / sizeM²` from the artefact;
- `pool` polygons contribute zero;
- `water-activation.json` exists, and if any |delta| > 0.1 K it records that
  `measure-accuracy.py` was re-run, with before/after RMSE per stratum.

### 4e · Copy and attribution

The credits line at `:235` gains `· Water © OpenStreetMap (ODbL)` — a licence
obligation, one sentence, per the contract's attribution call.

**`explore/cooling-surfaces.ts:10-16` and `:35` become false.** They state the browser
has no water mask and that Barrackpore diverges because of it. Rewrite through the
honesty checklist, stating exactly which half changed: the **simulation** now sees water;
the **cooling-surfaces mask** still does not. Adding water to that mask would move
published walk-ring distances and needs the offline TRA pipeline's agreement —
**explicitly out of scope, own spec.**

### 4f · If the gate fires (expect it to)

Re-run `python3 scripts/measure-accuracy.py`; record before/after RMSE per stratum. If
the daytime figure moves by more than the ±0.49 K Landsat CI half-width, that is a
recalibration needing its own reviewed PR — **the phase stops and reports**, exactly as
the calibration plan's stop condition works.

**Exit:** per-ward per-phase deltas in the PR body · `export-built-raster.mjs` means
byte-identical across the refactor · rewritten water test green · Compare e2e green with
unchanged pair numbers · `npm run verify` green.

---

## Three findings where the design meets a verified consumer

1. **Humidity** — resolved by CEO decision: hold vapour pressure (§1b). The alternative
   produces a physically impossible atmosphere on muggy days.

2. **DC-URS silently absorbs the scenario forcing.** `:1157` feeds `st.meanC` in as
   `dayC` whenever a slider is non-zero and `:1191` reports "pts from this plan", so
   heatwave's shift would be credited to the plan. **Pre-existing** — `#segPath` at
   `ssp585` already does this at +4.1 K, unguarded, since it shipped. Do not widen scope
   (spec §8 forbids DC-URS changes); record it as pre-existing in the commit and add a
   test pinning heatwave → `dayC`, never `nightC`, so the eventual fix is visible.

3. **The Compare deep-link drops the heatwave silently.** `phase === 'peak'` so the link
   is correct for the pinned contract, but the reader lands on materially cooler numbers
   with no explanation. One line: a `title` on the anchor. Do not encode heatwave in the
   URL — spec §8 puts Compare heatwave forcing out of scope.

Checked and **not** broken: `refreshNowSun()` early-returns on `sunNow === null`, so it
cannot overwrite the pinned `phase: 'peak'`; and `state.baselineMean` / `state.greenG` are
write-only in the app, so P4's `eqMean`-vs-sim water inconsistency is latent rather than
shipped — record it, do not fix it here.

---

## What could go wrong

| Symptom | Response |
|---|---|
| IMD row count ≠ 26,806 or usable ≠ 26,747 | Fail loudly — the reviewed p99 is not the shipped p99 |
| The 3 Excel serials vanish silently | Assert converted dates land in span and duplicate nothing |
| Artefact not byte-stable | `retrieved` is a constant; fixed key order and rounding |
| Wet-bulb above 35 °C | The self-check fires — this is why the vapour-pressure branch was chosen |
| `ssp585` silently dead under heatwave | Override is `??` on the observation only; test 6 pins it |
| Seg row wraps at four buttons | Measure narrow; `white-space:nowrap` + tighter tracking; e2e asserts equal `offsetTop` |
| Union widened, or the cast returns | Source tripwires, failure messages naming all five consumers |
| Parks surfaced unlicensed | `blockers ⇒ display:false`, asserted in `--check` and in the unit test |
| Built raster shifts in P4 | `export-built-raster.mjs` means must match to 4 dp |
| Compare numbers move in P4 | 4th param defaults `null`; `paired-runner.ts` untouched; test pins it |
| **Water gate fires** | **Expected** (~0.19 K, ~0.6 K). Re-run in-phase; >±0.49 K daytime → stop and report |
| Tripwire deleted with 4B | It is rewritten in the same commit; its new job is asserting the gate record |

---

## Sequencing rule

**P1 → P2 → P3 are strictly ordered** (P2 adopts P1's committed CSV as a manifest row;
P3 consumes the AQI files P2 downloads). **P4 is independent of all three and goes last**:
a heatwave forcing and a newly-activated water layer would both move the ward mean, and
measured after each other neither number means anything. One change at a time, measured
after each.

One commit per phase, `npm run verify` green on every commit. No `accuracy.ts` change in
any phase. No `public/` artefact except `heatwave-percentiles.json`. Wiring in
`heat-map-app.ts` stays under 40 lines across the whole plan (~12 in P1, 1 in P4); the
moment it does not, `phase-select.ts` is where the next piece goes.
