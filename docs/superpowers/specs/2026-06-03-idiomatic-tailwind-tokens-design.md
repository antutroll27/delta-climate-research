# Idiomatic Tailwind — `@theme` Token Migration Design Spec

**Date:** 2026-06-03
**Status:** Approved for planning
**Audit basis:** [`docs/research/2026-06-03-full-tailwind-feasibility.md`](../../research/2026-06-03-full-tailwind-feasibility.md)

## 1. Goal

Eliminate arbitrary-value brackets (`text-[0.6875rem]`, `gap-[1.25rem]`, `rounded-[14px]`) from
the components by promoting the bespoke design values into **named `@theme` tokens** that generate
real Tailwind utilities (`text-tag`, `mt-3xs`, `rounded-card`). Result: every static style reads as
an idiomatic, bracket-free, native-style utility — **pixel-identical** to today.

## 2. Locked Decisions

| Decision | Choice |
| --- | --- |
| Naming | **Semantic by role** (`--text-tag`, `--radius-card`, `--tracking-kicker`); **t-shirt sizes** for off-grid spacing (`--spacing-3xs`…) since micro-margins have no meaningful "role" name |
| Scope | **Systemic tokens only.** Content one-offs stay arbitrary: prose measures (`max-w-[46ch]`, `max-w-[16ch]`…), `min-h-[100dvh]`, `z-[2]`, `transition-[…]` property lists |
| Pixel parity | **Pixel-identical**, verified by the screenshot-diff harness under reduced-motion (same gate as the Tailwind migration) |
| Namespaces | Use **Tailwind-native namespaces** so tokens generate utilities: `--text-*`, `--spacing-*`, `--radius-*`, `--tracking-*`, `--leading-*`, `--shadow-*`, `--container-*`, `--breakpoint-*`, `--color-*` |
| Untouchable | Animation/GSAP/state CSS unchanged (keyframes, gradients, grain, mix-blend, backdrop-filter, `[aria-expanded]`/`[data-open]` selectors, sibling-hover focus-pull, `.draw-line`, `.nav-progress`, clip/reveal) |

## 3. Conversion buckets (the rule the plan applies)

Each arbitrary utility maps to exactly one bracket-free form:

1. **On-grid spacing → native numeric class** (no token): values that land on Tailwind's 0.25rem
   scale. `gap-[1.25rem]`→`gap-5`, `p-[1rem]`→`p-4`, `mb-[0.5rem]`→`mb-2`, `mr-[0.5rem]`→`mr-2`,
   `mb-[1rem]`→`mb-4`, `mb-[1.25rem]`→`mb-5`, `p-[1.25rem]`→`p-5`, `pt-[1.25rem]`→`pt-5`,
   `px-[1.25rem]`→`px-5`, `gap-[1.5rem]`→`gap-6`, `mt-[1.75rem]`→`mt-7`, `mt-[2.5rem]`→`mt-10`.
2. **Off-grid / line-height-blocked → named `@theme` token utility** (§4).
3. **Fluid clamp already tokenized → existing token utility**: `py-[clamp(1.5rem,3vw,2.25rem)]`
   → `py-rowpad` (the existing `--spacing-rowpad`).
4. **Stays arbitrary** (per scope): `max-w-[Nch]`, `min-h-[100dvh]`, `z-[2]`,
   `transition-[background-color,color,box-shadow]`.

## 4. Token catalog (exact values → tokens)

All appended to the existing `@theme` block in `global.css`.

