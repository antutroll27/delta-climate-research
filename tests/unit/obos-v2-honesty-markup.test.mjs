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
  assert.match(V2('TempCard.astro'), /<Sym shape="disc" c="ink" kind="modelled" size=\{26\} \/>/);   // ink in both states; bindAirKind swaps solid/outlined (A-S3 audit F1)
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
  assert.ok(heat.includes('checkedRows()') && heat.includes('caveatRows(scope.area.id)'));
  assert.ok(heat.includes('How this was checked') && heat.includes('Caveats OBOS adds when they apply'));
  for (const f of ['HeatCards.astro', 'TempCard.astro']) assert.ok(!/validated/i.test(V2(f)), `${f} says "validated"`);
  assert.ok(!/validated/i.test(readFileSync('src/scripts/climate-engine/v2/method-copy.ts', 'utf8')), 'method-copy says "validated"');
});

/* ── S4.2: the ward card ── */
test('H10: the ward card carries the v1 map-face chip word for word, as three provenance rows', () => {
  const ms = V2('MapStack.astro');
  const chip = /<span class="full">([^<]+?) · <\/span>heat field modelled<span class="sp"> · block detail illustrative<\/span>/.exec(STAGE);
  assert.ok(chip, 'v1\'s .synthetic chip moved');
  assert.equal(chip[1], 'Live basemap + real footprints &amp; Google heights', 'v1 wording changed: re-check the three rows');
  for (const t of ['Live basemap, real footprints &amp; Google heights', 'Heat field · modelled', 'Block detail · illustrative']) assert.ok(ms.includes(t), t);
  assert.ok(/<Sym shape="square" c="ink" size=\{13\} \/><\/span><span>Live basemap/.test(ms), 'the measured row must be SOLID');
  assert.ok(/<Sym shape="ward" c="heat-4" kind="modelled"/.test(ms), 'the heat field row must be OUTLINED');
  assert.ok(/<Sym shape="square" c="neutral" kind="modelled"[^>]*\/><\/span><span>Block detail/.test(ms), 'illustrative block detail must be OUTLINED, neutral');
});

test('the ward card: the app\'s ids stay once, the count is the app\'s sentence, the breadcrumb glyph is the ward\'s own outline (no India outline)', () => {
  const ms = V2('MapStack.astro');
  for (const id of ['bcount', 'simBackend', 'loadchip', 'crumbArea']) assert.equal((ms.match(new RegExp(`id="${id}"`, 'g')) ?? []).length, 1, `#${id} must be in MapStack once`);
  assert.ok(ms.includes('areaFacts('), 'the crumb glyph must be the ward outline from areaFacts');
  assert.ok(!/india|IN_OUTLINE|natural.?earth/i.test(ms), 'no India outline in the ward card');
  assert.ok(ms.includes('<span id="bcount">— buildings</span>'), '#bcount starts as the app\'s placeholder; the app writes the sentence');
  assert.ok(ms.includes('aria-live="polite">SELECTING ENGINE</span>'), '#simBackend keeps its live region and v1\'s first word');
});

test('the breadcrumb is sentence case and the Less/More toggle keeps its accessible name', () => {
  const css = strip(CSS('mapstack.css'));
  assert.match(css, /\.crumb \{[^}]*text-transform: none/);
  assert.match(V2('MapStack.astro'), /aria-label="Show less about this ward"/);
});

