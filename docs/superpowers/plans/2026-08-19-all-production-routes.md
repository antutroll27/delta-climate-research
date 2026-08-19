# Every Route The Good Actually Has — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer every production route a good has a benchmark for, instead of only the five routes that also happen to have a published default value.

**Architecture:** One filter comes off `routesFor` in the CBAM engine. The engine already refuses routes it cannot price, so no gate, toggle or "expert mode" is needed — the widened list is safe by construction. Two refusal messages that currently misdescribe the gap are corrected. The engine is vendored byte-for-byte into the website, so the change lands in CBM first and is re-vendored after.

**Tech Stack:** TypeScript, vitest (CBM) · TypeScript, Astro, `node:test`, Playwright (website).

**Spec:** `docs/superpowers/specs/2026-08-19-all-production-routes-design.md`

---

## Why, in one measurement

`routesFor` ends with a filter keeping only routes that have a published **default value**. Its docblock justifies this by claiming *"a route the corpus does not list has no default **and no benchmark**"* — which is false. Defaults exist for 8 routes; benchmarks exist for 11.

| | today | after |
|---|---|---|
| distinct routes ever visible | **5** — `(A) (B) (C) (F) (K)` | **11** — `(A) (B) (C) (D) (E) (F) (G) (H) (J) (K) (L)` |
| goods offering ≤1 route | **544** of 572 | **151** |
| goods that gain routes | — | **421** |

Measured per (good, country) — the unit a user meets, since they pick one country. Identical at IN, CN and DZ. Across all 572 × 121 (good, origin) pairs the same change takes pairs offering ≤1 route from **56,905 to 6,860**.

A twelfth token, the literal string `default`, is already in these lists on both sides. It is a pre-existing artefact of blank-route rows in the corpus, is not introduced or removed by this change, and stays out of scope — but an implementer counting tokens will see 12, not 11.

`72061000` / IN / 100 t, identical verified emissions: route **(C)** — the only one offered — gives **64.42** certificates; the hidden **(D)** and **(E)** give **148.66** and **187.37**. The one selectable route carries the largest free-allocation deduction, so the tool under-charges by up to 2.9×.

## Repos, branches, baselines

| | path | branch | baseline |
|---|---|---|---|
| CBM (engine) | `/Volumes/VSTSAMPLES/Projects/CBM` | create `feat/all-routes` from `main` | `npx vitest run --exclude '**/*.integration.test.ts'` → **547 pass / 76 files** |
| Website | `/Volumes/VSTSAMPLES/Projects/angad-allroutes` | `feat/all-routes` (exists; spec committed at `9c641a5`) | `npm run test:unit` → **489 pass**; `npx astro check` → **0 errors, 3 hints** |

**The website worktree has no `node_modules` yet** — its predecessor lived in `/private/tmp` and was wiped by tmp cleanup. Task 5 Step 0 installs it. It must be a **real `npm install`, never a symlink**: Astro's `normalizeFilename` rewrites any `.astro` reached through a symlinked path to a mangled `/…/angad-allroutes/Volumes/…` form and the build dies.

CBM's integration suite (`npm run test:db`) **cannot run locally** — no Docker. CI runs it. Never report it as locally verified.

## Standing constraints

1. **No figure may change for any route selectable today.** This is the regression that matters; Task 4 measures it.
2. **`src/scripts/cbam-algos/` on the website is vendored** byte-for-byte and hash-guarded by `scripts/cbam-sync-check.mjs`. Only `cbam-app.ts` is hand-editable there. Everything else is copied from CBM and re-recorded.
3. **Mutation-verify every fix**, and **confirm the mutation landed in the file** before trusting the run — a substitution silently failed to match in this project and produced a fully green suite that looked like a passing mutation run.
4. **Check exit codes; never judge a run by its trailing summary.** Playwright once reported "32 passed" while 75 of 107 failed, and a `| tail` hid it twice.
5. **Never state a call-site count from memory — grep it.** This project has undercounted eight times running.
6. **No `cscf` record may change.** All five stay `pending` / `null`.

---

## Task 1: CBM — widen `routesFor`

**Files:**
- Modify: `lib/estimator/estimate-from-pack.ts` (the `routesFor` export)
- Test: `lib/estimator/estimate-from-pack.test.ts`

