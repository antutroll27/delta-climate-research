# Landsat thermal ingest & validation hardening — implementation plan

**Contract:** [`superpowers/specs/2026-08-02-landsat-thermal-validation-design.md`](superpowers/specs/2026-08-02-landsat-thermal-validation-design.md)
**Date:** 2026-08-02
**Estimate:** ~2 days across six phases, each landing green before the next

Every phase ends with its self-check passing, `npm run verify` green, and a commit.
No phase touches `src/` except P5's new unit test; `accuracy.ts` is not modified in
any phase of this plan — constants move only in a later, human-reviewed PR.

---

## File plan

```
scripts/
  fetch-landsat-lst.py             NEW    P0–P1 · STAC search + ST_B10 ward means
  fetch-met.py                     EXTEND P2 · forcing rows for Landsat scene times
  build-ward-observations.py       EXTEND P3 · sensor field; merge Landsat rows
  measure-accuracy.py              EXTEND P4–P5 · intercomparison, strata, LOO-overpass, CI
  experiment-validation-uncertainty.py  (unchanged — its machinery is PROMOTED, then it
                                         keeps running as an independent cross-check)

data/calibration/
  landsat-ward-lst.json            NEW    P1 · per-scene per-ward LST aggregates (committed)
  met-forcing.csv                  REGEN  P2 · now covers Landsat scene hours
  ward-observations.json/.npz      REGEN  P3 · rows gain sensor
  model-accuracy.json              REGEN  P4–P5 · intercomparison + strata + CI

tests/unit/
  heat-map-validation.test.mjs     NEW    P5 · invariants over the regenerated JSON

~/.cache/delta-climate/
  landsat/                         NEW    P1 · COG windows + STAC pages (never committed)
```

---

## Phase 0 — Probe before building (½ morning)

The spec deliberately leaves three things open: exact MPC asset keys, the `ST_QA`
threshold, and realistic yield. P0 answers the first and brackets the third before any
aggregation code exists.

`fetch-landsat-lst.py --probe`:

1. STAC search, one POST, no client library:

```python
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
SIGN = "https://planetarycomputer.microsoft.com/api/sas/v1/token/landsat-c2-l2"
body = {
    "collections": ["landsat-c2-l2"],
    "bbox": list(_types.ward_bounds(_types.WARDS["ballygunge"], pad_m=2000)),
    "datetime": "2024-01-01T00:00:00Z/..",
    "query": {"platform": {"in": ["landsat-8", "landsat-9"]},
              "landsat:collection_category": {"eq": "T1"},
              "eo:cloud_cover": {"lt": 80}},
    "limit": 100,
}
```
   Follow `next` links until exhausted (the ECOSTRESS lesson: unpaginated search
   silently truncates — `cmr_search pagination` is in the calibration file plan as a
   FIX for exactly this).

2. Print: items per year · platform split · WRS path/row set seen · the **full asset
   key list of the first item**, and hard-fail with that list if none of the expected
   thermal keys (`ST_B10` / `lwir11` / `temperature`) is present. The recorded key
   becomes a named constant in P1 — never a guess.

3. Open ONE signed `ST_B10` COG header with rasterio (`GET {SIGN}` → append token to
   href) and print `crs / res / dtype / nodata`. Proves the read path end-to-end
   before any loop exists.

**Exit criteria:** probe output pasted into the P0 commit message — candidate count by
year (expect ~90–120 pre-QA), asset key confirmed, one successful header read.

---

## Phase 1 — The fetcher (½ day)

Complete `fetch-landsat-lst.py`. Mirrors `ward_lst()` in `build-ward-observations.py`
— same mask-then-aggregate shape, different sensor:

- **Per scene × ward:** window-read `ST_B10`, `QA_PIXEL`, `ST_QA` over
  `_types.ward_bounds(ward)` via `rasterio` + signed href (windows from bounds, the
  `from_bounds` order note in `_types.py` applies).
- **Kelvin:** `ST_B10 * 0.00341802 + 149.0`; usable range gate `(> 200) & (< 400)` K,
  matching the ECOSTRESS gate.
- **Mask (CFMask, Collection 2 QA_PIXEL):**

