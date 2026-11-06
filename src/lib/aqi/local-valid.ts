/**
 * The runtime check the browser runs on a local-regulator air payload before painting a word of it
 * (the counterpart of valid.ts for CPCB's). A body that fails is the designed failure view, never a
 * half-painted card. Strict on purpose: unknown states, a band that disagrees with its LKI number,
 * a non-finite value or an unparseable time are all refusals. Pure.
 */
import { lkiBand } from './lki.ts';
import { LOCAL_SCHEMA, type LocalAirPayload } from './local-types.ts';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isTime = (v: unknown): v is string => isStr(v) && Number.isFinite(Date.parse(v));

export const LOCAL_STATES: readonly string[] = ['live', 'not_reporting'];
const REASONS: readonly string[] = ['source_down', 'no_current_hour', 'no_station'];
const NL_FORMULAS: readonly string[] = ['PM25', 'PM10', 'NO2', 'O3'];
const JP_POLLUTANTS: readonly string[] = ['pm25', 'no2', 'ox'];
const JP_UNITS: Readonly<Record<string, string>> = { pm25: 'ug_m3', no2: 'ppm', ox: 'ppm' };

export function isLocalStation(v: unknown): boolean {
  return isObj(v) && isStr(v['id']) && isStr(v['name']) && isNum(v['lat']) && isNum(v['lon'])
    && isNum(v['distance_m']) && v['distance_m'] >= 0 && isStr(v['owner'])
    && (v['kind'] === null || isStr(v['kind'])) && (v['name_en'] === null || isStr(v['name_en']))
    && (v['fallback'] === undefined || v['fallback'] === true);
}

function isCredit(v: unknown): boolean {
  return isObj(v) && isStr(v['line']) && (v['edit'] === null || isStr(v['edit'])) && isStr(v['licence']) && isStr(v['terms_url']) && isStr(v['note']);
}

export function isLocalAirPayload(v: unknown): v is LocalAirPayload {
  if (!isObj(v) || v['schema'] !== LOCAL_SCHEMA || !isStr(v['area_id']) || !isTime(v['served_at']) || !isCredit(v['credit'])) return false;
  const standard = v['standard'];
  if (standard !== 'nl-lki' && standard !== 'jp-eqs') return false;
  if (v['state'] === 'not_reporting') {
    return REASONS.includes(v['reason'] as string) && (v['station'] === null || isLocalStation(v['station']))
      && (v['last_observed_at'] === null || isTime(v['last_observed_at']));
  }
  if (v['state'] !== 'live' || !isTime(v['observed_at']) || !isStr(v['observed_at_local']) || !Array.isArray(v['readings'])) return false;
  if (standard === 'nl-lki') {
    const lki = v['lki'];
    if (!isLocalStation(v['station']) || !isObj(lki) || lkiBand(lki['value']) !== lki['band']) return false;
    return (v['readings'] as unknown[]).every((r) => isObj(r) && NL_FORMULAS.includes(r['formula'] as string) && isNum(r['value']) && isTime(r['observed_at']));
  }
  if (v['provisional'] !== true) return false;
  return (v['readings'] as unknown[]).length > 0 && (v['readings'] as unknown[]).every((r) => isObj(r)
    && JP_POLLUTANTS.includes(r['pollutant'] as string) && isNum(r['value']) && r['value'] >= 0
    && r['unit'] === JP_UNITS[r['pollutant'] as string] && isLocalStation(r['station']));
}
