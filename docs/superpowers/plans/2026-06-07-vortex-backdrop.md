# Tamed Liquid-Metal Vortex Backdrop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a subtle, on-brand, animated raymarched "liquid-metal vortex" WebGL backdrop behind the Hero, CtaClose, and Medni sections.

**Architecture:** One reusable raw-WebGL React island (`VortexShader.tsx`, zero new deps) mounted as a `z-0` layer behind each section's grain + content, with an IntersectionObserver rAF gate, reduced-motion static frame, and a CSS fallback gradient. A shared `.vortex-bg` class in `global.css` owns the wrapper/fallback; each section passes its own props.

**Tech Stack:** Astro 6 (static), React 19 island (`client:visible`), raw WebGL (GLSL), Tailwind v4 `@theme`, TypeScript strict (`astro check`).

**Testing note:** This project has **no unit-test runner** (verified: no vitest/jest/playwright). The verification gates for every task are: `npm run check` (strict typecheck), `npm run build` (production build), and **headless screenshots** via the script in Task 0. There is no TDD red/green cycle for a visual WebGL component — "the test fails first" is replaced by "the screenshot/typecheck shows the expected state." Commit after each task.

**Source of truth for the shader:** `previews/vortex.html` (already tuned & user-approved, variant b). The fragment shader and prop⇄uniform mapping below are ported verbatim from it.

---

## Task 0: Verification harness (screenshot script)

**Files:**
- Create: `previews/_shot-site.mjs` (dev-only scratch artifact; not committed)

This script boots nothing — it assumes a dev server is already running (`npm run dev`, default `http://localhost:4321`). It screenshots a full page and a specific section.

- [ ] **Step 1: Create the screenshot script**

```js
// previews/_shot-site.mjs — usage: node previews/_shot-site.mjs <url> <out.png> [reduceMotion]
import puppeteer from 'puppeteer-core';
const [,, url='http://localhost:4321/', out='previews/_site.png', reduce='0'] = process.argv;
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
if (reduce === '1') await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
const errs = []; page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERR '+e.message));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 2500)); // let islands hydrate + animate
await page.screenshot({ path: out, fullPage: true });
// Report how many <canvas> are actively sized (sanity for the islands)
const canvases = await page.$$eval('canvas', els => els.map(c => ({ w: c.width, h: c.height })));
await browser.close();
console.log('shot:', out, '| canvases:', JSON.stringify(canvases), '| errors:', errs.length?errs.join(' | '):'none');
```

- [ ] **Step 2: Verify puppeteer-core + Chrome are present**

Run: `ls node_modules/puppeteer-core >/dev/null && ls "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" >/dev/null && echo OK`
Expected: `OK` (both already installed this session). If missing: `npm install --no-save puppeteer-core`.

No commit (scratch artifact).

---

## Task 1: Create the `VortexShader` island

**Files:**
- Create: `src/components/VortexShader.tsx`

The fragment shader is ported verbatim from `previews/vortex.html`. The component reads live props through a ref (so static per-mount props are picked up without re-running WebGL setup), gates the rAF loop on an IntersectionObserver + `visibilitychange`, caps DPR at 1.5, renders the backing store at `renderScale`, renders a single static frame under reduced-motion, and tears down all GL resources + listeners on unmount.

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useRef } from 'react';

export interface VortexShaderProps {
  /** base teal hue in degrees */            hue?: number;
  /** color saturation 0..1 */               sat?: number;
  /** overall brightness multiplier */       bright?: number;
  /** surface noise amount */                complexity?: number;
  /** flow speed (forced 0 on reduced-motion) */ speed?: number;
  /** vortex twist strength */               twist?: number;
  /** horizontal column offset (-1..1; + = right) */ offsetX?: number;
  /** camera zoom */                         zoom?: number;
  /** darkness falloff (higher = darker/fainter) */ fog?: number;
  /** mouse-parallax influence (0 = off) */  mouse?: number;
  /** internal backing-store scale (perf) */ renderScale?: number;
}

const VERT = `attribute vec2 position;void main(){gl_Position=vec4(position,0.0,1.0);}`;

