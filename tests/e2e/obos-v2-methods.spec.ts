// tests/e2e/obos-v2-methods.spec.ts — OBOS v2 spec §4.9 [H] (Track B, plan S7.3)
import { expect, test, type Page } from '@playwright/test';
import { openV2 } from './obos-v2-helpers';

const go = (page: Page, section: string): Promise<void> => page.locator(`.nav-item[data-section="${section}"]`).click({ position: { x: 30, y: 22 } });

test.describe('@v2 data and methods', () => {
  test.setTimeout(180_000);
  test.beforeEach(({ page }) => { page.setDefaultTimeout(30_000); });

  test('@v2 [H] receipts open; the ward record follows an in-place switch; licences are links; the ward brief is one click away', async ({ page }) => {
    await openV2(page);
    await go(page, 'methods');
    await page.locator('#srcBtn').click();
    await expect(page.locator('#srcPanel')).toBeVisible();
    await expect(page.locator('#srcPanel')).toContainText(/OpenStreetMap|Provenance manifest unavailable\./);
    await expect(page.locator('#report-link')).toHaveAttribute('href', '/api/wards/ballygunge/metadata.json');
    await expect(page.locator('#report-link')).toHaveAttribute('download', '');
    await expect(page.locator('[data-v2-for="in/kolkata/ballygunge"][data-v2-record]')).toBeVisible();
    /* the figures are the record's: 0.93 km² and 2,207 of 7,931 are the Ward 68 record, read at build */
    await expect(page.locator('[data-v2-for="in/kolkata/ballygunge"][data-v2-record]')).toContainText('km²');
    await expect(page.locator('[data-v2-card="how-sure"]')).toContainText('±3.0 °C');
    await expect(page.locator('[data-v2-card="how-sure"]')).not.toContainText(/validated/i);
    /* S8 (item 5): the ledger prints TWO accuracy bands, the night one and the 13:00 peak one, each NAMED by its phase: they are method figures (two validation sets), not a
       reading. No other ± is anywhere on the page, the receipts panel (open) and the ward record included. */
    const ledger = await page.locator('[data-v2-card="how-sure"] li').evaluateAll((els) => els.filter((e) => /±/.test(e.textContent ?? ''))
      .map((e) => [e.querySelector('.micro')?.textContent?.trim(), ((e.textContent ?? '').match(/±/g) ?? []).length]));
    expect(ledger, 'each ± line of the ledger names its phase, once').toEqual([['Night', 1], ['13:00 peak', 1]]);
    expect(await page.evaluate(() => ((document.body.innerText).match(/±/g) ?? []).length), 'no ± on the Data & methods page but the ledger\'s two').toBe(2);
    await expect(page.locator('[data-v2-card="how-sure"] li:has(.micro:text-is("Night"))')).toContainText(/±3\.0 °C/);
    await expect(page.locator('[data-v2-card="how-sure"] li:has(.micro:text-is("13:00 peak"))')).toContainText(/±4\.5 °C/);
    /* B-S7 audit F1: the brief opens THIS ward (the app's own Compare query, with /brief/ for /compare/), not the default pair */
    const brief = page.getByRole('link', { name: 'Open the ward brief →' });
    await expect(brief).toHaveAttribute('href', /^\/heat-map\/brief\/\?.*\ba=ballygunge\b/);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('obos:open-area', { detail: { key: 'in/kolkata/baruipur' } })));
    await expect(page.locator('#report-link')).toHaveAttribute('href', '/api/wards/baruipur/metadata.json', { timeout: 30_000 });
    await expect(page.locator('[data-v2-for="in/kolkata/baruipur"][data-v2-record]')).toBeVisible();
    await expect(page.locator('[data-v2-for="in/kolkata/ballygunge"][data-v2-record]')).toBeHidden();
    await expect(brief).toHaveAttribute('href', /^\/heat-map\/brief\/\?.*\ba=baruipur\b/);
    const links = await page.locator('[data-v2-card="licences"] a').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    expect(links.length).toBeGreaterThan(3);
    for (const h of links) expect(h).toMatch(/^https:\/\//);
  });

  test('@v2 [H] the ward record JSON downloads and is the record the page printed', async ({ page }) => {
    await openV2(page);
    await go(page, 'methods');
    const href = await page.locator('#report-link').getAttribute('href');
    const res = await page.request.get(href as string);
    expect(res.ok()).toBe(true);
    const rec = await res.json() as { status: string; id: string; boundary: { areaM2: number; buildingsInWard: number } | null; confidence: { night: { bandK: number } } };
    expect(rec.status).toBe('prototype');
    expect(rec.id).toBe('ballygunge');
    const card = page.locator('[data-v2-for="in/kolkata/ballygunge"][data-v2-record]');
    await expect(card).toContainText((rec.boundary!.areaM2 / 1e6).toFixed(2));
    await expect(card).toContainText(rec.boundary!.buildingsInWard.toLocaleString('en-GB'));
    await expect(page.locator('[data-v2-card="how-sure"]')).toContainText(`±${rec.confidence.night.bandK.toFixed(1)} °C`);
  });
});
