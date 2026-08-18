# Phase-2 AQI overlay — design

**Date:** 2026-08-13 · **Status:** approved (CEO) · **Scope:** design only, no code this round

## Why this needs a design note before any code

"We shall be using APIs for it" (CEO, 2026-08-13) runs into a constraint our own evidence library already
recorded. **Every API that hands you a finished AQI number is closed to us, and the one that is
commercially clear hands you pollutants instead:**

| source | verdict (`docs/evidence/data-sources.md`) |
|---|---|
| WAQI / aqicn | ToS **forbids commercial/paid use** and cached redistribution |
| Open-Meteo hosted free tier | non-commercial |
| OpenAQ, Google Air Quality, Ambee, IQAir | no browser CORS / key exposure |
| **CPCB via data.gov.in** (`3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69`) | **GODL-India — commercial OK**, but *"raw pollutant concentrations, not a computed AQI; needs a proxy"* |

So the overlay cannot be a passthrough. That "proxy" is the CPCB sub-index calculation, and writing it is
the actual Phase-2 job.

## The finding that shapes everything else

All seven Kolkata stations in the archive we hold (`data/opencity/aqi-daily.json`) sit in central and south
Kolkata:

```
ballygunge  bidhannagar  fort-william  jadavpur  rabindra-bharati  rabindra-sarobar  victoria
```

**Only `ballygunge` maps to one of our three simulated wards. Barrackpore and Baruipur have no station at
all.** Within Ballygunge it is a single point.

So the honest product is *one station reading in one ward of three*, and there is no version of this data
that supports a within-ward air-quality field. This is exactly the trap in the closest published analogue —
Naveed et al. 2025 (Environmental Modelling & Software 192:106559) floods an entire city one colour from one
scalar and calls the result a digital twin (its Figs 18–21). **We must not repeat that with better
graphics.**

## Decisions

### 1 · Standard: CPCB (India), named on the surface
The data is Indian, the regulator is Indian, and the station archives are CPCB-derived. The engine states
which standard it uses wherever a number appears — an AQI of 150 means different things under CPCB and EPA.

**Breakpoints are transcribed from the official CPCB source and cited, never from memory and never from the
Naveed paper** — that paper mixes the two standards (its Fig. 1 is CPCB, NH₃ included; its Table 1 and Fig. 2
are US EPA), so it is an unsafe source for exactly the numbers we would be copying.

Authorities, in preference order:
- CPCB Expert Group final report — [`FINAL-REPORT_AQI_.pdf`](https://app.cpcbccr.com/ccr_docs/FINAL-REPORT_AQI_.pdf)
- CPCB AQI calculator workbook (the breakpoint table in machine-readable form) —
  [`AQI-Calculator.xls`](https://app.cpcbccr.com/ccr_docs/AQI-Calculator.xls)
- [CPCB National AQI landing page](https://cpcb.nic.in/National-Air-Quality-Index/)

Eight pollutants carry sub-indices under CPCB: **PM10, PM2.5, NO₂, SO₂, CO, O₃, NH₃, Pb** (note: NO₂, not
the NOₓ the paper's Fig. 1 shows, and CPCB includes Pb where the paper lists seven). Six categories: Good,
Satisfactory, Moderately polluted, Poor, Very Poor, Severe.

### 2 · The maths
Sub-index is a linear interpolation between the bracketing breakpoints — the same equation the paper prints
as its Eq. 1 — and **AQI is the maximum sub-index**, not a mean.

A usable anchor for the implementation's first test, straight from CPCB: the PM2.5 sub-index is **51 at
31 µg/m³, 75 at 45 µg/m³, and 100 at 60 µg/m³**. If the port does not reproduce those three exactly, the
breakpoint table was transcribed wrong.

### 3 · Trailing windows, not instantaneous values
**This is the single most common way the calculation is got wrong.** CPCB sub-indices are computed on
averaging windows, not on the current reading:

- **24-hour mean** — PM2.5, PM10, NO₂, SO₂, NH₃, Pb
- **8-hour rolling maximum** — CO, O₃

So the AQI at hour *t* is a function of a *window ending at t*, not of the pollutant values at *t*. Any
implementation that maps one row of concentrations to one AQI is wrong regardless of how well it appears
to validate.

### 4 · Validity rule — absent is a value
CPCB publishes no AQI unless **at least three pollutants are present, including at least one of PM2.5 or
PM10**. We honour that.

Missing data renders as **absent**, never as zero and never interpolated. The distinction to preserve is
"no station here" versus "clean air here", and only one of those is true for Barrackpore and Baruipur —
the same distinction the water layer's `open_water_fraction` / `water_in_solve` split exists to keep
(`docs/evidence/known-limitations.md` §7).

### 5 · Coverage honesty — what the overlay may and may not draw
- **May:** a station marker at the station's real location, its reading, its timestamp, its averaging
  window, and the distance from whatever the user is looking at.
- **May not:** paint a ward, shade a polygon, interpolate between stations, or extend any colour into
  Barrackpore or Baruipur.
- The overlay ships with a coverage statement in the same view as the number — one station in one of three
  wards — not in a linked document. (`CAPA Strategies` anti-pattern, `digital-twin-references.md`.)

### 6 · AQI does not enter the heat physics
It is a co-exposure layer, exactly like the render-only water layer. Recorded here as a decision so it
cannot drift in later: no AQI term in `equilibriumC`, none in `TsHeatSim.step`, no AQI-derived field in
`SimLayers`. If that ever changes it needs its own measurement, the way the water layer got one.

### 7 · Delivery and code shape
- **Token-gated like Mapillary:** a `PUBLIC_*` env var; with no token the whole feature tree-shakes out
  (shipped pattern, 2026-08-11 — `docs/evidence/data-sources.md`).
- **Laboratory module** `scripts/_aqi.py`, pure functions, shaped like `scripts/_canopy.py` and
  `scripts/_water.py`: breakpoints as data, sub-index and window logic as functions, no I/O in the maths.
  Strict mypy applies.
- **If the sub-index is ever also computed in TypeScript** for the browser, it gets a parity oracle first —
  `tests/fixtures/water-oracle/` is the template. Two implementations of one formula do not coexist ungated
  in this repo.
- Fetching is a separate concern from the maths; the CPCB feed needs a key and a proxy route, and that is
  its own task.

## Consequences to expect

- **The overlay will look sparse, and that is the correct appearance.** Seven points in a city, one of them
  in one of our wards. Anyone who finds that underwhelming is reading the data correctly.
- **It is not validation of anything thermal.** `aqi-daily.json` already carries that warning; it holds
  co-exposure and seasonality evidence beside the heat model, not evidence about it.
- Two of three wards gain nothing from this feature. Barrackpore and Baruipur get an explicit "no station"
  state, which is the honest deliverable rather than a gap.

## Non-goals

- **No AQI forecasting or ML.** CEO decision; the values come from measurements, not a model.
- **No interpolated AQI surface**, at any smoothing, for any presentation reason.
- No adoption of US EPA breakpoints, and no mixing of the two standards in one display.
- Not re-running the Naveed counter-test. We record the tautology as a suspicion we did **not** measure —
  see `docs/evidence/methods-and-papers.md`.
