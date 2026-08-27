# OBOS scope model: Country → City → Area

Design, 2026-08-27. Spec 1 of 3 for the OBOS multi-city update.

**Sibling specs, not in scope here:** spec 2, the shell (icon rail, tabbed
sidebar, tokenised palette). Spec 3, onboarding Dubai's real data.

---

## Why

OBOS supports one city, and not by configuration — by construction. `WardId` is
a closed union of three Kolkata wards, data paths are a flat namespace, and four
constants that belong to India or to Kolkata live inside the physics module.

A city switcher bolted onto that would be a façade. Worse, it would be a
*plausible* façade: Dubai would render, and it would silently run on Kolkata's
heatwave percentiles, apply All-India warming deltas, and quote intervention
costs in rupees. Nothing would error.

This spec builds the foundation so the shell has something real to switch.

**Success is invisible.** When this lands, Kolkata renders byte-identically and
the only user-visible changes are a new URL shape and a greyed-out Dubai in the
city menu.

---

## What is already true

Measured, not assumed:

- **The physics does not know about ward identity.** `heat-map-model.ts`,
  `dc-urs.ts` and `sim-ts.ts` contain zero `WardId` references. The model takes
  `WardData` — data, not identity. This boundary is already clean and the design
  preserves it.
- `WardId` appears 25 times across 7 files: `wards.ts` (6), `compare/*` (10),
  `scenario/*` (6), `ward-loader.ts` (3).
- **17 data paths are built by raw string interpolation** across 5 files.
- `/heat-map/compare` ships (noindexed) and reads ward ids from `?a=` / `?b=`.
- There is **no URL state on the main heat-map page** at all. Nothing to break.

---

## 1. The registry

One `as const` object is the single source of truth. Nothing else declares a
country, a city, or an area.

```ts
export const REGISTRY = {
  in: {
    name: 'India',
    pathway: 'dhara2025',
    // NOT just a symbol: the VALUES are Indian too (₹150/m², ₹1,500/tree).
    // A currency code alone would relabel rupee figures as dirhams.
    costs: { currency: 'INR', roofM2: 150, tree: 1500, parkCr: 1.5 },
    cities: {
      kolkata: {
        name: 'Kolkata', koppen: 'Aw', tier: 'validated',
        // CITY-LEVEL data stems. These two files currently sit at paths that
        // imply they are global and are not — see §2.
        data: { heatwave: 'heatwave-percentiles', dcUrs: 'dc-urs-inputs' },
        areas: {
          ballygunge:  { name: 'Ballygunge',  descriptor: 'dense urban core',        file: 'ballygunge' },
          baruipur:    { name: 'Baruipur',    descriptor: 'peri-urban fringe',       file: 'baruipur' },
          barrackpore: { name: 'Barrackpore', descriptor: 'industrial river corridor', file: 'barrackpore' },
        },
      },
    },
  },
  ae: {
    name: 'United Arab Emirates',
    pathway: null,
    costs: null,                       // no AED figures sourced yet — control disables
    cities: {
      dubai: {
        name: 'Dubai', koppen: 'BWh', tier: 'geometry',
        data: { heatwave: null, dcUrs: null },
        areas: {
          creek:     { name: 'Dubai Creek', descriptor: 'area · our tiling', file: null },
          'al-quoz': { name: 'Al Quoz',     descriptor: 'area · our tiling', file: null },
          south:     { name: 'Dubai South', descriptor: 'area · our tiling', file: null },
        },
      },
    },
  },
} as const;
```

### The derived key

`AreaKey` is derived from the registry, so the type cannot drift from the data.
Adding a city is one edit, not an edit plus a type that can silently disagree.

```ts
type Registry = typeof REGISTRY;

type AreaKey = {
  [C in keyof Registry]: {
    [Y in keyof Registry[C]['cities']]:
      Registry[C]['cities'][Y] extends { areas: infer A }
        ? { [N in keyof A]: `${C & string}/${Y & string}/${N & string}` }[keyof A]
        : never
  }[keyof Registry[C]['cities']]
}[keyof Registry];
// 'in/kolkata/ballygunge' | 'in/kolkata/baruipur' | … | 'ae/dubai/al-quoz'
```

