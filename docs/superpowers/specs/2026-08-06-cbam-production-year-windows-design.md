# CBAM: production-year markers become validity windows

Design spec · 6 August 2026
**Status: SHIPPED 7 August 2026.** CBM `397457e`, Angad `d529b1b`, live and verified
in production. Read the "What actually happened" section at the end before trusting
any forward-looking statement in the body — two of them turned out to be wrong.

## Problem

IR (EU) 2025/2620 Annex §5.3 marks production-year variants of a benchmark with
`(1)` (production years 2026-27) and `(2)` (2028-30). These are validity periods.

`CBM/scripts/build-fa-package.py` copies the workbook's route cell verbatim into
`routeIndicator` (line 165) and stamps every row with a single `VALID_FROM` and
`validTo: None` (lines 171-172). The year markers therefore land in the route
field, and both variants stay active for every date.

Two consequences:

1. **The date cannot disambiguate them.** Both rows are valid forever, so
   `active(validFrom, validTo, date)` in `resolve-fa.ts` passes both, and
   selection falls through to route-string equality.
2. **Nothing ever matches them.** `defaultFactors` never emits `(1)` or `(2)` as
   a production route, and never emits a compound like `(F)(1)`. A good whose
   only Column B rows are keyed `(F)(1)` and `(F)(2)` can never be resolved from
   a declared route of `(F)`.

Measured against the live engine, sweeping all 574 catalogue CN codes across five
origins at an import date in 2026:

| | goods priceable | never priceable |
| --- | --- | --- |
| today | 385 | 185 |
| with the fix simulated | **547** | **23** |

The fix recovers **162 goods**, an 88% reduction in dead codes. It reaches
further than the 106 goods marked with a bare `(1)`/`(2)` because the compound
alloy-steel rows — `(F)(1)`, `(G)(1)`, `(H)(1)`, `(J)(1)` and their `(2)`
counterparts, 70 rows each — also begin resolving once the year is separated from
the route.

The engine fails closed on these goods (`status: 'unavailable'`), so nothing has
been mispriced. They simply cannot be quoted.

## Constraint that shapes the design

`resolveBenchmark` in `resolve-fa.ts` already filters on
`active(row.validFrom, row.validTo, selector.date)` **before** matching the route
indicator. Put the years in the validity window and the existing lookup works
unchanged.

The consumer is correct. Only the producer is wrong. No engine code changes.

This matters because `src/scripts/cbam-algos/` in Angad is a hash-guarded vendored
copy of `CBM/lib/`, policed by `scripts/cbam-sync-check.mjs`. Any engine edit would
either break that guard or have to be made upstream and re-vendored.

## Decisions taken

| Decision | Choice | Reason |
| --- | --- | --- |
| Where the fix lands | Upstream in CBM, then re-sync into Angad | Keeps the two repos honest and fixes the SaaS too. Patching Angad's pack alone would create exactly the drift `cbam-sync-check` exists to catch. |
| Production year vs import year | Use the import year, and state the assumption in the result's provenance | The Annex ties `(1)`/`(2)` to the year of *production*; the calculator knows only the import date. A screening tool's users mostly cannot supply a production year, and every wrong entry would move the benchmark. Making the simplification visible is consistent with the tool's existing honesty rules. |
| Scope | `(1)`/`(2)` only | One coherent change, one regenerated package. |
| Implementation shape | Translate in the parse loop | Smallest correct change; needs no engine edit. |

### Deliberately out of scope

Certificate prices exist only for `2026-Q1`…`2026-Q4`, so **any import date in
2027 or later returns `unavailable`**, and the UI's free date input
(`date.value.slice(0, 4)`) lets a user reach that dead zone with no explanation.
This is correct fail-closed behaviour — the Commission has not published those
prices — but it means the `(2)` window cannot be exercised until 2028 prices
appear, and the near-term value of this fix lies entirely in the `(1)` rows.

