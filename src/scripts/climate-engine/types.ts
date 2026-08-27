/**
 * Heat-sim engine ABI + pure physics helpers.
 *
 * Every backend (sim-gpu-webgl2.ts today; sim-ts.ts / sim-wasm.ts later) implements
 * HeatSim, so the worker/stage can swap engines without knowing which one it
 * holds (see caps.ts — `backend` is a preference, not a guarantee).
 *
 * The model (docs/heat-map-feature.md):
 *   dT/dt = D∇²T + S·(1-albedo)·sun − kRad·(T−Tsky) − L·veg − h·wind·(T−Tair) + Q·built
 * Grid units: dx = 1 cell. Explicit Euler; stability from cflDt/decayDt below.
 */

export interface GridSpec {
  /** N for the N×N grid. */
  n: number;
  /** metres per cell (labelling only — physics runs in cell units). */
  cellMeters: number;
}

/**
 * The intervention model is calibrated in cell units. All production analytical
 * results therefore use this one canonical grid until a separately versioned
 * metre-based recalibration and convergence study exists.
 */
export const CANONICAL_GRID_N = 192;
export const CANONICAL_GRID_VERSION = 'hm-grid-192-v1';

export function isCanonicalGrid(grid: GridSpec): boolean {
  return grid.n === CANONICAL_GRID_N;
}

/**
 * How hard `blendCanopyIntoVeg` (ward-raster.ts) redistributes `veg[]` toward tall
 * canopy. ZERO — the canopy raster is render-only and does NOT enter the temperature
 * solve. It shipped at 0.5 from 2026-08-10; this is the measured verdict on that.
 *
 * DO NOT "restore" 0.5. It looks like a mistake and is not. Once
 * `measure-spatial-accuracy.py` could finally apply the blend (2026-08-12; nothing in
 * Python had ever applied it, so it had never been scored), a full strength sweep over
 * 34 near-nadir ECOSTRESS scenes / 87 ward-scenes / 3 wards said this, monotonically:
 *
 *   strength      0.00     0.15     0.25     0.50 (was shipped)
 *   r_physics   0.2154   0.2145   0.2129   0.2076
 *   r_veg       0.2380   0.2321   0.2245   0.1987
 *   anom RMSE   1.8358   1.8308   1.8251   1.8061
 *
 * Four reasons, not one:
 *
 * 1. It monotonically DEGRADES spatial agreement with the thermal observation. The
 *    vegetation null loses 17% relative r; the physics predictor loses r too.
 * 2. Its one improving metric is an artefact. RMSE falls because the veg term's spatial
 *    SD falls with strength (0.64 -> 0.61) — largely via the operator's own [0,1] clamp,
 *    which bites 3-10% of cells — and measure-shipped-amplitude.py already records that
 *    the model draws ~2x the observed spatial SD. That is error reduced by COMPRESSING an
 *    over-drawn amplitude, not by getting the pattern right. Over-drawn amplitude is
 *    fixed at the amplitude, not by a canopy operator that happens to damp it.
 * 3. At 0.5 the implied tree:grass veg ratio is 4.9-8.1x. Schwaab et al. 2021 (Nat Commun
 *    12:6763, 293 European cities) puts tree cooling at 2-4x treeless green. Raw NDVI FVC
 *    is already in band at 2.0-2.7x; the blend pushed us out of it.
 * 4. It cannot use the information it appears to use. The operator is EXACTLY
 *    scale-invariant in height — `blend(2h) === blend(h)` bit-for-bit, because the target
 *    `vMean * h_i / hMean` cancels magnitude. It consumes only the normalised spatial
 *    pattern, and the pattern is the thing it makes worse. (Corollary: the CHM v2 accuracy
 *    gain, MAE 4.3 -> 3.0 m, could never have reached the physics through this path.)
 *
 * Full record: docs/evidence/known-limitations.md §1. The FUNCTION stays general and is
 * unit-tested at explicit non-zero strengths — only the shipped value is 0, so reverting
 * this decision is a one-constant change backed by a re-run of the sweep. The Python port
 * (scripts/_canopy.py BLEND_STRENGTH) is pinned to this value through the canopy parity
 * oracle, so the two cannot drift.
 */
