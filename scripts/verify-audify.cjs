// CI check for the pro audio driver (audify / RtAudio), mirroring the app's
// crash-safe probe in electron/audio/rtaudioCapture.ts: load it in a CHILD
// process so a native crash is detected, not fatal. Exit 0 = loads + enumerates.
"use strict";
const { spawnSync } = require("node:child_process");
const apis = process.platform === "win32" ? [7, 6] : process.platform === "darwin" ? [1] : [];
const code = `
  const { RtAudio } = require(${JSON.stringify(require.resolve("audify"))});
  for (const api of ${JSON.stringify(apis)}) {
    try {
      const devs = new RtAudio(api).getDevices();
      console.log("api", api, "devices", devs.length, devs.filter(d => d.inputChannels).map(d => d.name + " " + d.inputChannels + "ch").join(", "));
    } catch (e) { console.log("api", api, "unavailable:", e.message); }
  }
  console.log("audify OK", process.platform, process.arch);
`;
const r = spawnSync(process.execPath, ["-e", code], { encoding: "utf8", timeout: 20000 });
process.stdout.write(r.stdout || "");
process.stderr.write(r.stderr || "");
if (r.status !== 0) {
  console.log(`audify child exited with status=${r.status} signal=${r.signal}`);
  process.exit(1);
}
