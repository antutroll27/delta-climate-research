/**
 * The graphs' page wiring. Loaded on demand by cbam-app.ts the first time a line has an outlook,
 * so a visitor who never calculates anything never downloads it or cbam-graphs.ts.
 *
 * It owns one container, #cbGraphs, and nothing else on the page. Everything it draws comes from
 * cbam-graphs.ts; what lives here is only what needs a DOM: measuring the cards, the year switch,
 * the table toggles, the second price box, and the tooltip.
 *
 * THE VISITOR'S PRICES STAY IN THIS CLOSURE (the second price) and in cbam-app.ts's (the first,
 * which is the strip's own box and is passed in). Neither is stored, exported or sent.
 */
import type { EstimatorInput, EstimatorPack } from './cbam-algos/estimator/estimate-from-pack.ts';
import { parseAssumedPrice, type Outlook } from './cbam-outlook.ts';
import {
  chargedCells, chargedLegend, chargedTip, costParts, graphsModel, originCountries, originRow, originsFrom, originsKey, originsParts, phaseModel,
  renderGraphs, secondNote, secondUsable, type OriginsModel,
  sentenceCharged,
  type GraphsModel, type GraphsRefusal, type GraphsState,
} from './cbam-graphs.ts';

type Widths = Parameters<typeof renderGraphs>[2];
/** How long one slice of the origins computation may run before it yields. */
const ORIGINS_SLICE_MS = 12;
const CARDS = ['steps', 'cascade', 'share', 'markup', 'charged', 'cost', 'phase', 'origins'] as const;

export interface GraphsMount {
  /** Draw the graphs for a line and its outlook, or clear them when there is no outlook. */
  paint(pack: EstimatorPack, line: EstimatorInput, view: Outlook | null, priceText: string): void;
  /** The strip's price box changed: redraw the cost card only. */
  price(priceText: string): void;
  clear(): void;
}

