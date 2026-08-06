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
 * THE NULL MODEL IS WHY THIS IS READABLE. r = 0.303 on its own sounds like "some
 * skill". Put vegetation through the SAME solver — the like-for-like null — and it
 * gets 0.314. So the full model is still worse at placing heat than one of the
 * layers it is built from, and the within-ward pattern is not validated.
 *
 * WHY IT FAILS: the built-fraction term carries the LARGEST spatial amplitude
 * while correlating with measured heat the worst. So the term that dominates what
 * the map SHOWS is the weaker predictor, diluting the one that works. A ward-MEAN
 * fit cannot fix that: `built` is one number per ward in such a fit, so nothing in
 * it constrains how the field varies INSIDE the ward. That needs a per-cell fit,
 * and a per-cell fit needs ground truth finer than 70 m.
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
/*
 * CORRECTED 2026-08-05: WE WERE SCORING A FIELD THE MAP NEVER DRAWS.
 *
 * measure-spatial-accuracy.py evaluates the per-cell EQUILIBRIUM — the closed-form
 * steady state, one cell at a time. The browser runs TsHeatSim, which adds lateral
 * diffusion and relaxes for RESET_BURST steps; its steady state is that same
 * equilibrium SMOOTHED at ~sqrt(D/k) cells, near 47 m. Rougher field, higher
 * amplitude, lower correlation — none of it what a reader sees.
 *
 * Re-measured by driving the REAL solver (scripts/measure-shipped-amplitude.py):
 *
 *   phase   n   SD ship  SD equil  SD obs |  r ship  r equil  r veg(diffused)
 *   day    37     1.93K     2.37K   1.32K |   0.389    0.296            0.398
 *   night  50     0.89K     1.14K   0.64K |   0.240    0.156            0.251
 *   all    87     1.33K     1.67K   0.93K |   0.303    0.215            0.314
 *
 * So the shipped map scores 0.303, not 0.215 — we were understating our own
 * product by about 40 % by validating the wrong field.
 *
 * THE CLAIM IS STILL UNCHANGED, and the control is why. 0.303 sits above the old
 * published vegetation null of 0.238, which reads like the model finally winning.
 * It is not: smoothing lifts correlation against a coarse, noisy target for ANY
 * field. Re-running the null through the IDENTICAL solver, with albedo and built
 * held flat so vegetation is the only thing varying, gives 0.314. The model is
 * behind by 0.010 overall and in both phases separately. The gain was the
 * smoothing, not the physics — and the null below is now that like-for-like one,
 * not a raw layer.
 */
export const SPATIAL = {
  /** ward-scenes scored (3 wards x near-nadir scenes, after cloud/QC masking) */
  n: 87,
  /** correlation of the SHIPPED field — TsHeatSim, diffused — with ECOSTRESS */
  rModel: 0.303,
  /** vegetation through the SAME solver: the like-for-like null, which still wins */
  rVegOnly: 0.314,
  /** built fraction alone, raw */
  rBuiltOnly: 0.179,
  /**
   * The map's within-ward spread against the observation's. 1.44 means the colour
   * range inside a ward is about half again as wide as ECOSTRESS measures — the
   * one defect here a reader can actually SEE, which is why it is now stated.
   */
  amplitudeRatio: 1.44,
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
      + 'ward is not: block by block it scores r = 0.30, still below the r = 0.31 of a '
      + 'vegetation map given the same treatment, and coarsening the comparison does not '
      + 'close that gap at any scale. At neighbourhood scale (~300-500 m) it reaches '
      + 'r = 0.5. The colour range inside a ward is also about 1.4x wider than the '
      + 'satellite measures, so read contrasts as exaggerated. Ward figures are measured, '
      + 'neighbourhood contrast is indicative, block-by-block detail is illustrative.',
} as const;

