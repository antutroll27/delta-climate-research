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
import type { Outlook } from './cbam-outlook.ts';
import {
  chargedCells, chargedLegend, chargedTip, costParts, graphsModel, renderGraphs, sentenceCharged,
  type GraphsModel, type GraphsRefusal, type GraphsState,
} from './cbam-graphs.ts';

type Widths = Parameters<typeof renderGraphs>[2];
const CARDS = ['steps', 'share', 'markup', 'charged', 'cost'] as const;

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
    return { steps: full, share: half, markup: half, charged: half, cost: half };
  }
  function measured(): Widths | null {
    const out: Partial<Widths> = {};
    for (const id of CARDS) {
      const plot = el.querySelector<HTMLElement>(`[data-cg-card="${id}"] [data-cg="plot"]`);
      if (!plot) return null;
      out[id] = Math.max(200, Math.floor(plot.clientWidth));
    }
    return out as Widths;
  }

  function draw(): void {
    if (model === null) { el.innerHTML = ''; widths = null; return; }
    // Keep the caret if it is in the second price box: the section is rebuilt around it.
    const inSecond = document.activeElement instanceof HTMLElement && document.activeElement.id === 'cgSecond';
    widths = estimate();
    el.innerHTML = renderGraphs(model, state, widths);
    const real = measured();
    if (real && CARDS.some((id) => Math.abs(real[id] - widths![id]) > 1)) {
      widths = real;
      el.innerHTML = renderGraphs(model, state, widths);
    }
    paintedAt = el.clientWidth;
    if (inSecond) el.querySelector<HTMLInputElement>('#cgSecond')?.focus();
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
  el.addEventListener('input', (ev) => {
    if (ev.target instanceof HTMLInputElement && ev.target.id === 'cgSecond') {
      state.secondText = ev.target.value;
      redrawCost();
    }
  });

  /* The tooltip: the exact figure for a mark, on hover and on keyboard focus. */
  const tipEl = (): HTMLElement | null => el.querySelector<HTMLElement>('[data-cg="tip"]');
  function showTip(markEl: Element, x: number, y: number): void {
    const tip = tipEl();
    if (!tip || !(markEl instanceof SVGElement)) return;
    tip.textContent = markEl.dataset.tip ?? '';
    tip.classList.add('on');
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, x + 14))}px`;
    tip.style.top = `${y - r.height - 14 < 8 ? y + 18 : y - r.height - 14}px`;
  }
  const hideTip = (): void => { tipEl()?.classList.remove('on'); };
  el.addEventListener('pointermove', (ev) => {
    const m = ev.target instanceof Element ? ev.target.closest('.cg-m') : null;
    if (m) showTip(m, ev.clientX, ev.clientY); else hideTip();
  });
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('focusin', (ev) => {
    const m = ev.target instanceof Element ? ev.target.closest('.cg-m') : null;
    if (m) { const r = m.getBoundingClientRect(); showTip(m, r.left + r.width / 2, r.top + 20); }
  });
  el.addEventListener('focusout', hideTip);

  // The plots are drawn at the pixel width of their cards, so a change of width redraws them.
  let timer = 0;
  new ResizeObserver(() => {
    if (model === null || Math.abs(el.clientWidth - paintedAt) < 2) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(draw, 150);
  }).observe(el);

  return {
    paint(pack, line, view, priceText) {
      state.priceText = priceText;
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
    clear() { model = null; draw(); },
  };
}
