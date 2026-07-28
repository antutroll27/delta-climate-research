/**
 * Heat-sim engine ABI + pure physics helpers.
 *
 * Every backend (sim-gpu.ts today; sim-ts.ts / sim-wasm.ts later) implements
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
  // Evapotranspiration cooling. Was 0.5, which put a fully-vegetated surface
  // 5.8 K below air temperature — more cooling than ET can physically deliver.
  // 0.36 is the midpoint of the range satisfying TWO independent constraints:
  //   · park cool-island 4.83–8.07 °C  (Mitra et al. 2022, measured in Kolkata)
  //   · vegetated surface <4 K below air (physical ceiling on ET)
  // Valid range is [0.40, 0.46] once currentParams' humidity gate (×0.84 at
  // rh=60) is accounted for; see scripts/validate-model.mjs.
  // 0.46 — the top of the [0.40, 0.46] band that satisfies BOTH the Kolkata
  // park cool-island measurements and the physical ceiling on ET. The
  // unconstrained ward-scale fit wanted 0.8, which is roughly twice what
  // evapotranspiration can deliver; it was refused. Fitting better with a
  // constant nobody can defend is not an improvement.
  L: 0.46,
  h: 0.05,
  wind: 1,
  // 0.4131, down from 0.55. The old value was inflated by a calibration that
  // asked one term to carry the entire urban–rural difference between two
  // GHS-SMOD masks that are, measured, the same landscape. Halving it is what
  // the ward-scale evidence says, and it directly reduces the built term's
  // over-dominance of the within-ward pattern.
  Q: 0.4131,
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
 */
export const STORE_NIGHT = 0.1052;

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
}
