# CBAM Calculator redesign, phase 1: the shell — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/cbam/cbam-calculator/` into a full-screen app with a left rail and six views. Today's cards move into those views unchanged. Shipment lines get their own container, so the line being edited always previews on Estimate.

**Architecture:** The page drops the site `Nav` and `Footer` and renders an app root, `.cbx`. Inside it sit a rail (`<nav>`), a phone top bar, a phone tab bar, a main area holding six `<section data-view>` elements, and a status strip. A small module, `src/scripts/cbam-ui/views.ts`, maps `location.hash` to a view and shows it. A second module, `src/scripts/cbam-ui/title-card.ts`, renders the rail's "Line being priced" card. In `cbam-app.ts` only the wiring changes: the list renders into a new `#cbList`, and the draft always previews. No renderer and no engine file changes. All the new styling is in `src/styles/cbam-app.css`, and every selector is scoped under `.cbx`.

**Tech Stack:** Astro 5 page with a plain `<script>` module, TypeScript, `node --test` through tsx for the unit tests, and Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-11-02-cbam-rail-ui-design.md` (§4, §6.2–6.5 and §7). **Roadmap:** `docs/superpowers/plans/2026-11-02-cbam-rail-ui-00-roadmap.md`. Read both before Task 1.

> **Environment notes (measured 2 Nov 2026):** macOS has no `timeout` command, so run Playwright in the foreground through the Bash tool's own timeout. The Chromium project is `chromium-tier0`; there is no `chromium`. `npm run test:unit` must run **after** `npm run build`, because about 59 OBOS and heat-map unit tests read `dist/`.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `src/scripts/cbam-ui/views.ts` | create | Hash ↔ view, showing a view, rail collapse |
| `src/scripts/cbam-ui/title-card.ts` | create | The title-card HTML and the phone top-bar summary |
| `src/styles/cbam-app.css` | create | Tokens, shell, rail, phone bars, empty states, status strip |
| `src/pages/cbam/cbam-calculator.astro` | modify | App-shell markup; existing blocks moved into views |
| `src/scripts/cbam-algos/cbam-app.ts` | modify (wiring only, inside `initCbam`) | `#cbList`, draft always previews, badge, title card |
| `tests/unit/cbam-views.test.mjs` | create | `viewFromHash` |
| `tests/unit/cbam-title-card.test.mjs` | create | `renderTitleCard`, `titleSummary` |
| `tests/e2e/cbam-shell.spec.ts` | create | Rail, hash, the §6.3 behaviour, badge, status strip |
| `tests/e2e/cbam-lines.spec.ts` | modify | Navigate to the List view where a test touches list content |

---

### Task 1: Worktree and branch

**Files:** none.

- [ ] **Step 1: Confirm phase 0 has merged.**

Run: `git -C /Volumes/VSTSAMPLES/Projects/Angad fetch origin && git -C /Volumes/VSTSAMPLES/Projects/Angad log --oneline origin/main -15`

Expected: a merge commit for the audit-fix PR (H1/C2/H2/M2/M3). If it is not there, **stop and report**; this plan assumes `#cbMass`, `#cbSeeDirect` and `#cbSeeIndirect` are already `type="text" inputmode="decimal"`.

- [ ] **Step 2: Create the integration branch and worktree on OBOSLab.**

```bash
cd /Volumes/VSTSAMPLES/Projects/Angad
git worktree add -b feat/cbam-rail-ui /Volumes/OBOSLab/worktrees/cbam-rail-ui origin/main
cd /Volumes/OBOSLab/worktrees/cbam-rail-ui && npm ci
```

- [ ] **Step 3: Baseline.**

Run: `npm run check && npm run test:unit`

Expected: both pass. Record the unit test count from the summary line (`# pass N`); Task 9 compares against it.

---

### Task 2: `views.ts`, from hash to view

**Files:**
- Create: `src/scripts/cbam-ui/views.ts`
- Test: `tests/unit/cbam-views.test.mjs`

- [ ] **Step 1: Write the failing test.**

```js
// tests/unit/cbam-views.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { VIEWS, viewFromHash } from '../../src/scripts/cbam-ui/views.ts';

test('the six views, in rail order', () => {
  assert.deepEqual([...VIEWS], ['estimate', 'three-years', 'why', 'list', 'export', 'rules']);
});

test('a known hash names its view', () => {
  for (const v of VIEWS) assert.equal(viewFromHash(`#${v}`), v);
});

