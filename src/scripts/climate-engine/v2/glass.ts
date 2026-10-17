// src/scripts/climate-engine/v2/glass.ts — OBOS v2 spec §2.3 (founder D2, 16 Oct; REVISED 17 Oct: Plates by default, Glass only when chosen)
import { on, type Cleanup } from './dom.ts';
import type { Cards } from './ui-flag.ts';

export type Tier = 0 | 1 | 2;
export type GlassMode = 'live' | 'flat';
export interface GlassInput {
  readonly cards: Cards; readonly baseTier: Tier; readonly coarsePointer: boolean; readonly softwareRenderer: boolean;
  readonly reducedTransparency: boolean; readonly supportsBackdrop: boolean; readonly saveData: boolean; readonly demoted: boolean;
}
export const TIER_NAME = Object.freeze({ 0: 'low', 1: 'balanced', 2: 'full' } as const);

export function decideGlass(i: GlassInput): GlassMode {
  return i.cards === 'glass' && i.baseTier === 2 && !i.coarsePointer && !i.softwareRenderer
    && !i.reducedTransparency && i.supportsBackdrop && !i.saveData && !i.demoted ? 'live' : 'flat';
}

/** D2 REVISED (founder, 17 Oct): the default is Plates on every device and tier. The S2 audit measured live Glass at +6.2 ms/frame at DSF 2
 *  with only ~62 % of the final blurred area built. Glass is a manual choice (stored like the theme); decideGlass still refuses it where
 *  it is unsafe. The argument is kept so a future per-device default needs no call-site change. */
export function defaultCards(_e: { readonly coarsePointer: boolean; readonly baseTier: Tier }): Cards {
  return 'plates';
}

export interface GlassBinding { readonly refresh: () => void }

/** Writes data-tier and data-glass on the root; watches demotion while live. */
export async function bindGlass(root: HTMLElement, cleanup: Cleanup): Promise<GlassBinding> {
  const rq = await import('../../../utils/render-quality');
  const base = rq.getBaseRenderQuality();
  const mm = (q: string): boolean => { try { return matchMedia(q).matches; } catch { return false; } };
  const coarsePointer = mm('(pointer: coarse)');
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
  /* a mutable record: reduced transparency can be switched on mid-session (S1 audit F3) */
  const env = {
    baseTier: base.tier, coarsePointer, softwareRenderer: rq.isSoftwareRenderer(base.gpuLabel),
    reducedTransparency: mm('(prefers-reduced-transparency: reduce)'),
    supportsBackdrop: typeof CSS !== 'undefined' && CSS.supports('backdrop-filter', 'blur(1px)'),
    saveData: nav.connection?.saveData === true,
  };
  root.dataset.tier = TIER_NAME[base.tier];
  /* D2 revised: the pre-paint script already wrote Plates for an empty store, so there is no guess to correct; only a CHOSEN Glass arrives here. */
  let demoted = false;
  let stopMonitor: (() => void) | null = null;
  const apply = (): void => {
    const cards: Cards = root.dataset.cards === 'plates' ? 'plates' : 'glass';
    const mode = decideGlass({ ...env, cards, demoted });
    root.dataset.glass = mode;
    if (mode === 'live' && !stopMonitor) stopMonitor = rq.beginRenderQualityMonitoring();
    if (mode === 'flat' && stopMonitor) { stopMonitor(); stopMonitor = null; }
  };
  const unsub = rq.subscribeRenderQuality((p) => { if (p.tier < 2 && !demoted) { demoted = true; apply(); } });
  cleanup.push(() => { unsub(); stopMonitor?.(); stopMonitor = null; });
  /* keep the attribute truthful, and stop the monitor, when the reader turns reduced transparency on or off */
  const rtq = ((): MediaQueryList | null => { try { return matchMedia('(prefers-reduced-transparency: reduce)'); } catch { return null; } })();
  on(cleanup, rtq, 'change', () => { env.reducedTransparency = rtq?.matches ?? false; apply(); });
  apply();
  return { refresh: apply };
}
