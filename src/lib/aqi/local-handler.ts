/**
 * GET /api/air-quality?area=nl/amsterdam/canal-ring (or jp/tokyo/marunouchi): the air card of a city whose standard
 * is its own regulator's. Called from api/air-quality.ts after the area has been recognised; the CPCB path never
 * reaches this file and this file never reaches it.
 *
 * SERVER-SIDE ONLY, NO KEYS. Both sources are keyless; nothing here reads an environment variable. The browser
 * gets the payload and never contacts either government server.
 *
 * NOT READY, NOT SERVED. An area answers only while its city is drawable (local-areas.ts `localAirReady`); before
 * that it is a 404 like any unknown area, so no figure leaves the server for a card that is not on a page.
 *
 * CACHING. A LIVE answer is held in-process for CACHE_TTL_MS and shared by concurrent requests; a not-reporting
 * answer is never cached (the next request asks again), and the CDN is told so (`no-store`). The CDN may hold a live
 * answer for 5 minutes (+5 stale-while-revalidate); the browser re-judges the age on every paint, so a number is
 * never shown past its window.
 */
import { readAmsterdam } from './luchtmeetnet.ts';
import { localAirArea, localAirReady, type DrawableFn } from './local-areas.ts';
import type { LocalAirPayload } from './local-types.ts';
import { readTokyo } from './soramame.ts';
import type { Fetch } from './http.ts';

interface Res { status(c: number): Res; setHeader(k: string, v: string): void; json(b: unknown): void }

export const CACHE_TTL_MS = 10 * 60_000;
export const BUDGET_MS = 20_000;
const LIVE_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=300';
const NO_CACHE = 'no-store';

interface Entry { at: number; payload: LocalAirPayload }
export interface LocalCache { entries: Map<string, Entry>; inflight: Map<string, Promise<LocalAirPayload>> }
export const newLocalCache = (): LocalCache => ({ entries: new Map(), inflight: new Map() });
const SHARED = newLocalCache();

export interface LocalDeps {
  fetch?: Fetch;
  now?: () => Date;
  drawable?: DrawableFn;
  cache?: LocalCache;
  budgetMs?: number;
}

const realFetch: Fetch = (url, init) => fetch(url, init);

async function read(area: string, now: Date, d: LocalDeps): Promise<LocalAirPayload> {
  const cfg = localAirArea(area)!;
  const signal = AbortSignal.timeout(d.budgetMs ?? BUDGET_MS);
  const deps = { fetch: d.fetch ?? realFetch, now, signal };
  return cfg.standard === 'nl-lki' ? readAmsterdam(area, deps) : readTokyo(area, deps);
}

/** Cached live answer, a shared in-flight read, or a new read. Only a live answer enters the cache. */
function payloadFor(area: string, now: Date, d: LocalDeps): Promise<LocalAirPayload> {
  const c = d.cache ?? SHARED;
  const hit = c.entries.get(area);
  if (hit && now.getTime() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.payload);
  let p = c.inflight.get(area);
  if (!p) {
    p = read(area, now, d)
      .then((payload) => { if (payload.state === 'live') c.entries.set(area, { at: now.getTime(), payload }); return payload; })
      .finally(() => { c.inflight.delete(area); });
    c.inflight.set(area, p);
  }
  return p;
}

export async function handleLocal(area: string, res: Res, d: LocalDeps = {}): Promise<void> {
  if (!localAirReady(area, d.drawable)) { res.status(404).json({ error: 'unknown area' }); return; }
  const now = (d.now ?? (() => new Date()))();
  const payload = await payloadFor(area, now, d);
  res.setHeader('Cache-Control', payload.state === 'live' ? LIVE_CACHE : NO_CACHE);
  res.status(200).json(payload);
}

