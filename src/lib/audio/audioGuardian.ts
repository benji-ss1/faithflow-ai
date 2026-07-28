/**
 * Audio Guardian — self-healing watchdog for the NATIVE ffmpeg capture path.
 *
 * Field requirement (JPD, 2026-07-27): live-service audio must "not die and
 * be working and always be picked up". This module is a plain (no-React)
 * state machine fed by useAudioStream's native branch. When the input goes
 * silent (rms < SILENCE_RMS for SILENCE_HOLD_MS continuous) or the capture
 * errors, it walks an escalation ladder:
 *
 *   1. Restart same device        — dispatch the native-input-changed event
 *                                   (the pipeline rebuilds on it), wait 15s.
 *   2. Re-enumerate + re-resolve  — listDevices(), confirm the stored pref
 *                                   name is still present, restart once more.
 *   3. Probe alternates           — ERROR-TRIGGERED LADDERS ONLY. Short 4s
 *                                   captures on every OTHER input (ranked
 *                                   best-first via device category); first
 *                                   device with rms > PROBE_RMS gets written
 *                                   to the native pref (sum-all) and the
 *                                   pipeline swaps to it.
 *   4. Needs human                — persistent UI (shell renders a red chip).
 *
 * Trigger split (fix-loop 2026-07-27): silence ALONE never means the audio
 * path is broken — long liturgical silences (communion, prayer, altar calls)
 * are normal, and auto-switching the live input on mere silence contradicts
 * the "AI is still ON — the room is silent, ignore this" operator messaging.
 *   - onError trigger (capture errors, device loss): full ladder, steps 1-4.
 *   - Silence trigger: only after 10 MINUTES of continuous silence, and even
 *     then runs ONLY steps 1-2 (restart same device, re-resolve). It never
 *     probes/auto-switches to alternate inputs — a live audio-path change is
 *     reserved for error-triggered ladders.
 *
 * Safety rails:
 *   - Never escalates within 30s of a MANUAL device/mode change (the
 *     guardian's own dispatches are flagged so they don't reset the timer).
 *   - Max one full ladder run per 5 minutes.
 *   - Browser-mode sessions never start the guardian at all (useAudioStream
 *     only wires it inside the native branch).
 *   - Probe step reuses the single-capture-slot semantics of the native
 *     bridge (startCapture stops the previous capture); after probing the
 *     guardian ALWAYS either switches to the found device or restores the
 *     original capture — it never leaves the slot parked on a probe.
 *
 * Status is broadcast via CustomEvent GUARDIAN_STATE_EVENT so the shell can
 * toast/chip without importing pipeline internals. Every decision is logged
 * with the `[audio-guardian]` prefix.
 */

import {
  NATIVE_AUDIO_INPUT_KEY,
  NATIVE_AUDIO_INPUT_CHANGED_EVENT,
  readNativeDevicePref,
  type NativeDevicePref,
} from "@/lib/audio/nativeDeviceStore";
import { CAPTURE_MODE_CHANGED_EVENT } from "@/lib/audio/captureMode";
// Ranking unified with the picker so guardian failover and launch
// auto-pick agree on what "best input" means.
import { compareNativeDevices } from "@/lib/audio/inputRanking";

export type GuardianState = "healthy" | "silent" | "recovering" | "switched" | "needs-human";

export interface GuardianStatus {
  state: GuardianState;
  detail: string;
  sinceMs: number;
  attempts: number;
}

export const GUARDIAN_STATE_EVENT = "presentflow:audio-guardian-state";

// --- Tunables --------------------------------------------------------------

const SILENCE_RMS = 0.004;          // below this = silence
// Fix-loop 2026-07-27: 20s → 10 minutes. A 10-min communion / prayer silence
// is normal liturgy, not a fault; only genuinely abnormal silence should
// trigger even the restart-only silence ladder.
const SILENCE_HOLD_MS = 10 * 60_000; // continuous silence before ladder starts
const RESTART_WAIT_MS = 15_000;     // wait-for-signal after a restart step
const PROBE_MS = 4_000;             // per-device probe listen window
const PROBE_RMS = 0.01;             // probe "this device has real signal" bar
const MANUAL_DEBOUNCE_MS = 30_000;  // no escalation this soon after a manual change
const LADDER_COOLDOWN_MS = 5 * 60_000; // max 1 full ladder run per 5 minutes
const TICK_MS = 1_000;
const MAX_PROBE_DEVICES = 5;        // bound step 3's total wall time

