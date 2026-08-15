# Batch A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close five known defects whose fixes need no new design — a second mis-naming catch site on a production path, `quarter/` naming the wrong gap, a §4 pin that admits an added caveat, a de-minimis verdict hardcoding four sectors, and a parity fixture stale three ways.

**Architecture:** Each fix uses a technique already proven in this codebase. The golden fixture is regenerated **last**, so one reviewed diff captures every behaviour change from this batch and everything before it.

**Tech Stack:** TypeScript, vitest (CBM), `node:test` + `tsx` (website), Astro.

**Spec:** `docs/superpowers/specs/2026-08-16-cbam-batch-a-design.md`

---

## Standing constraints — read before every task

- **Never hand-edit anything under `src/scripts/cbam-algos/` except `cbam-app.ts`.** Vendored byte-for-byte from `CBM/lib/`, hash-guarded by `scripts/cbam-sync-check.mjs` against `UPSTREAM.json`. Changes arrive only by `cp`. `cbam-app.ts` is the sole documented exception. `src/scripts/cbam-lines.ts` is **ours** and freely editable.
- **Never `git add -A` or `git add .`.** In a worktree `node_modules` is a *symlink* and `.gitignore`'s trailing-slash pattern misses it.
- **Never run `npm ci`/`npm install` in the website worktree** — `node_modules` symlinks into a shared checkout another agent owns.
- `npx astro check` reports **2 pre-existing errors** (`mapillary-js` in `street-view-panel.ts`). Production is unaffected. Measure the baseline yourself; confirm delta-zero; do not fix them.
- `npm run test:unit` runs `cbam-sync-check` first against the **live CBM checkout**. If CBM sits on a branch the website hasn't vendored yet it reports DRIFT and bails before any test runs — use the raw runner (`node --import tsx --test <file>`) to measure a baseline in that window.
- **No figure may change** except in the regenerated fixture (Task 6), where the changes are the point and must be accounted for one by one.
- User-facing strings are pinned by **hand-typed constants in tests**, never imported.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `CBM/api/services/certificate-estimate.ts` | two new reasons + local dispatch (prod path) | 1 |
| `CBM/lib/cbam/certificate-estimate.ts` | `BAD_DATE_REASON` + `quarter/` branch | 2 |
| `CBM/lib/estimator/refusal-reason.test.ts` | extends the existing dispatch pins | 2 |
| `Angad/src/scripts/cbam-algos/**` + `UPSTREAM.json` | vendored copy (`cp`/`--update` only) | 3 |
| `Angad/tests/unit/cbam-render.test.mjs` | §4 containment pin | 4 |
| `Angad/src/scripts/cbam-lines.ts` | `includedSectors` on `YearThreshold` | 5 |
| `Angad/src/scripts/cbam-algos/cbam-app.ts` | render sectors from the rule | 5 |
| `Angad/tests/fixtures/cbam-golden.json` | regenerated, reviewed | 6 |

---

## Task 1: The production catch site names what it caught

**Files:**
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/api/services/certificate-estimate.ts`
- Test: find the right home — see Step 2

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git checkout main && git pull --ff-only
git checkout -b fix/batch-a
```

Baseline: **463 tests passing**, typecheck clean.

### Background

`api/services/certificate-estimate.ts:116-128`:

```ts
  try {
    const scope = benchmarkScopeOf(basis)
    const precursors = scope === 'process_only' ? await loadPrecursors(tx, basis) : []
    return estimateCertificates(input(scope, precursors), tables)
  } catch (error) {
    if (isDomainError(error) && error.code === 'REGULATION_NOT_FOUND') {
      return unavailableEstimate(
        input('full_product', []), tables, NO_BENCHMARK_REASON,
        typeof error.details.selector === 'string' ? error.details.selector : null,
      )
    }
    throw error
  }
```

Its own comment names both things it catches — *"an old snapshot with no frozen scope, or a precursor the rules do not price"* — and neither is a benchmark. This is the same class as the `lib/` fix, but a **different site with different selectors**, and it serves the SaaS.

The two selectors:

| selector | thrown at | meaning |
|---|---|---|
| `verified-actual-snapshot-without-intensity-scope` | `:174` | **no namespace prefix** — a `startsWith` dispatch cannot reach it |
| `precursor/${cnCodeVersionId}/${defaultFactorVersionId}` | `:202` | a precursor with no published value |

