// Every animated theme shown in the Themes panel must ship a still thumbnail
// (public/animated-themes/<id>.jpg) — tiles never render WebGL live.
// Run: npx tsx test/animated-theme-thumbs.test.ts
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { BUILT_IN_BACKGROUNDS } from "../src/backgrounds/presets/defaultTemplates";
const missing = BUILT_IN_BACKGROUNDS.filter((b) => b.type === "shader" && b.shaderPreset && !existsSync(`public/animated-themes/${b.id}.jpg`)).map((b) => b.id);
assert.deepEqual(missing, [], `missing thumbnails: ${missing.join(", ")}`);
console.log("animated-theme-thumbs: 1 passed, 0 failed");
