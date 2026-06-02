# Delta Climate Research — Website Design Spec

*Date: 2026-06-01 · Status: approved for implementation planning*

Source briefs: [Speedrun Guide](../../../Delta_Climate_Research_Speedrun_Guide.pdf), [Visual Layout Guide](../../../Delta_Climate_Research_Visual_Layout_Guide.pdf).
Domain research: [market-niche briefing](../../research/2026-06-01-market-niche-briefing.md).

---

## 1. Purpose & positioning

Marketing/credibility site for **Delta Climate Research**, a boutique consultancy.

**Niche (positioning line):** *Research-led climate intelligence & adaptation design* — the methodology-transparent interpretation layer between raw climate/earth-science data and decision-makers. The site must feel like a "high-fidelity dashboard for planetary survival": instrument-grade, calm, and credible (not neon/crypto).

**Primary goal:** establish credibility and convert qualified visitors (institutions, municipalities, corporates) into an access/contact request. **Secondary goal:** rank for the firm's research topics via indexable white papers and project pages.

---

## 2. Tech stack & architecture

- **Framework:** Astro (static output, SSG). Chosen over Next.js because the site is content-driven; Astro ships ~0 KB JS by default, which directly serves the SEO/performance goal.
- **Styling:** Tailwind CSS, with design tokens as CSS custom properties mapped into the Tailwind theme.
- **Interactivity:** Astro islands. React island support via `@astrojs/react` (only if a chosen shader/component requires React; otherwise vanilla TS islands).
- **Motion:** **native scroll** (no smooth-scroll hijack) + GSAP/ScrollTrigger (reveals/parallax/scrub) + Astro View Transitions (`<ClientRouter />`) for page changes. All lazy + `prefers-reduced-motion`-gated. See §3c.
- **Shipped JS** is intentionally minimal: the motion layer plus two lazy islands (see §7). Everything else is static HTML/CSS.
- **SEO integrations:** `@astrojs/sitemap`, per-page `<title>`/meta/OG via a layout prop, JSON-LD (`Organization`, `Article`, `CreativeWork`), `robots.txt`, canonical URLs.
- **Hosting target:** any static host/CDN (Vercel/Netlify/Cloudflare Pages) — no server runtime required.

### Routing (hybrid: immersive landing + indexable detail pages)

```
/                       full single-page scroll narrative (brand + thesis)
/projects/[slug]        each case study its own indexable page
/white-papers           the feed as a real index page
/white-papers/[slug]    each paper its own page (SEO engine)
```

On `/`, the Projects and White-Papers sections are **previews that link out** to the detail pages — the scroll narrative stays intact while every project/paper is independently crawlable, linkable, shareable. Content authored via **Astro content collections** (`src/content/projects/`, `src/content/papers/`).

### File structure

```
src/
  layouts/Base.astro            <head>, fonts, SEO meta/OG/JSON-LD, global grid, footer
  pages/
    index.astro                 composes the landing sections
    projects/[slug].astro       case-study detail (from content collection)
    white-papers/index.astro    feed index
    white-papers/[slug].astro   paper detail
  components/
    Nav.astro                   glassmorphism-on-scroll bar
    Hero.astro                  headline + thesis over background island
    About.astro                 60/40 split
    Projects.astro              horizontal-scroll preview cards → /projects/*
    WhitePapers.astro           feed preview rows → /white-papers/*
    Medni.astro                 dashboard shell + map island + drawer
    CtaClose.astro              closing conversion beat
    Footer.astro
    islands/
      FluidBackground.tsx|.ts   Three.js hero shader (client:idle)
      MedniMap.tsx|.ts          MapLibre GL map (client:visible)
  content/
    projects/*.md               3 case studies
    papers/*.md                 white-paper entries
  data/site.ts                  nav, social, org metadata
  styles/global.css             design tokens + Tailwind layers
```

---

## 3. Design tokens (locked)

```css
:root{
  /* neutrals / teal ramp */
  --base:#050606;        /* near-pure black — page background */
  --surface:#0B2C2E;     /* cards, feed rows */
  --surface-2:#093A3E;   /* elevated: drawer, hover, active */
  --hairline:rgba(111,202,214,.14); /* borders, dividers (cyan-tinted) */
  /* text */
  --paper:#ECEDF0;       /* primary text (off-white, not #fff) */
  --ink-muted:#8FA3A5;   /* body / excerpts */
  --ink-faint:#5C7173;   /* meta / captions */
  /* accents — Swiss hybrid: a functional brand cyan + a muted information tint */
  --cyan:#6FCAD6;        /* BRAND/ACTION: links, CTA, hero Spectral accent, kinetic arrow, shader */
  --cyan-muted:#92C2CB;  /* META/QUIET: mono [01] labels, captions, "Live AI Processing" */
  --cyan-dim:#4FB0BC;    /* pressed / :active */
  --bronze:#B08D57;      /* warm secondary accent: index numerals, node glyphs */
  --bronze-bright:#C9A06A;
}
```

