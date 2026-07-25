# Green Score — algorithms, sources, and known weaknesses

**For:** Shirsha (Co-founder, Climate Policy)
**From:** Engineering
**Date:** 2026-07-25
**Subject:** What the Green Score actually computes, where every number comes from, and what I do not yet trust

---

## Read this part first

You asked what algorithms and sources sit behind the Green Score. You also said you're worried
the work is barely accurate. **That worry is partly justified, and I'd rather you hear the
specifics from me than find them yourself.**

Three findings, stated plainly:

1. **The tool currently displays an urban heat island figure of about +11 °C. The published
   value for Kolkata is 0.85–1.5 °C.** That is roughly eight times too high. I found this
   this week by comparing against satellite measurements and the literature. It is a real
   defect, it is live on the site, and it needs fixing before anything else.

2. **At maximum intervention the model claims 6.5 °C of ward-scale cooling. Our own
   methodology document states that anything beyond 2–3 °C is not credible.** The model
   exceeds its own stated limit by more than double.

3. **Until this week, none of the physics had ever been compared against measured data.**
   The constants were sourced from literature, but the assembled model was never validated.

What I think holds up: the **cost model** (₹ figures, sourced to Indian state policy and
municipal tenders), the **scoring structure** (borrowed from established planning standards),
and the **discipline of labelling** what is measured versus modelled. What does not hold up
is the **temperature physics** those scores partly depend on.

---

## 1. What the Green Score is

A 0–100 number combining three things:

```
Green Score = 100 × [ 0.40 × greening ratio
                    + 0.40 × cooling achieved
                    + 0.20 × budget efficiency ]
```

Each term is capped at 1.0, so the score cannot exceed 100 by overspending.

### Term 1 — Greening ratio (40%)

This is the part I'm most comfortable defending. It is a **weighted-area ratio**, the same
shape used by every established green-space planning standard:

- **Berlin Biotope Area Factor (BAF)** — the original, mandatory in Berlin since 1994
- **Seattle Green Factor** — the US adaptation
- **Singapore Green Plot Ratio** (URA LUSH programme)

All three compute *"sum of (area × ecological weight) ÷ total area"*. We use the same form.
Our weights are consolidated from Berlin's and Seattle's published tables:

| Surface | Weight | Source |
|---|---|---|
| In-ground park / vegetation | 1.0 | Berlin BAF "vegetation connected to soil" = 1.0 |
| Tree canopy over street | 0.6 | Berlin/Seattle canopy bands |
| Green facade | 0.6 | Berlin wall greening = 0.5; Seattle up to 0.7 |
| Water / wetland | 0.8 | Berlin water surface |
| Cool roof | 0.1 | Our own low weight — a cool roof is not habitat |
| Sealed surface | 0.0 | All three standards |

Normalised against **G_ref = 0.45**, the midpoint of Berlin's 0.30–0.60 target band.

**Weakness to flag:** Berlin's targets apply to *individual development sites in a temperate
European city*. We apply them to *an entire ward in tropical Kolkata*. That transplant is
convenient, not validated. A reviewer would reasonably ask why a Berlin courtyard standard
should set the benchmark for Ballygunge.

### Term 2 — Cooling achieved (40%)

Modelled temperature drop versus the no-intervention baseline, normalised against
**ΔT_ref = 2.5 °C** on the stated grounds that ward-scale cooling beyond 2–3 °C is not credible.

**This is the weak term.** See §4.

### Term 3 — Budget efficiency (20%)

Degrees cooled per ₹ crore spent, normalised against **E_ref = 0.15 °C/crore**.

**Weakness to flag:** E_ref was set as *"approximately the cool-roof-only lever, our cheapest
intervention"*. That is **self-referential** — we normalise efficiency against our own model's
output rather than an external benchmark. The methodology document flags it "calibrate on
first live run"; that calibration has not happened.

---

## 2. Where every number comes from

Honest grading. **Measured** = from data. **Cited** = traceable to a named source.
**Assumption** = chosen by us, no source. **Placeholder** = explicitly temporary.

### Costs — the strongest part

| Item | Value | Grade | Source |
|---|---|---|---|
| Cool roof | ₹150/m² | **Cited — high** | Telangana Cool Roof Policy 2023-28; NRDC India |
| Street tree | ₹1,500/tree | **Cited — med-high** | Indian municipal planting + 3-yr maintenance build-up |
| Pocket park | ₹1.5 crore/ha | **Cited — medium** | Gujarat AMRUT 2.0 gardens (2 named projects) |
| Green facade | ₹9,500/m² | **Cited — medium** | Indian vendor pricing; excludes irrigation opex |
| Trees per km | 110 | Cited | 8–12 m municipal spacing |
| **Wetland cost** | *uses park rate* | **Placeholder** | **No source found** |

### Physical coefficients

