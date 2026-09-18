// PresentFlow portable theme file (.pftheme.json) — pure helpers shared by the
// exportTheme / importTheme server actions, the Themes UI and the tests.
//
// WHY THIS EXISTS
// ---------------
// Theme background / logo URLs are stored as SIGNED S3 GET URLs whose object key
// is `{churchId}/{purpose}/{uuid}.{ext}`. Writing one of those straight into an
// exported file means the file carries (a) a live, working credential for the
// exporting church's storage and (b) a link that 404s/expires for everybody
// else. So a portable theme never carries a signed URL: on export each media
// reference is replaced by its STABLE object key in a `media` manifest, and on
// import the key is re-signed ONLY if it belongs to the importing church.
// Anything else is DROPPED and reported — never silently left pointing at
// another church's storage, never silently mangled.
//
// FILE SHAPE (v1)
//   { format: "presentflow.theme", version: 1, exportedAt: "<iso>",
//     name: string, config: ThemeConfig, media: PortableMediaRef[] }
// `name` + `config` stay at the TOP LEVEL on purpose: that is exactly the legacy
// `{ name, config }` shape this app exported before, so old files still import
// and new files still open in anything that read the old shape.
//
// Pure: no DB, no S3, no React. Directly unit-testable.
import type { ThemeConfig } from "./theme-config";

export const PFTHEME_FORMAT = "presentflow.theme";
export const PFTHEME_VERSION = 1;

/** Hard cap on an uploaded theme file. A theme is a few KB of JSON; the layout
 *  validator already caps itself at 256 KB. 1 MB is generous and bounds the
 *  parse cost of a hostile upload. */
export const MAX_THEME_FILE_BYTES = 1024 * 1024;

/** One media reference lifted out of a theme config. `path` is where it came
 *  from (and where it goes back), `s3Key` is the stable, church-prefixed object
 *  key. `fileName` is cosmetic — it is what the volunteer is told is missing. */
export type PortableMediaRef = {
  path: string;
  kind: "image" | "video";
  s3Key: string;
  fileName?: string;
};

export type PortableTheme = {
  format: typeof PFTHEME_FORMAT;
  version: number;
  exportedAt: string;
  name: string;
  config: ThemeConfig;
  media: PortableMediaRef[];
};

/** The parsed result of an uploaded file, before any church-scoped resolution. */
export type ParsedPortableTheme = {
  name: string;
  /** Config with every media field ALREADY removed (they live in `media`). */
  config: Record<string, unknown>;
  media: PortableMediaRef[];
  /** Media that could not be carried across at all (e.g. an inline signed URL
   *  in a legacy file whose key we cannot recover). Reported, never restored. */
  unresolved: { path: string; fileName?: string }[];
};

const MAX_MEDIA_REFS = 64;
const S3_KEY_RE = /^[0-9a-fA-F-]{36}\/[\w.-]{1,40}\/[\w.-]{1,120}$/;

