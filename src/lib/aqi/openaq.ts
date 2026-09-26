// src/lib/aqi/openaq.ts
/**
 * OpenAQ v3 measurements for one sensor window. Server-side only: the key travels as a header, never in a URL.
 * Every upstream failure surfaces as an OpenAqError whose message names only the status and the sensor:
 * never the URL, the key, the upstream body or the underlying error (which may carry either).
 */
import type { Raw } from './hours.ts';

export class OpenAqError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'OpenAqError'; }
}
export interface OpenAqOptions {
  key: string; fetch?: typeof fetch; timeoutMs?: number; maxPages?: number;
  /** Aborts every page request; combined with the per-page timeout, whichever fires first. */
  signal?: AbortSignal;
}

const BASE = 'https://api.openaq.org/v3/sensors';
const PAGE = 1000;
/** Per-request timeout when the caller sets none, milliseconds. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Maps anything thrown while talking to OpenAQ to a typed error. The original is deliberately NOT kept as `cause`. */
function upstream(e: unknown, sensorId: number): OpenAqError {
  if (e instanceof OpenAqError) return e;
  if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) return new OpenAqError(504, `OpenAQ timed out for sensor ${sensorId}`);
  return new OpenAqError(502, `OpenAQ unreachable or unreadable for sensor ${sensorId}`);
}

async function fetchPage(f: typeof fetch, sensorId: number, fromUtc: string, toUtc: string, page: number, o: OpenAqOptions): Promise<unknown[]> {
  const u = new URL(`${BASE}/${sensorId}/measurements`);
  u.searchParams.set('datetime_from', fromUtc); u.searchParams.set('datetime_to', toUtc);
  u.searchParams.set('limit', String(PAGE)); u.searchParams.set('page', String(page));
  let body: unknown;
  try {
    const timeout = AbortSignal.timeout(o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = o.signal ? AbortSignal.any([o.signal, timeout]) : timeout;
    const res = await f(u, { headers: { 'X-API-Key': o.key, Accept: 'application/json' }, signal });
    if (!res.ok) throw new OpenAqError(res.status, `OpenAQ ${res.status} for sensor ${sensorId}`);
    body = await res.json(); // the timeout signal also covers reading the body
  } catch (e) { throw upstream(e, sensorId); }
  const results = typeof body === 'object' && body !== null ? (body as { results?: unknown }).results : undefined;
  if (!Array.isArray(results)) throw new OpenAqError(502, `OpenAQ returned no results array for sensor ${sensorId}`);
  return results;
}

export async function fetchSensorWindow(sensorId: number, fromUtc: string, toUtc: string, o: OpenAqOptions): Promise<Raw[]> {
  const f = o.fetch ?? fetch;
  const maxPages = o.maxPages ?? 6;
  /* Keyed by end stamp: a row repeated across pages (the window shifting between requests) counts once, the last seen winning. */
  const out = new Map<string, Raw>();
  for (let page = 1; page <= maxPages; page++) {
    const results = await fetchPage(f, sensorId, fromUtc, toUtc, page, o);
    for (const m of results as { value?: unknown; period?: { datetimeTo?: { utc?: unknown } } }[]) {
      const end = m?.period?.datetimeTo?.utc;
      // Only real numbers: never Number()-coerce, which turns null and '' into 0 and '12' into 12.
      if (typeof m?.value === 'number' && Number.isFinite(m.value) && typeof end === 'string') out.set(end, { end_utc: end, value: m.value });
    }
    if (results.length < PAGE) return [...out.values()];
  }
  // The last allowed page was full, so rows remain upstream. Returning what we have would silently drop
  // either the newest or the oldest readings, depending on sort order. Refuse instead.
  throw new OpenAqError(502, `OpenAQ window exceeded ${maxPages} pages for sensor ${sensorId}`);
}
