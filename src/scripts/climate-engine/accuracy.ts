/**
 * Measured accuracy of the heat map, per diurnal phase.
 *
 * These are NOT design targets or asserted tolerances. They are the model's
 * error against 79 ward-scenes of NASA ECOSTRESS over the three Kolkata wards
 * (2024-01 → 2026-07), produced by `scripts/fit-ward-scale.py` and mirrored here
 * from `data/calibration/ward-scale-fit.json`.
 *
 * NIGHT IS THE EXCEPTION: its figures come from `data/calibration/model-accuracy.json`
 * → `ward_scale.strata.night` (written by `scripts/measure-accuracy.py`). Do NOT copy
 * `phases.night.reported_band_K` from that file — its 3.5 is the superseded
 * mask-scale block, scoring a fit that does not ship.
 *
 * MEASURED AT WARD SCALE, WHICH IS NEW. The previous figures scored the model
 * against two GHS-SMOD masks — 3,363 km² "urban" against 1,568 km² "rural".
 * Sampling both with Sentinel-2 showed they are the same landscape (FVC 0.678
 * against 0.654, the urban side marginally the greener), so their 0.34 K
 * difference was delta-with-villages against delta-with-crops, not an urban
 * heat island. The product renders wards at FVC 0.22–0.45 (KMC Ward 68 0.220,
 * the two 1400 m wards 0.31 and 0.45). The old numbers described a different
 * surface than the one on screen.
 *
 * WHY DAY AND NIGHT DIFFER. `ceilingRmseK` is the error of the best possible
 * empirical predictor built from the same forcing AND the ward's own measured
 * surface, scored leave-one-out. It is an upper bound on what ANY model on
 * these inputs can achieve. At night it is 2.166 K; by day 3.34 K in the older
 * evidence set the peak entry still publishes, because daytime surface
 * temperature turns on site-level insolation, cloud timing and soil moisture
 * that a 50 km reanalysis cell cannot resolve. No amount of tuning moves the
 * daytime ceiling — that limit is the forcing data.
 *
 * WHERE WE SIT AGAINST IT. Night is 0.50 K off its ceiling, and the model runs
 * 0.41 K warmer than the measured surface on average (bias +0.41 K, model
 * minus measured). Day, in the older evidence set, was 1.08 K off, so the
 * daytime structure is genuinely incomplete and that gap is ours, not the
 * data's. Two different situations; the notes below say so rather than
 * averaging them into one reassuring sentence.
 *
 * BALLYGUNGE IS KMC WARD 68 (re-measured 2026-10-03). Every ward-scale figure
 * here that is copied from model-accuracy.json — all of night, and the peak
 * leave-one-overpass-out error — was re-measured with Ballygunge's rows taken
 * over the Ward 68 POLYGON (189 ECOSTRESS pixels, ~1,050 Landsat pixels;
 * surface and built fraction over the polygon's cells) instead of the old
 * 1400 m box. Barrackpore and Baruipur stay on their 1400 m boxes and their
 * rows are byte-identical. Night moved little (RMSE 2.677 -> 2.662 K, LOO
 * 2.801 -> 2.777 K, bias +0.36 -> +0.41 K, ceiling 2.117 -> 2.166 K, n = 50
 * unchanged), because at night Ward 68 reads only +0.17 K warmer than the old
 * box did. The physics constants were NOT refitted: fit-ward-scale.py on the
 * new rows would move candidate G to q_day 0.433 and STORE_NIGHT 0.093, and
 * ward-scale-fit.json is deliberately left as the run the shipped constants
 * came from (the shipped Q 0.419 stays inside the new admissible interval
 * [0.07, 0.60]). The peak entry's n, RMSE, ceiling and band are NOT Ward 68's;
 * see the comment on it.
 *
 * So the product reports night quantitatively and day as indicative.
 *
 * Regenerate with: python3 scripts/build-ward-observations.py
 *                  python3 scripts/fit-ward-scale.py
 *                  python3 scripts/measure-accuracy.py   (ACCURACY.night is copied from its output)
 */
export interface PhaseAccuracy {
  /** scenes the figure is measured over */
  readonly n: number;
  /** best achievable RMSE from this forcing, leave-one-out — the data's limit */
  readonly ceilingRmseK: number;
  /** what this model actually achieves */
  readonly modelRmseK: number;
  /** leave-one-overpass-out RMSE — the out-of-sample error the band must cover */
  readonly looOverpassRmseK: number;
  /** what the UI shows, model error rounded UP to 0.5 K */
  readonly bandK: number;
  readonly confidence: 'quantitative' | 'indicative';
  /** short, user-facing reason — shown in the readout's tooltip */
  readonly note: string;
}

