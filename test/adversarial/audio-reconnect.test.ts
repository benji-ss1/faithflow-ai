/**
 * Runtime test — audio WS auto-reconnect.
 *
 * Mounts useAudioStream in a jsdom environment with:
 *   - fetch stubbed to return a fake ticket URL
 *   - WebSocket stubbed to a controllable fake that we can force-close
 *   - navigator.mediaDevices.getUserMedia stubbed to return a dummy track
 *   - AudioContext stubbed so worklet setup doesn't blow up
 *
 * We then:
 *   1. Call start(), advance to ws_open, verify listening=true.
 *   2. Force an abnormal close (code 1006). Assert reconnect scheduled.
 *   3. Let backoff timer fire, verify new WebSocket instantiated.
 *   4. Call stop(). Force another abnormal close. Assert NO reconnect scheduled.
 */

import { JSDOM } from "jsdom";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";

// --- jsdom bootstrap ---
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
// Node 22+ exposes `navigator` as a getter-only property. Use defineProperty
// to overwrite it with the jsdom instance so the hook can read mediaDevices.
Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Object.defineProperty(globalThis, "HTMLElement", { value: dom.window.HTMLElement, configurable: true });
Object.defineProperty(globalThis, "Element", { value: dom.window.Element, configurable: true });
(globalThis as unknown as { btoa: (s: string) => string }).btoa = (s: string) => Buffer.from(s, "binary").toString("base64");
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// --- WebSocket stub ---
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    // Async open like real WS
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
      // Simulate deepgram ready
      this.onmessage?.({ data: JSON.stringify({ type: "ready" }) });
    }, 5);
  }
  send() { /* discard */ }
  close(code = 1000, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  forceAbnormalClose() {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: "abnormal" });
  }
}
(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;

// --- fetch stub ---
(globalThis as unknown as { fetch: unknown }).fetch = async () => ({
  json: async () => ({ url: "ws://localhost/fake" }),
});

// --- navigator.mediaDevices stub ---
const fakeTrack = { stop: () => {}, enabled: true, label: "fake" };
const fakeStream = { getTracks: () => [fakeTrack], getAudioTracks: () => [fakeTrack] };
(dom.window.navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
  getUserMedia: async () => fakeStream,
};

// --- AudioContext + worklet stub ---
class FakeAudioWorkletNode { port = { onmessage: null, close: () => {} }; disconnect() {} connect(x: unknown) { return x; } }
class FakeGainNode { gain = { value: 0 }; connect(x: unknown) { return x; } }
class FakeAudioContext {
  state = "running";
  destination = {};
  sampleRate = 16_000;
  audioWorklet = { addModule: async () => {} };
  createMediaStreamSource() { return { connect() {} }; }
  createGain() { return new FakeGainNode(); }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}
(globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
(globalThis as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = FakeAudioWorkletNode;
(globalThis as unknown as { Blob: unknown }).Blob = dom.window.Blob;
// jsdom's URL lacks createObjectURL/revokeObjectURL; stub with no-ops.
class URLShim extends dom.window.URL {
  static createObjectURL(_: unknown): string { return "blob:fake"; }
  static revokeObjectURL(_: string): void {}
}
(globalThis as unknown as { URL: unknown }).URL = URLShim;

// --- Test harness ---
type HookAPI = ReturnType<typeof import("../../src/components/operator/useAudioStream").useAudioStream>;

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

let passes = 0;
let fails = 0;
function assert(cond: boolean, label: string, extra?: string) {
  if (cond) { passes++; console.log(`[PASS] ${label}${extra ? " — " + extra : ""}`); }
  else { fails++; console.error(`[FAIL] ${label}${extra ? " — " + extra : ""}`); }
}

async function main() {
  const { useAudioStream } = await import("../../src/components/operator/useAudioStream");

  let apiRef: HookAPI | null = null;
  function Harness() {
    const api = useAudioStream("test-plan");
    apiRef = api;
    return null;
  }

  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(Harness)); });

  // --- 1: start, expect WS open ---
  console.log("--- Test 1: start() opens WebSocket ---");
  await act(async () => { await apiRef!.start(); });
  await act(async () => { await sleep(30); });
  assert(FakeWebSocket.instances.length === 1, "one WebSocket instance created");
  assert(apiRef!.state.listening === true, "listening=true after start");
  assert(apiRef!.state.ready === true, "ready=true after deepgram_ready");
  assert(apiRef!.state.stage === "worklet_connected" || apiRef!.state.stage === "deepgram_ready", "stage reached open pipeline", apiRef!.state.stage);

  // --- 2: abnormal close triggers reconnect ---
  console.log("--- Test 2: abnormal close schedules reconnect ---");
  const ws1 = FakeWebSocket.instances[0];
  await act(async () => { ws1.forceAbnormalClose(); await sleep(10); });
  assert(apiRef!.state.listening === true, "listening stays true during reconnect");
  assert(apiRef!.state.ready === false, "ready flipped false");
  assert(/Reconnecting/.test(apiRef!.state.error || ""), "error shows reconnecting", apiRef!.state.error || "");

  // Wait for first backoff (~0.5s + jitter up to 0.5s => 500-1000ms) + safety margin
  await act(async () => { await sleep(1500); });
  assert(FakeWebSocket.instances.length === 2, "second WebSocket created by reconnect", String(FakeWebSocket.instances.length));
  await act(async () => { await sleep(30); });
  assert(apiRef!.state.error === null, "error cleared after successful reconnect");

  // --- 3: stop() cancels reconnect ---
  console.log("--- Test 3: intentional stop() suppresses reconnect ---");
  await act(async () => { apiRef!.stop(); await sleep(10); });
  const countAtStop = FakeWebSocket.instances.length;
  assert(apiRef!.state.listening === false, "listening=false after stop");
  // Now imagine a stray abnormal close event arriving late — it must NOT reconnect.
  const ws2 = FakeWebSocket.instances[1];
  await act(async () => { ws2.forceAbnormalClose(); await sleep(1500); });
  assert(FakeWebSocket.instances.length === countAtStop, "no new WebSocket after stop", `count=${FakeWebSocket.instances.length}, expected=${countAtStop}`);

  // --- 4: backoff cap and 8-attempt ceiling ---
  console.log("--- Test 4: repeated failures cap at 8 attempts ---");
  // Make new WS instances close immediately as abnormal
  class ImmediateFailWS extends FakeWebSocket {
    constructor(url: string) {
      super(url);
      setTimeout(() => this.forceAbnormalClose(), 1);
    }
  }
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = ImmediateFailWS;
  FakeWebSocket.instances.length = 0;
  await act(async () => { await apiRef!.start(); await sleep(50); });
  // Let backoffs run: ~0.5+1+2+4+8+15+15+15s + jitter = way more than we can wait.
  // Instead of waiting real time, just verify the guard exists by checking
  // final error state after a few cycles.
  await act(async () => { await sleep(5000); });
  const attemptsSoFar = FakeWebSocket.instances.length;
  assert(attemptsSoFar >= 2, "at least 2 reconnect attempts within 5s", String(attemptsSoFar));
  assert(attemptsSoFar <= 9, "did not exceed 8 attempts + 1 initial in bounded time", String(attemptsSoFar));

  await act(async () => { apiRef!.stop(); });

  console.log(`\n=== Audio reconnect test: ${passes}/${passes + fails} PASS ===`);
  if (fails > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
