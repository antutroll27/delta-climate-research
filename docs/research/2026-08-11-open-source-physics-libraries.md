# Open-source physics libraries for the climate engine — licence-audited

**2026-08-11.** Every entry below was checked against the **GitHub API** for SPDX licence,
star count and last push date. Nothing here is quoted from a blog summary or a search
snippet. Licence strings are what GitHub's classifier reports; `NOASSERTION` means a custom
licence that **must be read before use**.

Written because the engine is about to grow a solar/shadow term and a wind term, and the
cheapest version of both is "use the validated library" rather than "implement from the
paper" — *where the licence allows it*, which turns out to be the whole story.

---

## 1 · The headline: the standard urban-climate stack is copyleft

**Every well-known urban-climate tool is GPL or AGPL.** This is not a minor inconvenience —
it is the single biggest constraint on the engine, and it is why we implement from papers.

| repo | licence | ★ | what it is |
|---|---|---|---|
| `UMEP-dev/UMEP` | **GPL-3.0** | 97 | Urban Multi-scale Environmental Predictor — **contains SOLWEIG** |
| `ladybug-tools/ladybug` | **AGPL-3.0** | 226 | the core environmental-analysis library |
| `ladybug-tools/uwg` | **GPL-3.0** | 83 | **Urban Weather Generator** — the MIT (Bueno/Norford) model |
| `pingswept/pysolar` | **GPL-3.0** | 405 | solar position and irradiance |

**AGPL is the worst case for us**: it reaches a hosted web product even without distribution.
GPL-3.0 is nearly as bad for a proprietary engine.

**This is a moat observation, not just a blocker.** Any competitor building a *commercial*
urban-climate product hits the same wall. The reason our physics is hand-implemented from
Brutsaert, Ratti & Richens and Röckle is the same reason theirs must be. Discipline here is
a barrier to entry, and it is already how we handled SOLWEIG.

---

## 2 · USABLE — permissive, commercial-safe, verified

### ⭐ `ni1o1/pybdshadow` — **BSD-3-Clause**, 81★, last push 2025-03-19
> *"A python package for generating, analyzing and visualizing building shadows"*

**This is the find.** It is precisely the missing `shade[i]` raster — the half of the 3-D
test that was never run — under a licence we can actually use. Building footprints + heights
+ a timestamp → shadow polygons.

Two products from one dependency: the untested `sun·(1−shade)` term in the heat model, and
rooftop/façade PV yield. **Dormant-ish (18 months since last push) — vendor the version we
test against rather than tracking `main`.**

### `pvlib/pvlib-python` — **BSD-3-Clause**, 1,635★, last push 2026-08-10
The solar gold standard: NREL SPA solar position, Ineichen/Perez clear-sky, Perez and
Hay-Davies transposition, DIRINT/DISC/Erbs decomposition. Actively maintained (pushed
yesterday).

**⚠️ ALREADY PINNED AT `pvlib==0.15.2` IN `scripts/requirements.txt` AND NOTHING IMPORTS IT.**
Somebody added it in anticipation. The solar machinery is already a declared dependency.

**Use `pvlib`, never `pysolar`** — they do the same job and `pysolar` is GPL-3.0.

### `pythermalcomfort/pythermalcomfort` — **MIT**, 221★, last push 2026-07-25
PMV/PPD, **UTCI, PET**, and the rest of the thermal-comfort index family. This is the
**"pedestrian comfort"** output that lands in a Gulf pitch, and MIT-licensed. Takes air
temperature, MRT, wind speed and humidity — **every input we either have or are adding.**
The natural consumer of the wind field.

### `architecture-building-systems/CityEnergyAnalyst` — **MIT**, 272★, last push 2026-08-06
Urban building energy modelling. **The candidate bridge for °C→MW** — worth reading before
we hand-roll a cooling-load conversion, given §8b of the WETEX spec still leans on
literature coefficients.

### `UMEP-dev/SUEWS` — **MPL-2.0**, 28★, last push 2026-08-11
Surface Urban Energy and Water Balance Scheme. **Note the licence divergence from its own
parent org** — UMEP is GPL-3.0, SUEWS is MPL-2.0, which is file-level copyleft and usable.
An independent urban surface-energy-balance model to cross-check our own against.

### `pysal/momepy` — **BSD-3-Clause**, 629★, last push 2026-07-21
Urban morphology metrics. **The route to Local Climate Zone classification** — the open
question in the WETEX spec about whether LCZ beats Köppen for sharing constants between
Kolkata and Dubai. Computes the morphometrics an LCZ scheme needs.

### `taichi-dev/taichi` — **Apache-2.0**, 28,328★
GPU kernels written in Python. Relevant to the **offline precompute** of wind and shadow
fields — a Poisson/SOR solve or a per-timestep shadow sweep, without dropping to C++.

### `mikedh/trimesh` — **MIT**, 3,646★, last push 2026-08-11
Mesh loading and ray casting. The geometric primitive under any shadow or view-factor
computation, and it already fits the GLB pipeline we ship.

### Supporting, MIT
`opengeos/leafmap` (3,756★) and `gee-community/geemap` (4,009★) — inspection and Earth
Engine access from notebooks. Workbench tools, not engine dependencies.

---

## 3 · READ THE LICENCE FIRST

| repo | flag |
|---|---|
| `ProjectPhysX/FluidX3D` — 5,220★ | **`NOASSERTION`** — custom licence. The fastest LBM CFD code there is; **do not use until the terms are read.** |
| `NatLabRockies/EnergyPlus` — 1,551★ | **`NOASSERTION`** — believed BSD-style, GitHub cannot classify it. Read before depending on it. |
| `orbisgis/geoclimate` — **LGPL-3.0**, 76★ | **URock lives here.** LGPL is usable unmodified, and it is Groovy/Java — so it is a **subprocess, not an import**, which sidesteps most of the linking question. Modifying it does not. |
| `SunPower/pvfactors` — BSD-3, 89★ | **Last push 2022-03-03 — dormant four years.** Bifacial/view-factor irradiance. Fine to vendor, do not depend on upstream. |

---

## 4 · Could not verify

**`QES` / `QES-Winds` has no GitHub home I could locate.** Documentation exists at
`qes-documentation.readthedocs.io`, and the papers are solid (evaluated against NYC Midtown
tracer data, "in many cases performed equally to CFD codes"), but the source location and
licence are **unconfirmed**. GitHub's search API returned nothing on three queries — likely
rate-limited rather than genuinely absent. **Needs a manual look before it enters any plan.**

Until then, **`geoclimate`/URock is the reachable Röckle implementation**, at LGPL-3.0.

---

## 5 · What this changes

The wind spec (`2026-08-11-urban-wind-3d-physics-design.md`) assumed we would port a Röckle
solver. That still holds — but the **solar/shadow half is now much cheaper than specced**:

```
pybdshadow (BSD-3)  →  shade[i] raster  →  sun·(1−shade[i])   [the untested heat term]
                                        →  pvlib transposition  [rooftop PV yield]
                                        →  pythermalcomfort     [UTCI / PET, pedestrian comfort]
```

**Three outputs, three permissive dependencies, no new solver, and it closes an open
question in our own physics.** That strengthens the case made after the Spatialbound
teardown: **solar and shadow before wind.**

## 6 · Standing rule

**Check the SPDX licence before reading the code**, not after. The urban-climate field's
default is GPL, and the cost of discovering that late is a rewrite. Same discipline already
applied to SOLWEIG, Open-Meteo, WAQI and MOSDAC.
