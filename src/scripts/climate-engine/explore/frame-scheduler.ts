export type ExploreFrameReason = 'drag' | 'orbit' | 'grow' | 'render';

export interface ExploreFrameSchedulerOptions {
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
  setTimer?: (callback: () => void, delayMs: number) => number;
  clearTimer?: (id: number) => void;
  now?: () => number;
}

/** Coalesces one-shot visual work into at most one animation frame. */
export class ExploreFrameScheduler {
  private pending = new Set<ExploreFrameReason>();
  private frame: number | null = null;
  private timer: number | null = null;
  private timerDeadline = Infinity;
  private disposed = false;
  private requestFrame: (callback: FrameRequestCallback) => number;
  private cancelFrame: (id: number) => void;
  private setTimer: (callback: () => void, delayMs: number) => number;
  private clearTimer: (id: number) => void;
  private now: () => number;

  constructor(
    private readonly onFrame: (time: number, reasons: ReadonlySet<ExploreFrameReason>) => void,
    options: ExploreFrameSchedulerOptions = {},
  ) {
    // Browser animation methods require Window as their receiver in some
    // engines, so retain them behind lexical wrappers rather than storing the
    // host methods directly on this scheduler instance.
    this.requestFrame = options.requestFrame ?? ((callback) => window.requestAnimationFrame(callback));
    this.cancelFrame = options.cancelFrame ?? ((id) => window.cancelAnimationFrame(id));
    this.setTimer = options.setTimer ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((id) => window.clearTimeout(id));
    this.now = options.now ?? (() => performance.now());
  }

  request(reason: ExploreFrameReason): void {
    if (this.disposed) return;
    this.clearDelayedRequest();
    this.pending.add(reason);
    this.queueFrame();
  }

  /**
   * Requests a future frame without allowing a slower cadence to replace an
   * already-scheduled earlier one. This is the key arbitration rule when orbit
   * needs 16 ms but simulation only needs a frame every 720–1500 ms.
   */
  requestAfter(reason: ExploreFrameReason, delayMs: number): void {
    if (this.disposed) return;
    if (delayMs <= 0 || this.frame !== null) {
      this.request(reason);
      return;
    }
    const deadline = this.now() + delayMs;
    if (deadline >= this.timerDeadline) return;
    this.clearDelayedRequest();
    this.timerDeadline = deadline;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.timerDeadline = Infinity;
      this.request(reason);
    }, delayMs);
  }

  cancelPending(): void {
    this.pending.clear();
    this.clearDelayedRequest();
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
  }

  private queueFrame(): void {
    if (this.frame !== null) return;
    this.frame = this.requestFrame((time) => {
      this.frame = null;
      const reasons = new Set(this.pending);
      this.pending.clear();
      this.onFrame(time, reasons);
    });
  }

  private clearDelayedRequest(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.timerDeadline = Infinity;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelPending();
  }
}
