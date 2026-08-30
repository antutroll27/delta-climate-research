import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

/** The declared sections, as `{ id, label, href, body }`. Never an empty list. */
function sectionTable(frontmatter) {
  const block = frontmatter.match(/const\s+SECTIONS[^=]*=\s*\[([\s\S]*?)\n\s*\];/);
  assert.ok(block, 'IconRail.astro declares no `const SECTIONS = [ ... ];` -- the '
    + 'sections are read from that table, and a table that cannot be found must '
    + 'fail rather than yield an empty list that nothing then checks');

  const entries = [...block[1].matchAll(
    /\{\s*id:\s*'([a-z]+)'\s*,\s*label:\s*'([^']+)'\s*,\s*href:\s*([^,]+),\s*body:\s*'(always|own-route)'\s*,/g)]
    .map(([, id, label, href, body]) => ({ id, label, href: href.trim(), body }));

  assert.ok(entries.length > 0, 'the SECTIONS table parsed to ZERO entries -- '
    + 'either the table is empty or its fields are no longer `id`, `label`, '
    + '`href`, `body` in that order; both must fail, because every loop below '
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
     is about the DOCUMENT; `aria-pressed` is about the SIDEBAR. A section whose
     pane does not exist on THIS route must carry no aria-pressed at all --
     `aria-pressed="false"` announces a toggle that happens to be off, which is a
     different and wrong claim. The shell script also reads the attribute's
     PRESENCE to learn which sections have panes, so an unconditional one would
     wire a pane swap to a section with nothing to swap to.

     WHERE A PANE EXISTS IS A PROPERTY OF THE ROUTE, NOT OF THE SECTION, and that
     is what `body` records. Layers, Reports and Scenarios are answers about
     wherever you are standing, so their bodies are rendered on BOTH routes.
     Map's body is the toolbox and Analysis's body is the paired bench: each is
     rendered only on the route it belongs to, and each is a plain link from the
     other. The first version of this table carried a boolean, which could not
     say that -- `analysis: pane false` was true of the Explore route and false
     of the Compare route, and it was read on both. */
  const { frontmatter, template } = await railSource();
  const table = sectionTable(frontmatter);
  const body = new Map(table.map((s) => [s.id, s.body]));

  for (const id of ['layers', 'reports', 'scenarios']) {
    assert.equal(body.get(id), 'always',
      `${id} navigates nowhere, so its pane is rendered on every route the rail `
      + "appears on -- declaring 'own-route' would blank it on all of them, "
      + 'because no route IS Layers, Reports or Scenarios');
  }
  for (const id of ['map', 'analysis']) {
    assert.equal(body.get(id), 'own-route',
      `${id} is a ROUTE as well as a section, and its pane is rendered only on `
      + "that route -- declaring 'always' would give it an aria-pressed on the "
      + 'other page, where the body it names is not in the document at all');
  }

  /* THE TWO FIELDS ARE NOT ONE FIELD WRITTEN TWICE, and Map is still the entry
     that proves it: it navigates (href) AND owns a pane. The discriminator has
     moved -- Analysis used to be the counter-example by declaring `pane: false`,
     and now the two fields vary independently along a different axis: Layers has
     no href and a body everywhere, Map has an href and a body in one place. */
  const href = new Map(table.map((s) => [s.id, s.href]));
  assert.equal(href.get('map'), 'explorePath');
  assert.equal(body.get('map'), 'own-route');
  assert.equal(href.get('layers'), 'null');
  assert.equal(body.get('layers'), 'always');

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

  /* THE PREDICATE, AND THAT IT READS THE ROUTE. A gate written against `s.body`
     alone cannot distinguish Analysis-on-Compare (a real pane) from
     Analysis-on-Explore (a link to another page), so it would put an
     aria-pressed on a section whose body is not in the document -- which is
     exactly the dead toggle this rewrite exists to remove. */
  assert.match(flat(frontmatter), /const ownsPane = \(s[^)]*\)[^;]*s\.id === route/,
    '`ownsPane` must decide against `route` -- a pane whose body is rendered '
    + "only on its own route ('own-route') exists here only when this page IS "
    + 'that route, and nothing else in the derivation knows which page this is');
  assert.match(flat(frontmatter), /pressed:\s*ownsPane\(s\)\s*\?/,
    '`pressed` must be gated on `ownsPane(s)`. Computed for every section it '
    + 'would render aria-pressed="false" on a section whose body this route does '
    + 'not render -- announcing a toggle that is off rather than no toggle at '
    + 'all, and wiring a pane swap to a body that does not exist');
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

  /* EVERY CONTROL IN THE NAV IS ONE OF FOUR THINGS: the brand link, the collapse
     chevron, a section link, a section button. Counting them is what stops a
     fifth arriving with nothing behind it -- the check above only knows the name
     we happened to use.

     THE CHEVRON IS THE FOURTH, and it is the one this test has to be most careful
     about, because "expand the labels" is exactly the kind of control that can
     ship looking wired and do nothing. So the list is widened by one AND the
     handler is read out of console-shell.ts below: the count alone would have
     been satisfied by a button with no listener at all. */
  const controls = [...template.matchAll(/<(button|a)\b/g)].map((m) => m[1]);
  assert.deepEqual(controls, ['a', 'button', 'button', 'a'],
    'the rail renders controls other than the brand link, the collapse chevron '
    + `and the loop's two arms: ${controls.join(', ')}`);

  assert.match(template, /<button[^>]*\sdata-rail-toggle/,
    'the collapse chevron carries no data-rail-toggle -- console-shell.ts finds '
    + 'it by that attribute, so without it the button renders and does nothing');

  const shell = strip(await readFile(
    new URL('../../src/scripts/climate-engine/shell/console-shell.ts', import.meta.url),
    'utf8'));
  assert.ok(shell.length > 0, 'console-shell.ts read back empty');
  assert.match(shell, /querySelector<HTMLButtonElement>\('button\[data-rail-toggle\]'\)/,
    'console-shell.ts never looks for the collapse chevron');
  assert.match(shell, /on\(railToggle, 'click'/,
    'console-shell.ts finds the collapse chevron and binds no click handler to '
    + 'it -- the rail would render a chevron that cannot collapse anything');
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
  /* THE WIDTH IS THE ONE THAT MATTERS NOW. Colour and opacity transitions are a
     preference; a 114px column sliding out from under the page is motion in the
     sense the setting is actually about. */
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.rail,/,
    'the reduced-motion block no longer names .rail, so the column still '
    + 'animates its width for a reader who asked for no motion');
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE CONTRAST FLOOR — computed, never quoted.

   THE RAIL'S GLYPHS BECAME WORDS, and that changes which rule applies to their
   colour. WCAG's 3:1 is for a graphical object; text is 4.5:1, and the resting
   ink the rail shipped with -- --faint on --rail-ground -- is 3.27:1. It was
   legal for five icons and became illegal the moment each icon had a word beside
   it, which is why the contrast fix is part of the labels rather than a tidy-up
   filed after them.

   EVERY NUMBER BELOW IS ARITHMETIC ON THE DECLARED VALUES. Not one ratio is
   written down anywhere in this file: changing either the ink or the ground
   re-runs the sum, which is the only version of this test that cannot go stale
   while still passing. The first draft asserted `ratio === 6.9` and would have
   had to be edited -- by hand, to a number someone worked out separately -- every
   time either colour moved.
   ═══════════════════════════════════════════════════════════════════════════ */

/** WCAG 2.x relative luminance. Nothing here is project-specific. */
function luminance(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio, 1 to 21. */
function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Every `--token:#hex` in a source file, lowercased. Never an empty map. */
function hexTokens(src, where) {
  const found = new Map();
  for (const m of src.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\b/g)) {
    found.set(m[1], m[2].toLowerCase());
  }
  assert.ok(found.size > 0,
    `${where} declares no --token:#hex at all -- every ratio below would be `
    + 'computed from undefined, and undefined compares against nothing');
  return found;
}

/** The declared value of one token, or a failure naming which file lacked it. */
function tokenValue(tokens, name, where) {
  const value = tokens.get(name);
  assert.ok(value,
    `${where} declares no ${name}. The contrast floor below is computed from it, `
    + 'so its absence must fail rather than be compared against undefined');
  return value;
}

test('the contrast maths this suite judges by is itself correct', () => {
  /* GUARD THE GUARD, and this one is the guard for three tests. A luminance
     function with a transposed coefficient or a missing gamma step returns
     plausible numbers for every pair it is handed, so the assertions that use it
     would go on passing over colours nobody can read.

     THE FIRST DRAFT OF THIS TEST WAS THE DEAD GUARD IT EXISTS TO PREVENT, and it
     was caught by sabotage rather than by reading. It checked white on black, a
     grey on itself, and a mid grey on white — every one of them a NEUTRAL, where
     R, G and B are equal and the three coefficients are interchangeable. Swapping
     the red and green weights, which is the single likeliest way this function
     goes wrong, changed none of those three numbers and the test stayed green.

     So the three primaries are here, and they are what make the coefficients
     observable: green is by far the brightest of the three and blue by far the
     darkest, and no transposition survives all three. */
  assert.equal(Math.round(ratio('#ffffff', '#000000')), 21);
  assert.equal(Math.round(ratio('#000000', '#ffffff')), 21);   // symmetric
  assert.equal(ratio('#777777', '#777777'), 1);
  /* Mid grey on white is the canonical worked example: 4.48:1, the famous
     near-miss of the 4.5 floor. It pins the gamma step. */
  assert.equal(Number(ratio('#777777', '#ffffff').toFixed(2)), 4.48);
  /* And these pin the three weights, each against white. */
  assert.equal(Number(ratio('#ff0000', '#ffffff').toFixed(2)), 4.00);
  assert.equal(Number(ratio('#00ff00', '#ffffff').toFixed(2)), 1.37);
  assert.equal(Number(ratio('#0000ff', '#ffffff').toFixed(2)), 8.59);
});

test("the rail's resting ink clears the 4.5:1 text floor on the ground it sits on", async () => {
  const { css: railCss } = await railSource();
  const stage = await stageSource();

  const palette0 = hexTokens(stage, 'HeatMapStage.astro');
  const ink = tokenValue(palette0, '--ink', 'HeatMapStage.astro');
  const ground = tokenValue(hexTokens(stage, 'HeatMapStage.astro'), '--rail-ground',
    'HeatMapStage.astro');

  /* THE RAIL HAS NO INK OF ITS OWN, AND THAT IS THE POINT OF THIS PAIR.
     --rail-ink existed only because --faint could not clear 4.5:1 on this ground.
     Raising --faint removed the reason; leaving the token behind would have left
     two names for one job, with the unused one free to drift. So the absence is
     asserted here rather than trusted to memory. */
  assert.doesNotMatch(railCss, /--rail-ink\s*:/,
    'the rail declares --rail-ink again. It was merged into --ink when --faint '
    + 'was raised to clear this ground; a second ink token here means the rail '
    + 'and the console can disagree about what a resting label looks like');

  /* AND THE TOKEN MEASURED HAS TO BE THE ONE THE RAIL ACTUALLY PAINTS WITH.
     Without this the test scores a declaration nothing reads. */
  assert.match(railCss, /\.rail-btn\s*\{[^}]*color:\s*var\(--ink\)/,
    'the rail sections are not painted with --ink, so the ratio computed '
    + 'here is about a token nothing uses');
  assert.match(railCss, /\.rail-toggle\s*\{[^}]*color:\s*var\(--ink\)/,
    'the collapse chevron is not painted with --ink');

  const rest = ratio(ink, ground);
  assert.ok(rest >= 4.5,
    `the rail's resting ink ${ink} on ${ground} is ${rest.toFixed(2)}:1, below the `
    + '4.5:1 floor for text. It was legal while the rail held nothing but icons; '
    + 'a label is text, and this is the ratio a reader has to make a word out of');

  /* AND EVERY OTHER STATE, because the resting one is only the dimmest. Each of
     these paints a whole row -- icon and word together -- so each is text. */
  const palette = hexTokens(stage, 'HeatMapStage.astro');
  for (const [token, what] of [
    ['--paper', 'hover and the current route'],
    ['--cyan', 'the open pane'],
  ]) {
    const colour = tokenValue(palette, token, 'HeatMapStage.astro');
    assert.match(railCss, new RegExp(`color:\\s*var\\(${token}\\)`),
      `the rail never paints anything ${token} -- this row is measuring a colour `
      + 'the component does not use');
    const r = ratio(colour, ground);
    assert.ok(r >= 4.5,
      `the rail's ink for ${what} (${token}, ${colour}) on ${ground} is `
      + `${r.toFixed(2)}:1, below the 4.5:1 text floor`);
  }

  /* --faint CLEARS THIS GROUND TOO NOW, and it is still not what the rail should
     use. The two facts are separate and both matter: the first is why --rail-ink
     could be deleted, the second is why the rail did not simply inherit --faint
     in its place. These are primary navigation labels; --faint is the console's
     THIRD ink tier, for units, scale numbers and credits. Legibility was never
     the whole argument for the rail's colour — hierarchy was. */
  const faint = tokenValue(palette, '--faint', 'HeatMapStage.astro');
  assert.ok(ratio(faint, ground) >= 4.5,
    `--faint (${faint}) reads ${ratio(faint, ground).toFixed(2)}:1 on the rail `
    + 'ground, below the 4.5:1 floor. Every ink on this console has to clear it '
    + 'on every ground it is painted on, and this is the darkest pairing there is');
  assert.doesNotMatch(railCss, /color:\s*var\(--faint\)/,
    'the rail paints something in --faint. It clears the contrast floor, but it '
    + 'is the tier below the one navigation belongs in -- a section name would '
    + 'read as dimmer than the card headings it leads to');
});

test("the console's two grounds are the same colour on both routes", async () => {
  /* TWO FILES, ONE COLOUR, AND THE CENSUS CANNOT SEE THE DRIFT. HeatMapStage.astro
     declares the console's palette; PairedBench.astro re-declares the two grounds
     because the compare route never loads that stylesheet and an undefined custom
     property does not fall back -- it invalidates the whole declaration.

     `no stylesheet writes a colour more than once` in obos-layers.test.mjs was
     credited in a comment with watching this. It is a PER-FILE census: it counts
     spellings inside one file and has no opinion about a second. Two files each
     writing their own value once is exactly the shape it waves through, so the
     rail could go violet on Explore and stay warm-neutral on Compare with every
     test in this repository green. That comment has been corrected and this is
     the guard it now points at.

     THE CONTRAST TEST ABOVE NEEDS THIS TOO. It computes against the ground
     HeatMapStage declares; without this, that number would be true of one route
     and unmeasured on the other. */
  const stage = hexTokens(await stageSource(), 'HeatMapStage.astro');
  const { src: benchSrc } = await benchSource();
  const bench = hexTokens(benchSrc, 'PairedBench.astro');

  /* ONLY --rail-ground CARRIES A VALUE NOW. `--panel-ground` became
     `var(--rail-ground)` when the two panels were unified, so it has no hex of its
     own on either route and cannot drift from one: whatever this check pins, the
     panel inherits on both. Asking `hexTokens` for it would fail on a declaration
     that is correct.

     THE PROPERTY IS NOT WEAKER, IT MOVED. That the panel POINTS at the rail rather
     than restating it is asserted in `the two panels are ONE colour, and the shape
     is what separates them`, for both files. Together: one value, checked equal
     across routes, and two references to it, checked present on each. */
  const token = '--rail-ground';
  const here = tokenValue(stage, token, 'HeatMapStage.astro');
  const there = tokenValue(bench, token, 'PairedBench.astro');
  assert.equal(there, here,
    `${token} is ${here} on the explore route and ${there} on compare. It is `
    + 'the same surface of the same console; a reader crossing between the two '
    + 'watches it change colour — and since --panel-ground now points at this '
    + 'token, a drift here moves both panels on one route only');
});

test('the two panels are ONE colour, and the shape is what separates them', async () => {
  /* THE FOUNDER MOVED THE CONSOLE TO A FLOATING PAIR: rail and sidebar sharing one
     ground, held apart by a gap and drawn with rounded corners — the treatment
     PairedBench's sidebar already had.

     THIS TEST USED TO ASSERT THE OPPOSITE and it was right to, for the design it
     was written for: same hue, DIFFERENT lightness, because two abutting columns
     separated by a single border need a tonal step or they merge. That premise is
     gone. The columns no longer abut, so lightness is no longer carrying the
     boundary — and a test still demanding a step would now be enforcing a
     difference the design deliberately removed.

     WHAT CARRIES IT INSTEAD IS THE SHAPE, and that is what is asserted here. The
     page behind the gap is 1.06:1 from the panels: invisible. Take away the radius
     or the hairline and the two dissolve into each other and into the ground —
     silently, because every colour would still be correct. That is the new failure
     mode and it is the one worth a guard.

     ONE COLOUR MEANS ONE SPELLING. `--panel-ground` must POINT AT `--rail-ground`,
     not repeat its value: two hexes that happen to match today are two hexes that
     can stop matching, and the per-file colour census would wave the second one
     through as a legitimate second token. */
  const stageSrc = await stageSource();
  const { src: benchSrc } = await benchSource();

  for (const [name, src] of [['HeatMapStage.astro', stageSrc], ['PairedBench.astro', benchSrc]]) {
    assert.match(src, /--panel-ground:\s*var\(\s*--rail-ground\s*\)/,
      `${name} gives --panel-ground its own value instead of pointing at `
      + '--rail-ground. The two panels are one surface of one console and the '
      + 'founder asked for one colour; spelled twice, they are one retint away '
      + 'from being two');
  }

  /* THE HAIRLINE AND THE RADIUS, on both panels, because either alone is not the
     shape. A radius with no border is a rounded rectangle nobody can see against a
     ground it matches; a border with no radius is the abutting column again. */
  const { css: railCss } = await railSource();
  assert.match(railCss, /\.rail\s*\{[^}]*border:\s*1px solid var\(--line\)/,
    'the rail lost its full border. It shares a ground with the panel beside it '
    + 'and sits 1.06:1 from the page behind the gap — the hairline is the only '
    + 'thing drawing its edge');
  assert.match(railCss, /\.rail\s*\{[^}]*border-radius:/,
    'the rail lost its radius, which is half of what makes it read as a panel '
    + 'floating rather than a column butted against the next one');
  assert.match(stageSrc, /\.sidebar\{[^}]*border-radius:/,
    'the stage sidebar lost its radius while the rail kept one — the pair reads '
    + 'as two different kinds of surface');

  /* AND A GAP. Radius and hairline draw a panel; only the margin makes two of them
     read as separate objects rather than one rounded box with a line through it.
     The rail supplies the outer inset and the sidebar the space between — assert
     both have a margin at all, without pinning the number, so the spacing can be
     retuned without this test having an opinion about taste. */
  assert.match(railCss, /\.rail\s*\{[^}]*margin:/,
    'the rail sits flush against the viewport again — the inset is what makes it '
    + 'a panel floating on the page rather than a strip welded to its edge');
  assert.match(stageSrc, /\.sidebar\{[^}]*margin:/,
    'the stage sidebar lost its margin, so it butts against the rail and the map. '
    + 'Sharing a ground with the rail, that reads as one wide panel with a hairline '
    + 'through the middle rather than as two');

  /* THE PANEL'S OTHER EDGE, and the one that is easy to forget because it is
     INSIDE the sidebar rather than beside it: `.seg` in the intervention pane is
     drawn on --surface, on this ground. This edge is the reason the panel cannot
     simply be darkened towards the page until the gap reads — every step in that
     direction is a step away from --surface, and the control inside would be
     carried by its 1px border alone.

     RESOLVED THROUGH THE REFERENCE, not read as a literal: `--panel-ground` is now
     `var(--rail-ground)`, so its VALUE is whatever the rail's is. Reading the rail
     here is what makes this measure the colour that actually paints, rather than a
     second hex that agrees with it today. */
  const stage = hexTokens(stageSrc, 'HeatMapStage.astro');
  const panel = tokenValue(stage, '--rail-ground', 'HeatMapStage.astro');
  const surface = tokenValue(stage, '--surface', 'HeatMapStage.astro');
  const inner = ratio(panel, surface);
  assert.ok(inner > 1.07,
    `the sidebar's ground and --surface, which the segmented control inside it is `
    + `drawn on, are ${inner.toFixed(2)}:1 apart. They are in the same hue family, `
    + 'so there is nothing else left to tell them apart and the control is carried '
    + 'by its 1px border alone');
});

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

test('the pre-paint script and the module that writes the preference agree', async () => {
  /* THE ONE PLACE TWO SPELLINGS COULD HIDE. The inline script is a string: no
     compiler checks that its key is the key `writeRailCollapsed` writes, and a
     drift between them is silent -- the preference is stored where nothing reads
     it and the rail simply forgets, on every load, forever.

     SO THE SCRIPT IS BUILT FROM THE CONSTANTS, and this asserts that it was
     rather than that it happens to contain the right words today. */
  assert.ok(LAYOUT_PREPAINT.includes(JSON.stringify(RAIL_STATE_KEY)),
    'the pre-paint script does not read the key this module writes');
  assert.ok(LAYOUT_PREPAINT.includes(JSON.stringify(RAIL_STATE_ATTR)),
    'the pre-paint script does not set the attribute the stylesheet selects on');
  for (const value of [COLLAPSED, EXPANDED]) {
    assert.ok(LAYOUT_PREPAINT.includes(JSON.stringify(value)),
      `the pre-paint script never writes ${value}`);
  }
  assert.ok(LAYOUT_PREPAINT.includes(JSON.stringify(RAIL_TOGGLE_ID)),
    'the pre-paint script does not look the chevron up by the id the rail renders '
    + 'on it, so the state and name the server wrote stand until the shell mounts');
  assert.match(LAYOUT_PREPAINT, /try\s*\{/,
    'the pre-paint script touches localStorage outside a try. It runs BEFORE the '
    + 'page is painted and is not a module, so a SecurityError there is an '
    + 'uncaught exception on a blank console');

  /* AND THE RAIL EMBEDS IT. A script exported and never rendered is the whole
     mechanism absent, with every assertion above still green. */
  const { template } = await railSource();
  assert.match(template, /<script is:inline data-astro-rerun set:html=\{LAYOUT_PREPAINT\}/,
    'IconRail.astro does not embed LAYOUT_PREPAINT as an inline, re-runnable '
    + 'script. Deferred to the shell\'s module mount, a reader who collapsed the '
    + 'rail watches it collapse -- and animate -- on every page load; and after a '
    + 'ClientRouter swap, which copies the incoming document\'s <html> attributes '
    + 'over ours, nothing puts the attribute back before the swap is painted');
});

test('the chevron announces what it does, in one place, in both states', async () => {
  /* AN ICON-ONLY BUTTON WITH NO NAME is the regression this whole task exists to
     end; shipping one as the control that ends it would be the joke version of
     it. The name states the ACTION, aria-expanded states the state, and both
     change together.

     ONE AUTHOR FOR THE WORDS. The two names are rendered as data attributes and
     read back off the DOM by the pre-paint script and by the shell, because the
     alternative is the same two sentences in three files with only the invisible
     ones free to drift. */
  const { template } = await railSource();

  const toggle = template.match(/<button[\s\S]*?data-rail-toggle[\s\S]*?>/);
  assert.ok(toggle, 'the rail renders no chevron carrying data-rail-toggle');
  const attrs = toggle[0];

  assert.match(attrs, /aria-expanded="true"/,
    'the chevron carries no aria-expanded. It is a disclosure, and without it a '
    + 'screen reader is told only that there is a button');
  assert.match(attrs, /id=\{RAIL_TOGGLE_ID\}/,
    'the chevron does not carry the id the pre-paint script looks it up by, so '
    + 'the name and state it renders cannot be corrected before they are read');

  for (const which of ['expanded', 'collapsed']) {
    const named = attrs.match(new RegExp(`data-label-${which}=\\{TOGGLE_LABEL\\.${which}\\}`));
    assert.ok(named, `the chevron renders no data-label-${which} from TOGGLE_LABEL`);
  }
  assert.match(attrs, /aria-label=\{TOGGLE_LABEL\.expanded\}/,
    'the chevron\'s server-rendered name is not the expanded one. Expanded is '
    + 'what the server renders and what a reader with no JavaScript keeps, so '
    + 'any other name is a lie about that document');

  /* THE NAMES THEMSELVES: a verb about the rail, not a noun about the icon. */
  const { frontmatter } = await railSource();
  const labels = frontmatter.match(
    /TOGGLE_LABEL = \{\s*expanded:\s*'([^']+)',\s*collapsed:\s*'([^']+)',/);
  assert.ok(labels, 'IconRail.astro declares no TOGGLE_LABEL pair to read');
  assert.notEqual(labels[1], labels[2],
    'both chevron names are the same string, so the name never states which way '
    + 'pressing it goes');
  for (const name of [labels[1], labels[2]]) {
    assert.ok(/\brail\b/i.test(name) && /\b(collapse|expand)\b/i.test(name),
      `"${name}" does not say what pressing the chevron does to what. An `
      + 'accessible name of "Toggle" or "Menu" is the icon described, not the '
      + 'action announced');
  }

  /* AND THE SHELL READS THEM RATHER THAN RESTATING THEM. */
  const shell = strip(await readFile(
    new URL('../../src/scripts/climate-engine/shell/console-shell.ts', import.meta.url),
    'utf8'));
  assert.match(shell, /dataset\.labelCollapsed/,
    'console-shell.ts does not take the collapsed name off the button');
  assert.match(shell, /dataset\.labelExpanded/,
    'console-shell.ts does not take the expanded name off the button');
  for (const name of [labels[1], labels[2]]) {
    assert.ok(!shell.includes(name),
      `console-shell.ts spells "${name}" itself. The rail renders both names; a `
      + 'second copy here is the one that goes stale unseen, because it is only '
      + 'ever read aloud');
  }
  assert.match(shell, /setAttribute\('aria-expanded', String\(!collapsed\)\)/,
    'console-shell.ts does not keep aria-expanded in step with the rail. A '
    + 'disclosure whose state is announced wrong is worse than one with no state '
    + 'announced at all');
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE PANEL'S OWN COLLAPSE — a second door onto a state that already existed.

   console-shell.ts has always put this column away when you click the rail
   section whose pane is open. Nobody could find it: nothing on the page says the
   active section is also a close button, and a touch reader never hovers into a
   hint. The chevron is the same discoverability fix as the rail's labels, one
   column over.

   TWO DOORS ARE ONLY SAFE IF THEY CANNOT DIVERGE, so most of what follows is
   about the single state and the single paint rather than about the button.
   ═══════════════════════════════════════════════════════════════════════════ */

const PANEL_TOGGLE = new URL(
  '../../src/components/ClimateEngine/shell/PanelToggle.astro', import.meta.url);

async function panelToggleSource() {
  let src;
  try {
    src = await readFile(PANEL_TOGGLE, 'utf8');
  } catch (err) {
    assert.fail(
      `PanelToggle.astro could not be read (${err.code ?? err.message}) -- every `
      + 'assertion below reads it, so a missing file must fail rather than let '
      + 'the suite pass over a control that is not there');
  }
  assert.ok(src.trim().length > 0, 'PanelToggle.astro is empty');
  return src;
}

/** console-shell.ts, comments stripped. Read by four tests below. */
async function shellSource() {
  const src = strip(await readFile(
    new URL('../../src/scripts/climate-engine/shell/console-shell.ts', import.meta.url),
    'utf8'));
  assert.ok(src.trim().length > 0, 'console-shell.ts read back empty');
  return src;
}

test('the panel chevron has no state, no handler and no second toggle path', async () => {
  /* THE SHAPE THIS PROJECT KEEPS DELETING is a second control that owns a COPY of
     the fact. This one owns nothing: it is a button with a data attribute, and
     the shell binds it to the same `state.open` and the same `paint()` the rail's
     click path goes through. */
  const src = await panelToggleSource();
  assert.doesNotMatch(src, /<script/,
    'PanelToggle.astro ships a script. The panel is opened and closed in exactly '
    + 'one place; a handler here is the second path that can disagree with it');
  assert.match(src, /data-panel-toggle/,
    'the chevron carries no data-panel-toggle -- console-shell.ts finds it by '
    + 'that attribute, so without it the button renders and does nothing');
  assert.doesNotMatch(src, /localStorage/,
    'PanelToggle.astro reaches for storage itself. layout-state.ts is the only '
    + 'file that spells a key, and console-shell.ts is its only caller');

  const shell = await shellSource();

  const hiders = [...shell.matchAll(/classList\.toggle\('is-collapsed'/g)];
  assert.equal(hiders.length, 1,
    `console-shell.ts hides the sidebar from ${hiders.length} places. Two doors `
    + 'onto one room is the design; two writers of the room is the defect, '
    + 'because one of them will eventually be reached without the other');

  const mirrors = [...shell.matchAll(/setAttribute\(\s*PANEL_STATE_ATTR/g)];
  assert.equal(mirrors.length, 1,
    'the document-level mirror of the panel state is written from '
    + `${mirrors.length} places. It exists ONLY so the pre-paint script can apply `
    + 'the preference before the sidebar is parsed; every later write belongs in '
    + 'the same function as the class it mirrors');

  /* BOTH DOORS REACH THE SAME FUNCTION. A chevron wired to its own DOM poke would
     satisfy every assertion above and still leave the rail's aria-pressed stale. */
  assert.match(shell, /on\(panelToggle, 'click', \(\) => \{\s*state\.open = false;\s*paint\(\);/,
    "the chevron's handler does not go through state.open and paint(). Anything "
    + "else leaves the rail's aria-pressed, the pane classes and the stored "
    + 'preference describing a panel that is no longer on the page');
  assert.match(shell, /if \(state\.open && state\.id === id\) state\.open = false;/,
    "the rail's own close gesture is gone. The chevron was added BESIDE it, not "
    + 'instead of it -- a reader who already learned the VS Code gesture keeps it');
});

test('the panel chevron announces what it does, and needs no breakpoint', async () => {
  const src = await panelToggleSource();

  assert.match(src, /aria-expanded="true"/, 'the chevron carries no aria-expanded');
  assert.match(src, /aria-label=\{TOGGLE_LABEL\.expanded\}/,
    "the chevron's server-rendered name is not the expanded one -- expanded is "
    + 'what the server renders and what a reader with no JavaScript keeps');
  for (const which of ['expanded', 'collapsed']) {
    assert.match(src, new RegExp(`data-label-${which}=\\{TOGGLE_LABEL\\.${which}\\}`),
      `the chevron renders no data-label-${which} from TOGGLE_LABEL`);
  }

  const labels = src.match(
    /TOGGLE_LABEL = \{\s*expanded:\s*'([^']+)',\s*collapsed:\s*'([^']+)',/);
  assert.ok(labels, 'PanelToggle.astro declares no TOGGLE_LABEL pair to read');
  assert.notEqual(labels[1], labels[2], 'both chevron names are the same string');
  for (const name of [labels[1], labels[2]]) {
    assert.ok(/\bpanel\b/i.test(name) && /\b(collapse|expand)\b/i.test(name),
      `"${name}" does not say what pressing the chevron does to what`);
  }

  const shell = await shellSource();
  for (const name of [labels[1], labels[2]]) {
    assert.ok(!shell.includes(name),
      `console-shell.ts spells "${name}" itself -- a second copy of a sentence `
      + 'that is only ever read aloud is the copy nobody notices going stale');
  }

  /* NO BREAKPOINT OF ITS OWN, AND THAT IS THE POINT. The rule is that the chevron
     must not appear below 820px, where the Explore stage hides this column
     outright -- and it does not, because it is rendered INSIDE the column. A media
     query here would restate a fact the DOM already makes, and it would be WRONG
     on Compare, where the sidebar becomes a block above the bench rather than
     disappearing and the chevron still does something. */
  assert.doesNotMatch(src, /@media\s*\(\s*(max-|min-)?width/,
    'PanelToggle.astro declares a width breakpoint. It is inside the column it '
    + 'collapses, so it is already gone wherever that column is -- and the one '
    + 'route where the column survives a narrow viewport is the route where such '
    + 'a rule would wrongly take the control away');
  assert.match(src, /@media \(prefers-reduced-motion: reduce\)/,
    'the chevron animates its colour with no reduced-motion escape');
});

test('both routes render the panel chevron, exactly once, inside the sidebar', async () => {
  /* INSIDE THE SIDEBAR is load-bearing rather than tidy: it is what makes the
     chevron vanish with the column it collapses, on both routes, with no rule
     saying so -- and what makes "not below 820px" true for free on Explore. A
     chevron rendered as a SIBLING of the sidebar would survive the column it just
     hid, and sit there offering to hide it again. */
  const stage = await stageSource();
  const { src: bench } = await benchSource();

  for (const [name, src] of [['HeatMapStage.astro', stage], ['PairedBench.astro', bench]]) {
    const rendered = [...src.matchAll(/<PanelToggle\b/g)];
    assert.equal(rendered.length, 1,
      `${name} renders the panel chevron ${rendered.length} times. The console `
      + 'has one panel; a second chevron over it is a second control the shell '
      + 'never binds');
    assert.match(src, /import PanelToggle from '[^']*shell\/PanelToggle\.astro'/,
      `${name} does not import PanelToggle from the shared component`);

    const open = src.indexOf('class="sidebar"');
    const close = src.indexOf('</aside>', open);
    const at = src.indexOf('<PanelToggle');
    assert.ok(open !== -1 && close !== -1,
      `${name} has no <aside class="sidebar"> to contain the chevron`);
    assert.ok(at > open && at < close,
      `${name} renders the panel chevron outside the sidebar. Collapsed, the `
      + 'sidebar is display:none -- a chevron outside it outlives the column it '
      + 'just hid, and sits there offering to hide it again');

    /* THE PRE-PAINT RULE THAT CARRIES THE STORED VALUE DOWN FROM <html>, AND THE
       CLASS THE SHELL AND THE BROWSER GUARDS BOTH READ. Both, on both routes. */
    assert.match(src, /html\[data-panel="collapsed"\] \.sidebar\s*\{\s*display:\s*none/,
      `${name} has no rule hiding the sidebar from the document-level attribute. `
      + 'The pre-paint script runs where the rail is, before this column is '
      + 'parsed, so without it a stored collapse renders open on every load and '
      + 'then disappears once the module script mounts');
    assert.match(src, /\.sidebar\.is-collapsed\s*\{\s*display:\s*none/,
      `${name} no longer hides the sidebar from the class -- that class is the `
      + "element's own state and what the browser guards read");
  }
});

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

/* ═══════════════════════════════════════════════════════════════════════════
   THE PAIRED BENCH ADOPTS THE CONSOLE — the fifth part.

   Compare is the SECOND route to render the rail, and every guard above reads
   HeatMapStage.astro by name. A source tripwire names a FILE, so none of them
   followed the rail here: "each shell component is mounted exactly once" would
   pass just as happily with two rails on this page, because it never opens it.
   That is the eleventh instance in this project of a guard watching a place its
   subject was not, and the second created by a move rather than written that way.

   GUARD THE GUARD, once more:

     · an unreadable, empty or fenceless bench FAILS (`benchSource`)
     · the EXPECTED pane list is DERIVED from the rail's own section table, not
       written down here -- a sixth rail section with a body must then fail this
       file until the bench renders one, which a hardcoded list of four could
       never do
     · a derivation yielding fewer than two panes FAILS, because a bench with one
       pane is what this task existed to replace
   ═══════════════════════════════════════════════════════════════════════════ */

const BENCH = new URL(
  '../../src/components/ClimateEngine/compare/PairedBench.astro', import.meta.url);

async function benchSource() {
  let src;
  try {
    src = await readFile(BENCH, 'utf8');
  } catch (err) {
    assert.fail(
      'src/components/ClimateEngine/compare/PairedBench.astro could not be read '
      + `(${err.code ?? err.message}) -- every assertion below reads it, so a `
      + 'missing file must fail rather than let "the bench renders no second '
      + 'rail" pass over an empty string');
  }
  assert.ok(src.trim().length > 0,
    'PairedBench.astro is EMPTY -- it would then mount no duplicate rail in the '
    + 'least useful way available');
  const split = src.split(/^---$/m);
  assert.ok(split.length >= 3,
    'PairedBench.astro has no `---` frontmatter fence -- the checks below read '
    + 'the frontmatter and the template separately');
  const body = split[2];
  return {
    src,
    frontmatter: strip(split[1]),
    template: strip(body.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')),
    css: [...body.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)].map((m) => m[2]).join('\n'),
  };
}

/**
 * The panes THIS route must render, derived from the rail's own table.
 *
 * `always` bodies appear on every route; an `own-route` body appears only on the
 * route of that name, and this route is Analysis. Deriving it is what makes the
 * guard survive a sixth section: add one with a body and this list grows, and the
 * bench fails until it renders one. A list written out here would agree with any
 * rail at all.
 */
function panesExpectedOn(route, table) {
  const ids = table.filter((s) => s.body === 'always' || s.id === route).map((s) => s.id);
  assert.ok(ids.length >= 2,
    `the rail's table yields ${ids.length} pane(s) for the ${route} route -- a `
    + 'console with one pane is the thing this task replaced, so a derivation '
    + 'that collapses to one must fail rather than be satisfied by it');
  return ids.sort();
}

test('the bench mounts ONE rail, and no scope switcher', async () => {
  /* COUNTED, NOT MERELY PRESENT. The toolbox was shipped twice by exactly this
     mistake a task ago -- the old mount left standing beside the new one -- and
     `assert.match(src, /<IconRail\b/)` passes with two rails on screen. Two rails
     means two brand marks, two of every section, and a pane switcher that paints
     one of them while the reader clicks the other. */
  const { src, frontmatter } = await benchSource();

  const rails = (src.match(/<IconRail\b/g) ?? []).length;
  assert.equal(rails, 1,
    rails === 0
      ? 'PairedBench.astro renders no <IconRail /> -- Compare is a console route '
        + 'and the rail is the only navigation it has'
      : `PairedBench.astro mounts <IconRail /> ${rails} times`);
  assert.match(frontmatter, /import IconRail from '\.\.\/shell\/IconRail\.astro'/,
    'PairedBench.astro renders <IconRail /> without importing it -- an Astro '
    + 'component that is not imported renders as an unknown HTML element, '
    + 'silently and with no styles');

  /* THE ROUTE AND THE PANE IT OPENS. `route="analysis"` is what takes Analysis's
     href away so it cannot be a link to the page it is on, and what turns Map into
     the link across. */
  assert.match(src, /<IconRail\s+route="analysis"\s+pane="analysis"\s*\/>/,
    'the rail on Compare must be told route="analysis" (this page IS Compare) '
    + 'and pane="analysis" (the body the server renders open). A different route '
    + 'would put a self-link back; a different pane would mark a body this route '
    + 'does not open');

  /* NO SCOPE SWITCHER, and this is a decision rather than an omission. It names
     ONE area; Compare holds TWO and neither is "the" scope, so the only value
     available to a prerendered page -- the default pair -- would state a false
     scope to anyone who arrived on a different one. The A/B selects are this
     route's scope control instead. */
  assert.doesNotMatch(src, /<ScopeSwitcher\b/,
    'PairedBench.astro renders a <ScopeSwitcher />. It names one area and this '
    + 'route holds two, so it can only state a scope the page does not have -- '
    + 'and console-shell.ts wires select[data-scope] only where a .stage '
    + 'declares one data-area, so it would be inert as well as untrue');
  assert.doesNotMatch(frontmatter, /ScopeSwitcher/,
    'PairedBench.astro imports ScopeSwitcher without rendering it');
});

test('every rail section with a body here has one, and each empty pane says why', async () => {
  const { frontmatter: railFm } = await railSource();
  const { template } = await benchSource();
  const expected = panesExpectedOn('analysis', sectionTable(railFm));

  const rendered = [...template.matchAll(/data-pane="([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...rendered].sort(), expected,
    'the bench does not render exactly the panes the rail offers on this route. '
    + `It renders [${rendered.join(', ')}]; the rail's table says [${expected.join(', ')}]. `
    + 'A rail section whose body is missing here is a button that does nothing on '
    + 'the console\'s only navigation -- and a body with no rail section is one '
    + 'nothing can open');
  assert.equal(new Set(rendered).size, rendered.length,
    'a data-pane value is rendered TWICE in PairedBench.astro ('
    + rendered.filter((id, i) => rendered.indexOf(id) !== i).join(', ')
    + ') -- console-shell.ts paints every match, so one of them is invisible');

  /* EXACTLY ONE OPEN, and it must be the one the rail was told about. The shell
     script reads the server's `is-on` back as its starting state rather than
     restating it, so two of them would leave the sidebar showing two bodies at
     once until the first click. */
  const open = [...template.matchAll(/class="pane is-on" data-pane="([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(open, ['analysis'],
    `${open.length} pane(s) are rendered open (${open.join(', ') || 'none'}) -- `
    + 'exactly one must be, and it must be the pane the rail is given');

  /* A WAY OUT OF EVERY PANE THAT IS EMPTY HERE. Layers, Reports and Scenarios
     hold no controls on this route; telling a reader why and leaving them there
     is only half an answer. Analysis is exempt -- it is the live one. */
  for (const id of expected.filter((x) => x !== 'analysis')) {
    const pane = template.match(new RegExp(`data-pane="${id}"([\\s\\S]*?)</div>`));
    assert.ok(pane, `the ${id} pane could not be sliced out of the template`);
    assert.match(pane[1], /class="pane-out"/,
      `the ${id} pane offers no way out. It states why it is empty on this route, `
      + 'which is half the job -- the reader who opened it still has to be told '
      + 'where the thing they came for actually lives');
    assert.match(pane[1], /class="pane-note"/,
      `the ${id} pane renders no prose. An empty box under a heading reads as a `
      + 'pane that failed to load, which is the one impression this console must '
      + 'never give');
  }
});

test('the A/B selects sit inside the bench root, where the controller looks', async () => {
  /* MEASURED CONSTRAINT, NOT A STYLE CHOICE. paired-controller.ts binds
     `root = document.querySelector('[data-compare-root]')` once and runs every
     query through it, so a select moved outside that element is simply never
     found -- and `updateInputs` returns without throwing, leaving two empty
     selects on a page that otherwise settles perfectly. */
  const { template } = await benchSource();
  const root = template.indexOf('data-compare-root');
  assert.notEqual(root, -1, 'PairedBench.astro renders no [data-compare-root]');

  for (const which of ['ward-a', 'ward-b']) {
    const at = template.indexOf(`data-input="${which}"`);
    assert.ok(at > root,
      `the ${which} select is not inside [data-compare-root] -- paired-controller.ts `
      + 'queries through that element, so it would never be found and would never '
      + 'be filled');
  }
  const inPane = template.match(/data-pane="analysis"([\s\S]*?)data-pane="/);
  assert.ok(inPane, 'the analysis pane could not be sliced out of the template');
  for (const which of ['ward-a', 'ward-b']) {
    assert.match(inPane[1], new RegExp(`data-input="${which}"`),
      `the ${which} select is not in the Analysis pane -- the A/B pickers ARE this `
      + "route's scope control, and they belong where Explore keeps its switcher");
  }
});

test('every token the rail paints with resolves on the compare route', async () => {
  /* THE DEFECT THIS IS WRITTEN AGAINST WAS MEASURED IN A BUILT BUNDLE, not
     reasoned about. shell/IconRail.astro paints entirely in var(), and those
     tokens are declared on `.stage` inside HeatMapStage.astro's is:global block --
     a stylesheet only the Explore route loads. On /heat-map/compare/ the built CSS
     declared no --rail-ground, no --mono and no --sans at all.

     An undefined custom property does NOT fall back: the declaration using it is
     invalid at computed-value time and unsets, so `background:var(--rail-ground)`
     took the rail's ground away entirely. Nothing errored and nothing looked wrong
     in the source -- the same shape as the --line-hi bug that left every unchecked
     layer checkbox with no border.

     WORSE THAN MISSING: INVERTED. --paper and --ink exist on both routes with
     OPPOSITE roles. HeatMapStage declares --paper:#ecedf0 (its brightest ink) and
     --ink:#8fa3a5; PairedBench declares --paper as the page's near-black ground
     and --ink as its brightest text. `.rail-btn[aria-current="page"]{color:
     var(--paper)}` therefore painted the active button near-black, on a rail that
     had just lost its background. So a bare "is it declared" check is not enough
     for that one, and the remap is asserted directly. */
  const { css: railCss } = await railSource();
  const { css: benchCss } = await benchSource();
  assert.ok(railCss.trim().length > 0, 'the rail has no CSS -- nothing to check');
  assert.ok(benchCss.trim().length > 0, 'the bench has no CSS -- nothing to check');

  /* Only uses with NO fallback. `var(--rail, 64px)` survives an undeclared token
     by design, and demanding a declaration for it would be a false positive. */
  const used = [...new Set(
    [...railCss.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)].map((m) => m[1]))].sort();

  /* MINUS THE ONES THE RAIL DECLARES ON ITSELF. What this test is really asking is
     which tokens the rail takes FROM THE ROUTE, and a property the rail sets on
     `.rail` and reads back on a descendant is not one of them -- it inherits, and
     no route can be missing it. --rail-w is the case: it resolves the width
     fallback once so the accent bar cannot drift from the column. Without this
     subtraction the guard would demand every route re-declare the rail's own
     internals, which is how a guard starts getting weakened to shut it up. */
  const ownTokens = new Set(
    [...railCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const needed = used.filter((t) => !ownTokens.has(t));

  assert.ok(needed.length > 0,
    'no fallback-less var() was found in the rail -- this loop would assert '
    + 'nothing, and the rail is painted entirely in var()');

  const declared = new Set(
    [...benchCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const missing = needed.filter((t) => !declared.has(t));
  assert.deepEqual(missing, [],
    `PairedBench.astro declares no ${missing.join(', ')}. The rail paints with `
    + 'it and the compare route never loads HeatMapStage.astro, so the '
    + 'declaration using it is invalid at computed-value time and unsets '
    + 'entirely -- silently, and with nothing wrong-looking in either source');

  assert.match(benchCss, /\.rail-slot\s*\{[^}]*--paper:\s*var\(--ink\)/,
    'the rail wrapper does not remap --paper. This file declares --paper as the '
    + "page's near-black GROUND and the rail uses it as its brightest INK, so "
    + 'without the remap the active section renders near-black on near-black. '
    + 'It must POINT AT --ink rather than restate its value, so the colour keeps '
    + 'one spelling');
  assert.match(benchCss, /\.rail-slot\s*\{[^}]*--rail-ground:/,
    'the rail wrapper declares no --rail-ground -- the rail would have no '
    + 'background on this route');
});

test('both routes agree on how wide the rail is', async () => {
  /* THE WIDTH USED TO BE WRITTEN TWICE AND THIS TEST USED TO COMPARE THE TWO.
     HeatMapStage.astro declared no --rail, so Explore took a fallback spelled
     inside IconRail.astro; PairedBench.astro declared a literal of its own,
     because it pads the bench past the rail with `calc(var(--rail) + ...)` and a
     fallback it never names is a value it cannot read.

     THAT ARRANGEMENT DIED WHEN THE WIDTH BECAME A STATE. Two numbers with a guard
     over them was tolerable for a constant; expanded-and-collapsed makes it two
     numbers PER ROUTE, and the drift a comparison catches is then only one of the
     four ways they can disagree -- the interesting failure being a route that
     tracks one state and not the other, which two equal literals cannot express
     at all. The last time this width moved it also turned up a THIRD copy inside
     the rail: the accent bar offset by `var(--rail, 56px)` while the column had
     gone to 58, floating the bar half the difference off the edge it is meant to
     sit flush against.

     SO THERE IS ONE DECLARATION NOW, and this guard proves the ABSENCE of the
     others rather than the agreement of two. An absence is the stronger claim: a
     comparison passes as soon as two copies happen to match, while this fails the
     moment a second copy exists at all. What the rail actually RENDERS at each
     state on each route is measured in a browser, in tests/e2e -- source cannot
     see a computed width, and this test does not pretend to. */
  const { css: railCss } = await railSource();
  const { css: benchCss } = await benchSource();
  const stageCss = await stageSource();

  /* THE TWO WIDTHS AND THE SELECTION, ALL THREE IN THE RAIL. */
  const collapsed = railCss.match(/--rail-collapsed:\s*(\d+)px/);
  const expanded = railCss.match(/--rail-expanded:\s*(\d+)px/);
  assert.ok(collapsed && expanded,
    'IconRail.astro no longer declares both --rail-collapsed and --rail-expanded '
    + 'as plain pixel values. They are the only two widths the console has, and a '
    + 'guard that cannot read them is reading nothing');
  assert.notEqual(collapsed[1], expanded[1],
    `both rail states are ${collapsed[1]}px. The expanded rail exists to hold the `
    + 'labels; at the collapsed width they do not fit, so a rail that expands to '
    + 'the same number is a collapse control that does nothing');
  assert.ok(Number(expanded[1]) > Number(collapsed[1]),
    `--rail-expanded (${expanded[1]}px) is not wider than --rail-collapsed `
    + `(${collapsed[1]}px)`);

  /* DECLARED WHERE BOTH ROUTES INHERIT IT. On `.rail` the width would reach the
     rail's own children and nothing above them -- and the bench's padding, which
     has to clear a `position:fixed` rail, is above them. */
  assert.match(railCss, /:global\(:root\)\s*\{[^}]*--rail:\s*var\(--rail-collapsed\)/,
    'IconRail.astro does not resolve --rail on :root. Declared anywhere inside '
    + 'the rail it cannot reach PairedBench.astro\'s padding-inline-start, which '
    + 'is what stops the fixed rail covering the bench');
  assert.match(railCss,
    /html:not\(\[data-rail="collapsed"\]\)\)\s*\{\s*--rail:\s*var\(--rail-expanded\)/,
    'nothing switches --rail to the expanded width. The labels would render '
    + 'inside a 58px column');

  /* AND NOWHERE ELSE. This is the whole guard: any second declaration on either
     route shadows the one above for that route's subtree, and shadows it at ONE
     state, so the routes come apart while both still look declared-and-correct
     in their own file. */
  for (const [name, css] of [['PairedBench.astro', benchCss], ['HeatMapStage.astro', stageCss]]) {
    for (const token of ['--rail', '--rail-collapsed', '--rail-expanded']) {
      assert.doesNotMatch(css, new RegExp(`${token}\\s*:`),
        `${name} declares ${token} of its own. IconRail.astro declares it on `
        + ':root for both routes; a second declaration lower in the tree wins for '
        + 'everything under it, so this route would keep one width while the '
        + 'other tracked the state');
    }
  }

  /* THE READERS. The bench must still take its padding from the property rather
     than from a number of its own, and the rail's accent bar from the same one --
     that bar is the third copy the last widening turned up. */
  /* CLEARANCE READS `--rail-edge`, NOT `--rail`, and the difference is the whole
     point of the second token. The rail floats now — inset by a margin and drawn
     with a hairline — so its right edge is no longer at `--rail` from the viewport.
     Three rules on this route have to clear it: the bench's padding, the mobile
     padding, and the bottom sheet's offset. Every one reads the derived property.

     BOTH HALVES ARE ASSERTED. That the readers use `--rail-edge`, and that
     `--rail-edge` is still DERIVED from `--rail` rather than typed — because a
     literal there would be the same defect one level up: the rail would resize with
     its state and the clearance would sit at yesterday's number. */
  assert.match(railCss, /--rail-edge:\s*calc\([^;]*var\(--rail\)/,
    'IconRail.astro no longer derives --rail-edge from --rail. It is the width '
    + 'everything else clears the rail by, so a literal here means the rail can '
    + 'expand while the bench beside it keeps reserving the collapsed width');
  assert.match(benchCss, /padding-inline-start:\s*calc\(\s*var\(--rail-edge\)/,
    'PairedBench.astro no longer pads the bench past var(--rail-edge). Its rail is '
    + 'position:fixed, so without that padding the navigation covers the bench — '
    + 'and padding past bare var(--rail) would clear the column but not the inset '
    + 'it floats by');
  assert.doesNotMatch(benchCss, /calc\(\s*var\(--rail\)\s*\+/,
    'a clearance on the compare route still reads bare var(--rail). That was '
    + 'correct while the rail sat flush against the viewport; it now floats, so '
    + 'every clearance is short by the inset and the hairline');
  assert.match(railCss, /\.rail\s*\{[^}]*inline-size:\s*var\(--rail\)/,
    'the rail is not sized by var(--rail) -- whatever else reads it is then '
    + 'reserving space for a column of a different width');
  assert.match(railCss, /left:\s*calc\(50% - var\(--rail\) \/ 2\)/,
    'the accent bar is no longer offset from var(--rail). It is positioned from '
    + 'the rail\'s width, so a stale copy floats it half the difference off the '
    + 'edge it is meant to sit flush against');
});

test('the rail collapses at exactly the width the console drops its sidebar', async () => {
  /* TWO FILES, ONE BREAKPOINT, AND THEY ARE COMPLEMENTS RATHER THAN COPIES.
     HeatMapStage.astro drops the sidebar at `max-width:820px`; the rail expands
     above `width > 820px`. Written as different comparisons of the same number
     they cannot be compared by looking for the same string, so the number is
     pulled out of each and checked -- otherwise there is a band of widths where
     the rail believes it has room for labels and the console has already decided
     there is not. */
  const { css: railCss } = await railSource();
  const stageCss = await stageSource();

  const sidebarGone = stageCss.match(
    /@media\s*\(max-width:\s*(\d+)px\)\s*\{(?:[^{}]|\{[^{}]*\})*?\.sidebar\s*\{\s*display:\s*none/);
  assert.ok(sidebarGone,
    'HeatMapStage.astro no longer drops .sidebar at a max-width breakpoint -- '
    + 'the rail\'s forced collapse is pinned to that number, and this guard can '
    + 'no longer read it');

  /* EVERY ONE OF THEM, not the first. The rail states this breakpoint more than
     once -- once to switch the width, once to switch the look, once to take the
     chevron away -- and the failure that matters is exactly the one where a
     person edits one and not the others, so a `.match()` reading the first would
     be blind to it. */
  const thresholds = [...railCss.matchAll(/@media \(width (?:>|<=) (\d+)px\)/g)]
    .map((m) => m[1]);
  assert.ok(thresholds.length >= 3,
    `the rail states a width breakpoint ${thresholds.length} times, expected at `
    + 'least 3 (the width switch, the expanded look, and the chevron). Fewer '
    + 'means one of the three has stopped being conditional at all');

  const wrong = thresholds.filter((t) => t !== sidebarGone[1]);
  assert.deepEqual(wrong, [],
    `the rail changes state at ${wrong.join(', ')}px while the console drops its `
    + `sidebar at ${sidebarGone[1]}px. Between the two there is a band of widths `
    + 'where the rail believes it has room for labels and the console has already '
    + 'decided there is not -- or where the chevron is offered over a rail that '
    + 'cannot expand');
});

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