export const CANOPY_BLEND_STRENGTH = 0;

/**
 * Whether `rasterWardBase` fills `SimLayers.water` from the ward's OSM polygons.
 * FALSE — the water layer is built, ported, oracle-checked, and NOT in the temperature
 * solve. This is the measured verdict on turning it on, taken the day it first became
 * measurable.
 *
 * DO NOT "restore" it to true because the zero layer looks like an oversight. It looked
 * like one for months and it was: `sim-ts.ts` has always READ this layer — a ventilation
 * boost `1 - 0.55*built + 0.65*water`, and a relaxation `next*(1 - 0.35*water) + (tAir -
 * 1.5)*0.35*water` — while `rasterWardBase` allocated it and never wrote it, so both terms
 * collapsed to the identity and every pond in three wards was solved as warm land. Filling
 * it is the obvious fix. It is also, measured, a worse model.
 *
 * The evidence, over the same 34 near-nadir ECOSTRESS scenes / 87 ward-scenes / 3 wards
 * the canopy sweep used, driving the REAL solver through scripts/sim-field-dump.mjs
 * (measure-shipped-amplitude.py — the equilibrium in measure-spatial-accuracy.py has no
 * water term and cannot see this at all):
 *
 *   r_shipped     0.3031 -> 0.2544      spatial SD  1.345 K -> 1.514 K  (observed 0.925 K)
 *   day           0.3883 -> 0.3593      amplitude over-draw  1.45x -> 1.64x
 *   night         0.2400 -> 0.1768
 *
 * Four reasons, not one:
 *
 * 1. It degrades agreement, and it degrades it IN PROPORTION TO WATER. Ballygunge at
 *    0.72 % open water loses 0.013 r; Baruipur at 1.30 % loses 0.061; Barrackpore at
 *    4.88 % loses 0.071. That ordering is what makes this a result about water rather
 *    than noise — the same contrast would have been the evidence FOR it.
 * 2. It is not a compression artefact, which is the loophole the canopy sweep had to
 *    close. Spatial SD RISES, from 1.45x the observed to 1.64x, so the model gets both
 *    less skilful and more over-drawn. There is no reading in which this is error
 *    traded for amplitude.
 * 3. The relaxation is a CLAMP, not a nudge, and nobody wrote it intending one. At the
 *    shipped D the stable dt is ~0.1 and `0.35*water` dominates `dt*k`, so a fully-wet
 *    cell converges to within 0.05 K of `tAir - 1.5` whatever the energy balance says.
 *    Measured: every wet cell lands on the target, +0.8 to +1.9 K by day and -1.1 to
 *    -2.0 K by night. The layer does not cool water by ~4 K; it pins it.
 * 4. `tAir - 1.5` is a DAYTIME assumption applied around the clock, and night is where
 *    it hurts most (-0.063 r against day's -0.029). Water has the highest thermal
 *    inertia in the scene: after sunset it is the WARMEST surface ECOSTRESS sees over
 *    these wards, and this term puts it 1.5 K below air. That is a sign error, and no
 *    coefficient fixes a sign — which is also why fixing it was out of scope here.
 *
 * Full record and the before/after: docs/heat-map-water-layer.md, and
 * docs/evidence/known-limitations.md §7. `rasterizeWardWater` stays general and
 * unit-tested, and the Python port (scripts/_water.py LAYER_ENABLED) is pinned to this
 * constant through the water parity oracle, so re-enabling is one line here plus a
 * re-run of that measurement — and the measurement now exists, which it did not before.
 */
export const WATER_LAYER_ENABLED = false;

