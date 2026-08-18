# The date gate and the sector caption — design

**Date:** 2026-08-17
**Status:** approved, ready for planning
**Scope:** two live defects in two different products. One gate divergence in the static calculator; one false caption in the SaaS threshold card. **No figure may change on either side.**

## Why these two, and what they have in common

Both are the same failure: **a value reaches a consumer that reads it differently from whatever admitted it.** Item 1 is a gate that never checks a field its consumer parses. Item 2 is a caption hardcoded to a constant while the number beside it is computed from a list. Neither produces a wrong figure; both make the product state something untrue.

They ship in different repos with different verification stories, so they are two independent halves of one batch. Item 1 is verifiable end-to-end on a laptop. **Item 2's server half is not** — see Verification.

## 1. `run()` prices a cleared date as year 0 — LIVE

`cbam-app.ts` has two completeness gates with textually identical conditions:

```ts
if (!pack || !cn!.value || !country!.value || !route!.value || !mass!.value)
```

`run():1772` renders the idle message and returns; `draftLine():1910` returns null. **Neither checks the date.**

`syncRoutes():1651` computes the year as `Number(date!.value.slice(0, 4)) || 2026`. An empty field gives `Number('') === 0`, which is falsy, so it falls back to **2026** and offers routes — `nextRoute` then auto-selects for any single-route good. `run()` proceeds with `date: ''`, the engine's year is `0`, `cbamFactors` has no row for 0, and the line refuses on `cbam-factor/0`.

A user reads a real sentence off this today, on the single-line live preview — the surface the file's own comment calls "the surface with the largest audience". Driven end-to-end through the real functions (`routesFor` → `nextRoute` → `parseVerifiedFields` → `verifiedInputOf` → `estimateFromPack` → `decorateSnapshot` → `renderResult`) with a cleared date and the verified tier, it renders the free-allocation-factor refusal over a line whose only actual problem is a blank date.

**Fix:** add `|| !date!.value` to **both** gates, and extend the idle copy to name the field — *"Choose a good, origin, route, mass and import date to see the provisional exposure."*

This makes the defect unreachable rather than better-worded: `estimateFromPack` never receives `date: ''`, so year `0` cannot arise.

**The file already fixed this exact divergence for a different field**, and says so at `:1912`:

> *"This is the ADD path to run()'s PREVIEW path, and the two gates must agree or the panel and the line list state different facts about the same field"*

That comment is about **mass** — `run()` refused `'+100'`, `'5.'`, `'0x10'` and `'  100  '` while `draftLine` accepted all four. It was closed by making both paths call one predicate. The date is the same bug one field over, and this is the same fix.

**It also resolves a silent refusal.** `draftLine:1956` runs `if (Number.isNaN(yearOf(l))) return null` **without setting `draftReason`**, so today a cleared date makes the Add button do nothing and say nothing. Once the empty case is caught by the shared gate, `:1956` only sees malformed-but-non-empty values, which `<input type="date">` cannot produce. It becomes the backstop it was written as rather than a user-facing path. **Do not delete it** — it guards `draftLine` against a caller that is not the form.

**`syncRoutes`' `|| 2026` stays.** It is load-bearing: the route dropdown must populate before a date is chosen. The bug was never the fallback, it was that nothing downstream re-checked. Comment it to say so, so the next reader does not "fix" the wrong half.

## 2. The SaaS threshold card misdescribes its own number — LIVE

`CalculationsView.vue:84` passes a hardcoded literal:

```html
<ThresholdRulerCard ... sector="iron_and_steel" />
```

`ThresholdRulerCard:14` renders it as `<code>{{ sector }}</code> is a CBAM sector in scope.` So **every case** — cement, aluminium, fertiliser — reads *"`iron_and_steel` is a CBAM sector in scope."*

But the defect is not that the constant is wrong for three sectors out of four. `api/routes/cases.ts:78-80` computes the number beside it by summing **all four**:

```js
.filter(entry => ['cement', 'aluminium', 'fertilisers', 'iron_and_steel'].includes(entry.sector))
```

`knownEligibleMassT` is a **cross-sector annual total**, which is correct — that is what the Art 2(3) de minimis measures. So naming **any single sector** beside it misdescribes the figure. Passing the case's real sector would still be wrong; it would just be wrong less obviously.

The static calculator already gets this right, naming all four from the rule's own list: *"Your cement, iron & steel, aluminium and fertiliser imports for 2026 total X t, below the Y t threshold for those sectors."*

