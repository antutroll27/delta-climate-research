// src/scripts/climate-engine/v2/shell-v2.ts — OBOS v2 spec §1.7, §3
/**
 * OBOS v2 — THE SHELL. Mounted by the area page only under html[data-ui="v2"],
 * after mountHeatMap. Returns a disposer.
 */
import { bindGlass } from './glass.ts';
import type { Cleanup } from './dom.ts';

export interface ShellCtx { readonly root: HTMLElement; readonly cleanup: Cleanup; glassRefresh: () => void }

export function mountShellV2(): (() => void) | null {
  const root = document.querySelector<HTMLElement>('main.obos-v2');
  if (!root) return null;
  const cleanup: Cleanup = [];
  let disposed = false;
  const dispose = (): void => { for (const off of cleanup.splice(0)) off(); };
  const ctx: ShellCtx = { root, cleanup, glassRefresh: () => {} };
  /* bindGlass is async: if the page was left before it resolved, undo what it registered. */
  void bindGlass(root, cleanup).then((g) => { ctx.glassRefresh = g.refresh; if (disposed) dispose(); });
  return () => { disposed = true; dispose(); };
}
