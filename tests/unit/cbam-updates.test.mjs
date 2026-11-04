// tests/unit/cbam-updates.test.mjs — the Updates tile (spec 2026-11-04-cbam-legislation-updates).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { UPDATES } from '../../src/scripts/cbam-ui/updates.ts';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const pack = JSON.parse(read('../../public/cbam/estimator-pack.json'));

test('updates.json: every entry is dated, kinded, one sentence, and links only over https', () => {
  assert.ok(UPDATES.length > 0);
  for (const e of UPDATES) {
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, e.text);
    assert.equal(new Date(`${e.date}T00:00:00Z`).toISOString().slice(0, 10), e.date, `real date: ${e.date}`);
    assert.ok(['law', 'data', 'correction'].includes(e.kind), e.kind);
    assert.match(e.text, /\.$/, `ends with a full stop: ${e.text}`);
    // The approved text says "not a world average" (correcting the old claim), so only an affirmative use is wrong.
    assert.doesNotMatch(e.text, /(?<!not an? )world[- ]average/i);
    if (e.source !== undefined) assert.match(e.source, /^https:\/\//, e.source);
  }
});

test('updates.json: certificate prices are never hand-kept (they come from the pack)', () => {
  for (const e of UPDATES) assert.doesNotMatch(e.text, /€\s?\d/, e.text);
});
