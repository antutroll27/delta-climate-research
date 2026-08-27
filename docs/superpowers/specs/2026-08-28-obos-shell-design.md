# OBOS shell: one console, and layers that declare what they need

Design, 2026-08-28. Spec 2 of 3 for the OBOS multi-city update.

**Sibling specs.** Spec 1, the scope model (`2026-08-27-obos-scope-model-design.md`)
— shipped on `feat/obos-scope-model`. Spec 3, onboarding Dubai's real data — not
yet written.

---

## Why

Spec 1 built the foundation and was deliberately invisible: Kolkata renders
byte-identically, and the only user-facing change is a URL. This is the half you
can see.

Today OBOS is a map with panels floating over it. There is no layer model — just
seven scattered visibility calls — and no way to reach a second city that a
person could find. The approved design is an ops console: an icon rail, a
Country → City → Area switcher, and a layer tree.

**The reason it can be built honestly now is spec 1.** Every switch the console
offers is backed by something real: the tier badge is a `CityTier`, the greyed
ECOSTRESS row is a city that genuinely ships no artefact, the "warming pathway
unavailable" notice is a country resolving to an empty table. In the mockup all
of those were hardcoded.

---

## 1. The layer registry

One `as const` table in `src/scripts/climate-engine/scope/layers.ts`,
deliberately shaped like `scope/registry.ts`.

```ts
export const LAYERS = {
  thermal: { label: 'Thermal field', items: {
    surface: { label: 'Surface temperature',   needs: 'surface', on: true },
    utfvi:   { label: 'Heat-stress bands',     needs: 'surface', on: true },
    cooling: { label: 'Cooling corridors',     needs: 'roads',   on: true },
    refuge:  { label: 'Refuge access (5 min)', needs: 'canopy',  on: false },
  }},
  green: { label: 'Green infrastructure', items: {
    canopy:  { label: 'Tree canopy (CHM)',     needs: 'canopy',  on: true },
    trees:   { label: 'Tree instances',        needs: 'trees',   on: true },
    coolroof:{ label: 'Cool-roof candidates',  needs: 'ward',    on: false },
  }},
  built: { label: 'Built form', items: {
    footprints: { label: 'Building footprints', needs: 'ward',   on: true },
    heights:    { label: 'Building heights',    needs: 'ward',   on: false },
    pv:         { label: 'Rooftop PV yield',    needs: 'pv',     on: false },
  }},
  ground: { label: 'Ground truth', items: {
    ecostress: { label: 'ECOSTRESS overpasses', needs: 'ecostress', on: false },
    street:    { label: 'Street-level imagery', needs: { cap: 'mapillary' }, on: false },
    stations:  { label: 'Air-quality stations', needs: 'stations',  on: false },
  }},
} as const;
```

### `needs` is the load-bearing field

A layer declares **what it depends on**, and availability is **derived** rather
than restated. It never declares "available in Kolkata".

There are **two kinds of dependency**, and the self-review found the second only
after writing the table above:

**An artefact** — a key of `AreaPaths` or `CityPaths`, resolved by `paths()`.
This covers twelve of the thirteen.

**A capability** — `{ cap: 'mapillary' }`. Street-level imagery fetches tiles
straight from `tiles.mapillary.com` with an access token and has **no local
artefact at all**; the whole feature tree-shakes out when `PUBLIC_MAPILLARY_TOKEN`
is unset. Its availability is a build-time fact, not a file on disk. Collapsing
that into the artefact axis would have meant inventing a file that does not
exist, purely so the model stayed uniform.

**Either way, availability is derived — and that is spec 1's lesson one dimension
over.** A per-layer city list would be a second copy of what the registry already
knows, free to disagree: the fourth-table defect, in the layer dimension.
Derived, a city that stops shipping trees disables Cooling corridors and Refuge
access on its own, and nobody has to remember.

### `paths()` gains four entries

The current `AreaPaths` has exactly ten keys, none of them `pv`, `ecostress` or
`stations`. Spec 2 adds them, and one carries a wrinkle:

| key | resolves to | note |
|---|---|---|
| `pv` | `pv-{area}.json` | **PREFIX, not suffix.** Every other artefact is `{area}-{kind}`; the PV files shipped as `pv-ballygunge.json`. `paths()` special-cases it rather than renaming three shipped files. |
| `ecostress` | `{area}-ecostress.json` | new artefact, built from `data/calibration/ecostress-suhii.csv` |
| `stations` | `{city}-stations.json` | **city-level**, like `heatwave` — stations are not per-area |

Each returns `null` where the artefact is absent, exactly as the existing ten do,
so a city without them disables those rows with the artefact named.