test('no hash, an unknown hash, or a near miss falls back to Estimate', () => {
  for (const h of ['', '#', '#Estimate', '#lists', '#list/', '#%E0', 'list']) {
    assert.equal(viewFromHash(h), 'estimate', h);
  }
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `node --import tsx --test tests/unit/cbam-views.test.mjs`

Expected: FAIL, "Cannot find module … views.ts".

- [ ] **Step 3: Implement.**

```ts
// src/scripts/cbam-ui/views.ts
// The calculator's six views (spec §4.2): which one the hash names, and showing it.
// One route; the view lives in the hash so a link can open a view and reload keeps it.

export const VIEWS = ['estimate', 'three-years', 'why', 'list', 'export', 'rules'] as const;
export type View = (typeof VIEWS)[number];

/** Exact match only: '#Estimate' or '#list/' is not a view, and falls back to Estimate. */
export function viewFromHash(hash: string): View {
  const name = hash.startsWith('#') ? hash.slice(1) : '';
  return (VIEWS as readonly string[]).includes(name) ? (name as View) : 'estimate';
}

const RAIL_KEY = 'cbx-rail';

/**
 * Wires the rail, the phone tabs and every [data-goto] button inside `root`. Guarded against
 * double init on the root itself, for the same reason initCbam is (astro:page-load also fires
 * on first paint). Listeners are dropped on the next soft navigation.
 */
export function mountViews(root: HTMLElement): void {
  if (root.dataset.viewsWired) return;
  root.dataset.viewsWired = 'true';
  const ac = new AbortController();
  document.addEventListener('astro:before-swap', () => ac.abort(), { once: true });

  const show = (view: View, focus: boolean): void => {
    root.querySelectorAll<HTMLElement>('[data-view]').forEach((s) => { s.hidden = s.dataset.view !== view; });
    root.querySelectorAll<HTMLElement>('[data-goto]').forEach((b) => {
      if (b.dataset.goto === view && b.closest('.cbx-rail, .cbx-tabs, .cbx-more')) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    // replaceState, not location.hash: switching views must not fill the back button's history.
    if (location.hash !== `#${view}`) history.replaceState(history.state, '', `#${view}`);
    root.querySelector<HTMLDetailsElement>('.cbx-more')?.removeAttribute('open');
    if (focus) root.querySelector<HTMLElement>(`[data-view="${view}"] h1`)?.focus();
  };

  root.addEventListener('click', (ev) => {
    const b = (ev.target as Element | null)?.closest?.<HTMLElement>('[data-goto]');
    if (b?.dataset.goto) show(viewFromHash(`#${b.dataset.goto}`), true);
  }, { signal: ac.signal });
  window.addEventListener('hashchange', () => show(viewFromHash(location.hash), true), { signal: ac.signal });

  const collapse = root.querySelector<HTMLButtonElement>('[data-collapse]');
  const setRail = (collapsed: boolean): void => {
    root.dataset.rail = collapsed ? 'collapsed' : 'open';
    collapse?.setAttribute('aria-expanded', String(!collapsed));
  };
  try { setRail(localStorage.getItem(RAIL_KEY) === 'collapsed'); } catch { setRail(false); }
  collapse?.addEventListener('click', () => {
    const collapsed = root.dataset.rail !== 'collapsed';
    setRail(collapsed);
    try { localStorage.setItem(RAIL_KEY, collapsed ? 'collapsed' : 'open'); } catch { /* private mode */ }
  }, { signal: ac.signal });

  show(viewFromHash(location.hash), false);
}
```

- [ ] **Step 4: Run it and confirm it passes.**

Run: `node --import tsx --test tests/unit/cbam-views.test.mjs`

Expected: 3 pass, 0 fail.

- [ ] **Step 5: Add the test to the unit glob.** `package.json`'s `test:unit` already runs `tests/unit/*.test.mjs`, so nothing needs changing. Confirm with `npm run test:unit 2>&1 | tail -5`: the count rises by 3.

- [ ] **Step 6: Commit.**

```bash
git add -- src/scripts/cbam-ui/views.ts tests/unit/cbam-views.test.mjs
git commit -m "feat(cbam): view routing for the rail shell"
```

---

### Task 3: `title-card.ts`

**Files:**
- Create: `src/scripts/cbam-ui/title-card.ts`
- Test: `tests/unit/cbam-title-card.test.mjs`

- [ ] **Step 1: Write the failing test.**

```js
// tests/unit/cbam-title-card.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { renderTitleCard, titleSummary } from '../../src/scripts/cbam-ui/title-card.ts';

const LINE = {
  cn: '73063077', name: 'Other tubes, pipes and hollow profiles, welded',
  origin: 'India', route: '(C)', massT: '100', date: '2026-03-15',
};

test('no line: says so, and points at Estimate', () => {
  const html = renderTitleCard(null);
  assert.match(html, />Line being priced</);
  assert.match(html, />No line yet</);
  assert.equal(titleSummary(null), 'No line yet');
});

test('a line: code, name, origin · route, mass · date', () => {
  const html = renderTitleCard(LINE);
  assert.match(html, /class="cbx-tc-code">73063077</);
  assert.match(html, /title="Other tubes, pipes and hollow profiles, welded"/);
  assert.match(html, />India · \(C\)</);
  assert.match(html, />100 t · 2026-03-15</);
  assert.equal(titleSummary(LINE), '73063077 · India · (C) · 100 t');
});

test('every field is escaped', () => {
  const html = renderTitleCard({ ...LINE, name: '<img src=x onerror=alert(1)>"', massT: '1<b>' });
  assert.ok(!html.includes('<img'), 'name escaped');
  assert.ok(!html.includes('<b>'), 'mass escaped');
  assert.ok(!/title="[^"]*"[^ >]/.test(html), 'the quote cannot close the title attribute');
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `node --import tsx --test tests/unit/cbam-title-card.test.mjs`

Expected: FAIL, module not found.

- [ ] **Step 3: Implement.**

```ts
// src/scripts/cbam-ui/title-card.ts
// The rail's "Line being priced" card (spec §4.1), and the phone top bar's one-line summary.
// The server renders renderTitleCard(null) into the page, so the empty state has ONE spelling.

export interface TitleLine {
  cn: string;
  /** The pack's CN description, in full; CSS clamps it to two lines (spec §11, D5). */
  name: string;
  /** Display name, not the ISO code. */
  origin: string;
  route: string;
  massT: string;
  date: string;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderTitleCard(l: TitleLine | null): string {
  if (!l) {
    return '<p class="cbx-tc-k">Line being priced</p><p class="cbx-tc-code cbx-tc-none">No line yet</p>'
      + '<p class="cbx-tc-meta">Choose a good on Estimate.</p>';
  }
  return '<p class="cbx-tc-k">Line being priced</p>'
    + `<p class="cbx-tc-code">${esc(l.cn)}</p>`
    + `<p class="cbx-tc-name" title="${esc(l.name)}">${esc(l.name)}</p>`
    + `<p class="cbx-tc-meta">${esc(l.origin)} · ${esc(l.route)}</p>`
    + `<p class="cbx-tc-meta">${esc(l.massT)} t · ${esc(l.date)}</p>`;
}

/** Plain text (written with textContent), so no escaping. */
export function titleSummary(l: TitleLine | null): string {
  return l ? `${l.cn} · ${l.origin} · ${l.route} · ${l.massT} t` : 'No line yet';
}
```

- [ ] **Step 4: Run it and confirm it passes.**

Run: `node --import tsx --test tests/unit/cbam-title-card.test.mjs`

Expected: 3 pass.

- [ ] **Step 5: Commit.**

```bash
git add -- src/scripts/cbam-ui/title-card.ts tests/unit/cbam-title-card.test.mjs
git commit -m "feat(cbam): rail title card renderer"
```

---

### Task 4: `cbam-app.css`, the shell

**Files:**
- Create: `src/styles/cbam-app.css`

The visual reference is the preview's `system.css` (tokens) and `cbam.css` (shell), both in `docs/superpowers/specs/2026-11-02-cbam-rail-ui/preview/`. Compare your result with `screens/` in the same folder. The rules below are those, ported in three ways:
- they are scoped under `.cbx`;
- the preview's `[data-device="phone"]` rules become a media query;
- `aria-current="true"` becomes `"page"`.

Today's `cb-*` card styles stay in the page's existing `<style is:global>` blocks, untouched: phase 1 re-homes the cards and does not restyle them.

- [ ] **Step 1: Write the stylesheet.**

```css
/* src/styles/cbam-app.css. The CBAM Calculator's app shell (spec §4). Plates only, Light + Dark.
   Tokens are ported from the OBOS v2 / Birkenhead twin contract (preview 25-cbam-rail/system.css).
   Helvetica Neue through the system stack only: it is licensed and never embedded. Scoped under
   .cbx so nothing leaks into other pages across a soft navigation. */
