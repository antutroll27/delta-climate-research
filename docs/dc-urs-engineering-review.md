# DC-URS — engineering review and adoption plan

**From:** Engineering  
**Date:** 2026-07-27  
**Subject:** Review of the Delta Climate Urban Resilience Score, and what it takes to ship it

---

## Summary

**We're adopting it, and it replaces the Green Score.** I've read the specification, run the
reference implementation, stress-tested the formulation, and checked the anchor citation. This is
a better instrument than what it replaces, for two reasons beyond the ones in your document.

**It shrinks our biggest exposure.** We spent last week measuring how accurate our heat model
actually is: **± 3.0 °C at night, ± 4.5 °C by day** (revised July 2026 — see below), and the
daytime figure cannot be improved much further without better weather data. (Since this note was first issued we have also measured the *spatial*
skill — whether the map places heat correctly *within* a ward — and it is weak: r = 0.11, below
the r = 0.23 of a plain vegetation map. That is disclosed in the product and detailed in
§5A of the methodology. It strengthens rather than weakens the argument below: DC-URS scores on
ward-level indicators and never touches the per-cell field, so the finding does not reach the index
at all. The July recalibration improved it to 0.16 without clearing that bar, so the
disclosure on the tool stands.)

**And it corrected a sign error we had been shipping.** The model put the night
surface *below* air temperature; measured, it sits 2.10 °C above. Nocturnal heat
retention is the defining signature of an urban heat island — the thing the
instrument exists to show — and we had it backwards. Fixed in July; §5B of the
methodology has the diagnosis. Worth knowing before the index is presented to
anyone, because it is the kind of thing a reviewer finds first. In the Green Score, modelled cooling carried two-thirds of the
weight — so that uncertainty went almost straight through to the headline number. In DC-URS, heat
carries `w_H = 0.25` and is normalised over a 20 K span, so the same error moves the score by
about **5 points out of 100**, a quarter of one tier band. Your index makes our known weakness
much less load-bearing. That is a strong argument for it on its own.

**It answers the objection already on the table.** The standing criticism of the Green Score is
that it applies Berlin's Biotope Area Factor — a temperate, European, site-level standard — to
whole wards in tropical Kolkata. Moving to the IPCC AR6 hazard / exposure / vulnerability triad
fixes that at the root. Better still, there is now Indian precedent underneath it (§5), so this
becomes a genuinely local instrument rather than a differently-imported one.

The rest of this note is eight things to correct before it ships, and what replacement means in
practice.

---

## 1. The one structural change I'd ask for

**The score adds its three pillars; IPCC risk multiplies them.**

In AR6, risk is *conjunctive*: if exposure is near zero, risk is near zero however severe the
hazard. A weighted sum lets a strong pillar buy off a weak one. Worked example:

| Ward | Thermal hazard | Adaptive capacity | DC-URS |
|---|---|---|---|
| A — dangerous heat, beautifully green | 0.85 | 0.90 | **57.2** |
| B — cool, bare | 0.30 | 0.35 | **49.0** |

Ward A is 0.55 hotter and scores **8.3 points better**. Greenery is buying its way out of lethal
heat, and both land in the same action tier.

The fix is nearly free — multiply instead of add:

```
DC-URS = 100 × ACI^0.40 × (1 − EVI)^0.35 × (1 − THI)^0.25
```

This flips the ordering above, and on **your own two worked wards it barely moves**: Ballygunge
20.0 → 19.8, Baruipur 65.2 → 64.5. Your calibration survives; the compensation loophole doesn't.

---

## 2. Three defects in the greenness pillar

**NDVI and FVC are the same variable.** Your §3 defines
`FVC = (NDVI − NDVI_bare)/(NDVI_veg − NDVI_bare)` — a straight-line rescaling of NDVI. So
`φ₁·NDVI + φ₂·FVC` spends **0.80 of the greenness weight on one input counted twice**. Suggest
keeping one and spending the freed weight on something independent, such as tree-canopy fraction.

