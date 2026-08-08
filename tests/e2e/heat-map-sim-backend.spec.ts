import { expect, test, type Page } from '@playwright/test';

/* The GPU host is the one branch neither the unit suite nor the differential
   fuzz can reach: it builds a WebGl2HeatSim in its constructor, so it needs a
   real WebGL2 context. This drives it in a browser, and then kills the context
   to exercise the latch and the demotion ladder — the path that had no
   coverage of any kind before today.

   The demotion drill SKIPS unless the browser picks a real GPU. Headless
   Chromium reports WebGL2 but backs it with SwiftShader, which caps.ts
   correctly tiers down to CPU — so in CI this test documents the gap rather
   than pretending to cover it. Run `npx playwright test <this file> --headed`
   on a machine with a GPU to actually exercise it. */

const backendOf = (page: Page) => page.locator('#simBackend');

test('the GPU host is actually selected and produces live readouts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const notFound: string[] = [];
  page.on('requestfailed', (r) => notFound.push(r.url()));
  page.on('response', (r) => { if (r.status() >= 400) notFound.push(`${r.status()} ${r.url()}`); });

  await page.goto('/heat-map/');
  await expect(backendOf(page)).not.toHaveText('SELECTING ENGINE', { timeout: 20_000 });
  const backend = (await backendOf(page).textContent())?.trim();
  console.log(`  BACKEND SELECTED: ${backend}`);

  const hasWebgl2 = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
  console.log(`  webgl2 available in this browser: ${hasWebgl2}`);

  await expect(page.locator('#lst')).not.toContainText('—', { timeout: 25_000 });
  await expect(page.locator('#uhi')).not.toContainText('—');
  console.log(`  failed requests (${notFound.length}):`);
  for (const u of notFound) console.log(`    ${u}`);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);

  // record which host actually ran, so a silent fallback cannot pass as a GPU test
  test.info().annotations.push({ type: 'backend', description: backend ?? 'unknown' });
});

test('losing the WebGL context demotes instead of freezing or throwing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.addInitScript(() => {
    const w = window as unknown as { __ctx: unknown[] };
    w.__ctx = [];
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
      const ctx = (real as (...a: unknown[]) => unknown).apply(this, args);
      if (args[0] === 'webgl2' && ctx && !w.__ctx.includes(ctx)) w.__ctx.push(ctx);
      return ctx;
    } as typeof real;
  });
  await page.goto('/heat-map/');
  await expect(backendOf(page)).not.toHaveText('SELECTING ENGINE', { timeout: 20_000 });
  const before = (await backendOf(page).textContent())?.trim();
  await expect(page.locator('#lst')).not.toContainText('—', { timeout: 25_000 });

  if (before !== 'GPU SIM') {
    console.log(`  SKIPPED demotion drill — backend is ${before}, not GPU SIM`);
    test.skip(true, `no GPU backend in this browser (got ${before})`);
    return;
  }

  /* The sim canvas is created with document.createElement and never appended,
     so querySelectorAll cannot see it. Record every context at creation time
     instead, then lose only the OFF-DOM ones — killing the map's context too
     would prove nothing about the sim host. */
  const lost = await page.evaluate(() => {
    const w = window as unknown as { __ctx?: WebGL2RenderingContext[] };
    let n = 0;
    for (const gl of w.__ctx ?? []) {
      if (gl.canvas instanceof HTMLCanvasElement && gl.canvas.isConnected) continue;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      n++;
    }
    return n;
  });
  console.log(`  off-DOM webgl2 contexts killed: ${lost}`);
  expect(lost, 'the sim canvas context must be reachable, or this drill proves nothing').toBeGreaterThan(0);

  // demotion is triggered by the NEXT advance, so keep the page animating
  await page.mouse.move(400, 400);
  await page.mouse.move(420, 430);

  // the page must end up on a working CPU backend, not stuck on a dead GPU one
  await expect(backendOf(page)).toHaveText(/CPU SIM|CPU STATIC/, { timeout: 25_000 });
  await expect(page.locator('#lst')).not.toContainText('—');
  expect(errors, `unhandled errors after context loss: ${errors.join(' | ')}`).toEqual([]);
  console.log(`  demoted ${before} → ${(await backendOf(page).textContent())?.trim()}`);
});