export const ACCURACY: Record<'peak' | 'night', PhaseAccuracy> = {
  night: {
    n: 50,
    ceilingRmseK: 2.166,
    modelRmseK: 2.662,
    /**
     * Leave-one-overpass-out RMSE, from data/calibration/model-accuracy.json
     * ward_scale.strata.night. THIS is the number the band must cover.
     *
     * HISTORY, not today's state. An earlier audit found the ±3.0 K band then
     * published sat BELOW the out-of-sample error measured at the time. `modelRmseK`
     * (2.93 then) is the IN-SAMPLE fit; /uncertainty has always described
     * the method as "leave-one-overpass-out", and the honest out-of-sample error
     * under that method was then 3.102 K, so the band was widened to ±3.5. The guard
     * compared the band to the in-sample figure, so ±3.0 had passed while
     * understating the error the page named. Today's ±3.0 is a re-measurement, not a
     * reversion: after the 2026-09-24 forcing-date correction the out-of-sample error
     * was 2.801 K, which it covers (known-limitations §15). Re-measured 2026-10-03 with
     * Ballygunge as the KMC Ward 68 polygon it is 2.777 K, still covered. Of
     * every possible defect on a site whose product is its error bars, an error
     * bar that is too small is the worst one.
     */
    looOverpassRmseK: 2.777,
    bandK: 3.0,
    confidence: 'quantitative',
    note: 'Night surface temperature tracks air temperature closely, which is why '
        + 'night is the quantitative view: over 50 ward-scenes the model\'s error is '
        + '2.662 K against a best-achievable 2.166 K, and it runs 0.41 K warmer than '
        + 'the measured surface on average (bias +0.41 K). The displayed band is '
        + '+/-3.0 K because it must cover the leave-one-overpass-out error of 2.777 K, '
        + 'not the in-sample fit.',
  },
  peak: {
    n: 29,
    ceilingRmseK: 3.338,
    modelRmseK: 4.42,
    /**
     * n, ceilingRmseK, modelRmseK AND bandK ARE THE OLDER EVIDENCE SET, NOT WARD 68.
     * They trace to an earlier ECOSTRESS set (n=29 matches nothing that now exists),
     * scored when Ballygunge was the old 1400 m box. Only this leave-one-overpass-out
     * figure is current: it is copied from model-accuracy.json
     * strata.peak_ecostress, which a test holds it to.
     *
     * THE CURRENT MEASUREMENT (2026-10-03, Ballygunge = the KMC Ward 68 polygon):
     * peak_ecostress n = 23 ward-scenes over 8 overpasses, RMSE 2.233 K,
     * leave-one-overpass-out 2.358 K, bias +0.66 K, ceiling 1.967 K, bootstrap
     * 95 % CI 1.39-2.92 K. On the old 1400 m box the same stratum read RMSE 2.183,
     * LOO 2.389, bias +0.42, ceiling 2.027. Only Ballygunge's rows moved: its peak
     * bias went +0.83 -> +1.51 K, because the Ward 68 surface (FVC 0.220, built
     * 0.3645, against the old box's 0.329 / 0.319) warms the modelled peak by
     * +1.25 K over those 8 scenes while the satellite measured +0.57 K. The standing
     * ±4.5 K band covers the current out-of-sample error about 1.9 times over.
     *
     * Deliberately NOT recalibrated here. Adopting the measured values would give a
     * 2.5 K band, narrower than night's 3.0, on a ceiling (1.967 K) below night's
     * (2.166 K): daytime would out-measure night and trip two pre-registered guards
     * below; model-accuracy.json's own `pending_recalibration` reserves that for "a
     * reviewed change". Publishing a WIDER band than measured overstates our error,
     * which is the safe direction — unlike night, which once understated. Left
     * standing, labelled as the older evidence set, and flagged.
     */
    looOverpassRmseK: 2.358,
    bandK: 4.5,
    confidence: 'indicative',
    note: 'Daytime is indicative only. Surface temperature at noon depends on local '
        + 'insolation, cloud timing and soil moisture that 50 km reanalysis forcing '
        + 'cannot resolve. The ±4.5 K band comes from an older, smaller evidence set, '
        + 'scored before Ballygunge became KMC Ward 68, in which no model did better than '
        + '±3.3 K and ours was 4.42 K. The current measurement, over Ward 68 and the two '
        + 'other wards, is 2.23 K across 23 ward-scenes (2.36 K out of sample); the band '
        + 'is kept wider than that until a reviewed recalibration, because overstating '
        + 'our error is the safe direction. Use the night view for quantitative comparison.',
  },
};

/**
 * WHICH EVIDENCE SET A PUBLISHED FIGURE IS (pre-ship audit, 2026-10-03). The peak
 * band and n above, and HEIGHTS below, were measured before Ballygunge became KMC
 * Ward 68 and were deliberately not re-adopted; these strings say so wherever the
 * figures travel without their notes — the ward record's `basis` fields, and the
 * readout chip's "earlier set" (`PEAK_CHIP_BASIS`).
 */
export const PEAK_EVIDENCE_BASIS = 'Earlier evidence set, measured before Ballygunge became KMC Ward 68: '
  + 'Ballygunge was then the 1.4 km box around 22.528 N, 88.366 E. Not re-adopted; the current '
  + 'measurement over Ward 68 is in /uncertainty and model-accuracy.json strata.peak_ecostress.';
export const PEAK_CHIP_BASIS = 'earlier set';
export const HEIGHTS_EVIDENCE_BASIS = 'Measured on the earlier 1.4 km Ballygunge box, before Ballygunge became '
  + 'KMC Ward 68; its ICESat-2 transects stop short of Ward 68\'s southern blocks. Not re-measured.';

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
 * THE NULL MODEL IS WHY THIS IS READABLE. r = 0.26 on its own sounds like "some
 * skill". Put vegetation through the SAME solver — the like-for-like null — and it
 * gets 0.31 (0.297 against 0.313 on the old 1400 m Ballygunge box; Ward 68
 * figures since 2026-10-03, see below). So the full model is still worse at
 * placing heat than one of the layers it is built from, and the within-ward
 * pattern is not validated.
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
 * CORRECTED 2026-08-13 — both rows above were scored against a built raster that
 * had been stale for nine days, so they are kept as the record of what was
 * believed, not as current figures. Re-run on the shipped Overture geometry:
 *
 *   current  87     0.216   0.177   0.238        1.59 K
 *
 * THE CORRELATIONS BARELY MOVED AND THE AMPLITUDE DID, which is the expected
 * signature rather than a lucky escape: correlation is invariant to a uniform
 * change in spread, and the stale raster's surplus buildings inflated how much
 * contrast the model drew without much changing WHERE it drew it. So the
 * pattern-skill conclusions below survive the correction unchanged; the
 * amplitude ones did not, and are restated in SPATIAL.
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
 *
 * RE-MEASURED 2026-10-03, Ballygunge = the KMC Ward 68 polygon, on the corrected
 * forcing (the table above is the 2026-08-05 run: old 1400 m box, pre-correction
 * forcing, stale built cache). Ward 68's pixels are scored like the old box's, and
 * cells outside the polygon are excluded from every block exactly as cloud is:
 *
 *     scale   m/cell    n   physics     veg   built     gap   wards in the row
 *     x1          68   85     0.184   0.225   0.135  -0.041   all three
 *     x2         135   85     0.271   0.307   0.205  -0.036   all three
 *     x3         203   85     0.334   0.369   0.264  -0.035   all three
 *     x5         338   84     0.392   0.431   0.325  -0.039   all three
 *     x7         473   55     0.561   0.566   0.533  -0.005   Barrackpore, Baruipur ONLY
 *
 * x7 HAS NO BALLYGUNGE ROWS: a 0.93 km² polygon cannot hold the nine 470 m blocks
 * a correlation needs. So the x7 gap, and the artefact's own `verdict` line (which
 * compares x1 against x7 and now reads "closes"), compare different ward mixes and
 * must not be read as the gap closing. Like for like, x1-x5 over all three wards,
 * the gap is flat at -0.035 to -0.041 — the 2026-08-05 conclusion stands, and
 * Ward 68 alone is further behind the vegetation null at every scale (-0.09 x1,
 * -0.15 x5; physics r 0.09 -> 0.21) than the old box was (-0.03, -0.04; r 0.20 ->
 * 0.41). `gapAtCoarsest` below is therefore the coarsest factor ALL THREE wards
 * reach, x5, not x7. On the old 1400 m box with the corrected forcing the same
 * sweep read x1 0.217 / x5 0.456, gaps -0.021 / -0.024 (x7), so the move is the
 * ward, not the forcing.
 */
