import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import sharp from 'sharp';

import { terrainAt, terrainDrawAt, terrainLabel, asTerrainField } from '../../src/scripts/climate-engine/terrain.ts';
import {
  wardMonthHour, sunPlacement, dayOfYearUtc, skyElevationStep, maplibreSky,
} from '../../src/scripts/climate-engine/explore/sun-lighting.ts';
import { solarElevationFactor } from '../../src/scripts/climate-engine/sky.ts';
import { TsHeatSim } from '../../src/scripts/climate-engine/sim-ts.ts';
import { RESET_BURST, currentParams } from '../../src/scripts/climate-engine/heat-map-model.ts';
import { requireGrid, stableDt } from '../../src/scripts/climate-engine/types.ts';
import { rasterWardBase } from '../../src/scripts/climate-engine/ward-raster.ts';
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';
import { PUBLIC_AREA_KEYS, isPublicArea, nextDistinctArea } from '../../src/scripts/climate-engine/scope/registry.ts';
import { areaPageIndexable } from '../../src/scripts/climate-engine/scope/public-routes.ts';

/* PLAN TASK A12: the checks that only mean something once Amsterdam DRAWS.
   Plain node, no dist/ needed. */

const KEY = 'nl/amsterdam/canal-ring';
const scope = resolve(KEY);
const LAT = 52.364, LON = 4.885;
const TZ = 'Europe/Amsterdam';

/* ── 1. The ground goes below zero ────────────────────────────────────────── */

test('terrain has no clamp at 0: a -2..+3 m field reads back negative where it is negative', () => {
  const n = 5, sizeM = 100;
  /* row 0 = NORTH; each COLUMN rises from -2 (west) to +3 (east), linearly */
  const h = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) h.push(-2 + (5 * c) / (n - 1));
  const field = asTerrainField({ ward: 'synthetic', h, n, sizeM, exaggeration: 1 });
  assert.ok(field);
  assert.equal(Math.min(...field.h), -2);
  assert.equal(Math.max(...field.h), 3);
  assert.ok(Math.abs(terrainAt(field, -50, 0) - -2) < 1e-9, 'the west edge is -2 m, not 0');
  assert.ok(terrainAt(field, -50, 0) < 0 && terrainAt(field, -25, 10) < 0, 'negative ground survives bilinear sampling');
  assert.ok(Math.abs(terrainAt(field, 0, 0) - 0.5) < 1e-9, 'the midpoint of -2..3 is +0.5');
  assert.ok(terrainAt(field, 50, 0) > 2.99);
  /* the draw height is exaggeration x height, sign included */
  assert.ok(terrainDrawAt({ ...field, exaggeration: 4 }, -50, 0) < -7.9, 'x4 exaggeration of -2 m is -8 m, not 0');
  assert.equal(terrainDrawAt(null, 0, 0), 0);
  assert.equal(terrainLabel(field), 'ground 1:1 · indicative relief');
});

test('the shipped Amsterdam terrain really goes below zero and is read at x1', () => {
  const raw = JSON.parse(readFileSync('public/heat-map/data/canal-ring-terrain.json', 'utf8'));
  const field = asTerrainField(raw);
  assert.ok(field && field.exaggeration === 1, 'the artefact carries its own 1:1 draw multiplier');
  assert.ok(Math.min(...field.h) < -1, `the lowest texel is ${Math.min(...field.h)} m`);
  let lowest = Infinity;
  for (let y = -1300; y <= 1300; y += 50) for (let x = -1300; x <= 1300; x += 50) lowest = Math.min(lowest, terrainDrawAt(field, x, y));
  assert.ok(lowest < -1, `the sampled ground reaches ${lowest.toFixed(2)} m`);
});

/* ── 2. Daylight saving: the first non-constant UTC offset in the registry ─── */

