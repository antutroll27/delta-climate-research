// tests/unit/obos-v2-honesty-markup-solar.test.mjs — OBOS v2 spec §5 [H] (H13, H14, H15), Track B (plan S6.1, S6.2; A1 §2.4)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const STAGE = readFileSync('src/components/ClimateEngine/HeatMapStage.astro', 'utf8');
const V2 = (f) => readFileSync(`src/components/ClimateEngine/v2/${f}`, 'utf8');
/** markup as the reader gets it: comments are not words on a page */
const noComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const idsOf = (s) => [...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
/** the inner HTML of the first <div class="interval">, closed by counting divs (a lazy regex would cross the headline's own </div>) */
function intervalBlock(src) {
  const open = src.indexOf('<div class="interval">');
  assert.ok(open >= 0, 'no .interval row');
  let depth = 0;
  for (const m of src.slice(open).matchAll(/<div\b|<\/div>/g)) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return src.slice(open, open + m.index);
  }
  throw new Error('unclosed .interval');
}

test('H13/H14: the ward headline has its floor in the same .interval row; no "validated" in any v2 solar file', () => {
  const cards = V2('SolarCards.astro'), side = V2('SolarSide.astro'), sheets = V2('SolarSheets.astro');
  assert.match(cards, /<div class="interval">[\s\S]*?id="solPaneKwp"[\s\S]*?id="solPaneConf"[\s\S]*?id="solPaneFloor"[\s\S]*?<\/div>/,
    'the plan\'s H13 pin: headline, confidence line and floor, in that order');
  const row = intervalBlock(cards);
  for (const id of ['solPaneKwp', 'solPaneConf', 'solPaneFloor']) assert.ok(row.includes(`id="${id}"`), `#${id} must sit inside the same .interval row as the headline`);
  for (const [name, src] of [['SolarCards', cards], ['SolarSide', side], ['SolarSheets', sheets]]) {
    const text = noComments(src);
    assert.ok(!/\bvalidated\b/i.test(text), `${name}: the solar tier word is "checked", never "validated"`);
    assert.ok(!/guarantee|ROI of|returns/i.test(text), `${name}: a banned money word`);
  }
});

test('H13: the headline is never alone: the floor outranks nothing, and the sentence still says "strict roof mask"', () => {
  /* the .interval must not be hidden or folded by markup: no <details> wraps the headline row */
  const cards = V2('SolarCards.astro');
  const head = cards.slice(cards.indexOf('id="solPaneKwp"') - 200, cards.indexOf('id="solPaneFloor"') + 80);
  assert.ok(!/<details|\shidden[\s>]/.test(head), 'the headline row may not be folded or hidden');
  /* the app's own words, which the floor paragraph carries on screen, stay in the app */
  const app = readFileSync('src/scripts/climate-engine/heat-map-app.ts', 'utf8');
  assert.ok(app.includes('under a strict roof mask'), 'the floor sentence moved out of the app');
});

test('H15: the payback tag, the ward estimate and the sheet carry "estimate, not a quote", and every figure goes through the formatters', () => {
  const sheets = noComments(V2('SolarSheets.astro')), cards = noComments(V2('SolarCards.astro'));
  const copy = readFileSync('src/scripts/climate-engine/solar-copy.ts', 'utf8');
  assert.ok(copy.includes("export const ESTIMATE_TAG = 'screened · estimate, not a quote'"));
  assert.ok(sheets.includes('id="spTag">screened · estimate, not a quote<'), 'the sheet tag lost its words');
  assert.ok(/id="spAssume"/.test(sheets), 'the sheet lost its assumptions line');
  assert.match(cards, /data-v2-card="ward-payback"[\s\S]*?estimate[\s\S]*?id="solPanePay"/, 'the ward payback card must say "estimate" next to #solPanePay');
  for (const [name, src] of [['SolarCards', cards], ['SolarSide', noComments(V2('SolarSide.astro'))], ['SolarSheets', sheets]]) {
    assert.ok(!/(₹|\bcrore\b|\blakh\b|\ben-IN\b)/i.test(src), `${name}: writes a currency by hand; use fmtMoney, fmtRate and currencyMark`);
  }
});

