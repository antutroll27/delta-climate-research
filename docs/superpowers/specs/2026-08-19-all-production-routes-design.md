# Every route the good actually has — design

**Date:** 2026-08-19
**Status:** approved, ready for planning
**Scope:** one filter removed in the engine, two refusals sharpened. **No figure may change for any route a user can select today.**

## The defect

The route control offers **5 distinct routes across the whole corpus** — `(A) (B) (C) (F) (K)`. The regulation defines eleven, and our own benchmark table carries all eleven.

`routesFor` ends with:

```ts
.filter(route => lookupValue(pack, 'direct', { cn, country, route }, year).kind === 'found')
```

That keeps only routes with a published **default value**. Its docblock states the justification:

> *"a route the corpus does not list has no default **and no benchmark**"*

**That equivalence is false.** The Commission publishes default values for 8 routes and benchmarks for 11. Measured across the shipped pack at country IN: **421 of 572 goods have a benchmark route the form cannot offer.** (419 of those already offered at least one route and merely gain more; the remaining two, `2523900010` and `2523900090`, offered *nothing* before. Quote 421 for the sentence as written — the count is country-parameterised, so name the country whenever you cite it.)

## Why it matters, in figures

`72061000` / IN / 100 t, identical verified emissions of 1.9 tCO₂e per tonne:

| route | offered today? | verified-tier result |
|---|---|---|
| **(C)** | yes | **64.42** certificates |
| **(D)** | no | **148.66** |
| **(E)** | no | **187.37** |

The engine prices all three correctly. The form permits only the first — which carries the **largest** free-allocation deduction, so every verified importer of this good is pushed onto the answer most favourable to them. A **2.9× spread**, in the under-charging direction.

The same holds within one good's own route pair. Grey clinker `2523100090` / IN / 100 t, direct-only scope: route (A) gives 125.065, route **(B) gives 106.2475** — and (B) is invisible today.

## The fix

**Remove the filter.** Offer every route the good has a benchmark for.

That is the whole change. Everything else in this spec is about the two refusals it exposes.

Measured consequence:

| | today | after |
|---|---|---|
| distinct routes ever visible | 5 — `(A) (B) (C) (F) (K)` | **11** — `(A) (B) (C) (D) (E) (F) (G) (H) (J) (K) (L)` |
| goods offering ≤1 route | 544 of 572 | **151** |
| goods that gain routes | — | **421** |
| routes per good after | — | 1:151 · 2:62 · 3:280 · 4:60 · 5:19 |

## Why this is safe without a "dangerous mode"

The obvious worry is that a wider dropdown lets someone price a production path their good cannot have. **The engine already refuses that, structurally**, and it was verified before this spec was written:

```
2523100090 / (K)   aluminium route on cement  ->  unavailable [indirect/2523100090/IN/(K)/2026]
72061000   / (K)   aluminium route on steel   ->  unavailable [benchmark/72061000/column-B/(K)/2026-03-15]
```

A route is priceable when the benchmark table yields a row for it — either its own route-specific row, or a **route-independent** row (empty `routeIndicator`) that applies whatever route is declared. A route with neither makes `resolveBenchmark` raise `REGULATION_NOT_FOUND`, and the line refuses. There is no figure to mis-state.

*Corrected after review.* An earlier draft of this section said a route with no benchmark row **of its own** cannot price. That is false: `resolveBenchmark` falls back to route-independent rows, and six measured goods (`73181535`, `73181552`, `73181562`, `73181575`, `73181631`, `73181639`) offer `(C)` with no own Column-B row and price at 77.485 certificates on 1.9 t/t. This is pre-existing behaviour — those routes are offered identically today — so the safety property survives; only the mechanism was described wrongly.

**So no gating, no opt-in toggle, and no "expert mode" is required.** The boundary is enforced by the absence of data rather than by a policy we impose — which is stronger, because it does not depend on anyone trusting our judgement about who should be allowed what. Three tiers of behaviour fall out automatically:

1. route has a benchmark **and** the defaults the scope needs → prices
2. route has a benchmark but no default → prices on the user's own verified figures, refuses on the defaults tier
3. route has no benchmark for that good → **is not offered at all**

Only (2) needs the user told something they are not told today.

### Tier 3 is not offered, it is withheld — added after implementation review

An earlier draft of this section said tier 3 "refuses on every tier", and treated being offered-then-refused as sufficient. Implementation measurement showed that is not good enough, and the reason is tier 2's own message.

