// Loader for the compiled native NDI sender addon.
// UNVERIFIED — the .node is produced by `electron-rebuild` (see package.json).
// Loads from the standard node-gyp output; the Electron packager copies the
// built .node into the app bundle (see electron/ndi/NDIService.ts for the
// resolve strategy in production).
"use strict";
const path = require("path");
// On Windows the addon depends on Processing.NDI.Lib.x64.dll. electron-builder
// bundles that DLL next to the .node (build/Release); prepend that dir to PATH
// before the require so the OS loader finds it (mirrors ndi-receiver/index.js).
if (process.platform === "win32") {
  try {
    const relDir = path.join(__dirname, "build", "Release");
    process.env.PATH = relDir + path.delimiter + (process.env.PATH || "");
  } catch { /* ignore */ }
}
let native = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  native = require("./build/Release/ndi_sender.node");
} catch (e) {
  // Surfaced to NDIService, which degrades gracefully (spec: never crash the app
  // if NDI is unavailable, §2).
  native = { __loadError: e && e.message ? e.message : String(e) };
}
module.exports = native;
