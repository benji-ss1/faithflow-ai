// Loader for the compiled Blackmagic embedded-audio addon. Returns null when the
// addon wasn't built (no SDK at build time) — callers must degrade gracefully.
"use strict";
const path = require("path");
let mod = null;
for (const p of [
  path.join(__dirname, "build", "Release", "decklink_audio.node"),
  process.resourcesPath ? path.join(process.resourcesPath, "native", "decklink-audio", "build", "Release", "decklink_audio.node") : null,
].filter(Boolean)) {
  try { mod = require(p); break; } catch { /* try next */ }
}
module.exports = mod;
