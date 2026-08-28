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
