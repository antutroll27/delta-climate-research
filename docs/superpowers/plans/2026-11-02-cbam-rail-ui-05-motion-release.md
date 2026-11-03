# CBAM Calculator redesign, phase 5: illustrations, motion, phone polish, acceptance, audit, release — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task is handed to a Sonnet 5.5 (high) builder **with only that task's text plus the "Environment notes" and "Decisions this plan takes" sections**; Opus 5.5 reviews each task's diff and runs Tasks 10, 12 and the re-audit in 13.

**Goal:** Put the approved illustrations on their tiles, play the approved entry motion on every view entry, fix the phone overlaps, prove accessibility, contrast and 60 fps, have the whole branch audited independently against the honesty rules, and ship `feat/cbam-rail-ui` to `main` on the founder's word.

**Architecture:** One pure module, `src/scripts/cbam-ui/illustrations.ts`, holds every illustration and pictogram SVG string, ported from the reference generator and pinned byte-for-byte by a golden fixture. The tile renderers from phases 2–4 add an illustration with one pure call, `insertIll(html, svg, hostClass)`, only on the branch that renders figures. A second small module, `src/scripts/cbam-ui/motion.ts`, sets the `--i` stagger indices on every render (one `MutationObserver` on the main area) and replays the entry animation when `views.ts` shows a view. All positions and all motion live in one new stylesheet, `src/styles/cbam-ill.css`, which animates transform and opacity only and switches off under reduced motion.

**Tech Stack:** Astro 7 page with a plain `<script>` module, TypeScript, `node --test` through tsx for unit tests, Playwright (+ `@axe-core/playwright`) for e2e. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-02-cbam-rail-ui-design.md` (§4.3, §6, §8, §9, §10, §11). **Roadmap:** `docs/superpowers/plans/2026-11-02-cbam-rail-ui-00-roadmap.md`. **Visual reference:** `docs/superpowers/specs/2026-11-02-cbam-rail-ui/` (README, `screens/`, `preview/bento.css`, `preview/bento.js`, `generator/build_bento.py`).

> **Where the spec and reference live.** On 2 Nov both folders above are **untracked in the main checkout** (`git status` lists them as `??`) and absent from the worktrees. Read them at their absolute paths under `/Volumes/VSTSAMPLES/Projects/Angad/docs/superpowers/`. Task 14 commits them with the release so the PR's links resolve.

> **Environment notes (measured 2 Nov 2026, copied from phase 1 and extended):**
> - macOS has no `timeout` command, so run Playwright **in the foreground** through the Bash tool's own `timeout` parameter (up to 600000 ms). Never run Playwright in the background.
> - The Chromium project is `chromium-tier0`; there is no `chromium`. `firefox-cbam` and `webkit-cbam` only match `cbam-(lines|shell).spec.ts`.
> - `npm run test:unit` must run **after** `npm run build`, because about 59 OBOS and heat-map unit tests read `dist/`.
> - **No browser window ever appears on the founder's screen.** Every project is headless; the perf project (Task 9) uses Chromium's new headless mode on Metal (`headless: false` + `--headless=new`), the same mechanism as the OBOS perf runs, because macOS clamps "off-screen" windows back onto the display.
> - **Local gate:** `npm run check`, `npm run test:unit`, and the targeted specs named in the task. The full Playwright matrix runs in CI.
> - Scratch output goes under `/Volumes/OBOSLab/tmp/cbam-rail-p5/`; durable output (shots, perf JSON) under `/Volumes/OBOSLab/cbam-rail-ui/`. Never `~/` or `/tmp`.
> - Stage named paths only (`git add -- <paths>`), never `git add -A`, never `git stash`.
> - **Grep, never count from memory.** Before claiming "N callers/tests/states", run the grep and list the hits.
> - **Confirm a mutation landed** (re-read the line) before trusting a green run.
> - Budget: each task states its budget. At the budget, stop and report what is done, what is not, and why. Report to the coordinator at least hourly.

> **Branching (orchestrator note, 2 Nov):** the integration branch `feat/cbam-rail-ui` is LOCAL until the user OKs a push. Every `feat/cbam-rail-ui` below means the local branch; each phase branches from it after the previous phase has been merged into it locally.

---

## Decisions this plan takes (read before any task)

These are defaults so that work can proceed. Every one is listed again in the release PR for the founder. None changes a figure.

| # | Decision | Default taken here | Why |
|---|---|---|---|
| P5-1 | Which illustration sits on which tile. The spec's §8.1 table disagrees with the approved reference in four rows (Factory, Steps, Scale, Voucher). | **The reference wins** (table below). | Spec header: "The reference is the visual authority for every pixel decision… Where this text and the reference disagree on a look, the reference wins." The reference README lists "illustration placement" among the things that come from it. Screens `1-estimate-*`, `3-why-*` and `4-list-*` all show the reference mapping. |
| P5-2 | Illustrations on idle, refused and withheld tiles. The reference shows only the happy path. | **An illustration appears only on the branch that renders figures.** The input steps and the Framing shield are static and always show. | A drawing beside a refusal decorates a non-answer; spec §6.1 says each state is the engine's, verbatim. |
| P5-3 | The de minimis gauge. Its needle is drawn near the top of the arc; on a year **below** the threshold it would read as "high". | **The gauge is drawn only on plates whose verdict is `above_threshold`.** | A pictogram must not contradict the verdict printed beside it (spec §6, honesty). The Opus audit (Task 12) re-judges this. |
| P5-4 | Good-step pictogram for sectors with no approved drawing (fertilisers, hydrogen). | **No pictogram.** Iron & steel → tube, cement → bag, aluminium → ingot (spec §8.1). | No drawing was approved for them; we do not invent one. |
| P5-5 | The phase-1 rail animates `width` and the main area animates `left` on collapse. | **Removed: collapse snaps.** | The 60 fps rule: animate transform and opacity only. Both properties force a layout of the whole bento grid every frame. |
| P5-6 | When the entry-animation class leaves the view. | **It is removed once every entry animation has finished** (`motion.ts` waits on `Animation.finished`). | With the class left on, every live re-render (typing in Net mass) would replay the tile animations and regrow the mass ruler on each keystroke. With `fill-mode: both` the end state equals the un-animated state, so removing the class shows no jump. |
| P5-7 | Phone placement of the gauge and the scale. | **In flow under the tile header, right-aligned, 132 px wide**, on viewports below 900 px. | README: the gauge needle crosses the "50 t threshold" label on phone. Screen `3-why-phone-dark.jpg` shows the same fault for the scale over the Charged numeral, which the README does not list. |

### The illustration → tile table settled by P5-1

| Illustration (`data-ill`) | Source in `build_bento.py` | Class | View · tile | Shown |
|---|---|---|---|---|
| `good-tube` / `good-bag` / `good-ingot` | `INP[1]` (tube); `BAG`, `INGOT` bodies in the same frame | `b-ill b-ill-inp` | Estimate · step 1 **Good.** | when the chosen good's sector is iron & steel / cement / aluminium |
| `origin` | `INP[2]` (pin and three routes) | `b-ill b-ill-inp` | Estimate · step 2 **Origin & route.** | always |
| `date` | `INP[3]` (= `ILL_DATE`, calendar, smaller) | `b-ill b-ill-inp b-ill-inp-sq` | Estimate · step 3 **Import date.** | always |
| `mass` | `INP[4]` (platform scale, smaller) | `b-ill b-ill-inp b-ill-inp-mass` | Estimate · step 4 **Net mass.** | always |
| none | `INP[5] = ''` | — | Estimate · step 5 **Emissions data.** | never (founder, 2 Nov) |
| `fac` | `ILL_FAC` | `b-ill b-ill-fac` | Estimate · **Chargeable.**, inside the bronze `.b-fl-in` half | figures branch |
| `vou` | `ILL_VOU` | `b-ill b-ill-vou` | Estimate · **Chargeable.**, inside the `.b-fl-rest` (free allocation) half | figures branch |
| `steps` | `ILL_STEPS` | `b-ill b-ill-steps` | Why · **Mark-up share.** (hero) | figures branch |
| `scale` | `ILL_SCALE` | `b-ill b-ill-scale` | Why · **Charged.** | figures branch |
| `box` | `ILL_BOX` (crates) | `b-ill b-ill-box` | List · **Total.** (hero) | figures branch |
| `gauge` | `ILL_GAUGE` | `b-ill b-ill-gauge` | List · **Annual de minimis.**, one per plate | `above_threshold` plates only (P5-3) |
| `shield` | `SHIELD` | `b-pict b-pict-sm` (in flow) | Rules · **Framing.** (hero) | always |
| — | `ILL_CERT` | — | not ported (founder removed it) | never |

The other pictograms the reference draws (`TUBE`/`BAG`/`INGOT` on the line plates, `SHEET` on CSV, `PAPER` on Document, `TUBE` xs in the good sheet's results, the five `SECT` chip glyphs) are tile content owned by phases 2 and 4. This phase only moves their strings into `illustrations.ts` if they are not already defined once (Task 2, step 1).

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `src/scripts/cbam-ui/illustrations.ts` | create | Every illustration/pictogram SVG string; `insertIll`; `goodIll`; `mountIllustrations` (the Good step follows `#cbCn`) |
| `src/scripts/cbam-ui/motion.ts` | create | `STAGGER_GROUPS`, `indexStagger`, `watchStagger`, `replay` |
| `src/scripts/cbam-ui/views.ts` | modify | `show()` calls `replay`; `mountViews` starts `watchStagger` |
| `src/styles/cbam-ill.css` | create | `--ic-*` tones, `.b-ill-*` positions, phone placement, keyframes, `.b-anim` rules, reduced motion |
| `src/styles/cbam-app.css` | modify | P5-5: drop the rail `width` and main `left` transitions |
| `src/pages/cbam/cbam-calculator.astro` | modify | import `cbam-ill.css`; static step illustrations; Framing shield; `mountIllustrations(root)` |
| `src/scripts/cbam-ui/tiles-estimate.ts`, `tiles-why.ts`, `tiles-list.ts` | modify | `insertIll` on the figures branch of Chargeable, Mark-up share, Charged, Total, Annual de minimis |
| `scripts/cbam-ill-golden.py` | create | Writes the golden fixture from the reference generator without running it |
| `tests/unit/fixtures/cbam-ill-golden.json` | create | The generator's exact strings |
| `tests/unit/cbam-illustrations.test.mjs` | create | Fidelity, monotone, aria-hidden, `insertIll` |
| `tests/unit/cbam-motion.test.mjs` | create | `indexStagger`, `replay` |
| `tests/unit/cbam-motion-css.test.mjs` | create | Keyframes transform/opacity only; no layout transitions; reduced motion |
| `tests/unit/cbam-tiles-*.test.mjs` (phases 2–4) | modify | One presence and one absence assertion per wired illustration |
| `tests/e2e/cbam-helpers.ts` | create (or extend, Task 6) | `view`, `priceLine`, `priceWith`, `REFERENCE_LINES` |
| `tests/e2e/cbam-motion.spec.ts` | create | Replay, keyframe properties, reduced motion, stagger, first paint |
| `tests/e2e/cbam-ill.spec.ts` | create | Presence table and overlap check at 1440/1280/1024/390 |
| `tests/e2e/core-accessibility.spec.ts` | modify | Axe on six views + good sheet × light/dark × desktop/phone; pixel contrast sweep |
| `tests/e2e/cbam-perf.spec.ts` | create | Local-only, new-headless Metal: long tasks, frames, layout count |
| `tests/e2e/cbam-shots.spec.ts` | create | Env-gated headless screenshots named like the reference |
| `playwright.config.ts` | modify | `chromium-cbam-perf` project (local only); `chromium-tier0` ignores `cbam-perf.spec.ts` |

---

### Task 1: Branch, inventory of phases 2–4, baseline

**Budget:** 20 min. **Files:** none.

- [ ] **Step 1: Confirm phase 4 has merged into the integration branch.**

```bash
git -C /Volumes/VSTSAMPLES/Projects/Angad fetch origin
git -C /Volumes/VSTSAMPLES/Projects/Angad log --oneline feat/cbam-rail-ui -12
git -C /Volumes/VSTSAMPLES/Projects/Angad ls-tree --name-only feat/cbam-rail-ui src/scripts/cbam-ui/ src/styles/
```

Expected: a merge of the phase-4 PR; `tiles-estimate.ts`, `tiles-years.ts`, `tiles-why.ts`, `tiles-list.ts`, `tiles-export.ts`, `good-sheet.ts`, `fingerprint.ts` under `cbam-ui/`, and `cbam-bento.css` under `styles/`. If any is missing, **stop and report**: this plan is written against those files.

- [ ] **Step 2: Create the phase-5 worktree on OBOSLab.** A separate worktree, because other sessions may hold the phase 1–4 one.

```bash
git -C /Volumes/VSTSAMPLES/Projects/Angad worktree add -b feat/cbam-rail-ui-p5 /Volumes/OBOSLab/worktrees/cbam-rail-ui-p5 feat/cbam-rail-ui
cd /Volumes/OBOSLab/worktrees/cbam-rail-ui-p5 && npm ci && mkdir -p /Volumes/OBOSLab/tmp/cbam-rail-p5
```

- [ ] **Step 3: Inventory what phases 2–4 already ported.** Run each command and paste its full output into the task report under the heading "Inventory". Later tasks branch on these answers.

