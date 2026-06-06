# Tamed Liquid-Metal Vortex Backdrop — Design

**Date:** 2026-06-07
**Status:** Approved (design); pending spec review
**Topic:** A subtle, on-brand animated WebGL "liquid-metal vortex" backdrop behind three key sections.

## Goal

Add a **tamed, lowly-visible** version of the 21st.dev "Liquid Metal Vortex" raymarched WebGL
shader as an ambient background behind the **Hero**, **CtaClose**, and **Medni** sections of the
Delta Climate Research site — present and premium, but never competing with the editorial type.

## Origin & Decisions

- Source component: 21st.dev "Liquid Metal Vortex" — a raw-WebGL raymarched twisting cylinder with
  simplex-noise surface displacement and a fresnel metallic look (originally rainbow hue-cycling,
  mouse-driven camera rotation, full-screen `fixed` centerpiece).
- Proven in `previews/vortex.html` (raw WebGL, control panel). User picked **variant b
  (visible-right)** for the starting look and **all three sections** (Hero, CtaClose, Medni).
- **Why raw WebGL over the earlier Pixi route:** the shader is self-contained — it needs only a
  `<canvas>` + our existing React island runtime. **Zero new dependencies** (vs. adding PixiJS).

### Taming changes vs. the original (all already validated in the preview)
1. **Lock to teal** — `hue≈186`, `sat≈0.45`; remove the rainbow hue-cycling interval entirely.
2. **Calm auto-drift** — replace mouse-driven camera rotation with a slow time-based drift
   (`sin/cos(iTime*~0.08)`); keep an optional faint mouse-parallax term (default off / very low).
3. **Off-center column** — `offsetX≈0.55` pushes the twisting column into the right third so it sits
   *beside* the headline, not under it.
4. **Dark fog → transparent black** — strong fog to black, and output **alpha follows luminance**
   (`a = clamp(maxChannel*1.6, 0, 1)`) so black regions are fully transparent. The section's
   `bg-base` + grain show through; only the metallic column reads. Canvas uses `alpha:true`,
   `premultipliedAlpha:false`, and `SRC_ALPHA, ONE_MINUS_SRC_ALPHA` blending.
5. **Cool metallic reflection** — reflection tint is a cool grey→teal mix (not pure white) so
   highlights stay on-palette.

## Architecture

### New component: `src/components/VortexShader.tsx`

A typed (TypeScript) React island, generalizing the existing `WarpShader.tsx` pattern. Raw WebGL —
no external shader library. One responsibility: render the tamed vortex into a full-bleed canvas,
cheaply, and stop work when not needed.

**Props** (with variant-b defaults):

| Prop | Default | Meaning |
| --- | --- | --- |
| `hue` | `186` | base teal hue (degrees) |
| `sat` | `0.45` | color saturation |
| `bright` | `0.95` | overall brightness multiplier |
| `complexity` | `1.0` | surface noise amount |
| `speed` | `0.35` | flow speed (0 under reduced-motion) |
| `twist` | `5.0` | vortex twist strength |
| `offsetX` | `0.55` | horizontal column offset (−1…1; + = right) |
| `zoom` | `0.95` | camera zoom |
| `fog` | `0.11` | darkness falloff (higher = darker/fainter) |
| `mouse` | `0.0` | mouse-parallax influence (0 = off) |
| `renderScale` | `0.6` | internal backing-store scale (perf) |

**Behavior:**
- Compile the vertex + fragment shaders once (`useEffect` setup), full-screen quad, cache uniform
  locations. The fragment shader is the tamed shader from `previews/vortex.html` (locked teal,
  auto-drift, off-center, luminance-alpha, 64 raymarch steps).
- **Reduced-motion** (`prefers-reduced-motion: reduce`): render exactly **one** frame, then do not
  schedule `requestAnimationFrame`. The vortex appears as a still image (no animation, no battery
  cost). If WebGL context is unavailable, render nothing — the CSS fallback gradient shows.
- **Cleanup:** on unmount, cancel the rAF, delete program/shaders/buffer, drop listeners. Handle
  `webglcontextlost` (preventDefault + stop loop) and `webglcontextrestored` (re-init) so Astro
  view-transition re-hydration and GPU context loss don't leave a dead canvas.

### Performance gates (load-bearing — raymarching × 3 sections)

- **`client:visible`** — islands hydrate lazily only when scrolled near.
- **IntersectionObserver gate** — the rAF loop runs **only while the section is on-screen**
  (`rootMargin` a little generous, e.g. `200px`); scrolling away pauses the loop, returning resumes
  it. Bounds active GPU work to ~the single section in view.
