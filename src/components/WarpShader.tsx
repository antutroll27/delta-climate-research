import { Warp } from '@paper-design/shaders-react';

/**
 * Animated Warp shader for the footer brand card — palette-tuned to Delta
 * (deep teal → cyan → mid teal → light aqua). Rendered as a React island
 * (`client:visible`) so it only loads/animates when the footer scrolls in.
 * Under reduced-motion we render nothing — the card's CSS fallback gradient
 * (`.shader` background) shows instead.
 */
export default function WarpShader() {
  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return null;

  return (
    <Warp
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
      speed={0.6}
      colors={[
        'hsl(184, 62%, 9%)',
        'hsl(189, 53%, 64%)',
        'hsl(184, 45%, 22%)',
        'hsl(178, 55%, 78%)',
      ]}
    />
  );
}
