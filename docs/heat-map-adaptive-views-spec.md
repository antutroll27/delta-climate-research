# Urban Heat Explorer adaptive views

## Product and interface specification

**Status:** Approved contract, implementation review

**Implementation status:** Implemented on `agent/heat-map-adaptive-views`; awaiting product sign-off

**Prototype reference:** `previews/heat-map-p2-p7/`

**Working branch:** `agent/heat-map-adaptive-views`

**Last updated:** 2026-07-25

This document records the approved adaptive-view prototype and the implemented production
contract. The Paired Thermal Observatory amendment below supersedes the earlier 2D-only
comparison decision while preserving the same analytical and fallback guarantees.

The existing [`heat-map-page-spec.md`](heat-map-page-spec.md) remains the contract for
the current Explore instrument. If this draft is approved, its accepted decisions should
be folded into that canonical specification before the production work is merged.

Related references:

- [`heat-map-implementation.md`](heat-map-implementation.md): current production engine plan
- [`heat-map-intervention-model.md`](heat-map-intervention-model.md): model, economics, and claim limits
- [`heat-map-feature.md`](heat-map-feature.md): history and prior decisions
- `PRODUCT.md`: audience, brand, and accessibility principles

---

## 1. Decision summary

### Approved in the prototype

| Area | Product decision |
|---|---|
| Modes | The tool has a focused **Explore** mode and a controlled **Compare** mode. |
| Compare map | Capable devices use two linked Three.js ward scenes; a north-up Canvas relief remains the automatic resilient fallback. |
| Comparison rule | One intervention package is applied to both wards using matched coverage rules. |
| Calibration | Both maps use the same 1.4 × 1.4 km extent and fixed 26–48°C scale. |
| Interpretation | Results describe each ward's response from its own baseline. They do not rank wards. |
| Desktop | Settings, paired maps, evidence, delivered quantities, and integrity notes remain visible together. |
| Mobile | Maps stack vertically and a collapsed, half, or full workspace exposes Settings, Evidence, and Wards. |
| Evidence | Baseline, scenario, cooling, hot area, hot-area change, Δ vs all-green reference, and capital works are paired explicitly. |
| Controls | Ward selection, swap, shared controls, reset, one-level undo, share, and brief actions are functional. |
| Accessibility | Essential tasks work without the map, at 200% text, by keyboard, and with reduced motion. |
| Honesty | Prototype values and maps remain labelled synthetic. Production must expose forcing and version state. |

### Proposed for approval

| ID | Proposal | Reason |
|---|---|---|
| R1 | Keep Explore at `/heat-map/` and add Compare at `/heat-map/compare/`. | Separate routes produce stable links, smaller lifecycles, and safer progressive enhancement. |
| R2 | Add a canonical client-rendered brief route at `/heat-map/brief/`; do not make a modal the only brief surface. | A route is shareable, printable, and navigable within the current static Astro architecture. |
| R3 | Treat the Research Console prototype as an automatic fallback state, not a third primary mode. | Users should receive a complete low-capability view without choosing a technical fallback. |
| R4 | Keep the production controller in vanilla TypeScript with thin Astro shells. | This matches the current engine and avoids a second state system. |
| R5 | Make URL state authoritative for shareable scenario inputs; use session storage only for presentation preferences. | A shared comparison must reproduce the analytical state, not the last local sheet position. |
| R6 | Render both comparison results atomically after the two ward runs settle. | A mixed fresh/stale comparison is analytically misleading. |
| R7 | Add production hardening beyond the prototype: Escape-to-close, selectable URL fallback, and announced invalid ward correction. | These close accessibility and recovery gaps found during the prototype audit. |
| R8 | Use one canonical analytical grid for a comparison; allow device tiers to resample only the display. | The current physics is calibrated in cell units at 192 × 192, so changing grid size changes the model. |
| R9 | Give every control one versioned stock basis shared by its model selector and delivered-quantity calculation; use mapped/model language unless real eligibility masks exist. | Current assets neither prove programme eligibility nor guarantee that selected model cells equal a proportional length or area of the source inventory. |
| R10 | Preserve the 0.1% park-area control only if the model supports a fractional final patch. | The current model applies whole 0.785 ha sites and cannot represent the approved continuous control honestly. |
| R11 | Use a named, pinned regional reference heat-day record for Compare while Explore retains per-ward ambient forcing. | Controlled morphology comparison and local live weather are different analytical jobs. |
| R12 | Progressively enhance Compare into one paired thermal observatory: two equal Three.js scenes, one linked camera state, one shared motion clock, and the existing Canvas relief fallback. | The relationship between fabric and heat is easier to inspect in depth without weakening evidence parity or low-capability access. |

