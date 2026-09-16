import { buildMediaFrameSlide, shouldSendFramedSlide, saveMediaFrame, loadMediaFrame, clearMediaFrame, MEDIA_FRAME_CHANGED_EVENT } from "../src/components/operator/pro/center/mediaFrame";
import { projectableTextSlide } from "../src/lib/broadcast";
import assert from "node:assert";
const URL = "https://s3.example.com/x.png?X-Amz-Signature=a";
let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") { if (cond) { pass++; console.log("  PASS " + name); } else { fail++; console.error("  FAIL " + name + " " + detail); } }
const survives = (bgColor: string | undefined, objects: any[]) => (projectableTextSlide("", bgColor, undefined, objects) as any).objects?.length === objects.length;
{
  const { bgColor, objects } = buildMediaFrameSlide({ fit: "cover", posX: 50, posY: 50, zoom: 2 } as any, URL);
  check("matte bgColor black", bgColor === "#000000");
  check("matte one full-canvas image zoom preserved", objects.length === 1 && (objects[0] as any).kind === "image" && (objects[0] as any).w === 1920 && (objects[0] as any).zoom === 2);
  check("matte payload objects survive", survives(bgColor, objects));
}
{
  const { bgColor, objects } = buildMediaFrameSlide({ fit: "contain", posX: 50, posY: 50, zoom: 1, bgMode: "background", bgKind: "solid", bgSolid: "#123456", logoSizePct: 50 } as any, URL);
  check("solid bgColor", bgColor === "#123456");
  check("solid logo 50% centered", objects.length === 1 && (objects[0] as any).w === 960 && (objects[0] as any).x === 480);
  check("solid payload survives", survives(bgColor, objects));
}
{
  const { bgColor, objects } = buildMediaFrameSlide({ fit: "contain", posX: 50, posY: 50, zoom: 1, bgMode: "background", bgKind: "gradient", gradFrom: "#ff00aa", gradTo: "#00ff66", gradAngle: 90, logoSizePct: 40 } as any, URL);
  check("gradient bgColor = gradFrom backstop", bgColor === "#ff00aa");
  check("gradient shape FIRST + logo second", objects.length === 2 && (objects[0] as any).kind === "shape" && (objects[0] as any).fill === "#ff00aa" && (objects[0] as any).fill2 === "#00ff66" && (objects[0] as any).fillAngle === 90 && (objects[1] as any).kind === "image");
  check("gradient logo 40% centered", (objects[1] as any).w === 768 && (objects[1] as any).x === 576);
  check("gradient payload survives (shape+image)", survives(bgColor, objects));
}
{
  const { bgColor, objects } = buildMediaFrameSlide({ fit: "contain", posX: 50, posY: 50, zoom: 1, bgMode: "background", bgKind: "theme", logoSizePct: 60 } as any, URL);
  check("theme bgColor undefined", bgColor === undefined);
  check("theme one logo object", objects.length === 1 && (objects[0] as any).kind === "image");
}
{
  // Blur fill: a full-screen blurred image backdrop (objects[0]) + sharp logo (objects[1]).
  const { bgColor, objects } = buildMediaFrameSlide({ fit: "contain", posX: 50, posY: 50, zoom: 1, bgMode: "background", bgKind: "blur", logoSizePct: 55 } as any, URL);
  check("blur bgColor black backstop", bgColor === "#000000");
  check("blur backdrop FIRST: full-canvas cover image with blur flag", objects.length === 2 && (objects[0] as any).kind === "image" && (objects[0] as any).w === 1920 && (objects[0] as any).h === 1080 && (objects[0] as any).fit === "cover" && (objects[0] as any).blur === true);
  check("blur backdrop uses the same image url", (objects[0] as any).url === URL);
  check("blur logo second: sharp contain, no blur", (objects[1] as any).kind === "image" && (objects[1] as any).fit === "contain" && !(objects[1] as any).blur && (objects[1] as any).w === 1056);
  check("blur payload survives (backdrop+logo)", survives(bgColor, objects));
}
{
  // Saved box (handle crop/resize) is used in matte + background; legacy frames unchanged.
  const m = buildMediaFrameSlide({ fit: "cover", posX: 50, posY: 50, zoom: 1, boxX: 100, boxY: 50, boxW: 800, boxH: 600 } as any, URL);
  check("matte saved box used", (m.objects[0] as any).x === 100 && (m.objects[0] as any).y === 50 && (m.objects[0] as any).w === 800 && (m.objects[0] as any).h === 600);
  check("matte box payload survives", survives(m.bgColor, m.objects));
  const b = buildMediaFrameSlide({ fit: "contain", posX: 50, posY: 50, zoom: 1, bgMode: "background", bgKind: "solid", logoSizePct: 50, boxX: 10, boxY: 20, boxW: 900, boxH: 300 } as any, URL);
  check("logo saved box (non-square %) used", (b.objects[0] as any).w === 900 && (b.objects[0] as any).h === 300 && (b.objects[0] as any).x === 10);
  const partial = buildMediaFrameSlide({ fit: "cover", posX: 50, posY: 50, zoom: 1, boxX: 5 } as any, URL);
  check("partial box ignored → full canvas", (partial.objects[0] as any).w === 1920 && (partial.objects[0] as any).x === 0);
}
{
  // localStorage round-trip: box persisted, event fired, default→church migration.
  const store = new Map<string, string>();
  const events: any[] = [];
  (globalThis as any).window = {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    dispatchEvent: (e: any) => { events.push(e); return true; },
  };
  if (typeof (globalThis as any).CustomEvent === "undefined") (globalThis as any).CustomEvent = class { type: string; detail: any; constructor(t: string, o: any) { this.type = t; this.detail = o?.detail; } };
  saveMediaFrame("c1", "a1", { fit: "contain", posX: 40, posY: 60, zoom: 2, boxX: 100, boxY: 50, boxW: 800, boxH: 600 });
  const f = loadMediaFrame("c1", "a1");
  check("box round-trips", f?.boxX === 100 && f?.boxW === 800 && f?.boxH === 600);
  check("save fires frame-changed event", events.length === 1 && events[0].type === MEDIA_FRAME_CHANGED_EVENT && events[0].detail.assetId === "a1" && events[0].detail.churchId === "c1");
  clearMediaFrame("c1", "a1");
  check("clear fires event", events.length === 2 && loadMediaFrame("c1", "a1") === null);
  store.set("pf.mediaFrame.v1.default.a2", JSON.stringify({ fit: "cover", posX: 50, posY: 50, zoom: 3 }));
  const mig = loadMediaFrame("c1", "a2");
  check("default-key frame NOT adopted by a church (no cross-church leak)", mig === null && !store.has("pf.mediaFrame.v1.c1.a2") && store.has("pf.mediaFrame.v1.default.a2"));
  check("no church id reads only the default key (pre-existing behaviour)", loadMediaFrame(undefined, "a2")?.zoom === 3 && loadMediaFrame(undefined, "a1") === null);
  const legacy = loadMediaFrame("c1", "nope");
  check("missing frame → null", legacy === null);
  delete (globalThis as any).window;
}
{
  // Logo-mode frame WITHOUT a saved box (legacy) → centred size% box, not full screen.
  const l = buildMediaFrameSlide({ fit: "contain", posX: 50, posY: 50, zoom: 1, bgMode: "background", bgKind: "solid", bgSolid: "#112233", logoSizePct: 50 } as any, URL);
  const lg = l.objects.find((o: any) => o.kind === "image") as any;
  check("logo legacy box is 50% centred (not full screen)", lg.w === 960 && lg.h === 540 && lg.x === 480 && lg.y === 270 && lg.fit === "contain");
  check("logo legacy payload survives", survives(l.bgColor, l.objects));
  // Click routing: framed image with nothing live → framed slide; words live → media layer.
  check("framed + nothing live → framed slide", shouldSendFramedSlide(true, false, null) === true);
  check("framed + blank live → framed slide", shouldSendFramedSlide(true, false, { kind: "blank" }) === true);
  check("framed + empty-text image live → framed slide", shouldSendFramedSlide(true, false, { kind: "text", text: "" }) === true);
  check("framed + words live → media layer", shouldSendFramedSlide(true, false, { kind: "text", text: "Amazing grace" }) === false);
  check("unframed → media layer", shouldSendFramedSlide(false, false, null) === false);
  check("video → media layer", shouldSendFramedSlide(true, true, null) === false);
}
console.log(`\n${pass} passed, ${fail} failed`); assert.equal(fail, 0);
