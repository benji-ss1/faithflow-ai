/**
 * Raw WebSocket test of Deepgram streaming API — no SDK.
 * Sends the test WAV as small chunks over WS and prints every response.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import WebSocket from "ws";

const key = process.env.DEEPGRAM_API_KEY;
if (!key) { console.error("no key"); process.exit(1); }

const params = new URLSearchParams({
  model: "nova-2",
  language: "en-US",
  smart_format: "true",
  interim_results: "true",
  punctuate: "true",
  encoding: "linear16",
  sample_rate: "16000",
  channels: "1",
  endpointing: "400",
});

const url = `wss://api.deepgram.com/v1/listen?${params}`;
console.log("connecting to", url);

const ws = new WebSocket(url, { headers: { Authorization: `Token ${key}` } });
let msgs = 0;

ws.on("open", async () => {
  console.log("OPEN");
  // Read the test WAV and strip the 44-byte header to get raw PCM.
  const wav = readFileSync("/tmp/test-speech.wav");
  const pcm = wav.subarray(44);
  console.log(`sending ${pcm.length} bytes of PCM in 256-byte chunks`);
  // Send in the same tiny chunks the browser worklet uses
  const CHUNK = 256;
  for (let i = 0; i < pcm.length; i += CHUNK) {
    ws.send(pcm.subarray(i, i + CHUNK));
    await new Promise((r) => setTimeout(r, 8));
  }
  // Tell Deepgram we're done
  ws.send(JSON.stringify({ type: "CloseStream" }));
});

ws.on("message", (data) => {
  msgs++;
  console.log(`MSG #${msgs}:`, data.toString().slice(0, 300));
});

ws.on("error", (e) => console.error("ERR", e.message));
ws.on("close", (code, reason) => {
  console.log(`CLOSE code=${code} reason=${reason || "(none)"} total msgs=${msgs}`);
  process.exit(0);
});
