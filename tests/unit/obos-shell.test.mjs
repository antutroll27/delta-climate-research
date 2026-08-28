import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * THE ICON RAIL, READ AS SOURCE.
 *
 * An .astro component cannot be imported here: the runner is
 * `node --import tsx --test`, tsx understands TypeScript and not Astro, and
 * rendering one needs the Astro compiler plus the Vite pipeline. So these are
 * SOURCE assertions, and each one states which property of the source it reads
 * and why that property forces the property of the OUTPUT that actually matters.
 * Where a claim is about the rendered page the reasoning is written out rather
 * than assumed, because a source test that has quietly stopped implying its
 * output claim is precisely the dead guard this suite exists to avoid being.
 *
 * GUARD THE GUARD. Seven guards in this project have passed while protecting
 * nothing -- typically by iterating a list that came back empty, or by reading a
 * file that was not there and treating the absence as consent. So: an unreadable
 * or empty component FAILS here, an unparseable one FAILS, and an empty section
 * table FAILS. `railSource()` and `sectionTable()` are the only two doors into
 * the source, and both of them are shut.
 */

const RAIL = new URL('../../src/components/ClimateEngine/shell/IconRail.astro', import.meta.url);

/** The five sections the design gives the rail. Not four, and not six. */
const SECTION_IDS = ['analysis', 'layers', 'map', 'reports', 'scenarios'];

/** Comments are not code. An id, an `<a>` or a label in prose must not count. */
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');

/** Whitespace-insensitive, so reformatting the component cannot silently pass. */
const flat = (s) => s.replace(/\s+/g, ' ').trim();

async function railSource() {
  let src;
  try {
    src = await readFile(RAIL, 'utf8');
  } catch (err) {
    assert.fail(
      'src/components/ClimateEngine/shell/IconRail.astro could not be read '
      + `(${err.code ?? err.message}) -- every assertion below reads it, so a `
      + 'missing file must fail rather than let the suite pass vacuously');
  }
  assert.ok(src.trim().length > 0, 'IconRail.astro is empty -- nothing to check');

  const split = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  assert.ok(split, 'IconRail.astro has no `---` frontmatter fence -- the tests '
    + 'below read the frontmatter and the template separately and cannot tell '
    + 'them apart without it');

  const body = split[2];
  const styles = [...body.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)];
  return {
    frontmatter: strip(split[1]),
    template: strip(body.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')),
    styles,
    css: styles.map((m) => m[2]).join('\n'),
  };
}

