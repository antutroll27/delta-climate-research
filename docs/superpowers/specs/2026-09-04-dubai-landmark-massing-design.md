# Dubai landmark massing — design

**Date:** 2026-09-04
**Site:** dubai-creek (the pattern generalises to dubai-south, not built here)
**Status:** design, approved for planning

## The complaint, and what measurement made of it

The founder's report was that landmarks in `dubai-creek.blend` are "either missing
or not designed like the real one (eg: The Burj Al Arab)". Measured against the
shipped artefact and the live scene:

**Confirmed. 461 of the 520 buildings over 100 m have no `building:part` record,
so they are drawn as vertical prisms.** The Burj Al Arab — matched on its exact OSM
name برج العرب جميرا at zero distance — is a 12-sided prism, 321 m tall, flat on
top. Its height is right. Its form is absent. This is visible in the viewport and
countable in the data; neither reading depends on a coordinate guess.

**Not fixable by re-fetching.** A live Overpass query over the Burj Al Arab's
bounding box returns **zero** `building:part` elements. The pipeline consumed
everything OSM has. The sail is not missing from our fetch; it is missing from OSM.

**Nothing is actually absent.** Jumeirah Beach Hotel is present (`w10316322`,
76 vertices, 104 m, correct) and so is the Museum of the Future. Two earlier
claims that they were missing came from matching landmarks to footprints by
centroid proximity, which fails on long concave plans — the hotel is 262 m long
and the test point fell 187 m outside it. The same flawed join also produced a
table of apparent height losses that survived name-based re-checking in only one
case. **Heights are broadly sound; form is the whole defect.**

**The one real height error has a known mechanism.** Burj Khalifa renders at
652 m against 828 m architectural. OSM carries no `height` tag on `w446646206`,
only `building:levels=163`, and the pipeline's fallback is `levels x 4.0 m`.
163 x 4.0 = 652. Exactly reproduced, not inferred.

## Scope

In: authored massing for a shortlist of true icons in the Creek window, plus
cited heights for those landmarks.

Out: procedural massing for the other ~450 tall prisms; any change to Dubai South;
any change to the systematic GlobalML/OSM base for the other 165,000 buildings;
facade detail or texturing.

## The blocker that comes first: the artefact has no stable handle

`osmB` records carry `{p, roof, name}` and **no OSM element id**. There is
therefore no reliable way to say "this footprint is the Burj Al Arab". Coordinate
proximity is not a substitute — it mis-identified buildings three times during
this investigation, once attaching a 328 m tower to a metro station. A recipe file
keyed on coordinates would fail the same way, silently, and would put a sail on
the wrong building.

`fetch-dubai-heights.py:342` builds each record from an element that already has
its id in hand:

    rec: dict[str, Any] = {"p": flat, "roof": tags.get("roof:shape", "flat")}

Adding `"id": f"{el['type'][0]}{el['id']}"` is a one-line change that unlocks the
whole feature and is independently useful for provenance.

## Architecture

Four units, each with one job.

### 1. `dubai-creek-landmarks.json` — the recipe file (tracked, hand-authored)

Small, human-readable, reviewable in one screen. Lives beside the other artefacts
in `public/flood-sim/data/` so a future three.js viewer can read the same file
Blender does. (No such viewer exists yet — `src/scripts/flood-sim/` contains only
`types.ts`. The placement is for when it does.)

    {
      "site": "dubai-creek",
      "provenance": "Massing is AUTHORED. Plans and positions are measured (OSM, ODbL 1.0). Heights are cited facts.",
      "landmarks": [
        {
          "osm": "w12700546",
          "name": "Burj Al Arab",
          "form": "sail",
          "height": 321.0,
          "heightSource": "CTBUH, architectural top",
          "params": { "apexVertex": 10, "expDepth": 2.8, "expWidth": 2.0,
                      "massFraction": 0.88, "mastRadius": 3.0,
                      "helipadZ": 212.0, "helipadRadius": 12.5 }
        }
      ]
    }

Every landmark carries `heightSource`. A height is a fact and facts are not
copyrightable, so citing one from CTBUH or Wikidata is free of licence risk —
but citing it is what makes it auditable, and this repo's standard is that a
number can be traced. `params` are shape tuning and are NOT facts; the
`provenance` line says so at the top of the file. The `exp*` values above are the
prototype's, carried forward as a starting point — settling them is a look-dev
pass against reference photography, not a design decision.

### 2. `blender_landmarks.py` — the form builders

One function per form family, imported by `blender_dubai.py`. Every builder takes
the **measured footprint ring** plus the recipe's params and returns verts/faces.
Builders never invent a plan.

The pattern is proven. For `sail`, the OSM plan already encodes the building: ten
vertices trace the membrane arc, and vertex 10 sits 76 m north-west as the spine
where the two wings meet. Scaling the measured ring toward that fixed spine as
height rises produces the sail. Verified in Blender: 363 verts, 354 faces, and the
result is unmistakable beside the prism it replaces.

Families and their shortlist, with real OSM ids:

| form | landmark | osm | height | source |
|---|---|---|---|---|
| `sail` | Burj Al Arab | `w12700546` | 321.0 | CTBUH architectural top |
| `twist` | Cayan Tower | `w195527255` | 306.4 | OSM `height`, matches CTBUH |
| `wave` | Jumeirah Beach Hotel | `w10316322` | 104.0 | OSM `height` |
| `torus` | Museum of the Future | `w1054289435` | 77.0 | OSM `height` |
| `link` | One Za'abeel Tower 1 | `w916056283` | 235.0 | OSM `height` |
| `link` | One Za'abeel Tower 2 | `w916056282` | 305.0 | OSM `height` |
| `height-only` | Burj Khalifa | `w446646206` | 828.0 | CTBUH architectural top |