```bash
cd /Volumes/OBOSLab/worktrees/cbam-rail-ui-p5
# (a) illustration/motion work already present?
grep -rn "b-ill\|data-ill\|ILL_\|b-anim\|@keyframes b[A-Z]\|--b-io\|--ic-a" src/ || echo "none"
# (b) pictogram bodies already defined (tube, bag, ingot, sheet, paper, shield)?
grep -rln 'M46 35H168\|M62 30h96\|M40 104l26-52\|M48 28a10 10\|x="56" y="12"\|M110 14l64 24' src/ || echo "none"
# (c) where each illustrated tile is rendered
grep -rn 'Chargeable\.\|Mark-up share\.\|Charged\.\|Total\.\|Annual de minimis\.\|Framing\.' src/scripts/cbam-ui/ src/pages/cbam/cbam-calculator.astro
# (d) where the five input steps live (astro markup or a TS renderer)
grep -rn 'b-inp' src/pages/cbam/cbam-calculator.astro src/scripts/cbam-ui/ | head -20
# (e) base tile rules present?
grep -n 'b-t>\*:not(.b-ill)\|\.b-pict{\|\.b-pict-sm\|\.b-t{' src/styles/*.css
# (f) the e2e helpers phases 2-4 left
grep -n "async function priceLine\|async function view\|export async function" tests/e2e/cbam-*.ts
# (g) unit tests that render the illustrated tiles
grep -ln 'Chargeable\.\|Mark-up share\.\|Charged\.\|Total\.\|Annual de minimis\.' tests/unit/*.test.mjs
# (h) the threshold verdict discriminant used by the de minimis plate
grep -n "above_threshold" src/scripts/cbam-ui/tiles-list.ts
```

If (a) shows any illustration or motion code already in `src/`, **stop and report** it: two sources for the same drawing or keyframes is the failure this phase must avoid, and the coordinator decides which one stays.

- [ ] **Step 4: Baseline.**

```bash
npm run build && npm run check && npm run test:unit 2>&1 | tail -5
```

Expected: all clean. Record the `# pass N` line; Task 11 compares against it.

---

### Task 2: `illustrations.ts`, pinned to the reference generator

**Budget:** 40 min. **Files:**
- Create: `scripts/cbam-ill-golden.py`, `tests/unit/fixtures/cbam-ill-golden.json`, `tests/unit/cbam-illustrations.test.mjs`, `src/scripts/cbam-ui/illustrations.ts`
- Modify (only if Task 1 (b) found pictogram bodies elsewhere): that module, to import from `illustrations.ts`

- [ ] **Step 1: Write the golden-fixture script.** It executes only the generator's definition blocks, in memory; running `build_bento.py` itself would rewrite `preview/bento.html`.

```python
#!/usr/bin/env python3
"""Writes tests/unit/fixtures/cbam-ill-golden.json: the approved reference's pictogram and
illustration SVG strings, evaluated from build_bento.py WITHOUT running it (running it rewrites
preview/bento.html). Only the definition blocks are executed, in memory.

Usage: python3 -I scripts/cbam-ill-golden.py /Volumes/VSTSAMPLES/Projects/Angad/docs/superpowers/specs/2026-11-02-cbam-rail-ui/generator/build_bento.py
"""
import hashlib
import json
import os
import sys

GEN = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'tests', 'unit', 'fixtures', 'cbam-ill-golden.json')
raw = open(GEN, 'rb').read()
src = raw.decode('utf-8')


def cut(a, b):
    i = src.index(a)
    j = src.index(b, i)
    return src[i:j]


code = (cut('# ---------- pictograms', 'def dots10')
        + cut('# ================= ILLUSTRATIONS', 'def ins(')
        + cut('def inp_ill(vb, body)', "step = lambda n: f'<span class=\"b-step num\" aria-hidden=\"true\">{n}</span>' + INP[n]"))
ns = {}
exec(code, ns)
gold = {k: ns[k] for k in ('TUBE', 'BAG', 'INGOT', 'SHEET', 'PAPER', 'SHIELD',
                           'ILL_FAC', 'ILL_VOU', 'ILL_STEPS', 'ILL_SCALE', 'ILL_BOX', 'ILL_GAUGE')}
gold.update({f'INP_{n}': ns['INP'][n] for n in (1, 2, 3, 4)})
gold['_source'] = 'build_bento.py sha256 ' + hashlib.sha256(raw).hexdigest()
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(gold, f, indent=1, ensure_ascii=False, sort_keys=True)
    f.write('\n')
print('wrote', OUT, len(gold) - 1, 'strings')
```

Run: `python3 -I scripts/cbam-ill-golden.py /Volumes/VSTSAMPLES/Projects/Angad/docs/superpowers/specs/2026-11-02-cbam-rail-ui/generator/build_bento.py`

Expected: `wrote …/cbam-ill-golden.json 16 strings`. Check `git -C /Volumes/VSTSAMPLES/Projects/Angad status --short docs/superpowers/specs/2026-11-02-cbam-rail-ui/preview/` prints nothing new (the preview was not rewritten).

- [ ] **Step 2: Write the failing test.**

```js
// tests/unit/cbam-illustrations.test.mjs
// Spec §8.1 and §4.3: the approved drawings, byte for byte, in one ink; never bronze or cyan.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ILL, INPUT_ILL, goodIll, insertIll, pict } from '../../src/scripts/cbam-ui/illustrations.ts';

const GOLD = JSON.parse(readFileSync(new URL('./fixtures/cbam-ill-golden.json', import.meta.url), 'utf8'));
/** The two deliberate, invisible additions: a name on every svg, and the needle's class. */
const strip = (s) => s.replace(/ data-ill="[^"]*"/g, '').replace(/ class="b-needle"/g, '');
const body = (s) => s.slice(s.indexOf('>') + 1, s.lastIndexOf('</svg>'));
const PICTS = ['tube', 'bag', 'ingot', 'sheet', 'paper', 'shield'];

test('every string is the reference generator\'s, plus only data-ill and the needle class', () => {
  const pairs = [
    [ILL.fac, 'ILL_FAC'], [ILL.vou, 'ILL_VOU'], [ILL.steps, 'ILL_STEPS'], [ILL.scale, 'ILL_SCALE'],
    [ILL.box, 'ILL_BOX'], [ILL.gauge, 'ILL_GAUGE'],
    [INPUT_ILL.origin, 'INP_2'], [INPUT_ILL.date, 'INP_3'], [INPUT_ILL.mass, 'INP_4'],
    [goodIll('iron_and_steel'), 'INP_1'],
    [pict('tube'), 'TUBE'], [pict('bag'), 'BAG'], [pict('ingot'), 'INGOT'],
    [pict('sheet'), 'SHEET'], [pict('paper'), 'PAPER'], [pict('shield'), 'SHIELD'],
  ];
  for (const [mine, key] of pairs) assert.equal(strip(mine), GOLD[key], key);
});

test('cement and aluminium draw the bag and the ingot in the step frame (spec §8.1)', () => {
  assert.equal(body(goodIll('cement')), body(GOLD.BAG));
  assert.equal(body(goodIll('aluminium')), body(GOLD.INGOT));
  assert.match(goodIll('cement'), /^<svg class="b-ill b-ill-inp" data-ill="good-bag" viewBox="0 0 220 150" aria-hidden="true">/);
  assert.match(goodIll('aluminium'), /data-ill="good-ingot"/);
  assert.match(goodIll('iron_and_steel'), /data-ill="good-tube"/);
});

test('a sector with no approved drawing gets no step pictogram (P5-4)', () => {
  for (const s of ['fertilisers', 'hydrogen', 'electricity', null]) assert.equal(goodIll(s), '', String(s));
});

test('pictogram sizes are class modifiers only', () => {
  assert.equal(strip(pict('shield', 'sm')), GOLD.SHIELD.replace('class="b-pict"', 'class="b-pict b-pict-sm"'));
  assert.match(pict('tube', 'xs'), /^<svg class="b-pict b-pict-xs" data-ill="tube"/);
});

test('every svg is aria-hidden, named and monotone: tones and the plate colour only', () => {
  const all = [
    ...Object.values(ILL), ...Object.values(INPUT_ILL),
    goodIll('iron_and_steel'), goodIll('cement'), goodIll('aluminium'),
    ...PICTS.map((n) => pict(n)),
  ];
  for (const s of all) {
    assert.match(s, /^<svg [^>]*aria-hidden="true"/);
    assert.match(s, /^<svg [^>]*data-ill="[a-z-]+"/);
    assert.doesNotMatch(s, /bronze|cyan|#[0-9a-f]{3,8}\b|rgba?\(/i);
    for (const v of s.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
      assert.ok(['--ic-a', '--ic-b', '--ic-c', '--ic-n', '--card'].includes(v[1]), `${v[1]} in ${s.slice(0, 60)}`);
    }
    // The entry animation sets `transform` on every child; a transform ATTRIBUTE would be erased.
    assert.doesNotMatch(s, / transform="/);
  }
});

test('the certificates illustration is not ported (spec §8.1: the founder removed it)', () => {
  assert.deepEqual(Object.keys(ILL).sort(), ['box', 'fac', 'gauge', 'scale', 'steps', 'vou']);
});

test('the gauge carries exactly one needle for the sweep to target', () => {
  assert.equal((ILL.gauge.match(/class="b-needle"/g) ?? []).length, 1);
});

test('insertIll puts the svg first inside the first element carrying the whole class', () => {
  const tile = '<section class="b-t b-s2"><div class="b-t-h"><p class="b-t-ti">Total.</p></div></section>';
  assert.equal(insertIll(tile, '<svg/>', 'b-t'),
    '<section class="b-t b-s2"><svg/><div class="b-t-h"><p class="b-t-ti">Total.</p></div></section>');
  assert.equal(insertIll('<div class="x b-fl-in" style="width:69.4%">a</div>', '<svg/>', 'b-fl-in'),
    '<div class="x b-fl-in" style="width:69.4%"><svg/>a</div>');
});

test('insertIll refuses a missing host or a malformed class name', () => {
  assert.throws(() => insertIll('<div class="b-t-h"></div>', '<svg/>', 'b-t'), /no element with class "b-t"/);
  assert.throws(() => insertIll('<div class="b-t"></div>', '<svg/>', 'b t'), /not a class name/);
});
```

- [ ] **Step 3: Run it and confirm it fails.**

Run: `node --import tsx --test tests/unit/cbam-illustrations.test.mjs`

Expected: FAIL, "Cannot find module … illustrations.ts".

- [ ] **Step 4: Implement.**

