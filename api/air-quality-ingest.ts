/**
 * POST /api/air-quality-ingest: the Raspberry Pi relay submits CPCB's feed here.
 * Spec: docs/superpowers/specs/2026-09-29-pi-india-service-design.md §3, §4.
 *
 * The Pi holds only RELAY_HMAC_KEY, which can do nothing but submit feeds; this
 * function verifies the signature, then judges the feed with OBOS's own parser,
 * and only then writes private Vercel Blob. Nothing is stored until every check passes.
 *
 * Checks, cheapest first:
 *   405 not POST · 400 unknown X-OBOS-Kind · 503 RELAY_HMAC_KEY unset or malformed (closed by default)
 *   401 signature header missing/malformed, timestamp > 300 s off   (before the body is read; this
 *       stops malformed and stale requests only: a well-formed forgery costs one capped 1 MB read)
 *   413 body > 1 MB (Content-Length or while reading)
 *   401 signature does not match the body as sent
 *   204 a valid ping (stores nothing) · 400 a ping with a body
 *   413 inflates past 2 MB · 400 not gzip
 *   422 not a feed, < 300 stations, more than one lastupdate, lastupdate > 15 min ahead or > 7 days old
 *   200 {"stored":"new"|"duplicate","lastupdate","stations"} · 503 the store failed (the Pi retries next tick)
 *
 * Latest only moves forward: a feed replaces it only when its lastupdate is later than the
 * stored latest's (an absent or unreadable latest is replaced), so a late or replayed older
 * hour is archived but never shown as current.
 *
 * A duplicate never rewrites latest. If the archive put succeeds and the latest put fails
 * (503), the Pi's retry comes back 'duplicate', so latest can lag by up to one hour until
 * the next hour's feed repairs it; one hour stays inside the 2 h "Live" rule.
 *
 * NOWCAST HISTORY (hourly-history.ts): a NEW hour is also added to the rolling hourly PM record
 * once it is archived and latest is settled. It is best effort: a failure is logged and the answer
 * is still 200 "new", because the Pi's retry would come back "duplicate" and change nothing; the
 * read side lays the current hour over the record, so one lost write costs nothing. A missing
 * record (the first deploy) is rebuilt once from the previous 11 hourly archives.
 *
 * Logs carry only the outcome and a machine reason: never the key, a signature or the body.
 * Every response is Cache-Control: no-store.
 */
import { gunzipSync } from 'node:zlib';
import { FEED_MAX_BYTES, FeedError, parseFeed, readRelayFeed, type FeedStation } from '../src/lib/aqi/cpcb-feed.ts';
import { readSigned, validKey, verifyV1 } from '../src/lib/aqi/relay-auth.ts';
import { updateHistory } from '../src/lib/aqi/hourly-history.ts';
import { archivePath, blobStore, RELAY_MAX_GZ_BYTES, type FeedStore } from '../src/lib/aqi/relay-store.ts';

export const config = { maxDuration: 30 };

export const MIN_STATIONS = 300;
const FUTURE_SLACK_MS = 15 * 60_000, MAX_AGE_MS = 7 * 86_400_000;
const KINDS = new Set(['cpcb-feed', 'ping']);

export interface IngestDeps { key: string; store: FeedStore; now: () => Date }

const answer = (status: number, body?: Record<string, unknown>, headers: Record<string, string> = {}): Response => {
  const h = { 'Cache-Control': 'no-store', ...headers };
  return body ? Response.json(body, { status, headers: h }) : new Response(null, { status, headers: h });
};

const refuse = (status: number, reason: string, headers?: Record<string, string>): Response => {
  console.warn('air-quality-ingest refused', status, reason);
  return answer(status, { error: reason }, headers);
};

/** The body, read chunk by chunk and abandoned past `cap`; null means too large. */
async function readBody(request: Request, cap: number): Promise<Uint8Array | null> {
  if (Number(request.headers.get('content-length') ?? 0) > cap) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > cap) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return all;
}

