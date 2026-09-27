/**
 * THE BOUNDARY CHECK: is an untrusted JSON body a well-formed `AirQualityPayload`?
 *
 * The UI paints numbers and categories straight into HTML attributes and SVG, so a
 * body that merely LOOKS like a payload is not enough: every union is checked
 * against its members, every number with `Number.isFinite` (or null where the type
 * allows null), every date is a string that parses. Anything else is a load failure,
 * and the UI shows its failure view (air-panel.ts `loadAir`). Pure; no I/O.
 */
import { SCHEMA } from './types.ts';
import type { AirQualityPayload } from './types.ts';

type Obj = Record<string, unknown>;

const STATES = ['live', 'stale', 'unavailable', 'insufficient_data', 'no_station'] as const;
const CATEGORIES = ['good', 'satisfactory', 'moderate', 'poor', 'very_poor', 'severe'] as const;
const POLLUTANTS = ['pm25', 'pm10', 'no2', 'so2', 'co', 'o3', 'nh3'] as const;
const UNITS = ['ug_m3', 'mg_m3'] as const;
const REASONS = ['feed_quiet', 'no_valid_aqi', 'upstream_error'] as const;
const isSchema = (s: unknown): boolean => s === 1 || s === SCHEMA;

const obj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): x is string => typeof x === 'string';
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const finOrNull = (x: unknown): boolean => x === null || fin(x);
const date = (x: unknown): boolean => str(x) && Number.isFinite(Date.parse(x));
const oneOf = (xs: readonly string[], x: unknown): boolean => str(x) && xs.includes(x);
const arrOf = (x: unknown, ok: (v: unknown) => boolean): boolean => Array.isArray(x) && x.every(ok);

const isStation = (s: unknown): boolean =>
  obj(s) && str(s['id']) && str(s['name']) && fin(s['lat']) && fin(s['lon']) && fin(s['distance_m']) && s['inside'] === 'window_3km';

const isReading = (q: unknown): boolean =>
  obj(q) && oneOf(POLLUTANTS, q['parameter']) && finOrNull(q['value']) && oneOf(UNITS, q['unit']) &&
  (q['window_h'] === 24 || q['window_h'] === 8) && fin(q['hours_present']) && finOrNull(q['sub_index']);

const isSub = (q: unknown): boolean =>
  obj(q) && oneOf(POLLUTANTS, q['parameter']) && ['avg', 'min', 'max', 'hourly'].every((k) => finOrNull(q[k]));

/** Schema 1 has no `origin`: it is an OBOS result. */
const isObosResult = (r: Obj): boolean =>
  (r['origin'] === undefined || r['origin'] === 'obos') && fin(r['aqi']) && oneOf(CATEGORIES, r['category']) && oneOf(POLLUTANTS, r['dominant']) &&
  arrOf(r['pollutants'], isReading) && str(r['window_end_ist']) && r['algorithm'] === 'cpcb-aqi-1';

const isCpcbResult = (r: Obj): boolean =>
  r['origin'] === 'cpcb' && fin(r['aqi']) && oneOf(CATEGORIES, r['category']) && oneOf(POLLUTANTS, r['dominant']) &&
  (r['window_h'] === 24 || r['window_h'] === 8) && arrOf(r['subindices'], isSub);

const isResult = (r: unknown): boolean => obj(r) && (r['origin'] === 'cpcb' ? isCpcbResult(r) : isObosResult(r));

function isCurrent(c: unknown): boolean {
  if (!obj(c) || !isSchema(c['schema']) || !str(c['area_id']) || !str(c['served_at'])) return false;
  const src = c['source'];
  if (!obj(src) || !(src['owner'] === null || str(src['owner'])) || !str(src['via']) || src['standard'] !== 'CPCB National AQI') return false;
  switch (c['state']) {
    case 'live': return isStation(c['station']) && isResult(c['result']) && date(c['observed_at']);
    case 'stale': return isStation(c['station']) && isResult(c['result']) && date(c['observed_at']) && fin(c['age_h']);
    case 'unavailable': return isStation(c['station']) && (c['last_observed_at'] === null || date(c['last_observed_at'])) && oneOf(REASONS, c['reason']);
    case 'insufficient_data': {
      if (!isStation(c['station']) || !arrOf(c['reasons'], str) || !date(c['observed_at'])) return false;
      return c['origin'] === 'cpcb' ? arrOf(c['subindices'], isSub)
        : (c['origin'] === undefined || c['origin'] === 'obos') && arrOf(c['pollutants'], isReading);
    }
    case 'no_station': return str(c['message']);
    default: return false;
  }
}

const isDay = (d: unknown): boolean =>
  obj(d) && str(d['date_ist']) && finOrNull(d['aqi']) && (d['category'] === null || oneOf(CATEGORIES, d['category'])) &&
  (d['dominant'] === null || oneOf(POLLUTANTS, d['dominant'])) && (d['reason'] === undefined || str(d['reason']));

const isHour = (h: unknown): boolean => obj(h) && str(h['hour_ist']) && finOrNull(h['value']);

function isHistory(h: unknown): boolean {
  if (h === null) return true;
  return obj(h) && isSchema(h['schema']) && str(h['area_id']) && (h['station'] === null || isStation(h['station'])) &&
    arrOf(h['days'], isDay) && arrOf(h['pm25_24h'], isHour);
}

/** True only for a body the painters can render without trusting a single field. */
export function isAirPayload(x: unknown): x is AirQualityPayload {
  return obj(x) && isCurrent(x['current']) && isHistory(x['history']);
}

/** The five states, for the painters' own last-line check. */
export const AIR_STATES: readonly string[] = STATES;