### The list is written by hand in three places

| where | form |
|---|---|
| `lib/threshold/aggregate.ts:41` | `massSectors` Set — **not exported** |
| `api/routes/cases.ts:78-80` | inline array literal |
| `db/migrations/0000_schema.sql:486` | `threshold_mass_sectors_ck` CHECK |

The authoritative copy is `threshold_rule_version.included_sectors text[] NOT NULL` — **in the row `cases.ts` is already querying.** It selects `id, threshold_t` and leaves `included_sectors` on the table.

**Fix, three changes:**

1. `cases.ts` selects `included_sectors` alongside `threshold_t`.
2. `includedSectors` is added to the response's `threshold` object and to `CaseDetailResponse` in `api/contracts.ts`.
3. `ThresholdRulerCard` takes `includedSectors: string[]` in place of `sector: string` and names them all; `CalculationsView` stops passing the literal.

This deletes one of the three copies and makes the caption describe the number it sits beside.

### Deliberately out of scope

**`aggregate.ts`'s unexported `massSectors` and `cases.ts`'s inline filter stay as they are.** Routing `cases.ts` through `aggregateThresholdBasis` is the structurally right move — it would delete the second copy and recover the `entryIds`/`entryHashes` provenance that function exists to produce and that `cases.ts` currently discards. But it changes how the threshold number is **computed** on a path whose behaviour cannot be verified on this machine. That belongs in its own spec with the provenance work, not folded into a caption fix.

Naming it here so the next reader knows the second copy was seen and left, not missed.

### Sector prose

The static side renders `iron_and_steel` as "iron & steel" from an ordered key→prose table, because no mechanical transformation gets from key to prose — measured wrong on two of the four keys. `ThresholdRulerCard` renders inside `<code>`, where a raw key reads as a datum rather than as copy. **Keep the raw keys**, and keep the `<code>` styling that justifies them. Prose-ifying this card means porting the ordered table across the repo boundary, which is a second spec's problem and buys nothing while the values are `<code>`-styled.

## Verification — and it differs by item

**Item 1 is verifiable here, completely.** Unit-testable, mutation-verifiable, and measurable as a whole-payload sweep, exactly as the last four batches were.

**Item 2's server half is not.** `CaseDetailResponse` is **never `.parse()`d** — `contracts.ts:112` only infers a type from it — so nothing validates the response at runtime and `vue-tsc --noEmit` is the only local check. Whether the route *actually emits* `includedSectors`, including how Postgres `text[]` marshals through drizzle into a JS array, needs the integration suite against real Postgres. This machine has no Docker, podman, colima or psql. **CI has Postgres 18 and `TEST_DATABASE_URL`, and runs the suite there.**

So item 2 ships with an integration test asserting the field's presence and contents, and the report must say **CI verified it, not the author.** Do not describe the server half as checked locally.

## Testing

- Each fix mutation-verified: break it, confirm a **named** test fails, restore. A green mutation run is what a failed mutation looks like — diff against a pristine copy.
- **Item 1 pinned on both gates.** `run()` must render the idle message and `draftLine()` must return null, for the same cleared-date input. Pinning one leaves the divergence half-open, which is the exact shape of the original bug.
- **Item 1's idle copy pinned by a hand-typed constant**, never imported from production, per this codebase's anti-paraphrase convention.
- **Item 1 must prove year 0 is unreachable**, not merely better-worded: assert no `cbam-factor/0` refusal can be produced through the form's own functions.
- **Item 2 pinned on the caption's content, not its source text.** The card must name every sector the rule includes — assert against the response's `includedSectors`, so a card that hardcoded a different literal still fails.
- **Item 2's integration test asserts the emitted response**, since no runtime schema validates it. A type-level check cannot see a missing field.
- **No figure moves.** Sweep `origin/main` → HEAD as one hop for item 1; only the idle-message path may differ. Prove the harness can see a change before trusting any null result.

## Out of scope

Routing `cases.ts` through `aggregateThresholdBasis` (its own spec, with provenance) · the `net_mass_t` NaN/Infinity constraint, which is latent — **no production endpoint writes mass**, every insert into `customs_line` and `annual_import_mass_entry` is in a test, and `lib/regulatory/resolve.ts:134` already records that a sibling gap is "reachable the day a line-creation endpoint ships". That constraint belongs with the endpoint that makes it reachable · sector prose on the SaaS side · the parity fixture (Go) · Batch D, all waiting on published data.
