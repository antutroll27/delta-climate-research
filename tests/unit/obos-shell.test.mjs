import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

/* THE ONE PART OF THE RAIL THAT IS NOT MARKUP, and so the one part that can be
   RUN rather than read. Everything else in this file is a source assertion
   because an .astro component cannot be imported here; the collapse preference
   is a .ts module, so its behaviour is exercised directly against stores that
   are empty, that hold junk, and that throw. */
import {
  COLLAPSED,
  EXPANDED,
  LAYOUT_PREPAINT,
  PANEL_STATE_ATTR,
  PANEL_STATE_KEY,
  RAIL_STATE_ATTR,
  RAIL_STATE_KEY,
  RAIL_TOGGLE_ID,
  readPanelCollapsed,
  readRailCollapsed,
  writePanelCollapsed,
  writeRailCollapsed,
} from '../../src/scripts/climate-engine/shell/layout-state.ts';

/* v1's IconRail, PanelToggle, stage and bench were deleted (PR 2): the rail, chevron, ground-colour, brand-mark and bench-markup tests that read them retired with them
   (v1 markup only; v2's menu, side panel and Compare have their own suites: obos-v2-split, obos-v2-compare-contract, obos-v2-contrast.spec). What is left tests live code
   (the collapse preference, which console-shell still reads) and the shared components v2 imports (switcher, tree, pane). */

/** Comments are not code. An id, an `<a>` or a label in prose must not count. */
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');

/** Whitespace-insensitive, so reformatting the component cannot silently pass. */
const flat = (s) => s.replace(/\s+/g, ' ').trim();

/* ═══════════════════════════════════════════════════════════════════════════
   THE COLLAPSE PREFERENCE — run, not read.

   A store that is merely EMPTY is the easy case and not the one that breaks:
   `localStorage` in a private window, or with site data blocked, throws a
   SecurityError at the PROPERTY, before getItem is reached. A `typeof` check
   outside a try is not a guard against that, and the failure mode is a rail that
   does not render at all rather than a rail that forgets.

   Each test below hands in its own store, so nothing here depends on the runner
   having a DOM.
   ═══════════════════════════════════════════════════════════════════════════ */

/** A store that holds what it is given. */
const fakeStore = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    read: (k) => (map.has(k) ? map.get(k) : null),
  };
};

/** A store that throws the way a blocked one does. */
const hostileStore = () => ({
  getItem() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  setItem() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
});

test('the rail defaults to expanded, and only an exact stored value collapses it', () => {
  assert.equal(readRailCollapsed(fakeStore()), false,
    'with nothing stored the rail must open EXPANDED -- the labels are the '
    + 'point of this change, and a first visit that hides them ships the old '
    + 'rail to everyone who has never pressed the chevron');

  assert.equal(readRailCollapsed(fakeStore({ [RAIL_STATE_KEY]: COLLAPSED })), true);
  assert.equal(readRailCollapsed(fakeStore({ [RAIL_STATE_KEY]: EXPANDED })), false);

  /* ANYTHING ELSE IS THE DEFAULT. The origin is shared with the rest of the site
     and this key is one string; a value left by an older build, or by a hand in
     devtools, must not put the rail into a state nothing can name. */
  for (const junk of ['', 'true', '1', 'COLLAPSED', 'collapse', '{"collapsed":true}']) {
    assert.equal(readRailCollapsed(fakeStore({ [RAIL_STATE_KEY]: junk })), false,
      `a stored value of ${JSON.stringify(junk)} collapsed the rail. Only the `
      + 'exact token this module writes may do that');
  }

  /* AND A VALUE UNDER SOME OTHER KEY IS NOT THIS ONE. */
  assert.equal(readRailCollapsed(fakeStore({ rail: COLLAPSED })), false);
});

test('an unreadable store leaves the rail expanded rather than unrendered', () => {
  /* WATCHED TO FAIL: with the try/catch removed from readRailCollapsed this
     throws out of the shell's mount, and a throw there takes the pane switcher
     and the scope selects down with it -- the rail's collapse preference would
     have disabled the console's entire navigation in a private window. */
  assert.equal(readRailCollapsed(hostileStore()), false);
  assert.equal(readRailCollapsed(null), false,
    'a null store must read as the default rather than throw on a property of it');
  assert.doesNotThrow(() => writeRailCollapsed(true, hostileStore()));
  assert.doesNotThrow(() => writeRailCollapsed(false, null));
});

test('a store that throws on ACCESS, before getItem, is still the default', () => {
  /* THE CASE A PASSED-IN STORE CANNOT REACH, and the one the browser actually
     produces. With site data blocked, `localStorage` raises a SecurityError at
     the PROPERTY — the object is never handed out, so a throwing `getItem` is a
     test of the wrong half and a `typeof` check outside a try is not a guard at
     all. Every other test here passes its own store and therefore never runs the
     line that reaches for the real one.

     WATCHED TO FAIL: taking the try/catch off the default-store lookup leaves
     every other test in this file green, which is how this one earned its place.
     Defined on globalThis rather than mocked, because the throw has to come from
     the property access itself. */
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  });
  try {
    assert.equal(readRailCollapsed(), false,
      'reading the rail preference with no readable storage threw instead of '
      + 'answering with the default. It is called from the shell mount, so this '
      + 'takes the pane switcher and the scope selects down with it');
    assert.equal(readPanelCollapsed(), false);
    assert.doesNotThrow(() => writeRailCollapsed(true));
    assert.doesNotThrow(() => writePanelCollapsed(true));
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had);
    else delete globalThis.localStorage;
  }
});

