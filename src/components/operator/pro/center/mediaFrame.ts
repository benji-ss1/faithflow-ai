// Per-asset media framing persistence (crop / pan / zoom / fit).
//
// The media image editor lets the operator frame an image (Fit/Fill/Stretch +
// pan + zoom). Without this, that framing is ephemeral — the next click projects
// the image un-framed. Here we persist the framing PER ASSET so a saved image
// projects correctly framed straight from a single click, no editor needed.
//
// Mirrors src/components/operator/scripture/scriptureStyle.ts: localStorage,
// SSR-guarded, try/catch-safe, versioned key. Church-scoped per CLAUDE.md rule 5.
// A DB-backed version (media_assets.frameJson) is the production upgrade path;
// both key on (churchId, assetId) so migration is clean.

export type MediaFrame = {
  fit: "contain" | "cover" | "fill";
  posX: number; // 0-100 (object-position %)
  posY: number; // 0-100
  zoom: number; // 1-8 (transform scale past the fit baseline)
};

const key = (churchId: string | undefined, assetId: string) =>
  `pf.mediaFrame.v1.${churchId || "default"}.${assetId}`;

export function loadMediaFrame(churchId: string | undefined, assetId: string): MediaFrame | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(churchId, assetId));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<MediaFrame>;
    const fit = p.fit === "contain" || p.fit === "cover" || p.fit === "fill" ? p.fit : "cover";
    const clamp = (n: unknown, lo: number, hi: number, dflt: number) =>
      typeof n === "number" && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
    return {
      fit,
      posX: clamp(p.posX, 0, 100, 50),
      posY: clamp(p.posY, 0, 100, 50),
      zoom: clamp(p.zoom, 1, 8, 1),
    };
  } catch {
    return null;
  }
}

export function saveMediaFrame(churchId: string | undefined, assetId: string, frame: MediaFrame): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(churchId, assetId), JSON.stringify(frame));
  } catch {
    /* quota / disabled storage — non-fatal, framing just won't persist */
  }
}

export function clearMediaFrame(churchId: string | undefined, assetId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key(churchId, assetId));
  } catch {
    /* non-fatal */
  }
}
