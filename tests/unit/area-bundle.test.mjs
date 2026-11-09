import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import { AMSTERDAM_SHEET_IDS } from '../../src/data/sheets/amsterdam.ts';
import { AREA_SECTION_NAMES, AreaBundleError, FORMAT_VERSION, parseAreaBundle, readBundleContainer } from '../../src/scripts/climate-engine/streaming/area-bundle.ts';
import { ALIGN, AREA_SECTIONS, PRELUDE_BYTES, assembleBundle, buildAll, contentHashOf, encodeBundle } from '../../scripts/build-area-bundles.mjs';

/* THE PER-AREA BUNDLE (BUNDLE-FORMAT.md): one request per streamed Amsterdam area instead of six. The format is a magic, a version, a
   JSON section table and the section bytes; a reader ignores sections it does not know and verifies every one it reads.

   The REAL-DATA tests need the 186 source files (untracked, they live on R2): point OBOS_AREA_BUNDLE_SRC at the directory that holds
   them and ams-r2-manifest.json (default: public/heat-map/data). Without them those tests SKIP, loudly; the synthetic ones always run. */

const SRC = process.env.OBOS_AREA_BUNDLE_SRC ?? new URL('../../public/heat-map/data', import.meta.url).pathname;
const HAVE_REAL = existsSync(join(SRC, 'ams-r2-manifest.json')) && existsSync(join(SRC, 'ams-f4.json'));
const real = HAVE_REAL ? {} : { skip: `no source files in ${SRC} (set OBOS_AREA_BUNDLE_SRC)` };

// ── a small synthetic area ───────────────────────────────────────────────────

const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9);
const json = (o) => Buffer.from(JSON.stringify(o), 'utf8');
const WARD = { center: [4.9, 52.3], sizeM: 2800, count: 2, b: [[10, 0, 0, 5, 0, 5, 5], [20, 9, 9, 8, 9, 8, 8]] };
function sections(extra = [], drop = []) {
  const base = [
    { name: 'ward', mediaType: 'application/json', encoding: 'gzip', data: json(WARD) },
    { name: 'roads', mediaType: 'application/json', encoding: 'gzip', data: json({ ways: [{ w: 3, p: [0, 0, 1, 1] }] }) },
    { name: 'water', mediaType: 'application/json', encoding: 'gzip', data: json({ polys: [{ k: 'canal', p: [0, 0, 1, 1, 2, 0] }] }) },
    { name: 'trees', mediaType: 'application/json', encoding: 'gzip', data: json({ ward: 'ams-x1', grid: 1, trees: [] }) },
    { name: 'terrain', mediaType: 'application/json', encoding: 'gzip', data: json({ n: 2 }) },
    { name: 'surface', mediaType: 'image/png', encoding: 'identity', data: PNG },
  ].filter((s) => !drop.includes(s.name));
  return [...base, ...extra];
}
const make = (extra, drop, areaId = 'ams-x1') => encodeBundle({ areaId, city: 'amsterdam', sections: sections(extra, drop) });
const bytesOf = (b) => new Uint8Array(b.bytes);
/** [start of the data region, end of the last section's real bytes] */
function extent(b) {
  const dataStart = Math.ceil((PRELUDE_BYTES + b.bytes.readUInt32LE(12)) / ALIGN) * ALIGN;
  return { dataStart, realEnd: Math.max(...b.header.sections.map((s) => dataStart + s.offset + s.length)) };
}
const rejects = (promise, code, section) => assert.rejects(promise, (e) => {
  assert.ok(e instanceof AreaBundleError, `expected an AreaBundleError, got ${e}`);
  assert.equal(e.code, code, e.message);
  if (section !== undefined) assert.equal(e.section, section);
  return true;
});

