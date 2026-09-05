# Dubai Creek: authored landmark massing

The Creek scene contains geometry that is **not a measurement**. This records
exactly which, and on what basis, so nobody later cites a render as evidence.

## What is measured

- **Footprints, plans, positions, orientations** — OpenStreetMap, ODbL 1.0.
  Never modified by the landmark work. Gated by
  `scripts/check-dubai-footprints.py`, which hashes every ring in the artefact
  against a committed baseline and is wired into `npm run verify`.
- **Heights** — cited facts. Wikidata (CC0 1.0) and CTBUH, named per landmark in
  `public/flood-sim/data/dubai-creek-landmarks.json` under `heightSource`.
  A building's height is a fact, and facts are not copyrightable. The limit that
  does exist is EU/UK database right on *bulk* extraction, which a hand-entered
  list of landmarks does not approach.

## What is authored

The **vertical massing** of the landmarks in `dubai-creek-landmarks.json`. Each
is built by a function in `scripts/blender_landmarks.py` that reads the measured
plan and shapes only how it changes with height.

| landmark | OSM | form | height | source |
|---|---|---|---|---|
| Burj Al Arab | `w12700546` | `sail` | 321.0 m | CTBUH architectural top; OSM tag agrees |
| Cayan Tower | `w195527255` | `twist` | 306.4 m | OSM height tag; agrees with CTBUH |
| Jumeirah Beach Hotel | `w10316322` | `wave` | 104.0 m | OSM height tag (26 levels) |

This is an approximation with a documented method. It is not a scan and not a
photogrammetric model. It carries no facade detail, which is correct for a scene
where every other building is untextured massing.

**The plan does the identifying; the parameters only shape the profile.** The
Burj Al Arab's OSM footprint already encodes the building: ten vertices trace the
membrane arc, and the vertex farthest from the centroid — index 10, 76 m
north-west — is the spine where the two wings meet. Terrain confirms north-west
is open sea (−1.9 m) and south-east is land (+11.7 m), so the mast faces the
water and the membrane faces the beach.

## Why it was necessary

**461 of the 520 buildings over 100 m in this window have no OSM
`building:part` record**, so the pipeline draws them as vertical prisms. A live
Overpass query returns **zero** part elements for the Burj Al Arab: the data does
not exist upstream, so no re-fetch produces a sail. And Simple 3D Buildings is
stacked prisms even where coverage is complete — it cannot express a sail, a
twist or a torus at all.

## What was rejected, and why

- **Downloaded 3D models** (Sketchfab and similar). A large share of landmark
  models are photogrammetry derived from Google Earth captures, and provenance
  cannot be verified at scale. Viable only case by case with a confirmed CC0 or
  CC-BY source.
- **Generative 3D.** Fabricated geometry with no provenance, in a project whose
  argument is receipts rather than renders.
- **Upstream OSM mapping.** Correct for the stepped towers and worth doing, but
  slow, and Simple 3D Buildings still cannot make a curve.

## The boundary that keeps this out of the numbers

`scripts/fetch-dubai-terrain.py:202` is the only place building data reaches the
flood solve, and it reads the footprint **rings** alone, to mask buildings out of
the DSM so rain does not pond on rooftops. It never reads heights, parts or
massing.

So the rule is: **recipes may add geometry, and may never modify `p`.** The
flood solve is therefore bit-identical across this feature, and
`npm run check:footprints` proves it rather than asserting it. It is
mutation-tested: moving a single vertex by one centimetre fails it.

## What the automated checks could not catch

The first `wave` implementation tapered the plan on both axes, which turns a
262 m-long building into a point. The Jumeirah Beach Hotel rendered as a tent.

**Every automated check passed.** The geometry was closed, the height was exact
to 104.0 m, and no footprint had moved. It failed only on being looked at.

That is the standing limitation of this work: the gates prove a landmark is
*well-formed, correctly placed and the right height*. Nothing proves it looks
like the building. That requires a person and a reference photograph.

## Open

- The `wave` crest reads as a ramp rather than a curl, and which end should be
  high is unverified. `crestMin`, `crestPower` and `flip` control it.
