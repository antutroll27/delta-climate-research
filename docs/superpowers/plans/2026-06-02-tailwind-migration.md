# Tailwind Utility-First Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert all 8 components + `Base.astro` from scoped CSS to Tailwind v4 utilities, pixel-identical, leaving the animation/JS-coupled systems untouched.

**Architecture:** Foundation first (a `@theme` fluid scale + a couple of retained brand classes), then component-by-component simple→complex, each verified by a headless-Chrome screenshot diff captured under `prefers-reduced-motion` so only static styles are compared.

**Tech Stack:** Astro, Tailwind v4 (`@tailwindcss/postcss`), puppeteer-core (temporary, system Chrome).

**Spec:** [`docs/superpowers/specs/2026-06-02-tailwind-migration-design.md`](../specs/2026-06-02-tailwind-migration-design.md)

---

## Working method (read this first)

This is a **mechanical, pixel-identical refactor**. The source of truth for each component's
current styling is the **live file** — the implementer MUST read the actual component file
before converting it, not rely on CSS transcribed into this plan (the plan shows the *pattern*
and the *gotchas*, the file shows the *current truth*). The objective gate is the screenshot
diff: **a converted component must produce a zero pixel diff against baseline.** If it doesn't,
revert the risky rule to CSS and re-verify.

**Conversion ruleset (CSS property → utility):**

| CSS | Utility |
| --- | --- |
| `display:flex` / `grid` / `block` | `flex` / `grid` / `block` |
| `flex-direction:column` | `flex-col` |
| `flex-wrap:wrap` | `flex-wrap` |
| `align-items:center` | `items-center` |
| `justify-content:space-between` / `center` | `justify-between` / `justify-center` |
| `gap:1.5rem` | `gap-6` (1.5rem = 6); non-scale → `gap-[1.25rem]` |
| `gap:clamp(...)` | `gap-(--space-xxx)` (token from Task 1) |
| `margin:0` | `m-0`; `margin-top:1rem` → `mt-4` |
| `padding:1rem 2rem` | `px-8 py-4` |
| `padding-block:clamp(...)` | `py-(--space-xxx)` |
| `max-width:48ch` | `max-w-[48ch]` |
| `min-height:clamp(...)` | `min-h-(--space-map-h)` |
| `font-family:var(--font-mono)` | `font-mono` (mapped from `--font-mono`) |
| `font-size:0.75rem` | `text-xs` only if exact; else `text-[0.75rem]`; clamp → `text-(--text-xxx)` wrapped as `text-[length:var(--text-xxx)]` |
| `font-weight:700` | `font-bold`; `500` → `font-medium`; `300` → `font-light` |
| `letter-spacing:0.1em` | `tracking-[0.1em]` |
| `line-height:1.6` | `leading-[1.6]` |
| `text-transform:uppercase` | `uppercase` |
| `text-align:center` | `text-center` |
| `color:var(--color-paper)` | `text-paper` |
| `background:var(--color-cyan)` | `bg-cyan` |
| `border-radius:8px` | `rounded-lg` (8px); else `rounded-[8px]` |
| `border:1px solid var(--color-hairline)` | `border border-hairline` |
| `position:relative` / `absolute` / `fixed` | `relative` / `absolute` / `fixed` |
| `transition:color .2s ease` + `:hover{color:x}` | `transition-colors hover:text-x` |

**IMPORTANT — font-size with the fluid tokens:** Tailwind's `text-(--foo)` shorthand maps to
`font-size: var(--foo)` only when the token is registered under the `--text-*` namespace in
`@theme` (it is, per Task 1), so **`text-hero`, `text-lede`, etc. work as plain utilities**
(e.g. `class="text-hero"`). Use those named utilities, NOT arbitrary `text-[...]`, for the 10
fluid type values.

**Untouchable in EVERY task (never edit, never remove):**
- `data-*` attributes (`data-reveal`, `data-reveal-group`, `data-stagger`, `data-clip`,
  `data-parallax`, `data-draw`, `data-progress`, `data-scrolled`, `data-open`,
  `data-navigation-toggle`, `data-mobile-link`) — keep verbatim on their element.
- `.draw-line`, `.nav-progress` elements and their CSS.
- `@keyframes`, the `.word` entrance animation + `--i` inline styles, `.cursor::after` blink.
- Grain SVG, gradients, `mix-blend-mode`, `backdrop-filter`, `.map-grid`, `.cover` gradients.
- The reveal/clip CSS in `global.css` (`[data-reveal]`, `[data-reveal-group] > *`, `.is-inview`,
  `.reveal-ready [data-clip]`).

