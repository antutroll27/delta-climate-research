// Checks the LIVE city-data Worker's CORS policy (network; not part of `npm run test:unit`).
//
//   node scripts/check-city-worker-cors.mjs              # production + a Vercel preview origin are echoed; an arbitrary origin gets nothing
//   node scripts/check-city-worker-cors.mjs --tightened  # also: a preview from ANOTHER Vercel team gets nothing (after the R8 allowlist is deployed)
//   node scripts/check-city-worker-cors.mjs <worker-url> # check another deployment of the Worker (default: the one in the committed manifest)
//
// It requests one layer file named by public/heat-map/data/ams-r2-manifest.json with each Origin and reads Access-Control-Allow-Origin.
// Exit 0 when every assertion holds, 1 otherwise. Needs Node 18+ (global fetch); no dependencies.
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../public/heat-map/data/ams-r2-manifest.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
const tightened = args.includes('--tightened');
const base = (args.find((a) => a.startsWith('http')) ?? manifest.baseUrl).replace(/\/+$/, '');
const file = Object.keys(manifest.files).find((f) => f === 'ams-f4.json') ?? Object.keys(manifest.files)[0];
const url = `${base}/${manifest.prefix}/${file}`;

const PRODUCTION = 'https://deltaclimate.earth';
const PREVIEW = 'https://delta-climate-research-git-feat-ci-abc123-antutroll27s-projects.vercel.app';   // the real form: git-<branch, truncated>-<6 hex>-<team>
const CASES = [
  { origin: PRODUCTION, allowed: true, why: 'production' },
  { origin: PREVIEW, allowed: true, why: 'a Vercel preview of this team' },
  { origin: 'https://evil.example', allowed: false, why: 'an arbitrary origin' },
  ...(tightened ? [{ origin: 'https://delta-climate-research-git-x-otherteam.vercel.app', allowed: false, why: 'a preview from another Vercel team' }] : []),
];

let failed = 0;
console.log(`GET ${url}`);
for (const { origin, allowed, why } of CASES) {
  const response = await fetch(url, { headers: { Origin: origin } });
  await response.body?.cancel();
  const acao = response.headers.get('access-control-allow-origin');
  const ok = response.ok && (allowed ? acao === origin : acao === null);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${why}: Origin ${origin} -> HTTP ${response.status}, Access-Control-Allow-Origin ${acao === null ? '(none)' : acao}${allowed ? ` (expected ${origin})` : ' (expected none)'}`);
}
if (failed > 0) { console.error(`${failed} check${failed === 1 ? '' : 's'} failed`); process.exit(1); }
console.log('Worker CORS: all checks passed');
