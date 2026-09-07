# Solar guide + rooftop validation — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The solar card and pane lead with intervals and a tier chip, carry a how-sure ladder whose every line names its fix, print a one-page installer brief; and the laboratory can predict and then score real rooftops under the pre-registration, before any measured number exists.

**Architecture:** No new physics. The yield chain publishes a `tiers` block; a pure `solar-ranges.ts` turns published numbers into per-roof ranges; the card, pane and brief paint from it. Two Python scripts (`predict-pv-validation.py`, `measure-pv-validation.py`) implement §3 of the pre-registration with a self-check each, mypy-strict, and a cached NASA POWER daily fetch behind a seam so the self-check runs offline.

**Tech Stack:** Astro + vanilla TS (`heat-map-app.ts`), node:test units (import `.ts` directly), Playwright e2e on `chromium-tier0`, Python 3 + pvlib + numpy (mypy strict). Gates: `npm run check` (TS), `npm run typecheck` (mypy), `npm run test:unit`, `npm run test:py`, e2e, `npm run verify`.

**Specs:** `docs/superpowers/specs/2026-09-07-solar-guide-design.md` and `docs/superpowers/specs/2026-09-07-pv-rooftop-validation-design.md` (PRE-REGISTERED: nothing in §3/§4 of it changes without an amendment).

**Standing rules:** no `₹`/`en-IN`/`crore`/`lakh` typed in `src/scripts/climate-engine` (use `fmtMoney`/`fmtRate`/`currencyMark`); no hex written twice in a stylesheet (token it); no "payback" anywhere (unit pin); Playwright runs against `dist/` (rebuild after `src/` edits); exFAT git: never `reset --hard`; never push mid-plan.

---

### Task 1: the `tiers` block, typed and guarded

**Files:** Modify `scripts/build-pv-yield.py` (browser writer, ~line 319–345, and `--self-check`); `src/scripts/climate-engine/types.ts` (`PvFile`); `src/scripts/climate-engine/heat-map-app.ts` (`asPvFile`, ~1293); `tests/unit/obos-scope.test.mjs`.

