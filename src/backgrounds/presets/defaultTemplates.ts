// Built-in animated theme backgrounds (2026-09-23: Stained Light + Deep Breath
// retired from the picker by user request; their shaders stay registered so a
// stale saved selection or in-flight spec still renders). The built-in templates (+ "None"). Code-only, zero file size,
// cross-platform. Shader presets render via WebGL (Phase 4) with a CSS-gradient
// fallback until then; "Clean Slate" is a static gradient.
import type { PFBackground } from "../models/BackgroundTypes";

export const NONE_BACKGROUND: PFBackground = {
  id: "none",
  name: "None",
  type: "none",
  isBuiltIn: true,
  category: "minimal",
};

export const BUILT_IN_BACKGROUNDS: PFBackground[] = [
  NONE_BACKGROUND,
  {
    id: "gentleWaves",
    name: "Gentle Waves",
    type: "shader",
    isBuiltIn: true,
    category: "contemporary",
    shaderPreset: "gentleWaves",
    shaderSpeed: 0.8,
    shaderIntensity: 1.0,
    shaderPrimaryColor: "#0A1628",
    shaderSecondaryColor: "#1A5C5C",
  },
  {
    id: "holyFire",
    name: "Holy Fire",
    type: "shader",
    isBuiltIn: true,
    category: "gospel",
    shaderPreset: "holyFire",
    shaderSpeed: 1.0,
    shaderIntensity: 1.0,
    shaderPrimaryColor: "#E8501A",
    shaderSecondaryColor: "#D4781E",
  },
  {
    id: "cleanSlate",
    name: "Clean Slate",
    type: "shader",
    isBuiltIn: true,
    category: "minimal",
    shaderPreset: "cleanSlate",
    shaderSpeed: 1.0,
    shaderIntensity: 1.0,
    shaderPrimaryColor: "#0A0A0E",
    shaderSecondaryColor: "#0F0F14",
  },
  {
    id: "goldenBokeh",
    name: "Golden Bokeh",
    type: "shader",
    isBuiltIn: true,
    category: "contemporary",
    shaderPreset: "goldenBokeh",
    shaderSpeed: 1.0,
    shaderIntensity: 1.0,
    shaderPrimaryColor: "#E8B86A",
    shaderSecondaryColor: "#0B0F1C",
  },
  {
    id: "waterfall",
    name: "Waterfall",
    type: "shader",
    isBuiltIn: true,
    category: "nature",
    shaderPreset: "waterfall",
    shaderSpeed: 0.6,
    shaderIntensity: 1.0,
    shaderPrimaryColor: "#9FD4E8",
    shaderSecondaryColor: "#0B2A36",
  },
  {
    id: "forestLight",
    name: "Forest Light",
    type: "shader",
    isBuiltIn: true,
    category: "nature",
    shaderPreset: "forestLight",
    shaderSpeed: 0.7,
    shaderIntensity: 1.0,
    shaderPrimaryColor: "#F3E6A6",
    shaderSecondaryColor: "#0F3A22",
  },
  {
    id: "heavenClouds",
    name: "Heaven Clouds",
    type: "shader",
    isBuiltIn: true,
    category: "nature",
    shaderPreset: "heavenClouds",
    shaderSpeed: 0.6,
    shaderIntensity: 1.0,
    shaderPrimaryColor: "#E8B878",
    shaderSecondaryColor: "#1E3A66",
  },
  {
    id: "gloryDust",
    name: "Glory Dust",
    type: "shader",
    isBuiltIn: true,
    category: "gospel",
    shaderPreset: "gloryDust",
    shaderSpeed: 0.6,
    shaderIntensity: 1.0,
    shaderPrimaryColor: "#C9A7FF",
    shaderSecondaryColor: "#120A24",
  },
  {
    id: "auroraGlow",
    name: "Aurora Glow",
    type: "shader",
    isBuiltIn: true,
    category: "contemporary",
    shaderPreset: "auroraGlow",
    shaderSpeed: 0.7,
    shaderIntensity: 1.0,
    shaderPrimaryColor: "#36E0A0",
    shaderSecondaryColor: "#05101E",
  },
  {
    id: "stillWaters",
    name: "Still Waters",
    type: "shader",
    isBuiltIn: true,
    category: "nature",
    shaderPreset: "stillWaters",
    shaderSpeed: 0.6,
    shaderIntensity: 1.0,
    shaderPrimaryColor: "#F2B880",
    shaderSecondaryColor: "#1C2E4A",
  },
];

// Retired from the picker (not listed) but still RESOLVABLE, so a church whose
// saved selection is one of these keeps its background until it picks another
// (no silent disappearance mid-service — NEVER REGRESS).
const RETIRED_BACKGROUNDS: PFBackground[] = [
  { id: "stainedLight", name: "Stained Light", type: "shader", isBuiltIn: true, category: "traditional", shaderPreset: "stainedLight", shaderSpeed: 0.5, shaderIntensity: 1.0, shaderPrimaryColor: "#8A7A3C", shaderSecondaryColor: "#6B2840" },
  { id: "deepBreath", name: "Deep Breath", type: "shader", isBuiltIn: true, category: "minimal", shaderPreset: "deepBreath", shaderSpeed: 0.6, shaderIntensity: 1.0, shaderPrimaryColor: "#F0E8D8", shaderSecondaryColor: "#060608" },
];

export function findBuiltIn(id: string): PFBackground | undefined {
  return BUILT_IN_BACKGROUNDS.find((b) => b.id === id) ?? RETIRED_BACKGROUNDS.find((b) => b.id === id);
}