/**
 * The constants a SCOPE supplies to the physics — a country's or a city's, never
 * the model's own.
 *
 * WHY THIS LIVES IN types.ts AND NOT IN scope/. It is the contract BETWEEN the two
 * halves, so it belongs to the vocabulary both already share rather than to either
 * side of it. `scope/resolve.ts` PRODUCES one of these from an area key;
 * `heat-map-model.ts` CONSUMES one and never learns where it came from. Declaring
 * it in scope/ would force the physics to import an identity module to name the
 * type of its own parameter, which inverts the layering the whole migration rests
 * on: the model knows DATA and PARAMETERS, never IDENTITY. There is no ward, city
 * or country named here, and there must never be — only numbers the physics uses.
 *
 * Everything here was a hard-coded constant inside heat-map-model.ts until the
 * scope migration. Each was a fact about Kolkata, or about India, wearing the
 * costume of a fact about heat transfer; see the note where they used to sit.
 */
export interface ClimateConstants {
  /**
   * Warming-pathway deltas, K, keyed by scenario — added to the air temperature.
   *
   * EMPTY when the country declares no pathway, and empty is a REAL ANSWER: no
   * regional projection has been adopted there, so the pathway control contributes
   * nothing and says so. It is deliberately not a zero-valued table, which would
   * be indistinguishable from a pathway measured at zero warming. `currentParams`
   * reads the difference: an unknown key in a POPULATED table throws; any key at
   * all against an empty one contributes zero.
   *
   * `Readonly` because one object is shared by every consumer of a scope — a
   * caller that mutated it would move the warming pathway for the whole session.
   */
  readonly pathDelta: Readonly<Record<string, number>>;
  /** Air temperature, °C, used ONLY when the live met feed is down. */
  readonly fallbackTairC: number;
  /** Cooling-blob radius, metres — the city's measured tree-void-effect scale. */
  readonly parkRadiusM: number;
  /**
   * Intervention unit costs, or `null` where the country has declared none.
   *
   * NULL IS NOT ZERO. A country with no adopted cost basis has no cost answer at
   * all, and `0` would be a plausible-looking wrong one — a scenario would quote a
   * budget of nothing and it would read as a finding. The null is refused at the
   * seam where a scope is chosen, never carried into `computeCost`, whose
   * signature therefore demands a real `Costs`.
   */
  readonly costs: Costs | null;
}

/**
 * Intervention unit costs, in ONE currency.
 *
 * `currency` is carried for the readouts that must name it and is never read by
 * the physics — there is no currency in an energy balance. The other four are the
 * multipliers `computeCost` applies, each against a DIFFERENT spatial quantity, so
 * an absent field is `undefined`, its term is NaN, and NaN poisons the whole total.
 * That is why all five are required rather than optional.
 */
export interface Costs {
  /** ISO 4217, e.g. 'INR'. Labelling only — the physics never reads it. */
  readonly currency: string;
  /** cool-roof coating, per m² of roof */
  readonly roofM2: number;
  /** one street tree, planted */
  readonly tree: number;
  /** one pocket park, in crore (1e7) of the currency unit */
  readonly parkCr: number;
  /** green facade, per m² of wall */
  readonly facadeM2: number;
}

/** Per-cell input layers, each n*n in [0,1], row-major. */
export interface SimLayers {
  albedo: Float32Array;
  veg: Float32Array;
  built: Float32Array;
  water: Float32Array;
}

export interface SimParams {
  /** lateral diffusion, cell²/step-unit — CFL-bounded (see cflDt). */
  D: number;
  /** solar gain, °C/step-unit at sun=1 on a zero-albedo cell. */
  S: number;
  /** sun intensity 0..1 (diurnal phase). */
  sun: number;
  /** linearised radiative loss toward tSky. */
  kRad: number;
  tSky: number;
  /** evapotranspiration cooling per unit veg. */
  L: number;
  /** convective exchange coefficient (× wind) toward tAir. */
  h: number;
  wind: number;
  /** anthropogenic heat per unit built. */
  Q: number;
  tAir: number;
  /**
   * Heat stored by day and released at night, °C/step-unit. ZERO BY DAY.
   *
   * The storage flux (ΔQs) a steady-state surface balance omits by
   * construction. Without it the model computes a weighted mean of air and a
   * sky 10–20 K colder and puts the night surface BELOW air — measured, the
   * ward surface sits 2.10 K ABOVE it, because the fabric is still discharging
   * the day's heat. That is a sign error, and no coupling constant fixes a
   * sign.
   *
   * Fitted at ward scale against 79 ECOSTRESS ward-scenes; it does NOT scale
   * with built fraction, which was tested and came back at zero — the rural
   * mask sits above air at night too.
   */
  store: number;
}

