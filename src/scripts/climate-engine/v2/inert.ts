// src/scripts/climate-engine/v2/inert.ts — OBOS v2 spec §7.3 (S8): one reference-counted owner of `inert`, so two modals cannot undo each other.
/**
 * A modal layer (the phone drawer, the payback sheet, the installer brief, the street-view viewer, the entry note) makes everything behind it
 * `inert`. The app already does this for the children of `.stage`; what it never reached is the page's own furniture beside the root, the Base
 * skip-link, which Tab still found (B audit C3). This holds those, and counts holds, so a drawer closing never frees what a modal still needs.
 * An element that was already inert (the app's) is never taken over, and so never released by us.
 */
const holds = new Map<Element, number>();
const owned = new Set<Element>();

/** The page's own furniture outside the v2 root: everything in <body> that is not the root, a script, a style, a link or a template. */
export function pageFurniture(root: Element): Element[] {
  return [...document.body.children].filter((c) => c !== root && !/^(SCRIPT|STYLE|TEMPLATE|LINK)$/.test(c.tagName));
}

/** Make `els` inert until the returned release is called (idempotent). */
export function holdInert(els: readonly Element[]): () => void {
  const mine = [...els];
  for (const e of mine) {
    const n = holds.get(e) ?? 0;
    if (n === 0 && !e.hasAttribute('inert')) { e.setAttribute('inert', ''); owned.add(e); }
    holds.set(e, n + 1);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const e of mine) {
      const n = (holds.get(e) ?? 1) - 1;
      if (n > 0) { holds.set(e, n); continue; }
      holds.delete(e);
      if (owned.delete(e)) e.removeAttribute('inert');
    }
  };
}
