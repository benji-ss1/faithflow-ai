// Background Templates — data model (isolated feature; does NOT touch the
// existing theme system). A background sits BETWEEN the theme background color
// and the projected text. type "none" ⇒ existing theme background shows through.
import type { BackgroundSpec } from "@/lib/broadcast";

export type BackgroundType = "none" | "image" | "shader" | "video";

export type ShaderPreset =
  | "gentleWaves"
  | "holyFire"
  | "stainedLight"
  | "deepBreath"
  | "cleanSlate";

export type BackgroundCategory =
  | "contemporary"
  | "traditional"
  | "gospel"
  | "minimal"
  | "custom";

export interface PFBackground {
  id: string;
  name: string;
  type: BackgroundType;
  isBuiltIn: boolean;
  category: BackgroundCategory;
  /** S3 key for a custom upload — used to re-mint a fresh URL when the presign expires. */
  mediaKey?: string;

  // Shared overlay (readability tint on top of the background)
  overlayColor?: string;
  overlayOpacity?: number; // 0..0.8

  // Image
  imageUrl?: string;
  imageFit?: "fill" | "fit" | "stretch" | "tile";
  imageBlur?: number; // 0..20 px
  imageOpacity?: number; // 0..1

  // Shader (animated)
  shaderPreset?: ShaderPreset;
  shaderSpeed?: number; // 0.2..2.0
  shaderIntensity?: number; // 0.5..1.5
  shaderPrimaryColor?: string;
  shaderSecondaryColor?: string;

  // Video
  videoUrl?: string;
  videoPlaybackSpeed?: number; // 0.25..1.0
  videoOpacity?: number; // 0..1
}

/**
 * Derive the compact, wire-safe BackgroundSpec (sent on OutputState to the
 * projector) from a full PFBackground. Only render-relevant fields travel.
 */
export function toBackgroundSpec(bg: PFBackground | null | undefined): BackgroundSpec {
  if (!bg || bg.type === "none") return { type: "none" };
  return {
    type: bg.type,
    ...(bg.shaderPreset ? { shaderPreset: bg.shaderPreset } : {}),
    ...(bg.shaderPrimaryColor ? { primaryColor: bg.shaderPrimaryColor } : {}),
    ...(bg.shaderSecondaryColor ? { secondaryColor: bg.shaderSecondaryColor } : {}),
    ...(typeof bg.shaderSpeed === "number" ? { speed: bg.shaderSpeed } : {}),
    ...(typeof bg.shaderIntensity === "number" ? { intensity: bg.shaderIntensity } : {}),
    ...(bg.imageUrl ? { imageUrl: bg.imageUrl } : {}),
    ...(bg.imageFit ? { imageFit: bg.imageFit } : {}),
    ...(typeof bg.imageBlur === "number" ? { imageBlur: bg.imageBlur } : {}),
    ...(bg.videoUrl ? { videoUrl: bg.videoUrl } : {}),
    ...(typeof bg.videoPlaybackSpeed === "number" ? { videoSpeed: bg.videoPlaybackSpeed } : {}),
    ...(bg.overlayColor ? { overlayColor: bg.overlayColor } : {}),
    ...(typeof bg.overlayOpacity === "number" ? { overlayOpacity: bg.overlayOpacity } : {}),
  };
}
