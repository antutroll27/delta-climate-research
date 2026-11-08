# Kolkata night accuracy figure: the lab now scores the model the page runs (2026-11-08)

**What moved.** The published Kolkata night figure (50 ward-scenes, 20 ECOSTRESS overpasses) changed from
RMSE 2.662 K / bias +0.41 K / leave-one-overpass-out 2.777 K to **RMSE 2.683 K / bias +0.32 K / leave-one-overpass-out
2.812 K**. The ±3.0 K band is unchanged: it is the smallest half-kelvin step that covers both errors
(`ceil(2.812 × 2) / 2`), and 2.812 K leaves 0.19 K to spare.

**Why.** Nothing in the model changed. The scorer did.

- The page's night evaporation taper, `nightLatent` in `heat-map-model.ts`, is evaluated on a fixed reference cell:
  `eqCell(dry, 0.18, 0.6, 0)`, which reduces to `(store + pull) / k` (no sun, no built heat, no ET).
- The Python scorer (`scripts/_physics.py`, `fit-ward-scale.py`) evaluated the taper on `(Q·built + pull) / k` and left
  the night store out. The two reference cells differ by up to 0.37 K on the Kolkata and Amsterdam rows, enough to move
  the taper on humid nights.
- `_physics.night_latent()` is now the single Python definition of the TS expression, and `_physics.predict`,
  `fit-ward-scale.py`, `experiment-model-structure.py` and `measure-spatial-accuracy.py` all call it.

The published number therefore described a model slightly different from the one that runs. It now describes the one
that runs. This was found by the daytime-refit parity audit (finding M1, `/Volumes/OBOSLab/research/daytime-refit/P1-AUDIT.md`);
the TS-versus-Python oracle for it lives on the (unmerged) `feat/daytime-refit-parity` branch and agrees to 2.8e-14 K.

**Independent confirmation, already in the repo.** `displayed-vs-calibrated.json` scores the shipped TypeScript solver
on the same 294 rows. Its "displayed, settled" night column (bias +0.31 K, RMSE 2.68 K, leave-one-overpass-out 2.81 K)
did not move when this change was regenerated; the "calibrated" column did, and now sits within 0.002 K of it
(`app_equation_minus_calibrated_K` −0.092 → −0.002 K at night). The 2026-11-07 Kolkata skill audit had already
reached the same shipped-model figures by scoring the TypeScript directly.

## Every figure that changed

| artefact | field | before | after |
|---|---|---|---|
| `model-accuracy.json` `ward_scale.strata.night` | rmse_K | 2.662 | 2.683 |
| | bias_K | 0.41 | 0.32 |
| | loo_overpass_rmse_K | 2.777 | 2.812 |
| | ci95_K | [1.598, 3.697] | [1.644, 3.703] |
| | ci95_halfwidth_K | 1.05 | 1.03 |
| `model-accuracy.json` `phases.night` (superseded mask-scale block, read by nothing) | model_rmse_K | 3.01 | 2.96 |
| | reported_band_K | 3.5 | 3.0 |
| `displayed-vs-calibrated.json` | night calibrated bias / RMSE / LOO | +0.41 / 2.662 / 2.777 | +0.32 / 2.683 / 2.812 |
| `seasonal-caveat.json` | pre-monsoon `calibrated_rmse_K` | 3.064 | 3.063 |
| `spatial-accuracy.json` (within-ward pattern; the page's SPATIAL figures come from `shipped-amplitude.json`, not this file) | night `r_physics` / `anomaly_rmse_k` | 0.1405 / 1.030 | 0.1442 / 1.051 |
| | overall `r_physics` / `anomaly_rmse_k` | 0.1843 / 1.532 | 0.1864 / 1.545 |
| `accuracy.ts` `ACCURACY.night` | modelRmseK, looOverpassRmseK, note | 2.662, 2.777 | 2.683, 2.812 |

**Not changed:** the ±3.0 K night band, the 2.166 K ceiling, n = 50 / 20 overpasses, every day stratum
(morning_ecostress, morning_landsat, peak_ecostress: the taper is a night-only term), the seasonal caveat verdicts
(pre-monsoon still exceeds the band, 3.06 K against ±3.0 K), `ward-scale-fit.json` and the shipped constants.
Bengaluru and Amsterdam: neither city has a figure in any artefact these scripts write; no Bengaluru or Amsterdam
number moved.

## Reading the new number

The bias fell by 0.09 K and the RMSE rose by 0.02 K. The figure is slightly less flattering on error and slightly
better on bias; neither alters the standing conclusion of the 2026-11-07 audit that at night the model has no skill
over air temperature plus a fixed offset.
