import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  AMSTERDAM_INDEX_TABLES as REAL, activate, buildIndexModel, cellLabel, cellReadout, groupByStadsdeel, indexStateOf, keyAction,
  announceCurrent, countPhrase, parseAreaNames, parseDrawnCounts, reasonText, withDrawnCounts, selectEventOf, selectable, stepFrom,
} from '../../src/scripts/climate-engine/streaming/sheet-index.ts';
import { AMSTERDAM_TOPOLOGY as T } from '../../src/scripts/climate-engine/streaming/sheet-topology.ts';
import { createSheetManager } from '../../src/scripts/climate-engine/streaming/sheet-manager.ts';

/* THE INDEX UI READS THE GENERATED TABLE, so these tests run over the REAL lattice (whatever count ships) and over a small
   synthetic one with a known shape for the cases the real city may not contain. Nothing here hard-codes 36 or 32. */

const M = buildIndexModel();
const key = (k, shiftKey = false, extra = {}) => ({ key: k, shiftKey, ctrlKey: false, altKey: false, metaKey: false, ...extra });
const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

test('the model covers the whole lattice, and agrees with the topology on what ships', () => {
  assert.equal(M.cells.length, REAL.lattice.columns.length * REAL.lattice.rows);
  assert.equal(M.cells.filter((c) => c.available).length, REAL.sheets.length);
  assert.equal(M.counts.shipping, REAL.sheets.length);
  assert.equal(M.counts.core + M.counts.edge, M.counts.shipping);
  assert.equal(M.counts.skipped, REAL.skipped.length);
  for (const c of M.cells) {
    assert.equal(c.available, T.codeAt(c.i, c.j) !== null, `${c.code}: ships in the topology iff available here`);
    assert.equal(c.state === 'skipped', T.cellKind(c.i, c.j) === 'skipped', c.code);
    assert.equal(c.state === 'outside', T.cellKind(c.i, c.j) === 'outside', c.code);
  }
  assert.deepEqual(M.cells.map((c) => c.code).slice(0, 3), ['A1', 'B1', 'C1']);   // reading order, row 1 = north
});

test('names: the table label after "CODE · ", else the stadsdeel, else the code', () => {
  const e4 = M.byCode.get('E4');
  assert.equal(e4.name, 'Canal Ring');
  assert.equal(e4.stadsdeel, 'Centrum');
  for (const c of M.shipping) {
    assert.ok(c.name.length > 0);
    const row = REAL.sheets.find((s) => s.code === c.code);
    assert.equal(c.name, row.label.replace(`${c.code} · `, ''), c.code);
  }
  for (const c of M.cells.filter((x) => !x.available)) assert.equal(c.name, c.code, 'a skipped or outside cell is named by its code');
  const odd = buildIndexModel({
    lattice: { columns: 'AB', rows: 1, iOfColumnA: 0, jOfRow1: 0 },
    sheets: [{ id: 'x-a1', code: 'A1', i: 0, j: 0, kind: 'core', buildings: 5, municipalBuildings: 5, stadsdeel: 'Noord', label: 'unlabelled' },
             { id: 'x-b1', code: 'B1', i: 1, j: 0, kind: 'edge', buildings: 5, municipalBuildings: 5, stadsdeel: '', label: 'nothing' }],
    skipped: [],
  });
  assert.equal(odd.byCode.get('A1').name, 'Noord', 'no usable label: the stadsdeel');
  assert.equal(odd.byCode.get('B1').name, 'B1', 'no label, no stadsdeel: the code');
});

