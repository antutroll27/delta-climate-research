// tests/e2e/obos-v2-honesty.spec.ts — OBOS v2 spec §5 [H] (plan S3.2 Step 2, S3.3 Step 6).
import { expect, test, type Page } from '@playwright/test';
import { openV2, stubAt, stubWeather, visibleText } from './obos-v2-helpers';

const CARD = '[data-v2-card="temp"]';
const pm = (s: string) => (s.match(/±/g) ?? []).length;
/** the rail icon, not the item centre: in icons mode the rail is clipped to 72 px (S2 audit F10) */
const go = (page: Page, section: string) => page.locator(`.nav-item[data-section="${section}"]`).click({ position: { x: 30, y: 22 } });

/** The phase control is the Explore panel's (S5.1); until it is built it is parked, hidden, with the app's handlers still bound.
    HTMLElement.click() fires them on a hidden node. Once S5.1 lands this becomes a real click (the S5 gate). */
const phase = (page: Page, p: string) => page.locator(`#segPhase button[data-p="${p}"]`).evaluate((b) => (b as HTMLElement).click());

/** H1/H2: the only ± a reader sees is the one applyConfidence wrote on #conf. */
async function singlePm(page: Page): Promise<number> {
  const conf = (await page.locator('#conf').textContent()) ?? '';
  expect(pm(conf)).toBeLessThanOrEqual(1);
  expect(pm(await visibleText(page, '#lst')), '#lst must show no band in v2').toBe(0);
  expect(pm(await visibleText(page, CARD))).toBe(pm(conf));
  return pm(conf);
}

