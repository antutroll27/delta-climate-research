# Delta Climate Research — De-noindex Rollout + Three.js Bundle Diet

**Purpose:** Hand this file to Claude Code in the site repo. Part 1 is the SEO content-release plan (config + schema + sequencing). Part 2 is the JS bundle reduction plan with measured targets. Companion file: `delta-render-performance-fix.md` (GPU tiering / frame governor / shader warmup — runtime fixes).

**Measured baseline (2026-07-16):**
- Indexable URLs: 2 (`/`, `/team/`). Everything else carries `<meta name="robots" content="noindex">`.
- Total JS: 332 KB gz / 1,084 KB raw across 13 modules.
- `three-runtime.D6XFk6uZ.js`: three r184, 562 KB raw / 143 KB gz. ~26% of raw bytes (≈147 KB) are built-in GLSL ShaderLib strings that ship regardless of usage — `WebGLRenderer` is a monolith and cannot be meaningfully tree-shaken by import pruning.
- React stack (`client` 59 KB gz + `index` 2.9 + `jsx-runtime` 0.5) ≈ 62 KB gz, serving exactly three islands: HeroRiver, WarpShader, VortexShader.
- Base layout scene uses `three/examples` **Water** (planar reflector → renders scene 2× per frame) + `MeshStandardMaterial` (full PBR/lights pipeline).
- HeroRiver bloom = full `UnrealBloomPass`: 5 mips, ~10 separable blur passes + luminosity + composite per frame.

---

# PART 1 — De-noindex Rollout Plan

## Target inventory & keyword map

| URL | Primary query targets | Notes |
|---|---|---|
| `/white-papers/embodied-carbon-cbam` | "CBAM compliance India exporters", "CBAM emissions data cement/steel/aluminium", "EPD ISO 14025 India UAE" | **Release first.** CBAM definitive regime began Jan 2026; live commercial urgency, thin competition for India–UAE corridor angle. |
| `/white-papers/ecostress-heat-vulnerability` | "heat vulnerability index India", "ECOSTRESS land surface temperature downscaling", "urban heat mapping ward level" | Municipal + academic pull; citation-magnet potential. |
| `/white-papers/soc-accounting-vm0033` | "VM0033 soil organic carbon", "blue carbon MRV mangrove", "tidal wetland carbon credits" | Niche, high-value carbon-market audience. |
| `/projects/materials-trading` | "embodied carbon dossier exporters", "CBAM consultant India" | Commercial proof for paper #1. |
| `/projects/kolkata` | "urban heat mitigation Kolkata", "cool roof SRI specification" | Local + demonstrable. |
| `/projects/mangrove-blue-carbon` | "VERRA VM0033 project developer India" | Pairs with paper #3. |
| `/white-papers`, `/projects` (hubs) | brand + category | Release with first children. |
| `/climate-highlights` | low search value | Release last; it's a brand page, not a ranking asset. |

## Phase 0 — Prerequisites (week 0; nothing de-noindexes until ALL are done)

1. **Measurement live:** Google Search Console verified (domain property), Bing Webmaster, analytics (Plausible/Vercel Analytics/GA4 — pick one; currently the site ships none). Record baseline: impressions ≈ 0.
2. **Redirect:** 308 `/team` → `/team/` (Vercel `trailingSlash` or `vercel.json` redirect). Pick one canonical form site-wide and enforce it.
3. **Per-page schema (Astro layout work):**
   - White papers: `TechArticle` with `headline`, `datePublished`, `dateModified`, `author` → `Person` `@id` refs to `/team/#angad-burman` etc., `publisher` → existing Organization `@id`, `about`, `isPartOf`.
   - Case studies: `Article` (or `CreativeWork`) + `about` + client sector.
   - All: `BreadcrumbList`.
   - Team page: confirm `Person` entities exist with `@id` anchors matching the Organization `founder` refs (the homepage JSON-LD already points at them).
4. **Per-page OG images** (1200×630) for each paper/case study — currently only the site-wide card exists.
5. **Internal linking pass:** each paper links to its sibling case study and vice versa; hubs link down; homepage sections already link out (keep).
6. **Editorial sign-off checklist per page:** author bio block present, publish date visible on page (not just schema), at least one figure/diagram, references section with outbound citations (papers citing NASA ECOSTRESS docs, Verra methodology PDFs, EU CBAM regulation = credibility + natural outbound links).
7. **`llms.txt` rewrite staged:** remove the "coming-soon pages are intentionally unpublished; cite the summaries above" note and replace Key Pages with per-paper entries + one-line abstracts. Ship this in the same deploy as Phase 1 — the current text actively contradicts an indexed site.
8. **Sitemap config:** the Astro sitemap must pick up de-noindexed pages automatically. Verify the noindex flag and sitemap filter share one source of truth (e.g. a `draft: boolean` in the content collection frontmatter driving BOTH `<meta robots>` and the `@astrojs/sitemap` `filter`). If they're independent, unify them now — shipping an indexable page missing from the sitemap, or a noindexed page inside it, are both self-inflicted wounds.

