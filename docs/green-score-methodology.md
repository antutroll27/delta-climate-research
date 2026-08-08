# Green Score — algorithms, sources, and an audit

**From:** Engineering  
**Date:** 2026-07-27 (revised; first issued 2026-07-25)  
**Subject:** What the Green Score computes, where every number comes from, and how accurate it is

---

## Summary

This sets out the Green Score end to end: the algorithm, where every constant comes from, what the
model actually produces, and — new in this revision — **how accurate it is against satellite
measurement**, in both senses: how close the ward-level temperature is (§5A), and whether the
pattern *within* a ward is real (§5A, "What those figures do NOT cover"). The second answer is
largely no, it is disclosed in the product, and it matters more than the first for anyone reading
the map block by block. Section 8 lists every source with a resolvable link.

Writing it prompted a proper review of the constants, which was overdue. That turned up **five**
that were uncited, self-referential, or not scientifically supportable — all now corrected and
sourced (§4). A validation harness scores model output against published measurements on every run,
so the model can't drift quietly again. It passes **8 of 8** checks, up from 4 of 10.

**What changed since the first issue.** The previous version said plainly that nothing had been
validated against measurement for our own wards. That is no longer true. We built a calibration set
of **49 usable NASA ECOSTRESS scenes** over Kolkata (2024-01 → 2026-07, 179 acquisitions attempted,
every exclusion recorded), attached hour-matched meteorology to each, and compared the model to
observation scene by scene. Section 5A reports what that found, including the parts that did not go
our way.

The headline result is a number we can now put on the tool:

| | measured accuracy | status in the interface |
|---|---|---|
| **Night** | **± 3.0 °C** (50 ward-scenes) | labelled *calibrated* |
| **Day** | **± 4.5 °C** (29 ward-scenes) | labelled *indicative only* |

**Both figures improved in the July revision, and the night one changed in kind
rather than degree.** The model used to put the night surface *below* air
temperature; measured, it sits 2.10 °C above — the nocturnal heat island is the
defining signature of the thing we are selling, and we had its sign backwards.
§5B has the diagnosis and the fix.

Daytime is worse for a reason that no amount of engineering will fix, and §5A explains it: the limit
is the resolution of the weather data driving the model, not the physics inside it. Both figures are
now shown next to the temperature readout on the tool itself, rather than living only in this
document.

Two earlier findings are worth reading before the detail. The headline heat figure looked roughly
eight times too high against published Kolkata values and was initially recorded as our most serious
defect; it turned out to be **mislabelled rather than miscalibrated** (§4.1). And the attempt to
fit the model's remaining free constants to measurement **failed its acceptance test** — reported in
§5A rather than quietly retried, because the failure is informative.

Section 6 sets out what I still don't trust, without hedging.

---

## 1. What the Green Score computes

A 0–100 number, the equal-weighted mean of three sub-scores:

```
Green Score = 100 × [ greening ratio + cooling achieved + budget efficiency ] ÷ 3
```

Each sub-score is capped at 1.0, so the total cannot be bought with spending. **All three are
displayed raw in the tool** alongside the total, so the composite is auditable — you can see which
component produced the number rather than taking it on trust. Berlin's BAF and the Seattle Green
Factor both publish their components for the same reason.

### Greening ratio

A **weighted-area ratio** — the same structure used by every established green-space planning
standard: Berlin's **Biotope Area Factor** (mandatory since 1994), the **Seattle Green Factor**,
and Singapore's **Green Plot Ratio**. All compute *sum of (area × ecological weight) ÷ total area*.

| Surface | Weight | Basis |
|---|---|---|
| In-ground vegetation | 1.0 | Berlin BAF "vegetation connected to soil" |
| Tree canopy over street | 0.6 | Berlin / Seattle canopy bands |
| Green facade | 0.6 | Berlin wall greening 0.5; Seattle up to 0.7 |
| Water / wetland | 0.8 | Berlin water surface |
| Cool roof | 0.1 | Our own low weight — a painted roof is not habitat |
| Sealed surface | 0.0 | All three standards |

Normalised against **0.45**, the midpoint of Berlin's 0.30–0.60 target band.

### Cooling achieved

Modelled surface-temperature drop versus the no-intervention baseline, normalised against 2.5 °C.

### Budget efficiency

Degrees cooled per ₹ crore, normalised against 0.15 °C/crore.

---

## 2. Where every number comes from

**Measured** = from data · **Cited** = traceable to a named source · **Tool-relative** = normalised
against our own output · **Placeholder** = explicitly temporary.

### Costs

| Item | Value | Grade | Source |
|---|---|---|---|
| Cool roof | ₹150/m² | Cited — high | Telangana Cool Roof Policy 2023-28; NRDC India |
| Street tree | ₹1,500/tree | Cited — med-high | Municipal planting + 3-yr maintenance |
| Pocket park | ₹1.5 crore/ha | Cited — medium | Gujarat AMRUT 2.0 (2 named projects) |
| Green facade | ₹9,500/m² | Cited — medium | Indian vendor pricing; excludes irrigation opex |
| Wetland | *no figure exists* | **Open** | See §6 |

### Physical coefficients

