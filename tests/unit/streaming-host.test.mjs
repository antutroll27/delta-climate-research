import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ExtrudeGeometry, Shape } from 'three';

import { buildBevelMesh } from '../../src/scripts/climate-engine/streaming-host/bevel-core.ts';
import { sheetUrls } from '../../src/scripts/climate-engine/streaming-host/city-stream.ts';
import { OVERLAY_FRAG, OVERLAY_FRAG_SEAMS } from '../../src/scripts/climate-engine/explore/heat-overlay.ts';
import { contactAoData, makeContactAO } from '../../src/scripts/climate-engine/explore/look-shading.ts';

const ward = JSON.parse(readFileSync(new URL('../../public/heat-map/data/canal-ring.json', import.meta.url), 'utf8'));
const SAMPLE = ward.b.slice(0, 400);

test('the bevel core builds the same vertices as one ExtrudeGeometry per building, into arrays allocated once', () => {
  let expected = 0;
  for (const b of SAMPLE) {
    const shape = new Shape(); shape.moveTo(b[1], -b[2]);
    for (let i = 3; i < b.length; i += 2) shape.lineTo(b[i], -b[i + 1]);
    expected += new ExtrudeGeometry(shape, { depth: Math.max(0.6, b[0] - 1.4), bevelEnabled: true, bevelThickness: 0.7, bevelSize: 0.55, bevelSegments: 1 }).attributes.position.count;
  }
  const mesh = buildBevelMesh({ rows: SAMPLE, sizeM: 2800, groundAt: () => 0, inWard: null });
  assert.equal(mesh.vertexCount, expected);
  assert.ok(mesh.position.length / 3 - mesh.vertexCount < 0.01 * mesh.vertexCount + 16, 'the upper bound is tight');
  const bytes = ['position', 'normal', 'aDelay', 'aH', 'aCtr', 'aG', 'aIn'].reduce((s, k) => s + mesh[k].BYTES_PER_ELEMENT * mesh[k].length, 0);
  assert.ok(Math.abs(bytes / (mesh.position.length / 3) - 48) < 1e-9, '48 bytes a vertex: no uv');
});

test('ground height seats a building: y and aG carry the terrain under its centroid', () => {
  const mesh = buildBevelMesh({ rows: [SAMPLE[0]], sizeM: 2800, groundAt: () => 3.5, inWard: [0] });
  assert.equal(mesh.aG[0], 3.5);
  assert.equal(mesh.aIn[0], 0);
  const lowest = Math.min(...Array.from({ length: mesh.vertexCount }, (_, k) => mesh.position[k * 3 + 1]));
  assert.ok(Math.abs(lowest - (3.5 - 0.7)) < 1e-5, `the bevel sinks the foot 0.7 m below the ground, as today's mesh does (${lowest})`);
});

test('the seam overlay differs from the shipped one in exactly the edge expression and one uniform', () => {
  assert.notEqual(OVERLAY_FRAG_SEAMS, OVERLAY_FRAG);
  assert.ok(OVERLAY_FRAG_SEAMS.includes('uniform vec4 uSeams;'));
  assert.ok(!OVERLAY_FRAG_SEAMS.includes('smoothstep(0.0,0.16,min(min(vUv.x,1.0-vUv.x),min(vUv.y,1.0-vUv.y)))'));
  assert.ok(OVERLAY_FRAG.includes('smoothstep(0.0,0.16,min(min(vUv.x,1.0-vUv.x),min(vUv.y,1.0-vUv.y)))'), 'every other city keeps the original text');
  assert.ok(!OVERLAY_FRAG.includes('uSeams'));
  // with all four sides on, the replacement expression is the original's value; off sides contribute 1.0, never the minimum
  const edge = (u, v, s) => {
    const mix = (a, b, t) => a * (1 - t) + b * t;
    return Math.min(Math.min(mix(1, u, s[0]), mix(1, 1 - u, s[1])), Math.min(mix(1, v, s[2]), mix(1, 1 - v, s[3])));
  };
  const orig = (u, v) => Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v));
  for (const [u, v] of [[0.01, 0.5], [0.5, 0.99], [0.3, 0.3], [0.97, 0.02]]) assert.equal(edge(u, v, [1, 1, 1, 1]), orig(u, v));
  assert.equal(edge(0.01, 0.5, [0, 1, 1, 1]), 0.5, 'an interior west seam no longer fades');
  assert.equal(edge(0.5, 0.5, [0, 0, 0, 0]), 1, 'a sheet with neighbours on every side never fades');
});

test('the contact-occlusion bake split into data + texture changes no byte', () => {
  const rows = SAMPLE.slice(0, 200);
  const data = contactAoData(rows, 2800, 256, 6);
  const texture = makeContactAO(rows, 2800, 256, 6);
  assert.deepEqual(Array.from(texture.image.data.slice(0, 4096)), Array.from(data.slice(0, 4096)));
  assert.equal(data.length, 256 * 256 * 4);
});

test('a sheet\'s artefacts are the flat directory by area id; Canal Ring keeps its own', () => {
  assert.equal(sheetUrls('F4').ward, '/heat-map/data/ams-f4.json');
  assert.equal(sheetUrls('F4').surface, '/heat-map/data/ams-f4-surface.png');
  assert.equal(sheetUrls('E4').ward, '/heat-map/data/canal-ring.json');
  assert.equal(sheetUrls('E4').trees, '/heat-map/data/canal-ring-trees.json');
});

import { makeHeatOverlay } from '../../src/scripts/climate-engine/explore/heat-overlay.ts';

test('S1: `streamed` reaches the renderer from the flag alone, whatever the order of caps, map load and the sim host', () => {
  const app = readFileSync(new URL('../../src/scripts/climate-engine/heat-map-app.ts', import.meta.url), 'utf8');
  const flag = app.indexOf('const STREAM_ON = ');
  const relief = app.indexOf('async function ensureRelief');
  assert.ok(flag > 0 && relief > 0 && flag < relief, 'the flag is declared before the code that builds the renderer');
  const options = app.slice(relief, relief + 2500);
  assert.match(options, /\.\.\.\(STREAM_ON \? \{ streamed:/);
  assert.ok(!/wrapHost \? \{ streamed/.test(app), 'it must not depend on startStream having run');
});

test('S1: a renderer given the seam holder compiles the seam-aware overlay; without it, the shipped one', () => {
  const holders = {
    heat: { value: null }, heatMin: { value: 0 }, heatMax: { value: 1 }, cooling: { value: 0 }, ao: { value: null },
    aoAmt: { value: 0 }, aoW: { value: null }, haze: { value: 0 }, hazeCol: { value: null }, opBoost: { value: 1 },
  };
  assert.ok(makeHeatOverlay({ ...holders, seams: { value: null } }).fragmentShader.includes('uSeams'));
  assert.ok(!makeHeatOverlay(holders).fragmentShader.includes('uSeams'));
});
