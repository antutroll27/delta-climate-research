// src/scripts/cbam-ui/good-sheet.ts
// The good sheet (spec §5.1 step 1, §6.5): search the goods the pack prices by CN code or by the
// Commission's own description, narrow by CBAM sector, pick one. Writes #cbCn and dispatches
// `input` then `change` (cbam-app.ts prices on `change`). A modal dialog: labelled, Esc and the
// scrim close it, the page behind is inert, focus returns to the trigger.
import { sectorForCn } from '../cbam-algos/cbam/sector.ts';
import { esc } from './format.ts';

export interface Good { code: string; description: string }

/** Spec §5.1's five chips. No Electricity: measured, 0 of 572 goods are electricity. */
export const SECTOR_CHIPS = [
  { key: 'iron_and_steel', label: 'Iron & steel' },
  { key: 'aluminium', label: 'Aluminium' },
  { key: 'cement', label: 'Cement' },
  { key: 'fertilisers', label: 'Fertilisers' },
  { key: 'hydrogen', label: 'Hydrogen' },
] as const;
export type SectorKey = (typeof SECTOR_CHIPS)[number]['key'];

/** Rendering 572 buttons on every keystroke is wasteful; the count says how many more there are. */
export const RESULT_LIMIT = 50;

/** A number searches codes by prefix (spaces and dots dropped); words must all occur in the description. */
export function searchGoods(goods: readonly Good[], query: string, sector: SectorKey | null): Good[] {
  const pool = sector ? goods.filter((g) => sectorForCn(g.code) === sector) : [...goods];
  const q = query.trim().toLowerCase();
  if (!q) return pool;
  const digits = q.replace(/[\s.]/g, '');
  if (/^\d+$/.test(digits)) return pool.filter((g) => g.code.startsWith(digits));
  const words = q.split(/\s+/);
  return pool.filter((g) => {
    const d = g.description.toLowerCase();
    return words.every((w) => d.includes(w));
  });
}

/** The full CN description for a code (spec D5: no invented short names), or '' if unknown. */
export function goodCaption(goods: readonly Good[], code: string): string {
  const c = code.trim();
  return goods.find((g) => g.code === c)?.description ?? '';
}

export function renderSectorChips(active: SectorKey | null): string {
  return SECTOR_CHIPS.map((c) => `<button type="button" class="b-chipbtn" data-sector="${c.key}" `
    + `aria-pressed="${c.key === active}">${esc(c.label)}</button>`).join('');
}

export function renderGoodResults(list: readonly Good[], current: string): string {
  if (!list.length) return '<p class="b-help">No good matches. Try a CN code, or one word of its description.</p>';
  const shown = list.slice(0, RESULT_LIMIT);
  const more = list.length > RESULT_LIMIT
    ? `<p class="b-help">Showing ${RESULT_LIMIT} of ${list.length}. Narrow the search to see the rest.</p>`
    : '';
  return `<ul class="b-reslist">${shown.map((g) => `<li><button type="button" class="b-res${g.code === current ? ' on' : ''}" `
    + `data-code="${esc(g.code)}"><b class="num">${esc(g.code)}</b><span class="b-res-d">${esc(g.description)}</span></button></li>`).join('')}</ul>${more}`;
}

export interface GoodSheetDeps {
  /** #cbx, the app root: its rail, top bar, main and tabs go inert while the sheet is open. */
  root: HTMLElement;
  sheet: HTMLElement;
  scrim: HTMLElement;
  trigger: HTMLButtonElement;
  /** #cbCn. */
  input: HTMLInputElement;
  /** #cbCnName: the picked good's description, or its initial hint when the code is unknown. */
  caption: HTMLElement | null;
  /** cbam-app.ts's ensurePack(), narrowed to the classifications. Memoized there. */
  load: () => Promise<readonly Good[] | null>;
}

const OUTSIDE = '.cbx-rail, .cbx-top, .cbx-main, .cbx-tabs';

