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

console.log("update-banner-arch: all passed");
