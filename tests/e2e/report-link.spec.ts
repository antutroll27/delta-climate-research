import { expect, test } from '@playwright/test';

test('the ward-record link is live and follows the ward selection', async ({ page }) => {
  await page.goto('/heat-map/in/kolkata/ballygunge/');
  /* THE LINK MOVED, and this is where it moved to. It used to end the evidence
     card in the right-hand rail, permanently on screen under a histogram; it is
     now the whole content of the rail's Reports pane. So reaching it is two
     clicks' worth of console rather than none, and the test opens the pane rather
     than dropping the visibility assertion — a link that renders but cannot be
     REACHED is exactly what this test exists to catch, and "it is in the DOM"
     would not have caught it. */
  await page.locator('[data-rail="reports"]').click();
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
