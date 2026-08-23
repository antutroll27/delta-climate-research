# Production-Route Glossary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare letters in the production-route dropdown with readable names, and show the Commission's own wording and citation beside the chosen one.

**Architecture:** One new module holding eleven entries transcribed from IR (EU) 2025/2620's Annex, consumed by the existing `syncRoutes` when it builds the options and by a new detail line under the select. No engine change, no pack change, no new dependency.

**Tech Stack:** TypeScript, Astro, `node:test` + `tsx`, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-20-route-glossary-design.md`

**Revised after a pre-execution audit.** Twelve findings were corrected in this text before any code was written; the ones that would have cost real time are called out where they land.

---

## Repo, branch, baseline

| | |
|---|---|
| path | `/Volumes/VSTSAMPLES/Projects/angad-allroutes` |
| branch | `feat/route-glossary` (exists, off `main`; spec at `4ee25fe`) |
| baseline | `npm run build` exit 0 · `npm run test:unit` exit 0, **495 pass** · `npx astro check` exit 0, **0 errors, 6 hints** |

**PREREQUISITE — no Playwright browser is installed in this checkout.** All three engines are missing, not just webkit; `~/Library/Caches/ms-playwright` does not exist. Before Task 4:

```bash
npx playwright install
```

The 120-pass e2e baseline is arithmetic, not observed here: 59 declared tests × the `chromium` project, plus 31 in `cbam-lines.spec.ts` × each of `firefox-cbam` and `webkit-cbam`, = 121 runs, minus one runtime skip in `heat-map-sim-backend`. Re-establish it by running the suite once after installing.

`npm run test:unit` needs `dist/`, so build first.

## Why this matters

Route choice is expensive: on `72061000`, verified at 1.9 tCO₂e/t, `(C)` and `(E)` differ by **2.9×** the certificates — 64.42 against 187.3675 on the same 100 t line. The form asks an importer to make that choice from a letter. The all-routes work made it sharper by design, taking visible routes from 5 to 11.

**That ratio is tier-conditional and the plan says so wherever it ships.** On the defaults tier — the one most users are on — `(D)` and `(E)` return `unavailable` for `72061000`/IN, so that user cannot see the difference at all; only `(C)` prices. The 2.9× is real on the verified tier and must be quoted with its tier.

## Facts measured before this plan — rely on them, but re-confirm rather than assume

1. **The eleven indicators match our corpus exactly.** The distinct `routeIndicator` set in `pack.benchmarks`, after `.filter(Boolean)` drops the route-independent `''` rows, is exactly the Annex point 5.3 list — no gaps, no extras. The glossary is provably complete.
2. **The letters are disjoint across sectors** — by `scopeCode` chapter, `(A)(B)` appear only under 25, `(C)`–`(H)`,`(J)` only under 72/73, `(K)(L)` only under 76. A flat lookup is unambiguous; no sector keying needed.
3. **`'default'` is not one of the eleven, and never appears beside a lettered route.** Full sweep of `routesFor` over 572 goods × 122 origins × the three covered years — 209,352 non-empty lists, of which **53,070 contain `'default'` and all 53,070 have length 1**. It already renders as `single route`, and that label is correct *precisely because* it is never shown next to a letter. **The glossary must not touch it.**

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

**The quotes are transcribed character for character, inconsistencies included** — "Carbon Steel" but "Low alloy Steel"; "Scrap/EAF" in `(E)` but "scrap/EAF" in `(H)`; "primary Aluminium". They are quotes, so they are copied exactly, not tidied. There is no `(I)`.

**BF, DRI and EAF are expanded on the regulation's own authority** — recitals (15) and (16) give *"blast furnace, direct reduced iron (DRI) and electric arc furnace (EAF) routes"*. **BOF is expanded nowhere in the regulation**, so that expansion is ours and must never be attributed to the Commission.

## Standing constraints

1. **`src/scripts/cbam-algos/` is vendored** and hash-guarded by `scripts/cbam-sync-check.mjs`. **Only `cbam-app.ts` is hand-editable there.** The new module goes *outside* that directory, where the check does not reach.
2. **Never judge a run by its trailing summary — capture the exit code.** Use `cmd > /tmp/x.log 2>&1; echo "EXIT=$?"; grep … /tmp/x.log`. Piping straight into `grep` hides the worst case: `test:unit` is `sync-check && node --test`, so if the sync check fails the test runner never starts, **no `ℹ` line is printed at all**, and a bare grep emits nothing — indistinguishable from output that scrolled past.
3. **Mutation-verify, and grep the file to confirm the mutation landed first.** A substitution in this project twice silently failed to match and produced a green suite that looked like a passing mutation.
4. **Hand-type test expectations.** A test that imports the value it asserts on passes whatever that value becomes — which matters more than usual here, since the point is that the quotes match an external document.
5. Locate code by text, not line number.

---

## Task 1: the glossary module

**Files:**
- Create: `src/scripts/cbam-route-glossary.ts`
- Test: `tests/unit/route-glossary.test.mjs`

- [ ] **Step 1: Confirm the baseline**

```bash
cd /Volumes/VSTSAMPLES/Projects/angad-allroutes
npm run build > /tmp/b.log 2>&1; echo "BUILD_EXIT=$?"
npm run test:unit > /tmp/u.log 2>&1; echo "UNIT_EXIT=$?"; grep -E "^ℹ (tests|pass|fail)" /tmp/u.log
```
Expected both exit 0, 495 pass / 0 fail. If it differs, stop and report.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/route-glossary.test.mjs`. **The runner handles TypeScript**: `test:unit` runs `node --import tsx --test tests/unit/*.test.mjs`, and `tests/unit/cbam-lines.test.mjs` already imports `../../src/scripts/cbam-lines.ts` — the exact directory and pattern this needs. Follow that file's idiom (`node:test` + `node:assert/strict`).

