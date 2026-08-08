# Heat-Map Intervention Model — backend formulas

**Status:** implemented · **costs calibrated** 2026-07-24 · **physics validated against
satellite measurement** 2026-07-27 (§0.1). The forcing block (§4) was rewritten after
validation: computed sky temperature, night ET gate, day/night anthropogenic heat split, and
real solar geometry for the calibration. Constants were NOT refitted — the least-squares fit
failed its acceptance bar with every parameter pinned to a bound, so the model keeps its
literature-derived values and the fit output carries an explicit do-not-ship flag. See
[`green-score-methodology.md`](green-score-methodology.md) §5A.
**Companion:** [`heat-map-feature.md`](heat-map-feature.md) (architecture) ·
`src/scripts/climate-engine/types.ts` (ABI + stability math, self-checked).
**Sources:** every formula cites the methods deepsearch (2026-07-24); URL list at the end.

---

## 0 · Model class & what it may claim

This is a **2D energy-balance screening model** (same family as SUEWS/UMEP-class
planning-support tools, not ENVI-met/CFD [7]). To a municipality it may honestly claim:
**relative** scenario comparison, hotspot location, spatial prioritisation, order-of-magnitude
ΔT. It may **not** claim absolute air temperature, hourly forecasts, thermal comfort
(Tmrt/UTCI), 3D shadowing, or any single "we will cool your ward by X.X °C".
Output labels: layers from footprints/OSM = *measured inputs*; ΔT fields = *modelled relative
estimate (2D energy-balance screening)*; kernels = *literature-based*.

### 0.1 Measured accuracy — the claim boundary is now a number

Validated against 49 usable NASA ECOSTRESS scenes over Kolkata (2024-01 → 2026-07). Full
method in [`green-score-methodology.md`](green-score-methodology.md) §5A; the figures the
interface displays live in `climate-engine/accuracy.ts`.

| Phase | scenes | best achievable on this forcing | this model | shown in UI |
|---|---|---|---|---|
| Night | 20 | 2.18 °C | 3.13 °C | **± 3.5 °C**, labelled *calibrated* |
| Day | 12 | 3.33 °C | 4.61 °C | **± 5.0 °C**, labelled *indicative only* |

"Best achievable" is the leave-one-out error of an unconstrained empirical predictor on the
same weather inputs — an upper bound on **any** model driven by this forcing. Night leaves real
headroom. **Daytime does not**: noon surface temperature turns on cloud timing, local sunshine
and soil moisture that 50 km reanalysis cannot resolve, so no physics change moves it. The only
lever is higher-resolution forcing (ERA5-Land at 9 km).

Consequently the model **may not** be presented as quantitative in its daytime phase. The
interface enforces this rather than relying on the reader.

---

## 1 · Core field equation (implemented - `types.ts`, `sim-gpu.ts`, `sim-ts.ts`)

Per-cell temperature `T` on an N×N grid (N=192, ward 1400 m → **dx = 7.29 m/cell**), with
input layers `albedo, veg, built, water ∈ [0,1]`:

```
dT/dt = D∇²T + S·(1−albedo)·sun − kRad·(T−Tsky) − L·veg − h·wind·(T−Tair) + Q·built     (1)
```

Explicit Euler; dt auto-clamped by `stableDt()` to `min(0.25/D, 1.8/k)` where the total
relaxation rate is

```
k = kRad + h·wind                                                                        (2)
```

Water cells relax toward `Tair − 1.5` (thermal-mass shortcut, `sim-gpu.ts` frag).

---

## 2 · Cooling spread — the empirical influence kernel λ (the key design rule)

> **Reframed 2026-07-25.** `D` is **not a thermal diffusivity** and this document previously
> implied it was. Lateral heat conduction between 7.29 m cells is physically negligible — the
> diurnal damping depth in soil is ≈ 0.12 m, some eight orders of magnitude short. Real
> horizontal coupling in the urban surface layer comes from **advection**, which is directional
> and wind-dependent, not isotropic Fickian diffusion. `D` is an **empirical spatial-influence
> kernel**; λ, not D, is the meaningful quantity. λ is kept deliberately short (≈47 m) because
> this field is land-surface temperature, which real thermal imagery shows as sharp; the
> 120–300 m park-cooling distances in the literature are an air-temperature phenomenon.

