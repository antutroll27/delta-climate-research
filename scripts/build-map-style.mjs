/**
 * Derive the CUSP Dusk basemap style from OpenFreeMap's dark style.
 *
 *     node scripts/build-map-style.mjs            # rebuild from the vendored upstream
 *     node scripts/build-map-style.mjs --fetch    # re-fetch upstream first, then rebuild
 *
 * WHY A TRANSFORM AND NOT A HAND-WRITTEN STYLE. `REPLACED_ROAD_GEOMETRY`
 * (road-labels.ts) hides basemap road layers BY ID when relief mode engages —
 * `highway_minor`, `highway_major_casing`, `highway_major_inner`,
 * `highway_major_subtle`. Those ids belong to OpenFreeMap's dark style. A style
 * authored from scratch would rename them and the relief handoff would silently
 * stop hiding roads, painting basemap streets underneath the 3D city. Forking
 * upstream and recolouring keeps every id, so the contract holds by construction.
 *
 * WHY BUILD-TIME AND NOT setPaintProperty AT RUNTIME. Patching 47 layers after
 * every `setStyle` means a visible flash of upstream colours and a second place
 * the palette lives. Same reason the ward footprints and surface rasters are
 * derived offline into versioned static assets: the artifact is the contract and
 * this script is its receipt.
 *
 * LICENCE. The upstream style document is OpenFreeMap's (open source, from the
 * OpenMapTiles style lineage); tiles, glyphs and sprites are still served BY
 * OpenFreeMap from their URLs and the OSM/ODbL attribution the app already shows
 * is unchanged. We ship a recoloured derivative of a style meant to be forked —
 * no Mapbox asset, style, token or service is involved anywhere in this pipeline.
 *
 * Output: public/heat-map/styles/cusp-dusk.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const UPSTREAM_URL = 'https://tiles.openfreemap.org/styles/dark';
const VENDORED = join(ROOT, 'data', 'basemap', 'openfreemap-dark.json');
const OUT = join(ROOT, 'public', 'heat-map', 'styles', 'cusp-dusk.json');

/**
 * CUSP DUSK — the palette, as tokens rather than 47 scattered hex literals.
 *
 * The reference is Mapbox Standard's dusk preset over Paris (moodboard only —
 * nothing was ported, see docs/superpowers/specs/2026-08-13-cusp-dusk-basemap-design.md).
 * Its one real idea is a WARM/COOL INVERSION: the ground goes cool indigo and
 * buildings become the only warm mass in the scene, so the city reads without a
 * single outline. Upstream dark is pure greyscale — `rgb(12,12,12)` ground, grey
 * roads — which is exactly why it reads as generic.
 *
 * TWO DELIBERATE DEPARTURES FROM THE REFERENCE, both measured off Ballygunge
 * rather than Paris:
 *
 *  1. MINOR ROADS ARE DIMMER THAN THE REFERENCE. Paris blocks are large; Kolkata's
 *     street grain is fine enough that at z15-16 the lattice is most of the frame,
 *     and the reference's pale road tone bleaches the whole view. `roadMinor` sits
 *     a few points off `ground` on purpose. Only arterials keep the bright tier.
 *  2. BUILDINGS ARE DARKER AND LESS SATURATED THAN THE REFERENCE. The heat field
 *     renders ON TOP of this basemap and owns the meaning of "warm". A terracotta
 *     city competes with the data layer for the reader's warm-is-hot instinct, so
 *     the warmth here is held to a hint. The full warmth belongs in relief mode,
 *     where the heat drape reads differently. The climate-stripes red is sealed
 *     and appears nowhere in this file.
 */
const DUSK = {
  ground:       '#191a24',
  groundLift:   '#1d1e2a',
  /* LIFTED AFTER A WIDE RENDER. At z13 the first values (#131a27 / #1b2a22) left
     the Hooghly indistinguishable from land and the Maidan invisible. Kolkata is a
     river city stippled with ponds — the satellite reference is more water than
     anything else — so water has to hold its own against the ground rather than
     merely avoid glowing. Same for parks: the green is the one cool thing allowed
     to read, because it is what the vegetation layer will later agree with. */
  water:        '#172436',
  waterEdge:    '#1e3048',
  park:         '#1e3327',
  wood:         '#20382a',
  /* TUNED AGAINST A RENDER, NOT A SWATCH. The first pass used #2f2721 -> #4a3b30
     and a 0.42 light; headless shots over Ballygunge came back mustard-olive with
     the massing dominating the frame — the exact "buildings compete with the heat
     ramp" failure this palette is supposed to avoid. Kolkata's parcel density puts
     far more building pixels on screen than the Paris reference ever does, so the
     same tone reads several stops hotter here. Darkened, desaturated, and the key
     light pulled down to match. */
  buildingFill: '#282219',
  buildingEdge: '#332a20',
  buildingLit:  '#3a2f24',
  roadMinor:    '#26273a',
  roadCasing:   '#2c2d43',
  roadInner:    '#3d3f5c',
  roadSubtle:   '#313248',
  arterial:     '#565a7e',
  rail:         '#242534',
  label:        '#b9bcd4',
  labelHalo:    '#0d0e15',
  placeLabel:   '#d3d6ea',
};


