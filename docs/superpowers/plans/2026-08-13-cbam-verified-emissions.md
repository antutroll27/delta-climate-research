# Verified Emissions Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-line verified emissions entry in the public CBAM calculator — an "Emissions data" dropdown that lets an importer replace the Commission default with their own attested, verified figures, and see what that choice is worth.

**Architecture:** Upstream-first. The estimator change lands in the CBM SaaS repo (`/Volumes/VSTSAMPLES/Projects/CBM`), is re-vendored byte-for-byte into `src/scripts/cbam-algos/` with `UPSTREAM.json --update`, and everything else (line model, form, card, exports, tests) lives in this repo's own files. Spec: `docs/superpowers/specs/2026-08-13-cbam-verified-emissions-design.md`.

**Tech Stack:** TypeScript (vanilla, no framework in the calculator), decimal.js, node:test (Angad unit), vitest (CBM), Playwright (e2e), Astro page markup.

---

## STATUS — all 8 tasks executed (2026-08-14)

Every step below is ticked, but the boxes were ticked *after the fact*, in one pass, once the work
was already done — they were not a live progress tracker, so do not read them as a record that each
step ran exactly as written. Several did not. Where review changed the design, the task text is
annotated in place; the authoritative record is the commits.

| Task | Commits | Where the shipped work differs from the text below |
| --- | --- | --- |
| 1 · upstream engine | `a524fef` `8b8694c` `4aa4e9e` **(CBM repo, branch `feat/verified-emissions`)** | `originBasis` corrected to `null`; the estimator now VALIDATES the attested figures and refuses fail-closed; the test reads the live pack instead of a pasted fixture. See the annotations in Task 1. |
| 2 · re-vendor + pin | `2983f34` | as written |
| 3 · line model | `0961a5f` `cfe01cd` `9b42b69` | filler is `?? null`, not `?? ''` — absent and empty are different engine outcomes and must digest differently; order pinned by golden digests, because a pair-comparison provably cannot detect a transposition |
| 4 · CSV | `32ce3d1` `c2c1b73` | gained a tier-agreement throw (line vs the estimate that priced it) |
| 5 · form | `f4eae2a` `ff7cb92` `3439540` | `parseVerifiedFields` OMITS blank optional keys rather than emitting `''`; the indirect figure is wiped only when it could still price unseen; `onCsv`/`onDoc` gained try/catch |
| 6 · card | `cbdfad4` | the "no comparison" state is three sentences, not one — the single wording was false when the refusal is on the verified side |
| 7 · print document | `aa2ce51` | §1 gained a **Data tier** column (9 columns now); `inputFor` extracted so the two estimate paths cannot drift |
| 8 · e2e + docs | `a93f81f` `809907e` `29187b1` `593c74d` | four review follow-ups landed first; the mark-up is FOUR bands (1/10/20/30%), not the 10–30% asserted throughout |

**Gates at completion:** 376 unit tests passing · 21 e2e passing · `cbam-sync-check` intact ·
`astro check` 0 errors. (The 2 `mapillary-js` errors carried as "pre-existing" through most of the
build were an incomplete `node_modules` in the worktree, repaired by `npm ci` in Task 8.)

**Precondition never met, deliberately:** the IR 2026/1740 pack rebuild has still not landed. The
worked example survives either corpus — 72061000/IN is unchanged in v2 — so nothing here rests on
it, but the estimator will be edited a second time when that rebuild happens.

---

## Preconditions — check before Task 1

The spec sequences the **IR (EU) 2026/1740 pack rebuild first**. Verify:

```bash
node -e "const p=require('/Volumes/VSTSAMPLES/Projects/Angad/public/cbam/estimator-pack.json'); console.log(p.generatedFrom.map(g=>g.workbookSha256.slice(0,12)))"
```

If the output still shows `865372ed2364` / `b79108b025e6` (the v1 hashes), the rebuild has NOT landed. **Stop and ask the user** whether to proceed anyway (the worked example below survives either corpus — 72061000/IN is unchanged in v2 — but the upstream estimator file would then be edited twice in flight).

## Standing constraints — repeat to every subagent

- **Never hand-edit anything under `src/scripts/cbam-algos/`** except `cbam-app.ts` (the one documented vendoring exception). The estimator and engine change ONLY via the CBM repo + re-vendor + `node scripts/cbam-sync-check.mjs --update`.
- **Never `git add -A` or `git add .`** — the working tree carries other sessions' files. Stage each file by name.
- Before reporting done: `npm run test:unit`, `node scripts/cbam-sync-check.mjs`, `npx astro check` — all green.
- Comments explain WHY, naming the hazard.

## File structure

| File | Responsibility |
| --- | --- |
| `CBM/lib/estimator/estimate-from-pack.ts` | gains the optional `verified` input (Task 1) |
| `CBM/lib/estimator/estimate-from-pack.verified.test.ts` | NEW — upstream tests (Task 1) |
| `src/scripts/cbam-algos/estimator/estimate-from-pack.ts` | re-vendored copy (Task 2, `cp` only) |
| `src/scripts/cbam-algos/UPSTREAM.json` | re-recorded hash (Task 2, `--update` only) |
| `src/scripts/cbam-lines.ts` | Line fields, fingerprint, CSV columns (Tasks 3–4) |
| `src/scripts/cbam-algos/cbam-app.ts` | form plumbing, card, delta, print §4 (Tasks 5–7) |
| `src/pages/cbam/cbam-calculator.astro` | form markup (Task 5) |
| `tests/unit/cbam-lines.test.mjs` | Tasks 3–4 tests |
| `tests/unit/cbam-render.test.mjs` | Tasks 2, 5–7 tests (§4 pinned constants live here) |
| `tests/e2e/cbam-lines.spec.ts` | Task 8 e2e |
| `docs/cbam-engine-reference.md` | Task 8 doc update |

## The worked example every task pins against

CN `72061000` · India · route `(C)` · verified direct `2.31` tCO₂e/t · `100` t · `2026-03-15`:

```
emissions   = 2.31 × 100          = 231          (NO mark-up — the point of the feature)
SEFA/t      = 0.975 × 1 × 1.288   = 1.2558
FAA         = 125.58
chargeable  = 231 − 125.58        = 105.42       → certificates '105.42'
cost        = 105.42 × 75.36      = €7,944.45    (scenario.costEur '7944.45')
default path for the same line: 2.64 × 1.1 × 100 = 290.4 → 164.82 certs → €12,420.84
delta       = €4,476.39 saved
```

