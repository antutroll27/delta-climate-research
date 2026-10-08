/**
 * GET /api/metar?ids=VECC  (or ids=VOBG,VOBL) — airport observations, proxied.
 *
 * WHY. OBOS's "now" read Met Norway's FORECAST, which on 2026-10-07 said fair
 * while Kolkata airport reported rain (founder decision 2: METAR first). The
 * reports come from aviationweather.gov's Data API, keyless and public.
 *
 * REACHABLE FROM VERCEL, MEASURED 2026-10-07 06:15Z: a probe function on a Preview
 * deployment fetched ids=VECC,VOBL,VOBG with HTTP 200 from iad1 (151 ms) and from
 * bom1 (631 ms). (CPCB, by contrast, refuses cloud IPs — which is why this was
 * tested from Vercel and not from a home connection.) Probe removed afterwards.
 *
 * USAGE GUIDANCE (aviationweather.gov/data/api): at most 100 requests a minute,
 * a custom User-Agent, and no more often than the product updates. Indian METARs
 * are half-hourly; s-maxage=600 collapses every visitor to one upstream call per
 * station set per 10 minutes, and only OBOS's own stations, in one canonical
 * order, are accepted, so the cache cannot be fanned out by query strings.
 *
 * THE FUNCTION DOES NOT INTERPRET. It returns the raw report text; the client
 * parses it with src/lib/weather/metar.ts, the one parser, unit-tested on real
 * reports. A shape it does not recognise is dropped, never repaired.
 */
import { ALL_METAR_ICAO } from '../src/data/metar-stations.ts';

export const UPSTREAM = 'https://aviationweather.gov/api/data/metar';
/* The site's generic address, as api/climate-clock.js uses: a public repo should not carry a person's. */
const UA = 'delta-climate-research/1.0 (https://deltaclimate.earth; management@deltaclimate.earth)';
/** Four hours covers the rain history the model reads: onset, end, an hour's re-warming. */
const HOURS = 4;
const SHARED_MAX_AGE = 600;
const EMPTY_MAX_AGE = 120;
const BUDGET_MS = 8000;
const MAX_REPORTS = 200;
const MAX_RAW = 512;

interface Req { method?: string; query: Record<string, string | string[] | undefined> }
interface Res { status(c: number): Res; setHeader(k: string, v: string): void; json(b: unknown): void }
interface Deps { fetch?: typeof fetch; now?: () => Date }

export interface MetarPayload {
  source: 'aviationweather.gov';
  /** server clock at fetch, ISO — the client resolves each report's day against it */
  fetchedAt: string;
  reports: { icao: string; raw: string }[];
}

const KNOWN = new Set(ALL_METAR_ICAO);

/** The ids parameter, if it is exactly a sorted, unique list of known stations. */
function canonicalIds(q: Req['query']): string[] | null {
  const keys = Object.keys(q);
  if (keys.length !== 1 || keys[0] !== 'ids') return null;
  const raw = q.ids;
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 64) return null;
  const ids = raw.split(',');
  const canon = [...new Set(ids)].sort();
  if (canon.join(',') !== raw) return null;
  return ids.every((id) => KNOWN.has(id)) ? ids : null;
}

export async function handle(req: Req, res: Res, d: Deps = {}): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.setHeader('Cache-Control', 'no-store');
    res.status(405).json({ error: 'GET only' });
    return;
  }
  const ids = canonicalIds(req.query ?? {});
  if (!ids) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ error: `ids must be a sorted, comma-separated subset of ${ALL_METAR_ICAO.join(',')}` });
    return;
  }
  const f = d.fetch ?? fetch;
  const now = (d.now ?? (() => new Date()))();
  try {
    const upstream = await f(`${UPSTREAM}?ids=${ids.join(',')}&format=json&hours=${HOURS}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(BUDGET_MS),
    });
    let rows: unknown = [];
    if (upstream.status === 204) rows = [];
    else if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
    else rows = await upstream.json();
    if (!Array.isArray(rows)) throw new Error('upstream body is not a list');
    const wanted = new Set(ids);
    const reports: MetarPayload['reports'] = [];
    for (const row of rows.slice(0, MAX_REPORTS * 2)) {
      if (!row || typeof row !== 'object') continue;
      const { icaoId, rawOb } = row as { icaoId?: unknown; rawOb?: unknown };
      if (typeof icaoId !== 'string' || !wanted.has(icaoId)) continue;
      if (typeof rawOb !== 'string' || rawOb.length > MAX_RAW) continue;
      reports.push({ icao: icaoId, raw: rawOb });
      if (reports.length >= MAX_REPORTS) break;
    }
    const age = reports.length ? SHARED_MAX_AGE : EMPTY_MAX_AGE;
    res.setHeader('Cache-Control', `public, max-age=60, s-maxage=${age}, stale-while-revalidate=1800`);
    /* Read by the client to age the report against the server's clock, as /api/live does. */
    res.setHeader('Date', now.toUTCString());
    const body: MetarPayload = { source: 'aviationweather.gov', fetchedAt: now.toISOString(), reports };
    res.status(200).json(body);
  } catch (e) {
    console.error('metar upstream failure', ids.join(','), (e as Error).message);
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'aviationweather.gov unreachable' });
  }
}

export default async function handler(req: Req, res: Res): Promise<void> {
  await handle(req, res);
}
