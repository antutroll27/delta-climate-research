# CBAM "Legislation & updates" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the calculator's "Rules & sources" view to "Legislation & updates" and add an Updates tile listing dated law, data and correction entries.

**Architecture:** One hand-kept typed JSON file (`src/scripts/cbam-ui/updates.json`) holds law and correction entries. A pure function `renderUpdates(entries, prices, sources)` in `tiles-rules.ts` merges them with rows derived from the pack's published prices, and returns escaped HTML. `cbam-app.ts` renders it once at start with no prices, so the law entries show before the pack loads, and again when the pack loads. Spec: `docs/superpowers/specs/2026-11-04-cbam-legislation-updates-design.md`.

**Tech Stack:** Astro 5, vanilla TS. Unit tests use `node --test` + tsx (`tests/unit/*.test.mjs`); e2e uses Playwright.

**Ground rules:**
- Worktree is `/Volumes/OBOSLab/worktrees/cbam-legis`, branch `feat/cbam-legislation-updates`. `node_modules` is a symlink, so don't reinstall.
- Don't push. Never `git stash`. Never `git add -A` or `.`; stage files by name.
- Never edit the vendored files listed in `src/scripts/cbam-algos/UPSTREAM.json`. `cbam-app.ts` is website-owned and OK to edit.
- Never loosen an existing assertion. Headless browsers only.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

---

### Task 1: The entries file and its schema test

**Files:**
- Create: `src/scripts/cbam-ui/updates.json`
- Create: `src/scripts/cbam-ui/updates.ts`
- Test: `tests/unit/cbam-updates.test.mjs`

- [ ] **Step 1: Write `updates.json`.** Copy the wording exactly, character for character; the founder approves it.

```json
[
  { "date": "2026-11-03", "kind": "correction", "text": "The 50 t exemption is now described as it is in law: all CBAM goods an importer brings in during a calendar year count towards one 50 t, not each good separately.", "source": "https://data.europa.eu/eli/reg/2025/2083/oj" },
  { "date": "2026-11-03", "kind": "correction", "text": "Imports dated 2027 and 2028 are now tested against the 50 t exemption. The calculator had treated it as a 2026-only rule; the law sets no end date.", "source": "https://data.europa.eu/eli/reg/2025/2083/oj" },
  { "date": "2026-11-03", "kind": "correction", "text": "The fallback default value for origins without their own figure is now described correctly: it is set from the ten exporting countries with the highest emission intensities, not a world average.", "source": "https://data.europa.eu/eli/reg_impl/2025/2621/oj" },
  { "date": "2026-11-03", "kind": "correction", "text": "The certificate price is now described as quarterly for 2026 and weekly from 2027." },
  { "date": "2026-10-14", "kind": "data", "text": "Imports dated 2027 and 2028 now count certificates. No price is published for those years yet, so no euro figure is shown." },
  { "date": "2026-07-31", "kind": "law", "text": "Implementing Regulation (EU) 2026/1740 corrects the default values in Implementing Regulation (EU) 2025/2621, applying from 1 January 2026.", "source": "https://data.europa.eu/eli/reg_impl/2026/1740/oj" },
  { "date": "2025-12-31", "kind": "law", "text": "Implementing Regulation (EU) 2025/2621 sets the default emission values for the definitive period.", "source": "https://data.europa.eu/eli/reg_impl/2025/2621/oj" },
  { "date": "2025-12-22", "kind": "law", "text": "Implementing Regulation (EU) 2025/2620 sets the benchmarks used to deduct free allocation from certificates.", "source": "https://data.europa.eu/eli/reg_impl/2025/2620/oj" },
  { "date": "2025-10-17", "kind": "law", "text": "Regulation (EU) 2025/2083 simplifies CBAM: an annual 50 t exemption per importer, and certificate sales from 1 February 2027.", "source": "https://data.europa.eu/eli/reg/2025/2083/oj" }
]
```

- [ ] **Step 2: Write `updates.ts`, the types and the typed import.**

```ts
// src/scripts/cbam-ui/updates.ts
// The hand-kept half of the Updates tile (spec 2026-11-04): law and our own corrections, one line
// each. Certificate prices are NOT listed here: tiles-rules.ts derives them from the pack, so a
// price can never be dated or valued differently from the one the calculator uses.
import RAW from './updates.json' with { type: 'json' };

export type UpdateKind = 'law' | 'data' | 'correction';
export interface UpdateEntry {
  readonly date: string; // YYYY-MM-DD: the Official Journal date for law, the go-live date for ours
  readonly kind: UpdateKind;
  readonly text: string;
  readonly source?: string;
}

export const UPDATES: readonly UpdateEntry[] = RAW as readonly UpdateEntry[];
```

