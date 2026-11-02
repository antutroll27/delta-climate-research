import assert from 'node:assert/strict';
import test from 'node:test';

import { VIEWS, viewFromHash } from '../../src/scripts/cbam-ui/views.ts';

test('the six views, in rail order', () => {
  assert.deepEqual([...VIEWS], ['estimate', 'three-years', 'why', 'list', 'export', 'rules']);
});

test('a known hash names its view', () => {
  for (const v of VIEWS) assert.equal(viewFromHash(`#${v}`), v);
});

test('no hash, an unknown hash, or a near miss falls back to Estimate', () => {
  for (const h of ['', '#', '#Estimate', '#lists', '#list/', '#%E0', 'list']) {
    assert.equal(viewFromHash(h), 'estimate', h);
  }
});
