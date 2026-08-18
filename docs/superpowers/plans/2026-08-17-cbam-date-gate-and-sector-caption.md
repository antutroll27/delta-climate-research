# The Date Gate and the Sector Caption — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the static calculator pricing a cleared date as year 0, and stop the SaaS threshold card captioning a four-sector total with one hardcoded sector.

**Architecture:** Two independent halves in two repos. The static half adds one field to two textually identical completeness gates, which makes year `0` unreachable rather than better-worded. The SaaS half selects a column the route already queries and passes it to the card, deleting one of three hand-written copies of the sector list.

**Tech Stack:** TypeScript, Astro, Playwright (website) · Vue 3, Hono, drizzle, Postgres, vitest, `@vue/test-utils` (SaaS).

**Spec:** `docs/superpowers/specs/2026-08-17-cbam-date-gate-and-sector-caption-design.md`

---

## Standing constraints — read before every task

1. **No figure may move.** Not on either side. If one does, stop and report it.
2. **Mutation-verify every fix.** Break it, confirm a **named** test fails, restore. Diff the restored file against a pristine copy — a green mutation run is exactly what a *failed* mutation looks like.
3. **Assert behaviour, not source text.** `src/views/vertical-slice-claims.test.ts:68-75` records why: its first version regex-matched raw `.vue` source, so a code comment satisfied it. *"A guard a comment can satisfy is not a guard."*
4. **`src/scripts/cbam-algos/` is vendored** byte-for-byte from `/Volumes/VSTSAMPLES/Projects/CBM/lib/`, hash-guarded by `scripts/cbam-sync-check.mjs`. **`cbam-app.ts` is the sole hand-editable exception** — Task 1 touches only that file. Never edit any other file under that directory in this plan.
5. **Report what you measure, not what this plan predicts.** Several claims in the spec were wrong when first written and were corrected by measurement. If you find one wrong, that finding is the valuable output.

## Repos and baselines

| | path | branch | test command | baseline |
|---|---|---|---|---|
| Website | `/private/tmp/cbam-gates` | `fix/cbam-date-gate` | `npm run test:unit` | 419 pass, 0 fail |
| Website e2e | same | same | `npm run test:e2e` | needs a one-time browser install (Task 1 Step 0) |
| SaaS | `/Volumes/VSTSAMPLES/Projects/CBM` | create `fix/threshold-caption` | `npm test` | 500 pass, 70 files |
| SaaS integration | same | same | `npm run test:db` | **cannot run locally — no Docker.** CI only |

## File structure

**Website (Task 1) — one file changed, one test file changed:**
- Modify: `src/scripts/cbam-algos/cbam-app.ts` — two gate conditions, one message string, one comment
- Test: `tests/e2e/cbam-lines.spec.ts` — the behavioural pin

**SaaS (Tasks 2–3) — server first, then client:**
- Modify: `api/routes/cases.ts` — select `included_sectors`, add it to the response
- Modify: `api/contracts.ts` — add `includedSectors` to `CaseDetailResponse.threshold`
- Test: `tests/integration/api/routes/cases.integration.test.ts` — asserts the emitted field
- Modify: `src/components/case/cards/ThresholdRulerCard.vue` — `includedSectors: string[]` replaces `sector: string`
- Modify: `src/views/CalculationsView.vue` — stop passing the hardcoded literal
- Create: `src/components/case/cards/ThresholdRulerCard.test.ts` — mounts and asserts the DOM

Server before client is deliberate: after Task 2 the extra field is simply unused, so the tree is green at every commit. Doing it the other way round would give the card a prop nothing sends.

---

## Task 1: The date gate (website)

**Why this works:** `run():1772` and `draftLine():1910` have textually identical completeness gates and **neither checks the date**. `syncRoutes():1651` falls back to 2026 on an empty field (`Number('')` is `0`, falsy), so routes are offered and `run()` proceeds with `date: ''` — the engine's year is `0`, and the line refuses on `cbam-factor/0`. Adding the date to both gates makes year `0` unreachable.