**Do not add a separate distance-decay kernel.** Equation (1) already produces one: its
steady state is a *screened diffusion* (modified-Helmholtz) equation whose point-response
decays as `K₀(d/λ) ≈ e^(−d/λ)/√d` — the **same exponential family that dominates empirical
park-cool-island measurements** (68 % of cool-core parks fit exponential decay [11]; Hanoi
UGS decay vanishing ~800 m [12]). Adding an explicit `e^(−d/L)` kernel on top would
**double-count** [research §A]. Instead, tune the emergent length:

```
λ = √(D/k)  [cells]  →  λ_m = dx·√(D/k)                                                  (3)
```

**Calibration target:** empirical decay lengths L ≈ 60–150 m, max measurable reach
2–3·λ; **Kolkata-specific: max cooling distance ≈ 420 m, TVoE ≈ 0.77 ha** [4].

**LST-contrast caveat (learned 2026-07-24):** a *single* diffusion constant cannot both
(a) spread a park's cooling ~90 m AND (b) preserve the sharp hot-roof/cool-street contrast
that a **Land-Surface-Temperature** field must show. Buildings here are fine-grained
(interspersed with streets at grid scale), so a large `D` averages every hot rooftop into
its cool neighbours → the field homogenises to its mean and **no reds survive** (observed at
`D=9`: peak stuck < 40 °C, 0 % area > 40, a washed-out map). The 89–420 m park "reach" in
the literature is largely an **air-temperature** phenomenon; our field is labelled LST, which
real imagery shows as *sharp*. So we prioritise contrast.

**Chosen constant:** `D = 2.5` cell²·u⁻¹ (was 0.15; briefly 9.0). `k ∈ [0.032, 0.12]` →
**λ = √(D/k)·dx ≈ 33–65 m** — a park still gets a near-field cooling halo (within Mitra's
67–81 m *mean* cooling distance [5]) while the dense core keeps its red hotspots. Verified:
at live ambient ≈ 30 °C, base mean ≈ 39 °C, **~49 % of the core > 40 °C**, UHI +14° — a
legible heat map. We do **not** claim the full 420 m LST reach (that needs advection we omit).

| Quantity | Value | Note |
|---|---|---|
| CFL dt | `0.25/2.5 = 0.10` | `stableDt` clamps automatically |
| **convergence burst** | `sim.step(1, RESET_BURST=600)` per reset | ~ few ms on the offscreen GPU; live stepping polishes |
| baseline `eqMean` validity | unchanged | boundaries ≈ no-flux ⇒ diffusion approx. preserves the domain mean |

---

## 3 · Per-slider spatial recipes

### 3.1 Tree canopy corridors (0–50) → `veg` along real OSM roads
Street trees: mature crown ≈ 100 m² (r ≈ 5.6 m), municipal spacing s ≈ 8–12 m [8] →
linear canopy `100/s ≈ 8–12 m²` per metre of street.

```
corridor cells = road centerline buffered ±1 cell (buffer width w ≈ 2–3 cells ≈ 15–22 m)
Δveg_cell = min(CAP, 100/(s·w_m))  ≈ 0.45–0.70   with CAP = 0.7                          (4)
slider n ∈ [0,50] activates n/50 of total corridor-km, HOTTEST-FIRST
```

Hottest-first: rank road segments by base-field temperature at segment midpoint —
targeted greening of 1.5 % of a street network cut heat-exposed distance 19 % vs uniform
[9]; ranking is precomputed per ward, deterministic. Saturation is *inherent* (veg CAP +
finite road-km), no extra curve needed.
**Data:** OSM `highway ∈ {motorway…residential, living_street, pedestrian, service}` centerlines
per ward — **fetched** → `previews/heat-map-3d/data/{ward}-roads.json` (500/279/532 ways,
class-weighted width; ODbL attribution on-page).

