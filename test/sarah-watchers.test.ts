// Sarah watchers: plain-English observations over live state, plus the spotlight spring.
import { evaluateWatchers, topWatchNote } from "../src/lib/audio/sarahWatchers";
import { stepSpring, settled, type SpringState } from "../src/lib/audio/spring";

let passed = 0; let failed = 0;
function check(name: string, cond: boolean) { if (cond) passed++; else { failed++; console.error(`FAIL: ${name}`); } }
const ids = (s: Parameters<typeof evaluateWatchers>[0]) => evaluateWatchers(s).map((n) => n.id);
const base = { listening: true, online: true };

check("all clear → nothing to say", evaluateWatchers({ ...base }).length === 0);
check("offline is a problem", topWatchNote({ ...base, online: false })?.id === "offline");
check("speech service lost", ids({ ...base, reconnectFailed: true }).includes("speech-lost"));
check("flaky speech is a warning while still not ready", topWatchNote({ ...base, reconnectAttempts: 3, ready: false })?.severity === "warn");
check("recovered connection doesn't nag forever", !ids({ ...base, reconnectAttempts: 5, ready: true }).includes("speech-flaky"));
check("unplugged device named", topWatchNote({ ...base, selected: { name: "Scarlett 2i2" }, selectedMissing: true })?.message.includes("Scarlett 2i2") === true);

// NDI
check("NDI: no sources before the grace period → quiet", !ids({ ...base, route: "ndi", ndiSources: [], ndiScanSeconds: 4 }).includes("ndi-none"));
check("NDI: no sources after 10s → explains network", (() => { const n = topWatchNote({ ...base, route: "ndi", ndiSources: [], ndiScanSeconds: 12, ndiDiscoveryAvailable: true }); return n?.id === "ndi-none" && /same wired network/.test(n.fix ?? "") && /DistroAV/.test(n.fix ?? ""); })());
// Review gate: on Windows / the ffmpeg tier the list is ALWAYS empty — never claim the network is broken.
check("NDI: can't list sources here → never 'no sources'", !ids({ ...base, route: "ndi", ndiSources: [], ndiScanSeconds: 60, ndiDiscoveryAvailable: false }).includes("ndi-none"));
check("NDI: can't list sources here → honest warning instead", topWatchNote({ ...base, route: "ndi", ndiSources: [], ndiScanSeconds: 60, ndiDiscoveryAvailable: false })?.id === "ndi-unlisted");
check("NDI: sources seen → positive note", topWatchNote({ ...base, route: "ndi", ndiSources: ["STREAM-PC (OBS)"] })?.severity === "good");
check("NDI rule silent when route isn't NDI", !ids({ ...base, route: "usb-desk", ndiSources: [], ndiScanSeconds: 60 }).some((i) => i.startsWith("ndi")));

// Blackmagic / Dante
check("Blackmagic present + SUSTAINED silence → video-signal explanation", (() => { const n = topWatchNote({ ...base, selected: { name: "UltraStudio Recorder 3G", kind: "sdi-capture" }, levelDb: -90, silentSeconds: 8 }); return n?.id === "blackmagic-silent" && /picture|Embedded/.test(n.fix ?? ""); })());
// Review gate: a pause between words (or prayer) must NOT read as broken gear.
check("Blackmagic + a 1-second pause → no false alarm", !ids({ ...base, selected: { name: "UltraStudio Recorder 3G", kind: "sdi-capture" }, levelDb: -90, silentSeconds: 1 }).includes("blackmagic-silent"));
check("Dante present + sustained silence → route in Dante Controller", (() => { const n = topWatchNote({ ...base, selected: { name: "Dante Virtual Soundcard", kind: "dante" }, levelDb: -95, silentSeconds: 7 }); return n?.id === "dante-silent" && /licensed|wired/.test(n.fix ?? ""); })());
check("Dante + short pause → no false alarm", !ids({ ...base, selected: { name: "Dante Virtual Soundcard", kind: "dante" }, levelDb: -95, silentSeconds: 2 }).includes("dante-silent"));
check("Dante wrong sample rate → warning", ids({ ...base, selected: { name: "Dante Virtual Soundcard", kind: "dante", sampleRate: 44100 }, levelDb: -20 }).includes("dante-rate"));
check("generic silent device", topWatchNote({ ...base, selected: { name: "X-USB" }, noAudioSignal: true })?.id === "no-sound");