**The `extends { areas: infer A }` is load-bearing.** The obvious form —
`Registry[C]['cities'][Y]['areas']` — does not compile: TS2536, because
TypeScript cannot prove `['areas']` indexes a type still distributing over `Y`.
Verified both directions before this was written: the form above compiles clean
under `--strict`, rejects `'in/kolkata/typo'`, and still drives `switch`
exhaustiveness (a missing case fails as `not assignable to type 'never'`).

### Field semantics

| field | scope | meaning |
|---|---|---|
| `file` | area | data stem, or `null` for "no data ships" |
| `tier` | city | `validated` \| `zone` \| `geometry` |
| `pathway` | country | warming-pathway key, or `null` for "not defined here" |
| `costs` | country | intervention unit costs **and** currency, or `null` |
| `koppen` | city | climate zone, drives zone-calibrated constants |

**`file: null` is the tier mechanism, not a separate flag.** The UI reads it
directly: greyed row, reason line, no fetch attempted. Dubai registers with
`file: null` throughout — visible, disabled, honest.

**`pathway: null` is how a country declines a constant.** India points at
`dhara2025`; the UAE points at nothing, so the warming-pathway control disables
itself rather than applying Indian deltas to a Gulf city.

### Reserved slugs

`brief` and `compare` are real routes under `/heat-map/`. Astro resolves static
routes before dynamic ones, so a country registered under either slug would be
permanently shadowed and fail silently. The registry self-test rejects them.

---

## 2. Resolution and loading

### One path builder

17 call sites currently interpolate a bare ward name into a URL:

```ts
fetch(`/heat-map/data/${name}-trees.json`)   // and 16 more
```

Under the new key these become `/heat-map/data/in/kolkata/ballygunge-trees.json`
and 404. **Most are wrapped in `optional(...)` or `.catch()`**, so they would not
error — they would render a city with no trees, no roads and no provenance.
Silent degradation is the failure mode this codebase keeps paying for.

Replace all 17 with a single builder:

```ts
const p = paths(key);
// { ward, terrain, water, roads, labels, provenance, trees, surface, canopy, layers, heatwave }
```

`paths()` reads `file` from the registry, which **decouples the URL shape from
the key shape**. Data files stay exactly where they are —
`/heat-map/data/ballygunge.json` — while the key is `in/kolkata/ballygunge`.
Nothing on disk moves. Moving 30+ shipped files would be risk with no
user-visible benefit.

