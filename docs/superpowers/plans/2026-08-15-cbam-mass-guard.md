# Fail-Closed Net Mass Guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `massT` becoming a figure without a gate — no negative bills, no `NaN` euros, no hex-parsed tonnages, and no Art 2(3) de-minimis determination made off an unreadable string.

**Architecture:** One predicate in the shared engine (`nonNegativeDecimal`, renamed from the existing `verifiedPerT`), applied at both engine entry points that consume mass, and then used by the website's own UI check so the gate and the consumer stop speaking different languages. The SaaS Vue store inherits the refusal without changing.

**Tech Stack:** TypeScript, decimal.js, vitest (CBM), `node:test` + `tsx` (website), Playwright (website e2e), Astro.

**Spec:** `docs/superpowers/specs/2026-08-15-cbam-mass-guard-design.md`

---

## Standing constraints — read before every task

- **Never hand-edit anything under `src/scripts/cbam-algos/` except `cbam-app.ts`.** That tree is a byte-for-byte vendored copy of `CBM/lib/`, hash-guarded by `scripts/cbam-sync-check.mjs` against `UPSTREAM.json` (11 files). Changes arrive only by `cp` from upstream. `cbam-app.ts` is the sole documented exception and is deliberately not among the 11.
- **Never `git add -A` or `git add .`.** In a worktree `node_modules` is a *symlink*, and `.gitignore`'s `node_modules/` (trailing slash) matches directories only — so `-A` stages it. Always stage by name.
- **Never run `npm ci` or `npm install` in the website worktree.** `node_modules` is a symlink into a shared checkout another agent owns.
- `npx astro check` reports **2 pre-existing errors**, both `Cannot find module 'mapillary-js'` in `street-view-panel.ts`. They are an artefact of the shared `node_modules` being installed from a branch that predates street-view; `mapillary-js` **is** in `origin/main`'s `package.json` and lockfile, so production is unaffected. **Do not try to make them disappear.** Confirm delta-zero instead.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `CBM/lib/estimator/estimate-from-pack.ts` | the predicate; both engine gates | 1, 2, 3 |
| `CBM/lib/estimator/mass-guard.test.ts` (new) | every mass rule, mutation-pinned | 2, 3 |
| `Angad/src/scripts/cbam-algos/estimator/estimate-from-pack.ts` | vendored copy (via `cp` only) | 4 |
| `Angad/src/scripts/cbam-algos/UPSTREAM.json` | hashes (via `--update` only) | 4 |
| `Angad/src/scripts/cbam-algos/cbam-app.ts` | UI check adopts the shared predicate | 4 |
| `Angad/tests/unit/cbam-render.test.mjs` | website-side pin | 4 |
| `Angad/tests/e2e/cbam-lines.spec.ts` | the DOM-layer mutation the unit suite cannot reach | 5 |

---

## Task 1: Rename the predicate (pure rename, no behaviour change)

**Files:**
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/estimate-from-pack.ts`

Work in `/Volumes/VSTSAMPLES/Projects/CBM` on a new branch:

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git checkout main && git pull --ff-only
git checkout -b fix/mass-guard
```

Baseline: **445 tests passing**, typecheck clean.

