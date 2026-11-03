# CBAM Calculator redesign, phase 3: Three years and Why it changes — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task is self-contained: an agent given only one task's text can do it.

**Goal:** Re-render `#cbOutlook` as the spec §5.2 tiles (the year plates, Your own price, Why it rises, The working) and `#cbGraphs` as the spec §5.3 tiles (Mark-up share, Charged, What the mark-up adds, Free allocation, Does the origin matter?, What would it cost at my own price?). Apply decision D2 (cut the year-step chart and the dot cascade) as one isolated, skippable task.

**Architecture:** Two new pure renderer modules, `src/scripts/cbam-ui/tiles-years.ts` and `src/scripts/cbam-ui/tiles-why.ts`, return HTML strings exactly as `renderOutlook` and `renderGraphs` do today, so the unit-test style (render, then assert on the string) carries over. The models stay where they are: `outlook()`, `splitBetween`, `renderOutlookRows`, `renderOutlookNotes` and `renderOutlookPriceNote` in `cbam-outlook.ts`; `graphsModel`, the `sentence*` builders, the tables, `costParts`/`plotCost` and the origins computation in `cbam-graphs.ts`. One extraction is made so the honesty logic is not copied: `outlookWhy(view)` in `cbam-outlook.ts` returns the "why it rises" rows as data. `cbam-app.ts` (`paintOutlook`, `onOutlookInput`) and `cbam-graphs-dom.ts` (`mountGraphs`) call the new renderers; the file `cbam-graphs-dom.ts` keeps its name because the e2e suite routes on `**/cbam-graphs-dom*.js*`. The old renderers and their CSS are deleted only after every test that read them has been ported.

**Tech Stack:** Astro 5 page with a plain `<script>` module, TypeScript, `node --test` through tsx for unit tests, Playwright for e2e. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-02-cbam-rail-ui-design.md` (§5.2, §5.3, §6, §7, §11). **Roadmap:** `docs/superpowers/plans/2026-11-02-cbam-rail-ui-00-roadmap.md`. **Visual reference:** `docs/superpowers/specs/2026-11-02-cbam-rail-ui/screens/2-three-years-*.jpg`, `3-why-*.jpg`, and `preview/bento.html` (the `data-v="three-years"` and `data-v="why"` sections). Read the spec sections before Task 1.

> **Environment notes (measured 2 Nov 2026):** macOS has no `timeout` command, so run Playwright in the foreground through the Bash tool's own timeout. The Chromium project is `chromium-tier0`; there is no `chromium`. `npm run test:unit` must run **after** `npm run build`, because about 59 OBOS and heat-map unit tests read `dist/`.

> **Phase-3 additions to the environment notes:**
> - The worktree for phase 1 holds an **untracked** debug spec, `tests/e2e/zz-tip-probe.spec.ts`, which expects eight graph cards. It is not part of the suite. Never stage it, and run Playwright on **named spec files only** (never a bare `--project=chromium-tier0`), so it never runs.
> - Every Playwright command in this plan runs in the **foreground** with a Bash timeout of at most 600000 ms. Never background Playwright.
> - Stage named paths only. Never `git add -A`, never `git stash`.

> **Branching (orchestrator note, 2 Nov):** the integration branch `feat/cbam-rail-ui` is LOCAL until the user OKs a push. Every `feat/cbam-rail-ui` below means the local branch; each phase branches from it after the previous phase has been merged into it locally.

---

## Decisions this plan makes (read before any task)

These follow from the spec. The Opus phase review (Task 9) checks each one.

1. **Honesty wins over preview copy (spec header).** The preview writes "published €75.36 · 2026-Q1", "price for 2027-Q1 imports" and "at your €80 · yours, not published". All three would break the M2 rule (the quarter may only name the period an import falls in) or the pinned wording. The plates keep today's words: "price published, €75.36", "Certificate price · imports in 2027-Q1", "at your assumed €80 · not a published price".
2. **Colour law (spec §3).** Bronze marks only the mark-up. The old strip drew free allocation in cyan and the visitor's own price in the mark-up hue; cyan means verified figures and the visitor's price is neither. In the new tiles free allocation is ink, the benchmark is ink-3, and the visitor's own price is ink (dashed where none is published). The `--cg-*` chart tokens are remapped to the bento tokens in `cbam-bento.css`.
3. **The cost rows stay a chart.** `plotCost` (SVG, one euro scale, square marks only) is kept inside the cost tile, because three pinned claims rest on it (one euro scale, no rounded mark, one published mark for the shipment's own quarter). The preview's text-only cost row is not copied.
4. **Copy that said "above" is corrected.** The views are separate now, so "Type your own price above", "the box above", "the cards above" and "The figures above" are false. Task 2 changes them to name the view ("in Three years"). Each changed test is listed there.
5. **"Why it rises." becomes a title and a sub-line.** Today one heading reads "Why it rises by 97.6 certificates by 2028". The approved look is a title, "Why it rises.", and a sub-line, "Of 97.6 extra certificates by 2028." Both are asserted exactly, so nothing is loosened.
6. **The "Why it rises" tile's refused state is no tile.** When any year is refused, each year plate already prints the engine's reason verbatim. Today's renderer says nothing more, and the unit test pins that (`doesNotMatch(html, /Why it rises/)`). This plan keeps it. The floor and tier-changes states render a tile titled "Not divided into causes." with today's sentence. (Open question Q1 in Task 9.)
7. **The mark-up dots on a year plate light one dot per 10%, and only for a whole number of tens.** 5,278 rows of the pack carry a 1% mark-up (for example 28080000, nitric acid). One dot per 10% would light none and read as "no mark-up", so those plates say "Mark-up 1%" in words and draw no dots.

## Primitives this phase relies on (created by phase 2 in `src/styles/cbam-bento.css`)

Copied verbatim from `preview/bento.css`, all scoped under `.cbx`: `.b-bento` (the 4-column grid, 2 columns ≤ 1100 px, 1 column on phone), `.b-t` (the tile plate), `.b-s2`, `.b-s4`, `.b-t-h`, `.b-t-ti`, `.b-t-sub`, `.b-t-foot`, `.b-mid`, `.b-u`, `.b-tag`, `.b-none`, `.b-hero` (with `.b-hero .b-mega`), `.b-lead`, `.b-lead2`, `.b-seg` and the `.seg button` look. The tokens `--card --ink --ink-2 --ink-3 --on-ink --well --well-2 --line --bronze-f --bronze-t --focus --ease` come from `src/styles/cbam-app.css` (phase 1). **If any of these is missing when you start, stop and report.** Do not create them in this phase.

The view-specific rules this phase appends (`b-yr`, `b-yr-cost`, `b-mk`, `b-d10`, `b-own`, `b-pricebox`, `b-split`, `b-sp*`, `b-wk`, `b-waffle`, `b-mcols`, `b-mc*`, `b-phase`, `b-ph*`, `b-orig-big`, `b-arrow`, `b-me-big`, `b-strip*`) are written in full in Tasks 5 and 7.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `src/scripts/cbam-outlook.ts` | modify | Task 3: add `outlookWhy` and four formatter exports. Task 5: delete `renderOutlook`, `renderOutlookYears`, `renderYearCost`, `renderOutlookWhy`, `renderOutlookHead`, `outlookPriceSlots` |
| `src/scripts/cbam-ui/tiles-years.ts` | create (Task 4) | The Three years tiles |
| `src/scripts/cbam-graphs.ts` | modify | Task 2: copy. Task 6: export shared helpers. Task 7: delete `renderGraphs`, `cardShell`, `plotShare`, `plotMarkup`, `plotCharged`, `plotPhase`, `plotOrigins`, `originsParts`. Task 8 (D2): delete the step chart and the cascade |
| `src/scripts/cbam-ui/tiles-why.ts` | create (Task 6) | The Why it changes tiles |
| `src/scripts/cbam-graphs-dom.ts` | modify (Task 7) | `mountGraphs` draws the new tiles; HTML marks get tooltips; HTML waffle year switch |
| `src/scripts/cbam-algos/cbam-app.ts` | modify (Tasks 2, 5) | `graphsFailed` copy; `paintOutlook`/`onOutlookInput` call `tiles-years.ts`. **Ours, not vendored**; nothing listed in `UPSTREAM.json` is touched |
| `src/styles/cbam-bento.css` | append (Tasks 5, 7) | Three years and Why sections |
| `src/pages/cbam/cbam-calculator.astro` | modify (Tasks 5, 7) | Delete the old `.cb-ol-*` and `.cg-*` global rules |
| `tests/unit/cbam-outlook.test.mjs` | modify (Tasks 3, 4) | Ported to `tiles-years.ts`; new `outlookWhy` and mark-up dot tests |
| `tests/unit/cbam-graphs.test.mjs` | modify (Tasks 2, 6, 8) | Ported to `tiles-why.ts` |
| `tests/unit/cbam-graphs-more.test.mjs` | modify (Tasks 6, 8) | Ported to `tiles-why.ts` |
| `tests/unit/cbam-chart-colours.test.mjs` | modify (Task 7) | Test 5 reads `cbam-bento.css` |
| `tests/e2e/cbam-lines.spec.ts` | modify (Tasks 2, 5, 7, 8) | Strip and graphs describe blocks |

---

### Task 1: Branch, worktree, baseline (budget 15 min)

**Files:** none.

- [ ] **Step 1: Confirm phase 2 has merged into the integration branch.**

```bash
git -C /Volumes/VSTSAMPLES/Projects/Angad fetch origin
git -C /Volumes/VSTSAMPLES/Projects/Angad log --oneline feat/cbam-rail-ui -10
```

Expected: a merge of the phase-2 PR (`feat/cbam-rail-ui-p2`). If it is not there, **stop and report**.

- [ ] **Step 2: Create the phase-3 branch in its own worktree on OBOSLab.**

```bash
cd /Volumes/VSTSAMPLES/Projects/Angad
git worktree add -b feat/cbam-rail-ui-p3 /Volumes/OBOSLab/worktrees/cbam-rail-ui-p3 feat/cbam-rail-ui
cd /Volumes/OBOSLab/worktrees/cbam-rail-ui-p3 && npm ci
```

Every later command runs in `/Volumes/OBOSLab/worktrees/cbam-rail-ui-p3`.

- [ ] **Step 3: Confirm the primitives exist.**

```bash
for c in '\.b-bento' '\.b-t{' '\.b-s2' '\.b-s4' '\.b-t-h' '\.b-t-ti' '\.b-t-sub' '\.b-t-foot' '\.b-mid' '\.b-u' '\.b-tag' '\.b-none' '\.b-hero' '\.b-mega' '\.b-lead' '\.b-lead2' '\.b-seg'; do
  printf '%s ' "$c"; grep -c -- "$c" src/styles/cbam-bento.css; done
grep -n "cbam-bento.css" src/pages/cbam/cbam-calculator.astro
```

Expected: every count ≥ 1, and the page imports `cbam-bento.css`. If not, **stop and report**.

- [ ] **Step 4: Baseline.**

```bash
npm run check && npm run build && npm run test:unit 2>&1 | tail -8
grep -c "^\s*test(" tests/e2e/cbam-lines.spec.ts
grep -c "^test(" tests/unit/cbam-outlook.test.mjs tests/unit/cbam-graphs.test.mjs tests/unit/cbam-graphs-more.test.mjs tests/unit/cbam-chart-colours.test.mjs
```

Record: the unit `# pass N` line, the e2e test count (57 at phase 1's HEAD 447b4ac; phase 2 may have added tests), and the four unit counts (27, 23, 13 and 5 at 447b4ac). Task 9 compares against these.

---

### Task 2: Copy that pointed "above" names the view (budget 30 min)

The graphs and the strip are on different views now (spec §4.2), so four sentences that point "above" are false. This task changes only those strings and the assertions that pin them. No layout changes.

**Files:**
- Modify: `src/scripts/cbam-graphs.ts` (lines 301, 872–873)
- Modify: `src/scripts/cbam-algos/cbam-app.ts` (`graphsFailed`, about line 2524)
- Modify: `tests/unit/cbam-graphs.test.mjs`, `tests/e2e/cbam-lines.spec.ts`

- [ ] **Step 1: Write the failing assertions first.** In `tests/unit/cbam-graphs.test.mjs`, make exactly these replacements (find each by its text):

| Line (447b4ac) | Old text inside the assertion | New text |
|---|---|---|
| 238 | `Type your own price above to see a cost.` | `Type your own price in Three years to see a cost.` |
| 338 | `'Type your first price in the box above. This one then makes a range.'` | `'Type your first price in Three years. This one then makes a range.'` |
| 342 | `/No certificate price is published for imports in 2027-Q1 or 2028-Q1\. Type your own price above/` | `/No certificate price is published for imports in 2027-Q1 or 2028-Q1\. Type your own price in Three years/` |
| 501 | `Type your own price above to see a cost\.` | `Type your own price in Three years to see a cost\.` |

Then add this test after the test named `'the second price box does nothing, and says why, until the first price exists'`:

```js
test('no sentence points "above": the price box and the reasons are on another view now', () => {
  for (const s of [sentenceCost(TUBE, []), secondNote({ ...STATE(), priceText: '' }), secondNote({ ...STATE(), priceText: '80' })]) {
    assert.doesNotMatch(s, /\babove\b/, s);
  }
  assert.equal(secondNote({ ...STATE(), priceText: '80' }), '€ per certificate. Your first price is the one in Three years.');
});
```

- [ ] **Step 2: Run and confirm the failures.**

Run: `node --import tsx --test tests/unit/cbam-graphs.test.mjs 2>&1 | grep -E "^# (pass|fail)"`

Expected: `# fail 4`: the three tests holding the edited assertions (`the cost sentence: …`, `the second price box does nothing, …`, `AUDIT 2: …`) and the new one.

- [ ] **Step 3: Change the copy in `src/scripts/cbam-graphs.ts`.**
  - Line 301: `Type your own price above to see a cost.` → `Type your own price in Three years to see a cost.`
  - Line 872: `'€ per certificate. Your first price is the box above.'` → `'€ per certificate. Your first price is the one in Three years.'`
  - Line 873: `'Type your first price in the box above. This one then makes a range.'` → `'Type your first price in Three years. This one then makes a range.'`
  - Also update the doc comment above `secondUsable` ("The second price box is usable only once the first price exists…"): it still reads true; leave it.

- [ ] **Step 4: Change `graphsFailed`'s two sentences in `src/scripts/cbam-algos/cbam-app.ts`.** Replace both occurrences of `The graphs could not be loaded. The figures above are complete without them.` with `The graphs could not be loaded. The figures on Estimate and Three years are complete without them.` Update the comment above (`ONE PLAIN SENTENCE AND A WAY BACK…`): change "the figures above are complete" to "the figures on the other views are complete".

- [ ] **Step 5: Port the e2e assertions** in `tests/e2e/cbam-lines.spec.ts` (find each by text; replace only the quoted copy):

| Line (447b4ac) | Old | New |
|---|---|---|
| 1683 | `'The graphs could not be loaded. The figures above are complete without them.'` | `'The graphs could not be loaded. The figures on Estimate and Three years are complete without them.'` |
| 1769 | `… Type your own price above to see a cost.'` | `… Type your own price in Three years to see a cost.'` |
| 1830 | `'Type your first price in the box above. This one then makes a range.'` | `'Type your first price in Three years. This one then makes a range.'` |
| 1868 | `… Type your own price above to see a cost.'` | `… Type your own price in Three years to see a cost.'` |
| 1935 | `… Type your own price above to see a cost.'` | `… Type your own price in Three years to see a cost.'` |
| 1957 | `… Type your own price above to see a cost.'` | `… Type your own price in Three years to see a cost.'` |

Confirm none is left: `grep -n "price above\|box above\|figures above" tests/e2e/cbam-lines.spec.ts tests/unit/cbam-graphs.test.mjs src/scripts/cbam-graphs.ts src/scripts/cbam-algos/cbam-app.ts` prints nothing. (`cards above` in `renderGraphs` is replaced in Task 6, with the renderer.)

- [ ] **Step 6: Gate.**

```bash
npm run check && node --import tsx --test tests/unit/cbam-graphs.test.mjs 2>&1 | grep -E "^# (pass|fail)"
npm run build && npx playwright test tests/e2e/cbam-lines.spec.ts -g "the graphs" --project=chromium-tier0 --reporter=line
```

Expected: unit `# fail 0` with 24 tests; e2e 7 passed.

- [ ] **Step 7: Commit.**

```bash
git add -- src/scripts/cbam-graphs.ts src/scripts/cbam-algos/cbam-app.ts tests/unit/cbam-graphs.test.mjs tests/e2e/cbam-lines.spec.ts
git commit -m "fix(cbam): copy that pointed 'above' names the view it now lives on (rail shell)"
```

---

### Task 3: `outlookWhy`, the "why it rises" rows as data (budget 30 min)

`renderOutlookWhy` decides the honesty-critical wording (which mark-up is named, when a percentage may be quoted, "falls"/"rises"/"does not change"). The new tile needs the same rows, so the decision moves into a pure function that returns data, and `renderOutlookWhy` is rebuilt on top of it. No output changes in this task.

**Files:**
- Modify: `src/scripts/cbam-outlook.ts`
- Test: `tests/unit/cbam-outlook.test.mjs`

- [ ] **Step 1: Write the failing test.** Add `outlookWhy` to the import list from `cbam-outlook.ts` at the top of `tests/unit/cbam-outlook.test.mjs`, then add after the test `'free allocation above the emissions counted: the counts are shown and the split is withheld'`:

