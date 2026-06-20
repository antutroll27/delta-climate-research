// src/scripts/smooth-scroll.ts
// Lenis smooth scroll, wired to drive GSAP's ScrollTrigger off a single ticker.
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motionOK } from '../utils/motion';

let lenis: Lenis | undefined;
let tickerFn: ((time: number) => void) | undefined;

// Delegated handler: one listener on document, so teardown is symmetric and it
// survives any DOM swap that preserves the listener owner. Matches same-page
// anchors (#id, /#id) and lets everything else fall through to native nav.
function onAnchorClick(e: MouseEvent) {
  const a = (e.target as HTMLElement)?.closest<HTMLAnchorElement>('a[href^="#"], a[href^="/#"]');
  if (!a) return;
  const hash = a.getAttribute('href')!.split('#')[1];
  const target = hash ? document.getElementById(hash) : null;
  if (target && lenis) {
    e.preventDefault();
    lenis.scrollTo(target, { offset: -80, duration: 1.1 });
  }
}

export function initSmoothScroll() {
  // Respect reduced motion: leave native scroll entirely alone.
  if (!motionOK()) return;
  destroySmoothScroll(); // idempotent re-init

  // lerp 0.07 — heavier/floatier glide so scrubbed choreography (statement
  // blur reveal, projects pin) eases instead of stepping (preview-approved).
  lenis = new Lenis({ lerp: 0.07, wheelMultiplier: 1, smoothWheel: true });

  // Keep ScrollTrigger in sync with Lenis's smoothed scroll position.
  lenis.on('scroll', ScrollTrigger.update);
  tickerFn = (time: number) => lenis!.raf(time * 1000);
  gsap.ticker.add(tickerFn);
  gsap.ticker.lagSmoothing(0);

  // Smooth same-page anchor navigation (nav links, CTAs) — one delegated listener.
  document.addEventListener('click', onAnchorClick);
}

export function destroySmoothScroll() {
  if (tickerFn) {
    gsap.ticker.remove(tickerFn);
    tickerFn = undefined;
  }
  document.removeEventListener('click', onAnchorClick);
  lenis?.destroy();
  lenis = undefined;
}

/** The active Lenis instance (or undefined under reduced-motion / before init). For programmatic scrollTo from other modules. */
export function getLenis(): Lenis | undefined { return lenis; }
