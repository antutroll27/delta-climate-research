/**
 * The hard-coded copy that restates Ballygunge's figures, re-derived from the
 * artefacts so it cannot go stale silently again. Until 2026-10-03 the landing page
 * said "3,527 real buildings" (the old 1,400 m box) and the standards matrix
 * "12,767" (three boxes), a week after Ballygunge became KMC Ward 68.
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { SPATIAL } from '../../src/scripts/climate-engine/accuracy.ts';

const read = (rel) => readFile(new URL(`../../${rel}`, import.meta.url), 'utf8');
const json = async (rel) => JSON.parse(await read(rel));
const fmt = (n) => n.toLocaleString('en-GB');

test('the landing page states the ward figures the artefacts hold', async () => {
  const mask = await json('public/heat-map/data/ballygunge-ward.json');
  const others = await Promise.all(['barrackpore', 'baruipur'].map((w) => json(`public/heat-map/data/${w}-provenance.json`)));
  const wardFigures = mask.inWardCount + others.reduce((a, p) => a + p.count, 0);
  const obos = await read('src/components/sections/Obos.astro');
  assert.ok(obos.includes(`'${fmt(wardFigures)} real buildings across three Kolkata study areas`),
    `the OBOS row should state ${fmt(wardFigures)} buildings (Ward 68 by its boundary + the two boxes)`);
  assert.ok(obos.includes(`Ballygunge · KMC Ward 68 &nbsp;·&nbsp; ${fmt(mask.inWardCount)} real buildings`),
    `the console caption should state Ward 68's ${fmt(mask.inWardCount)} buildings`);
  assert.ok(obos.includes(`validated against ${SPATIAL.n} ECOSTRESS thermal scenes`),
    `the OBOS row's scene count is not accuracy.ts SPATIAL.n (${SPATIAL.n})`);
  /* The Studies card restates the same count (85 since Ward 68's re-measurement, 87 before). */
  assert.ok((await read('src/components/sections/Studies.astro')).includes(`${SPATIAL.n} ward-scenes`),
    `the Studies card's scene count is not accuracy.ts SPATIAL.n (${SPATIAL.n})`);
});

test('the standards matrix states the buildings the 3D tilesets carry', async () => {
  let drawn = 0;
  for (const w of ['ballygunge', 'baruipur', 'barrackpore']) drawn += (await json(`public/heat-map/data/${w}-provenance.json`)).count;
  assert.ok((await read('src/scripts/standards/matrix.ts')).includes(`${fmt(drawn)} LoD1 buildings`),
    `matrix.ts should state the ${fmt(drawn)} buildings the tilesets ship`);
});

test('no source file still states the old 1,400 m box\'s 3,527 buildings', async () => {
  const offenders = [];
  const walk = async (dir) => {
    for (const e of await readdir(new URL(`../../${dir}`, import.meta.url), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) await walk(rel);
      else if (/\.(ts|astro|mjs)$/.test(e.name) && /\b3,?527\b/.test(await read(rel))) offenders.push(rel);
    }
  };
  await walk('src');
  assert.deepEqual(offenders, [], 'a source file still restates the old box\'s building count');
});