/**
 * Building heights against ICESat-2 ATL03 photon transects — mirrored from
 * `data/calibration/icesat2-heights.json`; method and thresholds pre-registered
 * in docs/superpowers/specs/2026-08-06-icesat2-height-validation-design.md §5.3.
 *
 * DISTRIBUTIONAL, NEVER PER BUILDING. ATL03's horizontal geolocation is ~3-5 m
 * against 10-20 m Kolkata buildings, so any single photon may have landed on the
 * neighbour. The comparison therefore only ever asks what the height POPULATION
 * along a transect looks like — never which building a photon hit — and no
 * per-building height is published from it at any n.
 *
 * AND THE SAMPLE IS THE LARGEST BUILDINGS ONLY. A footprint has to survive a 5 m
 * erosion, the geolocation error, before a photon may be assigned to it, and that
 * alone removes most of every ward: 995 of 3,527 survive in Ballygunge (28.2 %),
 * 719 of 4,702 in Barrackpore (15.3 %), 326 of 4,538 in Baruipur (7.2 %) — in
 * Baruipur, the largest one building in fourteen. The erosion cannot be relaxed to
 * widen the sample: shrinking it admits photons that may belong to the neighbour,
 * trading a DISCLOSED selection effect for an UNDISCLOSED attribution error. So
 * the wording is "along satellite transects", never "all buildings" (spec §5.4).
 *
 * THE VERDICT IS THE MEDIAN'S — AND THE MEDIAN IS NOT THE STATISTIC WE SHIP.
 * The pre-registered rule keys on |median bias| < 3.2 m (one storey) with the CI
 * excluding ±2 storeys, and by that rule this is `validated`: +1.22 m,
 * CI [−0.97, 4.54]. The rule stays exactly as written — rewriting a threshold
 * after seeing the data is the one thing pre-registration exists to prevent.
 * But `compute-heights.py` ships the p65, and at p65 the bias is +3.87 m with
 * CI [0.53, 5.30] — an interval that EXCLUDES ZERO and sits above one storey.
 * So both sentences are true at once and the note has to carry both: the two
 * distributions agree within a storey at the median, and at the percentile this
 * product actually publishes ICESat-2 reads higher, meaning our heights most
 * likely understate. A guard below fires if that second sentence ever leaves.
 *
 * NOT AN OMNIBUS PASS. `permP` (0.0627) and `ksD` are recorded, not gated — the
 * verdict rule never referenced either. `validated` here says NOTHING about
 * whether the paired permutation test separated the two distributions, and must
 * never be read as "the test found no significant difference"; that reading would
 * be available even at permP ≈ 0.
 *
 * n = 30 is the pre-registered bar hit EXACTLY, not cleared, and 27 of the 30 sit
 * in one ward. The 31 overpasses re-fly only 2 distinct reference ground tracks —
 * a repeat pass adds photons to buildings already in the cohort, never a new
 * transect — so the passes are not 31 independent looks.
 *
 * Regenerate with: python3 scripts/measure-height-accuracy.py
 */
