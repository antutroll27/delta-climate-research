/**
 * country → city → ward. The single source of truth for what OBOS can render.
 *
 * WHY THIS REPLACES FOUR LISTS. Wards were hard-coded in src/data/wards.ts, in
 * src/scripts/climate-engine/wards.ts as a UNION TYPE, and twice more as
 * hand-written markup in HeatMapStage.astro. The union type was the blocker: it
 * made a second city a type change rather than a data change.
 *
 * COUNTRY IS MODELLED BUT NOT RENDERED. There is one country. A switcher with a
 * single entry is dead UI. Modelling it now means the control can appear when a
 * second country exists without restructuring the registry underneath it.
 *
 * THIS REGISTRY DESCRIBES WHAT EXISTS, NOT WHAT SHIPS. Bengaluru's three wards
 * are declared here before any of their artefacts are built, so the geometry,
 * raster and provenance tasks that follow have one place to name them. The
 * standards surface (STAC, CityJSON, OGC, /attribution) must NOT publish a ward
 * whose artefacts are absent — see the filter and the reasoning in wards.ts.
 */
import { requireGrid } from '../scripts/climate-engine/types.ts';

export interface WardRecord {
  readonly id: string;
  /** display name; `<em>` marks the syllable the wordmark emphasises */
  readonly name: string;
  readonly zone: string;
  /** the local body whose statistical returns cover this ward */
  readonly body: string;
  /**
   * WGS-84 centre. The coordinate the ward header PRINTS is derived from these
   * by `formatLatLon` — it used to be stored alongside them as `coord`, a
   * pre-formatted duplicate, which is two sources for one fact in the file
   * whose entire purpose is being the single one.
   */
  readonly lat: number;
  readonly lon: number;
  /**
   * Nominal vegetation fraction — and it does NOT mean the same thing in both
   * cities, so it cannot be described in one clause. Bengaluru's rows carry
   * MEASURED Sentinel-2 fractional vegetation cover. Kolkata's carry the
   * unsourced archetype values it has always had, which the measurement
   * contradicts. Read it per row, not as a column of like quantities.
   *
   * NOTE: the field this replaces claimed to be "the thermal model's layer
   * seed" and was read by NOTHING — the solver takes vegetation from the
   * per-ward surface raster. Kolkata's stored values (0.12 / 0.62 / 0.28) do
   * not match its measured fractions (0.329 / 0.447 / 0.309). Those are left
   * alone here rather than silently corrected; Bengaluru's carry the measured
   * value so the field is at least true. Removing it is its own change.
   */
  readonly veg: number;
  /** analysis footprint, metres. Must have an admitted grid. */
  readonly footprintM: number;
}

export interface CityRecord {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  /** declared instrument resolution, metres per solver cell */
  readonly cellMeters: number;
  readonly wards: readonly WardRecord[];
}

const KOLKATA_WARDS: readonly WardRecord[] = [
  { id: 'ballygunge', name: 'Bally<em>gunge</em>', zone: 'Urban Core · Ward 68',
    body: 'Kolkata Municipal Corporation, Ward 68',
    lat: 22.528, lon: 88.3659, veg: 0.12, footprintM: 1400 },
  { id: 'baruipur', name: 'Baru<em>ipur</em>', zone: 'Peri-Urban Fringe',
    body: 'Baruipur Municipality',
    lat: 22.3654, lon: 88.4319, veg: 0.62, footprintM: 1400 },
  { id: 'barrackpore', name: 'Barrack<em>pore</em>', zone: 'Industrial River Corridor',
    body: 'Barrackpore Municipality',
    lat: 22.7621, lon: 88.3713, veg: 0.28, footprintM: 1400 },
];

const BENGALURU_WARDS: readonly WardRecord[] = [
  { id: 'indiranagar', name: 'Indira<em>nagar</em>', zone: 'Dense Low-Rise',
    body: 'Greater Bengaluru Authority (GBA-2025)',
    lat: 12.9784, lon: 77.6408, veg: 0.344, footprintM: 2800 },
  { id: 'mg-road', name: 'MG <em>Road</em>', zone: 'Mixed Downtown',
    body: 'Greater Bengaluru Authority (GBA-2025)',
    lat: 12.9755, lon: 77.6030, veg: 0.344, footprintM: 2800 },
  { id: 'whitefield', name: 'White<em>field</em>', zone: 'Sparse High-Rise',
    body: 'Greater Bengaluru Authority (GBA-2025)',
    lat: 12.9698, lon: 77.7500, veg: 0.344, footprintM: 2800 },
];

/**
 * A city's cell size is DERIVED from its wards, never typed in beside them.
 *
 * Typing it in is how the two drift: 384 cells over a 1400 m ward yields arrays
 * of exactly the right length and models 3.65 m cells that no calibration here
 * describes. `requireGrid` owns the refusal for an unadmitted ward size and
 * names the fix, so this function does not restate it — the only failure left
 * for it to catch is a city declared with no wards at all, which would
 * otherwise read `undefined.footprintM`.
 */
function declaredCellMeters(wards: readonly WardRecord[]): number {
  const first = wards[0];
  if (!first) throw new RangeError('A city must declare at least one ward to have a resolution.');
  return first.footprintM / requireGrid(first.footprintM).n;
}

export const CITIES: Record<string, CityRecord> = {
  kolkata: { id: 'kolkata', name: 'Kolkata', country: 'India',
    cellMeters: declaredCellMeters(KOLKATA_WARDS), wards: KOLKATA_WARDS },
  bengaluru: { id: 'bengaluru', name: 'Bengaluru', country: 'India',
    cellMeters: declaredCellMeters(BENGALURU_WARDS), wards: BENGALURU_WARDS },
};

export const CITY_OF: Record<string, string> = Object.fromEntries(
  Object.values(CITIES).flatMap((c) => c.wards.map((w) => [w.id, c.id])),
);

export function wardsOfCity(cityId: string): readonly WardRecord[] {
  return CITIES[cityId]?.wards ?? [];
}

export function allWards(): readonly WardRecord[] {
  return Object.values(CITIES).flatMap((c) => c.wards);
}
