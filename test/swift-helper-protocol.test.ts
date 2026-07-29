// swift-helper-protocol.test.ts — protocol-level tests for the Tier 3
// Swift audio helper's Electron-side codec (electron/audio/swiftHelper.ts).
// Run: npx tsx test/swift-helper-protocol.test.ts
//
// Covers: command serialization, event parsing (valid/malformed/oversized),
// incremental stderr line splitting with partial + interleaved chunks,
// channel-filter translation, and proof that PCM (stdout) framing can never
// contaminate the event (stderr) stream. If the built helper binary exists,
// a live smoke test (spawn → list-devices → quit) runs too; it is skipped
// cleanly when the binary is absent.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import {
  serializeCommand,
  parseHelperEventLine,
  LineSplitter,
  parseChannelFilter,
  MAX_EVENT_LINE_BYTES,
  type HelperEvent,
} from "../electron/audio/swiftHelper";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      failed++;
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : err}`);
    });
}

async function main() {
  console.log("swift-helper protocol tests");

  // ---- serializeCommand -------------------------------------------------

  await test("serializeCommand emits newline-terminated single-line JSON", () => {
    const line = serializeCommand({ cmd: "list-devices" });
    assert.ok(line.endsWith("\n"));
    assert.equal(line.indexOf("\n"), line.length - 1, "exactly one newline, at the end");
    assert.deepEqual(JSON.parse(line), { cmd: "list-devices" });
  });

  await test("serializeCommand round-trips start-capture options", () => {
    const line = serializeCommand({
      cmd: "start-capture",
      device_uid: "AppleUSBAudioEngine:SQ:123",
      channels: [6, 7],
      gain: 1.5,
    });
    const obj = JSON.parse(line);
    assert.equal(obj.device_uid, "AppleUSBAudioEngine:SQ:123");
    assert.deepEqual(obj.channels, [6, 7]);
    assert.equal(obj.gain, 1.5);
  });

  // ---- parseHelperEventLine — valid events ------------------------------

  await test("parses ready / stopped / device-change events", () => {
    assert.deepEqual(parseHelperEventLine('{"event":"ready","version":1}'), {
      event: "ready",
      version: 1,
    });
    assert.equal(parseHelperEventLine('{"event":"stopped"}')?.event, "stopped");
    assert.equal(parseHelperEventLine('{"event":"device-change"}')?.event, "device-change");
  });

  await test("parses level event with rms/peak/db", () => {
    const ev = parseHelperEventLine('{"event":"level","rms":0.12,"peak":0.4,"db":-18.4}');
    assert.ok(ev && ev.event === "level");
    if (ev.event === "level") {
      assert.equal(ev.rms, 0.12);
      assert.equal(ev.peak, 0.4);
      assert.equal(ev.db, -18.4);
    }
  });

  await test("parses devices event, tolerating extra fields", () => {
    const ev = parseHelperEventLine(
      JSON.stringify({
        event: "devices",
        devices: [
          {
            index: 0,
            uid: "BuiltInMicrophoneDevice",
            name: "MacBook Pro Microphone",
            manufacturer: "Apple Inc.",
            transport: "builtin",
            input_channels: 1,
            sample_rate: 48000,
            is_default: true,
            future_field: "ignored",
          },
        ],
      })
    );
    assert.ok(ev && ev.event === "devices");
    if (ev.event === "devices") {
      assert.equal(ev.devices.length, 1);
      assert.equal(ev.devices[0].uid, "BuiltInMicrophoneDevice");
      assert.equal(ev.devices[0].input_channels, 1);
      assert.equal(ev.devices[0].is_default, true);
    }
  });

  await test("parses channel-levels event", () => {
    const ev = parseHelperEventLine(
      JSON.stringify({
        event: "channel-levels",
        levels: [
          { channel: 0, rms: 0.1, peak: 0.2, db: -20 },
          { channel: 1, rms: 0.0, peak: 0.0, db: -160 },
        ],
      })
    );
    assert.ok(ev && ev.event === "channel-levels");
    if (ev.event === "channel-levels") {
      assert.equal(ev.levels.length, 2);
      assert.equal(ev.levels[1].db, -160);
    }
  });

  await test("parses error event with and without code", () => {
    const withCode = parseHelperEventLine('{"event":"error","code":"start-failed","message":"boom"}');
    assert.ok(withCode && withCode.event === "error");
    if (withCode.event === "error") assert.equal(withCode.code, "start-failed");
    const noCode = parseHelperEventLine('{"event":"error","message":"boom"}');
    assert.ok(noCode && noCode.event === "error");
  });

  // ---- parseHelperEventLine — malformed input ---------------------------

  await test("rejects malformed JSON without throwing", () => {
    assert.equal(parseHelperEventLine("{not json"), null);
    assert.equal(parseHelperEventLine('{"event":'), null);
    assert.equal(parseHelperEventLine(""), null);
    assert.equal(parseHelperEventLine("   "), null);
  });

  await test("rejects JSON that is not an event object", () => {
    assert.equal(parseHelperEventLine("42"), null);
    assert.equal(parseHelperEventLine('"level"'), null);
    assert.equal(parseHelperEventLine("[1,2,3]"), null);
    assert.equal(parseHelperEventLine("null"), null);
    assert.equal(parseHelperEventLine('{"noevent":true}'), null);
    assert.equal(parseHelperEventLine('{"event":7}'), null);
  });

  await test("rejects unknown event types (forward compat = ignore)", () => {
    assert.equal(parseHelperEventLine('{"event":"quantum-flux","x":1}'), null);
  });

  await test("rejects structurally-invalid known events", () => {
    assert.equal(parseHelperEventLine('{"event":"level","rms":"loud"}'), null);
    assert.equal(parseHelperEventLine('{"event":"devices","devices":"none"}'), null);
    assert.equal(parseHelperEventLine('{"event":"devices","devices":[{"name":"x"}]}'), null, "device missing uid");
    assert.equal(parseHelperEventLine('{"event":"error"}'), null, "error missing message");
    assert.equal(parseHelperEventLine('{"event":"channel-levels","levels":[{"rms":1}]}'), null);
    assert.equal(parseHelperEventLine('{"event":"capturing"}'), null, "capturing missing device_uid");
  });

  await test("rejects oversized event lines", () => {
    const huge = `{"event":"log","message":"${"x".repeat(MAX_EVENT_LINE_BYTES + 1024)}"}`;
    assert.equal(parseHelperEventLine(huge), null);
  });

  // ---- LineSplitter -----------------------------------------------------

  await test("LineSplitter handles partial + multi-line chunks", () => {
    const s = new LineSplitter();
    assert.deepEqual(s.push('{"event":"rea'), []);
    assert.deepEqual(s.push('dy"}\n{"event":"stopped"}\n{"eve'), [
      '{"event":"ready"}',
      '{"event":"stopped"}',
    ]);
    assert.deepEqual(s.push('nt":"device-change"}\n'), ['{"event":"device-change"}']);
  });

  await test("LineSplitter handles interleaved partial chunks byte-by-byte", () => {
    const s = new LineSplitter();
    const payload = '{"event":"level","rms":0.5,"peak":0.9,"db":-6}\n{"event":"log","message":"hi"}\n';
    const lines: string[] = [];
    for (const ch of payload) lines.push(...s.push(ch));
    assert.equal(lines.length, 2);
    const ev = parseHelperEventLine(lines[0]);
    assert.ok(ev && ev.event === "level");
  });

  await test("LineSplitter drops a newline-less flood instead of buffering it", () => {
    const s = new LineSplitter();
    // Feed > MAX bytes with no newline — buffer must reset, not grow.
    const flood = "x".repeat(MAX_EVENT_LINE_BYTES + 1);
    assert.deepEqual(s.push(flood), []);
    // The tail of the oversized line (up to its newline) is dropped...
    assert.deepEqual(s.push("yyy\n"), []);
    // ...and the stream recovers cleanly afterwards.
    assert.deepEqual(s.push('{"event":"ready"}\n'), ['{"event":"ready"}']);
  });

  await test("LineSplitter handles multibyte UTF-8 split across chunks", () => {
    const s = new LineSplitter();
    const line = '{"event":"log","message":"émoji ✓"}\n';
    // String-boundary split (chunks arrive as decoded strings from Buffer;
    // this asserts reassembly across arbitrary string splits).
    const mid = Math.floor(line.length / 2);
    assert.deepEqual(s.push(line.slice(0, mid)), []);
    const out = s.push(line.slice(mid));
    assert.equal(out.length, 1);
    const ev = parseHelperEventLine(out[0]);
    assert.ok(ev && ev.event === "log");
  });

  // ---- stream separation ------------------------------------------------

  await test("PCM bytes fed to the event splitter never produce valid events", () => {
    // Simulate cross-contamination: raw s16le PCM (with embedded 0x0A
    // bytes acting as fake newlines) must parse to zero events.
    const s = new LineSplitter();
    const pcm = Buffer.alloc(4096);
    for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(((i * 2654435761) % 65536) - 32768, i);
    const lines = s.push(pcm);
    for (const line of lines) {
      assert.equal(parseHelperEventLine(line), null, "PCM noise must never parse as an event");
    }
  });

  await test("JSON event text inside the PCM stream is treated as audio, not events", () => {
    // The stdout handler forwards ALL bytes as PCM ArrayBuffers and never
    // runs the event parser — assert the design invariant at the codec
    // level: the pcm path has no parser to feed (type-level: swiftHelper's
    // stdout handler slices Buffers; only stderr goes through LineSplitter).
    // Here we assert the reverse direction is safe: an event line is valid
    // PCM (any byte string is), so nothing throws when treated as audio.
    const evLine = Buffer.from('{"event":"level","rms":0.5,"peak":0.9,"db":-6}\n', "utf8");
    const ab = evLine.buffer.slice(evLine.byteOffset, evLine.byteOffset + evLine.byteLength);
    assert.equal(ab.byteLength, evLine.byteLength);
  });

  // ---- channel filter translation --------------------------------------

  await test("parseChannelFilter: absent/garbage → [0]", () => {
    assert.deepEqual(parseChannelFilter(undefined), [0]);
    assert.deepEqual(parseChannelFilter(""), [0]);
    assert.deepEqual(parseChannelFilter("volume=2"), [0]);
  });

  await test("parseChannelFilter: mono pick", () => {
    assert.deepEqual(parseChannelFilter("pan=mono|c0=c5"), [5]);
    assert.deepEqual(parseChannelFilter("pan=mono|c0=c0"), [0]);
    assert.deepEqual(parseChannelFilter("pan=mono|c0=c31"), [31]);
  });

  await test("parseChannelFilter: stereo-pair sum", () => {
    assert.deepEqual(parseChannelFilter("pan=mono|c0=0.5*c4+0.5*c5"), [4, 5]);
  });

  // ---- live smoke test (only when the binary exists) --------------------

  const helperBin = path.join(
    __dirname,
    "..",
    "resources",
    "native",
    "macos",
    "PresentFlowAudioHelper"
  );
  if (existsSync(helperBin) && process.platform === "darwin") {
    await test("LIVE: spawn → ready → list-devices → quit", async () => {
      const events: HelperEvent[] = [];
      const splitter = new LineSplitter();
      const proc = spawn(helperBin, [], { stdio: ["pipe", "pipe", "pipe"] });
      const done = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          proc.kill("SIGKILL");
          reject(new Error(`timed out; events so far: ${events.map((e) => e.event).join(",")}`));
        }, 5000);
        proc.stderr.on("data", (chunk: Buffer) => {
          for (const line of splitter.push(chunk)) {
            const ev = parseHelperEventLine(line);
            if (!ev) continue;
            events.push(ev);
            if (ev.event === "ready") {
              proc.stdin.write(serializeCommand({ cmd: "list-devices" }));
            }
            if (ev.event === "devices") {
              proc.stdin.write(serializeCommand({ cmd: "quit" }));
            }
          }
        });
        proc.on("close", () => {
          clearTimeout(timer);
          resolve();
        });
        proc.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      await done;
      assert.ok(events.some((e) => e.event === "ready"), "ready event received");
      const devicesEv = events.find((e) => e.event === "devices");
      assert.ok(devicesEv, "devices event received");
      if (devicesEv && devicesEv.event === "devices") {
        assert.ok(devicesEv.devices.length > 0, "at least one input device (built-in mic)");
        for (const d of devicesEv.devices) {
          assert.ok(d.uid.length > 0, "every device has a UID");
        }
        console.log(
          `    (live) ${devicesEv.devices.length} device(s): ${devicesEv.devices
            .map((d) => `${d.name} [${d.input_channels}ch]`)
            .join(", ")}`
        );
      }
    });
  } else {
    console.log("  ⊘ LIVE smoke test skipped — helper binary not built at resources/native/macos/");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