- **`renderScale` 0.6** — backing store rendered at 60% of CSS size, CSS-scaled to fill (raymarch
  cost ∝ pixel count; the soft dark backdrop hides the downscale).
- **DPR cap 1.5** — `min(1.5, devicePixelRatio)`.
- **64 raymarch steps** — down from the demo's 100.
- **`visibilitychange`** — hidden tab pauses the loop.

### Mount pattern (per section)

A `z-0` background layer behind the existing grain (`z-1`) and content (`z-[2]`):

```html
<div class="vortex-bg" aria-hidden="true">
  <VortexShader client:visible offsetX={0.55} ... />
</div>
```

```css
.vortex-bg {
  position: absolute; inset: 0; z-index: 0; pointer-events: none;
  opacity: 0.85;
  /* CSS fallback gradient: shows pre-hydration / no-JS / reduced-motion-no-webgl */
  background: radial-gradient(60% 80% at 78% 50%, rgb(111 202 214 / 0.10), transparent 60%), var(--color-base, #050606);
}
.vortex-bg :global(canvas) { width: 100% !important; height: 100% !important; display: block; }
```

**Per-section markup changes:**
- **Hero** (`src/components/Hero.astro`): already `relative min-h-dvh overflow-hidden`; content
  already `z-[2]`, grain `z-1`. Insert `.vortex-bg` as the first child (z-0). Tuning: `offsetX 0.55`,
  `opacity 0.85`.
- **CtaClose** (`src/components/CtaClose.astro`): wrapper is `section divider-top relative
  text-center` — add `overflow-hidden`; bump content `.wrap` to `relative z-[1]`. Insert `.vortex-bg`
  at z-0. Centered text → column to the right edge: `offsetX 0.7`, fainter `opacity 0.6`.
- **Medni** (`src/components/Medni.astro`): wrapper is `section divider-top` — add `relative
  overflow-hidden`; bump both `.wrap` blocks to `relative z-[1]` so the dashboard stays above the
  canvas. The dashboard is a strong element, so keep the vortex faint and far right: `offsetX 0.78`,
  higher `fog 0.16`, `opacity 0.5`.

> Per-section `offsetX`/`opacity`/`fog` are **starting points**; final values are tuned on the real
> site via headless screenshots during implementation (the preview's control panel maps 1:1 to these
> props).

## Files

- **Create** `src/components/VortexShader.tsx` — the island (raw WebGL, typed, perf-gated,
  reduced-motion-safe).
- **Modify** `src/components/Hero.astro` — add `.vortex-bg` z-0 layer + fallback CSS.
- **Modify** `src/components/CtaClose.astro` — add `overflow-hidden`, `.wrap`→`relative z-[1]`,
  `.vortex-bg` layer.
- **Modify** `src/components/Medni.astro` — add `relative overflow-hidden`, `.wrap`→`relative z-[1]`,
  `.vortex-bg` layer.
- **No change** to `astro.config.mjs` (React already wired), `package.json` (no new deps), or the
  scroll/reveal system.

## Reuse (don't reinvent)

- `WarpShader.tsx` — the island + reduced-motion-`null` pattern to generalize.
- Footer `.shader` container recipe — fallback gradient + `canvas` sizing.
- Hero `.grain` overlay — kept on top of the vortex for texture/softening.
- `@theme` tokens `--color-base` / `--color-cyan` for palette + fallback gradient.
- `previews/vortex.html` — the proven, tuned shader source and the prop⇄slider mapping.

## Verification

- `npm run check && npm run build` green.
- Headless screenshots of all three sections: vortex **present but subtle**, text **fully legible**.
- **Reduced-motion** (DevTools emulate): a **static** vortex frame (no animation); nothing breaks;
  if WebGL unavailable, fallback gradient shows.
- **Perf gate:** scroll the page; confirm only the **in-view** section's rAF loop is active
  (off-screen sections paused by the IntersectionObserver) — not three loops at once.
- **View transitions:** `/` ↔ `/white-papers` and back; islands re-hydrate, no leaked contexts.
- **Mobile:** full-bleed, no horizontal overflow, still subtle.

## Out of Scope

- Mouse-interactive camera (default off).
- Rainbow hue-cycling (removed).
- A global / every-section backdrop (only the three chosen sections).
- Replacing the grain or any existing animation system.
- Adding PixiJS or any new dependency.

## Rerun / Next

After the backdrop ships, the user will send further "bit by bit" instructions.
```
workflow: brainstorming → writing-plans → subagent-driven-development
source_component: 21st.dev "Liquid Metal Vortex" (raw WebGL)
preview: previews/vortex.html
output: docs/superpowers/specs/2026-06-07-vortex-backdrop-design.md
```