Logged as a separate finding. Not addressed here.

## The change

One file: `CBM/scripts/build-fa-package.py`.

### New helper

```python
YEAR_WINDOWS = {
    "(1)": ("2026-01-01T00:00:00.000Z", "2027-12-31T23:59:59.999Z"),
    "(2)": ("2028-01-01T00:00:00.000Z", "2030-12-31T23:59:59.999Z"),
}
YEAR_SLUG = {"(1)": "2026", "(2)": "2028"}

def split_route(raw):
    """Annex §5.3 marks production-year variants (1) 2026-27 and (2) 2028-30.
    Those are validity windows, not production routes: '(F)(1)' is route (F)
    valid for 2026-27, and a bare '(1)' is route-independent for 2026-27.

    Returns (routeIndicator, validFrom, validTo, period_slug).
    """
    m = re.fullmatch(r"(\([A-Z]\))?(\([12]\))", raw or "")
    if not m:
        return raw or "", VALID_FROM, None, None
    frm, to = YEAR_WINDOWS[m.group(2)]
    return (m.group(1) or ""), frm, to, YEAR_SLUG[m.group(2)]
```

### Call-site edits, inside the existing row loop

| Field | From | To |
| --- | --- | --- |
| `routeIndicator` | `route` | split route — `(F)`, or `''` for a bare year marker |
| `validFrom` / `validTo` | `VALID_FROM` / `None` | the year window, when one applies |
| `id` slug | `route.strip("()")` | letters extracted properly, plus the period slug |
| `sourceLocator` | contains `route` | **contains the original marker, unchanged** |

`sourceLocator` keeping the literal Annex marker is not optional. The row's
provenance string must still point at the cell it came from, or we have traded a
data bug for a traceability one.

### Existing defect fixed in passing

`slug = route.strip("()")` strips only *leading and trailing* characters, so
`(F)(1)` yields `F)(1` and produces malformed ids such as
`bm-72052100-b-f)(1`. Harmless today because ids are opaque, but it is the
fingerprint of a generator that never modelled compound markers. Replace with a
character-class extraction.

Post-fix ids for CN 72052100 become `bm-72052100-b-f-2026`,
`bm-72052100-b-f-2028`, `bm-72052100-b-g-2026`, `bm-72052100-b-g-2028`.

### Guard that must move with it

The duplicate-selector check (line 182) currently keys on
`(scopeCode, benchmarkColumn, routeIndicator)`. After the fix `(F)(1)` and
`(F)(2)` both become `(F)`, so the key must gain the window:

```python
key = (row["scopeCode"], row["benchmarkColumn"], row["routeIndicator"], row["validFrom"])
```

Without this the script `sys.exit`s on a **false** duplicate. Its error message
should name the period too, or whoever trips it next will be misled.

### Why that key is sufficient — verified, not assumed

A standalone `(F)` row and an `(F)(1)` row would both become route `(F)` with
`validFrom` 2026-01-01, differing only in `validTo`. That would defeat the dedupe
key *and* leave `resolveBenchmark` with two active rows for a 2026 date, throwing
`REGULATION_AMBIGUOUS`.

It does not arise. Checked across all 2,465 rows: **zero** `(scopeCode, column,
post-fix route)` groups hold both a windowed and an unwindowed row.

The reason is structural. Year markers appear only in Column B. Column A carries
the bare route letters. CN 72241010 is representative — Annex line 2475:

| Column A | Column B |
| --- | --- |
| `(F)` 0.453 | `(F)(1)` 1.807 · `(F)(2)` 1.640 |
| `(G)` 0.330 | `(G)(1)` 0.982 · `(G)(2)` 0.969 |
| `(H)` 0.330 | `(H)(1)` 0.640 · `(H)(2)` 0.628 |
| `(J)` 0.358 | `(J)(1)` 1.180 · `(J)(2)` 1.148 |

