// tests/unit/cbam-illustrations.test.mjs
// Spec §8.1 and §4.3: the approved drawings, byte for byte, in one ink; never bronze or cyan.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ILL, INPUT_ILL, goodIll, insertIll, pict } from '../../src/scripts/cbam-ui/illustrations.ts';

const GOLD = JSON.parse(readFileSync(new URL('./fixtures/cbam-ill-golden.json', import.meta.url), 'utf8'));
/** The two deliberate, invisible additions: a name on every svg, and the needle's class. */
const strip = (s) => s.replace(/ data-ill="[^"]*"/g, '').replace(/ class="b-needle"/g, '');
const body = (s) => s.slice(s.indexOf('>') + 1, s.lastIndexOf('</svg>'));
const PICTS = ['tube', 'bag', 'ingot', 'sheet', 'paper', 'shield'];

test('every string is the reference generator\'s, plus only data-ill and the needle class', () => {
  const pairs = [
    [ILL.fac, 'ILL_FAC'], [ILL.vou, 'ILL_VOU'], [ILL.steps, 'ILL_STEPS'], [ILL.scale, 'ILL_SCALE'],
    [ILL.box, 'ILL_BOX'], [ILL.gauge, 'ILL_GAUGE'],
    [INPUT_ILL.origin, 'INP_2'], [INPUT_ILL.date, 'INP_3'], [INPUT_ILL.mass, 'INP_4'],
    [goodIll('iron_and_steel'), 'INP_1'],
    [pict('tube'), 'TUBE'], [pict('bag'), 'BAG'], [pict('ingot'), 'INGOT'],
    [pict('sheet'), 'SHEET'], [pict('paper'), 'PAPER'], [pict('shield'), 'SHIELD'],
  ];
  for (const [mine, key] of pairs) assert.equal(strip(mine), GOLD[key], key);
});

test('cement and aluminium draw the bag and the ingot in the step frame (spec §8.1)', () => {
  assert.equal(body(goodIll('cement')), body(GOLD.BAG));
  assert.equal(body(goodIll('aluminium')), body(GOLD.INGOT));
  assert.match(goodIll('cement'), /^<svg class="b-ill b-ill-inp" data-ill="good-bag" viewBox="0 0 220 150" aria-hidden="true">/);
  assert.match(goodIll('aluminium'), /data-ill="good-ingot"/);
  assert.match(goodIll('iron_and_steel'), /data-ill="good-tube"/);
});

test('a sector with no approved drawing gets no step pictogram (P5-4)', () => {
  for (const s of ['fertilisers', 'hydrogen', 'electricity', null]) assert.equal(goodIll(s), '', String(s));
});

test('pictogram sizes are class modifiers only', () => {
  assert.equal(strip(pict('shield', 'sm')), GOLD.SHIELD.replace('class="b-pict"', 'class="b-pict b-pict-sm"'));
  assert.match(pict('tube', 'xs'), /^<svg class="b-pict b-pict-xs" data-ill="tube"/);
});

test('every svg is aria-hidden, named and monotone: tones and the plate colour only', () => {
  const all = [
    ...Object.values(ILL), ...Object.values(INPUT_ILL),
    goodIll('iron_and_steel'), goodIll('cement'), goodIll('aluminium'),
    ...PICTS.map((n) => pict(n)),
  ];
  for (const s of all) {
    assert.match(s, /^<svg [^>]*aria-hidden="true"/);
    assert.match(s, /^<svg [^>]*data-ill="[a-z-]+"/);
    assert.doesNotMatch(s, /bronze|cyan|#[0-9a-f]{3,8}\b|rgba?\(/i);
    for (const v of s.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
      assert.ok(['--ic-a', '--ic-b', '--ic-c', '--ic-n', '--card'].includes(v[1]), `${v[1]} in ${s.slice(0, 60)}`);
    }
    // The entry animation sets `transform` on every child; a transform ATTRIBUTE would be erased.
    assert.doesNotMatch(s, / transform="/);
  }
});

test('the certificates illustration is not ported (spec §8.1: the founder removed it)', () => {
  assert.deepEqual(Object.keys(ILL).sort(), ['box', 'fac', 'gauge', 'scale', 'steps', 'vou']);
});

test('the gauge carries exactly one needle for the sweep to target', () => {
  assert.equal((ILL.gauge.match(/class="b-needle"/g) ?? []).length, 1);
});

test('insertIll puts the svg first inside the first element carrying the whole class', () => {
  const tile = '<section class="b-t b-s2"><div class="b-t-h"><p class="b-t-ti">Total.</p></div></section>';
  assert.equal(insertIll(tile, '<svg/>', 'b-t'),
    '<section class="b-t b-s2"><svg/><div class="b-t-h"><p class="b-t-ti">Total.</p></div></section>');
  assert.equal(insertIll('<div class="x b-fl-in" style="width:69.4%">a</div>', '<svg/>', 'b-fl-in'),
    '<div class="x b-fl-in" style="width:69.4%"><svg/>a</div>');
});

test('insertIll refuses a missing host or a malformed class name', () => {
  assert.throws(() => insertIll('<div class="b-t-h"></div>', '<svg/>', 'b-t'), /no element with class "b-t"/);
  assert.throws(() => insertIll('<div class="b-t"></div>', '<svg/>', 'b t'), /not a class name/);
});
