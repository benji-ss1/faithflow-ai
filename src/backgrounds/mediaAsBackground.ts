/**
 * media → Background Template (Decoupling Wave 4, Victor's mandate).
 *
 * "Set as background" on a media library item routes the image/video through the
 * EXISTING custom-background machinery (the same path BackgroundUploader uses):
 * it becomes a custom PFBackground and is set active, so it renders BEHIND the
 * text via BackgroundLayer, PERSISTS across every slide advance (the background
 * layer is independent of the slide), and is cleared independently by the
 * Background Templates picker (select None) / the Layers panel + clear rail
 * background cue. It rides the SAME BackgroundSpec + "last pick wins" persistence
 * + camera-wins + theme/template mutual-exclusivity precedence as every other
 * Background Template — no new precedence is invented here.
 *
 * Pure `buildMediaBackground` (node-testable) + a thin `setMediaAsBackground`
 * side-effect wrapper over the store.
 */
import { addCustomBackground, setActiveBackgroundId } from "./store/backgroundStore";
import type { PFBackground } from "./models/BackgroundTypes";

export interface MediaBgAsset {
  id: string;
  url: string;
  fileName: string;
  kind: string; // "image" | "video" | "image/png" | "video/mp4" | …
}

/** How the media should fill the projector as a background (mirrors the theme
 *  media apply "fill" default). Kept small — the operator can fine-tune blur/
 *  overlay/speed from the Background Templates picker afterwards. */
export function buildMediaBackground(asset: MediaBgAsset): PFBackground {
  const isVideo = asset.kind.startsWith("video");
  // Stable, deterministic id keyed off the media asset so re-setting the SAME
  // item replaces its entry (addCustomBackground de-dupes by id) instead of
  // stacking duplicates in the custom list.
  const id = `media-bg-${asset.id}`;
  const name =
    asset.fileName.replace(/\.[^.]+$/, "").slice(0, 40) ||
    (isVideo ? "Video background" : "Image background");
  if (isVideo) {
    return {
      id,
      name,
      type: "video",
      isBuiltIn: false,
      category: "custom",
      videoUrl: asset.url,
      // Motion-background default (PROPRESENTER_MVP_SPEC Ch16): the BackgroundLayer
      // renders a background video muted + looped + autoplay (warn-free); full
      // speed by default (the operator can slow it in the picker).
      videoPlaybackSpeed: 1,
    };
  }
  return {
    id,
    name,
    type: "image",
    isBuiltIn: false,
    category: "custom",
    imageUrl: asset.url,
    imageFit: "fill",
    imageBlur: 0,
  };
}

/**
 * Set a media library item as the active Background Template. Adds it to the
 * operator's custom backgrounds (so it shows in the picker's list, honest state)
 * and makes it active — which fires BACKGROUND_CHANGED_EVENT, so useBackgroundState
 * → backgroundSpec → OutputState.background updates on every output surface.
 */
export function setMediaAsBackground(asset: MediaBgAsset): PFBackground {
  const bg = buildMediaBackground(asset);
  addCustomBackground(bg);
  setActiveBackgroundId(bg.id);
  return bg;
}
