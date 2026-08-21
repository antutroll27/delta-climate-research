# Production-Route Glossary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare letters in the production-route dropdown with readable names, and show the Commission's own wording and citation beside the chosen one.

**Architecture:** One new module holding eleven entries transcribed from IR (EU) 2025/2620's Annex, consumed by the existing `syncRoutes` when it builds the options and by a new detail line under the select. No engine change, no pack change, no new dependency.

**Tech Stack:** TypeScript, Astro, `node:test` + `tsx`, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-20-route-glossary-design.md`

---

## Repo, branch, baseline

| | |
|---|---|
| path | `/Volumes/VSTSAMPLES/Projects/angad-allroutes` |
| branch | `feat/route-glossary` (exists, off `main`; spec committed at `4ee25fe`) |
| baseline | `npm run build` clean · `npm run test:unit` **495 pass** · `npm run test:e2e` **120 pass** · `npx astro check` **0 errors, 6 hints** |

`npm run test:unit` needs `dist/`, so build first.

## Why this matters

Route choice is expensive: on `72061000`, `(C)` and `(E)` differ by **2.9×** the certificates — 64.42 against 187.37 on the same 100 t line. The form asks an importer to make that choice from a letter. The all-routes work made it worse by design, taking visible routes from 5 to 11.

## Facts measured before this plan — rely on them, but re-confirm rather than assume

1. **The eleven indicators match our corpus exactly.** The distinct `routeIndicator` set in the shipped pack is identical to the Annex point 5.3 list — no gaps, no extras. The glossary is provably complete.
2. **The letters are disjoint across sectors** — cement `(A)(B)`, iron & steel `(C)`–`(H)`,`(J)`, aluminium `(K)(L)`. A flat lookup is unambiguous; no sector keying needed.
3. **`'default'` is not one of the eleven, and always appears alone** — 580 of 580 lists containing it have length 1. It already renders as `single route`, and that label is correct precisely because it is never shown beside a lettered route. **The glossary must not touch it.**

## The eleven entries

From **IR (EU) 2025/2620, Annex, point 5.3**. Left column is the Commission's exact text; right is ours.

| | quote (verbatim) | label (ours) |
|---|---|---|
| `(A)` | grey clinker / cement | Grey cement clinker |
| `(B)` | white clinker / cement | White cement clinker |
| `(C)` | Carbon Steel based on BF/BOF | Carbon steel · blast furnace / basic oxygen furnace |
| `(D)` | Carbon Steel based on DRI/EAF | Carbon steel · direct reduced iron / electric arc furnace |
| `(E)` | Carbon Steel based on Scrap/EAF | Carbon steel · scrap / electric arc furnace |
| `(F)` | Low alloy Steel based on BF/BOF | Low-alloy steel · blast furnace / basic oxygen furnace |
| `(G)` | Low alloy Steel based on DRI/EAF | Low-alloy steel · direct reduced iron / electric arc furnace |
| `(H)` | Low alloy Steel based on scrap/EAF | Low-alloy steel · scrap / electric arc furnace |
| `(J)` | High alloy Steel (based on EAF) | High-alloy steel · electric arc furnace |
| `(K)` | primary Aluminium | Primary aluminium |
| `(L)` | secondary Aluminium | Secondary aluminium |

**The quotes are transcribed character for character, inconsistencies included** — "Carbon Steel" but "Low alloy Steel"; "Scrap/EAF" in `(E)` but "scrap/EAF" in `(H)`; "primary Aluminium". They are quotes, so they are copied exactly, not tidied.

**BF, DRI and EAF are expanded on the regulation's own authority** — recitals (15) and (16) give *"blast furnace, direct reduced iron (DRI) and electric arc furnace (EAF) routes"*. **BOF is expanded nowhere in the regulation**, so that expansion is ours and must never be attributed to the Commission.

## Standing constraints

1. **`src/scripts/cbam-algos/` is vendored** and hash-guarded by `scripts/cbam-sync-check.mjs`. **Only `cbam-app.ts` is hand-editable there.** The new module goes *outside* that directory. Run the check before finishing.
2. **Never judge a run by its trailing summary — check exit codes.** A Playwright run here printed "32 passed" while 75 of 107 failed.
3. **Mutation-verify, and grep the file to confirm the mutation landed first.** A substitution in this project twice silently failed to match and produced a green suite that looked like a passing mutation.
4. **Hand-type test expectations.** A test that imports the value it asserts on passes whatever that value becomes — this matters more than usual here, because the whole point is that the quotes match an external document.
5. Locate code by text, not line number.

---

## Task 1: the glossary module

**Files:**
- Create: `src/scripts/cbam-route-glossary.ts`
- Test: `tests/unit/route-glossary.test.mjs`

- [ ] **Step 1: Confirm the baseline**

```bash
cd /Volumes/VSTSAMPLES/Projects/angad-allroutes
npm run build >/dev/null 2>&1 && echo "BUILD: PASS" || echo "BUILD: FAIL"
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Expected 495 pass / 0 fail. If it differs, stop and report.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/route-glossary.test.mjs`, following the idiom of a neighbouring file in `tests/unit/` (`node:test` + `node:assert/strict`; read one first).

```js
// Every expectation here is HAND-TYPED from the regulation PDF, never imported from the module
// under test. That is the point of this file: it is the only thing standing between the shipped
// text and the Commission's, and a test that imports its expected value proves nothing.
const QUOTES = {
  '(A)': 'grey clinker / cement',
  '(B)': 'white clinker / cement',
  '(C)': 'Carbon Steel based on BF/BOF',
  '(D)': 'Carbon Steel based on DRI/EAF',
  '(E)': 'Carbon Steel based on Scrap/EAF',
  '(F)': 'Low alloy Steel based on BF/BOF',
  '(G)': 'Low alloy Steel based on DRI/EAF',
  '(H)': 'Low alloy Steel based on scrap/EAF',
  '(J)': 'High alloy Steel (based on EAF)',
  '(K)': 'primary Aluminium',
  '(L)': 'secondary Aluminium',
};