---

## Task 1: Foundation — fluid `@theme` scale + retained brand classes

**Files:** Modify `src/styles/global.css`

- [ ] **Step 1: Add the fluid scale to the `@theme` block**

In `src/styles/global.css`, inside the existing `@theme { … }` block (after the `--font-mono`
line, before the closing `}`), add:

```css
  /* fluid type scale (each = the exact existing clamp it replaces — pixel-identical) */
  --text-hero: clamp(2.5rem, 7vw, 6rem);
  --text-section: clamp(2.6rem, 5.5vw, 4.5rem);
  --text-cta: clamp(2.2rem, 5.5vw, 4.5rem);
  --text-mobilenav: clamp(2rem, 8vw, 3rem);
  --text-rowtitle: clamp(1.15rem, 2vw, 1.5rem);
  --text-secindex: clamp(1rem, 1.6vw, 1.25rem);
  --text-body: clamp(1rem, 1.4vw, 1.2rem);
  --text-ctabody: clamp(1rem, 1.4vw, 1.15rem);
  --text-mednisub: clamp(1rem, 1.3vw, 1.15rem);
  --text-lede: clamp(0.95rem, 1.4vw, 1.125rem);

  /* fluid space scale (exact existing clamps) */
  --space-section: clamp(5rem, 12vh, 9rem);
  --space-gutter: clamp(1rem, 4vw, 2.5rem);
  --space-hero-bottom: clamp(3rem, 9vh, 6rem);
  --space-footer: clamp(2.5rem, 5vw, 4rem);
  --space-about-gap: clamp(2rem, 5vw, 4rem);
  --space-head-mb: clamp(2rem, 4vw, 3rem);
  --space-papershead-mb: clamp(1.5rem, 3vw, 2.5rem);
  --space-rowpad: clamp(1.5rem, 3vw, 2.25rem);
  --space-rowgap: clamp(1rem, 3vw, 2rem);
  --space-footergap: clamp(1rem, 2.5vw, 2rem);
  --space-map-h: clamp(300px, 48vh, 460px);
  --space-navgap: clamp(2.25rem, 4vw, 3.75rem);
```

- [ ] **Step 2: Add a retained brand class for the heading accent `<em>`**

The serif-italic-cyan accent inside headings recurs in `.sec-title em` and `.cta-title em`.
Keep it as ONE retained class (a brand component, not per-element utilities). Inside
`@layer base { … }` in `global.css`, after the existing `.sec-title em { … }` rule, add:

```css
  /* reusable heading accent — italic serif cyan (applied to <em> in section/cta titles) */
  .em-accent {
    font-family: var(--font-serif);
    font-style: italic;
    font-weight: 500;
    color: var(--color-cyan);
    letter-spacing: 0;
  }
```

- [ ] **Step 3: Build to confirm tokens compile**

Run: `npm run build`
Expected: build succeeds (the new `@theme` tokens generate `text-hero` etc.; no usage yet).

- [ ] **Step 4: Verify the type tokens generate utilities**

Run: `npm run build && C=$(ls dist/_astro/*.css | head -1); printf '%s' "$C"; for u in text-hero text-lede text-section; do grep -q "$u" "$C" && echo " (note: only present once used)"; done; echo OK`
Expected: prints `OK` (utilities are generated on demand; this just confirms a clean build).

- [ ] **Step 5: Commit**

```bash
git add src/styles/global.css
git commit -m "feat: add fluid @theme type/space scale + em-accent brand class"
```

---

## Task 2: Verification harness + baseline screenshots

**Files:** Create `scripts/_shot.mjs` (temporary), Create `screenshots/baseline/` (gitignored)

- [ ] **Step 1: Add puppeteer-core (temporary dev tool)**

Run: `npm install -D puppeteer-core@23`
Expected: installs cleanly.

- [ ] **Step 2: Gitignore the screenshot artifacts + temp script**

Append to `.gitignore`:

```
# tailwind-migration verification artifacts (temporary)
screenshots/
scripts/_shot.mjs
```

- [ ] **Step 3: Write the screenshot harness**

Create `scripts/_shot.mjs`:

