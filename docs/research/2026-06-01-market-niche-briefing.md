# Delta Climate Research — Market-Niche Briefing

*Prepared for an environmental-engineering readership. Technical conventions are named explicitly. Figures drawn from vendor market-research reports diverge by definition and are flagged "unverified" or "directional" where appropriate.*

---

## 1. The Umbrella Niche

There is no single settled label for the space Delta occupies; the category is named differently depending on whether you stand on the **services** side or the **software/data** side. The dominant analyst framing for advisory work is **climate & sustainability (C&S) consulting** [Verdantix], with an engineering-led variant called **environmental & sustainability (E&S) consulting** dominated by multidisciplinary engineering firms (WSP, Jacobs, Tetra Tech, AECOM) [Environment Analyst 2024]. The data/IP side is termed **climate intelligence** — decision-grade physical-climate-risk analytics fusing earth-science data, geospatial AI (GeoAI), and ML, positioned within the "adaptation technologies" segment of climate tech [HolonIQ 2024; J.P. Morgan/CB Insights 2024]. Emerging adjacent labels include **nature-tech / nature consulting** [Verdantix] and the still-aspirational marketing term **"planetary intelligence"** (unverified as a formal analyst segment). A firm blending peer-reviewed research, systems thinking, and generative/frontier design is most defensibly described as **research-led climate-intelligence advisory** — straddling the C&S-consulting category (revenue model) and the climate-intelligence category (method/IP), occupying the interpretation-and-design layer between raw data vendors and enterprise decision-makers.

**Market scale (definition-dependent — quote the matching scope):**

| Scope (analyst) | Base | Forward | CAGR | Source |
|---|---|---|---|---|
| Sustainability consulting (advisory) | $12.37B (2024) | ~$30B by 2030 | ~16% | [Verdantix] |
| Climate change consulting (narrow) | $6.07B (2025) | $10.99B by 2031 | 10.21% | [Mordor] |
| E&S consulting (engineering-led) | ~$54.7B (2023) / ~$58.8B (2024) | $82.8B by 2028 | ~8.6% | [Environment Analyst 2024/2025] |
| Sustainability consulting *services* (broad) | $45.75B (2025) | $180.53B by 2031 | 25.68% | [Mordor] |
| Climate-risk intelligence (data/analytics) | — | ~$31.2B by 2030 | ~17.5% | [DAI Magister] |

The broad ~$180B figure folds in implementation/operational transformation and is the loosest definition — treat as outer bound (effectively unverified as "consulting"). Verdantix restated its figure *downward* to ~70% of the original after "definitional adjustments." The defensible reference band for a boutique is the **$12–30B Verdantix sustainability-consulting** range plus the **~$31B-by-2030 climate-risk-analytics** range. **Demand driver (all sources concur):** mandatory disclosure — EU CSRD/ESRS E1, ISSB IFRS S1/S2 (S2 effective for periods from 1 Jan 2024; TCFD absorbed and disbanded Oct 2023; 36 jurisdictions adopting), and US California SB 253/261 — converting climate analysis from voluntary to audit-grade compliance work [IFRS Foundation; Mordor; Verdantix].

---

## 2. Sub-Area Deep-Dives

### (a) Urban Heat Island Mitigation

**Industry name:** Urban climate resilience / extreme-heat adaptation consulting, increasingly organized around the municipal **Chief Heat Officer (CHO)** role created by the Atlantic Council's Adrienne Arsht-Rockefeller Foundation Resilience Center (Arsht-Rock; first appointment 2021) [onebillionresilient.org; governing.com].

**Key players:** Arsht-Rock (CHO program, "One Billion Resilient"); **C40 Cities Cool Cities Accelerator & Network** (32 signatory cities incl. Bengaluru, Mumbai, Ahmedabad, Singapore, Phoenix, Athens; structured as **Protect** within 2 yrs and **Transform** within 5 yrs) [c40.org]; US practitioners Econsult Solutions, American Planning Association (Urban Heat Resilience), National League of Cities, Stanford Woods Institute [econsultsolutions.com; planning.org].

