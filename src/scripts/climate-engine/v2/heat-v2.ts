// src/scripts/climate-engine/v2/heat-v2.ts — OBOS v2 spec §4.1, §3.8. Owner: Track A (plan A1). The plan wrote these into shell-v2.ts; A1 moves them here.
import { $, $$, observe, on } from './dom.ts';
import type { ShellCtx } from './shell-ctx.ts';
import { symSvg } from './symbols.ts';

export interface AirKind { readonly text: string; readonly cls: 'measured' | 'modelled'; readonly mark: 'measured' | 'modelled'; readonly showMark: boolean }

/** The air row's provenance, from the app's own source decision (paintWeatherLine → obos:observed, spec C9).
    A fresh airport report is OBSERVED and solid; Met Norway is a FORECAST and outlined; no number at all is "no reading" and draws no mark. */
export function airKind(observed: boolean, reading: boolean): AirKind {
  if (observed && reading) return { text: 'observed', cls: 'measured', mark: 'measured', showMark: true };
  if (reading) return { text: 'forecast', cls: 'modelled', mark: 'modelled', showMark: true };
  return { text: 'no reading', cls: 'modelled', mark: 'modelled', showMark: false };
}

/** A-S3 audit F1. Reads presence only, never a number (brainstorm 03 R7). The card ships in the safe state; a missed event can only under-claim. */
export function bindAirKind(ctx: ShellCtx): void {
  const { root, cleanup } = ctx;
  const chip = $(root, '[data-v2-airkind]'), mark = $(root, '[data-v2-airsym]'), t = $(root, '#liveT');
  let observed = false;
  const paint = (): void => {
    const reading = (t?.textContent ?? '—').trim() !== '—';
    const k = airKind(observed, reading);
    if (chip) { chip.textContent = k.text; chip.className = `kind ${k.cls}`; }
    if (mark) { mark.innerHTML = symSvg('disc', 'ink', k.mark, 26); mark.hidden = !k.showMark; }
  };
  const onObserved = (e: Event): void => { observed = !!(e as CustomEvent<{ observed: unknown }>).detail?.observed; paint(); };
  document.addEventListener('obos:observed', onObserved);
  cleanup.push(() => document.removeEventListener('obos:observed', onObserved));
  observe(cleanup, t, { childList: true, characterData: true, subtree: true }, paint);
  paint();
}

/** A-S3 audit F4. #legend scrolls with its bar hidden: data-v2-scroll="1" while there is more below, so screens/heat.css can fade the foot of the column.
    The fade lifts at the end, so the last line is never faded. Layout is read in a frame, never in an observer callback. */
export function bindScrollCue(ctx: ShellCtx): void {
  const { root, cleanup } = ctx;
  const col = $(root, '#legend');
  if (!col) return;
  let queued = 0;
  const sync = (): void => { queued = 0; col.dataset.v2Scroll = col.scrollHeight - col.clientHeight - col.scrollTop > 2 ? '1' : '0'; };
  const queue = (): void => { if (!queued) queued = requestAnimationFrame(sync); };
  on(cleanup, col, 'scroll', queue, { passive: true });
  on(cleanup, col, 'toggle', queue, { capture: true });      // a disclosure opening changes the height (toggle does not bubble)
  on(cleanup, window, 'resize', queue);
  observe(cleanup, col, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'open', 'class'] }, queue);
  observe(cleanup, root, { attributes: true, attributeFilter: ['data-section'] }, queue);
  cleanup.push(() => { if (queued) cancelAnimationFrame(queued); });
  sync();
}

