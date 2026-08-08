export type ExploreDeviceTier = 'low' | 'balanced' | 'full';

export interface ExploreRuntimeInputs {
  visible: boolean;
  interacting: boolean;
  reducedMotion: boolean;
  deviceTier: ExploreDeviceTier;
}

export interface ExploreRuntimeBudget {
  simulate: boolean;
  simulationIntervalMs: number;
  allowCloudMotion: boolean;
  pixelRatioCap: number;
}

/**
 * A small, DOM-free admission policy for the live Explore instrument. It keeps
 * physics, ambient motion, and pixel density intentional rather than allowing
 * independent animation loops to compete for a frame.
 *
 * `simulate` and `allowCloudMotion` deliberately split on `interacting`, because
 * their costs are not remotely comparable:
 *
 *  · the simulation is a 192×192 grid solved for hundreds of explicit steps, so
 *    admitting it mid-gesture is what turns an orbit into a slideshow. It stays
 *    suspended while the pointer is down.
 *  · the cloud deck is transform/opacity writes across 26 sprites, measured
 *    against a 1.5 ms frame budget when it was built. Suspending it on
 *    `interacting` bought nothing and cost a visible hitch at BOTH ends of every
 *    gesture: drift froze the instant a drag began and snapped back on release.
 *    Ambient motion therefore rides through gestures.
 */
export function exploreRuntimeBudget(input: ExploreRuntimeInputs): ExploreRuntimeBudget {
  const paused = !input.visible || input.interacting || input.reducedMotion;
  const tier = input.deviceTier;
  return {
    simulate: !paused,
    simulationIntervalMs: tier === 'full' ? 720 : tier === 'balanced' ? 1000 : 1500,
    allowCloudMotion: !input.reducedMotion && input.visible && tier !== 'low',
    pixelRatioCap: tier === 'full' ? 1.75 : tier === 'balanced' ? 1.35 : 1,
  };
}

export interface ExploreFrameCadenceInputs {
  /** A gesture, inertia, orbit or grow tween is mid-flight this frame. */
  animating: boolean;
  /** The ambient cloud deck wants to drift. */
  cloudMotion: boolean;
  /** A live simulation step is admissible at all. */
  simEligible: boolean;
  /** Milliseconds left on the simulation interval; may be negative when overdue. */
  msUntilNextSim: number;
}

/**
 * How long to wait before asking for the next Explore frame. `null` means the
 * loop has nothing left to do and should idle until something re-arms it.
 *
 * ANIMATING MUST RETURN 0, AND 0 MEANS "the very next display frame".
 *
 * A non-zero delay goes through setTimeout, and a timer can only ever be
 * serviced on a subsequent vsync — so any delay quantises UP to a whole number
 * of refresh intervals. On a 144 Hz display (6.94 ms per refresh):
 *
 *   | requested | refreshes waited | actual gap | effective |
 *   |-----------|------------------|------------|-----------|
 *   | 16 ms     | 3                | 20.8 ms    | 48 fps    |
 *   | 0         | 1                | 6.94 ms    | 143 fps   |
 *
 * A "16 ms for 60 fps" delay therefore costs roughly three times the frame rate
 * on a high-refresh display while being completely undetectable at 60 Hz, where
 * both values land on the same 16.7 ms vsync. Do not reintroduce one: the
 * scheduler already coalesces to at most one frame, so 0 cannot spin.
 */
export function nextFrameDelayMs(input: ExploreFrameCadenceInputs): number | null {
  if (input.animating) return 0;
  if (input.cloudMotion) return 50;
  if (input.simEligible) return Math.max(0, input.msUntilNextSim);
  return null;
}