**Methods, instruments & standards:** Land Surface Temperature (LST) from thermal remote sensing — **NASA ECOSTRESS** (~70 m thermal, ISS-mounted, launched June 2018), **MODIS/Aqua** (~1 km daily LST, archive since 2002), and **Landsat TIRS** (30 m optical, 100 m thermal resampled to 30 m) [ECOSTRESS JPL; USGS]. ECOSTRESS LST can be downscaled 70 m → ~10 m via a **random-forest model** (Google Earth Engine tool) for street-scale maps [climahealth.info]. The canonical **Heat Vulnerability Index (HVI)** fuses ECOSTRESS surface temperature + socio-demographics + green-vegetation abundance + MODIS historical heatwave temps to sub-city-block resolution [Hulley et al., *Remote Sensing* 11(18):2136]. Mitigation levers: cool roofs/pavements (raising **SRI**), urban greening and tree canopy, green/blue infrastructure. Green-building tie-in: **LEED v4/v4.1 Heat Island Reduction credit** requires a 3-year aged **SRI ≥ 32** for shading roofs/parking (or vegetated/energy-generating coverage) [USGBC].

**Market size:** India cool-roof market — **$2,125M (2024) → $5,471M (2035), CAGR 8.98%** [Market Research Future] *or* **$6.2B (2025) → $11.4B (2031), CAGR 10.2%** [Mobility Foresights]; the ~3× gap reflects scope differences — do not cite a single number authoritatively (unverified vendor figures).

**Clients/buyers:** municipalities and state governments (India's 250+ Heat Action Plans across 23 states; **India Cooling Action Plan / MoEFCC**; **Telangana Cool Roof Policy 2023–2028**, India's first — exact SRI thresholds unverified, NRDC PDF returned 403); Smart Cities Mission; National Mission for Sustainable Habitat [downtoearth.org.in; eco-business.com]. Kolkata-specific "super cool" radiative materials measured at peak air-temp cuts of 5.3 °C (sub-ambient up to 8.2 °C) — single-source, indicative only [business-standard.com].

**Boutique differentiation:** owning the full vertical — remote-sensing heat diagnostics → HVI → intervention spec — into India's HAP/ICAP/Smart Cities policy demand, where incumbents occupy only one band (Arsht-Rock/C40 = governance; NASA/academia = sensing).

### (b) Mangrove Blue Carbon

**Industry name:** "Blue carbon" — carbon stored in coastal ecosystems (mangroves, tidal marshes, seagrass), split into **restoration/afforestation (ARR-type)** and **avoided conversion (REDD+)**. The differentiating pool is **soil organic carbon (SOC)** in waterlogged anoxic sediments, which dominates over aboveground biomass.

**Key players:** Conservation International (Vida Manglar/Cispatá), The Nature Conservancy, IUCN. Flagship projects: **Vida Manglar (Cispatá, Colombia)** — first fully accounted mangrove credit, 7,500→11,000 ha, ~1 Mt target, backed by Apple + CI [conservation.org]; **Delta Blue Carbon (Indus Delta, Pakistan)** — largest globally, >128.5M credits / 142 Mt CO₂ over ~60 yr, with **Inverto** dMRV [deltabluecarbon.com]. Buyers/brokers: Apple, Salesforce, Respira International, The Commons.

