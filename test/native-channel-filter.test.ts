// Native ffmpeg channel-filter builder — verifies lead-channel gain (2d) is
// applied to the pan coefficients, and the no-gain / edge cases are unchanged.
import { buildChannelFilter } from "../src/lib/audio/nativeDeviceStore";

let passed = 0, failed = 0;
function eq(name: string, got: string | undefined, want: string | undefined) {
  if (got === want) passed++;
  else { failed++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}

// Unchanged behaviour (no gain / gain 0 = unity)
eq("mono no gain", buildChannelFilter({ index: 0, name: "x", mode: "mono", selectedChannels: [6] }), "pan=mono|c0=c6");
eq("mono gain 0", buildChannelFilter({ index: 0, name: "x", mode: "mono", selectedChannels: [6], gainDb: 0 }), "pan=mono|c0=c6");
eq("stereo no gain", buildChannelFilter({ index: 0, name: "x", mode: "stereo", selectedChannels: [0, 1] }), "pan=mono|c0=0.5*c0+0.5*c1");
eq("sum-all", buildChannelFilter({ index: 0, name: "x", mode: "sum-all" }), undefined);
eq("mono empty channels", buildChannelFilter({ index: 0, name: "x", mode: "mono", selectedChannels: [] }), undefined);

// Gain applied (linear = 10^(dB/20), rounded to 3dp)
eq("mono +6dB", buildChannelFilter({ index: 0, name: "x", mode: "mono", selectedChannels: [6], gainDb: 6 }), "pan=mono|c0=1.995*c6");
eq("mono -6dB", buildChannelFilter({ index: 0, name: "x", mode: "mono", selectedChannels: [2], gainDb: -6 }), "pan=mono|c0=0.501*c2");
eq("stereo +6dB", buildChannelFilter({ index: 0, name: "x", mode: "stereo", selectedChannels: [0, 1], gainDb: 6 }), "pan=mono|c0=0.998*c0+0.998*c1");

// Clamping / invalid gain
eq("gain over max clamps to +24", buildChannelFilter({ index: 0, name: "x", mode: "mono", selectedChannels: [1], gainDb: 999 }), "pan=mono|c0=15.849*c1");
eq("NaN gain = unity", buildChannelFilter({ index: 0, name: "x", mode: "mono", selectedChannels: [1], gainDb: NaN as unknown as number }), "pan=mono|c0=c1");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
