import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { dcUrs } from '../../src/scripts/climate-engine/dc-urs.ts';
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
const WARD_ID = 'mg-road';

test('MG Road shows a resilience score and its confidence chip', async ({ page }) => {
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

for (const ward of TREE_WARDS) {
  test(`${ward.name}: planting 25 trees raises the resilience score`, async ({ page }) => {
    const raw = JSON.parse(await readFile(
      fileURLToPath(new URL(`../../public/heat-map/data/${ward.inputs}`, import.meta.url)),
      'utf8',
    )) as { wards: Record<string, DcUrsInputs> };
    const baseScore = Math.round(dcUrs(raw.wards[ward.id]));

    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));

    await page.goto(ward.path, { waitUntil: 'domcontentloaded' });
    const score = page.locator('#scoreNum');
    const readout = page.locator('#scoreTxt');
    await expect(readout).toContainText('pts reachable', { timeout: 30_000 });
    await expect(score).toHaveText(String(baseScore));

    await page.locator('#ivTrees').fill('25');
    await expect(readout).toContainText('from this plan', { timeout: 30_000 });

    const text = (await readout.textContent()) ?? '';
    const gained = text.match(/(-?\d+\.\d) pts from this plan/);
    expect(gained, `no signed "pts from this plan" figure in: ${text}`).not.toBeNull();
    expect(Number(gained![1]), `25 trees read "${gained![0]}"`).toBeGreaterThan(0);
    expect(Number(await score.textContent())).toBeGreaterThanOrEqual(baseScore);

    expect(thrown, `threw:\n${thrown.join('\n')}`).toEqual([]);
  });
}
