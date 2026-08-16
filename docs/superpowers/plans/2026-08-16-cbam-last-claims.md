# The Last Claims Defects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the four remaining places where the calculator states something it cannot support — two live, two latent.

**Architecture:** Every fix mirrors a correct solution already sitting beside it in the same file. Two are engine changes sharing one re-vendor; two are website. **No figure may change.**

**Tech Stack:** TypeScript, vitest (CBM), `node:test` + `tsx` (website), Astro.

**Spec:** `docs/superpowers/specs/2026-08-16-cbam-last-claims-design.md`

---

## Standing constraints — read before every task

- **Never hand-edit anything under `src/scripts/cbam-algos/` except `cbam-app.ts`.** Vendored byte-for-byte from `CBM/lib/`, hash-guarded against `UPSTREAM.json` (11 files). Changes arrive only by `cp`.
- **Never `git add -A` or `git add .`** — in a worktree `node_modules` is a *symlink* and `.gitignore`'s trailing-slash pattern misses it.
- **Never run `npm ci`/`npm install`** in the website worktree — `node_modules` symlinks into a shared checkout another agent owns.
- `npx astro check` reports **2 pre-existing errors** (`mapillary-js` in `street-view-panel.ts`). Measure the baseline yourself; confirm delta-zero; do not fix them.
- `npm run test:unit` runs `cbam-sync-check` against the **live CBM checkout**. While CBM is ahead of what the website has vendored it reports DRIFT and bails — use the raw runner (`node --import tsx --test <file>`) for a baseline in that window.
- **NO FIGURE MAY CHANGE.** Only `notes` and refusal `reason` strings may move. If a `costEur`, `certificates`, `indirectTco2e` or `emissionsTco2e` moves anywhere, stop and report.
- **Use a fresh filename for every probe script.** A task in this run hit `tsx` serving a stale transpile from a reused scratchpad filename — its probe printed an earlier task's output from a file it had already overwritten, and the trigger was never characterised. Corroborate measurements with something other than printed output alone.
- **Every drafted sentence and expectation below is a claim to verify, not copy.** Many of mine across this run were false, including inside corrections. Argue with evidence rather than complying.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `CBM/lib/cbam/certificate-estimate.ts` | the residual note's gate; two new reasons | 1 |
| `CBM/lib/estimator/*.test.ts` | engine pins | 1 |
| website vendored copies + `UPSTREAM.json` | `cp` / `--update` only | 2 |
| `src/scripts/cbam-algos/cbam-app.ts` | sector lookup; the `priced` signature | 3 |
| `tests/unit/cbam-render.test.mjs` | website pins | 3 |

---

## Task 1: Two engine fixes, two commits

**Files:**
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/lib/cbam/certificate-estimate.ts`
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/` test files

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git checkout main && git pull --ff-only
git checkout -b fix/last-claims
```

Baseline: **496 tests passing**, typecheck clean. Confirm before touching anything.

**Two commits, not one** — they are independent defects and must stay bisectable.

### 1a — the residual note survives a refusal (LIVE)

`certificate-estimate.ts:237`, inside `baseOf`:

```ts
notes: input.originBasis === 'residual' ? [RESIDUAL_BASIS_NOTE] : [],
```

`baseOf` runs on **every** arm including `'unavailable'`, so a refused defaults-path line renders *"…so **this figure** uses its 'Other Countries and Territories' residual default…"* over a card with no figure.

Its sibling had this defect and was moved out of `baseOf` into the priced branch (~`:414`). **The comment directly above the line you are changing was written for you** — it states that all refusals raised outside the module compute `originBasis` as `'country'`, and ends *"Whoever fixes it can use exactly the gate below."* Read it, and **verify its claim** rather than trusting it.

Nothing replaces the note: on a defaults line the importer attested nothing, so there is no input-claim to preserve.

- [ ] **Step 1: Reproduce it.** Find a refused defaults-path line from an unlisted origin and render or dump its notes. Report it verbatim. **If you cannot reproduce it, stop and report** — the fix would then be wrong.
- [ ] **Step 2: Write the failing tests** — a refused residual defaults line carries no note; a **priced** one still does. Both arms, or the fix can go vacuous either way. Follow the existing residual-note tests' idiom; hand-type the constant.
- [ ] **Step 3: Run to verify failure** — report verbatim.
- [ ] **Step 4: Move the gate**, mirroring the sibling's placement so a priced line's notes stay **byte-identical** in order and content.
- [ ] **Step 5: Mutation-test** — remove the gate (refused test must fail); invert it to suppress on priced lines (priced test must fail). Diff against a pristine copy to prove each landed; restore; confirm green.
- [ ] **Step 6: Commit** — stage by name, message your own.

### 1b — `cbam-factor/` and `cscf/` are told a benchmark is missing (LATENT)

The dispatch at ~`:509`:

```ts
        reason: error.code === 'REGULATION_AMBIGUOUS'
          ? AMBIGUOUS_REASON
          : selector?.startsWith('certificate-price/') ? NO_PRICE_REASON
          : selector?.startsWith('quarter/') ? BAD_DATE_REASON
          : NO_BENCHMARK_REASON,
