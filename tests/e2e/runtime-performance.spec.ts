import { expect, test, type Page } from '@playwright/test';

async function visitWithMotion(
  page: Page,
  path = '/',
  skipLoader = true,
  waitUntil: 'commit' | 'domcontentloaded' = 'domcontentloaded',
) {
  await page.addInitScript((skip) => {
    if (skip) sessionStorage.setItem('delta:loaded', '1');
    else sessionStorage.removeItem('delta:loaded');
  }, skipLoader);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(path, { waitUntil });
}

test.describe('normal-motion runtime', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the first-session instrument intro releases content promptly', async ({ page }) => {
    // This contract belongs to the DOM loader, not shader compilation. Keep
    // unrelated WebGL startup from distorting its wall-clock behavior in CI.
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args) {
        if (String(args[0]).includes('webgl')) return null;
        return getContext.apply(this, args as never);
      } as typeof getContext;
    });
    // Commit resolves before deferred module scripts, so the test observes the
    // brief loader instead of racing its successful cleanup.
    await visitWithMotion(page, '/', false, 'commit');

    const loader = page.locator('#site-loader');
    await expect(loader).toBeVisible();
    // The source hard-stop is 1.2s. The wider browser allowance absorbs CI
    // scheduling noise while still rejecting the previous roughly 4.1s lock.
    await expect(page.locator('html')).not.toHaveAttribute('data-loader', 'show', { timeout: 3_000 });
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('delta:loaded'))).toBe('1');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden');
    await expect(loader).toHaveCount(0, { timeout: 3_000 });
  });

  test('the About renderer stays deferred until its preload boundary', async ({ page }) => {
    // Same GPU-less-runner problem as the view-transition test below, hitting a
    // different assertion. Both halves of this contract are frame-bound: a
    // window.scrollTo takes ~3 frames to be reflected in scrollY, and the
    // IntersectionObserver that arms the preload can only deliver on a frame
    // boundary after that. Locally the module is requested 56ms after the jump
    // (still 63ms under 4x CPU throttle), but CI renders the About canvas in
    // software at ~0.8 fps, so those four frames alone cost ~5s of the 10s
    // budget and the margin occasionally vanishes. It is intermittent, not
    // deterministic: run 457006b passed this test and failed the other one.
    // Widen the budget rather than weaken the contract — the assertions either
    // side of the boundary are unchanged, so this still fails if the renderer
    // ever loads eagerly.
    test.setTimeout(120_000);

    const waterModuleRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (/objects(?:_|\/)Water|\/Water(?:[._-]|\.js)/i.test(url)) waterModuleRequests.push(url);
    });

    await visitWithMotion(page);
    await page.waitForTimeout(500);
    expect(waterModuleRequests).toHaveLength(0);

    const boundary = await page.locator('#about').evaluate((about) => {
      const top = about.getBoundingClientRect().top + window.scrollY;
      const trigger = top - window.innerHeight * 2;
      return {
        before: Math.max(0, trigger - 32),
        after: Math.max(0, trigger + 32),
      };
    });
    await page.evaluate((y) => window.scrollTo(0, y), boundary.before);
    await page.waitForTimeout(500);
    expect(waterModuleRequests).toHaveLength(0);

    await page.evaluate((y) => window.scrollTo(0, y), boundary.after);
    await expect.poll(() => waterModuleRequests.length, { timeout: 45_000 }).toBeGreaterThan(0);
  });

  test('reduced motion skips the loader and decorative heavy scenes', async ({ page }) => {
    const waterModuleRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (/objects(?:_|\/)Water|\/Water(?:[._-]|\.js)/i.test(url)) waterModuleRequests.push(url);
    });
    await page.addInitScript(() => sessionStorage.removeItem('delta:loaded'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('html')).not.toHaveAttribute('data-loader', 'show');
    await expect(page.locator('#site-loader')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveClass(/reveal-ready/);

    await page.locator('#about').scrollIntoViewIfNeeded();
    await page.locator('footer').scrollIntoViewIfNeeded();
    await page.waitForTimeout(750);

    expect(waterModuleRequests).toHaveLength(0);
    await expect(page.locator('#about')).not.toHaveClass(/field-on/);
    await expect(page.locator('.fcard.left .shader canvas')).toHaveCount(0);
  });

  test('view transitions do not surface runtime errors across repeat navigation', async ({ page }) => {
    // THIS TEST IS LEGITIMATELY SLOW, AND ONLY ON A GPU-LESS RUNNER.
    // It drives two full soft-navigation round trips while the About field is
    // live, which is the point — three.js teardown/recreate across a swap is
    // exactly where a runtime error would surface. CI has no GPU, so that
    // canvas is rasterised by SwiftShader and the page renders at ~0.8 fps
    // (measured from the trace: screencast frames 1.3s apart). Playwright's
    // click waits for the target's box to be unchanged across two consecutive
    // animation frames, so every actionability check costs seconds of
    // wall-clock: one click took 16.4s and passed, the next exceeded the 30s
    // default and failed the suite.
    // The default was never chosen for this work — raise it deliberately
    // rather than trade away the WebGL coverage that makes the test useful.
    // Locally (real frame rates) it still finishes in ~14s.
    test.setTimeout(180_000);

    const runtimeErrors: Error[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error));
    await page.addInitScript(() => {
      const lifecycleWindow = window as Window & {
        __astroLifecycle?: { beforeSwap: number; pageLoad: number };
      };
      lifecycleWindow.__astroLifecycle = { beforeSwap: 0, pageLoad: 0 };
      document.addEventListener('astro:before-swap', () => {
        lifecycleWindow.__astroLifecycle!.beforeSwap += 1;
      });
      document.addEventListener('astro:page-load', () => {
        lifecycleWindow.__astroLifecycle!.pageLoad += 1;
      });
    });

    await visitWithMotion(page);
    await page.locator('#about').scrollIntoViewIfNeeded();
    await expect(page.locator('#about')).toHaveClass(/field-on/, { timeout: 10_000 });

    for (let visit = 0; visit < 2; visit += 1) {
      await page.getByRole('link', { name: 'Our Team' }).first().click();
      await expect(page).toHaveURL(/\/team\/?$/);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      await page.goBack();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.locator('#about').scrollIntoViewIfNeeded();
      await expect(page.locator('#about')).toHaveClass(/field-on/, { timeout: 10_000 });
    }

    const lifecycle = await page.evaluate(() => (
      window as Window & { __astroLifecycle?: { beforeSwap: number; pageLoad: number } }
    ).__astroLifecycle);
    expect(lifecycle?.beforeSwap).toBeGreaterThanOrEqual(4);
    expect(lifecycle?.pageLoad).toBeGreaterThanOrEqual(5);
    expect(runtimeErrors).toEqual([]);
  });
});

