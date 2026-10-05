/**
 * WHERE THE RELAYED CPCB FEED LIVES (spec 2026-09-29 §2 D4, §5; single-write redesign 2026-10-06).
 *
 * Private Vercel Blob, ONE kind of object, the gzip of CPCB's XML exactly as the Pi sent it:
 *   cpcb/archive/YYYY/MM/DD/HH.xml.gz       keyed by the feed's IST lastupdate hour, written once
 *
 * The hourly archive is the ONLY write (one Advanced Operation per CPCB hour, ~744 a month
 * against Vercel Hobby's 2,000). "Current" and the NowCast hours are read back from it
 * (cpcb-archive.ts). The objects the earlier design overwrote every hour, cpcb/latest.xml.gz
 * and cpcb/hourly-pm.json, are no longer written or read; they stay in the store untouched.
 *
 * Only OBOS writes here (api/air-quality-ingest.ts, after verifying the Pi's
 * signature and parsing the feed). The Blob token never leaves Vercel.
 *
 * "ALREADY EXISTS" IS NOT A TYPED ERROR in @vercel/blob 2.8: the SDK maps the
 * server's refusal to a plain BlobError whose only signal is its message. So an
 * archive put that fails with a BlobError is followed by head() (a Simple Operation,
 * never a second Advanced one): if the blob is there, the answer is 'exists';
 * otherwise the put's own error is rethrown. That survives a change of wording,
 * and a genuine failure is never mistaken for a duplicate.
 *
 * CACHING. An archive object is immutable (written once, never overwritten, never deleted),
 * so a CDN-cached copy is always the right bytes, and a cache HIT is not a Simple Operation.
 * What may NOT be trusted from a cache is a 404: an hour that is absent now may be written a
 * minute later, and Vercel does not document whether or how long a 404 is cached. So a read
 * that asks "has this hour arrived yet?" passes `fresh` (useCache: false, straight to origin);
 * a read of an hour that is already settled uses the CDN. cpcb-archive.ts says which is which.
 */
import { BlobError, get as blobGet, head as blobHead, put as blobPut } from '@vercel/blob';

/** The largest gzip accepted or read back, bytes (spec §4: 1 MB; the real feed is ~43 KB). */
export const RELAY_MAX_GZ_BYTES = 1_000_000;
/** One read of the store, ms: the same budget as a direct CPCB fetch (FEED_TIMEOUT_MS). */
export const STORE_TIMEOUT_MS = 8_000;

export interface ReadOptions {
  /** Bypass the CDN (useCache: false): for an hour that may have been written moments ago. */
  fresh?: boolean;
  signal?: AbortSignal;
}

export interface FeedStore {
  /** Write `gz` at `path` once. 'exists' when the path is already taken (the first write stands). */
  putArchive(path: string, gz: Uint8Array, signal?: AbortSignal): Promise<'stored' | 'exists'>;
  /** One archive object by its path, or null when there is none (404). Any other failure throws. */
  getArchive(path: string, o?: ReadOptions): Promise<Uint8Array | null>;
}

const IST_MS = 5.5 * 3_600_000;
const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * The archive path for the IST hour containing `at` (ISO with an offset): cpcb/archive/2026/09/27/05.xml.gz.
 * Built from UTC getters on the instant + 5:30, so the machine's own zone never enters.
 */
export function archivePath(at: string): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) throw new RangeError(`not an ISO time: ${at}`);
  const d = new Date(ms + IST_MS);
  return `cpcb/archive/${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${pad(d.getUTCHours())}.xml.gz`;
}

/** An in-memory store for tests and the local rehearsal. `files` is exposed for assertions. */
export function memoryStore(): FeedStore & { readonly files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async putArchive(path, gz) {
      if (files.has(path)) return 'exists';
      files.set(path, gz.slice());
      return 'stored';
    },
    async getArchive(path) { return files.get(path)?.slice() ?? null; },
  };
}

/** The slice of @vercel/blob the store uses; tests inject fakes (and count operations through them). */
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

/** The production store: private Vercel Blob. Credentials come from the environment (OIDC or BLOB_READ_WRITE_TOKEN). */
export function blobStore(api: Partial<BlobApi> = {}): FeedStore {
  const put = api.put ?? blobPut, get = api.get ?? blobGet, head = api.head ?? blobHead;
  return {
    async getArchive(path, o = {}) {
      const r = await get(path, { access: 'private', abortSignal: o.signal ?? AbortSignal.timeout(STORE_TIMEOUT_MS),
        ...(o.fresh ? { useCache: false } : {}) });
      if (r === null) return null;
      if (r.statusCode !== 200) throw new Error(`relay blob answered ${r.statusCode}`);
      return readCapped(r.stream, RELAY_MAX_GZ_BYTES);
    },
    async putArchive(path, gz, signal) {
      try {
        await put(path, Buffer.from(gz), { access: 'private', addRandomSuffix: false, contentType: 'application/gzip',
          allowOverwrite: false, ...(signal ? { abortSignal: signal } : {}) });
        return 'stored';
      } catch (e) {
        if (!(e instanceof BlobError)) throw e;
        const there = await head(path, signal ? { abortSignal: signal } : undefined).then(() => true, () => false);
        if (there) return 'exists';
        throw e;
      }
    },
  };
}
