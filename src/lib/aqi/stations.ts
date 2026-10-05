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

/** A Bengaluru monitor as CPCB's feed names and places it; `blr` adds the ward-relative distance and placement. */
type BlrStation = Pick<StationEntry, 'id' | 'name' | 'owner' | 'cpcb_name' | 'lat' | 'lon'>;
const KSPCB = 'Karnataka State Pollution Control Board', CPCB = 'Central Pollution Control Board';
const bs = (slug: string, place: string, owner: string, lat: number, lon: number): BlrStation => ({
  id: `cpcb:${slug}-bengaluru`, name: `${place}, Bengaluru`, owner,
  cpcb_name: `${place}, Bengaluru - ${owner === KSPCB ? 'KSPCB' : 'CPCB'}`, lat, lon,
});
/* The stations CPCB's feed groups under Karnataka / Bengaluru (5 Oct 2026, 02:00 and 18:00 IST), less
   Shivapura_Peenya and Jigani, which published no AQI in either capture (founder, 5 Oct 2026). */
const KASTURI_NAGAR = bs('kasturi-nagar', 'Kasturi Nagar', KSPCB, 13.003872, 77.664217);
const HOMBEGOWDA_NAGAR = bs('hombegowda-nagar', 'Hombegowda Nagar', KSPCB, 12.938539, 77.5901);
const SILK_BOARD = bs('silk-board', 'Silk Board', KSPCB, 12.917348, 77.622813);
const HEBBAL = bs('hebbal', 'Hebbal', KSPCB, 13.029152, 77.585901);
const BTM_LAYOUT = bs('btm-layout', 'BTM Layout', CPCB, 12.9135218, 77.5950804);
const JAYANAGAR = bs('jayanagar-5th-block', 'Jayanagar 5th Block', KSPCB, 12.920984, 77.584908);
const BAPUJI_NAGAR = bs('bapuji-nagar', 'Bapuji Nagar', KSPCB, 12.951913, 77.539784);
const PEENYA = bs('peenya', 'Peenya', CPCB, 13.0270199, 77.494094);
const blr = (s: BlrStation, distance_m: number, placement: string): StationEntry =>
  ({ ...s, distance_m, inside: 'outside_window', placement, sensors: null });

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
     3 km windows, so each ward shows the nearest monitor in CPCB's feed, labelled as that
     with its true distance (as Ballygunge). Positions are the feed's own (fixtures
     cpcb-feed-2026-10-05T0200IST and T1800IST); distances are haversine from the ward
     centres in src/data/cities.ts. The entry HERE is the ward's nearest monitor; the ones
     after it are in FALLBACKS below, and the API serves the first of the ladder that
     publishes a valid AQI this hour (pickServed). Whitefield's nearest is 10.0 km away:
     there is no maximum-distance rule, so it is shown, distance first; hiding it is the
     founder's call. No OpenAQ ids: `sensors` null. */
  'in/bengaluru/indiranagar': blr(KASTURI_NAGAR, 3803, 'in Kasturi Nagar, north-east of Indiranagar'),
  'in/bengaluru/mg-road': blr(HOMBEGOWDA_NAGAR, 4341, 'in Hombegowda Nagar, south of MG Road'),
  'in/bengaluru/whitefield': blr(KASTURI_NAGAR, 10037, 'in Kasturi Nagar, west-north-west of Whitefield'),
};

/**
 * THE FALLBACK LADDER (2026-10-05): after the ward's nearest monitor (AREAS), every other
 * Bengaluru monitor within MAX_SERVE_M, nearest first, each at its own distance and with its
 * own placement.
 * CPCB's feed drops stations for hours at a time (Kasturi Nagar was absent at 18:00 IST on
 * 5 Oct and from 19 Sep), so a ward with one station went blank while seven of its
 * neighbours reported. The API serves the first rung that publishes a valid AQI this hour
 * and labels it the nearest REPORTING monitor (`fallback`), never the nearest official one.
 * Kolkata has no ladder: its wards keep their one station and the OpenAQ fallback.
 * A change here is a data claim: update register AQI-R52 in the same commit.
 */
/**
 * No station farther than this from the ward centre is ever served (founder, 2026-10-05): past
 * it, "none of the nearby monitors is reporting" is more honest than a far station's figure.
 * Enforced at serve time (cpcb-feed.ts pickServed), not only by trimming the ladders.
 */
export const MAX_SERVE_M = 20_000;

export const FALLBACKS: Readonly<Record<string, readonly StationEntry[]>> = {
  'in/bengaluru/indiranagar': [
    blr(HOMBEGOWDA_NAGAR, 7059, 'in Hombegowda Nagar, south-west of Indiranagar'),
    blr(SILK_BOARD, 7063, 'at Silk Board, south-south-west of Indiranagar'),
    blr(HEBBAL, 8199, 'in Hebbal, north-west of Indiranagar'),
    blr(BTM_LAYOUT, 8752, 'in BTM Layout, south-west of Indiranagar'),
    blr(JAYANAGAR, 8800, 'in Jayanagar 5th Block, south-west of Indiranagar'),
    blr(BAPUJI_NAGAR, 11335, 'in Bapuji Nagar, west-south-west of Indiranagar'),
    blr(PEENYA, 16789, 'in Peenya, west-north-west of Indiranagar'),
  ],
  'in/bengaluru/mg-road': [
    blr(HEBBAL, 6247, 'in Hebbal, north-north-west of MG Road'),
    blr(JAYANAGAR, 6371, 'in Jayanagar 5th Block, south-south-west of MG Road'),
    blr(SILK_BOARD, 6813, 'at Silk Board, south-south-east of MG Road'),
    blr(BTM_LAYOUT, 6945, 'in BTM Layout, south of MG Road'),
    blr(BAPUJI_NAGAR, 7335, 'in Bapuji Nagar, west-south-west of MG Road'),
    blr(KASTURI_NAGAR, 7345, 'in Kasturi Nagar, east-north-east of MG Road'),
    blr(PEENYA, 13117, 'in Peenya, west-north-west of MG Road'),
  ],
  'in/bengaluru/whitefield': [
    blr(SILK_BOARD, 14966, 'at Silk Board, west-south-west of Whitefield'),
    blr(HOMBEGOWDA_NAGAR, 17673, 'in Hombegowda Nagar, west-south-west of Whitefield'),
    blr(BTM_LAYOUT, 17917, 'in BTM Layout, west-south-west of Whitefield'),
    blr(JAYANAGAR, 18696, 'in Jayanagar 5th Block, west-south-west of Whitefield'),
    blr(HEBBAL, 18965, 'in Hebbal, west-north-west of Whitefield'),
  ],
};

/** The ward's ladder: its nearest monitor, then its fallbacks nearest first. Empty for an area with no station. */
export function candidatesFor(key: string): readonly StationEntry[] {
  const st = stationFor(key);
  return st ? [st, ...(FALLBACKS[key] ?? [])] : [];
}

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
 * `fallback`: served from the ladder because a nearer monitor published no AQI this hour.
 */
export function stationPayload(st: StationEntry, fallback = false): AqiStation {
  const base = { id: st.id, name: st.name, lat: st.lat, lon: st.lon, distance_m: st.distance_m, ...(fallback ? { fallback: true as const } : {}) };
  return st.inside === 'outside_window' && st.placement
    ? { ...base, inside: 'outside_window', placement: st.placement }
    : { ...base, inside: 'window_3km' };
}
export function stationFor(key: string): StationEntry | null { return AREAS[key] ?? null; }
export const POLLUTANTS: readonly Pollutant[] = ['pm25', 'pm10', 'no2', 'so2', 'co', 'o3'];
