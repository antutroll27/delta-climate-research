# Idiomatic Tailwind Token Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace arbitrary-value brackets (`text-[0.6875rem]`, `gap-[1.25rem]`, `rounded-[14px]`) with named `@theme` tokens that generate native utilities (`text-tag`, `mt-3xs`, `rounded-card`) — pixel-identical.

**Architecture:** Add semantic tokens to `global.css`'s `@theme` (native namespaces so they generate utilities); migrate the existing fluid `--space-*` tokens to `--spacing-*`; then a per-component mechanical bracket→token/native swap, each verified by a byte-equal screenshot diff under reduced-motion. Animation/state CSS untouched.

**Tech Stack:** Astro, Tailwind v4 (`@tailwindcss/postcss`), puppeteer-core (temporary).

**Spec:** [`docs/superpowers/specs/2026-06-03-idiomatic-tailwind-tokens-design.md`](../specs/2026-06-03-idiomatic-tailwind-tokens-design.md)

---

## The master conversion map (every task references this)

**Type (font-size only):** `text-[0.6875rem]`→`text-tag` · `[0.75rem]`→`text-label` ·
`[0.78rem]`→`text-stream` · `[0.8125rem]`→`text-meta` · `[0.875rem]`→`text-body-sm` ·
`[0.9375rem]`→`text-note` · `[1.0625rem]`→`text-logo` · `[1.1rem]`→`text-arrow` ·
`[1.25rem]`→`text-cardtitle`.

**Spacing on-grid → native numeric:** `[0.5rem]`→`2` · `[1rem]`→`4` · `[1.25rem]`→`5` ·
`[1.5rem]`→`6` · `[1.75rem]`→`7` · `[2.5rem]`→`10` (applies to the utility prefix: `gap-`, `p-`,
`px-`, `pt-`, `mb-`, `mr-`, `mt-`). E.g. `gap-[1.25rem]`→`gap-5`, `mt-[2.5rem]`→`mt-10`.

**Spacing off-grid → t-shirt token:** `[0.2rem]`→`3xs` · `[0.3rem]`→`2xs` · `[0.55rem]`→`xs` ·
`[0.6rem]`→`sm` · `[0.85rem]`→`md` · `[0.9rem]`→`lg` · `[1.1rem]`→`xl` · `[1.4rem]`→`2xl`.
E.g. `mt-[0.6rem]`→`mt-sm`, `pb-[1.4rem]`→`pb-2xl`, `gap-[0.3rem]`→`gap-2xs`.

**Fluid clamp:** `py-[clamp(1.5rem,3vw,2.25rem)]`→`py-rowpad` (the `--spacing-rowpad` token).

**Radius:** `rounded-[14px]`→`rounded-card` · `rounded-[12px]`→`rounded-xl` (native) ·
`rounded-[8px]`→`rounded-lg` (native).

**Tracking:** `tracking-[0.1em]`→`tracking-widest` (native) · `[0.22em]`→`tracking-kicker` ·
`[0.14em]`→`tracking-tag` · `[0.08em]`→`tracking-label` · `[0.06em]`→`tracking-meta` ·
`[0.03em]`→`tracking-cta` · `[-0.01em]`→`tracking-title` · `[-0.02em]`→`tracking-display`.

**Leading:** `leading-[1.5]`→`leading-normal` (native) · `[1.6]`→`leading-body` ·
`[1.55]`→`leading-excerpt` · `[1.05]`→`leading-title` · `[1.04]`→`leading-headline`.

**Misc:** `shadow-[0_0_30px_rgb(244_246_248/0.45)]`→`shadow-glow` · `max-w-[1400px]`→`max-w-site` ·
`min-[900px]:`→`wide:` · `text-[color:var(--color-base)]`→`text-on-accent`.

**STAYS arbitrary (do not touch):** `max-w-[Nch]` (prose measures), `min-h-[100dvh]`, `z-[2]`,
`transition-[...]` property lists, and every animation/gradient/state rule in scoped `<style>`.

---

## Task 1: Screenshot harness + baseline (from current main)

**Files:** Create `scripts/_shot.mjs`, `scripts/_diff.mjs` (temporary, gitignored).

