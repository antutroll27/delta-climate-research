// tests/unit/obos-v2-phone.test.mjs — OBOS v2 spec §3, §7.3–7.4, decision C11 (S8): the phone's contracts that need no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { decideGlass } from '../../src/scripts/climate-engine/v2/glass.ts';
import { PHONE_QUERY } from '../../src/scripts/climate-engine/v2/phone-v2.ts';

const read = (f) => readFileSync(f, 'utf8');
const CHROME = read('src/components/ClimateEngine/v2/PhoneChrome.astro');
const CSS = read('src/styles/obos-v2/phone.css');
const GLASS = { cards: 'glass', baseTier: 2, coarsePointer: false, softwareRenderer: false, reducedTransparency: false, supportsBackdrop: true, saveData: false, demoted: false };

test('the phone query is the spec\'s, and phone.css answers the SAME query (one definition of "phone")', () => {
  assert.equal(PHONE_QUERY, '(max-width: 699px), (pointer: coarse) and (max-height: 560px)');
  assert.ok(CSS.includes(`@media ${PHONE_QUERY} {`), 'the phone block must use the query phone-v2.ts matches');
  assert.ok(CSS.includes('@media (max-width: 699px) and (orientation: landscape), (pointer: coarse) and (max-height: 560px) and (orientation: landscape) {'), 'the landscape block is the same query narrowed to landscape');
});

test('Glass is refused on a phone layout, even a narrow fine-pointer window (spec §2.3)', () => {
  assert.equal(decideGlass({ ...GLASS, phoneLayout: false }), 'live');
  assert.equal(decideGlass({ ...GLASS, phoneLayout: true }), 'flat');
  assert.equal(decideGlass(GLASS), 'live', 'a caller that does not know the layout is unchanged');
});

test('the drawer is a modal dialog with a heading and a close; the menu button names it (spec §7.3)', () => {
  assert.match(CHROME, /<button class="tw-menu card" type="button" data-v2-menu[^>]*aria-expanded="false"[^>]*aria-controls="v2Drawer"[^>]*aria-label="Sections and controls"/);
  assert.match(CHROME, /<div class="drawer" id="v2Drawer" role="dialog" aria-modal="true" aria-labelledby="v2DrawerH" tabindex="-1" data-open="false" data-modal="true"/);
  assert.match(CHROME, /<h2 class="sr-only" id="v2DrawerH" tabindex="-1" data-autofocus>Sections and controls<\/h2>/);
  assert.match(CHROME, /data-pop-close aria-label="Close the menu"/);
});

test('the sheet handle is a real <button aria-expanded aria-controls> (spec §7.4: no drag is required)', () => {
  assert.match(CHROME, /<button class="sheet-handle" type="button" data-v2-sheet-toggle aria-expanded="false" aria-controls="v2Sheet">/);
  assert.match(CHROME, /Show the readings/);
});

test('every piece of phone chrome is a direct child of the root, so the brief\'s print rule hides it without an edit (C audit F4)', () => {
  for (const f of ['src/components/ClimateEngine/v2/HeatMapStageV2.astro', 'src/components/ClimateEngine/compare/PairedBenchV2.astro', 'src/components/ClimateEngine/brief/HeatMapBriefV2.astro']) {
    const s = read(f);
    assert.ok(/<PhoneChrome/.test(s), `${f} renders the phone chrome`);
    const body = s.slice(s.indexOf('<main'));
    assert.ok(body.indexOf('<PhoneChrome') < body.indexOf('<RailV2'), `${f}: the menu button comes first in tab order`);
  }
  const brief = read('src/styles/obos-v2/print/brief.css');
  assert.match(brief, /\.brf-sheet/, 'print/brief.css hides every direct child but .brf-sheet');
});

test('the entry note and the rotate nudge carry v1\'s words, ids and hooks (H21), in the v2 overlays', () => {
  const o = read('src/components/ClimateEngine/v2/Overlays.astro');
  for (const t of ['id="entryNote"', 'data-entry-close', 'id="rotateNudge"', 'data-rn-dismiss', 'Best on a <span class="thin">bigger screen</span>', 'This is a full console — a live 3-D city, a heat field and its',
    'On a phone, turn it sideways for the full width.', 'Continue anyway', 'Turn your phone for the full instrument']) assert.ok(o.includes(t), t);
  assert.ok(!existsSync('src/components/ClimateEngine/v2/ParkS8.astro'), 'the parked copy is gone');
});

