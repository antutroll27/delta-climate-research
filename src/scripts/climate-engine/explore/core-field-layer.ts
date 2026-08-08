import type maplibregl from 'maplibre-gl';
import { wardLatLon, type Ward } from '../../../data/wards.ts';

export const CORE_FIELD_SOURCE = 'delta-core-field-source';
export const CORE_FIELD_LAYER = 'delta-core-field';

const STOPS = [
  [0.435, 0.792, 0.839],
  [0.624, 0.725, 0.541],
  [0.690, 0.553, 0.341],
  [0.831, 0.420, 0.290],
  [0.898, 0.282, 0.302],
] as const;
type ColourStop = readonly [number, number, number];

function mix(a: number, b: number, t: number): number { return a + (b - a) * t; }

export function heatRampRgb(value: number, min: number, max: number): readonly [number, number, number] {
  const t = Math.max(0, Math.min(1, (value - min) / Math.max(1e-6, max - min)));
  let left: ColourStop = STOPS[0], right: ColourStop = STOPS[1], local = t / 0.35;
  if (t >= 0.8) { left = STOPS[3]; right = STOPS[4]; local = (t - 0.8) / 0.2; }
  else if (t >= 0.6) { left = STOPS[2]; right = STOPS[3]; local = (t - 0.6) / 0.2; }
  else if (t >= 0.35) { left = STOPS[1]; right = STOPS[2]; local = (t - 0.35) / 0.25; }
  return [
    Math.round(mix(left[0], right[0], local) * 255),
    Math.round(mix(left[1], right[1], local) * 255),
    Math.round(mix(left[2], right[2], local) * 255),
  ];
}

export function wardFieldCoordinates(ward: Ward, sizeM: number): [[number, number], [number, number], [number, number], [number, number]] {
  const half = sizeM / 2;
  const northWest = wardLatLon(ward, -half, half);
  const northEast = wardLatLon(ward, half, half);
  const southEast = wardLatLon(ward, half, -half);
  const southWest = wardLatLon(ward, -half, -half);
  return [
    [northWest.lon, northWest.lat],
    [northEast.lon, northEast.lat],
    [southEast.lon, southEast.lat],
    [southWest.lon, southWest.lat],
  ];
}

/** The analytical field as a MapLibre canvas raster — the Three-free renderer that
 *  is the whole picture on tier 0 and stays valid while relief downloads. */
export interface CoreFieldLayer {
  /** Idempotent: adds the source/layer once, then only moves the corner coordinates. */
  attach(ward: Ward, sizeM: number, beforeId?: string): void;
  /** Repaints the canvas from a south-row-major field. Row order is FLIPPED here —
   *  the grid's first row is the south edge, the canvas's first row is the north. */
  update(field: Float32Array, min: number, max: number): void;
  setVisible(visible: boolean): void;
  /** Re-adds source and layer after a basemap style swap discards them. */
  rehydrate(ward: Ward, sizeM: number, beforeId?: string): void;
  dispose(): void;
}

export function createCoreFieldLayer(map: maplibregl.Map, gridSize: number): CoreFieldLayer {
  let attached = false;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = gridSize;
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('The analytical field canvas is unavailable.');

  function attach(ward: Ward, sizeM: number, beforeId?: string): void {
    const coordinates = wardFieldCoordinates(ward, sizeM);
    if (!map.getSource(CORE_FIELD_SOURCE)) {
      map.addSource(CORE_FIELD_SOURCE, {
        type: 'canvas', canvas, coordinates, animate: false,
      });
    } else {
      (map.getSource(CORE_FIELD_SOURCE) as maplibregl.CanvasSource).setCoordinates(coordinates);
    }
    if (!map.getLayer(CORE_FIELD_LAYER)) {
      map.addLayer({
        id: CORE_FIELD_LAYER,
        type: 'raster',
        source: CORE_FIELD_SOURCE,
        paint: { 'raster-opacity': 0.5, 'raster-fade-duration': 0 },
      }, beforeId);
    }
    attached = true;
  }

  return {
    attach,

    update(field, min, max) {
      if (field.length !== gridSize * gridSize) throw new RangeError('Core field dimensions do not match the canonical grid.');
      const image = context.createImageData(gridSize, gridSize);
      for (let southRow = 0; southRow < gridSize; southRow++) {
        const canvasRow = gridSize - 1 - southRow;
        for (let x = 0; x < gridSize; x++) {
          const source = southRow * gridSize + x;
          const target = (canvasRow * gridSize + x) * 4;
          const [r, g, b] = heatRampRgb(field[source], min, max);
          image.data[target] = r; image.data[target + 1] = g; image.data[target + 2] = b; image.data[target + 3] = 210;
        }
      }
      context.putImageData(image, 0, 0);
      if (attached) map.triggerRepaint();
    },

    setVisible(visible) {
      if (map.getLayer(CORE_FIELD_LAYER)) map.setLayoutProperty(CORE_FIELD_LAYER, 'visibility', visible ? 'visible' : 'none');
    },

    rehydrate(ward, sizeM, beforeId) { attach(ward, sizeM, beforeId); },

    dispose() {
      if (map.getLayer(CORE_FIELD_LAYER)) map.removeLayer(CORE_FIELD_LAYER);
      if (map.getSource(CORE_FIELD_SOURCE)) map.removeSource(CORE_FIELD_SOURCE);
      attached = false;
    },
  };
}
