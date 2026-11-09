import assert from 'node:assert/strict';
import test from 'node:test';

import { asR2Manifest, configureStreamData, ensureStreamData, readStreamManifest, streamedAreaUrls } from '../../src/scripts/climate-engine/streaming/data-source.ts';
import { sheetUrls } from '../../src/scripts/climate-engine/streaming-host/city-stream.ts';
import { readFileSync } from 'node:fs';

/* THE STREAMING LOADER READS AMSTERDAM'S LAYER FILES FROM CLOUDFLARE R2 (dev flag only). One helper serves both `sheetUrls` (the controller) and
   `streamPaths` (the app's loadWard): `${baseUrl}/${prefix}/${file}` for every area except E4 / canal-ring, which stays same-origin. */

const manifestFor = (ids, baseUrl = 'https://r2.example') => ({
  schema: 1, city: 'amsterdam', version: 'v1', prefix: 'amsterdam/v1', baseUrl,
  files: Object.fromEntries(ids.flatMap((id) => [`${id}.json`, `${id}-roads.json`, `${id}-water.json`, `${id}-trees.json`, `${id}-terrain.json`, `${id}-surface.png`].map((f) => [f, { sha256: 'x', size: 1 }]))),
});

test('default (nothing configured, as in every other test): same-origin, the flat directory', () => {
  configureStreamData({ kind: 'local' });
  assert.equal(sheetUrls('F4').ward, '/heat-map/data/ams-f4.json');
});

test('R2: every area but E4 reads from baseUrl/prefix/file; E4 stays same-origin', () => {
  configureStreamData({ kind: 'manifest', manifest: asR2Manifest(manifestFor(['ams-f4', 'ams-g5'])) });
  const f4 = sheetUrls('F4');
  assert.equal(f4.ward, 'https://r2.example/amsterdam/v1/ams-f4.json');
  assert.equal(f4.surface, 'https://r2.example/amsterdam/v1/ams-f4-surface.png');
  assert.equal(f4.trees, 'https://r2.example/amsterdam/v1/ams-f4-trees.json');
  assert.equal(f4.terrain, 'https://r2.example/amsterdam/v1/ams-f4-terrain.json');
  assert.equal(sheetUrls('E4').ward, '/heat-map/data/canal-ring.json');
  assert.equal(sheetUrls('E4').trees, '/heat-map/data/canal-ring-trees.json');
  assert.equal(streamedAreaUrls('ams-g5').ward, 'https://r2.example/amsterdam/v1/ams-g5.json', 'the app\'s streamPaths gets the same URLs');
});

test('a null baseUrl falls back to the local flat directory (the dev loop with local files)', () => {
  configureStreamData({ kind: 'manifest', manifest: asR2Manifest(manifestFor(['ams-f4'], null)) });
  assert.equal(sheetUrls('F4').ward, '/heat-map/data/ams-f4.json');
  assert.equal(sheetUrls('G5').ward, '/heat-map/data/ams-g5.json', 'and it asks nothing of the manifest for an area it does not list');
});

test('an area missing from the manifest fails VISIBLY (it throws, so the loader\'s failed state with Retry shows), never a silent 404', () => {
  configureStreamData({ kind: 'manifest', manifest: asR2Manifest(manifestFor(['ams-f4'])) });
  assert.throws(() => sheetUrls('G5'), /G5.*not in the data manifest/i);
  assert.throws(() => streamedAreaUrls('ams-g5'), /not in the data manifest/i);
  const partial = manifestFor(['ams-f4']);
  delete partial.files['ams-f4-trees.json'];
  configureStreamData({ kind: 'manifest', manifest: asR2Manifest(partial) });
  assert.throws(() => sheetUrls('F4'), /ams-f4-trees\.json/, 'one missing file is a missing area: the data must be whole');
  configureStreamData({ kind: 'unavailable', reason: 'HTTP 404' });
  assert.throws(() => sheetUrls('F4'), /manifest.*HTTP 404/i);
  assert.equal(sheetUrls('E4').ward, '/heat-map/data/canal-ring.json', 'Canal Ring never depends on it');
});

test('asR2Manifest refuses a malformed manifest', () => {
  assert.throws(() => asR2Manifest(null));
  assert.throws(() => asR2Manifest({ baseUrl: 'https://x', prefix: 'p' }), /files/);
  assert.throws(() => asR2Manifest({ baseUrl: 5, prefix: 'p', files: {} }), /baseUrl/);
  const m = asR2Manifest({ baseUrl: 'https://x/', prefix: '/p/', files: {} });
  assert.equal(m.baseUrl, 'https://x', 'a trailing slash on the base is dropped');
  assert.equal(m.prefix, 'p');
});

test('the committed manifest is whole: 186 files, 31 areas, six files each, a base URL and a prefix', () => {
  configureStreamData({ kind: 'local' });
  const m = asR2Manifest(JSON.parse(readFileSync(new URL('../../public/heat-map/data/ams-r2-manifest.json', import.meta.url), 'utf8')));
  assert.equal(Object.keys(m.files).length, 186);
  assert.match(m.baseUrl ?? '', /^https:\/\/obos-city-data\.[a-z0-9-]+\.workers\.dev$/);
  assert.match(m.prefix, /^amsterdam\/[0-9a-f]{16}$/);
  configureStreamData({ kind: 'manifest', manifest: m });
  for (const code of ['B3', 'F4', 'G5', 'E5']) assert.match(sheetUrls(code).ward, /^https:\/\/obos-city-data\.[a-z0-9-]+\.workers\.dev\/amsterdam\/[0-9a-f]{16}\/ams-[a-z0-9]+\.json$/);
  configureStreamData({ kind: 'local' });
});

test('R4: a manifest that cannot be read makes the source unavailable (with the reason), and ensureStreamData reads it AGAIN until it can be', async () => {
  configureStreamData({ kind: 'local' });
  let calls = 0, up = false;
  const fetcher = async (url) => { if (!String(url).endsWith('ams-r2-manifest.json')) return new Response('no', { status: 404 }); calls++; return up ? new Response(JSON.stringify(manifestFor(['ams-f4'])), { status: 200 }) : new Response('no', { status: 503 }); };
  await readStreamManifest(fetcher);
  assert.throws(() => sheetUrls('F4'), /HTTP 503/, 'the failure names its reason');
  assert.equal(sheetUrls('E4').ward, '/heat-map/data/canal-ring.json', 'Canal Ring never needs the manifest');
  await ensureStreamData(fetcher);
  assert.equal(calls, 2, 'still down: read again');
  assert.throws(() => sheetUrls('F4'), /HTTP 503/);
  up = true;
  await Promise.all([ensureStreamData(fetcher), ensureStreamData(fetcher)]);
  assert.equal(calls, 3, 'one read at a time: two concurrent askers share it');
  assert.equal(sheetUrls('F4').ward, 'https://r2.example/amsterdam/v1/ams-f4.json', 'recovered');
  await ensureStreamData(fetcher);
  assert.equal(calls, 3, 'and a manifest in hand is never read again');
  configureStreamData({ kind: 'local' });
});

test('R4: ensureStreamData does nothing for the local source (every other test, and the production page)', async () => {
  configureStreamData({ kind: 'local' });
  let calls = 0;
  await ensureStreamData(async () => { calls++; return new Response('x'); });
  assert.equal(calls, 0);
});
