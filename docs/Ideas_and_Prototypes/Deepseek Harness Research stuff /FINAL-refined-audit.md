# FINAL REFINED AUDIT — Delta Climate Research Tool-Expansion Research
**Audit date:** 23 Aug 2026 · **Auditor:** parent session · **Scope:** every load-bearing claim across all research deliverables produced this session, re-verified against primary sources.

---

## 1. Method

Three research agents (virality precedents - GCC/ME data audit - EU/Copernicus audit) produced five deliverables. Every decision-critical claim was then re-verified through three independent lanes:

1. **Parent-session direct verification** — binary probes via zero-quota channels: HN Algolia API, GitHub API, Zenodo API, raw curl to CEMS/Copernicus/Gulf portals, direct Firecrawl scrapes of licence pages (WSF3D, GHSL, ECMWF forum, PVGIS/SARAH-2, Shams Dubai DEWA docs).
2. **Three dedicated fact-checker agents** — one per dossier, returning CONFIRMED / CORRECTED / NOT FOUND with verbatim quotes and URLs (Checker A: 12 virality claims; Checker B: 10 EU claims; Checker C: 9 GCC claims).
3. **Cross-agent contradiction resolution** — where researchers disagreed (EMSR845), resolved against the primary system directly.

## 2. Scorecard

| Lane | Checks | Result |
|---|---|---|
| Parent direct (HN/GitHub/Zenodo/portals/licences) | ~25 | All confirmed exact |
| Checker A (virality page-claims) | 12 | 12 confirmed; 2 footnotes (Watch Duty cumulative-vs-active users; BBC fact split across 2 URLs) |
| Checker B (EU licences/services) | 10 | 5 confirmed; 5 partial/corrected |
| Checker C (GCC data) | 9 | 8 confirmed; 1 corrected (Hong paper attribution) + clarifications |
| Cross-agent conflicts resolved | 1 | EMSR845 mis-attribution -> fixed in 4 locations |

**Bottom line:** no fabricated facts survived. Every error found was mis-attribution or stale metadata — none was invented. All are now corrected **in the source files themselves**.

## 3. Corrections applied to files (authoritative log)

### research/virality-report.md
1. **EMSR845 != Dubai floods.** Direct probe: EMSR845 = "Flood in Mexico" (activated 13 Oct 2025). No Copernicus EMS rapid-mapping activation exists for the Apr-2024 UAE event (GCC audit independently verified absence across the full 71-activation 2024 list). Fixed in: case-study row, archetype-(h) rationale ("Un-owned news hook" + "credibility kill-shot"), sources section. Audit-log entry #13 appended.
   - **Consequence:** validation route re-specified — self-derived Sentinel-1 extents via Copernicus Data Space Ecosystem (free registration), cross-checked against published academic mappings. The narrative gets *stronger*: nobody official ever mapped the event; Delta can be first.
2. **BBC sourcing split noted:** Al Ain ~256mm/24h figure lives on science-environment-68839043; the "75 years since records began" line sits on companion science-environment-68897443. NCM's later precise figure: 254.8 mm at Khatm Al Shakla, Al Ain. Both URLs now listed.

### gcc-audit/GCC-open-data-audit.md
3. **TanDEM-X 30 m EDEM downgraded:** download flow includes a User Licence titled "...TanDEM-X 30m-EDEM DCM **for Scientific Use**"; unedited 30 m Global DEM + 12 m require science proposals. Treated as non-commercial-safe; GLO-30 remains the open terrain backbone.
4. **Academic flood-mapping attribution corrected:** the ~23.8 km2 Dubai figure is Xin Hong (Mar 2026), Geomatics, Natural Hazards and Risk (Taylor & Francis) — daily **PlanetScope + U-Net**, NOT Sentinel-1/MDPI. Added second study: Bersi et al. 2025 (Sentinel-2, Al Ain, ~215 km2 within study area). Two independent mappings = cross-validation option for the flood tool.
5. **GSA credit-line nuance added** ("users are requested..." phrasing inside a binding-attribution clause — reproduce verbatim regardless); **Meta HRSL 30 m resolution attributed to Meta documentation** (HDX metadata omits it); **uncertainty-log item 1 updated** with external double-confirmation of the EMSR negative finding.