**The stability index scores water as perfect vegetation.** `VSI = 1 − σ/mean` with water's
NDVI ≈ −0.30 makes the ratio negative; the `clip(…, 0, 1)` floors it at zero, so **VSI = 1.00 —
maximum vegetation stability, for a river**. Bare ground gets 0.00. The Hooghly runs through our
study area, so this fires immediately.

**Stability cannot be simulated.** VSI measures multi-year persistence. A tree planted today has
no history: honest values give newly planted cover VSI ≈ 0.27 against a mature canopy's 0.95 — so
the simulator would show **planting trees making the score worse**. Options are to freeze it in
scenario mode, or drop it. Given it is also the broken term, I lean toward dropping it and
carrying persistence differently.

---

## 3. Three inconsistencies to reconcile

**The weights table and the code disagree.**

| Pillar | §4 table implies | §5 code uses | |
|---|---|---|---|
| Exposure | 0.429 / 0.286 / 0.286 | 0.45 / 0.30 / 0.25 | mismatch |
| Adaptive capacity | 0.50 / 0.25 / 0.25 | 0.50 / 0.30 / 0.20 | mismatch |
| Hazard | 0.40 / 0.40 / 0.20 | 0.40 / 0.40 / 0.20 | agrees |

**Two different normalisation methods.** §3 specifies min-max scaling; §5's code uses fixed
divisors. These behave very differently, and **min-max would be disqualifying for a product**:
with three wards the best always scores 1.0 and the worst 0.0, and adding a fourth ward silently
changes every existing score. The code's fixed anchors are the right choice — the text should
follow the code, with each anchor justified.

**The hazard term goes blind where it matters most.** The daytime term saturates at 45 °C, so
Ballygunge at 42.5 °C and at 47.5 °C score identically. Heat action plans exist precisely for the
wards above that line.

---

## 4. On the Czekajlo citation

The paper is real and well-regarded — Czekajlo, Coops, Wulder et al., *International Journal of
Applied Earth Observation and Geoinformation* 93:102210 (2020), 59 citations. I read it.

What it actually does is derive greenness by **spectral unmixing of annual Landsat composites
across 18 Canadian cities, 1984–2016**, and its score characterises *current level together with
trajectory*. It is not `NDVI + FVC + VSI`. The concept we're borrowing is sound and worth
crediting, but the formula in the specification isn't theirs, and describing it as their metric
would be a problem the first time a technical reviewer opens the paper. We were caught by a
borrowed benchmark once already this month, so I'd rather be careful here than quick.

Two practical notes follow from actually reading it. It is calibrated on Canadian cities, so it
carries the same transplant caveat we are leaving Berlin over — the method transfers, the
parameters do not. And it uses 33 years of annual composites for a reason: a single-scene NDVI in
a monsoon city swings enormously between wet and dry season, which is the same seasonal signal we
measured in the satellite work. Our NDVI inputs need to be seasonal composites, not one date.

---

## 5. The best news: there is Indian precedent, and a way to check ourselves

The socio-economic pillar looked like the hardest part to defend. It turns out to be the
best-supported:

- **Rathi et al. (2021)**, 63 citations — heat vulnerability index across exposure, sensitivity
  and adaptive capacity for urbanites of four Indian cities, **including Kolkata**.
- **Azhar et al. (2017)**, 126 citations — heat-wave vulnerability mapping for India from Census
  of India 2011 and the District Level Household Survey.
- **Sharma (2026)** — ward-level heat vulnerability across 80 wards of Jodhpur.

These give us both a construction method with Indian precedent *and* an independent Kolkata
ward-level map to rank-correlate our own output against. That is a real validation route for a
composite index, which normally has no ground truth at all. It is also the "local, not European"
claim actually delivered rather than asserted.

**The honest limitation:** the demographic inputs rest on **Census of India 2011**, because the
2021 census was postponed. That is fifteen-year-old data carrying 0.10 of the score. We should
state that on the face of the tool rather than have a client find it.

---

## 6. What "replaces the Green Score" means in practice

It does not cost us the simulator. The Green Score already worked as *baseline → intervention →
new score*, and DC-URS works the same way: one score, evaluated in two states.

