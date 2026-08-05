import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The vegetation raster and the built raster must describe the SAME ground.
 *
 * They did not. The surface PNG is north-up (rasterio reads a north-up COG and the
 * exporter saves it unrotated); every grid in the simulation is south-up
 * (`ward-raster.ts`'s `sampleY = -half + gridY * cellM`). Reading the PNG
 * row-major into the sim's grid put each cell's greenery in its mirror image, so
 * `eqCell` combined a cell's real built fraction with another cell's vegetation.
 *
 * This is a MEASURED guard, not a source grep: it re-derives the correlation from
 * the committed artefacts. Dense building means low vegetation, so the correct
 * orientation is the one that produces a NEGATIVE correlation. A source grep would
 * have gone stale the moment the loop was rewritten; this cannot.
 */

const WARDS = ['ballygunge', 'barrackpore', 'baruipur'];

/** Minimal PNG reader: enough for the 8-bit RGB(A) the exporter writes. */
async function decodePng(path) {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const zlib = require('node:zlib');
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

const corr = (a, b) => {
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return num / Math.sqrt(da * db);
};

/** Building count per cell on the SIM grid — row 0 = SOUTH, as `sampleY` defines. */
function builtGrid(ward, n) {
  const half = ward.sizeM / 2, g = new Float64Array(n * n);
  for (const b of ward.b) {
    const m = (b.length - 1) >> 1;
    let cx = 0, cy = 0;
    for (let i = 0; i < m; i++) { cx += b[1 + 2 * i]; cy += b[2 + 2 * i]; }
    cx /= m; cy /= m;
    const gx = Math.floor(((cx + half) / ward.sizeM) * n);
    const gy = Math.floor(((cy + half) / ward.sizeM) * n);
    if (gx >= 0 && gx < n && gy >= 0 && gy < n) g[gy * n + gx] += 1;
  }
  return g;
}

const box = (src, n, k = 5) => {
  const out = new Float64Array(n * n), r = k >> 1;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let s = 0, c = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const yy = Math.min(n - 1, Math.max(0, y + dy)), xx = Math.min(n - 1, Math.max(0, x + dx));
      s += src[yy * n + xx]; c++;
    }
    out[y * n + x] = s / c;
  }
  return out;
};

test('vegetation and buildings describe the same ground, not mirror images', async () => {
  for (const name of WARDS) {
    const png = await decodePng(join(ROOT, `public/heat-map/data/${name}-surface.png`));
    const ward = JSON.parse(await readFile(join(ROOT, `public/heat-map/data/${name}.json`), 'utf8'));
    const n = png.width;

    /* The loader's row flip, reproduced: PNG row 0 is NORTH, sim row 0 is SOUTH. */
    const veg = new Float64Array(n * n);
    for (let row = 0; row < n; row++)
      for (let col = 0; col < n; col++)
        veg[(n - 1 - row) * n + col] = png.data[(row * n + col) * png.channels];

    const built = builtGrid(ward, n);
    const r = corr(Array.from(box(veg, n)), Array.from(box(built, n)));

    assert.ok(r < -0.15,
      `${name}: corr(veg, built) = ${r.toFixed(3)}, expected clearly negative. Dense building `
      + 'means low vegetation. A value near zero or positive means the surface raster and the '
      + 'simulation grid disagree about which row is north again — see the row flip in '
      + 'surface-raster.ts. Every eqCell would be combining a cell\'s built fraction with '
      + 'another cell\'s greenery.');
  }
});

test('and the UNFLIPPED read is measurably worse — the bug this replaced', async () => {
  const png = await decodePng(join(ROOT, 'public/heat-map/data/ballygunge-surface.png'));
  const ward = JSON.parse(await readFile(join(ROOT, 'public/heat-map/data/ballygunge.json'), 'utf8'));
  const n = png.width;
  const naive = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) naive[i] = png.data[i * png.channels];
  const built = builtGrid(ward, n);
  const r = corr(Array.from(box(naive, n)), Array.from(box(built, n)));
  assert.ok(r > -0.15,
    `reading the PNG row-major should give a near-zero or positive correlation (it gave `
    + `${r.toFixed(3)}). If this is now strongly negative the exporter's row order changed, `
    + 'and the flip in surface-raster.ts has become the bug rather than the fix.');
});
