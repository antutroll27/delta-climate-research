/**
 * GET /api/air-quality?area=in/kolkata/ballygunge
 * Government-station air quality for one OBOS area: current state + 30 days.
 * The OpenAQ key is read from OPENAQ_API_KEY and never leaves this function:
 * not in a response, not in a log line (only the area and a numeric status are logged).
 * Spec: docs/superpowers/specs/2026-09-26-aqi-kolkata-design.md
 */
import { buildPayload } from '../src/lib/aqi/build.ts';
import { fetchSensorWindow, OpenAqError } from '../src/lib/aqi/openaq.ts';
import { isAirArea, POLLUTANTS, stationFor } from '../src/lib/aqi/stations.ts';
import { SCHEMA } from '../src/lib/aqi/types.ts';

interface Req { method?: string; query: Record<string, string | string[] | undefined> }
interface Res { status(c: number): Res; setHeader(k: string, v: string): void; json(b: unknown): void }
interface Deps { key: string; fetch?: typeof fetch; now?: () => Date }

const OK_CACHE = 'public, max-age=60, s-maxage=600, stale-while-revalidate=1800';
const FAIL_CACHE = 'public, max-age=0, s-maxage=60';

export async function handle(req: Req, res: Res, d: Deps): Promise<void> {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); res.status(405).json({ error: 'GET only' }); return; }
  const area = typeof req.query.area === 'string' ? req.query.area : '';
  if (!isAirArea(area)) { res.status(404).json({ error: 'unknown area' }); return; }
  const st = stationFor(area), now = (d.now ?? (() => new Date()))();
  if (!st) { res.setHeader('Cache-Control', OK_CACHE); res.status(200).json(buildPayload(area, null, {}, now)); return; }
  // A misconfiguration must never be cached at the CDN: it would outlive the fix.
  if (!d.key) { res.setHeader('Cache-Control', 'no-store'); res.status(503).json({ error: 'air quality not configured' }); return; }
  const to = new Date(Math.ceil(now.getTime() / 900_000) * 900_000).toISOString();
  const from = new Date(Date.parse(to) - 31 * 86_400_000).toISOString();
  try {
    const raw = Object.fromEntries(await Promise.all(POLLUTANTS.map(async (p) =>
      [p, await fetchSensorWindow(st.sensors[p as keyof typeof st.sensors].id, from, to, { key: d.key, fetch: d.fetch })] as const)));
    res.setHeader('Cache-Control', OK_CACHE);
    res.status(200).json(buildPayload(area, st, raw, now));
  } catch (e) {
    // Never log `e` itself: only the area and the numeric status. OpenAqError messages carry no key.
    console.error('air-quality upstream failure', area, e instanceof OpenAqError ? e.status : 'unknown');
    res.setHeader('Cache-Control', FAIL_CACHE);
    const station = { id: st.id, name: st.name, lat: st.lat, lon: st.lon, distance_m: st.distance_m, inside: 'window_3km' as const };
    res.status(200).json({ current: { schema: SCHEMA, area_id: area, served_at: now.toISOString(),
      source: { owner: st.owner, via: 'CPCB via OpenAQ', standard: 'CPCB National AQI' }, state: 'unavailable', station, last_observed_at: null }, history: null });
  }
}

export default async function handler(req: Req, res: Res): Promise<void> {
  await handle(req, res, { key: process.env.OPENAQ_API_KEY ?? '' });
}