test('every quote matches IR (EU) 2025/2620 Annex 5.3 character for character', () => {
  // The Commission's capitalisation is inconsistent — "Carbon Steel" but "Low alloy Steel",
  // "Scrap/EAF" in (E) but "scrap/EAF" in (H). Copied exactly, because these are quotes.
  for (const [indicator, quote] of Object.entries(QUOTES)) {
    assert.equal(ROUTE_GLOSSARY[indicator].quote, quote);
  }
  assert.equal(Object.keys(ROUTE_GLOSSARY).length, 11);
});

test('the label is ours and is never the same string as the quote', () => {
  // The two layers must stay distinguishable. If a future edit collapses them, our plain-English
  // gloss would start being presented as the Commission's wording — which is the one thing this
  // design exists to avoid. BOF in particular is expanded nowhere in the regulation.
  for (const [indicator, entry] of Object.entries(ROUTE_GLOSSARY)) {
    assert.notEqual(entry.label, entry.quote, `${indicator}: label must not be the quote`);
    assert.ok(entry.label.length > 0);
  }
});

test('every entry cites its source', () => {
  for (const entry of Object.values(ROUTE_GLOSSARY)) {
    assert.match(entry.cite, /2025\/2620/);
  }
});

test('the glossary covers the shipped corpus exactly, both directions', () => {
  // Complete AND minimal. One direction alone would let the glossary drift from the pack:
  // a missing entry leaves a bare letter in the dropdown, a stray entry is dead text nobody
  // can reach. Measured before this plan: the two sets are identical.
  const inPack = [...new Set(pack.benchmarks.map((b) => b.routeIndicator).filter(Boolean))].sort();
  const inGlossary = Object.keys(ROUTE_GLOSSARY).sort();
  assert.deepEqual(inGlossary, inPack);
});

test("'default' is not in the glossary — it is not one of the eleven", () => {
  // routesFor can return 'default', which cbam-app renders as "single route". It is not an
  // Annex indicator, and measured across the corpus it is ALWAYS alone in its list (580 of 580),
  // which is exactly why that label is accurate. The glossary must not claim it.
  assert.equal(ROUTE_GLOSSARY['default'], undefined);
});
```

Add the imports the file needs at the top, matching the neighbouring test's style, and load the pack from `public/cbam/estimator-pack.json`.

- [ ] **Step 3: Run it and watch it fail**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)|route-glossary|ROUTE_GLOSSARY"
```
Expected: failure to import `ROUTE_GLOSSARY`. Record the actual message.

