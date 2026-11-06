/**
 * The one rule for "is this local-regulator payload still current", used by the server (before it hands a cached
 * answer back) and by the browser (every time it paints or re-paints a kept payload). Pure; client-safe.
 *
 * A live payload older than its standard's window (local-areas.ts `LOCAL_LIVE_MS`: 2 h Amsterdam, 3 h Tokyo, measured
 * from the end of the hour it is for) carries no number any more: it becomes `not_reporting`, naming the hour but
 * not its value. Exactly at the window it is still current.
 */
import { LOCAL_LIVE_MS } from './local-areas.ts';
import type { LocalAirPayload, LocalStation } from './local-types.ts';

export function judge(p: LocalAirPayload, now: Date): LocalAirPayload {
  if (p.state !== 'live') return p;
  const age = now.getTime() - Date.parse(p.observed_at);
  if (!(age > LOCAL_LIVE_MS[p.standard])) return p;
  const station: LocalStation | null = p.standard === 'nl-lki' ? p.station : ([...p.readings].sort((a, b) => a.station.distance_m - b.station.distance_m)[0]?.station ?? null);
  return { schema: p.schema, area_id: p.area_id, served_at: p.served_at, credit: p.credit, standard: p.standard,
    state: 'not_reporting', reason: 'no_current_hour', station, last_observed_at: p.observed_at };
}

/** Seconds a live payload has left before it must stop being shown, as of `now` (0 when none). */
export function secondsLeft(p: Extract<LocalAirPayload, { state: 'live' }>, now: Date): number {
  return Math.max(0, Math.floor((Date.parse(p.observed_at) + LOCAL_LIVE_MS[p.standard] - now.getTime()) / 1000));
}
