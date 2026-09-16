// Run: npx tsx test/update-banner-arch.test.ts
//
// macArchChoice — the Mac architecture decision behind the desktop update
// banner. The bug this locks down: the old sniff returned arm64 whenever it
// COULDN'T tell, so an Intel Mac with WebGL blocked was handed an Apple-Silicon
// DMG that will not run. Unknown must now be "ask" (banner offers both).
import assert from "node:assert/strict";
import { macArchChoice } from "../src/components/operator/pro/UpdateBanner";

// --- Apple Silicon → arm64 -------------------------------------------------
assert.equal(macArchChoice("Apple M1"), "arm64");
assert.equal(macArchChoice("Apple M3 Max"), "arm64");
assert.equal(macArchChoice("ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)"), "arm64");
assert.equal(macArchChoice("Apple GPU"), "arm64", "Safari on Apple Silicon");
assert.equal(macArchChoice("apple m1 pro"), "arm64", "case-insensitive");

// --- Intel / AMD → x64 -----------------------------------------------------
assert.equal(macArchChoice("Intel Iris Pro OpenGL Engine"), "x64");
assert.equal(macArchChoice("AMD Radeon Pro 5500M OpenGL Engine"), "x64");
assert.equal(macArchChoice("Radeon Pro 560X"), "x64");
// Chrome on an INTEL Mac still names Apple as the ANGLE vendor — the Intel
// test must win, or an Intel Mac gets an arm64 DMG (the original bug).
assert.equal(
  macArchChoice("ANGLE (Apple, ANGLE Metal Renderer: Intel(R) UHD Graphics 630, Unspecified Version)"),
  "x64",
  "Intel-on-ANGLE must not be read as Apple Silicon",
);

// --- Unknown / blocked → ask ----------------------------------------------
assert.equal(macArchChoice(null), "ask", "no WebGL context / no debug-renderer extension");
assert.equal(macArchChoice(""), "ask");
assert.equal(macArchChoice("   "), "ask", "whitespace only");
assert.equal(macArchChoice("WebKit WebGL"), "ask", "masked renderer");
assert.equal(macArchChoice("Mozilla"), "ask", "masked renderer");
assert.equal(macArchChoice("Swiftshader"), "ask", "software fallback tells us nothing about the CPU");
assert.equal(macArchChoice("something entirely unrecognised"), "ask");

// --- Apple vendor word WITHOUT an Apple-Silicon shape → ask ----------------
// Both are real macOS strings that appear on INTEL machines / VMs, so the bare
// vendor word "Apple" must never be enough to pick arm64.
assert.equal(macArchChoice("Apple Software Renderer"), "ask", "software GL fallback on an Intel Mac");
assert.equal(macArchChoice("Apple Paravirtual device"), "ask", "VM");
assert.equal(macArchChoice("ANGLE (Apple, Apple Software Renderer, Unspecified Version)"), "ask");

// --- Full real-renderer table ---------------------------------------------
const TABLE: [string | null, "arm64" | "x64" | "ask"][] = [
  // Apple Silicon (Safari, Chrome/ANGLE, Firefox)
  ["Apple GPU", "arm64"],
  ["Apple M1", "arm64"],
  ["Apple M1 Pro", "arm64"],
  ["Apple M1 Max", "arm64"],
  ["Apple M2", "arm64"],
  ["Apple M3 Max", "arm64"],
  ["Apple M4 Pro", "arm64"],
  ["ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)", "arm64"],
  ["ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)", "arm64"],
  ["ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Max, Unspecified Version)", "arm64"],
  ["Apple Silicon", "arm64"],
  // Intel Macs — integrated, discrete AMD, and legacy NVIDIA
  ["Intel Iris Pro OpenGL Engine", "x64"],
  ["Intel Iris Plus Graphics 655", "x64"],
  ["Intel(R) UHD Graphics 630", "x64"],
  ["Intel HD Graphics 4000 OpenGL Engine", "x64"],
  ["AMD Radeon Pro 5500M OpenGL Engine", "x64"],
  ["AMD Radeon Pro 560X OpenGL Engine", "x64"],
  ["Radeon Pro Vega 20", "x64"],
  ["NVIDIA GeForce GT 750M OpenGL Engine", "x64"],
  ["ANGLE (Apple, ANGLE Metal Renderer: Intel(R) UHD Graphics 630, Unspecified Version)", "x64"],
  ["ANGLE (Apple, ANGLE Metal Renderer: Intel(R) Iris(TM) Plus Graphics, Unspecified Version)", "x64"],
  ["ANGLE (Apple, ANGLE Metal Renderer: AMD Radeon Pro 5300M, Unspecified Version)", "x64"],
  ["ANGLE (Intel, Intel(R) Iris(TM) Graphics 6100, OpenGL 4.1)", "x64"],
  // Tells us nothing → must ask
  [null, "ask"],
  ["", "ask"],
  ["   ", "ask"],
  ["WebKit WebGL", "ask"],
  ["Mozilla", "ask"],
  ["Google SwiftShader", "ask"],
  ["Apple Software Renderer", "ask"],
  ["Apple Paravirtual device", "ask"],
];
assert.equal(TABLE.length, 31, "31-string real renderer table");
let intelToArm = 0;
let appleToX64 = 0;
for (const [renderer, expected] of TABLE) {
  const got = macArchChoice(renderer);
  assert.equal(got, expected, `${JSON.stringify(renderer)} → ${got} (expected ${expected})`);
  if (expected === "x64" && got === "arm64") intelToArm++;
  if (expected === "arm64" && got === "x64") appleToX64++;
}
assert.equal(intelToArm, 0, "no Intel machine may be handed an arm64 DMG");
assert.equal(appleToX64, 0);

console.log("update-banner-arch: all passed (31-string table, 0 Intel→arm64, 0 Apple→x64)");
