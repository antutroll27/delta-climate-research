/**
 * The TypeScript side of the dewpoint-taper parity gate: what dewpointTaper() and the latent
 * coefficient L in heat-map-model.ts say on a fixed grid that straddles the dewpoint, by day
 * and by night. Writes tests/fixtures/dewpoint-taper/ts-oracle.json.
 *
 *   node --import tsx scripts/dump-dewpoint-taper-parity.mjs [--check]
 *
 * `--check` compares with the committed oracle instead of writing it (a unit test runs it).
 * The Python side is scripts/check-dewpoint-taper-parity.py.
 *
 * Each point is driven through the PRODUCT's own entry point, currentParams(), so the grid
 * covers the whole chain (wind clamp, evapScale, sky temperature, the -2.5 K night
 * convention), not just the taper in isolation. `L` is the latent coefficient the model hands
 * the solver: day = full L x taper, night = full L x NIGHT_ET_FRACTION x taper.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentParams, dewpointTaper } from '../src/scripts/climate-engine/heat-map-model.ts';
import { resolve } from '../src/scripts/climate-engine/scope/resolve.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'tests/fixtures/dewpoint-taper/ts-oracle.json');

// A scope with no warming pathway, so air is exactly what the grid says.
const base = resolve('nl/amsterdam/canal-ring').climate;
const climate = { ...base, pathDelta: {} };
const IV = { trees: 0, roof: 0, parks: 0, facades: 0 };

const AIR = [-5, 0, 5, 10, 15, 20, 25, 30];
const RH = [50, 70, 85, 92, 96, 98, 100];
const CLOUD = [0, 50];
const WIND = [1, 4];                         // raw 10 m wind, m/s
const SUN_NOW = [0.06, 0.1, 0.2, 0.35, 0.6, 1];

const points = [];
for (const air of AIR) for (const rh of RH) for (const cloud of CLOUD) for (const wind of WIND) {
  const live = { tAir: air, rh, wind, cloud, feels: air };
  const st = (extra) => ({ live, phase: 'peak', path: '', iv: IV, climate, clock: { month: 11, hour: 8 },
    sunNow: null, heatTairC: null, ...extra });
  for (const sunNow of SUN_NOW) {
    const p = currentParams(st({ sunNow }));
    points.push({ kind: 'day', air, rh, cloud, wind, sunNow, taper: dewpointTaper(p, rh), L: p.L });
  }
  const n = currentParams(st({ phase: 'night' }));
  points.push({ kind: 'night', air, rh, cloud, wind, sunNow: 0, taper: dewpointTaper(n, rh), L: n.L });
}

const doc = JSON.stringify({
  note: 'TS oracle for scripts/check-dewpoint-taper-parity.py; regenerate with scripts/dump-dewpoint-taper-parity.mjs',
  points,
}, null, 1) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(FILE, 'utf8') !== doc) { console.error('tests/fixtures/dewpoint-taper/ts-oracle.json is stale'); process.exit(1); }
  console.log('dewpoint-taper ts-oracle current');
} else { writeFileSync(FILE, doc); console.log(`wrote ${FILE} (${points.length} points)`); }
