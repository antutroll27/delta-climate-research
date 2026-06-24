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
  if (!motionOK() || !window.matchMedia('(min-width: 768px)').matches) return;
  const track = document.getElementById('hero-track');
  const nodes = [...document.querySelectorAll<HTMLElement>('.dfact')];
  if (!track || !nodes.length) return;

  const mods = await getClimateModules();
  if (myGen !== gen) return; // an init/teardown raced us during the await
  // resolve each fact's target value (live, else the inlined fallback)
  const facts = nodes.map((el) => {
    const key = el.dataset.key!;
    const dec = parseInt(el.dataset.dec || '0', 10);
    const thou = el.dataset.thou === 'true';
    let target = parseFloat(el.dataset.fb || '0');
    if (key === 'carbon_deadline_1') {
      const ts = mods?.carbon_deadline_1?.timestamp ? Date.parse(mods.carbon_deadline_1.timestamp) : DEADLINE_FALLBACK;
      target = Math.max(0, Math.floor((ts - Date.now()) / YEAR_MS));
    } else {
      const m = mods?.[key];
      if (m && m.initial != null) {
        const rate = typeof m.rate === 'number' ? m.rate : 0;
        const origin = m.timestamp ? Date.parse(m.timestamp) : Date.now();
        target = m.initial + rate * ((Date.now() - origin) / 1000);
      }
    }
    return { el, n: el.querySelector<HTMLElement>('[data-n]')!, dec, thou, target };
  });

  const START = 0.58, END = 0.92, seg = (END - START) / facts.length;
  st = ScrollTrigger.create({
    trigger: track, start: 'top top', end: 'bottom bottom', scrub: true,
    onUpdate: (self) => {
      const p = self.progress;
      facts.forEach((f, i) => {
        const a = START + i * seg, b = a + seg;
        const local = sm(a, b, p);
        f.el.style.opacity = String(Math.sin(Math.PI * local));        // fade in then out
        f.el.style.transform = `translateY(${(0.5 - local) * 70}px)`;  // gentle rise
        f.n.textContent = fmt(f.target * sm(a, a + seg * 0.55, p), f.dec, f.thou); // count up as you enter
      });
    },
  });
}

export function destroyDescentFacts() {
  gen++;
  st?.kill(); st = undefined;
  document.querySelectorAll<HTMLElement>('.dfact').forEach((el) => { el.style.opacity = ''; el.style.transform = ''; });
}