```

The fallback serves `benchmark/`, `sefa/`, `cbam-factor/${year}` and `cscf/${year}`. For the last two the missing thing is a CBAM factor or a cross-sectoral correction factor.

**Measured 0 reachable** on today's pack — `cbam-factor` covers 2026–2034, `cscf` 2026–2030. **Verify that is still true** and report the counts. It becomes reachable the moment the pack's coverage lags its dates, which is exactly what happened to prices.

- [ ] **Step 1: Write the failing tests.** Since neither arm is reachable on the shipped pack, **the pin must construct the condition** — a hand-built `FreeAllocationTables` missing the row, following `lib/cbam/certificate-estimate.test.ts`'s existing fixture idiom. Say explicitly that you constructed rather than swept: an unreachable arm is exactly where a vacuous test hides.
- [ ] **Step 2: Run to verify failure** — report verbatim.
- [ ] **Step 3: Add two reasons and two arms.** Draft the wording yourself, following the house idiom: name the gap, name the harm of guessing, and make each read differently from `NO_BENCHMARK_REASON`, `NO_PRICE_REASON`, `BAD_DATE_REASON` and `AMBIGUOUS_REASON`. **Verify every clause** — do not ship a confident sentence you have not checked.

  **`sefa/` stays on the fallback.** It names a scope problem in the free-allocation formula, for which `NO_BENCHMARK_REASON`'s wording is defensible. Leave a comment saying so, or a reader will wonder why three of four were split.
- [ ] **Step 4: Mutation-test** — force each new arm false, then true; confirm the *named* test fails each time. Watch for arm-ordering making a prediction unsatisfiable, as happened earlier in this run; if one cannot fail as described, say so and explain what does kill it.
- [ ] **Step 5: Gates + commit** — `npm test`, `npm run typecheck`, stage by name.

---

## Task 2: Re-vendor

- [ ] **Step 1: Establish which files moved**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM && git diff --name-only main..fix/last-claims -- lib/
```
Copy exactly those among the **11 vendored files** — check `scripts/cbam-sync-check.mjs`'s `FILES` array, which is the authority (`UPSTREAM.json` is generated from it). Test files are not vendored; confirm rather than assume.

- [ ] **Step 2: Copy down and re-record**

```bash
cd /private/tmp/cbam-claims
# cp each changed vendored file
node scripts/cbam-sync-check.mjs --update
node scripts/cbam-sync-check.mjs
git diff --stat
```
Count must equal the files copied plus `UPSTREAM.json`. `cmp` each against upstream — byte-identical, not "looks right".

- [ ] **Step 3: Gates + commit.** Baseline **417 unit tests**, `astro check` at 2.

  **Note this copy ships a user-visible change**, as the equivalent did last batch: `renderStamp` emits `stamp.notes` verbatim, so removing the note from refused cards is immediately live. Do not file it as inert.

---

## Task 3: Two website fixes, two commits

**Files:**
- Modify: `/private/tmp/cbam-claims/src/scripts/cbam-algos/cbam-app.ts`
- Modify: `/private/tmp/cbam-claims/tests/unit/cbam-render.test.mjs`

### 3a — the two cards disagree on a sector's name (LIVE)

`renderThreshold` renders `t.sector.replace(/_/g, ' ')` at ~`:238` and ~`:245`, printing **"iron and steel"**; the multi-line card prints **"iron & steel"** from `SECTOR_PROSE` (~`:266`). Both ship today.

`SECTOR_PROSE` is `[['cement','cement'], ['iron_and_steel','iron & steel'], ['aluminium','aluminium'], ['fertilisers','fertiliser']]` — confirmed present. The file's own comment at ~`:258` already says the shortcut *"is wrong on two of the four"*.

- [ ] **Step 1: Write the failing tests** — the card renders "iron & steel" for `iron_and_steel`; **and** renders "cement" unchanged for `cement`. Both, so a lookup that silently changed everything would fail.
- [ ] **Step 2: Run to verify failure** — report verbatim.
- [ ] **Step 3: Use the existing table.** `SECTOR_PROSE` is ordered and the multi-line renderer filters it; a single-key lookup is a filter over one element. **Read the existing renderer before choosing** — reusing it with a one-element array may or may not produce the right string, depending on how it joins. Verify.

  An unknown key must render **as itself**, matching the convention the multi-line card established: a raw key reads as a datum and prompts a table entry; a prettified one reads as reviewed copy and ships a name nobody chose.
- [ ] **Step 4: Confirm only the intended keys moved.** Render the card for all four sectors before and after; `cement` and `aluminium` must be byte-identical. Report the evidence.
- [ ] **Step 5: Commit** — stage by name.