### 3.2 Cool-roof albedo (0–100 %) → `albedo` on built cells only
LBNL values [6]: dark roof α ≈ 0.10–0.20; fresh white 0.70–0.85; **aged 0.55–0.65**.
Use the honest **aged** value:

```
Δalbedo_cell = built_cell · (slider/100) · (α_cool − α_base),  α_base = 0.15, α_cool = 0.60 (5)
```

Maps 1:1 onto the real Microsoft-footprint raster (`rasterBase` built mask). The slider is
"fraction of roof stock treated" — linear by definition; diminishing *returns in °C* emerge
from (1) (albedo term only acts where sun hits built cells).

### 3.3 Pocket parks / wetlands (0–10) → `veg`/`water` patches on real open land
Kolkata evidence [4]: cool-island intensity `UCI = a·ln(Area) + b`, efficiency threshold
**TVoE ≈ 0.77 ha**, max intensity 4.83–8.07 °C, reach ≤ 420 m. Several medium patches beat
one big one [5].

```
blob radius r = 50 m (≈ 0.77 ha — Kolkata's TVoE = the efficient park size)
inside blob:  park:    veg = max(veg, 0.90), albedo = max(albedo, 0.20)
              wetland: water = 1, albedo = 0.06                                          (6)
placement: rank coarse cells by open-land fraction (1 − built density), enforce ≥ 180 m
           separation (≈ mean spillover distance [5]); deterministic per ward
```

**Consistency check (make it an assert):** local equilibrium drop inside a park
`= L·0.9/k = 0.5·0.9/0.06 = 7.5 °C` — inside Mitra's measured 4.83–8.07 °C band [4]
with default params. The model reproduces the Kolkata literature *before* calibration.
Spread beyond the blob comes from λ (§2), max reach 2–3λ ≈ 190–370 m ≈ the 420 m cap [4].

### 3.4 Vertical green facades (0–15) → effects on built cells (facades ≠ ground veg)
Facades cool by wall shading + ET (wall-surface −13–20 °C locally; ward-scale ≪ 1 °C) [15].
Honest mapping — **never add ground `veg`**:

```
f = slider/15   (fraction of stock retrofitted)
Q_eff,cell = Q·built·(1 − βq·f)     βq = 0.03  ← CITED (was 0.30, uncited)         (7)
```
**Corrected 2026-07-25.** βq was 0.30 with no source. Gunawardena & Steemers 2023
(*Buildings & Cities*, 10.5334/bc.282) is the only neighbourhood-scale measurement found:
green facades cut space-conditioning energy 2.1 %, living walls 5.2 %, and moved heat-island
intensity 1.86 K → 1.81 K (**~3 %**). The dramatic −13 to −20 °C figures are *local wall
surface* effects; the same authors found the vapour flux "advects away to background levels".
**The Δveg_built term is deleted** — its η = 0.15 had no measurement support, and adding
ground vegetation for a wall treatment was double-counting. Facades act on Q only, and are
now correctly shown as a marginal ward-scale lever.
*βq/η are **ET/shading coefficients**, not costs — no cost source covers them; set so
ward-scale facade effect stays ≪ 1 °C, consistent with the wall −13–20 °C *local*-only
evidence [15]. Facade **₹ cost is now solid** (₹9,500/m², §5). Revisit βq/η only if a facade
micro-study is later commissioned.

`P·h_g/A_fp` (perimeter × greened height / footprint area) is computable per ward from the
real footprints + heights already in `data/*.json`.

---

## 4 · Scenario forcing (implemented; constants flagged)

