// Bake a "skirt" for the river scan — the extruded side walls that turn the
// open photogrammetry shell into a solid-looking slab of earth.
//
// The scan is a thin crust with an open boundary; from the drone camera you see
// straight through its rim. This finds every boundary edge (an edge used by
// exactly ONE triangle) and extrudes it straight down, producing side walls.
// Done offline because boundary detection is ~1.5M edge lookups — far too slow
// for the main thread. Output is a compact binary the scene streams at runtime.
//
// Vertex layout of the output (public/models/river-skirt.bin):
//   [u32 vertCount][u32 idxCount][u32 indexBytes]
//   [f32 originXYZ][f32 extentXYZ]   dequantization frame
//   [pos  u16 x3 * vertCount]   quantized over the bbox — same local space as the scan
//   [uv   u16 x2 * vertCount]   copied from the rim so the top edge is seamless
//   [idx  u16/u32 * idxCount]
// The first half of the verts is the rim (fade=0), the second half the extruded
// bottom (fade=1) — so the fade factor is derived at runtime, never stored.
//
// Usage: node scripts/build-river-skirt.mjs [depthFraction]
//   depthFraction — skirt depth as a fraction of the scan's Y extent (default 0.55)

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const DEPTH_FRAC = parseFloat(process.argv[2] ?? '0.55');
const SRC = 'public/models/river-1k.glb';
const PLAIN = '/tmp/river-plain.glb';
const OUT = 'public/models/river-skirt.bin';

// Draco-compressed on disk — decompress to raw accessors first.
execSync(`npx --yes @gltf-transform/cli copy ${SRC} ${PLAIN}`, { stdio: 'ignore' });

// ── parse the GLB container ──────────────────────────────────────────────────
const glb = readFileSync(PLAIN);
if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
const jsonLen = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;

const COMP = { 5126: 4, 5125: 4, 5123: 2 };          // FLOAT, UINT, USHORT
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3 };

function read(accIdx) {
  const acc = gltf.accessors[accIdx];
  const bv = gltf.bufferViews[acc.bufferView];
  const n = NUM[acc.type];
  const stride = bv.byteStride ?? n * COMP[acc.componentType];
  const base = binStart + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const Arr = acc.componentType === 5126 ? Float32Array
    : acc.componentType === 5125 ? Uint32Array : Uint16Array;
  const out = new Arr(acc.count * n);
  const packed = stride === n * COMP[acc.componentType];
  if (packed) {
    // fast path — copy straight through (respecting alignment)
    const view = new Arr(glb.buffer.slice(glb.byteOffset + base, glb.byteOffset + base + acc.count * stride));
    out.set(view.subarray(0, out.length));
  } else {
    for (let i = 0; i < acc.count; i++) {
      const o = base + i * stride;
      for (let c = 0; c < n; c++) {
        out[i * n + c] = acc.componentType === 5126 ? glb.readFloatLE(o + c * 4)
          : acc.componentType === 5125 ? glb.readUInt32LE(o + c * 4) : glb.readUInt16LE(o + c * 2);
      }
    }
  }
  return out;
}

const prim = gltf.meshes[0].primitives[0];
const pos = read(prim.attributes.POSITION);
const uv = read(prim.attributes.TEXCOORD_0);
const idx = read(prim.indices);
const vertCount = pos.length / 3;
const triCount = idx.length / 3;
console.log(`scan: ${vertCount.toLocaleString()} verts, ${triCount.toLocaleString()} tris`);

