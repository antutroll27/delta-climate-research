# The water layer: fed, measured, and left switched off

**Date:** 2026-08-13 · **Branch:** `feat/water-layer` · **Verdict:** built and ported, **not enabled** —
turning it on costs **0.049 r** against ECOSTRESS and makes an already over-drawn spatial amplitude worse.

This is the receipt for a change that did not ship the thing it set out to ship. It is written down anyway,
in full, because the alternative is that someone finds the all-zero water layer again in six months, fixes
it in an afternoon, and silently degrades the model — which is exactly what would have happened this time
without a measurement.

---

## 1. The defect, which was real

`SimLayers.water` (`src/scripts/climate-engine/types.ts`) has existed since the engine shipped, and
`TsHeatSim.step` (`sim-ts.ts`) has always read it, twice:

```ts
const ventilation = p.wind * Math.max(0.15, 1 - 0.55 * layers.built[index] + 0.65 * layers.water[index]);
…
this.scratch[index] = Math.max(0, Math.min(80, next * (1 - layers.water[index] * 0.35)
  + (p.tAir - 1.5) * layers.water[index] * 0.35));
```

`sim-gpu-webgl2.ts` packs it to the GPU. `computeGreenG` weights it at 0.8. And `rasterWardBase`
(`ward-raster.ts`) allocated it and never wrote it:

```ts
const water = new Float32Array(count);   // all zeros, forever
```

So both terms collapsed to the identity, and every pond, tank and river reach in three wards was solved as
warm land — while `water-layer.ts` drew them, in blue, from polygons that had been on disk the whole time.
The data was never missing. Nothing read it into the physics.

Open water, from `{ward}-water.json` through the shipped rasteriser at the canonical 192 grid:

| ward | rings | open water | wet cells |
|---|---|---|---|
| ballygunge | 7 | 0.72 % | 308 / 36,864 |
| baruipur | 12 | 1.30 % | 548 / 36,864 |
| barrackpore | 67 | 4.88 % | 2,130 / 36,864 |

---

## 2. What was built

**Browser.** `rasterizeWardWater` (`ward-raster.ts`), alongside `rasterizeWardBuilt` and sharing its
arithmetic through a new `stampRing` — 2×2 supersampled point-in-polygon, pure integer-and-float
arithmetic, no Canvas. It produces an **area fraction**, not a mask, because the physics multiplies by the
number twice. `rasterizeWardBuilt`'s output is bit-identical after the refactor, verified against
`HEAD` at n = 37, 140 and 192 on all three wards.

Water reaches it through both loaders, not one: `heat-map-app.ts` already had the artefact in scope, and
`ward-loader.ts` gained it so **Compare** solves the same ward the map draws.

**Laboratory.** `scripts/_water.py` ports the rasteriser, held to the TypeScript by
`scripts/dump-water-oracle.mjs` → `tests/fixtures/water-oracle/oracle.json` →
`scripts/check-water-oracle.py`, wired into `npm run test:py`. Eleven synthetic cases cover the branches
that a square would not — the on-segment ε that decides whether a shoreline sample counts as water, the
zero denominator a horizontal edge puts in the crossing test, concave parity, OR-not-sum on overlaps,
clamping for rings that run past the frame, three kinds of malformed ring, both spellings of no-water, and
a grid whose cells are not a whole number of metres. Three ward cases cover the 86 real rings at both grids
by row and column marginals. **Everything matches to 0.00e+00** — bit-exact, though the gate tolerates 1e-6.

---

## 3. Where it could be measured, and where it could not

`measure-spatial-accuracy.py` — the script that produces the published within-ward figures — **cannot see
water at all**, and this is structural rather than an oversight:

- its predictor is `modelled_field`, which mirrors `equilibriumC(p, albedo, veg, built)`;
- there is **no water term in the equilibrium**. Water lives only in `TsHeatSim.step`;
- the relaxation term has no dt-free steady state. Its fixed point is
  `T* = [m·(tAir−1.5) + dt·(1−m)·k·T_phys] / [m + dt·(1−m)·k]` with `m = 0.35·water` — a blend whose
  weights depend on the step size.

Writing a water term into that script would have been inventing physics the browser does not run. So the
figures there are **unchanged, exactly as predicted**: `r_physics 0.2154 · r_veg 0.2380 · r_built 0.1795 ·
anomaly RMSE 1.8358`, before and after, to four decimals.

`measure-shipped-amplitude.py` **can** see it: it drives the real `TsHeatSim` through
`scripts/sim-field-dump.mjs`, and had been passing a hardcoded `np.zeros` for this layer since it was
written. That is where the measurement lives.

---

## 4. The measurement

34 near-nadir ECOSTRESS L2T LSTE v002 scenes · 87 ward-scenes · 3 wards · real solver, 600 steps at the
canonical 192 grid. Only the water layer differs between the arms.