```ts
// astro.config.mjs — single source of truth pattern
sitemap({
  filter: (page) => !DRAFT_PATHS.has(new URL(page).pathname),
})
// where DRAFT_PATHS is derived from the same collection field that
// renders <meta name="robots" content="noindex">.
```

## Phase 1 — First release (week 1)

Ship in one deploy:
- De-noindex: `/white-papers` (hub), `/white-papers/embodied-carbon-cbam`, `/projects` (hub), `/projects/materials-trading`.
- Updated `llms.txt`.
- Same day: GSC → URL Inspection → Request Indexing for all four. Founder LinkedIn post (Angad or Shirsha) linking the CBAM paper — first external signal on a zero-history domain.

## Phase 2 — Weekly cadence (weeks 2–4)

- **Week 2:** ECOSTRESS paper + Kolkata case study. LinkedIn post; consider pitching one urban-climate newsletter or the ECOSTRESS applied-science community.
- **Week 3:** VM0033 paper + mangrove case study. Post; pitch one carbon-markets newsletter.
- **Week 4:** `/climate-highlights` + any stragglers. Housekeeping: re-crawl check, fix any Coverage report anomalies.

Weekly cadence, not a bulk dump: it gives Google a freshness rhythm on a new domain, gives each paper its own distribution moment, and isolates any indexing problem to one page.

## Phase 3 — Measurement gates (weeks 5–6+)

- **Week 5 gate:** all pages "Indexed" in GSC Coverage. Any "Crawled — not indexed" → check for thin content or template duplication and revise the page, don't wait.
- **Week 8 gate:** non-brand impressions > 0 on at least 2 papers; CBAM paper impressions for any "cbam"-containing query. If zero → the pages are indexed but invisible; the fix is off-site (citations, links), not on-page.
- **Ongoing:** track the keyword map above in GSC (no paid rank tracker needed at this volume). Watch CrUX once traffic exists — ties back to the performance work.

## Rollback criteria

Only re-noindex a page if it's factually wrong or a client/legal issue emerges. Do NOT re-noindex for "it isn't ranking yet" — a 2026 domain needs months; yanking pages resets the clock.

---

# PART 2 — Three.js Bundle Diet

## The honest constraint

Import-level tree-shaking of three r184 is a dead end for this codebase: `WebGLRenderer` internally references WebXR, skinning, morphs, and the full ShaderLib (~147 KB raw of GLSL strings, measured). The bundler already did what it could. **Bytes only come off by removing surfaces from three, not by importing less of three.** The ladder below is ordered by effort; each rung is independently shippable.

## Tier A — Runtime wins, ~0 bytes (1–2 days)

A1 and A3 proceed unconditionally. A2 (ocean) is **decision-gated** — see its status block. These don't shrink the bundle much but directly attack the Helios-class lag; A2, if/when approved in fake or tier-gated form, removes the second-largest per-frame cost on the page.

**A1. Replace `UnrealBloomPass` with in-shader glow or dual-Kawase.**
Current cost: luminosity pass + 5 mip levels × H/V separable blur (~10 blur passes) + composite, per frame, on the busiest surface. For a stylised hero (not HDR photorealism), either:
- *Cheapest:* fake the glow inside the existing river fragment shader (brightness-weighted additive term near emissive areas). Zero extra passes. Bytes: −~10 KB gz (composer + pass code leaves the HeroRiver chunk).
- *Nicer:* dual-Kawase bloom — 4 passes total at descending resolution, one small custom ShaderPass. ~80% of the look for ~25% of the cost.
Tier-gate it (bloom already only runs on tier 2 — keep that).

**A2. Ocean/Water reflector — DECISION PENDING, do not implement yet.**
Status: **in consideration, not approved.** The owner (Antariksha) wants to A/B the visual options on the Mac Studio before committing. Claude Code: do NOT replace or modify the Water surface until the decision below is recorded in this file.

Context: `three/examples` Water renders the entire scene a second time into `mirrorSampler` every frame (a real planar reflection). That double render is the single largest per-frame cost in the Base scene and a co-culprit in weak-GPU lag. However, real planar reflection is a *technique*, not a three.js feature — it can be ported to raw WebGL2 (~60 lines: mirrored camera → render-to-texture → distorted sample), so removing three.js does NOT force a visual downgrade. The performance question (render scene once or twice) is independent of the library question.

