# Dubai South accuracy — design

**Date:** 2026-09-05
**Site:** dubai-south (two of the four items also improve dubai-creek)
**Status:** design, approved for planning
**Follows:** `2026-09-04-dubai-landmark-massing-design.md`, which fixed the Creek

## What Dubai South is, and why the Creek's fixes do not transfer

The founder asked for "the same magic" applied to Dubai South. Measured against
the artefact, most of it cannot be, and saying so is the first job of this spec.

**Wikidata contributes exactly zero heights.** Two items with a height statement
fall inside the 28.4 km window — Nakheel Tower (1,400 m) and Victory of Robots —
and **both are unbuilt**, correctly rejected by the existing inception filter.
Everything Wikidata knows about this region sits in Dubai Marina, which is inside
the *Creek* window and was fixed there. The Creek's headline result, 23 corrected
heights, has no counterpart here.

**The boxes-skyline defect barely exists.** Dubai South has **41 buildings over
100 m** against the Creek's 530, of which 37 are prisms. There is no skyline to
rescue.

**Re-fitting the height prior globally is not worth it, and the first test that
said otherwise was degenerate.** A hold-out on all measured heights showed a
90–100 % error reduction. That result is meaningless: **76–81 % of "measured"
heights are `building:levels x 4.0`**, and 57 % of Dubai South is the single
value 8.0 m, so predicting 8.0 scores perfectly. Re-tested against only the
genuine `height=` tags, a global refit gives **+6 %** and is *worse* in three of
eight size bands.

What Dubai South actually is: Dubai Logistics City, JAFZA, Al Maktoum airport and
Expo City. Warehouses, terminals and exhibition halls. Its largest buildings are
its flattest, which is the opposite of the assumption the height prior encodes.

## Scope

Four items. Three are fully measured and ready; the fourth is gated on a source
that does not yet exist.

Out: any change to the Creek's landmark recipes; any procedural massing for
ordinary buildings; Palm Jebel Ali, which is largely undeveloped reclaimed land.

---

## 1. The `building=` filter drops real structures

`fetch-dubai-heights.py:188` queries:

    way["building"](...);
    relation["building"](...);

OSM does not tag every structure that way. **Terra — The Sustainability
Pavilion** carries `tourism=attraction`, `height=30`, `min_height=28`,
`roof:levels=0` — a floating disc canopy, fully described, and **absent from our
model** because it lacks a `building` key. So are roughly 27 Dubai Exhibition
Centre halls at 10–14 m.

The risk of widening is bounded and was measured, not estimated: **33 ways** in
the entire window carry a `height` or `building:levels` tag without a `building`
tag. Five are walls. The rest are real structures.

**Design.** Add a second Overpass clause for ways that carry `height` or
`building:levels`, excluding `barrier`, `wall`, `highway`, `landuse`, `natural`
and `boundary`. Records from this clause are ordinary outlines afterwards — they
carry a measured height, so they never touch the prior.

`min_height` already has a consumer: the `parts` path extrudes a slab from
`min_height` to `height`. Terra should reach it, so a widened record that carries
`min_height` is emitted as a part rather than a ground-up prism. Otherwise Terra
renders as a solid 30 m block instead of a canopy floating at 28 m.

**Zero authored geometry.** Every number here is OSM's own.

## 2. The height prior is wrong for large footprints, and only for large ones

The prior is `3 + 9·log10(1 + area/100)`, capped at 60 m — monotonically
increasing with footprint. Reality is not monotonic. Measured medians, from each
site's own buildings:

| band | Creek measured | South measured | prior |
|---|---:|---:|---:|
| 500–2,000 m² | 32 m | 8 m | 12.6 m |
| 2,000–10,000 m² | 33 m | 8 m | 17.0 m |
| 10,000–50,000 m² | 16 m | 10 m | 23.0 m |
| 50,000+ m² | 12 m | — | 30.0 m |

The same footprint means a tower in the Creek and a warehouse in Dubai South. One
global curve cannot serve both.

**Design.** Compute a per-site table of median measured height by area band, and
use it **only for footprints at or above 5,000 m²**. Below that threshold the
hold-out shows a fitted prior makes things *worse*, so it does not apply there.

Held out against genuine `height=` tags at or above 5,000 m², excluding every
levels-derived value:

| site | n | global MAE | fitted MAE | |
|---|---:|---:|---:|---|
| dubai-south | 45 | 15.16 m | **8.58 m** | **+43 %** |
| dubai-creek | 56 | 33.18 m | 32.69 m | +1 % |

**This is a Dubai South fix and barely touches the Creek**, which is the right
shape for the request. The Creek's large footprints are a mixed population —
podiums, malls and tower bases — with a spread a single median cannot capture, so
its fitted values land close to the global curve and change little. The table is
per-site and fitted from local data, so that self-correction is automatic rather
than a special case.

Bands and the populations this corrects:

| band | South n | South median | Creek n | Creek median | global prior |
|---|---:|---:|---:|---:|---:|
| 5,000–10,000 | 208 | 8 m | 260 | 20 m | ~20 m |
| 10,000–25,000 | 117 | 10 m | 88 | 16 m | ~23 m |
| 25,000–50,000 | 35 | 10 m | 16 | 11 m | ~26 m |
| 50,000+ | 5 | 10 m | 9 | 12 m | ~29 m |

**923 Dubai South buildings** and **607 Creek buildings** at or above 5,000 m²
carry no height and currently take the prior. In Dubai South they render **2.3 to
2.6 times too tall**.

A band with fewer than 25 measured samples is not trusted; it falls back to the
nearest populated band *below* it, not to the global prior — because the global
prior is the thing being corrected. Three of eight bands hit this (South 50,000+
at n=5, Creek 25,000–50,000 at n=16 and 50,000+ at n=9).