test('derived grouping: every shipping sheet once, by stadsdeel, alphabetical, reading order inside', () => {
  const seen = M.groups.flatMap((g) => g.cells.map((c) => c.code));
  assert.equal(seen.length, M.shipping.length);
  assert.deepEqual([...seen].sort(), M.shipping.map((c) => c.code).sort(), 'a partition: nothing lost, nothing twice');
  const names = M.groups.map((g) => g.stadsdeel);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'nl')));
  assert.equal(new Set(names).size, names.length);
  const wanted = new Map();
  for (const s of REAL.sheets) wanted.set(s.stadsdeel, (wanted.get(s.stadsdeel) ?? 0) + 1);
  assert.deepEqual(new Map(M.groups.map((g) => [g.stadsdeel, g.cells.length])), wanted, 'group sizes come from the table');
  for (const g of M.groups) {
    const order = g.cells.map((c) => c.row * 100 + c.col);
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `${g.stadsdeel} in reading order`);
    for (const c of g.cells) assert.equal(c.stadsdeel, g.stadsdeel);
  }
  assert.equal(M.groups.find((g) => g.stadsdeel === 'Centrum').cells[0].code, 'E4');
  assert.equal(groupByStadsdeel(M.cells).flatMap((g) => g.cells).length, M.shipping.length, 'skipped cells are filtered even if passed in');
});

test('a count change needs no code change: a table with one sheet fewer rebuilds everything', () => {
  const fewer = { ...REAL, sheets: REAL.sheets.slice(1), skipped: [...REAL.skipped, { ...REAL.sheets[0], reason: 'under-500-buildings' }] };
  const m = buildIndexModel(fewer);
  assert.equal(m.counts.shipping, M.counts.shipping - 1);
  assert.equal(m.counts.skipped, M.counts.skipped + 1);
  assert.equal(selectable(m, REAL.sheets[0].code), null);
  assert.ok(selectable(M, REAL.sheets[0].code) !== null);
});

test('no skipped or outside cell is ever selectable, by any path', () => {
  for (const c of M.cells) {
    assert.equal(selectable(M, c.code) !== null, c.available, `selectable(${c.code})`);
    const a = activate(M, c.code);
    if (c.available) assert.deepEqual(a, { type: 'select', code: c.code });
    else assert.notEqual(a.type, 'select', `activate(${c.code}) must not select`);
    if (c.state === 'skipped') assert.deepEqual(a, { type: 'refuse', code: c.code });
  }
  assert.equal(selectable(M, null), null);
  assert.equal(selectable(M, 'Z9'), null);
  assert.equal(activate(M, 'Z9').type, 'none');
  // and every keyboard path, from every cell, with and without shift: a `select` only ever names a shipping cell
  const keys = [...ARROWS, 'Home', 'End', 'Enter', ' ', 'Escape', 'Tab', 'a'];
  for (const from of M.cells.map((c) => c.code)) {
    for (const k of keys) {
      for (const shift of [false, true]) {
        const a = keyAction(M, from, key(k, shift));
        if (a.type === 'select') assert.ok(M.byCode.get(a.code).available, `${from} ${shift ? 'Shift+' : ''}${k} -> ${a.code}`);
        if (a.type === 'focus') assert.notEqual(M.byCode.get(a.code).state, 'outside');
      }
    }
  }
});

test('Shift + arrow over the real lattice: the next shipping sheet in that direction, passing over skipped cells', () => {
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };   // i east, j NORTH
  let jumps = 0;
  for (const from of M.shipping) {
    for (const arrow of ARROWS) {
      const a = keyAction(M, from.code, key(arrow, true));
      // the oracle: walk the lattice in (i, j) with the topology, independent of the model's row/col arithmetic
      const [di, dj] = dir[arrow];
      let want = null, steps = 0;
      for (let i = from.i + di, j = from.j + dj; Math.abs(i - from.i) < 12 && Math.abs(j - from.j) < 12; i += di, j += dj, steps++) {
        const code = T.codeAt(i, j);
        if (code !== null) { want = code; break; }
      }
      if (want === null) assert.deepEqual(a, { type: 'miss', from: from.code, arrow }, `${from.code} ${arrow} has nowhere to go`);
      else { assert.deepEqual(a, { type: 'select', code: want }, `${from.code} ${arrow}`); if (steps > 0) jumps++; }
    }
  }
  assert.ok(jumps >= 0);   // whether the real city has a hole to jump depends on the table; the synthetic lattice below always does
});