test.describe('footer shader runtime', () => {
  test.use({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });

  test('caps its render resolution and suspends while offscreen', async ({ page }) => {
    await visitWithMotion(page);

    const footer = page.locator('footer');
    const shader = page.locator('.fcard.left .shader [data-paper-shader]');
    await footer.scrollIntoViewIfNeeded();
    await expect(shader).toHaveCount(1, { timeout: 10_000 });

    const currentFrame = () => shader.evaluate((element) => {
      const mount = element as HTMLElement & {
        paperShaderMount?: { getCurrentFrame: () => number };
      };
      return mount.paperShaderMount?.getCurrentFrame() ?? 0;
    });

    await expect.poll(currentFrame, { timeout: 10_000 }).toBeGreaterThan(0);
    const resolution = await shader.evaluate((element) => {
      const canvas = element.querySelector('canvas');
      if (!canvas) return null;
      return {
        cssArea: element.clientWidth * element.clientHeight,
        pixelArea: canvas.width * canvas.height,
      };
    });
    expect(resolution).not.toBeNull();
    expect(Math.sqrt(resolution!.pixelArea / resolution!.cssArea)).toBeLessThanOrEqual(1.26);

    await page.locator('#hero-track').scrollIntoViewIfNeeded();
    await expect.poll(() => footer.evaluate((element) => (
      element.getBoundingClientRect().top >= window.innerHeight
    ))).toBe(true);

    // Allow the observer callback and any already-queued frame to settle before
    // recording the stopped clock.
    await page.waitForTimeout(250);
    const stoppedAt = await currentFrame();
    await page.waitForTimeout(500);
    expect(await currentFrame()).toBe(stoppedAt);
  });
});

test.describe('adaptive render quality', () => {
  test.use({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });

  test('low-capability signals lower the footer framebuffer without removing content', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 2 });
      Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 2 });
    });
    await visitWithMotion(page);

    const shader = page.locator('.fcard.left .shader [data-paper-shader]');
    await page.locator('footer').scrollIntoViewIfNeeded();
    await expect(shader).toHaveCount(1, { timeout: 10_000 });

    const resolution = await shader.evaluate((element) => {
      const canvas = element.querySelector('canvas');
      if (!canvas) return null;
      return {
        cssArea: element.clientWidth * element.clientHeight,
        pixelArea: canvas.width * canvas.height,
      };
    });
    expect(resolution).not.toBeNull();
    expect(Math.sqrt(resolution!.pixelArea / resolution!.cssArea)).toBeLessThanOrEqual(1.02);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
