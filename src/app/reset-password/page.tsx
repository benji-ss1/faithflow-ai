"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { resetPassword } from "@/lib/auth-actions";

export default function ResetPasswordPage() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await resetPassword(token, password);
    setLoading(false);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success("Password reset");
    router.push("/login");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm border border-border rounded-md p-8 bg-card space-y-4">
        <div>
          <div className="eyebrow text-muted-foreground mb-2">FaithFlow AI</div>
          <h1 className="text-2xl font-semibold">Choose a new password</h1>
        </div>
        {!token ? (
          <div className="text-sm text-destructive">Missing token. Request a fresh link.</div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="text-xs font-semibold">New password</span>
              <input required type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full h-9 px-3 border border-border rounded-md bg-background text-sm" />
              <span className="text-[10px] text-muted-foreground mt-1 block">At least 8 characters</span>
            </label>
            <button type="submit" disabled={loading}
              className="w-full h-11 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              {loading ? "Saving…" : "Reset password"}
            </button>
          </form>
        )}
        <div className="text-xs text-muted-foreground text-center pt-2">
          <Link href="/login" className="underline">Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}
