import assert from 'node:assert/strict';
import test from 'node:test';

import { CITIES } from '../../src/data/cities.ts';
import { AREA_KEYS, splitKey } from '../../src/scripts/climate-engine/scope/registry.ts';

/**
 * `showcase` NAMES THE WARD WORTH OPENING FIRST, NOT "THE FIRST ONE".
 *
 * Bengaluru declares indiranagar first in the registry, but its citable
 * landmarks are in MG Road; a reader who follows the badge's link should land
 * where the city is recognisable, not wherever the array happens to start.
 */
test('Bengaluru declares when it arrived and which ward represents it', () => {
  const blr = CITIES.bengaluru;
  assert.ok(blr, 'the registry has no bengaluru city record');
  assert.equal(blr.showcase, 'mg-road',
    'MG Road is the ward with the citable landmarks (Vidhana Soudha, UB Tower)');
});

test('Kolkata declares no arrival date, so it is never announced as new', () => {
  assert.equal(CITIES.kolkata.since, undefined,
    'Kolkata predates the badge; a date here would advertise the city the reader is already in');
});

/**
 * A REGEX CANNOT TELL A REAL DATE FROM A DIGIT-SHAPED STRING.
 *
 * `/^\d{4}-\d{2}-\d{2}$/` accepts '2026-13-01', which Date.parse turns into NaN —
 * and Task 2's filter is Number.isFinite(since), so an impossible month means the
 * city is NEVER announced, silently. It also accepts '2026-09-31', which does NOT
 * produce NaN: V8 rolls it forward to 2026-10-01, so a day typo silently shifts the
 * announcement window instead of failing anything. Parse it and round-trip it back
 * to the string it started as; loop over every city so a later addition is covered
 * for free.
 */
test('every declared arrival date is a real day, and the day it names', () => {
  let checked = 0;
  for (const [id, city] of Object.entries(CITIES)) {
    if (city.since === undefined) continue;
    const t = arrivedMs(city);
    assert.ok(Number.isFinite(t),
      `${id}.since "${city.since}" is not a real date; newCityToAnnounce would silently never announce it`);
    assert.equal(new Date(t).toISOString().slice(0, 10), city.since,
      `${id}.since "${city.since}" is not the day it names — Date.parse rolled it over`);
    checked += 1;
  }
  // Guard the guard: if no city declared a `since`, the loop above would pass
  // while checking nothing, and the badge could never fire for anyone.
  assert.ok(checked > 0,
    'no city declares an arrival date, so this loop checked nothing — and the badge can never fire');
});

/**
 * `showcase` IS A WARD ID, BUT IT MUST ALSO RESOLVE AS AN AREA ID.
 *
 * cities.ts's `wards` array and scope/registry.ts's `AREA_KEYS` are two separate
 * namespaces. They are only cross-checked, in obos-scope.test.mjs, for areas that
 * ship data — and all three Bengaluru areas are shipsData: false, so nothing forces
 * a ward id to equal its area id. Task 2 resolves `showcase` against AREA_KEYS, so a
 * future city with a showcase spelled differently from its area slug (e.g.
 * 'mgroad') would pass every other gate and silently fall back to the first
 * drawable area instead of the founder's chosen ward.
 */
test('every declared showcase is a ward of its own city and an area the instrument can open', () => {
  for (const [id, city] of Object.entries(CITIES)) {
    if (city.showcase === undefined) continue;
    assert.ok(city.wards.some((w) => w.id === city.showcase),
      `${id}.showcase "${city.showcase}" is not one of its wards`);
    assert.ok(AREA_KEYS.some((k) => splitKey(k).city === id && splitKey(k).area === city.showcase),
      `${id}.showcase "${city.showcase}" is not a registered area id — newCityToAnnounce `
      + 'would silently fall back to the first drawable area');
  }
});

import {
  DISMISSED,
  NEW_CITY_DAYS,
  arrivedMs,
  newCityKey,
  newCityToAnnounce,
  wasDismissed,
  rememberDismissed,
} from '../../src/scripts/climate-engine/shell/new-city.ts';

