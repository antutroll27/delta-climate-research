# Rebuilding the default-values pack on IR (EU) 2026/1740 — design

**Date:** 2026-08-17
**Status:** approved, ready for planning
**Scope:** regenerate the default-values corpus from the Commission's corrected workbook, and ship it. **A data change to a regulated artefact — every moved figure must be accounted for by name.**

## Why

Our pack is built from IR (EU) 2025/2621's Annex I. **IR (EU) 2026/1740, adopted 20 July 2026, superseded it.** The shipped pack cites a regulation that has been corrected for four weeks.

That framing is the *lesser* half. The full-file measurement (2026-08-17) says the value drift is negligible and **the reason to do this is the route re-keying**:

| | today | after |
|---|---|---|
| 8-digit route alignment with the benchmark table | 271 / 401 (67.6%) | **277 / 277 (100%)** |
| Stranded declarable (good, origin, route) triples | **1,365** (6.1%) | **924** (4.2%) |
| …of which caused by a blank route | **462** | **0** |
| Goods priceable / stranded | 547 / 23 | 542 / 28 |

**462 triples that refuse today would price.** The Commission filled in routes it had left blank where the Annex enumerates them, which is exactly the "a wrong route silently fails the join" failure `build-dv-package.py`'s own docstring names as the reason v2 replaced the researched corpus. The correcting act finishes that job.

**Do not sell this as unstranding goods.** At good level it is **net −5** (3 freed, 8 newly stranded). The win is at the level a user actually meets: a specific good from a specific origin on a specific route.

## What the measurement established, so the rebuild is not a discovery exercise

- **One genuine value change in the entire file:** `OTHER / 72262000 / direct / (F)` **5.588 → 5.500**. Of 13,269 shared identities, 12,649 are identical; of the 620 that differ, 585 are pure precision loss (v1 carried up to 9 dp, v2 is 3 dp) and 34 are ±0.001 float tie-breaks.
- **33 withdrawals** (28 are Taiwan stainless; CN heading **7615 disappears from the file entirely**), **12 additions**. **Zero route arms lost or added.** The indirect identity set is **bit-identical**.
- **§8 reference line unchanged.** `DZ / 25231000 / (A)` is still direct **1.24**, indirect **0.04**; route (B) still 1.29 / 0.06. Its source row moves to TARIC `2523 10 00 90`, but the 8-digit key, the route and both intensities are identical. **No pinned figure in either repo moves.**
- **Annex IV carries no independent information** — 260 priced rows, and the value is the maximum of the country sheets' TOTAL for the same (code, description) with the route from the attaining row, **260 of 260, zero exceptions**.

## The build

`scripts/build-dv-package.py` **aborts four times in sequence** on v2, then would silently mis-key every row. The workbook is a different format:

| | v1 | v2 |
|---|---|---|
| Columns | 9 | **6** |
| Marked-up 2026/27/28 columns | present | **gone** |
| Route column index | 8 | **5** |
| Numbers | IEEE floats | **text, comma decimal, exactly 3 dp** |
| Code levels | 4/6/8 | + **10-digit TARIC** |
| Sheets | 120 + residual | 121 + residual + `Annex IV` |

The parser is the whole job. Everything downstream is unchanged: `scripts/build-estimator-pack.mts` cuts the browser pack from both golden packages, the site's copy is hash-checked by `scripts/cbam-sync-check.mjs`, and a drift-guard test regenerates and diffs so the pack can never be hand-edited.

## Two decisions, both settled here

### The mark-up oracle: keep v1

`EXPECTED_SECTOR_MARKUPS` is applied to **every** default figure. In v1 it is verified twice — the workbook's mark-up header cells are checked against it, and every emitted row's `total × (1 + markup)` is checked against the workbook's marked-up columns, 32,793 cells. The generator's own comment says inheritance for the two sheets with blank headers is safe *"because every emitted row's arithmetic is then verified against the workbook's own marked-up columns."*

