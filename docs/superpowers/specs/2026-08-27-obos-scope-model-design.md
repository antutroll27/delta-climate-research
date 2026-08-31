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
- **16 data paths are built by raw string interpolation** across 4 modules,
  plus **3 more built from a plain string** — 19 in total. (Corrected after
  implementation; see §10.)
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
    // FOUR fields, matching COST in heat-map-model.ts:70 field-for-field.
    // facadeM2 was missing from the first draft of this spec — see §10.
    costs: { currency: 'INR', roofM2: 150, tree: 1500, parkCr: 1.5, facadeM2: 9500 },
    cities: {
      kolkata: {
        name: 'Kolkata', koppen: 'Aw', tier: 'validated',
        // CITY-LEVEL data stems. These two files currently sit at paths that
        // imply they are global and are not — see §2.
        data: { heatwave: 'heatwave-percentiles', dcUrs: 'dc-urs-inputs' },
        // AREA IDS REFERENCE src/data/wards.ts — see "The four tables" below.
        // Name, lat, lon, footprintM, veg and body all live there already.
        areas: { ballygunge: {}, baruipur: {}, barrackpore: {} },
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
        // Dubai ships no data, so these are registry-only placeholders. Any
        // area that DOES ship data must exist in src/data/wards.ts — asserted.
        areas: {
          creek:     { name: 'Dubai Creek', descriptor: 'area · our tiling' },
          'al-quoz': { name: 'Al Quoz',     descriptor: 'area · our tiling' },
          south:     { name: 'Dubai South', descriptor: 'area · our tiling' },
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
| area key | area | must exist in `src/data/wards.ts` **if** it ships data |
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

### The four tables — the finding that reshaped this spec

A first draft of this design declared `lat`, `lon` and `footprintM` in the
registry. That would have created a **fourth** ward table. Three already exist:

| # | table | consumers |
|---|---|---|
| 1 | `src/data/wards.ts` | 3 TS modules, `verify-served-data.mjs`, mirrored by Python |
| 2 | `src/scripts/climate-engine/wards.ts` | `compare/`, `scenario/`, `ward-loader` |
| 3 | `scripts/_types.py` `WARDS` | 6+ Python scripts |

`src/data/wards.ts` is already the declared source of truth — its own header
says *"Widening from three wards to all 144 KMC wards must be a change to this
file alone"* — and `_types.py` mirrors it, with a comment recording that five
scripts once carried private copies which **had already diverged**, one of them
by 10–44 m of coordinate: sub-pixel at ECOSTRESS's 70 m, four pixels at
Sentinel's 10 m.

So the registry adds the **country and city layers above** table 1, and does not
restate geography. Table 2 is redundant with table 1 and is **deleted**, its
consumers repointed. Table 3 is untouched: Python keeps reading what it reads.

**The anti-divergence guard.** `assertRegistryLogic()` asserts that every area
which ships data exists in `src/data/wards.ts`, and that Kolkata's registry area
ids exactly equal that file's ids. A fourth table cannot appear by accident, and
the two that remain cannot silently disagree.

### Reserved slugs

`brief` and `compare` are real routes under `/heat-map/`. Astro resolves static
routes before dynamic ones, so a country registered under either slug would be
permanently shadowed and fail silently. The registry self-test rejects them.

---

## 2. Resolution and loading

### One path builder

16 call sites interpolate a bare ward name into a URL:

```ts
fetch(`/heat-map/data/${name}-trees.json`)   // and 15 more
```

A further **3 fetch the two pseudo-global files by plain string** — 19 in all,
across 4 modules. Those three matter disproportionately: a `${`-only search
misses them, and they are exactly the files that lie about their scope.

Under the new key these become `/heat-map/data/in/kolkata/ballygunge-trees.json`
and 404. **Most are wrapped in `optional(...)` or `.catch()`**, so they would not
error — they would render a city with no trees, no roads and no provenance.
Silent degradation is the failure mode this codebase keeps paying for.

Replace all 19 with a single builder:

```ts
const p = paths(key);
// { ward, terrain, water, roads, labels, provenance, trees, surface, canopy, layers, heatwave }
```

`paths()` reads `file` from the registry, which **decouples the URL shape from
the key shape**. Data files stay exactly where they are —
`/heat-map/data/ballygunge.json` — while the key is `in/kolkata/ballygunge`.
Nothing on disk moves. Moving 30+ shipped files would be risk with no
user-visible benefit.

A test greps the source for **any** `/heat-map/data/` literal outside
`scope/paths.ts` — not just interpolated ones. Three call sites fetch the two
pseudo-global files by **plain string**, so a `${` -only pattern would have
missed exactly the cases §2 is about.

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
2. `paths()` — replaces 19 hand-built URLs across 4 modules
3. `resolve()` + `ClimateConstants` — the four constants leave the physics
4. `WardId` → `AreaKey`, and **delete `climate-engine/wards.ts`** — its
   consumers repoint at the registry and at `src/data/wards.ts`
5. Route + redirect + compare compat map
6. Dubai registered with `file: null`

---

## 7. Verification

### The proof that Kolkata is unchanged

Not "it looks the same" — eyeballing has produced false verdicts on this project
before.

**Corrected after checking the signature.** `ScenarioState` carries
`{live, phase, path, iv, heatTairC, sunNow}` and **no ward** — `currentParams()`
is ward-independent, which is the identity-free boundary restated. So the golden
matrix is not over wards:

**2 phases × 3 pathways × 2 live states (null, fixed) × 2 heatwave states
= 24 cases**, captured before the change and asserted byte-identical after.

That covers exactly what §3 moves: `PATH_DELTA` and `FALLBACK_TAIR` both feed
`currentParams`, so any drift in extracting them shows up here. Ward-dependent
output needs no golden of its own — the ward data files do not move, and
`assertInterventionLogic()` already guards the layer maths. Same discipline that
settled the vegetation regeneration, where determinism let `cmp` decide.

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
| `golden-params` | the 24 cases, byte-identical |

`constants-scoped` is a grep against the physics module. Blunt, and it is the
check that would have caught the rupees.

---

## 8. Done

- Kolkata renders byte-identically; its URL is `/heat-map/in/kolkata/ballygunge`
- Dubai is **reachable at its own URL**, renders `no artefacts · geometry tier`,
  and fetches nothing. There is deliberately no city *switcher* in this spec —
  the ward strip shows same-city siblings only, and the Country/City/Area
  dropdowns are spec 2. (Wording corrected; see §10.)
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

---

## 10. Corrections after implementation

Shipped on `feat/obos-scope-model`, 2026-08-27. Four factual errors in the
original of this document, each corrected in the body above and recorded here.

They are recorded rather than quietly fixed for one reason: **three of the four
are the same mistake** — a number written from reading rather than from
measuring — and that mistake is the one this project has already paid for twice
(the Indian storey constant carried into Dubai, and the five Python ward tables
that had silently diverged by 10–44 m). A spec that corrects itself without
saying how is a spec whose next unmeasured number nobody thinks to doubt.

### C1 — the hand-built URL count

**Was:** "17 data paths are built by raw string interpolation across 5 files."
**Is:** 16 interpolating across 4 modules, plus 3 built from a plain string —
19 in total, across 4 modules.

*How it was caught:* the Task 3 implementer re-measured instead of trusting the
brief, and reported the discrepancy rather than adapting silently.

*Root cause:* I ran `grep -rn "heat-map/data/"`, counted the **lines** it
returned, and reported that as the interpolating-site count — then miscounted
the file total on top. The plain-string sites are not a rounding difference:
they are the two files that lie about their scope, and a `${`-only pattern
misses them, which is why the guard had to be widened.

### C2 — `costs` was missing a field

**Was:** `costs: { currency: 'INR', roofM2: 150, tree: 1500, parkCr: 1.5 }`
**Is:** the same plus `facadeM2: 9500`, matching `COST` field-for-field.

*How it was caught:* the Task 2 implementer followed the spec exactly, noticed
`heat-map-model.ts:70` declares four fields, and flagged it instead of patching
around it.

*Root cause:* I transcribed three of four. `facadeM2` is the largest at
₹9,500/m², and `computeCost` multiplies each field by a *different* spatial
quantity, so an absent one does not scale the total — it makes that term
`undefined`, and NaN poisons the whole sum.

*Worth noting:* the Task 1 golden would have caught it in Task 5 regardless —
`facades-only` is frozen at ₹296,875,000, which is linear in `COST.facadeM2`.
The safety net worked. Finding it four tasks earlier was still much cheaper.

### C3 — "Dubai appears in the switcher"

**Was:** a done-criterion reading "Dubai appears in the switcher, greyed."
**Is:** Dubai is reachable at its own URL and renders `no artefacts · geometry
tier`. There is no city switcher in this spec.

*Root cause:* I wrote a criterion describing spec 2's sidebar. The ward strip
deliberately lists **same-city siblings only** — putting Al Quoz in Kolkata's
strip would mix two climates and two currencies — so nothing in spec 1 offers a
city switch. Left uncorrected, this would have read as an unmet requirement.

### C4 — the golden matrix

**Was:** "3 wards × 2 phases × 3 pathways = 18 cases."
**Is:** 2 phases × 3 pathways × 2 live states × 2 heatwave states = 24.

Corrected during planning rather than after, but it belongs in the list.

*Root cause:* I proposed varying the matrix over wards without checking the
signature. `ScenarioState` carries `{live, phase, path, iv, heatTairC, sunNow}`
and **no ward** — `currentParams` is ward-independent, which is the
identity-free boundary this whole design rests on, restated in the one place it
would have mattered most.

---

## 11. What implementation found that this design did not anticipate

Not errors in the spec — discoveries. They are the useful inheritance for
specs 2 and 3.

**A FIFTH scoped constant.** §3 named four. `heat-map-app.ts:1264` also carries
`const WARD_TZ = 'Asia/Kolkata'`, driving four `Intl.DateTimeFormat` instances
and printed verbatim in the freshness tooltip. Its own comment argues for an
IANA zone over a fixed offset because an offset *"is the first thing that breaks
when a European or East Asian ward is added"* — and then hardcodes the zone. It
is unmigrated. A second city currently gets Kolkata's clock, weekday and AM/PM.

**FIVE silent-degradation sites from the bare-id / `AreaKey` split**, none
predicted here. In order of severity:

1. `surface-raster`'s `inputs?.[ward]` — a miss made it discard the texture and
   return **fvc 0**: a flat, plausible, wrong vegetation surface feeding the
   resilience score. A wrong number, not a blank panel.
2. `state.dcurs?.[state.ward]` — optional-chained into bare-keyed JSON, so the
   DC-URS panel blanks with no error.
3. `WARD_MAP[key]` — returns `undefined`, and `.name` then throws at **runtime**,
   not at build, because it is `Record<string, Ward>`.
4. Ward-strip highlights compared `dataset.w` (bare) against a key, silently
   losing every highlight on the first switch.
5. The header readout sat outside the no-data gate, so Dubai read
   `— buildings · SELECTING ENGINE` for ever: *still loading*, not *nothing here*.

The rule that emerged: **an `AreaKey` for anything internal, the bare area id for
anything indexing external data** — `WARD_MAP`, `dc-urs-inputs.json`, file stems,
DOM ids, the compare query string.

**SIX guards that passed while protecting nothing.** Every one compared against a
*copy* of the thing it guarded: literal `0.419` instead of `DEFAULT_PARAMS.Q`; a
re-typed regex instead of the walker's own; hardcoded token sets instead of the
declarations. One was the guard *guarding* another guard. Two were written by
the author of this spec. None was found by reading — each was found by breaking
the thing and watching what failed to happen.

A shared `stripComments` helper also truncated at the `//` in `https://`,
eating the rest of the line; **four** tripwires depended on it.

**The Task 6/7 boundary moved.** `paths()` takes an `AreaKey`, so tightening the
loaders forced their callers to hold one — which pulled the `heat-map-app.ts`
conversion out of Task 7 and into Task 6. Sequencing a migration by *file* fails
when the type system decides the order.

**The redirect mechanism.** The plan specified `Astro.redirect()`, which needs
SSR; this build is static. The house pattern is the `redirects` config in
`astro.config.mjs`, already in use for `/cbam-calculator`.

**Still India-shaped, and out of scope here.** `fmtCr` formats crore/lakh via
`toLocaleString('en-IN')` inside the physics module, with `₹` hardcoded at three
call sites, while `Costs.currency` is read by nothing in production. And on the
Python side, four scripts still hardcode the three-ward tuple and
`ecostress-census.py` still carries a private table 10–44 m from `_types.WARDS`.
**"A second city is a data change" is true on the TypeScript side only.**