- [ ] **Step 3: Write the failing schema test** in `tests/unit/cbam-updates.test.mjs`.

```js
// tests/unit/cbam-updates.test.mjs — the Updates tile (spec 2026-11-04-cbam-legislation-updates).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { UPDATES } from '../../src/scripts/cbam-ui/updates.ts';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const pack = JSON.parse(read('../../public/cbam/estimator-pack.json'));

test('updates.json: every entry is dated, kinded, one sentence, and links only over https', () => {
  assert.ok(UPDATES.length > 0);
  for (const e of UPDATES) {
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, e.text);
    assert.equal(new Date(`${e.date}T00:00:00Z`).toISOString().slice(0, 10), e.date, `real date: ${e.date}`);
    assert.ok(['law', 'data', 'correction'].includes(e.kind), e.kind);
    assert.match(e.text, /\.$/, `ends with a full stop: ${e.text}`);
    assert.doesNotMatch(e.text, /world[- ]average/i);
    if (e.source !== undefined) assert.match(e.source, /^https:\/\//, e.source);
  }
});

test('updates.json: certificate prices are never hand-kept (they come from the pack)', () => {
  for (const e of UPDATES) assert.doesNotMatch(e.text, /€\s?\d/, e.text);
});
```

- [ ] **Step 4: Run it.** `node --import tsx --test tests/unit/cbam-updates.test.mjs`. Expect PASS once Steps 1–2 exist. If the JSON import attribute fails under tsx, check `src/scripts/climate-engine/accuracy.ts:61`, which uses the same `with { type: 'json' }` form, and match it.

- [ ] **Step 5: Commit** `updates.json`, `updates.ts` and the test: `feat(cbam): hand-kept law and correction entries for the Updates tile`.

### Task 2: `renderUpdates`, merge, order and escape

**Files:**
- Modify: `src/scripts/cbam-ui/tiles-rules.ts` (append)
- Test: `tests/unit/cbam-updates.test.mjs` (append)

- [ ] **Step 1: Append the failing tests.**

```js
import { renderUpdates } from '../../src/scripts/cbam-ui/tiles-rules.ts';

const published = pack.prices.filter((p) => p.status === 'published');

test('renderUpdates: every published pack price becomes exactly one Data row, dated by its publication', () => {
  const html = renderUpdates([], pack.prices, pack.sources);
  for (const p of published) {
    const line = `Certificate price for ${p.quarter} published: €${p.priceEur}.`;
    assert.equal(html.split(line).length - 1, 1, line);
  }
  assert.equal((html.match(/<li/g) ?? []).length, published.length);
});

test('renderUpdates: newest first; same date keeps file order, hand-kept before derived', () => {
  const entries = [
    { date: '2026-10-05', kind: 'law', text: 'A.' },
    { date: '2026-12-01', kind: 'correction', text: 'B.' },
    { date: '2026-10-05', kind: 'correction', text: 'C.' },
  ];
  const html = renderUpdates(entries, published.filter((p) => p.quarter === '2026-Q3'), pack.sources);
  const order = ['B.', 'A.', 'C.', 'Certificate price for 2026-Q3'].map((s) => html.indexOf(s));
  assert.ok(order.every((i) => i >= 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test('renderUpdates: kind chips are Law / Data / Correction; text and links escaped; only https linked', () => {
  const html = renderUpdates([
    { date: '2026-01-01', kind: 'law', text: 'x <b>y</b>.', source: 'https://example.org/a?b=1&c=2' },
    { date: '2026-01-02', kind: 'correction', text: 'z.', source: 'javascript:alert(1)' },
  ], [], pack.sources);
  assert.match(html, />Law</); assert.match(html, />Correction</);
  assert.ok(html.includes('x &lt;b&gt;y&lt;/b&gt;.'));
  assert.ok(html.includes('href="https://example.org/a?b=1&amp;c=2"'));
  assert.ok(!html.includes('javascript:'));
});

test('renderUpdates: before the pack loads, the hand-kept entries still show', () => {
  const html = renderUpdates(UPDATES, [], []);
  for (const e of UPDATES) assert.ok(html.includes(e.text.replace(/&/g, '&amp;')), e.text);
});
```

- [ ] **Step 2: Run it and confirm it fails:** `node --import tsx --test tests/unit/cbam-updates.test.mjs` should report that `renderUpdates` is not exported.

- [ ] **Step 3: Implement.** Append to `tiles-rules.ts` and add `import type { UpdateEntry } from './updates.ts';` at the top. `esc` and `formatPackDate` are already imported there. Before writing this, check that `formatPackDate` accepts a bare `YYYY-MM-DD`; if it needs a full ISO string, pass `${date}T00:00:00.000Z`.

