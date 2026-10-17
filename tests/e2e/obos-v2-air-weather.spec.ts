// tests/e2e/obos-v2-air-weather.spec.ts — OBOS v2 spec §4.4, §4.5 [H] (Track B, plan S7.1 and S7.2)
import { expect, test, type Page } from '@playwright/test';
import { cpcbBallygunge, stubAir } from './aqi-cpcb-stub';
import { METAR, openV2, stubWeather } from './obos-v2-helpers';

/** The icon, not the item's centre: in icons mode the centre is clipped away (S2 audit F10). */
const go = (page: Page, section: string): Promise<void> => page.locator(`.nav-item[data-section="${section}"]`).click({ position: { x: 30, y: 22 } });
/** VECC's reports for the four hours the app holds in production (api/metar.ts HOURS = 4), up to 06:00Z on 2026-10-07; only the newest carries rain. */
const FOUR_HOURS = METAR.filter((r) => r.icaoId === 'VECC' && /^METAR VECC 0702|^METAR VECC 0703|^METAR VECC 0704|^METAR VECC 0705|^METAR VECC 0706/.test(r.rawOb))
  .map((r) => ({ icao: r.icaoId, raw: r.rawOb }));
/** a colour as the browser computes it, from any CSS colour expression, probed inside the element it will be used in */
const resolved = (page: Page, sel: string, css: string): Promise<string> => page.locator(sel).first().evaluate((el, c) => {
  const p = document.createElement('span'); p.style.color = c; el.appendChild(p);
  const v = getComputedStyle(p).color; p.remove(); return v;
}, css);

