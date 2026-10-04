// src/lib/aqi/stations.ts
/**
 * The OBOS areas with an Air card (Kolkata's three, Bengaluru's three) and their
 * government monitors. Kolkata's positions verified Positions verified
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
  /**
   * OpenAQ's sensors for the 30-day history and the fallback, or null when OBOS knows none
   * (Bengaluru: no verified OpenAQ ids; Kasturi Nagar has been silent there). With null,
   * CPCB's feed is the only source: no history, and when the feed is unusable the card
   * shows the honest unavailable state instead of a figure from elsewhere.
   */
  sensors: Readonly<Record<'pm25' | 'pm10' | 'no2' | 'so2' | 'co' | 'o3', SensorRef>> | null;
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
  /* BENGALURU (founder, 2026-10-05). No CPCB/KSPCB monitor stands inside any of the three
     3 km windows, so each ward shows its NEAREST monitor in CPCB's feed, labelled as that
     with its true distance (as Ballygunge). Positions are the feed's own (fixture
     cpcb-feed-2026-10-05T0200IST); distances are haversine from the ward centres in
     src/data/cities.ts. Nearest "that reports in the feed": a station present in the feed,
     even in an hour it publishes no AQI (MG Road's Hombegowda Nagar at 02:00 IST on
     5 Oct); that hour then shows CPCB's own no-AQI state, never a swapped-in neighbour.
     Whitefield's monitor is 10.0 km away: there is no maximum-distance rule, so it is
     shown, distance first; hiding it is the founder's call. No OpenAQ ids: `sensors` null. */
  'in/bengaluru/indiranagar': {
    id: 'cpcb:kasturi-nagar-bengaluru', name: 'Kasturi Nagar, Bengaluru', owner: 'Karnataka State Pollution Control Board',
    cpcb_name: 'Kasturi Nagar, Bengaluru - KSPCB',
    lat: 13.003872, lon: 77.664217, distance_m: 3803,
    inside: 'outside_window', placement: 'in Kasturi Nagar, north-east of Indiranagar', sensors: null,
  },
  'in/bengaluru/mg-road': {
    id: 'cpcb:hombegowda-nagar-bengaluru', name: 'Hombegowda Nagar, Bengaluru', owner: 'Karnataka State Pollution Control Board',
    cpcb_name: 'Hombegowda Nagar, Bengaluru - KSPCB',
    lat: 12.938539, lon: 77.5901, distance_m: 4341,
    inside: 'outside_window', placement: 'in Hombegowda Nagar, south of MG Road', sensors: null,
  },
  'in/bengaluru/whitefield': {
    id: 'cpcb:kasturi-nagar-bengaluru', name: 'Kasturi Nagar, Bengaluru', owner: 'Karnataka State Pollution Control Board',
    cpcb_name: 'Kasturi Nagar, Bengaluru - KSPCB',
    lat: 13.003872, lon: 77.664217, distance_m: 10037,
    inside: 'outside_window', placement: 'in Kasturi Nagar, west-north-west of Whitefield', sensors: null,
  },
};

export function isAirArea(key: string): boolean { return Object.hasOwn(AREAS, key); }
/** True when the area's city has an Air card (`in/bengaluru/x` → true): the UI's one gate, read from AREAS. */
export function isAirCity(key: string): boolean {
  const prefix = key.split('/').slice(0, 2).join('/') + '/';
  return Object.keys(AREAS).some((k) => k.startsWith(prefix));
}
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