**Files:**
- Modify: `src/scripts/cbam-algos/cbam-app.ts:1772`, `:1773`, `:1910`, and a comment at `:1651`
- Test: `tests/e2e/cbam-lines.spec.ts`

- [ ] **Step 0: Install the Playwright browser (one-time)**

```bash
cd /private/tmp/cbam-gates
npx playwright install chromium
```

Expected: a download, then `chromium ... downloaded to ...`. CI does this too (`.github/workflows/verify.yml:56`). Without it every e2e run fails with "Executable doesn't exist".

- [ ] **Step 1: Confirm the defect before fixing it**

Add this to `tests/e2e/cbam-lines.spec.ts`, **inside the existing `test.describe('multi-line CBAM estimate — the Add guard and failure surfacing', ...)` block** which opens at `:368` and closes at `:425`. That block is already about exactly this — a guard refusing, and whether the refusal is visible. `setLine`, `GOOD_LINE` and `expect` are all module-scope and in scope there.

```ts
test('a cleared import date refuses both surfaces rather than pricing year 0', async ({ page }) => {
  // THE DEFECT: syncRoutes reads the year as `Number(date.value.slice(0, 4)) || 2026`. An empty
  // field gives Number('') === 0 — falsy — so it falls back to 2026 and offers routes, and
  // nextRoute auto-selects for a single-route good. run()'s gate never looks at the date, so
  // estimateFromPack got `date: ''`, the engine's year was 0, cbamFactors has no row for 0, and
  // the panel rendered the free-allocation-factor refusal over a line whose only problem was a
  // blank date.
  //
  // PINNED ON BOTH GATES. They are textually identical and must stay that way; pinning one
  // leaves the divergence half-open, which is the exact shape of the original bug. This is the
  // only place either can be reached — both are closures inside initCbam(), reachable only
  // through document.getElementById, so the unit suite cannot see them at all.
  await page.goto('/cbam/cbam-calculator/');
  await setLine(page, GOOD_LINE);
  await expect(page.locator('#cbOut')).toContainText('tCO');

  await page.fill('#cbDate', '');

  // run(): the PREVIEW path must go idle, and must not name a factor schedule.
  await expect(page.locator('#cbOut')).toContainText('import date');
  await expect(page.locator('#cbOut')).not.toContainText('free-allocation factor schedule');
  await expect(page.locator('#cbOut')).not.toContainText('tCO');

  // draftLine(): the ADD path must refuse too, and the two must agree.
  const before = await page.locator('.cb-line').count();
  await page.click('#cbAdd');
  await expect(page.locator('.cb-line')).toHaveCount(before);

  // ...and restoring a date brings both back, so the gate is not simply always-closed.
  await page.fill('#cbDate', '2026-03-15');
  await expect(page.locator('#cbOut')).toContainText('tCO');
  await page.click('#cbAdd');
  await expect(page.locator('.cb-line')).toHaveCount(before + 1);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run test:e2e
```

Expected: FAIL on `expect(page.locator('#cbOut')).toContainText('import date')` — the panel instead shows the `cbam-factor/0` refusal, whose text begins "The free-allocation factor schedule does not reach the year this import falls in". **Record that string in your report** — it is the sentence a real user reads today.

If it fails on a *different* assertion, stop and report: the defect is not the one this plan describes.

- [ ] **Step 3: Add the date to `run()`'s gate**

In `src/scripts/cbam-algos/cbam-app.ts`, replace lines 1772-1773:

```ts
    if (!pack || !cn!.value || !country!.value || !route!.value || !mass!.value) {
      out!.innerHTML = '<p class="cb-idle">Choose a good, origin, route and mass to see the provisional exposure.</p>';
```

with:

```ts
    if (!pack || !cn!.value || !country!.value || !route!.value || !mass!.value || !date!.value) {
      out!.innerHTML = '<p class="cb-idle">Choose a good, origin, route, mass and import date to see the provisional exposure.</p>';
```

- [ ] **Step 4: Add the date to `draftLine()`'s gate**

In the same file, replace line 1910:

```ts
    if (!pack || !cn!.value || !country!.value || !route!.value || !mass!.value) return null;
```

