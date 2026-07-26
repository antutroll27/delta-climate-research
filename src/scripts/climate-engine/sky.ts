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

/**
 * Solar elevation factor, 0–1 — cos(solar zenith), clamped at the horizon.
 *
 * The model used sun = 1 for "peak" and 0 for "night", which is only correct at
 * local noon. ECOSTRESS's day/night flag means "sun above horizon", so the
 * calibration set spans 07:06 to 17:24 local solar time; comparing a 07:06
 * overpass against a full-sun configuration would push the solar-geometry error
 * into the fitted constants.
 *
 * Local solar time is used directly, so no equation-of-time correction is
 * needed — the hour angle is just (h − 12) × 15°.
 *
 * @param solarHour local SOLAR hour, 0–24
 * @param doy       day of year, 1–366
 * @param latDeg    latitude, degrees north
 */
export function solarElevationFactor(solarHour: number, doy: number, latDeg = 22.55): number {
  const rad = Math.PI / 180;
  // Spencer (1971) declination series
  const g = (2 * Math.PI / 365) * (doy - 1);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = (solarHour - 12) * 15 * rad;
  const cosZ = Math.sin(latDeg * rad) * Math.sin(decl)
    + Math.cos(latDeg * rad) * Math.cos(decl) * Math.cos(ha);
  return Math.max(0, cosZ);
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

  // solar geometry: sun is down at night, near-overhead at Kolkata midsummer noon
  ok(solarElevationFactor(1, 180) === 0, 'sun should be below horizon at 01:00');
  ok(solarElevationFactor(23, 180) === 0, 'sun should be below horizon at 23:00');
  const noonJun = solarElevationFactor(12, 172);       // solstice; lat 22.55 ~= tropic
  ok(noonJun > 0.99, `midsummer noon factor ${noonJun.toFixed(3)}, expected ~1`);
  // equinox 07:00 -> cos(22.55°)·cos(−75°) ≈ 0.239, i.e. a quarter of overhead sun
  const dawn = solarElevationFactor(7, 80);
  ok(dawn > 0.20 && dawn < 0.28, `equinox 07:00 factor ${dawn.toFixed(3)}, expected ~0.24`);
  ok(solarElevationFactor(12, 355) > solarElevationFactor(7, 355), 'noon must exceed morning');
}
