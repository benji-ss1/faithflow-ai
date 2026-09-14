"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { signOutAllDevices } from "@/lib/session-actions";

/** Account security: revoke every session (web + desktop) for the signed-in user. */
export function SignOutAllDevices() {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div id="security" className="mt-6 rounded-md border border-border bg-card p-4">
      <div className="text-sm font-semibold text-foreground">Security</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Signed in somewhere you don&apos;t recognise? Sign out every computer and browser on your account, including this one.
        Other devices are signed out within about 5 minutes.
      </p>
      {confirming ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => {
              try {
                await signOutAllDevices();
              } catch (e) {
                // signOut() redirects by throwing NEXT_REDIRECT — let that through.
                if (e && typeof e === "object" && "digest" in e && String((e as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
                toast.error("Couldn't sign out all devices — please try again.");
              }
            })}
            className="rounded-md bg-destructive px-3 py-2 text-sm font-semibold text-destructive-foreground disabled:opacity-50"
          >
            {pending ? "Signing out…" : "Yes, sign out all devices"}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-border px-3 py-2 text-sm">
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="mt-3 rounded-md border border-border px-3 py-2 text-sm font-semibold hover:bg-accent">
          Sign out all devices
        </button>
      )}
    </div>
  );
}