Three consequences:

- **`LayerId` is derived**, as `AreaKey` was: `'thermal/surface' | 'ground/stations' | …`.
  A typo is a build error and `switch` exhaustiveness works.
- **Disabled means disabled *with the artefact named*.** Never hidden, which reads
  as "does not exist"; never a live control that does nothing, which is the
  defect the spec-1 audit found twice.
- **A guard asserts every `needs` resolves.** An artefact dependency must name a
  real key of `AreaPaths` or `CityPaths`; a capability must name one the app
  actually checks. A layer depending on something nobody produces would
  otherwise sit permanently greyed and look deliberate — indistinguishable from
  a city that simply lacks the data.

### What the thirteen cost

| status | layers |
|---|---|
| exist today | surface, canopy, tree instances, footprints, heights, street-level |
| **cheap — data already computed or shipped** | UTFVI bands, cooling corridors (`corridorSorted`), cool-roof candidates, **rooftop PV** (`pv-*.json` on disk, UI never built) |
| moderate — needs new work | refuge access (distance transform), ECOSTRESS (offline CSV → browser artefact) |
| points, not a field | air-quality stations |

---

## 2. The shell

`HeatMapStage.astro` is 1,050 lines. Adding a rail, five panes and a layer tree
inline would push it past 1,600 while holding markup, styles, the switcher, the
tree and five panes of controls. It is extracted by responsibility instead:

```
HeatMapStage.astro          shell + map container + runtime-styled widgets
  ├── IconRail.astro        5 sections, active state, tooltips
  ├── ScopeSwitcher.astro   Country → City → Area, tier badge
  ├── LayerTree.astro       groups, checkboxes, live n/total, disabled + reason
  └── InterventionPane.astro  today's toolbox, content unchanged
```

### The rail is the only navigation, and it carries the mode

Explore and Compare stop being top tabs. They become **where the rail has taken
you**:

```
│■│ Map        → Explore   /heat-map/{country}/{city}/{area}
│▣│ Layers     → sidebar pane
│╱│ Analysis   → Compare   /heat-map/compare
│▤│ Reports    → sidebar pane
│◔│ Scenarios  → sidebar pane
```

`PairedBench.astro` adopts the same rail and switcher, so both routes render one
shell. Three things this settles:

- **One console, not two.** Compare currently has its own header, nav and layout;
  moving to it should not feel like leaving the tool.
- **The scope block finally makes sense on Compare.** It holds two areas; the
  Analysis pane is the natural home for the A/B pair, and the Country/City
  selection above scopes both sides at once — which is right, because comparing
  across countries would mix two climates and two currencies.
- **`aria-current` stops lying.** No link claims to be the page it navigates away
  from; the rail's active state *is* the answer.

**Constraint:** the Analysis pane must not permit an A and a B in different
cities. Spec 1's `nextDistinctArea` already stays inside the city, and
`fromLegacyWard` handles the shipped `?a=` / `?b=` spellings.

### Scoped styles for the new components — and only the new ones

The current 581-line block is `is:global` for a real reason: MapLibre injects its
own DOM and `heat-map-app.ts` creates and re-classes elements at runtime. Astro's
scoped styles hash selectors against markup **it** rendered, so runtime-created
elements never receive the hash and scoped rules never apply to them.

That reason does not extend to the new components. The rail, switcher and tree
are fully Astro-rendered and static — the app only toggles `aria-current` and
`checked` on elements that already exist. So they use **scoped** styles, and
`is:global` stays only where JS creates or mutates DOM.

This shrinks the global surface rather than growing it, and stops the `:global()`
trap — which `HeatMapStage.astro` already warns about twice, at lines 689 and
853 — from spreading to four new files. A `:global()` inside an `is:global` block
ships verbatim and the browser discards the entire rule.

### Tokens

`#6fcad6` currently appears **five times as a literal *and* as `--cyan`**. The
same two-copies defect the scope migration spent two days deleting, in CSS. The
twelve elevation and layer literals from the mockup become tokens, and a guard
greps the stylesheets for any hex equal to a declared token's value.

**Not moving:** the five floating widgets (`#clockw`, `#vegw`, `#tiphint`,
`#coolTag`, `#bcard`) stay inside the map. They are map-anchored — they point at
things — and a sidebar would break what they mean. Only the sidebar reorganises.

---

## 3. The new layers, and where their methods come from

No invented constants. Each new layer names a published method or a figure
already cited in this codebase.

### Heat-stress bands — UTFVI

```
UTFVI = (LST − LST_mean) / LST_mean
  < 0      excellent, no thermal stress      < 0.015  bad
  < 0.005  good                              < 0.020  worse
  < 0.010  normal                            > 0.020  worst
```

