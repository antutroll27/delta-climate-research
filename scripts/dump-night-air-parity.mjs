/**
 * The TypeScript side of the night-air parity gate: what src/lib/weather/night-air.ts says about
 * each of the 49 Kolkata night scenes. Writes tests/fixtures/night-air/ts-oracle.json.
 *
 *   node --import tsx scripts/dump-night-air-parity.mjs [--check]
 *
 * Input tests/fixtures/night-air/rows-night-49.json (the scenes: pass instant, ward, the airport
 * air the product read). `--check` compares with the committed oracle instead of writing it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nightAirOffsetK, istMonth, sunAt } from '../src/lib/weather/night-air.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'tests/fixtures/night-air');
const rows = JSON.parse(readFileSync(join(DIR, 'rows-night-49.json'), 'utf8'));

const POWER_LON = 88.37;
const out = rows.rows.map((r) => {
  const ms = Date.parse(`${r.utc}Z`);
  const sun = sunAt(ms, r.lat, POWER_LON);
  const offsetK = nightAirOffsetK('VECC', ms, sun);
  return { rid: r.rid, month: istMonth(ms), sun, offsetK, airUsed: r.air - offsetK };
});
// instants that exercise the edges the 49 night scenes do not: day, dusk, month turn, IST midnight
const probes = ['2025-11-10T06:00:00', '2025-11-10T11:55:00', '2025-11-10T12:05:00', '2025-01-31T18:29:00',
  '2025-01-31T18:30:00', '2025-06-15T00:30:00', '2025-06-15T22:00:00', '2026-03-05T23:46:24'].map((u) => {
  const ms = Date.parse(`${u}Z`);
  const sun = sunAt(ms, 22.55, POWER_LON);
  return { utc: u, month: istMonth(ms), sun, offsetK: nightAirOffsetK('VECC', ms, sun) };
});
const doc = JSON.stringify({ note: 'TS oracle for scripts/check-night-air-parity.py; regenerate with scripts/dump-night-air-parity.mjs', rows: out, probes }, null, 1) + '\n';
const path = join(DIR, 'ts-oracle.json');
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== doc) { console.error('tests/fixtures/night-air/ts-oracle.json is stale'); process.exit(1); }
  console.log('night-air ts-oracle current');
} else { writeFileSync(path, doc); console.log(`wrote ${path} (${out.length} rows, ${probes.length} probes)`); }