test('Shift + arrow edge cases: an edge of the lattice and a gap are a miss, and nothing else moves', () => {
  // find a real sheet on the west edge of its row, and one with a hole beside it
  const westmost = M.shipping.find((c) => stepFrom(M, c.code, 'ArrowLeft') === null);
  assert.ok(westmost, 'some sheet has nothing to its west');
  assert.deepEqual(keyAction(M, westmost.code, key('ArrowLeft', true)), { type: 'miss', from: westmost.code, arrow: 'ArrowLeft' });
  const northmost = M.shipping.find((c) => c.row === Math.min(...M.shipping.map((x) => x.row)));
  assert.equal(keyAction(M, northmost.code, key('ArrowUp', true)).type, 'miss');
  // Shift + arrow from a cell that does not ship still finds the next shipping sheet (the focused-skipped case)
  const skipped = M.cells.find((c) => c.state === 'skipped' && stepFrom(M, c.code, 'ArrowDown') !== null);
  assert.ok(skipped);
  assert.equal(keyAction(M, skipped.code, key('ArrowDown', true)).type, 'select');
  // modifiers other than Shift never navigate; unknown starting points never navigate
  for (const extra of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
    assert.equal(keyAction(M, 'E4', key('ArrowRight', true, extra)).type, 'none');
  }
  assert.equal(keyAction(M, null, key('ArrowRight', true)).type, 'none');
  assert.equal(keyAction(M, 'Q9', key('ArrowRight', true)).type, 'none');
});

test('synthetic lattice: a skipped cell between two sheets is jumped; a trailing skipped cell is a miss', () => {
  const m = buildIndexModel({
    lattice: { columns: 'ABCDE', rows: 3, iOfColumnA: 0, jOfRow1: 2 },
    sheets: [
      { id: 'a2', code: 'A2', i: 0, j: 1, kind: 'core', buildings: 3000, municipalBuildings: 3000, stadsdeel: 'Noord', label: 'A2 · Noord' },
      { id: 'd2', code: 'D2', i: 3, j: 1, kind: 'edge', buildings: 900, municipalBuildings: 700, stadsdeel: 'Oost', label: 'D2 · Oost' },
      { id: 'a3', code: 'A3', i: 0, j: 0, kind: 'core', buildings: 2500, municipalBuildings: 2500, stadsdeel: 'Noord', label: 'A3 · Noord' },
    ],
    skipped: [
      { code: 'B2', i: 1, j: 1, buildings: 10, municipalBuildings: 1, reason: 'under-500-buildings' },
      { code: 'C2', i: 2, j: 1, buildings: 20, municipalBuildings: 2, reason: 'under-500-buildings' },
      { code: 'E2', i: 4, j: 1, buildings: 30, municipalBuildings: 3, reason: 'under-10-percent-municipal' },
    ],
  });
  assert.deepEqual(keyAction(m, 'A2', key('ArrowRight', true)), { type: 'select', code: 'D2' }, 'B2 and C2 are passed over');
  assert.deepEqual(keyAction(m, 'D2', key('ArrowLeft', true)), { type: 'select', code: 'A2' });
  assert.equal(keyAction(m, 'D2', key('ArrowRight', true)).type, 'miss', 'E2 is skipped and nothing lies beyond it');
  assert.deepEqual(keyAction(m, 'A2', key('ArrowDown', true)), { type: 'select', code: 'A3' });
  assert.equal(keyAction(m, 'A3', key('ArrowDown', true)).type, 'miss');
  assert.equal(keyAction(m, 'A2', key('ArrowUp', true)).type, 'miss', 'A1 is outside the city');
  // plain arrows: roving focus lands on a skipped cell (it is focusable, labelled), but never on an outside one
  assert.deepEqual(keyAction(m, 'A2', key('ArrowRight')), { type: 'focus', code: 'B2' });
  assert.deepEqual(keyAction(m, 'A2', key('ArrowUp')), { type: 'none' }, 'A1 is outside and nothing lies beyond');
  assert.deepEqual(keyAction(m, 'B2', key('Enter')), { type: 'refuse', code: 'B2' });
  assert.deepEqual(keyAction(m, 'D2', key(' ')), { type: 'select', code: 'D2' });
  assert.deepEqual(keyAction(m, 'C2', key('Home')), { type: 'focus', code: 'A2' });
  assert.deepEqual(keyAction(m, 'A2', key('End')), { type: 'focus', code: 'E2' });
  assert.equal(m.byCode.get('E2').reason, 'under 10% municipal land');
  assert.equal(m.byCode.get('B2').reason, 'under 500 municipal buildings');
});

