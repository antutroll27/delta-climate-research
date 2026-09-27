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
export interface StationEntry extends Omit<AqiStation, 'inside'> {
  owner: string;
  /** The station's exact `<Station id>` in CPCB's CAAQMS feed (register AQI-R47a). */
  cpcb_name: string;
  sensors: Readonly<Record<'pm25' | 'pm10' | 'no2' | 'so2' | 'co' | 'o3', SensorRef>>;
}

export const AREAS: Readonly<Record<string, StationEntry | null>> = {
  'in/kolkata/ballygunge': {
    id: 'openaq:10918', name: 'Ballygunge, Kolkata', owner: 'West Bengal Pollution Control Board',
    cpcb_name: 'Ballygunge, Kolkata - WBPCB',
    lat: 22.5367507, lon: 88.3638022, distance_m: 993,
    sensors: { pm25: { id: 12236012, unit: 'ug_m3' }, pm10: { id: 12236011, unit: 'ug_m3' }, no2: { id: 12236009, unit: 'ug_m3' },
               so2: { id: 12236014, unit: 'ug_m3' }, co: { id: 12236007, unit: 'mg_m3' }, o3: { id: 12236010, unit: 'ug_m3' } },
  },
  'in/kolkata/barrackpore': {
    id: 'openaq:3409509', name: 'SVSPA Campus, Barrackpore', owner: 'West Bengal Pollution Control Board',
    cpcb_name: 'SVSPA Campus, Barrackpore - WBPCB',
    lat: 22.7605581, lon: 88.3617589, distance_m: 995,
    sensors: { pm25: { id: 12238558, unit: 'ug_m3' }, pm10: { id: 12238557, unit: 'ug_m3' }, no2: { id: 12238555, unit: 'ug_m3' },
               so2: { id: 12238560, unit: 'ug_m3' }, co: { id: 12238553, unit: 'mg_m3' }, o3: { id: 12238556, unit: 'ug_m3' } },
  },
  'in/kolkata/baruipur': null,
};

export function isAirArea(key: string): boolean { return Object.hasOwn(AREAS, key); }
export function stationFor(key: string): StationEntry | null { return AREAS[key] ?? null; }
export const POLLUTANTS: readonly Pollutant[] = ['pm25', 'pm10', 'no2', 'so2', 'co', 'o3'];
