// Operator monitors (Main/Stage/Stream, MultiView, output thumbs) must ANIMATE the
// active Background Template via the ONE shared WebGL context — never a frozen
// single frame, never a per-surface context. Run: npx tsx test/animated-bg-mirrors.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldBlit, BLIT_MIN_INTERVAL_MS } from "../src/backgrounds/shared/SharedBackgroundRenderer";

let pass = 0;
const t = (name: string, fn: () => void) => { fn(); pass++; console.log("ok", name); };

t("throttle: blits at ~30fps, not 60", () => {
  assert.equal(shouldBlit(0, -Infinity), true);
  assert.equal(shouldBlit(16.7, 0), false);
  assert.equal(shouldBlit(33.4, 0), true);
  assert.ok(BLIT_MIN_INTERVAL_MS > 16.7 && BLIT_MIN_INTERVAL_MS <= 1000 / 30);
});
t("throttle: clock going backwards never stalls", () => assert.equal(shouldBlit(5, 100), true));

const layer = readFileSync("src/backgrounds/components/BackgroundLayer.tsx", "utf8");
t("frozen shader mirror uses the shared renderer (animated, no own context)", () => {
  assert.match(layer, /content = frozen \? \(\s*<SharedShaderCanvas/);
  assert.doesNotMatch(layer, /<ShaderBackground[^>]*frozen=/s);
});
const card = readFileSync("src/components/operator/pro/center/ThemedSlideCard.tsx", "utf8");
t("slide cards still use the shared renderer", () => assert.match(card, /<SharedShaderCanvas/));
const live = readFileSync("src/components/operator/pro/right/LivePreviewPanel.tsx", "utf8");
t("Main monitor background still goes through BackgroundLayer", () => assert.match(live, /<BackgroundLayer[^>]*frozen \/>/));

console.log(`animated-bg-mirrors: ${pass} passed, 0 failed`);
