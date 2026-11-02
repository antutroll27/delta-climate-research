// tests/unit/cbam-format.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { renderPriceRow as fromApp } from '../../src/scripts/cbam-algos/cbam-app.ts';
import {
  eur, num, originBasisLabel, renderPriceRow, snapshotLabel, tierLabel,
} from '../../src/scripts/cbam-ui/format.ts';

test('one price row: cbam-app re-exports the format module\'s, not a copy of it', () => {
  assert.equal(fromApp, renderPriceRow);
});

test('origin basis reads as the stamp has always read it', () => {
  assert.equal(originBasisLabel('residual'), 'Residual bucket');
  assert.equal(originBasisLabel('country'), "Origin's own published value");
  assert.equal(originBasisLabel(null), '—');
});

test('a real hash is shortened to 16 characters and an ellipsis; anything 24 or shorter is shown whole', () => {
  const h = '8bbba79e7f33f0e4943140c28e91a8810612f2fa770bd6dcad33fdb7045e4c05';
  assert.equal(snapshotLabel(h), '8bbba79e7f33f0e4…');
  assert.equal(snapshotLabel('not yet computed'), 'not yet computed');
  assert.equal(snapshotLabel('x'.repeat(24)), 'x'.repeat(24));
});

test('the moved helpers behave exactly as before', () => {
  assert.equal(num('329.8275'), '329.828');
  assert.equal(num('   '), '—');
  assert.equal(eur('24855.80'), '€24,855.80');
  assert.equal(eur(null), '—');
  assert.equal(tierLabel('verified-direct+default-indirect'), 'Verified direct + Commission indirect');
});
