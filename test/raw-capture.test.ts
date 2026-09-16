// Hardware I/O Phase A: raw multichannel opt-in must be a provable no-op by
// default (DSP ON — d357516) and only change constraints for opted-in devices.
import { pickBestNativeDevice, rankNativeDevice } from "../src/lib/audio/inputRanking";
import { audioConstraintsFor } from "../src/lib/voice-commands";
import { dspConstraints, isRawCaptureEnabled, setRawCaptureEnabled } from "../src/lib/audio/rawCapture";

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(), key: () => null, length: 0,
} as Storage;
(globalThis as unknown as { window: unknown }).window = { dispatchEvent: () => true, localStorage: globalThis.localStorage };
(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class { constructor(public type: string) {} };


let passed = 0, failed = 0;
const check = (n: string, c: boolean) => { if (c) passed++; else { failed++; console.error("FAIL:", n); } };
const a = (c: MediaStreamConstraints) => c.audio as MediaTrackConstraints;
const pref = { kind: "device" as const, id: "dev-x32", label: "X32 USB" };

// default: identical to pre-change constraints
check("default DSP on", JSON.stringify(dspConstraints(false)) === JSON.stringify({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }));
const mic = a(audioConstraintsFor(pref, "microphone"));
check("mic default unchanged", mic.echoCancellation === true && mic.channelCount === 1 && mic.sampleRate === 16000);
const mix = a(audioConstraintsFor(pref, "mixer"));
check("mixer default unchanged", mix.autoGainControl === true && JSON.stringify(mix.channelCount) === '{"ideal":32}');
check("default not enabled", !isRawCaptureEnabled("dev-x32", "X32 USB"));
check("system default never raw", (setRawCaptureEnabled("default", "Default", true), !isRawCaptureEnabled("default")));

setRawCaptureEnabled("dev-x32", "X32 USB", true);
const raw = a(audioConstraintsFor(pref, "microphone"));
check("raw: DSP off", raw.echoCancellation === false && raw.noiseSuppression === false && raw.autoGainControl === false);
check("raw: all channels even in mic mode", JSON.stringify(raw.channelCount) === '{"ideal":32}');
check("raw: other device untouched", a(audioConstraintsFor({ kind: "device", id: "laptop", label: "MacBook Mic" }, "microphone")).echoCancellation === true);
check("replug: label fallback", isRawCaptureEnabled("new-id-after-replug", "X32 USB"));
setRawCaptureEnabled("new-id-after-replug", "X32 USB", false);
check("disable clears id+label", !isRawCaptureEnabled("dev-x32", "X32 USB"));
store.set("presentflow.audio.rawCapture.v1", "{corrupt");
check("corrupt storage → off", !isRawCaptureEnabled("dev-x32", "X32 USB"));

// Phase C: Blackmagic embedded audio must never be auto-picked over a real mic
check("blackmagic ranks after built-in mic", rankNativeDevice("UltraStudio Recorder 3G (Blackmagic SDI/HDMI audio)") > rankNativeDevice("MacBook Pro Microphone"));
check("mixer still wins", pickBestNativeDevice([
  { index: 5000000, name: "DeckLink Duo (1) (Blackmagic SDI/HDMI audio)", channelCount: 16 },
  { index: 0, name: "MacBook Pro Microphone", channelCount: 1 },
  { index: 1, name: "X32", channelCount: 32 },
])?.name === "X32");
check("mic beats blackmagic", pickBestNativeDevice([
  { index: 5000000, name: "DeckLink Duo (1) (Blackmagic SDI/HDMI audio)", channelCount: 16 },
  { index: 0, name: "MacBook Pro Microphone", channelCount: 1 },
])?.name === "MacBook Pro Microphone");

console.log(`raw-capture: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
