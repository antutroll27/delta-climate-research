# Can the app go "fully native Tailwind"? — In-depth audit & answer

**Date:** 2026-06-03
**Question:** We're using arbitrary-value utilities (`text-[0.6875rem]`) and `@theme` tokens, not
Tailwind's native scale classes. Setting aside animation/GSAP, can we migrate fully to Tailwind?

## Short answer

**The site is already 100% Tailwind utility-first** — there is essentially no hand-written layout
CSS left except the animation/gradient/state code you've excluded. What you're reacting to is
**arbitrary-value brackets** (`[...]`), which *are* valid, idiomatic Tailwind — but they read as
"not native."

So the real question splits in two:

1. **"Use Tailwind's default scale classes (`text-sm`, `gap-5`, `rounded-lg`) everywhere"** →
   **Not possible without changing the design.** The brand uses a bespoke scale that doesn't line
   up with Tailwind's defaults, and the native type classes inject line-heights that break the layout.
2. **"Go fully idiomatic Tailwind — kill the `[...]` brackets, one design-token system"** →
   **Yes, fully feasible and pixel-identical**, by promoting the bespoke values into `@theme` as
   named tokens. This is the correct "migrate fully to Tailwind" path.

## Evidence (the audit)

~100 arbitrary-value utilities across 8 components, ~42 `@theme`-token utilities. Classifying every
distinct arbitrary value against Tailwind's default scale:

| Category | Distinct | Map to a native class? |
| --- | --- | --- |
| Font size | 9 | **0 usable.** 3 (`0.75/0.875/1.25rem`) have native names (`text-xs/sm/xl`) **but each injects a `line-height`** the original font-size-only CSS lacked → confirmed 2px mobile regression. The other 6 (`0.6875/0.78/0.8125/0.9375/1.0625/1.1rem`) have **no scale step at all**. |
| Spacing | 22 | ~12 map (`1.25rem→gap-5`, `1.5→6`, `2.5→10`); ~10 are **off-grid** (`0.3/0.55/0.6/0.9/1.1/1.4/0.85rem`) with no native step. |
| Letter-spacing | 8 | 1 maps (`0.1em→tracking-widest`); 7 bespoke (`-0.01/0.06/0.14/0.22em`). |
| Line-height | 5 | 1 maps (`1.5→leading-normal`); 4 bespoke (`1.04/1.05/1.55/1.6`). |
| Radius | 2 | 1 maps (`12px→rounded-xl`); `14px` has no native step (between `xl`=12 and `2xl`=16). |

**~50% of all arbitrary values are off-grid** — they sit between Tailwind's default steps. Converting
them to native classes means **snapping to the nearest step = pixel shifts on essentially every
element** — a redesign, not a refactor. And the type scale is independently blocked by line-height.

### Remaining scoped CSS (the part you said to set aside) — confirmed non-convertible
Per-component `<style>` after the earlier migration is ~90% legitimately-not-a-utility:
- **Animation:** `@keyframes rise`/`blink`, `.word` entrance, `.cursor::after`, `.draw-line`,
  `.nav-progress` (scroll system).
- **Decoration:** the grain SVG data-URI, all gradients, `mix-blend-mode`, `backdrop-filter`,
  `.map-grid`, `.cover`, `.about-visual`/`.visual-bg` clip layers.
- **State selectors utilities can't (cleanly) express:** `.menu-toggle[aria-expanded='true'] span`,
  `.mobile-menu[data-open='true']`, and the **sibling focus-pull** `.feed:hover .row-link` /
  `.feed .row-link:hover` (dim siblings on hover — not expressible as utilities).
A handful of simple `:hover` color changes *could* become `hover:` utilities, but several depend on
parent/sibling combinators (`group-hover`, sibling dimming) that are awkward or impossible.

## The recommended path: extend `@theme`, drop the brackets (pixel-identical)

Tailwind v4 is *designed* to carry a bespoke design system via `@theme`. Promote the bespoke values
into named tokens, then the markup uses clean utilities with **zero `[...]` and zero pixel change**:

```css
@theme {
  /* type (font-size only — no line-height, so the regression can't happen) */
  --text-tag: 0.6875rem;   --text-meta: 0.8125rem;   --text-cardtitle: 1.25rem;
  --text-body-sm: 0.875rem; /* …the ~9 sizes… */
  /* spacing */
  --spacing-cardpad: 1.25rem; --spacing-tight: 0.6rem; /* …the off-grid steps… */
  /* radius + tracking */
  --radius-card: 14px;  --tracking-kicker: 0.22em;  --tracking-mono: 0.1em;
}
```

```diff
- <span class="text-[0.6875rem] tracking-[0.1em] rounded-[14px] px-[1.25rem]">
+ <span class="text-tag tracking-mono rounded-card px-cardpad">
```

- **Outcome:** every `[...]` bracket disappears; one centralized token system; markup reads
  idiomatically; the rendered site is **byte-for-byte identical** (verifiable with the same
  screenshot-diff harness from the last migration).
- **Scope:** define ~25–30 tokens, then mechanical swap across 8 components + remove the now-redundant
  arbitrary values. The animation/state CSS stays exactly as-is.
- **Honest caveat:** this is a **code-quality / DRY** improvement (consistency, maintainability,
  bracket-free markup). It does **not** change the live site or its performance at all. Worth doing if
  you value an idiomatic, centralized design-token system; skip it if "valid Tailwind that happens to
  use brackets" is acceptable.

## Verdict
- "Fully native **default-scale** Tailwind": **no** — the bespoke design doesn't fit Tailwind's grid
  and the native type classes would shift the layout.
- "Fully **idiomatic** Tailwind with **no arbitrary values**": **yes** — via `@theme` tokens,
  pixel-identical. This is the path I'd recommend if you want to eliminate the brackets.