/** A stable object key we are willing to put in / take out of a file. */
export function isSafeS3Key(key: unknown): key is string {
  if (typeof key !== "string" || key.length > 300) return false;
  if (key.includes("\\") || key.startsWith("/")) return false;
  if (key.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return false;
  return S3_KEY_RE.test(key);
}

/** Does this stable key belong to the given church? (The key's first segment is
 *  the owning church id — same rule /api/media/url enforces.) */
export function keyBelongsToChurch(key: string, churchId: string): boolean {
  if (!isSafeS3Key(key) || !churchId) return false;
  return key.slice(0, key.indexOf("/")) === churchId;
}

function baseNameOfKey(key: string): string | undefined {
  const n = key.slice(key.lastIndexOf("/") + 1);
  return n || undefined;
}

// ── Walking the media-bearing places in a theme config ───────────────────────
// Kept in ONE place so a new URL-bearing theme field can never be forgotten by
// export (leak) or import (dangling link).

type Slot = {
  path: string;
  kind: "image" | "video";
  get: (c: Record<string, unknown>) => unknown;
  /** `null` clears the slot. */
  set: (c: Record<string, unknown>, v: string | null) => void;
};

function flatSlot(key: "logoUrl" | "bgImageUrl" | "bgVideoUrl", kind: "image" | "video"): Slot {
  return {
    path: key,
    kind,
    get: (c) => c[key],
    set: (c, v) => {
      if (v === null) delete c[key];
      else c[key] = v;
    },
  };
}

/** Every media slot in a config, including the v3 layout's slide backgrounds
 *  and image/video slide objects. Order is stable (flat fields first). */
export function themeMediaSlots(config: Record<string, unknown>): Slot[] {
  const slots: Slot[] = [
    flatSlot("logoUrl", "image"),
    flatSlot("bgImageUrl", "image"),
    flatSlot("bgVideoUrl", "video"),
  ];
  const layout = config.layout as { slides?: unknown } | undefined;
  const slides = layout && typeof layout === "object" && Array.isArray(layout.slides) ? layout.slides : [];
  slides.forEach((rawSlide, si) => {
    if (!rawSlide || typeof rawSlide !== "object" || Array.isArray(rawSlide)) return;
    const slide = rawSlide as Record<string, unknown>;
    slots.push({
      path: `layout.slides.${si}.bgImageUrl`,
      kind: "image",
      get: () => slide.bgImageUrl,
      set: (_c, v) => {
        if (v === null) delete slide.bgImageUrl;
        else slide.bgImageUrl = v;
      },
    });
    const objects = Array.isArray(slide.objects) ? slide.objects : [];
    objects.forEach((rawObj, oi) => {
      if (!rawObj || typeof rawObj !== "object" || Array.isArray(rawObj)) return;
      const obj = rawObj as Record<string, unknown>;
      if (obj.kind !== "image" && obj.kind !== "video") return;
      slots.push({
        path: `layout.slides.${si}.objects.${oi}.url`,
        kind: obj.kind === "video" ? "video" : "image",
        get: () => obj.url,
        set: (_c, v) => {
          // Clearing leaves the OBJECT in place (a url-less placeholder) so the
          // manifest's `objects.<i>.url` index still addresses it. tidyAfterMediaDrop
          // — called once, at the very end of import — is what removes a box whose
          // picture never arrived.
          if (v === null) delete obj.url;
          else obj.url = v;
        },
      });
    });
  });
  return slots;
}

/** Remove layout image/video objects that ended up with no url, and downgrade a
 *  background whose image/video went away so the slide still renders.
 *  Call this ONCE, at the END of import — never mid-walk, or it would delete the
 *  very boxes the media manifest is about to refill. */
export function tidyAfterMediaDrop(config: Record<string, unknown>): void {
  const layout = config.layout as { slides?: unknown } | undefined;
  if (layout && typeof layout === "object" && Array.isArray(layout.slides)) {
    for (const rawSlide of layout.slides) {
      if (!rawSlide || typeof rawSlide !== "object") continue;
      const slide = rawSlide as Record<string, unknown>;
      if (Array.isArray(slide.objects)) {
        slide.objects = slide.objects.filter((o) => {
          if (!o || typeof o !== "object") return false;
          const obj = o as Record<string, unknown>;
          if (obj.kind !== "image" && obj.kind !== "video") return true;
          return typeof obj.url === "string" && obj.url !== "";
        });
      }
    }
  }
  // bgType points at a URL that is no longer there → fall back to the solid
  // colour rather than rendering a black/broken slide.
  if (config.bgType === "image" && !config.bgImageUrl) config.bgType = "solid";
  if (config.bgType === "video" && !config.bgVideoUrl) config.bgType = "solid";
}

/**
 * EXPORT side. Lifts every media reference out of `config` into a manifest.
 *
 * `toKey` turns a stored (signed) URL into its stable object key, or null when
 * the URL is not one of ours. Non-ours URLs that are safe and portable by
 * nature (data: images, /marketing|/brand|/login static files) are LEFT INLINE —
 * they carry no church credential. Anything else that we cannot key is dropped
 * and returned in `unresolved` so the exporter can say so.
 */
export function toPortableTheme(
  name: string,
  config: ThemeConfig,
  toKey: (url: string) => string | null,
  opts: { churchId: string; now?: () => Date } = { churchId: "" },
): { file: PortableTheme; unresolved: { path: string; fileName?: string }[] } {
  const out = structuredCloneish(config as Record<string, unknown>);
  const media: PortableMediaRef[] = [];
  const unresolved: { path: string; fileName?: string }[] = [];
  for (const slot of themeMediaSlots(out)) {
    const url = slot.get(out);
    if (typeof url !== "string" || !url) continue;
    if (isInlinePortableUrl(url)) continue; // safe to travel as-is
    const key = toKey(url);
    if (key && isSafeS3Key(key) && (!opts.churchId || keyBelongsToChurch(key, opts.churchId))) {
      if (media.length < MAX_MEDIA_REFS) {
        media.push({ path: slot.path, kind: slot.kind, s3Key: key, fileName: baseNameOfKey(key) });
      } else {
        unresolved.push({ path: slot.path });
      }
    } else {
      // A blob: preview, an expired/foreign signed URL, or an outside host.
      // None of those can be handed to another church.
      unresolved.push({ path: slot.path });
    }
    slot.set(out, null);
  }
  const file: PortableTheme = {
    format: PFTHEME_FORMAT,
    version: PFTHEME_VERSION,
    exportedAt: (opts.now?.() ?? new Date()).toISOString(),
    name,
    config: out as ThemeConfig,
    media,
  };
  return { file, unresolved };
}

/** URLs that are safe to carry inside a theme file verbatim: they belong to no
 *  church and leak nothing. (cleanRenderUrl still re-validates them on import.) */
export function isInlinePortableUrl(url: string): boolean {
  if (/^data:image\//i.test(url)) return true;
  return /^\/(marketing|brand|login)\//.test(url);
}

function structuredCloneish(v: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(v ?? {})) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ── IMPORT side ──────────────────────────────────────────────────────────────

/**
 * Parse an uploaded theme file. Accepts the v1 envelope AND the legacy
 * `{ name, config }` shape (files churches already exported). Returns a plain
 * error string a volunteer can act on, never a thrown exception.
 *
 * Media handling is IDENTICAL for both shapes: nothing that could point at
 * another church's storage survives parsing. Legacy inline signed URLs are
 * converted to keys via `toKey` (same helper export uses) so a same-church
 * legacy file still round-trips its background.
 */
export function parsePortableTheme(
  raw: unknown,
  toKey: (url: string) => string | null,
): { ok: true; data: ParsedPortableTheme } | { ok: false; error: string } {
  if (typeof raw === "string") {
    if (raw.length > MAX_THEME_FILE_BYTES) {
      return { ok: false, error: "That theme file is too big (over 1 MB). It doesn't look like a PresentFlow theme." };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "That file isn't valid theme JSON." };
    }
    return parsePortableTheme(parsed, toKey);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "That file isn't a PresentFlow theme." };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.format !== undefined && obj.format !== PFTHEME_FORMAT) {
    return { ok: false, error: "That file isn't a PresentFlow theme file." };
  }
  if (typeof obj.version === "number" && obj.version > PFTHEME_VERSION) {
    return { ok: false, error: "That theme was saved by a newer version of PresentFlow. Update PresentFlow and try again." };
  }
  if (!obj.config || typeof obj.config !== "object" || Array.isArray(obj.config)) {
    return { ok: false, error: "That theme file has no theme settings in it." };
  }
  const name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim().slice(0, 120) : "Imported theme";
  const config = structuredCloneish(obj.config as Record<string, unknown>);
  const unresolved: { path: string; fileName?: string }[] = [];

  // Manifest from a v1 file.
  const media: PortableMediaRef[] = [];
  if (Array.isArray(obj.media)) {
    for (const entry of (obj.media as unknown[]).slice(0, MAX_MEDIA_REFS)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.path !== "string" || !isKnownMediaPath(e.path)) continue;
      if (!isSafeS3Key(e.s3Key)) {
        unresolved.push({ path: e.path, fileName: typeof e.fileName === "string" ? e.fileName.slice(0, 120) : undefined });
        continue;
      }
      media.push({
        path: e.path,
        kind: e.kind === "video" ? "video" : "image",
        s3Key: e.s3Key,
        fileName: typeof e.fileName === "string" && e.fileName ? e.fileName.slice(0, 120) : baseNameOfKey(e.s3Key),
      });
    }
  }

  // Any URL still sitting INLINE in the config (legacy file, or a hand-edited
  // v1 file) gets the same treatment: keyed if we can, dropped if we can't.
  for (const slot of themeMediaSlots(config)) {
    const url = slot.get(config);
    if (typeof url !== "string" || !url) continue;
    if (isInlinePortableUrl(url)) continue;
    const key = toKey(url);
    if (key && isSafeS3Key(key) && media.length < MAX_MEDIA_REFS) {
      media.push({ path: slot.path, kind: slot.kind, s3Key: key, fileName: baseNameOfKey(key) });
    } else {
      unresolved.push({ path: slot.path });
    }
    slot.set(config, null);
  }
  return { ok: true, data: { name, config, media, unresolved } };
}

