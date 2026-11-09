#!/usr/bin/env node
/**
 * check-stream-dist.mjs — what a built dist/ may and may not contain about whole-city streaming (stream-public).
 *
 *   node scripts/check-stream-dist.mjs plain  [dist]   a build with NEITHER flag: zero streaming code, zero streaming strings, no manifest.
 *   node scripts/check-stream-dist.mjs public [dist]   a build with PUBLIC_OBOS_STREAM=1 only: the streaming code is there, and none of the dev tools is.
 *   node scripts/check-stream-dist.mjs dev    [dist]   a build with PUBLIC_OBOS_STREAM_DEV=1: the dev tools are there (the dev smoke needs them).
 *
 * It reads every .js/.html/.css/.json under dist/ (the .json only for the manifest's presence; the data files are not code) and the chunk file names.
 * The strings are chosen to be ones a minifier cannot rename: URLs, sentences, DOM names and window globals.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const [mode, distArg] = process.argv.slice(2);
if (!['plain', 'public', 'dev'].includes(mode ?? '')) { console.error('usage: check-stream-dist.mjs plain|public|dev [dist]'); process.exit(2); }
const dist = resolve(distArg ?? 'dist');

/** Strings that exist only because streaming is compiled in. */
const STREAMING = [
  'obos-city-data', 'ams-r2-manifest', 'ams-r2-bundles', 'obos-area-bundle', 'sheet-worker', 'halo-sim', 'obos-area-code', 'data-streamed-note', 'data-unavailable',
  'has not been run for this one', 'Data receipts are not available for', 'Not available for this area yet',
];
/** Strings that exist only because the DEV tools are compiled in. */
const DEV_TOOLS = ['streamtier', '__obosStream', 'jsHeapMB', 'glBufferMB', 'glTextureMB', 'canvas swap chain', 'streaming: '];
/** Chunk names (Rollup names a dynamic chunk after its source file). */
const STREAMING_CHUNKS = /(city-stream|area-bundle|page-wiring|sheet-worker|gl-meter|area-surfaces|halo-sim|sheet-manager|loader-view)/;
const DEV_CHUNKS = /gl-meter/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}
if (!existsSync(dist)) { console.error(`no such dist: ${dist}`); process.exit(2); }

const files = [...walk(dist)].map((p) => relative(dist, p));
const code = files.filter((f) => /\.(js|html|css)$/.test(f));
const text = new Map(code.map((f) => [f, readFileSync(join(dist, f), 'utf8')]));
const where = (needle) => code.filter((f) => text.get(f).includes(needle));
const problems = [];
const expect = (ok, message) => { if (!ok) problems.push(message); };

const MANIFEST = 'heat-map/data/ams-r2-manifest.json';
const BUNDLE_MANIFEST = 'heat-map/data/ams-r2-bundles.json';
if (mode === 'plain') {
  for (const s of STREAMING) expect(where(s).length === 0, `streaming string "${s}" is in ${where(s).join(', ')}`);
  for (const s of DEV_TOOLS) expect(where(s).length === 0, `dev-tool string "${s}" is in ${where(s).join(', ')}`);
  expect(!files.some((f) => STREAMING_CHUNKS.test(f)), `streaming chunks in the plain build: ${files.filter((f) => STREAMING_CHUNKS.test(f)).join(', ')}`);
  expect(!files.includes(MANIFEST), 'the plain build carries the R2 manifest (prune-dist-assets should have removed it)');
  expect(!files.includes(BUNDLE_MANIFEST), 'the plain build carries the R2 bundle manifest (prune-dist-assets should have removed it)');
} else {
  expect(files.includes(MANIFEST), 'the streaming build lost its manifest: every area but Canal Ring would fail');
  expect(files.includes(BUNDLE_MANIFEST), 'the streaming build lost its bundle manifest: every area would be six requests instead of one');
  expect(files.some((f) => /city-stream/.test(f)) && files.some((f) => /page-wiring/.test(f)), 'the streaming chunks are missing');
}
if (mode === 'public') {
  for (const s of DEV_TOOLS) expect(where(s).length === 0, `dev-tool string "${s}" is in the PUBLIC build: ${where(s).join(', ')}`);
  expect(!files.some((f) => DEV_CHUNKS.test(f)), `a dev-tool chunk is in the public build: ${files.filter((f) => DEV_CHUNKS.test(f)).join(', ')}`);
}
if (mode === 'dev') {
  for (const s of ['streamtier', '__obosStream']) expect(where(s).length > 0, `the dev build lost "${s}"`);
  expect(files.some((f) => DEV_CHUNKS.test(f)), 'the dev build lost the GL meter chunk');
}
// SEO, every mode: the Canal Ring page's URL tags are its own path, with no query and no area (a `?area=` URL is the same page)
const page = join(dist, 'heat-map/nl/amsterdam/canal-ring/index.html');
if (existsSync(page)) {
  const html = readFileSync(page, 'utf8');
  for (const m of html.matchAll(/<(?:link rel="canonical" href|meta property="og:url" content)="([^"]*)"/g)) {
    expect(m[1].endsWith('/heat-map/nl/amsterdam/canal-ring/'), `a URL tag is not Canal Ring's query-free path: ${m[1]}`);
  }
  expect(/<meta name="robots" content="noindex">|<link rel="canonical"/.test(html), 'the Canal Ring page is neither noindex nor canonical');
} else problems.push(`${relative('.', page)} is missing`);

if (problems.length > 0) { console.error(`check-stream-dist (${mode}) FAILED:\n  - ${problems.filter(Boolean).join('\n  - ')}`); process.exit(1); }
console.log(`check-stream-dist (${mode}): ok — ${code.length} code files, ${files.length} files in ${relative('.', dist) || '.'}`);
