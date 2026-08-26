"use client";
/*
 * OpenFlow ambient flow shader — a WebGL fragment shader painting warm light
 * (hotter on the ember) drifting over a near-black ground, behind the welcome
 * screen. Degrades to a static warm radial gradient if WebGL is unavailable,
 * and freezes under prefers-reduced-motion.
 */
import { useEffect, useRef } from "react";

const FRAG = [
  "precision highp float;",
  "uniform float u_time; uniform vec2 u_res;",
  "float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}",
  "float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);",
  " return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y);}",
  "float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.0+vec2(1.7,9.2);a*=0.5;}return v;}",
  "void main(){",
  " vec2 uv=gl_FragCoord.xy/u_res;",
  " float asp=u_res.x/max(u_res.y,1.0);",
  " vec2 p=vec2(uv.x*asp,uv.y)*2.4;",
  " float t=u_time*0.05;",
  " vec2 q=vec2(fbm(p+vec2(0.0,t)),fbm(p+vec2(3.4,-t*1.1)));",
  " float f=fbm(p+2.2*q+vec2(t*0.6,t*0.2));",
  " vec3 ground=vec3(0.045,0.036,0.031);",
  " vec3 red=vec3(0.80,0.24,0.11);",
  " vec3 ember=vec3(1.00,0.53,0.14);",
  " vec3 coral=vec3(0.90,0.47,0.33);",
  " vec3 mag=vec3(0.56,0.22,0.34);",
  " vec3 warm=mix(red,ember,smoothstep(0.14,0.55,f));",
  " warm=mix(warm,coral,smoothstep(0.62,0.92,q.y)*0.78);",
  " warm=mix(warm,mag,smoothstep(0.74,1.0,q.x)*0.68);",
  " float glow=smoothstep(0.22,0.92,f);",
  " vec3 col=mix(ground,warm,glow*0.95);",
  " col+=ember*smoothstep(0.68,1.0,f)*0.28;",
  " float vfade=smoothstep(0.0,0.32,uv.y)*smoothstep(1.0,0.62,uv.y);",
  " col*=mix(0.48,1.05,vfade);",
  " col*=0.70+0.30*smoothstep(1.15,0.15,length(uv-0.5));",
  " gl_FragColor=vec4(col,1.0);",
  "}",
].join("\n");

const VERT = "attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}";

export function OpenFlowShader({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let gl: WebGLRenderingContext | null = null;
    try {
      gl = (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    } catch { gl = null; }
    if (!gl) {
      canvas.style.background = "radial-gradient(120% 100% at 50% 30%, #2a1710, #0b0908)";
      return;
    }

    const compile = (type: number, src: string) => {
      const s = gl!.createShader(type);
      if (!s) return null;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) return null;
      return s;
    };
    const v = compile(gl.VERTEX_SHADER, VERT);
    const fsh = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!v || !fsh) {
      canvas.style.background = "radial-gradient(120% 100% at 50% 30%, #2a1710, #0b0908)";
      return;
    }
    const prog = gl.createProgram()!;
    gl.attachShader(prog, v);
    gl.attachShader(prog, fsh);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uTime = gl.getUniformLocation(prog, "u_time");
    const uRes = gl.getUniformLocation(prog, "u_res");

    let raf = 0;
    let start = 0;
    const frame = (ts: number) => {
      if (!start) start = ts;
      gl!.uniform1f(uTime, (ts - start) / 1000);
      gl!.uniform2f(uRes, canvas.width, canvas.height);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      if (!reduce) raf = requestAnimationFrame(frame);
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(2, Math.round(r.width * dpr));
      canvas.height = Math.max(2, Math.round(r.height * dpr));
      gl!.viewport(0, 0, canvas.width, canvas.height);
      // Resizing clears the WebGL buffer. When the rAF loop is running it
      // repaints next frame, but under reduced-motion (no loop) we must repaint
      // once here or the hero canvas goes blank after a window resize.
      if (reduce) raf = requestAnimationFrame(frame);
    };
    resize();
    window.addEventListener("resize", resize);

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      const ext = gl?.getExtension("WEBGL_lose_context");
      ext?.loseContext();
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