```js
test('outlookWhy: the rows are the split\'s parts in order, and the withheld states say why', () => {
  const tube = outlookWhy(outlook(pack, line()));
  assert.equal(tube.kind, 'split');
  assert.equal(tube.rise, '97.5825');
  assert.equal(tube.lastYear, 2028);
  assert.deepEqual(tube.rows.map((r) => [r.key, r.value, r.label]),
    [['markup', '86.4', 'Mark-up'], ['factor', '11.1825', 'Free allocation retained'], ['benchmark', '0', 'Benchmark']]);
  assert.equal(tube.rows[0].title, 'Mark-up on default values rises from 10% to 30%');
  // A refused year: each year card carries the engine's reason; the rows say nothing more.
  assert.deepEqual(outlookWhy(outlook(pack, line({ route: '(D)' }))), { kind: 'none' });
  const floor = outlookWhy(outlook(pack, line({ verified: { directTco2ePerT: '1.0' } })));
  assert.equal(floor.kind, 'withheld');
  assert.equal(floor.reason, 'floor');
  assert.match(floor.sentence, /the count is held at zero and the change between years cannot be divided into causes/);
  // Verified figures: no mark-up row at all.
  assert.deepEqual(outlookWhy(outlook(pack, line({ verified: { directTco2ePerT: '2.0' } }))).rows.map((r) => r.key), ['factor', 'benchmark']);
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `node --import tsx --test tests/unit/cbam-outlook.test.mjs 2>&1 | grep -E "^# (pass|fail)|outlookWhy"`

Expected: FAIL, "outlookWhy is not a function" (or a SyntaxError on the missing export).

- [ ] **Step 3: Implement.** In `src/scripts/cbam-outlook.ts`, replace the whole of `export function renderOutlookWhy(view: Outlook): string { … }` (from its doc comment `/** "Why it rises": the bar and its legend, or the sentence said in their place. */` to its closing brace) with:

```ts
/** One part of the rise, as the strip names it. `title` and `sub` are HTML-safe (escaped here). */
export interface OutlookWhyRow {
  key: 'markup' | 'factor' | 'benchmark';
  title: string;
  sub: string;
  /** The part's exact value, from the split. */
  value: string;
  /** The short name used in the bar's text alternative. */
  label: string;
}

/**
 * What "why it rises" says: nothing (a refused year — each year card already carries the engine's
 * reason, verbatim), a sentence saying why the change is not divided, or the split's rows.
 */
export type OutlookWhy =
  | { kind: 'none' }
  | { kind: 'withheld'; reason: 'floor' | 'tier-changes'; sentence: string }
  | { kind: 'split'; rise: string; lastYear: number; rows: OutlookWhyRow[] };

/**
 * "Why it rises" as data: the one place its wording is decided. The tiles (cbam-ui/tiles-years.ts)
 * and renderOutlookWhy draw these rows; neither decides a word of them.
 */
export function outlookWhy(view: Outlook): OutlookWhy {
  const s = view.split;
  if (s === null) {
    switch (view.splitWithheld) {
      case 'floor':
        return {
          kind: 'withheld', reason: 'floor',
          sentence: 'In at least one of these years the free allocation is as large as the emissions counted, so the count is held at zero and the change between years cannot be divided into causes. The counts above stand.',
        };
      case 'tier-changes':
        return {
          kind: 'withheld', reason: 'tier-changes',
          sentence: 'These years do not rest on the same kind of figure, so the change between them is not divided into causes. The counts above stand.',
        };
      case 'refused':
      case null:
        return { kind: 'none' };
      default: {
        const _exhaustive: never = view.splitWithheld;
        return _exhaustive;
      }
    }
  }
  const figures = figureYears(view);
  const first = figures[0];
  const last = figures[figures.length - 1];
  const rows: OutlookWhyRow[] = [];

  if (s.emissionsCause !== 'none') {
    const electricity = s.emissionsCause === 'markup-electricity';
    const from = electricity ? first.indirectMarkupPct : first.directMarkupPct;
    const to = electricity ? last.indirectMarkupPct : last.directMarkupPct;
    const what = electricity
      ? "Mark-up on the Commission's default value for electricity"
      : 'Mark-up on default values';
    // The percentages are named only when ONE mark-up explains the whole term. A line on default
    // values with electricity in scope carries two (process and electricity); when they differ,
    // quoting either would misdescribe the other half, so the sentence gives none.
    const single = electricity
      || first.indirectMarkupPct === null
      || (first.indirectMarkupPct === first.directMarkupPct && last.indirectMarkupPct === last.directMarkupPct);
    let title: string;
    if (from === null || to === null || !single) {
      title = new D(s.moreEmissions).isZero() ? `${what} does not change` : `${what} rises`;
    } else if (from === to) {
      title = `${what} stays at ${esc(from)}%`;
    } else {
      title = `${what} rises from ${esc(from)}% to ${esc(to)}%`;
    }
    rows.push({
      key: 'markup',
      title,
      sub: electricity
        ? 'It applies to the electricity figure, which is not your own verified one. With a verified electricity figure it no longer applies.'
        : "It applies only while you use the Commission's default values. With verified emissions it no longer applies.",
      value: s.moreEmissions,
      label: 'Mark-up',
    });
  }

  const cite = first.factorLocator.includes(':') ? first.factorLocator.slice(0, first.factorLocator.indexOf(':')) : '';
  rows.push({
    key: 'factor',
    title: first.factor === last.factor
      ? `Free allocation retained stays at ${share(first.factor)}`
      : `Free allocation retained falls from ${share(first.factor)} to ${share(last.factor)}`,
    sub: `${cite ? `${esc(cite)}. ` : ''}The share retained falls each year${
      view.allocationEndsYear === null ? '' : `, to zero in ${view.allocationEndsYear}`}.`,
    value: s.factorPart,
    label: 'Free allocation retained',
  });

  const bmFirst = benchmarkOf(first);
  const bmLast = benchmarkOf(last);
  const scope = benchmarkScope(first);
  // The year the benchmark first differs from the year before it, read off the cards themselves.
  const changedIn = figures.find((y, i) => i > 0 && benchmarkOf(y)?.value !== benchmarkOf(figures[i - 1])?.value);
  let benchTitle: string;
  if (!bmFirst || !bmLast) {
    benchTitle = new D(s.benchmarkPart).isZero() ? 'Benchmark does not change' : 'Benchmark changes';
  } else if (bmFirst.value === bmLast.value || !changedIn) {
    benchTitle = `Benchmark ${scope} does not change by ${s.lastYear}`;
  } else {
    const verb = new D(bmLast.value).lessThan(bmFirst.value) ? 'falls' : 'rises';
    benchTitle = `Benchmark ${scope} ${verb} in ${changedIn.year} (${esc(bmFirst.value)} → ${esc(bmLast.value)})`;
  }
  rows.push({
    key: 'benchmark',
    title: benchTitle,
    sub: view.benchmarkPeriods.length
      ? `Benchmarks are set by period: ${view.benchmarkPeriods.map(([a, b]) => `${a}–${b}`).join(', then ')}.`
      : 'Benchmarks are set by period.',
    value: s.benchmarkPart,
    label: 'Benchmark',
  });
  return { kind: 'split', rise: s.rise, lastYear: s.lastYear, rows };
}

const WHY_CLASS: Record<OutlookWhyRow['key'], string> = { markup: 'cb-ol-s1', factor: 'cb-ol-s2', benchmark: 'cb-ol-s3' };

/** "Why it rises": the bar and its legend, or the sentence said in their place. Drawn from outlookWhy. */
export function renderOutlookWhy(view: Outlook): string {
  const why = outlookWhy(view);
  if (why.kind === 'none') return '';
  if (why.kind === 'withheld') return `<p class="cb-ol-nosplit">${why.sentence}</p>`;
  // A part that is zero draws no segment (it would be a zero-width box holding a gap open); its
  // legend row still stands and says so.
  const bar = why.rows.filter((r) => !new D(r.value).isZero()).map((r) => `<span class="${WHY_CLASS[r.key]}" style="flex-grow:${
    new D(r.value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed()}"></span>`).join('');
  const aria = why.rows.map((r) => `${r.label} ${count1(r.value)}`).join(', ');
  const legend = why.rows.map((r) => `<li>
      <span class="cb-ol-sw ${WHY_CLASS[r.key]}"></span>
      <span>${r.title}<small>${r.sub}</small></span>
      <b>${new D(r.value).isZero() ? '0.0' : `+${count1(r.value)}`}</b>
    </li>`).join('');
  return `<h4 class="cb-ol-h">Why it rises by ${count1(why.rise)} certificates by ${why.lastYear}</h4>
    <div class="cb-ol-stack" role="img" aria-label="${esc(aria)}">${bar}</div>
    <ul class="cb-ol-legend">${legend}</ul>`;
}
```

`outlookWhy` uses `figureYears`, `benchmarkOf`, `benchmarkScope`, `share`, `esc` and `D`, all already defined in this file. They are only called when `outlookWhy` runs, after the module has loaded, so no declaration needs to move.

- [ ] **Step 4: Export four formatters for `tiles-years.ts`.** Directly after the line `const signedPct = (v: string): string => { … };` block in the formatting section, add:

```ts
/** The strip's own formatters, shared with cbam-ui/tiles-years.ts so the tiles print every figure the same way. */
export { count1 as formatCount, euros as formatEuros, price as formatPrice, signedPct as formatSignedPct };
```

- [ ] **Step 5: Run the outlook tests; all must pass, including every pre-existing one.**

Run: `node --import tsx --test tests/unit/cbam-outlook.test.mjs 2>&1 | grep -E "^# (pass|fail)"`

Expected: `# pass 28`, `# fail 0`. The 27 existing tests still pass unchanged, which is the evidence that the rows did not change.

- [ ] **Step 6: Type-check and commit.**

```bash
npm run check
git add -- src/scripts/cbam-outlook.ts tests/unit/cbam-outlook.test.mjs
git commit -m "refactor(cbam): outlookWhy — the 'why it rises' rows as data, renderOutlookWhy drawn from it"
```

---
### Task 4: `tiles-years.ts`, and the strip's unit tests ported onto it (budget 45 min)

**Files:**
- Create: `src/scripts/cbam-ui/tiles-years.ts`
- Modify: `tests/unit/cbam-outlook.test.mjs`

The rule for every port in this task: **the same claim, held as tightly, against the new renderer.** Where the new layout changes the reading order, the regex keeps every token and its contiguity and only the order follows the plate. The year title gains its full stop (`2026.`), so `2026 ` becomes `2026\. ` — strictly tighter.

**The plate's reading order (fixed by this task, and what the ported regexes assume):** title (`2027.`), the rise (`+14.2% on 2026`, absent in the first year and when the first count is zero), the count (`376.8`), the word `certificates`, the cost block (unchanged words), then the mark-up line (`Mark-up 20%`).

- [ ] **Step 1: Write the module.**

```ts
// src/scripts/cbam-ui/tiles-years.ts
/**
 * Three years (spec §5.2): the year plates, the visitor's own price, why it rises, the working.
 *
 * These replace cbam-outlook.ts's renderOutlook and its parts. The model stays there: outlook(),
 * outlookWhy() (every word of "why it rises"), renderOutlookRows (the working), renderOutlookNotes
 * and renderOutlookPriceNote. This file lays those out as tiles and decides no figure and no
 * sentence of its own, except the plate's cost block, moved here unchanged from renderYearCost.
 *
 * Pure: HTML strings from an Outlook, so node:test holds every state against the real pack.
 * The class hooks the e2e suite reads (cb-ol, cb-ol-yr, cb-ol-n, cb-ol-d, cb-ol-h, cb-ol-stack,
 * cb-ol-legend, cb-ol-work, cb-ol-scroll, cb-ol-price, cb-card-label, cb-tag) sit beside the b-
 * design classes (spec §6.4).
 *
 * THE PARTS THE PRICE CHANGES SIT IN data-ol SLOTS, as before, so the page refills them while the
 * visitor types without replacing #cbOlPrice (which would drop the caret mid-number) or the
 * <details> (which would close it). See yearsPriceSlots.
 */
import Decimal from 'decimal.js';
import {
  assumedCost, formatCount, formatEuros, formatPackDate, formatPrice, formatSignedPct, outlookWhy,
  parseAssumedPrice, renderOutlookNotes, renderOutlookPriceNote, renderOutlookRows, unpricedYears,
  type Outlook, type OutlookFigureYear, type OutlookWhyRow,
} from '../cbam-outlook.ts';

const esc = (s: string): string => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * How many of ten dots a mark-up lights: ONE DOT PER 10%, and only when the mark-up is a whole
 * number of tens. 5,278 rows of the pack carry a 1% mark-up (28080000, nitric acid, is one); on
 * this scale it would light no dot and read as "no mark-up", so it is said in words and not drawn.
 */
export function markupDots(pct: string): number | null {
  let d: Decimal;
  try { d = new Decimal(pct); } catch { return null; }
  if (!d.isFinite() || d.isNegative() || d.greaterThan(100) || !d.mod(10).isZero()) return null;
  return d.div(10).toNumber();
}

/** The mark-up the engine applied this year: the working table's rule, direct default first. */
function plateMarkup(y: OutlookFigureYear): string {
  const pct = y.directMarkupPct ?? y.indirectMarkupPct;
  if (pct === null) return '';
  const what = y.directMarkupPct !== null ? 'Mark-up' : 'Electricity mark-up';
  const n = markupDots(pct);
  const dots = n === null ? '' : `<span class="b-d10 b-bz" aria-hidden="true">${
    Array.from({ length: 10 }, (_, i) => `<i${i < n ? ' class="on"' : ''}></i>`).join('')}</span>`;
  return `<p class="b-mk"><span>${what} ${esc(pct)}%</span>${dots}</p>`;
}

function plateCost(y: OutlookFigureYear, view: Outlook, assumed: string | null): string {
  // A PUBLISHED PRICE IS NEVER REPLACED. The engine's cost comes first and the visitor's number
  // is not consulted at all for that year.
  if (y.costEur !== null && y.price.priceEur !== null) {
    return `<span class="b-tag num cb-ol-e">${formatEuros(y.costEur)}</span>
      <span class="b-t-sub cb-ol-s">price published, ${formatPrice(y.price.priceEur)}</span>`;
  }
  if (assumed !== null) {
    return `<span class="b-tag num cb-ol-e cb-ol-mine">${formatEuros(assumedCost(y.certificates, assumed))}</span>
      <span class="b-t-sub cb-ol-s">at your assumed ${formatPrice(assumed)} · not a published price</span>`;
  }
  // ABOUT THIS YEAR'S OWN QUARTER, the period the import falls in (M2): never the price's period.
  return `<span class="b-t-sub cb-ol-s">Certificate price · imports in ${esc(y.price.quarter)}</span>
      <span class="b-tag b-none cb-ol-e">none published</span>
      <span class="b-t-sub cb-ol-s">as at ${esc(formatPackDate(view.priceAsAt))}</span>`;
}

/** The year plates. A refused year shows the engine's reason, verbatim, and no figure. */
export function renderYearPlates(view: Outlook, assumed: string | null): string {
  const firstYear = view.years[0].year;
  return view.years.map((y, i) => {
    if (y.kind === 'refused') {
      return `<li class="b-t b-yr cb-ol-yr cb-ol-refused">
        <div class="b-t-h"><h3 class="b-t-ti num cb-ol-y">${y.year}.</h3></div>
        <p class="b-mid cb-ol-none">No estimate</p>
        <p class="b-t-sub cb-ol-reason">${esc(y.reason)}</p>
      </li>`;
    }
    const delta = y.year !== firstYear && y.riseOnFirstPct !== null
      ? `<span class="b-t-sub cb-ol-d">${formatSignedPct(y.riseOnFirstPct)} on ${firstYear}</span>` : '';
    return `<li class="b-t b-yr cb-ol-yr${i === 0 ? ' b-hero' : ''}">
        <div class="b-t-h"><h3 class="b-t-ti num cb-ol-y">${y.year}.</h3>${delta}</div>
        <p class="b-mid num cb-ol-n">${formatCount(y.certificates)}</p>
        <p class="b-t-sub">certificates</p>
        <div class="b-yr-cost cb-ol-p">${plateCost(y, view, assumed)}</div>
        ${plateMarkup(y)}
      </li>`;
  }).join('');
}

const SEGMENT: Record<OutlookWhyRow['key'], string> = {
  markup: 'b-sp-bz cb-ol-s1', factor: 'b-sp-ink cb-ol-s2', benchmark: 'b-sp-ink2 cb-ol-s3',
};
const SWATCH: Record<OutlookWhyRow['key'], string> = { markup: 'cb-ol-s1', factor: 'cb-ol-s2', benchmark: 'cb-ol-s3' };

/**
 * "Why it rises." The split bar and its legend, or, where the change is not divided, the reason.
 * A refused year renders no tile: each plate above carries the engine's own reason.
 */
export function renderYearsWhy(view: Outlook): string {
  const why = outlookWhy(view);
  switch (why.kind) {
    case 'none':
      return '';
    case 'withheld':
      return `<section class="b-t b-s4 b-rise cb-ol-why" aria-labelledby="cbOlWhyT">
      <h3 class="b-t-ti" id="cbOlWhyT">Not divided into causes.</h3>
      <p class="b-lead2 cb-ol-nosplit">${why.sentence}</p>
    </section>`;
    case 'split': {
      // A part that is zero draws no segment; its legend row still stands and says so.
      const bar = why.rows.filter((r) => !new Decimal(r.value).isZero()).map((r) => `<span class="b-sp ${SEGMENT[r.key]}" style="flex-grow:${
        new Decimal(r.value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed()}"><span class="num">+${formatCount(r.value)}</span></span>`).join('');
      const aria = why.rows.map((r) => `${r.label} ${formatCount(r.value)}`).join(', ');
      const legend = why.rows.map((r) => `<li>
        <span class="cb-ol-sw ${SWATCH[r.key]}" aria-hidden="true"></span>
        <span>${r.title}<small>${r.sub}</small></span>
        <b>${new Decimal(r.value).isZero() ? '0.0' : `+${formatCount(r.value)}`}</b>
      </li>`).join('');
      return `<section class="b-t b-s4 b-rise cb-ol-why" aria-labelledby="cbOlWhyT">
      <div class="b-t-h"><div><h3 class="b-t-ti cb-ol-h" id="cbOlWhyT">Why it rises.</h3>
        <p class="b-t-sub cb-ol-hs">Of ${formatCount(why.rise)} extra certificates by ${why.lastYear}.</p></div></div>
      <div class="b-split cb-ol-stack" role="img" aria-label="${esc(aria)}">${bar}</div>
      <ul class="cb-ol-legend">${legend}</ul>
    </section>`;
    }
    default: {
      const _exhaustive: never = why;
      return _exhaustive;
    }
  }
}

