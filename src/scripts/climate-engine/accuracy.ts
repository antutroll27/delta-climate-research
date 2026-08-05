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
 * THE NULL MODELS ARE WHY THIS IS READABLE. r = 0.216 on its own sounds like
 * "some skill". Scored against the same cells, vegetation fraction ALONE gets
 * 0.238 — so the full model is still worse at placing heat than one of the
 * layers it is built from, and the within-ward pattern is not validated.
 *
 * WHY IT FAILS: the built-fraction term carries the LARGEST spatial amplitude
 * (1.21 K) while correlating with measured heat at only 0.179. Vegetation carries
 * more skill (0.238) at half the amplitude (0.64 K). So the term that dominates
 * what the map SHOWS is the weaker predictor, diluting the one that works. A
 * ward-MEAN fit cannot fix that: `built` is one number per ward in such a fit, so
 * nothing in it constrains how the field varies INSIDE the ward. That needs a
 * per-cell fit, and a per-cell fit needs ground truth finer than 70 m.
 *
 * (Two earlier notes here quoted r = 0.113 -> 0.162 and a built-term correlation
 * of 0.037. Those described the measurement BEFORE the veg/built orientation fix
 * of 2026-08-05 and are superseded; the improvement they celebrated was partly an
 * artefact of layers that disagreed about which row was north.)
 *
 * This does NOT affect the ward-level figures, the resilience score, or any
 * DC-URS input — those are measured separately and are unchanged. It affects
 * one claim only: that the hot and cool blocks WITHIN a ward mean something.
 *
 * Regenerate with: python3 scripts/measure-spatial-accuracy.py
 */
/*
 * RE-MEASURED 2026-08-05, after the surface raster and the built raster were put
 * on the same ground. They had disagreed about which row was north, so the
 * modelled field was assembled from layers describing mirror images of each other
 * and then correlated against an observation that agreed with only some of them.
 *
 *            n    physics   built     veg    anomaly RMSE
 *   before   81     0.162   0.037   0.229        1.36 K
 *   after    87     0.216   0.179   0.238        1.82 K
 *
 * `built` nearly quintupled and `veg` barely moved — exactly the signature of the
 * fix, since `built` was the mirrored layer and `veg` already agreed with
 * ECOSTRESS. That was predicted before the run, which is the only reason to trust
 * the attribution at all.
 *
 * NOT A CLEAN A/B, and the difference must not be oversold: the scene set also
 * changed (81 → 87 ward-scenes from 34 near-nadir granules), so some of the
 * movement is scenes rather than the fix. The anomaly RMSE went UP, 1.36 → 1.82 K,
 * and that is not attributable either way on this evidence.
 *
 * THE HEADLINE CLAIM IS UNCHANGED. The physics still does not beat the best null
 * — 0.216 against vegetation's 0.238. The map's within-ward pattern is still not
 * measurably real, and the note below still has to say so.
 */
/*
 * AND THE OBVIOUS EXCUSE WAS TESTED, AND FAILED (2026-08-05).
 *
 * The natural defence of r = 0.216 is that ECOSTRESS is 70 m while the model
 * resolves 7.29 m, so the test cannot see what the model does. That does not
 * survive contact: blur and geolocation error attenuate the physics field and the
 * vegetation field against the SAME observation. It is a shared penalty. It
 * explains why r is 0.22 rather than 0.6; it does not explain why physics < veg.
 *
 * One mechanism could have broken the symmetry — the physics field is
 * built-fraction-driven with structure at 7-30 m, while vegetation is park-driven
 * at 50-300 m, and a coarse sensor punishes fine structure harder. So the
 * vegetation null might have been winning only because its signal lives at scales
 * the sensor can resolve.
 *
 * `scripts/measure-scale-skill.py` coarsened both fields AND the observation
 * together and the hypothesis died:
 *
 *     scale   m/cell    n   physics     veg   built     gap
 *     x1          67   87     0.216   0.238   0.179   -0.022
 *     x2         133   85     0.311   0.329   0.276   -0.017
 *     x3         200   85     0.376   0.396   0.334   -0.020
 *     x5         333   84     0.468   0.463   0.446   +0.005
 *     x7         467   81     0.534   0.539   0.519   -0.005
 *
 * Every r rises with coarsening — averaging suppresses noise, which confirms the
 * 67 m comparison is noisy — but the GAP is flat throughout. The physics never
 * pulls ahead. So "illustrative" is not modesty, it is the measurement.
 *
 * WHAT THE TABLE DOES SUPPORT, and this is new: at 300-470 m all three predictors
 * converge near r = 0.5. There IS neighbourhood-scale skill. The claim we can make
 * is scale-qualified rather than absent, which is more use to a reader than a bare
 * warning — it says WHERE to trust the map instead of only where not to.
 *
 * Losing to a simple predictor is also the norm in this field, not our failure:
 * Urban-PLUMBER (Lipson et al. 2024) put 30 urban land-surface models against an
 * empirical benchmark and the benchmark beat all 30.
 *
 * Regenerate with: python3 scripts/measure-scale-skill.py
 */
