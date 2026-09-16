# Bengaluru resilience score (DC-URS): design

**Date:** 2026-09-14 · **Branch:** `feat/bangalore-wards` · **Status:** design approved section by section; spec awaiting review

## The ask

The three Bengaluru wards (Indiranagar, MG Road, Whitefield) show "resilience inputs unavailable" where Kolkata shows a DC-URS score. There are two causes:

- Bengaluru's city entry sets `dcUrs: null` (`scope/registry.ts`).
- Every script that produces DC-URS inputs iterates Kolkata's `_types.WARDS`.

The score's formula runs in the browser (`dc-urs.ts`) and needs no change. Only the inputs are missing.

Kolkata's score has measured defects (`docs/dc-urs-diagnosis.md`):

- Population density supplies 62 % of ward discrimination.
- The thermal pillar supplies 0 %, because its surface temperatures are bbox-wide.
- The heat-island term is a difference of medians, taken over different days.

This design gives Bengaluru per-ward inputs that do not repeat those defects.

## Decisions (settled with the founder, 2026-09-14)

| # | Decision | Why |
|---|---|---|
| 1 | **Bengaluru only, fixed inputs.** Kolkata's live scores and scripts are untouched. | Changing Kolkata's scores needs its own sign-off. The two cities briefly use different temperature methods. |
| 2 | **Kolkata's fixed anchors, then measure.** No anchor changes now. The exporter reports which Bengaluru terms clamp. | Keeps "a 60 means the same in both cities" until evidence says otherwise. |
| 3 | **An unmeasured input is shown, not hidden.** It sits at its optimistic endpoint, and the confidence chip states the looseness. | This is the existing `unmeasured()` mechanism, already used for Kolkata. |
| 4 | **Code lives in Bengaluru's own pipeline** (`fetch-bangalore.py`, `export-bangalore-obos.py`), reusing shared satellite code. | Guarantees Kolkata cannot move. Known cost: the two pipelines can drift. |
| 5 | **Heat vulnerability is unmeasured for now.** The founder will seek written permission for the Census ward tables. | No commercially clear open source can tell the three wards apart (§3). |

Standing constraints:

- Open data only; never Google Earth.
- Every source must permit commercial consultancy use.
- All `.py` passes strict mypy.

## 1. Shape and inputs

**Flow.**

1. New layers in `fetch-bangalore.py` measure each input per ward into `data/bangalore/`.
2. `export-bangalore-obos.py` writes one Bengaluru inputs file in Kolkata's record shape: `{value, source, vintage, cite}` per field.
3. The Bengaluru city entry's `dcUrs` points at that file.
4. `dc-urs.ts` scores it unchanged, with Kolkata's anchors.

| Input | Bengaluru source | Notes |
|---|---|---|
| `lstDayC`, `lstNightC` | ECOSTRESS L2T LSTE v002, per ward | §2 |
| `ruralBaseC` | ECOSTRESS over GHS-SMOD rural classes near Bengaluru (CC BY 4.0) | §2 |
| `popDensity` | **WorldPop R2025A constrained, 2025, 100 m (CC BY 4.0)**: people in EXACTLY the 2.8 km box (edge pixels weighted by the fraction inside) ÷ 7.84 km², labelled `modelled` | Amended 2026-09-15 (see "Amendment: population source" below). GHS-POP was the original choice and failed a Census 2011 check. |
| `far` | The committed ward buildings, with Bengaluru's fitted storey height of 3.33 m (Kolkata: 3.2 m) | Data already in hand |
| `fvc`, `albedo` | Sentinel-2. Ward means already exist in `public/heat-map/data/surface-meta.json` | The plan first checks they match Kolkata's method (FVC endmembers, 2021–2025 per-year medians); otherwise recompute |
| `ndviMean`, `ndviStd` | The same Sentinel-2 composites, per ward | New |
| `distCoolM` | ESA WorldCover 2021, 10 m (CC BY 4.0), Bengaluru's 3° tile; same refuge classes and the 0.77 ha design threshold | The tile is confirmed in the plan |
| `socioVuln` | **Unmeasured** (placeholder) | §3 |
| `canopyFrac` | Inert, as in Kolkata (weight 0) | No change |

## 2. Surface temperature and the heat-island term

**Instrument.** ECOSTRESS L2T LSTE v002 at 70 m, via CMR and LP DAAC (US public domain), for both day and night, 2018 to present.

- Landsat has no night pass, so one instrument keeps day and night consistent.
- `_ecostress.py` already takes any bbox and derives UTM 43N.
- A 2.8 km ward is about 40×40 pixels (a Kolkata ward is about 20×20).