// ── find boundary edges: those referenced by exactly one triangle ────────────
// Key each undirected edge as min*V + max (safe under 2^53 for V ≈ 262k).
const V = vertCount;
const seen = new Map();
for (let t = 0; t < triCount; t++) {
  const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
  for (const [u, v] of [[a, b], [b, c], [c, a]]) {
    const k = u < v ? u * V + v : v * V + u;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
}
const boundary = [];
for (const [k, count] of seen) {
  if (count !== 1) continue;
  boundary.push([Math.floor(k / V), k % V]);
}
console.log(`boundary edges: ${boundary.length.toLocaleString()}`);
if (!boundary.length) throw new Error('mesh is closed — nothing to extrude');

// A photogrammetry scan has INTERIOR holes, and their rims are boundary edges
// too. Extruding those hangs little curtains inside the riverbed. Group the
// boundary into connected loops (union-find over shared vertices) and keep only
// the largest — the outer silhouette. Everything else is a hole; skip it.
const parent = new Map();
const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
for (const [a, b] of boundary) { if (!parent.has(a)) parent.set(a, a); if (!parent.has(b)) parent.set(b, b); }
for (const [a, b] of boundary) union(a, b);

const groups = new Map();
for (const e of boundary) {
  const r = find(e[0]);
  if (!groups.has(r)) groups.set(r, []);
  groups.get(r).push(e);
}
const loops = [...groups.values()];

// Size, not edge-count, is what separates the silhouette from a hole: the outer
// perimeter is RAGGED (it fragments into several loops), while interior holes
// are spatially tiny. Keep any loop whose XZ footprint spans a meaningful
// fraction of the scan; drop the rest.
let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity;
for (let i = 0; i < vertCount; i++) {
  const x = pos[i * 3], z = pos[i * 3 + 2];
  if (x < mnX) mnX = x; if (x > mxX) mxX = x;
  if (z < mnZ) mnZ = z; if (z > mxZ) mxZ = z;
}
const meshDiag = Math.hypot(mxX - mnX, mxZ - mnZ);
const MIN_SPAN = 0.06;                               // 6% of the scan's footprint

const kept = [];
let dropped = 0, droppedEdges = 0;
for (const loop of loops) {
  let lx0 = Infinity, lx1 = -Infinity, lz0 = Infinity, lz1 = -Infinity;
  for (const [a, b] of loop) for (const v of [a, b]) {
    const x = pos[v * 3], z = pos[v * 3 + 2];
    if (x < lx0) lx0 = x; if (x > lx1) lx1 = x;
    if (z < lz0) lz0 = z; if (z > lz1) lz1 = z;
  }
  if (Math.hypot(lx1 - lx0, lz1 - lz0) / meshDiag >= MIN_SPAN) kept.push(loop);
  else { dropped++; droppedEdges += loop.length; }
}
const keptEdges = kept.reduce((n, l) => n + l.length, 0);
console.log(`  loops: ${loops.length} → kept ${kept.length} silhouette piece(s), ${keptEdges.toLocaleString()} edges`);
console.log(`  dropped ${dropped} interior hole(s) (${droppedEdges.toLocaleString()} edges) below ${MIN_SPAN * 100}% span`);
if (!keptEdges) throw new Error('no silhouette survived the span filter');
boundary.length = 0;
boundary.push(...kept.flat());

// ── extrude each boundary edge straight down ────────────────────────────────
let minY = Infinity, maxY = -Infinity;
for (let i = 0; i < vertCount; i++) { const y = pos[i * 3 + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
const depth = (maxY - minY) * DEPTH_FRAC;
console.log(`scan Y extent ${(maxY - minY).toFixed(2)} → skirt depth ${depth.toFixed(2)} (${DEPTH_FRAC}×)`);

// Adjacent boundary edges SHARE vertices — index them instead of duplicating
// (halves the file). The rim verts become the top row; the same list pushed
// down by `depth` becomes the bottom row. Indices + the fade factor are fully
// derivable from vertex order, so neither is stored.
const rim = [...new Set(boundary.flat())];           // unique boundary vertices
const slot = new Map(rim.map((v, i) => [v, i]));
const R = rim.length;
const n = R * 2;                                     // top row + bottom row

const sPos = new Float32Array(n * 3);
const sUv = new Float32Array(n * 2);
rim.forEach((v, i) => {
  const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
  sPos[i * 3] = x; sPos[i * 3 + 1] = y; sPos[i * 3 + 2] = z;                 // top (on the rim)
  sPos[(R + i) * 3] = x; sPos[(R + i) * 3 + 1] = y - depth; sPos[(R + i) * 3 + 2] = z; // bottom
  const u = uv[v * 2], w = uv[v * 2 + 1];
  sUv[i * 2] = u; sUv[i * 2 + 1] = w;
  sUv[(R + i) * 2] = u; sUv[(R + i) * 2 + 1] = w;    // same UV → texture smears down as strata
});

// one quad per boundary edge, stitched across the two rows
const sIdx = R * 2 <= 65535 ? new Uint16Array(boundary.length * 6) : new Uint32Array(boundary.length * 6);
boundary.forEach(([a, b], e) => {
  const at = slot.get(a), bt = slot.get(b);
  const ab = R + at, bb = R + bt;
  const o = e * 6;
  sIdx[o] = at; sIdx[o + 1] = bt; sIdx[o + 2] = bb;
  sIdx[o + 3] = at; sIdx[o + 4] = bb; sIdx[o + 5] = ab;
});
console.log(`rim verts: ${R.toLocaleString()} → skirt ${n.toLocaleString()} verts, ${boundary.length.toLocaleString()} quads (idx ${sIdx.BYTES_PER_ELEMENT * 8}-bit)`);

// ── quantize: int16 positions over the skirt's bbox + uint16 UVs ────────────
// 16-bit over a ~120-unit bbox ≈ 0.002 unit precision — orders of magnitude
// below a pixel at this camera. Halves the download; runtime dequantizes.
let qx0 = Infinity, qy0 = Infinity, qz0 = Infinity, qx1 = -Infinity, qy1 = -Infinity, qz1 = -Infinity;
for (let i = 0; i < n; i++) {
  const x = sPos[i * 3], y = sPos[i * 3 + 1], z = sPos[i * 3 + 2];
  if (x < qx0) qx0 = x; if (x > qx1) qx1 = x;
  if (y < qy0) qy0 = y; if (y > qy1) qy1 = y;
  if (z < qz0) qz0 = z; if (z > qz1) qz1 = z;
}
const ext = [qx1 - qx0 || 1, qy1 - qy0 || 1, qz1 - qz0 || 1];
const org = [qx0, qy0, qz0];
const qPos = new Uint16Array(n * 3);
const qUv = new Uint16Array(n * 2);
for (let i = 0; i < n; i++) {
  for (let c = 0; c < 3; c++) qPos[i * 3 + c] = Math.round(((sPos[i * 3 + c] - org[c]) / ext[c]) * 65535);
  for (let c = 0; c < 2; c++) qUv[i * 2 + c] = Math.round(Math.min(1, Math.max(0, sUv[i * 2 + c])) * 65535);
}
const maxErr = Math.max(...ext) / 65535;
console.log(`quantized: pos u16 over bbox [${ext.map((e) => e.toFixed(1)).join(' × ')}] → max error ${maxErr.toFixed(4)} units`);

const header = Buffer.alloc(12 + 24);
header.writeUInt32LE(n, 0);                          // total verts (top row + bottom row)
header.writeUInt32LE(sIdx.length, 4);                // index count
header.writeUInt32LE(sIdx.BYTES_PER_ELEMENT, 8);     // 2 = Uint16, 4 = Uint32
org.forEach((v, i) => header.writeFloatLE(v, 12 + i * 4));    // dequant origin
ext.forEach((v, i) => header.writeFloatLE(v, 24 + i * 4));    // dequant extent
const out = Buffer.concat([
  header,
  Buffer.from(qPos.buffer), Buffer.from(qUv.buffer), Buffer.from(sIdx.buffer),
]);
writeFileSync(OUT, out);
console.log(`wrote ${OUT} — ${n.toLocaleString()} verts, ${(out.length / 1024).toFixed(0)} KB`);
