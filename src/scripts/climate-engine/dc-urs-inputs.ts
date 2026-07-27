/**
 * DC-URS indicator inputs, with provenance carried per field.
 *
 * Provenance is per FIELD, not per ward, because the eleven indicators land at
 * different times and from very different places: `lstDayC` is this year's
 * satellite pass, `socioVuln` is the 2011 census. A single ward-level "source"
 * label would flatten a fifteen-year spread into one word.
 *
 * The UI reads these markers directly — a score resting on 2011 demographics
 * must say so on its face (dc-urs-spec.md §3).
 */

export type Provenance =
  /** from an observation — satellite, survey, enumeration */
  | 'measured'
  /** produced by our thermal model, and therefore carrying its measured error */
  | 'modelled'
  /** a defensible stand-in, sourced but not observed for this ward */
  | 'estimated'
  /** explicitly temporary; must not reach production */
  | 'placeholder';

export interface Sourced<T> {
  readonly value: T;
  readonly source: Provenance;
  /** e.g. "2011", "2024-2026", "2021" — displayed, never buried */
  readonly vintage?: string;
  readonly cite?: string;
}

export const sourced = <T>(
  value: T, source: Provenance, vintage?: string, cite?: string,
): Sourced<T> => ({ value, source, vintage, cite });

/**
 * The eleven indicators the engine consumes.
 *
 * Grouped by pillar to match dc-urs-spec.md §2. Every field is `Sourced` so a
 * disputed score can be traced to the datum and its vintage.
 */
export interface DcUrsInputs {
  // ── Thermal Hazard (THI) ────────────────────────────────────────────────
  /** daytime land-surface temperature, °C */
  readonly lstDayC: Sourced<number>;
  /** nighttime land-surface temperature, °C */
  readonly lstNightC: Sourced<number>;
  /** rural reference surface temperature for the UHI delta, °C */
  readonly ruralBaseC: Sourced<number>;

  // ── Exposure & Sensitivity (EVI) ────────────────────────────────────────
  /** inhabitants per km² */
  readonly popDensity: Sourced<number>;
  /** floor-area ratio */
  readonly far: Sourced<number>;
  /** socio-economic heat vulnerability, 0–10 */
  readonly socioVuln: Sourced<number>;

  // ── Adaptive Capacity (ACI) ─────────────────────────────────────────────
  /** fractional vegetation cover, 0–1 */
  readonly fvc: Sourced<number>;
  /** tree-canopy fraction, 0–1 — structural, independent of NDVI */
  readonly canopyFrac: Sourced<number>;
  /** multi-year mean NDVI, for stability */
  readonly ndviMean: Sourced<number>;
  /** multi-year NDVI standard deviation, for stability */
  readonly ndviStd: Sourced<number>;
  /** broadband surface albedo, 0–1 */
  readonly albedo: Sourced<number>;
  /** distance to the nearest thermal refuge, metres */
  readonly distCoolM: Sourced<number>;
}

/** Weakest provenance across all fields — what the score as a whole may claim. */
export function weakestProvenance(i: DcUrsInputs): Provenance {
  const rank: Record<Provenance, number> = {
    measured: 0, modelled: 1, estimated: 2, placeholder: 3,
  };
  let worst: Provenance = 'measured';
  for (const f of Object.values(i) as Sourced<number>[]) {
    if (rank[f.source] > rank[worst]) worst = f.source;
  }
  return worst;
}

/** Distinct vintages present, oldest first — for the UI's disclosure line. */
export function vintages(i: DcUrsInputs): string[] {
  const seen = new Set<string>();
  for (const f of Object.values(i) as Sourced<number>[]) {
    if (f.vintage) seen.add(f.vintage);
  }
  return [...seen].sort();
}
