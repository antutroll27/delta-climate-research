/** Compose the payload from raw readings. Pure; the clock is a parameter. */
import { ALGORITHM, combine, subIndex, MIN_HOURS } from './cpcb.ts';
import { hoursBefore, istHourKey, istHours, isUsable, window24, window8, type Hour, type HourKey, type Raw } from './hours.ts';
import { POLLUTANTS, type StationEntry } from './stations.ts';
import { SCHEMA, type AirQualityPayload, type AqiStation, type HistoryDay, type Pollutant, type PollutantReading, type SourceNote } from './types.ts';

export const LIVE_H = 2;
export const STALE_DAYS = 7;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const IST_MS = 5.5 * HOUR_MS;
const HISTORY_DAYS = 30;
/** A row stamped further than this after `now` is a clock or feed error, dropped before anything reads it. */
const FUTURE_SLACK_MS = 15 * 60_000;
const EIGHT_HOUR: ReadonlySet<Pollutant> = new Set(['co', 'o3']);

/** The no-station source: nobody measured anything, so no owner. With a station, `owner` comes from the station entry. */
const SOURCE: SourceNote = { owner: null, via: 'CPCB via OpenAQ', standard: 'CPCB National AQI' };
const keyToIso = (k: HourKey): string => `${k}:00:00+05:30`;

function readings(hours: Record<string, Map<HourKey, Hour>>, st: StationEntry, endKey: HourKey): PollutantReading[] {
  return POLLUTANTS.map((p) => {
    const w = EIGHT_HOUR.has(p) ? window8(hours[p]!, endKey) : window24(hours[p]!, endKey);
    const ok = w.value !== null && w.hours >= MIN_HOURS;
    return { parameter: p, value: w.value === null ? null : Math.round(w.value * 100) / 100, unit: st.sensors[p as keyof StationEntry['sensors']].unit,
      window_h: EIGHT_HOUR.has(p) ? 8 : 24, hours_present: w.hours, sub_index: ok ? subIndex(p, w.value!) : null };
  });
}

/** Newest end stamp across all pollutants, ms; -Infinity when none. Counts only rows `istHours` counts (`isUsable`), and a loop, not a spread (~18k rows). */
function lastStampMs(raw: Partial<Record<Pollutant, Raw[]>>): number {
  let last = -Infinity;
  for (const p of POLLUTANTS) {
    for (const r of raw[p] ?? []) {
      if (!isUsable(r)) continue;
      const t = Date.parse(r.end_utc);
      if (t > last) last = t;
    }
  }
  return last;
}

/**
 * The 30 complete IST days ending yesterday relative to `now` (IST date of `now` minus one).
 * Anchored to the clock, not to the last reading: days after a feed dies show as missing.
 */
function historyDays(hours: Record<string, Map<HourKey, Hour>>, st: StationEntry, now: Date): HistoryDay[] {
  const todayIstMs = Date.parse(`${new Date(now.getTime() + IST_MS).toISOString().slice(0, 10)}T00:00:00Z`);
  return Array.from({ length: HISTORY_DAYS }, (_, i) => {
    const dayMs = todayIstMs - (HISTORY_DAYS - i) * DAY_MS;
    const date_ist = new Date(dayMs).toISOString().slice(0, 10);
    const endOfDay: HourKey = new Date(dayMs + DAY_MS).toISOString().slice(0, 13);
    const rs = readings(hours, st, endOfDay);
    const r = combine(rs);
    if (r.ok) return { date_ist, aqi: r.aqi, category: r.category, dominant: r.dominant };
    const reason = rs.every((q) => q.hours_present === 0) ? 'no readings' : r.reasons.join('; ');
    return { date_ist, aqi: null, category: null, dominant: null, reason };
  });
}

export function buildPayload(areaKey: string, st: StationEntry | null, raw: Partial<Record<Pollutant, Raw[]>>, now: Date): AirQualityPayload {
  const served_at = now.toISOString();
  if (!st) return { current: { schema: SCHEMA, area_id: areaKey, served_at, source: SOURCE, state: 'no_station', message: 'No government air monitor within 3 km of this area\'s centre.' }, history: null };

  const common = { schema: SCHEMA, area_id: areaKey, served_at, source: { ...SOURCE, owner: st.owner } } as const;
  const horizon = now.getTime() + FUTURE_SLACK_MS;
  /* Drop future-stamped rows once, so neither the freshness clock nor any window sees them. */
  const rows = Object.fromEntries(POLLUTANTS.map((p) => [p, (raw[p] ?? []).filter((r) => !(Date.parse(r.end_utc) > horizon))])) as Partial<Record<Pollutant, Raw[]>>;
  const station: AqiStation = { id: st.id, name: st.name, lat: st.lat, lon: st.lon, distance_m: st.distance_m, inside: 'window_3km' };
  const hours = Object.fromEntries(POLLUTANTS.map((p) => [p, istHours(rows[p] ?? [])])) as Record<string, Map<HourKey, Hour>>;
  const lastMs = lastStampMs(rows);
  /* Nothing usable in the whole 31-day window: the feed has been quiet far longer than 7 days. */
  if (!Number.isFinite(lastMs)) return { current: { ...common, state: 'unavailable', station, last_observed_at: null, reason: 'feed_quiet' }, history: null };

  const last = new Date(lastMs);
  const ageMs = now.getTime() - lastMs;
  /** Display only; every state decision below uses exact milliseconds. */
  const ageH = Math.floor(ageMs / HOUR_MS);
  const fresh = ageMs <= LIVE_H * HOUR_MS;
  /* The window closes at the end of the IST hour holding the last reading. */
  const lastHourKey = istHourKey(last.toISOString());
  const nextHourKey: HourKey = new Date(Date.parse(`${lastHourKey}:00:00Z`) + HOUR_MS).toISOString().slice(0, 13);
  const current = readings(hours, st, nextHourKey);
  const c = combine(current);

  const pm = hours['pm25']!;
  const history = { schema: SCHEMA, area_id: areaKey, station, days: historyDays(hours, st, now),
    /** The last 24 hours the station reported: anchored to the last reading, not to `now`. */
    pm25_24h: hoursBefore(nextHourKey).map((k) => ({ hour_ist: keyToIso(k), value: pm.has(k) ? Math.round(pm.get(k)!.mean * 10) / 10 : null })) };

  const observed_at = last.toISOString();
  if (ageMs > STALE_DAYS * DAY_MS) return { current: { ...common, state: 'unavailable', station, last_observed_at: observed_at, reason: 'feed_quiet' }, history };
  if (!c.ok) {
    /* insufficient_data is for FRESH data failing CPCB validity (spec §3). Stale with no valid AQI has nothing honest to show. */
    return fresh
      ? { current: { ...common, state: 'insufficient_data', origin: 'obos' as const, station, pollutants: current, reasons: c.reasons, observed_at }, history }
      : { current: { ...common, state: 'unavailable', station, last_observed_at: observed_at, reason: 'no_valid_aqi' }, history };
  }
  const result = { origin: 'obos' as const, aqi: c.aqi, category: c.category, dominant: c.dominant, pollutants: current, window_end_ist: keyToIso(nextHourKey), algorithm: ALGORITHM };
  return fresh
    ? { current: { ...common, state: 'live', station, result, observed_at }, history }
    : { current: { ...common, state: 'stale', station, result, observed_at, age_h: ageH }, history };
}
