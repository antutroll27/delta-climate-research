// src/scripts/cbam-ui/format.ts
// One spelling of every number, price, tier and provenance label the calculator prints. Moved out of
// cbam-app.ts in phase 2 of the rail redesign (spec §7) so the tile renderers in cbam-ui/ print a
// fact in the same words as the line card and the printable document. cbam-app.ts imports these
// back; cbam-ui modules import them directly (importing cbam-app.ts would be a cycle).
import type { CertificateEstimate, DataTier } from '../cbam-algos/cbam/certificate-estimate.ts';

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * tCO2e and certificate counts carry long decimal tails; 3 dp is plenty to read.
 *
 * Blank input is special-cased AHEAD of `Number()`: `Number('')` is `0`, and — the gap the first
 * fix here missed — so is `Number('   ')`. Both are a genuine JS quirk (`Number()` trims the
 * string before parsing, same as `parseFloat`), not a missing-value signal, so blank input used
 * to sail through `Number.isFinite` and render as a confirmed "0", indistinguishable from a real
 * zero the engine computed. `s.trim() === ''` catches both; it does NOT catch a real number with
 * incidental whitespace around it (`' 100 '` still parses to 100 and renders normally — only
 * whitespace with no digits in it counts as blank). Every caller before Task 5 fed this engine
 * output (always a real numeric string); `Line.massT` is free-typed by the user with no format
 * guarantee and can be left blank or cleared to spaces, and that must read as missing input, not
 * as a claimed zero — the same rule `Totals.certificates`'s own doc already states for "nothing
 * was summed." Other non-numeric input (never reachable from the engine, only from a user's
 * stray keystrokes in `Line`) still falls through to the `esc(s)` branch below, unchanged:
 * showing exactly what was typed beats hiding it behind a fabricated number.
 */
export const num = (s: string, dp = 3) => {
  if (s.trim() === '') return '—';
  const n = Number(s);
  // esc() on the fallback: every other path into innerHTML in this file is escaped,
  // and this is the only one that returns its argument verbatim.
  return Number.isFinite(n) ? n.toLocaleString('en-GB', { maximumFractionDigits: dp }) : esc(s);
};

/**
 * ALWAYS returns a printable string, never `null` — every call site embeds the return directly
 * in a template (`${eur(x)}`), and `null` interpolated into a template literal prints the
 * literal three characters "null" onto the page, which is a worse failure than what this
 * function exists to prevent. Every call site today decides whether to call `eur` at all by
 * checking the ORIGINAL input first (`t.costEur ? eur(t.costEur) : fallback`) — this function's
 * job is only to make whatever value reaches it safe to print. Blank input — `''`, and (the gap
 * the first fix here missed) whitespace-only strings like `'   '`, which are TRUTHY in JS and so
 * pass every call site's `t.costEur ? eur(t.costEur) : fallback` guard exactly like a real value
 * would — and other non-finite input (never reachable from the engine, which only ever produces
 * `null` or a real Decimal string; only a future caller that skips that guard could reach this)
 * render as the same '—' placeholder `num` uses, not as `Number('garbage')` → `NaN` → the
 * literal string `'€NaN'`, or `Number('   ')` → `0` → an invented `'€0.00'`, either printed as
 * though it were money.
 */
