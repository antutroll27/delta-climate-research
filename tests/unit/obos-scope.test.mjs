import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  REGISTRY, AREA_KEYS, isAreaKey, splitKey, assertRegistryLogic,
  areaTableDrift, shippingAreaIds,
} from '../../src/scripts/climate-engine/scope/registry.ts';
import { paths, cityPaths } from '../../src/scripts/climate-engine/scope/paths.ts';
import { resolve, requireCosts } from '../../src/scripts/climate-engine/scope/resolve.ts';
import { WARDS as WARD_TABLE } from '../../src/data/wards.ts';
import { currentParams } from '../../src/scripts/climate-engine/heat-map-model.ts';

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

/** Source with comments removed, so a tripwire greps CODE and not prose. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const engineSource = (name) =>
  readFile(new URL(`../../src/scripts/climate-engine/${name}`, import.meta.url), 'utf8');

test('resolve turns a key into a whole scope', () => {
  const s = resolve('in/kolkata/ballygunge');
  assert.equal(s.key, 'in/kolkata/ballygunge');
  assert.deepEqual(s.country, { id: 'in', name: 'India' });
  assert.deepEqual(s.city, { id: 'kolkata', name: 'Kolkata', koppen: 'Aw' });
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
const PLACE = /\b(kolkata|dubai|india|ballygunge|baruipur|barrackpore)\b/gi;

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

test('the physics names no place, with one recorded exception', async () => {
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

async function dataUrlOffenders() {
  const root = new URL('../../src/scripts/climate-engine/', import.meta.url);
  const offenders = [];
  const walk = async (dir, prefix) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const next = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) { await walk(next, `${prefix}${entry.name}/`); continue; }
      // `._` files are AppleDouble sidecars: exFAT artefacts, not source.
      if (!entry.name.endsWith('.ts') || entry.name.startsWith('._')) continue;
      const rel = `${prefix}${entry.name}`;
      if (PATH_ALLOWLIST.has(rel)) continue;
      /* STRIP COMMENTS FIRST. Three modules legitimately DOCUMENT the data
         directory -- loader-progress.ts:39 and registry.ts:44,103. A grep over
         raw source flags those, and a guard that cries wolf on documentation
         gets weakened or deleted, which is how the real check dies. */
      const code = (await readFile(next, 'utf8'))
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      /* ANY data URL, not just interpolated ones. Three call sites fetch
         heatwave-percentiles.json and dc-urs-inputs.json by PLAIN STRING --
         precisely the two files that lie about their scope -- so a `${`-only
         pattern would miss exactly the cases this migration is for. */
      if (/['"`]\/heat-map\/data\//.test(code)) offenders.push(rel);
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
  /* Guard the guard. `dataUrlOffenders` walks a directory, strips comments and
     greps -- three steps, each of which can silently stop finding anything: a walk
     that recurses wrongly, a comment-stripper that eats the code, a pattern that no
     longer matches the quoting someone used. An empty result would then read as
     "clean" for ever, which is the exact failure shape this whole migration exists
     to end.

     So the pattern is exercised against the four spellings a real regression would
     arrive in -- the three quote styles, and the interpolated form the sixteen
     original call sites actually used -- rather than by writing a decoy file to
     disk, which would leave one behind if the run were interrupted. */
  const flags = (code) => /['"`]\/heat-map\/data\//.test(code);
  assert.equal(flags('fetch(`/heat-map/data/${name}-trees.json`)'), true);
  assert.equal(flags("fetch('/heat-map/data/dc-urs-inputs.json')"), true);
  assert.equal(flags('fetch("/heat-map/data/heatwave-percentiles.json")'), true);
  assert.equal(flags('const DATA = `/heat-map/data/`;'), true);
  // ...and does not fire on the paths() output the migrated modules now pass around.
  assert.equal(flags('fetch(p.trees, { signal })'), false);
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