with:

```ts
    if (!pack || !cn!.value || !country!.value || !route!.value || !mass!.value || !date!.value) return null;
```

- [ ] **Step 5: Comment `syncRoutes`' fallback so nobody "fixes" the wrong half**

In the same file, replace line 1651:

```ts
    const year = Number(date!.value.slice(0, 4)) || 2026;
```

with:

```ts
    // `|| 2026` IS DELIBERATE AND STAYS. The route dropdown has to populate before a date is
    // chosen, and Number('') is 0 — falsy — so an empty field lands here. This fallback was
    // once blamed for pricing a cleared date as year 0, and it was the wrong half: the bug was
    // that run() and draftLine() then proceeded with `date: ''`, which the engine reads as year
    // 0 (no cbamFactors row, so a cbam-factor/0 refusal). Both gates now require the date, so
    // this year is only ever used to LIST routes, never to price. Do not "fix" it into a throw.
    const year = Number(date!.value.slice(0, 4)) || 2026;
```

- [ ] **Step 6: Run the e2e test and watch it pass**

```bash
npm run test:e2e
```

Expected: PASS, and every other spec in the file still green. If a *different* spec broke, report it — it means a test relied on the preview rendering with no date.

- [ ] **Step 7: Run the unit suite**

```bash
npm run test:unit
```

Expected: `419 pass, 0 fail`, and `vendored engine intact (11 files match UPSTREAM.json)`. The count must not move — this task adds no unit test, because neither gate is reachable without a DOM.

- [ ] **Step 8: Mutation-verify**

