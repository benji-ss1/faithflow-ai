import Link from "next/link";
import { verifyEmail } from "@/lib/auth-actions";
import { requirePartialUser } from "@/lib/session";
import { ResendVerification } from "./ResendVerification";

/**
 * Email verification screen. Three states:
 *  1. ?token=… valid   → confirmed, continue to onboarding.
 *  2. ?token=… invalid → link expired; offer a resend if we know who they are.
 *  3. NO token         → the post-signup "check your inbox" screen (signUp
 *     redirects here via /onboarding for an unverified user). This must NOT
 *     read as an error — the account was created, the email is on its way.
 */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const res = token ? await verifyEmail(token) : null;

  // Resolve the signed-in pending user (post-signup they ARE signed in) so we
  // can address the inbox screen to their email and power the resend button
  // without them retyping it. requirePartialUser redirects to /login if there's
  // no session — appropriate for a tokenless visit with no account context.
  // For a token attempt we do NOT force a session (the link may be opened in a
  // different browser), so only resolve when there's no token.
  let email: string | null = null;
  if (!token) {
    const partial = await requirePartialUser();
    if (partial.emailVerified) {
      // Already verified (e.g. clicked the link elsewhere, came back here).
      email = null;
    } else {
      email = partial.email;
    }
  }

  const confirmed = res?.ok === true;
  // Already-verified tokenless visit → send them onward rather than nag.
  const alreadyVerified = !token && email === null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm border border-border rounded-md p-8 bg-card text-center space-y-4">
        <div className="eyebrow text-muted-foreground">Email verification</div>

        {confirmed || alreadyVerified ? (
          <>
            <div className="text-3xl">✓</div>
            <h1 className="text-lg font-semibold">Email confirmed</h1>
            <p className="text-xs text-muted-foreground">You&apos;re set. Continue where you left off.</p>
            <Link href="/onboarding" className="inline-block h-9 px-4 bg-foreground text-background rounded-md text-sm font-semibold">Continue</Link>
          </>
        ) : !token && email ? (
          <>
            <div className="text-3xl">✉</div>
            <h1 className="text-lg font-semibold">Check your inbox</h1>
            <p className="text-xs text-muted-foreground">
              We sent a confirmation link to <span className="font-medium">{email}</span>.
              Click it to finish setting up your account. It can take a minute — check spam too.
            </p>
            <ResendVerification email={email} />
          </>
        ) : (
          <>
            <div className="text-3xl">⚠</div>
            <h1 className="text-lg font-semibold">Link is invalid or expired</h1>
            <p className="text-xs text-muted-foreground">{res && "error" in res ? res.error : "This confirmation link is no longer valid."}</p>
            <p className="text-xs text-muted-foreground">Sign in and we&apos;ll send you a fresh one.</p>
            <Link href="/login" className="inline-block h-9 px-4 border border-border rounded-md text-sm font-semibold">Sign in</Link>
          </>
        )}
      </div>
    </div>
  );
}