/** The declared sections, as `{ id, label, href, pane }`. Never an empty list. */
function sectionTable(frontmatter) {
  const block = frontmatter.match(/const\s+SECTIONS[^=]*=\s*\[([\s\S]*?)\n\s*\];/);
  assert.ok(block, 'IconRail.astro declares no `const SECTIONS = [ ... ];` -- the '
    + 'sections are read from that table, and a table that cannot be found must '
    + 'fail rather than yield an empty list that nothing then checks');

  const entries = [...block[1].matchAll(
    /\{\s*id:\s*'([a-z]+)'\s*,\s*label:\s*'([^']+)'\s*,\s*href:\s*([^,]+),\s*pane:\s*(true|false)\s*,/g)]
    .map(([, id, label, href, pane]) => ({ id, label, href: href.trim(), pane: pane === 'true' }));

  assert.ok(entries.length > 0, 'the SECTIONS table parsed to ZERO entries -- '
    + 'either the table is empty or its fields are no longer `id`, `label`, '
    + '`href`, `pane` in that order; both must fail, because every loop below '
    + 'would otherwise assert nothing');
  return entries;
}

/**
 * The two arms of the section loop, as raw text.
 *
 * Sliced from `items.map(` to the end of the <nav>, so nothing outside the loop
 * can satisfy a per-section assertion. It used to stop at `rail-settings`, a
 * control pinned to the bottom that was deliberately NOT a section; that control
 * has been deleted rather than wired, because nothing existed for it to open and
 * a control that does nothing is the defect this project keeps paying for. The
 * brand mark is the only other element in the nav and it sits BEFORE the loop, so
 * the slice excludes it without having to name it.
 */
function loopArms(template) {
  const start = template.indexOf('items.map(');
  assert.ok(start !== -1, 'IconRail.astro renders no `items.map(` loop -- the '
    + 'assertions below read the loop arms and cannot find them');
  const region = template.slice(start);
  const end = region.indexOf('</nav>');
  return end === -1 ? region : region.slice(0, end);
}

test('the rail carries all five sections, each declared exactly once', async () => {
  const { frontmatter } = await railSource();
  const ids = sectionTable(frontmatter).map((s) => s.id);
  assert.equal(ids.length, 5,
    `the rail declares ${ids.length} sections, not 5: ${ids.join(', ') || '(none)'}`);
  assert.deepEqual([...ids].sort(), SECTION_IDS,
    'the rail must carry exactly Map, Layers, Analysis, Reports and Scenarios, '
    + `each once -- it declares: ${ids.join(', ')}`);
});

test('the rail carries the mode: two sections navigate, three swap the pane', async () => {
  /* Mixed verbs, deliberately. Map and Analysis are ROUTES -- the old Explore and
     Compare tabs, which the rail replaces as the only navigation. Layers, Reports
     and Scenarios swap the sidebar pane and go nowhere, so they declare no href
     and can only ever be buttons. */
  const { frontmatter } = await railSource();
  const href = new Map(sectionTable(frontmatter).map((s) => [s.id, s.href]));

  assert.equal(href.get('map'), 'explorePath',
    'Map must navigate to the Explore route the page was given');
  assert.equal(href.get('analysis'), 'COMPARE_PATH',
    'Analysis must navigate to the compare route');
  for (const id of ['layers', 'reports', 'scenarios']) {
    assert.equal(href.get(id), 'null',
      `${id} swaps the sidebar pane -- it navigates nowhere, so it must declare `
      + 'no href and can only render as a button');
  }
  assert.match(frontmatter, /const COMPARE_PATH\s*=\s*'\/heat-map\/compare\/'/,
    'the compare route must be written once, as a named constant');
  assert.match(frontmatter, /explorePath\s*=\s*DEFAULT_AREA_PATH/,
    'explorePath must default to DEFAULT_AREA_PATH from scope/paths.ts rather '
    + 'than to a second hand-written copy of the default area URL');
});

test('the ACTIVE section renders as a <button>, never as a link to itself', async () => {
  /* WHY THIS IS THE ASSERTION. The old Explore tab carried aria-current="page"
     while its href pointed somewhere else entirely -- a lie to a screen reader,
     and an extra hop for everyone else. Spec 1 fixed that by pointing the href at
     the page it was on, which leaves the OTHER half of the same defect: a link to
     the page you are already standing on. The rail closes it structurally -- the
     section you are IN has its href taken away, so no arm of the template can
     render it as an anchor. */
  const { frontmatter, template } = await railSource();

  assert.ok(flat(frontmatter).includes('const current = s.id === route'),
    'the section derivation must compare against `route` -- the page it is ON. '
    + 'Compared against `pane` instead, Map would render as an <a> to the URL you '
    + 'are already standing on the moment any other pane is opened, which is the '
    + 'self-link this whole derivation exists to remove');
  assert.ok(flat(frontmatter).includes('href: current ? null : s.href'),
    'the section derivation must strip the href from the CURRENT section '
    + '(`href: current ? null : s.href`). Without it the active section renders '
    + 'as an <a> pointing at the page it is already on');

  const branch = template.indexOf('s.href === null');
  assert.ok(branch !== -1,
    'the template must choose its element by `s.href === null`, so that a '
    + 'section with no href -- which now includes the active one -- is a button');
  const button = template.indexOf('<button', branch);
  const anchor = template.indexOf('<a ', branch);
  assert.ok(button !== -1 && anchor !== -1,
    'the loop must have both a <button> arm and an <a> arm');
  assert.ok(button < anchor,
    'the arm taken when href is null must be the <button>; the <a> must be the '
    + 'other one. As written, a section with no href would render as a link');
});

test('aria-current="page" is written once, on the active section, and nowhere else', async () => {
  const { template } = await railSource();

  /* The template writes it ONCE, conditioned on `s.current`, and exactly one
     section can be current -- ids are unique (first test) and current is
     `s.id === active`. One literal, at most one match per render, exactly one
     section matching: that is what makes "exactly once in the output" true. */
  const written = [...template.matchAll(/aria-current/g)];
  assert.equal(written.length, 1,
    `aria-current is written ${written.length}x in the template -- it must appear `
    + 'exactly once, on the active section, or the page states more than one fact');

  const owner = template.match(/<(\w+)[^>]*aria-current[^>]*>/);
  assert.ok(owner, 'aria-current is not on an element open tag');
  assert.equal(owner[1], 'button',
    `aria-current sits on <${owner[1]}> -- it belongs on the button, because the `
    + 'section you are on is not somewhere you can navigate to');
  assert.match(owner[0], /aria-current=\{\s*s\.current\s*\?\s*'page'\s*:\s*undefined\s*\}/,
    'aria-current must read `page` only when the section IS the current one; '
    + 'anything unconditional claims every section is the page');
});

test('the rail is told the route and the pane SEPARATELY', async () => {
  /* THE DEFECT THIS PREVENTS, in full. The first rail took one prop, `active`, and
     the component's own header flagged what that cost: with `active="layers"` on
     the Explore route, Map still rendered as an <a> pointing at the URL the reader
     was already on. One prop cannot answer two questions -- WHICH PAGE IS THIS and
     WHICH SIDEBAR BODY IS SHOWING -- and the two genuinely differ the moment
     anyone opens a pane, which is most of the time.
     Both must be REQUIRED. An optional `pane` would let a caller pass only the
     route, and the rail would then paint nothing as open while a pane was showing:
     the same conflation with a default hiding it. */
  const { frontmatter } = await railSource();
  const props = frontmatter.match(/interface Props \{([\s\S]*?)\n\}/);
  assert.ok(props, 'IconRail.astro declares no `interface Props { ... }`');

  assert.match(props[1], /\broute:\s*RailSection\b/,
    'the rail must take `route` -- the section the PAGE is, which is the only '
    + 'thing that may decide whether a section is a link');
  assert.match(props[1], /\bpane:\s*RailSection\b/,
    'the rail must take `pane` -- the sidebar body showing right now. Without it '
    + 'the rail cannot state which pane is open except by pretending it is the '
    + 'route, which is exactly the conflation this split removes');
  assert.doesNotMatch(props[1], /\bactive\s*[?:]/,
    'the rail still takes an `active` prop -- one name for two questions is what '
    + 'put a self-link back on the page');
});

test('a pane section says whether its pane is open; a section with no pane does not', async () => {
  /* TWO FACTS, STATED SEPARATELY, because they are separate. `aria-current="page"`
     is about the DOCUMENT; `aria-pressed` is about the SIDEBAR. Analysis navigates
     and owns no sidebar body, so it must carry no aria-pressed at all --
     `aria-pressed="false"` announces a toggle that happens to be off, which is a
     different and wrong claim. The shell script also reads the attribute's
     PRESENCE to learn which sections have panes, so an unconditional one would
     wire a pane swap to a section with nothing to swap to. */
  const { frontmatter, template } = await railSource();
  const table = sectionTable(frontmatter);
  const pane = new Map(table.map((s) => [s.id, s.pane]));

  for (const id of ['map', 'layers', 'reports', 'scenarios']) {
    assert.equal(pane.get(id), true, `${id} owns a sidebar body and must declare pane: true`);
  }
  assert.equal(pane.get('analysis'), false,
    'Analysis navigates to another page and owns no sidebar body -- declaring '
    + 'pane: true would give it an aria-pressed it can never honour, and would '
    + 'wire a pane swap to a body that does not exist');

  /* MAP DECLARES BOTH, and it is the entry that proves the two fields are not one
     field written twice: it navigates (href) AND owns a pane. */
  const href = new Map(table.map((s) => [s.id, s.href]));
  assert.equal(href.get('map'), 'explorePath');
  assert.equal(pane.get('map'), true);

  const written = [...template.matchAll(/aria-pressed/g)];
  assert.equal(written.length, 1,
    `aria-pressed is written ${written.length}x in the template -- it belongs on `
    + 'the button arm once, reading the value the derivation computed');
  const owner = template.match(/<(\w+)[^>]*aria-pressed[^>]*>/);
  assert.ok(owner, 'aria-pressed is not on an element open tag');
  assert.equal(owner[1], 'button',
    `aria-pressed sits on <${owner[1]}> -- a section that navigates is not a `
    + 'toggle, and only the button arm can be one');
  assert.match(owner[0], /aria-pressed=\{s\.pressed\}/,
    'aria-pressed must read the derived `s.pressed`, which is undefined for a '
    + 'section with no pane -- anything unconditional gives Analysis a toggle '
    + 'state it does not have');

  assert.match(flat(frontmatter), /pressed:\s*s\.pane\s*\?/,
    '`pressed` must be gated on whether the section OWNS a pane. Computed for '
    + 'every section it would render aria-pressed="false" on Analysis, which '
    + 'announces a toggle that is off rather than no toggle at all');
  assert.match(flat(frontmatter), /pressed:[^,]*s\.id === pane/,
    '`pressed` must compare against `pane` -- compared against `route` it would '
    + 'be a second spelling of aria-current and the sidebar state would be '
    + 'unstated');
});

test('the rail ships no control that does nothing', async () => {
  /* The first rail carried a settings button, inert, and said so in a comment: it
     was to be wired or removed. Nothing exists for it to open, so it is removed.
     A control that does nothing is the defect this project has deleted repeatedly
     -- a <button class="cta"> with no handler, a warming-pathway control over an
     empty table, a tab that reached a refusal in silence -- and shipping one on
     the console's only navigation would be the loudest instance of it yet. */
  const { template, css } = await railSource();
  assert.doesNotMatch(template, /rail-settings|Settings/,
    'the rail renders a settings control again -- there is still nothing for it '
    + 'to open, so it must be wired to something real or not rendered');
  assert.doesNotMatch(css, /rail-settings/,
    'the rail styles a settings control that is no longer rendered');

  /* EVERY CONTROL IN THE NAV IS ONE OF THREE THINGS: the brand link, a section
     link, or a section button. Counting them is what stops a fourth arriving with
     nothing behind it -- the check above only knows the name we happened to use. */
  const controls = [...template.matchAll(/<(button|a)\b/g)].map((m) => m[1]);
  assert.deepEqual(controls, ['a', 'button', 'a'],
    'the rail renders controls other than the brand link and the loop\'s two '
    + `arms: ${controls.join(', ')}`);
});

test('the console carries exactly one brand mark, and it is the rail\'s', async () => {
  /* COMPOSED, THE TWO WERE EIGHT PIXELS APART. The rail has a mark at the top; the
     stage's top bar had a logo link home directly to its right. Both went to `/`.
     One of them had to go, and the rail's is the one that stays: the rail is the
     navigation, so the way out of the console belongs in it.
     BOTH HALVES ARE READ, and the second is the one that matters -- a check that
     only confirmed the rail has a mark would have passed just as happily with the
     stage's still there. */
  const { template } = await railSource();
  assert.match(template, /<a class="mark" href="\/"/,
    'the rail no longer carries the brand mark as a link home -- it is the only '
    + 'navigation on the page, so it is where the way out belongs');
  assert.match(template, /aria-label="[^"]+"/,
    'the brand link announces nothing -- two letters in a <span aria-hidden> is a '
    + 'mark, not an accessible name');

  const stage = await stageSource();
  assert.doesNotMatch(stage, /class="brand"/,
    'HeatMapStage.astro renders a brand link again -- composed with the rail\'s '
    + 'mark that is two brands on one page, both going to the same place');
  assert.doesNotMatch(stage, /logo-mark/,
    'HeatMapStage.astro still loads the logo mark -- the top bar is the '
    + 'breadcrumb and the readout now, and nothing else');
});