| Item | Value | Grade | Source |
|---|---|---|---|
| Dark roof albedo | 0.15 | Cited — high | LBNL Heat Island Group |
| Aged cool-roof albedo | 0.60 | Cited — high | LBNL *aged* value, not fresh-white 0.85 — deliberately conservative |
| Pocket park radius | 50 m (0.785 ha) | Cited — **Kolkata-specific** | Li et al. 2022, threshold value of efficiency (TVoE 0.77 ha — genuinely Kolkata's; see §4.2 correction) |
| **Evapotranspiration L** | **0.46** (shipped) | **Derivation partly withdrawn — see §4.2; contested by satellite fit, see §5A** | Solved against two constraints, one of which is withdrawn |
| **Facade heat reduction** | **0.03** | **Cited — corrected from 0.30** | Gunawardena & Steemers 2023 |
| Influence kernel λ | ≈47 m | Empirical, honestly labelled | See §4.4 |
| **Sky temperature** | **computed, not fixed** | **Cited** | Brutsaert (1975) clear-sky emissivity, cloud-screened; replaced two hard-coded values |
| **Night evapotranspiration** | **10 % of daytime** | **Cited** | Stomata close after dark; tapers to zero below the dewpoint |
| **Night anthropogenic heat** | **50 % of daytime** | **Estimated, bounded** | Diurnal load profiles, South and East Asian cities |
| **Warming pathways** | **+1.25 / +4.1 °C** | **Cited — corrected** | Dhara et al. 2025, PLOS Climate |

### Score parameters

| Item | Value | Grade |
|---|---|---|
| **Weights** | **equal thirds** | **Corrected from 40/40/20 — see §4.5** |
| Greening reference | 0.45 | Cited, but transplanted (see §6) |
| Cooling reference | 2.5 °C | Cited-ish |
| Efficiency reference | 0.15 °C/cr | **Tool-relative — labelled, not fixed** |

### Input geometry — genuinely measured

Microsoft ML Building Footprints (ODbL) · Google Open Buildings 2.5D heights (CC BY 4.0) ·
OpenStreetMap road centrelines (ODbL) · Norwegian Meteorological Institute live air temperature

Added for validation (§5A): NASA ECOSTRESS 70 m land-surface temperature (public domain) · NASA
POWER hourly meteorology (public domain) · ESA WorldCover 10 m land cover (CC BY 4.0) · GHS-SMOD
R2023A settlement classification (CC BY 4.0). All four are free and redistributable; none carries a
non-commercial clause. Open-Meteo was the easier route for historical weather and was **rejected on
licence grounds**, being non-commercial.

---

## 3. What the model produces

| Scenario | Cooling | Cost | Score |
|---|---|---|---|
| Nothing | 0.00 °C | ₹0 | 2 |
| Cool roofs 100% | 2.25 °C | ₹7.5 cr | 69 |
| Tree corridors max | 2.01 °C | ₹66 lakh | **84** |
| Green facades max | **0.14 °C** | **₹190 cr** | **4** |
| Everything | 4.45 °C | ₹203 cr | 66 |

**Trees score highest, and facades now score almost nothing.** Both are consequences of the
corrections, not of design. Cool roofs cost **₹3.3 crore per °C**; facades cost **₹1,382 crore
per °C**. That ordering matches Indian Heat Action Plan practice, where cool roofs lead — and it
emerges from cited costs rather than being put there.

**Doing everything scores lower than trees alone (66 vs 84).** Deliberate: the cooling term caps
at 2.5 °C, so extra cooling earns nothing while cost destroys the efficiency term. It rewards
cost-effectiveness. It is counterintuitive enough that the interface should explain it, and
currently doesn't.

---

## 4. The audit — five corrections

### 4.1 The heat figure was mislabelled, not miscalibrated

The tool displayed **"UHI Δ vs rural: +11 °C"**. Published surface UHI for Kolkata is
**0.85–1.5 °C** (Nayak 2023, Jain 2023, Siddiqui 2021). That looks like an eight-fold overstatement,
and I initially wrote it up as our most serious defect.

**It isn't.** Voogt & Oke (2003), the canonical reference, put clear-sky **daytime surface** UHI at
**10–15 °C**, while canopy-layer **air** UHI is 2–5 °C. The published Kolkata figures are 1 km MODIS,
season-averaged, measured against a real rural population. Ours is clear-sky midday at 7 m against
a synthetic all-vegetation cell. **Three different quantities.**

The number is defensible. The label was not: "UHI" and "rural" are both load-bearing terms we had
no claim to.

**Fixed:** renamed to **"Δ vs all-green ref"**, with the reference stated in the tooltip and an
explicit note that measured Kolkata SUHII is a different quantity.

**2026-08-07 implementation correction:** the shared `equilibriumC()` reference now includes
night storage (`store`). The duplicated old formulas omitted it, overstating retained/night
contrast but not the heat field. Explore and Compare now share `greenReferenceContrastC()` and
record `heat-metrics-v2`; this is not a recalibration of `heat-model-v1` or the observed rural
validation baseline.

I'm flagging this prominently because it is the error I would most want caught in my own work:
I compared two numbers that shared a name and not a definition.

### 4.2 Evapotranspiration was over-strong — now derived, not tuned

The ET coefficient was 0.50, which put a fully-vegetated surface **5.8 K below air temperature** —
more cooling than evapotranspiration can physically deliver.

Rather than pick a nicer number, I solved for the value satisfying **two independent published
constraints at once**:

- park cool-island intensity of **4.83–8.07 °C** (Mitra et al. 2022, measured in Kolkata)
- vegetated surface no more than **4 K below air** (physical ceiling on ET)

They intersect at **0.40–0.46**. This derivation picked **0.43**, the midpoint. Both constraints
passed. *The shipped constant is **0.46**, not 0.43 — see the correction below.*

> **CORRECTION 2026-08-08 — the first constraint above is misread, and §4.1's own warning
> is what it violates.**
>
> Two errors, found when the citation was checked against the source:
>
> 1. **The paper is not by Mitra.** DOI `10.3389/fenvs.2022.1073914` is **Li, Lu, Fu, Sun,
>    Pan, Han, Guo & Li (2022)**, *Diverse cooling effects of green space on urban heat
>    island in tropical megacities*. There is no Mitra on the author list.
> 2. **4.83–8.07 °C is not a Kolkata band.** **8.07 °C is Kolkata's *maximum* UCI; 4.83 °C
>    is *Bangkok's* maximum.** It is a cross-city range of daytime, winter maxima from fused
>    Landsat/MODIS — not a range of park cooling measured within Kolkata.
>
> What from that paper *is* genuinely Kolkata's, and stands: **TVoE 0.77 ha** and **reach
> 420 m**.
>
> **This is precisely the error §4.1 flags as "the one I would most want caught in my own
> work" — two numbers that share a name and not a definition.** There it was a validation
> baseline; here it is a cross-city range of *maxima* compared against a *within-ward*
> cooling value. Recording it in the same terms rather than quietly repairing the citation.
>
> **What it does to `L`.** The real constraint from that paper is one-sided — Kolkata's
> daytime maximum is 8.07 °C — so the model's **5.80 °C** local park cooling does not
> *violate* it. But the **lower bound was never a constraint**, and it was half of what
> pinned the intersection. `L` therefore rests on one valid constraint (≤ 4 K below air)
> plus one that does not exist as stated, and **is no longer uniquely determined by the
> evidence as written**.
>
> **And the published `L` was not the shipped `L`.** The derivation above produced **0.43**,
> the midpoint of `[0.40, 0.46]`, and this document stated 0.43 in two places — including in
> the first draft of this very correction. The constant in `src/scripts/climate-engine/types.ts`
> is **`L: 0.46`**, moved later to the *top* of that band. Both numbers are now recorded here:
> **0.46 is what ships and what every figure in §5 is computed from**; 0.43 is what §4.2's
> derivation concluded. The two disagree, and *both* depend on the band whose lower bound is
> withdrawn — "the midpoint of [0.40, 0.46]" and "the top of [0.40, 0.46]" are equally
> unsupported once 4.83 °C is gone. The constants table now states the shipped value.
>
> **`L` has NOT been changed.** Re-deriving it means re-running the calibration and
> re-validating everything downstream — a code change, not a documentation one, and one
> that must not be made casually: **cooling is ⅓ of the Green Score**, so if `L` moves, the
> scores move with it. The honest state today is a shipped constant with a partly-withdrawn
> derivation, recorded here rather than hidden.

### 4.3 Green facades were overstated roughly tenfold

The facade heat-reduction coefficient was **0.30** with no source. The only neighbourhood-scale
measurement I could find — Gunawardena & Steemers 2023, *Buildings & Cities* — reports green
facades moving heat-island intensity **1.86 K → 1.81 K, about 3%**, and cutting space-conditioning
energy 2.1%. The dramatic −13 to −20 °C figures in circulation are **local wall-surface** effects;
the same authors found the vapour flux "advects away to background levels".

**Fixed:** coefficient **0.30 → 0.03**, cited. I also **deleted** the facade ground-vegetation
term entirely — its factor of 0.15 had no measurement support, and crediting a wall treatment with
ground vegetation was double-counting.

Consequence: facades went from an apparently competitive lever (1.90 °C) to a marginal one
(0.14 °C). That is what the literature says they are.

### 4.4 A physical constant was tuned for appearance — now honestly named

The diffusion constant controlling how far cooling spreads was selected because it produced a
**legible map**, not because a measurement supported it. Our own documentation recorded this
openly, which I credit, but a visual criterion had chosen a physical parameter.

It turns out the deeper problem is that it was never diffusivity at all: **lateral heat conduction
between 7.3 m cells is roughly eight orders of magnitude too small to matter** (soil diurnal
damping depth ≈ 0.12 m). Real horizontal coupling comes from wind-driven advection, which this
model does not represent.

**Fixed:** relabelled throughout as an **empirical spatial-influence kernel**, with the physics
stated plainly. The value is unchanged — deliberately short, because our field is surface
temperature, which real thermal imagery shows as sharp. The 120–300 m park-cooling distances in
the literature are an air-temperature phenomenon.

### 4.5 Two pathway figures were scientifically indefensible

The projection slider offered **−1.2 °C ("target 2030")** and **+2.4 °C ("BAU 2040")**, both
uncited.

**No emissions scenario produces regional cooling over India.** Even the most aggressive mitigation
pathway has India warming through mid-century because of committed warming. A "target" showing
Kolkata 1.2 °C *cooler* than today is a mitigation aspiration drawn on a physical-temperature axis,
and it reads as a forecast.

**Fixed:** the negative pathway is **deleted**. The remaining two are cited to Dhara et al. 2025,
*PLOS Climate* (post-AR6 India update): **SSP2-4.5 +1.25 °C** (2041–2060) and **SSP5-8.5 +4.1 °C**.

### Also corrected: the score weights

The 40/40/20 split had **no published precedent** and implied greening and cooling were each
exactly twice as important as cost. Equal weighting is the most commonly applied approach in
composite-indicator practice (OECD/JRC 2008) and the convention in urban-resilience indices.
**Now equal thirds**, cited. An arbitrary split dressed as a derived one is worse than a plain one.

---

## 5. The validation harness

`scripts/validate-model.mjs` scores model output against cited benchmarks on every run.

Values below are the harness's own output, re-read on **2026-08-08** (the table had drifted six
rows stale against the shipped constants).

