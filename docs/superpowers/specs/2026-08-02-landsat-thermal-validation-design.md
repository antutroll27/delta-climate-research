# Landsat thermal ingest & validation hardening — specification

**Status:** approved for design 2026-08-02 · implementation not started
**Evidence:** `scripts/experiment-validation-uncertainty.py` (committed; every number
below regenerates from `data/calibration/*`)
**Predecessor:** `docs/heat-map-calibration-spec.md` (the ECOSTRESS campaign this extends)

---

## 1 · Why

The published accuracy figures rest on too few satellite passes to defend under audit,
and the 2026-08-02 experiments showed that our validation protocol itself had a leak.

### What the measurements say

Bootstrap over overpasses (not ward-scenes — three wards seen on one pass are not three
independent facts):

| phase | published | 95 % CI on that figure | overpasses |
|---|---|---|---|
| night | 2.93 K | 1.90 – 3.64 K (±0.87) | 20 |
| peak  | 4.42 K | **2.91 – 6.65 K (±1.87)** | **12** |

The daytime error bar is uncertain by nearly ±2 K. We publish ±4.5 while the evidence
admits anything from "better than claimed" to "half again worse". For a product whose
value is defensibility, the sample size is the weakest link — not the model.

Tripling daytime overpasses halves the CI (±1.87 → ±1.08). That is arithmetic, not a
hypothesis, which is what makes this campaign the highest-certainty accuracy work
available.

### The protocol finding (binding on all future work)

The same statistical correction was scored under three cross-validation splits:

| split | day weather-regression RMSE |
|---|---|
| leave-one-scene-out | 3.12 K |
| leave-one-ward-out  | 2.84 K |
| **leave-one-overpass-out** | **4.67 K — no gain whatsoever** |

Each pass covers all three wards, so scene- and ward-level splits let the fit see the
held-out row's weather through its siblings. The apparent 1.5 K daytime win was
leakage. **Rule: every correction, refit or structure change is judged at
leave-one-overpass-out level or not at all.** This joins the ruled-out list alongside
the storage term and water-limited ET (`heat-map-calibration-spec.md` §1).

What did survive, at overpass level:

- night weather-regression: 2.81 → 2.31 K (6-term) / 2.14 K (3-term). Real, at or near
  the 2.233 K forcing ceiling — but term count is itself a fitted choice, so shipping
  it needs its own pre-registered protocol (§7, phase 2 — not this spec).
- day: nothing. Constant offset 4.50 K, regression 4.67 K. The daytime residual is not
  predictable from POWER forcing. Do not retry statistics on it; it needs data.

---

## 2 · What this campaign is

Add **Landsat 8/9 Collection 2 Level-2 surface temperature** as a second thermal
source over the same three wards, then republish accuracy with confidence intervals
under the corrected protocol.

Landsat contributes **daytime only** (~10:30 local solar descending; night acquisitions
over India are not routine). That is the right shape: day is where n = 12 hurts.
Night grows only with time as the ECOSTRESS archive accumulates — say so, don't fake it.

Yield estimate, to be replaced by the measured count: L8+L9 combined ≈ 8-day revisit;
2024-01 → 2026-08 ≈ 118 candidate passes over path 138 / row 44; Kolkata monsoon
(Jun–Sep) removes most of its months; expect **35–55 usable daytime overpasses**
against today's 12, i.e. 3–4×.

### What Landsat also buys

- **An independent instrument.** ECOSTRESS agreeing with the model is one claim; two
  sensors with different retrieval physics agreeing is much harder to dismiss.
- **A third diurnal regime.** 10:30 sits on the heating flank, between the current
  13:00 and 22:00 samples — it constrains the day structure rather than resampling
  the same hour.
- **The scaling precondition.** An observed-LST layer for uncalibrated wards
  (Kolkata-144, Delhi) needs exactly this ingest; the browser work is out of scope
  here but the acquisition is shared.

---

## 3 · Access path

**Primary: Microsoft Planetary Computer STAC** (`landsat-c2-l2` collection).
Free, anonymous search; assets are COGs read by HTTP range with a short-lived SAS
token from the public signing endpoint. Matches the pipeline's existing shape —
`_sentinel.py` already does STAC + remote COG windows, and rasterio is already the
reader. Plain `requests` + `rasterio`; **no new Python dependencies** (`pystac-client`
not needed for one collection and a bbox).

**Fallback: USGS M2M / landsatlook STAC.** Official but heavier (registration,
requester-pays S3 for bulk). Only if MPC proves unreliable.

Scene filter: platform ∈ {landsat-8, landsat-9} · collection category T1 only
(T2 georegistration is not trusted) · `eo:cloud_cover < 80` as a loose prefilter —
per-ward QA decides usability, exactly as ECOSTRESS scenes are judged per ward.

Bands: `ST_B10` (Kelvin = DN × 0.00341802 + 149.0), `QA_PIXEL` (CFMask bits:
dilated cloud 1, cirrus 2, cloud 3, shadow 4), `ST_QA` (retrieval uncertainty,
Kelvin × 0.01). Exact MPC asset keys confirmed at implementation — the catalogue
has renamed thermal assets before; the script must fail loudly on a missing key,
not guess.

