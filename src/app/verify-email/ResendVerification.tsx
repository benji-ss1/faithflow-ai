"use client";

import { useState, useTransition } from "react";
import { resendVerificationEmail } from "@/lib/auth-actions";

/**
 * "Resend confirmation email" button for the verify-email page. The email is
 * resolved server-side (the signed-in pending user) and passed in, so the
 * operator never has to retype it. resendVerificationEmail is non-enumerating
 * and rate-limited, so it's safe to call from the client.
 */
export function ResendVerification({ email }: { email: string }) {
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending || sent}
        onClick={() =>
          startTransition(async () => {
            try { await resendVerificationEmail(email); } catch { /* non-enumerating; ignore */ }
            setSent(true);
          })
        }
        className="inline-block h-9 px-4 bg-foreground text-background rounded-md text-sm font-semibold disabled:opacity-60"
      >
        {pending ? "Sending…" : sent ? "Sent ✓" : "Resend confirmation email"}
      </button>
      {sent && (
        <p className="text-xs text-muted-foreground">
          Sent to <span className="font-medium">{email}</span>. Check your inbox (and spam).
        </p>
      )}
    </div>
  );
}