| Check | Value | Expected | |
|---|---|---|---|
| Land-cover thermal contrast | 9.62 °C | 8–18 °C | ok |
| Max ward cooling ≤ local park cooling | 4.55 °C | ≤ 5.80 °C | ok |
| Local park cooling | 5.80 °C | ≤ 8.07 °C (Kolkata daytime max) | ok — one-sided, see §4.2 |
| Vegetated surface below air | 0.48 K | ≤ 4 K | ok |
| Built surface above air | 13.34 K | 5–25 K | ok |
| Facade vs cool-roof cost per m² | 63× | 40–80× | ok |
| Score at zero intervention | 2 | 0–10 | ok |
| Score at full intervention | 67 | 0–100 | ok |

**8 of 8**, from 4 of 10 before the audit.

**One methodological note you should interrogate.** Three checks were demoted from pass/fail to
informational. Before doing that I tested whether they were real defects, and all three borrowed
**air-temperature** benchmarks for a model computing **surface** temperature. The clearest evidence:
WRI India's figures for the *same* street trees are **−0.3 °C air** and **−27.5 °C road surface** —
a 90× gap. No published ward-mean *surface* benchmark exists, so max cooling is now bounded by a
physically necessary rule instead (a field's mean cannot shift further than its largest local
change). "My benchmark was wrong" is what motivated reasoning sounds like, so the reasoning is
written into the code for you to check.