```ts
const KIND_LABEL: Record<UpdateEntry['kind'], string> = { law: 'Law', data: 'Data', correction: 'Correction' };

/** The Updates tile: hand-kept law and corrections, plus one Data row per PUBLISHED pack price
 *  (dated by its publication, linked to its source). Newest first; a date tie keeps file order,
 *  hand-kept rows before derived ones. Only https sources are linked. */
export function renderUpdates(
  entries: readonly UpdateEntry[],
  prices: EstimatorPack['prices'],
  sources: EstimatorPack['sources'],
): string {
  const url = new Map(sources.map((s) => [s.id, s.url]));
  const derived: UpdateEntry[] = prices.filter((p) => p.status === 'published').map((p) => ({
    date: p.publicationDate.slice(0, 10),
    kind: 'data',
    text: `Certificate price for ${p.quarter} published: €${p.priceEur}.`,
    source: url.get(p.sourceId)?.replace(/^http:\/\//i, 'https://'),
  }));
  const rows = [...entries, ...derived]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.date.localeCompare(a.e.date) || a.i - b.i)
    .map(({ e }) => {
      const link = e.source && /^https:\/\//i.test(e.source)
        ? ` <a href="${esc(e.source)}" rel="noopener">Source</a>` : '';
      return `<li><div class="row"><span class="num">${esc(formatPackDate(e.date))}</span>`
        + `<span class="chip">${KIND_LABEL[e.kind]}</span></div><p>${esc(e.text)}${link}</p></li>`;
    });
  return `<ol class="b-upd">${rows.join('')}</ol>`;
}
```

Use the real field names from `EstimatorPack['prices']`. They were verified 2026-11-04 from the pack: `quarter`, `priceEur`, `status`, `publicationDate`, `sourceId`. If TS says `publicationDate` is optional, skip rows without it instead of asserting non-null.

- [ ] **Step 4: Run the unit file.** Expect PASS. Then run `npm run check`; expect 0 errors.
- [ ] **Step 5: Commit:** `feat(cbam): renderUpdates merges hand-kept entries with the pack's published prices`.

### Task 3: Rename, tile markup and wiring

**Files:**
- Modify: `src/pages/cbam/cbam-calculator.astro`. Line 59 is the rail label, line 268 the h1, line 364 the phone menu. The new tile goes after the Framing `</section>`, before line 295 (`cbRulesNotYetH`).
- Modify: `src/scripts/cbam-algos/cbam-app.ts`, around line 1641 (element lookups) and line 1763 (pack fill).
- Modify: `src/styles/cbam-bento.css` (append the `.b-upd` rules).
- Modify: the `tests/unit/cbam-rules-view.test.mjs` header comment only, if it names "Rules & sources".

- [ ] **Step 1: Write the failing unit test** (append to `cbam-updates.test.mjs`).

```js
const page = read('../../src/pages/cbam/cbam-calculator.astro').replace(/\s+/g, ' ');

test('the view is named "Legislation & updates" in rail, phone menu and heading; the old name is gone', () => {
  assert.ok(!page.includes('Rules &amp; sources'), 'old visible name');
  assert.equal(page.split('Legislation &amp; updates').length - 1, 3, 'rail + phone menu + h1');
  assert.ok(page.includes('Legislation &amp; updates. <span>What this rests on, and what changed.</span>'));
  assert.ok(page.includes('data-goto="rules"'), 'hash and internal key unchanged');
});

test('the Updates tile sits directly after Framing and has its own container', () => {
  const framing = page.indexOf('id="cbRulesFramingH"');
  const upd = page.indexOf('id="cbRulesUpdH"');
  const notYet = page.indexOf('id="cbRulesNotYetH"');
  assert.ok(framing > 0 && upd > framing && notYet > upd, `${framing} ${upd} ${notYet}`);
  assert.ok(page.includes('id="cbUpdates"'));
});
```

Astro comments (`<!-- -->`) that mention "Rules & sources" are not visible text. Since the first test asserts the escaped form `Rules &amp; sources` is absent, rewrite any such comment to say "Legislation & updates (formerly Rules & sources)" using a plain `&`, not `&amp;`.

- [ ] **Step 2: Run it and confirm it fails.**

- [ ] **Step 3: Implement the markup.**
  - Rail: `<span class="cbx-lbl">Legislation &amp; updates</span>`.
  - Phone menu: `<button type="button" data-goto="rules">Legislation &amp; updates</button>`.
  - h1: `Legislation &amp; updates. <span>What this rests on, and what changed.</span>`
  - New tile, after Framing:

