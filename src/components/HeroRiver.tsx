import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { createRiverScene, type RiverScene } from '../scripts/river-scene';

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

    let visible = false;
    // render-gate: only render while on-screen and the tab is visible.
    const onTick = () => { if (visible && document.visibilityState !== 'hidden') scene.tick(); };

    if (reduce) {
      scene.onReady(() => scene.tick()); // one static frame, no ticker
    } else {
      gsap.ticker.add(onTick);
    }

    const io = new IntersectionObserver(
      (entries) => { visible = entries.some(e => e.isIntersecting); },
      { rootMargin: '200px' }
    );
    io.observe(canvas);

    const onResize = () => scene.resize();
    const onLost = (e: Event) => e.preventDefault();
    window.addEventListener('resize', onResize);
    canvas.addEventListener('webglcontextlost', onLost);

    return () => {
      gsap.ticker.remove(onTick);
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