// --- Native bridge (narrow local view; same defensive-cast pattern as the
// pipeline so this module compiles in pure-web builds) ----------------------

type NativeDeviceInfo = { index: number; name: string; channelCount?: number };
type NativeBridge = {
  listDevices?: () => Promise<NativeDeviceInfo[]>;
  startCapture: (opts: { deviceIndex: number; channelFilter?: string; sampleRate?: number; channels?: number }) => Promise<{ ok: boolean; error?: string }>;
  stopCapture: () => Promise<void>;
  onLevel: (cb: (level: { rms: number; db: number; peak: number }) => void) => () => void;
};

function getNativeBridge(): NativeBridge | null {
  if (typeof window === "undefined") return null;
  const api = (window as Window & {
    electronAPI?: { audio?: { native?: NativeBridge } };
  }).electronAPI;
  return api?.audio?.native ?? null;
}

// --- Internal state --------------------------------------------------------

let started = false;
let state: GuardianState = "healthy";
let stateDetail = "";
let stateSince = 0;
let attempts = 0;               // total escalation-ladder step attempts this run

let capturing = false;
let currentDeviceName: string | null = null;

let silenceStartAt: number | null = null;  // when continuous silence began
let lastLoudAt = 0;                        // last time rms cleared SILENCE_RMS
let lastManualChangeAt = 0;                // last operator-initiated change
let lastLadderRunAt = 0;                   // 5-minute thrash guard
let ladderRunning = false;
let probing = false;                        // step-3 in flight — ignore probe levels in recovery logic
let selfDispatch = false;                   // guardian-originated events don't count as manual
let pendingErrorMsg: string | null = null;  // capture error → escalate on next tick
let wasNeedsHuman = false;                  // for the shell's "Audio recovered" toast semantics

let tickTimer: ReturnType<typeof setInterval> | null = null;
let removeWindowListeners: (() => void) | null = null;

// --- Helpers ---------------------------------------------------------------

function glog(...args: unknown[]) {
  console.log("[audio-guardian]", ...args);
}

function emitState(next: GuardianState, detail: string) {
  if (state !== next || stateDetail !== detail) {
    state = next;
    stateDetail = detail;
    stateSince = Date.now();
  }
  if (next === "needs-human") wasNeedsHuman = true;
  const status: GuardianStatus = {
    state,
    detail: stateDetail,
    sinceMs: Date.now() - stateSince,
    attempts,
  };
  glog("state →", state, "|", detail, "| attempts:", attempts);
  try {
    window.dispatchEvent(new CustomEvent<GuardianStatus>(GUARDIAN_STATE_EVENT, { detail: status }));
  } catch { /* ignore */ }
}

/** Write lastWorkingAt into the stored native pref WITHOUT dispatching the
 *  change event (a dispatch would trigger a pointless pipeline restart). */
function stampLastWorking() {
  try {
    const raw = localStorage.getItem(NATIVE_AUDIO_INPUT_KEY);
    if (!raw) return;
    const pref = JSON.parse(raw) as NativeDevicePref & { lastWorkingAt?: number };
    pref.lastWorkingAt = Date.now();
    localStorage.setItem(NATIVE_AUDIO_INPUT_KEY, JSON.stringify(pref));
  } catch { /* ignore */ }
}

/** Write a full new device pick (sum-all) + dispatch the change event so the
 *  pipeline swaps. Flagged as self-dispatch so it doesn't count as manual. */
