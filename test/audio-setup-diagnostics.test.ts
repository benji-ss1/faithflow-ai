// Sarah audio setup: deterministic diagnostics + connection ranking.
import { checkNoiseFloor, checkSpeech, detectActiveChannels, overallStatus } from "../src/lib/audio/audioDiagnostics";
import { rankConnections, deskFamilyOf } from "../src/lib/audio/connectionPlans";

let passed = 0; let failed = 0;
function check(name: string, cond: boolean) { if (cond) passed++; else { failed++; console.error(`FAIL: ${name}`); } }
const frames = (n: number, peak: number, db: number) => Array.from({ length: n }, () => ({ peak, db }));
const lin = (db: number) => Math.pow(10, db / 20);

// noise floor
check("clean room pass", checkNoiseFloor(frames(20, lin(-70), -70)).status === "pass");
check("hum warn", checkNoiseFloor(frames(20, lin(-45), -45)).status === "warn");
check("loud room fail", checkNoiseFloor(frames(20, lin(-30), -30)).status === "fail");
check("too few frames warn", checkNoiseFloor(frames(2, 0, -70)).status === "warn");

// speech
const byId = (cs: ReturnType<typeof checkSpeech>, id: string) => cs.find((c) => c.id === id);
check("silence fail", byId(checkSpeech(frames(20, 0, -120)), "signal")?.status === "fail");
check("no frames fail", byId(checkSpeech([]), "signal")?.status === "fail");
const healthy = checkSpeech(frames(20, lin(-14), -24));
check("healthy speech pass", overallStatus(healthy) === "pass");
check("quiet speech fail", byId(checkSpeech(frames(20, lin(-36), -45)), "speech-level")?.status === "fail");
check("a bit quiet warn", byId(checkSpeech(frames(20, lin(-27), -35)), "speech-level")?.status === "warn");
check("clipping fail", byId(checkSpeech(frames(20, 0.99, -3)), "clipping")?.status === "fail");
check("NaN frames ignored", byId(checkSpeech(frames(20, NaN, NaN)), "signal")?.status === "fail");

// channel spotting
const hist = new Map<number, number[]>([[0, [lin(-80), lin(-78)]], [14, [lin(-14), lin(-12)]], [15, [lin(-15), lin(-13)]], [3, [lin(-35), lin(-34)]]]);
check("spots stereo pair 14/15", detectActiveChannels(hist).join() === "14,15");
check("nothing moving → []", detectActiveChannels(new Map([[0, [lin(-80)]]])).length === 0);

// desk families
check("X32 behringer", deskFamilyOf("Behringer X32") === "behringer");
check("SQ-5 allen-heath", deskFamilyOf("Allen & Heath SQ-5") === "allen-heath");
check("Yamaha MG analog", deskFamilyOf("Yamaha MG16XU") === "analog");
check("TF yamaha", deskFamilyOf("Yamaha TF5") === "yamaha");
check("empty none", deskFamilyOf("") === "none");

// ranking
const x32 = rankConnections({ desk: "Behringer X32", os: "mac" });
check("X32 → USB first", x32[0].connection === "usb-desk" && x32[0].verified);
check("max 3 main + builtin last", x32.filter((o) => o.connection !== "builtin").length <= 3 && x32[x32.length - 1].connection === "builtin");
check("X32 steps mention Card Out", x32[0].steps.some((s) => /Card Out/.test(s)));
check("full-mix warning present", x32[0].steps.some((s) => /FULL mix/.test(s)));
const analog = rankConnections({ desk: "Behringer Xenyx 1202" });
check("analog → interface first", analog[0].connection === "interface");
const failedUsb = rankConnections({ desk: "Behringer X32", failedRoutes: [{ connection: "usb-desk", reason: "no signal" }] });
check("failed route demoted + flagged", failedUsb[0].connection !== "usb-desk" && failedUsb.some((o) => o.connection === "usb-desk" && o.previouslyFailed === "no signal"));
check("dante church → dante first", rankConnections({ desk: "Yamaha QL5", hasDante: true })[0].connection === "dante");
check("unknown desk steps say check manual", !rankConnections({ desk: "Roland M-200i" })[0].verified);

console.log(`audio-setup-diagnostics: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
