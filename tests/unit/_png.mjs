/**
 * Minimal PNG reader: enough for the 8-bit RGB(A) the surface exporter writes.
 *
 * WHY A HAND-ROLLED DECODER. The tests that need it assert on the COMMITTED
 * artefacts — the real `{ward}-surface.png` on disk, not a fixture — because
 * that is what makes them measurements rather than restatements. Node has no
 * `createImageBitmap`, and pulling an image library in as a dev dependency to
 * read four bytes per pixel is a larger surface than the 40 lines below.
 *
 * SHARED because two tests now decode the same files: the orientation guard
 * (`heat-map-surface-orientation.test.mjs`, which re-derives corr(veg, built))
 * and the measured-level guard (`heat-map-surface-measured.test.mjs`, which
 * drives the real `loadWardSurface` against a stubbed browser). A second copy
 * would be a second thing to keep correct, and a decoder that is subtly wrong in
 * one file and right in the other is the worst way to find that out.
 */
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

/** @returns {Promise<{width:number,height:number,channels:number,data:Uint8Array}>} */
export async function decodePng(path) {
  const buf = await readFile(path);
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      bitDepth = body[8]; colorType = body[9];
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  assert.equal(bitDepth, 8, 'exporter writes 8-bit');
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  assert.ok(channels, `unsupported PNG colour type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * channels);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
    out.set(cur, y * stride);
    prev = cur;
  }
  return { width, height, channels, data: out };
}

/** The decoded RGB(A) rows widened to a 4-channel RGBA buffer, which is the
 *  shape `CanvasRenderingContext2D.getImageData().data` has — so a test can hand
 *  it straight to the production decode path without a second conversion. */
export function toRgba({ width, height, channels, data }) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 4; c++) {
      rgba[i * 4 + c] = c < channels ? data[i * channels + c] : (c === 3 ? 255 : 0);
    }
  }
  return rgba;
}
