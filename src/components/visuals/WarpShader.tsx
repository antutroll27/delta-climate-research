import { useEffect, useRef, useState } from 'react';
import { Warp, type PaperShaderElement } from '@paper-design/shaders-react';
import { createFrameGate } from '../../utils/frame-gate';
import {
  beginRenderQualityMonitoring,
  getRenderQuality,
  subscribeRenderQuality,
  type RenderQualityProfile,
} from '../../utils/render-quality';

const WARP_SPEED = 0.6;
const WARP_PIXEL_RATIO_CAP = 1.25;
const WARP_INITIAL_PIXEL_BUDGET = Math.ceil(360 * 340 * WARP_PIXEL_RATIO_CAP ** 2);

// The footer card is deliberately soft and text-covered, so it does not need
// the library's default two-device-pixel minimum. Its pixel budget follows the
// card's CSS area, establishing a real 1.25x ceiling on high-DPI displays.
const WARP_MIN_PIXEL_RATIO = 1;
const WARP_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  antialias: false,
  powerPreference: 'high-performance',
};

/**
 * Animated Warp shader for the footer brand card — palette-tuned to Delta
 * (deep teal → cyan → mid teal → light aqua). Rendered as a React island
 * (`client:visible`) so it only loads/animates when the footer scrolls in.
 * Under reduced-motion we render nothing — the card's CSS fallback gradient
 * (`.shader` background) shows instead.
 */
export default function WarpShader() {
  const mountRef = useRef<HTMLDivElement>(null);
  const shaderRef = useRef<PaperShaderElement>(null);
  const animationFrame = useRef(0);
  const [isVisible, setIsVisible] = useState(false);
  const [quality, setQuality] = useState<RenderQualityProfile>(() => getRenderQuality());
  const [pixelBudget, setPixelBudget] = useState(WARP_INITIAL_PIXEL_BUDGET);
  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => subscribeRenderQuality(setQuality), []);

  useEffect(() => {
    const mount = mountRef.current;
    if (reduce || !mount) return;

    let visibilityObserver: IntersectionObserver | undefined;
    if ('IntersectionObserver' in window) {
      visibilityObserver = new IntersectionObserver(
        ([entry]) => setIsVisible(entry?.isIntersecting ?? false),
        { threshold: 0 },
      );
      visibilityObserver.observe(mount);
    } else {
      setIsVisible(true);
    }

    const syncPixelBudget = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (width <= 0 || height <= 0) return;
      const pixelRatio = Math.min(WARP_PIXEL_RATIO_CAP, quality.maxDevicePixelRatio);
      setPixelBudget(Math.ceil(width * height * pixelRatio ** 2));
    };
    const resizeObserver = 'ResizeObserver' in window
      ? new ResizeObserver(syncPixelBudget)
      : undefined;
    resizeObserver?.observe(mount);
    syncPixelBudget();

    return () => {
      visibilityObserver?.disconnect();
      resizeObserver?.disconnect();
    };
  }, [reduce, quality.maxDevicePixelRatio]);

  useEffect(() => {
    if (reduce || !isVisible) return;

    const frameGate = createFrameGate(quality.targetFps);
    const stopQualityMonitoring = beginRenderQualityMonitoring();
    let raf = 0;
    let lastRenderAt: number | undefined;

    const render = (timestamp: number) => {
      if (frameGate.shouldRender(timestamp)) {
        if (lastRenderAt !== undefined) {
          const elapsed = Math.min(timestamp - lastRenderAt, 50);
          animationFrame.current += elapsed * WARP_SPEED;
        }
        lastRenderAt = timestamp;
        shaderRef.current?.paperShaderMount?.setFrame(animationFrame.current);
      }
      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      stopQualityMonitoring();
    };
  }, [isVisible, reduce, quality.targetFps]);

  if (reduce) return null;

  return (
    <div ref={mountRef} style={{ width: '100%', height: '100%' }}>
      <Warp
        ref={shaderRef}
        style={{ width: '100%', height: '100%' }}
        proportion={0.45}
        softness={1}
        distortion={0.22}
        swirl={0.8}
        swirlIterations={10}
        shape="checks"
        shapeScale={0.08}
        scale={1.1}
        rotation={0}
        // Drive frames explicitly so high-refresh displays do not render this
        // decorative surface more than 60 times per second.
        speed={0}
        frame={0}
        minPixelRatio={WARP_MIN_PIXEL_RATIO}
        maxPixelCount={pixelBudget}
        webGlContextAttributes={WARP_CONTEXT_ATTRIBUTES}
        colors={[
          'hsl(184, 62%, 9%)',
          'hsl(189, 53%, 64%)',
          'hsl(184, 45%, 22%)',
          'hsl(178, 55%, 78%)',
        ]}
      />
    </div>
  );
}
