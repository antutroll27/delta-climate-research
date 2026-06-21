# Hero → 01 Splash/Bounce Hand-off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When you cross the engulf seam into 01, throw the page into `#about` with a springy overshoot (Lenis) and spring About's content (kicker → statement → pillars) into place — an awwwards "splash into the section".

**Architecture:** One new self-contained module `src/scripts/seam-snap.ts` (`initSeamSnap`/`destroySeamSnap`) wired into `Base.astro`'s `initScroll`/`teardownScroll`, plus a `getLenis()` export on `smooth-scroll.ts`. The engulf trigger is NEVER touched (unreachable inside a React/matchMedia closure). Build the **spring-only path first** (the safety net), then add the snap.

**Tech Stack:** GSAP 3.13 ScrollTrigger, Lenis 1.3, Astro. Spec: `docs/superpowers/specs/2026-06-20-plunge-handoff-bounce-design.md`.

---

## Preconditions (verification approach)

No unit-test harness for scroll behavior — verify **visually + by probing computed style** via the headless harness `/tmp/cdpshot.mjs` (recreate if `/tmp` wiped). The **critical safety check**: after scrolling to About, its content MUST be visible (not stuck hidden by the spring's start-state). Probe with a preEval that scrolls down and reads opacity. Dev server at `http://localhost:4321/`.

Helper to scroll into About + read the pillar opacity (used in several tasks):
```bash
node /tmp/cdpshot.mjs "http://localhost:4321/" /tmp/h.png 11000 "window.scrollTo(0,document.body.scrollHeight); setTimeout(()=>{window.__op=getComputedStyle(document.querySelector('#about .pillar')).opacity;},4000)"
# then check window.__op is ~1 (visible). The cdpshot PROBE line also prints window state if wired; otherwise screenshot /tmp/h.png and confirm About content shows.
```

---

## Task 1: Plumbing + spring-only entrance (the safety net)

Expose Lenis, suppress the existing pillar IO reveal on About, and ship the spring timeline kicked by a `once:true` trigger when About enters (no snap yet). This alone is the safe fallback.

**Files:**
- Modify: `src/scripts/smooth-scroll.ts` (add `getLenis` export)
- Modify: `src/components/About.astro:40` (drop `data-reveal-group data-stagger="110"` from the pillars `<ul>`)
- Create: `src/scripts/seam-snap.ts`
- Modify: `src/layouts/Base.astro` (import + wire `initSeamSnap`/`destroySeamSnap`)

- [ ] **Step 1: Export `getLenis()`** from `src/scripts/smooth-scroll.ts`. After the `destroySmoothScroll` function add:
```ts
/** The active Lenis instance (or undefined under reduced-motion / before init). For programmatic scrollTo from other modules. */
export function getLenis(): Lenis | undefined { return lenis; }
```

- [ ] **Step 2: Suppress the pillar IO reveal on About.** In `src/components/About.astro` line 40, change:
```astro
    <ul class="pillars" role="list" data-reveal-group data-stagger="110">
```
to:
```astro
    <ul class="pillars" role="list">
```
(The seam-snap spring becomes the sole animator of `.pillar`; the IO no longer adds `.is-inview`. The kicker/statement/pillars' hidden start-state is now owned by `gsap.set` in seam-snap.ts — Step 3.)

- [ ] **Step 3: Create `src/scripts/seam-snap.ts`** with the spring + safety net (snap added in Task 2):
```ts
// src/scripts/seam-snap.ts
// "Splash into 01": springs #about's content into place (and, in Task 2, throws the
// page across the engulf seam with an overshoot). Desktop + motion only; a true
// no-op under reduced-motion / mobile, where the section's native visibility carries.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motionOK } from '../utils/motion';
import { getLenis } from './smooth-scroll';

gsap.registerPlugin(ScrollTrigger);

let triggers: ScrollTrigger[] = [];
let tl: gsap.core.Timeline | undefined;
let played = false;

const HIDDEN = '#about .sec-kicker, #about .statement, #about .pillar';

function buildSpring() {
  gsap.set('#about .sec-kicker', { y: 60, autoAlpha: 0 });
  gsap.set('#about .statement',  { y: 80, autoAlpha: 0 });
  gsap.set('#about .pillar',     { y: 100, autoAlpha: 0 });
  const t = gsap.timeline({ paused: true, defaults: { ease: 'back.out(1.4)' } });   // ~5% overshoot ≈ locked 1.05
  t.to('#about .sec-kicker', { y: 0, autoAlpha: 1, duration: 0.9 })
   .to('#about .statement',  { y: 0, autoAlpha: 1, duration: 1.1 }, '<0.06')
   .to('#about .pillar',     { y: 0, autoAlpha: 1, duration: 1.2, stagger: 0.07 }, '<0.08');
  return t;
}
function springIn() { if (played) return; played = true; tl?.play(0); }

export function initSeamSnap() {
  destroySeamSnap();
  if (!motionOK() || !window.matchMedia('(min-width: 768px)').matches) return; // RM/mobile → native visibility
  const about = document.getElementById('about');
  const track = document.getElementById('hero-track');
  if (!about || !track) return;
  played = false;
  tl = buildSpring();
  // safety net: if you reach About by normal scroll, the content springs exactly once.
  triggers.push(ScrollTrigger.create({ trigger: about, start: 'top 75%', once: true, onEnter: springIn }));
}

export function destroySeamSnap() {
  triggers.forEach((t) => t.kill());
  triggers = [];
  tl?.kill(); tl = undefined;
  played = false;
  gsap.set(HIDDEN, { clearProps: 'all' });   // restore native visibility (RM/teardown/re-init)
}
```

- [ ] **Step 4: Wire into `Base.astro`.** In the first `<script>` (the one with `initScroll`), add to the imports line the two new functions, e.g. change the import that pulls `initSmoothScroll` to also import from seam-snap — add this import alongside the others at the top of that script:
```ts
import { initSeamSnap, destroySeamSnap } from '../scripts/seam-snap';
```
Then in `initScroll()`, add `destroySeamSnap();` to the destroy-first block and `initSeamSnap();` after `initSectionEffects();`:
```ts
      function initScroll() {
        destroyAboutField();
        destroySectionEffects();
        destroyScrollEffects();
        destroySmoothScroll();
        destroySeamSnap();
        initSmoothScroll();
        initScrollEffects();
        initSectionEffects();
        initSeamSnap();
        initAboutField();
      }
```
and in `teardownScroll()` add `destroySeamSnap();`:
```ts
      function teardownScroll() {
        destroyAboutField();
        destroySectionEffects();
        destroyScrollEffects();
        destroySmoothScroll();
        destroySeamSnap();
      }
```

- [ ] **Step 5: Verify the spring plays + About is never stuck hidden.** Reload dev. Run:
```bash
node /tmp/cdpshot.mjs "http://localhost:4321/" /tmp/t1.png 12000 "window.scrollTo(0,document.body.scrollHeight)"
```
Expected: `ERRORS (none)`. Open `/tmp/t1.png` — after scrolling to the bottom, the About content (kicker, "Between the data and the Decision.", the three pillars) is **visible** (the spring fired via the safety net). It must NOT be blank — a blank About means the spring didn't fire and the `gsap.set` left it hidden (regression). Also probe: load, scroll to About, and confirm `getComputedStyle(document.querySelector('#about .pillar')).opacity` settles to ~1.

- [ ] **Step 6: Commit.**
```bash
git add src/scripts/smooth-scroll.ts src/scripts/seam-snap.ts src/components/About.astro src/layouts/Base.astro
git commit -m "feat(hero): spring-in entrance for 01/About (splash hand-off, spring-only)"
```

---

## Task 2: The snap — throw across the seam

Add the overshoot throw that carries you into About at the seam, chaining the spring off its completion.

**Files:**
- Modify: `src/scripts/seam-snap.ts` (add the snap trigger + the overshoot easing)

- [ ] **Step 1: Add the overshoot easing + snap state.** In `src/scripts/seam-snap.ts`, after the `let played = false;` line add:
```ts
let snapFired = false;
// easeOutBack tuned to ~4.5% past target (default 1.70158 ≈ 10% = cartoon); the bounce lives in Lenis, not ScrollTrigger.
const overshoot = (x: number) => { const c1 = 0.45, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
```
and reset it in `initSeamSnap` (set `snapFired = false;` right after `played = false;`) and in `destroySeamSnap` (add `snapFired = false;` next to `played = false;`).

- [ ] **Step 2: Add the seam snap trigger.** In `initSeamSnap`, immediately AFTER the safety-net `triggers.push(...)`, add:
```ts
  // the throw: crossing the seam (downward) eases the page into #about with an overshoot,
  // then chains the content spring. Callbacks only — never touches the engulf scrub.
  triggers.push(ScrollTrigger.create({
    trigger: track, start: 'bottom 92%', end: 'bottom top',
    onEnter: (self) => {
      if (snapFired || self.direction !== 1) return;            // once + forward/down only
      snapFired = true;
      const lenis = getLenis();
      if (!lenis) { springIn(); return; }                       // no Lenis → just spring (shouldn't hit, given gating)
      lenis.scrollTo('#about', { offset: 0, duration: 1.2, easing: overshoot, onComplete: springIn });
      setTimeout(() => { snapFired = false; }, 1500);           // re-arm past the lerp-0.07 tail
    },
    onLeaveBack: () => { snapFired = false; },                  // scroll-up = native scroll, no throw
  }));
```

- [ ] **Step 3: Verify the throw fires once + lands About visible.** Reload. Scroll slowly down through the engulf into the seam (live, on `localhost:4321`). Expected: as the engulf finishes, the page eases (with a slight overshoot) into #about and the content springs in; scrolling back up is plain; no double-fire / no fight with the engulf scrub. Headless safety re-check (the snap may or may not fire under programmatic scroll, but the content must still end visible via the safety net):
```bash
node /tmp/cdpshot.mjs "http://localhost:4321/" /tmp/t2.png 12000 "window.scrollTo(0,document.body.scrollHeight)"
```
Expected: `ERRORS (none)`; `/tmp/t2.png` shows About content visible.

- [ ] **Step 4: Commit.**
```bash
git add src/scripts/seam-snap.ts
git commit -m "feat(hero): overshoot snap into 01 at the engulf seam"
```

---

## Task 3: Degradation + finalize

- [ ] **Step 1: Reduced-motion is a true no-op.** Confirm by code review that under `!motionOK()` `initSeamSnap` returns before any `gsap.set`/trigger, so the content keeps native visibility. Headless emulate:
```bash
node /tmp/cdpshot.mjs "http://localhost:4321/" /tmp/rm.png 9000 "matchMedia('(prefers-reduced-motion: reduce)')" 
```
(If the harness can force RM, do so; otherwise verify by reading the guard.) Expected: with RM, About content is visible without any spring/snap, no console error. Critically: `getLenis()` is never called when there is no Lenis (RM returns early), so no throw.

- [ ] **Step 2: Mobile degrade.** The `(min-width: 768px)` gate means seam-snap never builds on mobile; the section's native visibility carries. Confirm `#about` content is visible at a 390px-wide viewport (no stuck-hidden):
```bash
# render narrow: (cdpshot is 1440 wide; verify via code review that the matchMedia gate returns early on <768px, leaving content visible via clearProps/native)
grep -n "min-width: 768px" src/scripts/seam-snap.ts
```
Expected: the gate is present; on <768px `initSeamSnap` returns early → no `gsap.set` hide → content visible.

- [ ] **Step 3: Production build green.**
```bash
npm run build
```
Expected: `[build] Complete!`, no errors.

- [ ] **Step 4: Final live scroll-test (desktop, motion).** On `localhost:4321`: engulf → seam → overshoot throw into 01 → content springs (kicker → statement → pillars, tasteful bounce) → scroll-up is native → re-scroll re-arms. No jank, no double-scroll, no blank About.

- [ ] **Step 5: Commit (no-op if nothing changed).**
```bash
git add -A src/scripts/seam-snap.ts
git commit -m "chore(hero): seam-snap degradation verified (RM/mobile no-op)" --allow-empty
```

---

## Self-Review

**1. Spec coverage:** snap via callback ScrollTrigger + `lenis.scrollTo` overshoot, guarded once-fire + `direction===1`, re-arm timeout, `onLeaveBack` bail, no `lock`, no ScrollTrigger `snap` (Task 2 ✓); spring `back.out(1.4)` on kicker/statement/pillars, stagger 0.07, settle ~1.2s (Task 1 Step 3 ✓); suppress pillar IO reveal (Task 1 Step 2 ✓); leave masked title untouched (✓ — not targeted); `getLenis()` export + null-check (Task 1 Step 1, Task 2 Step 2 ✓); `motionOK()`+`min-width:768px` gate (Task 1 Step 3 ✓); safety-net `once:true` = spring-only fallback (Task 1 ✓); RM/mobile no-op + content visible (Task 3 ✓); engulf trigger never touched (✓). No gaps.

**2. Placeholder scan:** No TBD/TODO; full code in every step. Verification is visual + computed-style probe (called out in Preconditions) with the critical "About must not be blank" check. ✓

**3. Type/name consistency:** `getLenis` defined (T1 S1) → imported + called (seam-snap.ts, T2). `initSeamSnap`/`destroySeamSnap` defined (T1 S3) → imported + wired (T1 S4). `springIn`/`played`/`buildSpring`/`tl`/`triggers` defined T1; `snapFired`/`overshoot` added T2 and reset in both init/destroy. `HIDDEN` selector matches the three `gsap.set` targets. `#about`, `#hero-track`, `.sec-kicker`, `.statement`, `.pillar` all confirmed present in the live DOM. No collisions.
