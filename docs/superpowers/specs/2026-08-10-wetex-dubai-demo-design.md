# WETEX Dubai — demo design

**Event:** WETEX 2026, **20–22 October**, Dubai World Trade Centre. Host: **DEWA**.
**Written:** 2026-08-10 — **71 days out.**
**Status:** design, not approved. Nothing built.

**Confirmed with the CEO:**
- DEWA contact is **warm** — this is not cold stand traffic.
- **Kolkata is on the stand**, deliberately: proof of what limited funding and harsh
  constraints already produced.
- Dubai is **city-wide**, not a single district.
- **Accuracy is explicitly not required.** The goal is to show potential and what "a little
  funding" unlocks.

---

## 1 · The one guardrail

Inaccurate is fine. **Silent about accuracy is not.**

In a hall with 3,100 exhibitors, nearly every twin will be beautiful, inert and mute about
its error. Published error bars are the only thing that cannot be copied by a better render.
Every DEWA engineer will ask "how accurate is this?", and that moment decides the
conversation. The answer we want to be able to give:

> Kolkata, validated against 87 satellite overpasses — 2.3 K. Dubai isn't calibrated yet;
> this is the same engine on your geometry. Calibrating a city takes about a quarter, and
> here is what it costs.

Honest, demonstrates we know what rigour looks like, and states the funding ask in the same
breath. **The gap between the tiers IS the ask.**

## 2 · The audience insight

DEWA is an **electricity and water utility**. In the Gulf, air conditioning is roughly
**70 % of peak electricity demand**. Urban heat is not an environmental abstraction to them
— it is grid peak, generation capex, and their core P&L.

**So the demo is not "a heat map of Dubai."** It is:

> what shade, albedo and greening do to your **cooling load**.

The intervention machinery already exists (DC-URS pathways, cooling corridors, green score).
The work is retargeting its *output units* from °C to MW.

## 3 · City-wide is easier AND more defensible

The solver is fixed at `CANONICAL_GRID_N = 192` → 36,864 cells **regardless of extent**.
City-wide is a different `footprint_m`, not a different solver. Same performance, same
tier-0 phone.

| view | extent | cell | vs ECOSTRESS 70 m |
|---|---|---|---|
| Kolkata ward (today) | 1.4 km | 7.3 m | **super-resolving** (10× finer than observed) |
| Dubai district | 8 km | 41.7 m | super-resolving |
| **Dubai urban core** | **40 km** | **208 m** | **aggregating (~9 pixels/cell)** |

**This is the most useful finding in the design.** Our known weakness — the within-ward
pattern failing to beat a vegetation map — comes partly from claiming structure finer than
the observations support. At city scale that failure mode disappears: each cell averages
several real satellite pixels instead of inventing detail between them.

City-wide Dubai is therefore *scientifically stronger* than a district demo, and cheaper.

## 4 · The stand narrative (three beats)

1. **Kolkata — earn trust.** Three wards, drones banned over one of them, free satellite
   data, two people. Validated to 2.3 K peak / 2.9 K night against 87 overpasses. Show the
   receipts: the rejected SVF hypothesis, the `underpowered` verdict we published rather
   than buried.
2. **Dubai — show reach.** Same engine, their city, this morning's weather. Tier-2 badge,
   stated plainly.
3. **The intervention — show value.** Shade this corridor → −X °C → **−Y MW of peak AC
   load**. This is the beat that converts a demo into a procurement conversation.

## 5 · Scope

### Track A — portability (the enabler)
- A `City` record extending `Ward(id, centre, footprint_m)` with a **CRS derived from
  longitude** rather than the hardcoded `TARGET_CRS = "EPSG:32645"` (UTM 45N, ~6 uses in
  `_ecostress.py`).
  **CAUTION: `target_grid` is pinned by the geo-oracle parity fixtures** — changing it
  touches the Go-port contract. Kolkata's grid must stay byte-identical.
- Per-city data directory. 56 files currently name a ward literally.
- **Not** in scope: retiring the India-only enrichment sources (CPCB, opencity, IMD
  heatwave, census socio). They simply become absent for Dubai.

### Track B — Dubai ingest (tier 3 → tier 2)
- Footprints + heights from **Dubai Pulse** (free, GeoJSON, Law 26/2015).
- Sentinel composites and SRTM — the existing fetchers are already global.
- ECOSTRESS over Dubai — `cmr_search` already takes a bbox.
- **Köppen-zone constants.** Kolkata is `Aw`, Dubai is `BWh`. Fit from Dubai's own ECOSTRESS
  if time allows; otherwise literature values, labelled tier 2.
  **Known physics problem:** in an arid city the `L·veg` term — our strongest within-ward
  signal — goes to ≈0 and the evap ramp pins at its cap. This must be stated, not hidden.

### Track C — the demo surface
- City-wide view (`footprint_m ≈ 40 km`) plus district drill-down.
- **Cooling-load conversion: °C → MW.** NEEDS A REAL SOURCE. Literature puts peak cooling
  demand at roughly 2–5 % per °C, but the coefficient must be cited (ideally a DEWA or Gulf
  figure), never invented. If no defensible number exists, show ΔT and say so.
- **Tier badge** in the UI — small component, and it is the entire funding pitch rendered.
- Kolkata ↔ Dubai switch, so the two-climate story is one click.

### Track D — polish, cut first if time runs out
- Landmark GLBs (Burj Khalifa, Museum of the Future) via the existing river GLB/Draco/LOD
  pipeline.
- Unattended attract loop for the stand.

## 6 · What is explicitly NOT in scope

- Full tier-1 Dubai calibration. Tier 2 is the target; the gap is the pitch.
- The shadow sign test — unrelated to October.
- The four stale calibration artefacts — unless Kolkata figures appear on the stand, in
  which case `spatial-accuracy.json` must be regenerated first so the numbers we show are
  the numbers we ship.
- Retiring India-only data sources.

## 7 · Risks

| risk | mitigation |
|---|---|
| Arid constants fit badly | tier 2 is *stated*, so a poor fit is disclosed rather than fatal |
| 71 days, with the vegetation feature in flight | Track D is cuttable; Tracks A–C are the critical path |
| Dubai Pulse coverage/quality unverified | **check first** — a day's work, and it gates Track B |
| CRS change breaks the geo-oracle | Kolkata's grid must stay byte-identical; the parity fixture is the test |
| °C→MW coefficient unsourced | show ΔT only rather than publish a number we cannot defend |

## 8 · Verification

- Kolkata's outputs byte-identical after the portability change (geo-oracle + the three
  ward artefacts).
- `npm run verify` green, mypy 0.
- Dubai renders city-wide at 60 fps on a **tier-0 Android** — the stand may run on
  anything, and the fill-rate harness at `previews/splat-fillrate/` is the measurement.
- The tier badge cannot display "validated" for a city without its own validation artefact
  — asserted, in the manner of `assertAccuracyLogic`.