### Explicitly deferred

- The previously identified P6 loading and bundle strategy.
- Blog and CBAM calculator work.
- Astro 7 migration.
- WASM or C++ backends.
- Vulnerability, equity, feasibility, ownership, operations, maintenance, and investment-priority scoring.
- Public indexing before the measured-raster and publication contracts are satisfied.

---

## 2. Product outcome

The adaptive views should let a municipal or programme user answer two different
questions without confusing them:

1. **Explore:** What is happening inside this study area, and how does an intervention
   change its modelled heat field?
2. **Compare:** How does the same policy intensity perform across two different urban
   fabrics under one controlled analytical contract?

Success means the user can understand the method, reproduce the state, distinguish
measured inputs from modelled outputs, and complete the core task on a phone without
depending on 3D interaction.

The interface should feel like a field instrument used by an analyst in mixed office
and site-review lighting: dark, restrained, calibrated, and legible. Colour carries
temperature and state. It is not decorative atmosphere.

---

## 3. Users and primary jobs

### Municipal and programme staff

- Test a common intervention package.
- Compare response across two wards without implying a league table.
- Understand how identical coverage produces different delivered quantities.
- Save or share a reproducible screening record.

### Climate, planning, and sustainability analysts

- Inspect baseline and scenario metrics.
- Verify forcing, model, grid, data, and backend identity.
- Change wards while preserving the shared scenario.
- Review method limitations before using the output elsewhere.

### Prospective clients, press, and general visitors

- Understand the difference between live ambient observations and modelled surface heat.
- See Delta's method without needing to operate a 3D map.
- Read a plain-language screening brief.

---

## 4. Information architecture

### 4.1 Primary routes

| Route | Purpose | Enhancement |
|---|---|---|
| `/heat-map/` | Single-ward Explore instrument | 3D relief where capable; accessible 2D/static equivalent always available |
| `/heat-map/compare/` | Controlled Paired Ward Bench | Linked 3D thermal observatory where capable; paired Canvas relief fallback always available |
| `/heat-map/brief/` | Scenario or paired decision record | Static Astro shell, client-reproduced results, and print layout |

The Explore and Compare navigation must be ordinary links with `aria-current="page"`.
The routes may preserve compatible scenario state when switching modes.

### 4.2 Fallback behavior

The Research Console design is a resilience layer inside the routes:

- It appears automatically when advanced visualization or the preferred engine is
  unavailable and a supported numeric path remains.
- Forcing degradation changes the typed evidence state; it does not by itself imply a
  different interface. An unresolvable Compare reference record follows the explicit
  failure contract in section 12.
- Compare runs through the TypeScript reference solver independently of display tier.
  Three.js is an optional display enhancement, not an analytical dependency.
- It remains complete enough to select wards, inspect forcing state, adjust supported
  inputs, and read numeric results.
- It never calls itself a lesser experience.
- Reduced motion does not automatically imply missing content. It produces a settled
  static field with no orbit or entrance choreography.

### 4.3 Navigation rules

- Entering Compare from Explore carries the active ward into Ward A.
- Ward B defaults to a distinct ward.
- Returning to Explore carries Ward A, the shared intervention package, phase, and last
  Explore map view when those values are valid.
- Browser Back and Forward restore analytical state.
- No critical state exists only in DOM classes or component-local presentation state.
- Heat-map routes use native scrolling. Site-wide smooth scrolling must be disabled for
  these interactive tools.

---

## 5. Explore mode contract

The current Explore specification remains in force, with these adaptive-view additions:

- The top-level mode navigation exposes **Explore** and **Compare**.
- All four intervention levers are present. Pocket parks cannot remain model-only.
- Controls use physical or documented stock-basis units consistently and explain their
  meaning.
- Baseline, Scenario, and change from baseline are distinct values.
- Reset is available whenever any intervention is non-zero.
- Live, stale, and fallback forcing are visually and programmatically distinct.
- Ward controls are native buttons, links, radios, or selects with selected state exposed.
- The map is contextual visualization. The complete task remains possible through
  semantic controls and numeric evidence.
