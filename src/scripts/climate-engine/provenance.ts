/**
 * Per-layer provenance manifest — the "receipts" data spine.
 *
 * Loads `public/heat-map/data/{ward}-layers.json` (emitted by
 * `scripts/build-provenance-manifest.py`) and narrows it defensively, the same
 * way `terrain.ts:asTerrainField` does: a malformed or missing manifest returns
 * `null` so the UI falls back to the static credit line, never half-renders a
 * receipt. Every field mirrors the Python `LayerRecord` (STAC + ISO 19115
 * lineage / ISO 19157 quality).
 */

export type LayerKind = 'measured' | 'modelled' | 'derived' | 'reference';

export interface Licence {
  name: string;
  url?: string;
}

export interface LayerRecord {
  id: string;
  label: string;
  kind: LayerKind;
  source: string;
  licence: Licence;
  lineage: string[];
  collection?: string;
  instrument?: string;
  resolution?: string;
  vintage?: string;
  cloudPct?: number;
  confidence?: string;
}

export interface LayerManifest {
  ward: string;
  generated: string;
  schema: string;
  layers: LayerRecord[];
}

const KINDS = new Set<string>(['measured', 'modelled', 'derived', 'reference']);

function isLayerRecord(value: unknown): value is LayerRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  const licence = r.licence as Record<string, unknown> | null | undefined;
  return (
    typeof r.id === 'string'
    && typeof r.label === 'string'
    && typeof r.kind === 'string' && KINDS.has(r.kind)
    && typeof r.source === 'string'
    && typeof licence === 'object' && licence !== null && typeof licence.name === 'string'
    && Array.isArray(r.lineage) && r.lineage.every((line) => typeof line === 'string')
  );
}

/** Narrow unknown JSON to a manifest, or null if it cannot be trusted. */
export function asLayerManifest(value: unknown): LayerManifest | null {
  if (typeof value !== 'object' || value === null) return null;
  const m = value as Record<string, unknown>;
  if (typeof m.ward !== 'string' || typeof m.generated !== 'string' || typeof m.schema !== 'string') return null;
  if (!Array.isArray(m.layers) || m.layers.length === 0 || !m.layers.every(isLayerRecord)) return null;
  return value as LayerManifest;
}

const cache = new Map<string, Promise<LayerManifest | null>>();

/** Fetch + cache the manifest for a ward; null on any failure (UI degrades). */
export function loadLayerManifest(ward: string): Promise<LayerManifest | null> {
  let pending = cache.get(ward);
  if (!pending) {
    pending = fetch(`/heat-map/data/${ward}-layers.json`)
      .then((response) => (response.ok ? (response.json() as Promise<unknown>) : null))
      .then((json) => asLayerManifest(json))
      .catch(() => null);
    cache.set(ward, pending);
  }
  return pending;
}

/** One-line credit string from the manifest — replaces the hand-typed `.attr`. */
export function creditLine(manifest: LayerManifest): string {
  const parts = manifest.layers
    .filter((layer) => layer.id !== 'lst')
    .map((layer) => `${layer.label} · ${layer.source} (${layer.licence.name})`);
  return parts.join('  ·  ');
}

/**
 * Runnable self-check (repo has no unit runner for engine modules; matches the
 * assertCapsLogic/assertTerrainLogic pattern). Run:
 *   node --experimental-strip-types -e "import('./provenance.ts').then(m=>m.assertProvenanceLogic())"
 * Tree-shaken from the browser bundle.
 */
export function assertProvenanceLogic(): void {
  const assert = (ok: boolean, msg: string) => {
    if (!ok) throw new Error(`provenance: ${msg}`);
  };
  const record: LayerRecord = {
    id: 'footprints', label: 'Building footprints', kind: 'measured',
    source: 'Overture Maps Foundation', licence: { name: 'ODbL' }, lineage: ['GERS merge'],
  };
  const good = { ward: 'ballygunge', generated: '2026-08-10', schema: 's', layers: [record] };

  const m = asLayerManifest(good);
  assert(m !== null && m.layers.length === 1 && m.layers[0].id === 'footprints', 'valid manifest accepted');
  assert(asLayerManifest(null) === null, 'null rejected');
  assert(asLayerManifest({ ...good, layers: [] }) === null, 'empty layers rejected');
  assert(asLayerManifest({ ...good, layers: [{ id: 'x' }] }) === null, 'record missing fields rejected');
  assert(asLayerManifest({ ...good, layers: [{ ...record, kind: 'bogus' }] }) === null, 'bad kind rejected');
  assert(asLayerManifest({ ...good, layers: [{ ...record, licence: null }] }) === null, 'missing licence rejected');
  assert(creditLine(m as LayerManifest).includes('ODbL'), 'credit line built from manifest');
}