## 8a · RESEARCH FINDINGS, 2026-08-10 (licences verified from primary sources)

**ECOSTRESS over Dubai is ABUNDANT — measured live, not assumed.** CMR search over the
urban core bbox (54.90, 24.85, 55.60, 25.45) for 2024–2025 returned **145 day overpasses /
534 granules** and **134 night / 491 granules** — roughly 3× Kolkata's entire supply (34
near-nadir scenes after filtering, 63 dropped). A desert is cloud-free where a delta is
not. **Tier 1 Dubai is therefore plausible, not just tier 2** — subject to how many survive
QC and near-nadir filtering, which is the next thing to measure.

**⚠️ OUR KOLKATA HEIGHT SOURCE DOES NOT COVER DUBAI.** Google Open Buildings (v3 and 2.5D
Temporal) covers **only Africa, South Asia, SE Asia, LatAm and the Caribbean**. The Gulf is
outside it. This is the Track B blocker and it is now answered:

- **Footprints:** Microsoft GlobalMLBuildingFootprints — `CDLA-Permissive-2.0`, attribution
  only, no share-alike, explicitly commercial. (Its *heights* are useless to us: 174 M
  buildings have them, but point-tests confirm none in Kolkata/Delhi/Mumbai/Nairobi/Lagos/
  Jakarta/São Paulo — Europe and the US only.)
- **Heights, universal backstop: GHS-BUILT-H R2023A** — `CC-BY-4.0`, commercial explicitly
  allowed, **the only height product with zero global coverage gaps**. 100 m ANBH is a
  grid-cell average rather than per-building, which is too coarse to *render* but is
  **exactly matched to a 2-D solver consuming one scalar height per cell** — i.e. ours.
  EE: `JRC/GHSL/P2023A/GHS_BUILT_H`, band `built_height`.
- **Per-building alternative: 3D-GloBFP** — `CC-BY-4.0`, 2020, built on Microsoft footprints
  with **no OSM**, so the licence chain is clean and it joins to the same geometry. RMSE
  1.9–14.6 m. ~~Has "tiled spatial gaps"; spot-check the Gulf and India before relying on it.~~
  **✅ GULF SPOT-CHECKED 2026-08-11 — see §8i. Dubai IS covered.**
- **WSF3D (DLR)** 90 m, `CC-BY-4.0` — independent cross-check. **✅ verified §8i.**

**⚠️ TRAP — GlobalBuildingAtlas is CC-BY-NC-4.0** on every height component. Technically the
best global product (2.68 B per-building heights, 97 % complete, 3 m maps) and **unusable in
a commercial product**. Do not let it into the pipeline.

**⚠️ ODbL EXPOSURE ON WHAT WE ALREADY SHIP.** Overture buildings are `ODbL-1.0` for the whole
theme. ODbL §4.5: a rendered image or 3-D scene is a **Produced Work** (attribute, stay
closed), but *shipping the geometry itself to the browser as extractable data* — GeoJSON, a
vector-tile layer, glTF buffers that are effectively the polygons — is public use of a
**Derivative Database**, which obliges offering that database under ODbL. **A WebGL twin
streaming building geometry to the client sits close to that line.** Conflating ODbL heights
onto permissive footprints contaminates the combined database too. Recommendation: keep the
supply chain **ODbL-free end to end** (MS footprints + GHS-BUILT-H / 3D-GloBFP), and use
Overture/OSM only for things we do not ship — QA, or a third-party-served basemap raster.
**This needs a decision for Kolkata as well, not just Dubai.**

**Also:** Overture's own attribution page misstates Microsoft's licence as ODbL; Microsoft's
`LICENSE` file says CDLA-Permissive-2.0. Take MS data direct from Microsoft, never via
Overture, or inherit share-alike on data that is actually permissive.

**Not yet answered (agents stopped for budget):** LCZ vs Köppen as the basis for sharing
constants; Dubai Pulse's actual footprint/height coverage and licence; global forcing
products finer than NASA POWER's 50 km. *(The °C→MW coefficient is now answered — §8b.)*

## 8b · THE °C→MW QUESTION IS ANSWERED — and the honest answer is a shading argument

Track C flagged the cooling-load coefficient as needing a real source or being dropped.
It has one, and the literature it comes from also kills three numbers we might have reached
for.

**The citation to build the intervention beat on: Meili et al. (2025), *JAMES* 17(3),
e2024MS004590, `10.1029/2024MS004590` — open access, full text read.** It is the only study
found that (a) names Dubai explicitly, (b) reports **peak** rather than annual, and (c) is
honest about the irrigation cost. Coupled Urban Tethys-Chloris + building-energy model.

- **Dubai, 40 % canopy, tree height 0.95 × canyon height, open low-rise: −11 % AC energy,
  −20 Wh/m²/day** (per floor area, summer daily mean).
- **At peak hours the benefit is ~2× the off-peak benefit** — peak defined as hourly cooling
  energy above the 90th percentile of the tree-free case. **The mechanism is SHADING**,
  coinciding with maximum solar load, *not* air-temperature reduction.
- **Tree height rivals tree cover**: at fixed 40 % cover, raising height 0.5 → 0.95 × canyon
  height roughly doubled the saving.
- Diminishing returns above 40 % canopy — the response is non-linear.

**⚠️ THIS REFRAMES OUR OWN PHYSICS PITCH.** Only **14–21 %** of the tree effect comes through
outdoor air temperature even in the hot-dry cities; the rest is conduction and solar
transmission through the envelope. Our solver models the ΔT channel — i.e. **the smaller
share of the benefit.** Claiming the full cooling saving from a ΔT map would overstate what
the engine computes. State the mechanism split, and it becomes a roadmap item rather than a
hole.

**⚠️ DUBAI IS NOT A HOT-DRY CITY FOR THIS PURPOSE.** Meili groups Dubai with the **hot-humid**
set and Riyadh/Phoenix with hot-dry. Coastal humidity roughly **thirds** the tree benefit
(**−6 % Dubai vs −17 % Riyadh/Phoenix** as a summer average), and the dehumidification penalty
claws back a further **30–35 %**. Quoting a Riyadh or Phoenix figure at DEWA as if it applied
to Dubai is a material error. This also complicates the Köppen plan in §5: Dubai is `BWh`,
but for vegetation-energy purposes it behaves coastal.

**Cool roofs, Dubai: Mohammed, Khan, Khan & Santamouris (2024), *Solar Energy* 272, 112447.**
Albedo 0.2 → 0.8: **13.1 kWh/m² uninsulated low-rise residential, 6 kWh/m² insulated** —
benefit roughly **halves** on a code-compliant envelope. Cooling *load*, not delivered
electricity; divide by COP. Period not stated in the abstract — **confirm before quoting.**

