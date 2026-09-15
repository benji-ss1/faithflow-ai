/**
 * Scenes model (2026-09-16) — the pure contracts every other layer leans on:
 * whitelist sanitation, "empty scene is a provable no-op", wire building with
 * operator-side theme resolution, and the 5 built-ins being sane.
 *
 * Run: npx tsx test/scenes.test.ts
 */
import assert from "node:assert/strict";
import type { ThemeAppearance } from "../src/lib/broadcast";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

async function main() {
  const S = await import("../src/lib/scenes");

  check("sanitizeSceneConfig keeps only known screens, layers and 0..1 opacity", () => {
    const cfg = S.sanitizeSceneConfig({
      screens: {
        main: { layers: { slide: false, bogus: false }, opacity: { background: 0.5, slide: 9 } },
        lobby: { layers: { slide: false } },
        stage: { themeId: "theme-1" },
        ndi: { layers: { camera: "nope" } },
      },
    });
    assert.deepEqual(cfg.screens.main?.layers, { slide: false });
    assert.deepEqual(cfg.screens.main?.opacity, { background: 0.5 });
    assert.equal("lobby" in cfg.screens, false, "unknown screen dropped");
    assert.equal(cfg.screens.stage?.themeId, "theme-1");
    assert.equal(cfg.screens.ndi, undefined, "screen with only invalid values dropped");
  });

  check("sanitizeSceneConfig rejects junk and pollution keys", () => {
    for (const junk of [null, undefined, 42, "x", [], { screens: 5 }, { screens: [] }]) {
      assert.deepEqual(S.sanitizeSceneConfig(junk), { screens: {} });
    }
    const polluted = JSON.parse('{"screens":{"__proto__":{"layers":{"slide":false}},"main":{"layers":{"slide":false}}}}');
    const cfg = S.sanitizeSceneConfig(polluted);
    assert.deepEqual(Object.keys(cfg.screens), ["main"]);
    assert.equal(({} as Record<string, unknown>).layers, undefined, "Object.prototype untouched");
  });

  check("an empty scene is a provable no-op (null wire)", () => {
    assert.equal(S.isEmptySceneConfig({ screens: {} }), true);
    assert.equal(S.isEmptySceneConfig(null), true);
    assert.equal(S.sceneToWire({ id: "x", name: "Empty", config: { screens: {} } }), null);
    assert.equal(S.sceneToWire({ id: "x", name: "Junk", config: { screens: { main: {} } } as never }), null);
    assert.equal(S.isEmptySceneConfig({ screens: { main: { layers: { slide: false } } } }), false);
  });

  check("sceneToWire resolves themes operator-side and never carries a themeId", () => {
    const appearance = { textColor: "#fff", bgColor: "#000" } as ThemeAppearance;
    const wire = S.sceneToWire(
      { id: "s1", name: "Worship", config: { screens: { livestream: { themeId: "t-9", layers: { background: false } } } } },
      { rev: 7, resolveAppearance: (id) => (id === "t-9" ? appearance : null) },
    );
    assert.ok(wire);
    assert.equal(wire!.rev, 7);
    assert.equal(wire!.screens.livestream?.appearance, appearance);
    assert.equal((wire!.screens.livestream as Record<string, unknown>).themeId, undefined);
    assert.equal(JSON.stringify(wire).includes("t-9"), false, "no themeId on the wire");
  });

  check("an unresolvable theme degrades to the shared theme, not a blank screen", () => {
    const wire = S.sceneToWire(
      { id: "s2", name: "X", config: { screens: { main: { themeId: "gone", layers: { logo: false } } } } },
      { resolveAppearance: () => null },
    );
    assert.equal(wire!.screens.main?.appearance, undefined);
    assert.deepEqual(wire!.screens.main?.layers, { logo: false });
  });

  check("a scene never carries camera device info (remote-safe)", () => {
    for (const sc of S.BUILT_IN_SCENES) {
      const wire = S.sceneToWire(sc);
      const json = JSON.stringify(wire ?? {});
      assert.equal(json.includes("deviceId"), false, `${sc.id} carries no deviceId`);
      for (const screen of S.SCENE_SCREENS) {
        const cam = S.maskFor(wire, screen)?.layers?.camera;
        assert.ok(cam === undefined || typeof cam === "boolean", "camera is visibility-only");
      }
    }
  });

  check("maskFor / sceneHidesLayer", () => {
    const wire = S.sceneToWire({ id: "s3", name: "T", config: { screens: { stage: { layers: { background: false } } } } })!;
    assert.equal(S.maskFor(wire, "stage")?.layers?.background, false);
    assert.equal(S.maskFor(wire, "main"), undefined, "unrouted screen = no mask = no change");
    assert.equal(S.maskFor(null, "stage"), undefined);
    assert.equal(S.sceneHidesLayer(wire, "stage", "background"), true);
    assert.equal(S.sceneHidesLayer(wire, "stage", "slide"), false);
    assert.equal(S.sceneHidesLayer(wire, "main", "background"), false);
  });

  check("the 5 built-ins exist, are unique, valid and non-empty", () => {
    assert.equal(S.BUILT_IN_SCENES.length, 5);
    const names = S.BUILT_IN_SCENES.map((s) => s.name);
    assert.deepEqual(names, ["Worship", "Teaching", "Announcement", "Offering", "Pre-Service"]);
    const ids = new Set(S.BUILT_IN_SCENES.map((s) => s.id));
    assert.equal(ids.size, 5, "ids unique");
    for (const s of S.BUILT_IN_SCENES) {
      assert.ok(S.SCENE_ID_RE.test(s.id), `${s.id} is a safe token`);
      assert.equal(s.isBuiltIn, true);
      assert.equal(S.isEmptySceneConfig(s.config), false, `${s.name} routes something`);
      // Every built-in must survive sanitation unchanged (no typos in our own data).
      assert.deepEqual(S.sanitizeSceneConfig(s.config), s.config, `${s.name} is already canonical`);
      assert.ok(S.builtInScene(s.id));
    }
  });

  check("no built-in hides the words on the main projector except Pre-Service", () => {
    for (const s of S.BUILT_IN_SCENES) {
      const wire = S.sceneToWire(s)!;
      const hidesWords = S.sceneHidesLayer(wire, "main", "slide");
      assert.equal(hidesWords, s.id === "builtin-pre-service", `${s.name}: main words hidden=${hidesWords}`);
    }
  });

  console.log(`\nScenes model: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
