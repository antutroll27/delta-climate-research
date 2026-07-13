import { useEffect, useRef, useState } from 'react';

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
  const [contextVersion, setContextVersion] = useState(0);
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
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('[vortex] shader compile failed', gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    };
    const vsh = compile(VERT, gl.VERTEX_SHADER);
    if (!vsh) return;
    const fsh = compile(FRAG, gl.FRAGMENT_SHADER);
    if (!fsh) { gl.deleteShader(vsh); return; }
    const prog = gl.createProgram();
    if (!prog) { gl.deleteShader(vsh); gl.deleteShader(fsh); return; }
    gl.attachShader(prog, vsh); gl.attachShader(prog, fsh); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[vortex] program link failed', gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog); gl.deleteShader(vsh); gl.deleteShader(fsh);
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    if (!buf) {
      gl.deleteProgram(prog); gl.deleteShader(vsh); gl.deleteShader(fsh);
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(prog, 'position');
    if (posLoc < 0) {
      gl.deleteBuffer(buf); gl.deleteProgram(prog); gl.deleteShader(vsh); gl.deleteShader(fsh);
      return;
    }
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
      if (propsRef.current.mouse === 0) return; // parallax off → no forced reflow
      const r = canvas.getBoundingClientRect();
      mousePos.x = (e.clientX - r.left) / r.width;
      mousePos.y = 1.0 - (e.clientY - r.top) / r.height;
    };

    const start = performance.now();
    let raf = 0;
    let running = false;
    let visible = false; // single source of truth for on-screen state (set by the IO)

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
    // mousemove is only attached while the loop runs, so off-screen instances cost nothing
    const startLoop = () => {
      if (running || reduce) return;
      running = true;
      window.addEventListener('mousemove', onMouse);
      raf = requestAnimationFrame(loop);
    };
    const stopLoop = () => {
      running = false;
      window.removeEventListener('mousemove', onMouse);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const io = new IntersectionObserver((entries) => {
      visible = entries.some(e => e.isIntersecting);
      if (visible && document.visibilityState !== 'hidden') startLoop();
      else stopLoop();
    }, { rootMargin: '200px' });
    io.observe(canvas);

    const onVis = () => {
      if (document.visibilityState === 'hidden') stopLoop();
      else if (visible) startLoop();
    };
    const onLost = (e: Event) => { e.preventDefault(); stopLoop(); };
    const onRestored = () => setContextVersion((version) => version + 1);

    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVis);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    if (reduce) draw(); // single static frame, no loop

    return () => {
      stopLoop(); // also removes the mousemove listener
      io.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      if (!gl.isContextLost()) {
        gl.deleteProgram(prog); gl.deleteShader(vsh); gl.deleteShader(fsh); gl.deleteBuffer(buf);
      }
    };
  }, [renderScale, contextVersion]);

  return <canvas ref={canvasRef} aria-hidden="true" style={{ width: '100%', height: '100%', display: 'block' }} />;
}
