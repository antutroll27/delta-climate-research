# Solar in the console — design

**Date:** 2026-09-05 · **Status:** approved in conversation (Head of Technology, 2026-09-05: a new
Solar section, the card block, the pane) · **Depends on:** the tree-shading pass and its Amendment
A5 (`2026-09-05-pv-tree-shading-design.md`), which put `loss_strict`, `totals` and `stratum` into
`public/heat-map/data/pv-<ward>.json` (commit `99afb8c`).

## 1 · Why

Every building in the three wards now has a certified rooftop-PV screen on the CDN and nothing in
the console reads it. Academics reward the error bar; consultants need a sentence they can put in
a proposal — this roof, this many kilowatts, this much lost to the neighbour's canopy, these ten
roofs first. The number that does that is on the CDN already; this design puts it on the building
the reader clicked, on the ward panel, and in a pane that ranks the roofs and hands over the list.

The preview approved on 2026-09-05 (scratchpad `solar-preview/`) is the visual baseline. Two things
changed after it: the tree term landed and turned out to be three to twelve times the building
term, and the mask rule turned out to be the dominant uncertainty, so **the headline never prints
without its floor**.

## 2 · Decisions

1. **A new rail section, `solar`**, after Analysis, with its own pane on both console routes. Its
   body is `always` (like Layers, Reports, Scenarios): a pane, not a route.
2. **The card block** sits under the measured rows, in the card's grammar, with its own bronze
   provenance line: it is a screening estimate about the building, not a measurement of it.
3. **The ward panel block** is amber, not cyan: heat is calibrated, solar is screening, and a
   reader must never mistake one for the other.
4. **The floor is printed wherever the headline is** — card, panel, pane. The A1-vs-strict mask is
   the largest single lever in every ward (Ballygunge 21.95 % headline, 12.82 % floor). Leaving it
   off would be the riskier choice for the company: the receipts in the repository carry the band,
   the site's whole claim is that it says what it does not know, and a card that hides a known
   nine-point lever is the one thing a sceptical reader would hold against us.
5. **The tariff is an assumption the reader can change**, never a fact we assert. Default ₹8.00 per
   kWh, labelled *assumed · CESC domestic slabs ₹4.07–9.21 (2025-26) · change it*; a solar unit
   displaces the top of a household's bill, so the upper slabs are the honest anchor. Remembered
   in `localStorage` like the clock format, in a `try/catch`, key `delta:hm-tariff`.
6. **No payback figure, anywhere.** Rupees per year at a named tariff is one multiplication a
   reader can check; payback needs capex and subsidy assumptions, and that is where liability lives.
7. **Nothing in the physics or the artefacts changes.** The console reads; it does not compute
   anything the laboratory did not publish, except sorting and a multiplication.

## 3 · Data

`paths.ts` gains `pv: \`${DATA}pv-${area}.json\``. `loadWard` fetches it in its existing
`Promise.all` through `optional(fetch(P.pv))` and caches it per ward in `pvCache`, exactly as
provenance is; a missing file means the solar block, panel block and pane say *no solar screen
ships for this area* and nothing else changes. Type, in `types.ts`:

```ts
export interface PvFile {
  readonly ward: string;
  readonly kwp: readonly number[]; readonly kwh: readonly number[];
  readonly loss: readonly number[]; readonly loss_buildings: readonly number[];
  readonly loss_trees: readonly number[]; readonly loss_raised: readonly number[];
  readonly loss_strict: readonly number[];
  readonly specific_yield: number; readonly packing_factor: number; readonly basis: string;
  readonly totals: { capacity_mwp: number; capacity_mwp_range: readonly [number, number];
    generation_gwh_yr: number; shading_loss_gwh_yr: number; mean_loss: number;
    mean_loss_strict: number; mean_loss_trees: number; mean_loss_raised: number };
  readonly stratum: { threshold_kwp: number; n: number; share_losing_5pct: number; mean_loss: number };
}
```

Arrays join the ward geometry by index, as `pv-<ward>.json` documents; the card reads `pv.kwp[b.idx]`.
A file whose array lengths disagree with the ward's building count is refused (treated as missing,
with a console warning), because a wrong-ward file would otherwise hand every roof a stranger's
figures silently.

## 4 · The card

Inside `#bcard`, after the measured `<dl>` and before the street thumbnail:

```
ROOFTOP SOLAR                          SCREENING
Installable      7.3 kWp     28 % of roof · floor
Yield            9,470 kWh/yr   1,314 kWh per kWp
Shaded           −9 %          of which trees 7 %
At least         −4 %          under a strict roof mask
Raised 2 m       −5 %          elevated mounting · what-if
Worth            ₹66,000/yr    at ₹8.00 per kWh · assumed
Screening estimate · not bankable · canopy Meta/WRI · 0.5 m grid
```

Rows are `dt/dd` in the card's existing grid; the block's header uses the card's `.bc-h` at the
amber token (`--sun`); notes use the existing `dd small` bronze. `Shaded` shows `none` under 0.5 %.
Hidden (`hidden` attribute) when the ward has no solar file. Painted inside `paintCard` from the
cache; repainted when the tariff changes while a card is open.