test('round trip: every section comes back as the loader parses it today', async () => {
  const b = make();
  const a = await parseAreaBundle(bytesOf(b).buffer.slice(b.bytes.byteOffset, b.bytes.byteOffset + b.bytes.length));
  assert.equal(a.areaId, 'ams-x1');
  assert.equal(a.formatVersion, FORMAT_VERSION);
  assert.equal(a.contentHash, b.header.contentHash);
  assert.equal(a.ward, JSON.stringify(WARD), 'the ward is TEXT, for the worker');
  assert.equal(a.roads, JSON.stringify({ ways: [{ w: 3, p: [0, 0, 1, 1] }] }));
  assert.deepEqual(a.water, { polys: [{ k: 'canal', p: [0, 0, 1, 1, 2, 0] }] });
  assert.deepEqual(a.trees, { ward: 'ams-x1', grid: 1, trees: [] });
  assert.deepEqual(a.terrain, { n: 2 });
  assert.equal(a.surface.type, 'image/png');
  assert.deepEqual(new Uint8Array(await a.surface.arrayBuffer()), PNG);
  assert.deepEqual(a.unknownSections, []);
});

test('layout: magic, little-endian prelude, 8-byte aligned sections, deterministic gzip header', () => {
  const b = make();
  assert.deepEqual([...b.bytes.subarray(0, 8)], [0x89, 0x4f, 0x42, 0x53, 0x42, 0x0d, 0x0a, 0x1a]);
  assert.equal(b.bytes.readUInt16LE(8), 1);
  assert.equal(b.bytes.readUInt16LE(10), 0);
  const { dataStart } = extent(b);
  assert.equal(dataStart % ALIGN, 0);
  for (const s of b.header.sections) {
    assert.equal(s.offset % ALIGN, 0, `${s.name} starts on an 8-byte boundary`);
    if (s.encoding === 'gzip') {
      const g = b.bytes.subarray(dataStart + s.offset, dataStart + s.offset + 10);
      assert.deepEqual([...g], [0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 255], `${s.name}: mtime 0, XFL 2, OS 255`);
    }
  }
  assert.equal(b.bytes.length % ALIGN, 0);
});

test('determinism: the same inputs give byte-identical bundles', () => {
  assert.ok(make().bytes.equals(make().bytes));
  assert.equal(make().header.contentHash, make().header.contentHash);
  assert.notEqual(make().header.contentHash, make(undefined, undefined, 'ams-x2').header.contentHash, 'the area id is in the content hash');
});

test('an unknown section is ignored, whatever its encoding; unknown header fields are ignored too', async () => {
  const extra = [
    { name: 'sun-shadow', mediaType: 'application/x-uint8', encoding: 'identity', data: Uint8Array.of(1, 2, 3, 4, 5) },
    { name: 'wind-field', mediaType: 'application/x-float32-le', encoding: 'gzip', data: new Uint8Array(64) },
  ];
  const b = make(extra);
  const a = await parseAreaBundle(bytesOf(b));
  assert.deepEqual(a.unknownSections, ['sun-shadow', 'wind-field']);
  assert.equal(a.ward, JSON.stringify(WARD));
  const c = await readBundleContainer(bytesOf(b), ['ward']);
  assert.deepEqual([...c.sections.keys()], ['ward']);
  assert.deepEqual([...c.ignored].sort(), ['roads', 'sun-shadow', 'surface', 'terrain', 'trees', 'water', 'wind-field']);

  // a section from a FUTURE encoding, plus a header field this reader never heard of: still readable
  const header = { ...b.header, futureField: { anything: 1 }, sections: b.header.sections.map((s) => ({ ...s, note: 'x' })) };
  header.sections.push({ name: 'later', offset: 0, length: 4, encoding: 'zstd', mediaType: 'application/x-later', sha256: 'a'.repeat(64), size: 9 });
  header.contentHash = contentHashOf(header.areaId, header.sections);
  const stored = [...b.header.sections.map((s) => b.bytes.subarray(extent(b).dataStart + s.offset, extent(b).dataStart + s.offset + s.length)), Buffer.from('zstd')];
  const future = await parseAreaBundle(assembleBundle(header, stored));
  assert.deepEqual(future.unknownSections.includes('later'), true);
  assert.equal(future.ward, JSON.stringify(WARD));
});

