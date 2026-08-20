# Refusal Codes and Reachability Guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two latent engine defects and two misleading comments, then install a guard so "a user-facing string nobody reads" and "a comment asserting an unmeasured corpus fact" cannot recur silently.

**Architecture:** Four small fixes plus two tests. Three fixes and both tests land in the CBM engine and are re-vendored to the website; one comment fix is in `cbam-app.ts`, the website's only hand-editable engine file.

**Tech Stack:** TypeScript, vitest (CBM) · TypeScript, Astro, `node:test` (website).

**Spec:** `docs/superpowers/specs/2026-08-20-refusal-codes-and-reachability-design.md`

---

## Repos, branches, baselines

| | path | branch | baseline |
|---|---|---|---|
| CBM (engine) | `/Volumes/VSTSAMPLES/Projects/CBM` | create `fix/refusal-codes` from `main` (`d8d419f`) | `npx vitest run --exclude '**/*.integration.test.ts'` → **557 pass / 76 files** |
| Website | `/Volumes/VSTSAMPLES/Projects/angad-allroutes` | `fix/refusal-codes-and-reachability` (exists, off `main` `e3bb624`) | `npm run test:unit` → **489 pass** |

CBM's integration suite needs Docker and **cannot run locally**. CI runs it. Never report it as locally verified.

The website worktree already has a real `node_modules`. If it is ever recreated it must be a **real `npm install`, never a symlink** — Astro's `normalizeFilename` mangles `.astro` paths reached through one and the build dies.

## Standing constraints

1. **`src/scripts/cbam-algos/` on the website is vendored** byte-for-byte and hash-guarded by `scripts/cbam-sync-check.mjs`. Only `cbam-app.ts` is hand-editable. Everything else is copied from CBM and re-recorded.
2. **Mutation-verify every fix, and grep the file to confirm the mutation landed before trusting the run.** A substitution in this project once silently failed to match and produced a fully green suite that looked like a passing mutation.
3. **Check exit codes. Never judge a run by its trailing summary.** A Playwright run here printed "32 passed" while 75 of 107 failed, and a `| tail` hid it twice.
4. **Never state a count from memory — measure it.**
5. **Hand-type test expectations.** A test that imports the value it asserts on passes whatever that value becomes.
6. **Do not add a code path no input can reach.** This plan exists because of unreachable code; adding more would be self-defeating. Where this plan declines to add something, it says so and why.

---

## Task 1: CBM — a bad verified figure stops reporting `BAD_MASS`

**Files:**
- Modify: `lib/cbam/certificate-estimate.ts` (the `EstimateFailureCode` union; the `FAILURE_MESSAGES` record)
- Modify: `lib/estimator/estimate-from-pack.ts` (two `unavailableEstimate` call sites)
- Test: `lib/estimator/estimate-from-pack.test.ts`

**The defect, measured.** `'BAD_MASS'` is passed *explicitly* as the fifth argument at `estimate-from-pack.ts:700` and `:726`, for an unreadable **verified figure**. The selector correctly says `verified/...`; only the machine-readable code is wrong. Reproduced:

```
bad verified figure -> code: BAD_MASS  selector: verified/2507008080/directTco2ePerT
bad mass            -> code: BAD_MASS  selector: mass/2507008080/2026-02-15
```

Latent, not live: the UI keys on the selector (`inputRefusal` tests `/^(mass|verified)\//`), so nothing shows a user the wrong thing today. **Blast radius measured: 2 references to `failure.code` in the whole website, both in `tests/unit/cbam-render.test.mjs`, both asserting `NO_DIRECT_DEFAULT`. Zero in CBM `src/` or `api/`.**

