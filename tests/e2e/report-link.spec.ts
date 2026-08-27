import { expect, test } from '@playwright/test';

test('the ward-record link is live and follows the ward selection', async ({ page }) => {
  await page.goto('/heat-map/in/kolkata/ballygunge/');
  const link = page.locator('#report-link');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', '/api/wards/ballygunge/metadata.json');

  // switching ward must move the link with it
  await page.locator('#big-barrackpore').click();
  await expect(link).toHaveAttribute('href', '/api/wards/barrackpore/metadata.json');

  // and the target must actually serve a record for that ward
  const res = await page.request.get('/api/wards/barrackpore/metadata.json');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.id).toBe('barrackpore');
  expect(body.quantity.measured).toMatch(/land surface temperature/i);
});
