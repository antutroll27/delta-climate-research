# DESIGN.md — lukebaffait.fr teardown (for Delta sections 01/02/03 redesign)

## Source
- URL: https://lukebaffait.fr/ ("Luke Baffait, Creative Developer" V3.0)
- Captured: 2026-06-12 (browser agent, full-scroll, source-verified)

## Verified tech stack
| Library | Role |
|---|---|
| GSAP + ScrollTrigger | all animation, 12+ triggers, scrub everywhere |
| Lenis (`lerp: 0.06`) | heavy/floaty smooth scroll |
| Curtains.js (rebranded Unicorn Studio runtime) | hero WebGL fog ONLY |
| **No three.js, no SplitType, no Barba** | split-text + page transitions hand-rolled |

Zero-framework vanilla site. Fonts: Breton (light sans) + Machine (high-contrast italic serif accent) + Zirena (heavy condensed) + Inter labels. Identity = sans/italic-serif duet + red dot (mirrors our Mona Sans / Moonscape italic / cyan).

## Structure (17,402px ≈ 19vh of scroll)
Preloader → 400vh pinned hero → fixed 341-frame scrub canvas → About → Projects (sticky list + fixed preview) → 600vh pinned CSS-3D circle gallery → Skills (sticky col + accordions) → Awards (scroll-highlighted rows) → Contact (white blob inversion) → fixed footer reveal.

## The six signature moves
1. **Continuous scroll narrative** — every section boundary is choreographed (pin, scrub, defocus, blob swallow, sheet peel). No plain boundaries.
2. **Wordmark as recurring character** at 3 scales (intro → viewport-wide hero → 17vw footer).
3. **One expensive effect** (hero mouse-reactive flow-field) — everything else cheap CSS-3D that *reads* as WebGL (sliced-cylinder gallery cards).
4. **Scroll-driven selection, not hover** — projects fisheye list (closest-to-center row activates, rows push x 0–80px by distance), awards center-band highlight; Lenis lerp tightens 0.06→0.04 when a row locks (tactile notch).
5. **FLIP flying-text transitions** — project row title flies to detail-H1 rect; same for cross-page nav (fake SPA over MPA, sessionStorage flag).
6. **Hand-made oddities** — red ASCII hands w/ cursor-heat glyph scramble, segmented clickable scroll timeline, `(42)` scroll counter, crosshair corner marks on every image.

## Recipes worth porting (with mechanics)
- **Scrub-blur word reveal** (About/body signature): every word a span; per-word ScrollTrigger `start 'top 75%' end 'top 60%' scrub` → `opacity 0→1, blur(8px)→0`.
- **Projects pattern**: left sticky list 45% (dimmed rgba-white .2 rows, hairline bottoms, active white); right `position:fixed` preview card; image quick-swap (0.18s out / 0.3s in); card mouse-tilt `rotateY ±6° rotateX ±5°` lerp 0.12 in gsap.ticker, `perspective 800`; `cursor:none` + trailing pill cursor "SEE PROJECT" via quickTo 0.35s.
- **Awards/row highlight**: per-row trigger toggles `.active` when row crosses center band; background wipes via `clip-path: polygon`. Awards rows also glue a 250px cover image to cursor.
- **chr-hover rolling letters**: per-char `.ch-wrap > .ch-top + .ch-bot`, both translate -100% on hover, `transition-delay: calc(var(--i) * 28ms)`.
- **Masked reveals everywhere**: chars rise `yPercent 110→0` inside `overflow:hidden`, or `clip-path: inset` wipes. Never fade-only.
- **Easing vocabulary**: `power3.out` reveals, `power3.inOut` panels/flights, `none` for scrubbed; micro 0.25–0.45s, reveals 0.7–1.1s; char staggers 0.015–0.04 (`from:'center'` or edges-in).
- **Perf hygiene**: just-in-time `will-change` (reset after), DPR clamp 1.5 + frame-skip on slow hardware, mobile drops blur filters, ScrollTriggers toggle `visibility` on off-screen fixed layers.

## Palette discipline
4 values: `#0a0a0a`, `#f0f0f0`, `#ff1e00` signal red, white-alpha hairlines (.08/.15/.2). Texture from content (footage, ASCII), not grain. One dark→light→dark inversion arc page-wide.

## Delta translation notes
- Our equivalents: base #050606 / paper #ecedf0 / **cyan #6fcad6 as the signal color** (their red) / bronze #b08d57 for index-meta / existing hairlines + grain.
- We already ship GSAP + ScrollTrigger + Lenis (scroll-effects.ts, smooth-scroll.ts) → recipes port natively.
- Our "one expensive effect" already exists (vortex hero, warp footer). Optional literal-three.js add: WebGL distortion hover on project preview images only.
- Crosshair corner marks fit our FIG./instrument motif perfectly (Loader/About already speak this language).