- [ ] **Step 1: Confirm the baseline**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git checkout -b fix/refusal-codes main
npx vitest run --exclude '**/*.integration.test.ts' 2>&1 | grep -E "Tests |Test Files"
```
Expected: `Tests 557 passed (557)`, `Test Files 76 passed (76)`. If it differs, stop and report.

- [ ] **Step 2: Write the failing test**

Append to `lib/estimator/estimate-from-pack.test.ts`. The file already binds a module-level `pack`; reuse it.

```ts
describe('an unreadable verified figure is not a bad mass', () => {
  // Asserted through a REAL estimate, never through failureMessage(code). A test that calls the
  // accessor proves only that a Record lookup works — which is exactly how a wording fix once
  // landed on a string 0 of 347,040 refusals carried.
  const line = {
    cn: '2507008080', country: 'DZ', route: 'default',
    massT: '100', date: '2026-02-15',
  } as const

  it('reports BAD_VERIFIED, with the selector naming the field', () => {
    const out = estimateFromPack(pack, { ...line, verified: { directTco2ePerT: 'abc' } })
    expect(out.status).toBe('unavailable')
    expect(out.failure?.code).toBe('BAD_VERIFIED')
    expect(out.failure?.selector).toBe('verified/2507008080/directTco2ePerT')
  })

  it('reports BAD_VERIFIED for an unreadable attested INDIRECT figure too', () => {
    const out = estimateFromPack(pack, {
      ...line, scope: 'direct_and_indirect',
      verified: { directTco2ePerT: '1.9', indirectTco2ePerT: 'zzz' },
    })
    expect(out.failure?.code).toBe('BAD_VERIFIED')
    expect(out.failure?.selector).toBe('verified/2507008080/indirectTco2ePerT')
  })

  it('still reports BAD_MASS for an actual bad mass — the arm that must not be lost', () => {
    const out = estimateFromPack(pack, { ...line, massT: '-5' })
    expect(out.failure?.code).toBe('BAD_MASS')
    expect(out.failure?.selector).toBe('mass/2507008080/2026-02-15')
  })
})
```

Confirm the exact input shape against a neighbouring test before running — if `scope` or `verified` are named differently, follow the real code and say so in your report.

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run lib/estimator/estimate-from-pack.test.ts 2>&1 | grep -E "Tests |×"
```
Expected: the first two fail (`BAD_MASS` received where `BAD_VERIFIED` expected); the third passes.

- [ ] **Step 4: Add the code**

In `lib/cbam/certificate-estimate.ts`, add to the `EstimateFailureCode` union, after `'BAD_MASS'`:

```ts
  | 'BAD_VERIFIED'
```

and to `FAILURE_MESSAGES`, beside the `BAD_MASS` entry:

```ts
  // The importer's OWN attested figure is unreadable — a different problem from an unreadable
  // tonnage, and the two were sharing a code. The selector always said `verified/`; only this
  // machine-readable half disagreed with it.
  BAD_VERIFIED: BAD_VERIFIED_MESSAGE,
```

Define `BAD_VERIFIED_MESSAGE` next to the other message constants in that file, matching the wording `estimate-from-pack.ts` already ships in `BAD_VERIFIED_REASON` so the two cannot drift:

```ts
const BAD_VERIFIED_MESSAGE =
  'A verified emissions figure must be a readable number of tCO2e per tonne of good, and cannot '
  + 'be negative, so no estimate is shown. Reading a missing, unreadable, infinite or negative '
  + 'figure as anything at all would put a number on a liability the figure does not support.'
```

**Then check whether `estimate-from-pack.ts`'s own `BAD_VERIFIED_REASON` is now a duplicate of this constant.** If it is, delete it and have both call sites pass `failureMessage('BAD_VERIFIED')` — two constants meaning one thing is the exact defect the last round removed. Report which you did and why.

- [ ] **Step 5: Fix the two call sites**

In `lib/estimator/estimate-from-pack.ts`, at both sites, change the fifth argument from `'BAD_MASS'` to `'BAD_VERIFIED'`:

```ts
        `verified/${input.cn}/directTco2ePerT`, 'BAD_VERIFIED',
```
```ts
            `verified/${input.cn}/indirectTco2ePerT`, 'BAD_VERIFIED',
```

**Do NOT add a `verified/` arm to `failureCodeForSelector`.** Both call sites pass the code explicitly, so the arm would never execute — measured, not assumed: grep for every `verified/` selector construction and confirm each passes an explicit code. Adding an unreachable branch is the defect this plan exists to prevent. Record the grep result in your report.