test('the "Use my bill" field exists, once, and the warning that points at it uses the same words (v1/preview mismatch)', () => {
  const sheets = V2('SolarSheets.astro');
  const copy = readFileSync('src/scripts/climate-engine/solar-copy.ts', 'utf8');
  const words = /under "(Use my bill)" to see the payback/.exec(copy)?.[1];
  assert.equal(words, 'Use my bill', 'flatCaveat no longer points at "Use my bill"');
  assert.match(sheets, /<div id="spBill">\s*<label class="sp-k" for="spUnits">Use my bill \(optional\): units a month<\/label>\s*<input id="spUnits"/,
    'the field the warning points at must be a labelled #spUnits inside #spBill');
  const all = idsOf(sheets);
  for (const id of ['spUnits', 'spSizing', 'spWarn', 'spFlat', 'spPayback', 'spSaving', 'spAssume', 'spCsv', 'spPrint', 'spClose']) {
    assert.equal(all.filter((x) => x === id).length, 1, `${id} must exist exactly once in SolarSheets`);
  }
  /* the v1 sheet it was cut from has the same field: v2 may not drop it */
  assert.ok(STAGE.includes('id="spUnits"'), 'v1 lost #spUnits (unexpected)');
});

test('the Solar side panel: roof table keeps its aria-label and tbody#solList; tariff, CSV and empty note are in place', () => {
  const side = V2('SolarSide.astro');
  assert.ok(side.includes('data-side-pane="solar"'), 'the root keeps data-side-pane="solar"');
  assert.match(side, /<h2>Solar · <span id="solPaneArea">/);
  assert.ok(side.includes('data-side-close'), 'the panel needs a close button the shell handles');
  assert.match(side, /<table class="roofs" aria-label="The ten best roofs by annual yield; each row selects its building on the map">/);
  assert.ok(side.includes('<tbody id="solList"></tbody>'));
  assert.match(side, /id="solTariff"[^>]*type="number"|type="number"[^>]*id="solTariff"/);
  assert.ok(side.includes('id="solCur"') && side.includes('id="solTariffNote"') && side.includes('id="solCsv"') && side.includes('id="solPaneSum"'));
  /* the city-dependent tariff note is v1's, word for word */
  for (const phrase of ['CESC domestic slabs run 4.07–9.21 per unit (2025-26 tariff order); a solar unit displaces the top of the bill. Not a rate we assert.',
    'No local tariff is sourced for this city yet, so the box above is an assumption you should change. Not a rate we assert.']) {
    assert.ok(side.includes(phrase), `tariff note changed: ${phrase.slice(0, 30)}…`);
    assert.ok(STAGE.includes(phrase), 'v1 tariff note moved (re-pin)');
  }
  assert.ok(side.includes('No solar screen ships for {scope.area.name}. The screen needs footprints, heights and canopy, and this area ships none.'));
  assert.ok(side.includes('"at least" is the strict-mask floor. Screening only, not bankable.'), 'the method foot lost the floor definition');
});

test('ids: each solar pane id the app paints lives once in the v2 solar files, and not in ParkB1 any more', () => {
  const side = idsOf(V2('SolarSide.astro')), cards = idsOf(V2('SolarCards.astro')), park = V2('ParkB1.astro');
  for (const id of ['solPaneSum', 'solPaneArea', 'solTariff', 'solCur', 'solTariffNote', 'solList', 'solCsv']) {
    assert.ok(side.includes(id), `SolarSide lacks #${id}`);
    assert.ok(!park.includes(`id="${id}"`), `#${id} is still parked in ParkB1`);
  }
  for (const id of ['solPaneBlock', 'solPaneHead', 'solPaneTier', 'solPaneKwp', 'solPaneConf', 'solPaneFloor', 'solPaneSure', 'solPaneKwh', 'solPaneRs', 'solPaneBigK', 'solPaneBig', 'solPaneSh', 'solPanePay']) {
    assert.ok(cards.includes(id), `SolarCards lacks #${id}`);
    assert.ok(!park.includes(`id="${id}"`), `#${id} is still parked in ParkB1`);
  }
  assert.ok(!park.includes('id="solList"') && !park.includes('pane-solar-h'), 'the solar pane-body leaves ParkB1 whole');
});