test('the preference round-trips through the store it was written to', () => {
  /* BOTH DIRECTIONS, and the second is the one worth writing down: a writer that
     only ever wrote the collapsed token would leave "expanded" indistinguishable
     from "never chosen", which is fine until the default changes. */
  const store = fakeStore();
  writeRailCollapsed(true, store);
  assert.equal(store.read(RAIL_STATE_KEY), COLLAPSED);
  assert.equal(readRailCollapsed(store), true);

  writeRailCollapsed(false, store);
  assert.equal(store.read(RAIL_STATE_KEY), EXPANDED);
  assert.equal(readRailCollapsed(store), false);
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE PANEL'S OWN COLLAPSE — a second door onto a state that already existed. (v1's chevron markup tests retired with PanelToggle.astro; the state is still run, below.)

   console-shell.ts has always put this column away when you click the rail
   section whose pane is open. Nobody could find it: nothing on the page says the
   active section is also a close button, and a touch reader never hovers into a
   hint. The chevron is the same discoverability fix as the rail's labels, one
   column over.

   TWO DOORS ARE ONLY SAFE IF THEY CANNOT DIVERGE, so most of what follows is
   about the single state and the single paint rather than about the button.
   ═══════════════════════════════════════════════════════════════════════════ */

/** console-shell.ts, comments stripped. Read by four tests below. */
async function shellSource() {
  const src = strip(await readFile(
    new URL('../../src/scripts/climate-engine/shell/console-shell.ts', import.meta.url),
    'utf8'));
  assert.ok(src.trim().length > 0, 'console-shell.ts read back empty');
  return src;
}

test('the panel preference is stored under its own key and defaults to open', () => {
  assert.equal(readPanelCollapsed(fakeStore()), false,
    "with nothing stored the panel must be OPEN -- it is the console's content, "
    + 'and a first visit that hides it ships an empty page with a rail on it');
  assert.equal(readPanelCollapsed(fakeStore({ [PANEL_STATE_KEY]: COLLAPSED })), true);
  assert.equal(readPanelCollapsed(fakeStore({ [PANEL_STATE_KEY]: EXPANDED })), false);
  assert.equal(readPanelCollapsed(hostileStore()), false);
  assert.doesNotThrow(() => writePanelCollapsed(true, hostileStore()));

  const store = fakeStore();
  writePanelCollapsed(true, store);
  assert.equal(store.read(PANEL_STATE_KEY), COLLAPSED);
  assert.equal(readPanelCollapsed(store), true);
  writePanelCollapsed(false, store);
  assert.equal(store.read(PANEL_STATE_KEY), EXPANDED);

  /* THE TWO FLAGS ARE NOT ONE FLAG. Stored under one key, collapsing the rail
     would take the panel with it and neither chevron could say why. */
  assert.notEqual(RAIL_STATE_KEY, PANEL_STATE_KEY);
  const both = fakeStore({ [RAIL_STATE_KEY]: COLLAPSED });
  assert.equal(readRailCollapsed(both), true);
  assert.equal(readPanelCollapsed(both), false,
    'a collapsed rail reads as a collapsed panel -- the two flags are sharing a '
    + 'key, so one chevron moves both columns');

  assert.ok(LAYOUT_PREPAINT.includes(JSON.stringify(PANEL_STATE_KEY)),
    'the pre-paint script never reads the panel preference, so a collapsed panel '
    + 'flashes open on every load before the module script puts it away');
  assert.ok(LAYOUT_PREPAINT.includes(JSON.stringify(PANEL_STATE_ATTR)),
    'the pre-paint script never sets the attribute the two stylesheets read');
});

test('the shell starts from the stored panel preference and writes it back', async () => {
  /* THE SERVER RENDERS ONE PANE OPEN, ALWAYS. Without this the stored preference
     would be read only by the pre-paint script: the CSS would hide the column
     while `state.open` stayed true, so the rail would show a pressed section over
     a panel that is not there and the first chevron press would close an
     already-closed panel. */
  const shell = await shellSource();
  assert.match(shell, /open: opened !== undefined && !readPanelCollapsed\(\)/,
    "console-shell.ts starts from the server's render alone and never asks "
    + 'whether the reader put the panel away. The stylesheet would hide it while '
    + 'the shell believed it open');
  assert.match(shell, /writePanelCollapsed\(!state\.open\)/,
    'nothing persists the panel state, so the chevron is forgotten on reload');
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE SCOPE SWITCHER — Country → City → Area, at the top of the sidebar.

   READ AS SOURCE, for the reason the rail's header gives: an .astro component
   cannot be imported into `node --import tsx --test`. But this control is not
   only markup — every value in it is now REAL, off the registry — so the
   data-driven claims are asserted against the REGISTRY ITSELF, imported below,
   and the source assertions only have to establish that the markup DERIVES from
   it rather than restating it.

   GUARD THE GUARD, and this suite has earned the paranoia: EIGHT guards in this
   project have passed while protecting nothing, one of them inside a test a plan
   specified verbatim. So, in this half:

     · an unreadable, empty or fenceless component FAILS (`switcherSource`)
     · a FIELDS table that parses to zero rows FAILS (`fieldTable`)
     · a CityTier union that parses to fewer than three values FAILS
     · a registry in which NO area lacks data FAILS the disabled test, because
       there would then be nothing for `disabled` to be true about
     · a registry in which EVERY area lacks data FAILS it too, because
       `disabled` would then be indistinguishable from "always on"
     · a registry with fewer than two countries FAILS the derivation test,
       because a switcher that cannot switch proves nothing about switching
   ═══════════════════════════════════════════════════════════════════════════ */

import { AREA_KEYS, splitKey } from '../../src/scripts/climate-engine/scope/registry.ts';
import { paths } from '../../src/scripts/climate-engine/scope/paths.ts';
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';

const SWITCHER = new URL(
  '../../src/components/ClimateEngine/shell/ScopeSwitcher.astro', import.meta.url);
const FIELD = new URL(
  '../../src/components/ClimateEngine/shell/SelectField.astro', import.meta.url);
const FIELD_TS = new URL(
  '../../src/scripts/climate-engine/shell/select-field.ts', import.meta.url);
const RESOLVE_TS = new URL(
  '../../src/scripts/climate-engine/scope/resolve.ts', import.meta.url);

/** The three scope levels the control has to offer. Not two, and not four. */
const LEVEL_IDS = ['area', 'city', 'country'];

async function switcherSource() {
  let src;
  try {
    src = await readFile(SWITCHER, 'utf8');
  } catch (err) {
    assert.fail(
      'src/components/ClimateEngine/shell/ScopeSwitcher.astro could not be read '
      + `(${err.code ?? err.message}) -- every assertion below reads it, so a `
      + 'missing file must fail rather than let the suite pass vacuously');
  }
  assert.ok(src.trim().length > 0, 'ScopeSwitcher.astro is empty -- nothing to check');

  const split = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  assert.ok(split, 'ScopeSwitcher.astro has no `---` frontmatter fence -- the tests '
    + 'below read the frontmatter and the template separately and cannot tell '
    + 'them apart without it');
  assert.ok(split[1].trim().length > 0,
    'ScopeSwitcher.astro has an EMPTY frontmatter -- the whole control derives '
    + 'from the registry there, and an empty one would satisfy the no-cast check '
    + 'by containing no code at all');

  const body = split[2];
  const styles = [...body.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)];
  return {
    frontmatter: strip(split[1]),
    template: strip(body.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')),
    styles,
    css: styles.map((m) => m[2]).join('\n'),
  };
}

/**
 * SelectField.astro, split the same way and guarded the same way.
 *
 * THE SWITCHER'S MARKUP LIVES HERE NOW. The card, the label, the <select> that
 * holds the value and the list the dropdown fills are all in this component, so
 * the assertions that used to read ScopeSwitcher's template FOLLOW THEM rather
 * than being dropped — which is the difference between a guard that moved and a
 * guard that was deleted for going red.
 */
async function fieldSource() {
  let src;
  try {
    src = await readFile(FIELD, 'utf8');
  } catch (err) {
    assert.fail(
      'src/components/ClimateEngine/shell/SelectField.astro could not be read '
      + `(${err.code ?? err.message}) -- it is the control the scope switcher is `
      + 'made of, and every assertion below reads it');
  }
  assert.ok(src.trim().length > 0, 'SelectField.astro is empty -- nothing to check');

  const split = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  assert.ok(split, 'SelectField.astro has no `---` frontmatter fence -- the tests '
    + 'below read the frontmatter and the template separately');
  assert.ok(split[1].trim().length > 0, 'SelectField.astro has an EMPTY frontmatter');

  const body = split[2];
  const styles = [...body.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)];
  const css = styles.map((m) => m[2]).join('\n');
  assert.ok(css.trim().length > 0, 'SelectField.astro ships no CSS -- the rules the '
    + 'tests below look for could not be absent for any other reason');
  return {
    frontmatter: strip(split[1]),
    template: strip(body.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')),
    styles,
    css,
  };
}

/** shell/select-field.ts, comments stripped -- the behaviour half of the control. */
async function fieldScript() {
  let src;
  try {
    src = await readFile(FIELD_TS, 'utf8');
  } catch (err) {
    assert.fail(`shell/select-field.ts could not be read (${err.code ?? err.message}) `
      + '-- it is where every key this control answers to is written, and an absent '
      + 'file must fail rather than let the keyboard assertions pass over nothing');
  }
  const code = strip(src);
  assert.ok(code.trim().length > 0,
    'select-field.ts is nothing but comments -- the keyboard checks below would '
    + 'then be reading prose and passing for it');
  return { src, code };
}

/**
 * A CSS rule body, by a class that may share its selector with others.
 *
 * `ruleBody` above demands the class be the WHOLE selector, which is right for a
 * badge and wrong here: the label and the value store are clipped by ONE rule
 * naming both, because they are one requirement and two copies of a
 * visually-hidden block is how one of them silently stops hiding.
 */
function ruleFor(css, cls) {
  const m = css.match(new RegExp(`(^|})([^{}]*\\.${cls}\\b[^{}]*)\\{([^}]*)\\}`, 'm'));
  assert.ok(m, `SelectField.astro declares no rule matching \`.${cls}\``);
  return m[3];
}

/** The declared levels, as `{ id, label, options, tier }`. Never an empty list. */
function fieldTable(frontmatter) {
  const block = frontmatter.match(/const\s+FIELDS[^=]*=\s*\[([\s\S]*?)\n\s*\];/);
  assert.ok(block, 'ScopeSwitcher.astro declares no `const FIELDS = [ ... ];` -- the '
    + 'three cards are read from that table, and a table that cannot be found must '
    + 'fail rather than yield an empty list that nothing then checks');

  const entries = [...block[1].matchAll(
    /\{\s*id:\s*'([a-z]+)'\s*,\s*label:\s*'([^']+)'\s*,\s*options:\s*([A-Za-z]+)\s*,\s*tier:\s*([^,}]+?)\s*\}/g)]
    .map(([, id, label, options, tier]) => ({ id, label, options, tier: tier.trim() }));

  assert.ok(entries.length > 0, 'the FIELDS table parsed to ZERO entries -- either '
    + 'the table is empty or its fields are no longer `id`, `label`, `options`, '
    + '`tier` in that order; both must fail, because every loop below would '
    + 'otherwise assert nothing');
  return entries;
}

/** The tier union as `scope/resolve.ts` declares it -- never a copy kept here. */
async function declaredTiers() {
  let src;
  try {
    src = await readFile(RESOLVE_TS, 'utf8');
  } catch (err) {
    assert.fail(`scope/resolve.ts could not be read (${err.code ?? err.message}) -- `
      + 'the tier list is read from it, and an absent file must not yield an empty '
      + 'list that the badge test then iterates zero times');
  }
  const decl = src.match(/export type CityTier\s*=\s*([^;]+);/);
  assert.ok(decl, 'scope/resolve.ts declares no `export type CityTier = ...;` -- the '
    + 'badge test reads the tier names from that union rather than restating them');
  const tiers = [...decl[1].matchAll(/'([a-z-]+)'/g)].map(([, t]) => t);
  assert.ok(tiers.length >= 3,
    `CityTier parsed to ${tiers.length} value(s) (${tiers.join(', ') || '(none)'}) -- `
    + 'the three tiers are validated, zone and geometry, and a shorter parse would '
    + 'let the badge cover fewer classes than there are tiers');
  return tiers;
}

/** One CSS rule body, by selector. An absent rule FAILS rather than yielding ''. */
function ruleBody(css, selector) {
  const m = css.match(new RegExp(`${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `the switcher declares no \`${selector} { ... }\` rule`);
  return m[1];
}

test('the switcher offers all three scope levels, each declared exactly once', async () => {
  const { frontmatter } = await switcherSource();
  const ids = fieldTable(frontmatter).map((f) => f.id);
  assert.equal(ids.length, 3,
    `the switcher declares ${ids.length} levels, not 3: ${ids.join(', ') || '(none)'}`);
  assert.deepEqual([...ids].sort(), LEVEL_IDS,
    'the switcher must carry exactly Country, City and Area, each once -- it '
    + `declares: ${ids.join(', ')}`);
});

test('each level is one SelectField, tagged with the data-scope console-shell finds it by', async () => {
  /* THE COUNTING ARGUMENT, UNCHANGED THOUGH THE ELEMENT MOVED. The template
     renders ONE field, inside the FIELDS loop, so the number in the output is the
     number of FIELDS rows -- three, from the test above -- and each carries
     data-scope={f.id}, so the three tags are `country`, `city` and `area`. That is
     what makes a source assertion here imply the output claim.

     IT USED TO SAY `<select>` AND NOW SAYS `<SelectField>`, because the control is
     a dropdown of our own drawing rather than the platform's. The <select> did not
     go away -- SelectField keeps it as the value, which is the next test -- so
     data-scope still lands on it and console-shell.ts still finds it. */
  const { template } = await switcherSource();

  const fields = [...template.matchAll(/<SelectField\b([\s\S]*?)>/g)];
  assert.equal(fields.length, 1,
    `the template writes <SelectField> ${fields.length}x -- it must be written `
    + 'ONCE, inside the FIELDS loop, or the count in the output stops being the '
    + 'count of levels and this test no longer implies three fields');

  assert.match(fields[0][1], /\sdata-scope=\{f\.id\}/,
    'the field carries no data-scope={f.id} -- console-shell.ts finds the three '
    + 'controls by that attribute, and one without it is unreachable from script');

  const loop = template.indexOf('FIELDS.map(');
  assert.ok(loop !== -1 && loop < template.indexOf('<SelectField'),
    'the field is not inside a `FIELDS.map(` loop -- outside it there is one '
    + 'field in the output however many levels are declared');

  assert.ok(!/role="(listbox|combobox|option)"/.test(template),
    'the switcher writes listbox roles of its own -- the control it composes owns '
    + 'those, and a second set here would be a second dropdown to keep correct');
});

test('the field keeps a real <select> as its value, out of the tab order', async () => {
  /* THE DECISION THIS WHOLE COMPONENT IS. The popup had to be redrawn -- no
     stylesheet reaches the platform's -- but the VALUE did not: the <select> stays,
     holds the answer, carries every option and raises `change`. That is what keeps
     console-shell.ts reading `select.value` and heat-map-app.ts writing into it
     while the thing a reader touches is entirely new.

     TWO HALVES, AND NEITHER IS OPTIONAL. Present, so the seam still exists; and
     out of the tab order AND out of the accessibility tree, or the page would
     carry TWO controls over one fact and a screen reader would announce the field
     twice, the second time as something the eye cannot find. */
  const { template } = await fieldSource();

  const selects = [...template.matchAll(/<select\b([\s\S]*?)>/g)];
  assert.equal(selects.length, 1,
    `SelectField writes <select> ${selects.length}x -- exactly one holds the value`);
  const attrs = selects[0][1];

  assert.match(attrs, /\sdata-select-store\b/,
    'the <select> carries no data-select-store -- select-field.ts finds the value '
    + 'it renders by that attribute, and a field without one is never wired');
  assert.match(attrs, /aria-hidden="true"/,
    'the <select> is not aria-hidden -- it and the trigger would BOTH be announced, '
    + 'which is two controls over one fact');
  assert.match(attrs, /tabindex="-1"/,
    'the <select> is still in the tab order -- Tab would land on an invisible '
    + 'control that looks, to anything driving by keyboard, like the real one');
  assert.match(attrs, /\{\.\.\.store\}/,
    "the <select> does not receive the caller's attributes -- data-scope would "
    + 'never reach the element console-shell.ts queries for');

  const options = [...template.matchAll(/<option\b([\s\S]*?)>/g)];
  assert.equal(options.length, 1,
    `SelectField writes <option> ${options.length}x -- once, inside the options `
    + 'loop, or the count in the output stops being the count of options');
  assert.match(template, /options\.map\(/,
    'the options are not rendered from the `options` prop -- this component must '
    + 'not know what it is listing');
  assert.match(options[0][1], /\sdisabled=\{o\.disabled\}/,
    'the <option> does not bind disabled={o.disabled} -- an unavailable row would '
    + 'render selectable, which is the accepted-then-refused defect');
  assert.match(options[0][1], /\sdata-note=\{o\.note\}/,
    'the <option> does not carry its note -- the reason a row cannot be chosen '
    + 'would exist in the props and nowhere in the DOM, and select-field.ts reads '
    + 'it from the DOM');
});

test('the rows are BUILT from the options, never rendered beside them', async () => {
  /* THE COPY THAT IS NOT MADE. A dropdown that renders its own <li> list next to
     the <option> list has two lists to keep in step, and this repo has thirteen
     guards that turned out to be comparing a value against a copy of itself. The
     rows are created from the options at open time instead, so there is nothing to
     drift -- and `updateScopeSwitcher` rewriting an option's value mid-session is
     picked up rather than missed.

     ASSERTED FROM BOTH ENDS, because either alone is satisfiable by an accident:
     the component renders no row, and the script builds them from the select. */
  const { template } = await fieldSource();
  const { code } = await fieldScript();

  assert.ok(!/role=["']option["']/.test(template),
    'SelectField renders rows in its own markup -- they would be a second copy of '
    + 'the option list, free to disagree with it the moment either moves');

  const list = template.match(/<ul\b([\s\S]*?)>([\s\S]*?)<\/ul>/);
  assert.ok(list, 'SelectField renders no <ul> for the dropdown to fill');
  assert.equal(list[2].trim(), '',
    `the list is rendered with content (${list[2].trim().slice(0, 60)}...) -- it `
    + 'must be empty, because the script fills it from the <select>');
  assert.match(list[1], /role="listbox"/, 'the list is not a listbox');
  assert.match(list[1], /\shidden\b/,
    'the list is rendered open -- before any script runs it would sit over the '
    + 'panes below it with nothing able to close it');

  assert.match(code, /store\.options/,
    'select-field.ts does not read the <select>\'s options -- whatever it is '
    + 'rendering the rows from, it is not the list that holds the value');
  assert.match(code, /function buildRows[\s\S]*?document\.createElement\('li'\)/,
    'the rows are not created in `buildRows` -- this test locates the one place '
    + 'they are made, and cannot check what it cannot find');
  /* AND ON EVERY OPEN, not once at mount. A list built once would hand back the
     key the page was opened at for the rest of the session -- which is exactly the
     bug this control shipped and had fixed hours before it was redrawn. */
  assert.match(code, /function openList[\s\S]*?buildRows\(f\)/,
    'openList does not rebuild the rows -- a list built once at mount goes stale '
    + 'the first time `updateScopeSwitcher` rewrites an option value');
});

test('every field announces a text label, and it is visually hidden', async () => {
  /* A BARE COMBOBOX ANNOUNCES ONLY ITS VALUE. "India" with no name attached is not
     a control anyone can use by ear. The mockup's uppercase caption is a
     decorative span sitting inside the card, so the accessible name is a real
     <label>, hidden from the eye and present in the tree -- and it is ONE element
     serving the trigger, the list and the <select> alike, so three names cannot
     drift into disagreeing about what is being chosen.

     THE STRING STILL COMES FROM `f.label`. The switcher declares it; the field
     prints it as the caption AND uses it as the accessible name, both from the one
     `label` prop. */
  const { frontmatter, template: switcherTemplate } = await switcherSource();
  const { template, css } = await fieldSource();

  for (const f of fieldTable(frontmatter)) {
    assert.ok(f.label.trim().length > 0, `level "${f.id}" declares no label`);
  }
  assert.match(switcherTemplate, /<SelectField[\s\S]*?\slabel=\{f\.label\}/,
    'the switcher does not pass f.label to the field -- the caption and the '
    + 'accessible name would come from somewhere the FIELDS table does not control');

  const labels = [...template.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)];
  assert.equal(labels.length, 1,
    `SelectField writes <label> ${labels.length}x -- exactly one gives exactly one `
    + 'name per field');

  const [, labelAttrs, labelText] = labels[0];
  assert.ok(flat(labelText).includes('{label}'),
    `the label's text is \`${flat(labelText)}\` -- it must be {label}, the same `
    + 'string the visible caption shows, or the two spellings can drift');

  const forExpr = labelAttrs.match(/\sfor=(\{[^}]*\}|"[^"]*")/);
  assert.ok(forExpr, 'the <label> carries no for= -- the element that holds the '
    + 'value would be nameless to anything reading the DOM rather than the tree');
  const selectAttrs = [...template.matchAll(/<select\b([\s\S]*?)>/g)][0][1];
  const idExpr = selectAttrs.match(/\sid=(\{[^}]*\}|"[^"]*")/);
  assert.ok(idExpr, 'the <select> carries no id= for the label to point at');
  assert.equal(flat(forExpr[1]), flat(idExpr[1]),
    `the label points at ${flat(forExpr[1])} and the select is ${flat(idExpr[1])} -- `
    + 'two different expressions cannot be relied on to produce one id');

  /* AND THE TRIGGER -- the thing that is actually announced -- IS NAMED BY THE SAME
     ELEMENT. A <label for> does not name a div or a button, so this is the
     reference that carries the name onto the control a reader focuses; without it
     the field is heard as an unlabelled combobox reading out a place name. */
  const labelIdExpr = labelAttrs.match(/\sid=(\{[^}]*\}|"[^"]*")/);
  assert.ok(labelIdExpr, 'the <label> carries no id -- nothing can point at it');
  const trigger = template.match(/<button\b([\s\S]*?)>/);
  assert.ok(trigger, 'SelectField renders no <button> trigger');
  assert.match(trigger[1], /aria-labelledby=/,
    'the trigger has no aria-labelledby -- a <label for> cannot name a button that '
    + 'is not a form control, so the combobox would be announced with no name');
  assert.match(template, /<ul[\s\S]*?aria-labelledby=/,
    'the list has no aria-labelledby -- the popup would be an unnamed listbox');
  assert.match(trigger[1], /role="combobox"/,
    'the trigger is not a combobox -- a button that opens a listbox and reports a '
    + 'value is a combobox, and anything else misdescribes it to a screen reader');
  assert.match(trigger[1], /aria-expanded="false"/,
    'the trigger does not declare aria-expanded -- a reader is never told the list '
    + 'can open, nor whether it is open');
  assert.match(trigger[1], /aria-controls=/,
    'the trigger does not name the list it controls');

  const cls = labelAttrs.match(/\sclass="([^"]+)"/);
  assert.ok(cls, 'the <label> carries no class -- the rule that hides it cannot be found');
  const hidden = ruleFor(css, cls[1].trim().split(/\s+/)[0]);
  assert.match(hidden, /clip-path|clip:/,
    'the label class does not clip the label out of view -- the founder tuned the '
    + 'card to show the caption, not a second copy of the word beside it');
  assert.ok(!/display:\s*none|visibility:\s*hidden/.test(hidden),
    'the label is hidden with display:none or visibility:hidden, which takes the '
    + 'accessible name away with the pixels -- clip it instead');

  assert.match(template, /<span[^>]*class="[^"]*field-key[^"]*"[^>]*aria-hidden="true"/,
    'the visible caption is not aria-hidden -- a screen reader would then hear '
    + '"Country" twice, once from the caption and once from the real label');
});

test('an area that ships no data is DISABLED, and the REGISTRY decides which', async () => {
  /* THE POINT OF THE WHOLE CONTROL. An area with no data must be UNSELECTABLE,
     not selectable-then-refused: a control that takes a click and silently does
     nothing is a defect this repo has already paid for twice.

     ASSERTED AGAINST THE REGISTRY, not against a list of names written here. A
     hardcoded list would go stale the day an area starts or stops shipping, and
     it would go stale SILENTLY, since a stale list still iterates. */
  const withData = AREA_KEYS.filter((k) => resolve(k).area.hasData);
  const noData = AREA_KEYS.filter((k) => !resolve(k).area.hasData);

  assert.ok(noData.length > 0,
    'EVERY registered area ships data -- there is then nothing for `disabled` to '
    + 'be true about, and this test would pass while proving nothing. If that is '
    + 'genuinely the new state of the registry, this test needs rewriting, not '
    + 'deleting');
  assert.ok(withData.length > 0,
    'NO registered area ships data -- `disabled` would be indistinguishable from '
    + '"always on", and the test would again prove nothing');

  /* DISABLED HAS TO MEAN GENUINELY UNFETCHABLE, or it is only a grey pixel.
     `paths()` returning null is what makes it true: a caller that cannot obtain a
     URL cannot fire a request. Pinning the two together here is what stops the
     greyed row and the fetch from drifting into disagreement. */
  for (const key of AREA_KEYS) {
    assert.equal(paths(key) === null, !resolve(key).area.hasData,
      `"${key}": hasData and paths() disagree -- a disabled option must be one `
      + 'that genuinely cannot be fetched, not one that merely looks unavailable');
  }

  const { frontmatter, template } = await switcherSource();

  /* ONE assignment, and it reads hasData. Anything else -- a second assignment, a
     literal true, a list of ids -- means some option can be disabled for a reason
     the registry never gave. */
  const assigned = [...frontmatter.matchAll(/disabled:\s*([^,\n}]+)/g)].map((m) => m[1].trim());
  assert.equal(assigned.length, 1,
    `the frontmatter assigns \`disabled\` ${assigned.length}x (${assigned.join(' | ') || 'never'}) `
    + '-- exactly one assignment, in the area options, is what makes the registry '
    + 'the only thing that can disable an option');
  assert.match(assigned[0], /hasData/,
    `\`disabled\` is set from \`${assigned[0]}\` -- it must be set from the area's `
    + 'hasData, or an area could be greyed out for a reason the registry never gave');

  assert.match(template, /<SelectField[\s\S]*?\soptions=\{f\.options\}/,
    'the switcher does not hand its options to the field -- the derivation above '
    + 'would be computed and thrown away, and the dropdown would list something '
    + 'else. (The <option> that binds disabled={o.disabled} lives in '
    + 'SelectField.astro now, and is checked by its own test above.)');

  /* AND THE REASON IS CARRIED, on the option rather than glued onto its name.
     Concatenated into the text it could only ever print as one run of words;
     separate, the row shows a name and a reason and nothing downstream has to
     guess where the name stopped. */
  const noteDecl = frontmatter.match(/const\s+NO_DATA_NOTE\s*=\s*'([^']*)'/);
  assert.ok(noteDecl, 'no NO_DATA_NOTE is declared -- a disabled option with no '
    + 'stated reason is mysterious rather than honest');
  assert.ok(noteDecl[1].trim().length > 0, 'NO_DATA_NOTE is the empty string');
  const noteAssigned = [...frontmatter.matchAll(/note:\s*([^,\n}]+)/g)].map((m) => m[1].trim());
  assert.equal(noteAssigned.length, 1,
    `the frontmatter assigns \`note\` ${noteAssigned.length}x `
    + `(${noteAssigned.join(' | ') || 'never'}) -- exactly one assignment, beside `
    + 'the `disabled` it explains');
  assert.match(noteAssigned[0], /NO_DATA_NOTE/,
    `the option's note is \`${noteAssigned[0]}\` -- it must be NO_DATA_NOTE, or the `
    + 'reason exists in the source and nowhere in the output');
  /* AND ONLY WHERE IT IS TRUE. A note on an area that ships would print an
     explanation for a refusal that is not happening. */
  assert.match(noteAssigned[0], /hasData/,
    `the note is set from \`${noteAssigned[0]}\` -- it must be conditioned on the `
    + "same hasData `disabled` is, or a shipping area carries a reason it isn't "
    + 'being refused for');
});

test('the tier badge is the RESOLVED tier, and the three tiers take three classes', async () => {
  const tiers = await declaredTiers();
  const { frontmatter, template, css } = await switcherSource();

  /* The badge belongs to the CITY, because the tier is a city fact: the gap
     between Kolkata's `validated` and Dubai's `geometry` IS the funding ask. */
  const tierExpr = new Map(fieldTable(frontmatter).map((f) => [f.id, f.tier]));
  const cityTier = tierExpr.get('city') ?? '';
  assert.match(cityTier, /scope\.tier/,
    'the City level must take its tier from the resolved scope -- it declares '
    + `\`${cityTier}\`, and a literal would state a confidence the registry never `
    + 'claimed');

  /* ONE TIER MAY BE SUPPRESSED, AND ONLY ONE. `validated` is not badged: it is
     the tier every city should be and the only one whose areas open, so a badge
     announcing it said nothing a reader could act on. The others are CAVEATS —
     they are what explains a greyed area — and suppressing one of those would
     quietly remove the warning while leaving the control looking complete.

     So this reads which tier names appear in the expression rather than matching
     it verbatim: the shape may be retuned, the set of silenced tiers may not. */
  const silenced = tiers.filter((t) => cityTier.includes(`'${t}'`));
  assert.deepEqual(silenced, ['validated'],
    `the City tier expression names ${silenced.length === 0 ? 'no tier' : silenced.join(', ')}. `
    + 'Exactly one may be singled out and it must be `validated` -- the other tiers '
    + 'are the reason an area cannot be opened, and a city that silently stopped '
    + 'declaring one would look fully available while shipping nothing');
  for (const id of ['country', 'area']) {
    assert.equal(tierExpr.get(id), 'null',
      `the ${id} level declares a tier -- the tier is a CITY fact, and a second `
      + 'copy on another level is a second thing free to disagree');
  }
  assert.match(frontmatter, /const\s+scope\s*=\s*resolve\(current\)/,
    'the scope must come from resolve(current) -- every value in this control is '
    + 'derived from the key it was handed');

  /* Every declared tier gets a label and a class. Reading the tier list from
     resolve.ts rather than restating it is what makes a FOURTH tier fail here
     instead of rendering an unstyled badge. */
  const labelBlock = frontmatter.match(/const\s+TIER_LABEL[^=]*=\s*\{([\s\S]*?)\n\s*\};/);
  assert.ok(labelBlock, 'no `const TIER_LABEL = { ... };` -- the badge would then '
    + 'print the raw tier slug');
  const colours = new Map();
  for (const t of tiers) {
    assert.match(labelBlock[1], new RegExp(`${t}:\\s*'[^']+'`),
      `TIER_LABEL has no non-empty entry for the "${t}" tier -- a city on it would `
      + 'render a blank badge');
    const body = ruleBody(css, `.tier-${t}`);
    const colour = body.match(/(?:^|[;\s])color:\s*([^;]+)/);
    assert.ok(colour, `.tier-${t} declares no colour -- the three tiers would then `
      + 'be told apart by a class name nobody can see');
    colours.set(t, flat(colour[1]));
  }
  assert.equal(colours.size, tiers.length, 'a tier was collected twice');
  assert.equal(new Set(colours.values()).size, tiers.length,
    'two tiers share a colour ('
    + [...colours].map(([t, c]) => `${t}=${c}`).join(', ')
    + ') -- the badge is the honesty label, and two tiers that look identical are '
    + 'one tier');

  assert.match(template, /class=\{`[^`]*tier-\$\{f\.tier\}[^`]*`\}/,
    'the badge class is not interpolated from the tier -- a per-tier literal in '
    + 'the template is a fourth place the tier list has to be kept up to date');
  assert.match(template, /\{TIER_LABEL\[f\.tier\]\}/,
    'the badge text does not come from TIER_LABEL[f.tier]');
});

test('the switcher DERIVES its three lists and names no place', async () => {
  /* The registry exports typed helpers for exactly this, and spec 1 added
     `areaKeysInCity` for the fiddly one. A hardcoded name here is a fifth ward
     table -- and the header of registry.ts records what happened the last time
     one was copied rather than referenced: five Python scripts held private
     copies and had ALREADY DIVERGED, 10-44 m apart, with nothing failing. */
  const { frontmatter, template } = await switcherSource();
  const code = `${frontmatter}\n${template}`;

  const countries = new Set(AREA_KEYS.map((k) => splitKey(k).country));
  assert.ok(countries.size >= 2,
    `the registry holds ${countries.size} country(ies) -- a switcher that cannot `
    + 'switch country proves nothing about switching, and this test would be '
    + 'asserting over a list of one');

  const named = new Set();
  for (const key of AREA_KEYS) {
    const { country, city, area } = splitKey(key);
    const s = resolve(key);
    named.add(city).add(area).add(s.city.name).add(s.area.name).add(s.country.name);
    if (country.length > 2) named.add(country);
  }
  assert.ok(named.size > 0, 'no place names were collected from the registry -- '
    + 'the loop below would then check nothing');

  for (const name of named) {
    assert.ok(!new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\b`, 'i').test(code),
      `ScopeSwitcher.astro names "${name}" -- every list here must be derived from `
      + 'AREA_KEYS, areaKeysInCity and resolve(), never written down a second time');
  }

  assert.match(frontmatter, /areaKeysInCity\(/,
    'the area list is not built with areaKeysInCity -- that helper exists so the '
    + "city's areas can be found without reaching into REGISTRY's nested shape");
  assert.match(frontmatter, /AREA_KEYS/,
    'the country and city lists are not derived from AREA_KEYS');
});

test('the switcher frontmatter contains no cast', async () => {
  /* `as any` and `as unknown as` are how the registry's shape drifts out from
     under its consumers: the cast keeps compiling long after the thing it
     asserted stopped being true. The registry exports typed helpers precisely so
     none is needed here. */
  const { frontmatter } = await switcherSource();
  for (const cast of [/\bas\s+any\b/, /\bas\s+unknown\s+as\b/, /@ts-(ignore|expect-error|nocheck)/]) {
    assert.ok(!cast.test(frontmatter),
      `ScopeSwitcher.astro frontmatter matches ${cast} -- the registry exports a `
      + 'typed helper for every list this control needs, and a cast here is how '
      + 'the shape drifts');
  }
});

test('the switcher scopes its styles rather than going global', async () => {
  const { styles } = await switcherSource();
  assert.ok(styles.length > 0, 'ScopeSwitcher.astro has no <style> block at all');
  for (const [, attrs] of styles) {
    assert.ok(!/is:global/.test(attrs),
      'ScopeSwitcher.astro uses <style is:global> -- its markup is entirely '
      + 'Astro-rendered and static, so the scoping hash reaches it and the style '
      + 'has no reason to leak');
  }
});

test('the field is usable by keyboard and honours reduced motion', async () => {
  /* FOLLOWED THE CARD. The focus ring and the transition both moved into
     SelectField with the card they belong to; the switcher's own block is now
     three layout rules and a badge, and asserting on it would be asserting about
     nothing. */
  const { css } = await fieldSource();
  assert.match(css, /:focus-visible|:focus-within/,
    'the field has no focus rule -- a control whose focus cannot be seen is '
    + 'unusable by keyboard, and this is the control the whole console is scoped by');
  assert.match(css, /@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/,
    'the field transitions its card with no prefers-reduced-motion escape');
});

test('the dropdown answers every key the native select gave away', async () => {
  /* THE BILL FOR REDRAWING THE POPUP. A <select> arrives with arrow keys,
     Home/End, type-ahead, Escape and a focus contract, and NONE of it survives
     replacing the popup -- it all has to be written, and it is the half that gets
     left for later because it is the half a screenshot cannot show. A dropdown a
     keyboard cannot drive is a WORSE control than the OS one it replaced, however
     good it looks, so the keys are enumerated here.

     THIS IS A SOURCE CHECK AND IT KNOWS IT. It proves each key is HANDLED, not
     that it does the right thing -- tests/e2e/heat-map-routing.spec.ts drives them
     in a browser against the map. What it catches is the deletion: a refactor that
     drops the Home/End arm goes red here rather than being noticed by whoever next
     tries to reach the bottom of a long list.

     THE TWO ARMS ARE READ SEPARATELY, and the first version of this test did not
     do that. It asked whether the file MENTIONED each key -- and deleting Home and
     End from the open list left them in the closed branch, so the guard stayed
     green over a dropdown you could no longer reach the end of. A control has two
     states and the keys mean different things in each; asking one question about
     both was asking about neither. */
  const { code } = await fieldScript();

  const open = code.match(/switch\s*\(e\.key\)\s*\{([\s\S]*?)default:/);
  assert.ok(open, 'select-field.ts has no `switch (e.key)` for the OPEN list -- '
    + 'this test locates the open-state keys there, and cannot check what it '
    + 'cannot find');
  const closed = code.match(/on\(trigger,\s*'keydown'[\s\S]*?if\s*\(!isOpen\(f\)\)\s*\{([\s\S]*?)\n      \}/);
  assert.ok(closed, 'select-field.ts has no `if (!isOpen(f))` arm in the trigger\'s '
    + 'keydown -- the closed-state keys cannot be located');

  /* OPEN: every key that moves, commits or cancels. */
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', 'Escape', 'Tab']) {
    assert.ok(open[1].includes(`case '${key}':`),
      `${key} has no arm while the list is OPEN -- the native control answered it `
      + 'and this one has to, or the reader is worse off than before the redraw');
  }
  /* CLOSED: every key that has to open it. A dropdown that only opens on click is
     a dropdown a keyboard cannot reach at all. */
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Home', 'End']) {
    assert.ok(closed[1].includes(`'${key}'`),
      `${key} does not open the list from the CLOSED state -- there is no keyboard `
      + 'route into the control');
  }

  assert.match(code, /function typeAhead/,
    'there is no type-ahead -- it is how anyone reaches the eleventh of thirty '
    + 'rows without pressing Down eleven times, and the first thing a hand-rolled '
    + 'listbox drops');
  /* AND FROM BOTH STATES. A native select answers a letter whether its popup is
     showing or not; type-ahead wired only into the open list means the reader has
     to open the thing first to be allowed to type at it. */
  assert.ok(closed[1].includes('typeAhead('),
    'typing does nothing while the list is CLOSED -- the reader has to open the '
    + 'list before a letter counts, which the control it replaced did not ask');
  const fallthrough = code.split('default:')[1] ?? '';
  assert.ok(fallthrough.includes('typeAhead('),
    'the OPEN list has no type-ahead -- every letter that is not a named key would '
    + 'fall through and do nothing at all');
  assert.match(code, /aria-activedescendant/,
    'nothing sets aria-activedescendant -- the active row would move on screen and '
    + 'be announced to nobody, which is a listbox a screen reader cannot follow');
  assert.match(code, /trigger\.focus\(\)/,
    'focus is never returned to the trigger -- closing the list would drop the '
    + 'reader at the top of the document');

  /* THE WINDOW IS MEASURED FROM THE KEY, NOT FROM THE HANDLER. Type-ahead drops its
     buffer after 600ms of silence, and "silence" has to mean the person paused —
     not that the page stalled between two keystrokes. Reading Date.now() inside the
     handler measured the stall: a WebGL advance of up to ~900ms between letters
     typed 40ms apart split "barr" into "bar"+"r" and landed the reader on Baruipur
     instead of Barrackpore, every retry, on a CI runner with no GPU (2026-09-05).
     e.timeStamp is when the key went down, and it survives whatever the page did. */
  assert.doesNotMatch(code, /Date\.now\(\)\s*-\s*f\.bufferAt/,
    'type-ahead must not read the clock in the handler: a main-thread stall between two '
    + 'keystrokes then reads as the reader pausing, and the word is split');
  assert.ok((code.match(/typeAhead\(f, [^)]*e\.timeStamp\)/g) ?? []).length >= 3,
    'every type-ahead call passes the event\'s own timestamp');

  /* A DISABLED ROW IS REFUSED AT THE COMMIT, which is the only place it can be
     refused while still being arrowable and announced. Skipping it in the arrow
     keys instead would leave Dubai -- where every row is disabled -- a list nobody
     can move through and a set of reasons nobody ever hears. */
  assert.match(code, /function commit[\s\S]*?aria-disabled[\s\S]*?return false/,
    'commit does not refuse an aria-disabled row -- an unavailable area could be '
    + 'chosen by keyboard, which is the accepted-then-quietly-ignored defect');
});

test('every class the script creates is reachable by the stylesheet', async () => {
  /* THE SCOPED-STYLE TRAP, and it is silent. Astro scopes a component's CSS by
     stamping its markup with a hash attribute and rewriting `.field-option` to
     `.field-option[data-astro-cid-…]`. The rows are created in script, so they
     never carry that attribute -- and a plain rule for them matches NOTHING. The
     list opens as a stack of unstyled text and no build step complains.

     :global() is the escape, and it has to be written per class, so this test
     reads the classes the script actually creates rather than a list kept beside
     them. A new row element with a new class fails here the day it is added. */
  const { css } = await fieldSource();
  const { code } = await fieldScript();

  const created = [...new Set(
    [...code.matchAll(/\.className\s*=\s*'([^']+)'/g)].flatMap((m) => m[1].split(/\s+/)))];
  assert.ok(created.length > 0,
    'no script-created class was found in select-field.ts -- either the rows stopped '
    + 'being built there, or the assignment is spelled some way this test cannot '
    + 'see, and it is now checking nothing');

  for (const cls of created) {
    assert.ok(css.includes(`:global(.${cls}`),
      `.${cls} is created in script and styled without :global() -- Astro's scoping `
      + 'hash never reaches a node Astro did not render, so that rule matches '
      + 'nothing and the dropdown opens unstyled');
  }

  /* AND THE TWO STATE CLASSES the script toggles rather than assigns, which the
     scan above cannot see: they are `classList` calls, and they are what tells the
     active row and the chosen one apart. */
  for (const state of ['is-active', 'is-selected']) {
    assert.ok(code.includes(`'${state}'`),
      `select-field.ts never sets \`${state}\` -- the row state it stands for has `
      + 'no way to reach the stylesheet');
    assert.ok(css.includes(`.${state}`),
      `\`${state}\` is set in script and styled nowhere -- the row it marks looks `
      + 'exactly like the rows it is meant to be told apart from');
  }
});

test('the seam is still a <select>, read and written where it always was', async () => {
  /* THE ONE THING THIS REDRAW WAS NOT ALLOWED TO BREAK. Two modules outside the
     component hold this element: console-shell.ts reads `select.value` off
     `select[data-scope]` to decide between an in-place swap and a navigation, and
     heat-map-app.ts writes back into it on every ward change. The control a reader
     touches is entirely new; what those two hold is not.

     AND THE WRITE HAS TO ANNOUNCE ITSELF. Assigning `select.value` raises no
     event, so the words on the trigger follow only because `updateScopeSwitcher`
     says so. Without that line the value moves and the label does not: the console
     names one ward in its own scope control and another everywhere else, silently,
     which is the failure this file's neighbours were written against. */
  const shell = await readFile(new URL(
    '../../src/scripts/climate-engine/shell/console-shell.ts', import.meta.url), 'utf8');
  const app = await readFile(new URL(
    '../../src/scripts/climate-engine/heat-map-app.ts', import.meta.url), 'utf8');

  assert.match(shell, /querySelectorAll<HTMLSelectElement>\('select\[data-scope\]'\)/,
    'console-shell.ts no longer finds the scope controls as `select[data-scope]` -- '
    + 'if the seam moved, both sides had to move together');
  assert.match(shell, /select\.value/,
    'console-shell.ts no longer reads `select.value` -- it is deciding where to go '
    + 'from something else');
  assert.match(shell, /mountSelectFields\(/,
    'console-shell.ts does not mount the dropdowns -- the triggers would be '
    + 'buttons with no behaviour, which is a control that does nothing');

  assert.match(app, /select\[data-scope\]/,
    'heat-map-app.ts no longer writes back into the scope selects -- after an '
    + 'in-place ward switch the switcher would name the ward the page was opened at');
  /* THE DISPATCH, not the import. The first version of this asked whether the file
     mentioned SELECT_SYNC_EVENT anywhere -- and deleting the dispatch left the
     `import { SELECT_SYNC_EVENT }` line behind, so the guard went on passing over
     a switcher whose visible label had stopped following the ward. A name in an
     import is not a thing being done. */
  assert.match(app, /function updateScopeSwitcher\(\)[\s\S]*?dispatchEvent\(new Event\(SELECT_SYNC_EVENT\)\)/,
    'updateScopeSwitcher moves the value and tells nothing -- `select.value = x` '
    + 'raises no event, so the trigger would go on showing the previous ward while '
    + 'the map, the URL and the breadcrumb had all moved');

  const { code } = await fieldScript();
  assert.match(code, /SELECT_SYNC_EVENT[\s\S]*?paintValue/,
    'select-field.ts declares the sync event and never repaints on it -- the '
    + 'writer would be announcing a change nobody listens for');
  assert.ok(!/'change'[^\n]*dispatchEvent/.test(app) && !app.includes("new Event('change'"),
    'heat-map-app.ts raises a synthetic `change` on a scope select -- console-shell '
    + 'answers that one by navigating, and would be asked to travel to where the '
    + 'page already is');
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE LAYER TREE — the grouped checkbox list that fills the Layers pane.

   THE ONE CLAIM THIS COMPONENT MAKES: a layer that cannot be drawn here is
   DISABLED WITH ITS REASON NAMED. Never hidden — an absent row reads as "this
   does not exist", which is a different and wronger claim than "we do not have
   it here yet". Never live-but-inert — a checkbox that ticks and changes
   nothing is the defect this repo has already paid for twice, and the spec-1
   audit called it "a control that does nothing and says nothing".

   READ AS SOURCE, for the reason the two halves above give: an .astro component
   cannot be imported into `node --import tsx --test`. So every data-driven claim
   is asserted against `scope/layers.ts` ITSELF, imported below, and the source
   assertions only establish that the markup DERIVES from it rather than
   restating it. Where a claim is about the rendered page, the chain from the
   source property to the output property is written out rather than assumed.

   GUARD THE GUARD, and this suite has earned the paranoia: EIGHT guards in this
   project have passed while protecting nothing, one of them inside a test a plan
   specified verbatim. So, in this third half:

     · an unreadable, empty or fenceless component FAILS (`treeSource`)
     · a component with an EMPTY frontmatter FAILS — the whole tree is derived
       there, and an empty one would satisfy every "names no label" check by
       containing no code at all
     · a registry whose LAYER_IDS is empty FAILS (`registryGroups`), because
       every loop below walks it and would otherwise iterate zero times
     · a registry that flattens to ZERO groups FAILS, same reason
     · a registry that yields zero labels FAILS the no-copies test
     · an area at which EVERY layer is available FAILS the disabled test — there
       would then be nothing for `disabled` to be true about
     · an area at which NO layer is available FAILS it too, because `disabled`
       would be indistinguishable from "always off"
     · a `.tree-count::after` rule that cannot be found FAILS rather than
       yielding an empty content string the counter assertions then read
     · a DOT table that parses to zero entries FAILS
     · a palette with no tokens in it FAILS the dot test
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  LAYERS, LAYER_IDS, layerAvailability, splitLayerId,
} from '../../src/scripts/climate-engine/scope/layers.ts';

const TREE = new URL(
  '../../src/components/ClimateEngine/shell/LayerTree.astro', import.meta.url);
/** v2's tokens: the shared tree's dots resolve against these (the `.v1-bridge` block). */
const V2_TOKENS = new URL('../../src/styles/obos-v2/tokens.css', import.meta.url);
/** Every v2 component, the markup the served page is made of (v1's stage is deleted). */
const V2_DIR = new URL('../../src/components/ClimateEngine/v2/', import.meta.url);
async function v2Markup() {
  const files = (await readdir(V2_DIR)).filter((f) => f.endsWith('.astro') && !f.startsWith('._')).sort();
  assert.ok(files.length > 20, 'the v2 components could not be listed');
  return (await Promise.all(files.map((f) => readFile(new URL(f, V2_DIR), 'utf8')))).join('\n');
}
async function v2Css() {
  const dir = new URL('../../src/styles/obos-v2/', import.meta.url);
  const files = (await readdir(dir, { recursive: true })).map(String).filter((f) => f.endsWith('.css') && !f.split('/').pop().startsWith('._')).sort();
  return (await Promise.all(files.map((f) => readFile(new URL(f, dir), 'utf8')))).join('\n');
}

/** Both capability states. The tree is rendered with the token and without it. */
const CAPS_ON = { mapillary: true };
const CAPS_OFF = { mapillary: false };

async function treeSource() {
  let src;
  try {
    src = await readFile(TREE, 'utf8');
  } catch (err) {
    assert.fail(
      'src/components/ClimateEngine/shell/LayerTree.astro could not be read '
      + `(${err.code ?? err.message}) -- every assertion below reads it, so a `
      + 'missing file must fail rather than let the suite pass vacuously');
  }
  assert.ok(src.trim().length > 0, 'LayerTree.astro is empty -- nothing to check');

  const split = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  assert.ok(split, 'LayerTree.astro has no `---` frontmatter fence -- the tests '
    + 'below read the frontmatter and the template separately and cannot tell '
    + 'them apart without it');
  assert.ok(split[1].trim().length > 0,
    'LayerTree.astro has an EMPTY frontmatter -- the whole tree is derived there, '
    + 'and an empty one would satisfy every "names no label" and "contains no '
    + 'cast" check below by containing no code at all');

  const body = split[2];
  const styles = [...body.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)];
  return {
    frontmatter: strip(split[1]),
    template: strip(body.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')),
    styles,
    // COMMENTS STRIPPED, so a rule that exists only in prose cannot satisfy a
    // check. `:focus-visible` mentioned in a comment is not a focus ring.
    css: styles.map((m) => m[2]).join('\n').replace(/\/\*[\s\S]*?\*\//g, ''),
  };
}

/**
 * The groups the registry declares, derived TWO INDEPENDENT WAYS.
 *
 * `Object.keys(LAYERS)` reads the literal; walking `LAYER_IDS` through
 * `splitLayerId` reads the runtime FLATTEN, which is the thing the component
 * actually iterates. Comparing them is therefore not a tautology: it is the
 * assertion that the walk the tree performs yields exactly the groups the
 * registry declares, which is what "four groups, derived" has to mean.
 */
function registryGroups() {
  assert.ok(LAYER_IDS.length > 0,
    'LAYER_IDS came back EMPTY -- every loop in this half walks it, so an empty '
    + 'registry would let all of them iterate zero times and pass while the tree '
    + 'rendered nothing');

  const walked = [];
  for (const id of LAYER_IDS) {
    const { group } = splitLayerId(id);
    if (!walked.includes(group)) walked.push(group);
  }
  assert.ok(walked.length > 0,
    'the LAYER_IDS walk produced ZERO groups -- the group list every assertion '
    + 'below iterates would be empty');

  assert.deepEqual(walked, Object.keys(LAYERS),
    'the groups reached by walking LAYER_IDS are not the groups LAYERS declares '
    + `(walk: ${walked.join(', ')} | literal: ${Object.keys(LAYERS).join(', ')}) -- `
    + 'the tree walks the flatten, so a walk that misses a group renders a '
    + 'category of layers nowhere at all');
  return walked;
}

/** Every label the registry owns — group headings and row names alike. */
function registryLabels() {
  const labels = [];
  for (const [group, entry] of Object.entries(LAYERS)) {
    assert.ok(Object.keys(entry.items).length > 0,
      `layer group "${group}" has no items -- it contributes no row labels, and `
      + 'the no-copies loop below would check that many fewer strings');
    labels.push(entry.label);
    for (const item of Object.values(entry.items)) labels.push(item.label);
  }
  assert.ok(labels.length > 0,
    'no labels were collected from the registry -- the loop that checks the tree '
    + 'writes none of them by hand would then check nothing');
  return labels;
}

/** The one area key that ships artefacts, and the one that ships none. */
function twoAreas() {
  const withData = AREA_KEYS.filter((k) => paths(k) !== null);
  const noData = AREA_KEYS.filter((k) => paths(k) === null);
  assert.ok(withData.length > 0,
    'NO registered area ships artefacts -- there would be nothing for an ENABLED '
    + 'row to be true about, and the comparisons below would prove nothing');
  assert.ok(noData.length > 0,
    'EVERY registered area ships artefacts -- there would then be nothing for '
    + '`disabled` to be true about, and the Dubai half of this suite would pass '
    + 'while protecting nothing. If that is genuinely the new state of the '
    + 'registry, these tests need rewriting, not deleting');
  return { rich: withData[0], bare: noData[0] };
}

/** How many rows the tree would render CHECKED — the numerator of the count. */
function drawnCount(key, caps) {
  return LAYER_IDS.filter((id) => {
    const { group, item } = splitLayerId(id);
    return LAYERS[group].items[item].defaultOn
      && layerAvailability(id, key, caps).available;
  }).length;
}

/** The per-layer dot table, as `{ id: token }`. Never an empty map. */
function dotTable(frontmatter) {
  const block = frontmatter.match(/const\s+DOT[^=]*=\s*\{([\s\S]*?)\n\s*\};/);
  assert.ok(block, 'LayerTree.astro declares no `const DOT ... = { ... };` -- the '
    + 'row dots are read from that table, and a table that cannot be found must '
    + 'fail rather than yield an empty map that nothing then checks');
  const entries = [...block[1].matchAll(/'([^']+)':\s*'([^']*)'/g)]
    .map(([, id, token]) => [id, token]);
  assert.ok(entries.length > 0,
    'the DOT table parsed to ZERO entries -- either the table is empty or its '
    + "entries are no longer `'id': 'token'`; both must fail, because the dot "
    + 'assertions would otherwise iterate nothing');
  return new Map(entries);
}

/** The `.tree-count::after` content, and the counters it is built from. */
function countRule(css) {
  const rule = css.match(/\.tree-count::after\s*\{([^}]*)\}/);
  assert.ok(rule, 'the tree declares no `.tree-count::after { ... }` rule -- that '
    + 'pseudo-element IS the count, so without the rule there is no count at all '
    + 'and the assertions below would read an empty string and pass');
  const content = rule[1].match(/content:\s*([^;]+)/);
  assert.ok(content, '.tree-count::after declares no `content` -- the element is '
    + 'empty in the markup on purpose, so with no content it renders nothing');
  const counters = [...content[1].matchAll(/counter\(\s*([a-z][a-z0-9-]*)\s*\)/g)]
    .map((m) => m[1]);
  assert.equal(counters.length, 2,
    `the count is built from ${counters.length} CSS counter(s) `
    + `(${counters.join(', ') || 'none'}) -- it must be built from exactly two, `
    + 'the drawn rows over the total rows, or one half of "n / total" is a literal');
  return { content: flat(content[1]), counters };
}

test('the tree renders one group per registry group, derived from the registry', async () => {
  /* WHY THIS IMPLIES THE OUTPUT CLAIM. The template writes ONE group heading,
     inside one `groups.map(` loop, so the number of headings in the output is
     the length of `groups` -- and `groups` is built by walking LAYER_IDS, which
     `registryGroups()` has just shown yields exactly the registry's groups. Four
     today, and whatever the registry says tomorrow, with no edit here. */
  const { frontmatter, template } = await treeSource();
  const groups = registryGroups();

  assert.match(frontmatter, /\bfor\s*\(\s*const\s+id\s+of\s+LAYER_IDS\s*\)/,
    'the frontmatter does not walk `LAYER_IDS` -- the groups must be DERIVED from '
    + 'the registry flatten, not written out, or a fifth group ships a category of '
    + `layers nowhere at all (the registry declares: ${groups.join(', ')})`);

  const loop = template.indexOf('groups.map(');
  assert.ok(loop !== -1,
    'the template renders no `groups.map(` loop -- outside a loop there is one '
    + 'group in the output however many the registry declares');

  const headings = [...template.matchAll(/class="tree-group-name"/g)];
  assert.equal(headings.length, 1,
    `the group heading is written ${headings.length}x -- it must be written ONCE, `
    + 'inside the groups loop, or the count of headings in the output stops being '
    + 'the count of groups and this test no longer implies one heading per group');
  assert.ok(template.indexOf('class="tree-group-name"') > loop,
    'the group heading sits OUTSIDE the groups loop -- there would then be one '
    + 'heading in the output however many groups the registry declares');
  assert.ok(flat(template).includes('{g.label}'),
    "the heading's text is not {g.label} -- it must be the registry's own label");
});

test('the tree writes down no label the registry owns', async () => {
  /* A label copied here is a second spelling of a string the registry already
     holds, and the two are then free to disagree -- the defect the whole scope
     model was written against. registry.ts records what happened the last time
     one was copied rather than referenced: five Python scripts held private ward
     tables and had ALREADY DIVERGED, 10-44 m apart, with nothing failing. */
  const { frontmatter, template } = await treeSource();
  const code = `${frontmatter}\n${template}`;

  for (const label of registryLabels()) {
    assert.ok(!new RegExp(label.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'), 'i').test(code),
      `LayerTree.astro writes the label "${label}" -- every heading and every row `
      + 'name must come from the registry entry, never from a copy kept here');
  }
});

test('every registered layer produces exactly one row', async () => {
  /* THE COUNTING ARGUMENT. The frontmatter pushes one row per LAYER_ID -- one
     `rows.push(` reached once per iteration of the LAYER_IDS walk -- and the
     template writes ONE <input>, inside one `rows.map(` loop. So the number of
     checkboxes in the output is the number of registered layers: six today.
     A row written outside the loop, or a second push, breaks that arithmetic. */
  const { frontmatter, template } = await treeSource();
  registryGroups();

  const pushes = [...frontmatter.matchAll(/\.rows\.push\(/g)];
  assert.equal(pushes.length, 1,
    `the frontmatter pushes a row ${pushes.length}x -- exactly one push, inside `
    + 'the LAYER_IDS walk, is what makes the row count the layer count');

  const loop = template.indexOf('rows.map(');
  assert.ok(loop !== -1,
    'the template renders no `rows.map(` loop -- outside a loop there is one row '
    + 'in the output however many layers are registered');

  const boxes = [...template.matchAll(/<input\b/g)];
  assert.equal(boxes.length, 1,
    `the template writes <input> ${boxes.length}x -- it must be written ONCE, `
    + 'inside the rows loop, or the number of checkboxes stops being the number '
    + 'of layers and this test no longer implies one row per layer');
  assert.ok(template.indexOf('<input') > loop,
    'the <input> sits OUTSIDE the rows loop -- one checkbox would then be '
    + 'rendered however many layers the registry declares');
});

test('every checkbox carries the data-layer Task 7 finds it by', async () => {
  const { frontmatter, template } = await treeSource();
  registryGroups();

  const input = template.match(/<input\b([^>]*?)\/?>/);
  assert.ok(input, 'the template renders no <input>');
  assert.match(flat(input[1]), /\sdata-layer=\{row\.id\}/,
    'the checkbox carries no data-layer={row.id} -- Task 7 finds the layers by '
    + 'that attribute, and a row without it is a control the script cannot reach, '
    + 'which is a checkbox that ticks and changes nothing');
  assert.match(flat(input[1]), /\stype="checkbox"/,
    'the row control is not a checkbox');

  /* AND `row.id` IS A REAL LayerId, because it is the loop variable of the
     LAYER_IDS walk -- not a string rebuilt from the group and item slugs, which
     is how `splitKey` next door once mis-resolved every slug containing a
     separator, returning a key that existed nowhere. */
  assert.match(frontmatter, /\brows\.push\(\{\s*id\s*,/,
    'the row does not take its id straight from the LAYER_IDS walk -- an id '
    + 'rebuilt by hand can name a layer that does not exist, and nothing about '
    + 'the rendered page looks wrong when it does');
});

test('a layer that cannot be drawn HERE is DISABLED, says WHY, and is never checked', async () => {
  /* THE POINT OF THE WHOLE COMPONENT, and asserted at DUBAI, where five of the
     six layers are unavailable -- the case the tree exists for.

     ASSERTED AGAINST scope/layers.ts, never against a list of layer names written
     here. A hardcoded list would go stale the day a city starts or stops shipping
     an artefact, and it would go stale SILENTLY, since a stale list still
     iterates. */
  const { rich, bare } = twoAreas();
  registryGroups();

  const blocked = LAYER_IDS.filter((id) => !layerAvailability(id, bare, CAPS_ON).available);
  const drawable = LAYER_IDS.filter((id) => layerAvailability(id, rich, CAPS_ON).available);

  /* GUARD THE GUARD, AND IT NOW SPANS TWO AREAS RATHER THAN ONE.
     `disabled` has to be shown to VARY, or a component that hardcoded it either
     way would satisfy everything below. It used to be shown to vary WITHIN the
     bare area — some rows blocked, some drawable — which stopped being possible
     when `layerAvailability` gained its page-level refusal: an area that ships no
     artefacts mounts no map, so nothing there is drawable, including the
     capability-backed row that used to pass on the token alone.
     The variation is therefore asserted across the pair, and the claim is
     STRONGER than the one it replaces: every layer blocked at `bare`, every layer
     drawable at `rich`. Both halves are needed and neither is slack — drop the
     first and `disabled` could be hardcoded false, drop the second and it could be
     hardcoded true. */
  assert.equal(blocked.length, LAYER_IDS.length,
    `${blocked.length} of ${LAYER_IDS.length} layers are blocked at "${bare}", which `
    + 'mounts no map — every one of them must be, or a row is live over a page with '
    + 'no instrument behind it');
  assert.equal(drawable.length, LAYER_IDS.length,
    `only ${drawable.length} of ${LAYER_IDS.length} layers are available at "${rich}" `
    + 'with the token -- `disabled` would be indistinguishable from "always on", and '
    + 'the test would prove nothing');

  /* EVERY REFUSAL NAMES ITS REASON. The Availability union makes
     `{ available: false }` unconstructible without one; this is the check that
     the reason is a sentence rather than an empty string satisfying the type. */
  for (const id of blocked) {
    const { reason } = layerAvailability(id, bare, CAPS_ON);
    assert.equal(typeof reason, 'string', `${id} at "${bare}" refuses with no reason`);
    assert.ok(reason.trim().length > 0,
      `${id} at "${bare}" refuses with an EMPTY reason -- a greyed row with no `
      + 'stated reason reads as a bug in the page rather than as a fact about '
      + 'the world');
  }

  const { frontmatter, template } = await treeSource();

  /* ONE assignment, and it reads the availability. Anything else -- a second
     assignment, a literal, a list of ids -- means a row can be greyed for a
     reason `layerAvailability` never gave. The trailing comma is what keeps the
     `readonly disabled: boolean;` of the Row interface out of the count: a type
     annotation is not an assignment. */
  const assigned = [...frontmatter.matchAll(/disabled:\s*([^,;\n}]+),/g)]
    .map((m) => m[1].trim());
  assert.equal(assigned.length, 1,
    `the frontmatter assigns \`disabled\` ${assigned.length}x `
    + `(${assigned.join(' | ') || 'never'}) -- exactly one assignment, from the `
    + 'availability, is what makes scope/layers.ts the only thing that can '
    + 'disable a row');
  assert.equal(assigned[0], '!available',
    `\`disabled\` is set from \`${assigned[0]}\` -- it must be the negation of the `
    + 'availability `layerAvailability` returned');
  assert.match(frontmatter, /layerAvailability\(\s*id\s*,\s*current\s*,\s*caps\s*\)/,
    'the availability is not obtained from layerAvailability(id, current, caps) -- '
    + 'it must be DERIVED per layer and per area, not declared');

  const input = template.match(/<input\b([^>]*?)\/?>/);
  assert.ok(input, 'the template renders no <input>');
  assert.match(flat(input[1]), /\sdisabled=\{row\.disabled\}/,
    'the <input> does not bind disabled={row.disabled} -- the derivation above '
    + 'would then be computed and thrown away, and every row would render live');

  /* NEVER LIVE-BUT-INERT. A row that cannot be drawn must not start ticked, or
     the tree claims a layer is on the map that is not on the map. */
  assert.match(frontmatter, /checked:\s*entry\.defaultOn\s*&&\s*available/,
    "a row's `checked` is not `entry.defaultOn && available` -- a blocked layer "
    + 'would then render ticked, which is a control that says something false');
  assert.match(flat(input[1]), /\schecked=\{row\.checked\}/,
    'the <input> does not bind checked={row.checked}');

  /* AND THE REASON IS ON THE PAGE. Rendered from `row.reason`, conditioned on
     there BEING one, so an available row grows no empty bronze span. */
  assert.match(flat(template),
    /\{row\.reason !== null && <span class="tree-why">\{row\.reason\}<\/span>\}/,
    'the template does not render `{row.reason !== null && <span '
    + 'class="tree-why">{row.reason}</span>}` -- a disabled row with no visible '
    + 'reason is exactly the "control that does nothing and says nothing" the '
    + 'spec-1 audit found shipped twice');

  /* AND THE REASON IS NOT A COPY. If any refusal sentence appears in the source,
     the tree is restating what layers.ts already says, and the two will drift.

     EVERY SENTENCE THE REGISTRY CAN PRODUCE, not just the ones this area happens
     to produce today. Checking only `bare`'s four would have left the other nine
     copyable -- including the capability refusal and the "declares none under
     that name" clause, neither of which Dubai ever emits. A guard that watches
     four of thirteen is how the eight dead guards in this project got that way. */
  const code = `${frontmatter}\n${template}`;
  const everyReason = new Set();
  for (const key of AREA_KEYS) {
    for (const caps of [CAPS_ON, CAPS_OFF]) {
      for (const id of LAYER_IDS) {
        const { reason } = layerAvailability(id, key, caps);
        if (reason !== null) everyReason.add(reason);
      }
    }
  }
  assert.ok(everyReason.size > 0,
    'the registry produced NO refusal sentence at any area in either capability '
    + 'state -- the loop below would then check nothing');
  for (const reason of everyReason) {
    assert.ok(!code.includes(reason),
      'LayerTree.astro writes a refusal sentence verbatim -- the reason must come '
      + `from layerAvailability, never from a copy kept here: "${reason}"`);
  }
});

test('street-level imagery is refused on the CAPABILITY axis, not the artefact one', async () => {
  /* THE SECOND KIND OF DEPENDENCY. Street-level imagery has no local artefact:
     it is served from tiles.mapillary.com against a token, and the whole feature
     tree-shakes out of a build whose PUBLIC_MAPILLARY_TOKEN is unset. So the tree
     has to be able to disable ONE row for a reason no file could give -- which is
     what proves the capability axis is wired rather than assumed. */
  const { rich } = twoAreas();
  registryGroups();

  const onAtRich = LAYER_IDS.filter((id) => layerAvailability(id, rich, CAPS_ON).available);
  const offAtRich = LAYER_IDS.filter((id) => !layerAvailability(id, rich, CAPS_OFF).available);
  assert.equal(onAtRich.length, LAYER_IDS.length,
    `only ${onAtRich.length} of ${LAYER_IDS.length} layers are available at `
    + `"${rich}" with the token -- this test contrasts that state with the `
    + 'token-off one, and needs the token-on state to be complete');
  assert.equal(offAtRich.length, 1,
    `dropping the capability changes ${offAtRich.length} rows at "${rich}" -- it `
    + 'must change exactly one, or the capability and the artefacts are not the '
    + 'two independent axes the registry claims');
  assert.match(layerAvailability(offAtRich[0], rich, CAPS_OFF).reason, /mapillary/,
    'the capability refusal does not name the capability, so the row would be '
    + 'greyed for a reason nobody can act on');

  /* AND THE COMPONENT PASSES IT THROUGH. A `caps` built from anything but the
     prop -- a module-level read of import.meta.env, a literal true -- is a
     capability the caller cannot vary, which is a capability that cannot be
     rendered in both states and therefore ships untested. */
  const { frontmatter } = await treeSource();
  assert.match(frontmatter, /const\s+caps\s*:\s*Capabilities\s*=\s*\{\s*mapillary\s*\}/,
    'the frontmatter does not build `caps` from the `mapillary` prop -- a tree '
    + 'that reads the token itself cannot be rendered in the token-off state');
  assert.match(frontmatter, /mapillary\s*:\s*boolean/,
    'Props declares no `mapillary: boolean` -- the capability axis would then be '
    + 'something the caller cannot state');
});

test('the n / total count is a CSS counter over the rows, not a number written down', async () => {
  /* THE SUBTLE PART. `n / total` is DERIVED FROM THE ROWS by the browser: the
     rows increment two CSS counters and the group heading's ::after prints them.
     It is therefore right on the first paint with no script running, right after
     a click, and right after a toggle from anywhere else -- Task 7's script, a
     restored session, a query parameter.

     A NUMBER RENDERED INTO THE MARKUP WOULD BE THE DEFECT THIS PROJECT KEEPS
     DELETING: a second copy of a fact the checkboxes already carry, stale the
     first time a layer is toggled by anything at all, since this component ships
     no script of its own. So the count element is EMPTY in the markup, and these
     assertions are what keep it that way. */
  const { template, css } = await treeSource();
  registryGroups();

  const el = template.match(/<(\w+)([^>]*class="tree-count"[^>]*)>([\s\S]*?)<\/\1>/);
  assert.ok(el, 'the template renders no `class="tree-count"` element');
  assert.equal(el[3].trim(), '',
    `the count element renders "${flat(el[3])}" -- it must be EMPTY in the markup. `
    + 'A number written here is a second copy of what the checkboxes already say, '
    + 'and it goes stale the first time a layer is toggled');

  const { content, counters } = countRule(css);
  assert.ok(!/\d/.test(content),
    `the count content is \`${content}\` -- it contains a digit, so at least one `
    + 'half of "n / total" is a literal rather than a reading of the rows');

  /* BOTH counters are incremented BY THE ROWS, and the drawn one only by a row
     whose checkbox is checked. That is what makes the number a reading of the
     tree rather than a claim about it. */
  const increments = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: flat(selector), body: flat(body) }))
    .filter((r) => /counter-increment:/.test(r.body));
  assert.ok(increments.length > 0,
    'nothing in the stylesheet increments a counter -- both halves of the count '
    + 'would render as 0 for ever');
  for (const name of counters) {
    const owners = increments.filter((i) => new RegExp(`\\b${name}\\b`).test(i.body));
    assert.ok(owners.length > 0,
      `the counter \`${name}\` is printed but never incremented -- it renders 0 `
      + 'whatever the tree contains');
    for (const owner of owners) {
      assert.match(owner.selector, /\.tree-row\b/,
        `\`${name}\` is incremented on \`${owner.selector}\`, which is not a row -- `
        + 'the count must be derived from the rows themselves, never from '
        + 'something kept alongside them');
    }
  }
  const drawn = increments.filter((i) => /:checked/.test(i.selector));
  assert.equal(drawn.length, 1,
    `${drawn.length} rules increment a counter on a :checked row -- exactly one `
    + 'must, or the numerator is not "how many are drawn"');

  /* SCOPED PER GROUP. Without its own counter-reset every group would print the
     running total of all the groups above it. */
  const reset = css.match(/\.tree-group\s*\{[^}]*counter-reset:\s*([^;}]*)/);
  assert.ok(reset,
    'no `.tree-group` rule resets the counters -- each group would then print the '
    + 'running total of every group above it');
  for (const name of counters) {
    assert.match(reset[1], new RegExp(`\\b${name}\\b`),
      `the counter \`${name}\` is never reset on .tree-group, so every group after `
      + 'the first prints a running total rather than its own');
  }
});

test('the count the tree shows is lower for Dubai than for Kolkata', async () => {
  /* WHAT THE COUNTER READS. The rows it counts are the checked ones, and a row is
     checked exactly when `entry.defaultOn && available`. So the number the
     browser prints for an area is `drawnCount` of that area, and these are the
     numbers the two renders differ by: Kolkata draws its defaults, Dubai -- which
     ships no per-area artefact at all -- draws none of them.

     THE `checked` ASSERTION IS DELIBERATELY SHARED with the disabled test rather
     than parsed a second way here. It is one claim -- "a row is drawn iff it is a
     default AND available" -- and it carries a different consequence in each
     place: there, that a blocked layer never renders ticked; here, that the
     printed count is `drawnCount`. Breaking it therefore fires both tests, which
     is correct. Two parsers for one fact would be two things free to disagree,
     which is the defect this whole migration exists to delete.

     WITHOUT READING THE COMPONENT this test would be a statement about the
     registry alone -- it would pass with no tree in the repo at all, which is
     exactly the shape of the eight guards here that protected nothing. */
  const { rich, bare } = twoAreas();
  registryGroups();

  const { frontmatter, template } = await treeSource();
  assert.match(frontmatter, /checked:\s*entry\.defaultOn\s*&&\s*available/,
    "a row's `checked` is not `entry.defaultOn && available` -- the printed count "
    + 'would then be counting something other than the drawable defaults, and the '
    + 'comparison below would be about a number the tree never shows');
  assert.match(template, /class="tree-count"/,
    'the tree renders no count element at all -- there is then no number for this '
    + 'comparison to be about');

  const here = drawnCount(rich, CAPS_ON);
  const there = drawnCount(bare, CAPS_ON);
  assert.ok(here > 0,
    `no layer is drawn at "${rich}" either -- with nothing checked anywhere the `
    + 'count is 0 everywhere and this comparison proves nothing');
  assert.ok(here > there,
    `"${rich}" draws ${here} layers and "${bare}" draws ${there} -- the tree must `
    + 'show a LOWER count where fewer layers can be drawn, or the count is not '
    + 'reading the rows');

  /* AND NO AREA CAN EVER DRAW MORE THAN IT HAS, at either capability state. A
     count that could exceed availability would mean a blocked row rendering
     ticked -- the live-but-inert defect, arriving through the count. */
  for (const key of AREA_KEYS) {
    for (const caps of [CAPS_ON, CAPS_OFF]) {
      const available = LAYER_IDS.filter(
        (id) => layerAvailability(id, key, caps).available).length;
      assert.ok(drawnCount(key, caps) <= available,
        `"${key}" would draw ${drawnCount(key, caps)} of ${available} available `
        + 'layers -- a blocked row is rendering ticked');
    }
  }
});

test('every dot is a token the palette declares, and the table is exhaustive', async () => {
  /* THE MOCKUP'S DOTS ARE PER-LAYER HEXES. Task 2's guard fails the build on any
     hex written more than once in a file, and three of the six were already
     tokens. The other three now are too. Writing a hex ONCE here and reusing it
     through a variable would slip past that guard while defeating its purpose, so
     the table holds TOKEN NAMES and the dot is painted with var().

     `Record<LayerId, string>` in the frontmatter is what makes the table
     exhaustive: a seventh layer fails to compile here rather than rendering a
     dot with no colour. This test checks the runtime half of the same claim. */
  const { frontmatter, template, css } = await treeSource();
  const dots = dotTable(frontmatter);

  assert.deepEqual([...dots.keys()].sort(), [...LAYER_IDS].sort(),
    'the DOT table does not cover exactly the registered layers -- a missing '
    + 'entry renders a colourless dot, and a stale one names a layer that is gone');
  assert.match(frontmatter, /const\s+DOT\s*:\s*Record<LayerId,\s*string>/,
    'DOT is not typed `Record<LayerId, string>` -- without it a new layer would '
    + 'compile clean here and render an undefined dot colour');

  /* Re-pointed from v1's palette to v2's tokens.css, which declares every one of these tokens by var() onto the heat/symbol ramps. */
  const declared = new Set(
    [...(await readFile(V2_TOKENS, 'utf8')).matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  assert.ok(declared.size > 0,
    'no token was found in v2 tokens.css -- the loop below would then accept every dot');
  const seen = new Set();
  for (const [id, token] of dots) {
    assert.match(token, /^--[a-z][a-z0-9-]*$/,
      `the dot for ${id} is \`${token}\` -- it must be a token NAME, so the colour `
      + 'has exactly one spelling in the codebase');
    assert.ok(declared.has(token),
      `the dot for ${id} names \`${token}\`, which v2's tokens.css declares `
      + 'nowhere -- var() would resolve to nothing and the dot would be invisible');
    seen.add(token);
  }
  assert.equal(seen.size, dots.size,
    'two layers share a dot colour ('
    + [...dots].map(([i, t]) => `${i}=${t}`).join(', ')
    + ') -- the dot is how a row is told from its neighbour at a glance');

  assert.match(flat(template), /style=\{`--dot: var\(\$\{row\.dot\}\)`\}/,
    'the dot is not painted with var(${row.dot}) -- a per-layer literal in the '
    + 'template is a second place the palette has to be kept up to date');

  /* STREET-LEVEL IS AN OUTLINE, NOT A FILL (founder, option B). v1's --gold was never carried into v2, so the dot painted nothing. v2's symbol rule is solid = measured, outlined = modelled/other; the row takes a ring in an existing ink token and adds no colour. */
  assert.ok(!/--gold/.test(frontmatter + template + css),
    'LayerTree.astro still references --gold, which v2 never declares');
  assert.equal(dots.get('ground/street'), '--ink-2',
    'the Street-level dot is not painted in the existing --ink-2 (text-secondary) token');
  assert.match(frontmatter, /const\s+RING[^=]*=\s*new Set\(\[\s*'ground\/street'\s*\]\)/,
    'Street-level is not in the RING set -- it would render as a filled dot');
  assert.match(flat(template), /is-ring['"]?\s*:\s*RING\.has\(row\.id\)|is-ring['"]?\s*:\s*row\.ring/,
    'the dot does not take the is-ring class from the row');
  const ring = css.match(/\.tree-dot\.is-ring\s*\{([^}]*)\}/);
  assert.ok(ring, 'there is no `.tree-dot.is-ring` rule');
  assert.match(ring[1], /background:\s*transparent/, 'the ring is not transparent-filled');
  assert.match(ring[1], /border:\s*1\.5px\s+solid\s+var\(--dot\)/,
    'the ring is not a 1.5px solid border in the row token');
  assert.match(css, /\.tree-dot\s*\{[^}]*box-sizing:\s*border-box/,
    'the dot is not border-box, so the ring would grow past the other dots\' 7px');
});

test('the tree scopes its styles, casts nothing, and stays usable', async () => {
  const { frontmatter, styles, css } = await treeSource();

  assert.ok(styles.length > 0, 'LayerTree.astro has no <style> block at all');
  for (const [, attrs] of styles) {
    assert.ok(!/is:global/.test(attrs),
      'LayerTree.astro uses <style is:global> -- its markup is entirely '
      + 'Astro-rendered and static, so the scoping hash reaches it and the style '
      + 'has no reason to leak');
  }

  for (const cast of [/\bas\s+any\b/, /\bas\s+unknown\s+as\b/, /@ts-(ignore|expect-error|nocheck)/]) {
    assert.ok(!cast.test(frontmatter),
      `LayerTree.astro frontmatter matches ${cast} -- scope/layers.ts exports a `
      + 'typed splitter and a typed guard for everything this tree needs, and a '
      + 'cast here is how the registry shape drifts out from under it');
  }

  assert.match(css, /:focus-visible/,
    'the tree has no :focus-visible rule -- the checkboxes are appearance:none, '
    + 'so without one a keyboard user cannot see which layer they are on');
  assert.match(css, /@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/,
    'the tree transitions its rows with no prefers-reduced-motion escape');
});

/* ═══════════════════════════════════════════════════════════════════════════
   TASK 6 — THE INTERVENTION PANE, WHICH IS A MOVE AND NOT AN EDIT.

   The Green Infrastructure Toolbox left HeatMapStage.astro for a file of its
   own, so Task 7 has four components to compose rather than three and a
   monolith. Nothing about it changed on the way out: same sliders, same
   segmented controls, same score ring, same pillars, SAME IDS.

   THE IDS ARE THE WHOLE RISK. heat-map-app.ts finds every one of the seventeen
   below by name at runtime, through `el(...)` and
   `querySelectorAll('#segPhase button')`. Rename one, drop one, or leave a
   second copy behind in the stage, and the failure is SILENT: the query
   returns null — or the wrong one of two duplicates — the handler shrugs, and
   the control simply stops responding. Nothing throws and the page still looks
   right. That is the exact failure shape this project keeps paying for, so it
   gets a tripwire rather than a careful reviewer.

   TWO HALVES, AND BOTH ARE NEEDED:

     · every id is PRESENT in the component — a lost id is a dead control;
     · no id is STILL IN THE STAGE — a copy-paste that forgot to delete the
       original leaves two elements carrying one id, which is invalid HTML and
       makes getElementById return whichever the parser reached first. The
       markup would look moved and behave as though it had not been.

   `scoreArc` is the sharpest of the seventeen: heat-map-app.ts:1656 does
   setAttribute('stroke', tier.colour) on it, so its `stroke` has to stay an
   attribute the runtime can win. That is a claim about its STYLING, held by
   the stage's own comment and by Task 2's colour guard; here we only insist
   the element still exists to be styled.

   GUARD THE GUARD. Nine guards in this project have passed while protecting
   nothing, one of them by checking a component that was not in the repo at
   all. So, in this fourth part:

     · an unreadable or empty component FAILS (`paneSource`), rather than
       letting seventeen "is this id present" checks run over an empty string
     · an unreadable or empty stage FAILS (`stageSource`), for the same reason
       in the other direction — an absent file contains no duplicate ids
     · an ID TABLE that is empty, that is not exactly seventeen long, or that
       repeats an entry FAILS: every loop below walks it, and a table of zero
       asserts nothing while a table with a duplicate covers sixteen ids while
       claiming seventeen
     · a stage that does not INVOKE the pane FAILS. Deleting the aside and
       never mounting the component satisfies "no ids in the stage" perfectly,
       and ships a page with no toolbox on it.
   ═══════════════════════════════════════════════════════════════════════════ */

const PANE = new URL(
  '../../src/components/ClimateEngine/shell/InterventionPane.astro', import.meta.url);

/**
 * THE SEVENTEEN, verbatim as heat-map-app.ts spells them.
 *
 * Not derived from the component — a list read out of the file it is checking
 * would agree with any file, including one that had lost sixteen of them. This
 * is a second, independent copy on purpose: it is the specification, and the
 * component is the thing measured against it.
 */
const PANE_IDS = [
  'v1', 'ivTrees',
  'v2', 'ivRoof',
  'v4', 'ivFacades',
  'segPhase', 'segPath',
  'scoreArc', 'scoreNum', 'scoreTier', 'scoreTxt',
  'subs', 'sGreen', 'sCool', 'sEff', 'scoreConf',
];

/**
 * An `id="x"` ATTRIBUTE, in either quote style — never a CSS selector, never
 * prose.
 *
 * This distinction is load-bearing for the no-duplicates half. The stage still
 * STYLES the pane, because the toolbox's rules stayed in its is:global block
 * (heat-map-app.ts writes classes onto these elements at runtime, and a
 * scoping hash does not reach a class added after render). So `#scoreArc` and
 * `#segPhase` legitimately remain in the stage's stylesheet, and its comments
 * name them too. Only a second `id=` ATTRIBUTE puts a second element in the
 * DOM, and only that is a defect.
 */
const idAttr = (id) => new RegExp(`id\\s*=\\s*["']${id}["']`);

/** The table itself, checked before anything walks it. */
function paneIds() {
  assert.ok(PANE_IDS.length > 0,
    'the PANE_IDS table is EMPTY -- every loop below would iterate zero times '
    + 'and the suite would pass over a component containing nothing at all');
  assert.equal(new Set(PANE_IDS).size, PANE_IDS.length,
    'the PANE_IDS table repeats an entry ('
    + PANE_IDS.filter((id, i) => PANE_IDS.indexOf(id) !== i).join(', ')
    + ') -- it would then claim to cover seventeen ids while covering fewer');
  assert.equal(PANE_IDS.length, 17,
    `the PANE_IDS table holds ${PANE_IDS.length} ids, not the seventeen the `
    + 'toolbox carries -- if the toolbox genuinely gained or lost a control '
    + 'then heat-map-app.ts changed too, and this number is the record of it');
  return PANE_IDS;
}

async function paneSource() {
  let src;
  try {
    src = await readFile(PANE, 'utf8');
  } catch (err) {
    assert.fail(
      'src/components/ClimateEngine/shell/InterventionPane.astro could not be '
      + `read (${err.code ?? err.message}) -- the id assertions below read it, `
      + 'so a missing file must fail rather than let seventeen "is it present" '
      + 'checks run over an empty string and every one of them pass');
  }
  assert.ok(src.trim().length > 0,
    'InterventionPane.astro is EMPTY -- an empty file contains no WRONG id, '
    + 'which is not remotely the same as containing the right seventeen');
  return src;
}

test('the pane carries all seventeen ids heat-map-app.ts finds by name', async () => {
  const ids = paneIds();
  const src = await paneSource();

  const missing = ids.filter((id) => !idAttr(id).test(src));
  assert.deepEqual(missing, [],
    `InterventionPane.astro is missing ${missing.length} of the seventeen `
    + `ids: ${missing.join(', ')} -- heat-map-app.ts queries each of these by `
    + 'name, gets null, and the matching control silently stops responding');

  /* THE COUNT AS WELL AS THE MEMBERSHIP. A pane holding all seventeen plus a
     stray eighteenth is a different component from the one that was moved, and
     an extra `id=` is how a half-finished edit hides inside a "move". */
  const present = [...src.matchAll(/id\s*=\s*["']([A-Za-z][\w-]*)["']/g)]
    .map((m) => m[1]);
  assert.ok(present.length > 0,
    'no id attribute at all was found in InterventionPane.astro -- the file '
    + 'exists and is not empty, so the markup did not arrive with it');
  assert.deepEqual([...new Set(present)].sort(), [...ids].sort(),
    'InterventionPane.astro does not hold exactly the seventeen moved ids -- '
    + `it holds ${new Set(present).size}: `
    + `${[...new Set(present)].sort().join(', ')}`);
  assert.equal(present.length, ids.length,
    'an id is written TWICE inside InterventionPane.astro ('
    + present.filter((id, i) => present.indexOf(id) !== i).join(', ')
    + ') -- two elements, one id, and getElementById picks the first');
});

/* (v1's PairedBench rail/bench-markup tests retired with PairedBench.astro; v2's Compare is held by obos-v2-compare-contract.) */

test('the pane switcher is portable and the scope half is not', async () => {
  /* THE SPLIT, AND WHY IT IS A SPLIT RATHER THAN A LOOSENED CHECK. The pane half
     is about a CONSOLE and both routes have one. The scope half is about a page
     scoped to ONE area, which Compare is not -- it holds a pair, and its A/B
     selects are its scope control. Keyed on `.stage[data-area]`, the whole
     function returned null on Compare and left three rail buttons inert.
     Making the area check optional would have traded those three dead buttons for
     a silently unvalidated area, which is the worse bug: `resolve` dies mid-render
     on a bad key, and the throw exists to say so at the boundary instead. */
  const shell = strip(await readFile(
    new URL('../../src/scripts/climate-engine/shell/console-shell.ts', import.meta.url),
    'utf8'));
  assert.ok(shell.length > 0, 'console-shell.ts read back empty');

  assert.match(shell, /querySelector<HTMLElement>\('\[data-console\]'\)/,
    'the shell no longer finds its console by [data-console] -- keyed on the '
    + 'stage it does not run on Compare at all, and the rail there becomes three '
    + 'buttons with nothing behind them');
  assert.doesNotMatch(shell, /'\.stage\[data-area\]'/,
    "the shell still keys on '.stage[data-area]'. That selector treats a stage "
    + 'which has LOST its data-area as "no console here" and returns null in '
    + "silence; querying '.stage' and refusing a bad key is stricter, not looser");
  assert.match(shell, /const stage = document\.querySelector<HTMLElement>\('\.stage'\)/,
    'the scope half must still find a stage of its own to validate');
  assert.match(shell, /if \(!isAreaKey\(declared\)\) \{[\s\S]{0,200}?throw new Error/,
    'the shell no longer THROWS on a stage whose data-area is not a registered '
    + 'area. Falling back to a default would open one place while the page names '
    + 'another, silently -- the refusal heat-map-app.ts makes for the same reason');

  /* THE PANE QUERIES ARE SCOPED TO THE CONSOLE. Two routes carry `.pane` and
     `.sidebar` now, and a document-wide query is one ClientRouter swap away from
     painting the outgoing route's panes. */
  for (const sel of ['\\.sidebar', '\\.pane\\[data-pane\\]', 'button\\[data-rail\\]']) {
    assert.match(shell, new RegExp(`consoleRoot\\.querySelector(All)?<[^>]+>\\('${sel}'\\)`),
      `the shell queries '${sel.replace(/\\\\/g, '')}' off the document rather than off the `
      + 'console root -- with two consoles in the codebase that is a query that '
      + 'can reach the wrong one');
  }
});

test('the compare page mounts the console shell as well as the bench', async () => {
  /* A mount that is never called is markup with no behaviour: the rail would
     render, and every one of its buttons would do nothing -- which is precisely
     the state this task exists to end. */
  const page = await readFile(
    new URL('../../src/pages/heat-map/compare.astro', import.meta.url), 'utf8');
  assert.ok(page.trim().length > 0, 'compare.astro read back empty');
  /* THE CALL, NOT THE NAME. This assertion was first written as
     `assert.match(page, /mountConsoleShell/)` and was WATCHED TO FAIL -- it did
     not. Deleting the call line left the import and the destructured binding
     behind, so the name was still in the file and the guard passed over a page
     whose rail was inert: the precise defect it exists to catch, and the twelfth
     guard in this project caught protecting nothing. Asserting the ASSIGNMENT is
     what makes it bite, because a mount whose disposer is dropped is the other
     half of the same bug. */
  assert.match(page, /disposeShell\s*=\s*mountConsoleShell\(\)/,
    'compare.astro never CALLS mountConsoleShell and keeps its disposer -- the '
    + 'rail renders and none of its pane buttons is wired to anything');
  assert.match(page, /dispose\s*=\s*mountPairedBench\(\)/,
    'compare.astro no longer mounts the bench itself');
  /* DISPOSED, BOTH. The site runs Astro's ClientRouter, and a listener left on a
     removed element leaks and then fires against the wrong document. */
  assert.match(page, /astro:before-swap[\s\S]{0,300}?disposeShell/,
    'the console shell is mounted on the compare route but never disposed on '
    + 'astro:before-swap -- its listeners outlive the page they were bound to');
});

test('the solar screen is wired end to end and never prints a headline without its floor', async () => {
  /* Source assertions, the harness's idiom: the card block is painted only when a
     building is selected on a WebGL canvas the software renderer cannot reliably
     click, so the wiring is pinned here and the page test reaches the card
     through a ranked row instead. */
  /* RE-POINTED (PR 2): v1's stage and bench are deleted, so every markup assertion below reads the v2 components the page is now made of. */
  const stage = await v2Markup();
  const app = await readFile(new URL('../../src/scripts/climate-engine/heat-map-app.ts', import.meta.url), 'utf8');
  const paths = await readFile(new URL('../../src/scripts/climate-engine/scope/paths.ts', import.meta.url), 'utf8');
  /* v2's menu has one Solar item and the pane is the stage's; Compare carries no Solar pane by design (its menu item navigates), so the bench is not asked for one. */
  assert.match(stage, /data-side-pane="solar"/,
    'the v2 stage renders no Solar pane -- the menu item would open nothing');
  assert.match(paths, /pv:\s*`\$\{DATA\}pv-\$\{area\}\.json`/, 'paths.ts names no solar file');
  /* The ward boundary joined the call on 2026-10-03 (KMC Ward 68): a polygon area's file
     must also carry the ward's own totals, sized to the boundary's roof count. */
  assert.match(app, /pvCache\[name\] = asPvFile\(pvRaw, d\.b\.length, areaOf\(name\), maskCache\[name\] \?\? null\)/,
    'the ward loader does not validate the solar file against the ward -- '
    + "a wrong-ward file would hand every roof a stranger's figures");
  assert.match(app, /pv\.loss_strict\[i\]/,
    'the card does not print the strict-mask floor -- the mask rule is the largest lever and the headline must never print alone');
  assert.match(app, /mean_loss_strict/, 'the ward panel and pane do not print the strict-mask floor');
  assert.match(app, /paintSolarCard\(b\)/, 'paintCard does not paint the solar block');
  assert.match(app, /localStorage\.setItem\(TARIFF_KEY/, 'the tariff is not remembered');
  assert.match(app, /map\.easeTo\(/, 'a ranked row does not bring the camera to its building -- a card projected from a building outside the view is a card nobody sees');
  /* THE LADDER. The card leads with the interval, wears the tier it has earned,
     and every limit names the one thing that would narrow it. Pinned here because
     the card paints only for a selected building, which the software renderer
     cannot be trusted to click. */
  assert.match(stage, /id="bcSolTier"/,
    'the solar card wears no tier chip -- a screening figure that does not say it is screened reads as a measurement');
  assert.match(stage, /<details class="bc-sure"/,
    'the card carries no "how sure" disclosure -- the limits stay unwritten and only we know them');
  /* Counted INSIDE the disclosure, not over the file: a rung added to some other
     block would otherwise satisfy the ladder's own count. */
  const sure = stage.match(/<details class="bc-sure"[\s\S]*?<\/details>/)?.[0] ?? '';
  assert.equal((sure.match(/<li data-limit=/g) ?? []).length, 5,
    'the how-sure ladder does not have its five rungs (spec 2026-09-07-solar-guide §2.3)');
  /* THE INSTALLER BRIEF (Task 5, spec 2026-09-07-solar-guide §6). The button was
     born `hidden` because a styled button that does nothing is a lie the reader can
     click; it is on screen now, and these pins are what earn it that. The `hidden`
     half is asserted in the NEGATIVE on purpose -- re-adding the attribute to quiet
     a failing render would put the lie straight back. */
  assert.match(stage, /id="bcBrief"/, 'the installer-brief button is gone from the card');
  assert.doesNotMatch(stage, /id="bcBrief"[^>]*hidden/,
    'the installer-brief button is still `hidden` -- its renderer exists, so the reader must be able to reach it');
  assert.match(app, /function renderBrief\(/,
    'nothing renders the installer brief -- the button would open an empty sheet');
  assert.match(stage, /id="solBrief"/,
    'the printable brief section is missing (spec §6): the button has nowhere to render into');
  assert.match(await v2Css(), /@media print/,
    'v2 carries no print stylesheet -- window.print() would put the whole console on paper');
  /* THE SIX QUESTIONS, verbatim (spec §6.5). This list is the only part of the
     sheet that is not computed, and it is the part a reader takes to a salesman:
     a reworded question is a different question, so it is pinned word for word. */
  for (const ask of [
    'proposed tilt and orientation',
    'module count and DC capacity',
    'expected yield against ours',
    'shading study',
    'net-metering limit',
    'monitoring access',
  ]) {
    assert.ok(stage.includes(ask),
      `the installer brief does not ask about "${ask}" -- the checklist is the sheet's whole point`);
  }
  assert.match(app, /pvRanges\(/,
    'the card paints points, not intervals -- pvRanges is the only place the published bands become a roof range');
  assert.match(app, /mailto:ant@deltaclimate\.earth\?subject=/,
    'no fix line can be asked about -- the ladder names limits and offers no way to close one');
  /* PAYBACK, BUT NEVER BARE (spec 2026-09-30-solar-roi §4). The sheet and the brief
     each carry the assumptions line and the estimate tag beside the figure; the ward
     line prints the tag. A payback without them is a quote, and that is where the
     liability the old guard named lives. */
  assert.match(stage, /id="solPay"[^>]*role="dialog"/, 'the payback sheet is missing or is not a dialog');
  const sheet = stage.slice(stage.indexOf('id="solPay"'), stage.indexOf('</section>', stage.indexOf('id="solPay"')));
  for (const id of ['spPayback', 'spSaving', 'spAssume', 'spTag', 'spSize', 'spCostLo', 'spCostHi', 'spTariff', 'spClose']) {
    assert.ok(sheet.includes(`id="${id}"`), `the payback sheet lacks #${id}`);
  }
  /* Comments stripped FIRST: a tag parked in an Astro or HTML comment is never on screen (audit fix 4). */
  const sheetLive = sheet.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(sheetLive.includes('screened · estimate, not a quote'), 'the sheet does not say it is an estimate, not a quote');
  assert.match(sheetLive, /id="spTag"[^>]*>screened · estimate, not a quote</, '#spTag does not carry the estimate tag');
  assert.match(stage, /id="brPay"/, 'the installer brief has no payback row');
  assert.match(stage, /id="brPayAssume"/, 'the brief prints a payback without its assumptions');
  assert.match(app, /ESTIMATE_TAG/, 'the app never prints the estimate tag beside a payback');
  assert.match(await v2Css(), /#bcard \.bc-brief\[hidden\] \{ display: none; \}/,
    '.bc-brief sets display:inline-flex, so without this rule #bcPay can never hide on a city with no cost basis');
  /* THE PANE AND THE CSV (Task 4, spec 2026-09-07-solar-guide §5). The ward block
     wears its own tier chip -- the card's is per-roof and cannot stand in for the
     whole ward -- and the CSV hands over the same ranges and tier the pane shows. */
  for (const col of ['kwh_low', 'kwh_high', 'kwp_high', 'tier', 'basis']) {
    assert.match(app, new RegExp(`\\['${col}'`),
      `the CSV's [name, value] pairs carry no '${col}' column -- the sheet a reader downloads must match what the pane shows them`);
  }
  /* THE MECHANISM, NOT THE LITERAL: the header must be DERIVED from the same
     ordered pairs each row writes, so a column inserted in one place cannot
     misalign name from value the way two independently typed strings could. */
  assert.match(app, /\.map\(\(\[name\]\) => name\)\.join\(','\)/,
    'the CSV header is not derived from the row pairs\' own names -- a hand-typed header string and a hand-typed row can drift apart under a column insert');
  assert.match(stage, /id="solPaneTier"/,
    'the Solar pane wears no tier chip of its own -- the card\'s chip is per-roof and cannot stand in for the whole ward');
  assert.match(stage, /<th scope="col">range<\/th>/,
    'the roof table gains no range column -- the ten-roof list still prints a point where the pane prose already promises a range');
  assert.match(stage, /id="solPaneSure"/,
    'the ward block carries no one-line ladder summary -- spec §5 asks for the chip AND a summary, not the chip alone');
  assert.match(app, /setText\('solPaneSure'/,
    'nothing paints the ward block\'s ladder summary -- the markup exists but is never filled');
});

test('the payback sheet says "quote" only to deny it, and the ward line carries its assumptions', async () => {
  /* spec 2026-09-30-solar-roi §4 rule 3: "quote" appears only in "not a quote". A
     cost note once said "Edit it to your quote", which turns the estimate into the
     thing it is not. Checked on the sheet's markup and its controller. */
  const stage = await v2Markup();
  const at = stage.indexOf('id="solPay"');
  const sheetMarkup = stage.slice(at, stage.indexOf('</section>', at));
  const controller = await readFile(new URL(
    '../../src/scripts/climate-engine/solar-payback-sheet.ts', import.meta.url), 'utf8');
  for (const [name, src] of [['#solPay markup', sheetMarkup], ['solar-payback-sheet.ts', controller]]) {
    for (const m of src.matchAll(/quote/gi)) {
      assert.equal(src.slice(m.index - 6, m.index + 5).toLowerCase(), 'not a quote',
        `${name} says "quote" outside "not a quote": …${src.slice(m.index - 30, m.index + 20)}…`);
    }
  }
  /* §4 rules 2, 5, 6: the ward line names the case, the valuation, the tariff and the
     as-of date beside the tag, and is hidden with the block it sits in. */
  const app = await readFile(new URL('../../src/scripts/climate-engine/heat-map-app.ts', import.meta.url), 'utf8');
  /* "Conservative" overclaimed: valuing every kWh flatters in West Bengal (audit fix 3). */
  assert.doesNotMatch(app, /Conservative city case/, 'the ward line calls a flattering case conservative');
  /* Since KMC Ward 68 (2026-10-03) the case names the ward and its roofs where a polygon
     exists ("KMC Ward 68 estimate: every roof in the ward …"), and reads as before elsewhere. */
  assert.match(app, /\$\{wardMask \? `\$\{wardMask\.name\} estimate` : 'Whole-ward estimate'\}: every roof\$\{wardMask \? ' in the ward' : ''\} that can take \$\{MIN_SYSTEM_KW\} kW or more, at its floor capacity, no subsidy, every kWh valued at \$\{fmtRate\(tariff, COSTS\)\} as if all of it is used: \$\{verdict\}/,
    'the ward payback line no longer states its case, valuation and tariff');
  assert.match(app, /per kW, today's prices`\s*\+ ` · reference defaults as of/, "the ward line drops \"today's prices\"");
  /* `rows` since Ward 68: the ward's roofs, every roof where there is no polygon. */
  assert.match(app, /const r = wardRoi\(pv, SOLAR_BASIS, tariff, rows\);/, 'the ward line is computed in the app, not by the tested wardRoi');
  assert.doesNotMatch(app, /wardInput\(/, 'the app builds the ward input itself again, outside the tested wardRoi');
  assert.match(app, /reference defaults as of \$\{oldestAsOf\(SOLAR_BASIS\)\} · \$\{ESTIMATE_TAG\}/,
    'the ward payback line no longer carries the as-of date and the estimate tag');
  assert.match(app, /if \(!has\) \{ show\('solPanePay', false\);/,
    'a ward with no solar file leaves a stale payback line beside a hidden block');
  /* Escape on the sheet stops there; the app's window-level Escape would deselect the roof. */
  assert.match(controller, /close\(\); e\.stopPropagation\(\);/,
    "the sheet's Escape reaches the app and deselects the roof the reader is returning to");
  assert.match(app, /if \(!b\) \{ closeBrief\(\); paySheet\?\.close\(\); \}/,
    'deselecting a roof leaves its payback sheet open');
});

test('the payback CSV carries the estimate tag on every row (audit fix 1)', async () => {
  /* roiCsv puts its assumptions argument on every row; the controller must hand it the
     assumptions AND the tag, or a downloaded year-by-year sheet travels as a bare figure. */
  const controller = await readFile(new URL(
    '../../src/scripts/climate-engine/solar-payback-sheet.ts', import.meta.url), 'utf8');
  assert.match(controller, /roiCsv\(r, `\$\{assume\(r, size\)\} · \$\{ESTIMATE_TAG\}`\)/,
    "the sheet's CSV is built without the estimate tag beside its assumptions");
});

test('no infinity: the tariff is capped where it is typed and where it is remembered (audit fix 2)', async () => {
  const app = await readFile(new URL('../../src/scripts/climate-engine/heat-map-app.ts', import.meta.url), 'utf8');
  const controller = await readFile(new URL(
    '../../src/scripts/climate-engine/solar-payback-sheet.ts', import.meta.url), 'utf8');
  /* the stored delta:hm-tariff is read through the same guard the box uses */
  assert.match(app, /const t = Number\(localStorage\.getItem\(TARIFF_KEY\)\);\s*if \(tariffOk\(t\)\) tariff = t;/,
    'a stored tariff of 1e308 is read back unguarded');
  assert.match(app, /const bad = !tariffOk\(v\);/, "the pane's tariff box accepts any positive number, 1e308 included");
  assert.match(controller, /invalid\('spTariff', !tariffOk\(v\)\)/, "the sheet's tariff box is marked by a different rule from the pane's");
  assert.match(controller, /costOk\(a\)/, 'the sheet accepts any positive cost per kW');
  assert.match(controller, /unitsOk\(v\)/, 'the sheet accepts any positive units a month');
  assert.match(controller, /if \(!roiFinite\(r\)\)/, 'the sheet would paint a non-finite payback or saving');
  /* the sheet's box says when it refuses, and the note it points at is painted from the shared ceiling */
  const stage = await v2Markup();
  assert.match(stage, /id="spTariff"[^>]*aria-describedby="spTariffNote"/, '#spTariff points at no note saying when it is refused');
  assert.match(stage, /id="spTariffNote"/, 'the tariff note #spTariff points at does not exist');
  assert.match(controller, /setText\('spTariffNote', `[^`]*\$\{d\.rate\(TARIFF_MAX\)\}/, 'the tariff note does not name the ceiling the guard uses');
});

test('stronger payback guards: the brief tags its assumptions, the sheet paints them (audit fix 4)', async () => {
  const app = await readFile(new URL('../../src/scripts/climate-engine/heat-map-app.ts', import.meta.url), 'utf8');
  const controller = await readFile(new URL(
    '../../src/scripts/climate-engine/solar-payback-sheet.ts', import.meta.url), 'utf8');
  /* the expression itself, not the import: an imported tag nobody prints satisfies /ESTIMATE_TAG/ */
  assert.match(app, /payAssume\.textContent = `\$\{pay\.assume\} · \$\{ESTIMATE_TAG\}`;/,
    "the brief's #brPayAssume prints the assumptions without the estimate tag");
  assert.match(controller, /setText\('spAssume', assume\(r, size\)\);/, 'the sheet never paints #spAssume');
  /* M3c: the FINITE path paints it too, not only the out-of-range branch above it */
  const guardAt = controller.indexOf('if (!roiFinite(r)) {');
  const finiteFrom = controller.indexOf('return;\n    }', guardAt);
  const finitePath = controller.slice(finiteFrom, controller.indexOf('function setSize', finiteFrom));
  assert.ok(guardAt > 0 && finiteFrom > guardAt, 'the sheet has no roiFinite branch to read past');
  assert.match(finitePath, /setText\('spAssume', assume\(r, size\)\);/, 'the sheet paints a finite payback without #spAssume');
  /* M3b: the brief SHOWS the assumptions it writes (the row is born hidden) */
  assert.match(app, /if \(pay\) \{ payAssume\.textContent = `[^`]*`; payAssume\.removeAttribute\('hidden'\); \}/,
    "the brief writes #brPayAssume but never un-hides it");
});

test("the sheet's saving cell begins with a capital (audit fix 7)", async () => {
  const controller = await readFile(new URL(
    '../../src/scripts/climate-engine/solar-payback-sheet.ts', import.meta.url), 'utf8');
  assert.match(controller, /setText\('spSaving', capFirst\(savingText\(r, d\.money, H\)\)\);/,
    '#spSaving can begin "a loss of …" in lower case');
});
