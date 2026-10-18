// tests/unit/obos-v2-honesty-markup.test.mjs — OBOS v2 spec §5 [H] (plan S3.2 Step 3, S3.3; A1 path: screens/overview.css)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { airKind } from '../../src/scripts/climate-engine/v2/heat-v2.ts';

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

test('H11: v1\'s building-card wording survives, every text node and every label, word for word and as many times (A-S4 audit F5)', () => {
  const v1 = bcardOf(STAGE, '<div class="bcard" id="bcard"');
  const v2 = V2('BuildingCardV2.astro');
  /* count-aware and exact: a short v1 label ("Building") cannot hide inside a longer one ("Building height unverified…") */
  const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
  const have = count([...textsOf(v2), ...attrsOf(v2)]);
  const missing = [...count([...textsOf(v1), ...attrsOf(v1)])].filter(([t, n]) => (have.get(t) ?? 0) < n).map(([t]) => t);
  assert.deepEqual(missing, [], 'text v1 prints that the v2 card lost');
});

test('H13 (A-S4 audit F2): each floor sits beside ITS headline: the strict-mask floor with the SHADING loss, the capacity floor stays inside Installable\'s own small', () => {
  const v2 = V2('BuildingCardV2.astro');
  const row = /<div class="interval">([^]*?)<\/div>/.exec(v2)[1];
  assert.ok(row.includes('id="bcSolLoss"') && row.includes('id="bcSolFloor"'), 'the shading loss and its strict floor must share the row');
  assert.ok(!row.includes('id="bcSolKwp"'), 'the capacity headline must not be paired with the shading floor');
  /* the app's own templates say which floor is which (heat-map-app.ts paintSolarCard) */
  const app = readFileSync('src/scripts/climate-engine/heat-map-app.ts', 'utf8');
  assert.match(app, /setHTML\('bcSolKwp', `\$\{r\.kwpLow\.toFixed\(1\)\}–\$\{r\.kwpHigh\.toFixed\(1\)\} kWp<small>floor \$\{r\.kwpLow/, 'the capacity floor is printed inside #bcSolKwp');
  assert.match(app, /setHTML\('bcSolFloor', `\$\{pct\(pv\.loss_strict\[i\]\)\}<small>under a strict roof mask/, '#bcSolFloor is the strict-mask floor of the shading loss');
  assert.match(app, /Shading \$\{pct\(pv\.loss\[i\]\)\} headline, \$\{pct\(pv\.loss_strict\[i\]\)\} floor/, 'the app\'s own ladder pairs loss with loss_strict');
});

test('H13 (A-S4 audit F2): the rows keep v1\'s order: Installable, Yield, Shaded, At least, Raised 2 m, Worth', () => {
  const order = (html) => [...html.matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1]).filter((t) => ['Installable', 'Yield', 'Shaded', 'At least', 'Raised 2 m', 'Worth'].includes(t));
  const v1 = bcardOf(STAGE, '<div class="bcard" id="bcard"');
  assert.deepEqual(order(V2('BuildingCardV2.astro')), order(v1));
  assert.deepEqual(order(v1), ['Installable', 'Yield', 'Shaded', 'At least', 'Raised 2 m', 'Worth']);
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

/* ── A-S3 audit F1: the air row's provenance follows the app's own source decision (was tests/unit/obos-v2-air-kind.test.mjs; moved into a file Track A owns) ── */
test('a fresh airport report is OBSERVED, solid', () => {
  assert.deepEqual(airKind(true, true), { text: 'observed', cls: 'measured', mark: 'measured', showMark: true });
});
test('Met Norway is a FORECAST, outlined: never "observed"', () => {
  assert.deepEqual(airKind(false, true), { text: 'forecast', cls: 'modelled', mark: 'modelled', showMark: true });
});
test('no reading at all says so and draws no air mark', () => {
  assert.deepEqual(airKind(false, false), { text: 'no reading', cls: 'modelled', mark: 'modelled', showMark: false });
});
test('an observation without a number is not drawn as observed (the airport said nothing usable)', () => {
  assert.equal(airKind(true, false).showMark, false);
  assert.notEqual(airKind(true, false).text, 'observed');
});

test('the card ships in the safe state: forecast, outlined, until the app says otherwise; the disc colour is the ink token', () => {
  const card = readFileSync('src/components/ClimateEngine/v2/TempCard.astro', 'utf8');
  assert.ok(card.includes('<span class="kind modelled" data-v2-airkind>forecast</span>'));
  assert.ok(card.includes('<span class="air-sym" data-v2-airsym><Sym shape="disc" c="ink" kind="modelled" size={26} /></span>'));
  assert.ok(!/kind measured">observed/.test(card), 'the card hard-codes "observed"');
});

test('the binder listens to the app\'s own source event and mounts with the shell', () => {
  const src = readFileSync('src/scripts/climate-engine/v2/heat-v2.ts', 'utf8');
  assert.ok(src.includes("'obos:observed'"));
  const shell = readFileSync('src/scripts/climate-engine/v2/shell-v2.ts', 'utf8');
  assert.ok(shell.includes('bindMirrors(ctx)'), 'bindMirrors is the mount point');
  assert.match(src, /export function bindMirrors[^]*bindAirKind\(ctx\)/, 'bindMirrors must start the air-kind binder');
});

/* ── S5: Explore the ward, Scenarios, the no-artefacts page ── */
const PANE = readFileSync('src/components/ClimateEngine/shell/InterventionPane.astro', 'utf8');

test('S5.1: the Explore panel hosts the real switcher and the real toolbox, once, and nothing else owns their ids', () => {
  const ex = V2('ExploreSide.astro');
  assert.match(ex, /<div class="sp-body ov-panel" data-side-pane="explore">/);
  assert.ok(ex.includes('<ScopeSwitcher current={scope.key} />'), 'the app\'s own Location switcher');
  assert.ok(ex.includes('<InterventionPane scope={scope} />'), 'the app\'s own toolbox');
  assert.ok(ex.includes('Explore the ward') && ex.includes('Every result is the live map’s own.'));
  assert.ok(ex.includes('data-side-close'), 'the panel closes through the shell\'s own handler');
  assert.ok(!/<ScopeSwitcher|<InterventionPane/.test(V2('ParkA1.astro').replace(/^---[\s\S]*?---/, '')), 'the parked copies must be gone');
});

test('S5.1: the toolbox keeps v1\'s real ranges and steps (the pane file is unchanged and v2 never types a range)', () => {
  assert.ok(PANE.includes('id="ivTrees" min="0" max="50" value="0"'));
  assert.ok(PANE.includes('id="ivRoof" min="0" max="100" value="0" step="5"'));
  assert.ok(PANE.includes('id="ivFacades" min="0" max="15" value="0"'));
  assert.ok(!/type="range"/.test(V2('ExploreSide.astro')), 'v2 must not draw its own sliders');
});

test('H16: Resilience says "Coming soon" and the score block stays withdrawn (inert, hidden): no number is ever drawn', () => {
  assert.ok(PANE.includes('WITHDRAWN 2026-09-17'));
  assert.ok(PANE.includes('<p class="soon"><b>Resilience Score</b><span>Coming soon</span></p>'));
  const css = strip(CSS('explore.css'));
  assert.match(css, /\.scorebox\[data-soon\] \.scorebox-body \{ display: none; \}/);
});

test('S5.1: no-data Explore carries v1\'s empty-toolbox text word for word', () => {
  const stageBlock = /<p class="pane-h" id="pane-map-h">Interventions<\/p>([\s\S]*?)<\/section>/.exec(STAGE)?.[1];
  assert.ok(stageBlock, 'v1\'s no-data pane text moved');
  const norm = (t) => t.replace(/\{' '\}/g, ' ').replace(/\s+/g, ' ').trim();
  const wanted = [...stageBlock.matchAll(/<p class="pane-note">([\s\S]*?)<\/p>/g)].map((m) => norm(m[1]));
  const ex = norm(V2('ExploreSide.astro'));
  for (const w of wanted) assert.ok(ex.includes(w), `v1 sentence missing from ExploreSide: ${w.slice(0, 60)}`);
});

test('S5.1: v2 restyles the v1 select control without a second copy: the scoped v1 colours are overridden under the v2 root', () => {
  const css = strip(CSS('explore.css'));
  for (const sel of ['.field', '.field-key', '.field-value', '.field-list', '.scope-tier']) assert.ok(css.includes(sel), `${sel} is not restyled`);
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css), 'explore.css spells a colour literal');
});

test('H16/S5.2: Scenarios keeps v1\'s statement (renamed to v2\'s place) and the withdrawal date from its source', () => {
  const sc = V2('ScenarioCards.astro');
  const v1 = /<p class="pane-note">(Not built yet\.[\s\S]*?)<\/p>/.exec(STAGE)?.[1].replace(/\s+/g, ' ').trim();
  assert.ok(v1, 'v1\'s Scenarios text moved');
  assert.ok(sc.includes(v1.replace('under Map', 'under Overview')), 'the statement is not v1\'s, bar the one renamed place (spec §4.7, founder sign-off)');
  assert.ok(sc.includes('The scoring model it would draw on is already here'));
  assert.ok(sc.includes('Withdrawn on 17 Sep 2026. No score is shown until it returns.'));
  assert.ok(sc.includes('data-sections="scenarios"'));
});

test('S5.2: the no-artefacts card is v1\'s .notyet, word for word, inside the right column on Dubai only', () => {
  const sc = V2('ScenarioCards.astro');
  const v1 = /<section class="notyet"[\s\S]*?<\/section>/.exec(STAGE)?.[0];
  assert.ok(v1);
  const norm = (t) => t.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/<[^>]+>/g, '|').replace(/\s+/g, ' ').replace(/\|( \|)+/g, '|').trim();
  for (const part of norm(v1).split('|').map((x) => x.trim()).filter((x) => x.length > 12)) assert.ok(norm(sc).includes(part), `not-yet text missing: ${part}`);
  assert.match(sc, /scope\.area\.hasData \? \([\s\S]*?\) : \([\s\S]*class="card notyet"/, 'the card shows on no-data areas only');
  assert.ok(!V2('ParkA2.astro').includes('notyet'), 'the parked copy must be gone');
});

test('S5: the Explore text for every area is derived, never an empty slab: ExploreSide always has the head and a scroller', () => {
  const ex = V2('ExploreSide.astro');
  assert.ok(ex.includes('<div class="sp-head">') && ex.includes('<div class="sp-scroll">'));
});

test('A-S3 F3 closed: no stopgap click survives in Track A\'s honesty spec (phase() is a real click on a visible control)', () => {
  const spec = readFileSync('tests/e2e/obos-v2-honesty.spec.ts', 'utf8');
  assert.ok(!/evaluate\([^)]*\.click\(\)/.test(spec), 'an evaluate(... .click()) remains in obos-v2-honesty.spec.ts');
  assert.match(spec, /const phase = async \(page: Page, p: string\): Promise<void> => \{[\s\S]*?closest\('\[data-v2-parking\]'\)[\s\S]*?await b\.click\(\);/);
});

/* ── A-S4 audit F3: the Under Construction stamp is a visible chip in the ward card's header ── */
test('F3: the stamp sits in the ward card above the foldable body (its header block), and is styled as a stamp (ink border, no bronze)', () => {
  const ms = V2('MapStack.astro');
  const stamp = ms.indexOf('<ConstructionStamp class="chip line" />'), body = ms.indexOf('<div class="wc-body">'), crumb = ms.indexOf('data-v2-crumb');
  assert.ok(stamp > crumb && stamp < body, 'the stamp must be in the header, before .wc-body');
  assert.equal((ms.match(/<ConstructionStamp/g) ?? []).length, 1);
  const css = strip(CSS('mapstack.css'));
  assert.match(css, /\.wardc \.con-stamp \{[^}]*border: 1px solid var\(--ink-1\)/);
  assert.ok(!/bronze/.test(css));
});

/* ── A-S4 audit F7: ramp colours are marks, not text colours, on the building card (Light AA) ── */
test('F7: the "vs ward mean" figure is ink with a ramp-coloured underline mark, never ramp-coloured text', () => {
  const css = strip(CSS('building.css'));
  assert.match(css, /#bcard \.bc-ins :is\(\.hot, \.cool\) \{[^}]*color: var\(--ink-1\)[^}]*box-shadow: inset 0 -2px 0 var\(--heat-5\)/);
  assert.match(css, /#bcard \.bc-ins \.cool \{[^}]*box-shadow: inset 0 -2px 0 var\(--heat-1\)/);
  assert.ok(!/\.bc-ins \.(hot|cool) \{ color: var\(--heat/.test(css), 'a ramp colour is still set as text colour');
});