Both paths return `status: 'cscf_pending'` (CSCF 2026–2030 unpublished) with a priced Q1-2026 scenario.

---

### Task 1: Upstream verified path (CBM repo)

**Files:**
- Modify: `/Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/estimate-from-pack.ts` (interface at lines ~55–68, function body at ~255)
- Test: `/Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/estimate-from-pack.verified.test.ts` (NEW)

- [x] **Step 1: Build the test fixture from the real pack**

The test needs real rows, not invented ones. Extract them:

```bash
node -e "
const p=require('/Volumes/VSTSAMPLES/Projects/Angad/public/cbam/estimator-pack.json');
const pick={
  generatedFrom:p.generatedFrom,
  classifications:p.classifications.filter(c=>['72061000'].includes(c.code)),
  defaultFactors:p.defaultFactors.filter(d=>d.scopeCode==='72061000'&&d.originCountry==='IN'),
  benchmarks:p.benchmarks.filter(b=>b.scopeCode==='72061000'),
  cbamFactors:p.cbamFactors, cscf:p.cscf, prices:p.prices, sources:p.sources, thresholds:p.thresholds};
console.log(JSON.stringify(pick,null,1))" > /tmp/verified-fixture.json
wc -l /tmp/verified-fixture.json
```

- [x] **Step 2: Write the failing test**