export function mountGraphs(el: HTMLElement): GraphsMount {
  const state: GraphsState = { chargedYear: null, priceText: '', secondText: '', open: {} };
  let model: GraphsModel | GraphsRefusal | null = null;
  let widths: Widths | null = null;
  let paintedAt = 0;

  /** Plot widths from the container, before anything is drawn. Corrected by measuring afterwards. */
  function estimate(): Widths {
    const w = el.clientWidth || 600;
    const pad = w < 420 ? 34 : 44;
    const full = Math.max(220, Math.floor(w - pad));
    const half = w >= 560 ? Math.max(200, Math.floor((w - 14) / 2 - pad)) : full;
    return { steps: full, cascade: full, share: half, markup: half, charged: half, cost: half, phase: full, origins: full };
  }
  function measured(): Widths | null {
    const out: Partial<Widths> = {};
    for (const id of CARDS) {
      const plot = el.querySelector<HTMLElement>(`[data-cg-card="${id}"] [data-cg="plot"]`);
      if (!plot) { out[id] = widths ? widths[id] : 600; continue; }
      out[id] = Math.max(200, Math.floor(plot.clientWidth));
    }
    return out as Widths;
  }

  /**
   * Where the keyboard is, in terms that survive a rebuild: the nth mark, the nth button, or the
   * second price box. The section is redrawn whole whenever the line changes, and a redraw that
   * dropped focus sent a keyboard user back to the top of the page (and hid the tooltip they
   * had just opened). Returns a function that puts focus back on the same control.
   */
  function rememberFocus(): () => void {
    const active = document.activeElement;
    if (!(active instanceof Element) || !el.contains(active)) return () => {};
    for (const selector of ['.cg-m', 'button', 'input', '.cg-tbl']) {
      const all = [...el.querySelectorAll(selector)];
      const index = all.indexOf(active);
      if (index < 0) continue;
      return () => {
        const again = el.querySelectorAll<HTMLElement | SVGElement>(selector)[index];
        if (!again) return;
        again.focus({ preventScroll: true });
        // A redraw during the scroll that brought a focused mark into view can cancel that scroll
        // (WebKit), leaving the mark outside the window: finish the job, without moving otherwise.
        const r = again.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) again.scrollIntoView({ block: 'nearest' });
      };
    }
    return () => {};
  }

  /**
   * THE ORIGINS, COMPUTED LAST AND REMEMBERED. One engine call per origin: about 175 ms in all
   * for the slowest good measured (aluminous cement, 101 origins) on a desktop. So the card is
   * drawn empty with the rest, the computation runs in idle slices of ORIGINS_SLICE_MS each, so no
   * task holds the page for long, and its result is kept per pack object and per WHOLE line
   * (originsKey: every field, the mass included). Every newer line, cached or not, takes a new
   * token, so an older computation still running can never fill the card afterwards.
   */
  let packNow: EstimatorPack | null = null;
  let lineNow: EstimatorInput | null = null;
  let paintedLine = '';
  // Per pack object, then per whole input (originsKey): a new pack starts an empty cache.
  const originsCache = new WeakMap<EstimatorPack, Map<string, OriginsModel | null>>();
  let originsToken = 0;
  function fillOrigins(o: OriginsModel | null): void {
    if (!widths) return;
    const parts = originsParts(o, widths.origins);
    const title = part('origins', 'title'), plot = part('origins', 'plot'), tbl = part('origins', 'table'), cap = part('origins', 'cap');
    if (title) title.innerHTML = parts.title;
    if (plot) plot.innerHTML = parts.plot;
    if (tbl) tbl.innerHTML = parts.table;
    if (cap) cap.textContent = parts.cap;
  }
  function scheduleOrigins(): void {
    if (!packNow || !lineNow || model === null || typeof model === 'string') return;
    const token = ++originsToken, pack = packNow, line = lineNow;
    const key = originsKey(line);
    let cache = originsCache.get(pack);
    if (!cache) { cache = new Map(); originsCache.set(pack, cache); }
    if (cache.has(key)) { fillOrigins(cache.get(key) ?? null); return; }
    // ponytail: cleared wholesale past 50 lines (each mass typed is a line); LRU if that ever bites.
    if (cache.size >= 50) cache.clear();
    const store = cache;
    // ponytail: a time budget per slice, not a fixed count, so a slow device still yields often.
    // One engine call is about 1-2 ms, so a slice stays well under the 50 ms long-task line.
    const countries = originCountries(pack, line);
    const rows: NonNullable<ReturnType<typeof originRow>>[] = [];
    let next = 0;
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    const later = (): void => { if (idle) idle(slice, { timeout: 600 }); else window.setTimeout(slice, 40); };
    function slice(): void {
      if (token !== originsToken) return;
      const until = performance.now() + ORIGINS_SLICE_MS;
      while (next < countries.length && performance.now() < until) {
        const r = originRow(pack, line, countries[next++]);
        if (r) rows.push(r);
      }
      if (next < countries.length) { later(); return; }
      const o = originsFrom(line, rows);
      store.set(key, o);
      fillOrigins(o);
    }
    later();
  }

  function draw(): void {
    if (model === null) { el.innerHTML = ''; widths = null; return; }
    const restoreFocus = rememberFocus();
    widths = estimate();
    const phase = packNow && typeof model !== 'string' ? phaseModel(packNow, model) : undefined;
    el.innerHTML = renderGraphs(model, state, widths, phase);
    const real = measured();
    if (real && CARDS.some((id) => Math.abs(real[id] - widths![id]) > 1)) {
      widths = real;
      el.innerHTML = renderGraphs(model, state, widths, phase);
    }
    paintedAt = el.clientWidth;
    restoreFocus();
    scheduleOrigins();
  }

  const card = (id: string): HTMLElement | null => el.querySelector<HTMLElement>(`[data-cg-card="${id}"]`);
  const part = (id: string, name: string): HTMLElement | null => card(id)?.querySelector<HTMLElement>(`[data-cg="${name}"]`) ?? null;

  /** Refill the cost card's sentence, plot and table. The price boxes are left exactly as they are. */
  function redrawCost(): void {
    if (model === null || typeof model === 'string' || !widths) return;
    const parts = costParts(model, widths.cost, state);
    const title = part('cost', 'title'), plot = part('cost', 'plot'), tbl = part('cost', 'table');
    if (title) title.innerHTML = parts.title;
    if (plot) plot.innerHTML = parts.plot;
    if (tbl) tbl.innerHTML = parts.table;
    // The second box follows the first: usable once the strip's price exists, and saying why not
    // until then. Its own text is left alone, so nothing typed is lost.
    const second = el.querySelector<HTMLInputElement>('#cgSecond'), note = part('cost', 'second-note');
    if (second) second.disabled = !secondUsable(state);
    if (note) note.textContent = secondNote(state);
  }

  /** A year switch on the waffle: change opacity only, then the words around the grid. */
  function showYear(index: number): void {
    if (model === null || typeof model === 'string' || !widths) return;
    state.chargedYear = index;
    const c = card('charged');
    if (!c) return;
    c.querySelectorAll<SVGGElement>('.cg-cell').forEach((cell) => { cell.style.opacity = Number(cell.dataset.year) === index ? '1' : '0'; });
    c.querySelectorAll<HTMLButtonElement>('[data-cg-year]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.cgYear) === index)));
    const title = part('charged', 'title'), legend = part('charged', 'legend');
    if (title) title.innerHTML = sentenceCharged(model, index);
    if (legend) legend.innerHTML = chargedLegend(model, index);
    const m = c.querySelector<SVGGElement>('[data-cg="charged-mark"]');
    const y = model.years[index];
    if (m) {
      m.dataset.charged = String(y.chargedPct === null ? 0 : chargedCells(y.chargedPct)); m.dataset.v = y.chargedPct ?? ''; m.dataset.tip = chargedTip(y);
      m.setAttribute('aria-label', chargedTip(y).replace(/\n/g, '. '));
    }
  }

  el.addEventListener('click', (ev) => {
    const t = ev.target instanceof Element ? ev.target : null;
    const tblBtn = t?.closest<HTMLButtonElement>('.cg-tbl-btn');
    if (tblBtn) {
      const id = tblBtn.closest<HTMLElement>('[data-cg-card]')?.dataset.cgCard;
      if (!id) return;
      state.open[id] = !state.open[id];
      tblBtn.setAttribute('aria-expanded', String(state.open[id]));
      const tbl = part(id, 'table');
      if (tbl) tbl.classList.toggle('cg-closed', !state.open[id]);
      return;
    }
    const yearBtn = t?.closest<HTMLButtonElement>('[data-cg-year]');
    if (yearBtn) showYear(Number(yearBtn.dataset.cgYear));
  });
  // THE BOX SHOWS THE PRICE USED. When the visitor leaves it, a price rounded to the cent is
  // written back, so "0.005" becomes "0.01", the figure every cost on the page was worked out at.
  el.addEventListener('change', (ev) => {
    if (!(ev.target instanceof HTMLInputElement) || ev.target.id !== 'cgSecond') return;
    const used = parseAssumedPrice(ev.target.value);
    if (used !== null && used !== ev.target.value) { ev.target.value = used; state.secondText = used; redrawCost(); }
  });
  el.addEventListener('input', (ev) => {
    if (ev.target instanceof HTMLInputElement && ev.target.id === 'cgSecond') {
      state.secondText = ev.target.value;
      redrawCost();
    }
  });

  /* The tooltip: the exact figure for a mark, on hover and on keyboard focus.
   *
   * IT IS position:fixed, SO IT MUST BE PLACED AFTER THE PAGE HAS FINISHED MOVING. Focusing a mark
   * with the keyboard scrolls it into view, and that scroll lands after the focus event. Placed
   * once, on the event, the tooltip stayed where the mark had been and three of fifteen ended up
   * outside the window. So a focused mark's tooltip is re-placed on every scroll and resize while
   * it is showing, and it is held inside the window on both axes whatever the mark's position. */
  const tipEl = (): HTMLElement | null => el.querySelector<HTMLElement>('[data-cg="tip"]');
  let focused: Element | null = null;
  function showTip(markEl: Element, x: number, y: number): void {
    const tip = tipEl();
    if (!tip || !(markEl instanceof SVGElement)) return;
    tip.textContent = markEl.dataset.tip ?? '';
    tip.classList.add('on');
    const r = tip.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x + 14));
    const above = y - r.height - 14;
    const top = Math.max(8, Math.min(window.innerHeight - r.height - 8, above < 8 ? y + 18 : above));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
  const hideTip = (): void => { tipEl()?.classList.remove('on'); };
  const placeForFocus = (): void => {
    if (!focused || !focused.isConnected) return;
    const r = focused.getBoundingClientRect();
    showTip(focused, r.left + r.width / 2, r.top + 20);
  };
  el.addEventListener('pointermove', (ev) => {
    const m = ev.target instanceof Element ? ev.target.closest('.cg-m') : null;
    if (m) showTip(m, ev.clientX, ev.clientY); else if (!focused) hideTip(); else placeForFocus();
  });
  el.addEventListener('pointerleave', () => { if (focused) placeForFocus(); else hideTip(); });
  el.addEventListener('focusin', (ev) => {
    focused = ev.target instanceof Element ? ev.target.closest('.cg-m') : null;
    // Placed now, then every frame until the mark has stood still for ten frames (at most 1.5 s):
    // WebKit can finish a smooth scroll after the last scroll event, and later than any fixed delay
    // when the page is busy (the origins card computing in timer slices, with no idle callback).
    if (focused) { placeForFocus(); settleTip(); }
  });
  let settleRun = 0;
  function settleTip(): void {
    const run = ++settleRun, end = performance.now() + 1500;
    let last = '', still = 0;
    const tick = (): void => {
      if (run !== settleRun || !focused) return;
      placeForFocus();
      const r = focused.getBoundingClientRect(), at = `${r.left},${r.top}`;
      still = at === last ? still + 1 : 0; last = at;
      if (still < 10 && performance.now() < end) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  el.addEventListener('focusout', () => { focused = null; hideTip(); });
  window.addEventListener('scroll', placeForFocus, { passive: true, capture: true });
  window.addEventListener('resize', placeForFocus, { passive: true });

  // The plots are drawn at the pixel width of their cards, so a change of width redraws them.
  let timer = 0;
  new ResizeObserver(() => {
    if (model === null || Math.abs(el.clientWidth - paintedAt) < 2) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(draw, 150);
  }).observe(el);

  return {
    paint(pack, line, view, priceText) {
      // THE SAME LINE AGAIN (a debounced recalculation after typing the value already there) is
      // not redrawn: replacing every card would move a keyboard user's focus and cancel the
      // scroll bringing it into view. Only the price can differ, and it has its own small redraw.
      // Keyed like the origins: the pack by identity and the WHOLE line, every field.
      const key = originsKey(line);
      if (pack === packNow && key === paintedLine && model !== null) {
        if (priceText !== state.priceText) { state.priceText = priceText; redrawCost(); }
        return;
      }
      paintedLine = key;
      state.priceText = priceText;
      packNow = pack; lineNow = line;
      model = graphsModel(pack, line, view);
      // A new line has its own years; the waffle goes back to the last of them.
      if (model !== null && typeof model !== 'string' && state.chargedYear !== null
        && state.chargedYear >= model.years.length) state.chargedYear = null;
      draw();
    },
    price(priceText) {
      state.priceText = priceText;
      redrawCost();
    },
    clear() { model = null; paintedLine = ''; draw(); },
  };
}
