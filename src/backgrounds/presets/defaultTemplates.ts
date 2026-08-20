// The 5 built-in background templates (+ "None"). Code-only, zero file size,
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
    id: "stainedLight",
    name: "Stained Light",
    type: "shader",
    isBuiltIn: true,
    category: "traditional",
    shaderPreset: "stainedLight",
    shaderSpeed: 0.5,
    shaderIntensity: 1.0,
    shaderPrimaryColor: "#8A7A3C",
    shaderSecondaryColor: "#6B2840",
  },
  {
    id: "deepBreath",
    name: "Deep Breath",
    type: "shader",
    isBuiltIn: true,
    category: "minimal",
    shaderPreset: "deepBreath",
    shaderSpeed: 0.6,
    shaderIntensity: 1.0,
    shaderPrimaryColor: "#F0E8D8",
    shaderSecondaryColor: "#060608",
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
];

export function findBuiltIn(id: string): PFBackground | undefined {
  return BUILT_IN_BACKGROUNDS.find((b) => b.id === id);
}
