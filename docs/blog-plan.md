# Blog — implementation plan

**Status:** planned, not built. Decisions locked 2026-07-23.

**Decisions:** separate `/blog` route (White Papers untouched) · MDX from day one ·
per-post OG cards auto-generated at build.

**Why:** the SEO audit found `site:deltaclimate.earth` = 0 indexed pages, only 2
indexable URLs, zero backlinks. A blog is the only mechanism that continuously
adds indexable pages, creates long-tail entry points for the niche terms
(HVI, VM0033, CBAM/EPD), and gives people something to link to.

---

## Architecture

Astro **Content Collections** + Zod + MDX. Schema failures break the build —
the same "data can't drift" principle used for `published` flags in papers.ts.

### `src/content.config.ts`

```ts
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const AUTHORS = ['angad', 'shirsha', 'dhruv', 'antariksha', 'roshni'] as const;
const TOPICS = [
  'urban-heat', 'blue-carbon', 'embodied-carbon',
  'climate-risk', 'policy', 'geospatial', 'field-notes',
] as const;

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: ({ image }) => z.object({
    title:       z.string().max(70),          // SERP title budget
    description: z.string().min(80).max(160), // forces a real meta description
    pubDate:     z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author:      z.enum(AUTHORS),             // resolves to the Person @id on /team
    topics:      z.array(z.enum(TOPICS)).min(1),
    cover:       image().optional(),
    coverAlt:    z.string().optional(),
    draft:       z.boolean().default(false),
    featured:    z.boolean().default(false),
  }).refine(d => !d.cover || !!d.coverAlt, {
    message: 'coverAlt is required when cover is set', path: ['coverAlt'],
  }),
});

export const collections = { blog };
```

**Why these three details matter**
1. `author` is an enum of real team IDs → a post's author resolves to the existing
   `Person` node on `/team` (`…/team/#angad-burman`). Real credentialed author
   entity in `Article` schema = the E-E-A-T signal the AISEO audit found stranded.
   A typo'd author slug fails the build.
2. `description` min/max → cannot ship a post with a bad meta description.
3. `topics` enum → no `climate-risk` vs `Climate Risk` drift across posts.

### Files / routes

```
src/content/blog/<slug>/index.mdx     # colocated post + its images
src/pages/blog/index.astro            # index (Baffait-style rows)
src/pages/blog/[...slug].astro        # post page
src/pages/blog/[...slug]/og.png.ts    # per-post OG endpoint (build-time)
src/pages/rss.xml.ts                  # feed
src/components/blog/Prose.astro       # long-form typography wrapper
scripts/og-fonts/*.ttf                # build-only fonts (NOT public/)
```

Drafts: filter `draft` in `getStaticPaths` → the page is never built, so it's
absent from the sitemap automatically (no extra filter needed). Verify this.

---

## Per-post OG cards

Reuse the **exact layout** of the shipped `og-card.jpg` (corner ticks, bronze mono
kicker, cyan accents), swapping in post title + author + topic.

**Pipeline:** Satori (JSX → SVG) → sharp (SVG → PNG). `sharp` 0.34.5 already
resolves via `astro:assets`; only `satori` is a new dep.

**⚠ Font gotcha (verified):** Satori supports ttf/otf/woff — **not woff2** — and
`public/fonts/` is woff2-only. Convert once (`wawoff2` or fontTools) and commit
the TTFs under `scripts/og-fonts/`. Build-only; never served to browsers, so
the site's font payload is unchanged.

**Fallback if Satori proves fiddly in CI:** generate cards locally with the
existing headless-Chrome harness (same approach that produced `og-card.jpg`) and
commit the PNGs. Loses "automatic per post" but zero build risk.

---

## Integration points (existing plumbing)

Already built — the blog just uses it:
- `ogType="article"` — prop exists on `Base.astro`, currently unused. Built for this.
- `structuredData` prop — posts pass `Article` + `BreadcrumbList`.
- `Person` nodes on `/team` — become the `author` reference.
- Sitemap filter — drafts are never built, so they can't leak in.

Needs work:
- **`Base.astro` hardcodes `ogImage`** to `/images/og-card.jpg`. Add an optional
  `ogImage` prop so posts can pass their generated card. (Small, but required.)
- `llms.txt` — add a `## Writing` section; ideally build-generated so it never drifts.
- `Nav.astro` + `Footer.astro` — add the link. URL is `/blog`; the *label* could be
  more on-brand ("Field Notes" / "Notes" / "Dispatches") — open question.
- RSS via `@astrojs/rss` (new dep). Also feeds AI crawlers.
- `@astrojs/mdx` (new dep).

