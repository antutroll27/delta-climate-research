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
