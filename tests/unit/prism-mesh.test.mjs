import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Earcut } from 'three/src/extras/Earcut.js';
import { ExtrudeGeometry, Shape } from 'three';

import {
  G_RANGE_M, H_RANGE_M, MASSING_BYTES_PER_VERTEX, PACKED_BYTES_PER_VERTEX,
  buildMassingMesh, buildPackedMesh, meshBytes,
} from '../../src/scripts/climate-engine/streaming/prism-mesh.ts';

const triangulate = (xy) => Earcut.triangulate(xy, null, 2);
const base = { sizeM: 2800, triangulate };

/** [h, x0, y0, ...] rings: a CCW square, the same square CW, and an L. */
const SQUARE_CCW = [12, 0, 0, 10, 0, 10, 10, 0, 10];
const SQUARE_CW = [12, 0, 0, 0, 10, 10, 10, 10, 0];
const L_SHAPE = [9, 0, 0, 20, 0, 20, 8, 8, 8, 8, 20, 0, 20];

/** Per-triangle geometric normal, and the vertex normals it must agree with. */
function checkOutward(mesh, label) {
  const { position: p, normal: n, index } = mesh;
  let tris = 0;
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
    const u = [0, 1, 2].map((k) => p[b * 3 + k] - p[a * 3 + k]);
    const v = [0, 1, 2].map((k) => p[c * 3 + k] - p[a * 3 + k]);
    const g = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const dot = g[0] * n[a * 4] + g[1] * n[a * 4 + 1] + g[2] * n[a * 4 + 2];
    assert.ok(dot > 0, `${label}: triangle ${t / 3} faces against its normal`);
    tris++;
  }
  return tris;
}

test('both orientations of a ring give outward-facing triangles, and the same mesh', () => {
  const ccw = buildPackedMesh({ ...base, rows: [SQUARE_CCW] });
  const cw = buildPackedMesh({ ...base, rows: [SQUARE_CW] });
  assert.equal(ccw.vertexCount, 20);                    // 4 edges x 4 + 4 roof
  assert.equal(checkOutward(ccw, 'ccw'), 4 * 2 + 2);
  checkOutward(cw, 'cw');
  assert.equal(cw.vertexCount, ccw.vertexCount);
  const l = buildPackedMesh({ ...base, rows: [L_SHAPE] });
  checkOutward(l, 'L');
  assert.equal(l.index.length, 6 * 6 + 4 * 3);          // 6 walls x 6, a 6-gon roof is 4 triangles
});