---

## Craft (the parts that aren't wiring)

1. **Long-form typography on near-black.** The make-or-break. `#ecedf0` on
   `#050606` at 18px for 1,500 words is fatiguing. Needs a real prose scale:
   ~65–70ch measure, generous leading, body dimmed slightly vs headings, proper
   `<figure>`/caption/blockquote/table/code treatment. Tokens exist; the
   typographic system does not.
2. **Index page.** Should feel like a sibling of `WhitePapers.astro`'s
   Baffait-style index (outlined numerals, center-band activation, cursor chip) —
   not a generic card grid.
3. **Perf discipline.** Blog pages must not boot three.js (they won't — it lives
   in `index.astro`), but GSAP + Lenis still load globally from `Base.astro`.
   For a reading page, consider gating the scroll-effects init.

---

## Phases

| Phase | Scope |
|---|---|
| **1 — Engine** | `content.config.ts`, `src/content/blog/`, MDX integration, `/blog` index + post route, Prose typography, draft handling, 1 seed post. |
| **2 — SEO/AISEO** | `Article` schema (author→Person), `ogImage` prop, per-post OG generation, RSS, `llms.txt` + nav/footer wiring. |
| **3 — Craft** | Reading progress, TOC, related-by-topic, topic pages (`/blog/topic/urban-heat` — more indexable surfaces), MDX components (`<Figure>`, `<Callout>`, `<DataPoint>`). |
| **4 — Optional** | Migrate `papers.ts` + `projects.ts` onto the same engine, retiring the hardcoded arrays. |

Phase 1 ≈ most of a day. Phases 2–3 are where the compounding value is.

---

## Risks

- **Graveyard risk.** A blog with 2 posts and a stale date is worse than none.
  Cadence > build quality here. Have 2–3 real posts before launch.
- **MDX scope creep.** It invites building a component library instead of writing.
  Ship phase 1 with plain prose; add components only when a post demands one.
- **Don't launch empty.** Would make the 4-empty-sections problem worse.

## Who writes (changes the risk profile)

The **content/marketing team writes, not the CTO** (Roshni, Lead Communications +
team). Two consequences:

**Graveyard risk drops a lot** — there's a dedicated owner, so cadence is a job
description rather than a good intention competing with billable work.

**But the risk moves to the authoring workflow, and that's now the #1 decision.**
A content team will not use git — no branches, no hand-written YAML frontmatter,
no merge conflicts, no PRs. If posts route through the CTO to be pasted into MDX
and committed, **the CTO becomes the CMS**: every typo fix and image swap is a
deploy. That works for ~4 posts, then stalls. Same graveyard, different cause —
friction, not motivation.

**Second problem: MDX + non-technical authors can red-build production.** MDX is
compiled; an unclosed tag or stray `<` fails the build. Combined with the strict
Zod schema (description 80–160 chars, enum'd authors), a writer can push something
that stops the whole site deploying and can't diagnose it. Plain MD mostly can't.
Mitigations, best first: (1) writers author plain MD, MDX reserved for us;
(2) required CI build check on the PR so a broken post blocks itself, not the site;
(3) Vercel preview deploys so they see the rendered post before publish.

## ⏸ PAUSED — decisions deferred (2026-07-23)

Both questions below were explicitly deferred by the user. **Do not build until
these are answered** — the authoring choice determines the architecture.

1. **Authoring workflow.** Options weighed:
   - *Git-based CMS at `/admin`* (Sveltia/Decap) — writer gets an editor UI, it
     commits Markdown to the repo. Keeps Zod validation, versioning, no vendor,
     free. Recommended. Caveat: GitHub OAuth on Vercel is 1–2h of genuine fiddle.
   - *Sanity* — team already knows it; best editor UX, roles, scheduling, assets.
     Trade: content leaves the repo, adds vendor + build webhook, replaces the
     Zod-fails-build design.
   - *Team writes, CTO commits* — zero build now, but permanent bottleneck.
   - *Team learns git + PRs* — free, full validation, only if they're comfortable.
2. **MD vs MDX for writers** — given the build-breaking hazard above. (The earlier
   "MDX from day one" decision predates knowing that non-technical authors would
   be writing, so it is worth re-confirming.)

## Other open questions

- Nav **label**: "Blog" vs "Field Notes" / "Notes" / "Dispatches" (URL stays `/blog`).
- Do posts need a **cover image** requirement, or is the generated OG card enough?
- Are marketing writers who aren't in `team.ts` valid `author` values? (The enum
  currently only allows the 5 team members — needs either new entries or an
  org-authored option.)
- Who writes the first 2–3 posts, and on what?