test('a KNOWN section in an encoding this reader cannot decode is a typed error', async () => {
  const b = make();
  const header = { ...b.header, sections: b.header.sections.map((s) => (s.name === 'trees' ? { ...s, encoding: 'zstd' } : s)) };
  header.contentHash = contentHashOf(header.areaId, header.sections);
  const { dataStart } = extent(b);
  const stored = b.header.sections.map((s) => b.bytes.subarray(dataStart + s.offset, dataStart + s.offset + s.length));
  await rejects(parseAreaBundle(assembleBundle(header, stored)), 'unsupported-encoding', 'trees');
});

test('a missing REQUIRED section is a typed error; a missing optional one is null', async () => {
  await rejects(parseAreaBundle(bytesOf(make(undefined, ['surface']))), 'missing-section', 'surface');
  await rejects(parseAreaBundle(bytesOf(make(undefined, ['ward']))), 'missing-section', 'ward');
  await rejects(parseAreaBundle(bytesOf(make(undefined, ['water'])), { required: ['water'] }), 'missing-section', 'water');
  const a = await parseAreaBundle(bytesOf(make(undefined, ['roads', 'water', 'trees', 'terrain'])));
  assert.equal(a.roads, null);
  assert.equal(a.water, null);
  assert.equal(a.trees, null);
  assert.equal(a.terrain, null);
  await rejects(readBundleContainer(bytesOf(make(undefined, ['trees'])), ['trees'], { required: ['trees'] }), 'missing-section', 'trees');
});

test('a corrupted byte fails: the sha check on an identity section, gzip or sha on a compressed one', async () => {
  const b = make();
  const { dataStart } = extent(b);
  const png = b.header.sections.find((s) => s.name === 'surface');
  const flipped = bytesOf(b).slice();
  flipped[dataStart + png.offset + 12] ^= 0x01;
  await rejects(parseAreaBundle(flipped), 'sha-mismatch', 'surface');
  const json_of = Object.fromEntries(sections().map((x) => [x.name, x.data]));
  for (const name of ['ward', 'roads', 'water', 'trees', 'terrain']) {
    const s = b.header.sections.find((x) => x.name === name);
    for (let at = 0; at < s.length; at++) {                       // every byte of the stored section, one at a time
      if (at >= 4 && at < 10) continue;                           // gzip's mtime / XFL / OS: decoders ignore them, the DECODED bytes are what the sha covers
      const copy = bytesOf(b).slice();
      copy[dataStart + s.offset + at] ^= 0x40;
      /* Either the fault is caught (typed, naming the section) or the flip was one deflate ignores (an unused code length) and the decoded
         bytes are STILL exactly the original: the sha check is on the decoded bytes, so nothing wrong can get through. */
      try {
        const got = await readBundleContainer(copy, [name]);
        assert.ok(Buffer.from(got.sections.get(name)).equals(Buffer.from(json_of[name])), `${name} byte ${at}: accepted with DIFFERENT content`);
      } catch (e) {
        assert.ok(e instanceof AreaBundleError && e.section === name && ['decode-failed', 'sha-mismatch', 'size-mismatch'].includes(e.code), `${name} byte ${at}: ${e}`);
      }
    }
  }
});

test('a section whose sha256 or size disagrees with its bytes (header consistent with itself) is sha-mismatch / size-mismatch', async () => {
  const b = make();
  const { dataStart } = extent(b);
  const stored = b.header.sections.map((s) => b.bytes.subarray(dataStart + s.offset, dataStart + s.offset + s.length));
  const lie = (patch) => {
    const header = { ...b.header, sections: b.header.sections.map((s) => (s.name === 'roads' ? { ...s, ...patch } : s)) };
    header.contentHash = contentHashOf(header.areaId, header.sections);
    return assembleBundle(header, stored);
  };
  await rejects(parseAreaBundle(lie({ sha256: 'f'.repeat(64) })), 'sha-mismatch', 'roads');
  await rejects(parseAreaBundle(lie({ size: 3 })), 'size-mismatch', 'roads');
  await rejects(parseAreaBundle(lie({ size: 100000 })), 'size-mismatch', 'roads');
});

