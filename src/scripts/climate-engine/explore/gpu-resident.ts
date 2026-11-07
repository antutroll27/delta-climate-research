/**
 * gpu-resident.ts — let a static mesh's CPU copy go once the GPU holds it.
 *
 * three.js keeps `attribute.array` for the life of a geometry, because it
 * re-uploads from it after a WebGL context loss. For a ward's merged building
 * mesh that is a second copy of every vertex: 182 MB of ArrayBuffers beside
 * 160 MB of GL buffers on Amsterdam's Canal Ring (city-streaming P0, section 3).
 *
 * Only for attributes NOTHING reads or rewrites after upload. A freed attribute
 * cannot be re-uploaded, so the owner MUST rebuild the geometry from its source
 * data on `webglcontextrestored` (relief-renderer.ts `onGlRestored`); and
 * `needsUpdate` on one would crash the next upload. The bounding volumes are
 * computed first, because frustum culling asks for them lazily from `position`.
 *
 * Type-only import of three, so the unit test can drive this without a GL context
 * by calling `onUploadCallback` itself, as the renderer does after `bufferData`.
 */
import type * as THREE from 'three';

/**
 * Arrange for every attribute (and the index) of `geometry` to drop its typed
 * array right after its first GPU upload. Call once, after the geometry is
 * fully built and before it is first rendered.
 */
export function releaseCpuCopyAfterUpload(geometry: THREE.BufferGeometry): void {
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const release = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null): void => {
    if (!attribute || 'isInterleavedBufferAttribute' in attribute) return;   // shared interleaved data: not ours to null
    attribute.onUpload(() => { (attribute as { array: unknown }).array = null; });
  };
  for (const name of Object.keys(geometry.attributes)) release(geometry.attributes[name]);
  release(geometry.index);
}
