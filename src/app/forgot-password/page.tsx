"use client";
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { requestPasswordReset } from "@/lib/auth-actions";
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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await requestPasswordReset(email);
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell>
        <AuthHeader
          eyebrow="Reset access"
          heading="Check your email"
          sub="We'll get you back in — no stress."
        />
        <div
          className="p-5 rounded-2xl mb-5 flex gap-3.5 items-start"
          style={{ background: "rgba(255,144,72,0.08)", border: "1px solid rgba(255,144,72,0.24)" }}
        >
          <div
            className="flex-none w-[34px] h-[34px] rounded-[10px] flex items-center justify-center text-base"
            style={{ background: "linear-gradient(135deg,#ffb861,#ff6a1f)", color: "#17130c" }}
          >
            ✉
          </div>
          <div className="text-[14px] leading-[1.55]" style={{ color: "#c4bcaf" }}>
            We sent a reset link to your inbox. Check your email and follow the link to choose a new password. It expires in one hour.
          </div>
        </div>
        <Link
          href="/login"
          className={authCtaCls + " inline-flex items-center justify-center no-underline"}
          style={authCtaStyle}
        >
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthHeader
        eyebrow="Reset access"
        heading="Forgot password?"
        sub="Enter your email and we’ll send a reset link."
      />
      <form onSubmit={submit}>
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
        <button type="submit" disabled={loading} className={authCtaCls} style={authCtaStyle}>
          {loading ? "Sending…" : "Send reset link"}
        </button>
        <div className="text-center mt-6 text-sm" style={{ color: "#9c958b" }}>
          Remembered it?{" "}
          <Link href="/login" className="font-semibold" style={{ color: "#ff9048" }}>
            Back to sign in
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}
