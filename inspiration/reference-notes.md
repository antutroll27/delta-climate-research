# Aesthetic reference notes

Five reference sites the client loves the "vibe/ideology" of (provided 2026-06-01), analyzed via the `taste-skill`.

## The references
1. **Shelter** (winter holidays) — full-bleed snow photography, huge tight grotesk headline overlapping the image, giant editorial numbering (`1`, `2`), rounded-corner image containers, white minimal nav, circular arrow button, small asymmetric body block.
2. **Watchibia** (smart watch) — cinematic mountain hero, grotesk + serif-italic headline ("Where tradition meets innovation"), product with technical wireframe/bracket annotations, glassy floating nav pill, light cards, "+"-affordance buttons.
3. **oovie** (wellness) — full-bleed photo, massive grotesk headline with **serif italic accent words** ("in its *purest form*"), corner bracket tick marks (`⌐`), white-on-photo type, body copy bottom-right.
4. **Shine** (donations) — sky/cloud hero, thin hairline **frame/grid** around content, serif italic accent ("Your *Resources* Can Help Many"), pill buttons, surreal nature imagery.
5. **Verta** (AI/intelligence) — **dark cinematic** atmospheric hero (figure walking into a light doorway), big grotesk headline bottom-left, tiny corner meta labels ("We don't predict the future" / "We build it for you"), minimal nav, single accent button. **Closest to our dark palette + mood.**

## Shared DNA (the "ideology")
1. Cinematic, atmospheric full-bleed imagery as the ground
2. Oversized tight grotesk headlines overlapping the image
3. A serif italic accent word inside the grotesk headline (oovie, Shine, Watchibia)
4. Quiet technical annotation — corner bracket ticks, hairline framing, wireframe callouts
5. Tiny meta labels placed in corners (Verta)
6. Generous negative space, minimal restrained nav
7. Editorial numbering (Shelter)

**Unifying idea:** cinematic atmosphere + editorial restraint + instrument-grade annotation. Maps directly onto Delta's "high-fidelity dashboard for planetary survival" positioning. Verta is the bridge reference (dark + atmospheric = our mood).

## Animation reference — climate.n-ost.org (motion only, not style)

Provided 2026-06-01, analyzed for animation mechanics only (client explicitly excluded its design style/vibe). Verified from its `dist/js/main.js` bundle.

**Stack found:** Locomotive Scroll (`data-scroll`, `data-scroll-speed`, `data-scroll-sticky`, `is-inview`, lerp smooth scroll) + GSAP/ScrollTrigger + Barba.js page transitions (`data-barba`). Trace three.js reference only.

**Animations observed:**
- Smooth/inertia (lerp) scroll as the foundation
- Parallax via `data-scroll-speed`
- Sticky/pinned via `data-scroll-sticky` + `data-scroll-target`
- In-view reveals (`is-inview`): fade + translate-up on enter
- `animated-words` staggered word-by-word headline reveal
- Barba.js animated page-to-page transitions (no hard reload)

**What we borrow (adapted to Astro, NOT the heavy stack):**
- Smooth scroll → **Lenis** (lighter, maintained successor to Locomotive)
- Reveals / parallax / scrub → **GSAP ScrollTrigger**
- Word-stagger headline → our hero (Satoshi words in, Playfair accent last)
- Barba page transitions → **Astro View Transitions** (native, lighter)
- Skip Locomotive scroll-hijack as foundation (heavier, INP/a11y cost)

Captured in spec §3c (Motion System).

## Animation + vibe reference — field.io (the brief's "Field.blue")

Provided 2026-06-01 by the co-founder (animations + vibe). This IS the brief's named reference (Field.blue = FIELD.io, the generative-art studio), so it is doubly authoritative. Verified across its 17 Next.js JS chunks.

**Stack found:** Next.js (Turbopack); **three.js / WebGLRenderer** (sparing, 2 chunks); **looping muted video** as the primary motion vehicle (`playsInline`, 321 `video` refs, Cloudinary video delivery); **IntersectionObserver** (reveals + lazy video play); **native scroll**. NOT found: GSAP, Lenis, Locomotive, Barba, Framer Motion.

**Philosophy:** *motion as content, not choreography* — the page feels alive via atmospheric video + restrained WebGL, not scripted scroll timelines.

**Vibe:** minimalist monochrome, huge editorial sans type, full-bleed atmospheric media, generous whitespace, premium/intelligent. Tagline "Creative Intelligence for a Living World" ≈ our "research-led climate intelligence."

### Reconciling the two animation references
- **n-ost** = choreography-led (heavy GSAP/Locomotive/Barba + smooth scroll).
- **FIELD** = content-led (video + light WebGL + native scroll).
- **Our synthesis (MOTION_INTENSITY 5):** atmospheric WebGL hero = the "alive" layer; restrained choreography (word-stagger, reveals, view transitions) = polish. Lean toward FIELD's lighter approach.

### Decisions resolved from this reference (client-confirmed)
- **Hero comes alive via the WebGL shader ONLY** (no looping video). Brief named Field.blue; shader is ours, nothing to license.
- **Native scroll** (no Lenis/smooth-scroll). Best INP/accessibility, lowest risk.

Captured in spec §2, §3c.

## taste-skill dials (locked for this project)
- **DESIGN_VARIANCE: 7** — asymmetric but controlled.
- **MOTION_INTENSITY: 5** — atmospheric, restrained (credibility site, not experimental).
- **VISUAL_DENSITY: 3** — airy; white-paper feed is a deliberate density pocket (~5).

## Decisions carried into the spec
- **Keep** the Playfair-italic-accent-in-Satoshi-headline (client confirmed). taste-skill flags mixed-family emphasis as a risk, but the references prove it works; mitigated by strict discipline (one accent per headline, always italic cyan, the emotional word, never elsewhere).
- Playfair Display is on taste-skill's approved serif list; Fraunces (our original pick) was explicitly banned — the swap corroborates.
- Adopt a **technical-annotation layer** (corner ticks, hairline framing) but only where it organizes real content.
- Real cinematic imagery required (not div/CSS placeholders).
- AI-tell guardrails applied: no scroll cues, eyebrow rationing (≤1 per 3 sections), zero em-dashes in copy.
