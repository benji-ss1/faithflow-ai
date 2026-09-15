// Sarah audio setup: deterministic diagnostics, level bands, connection ranking,
// and the ungrounded-menu-path filter that keeps Sarah honest.
import { checkNoiseFloor, checkSpeech, detectActiveChannels, overallStatus, levelBand } from "../src/lib/audio/audioDiagnostics";
import { rankConnections, deskFamilyOf } from "../src/lib/audio/connectionPlans";
import { stripUngroundedPaths, SARAH_KNOWLEDGE } from "../src/lib/audio/sarahKnowledge";

let passed = 0; let failed = 0;
function check(name: string, cond: boolean) { if (cond) passed++; else { failed++; console.error(`FAIL: ${name}`); } }
const frames = (n: number, peak: number, db: number) => Array.from({ length: n }, () => ({ peak, db }));
const lin = (db: number) => Math.pow(10, db / 20);

// ── noise floor ──
check("clean room pass", checkNoiseFloor(frames(20, lin(-70), -70)).status === "pass");
check("light hum warn", checkNoiseFloor(frames(20, lin(-42), -42)).status === "warn");
check("loud room fail", checkNoiseFloor(frames(20, lin(-30), -30)).status === "fail");
check("-46 still passes (real desks idle here)", checkNoiseFloor(frames(20, lin(-46), -46)).status === "pass");
check("too few frames warn", checkNoiseFloor(frames(2, 0, -70)).status === "warn");
check("digital-silence input warns, not passes", checkNoiseFloor(frames(20, 0, -Infinity)).status === "warn");

// ── speech ──
const byId = (cs: ReturnType<typeof checkSpeech>, id: string) => cs.find((c) => c.id === id);
check("silence fail", byId(checkSpeech(frames(20, 0, -120)), "signal")?.status === "fail");
check("no frames fail", byId(checkSpeech([]), "signal")?.status === "fail");
check("healthy speech pass", overallStatus(checkSpeech(frames(20, lin(-14), -24))) === "pass");
check("quiet speech fail", byId(checkSpeech(frames(20, lin(-36), -45)), "speech-level")?.status === "fail");
check("a bit quiet warn", byId(checkSpeech(frames(20, lin(-27), -35)), "speech-level")?.status === "warn");
check("clipping fail (sustained)", byId(checkSpeech(frames(20, 0.999, -3)), "clipping")?.status === "fail");
check("one isolated overshoot is NOT clipping", byId(checkSpeech([...frames(60, lin(-14), -24), { peak: 0.999, db: -1 }]), "clipping")?.status === "pass");
check("NaN frames ignored", byId(checkSpeech(frames(20, NaN, NaN)), "signal")?.status === "fail");
check("negative (signed) peaks are not silence", byId(checkSpeech(frames(20, -lin(-14), -24)), "signal")?.status === "pass");

// ── level bands (plain language for volunteers) ──
check("band silent", levelBand(-80) === "silent");
check("band quiet", levelBand(-30) === "quiet");
check("band good", levelBand(-14) === "good");
check("band loud", levelBand(-3) === "loud");

// ── channel spotting ──
const hist = new Map<number, number[]>([[0, [lin(-80), lin(-78)]], [14, [lin(-14), lin(-12)]], [15, [lin(-15), lin(-13)]], [3, [lin(-35), lin(-34)]]]);
check("spots stereo pair 14/15", detectActiveChannels(hist).join() === "14,15");
check("nothing moving → []", detectActiveChannels(new Map([[0, [lin(-80)]]])).length === 0);

// ── desk families ──
check("X32 behringer", deskFamilyOf("Behringer X32") === "behringer");
check("Xenyx is analog, not a digital Behringer", deskFamilyOf("Behringer Xenyx 1202") === "analog");
check("SQ-5 allen-heath", deskFamilyOf("Allen & Heath SQ-5") === "allen-heath");
check("Yamaha MG analog", deskFamilyOf("Yamaha MG16XU") === "analog");
check("TF yamaha", deskFamilyOf("Yamaha TF5") === "yamaha");
check("empty none", deskFamilyOf("") === "none");

// ── ranking ──
const x32 = rankConnections({ desk: "Behringer X32", os: "mac" });
check("X32 → USB first (verified steps)", x32[0].connection === "usb-desk" && x32[0].verified);
check("max 3 main + builtin last", x32.filter((o) => o.connection !== "builtin").length <= 3 && x32[x32.length - 1].connection === "builtin");
check("X32 steps mention Card Out", x32[0].steps.some((s) => /Card Out/.test(s)));
check("golden rule = post-fader aux/matrix", x32[0].steps.some((s) => /post-fader aux or matrix/i.test(s)));
check("A&H SQ marked unverified (sources disagree on the default)", rankConnections({ desk: "Allen & Heath SQ-5" })[0].verified === false);
check("PreSonus marked unverified", rankConnections({ desk: "PreSonus StudioLive 32SC" })[0].verified === false);
check("analog → interface first", rankConnections({ desk: "Behringer Xenyx 1202" })[0].connection === "interface");
const failedUsb = rankConnections({ desk: "Behringer X32", failedRoutes: [{ connection: "usb-desk", reason: "no signal" }] });
check("failed route demoted + flagged", failedUsb[0].connection !== "usb-desk" && failedUsb.some((o) => o.connection === "usb-desk" && o.previouslyFailed === "no signal"));
check("all routes failed still returns options", rankConnections({ desk: "Behringer X32", failedRoutes: [{ connection: "usb-desk", reason: "a" }, { connection: "interface", reason: "b" }, { connection: "ndi", reason: "c" }] }).length === 4);
check("dante church → dante first", rankConnections({ desk: "Yamaha QL5", hasDante: true })[0].connection === "dante");
check("unknown desk → check the manual", !rankConnections({ desk: "Roland M-200i" })[0].verified);

// ── grounding filter ──
const kb = SARAH_KNOWLEDGE.connection;
check("known path survives", stripUngroundedPaths("On the desk: Routing → Card Out, choose Out 9-16.", kb).stripped === false);
check("invented path is stripped", stripUngroundedPaths("Open Setup → Magic Audio Wizard and enable it.", kb).stripped === true);
check("stripped reply still helps", /check your desk's manual/i.test(stripUngroundedPaths("Open Setup → Magic Wizard.", kb).text));
check("plain reply untouched", stripUngroundedPaths("Turn the aux send up by about 6 dB.", kb).text === "Turn the aux send up by about 6 dB.");

console.log(`audio-setup-diagnostics: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
