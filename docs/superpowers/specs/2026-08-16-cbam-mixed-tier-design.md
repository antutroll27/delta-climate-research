# The mixed tier — design

**Date:** 2026-08-16
**Status:** approved, ready for planning
**Scope:** a verified line that attests only its direct figure. The last open Tier 1 defect.

## The defect

`estimate-from-pack.ts` prices the indirect half of a half-verified line at **zero**:

```ts
let indirectTco2e = '0'
if (input.emissionsScope === 'direct_and_indirect' && input.verified.indirectTco2ePerT !== undefined) {
  …
}
```

An importer who attests their direct emissions and leaves the electricity component alone gets a figure with no electricity in it at all — silently, with the line still labelled fully verified.

Worse, the two ways of "not supplying it" disagree. `indirectTco2ePerT: ''` reaches `nonNegativeDecimal('')`, returns null, and **refuses**. Omitting the key entirely **prices zero**. The lax path is the one a caller reaches by doing nothing.

## What it should do

Take the **Commission's published indirect default, with its mark-up**, and mark the line a mixed tier.

The mark-up is right. It prices *not having data*, and this importer does not have indirect data. The defaults path already applies it to the indirect half (`baseIntensity × (1 + markupPct/100)`), so a mixed line's electricity component is priced exactly as any default line's is. The verified direct half carries no mark-up, exactly as a fully-verified line's does.

**Absence falls back; bad input still refuses.** Omitted and empty-string both mean "I did not supply this" and both fall back to the default. A present-but-unreadable or negative value still refuses with `BAD_VERIFIED_REASON` — that path does not move.

### Two cases that are NOT mixed

- **`emissionsScope: 'direct'`.** Indirect is never read, so nothing falls back and the tier stays `actual-verified`. The engine's existing comment already states the principle: the indirect figure "is only READ when the scope charges for it, so it is only judged then".
- **A good with no published indirect default.** `selectIndirectFactorFromPack` returning `none` means the Commission publishes nothing for it — true of iron & steel and aluminium. Zero is then the *correct published answer*, not a fallback, so the tier stays `actual-verified`. A `route-mismatch` still refuses, as on the defaults path.

The distinction matters: mixed means *a default stood in for something the importer could have attested*. It does not mean *the electricity component is zero*.

## The tier mechanism

`DataTier` is `'actual-verified' | 'default+markup'` in `lib/cbam/certificate-estimate.ts` — **vendored**, so the new value is an upstream change plus a re-vendor.

New value: **`'verified-direct+default-indirect'`**. Long, deliberately. It follows the compound idiom `default+markup` already uses, and it lands verbatim in the CSV's `data_tier` column where an auditor reads it. `'mixed'` would be shorter and would tell that reader nothing about which half was which.

Display label: **"Verified direct + Commission indirect"**.

### `Line.tier` becomes derived, not chosen

This is forced by a guard that must not be weakened. `cbam-lines.ts`'s `csvRows` throws when `estimate.stamp.tier !== line.tier`, and its comment explains why:

> A verified line paired with a default-computed estimate exports the importer's attested inputs and their VERIFIER'S REFERENCE beside a figure that still carries the punitive mark-up — a mark-up that prices not having data, attached to a row that names the person who certified the data. That is over-collection with an attestation stapled to it.

A mixed line **is** that pairing, half of it. So the guard must keep its equality, and `Line.tier` must move with the stamp.

The dropdown keeps its two options. Nobody selects "mixed" — it is a *consequence* of what was filled in, so `draftLine()` derives it: verified tier selected, direct present, indirect absent, scope charges for indirect, and a published indirect default exists. Everything else stays as it is.

This keeps `line.tier` and `stamp.tier` equal by construction, and the guard keeps catching real mispairings untouched.

## The attestation prints, scoped to the direct half

The importer did certify something, and that certified figure is doing real work — it is priced without mark-up. Suppressing the attestation would discard true provenance. Printing it unchanged would be the exact hazard the guard exists to prevent.

So it renders, naming what it covers and what it does not:

> Your verifier's reference covers the **direct** figure on this line. The electricity component uses the Commission's published default and carries the mark-up; nobody has certified it.

`renderAttestation` currently returns `''` unless `tier === 'actual-verified'`. It gains the mixed arm.

## Surfaces

| surface | change |
|---|---|
| `CBM/lib/cbam/certificate-estimate.ts` | `DataTier` gains the value |
| `CBM/lib/estimator/estimate-from-pack.ts` | the fallback, and the stamp's tier |
| website vendored copies | by `cp` + `--update` only |
| `src/scripts/cbam-lines.ts` | `Line.tier` union; `data_tier` follows automatically |
| `src/scripts/cbam-algos/cbam-app.ts` | `tierLabel`, `renderAttestation`, `draftLine` |
| print export | tier label and attestation follow from the above |
| tests | `cbam-lines.test.mjs`, `cbam-render.test.mjs`, `cbam-lines.spec.ts` |

`tests/fixtures/cbam-golden.json` is generated with `precursors: []` and no `verified` input, so it should not move. **Verify that rather than assuming it** — if it moves, that is a finding.

## Testing

- The figure: a mixed line's indirect component must equal the same good's default indirect component exactly, mark-up included. Pin it against a real pack value.
- Absence vs bad input: omitted and `''` both fall back; `'abc'` and `'-1'` still refuse with `BAD_VERIFIED_REASON`.
- The two non-mixed cases above, each pinned — a `direct`-scope line and a good with no published indirect stay `actual-verified`.
- `line.tier === stamp.tier` for a mixed line, so `csvRows` does not throw. **This is the test that proves the mechanism**, and it must be written to fail if `draftLine` stops deriving.
- Attestation text pinned by a hand-typed constant, per this codebase's anti-paraphrase convention, and asserted absent on a default line.
- Mutation: make `draftLine` keep `actual-verified` on a mixed line — `csvRows` must throw. That is the guard doing its job and the reason it was not weakened.

## Out of scope

Everything else on the ledger: the two threshold cards disagreeing on a sector name; the parity fixture's duplicate rows; `cbam-factor/` and `cscf/` still getting the benchmark reason; the omission surfaces; 2027/28 price coverage; and the deferred regulatory work.

**No existing figure may change.** A fully-verified line, a defaults line and a `direct`-scope line must all price exactly as they do today. Only a line that was silently pricing indirect at zero moves — upward, since it gains a component it should always have had.
