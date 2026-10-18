// src/scripts/climate-engine/v2/phone-v2.ts — OBOS v2 spec §3 (phone), §7.3–7.4, decision C11 (S8).
/**
 * THE PHONE. Below the phone query everything left of the map on a desktop (the menu rail and the side panel) lives in ONE drawer, a
 * modal dialog opened by the menu button; everything right of and below the map (the right column, the map stack, the dock and the
 * credits chip) lives in ONE bottom sheet under a real <button> handle. The nodes are MOVED, not cloned, so every id still exists once
 * and the app's own bindings keep working; each leaves a comment where it came from, so leaving the phone band puts it back exactly.
 *
 * The drawer is a real dialog (spec §7.3): focus moves to its heading, Tab is trapped, everything outside it is `inert` (the Base
 * skip-link included: B audit C3), Esc and the scrim close it, and focus returns to the menu button. It rides the shell's ONE Esc stack
 * (`LayerStack`), so Esc closes the topmost layer only.
 */
import { $, $$, observe, on, type Cleanup } from './dom.ts';
import { V2_KEYS } from './ui-flag.ts';
import type { LayerStack } from './shell-ctx.ts';
import { holdInert, pageFurniture } from './inert.ts';

/** spec §3: a narrow window, or a coarse-pointer device that is short (a phone on its side). */
export const PHONE_QUERY = '(max-width: 699px), (pointer: coarse) and (max-height: 560px)';
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const shown = (el: HTMLElement): boolean => el.getClientRects().length > 0;

