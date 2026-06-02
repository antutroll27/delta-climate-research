// src/scripts/scroll-effects.ts
// Declarative scroll-linked effects: parallax, clip-path reveals, draw lines,
// page progress. Driven by data-* attributes; built only when motion is allowed.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// "editorial-noticeable" intensity (see spec §4). CLIP_INSET must stay in sync
// with the 16% literal in global.css's pre-paint rule.
const PARALLAX_SCALE = 2.0;
const CLIP_INSET = 16;
const CLIP_OPACITY = 0.6;

const motionOK = () =>
  window.matchMedia('(prefers-reduced-motion: no-preference)').matches;

export function initScrollEffects() {
  if (!motionOK()) return;

  // PARALLAX — drift vertically across the element's scroll span.
  document.querySelectorAll<HTMLElement>('[data-parallax]').forEach((el) => {
    const factor = parseFloat(el.dataset.parallax || '0') * PARALLAX_SCALE;
    if (!factor) return;
    gsap.fromTo(
      el,
      { yPercent: 0 },
      {
        yPercent: factor * 100,
        ease: 'none',
        scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true },
      }
    );
  });

  // CLIP-PATH wipe-open + slight fade, scrubbed over the entrance.
  document.querySelectorAll<HTMLElement>('[data-clip]').forEach((el) => {
    const radius = getComputedStyle(el).borderTopLeftRadius || '0px';
    gsap.fromTo(
      el,
      { clipPath: `inset(${CLIP_INSET}% round ${radius})`, opacity: CLIP_OPACITY },
      {
        clipPath: `inset(0% round ${radius})`,
        opacity: 1,
        ease: 'none',
        scrollTrigger: { trigger: el, start: 'top 85%', end: 'top 45%', scrub: true },
      }
    );
  });

  // DRAW — hairline overlay scales in left→right.
  document.querySelectorAll<HTMLElement>('[data-draw]').forEach((el) => {
    gsap.fromTo(
      el,
      { scaleX: 0 },
      {
        scaleX: 1,
        ease: 'none',
        scrollTrigger: { trigger: el, start: 'top 95%', end: 'top 60%', scrub: true },
      }
    );
  });

  // PAGE PROGRESS line (single element).
  const progress = document.querySelector<HTMLElement>('[data-progress]');
  if (progress) {
    gsap.fromTo(
      progress,
      { scaleX: 0 },
      {
        scaleX: 1,
        ease: 'none',
        scrollTrigger: {
          trigger: document.documentElement,
          start: 'top top',
          end: 'bottom bottom',
          scrub: true,
        },
      }
    );
  }

  ScrollTrigger.refresh();
}

export function destroyScrollEffects() {
  ScrollTrigger.getAll().forEach((t) => t.kill());
}