```python
BAD = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4)   # dilated cloud, cirrus, cloud, shadow
good = np.isfinite(k) & (k > 200) & (k < 400) & ((qa & BAD) == 0)
good &= (st_qa * 0.01) <= ST_QA_MAX_K              # start 2.0; tune ONCE against yield
```
  `ST_QA_MAX_K` is decided in this phase by printing the yield curve at 1.0/1.5/2.0/3.0
  and picking the knee — recorded in the file as a constant with that table in a comment.

- **Aggregate exactly like the ECOSTRESS rows:** `lst_mean_c`, `lst_sd_c`, `cells`,
  `cell_frac` (usable / total in-ward). Usability floor: the ECOSTRESS set drops
  ward-scenes below `MIN_CELLS = 40` of its 21×21 grid
  (`build-ward-observations.py:67`) — an absolute count ≈ 9.1 % of cells, and rows
  down to `cell_frac 0.229` are real in the committed set. Landsat's 30 m grid has
  ~5× the cells over the same ward, so apply the **same fraction**, not the same
  count: `cells ≥ ceil(0.0907 × total_in_ward)`. Weighting downstream stays
  `sqrt(cell_frac)`, unchanged.
- **Row schema** (`data/calibration/landsat-ward-lst.json`):

```json
{"scene_id": "LC09_L2SP_138044_...", "platform": "landsat-9",
 "date": "2025-11-08", "time_utc": "04:41:32Z", "hour_lst": 10.58,
 "ward": "ballygunge", "lst_mean_c": 31.42, "lst_sd_c": 1.87,
 "cells": 1904, "cell_frac": 0.87}
```
  `hour_lst = utc_hour + lon/15`, the `fetch-met.py` TIME BASE convention.

- **Cache** raw window bytes under `~/.cache/delta-climate/landsat/{scene_id}/` so a
  re-run after a SAS-token expiry or 429 resumes instead of refetching; the script is
  idempotent over the committed JSON.
- **Self-check (`--check`)**: every `hour_lst` ∈ [9.5, 11.5] · every mean ∈ (5, 60) °C
  · `cell_frac` ∈ (0, 1] · no duplicate (scene_id, ward) · ≥ 1 scene per calendar year
  covered. Assert-based, in the script, per house rule.

**Exit criteria:** committed JSON with the realized yield table (candidates → after
cloud/QA → after cell_frac) printed by the script and pasted into the commit message.

---

## Phase 2 — Forcing for the new hours (¼ day)

