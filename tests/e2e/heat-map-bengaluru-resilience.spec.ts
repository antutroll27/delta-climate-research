import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { dcUrs, RESILIENCE_SCORE_LIVE } from '../../src/scripts/climate-engine/dc-urs.ts';
import { applyScenario } from '../../src/scripts/climate-engine/dc-urs-scenario.ts';
import type { DcUrsInputs } from '../../src/scripts/climate-engine/dc-urs-inputs.ts';

/**
 * A BENGALURU WARD SHOWS A RESILIENCE SCORE, AND SAYS WHAT IT DOES NOT KNOW.
 *
 * Before this plan every Bengaluru ward read "resilience inputs unavailable":
 * the registry declared no inputs file. The unit tests prove the file and the
 * URL; only a browser proves the pane actually renders a number from them.
 * socioVuln ships unmeasured, so the confidence chip must be showing.
 *
 * THE NUMBER IS PINNED, NOT JUST SHAPED. `/^\d{1,3}$/` alone would pass for any
 * ward's row served at this URL — the engine and the served file could drift and
 * this test would not notice. `dcUrs()` is imported directly (pure: no DOM, no
 * GL, no I/O — see its own header) and run over the SERVED
 * bengaluru-dc-urs-inputs.json here, so the expectation is computed from the same
 * two things the page itself combines, not retyped by hand.
 */
const WARD_PATH = '/heat-map/in/bengaluru/mg-road/';
/* The score was withdrawn from the console on 2026-09-17 (RESILIENCE_SCORE_LIVE in
   dc-urs.ts). These score tests are its re-enable checklist, so they skip rather than
   go: flip the flag and they run again, and the "Coming soon" guard at the foot of
   this file stands down in the same move. */
const WITHDRAWN = 'the resilience score is withdrawn (RESILIENCE_SCORE_LIVE = false)';
const WARD_ID = 'mg-road';