// level + quality
check("clipping warns", ids({ ...base, selected: { name: "X-USB" }, levelDb: -2, clipping: true }).includes("clipping"));
check("clipping suppresses 'signal good'", !ids({ ...base, selected: { name: "X-USB" }, levelDb: -2, clipping: true }).includes("signal-good"));
check("good level → I'm receiving sound", topWatchNote({ ...base, selected: { name: "X-USB" }, levelDb: -18 })?.id === "signal-good");
check("muddy audio warns only when there IS sound", ids({ ...base, selected: { name: "X-USB" }, levelDb: -18, audioQuality: "low" }).includes("muddy") && !ids({ ...base, selected: { name: "X-USB" }, noAudioSignal: true, audioQuality: "low" }).includes("muddy"));
check("problems outrank good news", topWatchNote({ ...base, online: false, selected: { name: "X-USB" }, levelDb: -18 })?.severity === "problem");
check("no plain-language jargon like dBFS", evaluateWatchers({ ...base, selected: { name: "Dante Virtual Soundcard", kind: "dante", sampleRate: 44100 }, levelDb: -95, clipping: true }).every((n) => !/dBFS/.test(n.message + (n.fix ?? ""))));

// spring
let st: SpringState = { pos: { x: 0, y: 0, w: 100, h: 50 }, vel: { x: 0, y: 0, w: 0, h: 0 } };
const target = { x: 400, y: 200, w: 360, h: 600 };
let frames = 0;
while (!settled(st, target) && frames < 600) { st = stepSpring(st, target, 1 / 60); frames++; }
check("spring settles on the target", settled(st, target));
check("spring settles in under ~1.5s at 60fps", frames < 90);
check("spring never wildly overshoots (critically damped)", (() => { let s2: SpringState = { pos: { x: 0, y: 0, w: 0, h: 0 }, vel: { x: 0, y: 0, w: 0, h: 0 } }; let max = 0; for (let i = 0; i < 200; i++) { s2 = stepSpring(s2, { x: 100, y: 0, w: 0, h: 0 }, 1 / 60); max = Math.max(max, s2.pos.x); } return max < 105; })());
check("huge dt (tab switch) is clamped, no explosion", Number.isFinite(stepSpring(st, target, 10).pos.x) && Math.abs(stepSpring({ pos: { x: 0, y: 0, w: 0, h: 0 }, vel: { x: 0, y: 0, w: 0, h: 0 } }, target, 10).pos.x) < 1000);


// ── review-gate additions ──
check("noAudioSignal ignored when AI listening is off (stale flag)", !ids({ listening: false, online: true, selected: { name: "X-USB" }, noAudioSignal: true }).includes("no-sound"));
check("hum (-55) is NOT 'receiving sound'", !ids({ ...base, selected: { name: "X-USB" }, levelDb: -55 }).includes("signal-good"));
check("real voice (-20) IS 'receiving sound'", topWatchNote({ ...base, selected: { name: "X-USB" }, levelDb: -20 })?.id === "signal-good");
check("no 'receiving sound' alongside a warning", !ids({ ...base, selected: { name: "X-USB" }, levelDb: -20, audioQuality: "low" }).includes("signal-good"));
check("guardian gave up → problem, not good news", (() => { const n = ids({ ...base, selected: { name: "X-USB" }, levelDb: -20, guardianState: "needs-human" }); return n.includes("guardian") && !n.includes("signal-good"); })());
check("Dante rate 0 / NaN never prints nonsense", !ids({ ...base, selected: { name: "Dante Virtual Soundcard", kind: "dante", sampleRate: 0 }, levelDb: -20 }).includes("dante-rate") && !ids({ ...base, selected: { name: "Dante Virtual Soundcard", kind: "dante", sampleRate: NaN }, levelDb: -20 }).includes("dante-rate"));
check("'Intensity Mic' is not mistaken for Blackmagic", !ids({ ...base, selected: { name: "Intensity Mic Pro" , kind: "interface" }, levelDb: -90, silentSeconds: 9 }).includes("blackmagic-silent"));
check("long / emoji NDI names are truncated safely", (() => { const n = topWatchNote({ ...base, route: "ndi", ndiSources: ["🎛️".repeat(60), "x".repeat(200)] }); return !!n && n.message.length < 200 && !n.message.includes("\uFFFD"); })());
check("spring ignores a NaN target (no poisoned state)", (() => { const s0: SpringState = { pos: { x: 1, y: 2, w: 3, h: 4 }, vel: { x: 0, y: 0, w: 0, h: 0 } }; const r = stepSpring(s0, { x: NaN, y: 0, w: 0, h: 0 }, 1 / 60); return r.pos.x === 1; })());
check("spring ignores a NaN dt", Number.isFinite(stepSpring({ pos: { x: 0, y: 0, w: 0, h: 0 }, vel: { x: 0, y: 0, w: 0, h: 0 } }, { x: 10, y: 0, w: 0, h: 0 }, NaN).pos.x));

console.log(`sarah-watchers: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
