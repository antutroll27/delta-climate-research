import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * THE CONSOLE AGREEING WITH ITSELF — read as source.
 *
 * `state.ward` and the scenario both have PROJECTIONS: things elsewhere on the
 * page that restate them. The address bar, the stage's `data-area`, the scope
 * switcher, the breadcrumb, the document title, the ward strip's tiles. A change
 * that updates some projections and not others leaves the page contradicting
 * itself — silently, and usually with a plausible wrong value rather than a blank,
 * which is the worst shape a defect can take in an instrument.
 *
 * WHY SOURCE AND NOT A BROWSER. Everything asserted here is either unreachable in
 * this build (the Mapillary coverage source needs a token production sets and this
 * build does not) or is a WIRING fact — which handler calls which door — that a
 * browser can only observe one control at a time. The rendered consequences that
 * CAN be driven are driven, in tests/e2e/heat-map-routing.spec.ts; these are the
 * ones left over, and each states which property of the source it reads and why
 * that property forces the behaviour that matters.
 *
 * GUARD THE GUARD. This project has caught thirteen guards protecting nothing, and
 * the recurring shape is a check that quietly stopped finding its subject. So
 * `appSource()` is the only door into the file and it is shut: unreadable fails,
 * empty fails, and every anchor a test navigates from is asserted present before
 * anything is concluded from what follows it.
 */

const APP = new URL('../../src/scripts/climate-engine/heat-map-app.ts', import.meta.url);

/** Comments are not code. A call named in prose must never satisfy an assertion. */
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');

async function appSource() {
  let src;
  try {
    src = await readFile(APP, 'utf8');
  } catch (err) {
    assert.fail(
      'src/scripts/climate-engine/heat-map-app.ts could not be read '
      + `(${err.code ?? err.message}) -- every assertion below reads it, so a `
      + 'missing file must fail rather than let the suite pass vacuously');
  }
  assert.ok(src.trim().length > 0, 'heat-map-app.ts is empty -- nothing to check');
  const code = strip(src);
  assert.ok(code.includes('function mountHeatMap'),
    'heat-map-app.ts no longer declares `mountHeatMap` once its comments are '
    + 'stripped -- the stripper has eaten the file, and every match below would be '
    + 'read from the wrong text');
  return code;
}

/**
 * EVERY CONTROL THAT MOVES THE SCENARIO, and the text that wires it.
 *
 * A LIST, not three hand-written assertions, so a fourth scenario control is one
 * line here rather than a test nobody remembers to write.
 */
const SCENARIO_CONTROLS = [
  { what: 'the three intervention sliders', anchor: "onEl(s, 'change'" },
  { what: 'the diurnal phase buttons', anchor: "'#segPhase button'" },
  { what: 'the warming pathway buttons', anchor: "'#segPath button'" },
];

test('every scenario control re-solves through the door that blanks the strip', async () => {
  /* WHAT THIS PROTECTS. `refreshStats` writes `big-{id}` for the OPEN ward only.
     A control that calls `resetSim` directly moves the physics under all three
     wards and repaints one of them, leaving the other tiles printing means from a
     scenario that no longer exists -- under a bare `°C mean` label that names
     neither the hour nor the intervention set. Measured on the shipped build, that
     put `ballygunge 39.3 · baruipur 29.9` in the strip and asserted a 9.4 K gap
     whose honest like-for-like value was 2.4 K.

     `applyScenarioChange` is the one door that blanks the falsified tiles first.

     THE RENDERED CONSEQUENCE IS DRIVEN IN A BROWSER, for the slider and the phase,
     by 'the ward strip never prints two scenarios side by side' in
     tests/e2e/heat-map-routing.spec.ts. The pathway control cannot be reached the
     same way -- its buttons are rendered from the COUNTRY's pathway table, so a
     spec that clicked one would be asserting about India's adopted projections
     rather than about this wiring. This is what covers it, and what covers the
     next control added beside it.

     THE FIRST RE-SOLVE AFTER THE ANCHOR IS THE ONE THE HANDLER MAKES. Both calls
     are searched for and their positions compared, rather than merely requiring
     the good one to appear somewhere: a handler that called `resetSim()` and then,
     later in the file, some other handler called `applyScenarioChange()` would
     satisfy a presence check while shipping the defect. */
  const code = await appSource();

  assert.ok(code.includes('function applyScenarioChange'),
    'heat-map-app.ts declares no `applyScenarioChange` -- the door every scenario '
    + 'control is checked against below does not exist, so every assertion in this '
    + 'test would be measuring a name that means nothing');

  for (const { what, anchor } of SCENARIO_CONTROLS) {
    const at = code.indexOf(anchor);
    assert.notEqual(at, -1,
      `${what}: the anchor \`${anchor}\` is no longer in heat-map-app.ts. This test `
      + 'navigates from it, so it must fail rather than silently stop checking a '
      + 'control that is still there under a different spelling');

    const rest = code.slice(at);
    const door = rest.indexOf('applyScenarioChange()');
    const bare = rest.indexOf('resetSim()');

    assert.ok(door !== -1 && (bare === -1 || door < bare),
      `${what} re-solves by calling \`resetSim()\` directly. That moves the physics `
      + 'under all three wards and repaints only the open one, so the ward strip is '
      + 'left printing two different scenarios side by side under one `°C mean` '
      + 'label -- the exact contradiction `applyScenarioChange` exists to prevent. '
      + 'Call it instead; it blanks the tiles it has just falsified and then '
      + 're-solves.');
  }
});

