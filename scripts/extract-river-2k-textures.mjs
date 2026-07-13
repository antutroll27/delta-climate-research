// One-off: pull the 2048px albedo + normal out of the original river-2k.glb
// (deploy-ignored) into public/textures/, for the desktop progressive texture
// upgrade in river-scene.ts. Zero deps — parses the GLB container directly.
// Usage: node scripts/extract-river-2k-textures.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const glb = readFileSync('public/models/river-2k.glb');
if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');

// chunks: [len u32][type u32][data]; first is JSON, then BIN
const jsonLen = glb.readUInt32LE(12);
const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8; // skip BIN chunk header

const wanted = { albedo: 'river-albedo-2k.webp', normal: 'river-normal-2k.webp' };
let found = 0;
for (const img of json.images ?? []) {
  const out = wanted[img.name];
  if (!out) continue;
  const bv = json.bufferViews[img.bufferView];
  const data = glb.subarray(binStart + (bv.byteOffset ?? 0), binStart + (bv.byteOffset ?? 0) + bv.byteLength);
  if (img.mimeType !== 'image/webp') throw new Error(`${img.name}: expected webp, got ${img.mimeType}`);
  writeFileSync(`public/textures/${out}`, data);
  console.log(`wrote public/textures/${out} (${(data.length / 1024).toFixed(0)} KB)`);
  found++;
}
if (found !== 2) throw new Error(`expected 2 textures, extracted ${found}`);
