import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  REGISTRY, AREA_KEYS, isAreaKey, splitKey, assertRegistryLogic,
  areaTableDrift, shippingAreaIds,
} from '../../src/scripts/climate-engine/scope/registry.ts';
import { paths, cityPaths } from '../../src/scripts/climate-engine/scope/paths.ts';
import { resolve, requireCosts } from '../../src/scripts/climate-engine/scope/resolve.ts';
import { WARDS as WARD_TABLE } from '../../src/data/wards.ts';
import { currentParams } from '../../src/scripts/climate-engine/heat-map-model.ts';
import { fmtMoney } from '../../src/scripts/climate-engine/money.ts';
import { tabKind, areaRefusal } from '../../src/scripts/climate-engine/scope/reachability.ts';

test('registry invariants hold', () => {
  assertRegistryLogic();
});

test('every registered area produces a key', () => {
  assert.ok(AREA_KEYS.includes('in/kolkata/ballygunge'));
  assert.ok(AREA_KEYS.includes('ae/dubai/al-quoz'));
  assert.equal(AREA_KEYS.length, 6);
});

test('isAreaKey rejects anything not registered', () => {
  assert.equal(isAreaKey('in/kolkata/ballygunge'), true);
  assert.equal(isAreaKey('in/kolkata/typo'), false);
  assert.equal(isAreaKey('ballygunge'), false);
  assert.equal(isAreaKey(''), false);
  assert.equal(isAreaKey(null), false);
});

test('splitKey returns the three parts', () => {
  assert.deepEqual(splitKey('in/kolkata/ballygunge'),
    { country: 'in', city: 'kolkata', area: 'ballygunge' });
});

test('Kolkata ships data and Dubai does not', () => {
  assert.equal(REGISTRY.in.cities.kolkata.areas.ballygunge.shipsData, true);
  assert.equal(REGISTRY.ae.cities.dubai.areas['al-quoz'].shipsData, false);
});

test('the registry does not become a fourth ward table', () => {
  // src/data/wards.ts is THE area table. scripts/_types.py mirrors it, and records
  // that five scripts once carried private copies which had already diverged --
  // one by 10-44 m of coordinate. Every data-shipping area must exist there, and
  // Kolkata's ids must match it exactly.
  const tableIds = WARD_TABLE.map((w) => w.id).sort();
  const kolkata = Object.keys(REGISTRY.in.cities.kolkata.areas).sort();
  assert.deepEqual(kolkata, tableIds);
  for (const key of AREA_KEYS) {
    const { country, city, area } = splitKey(key);
    if (REGISTRY[country].cities[city].areas[area].shipsData) {
      assert.ok(tableIds.includes(area), `${key} ships data but is not in src/data/wards.ts`);
    }
  }
});