/**
 * The whole Three years view's content. `priceText` is what the visitor typed in the price box,
 * restored into the box when the view is rebuilt; it is never read from anywhere but the caller's
 * own variable. `workingOpen` carries the <details> state across a rebuild.
 */
export function renderYears(view: Outlook, priceText = '', workingOpen = false): string {
  const assumed = parseAssumedPrice(priceText);
  const hasFigures = view.years.some((y) => y.kind === 'figure');
  const priceBox = unpricedYears(view).length > 0;
  const first = view.years[0].year;
  const last = view.years[view.years.length - 1].year;
  return `<section class="cb-ol" aria-labelledby="cbOlTitle">
  <header class="cb-ol-head"><h2 class="cb-card-label" id="cbOlTitle">The same shipment, ${first} to ${last}</h2>
    <span class="b-tag cb-tag pending">Law as published · ${esc(formatPackDate(view.packDate))}</span></header>
  <div class="b-bento">
    <ol class="cb-ol-years" data-ol="years">${renderYearPlates(view, assumed)}</ol>
    <section class="b-t b-own cb-ol-price" aria-labelledby="cbOlPriceT"${priceBox ? '' : ' hidden'}>
      <h3 class="b-t-ti" id="cbOlPriceT">Your own price.</h3>
      <label class="b-t-sub" for="cbOlPrice">Your own price assumption, € per certificate</label>
      <div class="b-pricebox"><span aria-hidden="true">€</span>
        <input id="cbOlPrice" class="cb-ol-px num" type="number" min="0" step="any" inputmode="decimal"
          placeholder="e.g. 80" autocomplete="off" aria-describedby="cbOlPriceNote" value="${esc(priceText)}" />
        <em aria-hidden="true">per certificate</em></div>
      <p class="b-t-foot" id="cbOlPriceNote" data-ol="pricenote">${renderOutlookPriceNote(view, priceText)}</p>
    </section>
    ${renderYearsWhy(view)}
    <section class="b-t b-s4 b-work" aria-labelledby="cbOlWorkT"${hasFigures ? '' : ' hidden'}>
      <h3 class="b-t-ti" id="cbOlWorkT">The working.</h3>
      <p class="b-t-sub">Year by year, exact.</p>
      <details class="cb-ol-work"${workingOpen ? ' open' : ''}${hasFigures ? '' : ' hidden'}>
        <summary>Show the working</summary>
        <div class="cb-ol-scroll" tabindex="0" role="region" aria-label="The working, year by year">
          <table class="b-wk num">
            <thead><tr><td></td>${view.years.map((y) => `<th scope="col">${y.year}</th>`).join('')}</tr></thead>
            <tbody data-ol="rows">${renderOutlookRows(view, assumed)}</tbody>
          </table>
        </div>
      </details>
      <div class="cb-ol-notes">${renderOutlookNotes(view)}</div>
    </section>
  </div>
</section>`;
}

/**
 * The three slots the visitor's price can change. The page refills these when the price box is
 * typed in, and leaves everything else — the box itself above all — exactly where it is.
 */
export function yearsPriceSlots(view: Outlook, priceText: string): Record<'years' | 'rows' | 'pricenote', string> {
  const assumed = parseAssumedPrice(priceText);
  return {
    years: renderYearPlates(view, assumed),
    rows: renderOutlookRows(view, assumed),
    pricenote: renderOutlookPriceNote(view, priceText),
  };
}
```

The view section must hold **exactly one** `<details>`, `<summary>`, `<table>`, `.cb-tag` and `.cb-card-label`: the e2e suite reads each of them under `#cbOutlook .cb-ol` in strict mode, and `paintOutlook` reads `outlookEl.querySelector('details')`. Do not add a second `<details>` (the preview's "Not yet published" fold is deliberately not copied: the notes stay visible).

- [ ] **Step 2: Point the strip's unit tests at the new renderer (they fail first).** In `tests/unit/cbam-outlook.test.mjs`:

  1. Replace the import of `outlookPriceSlots, … renderOutlook, renderOutlookWhy, renderOutlookYears` from `cbam-outlook.ts`: remove those four names from that import, and add:
     ```js
     import {
       markupDots, renderYearPlates, renderYears, renderYearsWhy, yearsPriceSlots,
     } from '../../src/scripts/cbam-ui/tiles-years.ts';
     ```
  2. Rename every call: `renderOutlook(` → `renderYears(`, `renderOutlookWhy(` → `renderYearsWhy(`, `renderOutlookYears(` → `renderYearPlates(`, `outlookPriceSlots(` → `yearsPriceSlots(`. Check with `grep -n "renderOutlook\|outlookPriceSlots" tests/unit/cbam-outlook.test.mjs` → no hits.
  3. Port these assertions **exactly** (every other assertion in the file is unchanged):

| Test (by name) | Old assertion | Ported assertion |
|---|---|---|
| `a good whose benchmark steps down in the last period: iron powder 72052100, route (F)` | `assert.match(why, /Why it rises by 76\.3 certificates by 2028/);` | `assert.match(why, /Why it rises\. Of 76\.3 extra certificates by 2028\./);` |
| `a route with no default value for the origin: …` | `assert.match(html, /<div class="cb-ol-price" hidden>/, 'and no cost for a price to fill');` | `assert.match(html, /<section class="b-t b-own cb-ol-price" aria-labelledby="cbOlPriceT" hidden>/, 'and no cost for a price to fill');` |
| `a typed price fills only the years with no published price, and never replaces a published one` | `/2026 329\.8 certificates €24,855\.80 price published, €75\.36/` (twice) | `/2026\. 329\.8 certificates €24,855\.80 price published, €75\.36/` |
| same test | `/2027 376\.8 certificates, \+14\.2% on 2026 Certificate price · imports in 2027-Q1 none published as at 14 Oct 2026/` | `/2027\. \+14\.2% on 2026 376\.8 certificates Certificate price · imports in 2027-Q1 none published as at 14 Oct 2026/` |
| same test | `/2028 427\.4 certificates, \+29\.6% on 2026 Certificate price · imports in 2028-Q1 none published as at 14 Oct 2026/` | `/2028\. \+29\.6% on 2026 427\.4 certificates Certificate price · imports in 2028-Q1 none published as at 14 Oct 2026/` |
| same test | `/2027 376\.8 certificates, \+14\.2% on 2026 €30,140\.40 at your assumed €80 · not a published price/` | `/2027\. \+14\.2% on 2026 376\.8 certificates €30,140\.40 at your assumed €80 · not a published price/` |
| same test | `/2028 427\.4 certificates, \+29\.6% on 2026 €34,192\.80 at your assumed €80 · not a published price/` | `/2028\. \+29\.6% on 2026 427\.4 certificates €34,192\.80 at your assumed €80 · not a published price/` |
| same test, inside the `for (const bad of …)` loop | `/2027 376\.8 certificates, \+14\.2% on 2026 Certificate price · imports in 2027-Q1 none published/` | `/2027\. \+14\.2% on 2026 376\.8 certificates Certificate price · imports in 2027-Q1 none published/` |
| `when the entered date falls in a 2026 quarter with no published price, 2026 is fillable too` | `/2026 329\.8 certificates Certificate price · imports in 2026-Q4 none published as at 14 Oct 2026/` | `/2026\. 329\.8 certificates Certificate price · imports in 2026-Q4 none published as at 14 Oct 2026/` |
| same test | `/2027 376\.8 certificates, \+14\.2% on 2026 Certificate price · imports in 2027-Q4 none published/` | `/2027\. \+14\.2% on 2026 376\.8 certificates Certificate price · imports in 2027-Q4 none published/` |
| `a 2026-Q3 import is priced at the published Q3 price, EUR 82.32, and at no other quarter's` | `/2026 329\.8 certificates €27,151\.40 price published, €82\.32/` | `/2026\. 329\.8 certificates €27,151\.40 price published, €82\.32/` |

  The `mine` check in the typed-price test (`html.match(/€30,140\.40[\s\S]{0,120}/g)`, length 2, each with "your assumed €80") is unchanged: the plate puts "at your assumed €80" within 60 characters of the figure.

- [ ] **Step 3: Add the new plate tests** at the end of the `/* ── the words ── */` section:

```js
test('the year plates: the hero is the first year, the mark-up is the engine\'s, and the dots light only whole tens', () => {
  const html = renderYearPlates(outlook(pack, line()), null);
  assert.equal((html.match(/class="b-t b-yr cb-ol-yr b-hero"/g) ?? []).length, 1, 'one hero plate, the first');
  assert.match(text(html), /2026\. 329\.8 certificates €24,855\.80 price published, €75\.36 Mark-up 10%/);
  assert.equal((html.match(/<i class="on"><\/i>/g) ?? []).length, 1 + 2 + 3, 'one dot per 10%: 10%, 20%, 30%');
  assert.equal(markupDots('10'), 1);
  assert.equal(markupDots('30'), 3);
  assert.equal(markupDots('1'), null, 'a 1% mark-up is said, not drawn as no dot');
  assert.equal(markupDots('15'), null);
  assert.equal(markupDots('-10'), null);
  assert.equal(markupDots('not a number'), null);
  // Nitric acid carries a 1% mark-up in every year: the plate names it, and draws no dots.
  const nitric = renderYearPlates(outlook(pack, line({ cn: '28080000', route: 'default' })), null);
  assert.equal((nitric.match(/Mark-up 1%/g) ?? []).length, 3);
  assert.doesNotMatch(nitric, /b-d10/);
  // Verified figures carry no mark-up, so none is named; the electricity default's is named as such.
  assert.doesNotMatch(renderYearPlates(outlook(pack, line({ verified: { directTco2ePerT: '2.0' } })), null), /mark-up/i);
  const clinker = renderYearPlates(outlook(pack, line({
    cn: '2523100090', country: 'DZ', route: '(A)', emissionsScope: 'direct_and_indirect', verified: { directTco2ePerT: '1.5' },
  })), null);
  assert.match(text(clinker), /Electricity mark-up 10%.*Electricity mark-up 20%.*Electricity mark-up 30%/);
});

test('the view holds one details, one summary, one table, one tag: the hooks the page and the e2e read', () => {
  const html = renderYears(outlook(pack, line()), '80', true);
  for (const [what, re] of [['details', /<details/g], ['summary', /<summary/g], ['table', /<table/g], ['cb-tag', /\bcb-tag\b/g], ['cb-card-label', /\bcb-card-label\b/g]]) {
    assert.equal((html.match(re) ?? []).length, 1, what);
  }
  assert.match(html, /<details class="cb-ol-work" open>/);
  assert.equal((html.match(/id="cbOlPrice"/g) ?? []).length, 1);
  // Floor: the tile says why the change is not divided, and never "Why it rises".
  const floor = renderYears(outlook(pack, line({ verified: { directTco2ePerT: '1.0' } })));
  assert.match(text(floor), /Not divided into causes\. In at least one of these years/);
  assert.doesNotMatch(floor, /cb-ol-h"/);
  // Zero first-year count: no percentage on any plate.
  assert.doesNotMatch(floor, /cb-ol-d"/);
});
```

- [ ] **Step 4: Run and confirm green.**

Run: `node --import tsx --test tests/unit/cbam-outlook.test.mjs 2>&1 | grep -E "^# (pass|fail)"`

Expected: `# pass 30`, `# fail 0` (27 ported + `outlookWhy` + the two above).

If an assertion fails, **fix the renderer, not the test**. The ported regexes above are the only permitted edits.

- [ ] **Step 5: Type-check and commit.**

```bash
npm run check
git add -- src/scripts/cbam-ui/tiles-years.ts tests/unit/cbam-outlook.test.mjs
git commit -m "feat(cbam): Three years tiles (tiles-years.ts); the strip's unit tests ported onto them"
```

---

### Task 5: Wire Three years, style it, port its e2e, retire the old strip renderer (budget 45 min)

**Files:**
- Modify: `src/scripts/cbam-algos/cbam-app.ts` (import at about line 41, `paintOutlook` about 2460, `onOutlookInput` about 2557)
- Append: `src/styles/cbam-bento.css`
- Modify: `src/pages/cbam/cbam-calculator.astro` (delete the old strip rules)
- Modify: `src/scripts/cbam-outlook.ts` (delete the old renderers)
- Modify: `tests/e2e/cbam-lines.spec.ts`

- [ ] **Step 1: Port the strip's e2e first (it fails until step 3).** In `tests/e2e/cbam-lines.spec.ts`, inside `test.describe('CBAM estimate — the three-year strip', …)`, make exactly these two edits; every other line of the 9 tests stays:

  - In `'the previewed line is shown in 2026, 2027 and 2028, with the cause of the rise'`, replace
    `await expect(strip.locator('.cb-ol-h')).toHaveText('Why it rises by 97.6 certificates by 2028');`
    with
    ```ts
    await expect(strip.locator('.cb-ol-h')).toHaveText('Why it rises.');
    await expect(strip.locator('.cb-ol-hs')).toHaveText('Of 97.6 extra certificates by 2028.');
    ```
  - In `'states: a refused route, verified figures, and a benchmark that steps down'`, replace
    `await expect(strip.locator('.cb-ol-h')).toHaveText('Why it rises by 11.2 certificates by 2028');`
    with
    ```ts
    await expect(strip.locator('.cb-ol-h')).toHaveText('Why it rises.');
    await expect(strip.locator('.cb-ol-hs')).toHaveText('Of 11.2 extra certificates by 2028.');
    ```

  How each of the 9 strip tests survives the new markup, for the task report:

| Test | What it reads | Why it still holds |
|---|---|---|
| `the previewed line is shown in 2026, 2027 and 2028, with the cause of the rise` | `.cb-ol`, `.cb-card-label`, `.cb-tag`, `.cb-ol-yr` ×3, `.cb-ol-n`, plate text, `.cb-ol-h`/`.cb-ol-hs`, `.cb-ol-legend li` ×3 and `b`, `.cb-ol-stack` aria-label | Every hook is on the new markup; legend rows and aria-label come from `outlookWhy` unchanged |
| `the same three counts whichever of the three years the import date is in` | `.cb-ol-n` ×3 | unchanged hook |
| `"Show the working" opens from the keyboard and holds the engine's figures` | one `summary`, one `table`, `tbody tr` ×4, one `details` | one of each by construction (unit test in Task 4 pins it); rows from `renderOutlookRows` |
| `a price typed in the box fills 2027 and 2028 only, keeps the caret, and goes nowhere` | `#cbOlPrice`, label text, plate text, `#cgSecond` | label kept verbatim and visible; slots kept (`yearsPriceSlots`); caret: see step 2 |
| `a strip rebuild that lands while the price box is focused keeps the caret …` | `#cbOlPrice` focus across a forced rebuild | `paintOutlook`'s `replaceWith(live)` still finds `#cbOlPrice` in the new markup |
| `the strip is about one previewed line: absent when idle, past the corpus, and in a document` | `#cbOutlook` empty, `.cb-ol` | `renderYears` is only called with an outlook; `paintOutlook` still empties the container otherwise |
| `states: a refused route, verified figures, and a benchmark that steps down` | refused plate text, no `.cb-ol-n`, no `.cb-ol-stack`, `.cb-ol-work` hidden, `#cbOlPrice` hidden, `.cb-ol-stack > span` ×3 | refused plate has `cb-ol-none` (not `cb-ol-n"`); the why tile renders nothing for refused; the working tile and `<details>` carry `hidden`; segments are direct `span` children |
| `at 320 px the page does not scroll sideways, and the working table scrolls inside its own box` | no page overflow, `.cb-ol-yr` one per row inside 320 px, `.cb-ol-scroll` tabindex | phone rule below puts plates in one column; table scrolls in `.cb-ol-scroll` |
| `axe: the strip, with the working open and a price typed, has no automated WCAG violations` | axe | labelled input, `aria-hidden` decorations, focus ring on `.b-pricebox:focus-within` |

- [ ] **Step 2: Wire the renderer in `cbam-app.ts`.**
  - Line 41: replace `import { outlook, outlookPriceSlots, parseAssumedPrice, renderOutlook, type Outlook } from '../cbam-outlook.ts';` with
    ```ts
    import { outlook, parseAssumedPrice, type Outlook } from '../cbam-outlook.ts';
    import { renderYears, yearsPriceSlots } from '../cbam-ui/tiles-years.ts';
    ```
  - In `paintOutlook`: `outlookEl.innerHTML = renderOutlook(outlookView, assumedPriceText, open);` → `outlookEl.innerHTML = renderYears(outlookView, assumedPriceText, open);`. Leave the rest of the function exactly as it is. **The caret-preservation behaviour survives unchanged**: before the rebuild `live` is the focused `#cbOlPrice`; after it, the fresh `#cbOlPrice` is replaced by the live element (`fresh.replaceWith(live)`), so the caret and the typed text stay. It depends only on the id, which the new markup keeps once.
  - `open` is read with `outlookEl.querySelector('details')?.open`. The new markup has exactly one `<details>` (the working), so it still reads the right one.
  - In `onOutlookInput`: `const slots = outlookPriceSlots(outlookView, assumedPriceText);` → `const slots = yearsPriceSlots(outlookView, assumedPriceText);`.

