// Loader for the compiled native NDI sender addon.
// UNVERIFIED — the .node is produced by `electron-rebuild` (see package.json).
// Loads from the standard node-gyp output; the Electron packager copies the
// built .node into the app bundle (see electron/ndi/NDIService.ts for the
// resolve strategy in production).
"use strict";
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
