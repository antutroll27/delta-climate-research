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

/** Plan S3.2 Step 7. Reads what the app wrote into #lst, #lstPhase and #conf and mirrors it; derives nothing (brainstorm 03 R7). */
export function bindMirrors(ctx: ShellCtx): void {
  const { root, cleanup } = ctx;
  const lst = $(root, '#lst'), phase = $(root, '#lstPhase'), conf = $(root, '#conf');
  /* the ward mark takes #lst's own class colour, so the two cannot disagree (spec §4.1.5) */
  const sym = $(root, '[data-v2-lstsym]');
  observe(cleanup, lst, { attributes: true, attributeFilter: ['style'] }, () => { if (sym && lst) sym.style.color = lst.style.color || ''; });
  bindAirKind(ctx);
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
    const v = copy?.textContent?.trim() ?? '';
    for (const m of $$(root, '[data-v2-mirror="lst"]')) m.textContent = v;
    for (const m of $$(root, '[data-v2-mirror="conf"]')) m.textContent = conf?.textContent ?? '';
    for (const m of $$(root, '[data-v2-mirror="phase"]')) m.textContent = phase?.textContent ?? '';
  };
  for (const n of [lst, conf, phase]) observe(cleanup, n, { childList: true, characterData: true, subtree: true }, syncHero);
  syncPhase(); syncHero();
}

/** Plan S4.2 Step 3. The breadcrumb opens the Explore panel on its Area select; Less/More folds the card. On a laptop it starts folded (the preview's rule). */
export function bindWardCard(ctx: ShellCtx): void {
  const { root, cleanup } = ctx;
  on(cleanup, $(root, '[data-v2-crumb]'), 'click', () => {
    ctx.sections?.go('overview', true);
    $(root, '#scope-area-trigger')?.focus();
  });
  const card = $(root, '#v2WardCard'), more = $<HTMLButtonElement>(root, '[data-v2-more]');
  const set = (open: boolean): void => {
    if (card) card.dataset.more = String(open);
    more?.setAttribute('aria-expanded', String(open));
    more?.setAttribute('aria-label', open ? 'Show less about this ward' : 'Show more about this ward');
    if (more) more.textContent = open ? 'Less' : 'More';
  };
  set(window.matchMedia('(min-width: 1366px)').matches);
  on(cleanup, more, 'click', () => set(card?.dataset.more !== 'true'));
}
