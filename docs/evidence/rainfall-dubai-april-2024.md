# The storm we modelled was not the storm that happened

Compiled 2026-08-27. One dataset, one finding, and the largest single error
this flood model has carried.

## The short version

Every rainfall figure in the flood model rested on a storm *shape* nobody
observed. The total was taken from the ground report — 142 mm on 16 April 2024
— but the **distribution of that rain through time was invented**: an
SCS-Type-II-like Gaussian burst over six hours, chosen because it is the
conventional design storm, not because Dubai did that.

It mattered far more than the choice of a design storm usually does, because
infiltration in this model is **intensity-resolved**. Rain that arrives slower
than the ground can absorb it produces no runoff at all. Rain that arrives
faster produces runoff at the difference. So the shape of the storm, not its
total, decides the answer.

## What GPM IMERG says

GPM IMERG Final Precipitation L3 Half Hourly, 0.1°, V07B. 145 granules across
15–17 April 2024 over the study window.

| wettest window | observed | our invented storm | error |
|---|---|---|---|
| 1 h | 18.1 mm | 57.3 mm | **3.2×** |
| 3 h | 36.8 mm | 113.3 mm | **3.1×** |
| 6 h | 49.6 mm | 119.8 mm | 2.4× |
| 24 h | 119.5 mm | 119.8 mm | 1.0× |

The total was right and the shape was wrong — which is the hardest kind of
error to notice, because every summary statistic anyone would check agreed.

The real event ran for **24 hours**, with half its rain spread across 8.5 h and
a peak of 21.1 mm/h at 04:30 UTC on 16 April. The invented storm packed half its
rain into 1.6 h and peaked at 61.3 mm/h.

## Why a 3× intensity error became an 11× runoff error

Bare sand in this model infiltrates at 38.6 mm/h. That number is not ours — it
comes from a measured wadi catchment and is the one calibrated infiltration
figure available for this event.

A 61 mm/h storm out-runs 38.6 mm/h everywhere. A 21 mm/h storm does not out-run
it anywhere on open ground; it only generates runoff where buildings have
replaced the ground, because roofs infiltrate nothing.

The consequence, at identical total rainfall:

| | invented storm | observed storm |
|---|---|---|
| runoff | 34.2 mm (28.6 % of rain) | 3.0 mm (2.5 %) |
| volume | 18.9 Mm³ | 1.67 Mm³ |
| land cells generating runoff | **100 %** | **15 %** |

**11.3× the runoff from the same rainfall.** The model had been over-predicting
flooded area by roughly 3× — 45 km² modelled against 14.8 km² observed by
Landsat — and this is where that came from. It was the storm, not the physics.

## The correction we did not make

The obvious next move was to conclude that two errors had been cancelling and go
adjust the infiltration constant too. The numbers say otherwise.

At the unchanged 38.6 mm/h, the real storm yields 1.67 Mm³ of runoff, which is
about **0.11 m spread over the observed 14.8 km²** — a plausible depth for the
shallow urban flooding that was actually photographed. For reference, 0.10 m
over that extent is 1.48 Mm³ and 0.30 m is 4.44 Mm³.

There was one error, not two. Worth recording, because "fix everything that
looks suspicious" would have introduced a real error while removing an
imaginary one.

## Shape from the satellite, total from the ground

IMERG reads **119.8 mm** over the window against the 142 mm ground report — a
16 % dry bias. This is expected rather than alarming: IMERG is known to
under-read extreme events over arid land, and the 0.1° (~11 km) footprint
averages away sub-grid peaks before a 4×3-cell box average smooths them further.

So the pipeline takes **timing and shape** from the satellite and **total** from
the ground report, rescaling one to the other, rather than trusting either
source for both. The satellite is the better witness to *when*; the gauge is the
better witness to *how much*.

This also means the observed peak of 21.1 mm/h is a floor, not a ceiling. Point
intensities in the real storm were certainly higher than an 11 km average can
show.

## Access notes, for anyone repeating this

**Use OPeNDAP, not the granules.** 145 files × 7.6 MB is 1.1 GB downloaded to
read twelve grid cells. The `.ascii` endpoint subsets server-side and returns
about 200 bytes per granule. Neither `h5py` nor `netCDF4` is needed.

**The EULA is a separate authorisation from the token.** A valid Earthdata
bearer token still returns **403** — not 401 — until the account holder accepts
the `nasa_gesdisc_data_archive` application agreement at urs.earthdata.nasa.gov.
The tell is a `resolution_url` in the response body. It is a legal agreement, so
only the account holder can accept it; no amount of retrying is going to help.

**Two indexing traps, both found by asking the file rather than assuming:**

- Dimensions are `[time][lon][lat]` — **longitude-major**, which is not the
  convention most gridded climate data uses. Verified by reading a 3×3 box and
  checking it against a single-cell read at the same index.
- The index is **floor, not round**. IMERG cell centres sit at x.x5, so 25.154°N
  belongs to the cell centred on 25.15. Rounding sends it to 25.25 — one cell,
  about 11 km north — where the reading is 6.13 mm/h instead of 7.42.

Both would have produced a plausible-looking hyetograph from the wrong place.
The fetcher now has a `--check` mode that asks the file for its own `lon`/`lat`
arrays and refuses to run if they drift.

**GES DISC throttles rather than failing.** Eight concurrent workers silently
lost 46 of 145 granules to HTTP errors; every one of them returned 200 when
retried alone. A rainfall series missing 32 % of its half-hours reads as sparse
data rather than as a busy server, so the fetcher backs off, uses four workers,
and refuses to write a series below 90 % coverage.

## Licence

NASA Earthdata open data policy — free reuse including commercial, attribution
only. Cite as: Huffman, G.J. et al. (2023), *GPM IMERG Final Precipitation L3
Half Hourly 0.1 degree x 0.1 degree V07*, Goddard Earth Sciences Data and
Information Services Center (GES DISC).

One of the few unambiguously clean sources in this project's stack.
