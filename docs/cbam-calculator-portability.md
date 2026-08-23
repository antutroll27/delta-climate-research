# Porting the CBAM calculator to the Astro site

**Status:** verified 2026-07-21 by extracting the engine into a clean directory and running it.
**Scope:** move a working CBAM certificate estimator onto a second, Astro-based site.
**The GeoCBAM SaaS keeps its estimator unchanged.** Nothing in this document removes or alters
the `/estimate` screen at `geocbam-ledger.vercel.app`; every instruction is additive.

---

## 1. Verdict

**Yes, and it is a small job.** The calculator was built to compute entirely in the browser, so
there is no server to migrate and no API to stand up. The compute path is:

```
8 TypeScript files  +  1 npm package (decimal.js)  +  1 static JSON file
```

That is the whole engine. No Vue, no Pinia, no auth, no database, no network call.

**This was tested, not assumed.** The eight files were copied into an empty directory with a
`package.json` containing only `decimal.js`, and run:

```
PRICED  status=cscf_pending emissions=136.4
        scenario={"assumedCscf":"1","faaTco2e":"64.935","netTco2e":"71.465",
                  "certificates":"71.465","costEur":"5385.60"}
REFUSED status=unavailable selector=benchmark/72241010/column-B/(F)/2026-03-15
ROUTES  72083800/IN = ["(C)"]
```

Same figures the SaaS produces, outside the SaaS. Both the priced path and the fail-closed
refusal path work standalone.

Effort estimate: **Option A ≈ 1 day. Option B ≈ 2–3 days.** See §4.

---

## 2. Anatomy: exactly what moves

### 2.1 The engine (mandatory, framework-free)

Computed by walking every `import` from the entry point until closure. This list is complete.

| File | Lines | What it does |
| --- | --- | --- |
| `lib/estimator/estimate-from-pack.ts` | 213 | **Entry point.** Selects the default factor, applies mark-up, calls the engine. |
| `lib/cbam/certificate-estimate.ts` | 295 | The certificate figure: free allocation, CBAM factor, CSCF gating, price. Owns the discriminated-union result type. |
| `lib/cbam/sefa.ts` | 234 | `SEFA_g,y` — specific embedded emissions after free allocation. |
| `lib/cbam/resolve-fa.ts` | 164 | Benchmark lookup (CN + column + production route). |
| `lib/cbam/types.ts` | 83 | `FreeAllocationTables` and friends. |
| `lib/regulatory/iso-3166.ts` | — | Assigned alpha-2 validation + the `OTHER` residual sentinel. |
| `lib/regulatory/types.ts` | — | Rule-package row shapes. |
| `lib/errors/domain-error.ts` | — | `DomainError`, the fail-closed throw. |

**External dependencies: `decimal.js` only** (`^10.6.0`). Everything else is stdlib.

### 2.2 The data

| File | Size | Notes |
| --- | --- | --- |
| `public/estimator-pack.json` | 7.2 MB raw, **279 KB over the wire** | 574 classifications · 41,100 default factors · 2,465 benchmarks · CBAM factors · CSCF · prices · sources |

Generated, never hand-edited, by `scripts/build-estimator-pack.mts` from the two golden rule
packages. A drift-guard test regenerates it deterministically and diffs against the committed
copy, so the browser can never compute from stale numbers.

### 2.3 The UI (only if you take Option A)

| File | Role |
| --- | --- |
| `src/views/EstimateView.vue` | The form (CN picker, origin, route, mass, date) |
| `src/stores/estimator.ts` | Pack loading + `routesFor` / `run` wrappers. **Clean:** imports only `@lib`, never the API client. |
| `src/components/case/CertificateExposurePanel.vue` | Composes the three result cards |
| `src/components/case/cards/WhatIfCard.vue` | The figure, the what-if framing, the refusal state |
| `src/components/case/cards/DeductionWaterfallCard.vue` | The subtraction bar + the terms |
| `src/components/case/cards/DisclosureCard.vue` | Provenance stamp, residual-basis note |
| `src/components/case/cards/InstrumentCard.vue` | The flat card shell |
| `src/components/case/cards/use-estimate-view.ts` | Narrows the union into display props |
| `src/components/case/cards/instrument-viz.ts` | Pure geometry (bar widths) |
| `src/components/ui/StatusTag.vue` | The pill |
| `src/components/ui/PageHeader.vue` | **Not ported.** App chrome (title + context line); the Astro page supplies its own heading. Listed because it *is* in `EstimateView.vue`'s import closure — copying that file verbatim without dropping the `PageHeader` import will fail to resolve. The island in §5.6 already drops it. |

