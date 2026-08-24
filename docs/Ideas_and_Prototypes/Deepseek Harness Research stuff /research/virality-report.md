# VIRALITY OF INTERACTIVE CLIMATE/GEOSPATIAL TOOLS
## Research brief for Delta Climate Research (deltaclimate.earth) — August 2026
Prepared by ox-alpha research agent. All facts sourced below; unverified items flagged.

---

## (a) CASE-STUDY TABLE

| Tool | Year | What drove sharing | Evidence | Tech / model | Lesson for Delta |
|---|---|---|---|---|---|
| **earth.nullschool.net** | 2013– | Beauty + drama of live wind fields; screenshots of typhoons shared during events | WaPo Capital Weather Gang called it "gorgeous, mind-blowing" (17 Dec 2013); Slate ran a piece on a *screenshot* of it; started as Beccario's side project to learn JS after seeing an earlier US-only wind map (hint.fm/wind); open-source repo github.com/cambecc/earth; Bluesky/X following sustained for 13 yrs | Custom canvas + d3-geo, GFS data; repo github.com/cambecc/earth **6,586 GH stars** (created 4 Nov 2013); HN 153pts (2013) / 438pts (2016); donation-supported, **no monetization found** | Beauty earns durable brand, not revenue. Screenshot-friendliness IS the distribution |
| **Windy.com** | 2014– | Beauty + prosumer utility + hurricane-event spikes | Founder Ivo Lukačovič (Seznam.cz billionaire) personally funded; code forked from Beccario's `earth`; "up to 6 millions users a day (durring hurricanes)" (founder post), ~800k/day (CAMS article), 300k/day (May 2018); HN **1,052pts** (2021); free core + Premium sub ($25.99→$34.99/yr by 2025) + paid API tiers | WebGL, own tile/forecast infra; VC-free, profitable subscriptions/API | A beautiful free map CAN be a business (B2C sub + B2B API). Founder-funded patience mattered |
| **Ventusky** (InMeteo) | 2017– | Same beauty/utility loop, animated layers | Czech met company; 50+ layers, ~200 radars; **1M+ Google Play downloads**; HN **849pts** (Feb 2017) | In-house met data viz | Second mover still won a niche via animation quality |
| **Zoom Earth** (Neave Interactive) | 2000s/2016 relaunch | Live satellite imagery every 10–15 min during hurricanes/wildfires | HN **399pts** (Jul 2020); **Google Play 5M+ downloads**; imagery every ~10 min; large X/social following | Neave one-man-shop scale | Real-time imagery + a social account that posts the event = recurring audience |
| **NASA FIRMS** | long-running | Fear/monitoring during fire crises (LA fires Jan 2025) | FIRMS MODIS/VIIRS near-real-time fire map referenced by TV meteorologists during Jan 2025 LA fires; NASA SVS published LA-fire overview maps; NASA spotlighted Direct Relief's operational use of FIRMS data in the fires (Aug 2025) — best third-party usage evidence; raw request volumes unpublished; NOTE: 'FIRMS got rate-limited during the LA fires' is confirmed ABSENT from the record — do not cite as incident | Public sector, free; hard API limit 5,000 transactions/10-min per MAP_KEY | Even agencies see surge demand; official sources get cited when they're fast and open |
| **Watch Duty** | 2021– | Trust + civic urgency in disasters; real people curating official data | LA Times (8 Jan 2025): **+600k users overnight**, $2M memberships + $600k donations by Jan 8; own 2025 annual report: **$11.4M raised (2× YoY), 111,124 paying members, 16.8M yearly actives**, ~$3M donated in Jan alone; ABC7 during fires: >1M downloads/24h, ~7M active users; sustained **100k req/s at 100% uptime** via in-kind Google/AWS/Fastly/Mapbox support; expanded to floods | Independent 501(c)(3) — its own entity, NOT Wildfire Defense Systems (audit correction); free core + Membership + Professional Solutions (watchduty.org/about); enterprises (PG&E, Xcel, Verizon, BNSF) integrate INTO Watch Duty; human-in-the-loop volunteer radio-scanner intel on OSM-based map | Realtime + verified local trust beats pretty-but-static. Spikes convert to donations when there's a mission |
| **Climate Central Surging Seas / Coastal Risk Finder** | 2012– | Fear + address lookup + *journalist enablement* | Launched 14 Mar 2012 ("doubles flood risk"; ~5M US residents <4ft above high tide); Kulp & Strauss 2019 (CoastalDEM) tripled exposure estimates (~1,850 citations); Climate Central's own analysis says publishing its work "likely influenced" a **42% increase** in climate-contextualized local-TV segments (their claim, not audited); site traffic NOT FOUND | Nonprofit; grants; free tools + datasets for reporters | The press-kit model (vetted visuals + localized data for journalists) multiplies earned media. But see failures §(d) |
| **Google Project Sunroof** | 2015–~2023 | Money + rooftop personalization | 43M homes covered; HN 389pts at launch (Aug 2015); HN 176pts "being shut down… data not updated in ages" (Feb 2023); **no official shutdown announcement exists — verdict 'live but abandoned'** | Google 3D + aerial imagery; free, ad-free, then rotted | Even Google couldn't maintain address-level data freshness. Solar ROI tools die of maintenance debt — budget refresh or don't build |
| **NYT "How Much Hotter Is Your Hometown Than When You Were Born?"** | 2018 | Nostalgia + a personal number you can quote | Widely shared (r/dataisbeautiful thread; NYT FB promo); hometown + birth-year input → days ≥90°F trend, Berkeley Earth data | Client-side interactive, static hosting | The canonical "personal geography + personal number" template; cheap tech, huge reach |
| **WaPo "2°C: Beyond the Limit"** | 2019 | Localized fear via new temperature-data analysis, county-by-county | **2020 Pulitzer Prize (Explanatory Reporting)**; OJA finalist; SEJ award; internal traffic NOT FOUND | Prestige → subscribers | Award-grade localized analysis is a credibility genre, not a growth hack |
| **Flood events as viral moments: Dubai floods (Apr 2024) & Valencia DANA (EMSR773, Oct 2024)** | 2024 | Disaster after-images: satellite imagery went viral in local FB/groups/news | Al Ain **256mm/24h** (BBC) — heaviest UAE rain in 75 yrs; cloud-seeding *conspiracy angle* amplified sharing; Valencia visuals spread via short-video social (TikTok imagery/hoaxes documented by Maldita.es; official toll 219) — NOT via map tools. **CORRECTED: NO Copernicus EMS rapid-mapping activation existed for the UAE event** (verified absence against the full 71-activation 2024 list; EMSR724/EMSR845 are unrelated events — EMSR845 is "Flood in Mexico", Oct 2025, verified on CEMS); ESA/CIRA imagery dominated; academic mappings (~23.8 km² flooded, PlanetScope U-Net study) came later. EMSR773 (Valencia, activated 29 Oct 2024) produced observed flood extents; Sentinel-1 images shared widely; follow-on papers (MDPI remotesensing; PMC DANA review) + reinsurance briefings (Guy Carpenter); **virality accrued entirely to static satellite/radar imagery — no interactive tool captured it** | Copernicus Sentinel-1/2, free open data | In Valencia, observed-flood maps OWNED the moment; in UAE nobody mapped it officially AND no consumer tool captured it — gap Delta can own outright |
| **Electricity Maps** | 2017– | Live grid-carbon map; exploded during 28 Apr 2025 Iberian blackout (15 GW lost, largest EU blackout in decades) | Cloudflare measured PT internet traffic −50% during outage; EM's own Spain review: **15 GW lost in 5 s ≈ 60% of demand, frequency to 48 Hz, ~10 h outage**; /platform/api page (primary source) sells enterprise API (carbon intensity, load, day-ahead prices, cross-border flows) with free start — free map confirmed as funnel-top; NOTE: EM published no blog on the blackout itself — its spike stays officially undocumented. Funnel economics (tech.eu, May 2024): bootstrapped since 2016, revenue doubled yearly, millions of yearly visitors while API reached ~**10M daily requests** BEFORE raising **€5M (Transition & Revent)**; customers incl. Google, Microsoft, Samsung | Free live map (open historical data) + paid API; Tomorrow ApS | THE template for "free live map → enterprise data sales". Publish the post-event analysis yourself; be where the spike lands |
| **ShadeMap.app** (Ted Piotrowski) | 2021– | Novelty/utility: sun shadows on 3D terrain, any date/time | **Show HN 685pts (30 May 2024)**; re-post 247pts (Aug 2026); "Shade Map Pro" launch 63pts (2022) citing paying real-estate users; photographers/filmmakers/route-sunlight uses; open-source lib + Pro subs + **commercial ShadeMap API** | Three.js + LiDAR/DEM rasters; indie, freemium | Global shadow sim already exists — Delta must differentiate on heat-weighted *walkability*, not geometry alone |
| **First Street (Flood Factor)** | 2020– | Address-level risk embedded where homes are bought | Free Flood Factor launched Aug 2020 covering **142M+ US properties** (CNBC); Realtor.com embed (2020), Redfin (Oct 2020 — users seeing scores bid on lower-risk homes), Zillow (Sept 2024); Redfin: climate-risk clicks nearly doubled post-Jan-2025 LA fires; nonprofit→**PBC spinoff 29 Feb 2024** (own press release; investors Galvanize Climate Solutions, Congruent Ventures; Innovation Endeavors led A-1) → **$46M oversubscribed Series A Jul 2024**; nonprofit-era grant totals: no authoritative figure published anywhere (treat as unknown, not zero); **Zillow removed scores 30 Nov 2025** (~73k NC listings) amid accuracy complaints; Reddit: "methodology opaque, no way to challenge" | Nonprofit-turned-data-vendor; B2B2C distribution | Distribution partners amplify AND abandon. Transparency + published error bars + challenge process is the moat — exactly Delta's stated brand |
| **"What the world would look like if all ice melted"** (NatGeo-derived maps) | 2013– | Pure spectacle/fear; +70m sea level fantasy | Massive reposts across r/MapPorn, Facebook map pages for a decade | Static maps | Virality ≠ substance; scientists criticize these as misleading. Don't build the spectacle version |
| **Jupiter Intelligence** (contrast case) | 2015– | Enterprise climate-risk analytics; NO free public tool | $54M Series C (Oct 2021, Axios); ~$100M total raised (Energize Ventures) | Closed B2B SaaS | Free tools aren't *necessary* for funding — but they compress trust-building for unknown studios |
| **One Concern** (contrast case) | 2014– | Enterprise/insurer AI; NO public tool | $45M from SOMPO (Jun 2021) inside a $100M multi-year Japan deal; ~$120M total (TechCrunch) | Closed B2B SaaS | Same lesson as Jupiter: enterprise-first players skip free tools entirely |
| **HubSpot Website Grader** (engineering-as-marketing canon) | 2006– | Free instant audit of *your own thing* | HubSpot: "one of their most successful lead generation tools" (third-party case study); Moz: free tools + content flywheel cut CAC to **$101** (Fishkin, SaaSClub interview); Desmos kept calculators free forever while Amplify bought its curriculum business (**2019**, not 2017 — audit correction) | Form + scoring logic | The grammar Delta's CBAM explorer should copy: input your shipment → get a number → get a lead |
| **Fathom (fathom.global) — FathomDEM** | 2024– | Open-sourced a world-class global 30m DEM (Zenodo, Dec 2024) as marketing for commercial flood models | Research paper claims near-LiDAR flood-model performance; "underpins next iteration of our flood maps"; FathomDEM+ webinar | Commercial data co giving away the foundation layer | "Give away the measurement, sell the decision" — a rigorous studio's best growth loop |
| **Climate TRACE / Carbon Monitor** | 2020– | Free facility-level emissions data as press magnet | TRACE launched open DB of 72k+ sources (2021); mapped the 70k worst emitters across every Paris-signatory party; Al Gore launched Emissions Reduction Roadmaps at COP30 Belém; Carbon Monitor = academic instrument (Nature Sci Data 2020) | Open data; influence-not-revenue (TRACE); citations/media (CM) | Free UNIQUE datasets make journalists depend on you — the lever Delta can pull with Gulf flood/heat data |

