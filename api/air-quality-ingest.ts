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
 *   200 {"stored":"new"|"duplicate","lastupdate","stations"} · 503 the store failed or ran out of time (the Pi retries next tick)
 *
 * ONE WRITE PER HOUR (single-write redesign, 2026-10-06; docs/AQI/04-delivery-roadmap.md). A
 * verified feed costs exactly one Blob put: the hour's archive object, cpcb/archive/YYYY/MM/DD/HH.xml.gz
 * (IST hour of its lastupdate, cpcb-archive.ts), with allowOverwrite false. Vercel Hobby allows 2,000
 * Advanced Operations a month and BLOCKS Blob for 30 days past that; one put an hour is ~744 a month.
 * Nothing else is written: "current" and the NowCast hours are read back from the archive.
 *
 *   stored  → 200 "new"
 *   exists  → 200 "duplicate" (the put's refusal, confirmed by a head(): a Simple Operation, never a
 *             second Advanced one). A repeat of a path this instance already stored or confirmed
 *             answers "duplicate" with no store call at all (`archivedFor`).
 *   failure → 503, so the Pi retries at its next tick.
 *
 * FIRST WRITE WINS. A newer lastupdate inside an hour already archived is answered "duplicate" and
 * not stored. CPCB stamps lastupdate on the hour, so a second stamp inside one IST hour has not been
 * seen; if it happens, the card shows that hour's first feed until the next hour.
 *
 * THE DEADLINE (STORE_BUDGET_MS, 20 s). The @vercel/blob SDK retries a 5xx or a network error up to
 * 10 times with exponential backoff (1, 2, 4, 8, 16 s ...), and an abort only takes effect at its next
 * attempt. So the put is RACED against the deadline, not merely given the signal: at 20 s the answer is
 * 503 whatever the SDK is doing. 20 s leaves the 30 s maxDuration ~10 s for the body read, gunzip,
 * parse (well under 1 s for a 43 KB feed) and a cold start, and answers inside the Pi's own 30 s
 * client timeout (pi/internal/ingest/client.go DefaultTimeout), so the Pi hears a 503 and retries
 * instead of timing out. Twenty seconds also fits the SDK's first five attempts (0, 1, 3, 7, 15 s).
 * A put the deadline cut off may still land; the Pi's retry then finds it and answers "duplicate".
 *
 * Logs carry only the outcome and a machine reason: never the key, a signature or the body.
 * Every response is Cache-Control: no-store.
 */
import { gunzipSync } from 'node:zlib';
import { FEED_MAX_BYTES, FeedError, parseFeed, type FeedStation } from '../src/lib/aqi/cpcb-feed.ts';
import { readSigned, validKey, verifyV1 } from '../src/lib/aqi/relay-auth.ts';
import { archivePath, blobStore, RELAY_MAX_GZ_BYTES, type FeedStore } from '../src/lib/aqi/relay-store.ts';

export const config = { maxDuration: 30 };

export const MIN_STATIONS = 300;
const FUTURE_SLACK_MS = 15 * 60_000, MAX_AGE_MS = 7 * 86_400_000;
const KINDS = new Set(['cpcb-feed', 'ping']);

/** The archive put's whole budget, ms (see "THE DEADLINE" above). */
export const STORE_BUDGET_MS = 20_000;
/** Paths kept in `ARCHIVED`: about two days of hours. */
const ARCHIVED_MAX = 48;
/**
 * Per store, the archive paths this instance has stored or seen refused as existing: immutable
 * facts (nothing overwrites or deletes an archive), so a repeat costs no operation at all. Keyed by
 * the store object, so a test's fresh store starts empty; production uses one store, STORE.
 */
const ARCHIVED = new WeakMap<FeedStore, Set<string>>();
const archivedFor = (store: FeedStore): Set<string> => {
  let s = ARCHIVED.get(store);
  if (!s) ARCHIVED.set(store, (s = new Set()));
  return s;
};
let STORE: FeedStore | null = null;

export interface IngestDeps {
  key: string; store: FeedStore; now: () => Date;
  /** The put's deadline, ms; tests shorten it. */
  budgetMs?: number;
  /** Injected by tests; otherwise the store's own set in ARCHIVED. */
  archived?: Set<string>;
}

class StoreDeadline extends Error {}

/** `p`, or a StoreDeadline once `ms` pass, whichever settles first. The timer is always cleared. */
async function within<T>(p: Promise<T>, ms: number, ctl: AbortController): Promise<T> {
  p.catch(() => {}); // a put cut off by the deadline may still fail later: never an unhandled rejection
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { ctl.abort(); reject(new StoreDeadline('store deadline')); }, ms);
  });
  try {
    return await Promise.race([p, late]);
  } finally {
    clearTimeout(timer);
  }
}

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

  const path = archivePath(lastupdate);
  const known = d.archived ?? archivedFor(d.store);
  const dup = (): Response => {
    console.info('air-quality-ingest duplicate', lastupdate);
    return answer(200, { stored: 'duplicate', lastupdate, stations: stations.length });
  };
  if (known.has(path)) return dup();
  const ctl = new AbortController();
  let put: 'stored' | 'exists';
  try {
    put = await within(d.store.putArchive(path, body, ctl.signal), d.budgetMs ?? STORE_BUDGET_MS, ctl);
  } catch (e) {
    /* The class names the failure (a suspended store, a bad token, the deadline); the message may carry store details. */
    console.warn('air-quality-ingest store failed', e instanceof Error ? e.constructor.name : typeof e);
    return refuse(503, 'store_failed');
  }
  known.add(path);
  if (known.size > ARCHIVED_MAX) known.delete(known.values().next().value!);
  if (put === 'exists') return dup();
  console.info('air-quality-ingest stored', lastupdate, stations.length);
  return answer(200, { stored: 'new', lastupdate, stations: stations.length });
}

/** Vercel's fetch-style entry point. Every other method is answered 405 by handleIngest's first check. */
export async function POST(request: Request): Promise<Response> {
  return handleIngest(request, { key: process.env.RELAY_HMAC_KEY ?? '', store: (STORE ??= blobStore()), now: () => new Date() });
}