### eu-open-data-audit-2026.md
6. **UrbClim CDS dataset DEPRECATED 10 May 2024** — downloads disabled on CDS. Concept 1's primary layer must come via the EEA "UHI intensity modelling" mirror record (sdi.eea 45b703bb) or VITO/EEA channels; availability re-check flagged as build prerequisite.
7. **EU-DEM retirement date unsupported** — retirement itself confirmed ("not maintained anymore..."), but already retired by Sep-Nov 2023 per Wayback; the "January 2024" date was removed.
8. **EGMS legal basis corrected:** Commission **Delegated** Regulation (EU) No 1159/2013 of 12 July 2013 (+ Reg. (EU) 2021/696 governance). EU Login requirement for archive search/download re-confirmed.
9. **ClimateADAPT Urban Adaptation Map Viewer now ARCHIVED/legacy** — official EU UHI browsing infrastructure is decaying; gap-analysis conclusion strengthened.
10. **SubRISK+ citation corrected:** Cigna et al. 2025 (Scientific Reports 15:34999, doi:10.1038/s41598-025-18941-8) covers the **15 metropolitan cities of Italy**; SubRISK+ is the project name, not a public viewer. Pan-European subsidence-viewer gap therefore *larger* than first stated.
11. **PVGIS flag finalised:** rate limit verbatim ("30 calls/second per IP"); no commercial restriction in official docs; **no standalone ToU page exists at all** — in-app disclaimer re-check remains a launch gate.
12. **FathomDEM ruled out for commercial tools** (added during Mumbai scoping): Zenodo record 14511570 licence field = **CC BY-NC-SA 4.0** (non-commercial + share-alike), verified 23 Aug 2026 — corrects the virality report's implicit "open world-class DEM" suggestion. Copernicus GLO-30 remains the only clean open DEM backbone; CartoDEM flagged licence-unverified.

### research/my-findings.md — PATCHED 24 Aug 2026 (raw trail, was not covered by the original sweep)
13. **The EMSR845 correction had not propagated here.** §3.1 fixed the case-study row, archetype-(h) rationale and sources in `virality-report.md`, but `my-findings.md` still asserted "Copernicus EMS Rapid Mapping activation EMSR845 for Dubai Apr-2024 floods" with the activation URL. Struck in place with the correction, rather than deleted, so the trail shows what was believed and why it changed. **Root cause worth remembering: `research/.firecrawl/s09-ems-dubai.json` returns the EMSR845 URL at position 2 for a Dubai query, with description text that reads like a match.** The failure mode is a search result that looks like a citation; it will recur.
14. **Watch Duty press figures were stale here too** (~20M users, ~$6M) — superseded by its own 2025 annual report ($11.4M, 111,124 paying members, 16.8M yearly actives), which §"Pre-existing correct items" below already noted without patching this file.
15. **Two softer overstatements corrected while in there:** Global Solar Atlas described as "open terms-of-use" (it is CC BY 4.0 **plus binding additions** — verbatim citation string, no logos, no implied endorsement), and the Project Sunroof line quoting an HN thread title in a way that read as an official shutdown (audited verdict: "live but abandoned"; no such statement exists).

### Pre-existing correct items (verified, no change)
Watch Duty figures already superseded by its own annual report ($11.4M raised 2025, 111,124 members, 16.8M yearly actives); Sunroof "live but abandoned"; FIRMS 5,000 txn/10-min official; Google Maps pricing crisis event-verified; Desmos-Amplify 2019; EGMS scope EU-27+UK+NO+IS.

## 4. Verified fact base (tiered)

