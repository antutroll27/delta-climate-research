// src/scripts/climate-engine/v2/shell-v2.ts — OBOS v2 spec §1.7, §3
/**
 * OBOS v2 — THE SHELL. Mounted by the area page only under html[data-ui="v2"],
 * after mountHeatMap. Returns a disposer.
 */
import { bindGlass } from './glass.ts';
import { bindMirrors, bindWardCard } from './heat-v2.ts';
import { bindSunCard } from './sun-card.ts';
import { bindWeather } from './weather-v2.ts';
import { bindSolar } from './solar-v2.ts';
import { bindPhone } from './phone-v2.ts';
import { bindModals } from './modals.ts';
import type { LayerStack, Sections, ShellCtx } from './shell-ctx.ts';

export type { ShellCtx, Sections, LayerStack } from './shell-ctx.ts';
import { $, $$, observe, on, store, type Cleanup } from './dom.ts';
import { onMenuClick, sectionOf, type NavState, type SectionId } from './sections.ts';
import { effectiveMenu, V2_KEYS, type MenuState } from './ui-flag.ts';
import { ICON } from '../../../components/ClimateEngine/v2/icons.ts';


/** aria-pressed mirrors v1's `.on` classes (the app writes the class; the shell tells assistive tech). */
export function bindPressedMirror(ctx: ShellCtx): void {
  const { root, cleanup } = ctx;
  const groups = ['#segPhase', '#segPath', '#modechip', '#tintchip', '#envchip', '#vegchip', '#streetchip', '#strip'];
  const sync = (): void => {
    for (const g of groups) for (const b of $$<HTMLElement>(root, `${g} button, ${g} .ward`)) b.setAttribute('aria-pressed', String(b.classList.contains('on')));
  };
  for (const g of groups) observe(cleanup, $(root, g), { attributes: true, subtree: true, attributeFilter: ['class'] }, sync);
  /* the strip's tiles are divs the app clicks (app:3836): give them the keyboard */
  on(cleanup, $(root, '#strip'), 'keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    const w = (e.target as Element).closest<HTMLElement>('.ward');
    if (w && (k === 'Enter' || k === ' ')) { e.preventDefault(); w.click(); }
  });
  sync();
}

/** Trees and Street tabs proxy the app's own chips; the Layers count is derived from the tree's checkboxes. */
export function bindProxies(ctx: ShellCtx): void {
  const { root, cleanup } = ctx;
  const count = (): void => {
    const all = $$<HTMLInputElement>(root, 'input[data-layer]');
    const el = $(root, '[data-layers-count]');
    if (el) el.textContent = `${all.filter((i) => i.checked).length}/${all.length}`;
  };
  for (const p of $$<HTMLButtonElement>(root, '[data-v2-proxy]')) {
    const [chip, key] = (p.dataset.v2Proxy ?? '').split(':');
    const current = (): string | undefined => $$<HTMLElement>(root, `#${chip} button`).find((b) => b.classList.contains('on'))?.dataset[key];
    const sync = (): void => { p.setAttribute('aria-pressed', String(current() === '1')); count(); };
    on(cleanup, p, 'click', () => { $<HTMLButtonElement>(root, `#${chip} button[data-${key}="${current() === '1' ? '0' : '1'}"]`)?.click(); });
    observe(cleanup, $(root, `#${chip}`), { attributes: true, subtree: true, attributeFilter: ['class'] }, sync);
    sync();
  }
  on(cleanup, root, 'change', (e) => { if ((e.target as Element).matches('input[data-layer]')) count(); });
  count();
}

interface Layer { readonly el: HTMLElement; readonly opener: HTMLElement | null; readonly onClose?: () => void }

