# Indirect Route Match — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the indirect (electricity) default being taken from a production route the importer did not choose — a silent over-charge on every affected line.

**Architecture:** Add the production route to the indirect lookup, mirroring what `selectFactorFromPack` already does for direct factors. Because a route mismatch must refuse rather than silently price electricity at zero, the lookup's return type grows from `Factor | null` to a three-way union. Upstream in CBM, then re-vendor byte-for-byte into the website.

**Tech Stack:** TypeScript, vitest (CBM), node:test + tsx (website), decimal.js, Vue 3 (the SaaS store).

Spec: `docs/superpowers/specs/2026-08-14-cbam-indirect-route-design.md`.

---

## Standing constraints — repeat to every subagent

- **Never hand-edit anything under `src/scripts/cbam-algos/`** in the website repo. It is a
  byte-for-byte hash-guarded copy; the engine changes ONLY via CBM, then `cp` +
  `node scripts/cbam-sync-check.mjs --update`. (`cbam-app.ts` is the sole exception and this plan
  does not touch it.)
- **Never `git add -A` or `git add .`** — stage each file by name.
- The website's shared checkout at `/Volumes/VSTSAMPLES/Projects/Angad` is on another agent's
  branch. Website work happens in a dedicated worktree; never `cd` there.
- `node_modules` in any website worktree is a **symlink** into that shared checkout. Never run
  `npm ci` or `npm install` — it would clobber another agent's tree.
- Comments explain WHY and name the hazard. Never write a comment that asserts something untrue.

## The defect in one screen

`selectIndirectFactorFromPack` matches on good, origin and year, then `.find()`s at the deepest
scope — **no route**. Measured on the shipped pack:

```
25231000 (cement clinker) / DZ / 100 t / 2026-03-15 / direct_and_indirect
pack publishes indirect  (A): 0.04   (B): 0.06

route (A)  -> picks route (B), base 0.06  ->  78.065 certs · EUR 5,882.98   ← WRONG
route (B)  -> picks route (B), base 0.06  ->  64.7475 certs · EUR 4,879.37  ← right
```

Route (A) is priced with route (B)'s electricity. **Changing the route on the form does not move
the indirect component at all.** All 30 affected combinations per reporting year over-charge,
because the dearer row sorts first.

## Why the return type must grow

`null` today means *"the Commission publishes no indirect default for this good"* — true for iron
& steel and aluminium, which must keep pricing with `indirectTco2e = '0'`. A route mismatch is a
different thing entirely and must refuse. **Collapsing the two is how this bug hid**, so:

```ts
export type IndirectLookup =
  | { kind: 'found'; factor: EstimatorPack['defaultFactors'][number] }
  | { kind: 'none' }            // no indirect row covers this good — price with 0, as today
  | { kind: 'route-mismatch' }  // rows exist for this good/origin/year, none matches the route
```

## Exactly three call sites break — all must move in ONE commit

A type change that leaves any of them stale produces a non-compiling commit:

| site | today | becomes |
| --- | --- | --- |
| `lib/estimator/estimate-from-pack.ts` (the consumer) | `if (indirect) {...}` | switch on `kind`; `route-mismatch` → `unavailableEstimate` |
| `lib/estimator/threshold-and-indirect.test.ts:101` | `expect(...).toBeNull()` | `expect(....kind).toBe('none')` |
| `src/stores/estimator.ts:74` (`hasIndirect`) | `!== null` | `kind !== 'none'` — **not** `=== 'found'` |

That last one is the trap. `hasIndirect` drives the emissions-scope control's visibility. Mapping
it to `=== 'found'` would hide the control on exactly the goods whose route diverged, so the user
could never reach the refusal meant to warn them.

## Measured facts the tests rest on

| | |
| --- | --- |
| indirect rows keyed `default` / keyed to a real route | 7,713 / **597** |
| (good, origin, year) groups with route-keyed indirect rows | 510 |
| …of those, groups whose values differ by route | **90** |
| …groups where the indirect route set equals the direct route set | **510 of 510** |
| selectors carrying an indirect factor today | 8,310 |
| still resolving after a strict route match | **8,310 — zero lost** |
| duplicate keys once keyed by (scope, origin, year, route) | **0**, in both corpora |

