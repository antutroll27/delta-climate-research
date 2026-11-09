#!/usr/bin/env node
/**
 * upload-city-data.mjs — publish the Amsterdam whole-city layer files to Cloudflare R2.
 *
 * WHAT GOES UP. Only what the streaming loader fetches (streaming-host/city-stream.ts `sheetUrls`): for each sheet
 * `ams-<code>` six files in public/heat-map/data/ — `.json` (buildings), `-roads.json`, `-water.json`, `-trees.json`,
 * `-terrain.json` (gzipped, Content-Encoding: gzip) and `-surface.png` (as is). The `data/cities/amsterdam/`
 * intermediates stay local. Canal Ring (sheet E4, id `canal-ring`) is committed and served by Vercel, so it is not here.
 *
 * KEYS NEVER GO STALE. The object key is `<prefix>/<version>/<file>` where `version` is a hash of every file's sha256
 * (see datasetVersion). Change one byte of one file and the whole dataset moves to a new prefix; re-running an
 * unchanged dataset rewrites the same keys with the same bytes. Objects are therefore `Cache-Control: immutable`.
 *
 * FOUNDER STEPS (once), then ONE command.
 *   1. Cloudflare dashboard > R2 > Create bucket (e.g. `delta-city-data`). Any location hint.
 *   2. Public access, either:
 *        a. custom domain (preferred): bucket > Settings > Custom Domains > Connect `data.deltaclimate.earth`
 *           (the zone must be on Cloudflare), or
 *        b. bucket > Settings > Public Development URL > Enable (gives https://pub-<hash>.r2.dev; rate-limited,
 *           fine for a trial, not for production).
 *        c. a Worker in front of the bucket (workers/city-data, no r2.dev rate limit, CORS built in): deploy it with
 *           `npx wrangler deploy` from workers/city-data and pass its https://obos-city-data.<account>.workers.dev as
 *           --base-url. The Worker serves only keys under `amsterdam/` (the default --prefix) and needs no bucket CORS
 *           (step 4); the upload itself still goes to the bucket `obos-city-data`. See docs/city-data-r2.md.
 *   3. `npx wrangler login` (browser sign-in; this script never sees a token).
 *   4. Apply CORS:  npx wrangler r2 bucket cors set <bucket> --file config/r2-cors.json
 *      (check afterwards with: npx wrangler r2 bucket cors list <bucket>)
 *   5. THE ONE COMMAND, from the repo root with the 186 files in public/heat-map/data/ (or pass --src):
 *        node scripts/upload-city-data.mjs --bucket <bucket> --base-url https://data.deltaclimate.earth
 *      Add --dry-run first to see the manifest and totals without touching R2.
 *   It writes public/heat-map/data/ams-r2-manifest.json (commit that), uploads, fetches every object back from the
 *   public URL and compares the sha256 of the DECODED bytes with the local file. Any mismatch lists the files and
 *   exits 1.
 *
 * Options: --bucket, --base-url (no trailing slash needed), --src (default public/heat-map/data),
 *   --manifest (default <src>/ams-r2-manifest.json; a dry run writes it only if given), --prefix (default amsterdam), --concurrency (default 4),
 *   --dry-run, --wrangler-flags=<flags> (default "--remote"; the = form is required, e.g.
 *   "--wrangler-flags=--local --persist-to dir" exercises the put path offline, with --concurrency 1).
 *
 * BUNDLE MODE (`--bundles <dir>`). Uploads the per-area bundles (`ams-<code>.obosb`, scripts/build-area-bundles.mjs) named by `<dir>/ams-r2-bundles.json`
 * under their OWN prefix `amsterdam/<version>/`. ONE request per area instead of six; see streaming/area-bundle.ts.
 *   node --import tsx scripts/upload-city-data.mjs --bundles <dir> --bucket obos-city-data --base-url https://obos-city-data.<account>.workers.dev [--dry-run]
 * (`--import tsx` because the read-back runs the page's own parser, `parseAreaBundle`, which is TypeScript.)
 *   - Objects: `Content-Type: application/octet-stream`, NO Content-Encoding (the JSON sections are gzipped inside the container), Cache-Control immutable.
 *   - ADDITIVE, NEVER DESTRUCTIVE: it deletes nothing and overwrites nothing. Before any write it asks the PUBLIC URL for every key: absent = to upload, present with the
 *     same bytes = skipped, present with DIFFERENT bytes = the whole run refuses (a version prefix is a content hash, so that means corruption or a collision).
 *   - Afterwards it reads every object back through the public URL, compares the sha256 of the WHOLE file, checks the headers and runs `parseAreaBundle` on it.
 *   - Only after all of that does it write the page's trimmed manifest (`--page-manifest`, default public/heat-map/data/ams-r2-bundles.json): the page reads the
 *     prefix, base URL and each bundle's contentHash; the per-section detail stays in `<dir>/ams-r2-bundles.json`. `--dry-run` reads (GETs) but writes nothing anywhere.
 *
 * No dependencies: node:* plus `npx wrangler`.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

/** The files the loader fetches per sheet. `ams-r2-manifest.json` cannot match: `-manifest` is not a layer suffix. */
export const LAYER_FILE = /^ams-[a-z0-9]+(?:-(?:roads|water|trees|terrain))?\.json$|^ams-[a-z0-9]+-surface\.png$/;
export const CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const DEFAULT_MANIFEST = 'ams-r2-manifest.json';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** Level 9; node writes mtime 0 in the gzip header, so the bytes are reproducible. */
const gzip = (bytes) => gzipSync(bytes, { level: 9 });

