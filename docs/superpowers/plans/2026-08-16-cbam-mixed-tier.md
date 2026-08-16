# The Mixed Tier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A line that attests only its direct figure stops pricing electricity at zero, takes the Commission's published indirect default with its mark-up, and says so.

**Architecture:** The engine already computes a tier onto every estimate's stamp. This makes that tier authoritative: the engine gains a third value, and the website's `Line.tier` is **read back from the stamp** rather than re-derived — so the existing equality guard in `csvRows` keeps working untouched.

**Tech Stack:** TypeScript, decimal.js, vitest (CBM), `node:test` + `tsx` (website), Astro.

**Spec:** `docs/superpowers/specs/2026-08-16-cbam-mixed-tier-design.md`

---

## Standing constraints — read before every task

- **Never hand-edit anything under `src/scripts/cbam-algos/` except `cbam-app.ts`.** Vendored byte-for-byte from `CBM/lib/`, hash-guarded by `scripts/cbam-sync-check.mjs` against `UPSTREAM.json` (11 files). Changes arrive only by `cp`.
- **Never `git add -A` or `git add .`** — in a worktree `node_modules` is a *symlink* and `.gitignore`'s trailing-slash pattern misses it.
- **Never run `npm ci`/`npm install`** in the website worktree — `node_modules` symlinks into a shared checkout another agent owns.
- `npx astro check` reports **2 pre-existing errors** (`mapillary-js` in `street-view-panel.ts`). Measure the baseline yourself; confirm delta-zero; do not fix them.
- `npm run test:unit` runs `cbam-sync-check` first against the **live CBM checkout**. While CBM is ahead of what the website has vendored it reports DRIFT and bails — use the raw runner (`node --import tsx --test <file>`) to measure a baseline in that window.
- **Every drafted sentence and expectation in this plan is a claim to verify, not copy.** In the last two batches several of mine were false, one with the direction of harm inverted. Argue with evidence rather than complying.

## The circularity, and how it resolves

`verifiedInputOf(l)` returns `undefined` unless `l.tier === 'actual-verified'`, and its docblock explains why that matters: a line claiming a verified tier with no `verified` object reaching the engine takes the defaults path, stamps `default+markup`, and **`csvRows` throws at export time, killing the whole file over one line**.

So `draftLine` cannot derive the tier from an estimate it cannot compute without the tier.

Resolution — two different things stop sharing one field:

- **the user's selection** drives the engine input. `parseVerifiedFields` keeps returning `'actual-verified'`; `verifiedInputOf` accepts the mixed value too, so a Line read back later still produces its input.
- **the computed tier** lands on the Line. `draftLine` sets `line.tier = estimate.stamp.tier`.

Equality holds by construction rather than by two copies of one rule drifting apart.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `CBM/lib/cbam/certificate-estimate.ts` | `DataTier` gains the value | 1 |
| `CBM/lib/estimator/estimate-from-pack.ts` | the fallback + the stamp's tier | 1 |
| `CBM/lib/estimator/mixed-tier.test.ts` (new) | engine behaviour, pack-driven | 1 |
| website `src/scripts/cbam-algos/**` + `UPSTREAM.json` | vendored copy (`cp`/`--update` only) | 2 |
| `src/scripts/cbam-lines.ts` | `Line.tier` union | 3 |
| `src/scripts/cbam-algos/cbam-app.ts` | `verifiedInputOf`, `tierLabel`, `draftLine`, `renderAttestation` | 3, 4 |
| `tests/unit/cbam-lines.test.mjs`, `cbam-render.test.mjs` | pins | 3, 4 |

---

## Task 1: The engine falls back, and names the tier

**Files:**
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/lib/cbam/certificate-estimate.ts`
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/estimate-from-pack.ts`
- Create: `/Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/mixed-tier.test.ts`

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git checkout main && git pull --ff-only
git checkout -b feat/mixed-tier
```

Baseline: **470 tests passing**, typecheck clean.

### The defect

`estimate-from-pack.ts`, verified path:

```ts
    let indirectTco2e = '0'
    if (input.emissionsScope === 'direct_and_indirect' && input.verified.indirectTco2ePerT !== undefined) {
      const indirect = nonNegativeDecimal(input.verified.indirectTco2ePerT)
      if (!indirect) {
        return unavailableEstimate(verifiedStamp, tables, BAD_VERIFIED_REASON, `verified/${input.cn}/indirectTco2ePerT`)
      }
      indirectTco2e = indirect.mul(mass).toFixed()
    }
