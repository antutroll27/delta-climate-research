import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildPrintDocument, renderDraftThreshold, renderThreshold, renderYearThreshold,
} from '../../src/scripts/cbam-algos/cbam-app.ts';
import { estimateFromPack, resolveThreshold } from '../../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';
import { sumTotals } from '../../src/scripts/cbam-lines.ts';
import { renderMassRuler } from '../../src/scripts/cbam-ui/inputs-estimate.ts';
import {
  AMENDED_BY_2025_2083, sectorList, yearTile,
} from '../../src/scripts/cbam-ui/tiles-list.ts';

/**
 * Four small audit fixes (2026-11-03): F-06 the threshold sentences, F-08 the ruler label, N-02 exact masses
 * beside a threshold verdict, N-03 the citation. Written against the REAL pack, like cbam-render.test.mjs.
 */
const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));
const thresh = (cn, massT, date = '2026-03-15') => resolveThreshold(pack, { cn, massT, date });
const run = (massT) => estimateFromPack(pack, { cn: '2523100090', country: 'DZ', route: '(A)', massT, date: '2026-03-15' });
// Tags and entities out, whitespace collapsed: the sentence as a reader gets it.
const plain = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/* ── F-08 ───────────────────────────────────────────────────────────────────── */

test('F-08 the mass ruler\'s middle label is the annual all-goods test, not a per-line one', () => {
  const html = renderMassRuler(thresh('2523100090', '30'));
  assert.ok(html.includes('<span>50 t a year, all goods combined</span>'), html);
  assert.doesNotMatch(html, /de minimis/);
  assert.equal(renderMassRuler(null), '');
});