- At phone widths, the Explore instrument may use its own bottom workspace, but it must
  use the same sheet, tab, focus, and 200% text contracts defined below.

The approved comparison work does not replace the existing 3D Explore map.

---

## 6. Compare mode contract

### 6.1 Controlled-comparison rule

Every visible comparison must satisfy all of the following:

- Two distinct ward IDs.
- Equal 1.4 × 1.4 km study windows.
- One controlled reference heat-day record.
- One diurnal phase.
- One model version.
- One canonical analytical-grid contract.
- One data release.
- One backend release.
- One fixed 26–48°C visual scale.
- One intervention package expressed against the same documented stock-denominator rules.

If any item differs, the result is not a valid paired comparison and must not render as
one.

For v1, the recommended canonical grid is the current calibrated 192 × 192 grid
(`dx ≈ 7.29 m` over 1.4 km). Device capability may change canvas resolution and visual
resampling, but it cannot silently change the analytical grid. A new analytical grid
requires a new model/grid release plus documented cross-grid convergence evidence.

### 6.2 Comparison semantics

Each ward is compared with itself:

```
Ward response = Ward scenario result - Ward baseline under the same forcing
```

The UI may compare those response values side by side. It must not describe the ward with
the greater cooling as safer, more vulnerable, more deserving, more feasible, or a better
investment.

The core explanation remains:

> Same policy. Different fabric.

Supporting copy must say that the outputs are within-area responses and not a ward
ranking.

### 6.3 Shared controls

| Control | Comparison unit | Range | Step | Production translation |
|---|---|---:|---:|---|
| Tree corridors | Percent of modelled corridor cells, or segment-based mapped/eligible stock | 0–100% | 1 | Converted to the model's 0–50 input through the same versioned selector used for reporting |
| Cool roofs | Percent of mapped roof stock, or versioned eligible stock | 0–100% | 5 | Direct percentage |
| Pocket parks | Planted-area share of each study window | 0–4% | 0.1 | Converted to area and site equivalents using the 0.785 ha standard |
| Green façades | Percent of modelled programme capacity, or versioned mapped/eligible façade stock | 0–100% | 0.1 | Converted to the model's 0–15 input through the same versioned selector used for reporting |
| Diurnal phase | 13:00 peak or 22:00 retained | 2 states | n/a | Same pinned reference record, phase-specific values |
| Pathway | 2025 reference | Fixed in v1 | n/a | Target 2030 and BAU 2040 remain excluded while illustrative |

Changing any shared control recalculates both wards. Display labels update immediately,
but analytical results update only after both ward runs settle.

The prototype values of 55%, 65%, 3%, and 35% are demonstration values. They must not
become production defaults unless the review explicitly chooses an **Illustrative
package** default and labels it as such.

The approved prototype uses "eligible" and "priority" language, but current production
assets contain mapped roads, footprints/heights, and derived façade proxies rather than
suitability or programme-eligibility evidence. Production must either:

- define versioned predicates, masks, and denominator inventories for eligible stock; or
- use honest v1 labels such as **mapped road network**, **mapped roof stock**, and
  **modelled façade programme capacity**.

Naming the source stock is not enough. The denominator, model selector, and delivered
quantity must describe the same inventory. The current tree model selects hottest ranked
corridor cells, while a proportional total-road-length calculation would report kilometres
from a different basis. The current façade effect is also a built-cell proxy rather than a
selected façade-surface inventory. Production therefore must either:

- implement a segment/surface selector whose raster application and delivered kilometres
  or square metres share one versioned inventory; or
- label the controls as modelled cell/intensity coverage and omit unsupported physical
  delivered quantities.

Pocket-park output must report requested, actually applied, and displayed planted area
consistently. Preserving 0.1% steps requires a fractional final model patch rather than
rounding to the next whole 0.785 ha site.

### 6.4 Ward selection

- Ward A and Ward B use native selects on mobile and may use the same control on desktop.
- The same ward cannot occupy both sides.
- The option already used on the opposite side is disabled.
- Swap exchanges A and B without changing forcing, controls, phase, or evidence versions.
- Tapping a mobile map caption opens the Wards tab with focus placed on the relevant select.
- Changing a ward invalidates its previous result immediately and presents a loading state.