- [ ] **Step 6: Run and confirm green**

```bash
npx vitest run lib/estimator/estimate-from-pack.test.ts 2>&1 | grep -E "Tests |×"
npx vitest run --exclude '**/*.integration.test.ts' 2>&1 | grep -E "Tests |Test Files"
npm run typecheck >/dev/null 2>&1 && echo "typecheck: PASS" || echo "typecheck: FAIL"
```
Expected: suite at least 557 + 3. Report the exact number and classify any moved expectation as stale or regression.

- [ ] **Step 7: Mutation-verify**

Revert one call site to `'BAD_MASS'`, grep to confirm the mutation landed, confirm the matching test goes red and the bad-mass test stays green. Restore; confirm `git diff` shows only intended changes.

- [ ] **Step 8: Commit**

```bash
git add lib/cbam/certificate-estimate.ts lib/estimator/estimate-from-pack.ts lib/estimator/estimate-from-pack.test.ts
git commit -m "fix(cbam): an unreadable verified figure stops reporting BAD_MASS"
```

---

## Task 2: CBM — the verified path consults classification

**Files:**
- Modify: `lib/estimator/estimate-from-pack.ts` (the `if (input.verified)` branch, around `:678`)
- Test: `lib/estimator/estimate-from-pack.test.ts`

**The defect, measured** at `country=DZ, route=default, date=2026-02-15, verified={directTco2ePerT:'1.9'}, massT=100`:

| CN | `isOfferedGood` | `routesFor` | result |
|---|---|---|---|
| `25070080` (8-digit stem) | **false** | `[]` | **prices — 190 tCO2e, full provenance stamp** |
| `2507008080` (TARIC) | true | `["default"]` | prices — correct |
| `27160000` (electricity) | false | `[]` | `zero_by_fiat` |
| `99999999`, `7601`, `2523` | false | `[]` | refuse — correct |

`25070080` is one of exactly three 8-digit stems the UI tells users are **not** offered goods. `isOfferedGood` (`:173`) matches an exact classification or a strictly shorter prefix; all classifications are 8 or 10 digits, so it correctly returns false — the verified branch simply never calls it.

- [ ] **Step 1: Decide the electricity question by measurement, before writing anything**

The spec assumed a carve-out for `27160000`. Measurement since suggests it may be unnecessary: the **defaults** path already refuses electricity, and only the verified path prices it. Determine and report:

- Does any test, in either repo, assert that `27160000` prices or returns `zero_by_fiat` through `estimateFromPack`? Grep both repos.
- Is `27160000` reachable from the shipped form? (`routesFor` returns `[]` and `run()` gates on `!route.value` — confirm, do not assume.)
- Does CBM's `api/services/certificate-estimate.ts` reach the `sefa` electricity path by a route that does **not** go through `estimateFromPack`?

**Then take the simple option unless the measurement forbids it: gate on `isOfferedGood` with NO carve-out.** A pack that does not classify electricity as an offered good should not price it, and a carve-out would put a second place in the codebase deciding what electricity is. **If any of the three checks shows the carve-out is required, STOP and report** rather than dropping behaviour someone depends on.

- [ ] **Step 2: Write the failing test**

```ts
describe('the verified path does not price a good the pack does not offer', () => {
  const V = { directTco2ePerT: '1.9' } as const
  const line = { country: 'DZ', route: 'default', massT: '100', date: '2026-02-15' } as const

  it('refuses the 8-digit stem the UI says is not an offered good', () => {
    // 25070080 is one of exactly three stems the pack lists only as 10-digit TARIC codes.
    // It priced at 190 tCO2e with a full provenance stamp, because the verified branch never
    // consulted isOfferedGood and the lookup matched on prefix. Fail-open in a fail-closed engine.
    const out = estimateFromPack(pack, { ...line, cn: '25070080', verified: V })
    expect(out.status).toBe('unavailable')
  })

  it('still prices the TARIC code the pack does offer', () => {
    // The regression guard: the fix must reject the stem WITHOUT rejecting the real good.
    const out = estimateFromPack(pack, { ...line, cn: '2507008080', verified: V })
    expect(out.status).not.toBe('unavailable')
  })
})
```