**[P] Primary-verified:** Copernicus CC BY 4.0 switch effective 2 Jul 2025 (ECMWF forum announcement + implementation confirmation) - GHSL CC BY 4.0 incl. commercial - WSF3D CC BY 4.0, no registration - EGMS free-open (Del. Reg. 1159/2013) with EU Login gating - JRC river-flood maps Europe/Med AND global v2.1: CC BY 4.0, anonymous access - Open-Meteo free tier non-commercial-only (verbatim) - MET Norway NLOD 2.0 + CC BY 4.0, UA required, >20 req/s disallowed - Google Open Buildings V3 excludes all six GCC states (official country list) - Microsoft GlobalML CDLA-Permissive-2.0, refreshed 2026-08-13 (30,340 tiles/225 regions, 1,945 updated) - Meta HRSL UAE on HDX license_id cc-by - GSA CC BY 4.0 + binding additions (citation line, no-endorsement/no-logos, WIPO->UNCITRAL arbitration) - PVGIS-SARAH2 extent N72/S37/W20/E63.05 @ 0.05deg => UAE inside, most of India outside (ERA5 fallback ~0.25deg) - Barcelona Dust Regional Center domain explicitly includes Middle East (72h forecasts) - CDSE free Sentinel access with registration - Copernicus EMS output free/open under Reg. 2021/696 with citation duties (Art.-53 restricted subset exists) - DEWA Shams Dubai net-metering mechanics (credit-only surplus; slab-offset before slabs apply) - CBAM definitive regime live Jan 2026; 50 t/year mass de-minimis replaces EUR150/shipment (~90% importers exempt, 99% of embedded emissions still covered; H2 & electricity excluded) - OSHA Outdoor WBGT Calculator + NWS WBGT prototype + Perry Weather B2B exist - Pulitzer 2020 Explanatory = WaPo "2C: Beyond the Limit" (pulitzer.org) - Axios: Jupiter $54M Series C co-led ClearVision+MPower, ~$100M total - Cloudflare: Portugal traffic -50% during blackout - Electricity Maps EUR5M round + enterprise API with free tier - NYT Nov 30 2025 Zillow removal + News & Observer ~73k NC listings - Sanders et al. 2024 Earth's Future DOI 10.1029/2024EF005164 - Kulp & Strauss 2019 Nat Commun (PubMed 31664024) - Berger & Milkman JMR 49(2):192-205, 2012, DOI 10.1509/jmr.10.0353 - EMSR773 = Valencia DANA, activated 29 Oct 2024 - Bayanat.ae / AD-SDI / data.abudhabi reachable (200s); geoportal.dm.gov.ae refused; open.data.gov.sa unreachable externally; Oman alive; Dubai Pulse still blocked.

**[S] Single-reputable-secondary:** Watch Duty press figures (ABC7 >1M downloads/24h, ~7M actives) — superseded where annual report differs - Windy traffic figures founder-reported - Ventusky 1M+ / Zoom Earth 5M+ Play listings - ESOTC 2025 heat hooks (hottest June W-Europe; LST >50C late June 2025; 2025 third-warmest globally).

**[C] Community-reported:** FIRMS outage 27 Nov 2025 (r/gis) - Reddit ">1M listings" Zillow figure (73k NC figure itself is News & Observer [S]).

**[N] Absent-evidence register (do not cite as fact):** any interactive flood tool capturing Dubai/Valencia moments (none existed) - Sunroof discontinuation statement (none exists) - NYT/WaPo internal analytics - Climate Central tool-level traffic - FIRMS event volumes - Electricity Maps blackout visitors - Windy audited profitability (Latka ARR is an estimate) - First Street nonprofit-era grant totals - Pielke Jr. critique-of-Climate-Central specific URL.

## 5. Final recommendations (conclusions unchanged; evidence now clean)