```js
// Temporary: capture full-page screenshots under reduced-motion for pixel-diff parity checks.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.SHOT_BASE || 'http://localhost:4321';
const OUT = process.env.SHOT_OUT || 'screenshots/current';
const PAGES = [['home', '/'], ['white-papers', '/white-papers']];
const SIZES = [['desktop', 1440, 900], ['mobile', 390, 844]];

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });

for (const [pname, path] of PAGES) {
  for (const [sname, w, h] of SIZES) {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.setViewport({ width: w, height: h });
    await page.goto(BASE + path, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: `${OUT}/${pname}-${sname}.png`, fullPage: true });
    await page.close();
  }
}
await browser.close();
console.log('shots ->', OUT);
```

- [ ] **Step 4: Capture the BASELINE from current main (pre-migration)**

Run:
```bash
npm run build && (npm run preview > /tmp/prev.log 2>&1 &) && sleep 4
SHOT_OUT=screenshots/baseline node scripts/_shot.mjs
pkill -f "astro preview"
```
Expected: `screenshots/baseline/` contains `home-desktop.png`, `home-mobile.png`, `white-papers-desktop.png`, `white-papers-mobile.png`.

- [ ] **Step 5: Add a diff helper**

Append to `scripts/_shot.mjs` is not needed; create `scripts/_diff.mjs`:

```js
// Compare current shots to baseline using raw pixel equality via Chrome's own decode.
import { readFileSync, existsSync } from 'node:fs';
const FILES = ['home-desktop', 'home-mobile', 'white-papers-desktop', 'white-papers-mobile'];
let fail = 0;
for (const f of FILES) {
  const a = `screenshots/baseline/${f}.png`, b = `screenshots/current/${f}.png`;
  if (!existsSync(b)) { console.log(`MISSING current ${f}`); fail++; continue; }
  const ba = readFileSync(a), bb = readFileSync(b);
  const same = ba.length === bb.length && ba.equals(bb);
  console.log(`${same ? 'OK  ' : 'DIFF'} ${f}`);
  if (!same) fail++;
}
process.exit(fail ? 1 : 0);
```

Note: byte-equality is strict; if the platform's PNG encoder introduces nondeterministic bytes,
switch the comparison to a pixel decoder (`pngjs` + `pixelmatch`) — but try byte-equality first,
since identical input renders identically in the same Chrome build.

- [ ] **Step 6: Commit the harness wiring (gitignore only; script + shots are ignored)**

```bash
git add .gitignore
git commit -m "chore: gitignore tailwind-migration screenshot artifacts"
```

- [ ] **Step 7: Sanity-check the harness detects equality**

Run (re-capture current == baseline source, expect all OK):
```bash
npm run build && (npm run preview > /tmp/prev.log 2>&1 &) && sleep 4
SHOT_OUT=screenshots/current node scripts/_shot.mjs
node scripts/_diff.mjs; pkill -f "astro preview"
```
Expected: all four `OK`. If byte-equality is flaky, swap to pixelmatch per the note, then re-run.

---

## Task 3: Convert Footer (simplest)

**Files:** Modify `src/components/Footer.astro`

Current `<style>` (read the live file to confirm) styles: `.site-footer`, `.footer-inner`,
`.footer-logo`, `.footer-links`, `.footer-links a` (+`:hover`), `.footer-meta`. The
`position:relative` exists for the `.draw-line` — **keep a `relative` on the footer**.

- [ ] **Step 1: Convert the markup to utilities**

Replace the `<footer>` markup (keep `data-draw` + `.draw-line` verbatim):

```astro
<footer class="site-footer divider-top relative py-(--space-footer)">
  <span class="draw-line" data-draw aria-hidden="true"></span>
  <div class="wrap flex flex-wrap items-center justify-between gap-6">
    <span class="font-bold text-[1.0625rem] text-paper">Delta<span class="text-cyan">·</span>Climate</span>

    <ul class="flex flex-wrap gap-(--space-footergap) list-none m-0 p-0 font-mono text-xs uppercase tracking-[0.1em]" role="list">
      {links.map((l) => (
        <li><a href={l.href} class="text-ink-muted no-underline transition-colors hover:text-paper">{l.label}</a></li>
      ))}
    </ul>

    <p class="m-0 font-mono text-[0.6875rem] tracking-[0.06em] text-ink-faint">© {year} Delta Climate Research — Built for the frontier.</p>
  </div>
</footer>
```

