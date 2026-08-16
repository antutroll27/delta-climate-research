# The Mixed Tier's Rough Edges — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace four hand-spelled attestation predicates with one, stop a figure-less card asserting an electricity component it does not show, and tell an importer when their substituted electricity default is a world average.

**Architecture:** All three are labels, predicates and sentences. The engine gains one boolean it already knows; the website consumes it. **No figure changes anywhere.**

**Tech Stack:** TypeScript, vitest (CBM), `node:test` + `tsx` (website), Astro.

**Spec:** `docs/superpowers/specs/2026-08-16-cbam-mixed-edges-design.md`

---

## Standing constraints — read before every task

- **Never hand-edit anything under `src/scripts/cbam-algos/` except `cbam-app.ts`.** Vendored byte-for-byte from `CBM/lib/`, hash-guarded against `UPSTREAM.json` (11 files). Changes arrive only by `cp`.
- **Never `git add -A` or `git add .`** — in a worktree `node_modules` is a *symlink* and `.gitignore`'s trailing-slash pattern misses it.
- **Never run `npm ci`/`npm install`** in the website worktree — `node_modules` symlinks into a shared checkout another agent owns.
- `npx astro check` reports **2 pre-existing errors** (`mapillary-js` in `street-view-panel.ts`). Measure the baseline yourself; confirm delta-zero; do not fix them.
- `npm run test:unit` runs `cbam-sync-check` first against the **live CBM checkout**. While CBM is ahead of what the website has vendored it reports DRIFT and bails — use the raw runner (`node --import tsx --test <file>`) to measure a baseline in that window.
- **NO FIGURE MAY CHANGE.** Every change here is a predicate, a boolean or a sentence. If a `costEur`, `certificates`, `indirectTco2e` or `emissionsTco2e` moves anywhere, the change is wrong — stop and report.
- **Every drafted sentence and expectation below is a claim to verify, not copy.** Several of mine have been false across this run, including two inside a correction. Argue with evidence rather than complying.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `CBM/lib/estimator/estimate-from-pack.ts` | report whether the indirect fallback was residual | 1 |
| `CBM/lib/cbam/certificate-estimate.ts` | the new note constant | 1 |
| `CBM/lib/estimator/mixed-tier.test.ts` | engine pin | 1 |
| website vendored copies + `UPSTREAM.json` | `cp` / `--update` only | 2 |
| `src/scripts/cbam-algos/cbam-app.ts` | `isAttested`; `renderAttestation` | 3, 4 |
| `tests/unit/cbam-render.test.mjs` | pins | 3, 4 |

---

## Task 1: The engine says when the substituted default is a world average

**Files:**
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/estimate-from-pack.ts`
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/lib/cbam/certificate-estimate.ts`
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/mixed-tier.test.ts`

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git checkout main && git pull --ff-only
git checkout -b feat/mixed-edges
```

Baseline: **488 tests passing**, typecheck clean.

### Background

On a mixed line the **indirect** half comes from the Commission's published default, and that default can resolve to the `OTHER_ORIGIN` residual bucket — a world average rather than the origin's own value. Measured reachable on FR clinker route (A).

The defaults path detects this at `estimate-from-pack.ts:552`:

```ts
const originBasis = factor?.originCountry === OTHER_ORIGIN ? 'residual' as const : 'country' as const
```

and `RESIDUAL_BASIS_NOTE` fires on `originBasis === 'residual'` (`certificate-estimate.ts:205`).

**`originBasis` cannot carry the mixed case.** It names the basis of *a* figure; a mixed line has two, with different bases. Setting `'residual'` would claim the audited direct half rests on a world average, and would fire a note whose wording says exactly that.

- [ ] **Step 1: Confirm the baseline**

```bash
npm test 2>&1 | tail -3
npm run typecheck 2>&1 | tail -2
```
Expected: `Tests  488 passed (488)`, typecheck silent.

- [ ] **Step 2: Find a selector that proves it**

Locate a good/origin/route where a **mixed** line's indirect fallback resolves to `OTHER_ORIGIN`, and one where it resolves to the origin's own row. Report both, with the pack rows.

FR clinker route (A) was measured to be the first. **Verify it** rather than trusting me — and if it is not, find one that is and say so.