### 6.5 Paired maps

- Capable desktop, laptop, and tablet devices use two real Three.js ward scenes with
  extruded production building geometry, road linework, and the settled thermal field.
- The two scenes share camera azimuth, pitch, zoom, view mode, transition timing, and
  ambient-motion state. Dragging or zooming either scene updates both.
- **Relief** is the default analytical view. **Top** provides a near-north-up inspection
  view without changing the result or temperature scale.
- Ambient motion is qualitative presentation only: a slow linked orbit, thermal sheen,
  and sparse hot-cell activity. It never implies wind direction, live weather, or changing
  model values.
- Motion pauses after direct interaction and resumes only after an idle interval. A visible
  control pauses it indefinitely.
- Reduced motion keeps a settled, interactive 3D result but disables ambient orbit and
  decorative time-based effects.
- Tier 1 reduces geometry density, particles, device-pixel ratio, and frame rate while
  retaining the same analytical field and paired camera contract.
- Tier 0, WebGL/context failure, or renderer initialization failure activates the existing
  paired Canvas relief automatically.
- The two maps have identical dimensions, extent, projection, and temperature scale.
- The maps show production model output over real study-area geometry.
- The approved schematic SVGs do not ship as production ward results.
- Each figure exposes ward name, urban-fabric descriptor, scenario mean, and cooling from
  baseline outside the canvas.
- A text description conveys the spatial pattern when the map cannot be perceived.
- The fixed scale and equal extent are stated adjacent to both maps, not hidden in a method
  note.

### 6.6 Paired evidence

The Evidence view includes:

1. Baseline mean surface temperature.
2. Scenario mean surface temperature.
3. Cooling from baseline.
4. Grid area over 40°C.
5. Hot-area change in percentage points.
6. Modelled Δ vs all-green reference (not a measured urban–rural value).
7. Capital works estimate or range.

Every metric is labelled modelled, derived, observed, or benchmarked as appropriate.

At 22:00 retained phase, the approved prototype marks Grid area over 40°C and Hot-area
change as **Not evaluated**. Production must either preserve that typed unavailable state
or explicitly approve and validate a retained-phase threshold calculation. It must not
coerce unavailable values to zero.

Capital ranges cannot be generated by arbitrary multipliers. Before ranges ship, the
model contract must define cited lower and upper unit costs. If that work is not complete,
the UI displays the existing indicative point estimate with its exclusions instead.

### 6.7 Delivered quantities

Matched coverage does not mean matched raw quantity. The interface therefore shows, for
each ward:

- Corridor kilometres treated when a segment-based selector exists; otherwise modelled
  corridor-cell coverage.
- Roof area treated in square metres.
- Planted area in hectares and approximate site equivalents.
- Façade area treated in square metres when a surface-based selector exists; otherwise
  modelled programme intensity.

These quantities are explanatory evidence, not budgets or feasibility commitments.
Unsupported physical units are omitted, not estimated from an unrelated total.

---

## 7. Mobile Paired Ward Bench

The dedicated mobile surface applies below 768 CSS pixels. It is structurally different
from the desktop grid.

Desktop responsive structure:

- 768–1350 pixels gives the paired observatory the full-width first row; Settings and
  Evidence form a second row below it.
- Above 1350 pixels, Settings, paired maps, and Evidence use the approved three-column
  instrument.
- At 340 pixels and below, nonessential summary copy may retreat, but paired identity,
  state, means, and cooling remain visible.

### 7.1 Collapsed state

- Ward A and Ward B maps are stacked vertically.
- The shared extent and fixed scale sit between the maps.
- A persistent summary dock shows the shared-state label plus both scenario means and
  cooling values.
- The page may scroll when text is enlarged. Content must not be clipped to a viewport.
- The summary button exposes `aria-expanded` and controls the workspace.

### 7.2 Half state

- The approved target is `min(58dvh, 30rem)`.
- The sheet header, paired evidence band, and tabs remain visible.
- Sheet content scrolls independently at ordinary text size.
- The map stage is inert and `aria-hidden` while the sheet covers it.
- Evidence is the default tab unless the user has a valid session preference.
- Delivered quantities, comparison-integrity details, Brief, Share, View maps, and the
  screening caveat remain full-state content and are not duplicated in Half.

### 7.3 Full state

