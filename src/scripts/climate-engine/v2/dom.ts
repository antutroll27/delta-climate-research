// src/scripts/climate-engine/v2/dom.ts — OBOS v2 shared DOM helpers (spec §1.8)
export type Cleanup = Array<() => void>;

export function on(cleanup: Cleanup, node: EventTarget | null, ev: string,
  fn: (e: Event) => void, opts?: AddEventListenerOptions): void {
  if (!node) return;
  node.addEventListener(ev, fn, opts);
  cleanup.push(() => node.removeEventListener(ev, fn, opts));
}

export function observe(cleanup: Cleanup, node: Node | null, opts: MutationObserverInit, fn: () => void): void {
  if (!node) return;
  const mo = new MutationObserver(fn);
  mo.observe(node, opts);
  cleanup.push(() => mo.disconnect());
}

/** Every storage access is wrapped: a blocked store throws on access (layout-state.ts:83–92). */
export const store = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* storage off */ } },
};

export const $ = <T extends Element = HTMLElement>(root: ParentNode, sel: string): T | null => root.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(root: ParentNode, sel: string): T[] => [...root.querySelectorAll<T>(sel)];
