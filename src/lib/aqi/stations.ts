// src/lib/aqi/stations.ts
/**
 * The three Kolkata areas and their government monitors. Positions verified
 * 2026-09-26 (register AQI-R20, R21). Units come from a per-sensor table, never
 * from OpenAQ's labels, which are wrong (AQI-R31): Ballygunge's are verified against
 * OpenCity's native-unit archive; Barrackpore's CO and NO₂ are verified (magnitude,
 * NOx closure) but its SO₂ µg/m³ is INFERRED, not verified (AQI-R31). A change here
 * is a data claim: update the register in the same commit.
 */
import type { AqiStation, Pollutant } from './types.ts';

export interface SensorRef { id: number; unit: 'ug_m3' | 'mg_m3' }
export interface StationEntry extends Omit<AqiStation, 'placement'> {
  /** Required here, so a registry entry outside its window cannot omit where it is. */
  placement: string | null;
  owner: string;
  /** The station's exact `<Station id>` in CPCB's CAAQMS feed (register AQI-R47a). */
  cpcb_name: string;
  sensors: Readonly<Record<'pm25' | 'pm10' | 'no2' | 'so2' | 'co' | 'o3', SensorRef>>;
}

export const AREAS: Readonly<Record<string, StationEntry | null>> = {
  /* OUTSIDE ITS AREA SINCE 2026-10-02, and kept on purpose (founder, 2026-10-03).
     Ballygunge became KMC Ward 68 and its centre moved to the ward's (22.522704 N,
     88.369173 E). The WBPCB "Ballygunge" monitor stands in KMC Ward 69, about 0.9 km
     outside Ward 68: 1,657 m from the new centre and 53 m beyond the 3 km window's
     northern edge. It is still the nearest official monitor, so it is shown — as
     that, with its true distance and where it stands — rather than dropped. The
     window is NOT widened to take it in. */
  'in/kolkata/ballygunge': {
    id: 'openaq:10918', name: 'Ballygunge, Kolkata', owner: 'West Bengal Pollution Control Board',
    cpcb_name: 'Ballygunge, Kolkata - WBPCB',
    lat: 22.5367507, lon: 88.3638022, distance_m: 1657,
    inside: 'outside_window', placement: 'in KMC Ward 69, outside Ward 68',
    sensors: { pm25: { id: 12236012, unit: 'ug_m3' }, pm10: { id: 12236011, unit: 'ug_m3' }, no2: { id: 12236009, unit: 'ug_m3' },
               so2: { id: 12236014, unit: 'ug_m3' }, co: { id: 12236007, unit: 'mg_m3' }, o3: { id: 12236010, unit: 'ug_m3' } },
  },
  'in/kolkata/barrackpore': {
    id: 'openaq:3409509', name: 'SVSPA Campus, Barrackpore', owner: 'West Bengal Pollution Control Board',
    cpcb_name: 'SVSPA Campus, Barrackpore - WBPCB',
    lat: 22.7605581, lon: 88.3617589, distance_m: 995, inside: 'window_3km', placement: null,
    sensors: { pm25: { id: 12238558, unit: 'ug_m3' }, pm10: { id: 12238557, unit: 'ug_m3' }, no2: { id: 12238555, unit: 'ug_m3' },
               so2: { id: 12238560, unit: 'ug_m3' }, co: { id: 12238553, unit: 'mg_m3' }, o3: { id: 12238556, unit: 'ug_m3' } },
  },
  'in/kolkata/baruipur': null,
};

export function isAirArea(key: string): boolean { return Object.hasOwn(AREAS, key); }
/**
 * The station as the wire carries it — ONE builder for every response path (OBOS's
 * own calculation, CPCB's feed, the upstream-error state), so the honest status is
 * written once and no path can go on asserting `window_3km` for a monitor that is not.
 */
export function stationPayload(st: StationEntry): AqiStation {
  const base = { id: st.id, name: st.name, lat: st.lat, lon: st.lon, distance_m: st.distance_m };
  return st.inside === 'outside_window' && st.placement
    ? { ...base, inside: 'outside_window', placement: st.placement }
    : { ...base, inside: 'window_3km' };
}
export function stationFor(key: string): StationEntry | null { return AREAS[key] ?? null; }
export const POLLUTANTS: readonly Pollutant[] = ['pm25', 'pm10', 'no2', 'so2', 'co', 'o3'];
