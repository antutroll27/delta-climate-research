// A/B digest of everything Kolkata's and Bengaluru's Air card says, run in a tree; compare two trees' output.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { handle } from './api/air-quality.ts';
import { IST_CLOCK, fixedClock } from './src/lib/aqi/clock.ts';
import { istHourKey, istHours } from './src/lib/aqi/hours.ts';
import { istStamp } from './src/lib/aqi/cpcb-feed.ts';
import { archivePath } from './src/lib/aqi/relay-store.ts';
import { buildPayload } from './src/lib/aqi/build.ts';
import { isAirCity, isAirArea } from './src/lib/aqi/stations.ts';
import { cardHtml, paneHtml, statusText, loadAir } from './src/scripts/climate-engine/air/air-panel.ts';

const sha = (x) => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex').slice(0, 16);
const feeds = {
  '2026-09-27T05:00:00Z': ['in/kolkata/ballygunge', 'in/kolkata/barrackpore', 'in/kolkata/baruipur'],
  '2026-10-05T02:00:00Z': ['in/bengaluru/indiranagar', 'in/bengaluru/mg-road', 'in/bengaluru/whitefield'],
  '2026-10-05T18:00:00Z': ['in/bengaluru/indiranagar', 'in/bengaluru/whitefield'],
};
const files = { '2026-09-27T05:00:00Z': 'cpcb-feed-2026-09-27T0500IST.xml.gz', '2026-10-05T02:00:00Z': 'cpcb-feed-2026-10-05T0200IST.xml.gz', '2026-10-05T18:00:00Z': 'cpcb-feed-2026-10-05T1800IST.xml.gz' };
const nowOf = { '2026-09-27T05:00:00Z': '2026-09-27T00:20:00Z', '2026-10-05T02:00:00Z': '2026-10-04T21:00:00Z', '2026-10-05T18:00:00Z': '2026-10-05T12:45:00Z' };
const out = {};
const res = () => { const r = { code: 0, headers: {}, body: null, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k] = v; }, json(b) { r.body = b; } }; return r; };
for (const [k, areas] of Object.entries(feeds)) {
  const xml = gunzipSync(readFileSync('tests/fixtures/aqi/' + files[k])).toString('utf8');
  for (const a of areas) {
    const r = res();
    const origErr = console.error; console.error = () => {};
    await handle({ method: 'GET', query: { area: a } }, r, { key: 'k', now: () => new Date(nowOf[k]), cpcbFeed: true, source: 'direct',
      fetch: async (u) => (String(u).includes('cpcb.gov.in') ? new Response(xml, { status: 200 }) : new Response('x', { status: 503 })), feedCache: { entry: null, inflight: null }, cache: new Map(), inflight: new Map() });
    console.error = origErr;
    const now = new Date(nowOf[k]);
    const p = r.body;
    const ui = p.current ? { card: cardHtml(p, 'X', now), pane: paneHtml(p, 'X', now), status: statusText(p, 'X', now) } : null;
    const viaLoad = p.current ? await loadAir(a, 'X', { fetch: async () => ({ ok: true, json: async () => p }), signal: new AbortController().signal, isCurrent: () => true, now }) : null;
    out[`${k}|${a}`] = { code: r.code, headers: r.headers, body: sha(p), ui: ui && sha(ui), load: viaLoad && sha(viaLoad) };
  }
}
out.gates = { ba: isAirCity('in/kolkata/ballygunge'), bl: isAirCity('in/bengaluru/whitefield'), du: isAirCity('ae/dubai/creek'), unk: isAirArea('in/kolkata/nowhere') };
out.clock = { ist: IST_CLOCK, fixedDubai: fixedClock('Asia/Dubai'), k: istHourKey('2026-09-27T23:30:00Z'), arch: archivePath('2026-09-27T23:30:00+00:00'), st: istStamp('27-09-2026 05:00:00'),
  w: sha([...istHours([{ end_utc: '2026-09-27T23:30:00Z', value: 10 }, { end_utc: '2026-09-27T23:45:00Z', value: 20 }])]), np: sha(buildPayload('in/kolkata/ballygunge', null, {}, new Date('2026-09-28T00:00:00Z'))) };
let all = ''; for (const k of Object.keys(out).sort()) { all += k + ' ' + JSON.stringify(out[k]) + '\n'; }
console.log(all); console.log('TOTAL', sha(all));