.cbx{
  --sans:"Helvetica Neue",Helvetica,Arial,sans-serif;
  --ease:cubic-bezier(.16,1,.3,1);
  --ground:#EFECE6; --card:#FFFFFF; --well:rgba(20,22,20,.06); --well-2:rgba(20,22,20,.11); --line:rgba(20,22,20,.13);
  --ink:#141614; --ink-2:#363936; --ink-3:#4A4D49; --unit:#5E615D; --on-ink:#FFFFFF; --focus:#1f63d6;
  --shadow:0 1px 2px rgba(20,22,20,.06),0 18px 40px -22px rgba(20,22,20,.28);
  /* CBAM colour law: bronze = Commission default values and the mark-up; cyan = verified figures. */
  --bronze-t:#7A5718; --bronze-f:#A87A28; --bronze-bg:rgba(168,122,40,.13);
  --cyan-t:#0B6E7C; --cyan-f:#139AAD; --cyan-bg:rgba(19,154,173,.12);
  --rw:248px;
  color-scheme:light;
  position:fixed; inset:0; overflow:hidden;
  background:var(--ground); color:var(--ink);
  font:400 15px/1.45 var(--sans); -webkit-font-smoothing:antialiased;
}
@media (prefers-color-scheme:dark){ .cbx:not([data-theme="light"]){
  --ground:#031416; --card:#061b1d; --well:#0a2629; --well-2:#0d3236; --line:rgba(111,202,214,.16);
  --ink:#F1F3F0; --ink-2:#D3DCDB; --ink-3:#A9BCBE; --unit:#9FB3B5; --on-ink:#061b1d; --focus:#8ab4ff;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 24px 48px -24px rgba(0,0,0,.7);
  --bronze-t:#E0B766; --bronze-f:#CFA24A; --bronze-bg:rgba(224,183,102,.14);
  --cyan-t:#6FCAD6; --cyan-f:#6FCAD6; --cyan-bg:rgba(111,202,214,.13);
  color-scheme:dark;
}}
.cbx[data-theme="dark"]{
  --ground:#031416; --card:#061b1d; --well:#0a2629; --well-2:#0d3236; --line:rgba(111,202,214,.16);
  --ink:#F1F3F0; --ink-2:#D3DCDB; --ink-3:#A9BCBE; --unit:#9FB3B5; --on-ink:#061b1d; --focus:#8ab4ff;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 24px 48px -24px rgba(0,0,0,.7);
  --bronze-t:#E0B766; --bronze-f:#CFA24A; --bronze-bg:rgba(224,183,102,.14);
  --cyan-t:#6FCAD6; --cyan-f:#6FCAD6; --cyan-bg:rgba(111,202,214,.13);
  color-scheme:dark;
}
.cbx *,.cbx *::before,.cbx *::after{box-sizing:border-box}
.cbx :focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.cbx[data-rail="collapsed"]{--rw:72px}

