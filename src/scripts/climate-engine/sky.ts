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
 *               reported by GWR recalibration studies.
 *
 *               STAYS AT 1.24, and the ward-scale fit was refused here. The fit
 *               wanted 1.40 — the top of the published range — because a warmer
 *               sky warms the modelled surface, which is what it needed. Two
 *               invariants in assertSkyLogic say no:
 *
 *                 · the clear sky must stay below air temperature, and at
 *                   Kolkata humidity (rh 80–95 % is routine) c ≥ 1.33 pushes
 *                   Brutsaert emissivity high enough that it does not;
 *                 · T_sky at 28 °C / 80 % must land 19–21 °C, a validated
 *                   Kolkata night expectation, which holds only for c ≈ 1.23–1.26.
 *
 *               The published range is global; local humidity is what binds. A
 *               constant that fits better by making a clear sky as warm as the
 *               air is not a better constant.
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
 * Wet-bulb temperature, °C. Stull (2011), valid roughly 5–99 % RH.
 *
 * Here to make one thing checkable rather than assumed: 35 °C wet-bulb is the
 * limit of human thermoregulation, and an atmosphere past it has never been
 * observed on Earth. A scenario that produces one is not a severe scenario, it
 * is a broken one.
 */
export function wetBulbC(tC: number, rh: number): number {
  const r = Math.min(99, Math.max(5, rh));
  return (
    tC * Math.atan(0.151977 * Math.sqrt(r + 8.313659))
    + Math.atan(tC + r)
    - Math.atan(r - 1.676331)
    + 0.00391838 * r ** 1.5 * Math.atan(0.023101 * r)
    - 4.686035
  );
}

/**
 * The relative humidity at `tTargetC` that holds the SAME ABSOLUTE humidity as
 * `tNowC`/`rhNow` — i.e. today's air mass, warmed.
 *
 * WHY NOT SIMPLY KEEP THE RELATIVE VALUE. Relative humidity is a ratio against a
 * saturation pressure that itself climbs steeply with temperature, so holding it
 * while raising the air by 8 K silently doubles the water in the air. Kolkata at
 * 30 °C / 96 % taken to the 1-in-100 heat of 38.4 °C at the same 96 % is a
 * wet-bulb of 37.9 °C: past the survivability limit, and never recorded
 * anywhere. Preserving vapour pressure gives 60 % and 31.6 °C instead.
 *
 * The honest framing this earns is "today's air mass at 1-in-100 heat". Holding
 * the ratio would instead invent heatwave-day humidity, which is precisely the
 * record we do not have — we hold 74 years of air TEMPERATURE.
 */
