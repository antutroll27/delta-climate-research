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

/** The declared sections, as `{ id, label, href }`. Never an empty list. */
function sectionTable(frontmatter) {
  const block = frontmatter.match(/const\s+SECTIONS[^=]*=\s*\[([\s\S]*?)\n\s*\];/);
  assert.ok(block, 'IconRail.astro declares no `const SECTIONS = [ ... ];` -- the '
    + 'sections are read from that table, and a table that cannot be found must '
    + 'fail rather than yield an empty list that nothing then checks');

  const entries = [...block[1].matchAll(
    /\{\s*id:\s*'([a-z]+)'\s*,\s*label:\s*'([^']+)'\s*,\s*href:\s*([^,]+),/g)]
    .map(([, id, label, href]) => ({ id, label, href: href.trim() }));

  assert.ok(entries.length > 0, 'the SECTIONS table parsed to ZERO entries -- '
    + 'either the table is empty or its fields are no longer `id`, `label`, '
    + '`href` in that order; both must fail, because every loop below would '
    + 'otherwise assert nothing');
  return entries;
}

/**
 * The two arms of the section loop, as raw text.
 *
 * Sliced from `items.map(` to the settings control, which is deliberately NOT a
 * section: it is pinned to the bottom, it is nowhere the rail can BE, so it
 * carries no `data-rail` and can never be current. Excluding it keeps the
 * per-section assertions from being satisfied by a control that is not one.
 */
function loopArms(template) {
  const start = template.indexOf('items.map(');
  assert.ok(start !== -1, 'IconRail.astro renders no `items.map(` loop -- the '
    + 'assertions below read the loop arms and cannot find them');
  const region = template.slice(start);
  const end = region.indexOf('rail-settings');
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
