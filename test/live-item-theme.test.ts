/**
 * Live theme == thumbnail theme (2026-09-17 prod bug: song content-type theme
 * "JPD" showed on thumbnails but /live fell back to the church default "hi").
 * Run: npx tsx test/live-item-theme.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveItemThemeConfig, resolveLiveItemIdx, type LiveItemStamp, type ThemedPlanItem } from "../src/lib/live-item-theme";
import { slideOutputIdentity, type SlidePayload } from "../src/lib/broadcast";
import { themeConfigToAppearance } from "../src/lib/theme-appearance";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message.slice(0, 400)}`); fail++; } };

const JPD = { bgType: "image", bgImageUrl: "https://x.test/jpd.png", bgColor: "#0B0B0B", textColor: "#F1EFE8", fontFamily: "Arial" };
const HI = { textColor: "#fff", fontFamily: "Inter" };
const OTHER = { bgColor: "#ff0000" };
const themes = new Map<string, unknown>([["jpd", JPD], ["hi", HI], ["red", OTHER]]);
const byId = (id: string) => themes.get(id);
const contentStyles = { song: "jpd" };
const defaultAppearance = themeConfigToAppearance(HI);

const l1: SlidePayload = { kind: "text", text: "Gods not dead" };
const l2: SlidePayload = { kind: "text", text: "He is alive" };
const verse: SlidePayload = { kind: "text", text: "For God so loved", reference: "John 3:16 (KJV)" };
const song = (extra: Partial<ThemedPlanItem> = {}): ThemedPlanItem => ({ type: "song", slides: [l1, l2], ...extra });
// Same song 3× — the third copy carries an explicit item theme.
const items: ThemedPlanItem[] = [song(), { type: "scripture", slides: [verse] }, song(), song({ themeId: "red" })];
const fns = { identity: slideOutputIdentity, source: (s: SlidePayload) => s, layout: (s: SlidePayload) => s };
const stampFor = (itemIdx: number, s: SlidePayload): LiveItemStamp => ({ itemIdx, identity: slideOutputIdentity(s) });

// Mirrors OperatorConsole: both paths = resolver config → appearance, else default.
const appear = (item: ThemedPlanItem | undefined) => { const c = resolveItemThemeConfig(item, contentStyles, byId); return c ? themeConfigToAppearance(c) : defaultAppearance; };
const thumbnail = (idx: number) => appear(items[idx]);
const live = (s: SlidePayload, stamp: LiveItemStamp | null) => appear(items[resolveLiveItemIdx(items, s, stamp, fns)]);

check("grid send of song item 0: live === thumbnail === JPD", () => {
  assert.deepEqual(live(l1, stampFor(0, l1)), thumbnail(0));
  assert.equal(live(l1, stampFor(0, l1))?.bgImageUrl, "https://x.test/jpd.png");
});
check("keyboard next/prev (deck position stamp) resolves same item", () => {
  assert.equal(resolveLiveItemIdx(items, l2, stampFor(2, l2), fns), 2);
  assert.deepEqual(live(l2, stampFor(2, l2)), thumbnail(2));
});
check("AI auto-fire / chip click (no stamp) falls back to content match → JPD", () => {
  assert.equal(resolveLiveItemIdx(items, l1, null, fns), 0);
  assert.deepEqual(live(l1, null), thumbnail(0));
});
check("duplicates: stamp picks the EXACT copy (item theme on copy 3 wins)", () => {
  assert.equal(resolveLiveItemIdx(items, l1, stampFor(3, l1), fns), 3);
  assert.deepEqual(live(l1, stampFor(3, l1)), thumbnail(3));
  assert.equal(thumbnail(3)?.bgColor, "#ff0000");
});
check("stale stamp (different slide now live) is ignored", () => {
  assert.equal(resolveLiveItemIdx(items, verse, stampFor(3, l1), fns), 1);
});
check("out-of-range stamp falls back", () => {
  assert.equal(resolveLiveItemIdx(items, l1, stampFor(99, l1), fns), 0);
});
check("no-plan-item send → -1 → church default (as today)", () => {
  const loose: SlidePayload = { kind: "text", text: "not in plan" };
  assert.equal(resolveLiveItemIdx(items, loose, null, fns), -1);
  assert.deepEqual(live(loose, null), defaultAppearance);
});
check("precedence: item theme → song applied → content type; uncached id falls through", () => {
  assert.equal(resolveItemThemeConfig({ type: "song", themeId: "missing", songAppliedThemeId: "red" }, contentStyles, byId), OTHER);
  assert.equal(resolveItemThemeConfig({ type: "song" }, contentStyles, byId), JPD);
  assert.equal(resolveItemThemeConfig({ type: "media" }, contentStyles, byId), null);
  assert.equal(resolveItemThemeConfig(undefined, contentStyles, byId), null);
});
check("OperatorConsole wires BOTH thumbnails and live through the shared resolver", () => {
  const src = readFileSync(new URL("../src/components/operator/OperatorConsole.tsx", import.meta.url), "utf8");
  assert.equal((src.match(/resolveItemThemeConfig\(/g) || []).length, 2);
  assert.ok(src.includes("resolveLiveItemIdx(plan.items"));
  assert.ok(!src.includes("contentTypeAppearance"), "old divergent live resolver must be gone");
  const grid = readFileSync(new URL("../src/components/operator/pro/center/SlideGrid.tsx", import.meta.url), "utf8");
  assert.equal((grid.match(/sourceItemIdx: ctx\.previewItemIdx/g) || []).length, 3);
  const broadcast = readFileSync(new URL("../src/lib/broadcast.ts", import.meta.url), "utf8");
  assert.ok(!/sourceItemIdx|itemIdx/.test(broadcast.slice(broadcast.indexOf("export function slideOutputIdentity"), broadcast.indexOf("export function slideOutputIdentity") + 1500)), "identity stays content-only");
});
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
