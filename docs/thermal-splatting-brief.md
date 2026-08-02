# Thermal Splatting — can we put it in the heat map?

**For:** Angad (CEO)
**From:** Engineering
**Date:** 2026-07-25
**Read time:** ~10 minutes
**Decision needed by:** before we commit engineering time to the measured-temperature layer

---

## The short answer

**Yes — and it solves a problem we're currently stuck on.** But not as a replacement for the
simulator. It belongs in a different part of the pipeline than it might first appear, and there's
one legal trap we need to avoid.

We tested your formula on our own heat field before writing this. It works. The rest of this
document is what we found, what it can't do, and the five questions only you can answer.

---

## 1. What you've written (in plain terms)

Your formula describes a temperature map as **a pile of overlapping warm and cool blobs**.

Each blob has four properties:

| Symbol | Plain meaning |
|---|---|
| `μᵢ` | where the blob sits |
| `wᵢ` | how hot or cool it is (can be negative — a park) |
| `Σᵢ` | its **shape and direction** — the important bit |
| `T₀` | the background temperature everything sits on |

That second line you wrote — `Σᵢ = Rᵢ Sᵢ Sᵢᵀ Rᵢᵀ` — is the clever part. It says *stretch the blob,
then rotate it*. That's what lets a blob be a long thin streak pointing north-east rather than a
circle. Heat in a city is directional: it runs along road corridors, along the river, downwind. A
circle can't represent that. Your version can.

**You'll recognise the family.** This is a close relative of **kriging** — the same tool used to
estimate ore grade between boreholes. Kriging asks "given a few samples, what's the value in
between?" Your formula asks the same question with temperature instead of grade, and adds the
ability to let each blob have its own orientation.

---

## 2. What we tested

We ran our production heat simulator on a synthetic ward containing a **diagonal river at 45°**,
then asked your formula to reproduce the result using a limited number of blobs.

**Visual:** open `previews/thermal-splat/index.html` in a browser. Four panels — the original
field, the blob reconstruction, the error, and the fitted blob outlines.

### Results

| Blobs used | Average error | Worst error | File size | vs. storing the full map |
|---|---|---|---|---|
| 25 | 0.77 °C | 2.0 °C | 600 bytes | 246× smaller |
| **120** | **0.52 °C** | **1.9 °C** | **2.9 KB** | **51× smaller** |
| 200 | 0.51 °C | 2.6 °C | 4.8 KB | 31× smaller |

### The result that matters

We planted the river at 45° and **said nothing about it to the fitting process**. The blobs came
back oriented at ~45°, stretched 3–7× longer than they were wide, lying along the watercourse.

**The formula found the river on its own.** Your directional term is doing real work, not
decoration.

*Caveat:* our fitting method was quick and crude. A proper one would do better. **Treat these
numbers as a floor, not a ceiling.**

---

## 3. What it's good at

- **Compact.** A whole ward's thermal field in ~3 KB. Small enough to put inside a shareable link.
- **Smooth at any zoom.** It's a mathematical surface, not a grid of pixels — it never goes blocky.
- **Fast.** Renders on the graphics card. No lag when someone drags a slider.
- **Directional.** It captures heat corridors, which a conventional smooth interpolation cannot.
- **Fits gappy data.** Cloud holes in satellite images are handled naturally — you just fit to the
  pixels you have.

---

## 4. What it can't do — three honest limits

### It has no physics in it

This is the most important point. Our current simulator is **causal**: change the roof albedo and
the equations respond, because they encode how heat actually moves. Your formula is a
**description**, not a mechanism. It can draw a temperature field beautifully but it cannot tell
you what happens if we plant 500 trees.

**If we replaced the simulator with this, we would lose the product.** "Same policy, different
fabric" becomes unanswerable. So it goes *alongside* the simulator, not instead of it.

### It smooths away fine detail — permanently

We measured this. A conventional image file grows about 4× when you add street-level texture.
A blob model **doesn't grow at all — because it cannot represent that detail**. Individual hot
roofs, narrow lanes, sharp canal edges get averaged out.

For showing *heat plumes and gradients across a ward*, that smoothing is arguably honest. But if a
client points at a building and asks "why isn't that showing as hot?", the answer is that the
method can't resolve it. **We should decide that deliberately and state the effective resolution
on screen.**

### It doesn't tell you how confident it is

Kriging's most valuable output, as you'll know from ore estimation, is the **error estimate** —
where you know, and where you're guessing. Your formula produces a number everywhere with no
indication of confidence.

For us this matters commercially: if a municipality reallocates a planting budget on our figure,
"41 °C ± 0.5" and "41 °C ± 5" are very different pieces of advice. There's a clean fix, below.

---

## 5. Where it fits — the proposal

Four layers, each doing what it's best at:

```
1.  MEASURE     Satellite thermal passes (ECOSTRESS / Landsat) over our wards
                     ↓
2.  FILL GAPS   Kriging-family method → a complete field PLUS a confidence estimate
                     ↓
3.  YOUR FORMULA  Compress that field into ~150 directional blobs for the website
                     ↓
4.  SIMULATE    Our existing physics engine adds the cooling from interventions
```

**Layers 1–3 give us a measured baseline. Layer 4 keeps the intervention modelling.**

### Why this matters more than it sounds

