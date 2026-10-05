/**
 * THE ROLLING HOURLY PM RECORD behind the US NowCast line (us-aqi.ts `usNowcast`).
 *
 * CPCB's feed carries only the LATEST hour's sub-index per pollutant (`Hourly_sub_index`;
 * Phase A, 2026-10-05: inverted through the NAQI bands it reproduces the raw hourly
 * µg/m³ within ±0.3 for PM2.5 and ±0.5 for PM10). NowCast needs the last 12, so the
 * ingest keeps them: one small JSON in private Blob (`HISTORY_PATH`), the PM2.5/PM10
 * hourly sub-indices of the stations OBOS uses, for the newest HISTORY_HOURS distinct
 * hours. It holds sub-indices exactly as CPCB published them; conversion happens on read.
 *
 * Keyed by the feed's `lastupdate`, so a repeated hour replaces itself (idempotent) and a
 * skipped hour is simply absent: `series` places each hour by its time, never by position.
 *
 * Pure except `updateHistory` and `readHistory`, which take the store as an argument.
 */
import { gunzipSync } from 'node:zlib';
import { FEED_MAX_BYTES, parseFeed, type FeedStation } from './cpcb-feed.ts';
import { archivePath, HISTORY_PATH, type FeedStore } from './relay-store.ts';
import { AREAS, candidatesFor } from './stations.ts';
import { naqiToConcentration, NOWCAST_HOURS, usNowcast, type UsPollutant } from './us-aqi.ts';
import type { UsNowcast } from './types.ts';

export { HISTORY_PATH };
/** Distinct hours kept; also the oldest hour kept, in hours behind the newest. */
export const HISTORY_HOURS = 24;
const HOUR_MS = 3_600_000;

/**
 * CPCB's exact names of every station OBOS may show (stations.ts), Kolkata's and every rung of
 * Bengaluru's ladders, the only ones recorded; each once (the ladders share their stations). Every
 * rung is recorded so a fallback station has its own hours, and so its own NowCast, when it is served.
 */
export const TRACKED: readonly string[] = [...new Set(Object.keys(AREAS).flatMap((k) => candidatesFor(k).map((s) => s.cpcb_name)))];

export interface PmHour { pm25: number | null; pm10: number | null }
export interface HourRecord {
  /** The feed's `lastupdate`, ISO UTC. */
  at: string;
  /** By CPCB station name: the hourly sub-indices as published (null when CPCB gave none). */
  stations: Record<string, PmHour>;
}
export interface History { v: 1; hours: HourRecord[] }

const si = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 500;
const siOrNull = (v: unknown): boolean => v === null || si(v);
const obj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The hourly PM sub-indices of `names` in one feed snapshot (every station shares its `lastupdate`). */
export function hourOf(feed: readonly FeedStation[], names: readonly string[] = TRACKED): HourRecord | null {
  const at = feed[0]?.published_at;
  if (!at) return null;
  const stations: Record<string, PmHour> = {};
  for (const name of names) {
    const same = feed.filter((s) => s.name === name);
    if (same.length !== 1) continue; // absent, or ambiguous: record nothing rather than guess
    const h = (p: UsPollutant): number | null => {
      const v = same[0]!.subindices.find((q) => q.parameter === p)?.hourly ?? null;
      return si(v) ? v : null;
    };
    stations[name] = { pm25: h('pm25'), pm10: h('pm10') };
  }
  return { at: new Date(Date.parse(at)).toISOString(), stations };
}

/**
 * `h` with `hour` in it: one record per `at` (a repeat replaces, so a duplicate is a no-op),
 * oldest first, at most HISTORY_HOURS records, none more than HISTORY_HOURS hours behind the newest.
 */
export function addHour(h: History | null, hour: HourRecord): History {
  const byAt = new Map((h?.hours ?? []).map((r) => [Date.parse(r.at), r] as const));
  byAt.set(Date.parse(hour.at), hour);
  const sorted = [...byAt.entries()].sort((a, b) => a[0] - b[0]);
  const newest = sorted[sorted.length - 1]![0];
  const kept = sorted.filter(([t]) => newest - t < HISTORY_HOURS * HOUR_MS).slice(-HISTORY_HOURS);
  return { v: 1, hours: kept.map(([, r]) => r) };
}

