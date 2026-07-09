"use client";
import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { toast } from "sonner";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) { toast.error("Invalid credentials"); return; }
    window.location.href = "/dashboard";
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 border border-border rounded-md p-8 bg-card">
        <div>
          <div className="eyebrow text-muted-foreground mb-2">FaithFlow AI</div>
          <h1 className="text-2xl font-semibold">Sign in</h1>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
            className="w-full px-3 py-2 border border-border rounded-md bg-background text-sm" />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold">Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
            className="w-full px-3 py-2 border border-border rounded-md bg-background text-sm" />
        </div>
        <button type="submit" disabled={loading}
          className="w-full h-11 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all active:scale-[0.98]">
          {loading ? "Signing in..." : "Sign in"}
        </button>
        <div className="flex justify-between text-xs">
          <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground underline">Forgot password?</Link>
          <Link href="/signup" className="text-muted-foreground hover:text-foreground underline">Create a church account</Link>
        </div>
        <p className="text-xs text-muted-foreground text-center pt-2 border-t border-border">Demo login: operator@demo.church / operator123</p>
      </form>
    </div>
  );
}
