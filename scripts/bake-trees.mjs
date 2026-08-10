// Bake ez-tree species to committed GLBs. Requires a dev server on :4322.
// Run: node scripts/bake-trees.mjs
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = 'public/heat-map/models';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal'] });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://localhost:4322/veg-bake', { waitUntil: 'networkidle', timeout: 45000 });
await p.waitForFunction(() => window.__bakeReady === true, null, { timeout: 30000 });
for (const kind of ['neem','gulmohar','palm']) {
  const b64 = await p.evaluate(k => window.bakeSpecies(k), kind);
  writeFileSync(`${OUT}/${kind}.glb`, Buffer.from(b64, 'base64'));
  console.log('baked', kind, `${OUT}/${kind}.glb`);
}
await b.close();
console.log('errors:', errs.length ? errs.join(' | ') : 'none');