export interface SimStats {
  meanC: number;
  peakC: number;
  /** fraction of cells above the heat-stress threshold. */
  fracAbove: number;
  thresholdC: number;
}

/** The swappable engine contract (see docs/heat-map-feature.md). */
export interface HeatSim {
  reset(grid: GridSpec, layers: SimLayers, params: SimParams): void;
  setParams(p: Partial<SimParams>): void;
  /** advance `steps` sub-steps of size `dt` (dt is clamped to stability). */
  step(dt: number, steps?: number): void;
  /** current field, n*n °C — may force a GPU readback; call sparingly. */
  temperature(): Float32Array;
  stats(thresholdC?: number): SimStats;
  dispose(): void;
}

export const DEFAULT_PARAMS: SimParams = {
  D: 0.15,
  S: 0.6,
  sun: 1,
  // Radiative-to-convective coupling. Was 0.02/0.04. Fitted at ward scale, held
  // inside the physically defensible band (linearised radiative coupling
  // ~4εσT³ ≈ 6 W/m²K against a convective 10–30, so kRad:h belongs in roughly
  // 0.2–0.6; this is 0.2).
  kRad: 0.01,
  tSky: 17,
  // Evapotranspiration cooling. Shipped value is 0.46. Was 0.5, which put a
  // fully-vegetated surface 5.8 K below air — more than ET can deliver.
  //
  // It was derived from TWO constraints, and ONE OF THEM IS WITHDRAWN:
  //   · vegetated surface <4 K below air — valid, physical ceiling on ET
  //   · park cool-island "4.83–8.07 °C, Kolkata" — NOT a Kolkata band. The paper
  //     is Li et al. 2022 (10.3389/fenvs.2022.1073914), not Mitra; 8.07 °C is
  //     Kolkata's daytime MAXIMUM and 4.83 °C is BANGKOK's. The lower bound was
  //     never a Kolkata constraint. Withdrawn 2026-08-08 — see
  //     docs/green-score-methodology.md §4.2.
  //
  // RE-DERIVED 2026-08-09. The value stands; the reasoning behind it did not.
  //
  //   1. NOTHING FITS L. fit-physics.py fits Q_day, kRad:h and Brutsaert c —
  //      L is not among them. In fit-ward-scale.py `l_et` is a BOUNDED
  //      parameter, and ward-scale-fit.json records it as `pinned` in every
  //      candidate: it lands on 0.6, 0.8 or 0.46, always the ceiling it was
  //      given. The fit wants ~0.8, roughly twice what ET can deliver.
  //   2. SO THE WITHDRAWN LOWER BOUND NEVER BOUND ANYTHING. A parameter that
  //      rails upward is decided by its ceiling alone. Losing 4.83 °C destroys
  //      the RATIONALE ("the midpoint", later "the top of the band") without
  //      making 0.46 inadmissible.
  //   3. AND [0.40, 0.46] CANNOT BE REPRODUCED FROM THIS MODEL AT ALL. Park
  //      cooling is exactly 15·L_eff, so even the OLD two-sided band maps to
  //      L ∈ [0.383, 0.640] at rh 60 — not [0.40, 0.46]. That band is a fossil
  //      of an earlier model, predating the Q retune and the evap scaling. It
  //      should not be cited as this model's constraint by anyone, including us.
  //
  // WHAT ACTUALLY CONSTRAINS L, one-sided: park cooling ≤ 8.07 °C (Li et al.
  // 2022, Kolkata daytime max) and a vegetated surface within 4 K of air. Both
  // are ceilings. In constant-space they depend on humidity, because L below is
  // scaled by evapScale(rh) — and WHICH BAR BINDS CHANGES WITH IT:
  //
  //      rh 60   park binds   L ≤ 0.640        rh 30   veg binds   L ≤ 0.515
  //
  // (The first draft of this note derived every ceiling from park cooling alone
  //  and put rh 30 at 0.527. Wrong: below ~35 % rh the vegetated-surface bar is
  //  the tighter of the two.)
  //
  // A DEFECT WAS FOUND WHILE VERIFYING THE ABOVE, AND IT WAS THE RAMP, NOT L.
  // Uncapped, evap kept RAISING evapotranspiration as air dried while the 4 K
  // headroom SHRINKS as the sky dries; the two crossed near 22 % rh. That is
  // reachable on observed weather — ward-observations.json records humidity down
  // to 14.1 %, and 6 of its 298 readings put a vegetated surface more than 4 K
  // below air. Fixed 2026-08-09 by capping the ramp at 1.0 (see evapScale in
  // heat-map-model.ts): crossing 22 % → 16 %, violations 6 → 3, and 230 of the
  // 298 readings bit-for-bit unchanged.
  //
  // NOT fully closed, deliberately. Below the cap the ET term is frozen while
  // the headroom keeps shrinking, so a crossing must still exist. Closing it
  // needs a lower cap that reshapes ordinary Kolkata humidity —
  // green-score-methodology §4.2.2 tables that trade and declines it.
  // validate-model.mjs reports the residual rather than hiding it.
  //
  // WHY NOT MOVE IT TO THE CEILING. Because the ceiling is not evidence that the
  // value belongs there. Raising L to 0.527 would be adopting the largest number
  // the guardrail permits, on the say-so of a ward-scale fit that wants 0.8 —
  // fit-ward-scale.py's own verdict on that is "the same mistake in a nicer
  // suit". Measured cost of being wrong either way: +1 to +2 points of 100 on
  // modest and moderate scenarios, and exactly zero at full intervention.
  //
  // So L is an admissible choice inside a one-sided feasible region, not a
  // uniquely determined constant, and this comment says so rather than implying
  // a precision the evidence does not carry.
  L: 0.46,
  h: 0.05,
  wind: 1,
  // 0.3936, down from 0.55. The old value was inflated by a calibration that
  // asked one term to carry the entire urban–rural difference between two
  // GHS-SMOD masks that are, measured, the same landscape. Halving it is what
  // the ward-scale evidence says, and it directly reduces the built term's
  // over-dominance of the within-ward pattern.
  //
  // REFITTED TWICE ON 2026-08-09, from 0.4131 → 0.3936 → 0.419.
  //   · first when the evapotranspiration humidity ramp was capped (§4.2.2),
  //     which changed the physics the calibration trains on;
  //   · then when the sun-up physical bar was added to build-ward-observations.py
  //     and three ECOSTRESS ward-scenes were rejected as unphysical — a surface
  //     cannot sit 12 K below the air warming it at 09:29 in June.
  // Both times for the same reason: a model fitted to one archive and executed
  // against another is not calibrated. Adopting this one improved out-of-sample
  // error on EVERY ward — Baruipur 4.347 → 3.212 K, the mean 3.572 → 3.037 K —
  // with no new parameter railing.
  Q: 0.419,
  tAir: 32,
  // Day. `currentParams` substitutes STORE_NIGHT for the retained phase.
  store: 0,
};

