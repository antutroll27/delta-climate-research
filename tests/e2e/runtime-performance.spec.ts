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
    await expect.poll(() => waterModuleRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
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
