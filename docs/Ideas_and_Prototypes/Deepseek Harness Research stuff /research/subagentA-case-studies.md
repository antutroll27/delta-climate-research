# Case Studies: Virality & Attention for Interactive Geospatial/Climate Web Tools (2015–2026)

Research date: August 2026. Method: Firecrawl web search (~30 queries phase 1; 4 carefully-spaced queries phase 2) + HN Algolia API + Wikipedia API + GitHub API + plain-curl scrapes. NOTE: the harness `web_search` tool was unavailable throughout (session missing DEEPSEEK_API_KEY config), so firecrawl CLI + zero-quota HTTP APIs were used exclusively. Numbers are cited to sources; anything unverified is explicitly marked **not found**.

## Summary Table

| Tool | Year(s) | What drove virality | Evidence (numbers + source refs) | Tech | Monetizable substance? |
|---|---|---|---|---|---|
| **earth.nullschool.net** (Cameron Beccario) | 2013–present | Beauty/novelty first ("mesmerizing"); then personal relevance + fear during Typhoon Haiyan (Nov 2013) when the map rendered the superstorm live; shared by met enthusiasts & journalists | Slate & Business Insider wrote it up within weeks of launch (Dec 2013) [1][2]; maker's own FB page posted Haiyan render ("Rendering of Typhoon Haiyan is appropriately broken…") [3]; HN: 153 pts Dec 2013 [4], 115 pts Feb 2014, 438 pts Sep 2016 [5], still resurfacing (83 pts Aug 2026) [6]. Repo cambecc/earth: **6,586 stars**, created 4 Nov 2013 [7] | Hand-built JavaScript/canvas; side project "to teach himself JavaScript," inspired by the US-only hint.fm wind map; detailed maker interview on Data Stories ep.137 [1][8][78] | No donations/Patreon found on site; about page offers a licensing contact and he incorporated Nullschool Technologies Inc.; official mobile app announced 2026 [8][9]. Monetization: minimal/licensing-only — largely a labor of love |
| **Windy.com** (Ivo Lukačovič) | 2014–present | Utility + beauty during hurricanes; wind animation forked from Beccario's open-source earth [10] | Founder post: "**up to 6 millions users a day (durring hurricanes)**" [11]; ~800,000 people/day in CAMS partnership article [12]; 300k users/day & 6 staff as of May 2018 [10]; HN front-page x3: **1,052 pts (2021)** [13], 580 pts (2017), 387 pts (2023) | Derivative of open-source earth; multi-model (ECMWF 9km, ICON, GFS…) [10] | **Yes — full business**: freemium Premium ($25.99→$34.99/yr by 2025) [14], paid Windy API tier separate from Premium [15], B2B partnerships (CAMS) [12]; founder (Seznam.cz billionaire) funds it personally (Forbes 2017) [16] |
| **Ventusky** (InMeteo, CZ) | 2017–present | Same beauty-of-wind genre as Windy/nullschool; global precipitation radar ("one of the first websites in the world" w/ worldwide precip view) [17] | HN: **849 pts, Feb 2017** [18]; iOS app popular after Dark Sky shutdown [17]; Android app **1M+ downloads** on Google Play [82]. Website traffic: not found | Web map w/ 50+ layers; stack details not found | Partially: free web/app + paid app features (App Store) [17]; no API found |
| **ShadeMap.app** (Ted Piotrowski) | 2021–present | Personal utility → spectacle: sun/shadow simulation over 3D terrain anywhere; used by photographers, filmmakers, realtors, solar, van/RV planners | Show HN "Every mountain, building and tree shadow mapped for any date/time": **685 pts, May 30 2024** [19]; re-posted **247 pts Aug 2026** [20]; "Shade Map Pro" launch 63 pts Mar 2022, maker cites real-estate sales as paying use case [21]; r/Filmmakers how-to thread [22] | MapLibre GL + 3D terrain; LiDAR-derived tree shadows (int16 PNG tiles to cut storage) [19][23] | **Yes**: Pro subscriptions + commercial ShadeMap API ("shademap-examples: Use cases for ShadeMap API": bus-route sunlight, solar siting) [23][24] |
| **Climate Central – Surging Seas / Risk Finder / Coastal Risk Finder** | 2012–present | Fear + local relevance: type an address, see what sea level rise floods; built-for-media visuals drive local TV pickup | Launched **Mar 14, 2012** with report "Global warming doubles extreme coastal flood risk"; ~5M residents below 4-ft surge level [25]; self-described "first interactive online map presenting sea level and coastal flood risk for the entire contiguous U.S." [26]; journalist program w/ custom datasets; Climate Matters network linked to a **42% increase** in climate-contextualized local TV segments [27][28]. Site traffic: not found | Web interactives (ss2.climatecentral.org, app.climatecentral.org); stack not found | Non-profit, philanthropy-funded; monetization = impact, not revenue (free tools + free media partnerships); specific grant amounts not found |
| **Google Project Sunroof** | 2015–~2023 (stagnant); site still up 2026 | Novelty + savings: "how much would solar save on MY roof"; Google brand amplification | Launch HN Aug 2015: **389 pts** [29]; expanded Boston/SF/Fresno → **43M homes covered** [30]; Data Explorer for cities (Oct 2018) [31]; second HN wave Feb 2023 (**176 pts**) around "**Project Sunroof being shut down**… empty field… haven't updated data in ages" [32]; EnergySage notes stale data/changelog [33]. Official shutdown announcement: **not found** — status 2026 = live but effectively unmaintained [30][32][33][34] | Google 3D aerial imagery + shading algorithms + weather data; Carl Elkin's 20%-time project [30] | Lead-gen: results funnel users to local solar installer listings (stated purpose: facilitate purchase/installation) [30] — lead-gen model Google quietly deprioritized |
| **NASA FIRMS fire map** (+ Worldview/SVS) | long-running; spikes Jan 2025 (LA), Jun 2023 (Canada smoke) | Fear/utility in live disaster; TV meteorologists & NASA social accounts route public to FIRMS when smoke hits home | NASA Earth FB push during CA fires incl. Jan 2025 [35]; NASA SVS published dedicated "Overview Maps of 2025 Los Angeles Fires" (Palisades/Eaton) [36]; TV met Ellen Bacca publicly recommending FIRMS to viewers [37]; NASA itself spotlighted Direct Relief's use of FIRMS/satellite data during the LA fires (Aug 2025) [77]. Public traffic/demand numbers or outage reports during Jan 2025 or 2023 Canada smoke: still **not found** | MODIS+VIIRS near-real-time fire detections; free API (key required); GEE dataset mirror [38] | Free government system (NASA LANCE); no monetization; enables downstream research/commercial use |
| **Watch Duty** (nonprofit app) | 2021–present | Life-safety utility + distrust of official channels; volunteers relaying radio scanners; word-of-mouth exploded in Jan 2025 LA fires | Jan 2025 Palisades/Eaton fires: **>1M downloads in 24h**, ~7M active users, top iOS free chart (ABC7) [39]; Wikipedia: "downloaded millions of times… most popular free downloads" [40]; **20M+ users**, **~$6M grants+donations in 2025**; floods added Jun 2026, all 50 states Dec 2025 [41][40]; Masters of Scale episode [42] | Interactive map on OpenStreetMap data + volunteer "citizen information officers" + radio-scanner sourcing [40] | Donations + grants (501c3; $1–2M campaign after LA fires) [43]; paid professional tier for firefighters/emergency managers (fire-growth models, critical infrastructure) [40] |
| **Zoom Earth** (Neave Interactive / Paul Neave, UK) | relaunch as live weather map; big since ~2020 | Live global satellite loop + hurricane tracking = event spectacle (storms, wildfires); zero-friction no-login site | HN: **399 pts, Jul 2020** [44]; consumer groups recommend it for storm tracking [45]; Android app shows **5M+ downloads** on Google Play [46]; imagery updated every 10 min. Web traffic counts: not found | Live satellite composites (GOES/Meteosat/Himawari) + overlays; solo indie dev (also Webcam Toy etc.) [46][47] | Yes: consumer subscriptions billed monthly/annually per its Terms [48] (+ likely ads); revenue scale not found |
| **NYT "How Much Hotter Is Your Hometown Than When You Were Born?"** | Aug 2018 | Pure personalization: birth year + hometown → days above 90°F across your lifetime; identity/nostalgia/share-your-number mechanic | Widely syndicated/recommended by AGU-adjacent educators, UGA extension, heat-health portals [49][50][51]; Reddit r/dataisbeautiful thread [52]. NYT internal traffic/share figures: not found | Interactive w/ NOAA station data; methodology (days ≥90°F, observed + projected) explained in-piece [49] | News-subscription driver (personalized-climate genre playbook); indirect only |
| **WaPo "2°C: Beyond the Limit"** | 2019 | Localized fear: identified global hot spots already at +2°C using new temperature-data analysis; extreme craft → awards | Won **2020 Pulitzer Prize for Explanatory Reporting** [53]; Online Journalism Awards finalist (2020) [54]; SEnviro award for "pioneering the use of temperature data" [55]. Traffic/share numbers: not found | Data-driven series w/ custom temperature analysis & maps [55] | Subscription news; prestige→subscriber model |
| **Heat interactives 2024–2026** (wet-bulb explainers; Europe June–July 2025) | 2023–2026 | Danger framing (wet-bulb = survivability limit) + record June 2025 W-Europe heatwave; rapid-attribution maps became quotable graphics | WaPo interactive "Where dangerous heat is surging" (approx WBGT, Sep 2023): HN 47 pts [56]; wet-bulb topic repeatedly front-paged (137 pts 2023; 112 pts 2022) [57]; WaPo 2024 wet-bulb op-ed [58]; WMO/Copernicus: June 2025 hottest June on record for W. Europe [59][60]; ClimaMeter publishes rapid attribution maps per event [61]; the wet-bulb 'calculator' layer is government-run (OSHA's official Outdoor WBGT Calculator [83], NWS prototype) plus commercial lead-gen tools (Perry Weather's free WBGT calculator) rather than a single viral hit [84]. Share counts: not found | Copernicus ERA5 graphics; ClimaMeter analog-past-vs-present simulations; NWS WBGT prototype grids [62] | Institutional/media (Copernicus free; WaPo/NYT paywalled); no standalone product monetization found |
| **Dubai/UAE floods (Apr 16, 2024)** | 2024 | Spectacle + controversy: ~2 years' rain in a day, flooded DXB airport, submerged supercars, cloud-seeding conspiracy debate made satellite images go viral | Al Ain **256mm in 24h** (BBC) [63]; EU Space/Copernicus image-of-day ">250mm in <24h" Apr 16 2024 [64]; CIRA event page (heaviest in 75 years) [65]; NASA before/after imagery via CNBC [66]; MyRadar "did cloud seeding cause the Dubai disaster?" video [67]. Interactive flood tool that captured the moment: **not found** — static satellite images & phone videos won (only risk-industry event responses like JBA's rainfall maps exist) | Sentinel/via Copernicus, CIRA RAMMB loops + consumer radar apps | None captured value; Copernicus/CIRA are free public assets |
| **Valencia DANA floods (Oct 29, 2024)** | 2024 | Grief + anger (~220+ deaths) + alert-timing blame debate → before/after satellite comparisons & rain-radar screenshots spread | Copernicus EMS activation **EMSR773** (rapid flood mapping, activated 29 Oct 2024) [68]; Sentinel-1 flooded-area maps in EO communities [69]; Landsat 8 before (Oct 5)/after (Oct 30) comparison widely republished [70]; peer-reviewed follow-ups (MDPI RS 2025) [71]; fact-checker Maldita documented DANA imagery/hoaxes accumulating massively on TikTok (219 dead as of Nov 8, 2024) [81]. Consumer interactive that captured it: **not found** — static imagery + radar screenshots won | Copernicus Sentinel-1/2, Landsat, AEMET radar screenshots | None; free public EO infrastructure did the work |
| **Electricity Maps** (live CO₂ grid map) | ~2017–present | Real-time national pride/anxiety ("is my grid clean right now?"); Apr 28, 2025 Iberian blackout put grid dashboards in the spotlight | Blackout context: ENTSO-E report [72]; Cloudflare measured Portuguese internet traffic −~50% during outage (even map sites went dark with users) [73]; EM's own "Grid in review 2025: Spain" documents **15 GW lost in 5 seconds (=60% of demand)** at 12:33 CEST Apr 28, ~10h interruption [74]. Funnel model verified on their own platform/API page ("enterprise-grade API… Get started for free") [77]. EM-specific traffic-spike numbers during blackout: still **not found** (no EM blog post about the blackout exists in their sitemap). General attention: HN 248 pts (Aug 2023) [75], 143 pts (2022), 129 pts (2018) | Free live map (app.electricitymaps.com) fed by ENTSO-E + gap-filling [76] | Yes — classic free-map-as-funnel: free consumer map drives paid API/data platform sold to enterprises; pricing/revenue not found |

