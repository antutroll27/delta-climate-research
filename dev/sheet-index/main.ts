import '../../src/styles/obos-v2/tokens.css';
import '../../src/styles/obos-v2/atoms.css';
import '../../src/styles/obos-v2/shell.css';
import '../../src/styles/obos-v2/screens/sheet-index.css';
import './harness.css';
import { createSheetManager, type ManagerCommand } from '../../src/scripts/climate-engine/streaming/sheet-manager.ts';
import { indexStateOf, selectEventOf } from '../../src/scripts/climate-engine/streaming/sheet-index.ts';
import { mountSheetIndex } from '../../src/scripts/climate-engine/streaming-host/sheet-index-view.ts';

const q = new URLSearchParams(location.search);
const root = document.getElementById('root')!;
root.dataset.theme = q.get('theme') === 'light' ? 'light' : 'dark';
if (q.get('cards') === 'plates') root.dataset.cards = 'plates';
const note = document.getElementById('note')!;
const LOAD_MS = Number(q.get('loadMs') ?? 700);

/* A fake host around the REAL sheet manager: every `load` is answered after LOAD_MS, so the pending state is visible. */
const manager = createSheetManager('full');
const selects: string[] = [];
const now = (): number => performance.now();
function run(cmds: readonly ManagerCommand[]): void {
  for (const c of cmds) {
    if (c.type === 'load') setTimeout(() => run(manager.dispatch({ type: 'load-finished', atMs: now(), requestId: c.requestId })), LOAD_MS);
    if (c.type === 'make-current' && c.outgoingMesh === 'keep-until-handover') setTimeout(() => run(manager.dispatch({ type: 'handover-done', atMs: now() })), 300);
    if (c.type === 'refuse') note.textContent = `manager refused ${c.sheet}`;
  }
  ui.update(indexStateOf(manager.state()));
}
const ui = mountSheetIndex(document.getElementById('mount')!, {
  onSelect: (code) => { selects.push(code); note.textContent = `select -> ${code}`; run(manager.dispatch(selectEventOf(code, now()))); },
});
run(manager.dispatch({ type: 'start', atMs: now(), sheet: (q.get('sheet') ?? 'E4') as never }));
setInterval(() => run(manager.dispatch({ type: 'tick', atMs: now() })), 250);

Object.assign(window, { __si: { ui, manager, selects } });
if (q.get('open') === '1') ui.open();