const BASE = new URL('../../src/layouts/Base.astro', import.meta.url);
const AREA_ROUTE = new URL('../../src/pages/heat-map/[country]/[city]/[area].astro', import.meta.url);

async function readOrFail(url, why) {
  let src;
  try {
    src = await readFile(url, 'utf8');
  } catch (err) {
    assert.fail(`${url.pathname} could not be read (${err.code ?? err.message}) -- ${why}`);
  }
  assert.ok(src.trim().length > 0, `${url.pathname} is empty -- nothing to check`);
  return src;
}

/**
 * EVERY HEAD TAG IN Base.astro WHOSE VALUE IS A PER-PAGE ONE, as `{ selector, of }`.
 *
 * DISCOVERED FROM THE LAYOUT, never listed here. That is the whole point: the set
 * of tags that restate the page's identity is Base.astro's to decide, and a list
 * written out in this file would be a third copy — free to agree with the layout on
 * the day it was written and to stop agreeing the next time a social card is added.
 * Reading the layout is what makes the next tag covered automatically.
 */
function wardVaryingHeadTags(baseSrc) {
  const found = [];
  for (const [, tag, attrs] of baseSrc.matchAll(/<(meta|link)\b([^>]*?)\/?>/g)) {
    const bound = attrs.match(/\b(content|href)=\{(title|description|canonical)\}/);
    if (!bound) continue;
    const [, attr, value] = bound;
    /* The selector the runtime writer would have to use, built from whichever
       identifying attribute this tag carries. */
    const id = attrs.match(/\b(name|property|rel)="([^"]+)"/);
    assert.ok(id,
      `Base.astro has a <${tag}> bound to {${value}} with no name, property or rel `
      + 'attribute, so nothing can address it. This test cannot check what it '
      + 'cannot name');
    found.push({
      sel: `${tag}[${id[1]}="${id[2]}"]`,
      attr,
      of: value === 'canonical' ? 'url' : value,
    });
  }
  return found;
}

