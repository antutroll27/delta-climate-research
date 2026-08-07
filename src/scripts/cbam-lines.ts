/**
 * Pure logic for multi-line CBAM estimates: the line model, the two digests, the
 * per-year threshold grouping, totals and CSV serialisation. No DOM anywhere —
 * everything here is testable under node:test against the real pack.
 *
 * This file is OURS (like cbam-app.ts, unlike everything under cbam-algos/). It
 * sits outside cbam-algos/ so the statement "everything under cbam-algos/ except
 * cbam-app.ts is upstream's, byte-for-byte" stays true.
 */
import type { EstimatorPack } from './cbam-algos/estimator/estimate-from-pack.ts';

export interface Line {
  id: string;        // row key and ImportMassEntry.id — NOT part of the fingerprint
  cn: string;
  country: string;
  route: string;
  scope: 'direct' | 'direct_and_indirect';
  massT: string;
  date: string;      // ISO date; calendar year is date.slice(0, 4)
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Calendar year from an ISO date — or NaN if the date isn't a well-formed
 * YYYY-MM-DD. Deliberately does not throw: this is called from thresholdByYear's
 * grouping loop, which has no try/catch around it, so one line with a cleared
 * <input type="date"> (which yields '') must not blow up the render for every
 * other line on the page. Callers must treat NaN as "no year assigned" and route
 * the line to an unresolved bucket rather than Number.parseInt-ing further.
 */
export const yearOf = (line: Line): number =>
  (ISO_DATE.test(line.date) ? Number(line.date.slice(0, 4)) : NaN);

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A digest over the line's INPUTS AS ENTERED. This is what feeds
 * ImportMassEntry.sourceSha256 — a field that in the SaaS fingerprints a customs
 * document. We have no document, so every surface that prints this value must
 * label it "line fingerprint — inputs as entered; no source document", never as
 * source provenance. The id is excluded: it is a UI key, not an input.
 *
 * Serialised with JSON.stringify, not a delimiter-free join: '#cbCn' is free
 * text, so joining with '' lets a shifted field boundary hash identically —
 * cn='2523100'+country='0DZ' would collide with cn='25231000'+country='DZ'.
 * JSON.stringify keeps each field individually quoted (and escapes any stray
 * quote/backslash inside a field), so a boundary shift changes the serialised
 * array and therefore the digest.
 */
export function lineFingerprint(line: Line): Promise<string> {
  return sha256Hex(JSON.stringify([line.cn, line.country, line.route, line.scope, line.massT, line.date]));
}

/**
 * Identifies the exact corpus a figure was computed from: the pack's generatedAt
 * plus both source-workbook sha256s, in generatedFrom order. Replaces the
 * placeholder 'browser-prototype' the vendored stamp carries in this build —
 * decorated onto the estimate AFTER the engine returns, never inside it.
 *
 * Throws if any generatedFrom entry lacks a workbookSha256, rather than folding
 * in '' for the missing one: this digest is printed in the export as evidence of
 * which corpus produced a figure, and a hash that silently omits a workbook
 * would look like a normal, complete pin while understating what it actually
 * covers — the class of silent degradation this codebase refuses everywhere
 * else. generatedAt is left as ?? '': freshness isn't part of the "both workbook
 * hashes" claim, and the type genuinely marks it optional.
 */
export async function packSnapshotHash(pack: EstimatorPack): Promise<string> {
  const parts = [
    pack.generatedAt ?? '',
    ...pack.generatedFrom.map((s) => {
      if (!s.workbookSha256) {
        throw new Error(
          `packSnapshotHash: generatedFrom entry '${s.id}' has no workbookSha256 — `
          + 'cannot pin a corpus the pack does not actually identify',
        );
      }
      return `${s.id}@${s.version}:${s.workbookSha256}`;
    }),
  ];
  return sha256Hex(parts.join(''));
}