- [ ] **Step 3: Append the Three years styles** to the end of `src/styles/cbam-bento.css`:

```css
/* ── Three years (cbam-ui/tiles-years.ts → #cbOutlook), spec §5.2 ─────────────────────────
   Colour law (spec §3): bronze marks only the mark-up. Free allocation and the benchmark are
   ink; the visitor's own price is dashed ink, never a colour that means a source. */
.cbx .cb-ol{display:flex;flex-direction:column;gap:12px;min-width:0}
.cbx .cb-ol-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}
.cbx .cb-ol-head .cb-card-label{margin:0;font-size:13px;font-weight:600;color:var(--ink-2)}
.cbx .cb-ol-years{grid-column:span 3;display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:12px;list-style:none;margin:0;padding:0;min-width:0}
.cbx .b-yr{min-height:232px}
.cbx .b-yr .b-mid{margin:auto 0 0;font-size:clamp(40px,4.4vw,64px)}
.cbx .b-yr-cost{display:flex;flex-direction:column;align-items:flex-start;gap:4px;margin:14px 0}
.cbx .b-hero .b-tag{background:color-mix(in oklab,var(--on-ink) 12%,transparent);color:inherit}
.cbx .b-hero.b-yr .b-t-sub{color:color-mix(in oklab,var(--on-ink) 72%,transparent)}
.cbx .cb-ol-e.cb-ol-mine{background:transparent;outline:1.5px dashed currentColor;outline-offset:-1.5px}
.cbx .b-mk{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:0;font-size:11.5px;font-weight:600;color:var(--ink-3)}
.cbx .b-hero .b-mk{color:color-mix(in oklab,var(--on-ink) 72%,transparent)}
.cbx .b-d10{display:grid;grid-template-columns:repeat(10,1fr);gap:3px;width:110px}
.cbx .b-d10 i{aspect-ratio:1;border-radius:50%;background:color-mix(in oklab,var(--ink) 16%,transparent)}
.cbx .b-hero .b-d10 i{background:color-mix(in oklab,var(--on-ink) 22%,transparent)}
.cbx .b-d10.b-bz i.on{background:var(--bronze-f)}
.cbx .cb-ol-refused .cb-ol-none{margin:auto 0 8px;font-size:28px;letter-spacing:-.02em}
.cbx .cb-ol-reason{font-size:12.5px;line-height:1.5}
.cbx .b-own{grid-column:span 1}
.cbx .b-pricebox{display:flex;align-items:baseline;gap:6px;margin:auto 0 10px;padding:10px 16px;border-radius:20px;background:var(--well)}
.cbx .b-pricebox:focus-within{box-shadow:0 0 0 2px var(--focus)}
.cbx .b-pricebox span{font-size:40px;color:var(--ink-3)}
.cbx .b-pricebox input{width:100%;min-width:0;border:0;background:transparent;font:inherit;font-size:56px;letter-spacing:-.05em;color:var(--ink);outline:0}
.cbx .b-pricebox input::placeholder{color:var(--ink-3)}
.cbx .b-pricebox em{font-style:normal;font-size:12px;color:var(--ink-3);white-space:nowrap}
.cbx .b-own .b-t-foot{display:block;line-height:1.5}
.cbx .b-split{display:flex;gap:6px;height:120px;margin:16px 0 12px}
.cbx .b-split-sm{height:64px;margin:0 0 12px}
.cbx .b-sp{flex:0 0 0;min-width:0;overflow:hidden;border-radius:18px;display:flex;align-items:flex-start}
.cbx .b-sp>span{padding:14px 16px;font-size:30px;letter-spacing:-.04em;line-height:1;white-space:nowrap}
.cbx .b-split-sm .b-sp>span{padding:10px 12px;font-size:20px}
.cbx .b-sp-bz{background:var(--bronze-f);color:#141614}
.cbx .b-sp-ink{background:var(--ink);color:var(--on-ink)}
.cbx .b-sp-ink2{background:var(--ink-3);color:var(--on-ink)}
.cbx .b-sp-on{background:color-mix(in oklab,var(--on-ink) 22%,transparent);color:var(--on-ink)}
.cbx .cb-ol-legend{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.cbx .cb-ol-legend li{display:grid;grid-template-columns:12px 1fr auto;gap:10px;align-items:baseline;font-size:14px;line-height:1.45}
.cbx .cb-ol-legend small{display:block;font-size:12px;color:var(--ink-3)}
.cbx .cb-ol-legend b{font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}
.cbx .cb-ol-sw{display:inline-block;width:10px;height:10px;border-radius:3px}
.cbx .cb-ol-sw.cb-ol-s1{background:var(--bronze-f)}
.cbx .cb-ol-sw.cb-ol-s2{background:var(--ink)}
.cbx .cb-ol-sw.cb-ol-s3{background:var(--ink-3)}
.cbx .cb-ol-nosplit{max-width:72ch}
.cbx .b-work summary{width:fit-content;margin-top:12px;padding:6px 14px;border-radius:99px;background:var(--well);cursor:pointer;list-style:none;font-size:12px;font-weight:600;color:var(--ink-2)}
.cbx .b-work summary::-webkit-details-marker{display:none}
.cbx .cb-ol-scroll{overflow-x:auto;min-width:0}
.cbx .b-wk{width:100%;min-width:25rem;border-collapse:collapse;margin-top:14px;font-size:15px;font-variant-numeric:tabular-nums}
.cbx .b-wk th,.cbx .b-wk td{text-align:right;padding:12px 10px;border-bottom:1px solid var(--line);vertical-align:top;font-weight:400}
.cbx .b-wk thead th{font-size:12px;font-weight:600;color:var(--ink-3)}
.cbx .b-wk tbody th{text-align:left;font-weight:600;font-size:13px}
.cbx .b-wk small{display:block;margin-top:2px;font-size:11px;font-weight:400;color:var(--ink-3)}
.cbx .b-wk .cb-ol-tot td{font-size:24px;letter-spacing:-.03em}
.cbx .b-wk tr:last-child th,.cbx .b-wk tr:last-child td{border-bottom:0}
.cbx .b-wk .cb-ol-np{font-weight:600;color:var(--ink)}
.cbx .cb-ol-notes{margin-top:12px}
.cbx .cb-ol-note{margin:6px 0 0;font-size:11.5px;line-height:1.55;color:var(--ink-3)}
.cbx :is(.b-work summary,.cb-ol-scroll):focus-visible{outline:2px solid var(--focus);outline-offset:2px}
@media (max-width:1100px){.cbx .cb-ol-years,.cbx .b-own{grid-column:1/-1}}
@media (max-width:899px){.cbx .cb-ol-years{grid-auto-flow:row;grid-template-columns:minmax(0,1fr)}}
/* ── end Three years */
```

- [ ] **Step 4: Retire the old strip CSS.** In `src/pages/cbam/cbam-calculator.astro`, inside the first `<style is:global>` block, delete from the line `  /* ── The three-year strip (cbam-outlook.ts → #cbOutlook) ──…` down to, but not including, the line `  /* ── The graphs (cbam-graphs.ts → #cbGraphs) ──…`. **Keep these two rules and their comments**, moving them to just above the graphs comment, because they apply to every card on Estimate, not only the strip:

```css
  /* MEASURED, NOT ASSUMED: without this the page scrolled sideways by 82px at 390px. The results
     section is a grid item, and a grid item's automatic minimum width is its content's — here the
     working table's — so the table's own scroll container never got the chance to scroll. */
  .cb-out { min-width: 0; }
  /* A card's label and its tag do not fit on one line at phone width, and the tag is nowrap.
     EVERY card, not only the strip: measured at 320px, the result card's own tag ("What-if ·
     CSCF for 2026 unpublished", 227px) already ran 41px off the page before the strip existed. */
  .cb-out .cb-card-head { flex-wrap: wrap; }
```

Confirm: `grep -n "cb-ol" src/pages/cbam/cbam-calculator.astro` prints only comment lines in the markup (the three-years section's HTML comment), no CSS rule.

- [ ] **Step 5: Delete the old renderers from `src/scripts/cbam-outlook.ts`.** Delete `renderYearCost`, `renderOutlookYears`, `renderOutlookWhy` (with the `WHY_CLASS` constant Task 3 added), `renderOutlookHead`, `renderOutlook` and `outlookPriceSlots`, each with its doc comment. Keep `unpricedYears`, `yearList`, `benchmarkOf`, `benchmarkScope`, `figureYears`, `outlookWhy`, `renderOutlookRows`, `renderOutlookPriceNote`, `renderOutlookNotes` and every formatter. Then:

```bash
grep -rn "renderOutlook(\|renderOutlookYears\|renderOutlookWhy\|renderOutlookHead\|outlookPriceSlots\|renderYearCost" src tests
```

Expected: no hits. Update the file's header comment: replace the sentence "the renderers are pure functions of its result" with "the tiles in cbam-ui/tiles-years.ts draw it; the rows of the working, the notes and the price note are drawn here".

- [ ] **Step 6: Gate.**

```bash
npm run check && npm run build && npm run test:unit 2>&1 | tail -6
npx playwright test tests/e2e/cbam-lines.spec.ts tests/e2e/cbam-shell.spec.ts -g "three-year strip|shell|rail" --project=chromium-tier0 --reporter=line
```

Expected: check clean; unit `# fail 0`; Playwright: the 9 strip tests and the shell spec pass. If a strip test fails, fix the markup or CSS. **The only permitted e2e edits are the two in step 1.**

- [ ] **Step 7: Headless screenshots, by eye.** Take 1440×900 and 390×844 shots of `#three-years` with the tube line (73063077 · IN · (C) · 100 t · 2026-03-15), dark and `?theme=light`, with the price box empty and with 80 typed, into `/Volumes/OBOSLab/tmp/cbam-rail-p3-shots/`. Do not open a visible browser. Compare with `screens/2-three-years-desktop-dark.jpg` and `-phone-dark.jpg`. Check: plates in one row on desktop with the own-price tile at the end of it; one column on phone; no numeral clipped; the hero plate's tag and dots are legible.

- [ ] **Step 8: Commit.**

```bash
git add -- src/scripts/cbam-algos/cbam-app.ts src/styles/cbam-bento.css src/pages/cbam/cbam-calculator.astro src/scripts/cbam-outlook.ts tests/e2e/cbam-lines.spec.ts
git commit -m "feat(cbam): Three years view as bento tiles; old strip renderer and CSS retired"
```

---
### Task 6: `tiles-why.ts`, and the graphs' unit tests ported onto it (budget 45 min)

The six §5.3 tiles, plus the two D2 tiles (the year-step chart and the dot cascade) drawn in the same tile shell, so that **if the founder says keep, nothing else is needed**, and if he says cut, Task 8 deletes them in one place.

The new plots are HTML (bars, a waffle, columns, a strip), each on a zero-based scale. The cost rows, the step chart and the cascade stay the SVG `cbam-graphs.ts` already draws.

**Files:**
- Modify: `src/scripts/cbam-graphs.ts` (export shared helpers only)
- Create: `src/scripts/cbam-ui/tiles-why.ts`
- Modify: `tests/unit/cbam-graphs.test.mjs`, `tests/unit/cbam-graphs-more.test.mjs`

- [ ] **Step 1: Export the helpers the tiles share.** At the very end of `src/scripts/cbam-graphs.ts`, add:

```ts
/* ── shared with cbam-ui/tiles-why.ts, so the tiles format and table every figure the same way ── */
export type { Plot, Table };
export {
  CAUSES, causeLabel, causePart, esc, eur, listOf, n1, n3, offShared, pct1, plus, sharePct,
  table as renderTable, unpricedQuarters, wrap,
};
```

Run `npm run check`. Expected: clean.

- [ ] **Step 2: Write the module.**

```ts
// src/scripts/cbam-ui/tiles-why.ts
/**
 * Why it changes (spec §5.3): the graphs as bento tiles. These replace cbam-graphs.ts's
 * renderGraphs and its card shell.
 *
 * Pure: HTML strings from the graphs model. Every figure is the model's and every sentence is
 * cbam-graphs.ts's own builder. What is new here is only the drawing: HTML bars, a waffle,
 * columns and a strip, each on a zero-based scale, in place of the SVG arc, capsules, line and
 * stems. The cost rows stay the SVG plotCost draws: one euro scale, square marks only.
 *
 * THE MARK CONTRACT IS KEPT. Every mark is focusable (tabindex 0), named (role img and an
 * aria-label), and carries data-tip (the exact figure, which cbam-graphs-dom.ts shows on hover and
 * focus) and data-v (the exact value the tests and the e2e read). The hooks the e2e reads
 * (cg-card, data-cg-card, cg-t, cg-big, cg-plot, cg-tbl, cg-tbl-btn, data-cg, cg-tip, #cgSecond,
 * data-cg-year, data-country, data-shared, data-computable, data-charged) sit beside the b-
 * design classes (spec §6.4).
 */
import Decimal from 'decimal.js';
import { formatDecimal, formatPackDate } from '../cbam-outlook.ts';
import {
  CAUSES, causeLabel, causePart, cascadeLegend, cascadeUnit, chargedCells, chargedLegend, chargedTip,
  costParts, esc, eur, listOf, n1, n3, offShared, pct1, plotCascade, plotSteps, plus, renderTable,
  secondNote, secondUsable, sentenceCascade, sentenceCharged, sentenceMarkup, sentenceOrigins,
  sentencePhase, sentenceShare, sentenceSteps, sharePct, tableCharged, unpricedQuarters, wrap,
  type GraphsModel, type GraphsRefusal, type GraphsState, type OriginsModel, type PhaseModel,
} from '../cbam-graphs.ts';

const D = Decimal.clone({ precision: 60 });

/** A mark drawn in HTML: exactly the attributes of cbam-graphs.ts's SVG `mark`, in its order. */
const htmlMark = (tag: 'div' | 'i', cls: string, tip: string, value: string, inner: string, extra = ''): string =>
  `<${tag} class="cg-m${cls ? ` ${cls}` : ''}" tabindex="0" role="img" aria-label="${esc(tip.replace(/\n/g, '. '))}" data-tip="${esc(tip)}" data-v="${esc(value)}"${extra ? ` ${extra}` : ''}>${inner}</${tag}>`;

/** A plot's container: a named group, as the SVG plots' <svg role="group" aria-label>. */
const fig = (cls: string, alt: string, inner: string, extra = ''): string =>
  `<div class="cg-fig${cls ? ` ${cls}` : ''}" role="group" aria-label="${esc(alt)}"${extra ? ` ${extra}` : ''}>${inner}</div>`;

/* ── the plots ─────────────────────────────────────────────────────────────── */

/** Mark-up share: one bar, the mark-up's part against the rest of the rise. Empty when there is no share to show. */
export function shareBar(m: GraphsModel): string {
  if (!m.split) return fig('b-split b-split-sm', 'The change is not divided into causes.', '');
  const alt = `${pct1(m.split.markupSharePct)} of the rise is mark-up.`;
  const share = Math.max(0, Math.min(1, Number(m.split.markupSharePct) / 100));
  if (share <= 0) return fig('b-split b-split-sm', alt, '');
  const grow = (v: Decimal): string => v.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed();
  const rest = new D(m.split.factor).plus(m.split.benchmark);
  const inner = `<span class="b-sp b-sp-bz" style="flex-grow:${grow(new D(m.split.markup))}"><span class="num">${n1(m.split.markup)}</span></span>${
    rest.isZero() ? '' : `<span class="b-sp b-sp-on" style="flex-grow:${grow(rest)}"></span>`}`;
  return fig('', alt, htmlMark('div', 'b-split b-split-sm',
    `${pct1(m.split.markupSharePct)} of the rise\n${n1(m.split.markup)} of ${n1(m.split.rise)} certificates`,
    m.split.markupSharePct, inner, `data-t="${share.toFixed(5)}"`));
}

/** The tallest column's height in px. Every column is drawn on this one zero-based scale. */
const MC_BAR = 180;

/**
 * What the mark-up adds: one column per year, the count as priced, split into the mark-up (bronze)
 * and the count with the Commission's base value entered as verified. data-y1/data-y0 are the two
 * tops measured down from the scale's top, so y0 − y1 is the mark-up's length.
 */
export function markupColumns(m: GraphsModel): string {
  const Y = m.years;
  const max = Math.max(1e-9, ...Y.map((y) => Number(y.certificates)));
  const px = (v: string): number => (Number(v) / max) * MC_BAR;
  const cols = Y.map((y) => {
    const adds = !new D(y.markupAdds).isZero();
    const total = px(y.certificates), base = px(y.certificatesAtBase);
    const y1 = MC_BAR - total, y0 = MC_BAR - base;
    const tip = adds
      ? `${y.year}: mark-up ${y.markupPct ?? ''}% adds ${n3(y.markupAdds)}\nas priced: ${n3(y.certificates)}\nthe base value entered as verified: ${n3(y.certificatesAtBase)}`
      : `${y.year}: ${n3(y.certificates)} certificates\nno mark-up is applied`;
    const label = new D(y.markupAdds).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).isZero() ? 'under 0.1' : `+${n1(y.markupAdds)}`;
    const bar = `<span class="b-mc-bar" style="height:${total.toFixed(3)}px">${adds
      ? `<b class="b-mc-mk" style="flex-grow:${(y0 - y1).toFixed(3)}"><em class="num">${label}</em></b>` : ''}<i style="flex-grow:${base.toFixed(3)}"></i></span>`;
    return htmlMark('div', 'b-mc', tip, y.markupAdds,
      `<span class="b-mc-top num">${n1(y.certificates)}</span>${bar}<span class="b-mc-y num">${y.year}</span><span class="b-t-sub">${
        y.markupPct !== null ? `mark-up ${esc(y.markupPct)}%` : 'no mark-up'}</span>`,
      `data-y1="${y1.toFixed(3)}" data-y0="${y0.toFixed(3)}" data-certificates="${esc(y.certificates)}"`);
  }).join('');
  return fig('b-mcols', `Mark-up adds ${Y.map((y) => `${n1(y.markupAdds)} in ${y.year}`).join(', ')} certificates.`, cols, `style="--n:${Y.length}"`);
}

/**
 * Charged: 100 cells, the shown year's share lit. `data-cells` holds every year's count of lit
 * cells, so the page switches years by toggling classes, with no redraw.
 */
export function waffle(m: GraphsModel, yearIndex: number): string {
  const yi = Math.max(0, Math.min(m.years.length - 1, yearIndex));
  const cells = m.years.map((y) => (y.chargedPct === null ? 0 : chargedCells(y.chargedPct)));
  const y = m.years[yi];
  const dots = Array.from({ length: 100 }, (_, k) => `<i${k < cells[yi] ? ' class="on"' : ''}></i>`).join('');
  return fig('', `${cells[yi]} of 100 cells are certificates in ${y.year}.`,
    htmlMark('div', 'b-waffle', chargedTip(y), y.chargedPct ?? '', dots,
      `data-charged="${cells[yi]}" data-cg="charged-mark" data-cells="${cells.join(',')}"`));
}

/** Free allocation: the legislated schedule as columns; solid where this line has a figure. */
export function phaseColumns(phase: PhaseModel): string {
  const cols = phase.rows.map((f) => {
    const tip = `${f.year}: ${sharePct(f.factor)} of free allocation retained\n${f.locator}\n${
      f.computable ? 'the engine computes this line for this year' : 'legislated; no certificate count is computed here for this year'}`;
    const h = D.max(0, D.min(100, new D(f.factor).times(100))).toFixed();
    return htmlMark('div', `b-ph${f.computable ? ' b-ph-on' : ''}`, tip, f.factor,
      `<span class="b-ph-bar"><b style="height:${h}%"></b></span><span class="num">${f.year}</span><em class="num">${sharePct(f.factor)}</em>`,
      `data-computable="${f.computable}"`);
  }).join('');
  return fig('b-phase', `Share of free allocation retained: ${phase.rows.map((f) => `${f.year} ${sharePct(f.factor)}`).join(', ')}.`,
    cols, `style="--n:${phase.rows.length}"`);
}

/**
 * Does the origin matter: every origin on one zero-based strip (position = value ÷ the highest),
 * the visitor's own enlarged, and the shared figure marked. Drawn only for kind 'chart', as
 * before: a flat spread, or one or two origins, is said in words and not drawn as if it mattered.
 */
export function originStrip(o: OriginsModel): string {
  if (o.kind !== 'chart') return '';
  const O = o.rows, me = O.find((r) => r.country === o.ownCountry);
  // With a shared figure, the named extremes are those of the others, as the sentence says.
  const named = o.shared ? offShared(o) : O, lo = named[0], hi = named[named.length - 1];
  const top = new D(O[O.length - 1].certificates);
  const at = (v: string): string => (top.isZero() ? '0.0000' : new D(v).div(top).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4));
  const pos = (v: string): string => `left:calc(14px + (100% - 28px) * ${at(v)})`;
  const dots = O.map((r) => htmlMark('i', r === me ? 'b-me' : '', `${r.name}: ${n3(r.certificates)} certificates on default values, ${o.year}`,
    r.certificates, '', `data-country="${esc(r.country)}" style="${pos(r.certificates)}"`)).join('');
  const band = o.shared
    ? `<span class="b-strip-band" data-shared="${o.mode.count}" aria-hidden="true" style="${pos(o.mode.certificates)}">${o.mode.count} origins at ${n1(o.mode.certificates)}</span>` : '';
  const big = `<p class="b-orig-big num"><span>${n1(lo.certificates)}<small>${esc(lo.name)}</small></span><span class="b-arrow" aria-hidden="true">→</span><span>${
    n1(hi.certificates)}<small>${esc(hi.name)}</small></span>${me ? `<span class="b-me-big">${esc(me.name)} ${n1(me.certificates)}</span>` : ''}</p>`;
  const alt = `${O.length} origins ranked by certificates on default values, from ${n1(O[0].certificates)} to ${n1(O[O.length - 1].certificates)}${
    o.shared ? `; ${o.mode.count} of them at ${n1(o.mode.certificates)}` : ''}.`;
  return `${big}${fig('b-strip', alt, dots + band)}`;
}

/** The origins tile's body, for the page to fill once the origins have been computed. */
export function originsTileParts(o: OriginsModel | null): { title: string; plot: string; table: string; cap: string } {
  if (!o) return { title: 'No origin publishes a default value for this good and route in this year.', plot: '', table: '', cap: '' };
  return {
    title: sentenceOrigins(o),
    plot: originStrip(o),
    table: renderTable({ head: ['Origin', `Certificates, ${o.year}`], rows: o.rows.map((r) => [esc(r.name), n3(r.certificates)]) }),
    cap: `The Commission's default values for each origin, ${o.rows.length} published for this good and route. Where goods come from is a fact of the shipment, not a setting${o.usesVerified ? '; your line uses verified figures, which replace these' : ''}.`,
  };
}

