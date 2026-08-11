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
  1.9–14.6 m. Has "tiled spatial gaps"; **spot-check the Gulf and India before relying on it.**
- **WSF3D (DLR)** 90 m, `CC-BY-4.0` — independent cross-check.

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

## 9 · First move

**Verify Dubai Pulse actually has usable footprints and heights over the urban core.**
One day. It gates Track B, and if the data is thin the whole shape changes.
