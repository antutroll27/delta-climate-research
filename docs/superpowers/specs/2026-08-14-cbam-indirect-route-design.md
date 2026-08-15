# The indirect electricity default ignores the production route

2026-08-14 · found by the post-fix adversarial audit · **approved design, awaiting plan**

## The defect

`selectIndirectFactorFromPack` matches an indirect (electricity) default on good, origin and
reporting year, then takes `.find()` at the deepest scope. **The production route is not part of
the match.** Its comment says why:

> Indirect rows are published per good, not per production route, so the route is not part of the
> match; taking the deepest scope keeps it consistent with the direct lookup.

The shipped pack disagrees. Measured over `public/cbam/estimator-pack.json`:

| | |
| --- | --- |
| indirect rows keyed `default` (route-independent) | 7,713 |
| indirect rows keyed to a real route | **597** — `(A)` 495, `(B)` 102 |
| (good, origin, year) groups with route-keyed indirect rows | 510 |
| …of those, groups whose values **differ by route** | **90** |
| …groups where the indirect route set equals the direct route set | **510 of 510** |

So the comment is accurate for 93% of the corpus and wrong exactly where it costs money. With no
route in the filter, `.find()` returns whichever row sorts first — and the dearer row sorts first
in every affected case, so **all 30 affected (CN, origin, route) combinations per reporting year
over-charge**.

### Reproduced

`25231000` (cement clinker) / `DZ` / 100 t / 2026-03-15 / scope `direct_and_indirect`.
The pack publishes indirect `(A): 0.04` and `(B): 0.06`.

```
route (A)  → picked indirect route (B), base 0.06  → 78.065 certs · EUR 5,882.98
route (B)  → picked indirect route (B), base 0.06  → 64.7475 certs · EUR 4,879.37
```

Route (A) is priced with route (B)'s electricity. **Changing the route on the form does not change
the indirect component at all.** Correct behaviour for route (A):

```
faa        = 0.666 × 0.975 × 100                = 64.935
direct     = 1.24 × 1.10 × 100                  = 136.4
indirect   = 0.04 × 1.10 × 100                  =   4.4   (currently 6.6)
certs      = (136.4 − 64.935) + 4.4             =  75.865 (currently 78.065)
cost       = 75.865 × 75.36                     = EUR 5,717.19 (currently 5,882.98)
over-charge                                       EUR   165.79
```

The CSV compounds it: the row exports `benchmark_route,(A)` beside `indirect_tco2e,6.6` — an
audit artefact naming one route and pricing another. On `25239000/DO` the same defect is
EUR 911.86 per 100 t.

This also violates the module's own stated discipline, set out at the top of `resolve-fa.ts`:
*"a miss is REGULATION_NOT_FOUND, never a default; a tie is REGULATION_AMBIGUOUS, never a
first-match."* `.find()` on a multi-row candidate set is a first-match.

## Decision: match the route, and refuse on divergence

**1. Add the route to the match**, mirroring `selectFactorFromPack`, which already does exactly
this for direct factors:

```ts
.find(f => f.productionRoute === input.route)
```

Measured consequence against the shipped pack:

| | |
| --- | --- |
| selectors carrying an indirect factor today | 8,310 |
| still resolving after the change | **8,310 — zero lost** |
| values corrected | **90** (30 per reporting year × 3 years) |
| duplicate keys once fully keyed by (scope, origin, year, route) | **0**, in both the indirect and direct corpora |

Zero loss is not luck: where direct is route-keyed the indirect rows carry the same routes
(510/510), and where direct is route-independent both carry `default`. The route sets align
universally, which is why a strict match needs no fallback. **The lookup becomes deterministic,
not merely more accurate** — with the route included, no candidate set can hold more than one row,
so the first-match violation disappears rather than being narrowed.

**2. A route mismatch refuses the line.** The pack is about to be rebuilt against IR (EU)
2026/1740, which re-keys production routes. If a future corpus publishes indirect
route-independently while direct stays route-keyed, a strict match finds nothing — and returning
null would silently price indirect as zero. That is an under-charge with no signal, and it is the
same fail-open this audit already found twice elsewhere (blank verified indirect; the
out-of-sector threshold verdict). A third instance is not worth adding to a page whose governing
rule is fail-closed.

