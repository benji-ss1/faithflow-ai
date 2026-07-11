"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { signUp } from "@/lib/auth-actions";
import { signIn } from "next-auth/react";
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
    if (!res.ok) {
      toast.error(res.error);
      setLoading(false);
      return;
    }
    await signIn("credentials", { email, password, redirect: false });
    setSent(true);
    setLoading(false);
    setTimeout(() => router.push("/onboarding"), 800);
  }

  return (
    <AuthShell>
      <AuthHeader
        eyebrow="Let's get started"
        heading="Create your account"
        sub="Set up your workspace in under a minute."
      />

      {sent ? (
        <div
          className="p-5 rounded-2xl mb-5 flex gap-3.5 items-start"
          style={{ background: "rgba(255,144,72,0.08)", border: "1px solid rgba(255,144,72,0.24)" }}
        >
          <div
            className="flex-none w-[34px] h-[34px] rounded-[10px] flex items-center justify-center text-base"
            style={{
              background: "linear-gradient(135deg,#ffb861,#ff6a1f)",
              color: "#17130c",
            }}
          >
            ✉
          </div>
          <div className="text-[14px] leading-[1.55]" style={{ color: "#c4bcaf" }}>
            We sent a confirmation link to{" "}
            <span className="font-mono">{email}</span>. Continuing to onboarding…
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="mb-4">
            <label className={authLabelCls} style={authLabelStyle}>
              Your name
            </label>
            <input
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={authInputCls}
              style={authInputStyle}
            />
          </div>

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
            <label className={authLabelCls} style={authLabelStyle}>
              Password
            </label>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={authInputCls}
              style={authInputStyle}
            />
            <span className="text-[11px] block mt-1.5" style={{ color: "#6f685e" }}>
              At least 8 characters
            </span>
          </div>

          <button type="submit" disabled={loading} className={authCtaCls} style={authCtaStyle}>
            {loading ? "Creating…" : "Create account"}
          </button>
        </form>
      )}

      <div className="text-center mt-6 text-sm" style={{ color: "#9c958b" }}>
        Already have an account?{" "}
        <Link href="/login" className="font-semibold" style={{ color: "#ff9048" }}>
          Sign in
        </Link>
      </div>
    </AuthShell>
  );
}