- [ ] **Step 4: Write the module**

Create `src/scripts/cbam-route-glossary.ts` — **outside `src/scripts/cbam-algos/`, which is vendored and sealed.**

```ts
/**
 * What each production-route indicator means, for the route dropdown.
 *
 * TWO LAYERS, DELIBERATELY SEPARATE. `quote` is the Commission's exact wording from IR (EU)
 * 2025/2620, Annex point 5.3, transcribed character for character — including its own
 * inconsistencies ("Carbon Steel" but "Low alloy Steel"; "Scrap/EAF" in (E) but "scrap/EAF" in
 * (H)). `label` is OURS: plain English, shown in the option, never presented as the regulation's
 * words. A test asserts the two are never the same string, because collapsing them would start
 * passing our gloss off as the Commission's.
 *
 * BF, DRI and EAF are expanded on the regulation's own authority — recitals (15) and (16) give
 * "blast furnace, direct reduced iron (DRI) and electric arc furnace (EAF) routes". BOF is
 * expanded NOWHERE in the regulation, so that expansion is ours. It is standard and not in
 * dispute, but it is not a quote and must not be cited as one.
 *
 * COMPLETE, AND MEASURED TO BE: the eleven indicators here are exactly the distinct
 * routeIndicator values in the shipped pack — no gaps, no extras. The letters are also disjoint
 * across sectors (cement A–B, iron & steel C–H and J, aluminium K–L), so this flat lookup is
 * unambiguous and needs no sector key.
 *
 * NOT HERE: 'default'. routesFor returns it for a good with a single unlettered route, and
 * cbam-app renders it "single route". It is not an Annex indicator, and it is always alone in
 * its list (measured: 580 of 580), which is what makes that label accurate.
 */
export interface RouteGloss {
  /** Ours. Plain English, shown in the option. Never the Commission's wording. */
  label: string;
  /** The Commission's exact words, verbatim. */
  quote: string;
  /** Where the quote comes from. */
  cite: string;
}

const CITE = 'IR (EU) 2025/2620, Annex point 5.3';

export const ROUTE_GLOSSARY: Record<string, RouteGloss> = {
  '(A)': { label: 'Grey cement clinker', quote: 'grey clinker / cement', cite: CITE },
  '(B)': { label: 'White cement clinker', quote: 'white clinker / cement', cite: CITE },
  '(C)': {
    label: 'Carbon steel · blast furnace / basic oxygen furnace',
    quote: 'Carbon Steel based on BF/BOF', cite: CITE,
  },
  '(D)': {
    label: 'Carbon steel · direct reduced iron / electric arc furnace',
    quote: 'Carbon Steel based on DRI/EAF', cite: CITE,
  },
  '(E)': {
    label: 'Carbon steel · scrap / electric arc furnace',
    quote: 'Carbon Steel based on Scrap/EAF', cite: CITE,
  },
  '(F)': {
    label: 'Low-alloy steel · blast furnace / basic oxygen furnace',
    quote: 'Low alloy Steel based on BF/BOF', cite: CITE,
  },
  '(G)': {
    label: 'Low-alloy steel · direct reduced iron / electric arc furnace',
    quote: 'Low alloy Steel based on DRI/EAF', cite: CITE,
  },
  '(H)': {
    label: 'Low-alloy steel · scrap / electric arc furnace',
    quote: 'Low alloy Steel based on scrap/EAF', cite: CITE,
  },
  '(J)': {
    label: 'High-alloy steel · electric arc furnace',
    quote: 'High alloy Steel (based on EAF)', cite: CITE,
  },
  '(K)': { label: 'Primary aluminium', quote: 'primary Aluminium', cite: CITE },
  '(L)': { label: 'Secondary aluminium', quote: 'secondary Aluminium', cite: CITE },
};
```

- [ ] **Step 5: Run and confirm green**

```bash
npm run build >/dev/null 2>&1 && npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"
npx astro check 2>&1 | tail -3
```
Expected 500 pass / 0 fail; `astro check` 0 errors (6 hints pre-existing — report what you see).

