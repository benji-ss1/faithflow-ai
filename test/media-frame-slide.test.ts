import { buildMediaFrameSlide } from "../src/components/operator/pro/center/mediaFrame";
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
console.log(`\n${pass} passed, ${fail} failed`); assert.equal(fail, 0);
