# DC-URS v1 — source of truth

> **Status:** CEO-approved specification for the Delta Climate Urban Resilience Score v1 engine.
> **Provenance:** authored by the CEO, captured 2026-07-27 from the shared Gemini conversation
> `gemini.google.com/share/7fd738ca3e98`.
> **PRECEDENCE (decided 2026-07-27): this document is the FINAL source of truth for v1.**
> The engine ships it as written, plus exactly three fixes — each a case where this document
> contradicts itself or the maths misbehaves. The other five findings in
> [`dc-urs-engineering-review.md`](dc-urs-engineering-review.md) are **deferred to v2**.
>
> Formulas below were de-mangled from the source page's rendering. Content is otherwise verbatim.

---

## 1. Executive summary and theoretical foundations

The **Delta Climate Urban Resilience Score (DC-URS)** is an integrated composite index designed to
assess, benchmark, and simulate urban climate resilience at hyper-local spatial scales (pixel/block
level up to municipal ward boundaries).

The methodology synthesises multi-decadal satellite observation techniques with global city
resilience benchmarks:

```
                          GLOBAL RESILIENCE STANDARDS
 ┌───────────────────────┬────────────────────────┬─────────────────────────┐
 │   IPCC AR6 Risk       │     UNDRR Disaster     │       ISO 37123         │
 │ Hazard x Exposure x   │   Resilience Scorecard │ Indicators for Resilient│
 │     Vulnerability     │      for Cities        │        Cities           │
 └───────────┬───────────┴───────────┬────────────┴───────────┬─────────────┘
             │                       │                        │
             └───────────────────────┼────────────────────────┘
                                     ▼
                     DELTA CLIMATE URBAN RESILIENCE SCORE
                                 (DC-URS)
                                     ▲
             ┌───────────────────────┴────────────────────────┐
             │   Czekajlo et al. (2020) ScienceDirect Study   │
             │   Satellite Urban Greenness Score (UGS) &      │
             │   Multi-Decadal Trajectory Characterization    │
             └────────────────────────────────────────────────┘
```

### Core benchmark syntheses

1. **Czekajlo et al. (2020) — Urban Greenness Score (UGS):** incorporates multi-decadal
   Landsat/Sentinel vegetative trajectory analysis (NDVI persistence, canopy density, and greenness
   stability) as a fundamental driver of eco-physiological cooling capacity.
2. **IPCC AR6 Risk Framework:** structures the scoring function around the triad of **Hazard** (H),
   **Exposure** (E), and **Vulnerability** (V), where `V = f(Sensitivity S, Adaptive Capacity A)`.
3. **UNDRR & ISO 37123 / ISO 37120:** standardised operational indicators for built-environment
   durability, urban canopy coverage, heat-refuge accessibility, and critical infrastructure stress.
4. **C40 Cities Heat Resilient City Framework:** informs target thresholds for surface albedo,
   nature-based cooling solutions, and vulnerable population protection.

---

## 2. Mathematical formulation and architecture

DC-URS is computed on a scale of 0 to 100, where 100 represents maximum climate resilience and 0
indicates extreme vulnerability to thermal and climate shocks.

```
DC-URS = 100 × [ w_A·ACI + w_E·(1 − EVI) + w_H·(1 − THI) ]
```

Where:

- `ACI ∈ [0,1]` — **Adaptive Capacity Index** (positive resilience pillar)
- `EVI ∈ [0,1]` — **Exposure & Sensitivity Index** (negative impact pillar)
- `THI ∈ [0,1]` — **Thermal Hazard Index** (negative hazard pillar)
- `w_A, w_E, w_H` — weighting coefficients, `Σwᵢ = 1.0`.
  Default calibration: **w_A = 0.40, w_E = 0.35, w_H = 0.25**

---

## 3. Detailed sub-index formulations

### Pillar 1 — Thermal Hazard Index (THI)

Quantifies localised micro-climatic intensity derived from satellite thermal channels and
meteorological forcing.

```
THI = ω₁·LST_day + ω₂·LST_night + ω₃·UHI_Δ
```

- **`LST_day`** (daytime land surface temperature): peak Landsat 8/9 TIRS Band 10 thermal readings.
- **`LST_night`** (nighttime heat retention): Sentinel-3 SLSTR or MODIS night surface temperature
  (captures thermal mass trapping).
- **`UHI_Δ`** (urban heat island delta): localised surface temperature excess relative to a rural
  baseline `T_rural`:

```
UHI_Δ = LST_pixel − T_rural
```

*Note: all variables `X` are normalised using min-max scaling:*

```
X_norm = (X − X_min) / (X_max − X_min)
```

### Pillar 2 — Exposure & Sensitivity Index (EVI)

Measures spatial vulnerability of population and built assets.

```
EVI = β₁·ρ_pop + β₂·FAR + β₃·HVI_socio
```

- **`ρ_pop`** (population density): inhabitants per km².
- **`FAR`** (floor-area ratio / urban density): total built floor area divided by land lot area.
- **`HVI_socio`** (socio-economic heat vulnerability index): composite ratio of elderly (>65),
  children (<5), low-income demographics, and informal settlement fraction.

