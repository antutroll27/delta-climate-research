// src/scripts/cbam-ui/motion.ts
// The entry motion's two hooks (spec §8.3). Stagger indices are set on every render, by one
// MutationObserver on the main area, so no renderer has to remember them. The replay runs on
// every view entry. The motion itself is CSS (src/styles/cbam-ill.css); reduced motion is there.

export const ANIM_CLASS = 'b-anim';
/** The groups whose children stagger: the reference's bento.js list, verbatim. */
export const STAGGER_GROUPS = '.b-ill,.b-pict,.b-sg,.b-waffle,.b-fp,.b-d10,.b-strip,.b-phase,.b-mcols,.b-stackbar,.b-split';
/** The entry keyframes in cbam-ill.css. Only these hold the class; hover transitions do not. */
const ENTRY = new Set(['bRise', 'bGrowX', 'bGrowY', 'bPop', 'bNeedle', 'bSlide', 'bLift']);

export function indexStagger(node: Element): void {
  const groups = Array.from(node.querySelectorAll(STAGGER_GROUPS));
  if (node.matches(STAGGER_GROUPS)) groups.unshift(node);
  for (const g of groups) {
    Array.from(g.children).forEach((c, i) => (c as HTMLElement | SVGElement).style.setProperty('--i', String(i)));
  }
}

/** Indexes `main` now and every subtree a render adds to it later. Returns the disconnect. */
export function watchStagger(main: Element): () => void {
  indexStagger(main);
  const mo = new MutationObserver((records) => {
    // A render that rewrites a group adds its children one by one: index each target once per batch.
    const targets = new Set<Element>();
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (n.nodeType !== Node.ELEMENT_NODE) return;
        const parent = (n as Element).parentElement;
        targets.add(parent?.matches(STAGGER_GROUPS) ? parent : (n as Element));
      });
    }
    targets.forEach(indexStagger);
  });
  mo.observe(main, { childList: true, subtree: true });
  return () => mo.disconnect();
}

interface EntryAnimation { readonly playState: string; readonly finished: Promise<unknown>; readonly animationName?: string }
export interface Replayable {
  readonly classList: { add(token: string): void; remove(token: string): void };
  readonly offsetWidth: number;
  getAnimations(options: { subtree: boolean }): readonly EntryAnimation[];
}

const generation = new WeakMap<object, number>();

/**
 * Spec §8.3: remove the class, force a reflow, re-add it, so every entry animation restarts.
 * P5-6: once they have all finished, the class leaves again, so a live re-render (typing a mass)
 * does not replay them. With fill-mode `both` the end state is the un-animated state: no jump.
 */
export function replay(el: Replayable): void {
  const gen = (generation.get(el) ?? 0) + 1;
  generation.set(el, gen);
  el.classList.remove(ANIM_CLASS);
  void el.offsetWidth;
  el.classList.add(ANIM_CLASS);
  settle(el, gen);
}

function settle(el: Replayable, gen: number): void {
  const running = el.getAnimations({ subtree: true })
    .filter((a) => a.animationName !== undefined && ENTRY.has(a.animationName) && a.playState === 'running');
  if (running.length === 0) {
    if (generation.get(el) === gen) el.classList.remove(ANIM_CLASS);
    return;
  }
  void Promise.allSettled(running.map((a) => a.finished)).then(() => {
    if (generation.get(el) === gen) settle(el, gen);
  });
}
