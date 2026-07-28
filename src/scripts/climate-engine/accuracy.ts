/**
 * Measured accuracy of the heat map, per diurnal phase.
 *
 * These are NOT design targets or asserted tolerances. They are the model's
 * error against 79 ward-scenes of NASA ECOSTRESS over the three Kolkata wards
 * (2024-01 → 2026-07), produced by `scripts/fit-ward-scale.py` and mirrored here
 * from `data/calibration/ward-scale-fit.json`.
 *
 * MEASURED AT WARD SCALE, WHICH IS NEW. The previous figures scored the model
 * against two GHS-SMOD masks — 3,363 km² "urban" against 1,568 km² "rural".
 * Sampling both with Sentinel-2 showed they are the same landscape (FVC 0.678
 * against 0.654, the urban side marginally the greener), so their 0.34 K
 * difference was delta-with-villages against delta-with-crops, not an urban
 * heat island. The product renders 1400 m wards at FVC 0.31–0.45. The old
 * numbers described a different surface than the one on screen.
 *
 * WHY DAY AND NIGHT DIFFER. `ceilingRmseK` is the error of the best possible
 * empirical predictor built from the same forcing AND the ward's own measured
 * surface, scored leave-one-out. It is an upper bound on what ANY model on
 * these inputs can achieve. At night it is 2.23 K; by day 3.34 K, because
 * daytime surface temperature turns on site-level insolation, cloud timing and
 * soil moisture that a 50 km reanalysis cell cannot resolve. No amount of
 * tuning moves the daytime ceiling — that limit is the forcing data.
 *
 * WHERE WE SIT AGAINST IT. Night is 0.70 K off its ceiling with a bias of
 * +0.18 K — and, more importantly, on the right side of air temperature at
 * last. Day is 1.08 K off, so the daytime structure is genuinely incomplete
 * and that gap is ours, not the data's. Two different situations; the notes
 * below say so rather than averaging them into one reassuring sentence.
 *
 * So the product reports night quantitatively and day as indicative.
 *
 * Regenerate with: python3 scripts/build-ward-observations.py
 *                  python3 scripts/fit-ward-scale.py
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
    n: 50,
    ceilingRmseK: 2.233,
    modelRmseK: 2.93,
    bandK: 3.0,
    confidence: 'quantitative',
    note: 'Night surface temperature tracks air temperature closely, and the model now '
        + 'reproduces the nocturnal heat island rather than inverting it — the modelled '
        + 'surface sits above air as measured (bias +0.18 K; the previous structure was '
        + '−1.54 K, i.e. the wrong side of air entirely). 2.93 K against a 2.233 K '
        + 'ceiling, over 50 ward-scenes.',
  },
  peak: {
    n: 29,
    ceilingRmseK: 3.338,
    modelRmseK: 4.42,
    bandK: 4.5,
    confidence: 'indicative',
    note: 'Daytime is indicative only. Surface temperature at noon depends on local '
        + 'insolation, cloud timing and soil moisture that 50 km reanalysis forcing '
        + 'cannot resolve — no model on this data does better than ±3.3 K. Ours is '
        + '4.42 K, so unlike the night view it is NOT at that limit and the daytime '
        + 'structure is still incomplete. Use the night view for quantitative comparison.',
  },
};

/**
 * Shown on the resilience score while an indicator that can move it is unmeasured.
 *
 * Written for a municipal officer, not a statistician. It names WHICH direction
 * the error runs, because a reader who does not know that will assume it cancels
 * out — and it does not: an unmeasured vulnerability reads as no vulnerability,
 * which always flatters.
 *
 * BUILT FROM THE GAP, not hardcoded. The previous constant named socioVuln and
 * its 8.8 points in prose. That was true when it was written and false the day
 * socio.json landed — and it would have gone on being displayed, confidently
 * describing a missing indicator that is now measured, because nothing in a
 * string can go stale loudly.
 */
const FIELD_LABEL: Record<string, string> = {
  socioVuln: 'the share of residents least able to cope with heat — older people, young '
           + 'children, low-income and informal households',
  popDensity: 'how many people live in each hectare',
  far: 'how densely the ward is built',
  fvc: 'green cover',
  ndviMean: 'vegetation vigour',
  ndviStd: 'how stable that vegetation is year to year',
  albedo: 'how much sunlight the surface reflects',
  distCoolM: 'how far residents walk to the nearest cool refuge',
  lstDayC: 'daytime surface temperature',
  lstNightC: 'night surface temperature',
  ruralBaseC: 'the rural baseline the heat island is measured against',
};