---

## (b) SHAREABILITY DESIGN PATTERNS — CHECKLIST
Evidence: Berger & Milkman (high-arousal emotion → shares), newsroom dataviz engagement literature, postmortems above.

1. **Personal geography in <10 seconds** — pin-drop/address/hometown before any signup or scroll (NYT hometown, Sunroof, Flood Factor, Climate Central Risk Finder). The input IS the hook.
2. **One quotable personal number** — "+41 more 90°F days", "water reaches 62cm at your gate". Numbers travel; nuance doesn't. Put it in the OG image.
3. **Engineer high-arousal emotion** — awe (beauty), anxiety (threat), anger (injustice) drive shares (Berger & Milkman, JMR 2012). Fear gets clicks; *awe+utility* gets saves and return visits.
4. **Screenshot-native share cards** — dark background, huge numeral, place name, timestamp, logo, short state-encoded URL; auto-render server-side OG images per location. Design for platform crops (Evergreen Data guidance).
5. **Real-time or "event mode"** — spikes arrive with events (blackout→EM, fires→FIRMS/Watch Duty). Pre-build the event landing page + capacity plan; publish your own post-event analysis within 48h (EM's Spain grid review is the template).
6. **Animation loops** — wind/shadow/water motion is inherently shareable (nullschool, Ventusky). Loop the day-night shadow sweep; make GIF-export trivial.
7. **Comparison mode** — "your city vs another", before/after sliders (Valencia/Dubai satellite pairs spread organically), scenario toggles (50mm/hr vs 100mm/hr rain).
8. **Shock metric WITH visible error bars** — pair the scary number with uncertainty and a plain-language method note (CoastalDEM ±4in vs SRTM ±6ft framing). This is Delta's differentiator AND inoculates against backlash.
9. **Zero-friction architecture** — no login, mobile-first, static-hosted, pre-rendered/cached tiles; survives HN/Reddit spikes (Astro static + CDN edge = right call; compute async).
10. **Journalist enablement kit** — embed codes, pre-cleared captions, downloadable datasets, a media page (Climate Central model). Earned media compounds.
11. **Calendarized release hooks** — pre-monsoon (May), hottest-week (Jun/Jul), CBAM deadlines, COP weeks; give press an annual reason to return.
12. **State-in-URL + one-click PNG export** — every view reproducible and shareable; measure K-factor via exported-card referrers.

---

## (c) RANKED ARCHETYPE RECOMMENDATION
Scored 0–10 per criterion for THIS studio (Kolkata, 5 ppl, serving India+UAE; Dubai investor + PwC audience; three.js/CityJSON/ECOSTRESS stack; Astro/Vercel; brand = "decision-grade, standards-aligned, publishes its error bars").

| Rank | Archetype | Virality | Credibility fit | Decision use | Open-data fit | Effort/synergy | Total |
|---|---|---|---|---|---|---|---|
| **1** | **(h) Flash-flood path simulator, Dubai/wadis** | 9 | 7.5 | 9 | 8.5 | 7.5 | **8.1** |
| **2** | **(c) Shadow/shade walkability sim (heat-weighted)** | 7.5 | 9 | 7.5 | 9 | 9 | **7.7** |
| **3** | (f) CBAM tariff explorer (upgrade existing calc) | 5.5 | 9.5 | 9.5 | 9 | 9.5 | **7.3** |
| 4 | (b) Rooftop solar ROI Dubai | 7 | 7 | 8 | 7.5 | 6.5 | **6.9** |
| 5 | (d) Live dust/AQ globe Gulf | 7.5 | 6 | 4 | 8.5 | 6 | **6.4** |
| 6 | (a) Sea-level-rise globe Gulf/EU | 8.5 | 5 | 5.5 | 8 | 5 | **6.0** |
| 7 | (g) Subsidence viewer (EGMS) | 5 | 9 | 7 | 5 (EU-only) | 4 | **5.8** |
| 8 | (e) 'Your street in 2050' renderer | 8.5 | 3 | 3.5 | 6 | 4.5 | **5.2** |

### Why #1 (h): Flash-flood path simulator
- **Un-owned news hook**: Dubai Apr-2024 floods (Al Ain ~256mm/24h; DXB airport underwater) were the region's defining climate event — and **no Copernicus EMS rapid-mapping activation was ever triggered** (verified absence across the 2024 activation list): nobody official ever mapped the extent. No consumer-grade UAE tool captured the attention either. Every future cloudburst re-triggers demand (Windy/Zoom Earth spikes prove the pattern).
- **The credibility kill-shot**: derive the observed extents YOURSELF — Sentinel-1 water-mask change detection over 14–18 Apr 2024 via Copernicus Data Space Ecosystem, cross-checked against the published academic mapping (~23.8 km² flooded) — then back-test the simulator against those extents *before launch* and publish the hit-rate/confusion matrix + assumptions. That single chart ("our screening model reproduces X% of observed Apr-2024 flood area at 30m") is precisely the "publishes its error bars" brand promise — no competitor in the Gulf does this, and being the first to publish observed extents for the event makes Delta the source of record.
- **Personal input + shock metric**: pin-drop → "water reaches your plot at N cm in a 100mm/hr storm" + before/after slider vs Apr-2024.
- **Decision substance**: property due-diligence for exactly the Dubai investor audience that loved the heat twin; insurer/broker conversations; civil-defense education. Screening-grade HAND/flow-accumulation method on Copernicus GLO-30 DEM (open), ERA5/rainfall IDF context, OSM structures.
- **Honest limits to publish**: not a hydraulic model; ignore drainage infrastructure; validation vs satelliteobserved extent only. Say so on the page.

### Why #2 (c): Shadow/shade walkability
- Direct extension of the ward-scale 3D urban-heat twin (same CityJSON/three.js assets — near-zero marginal effort).
- 2025–26 hooks are hot literally: ESOTC 2025 records (July 2025 = Europe's 2nd-most-severe heatwave on record; LST >50°C 28 Jun 2025; 2025 = 3rd-warmest year globally). Wet-bulb discourse keeps growing (Hajj/Europe heat deaths).
- Differentiates from ShadeMap (geometry-only) by weighting shade with humidity/heat index → "coolest walking route at 15:00 in June" — educational AND operational (schools, outdoor workers, walkability audits → sellable to municipalities/developers).
- Beauty: animated shadow sweep across 3D buildings = the nullschool-class visual.
- Whitespace check: NO viral consumer wet-bulb/heat calculator exists — the space is institutional tools (OSHA Outdoor WBGT Calculator, NWS prototype) and B2B lead-gen (Perry Weather), while virality lived in journalism (WaPo WBGT piece; HN wet-bulb threads at 137/112 pts). A consumer-grade, personal-location heat/shade tool is an open slot.
- All inputs open: OSM buildings, Copernicus DEM, ERA5/thermal comfort data, solar-position math.

### #3 (f) CBAM explorer — build it as the B2B bridge, cheaply
- Definitive regime **live since 1 Jan 2026** + newly adopted **50-tonne de-minimis** = peak confusion → search demand NOW; India widely cited among the most-exposed exporters (steel, aluminium).
- This is Website Grader grammar applied to trade: CN code + tonnage + origin → tariff estimate card, exportable PDF/PNG, gated deeper report = lead gen for exactly PwC-partner-type buyers. Deterministic math Delta can defend line-by-line.
- Lower mass virality; LinkedIn/trade-press virality instead. Pair with a goods-flow visualization (EU↔India/UAE chord/sankey) for the wow factor.

### Recommended package
Launch **(h) + (c)** as the two new Interactive Tools (one fear/event-driven, one utility/education — covering both arousal pathways), and quietly upgrade the existing CBAM calculator into the **explorer** format. Sequence: (c) first (cheapest, reuses twin, evergreen) → (h) timed before UAE pre-monsoon (May–Jun) → (f) refresh aligned to CBAM reporting deadlines.

---

### Free-tool → funding evidence base (investor-deck ready)
- **First Street**: years of free Flood Factor (142M+ properties) → Realtor.com/Redfin/Zillow distribution → PBC spinoff (29 Feb 2024, Galvanize + Congruent) → **$46M oversubscribed Series A, Jul 2024**.
- **Electricity Maps**: bootstrapped free live map since 2016 → ~10M API requests/day → **€5M (May 2024)**; revenue doubled yearly pre-raise.
- **Watch Duty**: donation-funded surge → **$11.4M raised in 2025 (2× YoY), 111,124 paying members**, enterprise integrations inbound.
- Counter-cases **Jupiter (~$100M)** and **One Concern (~$120M)**: never built public tools — free tools are sufficient-but-not-necessary for funding.
- Pattern: free tools precede funding when they OWN unique data and convert attention into distribution; beauty alone converts neither.

## (d) RISKS / FAILURE MODES
1. **Bathtub-model backlash** — Sanders et al. 2024 ("Flooding is Not Like Filling a Bath") documents systematic biases of simple inundation maps (coastal AND pluvial). Even NOAA's own Sea Level Rise Viewer concedes the genre's limits on-tool: it flags "hydrologically unconnected areas that may also flood", says it does "not accurately capture detailed hydrologic and hydraulic features such as canals, ditches, and stormwater [infrastructure]", and warns "there is not 100 percent confidence in the elevation data or mapping process. It is important not to focus on the exact extent of inundation" (coast.noaa.gov/slr). Candor of exactly this kind — in Delta's voice — is the moat. Mitigate: connectivity-aware routing, explicit exclusions (drainage, defenses), published validation stats.
2. **Methodology-opacity revolt** — First Street's scores were pulled by Zillow (~73k NC listings, Nov 2025) amid accuracy disputes; users complained scores were unchallengeable. Mitigate: versioned methods page, uncertainty bands, a "challenge our number" form. Irony marker: the SAME free-tool strategy produced First Street's $46M Series A — distribution cuts both ways. Turn the industry's scar tissue into Delta's moat.
3. **Viral-but-shallow trap** — "if all ice melted" maps get decade-long reposts AND scientist scorn; investors discount spectacle. Scientists actively push back on doom-framing (Michael Mann via Yale Climate Connections; LiveScience on 'climate doomers'). Every Delta tool needs a stated decision-use and an error bar, or don't ship.
4. **Performance collapse on spikes** — hug-of-death risk on HN/Reddit/event days; Cloudflare measured Portugal's internet traffic fall 50% during the blackout (surges are real and abrupt). Verified specifics: FIRMS enforces a hard limit of **5,000 transactions/10-min per MAP_KEY** (official API docs) with a community-reported outage 27 Nov 2025 (r/gis); the Cara platform's viral spike cost its founder **$96k in one month of Vercel functions** (HN 40618220). Counter-example: Watch Duty sustained 100k req/s at 100% uptime via in-kind Google/AWS/Fastly/Mapbox support — and its annual report attributes what DID crash during the LA fires to "the government alerts and contracted software vendors", not itself. Mitigate: static-first (already Astro), pre-rendered tiles per city, CDN cache-everything, queue heavy computation, graceful "at capacity" card that still lets users screenshot.
5. **Licence blowups** — canonical: Google Maps' June–July 2018 pay-as-you-go shift raised prices ~**1,400%** ($0.50→$7 per 1k loads) with mandatory API keys + billing (MapTiler, TPXimpact); a second shock landed 1 Mar 2025 (per-API credit split). Verified cheat-sheet: Copernicus Sentinel data "free, full and open" including commercial use; VIIRS/MODIS free; ECOSTRESS open with Earthdata Login; Global Solar Atlas CC BY 4.0 WITH binding additional terms (attribution required, no WB/Solargis logos); OSM-derived data stays ODbL share-alike regardless of tile vendor (Mapbox↔OSM attribution disputes are documented); FIRMS redistribution asks users to follow NASA guidelines and replicate/link the LANCE disclaimer (earthdata.nasa.gov). Prefer MapLibre + OSM/Protomaps basemaps; **UAE NCM radar is NOT open — never build the flood tool on it**.
6. **Maintenance rot** — Project Sunroof died of stale data even at Google. Every number needs a visible "last updated" + refresh budget; a wrong tariff or irradiance number costs more credibility than no number.
7. **Fear-fatigue/doomism** — constant catastrophe framing depresses action and invites mockery; pair every shock metric with an agency frame ("what works: shaded corridors, retention ponds").
8. **Event-dependency** — traffic is spiky (Watch Duty, EM). Capture value during spikes: email capture on share cards, evergreen utility between events, pre-written event-mode pages.

---

## (e) SOURCES (grouped)

**Case studies — origin/virality**
- Nullschool: https://www.washingtonpost.com/news/capital-weather-gang/wp/2013/12/17/a-gorgeous-mind-blowing-visualization-of-the-worlds-winds/ ; https://slate.com/technology/2013/12/global-wind-map-cameron-beccario-s-visualization-of-world-weather-patterns.html ; https://earth.nullschool.net/about ; https://github.com/cambecc
- Windy: https://community.windy.com/topic/4647/windy-opens-its-first-sales-position ; https://www.windy.com/subscription ; https://community.windy.com/topic/11841/
- Ventusky: https://www.ventusky.com/about
- Zoom Earth: https://zoom.earth/ ; https://apps.apple.com/us/app/zoom-earth-weather-forecast/id1531561063
- Subagent-A hard numbers: https://github.com/cambecc/earth (6,586 stars) ; https://en.wikipedia.org/wiki/Windy_(weather_service) ; https://news.ycombinator.com/item?id=28486389 (Windy 1,052pts) ; https://news.ycombinator.com/item?id=13559581 (Ventusky 849pts) ; https://en.wikipedia.org/wiki/Watch_Duty ; https://sealevel.climatecentral.org/news/press-release/ (Surging Seas launch, 14 Mar 2012) ; https://www.bbc.com/news/science-environment-68839043 (Dubai cloud-seeding + 256mm) ; https://www.washingtonpost.com/pr/2020/05/04/read-the-washington-post-stories-that-won-2020-pulitzer-prize/
- ShadeMap: https://news.ycombinator.com/item?id=30532286 ; https://news.ycombinator.com/item?id=30639160 ; https://news.ycombinator.com/item?id=40528045 ; https://tedpiotrowski.svbtle.com/spring-update-on-shade-map ; https://github.com/ted-piotrowski/shademap-examples
- Watch Duty: https://abc7news.com/post/watch-duty-app-founded-bay-area-sees-record-downloads-socal-fire-information/15784521/ ; https://www.thewellnews.com/weather/watch-duty-fire-tracking-app-used-by-millions-expands-to-help-monitor-dangerous-floods/ ; https://mastersofscale.com/episode/becoming-the-go-to-app-for-natural-disaster-tracking/ ; https://www.watchduty.org/
- FIRMS/LA fires: https://firms.modaps.eosdis.nasa.gov/ ; https://svs.gsfc.nasa.gov/5568/ ; https://www.earthdata.nasa.gov/data/tools/firms
- Project Sunroof: https://sunroof.withgoogle.com/ ; https://news.ycombinator.com/item?id=34699395 ; https://www.energysage.com/solar/google-project-sunroof-overview/ ; https://www.eesi.org/articles/view/googles-project-sunroof-could-help-unlock-solar-power-in-the-united-states ; https://blog.google/products-and-platforms/products/maps/project-sunroof-new-data-explorer-tool/
- NYT hometown: https://www.nytimes.com/interactive/2018/08/30/climate/how-much-hotter-is-your-hometown.html ; https://www.reddit.com/r/dataisbeautiful/comments/9egubr/

**Dubai / Valencia floods**
- https://mapping.emergency.copernicus.eu/activations/EMSR773/ ; NOTE: an earlier draft cited EMSR845 as the Dubai activation — **wrong**: EMSR845 is "Flood in Mexico" (Oct 2025), verified directly on CEMS. No UAE activation exists (see GCC audit §Flood context).
- Academic Dubai flood mapping: https://www.researchgate.net/publication/401532155 ("From inundation to recovery: mapping flood footprints in Dubai after the April 2024 storm")
- https://www.bbc.com/news/science-environment-68839043 (Al Ain ~256mm/24h figure) ; https://www.bbc.com/news/science-environment-68897443 ("75 years since records began" line lives here — fact-checker split the two facts across these two BBC URLs); NCM's later precise figure was 254.8mm at Khatm Al Shakla, Al Ain
- https://www.mdpi.com/2072-4292/17/13/2145 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC12066247/ ; https://www.guycarp.com/insights/2024/11/october-2024-dana-floods-spain.html ; https://remote-sensing.org/satellite-data-for-disaster-response-insights-from-the-valencia-floods/

**Blackout / Electricity Maps**
- https://www.entsoe.eu/publications/blackout/28-april-2025-iberian-blackout/ ; https://en.wikipedia.org/wiki/2025_Iberian_Peninsula_blackout ; https://blog.cloudflare.com/how-power-outage-in-portugal-spain-impacted-internet/ ; https://www.iea.org/commentaries/the-iberian-blackout-has-highlighted-the-critical-importance-of-electricity-security
- https://www.esgtoday.com/climate-tech-startup-electricity-maps-raises-5-million-to-scale-electricity-optimization-solutions/ ; https://www.electricitymaps.com/resources/case-studies/google-reroutes-compute-to-chase-clean-energy-around-the-world ; https://www.electricitymaps.com/grid-in-review-2025/spain

**Investor / lead-gen**
- First Street: https://www.nytimes.com/2025/11/30/climate/zillow-climate-risk-scores-homes.html ; https://esal.us/first-street-foundation/ ; https://firststreet.org/
- Jupiter: https://www.axios.com/2021/10/21/jupiter-intelligence-raises-54million-climate-risk ; https://energizecap.com/news-insides/why-were-continuing-to-invest-in-jupiter-intelligence (sic — energizecap.com/news-insights/) ; https://www.jupiterintel.com/blog/jupiter-announces-54-million-in-new-funding
- Engineering-as-marketing: https://outgrow.co/blog/hubspot-website-grader-case-study ; https://growthmethod.com/engineering-as-marketing/ ; https://thegrowthmind.substack.com/p/engineering-as-marketing
- Fathom: https://www.fathom.global/academic-papers/fathomdem-research-paper/ ; https://zenodo.org/records/14511570 ; https://www.fathom.global/
- Climate Central media model: https://www.climatecentral.org/climate-matters/climate-reporting-resources ; https://app.climatecentral.org/coastal-risk-finder/media-professional

**Patterns / psychology**
- https://journals.sagepub.com/doi/10.1509/jmr.10.0353 (Berger & Milkman)
- https://datajournalism.com/read/handbook/two/working-with-data/experiencing-data/data-visualisations-newsroom-trends-and-everyday-engagements
- https://stephanieevergreen.com/data-viz-for-social-media/

**Failure modes**
- NOAA SLR Viewer caveats: https://coast.noaa.gov/slr/ ; First Street structure pivot: https://firststreet.org/press/first-street-announces-new-structure-investment-partners-and-advisor
- https://par.nsf.gov/servlets/purl/10640458 (Sanders 2024, bathtub bias) ; https://pubmed.ncbi.nlm.nih.gov/31664024/ (Kulp & Strauss 2019) ; CoastalDEM v3.0 white paper (2024, climatecentral.org hub link in fact base)
- Spectacle example: https://www.reddit.com/r/MapPorn/comments/137ic2o/

**Open-data building blocks (verified Aug 2026)**
- EGMS: https://land.copernicus.eu/en/products/european-ground-motion-service ; https://www.sciencedirect.com/science/article/pii/S0034425726001598
- CBAM: https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism_en ; https://www.dehst.de/EN/Topics/CBAM/CBAM-definitive-regime-2026/cbam-definitive-regime-2026_artikel.html ; https://icapcarbonaction.com/en/news/eu-adopts-simplifications-cbam-rules-ahead-compliance-phase-starting-2026 ; https://www.reedsmith.com/our-insights/blogs/viewpoints/102lr9t/what-you-need-to-know-as-cbam-simplification-comes-into-effect/
- Solar: https://globalsolaratlas.info/ ; https://openei.org/wiki/Global_Solar_Atlas ; https://gee-community-catalog.org/projects/gsa/
- Dust/AQ: https://charts.ecmwf.int/products/aerosol-forecasts ; https://atmosphere.copernicus.eu/accessing-atmospheric-composition-forecasts-made-easy ; https://link.springer.com/article/10.1007/s11356-024-32950-6
- Heat hooks: https://climate.copernicus.eu/esotc/2025/key-events-overview ; https://climate.copernicus.eu/european-summer-2025-hot-west-and-south-dry-southeast ; https://wmo.int/news/media-centre/european-state-of-climate-2025-record-heatwaves-from-mediterranean-arctic-while-glaciers-shrink-and ; https://defence-industry-space.ec.europa.eu/global-and-european-temperatures-2025-ranked-third-highest-record-copernicus-report-finds-2026-01-15_en

**Investor / lead-gen deep-dive (Subagent-B primary sources)**
- First Street: https://www.cnbc.com/2020/08/26/every-us-home-gets-flood-risk-score-and-many-are-at-higher-risk.html ; https://www.realtor.com/flood-risk/ ; https://www.housingwire.com/articles/redfin-joins-realtor-com-in-displaying-flood-data/ ; https://www.redfin.com/news/redfin-users-interact-with-flood-risk-data/ ; https://www.redfin.com/news/how-homebuyers-engage-with-climate-risk-data/ ; https://firststreet.org/press/first-street-finalizes-a-46-million-series-a-to-scale-breakthrough-advancements-in-physical-climate-risk-modeling ; https://www.axios.com/2024/07/25/climate-risk-company-raises-46-million
- One Concern: https://techcrunch.com/2021/06/03/one-concern-sompo/
- Electricity Maps funnel: https://tech.eu/2024/05/08/electricity-maps-raises-eur5m-for-time-optimised-energy-usage/ ; https://www.electricitymaps.com/resources/updates
- Climate TRACE / Carbon Monitor: https://climatetrace.org/news/climate-trace-unveils-open-emissions-database-of-more-than ; https://climatetrace.org/news/more-than-70000-of-the-highest-emitting-greenhouse-gas ; https://www.nature.com/articles/s41597-020-00708-7
- Watch Duty annual data: https://www.latimes.com/business/story/2025-01-08/with-l-a-on-alert-wildfire-app-watch-duty-adds-600-000-users-overnight ; https://www.watchduty.org/blog/2025-annual-report ; https://www.watchduty.org/blog/watch-duty-annual-overview-2025-fire-alerts
- Eng-as-marketing canon: https://saasclub.io/podcast/rand-fishkin-moz-2/ ; https://amplify.com/news/amplify-acquires-desmos-curriculum-to-build-the-future-of-math-instruction-desmos-calculators-to-remain-independent-and-free-to-all/ ; https://37signals.com/podcast/sell-your-by-products-season-2/
- Windy business: https://www.forbes.com/sites/forbesinternational/2017/02/06/can-a-czech-millionaire-sell-wind-and-snow/ ; https://getlatka.com/companies/windy.com
- Failure modes: https://ss2.climatecentral.org/ (levees-unmodeled-outside-US caveat) ; https://www.livescience.com/planet-earth/climate-change/action-on-climate-change-faces-new-threat-the-doomers-who-think-its-too-late-to-act ; https://yaleclimateconnections.org/2023/09/renowned-climate-scientist-michael-e-mann-on-what-doomers-get-wrong/ ; https://news.ycombinator.com/item?id=40618220 (Cara $96k Vercel month) ; https://firms.modaps.eosdis.nasa.gov/api/map_key/ (5k txn limit) ; https://www.reddit.com/r/gis/comments/1p7vet5/nasa_firms_is_down_11272025/ ; https://community.openstreetmap.org/t/mapbox-does-not-satisfy-attribution-requirements/108134 ; https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ
- Licences: https://ecostress.jpl.nasa.gov/data ; https://www.copernicus.eu/en/access-data ; https://globalsolaratlas.info/support/terms-of-use

*Working files: research/my-findings.md · raw results research/.firecrawl/*.json · subagentA-case-studies.md (~88 URLs) · subagentB-investor-failures.md (47 evidenced claims, 86 URLs) — both merged 2026-08-23.*

## AUDIT LOG (2026-08-23)
All live verification ran through Firecrawl CLI + zero-quota curls (the session `web_search` tool was non-functional — missing DEEPSEEK_API_KEY credential).

Corrections made during audit (things first drafted from memory or mis-attributed):
1. Project Sunroof verdict downgraded from 'shut down' to **'live but abandoned'** — no official shutdown statement exists.
2. Watch Duty corrected to its own independent 501(c)(3); secondary figures ($6M/20M users) superseded by its primary annual report ($11.4M raised, 111,124 paying members, 16.8M yearly actives).
3. Desmos–Amplify acquisition year corrected to **2019**.
4. Wet-bulb premise corrected: no viral consumer calculator exists — institutional (OSHA/NWS) + B2B (Perry Weather); virality belonged to journalism.
5. Zillow–First Street removal attribution softened to "accuracy complaints" (contemporaneous reporting varies on who raised them).
6. Nullschool inspiration reworded to corroborated form ('an earlier US-only wind map', hint.fm/wind exists) rather than asserted biography.
7. EGMS scope stated precisely: Copernicus participating states — EU-27 + UK, Norway, Iceland (copernicus.eu).
8. Google Maps pricing crisis now event-verified (MapTiler/TPXimpact: $0.50→$7 per 1k loads ≈ 1,400%, Jun–Jul 2018; second shock 1 Mar 2025) rather than memory-based.
9. FIRMS rate limit verified at official docs: 5,000 transactions/10-min per MAP_KEY; Nov-27-2025 outage is community-reported only.
10. Climate Central's +42% local-TV figure flagged as the org's own claim.
11. First Street nonprofit-era grant totals confirmed ABSENT after multiple query variants — treated as unknown, not zero; structural pivot dated to 29 Feb 2024 via primary press release (PBC; Galvanize, Congruent).
12. NOAA Sea Level Rise Viewer's own bathtub caveats added as the strongest authority for failure-mode #1 — a US government tool conceding the same criticisms aimed at Climate Central.
13. **[External audit, parent session] EMSR845 mis-attribution FIXED throughout this file**: earlier drafts tied "EMSR845" to the Apr-2024 Dubai floods. Direct probe of mapping.emergency.copernicus.eu confirms **EMSR845 = "Flood in Mexico" (activated 13 Oct 2025)**; no Copernicus EMS rapid-mapping activation exists for the UAE event (GCC audit independently verified absence across the 71-activation 2024 list; EMSR724 unrelated). Case-study row + archetype-(h) rationale + sources corrected accordingly; validation route re-specified to self-derived Sentinel-1 extents via CDSE cross-checked against the ~23.8 km² academic mapping.

Evidence tiers used throughout: [P] primary/maker/official · [S] single reputable secondary press · [C] community-reported (HN/Reddit/Facebook) · [N] absent-evidence register (twice-checked, treated as unknown): Sunroof discontinuation statement; NYT/WaPo analytics; Climate Central tool-level traffic; FIRMS request volumes; EM blackout-window visitors; any Dubai/Valencia interactive flood tool (none existed).