`fetch-met.py` currently joins POWER hourly onto the scene list in
`ecostress-suhii.csv`. Extend its scene source to the union of that CSV and
`landsat-ward-lst.json` dates/hours (one entry per overpass, not per ward-row —
three wards share a pass's forcing). Everything else — cache, LST time base, fill
handling, `_types.MetRow` header contract — is untouched.

Regenerate `data/calibration/met-forcing.csv`. **Self-check:** every Landsat overpass
has a forcing row within the same interpolation tolerance ECOSTRESS scenes get;
scenes without usable forcing are excluded AND counted in the yield table (spec §8).

---

## Phase 3 — One observations file, two sensors (¼ day)

`build-ward-observations.py`:

- Existing ECOSTRESS rows gain `"sensor": "ecostress"`; Landsat rows are appended from
  `landsat-ward-lst.json` + the met join with `"sensor": "landsat"`. `hour` is already
  a column; nothing else changes shape. Consumers that ignore `sensor`
  (`fit-ward-scale.py load_rows`) keep working untouched — verify by running it.
- **Backfill check (spec §4):** print the 13 excluded ECOSTRESS scenes
  (`fitted-constants.json .excluded`) with their hours; flag any within ±1 h of a
  Landsat overpass as cross-sensor pairs for P4. Print-only — no silent re-inclusion.

Regenerate `ward-observations.json` + `.npz`. **Self-check:** row count = old count +
new Landsat ward-scenes; per-sensor counts printed; `python3 scripts/fit-ward-scale.py`
still runs to completion on the widened file (its verdict may change — that is P5's
business, not P3's; P3 only proves nothing broke).

---

## Phase 4 — The intercomparison gate (¼ day)

Before any pooled statistic exists, measure the sensor offset. In
`measure-accuracy.py`:

- Day rows only, candidate-A constants (frozen — this is a measurement, not a refit):
  per-sensor mean residual `predict − lst`, plus the paired comparison on any P3
  cross-sensor pairs.
- Write to `model-accuracy.json`:

```json
"intercomparison": {"day_offset_K": {"ecostress": 2.04, "landsat": null},
                    "delta_K": null, "n_pairs": 0, "pooling": "allowed" | "blocked"}
```
- `|delta_K| > 1.0` → `"pooling": "blocked"`, and P5 computes Landsat strata
  **separately only** — the run still succeeds, the flag is the output. Per spec §8
  a blocked pooling is still a publishable result, not a failure.

---

## Phase 5 — Publish uncertainty, honestly (½ day)

`measure-accuracy.py` grows the machinery proven in
`experiment-validation-uncertainty.py` (promote the code, keep the experiment script
as an independent cross-check that must agree):

- **Strata:** `peak` (ECOSTRESS ≥ 12:00) · `morning` (Landsat ~10:30) · `night` ·
  `day_pooled` (only if the P4 gate allows). Per stratum:
  `{n_scenes, n_overpasses, rmse_K, bias_K, loo_overpass_rmse_K, ci95_K: [lo, hi]}`.
- **LOO-overpass** is the only split computed. Scene- and ward-level splits exist in
  the experiment script for the leakage demonstration; the published file carries the
  honest number only.
- **Bootstrap:** 4000 resamples over overpasses, seeded (`default_rng(7)`), so the
  committed JSON is reproducible byte-for-byte.

`tests/unit/heat-map-validation.test.mjs` (node:test, reads the committed JSON):

- strata `n_scenes` sum to the total; `n_overpasses ≤ n_scenes`
- `ci95[0] ≤ rmse ≤ ci95[1]` for every stratum
- `intercomparison.pooling === "blocked"` ⇒ no `day_pooled` stratum present
- `morning` never contributes to `peak` (assert on the recorded per-stratum hours)
- bootstrap seed recorded and equal to 7 (a silent seed change breaks reproducibility)

**Exit criteria:** `npm run test:unit` green including the new file; the experiment
script re-run agrees with the published LOO-overpass figures to 0.01 K.

---

## Phase 6 — Close-out (¼ day)

- Yield table (candidates → T1/cloud prefilter → QA → cell_frac → with-forcing) into
  the spec's §9 acceptance block, replacing the 35–55 estimate with the measured count.
- `docs/heat-map-feature.md` validation-status section: one line with the realized n
  and the new CI half-widths.
- Acceptance sweep against spec §9, item by item, in the closing commit message.
- If day CI half-width lands ≤ ±1.1 K: note that the **night-regression shipping
  decision** (spec §7.1) and the **ERA5-Land probe** (§7.2) are now unblocked, each
  needing its own spec. Do not start either here.

---

## What could go wrong

- **MPC throttling / SAS expiry mid-sweep** — the P1 cache is the mitigation; the
  sweep resumes. Backoff on 429, and the probe (P0) validates auth before the loop
  exists.
- **Asset keys differ from every expected name** — P0 fails loudly with the real list;
  the constant is set from evidence, and the USGS fallback in spec §3 is the plan B.
- **Monsoon yield lands under 30 overpasses** — acceptance already covers this: ship
  what landed plus the yield table; the CI target is conditional on realized n.
- **Cross-sensor offset > 1 K** — the P4 gate blocks pooling by design; strata publish
  separately and the campaign still delivers the independent-instrument result.
- **`fit-ward-scale.py` verdicts change under the widened file** — expected and out of
  scope: refits stay `ship: false` until their own reviewed PR (spec §5.3). P3 only
  guarantees the script still runs.
- **POWER gaps at 10:30 LST** — same exclusion rule as ECOSTRESS; excluded scenes are
  counted, never interpolated past tolerance.

## Sequencing rule

P0 → P1 → P2 → P3 are strictly ordered (each consumes the last's artefact). P4 and P5
both need P3 but are independent of each other; land P4 first anyway — its gate decides
whether P5 computes a pooled stratum at all. P6 last. One commit per phase, every
commit `npm run verify` green, no `src/` changes outside the P5 test, no `accuracy.ts`
changes anywhere in this plan.
