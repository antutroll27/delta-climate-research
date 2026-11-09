/**
 * GET /api/air-quality?area=nl/amsterdam/canal-ring (or another of Amsterdam's 31 streamed areas, nl/amsterdam/ams-f4 …, or
 * jp/tokyo/marunouchi): the air card of a city whose standard is its own regulator's. Called from api/air-quality.ts after the area has been recognised; the CPCB path never
 * reaches this file and this file never reaches it.
 *
 * SERVER-SIDE ONLY, NO KEYS. Both sources are keyless; nothing here reads an environment variable. The browser
 * gets the payload and never contacts either government server.
 *
 * NOT READY, NOT SERVED. An area answers only while its city is drawable, or it is one of Amsterdam's streamed sheets AND streaming is on
 * (local-areas.ts `localAirReady`; `streamingEnabled` below); before that it is a 404 like any unknown area, so no figure leaves the server for a card that is
 * not on a page. Every Amsterdam area is read from its OWN centre (nl-stations.ts `amsterdamCentre`).
 *
 * CACHING. A LIVE answer is held in-process for CACHE_TTL_MS and shared by concurrent requests; a not-reporting
 * answer is held for BACKOFF_MS only (a back-off, not a figure), and the CDN is told `no-store` for it. The CDN may hold a live
 * answer for 5 minutes (+5 stale-while-revalidate); the browser re-judges the age on every paint, so a number is
 * never shown past its window.
 */
import { LKI_MODEL_HOUR_MS } from './lki.ts';
import { judge, secondsLeft } from './local-judge.ts';
import { readAmsterdam } from './luchtmeetnet.ts';
import { TILED_CITY_READY } from '../../scripts/climate-engine/scope/registry.ts';
import { localAirArea, localAirReady, type DrawableFn } from './local-areas.ts';
import type { LocalAirPayload } from './local-types.ts';
import { newNlCache, type NlCache } from './nl-cache.ts';
import { amsterdamCentre } from './nl-stations.ts';
import { readTokyo } from './soramame.ts';
import type { Fetch } from './http.ts';

/**
 * ARE THE STREAMED AREAS SERVED BY THE API? Only where whole-city streaming is on, by the SAME truth the page uses: a build made with
 * PUBLIC_OBOS_STREAM_DEV=1 (the dev flag heat-map-app.ts reads; the same variable reaches the function at run time on a deployment that sets it), or
 * `TILED_CITY_READY` (scope/registry.ts), the constant that publishes the tiled city. Turning streaming on publicly therefore opens the API too,
 * with no second switch to forget; production with streaming off serves Canal Ring (and Tokyo) only.
 * A DEPLOY THAT SHOWS THE STREAMED AREAS NEEDS PUBLIC_OBOS_STREAM_DEV=1 AT FUNCTION RUN TIME AS WELL AS AT BUILD TIME: the page reads it from the build,
 * this API from the function's environment (`process.env`, passed in by api/air-quality.ts). Set it in the Vercel environment of that deployment; a
 * `vercel deploy --prebuilt` of a locally built dev bundle without it shows the areas and the API answers 404 (the card then says it could not be loaded).
 */
export function streamingEnabled(env: Readonly<Record<string, string | undefined>> = {}, tiledCityReady: boolean = TILED_CITY_READY): boolean {
  return tiledCityReady || env['PUBLIC_OBOS_STREAM_DEV'] === '1';
}

interface Res { status(c: number): Res; setHeader(k: string, v: string): void; json(b: unknown): void }

export const CACHE_TTL_MS = 10 * 60_000;
/** TOKYO's not-reporting answer is held this long in the function. (Amsterdam's outage is bounded one level down, by the shared per-station negative entries of nl-cache.ts.) The CDN never holds it. */
export const BACKOFF_MS = 60_000;
export const BUDGET_MS = 20_000;
const NO_CACHE = 'no-store';

/**
 * The Cache-Control for a LIVE answer: 60 s in the browser, 5 min (+5 min stale-while-revalidate) at the CDN, but never
 * more than the seconds the payload has left of its window, so no cache can hold a hour past the point it stops being
 * current. Nothing left means `no-store`.
 */
