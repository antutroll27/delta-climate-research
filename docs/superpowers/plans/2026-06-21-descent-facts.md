# Descent Facts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface animated Climate Clock facts during the dark-water engulf descent — big statements whose numbers count up as you scroll, fixing the "feels stuck" dead-scroll before 01.

**Architecture:** New `DescentFacts.astro` overlay (5 static fact nodes, hidden) mounted in the hero + `descent-facts.ts` (fetch the live Climate Clock API, one scrub ScrollTrigger on `#hero-track` driving per-fact count/fade), wired into `Base.astro`. The `#hero-track` is extended 250→340vh for scroll room. Independent of the engulf (`activeST`) and the seam-snap.

**Tech Stack:** Astro, GSAP ScrollTrigger, Lenis, Climate Clock v2 API. Spec: `docs/superpowers/specs/2026-06-21-descent-facts-design.md`.

---

## Preconditions

No unit-test harness — verify **visually + probe** via `/tmp/cdpshot.mjs` (recreate if `/tmp` wiped) against the running dev server (`http://localhost:4321/`). Probe a fact mid-descent by scrolling and reading opacity/text. The facts are gated to desktop+motion.

---

## Task 1: DescentFacts overlay markup + extend the track

Static, hidden overlay (5 facts with fallback values inlined) mounted in the hero; lengthen the track.

**Files:**
- Create: `src/components/DescentFacts.astro`
- Modify: `src/components/Hero.astro` (mount the overlay; `.hero-track` height 250vh→340vh)

- [ ] **Step 1: Create `src/components/DescentFacts.astro`:**
```astro
---
// Descent facts — Climate Clock statements that surface during the engulf's dark-water
// descent (driven by src/scripts/descent-facts.ts; desktop + motion only). Static markup
// with fallback values inlined so first paint shows real numbers; the script overrides
// with live API values + scrubs the count/fade to scroll.
const FACTS = [
  { key: 'carbon_deadline_1',            kick: 'Time left · 1.5°C', unit: 'YRS',        lab: 'until the 1.5°C carbon budget runs out', src: 'climateclock.world', fb: 5,    dec: 0, thou: false },
  { key: 'actnow',                       kick: 'If we act now',     unit: '$ Trillion', lab: 'saved by acting now vs. delay',           src: 'lifeline',          fb: 32,   dec: 0, thou: false },
  { key: 'renewables_1',                 kick: 'World energy',      unit: '%',          lab: "of the world's energy is now renewable",  src: 'lifeline',          fb: 11.4, dec: 1, thou: false },
  { key: 'initiative_30x30',             kick: 'Protected',         unit: '%',          lab: "of Earth's land & waters are protected",  src: '30×30',             fb: 17.6, dec: 1, thou: false },
  { key: 'ff_divestment_stand_dot_earth',kick: 'Divested',          unit: '$ Trillion', lab: 'pulled out of fossil fuels',              src: 'stand.earth',       fb: 40.8, dec: 1, thou: false },
];
const fmt = (v: number, d: number, t: boolean) => d > 0 ? v.toFixed(d) : (t ? Math.round(v).toLocaleString('en-US') : String(Math.round(v)));
---
<div class="dfacts" aria-hidden="true">
  {FACTS.map((f) => (
    <div class="dfact" data-key={f.key} data-fb={f.fb} data-dec={f.dec} data-thou={String(f.thou)}>
      <div class="dkick">{f.kick}</div>
      <div class="dval"><span data-n>{fmt(f.fb, f.dec, f.thou)}</span><span class="du">{f.unit}</span></div>
      <div class="dlab">{f.lab}</div>
      <div class="dsrc">{f.src}</div>
    </div>
  ))}
</div>

<style>
  .dfacts { position: absolute; inset: 0; z-index: 3; display: grid; place-items: center; pointer-events: none; }
  .dfact { position: absolute; text-align: center; width: min(90vw, 1100px); opacity: 0; will-change: opacity, transform; }
  .dkick { font-family: var(--font-mono); font-size: 0.74rem; letter-spacing: 0.24em; text-transform: uppercase; color: var(--color-bronze); margin-bottom: 1.4rem; }
  .dval { font-weight: 500; font-size: clamp(3.2rem, 11vw, 9rem); line-height: 0.95; letter-spacing: -0.03em; color: var(--color-paper); }
  .dval .du { color: var(--color-cyan); font-size: 0.42em; letter-spacing: -0.01em; margin-left: 0.2em; }
  .dlab { margin-top: 1.4rem; font-size: clamp(1rem, 1.6vw, 1.35rem); color: var(--color-ink-faint); }
  .dsrc { margin-top: 1rem; font-family: var(--font-mono); font-size: 0.6rem; letter-spacing: 0.18em; text-transform: uppercase; color: rgb(111 202 214 / 0.4); }
  @media (max-width: 767px), (prefers-reduced-motion: reduce) { .dfacts { display: none; } }
</style>
```

