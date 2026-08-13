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
import type { CertificateEstimate, EstimateFigure } from './cbam-algos/cbam/certificate-estimate.ts';

export interface Line {
  id: string;        // row key and ImportMassEntry.id — NOT part of the fingerprint
  cn: string;
  country: string;
  route: string;
  scope: 'direct' | 'direct_and_indirect';
  massT: string;
  date: string;      // ISO date; calendar year is date.slice(0, 4)
  /**
   * The engine's DataTier strings VERBATIM (cbam-algos/cbam/certificate-estimate.ts), not a
   * friendlier local enum mapped at the boundary: the same two strings then reach the
   * ProvenanceStamp the engine returns and the CSV column the export writes, so the stamp and
   * the line can never disagree about which tier was used. A local 'verified' | 'default' would
   * need a translation table, and a translation table is a place for the two to drift.
   *
   * REQUIRED, not optional-with-a-default. A line that omits it would have to mean one tier or
   * the other, and the wrong guess is the punitive mark-up either applied to an importer who
   * had audited data, or dropped from one who did not — a wrong tax liability in both
   * directions. The compiler asking every construction site to say which is the point.
   */
  tier: 'default+markup' | 'actual-verified';
  /** attested tCO2e per tonne; present iff tier is 'actual-verified' */
  seeDirect?: string;
  seeIndirect?: string;
  /** optional verifier/report reference — transcribed, never checked */
  verifiedRef?: string;
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
 *
 * THE TIER AND THE ATTESTED FIGURES ARE PART OF THE INPUTS. A verified line's per-tonne
 * figures are the importer's own claim — the one number on the row that no published corpus
 * backs — so they must be pinned exactly as entered, alongside the reference the importer
 * cites for them. Two submissions that differ only in an attested figure, or only in the
 * verifier reference attached to it, are different claims and must digest differently.
 *
 * NEW FIELDS ARE APPENDED AT THE END, and every future one must be too. Positions 0-5 keep the
 * meaning they had before this feature, so a fingerprint printed on a pre-feature export can
 * still be reproduced from a post-feature line by hashing the first six elements — a property
 * a mid-array insertion would destroy for no gain. The array is also FIXED-LENGTH across both
 * tiers (an absent optional fills an element rather than omitting it), so a default line and a
 * verified line hash the same 10-element shape and "field absent" can never be confused with
 * "array truncated".
 *
 * THE FILLER IS `?? null`, NOT `?? ''` — ABSENT AND EMPTY ARE DIFFERENT CLAIMS. Not a style
 * preference: the engine takes opposite branches on the two. estimate-from-pack.ts's verified
 * path tests `input.verified.indirectTco2ePerT !== undefined` BEFORE it calls verifiedPerT, so
 * an ABSENT seeIndirect skips the branch entirely and the line prices normally (indirectTco2e
 * '0'), while `seeIndirect: ''` reaches verifiedPerT, fails its shape gate, and refuses the
 * WHOLE line as unavailable. Measured on 25231000/DZ/(A)/100 t at direct_and_indirect: absent
 * priced 166.065 certificates / EUR 12,514.66, empty refused outright. A priced bill and a
 * refusal are not the same submission, and an audit trail that hands both the same digest
 * cannot tell an importer which one produced the figure on their export. JSON.stringify renders
 * an absent field as bare `null` and an empty one as `""`, so the two serialise apart; a string
 * field can never itself produce bare `null`, so the split adds no new collision.
 */
export function lineFingerprint(line: Line): Promise<string> {
  return sha256Hex(JSON.stringify([
    line.cn, line.country, line.route, line.scope, line.massT, line.date,
    line.tier, line.seeDirect ?? null, line.seeIndirect ?? null, line.verifiedRef ?? null,
  ]));
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

/**
 * A REAL discriminated union on `ruleFound`, not a flat interface with fields marked
 * "optional, only when ruleFound" in a comment. The earlier flat shape let
 * `{ calendarYear, ruleFound: true, attested, eligibleLineCount }` — every field of the
 * "found" branch omitted — type-check clean under this project's strict config, because
 * `ruleFound: boolean` never actually correlated with which optional fields were present.
 * A caller that built one by hand (nothing stopped a future one from doing so, once Task 6
 * adds more call sites than `thresholdByYear`) would compile, then crash at
 * `y.state.replace(...)` in cbam-app.ts. Making `ruleFound` a literal `true`/`false`
 * discriminant means the compiler enforces the shape at EVERY construction site and every
 * read, not just the one inside `thresholdByYear` below.
 */
export type YearThreshold =
  | {
      calendarYear: number;
      ruleFound: true;
      state: ThresholdState;
      knownEligibleMassT: string;
      thresholdT: string;
      sourceLocator: string;
      entryIds: string[];
      entryHashes: string[];
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
  | {
      calendarYear: number;
      ruleFound: false;
      attested: boolean;
      eligibleLineCount: number;
    };

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

/**
 * The figures of a priced branch, whichever branch carried them — the full EstimateFigure,
 * not a hand-picked subset. sumTotals below only ever reads certificates/costEur/netTco2e off
 * the result, but csvRows needs indirectTco2e/totalEmbeddedTco2e/faaTco2e too; narrowing the
 * return type to what sumTotals happens to use would force csvRows to re-derive this same
 * ok/zero_by_fiat/cscf_pending/unavailable split itself — a second switch that TypeScript
 * cannot exhaustiveness-check against CertificateEstimate's union the way this one is (a fifth
 * status would fail to compile HERE; a duplicated ternary elsewhere would just silently return
 * null for it). One split, reused everywhere a priced figure is needed.
 */
function figuresOf(e: CertificateEstimate): EstimateFigure | null {
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

/**
 * One row per line, engine values VERBATIM — no locale formatting, no rounding. This is the
 * working artefact an auditor loads into a model; presentation formatting (thousands
 * separators, 3dp) belongs to the page, full precision belongs here.
 *
 * @throws {Error} if `lines` and `results` are not the same length (see below), or if any
 * line's estimate resolves more than one benchmark term (see the in-loop check). EITHER throw
 * discards the WHOLE export, not just the offending row — there is no partial-CSV mode, unlike
 * thresholdByYear's equivalent per-year throw (which similarly discards every year's card, not
 * just one). A caller wanting a partial export on a bad line must catch here and decide what
 * "partial" means for a file with one row per line; this function does not offer that choice.
 */
export function csvRows(
  lines: readonly Line[],
  results: readonly CertificateEstimate[],
  fingerprints: ReadonlyMap<string, string>,
  packSnapshot: string,
  pack: EstimatorPack,
): Record<string, string>[] {
  if (lines.length !== results.length) {
    // Without this, a mismatch surfaces as `results[i]!`'s bare `undefined` flowing into every
    // field read below — a TypeError with no line id, no expected/actual counts, nothing an
    // author of a new caller (Tasks 5-8) could use to find their bug. Name the mismatch instead,
    // matching this file's own idiom (packSnapshotHash's missing-workbook-hash throw,
    // thresholdByYear's missing-fingerprint throw): a loud, specific failure over a bare crash.
    throw new Error(
      `csvRows: ${lines.length} line(s) but ${results.length} result(s) — every line must have `
      + 'exactly one CertificateEstimate, in the same order, before it can be exported',
    );
  }
  return lines.map((l, i) => {
    const e = results[i]!;
    const terms = 'terms' in e ? e.terms : null;
    // terms.benchmarks carries one entry per precursor (Column A / Eq 4 — see sefa.ts). The
    // public estimator only ever runs scope='full_product' with no precursors (hardcoded in
    // estimate-from-pack.ts's baseInput), so today this is always length 0 (electricity's
    // zero_by_fiat short-circuit) or 1. The benchmark_* columns below are ONE value per row —
    // multiplexing several benchmarks into a single delimited cell (the way rule_packages does
    // for an informational list) would silently degrade a figure an auditor might sum or plug
    // straight into a model. Fail loud instead, matching this file's own idiom elsewhere
    // (packSnapshotHash's missing-workbook-hash throw, thresholdByYear's missing-fingerprint
    // throw): if this exporter is ever reached from the precursor path, dropping a precursor's
    // locator from an audit CSV would be exactly the silent degradation those refuse.
    if (terms && terms.benchmarks.length > 1) {
      throw new Error(
        `csvRows: line '${l.id}' resolved ${terms.benchmarks.length} benchmark terms, but `
        + 'this exporter has one benchmark_* column per row and would silently drop the rest',
      );
    }
    const bm = terms?.benchmarks[0] ?? null;
    const pending = e.status === 'cscf_pending';
    // Reuses figuresOf as-is (see its own comment on why its return type now carries the full
    // EstimateFigure): csvRows needs indirectTco2e/totalEmbeddedTco2e/faaTco2e, which a
    // narrower return type would have hidden and forced this function to re-derive the same
    // ok/zero_by_fiat/cscf_pending/unavailable split by hand.
    const figure = figuresOf(e);
    return {
      line_id: l.id,
      cn_code: l.cn,
      description: pack.classifications.find((c) => c.code === l.cn)?.description ?? '',
      origin: l.country,
      route: l.route,
      emissions_scope: l.scope,
      mass_t: l.massT,
      import_date: l.date,
      // Direct-only — EstimateBase.emissionsTco2e, fed straight from
      // CertificateEstimateInput.emissionsTco2e. Structurally present on EVERY branch,
      // including 'unavailable' (EstimateBase sits outside the Priced intersection — see
      // certificate-estimate.ts), and estimateFromPack's `!factor` path ("no published default
      // at all") seeds it with a literal '0' placeholder that was never computed — exporting
      // that unguarded reads as a confirmed zero-emission line, the exact false claim
      // Totals.certificates's own doc comment above already refuses. Gate on `figure` (i.e.
      // status !== 'unavailable') rather than an `'emissionsTco2e' in e` check, which is always
      // true and therefore no guard at all.
      direct_tco2e: figure ? e.emissionsTco2e : '',
      // Free allocation (SEFA) is a DIRECT-emission benchmark (sefa.ts's own doc), so it is
      // deducted from the direct side only; indirect is added back in AFTER that deduction and
      // its floor (figureFrom, certificate-estimate.ts). One merged embedded_tco2e cannot show
      // why the deduction did not reach part of the figure — hence the split column.
      indirect_tco2e: figure?.indirectTco2e ?? '',
      // The good's TOTAL embedded emissions (direct + indirect) — what this column name has
      // always claimed, not the direct-only figure EstimateBase happens to carry. Read
      // figureFrom's own totalEmbeddedTco2e rather than re-summing direct_tco2e +
      // indirect_tco2e here: the engine already added those two once, and a second addition
      // over the same two numbers in THIS file is a second chance to disagree with it.
      embedded_tco2e: figure?.totalEmbeddedTco2e ?? '',
      // Lives on `figure` (EstimateFigure) — see the `figure` comment above. The prior fix here
      // (switching off `pending ? … : ''`) got the BRANCH right but the spec's own identity was
      // still wrong: chargeable is NOT embedded − free_allocation in general — see
      // chargeable_tco2e below.
      free_allocation_tco2e: figure?.faaTco2e ?? '',
      // max(0, direct − free_allocation) + indirect, computed ONCE by figureFrom and read
      // verbatim here, never recomputed: (1) free allocation is deducted from direct only, so
      // indirect must be added back AFTER the subtraction, not before; (2) the deduction is
      // floored at zero (the regulation surrenders certificates, never issues them), so a clean
      // producer whose benchmark exceeds its own direct emissions has chargeable = indirect
      // alone, not a negative number. `chargeable = embedded − free_allocation` (the identity
      // this file originally shipped with) fails on both counts and was wrong in the spec, not
      // just in this implementation — see the design doc's 8 August 2026 correction.
      chargeable_tco2e: figure?.netTco2e ?? '',
      certificates: figure?.certificates ?? '',
      cost_eur: figure?.costEur ?? '',
      cbam_factor: terms?.cbamFactor ?? '',
      cbam_factor_locator: terms?.cbamFactorLocator ?? '',
      cscf_status: e.status === 'ok' ? 'published'
        : e.status === 'zero_by_fiat' ? 'not applicable (Art 1(2): nil by law)'
        : pending ? 'pending (what-if)' : '',
      cscf_locator: terms?.cscfLocator ?? '',
      assumed_cscf: pending ? e.scenario.assumedCscf : '',
      price_quarter: 'priceQuarter' in e ? e.priceQuarter : '',
      price_eur: ('priceEur' in e ? e.priceEur : null) ?? '',
      price_status: 'priceStatus' in e ? e.priceStatus : '',
      benchmark_column: bm?.benchmarkColumn ?? '',
      benchmark_value: bm?.benchmarkTco2ePerT ?? '',
      benchmark_route: bm?.routeIndicator ?? '',
      benchmark_locator: bm?.sourceLocator ?? '',
      status: e.status,
      rule_packages: e.stamp.rulePackages.join(' | '),
      line_fingerprint: fingerprints.get(l.id) ?? '',
      pack_snapshot: packSnapshot,
    };
  });
}

/**
 * RFC 4180 quoting, plus a CSV-injection guard: a cell opening with = + - @ is executed as a
 * formula by Excel/Sheets on open, and this artefact is explicitly built to be opened in a
 * spreadsheet. `cn_code` is free-typed by the user and `description` comes from the pack — both
 * would otherwise reach this function unescaped and a crafted CN like `=cmd|'/c calc'!A1` would
 * execute on open. A leading `'` (the standard OWASP mitigation) neutralises the cell as literal
 * text without changing what a human reads there.
 *
 * INVARIANT the injection guard depends on: every numeric column csvRows produces is
 * non-negative by construction (figureFrom never returns a negative certificate/cost/emissions
 * figure, and cbam-app.ts refuses a negative mass at the input), so the guard never has to tell
 * "a real minus sign" apart from "an injected formula" — it can treat every leading `-` as the
 * latter. If a future column can legitimately start with `-` (e.g. a signed adjustment),
 * loosening this guard to let `-` through unescaped REOPENS the injection hole this function
 * exists to close. Fix that by quoting a genuine negative differently (e.g. a leading space,
 * another OWASP-documented mitigation), not by narrowing this character class.
 *
 * `cn_code` is also the reason the quoting class below includes `\r`, not just `\n` and `,`: a
 * pasted CN can carry a stray carriage return, and a bare CR left unquoted inside a field is
 * itself malformed RFC 4180 — Python's `csv` module, among others, rejects it outright
 * ('new-line character seen in unquoted field'). Every OTHER column here is a computed figure,
 * a legal locator, or a short status string this file constructs itself and cannot carry a
 * newline — but `cell()` quotes by CONTENT, not by column, so `cn_code` and `description` (also
 * free-typed on the page, though not by this function's caller) are covered the same way as
 * every other cell without this function needing to know which columns are user input.
 *
 * Row separator stays '\n', not '\r\n': RFC 4180's CRLF requirement exists to disambiguate a
 * newline that ENDS a row from one embedded WITHIN a field, and the quoting above already
 * handles every embedded CR/LF by wrapping the field in quotes — there is nothing left for a
 * CRLF row separator to add. Excel, Sheets, Numbers and LibreOffice all parse a bare-LF CSV
 * correctly today.
 */
export function toCsv(rows: readonly Record<string, string>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]!);
  const colSet = new Set(cols);
  // A row with a different key set than row 0 would otherwise fail SILENTLY: extra keys are
  // dropped (never appear in any column), missing keys read as '' via `r[c] ?? ''` below — both
  // indistinguishable from a genuinely blank or absent field. toCsv is general-purpose and
  // exported, so it cannot assume every caller builds rows the way csvRows does; check once,
  // up front, rather than let a malformed row silently reshape itself to fit row 0's header.
  rows.forEach((r, i) => {
    const keys = Object.keys(r);
    if (keys.length !== cols.length || keys.some((k) => !colSet.has(k))) {
      throw new Error(
        `toCsv: row ${i} has a different set of keys than row 0 — every row must share exactly `
        + 'the same columns, since the header is taken from row 0 alone',
      );
    }
  });
  const cell = (v: string) => {
    const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
    return /["\r\n,]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c] ?? '')).join(','))].join('\n');
}