```ts
// src/scripts/cbam-ui/illustrations.ts
// The calculator's illustrations and pictograms (spec §8.1), ported from the approved reference's
// generator, docs/superpowers/specs/2026-11-02-cbam-rail-ui/generator/build_bento.py. One ink in
// alpha tones (--ic-a/-b/-c/-n, spec §4.3) and knockouts in the plate colour (--card): never
// bronze or cyan, so colour keeps meaning only provenance. Every svg is aria-hidden (spec §6.5).
// Two deliberate, invisible additions to the generator's strings: a data-ill name on every svg
// (the tests find drawings by it) and class="b-needle" on the gauge's needle (the sweep targets
// it). tests/unit/cbam-illustrations.test.mjs pins every string against the generator's output.

import { sectorForCn } from '../cbam-algos/cbam/sector.ts';
import type { ImportSector } from '../cbam-algos/threshold/aggregate.ts';

type Tone = 'a' | 'b' | 'c' | 'n';
const F = (t: Tone): string => `style="fill:var(--ic-${t})"`;
const KN = 'style="fill:var(--card)"';
const A = 'fill:var(--ic-a)';
const C = 'fill:var(--ic-c)';
const N = 'fill:var(--ic-n)';
const K = 'fill:var(--card)';

const svg = (cls: string, name: string, vb: string, body: string): string =>
  `<svg class="${cls}" data-ill="${name}" viewBox="${vb}" aria-hidden="true">${body}</svg>`;

// ---------- pictograms (the generator's pict(); viewBox 0 0 220 150) ----------
const PICT_BODY = {
  tube: `<ellipse cx="46" cy="75" rx="20" ry="40" style="${N}"/><path d="M46 35H168a20 40 0 010 80H46z" style="${C}"/>`
    + '<path d="M56 46H160" style="stroke:var(--card);stroke-width:3;stroke-dasharray:6 7;fill:none;opacity:.7"/>'
    + `<ellipse cx="168" cy="75" rx="20" ry="40" style="${A}"/><ellipse cx="168" cy="75" rx="12" ry="27" style="${K}"/>`,
  bag: `<path d="M62 30h96l14 96a10 10 0 01-10 12H58a10 10 0 01-10-12z" style="${C}"/><path d="M62 30h96l-6 18H68z" style="${A}"/>`
    + `<rect x="80" y="70" width="60" height="34" rx="6" style="${K}"/><rect x="92" y="82" width="36" height="10" rx="5" style="${N}"/>`,
  ingot: `<path d="M40 104l26-52h88l26 52z" style="${C}"/><path d="M66 52h88l-12 18H78z" style="${A}"/><path d="M40 104h140v14H40z" style="${N}"/>`
    + '<path d="M66 52l-26 52M154 52l26 52" style="stroke:var(--card);stroke-width:2;opacity:.35;fill:none"/>',
  sheet: `<rect x="48" y="18" width="124" height="116" rx="10" style="${N}"/><path d="M48 28a10 10 0 0110-10h104a10 10 0 0110 10v18H48z" style="${A}"/>`
    + [60, 80, 100].flatMap((y) => ([[60, 26], [94, 30], [132, 28]] as const)
      .map(([x, w]) => `<rect x="${x}" y="${y}" width="${w}" height="10" rx="3" style="${K}"/>`)).join(''),
  paper: `<rect x="70" y="24" width="96" height="118" rx="6" style="${N}"/><rect x="56" y="12" width="96" height="118" rx="6" style="${C}"/>`
    + `<rect x="70" y="30" width="54" height="10" rx="3" style="${K}"/>`
    + ([[54, 68], [68, 60], [82, 68], [96, 44]] as const)
      .map(([y, w]) => `<rect x="70" y="${y}" width="${w}" height="6" rx="3" style="${K};opacity:.7"/>`).join(''),
  shield: `<path d="M110 14l64 24v42c0 34-26 58-64 66-38-8-64-32-64-66V38z" style="${C}"/>`
    + '<path d="M84 80l18 18 36-40" style="fill:none;stroke:var(--card);stroke-width:10;stroke-linecap:round;stroke-linejoin:round"/>',
} as const;
export type PictName = keyof typeof PICT_BODY;

/** A tile pictogram, in flow. `sm`/`xs` are the reference's size modifiers. */
export function pict(name: PictName, size?: 'sm' | 'xs'): string {
  return svg(size ? `b-pict b-pict-${size}` : 'b-pict', name, '0 0 220 150', PICT_BODY[name]);
}

// ---------- medium-large tile illustrations (absolute; positions in cbam-ill.css) ----------
export type IllName = 'fac' | 'vou' | 'steps' | 'scale' | 'box' | 'gauge';
const ill = (name: IllName, vb: string, body: string): string => svg(`b-ill b-ill-${name}`, name, vb, body);

export const ILL: Readonly<Record<IllName, string>> = {
  fac: ill('fac', '0 0 160 120', `<rect x="0" y="104" width="160" height="6" rx="3" ${F('n')}/><path d="M8 104V60l30 18V60l30 18V44h24v60z" ${F('c')}/>`
    + `<rect x="96" y="24" width="15" height="80" rx="3" ${F('a')}/><circle cx="118" cy="18" r="11" ${F('b')}/><circle cx="135" cy="12" r="14" ${F('b')}/><circle cx="151" cy="21" r="9" ${F('b')}/>`
    + [18, 44, 70].map((x) => `<rect x="${x}" y="84" width="11" height="11" rx="2" ${KN}/>`).join('')),
  vou: ill('vou', '0 0 120 70', `<path d="M8 6h104a4 4 0 014 4v15a10 10 0 000 20v15a4 4 0 01-4 4H8a4 4 0 01-4-4V45a10 10 0 000-20V10a4 4 0 014-4z" ${F('c')}/>`
    + '<path d="M86 12v46" style="stroke:var(--card);stroke-width:3;stroke-dasharray:4 5"/>'
    + `<rect x="20" y="22" width="48" height="8" rx="4" ${KN}/><rect x="20" y="38" width="34" height="6" rx="3" ${KN} opacity=".7"/><circle cx="101" cy="35" r="7" ${KN}/>`),
  steps: ill('steps', '0 0 180 130', `<rect x="10" y="72" width="44" height="48" rx="6" ${F('c')}/><rect x="10" y="61" width="44" height="8" rx="4" ${F('a')}/>`
    + `<rect x="68" y="66" width="44" height="54" rx="6" ${F('c')}/><rect x="68" y="47" width="44" height="16" rx="5" ${F('a')}/>`
    + `<rect x="126" y="60" width="44" height="60" rx="6" ${F('c')}/><rect x="126" y="33" width="44" height="24" rx="6" ${F('a')}/>`
    + '<path d="M32 52L90 38L148 24" style="fill:none;stroke:var(--ic-b);stroke-width:3;stroke-dasharray:5 6;stroke-linecap:round"/>'
    + `<path d="M148 14l9 11-13 3z" ${F('b')}/>`),
  scale: ill('scale', '0 0 160 120', `<rect x="77" y="22" width="6" height="84" rx="3" ${F('c')}/><rect x="48" y="104" width="64" height="9" rx="4.5" ${F('c')}/>`
    + `<path d="M20 46L140 24l1 6L21 52z" ${F('a')}/><circle cx="80" cy="35" r="7" ${F('a')}/>`
    + '<path d="M22 50L10 82M22 50l12 32M139 28l-12 30M139 28l12 30" style="stroke:var(--ic-b);stroke-width:2;fill:none"/>'
    + `<path d="M3 82h38a19 11 0 01-38 0z" ${F('a')}/><rect x="12" y="64" width="20" height="17" rx="3" ${F('c')}/><rect x="15" y="54" width="14" height="11" rx="3" ${F('c')}/>`
    + `<path d="M120 58h38a19 11 0 01-38 0z" ${F('b')}/>`),
  box: ill('box', '0 0 180 120', `<rect x="6" y="28" width="104" height="86" rx="8" ${F('c')}/>`
    + [24, 44, 64, 84].map((x) => `<rect x="${x}" y="38" width="4" height="66" rx="2" ${KN} opacity=".35"/>`).join('')
    + `<rect x="116" y="62" width="58" height="52" rx="7" ${F('b')}/><rect x="116" y="34" width="32" height="24" rx="5" ${F('n')}/>`
    + `<rect x="132" y="82" width="26" height="6" rx="3" ${KN} opacity=".6"/>`),
  gauge: ill('gauge', '0 0 160 100', '<path d="M10 90A70 70 0 01150 90" style="fill:none;stroke:var(--ic-n);stroke-width:14;stroke-linecap:round"/>'
    + '<path d="M10 90A70 70 0 01143.9 61.5" style="fill:none;stroke:var(--ic-a);stroke-width:14;stroke-linecap:round"/>'
    + '<path d="M30.6 61.5L8.9 48.9" style="stroke:var(--card);stroke-width:5"/>'
    + '<path class="b-needle" d="M80 90L127.5 68.9" style="stroke:var(--ic-c);stroke-width:5;stroke-linecap:round"/>'
    + `<circle cx="80" cy="90" r="8" ${F('c')}/>`),
};

// ---------- input-step illustrations (smaller, top right of each step) ----------
const MONTHS = [0, 1, 2, 3].flatMap((r) => [0, 1, 2].map((c) =>
  `<rect x="${17 + c * 32}" y="${44 + r * 15}" width="26" height="11" rx="4" ${r === 0 ? F('a') : 'style="fill:var(--card);opacity:.55"'}/>`)).join('');
const STEP_TUBE = `<ellipse cx="46" cy="75" rx="20" ry="40" ${F('n')}/><path d="M46 35H168a20 40 0 010 80H46z" ${F('c')}/>`
  + '<path d="M56 46H160" style="stroke:var(--card);stroke-width:4;stroke-dasharray:7 8;fill:none;opacity:.7"/>'
  + `<ellipse cx="168" cy="75" rx="20" ry="40" ${F('a')}/><ellipse cx="168" cy="75" rx="12" ry="27" ${KN}/>`;

export const INPUT_ILL = {
  origin: svg('b-ill b-ill-inp', 'origin', '0 0 130 84', `<path d="M30 78s-22-20-22-38a22 22 0 0144 0c0 18-22 38-22 38z" ${F('c')}/><circle cx="30" cy="40" r="8" ${KN}/>`
    + '<path d="M54 40C78 40 82 14 108 14M54 40H108M54 40C78 40 82 66 108 66" style="fill:none;stroke:var(--ic-b);stroke-width:3;stroke-dasharray:5 5;stroke-linecap:round"/>'
    + `<circle cx="114" cy="14" r="9" ${F('a')}/><circle cx="114" cy="40" r="8" ${F('n')}/><circle cx="114" cy="66" r="8" ${F('n')}/>`),
  date: svg('b-ill b-ill-inp b-ill-inp-sq', 'date', '0 0 120 110', `<rect x="5" y="14" width="110" height="92" rx="12" ${F('n')}/><path d="M5 26a12 12 0 0112-12h86a12 12 0 0112 12v10H5z" ${F('c')}/>`
    + `<rect x="30" y="4" width="8" height="20" rx="4" ${F('a')}/><rect x="82" y="4" width="8" height="20" rx="4" ${F('a')}/>${MONTHS}`),
  mass: svg('b-ill b-ill-inp b-ill-inp-mass', 'mass', '0 0 130 84', `<rect x="10" y="66" width="110" height="10" rx="5" ${F('c')}/><rect x="58" y="56" width="14" height="12" ${F('n')}/><rect x="30" y="18" width="70" height="40" rx="6" ${F('a')}/>`
    + [44, 56, 68, 80].map((x) => `<rect x="${x}" y="24" width="4" height="28" rx="2" ${KN} opacity=".4"/>`).join('')),
} as const;

/** Spec §8.1: the Good step's pictogram follows the sector. P5-4: no drawing, no pictogram. */
const GOOD: Partial<Record<ImportSector, readonly [name: string, body: string]>> = {
  iron_and_steel: ['tube', STEP_TUBE],
  cement: ['bag', PICT_BODY.bag],
  aluminium: ['ingot', PICT_BODY.ingot],
};
export function goodIll(sector: ImportSector | null): string {
  const g = sector ? GOOD[sector] : undefined;
  return g ? svg('b-ill b-ill-inp', `good-${g[0]}`, '0 0 220 150', g[1]) : '';
}

/**
 * Inserts `svgStr` as the first child of the first element whose class list contains `hostClass`
 * as a whole word. Pure, for the tile renderers: `insertIll(html, ILL.box, 'b-t')`.
 */
export function insertIll(html: string, svgStr: string, hostClass: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(hostClass)) throw new Error(`insertIll: "${hostClass}" is not a class name`);
  const m = new RegExp(`<[a-z][a-z0-9]*\\b[^>]*\\bclass="(?:[^"]*\\s)?${hostClass}(?:\\s[^"]*)?"[^>]*>`).exec(html);
  if (!m) throw new Error(`insertIll: no element with class "${hostClass}"`);
  const at = m.index + m[0].length;
  return html.slice(0, at) + svgStr + html.slice(at);
}

/**
 * The Good step's pictogram follows `#cbCn` (the good sheet writes it and dispatches `input`).
 * Guarded against double init and dropped on soft navigation, like mountViews.
 */
export function mountIllustrations(root: HTMLElement): void {
  if (root.dataset.illWired) return;
  root.dataset.illWired = 'true';
  const ac = new AbortController();
  document.addEventListener('astro:before-swap', () => ac.abort(), { once: true });
  const paint = (): void => {
    const step = Array.from(root.querySelectorAll<HTMLElement>('.b-inp'))
      .find((s) => s.querySelector('.b-t-ti')?.textContent?.trim() === 'Good.');
    if (!step) return;
    step.querySelector(':scope > [data-ill^="good-"]')?.remove();
    const cn = root.querySelector<HTMLInputElement>('#cbCn')?.value.trim() ?? '';
    const s = /^\d{8,10}$/.test(cn) ? goodIll(sectorForCn(cn)) : '';
    if (s) step.insertAdjacentHTML('afterbegin', s);
  };
  const on = (ev: Event): void => { if ((ev.target as Element | null)?.id === 'cbCn') paint(); };
  root.addEventListener('input', on, { signal: ac.signal });
  root.addEventListener('change', on, { signal: ac.signal });
  paint();
}
```

- [ ] **Step 5: Run the test; it should pass.** Run: `node --import tsx --test tests/unit/cbam-illustrations.test.mjs`. Expected: 9 pass. If the fidelity test fails, the message names the key; fix the TS string, never the fixture.

- [ ] **Step 6: One source for the pictograms.** For every file Task 1 (b) listed, replace its local pictogram string with `pict('<name>', <size>)` imported from `./illustrations.ts`, keeping the rendered markup identical apart from the added `data-ill` attribute. Run that module's unit tests after each file. If a test asserts the exact old markup, add ` data-ill="<name>"` to its expected string in the same commit and say so in the commit message; change nothing else in it.

- [ ] **Step 7: Check and commit.**

```bash
npm run check
git add -- scripts/cbam-ill-golden.py tests/unit/fixtures/cbam-ill-golden.json tests/unit/cbam-illustrations.test.mjs src/scripts/cbam-ui/illustrations.ts
# plus each file changed in step 6, by name
git commit -m "feat(cbam): illustrations.ts, pinned byte-for-byte to the reference generator (spec §8.1)"
```

---

### Task 3: `cbam-ill.css`, the input-step illustrations and the Framing shield

**Budget:** 40 min. **Files:**
- Create: `src/styles/cbam-ill.css`
- Modify: `src/pages/cbam/cbam-calculator.astro` (or the TS renderer of the input steps, if Task 1 (d) found them in one)

- [ ] **Step 1: Write the stylesheet's first half (tones and positions).** Positions are the reference's **final** cascade, resolved: `bento.css` overrides `.b-ill-inp-sq` three times, `.b-ill-box` and `.b-ill-vou` twice, and only the winning values are kept. `[data-device="phone"]` in the preview becomes `@media (max-width:899px)`, the shell's phone breakpoint.

```css
/* src/styles/cbam-ill.css. Illustrations (spec §8.1–8.2) and the entry animation (spec §8.3),
   ported from the approved reference's preview/bento.css. Positions are its final cascade,
   resolved. Motion: transform and opacity only (the 60 fps rule), replayed by views.ts. */

/* Icon tones (spec §4.3): one ink, told apart by alpha. Illustrations never use bronze or cyan. */
.cbx{
  --ic-a:var(--ink-2);
  --ic-b:color-mix(in oklab,var(--ink-2) 45%,transparent);
  --ic-c:color-mix(in oklab,var(--ink-2) 72%,transparent);
  --ic-d:color-mix(in oklab,var(--ink-2) 45%,transparent);
  --ic-n:color-mix(in oklab,var(--ink-2) 30%,transparent);
  --b-io:cubic-bezier(.65,0,.35,1);
}
/* On the inverted tile the ink is the plate's opposite; knockouts take the plate's colour. */
.cbx .b-hero{--card:var(--ink);--ic-a:var(--on-ink);--ic-c:color-mix(in oklab,var(--on-ink) 72%,transparent);--ic-b:color-mix(in oklab,var(--on-ink) 45%,transparent);--ic-d:var(--ic-b);--ic-n:color-mix(in oklab,var(--on-ink) 28%,transparent)}
/* On the bronze fill (Chargeable): dark ink tones; the knockouts are holes showing the plate. */
.cbx .b-fl-in{--card:var(--bronze-f);--ic-a:#141614;--ic-c:rgba(20,22,20,.72);--ic-b:rgba(20,22,20,.42);--ic-n:rgba(20,22,20,.28)}

/* Medium-large illustrations: absolute, behind every word. The :where() rules carry zero
   specificity, so any position phases 2-4 gave a tile child still wins. */
:where(.cbx .b-t,.cbx .b-fl-in,.cbx .b-fl-rest){position:relative}
:where(.cbx .b-t,.cbx .b-fl-in,.cbx .b-fl-rest)>:where(:not(.b-ill)){position:relative;z-index:1}
.cbx .b-ill{position:absolute;pointer-events:none;z-index:0;height:auto}
.cbx .b-ill-fac{right:22px;top:22px;width:180px}
.cbx .b-ill-vou{right:20px;top:84px;width:64px}
.cbx .b-ill-steps{right:28px;top:38px;width:200px}
.cbx .b-ill-scale{right:30px;top:74px;width:170px}
.cbx .b-ill-box{right:30px;bottom:96px;width:130px}
.cbx .b-ill-gauge{right:30px;top:64px;width:180px}
/* Input-step illustrations: top right; the title row makes room. */
.cbx .b-ill-inp{top:14px;right:18px;width:84px}
.cbx .b-ill-inp-sq{top:14px;width:44px}
.cbx .b-ill-inp-mass{top:16px;width:64px}
.cbx .b-inp>.b-t-ti{padding-right:96px}

@media (max-width:899px){
  .cbx .b-ill-steps,.cbx .b-ill-box{width:120px}
  /* P5-7. On a 390 px tile the gauge's needle crossed the "50 t threshold" label (reference
     README) and the scale sat on the Charged numeral (screen 3-why-phone-dark). Both go in flow
     under the tile header, right-aligned, so they cannot cover a word. */
  .cbx .b-t>.b-t-h{order:-1}
  .cbx .b-ill-gauge,.cbx .b-ill-scale{position:static;align-self:flex-end;width:132px;margin:6px 0 4px}
}
```

- [ ] **Step 2: Import it** in the page frontmatter, directly after the last existing CBAM stylesheet import (`cbam-bento.css` if Task 1 found it there):

```ts
import '../../styles/cbam-ill.css';
```

and add, next to the other `cbam-ui` imports in the frontmatter:

```ts
import { INPUT_ILL, pict } from '../../scripts/cbam-ui/illustrations.ts';
```

- [ ] **Step 3: Static step illustrations.** In the Estimate input column (located by Task 1 (d)), insert one line as the **first child** of steps 2, 3 and 4 — each is a `<section class="b-t b-inp">` whose `.b-t-ti` reads "Origin & route.", "Import date." and "Net mass.":

```astro
<Fragment set:html={INPUT_ILL.origin} />   {/* in step 2 */}
<Fragment set:html={INPUT_ILL.date} />     {/* in step 3 */}
<Fragment set:html={INPUT_ILL.mass} />     {/* in step 4 */}
```

Step 1 gets nothing in markup (`mountIllustrations` paints it); step 5 gets nothing (founder, 2 Nov). If Task 1 (d) found the steps in a TS renderer instead, apply the same three strings with `insertIll(stepHtml, INPUT_ILL.<name>, 'b-inp')` there.

- [ ] **Step 4: The Framing shield.** In the Rules view, inside the tile whose `.b-t-ti` reads "Framing.", put the shield **after** the tile's header `div` (it is in flow, as in the reference): `<Fragment set:html={pict('shield', 'sm')} />`. If Task 1 (b) found phase 4 already drawing a shield there, Task 2 step 6 has already switched it to `pict('shield', 'sm')`; skip this step.

- [ ] **Step 5: Paint the Good step.** In the page `<script>`, import and call it after `mountViews(root);`:

```ts
import { mountIllustrations } from '../../scripts/cbam-ui/illustrations.ts';
// …inside boot(), directly after mountViews(root):
    mountIllustrations(root);
```

- [ ] **Step 6: Gate.** `npm run check && npm run build`, then the shell spec as a smoke test:

```bash
npx playwright test tests/e2e/cbam-shell.spec.ts --project=chromium-tier0 --reporter=line
```

Expected: all pass (the count is the one Task 1 saw). Then grep the built page for the three static drawings: `grep -o 'data-ill="\(origin\|date\|mass\|shield\)"' dist/cbam/cbam-calculator/index.html | sort | uniq -c` prints each once.

- [ ] **Step 7: Commit.**

```bash
git add -- src/styles/cbam-ill.css src/pages/cbam/cbam-calculator.astro
git commit -m "feat(cbam): illustration tones and positions; input-step drawings; Framing shield (spec §8.1-8.2)"
```

---

### Task 4: Tile illustrations on the figures branch only

**Budget:** 45 min. **Files:**
- Modify: `src/scripts/cbam-ui/tiles-estimate.ts`, `tiles-why.ts`, `tiles-list.ts`
- Modify: the unit tests Task 1 (g) listed

The rule (P5-2, P5-3): an illustration is added **only** inside the branch that renders the tile's figures. Idle, refused, withheld, no-price and threshold-error branches stay exactly as they are. The de minimis gauge is added only where the plate's verdict is `above_threshold`.

| Tile (title) | Module | Call on the figures branch |
|---|---|---|
| Chargeable. | `tiles-estimate.ts` | `html = insertIll(insertIll(html, ILL.fac, 'b-fl-in'), ILL.vou, 'b-fl-rest');` |
| Mark-up share. | `tiles-why.ts` | `html = insertIll(html, ILL.steps, 'b-t');` |
| Charged. | `tiles-why.ts` | `html = insertIll(html, ILL.scale, 'b-t');` |
| Total. | `tiles-list.ts` | `html = insertIll(html, ILL.box, 'b-t');` |
| Annual de minimis. | `tiles-list.ts` | per plate, only when the verdict is `above_threshold`: `html = insertIll(html, ILL.gauge, 'b-t');` |

- [ ] **Step 1: Write the failing assertions first.** For each row, find (grep the title in the files of Task 1 (g)) one existing test that renders the tile's figures and one that renders a non-figure state (idle, refused or withheld; for the gauge, a below-threshold or indeterminate year). Add, after the existing assertions of each:

```js
// figures branch (P5-2): exactly one drawing
assert.equal((html.match(/data-ill="box"/g) ?? []).length, 1);
// non-figure branch (P5-2/P5-3): none
assert.doesNotMatch(html, /data-ill=/);
```

using the variable name the test already uses for the rendered string, and `fac`/`vou`/`steps`/`scale`/`box`/`gauge` per row. For Chargeable assert both `fac` and `vou`. **If no test renders a non-figure state for a tile, that is a §6.1 gap from an earlier phase:** write one with the same fixture style as its neighbours, and name it in the task report. Do not loosen or delete any existing assertion.

- [ ] **Step 2: Run them; the presence assertions fail.**

Run: `node --import tsx --test tests/unit/cbam-tiles-*.test.mjs` (or the files Task 1 (g) listed). Expected: one failure per presence assertion; every absence assertion already passes.

- [ ] **Step 3: Wire.** In each module add `import { ILL, insertIll } from './illustrations.ts';` and apply the table's call to the string the figures branch returns, immediately before it is returned. Read each renderer's state `switch` or `if` chain first; the call goes in exactly one branch per tile.

- [ ] **Step 4: Run them again; all pass.** Then the whole unit suite: `npm run build && npm run test:unit 2>&1 | tail -5`. Expected: pass; count = Task 1 baseline + Task 2's 9 + any gap tests you wrote.

- [ ] **Step 5: Commit.**

```bash
git add -- src/scripts/cbam-ui/tiles-estimate.ts src/scripts/cbam-ui/tiles-why.ts src/scripts/cbam-ui/tiles-list.ts tests/unit/<the files you edited>
git commit -m "feat(cbam): tile illustrations on the figures branch only; gauge only above the threshold (P5-2, P5-3)"
```

---

### Task 5: `motion.ts`, the replay, the keyframes, and no layout transitions

**Budget:** 45 min. **Files:**
- Create: `src/scripts/cbam-ui/motion.ts`, `tests/unit/cbam-motion.test.mjs`, `tests/unit/cbam-motion-css.test.mjs`
- Modify: `src/scripts/cbam-ui/views.ts`, `src/styles/cbam-ill.css`, `src/styles/cbam-app.css`

- [ ] **Step 1: Write the failing module test.**

```js
// tests/unit/cbam-motion.test.mjs
// Spec §8.3: stagger indices set once per render; the entry animation replays on every entry.
import assert from 'node:assert/strict';
import test from 'node:test';

import { ANIM_CLASS, STAGGER_GROUPS, indexStagger, replay } from '../../src/scripts/cbam-ui/motion.ts';

test('the stagger groups are the reference bento.js list, verbatim', () => {
  assert.equal(STAGGER_GROUPS, '.b-ill,.b-pict,.b-sg,.b-waffle,.b-fp,.b-d10,.b-strip,.b-phase,.b-mcols,.b-stackbar,.b-split');
  assert.equal(ANIM_CLASS, 'b-anim');
});

const child = () => { const s = {}; return { s, style: { setProperty: (k, v) => { s[k] = v; } } }; };
const group = (n) => ({ children: Array.from({ length: n }, child) });

test('every child of every group gets its index as --i', () => {
  const g1 = group(3); const g2 = group(2);
  indexStagger({ matches: () => false, querySelectorAll: (sel) => { assert.equal(sel, STAGGER_GROUPS); return [g1, g2]; } });
  assert.deepEqual(g1.children.map((c) => c.s['--i']), ['0', '1', '2']);
  assert.deepEqual(g2.children.map((c) => c.s['--i']), ['0', '1']);
});

test('a node that is itself a group is indexed too', () => {
  const self = { ...group(2), matches: () => true, querySelectorAll: () => [] };
  indexStagger(self);
  assert.deepEqual(self.children.map((c) => c.s['--i']), ['0', '1']);
});

function host(initial) {
  const log = [];
  let anims = initial;
  return {
    log,
    set: (a) => { anims = a; },
    classList: { add: (c) => log.push(`add:${c}`), remove: (c) => log.push(`remove:${c}`) },
    get offsetWidth() { log.push('reflow'); return 0; },
    getAnimations: () => anims,
  };
}
const anim = (name) => { let done; const a = { animationName: name, playState: 'running', finished: new Promise((r) => { done = r; }) }; a.finish = () => { a.playState = 'finished'; done(a); }; return a; };
const tick = () => new Promise((r) => setTimeout(r, 0));

test('replay removes the class, forces a reflow, then re-adds it', () => {
  const el = host([anim('bRise')]);
  replay(el);
  assert.deepEqual(el.log, [`remove:${ANIM_CLASS}`, 'reflow', `add:${ANIM_CLASS}`]);
});

test('the class leaves once every entry animation has finished (P5-6)', async () => {
  const a = anim('bPop');
  const el = host([a]);
  replay(el);
  await tick();
  assert.equal(el.log.at(-1), `add:${ANIM_CLASS}`);
  a.finish();
  await tick();
  assert.equal(el.log.at(-1), `remove:${ANIM_CLASS}`);
});

test('a newer replay keeps the class while its own animations run', async () => {
  const first = anim('bRise');
  const el = host([first]);
  replay(el);
  const second = anim('bRise');
  el.set([second]);
  replay(el);
  first.finish();
  await tick();
  assert.equal(el.log.at(-1), `add:${ANIM_CLASS}`);
  second.finish();
  await tick();
  assert.equal(el.log.at(-1), `remove:${ANIM_CLASS}`);
});

test('with no entry animation (reduced motion) the class leaves at once; transitions do not hold it', () => {
  const el = host([{ playState: 'running', finished: new Promise(() => {}) }]); // a hover transition: no animationName
  replay(el);
  assert.equal(el.log.at(-1), `remove:${ANIM_CLASS}`);
});
```

- [ ] **Step 2: Run it; it fails** ("Cannot find module … motion.ts").

- [ ] **Step 3: Implement `motion.ts`.**

```ts
// src/scripts/cbam-ui/motion.ts
// The entry motion's two hooks (spec §8.3). Stagger indices are set on every render, by one
// MutationObserver on the main area, so no renderer has to remember them. The replay runs on
// every view entry. The motion itself is CSS (src/styles/cbam-ill.css); reduced motion is there.

export const ANIM_CLASS = 'b-anim';
/** The groups whose children stagger: the reference's bento.js list, verbatim. */
export const STAGGER_GROUPS = '.b-ill,.b-pict,.b-sg,.b-waffle,.b-fp,.b-d10,.b-strip,.b-phase,.b-mcols,.b-stackbar,.b-split';
/** The entry keyframes in cbam-ill.css. Only these hold the class; hover transitions do not. */
const ENTRY = new Set(['bRise', 'bGrowX', 'bGrowY', 'bPop', 'bNeedle', 'bSlide', 'bLift']);

export function indexStagger(node: Element): void {
  const groups = Array.from(node.querySelectorAll(STAGGER_GROUPS));
  if (node.matches(STAGGER_GROUPS)) groups.unshift(node);
  for (const g of groups) {
    Array.from(g.children).forEach((c, i) => (c as HTMLElement | SVGElement).style.setProperty('--i', String(i)));
  }
}

/** Indexes `main` now and every subtree a render adds to it later. Returns the disconnect. */
export function watchStagger(main: Element): () => void {
  indexStagger(main);
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (n.nodeType !== Node.ELEMENT_NODE) return;
        const parent = (n as Element).parentElement;
        // A renderer that rewrites a group's children adds them one by one: re-index the group.
        if (parent?.matches(STAGGER_GROUPS)) indexStagger(parent);
        else indexStagger(n as Element);
      });
    }
  });
  mo.observe(main, { childList: true, subtree: true });
  return () => mo.disconnect();
}