The existing `CEMENT` fixture (`25070080` / `AO` / `(A)`) has exactly one indirect row, keyed
`(A)` — the same route the fixture passes — so **no existing test changes value.**

## File structure

| File | Responsibility | Task |
| --- | --- | --- |
| `CBM/lib/estimator/estimate-from-pack.ts` | the lookup, its return type, the consumer | 1 |
| `CBM/src/stores/estimator.ts` | `hasIndirect` call site | 1 |
| `CBM/lib/estimator/threshold-and-indirect.test.ts` | the `.toBeNull()` assertion | 1 |
| `CBM/lib/estimator/indirect-route.test.ts` | NEW — the whole behaviour | 1 |
| `Angad/src/scripts/cbam-algos/estimator/estimate-from-pack.ts` | re-vendored copy (`cp` only) | 2 |
| `Angad/src/scripts/cbam-algos/UPSTREAM.json` | re-recorded hash (`--update` only) | 2 |
| `Angad/tests/unit/cbam-render.test.mjs` | the worked example, pinned | 2 |

---

### Task 1: The lookup, its consumer, and both other call sites (CBM)

**Files:**
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/estimate-from-pack.ts`
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/src/stores/estimator.ts`
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/threshold-and-indirect.test.ts`
- Create: `/Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/indirect-route.test.ts`

Work in `/Volumes/VSTSAMPLES/Projects/CBM`. Branch first: `git checkout -b fix/indirect-route`.

- [ ] **Step 1: Write the failing tests**

Create `lib/estimator/indirect-route.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  estimateFromPack, selectIndirectFactorFromPack, type EstimatorPack,
} from './estimate-from-pack'

const pack = JSON.parse(readFileSync('public/estimator-pack.json', 'utf8')) as EstimatorPack

// Cement clinker from Algeria publishes indirect defaults for BOTH routes, at different values —
// (A): 0.04, (B): 0.06. That is the shape the old lookup could not see, because it matched on
// good/origin/year only and took whichever row sorted first. The dearer one sorted first.
const CLINKER = { cn: '25231000', country: 'DZ', massT: '100', date: '2026-03-15' } as const
const scoped = (route: string) =>
  ({ ...CLINKER, route, emissionsScope: 'direct_and_indirect' as const })

const figureOf = (e: ReturnType<typeof estimateFromPack>) => {
  if (e.status === 'cscf_pending') return e.scenario
  if (e.status === 'ok' || e.status === 'zero_by_fiat') return e.figure
  throw new Error(`expected a priced estimate, got ${e.status}`)
}

