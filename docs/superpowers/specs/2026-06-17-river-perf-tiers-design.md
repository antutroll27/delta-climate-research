# River hero — performance tiers + debug strip — design

**Date:** 2026-06-17
**Status:** Approved (design); pending spec review → implementation plan
**Surface:** `previews/hero-river-native.html` (the flow-field water prototype). Built & tested here; carries into the production hero island later.

## Goal
Two changes, shipped together:
1. **Strip the debug hooks** so the file is production-clean.
2. **Add a 3-tier performance ladder** so the hero stays smooth on phones and weak laptops, degrading gracefully without ever shipping the bare single-direction scroll.

## Non-goals (explicitly deferred)
- Static poster fallback for reduced-motion / no-WebGL / context-lost — handled when we wire the production island.
- Wiring into the production React island.
- Geometry decimation (all scan LODs share the same 262K-tri mesh; LOD only changes *texture* weight, and 262K verts is cheap on phones).
- Upgrading a tier at runtime (downgrade-only, to avoid oscillation).

---

## Architecture — two lever classes

The core structural idea: separate levers by whether they can be hot-swapped.

- **Load-time levers** (chosen once, from the initial device hint; cannot be cheaply hot-swapped):
  - **Scan texture LOD** — `river-2k.glb` vs `river-4k.glb`.
  - **Flow-map size** — `river-flow-sm.png` (128×64) vs `river-flow.png` (256×128).
- **Runtime levers** (instantly swappable, no reload; what the FPS-adaptive logic touches):
  - **Pixel ratio** (`renderer.setPixelRatio` + composer/bloom resize).
  - **Bloom** (`bloomPass.enabled`).
  - **Water-shader complexity** via a single `uTier` uniform (coherent branch → cheap on mobile, no recompile).

## The three tiers

| Lever | 0 — full (desktop) | 1 — lite (mobile) | 2 — minimal (weak) |
|---|---|---|---|
| Scan LOD (load) | 4K | 2K | 2K |
| Flow map (load) | 256×128 | 128×64 | 128×64 |
| Pixel ratio | ≤ 1.6 | ≤ 1.25 | ≤ 1.0 |
| Bloom | on | **off** | off |
| Water normals | two-phase **+ rotation** | two-phase, **no rotation** (offset along flow) | two-phase, **global +X** |
| Foam | shore + rapids | **shore only** | **none** |

Every tier keeps the two-phase anti-swimming crossfade.

---

## Components

### 1. `pickInitialTier()` → 0 | 1 | 2
Pure function of cheap hints. Override via `?tier=0|1|2` (dev).
- `coarse = matchMedia('(pointer:coarse)').matches`
- `mem = navigator.deviceMemory ?? 8` (undefined → assume capable)
- `cores = navigator.hardwareConcurrency ?? 8`
- Start `tier = 0`. If `coarse` → `tier = 1`. If `mem <= 2 || cores <= 4` → `tier = 2`.
- Defaulting unknown hints to "capable" avoids over-degrading; the FPS monitor catches real weakness.

### 2. `TIERS[tier]` config table
`{ glb, flow, dpr, bloom, uTier }`. The initial tier picks `glb`/`flow` (load-time). An explicit `?q=2k|4k|8k` still overrides the scan LOD for dev.

### 3. `applyTier(tier)` — runtime levers only
Sets `renderer.setPixelRatio(min(devicePixelRatio, TIERS[tier].dpr))`, resizes composer + bloom, sets `bloomPass.enabled = TIERS[tier].bloom`, sets `UTIER.value = tier`. Never reloads the glb/flow map. Called once at init and again on each FPS downgrade.

### 4. FPS monitor (in the render loop)
Skip the first ~30 frames (load jank), then measure median frame time over the next ~60 frames. If median FPS < 45 and `tier < 2`, `applyTier(++tier)` and restart the measurement window. **Downgrade-only.** A `?fpscap=` dev hook can simulate a low cap to test downgrades headlessly.

### 5. Water-shader `uTier` gates
In `gradeMaterial`'s `onBeforeCompile`:
- `vec2 dirT = (uTier < 1.5) ? gDir : vec2(1.0, 0.0);` — minimal uses global +X.
- Normal block: `if (uTier < 0.5)` rotate the tile (current `mat2` path); `else` unrotated `ruv = gFuv*uScaleN` with the two-phase offset along `-dirT` (no `mat2`, no rotate-back).
- Streaks use `dirT` (cheap dot product) on all tiers.
- Foam: shore foam `if (uTier < 1.5)`; rapids foam (the extra noise tap) `if (uTier < 0.5)`; none on tier 2.

### 6. Bake change — `scripts/bake-river-flow.mjs`
Parameterize grid size; emit both `river-flow.png` (256×128) and `river-flow-sm.png` (128×64). Same algorithm, second smaller output.

### 7. Debug strip (same change)
Remove: the `?t0=` `UTIME` seed; the `gl_FragColor` mask override in the `<dithering_fragment>` injection; the **"Show mask"** button and `uMaskDebug` uniform/plumbing. Keep: tuning sliders + "Flow field" A/B toggle (dev tooling). Add: `?tier=0|1|2` dev override.

---

## Data flow
Load → resolve `?tier` override or `pickInitialTier()` → `TIERS[tier]` → fetch glb (LOD) + flow map (size) → build scene → `applyTier(tier)` (runtime levers) → render loop with FPS monitor → possible downgrade(s) via `applyTier`.

## Error handling
- `deviceMemory` / `hardwareConcurrency` undefined → assume capable (FPS monitor is the safety net).
- `river-flow-sm.png` missing → fall back to `river-flow.png`.
- Reduced-motion → existing single-frame render path (unchanged; poster deferred).

## Verification
- `?tier=0|1|2` forced → screenshot each; confirm lite/minimal water still reads well and compiles without shader errors.
- Log the chosen tier on load to confirm `pickInitialTier` + override.
- `?fpscap=` → confirm the monitor downgrades and `applyTier` swaps DPR/bloom/`uTier` (headless GPU perf is not representative, so real-device FPS is a user spot-check).
- Confirm the debug strip leaves no dangling references (grep `t0`, `uMaskDebug`, `Show mask`).

## Files
- **Modify** `previews/hero-river-native.html` — tier system, FPS monitor, `uTier` shader gates, debug strip, `?tier` hook.
- **Modify** `scripts/bake-river-flow.mjs` — emit the 128×64 variant.
- **Create** `public/textures/river-flow-sm.png` — 128×64 flow map (bake output).