/** A build record shaped like sheets-build.json, with counts that cannot be mistaken for the lattice's. */
const recordFor = (codes) => ({ city: 'x', sheets: codes.map((code, n) => ({ code, id: `id-${code}`, buildings: 7000 + n, trees: 1 })) });

test('labels carry the DRAWN building count; without one they carry none, and never the lattice count', () => {
  const drawn = parseDrawnCounts(recordFor(M.shipping.map((c) => c.code)));
  const withCounts = buildIndexModel(REAL, { drawn });
  const fmt = new Intl.NumberFormat('en-GB');
  for (const [n, c] of withCounts.shipping.entries()) {
    assert.equal(c.buildings, 7000 + n, c.code);
    const label = cellLabel(c, 'E4');
    assert.ok(label.includes(`${fmt.format(7000 + n)} buildings`), `${c.code}: ${label}`);
    assert.ok(cellReadout(c).detail.includes(fmt.format(7000 + n)));
    const lattice = REAL.sheets.find((s) => s.code === c.code).buildings;
    assert.ok(!label.includes(fmt.format(lattice)) && !cellReadout(c).detail.includes(fmt.format(lattice)), `${c.code}: the lattice count ${lattice} is not shown`);
  }
  for (const c of withCounts.cells.filter((x) => !x.available)) assert.equal(c.buildings, null, 'a skipped or outside cell is not drawn: no count');
  for (const c of M.cells.filter((x) => x.state !== 'outside')) {            // M: no build record at all
    assert.equal(c.buildings, null, `${c.code}: absent record, no count`);
    const label = cellLabel(c, 'E4');
    assert.ok(label.startsWith(c.code), label);
    if (c.available) {
      assert.ok(!/buildings/.test(label), label);
      assert.ok(!/\d/.test(cellReadout(c).detail), `${c.code}: no figure in the readout`);
    } else assert.ok(label.includes('not available'));
  }
  assert.equal(countPhrase(M.byCode.get('E4')), '');
  assert.ok(cellLabel(M.byCode.get('E4'), 'E4').includes('current area'));
  assert.ok(!cellLabel(M.byCode.get('E4'), 'D4').includes('current area'));
  assert.equal(announceCurrent(M.byCode.get('E4')), 'Current area E4, Canal Ring.');
  assert.equal(announceCurrent(withCounts.byCode.get('E4')), `Current area E4, Canal Ring. ${fmt.format(7000 + withCounts.shipping.findIndex((c) => c.code === 'E4'))} buildings.`);
  assert.equal(reasonText('something-new-here'), 'something new here');
});

test('drawn counts are read by field name, defensively; a loaded bundle can override them', () => {
  assert.deepEqual([...parseDrawnCounts({ sheets: [{ code: 'E2', buildings: 12342, trees: 9 }, { code: 'F2', buildings: -1 }, { code: 'G2', buildings: 1.5 }, { code: 'H2', buildings: '9' }, { code: 7, buildings: 3 }, null, { buildings: 5 }] })], [['E2', 12342]]);
  for (const bad of [null, undefined, 3, 'x', [], {}, { sheets: 'x' }, { sheets: {} }]) assert.equal(parseDrawnCounts(bad).size, 0, JSON.stringify(bad));
  // a renamed field means no count, not a wrong one
  assert.equal(parseDrawnCounts({ sheets: [{ code: 'E2', buildingCount: 12342 }] }).size, 0);
  const m = buildIndexModel(REAL, { drawn: parseDrawnCounts({ sheets: [{ code: 'E2', buildings: 12342 }] }) });
  assert.equal(m.byCode.get('E2').buildings, 12342);
  assert.equal(m.byCode.get('F2').buildings, null, 'an area the record omits has no count');
  const m2 = withDrawnCounts(m, new Map([['E4', 21342], ['A1', 5], ['F7', 9]]));
  assert.equal(m2.byCode.get('E4').buildings, 21342, 'E4 is not in the build record: the loader supplies it');
  assert.equal(m2.byCode.get('E2').buildings, 12342, 'others are kept');
  assert.equal(m2.byCode.get('A1').buildings, null, 'a skipped cell never gets a count');
  assert.equal(m2.shipping.find((c) => c.code === 'E4').buildings, 21342);
  assert.equal(m.byCode.get('E4').buildings, null, 'the original model is not mutated');
  assert.ok(cellLabel(m2.byCode.get('E4')).includes('21,342 buildings'));
});