**The credibility anchor, and we should say it before an engineer does: Andrić, Kamal &
Al-Ghamdi (2020), *Energy Reports* 6, 2476–2489 (open access).** In Qatar, green walls +
green roofs give **3 %** energy reduction; **5 cm of EPS insulation plus efficient windows
gives 30 %.** Envelope beats building-mounted greenery **10:1** in a Gulf climate. Greenery's
Gulf case is outdoor comfort, health and air quality — not building energy. Presenting it
otherwise will not survive a utility engineer.

**⚠️ COOL PAVEMENTS REVERSE SIGN.** Yaghoobian & Kleissl (2012), *Urban Climate* 2, 25–42
(open access), Phoenix: raising pavement reflectivity 0.1 → 0.5 **increased** annual cooling
load by up to **11 % (33.1 kWh/m²)** — reflected shortwave enters windows and façades. Cool
roofs and cool pavements are **not** interchangeable. If the intervention UI offers a
pavement-albedo slider, it must be allowed to go the wrong way.

**⚠️ HOW MUCH OF THIS LITERATURE IS MODEL ARTEFACT.** Krayenhoff et al. (2021), *ERL* 16(5),
053007 (open access, direct fetch), 146 studies: albedo cooling ≈ **0.2–0.6 °C per +0.10
neighbourhood albedo**; street trees ≈ **0.3 °C per +0.10 canopy**. But median roof-albedo
effectiveness was **5.8 °C in mesoscale models vs 1.6 °C in ENVI-met microscale** — a **3.6×
spread driven by model physics, not by the intervention** — and they conclude that validating
a base case is **not sufficient** to trust a mitigation result. Citing this is how we show we
know where our own numbers sit.

**DO NOT USE (traced to no primary source):** "25 % more canopy → 25 % cooling saving,
Phoenix"; "two trees → 8–18 % lower bills"; the Doha green-roof percentages; Masdar's
"reflective paint −20 %" (trade press only). **All DEWA/DSCE figures remain unverified** —
their site 403s every fetch. Get them from DEWA directly; they are the host's own numbers and
must not be secondhand. Note also: **no DEWA, Dubai Municipality, DSCE or Abu Dhabi DoE study
quantifying cool-roof or greening energy savings was found at all.** That absence is itself a
finding worth stating on the stand.

**Estidama, verified from the primary PDF** (Pearl Villa Rating System v1.0, April 2010,
p. 82–84): credit **RE-2 Cool Building Strategies** awards **1 point for roofing with
SRI ≥ 78** over the entire roof (SRI ≥ 29 where no surface tilts <60° from horizontal), SRI
per ASTM E1980-01. **The rating system attaches no energy estimate to the credit** — it is
purely prescriptive. A tool that puts a number on it is doing something the regulation does
not.

## 8c · WHERE OUR 2.3 K ACTUALLY SITS — the accuracy answer for the stand

Researched so the "how accurate is this?" reply in §1 is defensible rather than merely honest.

**The honest ceiling for pixel-scale, station-independent, *daily* Ta from LST is ~2–3 K.**
Anything below ~1.3 K in the literature involves monthly aggregation, dense station
predictors, or non-blocked cross-validation. Two primary-verified anchors:

- **Good (2015), *JGR Atmos.* 120(6), 2306–2324** (open Met Office PDF, full text read) —
  continental SEVIRI, station-independent evaluation: **RMS 2.3–2.5 °C Tmax, 2.5–2.7 °C
  Tmin**; ~50 % within 3 °C, 80 % within 4 °C.
- **Zhang et al. (2022), *ESSD* 14, 5637–5649** — global 1 km daily: **Tmax RMSE 1.80–2.44 °C,
  Tmin 1.69–2.34 °C** by continent. Best on **impervious surface**, worst on bare land.

**So "2.3 K peak" is not an apology — it is at the level of published continental products,
achieved at ward scale by two people.** That is the line to give a DEWA engineer.

**⚠️ THE ARID PENALTY IS REAL AND MEASURED.** Mildrexler, Zhao & Running (2011), *JGR
Biogeosciences* 116, G03025 (open NASA PDF, full text read): barren, shrubland, grassland,
savanna and cropland run **LSTmax 10–20 °C above air Tmax** at high temperatures, peaking near
**25 °C** at some low-latitude sites; **only forest is near 1:1.** Dubai's surroundings are the
barren end of that distribution. Corroborated by the diurnal asymmetry in the two closest
regional studies — **UAE (Alqasemi et al. 2021, `10.1080/10106049.2020.1837261`): RMSE
1.75 °C day vs 0.97 °C night; Oman (Hereher 2019): 1.98 °C day vs 0.97 °C night** — both
**monthly**, so do not quote either as a daily figure. Night is roughly **2× tighter** than day
in a desert, which is exactly the wrong way round for a heat-risk product.

**TVX is the wrong method family for Dubai** — its accuracy rests entirely on dense-canopy
pixels inside the search window, which a Gulf city does not provide. Reported **2.08–5.4 °C**
across six studies (Cristóbal, Ninyerola & Pons 2008, *JGR* 113, D13106, §5.2 — primary).

**Urban-specific benchmark, and a caution:** Ho et al. (2014), *RSE* 154, 38–45 — Vancouver,
random forest, **RMSE 2.31 °C**. Venter et al. (2020), *RSE* 242, 111791 — Oslo hyperlocal with
1,310 crowdsourced stations: daily-max RMSE 1.85 °C but **R² = 0.05**, i.e. the model explains
essentially none of the intra-urban variance while posting a respectable RMSE. **That is our
own within-ward failure mode, published by someone else with far more ground truth** — worth
knowing before anyone waves a low RMSE at us.

**⭐ POSITIONING ASSET: no published daily or instantaneous urban Ta-from-LST validation exists
for Dubai, Riyadh, Kuwait City or Doha.** The nearest work (UAE, Oman) is monthly and
non-urban. We would be filling a genuine gap, not entering a crowded field.

## 8d · THE DEMO SLATE — CEO decision 2026-08-11

Not all ~226 Dubai communities. Not one city-wide map either. **A curated slate of three
categories, because each is a different argument to a different person at the stand:**

| category | candidates (hypothesis, not finding) | the argument |
|---|---|---|
| **Financial** | DIFC, Business Bay, Downtown, Marina/JLT | cooling load, grid peak, DEWA's P&L. Already on district cooling, so ΔT→MW is checkable against their own load data |
| **New / in progress** | Dubai South & Expo City, Creek Harbour, MBR City, Dubai Hills | the only places the intervention is still free — design-stage, not retrofit |
| **At-risk (heat)** | Al Quoz, Jebel Ali Industrial, Deira/Naif, Al Qusais–Muhaisnah | equity and health; industrial and dense-old-fabric, low albedo, near-zero canopy, outdoor workforce |

