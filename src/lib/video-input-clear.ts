"use client";
/**
 * Stop the live video input from outside the Video Input panel (PP7 Clear Video
 * Input). Same effect as the panel's own Clear button: persisted state goes
 * inactive and the operator console drops the camera. The panel (if mounted)
 * listens for `presentflow:video-input-cleared` and flips its Go-live state, so
 * the camera can be put live again normally.
 */
const LS_KEY = "presentflow.videoInput.v1";

export function clearVideoInputLive(): void {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Record<string, unknown>;
      if (p && typeof p === "object") window.localStorage.setItem(LS_KEY, JSON.stringify({ ...p, active: false }));
    }
  } catch { /* storage unavailable or corrupt — still clear the live feed */ }
  window.dispatchEvent(new CustomEvent("presentflow:video-input-changed", { detail: { videoInput: null } }));
  window.dispatchEvent(new CustomEvent("presentflow:video-input-cleared"));
}