/* Rail */
.cbx-rail{position:absolute;left:16px;top:16px;bottom:16px;width:var(--rw);padding:12px 8px;display:flex;flex-direction:column;gap:12px;overflow:hidden;background:var(--card);border-radius:22px;box-shadow:var(--shadow);transition:width .45s var(--ease);z-index:5}
.cbx-brand{display:flex;align-items:center;gap:10px;min-height:34px;padding-left:12px;color:var(--ink);text-decoration:none;white-space:nowrap}
.cbx-brand svg{flex:none}
.cbx-brand .cbx-lbl{display:flex;flex-direction:column;gap:2px;line-height:1.1;font-size:15px;letter-spacing:-.02em}
.cbx-brand b{font-weight:700}
.cbx-app{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2)}
.cbx-tcard{background:var(--well);border-radius:18px;padding:16px 16px 18px;min-width:0}
.cbx-tcard p{margin:0}
.cbx-tc-k{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2)}
.cbx-tc-code{font-size:28px;font-weight:200;letter-spacing:-.03em;line-height:1.1;margin-top:12px!important;white-space:nowrap}
.cbx-tc-none{font-size:18px;font-weight:700}
.cbx-tc-name{font-size:14px;font-weight:700;margin:4px 0 14px!important;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cbx-tc-meta{font-size:12px;color:var(--ink-2)}
.cbx-tc-meta+.cbx-tc-meta{margin-top:8px!important}
.cbx-nav{position:relative;display:flex;align-items:center;gap:10px;width:100%;height:40px;padding:0 10px 0 16px;border:0;background:transparent;border-radius:14px;color:var(--ink-2);font:500 13px var(--sans);cursor:pointer;text-align:left;white-space:nowrap}
.cbx-nav svg{width:20px;height:20px;flex:none;stroke:currentColor;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.cbx-nav:hover{color:var(--ink);background:var(--well)}
.cbx-nav[aria-current="page"]{background:var(--ink);color:var(--on-ink)}
.cbx-badge{margin-left:auto;min-width:20px;height:20px;border-radius:10px;background:var(--bronze-bg);color:var(--bronze-t);font-size:11px;font-weight:700;display:grid;place-items:center;padding:0 6px;font-style:normal}
.cbx-nav[aria-current="page"] .cbx-badge{background:var(--on-ink);color:var(--ink)}
.cbx-collapse{margin-top:auto;border-top:1px solid var(--line);border-radius:0 0 14px 14px}
.cbx[data-rail="collapsed"] .cbx-lbl,.cbx[data-rail="collapsed"] .cbx-badge{opacity:0;pointer-events:none}
.cbx[data-rail="collapsed"] .cbx-tcard{padding:8px 4px;text-align:center}
.cbx[data-rail="collapsed"] .cbx-tcard>:not(.cbx-tc-code){display:none}
.cbx[data-rail="collapsed"] .cbx-tc-code{font-size:13px;font-weight:700;width:4ch;overflow:hidden;margin:0 auto!important}
.cbx[data-rail="collapsed"] .cbx-collapse svg{transform:rotate(180deg)}

/* Main, views and headings */
.cbx-main{position:absolute;left:calc(16px + var(--rw) + 20px);right:0;top:0;bottom:0;overflow:auto;padding:18px 20px 32px 0;transition:left .45s var(--ease)}
.cbx-main:focus{outline:none}
.cbx [data-view][hidden]{display:none}
.cbx-h1{margin:6px 4px 18px;font-size:40px;font-weight:700;letter-spacing:-.035em;line-height:1.05}
.cbx-h1 span{display:block;color:var(--ink-3);font-weight:500}
.cbx-h1:focus{outline:none}
.cbx-plate{background:var(--card);border-radius:22px;padding:18px;box-shadow:var(--shadow)}
.cbx-actions{display:flex;gap:10px;flex-wrap:wrap;margin:0 4px 16px}

/* Empty states: shown only while the container just before them is :empty (spec §4.2). */
.cbx-empty{text-align:center;padding:48px 18px}
.cbx-empty p{color:var(--ink-2)}
:is(#cbOutlook,#cbGraphs,#cbList):not(:empty)+.cbx-empty{display:none}

/* The status strip: outside every view, so it is announced from any of them (spec §6.3). */
.cbx-status{position:sticky;bottom:12px;margin:16px 4px 0;padding:12px 16px;border-radius:14px;background:var(--ink);color:var(--on-ink);font-size:13px;box-shadow:var(--shadow)}
.cbx-status:empty{display:none}

/* Phone (spec §4.1) */
.cbx-top,.cbx-tabs{display:none}
@media (max-width:899px){
  .cbx-rail{display:none}
  .cbx-top{display:flex;position:absolute;top:10px;left:14px;right:14px;min-height:54px;align-items:center;gap:10px;padding:0 12px;border-radius:16px;background:var(--card);box-shadow:var(--shadow);z-index:7;font-size:13px;overflow:hidden}
  .cbx-top>div{min-width:0;line-height:1.25}
  .cbx-top .cbx-app{display:block;font-size:10px}
  .cbx-top #cbTitlePhone{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cbx-main{left:0;right:0;top:72px;bottom:64px;padding:6px 14px 28px}
  .cbx-h1{font-size:28px}
  .cbx-tabs{display:grid;grid-template-columns:repeat(5,1fr);position:absolute;left:0;right:0;bottom:0;height:64px;background:var(--card);border-top:1px solid var(--line);z-index:8}
  .cbx-tabs>button,.cbx-more>summary{position:relative;border:0;background:transparent;color:var(--ink-3);font:600 10.5px var(--sans);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer;list-style:none}
  .cbx-more>summary::-webkit-details-marker{display:none}
  .cbx-tabs svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
  .cbx-tabs [aria-current="page"]{color:var(--ink)}
  .cbx-tabs .cbx-badge{position:absolute;top:6px;left:56%;min-width:16px;height:16px;font-size:10px}
  .cbx-more{position:relative;display:flex}
  .cbx-more>summary{width:100%}
  .cbx-more>div{position:absolute;right:8px;bottom:72px;display:flex;flex-direction:column;min-width:200px;padding:8px;background:var(--card);border-radius:16px;box-shadow:var(--shadow)}
  .cbx-more>div>button{height:42px;border:0;background:transparent;border-radius:10px;padding:0 12px;font:600 14px var(--sans);color:var(--ink);text-align:left}
  .cbx-more>div>button[aria-current="page"]{background:var(--ink);color:var(--on-ink)}
}
```

- [ ] **Step 2: Commit.** It is not yet imported anywhere, so there is nothing to run.

```bash
git add -- src/styles/cbam-app.css
git commit -m "feat(cbam): app-shell stylesheet (tokens, rail, phone bars)"
```

---

### Task 5: Page markup, the shell and the six views

**Files:**
- Modify: `src/pages/cbam/cbam-calculator.astro`

**Rules for this task:**
- **MOVE, never retype.** Every existing block named below is cut and pasted **verbatim**, comments included, using the anchor named. Anchors are element ids or comment text, not line numbers, because phase 0 shifted the lines.
- Do not touch the page's header comment or the three `<style>` blocks.

- [ ] **Step 1: Frontmatter.**
  - Remove the `Nav` and `Footer` imports.
  - Add:

```astro
import '../../styles/cbam-app.css';
import { renderTitleCard } from '../../scripts/cbam-ui/title-card.ts';
```

  - Then change the `<Base …>` opening:
    - title becomes `"CBAM Calculator · Delta Climate"`;
    - keep `description` and `noindex`;
    - add `nativeScroll`, because the main area scrolls itself and Lenis must not start.

- [ ] **Step 2: Replace everything between `<Base …>` and `</Base>` with the skeleton below.** Fill each `<!-- MOVE … -->` with the named block, cut from the old markup.

```astro
  <div class="cbx" id="cbx">
    <nav class="cbx-rail" aria-label="Calculator sections">
      <a class="cbx-brand" href="/" aria-label="Delta Climate Research, home">
        <svg viewBox="0 0 28 28" width="26" height="26" aria-hidden="true"><path d="M14 3 25 24H3Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M14 9.5 20 21H8Z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M14 15 16.5 20H11.5Z" fill="currentColor"/></svg>
        <span class="cbx-lbl"><span><b>Delta</b> Climate</span><span class="cbx-app">CBAM Calculator</span></span>
      </a>
      <div class="cbx-tcard" id="cbTitle" set:html={renderTitleCard(null)} />
      <button type="button" class="cbx-nav" data-goto="estimate"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3.5h10a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1ZM7 7h6M7 10.5h2M11 10.5h2M7 13.5h2M11 13.5h2"/></svg><span class="cbx-lbl">Estimate</span></button>
      <button type="button" class="cbx-nav" data-goto="three-years"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 16V11M10 16V7M16 16V3.5"/></svg><span class="cbx-lbl">Three years</span></button>
      <button type="button" class="cbx-nav" data-goto="why"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 15 8 10l3 2.5 5-7M12.5 5.5H16V9"/></svg><span class="cbx-lbl">Why it changes</span></button>
      <button type="button" class="cbx-nav" data-goto="list"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5h9M7 10h9M7 15h9M3.5 5h.5M3.5 10h.5M3.5 15h.5"/></svg><span class="cbx-lbl">Shipment list</span><em class="cbx-badge" data-list-badge hidden></em></button>
      <button type="button" class="cbx-nav" data-goto="export"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5v9M6.5 9.5 10 13l3.5-3.5M4 16.5h12"/></svg><span class="cbx-lbl">Export</span></button>
      <button type="button" class="cbx-nav" data-goto="rules"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3.5h7l3 3V16a.5.5 0 0 1-.5.5h-9.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5ZM7.5 9.5h5M7.5 12.5h5M7.5 6.5h2.5"/></svg><span class="cbx-lbl">Rules &amp; sources</span></button>
      <button type="button" class="cbx-nav cbx-collapse" data-collapse aria-expanded="true"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 5 7 10l5 5"/></svg><span class="cbx-lbl">Collapse menu</span></button>
    </nav>

    <header class="cbx-top">
      <a href="/" aria-label="Delta Climate Research, home"><svg viewBox="0 0 28 28" width="24" height="24" aria-hidden="true"><path d="M14 3 25 24H3Z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></a>
      <div><span class="cbx-app">CBAM Calculator</span><span id="cbTitlePhone">No line yet</span></div>
    </header>

    <main id="main" tabindex="-1" class="cbx-main">
      <section data-view="estimate" aria-labelledby="cbxH-estimate">
        <h1 id="cbxH-estimate" class="cbx-h1" tabindex="-1">Estimate. <span>A labelled what-if, not a declaration.</span></h1>
        <!-- MOVE: the <p class="cb-eyebrow"> element, verbatim. -->
        <!-- MOVE: the "NON-NEGOTIABLE §7.1" comment block and the <div class="cb-banner" role="note"> element, verbatim. -->
        <!-- MOVE: the whole <div class="cb-grid"> … </div> (form section + #cbOutWrap), verbatim, with three edits:
               (a) inside the form, delete the <p class="cb-note" id="cbStatus" …></p> element (it moves to the strip below);
               (b) inside .cb-lineactions, delete the #cbCsv and #cbDoc buttons (they move to Export);
               (c) inside #cbOutWrap, cut the <div id="cbOutlook" …></div> and <div id="cbGraphs" …></div> elements and
                   their preceding comments (they move to Three years and Why). Keep #cbOut, its idle <p>, and #cbProv. -->
      </section>

      <section data-view="three-years" aria-labelledby="cbxH-years" hidden>
        <h1 id="cbxH-years" class="cbx-h1" tabindex="-1">Three years. <span>2026 to 2028, the law as published.</span></h1>
        <!-- MOVE: the #cbOutlook comment and element, verbatim. The element must stay written with no whitespace inside it (:empty). -->
        <div class="cbx-plate cbx-empty"><p>Price a line first. The three-year view appears once a line is priced.</p><button type="button" class="cb-btn" data-goto="estimate">Go to Estimate</button></div>
      </section>

      <section data-view="why" aria-labelledby="cbxH-why" hidden>
        <h1 id="cbxH-why" class="cbx-h1" tabindex="-1">Why it changes. <span>The same line, drawn.</span></h1>
        <!-- MOVE: the #cbGraphs comment and element, verbatim (no whitespace inside it). -->
        <div class="cbx-plate cbx-empty"><p>Price a line first. The graphs appear once a line is priced.</p><button type="button" class="cb-btn" data-goto="estimate">Go to Estimate</button></div>
      </section>

      <section data-view="list" aria-labelledby="cbxH-list" hidden>
        <h1 id="cbxH-list" class="cbx-h1" tabindex="-1">Shipment list. <span>Every line, the annual de minimis test and the total.</span></h1>
        <div class="cbx-actions"><button type="button" class="cb-btn" data-goto="estimate">Add a line</button></div>
        <!-- THE LIST'S OWN CONTAINER (spec §6.3). aria-live="off" for the reason renderAll's
             comment gives: every add, remove and attest rebuilds every card, and reading that
             wall back on each click buried the answer. #cbStatus carries the spoken summary. -->
        <div id="cbList" aria-live="off"></div>
        <div class="cbx-plate cbx-empty"><p>No lines yet. Price a line on Estimate, then add it to the list.</p><button type="button" class="cb-btn" data-goto="estimate">Go to Estimate</button></div>
      </section>

      <section data-view="export" aria-labelledby="cbxH-export" hidden>
        <h1 id="cbxH-export" class="cbx-h1" tabindex="-1">Export. <span>CSV and document.</span></h1>
        <div class="cbx-actions">
          <!-- MOVE: the #cbCsv and #cbDoc buttons, verbatim (both still ship disabled). -->
        </div>
      </section>

      <section data-view="rules" aria-labelledby="cbxH-rules" hidden>
        <h1 id="cbxH-rules" class="cbx-h1" tabindex="-1">Rules &amp; sources. <span>What this rests on.</span></h1>
        <!-- MOVE: the <p class="cb-foot"> method paragraph, verbatim. -->
      </section>

      <!-- MOVED HERE FROM THE FORM (spec §6.3). A live region inside a [hidden] view is never
           announced, and Remove and attest happen on the List view. One writer, as before. -->
      <p class="cb-note cbx-status" id="cbStatus" role="status" aria-live="polite"></p>

      <!-- MOVE: the "Print-only" comment and <section id="cbPrint" aria-hidden="true"></section>, verbatim. -->
    </main>

    <nav class="cbx-tabs" aria-label="Calculator sections">
      <button type="button" data-goto="estimate"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3.5h10a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1ZM7 7h6M7 10.5h2M11 10.5h2M7 13.5h2M11 13.5h2"/></svg><span>Estimate</span></button>
      <button type="button" data-goto="three-years"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 16V11M10 16V7M16 16V3.5"/></svg><span>3 years</span></button>
      <button type="button" data-goto="why"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 15 8 10l3 2.5 5-7M12.5 5.5H16V9"/></svg><span>Why</span></button>
      <button type="button" data-goto="list"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5h9M7 10h9M7 15h9M3.5 5h.5M3.5 10h.5M3.5 15h.5"/></svg><span>List</span><em class="cbx-badge" data-list-badge hidden></em></button>
      <details class="cbx-more">
        <summary><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4.5" cy="10" r="1.2"/><circle cx="10" cy="10" r="1.2"/><circle cx="15.5" cy="10" r="1.2"/></svg><span>More</span></summary>
        <div>
          <button type="button" data-goto="export">Export</button>
          <button type="button" data-goto="rules">Rules &amp; sources</button>
        </div>
      </details>
    </nav>
  </div>
```

- [ ] **Step 3: The page script.** Replace the `<script>` block's body with:

```astro
<script>
  import { initCbam } from '../../scripts/cbam-algos/cbam-app.ts';
  import { mountViews } from '../../scripts/cbam-ui/views.ts';
  // Mount on load and on soft nav (ClientRouter), matching the heat map's pattern. Both guard
  // against the double call themselves (astro:page-load also fires on first paint).
  const boot = () => {
    const root = document.getElementById('cbx');
    if (!root) return;
    // ?theme=light|dark forces a theme, for tests and screenshots. Otherwise the OS decides.
    const theme = new URLSearchParams(location.search).get('theme');
    if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
    mountViews(root);
    initCbam();
  };
  boot();
  document.addEventListener('astro:page-load', boot);
</script>
```

- [ ] **Step 4: Check the moves left nothing behind and nothing doubled.**

Run:
```bash
for id in cbAdd cbAttest cbCn cbCnList cbCountry cbCsv cbDate cbDateNote cbDoc cbGraphs cbMass cbOut cbOutWrap cbOutlook cbPrint cbProv cbRef cbRoute cbRouteNote cbScope cbScopeRow cbSeeDirect cbSeeIndirect cbSeeIndirectRow cbStatus cbTier cbVerifiedRow cbList cbTitle cbTitlePhone; do
  printf '%s %s\n' "$id" "$(grep -c "id=\"$id\"" src/pages/cbam/cbam-calculator.astro)"; done | grep -v ' 1$' || echo "all ids exactly once"
grep -c 'class="cb-banner"' src/pages/cbam/cbam-calculator.astro
grep -E 'id="(cbOutlook|cbGraphs|cbList)"[^>]*>\s+<' src/pages/cbam/cbam-calculator.astro || echo "containers empty"
```

Expected: `all ids exactly once`, then `1`, then `containers empty`.

- [ ] **Step 5: Run the pins.**

Run: `npm run check && npm run test:unit`

Expected: all pass. The tests that read this file still find what they need:
- the §7.1 banner and eyebrow pins (`cbam-render.test.mjs`): the banner is still before `cb-grid`;
- the placeholder test;
- the idle-copy contract (`build-contracts.test.mjs`).

**If one fails, fix the markup, not the test.**

- [ ] **Step 6: Commit.**

```bash
git add -- src/pages/cbam/cbam-calculator.astro
git commit -m "feat(cbam): app shell with six views; existing cards re-homed unchanged"
```

---

### Task 6: An e2e spec for the shell, which fails first

**Files:**
- Create: `tests/e2e/cbam-shell.spec.ts`

- [ ] **Step 1: Write the spec.**

```ts
// tests/e2e/cbam-shell.spec.ts
// The rail shell (spec §4) and the one behaviour change (spec §6.3): the draft always previews.
import { expect, test, type Page } from '@playwright/test';

const URL = '/cbam/cbam-calculator/';

async function view(page: Page, name: string): Promise<void> {
  await page.locator(`.cbx-rail [data-goto="${name}"]`).click();
  await expect(page.locator(`[data-view="${name}"]`)).toBeVisible();
}

async function priceLine(page: Page): Promise<void> {
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

test.describe('CBAM shell', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('opens on Estimate, and only one view is visible', async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator('[data-view="estimate"]')).toBeVisible();
    await expect(page.locator('[data-view]:visible')).toHaveCount(1);
    await expect(page.locator('.cbx-rail [data-goto="estimate"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.cbx-app').first()).toHaveText(/CBAM Calculator/i);
  });

  test('the rail switches views, writes the hash, and focuses the heading', async ({ page }) => {
    await page.goto(URL);
    await view(page, 'rules');
    expect(new globalThis.URL(page.url()).hash).toBe('#rules');
    await expect(page.locator('#cbxH-rules')).toBeFocused();
    await expect(page.locator('[data-view="estimate"]')).toBeHidden();
  });

  test('a hash opens its view; an unknown one falls back to Estimate', async ({ page }) => {
    await page.goto(`${URL}#why`);
    await expect(page.locator('[data-view="why"]')).toBeVisible();
    await page.goto(`${URL}#nope`);
    await expect(page.locator('[data-view="estimate"]')).toBeVisible();
  });

  test('empty views say what to do', async ({ page }) => {
    await page.goto(`${URL}#three-years`);
    await expect(page.locator('[data-view="three-years"] .cbx-empty')).toBeVisible();
    await page.goto(`${URL}#list`);
    await expect(page.locator('[data-view="list"] .cbx-empty')).toBeVisible();
  });

  test('the title card follows the draft', async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator('#cbTitle')).toContainText('No line yet');
    await priceLine(page);
    await expect(page.locator('#cbTitle .cbx-tc-code')).toHaveText('2523100090');
    await expect(page.locator('#cbTitle')).toContainText('(A)');
  });

  test('spec §6.3: with lines in the list, the draft still previews', async ({ page }) => {
    await page.goto(URL);
    await priceLine(page);
    await page.click('#cbAdd');
    await expect(page.locator('#cbList .cb-line')).toHaveCount(1);
    await expect(page.locator('.cbx-rail [data-list-badge]')).toHaveText('1');
    // The list did NOT replace the preview…
    await expect(page.locator('#cbOut .cb-line')).toHaveCount(0);
    await expect(page.locator('#cbOut .cb-cost')).toBeVisible();
    // …and editing the next line still previews it.
    await page.fill('#cbMass', '200');
    await expect(page.locator('#cbTitle')).toContainText('200 t');
    await view(page, 'three-years');
    await expect(page.locator('#cbOutlook .cb-ol')).toBeVisible();
  });

  test('remove and attest work on the List view and are announced', async ({ page }) => {
    await page.goto(URL);
    await priceLine(page);
    await page.click('#cbAdd');
    await view(page, 'list');
    await expect(page.locator('#cbStatus')).toBeVisible();
    await expect(page.locator('#cbStatus')).toContainText('1 line in this estimate');
    await page.locator('#cbList [data-remove]').first().click();
    await expect(page.locator('#cbList .cb-line')).toHaveCount(0);
    await expect(page.locator('[data-view="list"] .cbx-empty')).toBeVisible();
    await expect(page.locator('#cbxH-list')).toBeFocused();
  });

  test('phone: tab bar and top bar replace the rail', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(URL);
    await expect(page.locator('.cbx-rail')).toBeHidden();
    await expect(page.locator('.cbx-top')).toContainText('CBAM Calculator');
    await page.locator('.cbx-tabs [data-goto="why"]').click();
    await expect(page.locator('[data-view="why"]')).toBeVisible();
    await page.locator('.cbx-more > summary').click();
    await page.locator('.cbx-more [data-goto="rules"]').click();
    await expect(page.locator('[data-view="rules"]')).toBeVisible();
  });
});
```

- [ ] **Step 2: Register it for the CBAM browsers.** In `playwright.config.ts`, the `firefox-cbam` and `webkit-cbam` projects use `testMatch: '**/cbam-lines.spec.ts'`. Change both to `testMatch: /cbam-(lines|shell)\.spec\.ts/`. The default chromium project already picks the file up; confirm that with `npx playwright test --list tests/e2e/cbam-shell.spec.ts | head`.

- [ ] **Step 3: Run it and confirm the §6.3 tests fail.**

```bash
npm run build && npx playwright test tests/e2e/cbam-shell.spec.ts --project=chromium-tier0 --reporter=line
```

Expected:
- PASS: the first four tests and the phone test.
- FAIL:
  - "the title card follows the draft": `#cbTitle` never updates;
  - "§6.3": `#cbList` is empty and the line lands in `#cbOut`;
  - "remove and attest": the same cause.