`NO_BENCHMARK_REASON` is already imported at `:7` from `../../lib/cbam/certificate-estimate`.

- [ ] **Step 1: Confirm the baseline**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npm test 2>&1 | tail -3
npm run typecheck 2>&1 | tail -2
```
Expected: `Tests  463 passed (463)`, typecheck silent.

- [ ] **Step 2: Find where this service is tested**

`api/services/` has `approve-case.test.ts`, `calculate-case.test.ts`, `certificate-estimate.rls.test.ts`, `evidence-pack.test.ts`. **Read them first** and report which is the right home — or whether a new file is (`lib/estimator/refusal-reason.test.ts` set that precedent for the `lib/` fix).

These tests may need a database. If reaching this catch requires DB fixtures you cannot stand up, **say so plainly** and pin what is reachable — e.g. extract the dispatch into a small exported pure function and test that directly. Do not invent a harness, and do not skip the proof silently.

- [ ] **Step 3: Write the failing test**

Pin, with hand-typed constants:

- a snapshot-scope failure reports the snapshot reason, not the benchmark reason
- a precursor failure reports the precursor reason
- the two are different strings, and both differ from `NO_BENCHMARK_REASON`
- the `selector` still travels unchanged (it is the only locator a support engineer has)

- [ ] **Step 4: Run to verify failure**

Report verbatim.

- [ ] **Step 5: Add the constants**

In `lib/cbam/certificate-estimate.ts`, beside its siblings, so all refusal prose lives in one place:

```ts
export const NO_SNAPSHOT_SCOPE_REASON =
  'This case\'s frozen snapshot predates the intensity-scope field, so the rules cannot tell ' +
  'whether the figure covers the whole product or the process only, and no figure is shown. ' +
  'The two are priced against different benchmark columns, so guessing the scope would pick ' +
  'a benchmark the importer never declared.'

export const NO_PRECURSOR_REASON =
  'One of this good\'s precursors has no published default value for its own good, origin, ' +
  'production route or year, so no figure is shown. Pricing that precursor at zero would ' +
  'understate the embedded emissions without saying so.'
```

- [ ] **Step 6: Dispatch at the catch site**

```ts
  } catch (error) {
    if (isDomainError(error) && error.code === 'REGULATION_NOT_FOUND') {
      const selector = typeof error.details.selector === 'string' ? error.details.selector : null
      // NAME WHAT ACTUALLY FAILED. This block used to answer NO_BENCHMARK_REASON for both of the
      // failures the comment above describes, neither of which is a benchmark: a snapshot with
      // no frozen intensity scope, and a precursor the rules do not price. Note the first
      // selector carries NO namespace prefix, so the startsWith dispatch used in lib/ cannot
      // reach it — these are matched exactly and by prefix respectively.
      const reason = selector === 'verified-actual-snapshot-without-intensity-scope'
        ? NO_SNAPSHOT_SCOPE_REASON
        : selector?.startsWith('precursor/') ? NO_PRECURSOR_REASON : NO_BENCHMARK_REASON
      return unavailableEstimate(input('full_product', []), tables, reason, selector)
    }
    throw error
  }
```

Add both constants to the import at `:7`.

- [ ] **Step 7: Verify and mutation-test**

```bash
npm test 2>&1 | tail -3
npm run typecheck 2>&1 | tail -2
```

| mutation | must fail |
|---|---|
| snapshot arm → `NO_BENCHMARK_REASON` | the snapshot test |
| precursor arm → `NO_BENCHMARK_REASON` | the precursor test |
| `startsWith('precursor/')` → always `true` | the snapshot test (it must not be swallowed) |

Restore precisely after each; confirm green.

- [ ] **Step 8: Commit**

```bash
git add api/services/certificate-estimate.ts lib/cbam/certificate-estimate.ts <your test file>
git commit -m "fix(cbam): the prod catch site names what it caught

