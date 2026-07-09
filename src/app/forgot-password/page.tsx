"use client";
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { requestPasswordReset } from "@/lib/auth-actions";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await requestPasswordReset(email);
    setLoading(false);
    if (!res.ok) { toast.error(res.error); return; }
    setSent(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm border border-border rounded-md p-8 bg-card space-y-4">
        <div>
          <div className="eyebrow text-muted-foreground mb-2">FaithFlow AI</div>
          <h1 className="text-2xl font-semibold">Reset your password</h1>
        </div>
        {sent ? (
          <div className="border border-success/40 bg-success/5 rounded-md p-3 text-sm">
            <div className="font-medium text-success">Check your email</div>
            <div className="text-xs text-muted-foreground mt-1">
              If an account exists for that email, a reset link is on its way. It expires in one hour.
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="text-xs font-semibold">Email</span>
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="mt-1 w-full h-9 px-3 border border-border rounded-md bg-background text-sm" />
            </label>
            <button type="submit" disabled={loading}
              className="w-full h-11 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all">
              {loading ? "Sending…" : "Send reset link"}
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