export const eur = (s: string | null): string => {
  if (s === null || s.trim() === '') return '—';
  const n = Number(s);
  return Number.isFinite(n)
    ? `€${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
};

/**
 * Does this refusal blame the user's input, or the Commission's corpus?
 *
 * Every refusal carries a `selector` locating the problem, and its first segment is the
 * namespace: `default/`, `indirect/`, `benchmark/` and `certificate-price/` name a rule nobody
 * has published, while `mass/` and `verified/` name a value the user typed. Only the second kind
 * is fixable by the person reading the card, and telling someone a rule is "missing" when they
 * have in fact mistyped a tonnage sends them to look for a gap in the regulation.
 *
 * Matched on the namespace rather than the whole string so a selector gaining or losing a
 * trailing segment cannot silently flip the caption — that shape has already changed twice.
 */
export const inputRefusal = (selector: string): boolean => /^(mass|verified)\//.test(selector);

/**
 * Which corpus priced a line, in words — ONE wording, used by the on-screen provenance stamp and
 * by the printable document's §1 column alike. A second literal in the document would let the
 * paper artefact and the card a user saw name the same tier differently ("Verified" vs "Verified
 * actual"), which is the kind of drift an auditor reads as two different claims.
 *
 * Takes the tier rather than a stamp or a Line: the stamp says which tier actually PRICED the
 * figure, the Line says which tier was CLAIMED, and the two callers legitimately want different
 * ones (see buildPrintDocument's row for why the document reads the line). `Line['tier']` is
 * declared as the same two literals for the reason cbam-lines.ts gives, so both callers pass.
 *
 * SWITCHED ON EVERY MEMBER, WITH `never` IN THE DEFAULT ARM — this file's own exhaustiveness idiom
 * (renderResult, tableFigures). It was written as a `string` parameter with a ternary, which was a
 * silent widening of the engine's `DataTier` union: a third tier added upstream would have compiled
 * here and confidently printed "Commission default + mark-up" for it, on BOTH the on-screen
 * provenance stamp and the audit document, with nothing type-checking against it. Naming a tier
 * wrongly on a document handed to an auditor is exactly the class of failure the `never` assertions
 * elsewhere in this file exist to make a build error instead.
 */
export function tierLabel(tier: DataTier): string {
  switch (tier) {
    case 'actual-verified': return 'Verified actual';
    case 'default+markup': return 'Commission default + mark-up';
    // NAMES BOTH HALVES, because both are true of the figure and neither alone is. "Verified"
    // on its own would read as the mark-up having been dropped from the whole line, when it was
    // only dropped from the direct half; "Commission default" on its own would bury the one
    // number the importer had audited and paid a verifier for. This label is what an auditor
    // reads in §1 of the printable document beside the row's figures, so it has to say which
    // corpus priced which half in the space of a table cell.
    case 'verified-direct+default-indirect': return 'Verified direct + Commission indirect';
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}

/**
 * The certificate-price row of the breakdown.
 *
 * "imports in <quarter>", NEVER "<quarter> price", AND NEVER "(pending)". The quarter is the
 * engine's lookup key: the import date's quarter. Only 2026 has a price per quarter. From 2027
 * the Commission sets the price weekly and it applies to the certificates sold that week
 * (IR (EU) 2025/2548 Arts 5 and 8), so "Certificate price 2027-Q1 · not published (pending)"
 * described a figure that will never be published, and "(pending)" promised it. This row used to
 * read exactly that, and nobody saw it because every 2027 date refused before reaching here.
 *
 * ONE WORDING FOR EVERY PENDING ROW, with no year test: "none published" is true of 2026-Q3 and
 * of 2027-Q1 alike, and stays true the day the corpus changes. What differs between the two
 * regimes is said by the pack, in the price row's own sourceLocator, not decided here.
 */
export function renderPriceRow(e: { priceQuarter: string; priceEur: string | null }): string {
  return `<div class="cb-row"><span>Certificate price · imports in ${esc(e.priceQuarter)}</span><b>${
    e.priceEur ? eur(e.priceEur) : 'none published'}</b></div>`;
}

/**
 * THE WHAT-IF TAG, one spelling wherever a count or cost rests on a CSCF the Commission has not
 * published. The engine then returns a labelled scenario, never a final figure (tiles-estimate's
 * status tag, a Three years plate, a Why tile all wear this). `cscfYear` is named where the engine
 * says which year's factor is missing; the outlook does not carry it, so the plates and tiles leave
 * it out. `hook` is the e2e class, `cb-tag`, on the Estimate hero alone.
 */
export function whatIfTag(cscfYear: number | null = null, hook = ''): string {
  const text = `What-if · CSCF${cscfYear === null ? '' : ` for ${cscfYear}`} unpublished`;
  return `<span class="b-tag${hook ? ` ${hook}` : ''} pending">${esc(text)}</span>`;
}

/** The stamp's "Origin basis" row: which default sheet answered, in words. */
export function originBasisLabel(basis: CertificateEstimate['stamp']['originBasis']): string {
  return basis === 'residual' ? 'Residual bucket' : basis === 'country' ? "Origin's own published value" : '—';
}

/**
 * The stamp's "Snapshot" row. A real snapshot is a 64-char sha256 and is shortened; anything of 24
 * characters or fewer (the pre-pack 'not yet computed', the vendored 'unsealed-pack') is shown
 * whole, because slicing it would read as a garbled hash (see decorateSnapshot in cbam-app.ts).
 */
export function snapshotLabel(hash: string): string {
  return hash.length > 24 ? `${hash.slice(0, 16)}…` : hash;
}
