import Link from "next/link";
import { verifyEmail } from "@/lib/auth-actions";

// CP5: canonical /verify?token=... route. Mirrors /verify-email so email
// templates authored against either path continue to work.
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const res = token ? await verifyEmail(token) : { ok: false as const, error: "Missing token" };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm border border-border rounded-md p-8 bg-card text-center space-y-4">
        <div className="eyebrow text-muted-foreground">Email verification</div>
        {res.ok ? (
          <>
            <div className="text-3xl">✓</div>
            <h1 className="text-lg font-semibold">Email confirmed</h1>
            <p className="text-xs text-muted-foreground">You&apos;re set. Sign in to continue.</p>
            <Link href="/login" className="inline-block h-9 px-4 bg-foreground text-background rounded-md text-sm font-semibold">Sign in</Link>
          </>
        ) : (
          <>
            <div className="text-3xl">⚠</div>
            <h1 className="text-lg font-semibold">Link is invalid or expired</h1>
            <p className="text-xs text-muted-foreground">{"error" in res ? res.error : ""}</p>
            <Link href="/login" className="inline-block h-9 px-4 border border-border rounded-md text-sm font-semibold">Sign in</Link>
          </>
        )}
      </div>
    </div>
  );
}
