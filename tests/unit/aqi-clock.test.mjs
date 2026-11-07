import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { fixedClock, IST_CLOCK } from '../../src/lib/aqi/clock.ts';
import { istHourKey, istHours } from '../../src/lib/aqi/hours.ts';
import { archivePath } from '../../src/lib/aqi/relay-store.ts';
import { istStamp } from '../../src/lib/aqi/cpcb-feed.ts';
import { buildPayload } from '../../src/lib/aqi/build.ts';
import { cityTz, AREA_KEYS } from '../../src/scripts/climate-engine/scope/registry.ts';

/* THE FIVE COPIES OF `IST_MS = 5.5 h` ARE ONE CLOCK NOW, derived from the city's
   registered IANA zone. Kolkata and Bengaluru must be bit-for-bit what they were. */

test('IST derives to +05:30 exactly, and Kolkata and Bengaluru both resolve to it', () => {
  assert.equal(IST_CLOCK.offsetMs, 5.5 * 3_600_000);
  assert.equal(IST_CLOCK.isoSuffix, '+05:30');
  for (const k of AREA_KEYS.filter((k) => k.startsWith('in/'))) {
    assert.deepEqual(fixedClock(cityTz(k)), IST_CLOCK, k);
  }
  assert.equal(fixedClock('Asia/Dubai').offsetMs, 4 * 3_600_000);
  assert.equal(fixedClock('Asia/Dubai').isoSuffix, '+04:00');
  assert.equal(fixedClock('Asia/Tokyo').isoSuffix, '+09:00');
  assert.equal(fixedClock('UTC').isoSuffix, '+00:00');
});

test('a daylight-saving zone is REFUSED rather than handed a clock that is an hour out half the year', () => {
  assert.equal(cityTz('nl/amsterdam/canal-ring'), 'Europe/Amsterdam');
  assert.throws(() => fixedClock('Europe/Amsterdam'), /observes daylight saving \(\+01:00 \/ \+02:00\)/);
});

test('every Indian caller gets the identical hour keys, archive paths, stamps and payload it got with the typed offset', () => {
  const end = '2026-09-27T23:30:00Z';   // 05:00 IST next day: the date rolls
  assert.equal(istHourKey(end), '2026-09-28T04');
  assert.equal(istHourKey(end, IST_CLOCK), istHourKey(end));
  assert.equal(archivePath('2026-09-27T23:30:00+00:00'), 'cpcb/archive/2026/09/28/05.xml.gz');
  assert.equal(istStamp('27-09-2026 05:00:00'), '2026-09-26T23:30:00.000Z');
  const raw = [{ end_utc: end, value: 10 }, { end_utc: '2026-09-27T23:45:00Z', value: 20 }];
  assert.deepEqual([...istHours(raw)], [...istHours(raw, IST_CLOCK)]);
  const p = buildPayload('in/kolkata/ballygunge', null, {}, new Date('2026-09-28T00:00:00Z'));
  assert.equal(p.current.state, 'no_station');
});

test('no file in src/lib/aqi types the offset any more (clock.ts is the one place)', () => {
  const dir = 'src/lib/aqi/';
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.startsWith('._'))) {
    const code = readFileSync(dir + f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/\bIST_MS\b|5\.5 \*|\+05:30/.test(code), `${f} still types the Indian offset`);
  }
});