test('MG Road shows a resilience score and its confidence chip', async ({ page }) => {
  test.skip(!RESILIENCE_SCORE_LIVE, WITHDRAWN);
  const raw = JSON.parse(await readFile(
    fileURLToPath(new URL('../../public/heat-map/data/bengaluru-dc-urs-inputs.json', import.meta.url)),
    'utf8',
  )) as { wards: Record<string, DcUrsInputs> };
  // Matches `setText('scoreNum', String(Math.round(now)))` in heat-map-app.ts:
  // Math.round, not toFixed(0) — the two differ on the .5 boundary.
  const expectedScore = String(Math.round(dcUrs(raw.wards[WARD_ID])));

  const thrown: string[] = [];
  page.on('pageerror', (error) => thrown.push(String(error)));

  await page.goto(WARD_PATH, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#bcount')).not.toHaveText(/^—/, { timeout: 30_000 });

  await expect(page.locator('#scoreNum')).toHaveText(expectedScore, { timeout: 30_000 });
  await expect(page.locator('#scoreTxt')).toContainText('pts reachable');
  const chip = page.locator('#scoreConf');
  await expect(chip).not.toHaveAttribute('hidden');
  await expect(chip).toContainText(/up to \d+\.\d pts lower/);

  expect(thrown, `threw:\n${thrown.join('\n')}`).toEqual([]);
});

/**
 * PLANTING TREES RAISES THE SCORE, IN BOTH CITIES.
 *
 * MEASURED ON THE BUILT PAGE, 2026-09-15, before `scenarioLst`: 25 trees took MG
 * Road from 68 to 62 ("−6.6 pts from this plan") and Ballygunge from 50 to 46
 * ("−3.7"). The page swapped the ward's measured satellite LST for the simulator's
 * ward-mean surface temperature the moment a slider moved, and that jump dwarfed any
 * cooling the trees could buy. Kolkata sits in this Bengaluru file because the
 * defect and the fix are one call shared by both cities, and a regression in either
 * is the same regression.
 *
 * THE NO-PLAN SCORE IS PINNED TO THE ENGINE first, as the test above does, so the
 * comparison starts from the number the served inputs really produce, not from
 * whatever the page happened to print.
 */
const TREE_WARDS = [
  { name: 'MG Road', path: WARD_PATH, id: WARD_ID, inputs: 'bengaluru-dc-urs-inputs.json' },
  { name: 'Ballygunge', path: '/heat-map/in/kolkata/ballygunge/', id: 'ballygunge', inputs: 'dc-urs-inputs.json' },
] as const;

/** The plan this test drives, in the shape the slider writes onto `state.iv`. */
const PLAN = { trees: 25, roof: 0, parks: 0, facades: 0 } as const;

/* THE MARGIN IS THE THERMAL HALF, which is the half this test exists to see.
   "> 0" alone proved nothing: the index's OWN gains — fvc, canopy, albedo, refuge
   distance, none of them a temperature — are already positive at +0.12 pts for MG
   Road and +0.48 for Ballygunge, so passing the same params to both sides of
   `scenarioLst`, i.e. no Δ at all, would have sailed through it.

   THE INDEX-ONLY FIGURE QUADRUPLED AT MG ROAD on 2026-09-16 (+0.12 → +0.48) when the
   trees gain stopped being scaled by ward area; a slider is a share of the ward, as
   the heat layers and the cost already had it. The thermal half did not move —
   `scenarioLst` never carried that scaling — so the margin is re-derived from the
   same measured split, not from the total.

   MEASURED on the built page at 13:00 Peak with 25 trees (2026-09-16): both wards
   read "0.9 pts from this plan" against an index-only 0.48, so the LST term is worth
   about 0.42 pts in each. 0.2 sits well under that, and well over the ±0.05 that the
   readout's single decimal place can hide. With the Δ unwired both wards would print
   the index-only 0.5, under the 0.68 this asks for — which is the failure this margin
   exists to force. */
const THERMAL_MARGIN = 0.2;

for (const ward of TREE_WARDS) {
  test(`${ward.name}: planting 25 trees raises the resilience score`, async ({ page }) => {
    test.skip(!RESILIENCE_SCORE_LIVE, WITHDRAWN);
    const raw = JSON.parse(await readFile(
      fileURLToPath(new URL(`../../public/heat-map/data/${ward.inputs}`, import.meta.url)),
      'utf8',
    )) as { wards: Record<string, DcUrsInputs> };
    const inputs = raw.wards[ward.id];
    const baseScore = Math.round(dcUrs(inputs));

    /* THE WARD'S OWN SIDE LENGTH, read from the artefact the page itself fetches
       (`currentWardSizeM = d.sizeM` in heat-map-app.ts), and passed on exactly as the
       page passes it. Since 2026-09-16 only the PARKS gain scales by ward area, so
       this trees-only plan is worth the same over either ward — but reading the real
       figure keeps this test measuring the call the page actually makes, and still
       catches a plan here that grows a parks term. */
    const { sizeM } = JSON.parse(await readFile(
      fileURLToPath(new URL(`../../public/heat-map/data/${ward.id}.json`, import.meta.url)),
      'utf8',
    )) as { sizeM: number };

    /* WHAT THE INDEX ALONE IS WORTH. `applyScenario` with no LST moves fvc, canopy,
       albedo and refuge distance and touches no temperature — so this is the gain the
       page would still print if `scenarioLst` were handed the same params on both
       sides and its Δ collapsed to zero. */
    const indexOnly = dcUrs(applyScenario(inputs, PLAN, undefined, sizeM).inputs) - dcUrs(inputs);

    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));

    await page.goto(ward.path, { waitUntil: 'domcontentloaded' });
    const score = page.locator('#scoreNum');
    const readout = page.locator('#scoreTxt');
    await expect(readout).toContainText('pts reachable', { timeout: 30_000 });
    await expect(score).toHaveText(String(baseScore));

    /* PIN THE PHASE BEFORE THE SLIDER MOVES. The console opens on "Now", whose sun —
       and therefore the plan's thermal Δ, and even which of lstDayC/lstNightC is fed
       — follows whatever wall clock the suite runs at. THERMAL_MARGIN was measured at
       13:00 Peak, so this asks for 13:00 Peak. The no-plan score is phase-independent,
       which is what makes it the settle signal here. */
    const peak = page.locator('#segPhase button[data-p="peak"]');
    await peak.click();
    await expect(peak).toHaveClass(/\bon\b/);
    await expect(score).toHaveText(String(baseScore));

    await page.locator('#ivTrees').fill(String(PLAN.trees));
    await expect(readout).toContainText('from this plan', { timeout: 30_000 });

    const text = (await readout.textContent()) ?? '';
    const gained = text.match(/(-?\d+\.\d) pts from this plan/);
    expect(gained, `no signed "pts from this plan" figure in: ${text}`).not.toBeNull();
    expect(
      Number(gained![1]),
      `${PLAN.trees} trees read "${gained![0]}" at 13:00 peak. The index's own gains are `
      + `worth ${indexOnly.toFixed(2)} pts over this ${sizeM} m ward, so anything below `
      + `${(indexOnly + THERMAL_MARGIN).toFixed(2)} means the measured LST is not being moved `
      + 'by the plan -- scenarioLst\'s Δ has collapsed to zero',
    ).toBeGreaterThanOrEqual(indexOnly + THERMAL_MARGIN);
    expect(Number(await score.textContent())).toBeGreaterThanOrEqual(baseScore);

    expect(thrown, `threw:\n${thrown.join('\n')}`).toEqual([]);
  });
}