Which is physically sensible: an installation's own process benchmark is set once,
while the full-product benchmark embeds precursors whose own benchmarks tighten
between 2026-27 and 2028-30.

This is a property of the current workbook, not a guarantee. A future reissue
could introduce the collision, so the regression test below asserts it holds.

### Expected effect

794 of 2,465 benchmark rows gain a bounded validity window — verified by running
`split_route` over every distinct route value in the shipped pack. Every
`bmTco2ePerT` stays byte-identical.

Route values and their post-fix mapping, all 22 of them:

| Input | Becomes | Window | Rows |
| --- | --- | --- | --- |
| `''` | `''` | open | 566 |
| `(1)` / `(2)` | `''` | 2026-27 / 2028-30 | 117 each |
| `(A)` `(B)` | unchanged | open | 4 each |
| `(C)` `(D)` `(E)` | unchanged | open | 309 each |
| `(F)` `(G)` `(H)` `(J)` | unchanged | open | 11 each |
| `(F)(1)`…`(J)(2)` | `(F)`…`(J)` | 2026-27 / 2028-30 | 70 each |
| `(K)` `(L)` | unchanged | open | 63 each |

## Verification

### Baseline, before any edit

Run `npm test` and `npm run typecheck` in CBM and record the result. If the suite
is already red for unrelated reasons, nothing afterwards can be attributed.
This is step one of implementation.

### One-off migration gate

Regenerate with `--deterministic` (omits `generatedAt`, so the diff is clean), then
assert old golden vs new:

- row count unchanged at 2,465
- the multiset of `(scopeCode, benchmarkColumn, bmTco2ePerT)` is **identical** —
  every value still present, on the same CN and column
- only `id`, `routeIndicator`, `validFrom`, `validTo` differ, on the expected rows
- every rewritten row's `sourceLocator` still contains its original marker

This is the money-safety property: it answers "did we corrupt the data" and
nothing else. Written for the migration, deleted after.

### Permanent regression test

Added to CBM's vitest suite. Asserts the structural properties the bug violated,
plus the one the design depends on:

- no benchmark row's `routeIndicator` contains a year marker — `/\(\d\)/`
- every row with a bounded window has both `validFrom` and `validTo` set
- **no `(scopeCode, benchmarkColumn, routeIndicator)` group holds both a bounded
  and an unbounded row** — this is what keeps the dedupe key sufficient and stops
  `resolveBenchmark` seeing two active rows for one date. True of the current
  workbook; a reissue could break it, and this is where we would find out.

Deliberately **not** a pinned coverage count. `547` is brittle; any future
regeneration moves it, and a test that must be edited routinely teaches people to
edit tests. The structural invariant cannot drift.

### Coverage as evidence

The 385 → 547 measurement belongs in the commit message and this spec as proof the
fix did what it claimed, not in a test.

Note: 547 was measured by simulating the fix on the *shipped* pack, whereas the
real path regenerates from the *workbook*. They should agree. If the regenerated
pack does not reproduce 547, that discrepancy is itself informative — it means the
implementation diverged from this design somewhere.

### Hand-checked rows

Verified against the Annex PDF by eye, recorded here so a reviewer need not rerun
anything.

Cement chain (`docs/CBAM EU 2025-2620 (Col A & Col B).pdf`, Annex §5.3):

| CN | Route | Column A | Column B |
| --- | --- | --- | --- |
| 25231000 | (A) | 0.666 | 0.666 |
| 25231000 | (B) | 0.859 | 0.859 |
| 25232100 | any | 0 | 0.859 |
| 25232900 | any | 0 | 0.666 |

Compound-route case, CN 72052100 Column B — the four rows this fix rewrites:

| Marker today | Value | Becomes route | Window |
| --- | --- | --- | --- |
| `(F)(1)` | 1.46 | `(F)` | 2026-01-01 – 2027-12-31 |
| `(G)(1)` | 0.659 | `(G)` | 2026-01-01 – 2027-12-31 |
| `(F)(2)` | 1.298 | `(F)` | 2028-01-01 – 2030-12-31 |
| `(G)(2)` | 0.647 | `(G)` | 2028-01-01 – 2030-12-31 |