- [ ] **Step 2: Mount it + extend the track in `src/components/Hero.astro`.** After the `<div class="grain" aria-hidden="true"></div>` line, add the import (in the frontmatter `---` block, alongside the other imports: `import DescentFacts from './DescentFacts.astro';`) and the mount right after `.grain`:
```astro
  <div class="grain" aria-hidden="true"></div>
  <DescentFacts />
```
Then change the track height. Find:
```css
  .hero-track { height: 250vh; }
```
and change to:
```css
  .hero-track { height: 340vh; }   /* longer descent — room for the engulf + the climate facts */
```

- [ ] **Step 3: Verify the hero still renders normally (facts hidden).** Reload dev:
```bash
node /tmp/cdpshot.mjs "http://localhost:4321/" /tmp/t1.png 9000 "1"
```
Expected: `ERRORS (none)`; `/tmp/t1.png` shows the normal hero (headline + river) — the facts are `opacity:0`, so invisible at the top. No layout breakage.

- [ ] **Step 4: Commit.**
```bash
git add src/components/DescentFacts.astro src/components/Hero.astro
git commit -m "feat(hero): descent-facts overlay markup + longer track (Climate Clock facts)"
```

---

## Task 2: descent-facts.ts — live data + scroll-scrubbed count/fade

**Files:**
- Create: `src/scripts/descent-facts.ts`
- Modify: `src/layouts/Base.astro` (wire init/destroy)

- [ ] **Step 1: Create `src/scripts/descent-facts.ts`:**
```ts
// src/scripts/descent-facts.ts
// Drives the DescentFacts overlay: resolves live Climate Clock values, then a single
// scrub ScrollTrigger on #hero-track surfaces each fact in turn (fade + count-up) across
// the dark-water descent. Desktop + motion only; independent of the engulf + seam-snap.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motionOK } from '../utils/motion';

gsap.registerPlugin(ScrollTrigger);

let st: ScrollTrigger | undefined;
const CACHE_KEY = 'cc:v2';
const YEAR_MS = 365.25 * 24 * 3600 * 1000;
const DEADLINE_FALLBACK = Date.parse('2029-07-22T16:00:00+00:00');

const sm = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const fmt = (v: number, d: number, t: boolean) => d > 0 ? v.toFixed(d) : (t ? Math.round(v).toLocaleString('en-US') : String(Math.round(v)));

async function getModules(): Promise<any> {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) { const c = JSON.parse(cached); if (Date.now() - c.at < 86400000) return c.data?.modules; }
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch('https://api.climateclock.world/v2/clock.json', { signal: ctrl.signal });
    clearTimeout(to);
    const data = (await res.json())?.data;
    if (data) sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
    return data?.modules;
  } catch { return undefined; }
}

export async function initDescentFacts() {
  destroyDescentFacts();
  if (!motionOK() || !window.matchMedia('(min-width: 768px)').matches) return;
  const track = document.getElementById('hero-track');
  const nodes = [...document.querySelectorAll<HTMLElement>('.dfact')];
  if (!track || !nodes.length) return;

  const mods = await getModules();
  if (st) return; // a teardown raced us during the await
  // resolve each fact's target value (live, else the inlined fallback)
  const facts = nodes.map((el) => {
    const key = el.dataset.key!;
    const dec = parseInt(el.dataset.dec || '0', 10);
    const thou = el.dataset.thou === 'true';
    let target = parseFloat(el.dataset.fb || '0');
    if (key === 'carbon_deadline_1') {
      const ts = mods?.carbon_deadline_1?.timestamp ? Date.parse(mods.carbon_deadline_1.timestamp) : DEADLINE_FALLBACK;
      target = Math.max(0, Math.floor((ts - Date.now()) / YEAR_MS));
    } else {
      const m = mods?.[key];
      if (m && m.initial != null) {
        const rate = typeof m.rate === 'number' ? m.rate : 0;
        const origin = m.timestamp ? Date.parse(m.timestamp) : Date.now();
        target = m.initial + rate * ((Date.now() - origin) / 1000);
      }
    }
    return { el, n: el.querySelector<HTMLElement>('[data-n]')!, dec, thou, target };
  });

  const START = 0.58, END = 0.92, seg = (END - START) / facts.length;
  st = ScrollTrigger.create({
    trigger: track, start: 'top top', end: 'bottom bottom', scrub: true,
    onUpdate: (self) => {
      const p = self.progress;
      facts.forEach((f, i) => {
        const a = START + i * seg, b = a + seg;
        const local = sm(a, b, p);
        f.el.style.opacity = String(Math.sin(Math.PI * local));        // fade in then out
        f.el.style.transform = `translateY(${(0.5 - local) * 70}px)`;  // gentle rise
        f.n.textContent = fmt(f.target * sm(a, a + seg * 0.55, p), f.dec, f.thou); // count up as you enter
      });
    },
  });
}

export function destroyDescentFacts() {
  st?.kill(); st = undefined;
  document.querySelectorAll<HTMLElement>('.dfact').forEach((el) => { el.style.opacity = ''; el.style.transform = ''; });
}
```