### Pillar 3 — Adaptive Capacity Index (ACI), incorporating satellite UGS

The cornerstone pillar, integrating Czekajlo et al.'s **Urban Greenness Score** alongside
structural retrofits.

```
ACI = α₁·UGS + α₂·CRI + α₃·TRA
```

#### A. Satellite Urban Greenness Score (UGS)

Derived from multi-decadal time-series analysis (Czekajlo et al., 2020) to capture vegetation
health, stability, and canopy coverage:

```
UGS = φ₁·NDVI + φ₂·FVC + φ₃·VSI
```

1. **Mean vegetation trajectory (NDVI):**

```
NDVI = (NIR − Red) / (NIR + Red)
```

2. **Fractional Vegetation Cover (FVC):**

```
FVC = (NDVI − NDVI_bare) / (NDVI_veg − NDVI_bare)
```

3. **Vegetation Stability Index (VSI):** measures long-term vegetative persistence versus land
   degradation across a multi-year baseline:

```
VSI = 1 − (σ_NDVI / NDVI)
```

#### B. Cool Albedo & Structural Reflectivity Index (CRI)

Quantifies surface albedo from satellite shortwave infrared (SWIR) and visible bands to capture
cool roof retrofits:

```
Albedo = 0.356·α_Blue + 0.130·α_Red + 0.373·α_NIR + 0.085·α_SWIR1 + 0.055·α_SWIR2
```

#### C. Thermal Refuge Accessibility (TRA)

Proximity to public cooling centres, shaded parks, and urban water bodies (Hooghly River,
wetlands):

```
TRA = exp(−λ·d_cool)
```

Where `d_cool` is distance in metres to the nearest thermal refuge, `λ ≈ 0.002`.

---

## 4. Indicator weighting matrix

Weights can be statically assigned via Analytic Hierarchy Process (AHP) or calculated dynamically
using the Entropy Weighting Method (EWM):

| Index pillar | Sub-indicator | Symbol | Default weight `wᵢ` | Standard alignment |
|---|---|---|---|---|
| **Hazard (THI)** | Daytime surface temp | `LST_day` | 0.10 | IPCC AR6 / C40 |
| | Nighttime retained heat | `LST_night` | 0.10 | IPCC AR6 / C40 |
| | UHI anomaly delta | `UHI_Δ` | 0.05 | ISO 37123 |
| **Exposure (EVI)** | Population density | `ρ_pop` | 0.15 | UNDRR Scorecard |
| | Built volume (FAR) | `FAR` | 0.10 | ISO 37120 |
| | Socio-demographic vulnerability | `HVI_socio` | 0.10 | IPCC AR6 / ISO 37123 |
| **Adaptive capacity (ACI)** | Urban Greenness Score | `UGS` | 0.20 | Czekajlo et al. (2020) |
| | Surface albedo index | `CRI` | 0.10 | C40 / ISO 37123 |
| | Thermal refuge accessibility | `TRA` | 0.10 | UNDRR Scorecard |

---

## 5. Reference implementation