### The trap: two very different "no match" cases

The function currently returns `Factor | null`, and `null` today means *"the Commission publishes
no indirect default for this good"* — true and correct for iron & steel and aluminium, which must
keep pricing with `indirectTco2e = '0'`. Collapsing that with a route mismatch is precisely how
the present bug hides.

The return type therefore carries **three** outcomes:

```ts
type IndirectLookup =
  | { kind: 'found'; factor: EstimatorPack['defaultFactors'][number] }
  | { kind: 'none' }            // no indirect row covers this good — price with 0, as today
  | { kind: 'route-mismatch' }  // rows exist for this good/origin/year, none matches the route
```

`estimateFromPack` turns `route-mismatch` into
`unavailableEstimate(..., 'indirect/<cn>/<origin>/<route>/<year>')`, following the existing
`NO_DEFAULT_REASON` refusal in `estimateFromPack`'s no-direct-factor branch (cited by function,
not by line — a line range in this codebase rotted twice in a single day). `none` keeps today's
behaviour exactly.

### The second caller

`src/stores/estimator.ts:74` is `hasIndirect()`:

```ts
return pack.value ? selectIndirectFactorFromPack(pack.value, input) !== null : false
```

Its comment — *"Whether the Commission publishes an indirect default here — drives the scope
control"* — states the intent, and the intent is `kind !== 'none'`, **not** `kind === 'found'`.
Mapping it mechanically to `=== 'found'` would hide the emissions-scope control on exactly the
goods whose route diverged, so the user could never reach the refusal that is supposed to warn
them. This call site must be updated deliberately.

## Rejected alternatives

- **Strict match, then fall back to a route-independent row.** Mirrors `resolveBenchmark`'s
  documented two-step. Measured: the fallback never fires today (strict alone loses 0 of 8,310).
  Rejected because on divergence it would price a route-independent figure against a
  route-specific line — a guess, invisible, with no refusal or note.
- **Strict match, return null on mismatch.** Smallest diff, provably lossless today. Rejected:
  on divergence the whole electricity component silently vanishes.
- **Fix the comment, keep the behaviour.** Rejected outright — the behaviour is the defect.

## Testing

1. **The worked example** above, pinned end to end: route (A) resolves indirect route (A) at
   `0.04`, giving 75.865 certificates and EUR 5,717.19; route (B) resolves `0.06` and is unchanged
   at 64.7475 / EUR 4,879.37. Before the fix the two routes return the same indirect figure; after
   it, they differ.
2. **Zero loss, derived from the pack.** For every `(cn, origin, route, year)` the direct corpus
   offers, if an indirect factor resolves today, one must still resolve. Asserted over the whole
   pack rather than a sample, so an IR 2026/1740 rebuild that breaks the alignment fails here.
3. **`none` and `route-mismatch` are distinguished**, not merely both non-`found`: a steel line
   (no indirect published anywhere) yields `none` and still prices with indirect 0; a synthetic
   pack whose indirect rows are re-keyed away from the direct routes yields `route-mismatch` and
   refuses with the named selector.
4. **Determinism**: no `(scopeCode, origin, year, route)` key holds more than one row, asserted
   over both the indirect and direct corpora, so the surviving `.find()` cannot be a first-match.
5. **The Vue call site**: `hasIndirect` is true for `route-mismatch` as well as `found`, false only
   for `none`.

## Out of scope

The other live defects from the same audit, each tracked separately: the blank verified indirect
field pricing as zero; the out-of-sector "an importer owes nothing" verdict; the defeatable §4
paraphrase pin; the "Commission default values only" banner; and the missing fail-closed guard on
`massT`.

## Landing

Upstream in CBM (`lib/estimator/estimate-from-pack.ts` and `src/stores/estimator.ts`), then
re-vendor `estimator/estimate-from-pack.ts` byte-for-byte into `src/scripts/cbam-algos/` with
`node scripts/cbam-sync-check.mjs --update`. `src/stores/estimator.ts` is the SaaS's own Vue store
and is not vendored, so it does not come down.
