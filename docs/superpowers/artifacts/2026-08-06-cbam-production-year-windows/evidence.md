# Evidence — CBAM production-year validity windows (Phase 1)

> **SUPERSEDED 7 August 2026. Do not apply `build-fa-package.patch`.**
>
> The change shipped as CBM `397457e` and `95224d0`, Angad `d529b1b` and
> `bf211f1`. The patch beside this file carries **only** the year-window fix — not
> the thresholds fix that the migration exposed, nor the OJ source hashes. Applying
> it to CBM today fails outright (`patch does not apply`), which is the safe
> outcome, but it is no longer the change. **The commits are the record.**
>
> Two claims below were true of the scratch tree and are false of the finished
> work: that the browser pack "was not regenerated", and that the coverage figure
> is "a strong prediction, not a measurement". Both were resolved inside CBM, where
> the golden packages the scratch tree lacked are present. Production measures
> 547 / 23.
>
> One thing this file does not mention at all, because Phase 1 never saw it: the
> generator could not reproduce its own golden. The `thresholds` block — the 50 t
> de minimis gate — was hand-added on 2026-07-29 and never taught to the
> generator, so every regeneration silently deleted it. The fidelity check below
> compared **benchmarks only** and passed. A full-package comparison found two
> drifts, not one. See the spec's "What actually happened" section.

Generated 6 August 2026.
Spec: `docs/superpowers/specs/2026-08-06-cbam-production-year-windows-design.md`
Plan: `docs/superpowers/plans/2026-08-06-cbam-production-year-windows.md`

Nothing in `CBM` or `Angad` was modified. All artefacts below live in a scratch tree.

## What this changes

IR (EU) 2025/2620 Annex §5.3 marks production-year variants of a benchmark with
`(1)` (production years 2026-27) and `(2)` (2028-30). `build-fa-package.py`
copied those into `routeIndicator` and stamped every row with one open-ended
validity, so nothing could ever match them — the defaults corpus never declares a
route of `(1)`, nor a compound `(F)(1)`.

The patch moves the year into `validFrom`/`validTo` where the resolver already
looks. **No engine code changes.**

## Fidelity of the scratch pipeline

The unmodified generator was run first, against the pinned workbook, and its
output compared to CBM's committed golden:

```
benchmark rows  committed: 2465  regenerated: 2465
identical: True
```

Every comparison below is therefore against a faithful baseline.

## Workbook

```
sha256 b79108b025e697822f0f59de477fa68066c1c05c228fae2270cd230af84e8a7b
95,624 bytes — matches the pin in build-fa-package.py
```

Retrieved 6 August 2026 from
`https://taxation-customs.ec.europa.eu/document/download/9877523c-2a02-4926-a211-aefae7cf6d0d_en`

## Invariants — `tests/test_invariants.py`

Before the patch:

```
FAIL  test_no_year_marker_in_route: 794 rows carry a production-year marker in
      routeIndicator; first: bm-25233000-a-1 route='(1)'
PASS  test_bounded_rows_have_both_ends
PASS  test_no_group_mixes_bounded_and_open
```

After the patch:

```
PASS  test_no_year_marker_in_route
PASS  test_bounded_rows_have_both_ends
PASS  test_no_group_mixes_bounded_and_open
```

The third test is the one that keeps the widened dedupe key sufficient: no
`(scopeCode, column, routeIndicator)` group may hold both a bounded and an
unbounded row, or `resolveBenchmark` would see two active rows for one date.

## Migration gate — `tests/migration_gate.py`

```
rows gaining a bounded window: 794
total rows: 2465

GATE PASSED — no benchmark value moved, provenance stable
```

The gate asserts that the multiset of `(scopeCode, benchmarkColumn, bmTco2ePerT)`
is **identical** before and after, that no immutable field changed, and that every
`sourceLocator` is preserved. Only `id`, `routeIndicator`, `validFrom` and
`validTo` were permitted to differ.

## Coverage — `measure_coverage.mts`, driving the live vendored engine

```
2026 imports, 574 catalogue CN codes x 5 origins
  BEFORE  priceable=385  never-priceable=185
  AFTER   priceable=547  never-priceable=23
  DELTA   +162 goods
```

This reproduces the figure predicted during design, from the real generator
output rather than a simulated rewrite.

Note this is a **completeness** gain, not an accuracy one. No number the
calculator already produced changes. The affected goods previously returned
`status: 'unavailable'` — the engine failed closed rather than mispricing, so
nothing was ever wrong; it simply could not answer.

## Spot-check against the Annex

```
25232900 colB route=''    bm=0.666   validTo=open        id=bm-25232900-b-base
25231000 colB route=(A)   bm=0.666   validTo=open        id=bm-25231000-b-a
72241010 colA route=(F)   bm=0.453   validTo=open        id=bm-72241010-a-f
72241010 colB route=(F)   bm=1.807   validTo=2027-12-31  id=bm-72241010-b-f-2026
72241010 colB route=(F)   bm=1.64    validTo=2030-12-31  id=bm-72241010-b-f-2028
```

The last two lines are the fix: one route, two windows, values untouched. Annex
line 2475 confirms `1,807 (F)(1)` and `1,640 (F)(2)` for CN 7224 10 10.

The ids also lose a pre-existing defect. `route.strip("()")` removes only leading
and trailing characters, so `(F)(1)` yielded `F)(1` and ids such as
`bm-72052100-b-f)(1`. Harmless — ids are opaque — but the fingerprint of a
generator that never modelled compound markers.

## Not proven here

The **browser pack was not regenerated**. Angad has no `golden/` directory and
`build-estimator-pack.mts` needs both the free-allocation and default-values
golden packages. The coverage figures above splice the regenerated benchmark rows
into the shipped pack and drive the real engine, which makes them a strong
prediction of the true artefact — but confirm them after running
`build-estimator-pack.mts` inside CBM.

## Deliverable

| File | Purpose |
| --- | --- |
| `build-fa-package.patch` | 92 lines. Verified to apply cleanly with `git apply -p1` from the CBM repo root, producing a file byte-identical to the generator used for every measurement above. |
| `tests/test_invariants.py` | Port to CBM's vitest suite as a permanent regression test. |
| `tests/migration_gate.py` | One-off. Delete after the migration. |

## To apply

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npm test && npm run typecheck          # baseline FIRST — know what passing looks like
git apply -p1 /path/to/build-fa-package.patch
python3 scripts/build-fa-package.py /path/to/benchmarks.xlsx
npx tsx scripts/build-estimator-pack.mts
npm test && npm run typecheck
```

Then in Angad: copy `CBM/public/estimator-pack.json` to
`public/cbam/estimator-pack.json`, run `node scripts/cbam-sync-check.mjs --update`,
then `npm run verify` and the Playwright suite.

## Related finding, not addressed

`UPSTREAM.json` records only `packGeneratedAt` — a timestamp, not a content hash.
`cbam-sync-check` compares `pack.generatedAt` against it, so a content edit to the
7.18 MB pack that leaves `generatedAt` alone passes both the local and the
upstream check. The 11 engine files each carry a real sha256; the pack does not.
Worth closing independently of this work.