### 3b — `renderAttestation`'s `priced` footgun (LATENT)

The parameter is required in TypeScript, but the function is **exported**. A one-argument JavaScript call makes `priced` `undefined` → falsy → a **priced** mixed line renders the *refused* wording, claiming no figure was produced. Compile-guarded and both call sites are source-text pinned, so not live — but silent and **under-claiming**.

- [ ] **Step 1: Reproduce it** — call it with one argument from a `.mjs` test and show the wrong branch. If you cannot, say so and stop.
- [ ] **Step 2: Make the wrong call impossible or loud.** Options include an explicit runtime check, or taking the estimate itself rather than a boolean derived from it — the latter also removes the chance of a caller computing `priced` differently from `hasFigure`'s definition.

  **The choice is yours; the requirement is that a one-argument call cannot silently produce the under-claiming branch.** Justify what you picked.
- [ ] **Step 3: Pin it** — a test that fails if the footgun returns.
- [ ] **Step 4: Gates + commit** — full suite, sync-check green (confirm `git diff --stat -- src/scripts/cbam-algos/` lists `cbam-app.ts` alone), `astro check` at 2.

---

## Task 4: Measure

**Files:** none. Change no source file; commit nothing.

- [ ] **Step 1: `origin/main` → HEAD as one hop.** Build the pre-branch tree with `git archive` into a scratch dir. Sweep a broad selector set, all three tiers, both scopes, priced and refused.

  Diff **whole serialised result objects**. Report probe count, differing count, and **every field that moved by name**. Only `notes` and refusal `reason` strings may move. **A figure moving is the headline.**

- [ ] **Step 2: The two live fixes, bounded.** Confirm the residual note now appears **iff** the line is residual **and** priced — both directions, with counts. Confirm the sector rendering moved for `iron_and_steel` and `fertilisers` and **not** for `cement` or `aluminium`.

- [ ] **Step 3: The two latent fixes.** Confirm `cbam-factor/` and `cscf/` are still 0-reachable on the shipped pack, so the new reasons change nothing a user sees today — and say what would make them reachable.

- [ ] **Step 4: Clean up** — remove scratch dirs, confirm both repos clean.

---

## Task 5: Land it

- [ ] **Step 1: CBM first**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npm test 2>&1 | tail -3
git update-index --refresh >/dev/null 2>&1; git checkout main && git merge --ff-only fix/last-claims
npm test 2>&1 | tail -3
git push origin main
```
The `update-index --refresh` shares the invocation deliberately — this volume is exFAT and `checkout` otherwise reports phantom local changes. **Never `git reset --hard`.**

- [ ] **Step 2: Website**

```bash
cd /private/tmp/cbam-claims
git fetch origin --quiet
git merge origin/main --no-edit
npm run test:unit && node scripts/cbam-sync-check.mjs
git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
```

- [ ] **Step 3: Verify the deploy.** Poll with `Cache-Control: no-cache` **and a delay between attempts** — a tight loop re-reads one cached build. Confirm a bundle hash different from `CavfyjVv`, HTTP 200 before grepping, and look for "iron & steel" in the single-line card's context and the two new reason strings. The minifier renames identifiers and emits backtick template literals — grep for strings, not names.

- [ ] **Step 4: Clean up**

```bash
rm /private/tmp/cbam-claims/node_modules          # the SYMLINK only
cd /Volumes/VSTSAMPLES/Projects/Angad
git worktree remove /private/tmp/cbam-claims --force
git worktree prune
git branch -D fix/cbam-last-claims 2>/dev/null
cd /Volumes/VSTSAMPLES/Projects/CBM && git branch -d fix/last-claims
```

---

## Self-review

**Spec coverage.** Residual note gate → Task 1a. Two new reasons, `sefa/` staying → Task 1b. Sector lookup with the unknown-key convention → Task 3a. The `priced` footgun → Task 3b. No figure moves → Task 4 Step 1. Both-arms pinning → 1a Step 2 and 4 Step 2. Constructed rather than swept pins for the unreachable arms → 1b Step 1.

**Placeholders.** None — every step carries its code or its exact command. Four steps deliberately ask the implementer to look rather than trust: whether the sibling comment's claim holds (1a Step 1), whether the arms are still 0-reachable (1b), how `SECTOR_PROSE`'s renderer joins (3a Step 3), and which fix shape closes the footgun (3b Step 2).

**Type consistency.** The two new reason constants are defined and consumed only in Task 1b. `SECTOR_PROSE` keeps its existing shape; Task 3a adds a lookup, not a new table.

**One risk worth naming.** Task 3b changes an exported signature whose two call sites are pinned by *source text* rather than behaviour, because one is DOM-locked. If the fix changes the call shape, those pins must move with it — and a pin that was updated to match a broken call is worse than no pin. Task 3b Step 3 must assert the behaviour, not merely that the text matches.
