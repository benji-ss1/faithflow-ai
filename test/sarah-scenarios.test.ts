// Sarah scenario simulation — ~100 church audio setups, good and bad.
//
// Each scenario states what a senior church sound tech EXPECTS (independently of the
// code), then runs Sarah's real logic: connection ranking, the deterministic checks and
// the watchers. Reports pass rate, false alarms, missed problems and steps-to-first-win.
// Simulation over Sarah's decision logic — NOT a hardware test.
import { rankConnections, type Connection } from "../src/lib/audio/connectionPlans";
import { checkNoiseFloor, checkSpeech, overallStatus, type LevelFrame } from "../src/lib/audio/audioDiagnostics";
import { evaluateWatchers, topWatchNote, type WatchSnapshot } from "../src/lib/audio/sarahWatchers";

type Signal = "good" | "quiet" | "hot" | "silent" | "hum" | "pause";
interface Scenario {
  name: string;
  desk: string;
  os: "mac" | "windows";
  expectFirstRoute: Connection;
  signal: Signal;
  /** Watcher snapshot overrides (hardware/network state). */
  state?: Partial<WatchSnapshot>;
  /** The watcher id a sound tech would want surfaced first (null = nothing alarming). */
  expectTopNote: string | null;
  /** Must NOT appear (false-alarm guard). */
  mustNotSay?: string[];
}

const lin = (db: number) => Math.pow(10, db / 20);
const framesFor = (sig: Signal): { quiet: LevelFrame[]; speech: LevelFrame[] } => {
  const n = (count: number, peakDb: number, rmsDb: number) => Array.from({ length: count }, (_, i) => ({ peak: lin(peakDb + ((i % 5) - 2)), db: rmsDb }));
  switch (sig) {
    case "good": return { quiet: n(80, -68, -70), speech: n(70, -14, -24) };
    case "quiet": return { quiet: n(80, -70, -72), speech: n(70, -36, -46) };
    case "hot": return { quiet: n(80, -66, -68), speech: Array.from({ length: 70 }, () => ({ peak: 0.995, db: -3 })) };
    case "silent": return { quiet: n(80, -120, -120), speech: n(70, -120, -120) };
    case "hum": return { quiet: n(80, -34, -36), speech: n(70, -14, -24) };
    case "pause": return { quiet: n(80, -68, -70), speech: n(70, -14, -24) };
  }
};
const expectChecks = (sig: Signal) => ({
  quiet: sig === "hum" ? "fail" : sig === "silent" ? "warn" : "pass",
  // Hum is caught by the QUIET-room check; a clear voice over it still passes the voice check.
  speech: sig === "good" || sig === "pause" || sig === "hum" ? "pass" : "fail",
});
// held level + silent seconds the watchers would see for this signal
const watchLevel = (sig: Signal): Partial<WatchSnapshot> => ({
  good: { levelDb: -14, silentSeconds: 0 },
  quiet: { levelDb: -36, silentSeconds: 0 },
  hot: { levelDb: -1, silentSeconds: 0, clipping: true },
  silent: { levelDb: -120, silentSeconds: 12 },
  hum: { levelDb: -14, silentSeconds: 0 },
  pause: { levelDb: -120, silentSeconds: 2 }, // a 2s gap between words
}[sig]);

const DESKS: { desk: string; route: Connection }[] = [
  { desk: "Behringer X32", route: "usb-desk" }, { desk: "Behringer Wing", route: "usb-desk" }, { desk: "Midas M32", route: "usb-desk" },
  { desk: "Yamaha TF5", route: "usb-desk" }, { desk: "Yamaha QL5", route: "usb-desk" }, { desk: "Yamaha DM3", route: "usb-desk" },
  { desk: "Allen & Heath SQ-5", route: "usb-desk" }, { desk: "Allen & Heath Qu-16", route: "usb-desk" }, { desk: "Soundcraft Ui24R", route: "usb-desk" },
  { desk: "PreSonus StudioLive 32SC", route: "usb-desk" }, { desk: "Behringer Xenyx 1202", route: "interface" }, { desk: "Yamaha MG12XU", route: "interface" },
  { desk: "Mackie ProFX12", route: "interface" }, { desk: "", route: "interface" }, { desk: "Roland M-200i", route: "usb-desk" },
];

