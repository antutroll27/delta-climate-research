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
  /** One pending `idle` listener at most — see `pushToGpu`. */
  let settling = false;

  /**
   * PUSH THE PAINTED CANVAS TO THE GPU. Without this the field is never seen.
   *
   * THE DEFECT THIS EXISTS TO FIX. The source is registered `animate: false`, and
   * maplibre-gl 4.7.1's `CanvasSource.prepare()` reads:
   *
   *     if (!this.texture) this.texture = new Texture(context, this.canvas, …);
   *     else if (resize || this._playing) this.texture.update(this.canvas, …);
   *
   * `animate:false` leaves `_playing` false for ever, so the canvas is uploaded
   * EXACTLY ONCE — on the first frame after `addSource`. `attach()` runs while the
   * canvas is still blank (the first sim snapshot has not returned), and the
   * flyTo alone renders 1400ms of frames before `update()` paints anything. The
   * blank upload always won. `setCoordinates` clears `boundsBuffer` but not
   * `texture`, so a ward switch did not refresh it either.
   *
   * MEASURED: canvas fully painted (36864/36864 px, mean alpha 210), layer visible
   * at 0.5 opacity with correct coordinates — and nothing on the map. Calling
   * `play()` by hand made the entire field appear in the same session.
   *
   * This is the ONLY renderer at tier 0, where the Three.js relief never loads. So
   * every low-end device — and every browser test in this repo, which runs on
   * SwiftShader — saw an empty basemap under a full set of confident readouts.
   *
   * WHY NOT `animate: true`. It re-uploads a 192×192 RGBA texture on EVERY frame
   * whether or not the field changed. Tier 0 is the software-rendering path; a
   * per-frame upload is precisely the cost it cannot pay, and the data changes
   * only on a sim snapshot.
   *
   * WHY NOT `updateImage`. That is `ImageSource`, and its first line is
   * `if (!options.url) return this;` — it takes a URL and re-fetches. There is no
   * raw-pixel path on it.
   *
   * WHY PAUSE ON `idle` RATHER THAN IMMEDIATELY. `prepare()` returns early when
   * `Object.keys(this.tiles).length === 0` — "not enough data for current
   * position" — which is true while the map is still flying to the ward. A
   * `play(); pause();` pair would then clear the flag WITHOUT having uploaded, and
   * the fix would be a silent no-op in the exact window the bug lives in. `idle`
   * means MapLibre has finished rendering, so the upload has happened.
   *
   * IF `idle` NEVER FIRES the source simply stays playing: the failure mode is a
   * per-frame upload, not a blank map. Cost, never silence — which is the right
   * direction for a defect this hard to see.
   */
  function pushToGpu(): void {
    const source = map.getSource(CORE_FIELD_SOURCE) as maplibregl.CanvasSource | undefined;
    /* `play`/`pause` are assigned in CanvasSource's async load callback, so they
       are absent until the source is ready. Skipping is safe rather than lossy:
       until then `this.texture` is unset, so the source's FIRST upload takes
       whatever the canvas holds at that moment — which is this paint. */
    if (!source || typeof source.play !== 'function') return;
    source.play();
    if (settling) return;
    settling = true;
    map.once('idle', () => {
      settling = false;
      const current = map.getSource(CORE_FIELD_SOURCE) as maplibregl.CanvasSource | undefined;
      if (current && typeof current.pause === 'function') current.pause();
    });
  }
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
    /* AND AFTER A RE-ATTACH, because that is the other way the texture goes stale.
       `rehydrate` runs after a basemap style swap, which discards the source and
       its texture while the canvas keeps the field it was already showing. Without
       this the reader would watch the field vanish on every Dark/Clay switch and
       not come back until the next sim snapshot. Harmless on the first attach: the
       canvas is blank, the source is not loaded yet, and `pushToGpu` returns. */
    pushToGpu();
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
      /* PAINTING THE CANVAS IS NOT SHOWING IT. `triggerRepaint` asks MapLibre to
         draw a frame; `pushToGpu` is what makes that frame carry these pixels. */
      if (attached) { pushToGpu(); map.triggerRepaint(); }
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
