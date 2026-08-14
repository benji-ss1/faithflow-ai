"use client";
/**
 * Per-content-type default styles: which theme drives the projector for SONGS
 * vs SCRIPTURE (Bible verses). The operator picks a default look for each content
 * type in the Themes panel; when a live item has no explicit per-item theme, its
 * TYPE selects the theme here, falling back to the church default.
 *
 * Stored per operator machine (localStorage) — same class as fontScale/autopilot
 * prefs — so it ships without a DB migration and drives every output surface via
 * OperatorConsole's appearance resolution. Announcements keep their own style in
 * the announcement composer (a separate style model).
 */
export type ContentStyleType = "song" | "scripture";
export type ContentTypeStyles = Partial<Record<ContentStyleType, string>>; // type → themeId

const KEY = "presentflow.contentTypeStyles.v1";
export const CONTENT_STYLE_TYPES: { key: ContentStyleType; label: string }[] = [
  { key: "song", label: "Songs" },
  { key: "scripture", label: "Bible verses" },
];

export function loadContentTypeStyles(): ContentTypeStyles {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    if (!raw) return {};
    const p = JSON.parse(raw) as ContentTypeStyles;
    const out: ContentTypeStyles = {};
    for (const { key } of CONTENT_STYLE_TYPES) {
      if (typeof p[key] === "string" && p[key]) out[key] = p[key];
    }
    return out;
  } catch { return {}; }
}

export function saveContentTypeStyles(next: ContentTypeStyles): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    // Same-machine broadcast so OperatorConsole re-resolves the live appearance.
    window.dispatchEvent(new CustomEvent("presentflow:content-type-styles-changed"));
  } catch { /* best effort */ }
}

/** Resolve the themeId that should style a given live item type, or null. */
export function themeIdForType(type: string | undefined, styles: ContentTypeStyles): string | null {
  if (type === "song") return styles.song ?? null;
  if (type === "scripture") return styles.scripture ?? null;
  return null;
}
