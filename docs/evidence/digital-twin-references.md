# Digital-twin & standards references

City-twin precedents and provenance/standards frameworks — each with what to *steal* and, where it
applies, the anti-pattern to avoid. This is the "how the credible ones earn credibility" file: the
argument for "receipts, not renders" is built from these.

> From `docs/research/2026-08-09-city-twin-credibility-research.md` and the twin-credibility briefing
> (`docs/briefings/2026-08-09-twin-credibility-briefing.html`). Facts as-found on primary pages.

---

## City-twin exemplars

- **Destination Earth — Urban Heat Island service (UrbClim)** · ECMWF/ESA/EUMETSAT (DestinE), model by
  VITO · **Steal →** validate against ground truth and publish the error stats with honest caveats, out
  loud. · Facts: UrbClim's pan-European record was validated against **67 met stations** (Copernicus C3S,
  100 cities); a *separate* Prague/Lisbon demo (summer 2022) held up "certainly given the fact that most
  of these stations were in non-optimal measurement locations and used non-professional equipment" — two
  distinct validations, both stated qualitatively (no published RMSE/bias on the page). ·
  [destination-earth.eu](https://destination-earth.eu/use-cases/addressing-urban-heat-island-effect/)

- **Virtual Singapore** · NRF, built by Dassault Systèmes (3DEXPERIENCity) on SLA aerial-photo + airborne
  LiDAR · **Steal →** semantics = credibility — "a realistic and integrated 3D model with semantics and
  attributes," not a purely visual twin; our buildings already carry attributes worth exposing. · Fact:
  ~**S$73M, five-year** national R&D programme; proprietary platform + authoritative LiDAR — cite the
  posture, not the stack. · [SLA press release](https://www.sla.gov.sg/articles/press-releases/2014/virtual-singapore-a-3d-city-model-platform-for-knowledge-sharing-and-community-collaboration)
  · [GovTech "5 things to know"](https://www.tech.gov.sg/technews/5-things-to-know-about-virtual-singapore/)

- **Helsinki 3D+ / Kalasatama** · City of Helsinki · **Steal →** open data can be authoritative — publish
  both the semantic model *and* the reality mesh, openly licensed; make openness itself the credibility
  signal. · Facts: publishes a semantic **CityGML** model *and* a photogrammetric reality mesh, both **CC
  BY 4.0**; the Kalasatama pilot mesh was built from **42,000+ aerial photos at ~7.5 cm**. ·
  [hel.fi](https://www.hel.fi/en/decision-making/information-on-helsinki/maps-and-geospatial-data/helsinki-3d)
  · [hri.fi dataset](https://hri.fi/data/en/dataset/helsingin-3d-kaupunkimalli)

- **Digital Twin Victoria** · Victorian Government + CSIRO · **Steal →** treat provenance as the product —
  a small version of the same idea is one structured source of truth for "where did this come from," per
  layer, per city. · Facts: **AUD $37.4M / 4-year**; the value is a catalogue of **4,000+ datasets**, each
  with metadata, **CC BY 4.0** licensing + attribution, served via OGC web services. ·
  [land.vic.gov.au](https://www.land.vic.gov.au/maps-and-spatial/digital-twin-victoria/about-the-program) ·
  [discover.data.vic.gov.au](https://discover.data.vic.gov.au/dataset/digital-twin-victoria)

---

## Provenance / transparency patterns

- **Our World in Data (OWID)** · publisher not further specified (**verify org affiliation**) · **Steal →**
  distinguish measured vs modelled/derived visibly; our biggest honesty exposure is which pixels are
  satellite-measured vs model-interpolated. · Fact: every series is labelled by measured source vs "Our
  World in Data based on…", transformations flagged, Grapher open-sourced. ·
  [ourworldindata.org/faqs](https://ourworldindata.org/faqs)

- **NYC Heat Vulnerability Index** · NYC DOHMH · **Steal →** publish operational definitions + a
  purpose/values statement — an "About this instrument" page with our exact metrics, no hand-waving. ·
  Facts: exact trigger ("2+ days at heat index 95 °F, or 1+ day at 100 °F"), 1–5 scale, links a
  peer-reviewed method paper. ·
  [a816-dohbesp.nyc.gov](https://a816-dohbesp.nyc.gov/IndicatorPublic/data-features/hvi/)

- **UK Gemini Principles** · CDBB, Dec 2018 · **Steal →** adopt "openness" and "quality" as explicitly
  stated values on our About page — the canonical values framework for trustworthy twins. · Nine
  principles in three groups: *Purpose* (public good, value creation, insight), *Trust* (security,
  openness, quality), *Function* (federation, curation, evolution). ⚠️ marked "general-knowledge,
  fact-checked" in the research doc rather than primary-sourced. ·
  [cdbb.cam.ac.uk](https://www.cdbb.cam.ac.uk/DFTG/GeminiPrinciples)

- **Google Earth Engine — Data Catalog** · Google · **Steal →** per-layer "receipts" as a first-class UI
  object — copy the field set verbatim for every layer. · Fact: every dataset carries a structured card —
  provider, temporal coverage, spatial resolution, bands/variables, linked license, suggested (APA)
  citation, DOI. · [developers.google.com](https://developers.google.com/earth-engine/help_dataset_description)

- **Data Nutrition Project + ISO 19115 / ISO 19157** · Data Nutrition Project (framework); ISO (standards)
  · **Steal →** a standardised "nutrition label" per layer — composition, provenance, limitations,
  fitness-for-use; name ISO 19115 (lineage) + ISO 19157 (quality/"usability") so it reads as a real
  instrument, not an invented scale. · [datanutrition.org](https://datanutrition.org/) · [framework
  paper](https://arxiv.org/pdf/1805.03677) · [ISO 19115](https://www.iso.org/standard/32575.html)

---

## Standards for portability

- **3D Tiles / glTF / Cesium / OGC** · 3D Tiles by Cesium (2015), OGC Community Standard since 2019; glTF
  by Khronos, now **ISO/IEC 12113** · **Steal →** build on open standards so one procedural build drops
  onto any city — a ward pipeline should be portable, not bespoke. ·
  [cesium.com](https://cesium.com/why-cesium/3d-tiles/) · [ogc.org](https://www.ogc.org/standard/3dtiles/)
  · [khronos.org/gltf](https://www.khronos.org/gltf/)

---

## Anti-patterns (what NOT to do)

- **Frontiers in Big Data — digital-twin critique** · DOI **10.3389/fdata.2023.1236397** · anti-pattern +
  validation of our no-photoreal constraint: don't treat visual fidelity as credibility, and don't
  over-claim "digital twin" (implies live bidirectional coupling) — scientists discount static
  visualisations that claim it. Many twins are "dashboards that look impressive but lack depth." ·
  [frontiersin.org](https://www.frontiersin.org/journals/big-data/articles/10.3389/fdata.2023.1236397/full)

- **CAPA Strategies — Heat Watch** · community heat-mapping · **anti-pattern:** rigorous methodology
  delegated to separate linked reports buries the provenance. Receipts must be **one click from the
  number**, not a PDF. · [capastrategies.com](https://www.capastrategies.com/heat-watch-data)

---

## Two findings that reframe the differentiator

- **Trust & uncertainty-visualisation study (N=161)** · [arxiv.org/abs/2602.00248](https://arxiv.org/abs/2602.00248)
  — visualising uncertainty on thematic maps *generally reduces* trust in the **data's accuracy** but
  barely touches trust in the **mapmaker's integrity**; low-uncertainty displays carry **no** trust
  penalty vs showing nothing. **Design consequence:** lead with the confident surface; keep uncertainty
  quiet, opt-in, and paired with provenance.

- **ExploreTrees.SG** *(verify — publisher/operator not named in docs)* · **Steal →** cull-to-viewport
  rendering for large tree-instance counts on mobile / coarse-pointer tiers. Only mention in
  `2026-08-10-heat-map-vegetation-layer-design.md:144`.
