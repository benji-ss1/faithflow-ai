/**
 * Multi-output (Stage + Livestream) plumbing tests.
 *
 * Run: npx tsx --env-file=.env.local test/multi-output.test.ts
 *
 * Headless: no Electron, no BrowserWindow. We verify only:
 *   1. OutputState payload validation for `nextItem` and `countdownEndsAt`.
 *   2. Role → URL page presence for stage + livestream.
 *   3. livestreamUrl() builder handles OBS mode.
 */
import assert from "node:assert";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  EMPTY_OUTPUT,
  isValidOutputState,
  livestreamUrl,
  type OutputState,
} from "../src/lib/broadcast";

let pass = 0;
let fail = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn())
    .then(() => { console.log(`  PASS  ${name}`); pass++; })
    .catch((e) => { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; });
}

async function main() {
  console.log("Multi-output plumbing");

  const validBase: OutputState = { ...EMPTY_OUTPUT };

  // --- 1. nextItem validation --------------------------------------------
  await check("accepts nextItem with title + type", () => {
    const s = { ...validBase, nextItem: { title: "Song 2", type: "song" } };
    assert.strictEqual(isValidOutputState(s), true);
  });

  await check("rejects nextItem.title of wrong type", () => {
    const s = { ...validBase, nextItem: { title: 123 as unknown as string, type: "song" } };
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("rejects nextItem.title over 500 chars", () => {
    const s = { ...validBase, nextItem: { title: "x".repeat(10000), type: "song" } };
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("accepts nextItem === null", () => {
    const s = { ...validBase, nextItem: null };
    assert.strictEqual(isValidOutputState(s), true);
  });

  await check("rejects nextItem missing type", () => {
    const s = { ...validBase, nextItem: { title: "ok" } as unknown as { title: string; type: string } };
    assert.strictEqual(isValidOutputState(s), false);
  });

  // --- 1b. announcement logo validation -----------------------------------
  const annBase = { line1: "Welcome", position: "center_card" as const,
    style: { fontFamily: "Inter", fontSizePx: 32, fontWeight: 600, textColor: "#fff", bgColor: "#000", bgOpacity: 70, padding: 20, borderRadius: 8, align: "center" as const } };

  await check("accepts announcement with valid logo", () => {
    const s = { ...validBase, announcement: { ...annBase, logo: { url: "https://s3.example.com/logo.png", position: "top-right", sizePct: 12, opacity: 1 } } };
    assert.strictEqual(isValidOutputState(s), true);
  });

  await check("accepts announcement with logo === null", () => {
    const s = { ...validBase, announcement: { ...annBase, logo: null } };
    assert.strictEqual(isValidOutputState(s), true);
  });

  await check("rejects announcement logo with non-https url", () => {
    const s = { ...validBase, announcement: { ...annBase, logo: { url: "http://x/logo.png", position: "top-right", sizePct: 12, opacity: 1 } } };
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("rejects announcement logo with bad position", () => {
    const s = { ...validBase, announcement: { ...annBase, logo: { url: "https://s3.example.com/logo.png", position: "diagonal", sizePct: 12, opacity: 1 } } };
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("rejects announcement logo with out-of-range sizePct", () => {
    const s = { ...validBase, announcement: { ...annBase, logo: { url: "https://s3.example.com/logo.png", position: "center", sizePct: 500, opacity: 1 } } };
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("accepts upper-third / lower-third logo positions", () => {
    for (const position of ["upper-third", "lower-third"]) {
      const s = { ...validBase, announcement: { ...annBase, logo: { url: "https://s3.example.com/logo.png", position, sizePct: 12, opacity: 0.8 } } };
      assert.strictEqual(isValidOutputState(s), true, position);
    }
  });

  // --- 1c. rich slide objects (projector object rendering) ----------------
  const withLive = (live: unknown) => ({ ...validBase, live });
  const txtObj = { kind: "text", x: 80, y: 400, w: 1760, h: 280, text: "Grace", fontSize: 96, color: "#ffffff", align: "center" };

  await check("accepts text slide with a valid text object", () => {
    const s = withLive({ kind: "text", text: "Grace", objects: [txtObj] });
    assert.strictEqual(isValidOutputState(s), true);
  });

  await check("accepts shape + image objects", () => {
    const s = withLive({ kind: "text", text: "", objects: [
      { kind: "shape", x: 0, y: 0, w: 500, h: 300, shape: "rect", fill: "#14b8a6", opacity: 0.8 },
      { kind: "image", x: 100, y: 100, w: 400, h: 400, url: "https://s3.example.com/pic.png", fit: "cover" },
    ] });
    assert.strictEqual(isValidOutputState(s), true);
  });

  await check("accepts text slide with per-slide bgImageUrl (https)", () => {
    const s = withLive({ kind: "text", text: "x", bgImageUrl: "https://s3.example.com/bg.jpg", objects: [txtObj] });
    assert.strictEqual(isValidOutputState(s), true);
  });

  await check("rejects bgImageUrl over http (non-https)", () => {
    const s = withLive({ kind: "text", text: "x", bgImageUrl: "http://x/bg.jpg", objects: [txtObj] });
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("rejects object with non-finite coordinate", () => {
    const s = withLive({ kind: "text", text: "x", objects: [{ ...txtObj, x: Infinity }] });
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("rejects image object with non-https url", () => {
    const s = withLive({ kind: "text", text: "x", objects: [{ kind: "image", x: 0, y: 0, w: 100, h: 100, url: "javascript:alert(1)" }] });
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("rejects text object with hostile color", () => {
    const s = withLive({ kind: "text", text: "x", objects: [{ ...txtObj, color: "red;}body{}" }] });
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("accepts a valid video object", () => {
    const s = withLive({ kind: "text", text: "", objects: [
      { kind: "video", x: 100, y: 100, w: 800, h: 450, url: "https://s3.example.com/clip.mp4", fit: "cover", loop: true, muted: true },
    ] });
    assert.strictEqual(isValidOutputState(s), true);
  });

  await check("rejects video object with non-https url", () => {
    const s = withLive({ kind: "text", text: "", objects: [{ kind: "video", x: 0, y: 0, w: 100, h: 100, url: "http://x/clip.mp4" }] });
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("rejects video object with non-boolean loop", () => {
    const s = withLive({ kind: "text", text: "", objects: [{ kind: "video", x: 0, y: 0, w: 100, h: 100, url: "https://s3.example.com/clip.mp4", loop: "yes" }] });
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("accepts a shape with a gradient fill", () => {
    const s = withLive({ kind: "text", text: "", objects: [{ kind: "shape", x: 0, y: 0, w: 500, h: 300, shape: "rect", fill: "#14b8a6", fill2: "#0f766e", fillAngle: 135 }] });
    assert.strictEqual(isValidOutputState(s), true);
  });

  await check("rejects a shape gradient with a hostile fill2", () => {
    const s = withLive({ kind: "text", text: "", objects: [{ kind: "shape", x: 0, y: 0, w: 500, h: 300, shape: "rect", fill: "#14b8a6", fill2: "red;}body{}" }] });
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("rejects a shape gradient with out-of-range fillAngle", () => {
    const s = withLive({ kind: "text", text: "", objects: [{ kind: "shape", x: 0, y: 0, w: 500, h: 300, shape: "rect", fill: "#14b8a6", fill2: "#000", fillAngle: 999 }] });
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("accepts an object with a valid rotation", () => {
    const s = withLive({ kind: "text", text: "x", objects: [{ ...txtObj, rotation: -45 }] });
    assert.strictEqual(isValidOutputState(s), true);
  });

  await check("rejects rotation out of range (>360)", () => {
    const s = withLive({ kind: "text", text: "x", objects: [{ ...txtObj, rotation: 999 }] });
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("rejects non-finite rotation", () => {
    const s = withLive({ kind: "text", text: "x", objects: [{ ...txtObj, rotation: NaN }] });
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("accepts objects with a valid entrance animation", () => {
    const s = withLive({ kind: "text", text: "x", objects: [{ ...txtObj, anim: "slide-up", animDelayMs: 200 }] });
    assert.strictEqual(isValidOutputState(s), true);
  });

  await check("rejects unknown entrance animation", () => {
    const s = withLive({ kind: "text", text: "x", objects: [{ ...txtObj, anim: "explode" }] });
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("rejects out-of-range animDelayMs", () => {
    const s = withLive({ kind: "text", text: "x", objects: [{ ...txtObj, animDelayMs: 99999 }] });
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("rejects unknown object kind", () => {
    const s = withLive({ kind: "text", text: "x", objects: [{ kind: "video3d", x: 0, y: 0, w: 10, h: 10 }] });
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("rejects too many objects (>60)", () => {
    const many = Array.from({ length: 61 }, () => txtObj);
    const s = withLive({ kind: "text", text: "x", objects: many });
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("text slide without objects still valid (back-compat)", () => {
    const s = withLive({ kind: "text", text: "plain" });
    assert.strictEqual(isValidOutputState(s), true);
  });

  // --- 2. countdownEndsAt validation --------------------------------------
  await check("accepts countdownEndsAt in near future", () => {
    const s = { ...validBase, countdownEndsAt: Date.now() + 60_000 };
    assert.strictEqual(isValidOutputState(s), true);
  });

  await check("accepts countdownEndsAt === null", () => {
    const s = { ...validBase, countdownEndsAt: null };
    assert.strictEqual(isValidOutputState(s), true);
  });

  await check("rejects countdownEndsAt = -1", () => {
    const s = { ...validBase, countdownEndsAt: -1 };
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("rejects countdownEndsAt = NaN", () => {
    const s = { ...validBase, countdownEndsAt: NaN };
    assert.strictEqual(isValidOutputState(s), false);
  });

  await check("rejects countdownEndsAt more than 24h in future", () => {
    const s = { ...validBase, countdownEndsAt: Date.now() + 48 * 3600 * 1000 };
    assert.strictEqual(isValidOutputState(s), false);
  });

  // --- 3. Role → URL mapping matches real Next routes --------------------
  const ROLE_TO_PATH: Record<string, string> = {
    Projector: "/live",
    Stage: "/stage",
    Livestream: "/livestream",
  };
  for (const [role, path] of Object.entries(ROLE_TO_PATH)) {
    await check(`${role} → ${path} has a page.tsx`, () => {
      const p = resolve(process.cwd(), `src/app${path}/page.tsx`);
      assert.strictEqual(existsSync(p), true, `expected ${p} to exist`);
    });
  }

  // --- 4. livestreamUrl builder ------------------------------------------
  await check("livestreamUrl without opts returns base URL", () => {
    assert.strictEqual(livestreamUrl("Livestream", "http://localhost:3000"), "http://localhost:3000/livestream");
  });

  await check("livestreamUrl with obs=lowerthird appends query", () => {
    assert.strictEqual(
      livestreamUrl("Livestream", "http://localhost:3000", { obs: "lowerthird" }),
      "http://localhost:3000/livestream?obs=lowerthird",
    );
  });

  await check("livestreamUrl with obs=full omits query", () => {
    assert.strictEqual(
      livestreamUrl("Livestream", "http://localhost:3000", { obs: "full" }),
      "http://localhost:3000/livestream",
    );
  });

  // --- 5. ScreensPanel localStorage shape validation (Y7) -----------------
  const { parseStoredAssignments } = await import("../src/components/operator/screens/ScreensPanel");

  await check("parseStoredAssignments: null → {}", () => {
    assert.deepStrictEqual(parseStoredAssignments(null), {});
  });
  await check("parseStoredAssignments: invalid JSON → {}", () => {
    assert.deepStrictEqual(parseStoredAssignments("not json{"), {});
  });
  await check("parseStoredAssignments: array → {}", () => {
    assert.deepStrictEqual(parseStoredAssignments("[1,2,3]"), {});
  });
  await check("parseStoredAssignments: unknown role rejected", () => {
    const raw = JSON.stringify({ "1": { role: "Evil", preset: "1080p30", spawned: false } });
    assert.deepStrictEqual(parseStoredAssignments(raw), {});
  });
  await check("parseStoredAssignments: unknown preset falls back to 1080p30", () => {
    const raw = JSON.stringify({ "1": { role: "Stage", preset: "9001p", spawned: false } });
    const out = parseStoredAssignments(raw);
    assert.deepStrictEqual(out, { 1: { role: "Stage", preset: "1080p30", spawned: false } });
  });
  await check("parseStoredAssignments: valid entry round-trips", () => {
    const raw = JSON.stringify({ "42": { role: "Livestream", preset: "720p", spawned: true, obsMode: "lowerthird" } });
    assert.deepStrictEqual(parseStoredAssignments(raw), {
      42: { role: "Livestream", preset: "720p", spawned: true, obsMode: "lowerthird" },
    });
  });
  await check("parseStoredAssignments: unknown obsMode dropped", () => {
    const raw = JSON.stringify({ "1": { role: "Livestream", preset: "1080p30", spawned: false, obsMode: "spy" } });
    assert.deepStrictEqual(parseStoredAssignments(raw), {
      1: { role: "Livestream", preset: "1080p30", spawned: false },
    });
  });

  // --- 6. Livestream lower_third render decision (Y2) --------------------
  // The /livestream page renders the lower-third bubble in `lower_third` mode
  // ONLY when an explicit `lowerThird` payload is present. Text-kind slides
  // (song lyrics) must not fall through. Since we can't render the page
  // headless, we test the boolean decision the JSX gate expresses.
  function lowerThirdRenders(mode: "full" | "lower_third", lowerThird: { line1: string; line2: string } | null, slideKind: string): boolean {
    // Mirrors the JSX condition in src/app/livestream/page.tsx post-Y2.
    if (mode !== "lower_third") return false;
    void slideKind; // NOTE: slide.kind is intentionally NOT consulted anymore
    return lowerThird !== null;
  }
  await check("Y2: text-kind slide without lowerThird → does NOT render", () => {
    assert.strictEqual(lowerThirdRenders("lower_third", null, "text"), false);
  });
  await check("Y2: text-kind slide WITH lowerThird → renders", () => {
    assert.strictEqual(lowerThirdRenders("lower_third", { line1: "Speaker", line2: "" }, "text"), true);
  });
  await check("Y2: image slide without lowerThird → does NOT render", () => {
    assert.strictEqual(lowerThirdRenders("lower_third", null, "image"), false);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
