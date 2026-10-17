// tests/unit/obos-v2-split.test.mjs — OBOS v2 plan amendment A1: the extension points stay where every track expects them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const C = 'src/components/ClimateEngine/v2';
const noJsx = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
export const REGIONS = ['MapChips', 'RailV2', 'ToolbarV2', 'ExploreSide', 'SolarSide', 'AirSide', 'TitleCard', 'CompassV2', 'MapStack',
  'DockV2', 'ToastsV2', 'RightColumn', 'ParkS8', 'ParkA1', 'ParkB1', 'ParkA2', 'ParkB2', 'LayersPopover', 'Overlays', 'StreetViewModal', 'SolarSheets'];
export const CARDS = ['BuildingCardV2', 'TempCard', 'HeatCards', 'ScenarioCards', 'SolarCards', 'WeatherCards', 'MethodsCards'];
export const SCREEN_PARTIALS = ['overview', 'heat', 'mapstack', 'building', 'explore', 'scenarios', 'solar', 'air', 'weather', 'methods', 'compare', 'brief'];
export const PRINT_PARTIALS = ['solar', 'brief'];

function inOrder(src, names, what) {
  let at = -1;
  for (const n of names) {
    const hits = [...src.matchAll(new RegExp(`<${n}[\\s/>]`, 'g'))];
    assert.equal(hits.length, 1, `${n} must appear exactly once in ${what}`);
    assert.ok(hits[0].index > at, `${n} is out of order in ${what}`);
    at = hits[0].index;
  }
}

test('the area stage mounts every region once, in the A1 order', () => {
  const s = readFileSync(join(C, 'HeatMapStageV2.astro'), 'utf8');
  inOrder(noJsx(s.slice(s.indexOf('<main'))), REGIONS, 'HeatMapStageV2.astro');
});

test('the right column holds every card slot once, building card first, the .attr marker last', () => {
  const rc = noJsx(readFileSync(join(C, 'RightColumn.astro'), 'utf8'));
  inOrder(rc, CARDS, 'RightColumn.astro');
  assert.ok(rc.lastIndexOf('class="attr"') > rc.lastIndexOf('<MethodsCards'), 'the .attr marker must stay the last child (app:1212, :1238)');
});

test('screens.css and print.css are manifests: @import lines only, in order, each partial present', () => {
  for (const [sheet, dir, list] of [['screens.css', 'screens', SCREEN_PARTIALS], ['print.css', 'print', PRINT_PARTIALS]]) {
    const lines = readFileSync(`src/styles/obos-v2/${sheet}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.trim()).filter(Boolean);
    assert.deepEqual(lines, list.map((p) => `@import './${dir}/${p}.css';`), `${sheet} is not the A1 manifest`);
    for (const p of list) assert.ok(existsSync(`src/styles/obos-v2/${dir}/${p}.css`), `${dir}/${p}.css`);
  }
});

test('no v2 component carries a <style> (Astro would stamp scope attributes)', () => {
  const files = [...readdirSync(C).filter((x) => x.endsWith('.astro')).map((f) => join(C, f)),
    'src/components/ClimateEngine/compare/PairedBenchV2.astro', 'src/components/ClimateEngine/brief/HeatMapBriefV2.astro'].filter(existsSync);
  for (const f of files) assert.ok(!/<style[\s>]/.test(readFileSync(f, 'utf8')), `${f} has a <style>; v2 CSS lives in src/styles/obos-v2/`);
});

test('mountShellV2 calls the thirteen binders in the plan\'s order, gated for Compare (plan S9.2 Step 4)', () => {
  const src = readFileSync('src/scripts/climate-engine/v2/shell-v2.ts', 'utf8');
  const body = src.slice(src.indexOf('export function mountShellV2'));
  let at = -1;
  for (const b of ['bindSections(', 'bindPrefs(', 'bindPerArea(', 'bindPressedMirror(', 'bindProxies(', 'bindLayers(', 'bindPhone(',
    'bindFlash(', 'bindMirrors(', 'bindSunCard(', 'bindWardCard(', 'bindWeather(', 'bindGlass(']) {
    const i = body.indexOf(b); assert.ok(i > at, `${b} missing or out of order`); at = i;
  }
  assert.match(body, /const compare = root\.matches\('\[data-compare-root\], \[data-brief-root\]'\);/);   // c-02: the brief is frame-only by its own marker
});

test('the built CSS inlined every partial (no manifest @import survives into dist)', () => {
  assert.ok(existsSync('dist/_astro'), 'run npm run build first');
  for (const f of readdirSync('dist/_astro').filter((x) => x.endsWith('.css'))) {
    assert.ok(!/@import[^;]*(screens|print)\//.test(readFileSync(join('dist/_astro', f), 'utf8')), `${f} still imports a partial`);
  }
});