test('every per-page head tag the layout renders is enrolled in the ward projection', async () => {
  /* WHAT THIS PROTECTS. Switching ward in place rewrites the URL through
     `history.replaceState` and reloads nothing else, so any head tag left unwritten
     goes on describing the ward the page was OPENED at while the address bar
     describes the one on screen. A bookmark taken then is filed under the wrong
     ward; the canonical link publishes a different page than the one rendered.

     Base.astro prints the title in three tags and the canonical URL in two, and
     nothing about that arrangement is fixed -- the next social card added there
     would be one more stale statement nobody thought to enrol. So the required set
     is READ OFF THE LAYOUT and compared with `WARD_META` in heat-map-app.ts, rather
     than being a hand-written list that would have to be remembered twice.

     `document.title` is checked separately below: it is a property, not an
     attribute, so it cannot be in the list and would otherwise be the one member of
     the set with no guard on it at all. */
  const baseSrc = await readOrFail(BASE,
    'this test reads the layout to discover which head tags restate the page, and '
    + 'an unreadable layout would yield an empty list that nothing then checks');
  const code = await appSource();

  const required = wardVaryingHeadTags(baseSrc);
  assert.ok(required.length >= 5,
    `Base.astro yielded only ${required.length} per-page head tags. It renders the `
    + 'title in <title>, og:title and twitter:title, the description in three more '
    + 'and the canonical URL in two -- a number this small means the matcher has '
    + 'stopped finding them and this test is passing over an empty list');

  const declared = code.match(/const WARD_META[^=]*=\s*\[([\s\S]*?)\n\s*\];/);
  assert.ok(declared,
    'heat-map-app.ts declares no `const WARD_META = [ ... ];`. That list is what '
    + '`updateDocumentMeta` walks, and a list this test cannot find is one it '
    + 'cannot check -- so this must fail rather than conclude the enrolment is '
    + 'complete');

  const enrolled = [...declared[1].matchAll(
    /\{\s*sel:\s*'([^']+)'\s*,\s*attr:\s*'([^']+)'\s*,\s*of:\s*'([^']+)'\s*\}/g)]
    .map(([, sel, attr, of]) => ({ sel, attr, of }));
  assert.ok(enrolled.length > 0,
    'WARD_META parsed to ZERO entries -- either it is empty or its fields are no '
    + 'longer `sel`, `attr`, `of` in that order. Both must fail, because the '
    + 'comparison below would otherwise be against nothing');

  for (const want of required) {
    const got = enrolled.find((e) => e.sel === want.sel);
    assert.ok(got,
      `Base.astro renders \`${want.sel}\` from the page's own {${want.of === 'url' ? 'canonical' : want.of}} `
      + 'and heat-map-app.ts never rewrites it. After an in-place ward switch that '
      + 'tag still describes the ward the page was opened at, while the URL beside '
      + 'it describes the one on screen. Add it to WARD_META.');
    assert.equal(got.attr, want.attr,
      `${want.sel} carries its value in \`${want.attr}\` and WARD_META writes `
      + `\`${got.attr}\`, so the writer sets an attribute nothing reads and leaves `
      + 'the real one stale');
    assert.equal(got.of, want.of,
      `${want.sel} renders the page's ${want.of} and WARD_META refills it with the `
      + `${got.of} -- so after a switch it states the wrong thing rather than a `
      + 'stale thing, which is worse');
  }

  assert.match(code, /document\.title\s*=/,
    'nothing assigns `document.title`. It is the tab label and the default text of '
    + 'any bookmark taken after a switch, it is not an attribute so it cannot be in '
    + 'WARD_META, and it was the tag this whole defect was found through');
});

test('the page title and description have one spelling, shared by both writers', async () => {
  /* TWO WRITERS, ONE SENTENCE. The route renders the title and description at build
     time; the instrument rewrites them in the browser after an in-place switch.
     Spelled out in both places they would agree on the day they were written and
     drift on every day after -- and the drift would be invisible, because each
     writer is correct on its own terms: the server's title is right for the page
     that loaded, the client's for the page you are looking at, and only a reader
     who had switched wards would ever see them disagree.

     So the test is not "do the two strings match" -- comparing two copies is how a
     guard ends up protecting nothing. It is that there is only ONE copy, in
     scope/page-meta.ts, and that both writers call it. */
  const [routeSrc, code, meta] = await Promise.all([
    readOrFail(AREA_ROUTE, 'it is one of the two writers this test exists to keep '
      + 'on one spelling'),
    appSource(),
    readOrFail(new URL('../../src/scripts/climate-engine/scope/page-meta.ts', import.meta.url),
      'it is the single spelling both writers are checked against'),
  ]);

  for (const fn of ['areaPageTitle', 'areaPageDescription']) {
    assert.match(meta, new RegExp(`export function ${fn}\\b`),
      `scope/page-meta.ts no longer exports \`${fn}\` -- the shared spelling this `
      + 'test checks both writers against does not exist');
    assert.match(routeSrc, new RegExp(`\\b${fn}\\(`),
      `the area route does not call \`${fn}\`. It is spelling the page's own title `
      + 'or description inline again, which is the copy that drifts');
    assert.match(code, new RegExp(`\\b${fn}\\(`),
      `heat-map-app.ts does not call \`${fn}\`. Its in-place ward switch is `
      + 'spelling the title or description itself, so the server and the browser '
      + 'describe the same page in two different sentences');
  }

  /* AND THE PROSE ITSELF LIVES IN EXACTLY ONE FILE. Calling the helper does not
     stop someone leaving the old literal behind beside the call. */
  const marker = 'Urban Heat Explorer';
  assert.ok(meta.includes(marker),
    `scope/page-meta.ts no longer contains "${marker}", so this check has lost its `
    + 'subject and would pass for every file below by accident');
  for (const [name, src] of [['the area route', routeSrc], ['heat-map-app.ts', code]]) {
    assert.ok(!src.includes(marker),
      `${name} still spells the page title out ("${marker}") beside its call to `
      + 'areaPageTitle. Two copies is the state this test exists to prevent, and a '
      + 'call that sits next to a literal is the way it comes back');
  }
});
