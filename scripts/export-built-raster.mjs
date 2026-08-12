/**
 * Export each ward's building-coverage raster for the Python validation pass.
 *
 *     node scripts/export-built-raster.mjs
 *
 * WHY THIS IS TYPESCRIPT AND NOT PYTHON. `rasterizeWardBuilt` is the canonical
 * footprint rasteriser — 2x2 supersampled point-in-polygon, deliberately written
 * in pure arithmetic so the analytical grid does not depend on a browser's
 * Canvas antialiasing. measure-spatial-accuracy.py needs the same `built` layer
 * the shipping model runs on, and a second implementation in Python would be a
 * second thing to keep in step: any drift between them would show up as the
 * model "failing" validation when in fact the two sides were rasterising
 * different buildings.
 *
 * So the rasteriser stays in one place and this writes its output to a cache the
 * Python side reads. 140 x 140, matching the Sentinel-2 surface grid exactly, so
 * both downsample to the ECOSTRESS grid through identical arithmetic.
 *
 * Output: ~/.cache/delta-climate/built/<ward>-built-140.f32  (raw little-endian
 *         Float32, row-major — an intermediate, deliberately not in the repo)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
// Run under tsx (`npx tsx scripts/export-built-raster.mjs`) — it resolves the
// .ts import directly, so no loader registration is needed here.
import { rasterizeWardBuilt } from '../src/scripts/climate-engine/ward-raster.ts';

/** Matches _sentinel.GRID (1400 m / 10 m). Both sides must agree or the
 *  downsample to the ECOSTRESS grid silently compares offset cells. */
const GRID = 140;
const WARDS = ['ballygunge', 'baruipur', 'barrackpore'];

const outDir = join(homedir(), '.cache', 'delta-climate', 'built');
mkdirSync(outDir, { recursive: true });

for (const ward of WARDS) {
  /* GEOM_DIR lets the geometry gate raster a STAGED candidate set without
     touching the shipped one. Defaults to today's path, so behaviour is
     unchanged for every existing caller. */
  const geomDir = process.env.GEOM_DIR ?? 'public/heat-map/data';
  const geomRaw = readFileSync(`${geomDir}/${ward}.json`);
  const data = JSON.parse(geomRaw.toString('utf8'));
  const built = rasterizeWardBuilt(data, GRID);
  if (built.length !== GRID * GRID) throw new Error(`${ward}: expected ${GRID ** 2} cells, got ${built.length}`);

  const path = join(outDir, `${ward}-built-${GRID}.f32`);
  writeFileSync(path, Buffer.from(built.buffer, built.byteOffset, built.byteLength));

  /* STAMP THE SOURCE GEOMETRY, so a stale cache announces itself.
     The filename is keyed only by ward and grid, so nothing about it changes
     when the footprints underneath do. That is exactly what went wrong: 6151975
     swapped the shipped footprints from Microsoft to Overture (8,579 -> 12,767
     buildings) and this cache was never regenerated, so for nine days every
     spatial figure scored a building layer we had stopped shipping. 45-58% of
     cells differed and nothing complained, because the reader only checked that
     the file EXISTED. The sidecar below lets it check that the file is CURRENT. */
  writeFileSync(path.replace(/\.f32$/, '.json'), JSON.stringify({
    ward, grid: GRID, count: data.count, source: data.source ?? null,
    /* Hash the ward JSON's RAW BYTES, never a re-serialisation. The first
       attempt hashed JSON.stringify(data.b) here and json.dumps(live["b"]) on
       the Python side: same data, different separators, so the digests could
       never agree and the guard fired on every run. Bytes are bytes in both
       languages. */
    geometrySha256: createHash('sha256').update(geomRaw).digest('hex').slice(0, 16),
  }) + '\n');

  let sum = 0, nonzero = 0;
  for (const v of built) { sum += v; if (v > 0) nonzero++; }
  console.log(`  ${ward.padEnd(13)} mean built ${(sum / built.length).toFixed(4)}`
    + `  covered cells ${((nonzero / built.length) * 100).toFixed(1)}%`
    + `  ${data.count.toLocaleString()} buildings`);
}
console.log(`\n  written to ${outDir}/`);
