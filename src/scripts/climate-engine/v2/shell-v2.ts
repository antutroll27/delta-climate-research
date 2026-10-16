// src/scripts/climate-engine/v2/shell-v2.ts
/**
 * OBOS v2 — THE SHELL (spec §1.7, §3). Mounted by the area page only under
 * html[data-ui="v2"], after mountHeatMap. Returns a disposer.
 */
export function mountShellV2(): (() => void) | null {
  const root = document.querySelector<HTMLElement>('main.obos-v2');
  if (!root) return null;
  const cleanup: Array<() => void> = [];
  return () => { for (const off of cleanup.splice(0)) off(); };
}