export function bindPhone(root: HTMLElement, cleanup: Cleanup, layers: LayerStack): void {
  const mq = matchMedia(PHONE_QUERY);
  const drawer = $(root, '#v2Drawer'), scrim = $(root, '[data-v2-scrim]'), menu = $<HTMLButtonElement>(root, '[data-v2-menu]');
  if (!drawer || !menu) return;
  const sheet = $(root, '#v2Sheet'), handle = $<HTMLButtonElement>(root, '[data-v2-sheet-toggle]');
  /* Compare and the brief bind the frame only (mountShellV2): no map, no sheet */
  const frameOnly = root.matches('[data-compare-root], [data-brief-root]');
  const sheetLab = handle?.querySelector<HTMLElement>('.sheet-lab') ?? null;

  /* WHERE EACH MOVED NODE LIVES ON A DESKTOP: a comment marks the spot, so putting it back is exact whatever else moved. */
  const homes = new Map<Element, Comment>();
  const move = (el: Element | null, into: Element): void => {
    if (!el || homes.has(el) || !el.parentNode) return;
    const mark = document.createComment('v2-home');
    el.parentNode.insertBefore(mark, el);
    homes.set(el, mark);
    into.appendChild(el);
  };
  const restore = (): void => {
    for (const [el, mark] of homes) mark.replaceWith(el);
    homes.clear();
  };

  /* ── the drawer ── */
  let releaseInert: (() => void) | null = null;
  /* Everything outside the drawer: the root's other children, and the page's own furniture beside the root (the Base skip-link). */
  const outside = (): Element[] => [...[...root.children].filter((c) => c !== drawer && c !== scrim), ...pageFurniture(root)];
  const closeDrawer = (): void => {
    releaseInert?.(); releaseInert = null;
    if (scrim) scrim.hidden = true;
  };
  const openDrawer = (): void => {
    releaseInert = holdInert(outside());
    if (scrim) scrim.hidden = false;
    layers.open(drawer, menu, closeDrawer);
  };
  on(cleanup, menu, 'click', () => { if (layers.isOpen(drawer)) layers.closeTop(); else openDrawer(); });
  on(cleanup, scrim, 'click', () => { if (layers.isOpen(drawer)) layers.closeTop(); });
  on(cleanup, drawer, 'keydown', (e) => {
    const k = e as KeyboardEvent;
    if (k.key !== 'Tab') return;
    const f = $$<HTMLElement>(drawer, FOCUSABLE).filter(shown);
    if (!f.length) { k.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1], at = document.activeElement;
    if (k.shiftKey && (at === first || at === drawer || at === drawer.querySelector('#v2DrawerH'))) { k.preventDefault(); last.focus(); }
    else if (!k.shiftKey && at === last) { k.preventDefault(); first.focus(); }
  });
  /* belt: focus that lands outside the open drawer (a script, a screen reader's virtual cursor) is brought back to its heading */
  on(cleanup, document, 'focusin', (e) => {
    if (!layers.isOpen(drawer) || drawer.contains(e.target as Node)) return;
    $<HTMLElement>(drawer, '#v2DrawerH')?.focus();
  });
  /* a section chosen in the drawer closes it, so the reader sees the section; its cards are in the sheet, so the sheet opens */
  on(cleanup, drawer, 'click', (e) => {
    const t = e.target as Element;
    if (t.closest('.nav-item[data-section]') && layers.isOpen(drawer)) { layers.closeTop(); setSheet(true); return; }
    /* a roof picked from the Solar list: the drawer steps aside so the reader sees the building (its card opens the sheet) */
    if (t.closest('#solList tr[data-idx]') && layers.isOpen(drawer)) { layers.closeTop(); return; }
    /* the side panel's × is the drawer's × on a phone (bindSections ignores it there: it is not a "hide the panel" preference) */
    if (t.closest('[data-side-close]') && layers.isOpen(drawer)) layers.closeTop();
  });

  /* ── the sheet ── */
  function setSheet(open: boolean): void {
    if (!sheet || !handle) return;
    sheet.dataset.open = String(open);
    handle.setAttribute('aria-expanded', String(open));
    if (sheetLab) sheetLab.textContent = open ? 'Hide the readings' : 'Show the readings';
  }
  if (sheet && handle) {
    on(cleanup, handle, 'click', () => setSheet(sheet.dataset.open !== 'true'));
    /* a building picked on the map (or from the roof list) puts its card at the top of the sheet: the sheet opens to it */
    const bcard = $(root, '#bcard');
    observe(cleanup, bcard, { attributes: true, attributeFilter: ['hidden'] }, () => {
      if (mq.matches && bcard && !bcard.hidden) { setSheet(true); sheet.scrollTop = 0; }
    });
    /* an artefact that will not load is said in the ward card, which is in the sheet: on a phone the sheet opens so the refusal is seen, not folded away */
    observe(cleanup, $(root, '#loadchip'), { attributes: true, attributeFilter: ['class'] }, () => {
      if (mq.matches && $(root, '#loadchip')?.classList.contains('fail')) setSheet(true);
    });
    /* Esc folds an open sheet, once nothing more specific wanted it: the app's Esc (card, payback sheet, brief, street view) and the layer
       stack run first. The state is read in the CAPTURE phase, before they act, so the same press never closes the card and the sheet. */
    let consumed = false;
    on(cleanup, window, 'keydown', (e) => {
      if ((e as KeyboardEvent).key !== 'Escape') return;
      consumed = !!root.querySelector('#bcard:not([hidden]), #solPay:not([hidden]), #solBrief:not([hidden]), #svModal:not([hidden])') || layers.isOpen(drawer);
    }, { capture: true });
    on(cleanup, window, 'keydown', (e) => {
      if ((e as KeyboardEvent).key !== 'Escape' || e.defaultPrevented || consumed || !mq.matches) return;
      if (sheet.dataset.open === 'true' && sheet.contains(document.activeElement)) { setSheet(false); handle.focus(); }
    });
  }

  /* ── entering and leaving the phone band ── */
  let settled = false;
  const apply = (): void => {
    if (mq.matches) {
      root.dataset.phone = '1';
      move($(root, '#v2Rail'), drawer); move($(root, '#v2Side'), drawer);
      /* Compare and the brief have no map to keep the display toolbar beside: it joins the menu. An area that ships no data has no sheet either, but keeps its toolbar. */
      if (frameOnly) move($(root, '.toolbar'), drawer);
      if (sheet) {
        move($(root, '#legend'), sheet); move($(root, '#v2MapStack'), sheet); move($(root, '#v2Dock'), sheet);
        move($(root, '.st-attrib'), $(sheet, '.sheet-head') ?? sheet);
        if (!settled) {
          settled = true;
          /* closed on arrival, once per session (v1: the sidebar sheet settled once); a later page load in the same session opens it */
          let seen = false;
          try { seen = sessionStorage.getItem(V2_KEYS.sheetSettled) === '1'; sessionStorage.setItem(V2_KEYS.sheetSettled, '1'); } catch { /* storage off */ }
          setSheet(seen);
        }
      }
    } else {
      delete root.dataset.phone;
      if (layers.isOpen(drawer)) layers.closeTop();
      restore();
    }
  };
  on(cleanup, mq, 'change', apply);
  apply();
  cleanup.push(() => { closeDrawer(); restore(); delete root.dataset.phone; });
}
