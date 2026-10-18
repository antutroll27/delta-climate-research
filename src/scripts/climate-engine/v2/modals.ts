// src/scripts/climate-engine/v2/modals.ts — OBOS v2 spec §7.3 (S8): focus stays inside an open modal; B audit C3.
/**
 * THE APP'S MODALS, FINISHED. The payback sheet (#solPay), the installer brief (#solBrief) and the street-view viewer make the stage's other
 * children inert themselves, but the Base skip-link sits OUTSIDE the stage, so Tab walked out of the modal to it. This watches each modal's
 * `hidden` attribute and holds the page's furniture inert while it is open. The phone entry note (#entryNote, a modal the app never fenced) also
 * gets the root's other children. Read-only on the app's nodes.
 */
import { $, observe, type Cleanup } from './dom.ts';
import { holdInert, pageFurniture } from './inert.ts';

const MODALS = ['#solPay', '#solBrief', '#svModal', '#entryNote'] as const;

export function bindModals(root: HTMLElement, cleanup: Cleanup): void {
  const releases = new Map<string, () => void>();
  const sync = (): void => {
    for (const sel of MODALS) {
      const m = $(root, sel);
      const open = !!m && !m.hasAttribute('hidden');
      if (open && !releases.has(sel)) {
        const behind = sel === '#entryNote' ? [...root.children].filter((c) => c !== m) : [];
        releases.set(sel, holdInert([...behind, ...pageFurniture(root)]));
      } else if (!open && releases.has(sel)) { releases.get(sel)?.(); releases.delete(sel); }
    }
  };
  for (const s of MODALS) observe(cleanup, $(root, s), { attributes: true, attributeFilter: ['hidden'] }, sync);
  sync();
  cleanup.push(() => { for (const r of releases.values()) r(); releases.clear(); });
}