**Scene filter (as Kolkata's).**

- Near-nadir only (`view_delta ≤ 0.75`).
- `cloud.tif` cloud mask.
- QC mandatory bits.
- Water masked.
- A ward counts in a scene only if at least 10 % of its pixels are clear. This matches Kolkata's per-ward ECOSTRESS rule of 40 usable pixels out of about 400 (`build-ward-observations.py`).

**Shared scenes (fixes the ranking flip).**

- Only scenes in which all three wards are clear at once are used.
- Each ward's day and night temperature is the median over that shared set.
- Values stay absolute °C, as the fixed anchors require, and every ward is compared on the same days.
- Unpaired aggregation reversed Kolkata's hot-season ranking (`dc-urs-diagnosis.md`).

**Heat-island term.**

- Per scene, compute `ward mean − rural mean`. The rural reference is GHS-SMOD rural classes {11, 12, 13} around Bengaluru, water excluded; the GHS-SMOD tile is confirmed in the plan.
- The heat island is the **median of those per-scene differences**, never the difference of medians.
- `dc-urs.ts` computes `max(0, lstDayC − ruralBaseC)`. The exporter therefore writes `ruralBaseC = lstDayC − median(differences)`, an *effective* baseline, so the browser reproduces the correct heat island with no formula change. The field's `cite` says so explicitly.

**Pre-registered gates, set before any data is fetched.**

- **Minimum scenes.** A phase needs ≥ 8 shared clear scenes. Below that, its fields ship as `placeholder` at their optimistic endpoint (decision 3), and the chip counts them.
- **Night heat-island sanity check.** A night heat island above 2.5 °C is treated as a processing error and stops the export. The ECOSTRESS access recipe records 0.85–1.5 °C as published for Kolkata.
- **Anchor report.** The exporter prints every Bengaluru term that clamps against Kolkata's anchors. The night floor of 20 °C is the likely one; Bengaluru's IMD night normals are 16.1–22.1 °C.

## 3. Heat vulnerability: unmeasured

`socioVuln` ships as `source: 'placeholder'` at its optimistic endpoint, with no vulnerability.

- `unmeasured()` counts its full weight: up to **8.75 points** of 100.
- The chip note names it. Ward ranking is unaffected because the shift applies to all three.

**Why no source fills it (verified 2026-09-14; details in the evidence docs):**

- **District or constituency data.** All three wards are in Bengaluru Urban district and Bangalore Central, so values would be identical.
- **WorldPop R2025A age/sex (CC BY 4.0).** Age structure for India is spread from **state-level** inputs (admin level 1).
  - Every Karnataka pixel reads 65+ = 8.024 %, under-5 = 6.673 %. This was measured for the three wards and a Mysuru control.
  - It cannot discriminate the wards, and it is not Bengaluru's own age mix.
- **Census 2011 ward tables.** These would discriminate: under-6, roof material, one-room homes, assets.
  - The ward PCA sits in the Census catalogue marked "All Rights Reserved".
  - The houselisting percentages exist only as OpenCity copies with uploader-set labels.
  - No GODL ward-level copy was found, so the tables are not cleared for commercial use.
- **Ruled out:**
  - Relative Wealth Index (CC BY-NC).
  - Meta HRSL India 2026 (HDX caveat bars commercial use).
  - KSDB slum pages (republication needs permission).
  - Slum-point layers with no named publisher.

**Follow-up, not code.** A written request to the Office of the Registrar General (ORGI) for commercial use of the 2011 BBMP ward PCA and houselisting tables.

- If granted, a later change fills `socioVuln` with population-weighted ward values: Kolkata's four components and ceilings, with a spatial overlay of the 198-ward boundaries onto each box.
- The placeholder then disappears on its own.

## 4. Screen, sliders, registry, tests, docs

**Registry and served file.**

- Bengaluru's `dcUrs` points at its own inputs file.
- The served copy must match the committed copy byte for byte. This extends the check `verify-served-data.mjs` already applies to Kolkata.

**Screen.**

- No new UI. Bengaluru wards show the score, tier, three pillars and confidence chip in the existing Intervention pane.

**Sliders.**

- `dc-urs-scenario.ts` sizes its gains "over a 1400 m ward".
- Gains scale by ward area, `(1400 / sizeM)²`: 0.25 for Bengaluru's 2800 m wards, 1 for Kolkata, which is therefore unchanged.
  - **Superseded 2026-09-16.** Only the **parks** gain scales by area. Trees, cool roofs and facades are a share of the ward — which is how `applyInterventions` and `computeCost` already read them — so their index gains are not scaled. Kolkata is unchanged under either rule. See `docs/dc-urs-spec.md` §"Sliders".

**Tests.** Every new test or gate is proven able to fail once, by breaking what it guards.

1. **Shared-scene ranking.** A synthetic fixture in which unpaired aggregation reverses the ward ranking. The shared-scene method returns the correct order, and the unpaired method fails the same assertion.
2. **Heat island.** The median of differences versus the difference of medians, on a fixture where they disagree.
3. **Gates.** Below 8 shared scenes, the fields are `placeholder`. A night heat island above 2.5 °C refuses to export.
4. **Formula self-checks.** `assertDcUrsLogic()` and `assertScenarioLogic()` exist but are called from nowhere. They are wired into the unit suite.
5. **Artefact.** Each Bengaluru ward carries all 12 fields with provenance and in-range values, and `socioVuln` is `placeholder`. Kolkata's `dc-urs-inputs.json` stays byte-identical.
6. **Slider scaling.** Bengaluru gains are exactly 0.25× Kolkata's, and Kolkata's scenario output is unchanged.
7. **Registry.** `cityPaths` for Bengaluru returns a non-null `dcUrs` URL.
8. **Browser.** A Bengaluru ward shows a numeric score and the confidence chip, not "resilience inputs unavailable".

**Docs.**

- `docs/evidence/data-sources.md`: Bengaluru ECOSTRESS, GHS-POP, GHS-SMOD and WorldCover tiles, and the WorldPop finding.
- `docs/evidence/known-limitations.md`: `socioVuln` unmeasured and why; the anchor report; the effective-baseline construction.
- A Bengaluru section in the DC-URS documentation.

## Acceptance

1. The three Bengaluru wards show a DC-URS score on `/heat-map/in/bengaluru/*`.
2. Their thermal fields come from shared ECOSTRESS scenes, or are `placeholder` with the gate recorded.
3. The heat island is the median of per-scene differences.
4. `socioVuln` is `placeholder`, and the chip states up to 8.75 points (plus any gated thermal fields).
5. The anchor report is printed and recorded in `known-limitations.md`.
6. Kolkata's served inputs, scores and scenario output are byte-identical to before.
7. `npm run check`, `npm run typecheck`, `npm run test:unit`, `npm run test:py` and the Bengaluru artefact checks all pass.

## Out of scope

- Changing Kolkata's inputs or fixing its heat-island bug.
- Changing anchors or weights.
- The AR5 ward-risk redesign (`2026-09-08-ward-risk-score-design.md`).
- Any water or flood dimension.
- The "IPCC AR6 framing" tooltip claim, already flagged as inaccurate in the diagnosis.

## Amendment: population source (2026-09-15, measured)

The first `dcurs-static` run gave Whitefield 625 people/km² from GHS-POP, far below the 5,000 sanity floor. Both grids were then checked against Census 2011 across all 198 BBMP wards (PCA totals 8,443,675, joined to the DataMeet 198-ward boundaries). The census is used for this check only and never enters the score.

**GHS-POP R2023A is unfit for Bengaluru, in both epochs.**
- 64 contiguous south-east wards held 3.01 M people in 2011; GHS-POP E2010 gives them 0.29 M.
- Its correlation with census ward population, log(pop), is −0.03. That is worse than assuming uniform density.
- Whitefield comes out at about 0.1× the census and MG Road at about 3×.
- Unconstrained WorldPop 2011 shows the same artefact.

**Constrained WorldPop R2025A is the only grid that beats the uniform baseline.**
- Log(pop) correlation 0.595; mean absolute log error 0.64 against 0.88 for uniform density.
- It is still too flat: about 0.34× the census in wards within 7 km of the centre, and about 1.7× in Mahadevapura.

**Decision (founder, 2026-09-15).**
- Bengaluru uses constrained WorldPop, 2025, labelled `modelled`.
- Its flattening bias is recorded in `known-limitations.md`: it probably understates MG Road and Indiranagar.

**Method fix.** The original density sum (copied from Kolkata's `fetch-worldpop.py`) totalled every pixel in the projected envelope of the box but divided by the nominal box area. That inflated density (Indiranagar 20,028 against 16,026 over the exact box). Bengaluru now sums exactly the box. Kolkata's live `popDensity` very likely carries the same inflation. It is recorded, and not changed here, because changing it moves Kolkata's scores.

## Risks

- **ECOSTRESS yield is unknown.** The Bengaluru wards spec counts 214 overpasses as an upper bound, with no cloud metadata in CMR. Monsoon months will contribute little. The 8-scene gate turns a thin yield into an honest `placeholder`, not a weak number.
- **Density still dominates.** With vulnerability unmeasured and anchors borrowed, population density may still dominate Bengaluru's ranking. The anchor report shows how much, and that is the evidence for any later anchor decision.
- **Pipeline drift.** Bengaluru's and Kolkata's DC-URS inputs now come from different code; decision 4 accepts this.
- **Unrelated CI failure.** PR #29's CI failure (`solar-pane.spec.ts:167`) is separate from this work and is tracked there.
