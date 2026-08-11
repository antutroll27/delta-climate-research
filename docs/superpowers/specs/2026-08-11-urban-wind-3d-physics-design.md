# 3-D urban wind — bringing building geometry into the physics

**Written:** 2026-08-11 — **70 days to WETEX.**
**Status:** design, not approved. Nothing built.
**Parent:** [2026-08-10-wetex-dubai-demo-design.md](2026-08-10-wetex-dubai-demo-design.md)

---

## 1 · Why this exists

The CEO saw a competitor (Spatialbound "4D SpatialEngine") advertising *"a physics-based
RANS solver with LES turbulence directly on … Google's photorealistic 3D tiles"*, producing
animated streamlines and per-building wind tint over a real city, and asked for our physics
to go 3-D for Dubai.

Two readings of that post shaped this design, and both matter.

**⚠️ The Google Photorealistic 3D Tiles route is closed to us.** Their terms explicitly
forbid *"image analysis, machine interpretation … geodata extraction … offline uses."*
Running a solver on that geometry is analysis under any reading. Already established for
Kolkata; it holds for Dubai. Whatever licence the competitor holds, **we cannot copy this
architecture.** See the `kolkata-3d-realism` dead-ends.

**"RANS with LES turbulence" is not a coherent description.** RANS and LES are alternative
closures — you pick one; the hybrid has its own name (DES/DDES). And a converged RANS solve
over a city block does not run "in seconds" in a browser. That is marketing copy over
something else, most likely a fast diagnostic model or an ML surrogate. **The real bar is
lower than the copy implies**, and that is what makes this design feasible.

**CEO constraint, 2026-08-11, and it is the enabling decision:**
> "the thing does not need to be Photoreal mate as long as it's pleasing to the eyes from
> an UX pov and simulations are atleast 70%/+ accurate"

Dropping photoreal removes the licence blocker entirely.

## 2 · The 70 % is the field's own pass mark — not a compromise

This is the most useful thing found while researching the design.

**VDI Guideline 3783 Part 9** (German standard, carried into **COST Action 732**, the
European best-practice guideline for CFD in the urban environment) evaluates models on
**hit rate `q`** — the fraction of predicted points falling within a fractional deviation
**D = 0.25** and an absolute tolerance **W** of the reference measurement. The stated
validation criterion:

> **`q` must not fall below 66 %.**

So the CEO's "at least 70 %" sits a whisker above the published threshold that full CFD
codes are held to. **"Meets the VDI 3783-9 validation criterion" is a sentence that lands
with a utility engineer** in a way no render does — and it is the same move as the Kolkata
error bars: publish the metric the discipline already uses.

## 3 · The method: Röckle diagnostic, not CFD

**Röckle-type models do not solve transport equations for momentum or energy.** They place
empirical parameterised wake regions around each building — Röckle, later Kaplan & Dinar,
define two ellipsoids for the reversed-flow cavity and the far wake — then enforce mass
conservation by solving a Poisson equation (SOR, GPU-parallelisable via red-black ordering).

**The finding that makes this viable:** evaluated against **NYC Midtown tracer measurements**,
QUIC-URB *"in many cases performed equally to CFD codes."* Comparable accuracy at seconds
rather than hours.

**We do not need RANS. We need a Röckle solver.**

| implementation | licence | note |
|---|---|---|
| **URock 2023a** | open source, **GMD** (Copernicus, open access) | **GIS-native input — the closest fit to our pipeline.** Start here. |
| QES-Winds / QUIC-URB | C++, research | The validation lineage; the papers to cite |

Rejected alternatives, with reasons:
- **RANS/LES (OpenFOAM etc.)** — hours per case; cannot be interactive; no time in 70 days.
- **LBM on GPU/WebGPU** — real and browser-proven (FluidX3D as reference), but it is a
  transient solver we would have to validate ourselves from scratch. Revisit post-WETEX.
- **ML surrogates** — the strongest long-term play and the literature is excellent
  (AB-SWIFT `arXiv:2603.25635`, video-diffusion-as-simulator `arXiv:2603.21210`,
  graph-diffusion `arXiv:2512.14725`). **All require a training corpus of CFD runs we do not
  have.** This is the roadmap item, not the October item.

## 4 · Architecture — precompute offline, ship a field

The solver does **not** run in the browser. This is what makes it fit.

```
[laboratory, Python, offline]                    [instrument, TS, browser]
  MS footprints + GHS-BUILT-H
        ↓ extrude
  3-D massing                                      massing mesh (existing shader)
        ↓ Röckle wake params
        ↓ Poisson / SOR mass conservation
  wind field × {16 compass dirs} × {2-3 speeds}  →  interpolate between directions
        ↓ sample to solver grid                        ↓
  per-cell wind scalar  ─────────────────────────→  h·wind·(T−Tair)
                                                       ↓
                                                  GPU particle advection
                                                  → streamlines, 60 fps
```

**Why precompute:** a wind-direction slider responds instantly by interpolating between
stored fields, with no solver in the client. It also keeps the tier-0 Android target intact —
the browser does advection, which is cheap, not a Poisson solve, which is not.

**The coupling is the point.** Our governing equation already carries

```
dT/dt = D∇²T + S·(1−albedo)·sun − kRad·(T−Tsky) − L·veg − h·wind·(T−Tair) + Q·built
```

where **`wind` is currently a scalar constant** — the crudest term in the model, and the
dominant modifier in a tower district. Replacing it with a per-cell field means **3-D
building geometry enters the thermal physics for the first time, without rewriting the 2-D
solver.** One coefficient goes from constant to field. That is the whole change.