- The workspace fills the area below the compact top bar.
- The full Evidence actions and method details become available.
- The active tab remains visible while content scrolls.
- Closing returns focus to the summary opener.
- Escape collapses the workspace and returns focus to the opener. This is proposed
  production hardening; the approved prototype currently closes only through its controls.

### 7.4 Tabs

The three tabs are:

- **Settings**
- **Evidence**
- **Wards**

They implement the WAI-ARIA tab pattern:

- One selected tab and one tabbable tab.
- Left and Right arrows in the horizontal layout.
- Up and Down arrows when 200% text produces a vertical layout.
- Home and End move to the first and last tab.
- Tab-panel labels reference their controlling tabs.
- Changing tabs resets the panel content scroll position.

### 7.5 Text enlargement and short screens

At 200% text:

- The half state normalizes to full.
- Tabs may become vertical.
- At 320 × 568, the full sheet scrolls as one continuous surface.
- In collapsed state, maps, captions, calibration, and summary reflow into document flow.
- The dock may become static so it cannot obscure Ward B.
- No horizontal scrolling is introduced.

Safe-area insets must be respected on devices with display cut-outs or home indicators.

The prototype's `?text=200` query is approval tooling that simulates enlarged root text.
Production cannot depend on that parameter. The contracts above must pass under actual
browser text enlargement and equivalent automated styles.

---

## 8. Reset and undo

- Reset is enabled only when at least one intervention is non-zero.
- Reset stores exactly one intervention checkpoint.
- A second reset cannot overwrite the checkpoint because the control is disabled at zero.
- The approved prototype exposes Undo on mobile only. Production must decide whether the
  Undo action remains mobile-only or is also visible on desktop.
- When Undo runs, it restores the exact four values in the shared state, so every active
  desktop or mobile projection updates.
- Undo is hidden and invalidated after any subsequent intervention edit.
- Ward changes, phase changes, and swapping do not become part of intervention undo.
- Reset and Undo announce their settled result through one polite status message.

---

## 9. Evidence-state and uncertainty contract

An always-visible evidence stamp must communicate:

| Field | Required values |
|---|---|
| Forcing kind | Explore ward ambient, or Compare reference heat-day |
| Forcing state | Explore: live, stale, or fallback; Compare: reference or fallback-reference |
| Forcing provenance | Explore timestamp/source, or Compare location/date/source and actual phase values |
| Model | Human label plus immutable model version |
| Grid | Resolution and grid-contract version |
| Data | Ward-data release ID |
| Stock basis | Per-lever denominator and selector version |
| Backend | GPU, TypeScript, or future WASM release ID |
| Publication | Screening grade; modelled heat field |
| Pathway | Reference or explicitly illustrative |

Rules:

- Explore never says "Live ambient" when fallback constants are active.
- An Explore weather-request failure changes visible state, not only the console.
- Stale Explore data shows its age.
- Explore fallback forcing states the substituted values.
- Compare never uses live/stale language for its controlled reference record.
- Compare fallback-reference forcing states the substituted values and why the primary
  record was unavailable.
- Results use defensible precision, normally one decimal place for °C.
- A share link pins all analytical version identifiers.
- Version state remains readable in the fallback view.

Forcing semantics differ by mode:

- **Explore** keeps per-ward observed, stale, or fallback ambient forcing.
- **Compare** uses one named regional reference heat-day record so urban-fabric response is
  controlled. The reference location, date, source, and actual 13:00/22:00 values must be
  stated.
- Compare must not label a derived `latest observation - 2.5°C` value as an observed 22:00
  condition.
- Until the reference heat-day record exists, Compare remains an approval/synthetic surface.

---

## 10. URL and persistence contract

### 10.1 Analytical state

The Compare URL encodes:

| Parameter | Example |
|---|---|
| `a` | `ballygunge` |
| `b` | `baruipur` |
| `trees` | `55` |
| `roof` | `65` |
| `parks` | `3` |
| `facades` | `35` |
| `phase` | `peak` |
| `contract` | `paired-coverage-v1` |
| `forcing` | immutable forcing ID |
| `model` | immutable model release |
| `grid` | immutable grid contract |
| `data` | immutable ward-data release |
| `stock` | immutable composite stock-basis release |
| `backend` | immutable backend release |

Invalid values are clamped or replaced with documented defaults. Ward duplication is
resolved to the next valid distinct ward and announced.

