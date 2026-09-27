// tests/unit/aqi-cpcb-feed.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';

export const FEED_XML = gunzipSync(readFileSync(new URL('../fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz', import.meta.url))).toString('utf8');

test("CPCB's feed carries SUB-INDICES: the published AQI is the largest Avg, and the predominant pollutant is the one holding it", () => {
  let n = 0;
  for (const m of FEED_XML.matchAll(/<Station id="([^"]+)"[^>]*>([\s\S]*?)<\/Station>/g)) {
    const a = /Air_Quality_Index Value="(\d+)" Predominant_Parameter="([^"]*)"/.exec(m[2]);
    if (!a) continue;
    const avgs = [...m[2].matchAll(/Pollutant_Index id="([^"]+)" Min="[^"]*" Max="[^"]*" Avg="(\d+)"/g)].map(([, p, v]) => [p, Number(v)]);
    const max = Math.max(...avgs.map(([, v]) => v));
    assert.equal(Number(a[1]), max, `${m[1]}: AQI ${a[1]} is not the largest Avg ${max}`);
    assert.ok(avgs.some(([p, v]) => p === a[2] && v === max), `${m[1]}: ${a[2]} does not hold the largest Avg`);
    n++;
  }
  assert.equal(n, 442, 'the capture had 442 stations with a numeric AQI');
});