## Re-sync path

Two phases. Phase 1 happens now, in scratch, and commits nothing to either repo.
Phase 2 happens when a human applies the patch.

```
PHASE 1 — scratch tree (this work)
──────────────────────────────────────────────────────────
1. copy build-fa-package.py → scratch, apply the change
2. fetch workbook → scratch  (sha verified 2026-08-06)
3. python3 scratch/scripts/build-fa-package.py <xlsx>
     → scratch/golden/rule-packages/eu-cbam-2026-free-allocation.json
4. migration gate vs CBM's current golden — no value moved?
5. re-measure coverage through the live engine
6. deliver: edited script + diff + evidence

PHASE 2 — CBM, then Angad (human applies)
──────────────────────────────────────────────────────────
CBM                                            Angad
0. baseline: npm test, npm run typecheck
1. apply the patch to scripts/build-fa-package.py
2. python3 scripts/build-fa-package.py <xlsx>
     → golden/rule-packages/eu-cbam-2026-free-allocation.json
3. npx tsx scripts/build-estimator-pack.mts
     → CBM/public/estimator-pack.json
4. npm test + typecheck
5. commit                                      │
                                               └─→ 6. copy pack in
                                                   7. cbam-sync-check.mjs --update
                                                   8. npm run verify + playwright
                                                   9. confirm coverage 385 → 547
                                                  10. commit
```

Step 9 is where the simulation becomes a measurement.

### The workbook

Not committed, by upstream's design (95 KB binary, and the EC may reissue it).

- URL: `https://taxation-customs.ec.europa.eu/document/download/9877523c-2a02-4926-a211-aefae7cf6d0d_en`
- Expected sha256: `b79108b025e697822f0f59de477fa68066c1c05c228fae2270cd230af84e8a7b`
- Verified retrievable and hash-matching on 5 August 2026 (95,624 bytes)

`build-fa-package.py` hard-exits on a hash mismatch, which is correct: a reissued
workbook is a new rule-package version, not an edit.

### Rollback

`git revert` in either repo independently. The golden package and both copies of
the browser pack are committed artefacts.

## How the change reaches CBM

**Decided: patch-first. No file in either repo is edited during this work.**

All development happens in a scratch directory. `build-fa-package.py` is copied
there, edited, and run there — `OUT` resolves relative to the script, so a
regenerated free-allocation package lands in the scratch tree and neither repo is
touched. The deliverable is the edited script plus the evidence below. A human
drops it into CBM and runs the normal regeneration when ready.

This was chosen over editing CBM directly, and over editing Angad's pack in place.
The second option is specifically unsafe, for a reason worth recording:

> `UPSTREAM.json` records only `packGeneratedAt` — a **timestamp**, not a content
> hash. `cbam-sync-check` compares `pack.generatedAt` against it. The 11 engine
> files each carry a real sha256; the 7.18 MB pack carries a date string. A content
> edit to the pack that leaves `generatedAt` alone passes **both** the local and
> the upstream check. The tripwire written to catch exactly this drift cannot see
> it.

See "Related finding" below.

### What can and cannot be proven in the scratch tree

| | |
| --- | --- |
| Can | Regenerate the free-allocation golden package from the pinned workbook |
| Can | Migration gate: diff regenerated vs CBM's current golden, prove no value moved |
| Can | Re-measure coverage through the live engine using the existing harness |
| **Cannot** | Regenerate the **browser pack** — Angad has no `golden/` directory, and `build-estimator-pack.mts` needs both the free-allocation *and* default-values golden packages |

So the final 385 → 547 figure remains a simulation until someone runs
`build-estimator-pack.mts` inside CBM. The simulation drives the real engine over
a pack rewritten by the real `split_route`, so it is a strong prediction — but it
is a prediction, and the spec should not pretend otherwise.

