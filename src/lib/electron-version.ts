"use client";
// Client-side check for whether the running Electron shell is new enough to
// support a feature that depends on native shell changes (e.g. the camera
// entitlement added in the 0.1.135 shell). Returns false on the web, on a shell
// too old to expose the API, or on any error — so a renderer feature can be
// pushed to Vercel and stay safe on OLD shells (which would otherwise crash
// when calling camera APIs without the entitlement/usage string).

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

// Minimum shell version that ships the camera entitlement + NSCameraUsageDescription.
export const CAMERA_MIN_SHELL = "0.1.135";

export async function shellSupportsCamera(): Promise<boolean> {
  try {
    if (typeof window === "undefined") return false;
    const v = await window.electronAPI?.app?.version?.();
    if (!v || typeof v !== "string") return false; // web / old preload
    return compareVersions(v, CAMERA_MIN_SHELL) >= 0;
  } catch {
    return false;
  }
}
