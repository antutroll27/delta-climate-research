/**
 * The airports whose METARs set OBOS's "now", per city (founder decision 2,
 * 2026-10-07). IDENTITY, so it lives in src/data beside cities.ts and never in
 * the physics, which must not name a place.
 *
 * Coordinates are aviationweather.gov's own station records (the `lat`/`lon` it
 * returns with every report — tests/fixtures/metar), so the distance a reader is
 * shown is measured to the point the observations are filed against.
 *
 * A city absent from this table has no observed "now": met.no stays in charge.
 */
export interface MetarStation {
  readonly icao: string;
  /** What a reader calls it, for the weather line: "Dum Dum airport". */
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
}

export const METAR_STATIONS: Readonly<Record<string, readonly MetarStation[]>> = Object.freeze({
  kolkata: [
    { icao: 'VECC', name: 'Dum Dum airport', lat: 22.651, lon: 88.445 },
  ],
  /* Two, and the NEARER per ward is used (by ward-centre distance from cities.ts).
     All three current wards are nearer HAL; Kempegowda serves anything north. */
  bengaluru: [
    { icao: 'VOBL', name: 'Kempegowda airport', lat: 13.205, lon: 77.704 },
    { icao: 'VOBG', name: 'HAL airport', lat: 12.949, lon: 77.663 },
  ],
});

/** Every station any city reads — the API's allow-list. */
export const ALL_METAR_ICAO: readonly string[] = Object.freeze(
  [...new Set(Object.values(METAR_STATIONS).flat().map((s) => s.icao))].sort());
