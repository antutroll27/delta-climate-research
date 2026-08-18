# OBOS basemap theme — design

**Date:** 2026-08-13 · **Status:** built, awaiting CEO sign-off to commit · **Name:** OBOS (was CUSP for
part of the same day — see `cusp-twin-name` memory)

## The problem

`STYLES.dark` shipped stock OpenFreeMap `dark`: `rgb(12,12,12)` ground, neutral grey roads, near-black
buildings — **pure greyscale, no chroma anywhere**. That is why the instrument read as generic under our
own data. Nothing was wrong with it; it simply had no identity, and the identity is part of the pitch.

## Where the look came from, and what we did NOT take

Reference is **Mapbox Standard's dusk preset over Paris**, used as a **moodboard only**. Its one real idea
is a **warm/cool inversion** — cool ground, buildings the only warm mass — which is why the city reads
without a single outline.

**Nothing was ported.** Not the style JSON, not a tile, not an asset, and no token was ever accepted (the
user offered; it was declined so the project keeps **zero Mapbox dependencies**). Mapbox Satellite was used
as *eyes only* — never traced, never used to derive vegetation or roads. A palette and a visual hierarchy
are not copyrightable; the style document is.

## Decisions

### 1 · Derived from upstream, not authored from scratch
`REPLACED_ROAD_GEOMETRY` (`road-labels.ts`) hides basemap roads **by id** — `highway_minor`,
`highway_major_casing`, `highway_major_inner`, `highway_major_subtle` — and those ids belong to
OpenFreeMap's dark style. A hand-written style renames them, the relief handoff silently stops hiding
roads, and basemap streets paint underneath the 3D city. `scripts/build-map-style.mjs` forks upstream and
recolours, so every id survives by construction; it **throws** rather than no-op if upstream renames one.

Build-time, not `setPaintProperty` at runtime: patching 47 layers after every `setStyle` means a visible
flash of upstream colours and a second place the palette lives.

### 2 · Three variants, one token contract
`dusk` (closest to the reference), `petrol` (teal, warm removed), `slate` (**shipped**). Slate inverts the
mass — buildings **lighter** than the ground, the way an architectural drawing renders footprints —
because at Kolkata's parcel grain that is the only variant where extrusions still resolve as individual
buildings rather than texture, and because it removes warm from the basemap entirely so the heat ramp
owns warm outright. Rotated to ~258° violet at the CEO's request; inverted mass verified numerically
(buildings +26.9 luma over ground).

**Water and parks deliberately do not rotate with the hue family.** They are the only two places on this
basemap where colour carries *meaning* rather than mood — a violet river would be a decorative lie, and
the green must survive contact with the vegetation layer that sits on top of it.

### 3 · Three values were tuned against renders, not swatches
- buildings `#2f2721`→`#282219`, light `0.42`→`0.28` — the first pass came back mustard-olive and dominated
  the frame; Kolkata puts far more building pixels on screen than Paris, so the same tone reads hotter.
- water `#131a27`→`#172436`, parks `#1b2a22`→`#1e3327` — at z13 the Hooghly was indistinguishable from land
  and the Maidan invisible. Kolkata is a river city stippled with ponds.
- minor roads sit close to ground; only arterials keep the bright tier — at z15–16 Ballygunge's street
  grain is most of the frame and a pale road tone bleaches the view.

### 4 · Relief mode must hide basemap buildings
`building_3d` is a fill-extrusion. The basemap extrudes OSM `render_height`; the relief renderer extrudes
**our measured heights**. They disagree, so two 3D cities in one scene z-fight per building.
`REPLACED_BUILDING_GEOMETRY` (`heat-map-app.ts`) hides both `building` and `building_3d` whenever relief is
attached. Guarded by `tests/unit/heat-map-roads.test.mjs`, mutation-tested (2/2 mutants killed).

### 5 · Canopy lightness follows the ground
`vegetation-layer.ts` crown HSL lightness centre `0.42`→`0.36`. The crowns were tuned over the old
near-neutral ground; the same green sits several stops hotter against violet-black. Only the centre moved —
the ±0.08 spread stays, because that variation is what keeps 9,542 instanced crowns from reading as one
flat carpet. Render-only: the file touches no `SimLayers` or `buildSpatial`, so no published number moves.

## What this cannot do

**No cast shadows.** `building_3d` + style `light` gives **self**-shading — a lit face and a shaded face —
but MapLibre has no shadow pass, so nothing is thrown onto the street. Real cast shadows belong to relief
mode, and there is a genuine obstacle: the relief renderer shares MapLibre's **canvas and GL context**
(`canvas: map.getCanvas(), context: gl`), so shadow mapping needs off-screen depth passes that mutate
global GL state MapLibre owns. That is its own spec, with its own preview, and the payoff is tying the sun
to Track F's real Kolkata solar position rather than a decorative angle.

## Known gaps, deliberately left open

1. **The massing is mostly a tier-0 benefit.** `shouldShowRelief(attached) => attached`, so on any capable
   device relief attaches and the basemap buildings are hidden. The A/B preview has no relief renderer, so
   what it shows at z17 is the **fallback** view. The theme still governs ground, water, parks, railways and
   labels in the default mode.
2. **`highway_motorway_*` survives into relief mode** and is now bright violet where upstream painted it
   `#000` (invisible). It is the one basemap road left on screen there, at screen-pixel width — which
   contradicts the rule the hiding exists for. Ballygunge's window has no motorway-class ways, so our own
   road layer cannot replace it. **One-line fix available**: add the three motorway ids to
   `REPLACED_ROAD_GEOMETRY`.
3. **`studio` is still upstream positron.** Its layer ids differ from dark's, so the light environment needs
   its own derived style — separate work.
4. **Two unused variants ship.** `obos-dusk.json` and `obos-petrol.json` (~48 KB each) land in `dist/`
   though only Slate is referenced.

## Verification
`node scripts/build-map-style.mjs` → all three validate clean against `@maplibre/maplibre-gl-style-spec`.
`npm run verify` green. Both modes exercised in the dev app headlessly (no JS errors, no failed requests),
and relief mode confirmed to draw a single city with no z-fighting.
