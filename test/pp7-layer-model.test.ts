/**
 * PP7 layer model (src/lib/pp7-layer-model.ts) — pure unit tests. This model is
 * the single source of truth shared by the PP7 clear rail and the PP7 Layers
 * panel, so a drift here is a drift between the two surfaces.
 *
 * Run: npx tsx test/pp7-layer-model.test.ts
 */
import assert from "node:assert/strict";
import { PP7_CLEAR_ORDER, PP7_CLEAR_LABEL } from "../src/lib/pp7-clear";
import {
  PP7_LAYER_AVAILABLE, pp7AnyLive, pp7ClearAll, pp7ClearLayer, pp7LayerActive,
  pp7MessagesLive, type Pp7ClearEffects, type Pp7LayerInputs,
} from "../src/lib/pp7-layer-model";

let passed = 0, failed = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log("  PASS ", name); }
  catch (e) { failed++; console.log("  FAIL ", name); console.error(e); }
};

function inputs(o: Partial<Pp7LayerInputs> & { rows?: string[] } = {}): Pp7LayerInputs {
  const rows = new Set(o.rows ?? []);
  return {
    kind: o.kind,
    rowActive: o.rowActive ?? ((id) => rows.has(id)),
    announcementActive: o.announcementActive ?? false,
    backgroundSpecActive: o.backgroundSpecActive ?? false,
    videoInputActive: o.videoInputActive ?? false,
    messagesActive: o.messagesActive ?? false,
  };
}

function spy() {
  const calls: string[] = [];
  const fx: Pp7ClearEffects = {
    killSlide: () => calls.push("kill"),
    setBackgroundNone: () => calls.push("bgNone"),
    clearLayer: (id) => calls.push(`clearLayer:${id}`),
    clearVideoInput: () => calls.push("clearVideoInput"),
    clearAnnouncement: () => calls.push("clearAnnouncement"),
    clearMessages: () => calls.push("clearMessages"),
    clearLowerThird: () => calls.push("lowerThird"),
  };
  return { calls, fx };
}

// ── Labels / order ───────────────────────────────────────────────────────────
check("PP7 order + labels: no Background / Camera / Logo wording escapes", () => {
  assert.deepEqual([...PP7_CLEAR_ORDER], ["audio", "messages", "props", "announcements", "slide", "media", "videoInput"]);
  const labels = PP7_CLEAR_ORDER.map((l) => PP7_CLEAR_LABEL[l]);
  assert.deepEqual(labels, ["Audio", "Messages", "Props", "Announcements", "Slide", "Media", "Video Input"]);
  for (const bad of ["Background", "Camera", "Logo"]) {
    assert.equal(labels.includes(bad), false, `${bad} is not a PP7 layer name`);
  }
});

check("Audio is the only unavailable layer", () => {
  assert.equal(PP7_LAYER_AVAILABLE.audio, false);
  for (const l of PP7_CLEAR_ORDER) if (l !== "audio") assert.equal(PP7_LAYER_AVAILABLE[l], true, l);
});

// ── Active mapping ───────────────────────────────────────────────────────────
check("nothing live → every layer idle", () => {
  const a = pp7LayerActive(inputs());
  assert.deepEqual(PP7_CLEAR_ORDER.map((l) => a[l]), Array(7).fill(false));
  assert.equal(pp7AnyLive(a), false);
});

check("audio is never active", () => {
  assert.equal(pp7LayerActive(inputs({ rows: ["background", "camera", "slide", "logo"], messagesActive: true })).audio, false);
});

check("a text slide lights Slide, not Media", () => {
  const a = pp7LayerActive(inputs({ kind: "text", rows: ["slide"] }));
  assert.equal(a.slide, true);
  assert.equal(a.media, false);
});

check("an image/video slide lights Media, not Slide", () => {
  for (const kind of ["image", "video"]) {
    const a = pp7LayerActive(inputs({ kind, rows: ["slide"] }));
    assert.equal(a.slide, false, `${kind}: slide idle`);
    assert.equal(a.media, true, `${kind}: media live`);
  }
});

