/**
 * Pure logic for multi-line CBAM estimates: the line model, the two digests, the
 * per-year threshold grouping, totals and CSV serialisation. No DOM anywhere —
 * everything here is testable under node:test against the real pack.
 *
 * This file is OURS (like cbam-app.ts, unlike everything under cbam-algos/). It
 * sits outside cbam-algos/ so the statement "everything under cbam-algos/ except
 * cbam-app.ts is upstream's, byte-for-byte" stays true.
 */
import Decimal from 'decimal.js';
import type { EstimatorPack } from './cbam-algos/estimator/estimate-from-pack.ts';
import {
  aggregateThresholdBasis, type ImportMassEntry,
} from './cbam-algos/threshold/aggregate.ts';
import { evaluateThreshold, type ThresholdState } from './cbam-algos/threshold/evaluate.ts';
import { sectorForCn } from './cbam-algos/cbam/sector.ts';
import type { CertificateEstimate } from './cbam-algos/cbam/certificate-estimate.ts';

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

/** Every session entry shares one importer — the aggregation filters on it. */
const IMPORTER = 'estimator-session';

export interface YearThreshold {
  calendarYear: number;
  ruleFound: boolean;
  /** Only when ruleFound. */
  state?: ThresholdState;
  knownEligibleMassT?: string;
  thresholdT?: string;
  sourceLocator?: string;
  entryIds?: string[];
  entryHashes?: string[];
  attested: boolean;
  /**
   * Lines in this year that counted toward the eligible mass — always
   * basis.entryIds.length, never our own pre-filter's entries.length. Two
   * filters run in series (ours, on rule.includedSectors; aggregateThresholdBasis's
   * own hardcoded massSectors) and today they agree only because the shipped
   * 2026 row's includedSectors happens to equal massSectors. If a future
   * threshold row ever includes electricity or hydrogen, a line could pass
   * ours and still be dropped by the vendored one — counting it here would
   * make eligibleLineCount claim a line that entryIds doesn't list.
   */
  eligibleLineCount: number;
}

/**
 * One threshold verdict per calendar year present in the lines.
 *
 * PER YEAR, NEVER PER ESTIMATE. The de minimis threshold (Reg 2023/956 Art 2(3))
 * is annual; summing across years would report a 30 t 2026 + 30 t 2027 estimate
 * as 60 t "above" — a liability that does not exist.
 *
 * A year with no published threshold row returns ruleFound: false rather than a
 * fabricated default. The Commission has published 2026 only, as of this pack.
 *
 * `completeness` comes from the caller's attestation set — 'complete' only when
 * the user has explicitly ticked "these are all my {year} imports". The tool
 * never asserts completeness; it conditions on the user's statement.
 *
 * Lines with an unresolved year (yearOf → NaN, see yearOf's doc) contribute to
 * NO card. NaN can't be filtered from a Set by equality (SameValueZero collapses
 * every NaN into one member), and a pack.thresholds lookup keyed on NaN always
 * misses, so an unfiltered NaN year would render as a bogus "no rule published"
 * card and, worse, could mask a real card if the array order put it first. Those
 * lines simply don't resolve to a year yet; callers surface them separately
 * (e.g. "N lines need a date") rather than under a fake calendarYear.
 *
 * @throws {Error} if any in-scope line (classifiable, in-sector for its year's
 * rule) has no entry in `fingerprints`. This fires inside the per-year map, so
 * ONE bad line discards every year's card, not just its own year's — callers
 * must wrap the call (see cbam-app.ts's run()) and must hash every line before
 * calling. Deliberate: silently substituting '' for the missing hash would
 * print as an ordinary, complete entryHashes value instead of surfacing that
 * some line was never hashed.
 */
export function thresholdByYear(
  lines: readonly Line[],
  fingerprints: ReadonlyMap<string, string>,
  attestedYears: ReadonlySet<number>,
  pack: EstimatorPack,
): YearThreshold[] {
  const years = [...new Set(lines.map(yearOf))]
    .filter((year) => !Number.isNaN(year))
    .sort((a, b) => a - b); // default sort() is lexicographic: [2027, 10] would beat [10, 2027]

  return years.map((calendarYear) => {
    const attested = attestedYears.has(calendarYear);
    const rule = pack.thresholds.find((t) => t.calendarYear === calendarYear);
    const inYear = lines.filter((l) => yearOf(l) === calendarYear);
    if (!rule) return { calendarYear, ruleFound: false, attested, eligibleLineCount: 0 };

    const entries: ImportMassEntry[] = inYear.flatMap((l) => {
      const sector = sectorForCn(l.cn);
      if (!sector || !rule.includedSectors.includes(sector)) return [];
      const sourceSha256 = fingerprints.get(l.id);
      if (!sourceSha256) {
        // A missing fingerprint means some caller built cards before hashing
        // every line. Folding in '' would print on the export as an ordinary,
        // complete entryHashes value — the exact silent-degradation shape
        // packSnapshotHash refuses above. Loud failure beats a quiet false claim.
        throw new Error(
          `thresholdByYear: line '${l.id}' has no fingerprint — every line must `
          + 'be hashed (lineFingerprint) before it can be aggregated',
        );
      }
      return [{
        id: l.id, importerOrgId: IMPORTER, calendarYear, sector,
        netMassT: l.massT, sourceSha256,
      }];
    });

    const basis = aggregateThresholdBasis(
      { importerOrgId: IMPORTER, calendarYear },
      entries,
      {
        id: `session-${calendarYear}`, importerOrgId: IMPORTER, calendarYear,
        completeness: attested ? 'complete' : 'partial',
      },
    );
    const verdict = evaluateThreshold({
      knownEligibleMassT: basis.knownEligibleMassT,
      completeness: basis.completeness,
      thresholdT: rule.thresholdT,
    });
    return {
      calendarYear, ruleFound: true, attested,
      state: verdict.state,
      knownEligibleMassT: verdict.knownEligibleMassT,
      thresholdT: verdict.thresholdT,
      sourceLocator: rule.sourceLocator,
      entryIds: basis.entryIds,
      entryHashes: basis.entryHashes,
      eligibleLineCount: basis.entryIds.length,
    };
  });
}