/** Plan S3.2 Step 7. Reads what the app wrote into #lst, #lstPhase and #conf and mirrors it; derives nothing (brainstorm 03 R7). */
export function bindMirrors(ctx: ShellCtx): void {
  const { root, cleanup } = ctx;
  const lst = $(root, '#lst'), phase = $(root, '#lstPhase'), conf = $(root, '#conf'), area = $(root, '#crumbArea');
  /* the ward mark takes #lst's own class colour, so the two cannot disagree (spec §4.1.5); painted at mount (A-S3 audit F2) and on every change */
  const sym = $(root, '[data-v2-lstsym]');
  const syncMark = (): void => { if (sym && lst) sym.style.color = lst.style.color || ''; };
  observe(cleanup, lst, { attributes: true, attributeFilter: ['style'] }, syncMark); syncMark();
  bindAirKind(ctx);
  bindScrollCue(ctx);
  /* the clock widget says when the map is a modelled phase, in the app's own words (spec §3.6) */
  const kmap = $(root, '[data-v2-kmap]');
  const syncPhase = (): void => {
    const t = phase?.textContent?.trim() ?? '';
    if (kmap) { kmap.textContent = t; kmap.hidden = t === '' || t === 'modelled now'; }
  };
  observe(cleanup, phase, { childList: true, characterData: true, subtree: true }, syncPhase);
  /* the Explore panel's read-only hero (spec §4.2): text only, no ids, aria-hidden. #lst's value without the band the app also writes there. */
  const syncHero = (): void => {
    const copy = lst?.cloneNode(true) as HTMLElement | undefined;
    copy?.querySelector('.band')?.remove();
    copy?.querySelector('.u')?.remove();                       // the unit is drawn small by the hero's own .u
    const v = copy?.textContent?.trim() ?? '';
    for (const m of $$(root, '[data-v2-mirror="lst"]')) m.textContent = v;
    /* ONE ± ON THE PAGE (founder's rule; A-S5 audit F1): the card's chip carries the ±, so the hero repeats the chip without it:
       "Calibrated · n=50", "Indicative only · n=29 · earlier set", "Outside validation" stay; the ± segment does not. */
    const chip = (conf?.textContent ?? '').split(' · ').filter((s) => !s.includes('±')).join(' · ');
    for (const m of $$(root, '[data-v2-mirror="conf"]')) m.textContent = chip;
    for (const m of $$(root, '[data-v2-mirror="phase"]')) m.textContent = phase?.textContent ?? '';
    for (const m of $$(root, '[data-v2-mirror="area"]')) m.textContent = area?.textContent ?? '';   // the app's own breadcrumb, so an in-place switch follows
  };
  for (const n of [lst, conf, phase, area]) observe(cleanup, n, { childList: true, characterData: true, subtree: true }, syncHero);
  syncPhase(); syncHero();
}

/** Plan S4.2 Step 3. The breadcrumb opens the Explore panel on its Area select; Less/More folds the card. On a laptop it starts folded (the preview's rule). */
export function bindWardCard(ctx: ShellCtx): void {
  const { root, cleanup } = ctx;
  on(cleanup, $(root, '[data-v2-crumb]'), 'click', () => {
    ctx.sections?.go('overview', true);
    $(root, '#scope-area-trigger')?.focus();
  });
  const card = $(root, '#v2WardCard'), more = $<HTMLButtonElement>(root, '#v2WardCard [data-v2-more]');
  const set = (open: boolean): void => {
    if (card) card.dataset.more = String(open);
    more?.setAttribute('aria-expanded', String(open));
    more?.setAttribute('aria-label', open ? 'Show less about this ward' : 'Show more about this ward');
    if (more) more.textContent = open ? 'Less' : 'More';
  };
  /* A-S4 audit F1: the stack grows up from the dock, so it opens only where there is HEIGHT as well as width (at 1366 x 768 a toast sat on the Sun card).
     It follows the viewport until the reader folds or unfolds it himself. */
  const roomy = window.matchMedia('(min-width: 1366px) and (min-height: 860px)');
  let chosen = false;
  set(roomy.matches);
  on(cleanup, roomy, 'change', () => { if (!chosen) set(roomy.matches); });
  on(cleanup, more, 'click', () => { chosen = true; set(card?.dataset.more !== 'true'); });
}