A test greps the source for `` `/heat-map/data/${ `` and fails if anyone
reintroduces one.

### The two files that lie about their scope

| file | contains | problem |
|---|---|---|
| `heatwave-percentiles.json` | a `city` key — Kolkata's P99 | path implies global |
| `dc-urs-inputs.json` | a `wards` key — the three Kolkata wards | path implies global |

Nothing in either name or path says Kolkata. A second city would inherit
**Kolkata's heatwave statistics** with no error anywhere — the same class of bug
as the Indian storey constant that under-predicted every Dubai building by 20 %.

Both become city-scoped through `paths()`. A city with no heatwave file resolves
to `null` and the heatwave phase disables itself, exactly as the warming pathway
does.

### `null` never reaches the network

`loadArea()` accepts only a key whose registry entry has a `file`. Areas without
one are unreachable by construction, so a disabled city cannot 404 in the
console.

---

## 3. Scoped constants

Four constants inside `heat-map-model.ts` belong to a country or a city:

| constant | scope | value | wrong for Dubai because |
|---|---|---|---|
| `PATH_DELTA` | country | All-India, Dhara et al. 2025 | no Gulf pathway exists |
| `COST` | country | **₹** 150/m², ₹1,500/tree | rupees, and Indian labour rates |
| `PARK_R_M` | city | 50 m, "Kolkata TVoE" | measured in Kolkata |
| `FALLBACK_TAIR` | city | 32 °C | Kolkata climatology; Dubai's is ~40 |

`COST` is the one a physics review would miss. It is a **currency**, and a Dubai
demo quoting rupees to DEWA would be quietly embarrassing in a way no existing
test catches.

### Constants resolve at the edge

The model already takes `SimParams`. It gains a `climate` bundle rather than
importing module constants:

```ts
currentParams({ live, phase, path, iv, climate })   // climate from resolve(key)
```

This preserves the boundary the codebase already has: the physics knows data and
parameters, never identity. Nothing in `heat-map-model.ts` learns what a country
is.

### Fail closed on the mistake, open only where declared

Today:

```ts
const baseTair = (s.heatTairC ?? obsTair) + (PATH_DELTA[s.path] ?? 0);
```

That `?? 0` **fails open** — an unrecognised pathway contributes zero warming and
says nothing. For the UAE, "no pathway" genuinely means zero, so it looks
correct. But a *typo* behaves identically, and the two cases are
indistinguishable.

Split them: absence declared in the registry (`pathway: null`) disables the
control and is never evaluated; an unknown key throws in development.

---

## 4. Two confidence axes, kept separate

```
PhaseAccuracy.confidence   quantitative | indicative     existing, measured
CityTier                   validated | zone | geometry   new, per city
```

`PhaseAccuracy` is measured over 50 night and 29 peak ward-scenes. It is **not**
renamed, reused, or merged.

Kolkata is `validated` **and** `indicative` at midday. Dubai would be `zone`
**and** `indicative`. Collapsing the two would either overclaim Dubai's nights or
underclaim Kolkata's, and the distinction was paid for in overpass data.

The UI shows tier on the city selector and phase confidence on the readout.

---

## 5. Routing

The site is static (no `output` in `astro.config.mjs`, so Astro defaults to
SSG). One new route file:

```
src/pages/heat-map/[country]/[city]/[area].astro
```

`getStaticPaths()` enumerates the registry — 6 prerendered pages today
(3 Kolkata areas + 3 Dubai), which
is a bonus: each area gets real HTML for first paint instead of one JS-booted
page. `heat-map.astro` becomes a redirect to the default scope
(`in/kolkata/ballygunge`, today's default). `brief.astro` and `compare.astro`
stay where they are.

### Compare-link compatibility

`/heat-map/compare` ships (noindexed) and reads `?a=ballygunge&b=baruipur`.
`isWardId()` **fails soft** — an unrecognised id falls back to the default, so
old links would not break loudly; they would quietly show the wrong wards.

`isWardId` becomes `isAreaKey`, plus a three-entry compat map so bare
`?a=ballygunge` still resolves to `in/kolkata/ballygunge`.

---

## 6. Migration order

Each step compiles and ships on its own.

1. `registry.ts` + derived `AreaKey` + self-test — new file, no consumers
2. `paths()` — replaces 17 raw interpolations across 5 files
3. `resolve()` + `ClimateConstants` — the four constants leave the physics
4. `WardId` → `AreaKey` — ~19 mechanical sites, all compiler-caught
5. Route + redirect + compare compat map
6. Dubai registered with `file: null`

---

## 7. Verification

### The proof that Kolkata is unchanged

Not "it looks the same" — eyeballing has produced false verdicts on this project
before. A golden-numbers test captures `currentParams()` output for
**3 wards × 2 phases × 3 pathways = 18 cases** before the change and asserts
byte-identical output after. Same discipline that settled the vegetation
regeneration, where determinism let `cmp` decide.

### Guards

New tests join `tests/unit/*.test.mjs` (Node's runner via tsx). Each is tied to a
specific failure:

| test | catches |
|---|---|
| `registry-selftest` | a country slugged `brief`/`compare` — Astro would shadow it |
| `no-raw-data-paths` | greps for `` `/heat-map/data/${ `` — the silent-404 return |
| `paths-resolve` | every area with a `file` resolves to a URL present on disk |
| `null-file-never-fetched` | a disabled city cannot reach the network |
| `constants-scoped` | `heat-map-model.ts` contains no `₹`, no `PATH_DELTA`, no `India` |
| `tier-vs-phase` | `CityTier` and `PhaseAccuracy.confidence` remain distinct types |
| `golden-params` | the 18 cases, byte-identical |

`constants-scoped` is a grep against the physics module. Blunt, and it is the
check that would have caught the rupees.

---

## 8. Done

- Kolkata renders byte-identically; its URL is `/heat-map/in/kolkata/ballygunge`
- Dubai appears in the switcher, greyed, tier `geometry`, and fetches nothing
- The warming pathway disables itself under the UAE
- Old `/heat-map/compare?a=ballygunge` links still resolve
- `npm run verify` green

---

## 9. Out of scope

Each is its own spec. Listed so nobody treats their absence as an oversight.

- The icon rail and tabbed sidebar (spec 2)
- Palette tokenisation — 12 hard-coded literals await promotion (spec 2)
- Dubai's real thermal data (spec 3)
- A manifest-driven or CMS-driven registry — YAGNI at two cities
- Light theme
- Per-city basemap styling
- Removing the vertical-green-facades control from production
