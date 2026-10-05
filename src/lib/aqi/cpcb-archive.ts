/**
 * THE HOURLY CPCB ARCHIVE: the relay's only stored object, and where "current" and NowCast come from.
 * Documented in docs/AQI/04-delivery-roadmap.md, Phase 3 ("Raw hourly archive").
 *
 * WHAT IS STORED. One private Vercel Blob object per CPCB hour, the gzip the Pi sent, byte for
 * byte (CPCB's XML unchanged), at `archivePath(lastupdate)` (relay-store.ts):
 *
 *   cpcb/archive/YYYY/MM/DD/HH.xml.gz   YYYY/MM/DD HH = the IST wall-clock hour of CPCB's `lastupdate`
 *
 * CPCB stamps `lastupdate` in IST ("27-09-2026 05:00:00"), so the path reads exactly as CPCB's own
 * stamp does: 00:00 IST on 6 Oct is `2026/10/06/00`, although that instant is 18:30 UTC on 5 Oct.
 * IST has no daylight saving, so every IST hour exists once and the key is never ambiguous.
 * Written once per hour by api/air-quality-ingest.ts (first write wins), never overwritten.
 *
 * NO INDEX, NO LIST. A reader computes the path from the hour and `get`s it. `list()` is an
 * Advanced Operation, the scarce kind on Hobby (2,000 a month), so nothing here lists.
 *
 * READING "CURRENT" (`readLiveFeed`). Walk the IST hours from the one containing `now` back
 * LIVE_H hours (2 h → 3 gets; 4 within 15 min of the next hour, see `walkPaths`); the newest archive
 * found is the current feed. Three hours
 * are exactly enough: a feed archived in hour H-3 has a `lastupdate` before H-2:00, so it is more
 * than LIVE_H old at any instant of hour H and `requireLive` would refuse it anyway. Each probe is
 * `fresh` (useCache: false): it asks whether an hour has arrived, and a cached 404 could hide an
 * hour written a minute ago. A 404 means "try the hour before"; any other failure is
 * 'relay store unreachable' at once, never quietly treated as missing (that would serve an older
 * hour while a newer one exists). A found hour is remembered in-process (`ArchiveMemo`), so on a
 * warm instance the walk only re-asks the hours NEWER than the one it already holds.
 *
 * NOWCAST (`readNowcastHistory`). The 11 hours before the current feed's are settled: nothing
 * writes them any more (the Pi submits only a later lastupdate, and a retry is for the newest
 * hour). So they are read through the CDN (immutable, a cache HIT is not a Simple Operation),
 * remembered in-process, and folded into the same `History` the old cpcb/hourly-pm.json held, so
 * `nowcastFor` is unchanged. An hour with no archive is a gap, exactly as an hour the old record
 * never received. A gap is NOT trusted to stay one: a rare late submission (a put that landed after
 * the ingest's deadline, then CPCB flapping back an hour) can still fill it, and the old record took
 * such an hour at once. So a known gap is asked again at every refresh, `fresh`, since its first
 * read went through the CDN and may have left a cached 404 there. In normal running there are no
 * gaps and this costs nothing; after a relay outage it costs one Simple Operation per missing hour
 * per refresh, for the 11 hours the gap stays in the window. An hour that cannot be READ (not a 404)
 * withdraws the NowCast for this refresh (null), as an unreadable record did before: a NowCast
 * silently missing an hour that exists is not served. An object that reads but is not a feed of
 * its hour counts as a gap (only verified feeds are ever written, so this should never happen).
 */
import { addHour, hourOf, type History, type HourRecord } from './hourly-history.ts';
import { FeedError, parseRelayGzip, requireLive, type FeedStation } from './cpcb-feed.ts';
import { LIVE_H } from './build.ts';
import { archivePath, STORE_TIMEOUT_MS, type FeedStore, type ReadOptions } from './relay-store.ts';
import { NOWCAST_HOURS } from './us-aqi.ts';

const HOUR_MS = 3_600_000;

/** The store could not be read (not a 404). A FeedError, so every caller that falls back on one still does. */
export class StoreUnreachableError extends FeedError {}
/**
 * The store answered, but no archive within LIVE_H ('relay feed missing') or the newest is too old
 * ('relay feed not live'): the relay is quiet, not the store broken. The handler waits longer before
 * asking again (api/air-quality.ts RELAY_QUIET_RETRY_MS), which is what bounds an outage's cost.
 */
export class RelayQuietError extends FeedError {}

/**
 * How far ahead of the clock a lastupdate may be; the ingest accepts a feed up to this far in the
 * future (api/air-quality-ingest.ts), so the walk looks into the next IST hour inside this window.
 */
export const FUTURE_SLACK_MS = 15 * 60_000;

/** What one instance remembers between refreshes. Every entry is an immutable archive object, or a known gap. */
export interface ArchiveMemo {
  /** The newest archive the walk found, whole (current figure, city mean, ladders). */
  newest: { path: string; stations: FeedStation[] } | null;
  /** NowCast hours by path: the hour's tracked PM, or null for a gap (asked again, fresh, next time). */
  hours: Map<string, HourRecord | null>;
}
export const newArchiveMemo = (): ArchiveMemo => ({ newest: null, hours: new Map() });