const FRAG = `precision highp float;
uniform float iTime; uniform vec2 iResolution; uniform vec2 iMouse;
uniform float uHue,uSat,uBright,uComplexity,uSpeed,uTwist,uOffX,uZoom,uFog,uMouse;
vec3 hsv2rgb(vec3 c){vec3 rgb=clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0);return c.z*mix(vec3(1.0),rgb,c.y);}
mat2 rotate2d(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
mat3 rotationMatrix(vec3 axis,float angle){axis=normalize(axis);float s=sin(angle),c=cos(angle),oc=1.0-c;
  return mat3(oc*axis.x*axis.x+c,oc*axis.x*axis.y-axis.z*s,oc*axis.z*axis.x+axis.y*s,
              oc*axis.x*axis.y+axis.z*s,oc*axis.y*axis.y+c,oc*axis.y*axis.z-axis.x*s,
              oc*axis.z*axis.x-axis.y*s,oc*axis.y*axis.z+axis.x*s,oc*axis.z*axis.z+c);}
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec2 mod289(vec2 x){return x-floor(x*(1.0/289.0))*289.0;}
vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);}
float snoise(vec2 v){const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i=floor(v+dot(v,C.yy));vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);
  vec4 x12=x0.xyxy+C.xxzz;x12.xy-=i1;i=mod289(i);
  vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));
  vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);m=m*m;m=m*m;
  vec3 x=2.0*fract(p*C.www)-1.0;vec3 h=abs(x)-0.5;vec3 ox=floor(x+0.5);vec3 a0=x-ox;
  m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
  vec3 g;g.x=a0.x*x0.x+h.x*x0.y;g.yz=a0.yz*x12.xz+h.yz*x12.yw;return 130.0*dot(m,g);}
float map(vec3 p){float t=iTime*uSpeed;float tw=uTwist*p.y;p.xz=rotate2d(tw)*p.xz;
  float disp=snoise(p.xy*3.0+t)*0.1*uComplexity;return length(p.xz)-0.5+disp;}
float rayMarch(vec3 ro,vec3 rd){float d=0.0;for(int i=0;i<64;i++){vec3 p=ro+rd*d;float ds=map(p);d+=ds;if(d>50.0||abs(ds)<0.001)break;}return d;}
vec3 getNormal(vec3 p){vec2 e=vec2(0.001,0.0);return normalize(vec3(map(p+e.xyy)-map(p-e.xyy),map(p+e.yxy)-map(p-e.yxy),map(p+e.yyx)-map(p-e.yyx)));}
void main(){
  vec2 uv=(gl_FragCoord.xy-0.5*iResolution.xy)/iResolution.y;
  uv.x-=uOffX; uv*=uZoom;
  float t=iTime*0.08;
  vec2 m=(iMouse-0.5)*uMouse + vec2(sin(t)*0.25, cos(t*1.3)*0.18);
  vec3 ro=vec3(0.0,0.0,-3.0); vec3 rd=normalize(vec3(uv,1.0));
  mat3 rot=rotationMatrix(normalize(vec3(m.y,m.x,0.0001)),length(m)*2.0);
  ro=rot*ro; rd=rot*rd;
  float d=rayMarch(ro,rd); vec3 col=vec3(0.0);
  if(d<50.0){vec3 p=ro+rd*d;vec3 n=getNormal(p);
    vec3 lightDir=normalize(vec3(1.0,1.0,-1.0));
    float diffuse=max(dot(n,lightDir),0.0);
    float fres=pow(1.0-max(dot(n,-rd),0.0),3.0);
    vec3 baseColor=hsv2rgb(vec3(uHue/360.0,uSat,0.8));
    vec3 refl=mix(vec3(0.5,0.6,0.62), baseColor*1.3, 0.4);
    col=baseColor*diffuse + refl*fres;
    col=mix(col,vec3(0.0),1.0-exp(-uFog*d));
    col*=uBright;
  }
  float a=clamp(max(col.r,max(col.g,col.b))*1.6,0.0,1.0);
  gl_FragColor=vec4(col,a);
}`;

const UNIFORM_NAMES = ['iTime','iResolution','iMouse','uHue','uSat','uBright','uComplexity','uSpeed','uTwist','uOffX','uZoom','uFog','uMouse'] as const;

