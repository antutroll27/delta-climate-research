# Green Score — algorithms, sources, and an audit

**For:** Shirsha (Co-founder, Climate Policy)
**From:** Engineering
**Date:** 2026-07-25
**Subject:** What the Green Score computes, where every number comes from, and what changed when I checked

---

## Summary

This sets out the Green Score end to end: the algorithm, where every constant comes from, and what
the model actually produces. Section 8 lists every source with a resolvable link.

Writing it prompted a proper review of the constants, which was overdue. That turned up **five**
that were uncited, self-referential, or not scientifically supportable — all now corrected and
sourced (§4). I also added a validation harness that scores model output against published
measurements on every run, so the model can't drift quietly again. It currently passes **8 of 8**
checks, up from 4 of 10.

One correction ran opposite to expectation and is worth reading first. The headline heat figure
looked roughly eight times too high against published Kolkata values, and I initially recorded it
as our most serious defect. It turned out to be **mislabelled rather than miscalibrated** — the
number is defensible, the name we gave it wasn't (§4.1).

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
| Pocket park radius | 50 m (0.785 ha) | Cited — **Kolkata-specific** | Mitra et al. 2022, threshold value of efficiency |
| **Evapotranspiration L** | **0.43** | **Derived — see §4.2** | Solved against two independent constraints |
| **Facade heat reduction** | **0.03** | **Cited — corrected from 0.30** | Gunawardena & Steemers 2023 |
| Influence kernel λ | ≈47 m | Empirical, honestly labelled | See §4.4 |
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
OpenStreetMap road centrelines (ODbL) · Norwegian Meteorological Institute live air temperature ·
NASA ECOSTRESS night surface temperature (public domain, added this week)

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

I'm flagging this prominently because it is the error I would most want caught in my own work:
I compared two numbers that shared a name and not a definition.

### 4.2 Evapotranspiration was over-strong — now derived, not tuned

The ET coefficient was 0.50, which put a fully-vegetated surface **5.8 K below air temperature** —
more cooling than evapotranspiration can physically deliver.

Rather than pick a nicer number, I solved for the value satisfying **two independent published
constraints at once**:

- park cool-island intensity of **4.83–8.07 °C** (Mitra et al. 2022, measured in Kolkata)
- vegetated surface no more than **4 K below air** (physical ceiling on ET)

They intersect at **0.40–0.46**. The value is now **0.43**, the midpoint. Both constraints now pass.

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

| Check | Value | Expected | |
|---|---|---|---|
| Land-cover thermal contrast | 10.35 °C | 8–18 °C | ok |
| Max ward cooling ≤ local park cooling | 4.45 °C | ≤ 5.42 °C | ok |
| Local park cooling | 5.42 °C | 4.83–8.07 °C | ok |
| Vegetated surface below air | 3.52 K | ≤ 4 K | ok |
| Built surface above air | 12.17 K | 5–25 K | ok |
| Facade vs cool-roof cost per m² | 63× | 40–80× | ok |
| Score at zero intervention | 2 | 0–10 | ok |
| Score at full intervention | 66 | 0–100 | ok |

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

## 6. What I still don't trust

- **Nothing has been validated against measurement for our own wards.** Every check is against
  published literature. We now have NASA ECOSTRESS night surface temperature over all three wards,
  and comparing model to measurement is the obvious next step. It has not been done.

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

## 7. What I'd ask of you

Whether the Green Score should keep the **cooling term** at all before the physics is validated
against our own measurements. A score built only on the greening ratio and cost would be weaker
but fully defensible today. Including modelled cooling makes it more useful and less certain.

That's a judgement about what we're willing to stand behind, which is more your call than mine.

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
| Mitra et al. (2022), **Frontiers in Environmental Science** — tropical megacities incl. Kolkata **[V]** | **§4.2** — park cool-island 4.83–8.07 °C; TVoE 0.77 ha; reach 420 m | [doi:10.3389/fenvs.2022.1073914](https://doi.org/10.3389/fenvs.2022.1073914) |
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

**Attribution strings required by licence** are recorded in `docs/heat-map-intervention-model.md`
and rendered on the tool itself.

---

Full formulas and every constant: `docs/heat-map-intervention-model.md`
Validation harness: `scripts/validate-model.mjs`

---

*This document leads with defects rather than capabilities by design. If anything reads as
understated, ask — I would rather over-disclose internally than have a municipal client find it
first.*