check("an empty/blank slide lights nothing", () => {
  for (const kind of [undefined, "empty", "blank"]) {
    assert.equal(pp7LayerActive(inputs({ kind, rows: ["slide"] })).slide, false, String(kind));
  }
});

check("background row lights Media", () => {
  assert.equal(pp7LayerActive(inputs({ kind: "text", rows: ["background"] })).media, true);
});

check("media still reads live behind a live camera (background row goes off)", () => {
  // Legacy plan switches the background row off while the camera is live; PP7
  // order paints media over the camera, so the base spec is read too.
  const a = pp7LayerActive(inputs({ kind: "text", rows: ["camera"], backgroundSpecActive: true, videoInputActive: true }));
  assert.equal(a.media, true, "media live from the base background spec");
  assert.equal(a.videoInput, true);
});

check("video input needs BOTH the feed and the camera row", () => {
  assert.equal(pp7LayerActive(inputs({ videoInputActive: true })).videoInput, false, "no camera row");
  assert.equal(pp7LayerActive(inputs({ rows: ["camera"] })).videoInput, false, "no feed");
  assert.equal(pp7LayerActive(inputs({ rows: ["camera"], videoInputActive: true })).videoInput, true);
});

check("props tracks the logo row; announcements + messages track their flags", () => {
  assert.equal(pp7LayerActive(inputs({ rows: ["logo"] })).props, true);
  assert.equal(pp7LayerActive(inputs({ announcementActive: true })).announcements, true);
  assert.equal(pp7LayerActive(inputs({ messagesActive: true })).messages, true);
});

check("pp7MessagesLive: timers show through the Messages layer", () => {
  const base = { messagesShowing: false, boardHasVisible: false, timerShown: false, anyTimerSlotShown: false };
  assert.equal(pp7MessagesLive(base), false);
  assert.equal(pp7MessagesLive({ ...base, messagesShowing: true }), true);
  assert.equal(pp7MessagesLive({ ...base, boardHasVisible: true }), true);
  assert.equal(pp7MessagesLive({ ...base, timerShown: true }), true);
  assert.equal(pp7MessagesLive({ ...base, anyTimerSlotShown: true }), true);
});

// ── Clear actions ────────────────────────────────────────────────────────────
check("clear Slide kills the slide (text slide)", () => {
  const { calls, fx } = spy();
  pp7ClearLayer("slide", inputs({ kind: "text", rows: ["slide"] }), fx);
  assert.deepEqual(calls, ["kill"]);
});

check("clear Slide does NOT kill a media slide (that is the Media layer)", () => {
  const { calls, fx } = spy();
  pp7ClearLayer("slide", inputs({ kind: "image", rows: ["slide"] }), fx);
  assert.deepEqual(calls, []);
});

check("clear Media: background store → none, layer clear, and kills a media slide", () => {
  const a = spy();
  pp7ClearLayer("media", inputs({ kind: "text", rows: ["background"] }), a.fx);
  assert.deepEqual(a.calls, ["bgNone", "clearLayer:background"]);
  const b = spy();
  pp7ClearLayer("media", inputs({ kind: "image", rows: ["slide"] }), b.fx);
  assert.deepEqual(b.calls, ["bgNone", "kill"]);
});

check("clear Video Input only when a feed is live", () => {
  const a = spy();
  pp7ClearLayer("videoInput", inputs({ videoInputActive: true, rows: ["camera"] }), a.fx);
  assert.deepEqual(a.calls, ["clearVideoInput"]);
  const b = spy();
  pp7ClearLayer("videoInput", inputs(), b.fx);
  assert.deepEqual(b.calls, []);
});

check("clear Props ALWAYS runs, live logo or not (no silent no-op)", () => {
  const a = spy();
  pp7ClearLayer("props", inputs({ rows: ["logo"] }), a.fx);
  assert.deepEqual(a.calls, ["clearLayer:logo"]);
  // 2026-09-17: the old `if (rowActive("logo"))` guard made this a silent
  // no-op for any church with no theme logo. Clearing is idempotent.
  const b = spy();
  pp7ClearLayer("props", inputs(), b.fx);
  assert.deepEqual(b.calls, ["clearLayer:logo"], "fires even with nothing live");
});