If Step 1 concludes a carve-out **is** required, add a third test naming it explicitly in its title so a future tidy-up cannot silently remove it, e.g. `it('still returns zero_by_fiat for electricity — a deliberate regulatory carve-out, not an oversight')`.

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run lib/estimator/estimate-from-pack.test.ts 2>&1 | grep -E "Tests |×"
```
Expected: the stem test fails (`cscf_pending` received, `unavailable` expected); the TARIC test passes.

- [ ] **Step 4: Add the gate**

At the top of the `if (input.verified)` branch in `lib/estimator/estimate-from-pack.ts`, before `verifiedStamp` is built:

```ts
    // THE PACK DECIDES WHAT IS AN OFFERED GOOD, on the verified path as on the defaults path.
    // This branch never consulted isOfferedGood, so a CN the pack does not classify still priced
    // whenever the lookup matched on prefix: 25070080 — one of exactly three 8-digit stems the UI
    // tells users are NOT offered goods — returned 190 tCO2e with a full provenance stamp.
    // Fail-open in a fail-closed engine. The form cannot reach it (routesFor returns []), but the
    // engine is a vendored artefact with a second caller, so the gate belongs here, not in the UI.
    if (!isOfferedGood(pack, input.cn)) {
      return unavailableEstimate(
        baseInput(pack, input, mass.toFixed(), date.day, null), tables,
        failureMessage('NO_DIRECT_DEFAULT'), `default/${input.cn}`, 'NO_DIRECT_DEFAULT',
      )
    }
```

**Confirm the refusal shape against a neighbouring `unavailableEstimate` call before writing it** — argument order, whether `baseInput` needs the tier, and whether `NO_DIRECT_DEFAULT` is the honest code here or whether a clearer one already exists. If the selector `default/<cn>` reads wrong for "not an offered good", pick the accurate one and say why in your report; do not invent a new failure code without measuring who consumes it.

- [ ] **Step 5: Run and confirm green**

```bash
npx vitest run --exclude '**/*.integration.test.ts' 2>&1 | grep -E "Tests |Test Files"
npm run typecheck >/dev/null 2>&1 && echo "typecheck: PASS" || echo "typecheck: FAIL"
```

- [ ] **Step 6: Measure the blast radius across the corpus**

Sweep every classified good on the verified path, both scopes, at 2026-02-15, before and after. **Expected: zero classified goods change status.** Report the count swept. Also report how many unclassified CNs now refuse that previously priced — that is the fix's value, and it should be a small, nameable set.

- [ ] **Step 7: Mutation-verify, then commit**

Remove the gate, grep to confirm, confirm the stem test goes red and the TARIC test stays green, restore.

```bash
git add lib/estimator/estimate-from-pack.ts lib/estimator/estimate-from-pack.test.ts
git commit -m "fix(cbam): the verified path stops pricing goods the pack does not offer"
```

---

## Task 3: CBM — correct three false claims in engine comments

**Files:**
- Modify: `lib/estimator/estimate-from-pack.ts` (`:86-87`, `:747-750`)
- Modify: `lib/cbam/certificate-estimate.ts` (`:41-45`)

Comment-only. No behaviour changes, so no new test — the numbers these comments cite are pinned by Task 5 instead.

**The false claim, measured.** All three say the Commission publishes no indirect default at all for **iron & steel** and aluminium. CN **26011200** (agglomerated iron ores, sector `iron_and_steel`) carries **84 published indirect value rows across 28 origins** and prices live: IN 5.5, CN 6.6, DZ 3.3 tCO2e on a 100 t line. Aluminium is genuinely zero. The sector that actually publishes nothing is **hydrogen**, which none of them names.

- [ ] **Step 1: Re-measure before editing**

Do not take the numbers above on trust. For each sector, count published indirect value rows on the shipped pack and report the table. If 26011200 no longer carries 84 rows, report what it does carry and correct the wording to that.

- [ ] **Step 2: Rewrite the three sites**

`lib/estimator/estimate-from-pack.ts:86-87` currently reads:

```ts
 * `none` means the Commission publishes no default for this good at all — true of iron & steel
 * and aluminium on the indirect side, which must keep pricing with indirect 0. `route-mismatch`
