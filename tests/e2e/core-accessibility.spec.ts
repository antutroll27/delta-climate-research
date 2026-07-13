import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.use({
  viewport: { width: 390, height: 844 },
});

async function visit(page: Page, path: string) {
  await page.addInitScript(() => sessionStorage.setItem('delta:loaded', '1'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
  await expect(page.locator('#site-loader')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveClass(/reveal-ready/);
}

async function contrastRatio(page: Page, foreground: string, background: string) {
  return page.evaluate(({ foreground, background }) => {
    const parse = (value: string) => {
      const channels = value.match(/-?\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
      if (!channels || channels.length !== 3) throw new Error(`Expected an RGB color, received ${value}`);
      if (value.startsWith('oklab(') || value.startsWith('oklch(')) {
        const [lightness, second, third] = channels;
        const [a, b] = value.startsWith('oklch(')
          ? [second * Math.cos((third * Math.PI) / 180), second * Math.sin((third * Math.PI) / 180)]
          : [second, third];
        const l = Math.pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3);
        const m = Math.pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3);
        const s = Math.pow(lightness - 0.0894841775 * a - 1.291485548 * b, 3);
        return [
          4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
          -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
          -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
        ];
      }
      return channels.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : Math.pow((normalized + 0.055) / 1.055, 2.4);
      });
    };
    const luminance = (value: string) => {
      const [r, g, b] = parse(getComputedStyle(document.querySelector(value)!).color);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const backgroundColor = getComputedStyle(document.querySelector(background)!).backgroundColor;
    const [r, g, b] = parse(backgroundColor);
    const backgroundLuminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const foregroundLuminance = luminance(foreground);
    return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
      / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
  }, { foreground, background });
}

test('the homepage keeps its primary heading ahead of supporting facts', async ({ page }) => {
  await visit(page, '/');

  const outline = await page.locator('main h1, main h2').evaluateAll((headings) =>
    headings.map((heading) => ({ level: heading.tagName, text: heading.textContent?.trim() }))
  );

  expect(outline[0]?.level).toBe('H1');
  expect(outline[0]?.text).toContain('Navigating');
  expect(outline.findIndex((heading) => heading.text === 'Signals behind the descent')).toBeGreaterThan(0);
});

test('the mobile menu opens, closes with Escape, and returns focus to its trigger', async ({ page }) => {
  await visit(page, '/');

  const toggle = page.locator('[data-navigation-toggle]');
  const menu = page.locator('#mobile-menu');
  await expect(menu).toHaveAttribute('hidden', '');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAttribute('aria-label', 'Close menu');
  await expect(menu).not.toHaveAttribute('hidden', '');
  await expect(menu.getByRole('link', { name: 'About', exact: true })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('hidden', '');
  await expect(toggle).toBeFocused();
});

test('the team profile sheet closes with Escape and restores its trigger focus', async ({ page }) => {
  await visit(page, '/team/');

  const trigger = page.getByRole('button', { name: /Open profile.*Angad Burman/ });
  const sheet = page.locator('#team-sheet');
  await trigger.click();

  await expect(sheet).toHaveAttribute('aria-hidden', 'false');
  await expect(sheet.getByRole('button', { name: 'Close profile' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(sheet).toHaveAttribute('aria-hidden', 'true');
  await expect(trigger).toBeFocused();
});

test('footer and roster text retain AA contrast at rest', async ({ page }) => {
  await visit(page, '/');

  for (const selector of ['.col-title', '.copyright', '.cta-copy']) {
    const ratio = await contrastRatio(page, selector, '.fcard.right');
    expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
  }

  await visit(page, '/team/');
  await page.mouse.move(0, 0);
  for (const selector of ['.t-tier', '.t-disc', '.t-name', '.t-name .last']) {
    const ratio = await contrastRatio(page, selector, 'body');
    expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
  }
});

test.describe('desktop roster hover', () => {
  test.use({ viewport: { width: 1280, height: 900 }, hasTouch: false, isMobile: false });

  test('uses AA text colors when its bronze hover fill is active', async ({ page }) => {
    await visit(page, '/team/');
    await expect(page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)).resolves.toBe(true);

    const firstRow = page.locator('button[data-open="0"]');
    await firstRow.scrollIntoViewIfNeeded();
    await firstRow.hover();
    await page.waitForTimeout(600);
    for (const selector of ['button[data-open="0"] .t-tier', 'button[data-open="0"] .t-disc', 'button[data-open="0"] .t-name', 'button[data-open="0"] .t-name .last']) {
      const ratio = await contrastRatio(page, selector, 'button[data-open="0"] .trow-fill');
      expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
    }
  });
});

test('the homepage has no automated WCAG A, AA, or 2.2 AA violations', async ({ page }) => {
  await visit(page, '/');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();

  expect(results.violations).toEqual([]);
});

test('the team page has no automated WCAG A, AA, or 2.2 AA violations', async ({ page }) => {
  await visit(page, '/team/');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    // The roster's clipping reveal leaves a fully hidden bronze layer in the
    // accessibility tree. Axe cannot model that clip-path state, so its
    // contrast is asserted explicitly above in both visual states.
    .disableRules(['color-contrast'])
    .analyze();

  expect(results.violations).toEqual([]);
});
