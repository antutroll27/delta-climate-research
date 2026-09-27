/**
 * GET /api/air-quality?area=in/kolkata/ballygunge
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
 */
import { waitUntil } from '@vercel/functions';
import { buildPayload } from '../src/lib/aqi/build.ts';
import { currentFromFeed, fetchFeed, FeedError, pick, type FeedStation } from '../src/lib/aqi/cpcb-feed.ts';
import type { Raw } from '../src/lib/aqi/hours.ts';
import { fetchSensorWindow, OpenAqError } from '../src/lib/aqi/openaq.ts';
import { isAirArea, POLLUTANTS, stationFor, type StationEntry } from '../src/lib/aqi/stations.ts';
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
}

const OK_CACHE = 'public, max-age=60, s-maxage=600, stale-while-revalidate=1800';
/** A failure must not replace the CDN's last good payload: no-store lets stale-while-revalidate keep serving it. */
const FAIL_CACHE = 'no-store';
export const CACHE_TTL_MS = 10 * 60_000;
export const BUDGET_MS = 20_000;

const CACHE = new Map<string, CacheEntry>();
const INFLIGHT = new Map<string, Promise<RawSet>>();

export interface FeedCache { entry: { at: number; stations: FeedStation[] } | null; inflight: Promise<FeedStation[]> | null }
const FEED: FeedCache = { entry: null, inflight: null };
export const GRACE_MS = 1_500;
/** An answer without history must not sit at the CDN for 10 minutes: the next visitor should get the chart. */
const PARTIAL_CACHE = 'public, max-age=0, s-maxage=60';

/** CPCB's whole feed, cached 10 min and shared by every area; null on any failure (logged, never cached). */
function feedFor(now: Date, d: Deps): Promise<FeedStation[] | null> {
  const c = d.feedCache ?? FEED;
  if (c.entry && now.getTime() - c.entry.at < CACHE_TTL_MS) return Promise.resolve(c.entry.stations);
  if (!c.inflight) {
    c.inflight = fetchFeed({ fetch: d.fetch })
      .then((stations) => { c.entry = { at: now.getTime(), stations }; return stations; })
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
async function fetchAll(st: StationEntry, now: Date, d: Deps): Promise<RawSet> {
  const to = new Date(Math.ceil(now.getTime() / 900_000) * 900_000).toISOString();
  const from = new Date(Date.parse(to) - 31 * 86_400_000).toISOString();
  const ctl = new AbortController();
  const signal = AbortSignal.any([ctl.signal, AbortSignal.timeout(d.budgetMs ?? BUDGET_MS)]);
  let first: unknown = null;
  const work = Promise.allSettled(POLLUTANTS.map(async (p) => {
    try {
      return await fetchSensorWindow(st.sensors[p as keyof typeof st.sensors].id, from, to, { key: d.key, fetch: d.fetch, signal });
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
function rawFor(area: string, st: StationEntry, now: Date, d: Deps): Promise<RawSet> {
  const cache = d.cache ?? CACHE, inflight = d.inflight ?? INFLIGHT;
  const hit = cache.get(area);
  if (hit && now.getTime() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.raw);
  let p = inflight.get(area);
  if (!p) {
    p = fetchAll(st, now, d)
      .then((raw) => { cache.set(area, { at: now.getTime(), raw }); return raw; })
      .finally(() => { inflight.delete(area); });
    inflight.set(area, p);
  }
  return p;
}

function upstreamError(area: string, st: StationEntry, now: Date): AirQualityPayload {
  const station = { id: st.id, name: st.name, lat: st.lat, lon: st.lon, distance_m: st.distance_m, inside: 'window_3km' as const };
  return { current: { schema: SCHEMA, area_id: area, served_at: now.toISOString(),
    source: { owner: st.owner, via: 'CPCB via OpenAQ', standard: 'CPCB National AQI' },
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
  const feedP = feedFor(now, d);
  const rawP: Promise<Settled> | null = d.key
    ? rawFor(area, st, now, d).then((raw) => ({ ok: true as const, raw }), (e: unknown) => ({ ok: false as const, e }))
    : null;
  const feed = await feedP;
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
      } else if (r.ok) {
        history = buildPayload(area, st, r.raw, now).history;
      } else {
        logUpstream(area, r.e);
      }
    }
    res.setHeader('Cache-Control', history ? OK_CACHE : PARTIAL_CACHE);
    res.status(200).json({ current, history } satisfies AirQualityPayload);
    return;
  }

  // CPCB unusable: today's path. A misconfiguration must never be cached at the CDN: it would outlive the fix.
  if (!rawP) { res.setHeader('Cache-Control', 'no-store'); res.status(503).json({ error: 'air quality not configured' }); return; }
  const r = await rawP;
  if (!r.ok) {
    // Never log `e` itself: only the area and the numeric status. OpenAqError messages carry no key.
    logUpstream(area, r.e);
    res.setHeader('Cache-Control', FAIL_CACHE);
    res.status(200).json(upstreamError(area, st, now));
    return;
  }
  res.setHeader('Cache-Control', OK_CACHE);
  res.status(200).json(buildPayload(area, st, r.raw, now));
}

export default async function handler(req: Req, res: Res): Promise<void> {
  await handle(req, res, { key: process.env.OPENAQ_API_KEY ?? '' });
}
