# Air quality for Amsterdam and Tokyo: the regulators' own standards

Read and measured 2026-11-06 (Phase C, tasks C3 and C4 of `/Volumes/OBOSLab/research/new-cities/PLAN-amsterdam-tokyo.md`).
Every quotation below is from a primary page fetched that day with the generic user-agent
`obos-pipeline/1.0 (+https://deltaclimate.earth)`. The rule behind both cards is the same as for Kolkata: **the standard
follows the regulator, and OBOS never says another scale or another app is wrong.**

Recorded responses: `tests/fixtures/aqi/nl/` and `tests/fixtures/aqi/jp/`. Sources and credit wording:
`data/cities/amsterdam/sources.json` (entry `luchtmeetnet-air-quality`) and `data/cities/tokyo/air-sources.json`.

## 1. Amsterdam: Luchtmeetnet and the LKI

### 1.1 The index (what the number is)

`luchtmeetnet.nl`, page "Luchtkwaliteitsindex (LKI)" (the site's CMS record `luchtkwaliteit/luchtkwaliteitsindex-(lki)`,
`https://api.luchtmeetnet.nl/cms/pages`; `tests/fixtures/aqi/nl/cms-pages-used.json`):

> De index vat gegevens samen over de luchtkwaliteit. Zowel de gemeten als berekende luchtkwaliteit wordt ingedeeld in vijf klassen van goed tot zeer slecht. Per stof wordt een concentratie omgezet tot een getal van 1 (weinig luchtverontreiniging) tot 11 (veel luchtverontreiniging). De stof met het hoogste indexgetal bepaalt de totale luchtkwaliteitsindex. Als alle stoffen hetzelfde indexgetal hebben dan wordt de totale index één punt hoger. Decimale LKI-waarden worden naar bovenafgerond. Zo valt bijvoorbeeld een LKI van 0,9 in klasse 1 en een LKI van 3,1 in klasse 4.

The page "Handelingsadvies" names the five classes **GOED, MATIG, ONVOLDOENDE, SLECHT, ZEER SLECHT**.

### 1.2 The class edges (no prose page states them; the site's own code does)

The site's script chunk `e45e244f…88db230ed3702bf9bd8d.js` (sha256 `9d748442c77790ea…`) colours a published LKI value `e` by:

```
e===0 → no data;  e>0&&e<4 → good;  e>=4&&e<7 → moderate;  e>=7&&e<9 → insufficient;  e>=9&&e<11 → bad;  otherwise → very bad
```

and the legend table in chunk `590aabf6…20a83cfb9d6dcfa99c5f.js` lists the strings `good, moderate, insufficient, bad, verybad`, whose labels in
the site's translations are Goed/Good, Matig/Moderate, Onvoldoende/Insufficient, Slecht/Bad, Zeer slecht/Very bad. Both fragments are
saved verbatim in `tests/fixtures/aqi/nl/lki-legend-evidence.json`, and a unit test reads them, so the edges cannot drift from the record.

| LKI | class (NL / EN) | site legend colour |
|---|---|---|
| 1 to 3 | Goed / Good | #3077CE |
| 4 to 6 | Matig / Moderate | #dfb300 |
| 7 to 8 | Onvoldoende / Insufficient | #D84000 |
| 9 to 10 | Slecht / Bad | #9F1D35 |
| 11 | Zeer slecht / Very bad | #7d27cd |