/**
 * Nocturnal heat release, °C/step-unit — the storage term, night only.
 *
 * Ward-scale fit against 79 ECOSTRESS ward-scenes. With it the modelled night
 * surface sits above air as measured (bias +0.13 K, was −0.97 K); without it
 * the sign is wrong no matter how the constants are tuned.
 *
 * REFITTED 2026-08-09 from 0.1052, alongside Q — same reason, same run of
 * candidate G under the capped humidity ramp. Mirrored in scripts/_physics.py.
 */
export const STORE_NIGHT = 0.1043;

/**
 * Synthetic fully vegetated reference cell used by Explore and Compare.
 *
 * This is a land-cover counterfactual under the same forcing, not a measured
 * rural station, an urban–rural pair, or the observed DC-URS rural baseline.
 */
export const ALL_GREEN_REFERENCE = { albedo: 0.25, vegetation: 1, built: 0 } as const;

/** Version for derived heat metrics; the calibrated field remains heat-model-v1. */
export const HEAT_METRICS_VERSION = 'heat-metrics-v2' as const;

/** CFL bound for the 5-point explicit Laplacian (dx=1). The pure-diffusion 2D
 *  limit is D·dt ≤ 0.25, but the source/sink term (−k·T) tips the checkerboard
 *  mode past |g|=1 AT that edge (observed: field diverges to a spurious hot mean
 *  that ignores the live forcing). Use 0.2 for a stability margin. */