**⭐ THE UPGRADE THAT MAKES THIS DEFENSIBLE: do not hand-pick the at-risk list — derive it.**
Run the city-wide grid first, rank every community by measured SUHII from the ECOSTRESS
stack, and show the top N. The stand line becomes *"we didn't choose these, we ran all of
Dubai and the data chose them."* That converts a curation decision (which any consultancy can
assert) into a **result** (which requires the instrument). Costs nothing — the city-wide run
is happening anyway. The ranked list may well disagree with the table above, **which is the
point.**

**Sizing:** 1 city-wide grid + ~9 drill-downs ≈ **10-12 MB shipped**, vs **~226 MB** for full
per-community coverage (measured: a Kolkata ward ships ~1.0 MB; `public/heat-map/data/` is
9.5 MB for three wards). Full coverage is also 226 separate EE and ECOSTRESS runs.

**⚠️ DO NOT CLAIM CLIMATE RISK WE CANNOT MODEL.** For several of these communities the
headline risk is **coastal inundation** — Palm Jumeirah, Marina, Jumeirah 1-3. **We have no
flood model.** Keep every claim to heat, or the first informed question at the stand lands
somewhere the engine cannot follow.

## 8e · DUBAI DATA — VERIFIED BY DIRECT PROBE, 2026-08-11

Measured, not assumed. Several intuitions about "it's Dubai, the data must be there" did not
survive contact.

| source | verdict |
|---|---|
| **Dubai Pulse** | 🔴 **`ECONNREFUSED` from here** — same wall the earlier agent hit; looks geo-blocked. Datasets are listed (`dm_building_summary_information`) but **contents and licence cannot be verified remotely.** |
| **ArcGIS "Dubai Communities"** | ⚠️ Exists — **2017 upload, personal account (`ralouta_smartdubai`), licence field literally `none`.** Every other Dubai community layer found is an Esri **DEMO** or personal account, "not specified". **No authoritative DM feature service surfaced.** **⚠️ CORRECTED by §8h — DM *does* catalogue `Community` and `Sectors` as open data; they are unreachable, not absent.** |
| **geoBoundaries** | ❌ UAE stops at **ADM1** (emirates). No community level, and ODbL anyway (sourced from OSM). |
| **OSM / Overpass** | ✅ **132 `admin_level=10` relations** in the Dubai bbox with correct community names (Al Rigga, Al Ras, Port Saeed, Corniche Deira). The only complete set retrievable. ODbL. |
| **OpenAQ** | ⚠️ v2 retired; **v3 needs a free API key**. Viable, needs registration. |
| **WAQI / aqicn** | ❌ Non-commercial licence — already ruled out for Kolkata. |

**RECOMMENDATION: drop Dubai Pulse from the critical path.** It may be excellent, but we
cannot reach or test it, and 70 days is not the moment to depend on that. GHS-BUILT-H +
Microsoft footprints are verified and sufficient. Treat a later in-region Dubai Pulse pull as
an **upgrade, not a dependency.** This retires the §9 "first move" as written.

**✅ THE POLLUTION AXIS IS SOLVED, AND FOR FREE.** Dubai's pollution story is largely **dust**,
which is well observed from orbit — and both products are reachable with the **Earth Engine
credentials we already hold**, no new account:
- **`MODIS/061/MCD19A2_GRANULES`** — MAIAC aerosol optical depth, **1 km, daily.** At 208 m
  city cells this is a genuine community-level signal, and it captures dust.
- **`COPERNICUS/S5P/OFFL/L3_NO2` / `L3_AER_AI`** — TROPOMI, ~5.5 km, for the traffic/industry
  axis.
Label tier 3 — we would have zero validation for either.

**Boundaries — the ODbL angle that works here.** Using OSM boundaries to *decide which areas
to model* is internal use, not public use of a Derivative Database. If the shipped artefact
carries a **name and a centroid** rather than the polygon, that is very likely a Produced
Work. **Use OSM to pick and label communities; do not ship the boundary geometry.** This
sidesteps the trap for this axis only — it does not resolve the building-geometry question
in §8a.

## 8f · "BUILDERS OPEN-SOURCE THEIR 3D MODELS" — investigated, and the real answer is better

Co-founder's claim, 2026-08-11: all major Dubai districts have builders that open-source
their buildings' 3-D models. **As stated this is false — but it points at something real.**

**Builders do not release geometry.** Emaar and DAMAC have BIM built by consultants (BIMES
did as-built models for Emaar Malls and DAMAC); Nakheel did photogrammetric 3-D of Palm
Jumeirah with Zero Technologies. **All proprietary.** What developers publish is 3-D *sales
tools and marketing renders*, which is where the impression comes from — those are not data.
**⚠️ CGTrader / Sketchfab / TurboSquid "Emaar models" are third-party hobbyist uploads** —
mixed licences, no provenance, trademarked landmarks. Worse exposure than Overture and not
survey-grade. Do not touch.

**⭐ THE KERNEL, AND IT IS BIG: Dubai Municipality has already built the thing.** Their
**Digital Twin Platform** on the **"Dubai Here"** portal carries **195,000 buildings modelled
in 3-D**, 280,000 infrastructure assets, 330,000 public facilities, 1,500+ geospatial layers —
and is explicitly available to *"government entities, partners, **private companies**, and
students"*, **no fee stated**, via GeoDubai / the GIS Centre.

So the claim is right that comprehensive Dubai 3-D building data exists and a private company
can reach it. The correction is **who**: it is **the municipality, not the builders**, and it
is **a request through a relationship, not a download.** With a warm DEWA contact and a stand
at their own event, that ask is plausible — and the ask itself is a decent opener.

**Measured fallback:** OSM buildings across the Downtown/Marina strip (20,000 sampled, query
cap — a sample not a census): **`height` 3.3 %, `building:levels` 6.5 %, either 7.2 %,
`building:part` 13 buildings.** **OSM 3-D is not a geometry source for Dubai.** Confirms
GHS-BUILT-H was the right call.

**⚠️ AND THE REASON NOT TO CHASE IT: our thermal physics is 2-D.** A per-building BIM model
would make the scene look far better and would not change a single number the solver
produces. **Worth asking Dubai Municipality for; not worth blocking 70 days on.** It is a
rendering upgrade, and Track D is the cuttable track. (3-D geometry *does* now enter the
physics via wind — see the wind spec — but through massing, which GHS-BUILT-H already gives
us.)

## 8g · COMPETITIVE / UX TEARDOWN — Spatialbound, from two screen captures

Source: `docs/research/screen-capture (1).webm` (32 s, marketing site) and
`docs/research/digital_twin_spatialbound.webm` (24 s, the 4D Spatial Engine — **including a
live Dubai session**). Read by frame extraction. **Their site blocks ClaudeBot with
`Disallow: /` and `ai-train=no`; it was not crawled.** These are the CEO's own recordings.

**They are not a competitor.** Design/CAD/simulation for architecture and autonomy — the car
sim exposes `Sensor View: Camera (RGB)`, `Ego Bounding Box`, `Drivable Area`, i.e. synthetic
AV training data. Environmental analysis is **one of four pillars** (AI native CAD engine ·
4D spatial engine · Spatial and environmental analytics · Fred the agentic AI), not the
product. Backed by SFC Capital, plus Google/Microsoft for Startups and AWS Activate.

