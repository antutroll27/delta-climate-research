# Solar payback: where the cost-basis defaults come from

Read 2026-09-30 for `src/scripts/climate-engine/solar-cost.ts` (spec `docs/superpowers/specs/2026-09-30-solar-roi-design.md`).

| Field | Value | Source | Read on |
|---|---|---|---|
| subsidy.home | ₹30,000/kW to 2 kW; ₹18,000 3rd kW; cap ₹78,000 | PM Surya Ghar CFA structure (official PDF, 7 Mar 2024): https://pmsg-production-public.s3.ap-south-1.amazonaws.com/CFA_structure20240307.pdf | 2026-09-30 |
| subsidy.society | ₹18,000/kW, common facilities, to 500 kW | same PDF | 2026-09-30 |
| sizingByUnits | 0–150 → 1–2 kW; 150–300 → 2–3 kW; >300 → above 3 kW | same PDF | 2026-09-30 |
| costPerKw | ₹55,000–65,000 | 2026 market range (installer price guides); MNRE benchmark ₹50,000/kW first 2 kW, ₹45,000 after (13 Feb 2024) | 2026-09-30 |
| tariff | ₹8.00/kWh (assumed) | CESC domestic slabs 4.07–9.21 per unit, 2025-26 tariff order; a solar unit displaces the top of the bill | 2026-09-30 |
| exportRate | ₹4.80/kWh (CESC, low & medium voltage, FY 2025-26). **Primary.** Applies to **net billing** (and gross metering) only; see the settlement caveat below | WBERC Suo-Motu Order, Case No. SM-40/25-26, dated 20.08.2025, para 5.0 table, row "Feed-in Tariff for L&MV", column CESC: https://wberc.gov.in/sites/default/files/SM-40.pdf. That CESC's domestic consumers are L&MV: CESC Tariff Order 2025-26 (Case TP-102), Annexure 4B, p. 26: https://wberc.gov.in/sites/default/files/TP102.pdf | 2026-09-30 |
| upkeepPctPerYr | 1 % of capital cost per year. **Primary, but from Karnataka's regulator**, not West Bengal's (none found for WB) | KERC Order No. KERC/S/F-32/V-29/2407, dated 25.08.2026, §7 "Operation & Maintenance Cost": https://kerc.karnataka.gov.in/uploads/48561787653428.pdf | 2026-09-30 |
| inverter | ₹7,866/kW (**primary**: manufacturer's own store price); replaced in year 12 (**assumption**) | Price: Waaree's own store, 3 kW single-phase on-grid inverter ₹23,599 incl. taxes (÷ 3 kW = ₹7,866/kW): https://shop.waaree.com/waaree-3kw-single-phase-solar-on-grid-inverter/. Warranty (bounds the year): Waaree 8 years (same page); Havells Enviro GTi 3000 NG 10 years: https://havells.com/media/wysiwyg/Brochure-and-pricelist/Solar/Catalogue_Havells_Solar.pdf | 2026-09-30 |
| degradation | 1.0 % in year 1, then 0.4 %/yr (years 2–30). **Primary** (manufacturer warranty). Scheme floor for a conservative bound: ≤3 % in year 1, <0.5 %/yr | Waaree Elite series N-type TOPCon, datasheet BiN-08-565 to BiN-08-600 (WEL/E&PD/565-600/144/BiN-08/HC/09/03.01.2025): https://www.waaree.com/upload/media/elite_series_bin_08_565_600_wel_epd_565_600_144_bin_hc_09_03012025_1756378918.pdf, and its warranty statement WEL/E&PD/WS/TOPCON/01/25.09.2024: https://www.waaree.com/upload/media/limited_warranty_statement_wel_epd_ws_topcon_01_25092024_1758110214.pdf. Floor: MNRE PM Surya Ghar guidelines (Jul 2025 edition), module spec 1.9: https://cdnbbsr.s3waas.gov.in/s3716e1b8c6cd17b771da77391355749f3/uploads/2025/07/202507081690964295.pdf | 2026-09-30 |
| horizonYears | 25 | module performance warranty; Waaree and Vikram calculators both use 25 | 2026-09-30 |

## Verbatim quotes for the four sourced rows

### exportRate

The WBERC order is a scanned image (HP Scan, 4 pages, no text layer). The numbers below were read from the page image at 200 dpi and cross-checked against a Tesseract OCR of the same page.

- **The rate.** SM-40/25-26, p. 4, para 5.0:
  > "In view of the above, the Commission determines the feed-in tariff for FY 2025 – 26 in terms of regulation 11 read with regulation 21 (1) of the West Bengal Electricity Regulatory Commission (Grid Interactive Rooftop Solar Photovoltaic System for Prosumers) Regulations, 2025 as below:"

  | Particulars | Unit | WBSEDCL | CESC | IPCL | DVC |
  |---|---|---|---|---|---|
  | Feed-in Tariff for EHV | Rs./kWh | 3.73 | 4.42 | 4.19 | 4.31 (merged cell) |
  | Feed-in Tariff for HV | Rs./kWh | 3.89 | 4.60 | 4.36 | 4.31 (merged cell) |
  | Feed-in Tariff for L&MV | Rs./kWh | 4.37 | **4.80** | 4.36 | 4.31 (merged cell) |

  The ₹4.42 in trade press (Mercom, 28 Aug 2025) is the CESC **EHV** row. It is not the rate for a house.
- **Why the rate is a landed cost.** SM-40, p. 3, para 4.0:
  > "The landed per unit cost of power at specific voltage level in the above table reflects the per unit cost of power purchase by the distribution licensee at that voltage level."
- **Why a CESC house is on the L&MV row.** CESC Tariff Order 2025-26 (TP-102), Annexure 4B, p. 26 (also a scan; OCR read):
  > "Low and Medium Voltage Consumers / Life Line Consumer (Domestic) … / Domestic (Urban) …"

  A separate "Domestic" line sits under "High and Extra High Voltage Consumers". That line is for domestic supply taken at high or extra-high voltage, not an ordinary house connection.
- **The rate is locked for the plant's life.** Regulation 11 of the Regulations, quoted in SM-40, p. 2:
  > "Feed-in Tariff once agreed in the Agreement between the prosumer and the licensee shall be valid for the entire useful life of the Grid Interactive Rooftop Solar Photovoltaic project."

**Settlement caveat for the "Use my bill" arithmetic.** The Regulations were notified as No. 81/WBERC in the Kolkata Gazette Extraordinary of 31 July 2025: https://wberc.gov.in/sites/default/files/Regulation%2081.pdf (a scan; OCR read). They never pay out surplus as cash:

- **Net billing**, Part-C (PDF p. 10):
  > "If the monetary value of energy imported is less than the monetary value of energy exported the difference amount shall be carried forward to the next billing cycle. At the end of the settlement period, if there is a net amount receivable by the prosumer, it shall be reset to zero"
- **Net metering**, Part-B (PDF p. 8). Surplus is netted in kWh at the retail tariff, not at ₹4.80:
  > "The net imported energy, if any, shall be billed at the applicable retail tariff. Any net exported energy shall be carried forward to the subsequent billing period. At the end of the settlement period, any remaining net exported energy shall be reset to zero"
- **Settlement period**, definition (s):
  > "generally beginning on the 1st of April of a calendar year and ending on the 31st of March of the following year"

So under net billing, surplus × ₹4.80 is worth money only up to that financial year's import bill. Any credit beyond that is forfeited. Under net metering, surplus kWh offset imports at the retail tariff, and whatever is left at 31 March is forfeited.

**Currency of the rate.** The order sets the rate for FY 2025-26. On 2026-09-30 WBERC's suo-motu and tariff-order listings showed no FY 2026-27 re-determination. The only later suo-motu order is SM-41 (1 Sep 2025), which only fixes the ninth control period as FY 2026-27 to 2030-31. CESC's own tariff page (https://www.cesc.co.in/tariff) still lists "2025-26" as its current tariff. If a FY 2026-27 CESC tariff order sets a new feed-in tariff, this row must be re-read.

### upkeepPctPerYr

- **KERC 25.08.2026, §7, "Commission's decision"** (covers DSPV plants from 25.08.2026 to 30.06.2029, including domestic 1–10 kW):
  > "The operation and maintenance cost consists of employee cost, administrative & general expenses and Repairs & Maintenance expenses (R&M). The Commission adopts the O & M expenses as 1% of the capital cost with an annual escalation of 5.72% from first year of operation."
- **KERC parameter table, 1 kW to 10 kW domestic.** "Cost/kW- in Rs. … Rs. 45,000 per kW (Domestic consumers)" and "O & M expenses in Rs./kW 450". The two lines agree: 450/45,000 = 1 %.
- **What a KERC norm covers.** It is a tariff-setting norm for a generator: it includes employee and A&G cost. A homeowner's cash outlay is lower in the early years, because the PM Surya Ghar guidelines make the first five years free. Jul 2025 edition, §(d):
  > "Registered vendors shall provide the services to the consumers for repairs/maintenance of the RTS plant free of cost for 5 years of the Comprehensive Maintenance Contract (CMC) period from the date of commissioning of the plan."
- **Earlier KERC order, for the record.** FY24 order, 01.06.2023: "O&M expenses at Rs.708/kW for SRTPV units … with an annual escalation of 5.72%" (https://srtpv.bescom.org/SRTPV/document/KERCSRTPVtariff2024.pdf). It is superseded by the 2026 order.
- **Not modelled.** The 5.72 %/yr escalation is not in the spec's model. A flat 1 % understates the later years.

### inverter

- **Cost: Waaree's own store** (manufacturer-direct), "WAAREE 3kW Single Phase Solar On Grid Inverter":
  > "Was: ₹30,299.00 | ₹23,599.00 | Price dropped by ₹6700 | MRP: ₹40,454.40 | Inclusive of all taxes"

  ₹23,599 ÷ 3 kW = ₹7,866/kW. Waaree's 5 kW single-phase unit on the same listing (https://shop.waaree.com/single-phase-on-grid-inverter/) sells at ₹36,999 (MRP ₹52,456.95), which is ₹7,400/kW. So the per-kW cost falls with size.

  The ₹7,866 is a live retail price, which moved ₹6,700 recently. It excludes installation labour. The printed MRP (₹40,454) is not a transaction price and is not used.
- **Warranty: Waaree** (same page):
  > "Our on-grid inverters come with a 8 years standard warranty."
- **Warranty: Havells**, Enviro GTi 1100 NG / 2200 NG / 3000 NG / 3300 NG datasheet (catalogue dated May 2024):
  > "Warranty 10 years"
- **Replacement year 12 is an assumption.** No primary Indian source for residential string-inverter *lifetime* was found. The two manufacturer warranties (8 and 10 years) are a floor on that lifetime, not a measure of it, so year 12 assumes the inverter runs two to four years past warranty.

  NREL's ATB was checked as a method reference. Search snippets attribute a 15-year inverter replacement to older ATB residential-PV editions, but atb.nrel.gov no longer resolved and the 2024 page (now atb.nlr.gov) did not contain that statement. It is **not** cited.

### degradation

- **Waaree Elite N-type TOPCon warranty statement** WEL/E&PD/WS/TOPCON/01/25.09.2024, Clause B:
  > "(i) During the first year, will exhibit a power output no less than 99% of the peak power under STC at the end of first year. … (ii) From 2nd to 30th year, the power output will decline annually by no more than 0.4% of the peak power under the STC. So at the end of 30 (Thirty) years, at least 87.4% of peak power at STC can be achieved from the Warranty Start Date."

  Its annexure table reads: "1st Year 1.00% 99.00%", then "2nd Year 0.40% 98.60%".
- **Waaree BiN-08-565 to 600 datasheet.** It shows the same Linear Performance Warranty curve: 100 % → 99.00 % → 94.6 % → 87.4 %. It also states:
  > "12 Years Product Warranty • 30 Years Power Output Warranty"
- **Scheme minimum.** This is the conservative bound: any module eligible for the subsidy must meet it. MNRE PM Surya Ghar guidelines (Jul 2025 edition), technical specification 1.9:
  > "All PV modules should have a nominal power output of >90% at STC during the first 10 years, and >80% during the next 15 years. Further, module shall have nominal power output of >97% during the first year of installation—degradation of the module below 0.5 % per annum"
- **Two figures that are warranty floors, not measurements.**
  - The spec's placeholder (2.5 % then 0.7 %/yr, after Vikram's calculator) is looser than both sources above.
  - Waaree's figures are for its premium TOPCon line. A cheaper DCR module a Kolkata installer fits may carry a weaker warranty. The MNRE floor (3 % then 0.5 %) covers that case.

## Search trail (2026-09-30)

- **Export rate.**
  - Web search: "WBERC Grid Interactive Rooftop Solar Photovoltaic System for Prosumers Regulations 2025 net billing rate" and "WBERC feed-in tariff 2026-27 net billing rooftop solar CESC L&MV". These found only press copies of the EHV row. The Mercom article is paywalled past its first line.
  - Primary found at https://www.wberc.gov.in/suo-moto-order (SM-40) and https://wberc.gov.in/regulations-under-the-electricity-act-2003 (Regulation 81).
  - Checked https://www.wberc.gov.in/tariff-related-order for a FY 2026-27 CESC order: none listed.
- **O&M.**
  - Checked the MNRE PM Surya Ghar guidelines: 5-year free CMC, no annual % after it.
  - WBERC's other orders: OA-533 fixes O&M norms for WBSEDCL's own solar generating stations, which is utility scale and not rooftop.
  - CERC RE tariff norms: MW-scale, per-MW figures, not residential.
  - Web search "SERC tariff order rooftop solar O&M % of capital cost", then KERC's generic-tariff-orders page (https://kerc.karnataka.gov.in/73/generic-tariff-orders/en), which gave the 25.08.2026 order.
  - No SECI or WB DISCOM residential O&M figure was found.
- **Inverter.**
  - Web search "on-grid solar inverter 3 kW single phase MRP price list India 2026 manufacturer".
  - Havells catalogue: warranties, no prices.
  - Luminous's store (solutions.luminousindia.com) is rendered by JavaScript, so no price was readable. A search snippet quoting ₹24,499 is not used.
  - Waaree's store listing and product page were read directly.
  - No CERC or MNRE inverter price per kW was found. The MNRE benchmark bundles the inverter into ₹50,000/₹45,000 per kW.
- **Degradation.** waaree.com datasheet and warranty statement, and the MNRE guidelines. Vikram's figure was already reviewed below.

Source copies (PDFs, OCR text, page images) are kept outside the repo in `~/.cache/delta-climate/solar-roi/sources/`.

## Reviewed, not adopted
- Waaree saving calculator: flat 107.7 kWh/kW/month for all India, 80 sq ft/kW, ₹50/W + ₹10/W, no shading.
- Vikram Solar calculator: PLF 0.16 for every state (1,402 kWh/kW/yr), panel-footprint area only, state records dated 2022-05-22.
- Autodesk University "Calculating Shaded Areas in Revit" (Phuc Le, Oct 2021): single-building shading of windows by projection, three dates; confirms our method, adds no data.
- Mercom India, "WBERC Sets Net Billing and Gross Metering Feed-in Tariffs for Rooftop Solar" (28 Aug 2025): reports only the EHV row (CESC ₹4.42); secondary, superseded by the order itself.
- KERC FY24 order (01.06.2023), SRTPV O&M ₹708/kW: superseded by the 25.08.2026 order.

## Values adopted (Amendment A1, 30 Sep 2026)

The table at the top is the research record. These are the values `solar-cost.ts` actually ships, and why they differ from it where they do.

| Field | Shipped value | Why |
|---|---|---|
| surplusCreditPerKwh | 0 | The 2025 Regulations (No. 81/WBERC) reset any net amount receivable, or net exported energy, to zero at the end of the settlement period (1 April to 31 March). The 4.80 feed-in tariff only offsets imports within the year, so surplus beyond the household's own yearly use earns nothing. |
| degradation | 3 % in year 1, then 0.5 %/yr | The MNRE PM Surya Ghar floor that every subsidised module must meet. It is more conservative than the Waaree premium-line warranty (1.0 % then 0.4 %), which a cheaper module may not carry. |
| upkeepPctPerYr | 1 % of gross installed cost per year, flat | The KERC norm, a Karnataka generator figure with no West Bengal or MNRE residential equivalent found. Applied flat in constant rupees, so its 5.72 %/yr escalation is not modelled. |
| inverter | 8,000 per kW, replaced in year 10 | Waaree's 7,866 per kW store price excludes labour, so it is rounded up to 8,000 as a decision, not a quoted figure. Year 10 is the end of the Havells 10-year warranty, an assumption; no primary lifetime study was found. |
