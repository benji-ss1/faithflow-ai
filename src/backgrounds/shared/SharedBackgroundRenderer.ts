"use client";
// SharedBackgroundRenderer — ONE WebGL context renders the active Background
// Template's shader to a single small offscreen canvas in one rAF loop; every
// operator-preview slide card owns a cheap 2D <canvas> that drawImage()s that
// offscreen each frame. So N cards (a 40-verse chapter, a long song) all show
// the EXACT same animated shader as the live projector — a true 1:1 replica —
// at the cost of ONE WebGL context total (not one-per-card, which blows the
// browser's ~16-context cap). Every card shows the same background because a
// service has ONE active theme, so a single render is a perfect source.
//
// Falls back to null (cards render their CSS gradient) if WebGL is unavailable,
// and rebuilds in place on context loss/restore without reloading the console.
import { createShaderRenderer, type ShaderHandle } from "../shaders/ShaderRenderer";

export type SharedShaderSpec = {
  preset: string;
  speed: number;
  intensity: number;
  primary: string; // hex
  secondary: string; // hex
};

const OFF_W = 480, OFF_H = 270; // 16:9; downscaled into ≤~320px cards = crisp

function keyOf(s: SharedShaderSpec) { return `${s.preset}|${s.speed}|${s.intensity}|${s.primary}|${s.secondary}`; }

function hexToRgb(hex: string, fallback: [number, number, number]): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return fallback;
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return fallback;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function prefersReducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

type Card = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null };

class SharedRendererImpl {
  private off: HTMLCanvasElement | null = null;
  private handle: ShaderHandle | null = null;
  private key: string | null = null;
  private spec: SharedShaderSpec | null = null;
  private cards = new Set<Card>();
  private ok = true;

  webglOk() { return this.ok; }

  /** A card registers its 2D canvas + the active spec; returns an unregister fn. */
  register(canvas: HTMLCanvasElement, spec: SharedShaderSpec): () => void {
    const entry: Card = { canvas, ctx: canvas.getContext("2d") };
    this.cards.add(entry);
    this.ensure(spec);
    if (this.ok && this.off) this.blitOne(entry); // paint immediately (buffer is preserved)
    return () => {
      this.cards.delete(entry);
      if (this.cards.size === 0) this.teardown();
    };
  }

  /** Re-point at a new theme spec (call when ctx.background changes). */
  setSpec(spec: SharedShaderSpec) { this.ensure(spec); }

  private ensure(spec: SharedShaderSpec) {
    this.spec = spec;
    const k = keyOf(spec);
    if (k === this.key && this.handle) return; // same theme → nothing to rebuild
    if (typeof document === "undefined") { this.ok = false; return; }
    // handle.stop() loseContext()s the offscreen canvas, so ALWAYS build on a
    // FRESH canvas — reusing a lost canvas makes every subsequent shader compile
    // fail (the 148 "compile failed" bug). The old canvas + context is GC'd.
    this.handle?.stop();
    this.handle = null;
    this.off = this.makeOffscreen();
    this.handle = createShaderRenderer({
      canvas: this.off,
      preset: spec.preset,
      speed: Math.max(0.05, spec.speed),
      intensity: Math.max(0.1, spec.intensity),
      primaryColor: hexToRgb(spec.primary, [0.04, 0.04, 0.05]),
      secondaryColor: hexToRgb(spec.secondary, [0.06, 0.06, 0.08]),
      frozen: prefersReducedMotion(),
      offscreenSize: { width: OFF_W, height: OFF_H },
      preserveDrawingBuffer: true,
      onDraw: () => this.blitAll(),
    });
    this.ok = !!this.handle;
    this.key = this.handle ? k : null; // WebGL failed → cards fall back to CSS gradient
  }

  private makeOffscreen(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = OFF_W; c.height = OFF_H;
    c.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.ok = false; }, false);
    c.addEventListener("webglcontextrestored", () => { this.key = null; if (this.spec) this.ensure(this.spec); }, false);
    return c;
  }

  private blitAll() { for (const e of this.cards) this.blitOne(e); }
  private blitOne(e: Card) {
    if (!this.off || !e.ctx) return;
    try { e.ctx.drawImage(this.off, 0, 0, e.canvas.width, e.canvas.height); } catch { /* card detached mid-frame */ }
  }

  private teardown() {
    this.handle?.stop(); // loseContext()s this.off
    this.handle = null;
    this.key = null;
    this.off = null; // drop the now-lost canvas; next register() builds a fresh one
  }
}

export const SharedBackgroundRenderer = new SharedRendererImpl();