### Cross-cutting observations
- Two virality engines recur: (a) beauty/novelty (nullschool, Ventusky, Zoom Earth, Electricity Maps' aesthetic) and (b) personal relevance under threat (address-input flood/fire/heat tools, Watch Duty, FIRMS referrals). Biggest sustained spikes come when (a)-tools are pointed at (b)-events: Haiyan→nullschool, hurricanes→Windy, LA fires→Watch Duty.
- Monetizable substance correlates with utility, not beauty: Windy (premium+API), ShadeMap (pro+API), Zoom Earth (subscriptions), Electricity Maps (API) monetize; pure-beauty nullschool never did beyond licensing inquiries; disaster nonprofits monetize trust (donations + pro tiers).
- Event traffic is real but rarely disclosed: only Windy's founder (6M/day during hurricanes) and Watch Duty (1M downloads/24h) have public spike numbers; FIRMS, Electricity Maps, Zoom Earth spike numbers are not found publicly.

---

## Sources

1. Slate — Global wind map: Cameron Beccario's visualization (Dec 2013): https://slate.com/technology/2013/12/global-wind-map-cameron-beccario-s-visualization-of-world-weather-patterns.html
2. Business Insider — Wind Maps of the Earth Are Totally Mesmerizing (Dec 2013): https://www.businessinsider.com/wind-maps-of-the-earth-2013-12
3. EarthWindMap Facebook post — Typhoon Haiyan render: https://www.facebook.com/EarthWindMap/photos/rendering-of-typhoon-haiyan-is-appropriately-broken-people-lost-everything-pleas/1426185300948529/
4. Hacker News — A visualization of global weather conditions, 153 pts, Dec 17 2013: https://news.ycombinator.com/item?id=6924854
5. Hacker News — A global map of wind, weather, and ocean conditions, 438 pts, Sep 2 2016: https://news.ycombinator.com/item?id=12415488
6. Hacker News — Earth.nullschool.net, 83 pts, Aug 14 2026: https://news.ycombinator.com/item?id=49299364
7. GitHub — cambecc/earth (6,586 stars): https://github.com/cambecc/earth
8. earth.nullschool.net/about.html: https://earth.nullschool.net/about.html
9. Cameron Beccario on X — official Nullschool app announcement (2026): https://x.com/cambecc
10. Wikipedia — Windy (weather service): https://en.wikipedia.org/wiki/Windy_(weather_service)
11. Windy Community — Windy opens its first sales position (Lukacovic: up to 6M users/day during hurricanes): https://community.windy.com/topic/4647/windy-opens-its-first-sales-position
12. Windy Articles — CAMS Signs Partnership with Weather Application Windy (~800k people/day): https://www.windy.com/articles/7924
13. Hacker News — Windy.com, 1,052 pts, Sep 10 2021: https://news.ycombinator.com/item?id=28486389
14. Windy Premium subscription page: https://www.windy.com/subscription
15. Windy Community — API access is a separate paid tier: https://community.windy.com/topic/34450/does-any-api-access-come-with-premium-account
16. Forbes — Can A Czech Millionaire Sell Wind And Snow? (Feb 2017): https://www.forbes.com/sites/forbesinternational/2017/02/06/can-a-czech-millionaire-sell-wind-and-snow/
17. Ventusky about page + App Store listing: https://www.ventusky.com/about ; https://apps.apple.com/us/app/ventusky-weather-forecast/id1280984498
18. Hacker News — Ventusky – Weather data visualization, 849 pts, Feb 3 2017: https://news.ycombinator.com/item?id=13559581
19. Hacker News — Show HN Every mountain, building and tree shadow mapped, 685 pts, May 30 2024: https://news.ycombinator.com/item?id=40528045
20. Hacker News — Shade Map, 247 pts, Aug 12 2026: https://news.ycombinator.com/item?id=49271757
21. Hacker News — Shade Map Pro, 63 pts, Mar 2 2022: https://news.ycombinator.com/item?id=30532286
22. Reddit r/Filmmakers — Shade Map App: https://www.reddit.com/r/Filmmakers/comments/1i8vsga/shade_map_app/
23. GitHub — ted-piotrowski/shademap-examples (Use cases for ShadeMap API): https://github.com/ted-piotrowski/shademap-examples
24. ShadeMap help/how-it-works: https://shademap.app/help/
25. Climate Central — Surging Seas press release (Mar 14, 2012): https://sealevel.climatecentral.org/news/press-release/
26. Surging Seas About — first interactive US sea-level risk map claim: https://sealevel.climatecentral.org/about
27. Climate Central — Media professionals program (Coastal Risk Finder): https://www.climatecentral.org/coastal-risk-finder/media-professional
28. Climate Central — Climate Reporting Resources (42% increase stat): https://www.climatecentral.org/climate-matters/climate-reporting-resources
29. Hacker News — Project Sunroof, 389 pts, Aug 17 2015: https://news.ycombinator.com/item?id=10073724
30. Wikipedia — Project Sunroof: https://en.wikipedia.org/wiki/Project_Sunroof
31. Google blog — Project Sunroof New Data Explorer Tool: https://blog.google/products-and-platforms/products/maps/project-sunroof-new-data-explorer-tool/
32. Hacker News — Project Sunroof, 176 pts, Feb 7 2023 (shutdown/stale-data discussion): https://news.ycombinator.com/item?id=34699395
33. EnergySage — What Is Google Project Sunroof?: https://www.energysage.com/solar/google-project-sunroof-overview/
34. EcoWatch (2026) — Google Project Sunroof overview: https://www.ecowatch.com/solar/google-project-sunroof
35. NASA Earth Facebook — FIRMS promotion during California fires: https://www.facebook.com/nasaearth/posts/as-fire-season-continues-in-california-nasa-national-aeronautics-and-space-admin/10158028852687139/
36. NASA SVS — Overview Maps of 2025 Los Angeles Fires: https://svs.gsfc.nasa.gov/5568/
37. TV meteorologist Ellen Bacca recommending NASA FIRMS during wildfires: https://www.facebook.com/EllenBaccaWOODTV/posts/wanting-a-trusted-website-to-monitor-some-of-these-fires-on-your-own-this-one-fr/1628081802219952/
38. NASA FIRMS portal + fire map: https://firms.modaps.eosdis.nasa.gov/ ; https://firms.modaps.eosdis.nasa.gov/map/
39. ABC7 News — Watch Duty sees record downloads (>1M in 24h; ~7M active users): https://abc7news.com/post/watch-duty-app-founded-bay-area-sees-record-downloads-socal-fire-information/15784521/
40. Wikipedia — Watch Duty: https://en.wikipedia.org/wiki/Watch_Duty
41. The Well News — Watch Duty expands (20M+ users; ~$6M grants+donations 2025): https://www.thewellnews.com/weather/watch-duty-fire-tracking-app-used-by-millions-expands-to-help-monitor-dangerous-floods/
42. Masters of Scale — Becoming the go-to app for natural disaster tracking: https://mastersofscale.com/episode/becoming-the-go-to-app-for-natural-disaster-tracking/
43. Watch Duty Facebook — $1–2M fundraising campaign after >1M downloads: https://www.facebook.com/watchdutyapp/posts/during-wildfires-the-watch-duty-team-is-reporting-every-update-to-keep-you-infor/1341676254679867/
44. Hacker News — Zoom Earth live satellite photos, 399 pts, Jul 20 2020: https://news.ycombinator.com/item?id=23901252
45. Facebook storm-tracking group recommendation of Zoom Earth: https://www.facebook.com/groups/708603999996081/posts/1711445463045258/
46. Zoom Earth apps (Neave Interactive): https://play.google.com/store/apps/details?id=com.neave.zoomearth ; https://apps.apple.com/us/app/zoom-earth-weather-forecast/id1531561063
47. Profile of Paul Neave / Neave Interactive: https://claudiabow.uk/2025/07/30/navigating-our-planets-weather-with-zoom-earth/
48. Zoom Earth Terms of Service (subscriptions billed periodically): https://zoom.earth/legal/terms/
49. NYT — How Much Hotter Is Your Hometown Than When You Were Born? (Aug 30, 2018): https://www.nytimes.com/interactive/2018/08/30/climate/how-much-hotter-is-your-hometown.html
50. UGA Extension write-up of the NYT interactive: https://site.extension.uga.edu/climate/2018/08/how-much-hotter-is-your-hometown-than-when-you-were-born/
51. Heat-health resource index entry for the NYT interactive: https://heathealth.info/resources/how-much-hotter-is-your-hometown-than-when-you-were-born/
52. Reddit r/dataisbeautiful thread on the NYT interactive: https://www.reddit.com/r/dataisbeautiful/comments/9egubr/how_much_hotter_is_your_hometown_than_when_you/
53. Washington Post PR — 2020 Pulitzer for Explanatory Reporting: https://www.washingtonpost.com/pr/2020/05/04/read-the-washington-post-stories-that-won-2020-pulitzer-prize/
54. Online Journalism Awards — 2C: Beyond the limit: https://awards.journalists.org/entries/2c-beyond-the-limit/
55. WaPo PR — series pioneered the use of temperature data (SEJ award): https://www.washingtonpost.com/pr/2020/08/06/washington-posts-2c-beyond-limit-series-recognized-outstanding-explanatory-reporting-by-society-environmental-journalists/
56. Hacker News — Where dangerous heat is surging, 47 pts (Sep 2023): https://news.ycombinator.com/item?id=37458861 ; https://www.washingtonpost.com/climate-environment/interactive/2023/extreme-heat-wet-bulb-globe-temperature/
57. Hacker News — Wet-bulb temperature, 137 pts (Aug 2023): https://news.ycombinator.com/item?id=37293836 ; 112 pts (Mar 2022): https://news.ycombinator.com/item?id=30527168
58. WaPo opinion — We need to change the way we think about outdoor temperatures (Jul 15, 2024): https://www.washingtonpost.com/opinions/2024/07/15/heat-waves-wet-bulb-temperature-climate-change/
59. WMO — Western Europe has hottest June on record (June 2025): https://wmo.int/media/news/western-europe-has-hottest-june-record
60. Copernicus — Record heatwave brings hottest June for western Europe: https://climate.copernicus.eu/copernicus-record-heatwave-brings-hottest-june-western-europe-during-second-warmest-june-globally
61. ClimaMeter — rapid extreme-event attribution maps: https://www.climameter.org/
62. NWS — WetBulb Globe Temperature prototype: https://www.weather.gov/tsa/wbgt
63. BBC — What is cloud seeding and did it cause Dubai flooding? (Al Ain ~256mm/24h): https://www.bbc.com/news/science-environment-68839043
64. EU Space/Copernicus image of day — Dubai floods (>250mm <24h): https://eu-space.europa.eu/components/earth-observation-copernicus/image-of-day/torrential-rainfall-and-floods-dubai-united-arab-emirates
65. CIRA Satellite Library — Dubai Flooding event: https://satlib.cira.colostate.edu/event/dubai-flooding/
66. CNBC — NASA releases satellite photos of record UAE flooding: https://www.cnbc.com/2024/04/24/dubai-flood-nasa-releases-satellite-photos-of-record-uae-flooding.html
67. MyRadar video — Did cloud seeding cause the Dubai disaster?: https://www.facebook.com/MyRadar/videos/did-cloud-seeding-cause-the-dubai-disaster/1127304271843709/
68. Copernicus EMS On-Demand Mapping — Activation EMSR773 (Valencia, Oct 29 2024): https://mapping.emergency.copernicus.eu/activations/EMSR773/
69. Sentinel-1 Valencia flooded-area mapping shared in EO communities: https://www.facebook.com/groups/759532211420925/posts/2028558681184932/
70. remote-sensing.org — Landsat before/after Valencia floods: https://remote-sensing.org/satellite-data-for-disaster-response-insights-from-the-valencia-floods/
71. MDPI Remote Sensing — Assessment of the October 2024 Cut-Off Low Event Floods: https://www.mdpi.com/2072-4292/17/13/2145
72. ENTSO-E — 28 April 2025 Iberian blackout report: https://www.entsoe.eu/publications/blackout/28-april-2025-iberian-blackout/
73. Cloudflare blog — how the power outage in Portugal/Spain impacted internet traffic: https://blog.cloudflare.com/how-power-outage-in-portugal-spain-impacted-internet/
74. Electricity Maps — Grid in review 2025: Spain (15 GW lost Apr 28, 2025): https://www.electricitymaps.com/grid-in-review-2025/spain
75. Hacker News — Electricity Maps, 248 pts, Aug 20 2023: https://news.ycombinator.com/item?id=37197903
76. Electricity Maps free live map: https://app.electricitymaps.com/map/live/fifteen_minutes

## Explicit "not found" register (verified absence, not omission)
- earth.nullschool: donation/Patreon mechanism; official user/traffic counts.
- Ventusky & Zoom Earth: website-level traffic counts (app-store scale IS now known: Zoom Earth Android **5M+** [46], Ventusky Android **1M+** [82]).
- Climate Central: tool-level traffic numbers; grant dollar amounts tied to specific tools.
- Project Sunroof: any official Google shutdown/discontinuation announcement (only third-party "effectively dead/stale" reporting).
- NASA FIRMS: traffic/outage/rate-limit incident reports during Jan 2025 LA fires or 2023 Canadian smoke events.
- NYT/WaPo: internal traffic/share analytics for the named interactives.
- Dubai & Valencia 2024: any interactive flood tool that demonstrably captured the viral moment (static satellite imagery + radar screenshots dominated instead).
- Electricity Maps: published traffic-spike figures for the April 28, 2025 blackout window (site resisted scraping; nothing indexed).

---

## Phase-2 addendum (rate-limit-adjusted pass)

After the operational warning on shared firecrawl quota, gap-filling ran on zero-quota channels first (plain curl against electricitymaps.com, which firecrawl could not render) and only 4 additional spaced firecrawl searches. New findings folded into the table above:

- **Electricity Maps business model now primary-source-verified**: their own platform page sells an "enterprise-grade API" (carbon intensity, load, day-ahead prices, cross-border flows) with a free tier — confirming the free consumer map functions as the top of a paid data-API funnel. Their sitemap contains **no blog post about the April 28 blackout**, so the rumored traffic spike remains undocumented publicly; the strongest independent proxy remains Cloudflare's measured −50% Portuguese internet traffic during the outage (i.e., most users were dark too). New grid detail from EM's Spain review: 15 GW lost in **5 seconds** (60% of demand), frequency collapse to 48 Hz, ~10h interruption, islands unaffected (~3 GW).
- **FIRMS**: NASA published a piece spotlighting **Direct Relief's operational use of satellite/FIRMS data during the January 2025 LA fires** — best available third-party usage evidence; raw traffic/outage numbers still unpublished.
- **Zoom Earth**: Google Play listing shows the Android app at **5M+ downloads** — first hard user-scale number for the product (web visits still unknown).
- **earth.nullschool**: Data Stories podcast ep.137 interview corroborates origin (side project to learn JavaScript); no donation/Patreon/funding channel surfaced anywhere — consistent with hobby/licensing-only operation.

### New sources
77. Electricity Maps — Platform/API product page (enterprise-grade API, free start): https://www.electricitymaps.com/platform/api
78. Data Stories #137 — Visualizing Earth with Cameron Beccario (interview): https://datastori.es/137-visualizing-earth-with-cameron-beccario/
79. Direct Relief — NASA Spotlights Direct Relief's Use of Satellite Data During Los Angeles Fires (Aug 2025): https://www.directrelief.org/2025/08/nasa-spotlights-direct-reliefs-use-of-satellite-data-during-los-angeles-fires/
80. Google Play — Zoom Earth listing showing 5M+ downloads: https://play.google.com/store/apps/details?id=com.neave.zoomearth&hl=en_US

### Remaining genuinely-absent facts (checked twice, different methods)
- Official Google statement on Project Sunroof discontinuation; NYT/WaPo internal analytics; Climate Central tool-level traffic; FIRMS request-volume stats; Electricity Maps blackout-window visitor figures; any interactive flood tool that captured Dubai/Valencia virality.

---

## Phase-3 addendum (final gap-fill under tight quota)

Method compliance for this pass: `web_search` confirmed broken (unused); exactly **6** firecrawl searches total (one at a time, ≥26s spacing, up to 3 retries @35s — no retries were ultimately needed); plus zero-quota plain-curl checks of windy.com/en/about (JS-rendered, no data) and watchduty.org/about.

New findings folded in above:

- **Ventusky**: Google Play listing shows **1M+ downloads** — its first public user-scale figure. Developer package cz.ackee confirms a contracted Android shop built it for InMeteo (founded 2006).
- **Wet-bulb calculators 2024–26**: no single viral consumer calculator surfaced; instead an institutional layer — **OSHA's official Outdoor WBGT calculator**, NWS WBGT prototype grids (explicitly military/OSHA-guided), and commercial lead-gen calculators from weather-tech vendors (Perry Weather). This reframes "viral wet-bulb calculators": the concept went viral via journalism (WaPo/NYT/HN), while calculators remained utility infrastructure.
- **Valencia DANA virality mechanism sharpened**: fact-checker Maldita's Nov 12, 2024 piece documents how DANA-related images and hoaxes accumulated on TikTok in the days after the floods (official toll cited there: 219 dead as of Nov 8, 2024) — i.e., the platform where flood visuals spread was short-video social, not any map tool.
- **Watch Duty model re-confirmed from primary site**: about page markets "trusted by millions," paid **Membership** for consumers and **Professional Solutions** for teams/businesses — freemium-for-pros nonprofit structure verified at source.
- **Electricity Maps discourse usage**: search found EM screenshots/data cited in unrelated public energy debates (e.g., California emissions arguments, BCG Nordic posts) but still no blackout-window traffic figures or press citations specific to Apr 28–29, 2025.

### New sources (this pass)
81. Maldita.es — How DANA hoaxes accumulate on TikTok (Nov 12, 2024; 219 dead as of Nov 8): https://maldita.es/malditobulo/20241112/hoaxes-dana-valencia-tiktok/
82. Google Play — Ventusky listing (1M+ downloads): https://play.google.com/store/apps/details?id=cz.ackee.ventusky&hl=en_US
83. OSHA — Outdoor WBGT Calculator (official): http://www.osha.gov/heat-exposure/wbgt-calculator
84. Perry Weather — Free WBGT calculator (commercial lead-gen example): https://perryweather.com/resources/wbgt-calculator/
85. Watch Duty — About page ("trusted by millions"; Membership & Professional Solutions): https://www.watchduty.org/about