The table is computed by the fetcher from data it already holds and written into
the artefact, so Blender and any future three.js viewer read the same numbers
rather than each deriving their own.

**Zero authored geometry.** The prior is fitted from that site's own measured
buildings.

## 3. Persist OSM ids for Dubai South

The Creek carries `id` on every outline; Dubai South does not, because the change
landed after its last build. Same one-line change, same reason: coordinates are
not a safe key, and anything later wanting to name a building needs a stable
handle.

## 4. Al Wasl Dome — BLOCKED, and must stay blocked until a height is cited

The 130 m-wide trellis dome is the most recognisable structure in Expo City and
is **completely absent** from the model. OSM has only the paved plaza beneath it:
`w546958882` is `highway=pedestrian`, 114 × 115 m; `w986435237` is `place=square`.
No structure, no height.

**No open source consulted carries its dimensions.** OSM has no dimension tag.
Wikidata's `Q108748896` "Al-Wasl Plaza" holds exactly one claim — country.

The author of this spec has figures in mind (67.5 m tall, 130 m across) and they
are **unverified recall**, which produced two false findings during the Creek
work and must not be trusted here. So:

**The dome is specified but gated.** An implementer may add it only after
recording a citable source for its height in the recipe's `heightSource`. If no
such source can be found, the dome is not added and this item is closed as
blocked. Inventing the number is not an option, because the whole point of the
`provenance` machinery is that heights are facts and massing is not.

**Design, for when a source exists.** A `dome` builder in
`scripts/blender_landmarks.py`, taking a ring and a rise, producing a hemisphere
scaled to that rise. Its footprint is not in the buildings artefact — the plaza
is a pavement, and teaching the buildings fetcher that pavements are buildings
would be badly wrong. So the recipe format gains an optional `plan` array holding
the ring in site-local metres, with `planSource` naming the OSM way it was taken
from. A recipe carries either `osm` (a footprint in the artefact) or `plan`
(geometry of its own), never both.

The dome is a **lattice**, not a shell. A solid dome is a coarser approximation
than the Burj Al Arab's sail, and the evidence note must say so.

---

## The footprint gate, and why this feature legitimately moves it

`scripts/check-dubai-footprints.py` hashes every ring and fails on any change,
because `fetch-dubai-terrain.py:202` masks buildings out of the DSM using those
rings and nothing else.

**Item 1 adds rings** — Terra and the exhibition halls become footprints that
were not there before. That is a real change to the flood model's building mask,
and it is *correct*: those structures exist and rain does not pond on them
either. So the baseline is rebased deliberately, with the diff read, rather than
the gate being loosened.

Item 2 changes only heights and cannot move a ring. Item 4 adds a landmark whose
plan lives in the recipe file and never enters `osmB`, so it cannot move one
either.

The rule stays: **a footprint change must be intentional and reviewed.** After
item 1 the check is re-baselined once; every later task must pass unchanged.

## Failure modes

| failure | behaviour |
|---|---|
| widened query returns a wall or highway that slipped the exclusion list | it has a height tag and becomes a thin outline; the count assertion below catches a large influx |
| the widened clause adds far more than expected | build fails: the added-outline count is asserted against a measured bound (33 ways in this window, 5 of them walls) |
| a prior band has too few samples | falls back to the nearest populated band below; if none, the global prior, and the artefact records which bands were trusted |
| the prior table is missing from the artefact | the global prior is used and a warning is printed; the scene stays regenerable |
| the dome recipe has no `heightSource` | build fails. A landmark without a cited height is exactly what this project must not ship |
| a recipe carries both `osm` and `plan` | build fails; the two are alternatives and silently preferring one would hide a mistake |

## Testing

1. **Footprint gate**, re-baselined once after item 1, then unchanged for the
   rest of the work.
2. **The widened query's yield is bounded.** Assert the number of outlines added
   by the new clause is within a stated range, and that Terra is among them at
   `min_height=28`, `height=30`.
3. **Terra renders as a canopy, not a block.** Its geometry must start at 28 m,
   not at ground level.
4. **Prior hold-out, against genuine `height=` tags only.** Levels-derived
   heights are excluded from the test set, because including them is what made
   the first measurement meaningless. Mean absolute error above 5,000 m² must
   improve; below 5,000 m² the prior must be untouched, asserted by equality with
   the global curve.
5. **Mutation check on the prior.** Force every band to the global value and
   confirm test 4 fails.
6. **Band-trust rule.** A band with fewer than 25 samples must fall back to the
   nearest populated band below, not to the global prior. Assert on the South
   50,000+ band, which has n=5.
7. **The dome, if built:** its recipe must carry a non-empty `heightSource`, and
   a recipe carrying both `osm` and `plan` must be refused.

## Provenance

- **Items 1, 2, 3 add no authored geometry whatsoever.** Item 1 recovers OSM's
  own structures and heights; item 2 fits a prior from that site's own measured
  buildings; item 3 persists an identifier.
- **Item 4 is authored**, and is the only thing here that is. It joins the
  Creek's landmarks in `docs/evidence/dubai-authored-massing.md` under the same
  rule: a render of it is never evidence for a number.

## Deferred

- **Palm Jebel Ali.** Inside the window, largely undeveloped. Nothing to fix.
- **Al Maktoum terminal massing.** Concourse 1 is 481,308 m² with no height; the
  fitted prior will give it the large-band median rather than the global 36 m.
  Whether an airport concourse deserves authored form is a separate question.
- **The Creek's open items** — the wave crest, Ciel Tower, The Marina Torch —
  are unchanged by this work.
