"use client";

import { useEffect, useRef, useState } from "react";
import s from "./sarah.module.css";

const FRAG = `precision mediump float;
uniform float t; uniform vec2 r; uniform float energy;
float n(vec2 p){ return sin(p.x) * sin(p.y); }
void main(){
  vec2 u = gl_FragCoord.xy / r;
  vec2 p = u * 3.0;
  float v = 0.0;
  for (int k = 0; k < 5; k++) {
    p += vec2(sin(p.y + t * 0.13), cos(p.x + t * 0.11)) * 0.55;
    v += n(p * 1.25) * 0.45;
  }
  vec3 ground = vec3(0.047, 0.043, 0.039);
  vec3 ember = vec3(0.91, 0.31, 0.10);
  vec3 warm = vec3(1.0, 0.54, 0.32);
  float glow = smoothstep(0.15, 1.3, v + 0.45) * (1.0 - u.y * 0.65);
  vec3 col = mix(ground, mix(ember, warm, u.x * 0.6), glow * (0.32 + energy * 0.25));
  gl_FragColor = vec4(col, 1.0);
}`;

const FPS = 30;

/**
 * Slow flowing ember backdrop. `energy` (0..1) brightens it with live audio.
 * Capped at 30fps, paused when the tab is hidden or `paused` is set, and replaced
 * by a static gradient under reduced motion or without WebGL.
 */
export function SarahShader({ energy = 0, paused = false }: { energy?: number; paused?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const energyRef = useRef(energy);
  const pausedRef = useRef(paused);
  const [ok, setOk] = useState(true);
  energyRef.current = energy;
  pausedRef.current = paused;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setOk(false); return; }
    const gl = c.getContext("webgl");
    if (!gl) { setOk(false); return; }
    const sh = (type: number, src: string) => { const o = gl.createShader(type)!; gl.shaderSource(o, src); gl.compileShader(o); return o; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}"));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { setOk(false); return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const ut = gl.getUniformLocation(prog, "t"), ur = gl.getUniformLocation(prog, "r"), ue = gl.getUniformLocation(prog, "energy");
    let raf = 0; let smooth = 0; let last = 0;
    const frame = (ms: number) => {
      raf = requestAnimationFrame(frame);
      if (pausedRef.current || document.hidden) return;
      if (ms - last < 1000 / FPS) return;
      last = ms;
      const w = Math.max(1, Math.floor(c.clientWidth * 0.5)), h = Math.max(1, Math.floor(c.clientHeight * 0.5));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; gl.viewport(0, 0, w, h); }
      smooth += (energyRef.current - smooth) * 0.12;
      gl.uniform1f(ut, ms / 1000); gl.uniform2f(ur, w, h); gl.uniform1f(ue, smooth);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); gl.getExtension("WEBGL_lose_context")?.loseContext(); };
  }, []);

  return ok ? <canvas ref={ref} className={s.shader} aria-hidden /> : <div className={s.shaderFallback} aria-hidden />;
}
