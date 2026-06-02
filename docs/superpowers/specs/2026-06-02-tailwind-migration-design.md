# Tailwind Utility-First Migration — Design Spec

**Date:** 2026-06-02
**Status:** Approved for planning
**Audit basis:** [`docs/research/2026-06-02-tailwind-adoption-audit.md`](../../research/2026-06-02-tailwind-adoption-audit.md)

## 1. Goal

Convert the Delta Climate Research site from hand-written scoped Astro `<style>` blocks to
Tailwind v4 utility-first styling, **pixel-identical** to today, while leaving the animation
and JS-coupled systems completely untouched.

The audit verified there are no infrastructure blockers: utilities, `@theme` token→utility
mapping, arbitrary values, `data-[…]` variants, and runtime-theme-safe `var(--color-*)` output
all compile in the current `@tailwindcss/postcss` setup.

## 2. Locked Decisions

| Decision | Choice |
| --- | --- |
| Visual outcome | **Pixel-identical** — pure refactor, zero intentional visual change |
| Style policy | **Hybrid** — utilities for layout/spacing/type/color; complex decoration + JS-coupled CSS stay as CSS |
| Verification | **Screenshot diff** (headless Chrome) baseline → per-component re-capture → pixel diff |
| Order | **Simple → complex**: Footer → CtaClose → WhitePapers → Projects → About → Hero → Medni → Nav |
| Build pipeline | **Unchanged** — keep `@tailwindcss/postcss`; never switch to `@tailwindcss/vite` (Astro 6 rolldown-vite incompatibility) |

## 3. The Untouchable Zone (ZERO edits)

These get no changes of any kind. If converting any rule looks even slightly risky, it stays
CSS by default — the bar is "obviously safe and visually identical," not "technically possible."

- **Scroll-effects system:** `src/scripts/scroll-effects.ts`, `src/scripts/smooth-scroll.ts`,
  and every CSS rule they touch — the `[data-clip]` pre-paint clip rule, `.draw-line`,
  `.nav-progress`, the `[data-reveal]` / `[data-reveal-group]` / `.is-inview` / `.reveal-ready`
  reveal CSS in `global.css`.
- **All `data-*` attributes** in markup (`data-clip`, `data-parallax`, `data-draw`,
  `data-progress`, `data-reveal`, `data-reveal-group`, `data-stagger`, `data-scrolled`,
  `data-open`, `data-navigation-toggle`, `data-mobile-link`) — these are JS contracts and remain
  verbatim on whatever element carries them, regardless of how that element's static styles are
  expressed.
- **Motion:** `@keyframes rise` and `@keyframes blink`, the `.word` entrance animation with its
  inline `--i` delays, the `.cursor::after` blink, and any `transition` tied to these.
- **Complex decoration:** the Hero grain SVG data-URI background, all radial/linear gradients,
  `mix-blend-mode`, `backdrop-filter`, the Medni `.map-grid` gradient grid, `.cover` gradients.

## 4. Foundation Layer (built first, no markup changes)

### 4.1 Fluid scale in `@theme`
Add semantic fluid tokens to `global.css`'s `@theme` block, each equal to the **exact** existing
`clamp()` (no value merging — pixel-identical). v4 auto-generates `text-*` utilities for
`--text-*`; spacing tokens are referenced as `p-(--space-*)` / `gap-(--space-*)` or arbitrary
`[…]` where a utility shorthand doesn't exist.

Type scale (existing → token):
- `clamp(2.5rem, 7vw, 6rem)` → `--text-hero` (Hero h1)
- `clamp(2.6rem, 5.5vw, 4.5rem)` → `--text-section` (global `.sec-title`)
- `clamp(2.2rem, 5.5vw, 4.5rem)` → `--text-cta` (CtaClose title)
- `clamp(2rem, 8vw, 3rem)` → `--text-mobilenav` (mobile menu links)
- `clamp(1.15rem, 2vw, 1.5rem)` → `--text-rowtitle` (White Papers row title)
- `clamp(1rem, 1.6vw, 1.25rem)` → `--text-secindex` (global `.sec-index`)
- `clamp(1rem, 1.4vw, 1.2rem)` → `--text-body` (About body)
- `clamp(1rem, 1.4vw, 1.15rem)` → `--text-cta-body` (CtaClose body)
- `clamp(1rem, 1.3vw, 1.15rem)` → `--text-medni-sub` (Medni sub)
- `clamp(0.95rem, 1.4vw, 1.125rem)` → `--text-lede` (Hero lede)

