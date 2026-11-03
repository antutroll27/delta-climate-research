// The calculator's six views (spec §4.2): which one the hash names, and showing it.
// One route; the view lives in the hash so a link can open a view and reload keeps it.

import { replay, watchStagger } from './motion.ts';

export const VIEWS = ['estimate', 'three-years', 'why', 'list', 'export', 'rules'] as const;
export type View = (typeof VIEWS)[number];

/** Exact match only: '#Estimate' or '#list/' is not a view, and falls back to Estimate. */
export function viewFromHash(hash: string): View {
  const name = hash.startsWith('#') ? hash.slice(1) : '';
  return (VIEWS as readonly string[]).includes(name) ? (name as View) : 'estimate';
}

const RAIL_KEY = 'cbx-rail';

/**
 * Wires the rail, the phone tabs and every [data-goto] button inside `root`. Guarded against
 * double init on the root itself, for the same reason initCbam is (astro:page-load also fires
 * on first paint). Listeners are dropped on the next soft navigation.
 */
export function mountViews(root: HTMLElement): void {
  if (root.dataset.viewsWired) return;
  root.dataset.viewsWired = 'true';
  const ac = new AbortController();
  document.addEventListener('astro:before-swap', () => ac.abort(), { once: true });

  const show = (view: View, focus: boolean, writeHash = true): void => {
    root.querySelectorAll<HTMLElement>('[data-view]').forEach((s) => { s.hidden = s.dataset.view !== view; });
    // Spec §8.3: the entry animation replays on every view entry, the first paint included.
    const entered = root.querySelector<HTMLElement>(`[data-view="${view}"]`);
    if (entered) replay(entered);
    root.querySelectorAll<HTMLElement>('[data-goto]').forEach((b) => {
      if (b.dataset.goto === view && b.closest('.cbx-rail, .cbx-tabs, .cbx-more')) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    // replaceState, not location.hash: switching views must not fill the back button's history.
    // The first paint leaves the URL as it came: a bare link stays bare, so nothing is written
    // until the user actually switches view.
    if (writeHash && location.hash !== `#${view}`) history.replaceState(history.state, '', `#${view}`);
    root.querySelector<HTMLDetailsElement>('.cbx-more')?.removeAttribute('open');
    if (focus) root.querySelector<HTMLElement>(`[data-view="${view}"] h1`)?.focus();
  };

  root.addEventListener('click', (ev) => {
    const b = (ev.target as Element | null)?.closest?.<HTMLElement>('[data-goto]');
    if (b?.dataset.goto) show(viewFromHash(`#${b.dataset.goto}`), true);
  }, { signal: ac.signal });
  window.addEventListener('hashchange', () => show(viewFromHash(location.hash), true), { signal: ac.signal });

  const collapse = root.querySelector<HTMLButtonElement>('[data-collapse]');
  const setRail = (collapsed: boolean): void => {
    root.dataset.rail = collapsed ? 'collapsed' : 'open';
    collapse?.setAttribute('aria-expanded', String(!collapsed));
  };
  try { setRail(localStorage.getItem(RAIL_KEY) === 'collapsed'); } catch { setRail(false); }
  collapse?.addEventListener('click', () => {
    const collapsed = root.dataset.rail !== 'collapsed';
    setRail(collapsed);
    try { localStorage.setItem(RAIL_KEY, collapsed ? 'collapsed' : 'open'); } catch { /* private mode */ }
  }, { signal: ac.signal });

  const main = root.querySelector<HTMLElement>('.cbx-main');
  if (main) ac.signal.addEventListener('abort', watchStagger(main), { once: true });
  show(viewFromHash(location.hash), false, false);
}
