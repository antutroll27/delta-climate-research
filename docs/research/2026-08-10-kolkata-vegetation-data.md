# Vegetation data for the Kolkata heat twin — what survives verification

*Delta Climate Research · 10 August 2026 · primary-source-verified*

Companion co-founder briefing (PDF): `docs/briefings/2026-08-10-vegetation-data-sourcing-briefing.html`

---

## Why this exists

Vegetation is the single biggest missing physical term in the twin. Trees and
green cover are the dominant local cooling mechanism in a hot city — shade plus
evapotranspiration — and right now the model sees them only faintly, through a
Sentinel-2 NDVI raster used as a thermal correlator. The co-founder's email laid
out a clean three-tier plan (a raster for correlation, canopy polygons/height
for shade, individual trees for realism) and named specific sources for each.

The plan's **structure is right**. Several of the **named sources are not** — some
no longer exist, several are non-commercial-only and we are a for-profit company,
and one needs input imagery we cannot legally obtain over an Indian city. This
document records what we verified, source by source, and what we are actually
going to use.

**Constraint that governs every choice:** Delta Climate Research is a commercial
entity. A dataset licensed for *research / non-commercial / evaluation use only*
is off-limits for a product we put in front of clients and investors, no matter
how good it is. "Free to download" ≠ "free to use commercially."

---

## The three-tier model (the co-founder's framing, kept)

| Tier | Purpose | Physical role in the twin |
|------|---------|---------------------------|
| **1 — NDVI raster** | Greenness as a continuous field | Thermal correlator; already wired into the surface model |
| **2 — Canopy height / cover** | Where the shade is, and how tall | The substantive cooling term — feeds shade + a cooling offset |
| **3 — Individual trees** | Legible 3D on the map | Illustrative; makes the green *visible*, receipted as modelled |

This is a good stratification and we keep it. The changes are all at the level of
*which dataset fills each tier*.

---

## What we are using ✅

### Tier 1 — NDVI: **Sentinel-2 L2A** (already ours)
- **Source:** Copernicus Sentinel-2 L2A surface reflectance, pulled via the
  Element84 **earth-search** STAC API (`sentinel-2-l2a` collection) — the same
  path already in `scripts/_sentinel.py`. NDVI computed from B08/B04.
- **Licence:** Copernicus free, full & open — **commercial use explicitly
  permitted**. This is the gold-standard licence for us.
- **Resolution / cadence:** 10 m, ~5-day revisit.
- **Status:** shipped. No change needed; this tier is done.

### Tier 2 — Canopy height: **Meta / WRI 1 m Canopy Height (v2)**
- **Source:** the global 1 m canopy-height model from Meta AI + WRI, on **AWS
  Open Data** — anonymous, no credentials:
  `s3://dataforgood-fb-data/forests/v2/…` (STAC catalogue provided).
- **Licence:** **CC BY 4.0** — commercial use permitted with attribution. Clean.
- **What it gives us:** per-pixel canopy height at 1 m — the actual shade term,
  not just greenness. Derived from ~2018–2020 Maxar imagery + a neural height
  model.
- **Known limits (receipt these honestly):** single-epoch (~2018–2020, so it
  predates recent change); reported MAE of a few metres; cloud gaps; occasional
  ~150 m tiling artefacts. Good enough as a *shade/cooling* input; not a survey.

### Tier 2 — Land-cover mask: **ESA WorldCover 10 m** (already ours)
- **Source:** ESA WorldCover (2020/2021), on AWS Open Data + MS Planetary
  Computer. Class 10 = tree cover, 30 = grassland, etc.
- **Licence:** **CC BY 4.0** — commercial OK.
- **Role:** coarse tree/grass/built mask; cross-checks and gap-fills the CHM.

### Tier 3 — Individual trees: **procedurally generated**
- **Decision:** generate trees procedurally (reference-shaped broadleaf + palm),
  instanced via three.js `InstancedMesh`, placed and scaled from the Tier-2 CHM.
  Rendered as *illustrative* geometry and receipted as **modelled, not
  measured** — consistent with the twin's honesty posture.
- **Why not GLB assets:** a search of RenderHub / Sketchfab / the usual asset
  marketplaces returned overwhelmingly North-American and East-Asian species, no
  clean commercially-licensed **South-Asian** street/park trees (neem, gulmohar,
  krishnachura, palms). Buying wrong-species models to represent Kolkata would be
  *less* honest than an obviously-schematic procedural tree.
- **Fallback if ever needed:** Kenney / Quaternius **CC0** low-poly trees are
  commercially clean, but generic. Procedural is preferred because CHM-driven
  placement + height is more defensible than a scattered generic asset.

---

## What we are NOT using ❌ (and why)

Each of these was a reasonable lead. Every rejection below is a *licence or
existence* fact, verified against the primary source — not a quality judgement.

### Planet **NICFI** basemaps — *ended, and was non-commercial anyway*
- **Existence:** the NICFI Satellite Data Program **wound down in Jan 2025**; the
  replacement tender was **cancelled in Sept 2025**. There is no live successor.
- **Licence (even when live):** NICFI access was for **non-commercial /
  restricted use** — never valid for a for-profit product.
- **Correction on the record:** an earlier note of mine claimed NICFI "didn't
  cover India." That was **wrong** — NICFI's 30°N–30°S tropical band *did* include
  Kolkata. The verdict (ended + non-commercial → unusable for us) is unchanged,
  but the reason is licence and end-of-life, not coverage.

