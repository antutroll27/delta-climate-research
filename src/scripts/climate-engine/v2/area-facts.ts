// src/scripts/climate-engine/v2/area-facts.ts — OBOS v2 spec C7. BUILD TIME ONLY (reads public/ with fs).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderableWardById } from '../../../data/wards.ts';

export interface AreaFacts { readonly kind: 'polygon' | 'square'; readonly areaHa: number; readonly path: string; readonly viewBox: string }

export function formatHa(ha: number): string { return ha >= 100 ? String(Math.round(ha)) : ha.toFixed(1); }

/** ring: flat [x0,y0,x1,y1,…] in ward-local metres, x east, y north ({ward}-ward.json). North-up path in a 100-high box. */
function ringPath(ring: readonly number[]): { path: string; viewBox: string } {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i + 1 < ring.length; i += 2) { xs.push(ring[i]); ys.push(-ring[i + 1]); }
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const k = 100 / (maxY - minY);
  const w = (maxX - minX) * k;
  const pts = xs.map((x, i) => `${((x - minX) * k).toFixed(1)} ${((ys[i] - minY) * k).toFixed(1)}`);
  return { path: `M${pts.join('L')}Z`, viewBox: `0 0 ${w.toFixed(1)} 100` };
}

export function areaFacts(id: string): AreaFacts | null {
  const ward = renderableWardById(id);
  if (!ward) return null;
  const file = resolve(`public/heat-map/data/${id}-ward.json`);
  if (existsSync(file)) {
    const mask = JSON.parse(readFileSync(file, 'utf8')) as { areaM2: number; ring: number[] };
    const { path, viewBox } = ringPath(mask.ring);
    return { kind: 'polygon', areaHa: mask.areaM2 / 1e4, path, viewBox };
  }
  return { kind: 'square', areaHa: (ward.footprintM * ward.footprintM) / 1e4, path: 'M0 0H100V100H0Z', viewBox: '0 0 100 100' };
}