/** A store that records writes, like the ones obos-shell.test.mjs uses. */
const fakeStore = (seed = {}) => {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
  };
};

/** A store that throws on both halves — a private window, or blocked site data. */
const hostileStore = () => ({
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('SecurityError'); },
});

const DAY = 86_400_000;
const ARRIVED = Date.parse('2026-09-16T00:00:00Z');

test('a city inside the window is announced, and names its showcase ward', () => {
  const found = newCityToAnnounce('kolkata', new Date(ARRIVED + 3 * DAY), fakeStore());
  assert.equal(found?.id, 'bengaluru');
  assert.equal(found?.name, 'Bengaluru');
  assert.equal(found?.href, '/heat-map/in/bengaluru/mg-road/');
  assert.equal(found?.since, '2026-09-16',
    'the arrival date travels to the client: these pages are prerendered, so the window '
    + 'was checked against the build clock and the browser must re-check it before revealing');
});

test('the window is ninety days: a city 89 days old is still announced, 91 days old is not', () => {
  /* LITERALS ON PURPOSE. Deriving the boundary from NEW_CITY_DAYS — as this test
     first did — makes the constant cancel out of its own guard: cutoff lands one
     day after arrival for D = 1, 90 or 90_000 alike, so every value passes and the
     ninety is pinned by nothing. Two literal days either side pin the number and
     the comparison at once. */
  const store = fakeStore();
  assert.equal(newCityToAnnounce('kolkata', new Date(ARRIVED + 89 * DAY), store)?.id, 'bengaluru',
    'a city 89 days old is inside a ninety-day window');
  assert.equal(newCityToAnnounce('kolkata', new Date(ARRIVED + 91 * DAY), store), null,
    'a city 91 days old is outside it, and the badge retires itself');
  assert.equal(NEW_CITY_DAYS, 90,
    'the two day counts above are written against a ninety-day window');
});

test('a city is not announced before it arrives', () => {
  const early = new Date(ARRIVED - DAY);
  assert.equal(newCityToAnnounce('kolkata', early, fakeStore()), null);
});

test('the reader is never told about the city they are already in', () => {
  const when = new Date(ARRIVED + DAY);
  assert.equal(newCityToAnnounce('bengaluru', when, fakeStore()), null);
});

test('a dismissed city stays dismissed, and only that city', () => {
  const store = fakeStore();
  const when = new Date(ARRIVED + DAY);
  assert.equal(newCityToAnnounce('kolkata', when, store)?.id, 'bengaluru');
  rememberDismissed('bengaluru', store);
  assert.equal(store.data[newCityKey('bengaluru')], 'dismissed',
    'the stored value is spelled out here ON PURPOSE: asserting it against DISMISSED would '
    + 'cancel out of its own guard the way the ninety-day window once did. This string is '
    + 'already in real readers’ localStorage — change it and everyone who put the badge '
    + 'away gets it back');
  assert.equal(DISMISSED, 'dismissed',
    'and the exported constant IS that wire value — if these two ever disagree, the module '
    + 'is writing a value its own readers cannot match');
  assert.equal(wasDismissed('bengaluru', store), true);
  assert.equal(wasDismissed('someplace-else', store), false);
  assert.equal(newCityToAnnounce('kolkata', when, store), null);
});

test('the key is namespaced like every other preference this console stores', () => {
  assert.equal(newCityKey('bengaluru'), 'obos:new-city:bengaluru');
});

test('an unreadable store shows the badge rather than swallowing it', () => {
  const when = new Date(ARRIVED + DAY);
  assert.equal(newCityToAnnounce('kolkata', when, hostileStore())?.id, 'bengaluru');
  assert.equal(wasDismissed('bengaluru', hostileStore()), false);
  assert.doesNotThrow(() => rememberDismissed('bengaluru', hostileStore()));
});

test('a null store is the same as no store, never a crash', () => {
  const when = new Date(ARRIVED + DAY);
  assert.equal(newCityToAnnounce('kolkata', when, null)?.id, 'bengaluru');
  assert.doesNotThrow(() => rememberDismissed('bengaluru', null));
});