- [ ] **Step 6: Mutation-verify**

Three, each grep-confirmed before running (use Python with `assert count == 1`, verify with `diff`):
1. Change one quote's capitalisation (`scrap/EAF` → `Scrap/EAF` in `(H)`) → the verbatim test must redden. This is the one that matters: it proves the transcription is actually pinned.
2. Set a `label` equal to its `quote` → the two-layers test must redden.
3. Delete the `(J)` entry → the corpus-coverage test must redden.

Restore after each; confirm `git diff` is clean of stray edits.

- [ ] **Step 7: Commit**

```bash
git add src/scripts/cbam-route-glossary.ts tests/unit/route-glossary.test.mjs
git commit -m "feat(cbam): what each production-route indicator means"
```
Body: the source citation, and that the eleven match the corpus exactly.

---

## Task 2: render the label in the dropdown

**Files:**
- Modify: `src/scripts/cbam-algos/cbam-app.ts` (`syncRoutes`)

`cbam-app.ts` is the one hand-editable file under `cbam-algos/`.

- [ ] **Step 1: Find the option-building line**

In `syncRoutes`, locate by text:

```ts
    const opts = rs.map((r) => `<option value="${esc(r)}">${r === 'default' ? 'single route' : esc(r)}</option>`).join('');
```

**Read the whole function first.** It carries load-bearing comments about `lastRoutePick`, the `|| 2026` fallback, and `noRouteReason`. None of them change; do not touch them.

- [ ] **Step 2: Use the glossary for the option text**

Import `ROUTE_GLOSSARY` from `../cbam-route-glossary.ts` — **confirm the correct relative path from `cbam-app.ts`'s location** rather than copying this, and follow how the file imports its other non-vendored neighbour (`../cbam-lines.ts`).

```ts
    // The indicator ALONE asks an importer to pick their plant's technology from a letter, and
    // the choice is expensive: on 72061000, (C) and (E) differ by 2.9x the certificates — 64.42
    // against 187.37 on the same 100 t line. The letter stays in front, because it is what the
    // corpus, the CSV export and the refusal selectors all speak.
    //
    // 'default' keeps its own label and is NOT in the glossary: it is not an Annex indicator, and
    // it is always alone in its list (measured, 580 of 580), which is what makes "single route"
    // accurate. A letter with no glossary entry falls back to the bare indicator rather than a
    // placeholder — the eleven are measured to be exhaustive, so this should never fire.
    const opts = rs.map((r) => {
      const text = r === 'default' ? 'single route' : `${r} ${ROUTE_GLOSSARY[r]?.label ?? ''}`.trim();
      return `<option value="${esc(r)}">${esc(text)}</option>`;
    }).join('');
```

**Note the escaping**: the original escapes `r` directly; here the whole composed string is escaped once. Confirm `esc` is the same helper and that double-escaping does not occur.

- [ ] **Step 3: Verify by hand in a browser**

```bash
npm run build >/dev/null 2>&1 && npm run preview -- --host 127.0.0.1 --port 4399
```
Load `/cbam/cbam-calculator/`, enter `72061000` / India / 2026-03-15, and confirm the options read `(C) Carbon steel · blast furnace / basic oxygen furnace` and the two siblings. Then enter a good whose only route is `default` and confirm it still reads `single route`. Report what you observed for each; kill the server.

- [ ] **Step 4: Gates and commit**

```bash
npm run build >/dev/null 2>&1 && echo "BUILD: PASS" || echo "BUILD: FAIL"
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"
node scripts/cbam-sync-check.mjs >/dev/null 2>&1 && echo "SYNC_OK" || echo "SYNC_FAIL"
```
If an existing test asserts the old bare-letter option text, that is a **stale expectation** — update it deliberately and say so. Any other failure is a regression: stop and report.

```bash
git add src/scripts/cbam-algos/cbam-app.ts tests/
git commit -m "feat(cbam): the route dropdown names the route, not just its letter"
```

---

## Task 3: the detail line under the select

