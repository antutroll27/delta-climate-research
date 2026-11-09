#!/usr/bin/env node
/**
 * build-area-bundles.mjs — pack each streamed Amsterdam area's six layer files into ONE bundle (`<area>.obosb`), so the page makes
 * one request per area instead of six. No dependencies: node:fs, node:zlib, node:crypto only.
 *
 *   node scripts/build-area-bundles.mjs --src <dir with the ams-* files + ams-r2-manifest.json> --out <dir> [--manifest <file>]
 *
 * Reads the 186 source files (never modifies them), REFUSES any whose sha256 disagrees with the current manifest (`ams-r2-manifest.json`,
 * written by upload-city-data.mjs), and writes <out>/<area>.obosb for each of the 31 areas plus <out>/ams-r2-bundles.json.
 * Output is deterministic: the same inputs give byte-identical bundles (gzip header pinned, sections in a fixed order, no timestamps).
 *
 * ── THE FORMAT (version 1) — the reader is src/scripts/climate-engine/streaming/area-bundle.ts; design note: BUNDLE-FORMAT.md ──────────
 *
 *   offset  size  field
 *   0       8     magic   89 4F 42 53 42 0D 0A 1A   (PNG's trick: the high bit catches 7-bit stripping, CR LF catches newline
 *                         translation, 1A stops a DOS `type`; "OBSB" = OBOS bundle)
 *   8       2     u16  format version (1). Bumped ONLY when this container layout changes; new sections and new header fields do not.
 *   10      2     u16  flags (0; reserved, a v1 reader ignores them)
 *   12      4     u32  headerLength H
 *   16      H     header: UTF-8 JSON, below. NOT compressed (about 1 KB; the page needs it before it can decide anything).
 *   16+H    pad   zero bytes up to the next multiple of 8
 *   D       ...   the data region (D = 16+H rounded up to 8). Each section starts at D + its `offset` and is followed by zero padding up to
 *                 the next multiple of 8, so every section starts 8-byte aligned in the file.
 *
 *   ENDIANNESS: every fixed-width integer in the prelude is LITTLE-endian (every browser the page runs on is little-endian, and typed
 *   arrays are native-endian, so a future identity-encoded Float32 section can be viewed in place). Section payloads carry their own
 *   endianness: JSON and PNG have none; a future binary section states its own in its mediaType (e.g. `application/x-float32-le`).
 *   ALIGNMENT: sections start on 8-byte boundaries of the FILE. `new Float32Array(buffer, D + offset, n)` is legal for an identity
 *   section only when the whole bundle is read into ONE ArrayBuffer at offset 0 (it is: parseAreaBundle takes the response's ArrayBuffer).
 *
 *   header JSON (key order fixed, so the bytes are deterministic):
 *     { "format": "obos-area-bundle", "version": 1, "city": "amsterdam", "areaId": "ams-f4", "contentHash": "<hex64>",
 *       "sections": [ { "name", "offset", "length", "encoding": "gzip"|"identity", "mediaType", "sha256", "size" }, ... ] }
 *     offset  = bytes from D to the section's first byte           length = STORED bytes (compressed, for gzip)
 *     sha256  = of the DECODED bytes (what the old per-file manifest hashed)    size = DECODED byte count
 *     contentHash = sha256 of  "obos-area-bundle/1\n" + areaId + "\n" + (sections sorted by name, one line each:
 *                   name TAB encoding TAB mediaType TAB size TAB sha256 LF).  It does not depend on offsets or on the compressor, so it is
 *                   the same under any zlib build, and it covers the whole table (a doctored header fails it).
 *
 *   SECTIONS TODAY: ward (buildings, application/json), roads, water, trees, terrain (all application/json, gzip), surface (image/png,
 *   identity: already deflated). They are named after the loader's own fields (data-source.ts FIELDS). A new layer is a new section name.
 *
 *   WHY GZIP INSIDE THE CONTAINER: the Worker serves the bundle as application/octet-stream and Cloudflare does not compress that type.
 *   The reader inflates with the platform's DecompressionStream('gzip').
 *   DETERMINISM: gzip header bytes 4..9 are overwritten with mtime 0, XFL 2 (max compression), OS 255 (unknown); level 9. The deflate body
 *   is whatever this Node's zlib produces, so bundle BYTES are stable on one toolchain; contentHash and the prefix are stable on any.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const MAGIC = Uint8Array.of(0x89, 0x4f, 0x42, 0x53, 0x42, 0x0d, 0x0a, 0x1a);
export const FORMAT_VERSION = 1;
export const FORMAT_NAME = 'obos-area-bundle';
export const ALIGN = 8;
export const PRELUDE_BYTES = 16;
export const BUNDLE_EXTENSION = '.obosb';

/** The layers an Amsterdam area carries, in the order they are written, with the source-file suffix of each. */
export const AREA_SECTIONS = Object.freeze([
  { name: 'ward', suffix: '.json', mediaType: 'application/json', encoding: 'gzip' },
  { name: 'roads', suffix: '-roads.json', mediaType: 'application/json', encoding: 'gzip' },
  { name: 'water', suffix: '-water.json', mediaType: 'application/json', encoding: 'gzip' },
  { name: 'trees', suffix: '-trees.json', mediaType: 'application/json', encoding: 'gzip' },
  { name: 'terrain', suffix: '-terrain.json', mediaType: 'application/json', encoding: 'gzip' },
  { name: 'surface', suffix: '-surface.png', mediaType: 'image/png', encoding: 'identity' },
]);

const NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;
const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const alignUp = (n) => Math.ceil(n / ALIGN) * ALIGN;

/** gzip with a pinned header: mtime 0, XFL 2, OS 255. */
export function gzipDeterministic(bytes) {
  const out = gzipSync(bytes, { level: 9 });
  out.fill(0, 4, 8);
  out[8] = 2;
  out[9] = 255;
  return out;
}

/** The content hash of a section table (see the header comment). `sections` need name, encoding, mediaType, size, sha256. */
export function contentHashOf(areaId, sections) {
  const lines = [...sections].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((s) => `${s.name}\t${s.encoding}\t${s.mediaType}\t${s.size}\t${s.sha256}\n`);
  return sha256Hex(`${FORMAT_NAME}/${FORMAT_VERSION}\n${areaId}\n${lines.join('')}`);
}

/**
 * The container, from a finished header and the STORED payloads in table order. Low level: it writes the header as given (offsets are
 * filled in here, from the payload lengths), so a test can build a deliberately inconsistent file. Use `encodeBundle` otherwise.
 */
export function assembleBundle(header, payloads) {
  if (payloads.length !== header.sections.length) throw new Error('assembleBundle: one payload per table row');
  let cursor = 0;
  const rows = header.sections.map((s, i) => {
    const row = { ...s, offset: cursor, length: payloads[i].length };
    cursor = alignUp(cursor + payloads[i].length);
    return row;
  });
  const json = Buffer.from(JSON.stringify({ ...header, sections: rows }), 'utf8');
  const dataStart = alignUp(PRELUDE_BYTES + json.length);
  const out = Buffer.alloc(dataStart + cursor);
  out.set(MAGIC, 0);
  out.writeUInt16LE(FORMAT_VERSION, 8);
  out.writeUInt16LE(0, 10);
  out.writeUInt32LE(json.length, 12);
  out.set(json, PRELUDE_BYTES);
  rows.forEach((row, i) => out.set(payloads[i], dataStart + row.offset));
  return out;
}

/**
 * Pack decoded sections into a bundle. `sections`: [{ name, mediaType, encoding: 'gzip'|'identity', data: Uint8Array }] (decoded bytes;
 * gzip is applied here). Returns { bytes, header }.
 */
export function encodeBundle({ areaId, city, sections }) {
  const seen = new Set();
  const table = [];
  const payloads = [];
  for (const s of sections) {
    if (!NAME_RE.test(s.name)) throw new Error(`section name ${JSON.stringify(s.name)} is not [a-z][a-z0-9-]{0,31}`);
    if (seen.has(s.name)) throw new Error(`duplicate section ${s.name}`);
    seen.add(s.name);
    if (s.encoding !== 'gzip' && s.encoding !== 'identity') throw new Error(`section ${s.name}: encoding must be gzip or identity`);
    table.push({ name: s.name, offset: 0, length: 0, encoding: s.encoding, mediaType: s.mediaType, sha256: sha256Hex(s.data), size: s.data.length });
    payloads.push(s.encoding === 'gzip' ? gzipDeterministic(s.data) : Buffer.from(s.data.buffer, s.data.byteOffset, s.data.length));
  }
  const header = { format: FORMAT_NAME, version: FORMAT_VERSION, city, areaId, contentHash: contentHashOf(areaId, table), sections: table };
  const bytes = assembleBundle(header, payloads);
  return { bytes, header: JSON.parse(bytes.subarray(PRELUDE_BYTES, PRELUDE_BYTES + bytes.readUInt32LE(12)).toString('utf8')) };
}

/** The 31 area ids the manifest lists (`ams-x#.json`; `ams-r2-manifest.json` and the layer files do not match). */
export function areaIdsOf(manifest) {
  const ids = Object.keys(manifest.files).map((f) => /^(ams-[a-z]\d)\.json$/.exec(f)?.[1]).filter((id) => id !== undefined);
  return [...new Set(ids)].sort();
}

/**
 * Read one area's six source files, REFUSING any whose sha256 differs from the manifest (or that the manifest does not list).
 * Returns the decoded sections ready for `encodeBundle`.
 */
