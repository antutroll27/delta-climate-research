# Interactive Gaussian splat view — PHASE 1 READY

**Status:** **Phase 1 (de-risking) CAN START NOW.** Phase 2 (ward capture) wants a 360
camera. No open design questions, no unresolved licence risk, no missing research.

**Corrected 2026-08-09**, twice, both times overstating the blocker:

1. First written as *"blocked on hardware only"*. Wrong — two of the three phase-1 items
   (fill rate, alignment fit) need **no camera at all**. See §9.
2. Then assumed a 360 camera was required. Also wrong — a **DJI Osmo Action 5 Pro is
   already owned and is sufficient for the entire de-risking phase.** A 360 buys
   *efficiency* on long streets (roughly 3× fewer walking passes), not capability. Settings
   matter far more than camera choice: **see §5a, and note that the default stabilisation
   setting will destroy a reconstruction.**
**Written:** 2026-08-09, from Learning Sunday 01 plus the capture discussion that followed.
**Background reading:** [`docs/learning-sunday-01-3d-twins-simulation-splatting.md`](../../learning-sunday-01-3d-twins-simulation-splatting.md)
and the notes in [`docs/research/`](../../research/).

---

## 1 · The idea

Keep the current procedural 3D heat map exactly as it is — it is honest, fast, and runs on
a ₹8,000 Android. **Add** an opt-in photoreal Gaussian-splat view alongside it, built from
ground-level 360 capture, and make that view the **default for the flood simulation**.

## 2 · Decision log — settled, do not re-litigate

Each of these cost real investigation. They are recorded so nobody spends the day again.

| # | Decision | Why |
|---|---|---|
| **D1** | **Google Earth Studio / GBM is CLOSED to us.** | Google's Geo Guidelines: *"You may not use output, or use third party tools to capture output, from Google Earth, Google Earth Pro, or **Earth Studio** to **reconstruct 3D models**…"* — names the technique specifically. Plus *"may not be used for any commercial or promotional purposes."* Earth Studio's FAQ permits *"research, education, film and nonprofit"* only. We are commercial. **Do not revisit without a licence change from Google.** |
| **D2** | **Drones are out; ground-level 360 is in.** | The Barrackpore restriction is on *airspace*. A 360 camera on a footpath never enters it. **Separate hazard, respect it:** photographing the air force station itself is Official Secrets Act territory, not a ToS matter. Ward streets yes; cantonment perimeter no. |
| **D3** | **Splat is the wrong default for solar.** | A splat stores radiance under capture-time lighting — the capture day's shadows are baked in and would sit underneath the simulated ones. Relighting needs inverse rendering (SSD-GS, GI-GS, Phys3DGS, BRDFusion), all 2026 research, none production. |
| **D4** | **Solar needs no capture at all.** | Solar potential = direct beam × shadow mask × sky-view factor, computed on roof geometry. We already hold footprints and heights; the kernel is the shadow/SVF work already identified for the heat map. Photoreal adds nothing a solar customer needs. |
| **D5** | **Splat view is a tier-2 display mode, never a physics input.** | `caps.ts` already maps tier → display mode and carries the invariant *"capability tiers may only change execution and display quality."* The grid stays 192 on every tier. The splat changes what you see, never what we computed — and an existing assertion enforces it. |
| **D6** | **Georeference by footprint fit, not by GPS.** | Phone GPS is 3–5 m; sim cells are 7.4 m. See §6. |
| **D7** | **Fully permissive toolchain, self-hosted, no cloud service.** | See §7. Post-D1, we do not want another pipeline whose terms we have to renegotiate. |

## 3 · Which view each simulation gets

| product | default view | capture required |
|---|---|---|
| **Heat** | procedural relief — **unchanged** | none |
| **Flood** | **splat** | street-level 360, no permits |
| **Solar** | mesh + real shading | **none** — geometry we already hold |

Flood is the case that genuinely wants photoreal: a flood is experienced at eye level, and
*"water to here, on your street"* is inherently a street-level image. It needs no roofs,
which is exactly what ground capture cannot give.

## 4 · Architecture

