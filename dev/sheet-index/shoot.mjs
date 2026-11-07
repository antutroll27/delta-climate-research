// Headless screenshots and a keyboard/a11y smoke for the sheet index harness. Run in the FOREGROUND with a timeout:
//   OBOS_E2E_PORT=4739 node dev/sheet-index/shoot.mjs   (with `vite --config dev/sheet-index/vite.config.mjs` serving)
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = process.env.OBOS_E2E_PORT ?? '4739';
const OUT = process.env.SI_OUT ?? '/Volumes/PortableSSD/OBOS Lab/previews/city-streaming/p5';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const url = (qs) => `http://127.0.0.1:${PORT}/?${qs}`;
const sizes = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const settle = (page) => page.waitForTimeout(450);

for (const [name, viewport] of Object.entries(sizes)) {
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: name === 'phone', isMobile: name === 'phone' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url(`theme=${theme}&sheet=E4`), { waitUntil: 'networkidle' });
    await settle(page);
    await page.screenshot({ path: `${OUT}/${name}-${theme}-closed.png` });
    await page.click('.si-chip');
    await settle(page);
    await page.screenshot({ path: `${OUT}/${name}-${theme}-open.png` });
    if (name === 'phone' && theme === 'dark') {
      await page.evaluate(() => document.querySelector('.si-panel').scrollTo(0, 99999));
      await settle(page);
      await page.screenshot({ path: `${OUT}/phone-dark-open-scrolled.png` });
    }
    assert.deepEqual(errors, [], `${name}/${theme} console errors`);
    await ctx.close();
  }
}

// ── behaviour, on the desktop and the phone ──
for (const [name, viewport] of Object.entries(sizes)) {
  const ctx = await browser.newContext({ viewport, hasTouch: name === 'phone', isMobile: name === 'phone' });
  const page = await ctx.newPage();
  await page.goto(url('loadMs=600'), { waitUntil: 'networkidle' });
  const sel = () => page.evaluate(() => window.__si.selects.slice());
  const current = () => page.evaluate(() => window.__si.manager.state().current);

  // closed: global Shift+arrow selects the neighbouring shipping sheet and announces it
  assert.equal(await current(), 'E4');
  await page.keyboard.press('Shift+ArrowRight');
  assert.deepEqual(await sel(), ['F4'], `${name}: Shift+Right from E4 selects F4`);
  await page.waitForTimeout(200);
  assert.match(await page.locator('.si-live').textContent(), /Loading sheet F4/, `${name}: loading is announced`);
  assert.equal(await page.locator('.si-chip').getAttribute('aria-busy'), 'true');
  await page.waitForTimeout(900);
  assert.match(await page.locator('.si-live').textContent(), /Current sheet F4/, `${name}: arrival is announced`);
  assert.equal(await page.locator('.si-chip').getAttribute('aria-busy'), 'false');
  assert.match(await page.locator('.si-chip').textContent(), /F4/);

  // open, inspect the grid semantics
  await page.click('.si-chip');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.si-grid').getAttribute('role'), 'grid');
  const rows = await page.locator('.si-row').count();
  assert.equal(rows, 7);
  const cells = await page.$$eval('.si-cell[tabindex]', (n) => n.map((x) => ({ code: x.dataset.code, ti: x.getAttribute('tabindex'), dis: x.getAttribute('aria-disabled'), label: x.getAttribute('aria-label') })));
  assert.equal(cells.filter((c) => c.ti === '0').length, 1, `${name}: exactly one cell is in the tab order`);
  assert.equal(cells.find((c) => c.ti === '0').code, 'F4', `${name}: and it is the current sheet`);
  assert.ok(cells.every((c) => /buildings/.test(c.label)), `${name}: every label carries a building count`);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.code), 'F4', `${name}: focus lands on the current cell`);
  const skippedCodes = cells.filter((c) => c.dis === 'true').map((c) => c.code);
  assert.ok(skippedCodes.length > 0);

  // clicking a skipped cell emits nothing
  const before = (await sel()).length;
  await page.locator(`.si-cell[data-code="${skippedCodes[0]}"]`).click({ force: true });
  assert.equal((await sel()).length, before, `${name}: a skipped cell cannot be selected`);
  assert.match(await page.locator('.si-live').textContent(), /not available/);
  assert.equal(await page.evaluate(() => window.__si.ui.isOpen), true);

  // roving focus with plain arrows, then Enter selects
  await page.focus('.si-cell[data-code="F4"]');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.code), 'G4');
  await page.keyboard.press('Enter');
  assert.deepEqual((await sel()).slice(-1), ['G4'], `${name}: Enter selects the focused cell`);
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__si.ui.isOpen), false, `${name}: selecting closes the panel`);
  assert.equal(await page.evaluate(() => document.activeElement?.className.includes('si-chip')), true, `${name}: and focus returns to the chip`);

  // Escape closes without selecting
  await page.click('.si-chip');
  await page.waitForTimeout(350);
  const n = (await sel()).length;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__si.ui.isOpen), false);
  assert.equal((await sel()).length, n);

  // Shift+arrow off the edge: nothing moves, and it says so
  await page.waitForTimeout(700);
  for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowUp');
  await page.waitForTimeout(100);
  assert.match(await page.locator('.si-live').textContent(), /No sheet to the north of/);
  assert.notEqual(await current(), undefined);

  if (name === 'phone') {
    await page.click('.si-chip'); await page.waitForTimeout(450);
    const item = page.locator('.si-item').first();
    assert.ok(await item.isVisible(), 'phone: the grouped list is visible');
    const h = await item.boundingBox();
    assert.ok(h.height >= 44, `phone: list rows are at least 44 px (${h.height})`);
    const groups = await page.$$eval('.si-group-h span', (n) => n.map((x) => x.textContent));
    assert.deepEqual(groups, [...groups].sort((a, b) => a.localeCompare(b, 'nl')));
    const before2 = (await sel()).length;
    await item.click(); await page.waitForTimeout(500);
    assert.equal((await sel()).length, before2 + 1, 'phone: a list row selects');
  } else {
    assert.equal(await page.locator('.si-list').isVisible(), false, 'desktop: the list is the phone\'s');
  }
  await ctx.close();
}

// reduced motion: the panel appears and disappears at once
{
  const ctx = await browser.newContext({ viewport: sizes.desktop, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(url(''), { waitUntil: 'networkidle' });
  await page.click('.si-chip');
  assert.equal(await page.locator('.si-panel').evaluate((n) => getComputedStyle(n).transitionDuration), '0s');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(30);
  assert.equal(await page.locator('.si-panel').evaluate((n) => n.hidden), true, 'reduced motion: hidden without waiting for a transition');
  await ctx.close();
}
await browser.close();
console.log('sheet-index harness: all checks passed; screenshots in', OUT);
