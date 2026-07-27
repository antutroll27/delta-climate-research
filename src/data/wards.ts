/**
 * The study wards.
 *
 * Extracted from `heat-map-app.ts` so the ward set is DATA rather than code
 * (dc-urs-spec.md §1). Widening from three wards to all 144 KMC wards must be a
 * change to this file alone — no script may hardcode a ward id or a count.
 *
 * The three wards sit under THREE DIFFERENT local bodies, which is why `body` is
 * recorded: their statistical returns are not directly comparable, and DC-URS
 * handles that by areal interpolation onto the common footprint rather than by
 * taking any one body's ward figures.
 */

export interface Ward {
  readonly id: string;
  /** display name; `<em>` marks the syllable the wordmark emphasises */
  readonly name: string;
  readonly zone: string;
  /** the local body whose statistical returns cover this ward */
  readonly body: string;
  /** pre-formatted coordinate string for the UI */
  readonly coord: string;
  readonly lat: number;
  readonly lon: number;
  /** baseline vegetation fraction — the thermal model's layer seed */
  readonly veg: number;
  /** analysis footprint, metres. Matches the thermal simulation domain so
   *  DC-URS and the heat model describe the same ground. */
  readonly footprintM: number;
}

export const WARDS: readonly Ward[] = [
  {
    id: 'ballygunge',
    name: 'Bally<em>gunge</em>',
    zone: 'Urban Core · Ward 68',
    body: 'Kolkata Municipal Corporation, Ward 68',
    coord: '22.528° N · 88.366° E',
    lat: 22.528, lon: 88.3659, veg: 0.12, footprintM: 1400,
  },
  {
    id: 'baruipur',
    name: 'Baru<em>ipur</em>',
    zone: 'Peri-Urban Fringe',
    body: 'Baruipur Municipality',
    coord: '22.365° N · 88.432° E',
    lat: 22.3654, lon: 88.4319, veg: 0.62, footprintM: 1400,
  },
  {
    id: 'barrackpore',
    name: 'Barrack<em>pore</em>',
    zone: 'Industrial River Corridor',
    body: 'Barrackpore Municipality',
    coord: '22.762° N · 88.371° E',
    lat: 22.7621, lon: 88.3713, veg: 0.28, footprintM: 1400,
  },
] as const;

/** Lookup by id. Returns undefined for an unknown id rather than throwing. */
export function wardById(id: string): Ward | undefined {
  return WARDS.find(w => w.id === id);
}

/** Legacy shape for call sites that still index by id. */
export const WARD_MAP: Readonly<Record<string, Ward>> =
  Object.fromEntries(WARDS.map(w => [w.id, w]));