test('the ward clock follows Europe/Amsterdam through BOTH daylight-saving changes', () => {
  assert.equal(scope.city.tz, TZ);
  const hm = (iso) => wardMonthHour(Date.parse(iso), TZ);
  /* spring forward, 2027-03-28: 01:00 UTC is when 02:00 CET becomes 03:00 CEST */
  assert.deepEqual(hm('2027-03-28T00:30:00Z'), { month: 3, hour: 1.5 }, '01:30 CET');
  assert.deepEqual(hm('2027-03-28T01:30:00Z'), { month: 3, hour: 3.5 }, '03:30 CEST: 02:xx does not exist that night');
  /* fall back, 2026-10-25: 01:00 UTC is when 03:00 CEST becomes 02:00 CET (02:xx happens twice) */
  assert.deepEqual(hm('2026-10-25T00:30:00Z'), { month: 10, hour: 2.5 }, '02:30 CEST, first time');
  assert.deepEqual(hm('2026-10-25T01:30:00Z'), { month: 10, hour: 2.5 }, '02:30 CET, second time');
  assert.deepEqual(hm('2026-10-25T02:30:00Z'), { month: 10, hour: 3.5 }, '03:30 CET');
  /* the month rolls at LOCAL midnight, which is 22:00 UTC in summer and 23:00 UTC in winter */
  assert.deepEqual(hm('2026-06-30T21:59:00Z').month, 6);
  assert.deepEqual(hm('2026-06-30T22:00:00Z'), { month: 7, hour: 0 });
  assert.deepEqual(hm('2026-12-31T22:59:00Z').month, 12);
  assert.deepEqual(hm('2026-12-31T23:00:00Z'), { month: 1, hour: 0 });
  /* the offset itself: 1 h in January, 2 h in July */
  const offsetH = (iso) => { const u = new Date(iso); return ((hm(iso).hour - (u.getUTCHours() + u.getUTCMinutes() / 60)) + 24) % 24; };
  assert.equal(offsetH('2026-01-15T12:00:00Z'), 1);
  assert.equal(offsetH('2026-07-15T12:00:00Z'), 2);
});

