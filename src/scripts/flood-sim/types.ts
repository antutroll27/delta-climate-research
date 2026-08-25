/**
 * Flood-simulator artefact contracts — the seam between the laboratory and the
 * instrument.
 *
 * THIS FILE IS THE SOURCE OF TRUTH. The Python builders under scripts/ mirror
 * these shapes; the direction is never reversed. That is the same rule
 * `_types.py` follows for the heat twin ("Mirrors Sourced<T> in
 * dc-urs-inputs.ts"), and it exists because a contract owned by the consumer
 * cannot silently drift away from what the consumer actually reads.
 *
 * NO PHYSICS RUNS IN THE BROWSER. BUILD-SPEC §1 decided this: hydrology is
 * build-time, and the client interpolates between precomputed states. The
 * prototype's in-browser depression solver predates that decision and was
 * separately falsified — on 30 m Dubai terrain its depression field is sensor
 * noise (BUILD-SPEC §3a). Nothing here should tempt anyone to re-add a solver:
 * the types describe RESULTS, not state to integrate.
 */

/** Every artefact carries where it came from and what may be done with it. */
export interface Provenance {
  source: string;
  licence: string;
  attribution: string;
}

/** Square analytical grid, row-major from the south-west corner, +y north. */
export interface GridSpec {
  /** Side length in cells. */
  n: number;
  /** Metres per cell. */
  cellM: number;
  /** Edge length of the study window, metres. */
  footprintM: number;
  /** [lon, lat] of the window centre, EPSG:4326. */
  centre: [number, number];
}

// ── terrain ─────────────────────────────────────────────────────────────────

export interface TerrainArtefact extends GridSpec, Provenance {
  site: string;
  /** Bare-earth elevation per cell, metres. Row-major, length n*n. */
  h: number[];
  /**
   * Building coverage ratio per cell, 0–1.
   *
   * Drives BOTH mass-balance corrections in the solver: storage porosity
   * φ = 1 − BCR (water cannot occupy the building plan area) and BCR-weighted
   * roof runoff (roofs do not infiltrate). It is not a rendering hint.
   */
  bcr: number[];
  /** What this surface is and is not. Shown, never summarised away. */
  limitation: string;
}

// ── scenarios: the precomputed answer ───────────────────────────────────────

/**
 * Depth statistics for one rainfall total, across a terrain-error ensemble.
 *
 * WHY THREE FIELDS AND NOT ONE. Measured, this model's AGGREGATES are stable
 * under realistic DEM error and its PATTERN is not: at DeltaDTM's stated
 * accuracy, wet fraction and p95 depth move under 6 % while spatial overlap
 * sits at 0.56–0.65. Shipping a single depth field would present a pattern the
 * data cannot support. The ensemble that measured that instability IS the
 * uncertainty band — it is not estimated, asserted, or bolted on afterwards.
 */
export interface DepthField {
  /** Event rainfall total, mm. */
  rainMm: number;
  /** Runoff depth after losses, mm — what actually reached the surface. */
  runoffMm: number;
  /** Per-cell peak depth during the storm, metres. Median across the ensemble. */
  p50: number[];
  /** Lower and upper ensemble bounds, metres. Same length and order as p50. */
  p10: number[];
  p90: number[];
}

export interface ScenarioArtefact extends GridSpec, Provenance {
  site: string;
  /** Storm duration the peak is taken over, hours. */
  stormHours: number;
  /** Terrain realisations behind the ensemble. */
  realisations: number;
  /** Perturbation used, so the band can be reproduced or challenged. */
  ensemble: { sigmaM: number; correlationM: number };
  /** One entry per rainfall step, ascending. */
  fields: DepthField[];
  limitation: string;
}

// ── exposure: what floods, rather than how deep ─────────────────────────────

/**
 * Depth thresholds, metres, with the consequence each marks.
 *
 * These are not round numbers chosen for tidiness — each is a published
 * vulnerability threshold, and the label is what makes a depth mean something
 * to a reader who does not think in metres.
 */
export type ExposureThreshold = 0.1 | 0.3 | 0.5;

