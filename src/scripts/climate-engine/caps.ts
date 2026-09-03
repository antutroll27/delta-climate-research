/**
 * Heat-map runtime capability detection + tier -> workload mapping.
 *
 * Sibling of render-quality.ts. That module already classifies the *device* into
 * a RenderTier (0 low · 1 balanced · 2 full) from hardware + GPU hints; this one
 * reuses that verdict and adds only the two probes the heat sim specifically
 * needs — WebGPU compute and WebGL2 float render targets — then maps the tier
 * onto a backend and default map mode. The analytical grid stays canonical;
 * capability tiers may only change execution and display quality.
 *
 * Runs on the main thread (needs `document`/`navigator`). The resolved HeatCaps
 * is postMessage'd into the sim worker, which never re-probes.
 */
import type { RenderTier } from '../../utils/render-quality';

/** Which HeatSim implementation the worker should instantiate. */
export type SimBackend =
  | 'gpu' // GPU ping-pong stencil (WebGPU or WebGL2 float RT); full tier only
  | 'wasm' // future sim-wasm.ts behind the same ABI; never auto-selected yet
  | 'ts' // sim-ts.ts CPU solver in the worker; the universal floor
  | 'baked'; // no live sim: cross-fade prebaked scenario frames (runtime demotion)

export type MapMode = 'relief' | 'isotherm';

export interface SimCapabilities {
  /** navigator.gpu.requestAdapter() actually returned an adapter. */
  webgpu: boolean;
  /** WebGL2 + EXT_color_buffer_float — render-to-float for a ping-pong stencil. */
  floatRenderTargets: boolean;
}

export interface HeatCaps {
  tier: RenderTier;
  backend: SimBackend;
  /** Canonical N for the N×N finite-difference grid. */
  grid: 192;
  mode: MapMode;
  /** false -> reduced-motion: render ONE static frame, never step the sim. */
  animate: boolean;
  webgpu: boolean;
  floatRenderTargets: boolean;
  /** Diagnostic only; render-quality's in-memory GPU label. Never transmitted. */
  gpuLabel: string;
}

/* EVERY TIER OPENS ON THE 3-D CITY. Tier 0 used to open flat, which meant the
   thing people came to see was hidden from the devices most of them arrive on —
   and the tier is a guess about a GPU label, not a measurement of what the phone
   can do. The runtime already demotes on real evidence: render-quality.ts watches
   frame times and drops the pixel ratio, and caps.ts routes tier 0 to the CPU
   solver regardless of what is drawn. So the cost of being wrong here is a
   softer picture, not a broken one, and the 2-D isotherm stays one tap away. */
const TIER_MODE: Record<RenderTier, MapMode> = { 2: 'relief', 1: 'relief', 0: 'relief' };

/** WebGPU counts as available only if an adapter resolves — the API can exist with none. */
async function probeWebGpu(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.gpu) return false;
  try {
    return (await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })) != null;
  } catch {
    return false;
  }
}