- [ ] **Step 1: Confirm the baseline**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git checkout -b feat/all-routes main
npx vitest run --exclude '**/*.integration.test.ts' 2>&1 | grep -E "Tests |Test Files"
```
Expected: `Tests 547 passed (547)`, `Test Files 76 passed (76)`. **If it differs, stop and report** — every count below is measured against it.

- [ ] **Step 2: Write the failing test**

Append to `lib/estimator/estimate-from-pack.test.ts`, following the file's existing pack-fixture convention (read the top of the file and reuse whatever it already calls the loaded pack rather than inventing a new fixture):

```ts
describe('routesFor offers every route the good has a benchmark for', () => {
  it('offers (D) and (E) on 72061000, not just the one route with a default value', () => {
    // The filter this replaces kept only routes with a published DEFAULT. Benchmarks exist for
    // 11 routes and defaults for 8, so 419 of 572 goods could not select a route the engine can
    // actually price. Measured on this good with identical verified emissions: 64.42 certificates
    // on (C), 148.66 on (D), 187.37 on (E) — and only (C) was reachable, which carries the
    // LARGEST free-allocation deduction of the three. The tool under-charged.
    const routes = routesFor(pack, '72061000', 'IN', 2026)
    expect(routes).toContain('(C)')
    expect(routes).toContain('(D)')
    expect(routes).toContain('(E)')
  })

  it('does NOT offer a route the good has no benchmark for', () => {
    // The safety property the whole design rests on. (K) is an aluminium route; on a steel good
    // there is no benchmark row, so no free-allocation term exists and the line cannot be priced.
    // The widened list must not reach it.
    expect(routesFor(pack, '72061000', 'IN', 2026)).not.toContain('(K)')
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run lib/estimator/estimate-from-pack.test.ts 2>&1 | grep -E "Tests |×"
```
Expected: FAIL — `routes` is `["(C)"]`, so `toContain('(D)')` and `toContain('(E)')` both fail. **Record the actual array in your report.**

- [ ] **Step 4: Widen the function**

In `lib/estimator/estimate-from-pack.ts`, `routesFor` currently ends:

```ts
  ))].filter(route => lookupValue(pack, 'direct', { cn, country, route }, year).kind === 'found').sort()
```

Replace the whole function, and add the helper below it:

```ts
export function routesFor(
  pack: EstimatorPack,
  cn: string,
  country: string,
  year: number,
): string[] {
  if (!isOfferedGood(pack, cn) || !Number.isInteger(year)) return []
  const prepared = prepareEstimatorPack(pack)
  const origins = originOrder(pack, country)
  const fromDefaults = new Set(origins.flatMap(origin =>
    availableRoutesAt(prepared, 'direct', cn, origin, year),
  ))
  // EVERY ROUTE THE GOOD HAS A BENCHMARK FOR, not only those that also have a default value.
  //
  // This filtered on `lookupValue(...).kind === 'found'`, justified by a docblock asserting that
  // "a route the corpus does not list has no default AND no benchmark". That equivalence is
  // false: the Commission publishes default values for 8 routes and benchmarks for 11, so 419
  // of 572 goods could not select a route the engine prices perfectly well. On 72061000 the one
  // offered route carried the LARGEST free-allocation deduction, so the omission under-charged.
  //
  // Widening needs no gate. A route with no benchmark for this good has no free-allocation term
  // at all, so resolveBenchmark refuses and the line renders no figure. The boundary is enforced
  // by absent data, not by a policy this function imposes. A route offered here but lacking a
  // default still refuses on the DEFAULTS tier — correctly, and with its own message — while
  // pricing normally from the user's own verified figures.
  const fromBenchmarks = benchmarkRoutesFor(pack, cn)
  return [...new Set([...fromDefaults, ...fromBenchmarks])].sort()
}

/**
 * The routes the free-allocation benchmark table lists for a good.
 *
 * Mirrors `resolveBenchmark` (lib/cbam/resolve-fa.ts): a row covers this good when the CN starts
 * with its `scopeCode`, and `scopeCode.length === codeLevel` is that function's own
 * self-consistency guard on the row. Rows with an empty `routeIndicator` are route-INDEPENDENT —
 * they apply whatever route is declared, so they add no choice to the control and are excluded.
 *
 * Deliberately NOT reduced to the deepest scope. `resolveBenchmark` splits by route BEFORE taking
 * its longest match, so each route resolves at its own depth: a route present only at a 4-digit
 * heading row is resolvable even when another route has an 8-digit row. Narrowing to the deepest
 * level here would silently drop exactly those routes — the bug this task exists to fix.
 *
 * Column and validity date are not filtered either. This function has neither (it takes a year,
 * not a date, and the column is chosen by the caller of resolveBenchmark), and over-offering is
 * safe: a route that cannot resolve refuses and renders no figure. Under-offering is the defect.
 */
function benchmarkRoutesFor(pack: EstimatorPack, cn: string): string[] {
  return [...new Set(
    pack.benchmarks
      .filter(row => cn.startsWith(row.scopeCode)
        && row.scopeCode.length === row.codeLevel
        && row.routeIndicator)
      .map(row => row.routeIndicator),
  )]
}
```

**Verified against the shipped pack before this plan was written** (`public/estimator-pack.json`, 572 goods): `pack.benchmarks` rows carry `scopeCode`, `codeLevel`, `benchmarkColumn`, `routeIndicator`, `validFrom`, `validTo`; `EstimatorPack = EstimatorPackV2` declares `benchmarks: FreeAllocationTables['benchmarks']`. This exact helper reproduces the headline table above. Re-confirm rather than assume, but it should match.

- [ ] **Step 5: Run it and watch it pass**

```bash
npx vitest run lib/estimator/estimate-from-pack.test.ts 2>&1 | grep -E "Tests |×"
npx vitest run --exclude '**/*.integration.test.ts' 2>&1 | grep -E "Tests |Test Files"
npm run typecheck >/dev/null 2>&1 && echo "typecheck: PASS" || echo "typecheck: FAIL"
```
Expected: the two new tests pass; the suite is **≥ 549**. **Report the exact number.** Tests that asserted the narrow list may legitimately move — if any fails, classify it as *stale expectation* or *real regression* and say which. **Never re-baseline an assertion without saying why in the commit body.**

- [ ] **Step 6: Mutation-verify**

Restore the old filter line, `grep` the file to confirm the mutation actually landed, run the two new tests and confirm **both** go red, then restore and confirm `git diff` shows only the intended change.

- [ ] **Step 7: Commit**

```bash
git add lib/estimator/estimate-from-pack.ts lib/estimator/estimate-from-pack.test.ts
git commit -m "fix(cbam): offer every route the good has a benchmark for"
```
Body: the before/after route arrays for `72061000`, and the new suite count against 547.

---

## Task 2: CBM — the two refusals that misdescribe the gap

**Files:**
- Modify: `lib/cbam/certificate-estimate.ts` — the `NO_DIRECT_DEFAULT` and `NO_INDIRECT_ROUTE` entries of `FAILURE_MESSAGES` (around `:432-433`; **locate them by name, not by line number** — Task 1 does not touch this file, but line citations in this project have been wrong in both directions)
- Test: `lib/cbam/certificate-estimate.test.ts`

The dispatch is already correct — `default/` → `NO_DIRECT_DEFAULT`, `indirect/` → `NO_INDIRECT_ROUTE`, `benchmark/` → `NO_BENCHMARK`, each a distinct code. Only the **wording** is wrong, and the widened route list makes both far more reachable.

- [ ] **Step 1: Write the failing test**

Append to `lib/cbam/certificate-estimate.test.ts`:

```ts
describe('a missing default value is not a missing benchmark', () => {
  // Expectations are hand-typed, never imported from production — this codebase's anti-paraphrase
  // convention. A test that imports the string it checks passes whatever that string becomes.
  it('NO_DIRECT_DEFAULT tells the user their own verified figures will price this route', () => {
    const msg = failureMessage('NO_DIRECT_DEFAULT')
    expect(msg).toMatch(/verified/i)
    expect(msg).not.toMatch(/no free-allocation benchmark|benchmark is not published/i)
  })

  it('NO_INDIRECT_ROUTE names the INDIRECT component and the scope control', () => {
    // Grey clinker route (B) prices on direct-only and refuses on direct+indirect, because no
    // indirect default exists for (B). The user must be told it is the electricity half that is
    // missing — not left believing the route itself is invalid.
    const msg = failureMessage('NO_INDIRECT_ROUTE')
    expect(msg).toMatch(/indirect/i)
    expect(msg).toMatch(/scope|direct only/i)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run lib/cbam/certificate-estimate.test.ts 2>&1 | grep -E "Tests |×"
```
Expected: FAIL. The current strings are *"No applicable direct default value is published for this selector."* and *"No indirect default value is published for this production route."* — neither mentions verified figures, and neither names the scope control.

- [ ] **Step 3: Correct the two messages**

Replace these two entries in `FAILURE_MESSAGES`:

```ts
  NO_DIRECT_DEFAULT: 'No applicable direct default value is published for this selector.',
  NO_INDIRECT_ROUTE: 'No indirect default value is published for this production route.',
```

with:

```ts
  // NOT "no benchmark" — that is a different refusal with its own code, and saying it here would
  // name the wrong cause. The free-allocation benchmark for this route IS published; what is
  // missing is the Commission's own emission value, which only the defaults tier needs.
  NO_DIRECT_DEFAULT:
    'The Commission publishes no default emission value for this good on this production route, '
    + 'so no figure is shown. Its free-allocation benchmark is published, so entering your own '
    + 'verified figures will price this route.',
  // The route is fine and the direct half is fine; the ELECTRICITY half has no published value.
  // Naming the scope control matters because that is the thing the user can actually change.
  NO_INDIRECT_ROUTE:
    'The Commission publishes no indirect (electricity) default value for this good on this '
    + 'production route, so no figure is shown. Setting the emissions scope to direct only will '
    + 'price the part that is published.',
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run lib/cbam/certificate-estimate.test.ts 2>&1 | grep -E "Tests |×"
npx vitest run --exclude '**/*.integration.test.ts' 2>&1 | grep -E "Tests |Test Files"
npm run typecheck >/dev/null 2>&1 && echo "typecheck: PASS" || echo "typecheck: FAIL"
```
Other tests may assert the old wording. Fixing those is expected; **say in the commit body which files you touched and why**.

- [ ] **Step 5: Mutation-verify**

Revert each message in turn; confirm its own named test goes red while the other stays green. Restore and confirm `git diff` is clean of stray edits.

- [ ] **Step 6: Commit**

```bash
git add lib/cbam/certificate-estimate.ts lib/cbam/certificate-estimate.test.ts
git commit -m "fix(cbam): a missing default value stops being reported as a missing benchmark"
```

---

## Task 3: CBM — push, CI, merge

- [ ] **Step 1: Push and open a PR**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git push -u origin feat/all-routes
gh pr create --base main --head feat/all-routes \
  --title "fix(cbam): offer every route the good has a benchmark for" \
  --body "routesFor filtered to routes with a published default value, so 419 of 572 goods could not select a route the engine prices. Distinct routes visible go 5 -> 11. Safe without a gate: a route with no benchmark has no free-allocation term and refuses at resolveBenchmark. Two refusals corrected — a missing default value was being reported as a missing benchmark."
```

- [ ] **Step 2: Watch CI**

```bash
gh pr checks --watch
```
The integration suite runs here and **only** here. Report that CI verified it, not that you did.

- [ ] **Step 3: Merge and capture the SHA**

```bash
gh pr merge --squash --delete-branch
git checkout main && git pull --ff-only && git rev-parse HEAD
```
Task 5 pins the website's `UPSTREAM.json` to this SHA. **Record the full 40 characters.**

---

## Task 4: Measure — no figure moves for a route selectable today

**Files:** none. Change no source file; commit nothing. This task produces a report.

- [ ] **Step 1: Prove the harness can see a change before trusting a null result**

Build the pre-change tree (a scratch copy of `estimate-from-pack.ts` with the old filter), perturb one value in it, and confirm your differ reports that perturbation with counts and field names. **Report this proof.** A "0 differing" from a broken harness is byte-identical to a genuine null, and that has already happened in this project — a stale `.mts` in a shared scratchpad ran instead of the intended harness and returned instantly with an empty result.

- [ ] **Step 2: Sweep every route selectable BEFORE the change**

For every `(good, origin, route)` triple that pre-change `routesFor` offered, run `estimateFromPack` on both trees — both scopes, both tiers — and diff **whole serialised result objects**, every key at every depth. A status-only diff in this project once missed 10,300 user-visible `selector` changes.

**Expected: zero differing.** Any movement is the headline: stop and report it rather than explaining it away.

- [ ] **Step 3: Count what the widening actually added**

Report, measured rather than recited from this plan:
- distinct routes ever visible, before and after (this plan says 5 → 11)
- goods offering ≤1 route, before and after (544 → 151)
- goods that gained routes (421)

State the corpus you swept — a count is a property of the sweep, not of the change.

- [ ] **Step 4: Prove the safety property directly**

Across the full corpus, assert that every route `routesFor` now offers either prices or refuses with a code naming the real gap, and that a route the good has no benchmark for — `(K)` on `72061000`, `(K)` on `2523100090` — refuses on **every** tier and **both** scopes. This is the claim the entire no-gate design rests on, so it is measured, not assumed.

---

## Task 5: Website — re-vendor and verify

**Files:**
- Modify: `src/scripts/cbam-algos/estimator/estimate-from-pack.ts`, `src/scripts/cbam-algos/cbam/certificate-estimate.ts`, `src/scripts/cbam-algos/UPSTREAM.json`

- [ ] **Step 0: Install dependencies (this worktree is fresh)**

```bash
cd /Volumes/VSTSAMPLES/Projects/angad-allroutes
npm install 2>&1 | tail -2
[ -L node_modules ] && echo "SYMLINK — WRONG, rm and reinstall" || echo "real directory: OK"
```
A symlinked `node_modules` makes Astro mangle `.astro` paths and kills the build with a nonsense path like `/Volumes/VSTSAMPLES/Projects/angad-allroutes/Volumes/…`. It must be a real directory.

- [ ] **Step 1: Copy the two changed engine files from CBM `main`**

```bash
CBM=/Volumes/VSTSAMPLES/Projects/CBM
cp $CBM/lib/estimator/estimate-from-pack.ts src/scripts/cbam-algos/estimator/estimate-from-pack.ts
cp $CBM/lib/cbam/certificate-estimate.ts    src/scripts/cbam-algos/cbam/certificate-estimate.ts
```
**Do not hand-edit either file.** They are vendored byte-for-byte and hash-guarded; `cbam-app.ts` is the only hand-editable file under `cbam-algos/`.

- [ ] **Step 2: Re-record the pin against the MERGE commit**

```bash
CBAM_UPSTREAM_COMMIT=<full 40-char SHA from Task 3 Step 3> node scripts/cbam-sync-check.mjs --update
node scripts/cbam-sync-check.mjs && echo "SYNC_OK" || echo "SYNC_FAIL"
```
The flag is `--update`, **not** `--record`. Use the **merge** commit: a squash merge discards the branch commit, so pinning to that would pass here (the branch is still reachable locally) and fail from a clean clone.

- [ ] **Step 3: Gates**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)|vendored|in sync"
npx astro check 2>&1 | tail -3
npm run build 2>&1 | tail -2
```
Expected: **489+ pass, 0 fail**; the vendored-engine check green; `astro check` **0 errors, 3 hints**; build clean.

- [ ] **Step 4: Confirm the route list widened on the website too**

```bash
cat > ./routes-check.mts <<'EOF'
import { readFileSync } from 'node:fs'
import { routesFor } from './src/scripts/cbam-algos/estimator/estimate-from-pack.ts'
const pack = JSON.parse(readFileSync('./public/cbam/estimator-pack.json', 'utf8'))
console.log('72061000/IN   ->', JSON.stringify(routesFor(pack as any, '72061000', 'IN', 2026)))
console.log('2523100090/DZ ->', JSON.stringify(routesFor(pack as any, '2523100090', 'DZ', 2026)))
EOF
npx tsx ./routes-check.mts; rm -f ./routes-check.mts
```
Expected: `72061000/IN` contains `(C) (D) (E)` and not `(K)`; `2523100090/DZ` contains `(A)` and `(B)`.
**Confirm the pack path first** — if `public/cbam/estimator-pack.json` does not exist, find the real one rather than reporting a failure.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/cbam-algos/
git commit -m "feat(cbam): vendor the widened route list and the corrected refusals"
```

---

## Task 6: Website — e2e, land, verify the deploy

- [ ] **Step 1: Add an e2e pin for the widened dropdown**

Add to `tests/e2e/cbam-lines.spec.ts`, inside its existing multi-line `test.describe` block — **find that block by name and confirm the selector ids (`#cbCn`, `#cbCountry`, `#cbRoute`, `#cbDate`) against the neighbouring tests before writing**, then follow whatever setup convention they use:

```ts
test('a good with three published routes offers all three', async ({ page }) => {
  // routesFor filtered to routes with a published DEFAULT value, so this good offered only (C)
  // while the engine prices (D) and (E) perfectly well. Asserted through the real form because
  // the filter's effect is what a user meets; the engine-level list is pinned in the unit suite.
  await page.goto('/cbam/cbam-calculator/');
  await page.fill('#cbCn', '72061000');
  await page.dispatchEvent('#cbCn', 'change');
  await page.fill('#cbDate', '2026-03-15');
  await expect(page.locator('#cbCountry option[value="IN"]')).toBeAttached();
  await page.selectOption('#cbCountry', 'IN');
  await expect(page.locator('#cbRoute')).toBeEnabled();
  for (const route of ['(C)', '(D)', '(E)']) {
    await expect(page.locator(`#cbRoute option[value="${route}"]`)).toBeAttached();
  }
  await expect(page.locator('#cbRoute option[value="(K)"]')).toHaveCount(0);
});
```

- [ ] **Step 2: Run the full gates**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"
npm run test:e2e 2>&1 | tail -6
```
**Check the exit code and grep for failure markers.** Do not judge either run by its trailing summary — a Playwright run in this project printed "32 passed" while 75 of 107 failed.

- [ ] **Step 3: Commit, push, PR, CI, merge**

```bash
git add tests/e2e/cbam-lines.spec.ts
git commit -m "test(cbam): pin that a three-route good offers all three"
git push -u origin feat/all-routes
gh pr create --base main --head feat/all-routes \
  --title "feat(cbam): every production route the good actually has" \
  --body "Distinct routes visible go 5 -> 11; 421 of 572 goods gain routes. No figure changes for any route selectable today (Task 4 sweep). Two refusals corrected: a missing default value was being reported as a missing benchmark."
gh pr checks --watch
gh pr merge --squash --delete-branch
```

- [ ] **Step 4: Verify the deploy**

Poll `https://deltaclimate.earth/cbam/cbam-calculator` with `Cache-Control: no-cache` and a delay between attempts.

**Check for HTTP 200 before grepping anything.** A 404 page greps as "string absent", which reads as a finding and is not one — that exact mistake produced four false "ABSENT" reports in this project, two of which read as good news. Confirm a bundle hash different from `rLk-Xdvc`, then grep the bundle for the new refusal **wording**, not for identifiers — the minifier renames those.

---

## Self-review

**Spec coverage.** Filter removal → Task 1. The two refusals → Task 2. "No figure changes for a route selectable today" → Task 4 Step 2. The safety property that makes a gate unnecessary → Task 1 Step 2's second test, Task 4 Step 4, Task 6 Step 1's `(K)` assertion. Vendoring order (CBM first, re-pin after) → Tasks 3 and 5.

**Deliberately out of scope, per the spec:** the `72052100` route `I`-vs-`J` disagreement between the founder's matrix and our pack — a data question for a human, not a code change. No 12th route. No removal of the route selector. The print doc's fallback line card still omitting the route stays on the open-defects ledger.

**Type consistency.** `benchmarkRoutesFor(pack, cn)` is defined once, in Task 1, and referenced only there. `routesFor`'s signature is unchanged, so no caller moves. `NO_DIRECT_DEFAULT` and `NO_INDIRECT_ROUTE` are existing `EstimateFailureCode` members — Task 2 changes their messages only, never the codes or the dispatch.

**Known gap, stated rather than hidden.** CBM's integration suite cannot run locally; Task 3 is CI-only and must be reported as such.
