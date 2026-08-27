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