/**
 * The walk's paths, newest first: the IST hour containing `now`, then the LIVE_H hours before it;
 * and, only within FUTURE_SLACK_MS of the next IST hour, that hour first (a feed stamped up to 15 min
 * ahead is accepted by the ingest, so it may already be archived). 3 paths, or 4 in that window.
 */
export function walkPaths(now: Date): string[] {
  const back = Array.from({ length: LIVE_H + 1 }, (_, k) => archivePath(new Date(now.getTime() - k * HOUR_MS).toISOString()));
  const ahead = archivePath(new Date(now.getTime() + FUTURE_SLACK_MS).toISOString());
  return ahead === back[0] ? back : [ahead, ...back];
}

/**
 * The archived feed at `path`, or null when that hour was never archived (404). Throws FeedError:
 * 'relay store unreachable' for any store failure (its own message may name the store: not
 * kept), the parser's errors for a corrupt object, and 'relay feed not its hour' when the
 * object's `lastupdate` belongs to another hour.
 */
export async function readArchive(store: FeedStore, path: string, o: ReadOptions = {}): Promise<FeedStation[] | null> {
  let gz: Uint8Array | null;
  try {
    gz = await store.getArchive(path, o);
  } catch {
    throw new StoreUnreachableError('relay store unreachable');
  }
  if (gz === null) return null;
  const feed = parseRelayGzip(gz);
  if (feed.some((s) => archivePath(s.published_at) !== path)) throw new FeedError('relay feed not its hour');
  return feed;
}

/** The archived feed for the IST hour containing `at` (ISO with its offset, or a Date); null when there is none. */
export async function readArchivedHour(store: FeedStore, at: string | Date): Promise<FeedStation[] | null> {
  return readArchive(store, archivePath(typeof at === 'string' ? at : at.toISOString()));
}

/**
 * The newest archived feed within the walk (see the header). Throws FeedError 'relay feed missing'
 * when no hour of the walk is archived, or the first read failure met on the way.
 */
export async function readLiveFeed(store: FeedStore, now: Date, memo: ArchiveMemo, signal?: AbortSignal): Promise<FeedStation[]> {
  for (const path of walkPaths(now)) {
    if (memo.newest?.path === path) return memo.newest.stations;
    const feed = await readArchive(store, path, { fresh: true, signal });
    if (feed) {
      memo.newest = { path, stations: feed };
      return feed;
    }
  }
  throw new RelayQuietError('relay feed missing');
}

/**
 * The hourly PM record behind NowCast for `current` (a feed snapshot): its own hour plus the
 * NOWCAST_HOURS - 1 hours before it, from the archive. Null when any of those hours could not be
 * read. Never throws.
 */
export async function readNowcastHistory(store: FeedStore, current: readonly FeedStation[], memo: ArchiveMemo,
  signal?: AbortSignal): Promise<History | null> {
  const own = hourOf(current);
  if (!own) return null;
  const t = Date.parse(own.at), ownPath = archivePath(own.at);
  const paths = Array.from({ length: NOWCAST_HOURS - 1 }, (_, i) => archivePath(new Date(t - (i + 1) * HOUR_MS).toISOString()));
  memo.hours.set(ownPath, own);
  const recs = await Promise.all(paths.map(async (path): Promise<HourRecord | null | 'failed'> => {
    const hit = memo.hours.get(path);
    if (hit) return hit;
    try {
      /* Never seen: through the CDN. Seen missing (null): fresh, so a cached 404 cannot hide a late hour. */
      /* A cold instance's first CDN read may still meet a 404 cached by another reader; it self-heals at the next refresh (null → fresh). */
      const feed = await readArchive(store, path, { signal, fresh: hit === null });
      const rec = feed ? hourOf(feed) : null;
      memo.hours.set(path, rec);
      return rec;
    } catch (e) {
      /* Unreachable: withdraw this NowCast, ask again next refresh. An object that is there but not a feed
         of its hour (impossible for verified writes) is a gap, as the old record never held such an hour. */
      if (e instanceof StoreUnreachableError) return 'failed';
      memo.hours.set(path, null);
      return null;
    }
  }));
  /* Only the hours this NowCast can use are kept: the memo never grows past 12 entries. */
  const keep = new Set([ownPath, ...paths]);
  for (const k of memo.hours.keys()) if (!keep.has(k)) memo.hours.delete(k);
  if (recs.includes('failed')) return null;
  let h: History | null = null;
  for (const r of [...recs].reverse()) if (r && r !== 'failed') h = addHour(h, r);
  return addHour(h, own);
}

export interface RelaySnapshot { stations: FeedStation[]; history: History | null }

/**
 * Everything /api/air-quality needs from the relay: the current feed (live, or a FeedError, so
 * the caller falls back exactly as before) and its NowCast hours. Each stage has its own
 * STORE_TIMEOUT_MS deadline, so the whole read is bounded at twice that.
 */
export async function readRelay(store: FeedStore, now: Date, memo: ArchiveMemo): Promise<RelaySnapshot> {
  const feed = await readLiveFeed(store, now, memo, AbortSignal.timeout(STORE_TIMEOUT_MS));
  let stations: FeedStation[];
  try {
    stations = requireLive(feed, now);
  } catch (e) {
    throw e instanceof FeedError ? new RelayQuietError(e.message) : e;
  }
  const history = await readNowcastHistory(store, stations, memo, AbortSignal.timeout(STORE_TIMEOUT_MS));
  return { stations, history };
}