### 2.4 The tests (bring them — see §6.1)

58 tests guard this engine: `certificate-estimate.test.ts` (15), `estimate-from-pack.test.ts`
(17), `sefa.test.ts` (12), `pack.test.ts` (9, incl. the drift guard), `differential.test.ts` (5,
incl. the 382/183 pin).

---

## 3. Recommended architecture: one engine, two consumers

**Do not copy-paste the engine into the Astro repo.** Two copies of regulatory maths will drift,
and drift means two different legal answers under one brand — which is the specific failure the
differential test exists to prevent.

```
       ┌──────────────────────────────┐
       │  @geocbam/cbam-engine        │   8 files + pack + 58 tests
       │  (npm workspace or private   │   depends on: decimal.js
       │   registry package)          │
       └───────────┬──────────────────┘
                   │
        ┌──────────┴───────────┐
        ▼                      ▼
   GeoCBAM SaaS           Astro site
   (Vue, authed)          (public, marketing)
```

Cheapest credible version: publish to a private npm registry (or GitHub Packages) and version it.
If that is too much ceremony right now, a **git submodule or `npm install github:org/repo#tag`**
also works and still gives you a single source of truth.

---

## 4. Two options

### Option A — mount the existing Vue component as an Astro island (recommended)

Astro is built on Vite and supports Vue as a first-class integration, so the components you
already polished drop in more or less unchanged.

**Pros:** fastest; the UI, the honesty copy, and the refusal states all carry over intact.
**Cons:** ships a framework runtime to a marketing site that may not otherwise need one; the
cards use GeoCBAM's design tokens, so you either bring the tokens or restyle.

For scale: this repo's built app chunk — Vue + Pinia + router + the whole SPA shell — is **32 KB
gzipped** (`dist/assets/index-*.js`, measured). Vue's runtime alone is the bulk of that. Against
a 279 KB pack the framework is not the dominant cost either way.

### Option B — reuse the engine, rebuild the UI in the Astro site's own framework

**Pros:** no extra framework runtime; visually native to the marketing site.
**Cons:** you rewrite the form and the result panel — and, critically, you must re-implement
every honesty state (refusal, CSCF-pending, residual basis). That is where mistakes get made.

**Recommendation: Option A.** The result panel is not decorative; it encodes which claims the
product is allowed to make. Re-typing it is the riskiest part of this migration for the least
benefit.

---

## 5. Option A, step by step

### 5.1 Install the Vue integration

```bash
cd <astro-site>
npx astro add vue          # installs @astrojs/vue and wires astro.config.mjs
npm i decimal.js pinia
```

`astro.config.mjs` afterwards:

```js
import { defineConfig } from 'astro/config'
import vue from '@astrojs/vue'

export default defineConfig({
  integrations: [vue()],
})
```

### 5.2 Bring the engine

Either install the shared package (§3), or, for a first spike, copy the eight files preserving
their relative structure:

```
src/cbam-engine/
  cbam/certificate-estimate.ts
  cbam/resolve-fa.ts
  cbam/sefa.ts
  cbam/types.ts
  estimator/estimate-from-pack.ts
  errors/domain-error.ts
  regulatory/iso-3166.ts
  regulatory/types.ts
```

The internal imports are relative (`../cbam/sefa`), so as long as the tree shape is preserved,
nothing needs editing. **Preserve the directory layout** — flattening the files breaks every
import.

### 5.3 Add the path aliases