```

An omitted key prices zero. An empty string refuses. **The lax path is the one a caller reaches by doing nothing.**

- [ ] **Step 1: Confirm the baseline**

```bash
npm test 2>&1 | tail -3
npm run typecheck 2>&1 | tail -2
```
Expected: `Tests  470 passed (470)`, typecheck silent.

- [ ] **Step 2: Write the failing tests**

Create `lib/estimator/mixed-tier.test.ts`, modelled on `lib/estimator/mass-guard.test.ts` (read it first for the pack load and hand-typed-constant idiom). Pin:

1. **The figure.** A verified-direct line with no indirect, scope `direct_and_indirect`, on a good with a published indirect default, must produce an `indirectTco2e` **exactly equal** to the same good priced entirely from defaults — mark-up included. Derive the expected value from the pack and show the arithmetic; do not copy a number from a previous run.
2. **The tier.** That estimate's `stamp.tier` is `'verified-direct+default-indirect'`.
3. **Absence is absence.** Omitted and `''` behave identically — both fall back.
4. **Bad input still refuses.** `'abc'` and `'-1'` still return `unavailable` with the existing verified reason and selector. That path must not move.
5. **Not mixed: `direct` scope.** Indirect is never read, so the tier stays `'actual-verified'`.
6. **Not mixed: no published indirect.** A good where `selectIndirectFactorFromPack` returns `none` — iron & steel or aluminium — keeps `indirectTco2e: '0'` and tier `'actual-verified'`. Zero is the *correct published answer* there, not a fallback.
7. **Unchanged: fully verified.** Both figures supplied ⇒ tier `'actual-verified'`, indirect from the attested value, no mark-up.

**Verify each selector against the shipped pack before pinning it** — in particular that your chosen good really does have a published indirect default, and that your no-indirect witness really returns `none`.

- [ ] **Step 3: Run to verify failure** — report verbatim.

- [ ] **Step 4: Widen the type**

In `lib/cbam/certificate-estimate.ts`:

```ts
export type DataTier = 'actual-verified' | 'default+markup' | 'verified-direct+default-indirect'
```

Run `npm run typecheck` **immediately** and report what it flags. **MEASURED: it flags nothing — exit 0.** An earlier draft of this plan claimed the compiler would enumerate the work here; it does not. `DataTier` has three references in the whole CBM tree (its definition and two field declarations), the codebase's single `switch` is on `estimate().status` and carries a `default:` arm, and there are no `never` exhaustiveness checks over `DataTier` at all. The `never` check I was thinking of is `tierLabel` in the WEBSITE's `cbam-app.ts` — it belongs to Tasks 2–3, not here.

Also measured: **vitest's `toBe` is loosely typed**, so a test asserting the new tier literal typechecks clean *before* the union is widened. The compiler is not a guard on tier literals in tests — the suite is.

- [ ] **Step 5: Implement the fallback**

Replace the block above with logic that:
- reads the verified indirect when one was supplied and is readable
- **refuses** when one was supplied and is not readable (unchanged)
- **falls back** to `selectIndirectFactorFromPack` with its mark-up when none was supplied, on `direct_and_indirect` only
- stamps `'verified-direct+default-indirect'` **only** when the fallback actually supplied a figure — not when the lookup returned `none`
- preserves the `route-mismatch` refusal exactly as the defaults path does

The mark-up arithmetic must be the same expression the defaults path uses (`baseIntensity × (1 + markupPct/100) × mass`). **Do not write a second copy of it if it can be shared** — two copies of a tax calculation is how they diverge. If sharing is awkward, say why and leave a comment naming the duplication.

Write the comment explaining why the mark-up belongs here: it prices *not having data*, and this importer does not have indirect data.

- [ ] **Step 6: Verify + mutation-test**

```bash
npm test 2>&1 | tail -3
npm run typecheck 2>&1 | tail -2
```

| mutation | must fail |
|---|---|
| stamp `'actual-verified'` on the fallback path | the tier test |
| drop the mark-up from the fallback | the figure test |
| stamp mixed when the lookup returns `none` | the no-published-indirect test |
| make `''` fall through to refusal instead of fallback | the absence test |

Apply each, confirm the *named* test fails, restore precisely, confirm green. **Diff against a pristine copy to prove each mutation landed** — a green mutation run is exactly what a failed mutation looks like.

- [ ] **Step 7: Commit** — stage by name; write the message yourself.

---

## Task 2: Re-vendor

**Files:** the changed vendored files (via `cp`), `UPSTREAM.json` (via `--update`).

Worktree `/private/tmp/cbam-mixed`, branch `fix/cbam-mixed-tier`, based on `origin/main`, `node_modules` symlinked. Baseline **402 unit tests**.

- [ ] **Step 1: Establish which files moved**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM && git diff --name-only main..feat/mixed-tier -- lib/
```
Copy exactly those that are among the 11 vendored files — check `UPSTREAM.json` rather than assuming. Test files under `lib/` are **not** vendored.