**Methods & standards:** **Verra VCS VM0033 "Tidal Wetland and Seagrass Restoration" v2.1** (developed by Silvestrum Climate Associates and Restore America's Estuaries; accounts for above- + belowground biomass, SOC, and wood products) [Verra]; **VM0007 (REDD+ framework)** for the avoided-deforestation side [conservation.org]; **Gold Standard** mangrove ARR methodology [ClearBlue Markets]; **High-Quality Blue Carbon Principles & Practitioners Guidance** (CI, IUCN, TNC, ORRAA, WEF; updated 2024–25) [mangrovealliance.org]. MRV: species-specific **allometric equations** (DBH, height, wood density); SOC via sediment coring + loss-on-ignition/elemental analysis × bulk density. Remote sensing for AGB (literature frequency 1990–2023): Sentinel-2 MSI ~14.5%, Landsat-8 OLI ~11.5%, ALOS-2 PALSAR-2 ~7.3%, Sentinel-1 SAR ~6.7%, UAV/airborne LiDAR ~4.5%; **multi-sensor fusion (UAV-LiDAR + Sentinel-1 SAR + Sentinel-2 optical) with ML regressors** is the frontier, overcoming optical biomass saturation [ScienceDirect S004896972403417X; Nature s41598-025-34281-z].

**Market size:** subset of nature-based VCM; no clean standalone figure (unverified as a discrete segment). Pricing: high-integrity nature-based **removals ~$15–$35/t**, blue carbon at the premium end (exact mangrove spot price unverified) [Senken/Regreener].

**Clients/buyers:** corporates seeking biodiversity/coastal co-benefits (Apple, Salesforce).

**Boutique differentiation:** SOC measurement rigor, baseline/additionality defensibility (countering REDD+ leakage critiques), permanence modeling under sea-level rise, and dMRV — exactly the integrity gaps where VM0033 soil accounting differentiates premium projects.

### (c) Biochar Carbon Removal (BCR)

**Industry name:** **Biochar Carbon Removal (BCR)** — durable engineered CDR; waste biomass **pyrolyzed** (oxygen-limited) into recalcitrant carbon with >100-yr persistence, applied to soils or non-soil uses (concrete, building materials).

**Key players (suppliers):** **Exomad Green** (Bolivia; #1 CDR seller, ~360,000 t, ~60% of all BCR credits sold since 2022); **Carbo Culture** (patented "carbolysis"); **Carbofex** (Finland; Shopify + Microsoft buyers); **Pacific Biochar**. Per CDR.fyi (Feb 2025), **16 of the top 20 CDR sellers are biochar producers**. **Top buyers:** Microsoft (~46% of all BCR contracted); Microsoft + Google + BCG + JPMorgan ≈ 57%; 290 unique purchasers — the broadest buyer base of any CDR method [CDR.fyi].

**Methods & standards:** **Verra VCS VM0044 "Biochar Utilization in Soil and Non-Soil Applications" v1.2** (active 27 Jun 2025; Sectoral Scope 13). Assigns a **conservative persistence factor — a function of pyrolysis temperature and residence time** — estimating the carbon fraction persisting 100 years, adjusted down for pyrolysis-fuel emissions; v1.2 added mandatory investment analysis for additionality; **ICVCM-approved as meeting Core Carbon Principles (CCP)** [Verra]. (Note: VM0044 does **not** publicly state an explicit **H:C_org ratio threshold** in the fetched page; treat any specific H:C_org cutoff as **unverified**.) **Puro.earth Biochar Methodology** — first to market (May 2019); issues **CORCs** (1 CORC = 1 t CO₂ removed long-term); >100 projects, >1.5M CORCs; 2025 Edition (~142 pp) tightens biomass sourcing and durability thresholds [puro.earth]. EDF maintains a public protocol comparison [edf.org]. MRV inputs: feedstock type, reactor efficiency, biochar yield/mass, carbon content, end use; third-party verification.

**Market size:** **$14.6M (2022) → $33.9M (2023) → $181.5M (2024), CAGR 131.6%**; 3.04 Mt contracted (2022–H1 2025), 658 kt delivered, 302 kt retired [CDR.fyi]. Price/tonne: avg **~$131/t (2023) → ~$164/t (2025)**; range €105–200/t (German €189–200, Bolivian industrial €160–180) [carboncredits.com; Senken].

**Clients/buyers:** hyperscalers and financials (Microsoft, Google, BCG, JPMorgan, Shopify).

**Boutique differentiation:** the quantified 100-yr persistence + CCP approval underpin biochar's ~5–10× price premium over mangrove credits; a research firm differentiates on persistence-factor modeling, feedstock/reactor telemetry MRV, and **biochar-in-concrete** crossover (see niche d).

### (d) Sustainable Materials Trading (UAE–India)

**Industry name:** low-carbon materials flow / embodied-carbon advisory along the **India–UAE corridor**, monetizing the EPD + CBAM compliance data layer.

**Key players / tooling:** **EC3** (Building Transparency; free open-access embodied-carbon accounting, aggregates verified EPDs; observed ≥30% embodied-carbon reductions — e.g., Microsoft Puget Sound, Amazon 20% concrete spec); **One Click LCA** (Helsinki; LCA + EPD Generator, EN 15804+A1/+A2, ISO 14067, integrated with EC3) [buildingtransparency.org; oneclicklca.com]. Material players: **EMSTEEL × Magsort** (10,000-t decarbonized-cement pilot, Al Ain, May 2025) [cemnet.com].

**Methods & standards:** **EPD = Type III environmental declaration per ISO 14025**, third-party verified, life-cycle-based (GWP/embodied carbon, recycled content, energy, water); construction EPDs follow **ISO 14040/14044, ISO 14025, EN 15804 (+A1/+A2), ISO 21930**; valid 5 years; comparability via **PCRs** [environdec.com; BRE; AIA]. Regulatory forcing functions: **India–UAE CEPA** (signed 18 Feb 2022, in force 1 May 2022) [investindia.gov.in; moet.gov.ae]; **EU CBAM** definitive phase from **1 Jan 2026** (cement, iron & steel, aluminium, fertilizers, electricity, hydrogen; punitive default values absent verified product-level emissions; India among top-5 cost-bearers by 2030) [European Commission; Fastmarkets]; UAE green-building codes **Estidama (Pearl)** and Dubai **Al Sa'fat** pushing SCMs (GGBFS, fly ash) [stonehaven.ae]. Low-carbon materials: high-volume GGBFS/fly-ash concrete (Masdar precedent); **biochar in concrete** (2–5% addition, ~115 kg CO₂/m³ sequestered) [Nature s41598-025-07210-3]. (RAK low-silica limestone and India >600 Mt/yr agri-residue claims are **lightly sourced — unverified**.)

**Market size:** GCC green building materials ~**$10.6B**; UAE sustainable construction materials ~**$1.2B** [Ken Research — single-vendor, directional, not audited].

**Clients/buyers:** Indian steel/cement/aluminium exporters facing CBAM; UAE developers/contractors under Estidama/Al Sa'fat procurement specs.

**Boutique differentiation:** EPD generation/verification brokerage, CBAM emissions-data dossiers, and a proprietary corridor-specific embodied-carbon dataset tying credit-stacking (Indian Carbon Market expected 2026) to compliance.

### (e) Geospatial Digital Twins & Biophilic Architecture

**Industry name:** **geospatial / city-scale digital twins** (under "physical AI" / "industrial metaverse" framing) plus **biophilic design** and its computational arm, **parametric/generative & biomimetic design**.

**Key players & stack:** **Cesium** (OGC **3D Tiles** standard + CesiumJS; **Cesium for Omniverse**); **NVIDIA Omniverse + OpenUSD** (Omniverse Blueprint for smart-city AI; **Earth-2** climate simulation); **Bentley iTwin** (BIM digital twins; LumenRT; Dublin pilot fusing Bentley + Cesium + Omniverse); **Esri ArcGIS Urban** [cesium.com; blogs.nvidia.com; blog.bentley.com]. Biophilic firms: **Terrapin Bright Green**, **Stok**, **Ambius** [terrapinbrightgreen.com; stok.com].

**Methods & standards:** digital twins ingest LST rasters, land-cover, canopy, and microclimate/CFD outputs to simulate cool-corridor and greening scenarios pre-build — bridging niche (a)'s sensing to design. Biophilic design is embedded in all three high-performance rating systems: **WELL v2** (features map to nearly all **14 Patterns of Biophilic Design**; e.g., Feature 54 Circadian Light Design ↔ "Dynamic & Diffuse Light"); **LEED v4/v4.1** (biophilia via IEQ Daylight & Views; plus the Heat Island Reduction credit); **Living Building Challenge** (dedicated biophilic requirement) [stok.com; terrapinbrightgreen.com; USGBC]. **Terrapin's "14 Patterns of Biophilic Design"** is the de-facto methodology reference. Canonical generative/biomimetic build: **Bosco Verticale (Milan)**, ~20,000+ plant integrations [parametric-architecture.com].

**Market size:** no clean standalone figure provided across briefs (treat as a method/IP layer rather than a sized market).

**Clients/buyers:** urban planners, infrastructure owners, architects, municipal resilience programs.

**Boutique differentiation:** the integrated vertical — remote-sensing diagnostics → digital-twin scenario simulation → biophilic/generative intervention spec — that no single incumbent (governance bodies, NASA/academia, twin platforms, or biophilic consultancies) spans alone; and using generative design as a **scenario-communication engine** to make climate uncertainty legible to boards.

### (f) Hyper-Local Sustainability Data Product

**Industry name:** hyper-local **climate-risk / adaptation SaaS** — turning physical-risk models into parcel-level adaptation advice.

**Key players:** incumbents **MSCI**, **Moody's (RMS)**, **S&P Global (Climanomics)**, **Verisk**, **Swiss Re (Location Risk Intelligence)**, **Munich Re**; climate-natives **Jupiter Intelligence** (ClimateScore Global; ~$84–88M raised through Series C; Jupiter AI launched Jun 2024; powers PwC UK's physical-climate tool), **Climate X** (Spectra; ~1.5B pre-mapped assets), **ClimateAi** (agriculture/food supply-chain), **Sust Global** (geospatial scenario API), **First Street**, **XDI**, **Intensel**, **AlphaGeo** [Fortune Business Insights; jupiterintel.com; climate-x.com; CB Insights]. **Cervest is defunct** — UK administration June 2023, IP (incl. EarthScan) sold to **Mitiga Solutions** — a cautionary tale of thin moat + over-hiring in a crowded data layer [Interpath; Mitiga].

**Methods & standards:** asset-level exposure × hazard layers (riverine/pluvial/coastal flood, tropical cyclone/storm surge, wildfire, heat stress, drought, subsidence/landslide), via **statistical/dynamical downscaling of CMIP6 GCM ensembles** under **IPCC AR6 SSP/RCP** (and **NGFS**) scenarios, with hydrodynamic flood modeling, probabilistic catastrophe modeling, and satellite remote-sensing validation; outputs hazard probabilities + financial damage functions with uncertainty bounds. Reporting hooks: **TCFD → ISSB IFRS S2**, **CSRD/ESRS E1**, bank/insurer stress-testing. **Model disagreement is a known issue** — CarbonPlan found vendors' asset-level outputs frequently diverge [carbonplan.org] — a QA/credibility opening.

**Market size:** **$1,799.5M (2025) → $2,110.7M (2026) → $7,706.4M (2034), CAGR 17.57%** [Fortune Business Insights, 11 May 2026]; deployment cloud-based 74.96% vs on-prem 25.04%. Other vendors cite ~28% CAGR or the broader $31B framing [DAI Magister; Technavio] — **vendor-divergent, flag as not apples-to-apples**.

**Clients/buyers:** banks/lenders, insurers/reinsurers, real-estate & infrastructure asset owners, CSRD/IFRS-S2 reporting corporates, governments/municipalities. Economics: enterprise tier ~six-figure USD/yr (Jupiter, S&P, Moody's RMS, MSCI); mid-market ~€20,000–60,000 for 30–100 assets [repath.earth — indicative].

**Boutique differentiation:** a **hyper-local adaptation-advice layer** (not just a risk score) — parcel-level retrofit/material/drainage recommendations — combining the climate-risk model with the embodied-carbon/materials dataset from niche (d). This cross-product (risk → prescriptive low-carbon adaptation spec) ties Delta's verticals together on one geospatial + LCA data spine.

---

## 3. Competitive Landscape — Incumbents vs. Boutiques

The field has **three poles**, and a research-led boutique is defined by what it is *not*.

**A. Incumbents (scale & assurance).** *Strategy/management houses* — McKinsey Sustainability, BCG, Bain, Deloitte, EY, KPMG, Accenture, PwC. *Engineering "Big Four"* — WSP, Jacobs, Tetra Tech, AECOM — grew from **24% (2018) to 35% (2023)** combined share; top 10 now hold **49%**, growth acquisition-led (WSP bought $2.6B of E&S revenue in 5 yrs; RSK added 52 firms since 2018) [Environment Analyst]. *Pure-play sustainability* — **ERM**, the largest, **acquired by Capgemini (2023)**, now inside a systems-integrator with commoditization risk. Incumbents win on procurement scale, regulatory assurance, and global delivery but are commoditizing around GHG accounting (~31% of climate-consulting revenue) [Mordor].

**B. Climate-intelligence data vendors (instrument layer).** Jupiter, Climate X, ClimateAi, Sust Global — sell decision-grade physical-risk analytics by subscription; differentiate on peer-reviewed science and GeoAI/satellite data. Weakness: thin advisory/interpretation layer and stand-alone-SaaS fragility (Cervest insolvency). Tellingly, **Arcadis partnered with Jupiter** to wrap the vendor's analytics in engineering interpretation — illustrating that **software needs an advisory wrapper**.

**C. Systems-change / research labs (the credibility yardstick).** **Dark Matter Labs** (institutional "dark matter" — monetary, governance, legal redesign; light on quantified physical-risk/MRV), **Systemiq** (sector transition roadmaps), and non-commercial labs **WRI, RMI, Climate Analytics** that set the "research-led, trustworthy" standard but are slow, non-productized, and not design-forward.

**The trust crisis = the wedge.** The **Kariba REDD+ scandal** — Verra found **~57% of Kariba's ~27M credits issued "in excess"** of real abatement; **South Pole** exited late 2023; named buyers included VW, Nestlé, L'Oréal, Gucci, **and McKinsey** [Verra via carboncredits.com; Bloomberg, 27 Oct 2023] — combined with the Cervest collapse, primes the market to reward **methodological transparency, MRV rigor, and verifiable uncertainty** over black-box scores or offset volume. (ClimateChangeNews source returned 403; figures corroborated via Bloomberg/carboncredits.com.)

**The differentiation wedge for a boutique:** Mordor explicitly tracks **"pure-play boutiques" as the fastest-growing consultancy type at 11.18% CAGR**, above the engineering-firm segment, as the market shifts "from broad, process-heavy programmes to more targeted, outcome-driven engagements" [Mordor; Verdantix]. Boutiques win on (1) **methodological transparency as product** — publishing the full chain (CMIP6 ensemble → downscaling → hazard model → exposure/vulnerability function → financial translation, with stated uncertainty); (2) **standards fluency** — native deliverables against IFRS S2 / ESRS E1 / legacy TCFD (two-scenario minimum, physical + transition split); (3) **systems thinking + instrument-grade quantification** (the white space between Dark Matter Labs and the data vendors); (4) **generative design as a scenario-communication engine**; and (5) **senior-only, conflict-free delivery** — Delta neither develops credits nor has offset-volume incentives, making post-Kariba independence a sellable asset. The structural risk: roll-up consolidation (top 10 → 49% share) makes boutiques frequent acquisition targets rather than scale competitors.

The technical/standards vocabulary that anchors "decision-grade" credibility with environmental engineers: GHG Protocol (Corporate, Scope 3, Product Life Cycle); ISO 14064 and ISO 14068-1; SBTi validation; TCFD/IFRS S2/ISSB; EU CSRD/ESRS; PCAF; and for physical risk, IPCC AR6 SSP/RCP downscaling, CMIP6 ensembles, and NGFS scenarios. (Delta's own use of this stack is unverified.)

---

## 4. Positioning Statement

**Delta Climate Research occupies the research-led climate-intelligence *interpretation-and-design layer* — the methodology-transparent bridge that converts decision-grade climate-risk and embodied-carbon data into bespoke, standards-aligned, generatively-communicated adaptation decisions.**

Delta sits deliberately between the two poles it is *not*: not a scale incumbent selling commodity GHG accounting (McKinsey, ERM/Capgemini, the engineering Big Four), and not an un-interpreted SaaS risk-score vendor (Jupiter, the now-defunct Cervest). Its defensible white space is the senior-to-senior, conflict-free synthesis of instrument-grade analysis (ECOSTRESS/CMIP6/EPD-ISO 14025), systems reframing, and frontier/generative design — leading with integrity and transparent method into a market actively burned by black-box scoring (Cervest) and over-claimed credits (Kariba).

---

## Sources

**Fetched (primary):**
- Verdantix — sustainability consulting market sizing: verdantix.com
- Mordor Intelligence — climate change consulting market: mordorintelligence.com/industry-reports/climate-change-consulting-market
- Environment Analyst — E&S consulting market dynamics (2024 & Dec 2025 assessments): environment-analyst.com
- Verra VM0044 (Biochar Utilization v1.2): verra.org/methodologies/vm0044-biochar-utilization-in-soil-and-non-soil-applications-v1-2/
- CDR.fyi — Biochar Carbon Removal market snapshot 2025: cdr.fyi/blog/biochar-carbon-removal-market-snapshot-2025
- Conservation International — Vida Manglar: conservation.org/projects/vida-manglar-carbon-project
- C40 Cool Cities Accelerator: c40.org/accelerators/cool-cities/
- ECOSTRESS / Hulley et al., *Remote Sensing* 11(18):2136: ecostress.jpl.nasa.gov
- DAI Magister — climate-risk market size: daimagister.com/resources/climate-risk/
- Dark Matter Labs: darkmatterlabs.org
- Net Zero Insights — climate-risk startup methodologies: netzeroinsights.com
- Fortune Business Insights — Climate Risk Analytics market (11 May 2026): fortunebusinessinsights.com/climate-risk-analytics-market-116031
- Building Transparency EC3: buildingtransparency.org/tools/ec3/
- European Commission CBAM: taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism_en

**Search-surfaced (not individually fetched — verify single-vendor figures before publication):**
- HolonIQ 2024 Climate Tech Outlook; J.P. Morgan/CB Insights Climate Tech 2024; CB Insights profiles (Jupiter, Cervest)
- Verra VM0033 v2.1; Gold Standard mangrove methodology (ClearBlue Markets); High-Quality Blue Carbon Principles (mangrovealliance.org; WEF 2025)
- Puro.earth Biochar Methodology 2025; EDF biochar protocol comparison (edf.org); biochar-us.org NABC24
- ScienceDirect S004896972403417X (Asia-Pacific RS review); Nature s41598-025-34281-z; Nature s41598-025-07210-3 (biochar concrete); ScienceDirect S221450951300003X & S0301421521003736
- carboncredits.com / Bloomberg (27 Oct 2023, Kariba 57%/27M); Senken/Regreener pricing; deltabluecarbon.com; Respira International; trellis.net
- IFRS Foundation (ISSB IFRS S1/S2, TCFD); Interpath/Mitiga/Crunchbase (Cervest); TerraWatch Space/ClimateProof
- Cesium (cesium.com); NVIDIA (blogs.nvidia.com, Earth-2); Bentley (blog.bentley.com); Terrapin Bright Green; Stok; Ambius; USGBC LEED; parametric-architecture.com
- Invest India / UAE MoET CEPA; Fastmarkets (CBAM); One Click LCA; BRE; AIA; EPD International (environdec.com); cemnet.com; Stonehaven (stonehaven.ae); Ken Research
- jupiterintel.com; climate-x.com; repath.earth; CarbonPlan (carbonplan.org); Technavio
- Market Research Future / Mobility Foresights (India cool roofs); downtoearth.org.in; eco-business.com; business-standard.com; NRDC (Telangana — 403, unverified); onebillionresilient.org; governing.com; econsultsolutions.com; planning.org

**Flagged unverified:** "planetary intelligence" as a formal segment; broad ~$180B "consulting" TAM; standalone mangrove blue-carbon market value and spot price; VM0044 H:C_org threshold; India cool-roof market size (3× vendor divergence); Telangana SRI thresholds; Kolkata 5.3 °C/8.2 °C single-source figures; RAK low-silica limestone; India >600 Mt/yr agri-residue tonnage; GCC/UAE green-materials market figures; all single-vendor market-size CAGRs.