- [ ] **Step 3: Write the failing test**

In `lib/estimator/mixed-tier.test.ts` (read it first for its idiom), pin:

1. a mixed line whose indirect fallback came from the residual bucket carries the new note
2. a mixed line whose indirect fallback came from the origin's own row does **not**
3. a **fully-verified** line never carries it (no fallback happened)
4. a **defaults-path** line's existing `RESIDUAL_BASIS_NOTE` behaviour is unchanged — pin it explicitly, since these two notes are neighbours and confusing them is the obvious failure

Hand-type the note text; do not import it.

- [ ] **Step 4: Run to verify failure** — report verbatim.

- [ ] **Step 5: Add the constant**

In `lib/cbam/certificate-estimate.ts`, beside `RESIDUAL_BASIS_NOTE`:

```ts
export const MIXED_RESIDUAL_INDIRECT_NOTE =
  'The electricity default substituted on this line is the Commission\'s "Other Countries and ' +
  'Territories" residual — a world-average value, not your country\'s own. Your direct figure ' +
  'is unaffected: it is your own attested claim.'
```

**Verify every clause.** Is the substituted default really the residual? Is the direct half really unaffected? If either is wrong, say so and propose corrected wording rather than shipping a confident sentence that is false — that is the failure this entire run has been closing.

- [ ] **Step 6: Report it from the engine**

`indirectDefaultFigure(pack, input)` already resolves the row and is the single copy of the mark-up arithmetic. Extend it to report whether the row it used came from `OTHER_ORIGIN`, and have the verified path add the note when the fallback fired **and** the row was residual.

**Read `indirectDefaultFigure`'s current shape before choosing how.** It is shared with the defaults path — whatever you add must not change that path's behaviour, and the sweep in Task 5 will check.

- [ ] **Step 7: Verify + mutation-test**

```bash
npm test 2>&1 | tail -3
npm run typecheck 2>&1 | tail -2
```

| mutation | must fail |
|---|---|
| always add the note when the fallback fires | the origin's-own test |
| never add it | the residual test |
| add it on the fully-verified path too | test 3 |
| swap it for `RESIDUAL_BASIS_NOTE` | the hand-typed pin |

Diff against a pristine copy to prove each landed — a green mutation run is exactly what a failed mutation looks like. Restore precisely, confirm green.

- [ ] **Step 8: Commit** — stage by name; write the message yourself.

---

## Task 2: Re-vendor

- [ ] **Step 1: Establish which files moved**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM && git diff --name-only main..feat/mixed-edges -- lib/
```
Copy exactly those among the **11 vendored files** — check `scripts/cbam-sync-check.mjs`'s `FILES` array, which is the authority (`UPSTREAM.json` is generated from it). Test files are not vendored; confirm.

- [ ] **Step 2: Copy down and re-record**

```bash
cd /private/tmp/cbam-edges
# cp each changed vendored file
node scripts/cbam-sync-check.mjs --update
node scripts/cbam-sync-check.mjs
git diff --stat
```
Count must equal the files you copied plus `UPSTREAM.json`. `cmp` each against upstream — byte-identical, not "looks right".

- [ ] **Step 3: Gates + commit** — `npm run test:unit`, `astro check` delta-zero. This copy adds a note constant and a boolean; it should not break the site. If it does, report what and why.

---

## Task 3: One predicate, four sites

**Files:**
- Modify: `/private/tmp/cbam-edges/src/scripts/cbam-algos/cbam-app.ts`
- Modify: `/private/tmp/cbam-edges/tests/unit/cbam-render.test.mjs`

The pair `tier === 'actual-verified' || tier === 'verified-direct+default-indirect'` is written out at four sites — verified present at `:790` (`renderLineCard`), `:913` (`tierCell`), `:965` (`anyVerified`), and in `verifiedInputOf` (~`:1286`). Line numbers move; locate them.

- [ ] **Step 1: Write the failing tests**

Before extracting anything, pin the behaviour at **each of the four sites** for both verified-bearing tiers — the delta block, the audit document's reference, the §4 caveat, and `verifiedInputOf`'s object. Some may already be pinned; report which, and only add what is missing.

This matters: a shared predicate whose failure is visible at only one site is a shared bug. The tests must be able to tell the four apart.

- [ ] **Step 2: Extract**

```ts
/**
 * Does this line carry a figure the importer attested?
 *
 * ONE spelling, four call sites. Written out by hand at each of them, the pair was missed three
 * times while the third tier landed — two sites, then six, then seven, the last being run()'s
 * live preview. A predicate makes the next tier addition structural instead of a sweep.
 *
 * NOT used by renderAttestation, deliberately: its `switch` with a `never` default is a
 * COMPILE-TIME guarantee that a fourth tier must be handled, and it already caught exactly that.
 * Trading it for a boolean would be a downgrade.
 */