- [ ] **Step 1: Install puppeteer-core + gitignore artifacts**

Run: `npm install -D puppeteer-core@23`
Append to `.gitignore`:
```
# idiomatic-tailwind verification artifacts (temporary)
screenshots/
scripts/_shot.mjs
scripts/_diff.mjs
```

- [ ] **Step 2: Write `scripts/_shot.mjs`**

```js
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.SHOT_BASE || 'http://localhost:4321';
const OUT = process.env.SHOT_OUT || 'screenshots/current';
const PAGES = [['home', '/'], ['white-papers', '/white-papers']];
const SIZES = [['desktop', 1440, 900], ['mobile', 390, 844]];
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=1', '--hide-scrollbars'] });
for (const [pname, path] of PAGES) {
  for (const [sname, w, h] of SIZES) {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.goto(BASE + path, { waitUntil: 'networkidle0' });
    await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: `${OUT}/${pname}-${sname}.png`, fullPage: true });
    await page.close();
  }
}
await browser.close();
console.log('shots ->', OUT);
```

- [ ] **Step 3: Write `scripts/_diff.mjs`**

```js
import { readFileSync, existsSync } from 'node:fs';
const FILES = ['home-desktop', 'home-mobile', 'white-papers-desktop', 'white-papers-mobile'];
let fail = 0;
for (const f of FILES) {
  const a = `screenshots/baseline/${f}.png`, b = `screenshots/current/${f}.png`;
  if (!existsSync(a) || !existsSync(b)) { console.log(`MISSING ${f}`); fail++; continue; }
  const ba = readFileSync(a), bb = readFileSync(b);
  const same = ba.length === bb.length && ba.equals(bb);
  console.log(`${same ? 'OK  ' : 'DIFF'} ${f}`);
  if (!same) fail++;
}
console.log(fail ? `\n${fail} differ` : '\nALL MATCH');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 4: Capture baseline from the CURRENT build (pre-change)**

Run:
```bash
npm run build && (npm run preview > /tmp/prev.log 2>&1 &) && sleep 4
SHOT_OUT=screenshots/baseline node scripts/_shot.mjs
pkill -f "astro preview"
ls screenshots/baseline/
```
Expected: 4 baseline PNGs.

- [ ] **Step 5: Validate determinism (same build diffs to zero)**

Run:
```bash
(npm run preview > /tmp/prev.log 2>&1 &) && sleep 4
SHOT_OUT=screenshots/current node scripts/_shot.mjs && node scripts/_diff.mjs
pkill -f "astro preview"
```
Expected: `ALL MATCH`. (If byte-equality is flaky on this machine, switch `_diff.mjs` to a pixel
decoder before proceeding.)

- [ ] **Step 6: Commit gitignore**

```bash
git add .gitignore && git commit -m "chore: gitignore idiomatic-tailwind screenshot artifacts"
```

---

## Task 2: Token foundation + spacing-namespace migration

**Files:** Modify `src/styles/global.css`; modify the ~11 existing `(--space-*)` usages across components (atomic with the rename so the build stays green).

- [ ] **Step 1: Rename the 12 fluid `--space-*` tokens to `--spacing-*`**

In `src/styles/global.css` `@theme` block, rename each `--space-X:` → `--spacing-X:` (values
unchanged): `section, gutter, hero-bottom, footer, about-gap, head-mb, papershead-mb, rowpad,
rowgap, footergap, map-h, navgap`.

- [ ] **Step 2: Add the new tokens**

Immediately after, inside `@theme`, add:

```css
  /* static type (font-size only — no line-height) */
  --text-tag: 0.6875rem;     --text-label: 0.75rem;      --text-stream: 0.78rem;
  --text-meta: 0.8125rem;    --text-body-sm: 0.875rem;   --text-note: 0.9375rem;
  --text-logo: 1.0625rem;    --text-arrow: 1.1rem;       --text-cardtitle: 1.25rem;

  /* off-grid micro spacing (t-shirt) */
  --spacing-3xs: 0.2rem;  --spacing-2xs: 0.3rem;  --spacing-xs: 0.55rem;  --spacing-sm: 0.6rem;
  --spacing-md: 0.85rem;  --spacing-lg: 0.9rem;   --spacing-xl: 1.1rem;   --spacing-2xl: 1.4rem;

  /* radius */
  --radius-card: 14px;

  /* letter-spacing (named to avoid native tracking-tight/wide/widest) */
  --tracking-kicker: 0.22em;  --tracking-tag: 0.14em;   --tracking-label: 0.08em;
  --tracking-meta: 0.06em;    --tracking-cta: 0.03em;   --tracking-title: -0.01em;
  --tracking-display: -0.02em;

  /* line-height */
  --leading-body: 1.6;  --leading-excerpt: 1.55;  --leading-title: 1.05;  --leading-headline: 1.04;

  /* misc systemic */
  --shadow-glow: 0 0 30px rgb(244 246 248 / 0.45);
  --container-site: 1400px;
  --breakpoint-wide: 900px;
  --color-on-accent: #050606;
