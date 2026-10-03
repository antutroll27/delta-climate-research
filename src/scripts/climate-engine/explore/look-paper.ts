/**
 * look-paper.ts — Clay's basemap: positron recoloured to the infographic's paper.
 *
 * The editorial look's ground (look.ts); `?look=classic` keeps stock positron.
 * Applied through MapLibre's `transformStyle`, so the tiles, glyphs, sprites,
 * sources and every layer id stay upstream positron's; only paint colours move.
 * Everything the app adds on `style.load` is added after this runs, untouched.
 * Three.js-free on purpose: this is imported by the app's main chunk.
 */
import type { StyleSpecification } from 'maplibre-gl';

/** layer id → paint property → colour. Ids absent from the style are skipped. */
const PAPER_PAINT: Record<string, Record<string, string>> = {
  background: { 'background-color': '#efebe4' },
  park: { 'fill-color': '#dfe6d4' },
  landcover_wood: { 'fill-color': '#d9e3cf' },
  landuse_residential: { 'fill-color': '#ebe6de' },
  water: { 'fill-color': '#bcd9cc' },
  waterway: { 'line-color': '#a9cfc0' },
  building: { 'fill-color': '#e6e1d8', 'fill-outline-color': '#dad4c9' },
  aeroway_area: { 'fill-color': '#f2efe9' },
  road_area_pier: { 'fill-color': '#efebe4' },
  road_pier: { 'line-color': '#efebe4' },
  highway_path: { 'line-color': '#e3ded5' },
  highway_minor: { 'line-color': '#dcd6cc' },
  highway_major_casing: { 'line-color': '#d6d1c8' },
  highway_major_inner: { 'line-color': '#f7f6f2' },
  highway_motorway_casing: { 'line-color': '#d6d1c8' },
  highway_motorway_inner: { 'line-color': '#f7f6f2' },
  highway_motorway_bridge_casing: { 'line-color': '#d6d1c8' },
  highway_motorway_bridge_inner: { 'line-color': '#f7f6f2' },
  railway: { 'line-color': '#d6d1c8' },
  railway_transit: { 'line-color': '#d6d1c8' },
  railway_service: { 'line-color': '#d6d1c8' },
};

/** Halo colour for every symbol layer, so labels sit on paper and not on white. */
const PAPER_HALO = 'rgba(239,235,228,0.85)';

export function paperStyle(_previous: StyleSpecification | undefined, next: StyleSpecification): StyleSpecification {
  return {
    ...next,
    layers: next.layers.map((layer) => {
      const over = PAPER_PAINT[layer.id];
      const paint = { ...((layer as { paint?: Record<string, unknown> }).paint ?? {}) };
      if (over) Object.assign(paint, over);
      if (layer.type === 'symbol' && 'text-halo-color' in paint) paint['text-halo-color'] = PAPER_HALO;
      return { ...layer, paint } as typeof layer;
    }),
  };
}
