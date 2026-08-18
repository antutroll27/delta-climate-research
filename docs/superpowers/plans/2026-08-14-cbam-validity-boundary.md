# Validity-Window Boundary Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first day of every rule-validity window resolve, instead of refusing with a false statement that the regulation does not cover it.

**Architecture:** `active()` compares validity bounds to an import date lexicographically, but the bounds are UTC timestamps and the date is a calendar day, so a window's opening day sorts *after* its own `validFrom` and drops out. Fix both copies of `active()` to compare calendar days — which is what the regulation means — upstream in CBM, then re-vendor the CBAM copy into the website byte-for-byte.

**Tech Stack:** TypeScript, vitest (CBM), node:test + tsx (website), decimal.js, Zod contracts.

Spec: `docs/superpowers/specs/2026-08-14-cbam-validity-boundary-design.md`.

---

## Standing constraints — repeat these to every subagent

- **Never hand-edit anything under `src/scripts/cbam-algos/`** in the website repo. It is a
  byte-for-byte hash-guarded copy. The engine changes ONLY via the CBM repo, then
  `cp` + `node scripts/cbam-sync-check.mjs --update`. (`cbam-app.ts` is the one documented
  exception and this plan does not touch it.)
- **Never `git add -A` or `git add .`** — stage each file by name.
- The website's shared checkout at `/Volumes/VSTSAMPLES/Projects/Angad` is on another agent's
  branch. Website work happens in a dedicated worktree; never `cd` to the shared checkout.
- Comments explain WHY and name the hazard. Never write a comment that asserts something
  untrue of the code.

## The two things that make this bug survive tests

Read both before writing a line, or your tests will pass against the unfixed code:

1. **Every existing fixture uses plain dates on both sides.** `lib/cbam/sefa.test.ts`'s `bm()`
   helper emits `validFrom: '2026-01-01'`; `lib/regulatory/resolve.test.ts` does the same.
   Same-shape comparison works, so 416 tests pass over a live defect. **Your fixtures must use
   the timestamp shape the real corpus carries** (`'2026-01-01T00:00:00.000Z'`).
2. **The `validTo` edge is already correct** and must stay correct. A shorter string sorts
   *before* a longer one with the same prefix — that is what saves `'2027-12-31' <= '2027-12-31T23:59:59.999Z'`
   and what breaks `'2026-01-01T00:00:00.000Z' <= '2026-01-01'`. A fix that opens the near edge
   while widening the far edge is wrong.

## File structure

| File | Responsibility | Task |
| --- | --- | --- |
| `CBM/lib/cbam/resolve-fa.ts` | benchmark `active()` — the copy that reaches the browser | 1 |
| `CBM/lib/cbam/resolve-fa.boundary.test.ts` | NEW — boundary + shape-agnosticism + fail-closed | 1 |
| `CBM/lib/regulatory/resolve.ts` | classification `active()` — server path only | 2 |
| `CBM/lib/regulatory/resolve.boundary.test.ts` | NEW — the package-level boundary | 2 |
| `CBM/lib/estimator/pack.boundary.test.ts` | NEW — the sweep over the real pack | 3 |
| `Angad/src/scripts/cbam-algos/cbam/resolve-fa.ts` | re-vendored copy (`cp` only) | 4 |
| `Angad/src/scripts/cbam-algos/UPSTREAM.json` | re-recorded hash (`--update` only) | 4 |
| `Angad/tests/unit/cbam-render.test.mjs` | website-side boundary pin | 4 |

## The change, in full (both copies get exactly this)

Replace:

```ts
function active(from: string, to: string | null, date: string): boolean {
  return from <= date && (to === null || date <= to)
}
```

with:

```ts
/**
 * A calendar day, not an instant. The corpus stores validity bounds as UTC timestamps
 * ('2026-01-01T00:00:00.000Z') while an import date is a plain day ('2026-01-01'), and the
 * package contract's isoDate regex is unanchored so BOTH shapes are legal. Comparing them as
 * raw strings is only sound when the shapes match: with the same prefix the shorter string
 * sorts first, which silently saved the validTo edge and silently broke the validFrom edge —
 * a window's opening day sorted AFTER its own bound and dropped out, so 1 January 2026 refused
 * every good with a message asserting the rule did not exist.
 *
 * Reducing both sides to the day is not a workaround for awkward data: Reg (EU) 2023/956
 * applies to goods imported "on or after 1 January 2026", which is a day, not an instant.
 * It also makes this immune to whichever shape the data carries, which is the protection that
 * matters while both shapes remain legal.
 *
 * TWIN: lib/regulatory/resolve.ts carries an identical copy for the classification gate.
 * Deduplicating them is deferred to the IR 2026/1740 pack rebuild (see the spec); until then,
 * a change here belongs there too.
 */
const day = (s: string) => s.slice(0, 10)

function active(from: string, to: string | null, date: string): boolean {
  const d = day(date)
  return day(from) <= d && (to === null || d <= day(to))
}
```

In `lib/regulatory/resolve.ts` the TWIN line names `lib/cbam/resolve-fa.ts` instead.

---

### Task 1: The benchmark copy (CBM)

**Files:**
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/lib/cbam/resolve-fa.ts:19-21`
- Create: `/Volumes/VSTSAMPLES/Projects/CBM/lib/cbam/resolve-fa.boundary.test.ts`

Work in `/Volumes/VSTSAMPLES/Projects/CBM`. Create a branch first: `git checkout -b fix/validity-boundary`.

- [ ] **Step 1: Write the failing test**

Create `lib/cbam/resolve-fa.boundary.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isDomainError } from '../errors/domain-error'
import { resolveBenchmark } from './resolve-fa'
import type { FreeAllocationTables } from './types'

/**
 * THE SHAPE IS THE POINT. sefa.test.ts's bm() helper emits validFrom: '2026-01-01' — a plain
 * calendar day — so its comparisons are same-shape and cannot see this bug. The real corpus
 * stores UTC timestamps, which is what these fixtures use. Change them to plain dates and
 * every test here passes against the unfixed code.
 */
const src = { id: 'bm', title: 'Annex', url: 'https://x', sha256: '0'.repeat(64),
  retrievedAt: '2026-01-01T00:00:00.000Z', locator: 'Annex', legalStatus: 'enacted' as const }

const bm = (id: string, route: string, value: string, validFrom: string, validTo: string | null) => ({
  id, rulePackageId: 'test-fa', scopeCode: '72241010', codeLevel: 8 as const,
  benchmarkColumn: 'B' as const, routeIndicator: route, bmTco2ePerT: value,
  sourceId: 'bm', sourceLocator: 'Annex Column B', validFrom, validTo,
})

// Two consecutive production-year windows, exactly as the shipped pack keys them.
const tables = {
  packageId: 'test-fa', packageVersion: 'v1', sources: [src],
  benchmarks: [
    bm('w1', '(F)', '1.807', '2026-01-01T00:00:00.000Z', '2027-12-31T23:59:59.999Z'),
    bm('w2', '(F)', '1.64', '2028-01-01T00:00:00.000Z', '2030-12-31T23:59:59.999Z'),
  ],
  cbamFactors: [], cscf: [], prices: [],
} as unknown as FreeAllocationTables

const at = (date: string) =>
  resolveBenchmark(tables, { cnCode: '72241010', column: 'B', routeIndicator: '(F)', date })

const refusesAt = (date: string) => {
  try { at(date) } catch (e) { return isDomainError(e) }
  return false
}

