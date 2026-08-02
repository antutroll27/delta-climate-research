# Delta Climate Research — Render Performance Fix Spec

**Purpose:** Hand this file to Claude Code in the site repo. It contains drop-in TypeScript modules plus exact integration instructions to fix the Optimus/iGPU routing, high-refresh-rate frame budget, and ANGLE shader-compile stalls identified in the 2026-07-16 audit.

**Symptom being fixed:** Smooth on Mac Studio (single large GPU, 60Hz), lag + intermittent glitches on 2019 Acer Predator Helios (RTX 2060 + Intel UHD 630 Optimus, 144Hz panel, Windows/ANGLE-D3D11).

**Root causes (confirmed by bundle inspection):**
1. 4 WebGL contexts; only HeroRiver requests `powerPreference: "high-performance"` → other 3 default to the Intel iGPU on Optimus laptops.
2. Quality tiering reads `deviceMemory`/`hardwareConcurrency` only → a 16GB/12-thread laptop gets **high tier** (dpr 1.6 + bloom + 12-octave noise) even when the active GPU is a UHD 630. No `WEBGL_debug_renderer_info` check exists anywhere.
3. No fps cap or delta clamp → `gsap.ticker` + rAF loops run at 144Hz on the Helios panel (6.9ms budget vs 16.6ms on the Mac's 60Hz display).
4. WarpShader uses **uncapped** `devicePixelRatio` (`Math.max(1, dpr)`); Windows 125–150% scaling inflates its pixel load. Every other surface caps DPR.
5. VortexShader: 64-iteration fragment loop on a webgl1 context with `antialias: true` — MSAA is wasted on a full-viewport fragment effect.
6. "Occasional glitches" = ANGLE GLSL→HLSL→D3D11 shader compilation stalls on first render of each program. Fix by precompiling during the existing site loader with `KHR_parallel_shader_compile`.

---

## Verification step (do FIRST, on the Helios, before merging)

1. `chrome://gpu` → note which GPU is active ("GL_RENDERER" / "ANGLE (Intel..." vs "ANGLE (NVIDIA...").
2. DevTools → Performance → record while scrolling the homepage. Long frames GPU-bound (green) vs scripting (yellow)?
3. Windows Settings → Display → Graphics → add Chrome → force "High performance" → reload site.
   - If lag vanishes: Optimus routing confirmed → Modules 1 & 2 + the `powerPreference` patches are the primary fix.
   - If lag persists: 144Hz budget + shader cost dominate → Module 3 (frame governor) matters most.

---

## Module 1 — `src/lib/render/gpu-tier.ts`

GPU-string detection + static classification. Zero dependencies. Runs synchronously at boot using a throwaway context.

```ts
// src/lib/render/gpu-tier.ts
// GPU-aware quality classification. Complements (does not replace) the
// existing deviceMemory/hardwareConcurrency/saveData gating — take the
// MINIMUM of the CPU-derived tier and the GPU-derived tier.

export type RenderTier = 0 | 1 | 2; // 0 = low, 1 = medium, 2 = high

export interface TierProfile {
  tier: RenderTier;
  dpr: number;            // pixel ratio ceiling for ALL surfaces (incl. Warp)
  bloom: boolean;
  heroOctaves: number;    // uniform: replaces the hardcoded 12-octave loop bound
  vortexIterations: number; // uniform: replaces the hardcoded 64-iter loop bound
  targetFps: 60 | 30;
  gpuLabel: string;       // for analytics/debug overlay
}

const PROFILES: Record<RenderTier, Omit<TierProfile, "gpuLabel">> = {
  2: { tier: 2, dpr: 1.6,  bloom: true,  heroOctaves: 12, vortexIterations: 64, targetFps: 60 },
  1: { tier: 1, dpr: 1.25, bloom: false, heroOctaves: 8,  vortexIterations: 40, targetFps: 60 },
  0: { tier: 0, dpr: 1.0,  bloom: false, heroOctaves: 6,  vortexIterations: 24, targetFps: 60 },
};

// Weak/integrated/software renderers → force low tier.
const LOW_GPU = /(swiftshader|software|llvmpipe|virtualbox|microsoft basic|intel(r)? (uhd|hd) graphics|iris(?! xe max)|mali-[gt][0-7]|adreno [1-5]|powervr)/i;

// Mid-range: capable but not worth bloom + full octaves at high DPR.
const MID_GPU = /(iris xe|mx[1-5][0-9]{2}|gtx 9|gtx 10[5-6]|radeon vega|adreno 6|apple gpu.*(a1[0-3]\b))/i;

/** Read the unmasked renderer string via a throwaway context. ~1–3ms. */
export function readGpuLabel(): string {
  try {
    const canvas = document.createElement("canvas");
    // high-performance hint so Optimus reports the GPU we'd actually want
    const gl =
      canvas.getContext("webgl2", { powerPreference: "high-performance" }) ??
      canvas.getContext("webgl",  { powerPreference: "high-performance" });
    if (!gl) return "no-webgl";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const label = ext
      ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER)); // may be masked; still useful
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return label;
  } catch {
    return "gpu-detect-error";
  }
}

export function classifyGpu(label: string): RenderTier {
  if (label === "no-webgl" || LOW_GPU.test(label)) return 0;
  if (MID_GPU.test(label)) return 1;
  return 2;
}

/**
 * Combine with the EXISTING CPU-derived tier (keep that logic as-is).
 * Example: cpuTier from deviceMemory/hardwareConcurrency/saveData checks.
 */
export function resolveTier(cpuTier: RenderTier): TierProfile {
  const gpuLabel = readGpuLabel();
  const gpuTier = classifyGpu(gpuLabel);
  const tier = Math.min(cpuTier, gpuTier) as RenderTier;
  return { ...PROFILES[tier], gpuLabel };
}
```

**Note on masked renderer strings:** some browsers return a generic label ("ANGLE (Google, Vulkan...)" or masked). That's why Module 2 exists — the runtime governor catches whatever string-matching misses. String detection is the fast path; frame-time feedback is the truth.

---

## Module 2 — `src/lib/render/adaptive-governor.ts`

Runtime frame-time feedback. Samples real frame times after boot; if the p75 exceeds budget, steps the tier down live. This fixes hardware never seen in testing — which is the actual failure mode that shipped.

```ts
// src/lib/render/adaptive-governor.ts
import type { RenderTier, TierProfile } from "./gpu-tier";

export interface GovernorOptions {
  sampleFrames?: number;     // frames per evaluation window (default 90)
  settleFrames?: number;     // frames to ignore after boot/tier-change (default 30)
  budgetMs?: number;         // target frame budget (default 17ms ≈ 60fps + headroom)
  maxStepDowns?: number;     // never demote more than this many times (default 2)
  onTierChange: (tier: RenderTier) => void; // apply new profile to all surfaces
}

export class AdaptiveGovernor {
  private samples: number[] = [];
  private skip: number;
  private stepDowns = 0;
  private lastT = 0;
  private tier: RenderTier;
  private readonly opts: Required<GovernorOptions>;

  constructor(initialTier: RenderTier, opts: GovernorOptions) {
    this.tier = initialTier;
    this.opts = {
      sampleFrames: 90,
      settleFrames: 30,
      budgetMs: 17,
      maxStepDowns: 2,
      ...opts,
    };
    this.skip = this.opts.settleFrames;
  }

  /** Call once per rendered frame with performance.now(). Cheap. */
  frame(now: number): void {
    if (this.lastT === 0) { this.lastT = now; return; }
    const dt = now - this.lastT;
    this.lastT = now;

    if (this.skip > 0) { this.skip--; return; }
    if (dt > 250) return; // tab was backgrounded; not a real frame

    this.samples.push(dt);
    if (this.samples.length < this.opts.sampleFrames) return;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    this.samples.length = 0;

    if (
      p75 > this.opts.budgetMs &&
      this.tier > 0 &&
      this.stepDowns < this.opts.maxStepDowns
    ) {
      this.tier = (this.tier - 1) as RenderTier;
      this.stepDowns++;
      this.skip = this.opts.settleFrames; // let the new tier settle
      this.opts.onTierChange(this.tier);
    }
  }
}
```

**`onTierChange` must apply the new profile live:** call `renderer.setPixelRatio(profile.dpr)` on every surface, set the `uOctaves`/`uIterations` uniforms, disable the bloom pass, and resize Warp's framebuffer. No reloads, no scene teardown.

---

## Module 3 — `src/lib/render/frame-governor.ts`

FPS cap + delta clamp. Fixes the 144Hz panel problem. One instance shared by all loops, or one per loop — either works.

```ts
// src/lib/render/frame-governor.ts
export class FrameGovernor {
  private minFrameMs: number;
  private last = 0;
  private static readonly MAX_DELTA_S = 1 / 20; // clamp: never step sim > 50ms

  constructor(targetFps: 60 | 30 = 60) {
    // 0.5ms under the exact interval so we don't skip legitimate vsync frames
    this.minFrameMs = 1000 / targetFps - 0.5;
  }

  setTarget(fps: 60 | 30): void {
    this.minFrameMs = 1000 / fps - 0.5;
  }

  /**
   * Returns clamped delta (seconds) if this frame should render, else null.
   * Usage in any rAF/gsap.ticker callback:
   *   const dt = governor.shouldRender(performance.now());
   *   if (dt === null) return;
   *   uniforms.uTime.value += dt; renderer.render(scene, camera);
   */
  shouldRender(now: number): number | null {
    const elapsed = now - this.last;
    if (elapsed < this.minFrameMs) return null;
    this.last = now - (elapsed % this.minFrameMs); // keep cadence stable
    return Math.min(elapsed / 1000, FrameGovernor.MAX_DELTA_S);
  }
}
```

Apply inside: HeroRiver's `gsap.ticker.add` callback, WarpShader's rAF loop, VortexShader's rAF loop, and the Base renderer's loop. **Do not** use `gsap.ticker.fps(60)` globally — it would throttle ScrollTrigger scrub smoothness too; gate only the WebGL `.render()` calls.

---

## Module 4 — `src/lib/render/shader-warmup.ts`

Precompile all shader programs during the existing site loader ("Preparing local diagnostics"), turning the theatre into real work. Kills the ANGLE first-render stalls AND fixes the loader's LCP damage: dismiss the loader when warmup resolves instead of running a scripted percentage.

```ts
// src/lib/render/shader-warmup.ts
import type { WebGLRenderer, Scene, Camera } from "three";

/**
 * THREE surfaces (Base renderer + HeroRiver):
 * renderer.compileAsync uses KHR_parallel_shader_compile internally
 * (three >= r152). Falls back to sync compile() on older builds.
 */
export async function warmupThree(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
): Promise<void> {
  const r = renderer as WebGLRenderer & {
    compileAsync?: (s: Scene, c: Camera) => Promise<unknown>;
  };
  if (typeof r.compileAsync === "function") {
    await r.compileAsync(scene, camera);
  } else {
    renderer.compile(scene, camera);
  }
  // Bloom/EffectComposer passes compile lazily — force one offscreen render:
  // composer.render(0.016) here if a composer exists for this surface.
}

/**
 * Raw contexts (WarpShader webgl2, VortexShader webgl1):
 * compile + link without blocking, then poll COMPLETION_STATUS_KHR.
 */
export function warmupRawProgram(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
): Promise<WebGLProgram> {
  return new Promise((resolve, reject) => {
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(vs, vertSrc); gl.compileShader(vs);
    gl.shaderSource(fs, fragSrc); gl.compileShader(fs);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    const ext = gl.getExtension("KHR_parallel_shader_compile");
    const check = () => {
      const done = ext
        ? gl.getProgramParameter(prog, ext.COMPLETION_STATUS_KHR)
        : true; // no extension → link already blocked synchronously
      if (!done) { requestAnimationFrame(check); return; }
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        reject(new Error(gl.getProgramInfoLog(prog) ?? "link failed"));
      } else {
        resolve(prog);
      }
    };
    check();
  });
}

/** Loader integration: dismiss when real work finishes, hard cap at 2.5s. */
export async function warmupAll(jobs: Array<Promise<unknown>>): Promise<void> {
  const cap = new Promise<void>((res) => setTimeout(res, 2500));
  await Promise.race([Promise.allSettled(jobs), cap]);
}
```

**Loader rewrite:** replace the scripted 0→100% animation with progress driven by `Promise.allSettled` job completion (fonts ready via `document.fonts.ready`, each warmup job = one increment). Dismiss immediately on completion. Fast machines see ~300–600ms; the Helios trades its mid-scroll freezes for loader time. Keep the existing sessionStorage + reduced-motion + `pathname === "/"` gates exactly as they are — they're correct.

---

## One-line patches (do these regardless)

| # | File / surface | Change |
|---|---|---|
| P1 | Base layout Three renderer | Add `powerPreference: "high-performance"` to `WebGLRenderer({...})` |
| P2 | VortexShader | `getContext("webgl", { antialias: false, alpha: true, premultipliedAlpha: false, powerPreference: "high-performance" })` — antialias OFF (full-viewport fragment effect; MSAA is pure waste) |
| P3 | WarpShader | Add `powerPreference: "high-performance"` to its context attrs |
| P4 | WarpShader `handleResize` | Replace `Math.max(1, window.devicePixelRatio)` with `Math.min(profile.dpr, window.devicePixelRatio \|\| 1)` — cap it like every other surface |
| P5 | HeroRiver + Vortex fragment shaders | Convert hardcoded loop bounds (12, 64) to uniforms with a compile-time MAX: `for (int i = 0; i < MAX_OCT; i++) { if (i >= uOctaves) break; ... }` so tiers/governor can adjust live |
| P6 | Vortex render target | Render at half resolution into an FBO and upscale — invisible through the motion, ~4× fill-rate saving |

---

## Wiring order (for Claude Code)

1. Apply patches P1–P4 (safe, independent, shippable immediately).
2. Add Module 1; call `resolveTier(existingCpuTier)` where the current tier table (`Te[t]` in the built output — find its source) is selected. Take `Math.min` of both signals.
3. Apply P5, then wire `TierProfile.heroOctaves` / `vortexIterations` / `dpr` / `bloom` into each surface.
4. Add Module 3; gate every `.render()` call in all four loops.
5. Add Module 2; call `governor.frame(performance.now())` once per rendered frame from the hero loop (the busiest surface); `onTierChange` re-applies the profile everywhere.
6. Add Module 4 + loader rewrite last (touches UX; test reduced-motion and revisit paths).
7. P6 (Vortex half-res FBO) — optional polish, do after everything above is verified.

## Acceptance criteria

- `chrome://gpu` irrelevant: site holds 60fps on the Helios **on the iGPU** at tier 0/1.
- No visible hitch on first scroll into Warp/Vortex sections on Windows (compile stalls gone).
- Loader on a fast machine dismisses in under ~800ms on first visit.
- Mac Studio output visually unchanged at tier 2.
- Lighthouse mobile: TBT unchanged or better (governor adds ~0 cost); LCP improves from loader change.

## Test matrix

| Device | Display | Expected tier | Check |
|---|---|---|---|
| Mac Studio | 60Hz large | 2 | Visual parity with current prod |
| Helios, iGPU forced | 144Hz | 0 (string or governor) | Smooth scroll, no glitches |
| Helios, dGPU forced | 144Hz | 2, fps capped 60 | Smooth; GPU util sane |
| Mid Android (real device) | 60–120Hz | 0–1 | Smooth, battery acceptable |
| Any, `prefers-reduced-motion` | — | n/a | Loader skipped, statics only (existing behaviour preserved) |
