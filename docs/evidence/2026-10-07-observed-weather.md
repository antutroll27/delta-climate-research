# Observed weather for "now": what changed on 2026-10-07, and why

## The defect

On 7 October 2026 at about 11:13 IST, OBOS showed Ballygunge at a **46.7 °C surface temperature
while it was raining**. The CEO read that figure as the air temperature. Four causes were found.

1. **"Now" was a forecast.** `api/live.js` proxies Met Norway's *locationforecast*. At 06:00Z it said
   32.0 °C air, 13.3 % cloud and no rain. Kolkata airport's report for the same time said:
   `METAR VECC 070600Z 05004KT 3200 -RA SCT018 FEW025CB BKN100 31/23 Q1015`.
2. **Cloud passed too much sun.** `sun · (1 − 0.6·C)` lets 40 % of the sun through at full overcast.
3. **The model had no wet-surface term.**
4. **The readout led with the surface temperature**, under a label a reader could miss.

The founder's decisions are recorded in `/Volumes/OBOSLab/rain-fix/decisions.md`. They are: air
temperature first; airport METAR as "now", with met.no as the fallback; Kasten & Czeplak cloud
transmission; rain relaxation; and applying the airport's rain to the ward, with a visible note.

## What changed in the physics, and nothing else

The fitted constants (`q_day`, `kRad:h`, Brutsaert `c`, `L_ET`, `STORE_NIGHT`) and the method
are unchanged. Two terms are new, and both act **only when the reading is an airport observation**.

| Term | Value | Source |
|---|---|---|
| Station-cloud transmission | `1 − 0.75·C^3.4` | Kasten & Czeplak (1980), *Solar Energy* 24(2):177–189. Ten years of hourly Hamburg global radiation against observer cloud amount. |
| Cloud fraction per cover word | FEW 1.5/8, SCT 3.5/8, BKN 6/8, OVC 1, VV 1 | Midpoints of the okta bands (ICAO Annex 3, App. 3). |
| Combining layers | The **largest** layer | METAR's layer-progression rule and the summation principle. The largest layer is the total cover, or a lower bound on it, so the error leans towards more sun and never invents cloud. A random-overlap combination would give 0.89 for today's report. |
| CB/TCU factor | ×0.75 | **Judgement.** K&C's cloud-genus table could not be obtained to cite **(verify)**. Its direction is certain; its size is not. |
| Thunderstorm at the station | ×0.5 | **Judgement**, as above. It lands near K&C's overcast floor of 0.25. |
| Wetting time constant τ_wet | 20 min | An energy-budget estimate, not a fit. The roughly 0.8 MJ/m² held in a pavement skin is shed through evaporation plus the cut in sunshine in about 20–30 minutes. This is the low end of the founder's 20–40 min range. |
| Re-warming time constant τ_dry | 30 min | **Judgement.** It returns 86 % of the dry departure after 1 h ("over about an hour"). |
| Rain onset and end | Midpoint between reports | METAR reports only the moment it is taken. The midpoint is the unbiased estimate when onset is equally likely anywhere in the gap. |
| Stale limit | 90 min | Decision 2. That is two missed half-hourly reports. |

**The rain term is exact and uses only scalar inputs.** A cell's departure from air is

`T − tAir = (S(1−a)·sun + Q·b − L·v + store + kRad·(tSky − tAir)) / k`

The term scales `sun`, `Q`, `L`, `store` and `tSky − tAir` by (1 − w), where w is the surface
wetness. That scales every cell's departure by exactly (1 − w). The conductance `k`, the diffusion
`D` and the solver are untouched. The rain term acts only in the "now" view, never in the
canonical 13:00 or 22:00 scenarios.

## Why Kasten & Czeplak is not applied to model cloud

This was measured before deciding. `measure-accuracy.py` was run with `1 − 0.6·C` swapped for
`1 − 0.75·C^3.4` in every Python mirror, with the fitted constants held:

| Stratum | RMSE before → after (K) | Bias before → after (K) |
|---|---|---|
| night | 2.662 → 2.662 | +0.41 → +0.41 |
| morning_ecostress | 4.340 → 4.695 | −1.62 → −0.64 |
| **morning_landsat** (212 ward-scenes) | **2.913 → 3.170** | **+0.36 → +1.12** |
| peak_ecostress | 2.233 → 2.459 | +0.66 → +1.11 |

The calibration was fitted against NASA POWER's 50 km **model** cloud fraction through `1 − 0.6·C`.
Its constants therefore absorbed that pairing. K&C on thin model cloud (median 0.13 across the
calibration scenes) lets through almost all the sun the old formula cut, and every daytime stratum
warms.

So model cloud (met.no, POWER, and every calibration and Compare record) keeps the calibrated
formula, bit for bit. Station cloud, which is the observer oktas K&C was fitted to, uses K&C. No
calibration scene carries station cloud, so no published figure moves.

**A refit on station cloud is the founder's call**, and it would need historical METARs at each
overpass.

## Validation after the change: unchanged

- `scripts/measure-accuracy.py` reproduces `model-accuracy.json` byte for byte.
- `scripts/measure-displayed-vs-calibrated.py` drives the shipped solver through `currentParams`.
  Every stratum is identical: night 2.66, morning_ecostress 4.34, morning_landsat 2.91 and
  peak_ecostress 2.23 K RMSE. Only the `generated` date differed, and it was reverted.
- `npm run test:py` passes, including `build-ward-observations.py --check`.
- The golden `currentParams` cases (`obos-golden-params.test.mjs`) pass unchanged.

## Today's case, Ballygunge ward mean (calibrated equation at the ward's measured surface)

| 06:00Z, 11:30 IST | °C |
|---|---|
| Before: met.no forecast, `1 − 0.6·C` | **47.8** (the page drew 46.7 through the solver and the Ward 68 mask) |
| Station cloud alone (K&C, CB), no rain term | 37.6 |
| **After: cloud + rain, 15 min after the estimated 05:45Z onset** | **34.1** |
| Same report, 06:13Z (next poll) | 32.6 |
| Same report, 06:30Z | 31.7 |
| Air temperature at the airport | 31 |

## Where it is said on screen

The readout now leads with **air** temperature and feels-like. The surface follows, labelled
"Ground & rooftop surface". The weather line then names the condition, the airport, its distance
and the observation time, and says that conditions over the ward may differ. On a wet ward, the
chip reads "Outside validation · wet surfaces" and no ± band is printed, because every validation
pass was clear-sky.

## Reachability

Before anything was built, a probe function was deployed on a Vercel Preview to check that the
server can reach the METAR feed.

- It fetched `aviationweather.gov/api/data/metar?ids=VECC,VOBL,VOBG` with HTTP 200 from **iad1**
  (151 ms) and from **bom1** (631 ms).
- The probe was removed afterwards.
- CPCB, by contrast, refuses cloud IPs. That is why this was tested from Vercel and not from a
  home connection.