If a receiving device cannot execute the pinned analytical grid through either supported
backend, it must show an explicit cannot-recalculate state. It may display a retained,
integrity-checked result snapshot only when the chosen share architecture includes one.

This is a proposed production schema. It deliberately replaces the prototype's
`pairTrees`, `pairRoof`, `pairParks`, `pairFacades`, capitalized ward names, and
`returnView` vocabulary with stable lowercase slugs and shorter analytical keys.
Implementation must either translate prototype-format links or explicitly declare them
non-production test links.

### 10.2 Presentation state

The following may use session storage and are not required in share links:

- Mobile sheet state.
- Active mobile tab.
- Last Explore visual mode.

Storage failures must not prevent use of the tool.

### 10.3 Share action

- Copy link serializes the current settled state.
- While a recalculation is pending, the action is disabled or clearly says it will share
  the previous settled result.
- Success and failure are announced.
- If Clipboard API access fails, the interface exposes a selectable URL.

The selectable URL and announced duplicate correction are proposed hardening. The
prototype currently reports only "Copy unavailable" and silently rejects duplicate wards.

---

## 11. Brief contract

The canonical brief is a route, not an image export.

This is an expansion beyond the approved modal preview and therefore remains part of
proposed decision R2.

The current site is a static Astro build. In the recommended v1, the route can render its
title, method, caveats, attribution, and invalid-state help without JavaScript, but numeric
scenario results are reproduced client-side from the URL. Server-rendered arbitrary
results require a later SSR/API architecture and retained forcing/result storage.

It contains:

- Title and screening-grade label.
- Ward or paired context.
- Shared scenario definition.
- Forcing and version evidence.
- Baseline, scenario, and response metrics.
- Delivered quantities.
- Capital-cost basis and exclusions.
- Comparison-integrity statement.
- Source attribution.
- Print styles.

The paired brief repeats that results are not a ward ranking. It does not imply
vulnerability, equity, ownership, feasibility, operations, maintenance, or investment
priority.

If the URL cannot reproduce a valid settled result, the route shows a readable error and
a link back to the relevant instrument.

---

## 12. Loading, empty, error, and stale states

### Initial load

- Render the route shell, labels, method copy, and empty evidence structure before the
  engine settles.
- Use bounded skeletons for result values and maps.
- The honesty and evidence-state stamps never disappear behind a loader.

### Recalculation

- Controls remain operable.
- Both result columns show a coordinated pending state.
- Previous values may remain visible only when labelled as previous.
- The result update is atomic.
- Status announcements fire after settlement, not on every slider event or simulation frame.

### Single-ward failure

- Identify which ward failed and why.
- Do not render comparative synthesis from one fresh and one failed result.
- Preserve the scenario controls and offer Retry.

### Explore live-forcing failure

- Switch to visible fallback state.
- Show fallback values and their consequence.
- Keep the screening tool usable.

### Compare reference-record failure

- Do not silently substitute independent live ward observations.
- Identify the missing or unresolvable reference record.
- Keep controls usable, but withhold paired results and sharing unless an approved,
  explicitly labelled fallback-reference record can reproduce both runs.

### Geometry or WebGL failure

- Activate the Research Console fallback.
- Preserve controls and numeric evidence where a supported engine remains available.
- Never show an empty black canvas as the complete response.

---

## 13. Accessibility contract

Target: WCAG 2.2 AA.

- A valid `main` landmark matches the skip link.
- All actions are native links, buttons, inputs, selects, or correctly implemented tabs.
- Selected state uses `aria-current`, `aria-pressed`, `aria-selected`, or native state.
- All visible touch targets are at least 44 × 44 CSS pixels.
- Range controls expose visible labels, current output, units, and `aria-valuetext`.
- Dynamic results use one debounced polite status region.
- Covered mobile map content is inert and hidden from assistive technology.
- Opening and closing sheets, fallback panels, and any dialog-like surface has deliberate
  focus entry and restoration.
- If R7 is approved, Escape closes the mobile workspace and restores opener focus.
- Maps have equivalent names, metrics, spatial descriptions, scale, north orientation,
  and data tables.
- Temperature colour never carries meaning alone.
- Text reflows at 200% and at a 320 CSS-pixel width without two-dimensional scrolling.
- Reduced motion removes ambient orbit, field transitions, and decorative pulse while
  preserving a settled result and direct camera inspection.
