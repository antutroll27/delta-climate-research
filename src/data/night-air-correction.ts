/**
 * The airport's night air, put back on the basis the model was calibrated on.
 *
 * The live "Now" view is forced at night by the airport METAR (observed.ts), but the model's
 * night constants and its displayed band were earned on NASA POWER T2M. At night Dum Dum
 * reads warmer than POWER's cell by a SEASONAL 0.5 to 4.0 K, so the station-forced night map
 * ran about 2.5 K warm against the calibration set. This table is that difference, measured
 * AIR AGAINST AIR and never fitted to satellite LST, per IST calendar month; the model is
 * given `reading - offset` when the sun is at or below SUN_LIT (night-air.ts).
 *
 * IDENTITY AND MEASUREMENT, so it lives in src/data beside metar-stations.ts and never in
 * the physics. Provenance, counts and input hashes: data/night-air/vecc-night-air.json
 * (scripts/build-night-air-table.py); `--check` fails if the two ever differ. The rules were
 * written down, and the test fixed, before the table was built:
 * docs/evidence/2026-11-08-kolkata-night-air-correction.md.
 *
 * Only stations listed here are adjusted. A station absent from this table is read as it
 * reports. The table is for the NIGHT branch; by day the offset is zero by construction.
 */

/** Twelve values, January first. */
export type PerMonth<T> = readonly [T, T, T, T, T, T, T, T, T, T, T, T];

export interface NightAirCorrection {
  /** Mean of (airport air − POWER T2M) over the month's night instants, K. Subtracted. */
  readonly offsetsK: PerMonth<number>;
  /** Night instants behind each month's mean. */
  readonly n: PerMonth<number>;
}

const VECC: NightAirCorrection = {
  offsetsK: [3.17, 3.14, 2.14, 1.06, 0.51, 1.37, 1.07, 1.17, 1.75, 2.04, 3.95, 4.04],
  n: [2446, 2255, 2282, 1976, 2118, 1322, 1388, 1445, 1418, 1480, 1600, 1668],
};

export const NIGHT_AIR_CORRECTION: Readonly<Record<string, NightAirCorrection>> = Object.freeze({ VECC });