export interface Totals {
  /**
   * '0' both for "every line summed to a real zero" and for "there were no
   * priced lines at all" (sumTotals([]) also returns '0' here). Callers must
   * gate on pricedLines/refusedLines before rendering this as a confirmed
   * zero-emission total — the string alone cannot distinguish the two.
   */
  certificates: string;
  /** null when any priced line lacks a published price — a partial € total lies. */
  costEur: string | null;
  chargeableTco2e: string;
  pricedLines: number;
  refusedLines: number;
  /**
   * True when any contributing line is a CSCF what-if; the total then is too.
   * This also fires when a `zero_by_fiat` line (final in its own right) is
   * mixed with a `cscf_pending` line: the zero_by_fiat component is exact, but
   * it is added into a sum that ALSO carries a scenario figure, so the sum as
   * a whole cannot be presented as final. Labelling the whole total, not just
   * the pending lines within it, is the same instinct as the per-branch rule
   * in certificate-estimate.ts — a mostly-true total that reads as fully true
   * is the failure this project exists to avoid.
   */
  anyPending: boolean;
}

/** The figures of a priced branch, whichever branch carried them. */
function figuresOf(e: CertificateEstimate):
  { certificates: string; costEur: string | null; netTco2e: string } | null {
  switch (e.status) {
    case 'ok':
    case 'zero_by_fiat': return e.figure;
    case 'cscf_pending': return e.scenario;
    case 'unavailable': return null;
  }
}

/**
 * Sums per-line CertificateEstimates into one Decimal-precise total.
 *
 * ROUNDING CHOICE: this sums each line's already-rounded (2dp) costEur, not
 * price × the summed certificates. The two can disagree by a cent — e.g. two
 * 25231000/DZ/(A) lines at 100t and 200t round individually to 5385.60 and
 * 10771.20 (sum 16156.80), but 214.395 certificates × 75.36 recomputed from
 * scratch is 16156.8072, which rounds to 16156.81. Summing the parts is kept
 * DELIBERATELY: the total this function returns must always equal the sum of
 * the line figures a person can see and audit on screen. Do NOT "fix" this by
 * recomputing from the summed certificates — that would make the total
 * disagree with its own visible line items by a cent, which is a worse and
 * more confusing failure than the cent itself.
 *
 * A refused ('unavailable') line is counted (refusedLines) but contributes
 * nothing to the sums — it must never poison a total that other, real lines
 * produced. A missing price on any priced line nulls costEur for the whole
 * total (rather than silently summing only the priced-price lines), because a
 * partial € figure that LOOKS complete is the exact under-reporting this
 * codebase refuses everywhere else.
 */
export function sumTotals(results: readonly CertificateEstimate[]): Totals {
  let certificates = new Decimal(0);
  let costEur = new Decimal(0);
  let chargeableTco2e = new Decimal(0);
  let pricedLines = 0;
  let refusedLines = 0;
  let anyPending = false;
  let costKnown = true;

  for (const e of results) {
    const figures = figuresOf(e);
    if (!figures) { refusedLines += 1; continue; }
    pricedLines += 1;
    if (e.status === 'cscf_pending') anyPending = true;
    certificates = certificates.plus(figures.certificates);
    chargeableTco2e = chargeableTco2e.plus(figures.netTco2e);
    if (figures.costEur === null) costKnown = false;
    else costEur = costEur.plus(figures.costEur);
  }

  return {
    // toFixed(), not toString(): certificate-estimate.ts's figureFrom already
    // makes this call (see its comment at the certificates field) because
    // Decimal#toString can emit exponential notation ('1e-7') for a small
    // enough residual — verified: 0.00000005 + 0.00000005 .toString() is
    // '1e-7'. Unlikely at real CBAM masses, but this total feeds the
    // printable audit document (Task 6), and toString() would contradict the
    // exact rule its own line-level figures follow just above it.
    certificates: certificates.toFixed(),
    // Explicit ROUND_HALF_UP (matching figureFrom's own per-line rounding in
    // certificate-estimate.ts), not the ambient decimal.js config — the sum
    // here is exact to 2dp by construction (see the rounding-choice note
    // above), but pinning the mode keeps this correct even if that ever
    // changes, without depending on sefa.ts having run first to set it.
    costEur: pricedLines > 0 && costKnown ? costEur.toFixed(2, Decimal.ROUND_HALF_UP) : null,
    chargeableTco2e: chargeableTco2e.toFixed(),
    pricedLines,
    refusedLines,
    anyPending,
  };
}