---

## 5A. Validation against measurement — what it found

This section is new. Everything above it checks the model against *published literature*; this
checks it against *satellite observations of our own three wards*.

### The calibration set

| | |
|---|---|
| Source | NASA ECOSTRESS L2T LSTE v002, 70 m land-surface temperature |
| Window | 2024-01-01 → 2026-07-01, both day and night overpasses |
| Attempted | 179 acquisitions |
| Usable | **49 scenes** (31 night), after cloud and coverage screening |
| Excluded | 130, **each recorded with its reason** — no silent exclusions |
| Urban / rural classes | GHS-SMOD R2023A (EU/UN Degree of Urbanisation), not a temperature threshold |
| Meteorology | NASA POWER hourly, matched to each overpass in local solar time |
| Land cover | ESA WorldCover 10 m, measured inside the same masks — not assumed |

Two controls were run rather than assumed. The urban–rural **view-angle** difference correlated with
the measured heat-island signal at r = −0.322 (p = 0.024), meaning about 10 % of the apparent signal
was sensor geometry rather than climate; restricting to near-nadir scenes (≤ 0.75°) removes it and
retains 36 scenes. The three alternative definitions of "rural" disagree by only 0.08 °C, so that
choice is not a material source of uncertainty.

### How accurate the model is

The important question is not only "how close is our model" but "**how close could any model get**
with the data available". So alongside the model's own error we computed a **ceiling**: the error of
the best possible statistical predictor built from the same weather inputs, scored leave-one-out so
it cannot flatter itself.

| | ward-scenes | best achievable | our model | reported |
|---|---|---|---|---|
| Night | 50 | 2.23 °C | 2.93 °C | **± 3.0 °C** |
| Day | 29 | 3.34 °C | 4.42 °C | **± 4.5 °C** |

*Revised July 2026. These are measured at WARD scale — see §5B, which explains
why the previous mask-scale figures described a different surface than the one
the tool renders.*

Read the "best achievable" column first. **At night the model has real headroom** — a better model
could reach ~2.2 °C, so continued work is worthwhile. **By day, no model driven by this weather data
can beat ~3.3 °C.** Daytime surface temperature depends on cloud timing, local sunshine and soil
moisture that a 50 km reanalysis grid cell simply cannot see. That is a property of the input data,
not a defect we can engineer away, and the only real fix is higher-resolution meteorology.

This is why the tool now labels the daytime view **indicative only** and reserves quantitative
language for night. Presenting a ± 5 °C daytime figure as decision-grade would be the actual
inaccuracy.

### What those figures do NOT cover — spatial skill

Everything in the table above is a **ward-mean** error: how far the model's average temperature sits
from ECOSTRESS's average over the same 1400 m box. It says nothing about whether the pattern *inside*
the ward is right — and the pattern is what a reader looking at a map actually uses. A model that got
the ward average exactly right while placing every hot block in the wrong street would score
identically in that table.

So we measured the other thing, at ECOSTRESS's native 70 m, with the ward mean removed from both
sides so this is pattern only. 81 ward-scenes across 32 near-nadir scenes and three wards:

| predictor | overall r | day | night |
|---|---|---|---|
| **Our model** | **0.113** | 0.175 | 0.074 |
| Built fraction alone | 0.037 | -0.012 | 0.067 |
| **Vegetation alone** | **0.229** | 0.297 | 0.186 |

**A plain vegetation map predicts within-ward heat about twice as well as our full physics model.**
The two null predictors are the reason that is legible at all: r = 0.11 on its own reads as "some
skill", and only the comparison shows it is worse than a single one of the layers the model is built
from. Publishing the correlation without the nulls would have been technically true and materially
misleading.

Decomposing the field into its three spatially-varying terms says why:

| term | correlation with measured heat | spatial variation it contributes |
|---|---|---|
| Solar / albedo | 0.040 | 0.02 °C |
| **Built fraction** | **0.037** | **1.46 °C** |
| Vegetation | 0.229 | 0.53 °C |