/** Path strings we are willing to write back into a config. Anything else in a
 *  hostile manifest (`__proto__`, `constructor.prototype`, …) is ignored. */
export function isKnownMediaPath(path: string): boolean {
  if (path === "logoUrl" || path === "bgImageUrl" || path === "bgVideoUrl") return true;
  return /^layout\.slides\.\d{1,3}\.(bgImageUrl|objects\.\d{1,3}\.url)$/.test(path);
}

/**
 * Put resolved media back into the config. `resolve` returns a fresh, usable URL
 * for a key the IMPORTING church owns, or null for anything it does not — the
 * caller (the server action) owns that decision. Every null is reported by name
 * so the UI can tell the volunteer exactly what to re-pick.
 */
export function applyPortableMedia(
  config: Record<string, unknown>,
  media: PortableMediaRef[],
  resolve: (ref: PortableMediaRef) => string | null,
): { config: Record<string, unknown>; missing: string[] } {
  const missing: string[] = [];
  const slotsByPath = new Map(themeMediaSlots(config).map((s) => [s.path, s]));
  for (const ref of media) {
    if (!isKnownMediaPath(ref.path)) continue;
    const slot = slotsByPath.get(ref.path);
    const url = resolve(ref);
    if (!url) {
      missing.push(ref.fileName || describePath(ref.path));
      if (slot) slot.set(config, null);
      continue;
    }
    if (slot) slot.set(config, url);
  }
  tidyAfterMediaDrop(config);
  return { config, missing };
}

/** Plain English for a media slot, for the "couldn't bring this across" list. */
export function describePath(path: string): string {
  if (path === "logoUrl") return "the church logo";
  if (path === "bgImageUrl") return "the background image";
  if (path === "bgVideoUrl") return "the background video";
  const m = /^layout\.slides\.(\d+)\./.exec(path);
  if (m) return `an image on slide ${Number(m[1]) + 1}`;
  return "a background";
}

/** One sentence a volunteer can act on. Empty string when nothing is missing. */
export function missingMediaMessage(missing: string[]): string {
  if (missing.length === 0) return "";
  const unique = Array.from(new Set(missing));
  const list = unique.slice(0, 3).join(", ");
  const more = unique.length > 3 ? ` and ${unique.length - 3} more` : "";
  return `The theme imported, but its pictures couldn't come with it (${list}${more}). They belong to the church that made the file — open the theme and choose your own background.`;
}
