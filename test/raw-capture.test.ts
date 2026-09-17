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
const mic = { kind: "device" as const, id: "laptop", label: "MacBook Pro Microphone" };

// microphones: default unchanged (DSP ON — d357516)
check("default DSP on shape", JSON.stringify(dspConstraints(false)) === JSON.stringify({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }));
const m = a(audioConstraintsFor(mic, "microphone"));
check("laptop mic unchanged", m.echoCancellation === true && m.channelCount === 1 && m.sampleRate === 16000);
check("generic USB dongle stays DSP on", !isRawCaptureEnabled("d1", "USB Audio Device"));
check("system default never raw", (setRawCaptureEnabled("default", "Default", true), !isRawCaptureEnabled("default")));

// mixers/interfaces: ON by default (2026-09-17 directive)
check("X32 raw by default", isRawCaptureEnabled("dev-x32", "X32 USB"));
check("Focusrite raw by default", isRawCaptureEnabled("f1", "Focusrite USB Audio"));
check("Windows-style interface name raw", isRawCaptureEnabled("w1", "Microphone (Focusrite USB Audio)"));
check("ATEM raw by default", isRawCaptureEnabled("atem", "Blackmagic Design"));
const raw = a(audioConstraintsFor(pref, "microphone"));
check("mixer: DSP off + all channels", raw.echoCancellation === false && raw.autoGainControl === false && JSON.stringify(raw.channelCount) === '{"ideal":32}');

// operator override persists both ways, survives replug via label
setRawCaptureEnabled("dev-x32", "X32 USB", false);
check("operator can turn off", !isRawCaptureEnabled("dev-x32", "X32 USB"));
check("off survives replug (label)", !isRawCaptureEnabled("new-id", "X32 USB"));
check("mixer off → DSP back on", a(audioConstraintsFor(pref, "mixer")).autoGainControl === true);
setRawCaptureEnabled("laptop", "MacBook Pro Microphone", true);
check("operator can opt a mic in", isRawCaptureEnabled("laptop", "MacBook Pro Microphone"));
store.set("presentflow.audio.rawCapture.v1", JSON.stringify([{ deviceId: "old", label: "Old" }]));
check("legacy entry (no enabled) = on", isRawCaptureEnabled("old", "Old"));
store.set("presentflow.audio.rawCapture.v1", "{corrupt");
check("corrupt storage → default", isRawCaptureEnabled("dev-x32", "X32 USB") && !isRawCaptureEnabled("laptop", "MacBook Pro Microphone"));

// Phase C: Blackmagic embedded audio must never be auto-picked over a real mic
check("blackmagic ranks after built-in mic", rankNativeDevice("UltraStudio Recorder 3G (Blackmagic SDI/HDMI audio)") > rankNativeDevice("MacBook Pro Microphone"));
check("mixer still wins", pickBestNativeDevice([
  { index: 5000000, name: "DeckLink Duo (1) (Blackmagic SDI/HDMI audio)", channelCount: 16 },
  { index: 0, name: "MacBook Pro Microphone", channelCount: 1 },
  { index: 1, name: "X32", channelCount: 32 },
])?.name === "X32");

console.log(`raw-capture: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
