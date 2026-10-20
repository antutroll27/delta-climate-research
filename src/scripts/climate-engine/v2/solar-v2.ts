// src/scripts/climate-engine/v2/solar-v2.ts — OBOS v2. Owner: Track B (request b-01: moved out of weather-v2.ts, called beside bindWeather).
/**
 * THE SOLAR AND BRIEF-LINK BINDERS. Two Track-B behaviours that are not weather: the selected roof's row and the payback sheet's scroll
 * (B-S6 audit F6, F1), and the ward brief link (B-S7 audit F1). v2-only, read-only on the app's nodes.
 */
import { $, observe, on } from './dom.ts';
import type { ShellCtx } from './shell-ctx.ts';

const textOf = (id: string): string => document.getElementById(id)?.textContent?.trim() ?? '';

/**
 * THE SELECTED ROOF'S ROW (B-S6 audit F6). The app selects a building from a ranked row but marks no row; the preview inverts the selected one.
 * This watches the card's own id (#bcId, "#3736") and its hidden state and sets aria-selected on the matching #solList row (and false on the rest).
 * v2-only and read-only on the app's nodes: no app edit. It lives in solar-v2.ts (request b-01), called from mountShellV2 beside bindWeather.
 */
function bindSolarRows(ctx: ShellCtx): void {
  const { cleanup } = ctx;
  const sync = (): void => {
    const card = document.getElementById('bcard');
    const id = card && !card.hasAttribute('hidden') ? /^#(\d+)$/.exec(textOf('bcId'))?.[1] ?? null : null;
    for (const tr of document.querySelectorAll<HTMLElement>('#solList tr[data-idx]')) tr.setAttribute('aria-selected', String(id !== null && tr.dataset.idx === id));
  };
  observe(cleanup, document.getElementById('bcId'), { childList: true, characterData: true, subtree: true }, sync);
  observe(cleanup, document.getElementById('bcard'), { attributes: true, attributeFilter: ['hidden'] }, sync);
  observe(cleanup, document.getElementById('solList'), { childList: true }, sync);
  sync();
  /* THE SHEET OPENS AT ITS TOP (B-S6 audit F1). The app focuses #spClose, the last control, the moment it un-hides the sheet, and the browser scrolls a tall sheet
     to it. Focus stays on Close (reachable in the sticky button row, keyboard behaviour unchanged); only the scroll offset is put back, after the app's own call has run. */
  const sheet = document.getElementById('solPay');
  observe(cleanup, sheet, { attributes: true, attributeFilter: ['hidden'] }, () => { if (sheet && !sheet.hasAttribute('hidden')) sheet.scrollTop = 0; });
}

/**
 * THE WARD BRIEF LINK (B-S7 audit F1). A bare /heat-map/brief/ opens the default Kolkata pair. The app already writes the right query (the ward, the toolbox
 * and the phase) on the rail's Compare link and updates it on every switch and slider change, so this mirrors that href with /brief/ for /compare/.
 */
function bindBriefLink(ctx: ShellCtx): void {
  const { root, cleanup } = ctx;
  const cmp = document.querySelector<HTMLAnchorElement>('a[data-rail="analysis"]');
  const sync = (): void => {
    const b = $<HTMLAnchorElement>(root, '[data-v2-brief]');
    const href = cmp?.getAttribute('href');
    if (b && href) b.setAttribute('href', href.replace('/heat-map/compare/', '/heat-map/brief/'));
  };
  observe(cleanup, cmp, { attributes: true, attributeFilter: ['href'] }, sync);
  sync();
}

/**
 * FOCUS RETURNS TO THE OPENER (FINAL audit F4, WCAG 2.4.3). The building card is a dialog (role="dialog"); v1's app hides it on Esc and leaves focus on a control that has just
 * disappeared, so it falls to <body>. v2 remembers the control the reader last used to ask for a building (a roof row, a ward chip, a landmark label) and, when the card hides
 * while focus is on <body> or inside the card, puts focus back there. A card opened with the pointer on the map has no such control: the pointer press clears the memory, so focus is
 * never dragged to a row the reader left long ago. v2-only and read-only on the app's nodes.
 */
const OPENERS = '#solList tr[data-idx], #strip .ward, #lmlabs button';
function bindCardFocusReturn(ctx: ShellCtx): void {
  const { cleanup } = ctx;
  const card = document.getElementById('bcard');
  if (!card) return;
  let last: HTMLElement | null = null;
  let lastRow: string | null = null;   /* a row's data-idx: the list is rebuilt, so the element itself may be gone by the time the card closes */
  const remember = (t: EventTarget | null): void => {
    const el = t instanceof Element ? t.closest<HTMLElement>(OPENERS) : null;
    if (el) { last = el; lastRow = el.matches('#solList tr[data-idx]') ? el.dataset.idx ?? null : null; }
    else if (!(t instanceof Node && card.contains(t))) { last = null; lastRow = null; }
  };
  on(cleanup, document, 'focusin', (e) => remember(e.target));
  on(cleanup, document, 'pointerdown', (e) => remember(e.target), { capture: true });
  const shown = (el: HTMLElement): boolean => el.isConnected && el.getClientRects().length > 0;
  observe(cleanup, card, { attributes: true, attributeFilter: ['hidden'] }, () => {
    if (!card.hasAttribute('hidden')) return;
    const at = document.activeElement;
    if (at && at !== document.body && !card.contains(at)) return;   /* focus is somewhere the reader put it: leave it */
    const target = last && shown(last) ? last : lastRow !== null ? document.querySelector<HTMLElement>(`#solList tr[data-idx="${CSS.escape(lastRow)}"]`) : null;
    if (target && shown(target)) { target.focus({ preventScroll: true }); return; }
    /* a card opened with the pointer on the map has no opener: focus goes to the map itself, never to <body> (brainstorm 04 §7) */
    document.querySelector<HTMLElement>('#mlmap canvas')?.focus({ preventScroll: true });
  });
}

export function bindSolar(ctx: ShellCtx): void {
  bindCardFocusReturn(ctx);
  bindSolarRows(ctx);
  bindBriefLink(ctx);
}
