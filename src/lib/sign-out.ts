import { signOut } from "next-auth/react";
import { _resetTierCache } from "@/hooks/useTier";

/**
 * Shared sign-out handler. Clears in-memory tier cache and, when running in
 * the Electron shell, purges the safeStorage-backed license blob so a new
 * user on the same machine doesn't inherit the previous operator's license.
 */
export async function signOutFully(callbackUrl = "/login") {
  try { _resetTierCache(); } catch { /* noop */ }
  try {
    const api = (typeof window !== "undefined")
      ? (window as unknown as { electronAPI?: { license?: { clear: () => Promise<unknown> } } }).electronAPI?.license
      : undefined;
    if (api?.clear) {
      await api.clear();
    }
  } catch { /* keychain clear is best-effort */ }
  await signOut({ callbackUrl });
}