test.describe('@v2 air and weather', () => {
  test.setTimeout(180_000);
  test.beforeEach(({ page }) => { page.setDefaultTimeout(30_000); });

  test('@v2 [H] Air: the painter\'s card and pane, band word beside its colour, CPCB legal-standard line', async ({ page }) => {
    await stubAir(page);
    await openV2(page);
    await go(page, 'air');
    await expect(page.locator('#aqiBlock')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-side-pane="air"] #airPane')).toBeVisible();
    await expect(page.locator('#aqiBlock')).toContainText(/Good|Satisfactory|Moderate|Poor|Very poor|Severe/);
    /* the band word and its colour, side by side: the dot is the official India AQI band colour for the word printed next to it */
    await expect(page.locator('#aqiBlock .cat')).toContainText('Moderate');
    expect(await page.locator('#aqiBlock .cat .dot').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(await resolved(page, '#aqiBlock', 'var(--aq-moderate)'));
    /* the legal-standard sentence lives in the US line's note, opened on demand */
    await expect(page.locator('#aqiBlock .aq-us summary')).toHaveAttribute('title', /legal standard/);
    await expect(page.locator('#aqiBlock .aq-us summary')).toBeVisible();
    await expect(page.locator('#aqiBlock .aq-why summary')).toHaveText('Why do other apps show a different number?');
    await page.locator('#aqiBlock .aq-why summary').click();
    await expect(page.locator('#aqiBlock .aq-why p')).not.toContainText(/wrong|incorrect|inaccurate|higher/i);
    /* the pane: pollutants as CPCB sub-indices, the method note, and the heat model kept out of it */
    await expect(page.locator('#airPane table.pol')).toBeVisible();
    await expect(page.locator('#airPane')).toContainText('does not enter the heat model');
    /* the PM2.5 chart line never borrows a heat colour */
    await go(page, 'overview');
    await expect(page.locator('#aqiBlock')).toBeVisible();          // also on Overview
    await go(page, 'heat');
    await expect(page.locator('#aqiBlock')).toBeHidden();
  });

  test('@v2 [H] Air states: stale says how old and wears no red; the feed quiet >7 days and "too few hours" keep v1\'s sentences', async ({ page }) => {
    const base = cpcbBallygunge(new Date());
    const now = Date.now();
    /* stale: the last reading is 5 h old (past the 2 h live rule) */
    await page.route('**/api/air-quality*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ...base, current: { ...base.current, observed_at: new Date(now - 5 * 3_600_000).toISOString() } }) }));
    await openV2(page);
    await go(page, 'air');
    await expect(page.locator('#aqiBlock .chip.old')).toContainText('Not Live');
    await expect(page.locator('#aqiBlock .chip.old')).toContainText('5 h');
    const bg = await page.locator('#aqiBlock .chip.old').evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(bg, '.chip.old is ink, not the old Swiss red').toBe(await resolved(page, '#aqiBlock', 'var(--ink-1)'));
    expect(bg).not.toBe(await resolved(page, '#aqiBlock', 'var(--aq-very-poor)'));
    await expect(page.locator('#aqiBlock')).toContainText('No update has reached us since.');
    /* the card never says "live" over a stale figure */
    await expect(page.locator('#aqiBlock .chip.live')).toHaveCount(0);
  });

  test('@v2 [H] Air states: not reporting, quiet for more than 7 days, too few hours', async ({ page }) => {
    const base = cpcbBallygunge(new Date());
    const unavailable = (reason: string) => ({ ...base, current: { schema: 2, area_id: base.current.area_id, served_at: base.current.served_at, state: 'unavailable', reason,
      last_observed_at: '2026-10-01T04:00:00.000Z', source: base.current.source, station: base.current.station }, city: undefined });
    let body: unknown = unavailable('station_not_reporting');
    await page.route('**/api/air-quality*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
    await openV2(page);
    await go(page, 'air');
    await expect(page.locator('#aqiBlock')).toContainText('None of the nearby monitors is reporting to CPCB this hour.', { timeout: 60_000 });
    await expect(page.locator('#aqiBlock .chip.off')).toHaveText('No data');
    /* the other two states go through the same paint path: re-read by switching ward and back */
    for (const [reason, say, chip] of [['feed_quiet', 'No readings have reached us from this station for more than 7 days.', 'No data'],
      ['no_valid_aqi', 'Too few recent readings for an official AQI.', 'No AQI']] as const) {
      body = unavailable(reason);
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('obos:open-area', { detail: { key: 'in/kolkata/baruipur' } })));
      await expect(page).toHaveURL(/baruipur/, { timeout: 30_000 });
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('obos:open-area', { detail: { key: 'in/kolkata/ballygunge' } })));
      await expect(page).toHaveURL(/ballygunge/, { timeout: 30_000 });
      await expect(page.locator('#aqiBlock')).toContainText(say, { timeout: 60_000 });
      await expect(page.locator('#aqiBlock .chip.off')).toHaveText(chip);
      await expect(page.locator('#aqiBlock')).toContainText('Last reading');
    }
  });

  test('@v2 [H] Weather: the report decoded, whole degrees, the ward caveat; observed means observed (solid), and says so', async ({ page }) => {
    await stubWeather(page, '2026-10-07T06:05:00Z', FOUR_HOURS);
    await openV2(page);
    await go(page, 'weather');
    await expect(page.locator('[data-wx="where"]')).toHaveText('Dum Dum airport, 16 km from the ward', { timeout: 60_000 });
    await expect(page.locator('[data-wx="t"]')).toHaveText('31');
    /* THE SOURCE RULE: a fresh airport report is OBSERVED, solid; nothing here is outlined */
    await expect(page.locator('[data-v2-card="weather-now"] [data-wx="chip"]')).toHaveText('observed');
    await expect(page.locator('[data-v2-card="weather-now"] [data-wx="chip"]')).toHaveClass(/measured/);
    await expect(page.locator('[data-v2-card="weather-now"] [data-wx-src="observed"]')).toBeVisible();
    await expect(page.locator('[data-v2-card="weather-now"] [data-wx-src="forecast"]')).toBeHidden();
    await page.locator('[data-v2-card="weather-now"] details summary').click();
    await expect(page.locator('[data-wx="decode"]')).toContainText('light rain');
    await expect(page.locator('[data-v2-card="weather-now"]')).toContainText('may differ over the ward');
    /* the rain memory's span is the reports the app holds, never an asserted window */
    await expect(page.locator('[data-wx="rain-cells"] li')).toHaveCount(FOUR_HOURS.length);
    await expect(page.locator('[data-wx="rain-sum"]')).toHaveText(`Rain in 1 of ${FOUR_HOURS.length} reports`);
    await expect(page.locator('[data-wx="rain-h"]')).toContainText('Rain memory · reports since');
    expect(await page.locator('[data-wx="rain-cells"] li.wet').count()).toBe(1);
  });

  test('@v2 [H] Weather: a frozen feed hands over to Met Norway, says so, and wears the FORECAST chip and an outlined mark', async ({ page }) => {
    await stubWeather(page, '2026-10-07T08:05:00Z', FOUR_HOURS);
    await openV2(page);
    await go(page, 'weather');
    await expect(page.locator('[data-wx="where"]')).toHaveText('Met Norway forecast', { timeout: 60_000 });
    await expect(page.locator('[data-wx="when"]')).toHaveText('The newest airport report is older than 90 minutes.');
    const chip = page.locator('[data-v2-card="weather-now"] [data-wx="chip"]');
    await expect(chip).toHaveText('forecast');
    await expect(chip).toHaveClass(/modelled/);
    await expect(chip).not.toHaveClass(/measured/);
    await expect(page.locator('[data-v2-card="weather-now"] [data-wx-src="forecast"]')).toBeVisible();
    await expect(page.locator('[data-v2-card="weather-now"] [data-wx-src="observed"]')).toBeHidden();
    /* the rain card claims no observation either */
    await expect(page.locator('[data-v2-card="rain"] .kind')).not.toHaveText('observed');
    await expect(page.locator('[data-wx="rain-cells"] li')).toHaveCount(0);
  });
});
