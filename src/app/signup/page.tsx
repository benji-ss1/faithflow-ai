"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { signUp } from "@/lib/auth-actions";
import { signIn } from "next-auth/react";
import { PfAuthScene } from "@/components/auth/PfAuthScene";

export default function SignUpPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await signUp({ email, password, name, code });
    if (!res.ok) {
      toast.error(res.error);
      setLoading(false);
      return;
    }
    // Account created. If the confirmation email couldn't be sent, tell them
    // (they can Resend on the next screen) rather than leaving them waiting on
    // an email that never arrives.
    if (res.data?.emailFailed) {
      toast.warning("Account created, but we couldn't send the confirmation email. You can resend it on the next screen.");
    }
    // If auto sign-in fails, the account still exists — send them to /login with
    // a clear message instead of pushing to /onboarding with no session.
    const signInRes = await signIn("credentials", { email, password, redirect: false });
    if (signInRes?.error) {
      toast.message("Account created — please sign in to continue.");
      router.push("/login");
      return;
    }
    setSent(true);
    setLoading(false);
    setTimeout(() => router.push("/onboarding"), 800);
  }

  return (
    <PfAuthScene>
      <div className="aside-top"><span className="o">Create account</span><span>01 / 01</span></div>
      <div className="form-wrap">
        <div className="welcome">Wave I · Invite only.</div>
        <h2 className="signin"><span className="o">Create</span> your <em>account</em>.</h2>
        <p className="subtle">You&apos;ll need the beta code from your invitation to set up your workspace.</p>

        {sent ? (
          <div className="sent-card" style={{ marginTop: 26 }} role="status">
            <div className="rc-title">Check your inbox</div>
            <div>We sent a confirmation link to <span style={{ fontFamily: "ui-monospace,Menlo,monospace" }}>{email}</span>. Taking you to setup…</div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="code">Beta code</label>
              <input id="code" required autoComplete="off" placeholder="From your invitation" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="name">Your name</label>
              <input id="name" required autoComplete="name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" required autoComplete="email" placeholder="you@yourchurch.org" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="pw">Password</label>
              <input id="pw" type="password" required minLength={8} autoComplete="new-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
              <span className="hint">At least 8 characters</span>
            </div>

            <button className="signin-btn" type="submit" disabled={loading}>
              <span className="label">{loading ? "Creating…" : "Create account"}</span>
              <span className="arr">→</span>
            </button>
          </form>
        )}

        <p className="note">Already have an account? <Link href="/login">Sign in</Link>.</p>
      </div>

      <div className="aside-foot">
        <div><span className="o">Trusted for churches</span></div>
        <div><Link href="/login" style={{ color: "var(--orange)" }}>Sign in</Link></div>
      </div>
    </PfAuthScene>
  );
}