`twist` is a rotation instead of a scale — the 90 degrees is published and citable,
so it is one number and roughly fifteen lines. `wave` is the same loft as `sail`
against a plan that already curves. `height-only` carries no form builder: Burj
Khalifa already has 37 `building:part` slabs and reads correctly; it needs its
height corrected and nothing else.

Atlantis The Palm is deliberately excluded. Its OSM record is Arabic-named
(فندق أتلانتس, h=90.2) and did not match the shortlist query cleanly; adding it
needs an id confirmed by hand first. It is a candidate for a later pass, not a
gap in this one.

### 3. `blender_dubai.py` — suppression and placement

`build_buildings` already skips footprints twice, for exactly this kind of reason:

    if b.get("parts"):   continue    # drawn from its massing slabs instead
    if b.get("sup"):     continue    # OSM has drawn this building properly

A third flag joins them. A footprint whose `id` appears in the recipe file is
skipped in the flat extrusion, and its landmark is built instead — as **its own
named Blender object** (`lm.burj-al-arab`), not merged into the 1.6 M-face
`buildings` mesh. Separate objects stay inspectable, swappable and independently
hideable; merging them would make every future landmark edit a surgery.

### 4. The rendering-only boundary

**Authored massing must never reach a number anyone quotes.** This is the same
principle already established for tiling: tiling is a rendering concern, never a
physics one.

The boundary is enforceable because it is narrow and verified.
`fetch-dubai-terrain.py:202` is the only place building data enters the physics: it
reads `{site}-buildings.json` and uses the footprint **rings** to mask buildings
out of the DSM so rain does not pond on rooftops. It reads `p`. It does not read
heights, parts, or massing.

So the rule is: **recipes may add geometry, and may never modify `p`.** As long as
footprints are untouched, the flood solve is bit-identical before and after this
feature. That is a testable claim, not a promise.

## Data flow

    OSM (ODbL)  --fetch-dubai-heights.py-->  osmB records, now carrying `id`
                                                     |
    landmarks.json (authored) --------------------->  |
                                                     v
                                    blender_dubai.py + blender_landmarks.py
                                                     |
                                    +----------------+----------------+
                                    v                                 v
                          `buildings` mesh                  `lm.*` objects
                          (prisms, unchanged)               (authored massing)

    fetch-dubai-terrain.py reads only `p` from the same artefact --> physics,
    unaffected by anything above.

## Failure modes and what happens

| failure | behaviour |
|---|---|
| recipe names an `osm` id not in the artefact | build fails loudly, naming the id. A silent skip would let a landmark quietly vanish after an OSM edit — the exact class of defect this feature exists to fix. |
| recipe names an unknown `form` | build fails, listing the known families. |
| `apexVertex` out of range for the ring | build fails, naming the landmark and the ring length. |
| footprint ring has fewer than 3 vertices | build fails; no landmark has a degenerate plan and silently drawing nothing would hide an upstream data loss. |
| recipe file absent | build proceeds with a printed warning and draws prisms. The scene stays regenerable from OSM alone; landmarks are an enhancement, not a dependency. |

Loud failure is right everywhere except the last case, because every other row
means the recipe and the data disagree, and disagreement is information.

## Testing

1. **Footprint invariance.** Hash every `p` ring in the artefact before and after
   the pipeline change. Identical, or the physics boundary is broken. This is the
   single most important test in the spec.
2. **Recipe/artefact join.** Every `osm` id in the recipe file resolves to exactly
   one `osmB` record. Fails if OSM renumbers or a building is redrawn.
3. **Suppression.** Each landmark's footprint appears exactly once in the scene —
   as an `lm.*` object and NOT also as a prism. A double-draw would wedge authored
   geometry inside a box, which is how the `parts` path failed before it was fixed.
4. **Height fidelity.** Each `lm.*` object's max Z minus its base equals the
   recipe's `height` within 0.5 m.
5. **Mutation check.** Change one recipe height by 50 m and confirm test 4 fails.
   A test that cannot fail is not a test.

## Provenance and honesty

The evidence library gets a note recording that the Creek scene contains authored
geometry, which landmarks, and on what basis. The distinction to keep visible:

- **Plans, positions, footprints** — measured, OSM, ODbL 1.0.
- **Heights** — cited facts, CTBUH or Wikidata, source named per landmark.
- **Vertical massing** — authored. Not a measurement. Not evidence.

A render of an authored Burj Al Arab must never be offered as support for a
number. The `provenance` line in the recipe file and the `lm.` object prefix both
exist so this stays obvious to whoever opens the file next.

## Deferred, deliberately

- **Dubai South.** Same machinery, different window, after the Creek lands.
- **The other ~450 prisms.** Rule-driven massing would fix the "it looks like
  boxes" feeling at city scale, but it invents geometry at a scale that needs its
  own honesty argument. A separate decision.
- **The orphaned CC0 height layer.** `fetch-dubai-wikidata.py` and
  `CTBUH_LANDMARKS` exist and nothing consumes them — `fetch-dubai-heights.py`
  references neither. Worth wiring eventually for the systematic base, but the
  landmark heights this spec needs come from the recipe file, so it is off the
  critical path.
- **Membrane curvature.** The Burj Al Arab's sail is doubly curved; the prototype
  spans it flat. A few lines, and a look-dev call rather than a design one.