test('every section carries data-rail, which is how Task 7 will find it', async () => {
  const { template } = await railSource();
  const arms = [...loopArms(template).matchAll(/<(button|a)\b([^>]*)>/g)];
  assert.equal(arms.length, 2,
    `the section loop renders ${arms.length} element arms, expected 2 (a button `
    + 'and an anchor) -- with a different shape the check below proves nothing');
  for (const [, tag, attrs] of arms) {
    assert.match(attrs, /\sdata-rail=\{s\.id\}/,
      `the <${tag}> arm carries no data-rail={s.id} -- Task 7's script finds the `
      + 'sections by that attribute, and a section without it is unreachable');
  }
});

test('every section announces a text label, not just an icon', async () => {
  /* An icon announces nothing. `title` is not a reliable accessible name -- it is
     ignored outright by some screen readers and never surfaces on touch -- so the
     name is a real text node, visually hidden until hover or keyboard focus. It
     is ONE span doing both jobs rather than a hidden label beside a separate
     tooltip, because two copies of the same word are two copies free to drift. */
  const { frontmatter, template, css } = await railSource();

  for (const s of sectionTable(frontmatter)) {
    assert.ok(s.label.trim().length > 0, `section "${s.id}" declares no label`);
  }

  const labels = [...loopArms(template).matchAll(
    /<span class="rail-label">\{s\.label\}<\/span>/g)];
  assert.equal(labels.length, 2,
    `${labels.length} of the 2 section arms render a text label -- an icon on its `
    + 'own announces nothing to a screen reader');

  assert.match(css, /\.rail-label\s*\{[^}]*opacity:\s*0/,
    'the label must be VISUALLY hidden by default -- if it is not, the rail is no '
    + 'longer an icon rail');

  assert.ok(!/\stitle=/.test(template),
    'a rail control uses title= for its name -- title is not a reliable '
    + 'accessible name, and the visually-hidden span already is one');
});

