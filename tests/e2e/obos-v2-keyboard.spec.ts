// tests/e2e/obos-v2-keyboard.spec.ts — OBOS v2 spec §3.11, §7 (keyboard parity with v1) (S8).
/**
 * THE KEYBOARD, AS V1 HAS IT: Esc closes the topmost thing and only that; the Location selects keep their type-ahead, Home, End, Enter and Esc;
 * roof rows and ward chips are buttons. v2's one Esc stack must never swallow a key that belongs to a control, and never let one press do two jobs.
 */
import { expect, test, type Page } from '@playwright/test';
import { openV2 } from './obos-v2-helpers';

const go = (page: Page, section: string) => page.locator(`.nav-item[data-section="${section}"]`).click({ position: { x: 30, y: 22 } });
/** The control's type-ahead window is 600 ms between key EVENTS; under automation they arrive late, so the letters go in one task (heat-map-routing.spec.ts). */
const typeAhead = (page: Page, word: string) => page.evaluate((w) => { const t = document.activeElement ?? document.body; for (const key of w) t.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); }, word);

test.describe('@v2 keyboard (desktop)', () => {
  test.setTimeout(180_000);
  test.use({ viewport: { width: 1440, height: 900 } });

  test('@v2 the Area select in the Explore panel: type-ahead, Home, End and Esc, exactly as v1; Esc spends itself on the list, not on a layer', async ({ page }) => {
    await openV2(page);
    const trigger = page.locator('#scope-area-trigger');
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const list = page.locator('#scope-area-list');
    await page.keyboard.press('End');
    const last = await list.locator('li[role="option"]').last().getAttribute('id');
    await expect(trigger).toHaveAttribute('aria-activedescendant', last!);
    await page.keyboard.press('Home');
    const first = await list.locator('li[role="option"]').first().getAttribute('id');
    await expect(trigger).toHaveAttribute('aria-activedescendant', first!);
    await expect(async () => {
      await page.keyboard.press('Home');
      await typeAhead(page, 'barr');
      await expect(list.locator('li.is-active .field-option-text')).toHaveText('Barrackpore', { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    /* Esc closes the list, keeps the place's value, returns focus to the trigger, and the page behind it does not move */
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
    await expect(page.locator('select[data-scope="area"]')).toHaveValue('in/kolkata/ballygunge');
    await expect(page.locator('#pname')).toContainText('Ballygunge');
  });

  test('@v2 Esc is one stack: the key, credits and layers popovers each close alone and return focus to their opener; roof rows answer Enter and Space', async ({ page }) => {
    await openV2(page);
    for (const [opener, pop] of [['.key-btn', '#v2Key'], ['.st-attrib .attrib', '#v2Credits'], ['.tab[data-pop-open="layers"]', '#v2Layers']] as const) {
      await page.locator(opener).focus();
      await page.keyboard.press('Enter');
      await expect(page.locator(pop)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator(pop)).toBeHidden();
      await expect(page.locator(opener)).toBeFocused();
    }
    /* roof rows are keyboard buttons: Enter, then Space on the next row, and Esc closes the card (one press, one thing) */
    await go(page, 'solar');
    const rows = page.locator('#solList tr[data-idx]');
    await expect(rows.first()).toBeAttached({ timeout: 60_000 });
    await rows.nth(0).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#bcard')).toBeVisible({ timeout: 30_000 });
    const id1 = await page.locator('#bcId').textContent();
    await rows.nth(1).focus();
    await page.keyboard.press(' ');
    await expect(page.locator('#bcId')).not.toHaveText(id1 ?? '', { timeout: 30_000 });
    await page.locator('.tab[data-pop-open="layers"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#v2Layers')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#v2Layers'), 'the popover took the key').toBeHidden();
    await expect(page.locator('#bcard'), 'and the card stayed (the layer stack swallows one press)').toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#bcard')).toBeHidden();
  });

  test('@v2 a place chip is a keyboard button: Enter switches the ward in place', async ({ page }) => {
    await openV2(page);
    await go(page, 'overview');                                   // the side panel closes: the dock's chips show
    const chip = page.locator('#strip .ward[data-w]').nth(1);
    await expect(chip).toBeVisible();
    await chip.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#crumbArea')).not.toHaveText('Ballygunge', { timeout: 60_000 });
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('@v2 keyboard (phone)', () => {
  test.setTimeout(180_000);
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('@v2 inside the drawer an open Area list takes the first Esc, the drawer the second', async ({ page }) => {
    await page.addInitScript(() => { try { sessionStorage.setItem('obos:entry-note-seen', '1'); sessionStorage.setItem('obos:rotate-nudge-dismissed', '1'); } catch { /* none */ } });
    await openV2(page);
    await page.locator('[data-v2-menu]').click();
    const trigger = page.locator('#v2Drawer #scope-area-trigger');
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#v2Drawer')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#v2Drawer')).toBeHidden();
    await expect(page.locator('[data-v2-menu]')).toBeFocused();
  });
});
