/**
 * THE PAYBACK SHEET'S CONTROLLER (spec 2026-09-30-solar-roi §3.3). It owns the
 * sheet's inputs, recomputes on every change, and prints through solar-copy.ts.
 * It never formats money itself (money/rate are injected) and never stores the
 * tariff: that stays the Solar pane's, and the sheet writes through it, so the
 * card, the pane and the sheet can never disagree.
 *
 * Inputs are validated HERE, before solar-roi.ts sees them (it guards only size):
 * a cost must be in (0, COST_PER_KW_MAX] (a high–low pair is swapped and the swap is
 * said), units outside (0, UNITS_MAX] mean no bill mode (and the sheet says so), and
 * the tariff goes through the pane's own handler, which refuses anything outside
 * (0, TARIFF_MAX]. A result that is still not finite is not painted (`roiFinite`).
 */
import type { PvFile } from './types';
import type { SolarCostBasis } from './solar-cost.ts';
import { computeRoi, roofKwhPerKw, roofMaxKw, defaultSizeKw, suggestedSize, roiCsv, MIN_SYSTEM_KW,
  tariffOk, costOk, unitsOk, roiFinite, TARIFF_MAX, COST_PER_KW_MAX, UNITS_MAX,
  type Owner, type RoiResult, type ScenarioResult } from './solar-roi.ts';
import { paybackText, savingText, subsidyLine, assumptionsLine, sizingText, surplusText, flatCaveat, ESTIMATE_TAG, capFirst } from './solar-copy.ts';

export interface SheetDeps {
  readonly el: (id: string) => HTMLElement | null;
  readonly basis: SolarCostBasis;
  readonly money: (n: number) => string;
  readonly rate: (n: number) => string;
  readonly tariff: () => number;
  /** writes the Solar pane's tariff box and fires its input handler */
  readonly setTariff: (v: string) => void;
  readonly csvName: (idx: number) => string;
  /** opens the installer brief for the selected roof */
  readonly printBrief: () => void;
}

export interface SheetRoof { readonly idx: number; readonly pv: PvFile }

export interface PaybackSummary { readonly payback: string; readonly saving: string; readonly assume: string }

export interface PaybackSheet {
  open(roof: SheetRoof, opener: HTMLElement | null): void;
  close(): void;
  summaryFor(roof: SheetRoof): PaybackSummary | null;
  destroy(): void;
}

/** spec §5: a cost per kW outside this band is flagged "unusual" but still computed */
const UNUSUAL_LO = 20_000, UNUSUAL_HI = 150_000;
/** spec §3.3: bill mode warns when more than this share of generation is surplus */
const SURPLUS_WARN = 0.10;
/** The slider spans the household and small-business band; the number box beside it
    covers the whole roof (spec D5 refined: a 700 kW slider cannot be moved in half-kW). */
const SLIDER_MAX_KW = 20;
/** painted in place of a payback that did not compute to a finite number */
const OUT_OF_RANGE = 'Not computed: an input is out of range. Check the tariff, the cost and the units.';