The built-fraction term contributes most of the picture and carries no measurable skill; the
vegetation term carries the skill and is outweighed roughly three to one. So the map's block-by-block
detail is largely a rendering of building-footprint density, and footprint density does not predict
where ECOSTRESS sees heat at 70 m. The likely reason is physical rather than a coding error: in a
dense ward nearly every cell is built, and daytime surface temperature is set by roof material and
shading, which a footprint polygon does not carry.

**This is the second independent line of evidence pointing at the model's structure rather than its
constants.** The fit above ran all three free parameters to their bounds; this shows the term that
dominates the spatial field has no skill. Both point the same way, and together they say that tuning
constants is not where the remaining error is.

**What this does not affect.** Ward-level accuracy is measured separately and is unchanged, as are
the DC-URS resilience scores — the score reads ward-level indicators and never the per-cell field.
The finding bears on one claim only: that the hot and cool blocks *within* a ward mean something.

**What we did about it.** The tool now states it. The colour legend carries the measured figure, the
honesty banner says "block detail illustrative" at every screen width, and both readout tooltips
carry the full sentence including this vegetation comparison. The figures are held as data in
`src/scripts/climate-engine/accuracy.ts` and asserted, so the wording cannot go on claiming the
pattern is unvalidated after that stops being true.

Method and its limits, for the record: near-nadir scenes only; cells dropped where ECOSTRESS is
cloudy, low-quality or water; the model evaluated at equilibrium with no lateral diffusion, so real
advection between adjacent cells counts against it; a ward is about 21 × 21 cells at 70 m, so a
single scene's correlation is noisy and the aggregate is the figure. Reproduce with
`python3 scripts/measure-spatial-accuracy.py`; full per-scene output in
`data/calibration/spatial-accuracy.json`.

### The fit failed, and that is the honest result

We then attempted to fit the model's three remaining free constants — anthropogenic heat, the
radiative-to-convective coupling ratio, and the sky-emissivity coefficient — to the measured scenes,
with residuals taken on urban *and* rural absolute temperatures rather than on their difference
alone. Matching a difference while both sides are wrong is not a calibration.

It did not pass. **All three constants ran to the edge of their physically defensible bounds** and
the error stayed at 3.75 °C against a ± 2 °C acceptance bar. Every one moved in the direction that
makes the modelled surface warmer, and it was still too cold. Widening the bounds would have
produced a number rather than a calibration, so the fitted values were **not adopted** — the model
ships with its previous, literature-derived constants, and the fit output is recorded with an
explicit "do not ship" flag.

Three candidate explanations were tested and none survived:

| Hypothesis | Result |
|---|---|
| Missing heat-storage / thermal inertia | Error moved only 3.75 → 3.41 °C. Insufficient. |
| Evapotranspiration limited by soil moisture rather than air dryness | Removed the bias but *worsened* the scatter; the parameter ran to its bound, so it merely reduced evaporation overall. |
| Vegetation vigour (NDVI) explaining the daytime signal | Ruled out earlier — rural vegetation index exceeds urban in every scene regardless of the sign of the measured heat island. |

What the evidence does point to is that **the evapotranspiration coefficient is too strong** — the
one set in §4.2 from local park-cooling measurements. Regional satellite means disagree with local
park measurements, which are genuinely different quantities (a park interior versus a mask-wide
average). That tension is unresolved and is listed in §6 rather than split down the middle.

### Why the acceptance bar itself was wrong

The ± 2 °C bar was written before anyone knew what was achievable. The ceiling analysis shows it was
never reachable for daytime and sits at the edge of possible for night. A target that no model can
meet is not a quality standard; the per-phase figures above replace it.

---

## 5B. Why the fit failed, and what fixed it (July 2026)

§5A above records a calibration that ran all three of its free constants to the
edge of their bounds and stopped, with the verdict *"the model structure is
wrong, not its constants."* That was half right. The structure did need two
changes — but the reason nothing worked was that **the fit's target was the
wrong geography.**

### The masks were not what they were called

The old fit scored the model against two GHS-SMOD classes: an "urban" mask of
3,363 km² and a "rural" one of 1,568. We sampled both with Sentinel-2, sixteen
windows each, and they are the same landscape:

| mask | area | vegetation (FVC) | built |
|---|---|---|---|
| "urban" | 3,363 km² | **0.678** | 0.16 |
| "rural" | 1,568 km² | 0.654 | 0.01 |
| **the wards we actually render** | 1.4 km each | **0.31 – 0.45** | 0.22 – 0.37 |

The "urban" side is marginally the *greener*. Their measured temperature
difference is 0.34 °C, and now we know why: it is the difference between delta
with villages and delta with crops, not an urban heat island. Meanwhile the
wards are twice as built and half as vegetated as the mask named "urban". We
were fitting one question and shipping the answer to another, and no constant
can make a two-thirds-vegetated landscape behave like a city block. That is why
every parameter ran to its bound.

The calibration set is now built at ward scale: 79 ward-scenes of ECOSTRESS at its
native 70 m inside each ward footprint, paired with that ward's own measured
vegetation, albedo and building coverage — the same three numbers the browser
draws with.

### Two structural faults, both real

**The night sign was wrong.** Measured, the ward surface sits **2.10 °C above**
air at night — stored daytime heat discharging, which is the nocturnal heat
island. The model put it 3.45 °C *below*, because a steady-state balance
computes a weighted mean of air and a sky 10–20 °C colder with nothing holding
the surface up. A sign error is not a tuning problem. It needed the storage term
(ΔQs) that a steady-state formulation omits by construction.