test('a header whose table was edited fails the content hash', async () => {
  const b = make();
  const header = { ...b.header, sections: b.header.sections.map((s) => (s.name === 'roads' ? { ...s, mediaType: 'text/plain' } : s)) };
  const { dataStart } = extent(b);
  const stored = b.header.sections.map((s) => b.bytes.subarray(dataStart + s.offset, dataStart + s.offset + s.length));
  await rejects(parseAreaBundle(assembleBundle(header, stored)), 'content-hash-mismatch');
});

test('a gzip bomb (a stream that inflates past the size the header declares) is refused, not buffered', async () => {
  const bomb = gzipSync(Buffer.alloc(8 << 20), { level: 9 });
  const b = make();
  const { dataStart } = extent(b);
  const stored = b.header.sections.map((s) => (s.name === 'roads' ? bomb : b.bytes.subarray(dataStart + s.offset, dataStart + s.offset + s.length)));
  const header = { ...b.header, sections: b.header.sections.map((s) => (s.name === 'roads' ? { ...s, size: 100 } : s)) };
  header.contentHash = contentHashOf(header.areaId, header.sections);
  await rejects(parseAreaBundle(assembleBundle(header, stored)), 'size-mismatch', 'roads');
});

test('a truncated file: every cut before the last section ends is `truncated`, every cut after parses', async () => {
  const b = make([{ name: 'sun-shadow', mediaType: 'application/x-uint8', encoding: 'identity', data: Uint8Array.of(9, 9, 9, 9, 9, 9, 9) }]);
  const { realEnd } = extent(b);
  const all = bytesOf(b);
  for (let len = 0; len < realEnd; len++) {
    await assert.rejects(parseAreaBundle(all.subarray(0, len)), (e) => e instanceof AreaBundleError && e.code === 'truncated', `length ${len} of ${realEnd}`);
  }
  for (let len = realEnd; len <= all.length; len++) await parseAreaBundle(all.subarray(0, len));       // only the zero padding is cut
  const empty = await parseAreaBundle(all).then(() => 'ok');
  assert.equal(empty, 'ok');
});

test('a wrong magic or a wrong version', async () => {
  const b = make();
  const m = bytesOf(b).slice();
  m[0] = 0x00;
  await rejects(parseAreaBundle(m), 'bad-magic');
  await rejects(parseAreaBundle(new TextEncoder().encode('{"ward":"ams-f4","count":1}')), 'bad-magic');       // a plain ward file where a bundle was expected
  await rejects(parseAreaBundle(new Uint8Array(0)), 'truncated');
  for (const version of [0, 2, 65535]) {
    const v = bytesOf(b).slice();
    new DataView(v.buffer).setUint16(8, version, true);
    await rejects(parseAreaBundle(v), 'unsupported-version');
  }
  const flags = bytesOf(b).slice();
  new DataView(flags.buffer).setUint16(10, 0xffff, true);
  await parseAreaBundle(flags);                                                                                  // flags are reserved and ignored
});

test('a corrupt header: length past the file, past the sanity limit, not JSON, wrong format', async () => {
  const b = make();
  const huge = bytesOf(b).slice();
  new DataView(huge.buffer).setUint32(12, 0x7fffffff, true);
  await rejects(parseAreaBundle(huge), 'bad-header');
  const past = bytesOf(b).slice();
  new DataView(past.buffer).setUint32(12, b.bytes.length, true);
  await rejects(parseAreaBundle(past), 'truncated');
  const junk = bytesOf(b).slice();
  junk[PRELUDE_BYTES] = 0x7b ^ 0x01;
  await rejects(parseAreaBundle(junk), 'bad-header');
  const wrong = { ...b.header, format: 'something-else' };
  await rejects(parseAreaBundle(assembleBundle(wrong, b.header.sections.map(() => Buffer.alloc(0)))), 'bad-header');
});

test('expectAreaId catches a bundle served under the wrong name', async () => {
  const b = make(undefined, undefined, 'ams-x1');
  await parseAreaBundle(bytesOf(b), { expectAreaId: 'ams-x1' });
  await rejects(parseAreaBundle(bytesOf(b), { expectAreaId: 'ams-x2' }), 'area-mismatch');
});