export function shiftAirPreservingVapour(tNowC: number, rhNow: number, tTargetC: number): number {
  const vapour = saturationVapourPressure(tNowC) * (rhNow / 100);
  const ratio = (100 * vapour) / saturationVapourPressure(tTargetC);
  return Math.min(100, Math.max(5, ratio));
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


/**
 * Solar AZIMUTH — the compass bearing of the sun, degrees clockwise from true north.
 *
 * The companion to `solarElevationFactor` above, sharing its declination series and
 * hour angle so the two can never disagree about where the sun is. Elevation says
 * how high; this says which way. The heat instrument needs both to draw a sun on a
 * compass: a marker at the wrong bearing is worse than no marker.
 *
 * KOLKATA IS INSIDE THE TROPICS, and the formula must survive that. At lat 22.55 N
 * the declination exceeds the latitude for roughly six weeks around the June
 * solstice, so the noon sun stands NORTH of overhead and the azimuth flips from 180
 * to 0. A hemisphere-assuming shortcut ("noon means south") is wrong here for part
 * of the year, in the season that matters most for heat. The acos form below has no
 * such assumption built in.
 *
 * Returns 0-360. Meaningless when the sun is below the horizon — callers must gate
 * on `solarElevationFactor(...) > 0` rather than trusting a bearing at midnight.
 *
 * @param solarHour local SOLAR hour, 0-24
 * @param doy       day of year, 1-366
 * @param latDeg    latitude, degrees north
 */
export function solarAzimuthDeg(solarHour: number, doy: number, latDeg = 22.55): number {
  const rad = Math.PI / 180;
  // Same Spencer (1971) series as solarElevationFactor — kept identical on purpose.
  const g = (2 * Math.PI / 365) * (doy - 1);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = (solarHour - 12) * 15 * rad;
  const lat = latDeg * rad;
  const sinElev = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const cosElev = Math.sqrt(Math.max(0, 1 - sinElev * sinElev));
  // Degenerate only at the pole or exact zenith; both give an arbitrary bearing.
  if (cosElev < 1e-9) return 180;
  const cosAz = (Math.sin(decl) - sinElev * Math.sin(lat)) / (cosElev * Math.cos(lat));
  const az = Math.acos(Math.min(1, Math.max(-1, cosAz))) / rad;
  // acos loses the sign of the hour angle: before noon the sun is east, after west.
  return ha > 0 ? 360 - az : az;
}


/** Solar elevation in DEGREES above the horizon. Negative below it. */
export function solarElevationDeg(solarHour: number, doy: number, latDeg = 22.55): number {
  const rad = Math.PI / 180;
  const g = (2 * Math.PI / 365) * (doy - 1);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = (solarHour - 12) * 15 * rad;
  const lat = latDeg * rad;
  const sinElev = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  return Math.asin(Math.min(1, Math.max(-1, sinElev))) / rad;
}

/**
 * Sunrise, solar noon and sunset, in LOCAL SOLAR hours.
 *
 * Geometric horizon only — no refraction, no solar-disc radius, no
 * equation-of-time (local solar time is used throughout this module, so the
 * hour angle is just (h-12)x15deg). That puts the times within a few minutes of
 * an almanac, which is the right precision for a readout that exists to orient
 * a reader rather than to time a prayer or a photograph.
 *
 * Returns null inside a polar day or night, where no crossing exists. Kolkata
 * and Dubai never see that, but a function that silently returns 12:00 for
 * Tromso is a trap for whoever ports this north.
 */
export function solarDayHours(doy: number, latDeg = 22.55):
  { sunrise: number; noon: number; sunset: number } | null {
  const rad = Math.PI / 180;
  const g = (2 * Math.PI / 365) * (doy - 1);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosHa0 = -Math.tan(latDeg * rad) * Math.tan(decl);
  if (cosHa0 < -1 || cosHa0 > 1) return null;   // midnight sun / polar night
  const ha0 = Math.acos(cosHa0) / rad / 15;      // half-day length, hours
  return { sunrise: 12 - ha0, noon: 12, sunset: 12 + ha0 };
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

  /* Heatwave forcing: today's air mass, warmed — and never an impossible one.
     The envelope spans the muggiest live reading the wards produce (96 % RH) to
     a dry pre-monsoon afternoon, all taken to the 74-year p99 of 38.4 °C. */
  const HEAT_P99 = 38.4;
  for (const [t, r] of [[30, 96], [32.5, 76], [31.4, 60], [28, 88], [35, 40]] as const) {
    const shifted = shiftAirPreservingVapour(t, r, HEAT_P99);
    ok(shifted < r, `warming ${t}→${HEAT_P99} should LOWER relative humidity, got ${shifted.toFixed(0)}%`);
    const wb = wetBulbC(HEAT_P99, shifted);
    ok(wb < 35, `heatwave wet-bulb ${wb.toFixed(1)} at ${t}/${r} — past human survivability`);
  }
  // …and holding the ratio instead is exactly what breaks it, which is why we do not.
  ok(wetBulbC(HEAT_P99, 96) > 35, 'the RH-preserving alternative should be demonstrably impossible');
  // vapour is conserved: shifting to the same temperature changes nothing
  ok(Math.abs(shiftAirPreservingVapour(31, 70, 31) - 70) < 1e-9, 'no-op shift must be exact');

  // solar geometry: sun is down at night, near-overhead at Kolkata midsummer noon
  ok(solarElevationFactor(1, 180) === 0, 'sun should be below horizon at 01:00');
  // --- solar azimuth -------------------------------------------------------
  const near = (a: number, b: number, tol: number, m: string) =>
    ok(Math.abs(((a - b + 540) % 360) - 180) <= tol, `${m} (got ${a.toFixed(1)}, want ~${b})`);
  // Winter noon at Kolkata: declination is negative, well south of the latitude,
  // so the sun is due south.
  near(solarAzimuthDeg(12, 355), 180, 1.5, 'winter noon should be due south');
  // June solstice noon: declination 23.4 N EXCEEDS lat 22.55, so the sun stands
  // north of overhead. This is the case a hemisphere shortcut gets wrong.
  near(solarAzimuthDeg(12, 172), 0, 3, 'tropical summer noon should be north of overhead');
  // Morning is east of the meridian, afternoon west — the sign of the hour angle.
  ok(solarAzimuthDeg(8, 80) < 180, 'morning sun should be in the eastern half');
  ok(solarAzimuthDeg(16, 80) > 180, 'afternoon sun should be in the western half');
  // Symmetry about solar noon: equal hours either side mirror across the meridian.
  near(solarAzimuthDeg(9, 200) + solarAzimuthDeg(15, 200), 360, 0.5,
    'azimuths either side of noon should mirror');
  ok(solarAzimuthDeg(6, 80) >= 0 && solarAzimuthDeg(18, 80) <= 360, 'azimuth out of range');
  // --- elevation in degrees, and the day's endpoints ------------------------
  ok(Math.abs(solarElevationDeg(12, 355) - 44.0) < 2.0, 'Kolkata winter noon elevation ~44 deg');
  ok(solarElevationDeg(2, 180) < 0, 'sun should be below the horizon at 02:00');
  const jun = solarDayHours(172), dec = solarDayHours(355);
  ok(jun !== null && dec !== null, 'Kolkata has no polar day or night');
  if (jun && dec) {
    const len = (d: { sunrise: number; sunset: number }) => d.sunset - d.sunrise;
    ok(len(jun) > 13.0, `June day should exceed 13 h, got ${len(jun).toFixed(2)}`);
    ok(len(dec) < 11.2, `December day should be under 11.2 h, got ${len(dec).toFixed(2)}`);
    ok(len(jun) > len(dec), 'June day must be longer than December');
    ok(Math.abs((jun.sunrise + jun.sunset) / 2 - 12) < 1e-9, 'noon must bisect the day');
  }
  const eq = solarDayHours(80);
  ok(eq !== null && Math.abs((eq.sunset - eq.sunrise) - 12) < 0.15, 'equinox day should be ~12 h');
  // A latitude that DOES go polar must say so rather than inventing a sunrise.
  ok(solarDayHours(172, 80) === null, 'polar day must return null, not a fake crossing');


  ok(solarElevationFactor(23, 180) === 0, 'sun should be below horizon at 23:00');
  const noonJun = solarElevationFactor(12, 172);       // solstice; lat 22.55 ~= tropic
  ok(noonJun > 0.99, `midsummer noon factor ${noonJun.toFixed(3)}, expected ~1`);
  // equinox 07:00 -> cos(22.55°)·cos(−75°) ≈ 0.239, i.e. a quarter of overhead sun
  const dawn = solarElevationFactor(7, 80);
  ok(dawn > 0.20 && dawn < 0.28, `equinox 07:00 factor ${dawn.toFixed(3)}, expected ~0.24`);
  ok(solarElevationFactor(12, 355) > solarElevationFactor(7, 355), 'noon must exceed morning');
}
