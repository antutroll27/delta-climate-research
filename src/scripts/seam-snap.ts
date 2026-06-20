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
let snapFired = false;
// easeOutBack tuned to ~4.5% past target (default 1.70158 ≈ 10% = cartoon); the bounce lives in Lenis, not ScrollTrigger.
const overshoot = (x: number) => { const c1 = 0.45, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

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
  snapFired = false;
  tl = buildSpring();
  // safety net: if you reach About by normal scroll, the content springs exactly once.
  triggers.push(ScrollTrigger.create({ trigger: about, start: 'top 75%', once: true, onEnter: springIn }));
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
}

export function destroySeamSnap() {
  triggers.forEach((t) => t.kill());
  triggers = [];
  tl?.kill(); tl = undefined;
  played = false;
  snapFired = false;
  gsap.set(HIDDEN, { clearProps: 'all' });   // restore native visibility (RM/teardown/re-init)
}
