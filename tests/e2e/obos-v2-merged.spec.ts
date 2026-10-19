// tests/e2e/obos-v2-merged.spec.ts — OBOS v2 integration: what only a MERGE can break (three tracks written apart).
// Added by the integration session after Track A joined B and C. Each test reads the whole page, not one track's card.
import { expect, test, type Page } from '@playwright/test';
import { openV2, stubWeather } from './obos-v2-helpers';

const BALLYGUNGE = '/heat-map/in/kolkata/ballygunge/';
const ICON = { position: { x: 30, y: 22 } };       // the rail icon: the item's centre is clipped away in icons mode (S2 audit F10)
const pm = (s: string): number => (s.match(/±/g) ?? []).length;
const open = (page: Page, section: string): Promise<void> => page.locator(`.nav-item[data-section="${section}"]`).click(ICON);

test.describe('@v2 merged', () => {
  test.setTimeout(240_000);

  test('@v2 one ± on the whole PAGE on every screen: Overview, Heat, Scenarios (Explore hero), Air, Solar, Weather, Data & methods', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await stubWeather(page, '2026-10-07T06:05:00Z');
    await openV2(page, BALLYGUNGE);
    await page.locator('#segPhase button[data-p="night"]').click();            // the validated band: the chip carries one ±
    await expect(page.locator('#conf')).toContainText(/±\d\.\d/, { timeout: 60_000 });
    const conf = pm((await page.locator('#conf').textContent()) ?? '');
    expect(conf, 'the app writes exactly one ± on the chip').toBe(1);
    const seen: Record<string, number> = {};
    for (const s of ['overview', 'heat', 'air', 'solar', 'weather', 'scenarios', 'methods']) {
      const item = page.locator(`.nav-item[data-section="${s}"]`);
      if ((await item.getAttribute('aria-current')) !== 'true') await item.click(ICON);
      await expect(page.locator('main.obos-v2')).toHaveAttribute('data-section', s);
      await page.waitForTimeout(400);
      seen[s] = pm(await page.locator('body').innerText());
    }
    for (const s of ['overview', 'heat', 'scenarios']) expect(seen[s], `${s}: the card with the chip is on this screen: its one ±`).toBe(1);
    for (const s of ['air', 'solar', 'weather']) expect(seen[s], `${s}: never more than one ± on the page (${JSON.stringify(seen)})`).toBeLessThanOrEqual(1);
    /* Data & methods is the accuracy LEDGER (Track B, MethodsCards "How sure"): the night and the 13:00 bands, each named, from accuracy.ts. It is a record of two
       validation sets, not a reading, so two labelled bands live there; the test pins that they are the ledger's and no third ± is anywhere else on the screen. */
    expect(seen.methods, 'the ledger prints the night and the peak band, and nothing else on the screen carries a ±').toBe(2);
    expect(await page.locator('[data-v2-card="how-sure"]').evaluate((e) => ((e as HTMLElement).innerText.match(/±/g) ?? []).length)).toBe(2);
  });

  test('@v2 each solar floor sits beside its own headline: the building card (shading + strict floor; capacity + its floor) and the ward card', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openV2(page, `${BALLYGUNGE}?lab=1`);
    await open(page, 'solar');
    const row = page.locator('#solList tr[data-idx]').first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    /* the ward card (Track B): the capacity headline, its range beside it; the strict floor only inside the sentence that states the shading it bounds */
    await expect(page.locator('#solPaneBlock')).toBeVisible();
    await expect(page.locator('#solPaneKwp')).toContainText('MWp');
    await expect(page.locator('#solPaneConf'), 'the capacity interval is the capacity floor').toContainText(/\d+\.\d–\d+\.\d MWp/);
    await expect(page.locator('#solPaneConf')).not.toContainText('strict');
    await expect(page.locator('#solPaneFloor'), 'the strict floor is always printed with the shading figure it bounds').toHaveText(/takes \d+\.\d% of the yield, at least \d+\.\d% under a strict roof mask\./);
    expect(await page.locator('#solPaneKwp').evaluate((e) => /strict/i.test(e.textContent ?? '')), 'never inside the capacity headline').toBe(false);
    /* the building card (Track A) */
    await row.click();
    await expect(page.locator('#bcSolKwp')).toBeVisible();
    await expect(page.locator('#bcSolKwp small'), 'the capacity floor is printed with the capacity headline').toContainText('floor');
    const same = await page.evaluate(() => {
      const loss = document.getElementById('bcSolLoss'), floor = document.getElementById('bcSolFloor'), kwp = document.getElementById('bcSolKwp');
      if (!loss || !floor || !kwp) return null;
      const rowOf = (e: Element): Element | null => e.closest('.interval') ?? e.parentElement;
      return { lossFloor: rowOf(loss) === rowOf(floor), kwpFloor: rowOf(kwp) === rowOf(floor), floorText: floor.textContent ?? '' };
    });
    expect(same?.lossFloor, 'the strict floor shares a row with the SHADING loss').toBe(true);
    expect(same?.kwpFloor, 'and is never in the capacity headline\'s row').toBe(false);
    expect(same?.floorText).toContain('strict roof mask');
    await expect(page.locator('#bcard')).toBeVisible();
  });

  test('@v2 print: the area prints only the installer brief (cold: nothing of the chrome or the cards); the solar brief prints alone', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => { window.print = () => undefined; });
    await openV2(page, `${BALLYGUNGE}?lab=1`);
    const stray = (): Promise<string[]> => page.evaluate(() => {
      const root = document.querySelector('main.obos-v2')!, brief = document.getElementById('solBrief');
      const out: string[] = [];
      for (const el of root.querySelectorAll<HTMLElement>('*')) {
        if (brief && (brief.contains(el) || el.contains(brief))) continue;
        const cs = getComputedStyle(el), r = el.getBoundingClientRect();
        if (cs.display === 'none' || cs.visibility === 'hidden' || r.width * r.height === 0) continue;
        if (el.closest('[hidden], svg, template')) continue;
        if (!(el.textContent ?? '').trim() && !el.querySelector('canvas, img')) continue;
        out.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${[...el.classList].join('.')}`);
      }
      return out.slice(0, 12);
    });
    await page.emulateMedia({ media: 'print' });
    expect(await stray(), 'cold print: nothing visible in the v2 root (v1 does the same: the brief opens by script before window.print)').toEqual([]);
    await page.emulateMedia({ media: 'screen' });
    /* open the brief the way the reader does: ranked roof -> payback sheet -> Print brief */
    await open(page, 'solar');
    for (const r of await page.locator('#solList tr[data-idx]').all()) { await r.click(); if (await page.locator('#bcPay').isVisible()) break; }
    await page.locator('#bcPay').click();
    await page.locator('#spPrint').click();
    await expect(page.locator('#solBrief')).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    expect(await stray(), 'with the brief open: the brief alone').toEqual([]);
    await expect(page.locator('#solBrief')).toBeVisible();
    await expect(page.locator('#brClose')).toBeHidden();
  });

  test('@v2 print: the paired brief prints its sheet and issuer, and none of the chrome; Compare is not blanked by the solar rule', async ({ page }) => {
    await openV2(page, '/heat-map/brief/?a=ballygunge&b=baruipur&trees=40');
    await expect(page.locator('main.obos-v2[data-brief-root]')).toHaveAttribute('aria-busy', 'false', { timeout: 120_000 });
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.brf-sheet')).toBeVisible();
    await expect(page.locator('.brf-org')).toBeVisible();
    for (const sel of ['nav.rail', '.toolbar', '#v2Key', '.brf-acts']) await expect(page.locator(sel), sel).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await openV2(page, '/heat-map/compare/?a=ballygunge&b=baruipur');
    await expect(page.locator('main.obos-v2[data-compare-root]')).toHaveAttribute('aria-busy', 'false', { timeout: 120_000 });
    await page.emulateMedia({ media: 'print' });
    expect(await page.locator('main.obos-v2[data-compare-root]').evaluate((e) => getComputedStyle(e).display), 'Compare keeps its page in print').not.toBe('none');
    await expect(page.locator('.heat-compare__stage, [data-compare-root] canvas, [data-compare-root] h1').first()).toBeVisible();
    /* FINAL audit F3: Compare prints as a flowing document, not a screen grab. No menu, no toolbar, no popovers; the workspace, the maps and the
       evidence are in the flow (static), each in its own band, none on top of another. */
    for (const sel of ['nav.rail', '.tw-menu', '.toolbar', '#v2Key', '#v2Credits', '.st-attrib']) await expect(page.locator(sel), `${sel} is not printed`).toBeHidden();
    for (const sel of ['.side-panel', '.cmp-stage', '.cmp-col']) {
      expect(await page.locator(sel).first().evaluate((e) => getComputedStyle(e).position), `${sel} flows`).toBe('static');
    }
    const bands = await page.evaluate(() => ['.side-panel', '.cmp-stage', '.cmp-col'].map((s) => {
      const r = document.querySelector(s)!.getBoundingClientRect(); return { s, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    }));
    for (let i = 1; i < bands.length; i++) expect(bands[i].top, `${bands[i].s} starts below ${bands[i - 1].s}`).toBeGreaterThanOrEqual(bands[i - 1].bottom - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'nothing is cut at the right edge').toBe(true);
    expect(bands.every((b) => b.left >= 0), 'nothing is cut at the left edge').toBe(true);
    /* and the PDF is more than one page of the evidence, not one clipped screen */
    const pdf = await page.pdf({ format: 'A4' });
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length, 'the PDF is more than one page').toBeGreaterThan(1);
  });
});