Create `lib/estimator/estimate-from-pack.verified.test.ts`. Paste the fixture JSON from Step 1 as the `PACK` literal (it is small — one CN's rows plus the shared series):

```ts
import { describe, expect, it } from 'vitest'
import { estimateFromPack, type EstimatorPack } from './estimate-from-pack'

const PACK: EstimatorPack = /* paste /tmp/verified-fixture.json here */ as EstimatorPack

const base = { cn: '72061000', country: 'IN', route: '(C)', massT: '100', date: '2026-03-15' }

describe('verified emissions path', () => {
  it('prices the attested figure with NO mark-up and tier actual-verified', () => {
    const e = estimateFromPack(PACK, { ...base, verified: { directTco2ePerT: '2.31' } })
    expect(e.status).toBe('cscf_pending')
    if (e.status !== 'cscf_pending') return
    expect(e.emissionsTco2e).toBe('231')          // 2.31 × 100 — not 2.31 × 1.1 × 100
    expect(e.scenario.certificates).toBe('105.42')
    expect(e.scenario.costEur).toBe('7944.45')
    expect(e.stamp.tier).toBe('actual-verified')
  })

  it('default path is untouched: same line without verified still marks up', () => {
    const e = estimateFromPack(PACK, base)
    expect(e.status).toBe('cscf_pending')
    if (e.status !== 'cscf_pending') return
    expect(e.emissionsTco2e).toBe('290.4')        // 2.64 × 1.1 × 100
    expect(e.scenario.costEur).toBe('12420.84')
    expect(e.stamp.tier).toBe('default+markup')
  })

  it('verified works where the Commission publishes NO default', () => {
    const noDefaults = { ...PACK, defaultFactors: [] }
    const e = estimateFromPack(noDefaults, { ...base, verified: { directTco2ePerT: '2.31' } })
    expect(e.status).toBe('cscf_pending')          // NOT 'unavailable' — that refusal is defaults-only
  })

  it('verified CANNOT rescue a missing benchmark', () => {
    const noBench = { ...PACK, benchmarks: [] }
    const e = estimateFromPack(noBench, { ...base, verified: { directTco2ePerT: '2.31' } })
    expect(e.status).toBe('unavailable')
  })

  it('indirect figure is read only when the scope includes indirect', () => {
    const scoped = estimateFromPack(PACK, {
      ...base, emissionsScope: 'direct_and_indirect',
      verified: { directTco2ePerT: '2.31', indirectTco2ePerT: '0.14' },
    })
    const unscoped = estimateFromPack(PACK, {
      ...base, emissionsScope: 'direct',
      verified: { directTco2ePerT: '2.31', indirectTco2ePerT: '0.14' },
    })
    expect(scoped.status).toBe('cscf_pending')
    expect(unscoped.status).toBe('cscf_pending')
    if (scoped.status !== 'cscf_pending' || unscoped.status !== 'cscf_pending') return
    // 0.14 × 100 = 14 extra chargeable tCO2e, no free allocation against it
    expect(Number(scoped.scenario.certificates)).toBeCloseTo(105.42 + 14, 6)
    expect(unscoped.scenario.certificates).toBe('105.42')
  })

  it('zero direct is legal — the floor clamp already guards the downside', () => {
    const e = estimateFromPack(PACK, { ...base, verified: { directTco2ePerT: '0' } })
    expect(e.status).toBe('cscf_pending')
    if (e.status !== 'cscf_pending') return
    expect(e.scenario.certificates).toBe('0')      // clamped, never negative
  })
})
```

- [x] **Step 3: Run, expect failure**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM && npx vitest run lib/estimator/estimate-from-pack.verified.test.ts
```
Expected: FAIL — `verified` does not exist on `EstimatorInput`.

- [x] **Step 4: Implement**

In `lib/estimator/estimate-from-pack.ts`, extend the interface (after `emissionsScope`, line ~67):

```ts
  /**
   * The importer's own VERIFIED specific embedded emissions, per tonne of good. When present
   * the default-values corpus is not consulted and NO mark-up is applied — the mark-up exists
   * to price not-having-data, and this is the regulation's designed reward for having it.
   * The figure must be the WHOLE good's embedded emissions (precursors included): that scope
   * is what keeps the line on Column B. Process-only figures are Column A territory — the
   * workspace's job, never this estimator's.
   * CORRECTED AFTER REVIEW — the draft said these values were "trusted as UI-validated, exactly
   * like massT: the engine's floor clamp already fails closed on nonsense." Both halves were
   * false. massT really is UI-guarded; nothing passes `verified` yet, so there was no guard to
   * inherit. And the floor clamp covers the DIRECT side only (certificate-estimate.ts applies
   * Decimal.max(0, ...) then ADDS indirect), so a negative indirect figure produced a confident
   * NEGATIVE bill — measured at -394.58 certificates / -EUR 29,735.55. The estimator must
   * validate these figures itself and refuse via unavailableEstimate: empty, unparseable,
   * non-finite, negative, or a non-decimal radix literal like '0x10'.
   */
  verified?: {
    directTco2ePerT: string
    /** read only when emissionsScope includes indirect — same gate as the defaults path */
    indirectTco2ePerT?: string
  }
```

In `estimateFromPack` (body starts ~line 255), insert the verified branch after `const year = …` and BEFORE `const factor = selectFactorFromPack(pack, input)` — the verified path must not depend on `factor`, whose absence means something different here:

```ts
  if (input.verified) {
    const mass = new Decimal(input.massT)
    const emissions = new Decimal(input.verified.directTco2ePerT).mul(mass).toFixed()
    const indirectTco2e =
      input.emissionsScope === 'direct_and_indirect' && input.verified.indirectTco2ePerT
        ? new Decimal(input.verified.indirectTco2ePerT).mul(mass).toFixed()
        : '0'
    return estimateCertificates({
      emissionsTco2e: emissions,
      quantityT: input.massT,
      scope: 'full_product',
      tier: 'actual-verified',
      // CORRECTED AFTER REVIEW — the draft of this plan said `originBasis: 'country'`, which is
      // WRONG. certificate-estimate.ts documents `null` as "not a default-derived figure
      // (verified actual)", production's originBasisOf() returns null for any method that is not
      // official_default, and DisclosureCard.vue renders "the origin's own published default"
      // on any truthy value — i.e. it would have told a user their own audited figure rested on
      // a Commission default. Pass null.
      originBasis: null,
      emissionsType: 'direct',
      cnCode: input.cn,
      routeIndicator: benchmarkRoute(input.route),
      importDate: input.date,
      precursors: [],
      indirectTco2e,
      snapshotHash: 'browser-prototype',
      linePackage: dvPackageId(pack),
      customsLineId: 'estimator-prototype',
    }, faTablesOf(pack))
  }
```

Also update the file-header comment line that reads "Defaults path only (scope full_product → Column B); actual/verified data is the workspace's job" to: "Defaults path, plus attested verified figures (both scope full_product → Column B); Column A / process-level data stays the workspace's job."

- [x] **Step 5: Run the new test, expect pass; run the whole CBM suite**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM && npx vitest run lib/estimator/estimate-from-pack.verified.test.ts && npm test
```
Expected: new file 6/6 PASS, full suite green.

> **What actually happened (recorded 2026-08-13).** Task 1 landed as `a524fef` + `8b8694c` on
> CBM branch `feat/verified-emissions`, and review changed it materially:
> - `originBasis` corrected from `'country'` to `null` (see the annotation above) — my error.
> - The estimator now VALIDATES both verified figures and refuses via `unavailableEstimate` with
>   a `BAD_VERIFIED_REASON` constant and a `verified/<cn>/<field>` selector. Before this,
>   `''` and `'abc'` threw `DecimalError` *outside* the fail-closed boundary, `'NaN'`/`'Infinity'`
>   propagated into output strings, `'-1'` direct gave a confident EUR 0.00, and `'-5'` indirect
>   gave a confident negative bill.
> - `baseInput` and `tables` were hoisted above the branch and spread, with `baseInput` typed
>   `Omit<CertificateEstimateInput, 'originBasis'>` so each path must state its own provenance
>   claim. This killed a surviving mutation where a fabricated `snapshotHash` went unnoticed.
> - The test reads the live `public/estimator-pack.json` like its four siblings, NOT a pasted
>   fixture — a 380-line copy would have stayed green against a corpus the app no longer ships,
>   which matters because IR 2026/1740 is about to supersede these defaults.
> - Tests grew 6 → 23; CBM suite 385 → 402.
> - Declined, with evidence: pinning `benchmarkRoute()`'s `'default' → ''` translation by figure
>   or status. `resolveBenchmark` falls back to route-independent rows anyway, so removing the
>   translation leaves all 402 green. Only the user-facing refusal SELECTOR differs, and that is
>   what the added test pins instead.

- [x] **Step 6: Commit (CBM repo)**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git add lib/estimator/estimate-from-pack.ts lib/estimator/estimate-from-pack.verified.test.ts
git commit -m "feat(estimator): attested verified figures skip defaults and the mark-up

The mark-up prices not-having-data; a verified figure is the designed escape.
Whole-good scope only, so the line stays on Column B. A missing benchmark
still refuses — verified emissions replace one side of the subtraction, they
cannot invent the other."
```

### Task 2: Re-vendor + pin the worked example (Angad repo)

**Files:**
- Modify: `src/scripts/cbam-algos/estimator/estimate-from-pack.ts` (via `cp`, never by hand)
- Modify: `src/scripts/cbam-algos/UPSTREAM.json` (via `--update`, never by hand)
- Test: `tests/unit/cbam-render.test.mjs` (append)

- [x] **Step 1: Copy and re-record**

```bash
cd /Volumes/VSTSAMPLES/Projects/Angad
cp /Volumes/VSTSAMPLES/Projects/CBM/lib/estimator/estimate-from-pack.ts src/scripts/cbam-algos/estimator/estimate-from-pack.ts
node scripts/cbam-sync-check.mjs --update
node scripts/cbam-sync-check.mjs   # must report intact + in sync
git diff --stat                     # exactly 2 files: the estimator + UPSTREAM.json
```

- [x] **Step 2: Write the failing worked-example test**

Append to `tests/unit/cbam-render.test.mjs` (it already imports `estimateFromPack` and loads the real `pack`):

```js
/* ── verified emissions: the spec §6 worked line, pinned end-to-end ─────────── */

test('verified figures price with no mark-up — the spec worked example', () => {
  const e = estimateFromPack(pack, {
    cn: '72061000', country: 'IN', route: '(C)', massT: '100', date: '2026-03-15',
    verified: { directTco2ePerT: '2.31' },
  });
  assert.equal(e.status, 'cscf_pending');
  assert.equal(e.emissionsTco2e, '231');
  assert.equal(e.scenario.certificates, '105.42');
  assert.equal(e.scenario.costEur, '7944.45');
  assert.equal(e.stamp.tier, 'actual-verified');
  // and the SAME line through the default path still gives the marked-up figure —
  // this pair IS the delta the card will show (€12,420.84 − €7,944.45)
  const d = estimateFromPack(pack, {
    cn: '72061000', country: 'IN', route: '(C)', massT: '100', date: '2026-03-15',
  });
  assert.equal(d.status, 'cscf_pending');
  assert.equal(d.scenario.costEur, '12420.84');
});
```

- [x] **Step 3: Run before the copy is committed — with the OLD vendored file it must fail**

```bash
node --test tests/unit/cbam-render.test.mjs 2>&1 | tail -5
```
Expected: PASS (the copy in Step 1 already landed the capability). To honour TDD's spirit here, verify the test WOULD fail against the old engine: `git stash push src/scripts/cbam-algos/estimator/estimate-from-pack.ts && node --test tests/unit/cbam-render.test.mjs 2>&1 | tail -3 && git stash pop` — expect the stashed run to FAIL, the restored run to PASS.

- [x] **Step 4: Full gates**

```bash
npm run test:unit && node scripts/cbam-sync-check.mjs && npx astro check 2>&1 | tail -3
```

- [x] **Step 5: Commit**

```bash
git add src/scripts/cbam-algos/estimator/estimate-from-pack.ts src/scripts/cbam-algos/UPSTREAM.json tests/unit/cbam-render.test.mjs
git commit -m "feat(cbam): re-vendor the estimator's verified path, pin the worked line

231 tCO2e at 2.31/t attested — no mark-up — against the same benchmark:
€7,944.45, vs €12,420.84 for the default path. That pair is the delta the
card will show, pinned here so a pack regeneration that moves either side
fails loudly."
```

### Task 3: Line model + fingerprint

**Files:**
- Modify: `src/scripts/cbam-lines.ts` (the `Line` interface and `lineFingerprint`)
- Test: `tests/unit/cbam-lines.test.mjs` (append)

- [x] **Step 1: Write the failing tests**

```js
test('a line carries its tier, and the fingerprint pins attested figures as entered', async () => {
  const base = line({ id: 'L1' });                      // existing helper: default fields
  const dflt = { ...base, tier: 'default+markup' };
  const ver  = { ...base, tier: 'actual-verified', seeDirect: '2.31', verifiedRef: 'BV-2026-0142' };
  const [a, b] = await Promise.all([lineFingerprint(dflt), lineFingerprint(ver)]);
  assert.notEqual(a, b, 'tier and figures must change the digest');
  // the reference alone must also change it — an attested claim is pinned as entered
  const c = await lineFingerprint({ ...ver, verifiedRef: 'BV-2026-0143' });
  assert.notEqual(b, c);
  // and a default line's digest is stable against the new optional fields being absent
  const d = await lineFingerprint({ ...base, tier: 'default+markup' });
  assert.equal(a, d);
});

test('threshold maths ignores the tier — 50 t is 50 t', () => {
  const dflt = { ...line({ id: 'L1', massT: '60' }), tier: 'default+markup' };
  const ver  = { ...line({ id: 'L2', massT: '60' }), tier: 'actual-verified', seeDirect: '2.31' };
  const fps = new Map([['L1', 'a'.repeat(64)], ['L2', 'b'.repeat(64)]]);
  const [ya] = thresholdByYear([dflt], fps, new Set(), pack);
  const [yb] = thresholdByYear([ver],  fps, new Set(), pack);
  assert.equal(ya.state, yb.state);
  assert.equal(ya.knownEligibleMassT, yb.knownEligibleMassT);
});
```

- [x] **Step 2: Run, expect failure** (`tier` not on `Line`; fingerprint unchanged by the new fields)

```bash
node --test tests/unit/cbam-lines.test.mjs 2>&1 | tail -5
```

- [x] **Step 3: Implement**

In `src/scripts/cbam-lines.ts`, extend the interface:

```ts
export interface Line {
  id: string;        // row key and ImportMassEntry.id — NOT part of the fingerprint
  cn: string;
  country: string;
  route: string;
  scope: 'direct' | 'direct_and_indirect';
  massT: string;
  date: string;      // ISO date; calendar year is date.slice(0, 4)
  /** engine DataTier strings verbatim, so the stamp and the CSV can never disagree */
  tier: 'default+markup' | 'actual-verified';
  seeDirect?: string;      // attested tCO2e per tonne; present iff tier is 'actual-verified'
  seeIndirect?: string;
  verifiedRef?: string;    // optional verifier/report reference — transcribed, never checked
}
```

And the fingerprint — new fields appended at the END so the digest keeps one shape for both tiers:

```ts
export function lineFingerprint(line: Line): Promise<string> {
  return sha256Hex(JSON.stringify([
    line.cn, line.country, line.route, line.scope, line.massT, line.date,
    line.tier, line.seeDirect ?? '', line.seeIndirect ?? '', line.verifiedRef ?? '',
  ]));
}
```

Existing tests that construct `Line` literals will now fail typecheck until they carry `tier` — update the file's `line()` helper to default `tier: 'default+markup'` so every existing test keeps its meaning unchanged.

- [x] **Step 4: Run, expect all passing**

```bash
node --test tests/unit/cbam-lines.test.mjs 2>&1 | tail -3 && npx astro check 2>&1 | tail -3
```

- [x] **Step 5: Commit**

```bash
git add src/scripts/cbam-lines.ts tests/unit/cbam-lines.test.mjs
git commit -m "feat(cbam): lines carry their data tier; fingerprints pin attested figures

tier, both per-tonne figures and the reference fold into the digest — an
attested number is pinned exactly as entered. Threshold maths is untouched:
the 50 t gate counts mass, whatever the tier."
```

### Task 4: CSV columns

**Files:**
- Modify: `src/scripts/cbam-lines.ts` (`csvRows`)
- Test: `tests/unit/cbam-lines.test.mjs` (append)

- [x] **Step 1: Write the failing tests**

```js
test('CSV rows carry the data tier and the attested reference', () => {
  const ver = { ...line({ id: 'L1' }), tier: 'actual-verified', seeDirect: '2.31', verifiedRef: 'BV-2026-0142' };
  const rows = csvRows([ver], [est(ver.cn, ver.country, ver.route, ver.massT)], fp, 'f'.repeat(64), pack);
  assert.equal(rows[0].data_tier, 'actual-verified');
  assert.equal(rows[0].verified_reference, 'BV-2026-0142');
  // column ORDER is the CSV contract: the two new columns sit directly after cscf_status
  const cols = Object.keys(rows[0]);
  assert.equal(cols[cols.indexOf('cscf_status') + 1], 'data_tier');
  assert.equal(cols[cols.indexOf('cscf_status') + 2], 'verified_reference');
});

test('a hostile reference cannot become a spreadsheet formula', () => {
  const ver = { ...line({ id: 'L1' }), tier: 'actual-verified', seeDirect: '2.31', verifiedRef: '=cmd()' };
  const rows = csvRows([ver], [est(ver.cn, ver.country, ver.route, ver.massT)], fp, 'f'.repeat(64), pack);
  const csv = toCsv(rows);
  assert.ok(!csv.includes(',=cmd()'), 'leading = must arrive prefixed, not executable');
});
```

- [x] **Step 2: Run, expect failure** (`data_tier` undefined)

- [x] **Step 3: Implement** — in `csvRows`'s row literal, insert directly after the `cscf_status` property:

```ts
      data_tier: l.tier,
      verified_reference: l.verifiedRef ?? '',
```

No `toCsv` change: its `cell()` already prefixes leading `= + - @` (verify the second test passes because of that existing guard, not a new one).

- [x] **Step 4: Run, expect all passing** (`node --test tests/unit/cbam-lines.test.mjs`)

- [x] **Step 5: Commit**

```bash
git add src/scripts/cbam-lines.ts tests/unit/cbam-lines.test.mjs
git commit -m "feat(cbam): CSV rows name their data tier and carry the attested reference

Two columns after cscf_status. The delta stays OFF the CSV — rows carry
engine values verbatim, one hypothetical per row. The existing injection
guard covers the free-text reference; a test now proves it."
```

### Task 5: Form markup + app plumbing

**Files:**
- Modify: `src/pages/cbam/cbam-calculator.astro` (after the `#cbScopeRow` block, before the mass/date row at line ~105)
- Modify: `src/scripts/cbam-algos/cbam-app.ts` (`draftLine` ~line 880, `estimateLine` ~855, `run` ~831, element lookups ~685, plus a new exported `parseVerifiedFields`)
- Test: `tests/unit/cbam-render.test.mjs` (append)

- [x] **Step 1: Write the failing tests for the pure validator**

```js
/* ── verified-entry form validation (pure function; DOM wiring is e2e's job) ── */
import { parseVerifiedFields } from '../../src/scripts/cbam-algos/cbam-app.ts';   // add to existing import list

test('parseVerifiedFields: default tier passes through untouched', () => {
  const r = parseVerifiedFields({ tier: 'default+markup', direct: '', indirect: '', attested: false, ref: '' });
  assert.deepEqual(r, { ok: { tier: 'default+markup' } });
});

test('parseVerifiedFields: verified requires a non-negative direct figure and the tick', () => {
  const bad = [
    { direct: '',     attested: true,  why: /direct/i },
    { direct: '-1',   attested: true,  why: /zero or greater/i },
    { direct: 'abc',  attested: true,  why: /number/i },
    { direct: '2.31', attested: false, why: /attest/i },
  ];
  for (const b of bad) {
    const r = parseVerifiedFields({ tier: 'actual-verified', direct: b.direct, indirect: '', attested: b.attested, ref: '' });
    assert.ok('error' in r, JSON.stringify(b));
    assert.match(r.error, b.why);
  }
  const ok = parseVerifiedFields({ tier: 'actual-verified', direct: ' 2.31 ', indirect: '0.14', attested: true, ref: ' BV-1 ' });
  assert.deepEqual(ok, { ok: { tier: 'actual-verified', seeDirect: '2.31', seeIndirect: '0.14', verifiedRef: 'BV-1' } });
});

test('parseVerifiedFields: zero direct is legal (100% scrap EAF is a real producer)', () => {
  const r = parseVerifiedFields({ tier: 'actual-verified', direct: '0', indirect: '', attested: true, ref: '' });
  assert.ok('ok' in r);
});
```

- [x] **Step 2: Run, expect failure** (no such export)

- [x] **Step 3: Implement `parseVerifiedFields` in `cbam-app.ts`** (near the other small helpers, before `renderLineCard`):

```ts
/** What the verified panel contributes to a draft Line, or the reason it cannot.
 *  Pure on purpose: the form handler stays thin and THIS carries the tests. */
export function parseVerifiedFields(v: {
  tier: string; direct: string; indirect: string; attested: boolean; ref: string;
}): { ok: Partial<Line> & { tier: Line['tier'] } } | { error: string } {
  if (v.tier !== 'actual-verified') return { ok: { tier: 'default+markup' } };
  const direct = v.direct.trim();
  if (!direct) return { error: 'Enter your verified direct emissions (tCO₂e per tonne).' };
  const n = Number(direct);
  if (!Number.isFinite(n)) return { error: 'Verified direct emissions must be a number.' };
  if (n < 0) return { error: 'Verified emissions must be zero or greater.' };
  const indirect = v.indirect.trim();
  const iN = Number(indirect || '0');
  if (indirect && (!Number.isFinite(iN) || iN < 0)) return { error: 'Verified indirect emissions must be a number, zero or greater.' };
  if (!v.attested) return { error: 'Tick the attestation — the figures are your claim, and the export says so.' };
  return { ok: {
    tier: 'actual-verified', seeDirect: direct,
    ...(indirect ? { seeIndirect: indirect } : {}), 
    ...(v.ref.trim() ? { verifiedRef: v.ref.trim() } : {}),
  } };
}
```

- [x] **Step 4: Add the form markup** in `cbam-calculator.astro`, after the `#cbScopeRow` closing `</div>` and before the mass/date row:

```astro
          <!-- Emissions source. A dropdown, not a toggle, by design review: it sits in the
               form like every other field. "My verified figures" reveals the panel; the
               attestation is the gate — we transcribe a claim, we never bless it. -->
          <div>
            <label class="cb-label" for="cbTier">Emissions data</label>
            <select id="cbTier" class="cb-field cb-select">
              <option value="default+markup" selected>Commission default + mark-up</option>
              <option value="actual-verified">My verified figures</option>
            </select>
          </div>
          <div id="cbVerifiedRow" hidden>
            <label class="cb-label" for="cbSeeDirect">Verified direct emissions (tCO₂e / tonne)</label>
            <input id="cbSeeDirect" class="cb-field" type="number" min="0" step="any" />
            <div id="cbSeeIndirectRow" hidden>
              <label class="cb-label" for="cbSeeIndirect">Verified indirect emissions (tCO₂e / tonne)</label>
              <input id="cbSeeIndirect" class="cb-field" type="number" min="0" step="any" />
            </div>
            <label class="cb-check"><input id="cbAttest" type="checkbox" />
              I attest these figures come from an accredited verification (ISO 14064-3 / CBAM
              Art. 8) — my claim, not checked by this tool.</label>
            <label class="cb-label" for="cbRef">Verification reference (optional)</label>
            <input id="cbRef" class="cb-field" type="text" placeholder="verifier / report ID" />
            <p class="cb-hint">Whole-good figures, precursors included — that scope is what a
              verifier's CBAM report states, and what keeps this estimate on Column B.</p>
          </div>
```

- [x] **Step 5: Wire it in `cbam-app.ts`**

Element lookups (next to the existing `scope`/`scopeRow` lookups at ~685):

```ts
  const tierSel = $<HTMLSelectElement>('cbTier'), verifiedRow = $('cbVerifiedRow');
  const seeDirect = $<HTMLInputElement>('cbSeeDirect'), seeIndirect = $<HTMLInputElement>('cbSeeIndirect');
  const seeIndirectRow = $('cbSeeIndirectRow'), attest = $<HTMLInputElement>('cbAttest');
  const refIn = $<HTMLInputElement>('cbRef');
```

Visibility + clear-on-switch (register alongside the existing `scope` change listener at ~1248):

```ts
  function syncVerifiedRows(): void {
    if (!tierSel || !verifiedRow) return;
    const on = tierSel.value === 'actual-verified';
    verifiedRow.hidden = !on;
    // Indirect follows BOTH gates: the sector publishes an indirect default (scope row
    // visible) AND the scope says to charge it — same rule as the defaults path.
    if (seeIndirectRow) seeIndirectRow.hidden = !on || scopeRow!.hidden || scope?.value !== 'direct_and_indirect';
    if (!on) {
      // Values must never leak into the next line: switching back clears the panel.
      if (seeDirect) seeDirect.value = '';
      if (seeIndirect) seeIndirect.value = '';
      if (attest) attest.checked = false;
      if (refIn) refIn.value = '';
    }
  }
  tierSel?.addEventListener('change', () => { syncVerifiedRows(); refresh(); });
```

Also call `syncVerifiedRows()` wherever `scopeRow.hidden` is recomputed (the good-change handler at ~804–810) and on `scope` change.

`draftLine()` (~880) gains, before constructing `l`:

```ts
    const v = parseVerifiedFields({
      tier: tierSel?.value ?? 'default+markup',
      direct: seeDirect?.value ?? '', indirect: (seeIndirectRow && !seeIndirectRow.hidden ? seeIndirect?.value : '') ?? '',
      attested: attest?.checked ?? false, ref: refIn?.value ?? '',
    });
    if ('error' in v) { reportAddFailure(v.error); return null; }
    // reportAddFailure = whatever helper existing Add refusals use to write #cbStatus —
    // grep '#cbStatus' / 'cbStatus' in this file and reuse THAT path (commit c515abf added
    // it: "report Add failures"). Do not invent a parallel announcement channel.
```

…and spreads `...v.ok` into the `Line` literal. `estimateLine(l)` (~855) and `run()`'s preview input (~831) both gain:

```ts
      ...(l.tier === 'actual-verified' && l.seeDirect
        ? { verified: { directTco2ePerT: l.seeDirect, ...(l.seeIndirect ? { indirectTco2ePerT: l.seeIndirect } : {}) } }
        : {}),
```

(for `run()`, build the draft via `draftLine()` when lines are empty rather than re-reading raw fields — it already mirrors that path; keep the two consistent).

- [x] **Step 6: Run everything**

```bash
node --test tests/unit/cbam-render.test.mjs 2>&1 | tail -3 && npm run test:unit && npx astro check 2>&1 | tail -3
```

- [x] **Step 7: Commit**

```bash
git add src/pages/cbam/cbam-calculator.astro src/scripts/cbam-algos/cbam-app.ts tests/unit/cbam-render.test.mjs
git commit -m "feat(cbam): the Emissions-data dropdown — verified figures enter the form

Native select between Route and Mass, per design review. The panel reveals
direct/indirect per-tonne fields, the attestation tick that gates Add, and
an optional reference. Switching back clears the panel — attested values
never leak into the next line."
```

### Task 6: Card — attested stamp + the delta

**Files:**
- Modify: `src/scripts/cbam-algos/cbam-app.ts` (`renderLineCard` ~434, `safeEstimates` ~898)
- Test: `tests/unit/cbam-render.test.mjs` (append)

- [x] **Step 1: Write the failing tests**

```js
/* ── the delta: what the verified choice is worth, both directions, never invented ── */

const verLine = { id: 'L1', cn: '72061000', country: 'IN', route: '(C)', scope: 'direct',
  massT: '100', date: '2026-03-15', tier: 'actual-verified', seeDirect: '2.31', verifiedRef: 'BV-1' };
const verEst = estimateFromPack(pack, { cn: '72061000', country: 'IN', route: '(C)',
  massT: '100', date: '2026-03-15', verified: { directTco2ePerT: '2.31' } });
const dfltEst = estimateFromPack(pack, { cn: '72061000', country: 'IN', route: '(C)',
  massT: '100', date: '2026-03-15' });

test('a verified line card names the attestation and the reference', () => {
  const html = renderLineCard(verLine, verEst, 0, dfltEst);
  assert.match(html, /as attested by the user/i);
  assert.match(html, /not confirmed by this tool/i);
  assert.ok(html.includes('BV-1'));
});

test('the delta shows savings — and the default figure it is measured against', () => {
  const html = renderLineCard(verLine, verEst, 0, dfltEst);
  assert.ok(html.includes('12,420.84'), 'the default side is named, not implied');
  assert.ok(html.includes('4,476.39'), 'the saving is the pinned worked-example figure');
  assert.match(html, /saves/);
});

test('the delta reverses honestly when the verified figure is WORSE', () => {
  const worse = estimateFromPack(pack, { cn: '72061000', country: 'IN', route: '(C)',
    massT: '100', date: '2026-03-15', verified: { directTco2ePerT: '9.99' } });
  const html = renderLineCard({ ...verLine, seeDirect: '9.99' }, worse, 0, dfltEst);
  assert.match(html, /adds/);
  assert.doesNotMatch(html, /saves/);
});

test('no default to compare against → the delta says so instead of inventing one', () => {
  const html = renderLineCard(verLine, verEst, 0, null);
  assert.match(html, /No Commission default/i);
  assert.doesNotMatch(html, /saves|adds/);
});

test('a default-tier line renders NO delta block at all', () => {
  const dl = { ...verLine, tier: 'default+markup', seeDirect: undefined, verifiedRef: undefined };
  const html = renderLineCard(dl, dfltEst, 0);
  assert.doesNotMatch(html, /Commission default would give/);
});
```

- [x] **Step 2: Run, expect failure** (renderLineCard takes 3 args; no delta markup)

- [x] **Step 3: Implement**

`renderLineCard` gains a 4th parameter and two blocks. Import `Decimal from 'decimal.js'` at the top of `cbam-app.ts` (the global rounding config from `sefa.ts` is already loaded via the engine import chain; a 2-dp money subtraction is exact regardless).

```ts
export function renderLineCard(
  line: Line, e: CertificateEstimate, index: number,
  /** The SAME line through the default path — the comparison the verified choice earns.
   *  null = no default published; undefined = default-tier line, no comparison owed. */
  comparison?: CertificateEstimate | null,
): string {
  const attested = line.tier === 'actual-verified'
    ? `<p class="cb-attested">Verified figures — as attested by the user, not confirmed by this
        tool.${line.verifiedRef ? ` Ref: ${esc(line.verifiedRef)}` : ''}</p>`
    : '';
  return `
    <article class="cb-line" data-line="${esc(line.id)}">
      <div class="cb-line-head">
        <span class="cb-line-n">Line ${index + 1}</span>
        <span class="cb-line-sum">${esc(line.cn)} · ${esc(line.country)} · ${esc(line.route)} · ${num(line.massT)} t · ${esc(line.date)}</span>
        <button type="button" class="cb-line-x" data-remove="${esc(line.id)}" aria-label="Remove line ${index + 1}">Remove</button>
      </div>
      ${attested}
      ${renderResult(e)}
      ${line.tier === 'actual-verified' ? renderDelta(e, comparison) : ''}
    </article>`;
}

/** Both directions, never cherry-picked; suppressed with a reason, never silently. */
function renderDelta(e: CertificateEstimate, comparison: CertificateEstimate | null | undefined): string {
  const mine = tableFigures(e).costEur;
  const theirs = comparison ? tableFigures(comparison).costEur : null;
  if (!comparison || theirs === null || mine === null) {
    return `<p class="cb-delta cb-delta-none">No Commission default is published for this
      good/origin — nothing to compare against.</p>`;
  }
  const diff = new Decimal(theirs).minus(mine);
  if (diff.isZero()) return `<p class="cb-delta">Commission default would give ${eur(theirs)} — identical.</p>`;
  return diff.gt(0)
    ? `<p class="cb-delta cb-delta-save">Commission default would give ${eur(theirs)} — your
        verified data <b>saves ${eur(diff.toFixed(2))}</b> <span class="cb-what-if">(both figures CSCF what-ifs, §4 applies)</span></p>`
    : `<p class="cb-delta cb-delta-add">Commission default would give ${eur(theirs)} — your
        verified data <b>adds ${eur(diff.neg().toFixed(2))}</b> <span class="cb-what-if">(both figures CSCF what-ifs, §4 applies)</span></p>`;
}
```

`safeEstimates` computes the comparison once per verified line (default path = same input, no `verified` block) and threads it to the `renderLineCard` call site (~981): a `cmp` field on the returned object, `null` when the default path returns `unavailable` or throws.

```ts
  function safeEstimates(ls: readonly Line[]) {
    return ls.map((l) => {
      try {
        const e = estimateLine(l);
        let cmp: CertificateEstimate | null = null;
        if (l.tier === 'actual-verified') {
          try {
            const d = estimateFromPack(pack!, {
              cn: l.cn, country: l.country, route: l.route,
              massT: l.massT, date: l.date, emissionsScope: l.scope,
            });
            cmp = d.status === 'unavailable' ? null : decorateSnapshot(d, snapshot);
          } catch { cmp = null; }
        }
        return { l, e, cmp, err: null as string | null };
      }
      catch (err) { return { l, e: null, cmp: null, err: (err as Error).message }; }
    });
  }
```

…and the call site becomes `renderLineCard(p.l, p.e, i, p.cmp)`.

- [x] **Step 4: Run** — `node --test tests/unit/cbam-render.test.mjs && npm run test:unit && npx astro check`. Add minimal `.cb-attested` / `.cb-delta*` styles to the page's existing `<style>` (muted mono, green save / amber add, matching the card idiom).

- [x] **Step 5: Commit**

```bash
git add src/scripts/cbam-algos/cbam-app.ts src/pages/cbam/cbam-calculator.astro tests/unit/cbam-render.test.mjs
git commit -m "feat(cbam): verified cards carry their attestation, and the delta both ways

The same line runs through the default path in parallel; the card names the
default figure and the difference, saves or adds, never cherry-picked. No
published default → the card says so instead of inventing a comparison."
```

### Task 7: Print document — §4 conditional caveat

**Files:**
- Modify: `src/scripts/cbam-algos/cbam-app.ts` (`buildPrintDocument` — line rows ~531, §4 list ~594)
- Test: `tests/unit/cbam-render.test.mjs` (the pinned-constant block at lines ~61–80, plus new tests)

- [x] **Step 1: Write the failing tests — pin BOTH states, hand-typed**

Add to the constants block (do NOT import these from cbam-app.ts — being a separate hand-typed copy is the whole defence, per that block's own doc):

```js
const CAVEAT_VERIFIED =
  '<li>Verified figures are the user\'s attested claim, from a verification this tool has not\n'
  + '        seen or confirmed. The optional reference is transcribed, not checked.</li>';
```

Tests:

```js
test('§4 gains the attestation caveat — ONLY when a verified line exists', () => {
  const withVer = buildPrintDocument({ lines: [verLine], results: [verEst], yearCards: [],
    totals: sumTotals([verEst]), packSnapshot: 'f'.repeat(64), rulePackages: ['p'], pack, generatedOn: '2026-08-13' });
  assert.ok(withVer.includes(CAVEAT_VERIFIED), 'caveat must appear, exactly as pinned');
  const dl = { ...verLine, tier: 'default+markup', seeDirect: undefined, verifiedRef: undefined };
  const without = buildPrintDocument({ lines: [dl], results: [dfltEst], yearCards: [],
    totals: sumTotals([dfltEst]), packSnapshot: 'f'.repeat(64), rulePackages: ['p'], pack, generatedOn: '2026-08-13' });
  assert.ok(!without.includes('attested claim'), 'no verified line, no caveat');
  // the four existing caveats survive in BOTH states — exact-pinned as ever
  for (const c of [CAVEAT_CSCF, CAVEAT_ARTICLE_9, CAVEAT_COMPLETENESS, CAVEAT_FINGERPRINT]) {
    assert.ok(withVer.includes(c) && without.includes(c));
  }
});

test('a verified line\'s print row is marked, with its reference', () => {
  const html = buildPrintDocument({ lines: [verLine], results: [verEst], yearCards: [],
    totals: sumTotals([verEst]), packSnapshot: 'f'.repeat(64), rulePackages: ['p'], pack, generatedOn: '2026-08-13' });
  assert.match(html, /verified \(attested\)/i);
  assert.ok(html.includes('BV-1'));
});
```

- [x] **Step 2: Run, expect failure**

- [x] **Step 3: Implement**

In the ordinary line row (~544), extend the CN cell:

```ts
      <td>${esc(l.cn)}${l.tier === 'actual-verified'
        ? ` <span class="cbp-tier">verified (attested)${l.verifiedRef ? ` · ${esc(l.verifiedRef)}` : ''}</span>` : ''}</td>
```

In the §4 list (~594), after the fingerprint `<li>` — conditional, matching the pinned constant byte-for-byte including its line breaks:

```ts
      ${lines.some((l) => l.tier === 'actual-verified')
        ? `<li>Verified figures are the user's attested claim, from a verification this tool has not
        seen or confirmed. The optional reference is transcribed, not checked.</li>` : ''}
```

- [x] **Step 4: Run** — the §4 test is byte-sensitive; if it fails on whitespace, fix the PRODUCTION string to match the pinned constant, never the reverse.

- [x] **Step 5: Commit**

```bash
git add src/scripts/cbam-algos/cbam-app.ts tests/unit/cbam-render.test.mjs
git commit -m "feat(cbam): the print document owns the attestation caveat, conditionally

Present when any line carries verified figures, absent otherwise — both
states exact-pinned as hand-typed constants, same commit as the prose, per
the paraphrase-attack rule the test file documents."
```

### Task 8: e2e + the engine reference

**Files:**
- Modify: `tests/e2e/cbam-lines.spec.ts` (append one scenario, reusing the file's existing helpers/selectors)
- Modify: `docs/cbam-engine-reference.md` (new subsection under the estimator section)

- [x] **Step 1: Write the e2e scenario** (follow the file's existing setup — same `page.goto`, same add-line helpers):

```ts
test('verified figures: enter, attest, add, export — and the panel clears on switch-back', async ({ page }) => {
  await page.goto('/cbam/cbam-calculator/');
  // pick the worked-example line
  await page.fill('#cbCn', '72061000');
  await page.selectOption('#cbCountry', 'IN');
  await page.selectOption('#cbRoute', '(C)');
  await page.selectOption('#cbTier', 'actual-verified');
  await expect(page.locator('#cbVerifiedRow')).toBeVisible();
  await page.fill('#cbSeeDirect', '2.31');
  // Add without the tick must refuse, naming the attestation
  await page.click('#cbAdd');
  await expect(page.locator('#cbStatus')).toContainText(/attest/i);
  await page.check('#cbAttest');
  await page.fill('#cbRef', 'BV-2026-0142');
  await page.click('#cbAdd');
  await expect(page.locator('.cb-line')).toHaveCount(1);
  await expect(page.locator('.cb-attested')).toContainText('as attested by the user');
  await expect(page.locator('.cb-delta-save')).toContainText('saves');
  // CSV carries the tier and the reference
  const dl = page.waitForEvent('download');
  await page.click('#cbCsv');
  const csv = await (await (await dl).createReadStream()).toArray().then(b => Buffer.concat(b).toString());
  expect(csv).toContain('actual-verified');
  expect(csv).toContain('BV-2026-0142');
  // switch back → the panel clears, nothing leaks into the next line
  await page.selectOption('#cbTier', 'default+markup');
  await page.selectOption('#cbTier', 'actual-verified');
  await expect(page.locator('#cbSeeDirect')).toHaveValue('');
  await expect(page.locator('#cbAttest')).not.toBeChecked();
});
```

- [x] **Step 2: Run** — `npx playwright test tests/e2e/cbam-lines.spec.ts` (Chromium installed per CI's order-of-operations fix). Adjust selectors ONLY to match the file's established helpers; the assertions stand.

- [x] **Step 3: Update `docs/cbam-engine-reference.md`** — add under the estimator section:

```markdown
### Verified emissions entry

Each line chooses its emissions source: the Commission default (marked up 10/20/30 %
by year) or the importer's own verified figures — direct and, where the sector charges
it, indirect, in tCO₂e per tonne of the WHOLE good, precursors included. Verified
figures skip the mark-up entirely: the mark-up prices not-having-data. They do not
change anything else — same Column B benchmark by declared route, same CSCF what-if,
same quarterly price, and a missing benchmark still refuses.

The figures are attested, not checked: Add is gated on an explicit attestation tick,
the optional verifier reference is transcribed into the CSV (`data_tier`,
`verified_reference`) and the printed document, and §4 says so whenever a verified
line is present. The card shows the same line through the default path — savings or
excess, both directions — whenever a default is published to compare against.
```

- [x] **Step 4: Full gates one last time**

```bash
npm run test:unit && node scripts/cbam-sync-check.mjs && npx astro check 2>&1 | tail -3 && npx playwright test tests/e2e/cbam-lines.spec.ts
```

- [x] **Step 5: Commit**

```bash
git add tests/e2e/cbam-lines.spec.ts docs/cbam-engine-reference.md
git commit -m "test(cbam): e2e for the verified flow; the reference learns the feature

Enter, refuse-without-attestation, attest, add, both exports, and the
switch-back clear. The engine reference now documents what verified entry
does and, as importantly, what it deliberately does not."
```

---

## Self-review checklist (ran at write time)

- Spec coverage: §1→Task 1, vendoring→Task 2, §2→Task 3, §5 CSV→Task 4, §3→Task 5, §4 card→Task 6, §5 print→Task 7, §7 e2e/docs→Task 8. Worked example pinned in Tasks 1, 2 and 6.
- The `verLine`/`verEst`/`dfltEst` fixtures defined in Task 6 are reused by Task 7's tests — Task 7 runs after Task 6 in the same file; if executed out of order, redefine them locally from the Task 6 block.
- Type names match throughout: `Line['tier']`, `parseVerifiedFields`, `renderLineCard(line, e, index, comparison?)`, `verified{ directTco2ePerT, indirectTco2ePerT? }`.