```
peak 13:00:   sun = 1·(1 − 0.6·cloud_live)    tAir = tAir_live + Δpath
              tSky = skyTemperatureC(tAir, rh, cloud)
              L    = L₀·evap(rh)                 Q = Q₀
night 22:00:  sun = 0                          tAir = tAir_live − 2.5 + Δpath
              tSky = skyTemperatureC(tAir, rh, cloud)
              L    = L₀·evap(rh)·0.10·gate      Q = Q₀·0.50
Δpath: 2025 = 0 · SSP2-4.5 '50 = +1.25 · SSP5-8.5 '80 = +4.1   ← CITED (Dhara et al. 2025,
       PLOS Climate 4(11):e0000724, post-AR6 India update). The former −1.2 °C "target"
       pathway is DELETED: no emissions scenario produces regional cooling over India, so a
       negative delta on a physical-temperature axis reads as a forecast and cannot be one.
wind_sim = clamp(wind_live/3, 0.3, 2.5)        (3 m/s ≈ sim wind 1)
```

### 4.1 Sky temperature is computed, not fixed (`sky.ts`)

`tSky` was hard-coded at **17 °C day / 11 °C night**. Those are DRY-sky values, used unsourced
in a humid tropical city where the thermal-IR window is close to opaque and the effective sky
sits only a few K below air. They are now replaced by **Brutsaert (1975)** clear-sky
emissivity with a cloud screen:

```
e   = 6.112·exp(17.67·T/(T+243.5)) · rh/100                          (hPa, Magnus)
ε   = min(1, c·(e/T_K)^(1/7) + 0.9·(1 − c·(e/T_K)^(1/7))·cloud)      c = 1.24
tSky = ε^(1/4)·T_K − 273.15                                          (10)
```

At Kolkata night conditions (28 °C, 80 % RH) this moves tSky **11 → 19.60 °C**. Cross-checked
against Berdahl–Martin and Prata: all three agree within 0.6 °C.

**The sky term cancels exactly in any urban−rural difference** — both cells share `tSky`, so
it sets the temperature *level*, not the *contrast*. That is the wiring test: after this change
absolute temperatures rise and SUHII must not move. Measured delta was 3.55e-15 K (day) and
0 K (night).

### 4.2 Night evapotranspiration (`NIGHT_ET_FRACTION = 0.10`, dewpoint taper)

Stomata close after dark; what remains is soil and canopy-interception evaporation, which
eddy-covariance studies put at **5–15 % of midday**. Running the full daytime `L` overnight
gave parks a cooling advantage they cannot physically hold.

ET is additionally tapered to zero as the surface approaches the dewpoint, because evaporation
is driven by vapour-pressure deficit and that closes continuously:

```
Td       = 243.5·γ/(17.67 − γ),  γ = ln(rh/100) + 17.67·T/(T+243.5)  (11)
L_night  = L₀·evap(rh)·0.10·clamp((T_dry − Td)/1.0, 0, 1)            (12)
```

`T_dry` is the no-ET equilibrium of a representative vegetated cell — the taper depends on the
answer it modifies, so it is evaluated once per frame rather than per cell (cells span ~2 K at
night; only those straddling the dewpoint would differ).

**A hard cutoff was tried first and rejected**: it put a 0.388 K step on park cells at
RH ≈ 86 %, inside the 85–95 % band Kolkata monsoon nights occupy, so the live humidity feed
would have visibly jerked the map. The taper reduces the worst step to 0.024 K, and
`assertInterventionLogic()` now sweeps RH 40–99 % asserting no step exceeds 0.1 K.

### 4.3 Anthropogenic heat day/night (`Q_NIGHT_RATIO = 0.50`)

Traffic, air-conditioning and commercial load all fall after dark but none reach zero. 0.50 is
the round midpoint of published diurnal Q profiles for South and East Asian cities — an
estimate with bounds, not a measurement.

### 4.4 Solar geometry (`solarElevationFactor`, used by the calibration only)

`sun = 1` is correct at local solar noon and nowhere else. ECOSTRESS's day/night flag means
only "sun above the horizon", so calibration scenes span **07:06 to 17:24** local solar time
and comparing them against a full-sun configuration would push solar-geometry error into the
fitted constants:

```
δ    = Spencer (1971) declination series in day-of-year
ha   = (h_solar − 12)·15°                    (local solar time ⇒ no equation-of-time term)
sun  = max(0, sin φ·sin δ + cos φ·cos δ·cos ha)                      (13)
```

Measured against real overpasses, `sun = 1` overstated insolation by **2.9×** at 07:06 and
**6.4×** at 16:42 in January.

**Deliberately not wired into `currentParams`.** The UI's "peak" phase means solar noon, where
`sun ≈ 1` is right. Per-scene geometry belongs to the fit, not the product — same module, two
consumers.

Live ambient: Met Norway per-ward; feels-like via NWS Rothfusz (see `heatIndexC`).

---

## 5 · Green Score (0–100) — grounded, not invented

All the established indices — Berlin **Biotope Area Factor** [1], **Seattle Green
Factor** [2], Singapore **Green Plot Ratio** [3], Malmö GSF — share one shape: a
**weighted-area ratio** `Σ(wᵢ·Aᵢ)/A_domain`. Our score blends that with cooling achieved
and budget efficiency:

```
GreenScore = 100 · clamp( [ min(1,G/G_ref) + min(1,ΔT_cool/ΔT_ref) + E ] / 3 , 0, 1)          (8)

G  = mean over domain of  g_cell
g_cell = clamp( 1.0·veg_ground + 0.6·Δveg_corridor + 0.6·facadeGreen·built
              + 0.1·coolRoof·built + 0.8·water , 0, 1)                                   (9)
```

Weights consolidated from the verified tables (Berlin: in-ground 1.0, wall 0.5, roof 0.7,
sealed 0.0 [1]; Seattle: 0.0–0.7 [2]): **sealed 0.0 · cool-roof 0.1 · lawn 0.2 · shrub 0.3 ·
tree canopy 0.6 · green facade 0.6 · water/wetland 0.8 · in-ground park 1.0**.

- `G_ref = 0.45` — mid of Berlin's own 0.30–0.60 target band [1]
- `ΔT_cool = eqMean(baseline) − mean(T)` (already computed) with `ΔT_ref = 2.5 °C`
  (ward-scale cooling beyond ~2–3 °C is not credible [research §B])
- `E` = budget efficiency = `clamp( (ΔT_cool / cost_₹crore) / E_ref , 0, 1)`, provisional
  **E_ref = 0.15 °C per ₹ crore**. **This is TOOL-RELATIVE, not an external benchmark** — no
  published cost-per-degree-cooled figure exists to normalise against, so a ward can only score
  well relative to what this model can produce. Labelled as such rather than presented as
  grounded.

**Weights corrected 2026-07-25: equal thirds, was 40/40/20.** The old split had no published
precedent and implied greening and cooling were each exactly twice as important as cost. Equal
weighting is the most commonly applied approach in composite-indicator practice (OECD/JRC 2008,
*Handbook on Constructing Composite Indicators*) and the convention in urban-resilience indices.
An arbitrary split dressed as a derived one is worse than a plain citable one.
- **UI must expose the three sub-scores raw** (greening ratio, °C cooled, °C per ₹ crore) —
  transparency is what makes a BAF-style score trusted [1,2].

### Budget (binding) — India ₹ unit costs [C1–C6, all cited]
`cost = Σ (slider activation × physical_quantity × unit_cost_₹)`. Quantities derive from the
real footprints/roads/heights already in `data/*.json`.

| Slider | Physical unit | Unit cost ₹ (range) | Cost formula |
|---|---|---|---|
| **Cool-roof albedo** (0-100 %) | per m² roof treated | **₹150 /m²** coating installed *(budget lime-wash ₹40 /m²; range 16–270)* [C1,C2] | `(slider/100) · Σ roof_area_m² · rate` |
| **Tree corridors** (0-50) | per tree, ~110 trees/km | **₹1,500 /tree** established municipal *(range 500–3,000)* → **≈₹1.65 L/corridor-km** [C3] | `active_km · 110 · rate` |
| **Pocket parks** (0-10) | per 0.785-ha blob (r 50 m) | **₹1.5 cr/ha** → **≈₹1.18 cr/blob** *(bare park ~½; range 1.1–2.25 cr/ha)* [C4] | `n_blobs · 0.785 · rate` |
| **Green facades** (0-15) | per m² wall greened | **₹9,500 /m²** *(range 2,700–17,000)* [C5] | `greened_facade_m² · rate` |

