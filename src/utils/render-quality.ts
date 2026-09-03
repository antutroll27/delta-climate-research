export type RenderTier = 0 | 1 | 2;

export interface RenderQualityProfile {
  /** 0 = low, 1 = balanced, 2 = full fidelity. */
  tier: RenderTier;
  /** Ceiling shared by renderer backing stores. */
  maxDevicePixelRatio: number;
  /** The hero's post-process pass is reserved for the full-fidelity tier. */
  bloom: boolean;
  /** Runtime-controlled upper bound for Vortex's ray-march loop. */
  vortexIterations: number;
  /** Size of the About water reflection target at boot. */
  waterReflectionSize: number;
  /** Decorative render cadence. Scrolling and interaction stay unthrottled. */
  targetFps: 30 | 60;
  /** Local-only diagnostic label. It is never persisted or transmitted. */
  gpuLabel: string;
}

export interface RenderHardwareHints {
  coarsePointer?: boolean;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  saveData?: boolean;
}

export interface AdaptiveRenderGovernorOptions {
  sampleFrames?: number;
  settleFrames?: number;
  budgetMs?: number;
  maxStepDowns?: number;
  onTierChange: (tier: RenderTier) => void;
}

const PROFILES: Record<RenderTier, Omit<RenderQualityProfile, 'gpuLabel'>> = {
  2: {
    tier: 2,
    maxDevicePixelRatio: 1.6,
    bloom: true,
    vortexIterations: 64,
    waterReflectionSize: 512,
    targetFps: 60,
  },
  1: {
    tier: 1,
    maxDevicePixelRatio: 1.25,
    bloom: false,
    vortexIterations: 40,
    waterReflectionSize: 384,
    targetFps: 60,
  },
  0: {
    tier: 0,
    maxDevicePixelRatio: 1,
    bloom: false,
    vortexIterations: 24,
    waterReflectionSize: 256,
    targetFps: 30,
  },
};

/**
 * ANGLE reports trademark noise inside the model name — "AMD Radeon(TM) Vega 8
 * Graphics", "Intel(R) Arc(TM) Graphics". Stripping it first is not cosmetic:
 * the old `radeon vega` rule could NEVER match a real Chrome label, because
 * "(TM) " sits between the two words. Every AMD APU therefore scored tier 2 and
 * ran the GPU solver on exactly the integrated hardware caps.ts says it must
 * not. Normalise once, then write the patterns the way a person reads a GPU.
 */
