// src/scripts/climate-engine/v2/card-v2.ts — OBOS v2 on-map building card (brainstorm 04 §3–§8). Mounted by mountShellV2 beside bindSolar.
/**
 * THE CARD ON THE MAP. The app still decides WHAT is selected and paints #bcard's text; this file decides WHERE the card stands and what the rest of the screen does
 * while it is there:
 *   · on a map render the app hands over the roof's apex (card-sink.ts) and this solves a position clear of every chrome box (place-card.ts) and writes TRANSFORMS only
 *     (the card, its lead line, the lead's dot) — no layout read per frame: the chrome boxes come from a 250 ms cache and the card's size from observers;
 *   · the right column folds away while a building is selected, and a "Ward readings" pill brings it back (deselecting restores it);
 *   · selecting a building moves focus to the card's heading; Esc (the app's one handler) closes the card and focus goes back to where the reader came from;
 *   · on a phone the same card is a short peek above the sheet (data-peek="1") that grows to the whole card by tap, grip or drag (data-peek="0").
 */
import { cardSink, type CardBox } from '../card-sink.ts';
import { solveCard, leadFor, BRACKET, EDGE, MIN_TOP, type Box, type Side } from './place-card.ts';
import { $, $$, observe, on } from './dom.ts';
import { holdInert } from './inert.ts';
import { PHONE_QUERY } from './phone-v2.ts';
import type { ShellCtx } from './shell-ctx.ts';

const HUD_TTL_MS = 250;
const GRID_PX = 24;
/** a drag this far up on the peek (or down on the grown card) is a decision, not a wobble */
const DRAG_PX = 36;
/** the lead's keep-out for the greenery tag and the ring labels: a few px each side of the hairline */
const LEAD_PAD = 6;

