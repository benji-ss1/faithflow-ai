"use client";
import { useState } from "react";
import Link from "next/link";
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

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      toast.error("Invalid credentials");
      return;
    }
    // Route through the root so middleware + page.tsx pick the right shell.
    // Desktop → /operator, web → /dashboard.
    window.location.href = "/";
  }

  return (
    <AuthShell>
      <AuthHeader
        eyebrow="Welcome back"
        heading="Sign in to"
        showBrandInHeading
        sub="Pick up right where your last service left off."
      />

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

        <div className="text-center mt-6 text-xs" style={{ color: "#6f685e" }}>
          Demo login: operator@demo.church / operator123
        </div>
      </form>
    </AuthShell>
  );
}
