# Track F — solar and shadow

**Written:** 2026-08-11 — **70 days to WETEX.**
**Status:** design, not approved. Nothing built.
**CEO decision, 2026-08-11: "Solar first, Wind second."**
**Parent:** [2026-08-10-wetex-dubai-demo-design.md](2026-08-10-wetex-dubai-demo-design.md) ·
**Sibling:** [2026-08-11-urban-wind-3d-physics-design.md](2026-08-11-urban-wind-3d-physics-design.md) (Track E, now second)

---

## 1 · Why solar goes first

1. **It needs no new solver.** Sun geometry plus a shadow projection. Track E needs a Röckle
   port plus a Poisson/SOR solve.
2. **It closes an open question in our own physics.** `SVF` was tested and died. **`shade`
   was never tested at all** — this is the other half of the pre-registered 3-D test.
3. **`pvlib` is the validation reference**, so unlike wind there is no validation corpus to
   assemble. `pvlib 0.15.2` is pinned **and already installed locally**, and nothing imports
   it.
4. **Solar is generation as well as load** — DEWA operates the Mohammed bin Rashid Al Maktoum
   Solar Park and the Shams Dubai rooftop programme. Wind speaks only to load.
5. **Three independent signals agree on the ordering** — our own cost analysis, the
   competitor's *"Sun and shadow, flow, exposure and performance"*, and their Time panel
   built around *"Study shadows, daylighting … at any hour."*

## 2 · ⚠️ CORRECTION — `pybdshadow` is the ORACLE, not the dependency

The library audit recommended `ni1o1/pybdshadow` (BSD-3). **Reading its actual README changes
that recommendation**, and this is new information rather than a reversal:

| finding | consequence |
|---|---|
| It requires **geopandas** | Not in `requirements.txt`. Pulls pandas + fiona/pyogrio. **geopandas ships no type stubs** — straight back into the `import-untyped` problem we just spent a day eliminating. |
| It uses **`suncalc-py`** for sun position | We would carry two solar-position implementations. `pvlib`'s NREL SPA is the better one. |
| Also pulls **`TransBigData`** and **`keplergl`** | A large tail for one geometric operation. |
| README recommends **Python 3.7 / 3.8 / 3.9** | We are on **3.12**. Unstated compatibility risk. |
| Output is **shadow polygons** (GeoDataFrame) | We need a per-cell fraction on the 192×192 grid. A rasterisation step is required either way. |

**And the operation itself is small.** The shadow of an extruded footprint under a
directional light is a translate-and-union:

```
d = height / tan(solar_altitude)          # shadow length, metres
(dx, dy) = -d · (sin(azimuth), cos(azimuth))
shadow(poly) = poly ∪ translate(poly, dx, dy) ∪ {quads joining corresponding edges}
```

**We already pin `shapely==2.1.2`.** This is on the order of 60 lines, stays strict-typed,
adds zero dependencies, and consumes the data we already ship: `public/heat-map/data/*.json`
stores each building as `[height, x0, y0, x1, y1, …]` in local metres — footprint ring plus
height, exactly the input required.

**Decision: implement it, and use `pybdshadow` as a validation oracle in a throwaway venv.**
Agreement with an independent BSD-3 implementation is stronger evidence than adopting it, and
it costs us nothing at runtime.

## 3 · The chain

```
[laboratory, Python, offline]                          [instrument, TS, browser]

buildings (footprint + height, local m)
      ↓  pvlib.solarposition  (NREL SPA)      ← BSD-3, already installed
sun altitude / azimuth per timestep
      ↓  shapely translate + union
shadow polygons
      ↓  rasterise to CANONICAL_GRID_N = 192
shade[i] ∈ [0,1]  per cell, per timestep  ──────────→  sun·(1−shade[i])
      │                                                      ↑
      │                                            the UNTESTED heat term
      ├──→ pvlib transposition (Perez / Hay-Davies)
      │         → rooftop + façade PV yield, kWh/m²          [DEWA: generation]
      │
      └──→ pythermalcomfort (MIT) → UTCI / PET               [pedestrian comfort]
```

Three outputs, two permissive dependencies (`pvlib`, `pythermalcomfort`), no new solver.

## 4 · The pre-registered sign test — write it before running it

Same discipline that killed SVF and OHM. **Direction fixed before measurement:**

> **`corr(shade, model − obs) > 0` by day.**

Rationale: where a cell is shaded and the model does not know it, the model over-predicts
temperature, so the residual is positive. A null or wrong-signed result **kills the shadow
term and gets published**, exactly as the SVF null was.

**Aggregate to 70 m before testing.** Sim cells are 7.4 m; ECOSTRESS is 70 m. The shadow
*pattern* is sub-pixel and not directly validatable — only the mean shadow fraction per
ECOSTRESS pixel is. This is a stated condition, not an afterthought.

**⚠️ Heights are unvalidated** — `height-method.json` reads `"underpowered: 6 matched pairs
< 8"`. If the sign test passes, heights become load-bearing and must be validated before
anything is published on them.

## 5 · The Time panel

Adopted from the competitor teardown (WETEX spec §8g), because we have a time dimension in
the solver and **no control surface for it at all**:

- presets: `Dynamic / Morning / Noon / Evening`
- continuous time-of-day slider
- speed multipliers `x1 · x10 · x100 · x1000 · x10000`
- absolute date field, and **"Reset to current date and time"**

Top-level mode, sibling to a future **Air Flow** — not a settings drawer. Motion rules
unchanged: transform/opacity only, 60 fps.

## 6 · Dubai specifics