interface EntryAnimation { readonly playState: string; readonly finished: Promise<unknown>; readonly animationName?: string }
export interface Replayable {
  readonly classList: { add(token: string): void; remove(token: string): void };
  readonly offsetWidth: number;
  getAnimations(options: { subtree: boolean }): readonly EntryAnimation[];
}

const generation = new WeakMap<object, number>();

/**
 * Spec §8.3: remove the class, force a reflow, re-add it, so every entry animation restarts.
 * P5-6: once they have all finished, the class leaves again, so a live re-render (typing a mass)
 * does not replay them. With fill-mode `both` the end state is the un-animated state: no jump.
 */
export function replay(el: Replayable): void {
  const gen = (generation.get(el) ?? 0) + 1;
  generation.set(el, gen);
  el.classList.remove(ANIM_CLASS);
  void el.offsetWidth;
  el.classList.add(ANIM_CLASS);
  settle(el, gen);
}

function settle(el: Replayable, gen: number): void {
  const running = el.getAnimations({ subtree: true })
    .filter((a) => a.animationName !== undefined && ENTRY.has(a.animationName) && a.playState === 'running');
  if (running.length === 0) {
    if (generation.get(el) === gen) el.classList.remove(ANIM_CLASS);
    return;
  }
  void Promise.allSettled(running.map((a) => a.finished)).then(() => {
    if (generation.get(el) === gen) settle(el, gen);
  });
}
```

- [ ] **Step 4: Run it; 7 pass.**

- [ ] **Step 5: Hook it into `views.ts`.** Add the import at the top:

```ts
import { replay, watchStagger } from './motion.ts';
```

In `show`, directly after the line that sets `hidden` on every `[data-view]`:

```ts
    // Spec §8.3: the entry animation replays on every view entry, the first paint included.
    const entered = root.querySelector<HTMLElement>(`[data-view="${view}"]`);
    if (entered) replay(entered);