| Item | Value | Grade | Source / note |
|---|---|---|---|
| Dark roof albedo | 0.15 | **Cited — high** | LBNL Heat Island Group |
| Aged cool-roof albedo | 0.60 | **Cited — high** | LBNL "aged" value, not fresh-white 0.85 — deliberately conservative |
| Tree crown cap | 0.70 | Cited | Crown-closure limit |
| Pocket park radius | 50 m (0.785 ha) | **Cited — Kolkata-specific** | Mitra et al. 2022: threshold value of efficiency 0.77 ha |
| Facade heat reduction β_q | 0.30 | **Assumption** | **No source.** Chosen so ward-scale effect stays under 1 °C |
| Facade greening η | 0.15 | **Assumption** | **No source.** Same reasoning |
| Diffusion constant D | 2.5 | **Assumption** | **Tuned for visual contrast — see §4** |
| Pathway deltas | −1.2 / +2.4 °C | **Placeholder** | Documented as "policy-narrative placeholders", uncited |

### Score parameters

| Item | Value | Grade | Note |
|---|---|---|---|
| Weights 40/40/20 | — | **Our choice** | Not from any standard. The *components* are borrowed; the *blend* is ours |
| G_ref | 0.45 | Cited, transplanted | Berlin band midpoint, applied outside its context |
| ΔT_ref | 2.5 °C | Cited-ish | "Beyond 2–3 °C not credible" |
| E_ref | 0.15 °C/cr | **Self-referential** | Normalised against our own cheapest lever |

### Input geometry — genuinely measured

| Layer | Source | Licence |
|---|---|---|
| Building footprints | Microsoft ML Building Footprints | ODbL |
| Building heights | Google Open Buildings 2.5D | CC BY 4.0 |
| Road centrelines | OpenStreetMap | ODbL |
| Live air temperature | Norwegian Meteorological Institute | Free, keyless |
| Night surface temperature | NASA ECOSTRESS (new this week) | Public domain |

**Licensing note for you:** the footprints are ODbL, which carries a share-alike obligation
for derived *databases*. Our rendered maps are almost certainly fine ("Produced Works"), but
the derived data files we ship may need to be released under ODbL. Worth a proper answer
before any paid deliverable.

---

## 3. What the model actually produces

Run at fallback conditions (32 °C air, clear sun), synthetic dense-core ward:

| Scenario | Cooling | Cost | Score |
|---|---|---|---|
| Nothing | 0.00 °C | ₹0 | 2 |
| Cool roofs 100% | 2.25 °C | ₹7.5 cr | 63 |
| Tree corridors max | 2.30 °C | ₹66 lakh | **86** |
| Pocket parks max | 0.10 °C | ₹4.7 cr | 8 |
| Green facades max | 1.90 °C | ₹190 cr | 38 |
| **Everything maxed** | **6.51 °C** | **₹203 cr** | **82** |

Three observations:

**Trees score higher than doing everything (86 vs 82).** This is deliberate, not a bug: the
cooling term caps at 2.5 °C, so additional cooling earns nothing while the cost destroys the
efficiency term. It correctly rewards cost-effectiveness. But it is counterintuitive enough
that the interface should explain it, and currently doesn't.

**Parks deliver almost nothing at ward scale (0.10 °C).** This is correct physics — four
0.785 ha parks are 1.6% of a 196 ha ward — but it sits awkwardly beside our own cited claim
that parks produce 4.83–8.07 °C of *local* cooling. Both are true at different scales. The
tool should say so explicitly.

**Green facades cost ₹100 crore per degree.** Cool roofs cost ₹3.3 crore per degree. That
30× gap emerges from the cost model rather than being designed in, and it matches Indian Heat
Action Plan practice, where cool roofs lead. That's a point in the model's favour.

---

## 4. The four problems

### 4.1 The urban heat island figure is roughly 8× too high

The tool displays "UHI Δ vs rural: +11.3 °C" (up to +14 °C in some configurations).

Published surface UHI for Kolkata:

| Study | Night SUHII |
|---|---|
| Nayak et al. 2023 (annual) | 0.85 °C |
| Jain 2023 (winter peak) | 1.3–1.5 °C |
| Siddiqui et al. 2021 | 1.34–2.07 °C |
| Global mean, Peng et al. 2012 | 1.1 °C |

The methodological literature treats a Kolkata night value **above 2.5 °C as a processing
error**. We display 11.

**In fairness, it isn't the same quantity.** Ours is computed against a *synthetic* rural cell
inside the model — a hypothetical fully-vegetated, unbuilt cell under identical forcing — not
against a measured rural population, which is what published SUHII means. Our figure is also
a daytime-clear-sun surface value at 7 m resolution, and finer pixels legitimately read hotter
than the 1 km satellite studies.

**But no combination of those caveats spans 11 versus 1.** And the label "UHI Δ vs rural" reads
to any policy audience as the standard metric. This is both a calibration problem and a
labelling problem.

### 4.2 A physical constant was tuned for visual appearance

The diffusion constant D controls how far cooling spreads. Our documentation records the
reasoning openly:

> *"a large D averages every hot rooftop into its cool neighbours → the field homogenises
> and no reds survive… So we prioritise contrast."*

D was moved 0.15 → 9.0 → 2.5, and settled at 2.5 because it produced a **legible map**, not
because a measurement supported it. The documentation is honest about this, which I credit,
but a visual criterion selected a physical parameter. That is the kind of thing that, found
by a client rather than disclosed by us, would end a conversation.

