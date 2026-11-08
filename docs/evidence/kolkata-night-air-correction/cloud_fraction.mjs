// stdin: [{raw, valid}] -> stdout: [cloudFraction | null]  (the product's own parseMetar + cloudFraction)
import { readFileSync } from 'node:fs';
import { parseMetar, cloudFraction } from '../../../src/lib/weather/metar.ts';
const inp = JSON.parse(readFileSync(0, 'utf8'));
const out = inp.map(({ raw, valid }) => {
  const m = parseMetar(raw, Date.parse(valid.replace(' ', 'T').replace(/Z?$/, 'Z')));
  return m ? cloudFraction(m) : null;
});
process.stdout.write(JSON.stringify(out));
