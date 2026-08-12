# Known limitations

Things wrong with, or unproven about, this engine — written down by us, before someone else finds them.
A limitation recorded here is a limitation we can discuss. One left out is one that ambushes us in a
review.

Each entry states **what is wrong**, **how we know**, **what it does and does not invalidate**, and
**what would close it**.

---

## 1. The published accuracy figures never see the canopy blend

**Status:** open · **Found:** 2026-08-12, during the CHM v2 upgrade · **Pre-existing**, not introduced by
that work.

**What is wrong.** The engine's headline accuracy — **night ±3.5 K, day ±5.0 K** — is produced by the
Python validation stack, which builds each ward's vegetation field from `{ward}-surface.png` alone:

- `scripts/measure-spatial-accuracy.py` → `surface_layers()` reads only the surface PNG
- `scripts/build-ward-observations.py` derives each ward's `fvc` from the same
- `scripts/measure-shipped-amplitude.py` builds on both

But the browser does something else. `blendCanopyIntoVeg` (`src/scripts/climate-engine/ward-raster.ts`)
mixes the measured canopy raster into `veg[]` before the solver runs — and it is invoked in **exactly one
place, the browser path. No Python script applies it.**

**So the field we score has never been the field we render.**

**How we know.** During the v2 upgrade the accuracy output was byte-identical before and after a canopy
change that nearly doubled the underlying height field. That identity was the clue: it was a *tautology*,
not evidence. Tracing the inputs confirmed the regeneration commit touched only `*-canopy.png` and
`*-trees.json`, while every input to `measure-accuracy.py` was last written by far older commits.

**What it does NOT invalidate.** The ward-mean result is sound, and was verified three independent ways
rather than assumed:

- the blend is **mean-neutral to ≤0.0012** in ward-mean `veg` against a canopy field that moved ×1.7-1.9
  (run through the real shipped TS functions, v1 canopy vs v2);
- driving the **real solver** on the two canopy fields moves ward-mean temperature by **≤0.016 K** — 0.5%
  of the ±3.5 K band;
- the mean-neutrality unit test passes.

So ±3.5 K / ±5.0 K remain defensible **as ward-mean figures**.

**What it DOES leave unproven.** Within-ward spatial skill. The same experiment showed the canopy change
moves the field materially at cell scale — **per-cell RMS 0.26-0.36 K, and spatial SD falling 7-12%** — and
nothing in the repo scores that. Suggestively, `measure-shipped-amplitude.py`'s own docstring notes the
model already draws roughly **2× the observed spatial SD**, so a reduction plausibly moves *toward* reality
— but that is inference, and inference is exactly what this project refuses to publish as measurement.

**What would close it.** Teach `surface_layers()` to apply the canopy blend, so the Python validation scores
the field the browser renders. That is a production change to the validation path and deserves its own task
with its own review; it would also let the spatial-skill figures describe the real map for the first time.

**How to talk about it.** "Our ward-mean error bars are measured and hold. Our within-ward spatial skill is
not yet measured, because the validation path and the render path diverge at one function. We know where,
and we know what it would take." That is a stronger position than a spatial number nobody has checked.

---

## 2. Roughly 30% of rendered trees stand on rooftops or in roads

**Status:** open, designed but parked (Phase B1) · **Measured:** 2026-08-12

Placement comes from the canopy raster alone, with no exclusion mask. Measured against shipped footprints
and buffered road centrelines:

| ward | on buildings | in roads | total |
|---|---|---|---|
| ballygunge | 19.0% | 17.1% | **36.0%** |
| barrackpore | 16.4% | 15.0% | **31.4%** |
| baruipur | 10.6% | 9.3% | **19.9%** |

The data to fix it — building footprints, road centrelines, water polygons — is already shipped and loaded.
The design exists (`2026-08-11-vegetation-placement-v2-design.md`, Phase B1), including the remedy that
matters: **relocate a blocked candidate to the nearest free cell rather than deleting it**, so canopy
density survives the mask.

Sharpened by the v2 upgrade: **v2's own authors instruct users to "mask non-vegetated areas … using an
independent land cover map."** v1 carried no such instruction. So the mask is now the documented usage of
the product we ship, not merely a nice-to-have.

---

## 3. ETH cross-check is blind over ~72% of each ward

**Status:** measured, documented, not a defect we can fix · **See:** `data-sources.md`

ETH's nodata is an ESA WorldCover **built-up mask** (verified at 99.73% per-pixel agreement), so a street
tree over a built-up cell is erased rather than measured as zero. Where it does report, and compared the way
its authors prescribe, it agrees within its own uncertainty — but it is structurally silent on exactly the
urban-canopy question we ask. It can never be quoted as "two sensors agree" without that blind spot stated
in the same breath.

---

## 4. Building heights are unvalidated, with a suspected low bias

**Status:** open, blocked on data · **See:** `data-sources.md`, [[icesat2-height-validation]]

Google Open Buildings 2.5D gave 98-99% of footprints a direct zonal height measurement, but no independent
Kolkata ground truth exists to check them against. The ICESat-2 comparison returned **`underpowered`**
(n=28 against a pre-registered bar of 30), so no correction was applied and none is claimed. GEDI was
evaluated as a replacement in 2026-08 and is worse — ~2-5 usable shots per ward across the whole mission.

Heights are **not** a physics input (`heat-map-model.ts` has no height term), so this does not touch the
temperature result. It affects the massing you see.

---

## 5. Tree density is a display scaling, not a measurement

**Status:** by design, disclosed in the receipts

`DENSITY_REF_H` (currently 30 m) sets how many sprites represent a given canopy height. Tree **count** is
therefore not a measured quantity and must never be quoted as one — canopy **height** is measured, positions
and species are modelled. The receipt says so. This is listed as a limitation because it is the single
easiest thing for a viewer to misread.