export function readAreaSources(srcDir, manifest, areaId) {
  return AREA_SECTIONS.map((spec) => {
    const file = `${areaId}${spec.suffix}`;
    const entry = manifest.files[file];
    if (entry === undefined) throw new Error(`${file} is not in the source manifest`);
    const data = readFileSync(join(srcDir, file));
    if (data.length !== entry.size) throw new Error(`${file}: ${data.length} bytes on disk, the manifest says ${entry.size}`);
    const actual = sha256Hex(data);
    if (actual !== entry.sha256) throw new Error(`${file}: sha256 ${actual} disagrees with the manifest's ${entry.sha256}; refusing to bundle it`);
    return { name: spec.name, mediaType: spec.mediaType, encoding: spec.encoding, data, file };
  });
}

/** Build every bundle in memory: { bundles: [{ areaId, file, bytes, header, sourceFiles }], manifest } (the new manifest object). */
export function buildAll(srcDir, sourceManifest) {
  const ids = areaIdsOf(sourceManifest);
  if (ids.length === 0) throw new Error('the source manifest lists no areas');
  const bundles = ids.map((areaId) => {
    const sources = readAreaSources(srcDir, sourceManifest, areaId);
    const { bytes, header } = encodeBundle({ areaId, city: sourceManifest.city, sections: sources });
    return { areaId, file: `${areaId}${BUNDLE_EXTENSION}`, bytes, header, sources };
  });
  // The version: first 16 hex of a sha256 over every area's contentHash (decoded bytes only), like the per-file manifest's, so it does not
  // move with the compressor. Changing one byte of one source moves the whole dataset to a new prefix.
  const version = sha256Hex(`${FORMAT_NAME}/${FORMAT_VERSION}\n${bundles.map((b) => `${b.areaId}\t${b.header.contentHash}\n`).join('')}`).slice(0, 16);
  const files = {};
  let bytes = 0, rawBytes = 0, perFileUploadBytes = 0;
  for (const b of bundles) {
    const raw = b.sources.reduce((n, s) => n + s.data.length, 0);
    const before = b.sources.reduce((n, s) => n + sourceManifest.files[s.file].uploadSize, 0);
    files[b.file] = {
      sha256: sha256Hex(b.bytes), size: b.bytes.length, contentHash: b.header.contentHash, areaId: b.areaId,
      contentType: 'application/octet-stream', contentEncoding: null, rawSize: raw, perFileUploadSize: before,
      sections: b.header.sections.map((s) => ({ name: s.name, encoding: s.encoding, mediaType: s.mediaType, size: s.size, storedSize: s.length, sha256: s.sha256 })),
    };
    bytes += b.bytes.length; rawBytes += raw; perFileUploadBytes += before;
  }
  const manifest = {
    schema: 2, kind: 'area-bundles', formatVersion: FORMAT_VERSION, city: sourceManifest.city, version,
    prefix: `${sourceManifest.city}/${version}`, baseUrl: sourceManifest.baseUrl, cacheControl: sourceManifest.cacheControl,
    sourceVersion: sourceManifest.version,
    totals: { files: bundles.length, bytes, rawBytes, perFileUploadBytes, perFileRequests: bundles.length * AREA_SECTIONS.length },
    files,
  };
  return { bundles, manifest };
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!k?.startsWith('--') || argv[i + 1] === undefined) throw new Error(`usage: build-area-bundles.mjs --src <dir> --out <dir> [--manifest <file>]  (bad argument ${k})`);
    out[k.slice(2)] = argv[i + 1];
  }
  return out;
}

function main() {
  const a = args(process.argv.slice(2));
  if (a.src === undefined || a.out === undefined) throw new Error('usage: build-area-bundles.mjs --src <dir> --out <dir> [--manifest <file>]');
  const src = resolve(a.src);
  const manifestPath = a.manifest === undefined ? join(src, 'ams-r2-manifest.json') : resolve(a.manifest);
  if (!existsSync(manifestPath)) throw new Error(`no source manifest at ${manifestPath}`);
  const sourceManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const { bundles, manifest } = buildAll(src, sourceManifest);
  const extra = readdirSync(src).filter((f) => /^ams-/.test(f) && f !== basename(manifestPath) && sourceManifest.files[f] === undefined);
  if (extra.length > 0) console.warn(`note: ${extra.length} ams-* file(s) in ${src} are not in the manifest and were not bundled: ${extra.slice(0, 5).join(', ')}`);
  const out = resolve(a.out);
  mkdirSync(out, { recursive: true });
  for (const b of bundles) writeFileSync(join(out, b.file), b.bytes);
  writeFileSync(join(out, 'ams-r2-bundles.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const t = manifest.totals;
  console.log(`${t.files} bundles, ${t.bytes} bytes (per-file upload today: ${t.perFileUploadBytes} bytes in ${t.perFileRequests} files); prefix ${manifest.prefix}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exit(1); }
}