check("clear Announcements / Messages; Audio is inert", () => {
  const a = spy(); pp7ClearLayer("announcements", inputs(), a.fx);
  assert.deepEqual(a.calls, ["clearAnnouncement"]);
  const b = spy(); pp7ClearLayer("messages", inputs(), b.fx);
  assert.deepEqual(b.calls, ["clearMessages"]);
  const c = spy(); pp7ClearLayer("audio", inputs(), c.fx);
  assert.deepEqual(c.calls, []);
});

// ── Victor acceptance test #4 — clear Message, nothing else moves ────────────
check("Victor #4: clearing Messages touches ONLY the Messages layer", () => {
  const i = inputs({ kind: "text", rows: ["slide", "background", "logo", "camera"], videoInputActive: true, backgroundSpecActive: true, announcementActive: true, messagesActive: true });
  const before = pp7LayerActive(i);
  const { calls, fx } = spy();
  pp7ClearLayer("messages", i, fx);
  assert.deepEqual(calls, ["clearMessages"], "no slide kill, no background reset, no layer clear, no camera stop");
  // The other layers' live state is derived from untouched inputs.
  const after = pp7LayerActive({ ...i, messagesActive: false });
  for (const l of PP7_CLEAR_ORDER) {
    if (l === "messages") { assert.equal(after[l], false, "messages cleared"); continue; }
    assert.equal(after[l], before[l], `${l} survives a message clear`);
  }
  assert.equal(after.slide, true, "slide survives");
  assert.equal(after.media, true, "media survives");
});

// ── Victor acceptance test #5 — change media, slide + message survive ───────
check("Victor #5: changing media leaves Slide and Messages alone", () => {
  const i = inputs({ kind: "text", rows: ["slide", "background"], messagesActive: true });
  const before = pp7LayerActive(i);
  assert.equal(before.slide, true);
  assert.equal(before.messages, true);
  // A media swap changes only the background spec/row — model it as a new input.
  const after = pp7LayerActive({ ...i, backgroundSpecActive: true });
  assert.equal(after.slide, true, "slide survives a media change");
  assert.equal(after.messages, true, "message survives a media change");
  assert.equal(after.media, true);
  // And clearing Media never touches the slide text or the messages.
  const { calls, fx } = spy();
  pp7ClearLayer("media", i, fx);
  assert.deepEqual(calls, ["bgNone", "clearLayer:background"], "no kill (text slide), no clearMessages");
});

// ── Clear All ────────────────────────────────────────────────────────────────
check("Clear All runs every per-layer clear in rail order, then the lower third", () => {
  const { calls, fx } = spy();
  pp7ClearAll(inputs({ kind: "text", rows: ["slide", "background", "logo", "camera"], videoInputActive: true }), fx);
  assert.deepEqual(calls, [
    "clearMessages", "clearLayer:logo", "clearAnnouncement", "kill", "bgNone", "clearLayer:background", "clearVideoInput", "lowerThird",
  ]);
});

check("Clear All clears Props even when no logo is live", () => {
  const { calls, fx } = spy();
  pp7ClearAll(inputs(), fx);
  assert.equal(calls.includes("clearLayer:logo"), true);
});

// ── Timers ride the Messages layer (PP7) ─────────────────────────────────────
check("clearing Messages is the ONLY place timers are taken off screen", () => {
  // The model dispatches one effect; the shell's clearMessages hides the
  // message, the board AND every shown timer overlay (see usePp7Messages).
  const { calls, fx } = spy();
  pp7ClearLayer("messages", inputs({ messagesActive: true }), fx);
  assert.deepEqual(calls, ["clearMessages"]);
});

check("Clear All includes the Messages clear (so a live timer goes too)", () => {
  const { calls, fx } = spy();
  pp7ClearAll(inputs({ messagesActive: true }), fx);
  assert.equal(calls[0], "clearMessages", "messages (and its timers) clear first");
});

