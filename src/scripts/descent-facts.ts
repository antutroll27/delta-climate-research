// src/scripts/descent-facts.ts
// Drives the DescentFacts overlay: resolves live Climate Clock values, then a single
// scrub ScrollTrigger on #hero-track surfaces each fact in turn (fade + count-up) across
// the dark-water descent. Desktop + motion only; independent of the engulf + seam-snap.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motionOK } from '../utils/motion';
import { getClimateModules } from './climate-clock';

gsap.registerPlugin(ScrollTrigger);

let st: ScrollTrigger | undefined;
let gen = 0;
const YEAR_MS = 365.25 * 24 * 3600 * 1000;
const DEADLINE_FALLBACK = Date.parse('2029-07-22T16:00:00+00:00');

const sm = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const fmt = (v: number, d: number, t: boolean) => d > 0 ? v.toFixed(d) : (t ? Math.round(v).toLocaleString('en-US') : String(Math.round(v)));

export async function initDescentFacts() {
  destroyDescentFacts();
  const myGen = ++gen;
  const track = document.getElementById('hero-track');
  const nodes = [...document.querySelectorAll<HTMLElement>('[data-dfact]')];
  if (!nodes.length) return;

  const mods = await getClimateModules();
  if (myGen !== gen) return; // an init/teardown raced us during the await
  // Resolve every animated and static copy from the same live value, falling
  // back to the build-time number when the network is unavailable.
  const facts = nodes.map((el) => {
    const key = el.dataset.key!;
    const dec = parseInt(el.dataset.dec || '0', 10);
    const thou = el.dataset.thou === 'true';
    let target = parseFloat(el.dataset.fb || '0');
    if (key === 'carbon_deadline_1') {
      const candidate = mods?.carbon_deadline_1?.timestamp
        ? Date.parse(mods.carbon_deadline_1.timestamp)
        : DEADLINE_FALLBACK;
      const ts = Number.isFinite(candidate) ? candidate : DEADLINE_FALLBACK;
      target = Math.max(0, Math.floor((ts - Date.now()) / YEAR_MS));
    } else {
      const m = mods?.[key];
      if (m && m.initial != null) {
        const initial = Number(m.initial);
        const rate = Number(m.rate ?? 0);
        const origin = m.timestamp ? Date.parse(m.timestamp) : Date.now();
        if (Number.isFinite(initial) && Number.isFinite(rate) && Number.isFinite(origin)) {
          target = initial + rate * ((Date.now() - origin) / 1000);
        }
      }
    }
    const n = el.querySelector<HTMLElement>('[data-n]')!;
    n.textContent = fmt(target, dec, thou);
    return { el, n, dec, thou, target };
  });

  if (!track || !motionOK() || !window.matchMedia('(min-width: 768px)').matches) return;
  const animatedFacts = facts.filter((fact) => fact.el.classList.contains('dfact'));
  if (!animatedFacts.length) return;

  const START = 0.58, END = 0.92, seg = (END - START) / animatedFacts.length;

  /**
   * How far into a fact's segment the count-up finishes, as a fraction of it.
   *
   * THE NUMBER IS A FUNCTION OF SCROLL POSITION, so wherever a reader stops is
   * the value they are left looking at. This was 0.55 — the count finished at
   * the same moment the fact reached full opacity — which meant 54 % of the time
   * a fact was legible (opacity > 0.5) it was showing the WRONG figure, by up to
   * 78 %. Stopping mid-descent left "$18 Trillion" on screen against a true 32,
   * at 81 % opacity. Multiple people reported it, and a screenshot taken there
   * captures a claim we do not make.
   *
   * At 0.15 the count completes while the fact is still fading in, at opacity
   * 0.45 — so by the time it is legible it is already true. Measured over the
   * legible window: 0 % wrong, worst visible error 0 %.
   *
   * The count-up survives as a flourish during the fade rather than the main
   * event. That is the trade: this is a one-constant fix for the reported bug,
   * not the full one. It does NOT address scrolling UP counting DOWN, which is
   * the same root cause — a displayed value derived from scroll position rather
   * than from which fact is showing.
   */
  const COUNT_DONE_AT = 0.15;
  st = ScrollTrigger.create({
    trigger: track, start: 'top top', end: 'bottom bottom', scrub: true,
    onUpdate: (self) => {
      const p = self.progress;
      animatedFacts.forEach((f, i) => {
        const a = START + i * seg, b = a + seg;
        const local = sm(a, b, p);
        f.el.style.opacity = String(Math.sin(Math.PI * local));        // fade in then out
        f.el.style.transform = `translateY(${(0.5 - local) * 70}px)`;  // gentle rise
        f.n.textContent = fmt(f.target * sm(a, a + seg * COUNT_DONE_AT, p), f.dec, f.thou); // count up as you enter
      });
    },
  });
}

export function destroyDescentFacts() {
  gen++;
  st?.kill(); st = undefined;
  document.querySelectorAll<HTMLElement>('.dfact').forEach((el) => { el.style.opacity = ''; el.style.transform = ''; });
}