**Usage rules:** the cyan is a deliberate **Swiss two-tone** — `--cyan` (`#6FCAD6`, lighter/cleaner than the brief's neon `#00F2FF`) does the *signalling* (links, CTA, accent, shader); `--cyan-muted` (`#92C2CB`, desaturated) does the *quiet information* (meta labels, captions, Live-AI text). Both stay rare; off-white carries ~95% of reading. Bronze ~5% (index numerals `[01]`, node-map glyphs) as the one warm counter-note. Hairlines are cyan-at-low-opacity (cohesive with the ramp).

**Contrast (WCAG, vs `#050606`):** paper ≈ 16:1 (AAA); ink-muted ≈ 6:1 (AA body); `--cyan` ≈ 10.4:1; `--cyan-muted` ≈ 10:1 — both comfortably AAA, so the lighter cyan reads smoother (less saturated-teal shimmer) and the muted tint stays legible at 8–11 px. Filled CTAs use dark text (`--base`) on `--cyan`, improved by the lighter value. All pass.

**Reference previews:** `previews/palette.html` (full UI), `previews/base-compare.html` (base selection). Base `#050606` was chosen from a 4-way visual comparison.

### Typography

A **grotesk-primary** system: Satoshi does ~all the work; a Spectral italic surfaces only on highlighted accent words.

- **Satoshi (primary — headings, subheads, body, nav, UI, buttons):** **self-hosted variable** woff2 (300–900 axis) in `public/fonts/`, `@font-face` with `font-weight: 300 900` (+ italic) — any weight available (section titles use 350). From **Fontshare** (free for commercial use); license bundled. Stack: `"Satoshi", ui-sans-serif, system-ui, sans-serif`. Preloaded for first paint.
- **Spectral Italic (accent words ONLY):** italic, weight 500, on **one or two highlighted words per headline** (the emotional word — e.g. *changing planet*), tinted cyan. OFL, self-hosted via `@fontsource/spectral` (italic-only import). Stack: `"Spectral", Georgia, serif`. Chosen via the impeccable typeset pass: a refined "scientific-journal" serif that keeps a high-contrast italic accent while escaping the saturated editorial-didone lane and the reflex-reject font list (replaced DM Serif Display, which was on that list). On-brand for a research-led climate firm. Display sizes only.
  - **Discipline rule:** max **one** Spectral accent per headline. Never for body, UI, or sub-display text.
- **Mono — Geist Mono (self-hosted via `@fontsource-variable/geist-mono`):** a clean, neutral, modern mono that pairs cleanly with the Satoshi grotesk. Owns a broader role than originally planned: **nav links, button labels, and all data/meta** (`[01]` IDs, coordinates, ppm/LST readouts, version stamps, "Live AI Processing"), plus the hero kicker. The logo wordmark stays Satoshi. Wired behind `--font-mono`.
- Self-host all fonts (no external font CDN) to protect LCP and privacy. `font-display: swap`.

This replaces the earlier Fraunces + Inter direction; the vibe shifts from techy-neutral toward editorial-luxury, fitting a boutique that sells interpretation and taste.

### Global grid (from brief)

12-column, `border-t` hairline; sticky filter aside (where used, e.g. white-papers index) + divided main feed.

### Theme — dual-mode (soft-maximalist)

The site is **dual-mode**, both reading as *soft maximalism* (rich but calm: layered colour, soft depth, texture) rather than flat minimalism.

- **Dark mode (default) — "Onyx Aurora":** the locked onyx + Swiss-cyan tokens (§3), with a layered soft background — blurred aurora blobs (teal · bronze · violet · deep-teal) over a *near-black* base (`~#030304`) + edge vignette + grain. Darker darks make the aurora glow. Preview: `previews/soft-max-onyx.html`. This becomes the parked hero-background slot.
- **Light mode — "Warm Field" (locked):** earthy soft-maximalism — bone base, layered clay/sage/teal/bronze blobs, warm near-black text, deep-teal as the brand/action accent. Full token mapping in [warm-field-light.md](../../../attic/color-schemes/warm-field-light.md). Preview: `previews/soft-maximalism.html` (Direction 02).

**Implementation note (deferred):** dual-mode needs a theme system (`data-theme` toggle and/or `prefers-color-scheme`), two token sets, and a component audit so hardcoded colours follow tokens. Not yet wired; current build is dark-only.

---

## 3b. Aesthetic direction (taste-skill calibrated)

Derived from five client-approved references (Shelter, Watchibia, oovie, Shine, Verta) — see [reference-notes](../../../inspiration/reference-notes.md). The unifying idea: **cinematic atmosphere + editorial restraint + instrument-grade annotation**, rendered in the dark onyx/teal world. Verta is the closest mood reference (dark, atmospheric).

**Dials (locked):** `DESIGN_VARIANCE 7` (asymmetric but controlled) · `MOTION_INTENSITY 5` (atmospheric, restrained) · `VISUAL_DENSITY 3` (airy; white-paper feed is a deliberate ~5 density pocket).

**Design language elements:**
- **Cinematic full-bleed imagery** as section grounds (atmospheric earth/climate/satellite). Real images required — no div/CSS fake visuals (taste-skill §4.8). Source via image-gen or licensed stock; B&W/desaturated-to-teal treatment to fit palette.
- **Oversized tight Satoshi headlines** overlapping imagery, with the single Spectral italic cyan accent word (the disciplined signature — see Typography).
- **Technical-annotation layer:** corner bracket ticks (`⌐`), thin hairline framing, tiny mono meta labels in corners (coordinates, IDs, "LIVE"). Used **only where it organizes real content** (section bounds, the Medni map frame, project-image framing) — never pure decoration (taste-skill bans decorative crosshair/grid lines).
- **Editorial numbering** as a deliberate large element (à la Shelter) and the feed's `[01]` IDs (brief-specified) — NOT as tiny templated section-number eyebrows.
- **Generous negative space**, minimal nav, confident restraint.

**AI-tell guardrails (apply to the build):**
- **Zero em-dashes** (`—`/`–`) in any site copy — use periods, commas, or hyphens (taste-skill §9.G, non-negotiable).
- **Eyebrow rationing:** the small uppercase-mono label appears at most once per ~3 sections (hero counts as one). The headline alone usually suffices.
- **No scroll cues** ("Scroll", arrows, mouse icons).
- **No version stamps as decoration** — the white-paper `[PDF]` version (e.g. v1.4.2) is allowed only as genuine file metadata, kept quiet.
- **One accent (cyan), one radius scale, one theme (dark)** locked across all sections; cyan stays rare.
- **Mixed-family emphasis exception:** the Spectral-italic-in-Satoshi-headline is a *deliberate, reference-backed* choice (oovie/Shine), confirmed by client — kept disciplined per the Typography rule, not a default reach.

**Stack note:** taste-skill assumes React/Next + Motion; we adapt its principles to **Astro islands** (vanilla/TS or a React island only where needed) + CSS/Motion-One. The aesthetic rules carry over; the framework specifics do not.

## 3c. Motion system

Calibrated to `MOTION_INTENSITY: 5` (atmospheric, restrained). Two animation references (see [reference-notes](../../../inspiration/reference-notes.md)): **climate.n-ost.org** (choreography-led: Locomotive + GSAP + Barba + smooth-scroll) and **field.io** (content-led: looping video + sparing WebGL + IntersectionObserver + native scroll). The brief's own reference is Field.blue, so FIELD is doubly authoritative.

**Philosophy (the synthesis):** *motion as content, not choreography* (FIELD's model). The page feels alive through the **atmospheric WebGL hero**, not scripted scroll timelines. Choreography is the polish layer, kept restrained.

**Resolved decisions:**
- **Hero comes alive via the WebGL shader only** — no looping video (the brief named Field.blue; the shader is fully ours, nothing to license). Project covers stay as still images.
- **Smooth scroll via Lenis** — *revised 2026-06-02:* the client wanted the 60fps-buttery feel of Framer reference sites (getoptimus.framer.ai), which comes largely from inertia scroll. Added Lenis (lightweight, rAF-driven, transform-friendly), `lerp: 0.1`, with smooth anchor `scrollTo`. **Reduced-motion falls back to native scroll entirely** (Lenis not initialized). This reverses the earlier native-scroll call; INP is protected by Lenis's rAF design + the reduced-motion bail.

**Libraries (all lazy, all `prefers-reduced-motion`-gated):**
- **GSAP + ScrollTrigger** — in-view reveals, subtle parallax, the hero word-stagger, occasional scrubbed timelines. Vanilla Astro script island, not React.
- **Astro View Transitions** (`<ClientRouter />`) — native page-to-page transitions for `/`, `/projects/*`, `/white-papers/*` (the Barba.js role, built-in and lighter).
- **IntersectionObserver** — drives reveals and lazy-mounts/parks the heavy islands (FIELD's lazy-play pattern).
- **CSS** — hover/active micro-interactions, the focus-pull blur, the kinetic arrow, typewriter loop. No JS.

**Animation catalog (per section):**
| Animation | Trigger | Motion | Mechanism |
|---|---|---|---|
| Hero word-stagger | load | Satoshi words rise + fade in sequence; Spectral italic accent arrives last with a distinct ease | GSAP timeline |
| In-view reveals | enter viewport (once) | opacity 0→1 + `translateY(16–24px)` | ScrollTrigger / `whileInView` equiv |
| Parallax | scroll position | layered `translateY` at differing speeds (subtle; depth, not gimmick) | ScrollTrigger scrub |
| Projects horizontal scroll | scroll within section | scroll-snap; optional scrub-pan | CSS snap (+ optional ScrollTrigger) |
| Focus-pull (feed) | hover | siblings blur 1.5px / opacity 0.5 | pure CSS (`:has`/group) |
| Kinetic arrow | hover | `translate(3px,-3px)`, spring | CSS transition |
| Medni "Live AI Processing" | always (in-view) | typewriter + blink | CSS |
| Page transitions | route change | cross-fade / slide between pages | Astro View Transitions |

**Easing & timing defaults:** entrance `cubic-bezier(0.16, 1, 0.3, 1)`, ~0.6s reveals, ~0.06s stagger step; springs for hover (`stiffness ~100, damping ~20`). Animate only `transform`/`opacity`.

**Discipline (taste-skill §5):** every animation must be *motivated* (hierarchy / storytelling / feedback / state). No motion-for-show. Reduced-motion collapses all of the above to instant/static. "Motion claimed = motion shown" — if a section claims reveal, it actually reveals.

## 4. Narrative flow (the landing scroll)

Spine: **systems problem → read with instruments → proof → living intelligence → access.** Each beat earns the next; credibility (research) precedes the product pitch (Medni).

| # | Section | Purpose |
|---|---|---|
| 0 | **Nav** (persistent) | Orientation. Anchors: About · Projects · White Papers · Medni · `[Databank ↗]` (only loud item). |
| 1 | **Hero** | Establish category in 3s. Atmospheric generative background + oversized Satoshi thesis (one Spectral italic accent) + tiny corner meta labels (positioning line / coordinates). No scroll cue, no CTA yet. |
| 2 | **About** | Reframe as a *systems* problem; name 3 pillars (climate science · urban heat · industrial strategy); plant the "interpretation layer" positioning. |
| 3 | **Projects** | Concrete proof before abstract claims. 3 case-study cards w/ real method tags; link to `/projects/*`. |
| 4 | **White Papers** | The research-led differentiator. Feed preview + node-map accent; link to `/white-papers/*`. |
| 5 | **Medni** | The payoff/product — sensing+research+materials converging into one hyper-local intelligence product. Climax, placed last among content. |
| 6 | **Close / CTA** | Single conversion ask (request access / contact) + footer. (Not in PDF — added so the scroll resolves.) |

Ordering decisions (approved): **Projects before White Papers** (proof before theory); **add a closing CTA** the PDF omits.

---

## 5. Section behaviors

**Nav** — transparent over hero; gains glassmorphism blur + hairline border once scrolled past hero (IntersectionObserver, inline vanilla script, no framework). Active section highlights via observers. Mobile: full-screen overlay, generative bg visible behind, large serif links.

**Hero** — `FluidBackground` island mounts here; oversized Satoshi headline (one Spectral italic cyan accent word) + tiny corner meta labels fade/translate in on load. No scroll cue (taste-skill ban). `prefers-reduced-motion` → static onyx→teal gradient, no animation.

**About (60/40)** — text left, lighter visual right; reveal-on-scroll for copy + 3 pillars (CSS + small observer, no heavy JS).

**Projects** — horizontal-scroll row, CSS scroll-snap; cover images desaturated by default → saturate on hover (`filter: grayscale`). Each card is a real `<a>` → `/projects/[slug]`; kinetic `↗` springs `translate(3px,-3px)` on hover. Keyboard-navigable.

**White Papers** — dense rows; **Focus-Pull** on hover (blur siblings 1.5px / opacity 0.5) implemented in **pure CSS** via group/`:has` selectors — no JS. Per-row "node" glyph (bronze) + meta header in cyan-muted mono (`[01]` · date · category). Title links → `/white-papers/[slug]`. The "abstract connection map" is a small static **SVG** accent (not a physics sim — keeps it light).

**Medni** — dashboard section; `MedniMap` island mounts `client:visible`. Side drawer: monospaced "Live AI Processing" text with CSS typewriter/blink loop. "Access Planetary Insights" CTA (cyan-bordered box) scrolls to the close section.

**Close/CTA** — quiet conversion beat + footer ("© 2026 Delta Climate Research | Built for the Frontier").

---

## 6. Detail pages

- **`/projects/[slug]`** — hero cover image, method/standard tags (e.g. ECOSTRESS/HVI, VM0033, EPD/CBAM), problem→approach→outcome body, related papers. JSON-LD `CreativeWork`.
- **`/white-papers`** — full feed index (all entries), optional category filter in the sticky aside. JSON-LD `CollectionPage`.
- **`/white-papers/[slug]`** — paper title (serif), meta header, body (MD), `[PDF]` download button showing file size + version (e.g. v1.4.2), node-map of related areas. JSON-LD `Article`.

Content is **placeholder drawn from the domain research** (real terms: Project Kolkata/urban heat, Mangrove Blue Carbon/VM0033, UAE–India materials/CBAM), ready to swap for real copy.

---

## 7. The two heavy JS islands

### `FluidBackground` — `client:idle`
- **Baseline:** the brief's self-contained Three.js shader — a plane with **Simplex-noise vertex displacement** + mouse distortion, recolored to the onyx/teal/cyan ramp (cyan currents, occasional bronze glint). Self-contained, no third-party licensing.
- **Swap-in path (optional, deferred):** a 21st.dev / `@paper-design/shaders-react` shader (e.g. Mesh Gradient / Silk). If chosen, add `@astrojs/react`; note attribution + license in this spec. Keeps the same mount/guard contract below.
- **Guards:** skip mount on `prefers-reduced-motion` and coarse/low-power hints; cap device pixel ratio; **pause the render loop when offscreen** (IntersectionObserver) to protect battery.
- **Fallback:** static CSS onyx→teal gradient rendered server-side — always present even with JS off / WebGL unavailable.

### `MedniMap` — `client:visible`
- **MapLibre GL** + free **CARTO dark vector style** (no API key/token).
- Heatmap layer over placeholder climate points (heat / carbon-sink overlays).
- Initializes/fetches tiles **only when scrolled into view** — zero cost on initial load.
- **Fallback:** static dark map image if WebGL/map init fails.

**Performance posture:** the static HTML paints first; the motion layer (§3c) and both heavy islands lazy-load after, self-throttle, and stay off the critical path — preserving the Core Web Vitals win.

---

## 8. Accessibility & SEO checklist

- One `<h1>` per page (hero thesis on `/`); `<section>` + `<h2>` per beat; clean heading hierarchy.
- Keyword-bearing copy in real DOM text (never locked inside canvas/WebGL).
- Per-page title + meta description + Open Graph/Twitter cards; canonical URLs; `sitemap.xml`; `robots.txt`.
- JSON-LD: `Organization` (`/`), `Article` (papers), `CreativeWork` (projects).
- Descriptive `alt` on satellite/render imagery.
- `prefers-reduced-motion` honored by both islands, the GSAP motion layer, and all reveal animations (collapse to instant/static).
- Keyboard navigation for the horizontal Projects scroller and all interactive elements; visible focus states (cyan ring).
- Color contrast verified (§3).

---

## 9. Out of scope (YAGNI)

- No CMS/backend — content via Astro collections (Markdown).
- Medni map is a **styled placeholder product surface**, not a real data pipeline/auth.
- No real PDF generation — `[PDF]` buttons link to placeholder files.
- No contact-form backend in v1 — CTA links to email/`mailto` or a form provider TBD with the client.
- No i18n in v1.

---

## 10. Open items (non-blocking)

1. **Hero shader look** — *resolved:* the hero comes alive via WebGL shader only (no video), native scroll (§3c). *Still open:* the specific shader treatment — baseline Three.js Simplex (Field.blue-style) ships unless the client drops a specific 21st.dev/paper-design component (swap-in path in §7).
2. **Bronze emphasis** — currently index numerals only; may extend to node glyphs/rules after live review.
3. **Contact mechanism** for the CTA (mailto vs form provider) — confirm with client.
4. **Mono font** — *resolved:* Geist Mono, self-hosted via `@fontsource`, driving nav links + buttons + data/meta.