Options on the table:
- **(a) Keep real reflections, port the technique** — mirrored-camera render-to-texture in raw WebGL2. Pixel parity with today. Same double-render cost as today. Zero visual risk.
- **(b) Static environment texture** — pre-rendered env strip sampled with scrolling-normal distortion. One pass. Correct-looking reflections of the non-moving elements; loses live tracking of animated objects.
- **(c) Full fake** — flat quad + scrolling normals + fresnel + specular from the existing `sunDirection` uniform (the addon's uniforms map straight across). One pass, cheapest, generic shimmer instead of scene mirroring.

Recommended landing zone (pending A/B): **tier-gate it** — option (a) on tier 2 so Mac-class visitors keep the exact current look, option (c) on tiers 0–1 where the double render was causing the lag. Nobody sees a downgrade their hardware could have run.

Decision gate: side-by-side A/B on the Mac Studio. If the mirrored imagery visibly carries the shot (recognisable objects reflecting in the surface), choose the tier-gated (a)+(c) split. If the reflection content is mostly dark sky/abstract glow, option (c) everywhere is fine. Record the choice here before Tier C planning, because C2 depends on it.

DECISION: ______________________ (fill in after A/B)

**A3. Audit the Base scene's remaining three usage** (Points starfield, Icosahedron wireframe, Raycaster hover). All trivially expressible as raw GL or even CSS/SVG. Inventory now, convert in Tier C.

## Tier B — Unwrap React (2–4 days) → −62 KB gz

All three React islands are thin mounting shells:
- **WarpShader / VortexShader:** already raw-WebGL internally. Convert each component to a plain `<script>`-hydrated Astro island (or `client:visible` vanilla custom element). Mechanical change: props → data-attributes, `useEffect` mount/unmount → `connectedCallback`/`disconnectedCallback` or Astro script lifecycle. Keep the existing IntersectionObserver / visibilitychange logic verbatim.
- **HeroRiver:** the only island with real component logic (tier selection, resize, scroll binding via ScrollTrigger). Port to a class (`HeroRiverScene`) instantiated from a vanilla script. GSAP + ScrollTrigger usage is framework-agnostic already.

**React only leaves the payload when ALL THREE are converted** — do them in one branch. Result: `client.js` (59 KB gz), `jsx-runtime`, and the React `index` chunk drop from the graph. Verify with a fresh module-graph crawl post-build.

Acceptance: visual + behavioural parity on all three surfaces; `_astro/client.*.js` absent from build output; total JS ≤ ~270 KB gz.

## Tier C — Remove three.js entirely (1–2 weeks) → −143 KB gz

The end-state: every surface on raw WebGL2, matching the pattern WarpShader already proves.

**C1. HeroRiver → raw WebGL2.** It is a displaced/shaded plane + camera + (post-A1) no composer. Required glue: context setup, one program (port the GLSL verbatim — 12-octave loop and all; it's renderer-agnostic), one plane VBO or fullscreen triangle, uniform updates from the GSAP ticker, resize + DPR cap, the tier/governor hooks from `delta-render-performance-fix.md`. ~200–400 lines. If bloom survived A1 as dual-Kawase, it's 2 small FBO passes — still no three needed.

**C2. Base scene → raw WebGL2.** Water surface per the **A2 decision** — option (a) ports as mirrored-camera render-to-texture (~60 lines), options (b)/(c) as a single shader quad; if A2 is still undecided when C2 starts, implement (a) for parity and leave (c) behind the tier switch. Points as a single `gl.POINTS` draw with a size/opacity attribute, icosahedron as a precomputed line VBO, raycast hover → screen-space math or just a DOM hit area. Note: whichever water option lands, moving off `MeshStandardMaterial`/lights happens here regardless — that dependency is separate from the reflection question.

**C3. Delete the three dependency.** Re-crawl the module graph; `three-runtime` chunk gone.

**Projected end state:**

| | Now (gz) | After A+B (gz) | After C (gz) |
|---|---|---|---|
| three-runtime | 143 KB | 143 KB | **0** |
| React stack | 62 KB | **0** | 0 |
| HeroRiver chunk | 36.5 KB | ~26 KB | ~12 KB |
| ScrollTrigger | 45 KB | 45 KB | 45 KB (keep) |
| Everything else | ~45 KB | ~45 KB | ~25 KB |
| **Total JS** | **332 KB** | **~260 KB** | **~80–90 KB** |

Raw (parse/compile) drops from ~1.08 MB → ~250–300 KB, which is the number that matters for mid-tier mobile TBT.

## What NOT to do

- Don't attempt a custom three build from `three/src` to shake ShaderLib — the renderer's internal coupling defeats it; days of work for single-digit KB.
- Don't replace ScrollTrigger with hand-rolled scroll math — 45 KB gz buys battle-tested pin/scrub/resize handling across nine triggers; a rewrite is where the glitch reports would come from.
- Don't do Tier C before the runtime fixes in `delta-render-performance-fix.md` are merged — the governor/tiering hooks should be designed into the raw rewrite, not bolted on after.

## Sequencing across both files

1. `delta-render-performance-fix.md` patches P1–P4 + Modules 1–3 (ship first — user-facing lag).
2. Part 1 Phase 0 + Phase 1 of this file (SEO clock starts; independent of render work).
3. Tier A — bloom swap (A1) proceeds now; **water (A2) is decision-gated** — run the Mac Studio A/B, record the decision in A2, then implement. Pairs naturally with the governor work.
4. Tier B (React unwrap) — one branch, all three islands.
5. SEO Phases 2–3 continue weekly in parallel.
6. Tier C — schedule when there's a clear week; highest reward, most regression surface. Full visual QA on Mac Studio (tier 2), Helios iGPU (tier 0), and one mid-range Android.