```

- [ ] **Step 3: Convert the existing `(--space-*)` usages to generated utilities**

These now reference the renamed tokens; switch them from the paren escape-hatch to the generated
form. Run a grep to find every occurrence, then convert each `<util>-(--space-X)` → `<util>-X`:

```bash
grep -rn '(--space-' src/components src/layouts
```
Replace each (drop the `(--space-` prefix and `)`): `px-(--space-gutter)`→`px-gutter`,
`right-(--space-gutter)`→`right-gutter`, `mb-(--space-head-mb)`→`mb-head-mb`,
`py-(--space-footer)`→`py-footer`, `pb-(--space-hero-bottom)`→`pb-hero-bottom`,
`bottom-(--space-hero-bottom)`→`bottom-hero-bottom`, `mb-(--space-papershead-mb)`→`mb-papershead-mb`,
`gap-(--space-footergap)`→`gap-footergap`, `gap-(--space-about-gap)`→`gap-about-gap`, **and any
others the grep surfaces** (e.g. `gap-(--space-navgap)`→`gap-navgap`, `min-h-(--space-map-h)`→`min-h-map-h`,
`mb-(--space-rowgap)`→`mb-rowgap`). After converting, `grep -rn '(--space-' src` must return nothing.

- [ ] **Step 4: Build + verify generated utilities resolve**

Run: `npm run check && npm run build`
Expected: both green (a failing build here = a missed `(--space-*)` usage or typo).

- [ ] **Step 5: Screenshot diff (pixel-identical gate)**

Run:
```bash
(npm run preview > /tmp/prev.log 2>&1 &) && sleep 4
SHOT_OUT=screenshots/current node scripts/_shot.mjs && node scripts/_diff.mjs
pkill -f "astro preview"
```
Expected: `ALL MATCH` (renaming a token + paren→generated is value-preserving; any DIFF = a renamed
token whose value changed, or a missed usage now resolving to nothing).

- [ ] **Step 6: Commit**

```bash
git add src/styles/global.css src/components src/layouts
git commit -m "feat: add idiomatic @theme tokens + migrate spacing to --spacing namespace"
```

---

## Tasks 3–10: Per-component bracket conversion (recipe-driven)

Each task: read the live component, apply the **master conversion map** to every `[...]` utility
EXCEPT the "STAYS arbitrary" set, leave all scoped `<style>` and `data-*`/state code untouched,
then `npm run check && npm run build`, then screenshot-diff to `ALL MATCH`. Commit
`refactor: <Component> arbitrary values → @theme tokens (pixel-identical)`. If any single
conversion causes a DIFF, revert that one utility to its bracket form and note it.

### Task 3: Footer (`src/components/Footer.astro`)
- [ ] Convert: `text-[1.0625rem]`→`text-logo`, `text-xs`? (keep native), `text-[0.75rem]`→`text-label`,
  `text-[0.6875rem]`→`text-tag`, `tracking-[0.1em]`→`tracking-widest`, `tracking-[0.06em]`→`tracking-meta`,
  `gap-6` (already native), `gap-(--space-footergap)` already done in Task 2. Build + diff → ALL MATCH. Commit.

### Task 4: CtaClose (`src/components/CtaClose.astro`)
- [ ] Convert: `text-cta`/`text-ctabody` (already token), `mt-4`(native), `leading-[1.05]`→`leading-title`,
  `tracking-[-0.02em]`→`tracking-display`, `leading-[1.6]`→`leading-body`, `mt-6`(native), `mt-9`(native),
  `text-sm`(keep native), `tracking-[0.03em]`→`tracking-cta`, `text-base`→`text-on-accent` (the dark-on-cyan),
  `px-8 py-4`(native), `rounded-lg`(native), `shadow-[0_0_30px_rgb(244_246_248/0.45)]`→`shadow-glow`,
  `max-w-[16ch]`/`max-w-[48ch]` STAY. Build + diff. Commit.

### Task 5: WhitePapers (`src/components/WhitePapers.astro`)
- [ ] Convert the row meta/title/excerpt brackets: `text-[0.6875rem]`→`text-tag`, `tracking-[0.1em]`→`tracking-widest`,
  `text-rowtitle`(token), `tracking-[-0.01em]`→`tracking-title`, `text-[0.9375rem]`→`text-note`,
  `leading-[1.55]`→`leading-excerpt`, `py-[clamp(1.5rem,3vw,2.25rem)]`→`py-rowpad`,
  `gap-(--space-rowgap)`/`mb-(--space-papershead-mb)` done in Task 2; `max-w-[62ch]` STAYS. Build + diff. Commit.

### Task 6: Projects (`src/components/Projects.astro`)
- [ ] Convert: `gap-[1.25rem]`→`gap-5`, `auto-cols-[minmax(280px,1fr)]` STAYS (structural),
  `rounded-[14px]`→`rounded-card`, `text-[0.6875rem]`→`text-tag`, `tracking-[0.1em]`→`tracking-widest`,
  `mt-[0.6rem]`→`mt-sm`, `text-[1.25rem]`→`text-cardtitle`, `tracking-[-0.01em]`→`tracking-title`,
  `text-[0.8125rem]`→`text-meta`, `mr-[0.5rem]`→`mr-2`, `mt-[0.2rem]`→`mt-3xs`, `text-[0.875rem]`→`text-body-sm`,
  `mt-[0.9rem]`→`mt-lg`, `leading-[1.5]`→`leading-normal`, `max-w-[40ch]` STAYS, `mt-[1.1rem]`→`mt-xl`,
  `text-[1.1rem]`→`text-arrow`, `px-[1.25rem] pt-[1.25rem] pb-[1.4rem]`→`px-5 pt-5 pb-2xl`. Build + diff. Commit.

### Task 7: About (`src/components/About.astro`)
- [ ] Convert: `gap-(--space-about-gap)` done; `min-[900px]:`→`wide:` (the grid cols variant),
  `text-secindex`/`text-body`(tokens), `mt-7`(native), `text-[1.0625rem]`→`text-logo`, `text-[0.8125rem]`→`text-meta`,
  `text-[0.6875rem]`→`text-tag`, `tracking-[0.14em]`→`tracking-tag`, `max-w-[56ch]` STAYS, `gap-[0.3rem]`→`gap-2xs`.
  Leave `.about-visual`/`.visual-bg` scoped CSS untouched. Build + diff. Commit.

### Task 8: Hero (`src/components/Hero.astro`)
- [ ] Convert ONLY the utility brackets on the hero-inner/kicker/lede/corner (NOT the animated headline
  subtree, which stays in scoped CSS): `text-[0.6875rem]`→`text-tag`, `tracking-[0.22em]`→`tracking-kicker`,
  `text-lede`(token), `max-w-[16ch]`/`max-w-[46ch]`/`max-w-[18ch]` STAY, `text-[0.8125rem]`→`text-meta`,
  `max-w-[1400px]`→`max-w-site`, `px-(--space-gutter)`/`pb-(--space-hero-bottom)`/`right-(--space-gutter)`/
  `bottom-(--space-hero-bottom)` done in Task 2, `min-h-[100dvh]` STAYS, `max-[820px]:hidden`(native variant stays).
  Build + diff. Commit.

### Task 9: Medni (`src/components/Medni.astro`)
- [ ] Convert: `min-[900px]:`→`wide:`, `text-mednisub`(token), `text-[0.875rem]`→`text-body-sm`,
  `text-[0.78rem]`→`text-stream`, `gap-[0.55rem]`→`gap-xs`, `text-[0.75rem]`→`text-label`,
  `tracking-[0.08em]`→`tracking-label`, `py-[0.85rem]`→`py-md`, `mt-[1.5rem]`→`mt-6`,
  `max-w-[50ch]` STAYS, `min-h-(--space-map-h)` done in Task 2. Leave `.map*`/`.dashboard`/`.cursor::after`/
  keyframes untouched. Build + diff. Commit.

### Task 10: Nav (`src/components/Nav.astro`)
- [ ] Convert: `max-w-[1400px]`→`max-w-site`, `px-(--space-gutter)`/`gap-(--space-navgap)` done in Task 2,
  `text-[1.25rem]`→`text-cardtitle`, `tracking-[-0.01em]`→`tracking-title`, `text-[0.875rem]`→`text-body-sm`,
  `tracking-[0.12em]`→ **note: 0.12em has no token in the map — ADD `--tracking-nav: 0.12em` to @theme in this task
  (or use `tracking-[0.12em]` if you prefer to keep it arbitrary; pick one and stay consistent)**,
  `text-[color:var(--color-base)]`→`text-on-accent` (×2, the databank button), `shadow-[…]`→`shadow-glow`,
  `px-[1.5rem] py-[0.85rem]`→`px-6 py-md`. Leave `.nav-progress`, `.menu-toggle`, `.mobile-menu`,
  `[aria-expanded]`/`[data-open]` scoped CSS untouched. Build + diff. Commit.

_(Note for Task 10: the `0.12em` nav letter-spacing wasn't in the §4.4 catalog. Add `--tracking-nav: 0.12em`
to the `@theme` tracking group when you reach this task — the implementer should grep `tracking-\[0.12em\]`
to confirm count before adding.)_

---

## Task 11: Final verification + remove tooling

- [ ] **Step 1: Confirm zero brackets remain (except the allowed set)**

Run:
```bash
grep -rnoE '[a-z-]+\[[^]]+\]' src/components src/layouts | grep -vE '\[[0-9]+ch\]|\[100dvh\]|\[2\]|minmax\(|transition-\[|min-\[|max-\[' | sort
```
Expected: empty (every remaining `[...]` is a sanctioned content/structural one-off). Review any output.

- [ ] **Step 2: Full green + final diff**

Run: `npm run check && npm run build`, then re-shoot + diff → `ALL MATCH`.

- [ ] **Step 3: Remove the harness**

```bash
rm -f scripts/_shot.mjs scripts/_diff.mjs && rmdir scripts 2>/dev/null || true
rm -rf screenshots
npm uninstall puppeteer-core
git checkout package-lock.json 2>/dev/null; npm install
```
Remove the three `.gitignore` lines added in Task 1.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: remove idiomatic-tailwind verification tooling"
```

---

## Self-Review Summary

- **Spec coverage:** harness+baseline (T1); token catalog + `--space-`→`--spacing-` migration +
  existing-usage conversion (T2); all 8 components' brackets (T3–10); collision fixes baked into the
  map (`text-on-accent`, `tracking-widest`, `tracking-title/display`); cleanup (T11).
- **Each task green + zero-diff:** T2 keeps the build green by converting the renamed-token usages
  atomically; every component task gates on `ALL MATCH`.
- **Gaps found & fixed inline:** the `tracking-[0.12em]` nav value wasn't in the spec catalog →
  flagged in Task 10 to add `--tracking-nav`. The `(--space-*)` usage list in T2 Step 3 instructs a
  grep so none are missed beyond the 9 enumerated.
- **Untouchable preserved:** animation/gradient/`[aria-expanded]`/`[data-open]`/keyframes/clip/reveal
  scoped CSS is explicitly left alone in every component task; sanctioned `[...]` one-offs
  (`ch`/`dvh`/`z`/`minmax`/`transition`) verified in T11 Step 1.