- Ciel Tower (366 m) and The Marina Torch (352 m) carry single unqualified
  Wikidata height statements, with no architectural-versus-roof distinction
  recorded. Neither has a CTBUH entry in `_flood.py` to override it.


---

# Dubai South (2026-09-05)

**Everything done to Dubai South is measured. There is no authored geometry here
at all.**

## Structures the pipeline was dropping

The fetcher asked Overpass for `way["building"]`, and OSM does not tag every
structure that way. **Terra — The Sustainability Pavilion** carries
`tourism=attraction` with `height=30` and `min_height=28` — a fully described
floating canopy — and was absent from the model entirely. So were 14 Dubai
Exhibition Centre halls at 10–14 m, and two majlis.

They are now included at OSM's own heights. Terra renders as a 2 m disc floating
28 m above ground, verified in the scene: 19 vertices at z=99 and 17 at z=101
over a local ground of 71 m. That is what OSM described all along.

The query widening was bounded by measurement, not hope: 33 ways in the whole
window carry a height or storey count without a `building` key, five of them
walls. 17 survived the exclusion list, and every one was read before the
footprint baseline was moved.

## The height prior

The fallback curve `3 + 9·log10(1 + area/100)` is monotonic in footprint — it
assumes a bigger building is a taller one. That is a residential assumption, and
Dubai South is Logistics City, JAFZA and Al Maktoum, where the largest buildings
are the flattest.

Measured medians make the point:

| band | Creek | South | the curve |
|---|---:|---:|---:|
| 500–2,000 m² | 32 m | 8 m | 12.6 m |
| 2,000–10,000 m² | 33 m | 8 m | 17.0 m |
| 10,000–50,000 m² | 16 m | 10 m | 23.0 m |

Each site now fits a table from its own measured buildings, applied only at or
above 5,000 m² because below that a fitted prior measurably does worse. Effect
on the 1,202 affected Dubai South buildings:

- median height **20.0 m → 8.0 m**
- built volume **300.4 → 120.5 million m³ (−60 %)**
- Concourse 1, 481,308 m²: **36.1 m → 10.0 m**

Held out against genuine `height=` tags only, mean absolute error falls from
**14.95 m to 6.80 m**.

**An earlier version of that hold-out scored 100 % and was worthless.** It tested
against all "measured" heights, but 76–81 % of those are `building:levels × 4.0`
and 57 % of Dubai South is the single value 8.0 m, so predicting 8.0 is perfect
and proves nothing. `scripts/check-height-prior.py` now excludes every
levels-derived value, which is a harder test and the right direction for a check
whose job is to stop a false claim.

## Wikidata contributes nothing here

Two items with a height statement fall inside the Dubai South window — Nakheel
Tower (1,400 m) and Victory of Robots — and **both are unbuilt**, correctly
rejected. Everything Wikidata knows about this region sits in Dubai Marina, which
is in the Creek window.

## Al Wasl Dome is absent, and stays absent

The 130 m-wide trellis over Expo City's centre — the most recognisable structure
in Dubai South — is **not modelled**.

OSM has only the paved plaza beneath it (`w546958882`, `highway=pedestrian`,
114 × 115 m) and the square (`w986435237`, `place=square`). Neither carries a
dimension. Wikidata holds two items for it, `Q108748896` "Al-Wasl Plaza" and
`Q108748865` "Al-Wasl dome", and **each has exactly one claim: country.**

No height could be cited, so none was invented. A landmark whose height is
guessed is precisely what the `heightSource` field exists to prevent, and the
author of this note had a figure in mind that turned out to be unverifiable
recall — the same failure mode that produced two false findings during the Creek
work.

**If a source is found, the dome becomes a small job:** a `dome` builder and a
recipe carrying the plaza ring as an explicit `plan`. Until then it is a known,
recorded gap rather than a silent one.


---

# Dubai Creek, finishing pass (2026-09-05)

## Measured