Copy the failure lines into the task report.

- [ ] **Step 4: Commit the failing spec.**

```bash
git add -- tests/e2e/cbam-shell.spec.ts playwright.config.ts
git commit -m "test(cbam): shell e2e, including the always-preview behaviour (red)"
```

---

### Task 7: `cbam-app.ts` wiring — `#cbList`, always preview, title card, badge

**Files:**
- Modify: `src/scripts/cbam-algos/cbam-app.ts`. Only inside `initCbam`, plus one import line. **This file is not vendored** (it is absent from `UPSTREAM.json`), so `cbam-sync-check` will not object.

- [ ] **Step 1: Before editing, list every place that writes or reads the list in `#cbOut`.**

Run: `grep -n -E "out!?\.(innerHTML|querySelector|addEventListener)|out\.add|refresh = |paintOutlook\(null\)|paintGraphs\(null\)|setAttribute\('aria-live'" src/scripts/cbam-algos/cbam-app.ts`

**Read every hit.** The expected set: `runPreview`'s `out!.innerHTML` writes (they keep `out`), `renderAll`'s list write and its two `aria-live` toggles, `onOutClick`'s two `out!.querySelector*` focus lookups, `refresh`, and the two `out.addEventListener` lines. If the grep shows anything outside that set, stop and report it before editing.

