// src/scripts/cbam-ui/inputs-estimate.ts
// The Estimate input column's controls (spec §5.1 steps 2–5, §6.5): route segments and option
// cards mirrored to the hidden native <select>s that cbam-app.ts reads, the verified-only marker,
// the de minimis ruler and the price-period caption. Pure renderers plus one DOM helper.
import Decimal from 'decimal.js';
import { parseRegulatoryDate } from '../cbam-algos/cbam/input.ts';
import { estimateFromPack, type EstimatorPack, type ThresholdView } from '../cbam-algos/estimator/estimate-from-pack.ts';
import { esc, eur, num } from './format.ts';

/** One <option> of a mirrored select, as the mirror reads it. */
export interface RouteOption {
  value: string;
  text: string;
  selected: boolean;
  disabled: boolean;
  /** The option carries data-vo: priceable from verified figures only. */
  verifiedOnly: boolean;
}

export const segmentLabel = (value: string): string => (value === 'default' ? 'Single route' : value);

/**
 * The offered routes the Commission publishes NO direct default value for: on the defaults tier
 * the engine refuses them with NO_DIRECT_DEFAULT, while their benchmark resolves (routesFor only
 * offers routes it can benchmark), so the importer's verified figures price them. Asked of the
 * engine itself, never inferred. The default lookup is keyed on the reporting year alone, so a
 * fixed day in that year and a 1 t mass stand in for the form's.
 */
export function verifiedOnlyRoutes(
  pack: EstimatorPack, cn: string, country: string, year: number, routes: readonly string[],
): Set<string> {
  const out = new Set<string>();
  for (const route of routes) {
    try {
      const e = estimateFromPack(pack, { cn, country, route, massT: '1', date: `${year}-01-01`, emissionsScope: 'direct' });
      if (e.status === 'unavailable' && e.failure.code === 'NO_DIRECT_DEFAULT') out.add(route);
    } catch {
      // A thrown estimate says nothing about the default; leave the route unmarked.
    }
  }
  return out;
}

export function verifiedOnlyNote(labels: readonly string[], origin: string): string {
  if (!labels.length) return '';
  const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `${list} ${labels.length === 1 ? 'prices' : 'price'} from verified figures only: no Commission default from ${origin}.`;
}

/** The radios for a route select. A select with no route to offer shows its reason as text (M3). */
export function renderRouteSegments(opts: readonly RouteOption[]): string {
  const live = opts.filter((o) => o.value !== '' && !o.disabled);
  if (!live.length) {
    const reason = opts[0]?.text ?? '';
    return reason ? `<p class="b-help b-seg-empty">${esc(reason)}</p>` : '';
  }
  const anyChecked = live.some((o) => o.selected);
  return live.map((o, i) => {
    const tab = o.selected || (!anyChecked && i === 0) ? '0' : '-1';
    const name = o.verifiedOnly ? `${o.text}, verified figures only` : o.text;
    return `<button type="button" role="radio" class="${o.selected ? 'on' : ''}${o.verifiedOnly ? ' b-vo' : ''}" `
      + `aria-checked="${o.selected}" tabindex="${tab}" data-value="${esc(o.value)}" aria-label="${esc(name)}">`
      + `${esc(segmentLabel(o.value))}${o.verifiedOnly ? '<i aria-hidden="true"></i>' : ''}</button>`;
  }).join('');
}

/** 0 → twice the threshold, the threshold mark at the middle. Decoration: the card says the verdict. */
export function renderMassRuler(t: ThresholdView | null): string {
  if (!t) return '';
  let fill: string;
  try {
    const thr = new Decimal(t.thresholdT);
    if (!thr.isFinite() || thr.lte(0)) return '';
    fill = Decimal.min(1, new Decimal(t.knownEligibleMassT).div(thr.times(2))).times(100).toFixed(1);
  } catch {
    return '';
  }
  return `<div class="b-thr" style="--fill:${fill}%"><b></b><em></em></div>`
    + `<p class="b-help b-thr-l2"><span>0</span><span>${num(t.thresholdT)} t de minimis · ${t.calendarYear}</span><span>above</span></p>`;
}

/** The quarter strip and the price row for the date's quarter, as the engine will look it up. */
export function renderDatePeriod(prices: readonly { quarter: string; priceEur: string | null }[], date: string): string {
  const p = parseRegulatoryDate(date);
  if (!p.ok) return '';
  const row = prices.find((r) => r.quarter === p.quarter);
  if (!row) return '';
  const q = Number(p.quarter.slice(-1));
  const strip = `<div class="b-qtr" aria-hidden="true">${[1, 2, 3, 4].map((n) => (n === q ? '<i class="on"></i>' : '<i></i>')).join('')}</div>`;
  return `${strip}<p class="b-help">Certificate price · imports in ${esc(p.quarter)}: ${row.priceEur ? eur(row.priceEur) : 'none published'}</p>`;
}

/**
 * Mirror a hidden native <select> into a role="radiogroup" of role="radio" buttons (spec §6.5).
 * The select stays the source of truth: a pick writes select.value and dispatches a bubbling
 * `change`, exactly as a user changing the select would. With `render`, the buttons are rebuilt
 * whenever the options are replaced (cbam-app.ts's syncRoutes assigns innerHTML); without it, the
 * group's static buttons are only re-checked. A `change` never rebuilds, so focus survives arrows.
 */
export function mountRadioMirror(
  select: HTMLSelectElement,
  group: HTMLElement,
  render?: (opts: RouteOption[]) => string,
): void {
  const radios = (): HTMLElement[] => [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
  const read = (): RouteOption[] => [...select.options].map((o) => ({
    value: o.value,
    text: o.text,
    selected: o.selected && o.value !== '',
    disabled: o.disabled,
    verifiedOnly: o.hasAttribute('data-vo'),
  }));
  const syncChecked = (): void => {
    const rs = radios();
    const current = rs.find((r) => r.dataset.value === select.value && select.value !== '') ?? null;
    for (const r of rs) {
      const on = r === current;
      r.setAttribute('aria-checked', String(on));
      r.classList.toggle('on', on);
      r.tabIndex = -1;
    }
    const stop = current ?? rs[0];
    if (stop) stop.tabIndex = 0;
    group.setAttribute('aria-disabled', String(select.disabled));
  };
  const rebuild = (): void => {
    if (render) {
      const hadFocus = group.contains(document.activeElement);
      group.innerHTML = render(read());
      syncChecked();
      if (hadFocus) radios().find((r) => r.tabIndex === 0)?.focus();
    } else {
      syncChecked();
    }
  };
  const pick = (r: HTMLElement): void => {
    const v = r.dataset.value ?? '';
    if (select.disabled || v === select.value) { syncChecked(); return; }
    select.value = v;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  group.addEventListener('click', (ev) => {
    const r = (ev.target as Element | null)?.closest<HTMLElement>('[role="radio"]');
    if (r && group.contains(r)) pick(r);
  });
  group.addEventListener('keydown', (ev) => {
    const rs = radios();
    const i = rs.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    let j = -1;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') j = (i + 1) % rs.length;
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') j = (i - 1 + rs.length) % rs.length;
    else if (ev.key === 'Home') j = 0;
    else if (ev.key === 'End') j = rs.length - 1;
    else if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); pick(rs[i]); return; }
    if (j < 0) return;
    ev.preventDefault();
    rs[j].focus();
    pick(rs[j]);
  });
  select.addEventListener('change', syncChecked);
  new MutationObserver(rebuild).observe(select, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'],
  });
  rebuild();
}