test('the rail scopes its styles rather than going global', async () => {
  /* The stage's block is is:global for a real reason: MapLibre injects its own
     DOM and heat-map-app.ts re-classes elements at runtime, and Astro's scoping
     hash only reaches markup Astro rendered. The rail is entirely Astro-rendered
     and static, so the hash reaches all of it and the global surface SHRINKS
     rather than grows. */
  const { styles } = await railSource();
  assert.ok(styles.length > 0, 'IconRail.astro has no <style> block at all');
  for (const [, attrs] of styles) {
    assert.ok(!/is:global/.test(attrs),
      'IconRail.astro uses <style is:global> -- its markup is entirely '
      + 'Astro-rendered and static, so the scoping hash reaches it and the style '
      + 'has no reason to leak');
  }
});

test('the rail is usable by keyboard and honours reduced motion', async () => {
  const { css } = await railSource();
  assert.match(css, /:focus-visible/,
    'the rail has no :focus-visible rule -- a rail you cannot see focus on is '
    + 'unusable by keyboard, and it is the only navigation there is');
  assert.match(css, /@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/,
    'the rail animates colour, background and its label with no '
    + 'prefers-reduced-motion escape');
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

test('each level is a native <select>, tagged with the data-scope Task 7 finds it by', async () => {
  /* WHY A NATIVE SELECT AND NOT THE MOCKUP'S CUSTOM LISTBOX. Keyboard, screen
     reader and mobile behaviour arrive for free; `disabled` on an <option> is
     exactly how an area that ships no data should present; and a custom listbox
     without roving tabindex and arrow-key handling would be a WORSE control than
     the one it replaces. The styled listbox can come later without changing any
     of the data flow below.

     THE COUNTING ARGUMENT. The template renders ONE <select>, inside the FIELDS
     loop, so the number in the output is the number of FIELDS rows -- three, from
     the test above -- and each carries data-scope={f.id}, so the three tags are
     `country`, `city` and `area`. That is what makes a source assertion here
     imply the output claim. */
  const { template } = await switcherSource();

  const selects = [...template.matchAll(/<select\b([^>]*)>/g)];
  assert.equal(selects.length, 1,
    `the template writes <select> ${selects.length}x -- it must be written ONCE, `
    + 'inside the FIELDS loop, or the count in the output stops being the count '
    + 'of levels and this test no longer implies three selects');

  assert.match(selects[0][1], /\sdata-scope=\{f\.id\}/,
    'the <select> carries no data-scope={f.id} -- Task 7 finds the three controls '
    + 'by that attribute, and one without it is unreachable from the script');

  const loop = template.indexOf('FIELDS.map(');
  assert.ok(loop !== -1 && loop < template.indexOf('<select'),
    'the <select> is not inside a `FIELDS.map(` loop -- outside it there is one '
    + 'select in the output however many levels are declared');

  assert.ok(!/role="(listbox|combobox|option)"/.test(template),
    'the switcher hand-rolls listbox roles -- the native select already has them, '
    + 'and a role without roving tabindex and arrow keys is a worse control');
});

test('every select announces a text label, and it is visually hidden', async () => {
  /* A BARE SELECT ANNOUNCES ONLY ITS VALUE. "India" with no name attached is not
     a control anyone can use by ear. The mockup's uppercase caption is a
     decorative span sitting inside the card, so the accessible name is a real
     <label for>, hidden from the eye and present in the tree -- and BOTH strings
     come from the one `f.label`, so the two cannot drift apart. */
  const { frontmatter, template, css } = await switcherSource();

  for (const f of fieldTable(frontmatter)) {
    assert.ok(f.label.trim().length > 0, `level "${f.id}" declares no label`);
  }

  const labels = [...template.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)];
  assert.equal(labels.length, 1,
    `the template writes <label> ${labels.length}x -- exactly one, inside the `
    + 'FIELDS loop, gives exactly one label per select');

  const [, labelAttrs, labelText] = labels[0];
  assert.ok(flat(labelText).includes('{f.label}'),
    `the label's text is \`${flat(labelText)}\` -- it must be {f.label}, the same `
    + 'string the visible caption shows, or the two spellings can drift');

  const forExpr = labelAttrs.match(/\sfor=(\{[^}]*\}|"[^"]*")/);
  assert.ok(forExpr, 'the <label> carries no for= -- an unassociated label names '
    + 'nothing, and the select still announces only its value');
  const selectAttrs = [...template.matchAll(/<select\b([^>]*)>/g)][0][1];
  const idExpr = selectAttrs.match(/\sid=(\{[^}]*\}|"[^"]*")/);
  assert.ok(idExpr, 'the <select> carries no id= for the label to point at');
  assert.equal(flat(forExpr[1]), flat(idExpr[1]),
    `the label points at ${flat(forExpr[1])} and the select is ${flat(idExpr[1])} -- `
    + 'two different expressions cannot be relied on to produce one id, and a '
    + 'for= that misses leaves the select unnamed');

  const cls = labelAttrs.match(/\sclass="([^"]+)"/);
  assert.ok(cls, 'the <label> carries no class -- the rule that hides it cannot be found');
  const hidden = ruleBody(css, `.${cls[1].trim().split(/\s+/)[0]}`);
  assert.match(hidden, /clip-path|clip:/,
    'the label class does not clip the label out of view -- the founder tuned the '
    + 'card to show the caption, not a second copy of the word beside it');
  assert.ok(!/display:\s*none|visibility:\s*hidden/.test(hidden),
    'the label is hidden with display:none or visibility:hidden, which takes the '
    + 'accessible name away with the pixels -- clip it instead');

  assert.match(template, /<span[^>]*class="[^"]*scope-key[^"]*"[^>]*aria-hidden="true"/,
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

  const option = template.match(/<option\b([^>]*)>/);
  assert.ok(option, 'the template renders no <option>');
  assert.match(option[1], /\sdisabled=\{o\.disabled\}/,
    'the <option> does not bind disabled={o.disabled} -- the derivation above '
    + 'would then be computed and thrown away, and every option would render '
    + 'selectable');

  /* AND THE REASON IS VISIBLE. A greyed row with no explanation reads as a bug. */
  const noteDecl = frontmatter.match(/const\s+NO_DATA_NOTE\s*=\s*'([^']*)'/);
  assert.ok(noteDecl, 'no NO_DATA_NOTE is declared -- a disabled option with no '
    + 'stated reason is mysterious rather than honest');
  assert.ok(noteDecl[1].trim().length > 0, 'NO_DATA_NOTE is the empty string');
  assert.ok(flat(frontmatter).includes('NO_DATA_NOTE}'),
    'NO_DATA_NOTE is declared and never interpolated into the option text -- the '
    + 'reason would exist in the source and nowhere in the output');
});