export function mountPaybackSheet(d: SheetDeps): PaybackSheet {
  const { el } = d;
  const input = (id: string) => el(id) as HTMLInputElement | null;
  const H = d.basis.horizonYears.value;
  let owner: Owner = 'home';
  let cost: [number, number] = [d.basis.costPerKw.value[0], d.basis.costPerKw.value[1]];
  /** the last edit entered the pair high–low and it was swapped */
  let swapped = false;
  /** the cost boxes hold something that is not a positive number; the last good pair stands */
  let costBad = false;
  let units: number | null = null;
  /** the units box holds text that is not a positive number (empty is not bad: it is simple mode) */
  let unitsBad = false;
  let size = 3;
  /** the last size typed was outside [1, roof max] and was clamped */
  let clamped = false;
  let roof: SheetRoof | null = null;
  let opener: HTMLElement | null = null;
  let csvUrl = '';

  const setText = (id: string, s: string) => { const e = el(id); if (e) e.textContent = s; };
  const show = (id: string, on: boolean) => { const e = el(id); if (e) { if (on) e.removeAttribute('hidden'); else e.setAttribute('hidden', ''); } };
  const invalid = (id: string, bad: boolean) => input(id)?.setAttribute('aria-invalid', bad ? 'true' : 'false');
  const billUnits = (): number | null => (units !== null && units > 0 ? units : null);

  function result(r: SheetRoof, sizeKw: number): RoiResult {
    return computeRoi({ sizeKw, kwhPerKw: roofKwhPerKw(r.pv, r.idx), owner, costPerKw: cost,
      tariff: d.tariff(), unitsPerMonth: billUnits(), basis: d.basis });
  }
  function assume(r: RoiResult, sizeKw: number): string {
    return assumptionsLine({ owner, sizeKw, costPerKw: cost, subsidy: r.status === 'too_small' ? 0 : r.fast.subsidy,
      tariff: d.tariff(), unitsPerMonth: billUnits(), basis: d.basis }, d.money, d.rate);
  }
  function costNote(): string {
    const [lo, hi] = cost;
    const def = d.basis.costPerKw.value;
    const parts: string[] = [];
    if (costBad) parts.push(`A cost must be a positive number up to ${d.money(COST_PER_KW_MAX)} per kW; using the last good pair.`);
    if (swapped) parts.push('Entered high to low, so the two were swapped.');
    if (lo < UNUSUAL_LO || hi > UNUSUAL_HI) parts.push('An unusual cost per kW; still computed.');
    else if (lo === def[0] && hi === def[1]) {
      parts.push(`Default ${d.money(def[0])}–${d.money(def[1])} per kW, the 2026 market range. Edit it to match an installer's price.`);
    } else parts.push(`Your figures; the default was ${d.money(def[0])}–${d.money(def[1])} per kW.`);
    return parts.join(' ');
  }

  function paint(): void {
    if (!roof) return;
    const max = roofMaxKw(roof.pv, roof.idx);
    const r = result(roof, size);
    setText('spSizeOut', `${size.toFixed(1)} kW, of up to ${max.toFixed(1)} kW this roof can take`
      + (clamped ? `; sizes run from ${MIN_SYSTEM_KW} kW to the roof's ${max.toFixed(1)} kW, so yours was clamped` : ''));
    setText('spSubsidy', subsidyLine(owner, r.status === 'too_small' ? 0 : r.fast.subsidy, d.money));
    /* A sentence, not a figure, drops the big gold numeral style: words in shouting caps are a wall. */
    const words = (id: string, on: boolean) => el(id)?.classList.toggle('is-words', on);
    /* An overflowed figure is invalid input, never "∞": the ceilings should make this unreachable. */
    if (!roiFinite(r)) {
      setText('spPayback', OUT_OF_RANGE);
      setText('spSaving', '');
      words('spPayback', true); words('spSaving', true);
      setText('spAssume', assume(r, size));
      if (csvUrl) { URL.revokeObjectURL(csvUrl); csvUrl = ''; }
      return;
    }
    setText('spPayback', paybackText(r, H));
    setText('spSaving', capFirst(savingText(r, d.money, H)));
    words('spPayback', r.status !== 'ok' || r.slow.paybackYear === null);
    words('spSaving', r.status === 'too_small' || r.slow.net < 0);
    setText('spAssume', assume(r, size));
    setText('spCostNote', costNote());
    el('spCostNote')?.setAttribute('title', d.basis.costPerKw.source);
    /* Flat mode flatters a home in West Bengal (surplus earns nothing): say so, and point at the bill box. */
    const bill = billUnits();
    const caveat = bill === null ? flatCaveat(owner, d.basis) : '';
    setText('spFlat', caveat);
    show('spFlat', caveat !== '');
    if (bill !== null && r.status !== 'too_small') {
      const own = bill * 12;
      const share = (s: ScenarioResult) => {
        const k = s.years[0]?.kwh ?? 0;
        return k > 0 ? Math.max(0, k - own) / k : 0;
      };
      setText('spSizing', sizingText(bill, suggestedSize(bill, d.basis)));
      show('spSizing', true);
      const sh: [number, number] = [share(r.slow), share(r.fast)];
      setText('spWarn', surplusText(size, sh, d.tariff(), d.basis, d.rate));
      show('spWarn', Math.max(...sh) > SURPLUS_WARN);
    } else if (unitsBad) {
      setText('spSizing', `Units must be a positive number up to ${UNITS_MAX.toLocaleString()} a month; showing the simple estimate.`);
      show('spSizing', true);
      show('spWarn', false);
    } else {
      show('spSizing', false); show('spWarn', false);
    }
    /* The CSV is built on click from the figures as they are then; a stale blob is dropped. */
    if (csvUrl) { URL.revokeObjectURL(csvUrl); csvUrl = ''; }
  }

  /* One size, two controls. The slider stops at SLIDER_MAX_KW; a bigger size typed in
     the box parks the thumb at its end while the box's value is what is computed. */
  function setSize(v: number, from: 'slider' | 'box' | 'open'): void {
    if (!roof) return;
    const max = roofMaxKw(roof.pv, roof.idx);
    const c = Math.min(max, Math.max(MIN_SYSTEM_KW, v));
    clamped = from === 'box' && c !== v;
    size = c;
    const s = input('spSize'), n = input('spSizeNum');
    if (s && from !== 'slider') s.value = String(Math.min(size, Number(s.max) || SLIDER_MAX_KW));
    if (n && (from !== 'box' || clamped)) n.value = String(size);
    s?.setAttribute('aria-valuetext', `${size} kW`);
    n?.setAttribute('aria-invalid', 'false');
  }
  const onSize = () => {
    const v = Number(input('spSize')?.value);
    if (Number.isFinite(v) && v > 0) setSize(v, 'slider');
    paint();
  };
  /* `change` (commit), not `input`: clamping a half-typed "5" for "50" would fight the reader */
  const onSizeNum = () => {
    const n = input('spSizeNum');
    const v = Number(n?.value);
    /* `badInput`: the browser holds text it could not parse, and reports value as '' */
    if (!n || n.validity.badInput || n.value.trim() === '' || !Number.isFinite(v)) {
      n?.setAttribute('aria-invalid', 'true');
      setText('spSizeOut', 'Size must be a number of kW; keeping the last good size.');
      return;
    }
    setSize(v, 'box');
    paint();
  };
  const onOwner = (e: Event) => {
    const v = (e.target as HTMLInputElement).value;
    if (v === 'home' || v === 'society' || v === 'business') { owner = v; paint(); }
  };
  const onCost = () => {
    const a = Number(input('spCostLo')?.value), b = Number(input('spCostHi')?.value);
    const okA = costOk(a), okB = costOk(b);
    invalid('spCostLo', !okA);
    invalid('spCostHi', !okB);
    costBad = !(okA && okB);
    if (!costBad) {
      swapped = a > b;
      cost = swapped ? [b, a] : [a, b];
      /* the boxes show the pair as computed, so the note's "swapped" is visible */
      const lo = input('spCostLo'), hi = input('spCostHi');
      if (swapped && lo && hi) { lo.value = String(cost[0]); hi.value = String(cost[1]); }
    }
    paint();
  };
  const onTariff = () => {
    const raw = input('spTariff')?.value ?? '';
    const v = Number(raw);
    /* the pane's handler refuses the same values; this only marks the sheet's own box */
    invalid('spTariff', !tariffOk(v));
    d.setTariff(raw);
    paint();
  };
  const onUnits = () => {
    const box = input('spUnits');
    const raw = box?.value ?? '';
    const v = Number(raw);
    /* non-numeric text reads back as '' with validity.badInput set: that is bad input, not an empty box */
    const garbled = box?.validity.badInput === true;
    const ok = !garbled && raw.trim() !== '' && unitsOk(v);
    units = ok ? v : null;
    unitsBad = garbled || (raw.trim() !== '' && !ok);
    invalid('spUnits', unitsBad);
    paint();
  };
  const onCsv = (e: Event) => {
    if (!roof) { e.preventDefault(); return; }
    const r = result(roof, size);
    if (!roiFinite(r)) { e.preventDefault(); return; }
    /* every row carries the tag too: a downloaded sheet travels without the page around it */
    const csv = roiCsv(r, `${assume(r, size)} · ${ESTIMATE_TAG}`);
    if (!csv) { e.preventDefault(); return; }
    if (!csvUrl) csvUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = e.currentTarget as HTMLAnchorElement;
    a.href = csvUrl;
    a.download = d.csvName(roof.idx);
  };
  /* THE MODAL, #solBrief's pattern: everything else on the stage is inert while it is
     open. The brief is left alone: it opens FROM the sheet and must stay reachable. */
  const stageOthers = () => Array.from(document.querySelector('.stage')?.children ?? [])
    .filter((k) => k.id !== 'solPay' && k.id !== 'solBrief');
  const isOpen = () => el('solPay')?.hasAttribute('hidden') === false;
  function close(): void {
    if (!isOpen()) return;
    show('solPay', false);
    stageOthers().forEach((k) => k.removeAttribute('inert'));
    opener?.focus();
  }
  /* Escape closes the sheet and stops there: the app's window-level Escape would
     otherwise go on to deselect the roof the reader is returning to. */
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && isOpen()) { close(); e.stopPropagation(); } };
  const onPrint = () => { close(); d.printBrief(); };

  /* #spTariff's description: when its value is refused (the ceiling is the shared one) */
  setText('spTariffNote', `Refused unless more than 0 and at most ${d.rate(TARIFF_MAX)} per kWh; the last good tariff then stands.`);
  input('spSize')?.addEventListener('input', onSize);
  input('spSizeNum')?.addEventListener('change', onSizeNum);
  el('solPay')?.querySelectorAll<HTMLInputElement>('input[name="spOwner"]').forEach((r) => r.addEventListener('change', onOwner));
  input('spCostLo')?.addEventListener('change', onCost);
  input('spCostHi')?.addEventListener('change', onCost);
  input('spTariff')?.addEventListener('input', onTariff);
  input('spUnits')?.addEventListener('input', onUnits);
  el('spCsv')?.addEventListener('click', onCsv);
  el('spPrint')?.addEventListener('click', onPrint);
  el('spClose')?.addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  return {
    open(r, from) {
      const max = roofMaxKw(r.pv, r.idx);
      if (max < MIN_SYSTEM_KW) return;
      if (!roof || roof.idx !== r.idx || roof.pv !== r.pv) size = defaultSizeKw(max);
      roof = r;
      opener = from;
      const s = input('spSize'), n = input('spSizeNum');
      if (s) s.max = String(Math.min(SLIDER_MAX_KW, Math.floor(max * 2) / 2));
      if (n) n.max = String(max);
      setSize(size, 'open');
      const lo = input('spCostLo'), hi = input('spCostHi');
      if (lo) lo.value = String(cost[0]);
      if (hi) hi.value = String(cost[1]);
      invalid('spCostLo', false); invalid('spCostHi', false);
      costBad = false;
      swapped = false;
      const t = input('spTariff');
      if (t) t.value = d.tariff().toFixed(2);
      invalid('spTariff', false);
      /* the owner the radios show is the owner computed with */
      el('solPay')?.querySelectorAll<HTMLInputElement>('input[name="spOwner"]').forEach((k) => { k.checked = k.value === owner; });
      paint();
      show('solPay', true);
      stageOthers().forEach((k) => k.setAttribute('inert', ''));
      el('spClose')?.focus();
    },
    close,
    summaryFor(r) {
      const max = roofMaxKw(r.pv, r.idx);
      if (max < MIN_SYSTEM_KW) return null;
      const sz = roof && roof.idx === r.idx && roof.pv === r.pv ? size : defaultSizeKw(max);
      const res = result(r, sz);
      if (!roiFinite(res)) return null;
      return { payback: paybackText(res, H), saving: savingText(res, d.money, H), assume: assume(res, sz) };
    },
    destroy() {
      input('spSize')?.removeEventListener('input', onSize);
      input('spSizeNum')?.removeEventListener('change', onSizeNum);
      el('solPay')?.querySelectorAll<HTMLInputElement>('input[name="spOwner"]').forEach((r) => r.removeEventListener('change', onOwner));
      input('spCostLo')?.removeEventListener('change', onCost);
      input('spCostHi')?.removeEventListener('change', onCost);
      input('spTariff')?.removeEventListener('input', onTariff);
      input('spUnits')?.removeEventListener('input', onUnits);
      el('spCsv')?.removeEventListener('click', onCsv);
      el('spPrint')?.removeEventListener('click', onPrint);
      el('spClose')?.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
      if (csvUrl) URL.revokeObjectURL(csvUrl);
    },
  };
}
