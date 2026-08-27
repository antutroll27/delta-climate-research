# The model and the satellite disagree about where Dubai flooded

Compiled 2026-08-27, overnight. This is the current honest state of flood-model
validation, including the parts that do not resolve.

## The short version

After replacing an invented storm with the observed one and fixing three solver
defects, the model still scores **below random placement** against the Landsat
flood extent. The reason is not accuracy — it is direction. The model floods
built-up Dubai; the satellite says the water was in the open.

Neither is obviously right, and the disagreement is now the finding.

## The measurement

Block-scale (~960 m) correlation over land cells:

| field | r vs building cover | r vs elevation |
|---|---|---|
| **Landsat observed** | **−0.183** | −0.250 |
| model, observed storm | **+0.736** | −0.341 |
| model, invented storm | +0.540 | −0.355 |

The elevation column has the right sign everywhere, so **routing works** — water
runs downhill in this model. The disagreement is entirely about where runoff is
*generated* and what *removes* it.

Put as shares of flooded area:

| | open (BCR ≤ 0.10) | built (BCR > 0.10) | built share |
|---|---|---|---|
| land available | 328.19 km² | 193.62 km² | 37.1 % |
| Landsat observed | 10.32 km² | 2.78 km² | **21.2 %** |
| model | 3.56 km² | 6.71 km² | **65.3 %** |

The domain is 37 % built. The model puts 65 % of its water there; the satellite
puts 21 %. They miss the baseline in **opposite directions**, which is why
tuning one parameter cannot reconcile them.

## What we tried, and what it did

Four 120 h runs on the observed hyetograph, one variable each:

| run | r vs built | r vs observed | wet km² |
|---|---|---|---|
| Landsat observed | −0.183 | +1.000 | 13.10 |
| baseline (38.6 mm/h, no drainage) | +0.736 | −0.067 | 1.24 |
| piped drainage 10 mm/h × BCR | +0.717 | −0.059 | 0.91 |
| piped drainage 25 mm/h × BCR | +0.687 | −0.043 | 0.62 |
| compacted ground, 15 mm/h | +0.848 | −0.112 | 10.26 |

**Drainage does not fix the sign.** The hypothesis was that built-up areas
flood less because they have storm drains, and sabkha has none. Adding drainage
proportional to built cover moved the correlation from +0.736 to +0.687 while
removing half the water — it shrinks the flood everywhere rather than moving it,
because the water is *generated* on the same cells the drainage empties.

**Note the tension in the last row.** Compacted urban ground at 15 mm/h produces
almost exactly the observed flooded *area* (10.26 km² against 13.10) while
having the *worst* placement of any run. Matching the headline number and
matching the map are different achievements, and only one of them is being
claimed here.

## Why the satellite may not be a fair referee

MNDWI change detection at 30 m has a documented weakness in dense urban fabric:
a pixel that is part roof, part road and part water does not move the index far
enough to cross a threshold. The data show exactly that pattern.

| built cover | % of cells over threshold | 95th percentile ΔMNDWI |
|---|---|---|
| 0.00–0.02 | 4.68 % | +0.1397 |
| 0.10–0.20 | 2.39 % | +0.0812 |
| 0.50–1.00 | 1.77 % | +0.0714 |

The detection threshold is **+0.15**. In open desert the wettest 5 % of pixels
nearly reach it. In dense city the wettest 5 % top out at half of it — a built
pixel essentially *cannot* be flagged, however wet it is.

This is consistent with two different stories, and the data here cannot fully
separate them:

1. Less water genuinely accumulated in built-up Dubai (drainage, grading, raised
   plots), or
2. The detector cannot see urban water, so the observation under-reports it.

What can be said is that April 2024's most-photographed flooding — roads,
underpasses, car parks, the airport — is precisely the flooding this instrument
is least able to confirm. **CSI against this target therefore penalises a model
for putting water where the news footage put it.** That is worth stating before
anyone tunes a model to maximise a score against it.

## What this means for the product

Do not claim a validated urban flood model. What is defensible today:

- the **terrain** is measured and corrected (see the terrain notes)
- the **rainfall** is observed, not invented
- the **routing** carries the right sign against elevation
- the **placement** is unvalidated in built-up areas, in both directions —
  the model may over-concentrate on roofs, and the reference may be blind

The honest headline is that the flood model reproduces *volume* under defensible
assumptions and does not yet reproduce *pattern* against a reference that may
itself be pattern-biased.

## What would actually settle it

A reference that can see water between buildings. Candidates, none yet tested:

- **Sentinel-1 SAR** — sees through cloud and is not a reflectance ratio, though
  urban double-bounce brings its own confusion
- **Geolocated ground observation** — dated, located photographs and press
  reports of the April 2024 event, treated as point truth rather than extent
- **Accepting the limit** — validate extent only in open terrain, and state
  plainly that urban placement is unvalidated

The third is free and honest, and should be the position until one of the first
two is done.
