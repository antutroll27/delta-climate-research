import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  AREA_KEYS, PUBLIC_AREA_KEYS, REGISTRY, areaKeysInCity, isPublicArea, splitKey,
} from '../../src/scripts/climate-engine/scope/registry.ts';
import {
  areaPageIndexable, publicAreaPaths,
} from '../../src/scripts/climate-engine/scope/public-routes.ts';
import { areaPath } from '../../src/scripts/climate-engine/scope/paths.ts';

/**
 * NOTHING ABOUT DUBAI IS PUBLISHED.
 *
 * Founder's decision, 2026-09-05, re-confirmed 2026-11-06: "take it off of the
 * site". The Dubai registry entries STAY in code -- the scope code relies on
 * naming it, and other tests use it -- so the guarantee cannot be "Dubai is not in
 * the registry". It is "nothing that PUBLISHES reads the part of the registry that
 * holds it". This file walks every publishing surface and asserts the word and the
 * route prefix are absent.
 *
 * The surfaces: the generated static paths, the sitemap rule, the scope switcher's
 * rail links, and which registry list each page and component reads. The copy
 * scan (landing text, attribution, standards matrix) is no-public-dubai-copy.
 */

const ROOT = new URL('../../', import.meta.url).pathname;
const BANNED = /dubai|\/ae\/|\bwsf3d\b/i;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/* Strips the three comment forms that never reach a reader. `//` only counts at a
   line start or after whitespace, so `https://` survives. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

test('the registry still NAMES Dubai (the scope code relies on it) but the gate excludes it', () => {
  assert.ok(AREA_KEYS.includes('ae/dubai/creek'), 'Dubai left the registry -- the scope code needs to name it');
  assert.equal(AREA_KEYS.length, 9);
  assert.equal(PUBLIC_AREA_KEYS.length, 6, 'the public set is Kolkata (3) + Bengaluru (3)');
  assert.deepEqual(
    [...PUBLIC_AREA_KEYS].sort(),
    AREA_KEYS.filter((k) => !k.startsWith('ae/')).sort(),
  );
  for (const key of AREA_KEYS) {
    assert.equal(isPublicArea(key), PUBLIC_AREA_KEYS.includes(key));
  }
  assert.equal(isPublicArea('ae/dubai/creek'), false);
  assert.equal(isPublicArea('in/kolkata/ballygunge'), true);
  assert.equal(isPublicArea('not/a/key'), false);
});

test('the gate is DERIVED from `drawable`: no second list to drift', () => {
  const src = readFileSync(join(ROOT, 'src/scripts/climate-engine/scope/registry.ts'), 'utf8');
  assert.match(src, /PUBLIC_AREA_KEYS[^=]*=\s*AREA_KEYS\.filter/, 'PUBLIC_AREA_KEYS is not filtered from AREA_KEYS');
  for (const key of AREA_KEYS) {
    const { country, city, area } = splitKey(key);
    assert.equal(
      PUBLIC_AREA_KEYS.includes(key),
      REGISTRY[country].cities[city].areas[area].drawable,
      `${key}: public and drawable disagree`,
    );
  }
});

test('every generated static path is a public area, and none mentions Dubai or /ae/', () => {
  const paths = publicAreaPaths();
  assert.equal(paths.length, PUBLIC_AREA_KEYS.length);
  for (const p of paths) {
    assert.ok(!BANNED.test(p), `static path ${p} names Dubai`);
    assert.ok(!p.startsWith('/heat-map/ae/'), `static path ${p} is under /ae/`);
  }
  // …and the page's own getStaticPaths is the one reading the gate, not the full registry.
  const page = readFileSync(join(ROOT, 'src/pages/heat-map/[country]/[city]/[area].astro'), 'utf8');
  const gsp = /export function getStaticPaths\(\) \{([\s\S]*?)\n\}/.exec(page)?.[1] ?? '';
  assert.match(gsp, /PUBLIC_AREA_KEYS/, 'getStaticPaths does not read PUBLIC_AREA_KEYS');
  assert.doesNotMatch(gsp, /\bAREA_KEYS\b(?<!PUBLIC_AREA_KEYS)/, 'getStaticPaths reads the full registry');
});

test('the sitemap rule publishes no Dubai path, whatever the registry holds', () => {
  for (const key of AREA_KEYS) {
    const verdict = areaPageIndexable(areaPath(key));
    if (key.startsWith('ae/')) {
      assert.equal(verdict, false, `${key} would be sitemapped`);
    }
  }
  // the guard must still let Kolkata through, or it would pass by excluding everything
  assert.equal(areaPageIndexable('/heat-map/in/kolkata/ballygunge/'), true);
  assert.equal(areaPageIndexable('/heat-map/in/bengaluru/mg-road/'), false);
  assert.equal(areaPageIndexable('/team/'), null, 'a non-area path must be left to the caller');
  const config = readFileSync(join(ROOT, 'astro.config.mjs'), 'utf8');
  assert.match(config, /areaPageIndexable\(/, 'astro.config.mjs does not use the shared sitemap rule');
});

test('every rail link (country, city and area options) is a public area', () => {
  for (const current of PUBLIC_AREA_KEYS) {
    for (const key of areaKeysInCity(current)) {
      assert.ok(isPublicArea(key), `${current}: area option ${key} is not public`);
      assert.ok(!BANNED.test(areaPath(key)), `${current}: rail link ${areaPath(key)} names Dubai`);
    }
  }
  // the switcher builds its country and city lists from the gate, never the full registry
  for (const f of [
    'src/components/ClimateEngine/shell/ScopeSwitcher.astro',
    'src/components/ClimateEngine/v2/HeatMapStageV2.astro',
  ]) {
    const src = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    assert.match(src, /PUBLIC_AREA_KEYS/, `${f} does not read the public gate`);
  }
});

test('no page or component reads the full registry list; only the gate', () => {
  const offenders = [];
  for (const dir of ['src/pages', 'src/components', 'src/layouts']) {
    for (const f of walk(join(ROOT, dir))) {
      if (!/\.(astro|ts|tsx)$/.test(f)) continue;
      const code = stripComments(readFileSync(f, 'utf8'));
      if (/(?<![A-Z_])AREA_KEYS\b/.test(code)) offenders.push(relative(ROOT, f));
    }
  }
  assert.deepEqual(offenders, [], 'these publish from AREA_KEYS (includes Dubai); use PUBLIC_AREA_KEYS');
});

test('the publication contract checker holds no Dubai route', () => {
  const src = readFileSync(join(ROOT, 'scripts/check-publication-contract.mjs'), 'utf8');
  assert.doesNotMatch(stripComments(src), /heat-map\/ae\//, 'the build checker still expects /heat-map/ae/ pages');
});