- [ ] **Step 2: Copy down and re-record**

```bash
cd /private/tmp/cbam-mixed
# cp each changed vendored file
node scripts/cbam-sync-check.mjs --update
node scripts/cbam-sync-check.mjs
git diff --stat
```
The count must equal the files you copied plus `UPSTREAM.json`. More means something else drifted — stop and report.

- [ ] **Step 3: Expect a type error, and read it as the point**

`npx astro check` will now flag `tierLabel`'s exhaustive switch and anything else non-exhaustive. **This is the type doing its job.** Record what it flags — that list is Task 3's work. Do not fix anything yet.

- [ ] **Step 4: Commit** the vendored copy alone, noting in the message that the website does not yet compile and Task 3 closes it. If you would rather not commit a non-compiling state, say so and fold Tasks 2 and 3 into one commit — argue for whichever you pick.

---

## Task 3: The website learns the third tier

**Files:**
- Modify: `/private/tmp/cbam-mixed/src/scripts/cbam-lines.ts` (`Line.tier`)
- Modify: `/private/tmp/cbam-mixed/src/scripts/cbam-algos/cbam-app.ts` (`tierLabel`, `verifiedInputOf`)
- Modify: `/private/tmp/cbam-mixed/tests/unit/cbam-lines.test.mjs`

- [ ] **Step 1: Widen `Line.tier`**

`src/scripts/cbam-lines.ts:41` is `tier: 'default+markup' | 'actual-verified';`. Add the third value. Its docblock explains the field exists so "the line can never disagree about which tier was used" — extend that reasoning rather than replacing it.

- [ ] **Step 2: `tierLabel` gains its arm**

```ts
    case 'verified-direct+default-indirect': return 'Verified direct + Commission indirect';
```

The `never` default stays.

- [ ] **Step 3: `verifiedInputOf` — the site the compiler will NOT flag**

It currently reads `if (l.tier !== 'actual-verified') return undefined;`. A mixed line must still produce a `verified` object, or the engine takes the defaults path, stamps `default+markup`, and `csvRows` throws at export — the exact failure its own docblock describes.

Widen the check to accept both verified-bearing tiers. Add a comment naming why an `if` was chosen here and why it now needs two values — a future reader must not "simplify" it back.

- [ ] **Step 4: Pin it**

Add a test that a mixed-tier `Line` produces a `verified` object from `verifiedInputOf` — and that it carries `directTco2ePerT` with **no** `indirectTco2ePerT` key. Mutate the check back to the single tier and confirm the test fails.

- [ ] **Step 5: Gates + commit** — `npm run test:unit`, sync-check green, `astro check` back to its 2 pre-existing errors. Stage by name.

---

## Task 4: The line records what was computed, and the attestation says what it covers

**Files:**
- Modify: `/private/tmp/cbam-mixed/src/scripts/cbam-algos/cbam-app.ts` (`draftLine`, `renderAttestation`)
- Modify: `/private/tmp/cbam-mixed/tests/unit/cbam-render.test.mjs`

- [ ] **Step 1: Write the failing tests**

Pin, with hand-typed constants per this codebase's anti-paraphrase convention:

1. A mixed line's `line.tier` **equals** its estimate's `stamp.tier`, so `csvRows` does not throw. **This is the test that proves the mechanism.**
2. `renderAttestation` on a mixed line renders, names the direct half as attested and the electricity half as an uncertified Commission default, and still prints the verifier's reference when present.
3. `renderAttestation` on a `default+markup` line still renders nothing.
4. The CSV's `data_tier` column carries the mixed value verbatim.

- [ ] **Step 2: Run to verify failure** — report verbatim.

- [ ] **Step 3: `draftLine` reads the tier back from the stamp**

`draftLine` builds the input from the user's *selection* (via `parseVerifiedFields`, unchanged) and sets `line.tier` from the **estimate's `stamp.tier`**.

**Read `draftLine` before writing this** — confirm it can compute an estimate at that point, and if it cannot, say so and propose where the read-back belongs instead. Do not re-derive the rule in a second place: the entire reason for reading it back is that two copies of one rule drift.

Handle the refusal case explicitly: a refused estimate still carries a stamp, so the tier is still readable — verify that rather than assuming it.

- [ ] **Step 4: `renderAttestation` gains its arm**

