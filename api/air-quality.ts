/**
 * GET /api/air-quality?area=in/kolkata/ballygunge (or in/bengaluru/indiranagar, …)
 * Government-station air quality for one OBOS area: current state + 30 days.
 * The OpenAQ key is read from OPENAQ_API_KEY and never leaves this function:
 * not in a response, not in a log line (only the area and a numeric status are logged).
 * Spec: docs/superpowers/specs/2026-09-26-aqi-kolkata-design.md
 *
 * QUOTA. One cold call costs 18 OpenAQ requests (6 sensors x up to 3 pages) against a
 * 60 req/min key. So: any query parameter other than `area` is refused (it would bust the
 * CDN cache), the raw readings are held in-process for 10 minutes, and concurrent cold
 * requests on one instance share one upstream fetch. Failures are never cached.
 *
 * SOURCES (spec 2026-09-27): CPCB's own feed gives the current value (origin cpcb); OpenAQ
 * gives the 30-day history and is the fallback (origin obos). They are fetched in parallel
 * and fail independently.
 *
 * DORMANT BY DEFAULT (spec §11, register AQI-R48): CPCB's feed does not answer cloud IPs
 * (connect timeout from Vercel bom1 and iad1), so in production it would only add an 8 s
 * wait before every fallback. The feed runs only when AIR_CPCB_FEED is exactly "on";
 * otherwise this function is main's OpenAQ path, byte for byte in its caching.
 *
 * RELAY SOURCE (spec 2026-09-29 §5): with AIR_CPCB_SOURCE exactly "relay", the feed is read from the
 * Raspberry Pi relay's copy in private Vercel Blob (readRelayFeed) instead of from CPCB itself.
 * A relayed feed older than LIVE_H counts as a failure (requireLive), so a dead relay hands
 * over to OpenAQ instead of ageing the card; everything else after the read is unchanged.
 *
 * US NOWCAST (lib/aqi/hourly-history.ts): with the relay source, the rolling hourly PM record the
 * ingest keeps is read with the feed and cached with it; a live CPCB answer then carries
 * `us_nowcast`. The record is optional: missing or unreadable, the card shows the 24-hour US line.
 */
import { waitUntil } from '@vercel/functions';
import { buildPayload } from '../src/lib/aqi/build.ts';
import { cityAqi, cityFor } from '../src/lib/aqi/city.ts';
import { currentFromFeed, fetchFeed, FeedError, pick, readRelayFeed, requireLive, type FeedStation } from '../src/lib/aqi/cpcb-feed.ts';
import type { Raw } from '../src/lib/aqi/hours.ts';
import { nowcastFor, readHistory, type History } from '../src/lib/aqi/hourly-history.ts';
import { fetchSensorWindow, OpenAqError } from '../src/lib/aqi/openaq.ts';
import { blobStore, type FeedStore } from '../src/lib/aqi/relay-store.ts';
import { isAirArea, POLLUTANTS, stationFor, stationPayload, type StationEntry } from '../src/lib/aqi/stations.ts';
import { SCHEMA, type AirQualityPayload, type Pollutant } from '../src/lib/aqi/types.ts';

/** Vercel reads this: the handler's own deadline is 20 s, so 30 s leaves room to answer. */
export const config = { maxDuration: 30 };

type RawSet = Partial<Record<Pollutant, Raw[]>>;
/** Raw readings, not the payload: every hit is rebuilt against its own `now`, so no age ever drifts. */
export interface CacheEntry { at: number; raw: RawSet }

interface Req { method?: string; query: Record<string, string | string[] | undefined> }
interface Res { status(c: number): Res; setHeader(k: string, v: string): void; json(b: unknown): void }
interface Deps {
  key: string; fetch?: typeof fetch; now?: () => Date;
  /** Injected by tests; production uses the module-level maps below. */
  cache?: Map<string, CacheEntry>; inflight?: Map<string, Promise<RawSet>>;
  /** Whole-upstream budget, ms. */
  budgetMs?: number;
  /** CPCB feed cache, injected by tests; production uses FEED below. */
  feedCache?: FeedCache;
  /** How long the answer waits for OpenAQ once CPCB has settled, ms. */
  graceMs?: number;
  /** Keeps work alive after the response (Vercel); injected by tests. */
  waitUntil?: (p: Promise<unknown>) => void;
  /** Ask CPCB's feed at all. Off (the default): no CPCB request is made, not even a failed one. */
  cpcbFeed?: boolean;
  /** Where CPCB's feed comes from when it is on (spec 2026-09-29 §5): the Pi relay's stored copy, or CPCB directly. */
  source?: FeedSource;
  /** The relay's store; injected by tests, production uses private Vercel Blob. */
  store?: FeedStore;
}