export function mountGoodSheet(d: GoodSheetDeps): void {
  const search = d.sheet.querySelector<HTMLInputElement>('[data-good-search]');
  const chips = d.sheet.querySelector<HTMLElement>('[data-good-chips]');
  const results = d.sheet.querySelector<HTMLElement>('[data-good-results]');
  const count = d.sheet.querySelector<HTMLElement>('[data-good-count]');
  if (!search || !chips || !results) return;
  const hint = d.caption?.textContent ?? '';
  let goods: readonly Good[] | null = null;
  let sector: SectorKey | null = null;

  const paint = (): void => {
    if (!goods) { results.innerHTML = '<p class="b-help">Loading the goods list…</p>'; return; }
    const list = searchGoods(goods, search.value, sector);
    results.innerHTML = renderGoodResults(list, d.input.value.trim());
    if (count) count.textContent = `${list.length} ${list.length === 1 ? 'good' : 'goods'}`;
  };
  const ensure = async (): Promise<readonly Good[] | null> => {
    if (!goods) goods = await d.load();
    return goods;
  };
  const caption = async (): Promise<void> => {
    if (!d.caption) return;
    const g = await ensure();
    const text = g ? goodCaption(g, d.input.value) : '';
    d.caption.textContent = text || hint;
    if (text) d.caption.title = text; else d.caption.removeAttribute('title');
  };
  const setInert = (on: boolean): void => {
    d.root.querySelectorAll<HTMLElement>(OUTSIDE).forEach((el) => el.toggleAttribute('inert', on));
  };
  // Escape is heard on the document while the sheet is open: a click on non-focusable sheet chrome
  // (the header, a gap) leaves focus on <body>, where a listener on the sheet itself would never hear it.
  const onEscape = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') { ev.preventDefault(); close(); }
  };
  const open = async (): Promise<void> => {
    document.addEventListener('keydown', onEscape);
    d.scrim.hidden = false;
    d.sheet.hidden = false;
    setInert(true);
    d.trigger.setAttribute('aria-expanded', 'true');
    search.value = '';
    sector = null;
    chips.innerHTML = renderSectorChips(null);
    paint();
    search.focus();
    if (!goods) {
      if (await ensure()) paint();
      else results.innerHTML = '<p class="b-help">The goods list could not be loaded. Type the CN code in the Good field instead.</p>';
    }
  };
  function close(): void {
    if (d.sheet.hidden) return;
    document.removeEventListener('keydown', onEscape);
    d.sheet.hidden = true;
    d.scrim.hidden = true;
    setInert(false);
    d.trigger.setAttribute('aria-expanded', 'false');
    d.trigger.focus();
  }
  const choose = (code: string): void => {
    d.input.value = code;
    d.input.dispatchEvent(new Event('input', { bubbles: true }));
    d.input.dispatchEvent(new Event('change', { bubbles: true }));
    close();
    void caption();
  };

  d.trigger.addEventListener('click', () => { void open(); });
  d.scrim.addEventListener('click', close);
  search.addEventListener('input', paint);
  d.sheet.addEventListener('click', (ev) => {
    const t = ev.target as Element | null;
    if (t?.closest('[data-good-close]')) { close(); return; }
    const chip = t?.closest<HTMLElement>('[data-sector]');
    if (chip) {
      const key = chip.dataset.sector as SectorKey;
      sector = sector === key ? null : key;
      chips.innerHTML = renderSectorChips(sector);
      chips.querySelector<HTMLElement>(`[data-sector="${key}"]`)?.focus();
      paint();
      return;
    }
    const res = t?.closest<HTMLElement>('[data-code]');
    if (res?.dataset.code) choose(res.dataset.code);
  });
  d.sheet.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Tab') return;
    const f = [...d.sheet.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.hasAttribute('disabled'));
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  });
  d.input.addEventListener('change', () => { void caption(); });
}