export const SCALE_SKILL = Object.freeze({
  /** the published comparison: one ECOSTRESS cell */
  blockM: 67,
  rModelBlock: 0.216,
  /** coarsened to ~5x5 ECOSTRESS cells — neighbourhood scale */
  neighbourhoodM: 333,
  rModelNeighbourhood: 0.468,
  /** the gap to the vegetation null, at the two ends of the sweep */
  gapAtBlock: -0.022,
  gapAtCoarsest: -0.005,
});
export const SPATIAL = {
  /** ward-scenes scored (3 wards x near-nadir scenes, after cloud/QC masking) */
  n: 87,
  /** correlation of the shipping model's field with ECOSTRESS, ward mean removed */
  rModel: 0.216,
  /** the same for vegetation fraction alone — the null that still beats the model */
  rVegOnly: 0.238,
  /** and for built fraction alone */
  rBuiltOnly: 0.179,
  /** RMSE that remains once ward-mean bias is removed, K */
  anomalyRmseK: 1.82,
  /**
   * User-facing, shown wherever the field's detail could be over-read.
   *
   * Three tiers on purpose. The old wording gave the reader only "measured" and
   * "illustrative", which told them where NOT to trust the map and nothing about
   * where they could. The scale sweep earned the middle tier.
   */
  note: 'Ward-level temperature is calibrated against ECOSTRESS. The pattern WITHIN a '
      + 'ward is not: block by block it scores r = 0.22, below the r = 0.24 of a plain '
      + 'vegetation map, and coarsening the comparison does not close that gap at any '
      + 'scale. At neighbourhood scale (~300-500 m) the same comparison reaches r = 0.5. '
      + 'Read the ward figures as measured, neighbourhood contrast as indicative, and '
      + 'the block-by-block detail as illustrative.',
} as const;

/** Formats the band for display, e.g. "± 3.5". */
export function bandLabel(phase: 'peak' | 'night'): string {
  return `± ${ACCURACY[phase].bandK.toFixed(1)}`;
}

/**
 * The hours where neither published figure applies, in local solar time.
 *
 * The 2026-08-02 Landsat campaign scored the model in four time-of-day strata
 * (`data/calibration/model-accuracy.json` → `ward_scale.strata`). Three came out
 * close to their published bands. One did not:
 *
 *     morning_ecostress   hours 7.09–11.06   LOO-overpass 7.54 K   n=11
 *     morning_landsat     hours 10.39–10.41  LOO-overpass 2.25 K   n=213
 *     peak_ecostress      hours 11.76–17.45  LOO-overpass 2.40 K   n=24
 *     night               hours 0.7–23.84    LOO-overpass 2.79 K   n=50
 *
 * Sunrise to mid-morning is where a STEADY-STATE model has least to work with:
 * the surface is still shedding stored heat while the sun is already loading it,
 * and an equilibrium solution cannot represent a system that is not near
 * equilibrium. 7.54 K is two and a half times the daytime band.
 *
 * The upper bound stops at 9.5 rather than 11.06 because Landsat's 213 scenes
 * pin 10:30 at 2.25 K — the stratum is only unreliable BEFORE that anchor, and
 * shading the good hours would overstate the caveat.
 *
 * A live "now" view can enter this window, so it must be able to say so.
 */
export const TRANSITION_HOURS: readonly [number, number] = [5, 9.5];
export const TRANSITION_RMSE_K = 7.54;

/** True when a local solar hour falls in the sunrise window neither band covers. */
export function isTransitionHour(solarHour: number): boolean {
  return solarHour >= TRANSITION_HOURS[0] && solarHour < TRANSITION_HOURS[1];
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
  a(SCALE_SKILL.rModelNeighbourhood > SCALE_SKILL.rModelBlock,
    'the scale sweep found skill RISES with coarsening — if that inverts, re-run '
    + 'scripts/measure-scale-skill.py before touching the note');
  a(SCALE_SKILL.gapAtCoarsest < 0.05 && SCALE_SKILL.gapAtBlock < 0.05,
    'the physics-minus-vegetation gap closing would be a real result and would '
    + 'change what the map may claim — re-measure, do not edit this by hand');
  a(SPATIAL.note.includes('neighbourhood'),
    'the note must carry the MIDDLE tier: block-scale detail is illustrative but '
    + '~300-500 m contrast is indicative at r = 0.5. Dropping it leaves the reader '
    + 'knowing only where not to trust the map, which the measurement does not require');
  a(SPATIAL.note.includes('not') && SPATIAL.note.includes('illustrative'),
    'the spatial note must state plainly that within-ward detail is not measured');
}