```js
// Every expectation here is HAND-TYPED from the regulation, never imported from the module under
// test. That is the point of this file: it is the only thing standing between the shipped text and
// the Commission's, and a test that imports its expected value proves nothing.
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
  // gloss would start being presented as the Commission's wording — the one thing this design
  // exists to avoid. BOF in particular is expanded nowhere in the regulation.
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
  // Complete AND minimal. One direction alone would let the glossary drift from the pack: a
  // missing entry leaves a bare letter in the dropdown, a stray entry is dead text nobody can
  // reach. This is also what makes the render-time fallback unreachable — see the module docblock.
  const inPack = [...new Set(pack.benchmarks.map((b) => b.routeIndicator).filter(Boolean))].sort();
  const inGlossary = Object.keys(ROUTE_GLOSSARY).sort();
  assert.deepEqual(inGlossary, inPack);
});

test("'default' is not in the glossary — it is not one of the eleven", () => {
  // routesFor can return 'default', which cbam-app renders as "single route". It is not an Annex
  // indicator, and measured across the corpus it is ALWAYS alone in its list (53,070 of 53,070
  // over goods x origins x covered years), which is exactly why that label is accurate. The
  // glossary must not claim it.
  assert.equal(ROUTE_GLOSSARY['default'], undefined);
});
```

Add the imports at the top matching the neighbouring test's style, loading the pack from `public/cbam/estimator-pack.json`.

- [ ] **Step 3: Run it and watch it fail**