### 4.3 The score's largest component is its least validated

60% of the score depends on the model's own ΔT — 40% directly, plus the 20% efficiency term
which is ΔT divided by cost. If cooling is overstated, the score inflates proportionally.

Given §4.1 and §4.2, that 60% rests on the weakest foundation in the system.

### 4.4 Several inputs have no source at all

Named honestly in our own documentation, repeated here so they aren't buried: facade
coefficients β_q and η (no source), pathway deltas −1.2/+2.4 °C (explicit placeholders),
wetland cost (borrows the park rate). Several literature citations were verified from
**abstracts only** and our own notes say "re-verify before quoting verbatim in a client
deliverable" — that re-verification hasn't happened.

---

## 5. What is genuinely solid

I don't want this to read as though nothing works.

- **The model class is correctly scoped.** It's a 2D energy-balance screening tool, the same
  family as SUEWS/UMEP planning-support models. Our documentation explicitly forbids claiming
  absolute air temperature, hourly forecasts, thermal comfort indices, or "we will cool your
  ward by X.X °C". That restraint is written down and predates your question.

- **One Kolkata-specific validation passes.** Local cooling inside a modelled park computes to
  7.5 °C, inside Mitra et al.'s measured 4.83–8.07 °C band for Kolkata parks. The model
  reproduced local park cooling before it was tuned to.

- **Costs are grounded in Indian sources**, not Western defaults — state policy, municipal
  tenders, WRI India. The conservative choices (aged rather than fresh roof albedo; municipal
  rather than subsidised tree cost) are documented.

- **Every constant lives in one file** with a runnable self-check, so there are no hidden
  numbers scattered through the codebase.

- **The page is `noindex` and carries a "modelled scenario" stamp.** It is not being presented
  to the public as validated.

---

## 6. What I'm doing about it

In order:

1. **Recalibrate or relabel the UHI figure.** Either compute a genuine surface UHI against a
   measured rural reference, or rename the current metric to describe what it actually is.
2. **Measure real UHI from satellite data** to calibrate against. The pipeline now works — we
   have NASA ECOSTRESS night-time surface temperature over all three wards, at 70 m, free
   and commercially licensed.
3. **Bound the claims to measurement precision.** The satellite data carries ±2 K per-pixel
   uncertainty. Nothing we publish should imply precision finer than that.
4. **Replace E_ref with an external benchmark** so efficiency stops being self-referential.
5. **Re-verify the abstract-only citations** before anything goes in front of a client.

**What I would ask of you:** whether the Green Score should keep the cooling term at all until
the physics is calibrated. A score built only on the greening ratio and cost would be weaker
but defensible today. Including modelled cooling makes it more useful and less trustworthy.
That's a judgement about what we're willing to stand behind, which is your call more than mine.

---

## 7. Sources

**Scoring standards.** Berlin Biotope Area Factor (Senate Dept. for Urban Development) ·
Seattle Green Factor (SDCI) · Singapore Green Plot Ratio (URA LUSH)

**Cooling evidence.** Mitra et al. 2022, *Frontiers in Environmental Science* — tropical
megacities incl. Kolkata; UCI = a·ln(A) + b, TVoE 0.77 ha, reach 420 m, 4.83–8.07 °C ·
LBNL Heat Island Group (roof albedo) · WRI India, *Urban Trees' Cooling Potential* — Bangalore
−5.6 °C air, +10% canopy ≈ −0.3 °C · Nature Communications 2021 — 40% canopy saturation
threshold

**Costs.** Telangana Cool Roof Policy 2023-2028 · NRDC, *Keeping It Cool: How India Can Protect
Its People with Cool Roofs* · Gujarat AMRUT 2.0 urban gardens · Indian vendor pricing (green
walls) · PreventionWeb/NRDC — Ahmedabad Heat Action Plan outcomes

**UHI benchmarks (new, this week).** Nayak, Vinod & Prasad 2023, *Applied Sciences* 13(24):13323 ·
Jain 2023, *Frontiers in Sustainable Cities* 5:1084573 · Siddiqui et al. 2021, *Sustainable
Cities and Society* 75:103374 · Peng et al. 2012, *Environmental Science & Technology* 46(2) ·
Chakraborty & Lee 2019, *Int. J. Applied Earth Observation and Geoinformation* 74 ·
Shastri et al. 2017, *Scientific Reports* 7:40178 — Indian daytime cool-island effect

**Data.** Microsoft ML Building Footprints (ODbL) · Google Open Buildings 2.5D (CC BY 4.0) ·
OpenStreetMap (ODbL) · Norwegian Meteorological Institute · NASA ECOSTRESS L2T LSTE v002
(public domain) · ESA WorldCover 10 m (CC BY 4.0) · JRC GHS-SMOD R2023A (CC BY 4.0)

Full technical detail, including every formula: `docs/heat-map-intervention-model.md`.

---

*This document deliberately leads with defects rather than capabilities. If anything here reads
as understated, ask — I would rather over-disclose internally than have a municipal client find
it first.*
