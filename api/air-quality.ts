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
 */
import { buildPayload } from '../src/lib/aqi/build.ts';
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
}

const OK_CACHE = 'public, max-age=60, s-maxage=600, stale-while-revalidate=1800';
/** A failure must not replace the CDN's last good payload: no-store lets stale-while-revalidate keep serving it. */
const FAIL_CACHE = 'no-store';
export const CACHE_TTL_MS = 10 * 60_000;
export const BUDGET_MS = 20_000;

const CACHE = new Map<string, CacheEntry>();
const INFLIGHT = new Map<string, Promise<RawSet>>();

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
  // A misconfiguration must never be cached at the CDN: it would outlive the fix.
  if (!d.key) { res.setHeader('Cache-Control', 'no-store'); res.status(503).json({ error: 'air quality not configured' }); return; }
  let raw: RawSet;
  try {
    raw = await rawFor(area, st, now, d);
  } catch (e) {
    // Never log `e` itself: only the area and the numeric status. OpenAqError messages carry no key.
    console.error('air-quality upstream failure', area, e instanceof OpenAqError ? e.status : 'unknown');
    res.setHeader('Cache-Control', FAIL_CACHE);
    res.status(200).json(upstreamError(area, st, now));
    return;
  }
  res.setHeader('Cache-Control', OK_CACHE);
  res.status(200).json(buildPayload(area, st, raw, now));
}

export default async function handler(req: Req, res: Res): Promise<void> {
  await handle(req, res, { key: process.env.OPENAQ_API_KEY ?? '' });
}