## 5 · The ward panel

A new `.metric` block after the heat-stress histogram in `.panel.right`:

```
Rooftop solar · installable, whole ward
17.5 MWp
[Screening · 17.5–25.0 MWp · not bankable]           ← amber chip
Annual yield 19.8 GWh · floor      Worth at tariff ₹15.8 cr / yr at ₹8.00
Roofs ≥ 3 kWp 1,840 · 52 % of 3,527   Losing ≥ 5 %  58 % of those
Shading costs 3.2 GWh a year; at least 1.9 GWh under a strict roof mask.
```

All numbers from `totals` and `stratum` — the laboratory's, never re-derived. The chip carries the
packing interval and the headline quotes its floor. Painted on ward load; the rupee line repaints on
tariff change.

## 6 · The Solar pane

`<div class="pane" data-pane="solar">` on the Explore route, `pane-body` layout, `.pane-h` "Solar ·
{area}":

- **Summary note:** *17.5 MWp installable across 3,527 real roofs, the floor of a 17.5–25.0 MWp
  interval. Shading takes 21.9 % of the yield — at least 12.8 % under a strict roof mask; trees are
  17.1 points of it.*
- **Tariff control:** label *Tariff · assumed*, a number input (step 0.25, min 0), and the band note
  from decision 5. Changing it repaints every rupee figure on the page.
- **Best roofs by annual yield:** a ten-row table — `#id`, kWp, kWh/yr, shaded, m². Clicking a row
  selects that building on the map (`select(registry[idx])`) — the pane and the card are one
  object. Footprint from the registry's `areaM2`. Rows over 10,000 m² render in bronze: a single
  footprint that size is a market shed or a merged record, and the reader should see it as one.
- **Honesty note:** *Yield uses NASA POWER irradiance and a Mumbai packing factor; shading is
  computed from this ward's own geometry and canopy, and the mask rule is its largest uncertainty
  (the "at least" figure is the strict-mask floor). Screening only, not bankable.*
- **Download:** `<a class="cta" download="solar-<ward>.csv">Download roof list · CSV ↓</a>`. The
  CSV is built in the browser on first click from the arrays: `idx, lat, lon, footprint_m2, kwp,
  kwh_yr, loss, loss_buildings, loss_trees, loss_strict, loss_raised, worth_inr_yr, tariff_inr_kwh,
  basis`, one row per building, lat/lon from `wardLatLon` of the centroid. Object URL revoked on the
  next ward load.
- On an area with no solar file: *No solar screen ships for {area}. The screen needs footprints,
  heights and canopy, and this area ships none.*
- **On the Compare route** (`PairedBench.astro`): the Layers pattern — *Solar reads one ward's roofs
  on the map; Compare draws two thermal fields and no map.* — with the `pane-out` link to Explore.

## 7 · Files

| file | change |
|---|---|
| `src/components/ClimateEngine/shell/IconRail.astro` | `RailSection` gains `'solar'`; `SECTIONS` gains the entry after `analysis` (sun icon) |
| `src/components/ClimateEngine/HeatMapStage.astro` | the card block markup, the panel block markup, the Solar pane, and their CSS (dark + `body.studio`) |
| `src/components/ClimateEngine/compare/PairedBench.astro` | the Solar pane's "needs a map" body |
| `src/scripts/climate-engine/scope/paths.ts` | `pv` path |
| `src/scripts/climate-engine/types.ts` | `PvFile` |
| `src/scripts/climate-engine/heat-map-app.ts` | `pvCache`, the fetch in `loadWard`, `paintSolarCard` (called from `paintCard`), `paintSolarPanel`, `paintSolarPane`, the tariff store, the CSV builder, row → `select` |
| `tests/unit/obos-shell.test.mjs` | source assertions: the section exists in the rail's typed list, both routes render `data-pane="solar"`, the card block is painted from `pvCache` by `b.idx`, no payback anywhere |
| `tests/e2e/solar-pane.spec.ts` | the real page: rail button opens the pane; ten rows; the panel prints MWp; changing the tariff moves a rupee figure; the CSV download's first line is the header and it has one row per building |

No new dependency. `console-shell.ts` needs no change: it wires every `.pane[data-pane]` generically.

## 8 · Not in scope

Payback or capex; mailto links; the tariff's slab structure; solar on the Compare route; any
change to the physics, the artefacts or the yield chain; the trees file; the 1 m canopy reader
floor (a separate question for the vegetation layer).

## 9 · Verification

- Unit: `npm run test:unit` with the new source assertions.
- E2E: `tests/e2e/solar-pane.spec.ts` on `chromium-tier0`, plus the existing routing and
  console-contrast suites unchanged (the studio contrast gate covers the new amber labels: they must
  clear 4.5:1 on Clay, measured, not assumed — the Trees pill failed exactly this on 2026-09-03).
- `npm run verify` green locally; CI green on the push.
- The preview screenshots, updated with the floor line and the tariff label, as the visual check.
