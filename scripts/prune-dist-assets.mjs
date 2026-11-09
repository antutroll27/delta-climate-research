import { access, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

// Astro copies every local file in public/ into dist/. These are retained as
// ignored source assets for experimentation, but no production code requests
// them. Removing them after each build keeps a directly deployed dist/ aligned
// with the actual runtime asset set.
// The dev streaming build's pointer to the Amsterdam layer files on R2 (streaming/data-source.ts). The production page never reads it, so it is
// pruned; a build made with PUBLIC_OBOS_STREAM=1 (the public switch) or PUBLIC_OBOS_STREAM_DEV=1 (the dev flag), the compile-time flags that include the
// streaming code, fetches it, so those builds keep it.
const STREAMING = process.env.PUBLIC_OBOS_STREAM === '1' || process.env.PUBLIC_OBOS_STREAM_DEV === '1';
const unusedModelAssets = [
  ...(STREAMING ? [] : ['heat-map/data/ams-r2-manifest.json']),
  'models/._river-1k.glb',
  'models/river-2k.glb',
  'models/river-4k.glb',
  'models/river-8k.glb',
  'models/._nature_vegetation_pack.glb',
  'models/flora.glb',
  'models/flora_raw.glb',
  'models/flowers_pack_4.glb',
  'models/nature_vegetation_pack.glb',
];

const dist = resolve('dist');
let modelsRemoved = 0;
let metadataRemoved = 0;

for (const asset of unusedModelAssets) {
  const path = resolve(dist, asset);
  try {
    await access(path);
    await rm(path);
    modelsRemoved += 1;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
    throw error;
  }
}

// On macOS volumes that preserve extended attributes through AppleDouble files,
// Astro's copies can leave `._*` metadata sidecars throughout dist/. They are
// never requested at runtime and should not be included in a directly deployed
// static build.
async function pruneAppleDouble(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await pruneAppleDouble(path);
      continue;
    }
    if (!entry.name.startsWith('._')) continue;
    await rm(path);
    metadataRemoved += 1;
  }
}

await pruneAppleDouble(dist);

console.log(
  `Pruned ${modelsRemoved} unused model asset${modelsRemoved === 1 ? '' : 's'} and `
  + `${metadataRemoved} AppleDouble sidecar${metadataRemoved === 1 ? '' : 's'} from dist.`
);