### ⭐ Finding 1 — their Dubai is MASSING, not photoreal. Our approach is vindicated.

`Hi fred, go to Dubai` → Palm Jumeirah and the Marina render as **grey/tan extruded massing
on a satellite base.** No Google photorealistic façades anywhere in the Dubai or Zurich
views. Their own header: **"4D Vector Representation of the World"** — *"visualise real
terrain, buildings, and street data."* Photoreal is the *other* mode; **the simulation engine
runs on vector massing.**

That is exactly GHS-BUILT-H + Microsoft footprints + our existing procedural facade shader —
**licence-clean, and it looks like this.** The CEO's "doesn't need to be photoreal" call is
confirmed by the competitor's own product.

### Finding 2 — their sidebar is a free feature roadmap

`Search · Scene · **Air Flow** · Play Mode · **Time** · Weather · Buildings · Trees ·
Emergency Sim · Analytics · Mobility · Navigation`

We hold Buildings, Trees, Weather, Water, Roads and a time dimension. **Missing: Air Flow,
Analytics-as-a-panel, Mobility, Emergency Sim.** Note **Air Flow and Time are adjacent** —
sun and wind as sibling top-level modes, not buried settings. Adopt that hierarchy.

### ⭐ Finding 3 — the Time panel is the most borrowable thing in either video

> *"accurate sun position and lighting. **Study shadows, daylighting**, and visual impact at
> any hour."*

- presets `Dynamic / Morning / Noon / Evening`
- continuous slider (`09:30`, `15:15`)
- **speed multipliers `x1 · x10 · x100 · x1000 · x10000`**
- absolute date field + **"Reset to current date and time"**

**We have a time dimension in the solver and no control surface for it at all.** This is the
exact UX a `pybdshadow` + `pvlib` build needs, and it is now the **third independent signal
pointing at solar-and-shadow before wind** (the others: cost analysis, and their own
"Sun and shadow, flow, exposure and performance" ordering).

Also seen: **Real-time Data Modalities** — `Realistic / Edge / Depth / Normal / Semantics /
Heatmap` rendered in parallel. Mostly AV ground truth, but the parallel-modality idea suits a
compare view.

### Finding 4 — 24 seconds of Dubai contains no numbers

No temperature, no wind speed, no units, **no error bar**. `Analytics` is a sidebar icon that
never gets clicked. Not a criticism — numbers aren't their sale. But **on the same city, at
the same event, we would be the only stand with quantities on screen.** §1 holds.

### ⚠️ Finding 5 — the sobering one

They type *"go to Dubai"* and they are there. **We have three hardcoded wards and 56 files
naming one literally.** Track A is not housekeeping — it is the difference between a product
and a demo, and this is the argument for doing it first.

### Carry-overs, logged

1. **Massing-not-photoreal is confirmed viable** — no licence exposure, matches our shader.
2. **Build the Time panel** to the spec above.
3. **Air Flow and Time as sibling top-level modes.**
4. **Apply to AWS Activate / Microsoft for Startups / Google for Startups** — credits
   programmes, not equity. Directly addresses the precompute-budget question.

## 8h · DUBAI MUNICIPALITY, READ DIRECTLY — corrections to §8e and §8f

Source: `dm.gov.ae` open-data catalogue, GIS Services page and the geospatial article, fetched
and text-extracted 2026-08-11. The article page returns HTTP 200; `geodubai.dm.gov.ae` and
`dubaihere.dm.gov.ae` both return **000 (no connection)**, same as Dubai Pulse.

**⚠️ The "digital twin" page is a PRESS RELEASE dated 12 January 2024**, filed under "Making
Dubai More Pioneering" — not a data product page. The 195,000-buildings figure circulating in
§8f traces to journalism about this article.

**⚠️ CORRECTION TO §8f — the access tiers are narrower than reported.** §8f said the platform
is open to *"private companies"* with no fee. That is the news copy. **The actual GIS Services
catalogue reads:**

| service | eligibility, verbatim |
|---|---|
| Apply for Geospatial Maps and Data | *"governmental departments, authorities, institutions, building consultants, contractors, and citizens … according to the powers vested in each entity"* |
| Request Online Access to Geographical Databases | *"governmental departments and authorities"* **only** |
| Request Access to Amakin Browser | *"governmental institutions, authorities and departments connected to the Government Information Network (GIN)"* **only** |

**"Private companies" is not a listed category**, and a foreign climate-tech firm fits none of
these cleanly. **This is a relationship ask via DEWA or an in-region partner, not a web form.**

**⭐ CORRECTION TO §8e — authoritative boundaries DO exist.** The DM open-data catalogue lists,
under *Geographic & Location Services* (audience: *"App Developers, GIS Analysts"*):
**`Community` · `List of Community Entrances` · `Sectors`**. §8e concluded no authoritative set
existed; it exists and is catalogued as open. **We cannot reach the host — a different problem
with a different fix.** Also listed: **`Makani Open Data`** (the geo-tagging system).

**⭐ AND THE BUILDING DATASETS FEED THE PHYSICS, not just the render.** Under *Construction &
Development*:
- **`Building Floor Level Information`** — *"Detailed information on each floor"*. **Floor
  counts are a PER-BUILDING height proxy**, unlike GHS-BUILT-H's 100 m cell average.
- **`Building Usages`** + `Building Usages Lookup` — **this feeds `Q·built` directly.**
  Anthropogenic heat depends on what a building does; that term is currently uniform.
- `Building Summary Information`, `Building Permits`, `Building Demolition Permits`.

**⚠️ THIS REVISES §8f's CONCLUSION.** §8f said municipal data would improve the render but not
a single solver number — true of **BIM geometry**, **false of this catalogue.** If the DEWA
conversation goes well, **ask for `Building Usages` and `Building Floor Level Information`**,
not the 3-D models. Everything still routes through Dubai Pulse, so the critical path is
unchanged: **GHS-BUILT-H + Microsoft footprints, with this as an upgrade if the relationship
opens it.**

## 8i · DUBAI HEIGHTS — SOLVED, and better than a single source (verified 2026-08-11)

Probed directly: Figshare API for licence and file manifests, DLR's download directory for
WSF3D, Overpass `out count` for OSM.

### The measured baseline — footprints are solved, heights are not

| | Dubai urban core (24.85–25.45 N, 54.85–55.65 E) |
|---|---|
| OSM buildings | **361,446** |
| …with `height` | 4,321 — **1.2 %** |
| …with `building:levels` | 28,690 — **7.9 %** |
| Microsoft footprints | **25 UAE tiles, ~97 MB GeoJSONL, uploaded 2026-02-23** |

