import { test, expect, type Page } from '@playwright/test';

/* THE PAYBACK SHEET ON THE REAL PAGE. Reached the way solar-pane.spec.ts reaches the
   roof card: no test can reliably click a building on the software renderer, so the
   3D layer is forced first and a ranked row selects the roof. The roof is the FIRST
   ranked row, the biggest in the ward, so a 50 kW size is inside its limit. */
const BALLYGUNGE = '/heat-map/in/kolkata/ballygunge/';

async function boot(page: Page) {
  await page.goto(BALLYGUNGE);
  await expect(page.locator('#lst')).not.toContainText('—', { timeout: 30_000 });
}
async function openRoof(page: Page) {
  await page.locator('#modechip button[data-m="relief"]').click();
  await page.waitForTimeout(4_000);
  await page.locator('[data-rail="solar"]').click();
  await expect(page.locator('#solList tr')).toHaveCount(10, { timeout: 15_000 });
  await page.locator('#solList tr').first().click();
  await expect(page.locator('#bcPay')).toBeVisible({ timeout: 15_000 });
}
/* the first whole number in the payback cell: the year, when it is a figure */
const firstYear = async (page: Page) => Number((await page.locator('#spPayback').textContent())?.match(/\d+/)?.[0] ?? NaN);
const setRange = (page: Page, v: string) => page.locator('#spSize').evaluate((e, val) => {
  (e as HTMLInputElement).value = val; e.dispatchEvent(new Event('input', { bubbles: true }));
}, v);
const setNumber = (page: Page, v: string) => page.locator('#spSizeNum').evaluate((e, val) => {
  (e as HTMLInputElement).value = val; e.dispatchEvent(new Event('change', { bubbles: true }));
}, v);

test.describe('the payback sheet', () => {
  /* The default 30 s is a wall, not a budget: booting a ward, forcing the 3D layer and
     easing the camera is tens of seconds (see solar-pane.spec.ts). */
  test.setTimeout(120_000);
  /* A test that must stub window.print BEFORE the page loads boots itself and is tagged
     @own-boot; booting it here first would cost a whole extra ward load. */
  test.beforeEach(async ({ page }, testInfo) => {
    if (testInfo.tags.includes('@own-boot')) return;
    await boot(page);
  });

  test('opens from the roof card, prints ranges beside their assumptions, and closes with Escape', async ({ page }) => {
    await openRoof(page);
    await page.locator('#bcPay').click();
    await expect(page.locator('#solPay')).toBeVisible();
    await expect(page.locator('#spTag')).toHaveText('screened · estimate, not a quote');
    await expect(page.locator('#spPayback')).toHaveText(/years|Does not pay back/);
    /* a figure is a figure: the default 3 kW home keeps the big-numeral style; only a
       sentence result drops it (the is-words test below is the other half of this) */
    await expect(page.locator('#spPayback')).not.toHaveClass(/is-words/);
    await expect(page.locator('#spSaving')).not.toHaveClass(/is-words/);
    await expect(page.locator('#spAssume')).toContainText('3 kW');
    await expect(page.locator('#spAssume')).toContainText('reference defaults as of Sep 2026');
    /* a home with no bill: West Bengal pays nothing for surplus, and the sheet says so */
    await expect(page.locator('#spFlat')).toBeVisible();
    await expect(page.locator('#spFlat')).toContainText('Use my bill');

    /* the slider and the number box are one size, two controls */
    await setRange(page, '1');
    await expect(page.locator('#spAssume')).toContainText('1 kW');
    await setNumber(page, '50');
    await expect(page.locator('#spSizeOut')).toContainText('50');
    await expect(page.locator('#spAssume')).toContainText('50 kW');

    /* Escape closes the sheet and stops there: the roof stays selected and the focus
       goes back to the button that opened it. */
    await page.keyboard.press('Escape');
    await expect(page.locator('#solPay')).toBeHidden();
    await expect(page.locator('#bcPay')).toBeVisible();
    await expect(page.locator('#bcPay')).toBeFocused();
  });

  test('a business pays back no sooner than a home; a bill shows the official size and the lapsing surplus', async ({ page }) => {
    await openRoof(page);
    await page.locator('#bcPay').click();
    const home = await firstYear(page);
    await page.locator('input[name="spOwner"][value="business"]').check();
    await expect(page.locator('#spSubsidy')).toHaveText('Business: no subsidy assumed');
    const biz = await firstYear(page);
    if (Number.isFinite(home) && Number.isFinite(biz)) expect(biz).toBeGreaterThanOrEqual(home);
    await page.locator('input[name="spOwner"][value="home"]').check();
    await page.locator('#spUnits').fill('180');
    await expect(page.locator('#spSizing')).toContainText('2–3 kW');
    await expect(page.locator('#spAssume')).toContainText('180 units a month');
  });

  test('a result that is a sentence, not a figure, wears is-words', async ({ page }) => {
    await openRoof(page);
    await page.locator('#bcPay').click();
    /* 50 kW against a 180-unit bill is far more than the household uses, and surplus
       earns nothing in West Bengal: the payback is a sentence, and the big-numeral
       style gives way to the plain one. */
    await page.locator('#spUnits').fill('180');
    await setNumber(page, '50');
    await expect(page.locator('#spSizeOut')).toContainText('50');
    await expect(page.locator('#spPayback')).toHaveClass(/is-words/);
  });

  test('the printed brief carries the payback and its assumptions', { tag: '@own-boot' }, async ({ page }) => {
    await page.addInitScript(() => { window.print = () => {}; });
    await boot(page);
    await openRoof(page);
    await page.locator('#bcPay').click();
    await page.locator('#spPrint').click();
    await expect(page.locator('#solBrief')).toBeVisible();
    await expect(page.locator('#brPay')).toContainText(/years|Does not pay back/);
    await expect(page.locator('#brPayAssume')).toContainText('estimate, not a quote');
  });

  test('the ward line states the conservative case', async ({ page }) => {
    await page.locator('[data-rail="solar"]').click();
    await expect(page.locator('#solPanePay')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#solPanePay')).toContainText(/^Conservative city case:/);
    await expect(page.locator('#solPanePay')).toContainText('no subsidy');
    await expect(page.locator('#solPanePay')).toContainText('estimate, not a quote');
  });
});