export type FeedSource = 'relay' | 'direct';

/** The feed's source: the relay only for exactly "relay" (spec 2026-09-29 §5); anything else is direct. */
export const feedSource = (env: Readonly<Record<string, string | undefined>>): FeedSource =>
  (env['AIR_CPCB_SOURCE'] === 'relay' ? 'relay' : 'direct');

/** The CPCB feed switch: on only for exactly "on" (spec §11). */
export const feedEnabled = (env: Readonly<Record<string, string | undefined>>): boolean => env['AIR_CPCB_FEED'] === 'on';

const OK_CACHE = 'public, max-age=60, s-maxage=600, stale-while-revalidate=1800';
/** A failure must not replace the CDN's last good payload: no-store lets stale-while-revalidate keep serving it. */
const FAIL_CACHE = 'no-store';
export const CACHE_TTL_MS = 10 * 60_000;
export const BUDGET_MS = 20_000;

const CACHE = new Map<string, CacheEntry>();
const INFLIGHT = new Map<string, Promise<RawSet>>();

export interface FeedCache {
  /** `history`: the relay's hourly PM record read with the feed (null when none; absent for the direct source). */
  entry: { at: number; stations: FeedStation[]; history?: History | null } | null;
  inflight: Promise<FeedSnapshot> | null;
  /** When the last fetch failed; CPCB is not asked again for FEED_RETRY_MS (the fallback answers meanwhile). */
  failedAt?: number;
}
const FEED: FeedCache = { entry: null, inflight: null };
export const GRACE_MS = 1_500;
/** A failed feed is not refetched for this long, so an outage costs one 8 s wait a minute, not one per request. */
export const FEED_RETRY_MS = 60_000;
/**
 * 60 s at the CDN, for any answer the next visitor may improve on: CPCB current without history (the chart
 * should follow), and OBOS's fallback where a CPCB figure is expected (the server asks CPCB again after
 * FEED_RETRY_MS, so a blip must not pin the fallback for 10 min: re-audit M-2).
 */
const PARTIAL_CACHE = 'public, max-age=0, s-maxage=60';

/**
 * CPCB's whole feed, cached 10 min and shared by every area; null on any failure
 * (logged once; never cached as a feed, but not retried for FEED_RETRY_MS).
 */
interface FeedSnapshot { stations: FeedStation[]; history: History | null }

function feedFor(now: Date, d: Deps): Promise<FeedSnapshot | null> {
  const c = d.feedCache ?? FEED;
  if (c.entry && now.getTime() - c.entry.at < CACHE_TTL_MS) return Promise.resolve({ stations: c.entry.stations, history: c.entry.history ?? null });
  if (c.failedAt !== undefined && now.getTime() - c.failedAt < FEED_RETRY_MS) return Promise.resolve(null);
  if (!c.inflight) {
    const store = d.store ?? (d.source === 'relay' ? blobStore() : null);
    /* The history read never fails the feed: readHistory answers null instead of throwing. */
    const read: Promise<FeedSnapshot> = d.source === 'relay' && store
      ? Promise.all([readRelayFeed(store).then((s) => requireLive(s, now)), readHistory(store)]).then(([stations, history]) => ({ stations, history }))
      : fetchFeed({ fetch: d.fetch }).then((stations) => ({ stations, history: null }));
    c.inflight = read
      .then((snap) => { c.entry = { at: now.getTime(), ...snap }; delete c.failedAt; return snap; }, (e: unknown) => { c.failedAt = now.getTime(); throw e; })
      .finally(() => { c.inflight = null; });
  }
  return c.inflight.catch((e: unknown) => {
    console.error('air-quality cpcb feed failure', e instanceof FeedError ? e.message : 'unknown');
    return null;
  });
}

