"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import {
  AuthShell,
  AuthHeader,
  authInputCls,
  authInputStyle,
  authLabelCls,
  authLabelStyle,
  authCtaCls,
  authCtaStyle,
} from "@/components/auth/AuthShell";

function LoginForm() {
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next");
  const reason = searchParams.get("reason");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    let res;
    try {
      res = await signIn("credentials", { email, password, redirect: false });
    } catch (err) {
      // Network failure or NextAuth boot error (missing AUTH_SECRET →
      // /api/auth/providers returns 500). "Invalid credentials" is misleading
      // in this case — the server never even checked them.
      setLoading(false);
      toast.error("Sign-in unavailable — server error. Try again in a moment.");
      return;
    }
    setLoading(false);
    if (!res || (res.error && res.status === 500)) {
      toast.error("Sign-in unavailable — server error. Try again in a moment.");
      return;
    }
    if (res.error) {
      // Could be bad password OR rate-limit lockout. We deliberately don't
      // distinguish so an attacker can't tell the difference.
      toast.error("Invalid email or password.");
      return;
    }
    // Prefer explicit next=… (guards against open-redirect: must be a
    // same-origin path). Otherwise route through the root so middleware +
    // page.tsx pick the right shell.
    const dest = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
    window.location.href = dest;
  }

  return (
    <>
      <AuthHeader
        eyebrow="Welcome back"
        heading="Sign in to"
        showBrandInHeading
        sub="Pick up right where your last service left off."
      />

      {reason === "session_expired" ? (
        <div
          role="status"
          className="mb-4 rounded-lg border px-3 py-2 text-[12.5px]"
          style={{ borderColor: "rgba(255, 144, 72, 0.35)", background: "rgba(255, 144, 72, 0.08)", color: "#ff9048" }}
        >
          You were signed out. Sign back in to return to your live plan.
        </div>
      ) : null}

      <form onSubmit={onSubmit}>
        <div className="mb-4">
          <label className={authLabelCls} style={authLabelStyle}>
            Email
          </label>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={authInputCls}
            style={authInputStyle}
          />
        </div>

        <div className="mb-4">
          <div className="flex justify-between items-center mb-1.5">
            <label className="text-[13px] font-semibold" style={authLabelStyle}>
              Password
            </label>
            <Link href="/forgot-password" className="text-[12.5px]" style={{ color: "#ff9048" }}>
              Forgot?
            </Link>
          </div>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className={authInputCls}
            style={authInputStyle}
          />
        </div>

        <button type="submit" disabled={loading} className={authCtaCls} style={authCtaStyle}>
          {loading ? "Signing in…" : "Sign in"}
        </button>

        <div className="text-center mt-6 text-sm" style={{ color: "#9c958b" }}>
          New to PresentFlow?{" "}
          <Link href="/signup" className="font-semibold" style={{ color: "#ff9048" }}>
            Create an account
          </Link>
        </div>

        {process.env.NEXT_PUBLIC_SHOW_DEMO_CREDS === "1" && (
          <div className="text-center mt-6 text-xs" style={{ color: "#6f685e" }}>
            Demo login: operator@demo.church / operator123
          </div>
        )}
      </form>
    </>
  );
}

export default function LoginPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