test('the time label reads CET / CEST, not "GMT+1" / "GMT+2" (heat-map-app istLike only rewrites GMT+5:30)', () => {
  /* the exact formatter heat-map-app.ts builds `wardHm` from, and weather-panel.ts's */
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' });
  assert.equal(fmt.format(new Date('2026-01-15T11:30:00Z')), '12:30 CET');
  assert.equal(fmt.format(new Date('2026-07-15T11:30:00Z')), '13:30 CEST');
  for (const f of ['src/scripts/climate-engine/heat-map-app.ts', 'src/scripts/climate-engine/v2/weather-panel.ts']) {
    const src = readFileSync(f, 'utf8');
    assert.match(src, /new Intl\.DateTimeFormat\('en-GB', \{[^}]*timeZoneName: 'short'/, `${f}: the zone label must come from en-GB's short name`);
  }
  /* and the Kolkata rewrite is untouched, so nothing about IST moved */
  const kolkata = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' });
  assert.equal(kolkata.format(new Date('2026-07-15T11:30:00Z')).replace('GMT+5:30', 'IST'), '17:00 IST');
});

/* ── 3. The June twilight at 52.4 N does not restart the sky loop ──────────── */

/* heat-map-app's `wardSolarHour`, restated for Amsterdam: local SOLAR time from a UTC instant. */
const solarHourAt = (ms) => ((((ms / 3_600_000) % 24) + LON / 15) % 24 + 24) % 24;
const elevationAt = (ms) => sunPlacement(solarHourAt(ms), dayOfYearUtc(ms), LAT).elevationDeg;
const SOLSTICE_DUSK = Date.UTC(2026, 5, 21, 19, 0);          // 21:00 CEST, the sun about 5 deg up
const SIX_HOURS = 6 * 3_600_000;

test('at 52.4 N the June sun barely sets: never below about -14 deg, and about an hour of the dusk alone is in civil twilight', () => {
  let lowest = Infinity, civilMs = 0;
  for (let ms = SOLSTICE_DUSK; ms < SOLSTICE_DUSK + SIX_HOURS; ms += 60_000) {
    const el = elevationAt(ms);
    lowest = Math.min(lowest, el);
    if (el > -6 && el < 0) civilMs += 60_000;
  }
  assert.ok(lowest > -15 && lowest < -13, `solstice-night minimum elevation ${lowest.toFixed(1)} deg`);
  assert.ok(civilMs >= 0.75 * 3_600_000, `${(civilMs / 3_600_000).toFixed(2)} h of the dusk between -6 and 0 deg: the long twilight this test is about`);
});

test('five seconds of June twilight ask for at most two skies, not three hundred', () => {
  /* find an instant on the ramp, with the sun between -3 and -1 deg */
  let at = null;
  for (let ms = SOLSTICE_DUSK; ms < SOLSTICE_DUSK + SIX_HOURS; ms += 60_000) {
    const el = elevationAt(ms);
    if (el < -1 && el > -3) { at = ms; break; }
  }
  assert.ok(at !== null, 'the sun crosses -1..-3 deg on the June evening');
  const stepped = new Set(), raw = new Set();
  let frames = 0;
  for (let ms = at; ms < at + 5000; ms += 1000 / 60) {
    frames++;
    const el = elevationAt(ms);
    stepped.add(JSON.stringify(maplibreSky(skyElevationStep(el), 0.2)));
    raw.add(JSON.stringify(maplibreSky(el, 0.2)));
  }
  assert.equal(raw.size, frames, 'unstepped, every frame is a new spec: the defect (PR #56) this guards');
  assert.ok(stepped.size <= 2, `stepped, ${stepped.size} specs in ${frames} frames`);
});

test('across the whole six-hour June twilight the sky changes only when the step does, and one millisecond never moves it', () => {
  const specs = new Set();
  let msChanges = 0, instants = 0;
  for (let ms = SOLSTICE_DUSK; ms < SOLSTICE_DUSK + SIX_HOURS; ms += 7000) {
    instants++;
    const a = JSON.stringify(maplibreSky(skyElevationStep(elevationAt(ms)), 0));
    specs.add(a);
    if (a !== JSON.stringify(maplibreSky(skyElevationStep(elevationAt(ms + 1)), 0))) msChanges++;
  }
  assert.ok(msChanges <= 1, `${msChanges} of ${instants} one-millisecond steps changed the sky`);
  /* at most one new spec per 0.1 deg of elevation, and the sun moves ~19 deg in this window */
  assert.ok(specs.size <= 200, `${specs.size} distinct skies over six hours of twilight`);
});

/* ── 4. The solver at four temperate forcings (a SMOKE test, not validation) ─ */

async function canalRingLayers() {
  const ward = JSON.parse(readFileSync('public/heat-map/data/canal-ring.json', 'utf8'));
  const n = requireGrid(ward.sizeM).n;
  const { data, info } = await sharp('public/heat-map/data/canal-ring-surface.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sn = info.width, veg = new Float32Array(sn * sn), albedo = new Float32Array(sn * sn);
  for (let row = 0; row < sn; row++) for (let col = 0; col < sn; col++) {
    const s = (row * sn + col) * 4, d = (sn - 1 - row) * sn + col;
    veg[d] = data[s] / 255; albedo[d] = (data[s + 1] / 255) * 0.5;
  }
  return { n, layers: rasterWardBase(ward, { fvc: NaN, albedo: NaN }, { n: sn, veg, albedo }, null, null) };
}

const ZERO_IV = { trees: 0, roof: 0, parks: 0, facades: 0 };
/* sun factor for the local SOLAR hour at Amsterdam, as the app computes `sunNow` */
const sunAt = (month, day, solarHour) => {
  const doy = dayOfYearUtc(Date.UTC(2026, month - 1, day, 12));
  return solarElevationFactor(solarHour, doy, LAT);
};
const FORCINGS = [
  { name: 'January night', tAir: 2, rh: 85, windMs: 4, cloud: 80, sun: 0, month: 1, hour: 23 },
  { name: 'March noon', tAir: 9, rh: 60, windMs: 4, cloud: 40, sun: sunAt(3, 20, 12.5), month: 3, hour: 13 },
  { name: 'July heatwave noon', tAir: 35, rh: 35, windMs: 2, cloud: 0, sun: sunAt(7, 15, 12.5), month: 7, hour: 14 },
  { name: 'July night', tAir: 17, rh: 70, windMs: 2, cloud: 20, sun: 0, month: 7, hour: 23 },
];

test('canal-ring solves finite, bounded and settled at four temperate forcings', async () => {
  const { n, layers } = await canalRingLayers();
  const report = [];
  for (const f of FORCINGS) {
    const live = { tAir: f.tAir, rh: f.rh, wind: f.windMs, cloud: f.cloud, feels: 0 };
    const p = currentParams({ live, phase: 'peak', path: '', iv: ZERO_IV, climate: scope.climate, clock: { month: f.month, hour: f.hour }, sunNow: f.sun });
    const sim = new TsHeatSim();
    sim.reset({ n, sizeM: 2800 }, layers, p);
    sim.step(1, RESET_BURST);
    const field = sim.temperature();
    let min = Infinity, max = -Infinity, sum = 0;
    for (const v of field) {
      assert.ok(Number.isFinite(v), `${f.name}: a non-finite cell`);
      min = Math.min(min, v); max = Math.max(max, v); sum += v;
    }
    assert.ok(min >= f.tAir - 15, `${f.name}: coldest cell ${min.toFixed(1)} C is more than 15 K under the air`);
    assert.ok(max <= f.tAir + 40, `${f.name}: hottest cell ${max.toFixed(1)} C is more than 40 K over the air`);
    /* no step-to-step oscillation: after the burst, 50 further steps move the field monotonically toward rest */
    const before = Float32Array.from(sim.temperature());
    sim.step(1, 1);
    const one = Float32Array.from(sim.temperature());
    let stepMove = 0;
    for (let i = 0; i < one.length; i++) stepMove = Math.max(stepMove, Math.abs(one[i] - before[i]));
    sim.step(1, 50);
    const later = sim.temperature();
    let laterMove = 0;
    for (let i = 0; i < later.length; i++) laterMove = Math.max(laterMove, Math.abs(later[i] - one[i]));
    assert.ok(stepMove < 0.05, `${f.name}: one step still moves a cell by ${stepMove.toFixed(4)} K`);
    assert.ok(laterMove < 0.5, `${f.name}: 50 more steps move a cell by ${laterMove.toFixed(3)} K (oscillating?)`);
    assert.ok(p.sun >= 0 && stableDt(p, 1) > 0, `${f.name}: a stable dt exists`);
    report.push(`${f.name.padEnd(20)} air ${String(f.tAir).padStart(2)} C  mean ${(sum / field.length).toFixed(2)} C  min ${min.toFixed(2)}  max ${max.toFixed(2)}  sun ${f.sun.toFixed(2)}`);
    sim.dispose();
  }
  console.log(`solver smoke (canal-ring, ${n}x${n}, ${RESET_BURST} steps):\n  ${report.join('\n  ')}`);
});

/* ── 5. Single-area city and the public gate ─────────────────────────────── */

test('Amsterdam is a single-area city: Compare has no next area and nothing throws', () => {
  assert.equal(nextDistinctArea(KEY), null);
});

test('Amsterdam is PUBLIC (it draws) but not INDEXABLE (shipsData is false): noindex and out of the sitemap until the founder decides', () => {
  assert.ok(PUBLIC_AREA_KEYS.includes(KEY));
  assert.ok(isPublicArea(KEY));
  assert.equal(scope.area.hasData, true);
  assert.equal(scope.area.publishes, false);
  assert.equal(areaPageIndexable('/heat-map/nl/amsterdam/canal-ring/'), false);
  const page = readFileSync('src/pages/heat-map/[country]/[city]/[area].astro', 'utf8');
  assert.match(page, /const indexable = scope\.area\.publishes;/);
  assert.match(page, /noindex=\{!indexable\}/);
  assert.equal(scope.city.tier ?? 'geometry', 'geometry');
});