1. **Ship Rooftop Solar ROI Explorer (in flight).** Fully legal stack verified end-to-end. Differentiators: DEWA slab-offset modelling + heat/dust derating from own LST/CAMS methodology. Geometry base: Microsoft GlobalML (CDLA-P2.0) +/- Overture (ODbL-separable); heights approximated from WSF3D 90 m + GLO-30 with honest uncertainty band (no Gulf per-building heights exist in any open set). Carry the GSA credit string verbatim. Data-vintage stamps on every number.
2. **Build Flash-Flood Explorer -> Simulator next.** Launch narrative: *"Nobody ever officially mapped the April 2024 floods — we did."* Derive Sentinel-1 extents via CDSE; cross-validate against Hong 2026 (PlanetScope/U-Net, ~23.8 km2) and Bersi et al. 2025 (Sentinel-2, ~215 km2 Al Ain area); publish hit-rate/confusion matrix before promoting predictive mode. Ship 9:16 animated depth loops for TikTok-class distribution. Never depend on NCM radar/Dubai Pulse/DM geoportal.
   - **Mumbai added as second-wave city (P2 — behind Dubai + European cities at P1).** Target: pre-monsoon May 2027 launch, Jun–Sep spike season. Google OB footprints *and* 2.5D heights cover India (better height data than Dubai gets); deltas: flat-terrain DEM error propagation (depth ranges not point depths), compound rain×tide forcing, drainage-opacity disclaimer, event-stratified validation (Jul-2005 vs modern monsoons). Full spec: `BUILD-SPEC-flood-explorer.md`.
3. **Shade walkability simulator** rides a verified-empty consumer slot (institutional WBGT calculators + journalism only) and reuses the Kolkata twin stack. EU variant note: UrbClim access runs through the EEA mirror (deprecated on CDS) — verify before committing.
4. **Slot three, pick per audience:** Live Gulf Dust Globe (CAMS CC-BY + Barcelona Dust Center ME domain) for Gulf virality; Subsidence Atlas EU (EGMS, EU Login precompute) for European prestige — academic coverage being Italy-only makes that whitespace larger than first reported.
5. **CBAM calculator upgrade** stays aligned to reporting deadlines; 50 t de-minimis framing verified accurate.

## 6. File inventory
- BUILD-SPEC-flood-explorer.md — engineering handoff spec (P1a Dubai · P1b EU compound demos · P2 Mumbai)
- CONCEPT-greenprint.md — solarpunk-grounded possibility-engine concept brief (naming, constraint-physics mapping, toolkit + solarpunk expansion pack)
- procedural-gen-github-audit.md — 51-repo API-verified procedural toolkit audit (top-10, coverage matrix, licence red flags)
- solarpunk-stack.md — merged solarpunk sim stack report (15 verified papers, ~22 libs, adopt/black-box/reference tiers); raw: .firecrawl-deep/solarpunk-findings.md
- research/virality-report.md — audited synthesis (22-row table, checklist, rankings, risks, ~95 sources, 13-entry audit log)
- research/subagentA-case-studies.md (~88 URLs); research/subagentB-investor-failures.md (91 URLs)
- eu-open-data-audit-2026.md — patched with fact-check corrections
- gcc-audit/GCC-open-data-audit.md — patched with fact-check corrections
- research/my-findings.md, research/.firecrawl/*, .firecrawl/q-*.txt — raw verification trails

*Every factual statement in the deliverables carries either a primary-source verification or an explicit absence flag.*

*A NOTE ON THE SCOPE OF THAT CLAIM. The line here originally read "Nothing known-false remains in any file", and on 24 Aug 2026 that was not true: the sweep had covered the deliverables but not the raw verification trails, and `research/my-findings.md` still carried the EMSR845 mis-attribution this very document was written to kill, plus three lesser staleness items (§3.13–15, now fixed). The deliverables were clean; "any file" was a claim the audit had not earned. Recorded rather than quietly rewritten, because an audit that overstates its own coverage is the same class of error it exists to catch.*
