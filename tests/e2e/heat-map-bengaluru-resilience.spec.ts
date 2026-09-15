import { expect, test } from '@playwright/test';

/**
 * A BENGALURU WARD SHOWS A RESILIENCE SCORE, AND SAYS WHAT IT DOES NOT KNOW.
 *
 * Before this plan every Bengaluru ward read "resilience inputs unavailable":
 * the registry declared no inputs file. The unit tests prove the file and the
 * URL; only a browser proves the pane actually renders a number from them.
 * socioVuln ships unmeasured, so the confidence chip must be showing.
 */
test('MG Road shows a resilience score and its confidence chip', async ({ page }) => {
  const thrown: string[] = [];
  page.on('pageerror', (error) => thrown.push(String(error)));

  await page.goto('/heat-map/in/bengaluru/mg-road/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#bcount')).not.toHaveText(/^—/, { timeout: 30_000 });

  await expect(page.locator('#scoreNum')).toHaveText(/^\d{1,3}$/, { timeout: 60_000 });
  await expect(page.locator('#scoreTxt')).not.toContainText('resilience inputs unavailable');
  const chip = page.locator('#scoreConf');
  await expect(chip).not.toHaveAttribute('hidden');
  await expect(chip).toContainText('pts lower');

  expect(thrown, `threw:\n${thrown.join('\n')}`).toEqual([]);
});