- Forced-colours mode preserves control boundaries, focus, and selected state.

---

## 14. Visual and interaction language

- Reuse the current heat-map tokens and Mona Sans / Noplato Mono typography.
- Keep a restrained dark instrument palette with cyan for active state, bronze for
  evidence/screening state, and the heat ramp for temperature only.
- Avoid introducing a second card vocabulary.
- Use hairlines, calibrated spacing, fixed scales, and repeated A/B labels to communicate
  instrument structure.
- Do not use blur as the only separation between a sheet and the map.
- Motion lasts 150–250 ms for interface state changes and uses an exponential ease-out.
- Do not animate layout dimensions continuously.
- The desktop and mobile interfaces must share labels, units, and state semantics even
  when their layouts differ.

---

## 15. Acceptance criteria

The feature is product-complete only when:

- Explore and Compare are navigable by ordinary links.
- Both modes use the production model, real geometry, and the same evidence vocabulary.
- Both paired wards recalculate under one immutable comparison contract.
- No stale ward value is presented as part of a fresh comparison.
- Compare uses equal linked ward scenes, equal extent, and one fixed temperature scale;
  its Canvas fallback remains north-up and analytically equivalent.
- All seven paired evidence measures have explicit provenance and units.
- Desktop and mobile controls remain synchronized.
- Ward duplication is impossible and Swap preserves the scenario.
- Reset and one-level Undo meet the lifecycle in section 8.
- Share URLs round-trip the analytical state and version identifiers.
- The brief route reproduces the settled state.
- Explore live/stale/fallback and Compare reference/fallback-reference states are
  distinguishable without sharing inaccurate labels.
- The Research Console fallback preserves the core task.
- 320 × 568, 390 × 844, 767, 768, 1024, and 1440-pixel viewport checks pass.
- 200% text, keyboard-only, reduced-motion, and screen-reader flows pass.
- Automated WCAG 2.2 AA checks have no unwaived violations.
- The current production build and Explore route do not regress.
- The canonical analytical grid is explicit, versioned, and unaffected by device tier.
- Browser rasterisation differences cannot change the canonical footprint mask or any
  paired analytical result.
- Each control label, model selector, and delivered quantity uses the same versioned stock
  denominator; unsupported physical quantities are omitted.
- Requested, applied, and reported park area agree.
- Compare identifies a real controlled reference record rather than implying shared live
  ward weather.
- A non-GPU simulation path produces the complete mobile task.
- Explore, Compare, and Brief remain `noindex` and absent from the sitemap until the
  existing publication gate is satisfied.

---

## 16. Review decisions required before implementation

1. Approve or reject the route split in R1 and R2.
2. Choose the Compare initial state:
   - zero interventions; or
   - the prototype's labelled Illustrative package.
3. Confirm whether capital works may remain a point estimate for the first integration,
   or whether cited lower and upper cost ranges are required before the UI lands.
4. Confirm Evidence as the default mobile tab.
5. Confirm that the Research Console becomes automatic fallback rather than a primary mode.
6. Confirm whether session-persisted mobile sheet and tab preferences are desirable.
7. Approve or reject the R7 production-hardening behaviors.
8. Choose whether Undo remains mobile-only or is exposed on desktop too.
9. Choose the reproducible forcing strategy:
   - encode normalized phase values, reference location/date, source, and checksum in the
     URL; or
   - resolve an immutable reference-record ID through retained storage.
10. Approve R8's canonical 192 × 192 analytical grid for v1, or fund a metre-based
    recalibration with cross-grid convergence tests.
11. Approve R9's denominator contract for each lever:
    - add segment/surface selectors so physical kilometres and square metres share the
      model's applied inventory; or
    - use modelled cell/intensity coverage and omit unsupported physical quantities.
    In either case, define real eligibility predicates and masks before using eligible or
    priority language.
12. Choose the R10 park-area behavior:
    - implement a fractional final patch and preserve 0.1% steps;
    - snap steps to whole 0.785 ha sites; or
    - retain the current whole-site control.
13. Approve R11 and identify the regional reference heat-day source, location, date, and
    actual phase values.
14. Confirm the static client-rendered brief architecture, or explicitly add SSR/API and
    retained result storage to scope.

No production implementation should begin until all decisions above are recorded.