```

Replace the claim with the measured one — that `none` means no indirect default for that good, that this is true of **aluminium and hydrogen** but **not** of iron & steel as a sector (naming 26011200 and its measured row count as the counter-example), and keep the operative rule that such goods must keep pricing with indirect 0.

`lib/estimator/estimate-from-pack.ts:747-750` and `lib/cbam/certificate-estimate.ts:41-45` carry the same "(iron & steel, aluminium)" parenthetical. Correct both the same way. Keep each comment's own surrounding argument intact — only the sector claim is wrong.

- [ ] **Step 3: Confirm nothing else changed, and commit**

```bash
git diff --stat
npx vitest run --exclude '**/*.integration.test.ts' >/dev/null 2>&1 && echo "SUITE: PASS" || echo "SUITE: FAIL"
git add lib/estimator/estimate-from-pack.ts lib/cbam/certificate-estimate.ts
git commit -m "docs(cbam): iron and steel does publish indirect defaults — hydrogen is the zero"
```
Body: the measured per-sector row counts.

---

## Task 4: CBM — the reachability guard

**Files:**
- Create: `lib/cbam/message-reachability.test.ts`

Every user-facing string must be produced by a real call, or sit on an allow-list with a written reason.

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { estimateFromPack, routesFor, type EstimatorPack } from '../estimator/estimate-from-pack'
import { validateEstimatorPack } from '../estimator/pack-v2'
import * as CE from './certificate-estimate'

const pack = validateEstimatorPack(
  JSON.parse(readFileSync('public/estimator-pack.json', 'utf8')),
) as EstimatorPack

/**
 * Constants no input can produce, each with the reason. A string on this list is NOT dead code to
 * delete — most are live in CBM's API service, which the website does not vendor.
 */
const ALLOWED_UNREACHABLE: Record<string, string> = {
  NO_SNAPSHOT_SCOPE_REASON: 'Only consumer is api/services/certificate-estimate.ts, not vendored.',
  NO_PRECURSOR_REASON: 'Same; estimateFromPack passes precursors: [] at both call sites.',
  INDIRECT_UNSUPPORTED: "Needs emissionsType 'indirect'; baseInput hardcodes 'direct'.",
  AMBIGUOUS_REASON:
    'Fail-closed guard for a corpus defect. 0 duplicate rows ship today, so nothing can '
    + 'produce it — it becomes live the day a duplicate does. Not dead code.',
}

function sweep(): Set<string> {
  const seen = new Set<string>()
  const add = (v: unknown) => { if (typeof v === 'string' && v.length > 20) seen.add(v) }
  const goods = ['2507008080', '2523100090', '72061000', '28041000', '76041010', '31021010']
  const origins = ['DZ', 'IN', 'AF', 'OTHER']
  const dates = ['2026-02-15', '2027-03-15', '2029-06-15', 'not-a-date']
  const masses = ['100', '-5', '', 'abc']
  const verifieds = [undefined, { directTco2ePerT: '1.9' }, { directTco2ePerT: 'abc' }]
  for (const cn of goods) for (const country of origins) {
    const routes = routesFor(pack, cn, country, 2026)
    for (const route of [routes[0] ?? 'default', '(K)'])
      for (const date of dates) for (const massT of masses) for (const verified of verifieds)
        for (const scope of ['direct', 'direct_and_indirect'] as const) {
          let out: Record<string, unknown>
          try {
            out = estimateFromPack(pack, {
              cn, country, route, date, massT, scope, ...(verified ? { verified } : {}),
            }) as unknown as Record<string, unknown>
          } catch { continue }
          add(out.reason)
          add((out.failure as { message?: unknown } | undefined)?.message)
          for (const n of ((out.stamp as { notes?: unknown[] } | undefined)?.notes ?? [])) add(n)
        }
  }
  return seen
}

describe('every user-facing string is reachable, or listed as not', () => {
  const produced = sweep()

  it('the collector actually collects — proven before any zero is trusted', () => {
    // A zero from a broken sweep is byte-identical to a real zero. An earlier harness in this
    // project returned zero routes for every good because it built index keys with the wrong
    // separator, and looked entirely healthy doing it.
    expect(produced.size).toBeGreaterThan(3)
    expect([...produced].some(s => s.includes('no applicable direct default value'))).toBe(true)
  })

  it('no exported message constant is silently unreachable', () => {
    const missing = Object.entries(CE)
      .filter(([k, v]) => typeof v === 'string' && v.length > 20 && !(k in ALLOWED_UNREACHABLE))
      .filter(([, v]) => ![...produced].some(p => p === v))
      .map(([k]) => k)
    expect(missing).toEqual([])
  })
})
```