---

## 4 · Pipeline changes

New: `scripts/fetch-landsat-lst.py`
: STAC search → per scene, per ward: window-read `ST_B10`/`QA_PIXEL`/`ST_QA` over the
  ward bbox (`_types.py ward_bounds`), mask (CFMask clear + `ST_QA` ≤ threshold chosen
  against yield at implementation), aggregate to `lst_mean_c`, `lst_sd_c`, `cells`,
  `cell_frac`. Cache granule windows under `~/.cache/delta-climate/` like every other
  fetcher. Idempotent; UTC scene time → local solar hour via lon/15 (the
  `fetch-met.py` convention).

Extended: `scripts/build-ward-observations.py`
: rows gain `sensor: "ecostress" | "landsat"` and keep `hour`. Additive — existing
  consumers ignore unknown keys. **Backfill check:** the 13 excluded ECOSTRESS scenes
  (`fitted-constants.json .excluded`) include off-hour passes; any near 10:30 become
  direct cross-sensor comparison pairs and must be inspected before pooling.

Extended: `scripts/fetch-met.py`
: same POWER join, now also over Landsat scene datetimes. No structural change.

Extended: `scripts/measure-accuracy.py`
: output gains, per phase **and per stratum** (peak-13:00 / morning-10:30 / night;
  by sensor and pooled): n-overpasses, RMSE, bias, **LOO-overpass RMSE**, and
  **bootstrap 95 % CI over overpasses** (the §1 machinery, promoted from the
  experiment script into the published record at
  `data/calibration/model-accuracy.json`).

New: `tests/unit/heat-map-validation.test.mjs`
: invariants on the regenerated JSON — pooled n equals the sum of strata; every
  published band ≥ its measured RMSE; CI bounds bracket the point estimate; the
  LOO-overpass figure is present for any stratum that claims a correction.

---

## 5 · Phase & intercalibration rules (defined before fetching)

1. **10:30 is not 13:00.** Landsat rows enter the fit as day observations at their
   true hour and sun factor; the model equation already takes both. They are never
   pooled into the *published* "peak" figure: the product's 13:00 view keeps a
   13:00-scene validation. Reported figures: `peak` (ECOSTRESS 13:00), `morning`
   (Landsat 10:30), and `day-pooled` — three numbers, no blending.
2. **Sensors get an intercomparison before they get pooled.** Fit a per-sensor
   intercept on day rows; record it in `model-accuracy.json`. If |offset| > 1 K,
   pooling stops pending diagnosis (emissivity treatment differs: TES vs single-band
   ASTER-GED — a systematic gap is plausible and must be measured, not absorbed).
3. **Refits under the new data follow the existing gate:** written to
   `ward-scale-fit.json` with `"ship": false`, constants enter
   `accuracy.ts` / `DEFAULT_PARAMS` only through a reviewed PR after a human has
   read the out-of-sample column. Unchanged from current practice.

---

## 6 · What does NOT change

- The browser app, sim, shaders, UI — nothing in `src/` in this campaign.
- The published `accuracy.ts` constants, until re-measured and human-reviewed.
- The honesty apparatus; if anything it gains the CI as future display material.
- The Python-stays rule: this is Python acquisition work; the parked Go plan is
  unaffected.
- No new npm or pip dependencies.

## 7 · Follow-ups this unblocks (each needs its own spec)

1. **Night weather-regression shipping decision** — pre-registered term count,
   LOO-overpass acceptance bar, and how the card's confidence copy changes.
2. **ERA5-Land ceiling probe** — refetch forcing for the (now ~4×) overpass set,
   recompute the ceiling; adopt only if it drops below the current 3.34 K by more
   than the new CI half-width.
3. **Observed-LST browser layer** — the product face of this acquisition.
4. **Per-ward accuracy** — the guardrail before any fourth ward ships a heat field.

## 8 · Risks

- **MPC asset naming / availability drift** — fail loudly, fallback documented (§3).
- **Monsoon yield below estimate** — the CI target (§9) is conditional on realized n;
  report whatever n lands, never pad with T2 or cloudy scenes to hit a count.
- **Cross-sensor offset > 1 K** — §5.2 stops pooling; the campaign still delivers the
  independent-instrument comparison, which is publishable on its own.
- **POWER hourly gaps at Landsat times** — same interpolation rules as ECOSTRESS
  scenes; scenes without usable forcing are excluded and counted, not patched.

## 9 · Acceptance

- `fetch-landsat-lst.py` committed, cached, idempotent; ward-observations regenerated
  with `sensor`, ≥ 30 total daytime overpasses (else: ship what landed + the measured
  yield table and revisit the target)
- Cross-sensor intercomparison table in `model-accuracy.json`, |offset| recorded
- `measure-accuracy.py` emits stratified RMSE + LOO-overpass + bootstrap CI;
  `heat-map-validation.test.mjs` green over the regenerated artefacts
- Daytime CI half-width ≤ **±1.1 K** at realized n (vs ±1.87 today), or the shortfall
  explained by the yield table
- `accuracy.ts` untouched in this campaign's PRs; any constant change arrives as its
  own reviewed diff
- `npm run verify` green; publication contract unchanged