```bash
npm run test:unit > /tmp/u.log 2>&1; echo "UNIT_EXIT=$?"; grep -E "^ℹ (pass|fail)|ROUTE_GLOSSARY" /tmp/u.log
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
 * across sectors (cement A–B under chapter 25, iron & steel C–H and J under 72/73, aluminium K–L
 * under 76), so this flat lookup is unambiguous and needs no sector key.
 *
 * NOT HERE: 'default'. routesFor returns it for a good with a single unlettered route, and
 * cbam-app renders it "single route". It is not an Annex indicator, and it is always alone in its
 * list — measured 53,070 of 53,070 over 572 goods x 122 origins x the three covered years — which
 * is what makes that label accurate.
 *
 * ONE LOCATOR, THREE SPELLINGS IN THIS REPO. The pack's own source record for this document reads
 * "Arts 1-3, Annex §5.3", and every benchmark row's sourceLocator reads "IR (EU) 2025/2620 Annex,
 * Column B route (A) (via EC benchmarks workbook v1…)". The regulation itself numbers this "point
 * 5.3", which is what CITE uses. Noted so the difference reads as three renderings of one source
 * rather than as three sources.
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
npm run build > /tmp/b.log 2>&1; echo "BUILD_EXIT=$?"
npm run test:unit > /tmp/u.log 2>&1; echo "UNIT_EXIT=$?"; grep -E "^ℹ (tests|pass|fail)" /tmp/u.log
npx astro check > /tmp/a.log 2>&1; echo "ASTRO_EXIT=$?"; tail -3 /tmp/a.log
```
Expected 500 pass / 0 fail; `astro check` 0 errors (6 hints pre-existing — report what you see).

- [ ] **Step 6: Mutation-verify**

Three, each grep-confirmed before running (Python with `assert count == 1`, verified by `diff`):
1. Change one quote's capitalisation — `scrap/EAF` → `Scrap/EAF` in `(H)` → the verbatim test must redden. **This is the one that matters**: it proves the transcription is genuinely pinned rather than merely present.
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
- Modify: `docs/cbam-calculator-portability.md`

- [ ] **Step 1: Find the option-building line**

In `syncRoutes`, locate by text — it occurs exactly once:

```ts
    const opts = rs.map((r) => `<option value="${esc(r)}">${r === 'default' ? 'single route' : esc(r)}</option>`).join('');
```

**Read the whole function first.** It carries load-bearing comments about `lastRoutePick`, the `|| 2026` fallback, and `noRouteReason`. None of them change; do not touch them.

- [ ] **Step 2: Use the glossary for the option text**

Import `ROUTE_GLOSSARY` from `'../cbam-route-glossary.ts'` — the same shape `cbam-app.ts` already uses for its other non-vendored neighbour, `'../cbam-lines.ts'` (extension included; `allowImportingTsExtensions` is on).

```ts
    // The indicator ALONE asks an importer to pick their plant's technology from a letter, and
    // the choice is expensive: on 72061000, verified at 1.9 tCO2e/t, (C) and (E) differ by 2.9x
    // the certificates — 64.42 against 187.3675 on the same 100 t line. (On the DEFAULTS tier
    // that user sees no difference at all, because (D) and (E) are unavailable for that pairing
    // and only (C) prices — so the ratio is quoted with its tier, not as a bare fact.)
    //
    // The letter stays in front, because it is what the corpus, the CSV export and the refusal
    // selectors all speak. 'default' keeps its own label and is NOT in the glossary: it is not an
    // Annex indicator, and it is always alone in its list (measured 53,070 of 53,070), which is
    // what makes "single route" accurate.
    const opts = rs.map((r) => {
      const text = r === 'default' ? 'single route' : `${r} ${ROUTE_GLOSSARY[r]?.label ?? ''}`.trim();
      return `<option value="${esc(r)}">${esc(text)}</option>`;
    }).join('');
```

**The `?? ''` fallback is unreachable, and that is recorded rather than dressed up.** Task 1's corpus test asserts the glossary and the pack hold identical indicator sets, so a letter with no entry cannot ship; `'default'` is special-cased before the lookup. It is kept as cheap defence against rendering `undefined` in a dropdown if that test is ever weakened — not because anything exercises it. Do **not** claim it is pinned.

**Escaping needs no browser check** — the audit settled it. `esc` replaces `[&<>"']`; none of the eleven labels, none of the indicators, and not `'single route'` contains any of those, so `esc` is the identity on every composed string here and idempotent besides. `·` is U+00B7, outside the class, and renders literally.