```python
import numpy as np
import pandas as pd

class DeltaClimateResilienceEngine:
    """
    Holistic Urban Resilience Calculator based on Czekajlo et al. (2020)
    and IPCC AR6 / UNDRR / ISO 37123 Standards.
    """
    def __init__(self, weights=None):
        self.weights = weights or {
            'w_A': 0.40, 'w_E': 0.35, 'w_H': 0.25,
            'phi_1': 0.40, 'phi_2': 0.40, 'phi_3': 0.20, # UGS weights
        }

    def calculate_ugs(self, ndvi_mean, fvc, ndvi_std):
        """Calculates Urban Greenness Score (Czekajlo et al. 2020)"""
        # Vegetation Stability Index (VSI)
        vsi = 1.0 - np.clip(ndvi_std / (ndvi_mean + 1e-6), 0.0, 1.0)

        ugs = (
            self.weights['phi_1'] * np.clip(ndvi_mean, 0, 1) +
            self.weights['phi_2'] * np.clip(fvc, 0, 1) +
            self.weights['phi_3'] * vsi
        )
        return ugs

    def calculate_resilience_score(self, lst_day, lst_night, rural_base,
                                   pop_density, far, socio_vulnerability,
                                   ndvi_mean, fvc, ndvi_std, albedo, dist_cool_refuge):
        """
        Computes composite DC-URS Score (0 - 100)
        """
        # 1. Thermal Hazard Index (THI)
        uhi_delta = max(0.0, lst_day - rural_base)
        thi = (
            0.40 * np.clip((lst_day - 25.0) / 20.0, 0, 1) +
            0.40 * np.clip((lst_night - 20.0) / 15.0, 0, 1) +
            0.20 * np.clip(uhi_delta / 10.0, 0, 1)
        )

        # 2. Exposure & Vulnerability Index (EVI)
        evi = (
            0.45 * np.clip(pop_density / 25000.0, 0, 1) +
            0.30 * np.clip(far / 5.0, 0, 1) +
            0.25 * np.clip(socio_vulnerability / 10.0, 0, 1)
        )

        # 3. Adaptive Capacity Index (ACI)
        ugs = self.calculate_ugs(ndvi_mean, fvc, ndvi_std)
        cri = np.clip(albedo / 0.60, 0, 1)
        tra = np.exp(-0.002 * dist_cool_refuge)

        aci = (0.50 * ugs) + (0.30 * cri) + (0.20 * tra)

        # Final Composite Calculation
        dc_urs = 100.0 * (
            self.weights['w_A'] * aci +
            self.weights['w_E'] * (1.0 - evi) +
            self.weights['w_H'] * (1.0 - thi)
        )

        return {
            'DC_URS': round(float(dc_urs), 2),
            'ACI': round(float(aci), 3),
            'EVI': round(float(evi), 3),
            'THI': round(float(thi), 3),
            'UGS': round(float(ugs), 3)
        }

# Example usage for Ballygunge vs Baruipur
engine = DeltaClimateResilienceEngine()

# Ballygunge (Dense urban core)
ballygunge = engine.calculate_resilience_score(
    lst_day=42.5, lst_night=31.0, rural_base=32.0,
    pop_density=22000, far=3.8, socio_vulnerability=7.2,
    ndvi_mean=0.18, fvc=0.12, ndvi_std=0.08, albedo=0.15, dist_cool_refuge=800
)

# Baruipur (Peri-urban green space)
baruipur = engine.calculate_resilience_score(
    lst_day=34.1, lst_night=24.5, rural_base=32.0,
    pop_density=4500, far=0.8, socio_vulnerability=4.1,
    ndvi_mean=0.58, fvc=0.54, ndvi_std=0.04, albedo=0.22, dist_cool_refuge=250
)

print("Ballygunge Resilience Score:", ballygunge)
print("Baruipur Resilience Score:", baruipur)
```

**Verified output** (run 2026-07-27):

```
Ballygunge {'DC_URS': 20.01, 'ACI': 0.231, 'EVI': 0.804, 'THI': 0.843, 'UGS': 0.231}
Baruipur   {'DC_URS': 65.23, 'ACI': 0.548, 'EVI': 0.231, 'THI': 0.344, 'UGS': 0.634}
```

---

## 6. Tiered classification system for UI visualisation

| Score range | Resilience tier | UI colour | Actionable guidance |
|---|---|---|---|
| 80.0 – 100.0 | **Optimal Resilience** | `#22c55e` green | Maintain canopy cover and protect ecosystem services. |
| 60.0 – 79.9 | **Moderate Resilience** | `#eab308` yellow | Expand cool roofs and targeted tree corridors. |
| 40.0 – 59.9 | **Vulnerable** | `#f97316` orange | Urgent intervention required: pocket parks & high-albedo coatings. |
| 0.0 – 39.9 | **Critical Hotspot** | `#ef4444` red | Extreme emergency risk: deploy urban greening and cooling centres. |

---

## What v1 ships

**IN — three fixes.** Each is a case where this document contradicts itself or the maths
misbehaves, so v1 cannot ship without them.

| # | Fix | Why it is not optional |
|---|---|---|
| 3 | `VSI` guarded at `NDVI_mean > 0.10` | Unguarded it returns **1.00 for water**: negative NDVI → negative ratio → `clip` floors it at 0 → `1 − 0 = 1`. The Hooghly would score as perfect vegetation stability |
| 5 | §5 **code** wins over the §4 table on pillar weights | The two disagree on EVI and ACI. The code is what produced this document's published 20.01 / 65.23 |
| 6 | Fixed anchors, not min-max | §3 says min-max, §5 uses fixed divisors. Min-max would silently rescore every existing ward when a fourth is added |

**OUT — deferred to v2 by decision.** Each is marked *KNOWN LIMITATION for v2* at the point in
`dc-urs.ts` where it bites, and pinned by an assertion so it cannot be changed silently.

| # | Deferred | Effect while deferred |
|---|---|---|
| 1 | Geometric aggregation | The weighted sum permits **full compensation**: a ward at THI 0.85 / ACI 0.90 scores 8.3 points above one at THI 0.30 / ACI 0.35 |
| 2 | Drop the redundant `FVC` term | `FVC` is an affine transform of NDVI by §3's own definition, so 0.80 of the greenness weight rests on one variable counted twice |
| 4 | Canopy fraction as an independent input | Collected in Phase 1 but inert in v1; an assertion pins it inert |
| 7 | `/25` daytime anchor | The `/20` term saturates at 45 °C, so the index cannot discriminate above that |
| 8 | Czekajlo attribution wording | Documentation only; no code effect |

**Verified:** the shipped engine reproduces this document's own worked examples exactly —
**Ballygunge 20.01**, **Baruipur 65.23**.

Settled: three wards for v1; WorldPop + NFHS-5/Census 2011 for demographics; anchors as specified
here; tier labels ship as written.
