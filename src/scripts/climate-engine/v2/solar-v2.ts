// src/scripts/climate-engine/v2/solar-v2.ts — OBOS v2. Owner: Track B (request b-01: moved out of weather-v2.ts, called beside bindWeather).
/**
 * THE SOLAR AND BRIEF-LINK BINDERS. Two Track-B behaviours that are not weather: the selected roof's row and the payback sheet's scroll
 * (B-S6 audit F6, F1), and the ward brief link (B-S7 audit F1). v2-only, read-only on the app's nodes.
 */
import { $, observe } from './dom.ts';
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

export function bindSolar(ctx: ShellCtx): void {
  bindSolarRows(ctx);
  bindBriefLink(ctx);
}
