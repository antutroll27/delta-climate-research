# Project Bangalore — Bengaluru in OBOS

**Date:** 2026-09-11
**Status:** design, approved for planning
**Branch:** `feat/bangalore-wards`
**Predecessor:** [2026-09-10 Bangalore ward design](2026-09-10-bangalore-obos-wards-design.md) — which produced the data and the Blender scenes this spec puts on screen.

## What this is

Bengaluru becomes **the twin's second city**, rendered in OBOS alongside Kolkata,
with Indiranagar, MG Road/CBD and Whitefield as its three wards.

Everything the wards need already exists: footprints with measured heights, a
fitted storey constant, terrain, water, roads, parks, canopy, and 47 named
landmark objects authored in Blender. **None of it can be opened by OBOS
today**, because the instrument admits exactly one city, one ward size and one
grid. This spec is the work that closes that gap.

The founder's framing, which decides several arguments below: *OBOS is the
engine and the data you feed it is the game disc.* The engine must therefore
stop assuming Kolkata, and the interface must state what disc is in the tray.

---

## 1. The decisions, and what settled them

| decision | choice | what settled it |
|---|---|---|
| Where the city lives in the UI | **A chip beside the ward tabs** | Only the current city's wards show below it, per the founder. No new furniture on a page where the map wants every pixel. |
| Country control | **Modelled, not rendered** | One country. A switcher with one entry is dead UI; the registry is `country › city › ward` from day one so the control can appear when a second arrives. |
| Grid | **384 for Bengaluru, and every city declares its own** | Measured, below. |
| Signature feature | **Named landmarks** | Founder's call. Bengaluru is the only city in the twin with a skyline a local would recognise. |
| Reach of the changes | **Bangalore leads, Kolkata inherits later** | Capabilities written per-ward rather than per-city, so Kolkata adopts them without a rewrite. |

### The grid decision was measured, not argued

Bengaluru's wards are 2.8 km against Kolkata's 1.4 km, and the engine's grid is
fixed at 192 cells. Keeping 192 gives 14.6 m cells; 384 gives 7.29 m, matching
Kolkata exactly.

**The ward mean is safe either way.** Rasterising the real footprints at both
resolutions moves the mean built fraction — the dominant solver input behind the
number on each ward card — by **0.02 % to 0.41 %**:

| ward | mean built @192 | @384 | change |
|---|---:|---:|---:|
| Indiranagar | 0.2724 | 0.2723 | −0.02 % |
| MG Road | 0.2882 | 0.2870 | −0.41 % |
| Whitefield | 0.2182 | 0.2177 | −0.21 % |

**The detail is not.** At 192 the 90th-percentile cell is 0.750 built; at 384 it
reaches 1.000, and the share of substantially-built cells rises three to four
points. At 14.6 m a cell always straddles building and street, so the field can
never resolve a street. At 7.29 m it can, and the field carries four times the
pixels over the same ground.

**An earlier claim in this project that the two would look identical was wrong**,
and is corrected here: 384 is visibly finer, which is a direct argument for it
given the brief is the best visuals in the twin.

**Every city declares its resolution regardless.** Matching Kolkata is right for
Bengaluru because the data supports 7.29 m. A third city may not have the data,
and the instrument must be able to say so rather than quietly degrade. Declaring
it costs nothing and is the same move as the height-provenance work.

---

## 2. Architecture: three inputs, three jobs

```
data/bangalore/<ward>-buildings.json ──┐
                                       ├─► public/heat-map/data/<ward>.json      → SOLVED
                                       │      footprint rings, rasterised into `built`
                                       │
data/bangalore/scenes/<ward>.blend ────┴─► public/heat-map/models/<ward>.glb     → DRAWN
                                              buildings merged + landmarks as named nodes

public/heat-map/data/<ward>-trees.json ──► Kolkata's existing instancing         → DRAWN
```

**Nothing is drawn from the rings and nothing is solved from the model.** This is
the separation the Dubai scenes enforce — geometry may be added, the physics
input may never be modified by it — and it is why the rings ship even though they
are no longer what the viewer sees.

### Why the model is affordable, measured

| | raw | gzipped |
|---|---:|---:|
| `mg-road-web.glb` (11,025 buildings + 12 landmarks, Draco) | 0.27 MB | **0.26 MB** |
| full Blender scene, for comparison | 12.40 MB | 3.32 MB |
| `ballygunge.json` (Kolkata ships this today) | 0.25 MB | 0.10 MB |
| `river-1k.glb` (the site already streams this on mobile) | 2.00 MB | 1.97 MB |

An earlier objection in this project that a model would be too heavy was wrong by
an order of magnitude. Draco on flat prisms is extremely effective. Trees,
terrain, roads and water are excluded from the model because OBOS draws each of
them from its own layer — and in water's case, **the solver reads it**, so it
must come from the artefact rather than from a mesh.

**Everything needed to load it already exists:** the river scene runs a glTF
loader with Draco and Meshopt decoders wired, and the decoder files are already
served from `/draco/`.

---

## 3. Picking does not change, and that is the pleasant surprise

Hover and selection never touched the building mesh. `building-pick.ts` projects
each footprint's centroid to screen space using the same clip matrix the renderer
draws with, because the city lives inside a MapLibre custom layer whose camera
cannot support a raycaster. It reads the ring array and nothing else.

**So swapping the geometry for a model breaks no interaction.** An earlier
concern in this project that a merged mesh would cost per-building identity was
unfounded; identity never came from the mesh.

---

## 4. The registry becomes country → city → ward

Wards are currently hard-coded in **four** places, and one of them is a type:

| where | what |
|---|---|
| `src/data/wards.ts` | the site registry (zone, body, coord, footprintM) |
| `src/scripts/climate-engine/wards.ts` | **`type WardId = 'ballygunge' \| 'baruipur' \| 'barrackpore'`** |
| `HeatMapStage.astro` tab strip | three hand-written buttons |
| `HeatMapStage.astro` ward cards | three hand-written cards with inline gradients |

**The union type is the real blocker.** It writes "there are exactly three wards,
and they are Kolkata's" into the type system, so a second city is not a data
change but a type change that ripples through every switch.

One registry replaces all four. Ward ids become city-scoped, because two cities
will eventually both have a "Ward 1".

---

## 5. The grid stops being one number

`SIM_N` is a module-level constant read in about twenty places across the model
and the app. It becomes a per-ward value carried with the ward's size.

**The guard changes shape, not just its value.** Today it throws unless the grid
is 192. It becomes a check that the grid and the ward size **agree as a pair** —
`(192, 1400)` and `(384, 2800)` are admitted, `(384, 1400)` and `(192, 2800)` are
not. That pairing is the bug worth guarding: a grid without its matching size
silently changes what a cell means while every array length still checks out.

---

## 6. What must be built, and the one that is not optional

**Already in hand:** footprints with measured heights, terrain, water, roads,
parks, canopy and trees, 47 named landmarks.

**The surface raster is required, and its absence fails silently.** Vegetation
reaches the physics from a per-ward image; `loadSurfaceRaster` returns null when
it is missing and the whole ward collapses to a **single uniform vegetation
value**. The heat field would then be driven by buildings alone, with no green
structure anywhere, and nothing would error. This means fetching and processing
Sentinel-2 over the two MGRS tiles the predecessor spec identified — the only
piece of this build with no Bangalore precedent, and therefore the likeliest
place to find a surprise.

**Also to build:** road-name labels, which Overture carries and we have not
pulled; and the layers and provenance manifests, derived from what we hold.

### A defect found while tracing this, and NOT fixed here

`Ward.veg` in `src/data/wards.ts` is documented as *"baseline vegetation fraction
— the thermal model's layer seed"* and **is read by nothing.** The solver takes
vegetation from the surface raster, falling back to the measured Sentinel value.
Kolkata's stored values (0.12 / 0.62 / 0.28) do not match the measured fractions
(0.329 / 0.447 / 0.309), which is not tuning — it is a number that stopped
mattering without anyone noticing.

**Bangalore will not propagate it.** Its entries carry the measured fraction, so
the field is at least true if anything ever reads it. Removing the field is the
correct fix and belongs in its own change, not smuggled into a city launch.

---

## 7. Landmarks, the signature feature

47 named objects already exist in the Blender scenes, each carrying its height
and the source of that height:

| ward | landmark objects | notes |
|---|---:|---|
| Indiranagar | **0** | correct, not a gap: 142 named buildings on measured evidence, none over 40 m |
| MG Road | 12 | 4 from published figures, the rest OSM-tagged |
| Whitefield | 35 | storey-derived; every tall building there is under construction and no registry lists them |

They travel through the model as separate named nodes. The interaction is: a
labelled tower, clickable, showing its name, its height and the citation behind
it. **A height with no stated source is not shown as a landmark** — the same rule
the Dubai scenes enforce, and the reason the stadium's estimated roof line is
flagged as estimated rather than cited.

---

## 8. Phasing

Each phase leaves the product working.

1. **Foundations** — registry becomes city-scoped, grid becomes per-ward, the
   pairing guard replaces the constant guard. No visible change; Kolkata must
   still pass every gate.
2. **Data** — convert the Bangalore artefacts, fetch Sentinel-2 and build the
   surface rasters, pull road labels, generate the manifests.
3. **Render** — the model path, with fallback. Bangalore appears.
4. **Landmarks** — the named layer and its interaction.
5. **City chip** — the switcher, and the declared resolution.

---

## 9. Failure modes

| failure | behaviour |
|---|---|
| grid and ward size disagree | build fails naming both values |
| the model is missing, or the device tier is low | fall back to procedural extrusion from the rings, which ship anyway — a slow connection degrades to today's Kolkata, not to nothing |
| the surface raster is missing | **must not pass silently.** Today it degrades to a uniform vegetation field with no warning; the build gates on its presence |
| a landmark has a height but no source | not drawn as a landmark |
| a ward id collides across cities | build fails; ids are city-scoped |

---

## 10. Testing

1. **The grid pairing** — `(192, 1400)` and `(384, 2800)` admitted, `(384, 1400)`
   and `(192, 2800)` refused. Mutation-checked: a test that cannot fail is not a
   test.
2. **Kolkata regression** — the three Kolkata wards produce the same field after
   the refactor as before. This is what makes "Kolkata inherits later" mean
   "Kolkata is untouched now".
3. **Frame gate extended** — the existing mirror check covers the new city.
4. **Landmark provenance** — every landmark object carries a height and a source;
   either missing fails.
5. **Browser load measured, then tuned** — 11,000 to 15,000 buildings per ward
   against Kolkata's 4,000. Measured first; the existing demotion tiers exist for
   this.

---

## 11. Out of scope, deliberately

- **Removing `Ward.veg`** — a real defect, its own change.
- **Kolkata adopting the model path, the city chip or a finer grid** — the
  capabilities are written to make it possible; doing it is a follow-up.
- **The provenance lens as a public toggle** — the strongest differentiator we
  identified, and explicitly deferred: the founder chose landmarks to lead.
- **Vidhana Soudha's massing, and the buildings Overture is missing** — carried
  from the predecessor spec; they are evidence work, not integration work.