/* ── the tiles ─────────────────────────────────────────────────────────────── */

/** The pixel widths the page measured for the tiles whose plot is an SVG. The HTML plots size themselves. */
export type WhyWidths = Record<'steps' | 'cascade' | 'cost', number>;

interface TileOpts {
  span: 2 | 4; hero?: boolean; title: string; sub?: string; head?: string; big?: string;
  sentence: string; plot: string; extra?: string; cap: string; tbl: string; open: boolean;
}

/**
 * One tile. A closed table carries the class `cg-closed`, NOT the `hidden` attribute: the site's
 * base layer hides [hidden] with !important, which no print rule could undo (measured in all three
 * engines when the graphs were built).
 */
const tile = (id: string, o: TileOpts): string => `
  <section class="b-t b-s${o.span}${o.hero ? ' b-hero' : ''} cg-card cg-${id}" data-cg-card="${id}" aria-labelledby="cgQ-${id}">
    <div class="b-t-h"><div><h2 class="b-t-ti cg-q" id="cgQ-${id}">${o.title}</h2>${o.sub ? `<p class="b-t-sub">${o.sub}</p>` : ''}</div>${o.head ?? ''}</div>
    ${o.big === undefined ? '' : `<p class="b-mega num cg-big">${o.big}</p>`}
    <p class="b-lead cg-t" data-cg="title">${o.sentence}</p>
    <figure class="cg-plot" data-cg="plot">${o.plot}</figure>
    ${o.extra ?? ''}
    <div class="b-t-foot cg-foot"><p class="cg-cap" data-cg="cap">${o.cap}</p>
      <button type="button" class="cg-tbl-btn" aria-expanded="${o.open}" aria-controls="cgTbl-${id}">Show as table</button></div>
    <div class="cg-tbl${o.open ? '' : ' cg-closed'}" id="cgTbl-${id}" data-cg="table" tabindex="0" role="region" aria-label="Table: ${esc(o.title)}">${o.tbl}</div>
  </section>`;

const dot = (fill: string): string => `<svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="${fill}"/></svg>`;
const ring = (stroke: string): string => `<svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="3.8" fill="none" stroke="${stroke}" stroke-width="1.8"/></svg>`;

/**
 * The whole Why view's content. `widths` are the pixel widths the page measured for the SVG
 * plots; this module never measures anything itself.
 */