/** One Esc stack for every popover (and, in S8, the phone drawer): Esc closes the topmost, returns focus to its opener, and stops there. */
export function bindLayers(ctx: ShellCtx): LayerStack {
  const { root, cleanup } = ctx;
  const stack: Layer[] = [];
  const api: LayerStack = {
    open(el, opener, onClose) {
      if (stack.some((l) => l.el === el)) return;
      el.dataset.open = 'true'; opener?.setAttribute('aria-expanded', 'true');
      stack.push({ el, opener, onClose });
      (el.querySelector<HTMLElement>('[data-autofocus]') ?? el).focus();
    },
    closeTop() {
      const l = stack.pop(); if (!l) return false;
      l.el.dataset.open = 'false'; l.opener?.setAttribute('aria-expanded', 'false'); l.onClose?.(); l.opener?.focus();
      return true;
    },
    isOpen: (el) => stack.some((l) => l.el === el),
  };
  const byName = (n: string | undefined): HTMLElement | null =>
    n === 'layers' ? $(root, '#v2Layers') : n === 'credits' ? $(root, '#v2Credits') : n === 'key' ? $(root, '#v2Key') : null;
  on(cleanup, root, 'click', (e) => {
    const t = e.target as Element;
    const opener = t.closest<HTMLElement>('[data-pop-open]');
    if (opener) {
      const el = byName(opener.dataset.popOpen);
      if (!el) return;
      if (api.isOpen(el)) { while (stack.length && stack[stack.length - 1].el !== el) api.closeTop(); api.closeTop(); }
      else api.open(el, opener);
      return;
    }
    if (t.closest('[data-pop-close]') && stack.length) { api.closeTop(); }
  });
  on(cleanup, document, 'pointerdown', (e) => {
    const top = stack[stack.length - 1];
    if (!top || top.el.dataset.modal === 'true') return;
    const t = e.target as Node;
    if (!top.el.contains(t) && !(top.opener?.contains(t) ?? false)) api.closeTop();
  });
  /* S2 audit F4: Tab (or a click on something else) away from an open popover closes it without moving focus, so a later Esc
     is never spent on a popover the reader has left, and never yanks focus back to its opener. */
  on(cleanup, document, 'focusin', (e) => {
    const top = stack[stack.length - 1];
    const t = e.target as Node;
    if (!top || top.el.dataset.modal === 'true' || top.el.contains(t) || (top.opener?.contains(t) ?? false)) return;
    stack.pop();
    top.el.dataset.open = 'false'; top.opener?.setAttribute('aria-expanded', 'false'); top.onClose?.();
  });
  on(cleanup, window, 'keydown', (e) => {
    if ((e as KeyboardEvent).key !== 'Escape' || !stack.length) return;
    /* an open select inside a layer (the drawer's Location) takes its own Esc first: one press, one thing (select-field.ts:399) */
    if (document.activeElement?.matches('[role="combobox"][aria-expanded="true"]')) return;
    api.closeTop(); e.preventDefault(); e.stopImmediatePropagation();
  }, { capture: true });
  return api;
}

