"use client";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { signIn } from "next-auth/react";
import { acceptInvitation } from "@/lib/invitation-actions";

export default function AcceptInvitePage() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") || "";
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await acceptInvitation({ token, name, password });
    setLoading(false);
    if (!res.ok) { toast.error(res.error); return; }
    await signIn("credentials", { email: res.data!.email, password, redirect: false });
    toast.success("Welcome!");
    router.push("/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm border border-border rounded-md p-8 bg-card space-y-4">
        <div>
          <div className="eyebrow text-muted-foreground mb-2">PresentFlow</div>
          <h1 className="text-2xl font-semibold">Accept invitation</h1>
        </div>
        {!token ? (
          <div className="text-sm text-destructive">Missing token. Ask the admin to send a fresh invite.</div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="text-xs font-semibold">Your name</span>
              <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name"
                className="mt-1 w-full h-9 px-3 border border-border rounded-md bg-background text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">Choose a password</span>
              <input required type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full h-9 px-3 border border-border rounded-md bg-background text-sm" />
            </label>
            <button type="submit" disabled={loading}
              className="w-full h-11 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              {loading ? "Joining…" : "Join church"}
            </button>
          </form>
        )}
        <div className="text-xs text-muted-foreground text-center pt-2">
          <Link href="/login" className="underline">Sign in instead</Link>
        </div>
      </div>
    </div>
  );
}