function normaliseGpuLabel(label: string): string {
  return label.toLowerCase().replace(/\((?:tm|r)\)|[™®]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* `mali-[gt][0-7]` was meant for old Mali parts and caught every modern one:
   G78, G710, G715 and G610/G615 all matched its `g7`/`g6` prefix and were graded
   LOW — the flagship Android GPUs, told they could not draw a city. Now: all
   T-series (genuinely old), and TWO-DIGIT G-series up to G69. A word boundary is
   what keeps `g61` from matching inside `g610`. */
const LOW_GPU = /(swiftshader|software|llvmpipe|virtualbox|microsoft basic|intel (uhd|hd) graphics|iris|mali-(?:t\d{3}|g[1-6]\d\b)|adreno [1-5]|powervr)/;
/**
 * Capable but INTEGRATED. Tier 1 keeps the 3D relief view while routing the
 * solver to the CPU, which is the point: a shared-memory ping-pong plus readback
 * on an igpu is routinely slower than the CPU loop it replaces (see caps.ts).
 *
 * The model-number rules are what separate integrated from discrete on shared
 * brand names: `arc graphics` is Meteor Lake's igpu, `arc a770 graphics` is a
 * card; Vega 3/8/11 are APUs, Vega 56/64 are cards.
 */
const MID_GPU = new RegExp([
  'iris xe',                    // Tiger Lake and later Intel igpu
  'intel xe graphics',          // same silicon, driver reports it without "iris"
  'intel arc graphics',         // Meteor/Lunar/Arrow Lake igpu — NOT "arc a770"
  'intel graphics(?! *[0-9])',  // generic modern Intel igpu label
  'radeon (?:rx )?vega (?:[0-9]|1[01])\\b', // AMD APU; Vega 56/64 are discrete
  'radeon graphics',            // generic Ryzen APU label, no model number
  'mx[1-5][0-9]{2}',
  'gtx 9', 'gtx 10[5-6]',
  'adreno 6',
  'apple gpu.*a1[0-3]\\b',
].join('|'));

interface NavigatorWithRenderHints extends Navigator {
  readonly deviceMemory?: number;
  readonly connection?: { readonly saveData?: boolean };
}

function profileFor(tier: RenderTier, gpuLabel: string): RenderQualityProfile {
  return { ...PROFILES[tier], gpuLabel };
}

/** CPU and network hints intentionally only ever lower the visual workload. */
export function classifyHardware(hints: RenderHardwareHints): RenderTier {
  if (hints.saveData || (hints.deviceMemory ?? Infinity) <= 2 || (hints.hardwareConcurrency ?? Infinity) <= 4) {
    return 0;
  }
  if (
    hints.coarsePointer
    || (hints.deviceMemory ?? Infinity) <= 4
    || (hints.hardwareConcurrency ?? Infinity) <= 6
  ) {
    return 1;
  }
  return 2;
}

/** Conservative GPU classification for labels exposed by WebGL/ANGLE. */
export function classifyGpu(label: string): RenderTier {
  if (label === 'no-webgl') return 0;
  const name = normaliseGpuLabel(label);
  // MID is tested first on purpose: "iris xe" must beat the bare "iris" in LOW.
  if (MID_GPU.test(name)) return 1;
  if (LOW_GPU.test(name)) return 0;
  return 2;
}

/**
 * Read the renderer through a temporary high-performance context. This value
 * exists only in memory for the lifetime of the page and is never reported.
 */
export function readGpuLabel(): string {
  if (typeof document === 'undefined') return 'server';

  try {
    const canvas = document.createElement('canvas');
    const attributes: WebGLContextAttributes = { powerPreference: 'high-performance' };
    const gl = canvas.getContext('webgl2', attributes) ?? canvas.getContext('webgl', attributes);
    if (!gl) return 'no-webgl';

    const debug = gl.getExtension('WEBGL_debug_renderer_info') as {
      UNMASKED_RENDERER_WEBGL: number;
    } | null;
    const label = debug
      ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    const contextLoss = gl.getExtension('WEBGL_lose_context') as { loseContext?: () => void } | null;
    contextLoss?.loseContext?.();
    return label;
  } catch {
    return 'gpu-detect-error';
  }
}

export function resolveRenderQuality(hints: RenderHardwareHints, gpuLabel: string): RenderQualityProfile {
  const tier = Math.min(classifyHardware(hints), classifyGpu(gpuLabel)) as RenderTier;
  return profileFor(tier, gpuLabel);
}

function browserHints(): RenderHardwareHints {
  const nav = navigator as NavigatorWithRenderHints;
  return {
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
    saveData: nav.connection?.saveData,
  };
}

/**
 * Watches real browser frame delivery, not per-surface draw calls. It only
 * demotes quality, so the page cannot oscillate while someone is reading it.
 */
export class AdaptiveRenderGovernor {
  private samples: number[] = [];
  private skip: number;
  private stepDowns = 0;
  private lastFrameAt: number | undefined;
  private tier: RenderTier;
  private readonly options: Required<AdaptiveRenderGovernorOptions>;

  constructor(initialTier: RenderTier, options: AdaptiveRenderGovernorOptions) {
    this.tier = initialTier;
    this.options = {
      sampleFrames: 90,
      settleFrames: 30,
      budgetMs: 17,
      maxStepDowns: 2,
      ...options,
    };
    this.skip = this.options.settleFrames;
  }

  frame(timestampMs: number): void {
    if (!Number.isFinite(timestampMs)) return;
    if (this.lastFrameAt === undefined) {
      this.lastFrameAt = timestampMs;
      return;
    }

    const elapsed = timestampMs - this.lastFrameAt;
    this.lastFrameAt = timestampMs;
    // Background tabs and restarted clocks are not a performance sample.
    if (elapsed <= 0 || elapsed > 250) return;
    if (this.skip > 0) {
      this.skip -= 1;
      return;
    }

    this.samples.push(elapsed);
    if (this.samples.length < this.options.sampleFrames) return;

    const sorted = [...this.samples].sort((left, right) => left - right);
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    this.samples.length = 0;
    if (
      p75 > this.options.budgetMs
      && this.tier > 0
      && this.stepDowns < this.options.maxStepDowns
    ) {
      this.tier = (this.tier - 1) as RenderTier;
      this.stepDowns += 1;
      this.skip = this.options.settleFrames;
      this.options.onTierChange(this.tier);
    }
  }
}

class RenderQualityController {
  private profile = resolveRenderQuality(browserHints(), readGpuLabel());
  private readonly subscribers = new Set<(profile: RenderQualityProfile) => void>();
  private activeSurfaces = 0;
  private raf = 0;
  private readonly governor = new AdaptiveRenderGovernor(this.profile.tier, {
    onTierChange: (tier) => this.applyTier(tier),
  });

  get current(): RenderQualityProfile {
    return this.profile;
  }

  subscribe(listener: (profile: RenderQualityProfile) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  beginMonitoring(): () => void {
    this.activeSurfaces += 1;
    if (this.activeSurfaces === 1) this.raf = requestAnimationFrame(this.monitorFrame);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeSurfaces = Math.max(0, this.activeSurfaces - 1);
      if (this.activeSurfaces === 0 && this.raf) {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
      }
    };
  }

  private monitorFrame = (timestampMs: number) => {
    this.governor.frame(timestampMs);
    this.raf = this.activeSurfaces > 0 ? requestAnimationFrame(this.monitorFrame) : 0;
  };

  private applyTier(tier: RenderTier): void {
    if (tier >= this.profile.tier) return;
    this.profile = profileFor(tier, this.profile.gpuLabel);
    this.subscribers.forEach((subscriber) => subscriber(this.profile));
  }
}

type WindowWithRenderQuality = Window & {
  __deltaRenderQualityController?: RenderQualityController;
};

function getController(): RenderQualityController | undefined {
  if (typeof window === 'undefined') return undefined;
  const qualityWindow = window as WindowWithRenderQuality;
  qualityWindow.__deltaRenderQualityController ??= new RenderQualityController();
  return qualityWindow.__deltaRenderQualityController;
}

export function getRenderQuality(): RenderQualityProfile {
  return getController()?.current ?? profileFor(2, 'server');
}

export function subscribeRenderQuality(listener: (profile: RenderQualityProfile) => void): () => void {
  return getController()?.subscribe(listener) ?? (() => {});
}

/** Keep the cheap global frame sampler live only while a decorative surface is visible. */
export function beginRenderQualityMonitoring(): () => void {
  return getController()?.beginMonitoring() ?? (() => {});
}
