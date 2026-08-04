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

/**
 * Ward metres → WGS-84. The exact inverse of `to_local` in
 * scripts/fetch-buildings.py, which is where the local frame is created:
 *
 *     mx, my = 111_320 · cos(lat), 110_540          (scripts/_types.m_per_deg)
 *     x, y   = (lon − clon) · mx, (lat − clat) · my
 *
 * so inverting it recovers the ORIGINAL Overture coordinate rather than
 * re-deriving one. Checked against the raw parquet on 2026-08-04, comparing
 * vertex means on both sides of the pipeline: median 0.016 m, p95 0.036 m,
 * 98.4 % within 5 cm. The residue is the shipped JSON's coordinate rounding,
 * not the transform.
 *
 * `y` is NORTHWARD, the house convention — the same `y` a building row carries
 * and the same value the scene uses as world z (see climate-engine/terrain.ts).
 *
 * A caveat that belongs here and not on screen: the RENDER places these points
 * in Web Mercator while this conversion is linear in latitude, so a drawn
 * building can sit up to ~4 m from the coordinate reported here at the window's
 * edge. The number is the more faithful of the two.
 */
export function wardLatLon(
  origin: { readonly lat: number; readonly lon: number }, x: number, y: number,
): { lat: number; lon: number } {
  return {
    lat: origin.lat + y / 110_540,
    lon: origin.lon + x / (111_320 * Math.cos((origin.lat * Math.PI) / 180)),
  };
}

/**
 * The UI's rendering of the above. Five decimals ≈ 1.1 m — coarser than the
 * transform, and deliberately so: this is the centroid of a footprint traced
 * from imagery, and a sixth decimal would claim 11 cm of siting accuracy that
 * the FOOTPRINT does not have, however exact the arithmetic is.
 */
export function formatLatLon(lat: number, lon: number, separator = ', '): string {
  return `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}${separator}`
       + `${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;
}