**No lever could warm a vegetated surface.** The evapotranspiration coefficient
was held fixed at a value derived from park-*interior* cooling measurements and
applied to an area mean — the tension §6 already flagged as unresolved. Freed
inside its defensible range, it moved to the top of that range.

### The result

| | old structure | shipped | best achievable |
|---|---|---|---|
| Night | 3.27 °C (bias **−1.54**) | **2.93 °C** (bias **+0.18**) | 2.23 °C |
| Day | 4.91 °C (bias +2.55) | **4.42 °C** (bias +0.91) | 3.34 °C |

Out-of-sample, holding one ward back and fitting on the other two: 3.95 → 3.62 °C.

Night's bias is the headline — it moved from the wrong side of air temperature
to the right one. Day improved but sits 1.08 °C above its ceiling, so the daytime
structure is still incomplete and that gap is ours, not the data's.

### What we refused

The unconstrained fit wanted a sky-emissivity coefficient of 1.40 — the top of
the published range — and an ET coefficient roughly twice what evapotranspiration
can physically deliver. Both were refused. Our own invariants caught them: at
Kolkata humidity a coefficient of 1.40 makes the clear sky as warm as the air,
and a second check requires the modelled night sky at 28 °C / 80 % to land
19–21 °C, which holds only in a narrow window around the published 1.24.

Holding every constant inside a defensible range simultaneously costs about
0.13 °C of accuracy against the unconstrained fit. We paid it. A model that fits
better using a constant nobody can defend is not a better model, and a client is
entitled to ask where each number came from.

### The within-ward pattern improved but is still not validated

Halving the anthropogenic-heat term cut the built-fraction term's spatial
dominance from 1.46 °C to 0.82 °C, now comparable to vegetation's 0.62 °C rather
than three times it. Spatial correlation rose from 0.113 to 0.162. It remains
below the 0.229 of a plain vegetation map, so the disclosure on the tool stands
unchanged. A ward-mean fit cannot fix this — building coverage is a single
number per ward in that fit, so nothing in it constrains how the field varies
*inside* a ward. That needs a per-cell calibration, which the cached
observations now make possible.

---

## 6. What I still don't trust

- **The model is now validated against measurement, and it did not pass cleanly.** This replaces the
  previous version's statement that nothing had been checked against our own wards. It has been
  (§5A, §5B), and the result is ± 3.0 °C at night and ± 4.5 °C by day — usable for screening and ranking
  interventions, not for anything requiring a defensible absolute temperature. The daytime figure
  cannot be improved without better weather data.

- **The map's within-ward pattern is not validated, and is weaker than a vegetation map.** Measured
  against ECOSTRESS at 70 m (§5A), our field scores r = 0.11 where vegetation cover alone scores
  0.23. The built-fraction term contributes 1.46 °C of spatial variation against vegetation's
  0.53 °C while correlating at 0.037, so the block-level detail is mostly footprint density
  rendered as heat. It is disclosed in the product. Ward-level figures and the DC-URS scores are
  unaffected. Fixing it is a change to the model's structure, not its constants — which is the same
  conclusion the failed fit reached independently.

- **The evapotranspiration coefficient is contested by our own measurements.** §4.2 derives L = 0.43
  from local park-cooling studies (the shipped constant is **0.46**, and half of that derivation is
  withdrawn — see the §4.2 correction). The satellite fit says it is too strong. These measure different things — a park interior versus a ward-wide average — so this
  is a real conflict between two valid datasets, not an error to be averaged away. It needs a
  deliberate decision.

- **The greening benchmark is transplanted.** Berlin's 0.30–0.60 band applies to *individual
  development sites in a temperate European city*. We apply it to *whole wards in tropical
  Kolkata*. Convenient, not validated.

- **Efficiency is still tool-relative.** No published cost-per-degree-cooled benchmark exists, so a
  ward can only score well relative to what our own model produces. Now labelled as such rather
  than presented as grounded.

- **No Indian wetland cost figure exists.** Government schemes fund *management*, not per-hectare
  creation. Also worth knowing: East Kolkata Wetlands sit under the 2006 Conservation Act, which
  prohibits conversion — so a "create wetland" lever may be modelling a legally impossible action.
  The lever is currently retired from the interface.

- **Several citations were verified from abstracts only.** Re-verification before any client
  deliverable has not happened.

- **A licensing question for you:** our building footprints are ODbL, which carries share-alike
  obligations for derived *databases*. Rendered maps are almost certainly fine; the derived data
  files we ship may not be. Worth a proper answer before anything paid.

---

## 7. Open decision

Whether the Green Score should retain the **cooling term**, now that we know how uncertain it is.

The previous version of this document posed this question while the accuracy was unknown. It is now
measured: ± 3.0 °C at night, ± 4.5 °C by day. That changes the question from *"can we trust it?"* to
*"is this precision good enough for what we sell?"*

A score built only on the greening ratio and cost would be narrower but fully defensible today —
both rest on published standards and cited Indian unit costs. Including modelled cooling makes the
score more useful and less certain, and it is currently two of the three components (cooling
directly, plus efficiency, which is cooling divided by cost).

Two things worth weighing. In its favour: the score uses cooling as a **relative** quantity — ranking
interventions against each other under identical forcing — and much of the absolute error is common
to both sides of that comparison, so the ranking is more reliable than the ± figure suggests.
Against it: we cannot currently prove that, and a client is entitled to ask.