test('the print rules: v2 chrome hidden, #solBrief alone, no close button on paper, ink and paper from tokens only', () => {
  const css = readFileSync('src/styles/obos-v2/print/solar.css', 'utf8');
  assert.match(css, /@media print/);
  assert.ok(css.includes('#solBrief[hidden] { display: none !important; }'), 'the [hidden] belt');
  assert.ok(/#brClose \{ display: none !important; \}/.test(css));
  /* merge gate (18 Oct): scoped to the area stage, or it blanks the paired brief and Compare (print/brief.css owns theirs) */
  const SCOPE = '\\.obos-v2:not\\(\\[data-brief-root\\]\\):not\\(\\[data-compare-root\\]\\)';
  assert.ok(new RegExp(`${SCOPE} > \\*:not\\(#solBrief\\) \\{ display: none !important; \\}`).test(css));
  assert.ok(!/html\[data-ui="v2"\] \.obos-v2 [>#{]/.test(css), 'no unscoped .obos-v2 print rule is left');
  assert.ok(css.includes('var(--print-ink)') && css.includes('var(--print-paper)'));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'print/solar.css may not write a hex');
  assert.ok(!/rgba?\(|hsla?\(|oklch\(/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'print/solar.css may not write a colour function');
});

test('the brief keeps "Questions to ask your installer" and its footer words', () => {
  const sheets = V2('SolarSheets.astro');
  assert.ok(sheets.includes('Questions to ask your installer'));
  assert.ok(sheets.includes('Screening estimate · not bankable'));
  assert.equal((sheets.match(/<li>/g) ?? []).length, 6, 'six questions');
});

/* ───────────── S7.1 Air (Track B): the painter's words stay the painter's ───────────── */
const AIR_CSS = readFileSync('src/styles/obos-v2/screens/air.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('S7.1 Air: AirSide keeps the painter\'s ids and writes no air-quality sentence of its own', () => {
  const side = V2('AirSide.astro'), park = V2('ParkB1.astro');
  assert.ok(side.includes('data-side-pane="air"') && side.includes('data-side-close'));
  for (const id of ['airPane', 'airPaneArea', 'airPaneBody', 'airStatus', 'pane-air-h']) {
    assert.equal(idsOf(side).filter((x) => x === id).length, 1, `#${id} must exist once in AirSide`);
    assert.ok(!park.includes(`id="${id}"`), `#${id} is still parked in ParkB1`);
  }
  assert.ok(side.includes("isAirCity(scope.key) ? 'Loading air quality…' : UNCOVERED_NOTE"), 'the first-paint sentence is v1\'s, imported not retyped');
  const text = noComments(side);
  for (const phrase of ['legal standard', 'IQAir', 'aqi.in', 'Why do other apps', 'CPCB published', 'Severe']) assert.ok(!text.includes(phrase), `AirSide retypes the painter's words: ${phrase}`);
  assert.ok(!/\b(wrong|incorrect|inaccurate)\b/i.test(text));
});

test('S7.1 Air: the stylesheet draws bands only through --c-*/--aq-*, borrows no heat colour, and the stale chip is ink', () => {
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/.test(AIR_CSS), 'air.css may not write a colour literal');
  assert.ok(!/var\(--(heat-[1-5]|cyan|orange|red|bronze|sage|gold|sun)\)/.test(AIR_CSS), 'air.css uses a heat-ramp colour: temperature only');
  assert.match(AIR_CSS, /\.chip\.old\s*\{[^}]*background:\s*var\(--ink-1\);[^}]*color:\s*var\(--on-ink\)/, '.chip.old is ink on ink (spec §2.4), never red');
  assert.match(AIR_CSS, /\.chip\.live[^{]*\{[^}]*\}/, '.chip.live is styled as a measured kind');
  assert.match(AIR_CSS, /\.num\s*\{[^}]*color:\s*var\(--ink-1\)\s*!important/, 'the AQI numeral is ink; the band colour rides the dot beside the band word');
  assert.ok(!/violet|purple/i.test(AIR_CSS));
});

/* ───────────── B-S6 audit F1, F4, F5, F6, F7: CSS and binder pins ───────────── */
const SOLAR_CSS = readFileSync('src/styles/obos-v2/screens/solar.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('F1: the sheet\'s button row is sticky so Close is in view on open; the scroll cue stays; scroll padding clears both sticky bars', () => {
  assert.match(SOLAR_CSS, /#solPay \.sp-btns \{[^}]*position: sticky;[^}]*bottom: 0;[^}]*background: var\(--card\)/);
  assert.match(SOLAR_CSS, /#solPay \{[^}]*scroll-padding: 64px 0 52px;/);
  assert.match(SOLAR_CSS, /#solPay \{[^}]*scrollbar-width: thin;/);
  const bind = readFileSync('src/scripts/climate-engine/v2/solar-v2.ts', 'utf8');   // b-01: moved out of weather-v2.ts
  assert.match(bind, /getElementById\('solPay'\)[\s\S]*scrollTop = 0/, 'the sheet is put back at its top after the app focuses Close');
  /* FINAL audit F4 added ONE deliberate focus move: bindCardFocusReturn puts focus back on the control that opened the building card when the card hides. Nothing else here moves focus. */
  const bindRest = bind.slice(0, bind.indexOf('function bindCardFocusReturn')) + bind.slice(bind.indexOf('export function bindSolar'));
  assert.ok(!/\.focus\(/.test(bindRest.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')), 'v2 does not move focus (but for the F4 return): the app\'s focus on Close stays');
  assert.ok(!/#solPay::-webkit-scrollbar/.test(SOLAR_CSS) && !/scrollbar-width: none/.test(SOLAR_CSS), 'the sheet\'s scrollbar is not hidden');
});

test('F4: the ward card has no dead band: the float spacer is removed and its room becomes padding', () => {
  assert.match(SOLAR_CSS, /\.sl-ward \.bleed-room::before \{ content: none; \}/);
  assert.match(SOLAR_CSS, /\.sl-ward \.bleed-room \{[^}]*padding-right: 62px;/);
});

test('F5: the tariff unit uses --ink-3 (AA in Light-Plates), no hex', () => {
  assert.match(SOLAR_CSS, /\.sl-tin \.u \{[^}]*color: var\(--ink-3\);/);
  assert.ok(!/\.sl-tin \.u \{[^}]*var\(--unit\)/.test(SOLAR_CSS));
});

test('F6: the selected roof row is marked by a v2-only binder (no app edit), and the inverted-row rule is live', () => {
  const bind = readFileSync('src/scripts/climate-engine/v2/solar-v2.ts', 'utf8');   // b-01: moved out of weather-v2.ts
  assert.match(bind, /aria-selected/);
  assert.match(bind, /#solList/);
  assert.match(bind, /bcId/);
  assert.match(SOLAR_CSS, /tr\[data-idx\]\[aria-selected="true"\]/);
});

test('F7: a ward with no solar screen hides the tariff tool and the empty list (the app hides #solCsv)', () => {
  assert.match(SOLAR_CSS, /\[data-side-pane="solar"\]:has\(#solCsv\[hidden\]\) :is\(\.sl-tariff, #solTariffNote, \.sl-listh, \.roofs-scroll, \.sl-note\) \{ display: none; \}/);
});