export default function VortexShader({
  hue = 186, sat = 0.45, bright = 0.95, complexity = 1.0, speed = 0.35,
  twist = 5.0, offsetX = 0.55, zoom = 0.95, fog = 0.11, mouse = 0.0, renderScale = 0.6,
}: VortexShaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ hue, sat, bright, complexity, speed, twist, offsetX, zoom, fog, mouse });
  propsRef.current = { hue, sat, bright, complexity, speed, twist, offsetX, zoom, fog, mouse };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) return; // CSS fallback gradient shows

    const compile = (src: string, type: number): WebGLShader | null => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; }
      return s;
    };
    const vsh = compile(VERT, gl.VERTEX_SHADER);
    const fsh = compile(FRAG, gl.FRAGMENT_SHADER);
    if (!vsh || !fsh) return;
    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vsh); gl.attachShader(prog, fsh); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(prog)); return; }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const U: Record<string, WebGLUniformLocation | null> = {};
    for (const n of UNIFORM_NAMES) U[n] = gl.getUniformLocation(prog, n);

    const DPR = Math.min(1.5, window.devicePixelRatio || 1);
    const mousePos = { x: 0.5, y: 0.5 };

    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * DPR * renderScale));
      canvas.height = Math.max(1, Math.floor(h * DPR * renderScale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U.iResolution, canvas.width, canvas.height);
    };
    resize();

    const onMouse = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      mousePos.x = (e.clientX - r.left) / r.width;
      mousePos.y = 1.0 - (e.clientY - r.top) / r.height;
    };

    const start = performance.now();
    let raf = 0;
    let running = false;

    const draw = () => {
      const p = propsRef.current;
      const time = (performance.now() - start) / 1000;
      gl.uniform1f(U.iTime, time);
      gl.uniform2f(U.iMouse, mousePos.x, mousePos.y);
      gl.uniform1f(U.uHue, p.hue); gl.uniform1f(U.uSat, p.sat); gl.uniform1f(U.uBright, p.bright);
      gl.uniform1f(U.uComplexity, p.complexity); gl.uniform1f(U.uSpeed, reduce ? 0 : p.speed);
      gl.uniform1f(U.uTwist, p.twist); gl.uniform1f(U.uOffX, p.offsetX); gl.uniform1f(U.uZoom, p.zoom);
      gl.uniform1f(U.uFog, p.fog); gl.uniform1f(U.uMouse, p.mouse);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    const loop = () => { draw(); raf = requestAnimationFrame(loop); };
    const startLoop = () => { if (running || reduce) return; running = true; raf = requestAnimationFrame(loop); };
    const stopLoop = () => { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; };

    const inView = () => {
      const r = canvas.getBoundingClientRect();
      return r.bottom > -200 && r.top < window.innerHeight + 200;
    };

    const io = new IntersectionObserver((entries) => {
      const visible = entries.some(e => e.isIntersecting);
      if (visible && document.visibilityState !== 'hidden') startLoop();
      else stopLoop();
    }, { rootMargin: '200px' });
    io.observe(canvas);

    const onVis = () => {
      if (document.visibilityState === 'hidden') stopLoop();
      else if (inView()) startLoop();
    };
    const onLost = (e: Event) => { e.preventDefault(); stopLoop(); };

    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMouse);
    document.addEventListener('visibilitychange', onVis);
    canvas.addEventListener('webglcontextlost', onLost);

    if (reduce) draw(); // single static frame, no loop

    return () => {
      stopLoop();
      io.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouse);
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('webglcontextlost', onLost);
      if (!gl.isContextLost()) {
        gl.deleteProgram(prog); gl.deleteShader(vsh); gl.deleteShader(fsh); gl.deleteBuffer(buf);
      }
    };
  }, [renderScale]);

  return <canvas ref={canvasRef} aria-hidden="true" style={{ width: '100%', height: '100%', display: 'block' }} />;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: 0 errors, 0 warnings (strict). If `astro check` reports unused/implicit-any, fix inline.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/VortexShader.tsx
