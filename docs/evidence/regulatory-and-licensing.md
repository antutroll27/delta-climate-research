# Regulatory & licensing constraints

Why the engine uses the data it uses — and, more usefully for a sceptical reader, why it *cannot* simply
buy sharper data. Most "why don't you just…" questions about this twin have a legal answer rather than a
budget one, and this file is where those answers live with their citations.

> Compiled 2026-08-12. **Not legal advice.** Where the reading is contested, that is stated. Anything
> involving money or a sub-metre deliverable needs an Indian geospatial lawyer before commitment.

---

## The load-bearing constraint: India's 1 m / 3 m threshold

**DST Geospatial Data Guidelines, 2021** (F.No.SM/25/02/2020, 15 Feb 2021) —
[official PDF, dst.gov.in](https://dst.gov.in/sites/default/files/Final%20Approved%20Guidelines%20on%20Geospatial%20Data.pdf).

The guidelines set a **threshold of 1 m horizontal / 3 m vertical**, and split the world at it:

> **(vii)** "Maps/Geospatial Data of spatial accuracy/value finer than the threshold value can only be
> created and/or owned by Indian Entities and must be stored and processed in India."

> **(viii)** "Foreign companies and foreign owned or controlled Indian companies can license from Indian
> Entities digital Maps/Geospatial Data of spatial accuracy/value finer than the threshold value only for
> the purpose of serving their customers in India… **Re-use or resale of such map data by licensees shall
> be prohibited.**"

> **(ix)** finer-than-threshold data "shall only be stored and processed on a domestic cloud or on servers
> physically located within territory of India."

> **(x)** "There shall be no restriction on export of Maps/Geospatial Data of spatial accuracy/value **up
> to the threshold value**…"

Definition 7(e) explicitly includes "satellite-based remote sensing techniques" and "Aerial / UAV LIDAR".
Clause 7(f) defines an "Indian Entity" as Indian-citizen-owned/controlled.

Separately, clause **(vi)(b)** bars foreign entities from **terrestrial mobile mapping and street-view
survey irrespective of accuracy** —
[reporting](https://theprint.in/india/terrestrial-mobile-mapping-survey-street-view-survey-only-by-indian-entities-govt/904723/).

### What this means for this engine

| | |
|---|---|
| **We are on the safe side, and only just.** | Meta/WRI CHM is **1 m** — at the threshold, and clause (x) puts no restriction on data *up to* it. ETH at 10 m, Sentinel-2 at 10 m, Landsat at 30 m are all comfortably clear. |
| **It closes the obvious upgrade path.** | Sub-metre commercial imagery over Kolkata is cheap — Pléiades Neo 30 cm ≈ $135 for our 6 km², Vantor Vivid 30 cm ≈ $90 — and buying it as a non-Indian entity lands squarely in (vii)/(ix). Cost was never the blocker. |
| **It reframes the gold-standard option.** | Indian drone LiDAR (~₹22 L / £20k for 6 km²) is not merely the expensive choice — routing through an Indian entity is arguably the *compliant* structure. |
| **Street-view is worth a second look.** | We consume Mapillary's existing imagery rather than conducting a survey, which is a different act from what (vi)(b) prohibits — but the distinction has not been tested and should not be assumed. |

**The honest uncertainty:** the guidelines are widely *interpreted* as governing survey and data-creation
inside India rather than the purchase of foreign-satellite archive, and Airbus and Vantor visibly do sell
30 cm imagery over India. No authoritative clarification either way was found. Commentary:
[Mondaq](https://www.mondaq.com/india/fiscal-monetary-policy/1053508/india39s-revised-mapping-policy) ·
[National Law Review](https://natlawreview.com/article/maps-and-geospatial-data-india-regime-liberalized).

---

## Licence traps that have already caught us, or nearly did

Each of these looked usable and was not. They are recorded because the *reason* is reusable.

- **Google Earth Engine free tier — non-commercial only.** A for-profit product needs a paid Earth Engine
  licence ([earthengine.google.com/commercial](https://earthengine.google.com/commercial/)). Every
  NDVI / Dynamic World / EIE workflow routes through it, which is why this engine pulls EO data through
  open STAC and AWS Open Data instead.
- **Open-Meteo hosted free tier — non-commercial endpoint.** The underlying data is CC BY 4.0; the *service*
  is not. Technically the best-fitting weather API we found, and unusable for that reason.
- **WAQI / aqicn** — ToS forbids commercial use and cached redistribution without a signed agreement.
- **FABDEM free tier — CC BY-NC-SA.** A paid commercial licence exists via Fathom.
- **Planet NICFI** — programme ended Jan 2025, and was non-commercial while it ran. *(Correction on record:
  an earlier note here claimed it "didn't cover India". Wrong — its 30°N–30°S band included Kolkata. The
  disqualifier was licence and end-of-life.)*
- **Forest Survey of India digital forest cover — explicitly barred.** FSI's terms state the data "should
  not be used for commercial purpose by the user" and "should not be… put on internet." **Do not request
  it**; ingesting it would contaminate the pipeline's licence position.
- **ISRO Bhuvan portal — viewing only.** Its terms bar derivative works. Note the trap: **GODL-India
  permits commercial use but governs `data.gov.in`, not Bhuvan.** Two different regimes, one government.
- **Google Photorealistic 3D Tiles** — runtime-only ToS (no caching, which breaks the static-asset
  pattern), uncapped per-session billing on a public page, and no building IDs.

## Licences we rely on, and why they hold

| source | licence | commercial |
|---|---|---|
| Meta/WRI Canopy Height Model v1 + v2 | CC BY 4.0 | yes, with attribution |
| ESA WorldCover, Copernicus Sentinel-2 | CC BY 4.0 / Copernicus open | yes, explicitly |
| Landsat, ECOSTRESS, NASA POWER, FIRMS | US public domain | yes |
| Microsoft Global ML Building Footprints, Overture, OpenStreetMap | ODbL | yes, share-alike on derived DB |
| Met Norway locationforecast | NLOD + CC BY 4.0 | yes (proxied server-side; browser-direct breached ToS) |
| Mapillary | imagery CC-BY-SA; API ToU §12 permits commercial use of derived data | yes, streamed not rehosted |
| ETH Global Canopy Height | CC BY 4.0 (raster; repo code MIT) | yes |
| CPCB via data.gov.in | GODL-India | yes |

**The pattern worth naming for an investor:** every layer in the shipped engine is either public domain or
permissively licensed for commercial use, and the sub-metre upgrade path is closed by regulation rather
than by money. That is a constraint on what the twin can become, and it is also the reason a Global-South
competitor cannot trivially outspend us into a better dataset.