/**
 * VARIANTS — the point is to stop looking like the reference.
 *
 * DUSK above is a faithful adaptation of Mapbox Standard's dusk, and a faithful
 * adaptation is still a recognisable one: indigo ground plus terracotta massing
 * is THEIR signature, and anyone who has seen their default will read ours as a
 * copy of it. These two move the identity somewhere they are not.
 *
 * PETROL rotates the ground off indigo into teal-slate and cools the massing to
 * bronze-grey, then hands the accent to a teal arterial. Warm stops being a
 * basemap colour at all, which is the functional argument as well as the visual
 * one: the heat ramp then owns warm outright, with nothing beneath it competing.
 *
 * SLATE inverts the mass. Buildings go LIGHTER than the ground rather than
 * darker, the way an architectural drawing renders footprints, and the whole
 * frame collapses to one blue-grey family with a near-white arterial. It reads
 * as an instrument rather than a night map — furthest from the reference, and
 * the one that best matches how the rest of this project talks about itself.
 */
const PETROL = {
  ...DUSK,
  ground:       '#152029',
  groundLift:   '#18242e',
  water:        '#12293a',
  waterEdge:    '#1b3a50',
  park:         '#193026',
  wood:         '#1c3629',
  buildingFill: '#242621',
  buildingEdge: '#2e3129',
  buildingLit:  '#39392e',
  roadMinor:    '#20313b',
  roadCasing:   '#263a45',
  roadInner:    '#365160',
  roadSubtle:   '#2b414e',
  arterial:     '#4e8496',
  rail:         '#1f2c34',
  label:        '#a8c2cc',
  labelHalo:    '#0a1116',
  placeLabel:   '#cfe2e9',
};

const SLATE = {
  ...DUSK,
  ground:       '#12151c',
  groundLift:   '#161a22',
  water:        '#152634',
  waterEdge:    '#1d3448',
  park:         '#1a2a24',
  wood:         '#1d3128',
  buildingFill: '#2b303c',
  buildingEdge: '#39404f',
  buildingLit:  '#4a5265',
  roadMinor:    '#1d222c',
  roadCasing:   '#232935',
  roadInner:    '#3a4256',
  roadSubtle:   '#2b3140',
  arterial:     '#8e9ab8',
  rail:         '#1f242e',
  label:        '#aeb6cc',
  labelHalo:    '#0a0c11',
  placeLabel:   '#d8dced',
};

const VARIANTS = { dusk: DUSK, petrol: PETROL, slate: SLATE };

/** id -> paint overrides, per token set. Absent ids keep upstream's value. */
const paintFor = (T) => ({
  background:              { 'background-color': T.ground },
  water:                   { 'fill-color': T.water },
  waterway:                { 'line-color': T.waterEdge },
  landuse_residential:     { 'fill-color': T.groundLift },
  landuse_park:            { 'fill-color': T.park },
  landcover_wood:          { 'fill-color': T.wood },
  building:                { 'fill-color': T.buildingFill, 'fill-outline-color': T.buildingEdge },
  highway_path:            { 'line-color': T.roadMinor },
  highway_minor:           { 'line-color': T.roadMinor },
  highway_major_casing:    { 'line-color': T.roadCasing },
  highway_major_inner:     { 'line-color': T.roadInner },
  highway_major_subtle:    { 'line-color': T.roadSubtle },
  highway_motorway_casing: { 'line-color': T.roadCasing },
  highway_motorway_subtle: { 'line-color': T.roadSubtle },
  railway:                 { 'line-color': T.rail },
  railway_dashline:        { 'line-color': T.rail },
  railway_minor:           { 'line-color': T.rail },
  railway_minor_dashline:  { 'line-color': T.rail },
  railway_transit:         { 'line-color': T.rail },
  railway_transit_dashline:{ 'line-color': T.rail },
  water_name:              { 'text-color': T.label, 'text-halo-color': T.labelHalo },
  highway_name_other:      { 'text-color': T.label, 'text-halo-color': T.labelHalo },
  place_other:             { 'text-color': T.placeLabel, 'text-halo-color': T.labelHalo },
  place_suburb:            { 'text-color': T.placeLabel, 'text-halo-color': T.labelHalo },
  place_village:           { 'text-color': T.placeLabel, 'text-halo-color': T.labelHalo },
  place_town:              { 'text-color': T.placeLabel, 'text-halo-color': T.labelHalo },
  place_city:              { 'text-color': T.placeLabel, 'text-halo-color': T.labelHalo },
  place_city_large:        { 'text-color': T.placeLabel, 'text-halo-color': T.labelHalo },
});