```html
          <section class="b-t b-s2 b-upd-t" aria-labelledby="cbRulesUpdH">
            <div class="b-t-h"><div><h2 id="cbRulesUpdH" class="b-t-ti">Updates.</h2><p class="b-t-sub">Newest first. The law, the data, and our own corrections.</p></div></div>
            <div id="cbUpdates"></div>
          </section>
```

- [ ] **Step 4: Wire it in `cbam-app.ts`.**
  - Add `renderUpdates` to the existing `tiles-rules.ts` import (line 50) and `import { UPDATES } from '../cbam-ui/updates.ts';`.
  - Next to the line-1641 lookups, add `updatesEl = $('cbUpdates')` and render immediately: `if (updatesEl) updatesEl.innerHTML = renderUpdates(UPDATES, [], []);`. Check how `$` returns, and the `if (x)` null-guard style the file already uses.
  - In the pack-fill block (around line 1763): `if (updatesEl) updatesEl.innerHTML = renderUpdates(UPDATES, pack.prices, pack.sources);`.
  - Update the comment `// Rules & sources (spec §5.6, §7)` to `// Legislation & updates (formerly Rules & sources; spec §5.6, §7, and 2026-11-04)`.
  - Then run `grep -c "renderAttestation(" src/scripts/cbam-algos/cbam-app.ts` and the `hasFigure(`/`isAttested(` counts. The pins are renderAttestation ×3, isAttested ×5, and the `renderAttestation\([^()]*hasFigure\(e\)\)` regex ×2. They must not change; you are not touching those lines.

- [ ] **Step 5: CSS.** Append to `cbam-bento.css`, scoped like its neighbours, using existing tokens only (no bronze or cyan):

```css
/* Updates tile (2026-11-04): a dated list, newest first. Chips reuse the Sources .chip look. */
.cbx .b-upd{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:12px}
.cbx .b-upd li{padding-top:12px;border-top:1px solid var(--line)}
.cbx .b-upd li:first-child{padding-top:0;border-top:0}
.cbx .b-upd .row{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:12px;color:var(--ink-3)}
.cbx .b-upd p{margin:6px 0 0;font-size:13px;line-height:1.5;color:var(--ink-2)}
.cbx .b-upd a{color:var(--ink);text-underline-offset:2px}
```

  Check the `.b-srcs .chip` / `.chip` rules in `cbam-bento.css`. If `.chip` is scoped to `.b-srcs` only, widen that selector to `:is(.b-srcs,.b-upd) .chip` rather than duplicating it.

- [ ] **Step 6: Gate the unit tests.** `npm run check`, `npm run typecheck`, `npm run build`, `npm run test:unit`. All must be green.
- [ ] **Step 7: Commit:** `feat(cbam): "Legislation & updates" — the renamed view and its Updates tile`.

### Task 4: E2E and screenshots

**Files:**
- Modify: `tests/e2e/cbam-shell.spec.ts` (append one test)

- [ ] **Step 1: Add the e2e test.** Reuse the file's existing `view(page, …)` helper and its setup.

```ts
  test('Legislation & updates: the new name everywhere, the Updates tile, #rules still works', async ({ page }) => {
    await view(page, 'rules');
    expect(new globalThis.URL(page.url()).hash).toBe('#rules');
    await expect(page.locator('#cbxH-rules')).toContainText('Legislation & updates.');
    await expect(page.locator('.cbx-rail')).toContainText('Legislation & updates');
    await expect(page.locator('body')).not.toContainText('Rules & sources');
    const rows = page.locator('[data-view="rules"] #cbUpdates li');
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(page.locator('[data-view="rules"] #cbUpdates')).toContainText('Regulation (EU) 2025/2083');
  });
```

  If `.cbx-rail` is not the rail's class, grep the page for the `<nav` holding `cbx-nav` buttons and use its real selector.

- [ ] **Step 2: Run the targeted e2e.**
  - Set `export OBOS_E2E_PORT=4394` and confirm it's free with `lsof -iTCP:4394 -sTCP:LISTEN`.
  - Run `npx playwright test --project=chromium-tier0 tests/e2e/cbam-shell.spec.ts tests/e2e/cbam-contrast.spec.ts tests/e2e/cbam-ill.spec.ts`, then the same with `--project=firefox-cbam`.
  - Run in the foreground; macOS has no `timeout`.
  - Contrast covers `rules` in light and dark already. If a contrast failure hits the new tile, fix the CSS, not the test.

- [ ] **Step 3: Screenshots.**
  - Headless, built site on your port, `#rules` at 1440x900: light, dark, and dark after a line is priced (so the pack has loaded and the price rows show). Also dark at 375x812.
  - Save them to `/Volumes/OBOSLab/tmp/legis-<scheme>[-priced|-phone].png`.
- [ ] **Step 4: Commit:** `test(cbam): e2e for the Legislation & updates view`.