### 4.1 Type — `--text-*` (font-size ONLY, no line-height → no regression)
| Token | Value | Utility | Replaces |
| --- | --- | --- | --- |
| `--text-tag` | 0.6875rem | `text-tag` | `text-[0.6875rem]` (×5) |
| `--text-label` | 0.75rem | `text-label` | `text-[0.75rem]` |
| `--text-stream` | 0.78rem | `text-stream` | `text-[0.78rem]` |
| `--text-meta` | 0.8125rem | `text-meta` | `text-[0.8125rem]` |
| `--text-body-sm` | 0.875rem | `text-body-sm` | `text-[0.875rem]` |
| `--text-note` | 0.9375rem | `text-note` | `text-[0.9375rem]` |
| `--text-logo` | 1.0625rem | `text-logo` | `text-[1.0625rem]` |
| `--text-arrow` | 1.1rem | `text-arrow` | `text-[1.1rem]` |
| `--text-cardtitle` | 1.25rem | `text-cardtitle` | `text-[1.25rem]` |

_(The 10 existing fluid `--text-*` tokens — hero/section/cta/… — are unchanged; they already
generate utilities.)_

### 4.2 Spacing — migrate existing `--space-*` → `--spacing-*` + add off-grid micro scale
**Migration:** rename the 12 existing fluid tokens `--space-section/gutter/hero-bottom/footer/
about-gap/head-mb/papershead-mb/rowpad/rowgap/footergap/map-h/navgap` → `--spacing-*` (Tailwind's
native spacing namespace), and update their usages from the paren form `py-(--space-section)` to
the generated utility `py-section`. (global.css base classes `.wrap`/`.section` use literal clamps,
not these tokens, so they're unaffected.)

**New off-grid micro tokens** (t-shirt):
| Token | Value | Utility | Replaces |
| --- | --- | --- | --- |
| `--spacing-3xs` | 0.2rem | `mt-3xs` | `mt-[0.2rem]` |
| `--spacing-2xs` | 0.3rem | `gap-2xs` | `gap-[0.3rem]` |
| `--spacing-xs` | 0.55rem | `gap-xs` / `mt-xs` | `[0.55rem]` |
| `--spacing-sm` | 0.6rem | `mt-sm` | `mt-[0.6rem]` |
| `--spacing-md` | 0.85rem | `py-md` | `py-[0.85rem]` |
| `--spacing-lg` | 0.9rem | `mt-lg` | `mt-[0.9rem]` |
| `--spacing-xl` | 1.1rem | `mt-xl` / `py-xl` | `[1.1rem]` |
| `--spacing-2xl` | 1.4rem | `pb-2xl` | `pb-[1.4rem]` |

_Note: on-grid numeric utilities (`gap-5`, `p-4`) coexist with named ones — v4 keeps the numeric
scale and adds named tokens._

### 4.3 Radius — `--radius-*`
| Token | Value | Utility | Replaces |
| --- | --- | --- | --- |
| `--radius-card` | 14px | `rounded-card` | `rounded-[14px]` |

_(`rounded-[12px]`→`rounded-xl` native; `rounded-[8px]`→`rounded-lg` native; the 16px dashboard
radius lives in scoped CSS, untouched.)_

### 4.4 Letter-spacing — `--tracking-*`
`tracking-[0.1em]` (×3) → **native `tracking-widest`** (0.1em) — no token. The rest are off-native
tokens, **named to avoid colliding with Tailwind's built-in tracking names** (`tight` = -0.025em,
`wide`, `widest`, etc.):
| Token | Value | Utility | Replaces |
| --- | --- | --- | --- |
| `--tracking-kicker` | 0.22em | `tracking-kicker` | `tracking-[0.22em]` |
| `--tracking-tag` | 0.14em | `tracking-tag` | `tracking-[0.14em]` |
| `--tracking-label` | 0.08em | `tracking-label` | `tracking-[0.08em]` |
| `--tracking-meta` | 0.06em | `tracking-meta` | `tracking-[0.06em]` |
| `--tracking-cta` | 0.03em | `tracking-cta` | `tracking-[0.03em]` (×2) |
| `--tracking-title` | -0.01em | `tracking-title` | `tracking-[-0.01em]` (×3) — NOT `tracking-tight` (native -0.025em) |
| `--tracking-display` | -0.02em | `tracking-display` | `tracking-[-0.02em]` |

