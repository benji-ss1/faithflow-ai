/**
 * Media-bin → slide-grid drag/drop classification (field fix wave 6A).
 *
 * The Media Bin emits an HTML5 drag with a single MIME payload
 * (`application/x-pf-library-item`, `{ pfType:"media", id, url, kind, title }`) —
 * the SAME payload the MediaBrowser uses for playlist / library drops, so a
 * cross-OS in-app drag carries one shape everywhere.
 *
 * When that payload is dropped into the slide area there are exactly TWO
 * behaviours, decided PURELY by WHERE it lands (this module is the single,
 * unit-tested source of that decision — the DOM wiring in SlideGrid only
 * detects the zone and calls in here):
 *   • onto an existing slide thumbnail → set THAT slide's per-slide background
 *   • into empty grid space (or between slides) → create a NEW full-screen image
 *     slide at that position
 */

export const MEDIA_DROP_MIME = "application/x-pf-library-item";

export interface MediaDropPayload {
  pfType: "media";
  id: string;
  url: string;
  kind?: string;
  title?: string;
}

/**
 * Parse + validate a drag payload string. Returns null for anything that is not
 * a well-formed media item with a usable id + url (so a stray text drag, a
 * slide-reorder payload, or a truncated JSON blob can never be treated as a
 * droppable media asset).
 */
export function parseMediaDropPayload(raw: string | null | undefined): MediaDropPayload | null {
  if (!raw || typeof raw !== "string") return null;
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return null; }
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  if (r.pfType !== "media") return null;
  if (typeof r.id !== "string" || r.id.length === 0) return null;
  if (typeof r.url !== "string" || r.url.length === 0) return null;
  return {
    pfType: "media",
    id: r.id,
    url: r.url,
    kind: typeof r.kind === "string" ? r.kind : undefined,
    title: typeof r.title === "string" ? r.title : undefined,
  };
}

/**
 * Only IMAGE assets can become a slide background or a full-screen image slide.
 * A video kind (or an unknown/empty kind — treated conservatively as NOT an
 * image) is rejected so the operator gets an honest "images only here" instead
 * of a silently broken video-as-background.
 */
export function isImageAsset(payload: Pick<MediaDropPayload, "kind" | "url">): boolean {
  const k = (payload.kind ?? "").toLowerCase();
  if (k.startsWith("image")) return true;
  if (k.startsWith("video")) return false;
  // Unknown kind: fall back to a cheap extension sniff on the URL; default false.
  return /\.(png|jpe?g|gif|webp|avif|bmp|heic)(\?|#|$)/i.test(payload.url);
}

export type DropZone =
  | { over: "slide"; slideIndex: number }
  | { over: "empty"; insertIndex: number };

export type DropResolution =
  | { action: "set-slide-background"; slideIndex: number }
  | { action: "new-image-slide"; insertIndex: number };

/**
 * The whole decision: a drop ON a slide sets that slide's background; a drop in
 * empty space creates a new image slide at the given insertion index. Pure and
 * total — no DOM, no side effects.
 */
export function resolveMediaDrop(zone: DropZone): DropResolution {
  if (zone.over === "slide") {
    return { action: "set-slide-background", slideIndex: zone.slideIndex };
  }
  return { action: "new-image-slide", insertIndex: Math.max(0, zone.insertIndex) };
}