api/services hardcoded NO_BENCHMARK_REASON for both failures its own comment
describes — a snapshot with no frozen intensity scope, and a precursor the
rules do not price. Neither is a benchmark. Same class as the lib/ fix, but a
different site: one of its selectors carries no namespace prefix at all, so the
startsWith dispatch could not reach it."
```

---

## Task 2: `quarter/` names the date, not a rule

**Files:**
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/lib/cbam/certificate-estimate.ts`
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/refusal-reason.test.ts`

`quarterOf` (`lib/cbam/resolve-fa.ts:160-169`) throws with selector `quarter/${date}` when the year is not four digits or the month is outside 1–12. The gap is an **unreadable import date**.

Reachable through `estimateFromPack` (a valid year with an out-of-range month clears the year gate and dies in `quarterOf`) — measured at 49 hits. Not reachable through the site's `<input type="date">`.

- [ ] **Step 1: Write the failing test**

Extend the existing `describe` in `lib/estimator/refusal-reason.test.ts` — read it first; it already holds `PRICE_TEXT` and `BENCHMARK_TEXT` as hand-typed constants and an agreement sweep. Add `DATE_TEXT` in the same style, and:

- a date like `2027-13-15` refuses with selector matching `^quarter/` and reports `DATE_TEXT`
- **extend the existing agreement sweep** to cover the new branch, so a dispatch hard-wired to any one reason is caught. The sweep already learned this lesson once: a corpus that only exercises one branch cannot detect a hard-wired `true`.

- [ ] **Step 2: Run to verify failure** — report verbatim.

- [ ] **Step 3: Add the constant and the branch**

```ts
export const BAD_DATE_REASON =
  'The import date is not a readable calendar date, so the quarter it falls in cannot be ' +
  'determined and no figure is shown. The CBAM certificate price is published per quarter, ' +
  'so without a readable date there is no price to apply.'
```

**This text was corrected before you received it, and you should still verify it.** The first draft said *"Every figure here is quarter-specific — the certificate price and the benchmark in force both depend on it."* That is false about the benchmark: `quarterOf` is called in exactly one place (`lib/cbam/certificate-estimate.ts:299`, the price lookup), while `resolveBenchmark` matches on `active(row.validFrom, row.validTo, selector.date)` — the **day**, not the quarter.

Task 1 found that **both** of the reason texts drafted for it were false, one with the direction of harm inverted. Treat every drafted sentence in this plan as a claim to check against the code, not as copy to paste. If this one is still wrong, say so with evidence and propose better wording.

and extend the dispatch added in the previous batch:

```ts
        reason: error.code === 'REGULATION_AMBIGUOUS'
          ? AMBIGUOUS_REASON
          : selector?.startsWith('certificate-price/') ? NO_PRICE_REASON
          : selector?.startsWith('quarter/') ? BAD_DATE_REASON
          : NO_BENCHMARK_REASON,
```

Check the current shape of that expression before editing — it may have moved.

- [ ] **Step 4: Verify** — `npm test`, `npm run typecheck`.

- [ ] **Step 5: Mutation-test** — force the `quarter/` arm false (the date test must fail) and force it true (the agreement sweep must fail). Restore, confirm green.

- [ ] **Step 6: Commit**

```bash
git add lib/cbam/certificate-estimate.ts lib/estimator/refusal-reason.test.ts
git commit -m "fix(cbam): an unreadable date says so, instead of blaming a benchmark