export function unmeasuredNote(fields: readonly string[], points: number): string {
  if (fields.length === 0) return '';
  const named = fields.map(f => FIELD_LABEL[f] ?? f);
  const list = named.length === 1 ? named[0]
    : `${named.slice(0, -1).join('; ')}; and ${named[named.length - 1]}`;
  return `${fields.length === 1 ? 'One indicator is' : `${fields.length} indicators are`} `
    + `not yet measured: ${list}. Until ${fields.length === 1 ? 'it lands' : 'they land'}, every `
    + `ward is scored at its most optimistic. The true score is up to ${points.toFixed(1)} points `
    + `lower. Ward-to-ward ranking is unaffected — the shift applies to all three.`;
}

/**
 * Measured SPATIAL skill — does the map put the hot spots in the right places?
 *
 * `ACCURACY` above is a WARD-MEAN error and says nothing about the pattern
 * inside the ward. This is the other half, measured by
 * `scripts/measure-spatial-accuracy.py` against ECOSTRESS at its native 70 m
 * with the ward mean removed from both sides, and mirrored here from
 * `data/calibration/spatial-accuracy.json`.
 *
 * THE NULL MODELS ARE WHY THIS IS READABLE. r = 0.162 on its own sounds like
 * "some skill". Scored against the same cells, vegetation fraction ALONE gets
 * 0.229 — so the full model is still worse at placing heat than one of the
 * layers it is built from, and the within-ward pattern is not validated.
 *
 * IT IMPROVED WITH THE WARD-SCALE CALIBRATION and that is worth recording:
 * r went 0.113 -> 0.162 and the anomaly RMSE 1.79 -> 1.36 K, because halving
 * Q cut the built term's spatial dominance from 1.46 K to 0.82 K. It is now
 * comparable to vegetation's 0.62 K rather than three times it. Better, and
 * still not enough to claim the pattern.
 *
 * WHY IT STILL FAILS: the built-fraction term carries 0.82 K of spatial
 * variation but correlates with measured heat at only 0.037. Vegetation carries
 * the skill (0.229) at a comparable 0.62 K. A ward-MEAN fit cannot fix this:
 * `built` is one number per ward in that fit, so nothing in it constrains how
 * the field varies inside the ward. That needs a per-cell fit.
 *
 * This does NOT affect the ward-level figures, the resilience score, or any
 * DC-URS input — those are measured separately and are unchanged. It affects
 * one claim only: that the hot and cool blocks WITHIN a ward mean something.
 *
 * Regenerate with: python3 scripts/measure-spatial-accuracy.py
 */
export const SPATIAL = {
  /** ward-scenes scored (3 wards x near-nadir scenes, after cloud/QC masking) */
  n: 81,
  /** correlation of the shipping model's field with ECOSTRESS, ward mean removed */
  rModel: 0.162,
  /** the same for vegetation fraction alone — the null that still beats the model */
  rVegOnly: 0.229,
  /** and for built fraction alone */
  rBuiltOnly: 0.037,
  /** RMSE that remains once ward-mean bias is removed, K */
  anomalyRmseK: 1.36,
  /** user-facing, shown wherever the field's detail could be over-read */
  note: 'Ward-level temperature is calibrated against ECOSTRESS. The pattern WITHIN a '
      + 'ward is not: measured against the same scenes it scores r = 0.16, below the '
      + 'r = 0.23 of a plain vegetation map. Read the ward figures as measured and '
      + 'the block-by-block detail as illustrative.',
} as const;

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

  // the note must not survive the gap closing — the exact failure it replaced
  a(unmeasuredNote([], 0) === '', 'no gap must produce no note, not a stale sentence');
  const one = unmeasuredNote(['socioVuln'], 8.75);
  a(one.includes('One indicator is') && one.includes('8.8 points'),
    'a single gap must be described in the singular, with its own point count');
  a(unmeasuredNote(['socioVuln', 'far'], 12).includes('2 indicators are'),
    'two gaps must not be described as one');

  // The spatial figures must keep saying what was measured. If a future run
  // makes the model beat the vegetation null, this assert fires and the note
  // has to be rewritten — which is the point: it must not go on claiming the
  // pattern is unvalidated after it stops being true, or the reverse.
  a(SPATIAL.n > 0, 'spatial skill must be measured over at least one ward-scene');
  a(SPATIAL.rModel < SPATIAL.rVegOnly,
    'SPATIAL.note says a vegetation map beats the model — re-measure and rewrite it '
    + 'if that is no longer the case');
  a(SPATIAL.note.includes('not') && SPATIAL.note.includes('illustrative'),
    'the spatial note must state plainly that within-ward detail is not measured');
}