Note: `.site-footer` class is kept ONLY if any retained rule needs it; here all its styles moved
to utilities, so drop `.site-footer` and the whole `<style>` block.

- [ ] **Step 2: Delete the now-empty `<style>` block**

Remove the entire `<style>…</style>` from `Footer.astro` (every rule was converted; nothing
untouchable lived here).

- [ ] **Step 3: Build + type-check**

Run: `npm run check && npm run build`
Expected: both pass.

- [ ] **Step 4: Screenshot diff**

Run:
```bash
(npm run preview > /tmp/prev.log 2>&1 &) && sleep 4
SHOT_OUT=screenshots/current node scripts/_shot.mjs
node scripts/_diff.mjs; pkill -f "astro preview"
```
Expected: all four `OK` (zero diff). If `DIFF`, inspect the footer region, fix the offending
utility (often a px value that isn't on Tailwind's scale → use the exact `[…]` arbitrary), re-run.

- [ ] **Step 5: Commit**

```bash
git add src/components/Footer.astro
git commit -m "refactor: Footer to Tailwind utilities (pixel-identical)"
```

---

## Task 4: Convert CtaClose

**Files:** Modify `src/components/CtaClose.astro`

Keep `data-reveal-group` + `data-stagger="90"` on `.cta-inner`, and `.draw-line`/`data-draw`.
The `.cta-title em` → use the `.em-accent` class (Task 1) on the `<em>`.

- [ ] **Step 1: Convert markup**

```astro
<section id="access" class="section divider-top relative text-center" aria-labelledby="cta-title">
  <span class="draw-line" data-draw aria-hidden="true"></span>
  <div class="wrap flex flex-col items-center" data-reveal-group data-stagger="90">
    <p class="sec-index">05 — Access</p>
    <h2 id="cta-title" class="mt-4 font-bold text-cta leading-[1.05] tracking-[-0.02em] text-paper max-w-[16ch]">
      Put planetary intelligence to <em class="em-accent">work.</em>
    </h2>
    <p class="mt-6 max-w-[48ch] text-ctabody leading-[1.6] text-ink-muted">
      For institutions, municipalities, and corporates navigating a changing
      climate. Request access to the data bank or start a conversation.
    </p>
    <a href="mailto:hello@delta-climate.example"
       class="mt-9 font-mono text-sm tracking-[0.03em] text-base bg-cyan rounded-lg px-8 py-4 no-underline transition-[background-color,color,box-shadow] duration-[250ms] hover:bg-[#f4f6f8] hover:text-base hover:shadow-[0_0_30px_rgb(244_246_248/0.45)]">
      Request access
    </a>
  </div>
</section>
```

Notes: `.sec-index` is a shared global class — **keep it** (it's a retained brand helper, not
converted here). `mt-9` = 2.25rem. `text-base` is the `--color-base` utility (NOT Tailwind's
font-size `text-base`) — verify in the diff; if it collides, use `text-(--color-base)` /
`text-[var(--color-base)]`.

- [ ] **Step 2: Delete the `<style>` block** (all rules converted; `.sec-index` lives in global).

- [ ] **Step 3: Build + type-check** — `npm run check && npm run build` → pass.

- [ ] **Step 4: Screenshot diff** (same commands as Task 3 Step 4) → all `OK`.

  Watch specifically for: the `text-base` color-vs-fontsize collision, and the button hover glow.

- [ ] **Step 5: Commit**

```bash
git add src/components/CtaClose.astro
git commit -m "refactor: CtaClose to Tailwind utilities (pixel-identical)"
```

---

## Tasks 5–10: Convert remaining components (recipe-driven)

Each task below follows the **identical procedure** — read the live file, apply the conversion
ruleset, preserve the untouchable list, delete fully-converted rules, keep untouchable rules in a
slimmed `<style>`, then `npm run check && npm run build` and screenshot-diff to zero. The
per-component notes call out the specific gotchas. Commit message:
`refactor: <Component> to Tailwind utilities (pixel-identical)`.

### Task 5: WhitePapers (`src/components/WhitePapers.astro`)
- [ ] Convert `.papers-head`, `.feed`, `.row`, `.row-link`, `.row-meta`, `.row-id`, `.row-title`,
  `.row-excerpt`, `.row-arrow` to utilities. Use `text-rowtitle` for the row title.
