"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { requestPasswordReset, signUp } from "@/lib/auth-actions";
import { PfAuthScene } from "@/components/auth/PfAuthScene";

/**
 * Unified auth screen — one place for a church to either SIGN IN (returning) or
 * do a first-time BETA SIGN-UP (which flows straight into onboarding). We
 * confirm churches internally and tell them to come here; they pick the path in
 * place via the segmented toggle, no page hop. /login opens on "signin",
 * /signup opens on "beta" — both render this same component, so switching tabs
 * never navigates. All existing behaviour (credentials sign-in, password reset,
 * beta-code signup + auto sign-in) is preserved verbatim.
 */

const HELP_EMAIL = "contact@presentflow.org";
type Mode = "signin" | "beta";

function segBtnStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "9px 12px",
    borderRadius: 8,
    border: 0,
    cursor: "pointer",
    fontFamily: '"Sora",sans-serif',
    fontWeight: 600,
    fontSize: 13,
    letterSpacing: "-0.01em",
    transition: "background .18s,color .18s",
    background: active ? "var(--orange)" : "transparent",
    color: active ? "#fff" : "var(--paper-dim)",
  };
}

function AuthInner({ initialMode }: { initialMode: Mode }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const nextParam = searchParams.get("next");
  const reason = searchParams.get("reason");

  const [mode, setMode] = useState<Mode>(initialMode);
  // shared
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // sign-in extras
  const [forgotOpen, setForgotOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetting, setResetting] = useState(false);
  // beta extras
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setForgotOpen(false);
    setSent(false);
  }

  async function onSignIn(e: React.FormEvent) {
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

  async function onBeta(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await signUp({ email, password, name, code });
    if (!res.ok) {
      toast.error(res.error);
      setLoading(false);
      return;
    }
    if (res.data?.emailFailed) {
      toast.warning("Account created, but we couldn't send the confirmation email. You can resend it on the next screen.");
    }
    const signInRes = await signIn("credentials", { email, password, redirect: false });
    if (signInRes?.error) {
      toast.message("Account created — please sign in to continue.");
      switchMode("signin");
      setLoading(false);
      return;
    }
    setSent(true);
    setLoading(false);
    setTimeout(() => router.push("/onboarding"), 800);
  }

  async function sendReset() {
    const target = (resetEmail || email).trim();
    if (!target) { toast.error("Enter your church email first"); return; }
    setResetting(true);
    await requestPasswordReset(target).catch(() => {});
    setResetting(false);
    setForgotOpen(false);
    toast.success("If that email has an account, a reset link is on its way.");
  }

  return (
    <PfAuthScene>
      <div className="aside-top"><span className="o">{mode === "beta" ? "Create account" : "Access"}</span><span>01 / 01</span></div>
      <div className="form-wrap">
        {/* Segmented Sign in / First-time toggle */}
        <div
          role="tablist"
          aria-label="Sign in or create a church account"
          style={{ display: "flex", gap: 4, padding: 4, borderRadius: 11, border: "1px solid var(--hair-strong)", background: "rgba(255,255,255,0.03)", marginBottom: 22 }}
        >
          <button role="tab" aria-selected={mode === "signin"} type="button" onClick={() => switchMode("signin")} style={segBtnStyle(mode === "signin")}>Sign in</button>
          <button role="tab" aria-selected={mode === "beta"} type="button" onClick={() => switchMode("beta")} style={segBtnStyle(mode === "beta")}>First time · Beta</button>
        </div>

        {mode === "signin" ? (
          <>
            <div className="welcome">Welcome back.</div>
            <h2 className="signin"><span className="o">Sign in</span> to <em>continue</em>.</h2>
            <p className="subtle">Pick up right where your last service left off.</p>

            {reason === "session_expired" && (
              <div className="banner" role="status">You were signed out. Sign back in to return to your live plan.</div>
            )}
            {reason === "device_link_invalid" && (
              <div className="banner" role="status">That desktop sign-in link expired or was already used. Open PresentFlow again from the desktop app for a fresh one.</div>
            )}

            <form onSubmit={onSignIn}>
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

            <p className="note"><span className="o">First time here?</span> Your church was invited to Wave I — <button type="button" onClick={() => switchMode("beta")} style={{ background: "none", border: 0, padding: 0, color: "var(--orange)", cursor: "pointer", font: "inherit", borderBottom: "1px solid var(--hair-strong)" }}>set it up with your beta code</button>.</p>
          </>
        ) : (
          <>
            <div className="welcome">Wave I · Invite only.</div>
            <h2 className="signin"><span className="o">Set up</span> your <em>church</em>.</h2>
            <p className="subtle">First time in? Use the beta code we sent when we confirmed your church. This creates your account and takes you into setup.</p>

            {sent ? (
              <div className="sent-card" style={{ marginTop: 26 }} role="status">
                <div className="rc-title">Check your inbox</div>
                <div>We sent a confirmation link to <span style={{ fontFamily: "ui-monospace,Menlo,monospace" }}>{email}</span>. Taking you to setup…</div>
              </div>
            ) : (
              <form onSubmit={onBeta}>
                <div className="field">
                  <label htmlFor="code">Beta code</label>
                  <input id="code" required autoComplete="off" placeholder="From your invitation" value={code} onChange={(e) => setCode(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="name">Your name</label>
                  <input id="name" required autoComplete="name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="bemail">Email</label>
                  <input id="bemail" type="email" required autoComplete="email" placeholder="you@yourchurch.org" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="bpw">Password</label>
                  <input id="bpw" type="password" required minLength={8} autoComplete="new-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <span className="hint">At least 8 characters</span>
                </div>

                <button className="signin-btn" type="submit" disabled={loading}>
                  <span className="label">{loading ? "Creating…" : "Create account"}</span>
                  <span className="arr">→</span>
                </button>
              </form>
            )}

            <p className="note">Already set up? <button type="button" onClick={() => switchMode("signin")} style={{ background: "none", border: 0, padding: 0, color: "var(--orange)", cursor: "pointer", font: "inherit", borderBottom: "1px solid var(--hair-strong)" }}>Sign in</button>.</p>
          </>
        )}
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

export function UnifiedAuth({ initialMode }: { initialMode: Mode }) {
  return (
    <Suspense fallback={null}>
      <AuthInner initialMode={initialMode} />
    </Suspense>
  );
}