Then confirm the draft preview renders no list controls:

Run: `grep -n "data-remove\|data-attest" src/scripts/cbam-algos/cbam-app.ts`

Every hit must sit in `renderYearThreshold` (the year cards), `renderLineCard`, `renderAll` or `onOutClick`. `renderDraftThreshold` reaches `renderYearThreshold` only with `ruleFound: false`. Read that arm and confirm it emits no `data-attest`; if it does, report it.

- [ ] **Step 2: Import the title card.** Add next to the other `../cbam-*` imports at the top:

```ts
import { renderTitleCard, titleSummary, type TitleLine } from '../cbam-ui/title-card.ts';
```

- [ ] **Step 3: Look up the new elements.** In `initCbam`, directly after `const graphsEl = $('cbGraphs');`:

```ts
  // The rail shell (spec §6.3): the list has its own container, so #cbOut only ever previews the
  // draft. The title card and the List badge are optional, so a stripped-down page still runs.
  const listEl = $('cbList');
  const titleEl = $('cbTitle'), titlePhone = $('cbTitlePhone');
  const badges = document.querySelectorAll<HTMLElement>('[data-list-badge]');
  const listHeading = $('cbxH-list');
```

Extend the guard on the next line so the page refuses to wire without the list container:

```ts
  if (!cn || !country || !route || !mass || !date || !out || !status || !listEl) return;
```