/** Short confirmations ("Facing north", "Re-reading…") and the street-imagery credit, which shows only while the street layer is on. */
export function bindFlash(ctx: ShellCtx): void {
  const { root, cleanup } = ctx;
  const f = $(root, '[data-v2-flash]');
  let t = 0;
  const flash = (msg: string, ms = 1800): void => {
    if (!f) return;
    f.textContent = msg; f.dataset.on = 'true'; clearTimeout(t);
    t = window.setTimeout(() => { f.dataset.on = 'false'; }, ms);
  };
  on(cleanup, $(root, '#compass'), 'click', () => flash('Facing north'));
  on(cleanup, $(root, '#clockAge'), 'click', () => flash('Re-reading the live reading…'));
  cleanup.push(() => clearTimeout(t));
  /* spec §6: when an artefact will not load, the ward card says so (#loadchip.fail), and the flash repeats it ONCE, so it is announced (role=status)
     and seen even where the card is folded away (a phone's closed sheet). */
  const chip = $(root, '#loadchip');
  let said = '';
  observe(cleanup, chip, { attributes: true, attributeFilter: ['class'], childList: true, characterData: true, subtree: true }, () => {
    if (!chip?.classList.contains('fail')) { said = ''; return; }
    const msg = chip.textContent?.trim() ?? '';
    if (msg && msg !== said) { said = msg; flash(msg, 4200); }
  });
  const credit = $(root, '[data-v2-street-credit]');
  const street = (): void => { if (credit) credit.hidden = !document.querySelector('#streetchip button[data-s="1"].on'); };
  observe(cleanup, $(root, '#streetchip'), { attributes: true, subtree: true, attributeFilter: ['class'] }, street);
  street();
  /* S2 audit F1: MapLibre's own attribution control is hidden, so its text is mirrored here, links and all. The app REBUILDS the
     control in setMapCredit (the open area's boundary credit), which is why the whole #mlmap subtree is observed. Today it carries the
     DataMeet licence link and OpenFreeMap's OpenMapTiles line; any later source credit shows up with no edit. */
  const mirror = $(root, '[data-v2-map-attrib]');
  const copy = (): void => {
    if (!mirror) return;
    const src = document.querySelector('.maplibregl-ctrl-attrib-inner');
    mirror.replaceChildren(...(src ? [...src.childNodes].map((n) => n.cloneNode(true)) : []));
    mirror.hidden = !src?.textContent?.trim();
  };
  observe(cleanup, $(root, '#mlmap'), { childList: true, subtree: true, characterData: true }, copy);
  copy();
}

/** Resolve once the instrument has picked its engine (the map and its handlers are up). */
function whenInstrumentReady(ctx: ShellCtx, fn: () => void): void {
  const be = document.getElementById('simBackend');
  if (!be) return;
  const ready = (): boolean => !/SELECTING ENGINE/.test(be.textContent ?? '');
  if (ready()) { fn(); return; }
  const mo = new MutationObserver(() => { if (ready()) { mo.disconnect(); fn(); } });
  mo.observe(be, { childList: true, characterData: true, subtree: true });
  ctx.cleanup.push(() => mo.disconnect());
}

/** Theme and Card style (spec §2.7, §3.5). The theme is CSS-only; the map look follows it until the reader chooses one (D1). */
export function bindPrefs(ctx: ShellCtx): void {
  const { root, cleanup } = ctx;
  const sync = (): void => {
    for (const b of $$<HTMLButtonElement>(root, '[data-pref]')) {
      const k = b.dataset.pref === 'theme' ? root.dataset.theme : root.dataset.cards;
      b.setAttribute('aria-pressed', String(k === b.dataset.v));
    }
  };
  let programmatic = false;
  const lookChosen = (): boolean => store.get(V2_KEYS.lookChosen) === '1';
  const pairLook = (theme: string): void => {
    const btn = $<HTMLButtonElement>(root, `#envchip button[data-e="${theme === 'light' ? 'studio' : 'dark'}"]`);
    if (!btn || btn.classList.contains('on')) return;
    programmatic = true; btn.click(); programmatic = false;
  };
  on(cleanup, root, 'click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-pref]');
    if (!b?.dataset.v) return;
    if (b.dataset.pref === 'theme') {
      root.dataset.theme = b.dataset.v; store.set(V2_KEYS.theme, b.dataset.v);
      if (!lookChosen()) pairLook(b.dataset.v);
    } else {
      root.dataset.cards = b.dataset.v; store.set(V2_KEYS.cards, b.dataset.v); ctx.glassRefresh();
    }
    sync();
  });
  /* capture: this runs before the app's own #envchip handler and never stops it */
  on(cleanup, document.getElementById('envchip'), 'click', () => { if (!programmatic) store.set(V2_KEYS.lookChosen, '1'); }, { capture: true });
  if (root.dataset.theme === 'light' && !lookChosen()) whenInstrumentReady(ctx, () => pairLook('light'));
  sync();
}

