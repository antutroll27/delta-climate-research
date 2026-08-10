/**
 * Fail the build if the served DC-URS inputs differ from the source of truth.
 *
 * WHY THIS EXISTS. `data/dc-urs/inputs.json` is what the Python pipeline writes
 * and what gets reviewed in a diff. `public/heat-map/data/dc-urs-inputs.json` is
 * what the browser actually fetches. They are two files, and for one release
 * they disagreed: socioVuln was measured in the first and a placeholder zero in
 * the second. Every gate passed — mypy clean, astro check clean, build green,
 * deploy green — because not one of them compared the two files. Production
 * served zeros for an indicator that had been measured, and the page's own
 * honesty chip stayed hidden, because the served data said there was no gap.
 *
 * build-dcurs-inputs.py now writes both, so drift requires someone editing one
 * by hand. This makes that mistake loud instead of silent.
 *
 * Run: node scripts/verify-served-data.mjs   (wired into `npm run build`)
 */
import { readFileSync, existsSync } from 'node:fs';

const SOURCE = 'data/dc-urs/inputs.json';
const SERVED = 'public/heat-map/data/dc-urs-inputs.json';

const die = (msg) => { console.error(`\n  ✗ ${msg}\n`); process.exit(1); };

for (const p of [SOURCE, SERVED]) if (!existsSync(p)) die(`${p} is missing.`);

const source = readFileSync(SOURCE, 'utf8');
const served = readFileSync(SERVED, 'utf8');

if (source !== served) {
  const a = JSON.parse(source).wards, b = JSON.parse(served).wards;
  const drift = [];
  for (const w of Object.keys(a)) {
    for (const k of Object.keys(a[w])) {
      const x = a[w][k], y = b[w]?.[k];
      if (!y || x.value !== y.value || x.source !== y.source) {
        drift.push(`      ${w}.${k}: source has ${x.value} (${x.source}), `
                 + `served has ${y ? `${y.value} (${y.source})` : 'nothing'}`);
      }
    }
  }
  die(`${SERVED} is STALE — the browser would be served different numbers than\n`
    + `    ${SOURCE} records.\n\n`
    + (drift.length ? `${drift.slice(0, 12).join('\n')}\n\n` : '')
    + `    Fix: python3 scripts/build-dcurs-inputs.py   (it writes both)`);
}

// A placeholder on a field that carries score weight means the page is showing
// its most optimistic number. That is allowed — the UI discloses it — but it
// must never be silent, so say it here too.
const wards = JSON.parse(source).wards;
const ph = new Set();
for (const w of Object.values(wards))
  for (const [k, v] of Object.entries(w)) if (v.source === 'placeholder') ph.add(k);

const inert = new Set(['canopyFrac']);   // weight 0 in the v1 formula
const scoring = [...ph].filter((k) => !inert.has(k));

console.log(`  ✓ served DC-URS inputs match ${SOURCE}`
  + (scoring.length ? `\n  ! still placeholder and score-bearing: ${scoring.join(', ')}`
                    : `\n  ✓ every score-bearing indicator is measured`));

// Per-layer provenance manifests — the "receipts" spine. Every served ward must
// carry a complete {ward}-layers.json, or the receipts panel silently falls back
// to the hand-typed credit line. Ward list derives from the inputs above, never
// hardcoded (src/data/wards.ts's rule).
const EXPECTED_LAYERS = ['basemap', 'footprints', 'heights', 'surface', 'canopy', 'terrain', 'water', 'roads', 'lst', 'ambient'];
const provProblems = [];
for (const ward of Object.keys(wards)) {
  const p = `public/heat-map/data/${ward}-layers.json`;
  if (!existsSync(p)) { provProblems.push(`      ${ward}: missing ${p}`); continue; }
  let m;
  try { m = JSON.parse(readFileSync(p, 'utf8')); } catch { provProblems.push(`      ${ward}: ${p} is not valid JSON`); continue; }
  const ids = new Set((m.layers ?? []).map((l) => l.id));
  const missing = EXPECTED_LAYERS.filter((id) => !ids.has(id));
  if (missing.length) provProblems.push(`      ${ward}: manifest missing layers ${missing.join(', ')}`);
  for (const l of m.layers ?? [])
    if (!l.source || !l.licence?.name || !(l.lineage?.length))
      provProblems.push(`      ${ward}/${l.id}: a receipt needs source + licence + lineage`);
}
if (provProblems.length)
  die(`per-layer provenance manifests are incomplete — the receipts panel would\n`
    + `    silently degrade to the static credit line.\n\n${provProblems.slice(0, 12).join('\n')}\n\n`
    + `    Fix: python3 scripts/build-provenance-manifest.py`);
console.log(`  ✓ per-layer provenance manifests complete (${Object.keys(wards).length} wards × ${EXPECTED_LAYERS.length} layers)`);