test('the roof and wall normals agree with ExtrudeGeometry on the same ring', () => {
  const shape = new Shape(); shape.moveTo(L_SHAPE[1], -L_SHAPE[2]);
  for (let i = 3; i < L_SHAPE.length; i += 2) shape.lineTo(L_SHAPE[i], -L_SHAPE[i + 1]);
  const g = new ExtrudeGeometry(shape, { depth: L_SHAPE[0], bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  const ref = g.attributes.position, refN = g.attributes.normal;
  // every distinct (position, normal) pair of the reference with ny = 1 (roof) or horizontal (wall) must exist in ours
  const mine = buildPackedMesh({ ...base, rows: [L_SHAPE] });
  const keyOf = (x, y, z, nx, ny, nz) => [x, y, z].map((v) => (v + 0).toFixed(3).replace('-0.000', '0.000')).join(',') + '|' + [nx, ny, nz].map((v) => String(Math.round(v * 10) / 10 + 0).replace('-0', '0')).join(',');
  const have = new Set();
  for (let k = 0; k < mine.vertexCount; k++) {
    have.add(keyOf(mine.position[k * 3], mine.position[k * 3 + 1], mine.position[k * 3 + 2], mine.normal[k * 4] / 127, mine.normal[k * 4 + 1] / 127, mine.normal[k * 4 + 2] / 127));
  }
  let checked = 0;
  for (let k = 0; k < ref.count; k++) {
    if (refN.getY(k) < -0.5) continue;                  // the bottom cap is not drawn
    const key = keyOf(ref.getX(k), ref.getY(k), ref.getZ(k), refN.getX(k), refN.getY(k), refN.getZ(k));
    assert.ok(have.has(key), `reference vertex ${key} missing`);
    checked++;
  }
  assert.ok(checked > 20);
});

test('counts are exact: the arrays are allocated once at their final size', () => {
  const rows = [SQUARE_CCW, L_SHAPE, SQUARE_CW];
  const m = buildPackedMesh({ ...base, rows });
  assert.equal(m.position.length, m.vertexCount * 3);
  assert.equal(m.aH.length, m.vertexCount);
  assert.equal(m.buildings, 3);
  for (const idx of m.index) assert.ok(idx < m.vertexCount);
});

test('packed attributes decode to the source values', () => {
  const ground = (x, z) => 5 + x * 0.01;
  const m = buildPackedMesh({ ...base, rows: [SQUARE_CCW], groundAt: ground, inWard: [0] });
  const gx = 5 + 5 * 0.01;                               // centroid x of the square (mean of its points)
  assert.ok(Math.abs(m.aH[0] / 65535 * H_RANGE_M - 12) < 0.01);
  assert.ok(Math.abs(m.aG[0] / 32767 * G_RANGE_M - ground(4, 0)) < 0.7, `${m.aG[0]}`);
  assert.equal(m.aIn[0], 0);
  assert.equal(Math.min(...m.position.filter((_, k) => k % 3 === 1)), m.position[1]);
  assert.ok(m.position[1] > 5 && m.position[1] < gx + 1);
});

test('massing drops sheds and keeps towers, simplifies a noisy ring, and is 16 bytes a vertex', () => {
  const shed = [2.5, 0, 0, 3, 0, 3, 3, 0, 3];  // 9 m2, 2.5 m
  const noisy = [20];
  for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; noisy.push(15 * Math.cos(a) + (i % 2) * 0.2, 15 * Math.sin(a) + (i % 2) * 0.2); }
  const m = buildMassingMesh({ ...base, rows: [shed, SQUARE_CCW, noisy] });
  assert.equal(m.buildings, 2);
  assert.ok(m.vertexCount < 5 * 41 + 20, `simplified ring should not keep 40 points (${m.vertexCount})`);
  checkOutward(m, 'massing');
  assert.equal(meshBytes(m), m.vertexCount * MASSING_BYTES_PER_VERTEX + m.index.length * 4);
  assert.equal(PACKED_BYTES_PER_VERTEX, 30);
});

test('degenerate rows are skipped, not thrown on', () => {
  const rows = [[5, 0, 0, 1, 1], [0, 0, 0, 5, 0, 5, 5], [6, 0, 0, 5, 0, 10, 0], [8, 0, 0, 10, 0, 10, 10, 0, 10]];
  const m = buildPackedMesh({ ...base, rows });
  assert.equal(m.buildings, 1);
});

test('Canal Ring: the flat packed mesh is far under the bevelled 153 MB, and LOD1 is a fraction of it', () => {
  const file = new URL('../../public/heat-map/data/canal-ring.json', import.meta.url);
  const ward = JSON.parse(readFileSync(file, 'utf8'));
  const packed = buildPackedMesh({ ...base, rows: ward.b, sizeM: ward.sizeM });
  const massing = buildMassingMesh({ ...base, rows: ward.b, sizeM: ward.sizeM });
  assert.ok(packed.buildings > 20000);
  const packedMB = meshBytes(packed) / 1e6, massingMB = meshBytes(massing) / 1e6;
  console.log(`E4 packed ${packedMB.toFixed(1)} MB (${packed.vertexCount} v), massing ${massingMB.toFixed(2)} MB (${massing.vertexCount} v, ${massing.buildings} buildings)`);
  assert.ok(packedMB < 40, `${packedMB}`);
  assert.ok(massingMB < packedMB * 0.6, `${massingMB}`);
});