The SaaS uses `@` → `src` and `@lib` → `lib`. If you keep the Vue components, replicate them.

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*":   ["./src/*"],
      "@lib/*": ["./src/cbam-engine/*"]
    }
  }
}
```

`astro.config.mjs`:

```js
import { fileURLToPath } from 'node:url'

export default defineConfig({
  integrations: [vue()],
  vite: {
    resolve: {
      alias: {
        '@':    fileURLToPath(new URL('./src', import.meta.url)),
        '@lib': fileURLToPath(new URL('./src/cbam-engine', import.meta.url)),
      },
    },
  },
})
```

### 5.4 Ship the pack

Copy `public/estimator-pack.json` into the Astro site's `public/`. It is served as a static
asset and fetched once, lazily, on first use.

**Verify compression is on.** Raw it is 7.2 MB; gzipped it is 279 KB. Vercel and Netlify do this
automatically. A plain nginx or S3 origin may not — check before launch:

```bash
curl -s -o /dev/null -w "%{size_download}\n" --compressed https://<site>/estimator-pack.json
# want ~279000, not ~7200000
```

### 5.5 Fix the type import (mandatory — see §6.2)

In the four card files and `use-estimate-view.ts`, change:

```ts
import type { CertificateEstimate } from '@/stores/case'      // ← SaaS-only path
```

to:

```ts
import type { CertificateEstimate } from '@lib/cbam/certificate-estimate'
```

### 5.6 Create the island

`src/components/CbamCalculator.vue` — adapted from `EstimateView.vue`, minus the app chrome:

```vue
<template>
  <div>
    <!-- Non-negotiable. See §7. -->
    <div class="cbam-banner">
      Prototype estimator · Commission default values only · decision-support, not a
      declaration · computed in your browser from the same published rules. For a 2026 import
      no final figure exists (the cross-sectoral correction factor is unpublished); the number
      below is a labelled what-if.
    </div>

    <div v-if="store.error">Could not load the rule pack: {{ store.error }}</div>
    <div v-else-if="store.loading && !ready">Loading published rule values…</div>

    <div v-else class="cbam-grid">
      <section>
        <label>
          <span>Good (CN code)</span>
          <input v-model="cnQuery" list="cn-options" placeholder="e.g. 25231000 — cement clinker">
          <datalist id="cn-options">
            <option v-for="c in cnMatches" :key="c.code" :value="c.code">{{ c.description }}</option>
          </datalist>
        </label>

        <label>
          <span>Country of origin</span>
          <select v-model="country">
            <option value="" disabled>Select origin…</option>
            <option v-for="c in store.countries" :key="c.code" :value="c.code">
              {{ c.name }} ({{ c.code }})
            </option>
          </select>
        </label>

        <label>
          <span>Production route</span>
          <select v-model="route" :disabled="availableRoutes.length === 0">
            <option v-if="availableRoutes.length !== 1" value="" disabled>
              {{ availableRoutes.length ? 'Select route…' : 'Choose good and origin first' }}
            </option>
            <option v-for="r in availableRoutes" :key="r" :value="r">
              {{ routeText(r) }}
            </option>
          </select>
        </label>

        <label><span>Net mass (t)</span>
          <input v-model="massT" type="number" min="0" step="any"></label>
        <label><span>Import date</span>
          <input v-model="date" type="date"></label>
      </section>

      <!-- aria-live: the figure and the refusal both need announcing -->
      <aside aria-live="polite">
        <CertificateExposurePanel v-if="estimate" :estimate="estimate" />
        <div v-else>Choose a good, origin, route, mass and import date to see the provisional exposure.</div>

        <p v-if="store.generatedFrom.length">
          Rules: {{ store.generatedFrom.map(s => `${s.id}@${s.version}`).join(' · ') }}
        </p>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import CertificateExposurePanel from './case/CertificateExposurePanel.vue'
import { useEstimatorStore } from '../stores/estimator'
import { ROUTE_GLOSSARY } from '../scripts/cbam-route-glossary'

const store = useEstimatorStore()

// The bare letter does not tell an importer which route is their plant's, and the choice is
// expensive: on 72061000 at the VERIFIED tier, (C) and (E) differ by 2.9x the certificates.
// The letter stays IN FRONT — it is what the corpus, the CSV export and the refusal selectors
// all speak. `label` is OURS, plain English; the Commission's verbatim wording is the glossary's
// `quote`, and the two are never presented as the same thing. 'default' is not an Annex
// indicator, is not in the glossary, and is always alone in its list — which is what makes
// "single route" accurate.
const routeText = (r: string) =>
  r === 'default' ? 'single route' : `${r} ${ROUTE_GLOSSARY[r]?.label ?? ''}`.trim()

const cnQuery = ref('')
const country = ref('')
const route = ref('')
const massT = ref('100')
const date = ref('2026-03-15')

const ready = computed(() => store.classifications.length > 0)
const year = computed(() => Number(date.value.slice(0, 4)) || 2026)
const chosenCn = computed(() => store.classifications.find(c => c.code === cnQuery.value) ?? null)

const cnMatches = computed(() => {
  const q = cnQuery.value.trim().toLowerCase()
  const all = store.classifications
  if (!q) return all.slice(0, 30)
  return all.filter(c => c.code.includes(q) || c.description.toLowerCase().includes(q)).slice(0, 30)
})

const availableRoutes = computed(() =>
  chosenCn.value && country.value
    ? store.routes(chosenCn.value.code, country.value, year.value)
    : [])

const estimate = computed(() => {
  // The DATE belongs in this gate, and the idle copy above names it for the same reason.
  // `year` above falls back to 2026 so the route list can populate before a date is chosen —
  // that fallback is fine and stays — but the estimate must not inherit it: an <input type="date">
  // the user clears holds '', the engine reads its first four characters as calendar year 0, no
  // published row is keyed on 0, and the panel refuses by naming the RULES ("the Commission
  // publishes no default value for this good, origin, production route or year") for a line whose
  // only problem is a blank date. Gate on all five fields, not four.
  if (!chosenCn.value || !country.value || !route.value || !massT.value || !date.value) return null
  if (!availableRoutes.value.includes(route.value)) return null
  return store.run({
    cn: chosenCn.value.code, country: country.value, route: route.value,
    massT: massT.value, date: date.value,
  })
})

watch(availableRoutes, routes => {
  if (routes.length === 1) route.value = routes[0]
  else if (!routes.includes(route.value)) route.value = ''
})

onMounted(store.loadPack)
</script>
```

### 5.7 Pinia setup

The store uses Pinia. Astro islands do not share an app instance, so create one in the island's
entry. Simplest approach — a tiny wrapper that installs Pinia before mounting:

`src/components/CbamCalculatorIsland.vue`

```vue
<template><CbamCalculator /></template>

<script setup lang="ts">
import CbamCalculator from './CbamCalculator.vue'
</script>
```

and register Pinia via an Astro Vue app entrypoint (`astro.config.mjs`):

```js
vue({ appEntrypoint: '/src/pages/_app' })
```

`src/pages/_app.ts`:

```ts
import type { App } from 'vue'
import { createPinia } from 'pinia'

export default (app: App) => {
  app.use(createPinia())
}
```

**Alternative if you would rather not add Pinia at all:** the store is 83 lines of plain
`ref`/`computed`. Inline it into the component as local refs and drop the dependency. The engine
does not care.

> **Verify this against current Astro docs.** §5.1 and §5.7 describe `@astrojs/vue`'s
> integration and `appEntrypoint` API, which is the only part of this document that could not be
> checked against your own code. Everything else here was verified by running it. Astro's
> integration API moves between majors; confirm the option name before budgeting time on it.

### 5.8 Use it in a page

```astro
---
// src/pages/cbam-calculator.astro
import Layout from '../layouts/Layout.astro'
import CbamCalculator from '../components/CbamCalculator.vue'
---
<Layout title="CBAM certificate estimator">
  <h1>CBAM certificate estimator</h1>
  <CbamCalculator client:load />
</Layout>
```

`client:load` is deliberate: the calculator is the reason people are on the page. If it sits far
below the fold, `client:visible` saves the hydration cost until it scrolls into view.

---

## 6. Potential issues

Ordered by how much time they will cost if missed.

### 6.1 Two copies of the engine will drift — the highest risk here

Regulatory maths in two places diverges the moment one side is patched. The consequence is not a
UI bug: it is your marketing site quoting a different legal figure than your product, under one
brand.

**Mitigation:** §3's shared package. If you must copy for a spike, copy the **tests too** and run
them in the Astro repo's CI. The 58 tests are what make the engine trustworthy — an engine
without them is just arithmetic that looks right.

Especially: `differential.test.ts` pins `{ priceable: 382, stranded: 183 }`. If that number moves
on either site without a deliberate decision, something upstream changed silently.

### 6.2 The cards import their type through the SaaS store

`WhatIfCard.vue`, `DeductionWaterfallCard.vue`, `DisclosureCard.vue`,
`CertificateExposurePanel.vue`, and `use-estimate-view.ts` all do:

```ts
import type { CertificateEstimate } from '@/stores/case'
```

`src/stores/case.ts` re-exports the type from `lib/cbam/certificate-estimate` (line 4 imports,
line 7 re-exports), but the store itself imports Pinia, Zod, and the **authenticated API client**.

Because these are `import type`, they are erased at runtime — the compiled island will not pull
the API client in. But **TypeScript compilation will fail** in a repo that has no
`@/stores/case`. Fix as in §5.5. One line per file, five files.

### 6.3 Extensionless imports break Node's native ESM resolution

The engine imports look like:

```ts
import { OTHER_ORIGIN } from '../regulatory/iso-3166'   // no .ts / .js
```

Vite (and therefore Astro) resolves this fine. **Node's native ESM does not**, and this is not
theoretical — it is the first thing that happened when the extraction was tested:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../regulatory/iso-3166'
imported from .../estimator/estimate-from-pack.ts
```

Consequences:

- **Astro island (Option A): no impact.** Vite handles it.
- **Publishing as an npm package: impact.** Either compile with a bundler before publishing
  (recommended: `tsup`, which rewrites specifiers), or add explicit extensions.
- **Node-side prerendering / SSR of the estimate: impact.** Use `tsx` or a bundled build.

### 6.4 The pack is a build artifact, not a source file

`public/estimator-pack.json` is generated from `golden/rule-packages/*.json` by
`scripts/build-estimator-pack.mts`. It is **not** regenerated in CI — it is regenerated by hand:

```bash
npx tsx scripts/build-estimator-pack.mts
```

A drift-guard test (`pack.test.ts`) regenerates deterministically and diffs, so a stale pack
fails CI in the SaaS repo. **The Astro site will have no such guard unless you add one.** If the
corpus is updated and only the SaaS pack is regenerated, the marketing site silently keeps
quoting last quarter's numbers.

**Mitigation:** ship the pack *inside* the shared package so a version bump moves both, or add
the drift test to the Astro repo.

### 6.5 The 183 stranded goods will be publicly visible

574 goods are offered; **382 price and 183 fail closed** (India/direct/2026 selector). Those 183
resolve a default value and then cannot compute free allocation, because the Commission's Column
B publishes benchmarks under a finer production-route vocabulary than the default-values workbook
uses. See `docs/research/route-vocabulary-gap.md`.

On the authenticated SaaS this is a known limitation. **On a public marketing site, a prospect
can hit it in their first thirty seconds** by typing a steel CN code, and 181 of the 183 are iron
and steel.

The behaviour is correct — it refuses rather than inventing a number, and it names the missing
rule. But the copy matters more in public. Consider a plain-language line for the unavailable
state, e.g. *"The Commission has not published a benchmark we can match to this production route,
so we do not show a deduction rather than guess one."*

Do not "fix" this by picking a benchmark. That decision is pending regulatory research (PR #43).

### 6.6 Publishing the pack exposes the full corpus

Behind the SaaS login, the rule pack sits behind auth. On a public site, anyone can download
`estimator-pack.json`: 41,100 default factors, 2,465 benchmarks, and the transcription work.

The underlying data is the Commission's and is public. The *cut, structure, and normalisation*
are yours. This is likely an acceptable trade for lead generation — but it is a decision to make
deliberately, not discover later.

### 6.7 Design tokens

The cards use GeoCBAM tokens: `bg-card`, `bg-teal`, `bg-gold`, `text-ink`, `text-muted`,
`text-dim`, `text-teal`, `text-gold`, `text-goldbright`, `text-danger`. If the Astro site does
not run Tailwind with the same `@theme` block, these class names resolve to nothing and the panel
renders unstyled.

Two ways out: copy the `@theme` block from `src/assets/main.css`, or restyle the four card files.
Copying the tokens is far less work and keeps the two products visually related.

### 6.8 Native form chrome

`color-scheme: dark` on `:root` is what keeps the date picker and select panels from opening as
white boxes on a dark page. If the Astro site is dark, bring it. If it is light, drop it.

### 6.9 Intl.DisplayNames

`stores/estimator.ts` uses `new Intl.DisplayNames(['en'], { type: 'region' })` for country names.
Universally supported in modern browsers; if the Astro site prerenders any of this in an old Node
runtime, verify availability there.

---

## 7. Non-negotiables

These are not styling preferences. They are why the tool is defensible.

1. **The framing banner ships with the calculator.** Prototype · default values only ·
   decision-support, not a declaration · the CSCF is unpublished so the figure is a labelled
   what-if. On a public page with no login and no context, this does *more* work, not less.

2. **Fail-closed behaviour must not be softened.** When the rules do not price a good, the
   correct output is a named refusal, never an estimate, never zero, never a placeholder. The
   `unavailable` state carries the missing rule's selector — keep it.

3. **CSCF-pending must stay labelled.** The 2026 cross-sectoral correction factor is unpublished.
   The figure shown assumes CSCF = 1.0 and says so. Never present it as final.

4. **Never claim EU CBAM Registry filing or validation**, and never present the figure as a
   monetary liability.

5. **The residual-basis note travels.** When a figure rests on the Commission's residual bucket
   rather than the origin's own published values, `RESIDUAL_BASIS_NOTE` says so on the same
   surface as the number. It is set unconditionally in `baseOf()` so it survives on every result
   branch — do not "clean that up."

Points 1–5 are already enforced inside the engine and cards (`NO_DEFAULT_REASON`,
`RESIDUAL_BASIS_NOTE`, `INDIRECT_UNSUPPORTED` are engine constants). **This is the strongest
argument for Option A:** take the components, and the honesty travels automatically. Rewrite
them, and every one of these becomes something a developer must remember.

---

## 8. Verification checklist

Before the Astro calculator goes live:

- [ ] `25231000` / Algeria (DZ) / route `(A)` / 100 t / 2026-03-15 → embedded **136.4 tCO2e**,
      free allocation **64.935**, chargeable **71.465**, cost **€5,385.60**, status
      `cscf_pending`. (Matches the SaaS exactly.)
- [ ] `72241010` / India / route `(F)` / 60 t → status `unavailable`, selector
      `benchmark/72241010/column-B/(F)/2026-03-15`, no figure shown.
- [ ] `72083800` / India → routes `["(C)"]`, prices cleanly.
- [ ] The framing banner is visible without scrolling.
- [ ] Pack served compressed (~279 KB, not 7.2 MB).
- [ ] The 58 engine tests run green in the Astro repo's CI (or the shared package's).
- [ ] Result region announces to screen readers (`aria-live="polite"`).
- [ ] Both sites report the same `Rules: …@v1 · pack <date>` provenance line.

---

## 9. Suggested sequence

1. **Extract the shared package** (½ day) — 8 engine files + pack + 58 tests, published private
   or via git tag. Point the SaaS at it first and confirm 366 tests still pass. *The SaaS keeps
   working exactly as it does today; only its import paths change.*
2. **Spike the island** (½ day) — install `@astrojs/vue`, mount the component, fix the five type
   imports, confirm the three checklist figures.
3. **Style pass** (½–1 day) — tokens or restyle, per §6.7.
4. **Public-copy pass** (½ day) — the unavailable-state wording of §6.5, and confirm the framing
   banner reads correctly to someone with no CBAM context.

Steps 1 and 2 are the real work. Steps 3 and 4 are what make it presentable to a stranger.