export const SCALE_SKILL = Object.freeze({
  /** the published comparison: one ECOSTRESS cell */
  blockM: 68,
  rModelBlock: 0.184,
  /** coarsened to ~5x5 ECOSTRESS cells — neighbourhood scale */
  neighbourhoodM: 338,
  rModelNeighbourhood: 0.392,
  /** the gap to the vegetation null at x1 and at x5, the coarsest factor all three
   *  wards reach (see the 2026-10-03 note above: x7 holds no Ward 68 rows) */
  gapAtBlock: -0.041,
  gapAtCoarsest: -0.039,
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
 * Re-measured by driving the REAL solver (scripts/measure-shipped-amplitude.py).
 * RE-RUN 2026-08-13 on the CORRECTED building raster — the numbers below are not
 * the 2026-08-05 ones. The built cache these figures were scored against had been
 * stale for nine days (Microsoft footprints after the shipped set moved to
 * Overture), so every SD here was measured against buildings we had stopped
 * drawing. Correcting it lowered the model's own amplitude, which is why the
 * over-draw improves and the correlations move slightly down:
 *
 *   phase   n   SD ship  SD equil  SD obs |  r ship  r equil  r veg(diffused)
 *   day    37     1.63K     2.07K   1.32K |   0.380    0.300            0.397
 *   night  50     0.68K     0.88K   0.64K |   0.236    0.154            0.251
 *   all    87     1.08K     1.39K   0.93K |   0.297    0.216            0.313
 *
 * So the shipped map scores 0.297, not 0.216 — we were understating our own
 * product by about 37 % by validating the wrong field.
 *
 * THE CLAIM IS STILL UNCHANGED, and the control is why. 0.297 sits above the old
 * published vegetation null of 0.238, which reads like the model finally winning.
 * It is not: smoothing lifts correlation against a coarse, noisy target for ANY
 * field. Re-running the null through the IDENTICAL solver, with albedo and built
 * held flat so vegetation is the only thing varying, gives 0.313. The model is
 * behind by 0.016 overall and in both phases separately — a WIDER gap than the
 * 0.010 measured on the stale raster, not a narrower one. The gain was the
 * smoothing, not the physics — and the null below is now that like-for-like one,
 * not a raw layer.
 */
/*
 * RE-MEASURED 2026-10-03: BALLYGUNGE IS THE KMC WARD 68 POLYGON, AND THE FORCING IS
 * THE CORRECTED ONE. The model still runs over Ballygunge's whole 1800 m square at
 * the browser's 247 grid; a ward-scene is SCORED on the ECOSTRESS pixels inside the
 * polygon. Barrackpore and Baruipur are unchanged in method, and the two effects
 * were separated by re-running the old 1400 m box on today's forcing:
 *
 *                            n   r ship  r veg(diff)  amplitude  r built  anom RMSE
 *   old box, old forcing    87    0.297        0.313      1.17x    0.177     1.59 K
 *   old box, new forcing    87    0.297        0.313      1.17x    0.177     1.59 K
 *   Ward 68, new forcing    85    0.261        0.308      1.11x    0.135     1.53 K
 *
 * THE FORCING CORRECTION MOVED NOTHING HERE (no figure by more than 0.005, though
 * 32 of the 50 night ward-scenes were re-forced), so the whole change is the ward. Barrackpore's and
 * Baruipur's rows are identical between the old-box and Ward 68 runs. Ballygunge
 * alone: r ship 0.263 -> 0.145, vegetation null 0.283 -> 0.265, observed SD 0.86 ->
 * 0.68 K, 29 -> 27 scenes (two fall below 12 clear polygon pixels).
 *
 * WHY WARD 68 SCORES LOWER, MEASURED RATHER THAN ASSUMED. It is the ward, not the
 * pipeline: on the OLD grid with the OLD layers, the Ward 68 part of the old box
 * already scored built r +0.05 against +0.14 for the rest of the box, with observed
 * SD 0.66 K against 0.87 K. Ward 68 is uniformly dense (built 0.36, FVC 0.22) and
 * leaves the satellite little within-ward contrast to find. Registration was
 * checked (vegetation peaks un-shifted and un-mirrored; built is oriented to
 * vegetation), and the Overture release swap was ruled out (old and new footprint
 * sets score r 0.073 against 0.076 on identical pixels).
 *
 * The 2026-08-13 night-forcing caveat that stood here is retired: these are the
 * corrected-forcing figures.
 */
/*
 * RE-MEASURED 2026-10-05: THE PER-CELL VENTILATION FACTOR IS GONE. The solver's
 * convective term carried `max(0.15, 1 − 0.55·built + 0.65·water)`, which no fit
 * had seen. Scored with and without it on the same 85 ward-scenes
 * (measure-shipped-amplitude.py, paired by ward-scene, 10,000-draw bootstrap):
 *
 *                     r ship (95 % CI)        r veg(diff)  amplitude
 *   with factor       0.261 [0.205, 0.316]    0.308        1.11x
 *   without factor    0.267 [0.211, 0.323]    0.306        0.97x
 *   difference        +0.006 [+0.004, +0.009], better in 68 of 85 ward-scenes
 *
 * Every ward and both phases improved without it (Ward 68 +0.013, Barrackpore
 * +0.004, Baruipur +0.002; day +0.008, night +0.005). It did not help place the
 * heat, so it was removed and the page now draws the field the bands were
 * calibrated on (known-limitations §18). The vegetation null still wins. Amplitude
 * moves from over-drawn to about right overall; Ward 68 alone now draws 0.56 K
 * against an observed 0.68 K (0.82x), so its contrasts are slightly understated.
 */
export const SPATIAL = {
  /** ward-scenes scored (3 wards x near-nadir scenes, after cloud/QC masking; Ballygunge
   *  on the Ward 68 polygon's pixels) */
  n: 85,
  /** correlation of the SHIPPED field — TsHeatSim, diffused — with ECOSTRESS */
  rModel: 0.267,
  /** vegetation through the SAME solver: the like-for-like null, which still wins */
  rVegOnly: 0.306,
  /** built fraction alone, raw */
  rBuiltOnly: 0.135,
  /**
   * The map's within-ward spread against the observation's. 1.11 means the colour
   * range inside a ward is about a tenth wider than ECOSTRESS measures — the one
   * defect here a reader can actually SEE, which is why it is now stated. (1.17 on
   * the old 1400 m Ballygunge box; Ward 68 alone draws 0.70 K against an observed
   * 0.68 K, and the night phase on its own is 0.99x.)
   *
   * Was 1.44 until 2026-08-13. That figure was not a physics change: the raster it
   * was scored against still held Microsoft footprints nine days after the shipped
   * geometry moved to Overture, and the denser stale set gave the model more
   * contrast to draw. Do not read the drop as a model improvement — it is a
   * measurement that had been wrong. See docs/evidence/known-limitations.md.
   */
  amplitudeRatio: 0.97,
  /** RMSE that remains once ward-mean bias is removed, K */
  anomalyRmseK: 1.53,
  /**
   * User-facing, shown wherever the field's detail could be over-read.
   *
   * Three tiers on purpose. The old wording gave the reader only "measured" and
   * "illustrative", which told them where NOT to trust the map and nothing about
   * where they could. The scale sweep earned the middle tier.
   */
  note: 'Ward-level temperature is calibrated against ECOSTRESS. The pattern WITHIN a '
      + 'ward is not: block by block it scores r = 0.27, still below the r = 0.31 of a '
      + 'vegetation map given the same treatment, and coarsening the comparison does not '
      + 'close that gap at any scale. At neighbourhood scale (~300-500 m) it reaches '
      + 'r = 0.4, but only about 0.2 in KMC Ward 68, whose dense, uniform fabric leaves '
      + 'the satellite little pattern to match. The colour range inside a ward is close '
      + 'to what the satellite measures (0.97x), though about 0.8x in Ward 68, where '
      + 'contrasts are slightly understated. '
      + 'Ward figures are measured, neighbourhood contrast is indicative, block-by-block '
      + 'detail is illustrative.',
} as const;

/**
 * Building heights against ICESat-2 ATL03 photon transects — mirrored from
 * `data/calibration/icesat2-heights.json`; method and thresholds pre-registered
 * in docs/superpowers/specs/2026-08-06-icesat2-height-validation-design.md §5.3.
 *
 * THE VERDICT IS `underpowered`, AND THAT IS A RESULT ABOUT THE EVIDENCE, NOT
 * ABOUT THE HEIGHTS. n = 28 distinct crossed buildings against a pre-registered
 * minimum of 30. Below that bar §5.3 admits no statistic at all, so this block
 * carries NO bias, NO interval, NO p-value and NO effect size — not as a
 * footnote, not "for reference". A number printed beside `underpowered` gets
 * quoted with the verdict dropped, which is the whole reason the bar was fixed
 * in advance. `assertAccuracyLogic()` fails if any such field or phrasing
 * reappears while the verdict stands.
 *
 * CORRECTION 2026-08-07 — THIS REPLACES A `validated` CLAIM PUBLISHED THE SAME
 * DAY. The 2026-08-06 run reported n = 30 (the bar hit exactly), a median
 * difference inside one storey, and shipped as `validated`. That run's GROUND
 * REFERENCE was contaminated. The ground line is built from photons falling
 * outside every mapped footprint, and Overture does not map every building: in
 * dense Ballygunge a 30 m ground window can be ~100 % roof returns from an
 * unmapped structure, whereupon the rolling low quantile lands on that roof and
 * the median-refinement pass re-centres on the same roof photons — a stable
 * fixed point tens of metres up. Measured across the committed subsets, 5 of 31
 * passes carried a ground line above +25 m, worst 84.68 m in a ward whose true
 * ground is 3-6 m. Spec §5.1's G1b gate exists to catch precisely that ("above
 * +25 m the line has climbed onto rooftops") and could not, because it tests the
 * PASS MEDIAN — 4.46 m on the 84.68 m pass. Wrong granularity, not a wrong idea.
 * The gate is now applied per window, and the line is not bridged across a
 * refused one. The buildings that lose their ground reference are the marginal
 * ones that had carried n to the bar, so the honest n is 28 and the honest
 * outcome is the pre-registered `underpowered`. Nothing was relaxed to recover
 * 30, and nothing may be: the finding IS that 30 was never really reached.
 *
 * DISTRIBUTIONAL, NEVER PER BUILDING — unchanged, and it applies at every
 * verdict. ATL03's horizontal geolocation is ~3-5 m against 10-20 m Kolkata
 * buildings, so any single photon may have landed on the neighbour. The
 * comparison only ever asks what the height POPULATION along a transect looks
 * like, and no per-building height is published from it at any n.
 *
 * AND THE SAMPLE IS THE LARGEST BUILDINGS ONLY — two selections, not one. A
 * footprint has to survive a 5 m erosion, the geolocation error, before a photon
 * may be assigned to it: 995 survive in Ballygunge's OLD 1400 m box (28.2 % of
 * its buildings), 719 of 4,702 in Barrackpore (15.3 %), 326 of 4,538 in Baruipur
 * (7.2 %) — in Baruipur, the largest one building in fourteen. Then the beam
 * has to have put at least MIN_ROOF_PH = 5 photons on the roof, which removed 26
 * of the 59 crossed buildings here. Neither can be relaxed to widen the sample:
 * shrinking the erosion admits photons that may belong to the neighbour, and
 * dropping the photon bar makes the per-building p75 lean on its single highest
 * photon. So the wording is "along satellite transects", never "all buildings"
 * (spec §5.4).
 *
 * THIS WHOLE BLOCK DESCRIBES THE OLD 1400 m BALLYGUNGE BOX, and was not
 * re-measured when Ballygunge became KMC Ward 68 (2026-10-03). It cannot be
 * from what is committed: the photon subsets in data/calibration/icesat2/ were
 * clipped to the old box plus 200 m and reach only 22.5199 N, while Ward 68 runs
 * south to 22.5161 N, so its southern ~420 m has no photons at all; and a
 * re-score against the regenerated footprints is refused by design — tried
 * 2026-10-03, measure-height-accuracy.py raises GroundLineDrift on the first
 * Ballygunge subset (ground median 4.251 m against the 4.35 m it was gated on,
 * tolerance 0.05 m). The honest re-run is a fresh fetch-icesat2.py sweep over
 * the new square (multi-GB ATL03 downloads), not a re-score. What CAN be re-measured offline is the erosion
 * survivor share on the new building set, by the same rule
 * (`_icesat2.assign_footprints`, -5 m): 1,866 of the square's 7,931 (23.5 %),
 * and 542 of Ward 68's 2,207 `inWard` buildings (24.6 %). The same rule
 * reproduces the old box's 995 (28.2 %). `survivorPctRange` and every count
 * below stay the artefact's, because the test holds them to it.
 *
 * WIN 4 SURVIVES INTACT, and it is the one measurement here that is not about
 * building heights at all: the shipped ~30 m relief surface sits ~6.6 m ABOVE
 * decimetre-class laser ground. It is untouched by the ground-line correction —
 * it is the median over the two distinct reference ground tracks of each track's
 * per-pass DEM-minus-laser offset, recorded when each subset was written — and
 * it gates nothing, because no part of the heat model reads that surface.
 *
 * WORTH RE-ASKING, NOT WORTH PUBLISHING. The artefact's `method_stability` block
 * records what the two ground-line constants are worth. The relief allowance is
 * not load-bearing: every value from 6 m to 20 m returns the same
 * `underpowered`. The rolling window width is a different story, and it is
 * recorded there rather than here precisely because it is a fact about the
 * METHOD's reach and not a result about the city. ICESat-2 is still flying these
 * tracks and the beams wander up to 726 m across-track between cycles, so new
 * passes do bring new buildings; the question is worth re-running, not
 * re-answering by choosing a constant.
 *
 * HOW THIS METHOD SITS AGAINST PUBLISHED PRACTICE (2026-08-07, spec §9). A
 * literature search was run AFTER the verdict was published. It moved nothing —
 * no threshold, no estimator, no verdict — and it is recorded here in full,
 * including the half that does not flatter us, because a search whose
 * unfavourable findings are dropped is not a check.
 *
 *   AGAINST US:
 *   - THE ~11 m FOOTPRINT IS A SECOND FAILURE MODE THE 5 m EROSION DOES NOT
 *     ADDRESS. The erosion targets geolocation error, and for that it is well
 *     supported: ATL03's on-orbit horizontal accuracy is 3.5 ± 2.1 m against a
 *     6.5 m requirement (Magruder et al. 2021, doi:10.1029/2020EA001414;
 *     Luthcke et al. 2021, doi:10.1029/2020EA001494). But a photon is not a
 *     point — the ground spot measures 10.9 ± 1.2 m on orbit (Magruder 2021),
 *     so a perfectly geolocated spot straddling a roof edge still returns a
 *     BLEND of roof and street. Wang et al. 2024 (doi:10.1109/TGRS.2024.3383600)
 *     measure the boundary blur at ≈6 m horizontal RMSE, reducible to ≈1 m only
 *     by deconvolving the spot, which we do not do. On a 10-20 m building the
 *     mixing length is comparable to the building, so this is a limit on what
 *     the claim can MEAN and it is in the note.
 *   - p75 HAS NO PUBLISHED SUPPORT IN EITHER DIRECTION. The two published
 *     percentile sweeps both test {50,60,70,80,85,90,95} and skip 75. Published
 *     roof estimators are p90 (Wu, Huang & Zhao 2023, doi:10.3390/rs15153786;
 *     Hu et al. 2026, doi:10.3390/rs18040540), filtered max (Cai et al. 2024,
 *     doi:10.3390/rs16020263), mean (Dandabathula et al. 2021,
 *     doi:10.1088/2634-4505/abf820) and p50 (Wu, Z. 2022 TU Delft MSc thesis,
 *     not peer reviewed). Spec §5.2.4's argument — at n = 5 numpy's p75 index
 *     lands on the second-highest photon — is coherent and is OURS, not the
 *     field's. It stands; switching to p90 after seeing `underpowered` would be
 *     a post-hoc estimator change, the same error as moving the bar.
 *   - OUR 2.0 m ROOF-BAND FLOOR IS MORE PERMISSIVE THAN EVERY PUBLISHED FLOOR:
 *     2.5 m (Hu 2026; Liu et al. 2024, doi:10.3390/s24186076) and 2.8 m (Cai
 *     2024). And UNVERIFIED but high-consequence: Lao et al. 2021
 *     (doi:10.1016/j.jag.2021.102596, full text inaccessible) is reported to say
 *     ATL03's own noise removal already discards building photons below ~3 m,
 *     which would mean our 2-3 m band is partly pre-emptied upstream and
 *     `roofPhotonsBelowFloor` understates what the chain removed. Recorded as
 *     unverified, not as a finding.
 *   - THE GROUND REFERENCE IS OUR LEAST-GUARDED COMPONENT. ATL08 clamps ground
 *     to within 6 m of a reference DEM; Cai 2024 adds independent Sentinel-2
 *     land cover, a FABDEM stratifier and a relief filter. We have ONE guard and
 *     it is derived from the pass's own median — the very line that may be
 *     corrupted. Closing it with an external DEM guard is DEFERRED to separate,
 *     pre-registered work and is deliberately NOT done here: adding it in the
 *     same change that records the literature, having seen n = 28, would be
 *     indistinguishable from tuning the ground line until the cohort clears.
 *
 *   FOR US, and it does not cancel the above:
 *   - `GROUND_RELIEF_M` = 10 m, derived from measured ward relief, is the same
 *     number Cai 2024 tuned independently — and our refusal to bridge across a
 *     refused window is stricter than their delete-and-continue.
 *   - MIN_ROOF_PH = 5 is stricter than nearly the whole literature (most papers
 *     state no minimum at all; one states ≥ 10), and Kaya 2024
 *     (doi:10.3390/buildings14113571), the only empirical test of photon count,
 *     finds accuracy best at 5-10 photons and degrading above 100.
 *
 *   AND THE FIELD CONTEXT FOR n = 28, which is in the note because without it a
 *   reader concludes the sweep failed badly. Published studies split into
 *   hand-curated cohorts of n ≈ 10-82 (Dandabathula 2021 n=10 Jaipur; Wang 2024
 *   n=23; Goud & Bhardwaj 2021 n=30; Lao 2021 n=82; Watson & Elliott 2025,
 *   doi:10.1038/s41598-025-15929-2, n=25 per city across Nairobi, Quito and
 *   Kathmandu) and automated ones of n ≈ 10³-10⁵ at RMSE 4-8 m. n = 28 sits near
 *   the median of the lower cluster. TWO CAVEATS TRAVEL WITH THAT: the lower
 *   cluster's sub-metre errors come from hand-picking buildings with clean
 *   ground AND clean roof, so they are a selection artefact and are not
 *   achievable at scale — our automated pipeline belongs nearer the 4-8 m
 *   cluster — and no ICESat-2 building-height study exists for Kolkata, Dhaka or
 *   the Ganges delta at all. THE BAR STAYS AT 30. It reflects what we chose in
 *   advance; lowering it now that it binds, on the strength of a literature we
 *   read afterwards, is precisely the outcome-driven tuning the pre-registration
 *   exists to prevent.
 *
 * Regenerate with: python3 scripts/measure-height-accuracy.py
 */
export const HEIGHTS = {
  /** pre-registered outcome (spec §5.3). Below the bar, so nothing else ships */
  verdict: 'underpowered',
  /** distinct buildings measured, photons pooled across every pass */
  nBuildings: 28,
  /** the pre-registered minimum. nBuildings < this: that IS the verdict */
  minBuildings: 30,
  /** overpasses pooled, and the distinct ground tracks they re-fly */
  nPasses: 31,
  nRgts: 2,
  /** where the cohort lives — it is not spread over the three wards */
  topWard: 'ballygunge',
  topWardBuildings: 25,
  /** footprint erosion, m, and the share of each ward that survives it */
  erosionM: 5,
  survivorPctRange: [7.2, 28.2],
  /** the SECOND selection: roof photons a crossed building needs to contribute */
  minRoofPhotons: 5,
  buildingsCrossed: 59,
  buildingsTooFewRoofPhotons: 26,
  /**
   * The roof band's lower edge, m, and the photons it discarded across the whole
   * sweep. Still disclosed at `underpowered`: it is a statement about what this
   * instrument resolves over a rooftop and about which buildings the method can
   * see, which is exactly the kind of thing an underpowered result still owes a
   * reader. It stays at 2.0 m.
   */
  roofFloorM: 2.0,
  roofPhotonsBelowFloor: 313,
  /**
   * The §5.1 pointwise relief gate (CORRECTION 2026-08-07): the allowance in
   * metres, the ground windows it refused, and the crossed buildings that lost
   * their ground reference to it. 10 m is measured, not preferred — the ward
   * relief artefacts record spans of 4.9-8.9 m across a 1.4 km box with
   * 1.5-2.1 m of their own per-cell RMSE, and the rooftops this must catch stand
   * 11-36 m up. Every allowance from 6 m to 20 m gives the same verdict.
   */
  groundReliefM: 10,
  groundWindowsGated: 27,
  buildingsGroundRefused: 2,
  /**
   * Win 2, the 2.5 m Google fill audit, did not reach its bar either: 5 crossed
   * fill buildings against a required 10. No fill number is published, and the
   * note says nothing about the fill — an underpowered cohort has no result to
   * quote.
   */
  fill: { n: 5, minN: 10, verdict: 'underpowered' },
  /**
   * Win 4, free along the same transects: the shipped ~30 m relief surface sits
   * this far ABOVE decimetre-class laser ground, in metres. Measured, and it
   * gates nothing — no part of the heat model reads it, and the height
   * comparison takes its ground line from the photons themselves, never from the
   * DEM. Unaffected by the ground-line correction.
   */
  demMinusLaserGroundM: 6.55,
  /**
   * User-facing, on the building card's Height row.
   *
   * Every clause is load-bearing and each has a guard in `assertAccuracyLogic()`:
   * the distributional scoping, the transect frame, the ~11 m footprint spot, the
   * 5 m erosion and the 5-photon bar that between them restrict the sample, the
   * n-under-the-bar and the one-ward concentration, the field context for that n,
   * the reason n fell short, and the relief-surface offset that survives. The
   * guards that used to hang off `verdict !== 'validated'`
   * are unconditional now: a changed verdict must not be able to disarm the
   * disclosures, which was how five of them could have gone quiet at once.
   *
   * TWO CLAUSES ADDED 2026-08-07 FROM THE LITERATURE (spec §9), and only two:
   * the ~11 m footprint spot, because it limits what the claim itself can mean
   * and no erosion addresses it; and the field context for n = 28, because
   * without it a reader takes a shortfall of two buildings for a failed sweep.
   * Everything else the search turned up — the unsupported p75, the permissive
   * floor, the least-guarded ground reference — is in the block comment above
   * and in docs/heat-map-feature.md, where it does not cost a reader of a
   * building card the clauses that actually change how they should read this.
   */
  note: 'ICESat-2 could not confirm our heights, and the honest answer is that there is '
      + 'not yet enough evidence to try. The check is scoped in distribution, '
      + 'not individual buildings — laser geolocation (~3-5 m) against 10-20 m buildings '
      + 'means no photon can be pinned to one roof, and each photon is a return from a '
      + '~11 m spot on the ground, so a spot on a roof edge blends roof and street '
      + 'however well it is aimed. It runs along satellite transects, '
      + 'over only those buildings large enough to survive a 5 m erosion (the largest '
      + '7-28 % of each ward) and hit by at least 5 roof photons. It was run before '
      + 'Ballygunge became KMC Ward 68, over the earlier 1.4 km Ballygunge area, and its '
      + 'transects stop short of Ward 68\'s southern blocks. That leaves '
      + 'n = 28 buildings against a pre-registered minimum of 30, and 25 of the 28 sit '
      + 'in one ward, so the outcome is underpowered and no difference, interval or test '
      + 'statistic is published from it. A cohort of 28 is ordinary for this field — '
      + 'published studies that check buildings by hand mostly run 10-80 of them — so '
      + 'what fell short is the bar we set ourselves in advance, and that bar stays where '
      + 'it is. The shortfall is a correction, not bad luck: an '
      + 'earlier run reached 30, but measured against a ground reference that was wrong '
      + 'where our building map is incomplete — an unmapped building can fill a 30 m '
      + 'ground window with roof returns and pull the ground line tens of metres up — and '
      + 'refusing those stretches is what removed the marginal buildings. One measurement '
      + 'along the same transects is unaffected and stands: the shipped relief surface '
      + 'sits about 6.6 m above laser ground. Nothing here establishes that any one '
      + 'building\'s height is right.',
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
 *     morning_landsat     hours 10.39–10.41  LOO-overpass 2.25 K   n=213  (wrong wind, below)
 *     peak_ecostress      hours 11.76–17.45  LOO-overpass 2.40 K   n=24
 *     night               hours 0.7–23.84    LOO-overpass 2.79 K   n=50
 *
 * That table is the 2026-08-02 campaign, scored with Ballygunge as the OLD 1400 m
 * box and before the sun-up bar and the forcing-date correction. The artefact
 * today (Ballygunge = KMC Ward 68 polygon, 2026-10-03) reads morning_ecostress
 * LOO 6.29 K n=9, peak_ecostress 2.36 K n=23, night 2.78 K n=50.
 * TRANSITION_RMSE_K keeps the campaign's 7.54 K, the larger and so the more
 * cautious of the two; moving it is a reviewed change.
 *
 * EVERY LANDSAT FIGURE ABOVE WAS SCORED AT THE WRONG WIND, from the campaign
 * (commit 4ce2585) until 2026-10-05. build-ward-observations.py wrote Landsat rows
 * with raw NASA POWER m/s while ECOSTRESS rows and this page use wind/3 clamped to
 * 0.3–2.5, so every Landsat ward-scene was scored with about three times the
 * convective cooling the page applies. The "2.25 K" and the later "2.13 K" both
 * described a model nobody runs, and their small LOO came from removing a large
 * wind-induced bias (−2.49 K). Scored at the page's wind, morning_landsat is
 * RMSE 2.91 K, bias +0.36 K, LOO-overpass 2.95 K, n=212 over 50 overpasses
 * (known-limitations §17; `build-ward-observations.py --check` now holds both
 * instruments to one transform).
 *
 * Sunrise to mid-morning is where a STEADY-STATE model has least to work with:
 * the surface is still shedding stored heat while the sun is already loading it,
 * and an equilibrium solution cannot represent a system that is not near
 * equilibrium. 7.54 K is two and a half times the daytime band.
 *
 * The upper bound stops at 9.5 rather than 11.06 because Landsat's 212 scenes
 * pin 10:30 at 2.95 K out of sample — inside the ±4.5 K daytime band and less than
 * half the 7.54 K transition figure, so the stratum is only unreliable BEFORE that
 * anchor, and shading the good hours would overstate the caveat. Re-derived on the
 * corrected wind 2026-10-05: the bound holds. It also holds for the field the page
 * DRAWS rather than the calibrated equation (3.23 K out of sample, known-limitations
 * §18 "displayed vs calibrated").
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
    // The shown band must never understate the error under the method the page
    // NAMES. Comparing to modelRmseK alone was the hole: it is the in-sample fit,
    // and /uncertainty describes leave-one-overpass-out. Both are checked now.
    a(x.bandK >= x.modelRmseK, `${k}: displayed band understates in-sample error`);
    a(x.bandK >= x.looOverpassRmseK, `${k}: displayed band understates OUT-OF-SAMPLE error`);
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
  /* Since 2026-10-05 the map draws about the satellite's contrast (0.97x). The note
     must say which side of 1 it sits, because that is what a reader can SEE. */
  a(SPATIAL.amplitudeRatio < 1.0 ? SPATIAL.note.includes('understated') : SPATIAL.note.includes('wider than the satellite'),
    'the note must state which way the amplitude errs — re-run '
    + 'scripts/measure-shipped-amplitude.py rather than editing the number');
  a(SPATIAL.note.includes('neighbourhood'),
    'the note must carry the MIDDLE tier: block-scale detail is illustrative but '
    + '~300-500 m contrast is indicative at r = 0.5. Dropping it leaves the reader '
    + 'knowing only where not to trust the map, which the measurement does not require');
  a(SPATIAL.note.includes('not') && SPATIAL.note.includes('illustrative'),
    'the spatial note must state plainly that within-ward detail is not measured');

  // HEIGHTS: here the WORDING is the deliverable, and the verdict is
  // `underpowered`, which is the easiest of all outcomes to launder — either by
  // quoting a number the verdict withheld, or by letting the disclosures lapse
  // because the guard that carried them was written as "unless validated".
  //
  // SO NONE OF THESE IS AN IMPLICATION ON A VERDICT THAT IS NO LONGER HELD.
  // The previous block had five guards of the form `verdict !== 'validated' ||
  // ...`; the moment the verdict moved, all five went vacuous together while the
  // note went on making the claims they protected. The disclosures below are
  // unconditional, and the two that MUST key on the verdict key on the verdict
  // the artefact actually reports, so they fire rather than fall silent.

  // `as const` narrows these to the literals 28 and 'underpowered', so a guard
  // written against any OTHER value is a ts(2367) "no overlap" compile error
  // rather than a check. That is backwards here: these guards exist precisely to
  // fire when the values change, so they must be written against the widened
  // types. Read through these two, never through HEIGHTS directly.
  const nHeights: number = HEIGHTS.nBuildings;
  const heightsVerdict: string = HEIGHTS.verdict;
  const fillVerdict: string = HEIGHTS.fill.verdict;

  // 1. n AND THE VERDICT ARE THE SAME FACT, in both directions. `underpowered`
  //    means exactly "under the bar", so either half moving without the other is
  //    a mistranscription of the artefact.
  a((nHeights < HEIGHTS.minBuildings) === (heightsVerdict === 'underpowered'),
    `n = ${HEIGHTS.nBuildings} against a bar of ${HEIGHTS.minBuildings} does not agree `
    + `with the verdict "${HEIGHTS.verdict}" — re-run scripts/measure-height-accuracy.py `
    + 'and mirror what it wrote; never adjust one of the two by hand');
  // 2. BELOW THE BAR, NO STATISTIC MAY EXIST AT ALL — not in a field, not
  //    "for reference". Spec §5.3 admits none, and a number sitting beside
  //    `underpowered` gets quoted with the verdict dropped. Written over the
  //    object's own keys so that re-adding `medianBiasM` or `p65Ci95M` trips it
  //    without anyone having to remember to extend this list.
  const heightStatKeys = Object.keys(HEIGHTS).filter(
    (k) => /bias|ci95|perm[_]?p|ks[_]?d|pvalue|p_value/i.test(k));
  a(heightsVerdict !== 'underpowered' || heightStatKeys.length === 0,
    `the heights cohort is underpowered but HEIGHTS still carries `
    + `${heightStatKeys.join(', ')} — spec §5.3 publishes no bias, interval, effect size `
    + 'or p-value below the pre-registered bar');
  // 3. ... and prose may not reinstate what the fields withhold. This is the
  //    likelier failure: nobody re-adds `medianBiasM`, they write "+1.3 m" into
  //    the sentence. The relief-surface offset is deliberately NOT caught — it is a
  //    measurement of a DSM, not a statistic of this cohort — and guard 8 pins it.
  a(heightsVerdict !== 'underpowered'
    || !/\bbias(ed)?\b|\bCIs?\b|confidence interval|\b9[05] ?%|excludes zero|understate|\bp65\b|percentile|significan/i
      .test(HEIGHTS.note),
    'the heights cohort is underpowered, so the note may not quote a difference, an '
    + 'interval, a percentile or a significance claim — the verdict withheld them and '
    + 'prose must not put them back');
  // 4. the verdict must be NAMED to the reader, not merely encoded in a field
  a(heightsVerdict !== 'underpowered' || HEIGHTS.note.includes('underpowered'),
    'the note must say the word "underpowered": a reader who is not told the outcome '
    + 'will read a page of caveats as a soft yes');
  // 5. and it must say WHY n fell short. Without this the shortfall reads as bad
  //    luck — "not enough passes yet" — when it was a corrected defect in the
  //    ground reference, which is a different fact with a different remedy.
  a(heightsVerdict !== 'underpowered' || HEIGHTS.note.includes('ground reference'),
    'the note must say that the ground reference was the reason n fell short, not '
    + 'merely that it did — spec §5.1, CORRECTION 2026-08-07');
  a(!/\bvalidated\b/.test(HEIGHTS.note) || heightsVerdict === 'validated',
    'the note claims the heights are validated but the recorded verdict is not — '
    + 'rewrite the note to the verdict the artefact actually reports');

  // 6-9. THE DISCLOSURES, UNCONDITIONAL. Each is true of this instrument at
  // every n and every verdict, so none of them may hang off one.
  a(HEIGHTS.note.includes('in distribution'),
    'the heights claim must be scoped to the DISTRIBUTION. Without those words the '
    + 'sentence claims the buildings themselves were checked');
  a(HEIGHTS.note.includes('not individual buildings'),
    'the heights note must disclaim per-building accuracy — ATL03 geolocation forbids '
    + 'attribution, so no sample size ever earns that claim');
  a(HEIGHTS.note.includes('transect'),
    'the heights note must name the transect sampling frame: this is not a survey of '
    + 'the ward, only of buildings a satellite ground track happened to cross');
  a(HEIGHTS.note.includes('erosion'),
    'the note must state the 5 m erosion — it is what restricts the sample to the '
    + `largest ${HEIGHTS.survivorPctRange[0]}-${HEIGHTS.survivorPctRange[1]} % of each `
    + 'ward, and a reader who does not know it will generalise to small buildings');
  // the SECOND selection, which the old block never disclosed: 26 of the 59
  // crossed buildings were removed by the photon bar, not by the erosion
  a(HEIGHTS.note.includes(`${HEIGHTS.minRoofPhotons} roof photons`),
    `${HEIGHTS.buildingsTooFewRoofPhotons} of ${HEIGHTS.buildingsCrossed} crossed `
    + 'buildings were removed by the roof-photon bar, so it selects the sample as surely '
    + 'as the erosion does and the note must state it too');
  // 10. the one-ward concentration, unchanged
  a(HEIGHTS.topWardBuildings * 2 <= nHeights || HEIGHTS.note.includes('one ward'),
    `${HEIGHTS.topWardBuildings} of ${HEIGHTS.nBuildings} buildings sit in a single ward `
    + '— the note must say so rather than let three ward names imply three samples');
  // 11. "exactly" was true of n = 30 and is a lie at any other n
  a(nHeights === HEIGHTS.minBuildings || !HEIGHTS.note.includes('exactly'),
    `n is now ${HEIGHTS.nBuildings} against a bar of ${HEIGHTS.minBuildings}, so the `
    + 'note may no longer say the bar was hit "exactly"');
  // 12. THE RELIEF-SURFACE OFFSET. It survives the correction and is the one number the
  //     note may still quote, so it must be the artefact's — a stale figure here
  //     would be the single easiest thing to leave behind in a rewrite.
  const dsmQuoted = HEIGHTS.note.match(/about ([\d.]+) m above laser ground/);
  a(!!dsmQuoted
    && Math.abs(Number(dsmQuoted[1]) - HEIGHTS.demMinusLaserGroundM) < 0.05,
    `the note must quote the measured DEM-minus-laser offset (${HEIGHTS.demMinusLaserGroundM} m) `
    + 'as "about X m above laser ground" — it is the only figure an underpowered '
    + 'verdict still permits, so it has to be the right one');
  a(HEIGHTS.fill.n >= HEIGHTS.fill.minN || fillVerdict === 'underpowered',
    'the 2.5 m fill cohort is under its own bar and must publish as underpowered');
  // Narrow to the CLAIM, not the word. A bare /fill/i trips on "landfill" and
  // "infill", and — worse — it forbade the honest disclosure that fill-height
  // buildings were excluded, which is a disclosure, not a result.
  a(fillVerdict !== 'underpowered'
    || !/2\.5 m fill|fill value (is|of|checks)/i.test(HEIGHTS.note),
    'the fill cohort is underpowered, so the note may make no claim about the 2.5 m '
    + 'fill value — an underpowered cohort has no result to quote');
  a(!/\b(all|every|each) buildings?\b/i.test(HEIGHTS.note),
    'spec §5.4: the published wording is "along satellite transects", never "all '
    + 'buildings" — the transects see only the largest 7-28 % of a ward');
  a(!/\b(no|not) significant\b|indistinguishable|statistically identical/i.test(HEIGHTS.note),
    'no omnibus test entered the verdict rule at any n, so the note must never claim '
    + 'one cleared the heights');
  a(!/heights are (right|correct|accurate)|confirms our heights|building heights are confirmed/i
    .test(HEIGHTS.note),
    'no wording may promote a distributional match to per-building correctness');

  // 13-15. THE LITERATURE CLAUSES (2026-08-07, spec §9). Two sentences entered
  // the note from the literature search and each is guarded, because the note is
  // edited far more often than it is re-derived and an unguarded caveat is a
  // caveat with a half-life.

  // 13. THE ~11 m FOOTPRINT SPOT — unconditional, like the other disclosures: it
  //     is a property of the instrument at every n and every verdict. It is NOT
  //     the geolocation clause beside it and must not be allowed to collapse into
  //     it. Geolocation is where the photon is (3.5 ± 2.1 m, Magruder 2021,
  //     doi:10.1029/2020EA001414) and the 5 m erosion answers it; the spot is how
  //     much ground the photon integrates (10.9 ± 1.2 m, same paper) and NOTHING
  //     in this pipeline answers it — Wang 2024 (doi:10.1109/TGRS.2024.3383600)
  //     measures ≈6 m of boundary blur, removable only by deconvolution we do not
  //     do. Drop this clause and the note reads as though the erosion had covered
  //     the whole geometry problem.
  a(/~?11 m (spot|footprint)/.test(HEIGHTS.note),
    'the note must disclose the ~11 m footprint spot: the 5 m erosion answers ATL03 '
    + 'GEOLOCATION error, not the ~10.9 m ground spot each photon integrates, and a spot '
    + 'straddling a roof edge blends roof and street however well it is geolocated '
    + '(spec §9.1) — the erosion clause alone implies a coverage this method lacks');
  a(!/~?11 m (spot|footprint)/.test(HEIGHTS.note)
    || /blends?|mix(es|ed)?|straddl|blur/.test(HEIGHTS.note),
    'the footprint clause must say what the spot DOES — blend roof and street — or it '
    + 'reads as one more number rather than the limit on the claim that it is (spec §9.1)');

  // 14. THE FIELD CONTEXT FOR n. Keyed on the verdict, because it only has a job
  //     while the cohort is under the bar: 28 is near the MEDIAN of the
  //     hand-checked ICESat-2 literature (n ≈ 10-82; spec §9.5), so a reader told
  //     only "underpowered" concludes the sweep failed badly, which is false.
  a(heightsVerdict !== 'underpowered'
    || (/ordinary for this field/.test(HEIGHTS.note) && /10-80/.test(HEIGHTS.note)),
    'the note must put n in its field context — published hand-checked ICESat-2 '
    + 'building-height cohorts run 10-80 buildings (spec §9.5) — or "underpowered" reads '
    + 'as a failed sweep rather than as a bar we set high on purpose');
  // 15. ... and that context must never become the excuse. The bar is the one
  //     thing §9.5 forbids the literature to touch: it was fixed before the data
  //     existed, and a bar that moves once it binds is not a bar. So the note may
  //     state that the bar HOLDS, never that it should give.
  a(!/\b(bar|minimum|threshold)\b[^.]{0,40}\b(lower|lowered|lowering|relax|relaxed|reduce|reduced|too (high|strict))\b/i
    .test(HEIGHTS.note),
    'the note argues for moving the pre-registered bar. The field context in spec §9.5 is '
    + 'context for the READING, never a reason to lower a bar that was fixed before the '
    + 'data existed — that is the outcome-driven tuning the pre-registration prevents');
}