test.describe('@v2 honesty', () => {
  test.setTimeout(180_000);

  test('@v2 [H] rain: outside validation, no ± at all', async ({ page }) => {
    await stubWeather(page, '2026-10-07T06:05:00Z');
    await openV2(page);
    await expect(page.locator('#conf')).toContainText('Outside validation · wet surfaces', { timeout: 60_000 });
    expect(await singlePm(page)).toBe(0);
  });

  test('@v2 [H] night and peak: exactly the band on the chip', async ({ page }) => {
    await stubWeather(page, '2026-10-07T06:05:00Z');
    await openV2(page);
    await phase(page, 'night');
    await expect(page.locator('#conf')).toContainText(/Calibrated · ±\d\.\d °C · n=\d+/, { timeout: 60_000 });
    expect(await singlePm(page)).toBe(1);
    await phase(page, 'peak');
    await expect(page.locator('#conf')).toContainText(/Indicative only · ±\d\.\d °C · n=\d+ · earlier set/, { timeout: 60_000 });
    expect(await singlePm(page)).toBe(1);
    await expect(page.locator('#lstPhase')).toHaveText('modelled at 13:00');
  });

  /* 07:00 IST on 15 Oct is solar ~06:53, inside TRANSITION_HOURS [5, 9.5]. v1 prints "± 4.5" in #lst beside "~±7.5" on #conf here. */
  test('@v2 [H] sunrise window: the ~±7.5 °C at this hour is the ONLY ± (v1 shows two here)', async ({ page }) => {
    await stubAt(page, '2026-10-15T01:30:00Z');
    await openV2(page);
    await expect(page.locator('#conf')).toContainText(/~±7\.5 °C at this hour/, { timeout: 60_000 });
    expect(await singlePm(page)).toBe(1);
    /* the band v1 would have printed still exists in the DOM, hidden (CSS only: no app change) */
    expect(await page.locator('#lst .band').count()).toBe(1);
    await expect(page.locator('#lst .band')).toBeHidden();
  });

  test('@v2 [H] an April night carries the seasonal note under the hero', async ({ page }) => {
    await stubAt(page, '2026-04-15T17:30:00Z');
    await openV2(page);
    await expect(page.locator(`${CARD} #seasonNote`)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#conf')).toContainText('dry-season warm');
  });

  test('@v2 [H] Δ disclosure, surface-not-air lines, the observed air row', async ({ page }) => {
    await stubWeather(page, '2026-10-07T06:05:00Z');
    await openV2(page);
    const disc = page.locator(`${CARD} details.disc`);
    /* the door is always on the page; the sentence is one click, never hover-only */
    await expect(disc.locator('summary')).toBeVisible();
    await expect(disc.locator('summary')).toHaveText(/What the Δ is, and is not/);
    await expect(disc.locator('.body')).toBeHidden();
    await disc.locator('summary').click();
    await expect(disc).toContainText('NOT a measured urban heat island — published Kolkata surface UHI is 0.85–1.5 °C from 1 km satellite data, a different quantity.');
    await expect(disc.locator('.body')).toBeVisible();
    await expect(page.locator(CARD)).toContainText('Ground & rooftop surface');
    await expect(page.locator(CARD)).toContainText('Surface above 40 °C');
    await expect(page.locator('#liveSrc')).toHaveText('Air now · Dum Dum airport (16 km)');
    await expect(page.locator('#liveT')).toHaveText('31');
    await expect(page.locator('#wxLine')).toContainText('may differ over the ward');
  });

  test('@v2 [H] the hero keeps a generous gap above and below it (founder)', async ({ page }) => {
    await stubWeather(page, '2026-10-07T06:05:00Z');
    await openV2(page);
    const row = await page.locator(`${CARD} .surface-k`).evaluate((e) => (e.closest('.row') as HTMLElement).getBoundingClientRect().bottom);
    const lst = await page.locator('#lst').evaluate((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
    const conf = await page.locator('#conf').evaluate((e) => e.getBoundingClientRect().top);
    expect(lst.top - row, 'gap above the hero').toBeGreaterThanOrEqual(16);
    expect(conf - lst.bottom, 'gap below the hero').toBeGreaterThanOrEqual(14);
  });

  test('@v2 [H] the temperature card shows on Overview, Heat and Scenarios only; Heat adds its legend and method cards', async ({ page }) => {
    await stubWeather(page, '2026-10-07T06:05:00Z');
    await openV2(page);
    for (const [s, shown] of [['overview', true], ['heat', true], ['scenarios', true], ['air', false], ['solar', false], ['weather', false], ['methods', false]] as const) {
      await go(page, s);
      await expect(page.locator(CARD)).toBeVisible({ visible: shown });
    }
    await go(page, 'heat');
    await expect(page.locator('#patternNote')).toHaveText(/^Block pattern illustrative · r \d\.\d\d$/);
    await expect(page.locator('[data-v2-card="heat-legend"]')).toContainText('Satellite-checked surface temperature, not air temperature.');
    const method = page.locator('[data-v2-card="method"]');
    await expect(method.locator('summary').first()).toHaveText(/How this was checked/);
    await method.locator('summary').first().click();
    await expect(method).toContainText('ward-scenes of NASA ECOSTRESS');
    await go(page, 'overview');
    await expect(page.locator('[data-v2-card="heat-legend"]')).toBeHidden();
  });
  test('@v2 [H] Sun card: geometry only stays visible and explains itself in the app\'s words; the scale bar is the live one', async ({ page }) => {
    await stubWeather(page, '2026-10-07T06:05:00Z');
    await openV2(page);
    await expect(page.locator('#v2SunCard')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#sunLineNote')).toBeVisible();
    await page.locator('#sunLineNote').click();
    const title = await page.locator('#sunLineNote').getAttribute('title');
    expect(title).toContain('failed its pre-registered night placebo (p = 5.4e-07)');
    await expect(page.locator('[data-sun="note"]')).toHaveText(title!);
    await expect(page.locator('[data-sun="line"]')).toHaveText(/^(\d+° azimuth · sets \d\d:\d\d|rises \d\d:\d\d)$/);
    const box = await page.locator('#sunLineNote').boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(24);
    /* the app's own sentence is what assistive technology reads */
    await expect(page.locator('#sunLineText')).toHaveText(/^sun (\d+° · \d+° up · sets \d\d:\d\d|below horizon · rises \d\d:\d\d)$/);
    /* MapLibre's scale control lives in the card, not on the map */
    await expect(page.locator('#v2SunCard .maplibregl-ctrl-scale')).toHaveCount(1);
    await expect(page.locator('#v2SunCard .maplibregl-ctrl-scale')).toContainText(/\d+\s(m|km)/);
  });

  test('@v2 [H] Sun card at night: "Below horizon" and the rise time, no azimuth claimed', async ({ page }) => {
    await stubAt(page, '2026-10-15T17:30:00Z');          // 23:00 IST, the sun is down
    await openV2(page);
    await expect(page.locator('#v2SunCard')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-sun="big"]')).toHaveText('Below');
    await expect(page.locator('[data-sun="unit"]')).toHaveText('horizon');
    await expect(page.locator('[data-sun="line"]')).toHaveText(/^rises \d\d:\d\d$/);
    await expect(page.locator('[data-sun="az"]')).toBeHidden();
  });
});
