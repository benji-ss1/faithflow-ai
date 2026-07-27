import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

let passes = 0;
let failures = 0;
function assert(condition: boolean, label: string) {
  if (condition) {
    passes++;
    console.log(`[PASS] ${label}`);
  } else {
    failures++;
    console.error(`[FAIL] ${label}`);
  }
}

const server = read("scripts/audio-server.ts");
const client = read("src/components/operator/useAudioStream.ts");
const operator = read("src/components/operator/pro/ProOperatorShell.tsx");
const nativeCapture = read("electron/audio/nativeCapture.ts");
const electronMain = read("electron/main.ts");
const outputWindow = read("electron/windows/OutputWindow.ts");
const deploy = read("scripts/deploy.sh");

assert(/endpointing:\s*"100"/.test(server), "field-approved Deepgram endpointing remains 100ms");
assert(server.includes('type: "interim_final_candidate"'), "server predictive interim candidate path remains enabled");
assert(server.includes("}, 4_000);") && server.includes("lastDgSendAt < 3000"), "Deepgram KeepAlive uses the official 3–5s cadence");
assert(server.includes("Deepgram connection timed out") && server.includes("10_000"), "Deepgram setup has a bounded connection timeout");
assert(server.includes('ws.close(1013, "Deepgram temporarily unavailable")'), "upstream setup failures request a client retry");
assert(server.includes("lazyReopenGeneration++") && server.includes("reopenGeneration !== lazyReopenGeneration"), "late Deepgram reopens are cancelled after client teardown");
assert(server.includes('ws.on("message", (raw, isBinary)'), "bridge accepts binary PCM frames");
assert(client.includes("new Int16Array(160)"), "worklet emits fixed 10ms PCM packets");
assert(client.includes("ws.send(bytes)") && !client.includes('JSON.stringify({ type: "audio", b64 })'), "browser audio avoids base64/JSON transport");
assert(client.includes("Math.min(base + Math.floor(Math.random() * 500), 5_000)"), "reconnect backoff caps at five seconds");
const onOpenBlock = client.slice(client.indexOf("ws.onopen ="), client.indexOf("ws.onmessage ="));
assert(
  /if \(msg\.type === "ready"\)[\s\S]{0,600}reconnectAttemptsRef\.current = 0/.test(client)
    && !onOpenBlock.includes("reconnectAttemptsRef.current = 0"),
  "reconnect backoff resets only after Deepgram readiness",
);
assert(client.includes("}, 1_000);"), "AudioContext/socket watchdog runs every second");
assert(operator.includes("preserveConfiguredTransition: true"), "AI auto-fire requests an instant one-shot transition");
assert(nativeCapture.includes('"-fflags", "nobuffer"') && nativeCapture.includes('"-flags", "low_delay"'), "native ffmpeg capture uses low-latency flags");
assert(nativeCapture.includes('"-probesize", "32"') && nativeCapture.includes('"-analyzeduration", "0"'), "native ffmpeg probing and analysis buffering are disabled");
assert(electronMain.includes("backgroundThrottling: false") && outputWindow.includes("backgroundThrottling: false"), "Electron operator and output windows disable background throttling");
assert(deploy.includes('DB="${DATABASE_URL:-}"') && !deploy.includes("postgresql://"), "audio deploy requires an external database secret");

console.log(`\n=== Audio latency integration invariants: ${passes}/${passes + failures} PASS ===`);
if (failures > 0) process.exit(1);
