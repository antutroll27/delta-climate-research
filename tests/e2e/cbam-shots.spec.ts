// tests/e2e/cbam-shots.spec.ts — headless screenshots named like the reference screens (not a CI test).
// CBAM_SHOTS_DIR=/Volumes/OBOSLab/cbam-rail-ui/shots/<date> npx playwright test cbam-shots --project=chromium-tier0
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { CBAM_URL, REFERENCE_LINES, priceWith, view, type ViewName } from './cbam-helpers';

const DIR = process.env.CBAM_SHOTS_DIR ?? '';
const NUM: Record<ViewName, string> = { estimate: '1', 'three-years': '2', why: '3', list: '4', export: '5', rules: '6' };

for (const theme of ['light', 'dark'] as const) {
  for (const device of ['desktop', 'phone'] as const) {
    test(`reference-named shots · ${theme} · ${device}`, async ({ page }) => {
      test.skip(!DIR, 'set CBAM_SHOTS_DIR to write screenshots');
      test.setTimeout(240_000);
      mkdirSync(DIR, { recursive: true });
      await page.setViewportSize(device === 'desktop' ? { width: 1440, height: 1800 } : { width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
      await page.goto(`${CBAM_URL}?theme=${theme}`);
      if (device === 'desktop') {
        // The reference's empty state is Three years before any line is priced.
        await view(page, 'three-years');
        await page.screenshot({ path: join(DIR, `8-empty-state-desktop-${theme}.png`) });
        await view(page, 'estimate');
      }
      for (const l of REFERENCE_LINES) { await priceWith(page, l); await page.click('#cbAdd'); }
      await priceWith(page, REFERENCE_LINES[0]);   // the draft on screen, as in the reference
      for (const v of Object.keys(NUM) as ViewName[]) {
        await view(page, v);
        await page.screenshot({ path: join(DIR, `${NUM[v]}-${v}-${device}-${theme}.png`) });
      }
      if (device === 'desktop') {
        await view(page, 'estimate');
        await page.locator('[data-view="estimate"]').getByRole('button', { name: /change/i }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.screenshot({ path: join(DIR, `7-good-sheet-desktop-${theme}.png`) });
      }
    });
  }
}