describe('validity window boundaries', () => {
  it('resolves on the OPENING day of a window, which is where it used to refuse', () => {
    expect(at('2026-01-01').bmTco2ePerT).toBe('1.807')
    expect(at('2028-01-01').bmTco2ePerT).toBe('1.64')
  })

  it('still resolves inside each window', () => {
    expect(at('2026-06-15').bmTco2ePerT).toBe('1.807')
    expect(at('2028-06-15').bmTco2ePerT).toBe('1.64')
  })

  it('does NOT widen the closing edge — validTo was already correct', () => {
    // 2027-12-31 belongs to the first window; 2028-01-02 to the second. A fix that opened the
    // near edge by loosening the comparison would let one window swallow the other's days.
    expect(at('2027-12-31').bmTco2ePerT).toBe('1.807')
    expect(at('2028-01-02').bmTco2ePerT).toBe('1.64')
    expect(at('2030-12-31').bmTco2ePerT).toBe('1.64')
  })

  it('still refuses outside every window', () => {
    expect(refusesAt('2025-12-31')).toBe(true)
    expect(refusesAt('2031-01-01')).toBe(true)
  })

  it('gives the same answer whichever shape the caller passes', () => {
    // A caller handing in a timestamp must not get a different benchmark from one handing in
    // the day. Before the fix these disagreed on exactly the boundary days.
    expect(at('2026-01-01T00:00:00.000Z').bmTco2ePerT).toBe(at('2026-01-01').bmTco2ePerT)
    expect(at('2026-06-15T23:59:59.999Z').bmTco2ePerT).toBe(at('2026-06-15').bmTco2ePerT)
  })

  it('keeps failing closed on a malformed date', () => {
    // Slicing '' yields '', which fails both edges. The fail-closed path must not move.
    expect(refusesAt('')).toBe(true)
    expect(refusesAt('not-a-date')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it, expect failure**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM && npx vitest run lib/cbam/resolve-fa.boundary.test.ts
```
Expected: the first test FAILS (`resolveBenchmark` throws on `2026-01-01`). Report which tests
fail — the boundary test and the shape-agnosticism test should; the rest should already pass.

- [ ] **Step 3: Apply the change**

In `lib/cbam/resolve-fa.ts`, replace lines 19–21 with the `day`/`active` block given in
**The change, in full** above, using the TWIN line that names `lib/regulatory/resolve.ts`.

- [ ] **Step 4: Run, expect all passing, then the whole suite**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npx vitest run lib/cbam/resolve-fa.boundary.test.ts
npm test
```
Baseline before this task is **416 passing**. Expect 416 + your new tests, zero failures. If any
PRE-EXISTING test fails, stop and report it rather than adjusting it — a fixture that breaks here
is telling you something.

- [ ] **Step 5: Commit**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git add lib/cbam/resolve-fa.ts lib/cbam/resolve-fa.boundary.test.ts
git commit -m "fix(cbam): a window's opening day is inside it

active() compared a calendar day against a UTC timestamp as raw strings. With
the same prefix the shorter string sorts first, which quietly saved the validTo
edge and quietly broke the validFrom edge: a window's opening day sorted after
its own bound and dropped out. 1 January 2026 — the definitive regime's first
day — refused every good, naming a missing rule that was in force.

Both sides now reduce to the calendar day, which is what the regulation means:
goods imported 'on or after 1 January 2026' is a day, not an instant."
```

### Task 2: The classification copy (CBM)

**Files:**
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/lib/regulatory/resolve.ts:10-12`
- Create: `/Volumes/VSTSAMPLES/Projects/CBM/lib/regulatory/resolve.boundary.test.ts`

This copy is a **confirmed live defect, not a precaution.** The golden defaults package carries
`validFrom: '2026-01-01T00:00:00.000Z'` at the package level, so `requireActiveEnactedPackage`
judges the whole package inactive on day one and every classification lookup throws.

- [ ] **Step 1: Write the failing test**

Create `lib/regulatory/resolve.boundary.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveClassification } from './resolve'
import type { RulePackage } from './types'

/**
 * Against the REAL golden package, not a fixture — because the fixtures are exactly what hid
 * this. resolve.test.ts builds classifications with validFrom: '2026-01-01' (a plain day), so
 * its comparisons are same-shape and blind. The shipped package stores a UTC timestamp at the
 * PACKAGE level, which is what requireActiveEnactedPackage reads.
 */
const pkg = JSON.parse(
  readFileSync('golden/rule-packages/eu-cbam-2026-defaults-v2.json', 'utf8'),
) as RulePackage

const resolvesAt = (date: string) => {
  try { return resolveClassification(pkg, '25231000', date).code } catch { return 'THREW' }
}

describe('rule-package validity boundary', () => {
  it('the package is active on the first day of the definitive regime', () => {
    // Before the fix this threw REGULATION_NOT_FOUND: the package's own validFrom is
    // '2026-01-01T00:00:00.000Z', which sorted AFTER the date '2026-01-01'.
    expect(pkg.validFrom).toMatch(/^2026-01-01T/)
    expect(resolvesAt('2026-01-01')).toBe('25231000')
  })

  it('is still active later in the regime', () => {
    expect(resolvesAt('2026-01-02')).toBe('25231000')
    expect(resolvesAt('2026-06-15')).toBe('25231000')
  })

  it('is still inactive before the regime begins', () => {
    expect(resolvesAt('2025-12-31')).toBe('THREW')
  })
})
```

- [ ] **Step 2: Run it, expect failure**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM && npx vitest run lib/regulatory/resolve.boundary.test.ts
```
Expected: the first test FAILS with `'THREW'` where `'25231000'` was expected.

- [ ] **Step 3: Apply the change**

In `lib/regulatory/resolve.ts`, replace lines 10–12 with the same `day`/`active` block, using
the TWIN line that names `lib/cbam/resolve-fa.ts`.

- [ ] **Step 4: Run, expect all passing, then the whole suite**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npx vitest run lib/regulatory/resolve.boundary.test.ts
npm test
```

- [ ] **Step 5: Commit**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git add lib/regulatory/resolve.ts lib/regulatory/resolve.boundary.test.ts
git commit -m "fix(regulatory): the rule package is active on its own first day

Same defect as resolve-fa, one layer up and broader in effect: the golden
defaults package carries validFrom as a UTC timestamp, so on 2026-01-01
requireActiveEnactedPackage judged the WHOLE package inactive and every
classification lookup threw REGULATION_NOT_FOUND — the gate that decides
whether a good is a CBAM good at all.

Invisible to the existing tests because resolve.test.ts builds fixtures with
plain-date validFrom values, which compare same-shape."
```

### Task 3: The sweep — so a future window cannot go dead silently (CBM)

**Files:**
- Create: `/Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/pack.boundary.test.ts`

This is the test that matters most. Tasks 1 and 2 pin two known dates; this one derives the
dates **from the pack at run time**, so the IR 2026/1740 re-keying cannot introduce a new dead
day without turning something red.

- [ ] **Step 1: Write the test**

Create `lib/estimator/pack.boundary.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveBenchmark } from '../cbam/resolve-fa'
import type { FreeAllocationTables } from '../cbam/types'

/**
 * DERIVED, NOT HARDCODED. Tasks 1 and 2 pin 2026-01-01 and 2028-01-01 because those are the
 * windows the pack ships today. This test asks the pack what its windows are, so when the
 * corpus is rebuilt against IR (EU) 2026/1740 — which re-keys production routes and will add
 * windows — a newly dead opening day fails here instead of reaching an importer.
 */
const pack = JSON.parse(readFileSync('public/estimator-pack.json', 'utf8'))
const tables = {
  packageId: 'pack', packageVersion: 'v1', sources: pack.sources,
  benchmarks: pack.benchmarks, cbamFactors: pack.cbamFactors,
  cscf: pack.cscf, prices: pack.prices,
} as unknown as FreeAllocationTables

describe('every validity window opens on the day it says it does', () => {
  it('resolves on the first calendar day of every distinct validFrom in the pack', () => {
    const froms = [...new Set<string>(pack.benchmarks.map((b: { validFrom: string }) => b.validFrom))]
    expect(froms.length).toBeGreaterThan(0)

    const dead: string[] = []
    for (const from of froms) {
      const day = from.slice(0, 10)
      // Any row that opens on this day must resolve on it. Pick one such row per window and
      // ask for exactly its own selector — if that refuses, the window has a dead first day.
      const row = pack.benchmarks.find((b: { validFrom: string }) => b.validFrom === from)
      try {
        resolveBenchmark(tables, {
          cnCode: row.scopeCode, column: row.benchmarkColumn,
          routeIndicator: row.routeIndicator, date: day,
        })
      } catch {
        dead.push(`${day} (e.g. ${row.scopeCode} col ${row.benchmarkColumn} route ${row.routeIndicator || 'route-independent'})`)
      }
    }

    expect(dead, `windows whose opening day refuses: ${dead.join('; ')}`).toEqual([])
  })

  it('resolves on the last calendar day of every distinct validTo in the pack', () => {
    // The far edge was already correct before the fix. Pinned so a later change to the
    // comparison cannot close a window a day early while fixing the near edge.
    const tos = [...new Set<string>(
      pack.benchmarks.map((b: { validTo: string | null }) => b.validTo).filter(Boolean),
    )]
    const dead: string[] = []
    for (const to of tos) {
      const day = to.slice(0, 10)
      const row = pack.benchmarks.find((b: { validTo: string | null }) => b.validTo === to)
      try {
        resolveBenchmark(tables, {
          cnCode: row.scopeCode, column: row.benchmarkColumn,
          routeIndicator: row.routeIndicator, date: day,
        })
      } catch {
        dead.push(`${day} (e.g. ${row.scopeCode})`)
      }
    }
    expect(dead, `windows whose closing day refuses: ${dead.join('; ')}`).toEqual([])
  })
})
```

- [ ] **Step 2: Run it**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM && npx vitest run lib/estimator/pack.boundary.test.ts
```
Expected: PASS, because Task 1 already fixed the comparison. **Prove it would have failed**:
temporarily revert `active()` in `lib/cbam/resolve-fa.ts` to `from <= date && (to === null || date <= to)`,
re-run, confirm the first test fails naming `2026-01-01` and `2028-01-01`, then restore. Report
both outputs.

- [ ] **Step 3: Commit**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git add lib/estimator/pack.boundary.test.ts
git commit -m "test(estimator): every window in the pack must open on its own first day

Derived from the pack rather than hardcoded, so the IR 2026/1740 rebuild — which
re-keys production routes and will add windows — cannot introduce a new dead
opening day without failing here. The closing edge is pinned too, so a later
change cannot close a window early while fixing the near edge."
```

### Task 4: Re-vendor and pin on the website

**Files:**
- Modify: `src/scripts/cbam-algos/cbam/resolve-fa.ts` (via `cp` only, never by hand)
- Modify: `src/scripts/cbam-algos/UPSTREAM.json` (via `--update` only, never by hand)
- Modify: `tests/unit/cbam-render.test.mjs` (append)

Work in a dedicated worktree off `origin/main`, NOT the shared checkout:

```bash
cd /Volumes/VSTSAMPLES/Projects/Angad
git fetch origin --quiet
git worktree add /private/tmp/cbam-boundary --detach origin/main
ln -s /Volumes/VSTSAMPLES/Projects/Angad/node_modules /private/tmp/cbam-boundary/node_modules
cd /private/tmp/cbam-boundary
git checkout -b fix/cbam-validity-boundary
```

Note `lib/regulatory/resolve.ts` is **not** vendored — only `regulatory/iso-3166.ts` and
`regulatory/types.ts` are, of 11 files — so Task 2's fix stays upstream. That is correct:
`resolveClassification` appears in the browser bundle once, in a comment, and is never called.

- [ ] **Step 1: Copy down and re-record**

```bash
cd /private/tmp/cbam-boundary
cp /Volumes/VSTSAMPLES/Projects/CBM/lib/cbam/resolve-fa.ts src/scripts/cbam-algos/cbam/resolve-fa.ts
node scripts/cbam-sync-check.mjs --update
node scripts/cbam-sync-check.mjs
git diff --stat
```

The last check must report the engine intact and in sync. `git diff --stat` must show **exactly
two files**. If it shows more, stop and report — something else drifted.

- [ ] **Step 2: Write the website-side test**

Append to `tests/unit/cbam-render.test.mjs` (it already imports `estimateFromPack` and loads the
real pack as `pack` — reuse those, do not add a second import or pack load):

```js
/* ── the definitive regime's first day is inside it ─────────────────────────── */

test('1 January 2026 prices, instead of claiming the rule does not exist', () => {
  // The likeliest date an importer types when sizing a year's exposure. It used to refuse
  // every good with "The published rules do not give a free-allocation benchmark…", naming a
  // rule that was in force that day — active() sorted the timestamp bound after the plain date.
  const e = estimateFromPack(pack, {
    cn: '25231000', country: 'DZ', route: '(A)', massT: '100', date: '2026-01-01',
  });
  assert.notEqual(e.status, 'unavailable',
    'the first day of the definitive regime must resolve');
  assert.equal(e.status, 'cscf_pending');
  assert.equal(e.scenario.certificates, '71.465');
  assert.equal(e.scenario.costEur, '5385.60');
  // …and the day before is still outside the regime.
  const before = estimateFromPack(pack, {
    cn: '25231000', country: 'DZ', route: '(A)', massT: '100', date: '2025-12-31',
  });
  assert.equal(before.status, 'unavailable');
});
```

- [ ] **Step 3: Prove the test depends on the new engine**

```bash
cd /private/tmp/cbam-boundary
git stash push src/scripts/cbam-algos/cbam/resolve-fa.ts
npm run test:unit 2>&1 | tail -6
git stash pop
npm run test:unit 2>&1 | tail -6
```
Expected: FAIL while stashed (the new test), PASS after restoring. Report both.

- [ ] **Step 4: Full gates**

```bash
cd /private/tmp/cbam-boundary
npm run test:unit
node scripts/cbam-sync-check.mjs
npx astro check 2>&1 | tail -4
```
Baseline is **377 unit tests passing**, sync-check green, `astro check` **0 errors**. (If
`astro check` reports `Cannot find module 'mapillary-js'`, the worktree's `node_modules` symlink
is incomplete — run `npm ci` in the worktree and re-run. It is an environment artefact, not a
code defect.)

- [ ] **Step 5: Commit**

```bash
cd /private/tmp/cbam-boundary
git add src/scripts/cbam-algos/cbam/resolve-fa.ts src/scripts/cbam-algos/UPSTREAM.json tests/unit/cbam-render.test.mjs
git commit -m "fix(cbam): re-vendor the boundary fix, pin 1 January 2026

The definitive regime's first day priced nothing and blamed the regulation.
It now returns 71.465 certificates / EUR 5,385.60 for the reference line, and
2025-12-31 still refuses as it should."
```

### Task 5: Verify the blast radius on the real corpus

**Files:** none — this is a measurement, and its output goes in the report.

The spec claims the change is strictly additive: nothing that prices today changes value. Prove
it against the shipped pack rather than trusting the earlier measurement.

- [ ] **Step 1: Sweep before and after**

```bash
cd /private/tmp/cbam-boundary
cat > /private/tmp/sweep.mjs <<'EOF'
import { readFileSync } from 'node:fs';
const { resolveBenchmark } = await import('/private/tmp/cbam-boundary/src/scripts/cbam-algos/cbam/resolve-fa.ts');
const p = JSON.parse(readFileSync('/private/tmp/cbam-boundary/public/cbam/estimator-pack.json','utf8'));
const tables = { benchmarks:p.benchmarks, cbamFactors:p.cbamFactors, cscf:p.cscf, prices:p.prices, sources:p.sources };
const cns = [...new Set(p.benchmarks.map(b=>b.scopeCode))];
const routes = [...new Set(p.benchmarks.map(b=>b.routeIndicator))];
const dates = ['2025-12-31','2026-01-01','2026-06-15','2027-12-31','2028-01-01','2028-06-15','2030-12-31','2031-01-01'];
const out = [];
for (const cn of cns) for (const r of routes) for (const col of ['A','B']) for (const d of dates) {
  let v; try { v = resolveBenchmark(tables,{cnCode:cn,column:col,routeIndicator:r,date:d}).bmTco2ePerT; }
  catch { v = 'REFUSED'; }
  out.push([cn,r,col,d,v].join('|'));
}
console.log(out.join('\n'));
EOF
node --import tsx /private/tmp/sweep.mjs > /private/tmp/after.txt
git stash push src/scripts/cbam-algos/cbam/resolve-fa.ts
node --import tsx /private/tmp/sweep.mjs > /private/tmp/before.txt
git stash pop
```

- [ ] **Step 2: Diff and report the shape of the change**

```bash
diff /private/tmp/before.txt /private/tmp/after.txt | grep '^<' | awk -F'|' '{print $4, $5}' | sort | uniq -c
diff /private/tmp/before.txt /private/tmp/after.txt | grep '^>' | awk -F'|' '{print $4, ($5=="REFUSED"?"REFUSED":"priced")}' | sort | uniq -c
```

**Required outcome:** every changed probe must go `REFUSED → priced`, on boundary dates only.
**Zero** probes may go `priced → REFUSED`, and **zero** priced values may change. If any do, stop
and report — the change is not what the spec claims and the plan needs revisiting. (The
pre-implementation measurement found 11,265 changed, 9,581 on 2026-01-01 and 1,684 on
2028-01-01; use that as the expectation, not as proof.)

- [ ] **Step 3: Clean up**

```bash
rm -f /private/tmp/sweep.mjs /private/tmp/before.txt /private/tmp/after.txt
```

### Task 6: Land it

- [ ] **Step 1: CBM first**

The website's vendored copy must never be ahead of upstream. Merge CBM before the website.

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npx vitest run 2>&1 | tail -3
git checkout main && git merge --ff-only fix/validity-boundary
npx vitest run 2>&1 | tail -3
git push origin main
```

- [ ] **Step 2: Then the website**

```bash
cd /private/tmp/cbam-boundary
git fetch origin --quiet
git merge origin/main --no-edit
npm run test:unit && node scripts/cbam-sync-check.mjs && npx astro check 2>&1 | tail -3
git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
```

- [ ] **Step 3: Verify the deploy**

```bash
sleep 90
curl -sS https://deltaclimate.earth/cbam/cbam-calculator/ -o /private/tmp/live.html
BUNDLE=$(grep -oE '/_astro/cbam-calculator[^"]*\.js' /private/tmp/live.html | head -1)
echo "bundle: $BUNDLE"
curl -sS "https://deltaclimate.earth$BUNDLE" | grep -c 'slice(0, *10)' || echo "day() not found — deploy may not have landed yet"
```

The minifier may rename `day`, so grep for the slice rather than the identifier. If it is absent,
wait and retry rather than concluding the deploy failed.

- [ ] **Step 4: Clean up the worktree**

```bash
cd /Volumes/VSTSAMPLES/Projects/Angad
git worktree remove /private/tmp/cbam-boundary --force
git worktree prune
git branch -D fix/cbam-validity-boundary 2>/dev/null
cd /Volumes/VSTSAMPLES/Projects/CBM && git branch -d fix/validity-boundary
```

---

## Self-review

**Spec coverage.** Decision (compare calendar days) → the block in *The change, in full*, applied
in Tasks 1 and 2. Both copies → Tasks 1 and 2. Test 1 (two live boundaries) → Task 1 Step 1,
first test. Test 2 (validTo unchanged) → Task 1, third test, and Task 3's second test. Test 3
(the sweep) → Task 3. Test 4 (shape-agnosticism) → Task 1, fifth test. Test 5 (fail-closed
unchanged) → Task 1, sixth test. Test 6 (second copy) → Task 2. Blast radius → Task 5. Landing →
Task 6. Out-of-scope items are named in the spec and deliberately absent here.

**Placeholders.** None: every step carries its code or its exact command.

**Type consistency.** `day(s: string)` and `active(from, to, date)` are identical in both copies;
`FreeAllocationTables`, `RulePackage`, `resolveBenchmark`, `resolveClassification` and
`isDomainError` all match their real signatures, checked against the source before writing.

**One risk worth naming.** Task 1's fixture casts through `as unknown as FreeAllocationTables`
because it supplies only the fields `resolveBenchmark` reads. That is the house precedent
(`estimate-from-pack.test.ts:158` does the same), but if the cast hides a real type error the
implementer should say so rather than widening it further.
