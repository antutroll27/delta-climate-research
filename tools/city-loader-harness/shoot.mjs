// Headless screenshots of each loader state at 390x844 and 1440x900. Foreground, with its own hard timeout.
//   OBOS_E2E_PORT=4738 node tools/city-loader-harness/shoot.mjs
// Writes to the preview folder. Needs PLAYWRIGHT_BROWSERS_PATH pointing at the Chromium cache.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const PORT = process.env.OBOS_E2E_PORT ?? '4738';
const OUT = process.env.OBOS_SHOT_DIR ?? '/Volumes/PortableSSD/OBOS Lab/previews/city-streaming/p4';
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = [['390x844', { width: 390, height: 844 }], ['1440x900', { width: 1440, height: 900 }]];
// [file stem, scene, query, reducedMotion media]
const STATES = [
  ['1-waiting-25', 'waiting', '', false],
  ['2-rising', 'rising', '', false],
  ['3-plate-45', 'plate-45', '', false],
  ['4-failure', 'failure', '', false],
  ['5-first-entry-sweep', 'first-entry', '', false],
  ['6-reduced-motion-plate', 'plate-45', '&reduced=1', true],
  ['7-light-plate-45', 'plate-45', '&theme=light', false],
];

const ONLY = process.env.OBOS_SHOT_ONLY?.split(',');
const only = (stem) => !ONLY || ONLY.includes(stem);
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', '--config', 'tools/city-loader-harness/vite.config.ts', '--port', PORT, '--host', '127.0.0.1', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
const kill = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
const hard = setTimeout(() => { console.error('hard timeout'); kill(); process.exit(2); }, 240_000);
process.on('exit', kill);

async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`${BASE}/`); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('vite did not start');
}

try {
  await waitUp();
  const browser = await chromium.launch({ headless: true });
  for (const [vpName, viewport] of VIEWPORTS) {
    for (const [stem, scene, query, reduced] of STATES) {
      if (!only(stem)) continue;
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, reducedMotion: reduced ? 'reduce' : 'no-preference', hasTouch: viewport.width < 700 });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(`${BASE}/?scene=${scene}${query}`);
      await page.waitForFunction(() => window.__h && window.__h.ready, null, { timeout: 30_000 });
      await page.waitForTimeout(1500);
      const file = `${OUT}/${stem}-${vpName}.png`;
      await page.screenshot({ path: file });
      const info = await page.evaluate(() => ({ mode: window.__h.state().mode, design: window.__h.state().design, status: window.__h.state().status.text, focus: document.activeElement?.className ?? '' }));
      console.log(`${stem} ${vpName}: ${JSON.stringify(info)}${errors.length ? ' ERRORS ' + errors.join(' | ') : ''}`);
      await ctx.close();
    }
  }
  await browser.close();
} finally {
  clearTimeout(hard);
  kill();
}