/* `highway_motorway_inner` ships a zoom interpolation upstream, so it is replaced
   wholesale rather than merged — the arterial tier is the ONE bright road class
   the Ballygunge reading left standing, and it must not inherit upstream's
   fade-to-black stop. */
const motorwayInnerFor = (T) => ({ 'line-color': T.arterial });

/**
 * 3D massing, added rather than recoloured.
 *
 * `light` + `fill-extrusion` is what produces the lit face / shaded face pair the
 * reference reads as depth. This is SELF-SHADING, not cast shadows: MapLibre has
 * no shadow pass, so a building darkens its own north side but throws nothing
 * onto the street. Real cast shadows are a relief-mode (Three.js) question and
 * are deliberately out of scope here — see the design note's §"What this cannot do".
 *
 * z15 floor: below that the extrusions are noise at Kolkata parcel size, and the
 * flat `building` fill already carries the mass.
 */
const building3dFor = (T) => ({
  id: 'building_3d',
  type: 'fill-extrusion',
  source: 'openmaptiles',
  'source-layer': 'building',
  minzoom: 15,
  paint: {
    'fill-extrusion-color': [
      'interpolate', ['linear'], ['get', 'render_height'],
      0, T.buildingFill, 15, T.buildingFill, 45, T.buildingLit,
    ],
    'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
    'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
    'fill-extrusion-opacity': 0.86,
    'fill-extrusion-vertical-gradient': true,
  },
});

/** Sun-ish key from the north-west, low. Mirrors the relief renderer's key light
 *  direction so the two modes agree about where the light comes from. */
/* Petrol and Slate remove warmth from the basemap entirely, so their key light
   loses its amber cast too — a warm light over cool massing just reads dirty. */
const lightFor = (name) => (name === 'dusk'
  ? { anchor: 'viewport', position: [1.4, 320, 62], color: '#ffeedd', intensity: 0.28 }
  : { anchor: 'viewport', position: [1.4, 320, 62], color: '#eaf2ff', intensity: 0.34 });

function build(upstream, name, T) {
  const PAINT = paintFor(T);
  const MOTORWAY_INNER = motorwayInnerFor(T);
  const style = structuredClone(upstream);
  const seen = new Set();

  for (const layer of style.layers) {
    const patch = layer.id === 'highway_motorway_inner' ? MOTORWAY_INNER : PAINT[layer.id];
    if (!patch) continue;
    seen.add(layer.id);
    layer.paint = layer.id === 'highway_motorway_inner'
      ? { ...layer.paint, ...MOTORWAY_INNER }
      : { ...layer.paint, ...patch };
  }

  /* A token that matches nothing is a silent no-op — exactly how a palette rots
     when upstream renames a layer. Fail loudly instead. */
  const missing = [...Object.keys(PAINT), 'highway_motorway_inner'].filter((id) => !seen.has(id));
  if (missing.length) {
    throw new Error(`these layer ids are not in the upstream style, so their colours would silently `
      + `never apply: ${missing.join(', ')}. Upstream renamed them — update PAINT.`);
  }

  /* Insert the massing directly above the flat building fill, so it sits under
     every road and label rather than over them. */
  const at = style.layers.findIndex((l) => l.id === 'building');
  if (at < 0) throw new Error('no `building` layer upstream — cannot place building_3d');
  style.layers.splice(at + 1, 0, building3dFor(T));

  style.light = lightFor(name);
  style.name = `CUSP ${name[0].toUpperCase()}${name.slice(1)}`;
  style.metadata = {
    'cusp:derived-from': UPSTREAM_URL,
    'cusp:generated-by': 'scripts/build-map-style.mjs',
    'cusp:note': 'Recoloured derivative of the OpenFreeMap dark style. Tiles, glyphs and sprites are '
      + 'still served by OpenFreeMap; OSM/ODbL attribution unchanged. No Mapbox asset or service is used.',
  };
  return style;
}

const wantsFetch = process.argv.includes('--fetch');
if (wantsFetch || !existsSync(VENDORED)) {
  const res = await fetch(UPSTREAM_URL);
  if (!res.ok) throw new Error(`upstream style fetch failed: ${res.status}`);
  mkdirSync(dirname(VENDORED), { recursive: true });
  writeFileSync(VENDORED, `${JSON.stringify(await res.json(), null, 2)}\n`);
  console.log(`  fetched upstream -> ${VENDORED.replace(ROOT, '.')}`);
}

const upstream = JSON.parse(readFileSync(VENDORED, 'utf8'));
mkdirSync(dirname(OUT), { recursive: true });
for (const [name, tokens] of Object.entries(VARIANTS)) {
  const style = build(upstream, name, tokens);
  const path = join(dirname(OUT), `cusp-${name}.json`);
  writeFileSync(path, `${JSON.stringify(style, null, 2)}\n`);
  console.log(`  ${style.name.padEnd(12)} ${style.layers.length} layers  ->  ${path.replace(ROOT, '.')}`);
}
