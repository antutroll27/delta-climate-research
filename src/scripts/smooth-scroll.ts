// src/scripts/smooth-scroll.ts
// Lenis smooth scroll, wired to drive GSAP's ScrollTrigger off a single ticker.
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

let lenis: Lenis | undefined;
let tickerFn: ((time: number) => void) | undefined;

const motionOK = () =>
  window.matchMedia('(prefers-reduced-motion: no-preference)').matches;

function onAnchorClick(e: MouseEvent) {
  const a = e.currentTarget as HTMLAnchorElement;
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

  lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1, smoothWheel: true });

  // Keep ScrollTrigger in sync with Lenis's smoothed scroll position.
  lenis.on('scroll', ScrollTrigger.update);
  tickerFn = (time: number) => lenis!.raf(time * 1000);
  gsap.ticker.add(tickerFn);
  gsap.ticker.lagSmoothing(0);

  // Smooth same-page anchor navigation (nav links, CTAs).
  document
    .querySelectorAll<HTMLAnchorElement>('a[href^="#"], a[href^="/#"]')
    .forEach((a) => a.addEventListener('click', onAnchorClick));
}

export function destroySmoothScroll() {
  if (tickerFn) {
    gsap.ticker.remove(tickerFn);
    tickerFn = undefined;
  }
  lenis?.destroy();
  lenis = undefined;
}