| | dry (shipped) | wet | Δ |
|---|---|---|---|
| **r vs ECOSTRESS, all** | **0.3031** | **0.2544** | **−0.0487** |
| r, day (n = 37) | 0.3883 | 0.3593 | −0.0290 |
| r, night (n = 50) | 0.2400 | 0.1768 | −0.0632 |
| spatial SD at the obs grid | 1.345 K | 1.514 K | +0.169 K |
| amplitude vs observed (0.925 K) | 1.45× | 1.64× | worse |

Worse in **66 of 87** ward-scenes individually.

### Per ward — the contrast that makes it a mechanism

| ward | open water | r dry | r wet | Δr | worse in |
|---|---|---|---|---|---|
| ballygunge | 0.72 % | 0.2784 | 0.2650 | **−0.0134** | 20 / 29 |
| baruipur | 1.30 % | 0.3445 | 0.2838 | **−0.0607** | 21 / 25 |
| barrackpore | 4.88 % | 0.2933 | 0.2227 | **−0.0706** | 25 / 33 |

**This ordering is the evidence.** The degradation scales with each ward's open-water fraction — 6.8× more
water in Barrackpore than Ballygunge, 5.3× the loss. Had the sign been positive, the same contrast would
have been the argument that the improvement was real. It is not available in one direction only.

ECOSTRESS masks pixels its own water band flags, so the large bodies contribute nothing to these scores.
What moved the numbers is the sub-pixel water — median span 39–52 m against a 70 m pixel, 85 % of bodies
smaller than one pixel — sitting inside land pixels that *are* scored. Exactly the cells the exercise was
designed to reach.

---

## 5. Why it fails, which is not a tuning problem

**The relaxation is a clamp, not a nudge.** At the shipped `D = 2.5`, CFL gives `dt ≤ 0.1`, while
`k = kRad + h·wind ≈ 0.11`. So in `T* = [m·(tAir−1.5) + dt·(1−m)·k·T_phys] / [m + dt·(1−m)·k]`, the water
weight `m = 0.35` swamps `dt·(1−m)·k ≈ 0.007`: a fully-wet cell lands within ~2 % of `tAir − 1.5` **whatever
the energy balance says**. Measured on two representative scenes:

| | ballygunge | baruipur | barrackpore |
|---|---|---|---|
| day, at wet cells | +0.83 K | +1.90 K | −0.36 K |
| night, at wet cells | −1.59 K | −1.12 K | −1.99 K |

Every wet cell converges on the target. Note the **day column is mostly positive**: the brief's estimate of
"~4 K cooling per cell" is not what this code does. It does not cool water — it *pins* it, and on a 19 °C
day it pins ponds *upward*, because the un-watered field already had those low-built, vegetated cells below
`tAir − 1.5`.

**`tAir − 1.5` is a daytime assumption applied around the clock.** Night degrades 2.2× more than day.
Water has the highest thermal inertia in the scene: after sunset it is the warmest surface ECOSTRESS sees
over these wards, and this term puts it 1.5 K *below* air. That is a sign error, and no coefficient fixes a
sign.

**It is not the canopy sweep's compression artefact in another costume.** That was the loophole worth
checking: the canopy blend improved RMSE only by damping an amplitude the model already over-draws. Here
spatial SD **rises**, 1.45× → 1.64× the observed. Less skilful *and* more over-drawn. There is no reading
in which this is error traded for amplitude.

**Ward means move materially too**, which is what `water-layer.ts` was warning about when it called this
calibration-gated: Barrackpore's day mean drops 0.69 K and its spatial SD collapses 3.97 → 3.13 K.

---

## 6. The decision

`WATER_LAYER_ENABLED = false` in `types.ts`, mirrored by `_water.LAYER_ENABLED` and **pinned across the two
languages by the parity oracle**, exactly as `CANOPY_BLEND_STRENGTH = 0` is. The rasteriser stays general,
unit-tested and oracle-checked. Re-enabling is one constant plus a re-run of a measurement **that now
exists** — which is the part that did not before, and the part worth keeping.

What did **not** happen, deliberately: no adjustment to `0.65`, `0.35` or `tAir − 1.5`, no change to the
observation mask, no threshold moved. Those are the existing physics. Tuning them to rescue a result is the
failure mode this whole apparatus is built to catch, and §5 is a diagnosis of them, not a licence to edit
them.

## 7. What would close it

The water terms are not wrong to exist; they are wrong as written. A version worth re-measuring would:

1. **make the relaxation a rate, not a clamp** — scale it by `dt` so it competes with the energy balance
   instead of overriding it, which would also make it grid-independent;
2. **give water a diurnal target**, or better, give it thermal inertia. Water is not `tAir − 1.5`; it is a
   body with a heat capacity, and the day/night asymmetry in §4 is that capacity showing up as an error;
3. **re-run `measure-shipped-amplitude.py` per ward** and require the 0.72 / 1.30 / 4.88 % ordering to run
   the other way.

All three are physics changes and belong in their own spec.
