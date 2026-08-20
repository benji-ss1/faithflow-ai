// Mic-board persistence: the extended DeviceChannelPref must round-trip the
// per-channel labels / mute / duck / gain and the AI-listen channel through
// localStorage — the old sanitizer silently dropped channelLabels/autoFollow.
import {
  writeDeviceChannelPref,
  readDeviceChannelPref,
  clearDeviceChannelPref,
  type DeviceChannelPref,
} from "../src/lib/audio/deviceChannelPrefs";

// Minimal localStorage + window shim for the Node test environment.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;
(globalThis as unknown as { window: unknown }).window = {
  dispatchEvent: () => true,
};
class FakeCustomEvent { constructor(public type: string, public init?: unknown) {} }
(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = FakeCustomEvent;

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}

const pref: DeviceChannelPref = {
  deviceId: "dev-1",
  deviceLabel: "Behringer X32",
  mode: "mono",
  selectedChannels: [6],
  gainDb: 3,
  autoDetected: false,
  updatedAt: 1,
  channelLabels: { 0: "Lead", 1: "BG singer 1", 6: "Pastor" },
  autoFollow: true,
  mutedChannels: [2, 3, 3], // dupe should collapse
  duckedChannels: [1],
  channelGainDb: { 0: 6, 1: -6, 99: 50 }, // 99 out of range dropped by nothing (valid idx); 50 clamped to 24
  aiListenChannel: 6,
};

writeDeviceChannelPref(pref);
const back = readDeviceChannelPref("dev-1");

check("pref reads back", !!back);
check("labels survive", JSON.stringify(back?.channelLabels) === JSON.stringify({ 0: "Lead", 1: "BG singer 1", 6: "Pastor" }));
check("autoFollow survives", back?.autoFollow === true);
check("mutedChannels de-duped", JSON.stringify(back?.mutedChannels) === JSON.stringify([2, 3]));
check("duckedChannels survive", JSON.stringify(back?.duckedChannels) === JSON.stringify([1]));
check("per-channel gain clamped", back?.channelGainDb?.[99] === 24 && back?.channelGainDb?.[0] === 6 && back?.channelGainDb?.[1] === -6);
check("aiListenChannel survives", back?.aiListenChannel === 6);

// Empty/absent board fields must not appear (prefs stay compact).
writeDeviceChannelPref({ ...pref, deviceId: "dev-2", channelLabels: {}, mutedChannels: [], autoFollow: false, aiListenChannel: null });
const bare = readDeviceChannelPref("dev-2");
check("empty labels omitted", bare?.channelLabels === undefined);
check("empty muted omitted", bare?.mutedChannels === undefined);
check("false autoFollow omitted", bare?.autoFollow === undefined);
check("null aiListenChannel omitted", bare?.aiListenChannel === undefined);

clearDeviceChannelPref("dev-1");
clearDeviceChannelPref("dev-2");
check("cleared", readDeviceChannelPref("dev-1") === null);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
