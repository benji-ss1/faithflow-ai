import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidTimersWire, isValidTimerWire } from "@/lib/broadcast";

// 🔴 Sender clock far ahead of receiver clock: rev/anchorMs are seeded from the
// SENDER's Date.now() (ProOperatorShell.tsx timersWireRevRef = Date.now()), but
// isValidTimersWire/isValidTimerWire bound rev/anchorMs against the RECEIVER's
// OWN Date.now() + REV_MAX_SKEW_MS (24h). A sender clock more than 24h ahead of
// the receiver's clock produces a rev/anchorMs that the receiver's validator
// rejects outright -- exactly the clock-skew scenario this whole subsystem
// exists to handle. The frame fails isValidTimersWire entirely, so
// sanitizeOutputState drops timersWire and the timer silently never appears
// on that receiver.
test("FIXED: a sender whose clock is days ahead is ACCEPTED", () => {
  const senderNow = Date.now() + 2 * 24 * 60 * 60 * 1000; // sender clock 2 days fast
  const wire = {
    timers: [{
      id: "default", type: "countdown" as const, running: true,
      anchorMs: senderNow, baseSec: 300, durationSec: 300,
    }],
    senderNowMs: senderNow,
    rev: senderNow, // rev seeded from Date.now() on the sender, per ProOperatorShell.tsx
  };
  const ok = isValidTimersWire(wire);
  assert.equal(ok, true, "a skewed-clock sender must validate — rejecting it defeats clock sync entirely");
});

test("FIXED: isValidTimerWire accepts an anchorMs from a far-ahead sender clock", () => {
  const senderNow = Date.now() + 2 * 24 * 60 * 60 * 1000;
  const t = { id: "default", type: "countdown" as const, running: true, anchorMs: senderNow, baseSec: 300, durationSec: 300 };
  const ok = isValidTimerWire(t);
  assert.equal(ok, true, "anchorMs is a SENDER-clock stamp — it must not be judged against the receiver's clock");
});

// Sanity: a sender clock only slightly ahead (within 24h) still validates.
test("sender clock 1h ahead validates fine (within REV_MAX_SKEW_MS)", () => {
  const senderNow = Date.now() + 60 * 60 * 1000;
  const wire = {
    timers: [{ id: "default", type: "countdown" as const, running: true, anchorMs: senderNow, baseSec: 300, durationSec: 300 }],
    senderNowMs: senderNow,
    rev: senderNow,
  };
  assert.equal(isValidTimersWire(wire), true);
});