check("a shown timer alone lights the Messages layer", () => {
  assert.equal(pp7LayerActive(inputs({
    messagesActive: pp7MessagesLive({ messagesShowing: false, boardHasVisible: false, timerShown: true, anyTimerSlotShown: false }),
  })).messages, true);
  assert.equal(pp7LayerActive(inputs({
    messagesActive: pp7MessagesLive({ messagesShowing: false, boardHasVisible: false, timerShown: false, anyTimerSlotShown: true }),
  })).messages, true, "a named timer slot counts too");
});

check("Clear All does not call liveLayers.clearAll (camera/media stay usable)", () => {
  const { calls, fx } = spy();
  pp7ClearAll(inputs(), fx);
  assert.equal(calls.includes("clearAll"), false);
});

// ── Slide vs Media independence (Victor, screen recording 2026-09-19) ───────
// "Clearing Slide also removes the image underneath it." Each layer's clear must
// clear ONLY its own layer; the Background Template (Media Bin "Bg" / "Set as
// global background" / Layers panel "Change media") is the Media layer.
check("Slide clear with a global media background live: ONLY the slide is killed", () => {
  const i = inputs({ kind: "text", rows: ["slide", "background"], backgroundSpecActive: true });
  const { calls, fx } = spy();
  pp7ClearLayer("slide", i, fx);
  assert.deepEqual(calls, ["kill"], "no bgNone, no clearLayer:background — media untouched");
});

check("after Slide clear the media background is STILL live and the slide is idle", () => {
  // The state the shell reads back after onKill(): empty slide, background row on.
  const after = pp7LayerActive(inputs({ kind: "empty", rows: ["background"], backgroundSpecActive: true }));
  assert.equal(after.media, true, "global media survives a Slide clear");
  assert.equal(after.slide, false);
  // …and it survives with a live camera too, in both draw orders.
  for (const pp7DrawOrder of [false, true]) {
    const withCam = pp7LayerActive(inputs({
      kind: "empty", rows: pp7DrawOrder ? ["background", "camera"] : ["camera"],
      backgroundSpecActive: true, videoInputActive: true, pp7DrawOrder,
    }));
    assert.equal(withCam.media, true, `media survives a Slide clear over a camera (pp7DrawOrder=${pp7DrawOrder})`);
  }
});

check("Clear Media with a live text slide never touches the slide; slide stays lit", () => {
  const i = inputs({ kind: "text", rows: ["slide", "background"], backgroundSpecActive: true });
  const { calls, fx } = spy();
  pp7ClearLayer("media", i, fx);
  assert.equal(calls.includes("kill"), false, "Clear Media must not clear the slide");
  assert.deepEqual(calls, ["bgNone", "clearLayer:background"]);
  // Slide layer is unaffected by the media clear (state after: bg gone, slide on).
  const after = pp7LayerActive(inputs({ kind: "text", rows: ["slide"] }));
  assert.equal(after.slide, true);
  assert.equal(after.media, false);
});

check("Slide clear then Clear Media, and the reverse: each removes only its own layer", () => {
  // Slide first, then Media.
  const a = spy();
  pp7ClearLayer("slide", inputs({ kind: "text", rows: ["slide", "background"], backgroundSpecActive: true }), a.fx);
  pp7ClearLayer("media", inputs({ kind: "empty", rows: ["background"], backgroundSpecActive: true }), a.fx);
  assert.deepEqual(a.calls, ["kill", "bgNone", "clearLayer:background"]);
  // Media first, then Slide.
  const b = spy();
  pp7ClearLayer("media", inputs({ kind: "text", rows: ["slide", "background"], backgroundSpecActive: true }), b.fx);
  pp7ClearLayer("slide", inputs({ kind: "text", rows: ["slide"] }), b.fx);
  assert.deepEqual(b.calls, ["bgNone", "clearLayer:background", "kill"]);
});

check("Clear All is the only single action that clears BOTH slide and media", () => {
  const { calls, fx } = spy();
  pp7ClearAll(inputs({ kind: "text", rows: ["slide", "background"], backgroundSpecActive: true }), fx);
  assert.equal(calls.includes("kill"), true, "slide cleared");
  assert.equal(calls.includes("bgNone"), true, "media cleared");
});

console.log(`pp7-layer-model: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