**Before running, confirm every assumption in that code**: the pack path, that `CE` really exports the constants as strings, the input field names, and that `'(K)'` is a route no good in the sample offers. Correct anything that differs and say so — a guard built on a wrong assumption is worse than none.

- [ ] **Step 2: Run it**

```bash
npx vitest run lib/cbam/message-reachability.test.ts 2>&1 | grep -E "Tests |×"
```
If `missing` is non-empty, **do not simply add the names to the allow-list.** For each, either widen the sweep until it is produced, or establish structurally that nothing can produce it and write that reason on the list. Report which you did for each.

- [ ] **Step 3: Prove the guard bites**

Add a throwaway exported constant that nothing produces, confirm the test fails naming it, then delete it. Grep-confirm both the addition and the removal. A guard that cannot fail is not a guard.

- [ ] **Step 4: Check the runtime cost, then commit**

```bash
npx vitest run lib/cbam/message-reachability.test.ts 2>&1 | grep -E "Duration|Tests "
```
Report the duration. If it exceeds ~10 s, shrink the sample rather than raising a timeout — this runs on every CI push.

```bash
git add lib/cbam/message-reachability.test.ts
git commit -m "test(cbam): fail when a user-facing string has no producing path"
```

---

## Task 5: CBM — canonical corpus facts

**Files:**
- Create: `lib/estimator/corpus-facts.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { validateEstimatorPack } from './pack-v2'

const pack = validateEstimatorPack(JSON.parse(readFileSync('public/estimator-pack.json', 'utf8')))

/**
 * The scalars comments quote. Pinned here so a comment citing one is checkable against a single
 * source of truth rather than against a number somebody measured once and never re-measured.
 *
 * An audit found 574 vs 572 goods, 120 vs 122 origins, "58 tests" vs 307, "~94% cscf_pending" vs
 * 100%, and "183 of 574 goods" vs 0-2 — individually cosmetic, collectively the reason no number
 * in these files could be trusted, which is what made two genuinely dangerous comments dangerous.
 *
 * When one of these legitimately changes, update it HERE and then grep the repos for the old
 * value. That grep is the point of the file.
 */
describe('corpus facts the comments rely on', () => {
  it('pins the scalars', () => {
    expect(pack.classifications.length).toBe(572)
    expect(pack.defaultValues.length).toBe(76428)
    expect(pack.benchmarks.length).toBe(2465)
    expect(new Set(pack.publishedOriginSheets).size).toBe(121)
  })
})
```

**Measure each value before committing it** — hand-type what you measure, do not paste these. If any differs, the plan's number is stale: use yours and say so. The origin count is deliberately expressed as published sheets (121); comments quoting **122** mean sheets plus `OTHER`, and that relationship should be stated in the file so the two numbers stop being confused.

- [ ] **Step 2: Run, prove it bites, commit**

```bash
npx vitest run lib/estimator/corpus-facts.test.ts 2>&1 | grep -E "Tests |×"
```
Change one expectation by one, confirm it fails, restore.