- [ ] **Step 2: Wire into `src/layouts/Base.astro`.** Add to the first `<script>` imports (alongside the others):
```ts
      import { initDescentFacts, destroyDescentFacts } from '../scripts/descent-facts';
```
In `initScroll()` add `destroyDescentFacts();` to the destroy-first block and `initDescentFacts();` after `initSeamSnap();`:
```ts
        destroySeamSnap();
        destroyDescentFacts();
        initSmoothScroll();
        initScrollEffects();
        initSectionEffects();
        initSeamSnap();
        initDescentFacts();
        initAboutField();
```
And in `teardownScroll()` add `destroyDescentFacts();` next to `destroySeamSnap();`.

- [ ] **Step 3: Verify the facts surface + count + clear.** Reload. Probe a mid-descent fact and the cleared end:
```bash
node /tmp/cdpshot.mjs "http://localhost:4321/" /tmp/t2a.png 11000 "window.scrollTo(0, document.body.scrollHeight*0.62)"
node /tmp/cdpshot.mjs "http://localhost:4321/" /tmp/t2b.png 11000 "window.scrollTo(0, document.body.scrollHeight*0.99)"
```
Expected: `ERRORS (none)`. `/tmp/t2a.png` (mid-descent) shows ONE big climate fact over the dark water (number + unit + label). `/tmp/t2b.png` (near end) shows the facts cleared (splash/About). Also confirm at least one `.dfact` reaches opacity > 0.5 somewhere in 0.58–0.92 and ~0 by 0.95.

- [ ] **Step 4: Commit.**
```bash
git add src/scripts/descent-facts.ts src/layouts/Base.astro
git commit -m "feat(hero): live Climate Clock facts scrubbed across the descent"
```

---

## Task 3: Degradation + finalize

- [ ] **Step 1: Reduced-motion / mobile no-op.** Confirm: `initDescentFacts` returns before creating the trigger under `!motionOK()` or `<768px`, AND the `.dfacts` CSS is `display:none` at `(max-width:767px), (prefers-reduced-motion: reduce)`. So no facts, no errors, hero normal. Verify the gate exists:
```bash
grep -n "min-width: 768px" src/scripts/descent-facts.ts
grep -n "prefers-reduced-motion" src/components/DescentFacts.astro
```
Expected: both present.

- [ ] **Step 2: Production build green.**
```bash
npm run build
```
Expected: `[build] Complete!`, no errors.

- [ ] **Step 3: Final live scroll-test (desktop, motion).** On `localhost:4321`: through the dark water the 5 facts surface in turn (deadline → $32T → 11.4% → 17.6% → $40.8T), numbers count up, fade through, clear before the splash-bounce into 01. In sync with the engulf; headline never collides.

- [ ] **Step 4: Commit (allow-empty).**
```bash
git commit -am "chore(hero): descent-facts degradation verified" --allow-empty
```

---

## Self-Review

**1. Spec coverage:** Statements overlay (Task 1 ✓); 5 facts in order with fallback values (Task 1 FACTS ✓); live Climate Clock fetch + sessionStorage cache + fallback (Task 2 getModules, mirrors ClimateClock.astro ✓); scrub ScrollTrigger on #hero-track, window 0.58–0.92, sin fade + scrubbed count (Task 2 onUpdate ✓); extend track 250→340vh (Task 1 Step 2 ✓); independent of engulf/seam-snap (separate trigger, never references activeST ✓); desktop+motion gate + RM/mobile no-op (Task 1 CSS + Task 2 gate + Task 3 ✓); deadline computed as years (Task 2 ✓). No gaps.

**2. Placeholder scan:** No TBD/TODO; full code in every step; verification is visual + probe with exact commands. ✓

**3. Type/name consistency:** `initDescentFacts`/`destroyDescentFacts` defined (Task 2 S1) → imported + wired (Task 2 S2). `.dfacts`/`.dfact`/`.dkick`/`.dval`/`.du`/`.dlab`/`.dsrc`/`[data-n]` defined in DescentFacts.astro (Task 1) → queried in descent-facts.ts (Task 2). `data-key`/`data-fb`/`data-dec`/`data-thou` set in markup → read in script. `#hero-track` is the shared trigger (same as engulf, independent ST). `motionOK` from `../utils/motion` (same import the other scripts use). No collisions with engulf/seam-snap names.