export function liveCacheControl(p: Extract<LocalAirPayload, { state: 'live' }>, now: Date): string {
  /* A modelled line is for one clock hour: no cache holds the body past the end of that hour (the next read picks the next hour's row). */
  const modelLeft = p.standard === 'nl-lki' && p.model ? Math.max(0, Math.floor((Date.parse(p.model.hour_start) + LKI_MODEL_HOUR_MS - now.getTime()) / 1000)) : Infinity;
  const left = Math.min(secondsLeft(p, now), modelLeft);
  if (left <= 0) return NO_CACHE;
  const shared = Math.min(300, left);
  return `public, max-age=${Math.min(60, left)}, s-maxage=${shared}, stale-while-revalidate=${Math.min(300, left - shared)}`;
}

interface Entry { at: number; payload: LocalAirPayload }
/** `entries`/`inflight`: the area payloads (Tokyo's only). `nl`: Amsterdam's separate station and model caches and its cooldown (nl-cache.ts). */
export interface LocalCache { entries: Map<string, Entry>; inflight: Map<string, Promise<LocalAirPayload>>; nl: NlCache }
export const newLocalCache = (): LocalCache => ({ entries: new Map(), inflight: new Map(), nl: newNlCache() });
const SHARED = newLocalCache();

export interface LocalDeps {
  fetch?: Fetch;
  now?: () => Date;
  drawable?: DrawableFn;
  cache?: LocalCache;
  budgetMs?: number;
  /** Injected by tests: are the streamed Amsterdam areas served? Default: `streamingEnabled()` with no environment, i.e. TILED_CITY_READY alone (api/air-quality.ts passes `process.env`; this file reads none). */
  streaming?: boolean;
}

const realFetch: Fetch = (url, init) => fetch(url, init);

async function read(area: string, now: Date, d: LocalDeps): Promise<LocalAirPayload> {
  const cfg = localAirArea(area)!;
  const signal = AbortSignal.timeout(d.budgetMs ?? BUDGET_MS);
  const deps = { fetch: d.fetch ?? realFetch, now, signal };
  if (cfg.standard !== 'nl-lki') return readTokyo(area, deps);
  /* Every Amsterdam area is measured from ITS OWN centre (the sheet record's). A registered area with no centre is a table fault, never a quiet fall back to Canal Ring's. */
  const from = amsterdamCentre(area.split('/')[2] ?? '');
  if (from === null) throw new RangeError(`air-quality: ${area} has no centre in the sheet table`);
  return readAmsterdam(area, { ...deps, from, nl: (d.cache ?? SHARED).nl });
}

/**
 * Cached live answer, a shared in-flight read, or a new read (Tokyo). AMSTERDAM IS NOT CACHED HERE: its payload is assembled on every request from
 * the shared station and model caches (cheap, and no TTL stacks on another), each area from its own centre.
 */
function payloadFor(area: string, now: Date, d: LocalDeps): Promise<LocalAirPayload> {
  const c = d.cache ?? SHARED;
  if (localAirArea(area)?.standard === 'nl-lki') return read(area, now, d);
  const hit = c.entries.get(area);
  /* A cached hour is re-judged on THIS request's clock: one that has since passed its window is not handed back (the CPCB path
     rebuilds every hit against its own `now` for the same reason). It is dropped and the source asked again. */
  if (hit && now.getTime() - hit.at < (hit.payload.state === 'live' ? CACHE_TTL_MS : BACKOFF_MS)) {
    /* `judge` also drops a modelled line whose hour is over, so the cached payload is handed back as judged (the same object when nothing changed). */
    const judged = judge(hit.payload, now);
    if (judged.state === hit.payload.state) return Promise.resolve(judged);
  }
  let p = c.inflight.get(area);
  if (!p) {
    p = read(area, now, d)
      .then((payload) => { c.entries.set(area, { at: now.getTime(), payload }); return payload; })
      .finally(() => { c.inflight.delete(area); });
    c.inflight.set(area, p);
  }
  return p;
}

export async function handleLocal(area: string, res: Res, d: LocalDeps = {}): Promise<void> {
  /* The 31 streamed areas are served only where streaming is on (the dev build's flag, or TILED_CITY_READY): production with streaming off serves Canal Ring (and Tokyo) only. */
  if (!localAirReady(area, d.drawable) || (localAirArea(area)?.streamed === true && !(d.streaming ?? streamingEnabled()))) { res.status(404).json({ error: 'unknown area' }); return; }
  const now = (d.now ?? (() => new Date()))();
  const payload = await payloadFor(area, now, d);
  res.setHeader('Cache-Control', payload.state === 'live' ? liveCacheControl(payload, now) : NO_CACHE);
  res.status(200).json(payload);
}

