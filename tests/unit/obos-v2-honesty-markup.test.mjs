// tests/unit/obos-v2-honesty-markup.test.mjs — OBOS v2 spec §5 [H] (plan S3.2 Step 3, S3.3; A1 path: screens/overview.css)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const STAGE = readFileSync('src/components/ClimateEngine/HeatMapStage.astro', 'utf8');
const V2 = (f) => readFileSync(`src/components/ClimateEngine/v2/${f}`, 'utf8');
const CSS = (f) => readFileSync(`src/styles/obos-v2/screens/${f}`, 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

test('H5: the Δ disclosure is v1\'s sentence, verbatim, and the label keeps its title', () => {
  const v1 = /title="(Modelled land-cover thermal contrast:[^"]+)">Δ vs all-green ref/.exec(STAGE)?.[1];
  assert.ok(v1, 'the v1 Δ title moved');
  const card = V2('TempCard.astro');
  const delta = /const DELTA = "([^"]+)";/.exec(card)?.[1];
  assert.equal(delta, v1, 'the disclosure text is not v1\'s sentence, byte for byte');
  assert.ok(card.includes('<p class="body-s">{DELTA}</p>'), 'the disclosure body does not print DELTA');
  assert.ok(card.includes('title={DELTA}'), 'the Δ label lost its title');
});

test('H5: the disclosure is a door that is always in the page (a summary, never hover-only)', () => {
  const card = V2('TempCard.astro');
  assert.match(card, /<details class="disc">\s*<summary>What the Δ is, and is not</);
  assert.ok(!/<details class="disc"[^>]*\shidden/.test(card), 'the disclosure must not be hidden');
});

test('H2: v2 hides #lst .band, and only there', () => {
  const css = CSS('overview.css');
  assert.match(css, /html\[data-ui="v2"\] \.obos-v2 #lst \.band \{ display: none !important; \}/);
  assert.equal((css.match(/\.band\b/g) ?? []).length, 1, '.band is styled once: hidden');
});

test('H1: the card prints no ± of its own; the only one is #conf\'s, which the app writes', () => {
  assert.ok(!V2('TempCard.astro').includes('±'), 'TempCard.astro must not spell a ±');
  assert.ok(V2('TempCard.astro').includes('<div class="conf" id="conf"></div>'), '#conf is the empty chip the app fills');
  assert.ok(!/id="conf"[^>]*>\s*[^<\s]/.test(V2('TempCard.astro')), '#conf must be empty in markup');
});

test('H6/H10: surface is not air; the map-face chip survives word for word', () => {
  const card = V2('TempCard.astro');
  assert.ok(card.includes('Ground &amp; rooftop surface'));
  assert.ok(card.includes('Surface above 40 °C'));
  assert.ok(card.includes('Δ vs all-green ref'));
  assert.ok(/Live basemap \+ real footprints &amp; Google heights/.test(STAGE));
});

test('H6: the air disc is ink, never a heat colour (air is not a surface class)', () => {
  assert.match(V2('TempCard.astro'), /<Sym shape="disc" c="ink" size=\{26\} \/>/);
});

test('H7/H8: the live lines are the app\'s (empty ids, hidden until the app paints), not copy of ours', () => {
  const card = V2('TempCard.astro');
  assert.ok(card.includes('<b id="liveSrc">Air now</b>'));
  for (const id of ['seasonNote', 'wardScope', 'wxLine']) assert.match(card, new RegExp(`id="${id}" hidden></p>`), `#${id} must start hidden and empty`);
  assert.match(card, /data-sections="overview heat scenarios"/);
});

test('hero: a generous gap above and below the surface number (founder, 16 px / 14 px), and the numeral is ink', () => {
  const css = strip(CSS('overview.css'));
  assert.match(css, /\.tc2 \.surf \.hero \{[^}]*margin: 16px 0 14px/);
  assert.match(css, /#lst \{ color: var\(--ink-1\) !important;/);
});

test('v2 CSS paints no warm hue by hand: the heat classes ride on tokens only', () => {
  for (const f of ['overview.css', 'heat.css']) assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(strip(CSS(f))), `${f} spells a colour literal`);
});

/* ── S3.3: the Heat cards ── */
test('H9/H6: the legend card carries #patternNote, the colour-mode line and the surface-not-air foot', () => {
  const heat = V2('HeatCards.astro');
  assert.ok(heat.includes('id="patternNote"'));
  const tint = /id="tintchip" title="([^"]+)"/.exec(STAGE)?.[1];
  assert.ok(tint, 'v1\'s #tintchip title moved');
  assert.ok(heat.includes(tint), 'the colour-mode line is not v1\'s #tintchip title');
  assert.ok(heat.includes('Satellite-checked surface temperature, not air temperature.'));
});

test('H23: the method card prints method-copy rows, and "checked", never "validated"', () => {
  const heat = V2('HeatCards.astro');
  assert.ok(heat.includes('checkedRows()') && heat.includes('caveatRows()'));
  assert.ok(heat.includes('How this was checked') && heat.includes('Caveats OBOS adds when they apply'));
  for (const f of ['HeatCards.astro', 'TempCard.astro']) assert.ok(!/validated/i.test(V2(f)), `${f} says "validated"`);
  assert.ok(!/validated/i.test(readFileSync('src/scripts/climate-engine/v2/method-copy.ts', 'utf8')), 'method-copy says "validated"');
});