- [ ] **Step 3: Update the portability dossier**

`docs/cbam-calculator-portability.md` carries a reference implementation whose route option reads:

```
{{ r === 'default' ? 'single route' : r }}
```

Update it to match the shipped behaviour. This is not tidiness: `tests/unit/build-contracts.test.mjs` exists *because* this dossier drifted before, and its own comment says a stale snippet "does not merely say the wrong thing on a screen, it TEACHES a gate the shipped one no longer has." Nothing goes red if you skip it — that contract pins only the `cb-idle` prompt and the `estimate` gate — which is exactly why it has to be done deliberately.

- [ ] **Step 4: Verify by hand in a browser**

```bash
npm run build > /tmp/b.log 2>&1; echo "BUILD_EXIT=$?"
npm run preview -- --host 127.0.0.1 --port 4399
```
Load `/cbam/cbam-calculator/` and confirm, reporting each observation:
- `72061000` / India / `2026-03-15` → options read `(C) Carbon steel · blast furnace / basic oxygen furnace`, plus `(D)` and `(E)`.
- `25232900` (Grey Portland cement) / India → still reads `single route`.
- The `·` renders as a middot, not an entity.

Kill the server afterwards.

- [ ] **Step 5: Gates and commit**

```bash
npm run test:unit > /tmp/u.log 2>&1; echo "UNIT_EXIT=$?"; grep -E "^ℹ (tests|pass|fail)" /tmp/u.log
node scripts/cbam-sync-check.mjs > /dev/null 2>&1; echo "SYNC_EXIT=$?"
```
**No existing test asserts the old bare-letter option text** — the audit checked every route assertion in the e2e suite; they use `option[value="…"]` with `toBeAttached`/`toHaveCount`, `toHaveValue`, or select-level placeholder text. Nor does app code read option text anywhere: `route.value` is the only read, so the CSV export, refusal selectors and line records are untouched. **If something does fail, it is a regression, not a stale expectation — stop and report.**

```bash
git add src/scripts/cbam-algos/cbam-app.ts docs/cbam-calculator-portability.md
git commit -m "feat(cbam): the route dropdown names the route, not just its letter"
```

---

## Task 3: the detail line under the select

**Files:**
- Modify: `src/pages/cbam/cbam-calculator.astro` (markup + one style rule)
- Modify: `src/scripts/cbam-algos/cbam-app.ts` (a `syncRouteNote`)

- [ ] **Step 1: Add the element and the `:empty` rule**

In `cbam-calculator.astro`, add after the route `</select>`, inside the same `div`:

```html
            <p class="cb-hint" id="cbRouteNote"></p>
```

**And add the `:empty` rule — it is mandatory, not conditional.** Measured in a real browser against the built page: an empty `<p class="cb-hint">` adds **7.19 px** to the field's height (its 0.45 rem `margin-top`, which cannot self-collapse because `.cb-form` is `display:flex` and the field `div` is a flex item). Without the rule the route field carries permanent dead space and shifts 7 px the first time a route is picked.

```css
  .cb-hint:empty { display: none; }
```

`.cb-hint` is the right class: `--color-ink-faint`, `max-width: 46ch`, the file's idiom for a quiet aside under a control. **Not `.cb-datenote`**, which is `--color-bronze` — a warning colour, wrong for a neutral citation.

**Deliberately no `role="status"`.** `#cbDateNote` has one because it announces a fact the user could not otherwise learn. This restates the option they just selected, so announcing it would be noise for a screen-reader user who has already heard the option text.

- [ ] **Step 2: Render the quote and citation**

Add beside the other `sync*` helpers in `cbam-app.ts`:

```ts
  // The PROVENANCE half. The option carries our plain-English label; this carries the Commission's
  // exact wording and where it comes from, so anyone can check one against the other. Keeping them
  // visibly separate is the whole design: our gloss must never read as the regulation's text. BOF,
  // in particular, is expanded nowhere in IR (EU) 2025/2620.
  const syncRouteNote = () => {
    if (!routeNote) return;
    const g = ROUTE_GLOSSARY[route!.value];
    routeNote.textContent = g ? `Commission wording: “${g.quote}” · ${g.cite}` : '';
  };
```

