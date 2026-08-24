import assert from "node:assert";
import { projectableTextSlide } from "../src/lib/broadcast";

// Helper: does an image object with this url survive validation?
function survives(url: string): boolean {
  const p = projectableTextSlide("", "#000000", undefined, [
    { id: "x", kind: "image", x: 0, y: 0, w: 1920, h: 1080, url, fit: "cover", posX: 50, posY: 50, zoom: 1 },
  ]);
  return p.kind === "text" && Array.isArray(p.objects) && p.objects.some((o: any) => o.kind === "image" && o.url === url);
}

const cases: [string, boolean][] = [
  ["https://s3.example.com/media/logo.png?X-Amz-Signature=abc", true],
  ["http://localhost:9000/faithflow-media/logo.png", true],
  ["http://127.0.0.1:9000/faithflow-media/logo.png", true],
  ["http://[::1]:9000/x.png", true],
  ["http://evil.com/logo.png", false],            // arbitrary http still rejected
  ["http://localhost.evil.com/logo.png", false],  // suffix trick rejected
  ["http://127.1/x.png", true],                   // WHATWG normalizes shorthand → 127.0.0.1
  ["http://evil.com@localhost/x.png", true],       // userinfo is inert; host IS localhost
  ["http://localhost@evil.com/x.png", false],      // host is evil.com; userinfo=localhost ignored
  ["javascript:alert(1)", false],
  ["data:image/png;base64,AAAA", false],
  ["file:///etc/passwd", false],
  ['https://x.com/a".png', false],                // quote breakout rejected
];
let pass = 0, fail = 0;
for (const [url, want] of cases) {
  const got = survives(url);
  if (got === want) { pass++; console.log(`  PASS ${want ? "allow" : "reject"}: ${url}`); }
  else { fail++; console.error(`  FAIL want=${want} got=${got}: ${url}`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
assert.equal(fail, 0);
