// Loader for the compiled native NDI audio-receiver addon.
// UNVERIFIED — the .node is produced by `electron-rebuild` (see package.json).
// The Electron packager copies the built .node into the app bundle; see
// electron/ndi/NDIReceiveService.ts for the production resolve strategy.
"use strict";
const path = require("path");
// On Windows the addon depends on Processing.NDI.Lib.x64.dll. electron-builder
// bundles that DLL next to the .node (build/Release), but make discovery robust
// by also prepending that dir to PATH before the require, so the OS loader finds
// the runtime regardless of the module load flags.
if (process.platform === "win32") {
  try {
    const relDir = path.join(__dirname, "build", "Release");
    process.env.PATH = relDir + path.delimiter + (process.env.PATH || "");
  } catch { /* ignore */ }
}
let native = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  native = require("./build/Release/ndi_receiver.node");
} catch (e) {
  // Surfaced to NDIReceiveService, which degrades gracefully (never crash the app
  // if NDI is unavailable).
  native = { __loadError: e && e.message ? e.message : String(e) };
}
module.exports = native;