test('the input may be an ArrayBuffer or a view into a larger buffer', async () => {
  const b = make();
  const big = new Uint8Array(b.bytes.length + 40);
  big.set(b.bytes, 24);
  const view = big.subarray(24, 24 + b.bytes.length);
  assert.equal((await parseAreaBundle(view)).ward, JSON.stringify(WARD));
  assert.equal((await parseAreaBundle(view.slice().buffer)).ward, JSON.stringify(WARD));
});

test('the writer refuses bad section names and duplicates', () => {
  assert.throws(() => encodeBundle({ areaId: 'a', city: 'c', sections: [{ name: 'Ward', mediaType: 'x', encoding: 'identity', data: new Uint8Array(1) }] }), /section name/);
  assert.throws(() => encodeBundle({ areaId: 'a', city: 'c', sections: [{ name: 'w', mediaType: 'x', encoding: 'identity', data: new Uint8Array(1) }, { name: 'w', mediaType: 'x', encoding: 'identity', data: new Uint8Array(1) }] }), /duplicate/);
  assert.throws(() => encodeBundle({ areaId: 'a', city: 'c', sections: [{ name: 'w', mediaType: 'x', encoding: 'br', data: new Uint8Array(1) }] }), /encoding/);
});

test('the reader names exactly the sections the writer writes', () => {
  assert.deepEqual([...AREA_SECTION_NAMES], AREA_SECTIONS.map((s) => s.name));
});

// ── the real 31 areas ────────────────────────────────────────────────────────

const manifest = HAVE_REAL ? JSON.parse(readFileSync(join(SRC, 'ams-r2-manifest.json'), 'utf8')) : null;

test('the 31 streamed areas are AMSTERDAM_SHEET_IDS minus canal-ring', real, () => {
  const { bundles } = buildAll(SRC, manifest);
  assert.deepEqual(bundles.map((b) => b.areaId), AMSTERDAM_SHEET_IDS.filter((id) => id !== 'canal-ring').sort());
  assert.equal(bundles.length, 31);
});

test('round trip all 31 real bundles: every section byte-identical to its source file', real, async () => {
  const { bundles } = buildAll(SRC, manifest);
  for (const b of bundles) {
    const open = await readBundleContainer(b.bytes, AREA_SECTION_NAMES, { expectAreaId: b.areaId, required: AREA_SECTION_NAMES });
    assert.equal(open.header.areaId, b.areaId);
    assert.equal(open.ignored.length, 0);
    for (const spec of AREA_SECTIONS) {
      const source = readFileSync(join(SRC, `${b.areaId}${spec.suffix}`));
      assert.ok(Buffer.from(open.sections.get(spec.name)).equals(source), `${b.areaId} ${spec.name} differs from ${b.areaId}${spec.suffix}`);
    }
    // and the typed projection hands back what the loader used to read: text for ward and roads, parsed JSON for the rest, a PNG Blob
    const a = await parseAreaBundle(b.bytes, { expectAreaId: b.areaId });
    assert.ok(Buffer.from(a.ward, 'utf8').equals(readFileSync(join(SRC, `${b.areaId}.json`))));
    assert.ok(Buffer.from(a.roads, 'utf8').equals(readFileSync(join(SRC, `${b.areaId}-roads.json`))));
    assert.deepEqual(a.water, JSON.parse(readFileSync(join(SRC, `${b.areaId}-water.json`), 'utf8')));
    assert.deepEqual(a.trees, JSON.parse(readFileSync(join(SRC, `${b.areaId}-trees.json`), 'utf8')));
    assert.deepEqual(a.terrain, JSON.parse(readFileSync(join(SRC, `${b.areaId}-terrain.json`), 'utf8')));
    assert.ok(Buffer.from(await a.surface.arrayBuffer()).equals(readFileSync(join(SRC, `${b.areaId}-surface.png`))));
    assert.equal(a.surface.type, 'image/png');
    assert.deepEqual(a.unknownSections, []);
  }
});