**Cost-effectiveness realism (bake this in):** cool roofs (~₹150/m²) are **~60× cheaper per m²
than green walls** (~₹9,500/m²), parks in between (~₹110–225/m² of park). So the ₹-per-°C knob
*naturally* makes cool roofs the dominant lever — which **matches real Indian Heat Action Plan
practice** (Ahmedabad/Telangana lead with cool roofs) [C1,C6]. A defensible emergent behaviour,
not a designed-in bias.
**Wetland ₹/ha** — no open source found; uses the same park ₹/ha as a **flagged placeholder**.

### Cited display anchors (UI "did you know" / tooltip copy — every one sourced)
| Claim | Figure | Source |
|---|---|---|
| Cool-roof surface-temp drop | up to **−30 °C** (lime white-wash) | Ahmedabad HAP / NRDC [C2] |
| Cool-roof indoor air drop | **−2.1 to −4.3 °C** vs traditional roof | NRDC / Telangana policy [C1,C2] |
| Street trees, afternoon air | **−5.6 °C** (tree-lined vs treeless road, Bangalore); road surface **−27.5 °C** | WRI India [C3b] |
| Canopy dose-response | each **+10 % tree cover ≈ −0.3 °C** ambient | WRI India [C3b] |
| Ahmedabad HAP outcome | **>1,100 heat deaths avoided/yr; −27 % mortality** on ≥45 °C days | PreventionWeb / NRDC [C6] |

These are the "pitch slide" numbers — display them near the relevant slider, cited, so the
tool teaches while it runs. They are *literature anchors*, not this model's outputs (keep that
labelling per §0).

### Diminishing returns (display form)
For marginal-cooling readouts (not the physics — the physics saturates on its own):
`ΔT(n) = ΔT_max·(1 − e^(−k_s·n))` — the canonical saturating form; canopy cooling
accelerates only above ~40 % cover and saturates near 0.8 [18].

---

## 6 · Derived readouts (implemented - definitions of record)

```
Δ vs all-green ref = mean(T) − T_green_ref
T_green_ref         = equilibriumC(params, albedo=0.25, veg=1, built=0)  (synthetic fully vegetated cell
                      under the SAME live forcing, including nocturnal storage)
Area > 40 °C = fracAbove(40) from sim.stats()
Histogram    = 12 bins over T ∈ [26, 48] °C
```

`T_green_ref` is a modelled land-cover counterfactual, not a measured rural station or a
surface/air urban heat-island observation. Both Explore and Compare call the same
`allGreenReferenceC()` / `greenReferenceContrastC()` helpers in `types.ts`; derived evidence is
labelled `heat-metrics-v2`. The corrected reference includes `store`, so only retained/night
contrast changed in this update. The simulated field, model version, forcing records, and
canonical 192×192 grid did not.

---

## 7 · Symbol ↔ code map