**Footprints are solved three times over (OSM, Microsoft, Overture-as-union). Heights are
solved zero times by the mappers.** Note also that **AWS and Microsoft are not mappers** —
the Registry of Open Data and Planetary Computer *host* other people's data.

### ✅ 3D-GloBFP COVERS DUBAI — tested, not assumed

Scanned **2,554 tiles across all 10 Figshare parts**. Dubai (55.30 E, 25.20 N) falls in:

```
PART V   1638_55.0_25.0_60.0_30.0_AE_IR_MU.zip   67.4 MB
         https://ndownloader.figshare.com/files/54052133
```

Four UAE tiles exist; the urban core is mostly **1638**, the southern extension (Dubai South,
Expo City) in **1640** — **~100 MB total**. Shapefiles, per-building height in metres.
**Licence confirmed `CC BY 4.0` via the Figshare API.** Published 2025-12-11, 1.66 B buildings.

**⚠️ Two caveats that matter under Track F.**
- **RMSE 1.9–14.6 m.** Shadow length is `h/tan(altitude)`, so at a 30° sun a **14.6 m height
  error becomes a ~25 m shadow error** — sub-cell at 208 m city scale, **three cells at 7.4 m
  ward scale.** Fine for city-wide Dubai; marginal for drill-downs.
- **2020 vintage.** Dubai builds fast; six years of construction is missing.

### ✅ WSF3D — a single global raster, simpler than expected

`download.geoservice.dlr.de/WSF3D/files/global/` serves **four global GeoTIFFs**, not tiles:
`WSF3D_V02_BuildingHeight.tif` (**2.14 GB**, modified 2024-11-04), plus `BuildingArea`,
`BuildingFraction`, `BuildingVolume`. **CC BY 4.0**, 90 m, from **TanDEM-X interferometry** +
Sentinel-1/2. Global single file → Dubai coverage automatic.

### ⭐ THE REAL WIN IS THREE INDEPENDENT ESTIMATES, NOT ONE SOURCE

| product | type | lineage |
|---|---|---|
| **3D-GloBFP** | **per-building** | multi-source EO + XGBoost |
| **WSF3D** | 90 m grid | **TanDEM-X radar interferometry** |
| **GHS-BUILT-H** | 100 m grid | GHSL |

Three genuinely independent instruments, plus **ICESat-2's 3 cloud-free transects** for sparse
absolute truth. **That is how a height uncertainty gets published for a city with no ground
survey** — and Track F needs precisely that, because shadow makes heights load-bearing and
ours are currently flagged `"underpowered: 6 matched pairs < 8"`.

**DECISION: 3D-GloBFP is the primary Dubai height source. WSF3D and GHS-BUILT-H are the
cross-check.** Reporting the spread between three products turns "we used a dataset" into a
measurement — the same move as the rest of the engine.

### ⚠️ ICESat-2 is a VALIDATOR, not a height source
Cloud-free desert makes the returns cleaner; **it does not add tracks.** It is a profiling
lidar flying 3 fixed repeat ground tracks — a hard geometric ceiling, not a weather one. No
DSM can be built from three lines. **Its job in Dubai is to validate the three products
above along transects.** (Landsat, by contrast, *is* a genuine Dubai win — 8-day effective
revisit and near-cloudless skies, against the monsoon losses that left Kolkata's day CI at
±1.87 K on n=12.)

## 8j · ECOSTRESS YIELD, MEASURED — Dubai loses NOTHING to cloud (2026-08-12)

First real Dubai ingest, enabled by Track A. Tool: `scripts/ecostress-yield.py`,
sampling every 13th acquisition across the whole archive (Jan 2024 – Aug 2026) so the
sample spans seasons rather than the newest end. Both cities measured with the SAME
0.15° x 0.15° box, because yield depends on box size and an unmatched comparison is
meaningless.

| | acquisitions | sampled | cleared 50 % coverage | cloud mean | usable | **lost to CLOUD** |
|---|---|---|---|---|---|---|
| **Dubai** day | 153 | 12 | 8 | **0.0 %** | 94 % | **0** |
| **Dubai** night | 149 | 12 | 6 | 0.1 % | 95 % | **0** |
| Kolkata day | 67 | 6 | 0 | — | — | **2** |
| Kolkata night | 127 | 10 | 1 | 0.1 % | 96 % | **3** |

**⭐ THE RESULT: Dubai lost ZERO of 24 sampled acquisitions to cloud. Kolkata lost 5 of
16.** Months represented in Dubai's covered sample: 01, 02, 04, 05, 06, 07, 08, 10, 11 —
so this is not a summer artefact. Projected usable in the archive at this box size:
**~96 day + ~71 night.**

**⚠️ AND THE HONEST CAVEAT, which matters more than the headline.** The dominant loss in
BOTH cities is neither cloud nor tile geometry: it is **"no retrieval — cloud band
present and reporting clear, LST entirely NaN"** (Dubai 10 of 24, Kolkata 10 of 16).
**The cause is NOT established.** Most likely swath geometry, but that is a hypothesis,
not a measurement, and it is the real limiter on Dubai's yield. Do not present the
cloud number without it.

**Two measurement traps caught while doing this, both of which would have produced a
false headline:**
1. **Newest-first sampling.** `cmr_search` sorts by date descending, so the first 14
   Dubai acquisitions are all May–Aug. They report 0 % cloud, which is true and
   worthless — Gulf cloud is a winter phenomenon. `--stride` samples across the archive.
2. **`cloud & raw` hides cloud losses entirely.** When a retrieval fails under cloud the
   LST is all-NaN, so `raw` is empty and `cloud & raw` is empty too — every cloud-killed
   scene reports **0 % cloudy**, indistinguishable from clear sky. This mislabelled every
   one of Kolkata's cloud losses as "no retrieval" until a direct probe of the bands
   contradicted the tool. The cloud band is now carried unmasked.

**Independent confirmation of Track A:** the Dubai granules are MGRS tiles **`40RCN` /
`40RCP`** — UTM zone 40, exactly what `target_crs` derives. The CRS fix is right end to
end, against NASA's own tiling.

## 8k · THE DUBAI GEOMETRY IS DOWNLOADED — and 3D-GloBFP SATURATES ON TOWERS (2026-08-12)

Downloaded to `~/.cache/delta-climate/dubai/` (never the repo, same rule as ECOSTRESS
granules):

| source | what | size |
|---|---|---|
| Microsoft GlobalMLBuildingFootprints | 4 quadkey tiles covering the city-wide bbox | 55 MB |
| 3D-GloBFP tiles 1637/1638/1639/1640 | **1,402,446 buildings with per-building height** | 125 MB |

Verified from the shapefile headers directly (no geopandas — it has no type stubs and would
break the mypy gate): WGS84, polygon, fields `FID` + `Height`, zero null heights, median
12.7–13.2 m across all four tiles.

**⚠️ AND THE FINDING THAT CHANGES A PLAN ASSUMPTION — the heights saturate.** Measured by
walking the .shp record bboxes and joining to the .dbf:

