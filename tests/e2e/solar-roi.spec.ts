import { test, expect, type Page } from '@playwright/test';

/* THE PAYBACK SHEET ON THE REAL PAGE. Reached the way solar-pane.spec.ts reaches the
   roof card: no test can reliably click a building on the software renderer, so the
   3D layer is forced first and a ranked row selects the roof. The roof is the FIRST
   ranked row, the biggest in the ward, so a 50 kW size is inside its limit.

   ONE PAGE, ONE WARD LOAD. Booting a ward and forcing the 3D layer is most of this
   spec's cost, so the steps run in order on a page opened once (describe.serial) and
   each step leaves the sheet in the state the next one starts from. */
const BALLYGUNGE = '/heat-map/in/kolkata/ballygunge/';

/* the first whole number in the payback cell: the year, when it is a figure */
const firstYear = async (page: Page) => Number((await page.locator('#spPayback').textContent())?.match(/\d+/)?.[0] ?? NaN);
const setRange = (page: Page, v: string) => page.locator('#spSize').evaluate((e, val) => {
  (e as HTMLInputElement).value = val; e.dispatchEvent(new Event('input', { bubbles: true }));
}, v);
const setNumber = (page: Page, v: string) => page.locator('#spSizeNum').evaluate((e, val) => {
  (e as HTMLInputElement).value = val; e.dispatchEvent(new Event('change', { bubbles: true }));
}, v);
/* IN-PAGE CLICKS AND TYPING. On the software renderer a frame takes about 300 ms, and
   Playwright's actionability checks (visible, stable over two frames, receives events)
   cost 3–8 s per click: measured, most of this spec's wall time. The handlers under
   test are the same either way; what is skipped is the wait, not the event. */
const tap = (page: Page, sel: string) => page.locator(sel).evaluate((e) => (e as HTMLElement).click());
const type = (page: Page, sel: string, v: string) => page.locator(sel).evaluate((e, val) => {
  (e as HTMLInputElement).value = val; e.dispatchEvent(new Event('input', { bubbles: true }));
}, v);

