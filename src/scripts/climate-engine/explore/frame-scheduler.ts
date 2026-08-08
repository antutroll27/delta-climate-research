export type ExploreFrameReason = 'drag' | 'orbit' | 'grow' | 'render';

/** The clock seam. Production passes nothing; tests drive every call themselves. */
export interface FrameHost {
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(id: number): void;
  setTimer(callback: () => void, delayMs: number): number;
  clearTimer(id: number): void;
  now(): number;
}

/* Wrappers, not bare method references: browser animation methods require Window
   as their receiver in some engines, so `requestFrame: window.requestAnimationFrame`
   would throw once detached from it. */
export const browserFrameHost: FrameHost = {
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (id) => window.cancelAnimationFrame(id),
  setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimer: (id) => window.clearTimeout(id),
  now: () => performance.now(),
};

/** Coalesces one-shot visual work into at most one animation frame. */
export interface ExploreFrameScheduler {
  /** Fold this reason into the NEXT display frame. */
  request(reason: ExploreFrameReason): void;
  /**
   * Requests a future frame without allowing a slower cadence to replace an
   * already-scheduled earlier one. This is the key arbitration rule when orbit
   * needs 16 ms but simulation only needs a frame every 720–1500 ms.
   *
   * A delay of 0 takes the immediate requestAnimationFrame branch and MUST keep
   * doing so — a timer can only be picked up on a subsequent vsync, so any
   * non-zero delay quantises up to whole refresh intervals and costs ~3x the
   * frame rate at 144 Hz while being invisible at 60 Hz.
   */
  requestAfter(reason: ExploreFrameReason, delayMs: number): void;
  cancelPending(): void;
  dispose(): void;
}

export function createExploreFrameScheduler(
  onFrame: (time: number, reasons: ReadonlySet<ExploreFrameReason>) => void,
  host: Partial<FrameHost> = {},
): ExploreFrameScheduler {
  const {
    requestFrame = browserFrameHost.requestFrame,
    cancelFrame = browserFrameHost.cancelFrame,
    setTimer = browserFrameHost.setTimer,
    clearTimer = browserFrameHost.clearTimer,
    now = browserFrameHost.now,
  } = host;

  const pending = new Set<ExploreFrameReason>();
  let frame: number | null = null;
  let timer: number | null = null;
  let timerDeadline = Infinity;
  let disposed = false;

  function clearDelayedRequest(): void {
    if (timer !== null) clearTimer(timer);
    timer = null;
    timerDeadline = Infinity;
  }

  function queueFrame(): void {
    if (frame !== null) return;
    frame = requestFrame((time) => {
      frame = null;
      const reasons = new Set(pending);
      pending.clear();
      onFrame(time, reasons);
    });
  }

  function request(reason: ExploreFrameReason): void {
    if (disposed) return;
    clearDelayedRequest();
    pending.add(reason);
    queueFrame();
  }

  function cancelPending(): void {
    pending.clear();
    clearDelayedRequest();
    if (frame !== null) cancelFrame(frame);
    frame = null;
  }

  return {
    request,

    requestAfter(reason, delayMs) {
      if (disposed) return;
      if (delayMs <= 0 || frame !== null) {
        request(reason);
        return;
      }
      const deadline = now() + delayMs;
      if (deadline >= timerDeadline) return;
      clearDelayedRequest();
      timerDeadline = deadline;
      timer = setTimer(() => {
        timer = null;
        timerDeadline = Infinity;
        request(reason);
      }, delayMs);
    },

    cancelPending,

    dispose() {
      disposed = true;
      cancelPending();
    },
  };
}