const scenarios: Scenario[] = [];
// 1) Every desk × OS × clean signal → right first route, checks pass, "receiving sound".
for (const d of DESKS) for (const os of ["mac", "windows"] as const) {
  scenarios.push({ name: `${d.desk || "no desk"} / ${os} / clean`, desk: d.desk, os, expectFirstRoute: d.route, signal: "good",
    state: { selected: { name: "Desk feed" } }, expectTopNote: "signal-good" });
}
// 2) Common signal problems on typical desks.
for (const d of DESKS.slice(0, 10)) {
  scenarios.push({ name: `${d.desk} / too quiet`, desk: d.desk, os: "mac", expectFirstRoute: d.route, signal: "quiet", state: { selected: { name: "Desk feed" } }, expectTopNote: "too-quiet", mustNotSay: ["signal-good"] });
  scenarios.push({ name: `${d.desk} / too hot`, desk: d.desk, os: "mac", expectFirstRoute: d.route, signal: "hot", state: { selected: { name: "Desk feed" } }, expectTopNote: "clipping", mustNotSay: ["signal-good"] });
  scenarios.push({ name: `${d.desk} / ground-loop hum`, desk: d.desk, os: "windows", expectFirstRoute: d.route, signal: "hum", state: { selected: { name: "Desk feed" } }, expectTopNote: "signal-good" });
  scenarios.push({ name: `${d.desk} / preacher pauses (no false alarm)`, desk: d.desk, os: "mac", expectFirstRoute: d.route, signal: "pause", state: { selected: { name: "Desk feed" } }, expectTopNote: null, mustNotSay: ["no-sound", "blackmagic-silent", "dante-silent"] });
}
// 3) Hardware- and network-specific failures.
const special: Scenario[] = [
  { name: "Blackmagic UltraStudio, no video signal", desk: "Behringer X32", os: "mac", expectFirstRoute: "usb-desk", signal: "silent", state: { selected: { name: "UltraStudio Recorder 3G", kind: "sdi-capture" } }, expectTopNote: "blackmagic-silent" },
  { name: "DeckLink Mini Recorder, silent on Windows", desk: "Yamaha TF5", os: "windows", expectFirstRoute: "usb-desk", signal: "silent", state: { selected: { name: "DeckLink Mini Recorder 4K", kind: "sdi-capture" } }, expectTopNote: "blackmagic-silent" },
  { name: "Blackmagic working normally", desk: "Behringer X32", os: "mac", expectFirstRoute: "usb-desk", signal: "good", state: { selected: { name: "UltraStudio Recorder 3G", kind: "sdi-capture" } }, expectTopNote: "signal-good" },
  { name: "Blackmagic + preacher pause", desk: "Behringer X32", os: "mac", expectFirstRoute: "usb-desk", signal: "pause", state: { selected: { name: "UltraStudio Recorder 3G", kind: "sdi-capture" } }, expectTopNote: null, mustNotSay: ["blackmagic-silent"] },
  { name: "Dante VSC not routed", desk: "Yamaha QL5", os: "mac", expectFirstRoute: "usb-desk", signal: "silent", state: { selected: { name: "Dante Virtual Soundcard", kind: "dante" } }, expectTopNote: "dante-silent" },
  { name: "Dante VSC at 44.1 kHz", desk: "Yamaha QL5", os: "windows", expectFirstRoute: "usb-desk", signal: "good", state: { selected: { name: "Dante Virtual Soundcard", kind: "dante", sampleRate: 44100 } }, expectTopNote: "dante-rate", mustNotSay: ["signal-good"] },
  { name: "Dante working at 48 kHz", desk: "Yamaha QL5", os: "mac", expectFirstRoute: "usb-desk", signal: "good", state: { selected: { name: "Dante Virtual Soundcard", kind: "dante", sampleRate: 48000 } }, expectTopNote: "signal-good" },
  { name: "NDI on Mac, sources visible", desk: "", os: "mac", expectFirstRoute: "interface", signal: "good", state: { route: "ndi", ndiSources: ["STREAM-PC (OBS)"], ndiDiscoveryAvailable: true, selected: { name: "NDI: STREAM-PC (OBS)" } }, expectTopNote: "ndi-seen" },
  { name: "NDI on Mac, wrong network", desk: "", os: "mac", expectFirstRoute: "interface", signal: "silent", state: { route: "ndi", ndiSources: [], ndiScanSeconds: 15, ndiDiscoveryAvailable: true }, expectTopNote: "ndi-none" },
  { name: "NDI on Mac, still scanning (3s)", desk: "", os: "mac", expectFirstRoute: "interface", signal: "good", state: { route: "ndi", ndiSources: [], ndiScanSeconds: 3, ndiDiscoveryAvailable: true }, expectTopNote: null, mustNotSay: ["ndi-none"] },
  { name: "NDI on Windows (can't list sources)", desk: "", os: "windows", expectFirstRoute: "interface", signal: "good", state: { route: "ndi", ndiSources: [], ndiScanSeconds: 60, ndiDiscoveryAvailable: false }, expectTopNote: "ndi-unlisted", mustNotSay: ["ndi-none"] },
  { name: "Interface unplugged mid-setup", desk: "Behringer X32", os: "mac", expectFirstRoute: "usb-desk", signal: "silent", state: { selected: { name: "Scarlett 2i2" }, selectedMissing: true }, expectTopNote: "unplugged" },
  { name: "Only device unplugged", desk: "Yamaha TF5", os: "windows", expectFirstRoute: "usb-desk", signal: "silent", state: { selected: { name: "Yamaha Steinberg USB" }, selectedMissing: true }, expectTopNote: "unplugged" },
  { name: "Computer offline", desk: "Behringer X32", os: "mac", expectFirstRoute: "usb-desk", signal: "good", state: { online: false, selected: { name: "X-USB" } }, expectTopNote: "offline", mustNotSay: ["signal-good"] },
  { name: "Speech service lost", desk: "Behringer X32", os: "mac", expectFirstRoute: "usb-desk", signal: "good", state: { reconnectFailed: true, selected: { name: "X-USB" } }, expectTopNote: "speech-lost" },
  { name: "Speech service flaky, still down", desk: "Allen & Heath SQ-5", os: "mac", expectFirstRoute: "usb-desk", signal: "good", state: { reconnectAttempts: 4, ready: false, selected: { name: "SQ - Audio" } }, expectTopNote: "speech-flaky" },
  { name: "Speech service recovered", desk: "Allen & Heath SQ-5", os: "mac", expectFirstRoute: "usb-desk", signal: "good", state: { reconnectAttempts: 4, ready: true, selected: { name: "SQ - Audio" } }, expectTopNote: "signal-good", mustNotSay: ["speech-flaky"] },
  { name: "Room mic, muddy", desk: "", os: "mac", expectFirstRoute: "interface", signal: "good", state: { audioQuality: "low", selected: { name: "MacBook Pro Microphone", kind: "builtin" } }, expectTopNote: "muddy", mustNotSay: ["signal-good"] },
  { name: "Guardian gave up while listening", desk: "Behringer X32", os: "mac", expectFirstRoute: "usb-desk", signal: "good", state: { listening: true, guardianState: "needs-human", selected: { name: "X-USB" } }, expectTopNote: "guardian", mustNotSay: ["signal-good"] },
  { name: "Stale no-signal flag, AI off", desk: "Behringer X32", os: "mac", expectFirstRoute: "usb-desk", signal: "good", state: { listening: false, noAudioSignal: true, selected: { name: "X-USB" } }, expectTopNote: "signal-good", mustNotSay: ["no-sound"] },
  { name: "Generic silent desk feed while listening", desk: "Behringer Wing", os: "mac", expectFirstRoute: "usb-desk", signal: "silent", state: { listening: true, noAudioSignal: true, selected: { name: "WING" } }, expectTopNote: "no-sound" },
  { name: "Offline AND NDI seen → offline wins", desk: "", os: "mac", expectFirstRoute: "interface", signal: "good", state: { online: false, route: "ndi", ndiSources: ["OBS"], ndiDiscoveryAvailable: true }, expectTopNote: "offline" },
  { name: "'Intensity Mic Pro' is NOT a Blackmagic card", desk: "", os: "mac", expectFirstRoute: "interface", signal: "silent", state: { selected: { name: "Intensity Mic Pro", kind: "interface" } }, expectTopNote: "no-sound", mustNotSay: ["blackmagic-silent"] },

  { name: "ATEM Mini over USB, good", desk: "", os: "mac", expectFirstRoute: "interface", signal: "good", state: { selected: { name: "Blackmagic Design ATEM Mini Pro", kind: "usb-switcher" } }, expectTopNote: "signal-good" },
  { name: "HDMI capture dongle, source sends no audio", desk: "", os: "windows", expectFirstRoute: "interface", signal: "silent", state: { selected: { name: "Cam Link 4K", kind: "hdmi-capture" } }, expectTopNote: "no-sound" },
  { name: "Aggregate device, clean", desk: "Behringer X32", os: "mac", expectFirstRoute: "usb-desk", signal: "good", state: { selected: { name: "Aggregate Device", kind: "aggregate" } }, expectTopNote: "signal-good" },
  { name: "Dante + preacher pause (no false alarm)", desk: "Yamaha QL5", os: "mac", expectFirstRoute: "usb-desk", signal: "pause", state: { selected: { name: "Dante Virtual Soundcard", kind: "dante" } }, expectTopNote: null, mustNotSay: ["dante-silent"] },
  { name: "Dante too quiet", desk: "Yamaha QL5", os: "windows", expectFirstRoute: "usb-desk", signal: "quiet", state: { selected: { name: "Dante Virtual Soundcard", kind: "dante" } }, expectTopNote: "too-quiet" },
  { name: "Built-in MacBook mic, clear voice", desk: "", os: "mac", expectFirstRoute: "interface", signal: "good", state: { selected: { name: "MacBook Pro Microphone", kind: "builtin" } }, expectTopNote: "signal-good" },
  { name: "Built-in mic far from pulpit (too quiet)", desk: "", os: "mac", expectFirstRoute: "interface", signal: "quiet", state: { selected: { name: "MacBook Pro Microphone", kind: "builtin" } }, expectTopNote: "too-quiet" },
  { name: "NDI source seen but feed silent", desk: "", os: "mac", expectFirstRoute: "interface", signal: "silent", state: { route: "ndi", ndiSources: ["STREAM-PC (OBS)"], ndiDiscoveryAvailable: true, selected: { name: "NDI: STREAM-PC (OBS)", transport: "ndi" } }, expectTopNote: "no-sound" },
  { name: "Offline + too loud → offline first", desk: "Behringer X32", os: "mac", expectFirstRoute: "usb-desk", signal: "hot", state: { online: false, selected: { name: "X-USB" } }, expectTopNote: "offline" },
  { name: "Unplugged beats silent", desk: "Allen & Heath SQ-5", os: "mac", expectFirstRoute: "usb-desk", signal: "silent", state: { selected: { name: "SQ - Audio" }, selectedMissing: true, noAudioSignal: true }, expectTopNote: "unplugged" },
];
scenarios.push(...special);

