# Canopy source upgrade: Meta/WRI CHM v1 → v2 — design

**Date:** 2026-08-12 · **Status:** approved (CEO, 2026-08-12) · **Wards:** all three

## Context

The vegetation layer's canopy heights come from the Meta/WRI Global Canopy Height Model. We ship **v1**
(`forests/v1/alsgedi_global_v6_float`). **v2 shipped in March 2026** and we are a generation behind on
the primary input to a feature whose pitch is provenance.

**v2 is measurably better here, not just newer-labelled.** Verified in this repo rather than taken from
the paper:

| check | v1 | v2 |
|---|---|---|
| disagreement with ETH (independent), ballygunge | 5.59 m | **3.35 m** |
| " barrackpore | 7.36 m | **5.30 m** |
| " baruipur | 6.29 m | **4.44 m** |
| spatial correlation with ETH | 0.48–0.55 | 0.47–0.55 (flat) |

v2 cuts absolute disagreement **30–40% in every ward** against a product independent of both. Correlation
is unchanged — so **v2 is better at *how tall*, not at *where***. That distinction should survive into the
receipts; it is the honest characterisation.

Published support: Brandt et al., *Scientific Data* (arXiv:2603.06382) — DINOv3 backbone, **R² 0.53 → 0.86,
MAE 4.3 → 3.0 m**, the ≥30 m saturation largely removed. CC BY 4.0.

**v2 is NOT fresher data.** ~80% of its source imagery is the same 2018–2020 epoch as v1. It is a *model*
upgrade. Nothing we publish may describe it as newer observations.

## Decisions

1. **Switch the canopy source to CHM v2.**
2. **Re-pin `DENSITY_REF_H` from 22 m to 30 m.**
3. **The look changes** — roughly +37% trees — and that is accepted (CEO viewed the before/after preview).
4. **No user-facing toggle between density references.** They are one measurement at three display
   settings, not three measurements; offering a choice would dress a cosmetic knob as a scientific one.

### Why 30 m, specifically

`DENSITY_REF_H` is the canopy height at which a cell renders `DENSITY_MAX` (4) trees. It was 22 m because
that was **v1's** Ballygunge maximum. The successor by the same rule is v2's maximum — which is **30.0 m,
and is simultaneously the tallest canopy measured anywhere across all three wards**.

That makes it a rule rather than a tuned constant: *the density scale spans exactly the range of canopy we
measured.* Measured consequence — at 30 m the `min(DENSITY_MAX, …)` cap **never fires** (0 clipped cells in
all three wards); at 22 m it clips 13 cells, so the scale saturates before the data does.

The rejected alternative was a "matched" reference (~40 m) that reproduces the previously-approved tree
count. It was rejected because the number exists only to preserve a look derived from a **v1 artefact** —
indefensible in a receipt.

## What changes

### `scripts/fetch-canopy.py`

| | v1 (current) | v2 (target) |
|---|---|---|
| prefix | `forests/v1/alsgedi_global_v6_float` | `forests/v2/global/dinov3_global_chm_v2_ml3` |
| quadkey zoom | 9 | **10** |
| tile layout | non-tiled 65536² monolith | **proper COG**, 512² blocks + overviews |
| dtype | float32 | **uint8** (metres, 1 m quantised) |
| CRS | EPSG:3857 | EPSG:3857 (unchanged) |
| nodata | — | none declared |

- `CHM_ZOOM` becomes 10; `_quadkey` is already parameterised, so no algorithm change.
- `DENSITY_REF_H = 30.0`, with the "spans the measured range, clips nothing" rationale in the comment.
- **The COG layout is a free win** — windowed reads get faster, and the module docstring's claim that "a
  windowed rasterio read is the only affordable access pattern" (true of v1's monolith) must be updated.
- **uint8 quantisation is acceptable and must be stated:** heights arrive as whole metres. v2's own MAE is
  3.0 m, so 1 m quantisation is far inside the error and changes nothing material — but the docstring
  should say so rather than leave a reader to notice `uint8` and wonder.

### Artifacts

Regenerate `{ward}-canopy.png` and `{ward}-trees.json` for all three wards. Expected counts (measured):
**ballygunge 12,159 / barrackpore 6,811 / baruipur 8,415.** Byte-stability must hold as before.

### Receipts (`scripts/build-provenance-manifest.py`)

The canopy lineage must name v2, its version, and honestly characterise the change:
- source is the v2 DINOv3 model, CC BY 4.0;
- **a model upgrade on the same 2018–2020 imagery, not fresher observations**;
- the density reference is 30 m and is a **display scaling, not a measurement**.

### Accuracy

`veg[]` feeds the physics through the existing mean-neutral blend, so ward-mean vegetation is governed and
should not move. **Re-run the accuracy check and confirm no regression** against the shipped night ±3.5 K /
day ±5.0 K. If it moves materially, stop and report — do not absorb it silently.

## Non-goals

- **No physics changes.** The mean-neutral canopy blend and the governed ward scalar are untouched.
- **No Phase-B work** (exclusion mask, parks prior, ETH gate, crown detection) — still parked. Worth
  recording though: **v2's own authors instruct users to "mask non-vegetated areas … using an independent
  land cover map."** v1 carried no such instruction. So the upgrade does not merely leave Phase-B B1
  desirable, it makes it the documented usage of the product we are adopting — and we already ship the
  footprints/roads/water needed for it. Measured today, ~30% of shipped trees stand on rooftops or in
  roads. That strengthens B1's case; it does not change this task's scope.
- **No ETH integration.** Measured and documented in `docs/evidence/data-sources.md`; it cannot arbitrate
  1 m heights in a dense city (blind over ~72% of the ward by WorldCover built-up mask).
- **No v1 removal from history** — v1 remains reachable in git for the deferred item below.

## Deferred, with the trigger

**v1 ↔ v2 as an uncertainty exhibit.** Two independently-trained models disagreeing by 1.7–1.9× on ward
mean is real epistemic uncertainty, and it is free — both rasters already exist. The WETEX framing writes
itself: *one model generation moved the canopy estimate ~80%; ground-truth lidar is what closes the rest.*

Not built now because (a) it doubles the tree payload, which already stands at ~996 KB cold-boot with no
loader, so it would need on-demand loading, and (b) it must be labelled **model** uncertainty, not sensor
uncertainty — same team, same imagery, so it is a lower bound on true error, not a confidence interval.

**Trigger:** the WETEX demo, or any funding conversation where the tier gap is the ask.

## Verification

- `python3 -m mypy` clean; `fetch-canopy.py --self-test` and `--check` pass (the self-test's arithmetic
  expectations change with `DENSITY_REF_H` — recompute, do not fudge).
- Build twice → all six artifacts byte-identical.
- Counts land at 12,159 / 6,811 / 8,415; anything else is a stop.
- `npm run verify` exits 0 (astro check, mypy, test:py, 323 unit tests, build, publication contract, e2e).
- Accuracy unregressed vs night ±3.5 K / day ±5.0 K.
- Visual confirmation on `/heat-map` for all three wards before pushing.