| district | buildings | median h | **max h** | tallest real building | error |
|---|---|---|---|---|---|
| Downtown | 673 | 20.9 m | **144.0 m** | Burj Khalifa **828 m** | **5.8× under** |
| Dubai Marina | 1,637 | 19.5 m | **129.5 m** | Princess Tower **414 m** | 3.2× under |
| Business Bay | 548 | 23.6 m | **124.1 m** | several 300 m+ | ~2.5× under |
| Deira / Naif | 412 | 22.1 m | 85.8 m | genuinely low-rise ~40 m | **over**-estimates |

**The distribution is compressed toward the middle — towers under-predicted, low-rise
over-predicted.** That is textbook regression-to-the-mean from the XGBoost model behind
3D-GloBFP, and the published RMSE 1.9–14.6 m is an average over ordinary buildings that does
not describe a supertall district at all.

**CONSEQUENCES, and they are specific:**
- **City-wide at 208 m cells: acceptable.** A tower's error is diluted across a cell that
  averages many buildings.
- **Tower-district drill-downs with shadow: NOT honest with this data.** Shadow length is
  `h/tan(altitude)`, so DIFC and Marina shadows would be **3–6× too short**. The Track F
  prediction that "Dubai's towers should show the shadow effect clearly" **cannot be tested
  on 3D-GloBFP heights.**
- **⚠️ OSM is not a clean patch.** OSM does carry the real values — 2,351 height-tagged
  buildings in the tower belt, topping out at Ciel Tower 377 m, Princess Tower 357 m. But
  those are ODbL, and §8a's warning applies exactly: conflating ODbL heights onto permissive
  footprints contaminates the combined database. **Do not do it.**

**⭐ THIS IS NOW A MEASURED REASON FOR THE DEWA ASK.** §8h identified `Building Floor Level
Information` as the dataset to request. This is the evidence for why: **floors × storey
height is the only permissive route to a real tower height**, and without it the tower
districts get city-wide treatment or an explicit caveat. Worth raising with a number
attached rather than as a preference.

**Still to test:** whether **WSF3D** saturates the same way. It is TanDEM-X radar
interferometry — a physical measurement rather than a learned model — so it has no reason to
regress to the mean, though its 90 m cell averages a tower with the ground around it. It is
CC-BY-4.0 and already identified in §8i as one of the three cross-checks.

## 8l · ⭐ CORRECTION TO §8k — WSF3D DOES capture the towers. Use it. (2026-08-12)

§8k concluded that tower-district shadow "cannot be done honestly" on available permissive
data. **That conclusion was about 3D-GloBFP and does not survive testing WSF3D.**

Read remotely over Dubai via `/vsicurl` (no 2 GB download needed — it is a tiled GeoTIFF and
rasterio range-reads it):

| district | **WSF3D** | ratio to real | 3D-GloBFP | ratio | real tallest |
|---|---|---|---|---|---|
| Downtown | **667.2 m** | **0.81** | 144.0 m | 0.17 | Burj Khalifa 828 m |
| Dubai Marina | **369.3 m** | **0.89** | 129.5 m | 0.31 | Princess Tower 414 m |
| Business Bay | **233.1 m** | **0.78** | 124.1 m | 0.41 | 300 m+ |
| Deira / Naif | **48.0 m** | **1.20** | 85.8 m | 2.15 | low-rise ~40 m |

**WSF3D lands at 0.78–1.20× of the true tallest building in every district tested. 3D-GloBFP
is 0.17–0.41× on towers and 2.15× on low-rise — wrong in both directions.** The residual
under-estimate on towers is *expected and correct*: WSF3D is an ~87 m cell average, so a
tower's peak is averaged with its podium and surrounds. It is a physical TanDEM-X radar
measurement, which is exactly why it has no reason to regress to the mean the way an XGBoost
model does.

**⚠️ MY OWN ERROR, and it nearly discarded the best source we have.** The first read returned
6672 m for Downtown and looked like garbage. **The GeoTIFF declares `scales: (0.1,)` and
`unit: m`** — the values are decimetres and `rasterio.read()` does not apply the scale. I had
the file's own declaration available and did not read it. Any future consumer must apply the
scale; a raw read is 10× too large and physically absurd, which is at least a loud failure
rather than a quiet one.

**DECISION — the Dubai height stack changes:**
- **WSF3D (CC-BY-4.0) is the HEIGHT source.** Its ~87 m cells sit almost exactly on our 70 m
  analysis grid and well inside the 208 m city-wide cell, so it needs no downsampling
  argument.
- **3D-GloBFP (CC-BY-4.0) supplies per-building POLYGONS** for rendering and for the
  per-cell shape statistics. Its heights are not used in tower districts.
- Both are CC-BY-4.0, so the fusion stays licence-clean end to end. No ODbL anywhere.

**⭐ TRACK F's DUBAI TEST IS BACK ON.** §8k said the "towers should show the shadow effect
clearly" prediction could not be tested. With WSF3D heights it can — and the pre-registration
requirement in the Track F spec stands unchanged.

**Licence correction: GlobalBuildingAtlas is not what §8a says.** §8a records it as
CC-BY-NC-4.0. The ESSD paper (essd-17-6647-2025) instead states its footprints come from OSM
and Microsoft "both provided under the Open Database License (ODbL)". Either way it is not
clean for us and **we no longer need it** — but the recorded reason was wrong. Its specs, for
the record: 3 m resolution, 2.68 B LoD1 instances, RMSE 1.5–8.9 m by continent (Asia 5.9 m).

## 8m · HEIGHT SOURCE LOCKED: WSF3D. Four candidates tested. (2026-08-12)

`scripts/fetch-wsf3d.py`. Measured against known building heights, not read off
datasheets:

| candidate | Downtown (Burj 828 m) | Deira (~40 m) | verdict |
|---|---|---|---|
| **WSF3D** (TanDEM-X radar) | **667 m — 0.81×** | **48 m — 1.20×** | ✅ **LOCKED** |
| 3D-GloBFP (XGBoost) | 144 m — 0.17× | 86 m — 2.15× | polygons only |
| Copernicus GLO-30 DSM | **34 m — buildings absent** | 22 m | ❌ terrain, not surface |
| GlobalBuildingAtlas | best specs of all (3 m, RMSE 5.9 m Asia) | — | ❌ ODbL-derived |

**Copernicus GLO-30 is the instructive negative.** It is the obvious thing to reach for —
30 m, free, TanDEM-X, and *described* as a DSM. Over Downtown it maxes at **34 m**, and open
desert 40 km inland reads **97–124 m**, which are real dunes. It contains terrain and not
towers. **Useful to us as the ground reference the engine needs anyway; useless for
buildings.** Do not re-test it.

**City-wide run:** 1029×900 cells at ~87 m, **137,658 built cells (14.9 %)**, median height
3.5 m, p95 17.5 m, max 667.2 m.