### Google **Earth Engine** free tier — *non-commercial*
- The email's NDVI / Dynamic World / EIE workflows all route through GEE. **Free
  GEE is non-commercial only**; a for-profit company needs a **paid Earth Engine**
  commercial licence. We deliberately avoid this trap by pulling EO data through
  **open STAC + AWS Open Data** instead (earth-search, Planetary Computer,
  dataforgood) — all commercial-clean.

### Google **Environmental Insights Explorer (Tree Canopy)** / **Dynamic World**
- The *data* is open (CC BY 4.0) but there is **no clean bulk access outside
  GEE** — using it at scale means the paid-EE licence above. Skipped for the same
  reason.

### **FABDEM** (free tier) — *non-commercial*
- The email suggested draping canopy onto FABDEM. **Free FABDEM is
  CC BY-NC-SA 4.0 — non-commercial.** (A paid commercial FABDEM licence exists via
  Fathom, but it is not free.) Not usable in our free/commercial pipeline. For
  terrain we already use terrarium tiles / Copernicus GLO-30 (commercial-clean).

### **DeepForest** — *valid tool, but we lack the required input imagery*
- DeepForest itself is **MIT-licensed** and fine. The problem is upstream: it
  needs **sub-metre RGB** (~10 cm) to detect individual tree crowns. We have **no
  legal sub-metre imagery pipeline for Kolkata** (no drones over Indian cities;
  no licensed aerial tiles). The email's premise ("as you used SAM for
  buildings") doesn't hold — our footprints came from **Overture**, not from our
  own high-res imagery. Without the imagery, DeepForest has nothing to run on.

### **Mapillary** — *no tree class + share-alike*
- Street-level imagery, but the **API exposes no tree/vegetation object class**
  we could use, and the content is **CC-BY-SA** with anti-scraping terms.
  Not a vegetation data source for us.

### WRI **GFW Tropical Tree Cover** — *usable licence, but marginal fit*
- CC BY 4.0 (commercial OK), but Kolkata sits at the **northern edge of its
  tropical extent** and the product is coarser than the Meta CHM. **Cross-check
  only**, not a primary tier.

### **OpenStreetMap `natural=tree`** — *too sparse*
- ODbL (commercial OK) but only **~464 tree nodes** across our wards —
  nowhere near enough to drive canopy. Not usable as a density source.

### **KMC tree census** — *does not exist as open data*
- No open, machine-readable municipal tree inventory for Kolkata was found.

---

## What we deliberately are NOT claiming

- **No AQI / pollution-dispersion layer, no wind-CFD.** The email gestured at
  air-quality tie-ins. Our physics is **2-D** (`sun` and `kRad` are scalars; no
  advection, no 3-D wind field). Bolting an AQI or dispersion story onto a model
  that cannot represent it would be exactly the "impressive but hollow" failure
  mode we are differentiating against. Vegetation enters as **shade + a cooling
  offset**, which the 2-D model *can* honestly represent.

---

## Net result

| Tier | Was suggested | What we ship | Licence |
|------|---------------|--------------|---------|
| 1 NDVI | GEE Sentinel-2 / NICFI | Sentinel-2 L2A via earth-search STAC | Copernicus (commercial ✅) |
| 2 canopy | Google EIE / Dynamic World / FABDEM drape | **Meta/WRI 1 m CHM** + ESA WorldCover | CC BY 4.0 (commercial ✅) |
| 3 trees | DeepForest + CesiumJS | **procedural**, CHM-driven, receipted as modelled | n/a (own geometry) |

Two of the three tiers are already commercial-clean and shipping. The one real
new ingest is the **Meta/WRI 1 m canopy-height model** — CC BY 4.0, anonymous
AWS, no GEE, no licence trap. Trees are ours. Nothing in the pipeline depends on
a non-commercial or dead source.

---

## Sources (primary-verified, 10 Aug 2026)

- Sentinel-2 / Copernicus open licence — https://sentinels.copernicus.eu/web/sentinel/terms-conditions ; earth-search STAC — https://earth-search.aws.element84.com/v1
- Meta / WRI 1 m Canopy Height (v2), AWS Open Data — https://registry.opendata.aws/dataforgood-fb-forests/ ; announcement — https://sustainability.atmeta.com/blog/2024/04/22/using-artificial-intelligence-to-map-the-earths-forests/
- ESA WorldCover (CC BY 4.0) — https://esa-worldcover.org/en ; AWS — https://registry.opendata.aws/esa-worldcover/
- Planet NICFI wind-down (Jan 2025) — https://www.planet.com/nicfi/ ; NICFI programme page — https://www.nicfi.no/
- Google Earth Engine terms (non-commercial free tier; commercial needs paid EE) — https://earthengine.google.com/commercial/
- Google Environmental Insights Explorer — https://insights.sustainability.google/ ; Dynamic World — https://dynamicworld.app/
- FABDEM licence (free = CC BY-NC-SA 4.0) — https://data.bris.ac.uk/data/dataset/25wfy0f9ukoge2gs7a5mqpq2j7 ; commercial via Fathom — https://www.fathom.global/product/fabdem/
- DeepForest (MIT) — https://deepforest.readthedocs.io/
- Mapillary API / licence — https://www.mapillary.com/developer ; terms — https://www.mapillary.com/terms
- WRI GFW Tropical Tree Cover — https://data.globalforestwatch.org/documents/tropical-tree-cover/
- OpenStreetMap ODbL — https://www.openstreetmap.org/copyright
- Kenney CC0 assets — https://kenney.nl/assets ; Quaternix — https://quaternius.com/
