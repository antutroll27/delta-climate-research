// src/scripts/climate-engine/v2/compare-v2.ts — OBOS v2 (FINAL visual V3, founder decision 19 Oct). Frame-only Compare binders.
/**
 * THE "OPEN BRIEF" LINKS. Compare's own controller keeps `[data-role="brief-link"]` (inside the workspace) pointed at the brief with the current state, but it rewrites the href only when
 * `updateInputs()` runs, and a phase change replaces the address bar without calling it: v1's link goes stale after a phase change. This binder (v2 only, read-only on the controller's
 * nodes) puts the address bar's own query on the link after a phase change, and mirrors the link onto the phone's copy: on a phone the workspace is a collapsed bottom sheet, so the stage
 * carries a second "Open brief" (`[data-v2-brief-link]`, drawn on a phone only) that always has the same destination.
 */
import { $, observe, on } from './dom.ts';
import type { ShellCtx } from './shell-ctx.ts';

export function bindCompareLinks(ctx: ShellCtx): void {
  const { root, cleanup } = ctx;
  const main = $<HTMLAnchorElement>(root, '[data-role="brief-link"]');
  const phone = $<HTMLAnchorElement>(root, '[data-v2-brief-link]');
  const mirror = (): void => { const href = main?.getAttribute('href'); if (phone && href) phone.setAttribute('href', href); };
  observe(cleanup, main, { attributes: true, attributeFilter: ['href'] }, mirror);
  /* the controller's own `change` listener (on the input) has already replaced the URL when this one (on the root, bubbling) runs */
  on(cleanup, root, 'change', (e) => {
    if (!(e.target as Element).matches('[data-input="phase"]')) return;
    main?.setAttribute('href', `/heat-map/brief/${window.location.search}`);
  });
  mirror();
}