**Files:**
- Modify: `src/pages/cbam/cbam-calculator.astro` (markup + one style rule)
- Modify: `src/scripts/cbam-algos/cbam-app.ts` (a `syncRouteNote`, called from the same places as the other `sync*` helpers)

- [ ] **Step 1: Add the element**

In `cbam-calculator.astro`, the route field currently reads:

```html
          <div>
            <label class="cb-label" for="cbRoute">Production route</label>
            <!-- §6 — the select explains its own dependency. An empty disabled box
                 reads as broken; this reads as an instruction. -->
            <select id="cbRoute" class="cb-field cb-select" disabled>
              <option value="">Choose a good and origin first</option>
            </select>
          </div>
```

Add after the `</select>`, inside the same `div`:

```html
            <p class="cb-hint" id="cbRouteNote"></p>
```

`.cb-hint` already exists (`margin-top: 0.45rem`, `--color-ink-faint`, `max-width: 46ch`) and is the file's idiom for a quiet aside under a control — which is exactly what this is. **No new style rule unless you find `.cb-hint` genuinely unsuitable; if so, say why.** Add `.cb-hint:empty { display: none }` only if the empty element reserves visible space — check before adding it.

**Deliberately no `role="status"`.** `#cbDateNote` has one because it announces a fact the user could not otherwise learn. This restates the option they just selected, so announcing it would be noise for a screen-reader user who has already heard the option text.

- [ ] **Step 2: Render the quote and citation**

Add a helper beside the other `sync*` functions in `cbam-app.ts`:

```ts
  // The PROVENANCE half. The option carries our plain-English label; this carries the
  // Commission's exact wording and where it comes from, so anyone can check one against the
  // other. Keeping them visibly separate is the whole design: our gloss must never read as the
  // regulation's text. BOF, in particular, is expanded nowhere in IR (EU) 2025/2620.
  const syncRouteNote = () => {
    if (!routeNote) return;
    const g = ROUTE_GLOSSARY[route!.value];
    routeNote.textContent = g ? `Commission wording: “${g.quote}” · ${g.cite}` : '';
  };
```

**Confirm the real idiom before writing this**: how elements are captured (a top-level `const` in `initCbam` plus a null guard, as `syncScope` does with `scope`/`scopeRow`), and whether `route` is read as `route!.value`. Follow the file.

Call it wherever the other `sync*` helpers run — including the `route` `change` listener, which currently runs `syncScope(); syncVerifiedRows(); refresh();`. **The route note must update when the route changes**, which the `cn`/`country`/`date` path does not cover.

- [ ] **Step 3: Verify by hand**

Rebuild, preview, and confirm: selecting `(C)` shows `Commission wording: "Carbon Steel based on BF/BOF" · IR (EU) 2025/2620, Annex point 5.3`; switching to `(E)` updates it; a `single route` good shows nothing; and the quoted text visibly differs from the option's label. Report each.

- [ ] **Step 4: Gates and commit**

```bash
npm run build >/dev/null 2>&1 && echo "BUILD: PASS" || echo "BUILD: FAIL"
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"
npx astro check 2>&1 | tail -3
node scripts/cbam-sync-check.mjs >/dev/null 2>&1 && echo "SYNC_OK" || echo "SYNC_FAIL"
```

```bash
git add src/pages/cbam/cbam-calculator.astro src/scripts/cbam-algos/cbam-app.ts
git commit -m "feat(cbam): show the Commission's own wording beside the chosen route"
```

---

## Task 4: e2e, land, verify

- [ ] **Step 1: Add e2e pins**

Add to `tests/e2e/cbam-lines.spec.ts`, inside a `test.describe` you locate by name. **Verify the selector ids and the `change`-dispatch convention against neighbouring tests first** — `fill()` dispatches only `input`, and this file's helpers dispatch `change` explicitly for that reason.

