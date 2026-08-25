// Minimal WebGL fullscreen-quad shader renderer for animated backgrounds.
// Cross-platform (Chromium/Electron on macOS + Windows), GPU-accelerated.
// Returns null on any WebGL failure so the caller can fall back to a CSS
// gradient (the Canvas-2D-equivalent fallback) — never crashes.
import { VERTEX_SHADER, FRAGMENT_SHADERS, STATIC_PRESETS } from "./shaders";

export interface ShaderRendererOptions {
  canvas: HTMLCanvasElement;
  preset: string;
  speed: number;
  intensity: number;
  primaryColor: [number, number, number]; // 0..1
  secondaryColor: [number, number, number];
  /** When true, render a single frame and do not animate (reduced motion). */
  frozen?: boolean;
  /** Fixed backing size for OFFSCREEN rendering (a detached canvas reports
   *  clientWidth/Height 0). Used by the shared-shader card renderer. */
  offscreenSize?: { width: number; height: number };
  /** Keep the drawing buffer readable after a frame (so late 2D blits / static
   *  presets can drawImage the offscreen canvas). */
  preserveDrawingBuffer?: boolean;
  /** Called each frame immediately AFTER drawArrays (buffer valid this tick) —
   *  the shared renderer uses it to blit into all registered card canvases. */
  onDraw?: () => void;
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("[bg-shader] compile failed:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export interface ShaderHandle {
  stop(): void;
}

export function createShaderRenderer(opts: ShaderRendererOptions): ShaderHandle | null {
  const fragSrc = FRAGMENT_SHADERS[opts.preset];
  if (!fragSrc) return null;

  let gl: WebGLRenderingContext | null = null;
  try {
    gl = (opts.canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: !!opts.preserveDrawingBuffer })
      || opts.canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
  } catch {
    gl = null;
  }
  if (!gl) return null;

  // Context-loss resilience: on a lost context (GPU reset, too many contexts,
  // the projector window losing focus), preventDefault so Chromium can RESTORE
  // it, and reload the page fresh on restore so the shader rebuilds cleanly —
  // instead of the projector silently falling back to a static gradient forever.
  const onLost = (e: Event) => { e.preventDefault(); };
  const onRestored = () => {
    // Only the output windows (no unsaved state) reload to rebuild the shader —
    // never the operator (that would reload the whole console from a thumbnail).
    const p = window.location.pathname;
    if (p.startsWith("/live") || p.startsWith("/stage") || p.startsWith("/livestream")) {
      try { window.location.reload(); } catch { /* noop */ }
    }
  };
  opts.canvas.addEventListener("webglcontextlost", onLost, false);
  opts.canvas.addEventListener("webglcontextrestored", onRestored, false);

  // Release the GL context (and its listeners) on any setup failure so a failed
  // build doesn't orphan a context against the browser's ~16-context cap.
  const bail = (): null => {
    try { opts.canvas.removeEventListener("webglcontextlost", onLost); } catch { /* noop */ }
    try { opts.canvas.removeEventListener("webglcontextrestored", onRestored); } catch { /* noop */ }
    try { gl?.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* noop */ }
    return null;
  };

  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!vs || !fs) return bail();
  const prog = gl.createProgram();
  if (!prog) return bail();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn("[bg-shader] link failed:", gl.getProgramInfoLog(prog));
    return bail();
  }
  gl.useProgram(prog);

  // Fullscreen quad.
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, "u_resolution");
  const uTime = gl.getUniformLocation(prog, "u_time");
  const uSpeed = gl.getUniformLocation(prog, "u_speed");
  const uIntensity = gl.getUniformLocation(prog, "u_intensity");
  const uPrimary = gl.getUniformLocation(prog, "u_primaryColor");
  const uSecondary = gl.getUniformLocation(prog, "u_secondaryColor");

  gl.uniform1f(uSpeed, opts.speed);
  gl.uniform1f(uIntensity, opts.intensity);
  gl.uniform3fv(uPrimary, opts.primaryColor);
  gl.uniform3fv(uSecondary, opts.secondaryColor);

  let raf = 0;
  let running = true;
  // No Date.now()/performance.now() at module scope is fine here (runtime, not
  // a workflow script). Use performance.now for smooth frame timing.
  const start = performance.now();

  const sizeCanvas = () => {
    // Offscreen (detached) canvas has no layout size — use the fixed size.
    if (opts.offscreenSize) {
      const { width, height } = opts.offscreenSize;
      if (opts.canvas.width !== width || opts.canvas.height !== height) {
        opts.canvas.width = width;
        opts.canvas.height = height;
      }
      gl!.viewport(0, 0, width, height);
      gl!.uniform2f(uRes, width, height);
      return;
    }
    const cw = opts.canvas.clientWidth || 1920;
    const ch = opts.canvas.clientHeight || 1080;
    // Cap DPR to 1.5 — projector output doesn't need retina density and it keeps
    // the fragment count down on weak GPUs.
    const dpr = Math.min(1.5, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    const w = Math.max(1, Math.round(cw * dpr));
    const h = Math.max(1, Math.round(ch * dpr));
    if (opts.canvas.width !== w || opts.canvas.height !== h) {
      opts.canvas.width = w;
      opts.canvas.height = h;
    }
    gl!.viewport(0, 0, opts.canvas.width, opts.canvas.height);
    gl!.uniform2f(uRes, opts.canvas.width, opts.canvas.height);
  };

  const draw = (t: number) => {
    if (!running || !gl) return;
    gl.uniform1f(uTime, t);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    opts.onDraw?.(); // shared renderer blits into card canvases on the same tick
  };

  sizeCanvas();
  const onResize = () => sizeCanvas();
  window.addEventListener("resize", onResize);

  if (opts.frozen || STATIC_PRESETS.has(opts.preset)) {
    draw(0);
  } else {
    const loop = () => {
      if (!running) return;
      sizeCanvas();
      draw((performance.now() - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  return {
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      try { opts.canvas.removeEventListener("webglcontextlost", onLost); } catch { /* noop */ }
      try { opts.canvas.removeEventListener("webglcontextrestored", onRestored); } catch { /* noop */ }
      try {
        const lose = gl?.getExtension("WEBGL_lose_context");
        lose?.loseContext();
      } catch { /* noop */ }
    },
  };
}