```

and in `mountViews`, directly before the final `show(viewFromHash(location.hash), false, false);`:

```ts
  const main = root.querySelector<HTMLElement>('.cbx-main');
  if (main) ac.signal.addEventListener('abort', watchStagger(main), { once: true });
```

Run `node --import tsx --test tests/unit/cbam-views.test.mjs`; it still passes (the pure core is unchanged).

- [ ] **Step 6: Write the failing CSS-source test.**

```js
// tests/unit/cbam-motion-css.test.mjs
// The 60 fps rule (spec §8.3; founder rule): the calculator animates transform and opacity only.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const STYLES = new URL('../../src/styles/', import.meta.url);
const PAGE = new URL('../../src/pages/cbam/cbam-calculator.astro', import.meta.url);
const UI = new URL('../../src/scripts/cbam-ui/', import.meta.url);
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function sources() {
  const css = readdirSync(STYLES).filter((f) => /^cbam-.*\.css$/.test(f))
    .map((f) => [f, noComments(readFileSync(new URL(f, STYLES), 'utf8'))]);
  const page = [...readFileSync(PAGE, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m, i) => [`cbam-calculator.astro <style> #${i + 1}`, noComments(m[1])]);
  return [...css, ...page];
}
function blockAfter(css, from) {
  let depth = 1; let i = from;
  while (depth > 0 && i < css.length) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; i++; }
  return css.slice(from, i - 1);
}
/** Splits on `sep` outside parentheses (cubic-bezier(.16, 1, .3, 1) holds commas and spaces). */
function splitTop(s, sep) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
const TIMING = /^(?:-?[\d.]+m?s|ease(?:-in|-out|-in-out)?|linear|step-start|step-end|normal|allow-discrete|initial|inherit|(?:cubic-bezier|steps|linear|var)\(.*\))$/;
/** Composited (transform, opacity) or paint-only. Anything else moves layout, or is unreviewed. */
const ALLOWED = new Set(['opacity', 'transform', 'color', 'background', 'background-color', 'box-shadow', 'border-color', 'outline-color', 'fill', 'stroke']);

test('every @keyframes in the calculator animates transform and opacity only', () => {
  let seen = 0;
  for (const [file, css] of sources()) {
    for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
      seen++;
      const props = new Set([...blockAfter(css, m.index + m[0].length).matchAll(/([a-z-]+)\s*:/g)].map((p) => p[1]));
      for (const p of props) assert.ok(p === 'transform' || p === 'opacity', `${file} @keyframes ${m[1]} animates ${p}`);
    }
  }
  assert.ok(seen >= 7, `the seven entry keyframes at least; found ${seen}`);
});

test('no transition in the calculator moves layout', () => {
  for (const [file, css] of sources()) {
    for (const m of css.matchAll(/(?:^|[;{\s])transition(-property)?\s*:\s*([^;}]+)/g)) {
      const val = m[2].replace(/!important/, '').trim();
      if (val === 'none') continue;
      const props = m[1]
        ? splitTop(val, ',')
        : splitTop(val, ',').map((part) => splitTop(part, ' ').find((t) => !TIMING.test(t)) ?? 'all');
      for (const p of props) assert.ok(ALLOWED.has(p), `${file}: transition on "${p}" (${val})`);
    }
  }
});

test('the entry motion uses the approved easing and switches off under reduced motion', () => {
  const css = noComments(readFileSync(new URL('cbam-ill.css', STYLES), 'utf8'));
  assert.match(css, /--b-io:cubic-bezier\(\.65,0,\.35,1\)/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.cbx \.b-anim \*\{animation:none!important\}\}/);
});

test('motion lives in CSS: no calculator module animates by script or inline style', () => {
  for (const f of readdirSync(UI).filter((n) => n.endsWith('.ts'))) {
    assert.doesNotMatch(readFileSync(new URL(f, UI), 'utf8'), /\.animate\(|(?:transition|animation)(?:-[a-z]+)?\s*:/, f);
  }
});
```

- [ ] **Step 7: Run it.** Run: `node --import tsx --test tests/unit/cbam-motion-css.test.mjs`. Expected failures: the keyframes count (`found 0` or 1, from the page's `cg-dot-in`), the reduced-motion match, and `transition on "width"` and `"left"` from `cbam-app.css` (P5-5). **Any other failure** (for example a sheet in `cbam-bento.css` sliding on `left`) is a real finding: fix it in the same way, with `transform`, and list it in the task report.

- [ ] **Step 8: Append the motion to `cbam-ill.css`.**

```css
/* ===== Entry animation (spec §8.3, approved 2 Nov). Replayed on every view entry by views.ts
   through motion.ts: the class goes off, a reflow, the class back on. Transform and opacity only. ===== */
@keyframes bRise{from{opacity:0;transform:translateY(12px) scale(.96)}to{opacity:1;transform:none}}
@keyframes bGrowX{from{transform:scaleX(0)}to{transform:none}}
@keyframes bGrowY{from{transform:scaleY(0)}to{transform:none}}
@keyframes bPop{from{opacity:0;transform:scale(.3)}to{opacity:1;transform:none}}
@keyframes bNeedle{from{transform:rotate(-130deg)}to{transform:none}}
/* Bars that carry text slide or lift and never scale, so their numbers are never squashed. */
@keyframes bSlide{from{opacity:0;transform:translateX(-28px)}to{opacity:1;transform:none}}
@keyframes bLift{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:none}}
.cbx .b-anim :is(.b-ill,.b-pict,.b-sg)>*{transform-box:fill-box;transform-origin:center;animation:bRise .9s var(--b-io) both;animation-delay:calc(120ms + var(--i,0) * 70ms)}
.cbx .b-anim :is(.b-stackbar b,.b-share b,.b-thr b,.b-qtr i.on){transform-origin:left center;animation:bGrowX 1.1s var(--b-io) both;animation-delay:calc(200ms + var(--i,0) * 90ms)}
.cbx .b-anim .b-ph b{transform-origin:center bottom;animation:bGrowY 1.1s var(--b-io) both;animation-delay:calc(200ms + var(--i,0) * 80ms)}
.cbx .b-anim :is(.b-waffle i,.b-fp i,.b-d10 i,.b-strip i){animation:bPop .6s var(--b-io) both;animation-delay:calc(150ms + var(--i,0) * 9ms)}
.cbx .b-anim .b-ill-gauge .b-needle{transform-box:view-box;transform-origin:80px 90px;animation:bNeedle 1.4s var(--b-io) both;animation-delay:350ms}
.cbx .b-anim .b-sp{animation:bSlide 1s var(--b-io) both;animation-delay:calc(200ms + var(--i,0) * 120ms)}
.cbx .b-anim .b-mc-bar{animation:bLift 1s var(--b-io) both;animation-delay:calc(200ms + var(--i,0) * 110ms)}
@media (prefers-reduced-motion:reduce){.cbx .b-anim *{animation:none!important}}
```

The reference selected the needle as `path:nth-of-type(4)`; it is now `.b-needle` (Task 2), the same element.

- [ ] **Step 9: P5-5, the rail.** In `src/styles/cbam-app.css`, delete `transition:width .45s var(--ease);` from the `.cbx-rail` rule and `;transition:left .45s var(--ease)` from the `.cbx-main` rule (keep every other declaration on both lines). Re-read both lines to confirm.

- [ ] **Step 10: Run the unit tests; all pass.** `node --import tsx --test tests/unit/cbam-motion.test.mjs tests/unit/cbam-motion-css.test.mjs tests/unit/cbam-views.test.mjs`. Then `npm run check`.

- [ ] **Step 11: Commit.**

```bash
git add -- src/scripts/cbam-ui/motion.ts src/scripts/cbam-ui/views.ts src/styles/cbam-ill.css src/styles/cbam-app.css tests/unit/cbam-motion.test.mjs tests/unit/cbam-motion-css.test.mjs
git commit -m "feat(cbam): entry animation replays on every view entry; transform/opacity only; rail collapse snaps (spec §8.3, P5-5, P5-6)"
```

---

### Task 6: Shared e2e helpers and the motion spec

**Budget:** 35 min. **Files:**
- Create (or extend, if Task 1 (f) found one): `tests/e2e/cbam-helpers.ts`
- Modify: `tests/e2e/cbam-shell.spec.ts` (import the moved helpers; no assertion changes)
- Create: `tests/e2e/cbam-motion.spec.ts`

- [ ] **Step 1: The helpers.** If Task 1 (f) found shared helpers already, add only what is missing from the block below to that module and import from it. Otherwise create `tests/e2e/cbam-helpers.ts` with this content, **copying the body of `priceLine` from `cbam-shell.spec.ts` as it stands after phase 4** if it differs from the phase-1 body shown here (phase 2 may have changed how a route is chosen; that body is the one known to work). `priceWith` must use the same mechanism and the same readiness wait as that `priceLine`.

```ts
// tests/e2e/cbam-helpers.ts — shared by the CBAM specs (phase 5).
import { expect, type Page } from '@playwright/test';

export const CBAM_URL = '/cbam/cbam-calculator/';
export const VIEW_NAMES = ['estimate', 'three-years', 'why', 'list', 'export', 'rules'] as const;
export type ViewName = (typeof VIEW_NAMES)[number];

/** By the rail on desktop; by the tab bar (and More) on a phone, as a reader would. */
export async function view(page: Page, name: ViewName): Promise<void> {
  const phone = (page.viewportSize()?.width ?? 1440) < 900;
  if (!phone) {
    await page.locator(`.cbx-rail [data-goto="${name}"]`).click();
  } else if (name === 'export' || name === 'rules') {
    await page.locator('.cbx-more > summary').click();
    await page.locator(`.cbx-more [data-goto="${name}"]`).click();
  } else {
    await page.locator(`.cbx-tabs [data-goto="${name}"]`).click();
  }
  await expect(page.locator(`[data-view="${name}"]`)).toBeVisible();
}

/** Cement, Algeria, route (A), 100 t: priced on Commission defaults, and above the 50 t threshold. */
export async function priceLine(page: Page): Promise<void> {
  await page.fill('#cbCn', '2523100090');
  await page.dispatchEvent('#cbCn', 'change');
  await page.fill('#cbDate', '2026-03-15');
  await expect(page.locator('#cbCountry option[value="DZ"]')).toBeAttached();
  await page.selectOption('#cbCountry', 'DZ');
  await expect(page.locator('#cbRoute option[value="(A)"]')).toBeAttached();
  await page.selectOption('#cbRoute', '(A)');
  await page.fill('#cbMass', '100');
  await expect(page.locator('#cbOut .cb-cost')).toBeVisible();
}

export interface RefLine { cn: string; country: string; route: string | null; mass: string; date: string }

/** The reference screens' INPUTS (preview NOTES.md), so shots compare like with like. No figure is asserted. */
export const REFERENCE_LINES: readonly RefLine[] = [
  { cn: '73063077', country: 'IN', route: '(C)', mass: '100', date: '2026-03-15' },
  { cn: '25232900', country: 'IN', route: null, mass: '120', date: '2026-05-12' },
  { cn: '76011010', country: 'IN', route: '(K)', mass: '40', date: '2026-08-03' },
];

/** route null: the first route the pack offers (cement prints "default" in the reference). */
export async function priceWith(page: Page, l: RefLine): Promise<void> {
  await page.fill('#cbCn', l.cn);
  await page.dispatchEvent('#cbCn', 'change');
  await page.fill('#cbDate', l.date);
  await expect(page.locator(`#cbCountry option[value="${l.country}"]`)).toBeAttached();
  await page.selectOption('#cbCountry', l.country);
  const route = l.route ?? await page.locator('#cbRoute option:not([value=""])').first().getAttribute('value');
  if (route) {
    await expect(page.locator(`#cbRoute option[value="${route}"]`)).toBeAttached();
    await page.selectOption('#cbRoute', route);
  }
  await page.fill('#cbMass', l.mass);
  await expect(page.locator('#cbOut .cb-cost')).toBeVisible();
}
```

In `cbam-shell.spec.ts`, delete its local `URL`, `view` and `priceLine` and import `CBAM_URL as URL`, `view`, `priceLine` from `./cbam-helpers`. No test body changes.

- [ ] **Step 2: The motion spec.**

```ts
// tests/e2e/cbam-motion.spec.ts — spec §8.3 (entry motion) and §9 (first paint with the pack loading).
import { expect, test, type Page } from '@playwright/test';
import { CBAM_URL, VIEW_NAMES, priceLine, view, type ViewName } from './cbam-helpers';

const entry = (page: Page, v: ViewName) => page.evaluate((name) => {
  const sec = document.querySelector(`[data-view="${name}"]`)!;
  const anims = sec.getAnimations({ subtree: true }).filter((a) => 'animationName' in a);
  return { on: sec.classList.contains('b-anim'), n: anims.length, early: anims.filter((a) => Number(a.currentTime ?? 0) < 600).length };
}, v);