export const HEIGHTS = {
  /** pre-registered outcome (spec §5.3), keyed on the MEDIAN bias alone */
  verdict: 'validated',
  /** distinct buildings measured, photons pooled across every pass */
  nBuildings: 30,
  /** the pre-registered minimum. nBuildings === this: the bar, hit exactly */
  minBuildings: 30,
  /** overpasses pooled, and the distinct ground tracks they re-fly */
  nPasses: 31,
  nRgts: 2,
  /** where the cohort actually lives — it is not spread over the three wards */
  topWard: 'ballygunge',
  topWardBuildings: 27,
  /** ICESat-2 minus ours, m. POSITIVE means the laser reads HIGHER than we ship. */
  medianBiasM: 1.22,
  ci95M: [-0.97, 4.54],
  /** the statistic compute-heights.py ships — and its CI excludes zero */
  p65BiasM: 3.87,
  p65Ci95M: [0.53, 5.3],
  p90BiasM: 7.34,
  p90Ci95M: [-12.66, 7.94],
  /** recorded, NEVER gated: neither entered the verdict rule */
  permP: 0.0627,
  ksD: 0.2667,
  /** footprint erosion, m, and the share of each ward that survives it */
  erosionM: 5,
  survivorPctRange: [7.2, 28.2],
  /**
   * Win 2, the 2.5 m Google fill audit, did not reach its bar: 5 crossed fill
   * buildings against a required 10. No fill number is published, and the note
   * says nothing about the fill — an underpowered cohort has no result to quote.
   */
  fill: { n: 5, minN: 10, verdict: 'underpowered' },
  /**
   * Win 4, free along the same transects: the shipped ~30 m relief surface sits
   * this far ABOVE decimetre-class laser ground, in metres. Measured, and it gates
   * nothing — no part of the heat model reads it, and the height comparison takes
   * its ground line from the photons themselves, never from the DEM.
   */
  demMinusLaserGroundM: 6.55,
  /**
   * User-facing, on the building card's Height row.
   *
   * Every clause here is load-bearing and each has a guard in
   * `assertAccuracyLogic()`: the distributional scoping, the transect frame, the
   * erosion that restricts the sample to the largest buildings, the n-at-the-bar
   * and one-ward concentration, and — the one this measurement specifically
   * risks — that the SHIPPED statistic's interval excludes zero in the direction
   * of understatement. "Validated" alone would read as "our heights are right".
   */
  note: 'Heights are validated in distribution, not individual buildings: ICESat-2 '
      + 'laser geolocation (~3-5 m) against 10-20 m buildings means no photon can be '
      + 'pinned to one roof. The check runs along satellite transects, and only over '
      + 'buildings large enough to survive a 5 m erosion — the largest 7-28 % of each '
      + 'ward. n = 30 buildings, exactly the pre-registered minimum and no more, 27 of '
      + 'them in one ward. The median difference is +1.2 m, inside one storey (95 % CI '
      + '−1.0 to +4.5 m). At p65, the percentile this product publishes, ICESat-2 reads '
      + '+3.9 m higher and that interval (+0.5 to +5.3 m) excludes zero — so our heights '
      + 'most likely understate by about a storey there. Nothing here establishes that '
      + 'any one building\'s height is right.',
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
  a(SPATIAL.amplitudeRatio > 1.0,
    'the map draws MORE within-ward contrast than the satellite measures; if this '
    + 'ever drops to 1.0 the amplitude claim in the note is wrong — re-run '
    + 'scripts/measure-shipped-amplitude.py rather than editing the number');
  a(SPATIAL.note.includes('wider than the satellite'),
    'the note must state the amplitude excess: it is the one defect here a reader '
    + 'can SEE, and dropping it leaves the colour range reading as measured');
  a(SPATIAL.note.includes('neighbourhood'),
    'the note must carry the MIDDLE tier: block-scale detail is illustrative but '
    + '~300-500 m contrast is indicative at r = 0.5. Dropping it leaves the reader '
    + 'knowing only where not to trust the map, which the measurement does not require');
  a(SPATIAL.note.includes('not') && SPATIAL.note.includes('illustrative'),
    'the spatial note must state plainly that within-ward detail is not measured');

  // HEIGHTS: here the WORDING is the deliverable. The verdict word "validated" is
  // one careless simplification away from reading as "our building heights are
  // right", which this instrument cannot support at any n — so each guard below
  // fires on the specific clause whose removal would produce that reading. They
  // are written as implications, not as `note.includes('validated')` tests, so
  // that rewording the claim cannot also switch the guard off.
  a(HEIGHTS.verdict !== 'validated' || HEIGHTS.nBuildings >= HEIGHTS.minBuildings,
    'a validated heights verdict under the pre-registered minimum n is not a verdict '
    + '— re-run scripts/measure-height-accuracy.py, do not lower the bar');
  a(HEIGHTS.verdict !== 'validated' || Math.abs(HEIGHTS.medianBiasM) < 3.2,
    'verdict says validated but the recorded median bias exceeds one storey (spec §5.3)');
  a(HEIGHTS.verdict !== 'validated'
    || (HEIGHTS.ci95M[0] > -6.4 && HEIGHTS.ci95M[1] < 6.4),
    'validated requires the median CI to exclude ±2 storeys — this one does not');
  a(HEIGHTS.verdict !== 'validated' || HEIGHTS.note.includes('in distribution'),
    'a validated-heights claim must be scoped to the DISTRIBUTION. Without those '
    + 'words the sentence claims the buildings themselves were checked');
  a(HEIGHTS.verdict !== 'validated' || HEIGHTS.note.includes('not individual buildings'),
    'a validated-heights claim must disclaim per-building accuracy — ATL03 '
    + 'geolocation forbids attribution, so no sample size ever earns that claim');
  a(HEIGHTS.note.includes('transect'),
    'the heights note must name the transect sampling frame: this is not a survey of '
    + 'the ward, only of buildings a satellite ground track happened to cross');
  a(HEIGHTS.note.includes('erosion'),
    'the note must state the 5 m erosion — it is what restricts the sample to the '
    + `largest ${HEIGHTS.survivorPctRange[0]}-${HEIGHTS.survivorPctRange[1]} % of each `
    + 'ward, and a reader who does not know it will generalise to small buildings');
  // THE ONE THIS MEASUREMENT SPECIFICALLY RISKS. The verdict keys on the median;
  // the product ships the p65, whose CI excludes zero at +3.87 m. Publishing
  // "validated" without that sentence is true by the rule and false to the reader.
  const p65ExcludesZero = HEIGHTS.p65Ci95M[0] > 0 || HEIGHTS.p65Ci95M[1] < 0;
  a(!p65ExcludesZero
    || (HEIGHTS.note.includes('p65') && HEIGHTS.note.includes('excludes zero')
        && HEIGHTS.note.includes('understate')),
    'the p65 interval excludes zero, so the note must say so in those words and give '
    + 'the direction: the verdict is the MEDIAN\'s, and the median is not the statistic '
    + 'compute-heights.py publishes');
  a(HEIGHTS.topWardBuildings * 2 <= HEIGHTS.nBuildings || HEIGHTS.note.includes('one ward'),
    `${HEIGHTS.topWardBuildings} of ${HEIGHTS.nBuildings} buildings sit in a single ward `
    + '— the note must say so rather than let three ward names imply three samples');
  a(HEIGHTS.nBuildings > HEIGHTS.minBuildings || HEIGHTS.note.includes('exactly'),
    'n sits ON the pre-registered bar rather than past it, and the note must not let '
    + 'that read as a comfortable margin');
  a(HEIGHTS.fill.n >= HEIGHTS.fill.minN || HEIGHTS.fill.verdict === 'underpowered',
    'the 2.5 m fill cohort is under its own bar and must publish as underpowered');
  a(HEIGHTS.fill.verdict !== 'underpowered' || !/fill/i.test(HEIGHTS.note),
    'the fill cohort is underpowered, so the note may make no claim about the 2.5 m '
    + 'fill value — an underpowered cohort has no result to quote');
  a(!/\b(all|every|each) buildings?\b/i.test(HEIGHTS.note),
    'spec §5.4: the published wording is "along satellite transects", never "all '
    + 'buildings" — the transects see only the largest 7-28 % of a ward');
  a(!/\b(no|not) significant\b|indistinguishable|statistically identical/i.test(HEIGHTS.note),
    `the permutation test (p = ${HEIGHTS.permP}) never entered the verdict rule, so the `
    + 'note must not claim an omnibus test cleared the heights — validated can coexist '
    + 'with p ≈ 0');
  a(!/heights are (right|correct|accurate)|confirms our heights|building heights are confirmed/i
    .test(HEIGHTS.note),
    'no wording may promote a distributional match to per-building correctness');
}