- [ ] **Step 4: Add the title-card painter.** Put it directly above `function run(): void {`:

```ts
  /** The rail's title card and the phone top bar follow the draft line (spec §4.1). */
  function paintTitle(line: EstimatorInput | null): void {
    const t: TitleLine | null = line && pack ? {
      cn: line.cn,
      name: pack.classifications.find((c) => c.code === line.cn)?.description ?? '',
      origin: countryName(line.country),
      route: line.route,
      massT: line.massT,
      date: line.date,
    } : null;
    if (titleEl) titleEl.innerHTML = renderTitleCard(t);
    if (titlePhone) titlePhone.textContent = titleSummary(t);
  }
```

Then change `run()` to:

```ts
  function run(): void {
    const line = runPreview();
    paintTitle(line);
    paintOutlook(line);
    paintGraphs(line);
  }
```

- [ ] **Step 5: Rewrite the head of `renderAll()`, its list write, and the aria-live toggles.**

Replace the `if (!lines.length) { … run(); return; }` block, and the two lines after it (`paintOutlook(null);` and `paintGraphs(null);`) together with their comment, with:

```ts
    // SPEC §6.3: THE DRAFT ALWAYS PREVIEWS. The list has its own view and container (#cbList),
    // so adding, removing or attesting never touches #cbOut, #cbOutlook or #cbGraphs. Those show
    // the line being edited, and refresh() keeps them current whether or not lines exist. That is
    // why this function no longer calls run(): nothing it changes is part of the draft.
    badges.forEach((b) => { b.textContent = String(lines.length); b.hidden = lines.length === 0; });
    if (!lines.length) {
      lastPairs = [];
      listEl!.innerHTML = '';
      // Still cleared, for the reason the original comment gave: a stale euro figure must not be
      // announced as current once the list is empty.
      status!.textContent = '';
      return;
    }
```

Delete both `outWrap?.setAttribute('aria-live', …)` lines, and the paragraph of comment above the second one. `#cbOutWrap` now holds one draft again and stays `polite` from its markup, while the list's region is `aria-live="off"` in markup (Task 5). Then change the list write from `out!.innerHTML = yearsHtml + …` to:

```ts
    listEl!.innerHTML = yearsHtml + renderTotals(totals) + pairs.map((p, i) => p.e
```

Leave the rest of that expression unchanged.

- [ ] **Step 6: Point `onOutClick` at the list.**
  - In the remove branch, change `out!.querySelectorAll<HTMLButtonElement>('[data-remove]')` to `listEl!.querySelectorAll<HTMLButtonElement>('[data-remove]')`.
  - Change the fallback `?? add)?.focus();` to `?? listHeading)?.focus();`.
  - Update the comment above it: with no lines left, focus goes to the List heading, because the Add button is on a different, hidden view.
  - In the attest branch, change `out!.querySelector<HTMLInputElement>(` to `listEl!.querySelector<HTMLInputElement>(`.
  - At the two listener lines (`out.addEventListener('click', onOutClick);` and `out.addEventListener('change', onOutClick);`), replace `out` with `listEl`.

- [ ] **Step 7: The draft always previews.** Replace:

```ts
  const refresh = () => { if (!lines.length) run(); };
```

with:

```ts
  // Spec §6.3: the form previews the line being edited whether or not lines exist. The list has
  // its own view now, so a preview can no longer overwrite it.
  const refresh = () => run();
```

Also delete the four-line comment above it, which describes the old rule.

- [ ] **Step 8: Type-check and unit-test.**

Run: `npm run check && npm run test:unit`

