// tests/unit/cbam-motion.test.mjs
// Spec §8.3: stagger indices set once per render; the entry animation replays on every entry.
import assert from 'node:assert/strict';
import test from 'node:test';

import { ANIM_CLASS, STAGGER_GROUPS, indexStagger, replay } from '../../src/scripts/cbam-ui/motion.ts';

test('the stagger groups are the reference bento.js list, verbatim', () => {
  assert.equal(STAGGER_GROUPS, '.b-ill,.b-pict,.b-sg,.b-waffle,.b-fp,.b-d10,.b-strip,.b-phase,.b-mcols,.b-stackbar,.b-split');
  assert.equal(ANIM_CLASS, 'b-anim');
});

const child = () => { const s = {}; return { s, style: { setProperty: (k, v) => { s[k] = v; } } }; };
const group = (n) => ({ children: Array.from({ length: n }, child) });

test('every child of every group gets its index as --i', () => {
  const g1 = group(3); const g2 = group(2);
  indexStagger({ matches: () => false, querySelectorAll: (sel) => { assert.equal(sel, STAGGER_GROUPS); return [g1, g2]; } });
  assert.deepEqual(g1.children.map((c) => c.s['--i']), ['0', '1', '2']);
  assert.deepEqual(g2.children.map((c) => c.s['--i']), ['0', '1']);
});

test('a node that is itself a group is indexed too', () => {
  const self = { ...group(2), matches: () => true, querySelectorAll: () => [] };
  indexStagger(self);
  assert.deepEqual(self.children.map((c) => c.s['--i']), ['0', '1']);
});

function host(initial) {
  const log = [];
  let anims = initial;
  return {
    log,
    set: (a) => { anims = a; },
    classList: { add: (c) => log.push(`add:${c}`), remove: (c) => log.push(`remove:${c}`) },
    get offsetWidth() { log.push('reflow'); return 0; },
    getAnimations: () => anims,
  };
}
const anim = (name) => {
  let done = () => {};
  const a = { animationName: name, playState: 'running', finished: new Promise((r) => { done = r; }), finish: () => { a.playState = 'finished'; done(a); } };
  return a;
};
const tick = () => new Promise((r) => setTimeout(r, 0));

test('replay removes the class, forces a reflow, then re-adds it', () => {
  const el = host([anim('bRise')]);
  replay(el);
  assert.deepEqual(el.log, [`remove:${ANIM_CLASS}`, 'reflow', `add:${ANIM_CLASS}`]);
});

test('the class leaves once every entry animation has finished (P5-6)', async () => {
  const a = anim('bPop');
  const el = host([a]);
  replay(el);
  await tick();
  assert.equal(el.log.at(-1), `add:${ANIM_CLASS}`);
  a.finish();
  await tick();
  assert.equal(el.log.at(-1), `remove:${ANIM_CLASS}`);
});

test('a newer replay keeps the class while its own animations run', async () => {
  const first = anim('bRise');
  const el = host([first]);
  replay(el);
  const second = anim('bRise');
  el.set([second]);
  replay(el);
  first.finish();
  await tick();
  assert.equal(el.log.at(-1), `add:${ANIM_CLASS}`);
  second.finish();
  await tick();
  assert.equal(el.log.at(-1), `remove:${ANIM_CLASS}`);
});

test('with no entry animation (reduced motion) the class leaves at once; transitions do not hold it', () => {
  const el = host([{ playState: 'running', finished: new Promise(() => {}) }]); // a hover transition: no animationName
  replay(el);
  assert.equal(el.log.at(-1), `remove:${ANIM_CLASS}`);
});
