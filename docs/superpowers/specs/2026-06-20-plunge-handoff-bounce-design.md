# Hero → 01 "Splash / Bounce" Hand-off Design

**Status:** Approved feel (live-prototyped in `previews/bounce.html`); research-verified against the live tree. **Date:** 2026-06-20. **Branch:** `feat/river-plunge-phase2` (continues the Plunge work).

## Goal
When the engulf finishes and you cross into 01/About, make it feel like an awwwards "splash into the section": a springy **snap** throws you across the seam, and About's content **springs** into place with a controlled overshoot — instead of a flat scroll-through.

## Locked feel (from the approved preview)
- **Both** — snap-in **and** content spring.
- **Overshoot ≈ 1.05** (a controlled bounce, not a cartoon boing): snap easing `c1≈0.45` (~4.5% past), spring `back.out(1.4)` (~5% past).
- **Settle ≈ 1.2 s**, content **stagger 0.07 s**.

## Architecture
One new, self-contained module — `src/scripts/seam-snap.ts` exporting `initSeamSnap()` / `destroySeamSnap()` — wired into `Base.astro`'s existing `initScroll()` (alongside `initSectionEffects`) and torn down on `astro:before-swap`. Plus a tiny `getLenis()` export added to `smooth-scroll.ts` (the instance is currently module-private). **No change to the engulf trigger** (it's `activeST` inside a React `useEffect`+`matchMedia` closure — unreachable and must not be touched).

The seam is free: `#hero-track` is **CSS-sticky, not a ScrollTrigger pin**, so its bottom edge *is* `#about`'s top — no pin/blank-space risk.

### Gating (build only when it makes sense)
`initSeamSnap()` returns early unless `motionOK()` **and** `matchMedia('(min-width:768px)').matches` — mirroring the engulf's own gate. On reduced-motion there is **no Lenis instance and no seam** (hero collapses to static), and on mobile the engulf never builds — so the snap/spring simply don't exist there; the section's existing native reveal carries those paths. The `getLenis()` null-check is load-bearing (calling `scrollTo` with no Lenis would throw).

### (1) The snap — throw across the seam
A **callback-only** ScrollTrigger (no `scrub`, no ScrollTrigger `snap` — that feedback-loops with Lenis) + a flag-guarded `lenis.scrollTo`:
```js
const overshoot = (t) => { const c1 = 0.45, c3 = c1 + 1; return 1 + c3*Math.pow(t-1,3) + c1*Math.pow(t-1,2); };
let snapFired = false, played = false;
ScrollTrigger.create({
  trigger: '#hero-track', start: 'bottom 92%', end: 'bottom top',
  onEnter: (self) => {
    if (snapFired || self.direction !== 1) return;       // once + forward/down only
    snapFired = true;
    const lenis = getLenis();
    if (!lenis) { springIn(); return; }                  // safety (shouldn't hit, given gating)
    lenis.scrollTo('#about', { offset: 0, duration: 1.2, easing: overshoot, onComplete: springIn });
    setTimeout(() => { snapFired = false; }, 1500);      // re-arm past the lerp tail
  },
  onLeaveBack: () => { snapFired = false; },             // scroll-up = native scroll, no throw
});
```
Coexists with the scrub: callbacks only, never reads/writes `activeST`; the throw is a Lenis tween on the existing single `gsap.ticker`→`lenis.raf` loop, so the engulf just reports position through the existing `lenis.on('scroll', ScrollTrigger.update)` wire. No tug-of-war. **No `lock`** (finger-trap); re-arm via timeout. Fire at `bottom 92%` so the scrub-0.6 + lerp-0.07 tail isn't still settling.

### (2) The spring — content entrance into #about
The real About content is **already owned** by existing animators, so the spring must NOT double-target them:
- Masked title `.sec-title[data-mask] .ln>span` → `power3.out @ 'top 86%'` (section-effects.ts). **Leave untouched.**
- `.statement[data-words]` → per-word scrub-blur. **Animate the `.statement` *wrapper*, never the `.w` spans.**
- `.pillar` (inside the About `[data-reveal-group]`) → Base.astro IntersectionObserver + a 2.1 s CSS transition. **Suppress this reveal on #about's pillars only** (remove them from the reveal-group / strip the IO+`.is-inview` path for the About `<ul>`) so the GSAP spring is the sole animator.

One paused timeline, kicked by the snap's `onComplete` (chained — never its own position trigger, which would re-fire on the lerp wobble):
```js
function buildSpringIn() {
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'back.out(1.4)' } });
  tl.from('#about .sec-kicker', { y: 60, autoAlpha: 0, duration: 0.9 })
    .from('#about .statement',  { y: 80, autoAlpha: 0, duration: 1.1 }, '<0.06')
    .from('#about .pillar',     { y: 100, autoAlpha: 0, duration: 1.2, stagger: 0.07 }, '<0.08');
  return tl;
}
// springIn() = guarded play, so the safety-net trigger + onComplete can't double-fire:
function springIn(){ if (played) return; played = true; tl.play(0); }
```
`back.out(1.4)` keeps it tasteful (house style rejects cartoon flourish — `elastic` reserved for at most one accent, likely not used). The title stays its own `power3.out` reveal; the throw lands the section as both resolve, reading as one beat.

### Safety net (decouples the spring from the snap)
Also create `ScrollTrigger.create({ trigger:'#about', start:'top 75%', once:true, onEnter: springIn })`. If the user reaches #about by normal scroll (snap didn't fire, or fired but they're already past), the spring still plays exactly once (guarded by `played`). This is also the **spring-only fallback**: if the throw ever feels like scroll-jacking on trackpads in QA, drop the snap entirely and keep only this — zero risk, fully RM/mobile-safe, matches the minimal house style.

## Explicitly rejected (verified wrong for this codebase)
- ScrollTrigger built-in `snap` (Lenis feedback loop). `lock:true` (finger-trap). Disabling/`.enable()`-ing the engulf trigger (`activeST` is unreachable + moot under CSS-sticky). Selectors `.kicker`/`.lede`/`#about .ln>span` (don't exist / fight existing owners). Mutating a trigger's `vars` post-create.

## Degradation
- **Reduced-motion:** `initSeamSnap` no-ops entirely (gated). Content is natively CSS-visible. No throw, no spring, no `getLenis` call.
- **Mobile (<768px):** no seam/engulf → snap/spring don't build; native pillar reveal carries.
- **60fps:** spring is transform/opacity only, plays once; the engulf keeps its steady-state scrub during the ~1.2 s flight.

## Verification
- Live scroll on `localhost:4321` (desktop, motion): engulf → at the seam the page throws into #about with the overshoot, content springs (kicker→statement→pillars), no double-fire, no fight with the scrub, scroll-up is plain. Then the safety-net path (scroll slowly without triggering the throw) still springs once.
- Emulate reduced-motion + a <768px viewport → no snap/spring, content visible, no console error.
- `npm run build` green.

## Out of scope
The Phase-2 engulf shader (done); team copy; any change to the engulf trigger.