type Settled = { ok: true; raw: RawSet } | { ok: false; e: unknown };
const logUpstream = (area: string, e: unknown): void =>
  console.error('air-quality upstream failure', area, e instanceof OpenAqError ? e.status : 'unknown');

/** Rejects when `signal` aborts, so a fetch that ignores its signal still cannot hold the handler past the budget. */
const whenAborted = (signal: AbortSignal): Promise<never> => new Promise((_, reject) => {
  const fail = (): void => reject(new OpenAqError(504, 'OpenAQ exceeded the upstream budget'));
  if (signal.aborted) fail(); else signal.addEventListener('abort', fail, { once: true });
});

/**
 * All six sensors, or an error. A 404 is a sensor OpenAQ no longer has: counted as missing
 * (an empty series), and `combine()` still demands 3 pollutants including PM. Any other
 * failure (429, 5xx, timeout, network) fails the whole area and aborts the other fetches:
 * a partial picture built from throttled data is not served.
 */
async function fetchAll(sensors: NonNullable<StationEntry['sensors']>, now: Date, d: Deps): Promise<RawSet> {
  const to = new Date(Math.ceil(now.getTime() / 900_000) * 900_000).toISOString();
  const from = new Date(Date.parse(to) - 31 * 86_400_000).toISOString();
  const ctl = new AbortController();
  const signal = AbortSignal.any([ctl.signal, AbortSignal.timeout(d.budgetMs ?? BUDGET_MS)]);
  let first: unknown = null;
  const work = Promise.allSettled(POLLUTANTS.map(async (p) => {
    try {
      return await fetchSensorWindow(sensors[p as keyof typeof sensors].id, from, to, { key: d.key, fetch: d.fetch, signal });
    } catch (e) {
      if (e instanceof OpenAqError && e.status === 404) return [];
      if (first === null) first = e;
      ctl.abort();
      throw e;
    }
  }));
  try {
    /* Our own abort also fires `whenAborted`: report the failure that caused it, not the abort. */
    const settled = await Promise.race([work, whenAborted(signal)]).catch((e: unknown) => { throw first ?? e; });
    if (first !== null) throw first;
    return Object.fromEntries(POLLUTANTS.map((p, i) => [p, (settled[i] as PromiseFulfilledResult<Raw[]>).value]));
  } finally {
    ctl.abort(); // a budget abort leaves no request running
  }
}

/** Cached raw readings, a shared in-flight fetch, or a new fetch. Only successes enter the cache. */
function rawFor(area: string, sensors: NonNullable<StationEntry['sensors']>, now: Date, d: Deps): Promise<RawSet> {
  const cache = d.cache ?? CACHE, inflight = d.inflight ?? INFLIGHT;
  const hit = cache.get(area);
  if (hit && now.getTime() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.raw);
  let p = inflight.get(area);
  if (!p) {
    p = fetchAll(sensors, now, d)
      .then((raw) => { cache.set(area, { at: now.getTime(), raw }); return raw; })
      .finally(() => { inflight.delete(area); });
    inflight.set(area, p);
  }
  return p;
}

function upstreamError(area: string, st: StationEntry, now: Date): AirQualityPayload {
  const station = stationPayload(st);
  return { current: { schema: SCHEMA, area_id: area, served_at: now.toISOString(),
    source: { owner: st.owner, via: st.sensors ? 'CPCB via OpenAQ' : 'CPCB', standard: 'CPCB National AQI' },
    state: 'unavailable', station, last_observed_at: null, reason: 'upstream_error' }, history: null };
}

