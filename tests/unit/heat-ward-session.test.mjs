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

test('F3 (INT audit): a reload of the committed ward is refused unless the caller asks for one; a reload supersedes a pending load of the same ward', () => {
  const session = createWardSession();
  const a = session.begin('amsterdam-e4');
  assert.ok(a);
  assert.equal(session.commit(a), true);
  assert.equal(session.begin('amsterdam-e4'), null, 'the ordinary switch still refuses the ward on screen');
  const again = session.begin('amsterdam-e4', { reload: true });
  assert.ok(again, 'a rebuild of the ward on screen (a tier demotion, a restored GL context) gets a token');
  assert.equal(session.pendingWard, 'amsterdam-e4');
  assert.equal(session.commit(again), true);
  assert.equal(session.committedWard, 'amsterdam-e4');
  const pending = session.begin('baruipur');
  assert.ok(pending);
  const rebuild = session.begin('amsterdam-e4', { reload: true });
  assert.ok(rebuild);
  assert.equal(pending.signal.aborted, true, 'a reload is last-request-wins like every other begin');
  assert.equal(session.fail(rebuild), true);
  assert.equal(session.committedWard, 'amsterdam-e4', 'a failed rebuild leaves the committed ward in place');
});