### 4.5 Line-height — `--leading-*`
| Token | Value | Utility | Replaces |
| --- | --- | --- | --- |
| `--leading-body` | 1.6 | `leading-body` | `leading-[1.6]` (×2) |
| `--leading-excerpt` | 1.55 | `leading-excerpt` | `leading-[1.55]` |
| `--leading-title` | 1.05 | `leading-title` | `leading-[1.05]` |
| `--leading-headline` | 1.04 | `leading-headline` | `leading-[1.04]` |

_(`leading-[1.5]`→`leading-normal` native.)_

### 4.6 Misc systemic
| Token | Value | Utility | Replaces |
| --- | --- | --- | --- |
| `--shadow-glow` | `0 0 30px rgb(244 246 248 / 0.45)` | `shadow-glow` | `shadow-[0_0_30px_rgb(244_246_248/0.45)]` |
| `--container-site` | 1400px | `max-w-site` | `max-w-[1400px]` (×2) |
| `--breakpoint-wide` | 900px | `wide:` variant | `min-[900px]:` (×2) |
| `--color-on-accent` | #050606 | `text-on-accent` | `text-[color:var(--color-base)]` (×3) — see §5 |

## 5. The `text-base` collision (gotcha)

`text-[color:var(--color-base)]` is a workaround: a `--color-base` token would generate `text-base`,
which collides with Tailwind's built-in font-size `text-base` (1rem). The 3 usages are all "near-black
text on a bright/cyan button." **Fix:** add `--color-on-accent: #050606` (semantic: ink that sits on
an accent surface) → clean `text-on-accent`. `--color-base` is unchanged (still `bg-base`). No rename
churn on the widely-used base color.

## 6. Architecture & method

- **One file for tokens:** all additions/renames in the `@theme` block of `src/styles/global.css`,
  grouped with comments alongside the existing tokens.
- **Per-component sweep:** mechanical arbitrary→token/native swap across the 8 components +
  `Base.astro` (Base has 0 arbitraries, likely no change). Read each live file as source of truth.
- **Order:** tokens first (define everything), then components simple→complex
  (Footer → CtaClose → WhitePapers → Projects → About → Hero → Medni → Nav).
- **Untouchable:** every rule in §2's untouchable row stays byte-for-byte.

## 7. Verification

- Reuse the screenshot-diff harness (`puppeteer-core`, system Chrome, `prefers-reduced-motion`,
  full-page shots of `/` + `/white-papers` at desktop 1440 + mobile 390).
- **Baseline from current `main` BEFORE changes.** After the token step and after each component:
  rebuild, re-shoot, **byte-equal diff vs baseline → must be zero.** Any diff = a transcription
  error (wrong token value); fix and re-verify.
- `npm run check` + `npm run build` green throughout. Harness + `puppeteer-core` removed at the end.

## 8. Out of scope
- Native default-scale *snapping* (would shift pixels — rejected).
- Animation/GSAP/state CSS; content `ch` measures; `z-[2]`; `min-h-[100dvh]`; transition-property
  lists.
- De-duping `.wrap`/`.section` literal clamps against the spacing tokens (separate cleanup).

## 9. Risks & Mitigations
| Risk | Mitigation |
| --- | --- |
| Token value transcription error → pixel drift | Byte-equal screenshot diff per component catches it |
| `--spacing-*` rename breaks an existing usage | Mechanical; build + diff verify; global.css base classes use literals (unaffected) |
| A named token collides with a native utility | Audited each namespace: `text-base` → `--color-on-accent` (§5); `tracking-[0.1em]` → native `tracking-widest`; negative tracking named `title`/`display` (NOT native `tight`); leading names (`body`/`title`/…) are non-native |
| t-shirt spacing names (`sm`/`lg`/`xl`) shadowing native sizes | They're only used on `mt`/`gap`/`py`/`pb`/`pt` (no native t-shirt there — those are numeric); `max-w-sm` etc. come from the separate `--container-*` namespace, unaffected. Verified the code uses no `max-w-sm`/`w-lg`-style natives. Screenshot diff is the backstop. |
