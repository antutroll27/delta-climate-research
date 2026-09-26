import { expect, test } from '@playwright/test';

/**
 * COMPARE, OPENED FROM A BENGALURU WARD, COMPARES TWO BENGALURU WARDS.
 *
 * 2026-09-23 audit, item 2. The ward page writes a Compare link carrying only `a`,
 * and the parser used to pair any `a` with a Kolkata ward. From every Bengaluru ward
 * that meant a cross-city pair and "COMPARISON UNAVAILABLE" — reproduced on
 * production from Whitefield. The unit tests pin the parser; this pins the journey a
 * reader takes: the rail link on the ward page, followed, settles.
 */
test('the Compare link on a Bengaluru ward opens a Bengaluru pair that settles', async ({ page }) => {
  test.setTimeout(120_000); // the settle wait below is 60 s; the default 30 s clock would pre-empt it
  await page.goto('/heat-map/in/bengaluru/whitefield/', { waitUntil: 'domcontentloaded' });
  const link = page.locator('a[data-rail="analysis"]');
  await expect(link).toHaveAttribute('href', /a=in%2Fbengaluru%2Fwhitefield/, { timeout: 30_000 });
  const href = await link.getAttribute('href');
  if (!href) throw new Error('the Compare link has no href');
  await page.goto(href, { waitUntil: 'domcontentloaded' });

  const status = page.locator('[data-role="status"]');
  await expect(status).toContainText('Comparison settled', { timeout: 60_000 });
  await expect(status).not.toContainText(/unavailable|invalid/i);
  await expect(page.locator('[data-value="a-name"]').first()).toHaveText('Whitefield');
  await expect(page.locator('[data-value="b-name"]').first()).toHaveText('Indiranagar');
});