- [ ] **KEEP in `<style>` (untouchable/awkward):** the `.feed:hover .row-link { opacity:.4 }` +
  `.feed .row-link:hover { opacity:1; background-color: … }` focus-pull (sibling-hover combinator
  — utilities can't express `group-hover` dimming of siblings cleanly; leave as CSS). Keep
  `.row-arrow` hover translate if it relies on the `.row-link:hover` parent (use a retained rule
  or `group`/`group-hover:` — only if the diff stays zero; else keep CSS).
- [ ] Keep `data-reveal`, `data-reveal-group`, `data-stagger`, `.draw-line`/`data-draw`.
- [ ] Build + diff → zero. Commit.

### Task 6: Projects (`src/components/Projects.astro`)
- [ ] Convert `.projects-head`, `.rail-wrap`, `.rail`, `.card`, `.card-link`, `.card-body`,
  `.card-tags`, `.card-title`, `.card-id`, `.card-sub`, `.card-blurb`, `.card-arrow` to utilities.
- [ ] **KEEP in `<style>`:** `.cover` gradient + `grayscale` filter + its `:hover` filter
  transition (decoration); the `scroll-snap-type`/`scroll-snap-align` (use `snap-x`/`snap-start`
  utilities only if diff stays zero, else keep CSS); the `.card-link:hover` transform/border and
  `.card-arrow` hover translate (keep as CSS rule if `group-hover` changes pixels).
- [ ] Keep `data-reveal`, `data-reveal-group`, `data-stagger`, `.draw-line`.
- [ ] Build + diff → zero. Commit.

### Task 7: About (`src/components/About.astro`)
- [ ] Convert `.about-grid`, `.about-lead`, `.about-body`, `.pillars`, `.pillars li`, `.pillar-k`,
  `.pillar-v`, `.visual-tag` to utilities. Use `text-body` for `.about-body`; `gap-(--space-about-gap)`.
- [ ] **KEEP in `<style>` (untouchable):** `.about-visual` (it has `data-clip` + `overflow:hidden`
  + the radial-gradient background + `--clip-radius`); `.visual-bg` (parallax layer + gradient).
  Do NOT convert these — the clip system depends on them.
- [ ] Keep `data-reveal`, `data-clip`, `data-parallax`, `.draw-line`. The responsive
  `@media (min-width:900px){.about-grid{grid-template-columns:6fr 4fr}}` → `md:grid-cols-[6fr_4fr]`
  ONLY if diff is zero (Tailwind `md` is 768px, not 900px → use `min-[900px]:grid-cols-[6fr_4fr]`
  to match exactly).
- [ ] Build + diff → zero. Commit.

### Task 8: Hero (`src/components/Hero.astro`)
- [ ] Convert ONLY the static layout/type that is NOT animated: `.hero` (flex column, min-h-dvh,
  justify-end, overflow-hidden, bg), `.hero-inner`, `.kicker`, `.lede`, `.corner` static props.
  Use `text-hero` on `.headline`, `text-lede` on `.lede`, `py`/`px` via `--space-gutter` /
  `--space-hero-bottom`.
- [ ] **KEEP in `<style>` (untouchable):** the `.grain` SVG data-URI background; the `.word`
  entrance animation + `@keyframes rise` + `--i` delays + the `prefers-reduced-motion` reset;
  `.headline .accent` (the animated span — leave it AND its styling in CSS, do not switch to
  `.em-accent`). Keep `data-parallax` attributes on kicker/headline/lede-wrapper/corner verbatim.
- [ ] Caution: `.headline .word { display:inline-block; white-space:pre }` is animation-coupled —
  keep in CSS. The `<h1 data-parallax>` keeps its class for the `.headline .word/.accent` selectors.
  This means `.headline` STAYS as a class (its descendant rules are untouchable); only add utility
  classes that don't conflict. **Simplest safe call: leave Hero's headline subtree entirely in CSS;
  convert only `.hero`, `.hero-inner`, `.kicker`, `.lede` wrapper, `.corner`.**
- [ ] Build + diff → zero (desktop + mobile; note `.corner` is `display:none` under 820px →
  `max-[820px]:hidden`). Commit.

### Task 9: Medni (`src/components/Medni.astro`)
- [ ] Convert `.medni-head`, `.medni-sub`, `.drawer`, `.drawer-live`, `.stream`, `.stream li`,
  `.cta-box` (+`:hover`) to utilities. Use `text-mednisub`; `min-h-(--space-map-h)` for the map.
- [ ] **KEEP in `<style>` (untouchable):** `.dashboard` (has `data-clip` + `overflow:hidden` +
  `--clip-radius:16px`); `.map` (radial-gradient bg); `.map-grid` (gradient grid); `.map-overlay`
  (`mix-blend-mode`); `.cursor::after` blink + `@keyframes blink` + its reduced-motion reset.
- [ ] Keep `data-reveal`, `data-clip`, `.draw-line`. Responsive `@media(min-width:900px)` grid →
  `min-[900px]:` variants to match the 900px breakpoint exactly.
- [ ] Build + diff → zero. Commit.

### Task 10: Nav (`src/components/Nav.astro`)
- [ ] Convert `.site-nav`, `.nav-inner`, `.logo`, `.nav-links`, `.nav-links a` (+hover),
  `.nav-links .databank` (+hover), `.menu-toggle`, `.mobile-menu` + its links to utilities.
  Use `gap-(--space-navgap)` for `.nav-links`.
- [ ] **KEEP in `<style>` (untouchable / awkward):** `.nav-progress` (scroll system); the
  `.menu-toggle[aria-expanded='true'] span` transforms (attribute-state combinator on the burger
  lines — keep as CSS, or `aria-expanded:` variant only if diff zero); `.mobile-menu` `backdrop-filter`
  + its `[data-open='true']` state (keep as CSS); the `prefers-reduced-motion` resets.
- [ ] Keep `data-scrolled`, `data-open`, `data-navigation-toggle`, `data-mobile-link`, `data-progress`,
  `#site-nav`/`#nav-sentinel`/`#mobile-menu` IDs (JS queries them).
- [ ] Build + diff → zero (test the mobile menu open state visually too — but diff is captured
  closed; manually open it once to confirm). Commit.

---

## Task 11: Convert Base.astro shared helpers + final cleanup

**Files:** Modify `src/layouts/Base.astro` (only if it has convertible markup; it mostly has
`<head>`/scripts — likely no conversion needed). Modify `src/styles/global.css` (retained helpers).

- [ ] **Step 1: Review `global.css` `@layer base` helpers** (`.wrap`, `.section`, `.divider-top`,
  `.sec-index`, `.sec-title`, `.accent-link`). These are shared across components and are cleaner
  kept as retained classes than inlined everywhere. **Decision: keep them as-is** (they're DRY
  shared brand helpers; converting would duplicate utilities across many call sites). Confirm no
  component still depends on a removed scoped rule.

- [ ] **Step 2: Full-site diff** — rebuild, capture, diff all four shots → all `OK`.

- [ ] **Step 3: Remove the verification tooling**

```bash
rm -f scripts/_shot.mjs scripts/_diff.mjs && rmdir scripts 2>/dev/null || true
rm -rf screenshots
npm uninstall puppeteer-core
git checkout package-lock.json 2>/dev/null; npm install
```
Remove the two gitignore lines added in Task 2 Step 2 (screenshots/ and scripts/_shot.mjs).

- [ ] **Step 4: Final green gate**

Run: `npm run check && npm run build`
Expected: both pass, working tree clean except intended source changes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove tailwind-migration verification tooling"
```

---

## Self-Review Summary

- **Spec coverage:** fluid scale (Task 1) · em-accent retained class (Task 1) · screenshot-diff
  harness under reduced-motion (Task 2) · all 8 components simple→complex (Tasks 3–10) · Base +
  retained helpers + cleanup (Task 11). Untouchable zone enforced per-task. Pixel-identical gate
  = zero-diff requirement on every component task.
- **Hybrid boundary:** each component task explicitly lists what STAYS in `<style>` (clip/reveal,
  gradients, mix-blend, backdrop-filter, keyframes, attribute-state combinators).
- **Known precision points flagged:** the 900px (not 768px `md`) and 820px breakpoints →
  `min-[900px]:` / `max-[820px]:`; `text-base` color-vs-fontsize collision in CtaClose;
  byte-equality vs pixelmatch fallback in the diff harness; Hero headline subtree stays CSS.
- **Token naming consistent** between Task 1 definitions and Tasks 3–10 usages
  (`--space-footer`, `--space-footergap`, `--space-navgap`, `--space-about-gap`, `--space-map-h`,
  `text-hero`/`text-lede`/`text-cta`/`text-rowtitle`/`text-body`/`text-ctabody`/`text-mednisub`).
