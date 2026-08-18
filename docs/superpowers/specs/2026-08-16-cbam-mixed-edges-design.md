# The mixed tier's rough edges — design

**Date:** 2026-08-16
**Status:** approved, ready for planning
**Scope:** three defects the mixed-tier work created or exposed. Labels and wording only.

## Why these three together

They share a cause and a surface. The mixed tier introduced a third `DataTier` value; the code that consumes it was updated by a **manual sweep**, and that sweep was wrong three times running — two sites, then six, then seven, the last miss being `run()`'s live preview, which `cbam-app.ts` itself calls "the surface with the largest audience".

One of these fixes removes the reason the sweep was needed. The other two are claims the card makes that the figures do not support.

**No figure may change.** Unlike the previous batch, that constraint is honest here: every change is a predicate, a flag or a sentence.

## 1. Five hand-spelled predicates become one

`tier === 'actual-verified' || tier === 'verified-direct+default-indirect'` — "does this line carry an attested figure" — is written out at **four** sites in `src/scripts/cbam-algos/cbam-app.ts`:

| site | line | what it gates |
|---|---|---|
| `renderLineCard` | ~790 | the delta block |
| `tierCell` | ~913 | the verifier reference in the audit document |
| `anyVerified` | ~965 | the §4 caveat |
| `verifiedInputOf` | ~1286 | whether the engine is handed a `verified` object at all |

**Fix:** one `isAttested(tier)`, replacing all four **together**. A predicate adopted at three of four is worse than none — two spellings, neither authoritative.

**`renderAttestation`'s `switch` stays as it is.** It is exhaustive with a `never` default, which is strictly stronger than a boolean, and it is the site that already caught a fourth-tier bug by construction. Converting it to `isAttested` would trade a compile-time guarantee for a runtime one.

Two sites are deliberately excluded and must stay excluded: `parseVerifiedFields` reads the `<select>`'s value (a `string`, never a `Line`) and must never emit the third tier, and `syncVerifiedRows` likewise reads the DOM control.

## 2. A refused line asserts electricity it does not show

Measured at **5,542** selectors: a verified line whose refusal is raised *inside* `estimateCertificates`' catch carries the mixed tier, because the tier is set before that call. The predictive rule is **where the refusal is raised**, not which namespace it names — the four raised in `estimateFromPack`'s own branch (`mass/`, both `verified/…`, `indirect/`) stamp `actual-verified`; the rest inherit whatever they were handed.

Consequence: a card showing **no figure at all** is labelled "Verified direct + Commission indirect" and carries `MIXED_NOTE`, which states that the electricity component is a Commission default carrying the mark-up. There is no electricity component on that card. Reachable at an ordinary 2026 date — KR clinker, where the Commission publishes a route-independent electricity default but the Annex publishes Column B benchmarks for routes (A)/(B) only.

**The distinction that resolves it:**

- `ATTESTED_NOTE` is about the **input** — "these figures are your own attested claim". True whether or not the line priced. This is why the refused *fully-verified* card correctly keeps its note, and an existing test pins that as wanted.
- `MIXED_NOTE` is about the **output** — it asserts a substitution that only happened if a figure was produced.

**Fix:** `renderAttestation` gains one input — whether the line produced a figure — and picks among three notes by `(tier, priced)`. A refused mixed line prints the attested-only claim about its direct figure and drops the electricity clause.

**Not silence.** An attested figure with no attestation beside it is the state `renderAttestation`'s own docblock exists to prevent; the user did supply a figure, and saying so stays true.

The tier label itself is left alone. "Verified direct + Commission indirect" describes what the engine attempted, and the attestation is where the claim about *what was produced* belongs.

## 3. A mixed line loses the residual-basis note

`originBasis` is `null` on the verified path and `'residual' | 'country'` on the defaults path; `RESIDUAL_BASIS_NOTE` fires on `originBasis === 'residual'` (`certificate-estimate.ts:205`).

A mixed line's **indirect** half can resolve to the Commission's "Other Countries" residual bucket — measured reachable on FR clinker route (A) — and the importer is told nothing. They receive a world-average electricity figure presented like any other default.

**`originBasis` cannot carry this.** It names the basis of *a* figure, and a mixed line has two with different bases: a verified direct half resting on no default at all, and a default indirect half that may be residual. Setting `'residual'` would claim the whole line rests on a world average, which is false of an audited direct figure — and would fire `RESIDUAL_BASIS_NOTE`, whose wording says exactly that.

**Fix:** the engine records, separately from `originBasis`, that the indirect fallback resolved to the residual bucket, and a **new note** states it — scoped to the electricity substitution, not the line.

This is a vendored change (`estimate-from-pack.ts`, and the note constant beside its siblings in `certificate-estimate.ts`), so it lands upstream and is re-vendored.

## Testing

- `isAttested` mutation-verified at each of the four sites: break the predicate, confirm a *named* test fails at that site. A shared predicate whose failure is only visible at one site is a shared bug.
- The refused-mixed card pinned by a hand-typed constant, per this codebase's anti-paraphrase convention, and the refused *fully-verified* card's existing note pinned unchanged — that behaviour is wanted and must not regress.
- The residual-indirect note pinned on a selector measured to resolve to the residual bucket, and asserted **absent** on a mixed line whose indirect default is the origin's own.
- **No figure moves.** Sweep before and after; every figure byte-identical. If one moves, the change is wrong.

## Out of scope

The rest of the ledger: the two threshold cards disagreeing on a sector name; the parity fixture's duplicate rows; `cbam-factor/` and `cscf/` still getting the benchmark reason; the omission surfaces and `differential.test.ts`'s missing indirect arm; 2027/28 price coverage; and the deferred regulatory work.