**⚠️ THE SCALE FACTOR IS PINNED IN A SELF-CHECK, because it nearly cost us the dataset.**
The GeoTIFF declares `scales: (0.1,)` with `unit: m` — stored values are **decimetres**, and
`rasterio.read()` does not apply band scales. A raw read gives 6672 m over Downtown, which
looks like a broken product. `fetch-wsf3d.py` applies the scale, refuses anything above
1000 m with an explicit message naming the cause, and asserts measured expectations for both
Deira and Downtown so a regression fails loudly rather than shipping 10× heights.

**Attribution obligation:** `World Settlement Footprint 3D (WSF3D) © DLR, CC BY 4.0`, carried
in the artefact's provenance JSON. This must appear on any published figure.

## 8n · PAID AND FREE-BY-PROPOSAL ROUTES — priced, and mostly ruled out (2026-08-12)

CEO asked what could be bought, then ruled the price out. Recorded so neither question gets
re-researched.

### Commercial, priced

**Airbus WorldDEM Neo 5 m** — the paid version of the same TerraSAR-X/TanDEM-X data WSF3D
gives us free at 87 m. `DSM $8.75/km² · DSM+DTM L1 $20/km²` (Apollo Mapping list, min order
50 km²). Vertical accuracy < 4 m, horizontal < 6 m. **DSM − DTM is building height as a
measurement, not a model** — exactly what 3D-GloBFP failed at.

| scope | area | DSM | DSM+DTM |
|---|---|---|---|
| the 12-district demo slate | 236 km² | $2,063 | **$4,716** |
| built-up Dubai only | 1,042 km² | $9,117 | $20,839 |
| full urban-core bbox | 4,680 km² | $40,947 | $93,594 |

**Over budget as of 2026-08-12.** Revisit if funding lands; buy the slate, never the bbox.

**Maxar Precision3D Buildings** — per-building vectors with *both* roof and structure heights,
50 cm posting, 3 m absolute, no ground control. Now paired with Ecopia as "Vivid Features"
(Sept 2025, 1 B+ footprints). Quote-only, certainly above WorldDEM. Not pursued.

**⚠️ SatVu HotSat-1 (3.5 m thermal) CANNOT BE BOUGHT AT ANY PRICE.** It failed in orbit
**December 2023**, six months after launch — a power circuit in the camera; insured, not
recoverable. HotSat-2/3 are contracted with SSTL on SpaceX launches. **There is currently no
high-resolution commercial thermal imagery on the market.** This is the one dataset that
would genuinely transform our product (20× finer than ECOSTRESS's 70 m) and it does not
exist to purchase. Do not plan around it.

### Free-by-proposal, ranked by whether we actually qualify

**1. ⭐ MBRSC / KhalifaSat — the one to pursue, and it costs nothing.** 70 cm optical,
UAE-operated, and **provided free to "local government entities and universities"**. We are
neither — **but DEWA is**, and DEWA is already the warm contact. The natural ask is "can you
pull KhalifaSat imagery over the districts we are modelling?". No licence gymnastics if the
data sits with DEWA. Not a height source, but excellent for the render and for checking
footprints.

**2. DLR TanDEM-X Science Service System — 12 m DEM free, up to 100,000 km² by proposal.**
Dubai's entire urban core is 4,680 km², i.e. **4.7 % of the quota**, and 12 m is **7× finer
than WSF3D**. Same mission, so it is a continuity upgrade rather than a switch.
**⚠️ NOT YET CLEARED FOR OUR USE.** Two unresolved items: a **User License Agreement is a
separate PDF that has NOT been read**, and the site notes a **service fee on submitted
proposals**. Whether a commercially-motivated trade-stand demo counts as "scientific use" is
exactly the question that ULA answers. **Read it before relying on this.**

**3. ESA Network of Resources (€5,000 voucher) — almost certainly INELIGIBLE.** Verbatim:
*"Vouchers must not be used to support any commercial revenue flows"*, sponsoring *"cannot
apply when the requesting entity profits from the service"*, and it is scoped to *"users
involved in ESA projects"*. We are not an ESA project and the demo is commercially
motivated. **Do not chase this.**

### The thing to keep in view

**WSF3D is free, already fetched, validated against the Burj at 0.81×, and matches our grid.**
Every option above is an upgrade to the *render and the drill-downs*, not to the accuracy
number — which is bounded by ECOSTRESS at 70 m, not by heights. None of this should delay
building the Dubai grid.

## 9 · First move — SUPERSEDED 2026-08-11

~~Verify Dubai Pulse actually has usable footprints and heights over the urban core.~~
**Retired by §8e: Dubai Pulse refuses connections from here and cannot be tested.** The data
question it was meant to answer is already settled — GHS-BUILT-H + Microsoft footprints,
both verified and licence-clean.

**The new first move is a code fix, not a data probe:**

1. **Assert on `target_grid`.** Given a Dubai bbox under Kolkata's hardcoded
   `TARGET_CRS = "EPSG:32645"` it silently returns a wrong 1385×1337 grid instead of
   erroring. Everything downstream inherits that. Fix before anything else runs.
   *(Good news from the same audit: Dubai at 55.3°E derives to UTM 40N / EPSG:32640 while
   Kolkata derives to 45N — which **is** the hardcoded value. So the geo-oracle parity
   fixtures stay byte-identical and Track A is smaller than feared.)*
2. **Decide the ODbL question** (§8a) — it affects Kolkata today, not just Dubai.
3. **Port URock on one Kolkata ward** before touching Dubai — see the wind spec.

## 10 · Related specs

- [2026-08-11-solar-shadow-track-f-design.md](2026-08-11-solar-shadow-track-f-design.md) —
  **Track F. CEO decision 2026-08-11: "Solar first, Wind second."** No new solver — `pvlib`
  (already pinned *and installed*) + a ~60-line shapely shadow projection + `pythermalcomfort`.
  Produces three outputs from one geometry pass: the **untested `sun·(1−shade)` heat term**,
  rooftop PV yield, and UTCI/PET. Carries the Time panel. **⚠️ `pybdshadow` is the validation
  oracle, NOT a dependency** — it needs geopandas (no type stubs, breaks the mypy gate),
  suncalc-py (a second solar-position implementation), and recommends Python 3.7–3.9 against
  our 3.12.
- [2026-08-11-urban-wind-3d-physics-design.md](2026-08-11-urban-wind-3d-physics-design.md) —
  **Track E**, added 2026-08-11, **now second.** Röckle diagnostic wind, precomputed offline, coupled into
  the existing 2-D solver by replacing the scalar `wind` with a per-cell field. Carries the
  VDI 3783-9 hit-rate ≥ 66 % accuracy bar the CEO's "70 %" turned out to match. Cut order if
  time runs short: Track D landmark GLBs → attract loop → district count. **Wind on 4
  districts beats no wind on 9.**