export function bindCard(ctx: ShellCtx): void {
  const { root, cleanup } = ctx;
  const card = $(root, '#bcard'), inner = card && $(card, '.bcard-in');
  if (!card || !inner) return;
  const lead = $(card, '.lead'), dot = $(card, '.lead-dot'), idEl = $(card, '#bcId'), head = $(card, '#bcHead');
  const legend = $(root, '#legend'), pill = $<HTMLButtonElement>(root, '#v2ReadingsPill'), sheet = $(root, '#v2Sheet');
  const grip = $<HTMLButtonElement>(card, '#bcGrip'), expand = $<HTMLButtonElement>(card, '#bcExpand');
  const mq = matchMedia(PHONE_QUERY);

  /* ── what the card must keep clear of: every visible chrome box, read at most every 250 ms (or at once when the layout says it moved) ── */
  let hud: Box[] = [], hudAt = -Infinity;
  const readHud = (force = false): Box[] => {
    const now = performance.now();
    if (!force && now - hudAt < HUD_TTL_MS) return hud;
    hudAt = now;
    hud = $$<HTMLElement>(root, '[data-hud]')
      .filter((e) => e !== card && e.id !== 'v2Toasts' && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[inert]'))
      .map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; })
      .filter((b) => b.r > b.l && b.b > b.t);
    return hud;
  };
  const stale = (): void => { hudAt = -Infinity; };
  const view = { w: root.clientWidth, h: root.clientHeight };
  /* chrome moves on a resize, a section or panel change, and while a transition runs */
  on(cleanup, window, 'resize', () => { stale(); view.w = root.clientWidth; view.h = root.clientHeight; });
  observe(cleanup, root, { attributes: true, attributeFilter: ['data-side-shown', 'data-menu-eff', 'data-section', 'data-menu', 'data-readings', 'data-phone'] }, stale);
  on(cleanup, root, 'transitionend', stale);

  /* ── the card's natural size: measured when its content changes, never per frame ── */
  const size = { w: 320, h: 0 };
  let sizeDirty = true, lastId = '';
  const measure = (): void => {
    sizeDirty = false;
    size.w = card.offsetWidth || size.w;
    size.h = inner.scrollHeight;
  };
  const dirty = (): void => { sizeDirty = true; };
  observe(cleanup, card, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'data-peek'] }, dirty);
  for (const d of $$(card, 'details')) on(cleanup, d, 'toggle', dirty);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(dirty);
    ro.observe(inner);
    cleanup.push(() => ro.disconnect());
  }

  /* ── placement: transforms only ── */
  let side: Side | null = null, placed: CardBox | null = null, leadBox: CardBox | null = null;
  let lastT = '', lastMax = '', lastLead = '', lastDot = '', lastVis = '';
  const write = (el: HTMLElement | null, prop: 'transform', v: string, last: string): string => { if (el && v !== last) el.style[prop] = v; return v; };
  const setVisible = (on_: boolean): void => {
    const v = on_ ? '' : 'hidden';
    if (v !== lastVis) { card.style.visibility = v; lastVis = v; }
  };

  const place = (apex: { readonly x: number; readonly y: number } | null, relief: boolean): void => {
    if (card.hidden) { placed = leadBox = null; return; }
    if (mq.matches) { placed = leadBox = null; return; }   // a phone has no floating card: CSS stands it above the sheet
    if (!apex && relief) { setVisible(false); placed = leadBox = null; return; }   // behind the camera, as in v1
    const id = idEl?.textContent ?? '';
    if (sizeDirty || id !== lastId || size.h === 0) { lastId = id; measure(); }
    const p = solveCard({ apex, canvas: { l: 0, t: 0, r: view.w, b: view.h }, avoid: readHud(), card: size, prev: side });
    side = p.side;
    if (!p.fits) { setVisible(false); placed = leadBox = null; return; }   // no usable spot (audit F2): hidden, never a sliver; a roof off the canvas has no card (F3)
    setVisible(true);
    const max = p.capped ? `${Math.floor(p.height)}px` : '';
    if (max !== lastMax) { inner.style.maxHeight = max; lastMax = max; }
    const h = p.capped ? p.height : size.h;
    lastT = write(card, 'transform', `translate3d(${Math.round(p.left)}px, ${Math.round(p.top)}px, 0)`, lastT);
    const sideAttr = p.side ?? 'dock';
    if (card.dataset.side !== sideAttr) card.dataset.side = sideAttr;
    leadBox = null;
    if (apex && p.side) {
      const l = leadFor(p, apex, size.w);
      const x0 = p.left + Math.min(l.sx, l.ex) - LEAD_PAD, x1 = p.left + Math.max(l.sx, l.ex) + LEAD_PAD, y0 = p.top + Math.min(l.sy, l.ey) - LEAD_PAD, y1 = p.top + Math.max(l.sy, l.ey) + LEAD_PAD;
      leadBox = { left: x0, top: y0, right: x1, bottom: y1, width: x1 - x0, height: y1 - y0 };
      lastLead = write(lead, 'transform', `translate3d(${l.sx.toFixed(1)}px, ${l.sy.toFixed(1)}px, 0) rotate(${l.angle.toFixed(4)}rad) scaleX(${(l.len / 100).toFixed(4)})`, lastLead);
      lastDot = write(dot, 'transform', `translate3d(${l.ex.toFixed(1)}px, ${l.ey.toFixed(1)}px, 0)`, lastDot);
    }
    placed = { left: p.left, top: p.top, right: p.left + size.w, bottom: p.top + h, width: size.w, height: h };
  };

  /* ── where a roof picked from a list should land: the nearest spot to the canvas centre where the brackets are clear and the card finds room ── */
  const target = (cw: number, ch: number, relief: boolean): { x: number; y: number } | null => {
    if (mq.matches) {
      /* a phone: the middle of the ground between the title card and the peek */
      const title = $(root, '#v2Title')?.getBoundingClientRect(), top = (title ? title.bottom : 80) + 12;
      const bottom = (card.hidden ? ch - (sheet ? sheet.offsetHeight : 250) : card.getBoundingClientRect().top) - 12;
      return { x: cw / 2, y: Math.max(top + 30, (top + bottom) / 2) };
    }
    const avoid = readHud(true);
    measure();
    const dock = relief ? null : solveCard({ apex: null, canvas: { l: 0, t: 0, r: cw, b: ch }, avoid, card: size, prev: null });
    const clear = (x: number, y: number): boolean => {
      const b = { l: x - BRACKET / 2, t: y - BRACKET / 2, r: x + BRACKET / 2, b: y + BRACKET / 2 };
      if (b.l < EDGE || b.r > cw - EDGE || b.t < MIN_TOP || b.b > ch - EDGE) return false;
      const near = (o: Box): boolean => b.l < o.r + EDGE && b.r > o.l - EDGE && b.t < o.b + EDGE && b.b > o.t - EDGE;
      if (avoid.some(near)) return false;
      if (dock) return !near({ l: dock.left, t: dock.top, r: dock.left + size.w, b: dock.top + dock.height });
      const beside = solveCard({ apex: { x, y }, canvas: { l: 0, t: 0, r: cw, b: ch }, avoid, card: size, prev: null });
      return beside.fits && beside.side !== null;   // a picked roof gets its card BESIDE it, with a lead: a dock is the fallback, not the target
    };
    const cx = cw / 2, cy = ch / 2, spots: Array<{ x: number; y: number; d: number }> = [];
    for (let y = MIN_TOP; y <= ch - EDGE; y += GRID_PX) for (let x = EDGE; x <= cw - EDGE; x += GRID_PX) spots.push({ x, y, d: Math.hypot(x - cx, y - cy) });
    spots.sort((a, b) => a.d - b.d);
    return spots.find((s) => clear(s.x, s.y)) ?? null;
  };

  cardSink.current = { place, target, box: () => placed, lead: () => leadBox };
  root.dataset.cardSink = '1';
  cleanup.push(() => { if (cardSink.current?.place === place) cardSink.current = null; delete root.dataset.cardSink; });

  /* ── the right column folds while a building is selected; the pill brings it back; deselecting restores it ── */
  let restored = false, releaseInert: (() => void) | null = null;
  const paintColumn = (): void => {
    const open = !card.hidden;
    const folded = open && !restored && !mq.matches;
    if (folded) root.dataset.readings = 'folded'; else delete root.dataset.readings;
    if (pill) { pill.hidden = !folded; pill.setAttribute('aria-expanded', 'false'); }
    if (folded && !releaseInert && legend) releaseInert = holdInert([legend]);
    if (!folded && releaseInert) { releaseInert(); releaseInert = null; }
    stale();
  };
  on(cleanup, pill, 'click', () => {
    restored = true;
    paintColumn();
    if (legend) { legend.tabIndex = -1; legend.focus({ preventScroll: true }); }
  });
  cleanup.push(() => { releaseInert?.(); releaseInert = null; delete root.dataset.readings; });

  /* ── show / hide: the column, the first-run hint, focus ── */
  let wasHidden = card.hidden;
  observe(cleanup, card, { attributes: true, attributeFilter: ['hidden'] }, () => {
    if (card.hidden === wasHidden) return;
    wasHidden = card.hidden;
    if (card.hidden) {
      restored = false; placed = leadBox = null; side = null; lastT = lastLead = lastDot = lastVis = lastMax = '';
      card.style.visibility = ''; card.dataset.peek = '1'; syncPeek();
    } else {
      /* "Click any building for its data" has done its job */
      $<HTMLButtonElement>(root, '#tipX')?.click();
      /* a phone: the readings sheet steps down so the roof and its peek are on the map */
      const handle = $<HTMLButtonElement>(root, '[data-v2-sheet-toggle]');
      if (mq.matches && handle?.getAttribute('aria-expanded') === 'true') handle.click();
      sizeDirty = true;
      head?.focus({ preventScroll: true });
    }
    paintColumn();
  });
  on(cleanup, mq, 'change', () => { paintColumn(); stale(); });
  paintColumn();

  /* ── the phone: a peek above the sheet that grows ── */
  const syncPeek = (): void => {
    const peek = card.dataset.peek !== '0';
    for (const b of [grip, expand]) b?.setAttribute('aria-expanded', String(!peek));
    grip?.setAttribute('aria-label', peek ? 'Show all building details' : 'Show fewer building details');
  };
  const setPeek = (peek: boolean, focus: HTMLElement | null): void => {
    card.dataset.peek = peek ? '1' : '0';
    syncPeek(); dirty();
    focus?.focus({ preventScroll: true });
  };
  on(cleanup, expand, 'click', () => setPeek(false, head));
  let drag: { y: number } | null = null;
  on(cleanup, grip, 'pointerdown', (e) => { drag = { y: (e as PointerEvent).clientY }; grip?.setPointerCapture?.((e as PointerEvent).pointerId); });
  on(cleanup, grip, 'pointerup', (e) => {
    const d = drag; drag = null;
    if (!d) return;
    const dy = (e as PointerEvent).clientY - d.y, peek = card.dataset.peek !== '0';
    if (dy <= -DRAG_PX && peek) setPeek(false, head);
    else if (dy >= DRAG_PX && !peek) setPeek(true, expand);
    else if (Math.abs(dy) < DRAG_PX) setPeek(!peek, peek ? head : expand);
  });
  on(cleanup, grip, 'pointercancel', () => { drag = null; });
  on(cleanup, grip, 'click', (e) => { if ((e as MouseEvent).detail === 0) { const peek = card.dataset.peek !== '0'; setPeek(!peek, peek ? head : expand); } });   // the keyboard's Enter and Space
  /* the sheet's top edge is where the peek stands: CSS reads one custom property, written when the sheet's size changes */
  if (sheet && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => root.style.setProperty('--v2-sheet-h', `${sheet.offsetHeight}px`));
    ro.observe(sheet);
    cleanup.push(() => { ro.disconnect(); root.style.removeProperty('--v2-sheet-h'); });
  }
  /* Esc folds a grown card to its peek first (as it folds the sheet), once a popover, the payback sheet, the brief or the street view has had its press; the next Esc is the app's and closes the card. */
  on(cleanup, window, 'keydown', (e) => {
    const k = e as KeyboardEvent;
    if (k.key !== 'Escape' || k.defaultPrevented || card.hidden || !mq.matches || card.dataset.peek !== '0') return;
    if (root.querySelector('#solPay:not([hidden]), #solBrief:not([hidden]), #svModal:not([hidden])')) return;
    setPeek(true, expand);
    k.preventDefault(); k.stopImmediatePropagation();
  }, { capture: true });
  syncPeek();
}