Expected: both clean, and the unit count is the baseline + 6.

- [ ] **Step 9: Run the shell spec; it should now pass.**

```bash
npm run build && npx playwright test tests/e2e/cbam-shell.spec.ts --project=chromium-tier0 --reporter=line
```

Expected: 8 passed.

- [ ] **Step 10: Commit.**

```bash
git add -- src/scripts/cbam-algos/cbam-app.ts
git commit -m "feat(cbam): list renders into #cbList; the draft always previews (spec §6.3)"
```

---

### Task 8: Move `cbam-lines.spec.ts` onto the views

**Files:**
- Modify: `tests/e2e/cbam-lines.spec.ts`

Phase 1 changed where things are, not what they say. **No expected text, figure or count changes in this task**, with one deliberate exception (step 4). Every other edit is navigation or a container name.

- [ ] **Step 1: Add a view helper** below `addLine`:

```ts
/** The rail shell (spec §4.2): content outside the visible view cannot be clicked or seen. */
async function view(page: Page, name: 'estimate' | 'three-years' | 'why' | 'list' | 'export' | 'rules'): Promise<void> {
  await page.locator(`.cbx-rail [data-goto="${name}"]`).click();
  await expect(page.locator(`[data-view="${name}"]`)).toBeVisible();
}
```

- [ ] **Step 2: Run the spec and collect the failures.**

```bash
npx playwright test tests/e2e/cbam-lines.spec.ts --project=chromium-tier0 --reporter=line 2>&1 | tee /Volumes/OBOSLab/tmp/cbam-rail-p1-lines.txt | tail -40
```

- [ ] **Step 3: Fix each failure with exactly one of these four rules.** Write the rule number in the task report next to each test name.
  1. **The test reads or clicks list content** (`.cb-line`, `.cb-thresh`, `[data-remove]`, `[data-attest]`, the totals card) after `addLine`. Insert `await view(page, 'list');` before the first such read. If the locator is scoped to `#cbOut` (for example `#cbOut .cb-line`), change it to `#cbList`.
  2. **The test reads `#cbOutlook`, `#cbOlPrice` or the strip.** Insert `await view(page, 'three-years');` before it.
  3. **The test reads `#cbGraphs`, `.cg-*` or `#cgSecond`.** Insert `await view(page, 'why');` before it.
  4. **The test clicks `#cbCsv` or `#cbDoc`.** Insert `await view(page, 'export');` before it. Afterwards, return to Estimate with `await view(page, 'estimate');` before the form is next touched.

  For each fix, check whether the same test later touches the form (`#cbCn`, `#cbMass`, `#cbAdd`, …). If it does, insert `await view(page, 'estimate');` before that.

- [ ] **Step 4: The one deliberate expectation change.** Find the tests asserting that adding a line **clears** the preview. Today's known one is at `await expect(page.locator('#cbOutlook .cb-ol-stack')).toHaveCount(0);`; grep for more with `grep -n "toHaveCount(0)" tests/e2e/cbam-lines.spec.ts`. For each one:
  - read the test;
  - if its point is "the strip clears once lines exist", invert it to the §6.3 behaviour: the strip still shows the draft. Add a comment citing spec §6.3, and say in the commit message that it changed on purpose;
  - if its point is something else (for example, a refused draft shows no strip), leave it and apply rule 2.

- [ ] **Step 5: Re-run until green, then run the other CBAM browsers once.**

```bash
npx playwright test tests/e2e/cbam-lines.spec.ts tests/e2e/cbam-shell.spec.ts --project=chromium-tier0 --reporter=line
npx playwright test --project=firefox-cbam --reporter=line
```

Expected: everything passes. The test count must equal the count before this task (`grep -c "^\s*test(" tests/e2e/cbam-lines.spec.ts`, before and after). **A test that was deleted or skipped is a failure of this task.**

- [ ] **Step 6: Commit.**

```bash
git add -- tests/e2e/cbam-lines.spec.ts
git commit -m "test(cbam): lines spec navigates the rail views; strip-clears test inverted per spec §6.3"
```

---

### Task 9: Gate, screenshots, review, PR

**Files:** none new.

- [ ] **Step 1: The local gate.**

Run: `npm run check && npm run test:unit`

Expected: clean. The unit count is the Task 1 baseline + 6.

- [ ] **Step 2: Headless screenshots.** Take 1440×900 and 390×844 shots of every view in both themes, plus Estimate with a priced line and List with two lines, through `?theme=light|dark`. That is 26 PNGs. Write them to `/Volumes/OBOSLab/tmp/cbam-rail-p1-shots/`. **Do not open a visible browser.** Look at each one and check that:
  - the rail never overlaps the main area;
  - the old `cb-*` cards render inside the views without clipping;
  - each empty card shows only while its container is empty;
  - the status strip is hidden while empty.

- [ ] **Step 3: Opus review.** Dispatch an Opus 5.5 reviewer with this plan, the spec's §4 and §6, and `git diff origin/main...HEAD`. Ask it to check four things:
  - every id from spec §6.4 exists exactly once;
  - no assertion was loosened in Task 8;
  - the §7.1 banner text is byte-identical to `origin/main`;
  - `#cbStatus` is announced from the List view.

  Fix what it confirms.

- [ ] **Step 4: Push and open the PR into the integration branch.** Do this **only on the user's word.**

```bash
git log --oneline origin/main..HEAD
git push -u origin feat/cbam-rail-ui
```

`feat/cbam-rail-ui` is itself the integration branch, so phase 1 is its first content: open a **draft** PR titled "CBAM Calculator rail redesign (phase 1 of 5: shell)", base `main`. It stays a draft until phase 5. Production gets one merge (roadmap).

---

## Self-review against the spec

| Spec | Task |
|---|---|
| §4.1 rail, lockup, title card, six buttons, collapse | 4, 5, 2, 3, 7 |
| §4.1 phone top bar and tab bar with More | 4, 5, 6 |
| §4.2 hash views, `replaceState`, `aria-current`, heading focus, empty states | 2, 5, 6 |
| §4.3 Helvetica stack, Plates, Light/Dark, `?theme=` | 4, 5 |
| §6.2 banner once, verbatim, before `cb-grid`; eyebrow kept | 5 (step 5 pins) |
| §6.3 `#cbList`, the draft always previews, the status strip, aria-live | 5, 7, 6, 8 |
| §6.4 ids and hooks | 5 (step 4), 9 (review) |
| §6.5 nav landmarks, focus | 2, 5, 6 |
| §4.3 icon tones, §5 tiles, §8 motion | **Not in phase 1**: phases 2–5 |
