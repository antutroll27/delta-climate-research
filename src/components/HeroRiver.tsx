import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { createRiverScene, type RiverScene } from '../scripts/river-scene';
import { createFrameGate } from '../utils/frame-gate';

gsap.registerPlugin(ScrollTrigger);

// Hero river island. Owns the lifecycle (IntersectionObserver gate, visibility
// pause, contextlost, full dispose) like VortexShader, but renders the three.js
// scene off the SINGLE shared gsap.ticker (the same one driving Lenis in
// smooth-scroll.ts) — no second RAF, no second Lenis. The heavy scene lives in
// ../scripts/river-scene.ts; this is just the React shell.
export default function HeroRiver() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    let scene: RiverScene;
    try { scene = createRiverScene(canvas, { reduce }); }
    catch (e) { console.error('[HeroRiver] init failed', e); return; } // CSS base shows through

    scene.onReady(() => setLoaded(true));

    // ── scroll choreography: ONE ScrollTrigger scrubs the #hero-track and drives
    //    scene.setScrollProgress (dolly-dive → splash). It rides the EXISTING global
    //    Lenis (smooth-scroll.ts already wires lenis.on('scroll', ScrollTrigger.update))
    //    — no 2nd Lenis, no 2nd RAF. Built only on desktop + motion via matchMedia. ──
    const mm = gsap.matchMedia();
    let activeST: ScrollTrigger | undefined;
    let fadeEls: NodeListOf<HTMLElement> | null = null;
    const setProgress = (p: number) => {
      scene.setScrollProgress(p);
      const o = String(1 - gsap.utils.clamp(0, 1, (p - 0.25) / 0.4)); // overlays fade as the dive commits
      fadeEls?.forEach((el) => { el.style.opacity = o; });
    };
    scene.onReady(() => {
      const track = document.getElementById('hero-track');
      fadeEls = document.querySelectorAll<HTMLElement>('[data-hero-content]');
      if (!track) return;
      mm.add('(prefers-reduced-motion: no-preference) and (min-width: 768px)', () => {
        activeST = ScrollTrigger.create({
          trigger: track, start: 'top top', end: 'bottom bottom', scrub: 0.6,
          onUpdate: (self) => setProgress(self.progress),
        });
        ScrollTrigger.refresh();
        return () => { activeST?.kill(); activeST = undefined; setProgress(0); fadeEls?.forEach((el) => { el.style.opacity = ''; }); };
      });
    });

    let visible = false;
    const frameGate = createFrameGate(60);
    // render-gate: only render while on-screen and the tab is visible.
    const onTick = (time: number) => {
      if (visible && document.visibilityState !== 'hidden' && frameGate.shouldRender(time * 1000)) scene.tick();
    };

    if (reduce) {
      scene.onReady(() => scene.tick()); // one static frame, no ticker
    } else {
      gsap.ticker.add(onTick);
    }

    const io = new IntersectionObserver(
      (entries) => {
        const nextVisible = entries.some(e => e.isIntersecting);
        if (nextVisible && !visible) frameGate.reset();
        visible = nextVisible;
      },
      { rootMargin: '200px' }
    );
    io.observe(canvas);

    const onResize = () => scene.resize();
    const onLost = (e: Event) => e.preventDefault();
    window.addEventListener('resize', onResize);
    canvas.addEventListener('webglcontextlost', onLost);

    return () => {
      gsap.ticker.remove(onTick);
      mm.revert();                          // kills the scroll trigger + restores content opacity
      io.disconnect();
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('webglcontextlost', onLost);
      scene.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ width: '100%', height: '100%', display: 'block', opacity: loaded ? 1 : 0, transition: 'opacity 1.1s ease' }}
    />
  );
}