What changes is that part of it cannot move. Population density, built density and social
vulnerability don't respond to any intervention, so **35 % of the score is fixed per ward**. Run
the numbers on Ballygunge: with a *physically perfect* retrofit — full canopy, 0.60 albedo, a
cooling refuge next door, surface temperature down to the rural baseline — the best it can reach
is **61.4**. It can never leave "Moderate Resilience".

I want to argue that this is the most valuable output the tool has, not a limitation:

> *28 of Ballygunge's missing points are demographic exposure. Trees cannot fix them. That needs
> housing, health outreach and cooling-centre policy.*

No greenness score can produce that sentence. I'd make the immovable portion **visible by
design** — it separates what greening can achieve from what only policy can, which is exactly the
distinction a municipality is paying us to draw.

---

## 7. Two things I need from you

**The socio-economic inputs.** Your worked example puts Ballygunge at 7.2 and Baruipur at 4.1 on
social vulnerability. Ballygunge is one of the more affluent parts of south Kolkata, so I suspect
those are placeholders rather than intended values. I can derive real figures from Census 2011
using the Rathi/Azhar method — I'd like your sign-off on that approach before I build it.

There's a complication worth knowing early: **our three study areas sit under three different
local bodies.** Ballygunge is KMC Ward 68; Baruipur and Barrackpore are separate municipalities
with their own boundaries and returns. We need one consistent spatial unit or the exposure pillar
isn't comparable across the three.

**A judgement call on the public tier labels.** The classification prints "Critical Hotspot —
extreme emergency risk" for scores under 40. On his own figures, **Ballygunge scores 20.0** and
would carry that label on a public page, by name. That is a strong public statement about a real
neighbourhood, and residents, councillors and the corporation will all read it. I'm not saying
it's wrong — it may be exactly the message. But it's a positioning decision rather than an
engineering one, and I'd rather raise it now than after publication.

---

## 8. Proposed sequence

| Phase | Work |
|---|---|
| 0 | Settle the spatial unit across the three local bodies. Nothing downstream is meaningful without it. |
| 1 | Observed pillars — greenness, albedo, built density, refuge access — from satellite and OSM. No modelling. |
| 2 | Exposure pillar from Census 2011, built the Rathi/Azhar way, vintage disclosed. |
| 3 | Validation — rank correlation against published Kolkata vulnerability, sensitivity analysis, and an uncertainty band carried through from our measured ± 3.0 / ± 4.5 °C. |
| 4 | Scenario layer over the pillars that can honestly move, with the fixed portion shown explicitly. |

Full formulas and every constant will land in `docs/dc-urs-spec.md` before implementation starts.

---

## Sources

| Source | Used for | Link |
|---|---|---|
| Czekajlo, Coops, Wulder et al. (2020), *IJAEO* 93:102210 | Multi-decadal greenness scoring; what it does and does not define | [doi:10.1016/j.jag.2020.102210](https://doi.org/10.1016/j.jag.2020.102210) |
| Rathi, Chakraborty, Mishra & Dutta (2021), *Int. J. Environ. Res. Public Health* | Heat vulnerability index for urbanites of four Indian cities, including Kolkata | [doi:10.3390/ijerph19010283](https://doi.org/10.3390/ijerph19010283) |
| Azhar, Saha, Ganguly & Mavalankar (2017), *Int. J. Environ. Res. Public Health* | Heat-wave vulnerability mapping for India from Census 2011 + DLHS | [doi:10.3390/ijerph14040357](https://doi.org/10.3390/ijerph14040357) |
| IPCC AR6 WGII | Risk as hazard × exposure × vulnerability | [ipcc.ch/report/ar6/wg2](https://www.ipcc.ch/report/ar6/wg2/) |
| Delta measured accuracy, ward level | ± 3.0 °C night / ± 4.5 °C day, 79 ECOSTRESS ward-scenes | `docs/green-score-methodology.md` §5A, §5B |
| Delta measured accuracy, within a ward | r = 0.11 against ECOSTRESS at 70 m, below the r = 0.23 of a vegetation map — pattern **not** validated | `docs/green-score-methodology.md` §5A |

---

*Every DOI above was resolved against Crossref before this was sent. Written to be argued with —
if any of the eight points is wrong, I'd rather hear it from you than from a client.*
