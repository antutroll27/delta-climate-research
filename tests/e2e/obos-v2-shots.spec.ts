// tests/e2e/obos-v2-shots.spec.ts — OBOS v2 S8 deliverable: headless phone screenshots of every screen, dark-plates and light-plates (not a CI test).
/**
 * Runs only when OBOS_SHOTS_DIR names a directory (it writes PNGs there), and only in chromium-v2-relief (its titles carry no @v2, so chromium-v2 never picks it up):
 *   OBOS_SHOTS_DIR=/Volumes/OBOSLab/obos-v2/shots/S8 e2e-run.sh int --raw ... playwright test obos-v2-shots --project=chromium-v2-relief
 * Every browser is headless (the founder rule): this project launches `--headless=new` on Metal and nothing ever shows a window.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { stubAir } from './aqi-cpcb-stub.ts';
import { openV2, stubWeather } from './obos-v2-helpers';

const DIR = process.env.OBOS_SHOTS_DIR ?? '';
const THEMES = ['dark', 'light'] as const;
const SIZES = [{ n: '390x844', width: 390, height: 844 }, { n: '360x740', width: 360, height: 740 }, { n: '844x390', width: 844, height: 390 }] as const;
const SECTIONS = ['overview', 'heat', 'air', 'solar', 'weather', 'scenarios', 'methods'] as const;

async function prime(page: Page, theme: string): Promise<void> {
  await stubAir(page, { nowcast: true });
  await stubWeather(page, '2026-10-07T06:05:00Z');
  await page.addInitScript((t) => { try { localStorage.setItem('obos:v2:theme', t); localStorage.setItem('obos:v2:cards', 'plates'); sessionStorage.setItem('obos:entry-note-seen', '1'); sessionStorage.setItem('obos:rotate-nudge-dismissed', '1'); } catch { /* none */ } }, theme);
}
/** a fixed number per screen, so the same screen has the same prefix at every size */
const NUM: Record<string, string> = { 'overview-closed': '01', overview: '02', heat: '03', air: '04', solar: '05', weather: '06', scenarios: '07', methods: '08', drawer: '09', building: '10', 'ward-switch': '11', 'al-quoz': '20', compare: '21', 'compare-drawer': '22', brief: '23' };
const shot = async (page: Page, name: string, tag: string): Promise<void> => { await page.waitForTimeout(1200); await page.screenshot({ path: join(DIR, `${NUM[name] ?? '99'}-${name}-${tag}.png`) }); };
async function section(page: Page, id: string): Promise<void> {
  await page.locator('[data-v2-menu]').click();
  await page.locator(`#v2Drawer .nav-item[data-section="${id}"]`).click();
  await expect(page.locator('main.obos-v2')).toHaveAttribute('data-section', id);
  await page.waitForTimeout(1500);
}

for (const theme of THEMES) for (const size of SIZES) {
  test.describe(`phone shots ${theme}-plates ${size.n}`, () => {
    test.skip(!DIR, 'set OBOS_SHOTS_DIR to write screenshots');
    test.use({ viewport: { width: size.width, height: size.height }, isMobile: true, hasTouch: true });

    test(`every area screen · ${theme}-plates · ${size.n}`, async ({ page }) => {
      test.setTimeout(420_000);
      mkdirSync(DIR, { recursive: true });
      await prime(page, theme);
      await openV2(page);
      await page.waitForTimeout(3000);
      const tag = `${theme}-plates-${size.n}`;
      await shot(page, 'overview-closed', tag);
      /* the main set is shot at 390x844 only; the two other sizes get the screens most likely to break (overview, solar, the drawer, the building card) */
      const sections = size.n === '390x844' ? SECTIONS : (['overview', 'solar'] as const);
      for (const s of sections) {
        await section(page, s);
        await shot(page, s, tag);
      }
      await page.locator('[data-v2-menu]').click();
      await shot(page, 'drawer', tag);
      await page.keyboard.press('Escape');
      /* the building card: a roof from the Solar list, as a reader picks it */
      await section(page, 'solar');
      await page.locator('[data-v2-menu]').click();
      await page.locator('#v2Drawer #solList tr[data-idx]').first().click();
      await expect(page.locator('#bcard')).toBeVisible({ timeout: 30_000 });
      await shot(page, 'building', tag);
      if (size.n === '390x844') {
        /* the ward switch: a place chip, then the Baruipur screen */
        await page.keyboard.press('Escape');
        await section(page, 'overview');
        await page.locator('#strip .ward[data-w]').nth(1).click();
        await expect(page.locator('#crumbArea')).not.toHaveText('Ballygunge', { timeout: 60_000 });
        await shot(page, 'ward-switch', tag);
      }
    });

    test(`no artefacts, Compare and the paired brief · ${theme}-plates · ${size.n}`, async ({ page }) => {
      test.setTimeout(300_000);
      mkdirSync(DIR, { recursive: true });
      test.skip(size.n !== '390x844', 'the three off-map screens are shot once, at 390x844');
      await prime(page, theme);
      const tag = `${theme}-plates-${size.n}`;
      await openV2(page, '/heat-map/ae/dubai/al-quoz/');
      await shot(page, 'al-quoz', tag);
      await page.goto('/heat-map/compare/');
      await expect(page.locator('[data-role="status"]')).not.toHaveText('Preparing the paired model.', { timeout: 90_000 });
      await shot(page, 'compare', tag);
      await page.locator('[data-v2-menu]').click();
      await shot(page, 'compare-drawer', tag);
      await page.keyboard.press('Escape');
      await page.goto('/heat-map/brief/');
      await expect(page.locator('main.obos-v2[data-brief-root]')).toHaveCount(1);
      await page.waitForTimeout(6000);
      await shot(page, 'brief', tag);
    });
  });
}