**It is normalised to the field's own mean, and that is why it was chosen.** It
transfers to Dubai; absolute °C bands would not — 38 °C is a hot day in Kolkata
and an ordinary one in Dubai, so a band set calibrated on one is simply wrong in
the other. There is no universal absolute LST heat-stress threshold; the
literature is explicit that values vary by study and application. Inventing one
would repeat the storey-constant mistake.

**The legend must say "relative to this area's mean."** A reader who takes
"worst" as an absolute has misread it, and that misreading is on us.

### Refuge access — WHO 300 m

WHO's standard is a green space of at least 0.5–1 ha within 300 m, about a
five-minute walk. Two constraints follow:

- **Existing refuge, not proposed parks.** `parkCenters` are intervention
  *candidates*; using them would render the intervention's effect as the
  baseline. Existing green ≥0.5 ha comes from the canopy raster.
- **Network distance, not Euclidean.** The literature is explicit that 300 m
  linear overstates access, since real walking time varies with network and
  terrain. `road-layer.ts` gives us the network. For a heat-refuge claim,
  overstating is the dangerous direction.

### Cool-roof candidates

No new source needed: `ALB_BASE = 0.15` and `ALB_COOL = 0.60` (LBNL) are already
cited in the model. A candidate is a roof whose current albedo sits near the
base and whose area clears a threshold.

### Rooftop PV yield

Data already on disk. It carries the caveat we measured: shading loss is a
**ratio**, so the packing factor cancels and that figure is ours; MWp and GWh
scale linearly with a packing factor imported from a Mumbai sample, so any
capacity number quotes the floor and says so.

### Air-quality stations — points, never a field

Only one of the three wards has a monitoring station. AQI cannot be a
within-ward field; interpolating a surface from a single point would be
rendering a fabrication. Stations render as points with their readings, and the
sparseness is the message — it shows the reader why there is no surface instead
of hiding it behind a smooth one.

---

## 4. Verification

**The goldens must hold, unchanged.** Nothing here touches the physics: UTFVI is
derived *from* the LST field, cool-roof candidates display existing albedo,
cooling corridors render an array already computed. If `data/calibration/` moves,
a display layer has reached into the model.

**Every guard must be watched to fail before it counts.** Six guards in spec 1
passed while protecting nothing, and every one compared against a *copy* of the
thing it guarded.

| guard | catches |
|---|---|
| `layer-needs-resolves` | an artefact `needs` that is not a real path key, or a capability `needs` nothing checks |
| `layer-availability-derived` | a layer declaring its own city list |
| `no-dead-controls` | a rendered control that neither acts nor explains itself |
| `tokens-not-literals` | a hex equal to a declared token's value |
| `scoped-not-global` | a new component using `is:global`, or `:global()` inside one |
| `utfvi-is-relative` | the legend losing "relative to this area's mean" |
| `refuge-uses-network` | the distance transform falling back to Euclidean |

The last two are content guards, which is unusual. Both protect a *claim*, and
this project has twice shipped a wrong claim from a correct number.

---

## 5. Done

- Kolkata renders as before; `git diff -- data/calibration/` empty
- The rail is the only navigation; Explore/Compare top tabs gone; both routes
  share one shell
- Country → City → Area switches on both routes, with the tier badge
- All 13 layers present: each renders or is greyed with its artefact named
- Dubai still fetches nothing, and its tree is honestly almost entirely disabled
- No hex in any stylesheet duplicates a token value
- `npm run verify` green

---

## 6. The risk worth naming

**This is the first change in the sequence a returning user will feel.** Spec 1
was invisible by design. This deletes the top tabs and moves navigation into a
rail — if the rail is wrong, it is wrong in the way people notice immediately.

The mockup at `preview-obos/shell.html` is the reference, and the branch should
be driven on localhost before it lands, the same way spec 1 was.

---

## 7. Out of scope

- Making refuge access respond live to the tree slider — an intervention readout,
  not a layer, and a clean follow-on once the layer exists
- Dubai's thermal data (spec 3)
- Light theme; per-city basemap styling
- The five Important findings deferred by the spec-1 audit — in particular the
  four Python scripts that still hardcode the ward tuple, which is not a UI
  problem

---

## 8. A note on where these documents live

Spec 1's design and plan were written on `feat/solar-shadow`, and this joins
them there — but neither is on `main`, which is why the spec-1 worktree could
not see its own spec. That is a small instance of the divergence these specs
keep being about. **Both specs and both plans should land on `main`** rather than
living on an unrelated feature branch.