- [ ] **Step 1: Confirm the baseline before touching anything**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npm test 2>&1 | tail -3
npm run typecheck 2>&1 | tail -2
```
Expected: `Tests  445 passed (445)`, typecheck silent.

- [ ] **Step 2: Rename the function and export it**

At `lib/estimator/estimate-from-pack.ts:347`, change the declaration:

```ts
function verifiedPerT(value: string): Decimal | null {
```

to:

```ts
export function nonNegativeDecimal(value: string): Decimal | null {
```

Update its two call sites, at lines 412 and 422:

```ts
const direct = nonNegativeDecimal(input.verified.directTco2ePerT)
```
```ts
const indirect = nonNegativeDecimal(input.verified.indirectTco2ePerT)
```

The body does not change. **Do not alter the shape gate, the try/catch, `isFinite()` or `lt(0)`.**

- [ ] **Step 3: Rewrite its docblock to be field-agnostic**

The existing docblock at lines 330–346 opens *"A verified per-tonne figure this estimator may price"*. It now serves mass too. Replace the opening paragraph, **keeping every specific it already records** — the `0x10` bill, the `-394.58` certificate case, why the shape gate precedes `Decimal`:

```ts
/**
 * A non-negative decimal this estimator may price, or null when it may not. Used for the
 * verified per-tonne figures AND for net mass — one predicate, because they want exactly the
 * same rule and two similar ones is how they drift apart.
 *
 * There is no guard upstream and none downstream that speaks this language, so this is the one
 * that counts. `new Decimal('')` and `new Decimal('abc')` THROW, and they throw inside
 * estimateFromPack — before estimateCertificates is entered — so they escape that function's
 * fail-closed boundary entirely and reach the browser as an unhandled exception rather than a
 * refusal that names the gap. 'NaN' and 'Infinity' do not throw; they propagate through the
 * arithmetic and print as certificates and a euro cost. And the engine's floor clamp catches
 * none of it: figureFrom clamps the DIRECT side alone and then ADDS the indirect figure
 * (certificate-estimate.ts:154), so a negative value priced a NEGATIVE bill (-394.58
 * certificates, -EUR 29,735.55 on a real line; -EUR 331.58 via a -100 t mass). Nor is Decimal
 * itself the guard: it reads '0x10' as 16 and '1_000' as 1000, which is why the shape gate
 * below runs before it rather than after.
 *
 * Refusing, not clamping: a nonsense input silently turned into a priceable number is how a
 * wrong tax liability gets acted on. Zero is legal for both callers — a genuinely clean producer
 * attests it, and a 0 t line costs EUR 0.00, which is arithmetic rather than fabrication.
 */
```

Leave the two inline comments inside the function body exactly as they are.

- [ ] **Step 4: Verify nothing moved**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npm test 2>&1 | tail -3
npm run typecheck 2>&1 | tail -2
```
Expected: still `Tests  445 passed (445)`, typecheck clean. A rename that changes a test count means it was not a rename.

- [ ] **Step 5: Commit**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git add lib/estimator/estimate-from-pack.ts
git commit -m "refactor(estimator): verifiedPerT becomes nonNegativeDecimal

Net mass wants exactly this predicate, and two similar ones is how they drift
apart. Rename and export rather than wrap: a wrapper that adds nothing is
noise. Body unchanged; 445 tests unchanged."
```

---

## Task 2: Gate the estimate

**Files:**
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/estimate-from-pack.ts`
- Create: `/Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/mass-guard.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/estimator/mass-guard.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { estimateFromPack, nonNegativeDecimal, type EstimatorPack } from './estimate-from-pack'

// The real shipped pack, like every sibling estimator test — never a pasted copy of it.
const pack = JSON.parse(readFileSync('public/estimator-pack.json', 'utf8')) as EstimatorPack

// Cement clinker from Algeria, route (A), 2026-Q1. At 100 t this prices 75.865 certificates /
// EUR 5,717.19, so any figure below is a real number the guard has to be able to refuse.
//
// emissionsScope is EXPLICIT and load-bearing. EstimatorInput defaults it to 'direct', and on a
// direct-only line a -100 t mass prices EUR 0.00 rather than a negative — the floor clamp
// (Decimal.max(0, …), certificate-estimate.ts:154) catches the direct side on its own. The
// negative bill only exists because indirect is ADDED after that clamp. So a negative-mass test
// written against the default scope would assert against a zero and prove nothing.
const base = {
  cn: '25231000', country: 'DZ', route: '(A)', massT: '100', date: '2026-03-15',
  emissionsScope: 'direct_and_indirect' as const,
}

// Hand-typed, deliberately NOT imported from production. Importing would pin only WHICH constant
// is referenced, never what it says — and swapping one reason constant for another survived
// mutation testing twice in the fixes that preceded this one.
const BAD_MASS_TEXT =
  'Net mass must be a readable number of tonnes and cannot be negative, so no estimate is '
  + 'shown. Reading a missing, unreadable, infinite or negative mass as anything at all would '
  + 'scale a real tariff by a quantity nobody entered, and would decide the de minimis '
  + 'threshold the same way.'

describe('net mass is gated before it can become a figure', () => {
  it('still prices an ordinary mass — the guard must not cost anything', () => {
    const e = estimateFromPack(pack, base)
    expect(e.status).toBe('cscf_pending')
    if (e.status !== 'cscf_pending') return
    expect(e.scenario.certificates).toBe('75.865')
    expect(e.scenario.costEur).toBe('5717.19')
  })

  it('refuses a NEGATIVE mass instead of billing a negative amount', () => {
    // -100 t used to return cscf_pending with -4.4 certificates and -EUR 331.58. Not -75.865,
    // because the floor clamp covers the DIRECT side and then ADDS indirect — the same shape
    // that produced -394.58 certificates from a negative verified figure.
    const e = estimateFromPack(pack, { ...base, massT: '-100' })
    expect(e.status).toBe('unavailable')
    if (e.status !== 'unavailable') return
    expect(e.reason).toBe(BAD_MASS_TEXT)
    expect('scenario' in e).toBe(false)
  })

  it('refuses unreadable masses instead of throwing a raw DecimalError at the browser', () => {
    // These THREW before: `new Decimal('')` and `new Decimal('abc')` escape the engine's
    // fail-closed boundary entirely and surfaced as "[DecimalError] Invalid argument: abc" in
    // the refusal card, which is a library's words, not a refusal that names the gap.
    for (const massT of ['', 'abc', '  100  ']) {
      const e = estimateFromPack(pack, { ...base, massT })
      expect(e.status, `massT=${JSON.stringify(massT)}`).toBe('unavailable')
    }
  })

  it('refuses NaN and Infinity, which printed AS figures rather than throwing', () => {
    // Neither throws in Decimal; both propagated and rendered "certificates=NaN, EUR=NaN".
    for (const massT of ['NaN', 'Infinity', '-Infinity']) {
      const e = estimateFromPack(pack, { ...base, massT })
      expect(e.status, `massT=${JSON.stringify(massT)}`).toBe('unavailable')
    }
  })

  it('refuses radix prefixes and separators — the reason the gate precedes Decimal', () => {
    // Decimal honours JS numeric literal syntax, so each of these was a confident bill for a
    // tonnage nobody typed: 0x10 -> 16 t (EUR 914.75), 0b101 -> 5 t, 0o17 -> 15 t,
    // 1_000 -> 1000 t (EUR 57,171.86).
    for (const massT of ['0x10', '0b101', '0o17', '1_000']) {
      const e = estimateFromPack(pack, { ...base, massT })
      expect(e.status, `massT=${JSON.stringify(massT)}`).toBe('unavailable')
    }
  })

  it('keeps ZERO legal — 0 t costs EUR 0.00, which is arithmetic, not fabrication', () => {
    const e = estimateFromPack(pack, { ...base, massT: '0' })
    expect(e.status).toBe('cscf_pending')
    if (e.status !== 'cscf_pending') return
    expect(e.scenario.costEur).toBe('0.00')
  })

  it('accepts the shapes a numeric field really produces', () => {
    // No maximum: 1e9 t costs what 1e9 t costs. Refusing large-but-valid numbers would be
    // inventing policy the regulation does not contain.
    for (const massT of ['100', '0.5', '1e3', '1e9', '-0']) {
      const e = estimateFromPack(pack, { ...base, massT })
      expect(e.status, `massT=${JSON.stringify(massT)}`).toBe('cscf_pending')
    }
  })

  it('refuses a negative mass on a DIRECT-only line too, where it used to price EUR 0.00', () => {
    // The gate must not depend on scope. Before it, this line returned a confident EUR 0.00 —
    // the floor clamp swallowing a negative into a zero, which reads as "you owe nothing" rather
    // than "that mass is not a mass". Different symptom from the direct_and_indirect case above,
    // same cause, and only this arm catches a gate placed inside the indirect branch.
    const e = estimateFromPack(pack, { ...base, emissionsScope: 'direct' as const, massT: '-100' })
    expect(e.status).toBe('unavailable')
  })

  it('gates the VERIFIED path too — the guard sits above the branch', () => {
    // Mass multiplies on both paths, so gating inside either would leave the other open.
    const e = estimateFromPack(pack, {
      ...base, massT: '-100', verified: { directTco2ePerT: '1.5' },
    })
    expect(e.status).toBe('unavailable')
    if (e.status !== 'unavailable') return
    expect(e.reason).toBe(BAD_MASS_TEXT)
  })

  it('exposes the predicate so a UI can decide with the same function it consumes with', () => {
    expect(nonNegativeDecimal('100')?.toFixed()).toBe('100')
    expect(nonNegativeDecimal('0x10')).toBeNull()
    expect(nonNegativeDecimal('')).toBeNull()
    expect(nonNegativeDecimal('-1')).toBeNull()
    expect(nonNegativeDecimal('0')?.toFixed()).toBe('0')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npx vitest run lib/estimator/mass-guard.test.ts 2>&1 | tail -20
```
Expected: FAIL. The negative case reports `expected 'cscf_pending' to be 'unavailable'`; the `''` and `'abc'` cases throw `[DecimalError] Invalid argument`.

- [ ] **Step 3: Add the reason constant**

In `lib/estimator/estimate-from-pack.ts`, directly after `BAD_VERIFIED_REASON` (which ends at line 25):

```ts
const BAD_MASS_REASON =
  'Net mass must be a readable number of tonnes and cannot be negative, so no estimate is ' +
  'shown. Reading a missing, unreadable, infinite or negative mass as anything at all would ' +
  'scale a real tariff by a quantity nobody entered, and would decide the de minimis ' +
  'threshold the same way.'
```

It must read differently from `BAD_VERIFIED_REASON`, `NO_DEFAULT_REASON` and `NO_INDIRECT_ROUTE_REASON`: the user is told which field to fix, and the de-minimis clause is what distinguishes mass from every other refusal.

- [ ] **Step 4: Gate the estimate, above the branch**

In `estimateFromPack`, immediately after the `baseInput` object literal closes and **before** `if (input.verified) {`:

```ts
  // ABOVE the branch, deliberately: both paths multiply by mass, so gating inside either would
  // leave the other open. `tier` reports what the CALLER asked for — the refusal produces no
  // figure, so there is nothing to attribute and `originBasis` is null on either path.
  if (!nonNegativeDecimal(input.massT)) {
    const tier = input.verified ? 'actual-verified' as const : 'default+markup' as const
    return unavailableEstimate(
      { ...baseInput, tier, originBasis: null }, tables, BAD_MASS_REASON,
      `mass/${input.cn}/${input.date}`,
    )
  }
```

The selector carries locating context but **never the rejected value** — every sibling selector (`verified/${cn}/directTco2ePerT`, `default/${cn}/${country}/${route}/${year}`) names where the problem is, and echoing user input into a rendered field is a hazard the reason text already avoids.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npx vitest run lib/estimator/mass-guard.test.ts 2>&1 | tail -6
npm test 2>&1 | tail -3
npm run typecheck 2>&1 | tail -2
```
Expected: the new file green; whole suite **445 + 9 = 454 passing**; typecheck clean. If any pre-existing test now fails, **stop and report it** — it means a test was relying on an ungated mass, and that is a finding, not something to edit away.

- [ ] **Step 6: Prove each rule is load-bearing**

Apply each mutation, confirm the *named* test fails, then restore precisely:

| mutation | must fail |
|---|---|
| delete the `if (!nonNegativeDecimal(input.massT))` block | negative / unreadable / radix tests |
| in `nonNegativeDecimal`, delete the shape-gate `if (!/^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(value)) return null` | the radix test (`0x10` prices 16 t) |
| change `parsed.lt(0)` to `parsed.lt(-1)` | the negative test |
| delete `!parsed.isFinite() ||` | the NaN/Infinity test |
| swap `BAD_MASS_REASON` for `BAD_VERIFIED_REASON` in the new block | the pinned-text assertion |

Report each failing output. After restoring, re-run `npm test` and confirm 454 green.

- [ ] **Step 7: Commit**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git add lib/estimator/estimate-from-pack.ts lib/estimator/mass-guard.test.ts
git commit -m "fix(estimator): refuse a mass that cannot become a figure

-100 t priced -4.4 certificates and -EUR 331.58; '' and 'abc' threw a raw
DecimalError past the fail-closed boundary and into the refusal card; NaN and
Infinity rendered AS figures; and 0x10 priced 16 t because Decimal honours JS
radix prefixes.

Gated above the verified/defaults branch, because both paths multiply by mass.
Zero stays legal and there is no maximum. Each rule mutation-verified."
```

---

## Task 3: Gate the threshold

**Files:**
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/estimate-from-pack.ts:243-258`
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/mass-guard.test.ts`

This is the more serious half. `resolveThreshold` makes an Art 2(3) de-minimis determination — a statement about whether CBAM applies **at all** — from the same raw string, and it does not degrade safely:

```
massT="100"    state=above_threshold
massT="0x64"   state=above_threshold     <- identical, off a hex string
massT="1_000"  state=above_threshold
massT=""       THREW
```

- [ ] **Step 1: Write the failing tests**

Append to `lib/estimator/mass-guard.test.ts`:

```ts
import { resolveThreshold } from './estimate-from-pack'

describe('the de-minimis threshold is not decided on an unreadable mass', () => {
  const t = (massT: string) =>
    resolveThreshold(pack, { cn: '25231000', massT, date: '2026-03-15' })

  it('still answers for an ordinary mass', () => {
    expect(t('100')?.state).toBe('above_threshold')
    expect(t('40')?.state).toBe('indeterminate')
  })

  it('does NOT read 0x64 as 100 tonnes', () => {
    // The sharpest case in this file. 0x64 answered `above_threshold` exactly as if the user had
    // typed 100 — an Art 2(3) determination off a hex string. An earlier `indeterminate` on
    // 0x10 was not the guard working; 16 is simply below 50.
    expect(t('0x64')).toBeNull()
    expect(t('0x10')).toBeNull()
    expect(t('1_000')).toBeNull()
  })

  it('returns null rather than throwing on an unreadable mass', () => {
    // 'Infinity' is the sharpest of these: it did not throw, it returned
    // state='above_threshold' with knownEligibleMassT='Infinity' — and
    // ThresholdRulerCard.vue:9 renders that value RAW at 52px. A user was shown
    // "Infinity" as their eligible mass, above the de-minimis threshold.
    //
    // '1e9999999999999999' is all digits, so it clears the shape gate, and decimal.js
    // SATURATES it to Infinity past Decimal.maxE (9e15). It is the only path by which
    // isFinite() is load-bearing — 'NaN' and 'Infinity' never reach it, the shape gate
    // having refused them for carrying no digits.
    for (const massT of ['', 'abc', '  100  ', 'NaN', 'Infinity', '1e9999999999999999']) {
      expect(() => t(massT), `massT=${JSON.stringify(massT)}`).not.toThrow()
      expect(t(massT), `massT=${JSON.stringify(massT)}`).toBeNull()
    }
  })

  it('refuses a negative mass rather than placing it against the threshold', () => {
    expect(t('-100')).toBeNull()
  })

  it('keeps zero answerable — 0 t is genuinely below the threshold', () => {
    expect(t('0')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npx vitest run lib/estimator/mass-guard.test.ts -t 'de-minimis' 2>&1 | tail -20
```
Expected: FAIL — `0x64` returns an object with `state: 'above_threshold'` where `null` was expected, and the `''` case throws.

- [ ] **Step 3: Gate it**

In `resolveThreshold`, after the `sector` guard and **before** `evaluateThreshold` is called:

```ts
  const sector = sectorForCn(input.cn)
  if (!sector || !rule.includedSectors.includes(sector)) return null
  // `null`, not `state: 'indeterminate'`. An indeterminate view still renders a card carrying the
  // sector, the threshold value and a source locator — a partial legal claim assembled around a
  // mass nobody can read. This overloads null, which already means "no threshold rule this year",
  // and that is fine: the caller does `t ? renderThreshold(t) : ''`, so both render nothing, and
  // the estimate's own refusal is what names the mass as the problem.
  if (!nonNegativeDecimal(input.massT)) return null
  const evaluated = evaluateThreshold({
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npm test 2>&1 | tail -3
npm run typecheck 2>&1 | tail -2
```
Expected: **454 + 5 = 459 passing**, typecheck clean.

- [ ] **Step 5: Prove the gate is load-bearing**

Delete the `if (!nonNegativeDecimal(input.massT)) return null` line, run, and confirm the `0x64` test fails with `above_threshold`. Restore precisely and confirm 459 green.

- [ ] **Step 6: Commit**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git add lib/estimator/estimate-from-pack.ts lib/estimator/mass-guard.test.ts
git commit -m "fix(estimator): do not decide de minimis on an unreadable mass

resolveThreshold answered above_threshold for 0x64 exactly as if the user had
typed 100, and threw on '' and 'abc'. Whether a consignment is in scope for
CBAM at all is a stronger claim than what it costs, so it was being made on
weaker input than the price was.

Returns null rather than state:'indeterminate' — an indeterminate view still
renders sector, threshold and source locator around a mass nobody can read."
```

---

## Task 4: Re-vendor, and make the UI decide with the same predicate

**Files:**
- Modify: `/private/tmp/cbam-mass/src/scripts/cbam-algos/estimator/estimate-from-pack.ts` (via `cp` only)
- Modify: `/private/tmp/cbam-mass/src/scripts/cbam-algos/UPSTREAM.json` (via `--update` only)
- Modify: `/private/tmp/cbam-mass/src/scripts/cbam-algos/cbam-app.ts`
- Modify: `/private/tmp/cbam-mass/tests/unit/cbam-render.test.mjs`

The worktree already exists at `/private/tmp/cbam-mass` on branch `fix/cbam-mass-guard`, based on `origin/main`, with `node_modules` symlinked. **Stay in it.** Baseline: **380 unit tests passing**.

- [ ] **Step 1: Copy down and re-record**

```bash
cd /private/tmp/cbam-mass
cp /Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/estimate-from-pack.ts src/scripts/cbam-algos/estimator/estimate-from-pack.ts
node scripts/cbam-sync-check.mjs --update
node scripts/cbam-sync-check.mjs
git diff --stat
```
The check must report the engine intact and in sync, and `git diff --stat` must show **exactly two files**. More than that means something else drifted — stop and report.

- [ ] **Step 2: Replace the UI's own parser**

`src/scripts/cbam-algos/cbam-app.ts` currently reads (around line 1317):

```ts
    const massT = Number(mass!.value);
    if (!Number.isFinite(massT) || massT < 0) {
      out!.innerHTML = '<p class="cb-idle">Net mass must be a number of tonnes, zero or greater.</p>';
      return;
    }
```

Replace with:

```ts
    // The SAME predicate the engine consumes with, not a second opinion. Number() and Decimal()
    // read different languages: Number('') is 0 and Number('  100  ') is 100, so both cleared
    // this gate and then threw at the consumer; Number('1_000') is NaN while Decimal reads 1000;
    // and BOTH read '0x10' as 16, so a hex string bought a confident bill for 16 t. Deciding with
    // the function that does the parsing is what makes that class of drift impossible rather than
    // merely fixed today. Checked here, not against the markup's `min`, so that editing the
    // .astro cannot silently disarm it.
    if (!nonNegativeDecimal(mass!.value)) {
      out!.innerHTML = '<p class="cb-idle">Net mass must be a number of tonnes, zero or greater.</p>';
      return;
    }
```

Add `nonNegativeDecimal` to the **existing** import at `cbam-app.ts:27-28`, which already pulls `estimateFromPack, resolveThreshold, routesFor, selectIndirectFactorFromPack` from the vendored estimator. **Do not add a second import statement for the same module.**

That import is **multi-line**: the `from './estimator/estimate-from-pack'` clause sits several lines below the opening `import {`. Grepping for the `from` string on one line returns nothing and makes it look absent — it is not. Grep for the symbol names instead.

The inline prompt stays: a bad field gets an idle prompt naming the field to fix, never a refusal card computed around the problem.

- [ ] **Step 3: Write the website-side pin**

Append to `tests/unit/cbam-render.test.mjs`, reusing its existing `estimateFromPack` import and `pack` load — do not add a second import or a second pack load:

```js
/* ── a mass that cannot become a figure is refused, not priced ──────────────── */

test('net mass is gated: no negative bill, no NaN euros, no hex tonnage', () => {
  // -100 t priced -4.4 certificates / -EUR 331.58; 0x10 priced 16 t / EUR 914.75 because
  // Decimal honours JS radix prefixes; NaN and Infinity rendered AS figures rather than throwing.
  const line = { cn: '25231000', country: 'DZ', route: '(A)', date: '2026-03-15',
    emissionsScope: 'direct_and_indirect' };
  for (const massT of ['-100', '', 'abc', 'NaN', 'Infinity', '0x10', '1_000']) {
    const e = estimateFromPack(pack, { ...line, massT });
    assert.equal(e.status, 'unavailable', `massT=${JSON.stringify(massT)} must refuse`);
  }
  // and an ordinary mass is untouched, including zero
  assert.equal(estimateFromPack(pack, { ...line, massT: '100' }).status, 'cscf_pending');
  assert.equal(estimateFromPack(pack, { ...line, massT: '0' }).status, 'cscf_pending');
});
```

- [ ] **Step 4: Prove the test depends on the new engine**

```bash
cd /private/tmp/cbam-mass
git stash push src/scripts/cbam-algos/estimator/estimate-from-pack.ts
node --import tsx --test tests/unit/cbam-render.test.mjs 2>&1 | tail -8
git stash pop
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
`npm run test:unit` runs `cbam-sync-check` first and **bails on drift**, so a stashed engine cannot show a clean red through it — use the raw runner for the red, as shown. Expect FAIL while stashed, PASS after restoring. **Report both verbatim.**

- [ ] **Step 5: Full gates**

```bash
cd /private/tmp/cbam-mass
npm run test:unit
node scripts/cbam-sync-check.mjs
npx astro check 2>&1 | tail -4
```
Expected: **381 passing** (380 + 1), sync-check green, `astro check` exactly 2 pre-existing `mapillary-js` errors. Confirm delta-zero against pristine `origin/main` rather than trying to fix them.

- [ ] **Step 6: Commit**

```bash
cd /private/tmp/cbam-mass
git add src/scripts/cbam-algos/estimator/estimate-from-pack.ts src/scripts/cbam-algos/UPSTREAM.json src/scripts/cbam-algos/cbam-app.ts tests/unit/cbam-render.test.mjs
git commit -m "fix(cbam): re-vendor the mass guard, and let the UI decide with it

cbam-app.ts validated with Number() while the engine consumed with Decimal().
'' and '  100  ' cleared the gate and threw at the consumer, '1_000' was
refused by the gate but would have parsed, and both read 0x10 as 16 — a hex
string bought a confident bill for 16 t. The check now calls the same function
that does the parsing."
```

---

## Task 4b: Close the twin gate and the de-minimis aggregate

**Files:**
- Modify: `/private/tmp/cbam-mass/src/scripts/cbam-algos/cbam-app.ts` (`draftLine()`, ~line 1408)
- Modify: `/private/tmp/cbam-mass/tests/unit/cbam-lines.test.mjs`

**Found by Task 4, absent from the spec.** The spec named three sites that consume mass. There are five. `cbam-app.ts` has a **second** `Number()` gate, in `draftLine()`:

```ts
const massT = Number(mass!.value);
if (!Number.isFinite(massT) || massT < 0) return null;
```

So after Task 4 the preview path and the add path disagree: `run()` refuses `'+100'`, `'5.'`, `'0x10'`, `'  100  '`; `draftLine()` accepts all four and builds a `Line` from them.

That matters because the multi-line year-threshold card **bypasses the gate Task 3 added**. `thresholdByYear` (`src/scripts/cbam-lines.ts:217`) calls `aggregateThresholdBasis` directly, never `resolveThreshold`, and `src/scripts/cbam-algos/threshold/aggregate.ts` sums with a bare `.plus(entry.netMassT)`. Measured after Task 4:

```
"0x10"       knownEligibleMassT=16    <- Art 2(3) decided off a hex string, still
"+100"       knownEligibleMassT=100   state=above_threshold
"  100  "    THREW [DecimalError] -> breaks the WHOLE card render, not one line
```

Not reachable from the shipped markup today (`<input type="number">` sanitises all four to `""`). That is exactly the excuse the guard's own comment forbids: *"Checked here, not against the markup's `min`, so that editing the .astro cannot silently disarm it."* `run()` honours that rule; `draftLine()` does not.

**Scope decision — fix the source, not the sink.** `threshold/aggregate.ts` is **vendored** (hashed at `UPSTREAM.json:13`), so gating it means an upstream CBM change plus a re-vendor. It also operates on `LedgerEntry[]` from a *server* ledger, a different trust boundary from a browser form field. The website's exposure closes entirely if no bad mass ever enters `Line[]`. So: gate the entry points, pin the behaviour, and leave the vendored aggregate alone — **unless the audit in Step 2 finds a path that reaches it ungated**, which would change the answer.

- [ ] **Step 1: Make `draftLine()` use the same predicate**

Replace the `Number()` check with `nonNegativeDecimal(mass!.value)`, matching `run()`. `nonNegativeDecimal` is already imported by Task 4. Keep `draftLine()`'s `return null` contract — it signals "no line to add", and the caller already handles it.

Add a comment saying why the two gates must agree, and that this is the *add* path to `run()`'s *preview* path.

- [ ] **Step 2: Audit every other way a `Line` is constructed**

`draftLine()` is one entry point. Find them all — session restore, URL parameters, CSV import, tests, anything that pushes onto the lines array — and for each, either gate it or **prove** it cannot carry an unreadable mass. Report the complete list with evidence.

If any path reaches `thresholdByYear` with an ungated mass, say so and stop: the scope decision above depends on this audit, and it would need re-taking.

- [ ] **Step 3: Pin it where the unit suite can reach**

`thresholdByYear` is exported from `src/scripts/cbam-lines.ts:217` and already has 14 references in `tests/unit/cbam-lines.test.mjs`, so unlike `draftLine()` it **is** reachable. Follow that file's existing conventions and add a test proving an unreadable mass cannot be counted toward de minimis, and that it does not throw out of the card render.

Derive the expected behaviour from what the code does after Step 1 — but if that behaviour is *itself* wrong (e.g. a bad line silently under-counts the total, which would wrongly exempt a consignment), **report it rather than pinning it**. An under-count here is fail-open on the question of whether CBAM applies at all.

- [ ] **Step 4: Gates**

```bash
cd /private/tmp/cbam-mass
npm run test:unit
node scripts/cbam-sync-check.mjs
npx astro check 2>&1 | tail -4
```
Expect 381 + your new tests, sync-check green, `astro check` still exactly 2 pre-existing `mapillary-js` errors.

- [ ] **Step 5: Commit**

Stage by name. `cbam-app.ts` is the hand-editable vendoring exception; nothing else under `src/scripts/cbam-algos/` may be touched.

---

## Task 5: Pin the DOM-layer mutation with an e2e assertion

**Files:**
- Modify: `/private/tmp/cbam-mass/tests/e2e/cbam-lines.spec.ts`

Reverting `cbam-app.ts` to `Number()` **cannot** be caught by the unit suite: `syncScope` and the preview handler are closures inside `initCbam()` using `document.getElementById`, and the suite is `node:test` + `tsx` with no DOM library in the tree. The precedent for closing this is the `#cbScopeRow` visibility assertion already in this file.

- [ ] **Step 1: Read the neighbouring assertions first**

```bash
cd /private/tmp/cbam-mass
grep -n "cbScopeRow\|setLine\|toBeHidden\|toBeVisible" tests/e2e/cbam-lines.spec.ts | head -20
```
Follow the file's own `setLine(page, {...})` helper, its named-const line fixtures, and its `toBeVisible()`/`toBeHidden()` idiom. Do not create a new spec file — the helper is file-local and a new file would have to duplicate it.

- [ ] **Step 2: Write the assertion**

Add a test that types a blank mass into `#cbMass` and asserts the output shows the idle prompt rather than a priced figure. Assert on what a user perceives — the prompt text — not an internal attribute:

```ts
test('a blank net mass prompts rather than pricing', async ({ page }) => {
  // Number('') is 0, so the old UI check passed a blank straight through to an engine that then
  // threw a raw DecimalError into the refusal card. The gate and the consumer now share one
  // predicate, so a blank is caught before either.
  await setLine(page, { ...GOOD_LINE, mass: '' });
  await expect(page.locator('#cbOut')).toContainText('Net mass must be a number of tonnes');
  await expect(page.locator('#cbOut')).not.toContainText('€');
});
```

Verify `#cbOut` is the real output container before trusting it — check the markup rather than this plan.

- [ ] **Step 3: Prove it fails against the old check**

Temporarily restore the `Number(mass!.value)` form in `cbam-app.ts`, run the single test, and show it fail. Restore precisely (byte-compare against a pre-mutation copy) and show it pass.

```bash
cd /private/tmp/cbam-mass
npx playwright test tests/e2e/cbam-lines.spec.ts -g 'blank net mass' 2>&1 | tail -15
```

If Playwright browsers or the preview server are unavailable in this environment, **say so and describe the substituted rig** — do not silently skip the proof, and do not run `npm ci` to obtain them.

- [ ] **Step 4: Commit**

```bash
cd /private/tmp/cbam-mass
git add tests/e2e/cbam-lines.spec.ts
git commit -m "test(cbam): gate the mass check with an e2e assertion

Reverting cbam-app.ts to Number() leaves the whole unit suite green — the
check lives in a closure inside initCbam() that node:test cannot reach. Same
reason the #cbScopeRow assertion above exists."
```

---

## Task 6: Measure the blast radius

**Files:** none — a measurement, and its output is the report. Change no source file, commit nothing.

The spec predicts two inputs move from **priced** to **refused**: `"+100"` (leading `+`) and `"5."` (trailing bare point). Both are unreachable from the site's `<input type="number">`, because HTML value sanitisation returns `""` for a string that is not a valid floating-point number. A programmatic caller or the Vue app could still send them. **Prove this rather than assuming it.**

- [ ] **Step 1: Sweep before and after**

Build the pre-guard engine from the commit before Task 2 into an out-of-repo copy rather than stashing, so no repo is written to:

```bash
mkdir -p /private/tmp/mass-sweep
cd /Volumes/VSTSAMPLES/Projects/CBM
# The RENAME commit from Task 1 — the last state with the predicate present but no mass gate.
# Resolve it by message rather than by ~N, so inserting a commit cannot silently pick the wrong one.
PRE=$(git log --format='%H %s' fix/mass-guard | grep 'verifiedPerT becomes nonNegativeDecimal' | cut -d' ' -f1)
echo "pre-guard engine from $PRE"
git show "$PRE:lib/estimator/estimate-from-pack.ts" > /private/tmp/mass-sweep/pre-estimator.ts
```

Copy the whole `lib/` tree twice (`pre` and `post`), swapping only that file in `pre`. Sweep a representative selector set — cement clinker DZ (A), steel `72061000` IN (C), and one residual-origin line — crossed with a mass corpus that covers: ordinary integers and decimals, exponent form, zero, `-0`, negatives, blanks, whitespace, radix prefixes, separators, `NaN`/`Infinity`, `+100`, `5.`, and very large values.

**Serialise and diff the WHOLE result object**, not just status. A previous sweep on this codebase compared status only and missed 10,300 user-visible `selector` changes.

Sweep `resolveThreshold` over the same mass corpus separately.

- [ ] **Step 2: Confirm or refute, explicitly**

1. **No probe goes `priced → priced with a different figure`.** The guard must refuse or do nothing — never silently re-price.
2. Every changed probe goes `priced → refused`, and only for inputs the gate names.
3. Ordinary masses — integers, decimals, exponent form, zero — are byte-identical before and after.
4. No `above_threshold` / `below_threshold` verdict survives on an input the gate refuses.
5. The only changed masses are exactly the set the spec predicts, plus `+100` and `5.`. **Anything else changing is the headline**, not a footnote.

Report the full list of masses whose outcome changed, before and after.

- [ ] **Step 3: Clean up**

```bash
rm -rf /private/tmp/mass-sweep
```
Confirm both repos are clean and unchanged.

---

## Task 7: Land it

- [ ] **Step 1: CBM first — the vendored copy must never be ahead of upstream**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npm test 2>&1 | tail -3
git update-index --refresh >/dev/null 2>&1; git checkout main && git merge --ff-only fix/mass-guard
npm test 2>&1 | tail -3
git push origin main
```
The `update-index --refresh` runs in the same invocation as the checkout deliberately: this volume is exFAT and `checkout` otherwise reports phantom "local changes would be overwritten". **Never `git reset --hard` to clear it.**

- [ ] **Step 2: Then the website**

```bash
cd /private/tmp/cbam-mass
git fetch origin --quiet
git merge origin/main --no-edit
npm run test:unit && node scripts/cbam-sync-check.mjs
git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
```

- [ ] **Step 3: Verify the deploy**

Fetch `https://deltaclimate.earth/cbam/cbam-calculator/` **with a cache-buster query** and confirm `x-vercel-cache: MISS` — a cached HTML will reference a bundle hash that no longer exists and 404, which reads exactly like a failed deploy. Read the referenced `/_astro/cbam-calculator*.js`, confirm HTTP 200 before grepping it, and look for the shape rather than a function name (the minifier renames identifiers, and emits template literals with backticks — grep for `kind:\`found`, not `"found"`). Confirm the mass gate is present. If absent, wait and retry rather than concluding the deploy failed.

- [ ] **Step 4: Clean up**

```bash
rm /private/tmp/cbam-mass/node_modules          # the SYMLINK only — never rm -rf the directory
cd /Volumes/VSTSAMPLES/Projects/Angad
git worktree remove /private/tmp/cbam-mass --force
git worktree prune
git branch -D fix/cbam-mass-guard 2>/dev/null
cd /Volumes/VSTSAMPLES/Projects/CBM && git branch -d fix/mass-guard
```

---

## Self-review

**Spec coverage.** One predicate → Task 1. Mass takes the identical rule, zero legal, no maximum → Task 2 Steps 3–4 and its zero/large tests. `estimateFromPack` gate above the branch → Task 2 Step 4. `resolveThreshold` returns `null` → Task 3 Step 3. `cbam-app.ts` adopts the predicate → Task 4 Step 2. Distinct, hand-pinned reason text → Task 2 Step 1's `BAD_MASS_TEXT`. Selector carries no rejected value → Task 2 Step 4. Behaviour changes measured → Task 6. The e2e mutation the unit suite cannot reach → Task 5. The mixed-tier fallback is explicitly out of scope in the spec and absent here.

**Placeholders.** None — every step carries its code or its exact command.

**Type consistency.** `nonNegativeDecimal(value: string): Decimal | null` is declared in Task 1 and used identically in Tasks 2, 3 and 4. `BAD_MASS_REASON` is defined in Task 2 Step 3 and referenced only in Task 2 Step 4; its text is duplicated as the hand-typed `BAD_MASS_TEXT` in Task 2 Step 1 **on purpose** — importing it would pin which constant is referenced, never what it says. `resolveThreshold` keeps its existing signature and its `ThresholdView | null` return.

**One risk worth naming.** Task 1 is a rename with no behaviour change, so its only real check is that the test count does not move. If an implementer "fixes" a failing test during Task 1, the rename has stopped being a rename — that is a stop-and-report, not something to work around.
