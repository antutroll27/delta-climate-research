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