**Measured: v2 contains the string "mark-up" zero times** — not in the country sheets, not in `Annex IV`, not in `Overview`. Both layers are gone. Rebuilding on v2 alone leaves the constant unverified by anything.

**So v1 stays in the repo as a mark-up oracle**, and the rebuild keeps both checks running against it. This is legitimate because IR 2026/1740 corrects **Annex I** — the values — not the mark-up schedule. If the schedule ever changes, the oracle must be retired deliberately, not silently outgrown; say so at the constant.

### Blank-route TARIC arms: gate on it

505 TARIC rows over 5 codes collapse to 3 CNs, all cement. 31 (sheet, CN8) groups have **both** arms priced, and in all 31 the arms carry different routes ((B) white / (A) grey) — so the pack's `(CN, route)` key keeps both losslessly. **Zero collisions today.**

But the route column is inconsistent: for `25231000` across 101 sheets, 16 write (B)/(A), **73 write blank/(A)**, and **9 write blank/blank**. A blank collapses to `'default'`. No sheet has both arms priced *and* both routes blank — **that is luck in the data, not a property of the format.** The parser must fail loudly if it ever meets one, naming the sheet and the codes.

## Liberia and New Caledonia: fail closed, and say so

Both gain a sheet in v2 with **exactly one priced good** (LR `28041000` hydrogen; NC `72026000` ferro-nickel). `originIsListed` is "does this origin have any row", so rebuilding flips them unlisted → listed, and `lib/regulatory/resolve.ts`'s residual gate then **removes their access to the whole 296-row residual bucket**.

**That is correct, and it is the safer direction.** `resolve.ts:110-121` already states the rule with worked examples: *"The residual sheet prices ORIGINS the Commission does not list; it does not backfill GOODS that a listed origin's sheet omits."* Without the gate, Mali hydrogen — published as 0 — would resolve to the world average 17.74, **inventing 19,514 tCO₂e on a 1,000 t line out of a published zero.**

It is also **not a regression**: under v1 Liberia genuinely had no sheet, so the residual bucket was right for it; under v2 the Commission lists it, so it is not. Both behaviours are correct for their own pack. What a Liberian importer loses is a number they should never have been given.

**The work is the message, not the behaviour.** A refusal here must say the origin is now listed and the Commission publishes no default for this good — not a generic "no rule found". And it needs a release note, because an importer who priced a Liberian good last week will notice.

## Testing

- **Every moved figure accounted for by name.** The expected set is exactly: one value change (`OTHER/72262000/(F)`), 33 withdrawals, 12 additions, and precision loss on 619 identities. **Anything else is a finding — stop and report it.**
- **The §8 reference line pinned before and after.** It must not move. If it does, the parse is wrong, not the regulation.
- **Route re-key measured through the real resolver.** Drive `resolveBenchmark`; do not re-implement the matching. Report the stranded-triple count before and after and the blank-route count, which must reach 0.
- **The mark-up gate must still run** against v1 and pass on all 32,793 cells. A rebuild that quietly drops it has removed the pack's central proof.
- **The blank-route TARIC gate tested by construction** — hand-build a sheet with both arms priced and both routes blank, and require the parser to abort naming it. The shipped data cannot exercise this, so a test that only runs the real workbook proves nothing.
- **The drift guard and `cbam-sync-check.mjs` must both be green** after re-vendoring, and the site's e2e suite must still pass — 462 newly priceable triples means goods that used to refuse now render a figure, and at least one existing test may pin a refusal that is no longer correct. **Treat any such failure as a finding to report, not a test to quietly update.**
- **Python strict mypy** on the generator, per this project's standing rule.

## Out of scope

**Annex IV** — a new table and a new resolution path, worth doing and dependent on this parse, but not part of it. **Compound-route strandings** — the 924 residue is 12 heading-level pairs carrying `(C)/(F)` and `(E)/(H)`, which the benchmark table does not publish; fixing it needs IR 2025/2620 to gain compound-route rows or a documented disambiguation rule, and **a defaults rebuild cannot touch it.** The CBM SaaS front end, which is parked. 2027/28 prices, which need the Commission.
