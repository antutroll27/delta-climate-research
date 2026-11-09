import assert from 'node:assert/strict';
import test from 'node:test';

import { createCityStream } from '../../src/scripts/climate-engine/streaming-host/city-stream.ts';
import { asBundleManifest, asR2Manifest, bundleTarget, configureStreamData, ensureStreamData, readStreamManifest } from '../../src/scripts/climate-engine/streaming/data-source.ts';
import { encodeBundle } from '../../scripts/build-area-bundles.mjs';

/* THE LOADER READS ONE BUNDLE PER AREA (streaming-host/city-stream.ts `getBundle`, BUNDLE-FORMAT.md), through the real manager, executor and controller; only the network,
   the worker and the page are faked. Fetches are COUNTED: an area is one request, and the six per-file URLs are a fallback that is taken in exactly the cases the brief lists
   (no usable bundle manifest, the area absent from it, an unsupported format version, no crypto.subtle), never silently. A bundle that arrives corrupt or cut short is fetched
   ONCE more past the HTTP cache, then the area's failed state with Retry. B1 (a halo or neighbour failure never raises the plate over a drawn area) still holds. */

const N = 384 * 384;
const layers = () => ({ albedo: new Float32Array(N), veg: new Float32Array(N), built: new Float32Array(N), water: new Float32Array(N) });
const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(cond, label, ms = 8000) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`); await wait(5); }
}

const BASE = 'https://r2.example';
const FILE_PREFIX = 'amsterdam/vFiles';
const BUNDLE_PREFIX = 'amsterdam/vBundles';
const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4);
const json = (o) => Buffer.from(JSON.stringify(o), 'utf8');
const WARD = { b: [[10, 0, 0, 5, 0, 5, 5, 0, 5]], count: 1, sizeM: 2800 };
const bundleCache = new Map();
/** A real, valid bundle for `ams-xx` (built with the real writer). */
function bundleFor(areaId) {
  let b = bundleCache.get(areaId);
  if (b === undefined) {
    b = encodeBundle({
      areaId, city: 'amsterdam', sections: [
        { name: 'ward', mediaType: 'application/json', encoding: 'gzip', data: json(WARD) },
        { name: 'roads', mediaType: 'application/json', encoding: 'gzip', data: json({ ways: [] }) },
        { name: 'water', mediaType: 'application/json', encoding: 'gzip', data: json({ polys: [{ k: 'canal', p: [0, 0, 1, 1, 2, 0] }] }) },
        { name: 'trees', mediaType: 'application/json', encoding: 'gzip', data: json({ ward: areaId, grid: 1, trees: [] }) },
        { name: 'terrain', mediaType: 'application/json', encoding: 'gzip', data: json({}) },
        { name: 'surface', mediaType: 'image/png', encoding: 'identity', data: PNG },
      ],
    });
    bundleCache.set(areaId, b);
  }
  return b;
}
const ids = ['ams-e5', 'ams-f3', 'ams-f4', 'ams-f5', 'ams-g4', 'ams-g5', 'ams-e3', 'ams-e2', 'ams-f2', 'ams-g3', 'ams-g6', 'ams-d4', 'ams-d3', 'ams-d5', 'ams-c4', 'ams-h4', 'ams-h5', 'ams-h3'];
const perFileManifest = (list = ids) => asR2Manifest({
  schema: 1, city: 'amsterdam', version: 'vFiles', prefix: FILE_PREFIX, baseUrl: BASE,
  files: Object.fromEntries(list.flatMap((id) => [`${id}.json`, `${id}-roads.json`, `${id}-water.json`, `${id}-trees.json`, `${id}-terrain.json`, `${id}-surface.png`].map((f) => [f, {}]))),
});
const bundleManifest = (list = ids, pins = {}) => asBundleManifest({
  schema: 2, kind: 'area-bundles', formatVersion: 1, city: 'amsterdam', version: 'vBundles', prefix: BUNDLE_PREFIX, baseUrl: BASE,
  files: Object.fromEntries(list.map((id) => [`${id}.obosb`, { sha256: 'x', size: 1, contentHash: pins[id] ?? bundleFor(id).header.contentHash }])),
});
const configure = (opts = {}) => configureStreamData(
  { kind: 'manifest', manifest: perFileManifest(opts.files) },
  opts.noBundles ? { kind: 'none', reason: 'HTTP 404' } : { kind: 'manifest', manifest: bundleManifest(opts.bundles, opts.pins) },
);

/** `serve(url, init, n)` may return a Response, a Uint8Array for a bundle body, or undefined for the default. n = how many times this URL was asked before (0-based). */
function rig({ serve = () => undefined, hold = 5 } = {}) {
  const log = { fetches: [], show: [], failures: [], warn: [], stages: [], installed: [], rebuild: 0 };
  const counts = new Map();
  const realFetch = globalThis.fetch;
  const realBitmap = globalThis.createImageBitmap, realCanvas = globalThis.OffscreenCanvas;
  globalThis.createImageBitmap = async (blob) => { log.surfaceBlobs = [...(log.surfaceBlobs ?? []), { size: blob.size, type: blob.type }]; return { width: 2, height: 2, close() {} }; };
  globalThis.OffscreenCanvas = class { getContext() { return null; } };       // decodeSurfaceBlob then returns null: the area is flat at the default means
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const n = counts.get(u) ?? 0;
    counts.set(u, n + 1);
    log.fetches.push({ url: u, cache: init.cache, n });
    const served = await serve(u, init, n);
    if (served instanceof Response) return served;
    if (served instanceof Uint8Array) return new Response(served, { status: 200 });
    if (u.endsWith('.obosb')) return new Response(bundleFor(/(ams-[a-z0-9]+)\.obosb$/.exec(u)[1]).bytes, { status: 200 });
    const body = u.endsWith('-roads.json') ? { ways: [] } : u.endsWith('-water.json') ? { polys: [] } : /-(terrain|trees)\.json$/.test(u) ? {} : u.endsWith('.png') ? null : WARD;
    return new Response(body === null ? PNG : JSON.stringify(body), { status: 200 });
  };
  const worker = {
    async prepare() { return { base: layers(), spatial: {}, buildings: 1, ms: 0 }; },
    async mesh() { return { mesh: { kind: 'packed', vertexCount: 0 }, ao: null, ms: 0 }; },
    async massing() { return { mesh: { kind: 'massing', position: new Float32Array(0), normal: new Int8Array(0), index: new Uint32Array(0), vertexCount: 0, buildings: 0 }, ms: 0 }; },
    forget() {}, dispose() {},
  };
  const hooks = {
    tier: () => 'full', network: () => 'fast', relief: () => ({ setNeighbours() {}, setSeamFade() {} }),
    registeredSurface: (code) => (code === 'E4' ? Promise.resolve({ means: { fvc: 0.2, albedo: 0.2 }, surface: null }) : null),
    installBundle(code, b) { log.installed.push({ code, b }); }, dropBundle() {},
    async showSheet(code, prepared, ao, first, afterCommit, fly = false, rebuild = false) { log.show.push({ code, rebuild }); afterCommit(); await wait(hold); },
    setHaloSupply() {}, resolve() {}, loader() {}, failure: (sheet, why) => log.failures.push(`${sheet}: ${why}`), warn: (m) => log.warn.push(String(m)),
    command() {}, stage: (code, s) => log.stages.push(`${code}:${s}`), facts() {}, dispatched() {},
  };
  const stream = createCityStream(hooks, worker);
  const urlsOf = (re) => log.fetches.filter((f) => re.test(f.url));
  return {
    stream, log, counts, urlsOf,
    stop: () => {
      stream.dispose(); globalThis.fetch = realFetch;
      if (realBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = realBitmap;
      if (realCanvas === undefined) delete globalThis.OffscreenCanvas; else globalThis.OffscreenCanvas = realCanvas;
      configureStreamData({ kind: 'local' });
    },
  };
}
const AMS_PER_FILE = /\/ams-[a-z0-9]+(-(roads|water|trees|terrain|surface))?\.(json|png)$/;
const BUNDLE = /\.obosb$/;

async function openF4(r) {
  r.stream.start('E4');
  await until(() => r.stream.report().displayed === 'E4', 'E4 displayed');
  r.stream.select('F4');
  await until(() => r.stream.report().displayed === 'F4', 'F4 displayed');
}

// ── the bundle path is the default, and an area is ONE request ───────────────────────────────

test('bundle path: an area opens from ONE bundle fetch, with its stages, its layers installed, and no per-file URL touched', async () => {
  configure();
  const r = rig();
  try {
    await openF4(r);
    await wait(300);                                                     // the halo and the neighbours settle
    assert.deepEqual(r.urlsOf(AMS_PER_FILE), [], 'no per-file Amsterdam URL was fetched');
    const f4 = r.urlsOf(/ams-f4\.obosb$/);
    assert.equal(f4.length, 1, 'F4 is exactly one request');
    assert.equal(f4[0].url, `${BASE}/${BUNDLE_PREFIX}/ams-f4.obosb`);
    assert.equal(f4[0].cache, undefined, 'a first fetch uses the HTTP cache (the bundle is immutable)');
    const installed = r.log.installed.find((i) => i.code === 'F4');
    assert.ok(installed, 'F4 was installed');
    assert.equal(installed.b.ward.count, 1);
    assert.deepEqual(installed.b.water, { polys: [{ k: 'canal', p: [0, 0, 1, 1, 2, 0] }] }, 'water comes out of the bundle');
    assert.equal(installed.b.roads.ways.length, 0);
    assert.equal(installed.b.terrain, null, 'an empty terrain object is no terrain (asTerrainField refuses it), as it was per-file');
    assert.ok(installed.b.trees !== undefined);
    for (const s of ['ward', 'surface', 'vector']) assert.ok(r.log.stages.includes(`F4:${s}`), `the ${s} stage fired`);
    assert.ok(r.log.surfaceBlobs.some((b) => b.type === 'image/png' && b.size === PNG.length), 'the surface was decoded from the bundle\'s own PNG');
    assert.deepEqual(r.log.failures, []);
  } finally { r.stop(); }
});

test('one request per area: every bundle URL (the opened area, its halo, its neighbours) is fetched exactly once; Canal Ring stays same-origin', async () => {
  configure();
  const r = rig();
  try {
    await openF4(r);
    await wait(500);
    const bundles = r.urlsOf(BUNDLE);
    assert.ok(bundles.length >= 2, `the halo/neighbours also come as bundles (${bundles.length})`);
    for (const [url, n] of r.counts) if (BUNDLE.test(url)) assert.equal(n, 1, `${url} asked ${n} times`);
    assert.equal(r.urlsOf(/^https:\/\/r2\.example\/.*canal-ring/).length, 0, 'Canal Ring never goes to the Worker');
  } finally { r.stop(); }
});

// ── the fallback matrix ──────────────────────────────────────────────────────────────────────

test('fallback 1: no usable bundle manifest (missing, malformed, wrong kind) - the six per-file URLs, no bundle fetch', async () => {
  const fetcherFor = (bundleReply) => async (url) => (String(url).endsWith('ams-r2-bundles.json') ? bundleReply() : new Response(JSON.stringify({ schema: 1, city: 'amsterdam', version: 'vFiles', prefix: FILE_PREFIX, baseUrl: BASE, files: perFileManifest().files }), { status: 200 }));
  for (const [label, reply] of [
    ['404', () => new Response('no', { status: 404 })],
    ['not JSON', () => new Response('<html>', { status: 200 })],
    ['schema 1 file', () => new Response(JSON.stringify({ schema: 1, prefix: 'x', baseUrl: BASE, files: {} }), { status: 200 })],
    ['no prefix', () => new Response(JSON.stringify({ schema: 2, kind: 'area-bundles', baseUrl: BASE, files: {} }), { status: 200 })],
  ]) {
    configureStreamData({ kind: 'local' });
    await readStreamManifest(fetcherFor(reply));
    assert.equal(bundleTarget('ams-f4'), null, `${label}: no bundle target`);
    const r = rig();
    try {
      await openF4(r);
      assert.deepEqual(r.urlsOf(BUNDLE), [], `${label}: no bundle fetched`);
      assert.equal(r.urlsOf(/\/ams-f4(-[a-z]+)?\.(json|png)$/).length, 6, `${label}: F4 is its six files`);
    } finally { r.stop(); }
  }
});

test('fallback 2: an area absent from the bundle manifest reads its six files; the areas it lists still come as bundles', async () => {
  configure({ bundles: ids.filter((id) => id !== 'ams-f4') });
  const r = rig();
  try {
    await openF4(r);
    await wait(300);
    assert.deepEqual(r.urlsOf(/ams-f4\.obosb/), [], 'F4 has no bundle to ask for');
    assert.equal(r.urlsOf(/\/ams-f4(-[a-z]+)?\.(json|png)$/).length, 6);
    assert.ok(r.urlsOf(BUNDLE).length > 0, 'its neighbours are still bundles');
    assert.deepEqual(r.log.failures, []);
  } finally { r.stop(); }
});

test('fallback 3: a bundle in an unsupported format VERSION falls back to the six files, says so once, and later areas do not download another bundle', async () => {
  const future = (areaId) => { const b = Buffer.from(bundleFor(areaId).bytes); b.writeUInt16LE(2, 8); return new Uint8Array(b); };
  configure();
  const r = rig({ serve: (u) => (BUNDLE.test(u) ? future(/(ams-[a-z0-9]+)\.obosb$/.exec(u)[1]) : undefined) });
  try {
    await openF4(r);
    await wait(300);
    assert.equal(r.urlsOf(/ams-f4\.obosb$/).length, 1, 'tried the bundle once');
    assert.equal(r.urlsOf(/\/ams-f4(-[a-z]+)?\.(json|png)$/).length, 6, 'then F4\'s six files');
    assert.ok(r.log.warn.some((w) => /unsupported-version/.test(w)), 'and warned');
    assert.deepEqual(r.log.failures, [], 'it is a fallback, not a failure');
    const before = r.urlsOf(BUNDLE).length;
    r.stream.select('G5');
    await until(() => r.stream.report().displayed === 'G5', 'G5 displayed');
    assert.equal(r.urlsOf(BUNDLE).length, before, 'no further bundle download after the format was refused');
  } finally { r.stop(); }
});

test('fallback 4: no crypto.subtle (a plain-http LAN page) - the bundle is never even downloaded; the six files are read', async () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
  configure();
  const r = rig();
  try {
    await openF4(r);
    assert.deepEqual(r.urlsOf(BUNDLE), []);
    assert.equal(r.urlsOf(/\/ams-f4(-[a-z]+)?\.(json|png)$/).length, 6);
    assert.deepEqual(r.log.failures, []);
  } finally {
    r.stop();
    if (real) Object.defineProperty(globalThis, 'crypto', real); else delete globalThis.crypto;
  }
});

test('fallback 4b: a parser that reports unsupported-runtime (crypto vanishes after the fetch) is the same fallback', async () => {
  configure();
  const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const r = rig({ serve: (u) => { if (BUNDLE.test(u)) Object.defineProperty(globalThis, 'crypto', { value: { subtle: undefined }, configurable: true }); return undefined; } });
  try {
    r.stream.start('E4');
    await until(() => r.stream.report().displayed === 'E4', 'E4 displayed');
    r.stream.select('F4');
    await until(() => r.stream.report().displayed === 'F4', 'F4 displayed');
    assert.equal(r.urlsOf(/\/ams-f4(-[a-z]+)?\.(json|png)$/).length, 6);
    assert.deepEqual(r.log.failures, []);
  } finally {
    if (real) Object.defineProperty(globalThis, 'crypto', real);
    r.stop();
  }
});

// ── the single retry ─────────────────────────────────────────────────────────────────────────

/** Flip one byte INSIDE the identity-encoded surface section: only its sha256 can catch that, so the reader reports `sha-mismatch`. */
const corrupt = (areaId) => {
  const b = Buffer.from(bundleFor(areaId).bytes);
  const dataStart = Math.ceil((16 + b.readUInt32LE(12)) / 8) * 8;
  const surface = bundleFor(areaId).header.sections.find((x) => x.name === 'surface');
  b[dataStart + surface.offset + 9] ^= 0xff;
  return new Uint8Array(b);
};
const cut = (areaId) => new Uint8Array(bundleFor(areaId).bytes).subarray(0, bundleFor(areaId).bytes.length - 40);

for (const [label, bad] of [['sha-mismatch', corrupt], ['truncated', cut]]) {
  test(`retry: a ${label} bundle is fetched ONE more time with cache: 'reload', and the area opens from the second copy`, async () => {
    configure();
    const r = rig({ serve: (u, init, n) => (/ams-f4\.obosb$/.test(u) && n === 0 ? bad('ams-f4') : undefined) });
    try {
      await openF4(r);
      const f4 = r.urlsOf(/ams-f4\.obosb$/);
      assert.deepEqual(f4.map((f) => f.cache), [undefined, 'reload'], 'first the cache, then past it');
      assert.deepEqual(r.log.failures, []);
      assert.deepEqual(r.urlsOf(/\/ams-f4(-[a-z]+)?\.(json|png)$/), [], 'and no per-file fallback: a corrupt copy is not an unsupported one');
    } finally { r.stop(); }
  });
}

test('retry: a bundle that is bad TWICE is the failed state (with Retry) - two fetches per attempt, never three - and Retry recovers', async () => {
  configure();
  let broken = true;
  const r = rig({ serve: (u) => (/ams-f4\.obosb$/.test(u) && broken ? corrupt('ams-f4') : undefined) });
  try {
    r.stream.start('E4');
    await until(() => r.stream.report().displayed === 'E4', 'E4 displayed');
    r.stream.select('F4');
    await until(() => r.log.failures.length > 0, 'F4 to be reported as failed', 30_000);
    assert.ok(r.log.failures.every((f) => f.startsWith('F4:')), r.log.failures.join(' | '));
    const f4 = r.urlsOf(/ams-f4\.obosb$/);
    assert.equal(f4.length % 2, 0, 'every attempt is exactly two fetches');
    assert.equal(f4.filter((f) => f.cache === 'reload').length, f4.length / 2, 'one reload per attempt');
    assert.equal(r.stream.report().displayed, 'E4', 'Canal Ring stays');
    broken = false;
    r.stream.retry('F4', 'lod0');
    await until(() => r.stream.report().displayed === 'F4', 'F4 after Retry', 15_000);
  } finally { r.stop(); }
});

test('a bundle the manifest does not name (its content hash differs) is refused, once per attempt, and is not retried as if it were a bad copy', async () => {
  configure({ pins: { 'ams-f4': 'a'.repeat(64) } });
  const r = rig();
  try {
    r.stream.start('E4');
    await until(() => r.stream.report().displayed === 'E4', 'E4 displayed');
    r.stream.select('F4');
    await until(() => r.log.failures.length > 0, 'F4 to be reported as failed', 30_000);
    assert.ok(r.urlsOf(/ams-f4\.obosb$/).every((f) => f.cache === undefined), 'no cache: reload retry for a hash mismatch');
  } finally { r.stop(); }
});

// ── B1 with bundles ──────────────────────────────────────────────────────────────────────────

test('B1 with bundles: with the Worker unreachable, Canal Ring opens and NEVER raises a failure for itself (the halo\'s bundles fail, through every retry)', async () => {
  configure();
  const r = rig({ serve: (u) => { if (BUNDLE.test(u)) throw new TypeError('Failed to fetch'); return undefined; } });
  try {
    r.stream.start('E4');
    await until(() => r.stream.report().displayed === 'E4', 'E4 displayed with the Worker down');
    await wait(11_500);
    assert.deepEqual(r.log.failures, [], 'no plate over a Canal Ring that is drawn');
    assert.equal(r.stream.report().displayed, 'E4');
    assert.equal(r.log.show.filter((s) => s.code === 'E4').length, 1);
    assert.ok(r.urlsOf(BUNDLE).length > 0, 'the halo did try its bundles');
  } finally { r.stop(); }
});

test('B1 with bundles: a neighbour\'s (halo) bundle that is corrupt twice never fails the drawn area', async () => {
  configure();
  const r = rig({ serve: (u) => (BUNDLE.test(u) ? corrupt(/(ams-[a-z0-9]+)\.obosb$/.exec(u)[1]) : undefined) });
  try {
    r.stream.start('E4');
    await until(() => r.stream.report().displayed === 'E4', 'E4 displayed');
    await wait(11_500);
    assert.deepEqual(r.log.failures, []);
    assert.equal(r.stream.report().displayed, 'E4');
  } finally { r.stop(); }
});

// ── the data-source helpers ──────────────────────────────────────────────────────────────────

test('asBundleManifest: validates, keeps only a well-formed content hash, trims slashes', () => {
  const ok = { schema: 2, kind: 'area-bundles', baseUrl: 'https://x/', prefix: '/amsterdam/v/', files: { 'ams-f4.obosb': { contentHash: 'b'.repeat(64), sha256: 'q' }, 'ams-g5.obosb': { contentHash: 'nope' }, 'ams-h5.obosb': 3 } };
  const m = asBundleManifest(ok);
  assert.equal(m.baseUrl, 'https://x');
  assert.equal(m.prefix, 'amsterdam/v');
  assert.equal(m.files['ams-f4.obosb'].contentHash, 'b'.repeat(64));
  assert.equal(m.files['ams-g5.obosb'].contentHash, null);
  assert.equal(m.files['ams-h5.obosb'].contentHash, null);
  for (const bad of [null, 5, { ...ok, schema: 1 }, { ...ok, kind: 'x' }, { ...ok, baseUrl: null }, { ...ok, baseUrl: '' }, { ...ok, prefix: '' }, { ...ok, files: null }]) assert.throws(() => asBundleManifest(bad));
});

test('bundleTarget: a URL for a listed area only; null for Canal Ring, the local source, an unreadable manifest, an unlisted area, a local per-file manifest', () => {
  configure();
  assert.equal(bundleTarget('ams-f4').url, `${BASE}/${BUNDLE_PREFIX}/ams-f4.obosb`);
  assert.equal(bundleTarget('ams-zz'), null);
  assert.equal(bundleTarget('canal-ring'), null);
  configure({ noBundles: true });
  assert.equal(bundleTarget('ams-f4'), null);
  configureStreamData({ kind: 'local' }, { kind: 'manifest', manifest: bundleManifest() });
  assert.equal(bundleTarget('ams-f4'), null, 'the local flat directory has no bundles');
  configureStreamData({ kind: 'manifest', manifest: asR2Manifest({ ...perFileManifest(), baseUrl: null, files: {} }) }, { kind: 'manifest', manifest: bundleManifest() });
  assert.equal(bundleTarget('ams-f4'), null, 'a per-file manifest with no base URL is the dev loop with local files');
  configureStreamData({ kind: 'unavailable', reason: 'HTTP 500' }, { kind: 'manifest', manifest: bundleManifest() });
  assert.ok(bundleTarget('ams-f4'), 'bundles do not depend on the per-file manifest');
  configureStreamData({ kind: 'local' });
});

test('a bundle manifest that fails alone never makes the per-file source unavailable, and is not re-read by ensureStreamData', async () => {
  configureStreamData({ kind: 'local' });
  const calls = { files: 0, bundles: 0 };
  const fetcher = async (url) => {
    if (String(url).endsWith('ams-r2-bundles.json')) { calls.bundles++; return new Response('x', { status: 503 }); }
    calls.files++; return new Response(JSON.stringify({ schema: 1, prefix: FILE_PREFIX, baseUrl: BASE, files: perFileManifest().files }), { status: 200 });
  };
  await readStreamManifest(fetcher);
  assert.equal(bundleTarget('ams-f4'), null);
  await ensureStreamData(fetcher);
  assert.deepEqual(calls, { files: 1, bundles: 1 }, 'a source in hand is not read again');
  configureStreamData({ kind: 'local' });
});