```ts
test('the route options name the route, not just its letter', async ({ page }) => {
  // A letter alone asks an importer to pick their plant's technology blind, and the choice is
  // expensive: (C) vs (E) on this good is 2.9x the certificates.
  await page.goto('/cbam/cbam-calculator/');
  await page.fill('#cbCn', '72061000');
  await page.dispatchEvent('#cbCn', 'change');
  await page.fill('#cbDate', '2026-03-15');
  await expect(page.locator('#cbCountry option[value="IN"]')).toBeAttached();
  await page.selectOption('#cbCountry', 'IN');
  await expect(page.locator('#cbRoute option[value="(C)"]'))
    .toHaveText('(C) Carbon steel · blast furnace / basic oxygen furnace');
});

test("the Commission's own wording appears beside the chosen route, and differs from our label", async ({ page }) => {
  // The two layers must stay visibly separate: our plain-English gloss must never read as the
  // regulation's text. BOF is expanded nowhere in IR (EU) 2025/2620, so its expansion is ours.
  await page.goto('/cbam/cbam-calculator/');
  await page.fill('#cbCn', '72061000');
  await page.dispatchEvent('#cbCn', 'change');
  await page.fill('#cbDate', '2026-03-15');
  await expect(page.locator('#cbCountry option[value="IN"]')).toBeAttached();
  await page.selectOption('#cbCountry', 'IN');
  await page.selectOption('#cbRoute', '(C)');
  const note = page.locator('#cbRouteNote');
  await expect(note).toContainText('Carbon Steel based on BF/BOF');   // the Commission's exact words
  await expect(note).toContainText('2025/2620');
  await expect(note).not.toContainText('basic oxygen furnace');        // ours, and it stays ours
});
```

- [ ] **Step 2: Full gates**

```bash
npm run build >/dev/null 2>&1 && echo "BUILD: PASS" || echo "BUILD: FAIL"
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"
npm run test:e2e >/tmp/e2e.log 2>&1; echo "E2E_EXIT=$?"; grep -E "^\s+[0-9]+ (passed|failed)" /tmp/e2e.log | tail -2
npx astro check 2>&1 | tail -3
node scripts/cbam-sync-check.mjs >/dev/null 2>&1 && echo "SYNC_OK" || echo "SYNC_FAIL"
```
Expected **122 e2e passed, exit 0**. **Check the exit code, not the summary line.** If webkit is missing, `npx playwright install webkit` — a missing browser reads as ~27 failures and is not one.

- [ ] **Step 3: PR and CI**

```bash
git add tests/e2e/cbam-lines.spec.ts
git commit -m "test(cbam): pin the route label and that the quote stays separate"
git push -u origin feat/route-glossary
gh pr create --base main --head feat/route-glossary \
  --title "feat(cbam): name the production routes in the dropdown" \
  --body "<the source citation, that the eleven match the corpus exactly, and the two-layer rule>"
gh pr checks --watch
```
**Do not merge on a red CI without first establishing whether the failure pre-exists on `main`** — compare against `main`'s latest run for the same job.

- [ ] **Step 4: Verify the deploy**

Poll `https://deltaclimate.earth/cbam/cbam-calculator` with `Cache-Control: no-cache` and a delay between attempts. **Check for HTTP 200 before grepping** — a 404 greps as string-absent, which reads as a finding and is not one. Confirm the entry chunk's hash matches the local `dist/` build, then grep it for one of the new labels. Grep for **strings, not identifiers** — the minifier renames those.

---

## Self-review

**Spec coverage.** The eleven entries and their two layers → Task 1. The option label → Task 2. The quote, citation and detail line → Task 3. "A route with no entry renders bare" → Task 2's `?? ''` fallback, pinned by Task 1's `'default'` test. Testing section → Tasks 1 and 4.

**Not built, per the spec:** inferring which route the user's plant runs; showing each route's benchmark value beside it; anything about the `(1)`/`(2)` tranche indicators, which are not routes.

**Type consistency.** `RouteGloss` is `{ label, quote, cite }`, defined once in Task 1 and consumed in Tasks 2 and 3. `ROUTE_GLOSSARY` is keyed by the indicator string exactly as `routesFor` returns it (`'(C)'`, parentheses included). The element id `cbRouteNote` is written in Task 3's markup and read in Task 3's helper and Task 4's e2e — one spelling throughout.

**The one thing most likely to be got wrong**, flagged so it is not: the escaping in Task 2. The original escapes the raw indicator; the replacement composes a string and escapes it once. Double-escaping would render `·` as an entity in the option. Task 2 Step 3 checks it in a real browser rather than trusting the diff.