Space scale (existing → token):
- `clamp(5rem, 12vh, 9rem)` → `--space-section` (global `.section` padding-block)
- `clamp(1rem, 4vw, 2.5rem)` → `--space-gutter` (global `.wrap` / Hero / rail padding-inline)
- `clamp(3rem, 9vh, 6rem)` → `--space-hero-bottom`
- `clamp(2.5rem, 5vw, 4rem)` → `--space-footer` (footer padding-block)
- `clamp(2rem, 5vw, 4rem)` → `--space-about-gap`
- `clamp(2rem, 4vw, 3rem)` → `--space-head-mb` (section header margin-bottom)
- `clamp(1.5rem, 3vw, 2.5rem)` → `--space-papers-head-mb`
- `clamp(1.5rem, 3vw, 2.25rem)` → `--space-row-pad`
- `clamp(1rem, 3vw, 2rem)` → `--space-row-gap`
- `clamp(1rem, 2.5vw, 2rem)` → `--space-footer-gap`
- `clamp(300px, 48vh, 460px)` → `--space-map-h` (Medni map min-height)
- `clamp(2.25rem, 4vw, 3.75rem)` → `--space-nav-gap` (current nav-links gap)

(The implementation plan enumerates the exact 1:1 rule→token replacements; the controller and
screenshot diff catch any transcription error.)

### 4.2 Retained CSS layer
The `@layer base` shared helpers in `global.css` that are NOT pure decoration get evaluated
case-by-case: `.wrap`, `.section`, `.divider-top`, `.sec-index`, `.sec-title`, `.accent-link`
are candidates to become reusable utilities OR stay as-is if they're cleaner shared. The
reveal-system rules and clip pre-paint rule **stay** (untouchable zone). No keyframes move.

## 5. Hybrid Boundary (per element)

- **→ utilities:** `display` (flex/grid/block), `gap`, `padding`/`margin`, `width`/`max-width`,
  `min-height`, `font-family`/`size`/`weight`, `letter-spacing`, `line-height`, `color`,
  `background-color` (solid only), `border`, `border-radius`, `text-transform`, `text-align`,
  `position` (static offsets), simple `:hover` color/opacity/transform via `hover:`.
- **→ stays CSS:** everything in §3, plus any selector that is a descendant/state combinator
  the JS toggles, or any value a utility can't express without an unreadable arbitrary string.

## 6. Migration Unit (per component)

Each of the 8 components + `Base.astro` is one independently-shippable unit:
1. Convert static markup to utility classes.
2. Delete now-redundant scoped CSS rules (only those fully replaced by utilities).
3. Leave untouchable-zone rules in the component's `<style>` (or move to the retained global
   layer if shared) — unchanged.
4. `npm run check` + `npm run build` green.
5. Screenshot-diff that component's section(s) against baseline → must be zero diff.

A component whose `<style>` becomes empty loses its `<style>` block; one that retains
animation/decoration keeps a slimmed `<style>` with only those rules.

## 7. Verification Harness

- A headless-Chrome script (`puppeteer-core` pointed at system Chrome, re-added as a temporary
  devDependency) captures full-page screenshots of `/` and `/white-papers` at desktop
  (1440×900) and mobile (390×844) widths.
- **Baseline** captured from the current `main` build BEFORE any change.
- **Captured under `prefers-reduced-motion: reduce` emulation.** This is deliberate: with
  reduced motion the scroll-effects/reveal systems early-return, so every element rests in its
  static, fully-visible state (no clip, no parallax offset, no opacity-0 reveal hiding). That
  isolates exactly what the migration changes — static layout, spacing, type, color — and makes
  diffs deterministic and stable. (The animations themselves are unchanged by §3, so they need
  no screenshot coverage.)
- After each component: rebuild, re-capture, pixel-compare to baseline. Non-zero diff → stop,
  investigate, fix before proceeding.
- The harness + `puppeteer-core` are removed in the final task once parity is confirmed.

## 8. Out of Scope

- Any visual/spacing/type refinement (explicitly pixel-identical).
- Touching the scroll-effects, reveal, or animation systems.
- Switching the Tailwind build pipeline.
- Converting the `previews/` or `attic/` files.

## 9. Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Clamp transcription error → pixel drift | Screenshot diff per component catches any drift |
| Accidentally breaking a JS-coupled selector | Untouchable zone (§3); data-* hooks never moved |
| Tailwind utility doesn't match exact CSS value | Use arbitrary value `[…]` copied verbatim, or leave as CSS |
| Reveal/clip state regressions | Those rules are never edited; verified by the existing scroll behavior post-migration |