git commit -m "feat: VortexShader island — tamed liquid-metal WebGL backdrop"
```

---

## Task 2: Shared `.vortex-bg` wrapper class

**Files:**
- Modify: `src/styles/global.css` (append a small block)

A DRY wrapper used by all three sections: positions the layer at z-0, makes it non-interactive, provides the CSS fallback gradient (shown pre-hydration / no-JS / no-WebGL), and neutralizes the `<astro-island>` box so the canvas fills the wrapper.

- [ ] **Step 1: Append the class to `src/styles/global.css`**

Add at the end of the file:

```css
/* Vortex backdrop wrapper — z-0 layer behind grain (z-1) + content (z-2).
   Fallback gradient shows pre-hydration / no-JS / no-WebGL. */
.vortex-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(60% 80% at 78% 50%, rgb(111 202 214 / 0.10), transparent 60%),
    var(--color-base);
}
/* Astro wraps the island in <astro-island>; collapse it so the canvas's
   containing block is .vortex-bg (which is sized via inset:0). */
.vortex-bg astro-island { display: contents; }
```

- [ ] **Step 2: Build to confirm CSS compiles**

Run: `npm run build`
Expected: build completes, no PostCSS/Tailwind errors.

- [ ] **Step 3: Commit**

```bash
git add src/styles/global.css
git commit -m "feat: shared .vortex-bg wrapper class + fallback gradient"
```

---

## Task 3: Mount in Hero

**Files:**
- Modify: `src/components/Hero.astro`

Hero is already `relative min-h-dvh overflow-hidden`; grain is `z-1`, content `z-[2]`. Insert the vortex layer as the first child (z-0), behind grain.

- [ ] **Step 1: Add the import to the frontmatter**

In `src/components/Hero.astro`, change the frontmatter from:

```astro
---
// Hero — Section 1. Static background (animated field archived in attic/hero-v1).
// taste-skill discipline: <=4 text elements, headline <=2 lines, no scroll cue, no CTA.
const pre = ['Navigating', 'the', 'systems', 'of', 'a'];
---
```

to:

```astro
---
// Hero — Section 1. Static background (animated field archived in attic/hero-v1).
// taste-skill discipline: <=4 text elements, headline <=2 lines, no scroll cue, no CTA.
import VortexShader from './VortexShader';
const pre = ['Navigating', 'the', 'systems', 'of', 'a'];
---
```

- [ ] **Step 2: Insert the vortex layer before the grain**

Change:

```astro
<section id="hero" class="relative min-h-dvh overflow-hidden flex flex-col justify-end bg-base" aria-label="Introduction">
  <div class="grain" aria-hidden="true"></div>
```

to:

```astro
<section id="hero" class="relative min-h-dvh overflow-hidden flex flex-col justify-end bg-base" aria-label="Introduction">
  <div class="vortex-bg" aria-hidden="true" style="opacity:0.85">
    <VortexShader client:visible offsetX={0.55} />
  </div>
  <div class="grain" aria-hidden="true"></div>
```

> Note: overall visibility is owned by the **wrapper** via inline `style="opacity:..."` (exact value). `VortexShader` has no `opacity` prop — do not pass one.

- [ ] **Step 3: Typecheck + build**

Run: `npm run check && npm run build`
Expected: 0 errors; build completes.

- [ ] **Step 4: Screenshot the hero (dev server running in another shell: `npm run dev`)**

Run: `node previews/_shot-site.mjs http://localhost:4321/ previews/_hero.png`
Expected console: `canvases: [{"w":...,"h":...}]` with non-zero dims; `errors: none`.
Open `previews/_hero.png`: the teal vortex column sits in the right third, the headline is fully legible.

- [ ] **Step 5: Commit**

```bash
git add src/components/Hero.astro
git commit -m "feat: mount vortex backdrop in Hero"
```

---

## Task 4: Mount in CtaClose

**Files:**
- Modify: `src/components/CtaClose.astro`

Wrapper is `section divider-top relative text-center` — add `overflow-hidden`. Content `.wrap` must sit above the canvas → `relative z-[1]`. Centered text, so push the column to the right edge and keep it fainter.

- [ ] **Step 1: Add the import to the frontmatter**

Change:

```astro
---
// Section 6 — closing conversion beat (single ask).
---
```

to:

```astro
---
// Section 6 — closing conversion beat (single ask).
import VortexShader from './VortexShader';
---
```

- [ ] **Step 2: Add `overflow-hidden`, the vortex layer, and lift `.wrap`**

Change:

```astro
<section id="access" class="section divider-top relative text-center" aria-labelledby="cta-title">
  <span class="draw-line" data-draw aria-hidden="true"></span>
  <div class="wrap flex flex-col items-center" data-reveal-group data-stagger="90">
```

to:

```astro
<section id="access" class="section divider-top relative overflow-hidden text-center" aria-labelledby="cta-title">
  <div class="vortex-bg" aria-hidden="true" style="opacity:0.6">
    <VortexShader client:visible offsetX={0.7} fog={0.13} />
  </div>
  <span class="draw-line" data-draw aria-hidden="true"></span>
  <div class="wrap relative z-[1] flex flex-col items-center" data-reveal-group data-stagger="90">
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run check && npm run build`
Expected: 0 errors; build completes.

- [ ] **Step 4: Screenshot CtaClose**

Run: `node previews/_shot-site.mjs http://localhost:4321/ previews/_cta.png`
Expected: `errors: none`. Open `previews/_cta.png`, scroll to the closing section: faint teal vortex at the right edge; CTA heading/button fully legible and centered.

- [ ] **Step 5: Commit**

```bash
git add src/components/CtaClose.astro
git commit -m "feat: mount vortex backdrop in CtaClose"
```

---

## Task 5: Mount in Medni

**Files:**
- Modify: `src/components/Medni.astro`

Wrapper is `section divider-top` (no `relative`) — add `relative overflow-hidden`. Both `.wrap` blocks must sit above the canvas → `relative z-[1]`. The dashboard is a strong element, so keep the vortex faint and far right.

- [ ] **Step 1: Add the import to the frontmatter**

Change:

```astro
---
// Section 5 — Medni: the interactive data bank (product highlight).
// Map + map-island mount later; this is the dashboard shell structure.
---
```

to:

```astro
---
// Section 5 — Medni: the interactive data bank (product highlight).
// Map + map-island mount later; this is the dashboard shell structure.
import VortexShader from './VortexShader';
---
```

- [ ] **Step 2: Add `relative overflow-hidden` + the vortex layer, lift both `.wrap` blocks**

Change the section open + first wrap:

```astro
<section id="medni" class="section divider-top" aria-labelledby="medni-title">
  <span class="draw-line" data-draw aria-hidden="true"></span>
  <div class="wrap mb-head-mb" data-reveal>
```

to:

```astro
<section id="medni" class="section divider-top relative overflow-hidden" aria-labelledby="medni-title">
  <div class="vortex-bg" aria-hidden="true" style="opacity:0.5">
    <VortexShader client:visible offsetX={0.78} fog={0.16} />
  </div>
  <span class="draw-line" data-draw aria-hidden="true"></span>
  <div class="wrap relative z-[1] mb-head-mb" data-reveal>
```

Then change the second wrap (the dashboard container):

```astro
  <div class="wrap">
    <!-- data-clip owns the entrance (wipe + fade); no data-reveal, so the GSAP
         clip and the IntersectionObserver reveal never co-own opacity. -->
    <div class="dashboard" data-clip style="--clip-radius: 16px;">
```

to:

```astro
  <div class="wrap relative z-[1]">
    <!-- data-clip owns the entrance (wipe + fade); no data-reveal, so the GSAP
         clip and the IntersectionObserver reveal never co-own opacity. -->
    <div class="dashboard" data-clip style="--clip-radius: 16px;">
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run check && npm run build`
Expected: 0 errors; build completes.

- [ ] **Step 4: Screenshot Medni**

Run: `node previews/_shot-site.mjs http://localhost:4321/ previews/_medni.png`
Expected: `errors: none`. Open `previews/_medni.png`, scroll to Medni: very faint teal vortex at the far right; the dashboard/map and heading fully legible and unobstructed.

- [ ] **Step 5: Commit**

```bash
git add src/components/Medni.astro
git commit -m "feat: mount vortex backdrop in Medni"
```

---

## Task 6: Reduced-motion, perf gate, and per-section tuning pass