export type FacilityKind =
  | 'hospital' | 'clinic' | 'school' | 'kindergarten'
  | 'fire_station' | 'police' | 'substation';

/**
 * How many facilities of one kind are inundated at one threshold.
 *
 * A RANGE, NEVER A COUNT. The spatial pattern is unstable under DEM error, so
 * an integer would be false precision on a field measured as noisy. `low` and
 * `high` are the ensemble spread; `typical` is the median realisation.
 */
export interface ExposureRange {
  kind: FacilityKind;
  thresholdM: ExposureThreshold;
  low: number;
  typical: number;
  high: number;
  /** How many of this kind exist in the window at all — the denominator. */
  total: number;
}

/**
 * Where exposed population concentrates, as bands rather than headcounts.
 *
 * DELIBERATELY NOT A NUMBER OF PEOPLE. Meta HRSL for the UAE is 2020-vintage
 * over a city that grew hard afterwards, so a headcount would be quoted far
 * more confidently than it deserves. Bands answer "where", which is the
 * decision-relevant question, without inviting a figure into a headline.
 */
export interface PopulationBand {
  rainMm: number;
  /** Band edges are relative density quantiles, not absolute counts. */
  band: 'low' | 'moderate' | 'high';
  /** Share of the inundated area falling in this band, 0–1. */
  areaFraction: number;
}

export interface ExposureArtefact extends Provenance {
  site: string;
  /** Keyed by rainfall total, matching ScenarioArtefact.fields. */
  byRainMm: Record<string, ExposureRange[]>;
  population: PopulationBand[];
  /** Vintage and coverage caveats that must reach the reader. */
  caveats: string[];
}

// ── helpers the instrument needs and the laboratory must agree with ─────────

/** Row-major index for a cell. The one place this convention is written down. */
export function cellIndex(grid: GridSpec, ix: number, iy: number): number {
  return iy * grid.n + ix;
}

/** Site-local metres (+x east, +y north) → fractional cell coordinates. */
export function metresToCell(grid: GridSpec, x: number, y: number): [number, number] {
  const half = grid.footprintM / 2;
  return [
    ((x + half) / grid.footprintM) * (grid.n - 1),
    ((y + half) / grid.footprintM) * (grid.n - 1),
  ];
}

/**
 * Bilinear sample of a row-major field at site-local metres.
 *
 * Bilinear rather than nearest because depth is continuous and a pin dropped
 * between cell centres should not snap. Out-of-window samples clamp to the
 * edge rather than throwing — the UI can put a pin anywhere.
 */
export function sampleField(grid: GridSpec, field: number[] | Float32Array,
                            x: number, y: number): number {
  const [fx, fy] = metresToCell(grid, x, y);
  const ix = Math.max(0, Math.min(grid.n - 2, Math.floor(fx)));
  const iy = Math.max(0, Math.min(grid.n - 2, Math.floor(fy)));
  const u = Math.max(0, Math.min(1, fx - ix));
  const v = Math.max(0, Math.min(1, fy - iy));
  const a = field[cellIndex(grid, ix, iy)];
  const b = field[cellIndex(grid, ix + 1, iy)];
  const c = field[cellIndex(grid, ix, iy + 1)];
  const d = field[cellIndex(grid, ix + 1, iy + 1)];
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/**
 * Linear blend between two precomputed depth fields.
 *
 * This is what the client does INSTEAD of solving. Blending two peak-depth
 * fields is an interpolation of results, not a simulation — a slider position
 * between two computed scenarios is presented as such, and the UI must not
 * imply the intermediate was solved.
 */
export function blendFields(a: number[], b: number[], t: number,
                            out: Float32Array): Float32Array {
  const k = Math.max(0, Math.min(1, t));
  for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * k;
  return out;
}

/** Published vulnerability meanings for the three thresholds. */
export const THRESHOLD_MEANING: Record<ExposureThreshold, string> = {
  0.1: 'access disrupted — standing water on approaches and thresholds',
  0.3: 'most vehicles immobilised',
  0.5: 'adults unstable in moving water',
};
