/**
 * The night-air adjustment: how much cooler than the airport's reading the model is given.
 * Pure — the caller supplies the clock and the ward — so the rule is unit-tested and mirrored
 * in Python (scripts/_night_air.py, held to 1e-6 K by check-night-air-parity.py).
 *
 * THE THREE RULES, each the product's own:
 *   night  sun ≤ SUN_LIT, with sun = solarElevationFactor(wardSolarHour, dayOfYearUtc, lat):
 *          exactly what heat-map-app.ts computes for "Now";
 *   month  the calendar month in IST (UTC+5:30, fixed) of the instant;
 *   scope  the air that enters the model. The air tile and the weather line keep showing the
 *          airport's reading; humidity, wind and the day branch are untouched.
 */
import { NIGHT_AIR_CORRECTION } from '../../data/night-air-correction.ts';
import { SUN_LIT } from '../../scripts/climate-engine/heat-map-model.ts';
import { dayOfYearUtc } from '../../scripts/climate-engine/explore/sun-lighting.ts';
import { solarElevationFactor } from '../../scripts/climate-engine/sky.ts';

const IST_OFFSET_MS = 5.5 * 3_600_000;

/** 1–12, the IST calendar month of an instant. */
export function istMonth(ms: number): number {
  return new Date(ms + IST_OFFSET_MS).getUTCMonth() + 1;
}

/** cos z at a ward the way "Now" computes it (heat-map-app.ts wardSolarHour + refreshNowSun). */
export function sunAt(ms: number, latDeg: number, lonDeg: number): number {
  const solarHour = (((ms / 3_600_000) % 24 + lonDeg / 15) % 24 + 24) % 24;
  return solarElevationFactor(solarHour, dayOfYearUtc(ms), latDeg);
}

/**
 * K to SUBTRACT from a station's air for the model: the month's offset when the sun is at or
 * below SUN_LIT, otherwise 0 — and 0 for a station with no table.
 */
export function nightAirOffsetK(icao: string, ms: number, sun: number): number {
  const t = NIGHT_AIR_CORRECTION[icao];
  if (!t || sun > SUN_LIT) return 0;
  return t.offsetsK[istMonth(ms) - 1];
}
