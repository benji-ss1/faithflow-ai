// Audio Lock-In increment 1: device classifier + saved-device matching.
import { classifyInput } from "../src/lib/audio/deviceClassifier";
import { categorizeDevice } from "../src/lib/audio/deviceCategorization";
import {
  saveWorkingDevice, listSavedDevices, matchSavedDevice, savedToNativePref,
  normalizeDeviceName, getBackupDevice, forgetSavedDevice, SAVED_AUDIO_DEVICES_KEY,
} from "../src/lib/audio/savedAudioDevices";

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}

// ── classifier ──
const k = (name: string, extra: Partial<{ manufacturer: string; transport: string }> = {}) => classifyInput({ name, ...extra }).kind;
check("DeckLink → sdi-capture", k("DeckLink Mini Recorder 4K", { manufacturer: "Blackmagic Design", transport: "pci" }) === "sdi-capture");
check("UltraStudio → sdi-capture", k("UltraStudio Recorder 3G") === "sdi-capture");
check("Blackmagic thunderbolt w/o model name → sdi-capture", k("Blackmagic Audio", { manufacturer: "Blackmagic Design", transport: "thunderbolt" }) === "sdi-capture");
check("ATEM Mini → usb-switcher", k("Blackmagic Design ATEM Mini Pro", { manufacturer: "Blackmagic Design", transport: "usb" }) === "usb-switcher");
check("Dante VSC → dante", k("Dante Virtual Soundcard", { transport: "virtual" }) === "dante");
check("X32 X-USB → desk", k("X-USB", { transport: "usb" }) === "desk");
check("SQ VID label → desk", k("SQ - Audio (22f0:0019)") === "desk");
check("Yamaha TF → desk", k("Yamaha TF", { manufacturer: "Yamaha" }) === "desk");
check("Scarlett → interface", k("Scarlett 2i2 USB", { transport: "usb" }) === "interface");
check("Cam Link → hdmi-capture", k("Cam Link 4K") === "hdmi-capture");
check("hdmi transport → hdmi-capture", k("Generic", { transport: "hdmi" }) === "hdmi-capture");
check("aggregate → aggregate", k("Aggregate Device", { transport: "aggregate" }) === "aggregate");
check("MacBook mic → builtin, not recommended", k("MacBook Pro Microphone", { transport: "builtin" }) === "builtin" && !classifyInput({ name: "MacBook Pro Microphone", transport: "builtin" }).recommended);
check("NDI → ndi", k("NDI: CAM1", { transport: "ndi" }) === "ndi");
check("AirPods → bluetooth", k("AirPods Pro") === "bluetooth");
check("unknown → other", k("Mystery Box") === "other");
check("every classification has a hint", ["DeckLink", "X-USB", "Dante Virtual Soundcard", "Mystery"].every((n) => classifyInput({ name: n }).hint.length > 10));
// no regression: legacy categorizer unchanged
check("legacy categorizeDevice SQ still mixer", categorizeDevice("SQ - Audio (22f0:0019)") === "mixer");
check("legacy categorizeDevice NDI still ndi", categorizeDevice("NDI Audio") === "ndi");

// ── saved devices ──
store.clear();
check("normalize strips VID:PID", normalizeDeviceName("SQ - Audio (22f0:0019)") === "sq - audio");
check("empty list", listSavedDevices().length === 0);
saveWorkingDevice({ uid: "uid-sq", name: "SQ - Audio (22f0:0019)", transport: "usb", channelCount: 32, mode: "mono", selectedChannels: [16], gainDb: 3, role: "primary", savedAt: 100 });
saveWorkingDevice({ name: "MacBook Pro Microphone", transport: "builtin", channelCount: 1, mode: "sum-all", selectedChannels: [], gainDb: 0, role: "backup", savedAt: 200 });
check("two saved", listSavedDevices().length === 2);
check("backup lookup", getBackupDevice()?.name === "MacBook Pro Microphone");

const avail = [
  { index: 0, name: "MacBook Pro Microphone", uid: "builtin", channelCount: 1 },
  { index: 3, name: "SQ - Audio", uid: "uid-sq", channelCount: 32 },
];
const m = matchSavedDevice(avail);
check("uid match despite name/index change", m?.device.index === 3 && m.saved.uid === "uid-sq");
const pref = m ? savedToNativePref(m) : null;
check("restores channel 16 mono + gain", pref?.mode === "mono" && pref.selectedChannels?.[0] === 16 && pref.gainDb === 3 && pref.index === 3);

check("normalized-name match without uid", matchSavedDevice([{ index: 5, name: "SQ - Audio", channelCount: 32 }])?.device.index === 5);
check("normalized-name rejects channel-count mismatch", matchSavedDevice([{ index: 5, name: "SQ - Audio", channelCount: 2 }]) === null);
check("absent device → null", matchSavedDevice([{ index: 1, name: "Other" }]) === null);

// channel out of range on a smaller device → sum-all fallback
const small = savedToNativePref({ saved: { ...listSavedDevices()[1], mode: "mono", selectedChannels: [16] }, device: { index: 9, name: "SQ - Audio", channelCount: 8 } });
check("out-of-range channel → sum-all", small.mode === "sum-all" && small.selectedChannels?.length === 0);

// only one backup
saveWorkingDevice({ name: "Scarlett 2i2", mode: "mono", selectedChannels: [0], gainDb: 0, role: "backup" });
check("single backup role", listSavedDevices().filter((d) => d.role === "backup").length === 1 && getBackupDevice()?.name === "Scarlett 2i2");

// re-save same device replaces, not duplicates
saveWorkingDevice({ uid: "uid-sq", name: "SQ - Audio", mode: "stereo", selectedChannels: [0, 1], gainDb: 0, role: "primary" });
check("re-save replaces", listSavedDevices().filter((d) => d.uid === "uid-sq").length === 1);

forgetSavedDevice({ uid: "uid-sq", name: "x" });
check("forget", !listSavedDevices().some((d) => d.uid === "uid-sq"));

// hostile storage
store.set(SAVED_AUDIO_DEVICES_KEY, JSON.stringify([{ name: 5 }, { name: "Ok", selectedChannels: [-1, 2, "x", 999], gainDb: 900, mode: "evil" }]));
const hostile = listSavedDevices();
check("hostile entries sanitized", hostile.length === 1 && hostile[0].mode === "sum-all" && hostile[0].gainDb === 24 && hostile[0].selectedChannels.join() === "2");
store.set(SAVED_AUDIO_DEVICES_KEY, "{not json");
check("corrupt json → empty", listSavedDevices().length === 0);

console.log(`audio-lockin-devices: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