Removing the filter frees the **defaults limb** as well as the benchmark limb. That limb contributed **2,660 offers across 28 goods** that are named by the corpus yet can reach no Column-B benchmark — for example `72051000`, which lists Column B for `(C)/(D)/(E)` and a route-independent Column A only, but was offered `(F)` because other origins publish a default for it. All 2,660 lack a default too, so the old filter dropped every one; they are new.

Those routes can never price **for anyone**, verified figures included. But the corrected tier-2 refusal this spec installs tells the user *"entering your own verified figures will price this route"* — which for these 28 goods is false, and invites them to go and gather figures that cannot help. A false claim in a regulated filing tool is worse than the under-charge this work began with.

**So the offered set carries an invariant: every offered route can reach a benchmark**, via its own route-specific row or a route-independent one. The predicate applies to the union, not to the benchmark limb alone — a route with a default but no reachable benchmark is equally a dead end. Tier 3 therefore never reaches the user as a choice.

This tightens rather than contradicts "the boundary is enforced by absent data": the corpus still decides everything, now on both axes — what it *names*, and what it can *resolve*.

## The two refusals to sharpen

Both currently surface as `NO_BENCHMARK_REASON`, which was accurate for case 3 and **wrong for case 2**. With case 3 no longer offered, case 2 is the one the user actually meets.

**(a) A benchmark exists but no default value.** Today: *"The published rules do not give a free-allocation benchmark for this good, production route or year."* That is false — the benchmark is exactly what does exist. It should name the real gap and the way out:

> The Commission publishes no default emission value for route (D) on this good. Its free-allocation benchmark **is** published, so switch to *My verified figures* and this route will price.

**(b) The scope needs an indirect default the route lacks.** Grey clinker route (B) prices on `direct` and refuses on `direct_and_indirect`, because no indirect default exists for (B). The refusal must say the **indirect** component is what is missing, not leave the user believing the route is invalid. It should point at the scope control, which is the thing they can change.

Both are the defect class this project has removed four times already: a refusal naming the wrong cause.

## Deliberately not in scope

**No 12th route.** The Annex skips `I` — it reads as a `1`. Our benchmark table has no `I`, and the Commission's corrected workbook never mentions one. The **one** disagreement between the founder's Production Routes Matrix and our pack is `72052100`: the matrix says `F G H I`, we say `F G H J`. **That is a data question for a human, not a code change**, and it must be settled before anyone cites the matrix as authority. Everything else agrees: of the matrix's 134 goods, 82 routed sets match ours exactly and 51 "No Route" goods hold route-independent benchmarks in our pack.

**No route selector removal.** Kolum has no route field at all — country, year, CN code, quantity, optional emissions. They can do that because they do not split Column A from the precursor term; our own competitive brief measures 89% of (CN, route) pairs disagreeing between the two columns, worth roughly €4,890 on 100 t of one cement code. Dropping the route would forfeit that.

**No change to any figure a user can reach today.** Every route currently offered keeps its exact result.

## Where the change lives

`estimate-from-pack.ts` is **vendored byte-for-byte** from CBM and hash-guarded by `cbam-sync-check.mjs`. The filter therefore changes in `/Volumes/VSTSAMPLES/Projects/CBM` first, lands there with CI green, and is re-vendored to the website with `UPSTREAM.json` re-recorded against the merge commit. Hand-editing the website copy would break the seal.

The refusal wording lives in `cbam/certificate-estimate.ts` — also vendored — alongside the seven existing `*_REASON` constants it will join.

## Testing

- **The 421 goods are the acceptance measure.** Before: 544 goods offer ≤1 route. After: 151. Assert the corpus-wide count, not one example — a fix that widened only cement would pass a single-good test.
- **Every currently-offered route keeps its figure.** Sweep every (good, origin, route) selectable today and require byte-identical results. This is the regression that would matter most and the one a route change could plausibly cause.
- **The three tiers each pinned:** a route that prices, a route that prices only with verified figures, and a fictional route that refuses on every tier. The third must assert the *refusal*, since it is the safety property the whole design rests on.
- **The new refusals pinned by hand-typed constants**, never imported from production, per this codebase's anti-paraphrase convention.
- Each mutation-verified: break it, confirm a **named** test fails, restore, and confirm the mutation landed in the file before trusting the run.

## Open question for the founder

`72052100` — matrix says route **I**, our pack says **J**. One is wrong. If the Annex genuinely uses `I`, our benchmark table has a transcription error worth fixing before routes become more prominent in the UI.
