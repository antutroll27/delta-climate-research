// src/scripts/climate-engine/v2/sun-card.ts — OBOS v2 spec §3.8, H12. Owner: Track A (plan S4.1). Local SOLAR time, as the app says.
// Reads the data-* attributes the app writes on #sunLine (E4, spec C10); never parses the sentence beside them.
import { $, observe, type Cleanup } from './dom.ts';

export interface SunView { readonly up: boolean; readonly big: string; readonly unit: string; readonly line: string; readonly az: number | null; readonly el: number }

export function sunView(d: Readonly<Record<string, string | undefined>>): SunView | null {
  if (d.up === '1') {
    const az = Number(d.az), el = Number(d.el);
    if (d.az === undefined || d.el === undefined || !Number.isFinite(az) || !Number.isFinite(el)) return null;
    return { up: true, big: `${el}°`, unit: 'up', line: `${az}° azimuth · sets ${d.sets ?? ''}`, az, el };
  }
  if (d.up === '0') return { up: false, big: 'Below', unit: 'horizon', line: `rises ${d.rises ?? ''}`, az: null, el: 0 };
  return null;
}

export function bindSunCard(root: HTMLElement, cleanup: Cleanup): void {
  const line = $(root, '#sunLine'), note = $(root, '#sunLineNote');
  const big = $(root, '[data-sun="big"]'), unit = $(root, '[data-sun="unit"]'), sub = $(root, '[data-sun="line"]');
  const arc = $(root, '[data-sun="arc"]'), azg = $(root, '[data-sun="az"]'), body = $(root, '[data-sun="note"]');
  const card = $(root, '#v2SunCard');
  const paint = (): void => {
    const v = line ? sunView(line.dataset) : null;
    if (card) card.hidden = !v || line?.hasAttribute('hidden') === true;
    if (!v) return;
    if (big) { big.textContent = v.big; big.classList.toggle('thin-w', !v.up); }
    if (unit) unit.textContent = v.unit;
    if (sub) sub.textContent = v.line;
    if (arc) {
      const a = (v.el * Math.PI) / 180, cx = 4, cy = 22, r = 18;
      arc.innerHTML = `<line x1="1" y1="${cy}" x2="43" y2="${cy}" class="sg-h"/><path d="M${cx + r} ${cy}A${r} ${r} 0 0 0 ${cx} ${cy - r}" class="sg-arc"/>`
        + `<circle cx="${(cx + r * Math.cos(a)).toFixed(2)}" cy="${(cy - r * Math.sin(a)).toFixed(2)}" r="3.6" class="sg-sun${v.up ? '' : ' down'}"/>`;
    }
    if (azg) {
      azg.toggleAttribute('hidden', v.az === null);
      if (v.az !== null) azg.innerHTML = `<circle cx="13" cy="13" r="11" class="sg-ring"/><text x="13" y="6.2" class="sg-n" text-anchor="middle">N</text>`
        + `<g transform="rotate(${v.az} 13 13)"><line x1="13" y1="13" x2="13" y2="4.5" class="sg-needle"/><circle cx="13" cy="4.5" r="2.2" class="sg-sun"/></g><circle cx="13" cy="13" r="1.3" class="sg-hub"/>`;
    }
  };
  const paintNote = (): void => { if (body && note) body.textContent = note.getAttribute('title') ?? ''; };
  observe(cleanup, line, { attributes: true }, paint);
  observe(cleanup, note, { attributes: true, attributeFilter: ['title'] }, paintNote);
  paint(); paintNote();

  /* MapLibre's own scale control (heat-map-app.ts:388) moves into the card; it keeps updating in place. */
  const slot = $(root, '[data-v2-scale-slot]');
  const move = (): boolean => { const s = document.querySelector('.maplibregl-ctrl-scale'); if (s && slot && s.parentElement !== slot) slot.appendChild(s); return !!s; };
  if (!move()) { const mo = new MutationObserver(() => { if (move()) mo.disconnect(); }); mo.observe(root, { childList: true, subtree: true }); cleanup.push(() => mo.disconnect()); }
}