/**
 * WHILE THE SCORE IS WITHDRAWN, NEITHER CITY PUBLISHES ONE — NOT EVEN UNDER THE VEIL.
 *
 * A "Coming soon" overlay laid over a number that is still painted underneath would
 * pass any test that only looks for the overlay, and would still publish the score to
 * view-source, to a screen reader and to anyone who removes the veil in devtools. So
 * this asserts the ABSENCE: after the ward has loaded (the moment the old page painted
 * its score) and after a slider has moved (the moment it rewrote the readout), every
 * score field still holds its server-rendered dash.
 *
 * THE INPUTS FILE IS STILL FETCHED, AND THAT IS CORRECT. surface-raster.ts reads the
 * ward's measured greenness and albedo from the same dc-urs-inputs file to build the
 * heat surface — physics, not the score — so asserting "never requested" would demand
 * a change to the temperature field. Measured 2026-09-17: that request fired and every
 * score field still read "—"; the DOM is where a published score would show.
 */
const WITHDRAWN_WARDS = [
  { name: 'Ballygunge', path: '/heat-map/in/kolkata/ballygunge/' },
  { name: 'MG Road', path: WARD_PATH },
] as const;

for (const ward of WITHDRAWN_WARDS) {
  test(`${ward.name}: the resilience score reads "Coming soon" and paints no number`, async ({ page }) => {
    test.skip(RESILIENCE_SCORE_LIVE, 'the score is live; the tests above cover it');

    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));

    await page.goto(ward.path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#bcount')).not.toHaveText(/^—/, { timeout: 30_000 });

    const veil = page.locator('.scorebox .soon');
    await expect(veil).toBeVisible();
    await expect(veil).toContainText(/coming soon/i);
    await expect(page.locator('.scorebox-body')).toHaveAttribute('aria-hidden', 'true');

    /* A slider move is what used to rewrite the readout, so move one, then give the
       stats tick — which painted within a second or two before — ample time to do it. */
    await page.locator('#ivTrees').fill('25');
    await page.waitForTimeout(5_000);

    await expect(page.locator('#scoreNum')).toHaveText('—');
    for (const id of ['sGreen', 'sCool', 'sEff']) await expect(page.locator(`#${id}`)).toHaveText('—');
    await expect(page.locator('#scoreTxt')).not.toContainText(/pts|unavailable/);
    await expect(page.locator('#scoreConf')).toHaveAttribute('hidden', '');
    expect(thrown, `threw:\n${thrown.join('\n')}`).toEqual([]);
  });
}
