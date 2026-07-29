#!/usr/bin/env node
/**
 * Guard against the vendored CBAM engine drifting from the GeoCBAM SaaS.
 *
 * WHY THIS EXISTS. src/scripts/cbam-algos/ is a COPY of the SaaS's regulatory
 * arithmetic. When it landed it was verified byte-identical and the commit said
 * so. Nine days later the SaaS gained indirect emissions and the de minimis
 * threshold, and this copy silently kept computing the old rules — understating
 * cement by 9.2% and quoting a four-figure cost to importers who may be exempt.
 * Nothing caught it; it was found by hand, by accident.
 *
 * Two checks, because they fail for different reasons:
 *   LOCAL EDIT  — a vendored file no longer matches its recorded hash. Someone
 *                 edited the copy, which is exactly what the copy must never be.
 *                 Runs everywhere, including CI, since the manifest is committed.
 *   UPSTREAM    — the SaaS has moved on. Only runs where the SaaS checkout is
 *                 reachable; skipped, not failed, on a build machine.
 *
 * The real fix is the portability dossier's §3 — extract the engine to a package
 * both consume. This is the tripwire until that happens.
 *
 *   node scripts/cbam-sync-check.mjs           check
 *   node scripts/cbam-sync-check.mjs --update  re-record hashes after a re-sync
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VENDORED = 'src/scripts/cbam-algos';
const MANIFEST = join(VENDORED, 'UPSTREAM.json');
const PACK = 'public/cbam/estimator-pack.json';
// Every file here is upstream's. cbam-app.ts is ours and is deliberately absent.
const FILES = [
  'cbam/certificate-estimate.ts', 'cbam/resolve-fa.ts', 'cbam/sector.ts', 'cbam/sefa.ts',
  'cbam/types.ts', 'errors/domain-error.ts', 'estimator/estimate-from-pack.ts',
  'regulatory/iso-3166.ts', 'regulatory/types.ts', 'threshold/aggregate.ts', 'threshold/evaluate.ts',
];
const UPSTREAM_LIB = process.env.CBAM_UPSTREAM_LIB ?? '/Volumes/VSTSAMPLES/Projects/CBM/lib';
const UPSTREAM_PACK = process.env.CBAM_UPSTREAM_PACK
  ?? '/Volumes/VSTSAMPLES/Projects/CBM/public/estimator-pack.json';

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);

if (process.argv.includes('--update')) {
  const files = Object.fromEntries(FILES.map((f) => [f, sha(join(VENDORED, f))]));
  const packGeneratedAt = JSON.parse(readFileSync(PACK, 'utf8')).generatedAt;
  writeFileSync(MANIFEST, `${JSON.stringify({ packGeneratedAt, files }, null, 2)}\n`);
  console.log(`recorded ${FILES.length} files · pack ${packGeneratedAt}`);
  process.exit(0);
}

let failed = false;
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

for (const f of FILES) {
  const got = sha(join(VENDORED, f));
  if (got !== manifest.files[f]) {
    console.error(`EDITED  ${f}  — vendored copies must never be edited in this repo`);
    failed = true;
  }
}
if (!failed) console.log(`vendored engine intact (${FILES.length} files match UPSTREAM.json)`);

const packAt = JSON.parse(readFileSync(PACK, 'utf8')).generatedAt;
if (packAt !== manifest.packGeneratedAt) {
  console.error(`PACK    generatedAt ${packAt} != recorded ${manifest.packGeneratedAt}`);
  failed = true;
}

if (!existsSync(UPSTREAM_LIB)) {
  console.log('upstream not reachable here — skipping the drift check (set CBAM_UPSTREAM_LIB)');
} else {
  const drifted = FILES.filter((f) =>
    existsSync(join(UPSTREAM_LIB, f)) && sha(join(VENDORED, f)) !== sha(join(UPSTREAM_LIB, f)));
  const missing = FILES.filter((f) => !existsSync(join(UPSTREAM_LIB, f)));
  if (drifted.length) {
    console.error(`\nDRIFT   ${drifted.length} file(s) differ from upstream:`);
    for (const f of drifted) console.error(`          ${f}`);
    console.error('        re-copy from the SaaS, run the tests, then --update');
    failed = true;
  }
  if (missing.length) console.error(`WARN    not found upstream: ${missing.join(', ')}`);
  if (existsSync(UPSTREAM_PACK)) {
    const up = JSON.parse(readFileSync(UPSTREAM_PACK, 'utf8')).generatedAt;
    if (up !== packAt) {
      console.error(`STALE   rule pack: ours ${packAt}, upstream ${up}`);
      failed = true;
    }
  }
  if (!failed) console.log('in sync with upstream engine and rule pack');
}

process.exit(failed ? 1 : 0);