### Still open

**Branch.** CBM sits on `docs/cbam-ui-astro` with a clean working tree. Which
branch should receive a regulatory data change is a human decision, deferred to
whoever applies the patch.

## Related finding, out of scope

The pack integrity guard is timestamp-based. `cbam-sync-check.mjs` should record a
sha256 of `public/cbam/estimator-pack.json` in `UPSTREAM.json` alongside
`packGeneratedAt`, and compare content rather than a date.

Small fix, real hole, independent of this work. Logged so it is not lost.

## What is explicitly not changing

`resolve-fa.ts`, `sefa.ts`, `estimate-from-pack.ts`, `certificate-estimate.ts`,
`cbam-app.ts`, the pack schema, and the calculator UI.

The Column A / Column B selection logic is correct and audited
(`docs/cbam-calculator-audit.pdf` §2.1) and is not in scope. The scope-driven rule
— `full_product` → Column B, `process_only` → Column A plus Equation 4 — stands
unchanged.

---

## What actually happened

Written 7 August 2026, after shipping. The body above is the design as it stood
before implementation; this section records where it was wrong.

### The fix landed, and the prediction held exactly

Live at `deltaclimate.earth`, verified against the pack fetched over the wire:
priceable goods **385 → 547**, never-priceable **185 → 23**. The figure the design
called "a strong prediction, not a measurement" turned out to be exactly right,
but it was right by luck of a faithful simulation, not by proof.

CBM `397457e` (the fix), `95224d0` (source hashes). Angad `d529b1b`, `bf211f1`.

### Two statements in the body are now false

1. **"Cannot regenerate the browser pack."** We did — inside CBM, where both
   golden packages exist. The scratch tree could not; the SaaS always could.
2. **"385 → 547 remains a simulation."** It is now a production measurement.

### The design missed a second defect, and the migration exposed it

`build-fa-package.py` could not reproduce its own golden file. The `thresholds`
block — the 50 t de minimis gate — and its `reg-2023-956` source had been
hand-added on 2026-07-29 and never taught to the generator. **Every regeneration
silently deleted the rule that decides whether an importer owes anything at all.**

This spec's verification section is the reason it was caught, and also the reason
it was nearly missed. The Phase 1 fidelity baseline compared
`a['benchmarks'] == b['benchmarks']` — benchmarks only. That passed. A
full-package comparison would have caught it before a line of code was written,
and when finally run it found **two** drifts, not one: `thresholds` *and* the
`sources` array (6 committed vs 5 generated).

**The lesson is narrow and worth keeping: a fidelity check must compare the whole
artefact.** Comparing the part you are about to change proves nothing about the
parts you are not.

### Three tests pinned the old behaviour and had to move

- CBM `differential.test.ts` pinned the gap at 382/183 for India and concluded it
  "needs corpus research rather than a code change". It was a code change. Now
  528/37; the remaining 37 are a genuine corpus question.
- Angad `cbam-render.test.mjs` used CN 72241010 as its stranded example in three
  places. That good is one of the 162 recovered, so the tests were repointed at
  72052100/(C), which is still genuinely stranded.

### Still open

- The `Art 2(2)` citation is wrong in five places in the vendored engine
  (`sefa.ts` ×3, `certificate-estimate.ts`, `cbam-app.ts`). Article 2 has no
  numbered paragraphs; the provision is Art 1(2). The generator's locator was
  fixed in `95224d0`; the engine's was not. Unreachable today — electricity is
  absent from the CN picker — but it is a wrong legal citation in user-facing
  provenance code.
- Four sources still carry placeholder hashes: `dir-2003-87-art-10a-1a`,
  `dr-2019-331-art-14-6`, `reg-2023-956`, `ec-certificate-price-page`.
- The pack integrity guard is still timestamp-based. Unchanged, still worth fixing.
