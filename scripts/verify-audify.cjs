// CI check for the pro audio driver (audify / RtAudio), mirroring the app's
// crash-safe probe in electron/audio/rtaudioCapture.ts: each host API is loaded
// in its OWN child process so a native crash (during use OR at process exit) is
// detected and attributed, never fatal. Exit 0 = the primary API loads+enumerates.
"use strict";
const { spawnSync } = require("node:child_process");
const modPath = require.resolve("audify");
const apis = process.platform === "win32" ? [7, 6] : process.platform === "darwin" ? [1] : [];
let primaryOk = false;
for (const api of apis) {
  const code = `
    const { RtAudio } = require(${JSON.stringify(modPath)});
    let n = -1;
    try { const rt = new RtAudio(${api}); n = rt.getDevices().length; } catch (e) { console.log("threw", e.message); }
    console.log("ENUM_OK devices=" + n);
  `;
  const r = spawnSync(process.execPath, ["-e", code], { encoding: "utf8", timeout: 20000 });
  const enumOk = (r.stdout || "").includes("ENUM_OK");
  console.log(`api ${api}: enumerate=${enumOk ? "ok" : "FAILED"} exit=${r.status} signal=${r.signal} ${(r.stdout || "").trim().replace(/\s+/g, " ")}`);
  if (api === apis[0] && enumOk) primaryOk = true;
}
console.log(primaryOk ? "audify OK" : "audify FAILED");
process.exit(primaryOk ? 0 : 1);
