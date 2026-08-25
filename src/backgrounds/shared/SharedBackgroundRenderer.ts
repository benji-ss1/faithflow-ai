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
// Robustness: builds on a FRESH offscreen canvas for every spec change (reusing
// a loseContext()'d canvas makes the next compile fail), guards against a
// superseded canvas's late context-loss event, and skips blits for cards that
// are scrolled out of view (a large chapter can have 150+ cards).
import { createShaderRenderer, type ShaderHandle } from "../shaders/ShaderRenderer";
import { hexToRgb, prefersReducedMotion, PRIMARY_RGB_FALLBACK, SECONDARY_RGB_FALLBACK } from "./shaderUtils";

export type SharedShaderSpec = {
  preset: string;
  speed: number;
  intensity: number;
  primary: string; // hex
  secondary: string; // hex
};

/** A card registered with the shared renderer. */
export type SharedCardHandle = {
  dispose(): void;
  setVisible(visible: boolean): void;
};

const OFF_W = 480, OFF_H = 270; // 16:9; downscaled into ≤~320px cards = crisp

function keyOf(s: SharedShaderSpec) { return `${s.preset}|${s.speed}|${s.intensity}|${s.primary}|${s.secondary}`; }

type Card = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null; visible: boolean };

class SharedRendererImpl {
  private off: HTMLCanvasElement | null = null;
  private handle: ShaderHandle | null = null;
  private key: string | null = null;
  private spec: SharedShaderSpec | null = null;
  private cards = new Set<Card>();

  /** A card registers its 2D canvas + the active spec. */
  register(canvas: HTMLCanvasElement, spec: SharedShaderSpec): SharedCardHandle {
    const entry: Card = { canvas, ctx: canvas.getContext("2d"), visible: true };
    this.cards.add(entry);
    this.ensure(spec);
    this.blitOne(entry); // paint immediately (buffer is preserved) — covers static presets
    return {
      dispose: () => {
        this.cards.delete(entry);
        if (this.cards.size === 0) this.teardown();
      },
      setVisible: (v: boolean) => { entry.visible = v; if (v) this.blitOne(entry); },
    };
  }

  private ensure(spec: SharedShaderSpec) {
    this.spec = spec;
    const k = keyOf(spec);
    if (k === this.key && this.handle) return; // same theme → nothing to rebuild
    if (typeof document === "undefined") return;
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
      primaryColor: hexToRgb(spec.primary, PRIMARY_RGB_FALLBACK),
      secondaryColor: hexToRgb(spec.secondary, SECONDARY_RGB_FALLBACK),
      frozen: prefersReducedMotion(),
      offscreenSize: { width: OFF_W, height: OFF_H },
      preserveDrawingBuffer: true,
      onDraw: () => this.blitAll(),
    });
    this.key = this.handle ? k : null; // WebGL failed → cards fall back to CSS floor
  }

  private makeOffscreen(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = OFF_W; c.height = OFF_H;
    // Guard: a superseded canvas's queued lost-event must NOT null out our state
    // for the NEW canvas — only react to the CURRENT offscreen (fixes the ok-latch).
    c.addEventListener("webglcontextlost", (e) => { if (this.off === c) { e.preventDefault(); this.key = null; } }, false);
    c.addEventListener("webglcontextrestored", () => { if (this.off === c && this.spec) { this.key = null; this.ensure(this.spec); } }, false);
    return c;
  }

  private blitAll() { for (const e of this.cards) this.blitOne(e); }
  private blitOne(e: Card) {
    if (!this.off || !e.ctx || !e.visible) return; // skip offscreen-culled cards
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