test.describe.serial('the payback sheet', () => {
  /* The default 30 s is a wall, not a budget: booting a ward, forcing the 3D layer and
     easing the camera is tens of seconds (see solar-pane.spec.ts). */
  test.setTimeout(120_000);
  let page: Page;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = testInfo.project.use;
    const ctx = await browser.newContext({ baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, reducedMotion: 'reduce' });
    page = await ctx.newPage();
    await page.addInitScript(() => {
      /* the brief calls window.print(); a real dialogue would hang a headless run */
      window.print = () => {};
      /* a remembered tariff that overflows: the load guard must refuse it (audit fix 2) */
      try { localStorage.setItem('delta:hm-tariff', '1e308'); } catch { /* no storage, nothing to refuse */ }
    });
    await page.goto(BALLYGUNGE);
    await expect(page.locator('#lst')).not.toContainText('—', { timeout: 30_000 });
  });
  test.afterAll(async () => { await page?.context().close(); });

  test('a remembered tariff of 1e308 is refused at load; the ward line states its whole-ward case', async () => {
    await tap(page, '[data-rail="solar"]');
    await expect(page.locator('#solTariff')).toHaveValue('8.00');
    const ward = page.locator('#solPanePay');
    await expect(ward).toBeVisible({ timeout: 15_000 });
    await expect(ward).toContainText(/^Whole-ward estimate: every roof that can take 1 kW or more, at its floor capacity,/);
    await expect(ward).toContainText('no subsidy');
    await expect(ward).toContainText('as if all of it is used');
    await expect(ward).toContainText("per kW, today's prices");
    await expect(ward).toContainText('estimate, not a quote');
    await expect(ward).not.toContainText('Conservative');
  });

  test('opens from the roof card and prints ranges beside their assumptions', async () => {
    await tap(page, '#modechip button[data-m="relief"]');
    await page.waitForTimeout(4_000);
    /* the Solar pane is already open from the ward-line step; clicking its rail again would close it */
    await expect(page.locator('#solList tr')).toHaveCount(10, { timeout: 15_000 });
    await page.locator('#solList tr').first().evaluate((e) => (e as HTMLElement).click());
    await expect(page.locator('#bcPay')).toBeVisible({ timeout: 15_000 });
    /* REAL actions from here on where it matters: an in-page dispatch would bypass
       `inert` and anything covering the sheet, so the open, one click inside and one
       typed field go through Playwright's actionability checks. */
    await page.locator('#bcPay').click();
    await expect(page.locator('#solPay')).toBeVisible();
    await expect(page.locator('#spClose')).toBeFocused();
    await expect(page.locator('#spTag')).toHaveText('screened · estimate, not a quote');
    await expect(page.locator('#spPayback')).toHaveText(/years|Does not pay back/);
    /* a figure is a figure: the default 3 kW home keeps the big-numeral style; only a
       sentence result drops it (the is-words step below is the other half of this) */
    await expect(page.locator('#spPayback')).not.toHaveClass(/is-words/);
    await expect(page.locator('#spSaving')).not.toHaveClass(/is-words/);
    await expect(page.locator('#spAssume')).toContainText('3 kW');
    await expect(page.locator('#spAssume')).toContainText('reference defaults as of Sep 2026');
    await expect(page.locator('#spAssume')).toContainText('if eligible');
    /* a home with no bill: West Bengal pays nothing for surplus, and the sheet says so */
    await expect(page.locator('#spFlat')).toBeVisible();
    await expect(page.locator('#spFlat')).toContainText('Use my bill');
    /* the tariff box says when it refuses */
    await expect(page.locator('#spTariff')).toHaveAttribute('aria-describedby', 'spTariffNote');
    await expect(page.locator('#spTariffNote')).toContainText('Refused unless more than 0');
  });

  test('the slider and the number box are one size, two controls', async () => {
    await setRange(page, '1');
    await expect(page.locator('#spAssume')).toContainText('1 kW');
    await setNumber(page, '50');
    await expect(page.locator('#spSizeOut')).toContainText('50');
    await expect(page.locator('#spAssume')).toContainText('50 kW');
    await setNumber(page, '3');
    await expect(page.locator('#spAssume')).toContainText('· 3 kW ·');
  });

  test('a business pays back no sooner than a home', async () => {
    const home = await firstYear(page);
    await page.locator('input[name="spOwner"][value="business"]').click();
    await expect(page.locator('#spSubsidy')).toHaveText('Business: no subsidy assumed');
    const biz = await firstYear(page);
    if (Number.isFinite(home) && Number.isFinite(biz)) expect(biz).toBeGreaterThanOrEqual(home);
    await tap(page, 'input[name="spOwner"][value="home"]');
    await expect(page.locator('#spSubsidy')).toContainText('Home: assumes');
  });

  test('a bill shows the official size and the units', async () => {
    await page.locator('#spUnits').fill('180');
    await expect(page.locator('#spSizing')).toContainText('2–3 kW');
    await expect(page.locator('#spAssume')).toContainText('180 units a month');
  });

  test('a result that is a sentence, not a figure, wears is-words', async () => {
    /* 50 kW against a 180-unit bill is far more than the household uses, and surplus
       earns nothing in West Bengal: the payback is a sentence, and the big-numeral
       style gives way to the plain one. */
    await setNumber(page, '50');
    await expect(page.locator('#spSizeOut')).toContainText('50');
    await expect(page.locator('#spPayback')).toHaveClass(/is-words/);
  });

  test('a tariff of 1e308 is refused, and no figure prints "∞"', async () => {
    const before = await page.locator('#spPayback').textContent();
    await type(page, '#spTariff', '1e308');
    await expect(page.locator('#spTariff')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#solTariff')).toHaveAttribute('aria-invalid', 'true');
    /* the handlers repaint synchronously, so one read of every figure is the state after the refusal */
    const ids = ['#spPayback', '#spSaving', '#spAssume', '#solPanePay', '#bcSolRs'];
    const texts = await page.evaluate((sel) => sel.map((id) => document.querySelector(id)?.textContent ?? ''), ids);
    expect(texts.every((t) => t.length > 0), `a figure is empty: ${texts.join(' | ')}`).toBe(true);
    for (const [k, t] of texts.entries()) expect(t, ids[k]).not.toMatch(/∞|Infinity/);
    /* refused, so the figures stand on the last good tariff */
    await expect(page.locator('#spPayback')).toHaveText(before ?? '');
    await type(page, '#spTariff', '8');
    await expect(page.locator('#spTariff')).toHaveAttribute('aria-invalid', 'false');
  });

  test('the printed brief carries the payback and its assumptions', async () => {
    await tap(page, '#spPrint');
    await expect(page.locator('#solBrief')).toBeVisible();
    await expect(page.locator('#brPay')).toContainText(/years|Does not pay back/);
    await expect(page.locator('#brPayAssume')).toContainText('estimate, not a quote');
    await tap(page, '#brClose');
    await expect(page.locator('#solBrief')).toBeHidden();
  });

  test('Escape closes the sheet and stops there', async () => {
    await tap(page, '#bcPay');
    await expect(page.locator('#solPay')).toBeVisible();
    /* the roof stays selected and the focus goes back to the button that opened it */
    await page.keyboard.press('Escape');
    await expect(page.locator('#solPay')).toBeHidden();
    await expect(page.locator('#bcPay')).toBeVisible();
    await expect(page.locator('#bcPay')).toBeFocused();
  });
});