export async function handle(req: Req, res: Res, d: Deps): Promise<void> {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); res.status(405).json({ error: 'GET only' }); return; }
  // Every distinct URL is a CDN miss; an extra parameter would let anyone spend the OpenAQ quota.
  if (Object.keys(req.query).some((k) => k !== 'area')) {
    res.setHeader('Cache-Control', 'no-store'); res.status(400).json({ error: 'unexpected query parameter' }); return;
  }
  const area = typeof req.query.area === 'string' ? req.query.area : '';
  if (!isAirArea(area)) { res.status(404).json({ error: 'unknown area' }); return; }
  const st = stationFor(area), now = (d.now ?? (() => new Date()))();
  if (!st) { res.setHeader('Cache-Control', OK_CACHE); res.status(200).json(buildPayload(area, null, {}, now)); return; }
  const feedP = d.cpcbFeed ? feedFor(now, d) : Promise.resolve(null);
  /* A station with no OpenAQ sensors (Bengaluru) has no second source: CPCB's feed or nothing. */
  const sensors = st.sensors;
  const rawP: Promise<Settled> | null = d.key && sensors
    ? rawFor(area, sensors, now, d).then((raw) => ({ ok: true as const, raw }), (e: unknown) => ({ ok: false as const, e }))
    : null;
  const snap = await feedP;
  const feed = snap?.stations ?? null;
  const f = feed ? pick(feed, st) : null;
  const current = f ? currentFromFeed(f, area, st, now) : null;

  if (current) {
    let history: AirQualityPayload['history'] = null;
    if (rawP) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<null>((r) => { timer = setTimeout(() => r(null), d.graceMs ?? GRACE_MS); });
      const r = await Promise.race([rawP, late]).finally(() => clearTimeout(timer));
      if (r === null) {
        try { (d.waitUntil ?? waitUntil)(rawP); } catch { /* no request context (tests, dev): the fetch simply finishes on its own */ }
      } else if ('raw' in r) {
        history = buildPayload(area, st, r.raw, now).history;
      } else {
        logUpstream(area, r.e); // `in` narrows under Vercel's non-strict compile too (re-audit M-3)
      }
    }
    /* The city-wide mean rides only with a live CPCB figure, from the same snapshot; the OpenAQ
       fallback below never carries one, so no card mixes sources. */
    const ref = cityFor(area);
    const city = feed && ref && current.state === 'live' ? cityAqi(feed, ref) : null;
    /* NowCast likewise: only beside a live CPCB figure, from that station's own hours. */
    const usNowcast = f && current.state === 'live' ? nowcastFor(snap?.history ?? null, f) : null;
    /* No OpenAQ sensors: no history is coming, so the CPCB answer is already whole. */
    res.setHeader('Cache-Control', history || !sensors ? OK_CACHE : PARTIAL_CACHE);
    res.status(200).json({ current, history, ...(city ? { city } : {}), ...(usNowcast ? { us_nowcast: usNowcast } : {}) } satisfies AirQualityPayload);
    return;
  }

  // CPCB unusable: today's path. A misconfiguration must never be cached at the CDN: it would outlive the fix.
  /* No OpenAQ copy of this station to fall back on: the honest unavailable state, uncached like any failure,
     so the CDN keeps serving its last good CPCB answer and the next request asks the feed again. */
  if (!sensors) { res.setHeader('Cache-Control', FAIL_CACHE); res.status(200).json(upstreamError(area, st, now)); return; }
  if (!rawP) { res.setHeader('Cache-Control', 'no-store'); res.status(503).json({ error: 'air quality not configured' }); return; }
  const r = await rawP;
  if ('e' in r) {
    // Never log `e` itself: only the area and the numeric status. OpenAqError messages carry no key.
    logUpstream(area, r.e);
    res.setHeader('Cache-Control', FAIL_CACHE);
    res.status(200).json(upstreamError(area, st, now));
    return;
  }
  /* With the feed on, this is a fallback from a failed CPCB and lives 60 s at the CDN (M-2); with it off,
     it is the only answer there is and keeps main's 10-minute cache. */
  res.setHeader('Cache-Control', d.cpcbFeed ? PARTIAL_CACHE : OK_CACHE);
  res.status(200).json(buildPayload(area, st, r.raw, now));
}

export default async function handler(req: Req, res: Res): Promise<void> {
  await handle(req, res, { key: process.env.OPENAQ_API_KEY ?? '', cpcbFeed: feedEnabled(process.env), source: feedSource(process.env) });
}