This is deliberately *not* "make the solver 3-D". `sun` and `kRad` remain scalars; the
thermal model stays 2-D by construction (see `heat-map-physics-is-2d`).

## 5 · Reopen SVF — but only for Dubai

**SVF was killed by measurement**: wrong sign, p = 1.8e-15. That test was run on **Kolkata
wards that have no canyons.** DIFC and Dubai Marina are exactly the canyon geometry where the
Ratti & Richens shear-and-max horizon search should behave.

**The code already exists.** Re-running it on Dubai geometry is cheap and has a real chance
of coming back alive. It must be a **pre-registered sign test** like the original — direction
fixed before measurement — and if it fails again it gets published as a second null result,
not buried.

## 6 · Validation strategy — the honest split

We have **no wind observations for Dubai**, so we cannot validate the Dubai wind field. The
split that lets us publish a number anyway:

> **Validate the solver against the COST 732 open wind-tunnel reference cases
> (CEDVAL, Michel-Stadt). Apply the validated solver to Dubai.**

- **Tier 1 on the instrument** — hit rate `q` against a standard case, published.
- **Tier 2 on the city** — geometry-driven, uncalibrated, stated as such.

Same instrument-versus-laboratory pattern we already run, and it means the tier badge stays
honest: the *solver* is validated, the *Dubai application* is not.

## 7 · The look — massing, not photoreal

**Clean extruded massing with flowing streamlines reads better than photoreal for this.**
Photoreal competes with the data for the viewer's attention; at a trade stand the map has to
be legible from three metres. We already ship a procedural facade shader and the minimal 3-D
look is locked (`prefers-current-minimal-3d-look`).

Motion rules carry over unchanged: transform/opacity only, ease-in/out, 60 fps
(`smooth-60fps-animations`).

## 8 · Out of scope

- Making the **thermal** solver 3-D. It stays 2-D.
- RANS, LES, LBM, and any ML surrogate.
- Transient/gusting wind. Steady-state per direction only.
- Pollutant dispersion. Röckle models drive dispersion models, and that is the obvious
  follow-on, but it is not October work.
- Validating the Dubai wind field itself.

## 9 · Risks

| risk | mitigation |
|---|---|
| Röckle implementation is a bigger build than scoped | URock is open source — port/adapt, do not reimplement from the papers |
| No time for the wind-tunnel validation | Then publish **no** hit rate and label the wind tier 3. Never quote 66 % unmeasured |
| Precomputed fields inflate the payload | 16 directions × field is the budget driver — measure early, cut directions before cutting districts |
| Scope crowds out Tracks A–C | **Wind on 4 districts beats no wind on 9.** Cut order: Track D landmark GLBs, attract loop, then district count |
| Arid-humid confusion leaks in | Dubai is coastal; see §8b of the parent spec |

## 10 · Verification

- Hit rate `q` computed against a COST 732 wind-tunnel case, reported as measured — **pass or
  fail, published either way.**
- Kolkata outputs byte-identical (the wind term must default to today's scalar when no field
  is present).
- 60 fps on a tier-0 Android with particles running.
- `npm run verify` green, mypy 0.
- The SVF re-test is pre-registered before it is run.

## 11 · Open questions

- Payload cost of 16 precomputed directions at city scale — **measure before committing.**
- Whether URock's licence and Python surface let us adapt it directly.
- Whether the CEO's forthcoming "surprise" (compute?) changes the precompute budget enough
  to justify more directions, more districts, or a genuine CFD corpus for a surrogate.

## 12 · First move

**Port or adapt URock on one Kolkata ward first**, where we already have geometry and can
sanity-check output, before touching Dubai. If it will not produce a sensible field over a
ward we understand, it will not produce one over a city we do not.

## 13 · AMENDMENT 2026-08-11 — do SOLAR/SHADOW FIRST

Three independent signals now point the same way, and none of them existed when §1–12 were
written:

1. **Cost.** Shadow needs no solver — sun geometry plus a shadow-casting pass. Wind needs a
   Röckle port plus a Poisson/SOR solve.
2. **The competitor's own ordering.** Spatialbound's analytics pillar reads *"**Sun and
   shadow**, flow, exposure and performance"* — sun first — and their Time panel is built
   around *"Study shadows, daylighting … at any hour."* (WETEX spec §8g.)
3. **⭐ The licence audit found the library.** `ni1o1/pybdshadow` is **BSD-3-Clause** and does
   exactly building shadows from footprints + heights + timestamp. See
   `docs/research/2026-08-11-open-source-physics-libraries.md`.

**The solar chain, all permissive, no new solver:**

```
pybdshadow (BSD-3) → shade[i] → sun·(1−shade[i])      the UNTESTED heat term
                             → pvlib (BSD-3)          rooftop PV yield
                             → pythermalcomfort (MIT) UTCI / PET, pedestrian comfort
```

`pvlib==0.15.2` **is already pinned in `scripts/requirements.txt` and unused.**

**Why this beats wind for October:** it closes an open question in our own physics (shadow
was never tested — SVF was, and died), it needs no validation corpus because `pvlib` *is* the
reference, and **solar is generation as well as load** — which is DEWA's actual business
(Mohammed bin Rashid Al Maktoum Solar Park, Shams Dubai rooftop programme).

Wind wins on spectacle. **Solar wins on cost, validation, closing our own gap, and audience
fit.** Recommended order: **solar/shadow → Time panel → wind if time remains.** Track E as
written above stays valid; it moves behind Track F.

**Still requires a CEO decision** — the wind streamlines are the more striking demo, and that
is a legitimate reason to choose differently.