/** The title card holds a block per sibling area; the one matching the stage's data-area shows (spec §1.6, C7). */
export function bindPerArea(ctx: ShellCtx): void {
  const { root, cleanup } = ctx;
  const sync = (): void => { const a = root.dataset.area; for (const el of $$<HTMLElement | SVGElement>(root, '[data-v2-for]')) el.toggleAttribute('hidden', el.dataset.v2For !== a); };   // a-01: an SVG has no .hidden property
  const mo = new MutationObserver(sync);
  mo.observe(root, { attributes: true, attributeFilter: ['data-area'] });
  cleanup.push(() => mo.disconnect());
  sync();
}

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
      /* On a phone the side panel lives in the drawer, which the section pick closes: choosing a section never toggles (or stores) the
         desktop "side panel hidden" preference there (S8). */
      nav = root.dataset.phone === '1' ? { section: item.dataset.section as SectionId, sideOpen: nav.sideOpen } : onMenuClick(nav, item.dataset.section as SectionId);
      if (root.dataset.phone !== '1') store.set(V2_KEYS.side, nav.sideOpen ? 'open' : 'closed');
      paint(); return;
    }
    if (t.closest('[data-menu-pin]')) {
      const next: MenuState = root.dataset.menu === 'icons' ? 'labels' : 'icons';
      root.dataset.menu = next; store.set(V2_KEYS.menu, next); paint(); return;
    }
    if (t.closest('[data-side-close]')) {
      if (root.dataset.phone === '1') return;   // the drawer's own × (phone-v2.ts): a phone has no "hide the panel" preference
      nav = { ...nav, sideOpen: false }; store.set(V2_KEYS.side, 'closed'); paint(); return;
    }
    const goEl = t.closest<HTMLElement>('[data-go-section]');
    if (goEl?.dataset.goSection) go(goEl.dataset.goSection as SectionId);
  });
  on(cleanup, window, 'resize', paint);
  paint();
  return { go, paint };
}

export function mountShellV2(): (() => void) | null {
  const root = document.querySelector<HTMLElement>('main.obos-v2');
  /* ONE BINDING PER ROOT. Under the ClientRouter every page script's astro:page-load listener outlives its page, so the area
     page's boot (and Compare's, on the brief) also reaches a later v2 root; a second binding makes every toggle fire twice
     (dead menu pin, a second model worker on the brief). The mark is the root's own, so it dies with the swapped-out document. */
  if (!root || root.dataset.v2Bound === '1') return null;
  root.dataset.v2Bound = '1';
  const cleanup: Cleanup = [];
  let disposed = false;
  const dispose = (): void => { for (const off of cleanup.splice(0)) off(); delete root.dataset.v2Bound; };
  const ctx: ShellCtx = { root, cleanup, glassRefresh: () => {} };
  /* Compare and its paired brief bind only the frame (plan S9.2 Step 4; c-02 gave the brief its own marker, [data-brief-root]). */
  const compare = root.matches('[data-compare-root], [data-brief-root]');
  ctx.sections = bindSections(ctx);
  bindPrefs(ctx);
  if (!compare) { bindPerArea(ctx); bindPressedMirror(ctx); bindProxies(ctx); }
  ctx.layers = bindLayers(ctx);
  bindPhone(root, cleanup, ctx.layers);          // S8
  if (!compare) {
    bindFlash(ctx);
    bindModals(root, cleanup);                   // S8: focus stays inside the app's modals (B audit C3)
    bindMirrors(ctx);                            // Track A, S3.2 (heat-v2.ts)
    bindSunCard(root, cleanup);                  // Track A, S4.1 (sun-card.ts)
    bindWardCard(ctx);                           // Track A, S4.2 (heat-v2.ts)
    bindWeather(ctx);                            // Track B, S7.2 (weather-v2.ts)
    bindSolar(ctx);                              // Track B (solar-v2.ts)
  }
  /* bindGlass is async: if the page was left before it resolved, undo what it registered. */
  void bindGlass(root, cleanup).then((g) => { ctx.glassRefresh = g.refresh; if (disposed) dispose(); });
  return () => { disposed = true; dispose(); };
}
