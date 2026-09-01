"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { requestPasswordReset } from "@/lib/auth-actions";
import { PfAuthScene } from "@/components/auth/PfAuthScene";

const HELP_EMAIL = "contact@presentflow.org";

function LoginForm() {
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next");
  const reason = searchParams.get("reason");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetting, setResetting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      toast.error("Invalid credentials");
      return;
    }
    let safe = false;
    if (nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") && !nextParam.includes("\\")) {
      try {
        const u = new URL(nextParam, window.location.origin);
        safe = u.origin === window.location.origin && !u.pathname.startsWith("/login") && !u.pathname.startsWith("/signup");
      } catch { safe = false; }
    }
    window.location.href = safe ? nextParam! : "/dashboard";
  }

  async function sendReset() {
    const target = (resetEmail || email).trim();
    if (!target) { toast.error("Enter your church email first"); return; }
    setResetting(true);
    await requestPasswordReset(target).catch(() => {});
    setResetting(false);
    setForgotOpen(false);
    // Non-enumerating: always the same message.
    toast.success("If that email has an account, a reset link is on its way.");
  }

  return (
    <PfAuthScene>
      <div className="aside-top"><span className="o">Access</span><span>01 / 01</span></div>
      <div className="form-wrap">
        <div className="welcome">Welcome back.</div>
        <h2 className="signin"><span className="o">Sign in</span> to <em>continue</em>.</h2>
        <p className="subtle">Pick up right where your last service left off.</p>

        {reason === "session_expired" && (
          <div className="banner" role="status">You were signed out. Sign back in to return to your live plan.</div>
        )}
        {reason === "device_link_invalid" && (
          <div className="banner" role="status">That desktop sign-in link expired or was already used. Open PresentFlow again from the desktop app for a fresh one.</div>
        )}

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email" placeholder="you@yourchurch.org" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pw">Password <button type="button" onClick={() => setForgotOpen((v) => !v)}>Forgot?</button></label>
            <input id="pw" type="password" required autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>

          <div className={`expand${forgotOpen ? " open" : ""}`}>
            <div className="reset-card">
              <div className="rc-title">Reset your password</div>
              <div>Enter your church email. We&apos;ll send a reset link within a minute.</div>
              <input type="email" placeholder="you@yourchurch.org" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} />
              <div className="rc-actions">
                <button className="ghost" type="button" onClick={() => setForgotOpen(false)}>Cancel</button>
                <button type="button" onClick={sendReset} disabled={resetting}>{resetting ? "Sending…" : "Send link"}</button>
              </div>
            </div>
          </div>

          <button className="signin-btn" type="submit" disabled={loading}>
            <span className="label">{loading ? "Signing in…" : "Sign in"}</span>
            <span className="arr">→</span>
          </button>
        </form>

        <p className="note"><span className="o">Wave I is invite-only.</span> Have your beta code? <Link href="/signup">Set up your church →</Link> — or email <a href={`mailto:${HELP_EMAIL}`}>{HELP_EMAIL}</a> if you&apos;re stuck.</p>
      </div>

      <div className="aside-foot">
        <div><span className="o">Trusted for churches</span></div>
        <div><button type="button" onClick={() => setHelpOpen((v) => !v)}>Need help?</button></div>
      </div>
      <div className={`expand${helpOpen ? " open" : ""}`}>
        <div className="help-card">
          <div className="rc-title">We&apos;re here.</div>
          <div>Email <a href={`mailto:${HELP_EMAIL}`}>{HELP_EMAIL}</a> or ask your team lead — pilot churches get a same-day reply.</div>
        </div>
      </div>
    </PfAuthScene>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
