/**
 * The CPU copy of a building mesh goes after upload, and only then.
 *
 * three calls `attribute.onUploadCallback()` right after `gl.bufferData` (WebGLAttributes.js),
 * so most of these tests call it themselves. The ordering that makes that safe is pinned against
 * three's own `WebGLAttributes` on a stub GL context (the last tests): the array is handed to
 * `bufferData` first, `onUploadCallback` runs after it, and three needs nothing from the array afterwards.
 * The browser side (a click after the free, a lost-and-restored context, a restore with no network) is
 * tests/e2e/heat-map-free-mesh.spec.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { WebGLAttributes } from 'three/src/renderers/webgl/WebGLAttributes.js';
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
  /* what a frame does with the mesh before drawing it: frustum culling reads the stored sphere, and would throw if it had to recompute from a freed array */
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(new THREE.PerspectiveCamera(60, 1, 1, 1000).projectionMatrix, new THREE.Matrix4().makeTranslation(0, 0, -100)),
  );
  assert.equal(frustum.intersectsObject(mesh), true);
  const far = new THREE.Mesh(geometry, mesh.material);
  far.position.x = 5000; far.updateMatrixWorld();
  assert.equal(frustum.intersectsObject(far), false);
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

/** A WebGL2 context that records what three asks of it, and enough of it for `WebGLAttributes`. */
function stubGl(log) {
  let next = 1;
  return {
    ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893, FLOAT: 0x1406, UNSIGNED_SHORT: 0x1403, UNSIGNED_INT: 0x1405, HALF_FLOAT: 0x140b,
    BYTE: 0x1400, UNSIGNED_BYTE: 0x1401, SHORT: 0x1402, INT: 0x1404,
    createBuffer: () => ({ id: next++ }),
    bindBuffer: () => undefined,
    bufferData: (target, array) => { log.push({ call: 'bufferData', target, array, bytes: array.byteLength }); },
    bufferSubData: () => { log.push({ call: 'bufferSubData' }); },
    deleteBuffer: () => undefined,
  };
}

test('three uploads from the array first and lets go of it after: the real WebGLAttributes path', () => {
  const geometry = building();
  releaseCpuCopyAfterUpload(geometry);
  const position = geometry.attributes.position;
  const original = position.array;
  const log = [];
  const gl = stubGl(log);
  /* the callback fires from inside three; record the moment, and whether the array was still there when bufferData ran */
  const seen = [];
  const free = position.onUploadCallback;
  position.onUploadCallback = () => { seen.push('onUpload'); free(); };
  const realBufferData = gl.bufferData;
  gl.bufferData = (target, array, usage) => { seen.push(position.array === original ? 'bufferData(array present)' : 'bufferData(array GONE)'); realBufferData(target, array, usage); };

  const attributes = new WebGLAttributes(gl);
  attributes.update(position, gl.ARRAY_BUFFER);

  assert.deepEqual(seen, ['bufferData(array present)', 'onUpload'], 'copy, upload, then onUpload');
  assert.equal(log[0].array, original, 'the GPU received the very array three held');
  assert.equal(log[0].bytes, position.count * 3 * 4);
  assert.equal(position.array, null, 'and the CPU copy is gone');
  /* three recorded the element type and size from its own local copy, so it needs nothing from the attribute afterwards */
  const record = attributes.get(position);
  assert.equal(record.type, gl.FLOAT);
  assert.equal(record.bytesPerElement, 4);
  assert.equal(record.size, log[0].bytes);
  /* every later frame asks again and must find the buffer without touching the array */
  assert.doesNotThrow(() => { for (let frame = 0; frame < 3; frame++) attributes.update(position, gl.ARRAY_BUFFER); });
  assert.equal(log.length, 1, 'no second upload');
});

test('a whole building mesh goes through WebGLAttributes: every vertex attribute and the index', () => {
  const geometry = new THREE.BoxGeometry(10, 20, 10);   // indexed, three attributes
  geometry.setAttribute('aH', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(20), 1));
  releaseCpuCopyAfterUpload(geometry);
  const log = [];
  const gl = stubGl(log);
  const attributes = new WebGLAttributes(gl);
  for (const attribute of Object.values(geometry.attributes)) attributes.update(attribute, gl.ARRAY_BUFFER);
  attributes.update(geometry.index, gl.ELEMENT_ARRAY_BUFFER);
  assert.equal(log.filter((c) => c.call === 'bufferData').length, 5, 'position, normal, uv, aH and the index');
  assert.equal(attributes.get(geometry.index).type, gl.UNSIGNED_SHORT);
  for (const [name, attribute] of Object.entries(geometry.attributes)) assert.equal(attribute.array, null, `${name} freed`);
  assert.equal(geometry.index.array, null);
});

test('the contract: a freed attribute cannot be uploaded again, which is why a restore rebuilds the mesh', () => {
  const geometry = building();
  releaseCpuCopyAfterUpload(geometry);
  const position = geometry.attributes.position;
  const log = [];
  const gl = stubGl(log);
  new WebGLAttributes(gl).update(position, gl.ARRAY_BUFFER);
  /* a restored context makes three build a fresh WebGLAttributes, which uploads from the array again */
  assert.throws(() => new WebGLAttributes(stubGl([])).update(position, gl.ARRAY_BUFFER), TypeError);
});