quarterOf throws when the month is outside 1-12; the gap is the import date,
not a missing rule. Reachable through estimateFromPack, not through the site's
date input."
```

---

## Task 2b: The month guard has a NaN hole

**Files:**
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/lib/cbam/resolve-fa.ts` (`quarterOf`)
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/refusal-reason.test.ts`

**Found by Task 2, and Task 2 makes it worse.** `quarterOf`'s guard misses a single-digit month:

```
"2027-1-15"   slice(5,7)="1-"   Number=NaN   guard fires: FALSE
"2027-13-15"  slice(5,7)="13"   Number=13    guard fires: true
```

`NaN < 1 || NaN > 12` is `false || false`. So the function returns the string `2027-QNaN`, `resolveCertificatePrice` finds no such row, and the refusal surfaces as selector `certificate-price/2027-QNaN` — which after Task 2 reports `NO_PRICE_REASON`:

> The good and its benchmark are present — only the price is missing, and prices are published quarterly in arrears.

Every clause of that is false for an unreadable date. And because Task 2 just made the `quarter/` sibling correct, this one now reads **more** authoritatively wrong by contrast — a confidently-worded message sitting beside a correct one.

This is a behaviour change, not words only: an input moves from the `certificate-price/` namespace to `quarter/`. That is why it is its own task.

- [ ] **Step 1: Write the failing test**

In `lib/estimator/refusal-reason.test.ts`, assert `2027-1-15` refuses with a selector matching `^quarter/` and reports `BAD_DATE_REASON` — the same treatment `2027-13-15` already gets. Add it to the agreement sweep too.

- [ ] **Step 2: Run to verify failure** — expect the selector assertion to fail with `certificate-price/2027-QNaN`. Report verbatim.

- [ ] **Step 3: Close the hole — narrowly**

```ts
  if (!/^\d{4}$/.test(year) || !Number.isInteger(month) || month < 1 || month > 12) {
```

**`Number.isInteger`, not a stricter whole-date regex.** A regex like `/^\d{4}-\d{2}-\d{2}$/` would also reject an ISO timestamp (`2026-01-01T00:00:00.000Z`), and the validity-boundary work established that callers may pass either shape — `active()` was deliberately made to accept both. `'2026-01-01T00:00:00.000Z'.slice(5,7)` is `'01'`, which must keep working.

**Verify that claim before relying on it**: confirm a timestamp-shaped date still resolves after your change, and say how you checked.

- [ ] **Step 4: Measure what moved**

This changes which namespace an input lands in. Sweep and report: which inputs move from `certificate-price/` to `quarter/`, and confirm **nothing legitimate moves** — only dates with a malformed month component. In particular confirm no well-formed date, plain or timestamp, changes its outcome.

- [ ] **Step 5: Mutation-test**

Revert `Number.isInteger(month) ||` alone and confirm the new test fails. Diff against a pristine copy to prove the mutation landed.

- [ ] **Step 6: Gates + commit** — `npm test`, `npm run typecheck`, stage by name.

---

## Task 3: Re-vendor

**Files:**
- Modify: `/private/tmp/cbam-batch-a/src/scripts/cbam-algos/cbam/certificate-estimate.ts` (via `cp`)
- Modify: `/private/tmp/cbam-batch-a/src/scripts/cbam-algos/UPSTREAM.json` (via `--update`)
- Modify: `/private/tmp/cbam-batch-a/tests/unit/cbam-render.test.mjs`

Worktree `/private/tmp/cbam-batch-a`, branch `fix/cbam-batch-a`, based on `origin/main`, `node_modules` symlinked. Baseline **396 unit tests**.

Only `lib/cbam/certificate-estimate.ts` moved (Task 1 touched `api/`, which is not vendored — confirm that).

- [ ] **Step 1: Copy down and re-record**

```bash
cd /private/tmp/cbam-batch-a
cp /Volumes/VSTSAMPLES/Projects/CBM/lib/cbam/certificate-estimate.ts src/scripts/cbam-algos/cbam/certificate-estimate.ts
node scripts/cbam-sync-check.mjs --update
node scripts/cbam-sync-check.mjs
git diff --stat
```
Exactly two files. More means something else drifted — stop and report.

- [ ] **Step 2: Pin the new reason website-side**

Append to `tests/unit/cbam-render.test.mjs`, reusing its existing `estimateFromPack` import and `pack` load:

```js
test('an unreadable import date says so, and does not blame a benchmark', () => {
  // quarterOf throws when the month is outside 1-12. Not reachable through <input type="date">,
  // but the engine is shared with a SaaS whose form is not this one.
  const e = estimateFromPack(pack, {
    cn: '25231000', country: 'DZ', route: '(A)', massT: '100', date: '2027-13-15',
    emissionsScope: 'direct_and_indirect',
  });
  assert.equal(e.status, 'unavailable');
  assert.match(e.selector, /^quarter\//);
  assert.match(e.reason, /not a readable calendar date/i);
  assert.doesNotMatch(e.reason, /free-allocation benchmark/i);
});
```

Verify that input really produces that selector before trusting it.

- [ ] **Step 3: Prove it depends on the new engine**

```bash
git stash push src/scripts/cbam-algos/cbam/certificate-estimate.ts
node --import tsx --test tests/unit/cbam-render.test.mjs 2>&1 | tail -10
git stash pop
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
FAIL while stashed, PASS after. Report both verbatim.

- [ ] **Step 4: Gates + commit**

`npm run test:unit` (397), `node scripts/cbam-sync-check.mjs` green, `npx astro check` delta zero. Stage by name; commit.

---

## Task 4: The §4 pin refuses an added caveat

**Files:**
- Modify: `/private/tmp/cbam-batch-a/tests/unit/cbam-render.test.mjs`

### Background

The file pins each caveat with `assert.ok(html.includes(CAVEAT_X))` plus an order check (~line 1462):

```js
  const order = [CAVEAT_CSCF, CAVEAT_ARTICLE_9, CAVEAT_COMPLETENESS, CAVEAT_FINGERPRINT,
    CAVEAT_VERIFIED].map((c) => html.indexOf(c));
  assert.ok(order.every((i) => i >= 0), 'all five caveats must be present, each exactly as pinned');
  assert.deepEqual(order, [...order].sort((a, b) => a - b), …);
```

That catches an **edit** to any caveat, and a **reorder**. It does not catch an **addition**: a sixth `<li>` contradicting the others leaves every `includes()` true and the order intact.

§4 renders as `<h2>4 · What this does not tell you</h2>` followed by a `<ul>` (`cbam-app.ts:869`).

- [ ] **Step 1: Prove the hole exists**

Add a contradicting `<li>` to §4 in `cbam-app.ts` — e.g. `<li>In practice the Registry accepts these figures as filed, so the caveats above rarely bite.</li>` — and run the suite. **Expected: green.** Report that, then remove it. This is the evidence the new assertion is needed; do not skip it.

- [ ] **Step 2: Write the failing assertion**

Extract §4's `<ul>` from the rendered HTML — between the `<h2>4 · …` heading and that block's closing `</ul>` — and assert its `<li>` items are **exactly** the pinned caveats: same set, same order, nothing else.

Locate the boundaries from the rendered output rather than assuming; if the closing tag is ambiguous, say so and pin the tightest unambiguous form you can, explaining the limit.

Keep every existing per-caveat assertion. This adds containment; it does not replace them.

- [ ] **Step 3: Prove it now fails**

Re-add the same contradicting `<li>`. Expected: **FAIL**, naming the extra item. Remove it; confirm green. Report both verbatim.

- [ ] **Step 4: Confirm the honest cases still pass**

The verified caveat joins §4 only on the verified tier, so the block legitimately has two shapes — four caveats and five. Both must pass. If your assertion only accommodates one, it will fail the next honest change; check both paths.

- [ ] **Step 5: Gates + commit** — `npm run test:unit`, `astro check` delta zero. Stage by name.

---

## Task 5: The verdict names the sectors the rule covers

**Files:**
- Modify: `/private/tmp/cbam-batch-a/src/scripts/cbam-lines.ts`
- Modify: `/private/tmp/cbam-batch-a/src/scripts/cbam-algos/cbam-app.ts`
- Modify: `/private/tmp/cbam-batch-a/tests/unit/cbam-lines.test.mjs`

The below-threshold verdict hardcodes *"Your cement, iron & steel, aluminium and fertiliser imports…"* while `rule.includedSectors` is in scope where the card is built (`thresholdByYear` already reads it to filter). `eligibleLineCount`'s docblock anticipates a row including hydrogen or electricity, and the suite simulates one.

- [ ] **Step 1: Write the failing test**

Assert the card carries the rule's sectors, and that a widened rule changes the rendered sentence. The file already builds a `widerPack` fixture for exactly this — **find and reuse it** rather than writing a second one.

- [ ] **Step 2: Run to verify failure** — report verbatim.

- [ ] **Step 3: Add the field**

On the **`ruleFound: true` arm only** of `YearThreshold`, beside `linesInYear`, carrying `rule.includedSectors`. Document why it is stored rather than re-derived: the card is rendered away from the pack, and a renderer that re-looked-up the rule could disagree with the basis the verdict was computed from.

- [ ] **Step 4: Render from it**

**The visible sentence for today's pack must not change.** The sectors are stored as keys like `iron_and_steel`, and the current prose reads `iron & steel` — a naive `replace(/_/g, ' ')` would render `iron and steel` and silently reword a shipped sentence. Map deliberately:

```
cement          → cement
iron_and_steel  → iron & steel
aluminium       → aluminium
fertilisers     → fertiliser
```

Join with commas and a final `and`, matching today's output exactly. An unknown key must render readably rather than throwing — decide how, and say why.

- [ ] **Step 5: Prove the sentence is byte-identical for today's pack**

Render the card before and after and diff the strings. **Any difference is a defect**, not an improvement. Report the evidence.

- [ ] **Step 6: Gates + commit** — full suite, `astro check` delta zero, stage by name.

---

## Task 6: Regenerate the parity fixture — the review IS the task

**Files:**
- Modify: `/private/tmp/cbam-batch-a/tests/fixtures/cbam-golden.json`

`tests/fixtures/cbam-golden.json` — 175 cases, `packGeneratedAt: 2026-07-29T11:01:09.056Z`. Its header:

> Regenerate with `node --import tsx scripts/gen-cbam-fixtures.mjs` **ONLY when a rule package legitimately changes, and review the diff as a regulatory change.**

Nothing reads it today (the Go oracle covers the *geo* fixture), so nothing is broken. It is the contract a Go CBAM port would be written against, and it currently encodes fixed bugs.

- [ ] **Step 1: Write down what should move, BEFORE regenerating**

Record the expectation first, so the diff is checked against a prediction rather than rationalised after the fact:

1. **indirect values on route-keyed goods**, all **downward** — the over-charge correction
2. **refusal `reason` strings** where the selector is `certificate-price/` (and possibly `quarter/`)
3. **`packGeneratedAt`**, `packRules` if the version changed, and any figure the newer pack legitimately moves — the fixture was generated `2026-07-29` against a pack the site replaced on `2026-08-07`

- [ ] **Step 2: Regenerate**

```bash
cd /private/tmp/cbam-batch-a
node --import tsx scripts/gen-cbam-fixtures.mjs
git diff --stat tests/fixtures/cbam-golden.json
```

- [ ] **Step 3: Account for every change**

Classify each changed case against Step 1's list. Report counts per category, with examples.

**Anything you cannot account for is a finding — stop and report rather than committing.** A number moving for a reason nobody predicted is exactly what this review exists to catch.

Confirm specifically: no indirect value moved **upward**, and no case moved from refused to priced or priced to refused except where a reason string changed.

- [ ] **Step 4: Commit** — the message records what changed and why, in the categories above.

---

## Task 7: Land it

- [ ] **Step 1: CBM first**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npm test 2>&1 | tail -3
git update-index --refresh >/dev/null 2>&1; git checkout main && git merge --ff-only fix/batch-a
npm test 2>&1 | tail -3
git push origin main
```
The `update-index --refresh` shares the invocation deliberately: this volume is exFAT and `checkout` otherwise reports phantom local changes. **Never `git reset --hard`.**

- [ ] **Step 2: Website**

```bash
cd /private/tmp/cbam-batch-a
git fetch origin --quiet
git merge origin/main --no-edit
npm run test:unit && node scripts/cbam-sync-check.mjs
git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
```

- [ ] **Step 3: Verify the deploy**

Poll `https://deltaclimate.earth/cbam/cbam-calculator/` with `Cache-Control: no-cache` **and a delay between attempts** — a tight loop just re-reads one cached build. Confirm `x-vercel-cache: MISS` and a bundle hash different from `FiefhPc6`. Confirm HTTP 200 on the bundle before grepping it; the minifier renames identifiers and emits backtick template literals, so grep for strings and shapes. Look for the date reason and the sector rendering.

- [ ] **Step 4: Clean up**

```bash
rm /private/tmp/cbam-batch-a/node_modules          # the SYMLINK only
cd /Volumes/VSTSAMPLES/Projects/Angad
git worktree remove /private/tmp/cbam-batch-a --force
git worktree prune
git branch -D fix/cbam-batch-a 2>/dev/null
cd /Volumes/VSTSAMPLES/Projects/CBM && git branch -d fix/batch-a
```

---

## Self-review

**Spec coverage.** Prod catch site + two reasons → Task 1. `quarter/` → Task 2. Re-vendor → Task 3. §4 containment → Task 4. Sectors from the rule, with the rendering trap → Task 5. Fixture regenerated last, review written before the diff → Task 6. Landing → Task 7.

**Placeholders.** None — every step carries its code or its exact command. Three steps (Task 1 Step 2, Task 4 Step 2, Task 5 Step 4) direct the implementer to locate something in the repo rather than naming it: the service's test home, §4's exact container boundaries, and how an unknown sector key should render. Each is a genuine unknown where guessing would be worse than looking.

**Type consistency.** `NO_SNAPSHOT_SCOPE_REASON`, `NO_PRECURSOR_REASON` and `BAD_DATE_REASON` are defined in Tasks 1 and 2 and referenced only there. `includedSectors` is added in Task 5 Step 3 and read in Step 4. `linesInYear` keeps its existing meaning.

**One risk worth naming.** Task 6 is the only task that changes figures, and its value is entirely in the review. If the diff is large and the reviewer is tired, the failure mode is a rubber stamp — which is why Step 1 forces the expectation to be written down *before* the diff is generated, and Step 3 requires anything unexplained to stop the task.