export function contentTypeOf(name) {
  if (name.endsWith('.json')) return 'application/json';
  if (name.endsWith('.png')) return 'image/png';
  throw new Error(`no content type for ${name}`);
}

/** sha256 over the sorted `path<TAB>sha256` lines: any change to any file's bytes, name or presence changes it. */
export function datasetVersion(files) {
  const lines = Object.keys(files).sort().map((p) => `${p}\t${files[p].sha256}\n`).join('');
  return sha256(lines).slice(0, 16);
}

/**
 * Hash and gzip-measure every layer file in `srcDir`. Returns the manifest plus the `blobs` (raw and upload bytes),
 * which are kept out of the manifest itself.
 */
export function buildManifest(srcDir, { prefix = 'amsterdam', baseUrl = null, pattern = LAYER_FILE } = {}) {
  const names = readdirSync(srcDir).filter((n) => pattern.test(n)).sort();
  if (names.length === 0) throw new Error(`no layer files matched in ${srcDir}`);
  const files = {};
  const blobs = new Map();
  for (const name of names) {
    const raw = readFileSync(join(srcDir, name));
    const contentType = contentTypeOf(name);
    const gzipped = contentType === 'application/json';
    const body = gzipped ? gzip(raw) : raw;
    files[name] = {
      sha256: sha256(raw), size: raw.length, gzipSize: gzipped ? body.length : null,
      uploadSize: body.length, contentType, contentEncoding: gzipped ? 'gzip' : null,
    };
    blobs.set(name, { raw, body });
  }
  const version = datasetVersion(files);
  const totals = Object.values(files).reduce((t, f) => ({
    files: t.files + 1, bytes: t.bytes + f.size, uploadBytes: t.uploadBytes + f.uploadSize,
  }), { files: 0, bytes: 0, uploadBytes: 0 });
  const manifest = {
    schema: 1, city: 'amsterdam', version, prefix: `${prefix}/${version}`,
    baseUrl: baseUrl === null ? null : baseUrl.replace(/\/+$/, ''),
    cacheControl: CACHE_CONTROL, totals, files,
  };
  return { manifest, blobs };
}

/** `<baseUrl>/<prefix>/<version>/<file>`. The one place that spells it; the page reads the same manifest. */
export function objectUrl(manifest, name) {
  return `${manifest.baseUrl}/${manifest.prefix}/${name}`;
}

