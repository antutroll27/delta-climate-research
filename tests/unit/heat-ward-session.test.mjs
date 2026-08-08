import assert from 'node:assert/strict';
import test from 'node:test';
import { createWardSession } from '../../src/scripts/climate-engine/ward-session.ts';

test('ward session is last-request-wins and preserves a committed ward on failure', () => {
  const session = createWardSession();
  const a = session.begin('ballygunge');
  assert.ok(a && session.isCurrent(a));
  assert.equal(session.commit(a), true);
  const b = session.begin('baruipur');
  assert.ok(b && session.isCurrent(b));
  const c = session.begin('barrackpore');
  assert.ok(c && session.isCurrent(c));
  assert.equal(a.signal.aborted, false);
  assert.equal(b.signal.aborted, true);
  assert.equal(session.fail(c), true);
  assert.equal(session.committedWard, 'ballygunge');
});

test('ward session ignores duplicate work and invalidates callbacks on disposal', () => {
  const session = createWardSession();
  const a = session.begin('ballygunge');
  assert.equal(session.begin('ballygunge'), null);
  session.dispose();
  assert.equal(a.signal.aborted, true);
  assert.equal(session.isCurrent(a), false);
  assert.equal(session.begin('baruipur'), null);
});
