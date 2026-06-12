// src/scripts/section-effects.ts
// Choreography for the redesigned 01 About / 02 Projects / 03 White Papers
// sections (Baffait-inspired): masked title reveals, scrub-blur word reveals,
// center-band row activation, the pinned Projects set piece (scroll-driven
// selection + mouse-tilt preview + pill cursor), and the Papers cursor chip.
//
// Lifecycle: initSectionEffects/destroySectionEffects are called from
// Base.astro alongside the scroll-effects pair. ScrollTriggers created here
// are killed globally by destroyScrollEffects; this module's destroy only
// needs to release its own event listeners (one AbortController).
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motionOK } from '../utils/motion';

gsap.registerPlugin(ScrollTrigger);

let ac: AbortController | undefined;

const isDesktop = () => window.matchMedia('(min-width: 821px)').matches;

/* ── split helpers ──────────────────────────────────────────────── */

// Wrap every word of [data-words] in a .w span (descends into <span class="em">
// accents). Guarded so a re-init never double-splits.
function splitWords(el: HTMLElement) {
  if (el.dataset.split) return;
  el.dataset.split = '1';
  const walk = (node: Node) => {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        (n.textContent || '').split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) {
            frag.appendChild(document.createTextNode(part));
            return;
          }
          const w = document.createElement('span');
          w.className = 'w';
          w.textContent = part;
          frag.appendChild(w);
        });
        n.parentNode?.replaceChild(frag, n);
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        walk(n);
      }
    });
  };
  walk(el);
}

// Split [data-roll] links into per-char rolling pairs (top + duplicate below).
function splitRollLinks() {
  document.querySelectorAll<HTMLAnchorElement>('[data-roll]').forEach((link) => {
    if (link.dataset.rolled) return;
    link.dataset.rolled = '1';
    const first = link.childNodes[0];
    if (!first || first.nodeType !== Node.TEXT_NODE) return;
    const text = first.textContent || '';
    const frag = document.createDocumentFragment();
    [...text].forEach((c, i) => {
      const ch = document.createElement('span');
      ch.className = 'ch';
      ch.style.setProperty('--i', String(i));
      const glyph = c === ' ' ? '&nbsp;' : c;
      ch.innerHTML = `<i>${glyph}</i><i class="dup">${glyph}</i>`;
      frag.appendChild(ch);
    });
    link.replaceChild(frag, first);
  });
}

/* ── projects pinned set piece ──────────────────────────────────── */

function initProjectsPin(signal: AbortSignal) {
  const wrap = document.getElementById('projects');
  const pin = wrap?.querySelector<HTMLElement>('.proj-pin');
  if (!wrap || !pin) return;

  const items = [...wrap.querySelectorAll<HTMLElement>('.proj-item')];
  const covers = [...wrap.querySelectorAll<HTMLElement>('.pcard .cover')];
  const segs = [...wrap.querySelectorAll<HTMLElement>('[data-seg]')];
  const metaL = wrap.querySelector<HTMLElement>('[data-pmeta]');
  const count = wrap.querySelector<HTMLElement>('[data-pcount]');
  const pcard = wrap.querySelector<HTMLAnchorElement>('.pcard');
  if (!items.length || !pcard) return;

  const n = items.length;
  let active = -1;

  const setActive = (idx: number) => {
    if (idx === active) return;
    active = idx;
    items.forEach((it, i) => {
      it.classList.toggle('active', i === idx);
      // fisheye push — distance from the active row
      const d = Math.abs(i - idx);
      gsap.to(it, {
        x: d === 0 ? 44 : d === 1 ? 14 : 0,
        duration: 0.5,
        ease: 'power2.out',
        overwrite: 'auto',
      });
    });
    covers.forEach((c, i) => c.classList.toggle('on', i === idx));
    const id = String(idx + 1).padStart(2, '0');
    if (metaL) metaL.textContent = `CASE — ${id}`;
    if (count) count.textContent = `${id} / ${String(n).padStart(2, '0')}`;
    const href = items[idx].getAttribute('href');
    if (href) pcard.setAttribute('href', href);
  };
  setActive(0);

  ScrollTrigger.create({
    trigger: wrap,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate: (self) => {
      const p = self.progress;
      setActive(Math.min(n - 1, Math.floor(p * n)));
      segs.forEach((s, i) => {
        const local = Math.min(1, Math.max(0, (p - i / n) / (1 / n)));
        s.style.transform = `scaleY(${local})`;
      });
    },
  });

  // mouse-tilt on the preview card
  gsap.set(pcard, { transformPerspective: 900 });
  const tiltX = gsap.quickTo(pcard, 'rotationY', { duration: 0.55, ease: 'power2.out' });
  const tiltY = gsap.quickTo(pcard, 'rotationX', { duration: 0.55, ease: 'power2.out' });
  pin.addEventListener(
    'mousemove',
    (e) => {
      const r = pcard.getBoundingClientRect();
      tiltX(((e.clientX - r.left) / r.width - 0.5) * 9);
      tiltY(((e.clientY - r.top) / r.height - 0.5) * -7);
    },
    { signal }
  );
  pin.addEventListener('mouseleave', () => { tiltX(0); tiltY(0); }, { signal });

  // pill cursor over the preview card
  const pill = wrap.querySelector<HTMLElement>('[data-pill]');
  if (pill) {
    gsap.set(pill, { xPercent: -50, yPercent: -50, scale: 0 });
    const px = gsap.quickTo(pill, 'x', { duration: 0.35, ease: 'power3.out' });
    const py = gsap.quickTo(pill, 'y', { duration: 0.35, ease: 'power3.out' });
    window.addEventListener('mousemove', (e) => { px(e.clientX); py(e.clientY); }, { signal });
    pcard.addEventListener(
      'mouseenter',
      () => gsap.to(pill, { scale: 1, duration: 0.35, ease: 'power3.out' }),
      { signal }
    );
    pcard.addEventListener(
      'mouseleave',
      () => gsap.to(pill, { scale: 0, duration: 0.3, ease: 'power3.in' }),
      { signal }
    );
  }
}

