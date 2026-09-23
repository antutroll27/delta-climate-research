import { expect, test } from '@playwright/test';

/**
 * A MOUSE WHEEL SCROLLS AN OBOS PANEL.
 *
 * 2026-09-23 audit, item 1. The ward route started Lenis, whose window-level wheel
 * listener calls preventDefault() on every vertical wheel event, so no side panel
 * could be scrolled with a mouse or trackpad. Measured on production: the Solar pane
 * did not move with default motion settings and scrolled 570 px with reduced motion,
 * where Lenis never starts. Map zoom still worked — MapLibre handles its own wheel
 * first — which is why nobody noticed.
 *
 * WHY A REAL WHEEL. tests/e2e/solar-pane.spec.ts sets scrollTop directly, bypassing
 * exactly the event Lenis intercepts. That is how this shipped green.
 *
 * WHY THE LAYERS PANE AT 1280x480. It is light — no solar computation, which is
 * CPU-marginal on CI's two cores — and at this height its tree overflows (measured:
 * 353 px of content in 297 px at 1280x520; a shorter viewport overflows more).
 */
test('a mouse wheel scrolls the Layers pane on a ward page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.goto('/heat-map/in/kolkata/ballygunge/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.maplibregl-map')).toBeVisible({ timeout: 30_000 });

  await page.locator('button[data-rail="layers"]').click();
  const tree = page.locator('.pane[data-pane="layers"] .tree').first();
  await expect(tree).toBeVisible();

  const size = await tree.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  expect(size.scroll, 'precondition: the Layers tree must overflow here, or this test proves nothing')
    .toBeGreaterThan(size.client + 20);

  const box = await tree.boundingBox();
  if (!box) throw new Error('the Layers tree has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(100);
  }
  await expect.poll(() => tree.evaluate((el) => el.scrollTop), { timeout: 5_000 }).toBeGreaterThan(0);
});