Revert only the `run()` gate (leave `draftLine`'s in place), re-run `npm run test:e2e`, and confirm the new test goes red on the `'import date'` assertion. Then revert only `draftLine`'s gate (restore `run()`'s) and confirm it goes red on the `.cb-line` count. **Both halves must be independently load-bearing.** Restore with `git checkout -- src/scripts/cbam-algos/cbam-app.ts` and confirm `git diff` is clean before continuing.

- [ ] **Step 9: Prove year 0 is unreachable, not merely better-worded**

This is the claim the spec makes, so it needs its own evidence. In a scratch file, drive the engine directly and confirm the refusal the fix targets can no longer be produced through a form-shaped call:

```js
// scratch: does any date the gates now admit still yield cbam-factor/0?
import { estimateFromPack } from './src/scripts/cbam-algos/estimator/estimate-from-pack.ts';
// A gate that requires date!.value means '' can never reach here. Confirm the ONLY input that
// produced cbam-factor/0 was the empty one, by calling with '' and with a real date:
for (const date of ['', '2026-03-15']) {
  const e = estimateFromPack(/* pack */, { cn: '25070080', originCountry: 'OTHER', route: 'default', massT: '10', date, emissionsScope: 'direct_and_indirect', verified: { directTco2ePerT: '1.5', attested: true } });
  console.log(JSON.stringify({ date, status: e.status, selector: e.selector }));
}
```

Expected: `date: ''` → `selector: 'cbam-factor/0'`; `date: '2026-03-15'` → priced. Report both lines. This shows the gate removed the *only* input that reached it, rather than the refusal having moved elsewhere. Delete the scratch file afterwards.

- [ ] **Step 10: Commit**

```bash
cd /private/tmp/cbam-gates
git add src/scripts/cbam-algos/cbam-app.ts tests/e2e/cbam-lines.spec.ts
git commit -m "fix(cbam): a cleared import date stops being priced as year 0"
```

Write the body yourself, and include: the exact refusal sentence a user read before the fix, the both-gates mutation result from Step 8, and the Step 9 evidence that year 0 is unreachable rather than relocated.

---

## Task 2: The server sends the sector list (SaaS)

**Why:** `api/routes/cases.ts:78-80` sums **all four** mass sectors into `knownEligibleMassT`, so the number is a cross-sector total. The authoritative list of which sectors that is lives in `threshold_rule_version.included_sectors` — in the row this route already queries and does not select.

**Files:**
- Modify: `api/routes/cases.ts:63` (the select) and `:234-239` (the response)
- Modify: `api/contracts.ts:65-70`
- Test: `tests/integration/api/routes/cases.integration.test.ts`

- [ ] **Step 0: Branch**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git checkout -b fix/threshold-caption
npm test 2>&1 | tail -3
```

Expected: `Tests  500 passed (500)`.

- [ ] **Step 1: Write the failing integration assertion**

In `tests/integration/api/routes/cases.integration.test.ts`, find the existing block that reads `body.threshold` (around `:209-219`) and extend its type and assertions:

```ts
      threshold: {
        calendarYear: number
        state: string
        includedSectors: string[]
      }
```

and after the existing `expect(body.threshold.calendarYear).toBe(2026)`:

```ts
    // THE CAPTION'S SUBJECT. knownEligibleMassT sums every mass sector (cases.ts filters on all
    // four), so the card that prints it must name all four — a single sector beside a
    // cross-sector total misdescribes the number, whichever sector it names.
    //
    // Asserted on the EMITTED body, not on the zod type: CaseDetailResponse is never .parse()d
    // (contracts.ts only infers a type from it), so a field the type promises and the route
    // omits is `undefined` at runtime with nothing complaining. Only a real response can show
    // the field is actually there.
    expect(body.threshold.includedSectors).toEqual(
      ['cement', 'aluminium', 'fertilisers', 'iron_and_steel'],
    )
```

- [ ] **Step 2: Confirm it fails — in CI, because it cannot run here**

```bash
npm run test:db
```

Expected **locally**: the command fails to reach Postgres. There is no Docker, podman, colima or psql on this machine, and `npm run db:test:up` needs `docker compose`. **This is expected and is not the test failing.**

Record the exact error you get. Then push the branch and read the CI run — `.github/workflows/ci.yml` provisions Postgres 18 and sets `TEST_DATABASE_URL`. CI is where this assertion goes red and later green.

**Do not report this step as locally verified.** The spec is explicit: the report must say CI verified it, not the author.

- [ ] **Step 3: Select the column**

In `api/routes/cases.ts`, replace lines 62-68:

```ts
      const thresholdRows = await tx.execute(sql`
        select id, threshold_t
        from threshold_rule_version
        where rule_package_id = ${line.packageId}
          and calendar_year = ${calendarYear}
        order by id
      `) as unknown as Array<{ id: string; threshold_t: string }>
```

with:

```ts
      // `included_sectors` is the authoritative list of the sectors this threshold covers —
      // NOT NULL, and pinned by threshold_mass_sectors_ck to exactly the four mass sectors.
      // Selected rather than hand-written because the filter below already hard-codes a second
      // copy of the same list (and aggregate.ts's unexported massSectors is a third); the row
      // was being read anyway, so reading the column costs nothing and removes one copy.
      const thresholdRows = await tx.execute(sql`
        select id, threshold_t, included_sectors
        from threshold_rule_version
        where rule_package_id = ${line.packageId}
          and calendar_year = ${calendarYear}
        order by id
      `) as unknown as Array<{ id: string; threshold_t: string; included_sectors: string[] }>
```

- [ ] **Step 4: Put it in the response**

In the same file, replace lines 234-239:

```ts
        threshold: {
          calendarYear,
          state: threshold.state,
          knownEligibleMassT: threshold.knownEligibleMassT,
          thresholdT: threshold.thresholdT,
        },
```

with:

```ts
        threshold: {
          calendarYear,
          state: threshold.state,
          knownEligibleMassT: threshold.knownEligibleMassT,
          thresholdT: threshold.thresholdT,
          // knownEligibleMassT is a CROSS-SECTOR total (see the filter above), so the card
          // rendering it has to name every sector it covers. Sent rather than derived on the
          // client: the client would have to re-implement the same list, and a second
          // derivation of one fact is how the two halves drift apart.
          includedSectors: thresholdRule.included_sectors,
        },
```

- [ ] **Step 5: Add it to the contract**

In `api/contracts.ts`, replace lines 65-70:

```ts
  threshold: z.object({
    calendarYear: z.number(),
    state: z.enum(['above_threshold', 'below_threshold', 'indeterminate']),
    knownEligibleMassT: z.string(),
    thresholdT: z.string(),
  }),
```

with:

```ts
  threshold: z.object({
    calendarYear: z.number(),
    state: z.enum(['above_threshold', 'below_threshold', 'indeterminate']),
    knownEligibleMassT: z.string(),
    thresholdT: z.string(),
    // The sectors knownEligibleMassT sums, straight off threshold_rule_version. NOTE: this
    // schema is never .parse()d — it only feeds `type CaseDetail` below — so it is a promise
    // the compiler keeps and nothing checks at runtime. The integration test on the emitted
    // body is what actually holds the route to it.
    includedSectors: z.array(z.string()),
  }),
```

- [ ] **Step 6: Typecheck and unit-test**

```bash
npm run typecheck && npm test 2>&1 | tail -3
```

Expected: typecheck clean, `500 passed`. The count must not move yet — the card change is Task 3.

- [ ] **Step 7: Commit**

```bash
git add api/routes/cases.ts api/contracts.ts tests/integration/api/routes/cases.integration.test.ts
git commit -m "feat(cbam): the case detail response carries the sectors its threshold covers"
```

In the body, state plainly that the integration assertion is **unverified locally** and name the reason (no Docker on this machine).

---

## Task 3: The card names every sector it covers (SaaS)

**Why:** `CalculationsView.vue:84` passes `sector="iron_and_steel"` hardcoded, and `ThresholdRulerCard.vue:14` renders it as `<code>{{ sector }}</code> is a CBAM sector in scope.` Every case reads that sentence, whatever its good — and even the *right* single sector would misdescribe a cross-sector total.

**Files:**
- Modify: `src/components/case/cards/ThresholdRulerCard.vue:14` and `:51-57`
- Modify: `src/views/CalculationsView.vue:79-85`
- Create: `src/components/case/cards/ThresholdRulerCard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/case/cards/ThresholdRulerCard.test.ts`:

```ts
// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ThresholdRulerCard from './ThresholdRulerCard.vue'

// ASSERTS THE RENDERED DOM, not the template source. vertical-slice-claims.test.ts reads this
// card's .vue source for forbidden claim patterns, which cannot see this defect at all: the
// template was always correct, it was the CALLER that passed a constant. Only mounting shows
// what a user reads.

const BASE = {
  state: 'below_threshold' as const,
  knownEligibleMassT: '30',
  thresholdT: '50',
  calendarYear: 2026,
}

describe('ThresholdRulerCard', () => {
  it('names every sector its number covers, not one of them', () => {
    // knownEligibleMassT is a cross-sector total (cases.ts sums all four mass sectors), so a
    // caption naming a single sector misdescribes the figure beside it — which is what shipped:
    // CalculationsView passed sector="iron_and_steel" as a literal, on every case.
    const w = mount(ThresholdRulerCard, {
      props: { ...BASE, includedSectors: ['cement', 'aluminium', 'fertilisers', 'iron_and_steel'] },
    })
    const text = w.text()
    for (const s of ['cement', 'aluminium', 'fertilisers', 'iron_and_steel']) {
      expect(text).toContain(s)
    }
  })

  it('follows the rule rather than a built-in list', () => {
    // The four sectors are pinned by a CHECK constraint today, but the card must not assume
    // them: eligibleLineCount's own doc anticipates a row that includes hydrogen. A card with
    // the list baked in would pass the test above and still be wrong the day the rule widens.
    const w = mount(ThresholdRulerCard, {
      props: { ...BASE, includedSectors: ['cement', 'hydrogen'] },
    })
    expect(w.text()).toContain('hydrogen')
    expect(w.text()).not.toContain('iron_and_steel')
  })

  it('renders the mass and threshold it was given, unchanged', () => {
    // The guard against a caption fix quietly reformatting the figures beside it.
    const w = mount(ThresholdRulerCard, {
      props: { ...BASE, includedSectors: ['cement'] },
    })
    expect(w.text()).toContain('30')
    expect(w.text()).toContain('50')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npx vitest run src/components/case/cards/ThresholdRulerCard.test.ts
```

Expected: FAIL — the component still declares `sector: string`, so `includedSectors` is not a prop and none of the sector names render.

- [ ] **Step 3: Change the prop**

In `src/components/case/cards/ThresholdRulerCard.vue`, replace lines 51-57:

```ts
const props = defineProps<{
  state: 'above_threshold' | 'below_threshold' | 'indeterminate'
  knownEligibleMassT: string
  thresholdT: string
  calendarYear: number
  sector: string
}>()
```

with:

```ts
const props = defineProps<{
  state: 'above_threshold' | 'below_threshold' | 'indeterminate'
  knownEligibleMassT: string
  thresholdT: string
  calendarYear: number
  /**
   * Every sector knownEligibleMassT sums — the rule's own `included_sectors`, passed straight
   * through from the case-detail response. A LIST, not one sector: the figure is a cross-sector
   * annual total, so naming any single sector beside it misdescribes it. This replaced a
   * `sector: string` that CalculationsView filled with the literal 'iron_and_steel', which every
   * case rendered regardless of its good.
   */
  includedSectors: string[]
}>()

// Raw keys, deliberately: no mechanical transform gets from key to prose (the static
// calculator's ordered table proves it wrong on two of four — 'iron_and_steel' is said
// "iron & steel", 'fertilisers' is said "fertiliser"). They render inside <code>, where a raw
// key reads as a datum rather than as copy nobody wrote. Porting the prose table across the
// repo boundary is a separate change.
const sectorList = computed(() => props.includedSectors.join(', '))
```

- [ ] **Step 4: Change the template**

In the same file, replace line 14:

```html
          <code class="text-muted">{{ sector }}</code> is a CBAM sector in scope.
```

with:

```html
          <code class="text-muted">{{ sectorList }}</code>
          {{ includedSectors.length === 1 ? 'is the CBAM sector' : 'are the CBAM sectors' }} this total covers.
```

- [ ] **Step 5: Run the component test and watch it pass**

```bash
npx vitest run src/components/case/cards/ThresholdRulerCard.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Stop passing the literal**

In `src/views/CalculationsView.vue`, replace lines 79-85:

```html
          <ThresholdRulerCard
            :state="store.detail.threshold.state"
            :known-eligible-mass-t="store.detail.threshold.knownEligibleMassT"
            :threshold-t="store.detail.threshold.thresholdT"
            :calendar-year="store.detail.threshold.calendarYear"
            sector="iron_and_steel"
          />
```

with:

```html
          <ThresholdRulerCard
            :state="store.detail.threshold.state"
            :known-eligible-mass-t="store.detail.threshold.knownEligibleMassT"
            :threshold-t="store.detail.threshold.thresholdT"
            :calendar-year="store.detail.threshold.calendarYear"
            :included-sectors="store.detail.threshold.includedSectors"
          />
```

- [ ] **Step 7: Typecheck and run the full unit suite**

```bash
npm run typecheck && npm test 2>&1 | tail -3
```

Expected: typecheck clean; `503 passed` (500 + the 3 new). If typecheck fails on `store.detail.threshold.includedSectors`, the store's type comes from `CaseDetail` in `api/contracts.ts` — confirm Task 2 Step 5 landed.

- [ ] **Step 8: Mutation-verify**

Change the template back to `{{ includedSectors[0] }}`, re-run `npx vitest run src/components/case/cards/ThresholdRulerCard.test.ts`, and confirm the first two tests go red. Restore, and confirm `git diff` shows only the intended change.

- [ ] **Step 9: Commit**

```bash
git add src/components/case/cards/ThresholdRulerCard.vue src/components/case/cards/ThresholdRulerCard.test.ts src/views/CalculationsView.vue
git commit -m "fix(cbam): the threshold card names every sector its total covers"
```

---

## Task 4: Measure

**Files:** none. Change no source file; commit nothing.

- [ ] **Step 1: Website — `origin/main` → HEAD as one hop**

Build the pre-branch tree with `git archive origin/main | tar -x -C <scratch>` (symlink `node_modules` into it). Sweep a broad selector set through `estimateFromPack` — all three tiers, both scopes, priced and refused, several quarters — and diff **whole serialised result objects**, every key at every depth.

**Expected: zero differing.** Task 1 changed only a DOM gate and one message string; no engine input changed. **If anything differs, that is the headline — stop and report it.**

- [ ] **Step 2: Prove the harness can see a change**

A "0 differing" result from a broken differ is byte-identical to a genuine null result, and this project has been bitten by exactly that. Before trusting Step 1's zero, perturb a value in the scratch baseline and confirm your differ reports it. **Report this proof.** An unproven null result will not be accepted.

- [ ] **Step 3: SaaS — confirm no figure moved**

`knownEligibleMassT`, `thresholdT` and `state` must be byte-identical before and after. Tasks 2–3 add a field and change a caption; they touch no arithmetic. Mount `ThresholdRulerCard` with the four-sector list before and after and compare the rendered figures.

- [ ] **Step 4: State the corpus**

A count is a property of your corpus, not of the change. Say exactly what you swept — how many selectors, which years, which tiers — and separate the **structural claim** ("no figure moved") from any corpus-dependent count.

- [ ] **Step 5: Clean up** — remove scratch dirs; confirm both repos clean and on the right branches.

---

## Task 5: Land it

- [ ] **Step 1: Website**

```bash
cd /private/tmp/cbam-gates
npm run test:unit && npm run test:e2e
git fetch origin --quiet && git merge origin/main --no-edit
git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
```

- [ ] **Step 2: Verify the website deploy**

Poll `https://deltaclimate.earth/cbam/cbam-calculator` with `Cache-Control: no-cache` **and a delay between attempts** — a tight loop re-reads one cached build. Note the route: `/cbam-calculator` is a redirect stub, and `curl` needs `-L` or the real path. Confirm HTTP 200, a bundle hash different from `CA1UhT56`, and grep the bundle for the string `mass and import date`. Grep for **strings, not identifiers** — the minifier renames names.

- [ ] **Step 3: SaaS — push and let CI verify**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
npm test && npm run typecheck
git push -u origin fix/threshold-caption
```

Then **watch the CI run** and confirm `test:db` passes with the new `includedSectors` assertion. Do not merge until it is green. This is the only verification of Task 2 that exists — say so in the report.

- [ ] **Step 4: Clean up**

```bash
rm /private/tmp/cbam-gates/node_modules          # the SYMLINK only
cd /Volumes/VSTSAMPLES/Projects/Angad
git worktree remove /private/tmp/cbam-gates
git worktree prune
git branch -D fix/cbam-date-gate 2>/dev/null
```

Leave `fix/threshold-caption` in CBM until its CI is green and it is merged.

---

## Self-review

**Spec coverage.** §1 (the date gate) → Task 1, both gates plus the `syncRoutes` comment the spec asks for, plus Step 9's "unreachable, not relocated" evidence. §2 (the caption) → Tasks 2–3, all three changes. The spec's "keep `draftLine:1956`" instruction is honoured by omission — no step touches it; **Task 1's implementer must not delete it** even though the shared gate now makes it unreachable from the form. It guards `draftLine` against a caller that is not the form.

**Deliberately out of scope, per the spec:** `aggregate.ts`'s unexported `massSectors`, routing `cases.ts` through `aggregateThresholdBasis`, the `net_mass_t` NaN/Infinity constraint, and sector prose on the SaaS side.

**Type consistency.** `includedSectors: string[]` is used identically in `contracts.ts` (Task 2 Step 5), the route response (Step 4), the component prop (Task 3 Step 3), and the template binding `:included-sectors` (Step 6) — Vue's kebab-case attribute for the camelCase prop. The integration test asserts the same four values the CHECK constraint pins.

**Known gap, stated rather than hidden.** Task 2 cannot be verified on this machine. Its correctness rests on CI. Any report claiming otherwise is wrong.