```
                 ┌──────────────────────────────┐
   192×192       │  physics raster (unchanged)  │  ← the twin
   solver ──────▶│  temperature / depth field   │
                 └───────────────┬──────────────┘
                                 │  one shared coordinate frame
                 ┌───────────────┴──────────────┐
        ┌────────┴────────┐            ┌────────┴────────┐
        │ procedural view │            │   splat view    │
        │ all tiers       │            │ tier 2 only     │
        └─────────────────┘            └─────────────────┘
```

The rule from the research, which this plan exists to honour:

> The visual representation and the physical representation should not be the same thing.
> Splats for appearance, raster for physics, **one shared coordinate frame** between them.
> The frame is the asset; the representations plug into it.

**Implementation shape:** extend `MapMode` with `'splat'`; `TIER_MODE` offers it at tier 2
only; the splat asset is lazily fetched so tier 0/1 never downloads it. `assertCapsLogic`
gets a case asserting tier 0 and 1 can never resolve to `'splat'`.

## 5 · Capture protocol (for the day the camera arrives)

1. **Shoot RAW dual-fisheye, not stitched equirectangular.** Let the pipeline treat the two
   lenses as separate cameras rather than inheriting the camera's stitch. Seam parallax is
   worst in confined spaces — i.e. exactly a Ballygunge *gali*. (See Seam360GS,
   <https://arxiv.org/pdf/2508.20080>, for the research version of this problem.)
2. **Test GPS embedding on one 30-second clip first.** There are field reports of the Osmo
   360 not embedding metadata reliably. [GPS for Action](https://gps-for-action.pages.dev/)
   streams phone GPS over Bluetooth *and* writes a separate GPX — belt and braces. A capture
   day with no track is a wasted capture day.
3. **Shoot overcast, and shoot dry.** Flat light bakes softer shadows into the radiance. For
   a flood product you want the "before" state anyway.
4. **Walking pace, continuous, with loop closures.** Re-walk each street's endpoints so SfM
   gets loop constraints. 360 footage is unusually well-conditioned for this — every frame
   sees in all directions.
5. **Do NOT try to capture the whole ward.** A 1.4 km square is roughly 20 km of street.
   **Capture the corridors the flood model flags as at-risk.** The physics tells you where to
   point the camera — which is both cheaper and a far better story than "we walked
   everywhere."

## 5a · DJI Osmo Action 5 Pro — settings (owned; use this for Phase 1)

Hardware: 1/1.3" sensor, F2.8 lens, **155° FOV**, 4K up to 120 fps.

| setting | value | why it matters |
|---|---|---|
| **RockSteady / HorizonSteady / HorizonBalancing** | **ALL OFF** | **The one that kills reconstructions.** EIS warps and crops each frame *differently*, so intrinsics change frame-to-frame; COLMAP assumes one fixed intrinsic model per camera. Documented GoPro equivalent: *"aggressive electronic stabilization warps the frame in ways COLMAP cannot model."* Walk smoothly instead. |
| **FOV** | **Standard (Dewarp)** | 155° is heavily fisheye. Dewarp gives near-rectilinear frames COLMAP fits with a simple radial model. Ultra-wide + `OPENCV_FISHEYE` also works, but don't vary two unknowns on a first test. |
| **Exposure** | **locked / manual** | auto-exposure drift between frames bakes inconsistent radiance into the splat → floaters and blotches. |
| **Shutter** | fast as light allows | motion blur is poison for SfM — it was the actual culprit in a documented 3DGS failure with EIS-on 4K footage. |
| **Frame rate** | 4K/60 | frames get subsampled anyway; 120 just fills the card. |
| **Colour profile** | standard, **not D-Log M** | the splat bakes colour in; log adds a grading step for no gain. |

**GPS:** sources conflict on whether the 5 Pro has GPS built in or needs the Osmo Action GPS
Bluetooth Remote — **check on the device**. Either way the phone route
([GPS for Action](https://gps-for-action.pages.dev/)) supports the Action 5 Pro. Per **D6**
this is a coarse prior plus scale only; the Overture footprint fit does the real work.

**Capture pattern for a single lens.** One object (Phase 1): orbit it at walking pace, then a
second orbit at a different height/angle. One street (Phase 2): three passes — up one side
angled across, back down the other, plus an upward pass for facade tops. That 3× is exactly
what a 360 camera would collapse into one pass, and the only reason to buy one.

## 6 · Georeferencing — the technical core

**The problem.** Phone GPS is 3–5 m. Our simulation cells are 7.4 m (1,424 m ward / 192).
GPS alone lands the splat within roughly one cell of correct — enough to find the street,
nowhere near enough to overlay on the physics raster or to trust a flood depth against a
kerb. Monocular SfM also has **no absolute scale**.

**The solution, and we have already proved this method in this codebase.** We hold 12,767
Overture building footprints with validated `lonlat` for all three wards. Use:

- **GPS track** → coarse position prior + absolute scale (track length).
- **Footprint fit** → precision. Match the reconstruction's building-footprint outlines
  against our Overture footprints and solve for the rigid transform.

This is the same class of numerical fit that settled the north–south mirror bug — pond
centroids fitted against `ballygunge-water.json`, **8.9 px RMS**, with the camera centre
falling out of the data as independent confirmation. That episode's lesson applies directly:
**fit numerically against known features; never eyeball an alignment, and never trust a
reconstructed transform three times in a row without a ground-truth test.**

**Acceptance bar (pre-registered):** median footprint-centroid residual **≤ 1.0 m**, p95
**≤ 2.5 m**, against Overture. Below that the splat cannot be trusted to sit on the physics
raster and must ship as decorative context only, clearly labelled.

### 6.1 · MEASURED, 2026-08-09 — `scripts/splat-align-dryrun.py`

Run before any capture, against the real 3,527 Ballygunge footprints. Synthetic captures:
known transform applied, correspondence destroyed, buildings dropped and floaters added.

**Result — the method works, but only with ward-scale coverage.**

| capture | ICP from compass prior | global rotation search |
|---|---|---|
| **whole ward** (n≈3300) | 83 % | **100 %** |
| corridor 200 m (n≈490) | 33 % | 21 % |
| corridor 80 m (n≈226) | 17 % | 35 % |
| courtyard r=60 m (n≈14) | 0 % | 0 % |

*(% of 48 trials recovering the true transform to ≤1 m.)*

**Four findings that change the protocol:**

1. **ICP here is bimodal** — exact recovery or a wrong basin, nothing between. A median
   residual hides this completely, so the script scores **success rate**, and scores
   *recovery of the known transform*, never residual. Residual alone would have shipped a
   one-building-off alignment.
2. **The compass cannot be on the critical path.** Reliability needs heading to ≤1–2°;
   phone magnetometers are ±5–15°. The global rotation search removes the dependency and
   takes the whole ward from 83 % → 100 %.
3. **§5a's corridor advice was wrong and is retracted.** The earlier claim that corridors
   are translationally degenerate came from a bug in the harness, not from geometry. With
   clean data, corridors of every width (80 m–1400 m) recover at 81–98 %. **Shape is not
   the problem — COVERAGE is.** An L-shape or loop is not required.
4. **Missing and spurious buildings are non-issues.** 30 % dropped and 25 % floaters had
   *zero* effect. Trimmed ICP absorbs both. Only reconstruction noise matters, and it just
   sets the residual floor (1 m noise → 1.2 m median residual, recovery still 0.07 m).

**Protocol consequence:** a capture must cover a **substantial fraction of the ward**, not
one street. A single corridor cannot be reliably georeferenced against the ward footprint
set, and a lone courtyard cannot at all.

**Null result, recorded:** floater contamination of the centroid was hypothesised as the
corridor failure and a geometric median (robust *and* rotation-equivariant, unlike
`np.median`) was implemented to fix it. It measured **worse** (100 % → 98 % whole ward), so
the hypothesis is wrong and the code was removed.

**Still assumed, not tested:** scale is handed to the fit as known. In reality it comes from
GPS track length and carries error. That is the next thing to sweep.

## 7 · Toolchain — permissive end to end

| stage | tool | licence | note |
|---|---|---|---|
| structure-from-motion | [COLMAP](https://github.com/colmap/colmap) | **new BSD** | GitHub mislabels it `NOASSERTION`; the `COPYING.txt` is plain BSD-3 |
| pipeline, native equirect handling | [nerfstudio](https://github.com/nerfstudio-project/nerfstudio) | **Apache-2.0** | |
| splat training | [gsplat](https://github.com/nerfstudio-project/gsplat) | **Apache-2.0** | |
| masking people / traffic | [SAM2](https://github.com/facebookresearch/sam2) | **Apache-2.0** | |
| compression | [spz](https://github.com/nianticlabs/spz) | **MIT** | ~90 % smaller than PLY |
| browser rendering | [spark](https://github.com/sparkjsdev/spark) | **MIT** | three.js-native, matches our stack |

**Do not use:**

- **`SPAG4d`** (221★, surfaces in every 360-to-splat search) — **no licence file at all**,
  which defaults to all rights reserved. Worse than a restrictive licence.
- **`graphdeco-inria/gaussian-splatting`** and **`hierarchical-3d-gaussians`** — the Inria
  research licence. The 22.9k-star canonical repo is **not** commercially usable.
- **Cloud conversion services** (Splatica, FreeGaussian and similar) — may be fine, but
  after D1 nothing goes into a pipeline whose output terms we have not read.

**The general rule this encodes:** in this field the paper repository is usually
research-licensed and the ecosystem reimplementation is usually permissive. Check the
reimplementation.

## 8 · Known risks

| risk | severity | note |
|---|---|---|
| **Trees** | **highest** | Ballygunge's canopy is heavy, and foliage is 3DGS's classic failure — thin structures plus leaves that move between frames. The tree cover that makes the ward cool is what will wreck the reconstruction. |
| **Fill rate on tier 0/1** | high | Splats are fragment-bound, and integrated GPUs have least headroom there. Mitigated by D5 (tier 2 only) — but measure before promising. |
| **Moving objects** | medium | Traffic and pedestrians produce floaters. SAM2 masking, already in the chain. |
| **Ground elevation** | medium | Flood depth is exquisitely sensitive to ground height, and our terrain surface sits **~6 m above true ground** (ICESat-2, `underpowered` at n=28). This is a flood-model problem, not a splat problem, but it lands in the same feature. |
| **Alignment** | medium | Bounded by §6's pre-registered bar. |

## 9 · Phasing

Ordered so the cheapest falsifier runs first, and so nothing waits on a purchase.

### Phase 1 — de-risking. Nothing here is blocked.

**9.1 · One treed courtyard, one afternoon.** *(Action 5 Pro, §5a settings.)* Capture the
**highest-risk condition, not the easiest** — heavy canopy, because foliage is 3DGS's classic
failure and Ballygunge's tree cover is the whole reason the ward is cool. Run it end to end
through §7. **If the canopy destroys the reconstruction, this plan changes shape and we have
lost an afternoon**, not a capture programme. Same discipline as the SVF sign test: run the
thing that can fail, first.

**9.2 · Fill rate on a real tier-1 device.** *(No camera needed — Spark ships example
assets.)* This decides whether a tier-2 splat view is viable on Indian hardware at all.
Measure before any UI work. Fine to benchmark with someone else's scene; do not ship one.

**9.3 · Alignment dry-run. ✅ DONE 2026-08-09 — see §6.1 for results.**
`scripts/splat-align-dryrun.py`, type-clean under the repo's strict mypy, with a
`--self-check` (Umeyama exact to 1e-9, ICP recovers, a north–south mirror refused rather
than fitted as a rotation) and a `--diagnose` mode. **Verdict: the method works at ward
scale (100 %), fails on single corridors, and §5a's corridor advice is retracted.**

### Phase 2 — needs a capture programme

4. Corridor selection — let the flood model choose the streets (§5.5).
5. Street capture. A 360 camera pays for itself here and only here.
6. The tier-2 `'splat'` display mode and the flood view.

**Gate between phases:** all three Phase 1 results reported — including failures — before
any camera is bought or any capture day is booked.

## 10 · Open questions

- **Airspace class over Ballygunge / Baruipur** — irrelevant while D2 holds, relevant if a
  drone is ever an option. Kolkata's proximity to NSCBI airport likely means yellow zone
  (permission) rather than Barrackpore's prohibition. **Unverified.**
- **Commercial street-level collection under India's 2021 geospatial guidelines** — believed
  liberalised for Indian entities. **Unverified — check before a capture programme**, though
  not before a one-street test.
- **Which camera.** Osmo 360 was the assumed unit; Insta360 X4/X5 has the more mature
  splatting ecosystem (there is an official Insta360 × Splatica partnership). Worth comparing
  when actually buying.
- **Does the flood model output a depth field the splat view can consume?** Not yet built.
  The flood simulation is itself a future product.