A middle option exists that was not available before: retain the cooling term for the **night** phase,
where the model is calibrated, and treat the daytime contribution as indicative — matching what the
interface already tells users.

This is a judgement about what the firm is willing to stand behind rather than a technical question,
so it sits with the partners rather than with engineering.

---

## 8. Sources

Verification status is marked per item: **[V]** full text or primary document consulted ·
**[A]** abstract or catalogue record only, not yet fully verified.

### Scoring standards and index methodology

| Source | Used for | Link |
|---|---|---|
| Berlin **Biotope Area Factor** (Senate Dept. for Urban Development) **[V]** | Greening weights; 0.30–0.60 target band | [berlin.de/sen/uvk/en/nature-and-green/landscape-planning/baf-biotope-area-factor](https://www.berlin.de/sen/uvk/en/nature-and-green/landscape-planning/baf-biotope-area-factor/) |
| **Seattle Green Factor** (SDCI) **[V]** | Cross-check on surface weights | [seattle.gov/sdci/codes/codes-we-enforce-(a-z)/seattle-green-factor](https://www.seattle.gov/sdci/codes/codes-we-enforce-(a-z)/seattle-green-factor) |
| Singapore **Green Plot Ratio** (URA LUSH) **[A]** | Third comparator on the weighted-area form | [ura.gov.sg/Corporate/Guidelines/Development-Control/Non-Residential/EI/Greenery](https://www.ura.gov.sg/Corporate/Guidelines/Development-Control/Non-Residential/EI/Greenery) |
| OECD/JRC (2008), *Handbook on Constructing Composite Indicators* **[V]** | Equal weighting; sensitivity-analysis requirement | [doi:10.1787/9789264043466-en](https://doi.org/10.1787/9789264043466-en) |

### Physics, cooling evidence, and the surface-vs-air distinction

| Source | Used for | Link |
|---|---|---|
| Voogt & Oke (2003), *Thermal remote sensing of urban climates*, **RSE** 86(3):370–384 **[V]** | **§4.1** — daytime *surface* UHI 10–15 °C vs canopy *air* UHI 2–5 °C | [doi:10.1016/S0034-4257(03)00079-8](https://doi.org/10.1016/S0034-4257(03)00079-8) |
| **Li, Lu, Fu, Sun, Pan, Han, Guo & Li (2022)**, *Diverse cooling effects of green space on urban heat island in tropical megacities*, **Frontiers in Environmental Science** **[V]** — *previously miscited here as "Mitra et al."* | **§4.2** — TVoE **0.77 ha** and reach **420 m** are Kolkata's and stand. **Kolkata's daytime maximum UCI is 8.07 °C; 4.83 °C is Bangkok's** — the "4.83–8.07 °C Kolkata band" this register formerly claimed does not exist. See the §4.2 correction. | [doi:10.3389/fenvs.2022.1073914](https://doi.org/10.3389/fenvs.2022.1073914) |
| Gunawardena & Steemers (2023), *Neighbourhood-scale vertical greening*, **Buildings & Cities** 4(1) **[V]** | **§4.3** — heat-island intensity 1.86→1.81 K (~3%); energy 2.1–5.2% | [doi:10.5334/bc.282](https://doi.org/10.5334/bc.282) |
| **LBNL Heat Island Group** — cool roof materials **[V]** | Albedo 0.15 dark / 0.60 aged-cool | [heatisland.lbl.gov/coolscience/cool-roofs](https://heatisland.lbl.gov/coolscience/cool-roofs) |
| **WRI India**, *Urban Trees' Cooling Potential* **[V]** | Canopy dose-response; the −0.3 °C air vs −27.5 °C surface contrast in §5 | [wri.org/insights/urban-trees-cooling-potential](https://www.wri.org/insights/urban-trees-cooling-potential) |

### Climate projections

| Source | Used for | Link |
|---|---|---|
| Dhara, Deshpande, Roxy, Dalpadado & Shrestha (2025), **PLOS Climate** 4(11):e0000724 **[V]** | **§4.5** — SSP2-4.5 +1.25 °C (2041–60); SSP5-8.5 +4.1 °C | [doi:10.1371/journal.pclm.0000724](https://doi.org/10.1371/journal.pclm.0000724) |
| Ministry of Earth Sciences (2020), *Assessment of Climate Change over the Indian Region* **[A]** | Cross-check: RCP4.5 +2.41 ± 0.40 °C by 2066–95 | [link.springer.com/book/10.1007/978-981-15-4327-2](https://link.springer.com/book/10.1007/978-981-15-4327-2) |

### Urban heat island benchmarks (used to sanity-check, not to calibrate)

| Source | Kolkata / India value | Link |
|---|---|---|
| Nayak, Vinod & Prasad (2023), **Applied Sciences** 13(24):13323 **[A]** | Kolkata night SUHII 0.85 °C annual | [doi:10.3390/app132413323](https://doi.org/10.3390/app132413323) |
| Jain (2023), **Frontiers in Sustainable Cities** 5:1084573 **[A]** | Kolkata night 1.3–1.5 °C (DJF) | [doi:10.3389/frsc.2023.1084573](https://doi.org/10.3389/frsc.2023.1084573) |
| Siddiqui et al. (2021), **Sustainable Cities and Society** 75:103374 **[A]** | Indian metros night 1.34–2.07 °C | [doi:10.1016/j.scs.2021.103374](https://doi.org/10.1016/j.scs.2021.103374) |
| Peng et al. (2012), **Environmental Science & Technology** 46(2):696–703 **[A]** | Global 1.5 °C day / 1.1 °C night; equal-area rural reference method | [doi:10.1021/es2030438](https://doi.org/10.1021/es2030438) |
| Chakraborty & Lee (2019), **Int. J. Applied Earth Obs. & Geoinformation** 74:269–280 **[A]** | Global 0.85 day / 0.55 night; water-masking rationale | [doi:10.1016/j.jag.2018.09.015](https://doi.org/10.1016/j.jag.2018.09.015) |
| Shastri et al. (2017), **Scientific Reports** 7:40178 **[V]** | Indian daytime *cool* island in pre-monsoon — why Kolkata needs explaining | [doi:10.1038/srep40178](https://doi.org/10.1038/srep40178) |
| Kumar et al. (2017), **Scientific Reports** 7:14054 **[A]** | 60% of 89 Indian urban areas show a daytime cool island | [doi:10.1038/s41598-017-14213-2](https://doi.org/10.1038/s41598-017-14213-2) |

### Cost sources (all Indian)

| Source | Used for | Link |
|---|---|---|
| **Telangana Cool Roof Policy 2023–2028** **[V]** | ₹150/m² cool roof; indoor −2.1 to −4.3 °C | [telangana.gov.in](https://www.telangana.gov.in/) (policy PDF) |
| **NRDC**, *Keeping It Cool: How India Can Protect Its People with Cool Roofs* **[V]** | Ahmedabad lime-wash rate; surface up to −30 °C | [nrdc.org/resources/keeping-it-cool-how-india-can-protect-its-people-cool-roofs](https://www.nrdc.org/resources/keeping-it-cool-how-india-can-protect-its-people-cool-roofs) |
| **Gujarat AMRUT 2.0** urban gardens (2026) **[A]** | ₹1.5 crore/ha park capex, from two named projects | Press release; see `heat-map-intervention-model.md` §9 |
| **PreventionWeb / NRDC** — Ahmedabad Heat Action Plan **[A]** | >1,100 deaths avoided/yr; −27% mortality on hottest days | [preventionweb.net](https://www.preventionweb.net/) |

### Input data and licences

| Dataset | Licence | Link |
|---|---|---|
| Microsoft ML Building Footprints | **ODbL** — share-alike, see §6 | [github.com/microsoft/GlobalMLBuildingFootprints](https://github.com/microsoft/GlobalMLBuildingFootprints) |
| Google Open Buildings 2.5D | CC BY 4.0 | [sites.research.google/open-buildings](https://sites.research.google/open-buildings/) |
| OpenStreetMap road centrelines | ODbL | [openstreetmap.org/copyright](https://www.openstreetmap.org/copyright) |
| Norwegian Meteorological Institute (live air temp) | Free, keyless | [api.met.no](https://api.met.no/) |
| NASA **ECOSTRESS** L2T LSTE v002 | US public domain | [doi:10.5067/ECOSTRESS/ECO_L2T_LSTE.002](https://doi.org/10.5067/ECOSTRESS/ECO_L2T_LSTE.002) |
| **ESA WorldCover** 10 m v200 | CC BY 4.0 | [doi:10.5281/zenodo.7254221](https://doi.org/10.5281/zenodo.7254221) |
| **JRC GHS-SMOD** R2023A (Degree of Urbanisation) | CC BY 4.0 | [doi:10.2905/A0DF7A6F-49DE-46EA-9BDE-563437A6E2BA](https://doi.org/10.2905/A0DF7A6F-49DE-46EA-9BDE-563437A6E2BA) |
| **NASA POWER** hourly meteorology (MERRA-2) | US public domain, no key | [power.larc.nasa.gov](https://power.larc.nasa.gov/) |
| Open-Meteo historical archive | **Non-commercial — rejected** | [open-meteo.com/en/license](https://open-meteo.com/en/license) |

**Attribution strings required by licence** are recorded in `docs/heat-map-intervention-model.md`
and rendered on the tool itself.

### Methods used in the validation (§5A)

| Source | Used for | Link |
|---|---|---|
| Brutsaert (1975), *Water Resources Research* 11(5):742–744 **[V]** | Clear-sky emissivity, replacing two hard-coded sky temperatures | [doi:10.1029/WR011i005p00742](https://doi.org/10.1029/WR011i005p00742) |
| Peng et al. (2012), *Environ. Sci. Technol.* 46(2) **[A]** | Equal-area rural reference method for the heat-island difference | [doi:10.1021/es2030438](https://doi.org/10.1021/es2030438) |
| Voogt & Oke (2003), *Remote Sensing of Environment* 86(3) **[V]** | Surface vs air heat island are different quantities; view-angle sensitivity of thermal remote sensing | [doi:10.1016/S0034-4257(03)00079-8](https://doi.org/10.1016/S0034-4257(03)00079-8) |
| Spencer (1971), *Search* 2(5):172 **[A]** | Solar declination series, for per-scene sun angle | — |
| LP DAAC, *ECOSTRESS L2T LSTE v002 known issues* **[V]** | Quality-flag caveat: two documented QC bits are unset in v002 | [lpdaac.usgs.gov](https://lpdaac.usgs.gov/products/eco_l2t_lstev002/) |

**[V]** verified against full text · **[A]** verified from abstract or documentation only — see §6.

---

Full formulas and every constant: `docs/heat-map-intervention-model.md`
Validation harness: `scripts/validate-model.mjs`
