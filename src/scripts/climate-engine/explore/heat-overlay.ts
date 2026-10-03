/**
 * heat-overlay.ts — the editorial look's ground overlay: the heat field drawn as
 * a tint over the ground, plus the ground's contact shading and haze.
 *
 * THE SAME COLOUR MUST MEAN THE SAME TEMPERATURE. The ramp darkens as it heats
 * (cyan → sage → bronze → red), so anything that darkens the TINT makes a pixel
 * read as a hotter class than the field holds. Until 2026-10-03 the contact AO
 * and the haze multiplied the whole result, tint included (`col·a·k`), and the
 * pre-ship audit measured up to 12.7 % of top-down overlay pixels reading as a
 * different heat class at night. The model is 2-D and has no canyon effect — the
 * same objection that ruled out cast shadows — so a darker tint beside a block
 * would be a claim it cannot make.
 *
 * MOVING THE SHADING TO THE GROUND TERM IS NOT ENOUGH. The tint is translucent
 * (a ≈ 0.5), so the reader sees  c·a + ground·(1 − a): darken the ground under it
 * and the same pixel darkens, and reads hotter all the same. Measured on this
 * build, ground-only AO under the tint still moved 6.9 % (peak) and 11.8 %
 * (night) of top-down overlay pixels into another class. So:
 *
 *   · CONTACT AO FADES OUT WHEREVER THE TINT IS DRAWN (`1 − smoothstep(0, .08, a)`).
 *     With the heat surface on, the ground carries no contact shading at all;
 *     walls keep theirs (relief-renderer.ts, the editorial facade), which is
 *     what says "this block stands here". With the surface off (a = 0) the AO
 *     is plain ground shading, and there is no heat colour for it to falsify.
 *   · HAZE touches the ground term only. PREMULTIPLIED, with
 *     ONE / ONE_MINUS_SRC_ALPHA, writing
 *         rgb = c·a + (1 − a)·hazeCol·hz,   alpha = 1 − (1 − a)·k,   k = (1 − ao)(1 − hz)
 *     yields  c·a + (1 − a)·[dst·(1 − ao)(1 − hz) + hazeCol·hz]: the tint term
 *     `c·a` carries no k, and the ground drifts (≤ 3 %, Clay) toward a hazeCol
 *     that is within a few units of the paper.
 *
 * tests/unit/obos-look-correctness.test.mjs EVALUATES this shader's own
 * statements, from `float a=` to `gl_FragColor`, and holds both rules.
 *
 * Kept out of relief-renderer.ts so the material can be built and checked under
 * node without a map or a GL context.
 */
import * as THREE from 'three';
import { HAZE_GLSL } from './look-shading.ts';

/** The renderer's shared uniform holders the overlay reads. */
export interface HeatOverlayHolders {
  heat: { value: THREE.Texture };
  heatMin: { value: number };
  heatMax: { value: number };
  cooling: { value: number };
  /** Baked contact occlusion (look-shading.ts `makeContactAO`). */
  ao: { value: THREE.Texture };
  aoAmt: { value: number };
  aoW: { value: THREE.Vector2 };
  haze: { value: number };
  hazeCol: { value: THREE.Color };
  /** × the overlay's opacity, Clay only (look.ts `lookAmounts`). */
  opBoost: { value: number };
}

export const OVERLAY_VERT = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }';

/**
 * The heat field and the AO are sampled at the SAME `fuv`: both textures share
 * the field's texel convention (row 0 at the south edge), so the shading cannot
 * mirror against the tint.
 */
export const OVERLAY_FRAG = /* glsl */ `varying vec2 vUv; uniform sampler2D tT,tAO; uniform float uMin,uMax,uOp,uCool,uAOAmt,uHaze,uOpK; uniform vec3 uHazeCol; uniform vec2 uAOW;
        ${HAZE_GLSL}
        vec3 ramp(float t){ vec3 cA=vec3(.204,.412,.529),cB=vec3(.318,.635,.729),c0=vec3(.435,.792,.839),c1=vec3(.624,.725,.541),c2=vec3(.690,.553,.341),c3=vec3(.831,.420,.290),c4=vec3(.898,.282,.302);
          if(t<0.0) return t<-.20 ? mix(cB,cA,clamp((-t-.20)/.30,0.,1.)) : mix(c0,cB,-t/.20);
          return t<.35?mix(c0,c1,t/.35):t<.6?mix(c1,c2,(t-.35)/.25):t<.8?mix(c2,c3,(t-.6)/.2):mix(c3,c4,min((t-.8)/.2,1.)); }
        void main(){ vec2 fuv=vec2(vUv.x, 1.0-vUv.y); vec4 F=texture2D(tT, fuv); float t=clamp((F.r-uMin)/(uMax-uMin),-0.5,1.);
          float edge=smoothstep(0.0,0.16,min(min(vUv.x,1.0-vUv.x),min(vUv.y,1.0-vUv.y)));
          float cool=F.b*uCool; vec3 col=mix(ramp(t),vec3(.353,.722,.541),cool*.62);
          float a=min(.92,uOp*uOpK+cool*.16)*edge;
          vec2 ao2=texture2D(tAO, fuv).rg; float ao=clamp(ao2.r*uAOW.x+ao2.g*uAOW.y,0.,1.)*uAOAmt*edge*(1.-smoothstep(0.,.08,a));
          float hz=lookHaze()*uHaze*edge;
          float k=(1.-ao)*(1.-hz);
          gl_FragColor=vec4(col*a+(1.-a)*uHazeCol*hz, 1.-(1.-a)*k); }`;

/** The editorial ground overlay. `uOp` is the overlay's own (the layer tree's) opacity. */
export function makeHeatOverlay(h: HeatOverlayHolders): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    /* PREMULTIPLIED: the shader has already multiplied the tint by its alpha, so
       the source factor is ONE. SrcAlpha here would square the tint's alpha and
       the whole heat field would fade toward the ground. */
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      tT: h.heat, uMin: h.heatMin, uMax: h.heatMax, uOp: { value: 0.5 }, uCool: h.cooling,
      tAO: h.ao, uAOAmt: h.aoAmt, uHaze: h.haze, uHazeCol: h.hazeCol,
      uOpK: h.opBoost, uAOW: h.aoW,
    },
    vertexShader: OVERLAY_VERT,
    fragmentShader: OVERLAY_FRAG,
  });
}