test('the credits chip keeps its full text for a sighted desktop and a short one on a phone, with the same link target', () => {
  const o = read('src/components/ClimateEngine/v2/Overlays.astro');
  assert.match(o, /<span class="at-lead">\{chipLead\}<\/span>\}Credits/);
  assert.match(CSS, /\.attrib \.at-lead \{ display: none; \}/);
});

test('phone.css writes no colour literal (tokens.css owns every hex)', () => {
  assert.doesNotMatch(CSS.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
});

test('Compare\'s phone note is the stage\'s, the method paragraph and both caveats, hidden above 699 px (C audit F5)', () => {
  const s = read('src/components/ClimateEngine/compare/PairedBenchV2.astro');
  const m = /<p class="body-s cmp-phone-note">([^<]*)<\/p>/.exec(s);
  assert.ok(m, 'one p.body-s.cmp-phone-note');
  for (const t of ['They are not a ward ranking.', 'Both sides come from one city.', 'Ballygunge is KMC Ward 68']) assert.ok(m[1].includes(t), t);
  assert.match(CSS, /\.cmp-phone-note \{ display: none; \}/);
});

/* ── brainstorm 04 §5 (20 Oct): the building card is a PEEK on a phone, not the sheet's first card ── */
test('a selected building no longer opens the sheet: phone-v2.ts has no card observer, and the card\'s own binder folds an open sheet instead', () => {
  const phone = read('src/scripts/climate-engine/v2/phone-v2.ts');
  assert.ok(!/observe\(cleanup, bcard,/.test(phone), 'phone-v2.ts still watches the card to open the sheet');
  assert.ok(!/const bcard = \$\(root, '#bcard'\);/.test(phone));
  const card = read('src/scripts/climate-engine/v2/card-v2.ts');
  assert.match(card, /handle\?\.getAttribute\('aria-expanded'\) === 'true'\) handle\.click\(\);/, 'an open sheet steps down so the roof and its peek are on the map');
  assert.match(card, /root\.style\.setProperty\('--v2-sheet-h'/, 'the peek stands on the sheet\'s top edge, from one custom property');
});

test('phone.css: the peek is above the sheet, 220 px of content at most, shows each floor beside its own headline, and grows from the SAME #bcard (no clone, no second id)', () => {
  assert.match(CSS, /\.obos-v2\[data-phone\] #bcard \{[^}]*bottom: calc\(var\(--v2-sheet-h, 250px\) \+ 8px\);[^}]*transform: none !important;/);
  assert.match(CSS, /#bcard\[data-peek="1"\] :is\(\.bc-ll, \.bc-s-v, \.bc-s-al, \.bc-lm, \.sol-kwh, \.sol-raised, \.sol-worth, \.bc-sol-note, \.bc-sure, \.bc-acts, \.bc-fold, \.bc-sol > \.bc-h, #bcSolLoss small\) \{ display: none; \}/);
  assert.match(CSS, /#bcard\[data-peek="1"\] \.bc-sol > dl > \.sol-kwp \{ grid-column: 1; \}/, 'the capacity and its floor stay in the peek');
  assert.match(CSS, /#bcard\[data-peek="1"\] \.bc-sol > dl > \.interval \{ grid-column: 2;/, 'Shaded and At least (the strict floor) stay together in the peek');
  assert.match(CSS, /#bcard\[data-peek="0"\] \{ top: 100px; bottom: 8px; z-index: 40; \}/);
  const card = read('src/components/ClimateEngine/v2/BuildingCardV2.astro');
  for (const id of ['bcExpand', 'bcGrip']) assert.equal((card.match(new RegExp(`id="${id}"`, 'g')) ?? []).length, 1, `#${id} once`);
  assert.match(card, /<button class="bc-grip" id="bcGrip" type="button" aria-expanded="false" aria-controls="bcBody" aria-label="Show all building details">/);
});