**Files:**
- Modify (only if a screenshot shows a value needs nudging): `src/components/Hero.astro`, `src/components/CtaClose.astro`, `src/components/Medni.astro` (the `offsetX` / `fog` props and the wrapper `opacity`).

This task verifies the three cross-cutting requirements and fine-tunes intensity on the real site.

- [ ] **Step 1: Reduced-motion — static frame, no errors**

Run: `node previews/_shot-site.mjs http://localhost:4321/ previews/_reduce.png 1`
Expected: `errors: none`; `previews/_reduce.png` shows the vortex present (a single static frame), not blank. Confirm in the browser (DevTools → Rendering → Emulate `prefers-reduced-motion: reduce`, reload) that no animation occurs and the page is otherwise unchanged.

- [ ] **Step 2: Perf gate — only the in-view section's loop runs**

With `npm run dev` running, open `http://localhost:4321/` in Chrome. Open DevTools → Performance monitor (or Console). Paste this probe and scroll:

```js
// Logs how many vortex canvases currently have an active rAF by sampling draw activity.
// Simpler proxy: count <canvas> elements and confirm only ~1 section is near viewport.
[...document.querySelectorAll('canvas')].length
```

Expected: 3 canvases exist, but while scrolled to the Hero, CtaClose/Medni are >200px off-screen so their loops are paused (IntersectionObserver). Confirm via DevTools Performance recording that GPU/script activity drops when all three are scrolled away (e.g. mid-page gaps). No more than one vortex loop active at typical scroll positions.

- [ ] **Step 3: View-transition re-hydration — no leaks**

Navigate `/` → `/white-papers` → back to `/` (the site uses Astro view transitions). After returning, run in the console:

```js
[...document.querySelectorAll('canvas')].map(c => `${c.width}x${c.height}`)
```

Expected: canvases are re-created at non-zero sizes; the page console shows no `webglcontextlost` errors and no "too many WebGL contexts" warnings.

- [ ] **Step 4: Mobile full-bleed check**

Run: `node previews/_shot-site.mjs http://localhost:4321/ previews/_mobile.png` after editing the script's viewport to `{ width: 390, height: 844, deviceScaleFactor: 2 }` (or use DevTools device mode). Expected: vortex scales full-bleed within each section; no horizontal scrollbar / overflow; text legible.

- [ ] **Step 5: Tune if needed**

If any section reads too strong/weak or the column overlaps text, adjust ONLY these knobs and re-screenshot:
- wrapper `style="opacity:..."` (overall visibility),
- `offsetX` prop (push column further off-center; larger magnitude = further right/left),
- `fog` prop (higher = darker/fainter).
Re-run the relevant screenshot from Tasks 3–5 until it reads as a subtle presence with fully legible content.

- [ ] **Step 6: Final typecheck + build**

Run: `npm run check && npm run build`
Expected: 0 errors; build completes.

- [ ] **Step 7: Commit (only if Step 5 changed files)**

```bash
git add src/components/Hero.astro src/components/CtaClose.astro src/components/Medni.astro
git commit -m "tune: per-section vortex intensity + position"
```

---

## Finalize

After all tasks: use **superpowers:finishing-a-development-branch** to wrap up. Then (per the user's standing workflow) merge to `main` and deploy with `vercel --prod --yes` — **only when the user says to ship**.

## Verification checklist (maps to spec)

- [ ] `VortexShader.tsx` created — raw WebGL, typed, no new deps (Task 1).
- [ ] Locked teal, auto-drift, off-center, luminance-alpha, 64 steps — ported from `previews/vortex.html` (Task 1, FRAG).
- [ ] IntersectionObserver rAF gate + `visibilitychange` pause + DPR cap 1.5 + `renderScale` 0.6 (Task 1).
- [ ] Reduced-motion → single static frame; no-WebGL → CSS fallback (Task 1 + Task 2 + Task 6 Step 1).
- [ ] Shared `.vortex-bg` + fallback gradient (Task 2).
- [ ] Mounted in Hero / CtaClose / Medni with per-section props + `.wrap` z-lift (Tasks 3–5).
- [ ] Perf gate, view-transition, mobile verified (Task 6).
- [ ] `npm run check && npm run build` green (every task).
