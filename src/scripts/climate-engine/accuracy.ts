/**
 * Measured accuracy of the heat map, per diurnal phase.
 *
 * These are NOT design targets or asserted tolerances. They are the model's
 * out-of-sample error against 32 near-nadir NASA ECOSTRESS scenes over Kolkata
 * (2024-01 → 2026-07), produced by `scripts/measure-accuracy.py` and mirrored
 * here from `data/calibration/model-accuracy.json`.
 *
 * WHY DAY AND NIGHT DIFFER. `ceilingRmseK` is the error of the best possible
 * empirical predictor built from the same forcing data, scored leave-one-out.
 * It is an upper bound on what ANY model on these inputs can achieve. At night
 * it is 2.18 K; by day it is 3.33 K, because daytime surface temperature turns
 * on site-level insolation, cloud timing and soil moisture that a 50 km
 * reanalysis cell cannot resolve. No amount of tuning moves the daytime number
 * — the limit is the forcing data, not the physics.
 *
 * So the product reports night quantitatively and day as indicative. Presenting
 * a ±5 K daytime figure as decision-grade would be the actual inaccuracy.
 *
 * Regenerate with: python3 scripts/measure-accuracy.py
 */
export interface PhaseAccuracy {
  /** scenes the figure is measured over */
  readonly n: number;
  /** best achievable RMSE from this forcing, leave-one-out — the data's limit */
  readonly ceilingRmseK: number;
  /** what this model actually achieves */
  readonly modelRmseK: number;
  /** what the UI shows, model error rounded UP to 0.5 K */
  readonly bandK: number;
  readonly confidence: 'quantitative' | 'indicative';
  /** short, user-facing reason — shown in the readout's tooltip */
  readonly note: string;
}

export const ACCURACY: Record<'peak' | 'night', PhaseAccuracy> = {
  night: {
    n: 20,
    ceilingRmseK: 2.18,
    modelRmseK: 3.13,
    bandK: 3.5,
    confidence: 'quantitative',
    note: 'Night surface temperature tracks air temperature closely (r ≈ 0.9), so this '
        + 'figure is meaningful. Uncertainty measured against 20 ECOSTRESS scenes.',
  },
  peak: {
    n: 12,
    ceilingRmseK: 3.33,
    modelRmseK: 4.61,
    bandK: 5.0,
    confidence: 'indicative',
    note: 'Daytime is indicative only. Surface temperature at noon depends on local '
        + 'insolation, cloud timing and soil moisture that 50 km reanalysis forcing '
        + 'cannot resolve — no model on this data does better than ±3.3 K. Use the '
        + 'night view for quantitative comparison.',
  },
};

/** Formats the band for display, e.g. "± 3.5". */
export function bandLabel(phase: 'peak' | 'night'): string {
  return `± ${ACCURACY[phase].bandK.toFixed(1)}`;
}

/** ponytail: one runnable check */
export function assertAccuracyLogic(): void {
  const a = (ok: boolean, m: string) => { if (!ok) throw new Error(`accuracy: ${m}`); };
  for (const k of ['peak', 'night'] as const) {
    const x = ACCURACY[k];
    // a model cannot beat the best possible predictor on the same data
    a(x.modelRmseK >= x.ceilingRmseK, `${k}: model beats the data ceiling — impossible`);
    // the shown band must never understate the measured error
    a(x.bandK >= x.modelRmseK, `${k}: displayed band understates measured error`);
    a(x.n > 0, `${k}: no scenes behind the figure`);
  }
  // daytime must never be presented as the more certain of the two
  a(ACCURACY.peak.ceilingRmseK > ACCURACY.night.ceilingRmseK,
    'daytime ceiling should exceed night — check for an in-sample overfit');
  a(ACCURACY.peak.confidence === 'indicative', 'daytime must not claim quantitative status');
}