/** Render-to-float is what a WebGL2 ping-pong stencil needs; half-float-only igpus fail here. */
function probeFloatRenderTargets(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    const ok = gl.getExtension('EXT_color_buffer_float') != null;
    (gl.getExtension('WEBGL_lose_context') as { loseContext?: () => void } | null)?.loseContext?.();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Pure tier -> workload decision, split from I/O so it is trivially checkable
 * (see assertCapsLogic). GPU compute is gated on tier 2 on purpose: render-quality
 * already demotes software renderers and old igpus to tier 0/1, and on those a
 * shared-memory ping-pong + readback is routinely slower than the CPU loop it
 * would replace. So GPU is an opt-in accelerator for hardware that already earned
 * full fidelity — never the floor.
 */
export function resolveHeatCaps(
  tier: RenderTier,
  animate: boolean,
  caps: SimCapabilities,
  gpuLabel: string,
): HeatCaps {
  const backend: SimBackend = !animate
    ? 'ts' // one static frame — no point spinning up a GPU context
    // The shipped GPU solver is WebGL2 ping-pong. WebGPU is useful diagnostic
    // evidence, but cannot select an implementation that does not exist yet.
    : tier === 2 && caps.floatRenderTargets
      ? 'gpu'
      : 'ts'; // universal CPU floor; sim-wasm.ts swaps in here later, same ABI
  return {
    tier,
    backend,
    grid: 192,
    mode: TIER_MODE[tier],
    animate,
    webgpu: caps.webgpu,
    floatRenderTargets: caps.floatRenderTargets,
    gpuLabel,
  };
}

/**
 * Detect once on the main thread; hand the result to the sim worker. The two
 * render-quality helpers are pulled in dynamically so this module has no static
 * runtime deps — that is what lets assertCapsLogic run in isolation under Node.
 */
export async function detectHeatCaps(): Promise<HeatCaps> {
  const [{ getRenderQuality }, { motionOK }] = await Promise.all([
    import('../../utils/render-quality'),
    import('../../utils/motion'),
  ]);
  const quality = getRenderQuality();
  const animate = typeof window === 'undefined' ? true : motionOK();
  const webgpu = await probeWebGpu();
  const floatRenderTargets = probeFloatRenderTargets();
  return resolveHeatCaps(quality.tier, animate, { webgpu, floatRenderTargets }, quality.gpuLabel);
}

/**
 * Runnable check for the pure decision logic. Called from tests/unit — a
 * self-check nothing executes is a self-check that rots, and this one did:
 * the shipped solver was narrowed to WebGL2 float render targets while the
 * fixture below still called a WebGPU-only device a GPU device, so the module
 * asserted its own opposite (`assertCapsLogic FAIL: caps: tier 2 + gpu path ->
 * gpu`) and no gate noticed.
 *
 * Also runnable directly (Node 24 strips the types):
 *   node --experimental-strip-types -e "import('./caps.ts').then(m => m.assertCapsLogic())"
 * Unused in the browser, so it tree-shakes out of the production bundle.
 */
export function assertCapsLogic(): void {
  const none: SimCapabilities = { webgpu: false, floatRenderTargets: false };
  /** The one executable GPU path: WebGL2 render-to-float. */
  const gpu: SimCapabilities = { webgpu: false, floatRenderTargets: true };
  /** An adapter with no shipped solver behind it — evidence, not a backend. */
  const webgpuOnly: SimCapabilities = { webgpu: true, floatRenderTargets: false };
  const assert = (ok: boolean, msg: string) => {
    if (!ok) throw new Error(`caps: ${msg}`);
  };

  // capability may alter the backend, never the calibrated analytical grid
  assert(resolveHeatCaps(2, true, none, '').grid === 192, 'tier 2 keeps canonical grid');
  assert(resolveHeatCaps(1, true, none, '').grid === 192, 'tier 1 keeps canonical grid');
  assert(resolveHeatCaps(0, true, none, '').grid === 192, 'tier 0 keeps canonical grid');
  // GPU only on the full tier AND only with a real GPU compute path
  assert(resolveHeatCaps(2, true, gpu, '').backend === 'gpu', 'tier 2 + gpu path -> gpu');
  assert(resolveHeatCaps(2, true, none, '').backend === 'ts', 'tier 2 no path -> ts');
  assert(resolveHeatCaps(1, true, gpu, '').backend === 'ts', 'tier 1 never gpu');
  // WebGPU alone cannot select an implementation that does not exist yet
  assert(resolveHeatCaps(2, true, webgpuOnly, '').backend === 'ts', 'webgpu without float RTs -> ts');
  assert(resolveHeatCaps(2, true, webgpuOnly, '').webgpu, 'webgpu is still reported as evidence');
  // reduced motion never animates and never spins up the GPU
  const rm = resolveHeatCaps(2, false, gpu, '');
  assert(!rm.animate && rm.backend === 'ts', 'reduced-motion -> static ts');
  // potato defaults to the cheap 2D view
  assert(resolveHeatCaps(0, true, none, '').mode === 'isotherm', 'tier 0 -> isotherm');
  assert(resolveHeatCaps(2, true, none, '').mode === 'relief', 'tier 2 -> relief');
}