function writeSwitchedPref(device: NativeDeviceInfo) {
  const pref: NativeDevicePref & { lastWorkingAt?: number } = {
    index: device.index,
    name: device.name,
    mode: "sum-all",
    lastWorkingAt: Date.now(),
  };
  selfDispatch = true;
  try {
    localStorage.setItem(NATIVE_AUDIO_INPUT_KEY, JSON.stringify(pref));
    window.dispatchEvent(new CustomEvent(NATIVE_AUDIO_INPUT_CHANGED_EVENT, { detail: pref }));
  } catch { /* ignore */ } finally {
    // Cleared on a micro-delay: the pipeline's listener runs synchronously
    // on dispatch, but OUR manual-change listener also runs in the same
    // pass — the flag must survive until both have seen the event.
    setTimeout(() => { selfDispatch = false; }, 0);
  }
}

/** Guardian-originated "please rebuild the pipeline" nudge. */
function dispatchRestart() {
  selfDispatch = true;
  try {
    window.dispatchEvent(new CustomEvent(NATIVE_AUDIO_INPUT_CHANGED_EVENT, { detail: readNativeDevicePref() }));
  } catch { /* ignore */ } finally {
    setTimeout(() => { selfDispatch = false; }, 0);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll until real signal (rms ≥ SILENCE_RMS) arrives, or timeout. Aborts
 *  early if the guardian is stopped or the operator makes a manual change. */
async function waitForSignal(timeoutMs: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (!started) return false;
    if (lastManualChangeAt > t0) { glog("manual change during wait — aborting ladder"); return false; }
    if (lastLoudAt > t0) return true;
    await sleep(500);
  }
  return false;
}

/** Rank OTHER input devices best-first: mixers/NDI ahead of generic mics,
 *  Bluetooth last (latency). Stable within a rank by enumeration order. */
function rankAlternates(devices: NativeDeviceInfo[], excludeName: string | null): NativeDeviceInfo[] {
  return devices
    .filter((d) => d.name !== excludeName)
    .sort(compareNativeDevices)
    .slice(0, MAX_PROBE_DEVICES);
}

/** Probe one device: hijack the single capture slot for PROBE_MS and measure
 *  peak rms via a dedicated onLevel subscription. Caller owns slot restore. */
async function probeDevice(bridge: NativeBridge, device: NativeDeviceInfo): Promise<number> {
  let maxRms = 0;
  const unsub = bridge.onLevel((level) => {
    if (typeof level?.rms === "number" && level.rms > maxRms) maxRms = level.rms;
  });
  try {
    const res = await bridge.startCapture({ deviceIndex: device.index, sampleRate: 16000, channels: 1 });
    if (!res?.ok) {
      glog("probe start failed for", device.name, res?.error || "");
      return 0;
    }
    await sleep(PROBE_MS);
  } catch (e) {
    glog("probe error for", device.name, e instanceof Error ? e.message : e);
  } finally {
    try { unsub(); } catch { /* ignore */ }
  }
  glog("probe result", device.name, "maxRms:", maxRms.toFixed(4));
  return maxRms;
}

// --- The escalation ladder -------------------------------------------------

async function runLadder(trigger: string, opts: { silenceOnly: boolean }) {
  if (ladderRunning) return;
  ladderRunning = true;
  lastLadderRunAt = Date.now();
  attempts = 0;
  const tried: string[] = [];
  const originalName = currentDeviceName;
  glog("escalation ladder starting — trigger:", trigger, "device:", originalName || "(unknown)");

  try {
    // ---- Step 1: restart same device -----------------------------------
    attempts++;
    tried.push("restarted current input");
    emitState("recovering", `Restarting ${originalName || "audio input"}…`);
    dispatchRestart();
    if (await waitForSignal(RESTART_WAIT_MS)) {
      glog("step 1 recovered — restart brought signal back");
      stampLastWorking();
      emitState("healthy", "Signal restored after restart");
      return;
    }
    if (!started) return;

    // ---- Step 2: re-enumerate + re-resolve -----------------------------
    attempts++;
    const bridge = getNativeBridge();
    const pref = readNativeDevicePref();
    let devices: NativeDeviceInfo[] = [];
    try {
      devices = (await bridge?.listDevices?.()) ?? [];
    } catch (e) {
      glog("step 2 listDevices failed", e instanceof Error ? e.message : e);
    }
    const stillPresent = !!pref && devices.some((d) => d.name === pref.name);
    tried.push(`re-enumerated devices (${devices.length} found, stored pick ${stillPresent ? "present" : "MISSING"})`);
    if (stillPresent) {
      emitState("recovering", `Re-resolved ${pref!.name} — retrying…`);
      dispatchRestart();
      if (await waitForSignal(RESTART_WAIT_MS)) {
        glog("step 2 recovered — re-resolve retry brought signal back");
        stampLastWorking();
        emitState("healthy", "Signal restored after re-resolve");
        return;
      }
    } else {
      glog("step 2: stored device not in enumeration — skipping retry, going to probe");
    }
    if (!started) return;

    // ---- Step 3: probe alternates (ERROR-triggered ladders ONLY) -------
    // Fix-loop 2026-07-27: a silence-only ladder must NEVER probe or
    // auto-switch inputs — swapping the live audio path on mere silence
    // (e.g. to the laptop's internal mic mid-communion) is worse than the
    // condition it "fixes". Steps 1-2 already restarted/re-resolved; a
    // silence-only run stops here.
    if (opts.silenceOnly) {
      glog("silence-only ladder — steps 1-2 exhausted; NOT probing alternates");
      emitState(
        "silent",
        `${originalName || "Input"} restarted but still silent. If the room is genuinely quiet this is fine; ` +
        "otherwise check the mixer's USB sends / cable, or pick a different input in Settings › Audio.",
      );
      return;
    }
    if (bridge && devices.length > 0) {
      const alternates = rankAlternates(devices, pref?.name ?? originalName);
      glog("step 3 probing", alternates.length, "alternate device(s):", alternates.map((d) => d.name));
      emitState("recovering", "Scanning other audio inputs for signal…");
      probing = true;
      let found: NativeDeviceInfo | null = null;
      try {
        for (const device of alternates) {
          if (!started) return;
          attempts++;
          const rms = await probeDevice(bridge, device);
          tried.push(`probed ${device.name} (rms ${rms.toFixed(4)})`);
          if (rms > PROBE_RMS) { found = device; break; }
        }
      } finally {
        probing = false;
      }
      if (found) {
        // Switch path: write the pref + dispatch. The pipeline's restart
        // does its OWN startCapture, which stops our probe capture —
        // single-slot semantics hand ownership straight over.
        glog("step 3 SWITCHING to", found.name);
        // Reset silence tracking so the fresh device gets a clean window.
        silenceStartAt = null;
        writeSwitchedPref(found);
        emitState("switched", found.name);
        return;
      }
      // No alternate had signal — restore the original capture so the
      // slot isn't left parked on the last probed device.
      glog("step 3: no alternate showed signal — restoring original capture");
      try { await bridge.stopCapture(); } catch { /* ignore */ }
      dispatchRestart();
    } else {
      tried.push("probe skipped (no native bridge or no devices)");
    }
    if (!started) return;

    // ---- Step 4: needs human -------------------------------------------
    emitState(
      "needs-human",
      `Audio has been silent and auto-recovery failed. Tried: ${tried.join("; ")}. ` +
      "Check the mixer's USB sends / cable, or pick a different input in Settings › Audio.",
    );
  } finally {
    ladderRunning = false;
  }
}

// --- Tick loop -------------------------------------------------------------

function tick() {
  if (!started || ladderRunning) return;
  const now = Date.now();
  // Capture error → escalate immediately (respecting the same guards).
  const errorTriggered = pendingErrorMsg !== null;
  const silentTriggered =
    capturing && silenceStartAt !== null && now - silenceStartAt >= SILENCE_HOLD_MS;
  if (!errorTriggered && !silentTriggered) return;
  if (now - lastManualChangeAt < MANUAL_DEBOUNCE_MS) return; // operator mid-interaction
  if (now - lastLadderRunAt < LADDER_COOLDOWN_MS) {
    // Ladder already ran recently and we're STILL silent — surface state
    // without thrashing hardware.
    if (state === "healthy" || state === "recovering" || state === "switched") {
      emitState("silent", "Input silent — next auto-recovery attempt pending cooldown");
    }
    return;
  }
  // Trigger split: error-triggered ladders get the full ladder (incl. the
  // step-3 probe/auto-switch); silence-only ladders run steps 1-2 only.
  const trigger = errorTriggered ? `capture error: ${pendingErrorMsg}` : "10min continuous silence";
  pendingErrorMsg = null;
  void runLadder(trigger, { silenceOnly: !errorTriggered });
}

// --- Inputs (called from useAudioStream's native branch) -------------------

export function guardianOnLevel(rms: number): void {
  if (!started) return;
  const now = Date.now();
  if (probing) return; // probe audio isn't pipeline audio — don't count it
  if (rms >= SILENCE_RMS) {
    lastLoudAt = now;
    silenceStartAt = null;
    pendingErrorMsg = null;
    if (state !== "healthy" && !ladderRunning) {
      stampLastWorking();
      const wasHuman = wasNeedsHuman;
      wasNeedsHuman = false;
      emitState("healthy", wasHuman ? "Audio recovered" : "Signal detected");
    } else if (state === "healthy" && stateSince === 0) {
      stateSince = now;
    }
  } else {
    if (silenceStartAt === null) silenceStartAt = now;
    // Surface "silent" (pre-escalation awareness) once the hold elapses —
    // the ladder itself starts from tick() which applies the guards.
    if (
      state === "healthy" &&
      now - silenceStartAt >= SILENCE_HOLD_MS &&
      !ladderRunning
    ) {
      emitState("silent", `No signal from ${currentDeviceName || "input"} for 10 minutes`);
    }
  }
}

export function guardianOnCaptureStart(deviceName: string): void {
  if (!started) return;
  capturing = true;
  currentDeviceName = deviceName;
  silenceStartAt = null; // fresh capture gets a clean silence window
  glog("capture started:", deviceName);
}

export function guardianOnCaptureStop(): void {
  if (!started) return;
  capturing = false;
  silenceStartAt = null;
  glog("capture stopped");
}

export function guardianOnError(msg: string): void {
  if (!started) return;
  glog("capture error reported:", msg);
  pendingErrorMsg = msg || "native capture error";
}

// --- Lifecycle -------------------------------------------------------------

export function startGuardian(): void {
  if (typeof window === "undefined") return;
  if (started) return;
  started = true;
  state = "healthy";
  stateDetail = "";
  stateSince = Date.now();
  attempts = 0;
  silenceStartAt = null;
  pendingErrorMsg = null;
  probing = false;
  wasNeedsHuman = false;
  glog("started");

  // Manual-change debounce: any operator-originated device/mode change
  // resets the escalation timers for 30s. Guardian-originated dispatches
  // carry the selfDispatch flag and are ignored.
  const onManualChange = () => {
    if (selfDispatch) return;
    lastManualChangeAt = Date.now();
    silenceStartAt = null;
    glog("manual device/mode change — escalation paused 30s");
  };
  window.addEventListener(NATIVE_AUDIO_INPUT_CHANGED_EVENT, onManualChange);
  window.addEventListener(CAPTURE_MODE_CHANGED_EVENT, onManualChange);
  removeWindowListeners = () => {
    window.removeEventListener(NATIVE_AUDIO_INPUT_CHANGED_EVENT, onManualChange);
    window.removeEventListener(CAPTURE_MODE_CHANGED_EVENT, onManualChange);
  };

  tickTimer = setInterval(tick, TICK_MS);
}

/**
 * True while the escalation ladder is mid-flight. useAudioStream's stop()
 * checks this before calling stopGuardian(): the ladder's own remedies go
 * through stop()+start() (the scheduleRestart path), and killing the
 * guardian there would abort its recovery at step 1 every time.
 */
export function isGuardianBusy(): boolean {
  return ladderRunning;
}

export function stopGuardian(): void {
  if (!started) return;
  started = false;
  capturing = false;
  silenceStartAt = null;
  pendingErrorMsg = null;
  probing = false;
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  if (removeWindowListeners) { removeWindowListeners(); removeWindowListeners = null; }
  glog("stopped");
}
