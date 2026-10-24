import { expect, test } from '@playwright/test';

/**
 * A DEVICE WITHOUT WEBGL 2 GETS AN HONEST REFUSAL, NOT A CRASH AND NOT A BLANK PAGE.
 *
 * maplibre-gl 6 removed its WebGL 1 fallback: `new Map` throws GPUInitializationError when
 * the browser cannot make a WebGL 2 context. Before the upgrade such a device (rare, and
 * already without the 3-D city) still got the flat heat field; after it, an uncaught throw
 * out of `mountHeatMap` would have left a dead canvas under a spinner. Headless Chromium
 * (SwiftShader) supports WebGL 2, so nothing else in the suite can see this.
 *
 * The page is forced down the real path: every canvas's `getContext('webgl2')` answers
 * null, and so do the WebGL 1 names, which is exactly what such a browser does.
 */
test('with no WebGL 2, the map says so in the load chip and the page does not throw', async ({ page }) => {
  const thrown: string[] = [];
  page.on('pageerror', (error) => thrown.push(error.message));
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
      return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto('/heat-map/in/kolkata/ballygunge/');

  /* On the map surface, where a reader looks first: the ward card that holds the chip is
     folded away on many viewports, so the notice must not depend on it. */
  const note = page.locator('#mlmap .map-unavailable');
  await expect(note, 'the refusal is on the map surface').toBeVisible({ timeout: 30_000 });
  await expect(note).toContainText('Map unavailable');
  await expect(note, 'it names the actual cause').toContainText('WebGL 2');

  /* And through the v2 failure channel, so anything reading the chip sees the same refusal. */
  const chip = page.locator('#loadchip');
  await expect(chip).toHaveClass(/\bfail\b/);
  await expect(chip).toHaveText(/map is unavailable on this device.*WebGL 2/i);

  /* Not a blank page: the rest of the console is still there to read. */
  await expect(page.locator('main.obos-v2, .obos-v2').first()).toBeVisible();
  expect(thrown, 'mountHeatMap must not throw out of boot').toEqual([]);
});