/** A stored history, or null when the text is not one. Every value is checked; nothing is coerced. */
export function parseHistory(text: string): History | null {
  let x: unknown;
  try { x = JSON.parse(text); } catch { return null; }
  if (!obj(x) || x['v'] !== 1 || !Array.isArray(x['hours'])) return null;
  const okHour = (r: unknown): r is HourRecord => obj(r) && typeof r['at'] === 'string' && Number.isFinite(Date.parse(r['at']))
    && obj(r['stations']) && Object.values(r['stations']).every((s) => obj(s) && siOrNull(s['pm25']) && siOrNull(s['pm10']));
  return x['hours'].every(okHour) ? { v: 1, hours: x['hours'] } : null;
}

/**
 * One station's hourly concentrations (µg/m³), latest first, NOWCAST_HOURS slots ending at
 * `latestAt`: slot k is the hour k hours before it, null when that hour is not on record.
 */
export function series(h: History | null, name: string, p: UsPollutant, latestAt: string): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: NOWCAST_HOURS }, () => null);
  const latest = Date.parse(latestAt);
  for (const r of h?.hours ?? []) {
    const k = (latest - Date.parse(r.at)) / HOUR_MS;
    const v = r.stations[name]?.[p];
    /* Whole hours only: a stamp off the hour grid is not slotted by guesswork. */
    if (Number.isInteger(k) && k >= 0 && k < NOWCAST_HOURS && si(v)) out[k] = naqiToConcentration(p, v);
  }
  return out;
}

/**
 * The US NowCast for one station of the CURRENT feed, from the stored history with the
 * current snapshot laid over it (so a history write that failed for this hour costs nothing).
 * Null when either pollutant lacks 2 of its latest 3 hours.
 */
export function nowcastFor(h: History | null, f: FeedStation): UsNowcast | null {
  const now = hourOf([f], [f.name]);
  const merged = now ? addHour(h, now) : h;
  return usNowcast(series(merged, f.name, 'pm25', f.published_at), series(merged, f.name, 'pm10', f.published_at));
}

/** The stored history, or null when it is absent, unreadable, or the store keeps none. Never throws. */
export async function readHistory(store: FeedStore): Promise<History | null> {
  if (!store.getHistory) return null;
  try {
    const text = await store.getHistory();
    return text === null ? null : parseHistory(text);
  } catch {
    return null;
  }
}

/**
 * The history rebuilt from the hourly archives: the REBUILD_HOURS hours before `lastupdate`
 * (the current hour is added by the caller). Run once, when the history is missing or
 * unreadable (the first deploy); an archive that is absent or unreadable is skipped.
 */
export const REBUILD_HOURS = 11;
async function rebuild(store: FeedStore, lastupdate: string): Promise<History | null> {
  if (!store.getArchive) return null;
  const t = Date.parse(lastupdate);
  const hours = await Promise.all(Array.from({ length: REBUILD_HOURS }, async (_, i) => {
    try {
      const gz = await store.getArchive!(archivePath(new Date(t - (i + 1) * HOUR_MS).toISOString()));
      return gz ? hourOf(parseFeed(gunzipSync(gz, { maxOutputLength: FEED_MAX_BYTES }).toString('utf8'))) : null;
    } catch {
      return null;
    }
  }));
  let h: History | null = null;
  for (const r of hours) if (r) h = addHour(h, r);
  return h;
}

/**
 * Record a newly stored feed's hour. Missing or unreadable history is rebuilt from the
 * archives first (once: the write that follows creates it). Throws only when the store does.
 */
export async function updateHistory(store: FeedStore, feed: readonly FeedStation[]): Promise<History | null> {
  if (!store.getHistory || !store.putHistory) return null;
  const hour = hourOf(feed);
  if (!hour) return null;
  const text = await store.getHistory();
  const stored = text === null ? null : parseHistory(text);
  const base = stored ?? (await rebuild(store, hour.at));
  const next = addHour(base, hour);
  await store.putHistory(JSON.stringify(next));
  return next;
}
