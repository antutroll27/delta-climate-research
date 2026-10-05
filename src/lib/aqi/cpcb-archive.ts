/**
 * THE HOURLY CPCB ARCHIVE: our own history of CPCB's national CAAQMS feed (~500 stations).
 * Documented in docs/AQI/04-delivery-roadmap.md, Phase 3 ("Raw hourly archive").
 *
 * WHAT IS STORED. One private Vercel Blob object per CPCB hour, the gzip the Pi sent, byte for
 * byte (CPCB's XML unchanged), at `archivePath(lastupdate)` (relay-store.ts):
 *
 *   cpcb/archive/YYYY/MM/DD/HH.xml.gz   YYYY/MM/DD HH = the IST wall-clock hour of CPCB's `lastupdate`
 *
 * CPCB stamps `lastupdate` in IST ("27-09-2026 05:00:00"), so the path reads exactly as CPCB's own
 * stamp does: 00:00 IST on 6 Oct is `2026/10/06/00`, although that instant is 18:30 UTC on 5 Oct.
 * IST has no daylight saving, so every IST hour exists once and the key is never ambiguous.
 *
 * GUARANTEES.
 *   - Only verified feeds: the ingest calls `archiveFeed` after the signature, size, gzip and parser
 *     checks have all passed (api/air-quality-ingest.ts).
 *   - At most once per IST hour: the put refuses to overwrite (`allowOverwrite: false`), so a
 *     repeated submission, or a newer `lastupdate` inside an hour already archived, leaves the
 *     first object untouched. First write wins.
 *   - Best effort: `archiveFeed` never throws. A failure is logged (error class and path only) and
 *     the ingest still stores latest and answers the Pi as usual. The Pi resubmits only when CPCB's
 *     `lastupdate` advances, so an hour whose archive put failed while latest succeeded is not
 *     retried: it is a gap, visible in the logs as "air-quality-ingest archive failed".
 *
 * NO INDEX. A reader computes the path from the hour and `get`s it (a Simple Operation). Listing
 * by prefix also works, but on Vercel Blob `list()` is an Advanced Operation, the scarce kind.
 */
import { gunzipSync } from 'node:zlib';
import { FEED_MAX_BYTES, FeedError, parseFeed, type FeedStation } from './cpcb-feed.ts';
import { archivePath, type FeedStore } from './relay-store.ts';

export type ArchiveOutcome = 'stored' | 'exists' | 'failed';

/**
 * Write `gz` (a verified feed published at `lastupdate`, ISO UTC) to its hour's archive path,
 * once. Never throws: 'failed' is logged with the error's class and the path, never its message.
 */
export async function archiveFeed(store: FeedStore, lastupdate: string, gz: Uint8Array): Promise<ArchiveOutcome> {
  let path = '(no path)';
  try {
    path = archivePath(lastupdate);
    return await store.putArchive(path, gz);
  } catch (e) {
    console.warn('air-quality-ingest archive failed', e instanceof Error ? e.constructor.name : typeof e, path);
    return 'failed';
  }
}

/**
 * The archived feed for the IST hour containing `at` (an ISO string with its offset, or a Date),
 * or null when that hour was never archived. Throws FeedError when the object is not a feed or
 * its `lastupdate` belongs to another hour, RangeError when `at` is not a time; the store's own
 * errors pass through.
 */
export async function readArchivedHour(store: FeedStore, at: string | Date): Promise<FeedStation[] | null> {
  const iso = typeof at === 'string' ? at : at.toISOString();
  const path = archivePath(iso);
  if (!store.getArchive) return null;
  const gz = await store.getArchive(path);
  if (gz === null) return null;
  let xml: string;
  try {
    xml = gunzipSync(gz, { maxOutputLength: FEED_MAX_BYTES }).toString('utf8');
  } catch {
    throw new FeedError(`archive not gzip: ${path}`);
  }
  const feed = parseFeed(xml);
  if (feed.length === 0 || feed.some((s) => archivePath(s.published_at) !== path)) {
    throw new FeedError(`archive does not match its hour: ${path}`);
  }
  return feed;
}
