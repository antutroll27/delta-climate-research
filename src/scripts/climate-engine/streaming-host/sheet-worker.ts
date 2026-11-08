/// <reference lib="webworker" />
/**
 * sheet-worker.ts — the page's pre-spawned worker for sheet preparation. See sheet-worker-protocol.ts.
 *
 * It keeps the last few parsed wards by key, because one sheet is asked for up to three things (its raster, its mesh,
 * and, as a neighbour, its massing) within a second or two of each other and the parse is the part they share.
 */
import { Earcut } from 'three/src/extras/Earcut.js';
import * as M from '../heat-map-model.ts';
import { rasterWardBase } from '../ward-raster.ts';
import { terrainDrawAt } from '../terrain.ts';
import { contactAoData } from '../explore/look-shading.ts';
import { buildMassingMesh, buildPackedMesh, meshBuffers, type BuildingRow } from '../streaming/prism-mesh.ts';
import { bevelBuffers, buildBevelMesh } from './bevel-core.ts';
import type { WorkerReply, WorkerRequest } from './sheet-worker-protocol.ts';

const triangulate = (xy: readonly number[]): ArrayLike<number> => Earcut.triangulate(xy as number[], undefined, 2);

const PARSED_KEPT = 3;
const parsed = new Map<string, M.WardData>();

function ward(key: string, text: string): M.WardData {
  const hit = parsed.get(key);
  if (hit !== undefined) { parsed.delete(key); parsed.set(key, hit); return hit; }     // most recent last
  const d = JSON.parse(text) as M.WardData;
  parsed.set(key, d);
  while (parsed.size > PARSED_KEPT) parsed.delete(parsed.keys().next().value as string);
  return d;
}

const reply = (message: WorkerReply, transfer: ArrayBuffer[] = []): void => (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const request = event.data;
  if (request.op === 'forget') { parsed.delete(request.key); return; }
  const t0 = performance.now();
  try {
    const d = ward(request.key, request.wardText);
    if (request.op === 'prepare') {
      const roads = request.roadsText === null ? null : (JSON.parse(request.roadsText) as M.RoadsData);
      const base = rasterWardBase(d, request.means, request.surface, null, null);
      const spatial = M.buildSpatial(d, base, roads);
      reply({ op: 'prepared', id: request.id, base, spatial, buildings: d.b.length, ms: performance.now() - t0 },
        [base.albedo.buffer, base.veg.buffer, base.built.buffer, base.water.buffer] as ArrayBuffer[]);
    } else if (request.op === 'mesh') {
      const rows = d.b as unknown as readonly BuildingRow[];
      const groundAt = (x: number, z: number): number => terrainDrawAt(request.terrain, x, z);
      const ao = request.ao === null ? null : contactAoData(rows as unknown as readonly (readonly number[])[], d.sizeM, request.ao.n, request.ao.nearM);
      const extra = ao === null ? [] : [ao.buffer as ArrayBuffer];
      if (request.tier === 'full') {
        const mesh = buildBevelMesh({ rows, sizeM: d.sizeM, groundAt, inWard: null });
        reply({ op: 'meshed', id: request.id, mesh, ao, ms: performance.now() - t0 }, [...bevelBuffers(mesh), ...extra]);
      } else {
        const mesh = buildPackedMesh({ rows, sizeM: d.sizeM, triangulate, groundAt, inWard: null });
        reply({ op: 'meshed', id: request.id, mesh, ao, ms: performance.now() - t0 }, [...meshBuffers(mesh), ...extra]);
      }
    } else {
      const mesh = buildMassingMesh({ rows: d.b as unknown as readonly BuildingRow[], sizeM: d.sizeM, triangulate });
      reply({ op: 'massed', id: request.id, mesh, ms: performance.now() - t0 }, meshBuffers(mesh));
    }
  } catch (error) {
    reply({ op: 'failed', id: request.id, message: error instanceof Error ? error.message : String(error) });
  }
};
