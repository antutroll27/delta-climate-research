/**
 * road-labels.ts — street names, drawn by MapLibre rather than by us.
 *
 * WHY MAPLIBRE SYMBOLS AND NOT THE THREE.JS SCENE. The scene is pitched 60° with
 * buildings up to 87 m. Text laid in that scene would be occluded by the tower on
 * its own corner, would need its own collision index to stop twelve labels
 * overplotting a 1,400 m window, and would inherit the scene's frame — so a label
 * would look right while being wrong. That last one is not hypothetical: the
 * render drew every ward mirrored for a day (2026-08-05) precisely because a
 * frame error had nothing independent to disagree with.
 *
 * A symbol layer avoids all three. Symbols are not depth-tested against a custom
 * 3D layer, they join MapLibre's global collision index for free, and they are
 * placed from lon/lat in the BASEMAP's frame. That last property makes this layer
 * a standing check on our geometry: if our metres ever drift again, the names
 * will visibly separate from the ribbons underneath them.
 *
 * It also costs zero per-frame work, which road-layer.ts made an explicit
 * property of this family.
 *
 * WHAT IS LABELLED. Major classes only. OSM names 97 % of primary and 100 % of
 * tertiary ways in these windows, against 17 % of residential and 2 % of service
 * — so labelling the minor classes would assert that the unnamed majority have no
 * name. See scripts/fetch-road-labels.py for the measurement.
 */

export const LABEL_SOURCE = 'delta-road-labels';
export const LABEL_LAYER = 'delta-road-labels';

/** The only font stack both OpenFreeMap styles serve. A stack their glyph
 *  endpoint lacks renders NOTHING, silently — hence the test that pins it. */
export const LABEL_FONT = 'Noto Sans Regular';

/**
 * Basemap layers whose ROAD GEOMETRY we replace with our own metre-true ribbons.
 * Enumerated rather than matched, because this is a per-class judgement: we
 * deliberately leave `highway_path` and the motorway layers visible, since we do
 * not draw those and hiding an unreplaced road deletes it rather than redraws it.
 */
export const REPLACED_ROAD_GEOMETRY = [
  'highway_minor', 'highway_major_casing', 'highway_major_inner', 'highway_major_subtle',
] as const;

/**
 * Basemap layers whose LABELS we replace — matched by predicate, not by id.
 *
 * The two decisions are not the same kind. Geometry needs enumerating because
 * there is a per-class judgement to make. Labels do not: every road name still
 * standing belongs to a road the basemap no longer paints. And the ids DIFFER
 * between the two styles we ship — dark has `highway_name_other`,
 * `highway_name_motorway`, `road_oneway`, `road_oneway_opposite`; positron has
 * `highway-name-minor`, `highway-name-major`, `highway-name-path` and shield
 * layers. An id list here is a list already known to be incomplete, and it would
 * rot silently the next time OpenFreeMap renames a layer.
 *
 * Deliberately NOT hidden: anything on the `place` or `water_name` source-layers.
 * Those are context we do not supply and are not replacing.
 */
export function isReplacedRoadLabel(layer: {
  type?: string; 'source-layer'?: string;
}): boolean {
  if (layer.type !== 'symbol') return false;
  const src = layer['source-layer'];
  return src === 'transportation' || src === 'transportation_name';
}

export interface LabelStyle {
  /** text fill, chosen per environment */
  readonly color: string;
  /** halo, so a name stays legible over both the massing and the basemap */
  readonly halo: string;
}

export const LABEL_STYLE: Readonly<Record<'dark' | 'studio', LabelStyle>> = Object.freeze({
  dark: { color: '#b9d8d4', halo: 'rgba(4,11,13,0.85)' },
  studio: { color: '#3d5457', halo: 'rgba(250,248,244,0.85)' },
});

/** The layer spec, as MapLibre wants it. Kept here so the test can read it. */
export function labelLayerSpec(env: 'dark' | 'studio'): Record<string, unknown> {
  const s = LABEL_STYLE[env];
  return {
    id: LABEL_LAYER,
    type: 'symbol',
    source: LABEL_SOURCE,
    layout: {
      'symbol-placement': 'line',
      /* Long enough that a name is not repeated three times along one block, short
         enough that a road crossing the whole window is labelled more than once. */
      'symbol-spacing': 340,
      'text-max-angle': 30,
      'text-field': ['get', 'name'],
      'text-font': [LABEL_FONT],
      'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 13],
      'text-letter-spacing': 0.08,
      'text-rotation-alignment': 'map',
      /* Upright, not lying on the ground. The ground is drawn at ×4 exaggeration
         (terrain.ts), so a label pinned flat at z=0 would sit up to ~26 m from its
         ribbon on screen at 60° pitch — wider than the carriageway. Upright text
         reads as an annotation POINTING at the road; ground-lain type would read
         as paint and make the offset look like a registration error. */
      'text-pitch-alignment': 'viewport',
    },
    paint: {
      'text-color': s.color,
      'text-halo-color': s.halo,
      'text-halo-width': 1.2,
      'text-halo-blur': 0.4,
    },
  };
}

/** Empty collection — what a failed fetch yields. Absence draws nothing. */
export const EMPTY_LABELS = { type: 'FeatureCollection', features: [] } as const;
