/**
 * ward-frame.ts — ward metres → Web Mercator, and the two signs that got it wrong.
 *
 * PURE. No three.js, no MapLibre, no DOM — so the transform can be checked in node
 * against `data/geometry/{ward}-footprints.json`, which carries every building's
 * `p` (ward metres) AND its `lonlat`. That file is the ground truth this module
 * exists to agree with, and `tests/unit/heat-map-frame.test.mjs` is the agreement.
 *
 * TWO ERRORS ARE FIXED HERE, and the first one shipped:
 *
 * 1. MERCATOR Y GROWS SOUTHWARD. Our data frame is y-NORTH (scripts/_types.py's
 *    `m_per_deg`, and `fetch-buildings.py` warns that getting it backwards
 *    "mirrors every building"). The render put northing on +mercator y, so the
 *    whole ward drew reflected about its own east-west centre line — every
 *    building on the wrong side of its street. It read as "buildings on roads"
 *    and was misdiagnosed three times as road-casing width.
 *
 *    It survived because no test asserted anything about the composed matrix, and
 *    because two other layers had a SECOND flip that cancelled it on screen
 *    (terrain.ts's row order and surface-raster.ts's decode).
 *
 * 2. THE SCALE IS ANISOTROPIC, and the render used one number for both axes.
 *    Our metres come from 111_320·cos φ east and 110_540 north; MapLibre's
 *    `meterInMercatorCoordinateUnits()` derives from its own mean-radius sphere.
 *    Using MapLibre's for both stretches north by 0.593 % — about 4 m at the rim
 *    of a 1,400 m window, growing with |y| and vanishing on the centre line.
 *    That shape is why an affine/translate "calibration" cannot fix it: a
 *    constant offset is the wrong function.
 *
 * WHY NOT FIX THE DATA INSTEAD. Rebuilding the artefacts against MapLibre's
 * sphere would make their metres agree with the renderer at the cost of no longer
 * being metres — and would invalidate the 0.016 m validation of our footprints
 * against the raw Overture parquet, plus the 7.29 m simulation cell. The data is
 * the more faithful of the two; the projection is what adapts. `src/data/wards.ts`
 * already states that principle for the inverse direction.
 */

/** MapLibre's sphere. Its `meterInMercatorCoordinateUnits` is 1/(2π·R·cos φ). */
export const MERCATOR_MEAN_RADIUS_M = 6371008.8;

/** Metres per degree in the DATA frame — must mirror scripts/_types.m_per_deg. */
const M_PER_DEG_LON_EQUATOR = 111_320;
const M_PER_DEG_LAT = 110_540;

export interface WardFrame {
  /** mercator units per metre eastward */
  readonly east: number;
  /** mercator units per metre northward, as a MAGNITUDE — the sign is applied by
   *  `wardToMercator`, deliberately, so it can be asserted in one place */
  readonly north: number;
  /** mercator units per metre of altitude. MapLibre's own, because building
   *  heights are true metres and never passed through the ward frame. */
  readonly up: number;
}

export function wardMercatorScale(latDeg: number): WardFrame {
  const cosLat = Math.cos((latDeg * Math.PI) / 180);
  return {
    east: 1 / (360 * M_PER_DEG_LON_EQUATOR * cosLat),
    north: 1 / (360 * M_PER_DEG_LAT * cosLat),
    up: 1 / (2 * Math.PI * MERCATOR_MEAN_RADIUS_M * cosLat),
  };
}

/**
 * A point in ward metres (x east, y NORTH) to Mercator, given the ward origin
 * already in Mercator.
 *
 * The minus on y is the entire bug. Keep it here, where one test can hold it.
 */
export function wardToMercator(
  origin: { readonly x: number; readonly y: number },
  frame: WardFrame,
  x: number,
  y: number,
): { x: number; y: number } {
  return { x: origin.x + x * frame.east, y: origin.y - y * frame.north };
}