/**
 * THE NEWEST CANDIDATE IS THE ONLY CANDIDATE.
 *
 * `CITIES` and `scope/registry.ts` are already divergent — Dubai is declared with
 * three areas that are all `drawable: false` — so "a newer city the instrument
 * cannot open" is an ordinary state, not a contrived one. A loop that walked past
 * it would hand the badge to Bengaluru, the SECOND-newest, while this module's own
 * docblock promises the most recent arrival wins. Nothing else in the suite would
 * notice, because every other test has exactly one candidate.
 */
test('a newer city the instrument cannot open silences the badge, never demotes it to the runner-up', () => {
  CITIES.northwich = {
    id: 'northwich', name: 'Northwich', country: 'India',
    cellMeters: 30, wards: [], since: '2026-09-20',
  };
  try {
    const when = new Date(Date.parse('2026-09-21T00:00:00Z'));
    assert.equal(newCityToAnnounce('kolkata', when, fakeStore()), null,
      'Northwich is newer than Bengaluru and has no registered area, so there is nothing to '
      + 'announce — naming Bengaluru here would tell the reader they just gained a city they '
      + 'did not, in a way that looks like success');
  } finally {
    delete CITIES.northwich;
  }
});

import { readFile } from 'node:fs/promises';

/* SOURCE ASSERTIONS, for the reason obos-shell.test.mjs states at its head: an
   .astro component cannot be imported under `node --import tsx --test`. Each one
   names the property of the source it reads and why that forces the property of
   the rendered page that matters. */