test('the tier badge is the RESOLVED tier, and the three tiers take three classes', async () => {
  const tiers = await declaredTiers();
  const { frontmatter, template, css } = await switcherSource();

  /* The badge belongs to the CITY, because the tier is a city fact: the gap
     between Kolkata's `validated` and Dubai's `geometry` IS the funding ask. */
  const tierExpr = new Map(fieldTable(frontmatter).map((f) => [f.id, f.tier]));
  assert.equal(tierExpr.get('city'), 'scope.tier',
    'the City level must take its tier from the resolved scope (`tier: scope.tier`) '
    + `-- it declares \`${tierExpr.get('city')}\`, and a literal would state a `
    + 'confidence the registry never claimed');
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

test('the switcher is usable by keyboard and honours reduced motion', async () => {
  const { css } = await switcherSource();
  assert.match(css, /:focus-visible|:focus-within/,
    'the switcher has no focus rule -- a select whose focus cannot be seen is '
    + 'unusable by keyboard, and this is the control the whole console is scoped by');
  assert.match(css, /@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/,
    'the switcher transitions its cards with no prefers-reduced-motion escape');
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
const STAGE = new URL(
  '../../src/components/ClimateEngine/HeatMapStage.astro', import.meta.url);

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
  const { bare } = twoAreas();
  registryGroups();

  const blocked = LAYER_IDS.filter((id) => !layerAvailability(id, bare, CAPS_ON).available);
  const drawable = LAYER_IDS.filter((id) => layerAvailability(id, bare, CAPS_ON).available);
  assert.ok(blocked.length > 0,
    `every layer is available at "${bare}" -- there is then nothing for `
    + '`disabled` to be true about, and this test would pass while proving nothing');
  assert.ok(drawable.length > 0,
    `no layer is available at "${bare}" -- \`disabled\` would be indistinguishable `
    + 'from "always off", and the test would again prove nothing');

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
  const { frontmatter, template } = await treeSource();
  const dots = dotTable(frontmatter);

  assert.deepEqual([...dots.keys()].sort(), [...LAYER_IDS].sort(),
    'the DOT table does not cover exactly the registered layers -- a missing '
    + 'entry renders a colourless dot, and a stale one names a layer that is gone');
  assert.match(frontmatter, /const\s+DOT\s*:\s*Record<LayerId,\s*string>/,
    'DOT is not typed `Record<LayerId, string>` -- without it a new layer would '
    + 'compile clean here and render an undefined dot colour');

  let stage;
  try {
    stage = await readFile(STAGE, 'utf8');
  } catch (err) {
    assert.fail(`HeatMapStage.astro could not be read (${err.code ?? err.message}) `
      + '-- the palette is declared there, and a missing file must fail rather '
      + 'than let every token check below pass vacuously');
  }
  const declared = new Set(
    [...stage.matchAll(/(--[a-z0-9-]+)\s*:\s*#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[1]));
  assert.ok(declared.size > 0,
    'no colour token was found in HeatMapStage.astro -- the loop below would '
    + 'then accept every dot, including one naming a token nobody declares');

  const seen = new Set();
  for (const [id, token] of dots) {
    assert.match(token, /^--[a-z][a-z0-9-]*$/,
      `the dot for ${id} is \`${token}\` -- it must be a token NAME, so the colour `
      + 'has exactly one spelling in the codebase');
    assert.ok(declared.has(token),
      `the dot for ${id} names \`${token}\`, which HeatMapStage.astro declares `
      + 'nowhere -- var() would resolve to nothing and the dot would be invisible');
    seen.add(token);
  }
  assert.equal(seen.size, dots.size,
    'two layers share a dot colour ('
    + [...dots].map(([i, t]) => `${i}=${t}`).join(', ')
    + ') -- the dot is how a row is told from its neighbour at a glance');

  assert.match(flat(template), /style=\{`background: var\(\$\{row\.dot\}\)`\}/,
    'the dot is not painted with var(${row.dot}) -- a per-layer literal in the '
    + 'template is a second place the palette has to be kept up to date');
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

async function stageSource() {
  let src;
  try {
    src = await readFile(STAGE, 'utf8');
  } catch (err) {
    assert.fail(
      `HeatMapStage.astro could not be read (${err.code ?? err.message}) -- a `
      + 'file that is not there holds no duplicate id, so its absence must '
      + 'fail rather than read as a clean move');
  }
  assert.ok(src.trim().length > 0,
    'HeatMapStage.astro is EMPTY -- it would then be free of duplicate ids in '
    + 'the least useful way available');
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

test('the stage kept none of those ids, so none is in the DOM twice', async () => {
  const ids = paneIds();
  const stage = await stageSource();

  /* THE MOUNT, FIRST. Without it, "the stage holds none of the seventeen" is
     satisfied perfectly by a stage that deleted the toolbox and never rendered
     it anywhere -- a green suite over a page with no toolbox on it. */
  /* `assert.ok(regex.test(...))` rather than `assert.match(stage, ...)`: the
     latter prints the ENTIRE 1,000-line stage as its `actual`, which buries the
     one sentence explaining what went wrong. A tripwire is read exactly once,
     at the moment it fires, so it has to be legible then. */
  /* EXACTLY ONE MOUNT, not at least one -- and this half was MEASURED, not
     imagined. Composing the console left the old `<InterventionPane />` standing
     where it used to float over the map while adding a second one in the sidebar
     pane, and the built page carried two toolboxes and seventeen duplicated ids.
     Everything below passed: the stage writes no `id=` of its own, so "none is in
     the DOM twice" was satisfied while every one of them was. The check that
     matters is on the MOUNT, because that is what puts the ids in the document. */
  const mounts = (stage.match(/<InterventionPane\b/g) ?? []).length;
  assert.equal(mounts, 1,
    mounts === 0
      ? 'HeatMapStage.astro never renders <InterventionPane ... /> -- the markup '
        + 'was removed and nothing put it back, so the toolbox is GONE from the '
        + 'page rather than moved off it'
      : `HeatMapStage.astro renders <InterventionPane /> ${mounts} times -- each `
        + 'mount emits all seventeen ids, so the built page holds each of them '
        + 'that many times. getElementById returns whichever the parser reached '
        + 'first, and every control in the copies below it is dead');

  const leftBehind = ids.filter((id) => idAttr(id).test(stage));
  assert.deepEqual(leftBehind, [],
    `HeatMapStage.astro still writes id= for: ${leftBehind.join(', ')} -- the `
    + 'pane now renders those same ids, so each one is a DUPLICATE id in the '
    + 'built DOM. That is invalid HTML, and getElementById returns whichever '
    + 'element the parser reached first -- the stage copy, which is the one no '
    + 'longer connected to anything');

  /* The old container went with them. `<aside class="panel left">` was the
     toolbox's own element, so a stage still opening one is a stage that
     deleted the contents and kept the frame. */
  assert.ok(!/<aside\s+class="panel left"/.test(stage),
    'HeatMapStage.astro still opens <aside class="panel left"> -- the pane '
    + 'took that element with it, so this is an empty duplicate frame');
});

test('each shell component is mounted exactly once', async () => {
  /* THE GENERAL FORM OF THE DEFECT ABOVE. The toolbox was the one caught, because
     its seventeen ids are queried by name and a duplicate id is unambiguously
     wrong. The other three are quieter and no better: two layer trees means two
     checkboxes per layer, and the tree's CSS counter would then count the rows of
     whichever group it was reset in while the visitor clicked the other; two scope
     switchers means two Area selects, only one of which the reader can see move.
     None of that throws, and none of it looks wrong in the source -- the second
     mount is one line, forty lines away from the first. */
  const stage = await stageSource();
  for (const name of ['IconRail', 'ScopeSwitcher', 'LayerTree', 'InterventionPane']) {
    const n = (stage.match(new RegExp(`<${name}\\b`, 'g')) ?? []).length;
    assert.equal(n, 1,
      `HeatMapStage.astro mounts <${name} /> ${n} times -- the console composes `
      + 'each of the four exactly once, and a second mount duplicates every '
      + 'control inside it');
    assert.match(stage, new RegExp(`import ${name} from '\\./shell/${name}\\.astro'`),
      `HeatMapStage.astro renders <${name} /> without importing it from `
      + 'shell/ -- an Astro component that is not imported renders as an unknown '
      + 'HTML element, silently and with no styles');
  }
});
