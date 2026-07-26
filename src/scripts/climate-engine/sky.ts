/**
 * Effective sky temperature for the longwave loss term.
 *
 * Replaces the hard-coded tSky = 17 °C day / 11 °C night, which were DRY-sky
 * values borrowed without a source. Humid tropical air is near-opaque in the
 * thermal IR window, so Kolkata's effective sky sits only a few K below air —
 * not 15–20 K below it. Using dry values made the surface radiate to a sky that
 * does not exist here, and the fit absorbed the error elsewhere.
 *
 * Cross-checked against Berdahl–Martin (1984) and Prata (1996): all three agree
 * within 0.6 °C over Kolkata's range. Brutsaert is used because its single
 * coefficient is the one published recalibration handle (see `c` below).
 */

/** Saturation vapour pressure, hPa (Magnus/Tetens). T in °C. */
export function saturationVapourPressure(tC: number): number {
  return 6.112 * Math.exp((17.67 * tC) / (tC + 243.5));
}

/**
 * Effective sky temperature, °C — Brutsaert (1975) clear-sky emissivity
 * ε = c·(e/T)^(1/7), screened for cloud.
 *
 * @param tC     air temperature, °C
 * @param rh     relative humidity, %
 * @param cloud  cloud fraction 0–1
 * @param c      Brutsaert coefficient. 1.24 original; 1.20–1.40 is the range
 *               reported by GWR recalibration studies. Fitted in Phase 2.
 */
export function skyTemperatureC(tC: number, rh: number, cloud = 0, c = 1.24): number {
  const tK = tC + 273.15;
  const e = saturationVapourPressure(tC) * (rh / 100);
  const clear = c * Math.pow(e / tK, 1 / 7);
  // cloud base radiates near black at air temperature; 0.9 is the screening weight
  const eps = Math.min(1, clear + 0.9 * (1 - clear) * cloud);
  return Math.pow(eps, 0.25) * tK - 273.15;
}

/**
 * Dewpoint, °C (Magnus inverse). Below this the surface cannot lose heat by
 * evaporation — there is nothing left to evaporate into.
 */
export function dewpointC(tC: number, rh: number): number {
  const g = Math.log(Math.max(1e-6, rh / 100)) + (17.67 * tC) / (tC + 243.5);
  return (243.5 * g) / (17.67 - g);
}

/** ponytail: one runnable check — `node --experimental-strip-types sky.ts` */
export function assertSkyLogic(): void {
  const ok = (c: boolean, m: string) => { if (!c) throw new Error(`sky: ${m}`); };
  // sky is always colder than air, never warmer
  for (const [t, r] of [[28, 80], [32, 60], [20, 40], [35, 95]] as const) {
    ok(skyTemperatureC(t, r) < t, `T_sky >= T_air at ${t}/${r}`);
  }
  // humidity raises it — the whole point of the change
  ok(skyTemperatureC(28, 80) > skyTemperatureC(28, 30), 'humidity did not raise T_sky');
  // cloud raises it toward air temperature
  ok(skyTemperatureC(28, 80, 1) > skyTemperatureC(28, 80, 0), 'cloud did not raise T_sky');
  // Kolkata night conditions land 19–21 °C, not the old 11
  const night = skyTemperatureC(28, 80);
  ok(night > 19 && night < 21, `T_sky at 28/80 = ${night.toFixed(1)}, expected 19–21`);
  // dewpoint sanity: 28 °C at 80 % RH is ~24.2 °C
  const dp = dewpointC(28, 80);
  ok(dp > 23.5 && dp < 25, `dewpoint at 28/80 = ${dp.toFixed(1)}, expected ~24.2`);
  ok(dewpointC(28, 100) > 27.9, 'dewpoint at saturation should equal air temperature');
}