- **Solar resource data:** Global Solar Atlas (World Bank/Solargis, covers UAE), PVGIS (JRC),
  NSRDB (NREL's MSG region covers the Middle East). Or derive from `pvlib` clear-sky plus
  cloud from the met feed, which is already how `sun` is driven — **preferred, since it keeps
  one provenance chain.**
- **Arid advantage:** Dubai is near-cloudless, so clear-sky modelling is far more defensible
  there than in a monsoon delta. **The engine's weakest assumption in Kolkata is its
  strongest in Dubai** — worth saying out loud on the stand.
- **⚠️ Do not over-claim rooftop area.** GHS-BUILT-H gives a 100 m cell-average height, not
  per-building roofs. City-scale PV yield is indicative; per-building requires footprints,
  which we have from Microsoft.

## 7 · Out of scope

- Making the thermal solver 3-D. It stays 2-D; only `shade[i]` and later `wind[i]` become
  fields.
- Inter-building reflected shortwave (the mechanism behind the cool-pavement sign reversal in
  §8b). Named so it is not forgotten.
- Bifacial and tracking PV. Fixed-tilt rooftop only.
- Any PV financial model. Yield in kWh, never a payback figure.

## 8 · Risks

| risk | mitigation |
|---|---|
| Our shadow implementation is wrong | `pybdshadow` oracle in a throwaway venv; agree or explain |
| Sign test fails, like SVF | **Then we publish a second null result.** That is a working instrument, not a failure |
| Rasterisation at 192² per timestep is slow | Precompute offline; the browser interpolates. Same pattern as Track E |
| Heights are unvalidated and become load-bearing | Gate: validate heights before publishing any number that depends on them |
| Scope creep into PV finance | Yield only, no payback |

## 9 · Verification

- `python3 -m mypy` **0 errors** — no new untyped imports; that is the whole reason
  `geopandas` is refused.
- Shadow implementation agrees with the `pybdshadow` oracle on a Kolkata ward.
- Sign test result reported **as measured, pass or fail**, with the artefact committed.
- Kolkata outputs byte-identical when `shade` is absent (the term must default to today's
  scalar `sun`).
- 60 fps on a tier-0 Android with the Time panel scrubbing.

## 10 · First move — DONE 2026-08-12. Result below.

~~Implement `shade[i]` for one Kolkata ward and run the sign test.~~ Built as
`scripts/measure-shadow-signtest.py`, run over all three wards. Artefact:
`data/calibration/shadow-signtest.json`.

## 11 · RESULT — the placebo fired. Shadow is not a within-ward lever for Kolkata.

**87 ward-scenes from 34 near-nadir overpasses.**

| arm | scenes | mean r | median | % positive | p | verdict |
|---|---|---|---|---|---|---|
| **DAY** (pre-registered) | 35 | **+0.395** | +0.437 | 94 % | **3.7e-08** | sign as pre-registered |
| **NIGHT** (placebo, pre-registered) | 45 | **+0.234** | +0.200 | 87 % | **5.4e-07** | ***fired*** |

**The pre-registered statistic passed. The pre-registered placebo also fired, which voids
it.** Night scenes were scored against the same geometry lit at local noon — there was no sun
and no shading when those observations were made, so a correlation there can only be building
density. It is significant at p = 5e-07.

Post-hoc, with `built` and `veg` regressed out, the day effect collapses from **+0.395 to
+0.070** and loses significance (60 % positive, **p = 0.31**); night goes to −0.009.

**VERDICT: shadow does not survive as a within-ward accuracy lever in Kolkata, and it dies of
the same disease as SVF — collinearity with `built`.** The placebo arm was written into this
spec specifically to catch that failure mode after SVF, and it caught it.

### What is genuinely different from the SVF null

SVF came back **wrong-signed and unanimous** (0/50 scenes positive, p = 1.8e-15) — a dead
mechanism. This did not. Two post-hoc observations, **hypothesis-generating only**:

| ward | max building | mean shade | shade sd | **partial r (day)** |
|---|---|---|---|---|
| **ballygunge** | **87 m** | 0.272 | 0.126 | **+0.193** |
| barrackpore | 30 m | 0.145 | 0.085 | +0.013 |
| baruipur | 21 m | 0.132 | 0.074 | −0.024 |

**The only ward with real vertical relief is the only ward whose partial correlation
survives.** And `corr(sun_altitude, r) = −0.368` — the effect strengthens at low sun (mean r
+0.433 below 32° vs +0.360 above), which is the direction real shadow predicts.

**This is not a rescue and must not be reported as one.** Swapping to the ward-split
statistic after seeing the data is precisely what pre-registration exists to prevent, and
n = 13 for ballygunge. It is an *underpowered* result with coherent structure, not a positive
one.

### What it predicts, and what it does not

It generates a **falsifiable prediction for Dubai**: if the effect is height-driven, then
DIFC and Marina — with towers an order of magnitude beyond ballygunge's 87 m — should show
it clearly. **That prediction must be pre-registered again before Dubai data is touched.**
"It will work next time" is the standard way this kind of result goes wrong.

### ⚠️ What this does NOT kill

- **Rooftop PV yield** — a direct `pvlib` computation over validated shadow geometry. It does
  not depend on this null at all.
- **The shadow geometry itself** — self-checked quantitatively: a 30 m tower at 30° elevation
  throws **10 cells against 10.4 predicted**, shades away from the sun and never towards it,
  and lengthens monotonically as the sun drops.
- **The Time panel** and shadow visualisation.

**What dies is the claim that adding `shade` improves within-ward thermal accuracy in
Kolkata.** Track F continues on the other three outputs; the heat-term coupling is now
evidence-led rather than assumed, and **the honest thing to put on the stand is this table.**