test('the manager seam: a select event, and the view state read back from the manager', () => {
  assert.deepEqual(selectEventOf('F4', 12), { type: 'select', atMs: 12, sheet: 'F4' });
  const m = createSheetManager('full');
  m.dispatch({ type: 'start', atMs: 0, sheet: 'E4' });
  assert.equal(indexStateOf(m.state()).current, 'E4');
  const target = keyAction(M, 'E4', key('ArrowRight', true));
  assert.equal(target.type, 'select');
  const cmds = m.dispatch(selectEventOf(target.code, 100));
  assert.ok(!cmds.some((c) => c.type === 'refuse'), 'the manager accepts every sheet the index can emit');
  assert.equal(indexStateOf(m.state()).current, target.code);
  // and the manager refuses what the index never emits
  const skipped = M.cells.find((c) => c.state === 'skipped');
  assert.ok(m.dispatch(selectEventOf(skipped.code, 200)).some((c) => c.type === 'refuse'));
  // every shipping cell is a code the manager's topology knows, so no emitted select can be refused
  for (const c of M.shipping) assert.ok(T.has(c.code), c.code);
});

test('neighbourhood names: the committed file names every shipping area uniquely, and the UI prefers them', () => {
  const doc = JSON.parse(readFileSync(new URL('../../data/cities/amsterdam/area-names.json', import.meta.url), 'utf8'));
  const names = parseAreaNames(doc);
  const named = buildIndexModel(REAL, { names });
  for (const c of named.shipping) {
    const e = names.get(c.code);
    assert.ok(e, `${c.code} has an entry in area-names.json`);
    assert.equal(c.name, e.name, c.code);
    assert.equal(c.stadsdeel, REAL.sheets.find((s) => s.code === c.code).stadsdeel, 'grouping still follows the table stadsdeel');
    assert.equal(doc.areas[c.code].stadsdeel, c.stadsdeel, 'the names file agrees with the table');
    assert.ok(doc.areas[c.code].source.length > 0, `${c.code} records its source`);
  }
  const shown = named.shipping.map((c) => c.name);
  assert.equal(new Set(shown).size, shown.length, 'no two areas share a name');
  assert.equal(named.byCode.get('E4').name, 'Canal Ring');
  assert.deepEqual(named.groups.map((g) => [g.stadsdeel, g.cells.length]), M.groups.map((g) => [g.stadsdeel, g.cells.length]), 'names do not move any area between groups');
  // an area missing from the file falls back to the table label, and a malformed file changes nothing
  const partial = buildIndexModel(REAL, { names: new Map([['F4', { name: 'Test Wijk', stadsdeel: 'Oost' }]]) });
  assert.equal(partial.byCode.get('F4').name, 'Test Wijk');
  assert.equal(partial.byCode.get('G4').name, M.byCode.get('G4').name);
  for (const bad of [null, undefined, 3, 'x', {}, { areas: null }, { areas: { F4: { name: '' } } }, { areas: { F4: 7 } }]) {
    assert.equal(parseAreaNames(bad).size, 0, JSON.stringify(bad));
  }
  assert.equal(buildIndexModel(REAL, { names: parseAreaNames(null) }).byCode.get('F4').name, M.byCode.get('F4').name);
  // the label and the announcements carry the neighbourhood
  assert.ok(cellLabel(partial.byCode.get('F4')).startsWith('F4, Test Wijk, '));
  assert.ok(announceCurrent(partial.byCode.get('F4')).includes('F4, Test Wijk'));
});
