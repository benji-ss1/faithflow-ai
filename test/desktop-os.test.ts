// Run: npx tsx test/desktop-os.test.ts
import assert from "node:assert/strict";
import { detectDesktopOs } from "../src/lib/desktop-os";

const WIN_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/129.0";

assert.equal(detectDesktopOs({ userAgent: WIN_CHROME }), "windows");
assert.equal(detectDesktopOs({ userAgent: MAC_SAFARI }), "mac");
assert.equal(detectDesktopOs({ userAgent: IPAD }), "other");
assert.equal(detectDesktopOs({ userAgent: LINUX }), "other");
assert.equal(detectDesktopOs({ userAgent: "Darwin something" }), "other", "darwin must not match win");
// Client hints win over a spoofed/odd UA.
assert.equal(detectDesktopOs({ userAgent: MAC_SAFARI, userAgentData: { platform: "Windows" } }), "windows");
assert.equal(detectDesktopOs({ userAgent: WIN_CHROME, userAgentData: { platform: "macOS" } }), "mac");
assert.equal(detectDesktopOs({ userAgent: WIN_CHROME, userAgentData: { platform: "Linux" } }), "other");
// Empty hint falls back to UA / platform.
assert.equal(detectDesktopOs({ userAgent: "", platform: "Win32", userAgentData: { platform: "" } }), "windows");
assert.equal(detectDesktopOs({ platform: "MacIntel" }), "mac");
assert.equal(detectDesktopOs(null), "other");
assert.equal(detectDesktopOs({}), "other");
console.log("desktop-os: all passed");