function runWrangler(args, stdin) {
  return new Promise((done, fail) => {
    const child = spawn('npx', ['--yes', 'wrangler', ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.stdout.on('data', (d) => { err += d; });
    child.on('error', fail);
    child.on('close', (code) => (code === 0 ? done() : fail(new Error(`wrangler exited ${code}: ${err.split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter((l) => /error|denied|authenticat|not found|login|bucket/i.test(l)).slice(0, 3).join(' | ')}`))));
    child.stdin.on('error', () => { /* surfaced by the exit code */ });
    child.stdin.end(stdin);
  });
}

/** Run `task` over `items`, at most `limit` at a time; collect every failure rather than stopping at the first. */
async function pool(items, limit, task) {
  const failures = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try { await task(item); } catch (error) { failures.push({ item, error }); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return failures;
}

async function upload(manifest, blobs, { bucket, wranglerFlags, concurrency }) {
  const names = Object.keys(manifest.files);
  let done = 0;
  const failures = await pool(names, concurrency, async (name) => {
    const f = manifest.files[name];
    const args = ['r2', 'object', 'put', `${bucket}/${manifest.prefix}/${name}`, '-p',
      '--content-type', f.contentType, '--cache-control', CACHE_CONTROL];
    if (f.contentEncoding) args.push('--content-encoding', f.contentEncoding);
    await runWrangler([...args, ...wranglerFlags], blobs.get(name).body);
    if (++done % 20 === 0 || done === names.length) console.log(`  uploaded ${done}/${names.length}`);
  });
  return failures.map(({ item, error }) => `${item}: upload failed (${error.message})`);
}

/** Fetch each object from the public URL; fetch() decodes Content-Encoding, so we hash what the page would parse. */
async function verify(manifest, concurrency) {
  const names = Object.keys(manifest.files);
  const warnings = [];
  const failures = await pool(names, concurrency, async (name) => {
    const f = manifest.files[name];
    const response = await fetch(objectUrl(manifest, name), { headers: { Origin: 'https://deltaclimate.earth' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const got = sha256(bytes);
    if (got !== f.sha256) throw new Error(`sha256 ${got.slice(0, 12)} != ${f.sha256.slice(0, 12)} (${bytes.length} bytes, expected ${f.size})`);
    const type = response.headers.get('content-type') ?? '';
    if (!type.startsWith(f.contentType)) warnings.push(`${name}: content-type "${type}"`);
    if (response.headers.get('access-control-allow-origin') === null) warnings.push(`${name}: no Access-Control-Allow-Origin for https://deltaclimate.earth (apply config/r2-cors.json to the bucket, or check the Worker's origin list)`);
  });
  return { failures: failures.map(({ item, error }) => `${item}: ${error.message}`), warnings };
}

const mb = (n) => (n / 1e6).toFixed(2);

// ── bundle mode ──────────────────────────────────────────────────────────────

export const BUNDLE_CONTENT_TYPE = 'application/octet-stream';
export const BUNDLE_MANIFEST = 'ams-r2-bundles.json';
export const DEFAULT_PAGE_MANIFEST = 'public/heat-map/data/ams-r2-bundles.json';

/** Read and validate `<dir>/ams-r2-bundles.json` and load every bundle it names, checking each file against its row (size, sha256). */
export function loadBundles(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, BUNDLE_MANIFEST), 'utf8'));
  if (manifest.schema !== 2 || manifest.kind !== 'area-bundles') throw new Error(`${BUNDLE_MANIFEST} is not an area-bundles manifest (schema 2)`);
  if (typeof manifest.prefix !== 'string' || !/^amsterdam\/[0-9a-f]{16}$/.test(manifest.prefix)) throw new Error(`unexpected bundle prefix ${JSON.stringify(manifest.prefix)}`);
  const bytes = new Map();
  for (const [name, row] of Object.entries(manifest.files)) {
    if (!/^ams-[a-z0-9]+\.obosb$/.test(name)) throw new Error(`${name}: not a bundle file name`);
    if (row.contentType !== BUNDLE_CONTENT_TYPE || row.contentEncoding !== null) throw new Error(`${name}: the manifest row must be ${BUNDLE_CONTENT_TYPE} with no content-encoding`);
    const body = readFileSync(join(dir, name));
    if (body.length !== row.size) throw new Error(`${name}: ${body.length} bytes on disk, the manifest says ${row.size}`);
    if (sha256(body) !== row.sha256) throw new Error(`${name}: sha256 on disk differs from the manifest`);
    bytes.set(name, body);
  }
  if (bytes.size === 0) throw new Error('the bundle manifest lists no files');
  return { manifest, bytes };
}

/** What the page reads of the bundle manifest: where the bundles are and each one's content hash. Everything else stays in the full manifest. */
export function pageBundleManifest(manifest) {
  return {
    schema: 2, kind: 'area-bundles', formatVersion: manifest.formatVersion, city: manifest.city, version: manifest.version, prefix: manifest.prefix,
    baseUrl: manifest.baseUrl, cacheControl: manifest.cacheControl, sourceVersion: manifest.sourceVersion,
    files: Object.fromEntries(Object.entries(manifest.files).map(([name, f]) => [name, { sha256: f.sha256, size: f.size, contentHash: f.contentHash }])),
  };
}

async function loadParser() {
  try { return (await import('../src/scripts/climate-engine/streaming/area-bundle.ts')).parseAreaBundle; }
  catch (error) { throw new Error(`cannot load the bundle parser (run with: node --import tsx scripts/upload-city-data.mjs --bundles ...): ${error.message}`); }
}

/** For every key: what the PUBLIC URL says about it now. `absent` (404), `same` (200, identical bytes) or `different`. Anything else (5xx, a network error) is a failure: no guessing. */
async function survey(manifest, bytes, baseUrl, concurrency) {
  const state = new Map();
  const failures = await pool([...bytes.keys()], concurrency, async (name) => {
    const response = await fetch(`${baseUrl}/${manifest.prefix}/${name}`, { headers: { 'Cache-Control': 'no-cache' } });
    if (response.status === 404) { await response.body?.cancel(); state.set(name, 'absent'); return; }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
    state.set(name, sha256(Buffer.from(await response.arrayBuffer())) === manifest.files[name].sha256 ? 'same' : 'different');
  });
  return { state, failures: failures.map(({ item, error }) => `${item}: ${error.message}`) };
}

async function uploadBundles(manifest, bytes, names, { bucket, wranglerFlags, concurrency }) {
  let done = 0;
  const failures = await pool(names, concurrency, async (name) => {
    /* No --content-encoding: the container gzips its JSON sections itself. put on a key the survey found ABSENT; it is never pointed at an existing one. */
    const args = ['r2', 'object', 'put', `${bucket}/${manifest.prefix}/${name}`, '-p', '--content-type', BUNDLE_CONTENT_TYPE, '--cache-control', CACHE_CONTROL];
    await runWrangler([...args, ...wranglerFlags], bytes.get(name));
    if (++done % 10 === 0 || done === names.length) console.log(`  uploaded ${done}/${names.length}`);
  });
  return failures.map(({ item, error }) => `${item}: upload failed (${error.message})`);
}

/** Read every bundle back through the public URL: whole-file sha256 and size, the headers, and the page's own parser (with the manifest's content hash pinned). */
async function verifyBundles(manifest, bytes, baseUrl, concurrency) {
  const parse = await loadParser();
  const warnings = [];
  const failures = await pool([...bytes.keys()], concurrency, async (name) => {
    const f = manifest.files[name];
    const response = await fetch(`${baseUrl}/${manifest.prefix}/${name}`, { headers: { Origin: 'https://deltaclimate.earth', 'Cache-Control': 'no-cache' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get('content-type') ?? '';
    const encoding = response.headers.get('content-encoding');
    const cache = response.headers.get('cache-control') ?? '';
    if (type !== BUNDLE_CONTENT_TYPE) throw new Error(`content-type "${type}"`);
    if (encoding !== null) throw new Error(`unexpected content-encoding "${encoding}"`);
    if (!/immutable/.test(cache)) warnings.push(`${name}: cache-control "${cache}"`);
    if (response.headers.get('access-control-allow-origin') === null) warnings.push(`${name}: no Access-Control-Allow-Origin for https://deltaclimate.earth`);
    const got = Buffer.from(await response.arrayBuffer());
    if (got.length !== f.size) throw new Error(`${got.length} bytes, expected ${f.size}`);
    const sum = sha256(got);
    if (sum !== f.sha256) throw new Error(`sha256 ${sum.slice(0, 12)} != ${f.sha256.slice(0, 12)}`);
    const parsed = await parse(got, { expectAreaId: f.areaId, expectContentHash: f.contentHash });
    if (parsed.contentHash !== f.contentHash) throw new Error('contentHash differs from the manifest');
  });
  return { failures: failures.map(({ item, error }) => `${item}: ${error.message}`), warnings };
}

async function mainBundles(v) {
  const dry = v['dry-run'];
  const dir = resolve(v.bundles);
  const { manifest, bytes } = loadBundles(dir);
  const baseUrl = (v['base-url'] ?? manifest.baseUrl).replace(/\/+$/, '');
  const concurrency = Math.max(1, Number(v.concurrency) || 4);
  if (!dry && !v.bucket) { console.error('usage: upload-city-data.mjs --bundles <dir> --bucket <name> [--base-url <https://...>] [--dry-run]'); process.exit(2); }
  const total = [...bytes.values()].reduce((n, b) => n + b.length, 0);
  console.log(`${bytes.size} bundles, ${mb(total)} MB, version ${manifest.version} (per-file set ${manifest.sourceVersion})`);
  console.log(`key prefix ${manifest.prefix}  ->  ${baseUrl}/${manifest.prefix}/ams-<code>.obosb`);
  console.log(`headers: Content-Type ${BUNDLE_CONTENT_TYPE}; no Content-Encoding; Cache-Control ${CACHE_CONTROL}`);

  const parse = await loadParser();
  for (const [name, body] of bytes) {          // nothing leaves this machine unless the page's own parser accepts it
    const f = manifest.files[name];
    const p = await parse(body, { expectAreaId: f.areaId, expectContentHash: f.contentHash });
    if (p.contentHash !== f.contentHash) throw new Error(`${name}: contentHash differs from the manifest`);
  }
  console.log(`local check: all ${bytes.size} parse with parseAreaBundle and match their contentHash`);

  const { state, failures: surveyFailures } = await survey(manifest, bytes, baseUrl, Math.max(concurrency, 8));
  if (surveyFailures.length > 0) { console.error(`\nsurvey of the public URL failed for ${surveyFailures.length} key(s); nothing written:\n${surveyFailures.join('\n')}`); process.exit(1); }
  const names = [...bytes.keys()];
  const todo = names.filter((n) => state.get(n) === 'absent');
  const same = names.filter((n) => state.get(n) === 'same');
  const different = names.filter((n) => state.get(n) === 'different');
  console.log(`public survey: ${todo.length} absent (to upload), ${same.length} already present with identical bytes (skipped), ${different.length} present with DIFFERENT bytes`);
  if (different.length > 0) { console.error(`\nREFUSING: these keys exist with other bytes and this tool never overwrites:\n${different.map((n) => `  ${manifest.prefix}/${n}`).join('\n')}`); process.exit(1); }
  if (dry) {
    for (const n of todo) console.log(`  would put ${manifest.prefix}/${n}  ${bytes.get(n).length} B`);
    console.log('dry run: nothing uploaded, no file written');
    return;
  }

  const wranglerFlags = v['wrangler-flags'].split(/\s+/).filter(Boolean);
  if (todo.length > 0) {
    const upFailures = await uploadBundles(manifest, bytes, todo, { bucket: v.bucket, wranglerFlags, concurrency });
    if (upFailures.length > 0) { console.error(`\n${upFailures.length} upload failure(s):\n${upFailures.join('\n')}`); process.exit(1); }
  }
  console.log('reading every bundle back through the public URL...');
  const { failures, warnings } = await verifyBundles(manifest, bytes, baseUrl, Math.max(concurrency, 8));
  for (const w of warnings.slice(0, 10)) console.warn(`warning: ${w}`);
  if (warnings.length > 10) console.warn(`warning: ...and ${warnings.length - 10} more`);
  if (failures.length > 0) { console.error(`\n${failures.length} of ${bytes.size} bundles FAILED read-back:\n${failures.join('\n')}`); process.exit(1); }
  console.log(`read back ${bytes.size}/${bytes.size}: whole-file sha256, size, headers and parseAreaBundle all match`);
  const pageManifest = resolve(v['page-manifest'] ?? DEFAULT_PAGE_MANIFEST);
  writeFileSync(pageManifest, `${JSON.stringify(pageBundleManifest({ ...manifest, baseUrl }), null, 1)}\n`);
  console.log(`page manifest: ${pageManifest}`);
}

async function main() {
  const { values: v } = parseArgs({
    options: {
      bucket: { type: 'string' }, 'base-url': { type: 'string' }, src: { type: 'string', default: 'public/heat-map/data' },
      manifest: { type: 'string' }, prefix: { type: 'string', default: 'amsterdam' }, concurrency: { type: 'string', default: '4' },
      'wrangler-flags': { type: 'string', default: '--remote' }, 'dry-run': { type: 'boolean', default: false },
      bundles: { type: 'string' }, 'page-manifest': { type: 'string' },
    },
  });
  if (v.bundles !== undefined) return mainBundles(v);
  const dry = v['dry-run'];
  if (!dry && (!v.bucket || !v['base-url'])) { console.error('usage: upload-city-data.mjs --bucket <name> --base-url <https://...> [--src dir] [--dry-run]'); process.exit(2); }
  const src = resolve(v.src);
  const manifestPath = resolve(v.manifest ?? join(src, DEFAULT_MANIFEST));
  const concurrency = Math.max(1, Number(v.concurrency) || 4);
  const baseUrl = v['base-url'] ?? 'https://DRY-RUN.invalid';
  if (/\.workers\.dev\/?$/.test(baseUrl) && v.prefix !== 'amsterdam') {
    console.error(`the city-data Worker serves only keys under amsterdam/, but --prefix is "${v.prefix}"`);
    process.exit(2);
  }

  const { manifest, blobs } = buildManifest(src, { prefix: v.prefix, baseUrl });
  const t = manifest.totals;
  const sheets = new Set(Object.keys(manifest.files).map((n) => n.split(/[.-]/).slice(0, 2).join('-')));
  console.log(`${t.files} files, ${sheets.size} sheets, version ${manifest.version}`);
  console.log(`raw ${mb(t.bytes)} MB, to upload ${mb(t.uploadBytes)} MB (JSON gzipped, PNG as is)`);
  console.log(`key prefix ${manifest.prefix}  ->  ${objectUrl(manifest, 'ams-<code>.json')}`);
  /* A dry run has a placeholder base URL, so it writes the manifest only when asked to with --manifest. */
  if (!dry || v.manifest) {
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);
    console.log(`manifest: ${manifestPath}`);
  }
  if (dry) { console.log('dry run: nothing uploaded, nothing fetched back'); return; }

  const wranglerFlags = v['wrangler-flags'].split(/\s+/).filter(Boolean);
  const upFailures = await upload(manifest, blobs, { bucket: v.bucket, wranglerFlags, concurrency });
  if (upFailures.length > 0) { console.error(`\n${upFailures.length} upload failure(s):\n${upFailures.join('\n')}`); process.exit(1); }

  console.log('fetching every object back from the public URL...');
  const { failures, warnings } = await verify(manifest, Math.max(concurrency, 8));
  for (const w of warnings.slice(0, 10)) console.warn(`warning: ${w}`);
  if (warnings.length > 10) console.warn(`warning: ...and ${warnings.length - 10} more`);
  if (failures.length > 0) { console.error(`\n${failures.length} of ${t.files} objects FAILED verification:\n${failures.join('\n')}`); process.exit(1); }
  console.log(`verified ${t.files}/${t.files}: decoded sha256 matches the local files`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