const isAttested = (tier: Line['tier']): boolean =>
  tier === 'actual-verified' || tier === 'verified-direct+default-indirect';
```

Adopt it at **all four** together. A predicate used at three of four is worse than none — two spellings, neither authoritative.

**Do not touch** `parseVerifiedFields` or `syncVerifiedRows`: both read the `<select>`'s value, a `string` that is never a `Line` and can never be the third tier.

- [ ] **Step 3: Mutation-test per site**

Break the predicate (`tier === 'actual-verified'` alone) and confirm a **named** test fails for each of the four. Report which test fails for which site. If one site has no test that dies, that site is unpinned — say so and add one.

- [ ] **Step 4: Gates + commit** — full suite, sync-check green, `astro check` delta-zero. Stage by name.

---

## Task 4: The two notes reach the card

**Files:**
- Modify: `/private/tmp/cbam-edges/src/scripts/cbam-algos/cbam-app.ts`
- Modify: `/private/tmp/cbam-edges/tests/unit/cbam-render.test.mjs`

### The refused-mixed defect

Measured at **5,542** selectors: a verified line whose refusal is raised *inside* `estimateCertificates`' catch carries the mixed tier. So a card with **no figure at all** prints `MIXED_NOTE`, which asserts its electricity component is a Commission default carrying the mark-up.

The distinction that resolves it:

- **`ATTESTED_NOTE` is about the input** — "these figures are your own attested claim". True whether or not the line priced. The refused *fully-verified* card correctly keeps it, and an existing test pins that as **wanted**.
- **`MIXED_NOTE` is about the output** — it asserts a substitution that only happened if a figure was produced.

`renderAttestation` currently reads:

```ts
export function renderAttestation(line: { tier: Line['tier']; verifiedRef?: string }): string {
```

Two callers: `~:800` (the line card) and `~:1711` (the live preview, `renderAttestation({ tier: e.stamp.tier, verifiedRef: v.ok.verifiedRef })`). **Both have the estimate in hand** — confirm that before designing the signature.

- [ ] **Step 1: Write the failing tests**

Pin, with hand-typed constants:

1. a **refused** mixed line prints an attested-only claim about its direct figure, and **not** the electricity clause
2. a **priced** mixed line still prints the full `MIXED_NOTE`
3. a **refused fully-verified** line prints `ATTESTED_NOTE` **unchanged** — this is existing wanted behaviour and must not regress
4. a `default+markup` line still prints nothing
5. the residual-indirect note from Task 1 surfaces on the card for a mixed line whose fallback was residual, and is absent when it was not

- [ ] **Step 2: Run to verify failure** — report verbatim.

- [ ] **Step 3: Give `renderAttestation` what it needs**

Add one input — whether the line produced a figure — and pick among the notes by `(tier, priced)`. Keep the `switch` and its `never` default.

Write the refused-mixed wording yourself. It must claim the direct figure as the importer's own and say nothing about an electricity component that is not on the card. **Do not let the attestation vanish** — an attested figure with no attestation beside it is the state this function's docblock exists to prevent.

Update both callers.

- [ ] **Step 4: Surface the residual note**

The engine now carries it in `notes`. Confirm how existing notes reach the card (`RESIDUAL_BASIS_NOTE` already does) and follow that path rather than inventing a second one.

- [ ] **Step 5: Mutation-test**

| mutation | must fail |
|---|---|
| ignore `priced`, always use `MIXED_NOTE` | test 1 |
| ignore `priced`, never use `MIXED_NOTE` | test 2 |
| return `''` for a refused mixed line | test 1 (it must not vanish) |
| drop the residual note from the card | test 5 |

Diff to prove each landed; restore; confirm green.

- [ ] **Step 6: Gates + commit** — full suite, sync-check, `astro check` delta-zero. Stage by name.

---

## Task 5: Measure

**Files:** none. Change no source file; commit nothing.

- [ ] **Step 1: No figure moved, anywhere**

Sweep old engine vs new across a broad selector set, **all three tiers** (defaults, fully verified, mixed) and both scopes. Every figure field must be byte-identical — `costEur`, `certificates`, `emissionsTco2e`, `indirectTco2e`, `netTco2e`, `faaTco2e`.

Diff **whole serialised result objects**. The only field permitted to differ is `notes`. Report counts, and report exactly which selectors gained a note.

- [ ] **Step 2: The note fires where it should and nowhere else**

Count selectors gaining the residual-indirect note. Confirm every one is a mixed line whose indirect fallback resolved to `OTHER_ORIGIN`, and that no fully-verified or defaults-path line gained it.

Confirm `RESIDUAL_BASIS_NOTE`'s own population is **unchanged** — the two notes are neighbours and the obvious failure is one bleeding into the other.

- [ ] **Step 3: The parity fixture**

The generator passes no `verified` input, so the fixture should not move. Regenerate and confirm the diff is empty. If it moves, **stop and report**.

- [ ] **Step 4: Clean up** and confirm both repos clean.

---

## Task 6: Land it

- [ ] **Step 1: CBM first**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npm test 2>&1 | tail -3
git update-index --refresh >/dev/null 2>&1; git checkout main && git merge --ff-only feat/mixed-edges
npm test 2>&1 | tail -3
git push origin main
```
The `update-index --refresh` shares the invocation deliberately — this volume is exFAT and `checkout` otherwise reports phantom local changes. **Never `git reset --hard`.**

- [ ] **Step 2: Website**

```bash
cd /private/tmp/cbam-edges
git fetch origin --quiet
git merge origin/main --no-edit
npm run test:unit && node scripts/cbam-sync-check.mjs
git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
```

- [ ] **Step 3: Verify the deploy**

Poll `https://deltaclimate.earth/cbam/cbam-calculator/` with `Cache-Control: no-cache` **and a delay between attempts** — a tight loop just re-reads one cached build. Confirm a bundle hash different from `C5evA226`, HTTP 200 on the bundle before grepping, and look for the new note text and the refused-mixed wording. The minifier renames identifiers and emits backtick template literals — grep for strings, not names.

- [ ] **Step 4: Clean up**

```bash
rm /private/tmp/cbam-edges/node_modules          # the SYMLINK only
cd /Volumes/VSTSAMPLES/Projects/Angad
git worktree remove /private/tmp/cbam-edges --force
git worktree prune
git branch -D fix/cbam-mixed-edges 2>/dev/null
cd /Volumes/VSTSAMPLES/Projects/CBM && git branch -d feat/mixed-edges
```

---

## Self-review

**Spec coverage.** `isAttested` at four sites, `renderAttestation`'s switch left alone → Task 3. Refused-mixed note by `(tier, priced)` → Task 4. Residual-indirect note as a *new* note rather than an `originBasis` flip → Task 1. Both excluded sites named → Task 3 Step 2. No figure moves → Task 5 Step 1. The two notes not bleeding into each other → Task 1 Step 3 item 4 and Task 5 Step 2.

**Placeholders.** None — every step carries its code or its exact command. Three steps deliberately ask the implementer to look rather than trust: which selector is genuinely residual (Task 1 Step 2), `indirectDefaultFigure`'s current shape (Task 1 Step 6), and whether both `renderAttestation` callers hold the estimate (Task 4). Each is a genuine unknown where guessing is worse.

**Type consistency.** `isAttested(tier: Line['tier']): boolean` is defined in Task 3 Step 2 and used at four sites in the same step. `MIXED_RESIDUAL_INDIRECT_NOTE` is defined in Task 1 Step 5, hand-typed into tests in Step 3, and surfaced in Task 4 Step 4.

**One risk worth naming.** Task 4 changes a function signature with two callers, one of which is the live preview — the surface that was missed when the mixed tier landed. Both callers must move in the same commit, and Task 4 Step 1's test 1 must be written so it fails if only the card is updated.
