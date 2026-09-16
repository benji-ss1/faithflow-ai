/**
 * Clear Messages must drop board (extra) messages immediately on every output,
 * not after the 5s stale sweep. The operator's clear post now carries
 * `messages: []`; this locks in that the wire accepts and preserves it.
 *
 * Run: npx tsx test/message-clear-immediate.test.ts
 */
import assert from "node:assert/strict";
import { isValidLiveMessage, coerceLiveMessage } from "../src/lib/broadcast";

const clearMsg = { type: "message", overlay: { clear: true }, messages: [] };
assert.equal(isValidLiveMessage(clearMsg), true, "clear + empty messages[] is valid");
const coerced = coerceLiveMessage(clearMsg) as { messages?: unknown[] } | null;
assert.ok(coerced, "coerce keeps the message");
assert.deepEqual(coerced!.messages, [], "empty messages[] survives coercion so receivers reconcile to none");

// Legacy clear without the array is still valid (older operators).
assert.equal(isValidLiveMessage({ type: "message", overlay: { clear: true } }), true);
console.log("message-clear-immediate: all passed");