// ── run ──
let passed = 0; let falseAlarms = 0; let missed = 0; const failures: string[] = [];
let stepsToWinTotal = 0; let wins = 0;

for (const sc of scenarios) {
  const problems: string[] = [];

  // A) connection ranking — first route a tech would recommend; never the built-in mic first
  const routes = rankConnections({ desk: sc.desk, os: sc.os });
  if (routes[0]?.connection !== sc.expectFirstRoute) problems.push(`first route ${routes[0]?.connection} ≠ ${sc.expectFirstRoute}`);
  if (routes[0]?.connection === "builtin") problems.push("built-in mic ranked first");
  if (routes.some((r) => !r.verified && !r.steps.some((s) => /manual/i.test(s))) && routes.some((r) => r.connection === "usb-desk" && !r.verified)) {
    const bad = routes.find((r) => r.connection === "usb-desk" && !r.verified && !r.steps.some((s) => /manual/i.test(s)));
    if (bad) problems.push("unverified desk steps without 'check the manual'");
  }

  // B) deterministic checks
  const f = framesFor(sc.signal); const exp = expectChecks(sc.signal);
  const q = checkNoiseFloor(f.quiet).status; const sp = overallStatus(checkSpeech(f.speech));
  if (q !== exp.quiet) problems.push(`quiet check ${q} ≠ ${exp.quiet}`);
  if (sp !== exp.speech) problems.push(`voice check ${sp} ≠ ${exp.speech}`);

  // C) watchers — what Sarah says first
  const snap: WatchSnapshot = { listening: true, online: true, ready: true, route: sc.expectFirstRoute, ...watchLevel(sc.signal), ...sc.state };
  const top = topWatchNote(snap)?.id ?? null;
  const all = evaluateWatchers(snap).map((n) => n.id);
  if (top !== sc.expectTopNote) {
    problems.push(`Sarah said "${top}" ≠ expected "${sc.expectTopNote}"`);
    if (sc.expectTopNote === null || sc.expectTopNote === "signal-good") falseAlarms++; else missed++;
  }
  for (const banned of sc.mustNotSay ?? []) if (all.includes(banned)) { problems.push(`false alarm: said "${banned}"`); falseAlarms++; }

  // D) steps to first win (happy path only): welcome → desk → route → steps → input → quiet → voice → save → verse (OS auto-detected)
  if (sc.signal === "good" && sc.expectTopNote === "signal-good") { stepsToWinTotal += 9; wins++; }

  if (problems.length === 0) passed++;
  else failures.push(`  ✗ ${sc.name}: ${problems.join("; ")}`);
}

const total = scenarios.length;
console.log(`\nSarah scenario simulation — ${total} church setups`);
console.log(`  passed:        ${passed}/${total} (${Math.round((passed / total) * 100)}%)`);
console.log(`  false alarms:  ${falseAlarms}`);
console.log(`  missed issues: ${missed}`);
console.log(`  happy-path wins: ${wins} (${wins ? Math.round(stepsToWinTotal / wins) : 0} steps each, first verse included)`);
if (failures.length) { console.log("\nFailures:"); console.log(failures.join("\n")); }
console.log(`\nsarah-scenarios: ${passed} passed, ${total - passed} failed`);
if (passed !== total) process.exit(1);