/* ── white papers cursor chip ───────────────────────────────────── */

function initPaperChip(signal: AbortSignal) {
  const section = document.getElementById('papers');
  const chip = section?.querySelector<HTMLElement>('[data-chip-el]');
  if (!section || !chip) return;

  const tag = chip.querySelector<HTMLElement>('.chip-tag');
  const chipCovers = [...chip.querySelectorAll<HTMLElement>('.cover')];
  gsap.set(chip, { xPercent: -50, yPercent: -62, scale: 0.85, rotation: -2, opacity: 0 });
  const cx = gsap.quickTo(chip, 'x', { duration: 0.45, ease: 'power3.out' });
  const cy = gsap.quickTo(chip, 'y', { duration: 0.45, ease: 'power3.out' });
  window.addEventListener('mousemove', (e) => { cx(e.clientX); cy(e.clientY); }, { signal });

  section.querySelectorAll<HTMLElement>('[data-chip]').forEach((row) => {
    row.addEventListener(
      'mouseenter',
      () => {
        const i = parseInt(row.dataset.chip || '1', 10) - 1;
        chipCovers.forEach((c, ci) => c.classList.toggle('on', ci === i));
        if (tag) tag.textContent = `FIG — WP/${String(i + 1).padStart(2, '0')}`;
        gsap.to(chip, { opacity: 1, scale: 1, rotation: 0, duration: 0.4, ease: 'power3.out' });
      },
      { signal }
    );
    row.addEventListener(
      'mouseleave',
      () => gsap.to(chip, { opacity: 0, scale: 0.85, rotation: -2, duration: 0.3, ease: 'power3.in' }),
      { signal }
    );
  });
}

/* ── init / destroy ─────────────────────────────────────────────── */

export function initSectionEffects() {
  if (!motionOK()) return;
  ac = new AbortController();
  const { signal } = ac;

  // masked title line reveals
  document.querySelectorAll<HTMLElement>('.sec-title[data-mask]').forEach((title) => {
    gsap.to(title.querySelectorAll('.ln > span'), {
      y: 0,
      duration: 1.05,
      ease: 'power3.out',
      stagger: 0.09,
      scrollTrigger: { trigger: title, start: 'top 86%' },
    });
  });

  // ghost index scrub-in (opacity/scale only — never fights the element's own
  // translate positioning)
  document.querySelectorAll<HTMLElement>('.ghost-index').forEach((g) => {
    gsap.fromTo(
      g,
      { opacity: 0, scale: 1.08 },
      {
        opacity: 1,
        scale: 1,
        ease: 'none',
        scrollTrigger: { trigger: g.parentElement ?? g, start: 'top 92%', end: 'top 42%', scrub: true },
      }
    );
  });

  // scrub-blur word reveals
  document.querySelectorAll<HTMLElement>('[data-words]').forEach((el) => {
    splitWords(el);
    el.querySelectorAll<HTMLElement>('.w').forEach((w) => {
      gsap.fromTo(
        w,
        { opacity: 0.08, filter: 'blur(7px)' },
        {
          opacity: 1,
          filter: 'blur(0px)',
          ease: 'none',
          scrollTrigger: { trigger: w, start: 'top 82%', end: 'top 58%', scrub: true },
        }
      );
    });
  });

  // center-band row activation (About pillars + Papers rows)
  document.querySelectorAll<HTMLElement>('[data-band]').forEach((row) => {
    ScrollTrigger.create({
      trigger: row,
      start: 'top 62%',
      end: 'bottom 38%',
      onToggle: (self) => {
        row.classList.toggle('active', self.isActive);
        const wipe = row.querySelector<HTMLElement>('[data-wipe]');
        if (wipe) {
          gsap.to(wipe, {
            clipPath: self.isActive ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)',
            duration: 0.6,
            ease: 'power3.out',
          });
        }
      },
    });
  });

  splitRollLinks();

  // desktop-only set pieces (pin choreography, cursors, tilt)
  if (isDesktop()) {
    initProjectsPin(signal);
    initPaperChip(signal);
  }

  ScrollTrigger.refresh();
}

export function destroySectionEffects() {
  // ScrollTriggers created here are killed by destroyScrollEffects (Base.astro
  // always tears both down together); this only releases event listeners.
  ac?.abort();
  ac = undefined;
}