- **A spatial height prior.** 87 % of Creek outlines carry no measured height, so
  the area curve decided almost the whole scene while treating a 1,500 m² plot in
  Downtown the same as a 1,500 m² warehouse. Each site now carries a grid of
  median measured heights per 600 m cell and size band. Held out against genuine
  `height=` tags, mean absolute error falls **20.76 m → 11.58 m**, and in the
  500–2,000 m² band where the Creek's towers sit, **47.43 m → 21.66 m**. Applied
  only below 5,000 m²: above it a large building's neighbours are small ones and
  the fitted area table does better. 152,942 buildings changed.
- **Heights no longer land on superseded footprints.** Almas Tower (363 m), The
  Marina Torch (352 m) and Ocean Heights (310 m) were attaching to GlobalML
  records OSM had already superseded — never drawn, and consuming the item so the
  real outline got nothing.
- **The Creek OSM refresh**, reviewed line by line: 47 buildings added, 18
  removed. Nothing tall was lost.

## Not built, and why

- **The Link (One Za'abeel).** Wikidata `Q106617648` exists but carries no height
  claim, only area. Its elevation above ground is not citable, so it is not
  modelled. The two towers are genuinely rectangular and are correct as prisms at
  235 m and 305 m.
- **Museum of the Future** and **Atlantis The Palm** keep their measured heights
  (77 m, 90.2 m) and stay as extruded outlines. Their plans do NOT encode their
  form the way the Burj Al Arab's did — that plan *was* the sail, ten arc
  vertices and a spine apex. A profile loft turns the Museum into a smooth ovoid,
  and the real building is a torus whose hole is the whole point; Atlantis
  becomes two wings with a low dip where the real one has a rectangular arch.
  Both would mean inventing the feature people actually recognise.

## The wave crest is a look choice, and is labelled as one

Three derivations were tried and rejected:

1. Tapering both plan axes, as `sail` does — gives a cone, because a 262 m
   building narrows to a point.
2. A roofline driven by the measured plan width — gives a central spike. The plan
   is a crescent, widest in the middle at 40.5 m and narrow at both ends, and its
   width does not track its height.
3. Reading the high end off the shoreline — the building runs *along* the beach,
   so both ends are equidistant from the sea.

So the crest is authored: `crestMin` 0.22, `crestPower` 0.65, chosen by looking
at three variants side by side. **Which end is high remains unverified**, and
`flip: true` reverses it if someone with a reference says otherwise.


## Procedural massing for the remaining prisms: DECIDED AGAINST (2026-09-05)

461 of the 520 Creek buildings over 100 m are plain vertical prisms. Giving them
rule-driven crowns, setbacks and tapers would be the single biggest visual change
available, and the founder was asked directly. **The answer was no, for now.**

It would not have introduced fake *data*. Footprints are untouched — and they are
the only building input the flood solve reads, since `fetch-dubai-terrain.py`'s
`h` array is the terrain heightfield, not building heights. Cited heights would
not move. No number anyone quotes would change, and no solver currently consumes
Dubai building shape at all.

It would have introduced fake *form*, and two costs decided it:

**Scale changes what the label can mean.** Four authored landmarks are
enumerable — this document names them and anyone can check. 461 procedurally
massed buildings are not. The honest caption becomes "most of the Creek skyline
is invented", which is a far heavier thing to carry into a room than "these four
are authored".

**A box is honest ignorance; a crowned tower is confident invention.** A prism
says "we do not know this building's shape". Procedural massing ADDS apparent
information that is not there, which makes the model look more knowledgeable than
it is. That is a worse failure than being visibly wrong, because it is harder for
a viewer to detect — the same shape as the tent that passed every automated gate.

**The live risk path, for whoever revisits this.** Nothing computes on Dubai
building geometry today: the shadow and solar scripts are Kolkata work and do not
mention Dubai. But if Track F ever generalises, invented setbacks would produce
invented shadows, and that WOULD be fake data. The separation today is that
nobody has wired it up, not that anything prevents it.

**If it is ever revisited, the condition is that the boundary must be structural
rather than procedural**: emit procedural massing as separate objects the way
`lm.*` landmarks are, and gate that no solver input can see that mesh. Then "it
cannot reach a number" is a property of the code rather than a promise in a
document.