| Formula | Code | File |
|---|---|---|
| (1)(2) dt clamps | `SimParams`, `stableDt`, `cflDt`, `decayDt` | `climate-engine/types.ts` |
| (1) solver step | `STEP_FRAG`, `TsHeatSim` | `climate-engine/sim-gpu.ts`, `sim-ts.ts` |
| λ retune | `currentParams D: 0.15 → 2.5` + reset burst | `types.ts` + instrument `resetSim()` |
| (4) corridors | `applyInterventions` + new `roadMask` | instrument (pending build) |
| (5) cool roofs | `applyInterventions` albedo term (retune 0.0032 → eq. 5) | instrument |
| (6) parks | `applyInterventions` park loop (r 63 m → 50 m; placement → open-land rank) | instrument |
| (7) facades | `applyInterventions` + `currentParams` Q_eff | instrument |
| (8)(9) score | replaces `score = round(cooling·38)` | instrument `refreshStats()` |
| §4 forcing | `currentParams()`, `currentParamsForReference()` | `climate-engine/heat-map-model.ts` |
| (10) sky temperature | `skyTemperatureC`, `saturationVapourPressure` | `climate-engine/sky.ts` |
| (11)(12) night ET taper | `dewpointC`, `nightLatent`, `NIGHT_ET_FRACTION`, `DEWPOINT_TAPER_K` | `sky.ts` + `heat-map-model.ts` |
| §4.3 night Q | `Q_NIGHT_RATIO` | `heat-map-model.ts` |
| (13) solar geometry | `solarElevationFactor` | `climate-engine/sky.ts` (calibration only) |
| §0.1 accuracy bands | `ACCURACY`, `bandLabel` | `climate-engine/accuracy.ts` |
| §6 all-green reference | `allGreenReferenceC`, `greenReferenceContrastC` | `types.ts` + instrument |
| runtime backend | `detectHeatCaps`, `HeatSimHost`, worker fallback | `caps.ts`, `sim-host.ts`, `sim-worker.ts` |

**New asserts when implemented:** λ(D=2.5, k=0.06) ≈ 47 m; park local drop ∈ [4.8, 8.1] °C
(Mitra band [4]); eqMean vs converged diffused mean drift < 0.3 °C; corridor Δveg ≤ CAP.

**Self-checks now in place** (all runnable with `node --experimental-strip-types`):

| Check | Asserts | Where |
|---|---|---|
| `assertSkyLogic()` | tSky < tAir always; rises with humidity and cloud; 19–21 °C at 28 °C/80 %; dewpoint ≈ 24.2 °C at 28/80; sun down at 01:00 and 23:00; ≈1 at midsummer noon; ≈0.24 at equinox 07:00 | `sky.ts` |
| `assertInterventionLogic()` | cool roofs and trees cool the mean; built-core equilibrium 40–50 °C; cost monotonic; score bounded; **night ET varies smoothly with humidity (no step > 0.1 K over RH 40–99 %)**; **ET reaches exactly zero below the dewpoint** | `heat-map-model.ts` |
| `assertAccuracyLogic()` | model error never beats the data ceiling; displayed band never understates measured error; daytime never presented as more certain than night | `accuracy.ts` |
| `validate-model.mjs` | 8 checks against published benchmarks, 8/8 passing | `scripts/` |

---

## 8 · Display pipeline (how the field becomes colour — implemented)

One texture, two channels, three consumers:

```
bridgeField(): R = 3×3 box-blur(T)   → ground drape (smooth gradients, no cell dither)
               G = raw T             → building tint (true per-building temperature)
readouts/stats: raw sim field directly (never the blurred copy)
```

- **Buildings sample ONCE per building** at the footprint centroid (`aCtr` vec2 attribute,
  sampled in the vertex shader → flat varying). One building = one thermal object = one
  colour; kills per-pixel hot/cool checkering across a facade.
- **Tint modes** (`uTintMode`, UI chip "Gradient | 5-Class"): 1 = continuous ramp (default);
  2 = snapped to the 5 legend classes (t → .17/.48/.70/.85/.97) — choropleth read, buildings
  visibly change class as interventions cool them. Mode 0 (per-pixel) retired.
- Roof-speckle detail is damped 0.35× in per-building modes (it compounded the noise).

## 9 · Citations (from the methods deepsearch, fetched 2026-07-24)

