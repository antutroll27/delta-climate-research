// src/scripts/climate-engine/v2/shell-v2.ts — OBOS v2 spec §1.7, §3
/**
 * OBOS v2 — THE SHELL. Mounted by the area page only under html[data-ui="v2"],
 * after mountHeatMap. Returns a disposer.
 */
import { bindGlass } from './glass.ts';
import { $, $$, on, store, type Cleanup } from './dom.ts';
import { onMenuClick, sectionOf, type NavState, type SectionId } from './sections.ts';
import { effectiveMenu, V2_KEYS, type MenuState } from './ui-flag.ts';
import { ICON } from '../../../components/ClimateEngine/v2/icons.ts';

export interface Sections { readonly go: (id: SectionId, side?: boolean) => void; readonly paint: () => void }
export interface ShellCtx { readonly root: HTMLElement; readonly cleanup: Cleanup; glassRefresh: () => void; sections?: Sections }

/** Sections and the menu (spec §3.1–3.3). The menu's labels/icons state and the side panel are independent. */
export function bindSections(ctx: ShellCtx): Sections {
  const { root, cleanup } = ctx;
  let nav: NavState = { section: sectionOf(root.dataset.section).id, sideOpen: root.dataset.side !== 'closed' };
  const paint = (): void => {
    const s = sectionOf(nav.section);
    const shown = nav.sideOpen && s.side !== null;
    root.dataset.section = s.id;
    root.dataset.side = nav.sideOpen ? 'open' : 'closed';
    root.dataset.sideCurrent = s.side ?? '';
    root.dataset.sideShown = shown ? '1' : '0';
    root.dataset.menuEff = effectiveMenu(root.dataset.menu === 'icons' ? 'icons' : 'labels', window.innerWidth, shown);
    for (const b of $$<HTMLButtonElement>(root, '.nav-item[data-section]')) b.setAttribute('aria-current', String(b.dataset.section === s.id));
    document.documentElement.setAttribute('data-open-pane', s.openPane);
    const pin = $<HTMLButtonElement>(root, '[data-menu-pin]');
    if (pin) {
      const labels = root.dataset.menu !== 'icons';
      pin.setAttribute('aria-pressed', String(labels));
      const svg = pin.querySelector('svg'); if (svg) svg.innerHTML = labels ? ICON.collapse : ICON.expand;
      const lab = pin.querySelector('.nav-label'); if (lab) lab.textContent = labels ? 'Collapse menu' : 'Open menu';
    }
  };
  const go = (id: SectionId, side = true): void => { nav = { section: id, sideOpen: side }; paint(); };
  on(cleanup, root, 'click', (e) => {
    const t = e.target as Element;
    const item = t.closest<HTMLButtonElement>('.nav-item[data-section]');
    if (item && !item.disabled) {
      nav = onMenuClick(nav, item.dataset.section as SectionId);
      store.set(V2_KEYS.side, nav.sideOpen ? 'open' : 'closed');
      paint(); return;
    }
    if (t.closest('[data-menu-pin]')) {
      const next: MenuState = root.dataset.menu === 'icons' ? 'labels' : 'icons';
      root.dataset.menu = next; store.set(V2_KEYS.menu, next); paint(); return;
    }
    if (t.closest('[data-side-close]')) { nav = { ...nav, sideOpen: false }; store.set(V2_KEYS.side, 'closed'); paint(); return; }
    const goEl = t.closest<HTMLElement>('[data-go-section]');
    if (goEl?.dataset.goSection) go(goEl.dataset.goSection as SectionId);
  });
  on(cleanup, window, 'resize', paint);
  paint();
  return { go, paint };
}

export function mountShellV2(): (() => void) | null {
  const root = document.querySelector<HTMLElement>('main.obos-v2');
  if (!root) return null;
  const cleanup: Cleanup = [];
  let disposed = false;
  const dispose = (): void => { for (const off of cleanup.splice(0)) off(); };
  const ctx: ShellCtx = { root, cleanup, glassRefresh: () => {} };
  ctx.sections = bindSections(ctx);
  /* bindGlass is async: if the page was left before it resolved, undo what it registered. */
  void bindGlass(root, cleanup).then((g) => { ctx.glassRefresh = g.refresh; if (disposed) dispose(); });
  return () => { disposed = true; dispose(); };
}
