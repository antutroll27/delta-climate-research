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
 * may be assigned to it: 995 of 3,527 survive in Ballygunge (28.2 %), 719 of
 * 4,702 in Barrackpore (15.3 %), 326 of 4,538 in Baruipur (7.2 %) — in Baruipur,
 * the largest one building in fourteen. Then the beam has to have put at least
 * MIN_ROOF_PH = 5 photons on the roof, which removed 26 of the 59 crossed
 * buildings here. Neither can be relaxed to widen the sample: shrinking the
 * erosion admits photons that may belong to the neighbour, and dropping the
 * photon bar makes the per-building p75 lean on its single highest photon. So
 * the wording is "along satellite transects", never "all buildings" (spec §5.4).
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
   * the distributional scoping, the transect frame, the 5 m erosion and the
   * 5-photon bar that between them restrict the sample, the n-under-the-bar and
   * the one-ward concentration, the reason n fell short, and the relief-surface
   * offset that survives. The guards that used to hang off `verdict !== 'validated'`
   * are unconditional now: a changed verdict must not be able to disarm the
   * disclosures, which was how five of them could have gone quiet at once.
   */
  note: 'ICESat-2 could not confirm our heights, and the honest answer is that there is '
      + 'not yet enough evidence to try. The check is scoped in distribution, '
      + 'not individual buildings — laser geolocation (~3-5 m) against 10-20 m buildings '
      + 'means no photon can be pinned to one roof. It runs along satellite transects, '
      + 'over only those buildings large enough to survive a 5 m erosion (the largest '
      + '7-28 % of each ward) and hit by at least 5 roof photons. That leaves '
      + 'n = 28 buildings against a pre-registered minimum of 30, and 25 of the 28 sit '
      + 'in one ward, so the outcome is underpowered and no difference, interval or test '
      + 'statistic is published from it. The shortfall is a correction, not bad luck: an '
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
}