export async function handleIngest(request: Request, d: IngestDeps): Promise<Response> {
  if (request.method !== 'POST') return refuse(405, 'method_not_allowed', { Allow: 'POST' });
  const kind = request.headers.get('x-obos-kind') ?? '';
  if (!KINDS.has(kind)) return refuse(400, 'bad_kind');
  if (!validKey(d.key)) return refuse(503, 'not_configured');
  const now = d.now();

  /* Header shape and clock first: a stale or unsigned request never costs a body read. */
  if (!readSigned(request.headers, now).ok) return refuse(401, 'unauthorized');

  const body = await readBody(request, RELAY_MAX_GZ_BYTES);
  if (body === null) return refuse(413, 'too_large');
  if (!verifyV1(d.key, request.headers, body, now).ok) return refuse(401, 'unauthorized');

  if (kind === 'ping') {
    if (body.byteLength !== 0) return refuse(400, 'ping_has_body');
    console.info('air-quality-ingest ping ok');
    return answer(204);
  }

  let xml: string;
  try {
    xml = gunzipSync(body, { maxOutputLength: FEED_MAX_BYTES }).toString('utf8');
  } catch (e) {
    return e instanceof RangeError ? refuse(413, 'too_large_inflated') : refuse(400, 'bad_gzip');
  }

  let stations: FeedStation[];
  try {
    stations = parseFeed(xml);
  } catch (e) {
    if (e instanceof FeedError) return refuse(422, 'not_a_feed');
    throw e;
  }
  if (stations.length < MIN_STATIONS) return refuse(422, 'too_few_stations');
  const stamps = new Set(stations.map((s) => s.published_at));
  if (stamps.size !== 1) return refuse(422, 'mixed_lastupdate');
  const lastupdate = stations[0]!.published_at;
  const age = now.getTime() - Date.parse(lastupdate);
  if (age < -FUTURE_SLACK_MS) return refuse(422, 'lastupdate_in_future');
  if (age > MAX_AGE_MS) return refuse(422, 'lastupdate_too_old');

  try {
    const put = await d.store.putArchive(archivePath(lastupdate), body);
    if (put === 'exists') {
      console.info('air-quality-ingest duplicate', lastupdate);
      return answer(200, { stored: 'duplicate', lastupdate, stations: stations.length });
    }
    if (await laterThanLatest(d.store, lastupdate)) await d.store.putLatest(body);
    else console.info('air-quality-ingest archived; latest is newer', lastupdate);
  } catch (e) {
    /* The class names the failure (a suspended store, a bad token, a timeout); the message may carry store details. */
    console.warn('air-quality-ingest store failed', e instanceof Error ? e.constructor.name : typeof e);
    return refuse(503, 'store_failed');
  }
  try {
    await updateHistory(d.store, stations);
  } catch (e) {
    console.warn('air-quality-ingest history failed', e instanceof Error ? e.constructor.name : typeof e);
  }
  console.info('air-quality-ingest stored', lastupdate, stations.length);
  return answer(200, { stored: 'new', lastupdate, stations: stations.length });
}

/** Vercel's fetch-style entry point. Every other method is answered 405 by handleIngest's first check. */
export async function POST(request: Request): Promise<Response> {
  return handleIngest(request, { key: process.env.RELAY_HMAC_KEY ?? '', store: blobStore(), now: () => new Date() });
}

/** Whether `lastupdate` is later than the stored latest's. An absent or unreadable latest is replaced. */
async function laterThanLatest(store: FeedStore, lastupdate: string): Promise<boolean> {
  let current: string | undefined;
  try {
    current = (await readRelayFeed(store))[0]?.published_at;
  } catch (e) {
    if (!(e instanceof FeedError)) throw e;
  }
  return current === undefined || Date.parse(lastupdate) > Date.parse(current);
}