export function cflDt(D: number): number {
  return D > 0 ? 0.2 / D : Infinity;
}

/** Explicit-Euler decay bound: dt·(kRad + h·wind) < 2 (with margin). */
export function decayDt(p: SimParams): number {
  const k = p.kRad + p.h * p.wind;
  return k > 0 ? 1.8 / k : Infinity;
}

export function stableDt(p: SimParams, requested: number): number {
  return Math.min(requested, cflDt(p.D), decayDt(p));
}

/**
 * Zero-Laplacian equilibrium temperature of a cell — used to seed the field
 * (instant convergence, no cold start) and to sanity-check shader tuning.
 */
export function equilibriumC(p: SimParams, albedo: number, veg: number, built: number): number {
  const gain = p.S * (1 - albedo) * p.sun + p.Q * built - p.L * veg + p.store;
  const k = p.kRad + p.h * p.wind;
  const pull = p.kRad * p.tSky + p.h * p.wind * p.tAir;
  return (gain + pull) / k;
}

/** Equilibrium temperature of the declared all-green synthetic reference cell. */
export function allGreenReferenceC(params: SimParams): number {
  return equilibriumC(
    params,
    ALL_GREEN_REFERENCE.albedo,
    ALL_GREEN_REFERENCE.vegetation,
    ALL_GREEN_REFERENCE.built,
  );
}

/** Modelled ward mean minus the all-green synthetic reference under identical forcing. */
export function greenReferenceContrastC(meanC: number, params: SimParams): number {
  return meanC - allGreenReferenceC(params);
}

/**
 * Runnable check for the pure physics (no DOM/GPU). Node 24:
 *   node --experimental-strip-types -e "import('./types.ts').then(m => m.assertSimLogic())"
 */
export function assertSimLogic(): void {
  const a = (ok: boolean, msg: string) => { if (!ok) throw new Error(`sim: ${msg}`); };
  const p = DEFAULT_PARAMS;

  a(Math.abs(cflDt(0.15) - 1.3333) < 1e-3, 'cflDt(0.15) ≈ 1.333 (0.2/D margin)');
  a(stableDt(p, 10) <= cflDt(p.D) && stableDt(p, 10) <= decayDt(p), 'stableDt respects both bounds');
  a(stableDt(p, 0.5) === 0.5, 'stableDt passes through a safe request');

  // dense built core runs hot; vegetated cell runs at/below air temp
  const hot = equilibriumC(p, 0.3, 0, 1);
  const cool = equilibriumC(p, 0.25, 1, 0);
  a(hot > 40 && hot < 55, `built core equilibrium plausible (got ${hot.toFixed(1)}°C)`);
  a(cool < p.tAir, `vegetated cell cools below air temp (got ${cool.toFixed(1)}°C)`);
  a(hot - cool > 8, 'core vs veg contrast is legible');
  a(allGreenReferenceC(p) === cool, 'all-green reference delegates to equilibriumC');
  const night = { ...p, store: STORE_NIGHT };
  const omittedStore = (night.S * 0.75 * night.sun - night.L + night.kRad * night.tSky
    + night.h * night.wind * night.tAir) / (night.kRad + night.h * night.wind);
  a(Math.abs(allGreenReferenceC(night) - omittedStore
    - night.store / (night.kRad + night.h * night.wind)) < 1e-10,
  'all-green reference includes nocturnal storage');
}
