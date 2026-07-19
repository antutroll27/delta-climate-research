export interface FrameGate {
  /** Return true when this animation owns the current frame. */
  shouldRender(timestampMs: number): boolean;
  /** Make the next timestamp render immediately. */
  reset(): void;
  /** Change cadence without recreating the render surface. */
  setTargetFps(targetFps: number): void;
}

function intervalFor(targetFps: number): number {
  if (!Number.isFinite(targetFps) || targetFps <= 0) {
    throw new RangeError('targetFps must be a positive finite number');
  }
  return 1000 / targetFps;
}

/**
 * Create an independent frame-rate gate for a single render surface.
 *
 * Deadlines stay anchored to the original cadence, rather than to whichever
 * display refresh happened to cross the boundary. That avoids drift on 120 Hz
 * and 144 Hz panels while still recovering cleanly after a suspended tab.
 */
export function createFrameGate(targetFps = 60): FrameGate {
  let intervalMs = intervalFor(targetFps);
  const toleranceMs = 0.5;
  let nextFrameAt: number | undefined;

  return {
    shouldRender(timestampMs) {
      if (!Number.isFinite(timestampMs)) return false;

      // First frame, explicit reset, or a clock that restarted.
      if (nextFrameAt === undefined || timestampMs < nextFrameAt - intervalMs) {
        nextFrameAt = timestampMs + intervalMs;
        return true;
      }

      if (timestampMs + toleranceMs < nextFrameAt) return false;

      // Preserve cadence after a late frame or a long suspension.
      // Apply the same tolerance when advancing the deadline. Without it,
      // floating-point rounding after a long suspension can leave the next
      // deadline at the frame we just rendered and permit an immediate burst.
      const elapsedIntervals = Math.floor((timestampMs + toleranceMs - nextFrameAt) / intervalMs) + 1;
      nextFrameAt += Math.max(1, elapsedIntervals) * intervalMs;
      return true;
    },

    reset() {
      nextFrameAt = undefined;
    },

    setTargetFps(nextTargetFps) {
      intervalMs = intervalFor(nextTargetFps);
      nextFrameAt = undefined;
    },
  };
}