Its current `if (line.tier !== 'actual-verified') return '';` becomes a three-way decision. The mixed wording must state both halves; the existing `ATTESTED_NOTE` covers the fully-verified case and does not move.

- [ ] **Step 5: Mutation-test the mechanism**

Make `draftLine` keep `'actual-verified'` on a mixed line. **`csvRows` must throw** — that is the guard doing its job, and the reason it was not weakened. Report the failure verbatim, restore, confirm green.

- [ ] **Step 6: Gates + commit** — full suite, sync-check, `astro check` delta zero. Stage by name.

---

## Task 5: Measure

**Files:** none. Change no source file; commit nothing.

- [ ] **Step 1: Confirm nothing that priced before moved**

Sweep old engine vs new across a broad selector set and every scope, **with no `verified` input at all**. Every defaults-path figure must be byte-identical. Report counts.

- [ ] **Step 2: Confirm the fully-verified path is untouched**

Same sweep with **both** verified figures supplied. Identical before and after.

- [ ] **Step 3: Measure what the fallback actually changes**

With a verified direct figure and no indirect: report how many selectors gain a non-zero indirect component, and confirm every one of them moved **upward** — they gained a component that should always have been there. Report the largest change in tCO₂e and in euros.

- [ ] **Step 4: The golden fixture**

`scripts/gen-cbam-fixtures.mjs` passes no `verified` input (verified: 0 occurrences), so the parity fixture should not move. **Regenerate and confirm the diff is empty.** If it moves, that is a finding — stop and report rather than committing it.

- [ ] **Step 5: Clean up** and confirm both repos are clean.

---

## Task 6: Land it

- [ ] **Step 1: CBM first**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npm test 2>&1 | tail -3
git update-index --refresh >/dev/null 2>&1; git checkout main && git merge --ff-only feat/mixed-tier
npm test 2>&1 | tail -3
git push origin main
```
The `update-index --refresh` shares the invocation deliberately: this volume is exFAT and `checkout` otherwise reports phantom local changes. **Never `git reset --hard`.**

- [ ] **Step 2: Website**

```bash
cd /private/tmp/cbam-mixed
git fetch origin --quiet
git merge origin/main --no-edit
npm run test:unit && node scripts/cbam-sync-check.mjs
git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
```

- [ ] **Step 3: Verify the deploy**

Poll `https://deltaclimate.earth/cbam/cbam-calculator/` with `Cache-Control: no-cache` **and a delay between attempts** — a tight loop just re-reads one cached build. Confirm `x-vercel-cache: MISS` and a bundle hash different from `y5tA1ZaF`. Confirm HTTP 200 on the bundle before grepping; the minifier renames identifiers and emits backtick template literals, so grep for strings and shapes. Look for the new tier value and the mixed attestation wording.

- [ ] **Step 4: Clean up**

```bash
rm /private/tmp/cbam-mixed/node_modules          # the SYMLINK only
cd /Volumes/VSTSAMPLES/Projects/Angad
git worktree remove /private/tmp/cbam-mixed --force
git worktree prune
git branch -D fix/cbam-mixed-tier 2>/dev/null
cd /Volumes/VSTSAMPLES/Projects/CBM && git branch -d feat/mixed-tier
```

---

## Self-review

**Spec coverage.** Fallback with mark-up → Task 1 Step 5. Absence vs bad input → Task 1 Step 2 items 3–4. The two non-mixed cases → items 5–6. The type value and its name → Task 1 Step 4. `Line.tier` derived from the stamp → Task 4 Step 3. Attestation scoped to the direct half → Task 4 Step 4. The `csvRows` guard kept intact and proven → Task 4 Step 5. No existing figure changes → Task 5 Steps 1–2. Fixture unmoved → Task 5 Step 4.

**Placeholders.** None — every step carries its code or its exact command. Three steps deliberately ask the implementer to look rather than trust: which files are vendored (Task 2 Step 1), whether `draftLine` can compute an estimate (Task 4 Step 3), and whether Tasks 2 and 3 should be one commit (Task 2 Step 4). Each is a genuine unknown where guessing is worse than checking.

**Type consistency.** `'verified-direct+default-indirect'` is the single spelling throughout — Task 1 Step 4 defines it, Tasks 3 and 4 consume it. `DataTier` and `Line['tier']` stay distinct types that happen to carry the same values, as today.

**One risk worth naming.** Task 2 leaves the website non-compiling between commits, deliberately, so the type error enumerates Task 3's work. If the implementer would rather not commit that state, folding 2 and 3 together is fine — but the enumeration must still happen and be reported, because `if`-based comparisons like `verifiedInputOf`'s are invisible to it and are exactly where the `csvRows` throw comes from.
