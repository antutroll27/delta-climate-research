/**
 * maplibre-gl 6 parses tiles in a worker that is a SEPARATE file. If the bundler does not
 * emit it, or something prunes it, no tile ever parses and the basemap is empty without an
 * error. Run after `astro build` (and after the prune step): the worker must be in
 * dist/_astro, non-trivial, and named by the heat-map app chunk that registers it.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const assets = resolve('dist/_astro');
const names = await readdir(assets);
const workers = names.filter((name) => /^maplibre-gl-worker.*\.m?js$/.test(name));
if (workers.length !== 1) {
  console.error(`check-maplibre-worker: expected exactly one maplibre-gl-worker asset in dist/_astro, found ${workers.length} (${workers.join(', ') || 'none'})`);
  process.exit(1);
}
const [worker] = workers;
const { size } = await stat(resolve(assets, worker));
if (size < 100_000) {
  console.error(`check-maplibre-worker: ${worker} is ${size} bytes, far too small to be the parsing worker`);
  process.exit(1);
}
const owners = [];
for (const name of names.filter((n) => /^heat-map-app.*\.js$/.test(n))) {
  if ((await readFile(resolve(assets, name), 'utf8')).includes(worker)) owners.push(name);
}
if (owners.length === 0) {
  console.error(`check-maplibre-worker: no heat-map-app chunk references ${worker}; setWorkerUrl would point nowhere`);
  process.exit(1);
}
console.log(`check-maplibre-worker: ${worker} (${(size / 1024).toFixed(0)} kB) is in dist/_astro and referenced by ${owners.join(', ')}`);