export function renderWhy(model: GraphsModel | GraphsRefusal, state: GraphsState, widths: WhyWidths, phase?: PhaseModel): string {
  if (typeof model === 'string') {
    return `<section class="cg" aria-label="Graphs"><div class="b-bento"><div class="b-t b-s4"><p class="cg-none">${model === 'no-estimate'
      ? 'Nothing to draw: this line has no estimate in any year. The reason is in Three years.'
      : 'Nothing to draw: this line has no estimate in at least one year. The reason is in Three years.'}</p></div></div></section>`;
  }
  const m = model, Y = m.years;
  const yi = state.chargedYear === null ? Y.length - 1 : Math.max(0, Math.min(Y.length - 1, state.chargedYear));
  const asAt = `as at ${formatPackDate(m.priceAsAt)}`;
  const cost = costParts(m, widths.cost, state);
  const unpriced = unpricedQuarters(m);

  // D2 (spec §11): the year-step chart and the dot cascade. Task 8 of the phase-3 plan deletes
  // these two tiles; until then they are drawn here, unchanged in content.
  const maxCount = Math.max(...Y.map((y) => Number(y.certificates)));
  const steps = tile('steps', {
    span: 4, title: 'Certificates, year by year.', sentence: sentenceSteps(m), plot: wrap(widths.steps, plotSteps(m, widths.steps)),
    cap: `Law as published · ${formatPackDate(m.packDate)}. A cost appears only where a certificate price is published.`,
    open: !!state.open.steps,
    tbl: renderTable({ head: ['Year', 'Certificates', `Change on ${Y[0].year}`, 'Cost'],
      rows: Y.map((y) => [y.year, n3(y.certificates), y.riseOnFirstPct === null ? '—' : new D(y.riseOnFirstPct).isZero() ? '0%' : `${new D(y.riseOnFirstPct).isNegative() ? '' : '+'}${pct1(y.riseOnFirstPct)}`,
        y.costEur !== null ? eur(y.costEur) : `none published for imports in ${y.priceQuarter}`]) }),
  });
  const cascade = tile('cascade', {
    span: 4, title: 'Why does it rise?', sentence: sentenceCascade(m), plot: wrap(widths.cascade, plotCascade(m, widths.cascade)),
    extra: `<div class="cg-legend">${cascadeLegend(m)}</div>`,
    cap: `One dot = ${formatDecimal(String(cascadeUnit(maxCount)), 1, false)} certificate${cascadeUnit(maxCount) === 1 ? '' : 's'}, rounded; the table is exact.${m.usesDefault ? ' The mark-up no longer applies with verified data.' : ''}`,
    open: !!state.open.cascade,
    tbl: renderTable({ head: ['Year', 'Certificates', ...CAUSES.map((c) => causeLabel(m, c.key))],
      rows: Y.map((y, i) => [y.year, n3(y.certificates), ...CAUSES.map((c) => (i === 0 ? '—' : m.causes[i] ? plus(causePart(m.causes[i]!, c.key)) : 'not divided'))]),
      caption: `Changes are since ${Y[0].year}.` }),
  });

  const share = tile('share', {
    span: 2, hero: true, title: 'Mark-up share.',
    big: m.split ? `${formatDecimal(m.usesDefault ? m.split.markupSharePct : '0', 1, true)}<span class="b-u">%</span>` : '—',
    sentence: sentenceShare(m), plot: shareBar(m),
    cap: m.split ? `${n1(m.split.markup)} of ${n1(m.split.rise)} certificates. The rest is free allocation.` : 'The counts in Three years stand.',
    open: !!state.open.share,
    tbl: renderTable(m.split ? { head: ['Cause', 'Certificates'],
      rows: [['Mark-up', plus(m.split.markup)], ['Less free allocation retained', plus(m.split.factor)], ['Lower benchmark', plus(m.split.benchmark)], ['Total rise', plus(m.split.rise)]] }
      : { head: ['Cause', 'Certificates'], rows: [['Not divided for this line', '—']] }),
  });

  const charged = tile('charged', {
    span: 2, title: 'Charged.', sub: 'Certificates per 100 tCO₂e of emissions counted.',
    head: `<div class="b-seg cg-mini" role="group" aria-label="Year">${Y.map((y, j) => `<button type="button" data-cg-year="${j}" aria-pressed="${j === yi}">${y.year}</button>`).join('')}</div>`,
    sentence: sentenceCharged(m, yi), plot: waffle(m, yi),
    extra: `<div class="cg-legend" data-cg="legend">${chargedLegend(m, yi)}</div>`,
    cap: 'One cell = 1% of the emissions counted for this shipment, rounded to whole cells.',
    open: !!state.open.charged, tbl: renderTable(tableCharged(m)),
  });

  const markup = tile('markup', {
    span: 2, title: 'What the mark-up adds.', sentence: sentenceMarkup(m), plot: markupColumns(m),
    cap: m.usesDefault
      ? "Bronze: what the mark-up adds, as priced. Below it: the engine given the Commission's base value as a verified figure. A real verified figure can be higher or lower than that base."
      : 'The column is the count from your verified figures.',
    open: !!state.open.markup,
    tbl: renderTable({ head: ['Year', 'Mark-up', 'As priced', 'Base as verified', 'Mark-up adds'],
      rows: Y.map((y) => [y.year, y.markupPct !== null ? `${esc(y.markupPct)}%` : 'none', n3(y.certificates), n3(y.certificatesAtBase), plus(y.markupAdds)]) }),
  });

  const phaseTile = phase ? tile('phase', {
    span: 2, title: 'Free allocation.', sentence: sentencePhase(phase), plot: phaseColumns(phase),
    extra: `<div class="cg-legend"><span>${dot('var(--cg-ink)')}Years computed for this line</span><span>${ring('var(--cg-neutral)')}Legislated, not computed here</span></div>`,
    cap: 'Directive 2003/87/EC Art 10a(1a): the share of free allocation retained. Default values are published to 2028 only, so no certificate count is drawn after it.',
    open: !!state.open.phase,
    tbl: renderTable({ head: ['Year', 'Share retained', 'Computed for this line'], rows: phase.rows.map((r) => [r.year, sharePct(r.factor), r.computable ? 'yes' : 'no']) }),
  }) : '';

  // THE ORIGINS ARE COMPUTED AFTER THE REST IS ON SCREEN (one engine call per origin), so the
  // tile is drawn with its question and a placeholder, and the page fills its slots.
  const origins = tile('origins', {
    span: 4, title: 'Does the origin matter?', sentence: 'Comparing every origin\'s default value…', plot: '', cap: '', tbl: '',
    open: !!state.open.origins,
  });

  const costTile = tile('cost', {
    span: 4, title: 'What would it cost at my own price?', sentence: cost.title, plot: cost.plot,
    extra: `<div class="cg-second"><label for="cgSecond">A second price, to see a range</label>
        <input id="cgSecond" type="number" min="0" step="any" inputmode="decimal" autocomplete="off" aria-describedby="cgSecondNote" value="${esc(state.secondText)}"${secondUsable(state) ? '' : ' disabled'} />
        <span id="cgSecondNote" data-cg="second-note">${secondNote(state)}</span></div>
      <div class="cg-legend">
        <span><svg width="12" height="12" aria-hidden="true"><rect x="4.5" y="1" width="3" height="10" fill="var(--cg-ink)"/></svg>Published price for this import's date</span>
        <span><svg width="16" height="12" aria-hidden="true"><path d="M1 6h14" stroke="var(--cg-markup)" stroke-width="2"/></svg>Your own price</span>
        <span><svg width="16" height="12" aria-hidden="true"><path d="M1 6h14" stroke="var(--cg-markup)" stroke-width="2" stroke-dasharray="3 3"/></svg>Yours, where none is published</span></div>`,
    cap: `Your price is your assumption, not a forecast. It stays on this page.${unpriced.length ? ` Certificate price for imports in ${listOf(unpriced, 'and')}: none published · ${asAt}.` : ''}`,
    open: !!state.open.cost, tbl: cost.table,
  });

  return `<section class="cg" aria-label="Graphs"><p class="cg-sub">Hover or focus a mark for its exact figure.</p><div class="b-bento cg-board">${
    steps}${cascade}${share}${charged}${markup}${phaseTile}${origins}${costTile}</div><div class="cg-tip" data-cg="tip" aria-hidden="true"></div></section>`;
}
```

Run `npm run check`. Expected: clean.

- [ ] **Step 3: Port `tests/unit/cbam-graphs.test.mjs`.**
  1. Import: remove `plotCharged`, `plotMarkup`, `plotShare` and `renderGraphs` from the `cbam-graphs.ts` import (`plotCharged` is imported and never used today), and add
     `import { markupColumns, renderWhy, shareBar, waffle } from '../../src/scripts/cbam-ui/tiles-why.ts';`
  2. Rename every `renderGraphs(` to `renderWhy(`. Check: `grep -n "renderGraphs\|plotMarkup\|plotShare\|plotCharged" tests/unit/cbam-graphs.test.mjs` → no hits.
  3. Port exactly these assertions (all others unchanged):

| Test (by name) | Old | Ported |
|---|---|---|
| `the mark-up sentences say what applies, and never that anyone will pay less` | `assert.doesNotMatch(plotMarkup(tiny, 280, 'u').svg, /\+0\.0</);` | `assert.doesNotMatch(markupColumns(tiny), /\+0\.0</);` |
| `the capsules: length is what the mark-up adds, and a verified line draws no capsule` | `const svg = plotMarkup(TUBE, 280, 'u').svg;` | `const svg = markupColumns(TUBE);` (the `data-v … data-y1 … data-y0` regex, the constant-ratio check and the `+43.2 … +129.6` text check are unchanged) |
| same test | `const quiet = plotMarkup(verified, 280, 'u').svg;` | `const quiet = markupColumns(verified);` |
| same test | `assert.doesNotMatch(quiet, /<rect class="cg-halo"\|fill="url\(#u\)"/, 'no capsule where no mark-up is applied');` | `assert.doesNotMatch(quiet, /class="b-mc-mk"/, 'no mark-up segment where no mark-up is applied');` |
| same test | `assert.equal((quiet.match(/<circle/g) ?? []).length, 3, 'the three counts are still marked');` | `assert.equal((quiet.match(/class="cg-m b-mc"/g) ?? []).length, 3, 'the three counts are still marked');` |
| `the arc: its fraction is the share, and it is empty when there is nothing to show` | `plotShare(TUBE, 280, 'u').svg`, `plotShare(verified, 280, 'u').svg`, `plotShare(floored, 280, 'u').svg` | `shareBar(TUBE)`, `shareBar(verified)`, `shareBar(floored)` (assertions unchanged: `data-t` is `0.88540`, `data-v` is the share, none for a share of zero or no split) |
| `the section: eight cards, each with a sentence, a table and a text alternative` | `['steps', 'cascade', 'share', 'markup', 'charged', 'cost', 'phase', 'origins']` | `['steps', 'cascade', 'share', 'charged', 'markup', 'phase', 'origins', 'cost']` |
| same test | `assert.equal((html.match(/<svg[^>]*role="group" aria-label="[^"]+"/g) ?? []).length, 7, …)` | `assert.equal((html.match(/<svg[^>]*role="group" aria-label="[^"]+"/g) ?? []).length + (html.match(/<div class="cg-fig[^"]*" role="group" aria-label="[^"]+"/g) ?? []).length, 7, 'every plot has a text alternative');` |
| same test | `assert.equal((html.match(/<h4 class="cg-t"/g) ?? []).length, 8);` | `assert.equal((html.match(/<p class="b-lead cg-t"/g) ?? []).length, 8);` |
| same test | `/class="cg-m" tabindex="0" role="img" aria-label="[^"]+"/g` … `21` | `/class="cg-m[^"]*" tabindex="0" role="img" aria-label="[^"]+"/g` … `21` (comment: "3 steps + 3 cascade + the share bar + 3 mark-up columns + the waffle + the published cost + 9 phase years") |
| `refused and reduced states say so in words and draw nothing false` | `/The ring is the count from your verified figures\./` | `/The column is the count from your verified figures\./` |

  4. Add two tests after `'the arc: …'`:

```js
test('the waffle: whole cells per year, the shown year lit, and every year\'s count on the mark', () => {
  const html = waffle(TUBE, 0);
  assert.match(html, /data-charged="69" data-cg="charged-mark" data-cells="69,73,76"/);
  assert.equal((html.match(/<i class="on"><\/i>/g) ?? []).length, 69);
  assert.equal((html.match(/<i( class="on")?><\/i>/g) ?? []).length, 100);
  assert.equal((waffle(TUBE, 99).match(/<i class="on"><\/i>/g) ?? []).length, 76, 'an index past the end shows the last year');
});

test('every Why tile: a full-stop or question title, a sentence, a plot, "Show as table", and a closed table', () => {
  const html = renderWhy(TUBE, STATE(), WIDTHS, phaseModel(pack, TUBE));
  const titles = [...html.matchAll(/<h2 class="b-t-ti cg-q" id="cgQ-(\w+)">([^<]+)<\/h2>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(titles, [['steps', 'Certificates, year by year.'], ['cascade', 'Why does it rise?'], ['share', 'Mark-up share.'],
    ['charged', 'Charged.'], ['markup', 'What the mark-up adds.'], ['phase', 'Free allocation.'],
    ['origins', 'Does the origin matter?'], ['cost', 'What would it cost at my own price?']]);
  assert.equal((html.match(/>Show as table<\/button>/g) ?? []).length, 8);
  assert.doesNotMatch(text(html), /\babove\b/, 'the views are separate: nothing points "above"');
});
```

- [ ] **Step 4: Port `tests/unit/cbam-graphs-more.test.mjs`.**
  1. Import: remove `plotOrigins`, `plotPhase`, `renderGraphs` from the `cbam-graphs.ts` import and add
     `import { originStrip, phaseColumns, renderWhy } from '../../src/scripts/cbam-ui/tiles-why.ts';`
  2. Port exactly these (all others unchanged):

| Test (by name) | Old | Ported |
|---|---|---|
| `the phase-out is the pack's legislated schedule; only the years the engine computes are solid` | `const svg = plotPhase(phase, 600).svg;` | `const svg = phaseColumns(phase);` (the four assertions on `svg` are unchanged) |
| `SWEEP, origins: on EVERY good and route, …` | `!plotOrigins(o, 600, 'IN').svg.includes(\`data-shared="${modal}"\`)` | `!originStrip(o).includes(\`data-shared="${modal}"\`)` |
| `origins, audit reproductions: …` | `const fmSvg = plotOrigins(fm, 600, 'IN').svg;` | `const fmSvg = originStrip(fm);` |
| same test | `assert.match(fmSvg, /208\.5 <tspan[^>]*>[^<]+<\/tspan>/);` | `assert.match(fmSvg, /208\.5<small>[^<]+<\/small>/);` |
| same test | `assert.doesNotMatch(fmSvg, /<tspan[^>]*>Angola<\/tspan>/);` | `assert.doesNotMatch(fmSvg, /<small>Angola<\/small>/);` |
| `origins, worked: …` | `plotOrigins(cement, 600, 'IN').svg`, `plotOrigins(flat, 600, 'IN').svg` | `originStrip(cement)`, `originStrip(flat)` |
| `origins: the others when the shared figure is the HIGHEST, …` | `plotOrigins(top, 600, 'IN').svg` | `originStrip(top)` |
| `the section carries the three new cards, and the origins card waits to be filled` | `renderGraphs(m, …)` and `['steps', 'cascade', 'share', 'markup', 'charged', 'cost', 'phase', 'origins']` | `renderWhy(m, …)` and `['steps', 'cascade', 'share', 'charged', 'markup', 'phase', 'origins', 'cost']` |

  3. Add after `'origins, worked: …'`:

```js
test('the origin strip is zero-based: each dot sits at its value over the highest, and the own origin is marked', () => {
  const tube = originsModel(pack, line());
  const html = originStrip(tube);
  const dots = [...html.matchAll(/data-v="([^"]+)" data-country="([^"]+)" style="left:calc\(14px \+ \(100% - 28px\) \* ([0-9.]+)\)"/g)];
  assert.equal(dots.length, 27);
  const top = new D(tube.rows[tube.rows.length - 1].certificates);
  for (const [, v, , at] of dots) assert.equal(at, new D(v).div(top).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4));
  assert.equal((html.match(/class="cg-m b-me"/g) ?? []).length, 1, 'India, the line\'s own origin');
  assert.match(text(html), /^13\.0 United States → 762\.1 Indonesia India 329\.8/);
});

test('the phase columns: a column\'s height is the share retained, solid only where this line is computed', () => {
  const html = phaseColumns(phaseModel(pack, modelOf(line())));
  assert.deepEqual([...html.matchAll(/<b style="height:([0-9.]+)%"><\/b>/g)].map((x) => x[1]), ['97.5', '95', '90', '77.5', '51.5', '39', '26.5', '14', '0']);
  assert.equal((html.match(/class="cg-m b-ph b-ph-on"/g) ?? []).length, 3);
});
```

- [ ] **Step 5: Run.**

```bash
node --import tsx --test tests/unit/cbam-graphs.test.mjs tests/unit/cbam-graphs-more.test.mjs 2>&1 | grep -E "^# (pass|fail)"
```

Expected: `# fail 0`; 26 + 15 = 41 tests. If an assertion fails, fix `tiles-why.ts`, not the test; only the ports above are permitted edits.

- [ ] **Step 6: Commit.**

```bash
git add -- src/scripts/cbam-graphs.ts src/scripts/cbam-ui/tiles-why.ts tests/unit/cbam-graphs.test.mjs tests/unit/cbam-graphs-more.test.mjs
git commit -m "feat(cbam): Why it changes tiles (tiles-why.ts); the graphs' unit tests ported onto them"
```

---
### Task 7: Wire Why, style it, port its e2e, retire the old graphs renderer (budget 45 min)

**Files:**
- Modify: `src/scripts/cbam-graphs-dom.ts`
- Append: `src/styles/cbam-bento.css`
- Modify: `src/pages/cbam/cbam-calculator.astro` (delete the old graphs rules)
- Modify: `src/scripts/cbam-graphs.ts` (delete the old renderer and SVG plots)
- Modify: `tests/unit/cbam-chart-colours.test.mjs`, `tests/e2e/cbam-lines.spec.ts`

- [ ] **Step 1: `mountGraphs` draws the tiles.** In `src/scripts/cbam-graphs-dom.ts`:
  1. Replace the import block and the three constants under it (from `import type { EstimatorInput …` to `const CARDS = [ … ] as const;`) with:

```ts
import type { EstimatorInput, EstimatorPack } from './cbam-algos/estimator/estimate-from-pack.ts';
import { parseAssumedPrice, type Outlook } from './cbam-outlook.ts';
import {
  chargedLegend, chargedTip, costParts, graphsModel, originCountries, originRow, originsFrom, originsKey, phaseModel,
  secondNote, secondUsable, sentenceCharged,
  type GraphsModel, type GraphsRefusal, type GraphsState, type OriginsModel,
} from './cbam-graphs.ts';
import { originsTileParts, renderWhy, type WhyWidths } from './cbam-ui/tiles-why.ts';

type Widths = WhyWidths;
/** How long one slice of the origins computation may run before it yields. */
const ORIGINS_SLICE_MS = 12;
/** The tiles whose plot is an SVG drawn at a measured pixel width. The HTML plots size themselves. */
const CARDS = ['steps', 'cascade', 'cost'] as const;
```

  2. Replace the body of `estimate()` with:

```ts
    const w = el.clientWidth || 600;
    const pad = w < 420 ? 34 : 44;
    const full = Math.max(220, Math.floor(w - pad));
    // Every SVG plot sits in a full-width tile (b-s4).
    return { steps: full, cascade: full, cost: full };
```

  3. In `fillOrigins`: `const parts = originsParts(o, widths.origins);` → `const parts = originsTileParts(o);`.
  4. In `draw()`: both `renderGraphs(model, state, widths, phase)` → `renderWhy(model, state, widths, phase)`.
  5. Replace the whole `showYear` function with:

```ts
  /**
   * A year switch on the waffle: toggle which cells are lit, then the words around the grid.
   * The cells' counts for every year are on the mark (data-cells), so nothing is redrawn and a
   * focused control is never replaced.
   */
  function showYear(index: number): void {
    if (model === null || typeof model === 'string' || !widths) return;
    state.chargedYear = index;
    const c = card('charged');
    if (!c) return;
    const m = c.querySelector<HTMLElement>('[data-cg="charged-mark"]');
    const cells = (m?.dataset.cells ?? '').split(',').map(Number);
    const lit = cells[index] ?? 0;
    m?.querySelectorAll('i').forEach((cell, k) => cell.classList.toggle('on', k < lit));
    c.querySelectorAll<HTMLButtonElement>('[data-cg-year]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.cgYear) === index)));
    const title = part('charged', 'title'), legend = part('charged', 'legend');
    if (title) title.innerHTML = sentenceCharged(model, index);
    if (legend) legend.innerHTML = chargedLegend(model, index);
    const y = model.years[index];
    if (m) {
      m.dataset.charged = String(lit); m.dataset.v = y.chargedPct ?? ''; m.dataset.tip = chargedTip(y);
      m.setAttribute('aria-label', chargedTip(y).replace(/\n/g, '. '));
      m.parentElement?.setAttribute('aria-label', `${lit} of 100 cells are certificates in ${y.year}.`);
    }
  }
```

  6. In `showTip`, the marks are now HTML as well as SVG. Replace `if (!tip || !(markEl instanceof SVGElement)) return;` with:

```ts
    // Marks are SVG (the cost rows; the D2 charts) or HTML (the bento plots): both carry data-tip.
    if (!tip || !(markEl instanceof SVGElement || markEl instanceof HTMLElement)) return;
```

  **How each `mountGraphs` behaviour survives the new markup (for the task report):**
  - *Tooltips held on screen*: `pointermove`/`focusin` find `.cg-m` with `closest`, which every HTML mark carries; `placeForFocus` uses `getBoundingClientRect`, which HTML marks have; `settleTip` and the scroll/resize re-placement are untouched. The only change is the `instanceof` widening above.
  - *Focus restored across redraws*: `rememberFocus` indexes the focused element among `.cg-m`, `button`, `input`, `.cg-tbl` inside `#cbGraphs`. HTML marks are `.cg-m` with `tabindex="0"`; the year buttons, `#cgSecond` and the tables keep their selectors. Unchanged.
  - *The ResizeObserver ignores a hidden view*: the observer callback, with its `el.clientWidth === 0` early return and its comment, is not touched. Only `estimate()`/`measured()` changed, to the three SVG tiles.
  - *Origins in slices without replacing a focused mark*: `scheduleOrigins` and `slice` are untouched; `fillOrigins` refills only the origins tile's four `data-cg` slots, which the new tile shell keeps (`title`, `plot`, `table`, `cap`). No other tile's marks are replaced.
  - *The same line is not redrawn* (`paint` keyed on `originsKey`): untouched.
  - *`#cbOlPrice` caret*: owned by `paintOutlook` in `cbam-app.ts` (Task 5); `mountGraphs` only receives the price text.

- [ ] **Step 2: Append the Why styles** to the end of `src/styles/cbam-bento.css`:

```css
/* ── Why it changes (cbam-ui/tiles-why.ts → #cbGraphs), spec §5.3 ──────────────────────
   The --cg-* tokens the SVG plots read are mapped onto the bento tokens here and nowhere else.
   Colour law (spec §3): the mark-up is bronze; free allocation and the benchmark are ink; the
   visitor's own price (cost tile) is ink, dashed where none is published. */
.cbx .cg-card{--cg-ink:var(--ink);--cg-muted:var(--ink-2);--cg-faint:var(--ink-3);--cg-hair:var(--line);--cg-well:var(--well);--cg-surface:var(--card);--cg-accent:var(--ink);--cg-warm:var(--bronze-f);--cg-neutral:var(--ink-3);--cg-neutral-2:var(--well-2);--cg-markup:var(--bronze-f);--cg-allocation:var(--ink-2);--cg-benchmark:var(--ink-3);}
.cbx .cg-cost{--cg-markup:var(--ink)}
.cbx .cg-sub{margin:0 0 10px;font-size:12px;color:var(--ink-3)}
.cbx .cg-card .cg-t{margin:0 0 4px;font-size:15px;line-height:1.45;max-width:46ch}
.cbx .cg-card .cg-t b{font-weight:700}
.cbx .cg-plot{margin:12px 0 0;min-width:0}
.cbx .cg-plot svg{display:block;max-width:100%;height:auto;overflow:visible}
.cbx .cg-plot text{fill:var(--cg-muted);font-variant-numeric:tabular-nums}
.cbx .cg-plot .cg-num{fill:var(--cg-ink);font-weight:600}
.cbx .cg-plot .cg-lab,.cbx .cg-plot .cg-faint{fill:var(--cg-faint)}
.cbx .cg-plot .cg-hair{stroke:var(--cg-hair);stroke-width:1;fill:none}
.cbx .cg-plot .cg-halo{display:none}
.cbx .cg-m{outline:none}
.cbx .cg-m:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
.cbx .cg-foot{align-items:flex-end}
.cbx .cg-cap{margin:0;font-size:11.5px;line-height:1.5;color:var(--ink-3)}
.cbx .cg-tbl-btn{flex:none;min-height:2.25rem;padding:0 14px;border:0;border-radius:99px;background:var(--well);cursor:pointer;font:inherit;font-size:12px;font-weight:600;color:var(--ink-2)}
.cbx .cg-tbl-btn[aria-expanded="true"]{background:var(--ink);color:var(--on-ink)}
.cbx .cg-mini{display:flex;gap:4px}
.cbx .cg-mini button{min-height:2.25rem;padding:0 11px;border:0;border-radius:11px;background:transparent;cursor:pointer;font:inherit;font-size:11.5px;font-weight:600;color:var(--ink-2)}
.cbx .cg-mini button[aria-pressed="true"]{background:var(--ink);color:var(--on-ink)}
.cbx :is(.cg-tbl-btn,.cg-mini button,.cg-second input,.cg-tbl):focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.cbx .cg-legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:10px;font-size:12.5px;color:var(--ink-2)}
.cbx .cg-legend span{display:inline-flex;align-items:center;gap:6px}
.cbx .cg-legend b{font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums}
.cbx .cg-legend svg{flex:none}
.cbx .cg-second{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;margin-top:12px;font-size:13px}
.cbx .cg-second input{width:7rem;border:0;border-radius:12px;padding:8px 10px;background:var(--well);color:var(--ink);font:inherit;font-weight:600}
.cbx .cg-second input:disabled{color:var(--ink-3);cursor:not-allowed}
.cbx .cg-second span{flex:1 1 100%;font-size:12px;color:var(--ink-3)}
.cbx .cg-tbl{margin-top:10px;overflow-x:auto;border-top:1px solid var(--line)}
.cbx .cg-tbl.cg-closed{display:none}
.cbx .cg-tbl table{width:100%;min-width:17rem;border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums}
.cbx .cg-tbl th,.cbx .cg-tbl td{padding:8px;text-align:right;font-weight:400;white-space:nowrap;border-bottom:1px solid var(--line)}
.cbx .cg-tbl th:first-child,.cbx .cg-tbl td:first-child{text-align:left}
.cbx .cg-tbl thead th{font-size:11px;font-weight:600;color:var(--ink-3)}
.cbx .cg-tbl caption{caption-side:bottom;text-align:left;padding:6px 8px 0;font-size:11px;color:var(--ink-3)}
.cbx .cg-tip{position:fixed;z-index:60;left:0;top:0;pointer-events:none;max-width:17rem;white-space:pre-line;padding:8px 11px;border-radius:12px;background:var(--ink);color:var(--on-ink);font-size:12px;line-height:1.5;opacity:0;transform:translateY(4px);transition:opacity .18s var(--ease),transform .18s var(--ease)}
.cbx .cg-tip.on{opacity:1;transform:none}
.cbx .cg-none{margin:0;font-size:14px;line-height:1.6;color:var(--ink-2)}
.cbx .cg-retry{margin-left:10px;min-height:2.25rem;padding:0 14px;border:0;border-radius:99px;background:var(--well);cursor:pointer;font:inherit;font-size:12px;font-weight:600;color:var(--ink)}
.cbx .cg-retry:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
/* the HTML plots: zero-based, lengths are quantities */
.cbx .b-waffle{display:grid;grid-template-columns:repeat(10,1fr);gap:5px;width:190px}
.cbx .b-waffle i{aspect-ratio:1;border-radius:50%;background:color-mix(in oklab,var(--ink) 14%,transparent)}
.cbx .b-waffle i.on{background:var(--ink)}
.cbx .b-mcols{display:grid;grid-template-columns:repeat(var(--n,3),minmax(0,1fr));gap:14px;align-items:end;height:250px;margin:6px 0 4px}
.cbx .b-mc{display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;min-width:0}
.cbx .b-mc-top{margin-bottom:6px;font-size:20px;letter-spacing:-.03em}
.cbx .b-mc-bar{display:flex;flex-direction:column;width:44%}
.cbx .b-mc-bar>b,.cbx .b-mc-bar>i{display:block;flex-basis:0;min-height:0}
.cbx .b-mc-bar>b{position:relative;background:var(--bronze-f);border-radius:8px 8px 0 0}
.cbx .b-mc-bar>b em{position:absolute;right:calc(100% + 6px);top:0;font-style:normal;font-size:12px;font-weight:700;color:var(--ink);white-space:nowrap}
.cbx .b-mc-bar>i{background:var(--well-2);border-radius:0 0 8px 8px}
.cbx .b-mc-bar>i:only-child{border-radius:8px}
.cbx .b-mc-y{margin-top:8px;font-size:13px;font-weight:600}
.cbx .b-phase{display:grid;grid-template-columns:repeat(var(--n,9),minmax(0,1fr));gap:6px;height:200px;margin:6px 0 4px}
.cbx .b-ph{display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;min-width:0}
.cbx .b-ph-bar{flex:1;width:100%;display:flex;align-items:flex-end}
.cbx .b-ph-bar b{width:100%;border-radius:8px;background:color-mix(in oklab,var(--ink) 18%,transparent)}
.cbx .b-ph-on .b-ph-bar b{background:var(--ink)}
.cbx .b-ph span.num{font-size:10.5px;font-weight:600}
.cbx .b-ph em{font-style:normal;font-size:10.5px;color:var(--ink-3)}
.cbx .b-orig-big{display:flex;flex-wrap:wrap;align-items:baseline;gap:18px;margin:14px 0 8px;font-size:clamp(36px,5vw,64px);letter-spacing:-.05em;line-height:1}
.cbx .b-orig-big small{display:block;margin-top:4px;font-size:12px;letter-spacing:0;color:var(--ink-3)}
.cbx .b-arrow{color:var(--ink-3)}
.cbx .b-me-big{margin-left:auto;padding:6px 12px;border-radius:99px;background:var(--ink);color:var(--on-ink);font-size:16px;font-weight:600;letter-spacing:0}
.cbx .b-strip{position:relative;height:44px;margin:12px 6px;border-radius:22px;background:var(--well)}
.cbx .b-strip:has(.b-strip-band){margin-bottom:32px}
.cbx .b-strip i{position:absolute;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:color-mix(in oklab,var(--ink) 40%,transparent)}
.cbx .b-strip i.b-me{z-index:1;width:22px;height:22px;margin:-11px 0 0 -11px;background:var(--ink);box-shadow:0 0 0 4px var(--card)}
.cbx .b-strip-band{position:absolute;top:calc(100% + 6px);transform:translateX(-50%);font-size:11.5px;font-weight:600;color:var(--ink-2);white-space:nowrap}
@media (prefers-reduced-motion:reduce){.cbx .cg-tip{transition:none}}
/* ON PAPER THE GRAPHS BECOME THEIR TABLES: each tile's sentence, caption and table in black on white. */
@media print{
  .cbx .cg-card{--cg-ink:black;--cg-muted:black;--cg-faint:rgb(51 51 51);--cg-hair:rgb(153 153 153);background:white!important;color:black!important;box-shadow:none!important;border:1px solid rgb(153 153 153);border-radius:0;break-inside:avoid}
  .cbx .cg-card :is(.cg-t,.b-t-ti,.cg-big,.cg-cap){color:black!important}
  .cbx :is(.cg-plot,.cg-mini,.cg-second,.cg-legend,.cg-tbl-btn,.cg-tip,.cg-sub){display:none!important}
  .cbx .cg-tbl,.cbx .cg-tbl.cg-closed{display:block!important}
  .cbx .cg-board{display:block}
  .cbx .cg-card+.cg-card{margin-top:8pt}
}
/* ── end Why it changes */
```

- [ ] **Step 3: Retire the old graphs CSS.** In `src/pages/cbam/cbam-calculator.astro`, delete from the line `  /* ── The graphs (cbam-graphs.ts → #cbGraphs) ──…` down to and including the closing `  }` of the `@media print { … }` block that ends immediately before `</style>` (the block whose comment reads "ON PAPER THE GRAPHS BECOME THEIR TABLES"). Do not delete `</style>`. Confirm: `grep -n "\.cg-\|--cg-" src/pages/cbam/cbam-calculator.astro` prints nothing.

- [ ] **Step 4: Delete the old renderer from `src/scripts/cbam-graphs.ts`.** Delete `plotShare`, `plotMarkup`, `plotCharged`, `plotPhase`, `plotOrigins`, `originsParts`, `cardShell`, `legendDot`, `GraphWidths` and `renderGraphs`, each with its doc comment. **Keep** `chargedTip` (it sits under `plotCharged`; move it so it stays), `plotSteps`, `plotCascade`, `cascadeLegend`, `cascadeUnit`, `plotCost`, `costParts`, `chargedLegend`, `secondUsable`, `secondNote`, `tableCost`, `tableCharged`, `scaleFromZero`, `mark`, `wrap`, and every model and sentence function. Then:

```bash
grep -rn "renderGraphs\|plotShare\|plotMarkup\|plotCharged\|plotPhase\|plotOrigins\|originsParts\|cardShell\|GraphWidths" src tests
npm run check
```

Expected: no grep hits; check clean (remove any import that `npm run check` reports unused). Update the file's header comment: "every renderer returns a string" → "the tiles that draw the model are in cbam-ui/tiles-why.ts; the SVG for the cost rows (and, until D2, the step chart and the cascade) is drawn here".

- [ ] **Step 5: Port the chart-colours pin.** In `tests/unit/cbam-chart-colours.test.mjs`, replace the whole body of `test('the calculator page draws the graphs in these tokens and names no chart colour of its own', …)` (keep its name) with:

```js
  // The graphs moved into bento tiles (spec §5.3). Their --cg-* tokens are mapped onto the bento
  // tokens in cbam-bento.css, under the colour law (spec §3): bronze only for the mark-up; free
  // allocation, the benchmark and the visitor's own price in ink. None is a colour of its own.
  const css = readFileSync(fileURLToPath(new URL('../../src/styles/cbam-bento.css', import.meta.url)), 'utf8');
  const start = css.indexOf('/* ── Why it changes'), end = css.indexOf('/* ── end Why it changes */');
  assert.ok(start >= 0 && end > start, 'the Why section is marked in cbam-bento.css');
  const why = css.slice(start, end);
  assert.match(why, /--cg-markup:var\(--bronze-f\);--cg-allocation:var\(--ink-2\);--cg-benchmark:var\(--ink-3\);/);
  assert.match(why, /\.cbx \.cg-cost\{--cg-markup:var\(--ink\)\}/);
  assert.deepEqual(why.match(/--cg-[a-z0-9-]+:\s*#[0-9a-fA-F]{3,8}\b/g) ?? [], [], 'every --cg-* token is a design token');
  for (const f of ['../../src/scripts/cbam-graphs.ts', '../../src/scripts/cbam-ui/tiles-why.ts']) {
    const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
    assert.deepEqual(src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], [], `${f} must use the tokens only`);
  }
```

Tests 1–4 of that file are unchanged: they still hold the four `--color-chart-*` values in `global.css` to the contrast and colour-vision checks. Note for the review (Task 9, R3): the calculator no longer draws with those four tokens.

- [ ] **Step 6: Port the graphs' e2e.** In `tests/e2e/cbam-lines.spec.ts`, inside `test.describe('CBAM estimate — the graphs', …)`, make exactly these edits; every other line of the 7 tests stays:

  - `'the previewed line is drawn: five cards, one price control, exact values on focus'`: replace the `toHaveText([…])` array of `.cg-t` with the new tile order:

```ts
    await expect(g.locator('.cg-t')).toHaveText([
      'The same 100 t needs 29.6% more certificates in 2028 than in 2026.',
      'Of the 97.6 extra certificates by 2028, 86.4 come from the mark-up on default values. The benchmark does not change for route (C).',
      'of the rise to 2028 is the mark-up on default values. It no longer applies with verified data.',
      'In 2028, certificates cover 76 of every 100 tonnes of emissions counted. Free allocation covers the other 24.',
      'On default values the mark-up adds 129.6 certificates in 2028. It no longer applies with verified data.',
      'Free allocation retained falls to zero in 2034. The steepest single step is 2030.',
      // Filled after the other cards, in idle time: one engine call per origin.
      'On default values, 2026 certificates for this good run from 13.0 (United States) to 762.1 (Indonesia). India is at 329.8.',
      'No certificate price is published for imports in 2027-Q1 or 2028-Q1. Type your own price in Three years to see a cost.',
    ]);
```

  - `'states: refused, verified, floored, past the corpus, and a document with lines'`: replace
    `await expect(g.locator('[data-cg-card="markup"] svg rect[rx]')).toHaveCount(0);`
    with
    `await expect(g.locator('[data-cg-card="markup"] .b-mc-mk')).toHaveCount(0);`
  - `'320 px, axe, and paper: …'`: replace the "Every plot fits inside its card" block's locator `g.locator('.cg-plot svg')` with `g.locator('.cg-plot > *')` (the plots are SVG or HTML now; the check covers both).

  How the other graphs tests survive, for the task report:

| Test | What it reads | Why it holds |
|---|---|---|
| `if the graphs' script cannot be loaded the page says so, and tries again` | route on `cbam-graphs-dom*.js`, `.cg-none`, Try again, `.cg-card` ×8, first `.cg-t` | file name unchanged; `graphsFailed` untouched except Task 2's copy; steps is still the first tile |
| `origins where most share one figure: …` | origins `.cg-t`, `[data-shared="79"]` text, `.cg-m` ×96 | `originStrip` marks every origin and labels the band "79 origins at 694.0" |
| `origins follow the mass: …` | `.cg-t`, `[data-country="IN"]` `data-v`, the tile's one `table` | same attributes on the strip dots; one table per tile |
| `origins: going back to a remembered line while another is still computing …` | `.cg-t` over time | `scheduleOrigins` untouched |
| `the previewed line is drawn: …` | the order above, `data-computable`, `data-country`, `.cg-big`, steps `data-v`, no round marks on steps/cost, tooltip, `expectTipsOnScreen`, `#cgTbl-markup`, `[data-cg-year]`, `data-charged`, `[data-xlo]`, `[data-cg="published"]`, `#cgSecond` | all hooks are on the tiles; the waffle and markup marks are HTML and tooltipped (step 1.6) |
| `states: …` | `.cg-none` text (Task 2/6 copy), no `svg` when refused, verified/floored sentences, `.cg-big`, `data-charged` 0 | refusal renders no SVG; sentences are cbam-graphs.ts's |
| `320 px, axe, and paper: …` | no page overflow, `expectTipsOnScreen`, fit, axe, print | print rules ported in step 2 with `!important` over `.b-hero` |

- [ ] **Step 7: Gate.**

```bash
npm run check && npm run build && npm run test:unit 2>&1 | tail -6
npx playwright test tests/e2e/cbam-lines.spec.ts tests/e2e/cbam-shell.spec.ts -g "the graphs|three-year strip|shell|rail" --project=chromium-tier0 --reporter=line
```

Expected: check clean; unit `# fail 0`; Playwright: 7 graphs + 9 strip + the shell spec pass. Fix the code, never the assertions, except the three edits in step 6.

- [ ] **Step 8: Headless screenshots**, as in Task 5 step 7, of `#why` (desktop and phone, dark and light, with and without a price). Compare with `screens/3-why-desktop-dark.jpg` and `3-why-phone-dark.jpg`. Check: share hero legible; waffle switches years; markup labels sit left of their bars and never overlap a numeral; origin strip band label inside the tile.

- [ ] **Step 9: Commit.**

```bash
git add -- src/scripts/cbam-graphs-dom.ts src/styles/cbam-bento.css src/pages/cbam/cbam-calculator.astro src/scripts/cbam-graphs.ts tests/unit/cbam-chart-colours.test.mjs tests/e2e/cbam-lines.spec.ts
git commit -m "feat(cbam): Why it changes view as bento tiles; old graphs renderer and CSS retired"
```

---

### Task 8 (D2, SKIPPABLE): cut the year-step chart and the dot cascade (budget 40 min)

> **Run this task only if the founder has said "cut" or has not answered (the spec's default, §11 D2).** If he says **keep**, skip it entirely: Tasks 6–7 already draw both charts as bento tiles, and nothing else in this plan depends on this task. Record the decision in the PR description either way.

Their facts survive elsewhere (spec §5.3): the year-by-year counts and rises are the Three years plates; the split of the rise is the Three years "Why it rises." tile and the Mark-up share tile. Every test that pinned only the deleted functions is listed below with where its fact now lives. **One claim has no new home**: the cascade's sentence named the largest cause in words. The Three years legend lists all three parts with their values, so the largest is visible, but no sentence states it (open question Q2).

**Files:**
- Modify: `src/scripts/cbam-ui/tiles-why.ts`, `src/scripts/cbam-graphs-dom.ts`, `src/scripts/cbam-graphs.ts`
- Modify: `tests/unit/cbam-graphs.test.mjs`, `tests/unit/cbam-graphs-more.test.mjs`, `tests/e2e/cbam-lines.spec.ts`

- [ ] **Step 1: Port the tests first (they fail until step 2).**

**`tests/unit/cbam-graphs.test.mjs`:**

| Test (by name) | Action | Where its fact lives now |
|---|---|---|
| `the year-by-year sentence never contradicts the line: a rise, no change, a fall, a tiny change, a zero start` | delete | The rises are the plates' `+x% on 2026`, pinned by `every number on the strip is one of the view's numbers…` (cbam-outlook.test.mjs); the zero start (no percentage) by `the view holds one details, … ` and `free allocation above the emissions counted…`. **Not carried:** the "a tiny change is never printed as 0.0%" guarantee; see R1. |
| `the stepped line: heights proportional to the counts, three exact values on the marks` | delete | The three exact counts are on the markup columns' `data-certificates` (e2e below) and the plates' `.cb-ol-n` |
| `NO ROUNDED MARK on the stepped line or the cost rows: no circle, no radius above 1, no round end` | rename to `NO ROUNDED MARK on the cost rows: no circle, no radius above 1, no round end`; set `const pieces = [plotCost(TUBE, 420, []).svg, plotCost(TUBE, 420, ['80']).svg, plotCost(TUBE, 260, ['60', '100']).svg];` | every assertion on the cost rows unchanged |
| `the section: eight cards, each with a sentence, a table and a text alternative` | rename `…: six cards, …`; order `['share', 'charged', 'markup', 'phase', 'origins', 'cost']`; text alternatives `5`; `cg-tbl cg-closed` `6`; `<p class="b-lead cg-t"` `6`; marks `15` (comment: "the share bar + 3 mark-up columns + the waffle + the published cost + 9 phase years") | — |
| `refused and reduced states say so in words and draw nothing false` | delete the one line `assert.match(floored, /The same 100 t needs the same certificates in 2028 as in 2026\./);` | the floored plates carry no rise: `assert.doesNotMatch(floor, /cb-ol-d"/)` in `the view holds one details, …` |
| `every Why tile: a full-stop or question title, …` | drop `['steps', …]` and `['cascade', …]` from the expected titles; `Show as table` count `6` | — |

Remove `plotSteps` and `sentenceSteps` from the file's import.

**`tests/unit/cbam-graphs-more.test.mjs`:**

| Test (by name) | Action |
|---|---|
| `SWEEP, why it rises: the sentence names the largest cause, says when the benchmark adds nothing, and never splits what is not split` | **replace** with the sweep below, which holds the same claims against the Three years tile, except the largest-cause sentence |
| `why it rises, worked: welded tube and iron powder` | delete; the worked parts (86.4, 11.1825, 0; 50.8, 10.95, 14.58) are pinned by `welded tube 73063077…`, `a good whose benchmark steps down…` and `outlookWhy: …` in cbam-outlook.test.mjs |
| `H2: cascadeUnit keeps 52 dots or fewer for ANY finite size, not just up to 1e7 units` | delete with `cascadeUnit` (the attack surface it guarded is gone) |
| `H2: an absurd mass draws a bounded chart, quickly` | **replace** with the bound below on the whole Why render |
| `the section carries the three new cards, and the origins card waits to be filled` | order `['share', 'charged', 'markup', 'phase', 'origins', 'cost']` |

The replacement sweep (add `outlookWhy` to the `cbam-outlook.ts` import, and `import { renderYearsWhy } from '../../src/scripts/cbam-ui/tiles-years.ts';`; remove `cascadeUnit`, `plotCascade`, `sentenceCascade` and the now-unused `CAUSE_WORDS`):

```js
test('SWEEP, why it rises (moved from the cascade, D2): the benchmark is said not to change exactly when its part is zero, in its own scope, and a zero part draws no segment', () => {
  let lines = 0, split = 0, withheld = 0, benchZero = 0, benchNonZero = 0; const wrong = [];
  for (const [cn, route] of goodsAndRoutes()) {
    const inputs = [line({ cn, route })];
    const probe = estimateFromPack(pack, line({ cn, route, verified: { directTco2ePerT: '1000' } }));
    if (probe.status === 'cscf_pending') {
      const perTonne = new D(probe.scenario.faaTco2e).div(100);
      for (const f of ['0.5', '1.004', '2']) inputs.push(line({ cn, route, verified: { directTco2ePerT: perTonne.times(f).toDecimalPlaces(6).toFixed() } }));
    }
    for (const input of inputs) {
      const view = outlook(pack, input);
      if (!view) continue;
      lines += 1;
      const where = `${cn}/${route} ${input.verified ? `verified ${input.verified.directTco2ePerT}` : 'defaults'}`;
      const why = outlookWhy(view);
      if (why.kind !== 'split') {
        withheld += 1;
        if (view.split !== null) wrong.push(`${where}: a split exists and the tile withholds it`);
        continue;
      }
      split += 1;
      const bench = why.rows.find((r) => r.key === 'benchmark');
      const zero = new D(view.split.benchmarkPart).isZero();
      if (zero) benchZero += 1; else benchNonZero += 1;
      const saysFlat = /does not change/.test(bench.title);
      if (saysFlat !== zero) wrong.push(`${where}: benchmark part ${view.split.benchmarkPart}, title "${bench.title}"`);
      const first = view.years[0];
      const bm = first.benchmarks.length === 1 ? first.benchmarks[0] : null;
      const scope = bm && bm.route ? `for route ${bm.route}` : 'for this good';
      if (saysFlat && bm && !bench.title.includes(`Benchmark ${scope} does not change`)) wrong.push(`${where}: scope should be "${scope}": "${bench.title}"`);
      const html = renderYearsWhy(view);
      for (const [key, cls] of [['markup', 'cb-ol-s1'], ['factor', 'cb-ol-s2'], ['benchmark', 'cb-ol-s3']]) {
        const row = why.rows.find((r) => r.key === key);
        const drawn = html.includes(`${cls}" style="flex-grow`);
        if (drawn !== (!!row && !new D(row.value).isZero())) wrong.push(`${where}: ${key} drawn=${drawn}, part=${row?.value}`);
      }
    }
  }
  assert.ok(lines > 3000, `only ${lines} lines`);
  assert.ok(split > 1000 && withheld > 100 && benchZero > 100 && benchNonZero > 100,
    `the sweep must reach every kind: split ${split}, withheld ${withheld}, benchmark flat ${benchZero}, benchmark steps ${benchNonZero}`);
  assert.equal(wrong.length, 0, `${wrong.length} contradictions, e.g.\n${wrong.slice(0, 6).join('\n')}`);
});
```

The replacement bound (add `renderWhy` and `phaseModel` to the imports if not present):

```js
test('H2 (moved, D2): an absurd mass renders the whole Why view, bounded and quickly', () => {
  for (const massT of ['1e10', '1e15', '1e400']) {
    const t0 = Date.now();
    const m = modelOf(line({ massT }));
    if (!m || typeof m === 'string') continue;
    const html = renderWhy(m, { chargedYear: null, priceText: '', secondText: '', open: {} }, { cost: 600 }, phaseModel(pack, m));
    assert.ok(Date.now() - t0 < 2000, `${massT}: took ${Date.now() - t0} ms`);
    assert.ok(html.length < 200_000, `${massT}: ${html.length} bytes`);
    assert.equal((html.match(/<i( class="on")?><\/i>/g) ?? []).length, 100, `${massT}: the waffle is always 100 cells`);
  }
});
```

**`tests/e2e/cbam-lines.spec.ts`** (describe `CBAM estimate — the graphs`; no e2e test is deleted):

| Test | Old | New |
|---|---|---|
| `if the graphs' script cannot be loaded …` | `await expect(g.locator('.cg-card')).toHaveCount(8);` | `…toHaveCount(6);` |
| same | `await expect(g.locator('.cg-t').first()).toHaveText('The same 200 t needs 29.6% more certificates in 2028 than in 2026.');` | `await expect(g.locator('[data-cg-card="markup"] .cg-t')).toHaveText('On default values the mark-up adds 259.2 certificates in 2028. It no longer applies with verified data.');` |
| `the previewed line is drawn: …` | `.cg-card` `8`; the `.cg-t` array | `6`; the array without its first two entries |
| same | `await expect(g.locator('[data-cg-card="cascade"] .cg-legend')).not.toContainText('benchmark');` | delete; moved: the strip test asserts the benchmark row reads `0.0` and the bar's aria-label `Benchmark 0.0`, and the replacement sweep pins "a zero part draws no segment" |
| same | `const steps = g.locator('[data-cg-card="steps"] .cg-m');` and `expect(await steps.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.v))).toEqual([…])` | `const cols = g.locator('[data-cg-card="markup"] .cg-m');` and `expect(await cols.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.certificates))).toEqual(['329.8275', '376.755', '427.41']);` |
| same | `for (const id of ['steps', 'cost'])` | `for (const id of ['cost'])` |
| same | `await steps.nth(1).focus();` then the two tip assertions | `await cols.nth(1).focus();` then `await expect(g.locator('.cg-tip')).toContainText('2027: mark-up 20% adds 86.4');` and `await expect(g.locator('.cg-tip')).toContainText('as priced: 376.755');` and, for the moved price fact, `await expect(g.locator('[data-cg-card="cost"] .cg-cap')).toContainText('Certificate price for imports in 2027-Q1 and 2028-Q1: none published · as at 14 Oct 2026.');` |
| same | `await expect(g.locator('.cg-t').first()).toHaveText('The same 200 t needs 29.6% more certificates in 2028 than in 2026.');` | `await expect(g.locator('[data-cg-card="markup"] .cg-t')).toContainText('adds 259.2 certificates in 2028');` |
| `states: …` (verified) | the `steps .cg-t` `20.5% more` line, and the two `cascade` lines | `await view(page, 'three-years'); await expect(page.locator('#cbOutlook .cb-ol-yr').nth(2)).toContainText('+20.5% on 2026'); await view(page, 'why');` (the verified split, 11.2 with no mark-up, is already asserted by the strip's `states` test) |
| `states: …` (floored) | the `steps .cg-t` `the same certificates` line and the `cascade .cg-t` floor line | `await view(page, 'three-years'); await expect(page.locator('#cbOutlook .cb-ol-n')).toHaveText(['0.0', '0.0', '0.0']); await expect(page.locator('#cbOutlook .cb-ol-d')).toHaveCount(0); await expect(page.locator('#cbOutlook .cb-ol-nosplit')).toContainText('the count is held at zero'); await view(page, 'why');` |
| `states: …` (AUDIT 2) | `await expect(g.locator('[data-cg-card="steps"]')).not.toContainText('€');` | `await expect(g).not.toContainText(/75\.36\|75\.28\|24,855\|24,829/);` (all of Why, not one tile) |
| `states: …` (document) | `.cg-card` `8` (twice) | `6` (twice) |
| `320 px, axe, and paper: …` | `for (const id of ['steps', 'share', 'markup', 'charged', 'cost'])` | `for (const id of ['share', 'markup', 'charged', 'cost'])` |

Verify the count did not move: `grep -c "^\s*test(" tests/e2e/cbam-lines.spec.ts` equals the Task 1 baseline.

- [ ] **Step 2: Cut the two tiles.**
  - `src/scripts/cbam-ui/tiles-why.ts`: delete the `steps` and `cascade` constants, the `maxCount` line and the D2 comment above them; remove `${steps}${cascade}` from the returned string; remove `CAUSES, causeLabel, causePart, cascadeLegend, cascadeUnit, eur, plotCascade, plotSteps, sentenceCascade, sentenceSteps, wrap` from the import if now unused (`npm run check` says which); change `export type WhyWidths = Record<'steps' | 'cascade' | 'cost', number>;` to `export type WhyWidths = Record<'cost', number>;`.
  - `src/scripts/cbam-graphs-dom.ts`: `const CARDS = ['cost'] as const;` and `return { cost: full };` in `estimate()` (update the comment: "The cost rows are the one SVG plot; it sits in a full-width tile").
  - `src/scripts/cbam-graphs.ts`: delete `sentenceSteps`, `massText`, `plotSteps`, `CauseKey`, `CAUSES`, `causePart`, `causeWords`, `causeLabel`, `sentenceCascade`, `apportion`, `causeDot`, `cascadeUnit`, `plotCascade`, `cascadeLegend`, and remove `CAUSES, causeLabel, causePart` from the shared export list. **Keep** the model fields `stepRise` and `causes` (spec §7: models stay). Update the header comment's count of cards.

```bash
grep -rn "plotSteps\|plotCascade\|sentenceSteps\|sentenceCascade\|cascadeUnit\|cascadeLegend\|causeLabel\|causeDot" src tests
```

Expected: no hits.

- [ ] **Step 3: Gate.**

```bash
npm run check && npm run build && npm run test:unit 2>&1 | tail -6
npx playwright test tests/e2e/cbam-lines.spec.ts -g "the graphs|three-year strip" --project=chromium-tier0 --reporter=line
```

Expected: clean; `# fail 0`; 16 passed.

- [ ] **Step 4: Commit.**

```bash
git add -- src/scripts/cbam-ui/tiles-why.ts src/scripts/cbam-graphs-dom.ts src/scripts/cbam-graphs.ts tests/unit/cbam-graphs.test.mjs tests/unit/cbam-graphs-more.test.mjs tests/e2e/cbam-lines.spec.ts
git commit -m "feat(cbam): D2 — cut the year-step chart and the dot cascade from Why; their facts live in Three years"
```

---

### Task 9: Gate, other engines, review, PR (budget 40 min)

- [ ] **Step 1: The local gate.**

```bash
npm run check && npm run build && npm run test:unit 2>&1 | tail -6
grep -c "^\s*test(" tests/e2e/cbam-lines.spec.ts
grep -c "^test(" tests/unit/cbam-outlook.test.mjs tests/unit/cbam-graphs.test.mjs tests/unit/cbam-graphs-more.test.mjs tests/unit/cbam-chart-colours.test.mjs
```

Expected: clean; `# fail 0`; e2e count equals the Task 1 baseline; unit counts **30, 26, 15, 5** with D2 kept, or **30, 24, 13, 5** with D2 cut. (Arithmetic: outlook 27 + `outlookWhy` + 2 plate tests; graphs 23 + 1 "above" + 2 tiles, then −2 for D2; graphs-more 13 + 2, then −2 for D2; chart colours unchanged.)

- [ ] **Step 2: The other CBAM engines, once, foreground.**

```bash
npx playwright test tests/e2e/cbam-lines.spec.ts tests/e2e/cbam-shell.spec.ts --project=firefox-cbam --reporter=line
npx playwright test tests/e2e/cbam-lines.spec.ts tests/e2e/cbam-shell.spec.ts --project=webkit-cbam --reporter=line
```

Expected: pass. Firefox has failed on focus-while-redrawing before (the ResizeObserver comment): if a tooltip or focus test flakes, run it 5 times with `--repeat-each=5` and report the count; do not add retries.

- [ ] **Step 3: Screens.** Re-take the Task 5 and Task 7 screenshots after any fix, plus the refused tube line `(D)` on Three years and Why, the floored verified line (`1.0`), and nitric acid (28080000, 1% mark-up). 1440, 1280 and 390 px. Look at each.

- [ ] **Step 4: Opus review.** Dispatch an Opus 5.5 reviewer with this plan, spec §5.2, §5.3, §6 and §11, and `git diff feat/cbam-rail-ui...HEAD`. Ask it to check:
  - every assertion edit in the diff is one of the edits this plan lists, and none is looser than the original (`git diff -U0 -- tests/` line by line);
  - the M2 rule: `grep -rn "Q[1-4]" src/scripts/cbam-ui/tiles-*.ts src/scripts/cbam-graphs.ts src/scripts/cbam-outlook.ts` — every quarter in a rendered string follows "imports in";
  - the colour law: bronze only on mark-up marks (`b-sp-bz`, `b-mc-mk`, `b-d10.b-bz`, `--cg-markup` outside `.cg-cost`);
  - every state each model returns is rendered (refused years, withheld floor/tier-changes, no price published, verified, verified-direct + electricity default, floored, past the corpus → empty container, one-or-two origins, flat origins);
  - the "Decisions this plan makes" list and the risks below.

  Fix what it confirms.

- [ ] **Step 5: Push and open the PR into the integration branch — only on the user's word.**

```bash
git log --oneline feat/cbam-rail-ui..HEAD
git push -u origin feat/cbam-rail-ui-p3
```

PR: base `feat/cbam-rail-ui`, title "CBAM Calculator rail redesign (phase 3 of 5: Three years and Why it changes)". The description states D2's outcome (cut or kept) and lists Q1–Q3 and R1–R4.

---

## Open questions and risks (carry into the PR description)

| # | Kind | Item |
|---|---|---|
| Q1 | founder | "Why it rises" when a year is refused: this plan renders no tile (today's behaviour; each plate carries the engine's reason). Spec §5.2 lists "refused" among the tile's withheld states; if the founder wants a tile there, it needs new copy, which the spec forbids inventing without his word. |
| Q2 | founder (D2) | If the cascade is cut, no sentence names the largest cause of the rise any more; the Three years legend shows all three parts with values. |
| Q3 | founder | Copy changed for honesty: "Why it rises." + "Of 97.6 extra certificates by 2028." (was one heading); "in Three years" replaces "above" in four sentences; the cost tile keeps its SVG rows rather than the preview's text-only rows; the markup caption names bronze. |
| R1 | risk, pre-existing | A plate prints `0.0% on 2026` for a real rise under 0.05%, through `signedPct`. The step chart's sentence avoided this ("0.08 more certificates"). With D2 cut, no sentence covers it. Not changed in this phase (no engine or strip-model change); worth a follow-up. |
| R2 | risk | `cbam-bento.css` primitives come from phase 2. If phase 2 named or scoped any differently from `preview/bento.css`, Tasks 5 and 7 must adapt the selectors, not invent primitives (Task 1 step 3 stops the run if they are missing). |
| R3 | risk | `cbam-chart-colours.test.mjs` tests 1–4 still pass but now guard `--color-chart-*` tokens the calculator no longer draws with; the bento tiles' contrast (bronze-f and ink-3 on `--card`, the hero's on-ink tones) is unchecked until phase 5's contrast pass. The e2e axe runs on Three years and Why will catch text contrast, not graphic contrast. |
| R4 | risk | The origins strip stacks dots that share one value (79 at the same point for hydrogen); every one stays a focusable mark, as before, so a keyboard user tabs through 96 stops. Unchanged from today, but more visible now. |
| R5 | housekeeping | `tests/e2e/zz-tip-probe.spec.ts` is an untracked phase-1 probe expecting 8 cards. Leave it unstaged; the user decides whether to delete it. |

## Self-review against the spec

| Spec | Task |
|---|---|
| §5.2 plates (count, cost or none published, price locator, mark-up step) | 4 (`renderYearPlates`, `plateMarkup`), 5 |
| §5.2 Your own price, `#cbOlPrice` unchanged, "not a forecast and not a published price" | 4 (`renderYears`; note from `renderOutlookPriceNote`), 5 step 2 (caret) |
| §5.2 Why it rises with refused / floor / tier-changes | 3 (`outlookWhy`), 4 (`renderYearsWhy`); refused = no tile (Q1) |
| §5.2 The working, folded, `renderOutlookRows` | 4 |
| §5.3 six tiles and their models | 6 (`shareBar`, `waffle`, `markupColumns`, `phaseColumns`, `originStrip`, `costParts`), 7 |
| §5.3 D2 cut, isolated | 6 (D2 tiles drawn in the shell), 8 (skippable deletion) |
| §5.3 every tile has "Show as table" | 6 (`tile`), tested by "every Why tile …" |
| §6.1 every state rendered | 4, 6; Task 9 step 4 review |
| §6.4 hooks kept beside `b-` classes | 4, 6; e2e ports in 5 and 7 change only text that the layout changed |
| §6.5 tables, `aria-hidden` illustrations, focus | 6 (`fig` alternatives, `aria-hidden` decorations), 7 (focus rings) |
| §7 models stay, renderers replaced; old renderers deleted only after their tests are ported | 3–8 (deletions in 5, 7, 8 follow the ports in 4, 6, 8 step 1) |
| §8 illustrations and entry animation | **Not in phase 3**: phase 5 |