test.describe('CBAM entry motion', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('entering a view replays the entry animation, and the class leaves when it ends', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(CBAM_URL);
    await priceLine(page);
    await view(page, 'why');
    const first = await entry(page, 'why');
    expect(first.on).toBe(true);
    expect(first.n).toBeGreaterThan(0);
    await expect(page.locator('[data-view="why"]')).not.toHaveClass(/\bb-anim\b/, { timeout: 8_000 });
    await view(page, 'estimate');
    await view(page, 'why');
    const again = await entry(page, 'why');
    expect(again.on).toBe(true);
    expect(again.early).toBeGreaterThan(0);   // restarted, not resumed
  });

  test('every entry animation on every view touches transform and opacity only', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(CBAM_URL);
    await priceLine(page);
    await page.click('#cbAdd');
    const seen = new Set<string>();
    let total = 0;
    for (const v of VIEW_NAMES) {
      await view(page, v);
      const r = await page.evaluate((name) => {
        const keys: string[] = [];
        const anims = document.querySelector(`[data-view="${name}"]`)!.getAnimations({ subtree: true }).filter((a) => 'animationName' in a);
        for (const a of anims) for (const kf of (a.effect as KeyframeEffect).getKeyframes()) keys.push(...Object.keys(kf));
        return { keys, n: anims.length };
      }, v);
      r.keys.forEach((k) => seen.add(k));
      total += r.n;
    }
    expect(total).toBeGreaterThan(0);
    const META = new Set(['offset', 'computedOffset', 'easing', 'composite']);
    for (const k of seen) if (!META.has(k)) expect(['opacity', 'transform'], `animated property ${k}`).toContain(k);
  });

  test('reduced motion switches every entry animation off', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(CBAM_URL);
    await priceLine(page);
    for (const v of ['why', 'estimate'] as const) {
      await view(page, v);
      expect((await entry(page, v)).n, v).toBe(0);
    }
  });

  test('stagger indices are set on every render', async ({ page }) => {
    await page.goto(CBAM_URL);
    await priceLine(page);
    await view(page, 'why');
    const read = () => page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-view="why"] .b-waffle > *'))
      .map((c) => ({ i: c.style.getPropertyValue('--i'), old: c.dataset.old === '1' })));
    const before = await read();
    expect(before.length).toBeGreaterThan(0);
    expect(before.map((c) => c.i)).toEqual(before.map((_, i) => String(i)));
    await page.evaluate(() => document.querySelectorAll<HTMLElement>('[data-view="why"] .b-waffle > *').forEach((c) => { c.dataset.old = '1'; }));
    await view(page, 'estimate');
    await page.fill('#cbMass', '200');
    await view(page, 'why');
    const after = await read();
    expect(after.some((c) => c.old)).toBe(false);   // the waffle really was re-rendered
    expect(after.map((c) => c.i)).toEqual(after.map((_, i) => String(i)));
  });

  test('spec §9: the shell paints while the pack is still loading', async ({ page }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    await page.route('**/*estimator-pack*.json', async (route) => { await held; await route.continue(); });
    await page.goto(CBAM_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.cbx-rail')).toBeVisible();
    await expect(page.locator('#cbxH-estimate')).toBeVisible();
    release();
  });
});
```

If the "re-rendered" assertion fails because phase 3 does not re-render the waffle on a mass change, change the trigger to one that does (a different date year, read from `tiles-why.ts`) and note it in the report; do not drop the assertion.

- [ ] **Step 3: Run it in the foreground** (Bash `timeout` 600000):

```bash
npm run build && npx playwright test tests/e2e/cbam-motion.spec.ts tests/e2e/cbam-shell.spec.ts --project=chromium-tier0 --reporter=line
```

Expected: all pass (5 new; the shell count unchanged).

- [ ] **Step 4: Commit.**

```bash
git add -- tests/e2e/cbam-helpers.ts tests/e2e/cbam-shell.spec.ts tests/e2e/cbam-motion.spec.ts
git commit -m "test(cbam): entry motion replays, transform/opacity only, off under reduced motion; first paint without the pack"
```

---

### Task 7: Presence and overlap at 1440, 1280, 1024 and 390 px; phone polish

**Budget:** 45 min. **Files:**
- Create: `tests/e2e/cbam-ill.spec.ts`
- Modify: `src/styles/cbam-ill.css` (only as the failures direct)

Spec §8.2 names 1440, 1280 and 390. 1024 is added because the Estimate grid and the bento both change columns at 1100 px.

- [ ] **Step 1: The spec.**

```ts
// tests/e2e/cbam-ill.spec.ts — spec §8.1-8.2: each illustration on its tile; none over a word.
import { expect, test, type Page } from '@playwright/test';
import { CBAM_URL, priceLine, view, type ViewName } from './cbam-helpers';

/** The table settled in plan 05 (P5-1). priceLine prices cement, so step 1 shows the bag. */
const EXPECT: ReadonlyArray<readonly [ViewName, string, string]> = [
  ['estimate', 'good-bag', 'Good.'], ['estimate', 'origin', 'Origin & route.'], ['estimate', 'date', 'Import date.'],
  ['estimate', 'mass', 'Net mass.'], ['estimate', 'fac', 'Chargeable.'], ['estimate', 'vou', 'Chargeable.'],
  ['why', 'steps', 'Mark-up share.'], ['why', 'scale', 'Charged.'],
  ['list', 'box', 'Total.'], ['list', 'gauge', 'Annual de minimis.'],
  ['rules', 'shield', 'Framing.'],
];

/** Every illustration in the visible view, as "view|name|its tile's title". */
const present = (page: Page, v: ViewName) => page.evaluate((name) =>
  Array.from(document.querySelectorAll<SVGSVGElement>(`[data-view="${name}"] svg.b-ill, [data-view="${name}"] svg[data-ill="shield"]`))
    .map((s) => `${name}|${s.dataset.ill}|${s.closest('.b-t')?.querySelector('.b-t-ti')?.textContent?.trim() ?? '(no tile)'}`), v);

/** Each drawn shape of each illustration against every word and control in its tile. */
const overlaps = (page: Page, v: ViewName) => page.evaluate((name) => {
  const out: string[] = [];
  const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  for (const svg of Array.from(document.querySelectorAll<SVGSVGElement>(`[data-view="${name}"] svg.b-ill`))) {
    const tile = svg.closest('.b-t');
    if (!tile) { out.push(`${svg.dataset.ill}: not inside a tile`); continue; }
    const shapes = Array.from(svg.children).map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0 || r.height > 0);
    const marks: { what: string; r: DOMRect }[] = [];
    const walk = document.createTreeWalker(tile, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = n.textContent?.trim();
      if (!t || n.parentElement?.closest('svg')) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) if (r.width && r.height) marks.push({ what: `"${t.slice(0, 40)}"`, r });
    }
    for (const el of Array.from(tile.querySelectorAll<HTMLElement>('button, input, select, .b-thr, .b-share, .b-waffle, .b-fp'))) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) marks.push({ what: `<${el.tagName.toLowerCase()} ${el.className}>`, r });
    }
    for (const m of marks) if (shapes.some((s) => hit(s, m.r))) out.push(`${svg.dataset.ill} overlaps ${m.what}`);
  }
  return out;
}, v);

for (const [w, h] of [[1440, 900], [1280, 800], [1024, 768], [390, 844]] as const) {
  test(`illustrations sit on their tiles and never overlap a word at ${w} px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.emulateMedia({ reducedMotion: 'reduce' });   // final positions, not mid-rise
    await page.goto(CBAM_URL);
    await priceLine(page);
    await page.click('#cbAdd');
    const found: string[] = [];
    const problems: string[] = [];
    for (const v of ['estimate', 'why', 'list', 'export', 'rules'] as const) {
      await view(page, v);
      found.push(...await present(page, v));
      problems.push(...(await overlaps(page, v)).map((p) => `${v} @${w}: ${p}`));
    }
    expect(found.sort()).toEqual(EXPECT.map(([v, n, t]) => `${v}|${n}|${t}`).sort());
    expect(problems).toEqual([]);
  });
}
```

- [ ] **Step 2: Run it** (foreground, Bash timeout 600000):

```bash
npx playwright test tests/e2e/cbam-ill.spec.ts --project=chromium-tier0 --reporter=line 2>&1 | tee /Volumes/OBOSLab/tmp/cbam-rail-p5/ill-1.txt | tail -60
```

Expected before fixes: the 390 px run may still report overlaps that P5-7 did not cover; the presence table must already pass at every width (if it does not, the wiring of Task 3 or 4 is wrong: fix there).

- [ ] **Step 3: Fix each overlap with exactly one of these rules, in order.** Write the rule number next to each fix in the task report.
  1. **Phone (390 px):** add the illustration's class to the P5-7 in-flow selector in the `@media (max-width:899px)` block.
  2. **Desktop or 1024 px:** in a new `@media (max-width:1365px)` block (or `max-width:1099px` for a 1024-only failure), reduce that illustration's `width` in 20 px steps, down to no less than 96 px, re-running after each step.
  3. **Still overlapping at 96 px:** apply rule 1's in-flow treatment at that breakpoint.

  Never move or shrink the text; never hide an illustration. The reference's 1440 px positions are fixed: a 1440 px overlap means the tile's content differs from the reference, so **report it to the coordinator** instead of fixing it here.

- [ ] **Step 4: Re-run until green**, then once more to confirm it is stable.

- [ ] **Step 5: Commit.**

```bash
git add -- tests/e2e/cbam-ill.spec.ts src/styles/cbam-ill.css
git commit -m "fix(cbam): no illustration over a word at 1440/1280/1024/390; gauge and scale in flow on phone (spec §8.2, P5-7)"
```

---

### Task 8: Accessibility and contrast, every view, both themes, desktop and phone

**Budget:** 45 min. **Files:**
- Modify: `tests/e2e/core-accessibility.spec.ts`
- Modify: whatever CSS or markup the findings point to (no figure, wording or engine change)

- [ ] **Step 1: Add the CBAM block** at the end of `core-accessibility.spec.ts`. Merge these imports with the file's existing ones:

```ts
import { CBAM_URL, VIEW_NAMES, priceLine, view } from './cbam-helpers';
import { contrastFailures } from './obos-v2-helpers';
```

```ts
const WCAG = ['wcag2a', 'wcag2aa', 'wcag22aa'];

/** Spec §6.5 and §9: axe on the six views and the open good sheet; AA on both themes. */
test.describe('CBAM calculator', () => {
  async function open(page: Page, theme: 'light' | 'dark', width: number, height: number): Promise<void> {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => sessionStorage.setItem('delta:loaded', '1'));
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
    await page.goto(`${CBAM_URL}?theme=${theme}`);
    await priceLine(page);
    await page.click('#cbAdd');
  }

  for (const theme of ['light', 'dark'] as const) {
    for (const vp of [{ n: 'desktop', w: 1440, h: 900 }, { n: 'phone', w: 390, h: 844 }] as const) {
      test(`six views and the good sheet: no WCAG A/AA/2.2 AA violations · ${theme} · ${vp.n}`, async ({ page }) => {
        test.setTimeout(180_000);
        await open(page, theme, vp.w, vp.h);
        const found: string[] = [];
        const scan = async (label: string): Promise<void> => {
          const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
          for (const v of r.violations) found.push(`${label}: ${v.id} ×${v.nodes.length} ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
        };
        for (const v of VIEW_NAMES) { await view(page, v); await scan(v); }
        await view(page, 'estimate');
        await page.locator('[data-view="estimate"]').getByRole('button', { name: /change/i }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await scan('good sheet');
        expect(found).toEqual([]);
      });
    }

    test(`every word on every view meets AA against its own pixels · ${theme} · desktop`, async ({ page }) => {
      test.setTimeout(240_000);
      await open(page, theme, 1440, 900);
      const out: string[] = [];
      for (const v of VIEW_NAMES) {
        await view(page, v);
        const room = await page.evaluate(() => { const m = document.querySelector<HTMLElement>('.cbx-main')!; return m.scrollHeight - m.clientHeight; });
        for (const at of room > 24 ? [0, 0.5, 1] : [0]) {
          await page.evaluate((y) => { document.querySelector<HTMLElement>('.cbx-main')!.scrollTop = y; }, Math.round(room * at));
          await page.waitForTimeout(200);
          for (const f of await contrastFailures(page)) out.push(`${v} @${Math.round(at * 100)}%: ${f.ratio}:1 (needs ${f.floor}) ${f.px}px ${f.color} on ${f.ground} "${f.text}" ${f.path}`);
        }
      }
      expect([...new Set(out)]).toEqual([]);
    });
  }
});
```

The good-sheet trigger is the Good step's "Change" pill (spec §5.1). If phase 2 gave it a different accessible name, use that name and say so in the report.

- [ ] **Step 2: Run it** (foreground, Bash timeout 600000):

```bash
npx playwright test tests/e2e/core-accessibility.spec.ts --project=chromium-tier0 --grep "CBAM" --reporter=line 2>&1 | tee /Volumes/OBOSLab/tmp/cbam-rail-p5/a11y-1.txt | tail -80
```

Record each test's duration from the output: the pixel sweep runs in CI too, and the CI budget is tight (the `globalTimeout` note in `playwright.config.ts`). If either sweep takes over 90 s, report it; the coordinator decides whether it moves to a local-only project.

- [ ] **Step 3: Fix each finding at its source.** Allowed fixes: a token value, a colour on a selector, a missing label/`aria-*`, a heading level, a focus style. **Not allowed:** disabling an axe rule, adding a test exclusion, changing a figure, changing user-facing wording, or touching the engine. A bronze or cyan text failure means a token is wrong for that ground; the AA values measured for the reference are in `preview/NOTES.md` ("Contrast, WCAG"), and the fix must keep the colour law (bronze = defaults and mark-up, cyan = verified). List every fix in the report.

- [ ] **Step 4: Re-run until green; commit.**

```bash
git add -- tests/e2e/core-accessibility.spec.ts <each file you fixed, by name>
git commit -m "test(cbam): axe on six views and the good sheet, light/dark, desktop/phone; AA pixel sweep (spec §6.5, §9)"
```

---

### Task 9: Perf, measured off-screen (local only)

**Budget:** 40 min. **Files:**
- Modify: `playwright.config.ts`
- Create: `tests/e2e/cbam-perf.spec.ts`

What this measures: spec §9 asks that the entry animation hold 60 fps on a mid-range laptop profile with no layout thrash. A GitHub runner has no GPU, so this runs **locally**, in Chromium's new headless mode on Metal (no window), with the CPU throttled 4× through CDP as the mid-range profile. It asserts zero long tasks after the entry frame and no frame over 50 ms; it asserts p95 ≤ 20 ms only when frames are vsync-paced (median ≥ 12 ms), and otherwise says so in the JSON. The layout count during the animation is **reported, not asserted**: the illustrations animate SVG children, which Chromium runs on the main thread, and whether that triggers SVG layout per frame is exactly what this run measures (see the risk list).

- [ ] **Step 1: The project.** In `playwright.config.ts`, add `'**/cbam-perf.spec.ts'` to `chromium-tier0`'s `testIgnore` array, and add this project after `chromium-v2-relief`:

```ts
    /* CBAM entry-motion perf (plan 05, Task 9). LOCAL ONLY: a runner has no GPU. New headless on
       Metal, the founder's no-window rule, exactly as chromium-v2-relief. */
    ...(process.env.CI ? [] : [{
      name: 'chromium-cbam-perf',
      testMatch: ['**/cbam-perf.spec.ts'],
      use: { ...devices['Desktop Chrome'], headless: false, launchOptions: { args: [...PERF_METAL] } },
    }]),
