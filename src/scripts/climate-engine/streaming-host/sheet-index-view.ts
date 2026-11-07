/**
 * sheet-index-view.ts: the DOM for the sheet index (phase P5). One component, two looks:
 *   desktop  a chip ("E4 · Canal Ring") that opens the INDEX PLATE: a popover with the sheet grid and a readout line.
 *   phone    the same chip opens a BOTTOM SHEET (scrim, grip, the grid, and a list grouped by stadsdeel).
 * The look is CSS (src/styles/obos-v2/screens/sheet-index.css, one media query); the markup and behaviour are shared.
 *
 * INTEGRATION (P3b, the wiring; nothing here touches heat-map-app.ts or the renderer):
 *
 *   const ui = mountSheetIndex(hostEl, { onSelect: (code) => run(manager.dispatch(selectEventOf(code, performance.now()))) });
 *   // after every dispatch, and once after `start`:
 *   ui.update(indexStateOf(manager.state()));
 *
 * `onSelect` receives a SHIPPING sheet code only (a skipped or outside cell never reaches it) and is the manager's `select`.
 * `update` is idempotent. Shift + arrow is bound on `document` in the capture phase by default (`shiftArrows`), because the
 * founder wants it anywhere on the page; it stops the event, which also stops MapLibre's own Shift + arrow (rotate 15 deg /
 * pitch 10 deg) from firing. Pass `shiftArrows: false` to bind nothing, or `shiftArrows: el` to scope it to one element.
 *
 * MOTION. Only transform and opacity ever animate (see the CSS). Under prefers-reduced-motion the panel appears and
 * disappears at once, and this file never waits for a transition that will not run.
 *
 * Reads the DOM lazily and holds no module state, so it can be mounted twice (the harness does).
 */
import {
  AMSTERDAM_INDEX_TABLES, activate, announceCurrent, announceLoading, announceMiss, announceRefusal, buildIndexModel, cellLabel, cellReadout,
  formatCount, isArrow, keyAction, selectable, type IndexCell, type IndexModel, type IndexViewState, type KeyAction,
} from '../streaming/sheet-index.ts';

export interface SheetIndexOptions {
  /** The manager's `select`. Called with a shipping sheet code, never with a skipped or outside one. */
  readonly onSelect: (code: string) => void;
  /** Defaults to the committed Amsterdam table. */
  readonly model?: IndexModel;
  /** Default `document`. `false` binds no global Shift + arrow; an element scopes it. */
  readonly shiftArrows?: Document | HTMLElement | false;
  /** The name in the dialog and grid labels. */
  readonly cityName?: string;
}

export interface SheetIndexHandle {
  update(state: IndexViewState): void;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  destroy(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const PHONE_QUERY = '(max-width: 699px), (pointer: coarse) and (max-height: 560px)';   // the query phone.css and phone-v2.ts use
const CLOSE_MS = 260;
let serial = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: Node, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls !== '') n.className = cls;
  if (text !== undefined) n.textContent = text;
  parent?.appendChild(n);
  return n;
}

function chevron(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12'); svg.setAttribute('width', '12'); svg.setAttribute('height', '12'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'si-chev');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', 'M2.5 4.5 6 8l3.5-3.5'); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '1.5');
  p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(p);
  return svg;
}

const isEditable = (t: EventTarget | null): boolean => {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.matches('input, textarea, select, [role="textbox"], [role="combobox"]');
};