1. Berlin Biotope Area Factor — formula + weights. ugl.sg/wp-content/uploads/2021/01/20191002_biotope_area_factor.pdf
2. Seattle Green Factor score sheet. app.dcoz.dc.gov/Exhibits/2010/ZC/08-06-9/Exhibit14.pdf
3. URA Singapore — Green Plot Ratio / LUSH. ura.gov.sg/guidelines/development-control/…/greenery/
4. Mitra et al. 2022 (Frontiers Env. Sci.) — tropical megacities incl. **Kolkata**: UCI = a·ln A + b, TVoE 0.77 ha, reach 420 m, 4.83–8.07 °C. frontiersin.org/articles/10.3389/fenvs.2022.1073914/full
5. Zhengzhou park spillover 2023 (Frontiers Earth Sci.) — cooling distance mean 179 m, ~1 °C/100 m, patch-splitting result. frontiersin.org/articles/10.3389/feart.2023.1133901/full
6. LBNL Heat Island Group — roof albedo values. heatisland.lbl.gov/coolscience/cool-roofs
7. UMEP docs (SOLWEIG/SUEWS) — model-class positioning. umep-docs.readthedocs.io
8. Arboriculture & Urban Forestry 2021 — street-tree spacing/crowns. auf.isa-arbor.com/content/47/5/183
9. arXiv 2512.11753 (2025) — targeted street greening beats uniform (1.5 % → −19 %). arxiv.org/abs/2512.11753
10. Blue-green corridors (PMC8622358) — corridor cooling to 600–750 m, optimal width 20–35 m.
11. Yang et al. 2026 (SCS) — 68 % of parks: exponential decay (abstract-verified). sciencedirect.com/science/article/abs/pii/S2210670726002714
12. Nguyen et al. 2025 — Hanoi exponential decline (abstract-verified). sciencedirect.com/science/article/pii/S2590252025000789
15. Vertical greening (Elsevier set) — wall −13–20 °C local (abstract-verified). sciencedirect.com/science/article/pii/S0378778825015142
18. Nature Communications 2021 — 40 % canopy threshold/saturation. nature.com/articles/s41467-021-26768-w

### Cost + India-anchor sources (calibration agent, 2026-07-24)
- **C1.** Telangana Cool Roof Policy 2023-2028 — lime wash ~₹1.5/sq ft; indoor −2.1–4.3 °C. telangana.gov.in/wp-content/uploads/2023/05/Telangana-Cool-Roof-Policy-2023-2028.pdf
- **C2.** NRDC "Keeping It Cool: How India Can Protect… with Cool Roofs" — Ahmedabad white-lime ₹0.50/sq ft; surface up to −30 °C. nrdc.org/sites/default/files/keeping-it-cool-roofs-india-fs.pdf
- **C3.** Grow Billion Trees 2025 — itemised India tree plant+maintain cost build-up (₹120–800 plant; ₹1,000–3,000 3-yr maintained; Miyawaki ₹500–1,200/m²). growbilliontrees.com/pages/what-is-the-cost-of-planting-and-maintaining-a-tree-in-india
- **C3b.** WRI India, "Urban Trees' Cooling Potential" — Bangalore −5.6 °C air / −27.5 °C surface; +10 % canopy ≈ −0.3 °C. wri.org/insights/urban-trees-cooling-potential
- **C4.** Gujarat AMRUT 2.0 urban gardens (ANI, Feb 2026) — Bhavani Garden ₹1.26 cr/1.09 ha; Kailash Vatika ₹2.25 cr/ha. aninews.in (Gujarat 131 urban gardens)
- **C5.** IndiaMart / Bricknbolt vendor ranges — green wall ₹850–975/sq ft typical (₹2,700–17,000/m²). indiamart.com green-wall listings
- **C6.** PreventionWeb / NRDC — Ahmedabad HAP: >1,100 deaths avoided/yr, −27 % mortality on hottest days. preventionweb.net (India pioneering Heat Action Plan)

*Confidence (agent's own flags): cool-roof ₹/m² = HIGH (state policy + NRDC + vendor converge);
tree component costs = MED-HIGH (municipal spec > the ₹299 subsidised NGO package); park ₹/ha =
MED (2 named Gujarat gardens, fully-appointed — bare park cheaper); green-wall ₹/m² = MED
(commercial vendor, excludes irrigation opex); wetland = placeholder (no source).*

*(Methods citations 1–18 above match the methods-agent report; abstract-only sources flagged —
re-verify before quoting verbatim in a client deliverable.)*