test('the registry restates no geography', async () => {
  // Geography lives in src/data/wards.ts alone. If it appears here too, the two
  // can silently disagree -- which is the failure this whole design exists to stop.
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(
    new URL('../../src/scripts/climate-engine/scope/registry.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const banned of ['lat', 'lon', 'footprintM', 'veg']) {
    assert.ok(!new RegExp(`\\b${banned}\\s*:`).test(code),
      `registry.ts declares "${banned}" — geography belongs in src/data/wards.ts only`);
  }
});

test('an area outside Kolkata may ship data once the ward table describes it', () => {
  /* The premise of this whole design is that src/data/wards.ts is THE AREA TABLE,
     not "Kolkata's table". Check 7 first compared the table against Kolkata's areas
     alone, so the first non-Kolkata area to ship data failed it spuriously -- give
     Dubai's creek shipsData and add the ward row the check's own first half then
     demands, and it fired anyway. That would have blocked Task 3 onwards.

     This is that case. It must NOT report drift. It is exercised through the pure
     comparison rather than the shipped registry because no Dubai area ships data
     yet, which is exactly why the bug survived being written. */
  assert.equal(areaTableDrift(
    ['ballygunge', 'baruipur', 'barrackpore', 'creek'],
    ['ballygunge', 'baruipur', 'barrackpore', 'creek'],
  ), null);

  // ...while still catching real drift in BOTH directions.
  assert.ok(areaTableDrift(['ballygunge'], ['ballygunge', 'baruipur']),
    'a ward row that no area ships must be reported');
  assert.ok(areaTableDrift(['ballygunge', 'fake'], ['ballygunge']),
    'an area shipping data with no ward row must be reported');
  // order and duplication are not drift; the sets are what matter
  assert.equal(areaTableDrift(['b', 'a', 'a'], ['a', 'b']), null);
});

test('today, the areas shipping data are exactly the ward table', () => {
  // Covers the COLLECTION half that areaTableDrift's purity leaves untested.
  assert.deepEqual([...shippingAreaIds()].sort(), WARD_TABLE.map((w) => w.id).sort());
});

/* ---------------------------------------------------------------------------
   scope/paths.ts — the ONE place a /heat-map/data/ URL may be built.
   --------------------------------------------------------------------------- */

test('paths builds every ward URL from the registry', () => {
  const p = paths('in/kolkata/ballygunge');
  assert.equal(p.ward, '/heat-map/data/ballygunge.json');
  assert.equal(p.terrain, '/heat-map/data/ballygunge-terrain.json');
  assert.equal(p.water, '/heat-map/data/ballygunge-water.json');
  assert.equal(p.roads, '/heat-map/data/ballygunge-roads.json');
  assert.equal(p.labels, '/heat-map/data/ballygunge-road-labels.geojson');
  assert.equal(p.provenance, '/heat-map/data/ballygunge-provenance.json');
  assert.equal(p.trees, '/heat-map/data/ballygunge-trees.json');
  assert.equal(p.surface, '/heat-map/data/ballygunge-surface.png');
  assert.equal(p.canopy, '/heat-map/data/ballygunge-canopy.png');
  assert.equal(p.layers, '/heat-map/data/ballygunge-layers.json');
});

test('an area that ships no data resolves to null, never a URL', () => {
  // A disabled city must be unreachable BY CONSTRUCTION, so it cannot 404 in
  // the console and cannot half-render.
  assert.equal(paths('ae/dubai/al-quoz'), null);
  assert.equal(paths('ae/dubai/creek'), null);
  assert.equal(paths('ae/dubai/south'), null);
});

test('city-level files are city-scoped, not global', () => {
  // heatwave-percentiles.json carries a `city` key and dc-urs-inputs.json a
  // `wards` key -- both Kolkata's -- at paths that imply they are global. A
  // second city would silently inherit Kolkata's heat statistics.
  assert.equal(cityPaths('in/kolkata/ballygunge').heatwave,
    '/heat-map/data/heatwave-percentiles.json');
  assert.equal(cityPaths('in/kolkata/ballygunge').dcUrs,
    '/heat-map/data/dc-urs-inputs.json');
  assert.equal(cityPaths('ae/dubai/al-quoz').heatwave, null);
  assert.equal(cityPaths('ae/dubai/al-quoz').dcUrs, null);
});

test('every URL paths() emits exists on disk', async () => {
  // A typo in a suffix would produce a plausible URL that 404s silently at
  // runtime. This is the check that makes the builder trustworthy.
  const present = new Set(await readdir(new URL('../../public/heat-map/data', import.meta.url)));
  let checked = 0;
  for (const key of AREA_KEYS) {
    const p = paths(key);
    if (p === null) continue;
    for (const [name, url] of Object.entries(p)) {
      const file = url.replace('/heat-map/data/', '');
      assert.ok(present.has(file), `${key}: ${name} -> ${file} is missing on disk`);
      checked += 1;
    }
  }
  // Guard the guard: if paths() ever returned {} or every area stopped
  // shipping, the loop above would pass while checking nothing.
  assert.equal(checked, 30, 'expected 3 shipping areas x 10 files');
});

test('every city-level URL exists on disk too', async () => {
  const present = new Set(await readdir(new URL('../../public/heat-map/data', import.meta.url)));
  let checked = 0;
  for (const key of AREA_KEYS) {
    for (const url of Object.values(cityPaths(key))) {
      if (url === null) continue;
      assert.ok(present.has(url.replace('/heat-map/data/', '')), `${url} is missing on disk`);
      checked += 1;
    }
  }
  assert.ok(checked > 0, 'no city-level URL was checked');
});


/* ---------------------------------------------------------------------------
   scope/resolve.ts -- the ONE place an area key becomes numbers.

   The constants these tests watch used to be literals inside heat-map-model.ts,
   and the transitional parity test that stood here watched the registry's copy of
   them while both existed. Both copies are gone; the registry is the only source,
   and what needs guarding now is the OTHER direction -- that the physics still
   cannot see where its numbers came from.
   --------------------------------------------------------------------------- */

/**
 * Source with comments removed, so a tripwire greps CODE and not prose.
 *
 * THE LINE-COMMENT PATTERN MUST NOT MATCH THE `//` IN `https://`. It used to
 * match a bare double-slash followed by anything up to the newline, which
 * truncates at the FIRST double-slash on a line and deletes the rest with it.
 * (The old pattern is not quoted here: a regex ending in star-slash closes this
 * very comment, which is how the first attempt at this note broke the file.)
 * MEASURED miss:
 *
 *     const b = 'https://x.com'; const u = `/heat-map/data/${n}.json`;
 *
 * -- a genuine hand-built data URL, invisible because a same-line absolute URL
 * swallowed it. FOUR tripwires share this helper (the data-URL guard, the
 * layering check, the place-names check and the migrated-constants check), so
 * the same blind spot was in all of them. `(^|[^:])` keeps `://` out of it.
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');

const engineSource = (name) =>
  readFile(new URL(`../../src/scripts/climate-engine/${name}`, import.meta.url), 'utf8');

test('resolve turns a key into a whole scope', () => {
  const s = resolve('in/kolkata/ballygunge');
  assert.equal(s.key, 'in/kolkata/ballygunge');
  assert.deepEqual(s.country, { id: 'in', name: 'India' });
  // deepEqual, so a field ADDED to the resolved city has to be acknowledged here
  // rather than arriving unnoticed. `tz` did exactly that: it was the fifth scoped
  // constant, and it reached this shape by failing this line.
  assert.deepEqual(s.city, { id: 'kolkata', name: 'Kolkata', koppen: 'Aw', tz: 'Asia/Kolkata' });
  assert.equal(s.tier, 'validated');
  // The ward table's `name` carries <em> for the wordmark's stress. It is display
  // markup, and a scope that passed it through would put raw tags in a page title.
  assert.equal(s.area.name, 'Ballygunge');
  assert.equal(s.area.descriptor, 'Urban Core · Ward 68');
  assert.equal(s.area.hasData, true);
});

test('the area name comes from the ward table, never from a second copy', () => {
  // src/data/wards.ts is THE area table. If a name were also written in the
  // registry the two could disagree, which is the divergence the whole design
  // exists to stop -- so resolve reads across rather than restating.
  for (const w of WARD_TABLE) {
    const s = resolve(`in/kolkata/${w.id}`);
    assert.equal(s.area.name, w.name.replace(/<[^>]*>/g, ''));
    assert.equal(s.area.descriptor, w.zone);
    assert.ok(!/[<>]/.test(s.area.name), `${w.id} leaked display markup into its name`);
  }
});

test('an area outside the ward table carries its own name and says what it is', () => {
  const s = resolve('ae/dubai/al-quoz');
  assert.deepEqual(s.country, { id: 'ae', name: 'United Arab Emirates' });
  assert.equal(s.city.name, 'Dubai');
  assert.equal(s.area.name, 'Al Quoz');
  // "area · our tiling", not "ward": these are our own tiles, not municipal units.
  assert.equal(s.area.descriptor, 'area · our tiling');
  assert.equal(s.area.hasData, false);
  assert.equal(s.tier, 'geometry');
});

test('every registered key resolves', () => {
  // The module resolves all six eagerly at load, so this is really a check that
  // nothing in the walk is unreachable -- and that the count has not silently
  // shrunk, which would make the loop pass while covering less.
  assert.equal(AREA_KEYS.length, 6);
  for (const key of AREA_KEYS) assert.equal(resolve(key).key, key);
});

test('resolve refuses a key the registry does not know', () => {
  // The type cannot police a value cast in from a URL. Returning null instead
  // would let a typo read as a disabled city.
  assert.throws(() => resolve('in/kolkata/typo'), /not a registered area key/);
});

test('the climate constants are the registry\'s, not a copy', () => {
  const c = resolve('in/kolkata/ballygunge').climate;
  assert.equal(c.fallbackTairC, REGISTRY.in.cities.kolkata.fallbackTairC);
  assert.equal(c.parkRadiusM, REGISTRY.in.cities.kolkata.parkRadiusM);
  assert.deepEqual(c.costs, REGISTRY.in.costs);
  // The pathway NAME becomes a delta table here and nowhere else. The registry's
  // own comment spells out the trap: indexing a delta table with the name
  // type-checks clean as a number, evaluates to undefined and propagates NaN.
  assert.equal(REGISTRY.in.pathway, 'dhara2025');
  assert.deepEqual(c.pathDelta, { '2025': 0, ssp245: 1.25, ssp585: 4.1 });
});

test('a country with no pathway gets an EMPTY table, and no costs at all', () => {
  const c = resolve('ae/dubai/creek').climate;
  // Empty, not zero-filled: "no projection has been adopted" is a different fact
  // from "the projection is zero warming", and currentParams reads the difference.
  assert.deepEqual(c.pathDelta, {});
  assert.equal(Object.keys(c.pathDelta).length, 0);
  assert.equal(c.costs, null, 'a rupee figure carried into the Gulf would compute and read as an answer');
  assert.equal(c.fallbackTairC, 40, 'Dubai is not 32 °C');
});

test('requireCosts hands over real prices, or refuses -- never a zero', () => {
  assert.equal(requireCosts(resolve('in/kolkata/ballygunge')).currency, 'INR');
  assert.throws(() => requireCosts(resolve('ae/dubai/creek')),
    /declares no intervention costs/);
});

test('a scope is frozen, so one caller cannot move another\'s pathway', () => {
  // resolve returns a shared object per key. A mutable pathDelta would let any
  // consumer shift the warming table for the whole session.
  const a = resolve('in/kolkata/ballygunge').climate;
  assert.equal(a, resolve('in/kolkata/ballygunge').climate);
  assert.throws(() => { a.pathDelta.ssp585 = 99; }, TypeError);
});

/* ── the fail-closed pathway lookup ──────────────────────────────────────────
   The line this replaced was `PATH_DELTA[s.path] ?? 0`, which answered "no
   warming" both to a country that has adopted no projection and to a typo. The
   first is true; the second is a missing answer silently replaced by a wrong one,
   and it is invisible -- Record<string, number> with noUncheckedIndexedAccess off
   type-checks the lookup as a number. */

const IV0 = { trees: 0, roof: 0, parks: 0, facades: 0 };
const at = (climate, path) =>
  currentParams({ live: null, phase: 'peak', path, climate, iv: IV0 }).tAir;

test('an unknown pathway against a populated table THROWS', () => {
  const kolkata = resolve('in/kolkata/ballygunge').climate;
  assert.throws(() => at(kolkata, 'ssp858'), /not in this scope's table/);
  assert.throws(() => at(kolkata, ''), /not in this scope's table/);
  // `in` would find inherited members and multiply a function into the air
  // temperature as NaN; the lookup uses Object.hasOwn for exactly this.
  assert.throws(() => at(kolkata, 'toString'), /not in this scope's table/);
  // ...while the three real scenarios still resolve.
  assert.equal(at(kolkata, '2025'), 32);
  assert.equal(at(kolkata, 'ssp585'), 36.1);
});

test('a scope with no pathway contributes zero, and does not throw', () => {
  // Dubai has to be reachable. Zero warming is the honest answer where no regional
  // projection has been adopted -- and it is the empty TABLE that says so, not a
  // zero value, so the two cases stay distinguishable.
  const dubai = resolve('ae/dubai/creek').climate;
  assert.equal(at(dubai, '2025'), 40);
  assert.equal(at(dubai, 'ssp585'), 40);
  assert.equal(at(dubai, 'anything-at-all'), 40);
});

/* ── the layering, which is the whole point of the move ─────────────────────── */

const PHYSICS = ['heat-map-model.ts', 'dc-urs.ts', 'sim-ts.ts'];
/**
 * A place, or a country's MONEY. One pattern, because they are one defect.
 *
 * The money half is an extension paid for by a real miss. This read
 * /\b(kolkata|dubai|india|...)\b/ and certified that heat-map-model.ts named no
 * place -- while that same file exported `fmtCr`, which hardcoded THREE Indian
 * facts at once: the crore/lakh scale words, the `en-IN` digit grouping, and
 * (at its three call sites) a pasted rupee sign. None of those is a place name,
 * so the tripwire walked past all of them, and `Costs.currency` sat declared and
 * read by nothing while every readout on the page said the country's currency
 * out loud from a template literal.
 *
 * `INR` is banned HERE and not everywhere: scope/registry.ts declares it, which
 * is the point of the migration. What must never appear in a physics module is
 * any of the five -- the code, the symbol, the grouping locale, or either scale
 * word.
 */
const PLACE = /(\b(?:kolkata|dubai|india|ballygunge|baruipur|barrackpore|en-IN|INR|crore|lakh)\b|\u20b9)/gi;

test('the physics never imports identity', async () => {
  /* The model knows DATA and PARAMETERS, never IDENTITY -- that is what lets the
     same physics run over ground it has never seen. A single TYPE import from
     scope/ would be enough to break it, because the next reader would then have a
     precedent for a value import, and the type would already have made scope/ a
     build dependency of the physics.

     Comments are stripped first: heat-map-model.ts's own note NAMES the modules
     its four constants moved to, and a tripwire that fires on its own explanation
     gets deleted rather than heeded. */
  for (const name of PHYSICS) {
    assert.ok(!/scope\//.test(stripComments(await engineSource(name))),
      `${name} references scope/ in code -- the physics must not depend on identity`);
  }
});

test('the physics names no place and no currency, with one recorded exception', async () => {
  /* A place name in a physics module is a constant wearing a disguise: it is how
     PATH_DELTA and FALLBACK_TAIR got there in the first place, as "the" pathway and
     "the" fallback, meaning Kolkata's.

     dc-urs.ts is the exception, and it is MEASURED rather than waved through. Its
     two names are ids on the frozen GOLDEN cases (dc-urs-spec.md §7) -- worked
     examples the index is checked against, in a fixture, not values it reads. The
     exact set is pinned so a third place cannot join them quietly. */
  const found = async (name) => (stripComments(await engineSource(name)).match(PLACE) ?? []);
  assert.deepEqual(await found('heat-map-model.ts'), []);
  assert.deepEqual(await found('sim-ts.ts'), []);
  assert.deepEqual([...new Set(await found('dc-urs.ts'))].sort(),
    ['Ballygunge', 'Baruipur', 'ballygunge', 'baruipur'],
    'dc-urs.ts names a place outside its frozen GOLDEN fixture');
});

test('the four migrated constants are gone from the physics', async () => {
  // Not "moved and also kept". A leftover literal would shadow the parameter and
  // the whole migration would be a decoration -- goldens green, second city wrong.
  const code = stripComments(await engineSource('heat-map-model.ts'));
  for (const gone of ['COST', 'PATH_DELTA', 'FALLBACK_TAIR', 'PARK_R_M']) {
    assert.ok(!new RegExp(`\\b${gone}\\b`).test(code),
      `heat-map-model.ts still declares ${gone} -- it belongs to a country or a city`);
  }
  // ...and the physics takes them as parameters instead.
  assert.match(code, /parkRadiusM: number/, 'applyInterventions must take the radius');
  assert.match(code, /costs: Costs/, 'computeCost must take the unit prices');
  assert.match(code, /climate: ClimateConstants/, 'ScenarioState must carry the scope constants');
});


/* ────────────────────────────────────────────────────────────────────────────
   TASK 4 — the choke point has to STAY a choke point. ARMED IN TASK 6.

   The four offenders it was written against -- heat-map-app.ts, ward-loader.ts,
   surface-raster.ts, provenance.ts -- now take an AreaKey and build every URL
   through paths()/cityPaths(), so the guard below runs for real.

   The baseline test that stood here is DELETED, not updated. It asserted the
   offender list EQUALLED those four, and its whole purpose was to keep an honest
   record of the migration's starting point while the real guard was skipped. With
   the real guard armed that purpose is served better by the real guard: "exactly
   these four offend" and "nothing offends" cannot both hold, so keeping a rewritten
   version would mean asserting the empty list twice and pinning a historical fact
   that git already records. Its stated failure modes are both covered -- a list
   that SHRANK now means the guard passes, and a list that GREW fails the guard by
   name.
   ──────────────────────────────────────────────────────────────────────────── */

/** Files permitted to name the data directory, relative to the engine root. */
const PATH_ALLOWLIST = new Set(['scope/paths.ts']);

/**
 * The one pattern. EXPORTED-BY-SHARING, not re-typed.
 *
 * The guard-the-guard test below used to declare its own copy of this regex and
 * assert against that. MEASURED: replacing the walker's pattern with
 * /NEVER_MATCHES_ANYTHING/ and dropping a real offender into the engine left
 * BOTH tests green -- the choke point wide open, the suite reporting clean.
 * That is the sixth guard in this migration to watch a copy of the thing
 * instead of the thing.
 */
const DATA_URL = /['"`]\/heat-map\/data\//;

async function dataUrlOffenders(root = new URL('../../src/scripts/climate-engine/', import.meta.url)) {
  const offenders = [];
  const walk = async (dir, prefix) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const next = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) { await walk(next, `${prefix}${entry.name}/`); continue; }
      // `._` files are AppleDouble sidecars: exFAT artefacts, not source.
      if (!entry.name.endsWith('.ts') || entry.name.startsWith('._')) continue;
      const rel = `${prefix}${entry.name}`;
      if (PATH_ALLOWLIST.has(rel)) continue;
      /* Comments are stripped first: three modules legitimately DOCUMENT the
         data directory, and a guard that cries wolf on documentation gets
         weakened or deleted, which is how the real check dies. */
      if (DATA_URL.test(stripComments(await readFile(next, 'utf8')))) offenders.push(rel);
    }
  };
  await walk(root, '');
  return offenders.sort();
}

test('no module builds a /heat-map/data URL by hand', async () => {
  assert.deepEqual(await dataUrlOffenders(), [],
    'these modules build a data URL by hand; use paths() from scope/paths.ts');
});

test('the guard would still catch a NEW hand-built URL', async () => {
  /* Guard the guard, THROUGH THE REAL FUNCTION.
     dataUrlOffenders walks a directory, strips comments and greps -- three steps,
     each of which can silently stop finding anything. The previous version tested
     a re-typed copy of the pattern, so it exercised none of the three: not the
     walk, not the stripper, not the pattern the walker actually uses. It is
     driven over a temporary fixture tree instead, so all three run. */
  const dir = await mkdtemp(join(tmpdir(), 'obos-guard-'));
  try {
    await mkdir(join(dir, 'nested'), { recursive: true });
    const write = (rel, body) => writeFile(join(dir, rel), body, 'utf8');

    // the four spellings a real regression arrives in, one per file so the
    // offender list names each independently
    await write('a.ts', 'fetch(`/heat-map/data/${name}-trees.json`)');
    await write('b.ts', "fetch('/heat-map/data/dc-urs-inputs.json')");
    await write('c.ts', 'fetch("/heat-map/data/heatwave-percentiles.json")');
    await write(join('nested', 'd.ts'), 'const D = `/heat-map/data/`;');
    // ...and the case the old stripper ATE: a real offender hidden behind a
    // same-line https://, which truncated the line before the grep saw it.
    await write('e.ts', "const b = 'https://x.com'; const u = `/heat-map/data/${n}.json`;");

    // must NOT fire: documentation, and the migrated call style
    await write('doc.ts', '// this module once fetched /heat-map/data/x.json\nexport const ok = 1;');
    await write('clean.ts', 'fetch(p.trees, { signal });');
    await write('skip.md', 'fetch("/heat-map/data/not-typescript.json")');

    assert.deepEqual(await dataUrlOffenders(new URL(`file://${dir}/`)),
      ['a.ts', 'b.ts', 'c.ts', 'e.ts', 'nested/d.ts'],
      'the walk, the comment stripper, or the pattern has stopped finding offenders');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/* ---------------------------------------------------------------------------
   TASK 9 — the two axes, and the area that cannot be fetched.
   --------------------------------------------------------------------------- */

test('city tier and phase confidence are two axes, not one', async () => {
  /* THE PROPERTY THIS PROTECTS. Kolkata is tier 'validated' -- we hold ECOSTRESS
     for it -- AND its daytime phase is only 'indicative', because noon surface
     temperature depends on insolation, cloud timing and soil moisture that 50 km
     reanalysis forcing cannot resolve. Those are different claims about
     different things: one is "have we measured this CITY", the other is "how
     well does the model do at this TIME OF DAY".

     Collapsing them into one field would either promote Kolkata's midday to a
     quantitative claim it has not earned, or demote its nights, which ARE
     quantitative at 2.93 K over 50 ward-scenes. The distinction was paid for in
     79 overpass scenes and is the thing the WETEX pitch rests on -- Kolkata
     validated, Dubai zone-calibrated, and the gap between them named out loud. */
  const [{ ACCURACY }, { resolve: res }] = await Promise.all([
    import('../../src/scripts/climate-engine/accuracy.ts'),
    import('../../src/scripts/climate-engine/scope/resolve.ts'),
  ]);

  const kolkata = res('in/kolkata/ballygunge');
  assert.equal(kolkata.tier, 'validated');
  assert.equal(ACCURACY.peak.confidence, 'indicative');
  assert.equal(ACCURACY.night.confidence, 'quantitative');

  // A validated city with an indicative phase is the LIVE combination. If the
  // two ever merge, this pair becomes unrepresentable and the assertion breaks.
  assert.notEqual(kolkata.tier, ACCURACY.peak.confidence);

  /* The vocabularies must not overlap -- a shared token is how two concepts
     quietly become one during a later refactor.

     READ FROM THE DECLARATIONS, NOT FROM A COPY OF THEM. This first compared
     two hardcoded Sets, and MEASURED: redefining CityTier to
     'quantitative' | 'indicative' | 'geometry' -- literally merging the two
     axes -- left all 32 tests green, because the literals in the test were
     unchanged. A guard that keeps passing while guarding nothing is the exact
     defect this suite exists to police, and it had it. */
  const union = (src, name) => {
    const m = new RegExp(`type\\s+${name}\\s*=\\s*([^;]+);`).exec(src);
    assert.ok(m, `could not find the declaration of ${name}`);
    return new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  };
  const [resolveSrc, accuracySrc] = await Promise.all([
    readFile(new URL('../../src/scripts/climate-engine/scope/resolve.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../src/scripts/climate-engine/accuracy.ts', import.meta.url), 'utf8'),
  ]);
  const tiers = union(resolveSrc, 'CityTier');
  const confRe = /readonly confidence:\s*([^;]+);/.exec(accuracySrc);
  assert.ok(confRe, 'could not find PhaseAccuracy.confidence');
  const phases = new Set([...confRe[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));

  assert.ok(tiers.size >= 2 && phases.size >= 2, 'a vocabulary collapsed to one token');
  for (const t of tiers) {
    assert.ok(!phases.has(t),
      `"${t}" appears in BOTH CityTier and PhaseAccuracy.confidence -- the city `
      + 'axis and the time-of-day axis have merged');
  }

  // Dubai carries the weaker tier while sharing the same phase accuracy: the
  // phase figure is a property of the MODEL, not of the city.
  assert.equal(res('ae/dubai/al-quoz').tier, 'geometry');
});

test('an area that ships nothing is refused by the loader, not fetched', async () => {
  /* paths() returning null is only half the guarantee. The other half is that
     the loader ACTS on it: a disabled city must be unreachable by construction,
     so it cannot 404 in the console and cannot half-render from a partial
     bundle. Nothing here stubs fetch -- if the rejection were missing, this
     test would attempt a real request and fail differently, which is itself
     the signal. */
  const { loadArea } = await import('../../src/scripts/climate-engine/ward-loader.ts');
  await assert.rejects(() => loadArea('ae/dubai/al-quoz'),
    (err) => err instanceof Error
      // The message must NAME THE KEY. A bare "nothing to load" in a console
      // does not say which area, and six areas across two cities is exactly
      // when that matters.
      && err.message.includes('ae/dubai/al-quoz')
      && /ships no artefacts/i.test(err.message));

  // ...while a shipping area is NOT refused. Without this, a loader that
  // rejected everything would pass the assertion above and guard nothing.
  const shipping = loadArea('in/kolkata/ballygunge');
  await assert.doesNotReject(
    Promise.resolve(shipping).then(() => {}, (err) => {
      // A network failure under Node is fine and expected; a refusal is not.
      if (/ships no artefacts/i.test(String(err && err.message))) throw err;
    }));
});


/* ────────────────────────────────────────────────────────────────────────────
   THE FIFTH SCOPED CONSTANT — the city's clock zone.

   `WARD_TZ = 'Asia/Kolkata'` sat in heat-map-app.ts driving four Intl formatters
   and printed verbatim in the freshness tooltip. Its own comment argued for an
   IANA zone over a fixed +05:30 offset because an offset "is the first thing
   that breaks when a European or East Asian ward is added" — and then hardcoded
   the zone, which breaks one city sooner and more quietly.
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * A zone's offset from UTC at one instant, in minutes, THROUGH Intl.
 *
 * Formatting the wall-clock parts and re-composing them as UTC is the only way to
 * ask this question that actually exercises the zone database. Comparing two
 * printed clock strings would break across a date boundary — 23:30 in Kolkata and
 * 22:00 in Dubai are ninety minutes apart, and on the far side of midnight the
 * naive difference is minus one thousand three hundred and fifty.
 */
const zoneOffsetMinutes = (tz, instant) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const at_ = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(at_('year'), at_('month') - 1, at_('day'), at_('hour'), at_('minute'), at_('second'));
  return (asUtc - instant) / 60_000;
};

test('the two cities keep two clocks, exactly ninety minutes apart', () => {
  /* THE CHECK THAT A STRING COMPARISON CANNOT MAKE.
     `assert.equal(scope.city.tz, 'Asia/Dubai')` proves a literal was copied from
     the registry into this file and nothing else — it passes just as happily if
     the value is a decoration nothing formats with. This formats ONE instant in
     both zones, through the zone database, and asserts the gap.

     Ninety minutes is a fact about the world, not about this codebase: IST is
     UTC+5:30, Gulf Standard Time is UTC+4, and neither observes DST, so the gap is
     constant and the assertion needs no date caveat. It appears in no source file,
     so there is no way for a change to the registry to move this literal with it —
     which is the trap six guards in this migration fell into. Point Dubai at
     Kolkata's zone and the difference is zero. */
  const kolkata = resolve('in/kolkata/ballygunge').city.tz;
  const dubai = resolve('ae/dubai/creek').city.tz;
  const instant = Date.parse('2026-08-27T00:00:00Z');
  assert.equal(zoneOffsetMinutes(kolkata, instant) - zoneOffsetMinutes(dubai, instant), 90,
    'the two cities resolve to the same clock — a second city is reading Kolkata\'s hour');

  /* Two instants six months apart, because a hemisphere with DST would move and
     these two must not. This is what catches a zone swapped for a neighbour that
     happens to share an offset in August. */
  const january = Date.parse('2026-01-15T00:00:00Z');
  assert.equal(zoneOffsetMinutes(kolkata, january), zoneOffsetMinutes(kolkata, instant));
  assert.equal(zoneOffsetMinutes(dubai, january), zoneOffsetMinutes(dubai, instant));

  // ...and every registered city resolves to a zone the database actually knows.
  for (const key of AREA_KEYS) {
    const { tz } = resolve(key).city;
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en-GB', { timeZone: tz }), `${key}: ${tz}`);
  }
});

test('the registry refuses an offset dressed up as a zone', () => {
  /* Check 9 exists because "does Intl accept it" is NOT the test. MEASURED:
     `new Intl.DateTimeFormat('en-GB', { timeZone: '+05:30' })` constructs without
     complaint and resolves to '+05:30'. A fixed offset — the exact thing the old
     WARD_TZ comment warned against — would pass a construct-and-see check and then
     be an hour wrong twice a year in any city that keeps DST. So check 9 tests the
     SHAPE first, and this is the measurement that says it has to. */
  assert.doesNotThrow(() => new Intl.DateTimeFormat('en-GB', { timeZone: '+05:30' }),
    'if Intl ever starts REFUSING offsets, check 9\'s shape test is redundant and this note is stale');
});

/**
 * IANA area names, as they appear in code.
 *
 * Deliberately the AREA list rather than a `Word/Word` shape: a generic pattern
 * matches half the string literals in a web app — MIME types, module specifiers,
 * every URL path — so it would have to be neutered to be usable, and a neutered
 * tripwire is the thing this suite keeps finding.
 */
const TZ_LITERAL = /['"`](?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_+-]+['"`]/;

/** Every .ts under the engine root, relative to it. Shared by the two tripwires below. */
async function engineFiles(root, prefix = '') {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const next = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, root);
    if (entry.isDirectory()) { found.push(...await engineFiles(next, `${prefix}${entry.name}/`)); continue; }
    // `._` files are AppleDouble sidecars: exFAT artefacts, not source.
    if (!entry.name.endsWith('.ts') || entry.name.startsWith('._')) continue;
    found.push([`${prefix}${entry.name}`, next]);
  }
  return found;
}

const ENGINE_ROOT = new URL('../../src/scripts/climate-engine/', import.meta.url);

test('only the registry names a clock zone', async () => {
  /* THE HALF THE NINETY-MINUTE TEST CANNOT REACH. That one proves the registry
     holds two real, distinct zones; it says nothing about whether anything READS
     them. This is the other half: the instrument may not name a zone at all, so a
     regression that re-pins the clock to 'Asia/Kolkata' fails here by name.

     Driven over the whole engine tree rather than the one file that offended,
     because the next hardcode will be in the next module. Comments are stripped —
     three of them explain this very rule, and a guard that fires on its own
     explanation gets deleted rather than heeded. */
  const allow = new Set(['scope/registry.ts']);
  const offenders = [];
  let allowedMatched = false;
  for (const [rel, url] of await engineFiles(ENGINE_ROOT)) {
    const hit = TZ_LITERAL.test(stripComments(await readFile(url, 'utf8')));
    if (allow.has(rel)) { allowedMatched ||= hit; continue; }
    if (hit) offenders.push(rel);
  }
  assert.deepEqual(offenders.sort(), [],
    'these modules name an IANA zone in code; read it from scope.city.tz instead');

  // Guard the guard: the allowlisted file must still MATCH, or the walk has
  // stopped finding anything and the empty list above means nothing.
  assert.ok(allowedMatched,
    'registry.ts no longer declares a zone in code — the pattern or the walk is broken');
});


/* ────────────────────────────────────────────────────────────────────────────
   THE CURRENCY — declared by the country, read by the readout.
   ──────────────────────────────────────────────────────────────────────────── */

/* A UAE cost basis DOES NOT EXIST and is not being invented here: the registry
   says `costs: null` for the UAE on purpose, because an AED figure we have not
   sourced would compute cleanly and read as an answer. This is a fixture, the same
   move `areaTableDrift`'s test makes — the case the registry is not yet, exercised
   before it is real, because that is precisely when the bug gets written. */
const AED_FIXTURE = { currency: 'AED', roofM2: 20, tree: 300, park: 4_000_000, facadeM2: 900 };

test('the money says what the country says, scale words and all', () => {
  const inr = requireCosts(resolve('in/kolkata/ballygunge'));

  /* India keeps crore and lakh, which is the half a symbol swap would have got
     right by accident. `1.11 cr` was the old hand-rolled output; this is the same
     figure through Intl, so the readout did not regress on its way to being
     portable. */
  assert.match(fmtMoney(11_096_666.67, inr), /₹/, 'the rupee readout lost its symbol');
  assert.match(fmtMoney(11_096_666.67, inr), /1\.11\s*Cr/i);
  assert.match(fmtMoney(950_000, inr), /9\.5\s*L/i, 'lakh is the Indian scale below crore');

  /* THE WHOLE POINT. A DEWA audience must not be shown a rupee sign, and must not
     be shown "crore" either — crore is a unit of the Indian numbering system, not
     a property of the rupee, so a symbol-only swap would have produced the
     meaningless "AED 1.11 cr". Symbol, scale word and grouping move together. */
  const gulf = fmtMoney(11_096_666.67, AED_FIXTURE);
  assert.doesNotMatch(gulf, /₹/, 'a Gulf readout is showing the rupee sign');
  assert.doesNotMatch(gulf, /\b(cr|crore|L|lakh)\b/i, 'a Gulf readout is counting in crore');
  assert.match(gulf, /AED/);
  assert.match(gulf, /11\.1\s*M/i, 'the Gulf counts in millions');

  // The two must actually DIFFER on the same number, or the currency is decoration.
  assert.notEqual(fmtMoney(11_096_666.67, inr), gulf);
});

test('the currency travels with the prices it labelled', () => {
  /* `fmtMoney` takes the whole `Costs` rather than a bare currency string, and this
     is what that buys: a call site physically cannot hold the right unit prices and
     the wrong symbol, because there is only one object. The three readouts that
     pasted a `₹` in front of the number could, and did. */
  assert.match(fmtMoney(0, AED_FIXTURE), /AED/);
  assert.throws(() => fmtMoney(1, { ...AED_FIXTURE, currency: 'RUPEE' }), RangeError,
    'a malformed code must fail loudly here; registry check 10 stops it reaching a readout');
});

test('no module writes a currency by hand', async () => {
  /* The three cost readouts each wrote `₹${fmtCr(...)}` — the symbol pasted at
     the call site, in a template literal, while the country half of the scope knew
     the currency perfectly well. The place-name tripwire could not see it and the
     migration's own guards could not see it, because none of them was looking for
     money.

     `INR` is NOT in this pattern: scope/registry.ts declares it, which is the
     correct place and the whole point. What is banned is the PRESENTATION — the
     symbol, the grouping locale, and the two Indian scale words. */
  const HAND_WRITTEN = /(₹|\ben-IN\b|\bcrore\b|\blakh\b)/i;
  const offenders = [];
  for (const [rel, url] of await engineFiles(ENGINE_ROOT)) {
    if (HAND_WRITTEN.test(stripComments(await readFile(url, 'utf8')))) offenders.push(rel);
  }
  assert.deepEqual(offenders.sort(), [],
    'these modules write a currency symbol, grouping locale or scale word by hand; '
    + 'use fmtMoney(amount, costs) and let the country say');

  // Guard the guard: the pattern must still fire on the shape it was written for.
  assert.ok(HAND_WRITTEN.test('setText(sel, `₹${fmtCr(cost)}`)'),
    'the money pattern no longer matches the offender it was written against');
});


/* ────────────────────────────────────────────────────────────────────────────
   THE WARMING CONTROL — drawn from the table that answers it.
   ──────────────────────────────────────────────────────────────────────────── */

test('every button the page can draw is one the physics can answer', () => {
  /* THE INVARIANT THAT MAKES THE CONTROL SAFE, and it is asserted over the SCOPE
     rather than over a list of scenario names typed here — a list would be a fourth
     copy of the pathway table and would pass whatever the other three did.

     `pathwayDelta` fails closed: a key that is not in the scope's table THROWS. That
     is correct, and it was aimed at a control whose three keys were hardcoded in
     markup, so a country with a different populated table would have rendered
     India's buttons and thrown out of a click handler. Every option must round-trip
     through the physics, and so must the one the control opens on. */
  let checked = 0;
  for (const key of AREA_KEYS) {
    const s = resolve(key);
    assert.deepEqual(s.pathway.options.map((o) => o.key), Object.keys(s.climate.pathDelta),
      `${key}: the buttons and the delta table have drifted apart`);
    for (const opt of s.pathway.options) {
      assert.ok(opt.label.length > 0, `${key}: option "${opt.key}" has no label`);
      assert.doesNotThrow(() => at(s.climate, opt.key), `${key}: button "${opt.key}" throws`);
      checked += 1;
    }
    // The boot value too: `state.path` is seeded from this, before any click.
    assert.doesNotThrow(() => at(s.climate, s.pathway.initial ?? ''), `${key}: initial path throws`);
  }
  // Guard the guard: an empty options list everywhere would satisfy the loop.
  assert.equal(checked, 9, 'expected 3 Kolkata areas x 3 scenarios, and none for Dubai');
});

test('a country that has adopted no pathway offers no buttons and cites no paper', () => {
  const dubai = resolve('ae/dubai/creek');
  assert.deepEqual(dubai.pathway.options, []);
  assert.equal(dubai.pathway.initial, null);
  /* NULL, not India's citation. The tooltip was hardcoded to "All-India warming
     deltas from Dhara et al. 2025" above three hardcoded buttons, so the UAE would
     have cited an Indian paper for a table it has nothing to do with. */
  assert.equal(dubai.pathway.source, null);

  const kolkata = resolve('in/kolkata/ballygunge');
  assert.equal(kolkata.pathway.options.length, 3);
  assert.equal(kolkata.pathway.initial, '2025');
  assert.match(kolkata.pathway.source, /Dhara/, 'the adopted pathway must name its source');
});

test('the markup states no scenario and no citation of its own', async () => {
  /* A SOURCE TRIPWIRE, and it is here because the defect was invisible to every
     behavioural test that could be written: the buttons were CORRECT for the only
     country that ships data, so nothing failed, and nothing would have failed until
     a second country was selectable. What can be checked today is that the literals
     are gone and have not come back. */
  /* READS THE STAGE *AND* THE PANE, because the control moved between them.
     The pathway markup lived in HeatMapStage.astro when this was written; the
     shell extraction moved it to shell/InterventionPane.astro. Left pointed at
     the stage alone, the two doesNotMatch assertions below would have kept
     passing while protecting NOTHING -- a hardcoded scenario or citation in the
     pane was suddenly invisible to them. That is the tenth guard in this project
     to be caught watching a place its subject had left, and the first created by
     a refactor rather than written that way. */
  const sources = await Promise.all([
    'src/components/ClimateEngine/HeatMapStage.astro',
    'src/components/ClimateEngine/shell/InterventionPane.astro',
  ].map(async (rel) => stripComments(
    await readFile(new URL(`../../${rel}`, import.meta.url), 'utf8'))));
  const stage = sources.join('\n');
  assert.ok(sources.every((src) => src.length > 0),
    'a source read back empty -- this check would pass while reading nothing');
  assert.doesNotMatch(stage, /ssp\d/i,
    'the stage or the intervention pane names a warming scenario; render scope.pathway.options instead');
  assert.doesNotMatch(stage, /Dhara/,
    'the stage or the intervention pane cites a paper; the citation belongs to the country, as scope.pathway.source');
  assert.match(stage, /scope\.pathway\.options/, 'the control is no longer drawn from the scope');

  const app = stripComments(await readFile(
    new URL('../../src/scripts/climate-engine/heat-map-app.ts', import.meta.url), 'utf8'));
  assert.doesNotMatch(app, /path:\s*'2025'/,
    "heat-map-app.ts seeds state.path from a literal; '2025' is a key in INDIA's table");
});


/* ────────────────────────────────────────────────────────────────────────────
   TWO SILENT NO-OPS — the tab that does nothing, and the refusal that says nothing.
   ──────────────────────────────────────────────────────────────────────────── */

test('a tab is a switch only where something is listening AND something is loadable', () => {
  /* EXERCISED THROUGH THE PURE FUNCTION because the state that breaks it cannot be
     built today: check 5 forbids a non-shipping area inside a `validated` city and
     Kolkata is validated, so a MIXED city is unreachable until the Dubai plan ships
     one — as a pure data change, with no code review attached.

     The middle two rows are the whole test. Row 2 is the shipped defect: the markup
     branched on the PAGE's flag, so a non-shipping sibling rendered as a <button> on
     a data-shipping page, and pressing it reached loadWard's refusal in silence.
     Row 3 is the defect the obvious fix introduces: branch on the SIBLING's flag
     alone and a shipping sibling becomes a <button> on a page where no instrument
     is mounted at all — the same dead control, on the other page. */
  assert.equal(tabKind({ pageShipsData: true, tabShipsData: true }), 'switch');
  assert.equal(tabKind({ pageShipsData: true, tabShipsData: false }), 'link');
  assert.equal(tabKind({ pageShipsData: false, tabShipsData: true }), 'link');
  assert.equal(tabKind({ pageShipsData: false, tabShipsData: false }), 'link');
});

test('the caller asks tabKind rather than reading one flag', async () => {
  /* REPOINTED, BECAUSE ITS SUBJECT MOVED. This watched HeatMapStage.astro, where
     the header tab strip decided per sibling whether to render a <button> or an
     <a>. That strip is gone — it was the third area switcher on one page, after
     the scope switcher's Area select and the ward strip — and the decision it
     encoded moved to the Area select's handler in shell/console-shell.ts, which is
     the one place left that has to choose between switching in place and
     navigating.
     Left pointed at the stage, this would have failed loudly rather than
     hollowing out, because it asserts a PRESENCE. That is luck, not design: the
     two `doesNotMatch` assertions above are the same kind of guard and they went
     silent when their subject moved a task earlier. A source tripwire names a
     FILE, so it does not follow a refactor. */
  const caller = stripComments(await readFile(
    new URL('../../src/scripts/climate-engine/shell/console-shell.ts', import.meta.url), 'utf8'));
  assert.ok(caller.length > 0,
    'console-shell.ts read back empty -- every assertion below would pass over '
    + 'nothing at all');
  assert.match(caller, /tabKind\(/,
    'the scope select is choosing its own shape again rather than asking tabKind');
  /* BOTH FLAGS, AND OFF TWO DIFFERENT KEYS. A call passing only one of them type-
     checks perfectly and is the shipped defect in both of its directions: the
     page's flag alone makes a non-shipping target an in-place switch that loadWard
     refuses in silence, and the target's flag alone makes a shipping target an
     in-place switch on a page where no instrument is mounted. */
  assert.match(caller, /pageShipsData:\s*resolve\(here\)\.area\.hasData/,
    "the page's own flag must come from the key the page declared");
  assert.match(caller, /tabShipsData:\s*resolve\(value\)\.area\.hasData/,
    "the target's flag must come from the key the select is offering, not from the page's");
});

test('an area that cannot be opened is refused OUT LOUD', () => {
  /* `loadWard` opened with two bare `return`s. Both were right to refuse and
     neither said anything: they sit before the loading chip is touched, so the map,
     the readings and the tab highlight all stayed exactly as they were — a control
     that does nothing and says nothing, which at a glance is a click that missed. */
  const refusal = areaRefusal('ae/dubai/al-quoz');
  assert.ok(refusal, 'an area shipping no artefacts must produce a sentence, not null');
  // It must NAME the place. "Nothing to load" over a map does not say which area,
  // and six areas across two cities is exactly when that matters.
  assert.match(refusal, /Al Quoz/);
  assert.match(refusal, /ships no artefacts/i);
  for (const key of ['ae/dubai/creek', 'ae/dubai/south']) assert.ok(areaRefusal(key));

  /* ...and an area that CAN be opened is not refused. Without this a function that
     returned a sentence for everything would satisfy every assertion above and
     leave the instrument permanently unable to load a ward. */
  for (const key of ['in/kolkata/ballygunge', 'in/kolkata/baruipur', 'in/kolkata/barrackpore']) {
    assert.equal(areaRefusal(key), null, `${key} ships data and must not be refused`);
  }
});

test('the instrument shows the refusal instead of returning in silence', async () => {
  const app = stripComments(await readFile(
    new URL('../../src/scripts/climate-engine/heat-map-app.ts', import.meta.url), 'utf8'));
  /* The chip is the only thing on the map that speaks during a switch, so the
     refusal has to reach it. Asserting the PAIRING rather than the mere presence of
     `areaRefusal`: a call whose result is dropped would satisfy a looser check, and
     dropping it is precisely the regression this is written against. */
  assert.match(app, /const refusal = areaRefusal\(name\);[\s\S]{0,400}?loadchip[\s\S]{0,240}?refusal/,
    'loadWard no longer paints the refusal onto the loading chip');
});
