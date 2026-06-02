# Tailwind Adoption Audit — Conditions to Go Utility-First Throughout

**Date:** 2026-06-02
**Question:** What conditions must we meet to use Tailwind throughout the app?
**Method:** Static inventory of all components + empirical compile tests against the actual build.

## TL;DR

**There are no infrastructure blockers.** Tailwind v4 is already wired correctly and every
capability a full migration needs was verified compiling against this exact setup:
core utilities, `@theme` token→utility mapping, arbitrary values (for the fluid `clamp()`
type), `data-[…]` state variants, and — critically — token utilities emit `var(--color-*)`
so the **runtime light theme keeps working**. "Going Tailwind throughout" is therefore a
*migration-discipline* exercise, not an enablement project. The conditions below are the
things to establish so the migration stays DRY, on-brand, and doesn't break the JS-coupled
scroll/reveal system.

## Current State (what we have)

| Aspect | Finding |
| --- | --- |
| Tailwind | v4.3, run via **`@tailwindcss/postcss`** (PostCSS), not the Vite plugin |
| Config | CSS-first — no `tailwind.config.*`; a `@theme` block in `global.css` defines **27 tokens** (colors + fonts) |
| Styling today | ~100% hand-written **scoped Astro `<style>`** across 8 components (~630 lines); **zero** utility classes in markup |
| Fluid design | **24× `clamp()`** for type/spacing; **85× `var(--…)`** |
| Decorative CSS | 8 gradients, 1 grain SVG data-URI, mix-blend, 2 backdrop-filter, grayscale, aspect-ratio, 2 scroll-snap |
| Motion | 2 `@keyframes` (`rise`, `blink`) + the reveal-system transitions |
| State hooks | 5 `[data-…]` selectors (nav scrolled, mobile open); reveal/scroll JS contracts |

## Empirically Verified (compiled against this build)

| Capability | Test | Result |
| --- | --- | --- |
| Core utilities | `flex gap-4 p-8 rounded-xl font-mono` | ✅ all generated |
| Token→utility mapping | `bg-base text-paper text-cyan bg-surface text-ink-muted` | ✅ all generated |
| Arbitrary values (fluid type) | `text-[clamp(1rem,2vw,2rem)]` | ✅ generated |
| Attribute-state variants | `data-[on=true]:opacity-50` | ✅ generated |
| **Runtime theming** | `.text-cyan` emits `color:var(--color-cyan)` | ✅ light theme (`data-theme`) preserved |
| `.astro` content scanning | utilities in `.astro` pages compiled with no `content`/`@source` config | ✅ auto-detected |

## Conditions to Meet

### Hard constraints (must not violate)
1. **Keep the PostCSS pipeline. Do NOT switch to `@tailwindcss/vite`.** `astro.config.mjs`
   documents a rolldown-vite binding incompatibility in Astro 6; the PostCSS path is the
   deliberate workaround and supports every v4 feature we need.
2. **Preserve the JS-coupled selectors.** The scroll/reveal system queries
   `[data-reveal]`, `[data-reveal-group]`, `[data-clip]`, `[data-parallax]`, `[data-draw]`,
   `[data-progress]`, and toggles `.is-inview` / `.reveal-ready`; `.draw-line` and
   `.nav-progress` are styled overlays it drives. These attributes are **behavior contracts**
   and stay regardless of styling approach. Their stateful CSS (the `opacity:0` hidden state,
   `scaleX(0)`, the clip pre-paint rule) must remain in a retained global layer or be
   re-expressed as `data-[…]:` variants — but the hooks themselves do not move.

### Prerequisites to establish (so the migration is clean, not ugly)
3. **Define a fluid type/space scale in `@theme`.** 24 ad-hoc `clamp()` values would become 24
   verbose `text-[clamp(…)]` arbitrary values. Condition: add reusable tokens
   (e.g. `--text-h1`, `--text-body`, `--space-section`) via `@theme` / `@utility` so components
   use `text-h1` not `text-[clamp(…)]`. This is the biggest DRY risk if skipped.
4. **Port the keyframes + reveal transitions.** Move `rise`/`blink` `@keyframes` into the v4
   `@theme { --animate-* }` convention (or a retained `@layer`), and keep the reveal-system
   transition CSS in a global layer. Tailwind utilities won't express the staggered
   `transition-delay` driven by inline `--i`; that stays as a small global rule.
5. **Pick a policy for complex decorative CSS (hybrid, not dogmatic).** Gradients, the grain
   SVG data-URI, `mix-blend-mode`, `backdrop-filter`, and the Medni map-grid are awkward as
   utilities. Condition: agree that layout/spacing/type/color move to utilities, while these
   specific backgrounds stay as small scoped `<style>` or named `@utility` components. A 100%
   no-CSS rule would force unreadable arbitrary values and is not recommended.
6. **Keep the `@theme` token block as the single source of truth** (already true). Utilities
   and any remaining scoped CSS both read `var(--color-*)`, so brand + light theme stay
   centralized. Do not switch `@theme` to `@theme inline` (that would inline values and break
   `data-theme` switching).

### Optional hardening
7. **Add explicit `@source` directives** if class names ever get constructed in `.ts`/JS
   (auto-detection covers literal class strings in `.astro`, but dynamic concatenation can be
   missed). Today there are none, but the scroll modules are TS — if any future styling moves
   into JS string-building, declare its source.

## Recommendation

Adopt Tailwind **incrementally and hybrid**: layout, spacing, fl/type, and color via utilities
(backed by a `@theme` fluid scale from condition #3); keep the JS-coupled reveal/scroll CSS and
the genuinely-complex decorative backgrounds in a slim global/scoped layer (conditions #2, #5).
No build changes, no dependency changes, no theming regression. The only real work is authoring
the fluid `@theme` scale and then converting components one at a time — each convertible and
verifiable independently.
