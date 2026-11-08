/**
 * The night-air adjustment: how much cooler than the airport's reading the model is given.
 * Pure — the caller supplies the clock and the ward — so the rule is unit-tested and mirrored
 * in Python (scripts/_night_air.py, held to 1e-6 K by check-night-air-parity.py).
 *
 * THE THREE RULES, each the product's own:
 *   night  sun ≤ SUN_LIT, with sun = solarElevationFactor(wardSolarHour, dayOfYearUtc, lat):
 *          exactly what heat-map-app.ts computes for "Now";
 *   month  the calendar month in IST (UTC+5:30, fixed) of the instant;
 *   scope  the air that enters the model in the "Now" night branch ONLY. The offset rides on the
 *          observation (nightAirMonthOffsetK) and is subtracted inside currentParams, where the
 *          branch is decided. The air tile keeps showing the airport's reading; humidity, wind,
 *          the day branch and every canonical scenario are untouched.
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

/** The table's offset for a station in the IST month of an instant, 0 for a station with no table. The sun is NOT consulted: this is what is carried on the observation. */
export function nightAirMonthOffsetK(icao: string, ms: number): number {
  return NIGHT_AIR_CORRECTION[icao]?.offsetsK[istMonth(ms) - 1] ?? 0;
}

/**
 * K to SUBTRACT from a station's air for the model at an instant with this sun: the month's
 * offset when the sun is at or below SUN_LIT, otherwise 0. The same decision the app takes at run
 * time (heat-map-model.ts nightAirAppliedK); the Python mirror and the parity gate use this form.
 */
export function nightAirOffsetK(icao: string, ms: number, sun: number): number {
  return sun > SUN_LIT ? 0 : nightAirMonthOffsetK(icao, ms);
}