The origin of the index is RIVM report 2014-0050 (`https://www.rivm.nl/bibliotheek/rapporten/2014-0050.pdf`, 106 pages, 2015). It proposed **ten**
classes and **four** groups (Table 7 and Table 10); the live site uses eleven numbers and five classes. The report is not the live scheme, and
OBOS follows the live site. (The report's Table 7, hourly classes for 1 to 10, for PM2.5: 0-10, 10-15, 15-20, 20-30, 30-40, 40-50, 50-70, 70-90, 90-100, over 100 µg/m³.)
OBOS does not compute the LKI; it prints the value the API serves.

### 1.3 Licence and credit (the terms say what to write)

`luchtmeetnet.nl`, page "Open data" (NL; the EN page agrees):

> Bij hergebruik van de inhoud van de datasets is bronvermelding (www.luchtmeetnet.nl) verplicht. Bij het citeren van de inhoud mag niet de indruk worden gewekt dat wij de strekking van het afgeleide werk onderschrijven.
> … Er geldt een Fair Use Policy … Het opvragen van data wordt gelimiteerd tot maximaal 100 verzoeken per 5 minuten.
> Op de data beschikbaar gesteld via www.luchtmeetnet.nl is de licentie Naamsvermelding-GeenAfgeleideWerken 4.0 Internationaal (CC BY-ND 4.0) van toepassing.

**This is CC BY-ND 4.0, not the CC BY 4.0 the planning research assumed** (that was the licence of a different, bulk RIVM dataset). Consequences, all built in:

- The credit is `Source: www.luchtmeetnet.nl`, which is the reference the terms prescribe. Nothing longer is required.
- The card says "Luchtmeetnet does not endorse this page", as the second sentence requires.
- **NoDerivatives:** the card prints the LKI and the hourly concentrations exactly as the API returns them (no rounding, averaging or unit change). It does **not**
  derive a "US AQI (computed)" line from the PM2.5, which the plan listed as optional: that would be an adaptation of the data. A test asserts no such line exists in the payload.
- Whether a selection and layout of unaltered values is itself an adaptation under ND is a question for a lawyer (founder Q6a).

"Tijdnotatie" (timestamps): "Alle meetwaarden zijn uurgemiddelde waarden en zijn opgeslagen in wintertijd (UTC/GMT)." Measured 2026-11-06: `timestamp_measured` is the **end** of the hour
(row `13:00Z` carries `timestamp_measured_start 12:00Z`, `_end 13:00Z`; at 13:36Z it was the newest). "Disclaimer": the data are "indicatief", unvalidated, may be corrected, and no rights can be derived.

### 1.4 Which stations (the plan's list was incomplete)

All 103 stations Luchtmeetnet lists were read (`tests/fixtures/aqi/nl/stations-details.json`; coordinates `[lon, lat]`). Distance is haversine from the canal-ring centre 52.3640 N, 4.8850 E.

| id | station | type | m | components | serves the LKI card |
|---|---|---|---|---|---|
| NL49017 | Amsterdam-Stadhouderskade | Traffic | 1,198 | C6H6 C7H8 C8H10 FN NO NO2 PM10 PM25 | no (no O3) |
| **NL49014** | **Amsterdam-Vondelpark** | Municipal | **1,362** | CO FN NO NO2 O3 PM10 PM25 BCWB | **first** |
| NL49019 | Amsterdam-Oude Schans | Municipal | 1,593 | NO NO2 | no |
| NL49020 | Amsterdam-Jan van Galenstraat | Traffic | 2,061 | NO FN PM10 BCWB NO2 | no |
| NL49002 | Amsterdam-Haarlemmerweg | Traffic | 2,463 | NO NO2 | no |
| **NL49012** | **Amsterdam-Van Diemenstraat** | Traffic | **2,895** | CO FN NO NO2 O3 PM10 PM25 BCWB | fallback 2 |
| NL49007 | Amsterdam-Einsteinweg | Traffic | 3,317 | PM25 NO CO FN PM10 NO2 | no (no O3) |
| NL49016 | Amsterdam-Westerpark | Municipal | 3,482 | PM10 PM25 SO2 | no |
| **NL49003** | **Amsterdam-Nieuwendammerdijk** | Municipal | **4,885** | FN NO NO2 O3 BCWB PM10 PM25 | fallback 3 |
| **NL10552** | **Haarlem-Freddie Oversteegenstraat** (RIVM) | Other | **15,849** | PM25 NO PM10 O3 NO2 | fallback 4 |
| **NL10641** | **Breukelen-A2** (RIVM) | Traffic | **19,363** | FN NO NO2 O3 PM10 PM25 BCWB | fallback 5 |

The rule: a station serves the card only if its published component list holds **NO2, PM10, PM25 and O3**, the four the LKI is built from, because every station publishes an LKI
(Oude Schans, with NO and NO2 only, publishes one too) but one from fewer substances can only be as high or lower. The ladder is within 20 km (the Bengaluru ceiling); a fallback is
labelled "nearest reporting" with its true distance. A unit test re-derives the ladder from the recorded details.

## 2. Tokyo: Soramame and Japan's environmental quality standards

### 2.1 The data and its rights

`soramame.env.go.jp`, API manual §2-1 (`/data/apiManual/2.html`):

> 本サイト上からAPIで取得するデータの著作権は、環境省、それぞれの地方公共団体及び国立環境研究所が保有します。
> 国設局以外の測定データのご利用については、それぞれの地方公共団体及び国立環境研究所にお問い合わせください。
> 国設局のデータについては、下記リンク先の利用ルールに従ってご利用いただきますようお願いします。http://www.env.go.jp/mail.html

§2-3: "本サイトで提供しているAPIで取得可能なデータは速報値であり、確定値ではありません。速報値は、データ検証の結果、後日修正されることがあります".

The Ministry's rule (`https://www.env.go.jp/mail.html`, §1.1, PDL 1.0):

> ア　本コンテンツを利用する際は出典を記載してください。… （出典記載例）出典：環境省ホームページ　（当該ページのURL）/ 出典：「○○動向調査」（環境省） （当該ページのURL）　（○年○月○日に利用）
> イ　本コンテンツを編集・加工等して利用する場合は、上記出典とは別に、編集・加工等を行ったこと及びその主体を記載してください。… （記載例）「○○動向調査」（環境省） （当該ページのURL）をもとに○○株式会社作成

Wording used (and why it differs a little from `TOKYO-TERMS.md`):

- Credit: `出典：環境省大気汚染物質広域監視システム（そらまめくん）（https://soramame.env.go.jp/）（速報値）` (as proposed).
- Edit statement: `「環境省大気汚染物質広域監視システム（そらまめくん）」（環境省）（https://soramame.env.go.jp/）をもとにDelta Climate Research作成（国設局の測定値を選んで表示）`.
  `TOKYO-TERMS.md` had the shorter `環境省「そらまめくん」をもとにDelta Climate Research作成`; the Ministry's pattern puts the title in 「」, then （環境省）, then the URL, then the editor, so the longer line follows it exactly and still names Delta Climate Research as the editor (PDL 1.0 §1.1).

### 2.2 National stations only (the consent gate)

A station counts as national only when its `測定局名称` starts with **国設** *and* its `問い合わせ先` is **環境省**. In the 2026-11-06 file the two signals disagree for four stations, and OBOS excludes all four:
国設箟岳 (宮城県), 国設名古屋大気環境測定所 (愛知県), 国設前橋自動車交通環境測定所 (群馬県) carry the prefix with a prefecture as contact; 筑後小郡 names the Ministry without the prefix.
Every Tokyo-to and ward station (e.g. 千代田区神田司町 13101010, contact 東京都) is excluded until its owner consents (founder Q6b). A unit test runs the rule over the real 1,594-station file, and another puts a
local-government station on the ladder by mistake and shows it still yields no reading.

Within 20 km of the Marunouchi centre (35.6826 N, 139.7613 E), by the Ministry's own station master (`/data/map/kyokuNoudo/…`):

| id | station | kind | m | reports (hour ending 21:00 JST, 2026-11-06) |
|---|---|---|---|---|
| 13101520 | 国設霞が関 | roadside (自排局) | 1,529 | NO2, Ox; no PM2.5 |
| 13104540 | 国設新宿 | roadside (自排局) | 3,858 | NO2, Ox, PM2.5 |
| 13104010 | 国設東京（新宿） | general (一般局) | 4,067 | NO2, Ox, PM2.5 and more |
| 14131030 | 国設川崎 | general (一般局) | 19,157 | NO2, Ox, PM2.5 |

Each pollutant is taken from the nearest of these that has it this hour, and a pollutant from a station that is not the nearest is labelled "nearest reporting" with its own distance.

### 2.3 The hour convention (measured, not assumed)

`…/noudoAll/{YYYY}/{MM}/{DD}/{HH}.csv` is the one-hour mean **ending** at HH:00 JST; `metadata.latest` names the same HH:00. Three independent signals:
(1) the API manual's own records number hours 01 to 24; (2) file 21.csv was modified at 22:01 JST and 04.csv at 05:01 JST, and 22.csv at 22:28 JST was still the site's 2,593-byte placeholder page (HTTP 200, HTML);
(3) the Tokyo-prefecture mean `TEMP` of the 22 files of 2026-11-06 against JMA AMeDAS Tokyo (44132) 10-minute temperature fits the hour **ending** at HH:00 with a spread of 0.46 °C and the hour starting at HH:00 with 0.77 °C.
The newest hour is normally 60 to 120 minutes old when read, so "current" is three hours.

### 2.4 The standards (read, not recalled)

`https://www.env.go.jp/kijun/taiki.html` 「大気汚染に係る環境基準」:

- PM2.5 (微小粒子状物質): １年平均値が15μg/m3以下であり、かつ、１日平均値が35μg/m3以下であること。(H21.9.9告示)
- NO2 (二酸化窒素): １時間値の１日平均値が0.04ppmから0.06ppmまでのゾーン内又はそれ以下であること。(53. 7.11告示)
- Ox (光化学オキシダント): オゾンとして、８時間値が0.07ppm以下であり、かつ、日最高８時間値の１年平均値が0.04ppm以下であること。（R8.1.30告示）

**The Ox standard was revised by the notice of 30 January 2026**: the older rule (hourly value 0.06 ppm or less) is not current. Every standard is judged on an average (a daily mean; an 8-hour value), so the card shows the latest single provisional hour
beside the standard as an orientation mark and says that; it never says a place "meets" or "exceeds" a standard. Japan publishes no air-quality index and OBOS does not make one up.

## 3. What is not done, and why

- **No "US AQI (computed)" line on either card.** Amsterdam: ND licence. Tokyo: allowed by PDL 1.0 with an edit statement, but a NowCast needs 12 hours of PM2.5 files (12 fetches of 256 KB), the plan called it optional, and Kasumigaseki has no PM2.5; left for a decision.
- **No daily or 8-hour windows for Tokyo.** They would need the day's hourly files (up to 22 × 256 KB per refresh). The latest hour against the standard's mark, with the basis stated, is what is shown.
- **The cards do not show yet.** Neither city is drawable; `isAirCity` is true for them only when the registry says `drawable`, and the API answers 404 until then.