test('the loading chip shows only while loading or failed (the app toggles .on and .fail)', () => {
  assert.match(strip(CSS('mapstack.css')), /#loadchip:not\(\.on\):not\(\.fail\) \{ display: none; \}/);
});

/* ── S4.3: the building card (A1 §2.4: these pins moved here from Track B's S6.1 test) ── */
const bcardOf = (src, open) => { const i = src.indexOf(open); return src.slice(i, src.indexOf('<div class="place">', i) > i ? src.indexOf('<div class="place">', i) : undefined); };
const textsOf = (html) => [...html.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').matchAll(/>([^<>{}]+)</g)].map((m) => m[1].replace(/\s+/g, ' ').trim()).filter(Boolean);
const attrsOf = (html) => [...html.matchAll(/\b(?:aria-label|title)="([^"]+)"/g)].map((m) => m[1]);

test('H11: v1\'s building-card wording survives, every text node and every label, word for word', () => {
  const v1 = bcardOf(STAGE, '<div class="bcard" id="bcard"');
  const v2 = V2('BuildingCardV2.astro');
  const v2blob = ` ${textsOf(v2).join(' | ')} | ${attrsOf(v2).join(' | ')} `;
  const missing = [...textsOf(v1), ...attrsOf(v1)].filter((t) => !v2blob.includes(t));
  assert.deepEqual(missing, [], 'text v1 prints that the v2 card lost');
});

test('H13: the strict floor sits beside the headline, in one .interval row (both ids)', () => {
  const v2 = V2('BuildingCardV2.astro');
  assert.match(v2, /<div class="interval">[^]*?id="bcSolKwp"[^]*?id="bcSolFloor"[^]*?<\/div>/);
  const row = /<div class="interval">([^]*?)<\/div>/.exec(v2)[1];
  assert.ok(row.includes('id="bcSolKwp"') && row.includes('id="bcSolFloor"'), 'headline and floor must share the row');
});

test('H14/H15: no "validated" and no banned money word on the building card; the estimate wording is v1\'s', () => {
  const v2 = V2('BuildingCardV2.astro');
  assert.ok(!/validated(?! rooftops)/i.test(v2.replace('Never compared with real rooftops yet. The validation study is under way.', '')), 'a solar claim says "validated"');
  assert.ok(!/guarantee|ROI of|returns/i.test(v2), 'a banned money word');
  assert.ok(v2.includes('Screening estimate · not bankable · canopy Meta/WRI CHM v2 · 0.5 m grid · NASA POWER irradiance'));
  assert.ok(v2.includes('Work out payback') && v2.includes('Print the installer brief'));
});

test('the card is a dialog the app\'s selection logic can still drive: every bc* id once, and the app\'s hidden/placement contract holds', () => {
  const v2 = V2('BuildingCardV2.astro');
  const ids = [...v2.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids in the building card');
  for (const id of ['bcard', 'bcId', 'bcLL', 'bcH', 'bcF', 'bcA', 'bcV', 'bcAl', 'bcT', 'bcLm', 'bcLmName', 'bcLmH', 'bcLmSrc', 'bcSol', 'bcSolTier', 'bcSolKwp', 'bcSolKwh',
    'bcSolLoss', 'bcSolFloor', 'bcSolRaised', 'bcSolRs', 'bcSolNote', 'bcSure', 'bcSureRoof', 'bcSureCanopy', 'bcSureIrr', 'bcSureValid', 'bcBrief', 'bcPay', 'svThumb', 'bcRings', 'bcIns', 'bcSrc', 'bcX']) {
    assert.ok(ids.includes(id), `#${id} missing`);
  }
  assert.match(v2, /<div class="bcard card" id="bcard" hidden role="dialog" aria-label="Selected building">/);
  assert.equal((v2.match(/data-limit="/g) ?? []).length, 10, 'the five rungs and their five buttons');
});

test('the map-borne chips and the street-view modal left parking for their own regions', () => {
  const chips = V2('MapChips.astro'), sv = V2('StreetViewModal.astro'), park = V2('ParkA2.astro');
  for (const id of ['bsel', 'ringNear', 'ringFar', 'coolTag', 'coolTagIn', 'coolTagM', 'lmlabs']) { assert.ok(chips.includes(`id="${id}"`), `#${id} not in MapChips`); assert.ok(!park.includes(`id="${id}"`), `#${id} still parked`); }
  for (const id of ['svModal', 'svClose', 'svViewer']) { assert.ok(sv.includes(`id="${id}"`), `#${id} not in StreetViewModal`); assert.ok(!park.includes(`id="${id}"`), `#${id} still parked`); }
  assert.ok(sv.includes('Street imagery · <a href="https://www.mapillary.com" target="_blank" rel="noopener noreferrer">Mapillary</a> · community-captured (CC BY-SA)'), 'the credit is v1\'s text with a real link');
});

test('the card override is CSS-only: v2 neutralises the app\'s inline placement and nothing is written in a script', () => {
  const css = strip(CSS('building.css'));
  assert.match(css, /#bcard \{[^}]*transform: none !important; opacity: 1 !important;/);
  assert.match(css, /#bcard \.bcard-in \{[^}]*max-height: none !important;/);
  assert.match(css, /#legend:has\(> #bcard:not\(\[hidden\]\)\) > :not\(#bcard\) \{ display: none !important; \}/);
  assert.match(css, /#bcard \.lead \{ display: none; \}/);
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css), 'building.css spells a colour literal');
});

/* ── A-S3 audit F2: the ward mark's colour is synced once at mount, and on every change ── */
test('F2: bindMirrors paints the ward mark at mount (named callback, called once), not only on a style change', () => {
  const src = readFileSync('src/scripts/climate-engine/v2/heat-v2.ts', 'utf8');
  assert.match(src, /const syncMark = \(\): void => \{ if \(sym && lst\) sym\.style\.color = lst\.style\.color \|\| ''; \};/);
  assert.match(src, /attributeFilter: \['style'\] \}, syncMark\); syncMark\(\);/);
});

/* ── A-S3 audit F4: a scroll cue on the right column ── */
test('F4: heat.css fades the column while data-v2-more is 1 (keyword colours only), and heat-v2.ts maintains the flag', () => {
  const css = strip(CSS('heat.css'));
  assert.match(css, /#legend\.heat-panel\[data-v2-more="1"\] \{[^}]*mask-image: linear-gradient\(to bottom, black calc\(100% - 28px\), transparent\)/);
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css), 'heat.css spells a colour literal');
  const src = readFileSync('src/scripts/climate-engine/v2/heat-v2.ts', 'utf8');
  assert.ok(src.includes('dataset.v2More') && src.includes("'scroll'"), 'the flag is not maintained on scroll');
});

/* ── A-S3 audit F10: both colour keys read Comfortable → Extreme, the direction of the ramp above them ── */
test('F10: the temperature card\'s key and the legend card\'s key list the classes in the ramp\'s order (h1..h5)', () => {
  const order = (html) => [...html.matchAll(/<i class="hk h(\d)"><\/i>/g)].map((m) => m[1]).join('');
  assert.equal(order(V2('TempCard.astro')), '12345');
  assert.equal(order(V2('HeatCards.astro')), '12345');
});
