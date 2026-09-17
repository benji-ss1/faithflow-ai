// CI check for the pro audio driver (audify / RtAudio). Mirrors the app
// (electron/audio/rtaudioCapture.ts): load in a CHILD process so native crashes
// are detected, never fatal. For each host API it checks:
//   ENUM_OK  — a long-lived instance enumerates 20× (the app's pooled pattern)
//   AFTER_GC — a DISCARDED instance survives garbage collection (runtime-safety
//              evidence; the app never discards instances, so this is diagnostic)
// A crash AFTER the markers (at process exit) is reported but not a failure.
// Exit 0 = primary API enumerates.
"use strict";
const { spawnSync } = require("node:child_process");
const modPath = require.resolve("audify");
const apis = process.platform === "win32" ? [7, 6] : process.platform === "darwin" ? [1] : [];
let primaryOk = false;
for (const api of apis) {
  const code = `
    const { RtAudio } = require(${JSON.stringify(modPath)});
    const keep = new RtAudio(${api});
    let n = -1;
    for (let i = 0; i < 20; i++) n = keep.getDevices().length;
    console.log("ENUM_OK devices=" + n);
    (function () { const tmp = new RtAudio(${api}); tmp.getDevices(); })();
    global.gc(); global.gc();
    setTimeout(() => { global.gc(); console.log("AFTER_GC"); }, 200);
  `;
  const r = spawnSync(process.execPath, ["--expose-gc", "-e", code], { encoding: "utf8", timeout: 30000 });
  const out = r.stdout || "";
  const enumOk = out.includes("ENUM_OK");
  console.log(`api ${api}: enumerate=${enumOk ? "ok" : "FAILED"} discarded-instance-gc=${out.includes("AFTER_GC") ? "ok" : "CRASHED"} exit=${r.status} ${out.trim().replace(/\s+/g, " ")}`);
  if (api === apis[0] && enumOk) primaryOk = true;
}
console.log(primaryOk ? "audify OK" : "audify FAILED");
process.exit(primaryOk ? 0 : 1);
