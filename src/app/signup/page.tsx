"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { signUp } from "@/lib/auth-actions";
import { signIn } from "next-auth/react";

export default function SignUpPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await signUp({ email, password, name });
    if (!res.ok) { toast.error(res.error); setLoading(false); return; }
    // Also sign in immediately so the /verify-email nag can direct them.
    await signIn("credentials", { email, password, redirect: false });
    setSent(true);
    setLoading(false);
    setTimeout(() => router.push("/onboarding"), 800);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm border border-border rounded-md p-8 bg-card space-y-4">
        <div>
          <div className="eyebrow text-muted-foreground mb-2">FaithFlow AI</div>
          <h1 className="text-2xl font-semibold">Create your church account</h1>
          <p className="text-xs text-muted-foreground mt-1">Free during the pilot. Start with a service plan in five minutes.</p>
        </div>

        {sent ? (
          <div className="border border-success/40 bg-success/5 rounded-md p-3 text-sm">
            <div className="font-medium text-success">Check your email</div>
            <div className="text-xs text-muted-foreground mt-1">
              We sent a confirmation link to <span className="font-mono">{email}</span>. You can start onboarding while you wait for it to arrive.
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="text-xs font-semibold">Your name</span>
              <input required value={name} onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className="mt-1 w-full h-9 px-3 border border-border rounded-md bg-background text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">Email</span>
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="mt-1 w-full h-9 px-3 border border-border rounded-md bg-background text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">Password</span>
              <input required type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full h-9 px-3 border border-border rounded-md bg-background text-sm" />
              <span className="text-[10px] text-muted-foreground mt-1 block">At least 8 characters</span>
            </label>
            <button type="submit" disabled={loading}
              className="w-full h-11 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all active:scale-[0.98]">
              {loading ? "Creating…" : "Create account"}
            </button>
          </form>
        )}

        <div className="text-xs text-muted-foreground text-center pt-2">
          Already have an account? <Link href="/login" className="underline">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