**Confirm the real idiom before writing this**: elements are captured as a top-level `const` in `initCbam` with a null guard inside the helper — the shape `syncScope` uses for `scope`/`scopeRow`. Capture `routeNote` beside the `route` capture.

- [ ] **Step 3: Wire it in — ORDER MATTERS**

Call `syncRouteNote()` in two places:

1. **In `onPick`, immediately AFTER `syncRoutes()`.** This ordering is load-bearing. `syncRoutes` writes `route!.value` itself when `nextRoute` auto-selects a good's only route, and a programmatic assignment fires **no `change` event** — so for a single-route good, `onPick` is the note's only chance to render, and only if it runs after the value is set. `onPick` is currently `syncRoutes(); syncScope(); syncVerifiedRows(); syncDateNote(); refresh();`. The file already documents an ordering constraint of this kind for `syncVerifiedRows` after `syncScope`; follow that precedent and say why in a comment.
2. **In the `route` `change` listener**, currently `syncScope(); syncVerifiedRows(); refresh();`. `syncRoutes` is *not* on this listener, so nothing else updates the note when the user picks a different route.

- [ ] **Step 4: Verify by hand, with the witness goods the ordering bug would break**

Rebuild, preview, and confirm each — these goods were chosen because they separate the two wiring paths:

- **`73181535`** / India — routes `['(C)']`, **auto-selected with no `change` event**. The note must show `(C)`'s quote on first pick. If it is blank, or shows the *previous* good's quote, `syncRouteNote` is running before `syncRoutes`.
- **`2523100090`** / DZ — routes `(A)`,`(B)`. Selecting each must update the note.
- **`76011010`** / MZ — routes `(K)`,`(L)`. Same, in a different sector.
- **`25232900`** / India — route `default`. The note must be **empty and invisible** (no reserved space).
- The quoted text must visibly differ from the option's label — e.g. option `(C) Carbon steel · blast furnace / basic oxygen furnace`, note `Commission wording: "Carbon Steel based on BF/BOF" · IR (EU) 2025/2620, Annex point 5.3`.

- [ ] **Step 5: Gates and commit**

```bash
npm run build > /tmp/b.log 2>&1; echo "BUILD_EXIT=$?"
npm run test:unit > /tmp/u.log 2>&1; echo "UNIT_EXIT=$?"; grep -E "^ℹ (tests|pass|fail)" /tmp/u.log
npx astro check > /tmp/a.log 2>&1; echo "ASTRO_EXIT=$?"; tail -3 /tmp/a.log
node scripts/cbam-sync-check.mjs > /dev/null 2>&1; echo "SYNC_EXIT=$?"
```

```bash
git add src/pages/cbam/cbam-calculator.astro src/scripts/cbam-algos/cbam-app.ts
git commit -m "feat(cbam): show the Commission's own wording beside the chosen route"
```

---

## Task 4: e2e, land, verify

- [ ] **Step 1: Install the browsers**

```bash
npx playwright install
npm run test:e2e > /tmp/e0.log 2>&1; echo "E2E_EXIT=$?"; grep -E "^\s+[0-9]+ (passed|failed)" /tmp/e0.log | tail -2
```
Expected **120 passed** — the pre-change baseline, established here for the first time in this checkout. If it differs, report before adding tests.

- [ ] **Step 2: Add e2e pins**

Add to `tests/e2e/cbam-lines.spec.ts`, inside a `test.describe` you locate by name. Follow the file's `setLine` convention of waiting for an option to exist before selecting it — its comment explains why: *"proof the pack … has actually loaded, rather than trusting selectOption's own retry behaviour."*