- [ ] **Step 1: unit test first.** In `obos-scope.test.mjs`, beside the `p.pv` pin (~line 120), add a test that reads `public/heat-map/data/pv-ballygunge.json` and asserts `tiers.screened === true`, `tiers.yield_bracket_kwh_per_kwp` deep-equals `[1200, 1450]`, `tiers.packing_range` deep-equals `[0.28, 0.40]`, `tiers.validated === null`. Run `npm run test:unit` → fails (no `tiers`).
- [ ] **Step 2: the writer.** In `build-pv-yield.py`'s browser `json.dump` (the one with `"totals"` at ~331), add
  ```python
  "tiers": {
      "screened": True,
      "yield_bracket_kwh_per_kwp": [YIELD_MIN, YIELD_MAX],
      "packing_range": list(PACKING_RANGE),
      "shading_band": "loss_strict .. loss",
      "validated": None,   # filled by measure-pv-validation.py when n >= 25 (pre-registration §6.3)
  },
  ```
  and in `--self-check` assert the block round-trips. Regenerate the three browser files (`python3 scripts/build-pv-yield.py` per ward as the script's usage says) — the registered calibration artefacts are NOT rewritten.
- [ ] **Step 3: the type and the guard.** `PvFile` gains `readonly tiers: { readonly screened: boolean; readonly yield_bracket_kwh_per_kwp: readonly [number, number]; readonly packing_range: readonly [number, number]; readonly shading_band: string; readonly validated: null | { readonly n: number; readonly months: number; readonly median_ratio: number; readonly within_15pct_share: number; readonly date: string } }`. `asPvFile` adds `&& Array.isArray(f.tiers?.yield_bracket_kwh_per_kwp) && Array.isArray(f.tiers?.packing_range)` to `ok`.
- [ ] **Step 4:** `npm run test:unit` green; `npm run typecheck` (mypy) green; `npm run check` green. Commit: `feat(solar): the artefact carries its tiers — the yield bracket, the packing range, and a validated slot`.

### Task 2: per-roof ranges, pure and pinned

**Files:** Create `src/scripts/climate-engine/solar-ranges.ts`; Test `tests/unit/solar-ranges.test.mjs`.

- [ ] **Step 1: the test.** Fixture `pv = { kwp:[7.3], kwh:[9470], loss:[0.09], loss_strict:[0.04], specific_yield:1313.8, packing_factor:0.28, tiers:{ yield_bracket_kwh_per_kwp:[1200,1450], packing_range:[0.28,0.40] } }`. Assert `pvRanges(pv, 0)` returns `{ kwpLow: 7.3, kwpHigh: 10.43 (7.3×0.40/0.28, 2 dp), kwhLow: 7972 (7.3×1200×0.91, rounded), kwhHigh: 14523 (10.43×1450×0.96, rounded) }`; that `kwhLow <= kwh[0] <= kwhHigh`; and that a roof with `kwp 0` returns all zeros. Run → fails (module missing).
- [ ] **Step 2: the module.**
  ```ts
  import type { PvFile } from './types';
  export interface RoofRanges { readonly kwpLow: number; readonly kwpHigh: number; readonly kwhLow: number; readonly kwhHigh: number }
  /** Products of PUBLISHED numbers only (spec 2026-09-07-solar-guide §3): the packing
      interval scales capacity, the yield bracket scales generation, and the shading band
      runs from the A1 headline (low) to the strict floor (high). Nothing is re-derived. */
  export function pvRanges(pv: Pick<PvFile, 'kwp' | 'loss' | 'loss_strict' | 'packing_factor' | 'tiers'>, i: number): RoofRanges {
    const [pLo, pHi] = pv.tiers.packing_range, [yLo, yHi] = pv.tiers.yield_bracket_kwh_per_kwp;
    const kwpLow = pv.kwp[i], kwpHigh = +(kwpLow * pHi / pLo).toFixed(2);
    return { kwpLow, kwpHigh,
      kwhLow: Math.round(kwpLow * yLo * (1 - pv.loss[i])),
      kwhHigh: Math.round(kwpHigh * yHi * (1 - pv.loss_strict[i])) };
  }
  ```
- [ ] **Step 3:** test green; `npm run check`. Commit: `feat(solar): per-roof ranges from published numbers, pinned`.

### Task 3: the card — interval first, tier chip, the how-sure ladder

**Files:** Modify `src/components/ClimateEngine/HeatMapStage.astro` (`#bcSol` block + CSS, dark + `body.studio`); `src/scripts/climate-engine/heat-map-app.ts` (`paintSolarCard` ~730, a `mailtoFor(limit)` helper); `tests/unit/obos-shell.test.mjs` (~3271); `tests/e2e/solar-pane.spec.ts` test 3.

- [ ] **Step 1: unit pins first** (obos-shell, in the solar test): the stage contains `id="bcSolTier"`, a `<details class="bc-sure"` with exactly five `<li data-limit=`, and `id="bcBrief"`; the app contains `pvRanges(` and `mailto:ant@deltaclimate.earth`; `payback` still absent. Run → fails.
- [ ] **Step 2: markup.** Header becomes `<div class="bc-h"><span>Rooftop solar</span><span id="bcSolTier" class="bc-tier">screened</span></div>`. Rows keep ids; after the `<dl>` add
  ```html
  <details class="bc-sure" id="bcSure">
    <summary>How sure, and what would make it surer</summary>
    <ul>
      <li data-limit="roof">Roof obstacles unknown — tanks, stair rooms, parapets. <b id="bcSureRoof"></b> A ten-minute walk of the roof with a phone narrows it to about ±10%. <button type="button" class="bc-ask" data-limit="roof">Ask about this</button></li>
      <li data-limit="canopy">Canopy over the roof: usable or not. <b id="bcSureCanopy"></b> One photo from the roof settles it. <button type="button" class="bc-ask" data-limit="canopy">Ask about this</button></li>
      <li data-limit="irradiance">Sunlight from a coarse satellite cell. <b id="bcSureIrr"></b> The ground station inside that cell narrows yield to about ±5%, city-wide. <button type="button" class="bc-ask" data-limit="irradiance">Ask about this</button></li>
      <li data-limit="height">Building height unverified for this roof. A survey or a drone pass fixes it. <button type="button" class="bc-ask" data-limit="height">Ask about this</button></li>
      <li data-limit="validation" id="bcSureValid">Never compared with real rooftops yet. The validation study is under way. <button type="button" class="bc-ask" data-limit="validation">Join the study</button></li>
    </ul>
  </details>
  <button class="bc-brief" id="bcBrief" type="button">Print the installer brief</button>
  ```
  CSS: `.bc-tier` amber pill (`--sun` on dark, `--studio-ink-amber` on Clay); `.bc-sure summary` in the card's `.bc-h` grammar; `.bc-ask` a small text button; keep every new text on Clay ≥ 4.5:1 (the sweep will check).
- [ ] **Step 3: painter.** In `paintSolarCard`: `const r = pvRanges(pv, i)`; `bcSolKwp` → `${r.kwpLow.toFixed(1)}–${r.kwpHigh.toFixed(1)} kWp<small>floor ${r.kwpLow.toFixed(1)} · ${pct(packing)} of roof</small>`; `bcSolKwh` → `${r.kwhLow.toLocaleString()}–${r.kwhHigh.toLocaleString()} kWh/yr<small>about ${Math.round(pv.kwh[i]).toLocaleString()} · screened</small>`; fill `bcSureRoof` = `Capacity ${r.kwpLow.toFixed(1)}–${r.kwpHigh.toFixed(1)} kWp today.`, `bcSureCanopy` = `Shading ${pct(loss)} headline, ${pct(loss_strict)} floor.`, `bcSureIrr` = `Yield ${yLo}–${yHi} kWh per kWp today.`; if `pv.tiers.validated` then `bcSureValid` text = `Compared with ${n} real rooftops over ${months} months: median ratio ${median_ratio.toFixed(2)}, ${Math.round(within*100)}% within 15%.` and hide its button. `mailtoFor(limit)` returns `mailto:ant@deltaclimate.earth?subject=${encodeURIComponent(`Solar assessment · ${areaName()} · #${idx} · ${limit}`)}`; one delegated click handler on `#bcSure` opens it via `location.href`. Register in `cleanup`.
- [ ] **Step 4: e2e.** In `solar-pane.spec.ts` test 3 add: `#bcSolKwp` text matches `/^\d+\.\d–\d+\.\d kWp/`; `#bcSolTier` has text `screened`; `#bcSure li` count 5; clicking `#bcSure` open then reading `.bc-ask[data-limit="roof"]` — assert the handler sets `location.href`? A `mailto:` navigation cannot be observed; instead expose the built href: set `data-href` on each button in the painter and assert it starts with `mailto:ant@deltaclimate.earth?subject=` and contains `%23<idx>`.
- [ ] **Step 5:** build; units; `npm run check`; e2e `solar-pane.spec.ts` + `console-contrast.spec.ts` (the Clay card-open sweep). Commit: `feat(solar): the card leads with the interval, wears its tier, and says what would make it surer`.

### Task 4: the pane and the CSV

**Files:** `HeatMapStage.astro` (pane table header, `#solPaneTier`); `heat-map-app.ts` (`paintSolarPane`, `buildCsv`); `tests/e2e/solar-pane.spec.ts` test 2; `tests/unit/obos-shell.test.mjs`.

- [ ] **Step 1:** unit pin: `buildCsv` header string in the app contains `kwh_low,kwh_high,kwp_high,tier`. e2e test 2: CSV first line equals the 19-column header; the ten-row table has a `range` column.
- [ ] **Step 2:** `paintSolarPane`: the ward block header gets `<span id="solPaneTier" class="bc-tier">screened</span>`; the row table gains a `range` cell `${kwhLow.toLocaleString()}–${kwhHigh.toLocaleString()}`. `buildCsv`: after `kwh_yr` add `kwh_low,kwh_high,kwp_high`, and `tier` (`screened` | `validated`) before `basis`.
- [ ] **Step 3:** build, units, e2e test 2. Commit: `feat(solar): the pane and the CSV carry the ranges and the tier`.

### Task 5: the installer brief

**Files:** `HeatMapStage.astro` (`#solBrief` markup after the card, print CSS); `heat-map-app.ts` (`renderBrief(b, pv)`, `#bcBrief` click → render + `window.print()`); `tests/e2e/solar-pane.spec.ts` (new test 4); `tests/unit/obos-shell.test.mjs`.

- [ ] **Step 1: pins first.** Stage contains `id="solBrief"`, `@media print`, and the six checklist strings from spec §6.5 verbatim (`proposed tilt and orientation`, `module count and DC capacity`, `expected yield against ours`, `shading study`, `net-metering limit`, `monitoring access`). App contains `function renderBrief(`. Run → fails.
- [ ] **Step 2: markup + print CSS.** A `<section class="solbrief" id="solBrief" hidden aria-label="Installer brief">` with slots: `#brWard #brIdx #brLatLon #brDate #brTier`, an inline `<svg id="brOutline" viewBox="0 0 200 200">` for the ring, a `<dl>` with `#brArea #brHeight #brKwp #brKwh #brLoss #brFloor #brRaised #brRs`, the five ladder lines (copied text, `#brSure`), the six checklist items, `#brBasis`. Print CSS: `@media print{ body > *:not(.stage){display:none} .stage > *:not(#solBrief){display:none} #solBrief{display:block;position:static;color:#000;background:#fff;font:11pt/1.4 var(--sans)} }` plus `@page{size:A4;margin:16mm}`. On screen the section stays `hidden`.
- [ ] **Step 3: renderer.** `renderBrief(b, pv)` fills the slots from `pvRanges`, `wardLatLon(w, b.cx, b.cz)`, `formatLatLon`, `b.areaM2`, `b.h`, today's date (`new Date().toISOString().slice(0,10)`), and draws `b.ring` into `#brOutline` as one `<polygon>` scaled to fit 180×180 with a `N` arrow (ward z is south-up: check the sign against the 3D scene, do not assume); the `basis` line verbatim. Money through `fmtMoney`/`fmtRate`. `#bcBrief` click: `renderBrief(selected, pv)`, remove `hidden`, `window.print()`, re-add `hidden` on `afterprint`.
- [ ] **Step 4: e2e test 4.** Select a roof (as test 3), click `#bcBrief` with `window.print` stubbed via `page.addInitScript(() => { window.print = () => { (window as any).__printed = true; }; })`; assert `__printed`, `#solBrief` was un-hidden at print time (poll `hidden` false before `afterprint` — dispatch `afterprint` manually after the assertion), `#brIdx` text is `#${idx}`, the checklist has 6 `li`; then `page.emulateMedia({ media: 'print' })` and assert `#solBrief`'s bounding height ≤ 1050 px (A4 at 96 dpi minus margins) so it fits one page.
- [ ] **Step 5:** build, units, e2e, contrast sweep untouched (the brief is hidden on screen). Commit: `feat(solar): a one-page installer brief, printed by the browser, with the questions a quote must answer`.

### Task 6: the laboratory — predict, then measure

**Files:** Create `scripts/predict-pv-validation.py`, `scripts/measure-pv-validation.py`, `scripts/pv_validation_lib.py` (shared: POWER daily fetch with cache under `data/calibration/power-daily/`, the per-roof model at a stated tilt/azimuth reusing `build-pv-yield.py`'s constants by import, the statistics); Modify `package.json` `test:py` to run both `--self-check`s.

- [ ] **Step 1: self-checks first.** `pv_validation_lib.py` exposes `predict_roof(ghi_daily, t2m_daily, tilt, az, lat, loss) -> float` and `score(preds, measured) -> dict`. Self-check cases: (a) a synthetic roof with constant GHI and zero loss reproduces the chain's specific yield within 1 % when tilt/azimuth match the chain's 22°/180°; (b) `score` on five synthetic roofs with `r_i = [0.9,1.0,1.1,1.2,0.8]` gives median 1.0, within-15 share 0.6, MAPE 0.12, and the `>1.43` capacity flag empty; (c) an owner with 4 months of data is excluded by the `min_months=6` rule, by rule name. Run `python3 scripts/pv_validation_lib.py --self-check` → fails.
- [ ] **Step 2: predict.** `predict-pv-validation.py --roster data/calibration/pv-validation-roster.csv --out data/calibration/pv-validation-predictions.json`: for each roster row, read the ward's browser artefact for `kwp`, `loss`, `loss_strict`; fetch POWER daily for the roof's `months_covered` (cached); write `y_pred` (as built), `y_scr` (22°/180°, the five-year climatology from the artefact's `specific_yield`), `y_null` (ward unshaded), `kwp`, plus `prereg_sha` (git blob hash of the pre-registration file) and the artefacts' sha256. **The script refuses to run if `pv-validation-measured.csv` already exists in the repository** (pre-registration §6.1), overridable only with `--i-know-measured-exists` which is recorded in the output.
- [ ] **Step 3: measure.** `measure-pv-validation.py --predictions … --measured data/calibration/pv-validation-measured.csv --out data/calibration/pv-validation-<date>.json`: applies §4's exclusions by rule name, computes §3 (ratios, median, IQR, MAPE, the 80 %/±15 % pass, the Spearman skill test only at n ≥ 25 else `underpowered`, the capacity ratios and the `>1.43` failures by index), records the predictions file's commit hash, and — only when `n >= 25` — writes `tiers.validated` into the three browser artefacts via `build-pv-yield.py --validated <result.json>` (add that flag).
- [ ] **Step 4:** `npm run typecheck` (mypy strict, both scripts + lib); `npm run test:py` green with the new self-checks. Commit: `feat(solar): predict then measure real rooftops under the pre-registration, offline-checked`.

### Task 7: the paper trail and the gate

**Files:** `docs/evidence/known-limitations.md` (the ladder, §8 solar); `docs/superpowers/specs/2026-09-07-solar-guide-design.md` §7b "recorded during implementation"; memory.

- [ ] **Step 1:** known-limitations gains the five-line ladder as the public statement, with the artefacts' bands and "narrows to" labelled as engineering expectation.
- [ ] **Step 2:** `npm run verify` green locally; CI green after the founder's look on the preview; push as one fast-forward.