export function mountSheetIndex(host: HTMLElement, opts: SheetIndexOptions): SheetIndexHandle {
  const model = opts.model ?? buildIndexModel(AMSTERDAM_INDEX_TABLES);
  const city = opts.cityName ?? 'Amsterdam';
  const uid = `si${++serial}`;
  const mq = window.matchMedia(PHONE_QUERY);
  const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
  const cleanups: Array<() => void> = [];
  const on = <T extends EventTarget>(t: T, type: string, fn: (e: never) => void, o?: AddEventListenerOptions | boolean): void => {
    t.addEventListener(type, fn as EventListener, o);
    cleanups.push(() => t.removeEventListener(type, fn as EventListener, o));
  };

  let state: IndexViewState = { current: null, pending: null };
  let focusCode: string | null = null;      // the roving tabindex
  let open = false;
  let closeTimer: number | undefined;
  let lastCurrent: string | null = null;
  let lastPending: string | null = null;

  // ── markup ──
  const root = el('div', 'si', host);
  root.dataset.open = 'false';
  const chip = el('button', 'si-chip place', root);
  chip.type = 'button';
  chip.setAttribute('aria-haspopup', 'dialog');
  chip.setAttribute('aria-expanded', 'false');
  chip.setAttribute('aria-controls', `${uid}-panel`);
  const chipCode = el('b', 'si-chip-code', chip);
  const chipName = el('span', 'si-chip-name', chip);
  chip.appendChild(chevron());

  const scrim = el('div', 'si-scrim', root);
  scrim.hidden = true;
  const panel = el('div', 'si-panel card', root);
  panel.id = `${uid}-panel`;
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', `${uid}-title`);

  const head = el('div', 'si-head', panel);
  el('span', 'si-grip', head).setAttribute('aria-hidden', 'true');
  const title = el('h2', 'si-title', head, 'Sheet index');
  title.id = `${uid}-title`;
  el('span', 'si-sub', head, `${city} · ${formatCount(model.counts.shipping)} sheets`);
  const closeBtn = el('button', 'si-close', head);
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close sheet index');
  closeBtn.textContent = '×';

  const body = el('div', 'si-body', panel);
  const grid = el('div', 'si-grid', body);
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-label', `${city} map sheets`);
  grid.setAttribute('aria-rowcount', String(model.rowCount));
  grid.setAttribute('aria-colcount', String(model.columns.length));
  grid.style.setProperty('--si-cols', String(model.columns.length));

  const cellEl = new Map<string, HTMLElement>();
  for (let row = 0; row < model.rowCount; row++) {
    const r = el('div', 'si-row', grid);
    r.setAttribute('role', 'row');
    for (let col = 0; col < model.columns.length; col++) {
      const c = model.cells[row * model.columns.length + col]!;
      const d = el('div', `si-cell is-${c.state}`, r);
      d.setAttribute('role', 'gridcell');
      d.dataset.code = c.code;
      if (c.state === 'outside') {
        d.setAttribute('aria-hidden', 'true');
        continue;
      }
      d.tabIndex = -1;
      if (!c.available) d.setAttribute('aria-disabled', 'true');
      el('span', 'si-code', d, c.code);
      if (c.available) el('span', 'si-name', d, c.name);
      cellEl.set(c.code, d);
    }
  }

  const legend = el('ul', 'si-legend', body);
  legend.setAttribute('aria-hidden', 'true');
  for (const [cls, text] of [['is-current', 'Current'], ['is-core', 'Core'], ['is-edge', 'Edge'], ['is-skipped', 'Not available']] as const) {
    const li = el('li', '', legend);
    el('i', `si-key ${cls}`, li);
    li.appendChild(document.createTextNode(text));
  }

  const readout = el('p', 'si-readout', body);
  readout.setAttribute('aria-hidden', 'true');          // the cell's own label is what a screen reader hears
  const roTitle = el('b', 'si-ro-title', readout);
  const roDetail = el('span', 'si-ro-detail', readout);

  // the grouped list: the phone's second way in, and a screen reader's flat one
  const list = el('div', 'si-list', body);
  const itemEl = new Map<string, HTMLButtonElement>();
  for (const g of model.groups) {
    const sec = el('section', 'si-group', list);
    const h = el('h3', 'si-group-h', sec);
    el('span', '', h, g.stadsdeel);
    el('small', '', h, `${g.cells.length} ${g.cells.length === 1 ? 'sheet' : 'sheets'}`);
    const ul = el('ul', 'si-items', sec);
    for (const c of g.cells) {
      const li = el('li', '', ul);
      const b = el('button', `si-item is-${c.state}`, li);
      b.type = 'button';
      b.dataset.code = c.code;
      el('b', 'si-item-code', b, c.code);
      el('span', 'si-item-name', b, c.name);
      el('small', 'si-item-n', b, `${formatCount(c.buildings ?? 0)} buildings`);
      itemEl.set(c.code, b);
    }
  }

  const live = el('p', 'si-live sr-only', root);
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');

  // ── state → DOM ──
  const say = (text: string): void => { live.textContent = text; };

  function setRoving(code: string | null, moveFocus: boolean): void {
    const next = code !== null && cellEl.has(code) ? code : null;
    if (focusCode !== null) cellEl.get(focusCode)?.setAttribute('tabindex', '-1');
    focusCode = next;
    if (next !== null) {
      const d = cellEl.get(next)!;
      d.setAttribute('tabindex', '0');
      if (moveFocus) d.focus();
    }
  }

  function showReadout(c: IndexCell | null): void {
    const cell = c ?? (state.current === null ? null : model.byCode.get(state.current) ?? null);
    if (cell === null) { roTitle.textContent = 'Pick a sheet'; roDetail.textContent = `${formatCount(model.counts.shipping)} sheets ship`; return; }
    const r = cellReadout(cell);
    roTitle.textContent = r.title;
    roDetail.textContent = r.detail;
  }

  function paint(): void {
    const cur = state.current !== null ? model.byCode.get(state.current) ?? null : null;
    const pend = state.pending !== null ? model.byCode.get(state.pending) ?? null : null;
    chipCode.textContent = cur?.code ?? '··';
    chipName.textContent = cur !== null && cur.name !== cur.code ? cur.name : '';
    chip.setAttribute('aria-label', cur === null ? 'Open sheet index' : `Sheet ${cur.code}${cur.name === cur.code ? '' : `, ${cur.name}`}. Open sheet index`);
    root.toggleAttribute('data-pending', pend !== null);
    chip.setAttribute('aria-busy', pend !== null ? 'true' : 'false');
    for (const [code, d] of cellEl) {
      const c = model.byCode.get(code)!;
      const isCur = code === state.current;
      d.classList.toggle('is-current', isCur);
      d.classList.toggle('is-pending', code === state.pending);
      if (c.available) d.setAttribute('aria-selected', isCur ? 'true' : 'false'); else d.removeAttribute('aria-selected');
      if (isCur) d.setAttribute('aria-current', 'location'); else d.removeAttribute('aria-current');
      d.setAttribute('aria-label', cellLabel(c, state.current));
    }
    for (const [code, b] of itemEl) {
      const isCur = code === state.current;
      b.classList.toggle('is-current', isCur);
      b.classList.toggle('is-pending', code === state.pending);
      if (isCur) b.setAttribute('aria-current', 'location'); else b.removeAttribute('aria-current');
      b.setAttribute('aria-label', cellLabel(model.byCode.get(code)!, state.current));
    }
    showReadout(null);
  }

  function update(next: IndexViewState): void {
    state = next;
    paint();
    if (focusCode === null || (!open && state.current !== null)) setRoving(state.current ?? [...cellEl.keys()][0] ?? null, false);
    if (state.pending !== null && state.pending !== lastPending) {
      const c = model.byCode.get(state.pending);
      if (c !== undefined) say(announceLoading(c));
    } else if (state.current !== null && state.current !== lastCurrent && state.pending === null) {
      const c = model.byCode.get(state.current);
      if (c !== undefined) say(announceCurrent(c));
    }
    lastPending = state.pending;
    if (state.pending === null) lastCurrent = state.current;
  }

  // ── open / close ──
  function setOpen(want: boolean, restoreFocus: boolean): void {
    if (want === open) return;
    open = want;
    window.clearTimeout(closeTimer);
    const phone = mq.matches;
    panel.setAttribute('aria-modal', phone ? 'true' : 'false');
    chip.setAttribute('aria-expanded', String(open));
    if (open) {
      panel.hidden = false; scrim.hidden = !phone;
      void panel.offsetWidth;                                  // commit the hidden state so the transition has a start
      root.dataset.open = 'true';
      setRoving(state.current ?? focusCode, true);
    } else {
      root.dataset.open = 'false';
      const finish = (): void => { if (!open) { panel.hidden = true; scrim.hidden = true; } };
      if (rm.matches) finish(); else closeTimer = window.setTimeout(finish, CLOSE_MS);
      if (restoreFocus) chip.focus();
    }
  }

  function emit(code: string): void {
    const cell = selectable(model, code);
    if (cell === null) return;                                  // the gate: nothing that does not ship leaves this file
    if (cell.code === state.current && state.pending === null) { say(announceCurrent(cell)); return; }
    opts.onSelect(cell.code);
  }

  function perform(a: KeyAction, fromGrid: boolean): void {
    switch (a.type) {
      case 'focus': setRoving(a.code, true); showReadout(model.byCode.get(a.code) ?? null); break;
      case 'select':
        emit(a.code);
        if (open) setOpen(false, true);
        else if (fromGrid) setRoving(a.code, false);
        else setRoving(a.code, false);
        break;
      case 'miss': say(announceMiss(a.from, a.arrow)); break;
      case 'refuse': { const c = model.byCode.get(a.code); if (c !== undefined) say(announceRefusal(c)); break; }
      case 'none': break;
    }
  }

  // ── events ──
  on(chip, 'click', () => setOpen(!open, false));
  on(closeBtn, 'click', () => setOpen(false, true));
  on(scrim, 'click', () => setOpen(false, true));

  const codeOf = (t: EventTarget | null): string | null => (t instanceof Element ? t.closest<HTMLElement>('[data-code]')?.dataset.code ?? null : null);

  on(grid, 'click', (e: MouseEvent) => {
    const code = codeOf(e.target);
    if (code === null || !cellEl.has(code)) return;
    setRoving(code, true);
    perform(activate(model, code), true);
  });
  on(grid, 'pointerover', (e: PointerEvent) => {
    const code = codeOf(e.target);
    const c = code === null ? null : model.byCode.get(code) ?? null;
    if (c !== null && c.state !== 'outside') showReadout(c);
  });
  on(grid, 'pointerleave', () => showReadout(focusCode === null ? null : model.byCode.get(focusCode) ?? null));
  on(grid, 'focusin', (e: FocusEvent) => {
    const code = codeOf(e.target);
    if (code !== null && cellEl.has(code)) { if (code !== focusCode) setRoving(code, false); showReadout(model.byCode.get(code) ?? null); }
  });
  on(grid, 'keydown', (e: KeyboardEvent) => {
    const code = codeOf(e.target) ?? focusCode;
    const a = keyAction(model, code, e);
    if (a.type === 'none') return;
    e.preventDefault(); e.stopPropagation();
    perform(a, true);
  });
  on(list, 'click', (e: MouseEvent) => {
    const code = codeOf(e.target);
    if (code !== null) perform(activate(model, code), false);
  });
  on(panel, 'keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false, true); return; }
    if (e.key === 'Tab' && mq.matches) {                        // a phone's sheet is modal: Tab loops inside it
      const f = [...panel.querySelectorAll<HTMLElement>('button, [tabindex="0"]')].filter((n) => !n.closest('[hidden]') && n.offsetParent !== null);
      if (f.length === 0) return;
      const first = f[0]!, last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  on(document, 'pointerdown', (e: PointerEvent) => {            // outside click closes the desktop popover
    if (open && !mq.matches && e.target instanceof Node && !root.contains(e.target)) setOpen(false, false);
  }, true);

  // Shift + arrow, anywhere on the page. From the focused cell when focus is inside the plate, else from the current sheet.
  const shiftTarget = opts.shiftArrows === undefined ? document : opts.shiftArrows;
  if (shiftTarget !== false) {
    on(shiftTarget, 'keydown', (e: KeyboardEvent) => {
      if (!e.shiftKey || !isArrow(e.key) || e.defaultPrevented || isEditable(e.target)) return;
      if (grid.contains(e.target as Node)) return;               // the grid's own handler owns it
      const a = keyAction(model, state.current, e);
      if (a.type !== 'select' && a.type !== 'miss') return;
      e.preventDefault(); e.stopPropagation();                   // also keeps MapLibre's Shift + arrow (rotate, pitch) from firing
      perform(a, false);
    }, true);
  }

  update(state);

  return {
    update,
    open: () => setOpen(true, false),
    close: () => setOpen(false, false),
    get isOpen() { return open; },
    destroy() {
      window.clearTimeout(closeTimer);
      for (const f of cleanups.splice(0)) f();
      root.remove();
    },
  };
}