```ts
test('the route options name the route, not just its letter', async ({ page }) => {
  // A letter alone asks an importer to pick their plant's technology blind, and the choice is
  // expensive: on this good, verified at 1.9 tCO2e/t, (C) vs (E) is 2.9x the certificates.
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
  await expect(page.locator('#cbRoute option[value="(C)"]')).toBeAttached();
  await page.selectOption('#cbRoute', '(C)');
  const note = page.locator('#cbRouteNote');
  await expect(note).toContainText('Carbon Steel based on BF/BOF');   // the Commission's exact words
  await expect(note).toContainText('2025/2620');
  await expect(note).not.toContainText('basic oxygen furnace');        // ours, and it stays ours
});
```

- [ ] **Step 3: Full gates**

```bash
npm run build > /tmp/b.log 2>&1; echo "BUILD_EXIT=$?"
npm run test:unit > /tmp/u.log 2>&1; echo "UNIT_EXIT=$?"; grep -E "^ℹ (tests|pass|fail)" /tmp/u.log
npm run test:e2e > /tmp/e.log 2>&1; echo "E2E_EXIT=$?"; grep -E "^\s+[0-9]+ (passed|failed)" /tmp/e.log | tail -2
npx astro check > /tmp/a.log 2>&1; echo "ASTRO_EXIT=$?"; tail -3 /tmp/a.log
node scripts/cbam-sync-check.mjs > /dev/null 2>&1; echo "SYNC_EXIT=$?"
```

**Expect 126 e2e passed, not 122.** `cbam-lines.spec.ts` runs under three projects — `chromium`, `firefox-cbam`, `webkit-cbam` — so two new tests add **six** runs, not two. In CI, where webkit is dropped, the baseline is 89 and the target 93.

- [ ] **Step 4: PR and CI**

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

- [ ] **Step 5: Verify the deploy**

Poll `https://deltaclimate.earth/cbam/cbam-calculator` with `Cache-Control: no-cache` and a delay between attempts. **Check for HTTP 200 before grepping** — a 404 greps as string-absent, which reads as a finding and is not one. Confirm the entry chunk's hash matches the local `dist/` build, then grep it for one of the new labels. Grep for **strings, not identifiers** — the minifier renames those.

---

## Self-review

**Spec coverage.** The eleven entries and their two layers → Task 1. The option label → Task 2. The quote, citation and detail line → Task 3. Testing → Tasks 1 and 4.

**One spec requirement is NOT delivered, and is recorded rather than claimed.** The spec asked for a test that "a route with no glossary entry still renders, proving the fallback rather than assuming it." That test cannot be written: `syncRoutes` is a closure inside `initCbam()` and the unit suite has no DOM, while the e2e suite cannot produce an unglossed letter because the eleven are measured exhaustive and `'default'` is special-cased before the lookup. The `?? ''` is therefore **unreachable by measurement**, kept as cheap defence, and explicitly not described as pinned.

**Not built, per the spec:** inferring which route the user's plant runs; showing each route's benchmark value beside it; anything about the `(1)`/`(2)` tranche indicators, which are not routes.

**Type consistency.** `RouteGloss` is `{ label, quote, cite }`, defined once in Task 1 and consumed in Tasks 2 and 3. `ROUTE_GLOSSARY` is keyed by the indicator exactly as `routesFor` returns it (`'(C)'`, parentheses included). The element id `cbRouteNote` is written in Task 3's markup and read in Task 3's helper and Task 4's e2e — one spelling throughout. `tsconfig` extends `astro/tsconfigs/strict` without `noUncheckedIndexedAccess`, so `ROUTE_GLOSSARY[r]?.label ?? ''` and the `g ? … : ''` ternary both compile clean.

**The thing most likely to be got wrong** is no longer the escaping — the audit proved that a non-issue. It is **the `syncRouteNote()` ordering in Task 3 Step 3**: put it before `syncRoutes()` and every single-route good shows a stale or blank note, silently, because no `change` event fires on a programmatic value assignment. Task 3 Step 4's `73181535` witness exists to catch exactly that.