const stage = await readFile(
  new URL('../../src/components/ClimateEngine/HeatMapStage.astro', import.meta.url), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ').trim();

/* THE BADGE'S OWN MARKUP, AND NOT A CHARACTER MORE. Slicing to `</div>` alone
   assumed the badge contains no element of its own: wrapping the link in a layout
   div would move that closing tag and silently re-point every assertion below at
   markup the badge does not own. Stop at whichever comes first — the close, or the
   next element — so a nested div FAILS these tests instead of escaping them. */
const badgeInner = (markup) => {
  const start = markup.indexOf('<div class="newcity"');
  assert.notEqual(start, -1, 'the badge container is missing');
  const block = markup.slice(start);
  const ends = [block.indexOf('</div>'), block.indexOf('<div', 1)].filter((i) => i !== -1);
  return block.slice(0, ends.length > 0 ? Math.min(...ends) : block.length);
};

test('the badge is a link with a SIBLING dismiss button, never a button inside a link', () => {
  const markup = flat(stage);
  assert.match(markup, /<div class="newcity" id="newCity"[^>]*>/,
    'the badge container is missing');
  const inner = badgeInner(markup);
  assert.match(inner, /<a [^>]*href=/, 'the badge must contain a real link');
  assert.match(inner, /<button [^>]*id="newCityHide"/, 'the dismiss control must be a button');
  /* GUARDED AGAINST -1, which is what indexOf returns for absent — and -1 is less
     than every real index, so a badge that had lost its </a> altogether would have
     satisfied this comparison rather than failed it. */
  const linkEnd = inner.indexOf('</a>');
  const buttonStart = inner.indexOf('<button');
  assert.ok(linkEnd !== -1 && buttonStart !== -1 && linkEnd < buttonStart,
    'the button must CLOSE the link before opening: a button inside an anchor is invalid '
    + 'HTML and traps keyboard users');
});

test('the link keeps its own visible text as its name, and the phone rule keeps the eyebrow', () => {
  const markup = flat(stage);
  const inner = badgeInner(markup);
  /* LABEL IN NAME (WCAG 2.5.3, level A). The visible text is "New city Bengaluru →";
     an aria-label of "Bengaluru — newly added city" REPLACED that with a string the
     visible words are not contained in, so a speech-input user saying "click New
     city" matched nothing. On a desktop the override was never needed — the visible
     text already says it — and on a phone it existed only to restore an eyebrow that
     `display:none` had removed from the name. Deleting the label and clipping the
     eyebrow fixes both ends at once, which is why these two assertions sit together:
     either one alone would let the other regress. */
  /* THE NEGATIVE NEEDS SOMETHING TO STAND ON. `doesNotMatch` passes VACUOUSLY on an
     empty or shortened slice — which is exactly what the nested-div mutation does to
     it — so without this line the neighbouring positive assertions are the only
     reason that mutation fails, and this one is along for the ride. */
  assert.match(inner, /<a /, 'the badge must still contain the link this test is about');
  assert.doesNotMatch(inner, /<a [^>]*aria-label/,
    'the link must not override its own visible text: the accessible name has to CONTAIN '
    + '"New city", and the visible eyebrow already puts it there');
  assert.match(inner, /<button [^>]*aria-label="Dismiss"/, 'a bare × has no accessible name');
  assert.match(markup, /\.newcity \.nc-eyebrow\{position:absolute;[^}]*clip-path:inset\(50%\)/,
    'on phones the eyebrow must be CLIPPED rather than display:none — display:none takes '
    + '"New city" out of the accessible name as well as off the screen, which is the very '
    + 'thing the deleted aria-label was papering over');
  assert.doesNotMatch(markup, /\.newcity \.nc-eyebrow\{display:none\}/,
    "display:none on the eyebrow silently shortens the link's accessible name");
  assert.match(markup, /\.newcity a:focus-visible,\.newcity button:focus-visible\{outline:/,
    'both controls need a visible focus ring — they sit on a bronze fill, where the '
    + "browser's default ring is nearly invisible");
});

/**
 * WCAG 2.5.8, AND NOTHING ELSE IN THE SUITE WILL EVER CATCH IT.
 *
 * The dismiss button measured 23.7 x 28.8 px at every viewport from 390 to 1600 —
 * under the 24px floor on width. The spacing exception does not apply: `gap:2px`
 * puts the link's edge 2px away. The badge ships `hidden`, so an axe scan walks
 * straight past it, and the phone rule used to shrink the LINK's padding while
 * leaving the button exactly as it was.
 */
test('the dismiss target is big enough to hit, on a desktop and on a phone', () => {
  const css = flat(stage);
  assert.match(css, /\.newcity button\{[^}]*min-inline-size:28px/,
    'the dismiss button needs an explicit minimum width — padding alone left it 23.7px');
  assert.match(css, /\.newcity button\{min-inline-size:30px/,
    'and 30px under the coarse-pointer gate, matching .rn-x, the next smallest control '
    + 'a phone offers');
});

/**
 * THE BERTH IS A CLASS FIX, AND THE TEST HAS TO GUARD IT AS ONE.
 *
 * Three overlays centre themselves in the map's free space — `.synthetic`,
 * `.stamp-slot`, `.loadchip` — and a fixed-left badge has now collided with two of
 * them: the banner at 1280, then the construction stamp at every width from 600 to
 * 1380 once the badge moved below the banner. Pinning the badge's `top` would guard
 * the instance; this guards the rule, so the third overlay and the fourth are
 * covered before anyone measures them.
 */
test('the centred overlays berth around the badge rather than under it', () => {
  const css = flat(stage);
  const declared = css.match(/\.map:has\(\.newcity:not\(\[hidden\]\)\)\{--badge-berth:(\d+)px\}/);
  assert.ok(declared,
    'the berth must be declared on a REVEALED badge — scoping it to :has() keeps the '
    + 'full width on every page that never shows one');
  /* DERIVED, NOT COPIED: the badge's 14px left inset + its 118px measured width. A
     berth under that is a berth the badge sticks out of. */
  assert.ok(Number(declared[1]) >= 132,
    `--badge-berth is ${declared[1]}px, under the badge's own 132px extent (14px inset `
    + '+ 118px measured width) — the overlays would centre straight back into it');
  for (const sel of ['.synthetic', '.stamp-slot', '.loadchip']) {
    assert.match(css, new RegExp(`\\${sel}\\{[^}]*inset-inline:var\\(--badge-berth`),
      `${sel} centres itself in the map's free space, so it must subtract the badge's `
      + 'berth first — exactly as it already subtracts --instr-berth on the right');
  }
});

test('the badge renders only where it can be true', () => {
  const markup = flat(stage);
  /* `[,)]` so the call may take arguments. It now passes the store explicitly as
     null — the server must never consult a reader's dismissal — and pinning the
     one-argument spelling would have failed that correction while the rule it
     guards, "ask the module rather than decide for yourself", stayed intact. */
  assert.match(markup, /newCityToAnnounce\(scope\.city\.id[,)]/,
    'the component must ask the module, not decide for itself');
  assert.match(markup, /newCityToAnnounce\(scope\.city\.id, new Date\(\), null\)/,
    'and it must pass the store as NULL: `defaultStore()` is empty under Node only by '
    + 'accident, and one dismissal at BUILD time would silence the badge for everyone');
  assert.match(markup, /newCity &&/,
    'nothing renders when there is no city to announce');
  assert.match(markup, /data-since=\{[^}]*since\}/,
    'the arrival date must travel to the client: these pages are prerendered, so the shell '
    + 'has the only live clock and needs the date to re-check the window');
  assert.match(markup, /id="newCity"[^>]*hidden/,
    'it ships hidden: the shell reveals it only after checking the live window and the '
    + "reader's own dismissal, so a dismissed reader never sees it flash");
});

test('the badge is a paper postcard with a torn stub, and no border', () => {
  const css = flat(stage);
  assert.ok(css.includes('.newcity{'), 'the badge has no CSS rule');
  /* TO THE CLOSING BRACE, NOT A FIXED WINDOW. `+ 400` ran 188 characters PAST the
     rule's closing brace, and would swallow whatever followed as the rule grew.

     MEASURED, BECAUSE THE FIRST VERSION OF THIS COMMENT WAS FALSE. It claimed the
     window could satisfy `border:0` from `.newcity button{…}` — but in the file that
     shipped it, that rule began 568 characters after `.newcity{`, far outside a
     400-character window whose tail ended mid-`.nc-eyebrow`. Deleting `border:0`
     from the base rule made the old window match neither. The change is still right;
     the reason given for it was not, and "measure, don't read" is the rule this repo
     keeps paying to relearn. */
  const start = css.indexOf('.newcity{');
  const rule = css.slice(start, css.indexOf('}', start) + 1);
  assert.match(rule, /var\(--paper\)/,
    'the card is paper, and it must be the token — a third off-white spelled here would '
    + 'trip obos-layers.test.mjs and put the card outside the palette the console speaks');
  /* THE TORN STUB IS THE WHOLE IDEA, so it gets its own guard. It is a gradient
     LAYER over the flat fill rather than a shape, which keeps the card one box for
     layout, focus and hit-testing — and makes it exactly the kind of declaration a
     later tidy-up deletes as decorative noise, with nothing failing. */
  assert.match(rule, /radial-gradient\(circle at 0 50%,transparent 0 3px/,
    'the left edge must keep its 3px bite: without it this is a plain rounded label, '
    + 'not the torn stub the design asks for');
  /* THE TOKEN, NOT THE HEX. This assertion read /color:#0d0a05/ until the badge
     shipped: writing the literal here made it the fourth spelling of that colour in
     HeatMapStage.astro, and obos-layers.test.mjs refuses a second spelling of any
     hex in this file — a token declaration included, since it counts occurrences.
     The name still says "bronze-ink" because that is what Footer.astro called this
     near-black first; the card is paper now, and the ink is the same ink. */
  assert.match(rule, /color:var\(--bronze-ink\)/,
    'the text must be the near-black, AS THE TOKEN — off-black on paper, not a second '
    + 'spelling of the same colour');
  assert.match(rule, /border:0/, 'the founder asked for no border');
  assert.match(rule, /position:absolute/, 'it is pinned to the frame, not floating over the model');
});
