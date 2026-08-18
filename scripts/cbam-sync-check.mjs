#!/usr/bin/env node
/**
 * Verify the Astro CBAM engine is an exact copy of one reviewed upstream commit.
 *
 * The immutable commit is the source of truth. We do not compare against a moving
 * sibling checkout's HEAD: an unrelated upstream feature must not make this site
 * silently adopt new regulatory behaviour or make CI depend on a developer path.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VENDORED = 'src/scripts/cbam-algos';
const MANIFEST = join(VENDORED, 'UPSTREAM.json');
const PACK = 'public/cbam/estimator-pack.json';
const PACK_MANIFEST = 'public/cbam/estimator-pack.manifest.json';
const FILES = [
  'cbam/certificate-estimate.ts', 'cbam/input.ts', 'cbam/resolve-fa.ts', 'cbam/sector.ts',
  'cbam/sefa.ts', 'cbam/types.ts', 'errors/domain-error.ts',
  'estimator/estimate-from-pack.ts', 'estimator/load-pack.ts', 'estimator/pack-v2.ts',
  'regulatory/iso-3166.ts', 'regulatory/types.ts',
  'threshold/aggregate.ts', 'threshold/evaluate.ts',
];
const UPSTREAM_REPO = process.env.CBAM_UPSTREAM_REPO ?? '/Volumes/VSTSAMPLES/Projects/CBM';

const shaBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
const shaFile = (path) => shaBytes(readFileSync(path));

if (process.argv.includes('--update')) {
  const prior = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
  const upstreamCommit = process.env.CBAM_UPSTREAM_COMMIT ?? prior.upstreamCommit;
  if (!/^[0-9a-f]{40}$/.test(upstreamCommit ?? '')) {
    console.error('CBAM_UPSTREAM_COMMIT must be a full 40-character commit SHA');
    process.exit(1);
  }
  const files = Object.fromEntries(FILES.map((file) => [file, shaFile(join(VENDORED, file))]));
  const packManifest = JSON.parse(readFileSync(PACK_MANIFEST, 'utf8'));
  const record = {
    schemaVersion: 2,
    upstreamRepository: 'GeoCBAM/CBM',
    upstreamCommit,
    packSha256: shaFile(PACK),
    packManifestSha256: shaFile(PACK_MANIFEST),
    files,
  };
  if (record.packSha256 !== packManifest.packSha256) {
    console.error('refusing to record: estimator-pack.manifest.json does not seal the pack bytes');
    process.exit(1);
  }
  writeFileSync(MANIFEST, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`recorded ${FILES.length} files · upstream ${upstreamCommit.slice(0, 12)} · pack ${record.packSha256.slice(0, 12)}`);
  process.exit(0);
}

let failed = false;
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
if (manifest.schemaVersion !== 2 || !/^[0-9a-f]{40}$/.test(manifest.upstreamCommit ?? '')) {
  console.error('MANIFEST  UPSTREAM.json is not a supported immutable snapshot manifest');
  failed = true;
}

for (const file of FILES) {
  const expected = manifest.files?.[file];
  const got = shaFile(join(VENDORED, file));
  if (!/^[0-9a-f]{64}$/.test(expected ?? '') || got !== expected) {
    console.error(`EDITED  ${file} — expected ${expected ?? 'missing'}, got ${got}`);
    failed = true;
  }
}
if (!failed) console.log(`vendored engine intact (${FILES.length} files match the immutable manifest)`);

const packSha256 = shaFile(PACK);
const packManifestSha256 = shaFile(PACK_MANIFEST);
const browserManifest = JSON.parse(readFileSync(PACK_MANIFEST, 'utf8'));
if (packSha256 !== manifest.packSha256 || packSha256 !== browserManifest.packSha256) {
  console.error(`PACK     byte SHA mismatch — recorded ${manifest.packSha256}, manifest ${browserManifest.packSha256}, got ${packSha256}`);
  failed = true;
}
if (packManifestSha256 !== manifest.packManifestSha256) {
  console.error(`MANIFEST pack manifest edited — expected ${manifest.packManifestSha256}, got ${packManifestSha256}`);
  failed = true;
}

if (!existsSync(join(UPSTREAM_REPO, '.git'))) {
  console.log(`upstream checkout unavailable — local bytes remain pinned to ${manifest.upstreamCommit?.slice(0, 12)}`);
} else {
  for (const file of FILES) {
    try {
      const upstream = execFileSync('git', [
        '-C', UPSTREAM_REPO, 'show', `${manifest.upstreamCommit}:lib/${file}`,
      ], { maxBuffer: 64 * 1024 * 1024 });
      if (shaBytes(upstream) !== manifest.files[file]) {
        console.error(`UPSTREAM ${file} does not match commit ${manifest.upstreamCommit}`);
        failed = true;
      }
    } catch {
      console.error(`UPSTREAM cannot read lib/${file} at ${manifest.upstreamCommit}`);
      failed = true;
    }
  }
  try {
    const upstreamPack = execFileSync('git', [
      '-C', UPSTREAM_REPO, 'show', `${manifest.upstreamCommit}:public/estimator-pack.json`,
    ], { maxBuffer: 64 * 1024 * 1024 });
    if (shaBytes(upstreamPack) !== packSha256) {
      console.error('UPSTREAM estimator pack differs from the pinned commit');
      failed = true;
    }
  } catch {
    console.error(`UPSTREAM cannot read estimator pack at ${manifest.upstreamCommit}`);
    failed = true;
  }
  if (!failed) console.log(`in sync with reviewed upstream commit ${manifest.upstreamCommit.slice(0, 12)}`);
}

process.exit(failed ? 1 : 0);