test('real bundles: a corrupted byte in the PNG, and a cut file, fail', real, async () => {
  const { bundles } = buildAll(SRC, manifest);
  const b = bundles[0];
  const { dataStart } = extent({ bytes: b.bytes, header: b.header });
  const png = b.header.sections.find((s) => s.name === 'surface');
  const copy = new Uint8Array(b.bytes);
  copy[dataStart + png.offset + (png.length >> 1)] ^= 0x10;
  await rejects(parseAreaBundle(copy), 'sha-mismatch', 'surface');
  await rejects(parseAreaBundle(new Uint8Array(b.bytes).subarray(0, b.bytes.length >> 1)), 'truncated');
});

test('determinism on the real data: build twice, byte-identical bundles and manifest', real, () => {
  const one = buildAll(SRC, manifest);
  const two = buildAll(SRC, manifest);
  assert.equal(JSON.stringify(one.manifest), JSON.stringify(two.manifest));
  for (let i = 0; i < one.bundles.length; i++) assert.ok(one.bundles[i].bytes.equals(two.bundles[i].bytes), one.bundles[i].areaId);
  assert.match(one.manifest.version, /^[0-9a-f]{16}$/);
  assert.equal(one.manifest.prefix, `amsterdam/${one.manifest.version}`);
});

test('the builder refuses a source whose sha256 disagrees with the manifest', real, () => {
  const lying = structuredClone(manifest);
  lying.files['ams-f4-trees.json'].sha256 = '0'.repeat(64);
  assert.throws(() => buildAll(SRC, lying), /ams-f4-trees\.json.*disagrees with the manifest/);
  const short = structuredClone(manifest);
  short.files['ams-f4.json'].size += 1;
  assert.throws(() => buildAll(SRC, short), /ams-f4\.json.*bytes on disk/);
  const missing = structuredClone(manifest);
  delete missing.files['ams-g4-roads.json'];
  assert.throws(() => buildAll(SRC, missing), /ams-g4-roads\.json is not in the source manifest/);
});

test('size table: a bundle is about the six uploaded files it replaces, and 31 requests replace 186', real, (t) => {
  const { bundles, manifest: m } = buildAll(SRC, manifest);
  const rows = [['area', 'before B (6 files)', 'after B (1 bundle)', 'delta B', 'delta %']];
  for (const b of bundles) {
    const before = b.sources.reduce((n, s) => n + manifest.files[s.file].uploadSize, 0);
    const delta = b.bytes.length - before;
    rows.push([b.areaId, before, b.bytes.length, delta, `${(100 * delta / before).toFixed(2)}`]);
    assert.ok(delta < 4096, `${b.areaId}: a bundle costs a header and padding, not more (${delta} B)`);
  }
  const before = m.totals.perFileUploadBytes, after = m.totals.bytes;
  rows.push(['TOTAL', before, after, after - before, `${(100 * (after - before) / before).toFixed(2)}`]);
  t.diagnostic(`\n${rows.map((r) => r.join('\t')).join('\n')}\nrequests per full load: ${m.totals.perFileRequests} -> ${m.totals.files}`);
  assert.equal(before, manifest.totals.uploadBytes, 'the "before" total is the current manifest\'s own');
  assert.ok(after <= before * 1.01, `total grew ${(100 * (after - before) / before).toFixed(2)}%`);
  assert.equal(m.totals.perFileRequests / m.totals.files, 6);
});

// ── the dormancy rule ────────────────────────────────────────────────────────

test('area-bundle.ts is DOM-free and takes only a type import (streaming-dormant.test.mjs holds the directory to this too)', () => {
  const text = readFileSync(new URL('../../src/scripts/climate-engine/streaming/area-bundle.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/\b(window|document|navigator|requestAnimationFrame|fetch)\b/.test(text));
  const imports = text.split('\n').filter((l) => /^\s*import\b/.test(l));
  assert.ok(imports.every((l) => /^import type\b/.test(l)), imports.join('\n'));
});