Right now our heat map's baseline temperature is **modelled** — computed, not observed. That's the
single reason the page is still `noindex` and not public.

If the baseline becomes **measured satellite data** and we only model the *change* from
interventions, our scientific claim gets substantially stronger:

> "This is the observed thermal surface. Here is the modelled change from the proposed planting."

That is a much easier sentence to defend to a municipality than what we can say today. **It
unblocks the publication gate**, and it also gives the ward-comparison tool the real reference
heat-day it's currently missing (it's running on a labelled placeholder).

---

## 6. Two practical findings

### There is a licensing trap — worth knowing about

The original Gaussian splatting code from INRIA is licensed **research and non-commercial use
only**. Almost every thermal implementation on GitHub is built on it, including the ones in the
published papers.

**We must not use that code anywhere — including offline processing.** The *mathematics* is free
to use; only their software is restricted. We'll write our own, and use the permissively-licensed
projects (ThermalNeRF, GaussianImage) as reference only. No legal exposure, no cost.

### Building it ourselves is genuinely small

We checked every existing browser library — they range from 46 KB to 1.8 MB, and **none of them
can carry temperature** (they're all built for photographic colour). They also solve three problems
we don't have, because our map is flat rather than a 3D camera scene.

Our own version is **about 30 lines of graphics code**, and it plugs into rendering machinery
already running on the site. **No new dependencies.**

---

## 7. What the published research says

Thermal splatting is real and active — ICLR 2025, ECCV 2024, CVPR 2025, plus work in *Remote
Sensing*. One of them (ThermalGS) even cites urban heat islands as motivation and reports ~1 °C
accuracy.

**But every one of them is doing something different from us.** They all reconstruct a scene from
**hundreds of thermal camera photographs** taken from a moving drone or handheld rig. None of them
work from sparse satellite passes.

**We found no published work applying this to satellite land-surface temperature or urban heat
islands.** That appears to be a genuine gap.

**One caution before we describe it as new.** Spatial statistics already contains close relatives —
non-stationary kriging (Paciorek & Schervish, 2006), Fixed Rank Kriging (Cressie & Johannesson,
2008), and the SPDE approach (Lindgren, Rue & Lindström, 2011). They achieve similar directional
behaviour *and* produce confidence estimates. If we publish or pitch this as novel, a
geostatistician will point at those. **Our defensible claim is the application and the delivery —
an interactive, measured, street-scale heat tool for Indian wards — not the underlying
mathematics.**

---

## 8. Questions for you

These are the ones we genuinely can't answer without you.

**Q1 — Which satellite source do you trust for Kolkata?**
ECOSTRESS (~70 m, irregular timing), Landsat 8/9 thermal (~100 m, every 16 days), or MODIS
(1 km, twice daily)? Each trades resolution against how often it revisits. Your call as the
remote-sensing scientist.

**Q2 — Which heat day should the ward comparison be pinned to?**
The comparison tool needs one named, real heatwave date so both wards are judged under identical
conditions. We need a specific date, a source, and ideally the actual recorded conditions. Right
now it's running on a clearly-labelled placeholder, which we can't publish.

**Q3 — What accuracy counts as decision-grade?**
Is ±0.5 °C good enough for advising a municipality? ±1 °C? This determines how much effort the
gap-filling layer needs, and whether our current ~0.5 °C reconstruction error is acceptable.

**Q4 — Do our clients need confidence bands?**
Adding them is real extra work. Is "41 °C" sufficient for a screening product, or does a
municipal client need "41 °C ± 0.8"? Our instinct is that we'll eventually need them, but it
could be phase two.

**Q5 — Is losing street-level detail acceptable?**
The method smooths away individual buildings and narrow lanes. Are we telling a story about
*neighbourhood-scale heat patterns* (where this is fine) or *specific buildings* (where it isn't)?

---

## 9. What we'd do next

**A two-day data check, before any real building.**

Everything above assumes usable satellite thermal coverage over our three wards. We haven't
confirmed that. Kolkata's monsoon means heavy cloud for months, and cloud blocks thermal sensors
completely.

The check answers: **how many clear thermal passes do we actually have, and are they enough?**

- Pull real thermal data for Ballygunge (our Earth Engine access is already set up)
- Count clear passes, measure the cloud gaps
- Fit the blobs and score them against data deliberately held back
- Report honestly whether the data supports this

**If the data is there**, we build the measured layer and it unblocks publication.
**If it isn't**, we've spent two days instead of three weeks, and we know to look at
ground sensors or drone survey instead.

---

## Summary

| | |
|---|---|
| **Is the formula sound?** | Yes. Tested on our own data. The directional part genuinely works. |
| **Should we use it?** | Yes — as the *display and compression* layer for measured satellite temperature. |
| **Should it replace the simulator?** | **No.** It has no physics. We'd lose the intervention modelling. |
| **Is it novel?** | The application is. The mathematics has close relatives in geostatistics. |
| **Cost to build?** | ~30 lines of graphics code, no new dependencies. The data pipeline is the real work. |
| **Biggest risk?** | Cloud cover over Kolkata. Two-day check answers it. |
| **Biggest prize?** | A **measured** thermal baseline — which is what's blocking us from publishing. |

---

*Attached: `previews/thermal-splat/index.html` — open in any browser, no server needed.*
