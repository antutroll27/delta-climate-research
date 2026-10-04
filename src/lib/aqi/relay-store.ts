/**
 * WHERE THE RELAYED CPCB FEED LIVES (spec 2026-09-29 §2 D4, §5).
 *
 * Private Vercel Blob, two kinds of object, both gzip of CPCB's XML unchanged:
 *   cpcb/latest.xml.gz                      overwritten on each new hour
 *   cpcb/archive/YYYY/MM/DD/HH.xml.gz       keyed by the feed's IST lastupdate, written once
 *   cpcb/hourly-pm.json                     the rolling hourly PM record behind NowCast (hourly-history.ts)
 *
 * Only OBOS writes here (api/air-quality-ingest.ts, after verifying the Pi's
 * signature and parsing the feed). The Blob token never leaves Vercel.
 *
 * "ALREADY EXISTS" IS NOT A TYPED ERROR in @vercel/blob 2.8: the SDK maps the
 * server's refusal to a plain BlobError whose only signal is its message. So an
 * archive put that fails with a BlobError is followed by head(): if the blob is
 * there, the answer is 'exists'; otherwise the put's own error is rethrown. That
 * survives a change of wording, and a genuine failure is never mistaken for a duplicate.
 */
import { BlobError, get as blobGet, head as blobHead, put as blobPut } from '@vercel/blob';

export const LATEST_PATH = 'cpcb/latest.xml.gz';
/** The largest gzip accepted or read back, bytes (spec §4: 1 MB; the real feed is ~43 KB). */
export const RELAY_MAX_GZ_BYTES = 1_000_000;
/** One read of the store, ms: the same budget as a direct CPCB fetch (FEED_TIMEOUT_MS). */
export const STORE_TIMEOUT_MS = 8_000;

export interface FeedStore {
  getLatest(): Promise<Uint8Array | null>;
  putLatest(gz: Uint8Array): Promise<void>;
  putArchive(path: string, gz: Uint8Array): Promise<'stored' | 'exists'>;
  /* The NowCast history (hourly-history.ts). Optional: a store without them simply keeps no
     history, and the card shows the 24-hour US line instead. */
  getHistory?(): Promise<string | null>;
  putHistory?(json: string): Promise<void>;
  /** One archive object by its path, or null when there is none. */
  getArchive?(path: string): Promise<Uint8Array | null>;
}

export const HISTORY_PATH = 'cpcb/hourly-pm.json';
/** The history is ~5 KB; anything near this is not ours. */
export const HISTORY_MAX_BYTES = 256_000;

const IST_MS = 5.5 * 3_600_000;
const pad = (n: number): string => String(n).padStart(2, '0');

/** The archive path for a feed published at `publishedAt` (ISO UTC), in IST: cpcb/archive/2026/09/27/05.xml.gz. */
export function archivePath(publishedAt: string): string {
  const ms = Date.parse(publishedAt);
  if (!Number.isFinite(ms)) throw new RangeError(`not an ISO time: ${publishedAt}`);
  const d = new Date(ms + IST_MS);
  return `cpcb/archive/${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${pad(d.getUTCHours())}.xml.gz`;
}

/** An in-memory store for tests and the local rehearsal. `files` is exposed for assertions. */
export function memoryStore(): FeedStore & { readonly files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async getLatest() { return files.get(LATEST_PATH) ?? null; },
    async putLatest(gz) { files.set(LATEST_PATH, gz.slice()); },
    async putArchive(path, gz) {
      if (files.has(path)) return 'exists';
      files.set(path, gz.slice());
      return 'stored';
    },
    async getHistory() { const b = files.get(HISTORY_PATH); return b ? new TextDecoder().decode(b) : null; },
    async putHistory(json) { files.set(HISTORY_PATH, new TextEncoder().encode(json)); },
    async getArchive(path) { return files.get(path)?.slice() ?? null; },
  };
}

/** The slice of @vercel/blob the store uses; tests inject fakes. */
export interface BlobApi { put: typeof blobPut; get: typeof blobGet; head: typeof blobHead }

/** Reads a stream to bytes, abandoning it once it passes `cap`. */
async function readCapped(stream: ReadableStream<Uint8Array>, cap: number): Promise<Uint8Array> {
  const reader = stream.getReader(), chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > cap) { await reader.cancel().catch(() => {}); throw new RangeError('relay blob too large'); }
    chunks.push(value);
  }
  const all = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return all;
}

/** The production store: private Vercel Blob. Credentials come from the environment (BLOB_READ_WRITE_TOKEN). */
export function blobStore(api: Partial<BlobApi> = {}): FeedStore {
  const put = api.put ?? blobPut, get = api.get ?? blobGet, head = api.head ?? blobHead;
  const common = { access: 'private', addRandomSuffix: false, contentType: 'application/gzip' } as const;
  return {
    async getLatest() {
      /* useCache false: latest is overwritten hourly, and a CDN copy would serve the previous hour. */
      const r = await get(LATEST_PATH, { access: 'private', useCache: false, abortSignal: AbortSignal.timeout(STORE_TIMEOUT_MS) });
      if (r === null) return null;
      if (r.statusCode !== 200) throw new Error(`relay blob answered ${r.statusCode}`);
      return readCapped(r.stream, RELAY_MAX_GZ_BYTES);
    },
    async putLatest(gz) {
      await put(LATEST_PATH, Buffer.from(gz), { ...common, allowOverwrite: true, cacheControlMaxAge: 60 });
    },
    async getHistory() {
      /* Uncached, like latest: it changes every hour. */
      const r = await get(HISTORY_PATH, { access: 'private', useCache: false, abortSignal: AbortSignal.timeout(STORE_TIMEOUT_MS) });
      if (r === null) return null;
      if (r.statusCode !== 200) throw new Error(`relay blob answered ${r.statusCode}`);
      return new TextDecoder().decode(await readCapped(r.stream, HISTORY_MAX_BYTES));
    },
    async putHistory(json) {
      await put(HISTORY_PATH, json, { access: 'private', addRandomSuffix: false, contentType: 'application/json', allowOverwrite: true, cacheControlMaxAge: 60 });
    },
    async getArchive(path) {
      /* Written once, so a cached copy is the same bytes. */
      const r = await get(path, { access: 'private', abortSignal: AbortSignal.timeout(STORE_TIMEOUT_MS) });
      if (r === null) return null;
      if (r.statusCode !== 200) throw new Error(`relay blob answered ${r.statusCode}`);
      return readCapped(r.stream, RELAY_MAX_GZ_BYTES);
    },
    async putArchive(path, gz) {
      try {
        await put(path, Buffer.from(gz), { ...common, allowOverwrite: false });
        return 'stored';
      } catch (e) {
        if (!(e instanceof BlobError)) throw e;
        const there = await head(path).then(() => true, () => false);
        if (there) return 'exists';
        throw e;
      }
    },
  };
}
