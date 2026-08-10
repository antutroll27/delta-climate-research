import type { Map as MlMap } from 'maplibre-gl';

// Mapillary coverage vector tiles (map-matched geometries). Token goes in the URL.
const TILE_URL = (token: string) =>
  `https://tiles.mapillary.com/maps/vtp/mly1_computed_public/2/{z}/{x}/{y}?access_token=${token}`;

const SOURCE = 'mly-coverage';
const SEQ_LAYER = 'mly-sequence';
const IMG_LAYER = 'mly-image';

// Recency thresholds (epoch-ms). Boundaries: <2018 old, 2018–2023 mid, >=2023 fresh.
export const T_2018 = 1514764800000; // 2018-01-01T00:00:00Z
export const T_2023 = 1672531200000; // 2023-01-01T00:00:00Z
const OLD = '#6b7a7d', MID = '#c39a5f', FRESH = '#5db98a';

export function recencyBucket(capturedAtMs: number): 'old' | 'mid' | 'fresh' {
  if (capturedAtMs < T_2018) return 'old';
  if (capturedAtMs < T_2023) return 'mid';
  return 'fresh';
}

/** MapLibre data-driven paint expression: colour by captured_at directly from the tiles. */
export function coverageColorExpression(): unknown[] {
  return ['step', ['get', 'captured_at'], OLD, T_2018, MID, T_2023, FRESH];
}

/** Add the coverage source + sequence(line) & image(point) layers. Idempotent + null-safe. */
export function addCoverage(map: MlMap, token: string): void {
  if (!token) return;
  if (!map.getSource(SOURCE)) {
    map.addSource(SOURCE, { type: 'vector', tiles: [TILE_URL(token)], minzoom: 6, maxzoom: 14 });
  }
  const color = coverageColorExpression() as never;
  if (!map.getLayer(SEQ_LAYER)) {
    map.addLayer({
      id: SEQ_LAYER, type: 'line', source: SOURCE, 'source-layer': 'sequence',
      paint: { 'line-color': color, 'line-width': 2, 'line-opacity': 0.85 },
    } as never);
  }
  if (!map.getLayer(IMG_LAYER)) {
    map.addLayer({
      id: IMG_LAYER, type: 'circle', source: SOURCE, 'source-layer': 'image', minzoom: 14,
      paint: { 'circle-color': color, 'circle-radius': 4, 'circle-stroke-width': 1, 'circle-stroke-color': '#02090a' },
    } as never);
  }
}

export function removeCoverage(map: MlMap): void {
  for (const id of [IMG_LAYER, SEQ_LAYER]) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(SOURCE)) map.removeSource(SOURCE);
}

export const IMAGE_LAYER_ID = IMG_LAYER;

export function assertCoverageLogic(): void {
  const ok = (c: boolean, m: string) => { if (!c) throw new Error(`coverage: ${m}`); };
  ok(recencyBucket(0) === 'old', 'epoch 0 is old');
  ok(recencyBucket(T_2018) === 'mid' && recencyBucket(T_2018 - 1) === 'old', '2018 boundary');
  ok(recencyBucket(T_2023) === 'fresh' && recencyBucket(T_2023 - 1) === 'mid', '2023 boundary');
  const e = coverageColorExpression();
  ok(e[0] === 'step' && e[3] === T_2018 && e[5] === T_2023, 'expression thresholds intact');
}