```bash
git add lib/estimator/corpus-facts.test.ts
git commit -m "test(cbam): pin the corpus scalars the comments quote"
```

---

## Task 6: CBM — push, CI, merge

- [ ] **Step 1: Push and open a PR**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git push -u origin fix/refusal-codes
gh pr create --base main --head fix/refusal-codes \
  --title "fix(cbam): refusal codes, the classification gate, and a reachability guard" \
  --body "<summarise the measurements: the two fixed defects, the corrected claims, and both guards>"
```

- [ ] **Step 2: Watch CI to completion**

```bash
gh pr checks --watch
```
CI runs the Postgres integration suite, which cannot run locally. Report that CI verified it, not that you did.

- [ ] **Step 3: Merge and capture the full SHA**

```bash
gh pr merge --squash --delete-branch
git checkout main && git pull --ff-only && git rev-parse HEAD
```
Task 7 pins `UPSTREAM.json` to this merge commit — a squash discards the branch commit, so pinning to that would pass locally and fail from a clean clone.

---

## Task 7: Website — re-vendor, and the two `cbam-app.ts` fixes

**Files:**
- Modify: `src/scripts/cbam-algos/**` (copied, never hand-edited), `src/scripts/cbam-algos/UPSTREAM.json`
- Modify: `src/scripts/cbam-algos/cbam-app.ts` (`:1962-1971`, `:1955`)
- Create: `tests/unit/corpus-facts.test.mjs`

- [ ] **Step 1: Re-vendor**

```bash
cd /Volumes/VSTSAMPLES/Projects/angad-allroutes
CBM=/Volumes/VSTSAMPLES/Projects/CBM
for f in $(cd src/scripts/cbam-algos && find . -name '*.ts' | sed 's|^\./||'); do
  [ -f "$CBM/lib/$f" ] && cp "$CBM/lib/$f" "src/scripts/cbam-algos/$f"
done
CBAM_UPSTREAM_COMMIT=<full 40-char merge SHA> node scripts/cbam-sync-check.mjs --update
node scripts/cbam-sync-check.mjs && echo "SYNC_OK" || echo "SYNC_FAIL"
```
The flag is `--update`, not `--record`. **`cbam-app.ts` is excluded from the copy** — it is the hand-editable file and CBM has no counterpart. Confirm the loop did not overwrite it.

- [ ] **Step 2: Fix the `route-mismatch` comment**

`cbam-app.ts:1962-1971` claims **ZERO** `route-mismatch` selectors, that the arm is reachable "only by calling the engine with a route the form would not offer", and instructs: *"Do not read this arm as exercised behaviour."*

Measured across every good x origin x form-offered route, 2026-2028: **520,560 selectors, 5,349 of them `route-mismatch`.** Witnesses at an ordinary 2026 date: `2523100010`/AE/`(A)` (available `["(B)"]`) and `2523100090`/AE/`(B)` (available `["(A)"]`).

**Re-measure both the count and the witnesses before writing them down.** Then rewrite the comment to say the arm IS exercised, give a witness, and **delete the invitation to narrow `kind !== 'none'` to `=== 'found'`** — doing that would hide the scope control on those selectors and price electricity at zero, an under-charge on a regulated filing.

Record *why* the old comment was true when written: `routesFor` used to offer only routes the direct table publishes, so the two tables did move together. The all-routes work added benchmark-derived routes and falsified it. A comment that was right and became wrong is worth marking as such, so the next reader knows the rule changed rather than that someone miscounted.

- [ ] **Step 3: Fix the iron-and-steel claim in the renderer**

`cbam-app.ts:1955` says the control showed "on steel and aluminium, which publish no indirect default at all". Correct it the same way as Task 3, using your measured numbers. Leave the surrounding argument about the `!== null` defect intact — only the sector claim is wrong.

- [ ] **Step 4: Add the website's corpus-facts test**

Mirror Task 5 in `tests/unit/corpus-facts.test.mjs`, using `node:test` and `node:assert/strict` to match the other files in `tests/unit/`, reading `public/cbam/estimator-pack.json`. Read a neighbouring test first and follow its idiom. Measure the values; do not copy them.

- [ ] **Step 5: Gates**

```bash
npm run build >/dev/null 2>&1 && echo "BUILD: PASS" || echo "BUILD: FAIL"
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"
npx astro check 2>&1 | tail -3
node scripts/cbam-sync-check.mjs >/dev/null 2>&1 && echo "SYNC_OK" || echo "SYNC_FAIL"
```
Expected: build clean; **489 + your new tests, 0 fail**; `astro check` **0 errors** (6 hints are pre-existing — report what you see); sync green. `test:unit` needs `dist/`, so build first.

- [ ] **Step 6: Commit**

```bash
git add src/scripts/cbam-algos/ tests/
git commit -m "feat(cbam): vendor the refusal-code fixes and correct two misleading comments"
```

---

## Task 8: Website — e2e, land, verify

- [ ] **Step 1: Full e2e**

```bash
npm run test:e2e >/tmp/e2e.log 2>&1; echo "EXIT=$?"; grep -E "^\s+[0-9]+ (passed|failed)" /tmp/e2e.log | tail -2
```
Expected: **111 passed, exit 0.** Check the exit code, not the summary line. If webkit is missing, `npx playwright install webkit` — a missing browser reads as 27 failures and is not one.

- [ ] **Step 2: PR, CI, merge**

```bash
git push -u origin fix/refusal-codes-and-reachability
gh pr create --base main --head fix/refusal-codes-and-reachability \
  --title "fix(cbam): refusal codes, the classification gate, and a reachability guard" \
  --body "<the measurements, and the note that no user-visible figure changes>"
gh pr checks --watch
```
**Do not merge on a red CI without establishing whether the failure pre-exists on `main`** — compare against `main`'s latest run for the same job before concluding anything.

- [ ] **Step 3: Verify the deploy**

Poll `https://deltaclimate.earth/cbam/cbam-calculator` with `Cache-Control: no-cache` and a delay between attempts. **Check for HTTP 200 before grepping** — a 404 greps as string-absent, which reads as a finding and is not one. Find the entry chunk referenced by the page, confirm its hash matches the local `dist/` build, and grep it for a string this change introduces. Grep for **strings, not identifiers** — the minifier renames those.

---

## Self-review

**Spec coverage.** Fix 1 → Task 1. Fix 2 → Task 2. Fix 3 → Task 7 Step 2. Fix 4 → Task 3 (three engine sites) and Task 7 Step 3 (the renderer site). Guard Part A → Task 4. Guard Part B → Task 5 and Task 7 Step 4. Vendoring order → Tasks 6 and 7.

**One deliberate divergence from the spec, flagged rather than silently taken.** The spec specified an electricity carve-out in Fix 2. Measurement since suggests it may be unnecessary — the defaults path already refuses `27160000`, and a carve-out would create a second place deciding what electricity is. Task 2 Step 1 therefore *decides it by measurement* and stops if the carve-out turns out to be load-bearing, rather than assuming either way.

**A second, smaller divergence.** The spec implied adding a `verified/` arm to `failureCodeForSelector`. Measurement shows both call sites pass the code explicitly, so that arm would be unreachable — and this plan exists because of unreachable code. Task 1 Step 5 declines it and requires the grep that proves it.

**Out of scope, per the spec:** the stale-scalar cluster; the 1,295 `route-mismatch` selectors that list the declared route inside `availableRoutes`; whether those 5,349 selectors are a corpus defect (a regulatory question).

**Type consistency.** `BAD_VERIFIED` is added to `EstimateFailureCode` in Task 1 and used only there and in tests. `isOfferedGood` already exists at `estimate-from-pack.ts:173` and is module-local — Task 2 uses it from inside the same file, so no export is needed. `ALLOWED_UNREACHABLE` is defined once, in Task 4.

**Known gap, stated rather than hidden.** CBM's integration suite cannot run locally; Task 6 is CI-only and must be reported as such.
