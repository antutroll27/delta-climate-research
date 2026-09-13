/**
 * THE LOADING CHIP, TIMED SO IT NEITHER FLASHES NOR HIDES A FAILURE.
 *
 * Measured: the chip fades over 0.25 s and an in-place switch takes 248–299 ms,
 * so it used to fade in and be removed as it reached full opacity. A delay alone
 * does not fix that — a revisit took 393 ms on Slow 4G and a prefetched first visit
 * about 700 ms (dev server), so loads land just after the delay and would remove
 * the chip the instant it appears. So: show only after SHOW_AFTER_MS, and once shown stay up
 * at least MIN_VISIBLE_MS. A refusal or failure shows at once and is never delayed.
 */
export const SHOW_AFTER_MS = 400;
export const MIN_VISIBLE_MS = 500;

export interface ChipElement {
  textContent: string | null;
  classList: { add(token: string): void; remove(token: string): void };
}

export interface ChipClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export interface LoadChip {
  /** A load began. Shows `text` only if it is still loading after SHOW_AFTER_MS. */
  start(text: string): void;
  /** The load finished. Hides now, or once it has been visible MIN_VISIBLE_MS. */
  done(): void;
  /** Show `text` immediately and leave it up — a refusal or a failure. */
  fail(text: string): void;
}

export function createLoadChip(el: ChipElement | null, clock: ChipClock): LoadChip {
  let showTimer: number | null = null;
  let hideTimer: number | null = null;
  let shownAt: number | null = null;

  const clear = (): void => {
    if (showTimer !== null) { clock.clearTimeout(showTimer); showTimer = null; }
    if (hideTimer !== null) { clock.clearTimeout(hideTimer); hideTimer = null; }
  };
  const show = (text: string): void => {
    if (!el) return;
    el.textContent = text;
    el.classList.add('on');
    shownAt = clock.now();
  };
  const hide = (): void => {
    el?.classList.remove('on');
    shownAt = null;
  };

  return {
    start(text) {
      clear();
      /* Already visible from a load this one superseded: retitle and keep it up,
         rather than blinking it off and on again. */
      if (shownAt !== null) { show(text); return; }
      showTimer = clock.setTimeout(() => { showTimer = null; show(text); }, SHOW_AFTER_MS);
    },
    done() {
      clear();
      if (shownAt === null) return;
      const remaining = MIN_VISIBLE_MS - (clock.now() - shownAt);
      if (remaining <= 0) hide();
      else hideTimer = clock.setTimeout(() => { hideTimer = null; hide(); }, remaining);
    },
    fail(text) {
      clear();
      show(text);
    },
  };
}
