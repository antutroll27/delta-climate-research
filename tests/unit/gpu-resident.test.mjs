/**
 * The CPU copy of a building mesh goes after upload, and only then.
 *
 * three calls `attribute.onUploadCallback()` right after `gl.bufferData` (WebGLAttributes.js),
 * so the test calls it itself: a real upload needs a GL context, which node does not have.
 * The browser side (a click after the free, a lost-and-restored context) is
 * tests/e2e/obos-free-mesh-arrays.spec.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { releaseCpuCopyAfterUpload } from '../../src/scripts/climate-engine/explore/gpu-resident.ts';

function building() {
  const geometry = new THREE.BoxGeometry(10, 20, 10).toNonIndexed();
  geometry.setAttribute('aH', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(20), 1));
  return geometry;
}
const upload = (geometry) => { for (const a of Object.values(geometry.attributes)) a.onUploadCallback(); };

test('every attribute keeps its array until it is uploaded, then drops it', () => {
  const geometry = building();
  releaseCpuCopyAfterUpload(geometry);
  for (const a of Object.values(geometry.attributes)) assert.ok(a.array instanceof Float32Array, 'still there before the upload');
  upload(geometry);
  for (const [name, a] of Object.entries(geometry.attributes)) assert.equal(a.array, null, `${name} freed`);
});

test('the vertex count, the draw range and the bounds survive the free', () => {
  const geometry = building();
  const count = geometry.attributes.position.count;
  releaseCpuCopyAfterUpload(geometry);
  upload(geometry);
  assert.equal(geometry.attributes.position.count, count, 'three draws from attribute.count');
  assert.equal(geometry.attributes.aH.count, count);
  assert.equal(geometry.boundingSphere.radius > 0, true, 'frustum culling asks for the sphere lazily');
  assert.equal(geometry.boundingBox.max.y, 10);
  assert.doesNotThrow(() => geometry.computeBoundingSphere === undefined);
});

test('an indexed geometry frees its index too', () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  releaseCpuCopyAfterUpload(geometry);
  geometry.index.onUploadCallback();
  assert.equal(geometry.index.array, null);
});

test('an interleaved attribute is left alone: its buffer is shared, not owned', () => {
  const geometry = new THREE.BufferGeometry();
  const buffer = new THREE.InterleavedBuffer(new Float32Array(12), 3);
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
  releaseCpuCopyAfterUpload(geometry);
  assert.ok(buffer.array instanceof Float32Array);
});