```

- [ ] **Step 2: The spec.**

```ts
// tests/e2e/cbam-perf.spec.ts — spec §9 perf: the entry animation, measured. Local only (chromium-cbam-perf).
// CBAM_PERF_DIR=/Volumes/OBOSLab/cbam-rail-ui/perf npx playwright test cbam-perf --project=chromium-cbam-perf
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { CBAM_URL, VIEW_NAMES, priceLine } from './cbam-helpers';

const DIR = process.env.CBAM_PERF_DIR ?? '';
const pct = (xs: number[], p: number): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };

test('entering each view: no long task and no long frame while the entry animation plays', async ({ page }) => {
  test.skip(!DIR, 'set CBAM_PERF_DIR to run the perf measurement');
  test.setTimeout(300_000);
  mkdirSync(DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const w = window as unknown as { __lt: number[][]; __loaf: number[][] };
    w.__lt = []; w.__loaf = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__loaf.push([e.startTime, e.duration]); }).observe({ type: 'long-animation-frame', buffered: true }); } catch { /* not supported */ }
  });
  await page.goto(CBAM_URL);
  await priceLine(page);
  await page.click('#cbAdd');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Performance.enable');
  const layouts = async (): Promise<number> => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'LayoutCount')?.value ?? 0;
  const rows: Record<string, unknown>[] = [];
  const late: string[] = [];
  for (let round = 0; round < 3; round++) {
    for (const v of VIEW_NAMES) {
      const l0 = await layouts();
      const t0 = await page.evaluate(() => performance.now());
      await page.locator(`.cbx-rail [data-goto="${v}"]`).click();
      const frames = await page.evaluate(() => new Promise<number[]>((done) => {
        const d: number[] = []; let last = performance.now(); const end = last + 2200;
        const tick = (t: number): void => { d.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else done(d); };
        requestAnimationFrame(tick);
      }));
      const l1 = await layouts();
      const { lt, loaf } = await page.evaluate((s) => {
        const w = window as unknown as { __lt: number[][]; __loaf: number[][] };
        return { lt: w.__lt.filter(([st]) => st >= s + 150), loaf: w.__loaf.filter(([st]) => st >= s + 150) };
      }, t0);
      const body = frames.slice(3);   // the entry frame and the two after it carry the click itself
      const median = pct(body, 0.5);
      const row = { view: v, round, frames: body.length, median, p95: pct(body, 0.95), max: Math.max(...body), longTasks: lt, longFrames: loaf, layoutsDuringAnimation: l1 - l0, vsync: median >= 12 };
      rows.push(row);
      if (lt.length) late.push(`${v} r${round}: long tasks ${JSON.stringify(lt)}`);
      if (row.max >= 50) late.push(`${v} r${round}: frame ${row.max.toFixed(1)} ms`);
      if (row.vsync && row.p95 > 20) late.push(`${v} r${round}: p95 ${row.p95.toFixed(1)} ms`);
    }
  }
  writeFileSync(join(DIR, `cbam-entry-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
    JSON.stringify({ label: 'new-headless Metal (no window), CPU throttled 4x', viewport: '1440x900', rows }, null, 2));
  expect(late).toEqual([]);
});
```

- [ ] **Step 3: Run it in the foreground** (Bash timeout 600000), once the machine is otherwise quiet (no other Playwright, Blender or build running; check with `ps -axo pcpu,comm | sort -rn | head -5`):

```bash
npm run build && CBAM_PERF_DIR=/Volumes/OBOSLab/cbam-rail-ui/perf npx playwright test tests/e2e/cbam-perf.spec.ts --project=chromium-cbam-perf --reporter=line
```

- [ ] **Step 4: Read the JSON and report**, per view: median, p95, max frame, long tasks, `layoutsDuringAnimation`, `vsync`. If `layoutsDuringAnimation` grows with the frame count (tens per view rather than a handful), say so plainly: it means the SVG-child animations lay out every frame. **Do not change the motion in this task**; that is a design decision for the coordinator (the alternative is animating each `<svg>` element as one, which loses the per-shape stagger the founder approved).

- [ ] **Step 5: Confirm CI ignores it:** `CI=1 npx playwright test --list 2>/dev/null | grep -c cbam-perf` prints `0`. Commit.

```bash
git add -- playwright.config.ts tests/e2e/cbam-perf.spec.ts
git commit -m "test(cbam): local off-screen perf for the entry motion: long tasks, frames, layout count (spec §9)"
```

---

### Task 10: Screenshots against the reference (Opus compares)

**Budget:** 45 min (Sonnet takes the shots, ~15 min; Opus compares, ~30 min). **Files:**
- Create: `tests/e2e/cbam-shots.spec.ts`

- [ ] **Step 1: The shots spec.** File names mirror `screens/` so each pair lines up.

```ts
// tests/e2e/cbam-shots.spec.ts — headless screenshots named like the reference screens (not a CI test).
// CBAM_SHOTS_DIR=/Volumes/OBOSLab/cbam-rail-ui/shots/<date> npx playwright test cbam-shots --project=chromium-tier0
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { CBAM_URL, REFERENCE_LINES, priceWith, view, type ViewName } from './cbam-helpers';

const DIR = process.env.CBAM_SHOTS_DIR ?? '';
const NUM: Record<ViewName, string> = { estimate: '1', 'three-years': '2', why: '3', list: '4', export: '5', rules: '6' };

for (const theme of ['light', 'dark'] as const) {
  for (const device of ['desktop', 'phone'] as const) {
    test(`reference-named shots · ${theme} · ${device}`, async ({ page }) => {
      test.skip(!DIR, 'set CBAM_SHOTS_DIR to write screenshots');
      test.setTimeout(240_000);
      mkdirSync(DIR, { recursive: true });
      await page.setViewportSize(device === 'desktop' ? { width: 1440, height: 1800 } : { width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
      await page.goto(`${CBAM_URL}?theme=${theme}`);
      if (device === 'desktop') {
        // The reference's empty state is Three years before any line is priced.
        await view(page, 'three-years');
        await page.screenshot({ path: join(DIR, `8-empty-state-desktop-${theme}.png`) });
        await view(page, 'estimate');
      }
      for (const l of REFERENCE_LINES) { await priceWith(page, l); await page.click('#cbAdd'); }
      await priceWith(page, REFERENCE_LINES[0]);   // the draft on screen, as in the reference
      for (const v of Object.keys(NUM) as ViewName[]) {
        await view(page, v);
        await page.screenshot({ path: join(DIR, `${NUM[v]}-${v}-${device}-${theme}.png`) });
      }
      if (device === 'desktop') {
        await view(page, 'estimate');
        await page.locator('[data-view="estimate"]').getByRole('button', { name: /change/i }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.screenshot({ path: join(DIR, `7-good-sheet-desktop-${theme}.png`) });
      }
    });
  }
}
```

- [ ] **Step 2: Take them** (foreground, Bash timeout 600000):

```bash
D=/Volumes/OBOSLab/cbam-rail-ui/shots/$(date +%Y-%m-%d)
CBAM_SHOTS_DIR=$D npx playwright test tests/e2e/cbam-shots.spec.ts --project=chromium-tier0 --reporter=line && ls $D | wc -l
```

Expected: 28 files (6 views × 2 themes × 2 devices, plus 2 good-sheet and 2 empty-state), matching the reference's 28. Commit the spec only:

```bash
git add -- tests/e2e/cbam-shots.spec.ts
git commit -m "test(cbam): env-gated headless shots named like the reference screens"
```

- [ ] **Step 3: Opus compares, pair by pair.** Dispatch an Opus 5.5 agent with: this step's text, the reference README, and the two folders (`/Volumes/VSTSAMPLES/Projects/Angad/docs/superpowers/specs/2026-11-02-cbam-rail-ui/screens/` and the shots folder). It reads each pair with the Read tool and returns one table row per pair: **match**, **deviation to fix** (what, where, which file probably), or **accepted difference** with its reason. Accepted differences are only these, from the README and spec: figures and dates (engine output; the inputs match but nothing is asserted), refusal/idle states the preview lacks, inline editors instead of the Origin/Date/Mass/Data sheets, the §7.1 banner and eyebrow while D1 is open, the de minimis citation text, the short good names (D5: the build shows the clamped CN description), the illustration decisions P5-2/P5-3/P5-7, and the rail collapse (P5-5). Checks per pair: illustration placement and size, no illustration over a word, tile order and spans, type scale, spacing, plate colours, the tones of every drawing in both themes.

- [ ] **Step 4: Fix each "deviation to fix"** as a separate small task (Sonnet), each re-shot and re-compared on that pair only. Any deviation whose fix would change spacing or type globally goes to the coordinator first.

---

### Task 11: Phase gate, Opus phase review, PR into the integration branch

**Budget:** 30 min. **Files:** none new.

- [ ] **Step 1: The local gate** (foreground, Bash timeout 600000 each):

```bash
cd /Volumes/OBOSLab/worktrees/cbam-rail-ui-p5
npm run build && npm run check && npm run test:unit 2>&1 | tail -5
npx playwright test tests/e2e/cbam-shell.spec.ts tests/e2e/cbam-lines.spec.ts tests/e2e/cbam-motion.spec.ts tests/e2e/cbam-ill.spec.ts --project=chromium-tier0 --reporter=line
npx playwright test tests/e2e/core-accessibility.spec.ts --project=chromium-tier0 --reporter=line
npx playwright test --project=firefox-cbam --reporter=line
```

Expected: all green. Unit count = Task 1 baseline + 9 (illustrations) + 7 (motion) + 4 (motion CSS) + the gap tests Task 4 reported; state the arithmetic in the report.

- [ ] **Step 2: Opus phase review.** Dispatch Opus 5.5 with this plan, spec §4.3, §6.5, §8 and §9, and `git diff feat/cbam-rail-ui...HEAD`. Ask it to confirm, with file:line evidence:
  - every row of the settled illustration table is wired, and nothing else is;
  - no illustration appears on an idle/refused/withheld branch, and the gauge only on `above_threshold`;
  - no assertion anywhere was loosened or deleted (diff every `tests/` file);
  - the golden fixture was generated, not hand-edited (re-run the Task 2 script and `git diff --exit-code tests/unit/fixtures/cbam-ill-golden.json`);
  - `cbam-ill.css` keyframes and `.b-anim` rules match the reference's `bento.css` animation block, except `.b-needle` and the `.cbx` scope.

  Fix what it confirms.

- [ ] **Step 3: Push and open the PR into `feat/cbam-rail-ui`. Only on the user's word.**

```bash
git log --oneline feat/cbam-rail-ui..HEAD
git push -u origin feat/cbam-rail-ui-p5
gh pr create --base feat/cbam-rail-ui --head feat/cbam-rail-ui-p5 --title "CBAM rail redesign, phase 5: illustrations, motion, phone polish, a11y/contrast/perf" --body-file /Volumes/OBOSLab/tmp/cbam-rail-p5/pr-p5.md
```

Write `pr-p5.md` from the decisions table, the settled illustration table, the gate output and the perf JSON summary, ending with the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Merge it once CI is green and the user agrees.

---

### Task 12: Independent audit of the whole branch against spec §6 (Opus)

**Budget:** 60 min. **Model:** Opus 5.5, fresh context. **Output:** `/Volumes/VSTSAMPLES/Projects/Angad/docs/research/<YYYY-MM-DD>-cbam-rail-ui-audit.md` (untracked in the main checkout, like `2026-11-02-cbam-audit.md`).

Hand the auditor **only** what follows plus the spec, the roadmap and the paths named. Do not give it this plan's conclusions, the phase PR bodies or the builders' reports: the audit must not be anchored on them.

> You are auditing the CBAM Calculator redesign, branch `feat/cbam-rail-ui` against `origin/main`, for honesty and behaviour regressions. Work in a fresh worktree: `git -C /Volumes/VSTSAMPLES/Projects/Angad worktree add /Volumes/OBOSLab/worktrees/cbam-rail-ui-audit feat/cbam-rail-ui && cd /Volumes/OBOSLab/worktrees/cbam-rail-ui-audit && npm ci`. Read the spec `docs/superpowers/specs/2026-11-02-cbam-rail-ui-design.md` (at `/Volumes/VSTSAMPLES/Projects/Angad/`), all of it, §3, §6 and §7 closely. Also read `/Volumes/VSTSAMPLES/Projects/Angad/docs/research/2026-11-02-cbam-audit.md` and the open-defects ledger `/Users/antarikshakumar/.claude/projects/-Volumes-VSTSAMPLES-Projects-Angad/memory/cbam-open-defects.md`. Every claim you make carries file:line evidence or a command and its output. Grep; never count from memory. Run Playwright only in the foreground, headless, with the Bash tool's timeout; never open a visible browser.
>
> Check, in this order:
> 1. **Engine verbatim (§3).** `node scripts/cbam-sync-check.mjs`. List the files in `src/scripts/cbam-algos/UPSTREAM.json` and show `git diff --stat origin/main...HEAD -- <each>` is empty.
> 2. **Every tile has its refusal (§6.1).** For each tile in §5's tables: name its model, list every state the model can return (read its return type), and point to the renderer branch and the unit test that pins each state. Then account for every assertion in `git show origin/main:tests/unit/cbam-render.test.mjs`: a table, old assertion → the test that carries it now, or "MISSING". A loosened assertion counts as missing.
> 3. **The §7.1 banner (§6.2).** Extract `<div class="cb-banner" role="note"> … </div>` from `src/pages/cbam/cbam-calculator.astro` on both refs and diff them byte for byte; confirm it occurs once and sits before `cb-grid`; confirm the eyebrow `<p class="cb-eyebrow">` is present (decision D1 is open unless the spec says otherwise).
> 4. **The draft always previews (§6.3).** Read the code path; run `npx playwright test tests/e2e/cbam-shell.spec.ts --project=chromium-tier0`. Check `#cbStatus` is outside every view, `#cbOutWrap` is `aria-live="polite"`, `#cbList` is `aria-live="off"`, and removing the last line focuses the list heading.
> 5. **Ids and hooks (§6.4).** After `npm run build`, for each id in §6.4 print its count in `dist/cbam/cbam-calculator/index.html`; for the generated ones (`cbOlPrice`, `cgSecond`) show the renderer line. Every `data-*` hook in §6.4 exists with the same meaning.
> 6. **Accessibility (§6.5).** Radio groups with arrow keys and `aria-checked`; the good sheet is a labelled modal dialog with a focus trap and focus return; every chart has a table equivalent; every illustration is `aria-hidden`; reduced motion stops all entry animation; the M3 fix (a year with no rules is explained in text).
> 7. **Colour law and no invented figures (§3, §4.3).** No illustration uses bronze or cyan; bronze marks only Commission defaults and the mark-up, cyan only verified figures. Every figure on every tile traces to a §7 model; list any that does not. Short good names (D5) and the method footnote count (D4) are not invented.
> 8. **Non-goals (§3).** `git diff origin/main...HEAD -- package.json package-lock.json` adds no runtime dependency; `buildPrintDocument` and the CSV columns are unchanged (diff those functions).
> 9. **Pictures that claim something.** For every illustration and pictogram, say whether it can contradict the figure or verdict beside it in any state (for example, the de minimis gauge on a below-threshold year; the mark-up staircase on a verified line).
> 10. **The ledger.** For each open item in the defects ledger and the 11-02 audit, say whether the new UI still shows it, fixes it, or makes it worse.
>
> Grade each finding **Blocker** (a false or misleading statement to the user, an honesty regression, a lost assertion, an engine change), **Major** (a behaviour or accessibility regression), or **Minor**. Write the report as: summary counts; one section per check with the evidence; a findings table (id, grade, file:line, what, how to reproduce, suggested fix). Do not edit any code.

---

### Task 13: Fix the audit's findings; re-audit

**Budget:** 30 min per finding (Sonnet), 20 min per re-check (Opus).

- [ ] **Step 1:** For every **Blocker** and **Major**, create one task containing only: the finding's text from the audit, the files it names, and the rule "write a failing test that reproduces it first, then fix, then show the test passing". Sonnet builds each on `feat/cbam-rail-ui-p5` (or a new `feat/cbam-rail-ui-p5-fix` branch if p5 has merged), one commit per finding, message `fix(cbam): <audit id> <what>`.
- [ ] **Step 2:** Opus re-checks each fix against its finding, with the same evidence standard, and marks it closed or reopened in the audit file (append a "Re-audit" section; do not rewrite the original findings).
- [ ] **Step 3:** **Minor** findings go to the founder's list in the release PR body, each with the coordinator's recommendation; they are fixed only if he says so.
- [ ] **Step 4:** Re-run Task 11 step 1's gate. The release is blocked until Blockers = 0 and Majors = 0.

---

### Task 14: Release, on the founder's word only

**Budget:** 30 min plus CI time. **Files:** the spec folder and plans (committed for the record), the PR body.

- [ ] **Step 1: Preconditions, each with its evidence in the report.**
  - phase 5 and every audit fix are merged into `feat/cbam-rail-ui`; CI on its head is green (`gh run list --branch feat/cbam-rail-ui --limit 3`);
  - the audit file shows Blockers 0 and Majors 0 after re-audit;
  - the status of D1–D6 and P5-1–P5-7 is written down: decided by whom and when, or still on its default;
  - **the founder has said to release.** Quote his message (date and words). No word, no release: stop here.

- [ ] **Step 2: Commit the spec, reference and plans** onto the integration branch so the PR's links resolve (they are untracked in the main checkout today). Work in the integration worktree, which has `feat/cbam-rail-ui` checked out (git refuses to check one branch out in two worktrees). First confirm no other session is using it: `git -C /Volumes/OBOSLab/worktrees/cbam-rail-ui status --short` prints nothing; then `cd /Volumes/OBOSLab/worktrees/cbam-rail-ui && git pull --ff-only`, and:

```bash
cp /Volumes/VSTSAMPLES/Projects/Angad/docs/superpowers/specs/2026-11-02-cbam-rail-ui-design.md docs/superpowers/specs/
cp -R /Volumes/VSTSAMPLES/Projects/Angad/docs/superpowers/specs/2026-11-02-cbam-rail-ui docs/superpowers/specs/
cp /Volumes/VSTSAMPLES/Projects/Angad/docs/superpowers/plans/2026-11-02-cbam-rail-ui-0*.md docs/superpowers/plans/
git add -- docs/superpowers/specs/2026-11-02-cbam-rail-ui-design.md docs/superpowers/specs/2026-11-02-cbam-rail-ui docs/superpowers/plans/2026-11-02-cbam-rail-ui-0*.md
git commit -m "docs(cbam): rail redesign spec, approved visual reference and phase plans"
git push origin feat/cbam-rail-ui
```

Check first that the reference folder has no file over 5 MB (`find docs/superpowers/specs/2026-11-02-cbam-rail-ui -size +5M`); report any.

- [ ] **Step 3: Update the draft PR** opened in phase 1 (`gh pr list --head feat/cbam-rail-ui --state open`). Write the body below to `/Volumes/OBOSLab/tmp/cbam-rail-p5/pr-release.md`, filling every `<…>` from evidence, then:

```bash
gh pr edit <n> --title "CBAM Calculator: rail and bento redesign" --body-file /Volumes/OBOSLab/tmp/cbam-rail-p5/pr-release.md
gh pr ready <n>
gh pr checks <n>
```

**PR body template:**

```markdown
## CBAM Calculator: rail and bento redesign

Spec: `docs/superpowers/specs/2026-11-02-cbam-rail-ui-design.md` · Approved reference: `docs/superpowers/specs/2026-11-02-cbam-rail-ui/` · Plans: `docs/superpowers/plans/2026-11-02-cbam-rail-ui-0*.md`

### What changes for the user
- The calculator is a full-screen app with a left rail of six views: Estimate, Three years, Why it changes, Shipment list, Export, Rules & sources. The view lives in the URL hash. On a phone, a top bar and a bottom tab bar replace the rail.
- Estimate: the inputs are a numbered column ("Your line.", steps 1–5) and the results are tiles beside it. The good is chosen in a searchable sheet.
- Three years, Why it changes, Shipment list, Export and Rules are bento tiles with monotone illustrations and a short entry animation (off under reduced motion).
- **One behaviour change (spec §6.3):** the line being edited always previews, also when lines are already in the list. The list has its own view.

### What does not change
- The engine: every file in `UPSTREAM.json` is byte-identical (`cbam-sync-check` green).
- Every figure comes from a model that existed before (spec §7). The print document and the CSV columns are unchanged.
- The §7.1 banner: <"verbatim, full, on Estimate (D1 open)" | "folded per the CEO's approval of <date>">.

### Decisions
| # | Decision | Status |
|---|---|---|
| D1 | Banner fold and the "Provisional" eyebrow | <default kept / approved by … on …> |
| D2 | Cascade and step chart cut from Why | <…> |
| D3 | Palette and the verified colour | <…> |
| D4 | Method footnote count | <measured figure, date> |
| D5 | Short good names | <…> |
| D6 | Guided first-time flow | <…> |
| P5-1 | Illustrations placed as in the approved reference, not the spec's §8.1 table | <…> |
| P5-2 | No illustration on idle/refused/withheld tiles | <…> |
| P5-3 | De minimis gauge only above the threshold | <…> |
| P5-4 | No step pictogram for fertilisers and hydrogen | <…> |
| P5-5 | Rail collapse snaps (no width/left animation) | <…> |
| P5-6 | Entry-animation class leaves once the animation ends | <…> |
| P5-7 | Phone: gauge and scale in flow under the tile header | <…> |

### Evidence
- Unit tests: <N> pass on this branch (main: <M>). Every one of the <K> assertions in `cbam-render.test.mjs` on main is carried; the table is in the audit.
- Browser tests (CI): <run link>. Firefox: <run link>. WebKit: local run <date>, <result>.
- Accessibility: axe, WCAG A/AA/2.2 AA, six views and the good sheet × light/dark × desktop/phone: 0 violations. Pixel contrast sweep, desktop, both themes: 0 findings.
- Illustrations: present on their tiles and over no word at 1440, 1280, 1024 and 390 px.
- Motion: transform and opacity only (unit and browser tests). Perf, local new-headless Metal, CPU 4×: long tasks after the entry frame <0>; worst frame <x> ms; JSON `<path>`.
- Screens: `/Volumes/OBOSLab/cbam-rail-ui/shots/<date>/` compared pair by pair with the reference; deviations fixed or accepted: <list>.
- Independent audit: `docs/research/<date>-cbam-rail-ui-audit.md`: Blockers 0, Majors 0 after re-audit; Minor findings for the founder: <list>.

### Phases
Phase 0 (audit fixes) #<…> · Phase 1 shell (this branch) · Phase 2 #<…> · Phase 3 #<…> · Phase 4 #<…> · Phase 5 #<…>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 4: Merge, once CI is green and the founder has said so** (Step 1). Read what will land first; never `git push HEAD:main`.

```bash
git fetch origin && git log --oneline origin/main..origin/feat/cbam-rail-ui
gh pr merge <n> --merge
```

- [ ] **Step 5: Verify production on `deltaclimate.earth`.** Wait for the Vercel deploy of the merge commit (`gh run list --branch main --limit 3` and the PR's deployment status), then:

```bash
curl -sI https://deltaclimate.earth/cbam/cbam-calculator/ | head -1
curl -s https://deltaclimate.earth/cbam/cbam-calculator/ | grep -c 'class="cbx-rail"'
curl -s https://deltaclimate.earth/cbam/cbam-calculator/ | grep -c 'class="cb-banner" role="note"'
```

Expected: `HTTP/2 200`, `1`, `1`. (The suite's `baseURL` is the local preview server, so no Playwright run is pointed at production here.) Report the merge commit, the deploy id and the three results to the coordinator, who updates the project memory (CBAM UI redesign state).

---

## Self-review against the spec

| Spec | Task |
|---|---|
| §4.3 icon tones `--ic-*`, hero override, never bronze/cyan | 2 (unit test), 3 (tokens) |
| §6.1 every tile has its refusal (illustrations do not decorate refusals) | 4 (P5-2), 12 (check 2) |
| §6.2 banner and eyebrow | 12 (check 3), 14 (PR states D1) |
| §6.3 draft previews, status strip | 6 (shell spec kept green), 12 (check 4) |
| §6.4 ids and hooks | 12 (check 5) |
| §6.5 illustrations `aria-hidden`, reduced motion, AA on both themes | 2, 5, 6, 8 |
| §7 `illustrations.ts` from `ILL_*`, no `ILL_CERT` | 2 |
| §8.1 illustration → tile (settled against the reference, P5-1) | 2, 3, 4, 7 (presence table) |
| §8.2 positions from `.b-ill-*`; no overlap at 1440/1280/390 | 3, 7 (+1024) |
| §8.3 bRise/bGrowX/bGrowY/bPop/bNeedle/bSlide/bLift, easing, replay on entry, `--i` per render, reduced motion | 5, 6 |
| README phone gauge-needle overlap | 3 (P5-7), 7 |
| §9 axe across six views in both themes; AA contrast | 8 |
| §9 perf: 60 fps, no layout/paint thrash; first paint with the pack loading | 9, 6 |
| §9 visual: headless screens of every view, light/dark/phone, vs the reference | 10 |
| §9 CI is the browser gate; local = check + unit + targeted specs | Environment notes, 11 |
| §10 phase 5: independent audit, release on the founder's word | 12, 13, 14 |
| Roadmap rule 2: no assertion loosened | 2 (step 6), 4 (step 1), 11 (review), 12 (check 2) |

**Placeholder scan:** the only `<…>` markers are in the PR template (Task 14), filled from evidence at release time, and the phase PR numbers, which do not exist yet.

**Known dependencies on phases 2–4 (resolved by Task 1's inventory, not assumed):** where the input steps live (astro or TS), the renderer module and branch for each illustrated tile, the threshold verdict discriminant, the good-sheet trigger's accessible name, whether pictogram strings already exist, and the post-phase-4 `priceLine` mechanism.
