"use client";
/**
 * Per-content-type default styles: which theme drives the projector for SONGS
 * vs SCRIPTURE (Bible verses). The operator picks a default look for each content
 * type in the Themes panel; when a live item has no explicit per-item theme, its
 * TYPE selects the theme here, falling back to the church default.
 *
 * PR B (2026-09-17): stored per CHURCH (church_preferences.content_type_styles),
 * cached synchronously in church-styles-store. The old per-machine key
 * `presentflow.contentTypeStyles.v1` had NO churchId (a cross-church leak on a
 * shared computer); it is now only a READ-ONLY fallback before hydrate and a
 * one-time migration source (kept one release). Announcements keep their own
 * style in the announcement composer (a separate style model).
 */
import { getContentTypeStyles, setLocalContentTypeStyles } from "./church-styles-store";
export type { ContentStyleType, ContentTypeStyles } from "./scripture-design";
import type { ContentTypeStyles } from "./scripture-design";

export const CONTENT_STYLE_TYPES: { key: "song" | "scripture"; label: string }[] = [
  { key: "song", label: "Songs" },
  { key: "scripture", label: "Bible verses" },
];

/** Synchronous. `churchId` omitted → the church this window last hydrated. */
export function loadContentTypeStyles(churchId?: string): ContentTypeStyles {
  return getContentTypeStyles(churchId);
}

export function saveContentTypeStyles(next: ContentTypeStyles, churchId?: string): void {
  // Updates the cache, dispatches presentflow:content-type-styles-changed (so
  // OperatorConsole re-resolves the live appearance), BroadcastChannel + server.
  setLocalContentTypeStyles(churchId, next);
}

/** Resolve the themeId that should style a given live item type, or null. */
export function themeIdForType(type: string | undefined, styles: ContentTypeStyles): string | null {
  if (type === "song") return styles.song ?? null;
  if (type === "scripture") return styles.scripture ?? null;
  return null;
}
