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

export class CoreFieldLayer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private attached = false;
  private map: maplibregl.Map;
  private gridSize: number;

  constructor(map: maplibregl.Map, gridSize: number) {
    this.map = map;
    this.gridSize = gridSize;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = gridSize;
    const context = this.canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('The analytical field canvas is unavailable.');
    this.context = context;
  }

  attach(ward: Ward, sizeM: number, beforeId?: string): void {
    const coordinates = wardFieldCoordinates(ward, sizeM);
    if (!this.map.getSource(CORE_FIELD_SOURCE)) {
      this.map.addSource(CORE_FIELD_SOURCE, {
        type: 'canvas', canvas: this.canvas, coordinates, animate: false,
      });
    } else {
      (this.map.getSource(CORE_FIELD_SOURCE) as maplibregl.CanvasSource).setCoordinates(coordinates);
    }
    if (!this.map.getLayer(CORE_FIELD_LAYER)) {
      this.map.addLayer({
        id: CORE_FIELD_LAYER,
        type: 'raster',
        source: CORE_FIELD_SOURCE,
        paint: { 'raster-opacity': 0.5, 'raster-fade-duration': 0 },
      }, beforeId);
    }
    this.attached = true;
  }

  update(field: Float32Array, min: number, max: number): void {
    if (field.length !== this.gridSize * this.gridSize) throw new RangeError('Core field dimensions do not match the canonical grid.');
    const image = this.context.createImageData(this.gridSize, this.gridSize);
    for (let southRow = 0; southRow < this.gridSize; southRow++) {
      const canvasRow = this.gridSize - 1 - southRow;
      for (let x = 0; x < this.gridSize; x++) {
        const source = southRow * this.gridSize + x;
        const target = (canvasRow * this.gridSize + x) * 4;
        const [r, g, b] = heatRampRgb(field[source], min, max);
        image.data[target] = r; image.data[target + 1] = g; image.data[target + 2] = b; image.data[target + 3] = 210;
      }
    }
    this.context.putImageData(image, 0, 0);
    if (this.attached) this.map.triggerRepaint();
  }

  setVisible(visible: boolean): void {
    if (this.map.getLayer(CORE_FIELD_LAYER)) this.map.setLayoutProperty(CORE_FIELD_LAYER, 'visibility', visible ? 'visible' : 'none');
  }

  rehydrate(ward: Ward, sizeM: number, beforeId?: string): void { this.attach(ward, sizeM, beforeId); }

  dispose(): void {
    if (this.map.getLayer(CORE_FIELD_LAYER)) this.map.removeLayer(CORE_FIELD_LAYER);
    if (this.map.getSource(CORE_FIELD_SOURCE)) this.map.removeSource(CORE_FIELD_SOURCE);
    this.attached = false;
  }
}