describe('the indirect default follows the declared production route', () => {
  it('picks each route its own electricity figure', () => {
    const a = selectIndirectFactorFromPack(pack, scoped('(A)'))
    const b = selectIndirectFactorFromPack(pack, scoped('(B)'))
    expect(a.kind).toBe('found')
    expect(b.kind).toBe('found')
    if (a.kind !== 'found' || b.kind !== 'found') return
    expect(a.factor.productionRoute).toBe('(A)')
    expect(b.factor.productionRoute).toBe('(B)')
    expect(a.factor.baseIntensity).toBe('0.04')
    expect(b.factor.baseIntensity).toBe('0.06')
  })

  it('prices route (A) at its own rate, not route (B)\'s', () => {
    // Before the fix both routes returned 0.06, so both lines carried indirect 6.6 tCO2e and
    // route (A) was over-charged by EUR 165.79 on 100 t.
    const a = figureOf(estimateFromPack(pack, scoped('(A)')))
    expect(a.certificates).toBe('75.865')
    expect(a.costEur).toBe('5717.19')
  })

  it('leaves route (B) exactly where it was', () => {
    const b = figureOf(estimateFromPack(pack, scoped('(B)')))
    expect(b.certificates).toBe('64.7475')
    expect(b.costEur).toBe('4879.37')
  })

  it('the two routes now differ — the whole point', () => {
    const a = figureOf(estimateFromPack(pack, scoped('(A)')))
    const b = figureOf(estimateFromPack(pack, scoped('(B)')))
    expect(a.costEur).not.toBe(b.costEur)
  })

  it('a good with no published indirect default reports none, and still prices', () => {
    // Iron & steel carries no indirect row anywhere. That is NOT a route mismatch, and it must
    // keep pricing with indirect 0 rather than refusing — the distinction this union exists for.
    const steel = { cn: '72083800', country: 'IN', route: '(C)', massT: '60', date: '2026-03-15' }
    expect(selectIndirectFactorFromPack(pack, steel).kind).toBe('none')
    const asked = estimateFromPack(pack, { ...steel, emissionsScope: 'direct_and_indirect' })
    expect(asked.status).not.toBe('unavailable')
    expect(figureOf(asked).indirectTco2e).toBe('0')
  })

  it('refuses when rows exist for the good but none matches the route', () => {
    // The IR 2026/1740 divergence: a rebuild re-keys indirect away from the direct routes.
    // Synthesised, because today's corpus aligns perfectly — 510 of 510 groups match.
    const diverged = {
      ...pack,
      defaultFactors: pack.defaultFactors.map(f =>
        f.emissionsType === 'indirect' && f.scopeCode === '25231000' && f.originCountry === 'DZ'
          ? { ...f, productionRoute: '(Z)' }
          : f),
    }
    expect(selectIndirectFactorFromPack(diverged, scoped('(A)')).kind).toBe('route-mismatch')
    const e = estimateFromPack(diverged, scoped('(A)'))
    expect(e.status).toBe('unavailable')
    if (e.status !== 'unavailable') return
    expect(e.selector).toBe('indirect/25231000/DZ/(A)/2026')
  })

  it('the shipped corpus cannot produce a first-match: every full key is unique', () => {
    // With the route in the match no candidate set can hold more than one row, so the module's
    // own rule — "a tie is REGULATION_AMBIGUOUS, never a first-match" — stops being violated
    // rather than merely narrowed. Derived from the pack so a rebuild that breaks it fails here.
    for (const type of ['indirect', 'direct'] as const) {
      const seen = new Map<string, string>()
      const dupes: string[] = []
      for (const f of pack.defaultFactors.filter(x => x.emissionsType === type)) {
        const key = [f.scopeCode, f.originCountry, f.reportingYear, f.productionRoute].join('|')
        const prev = seen.get(key)
        if (prev !== undefined && prev !== f.baseIntensity) dupes.push(`${key}: ${prev} vs ${f.baseIntensity}`)
        seen.set(key, f.baseIntensity)
      }
      expect(dupes, `${type} keys holding conflicting values: ${dupes.join('; ')}`).toEqual([])
    }
  })

  it('no selector loses its indirect factor — swept over the whole pack', () => {
    // Zero loss is the load-bearing claim: strict matching must not silently drop electricity
    // for anyone. Derived, not sampled, so an IR 2026/1740 rebuild that misaligns the two
    // corpora fails here instead of under-charging quietly.
    const selectors = new Set<string>()
    for (const f of pack.defaultFactors.filter(x => x.emissionsType === 'direct')) {
      selectors.add([f.scopeCode, f.originCountry, f.productionRoute, f.reportingYear].join('|'))
    }
    const lost: string[] = []
    let had = 0
    for (const s of selectors) {
      const [cn, country, route, year] = s.split('|')
      const covering = pack.defaultFactors.filter(f =>
        f.emissionsType === 'indirect' && f.originCountry === country &&
        f.reportingYear === Number(year) && cn.startsWith(f.scopeCode))
      if (covering.length === 0) continue
      had++
      const deepest = Math.max(...covering.map(f => f.scopeCode.length))
      if (!covering.some(f => f.scopeCode.length === deepest && f.productionRoute === route)) {
        lost.push(s)
      }
    }
    expect(had).toBeGreaterThan(0)
    expect(lost, `selectors that would lose their indirect factor: ${lost.slice(0, 5).join('; ')}`).toEqual([])
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM && npx vitest run lib/estimator/indirect-route.test.ts
```

Expect failures on the route-picking, route-(A) pricing, routes-differ, `none`, and
`route-mismatch` tests. The uniqueness and zero-loss sweeps should already pass — they describe
the pack, not the code. **If the route-(A) pricing test PASSES at this stage, stop and report** —
the defect is not being reproduced.

- [ ] **Step 3: Change the return type and add the route to the match**

In `lib/estimator/estimate-from-pack.ts`, export the union above the function and replace
`selectIndirectFactorFromPack` entirely:

```ts
/**
 * Three outcomes, not two, and the distinction is load-bearing.
 *
 * `none` means the Commission publishes no indirect default for this good at all — true of iron
 * & steel and aluminium, which must keep pricing with indirect 0. `route-mismatch` means rows DO
 * exist for this good, origin and year but none is published for the route the importer declared.
 * Those are different facts and they need different answers: the first is silence, the second is
 * a refusal. Collapsing them into `null` is exactly how the over-charge this replaces stayed
 * invisible — the lookup could not tell "nothing published" from "I picked the wrong row".
 */
export type IndirectLookup =
  | { kind: 'found'; factor: EstimatorPack['defaultFactors'][number] }
  | { kind: 'none' }
  | { kind: 'route-mismatch' }

/**
 * The indirect (electricity) default for this selector.
 *
 * THE ROUTE IS PART OF THE MATCH. An earlier version left it out, on the stated grounds that
 * "indirect rows are published per good, not per production route". The shipped corpus disagrees:
 * 597 of its 8,310 indirect rows carry a real route indicator, 510 (good, origin, year) groups are
 * route-keyed, and in 90 of those the value differs by route. Without the route, `.find()` returned
 * whichever row sorted first — the dearer one, in every affected case — so a route-(A) line was
 * priced with route (B)'s electricity and over-charged. On Algerian cement clinker that was
 * EUR 165.79 per 100 t, with the CSV exporting `benchmark_route (A)` beside route (B)'s figure.
 *
 * Matching strictly loses nothing: where the direct corpus is route-keyed the indirect rows carry
 * the same routes (510 of 510 groups), and where direct is route-independent both carry 'default'.
 * All 8,310 selectors that resolve today still resolve. It also makes the lookup deterministic —
 * with the route included no candidate set can hold more than one row, so this file's own rule
 * ("a tie is REGULATION_AMBIGUOUS, never a first-match") stops being violated rather than narrowed.
 */
export function selectIndirectFactorFromPack(
  pack: EstimatorPack,
  input: EstimatorInput,
): IndirectLookup {
  const year = Number(input.date.slice(0, 4))
  for (const origin of originsFor(pack, input.country)) {
    if (!isOfferedGood(pack, input.cn)) return { kind: 'none' }
    const covering = pack.defaultFactors.filter(f =>
      f.originCountry === origin && f.emissionsType === 'indirect' &&
      f.reportingYear === year && input.cn.startsWith(f.scopeCode))
    if (covering.length === 0) continue
    // Deepest published scope first, matching the direct lookup, so an indirect figure can never
    // rest on a broader scope than the direct one it accompanies.
    const deepest = Math.max(...covering.map(f => f.scopeCode.length))
    const atDepth = covering.filter(f => f.scopeCode.length === deepest)
    const found = atDepth.find(f => f.productionRoute === input.route)
    if (found) return { kind: 'found', factor: found }
    // Rows exist for this good but not for this route. Returning `none` here would price the
    // whole electricity component at zero with no signal — an under-charge, and the third silent
    // fail-open on a page whose governing rule is fail-closed. Refuse instead.
    return { kind: 'route-mismatch' }
  }
  return { kind: 'none' }
}
```

- [ ] **Step 4: Update the consumer in the same file**

Replace the indirect block inside `estimateFromPack`:

```ts
  // Indirect is opt-in and silent when the Commission publishes nothing for the good: asking for
  // it must never fabricate a component, and must never fail a good that has only a direct row.
  // A route MISMATCH is not that case — see IndirectLookup — and refuses.
  let indirectTco2e = '0'
  if (input.emissionsScope === 'direct_and_indirect') {
    const indirect = selectIndirectFactorFromPack(pack, input)
    if (indirect.kind === 'route-mismatch') {
      return unavailableEstimate(
        { ...baseInput, originBasis }, tables, NO_INDIRECT_ROUTE_REASON,
        `indirect/${input.cn}/${input.country}/${input.route}/${year}`,
      )
    }
    if (indirect.kind === 'found') {
      indirectTco2e = new Decimal(indirect.factor.baseIntensity)
        .mul(new Decimal(1).plus(new Decimal(indirect.factor.markupPct).div(100)))
        .mul(input.massT).toFixed()
    }
  }
```

…and add the reason constant beside the existing `NO_DEFAULT_REASON` at the top of the file:

```ts
const NO_INDIRECT_ROUTE_REASON =
  'The Commission publishes indirect (electricity) default values for this good and origin, but ' +
  'none for the production route declared, so no estimate is shown. Pricing the electricity ' +
  'component at zero would understate the bill without saying so.'
```

- [ ] **Step 5: Update the other two call sites — same commit, or the build breaks**

`src/stores/estimator.ts`:

```ts
  /** Whether the Commission publishes an indirect default here — drives the scope control. */
  function hasIndirect(input: EstimatorInput): boolean {
    // `kind !== 'none'`, NOT `=== 'found'`. A route mismatch means the Commission DOES publish
    // indirect values for this good — the control must stay visible so the user can reach the
    // refusal that explains it. Hiding it would bury the very thing the refusal exists to say.
    return pack.value ? selectIndirectFactorFromPack(pack.value, input).kind !== 'none' : false
  }
```

`lib/estimator/threshold-and-indirect.test.ts:101` — preserve its meaning exactly:

```ts
    expect(selectIndirectFactorFromPack(pack, steel).kind).toBe('none')
```

- [ ] **Step 6: Run, expect all passing**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npx vitest run lib/estimator/indirect-route.test.ts
npm test
npm run typecheck
```

Baseline is **435 tests passing**, typecheck clean. Expect 435 + your 8. If any PRE-EXISTING test
fails, stop and report rather than adjusting it — the `CEMENT` fixture (`25070080`/`AO`/`(A)`) has
exactly one indirect row keyed to the route it passes, so nothing existing should move.

- [ ] **Step 7: Commit**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git add lib/estimator/estimate-from-pack.ts src/stores/estimator.ts \
        lib/estimator/threshold-and-indirect.test.ts lib/estimator/indirect-route.test.ts
git commit -m "fix(estimator): the indirect default follows the declared route

It matched on good, origin and year but not route, on the stated grounds that
indirect rows are published per good. 597 of the corpus's 8,310 indirect rows
carry a real route, 90 groups differ by route, and .find() took whichever sorted
first — the dearer one every time. Algerian cement clinker on route (A) was
priced with route (B)'s electricity: EUR 5,882.98 against EUR 5,717.19, with the
CSV exporting benchmark_route (A) beside it. Changing the route on the form did
not move the figure at all.

Strict matching loses nothing (8,310 of 8,310 selectors still resolve) and makes
the lookup deterministic: with the route included no candidate set holds more
than one row.

The return type grows to three outcomes because null already meant 'no indirect
published here' for steel and aluminium, and collapsing that with a route
mismatch is how this hid. A mismatch now refuses rather than pricing electricity
at zero."
```

### Task 2: Re-vendor and pin the worked example (website)

**Files:**
- Modify: `src/scripts/cbam-algos/estimator/estimate-from-pack.ts` (via `cp` only)
- Modify: `src/scripts/cbam-algos/UPSTREAM.json` (via `--update` only)
- Modify: `tests/unit/cbam-render.test.mjs` (append)

Work in a dedicated worktree, NOT the shared checkout:

```bash
cd /Volumes/VSTSAMPLES/Projects/Angad
git fetch origin --quiet
git worktree add /private/tmp/cbam-indirect --detach origin/main
ln -s /Volumes/VSTSAMPLES/Projects/Angad/node_modules /private/tmp/cbam-indirect/node_modules
cd /private/tmp/cbam-indirect
git checkout -b fix/cbam-indirect-route
```

`src/stores/estimator.ts` is the SaaS's own Vue store and is **not** among the 11 vendored files,
so it does not come down.

- [ ] **Step 1: Copy down and re-record**

```bash
cd /private/tmp/cbam-indirect
cp /Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/estimate-from-pack.ts src/scripts/cbam-algos/estimator/estimate-from-pack.ts
node scripts/cbam-sync-check.mjs --update
node scripts/cbam-sync-check.mjs
git diff --stat
```

The check must report the engine intact and in sync, and `git diff --stat` must show **exactly two
files**. More than that means something else drifted — stop and report.

- [ ] **Step 2: Write the failing test**

Append to `tests/unit/cbam-render.test.mjs`, reusing its existing `estimateFromPack` import and
`pack` load — do not add a second import or a second pack load:

```js
/* ── the electricity default follows the route you declared ─────────────────── */

test('route (A) is priced with route (A) electricity, not route (B)\'s', () => {
  // Algerian cement clinker publishes indirect (A): 0.04 and (B): 0.06. The lookup used to match
  // on good/origin/year only and take whichever sorted first — the dearer one — so route (A) was
  // over-charged EUR 165.79 per 100 t, and changing the route on the form moved nothing.
  const line = { cn: '25231000', country: 'DZ', massT: '100', date: '2026-03-15',
    emissionsScope: 'direct_and_indirect' };
  const a = estimateFromPack(pack, { ...line, route: '(A)' });
  const b = estimateFromPack(pack, { ...line, route: '(B)' });
  assert.equal(a.status, 'cscf_pending');
  assert.equal(b.status, 'cscf_pending');
  assert.equal(a.scenario.certificates, '75.865');
  assert.equal(a.scenario.costEur, '5717.19');
  assert.equal(b.scenario.certificates, '64.7475');
  assert.equal(b.scenario.costEur, '4879.37');
  assert.notEqual(a.scenario.costEur, b.scenario.costEur,
    'the two routes must price differently — before the fix they did not');
});
```

Verify those figures against the shipped pack before trusting them. If one is wrong, investigate
before changing it — the number is probably right and something else wrong. Say so loudly with
evidence rather than silently adjusting.

- [ ] **Step 3: Prove the test depends on the new engine**

```bash
cd /private/tmp/cbam-indirect
git stash push src/scripts/cbam-algos/estimator/estimate-from-pack.ts
node --import tsx --test tests/unit/cbam-render.test.mjs 2>&1 | tail -8
git stash pop
npm run test:unit 2>&1 | tail -6
```

Note `npm run test:unit` runs `cbam-sync-check` first and bails on drift, so a stashed engine
cannot show a clean red through it — run the raw runner for the red, as shown. Expect FAIL while
stashed, PASS after restoring. Report both verbatim.

- [ ] **Step 4: Full gates**

```bash
cd /private/tmp/cbam-indirect
npm run test:unit
node scripts/cbam-sync-check.mjs
npx astro check 2>&1 | tail -4
```

Baseline is **378 unit tests passing**, sync-check green. `astro check` reports **2 errors**, both
`Cannot find module 'mapillary-js'` in `street-view-panel.ts` — a missing dependency in the shared
`node_modules`, unrelated to this change. **Do not run `npm ci` to make them disappear**; instead
confirm delta-zero by checking the same two errors appear on pristine `origin/main`.

- [ ] **Step 5: Commit**

```bash
cd /private/tmp/cbam-indirect
git add src/scripts/cbam-algos/estimator/estimate-from-pack.ts src/scripts/cbam-algos/UPSTREAM.json tests/unit/cbam-render.test.mjs
git commit -m "fix(cbam): re-vendor the indirect route match, pin both routes

Route (A) on Algerian cement clinker now prices its own electricity: 75.865
certificates / EUR 5,717.19 against route (B)'s 64.7475 / EUR 4,879.37. Before
this the two routes returned the same figure, and it was the dearer one."
```

### Task 3: Measure the blast radius

**Files:** none — a measurement, and its output is the report. Change no source file, commit nothing.

The spec claims strict matching loses nothing and corrects 90 values. Prove it against the shipped
pack rather than trusting the pre-implementation figure.

- [ ] **Step 1: Sweep end-to-end, before and after**

Work in `/private/tmp/cbam-indirect`. Build the pre-fix engine from `HEAD^` into an out-of-repo
copy rather than stashing — the repo is then never written to:

```bash
mkdir -p /private/tmp/indirect-sweep/pre
cd /private/tmp/cbam-indirect
git show HEAD^:src/scripts/cbam-algos/estimator/estimate-from-pack.ts > /private/tmp/indirect-sweep/pre-estimator.ts
```

Copy the whole `src/scripts/cbam-algos` tree twice (pre and post), swapping only that one file in
the `pre` copy, and sweep every `(cn, country, route)` the form can offer — derive them from
`classifications` × `defaultFactors.originCountry` × `routesFor`, which is what the UI actually
fills its controls from — crossed with `emissionsScope: 'direct_and_indirect'` (the only scope that
reads an indirect factor) for reporting years 2026, 2027 and 2028.

**Serialise the whole result object**, not just status and figures. A previous sweep on this
codebase compared status only and missed 10,300 user-visible `selector` changes.

- [ ] **Step 2: Report the shape of the change**

Required outcomes, each to be confirmed or refuted explicitly:

- **Every** changed probe lowers or leaves unchanged the certificate count — this fix corrects an
  over-charge, so nothing may go up.
- **Zero** probes go `priced → REFUSED` against the shipped pack (the `route-mismatch` refusal must
  be unreachable today; the corpus aligns 510 of 510).
- The count of changed probes is consistent with **90 corrected (good, origin, year) groups**.
- No probe changes on `emissionsScope: 'direct'`, which never reads an indirect factor.

If any is violated, stop and report it as the headline — the change is not what the spec claims.

- [ ] **Step 3: Clean up**

```bash
rm -rf /private/tmp/indirect-sweep
```

### Task 4: Land it

- [ ] **Step 1: CBM first**

The vendored copy must never be ahead of upstream.

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npx vitest run 2>&1 | tail -3
git checkout main && git merge --ff-only fix/indirect-route
npx vitest run 2>&1 | tail -3
git push origin main
```

- [ ] **Step 2: Then the website**

```bash
cd /private/tmp/cbam-indirect
git fetch origin --quiet
git merge origin/main --no-edit
npm run test:unit && node scripts/cbam-sync-check.mjs
git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
```

- [ ] **Step 3: Verify the deploy**

Fetch `https://deltaclimate.earth/cbam/cbam-calculator/`, read the referenced
`/_astro/cbam-calculator*.js` bundle, and confirm the indirect lookup now carries the route. The
minifier renames identifiers, so grep for the shape — a `productionRoute===` comparison inside the
indirect path — rather than for a function name. If absent, wait and retry rather than concluding
the deploy failed.

- [ ] **Step 4: Clean up**

```bash
cd /Volumes/VSTSAMPLES/Projects/Angad
git worktree remove /private/tmp/cbam-indirect --force
git worktree prune
git branch -D fix/cbam-indirect-route 2>/dev/null
cd /Volumes/VSTSAMPLES/Projects/CBM && git branch -d fix/indirect-route
```

---

## Self-review

**Spec coverage.** Strict route match → Task 1 Step 3. Three-way return type → Task 1 Step 3.
Refusal on mismatch → Task 1 Step 4 (`NO_INDIRECT_ROUTE_REASON` + selector). `hasIndirect` as
`kind !== 'none'` → Task 1 Step 5. The `.toBeNull()` call site → Task 1 Step 5. Worked example →
Task 1 Steps 1–2 and Task 2 Step 2. Zero-loss and determinism claims → Task 1's sweep tests.
Re-vendor → Task 2. Blast radius → Task 3. Landing → Task 4. The five out-of-scope defects are
named in the spec and deliberately absent here.

**Placeholders.** None — every step carries its code or its exact command.

**Type consistency.** `IndirectLookup` with `kind: 'found' | 'none' | 'route-mismatch'` and
`factor` on the `found` arm is used identically in Steps 3, 4 and 5 and in every test.
`NO_INDIRECT_ROUTE_REASON` is defined in Step 4 and referenced only there. `selectIndirectFactorFromPack`
keeps its name and parameter order throughout.

**One risk worth naming.** Task 1 changes a type and three call sites in a single commit. That is
deliberate — splitting them would leave a commit that does not compile, which is the history defect
the boundary fix had to repair. If the implementer finds a fourth call site, it belongs in the same
commit, and they should say so rather than opening a second one.
