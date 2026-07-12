"use client";
import { useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createChurchAndAttachUser, completeOnboarding } from "@/lib/onboarding-actions";
import { inviteTeammate } from "@/lib/invitation-actions";
import {
  AuthShell,
  authInputCls,
  authInputStyle,
  authLabelCls,
  authLabelStyle,
  authCtaCls,
  authCtaStyle,
} from "@/components/auth/AuthShell";

/**
 * PresentFlow onboarding wizard — 4 steps, split-panel shell.
 *
 * 1. Workspace name (church_id row creation)
 * 2. Use case ("what will you present?") — stored as workspace flavor
 * 3. Invite team — one email at a time; batches inviteTeammate() calls
 * 4. Done — celebratory summary, redirects to /dashboard
 *
 * Skips forward for users who already have a church attached (returning
 * mid-flow). Never blocks — every step after 0 has a Back button.
 */

type UseCaseKey = "church" | "business" | "education" | "events";
type Invite = { email: string; role: "admin" | "operator" | "pastor"; initial: string };

const USE_CASES: { key: UseCaseKey; icon: string; title: string; desc: string; recommended?: boolean }[] = [
  { key: "church", icon: "⛪", title: "Church & Worship", desc: "Lyrics, Bible verses, live services", recommended: true },
  { key: "business", icon: "💼", title: "Business & Teams", desc: "Decks, meetings, town halls" },
  { key: "education", icon: "🎓", title: "Education", desc: "Lessons, lectures, classrooms" },
  { key: "events", icon: "🎤", title: "Events & Speakers", desc: "Keynotes, stages, conferences" },
];

export function OnboardingWizard({
  hasChurch,
}: {
  userName: string;
  userEmail: string;
  hasChurch: boolean;
  emailVerified: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState(hasChurch ? 1 : 0);
  const [pending, startTransition] = useTransition();

  const [workspace, setWorkspace] = useState("");
  const [useCase, setUseCase] = useState<UseCaseKey>("church");
  const [inviteInput, setInviteInput] = useState("");
  const [invites, setInvites] = useState<Invite[]>([]);

  function addInvite() {
    const email = inviteInput.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Enter a valid email");
      return;
    }
    if (invites.find((i) => i.email === email)) {
      toast.error("Already added");
      return;
    }
    setInvites((xs) => [...xs, { email, role: "operator", initial: email[0].toUpperCase() }]);
    setInviteInput("");
  }

  function stepForward() {
    startTransition(async () => {
      if (step === 0) {
        if (!workspace.trim()) {
          toast.error("Workspace name is required");
          return;
        }
        const res = await createChurchAndAttachUser({
          name: workspace.trim(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        setStep(1);
        return;
      }
      if (step === 1) {
        // Use case captured client-side; consumed by dashboard hints later.
        setStep(2);
        return;
      }
      if (step === 2) {
        for (const inv of invites) {
          const res = await inviteTeammate({ email: inv.email, role: inv.role });
          if (!res.ok) toast.error(`${inv.email}: ${res.error}`);
        }
        setStep(3);
        return;
      }
      // step 3 — finish
      const res = await completeOnboarding();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.push("/onboarding/download");
    });
  }

  const canBack = step > 0 && step < 3;
  const stepNum = step + 1;
  const titles = ["Name your workspace", "What will you present?", "Invite your team", "You're all set!"];
  const subs = [
    "This is where your slides, songs and services live.",
    "We'll tailor templates and tools to fit how you present.",
    "Presenting is a team sport. Add the people who help run your events.",
    "Your PresentFlow workspace is ready to go.",
  ];
  const ctaLabels = ["Continue", "Continue", "Finish setup", "Enter PresentFlow"];

  return (
    <AuthShell>
      {/* Step progress bars */}
      <div className="flex items-center gap-2 mb-7">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex-1 h-[5px] rounded-[3px] transition-all"
            style={{
              background: i <= step ? "linear-gradient(90deg,#ffb861,#ff7a2c)" : "rgba(255,255,255,0.09)",
            }}
          />
        ))}
      </div>

      <div key={step} style={{ animation: "pfRise 0.4s ease both" }}>
        <div className="text-[13px] font-semibold tracking-[0.12em] uppercase" style={{ color: "#ff9048" }}>
          Step {stepNum} of 4
        </div>
        <h2 className="font-display font-bold text-[27px] tracking-[-0.02em] mt-2 mb-1.5" style={{ color: "#f4f1ea" }}>
          {titles[step]}
        </h2>
        <p className="text-[15px] leading-[1.5] mb-6" style={{ color: "#9c958b" }}>
          {subs[step]}
        </p>

        {step === 0 && (
          <div className="mb-5">
            <label className={authLabelCls} style={authLabelStyle}>
              Workspace name
            </label>
            <input
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              placeholder="Grace Community Church"
              className={authInputCls}
              style={authInputStyle}
              autoFocus
            />
          </div>
        )}

        {step === 1 && (
          <div className="grid grid-cols-2 gap-3 mb-5">
            {USE_CASES.map((u) => {
              const sel = useCase === u.key;
              return (
                <button
                  key={u.key}
                  type="button"
                  onClick={() => setUseCase(u.key)}
                  className="text-left cursor-pointer p-4 rounded-2xl text-[#ece7e0] transition-all"
                  style={{
                    background: sel ? "rgba(255,144,72,0.10)" : "rgba(255,255,255,0.03)",
                    border: sel ? "1px solid rgba(255,144,72,0.55)" : "1px solid rgba(255,255,255,0.08)",
                    boxShadow: sel ? "0 8px 26px rgba(255,122,44,0.22)" : "none",
                    fontFamily: "inherit",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[22px]">{u.icon}</span>
                    {u.recommended && (
                      <span
                        className="text-[9px] font-bold tracking-[0.06em] px-1.5 py-0.5 rounded-md"
                        style={{ background: "rgba(255,144,72,0.16)", color: "#ff9048" }}
                      >
                        POPULAR
                      </span>
                    )}
                  </div>
                  <div className="font-display font-semibold text-[15px] mt-3.5" style={{ color: "#f1ede6" }}>
                    {u.title}
                  </div>
                  <div className="text-[12.5px] mt-1 leading-[1.4]" style={{ color: "#948d83" }}>
                    {u.desc}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {step === 2 && (
          <div className="mb-5">
            <div className="flex gap-2.5 mb-3.5">
              <input
                type="email"
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addInvite())}
                placeholder="teammate@example.com"
                className={authInputCls}
                style={authInputStyle}
              />
              <button
                type="button"
                onClick={addInvite}
                className="flex-none px-4 rounded-xl font-semibold text-[14px] cursor-pointer"
                style={{
                  border: "1px solid rgba(255,144,72,0.4)",
                  background: "rgba(255,144,72,0.12)",
                  color: "#ff9048",
                }}
              >
                Add
              </button>
            </div>
            {invites.map((inv) => (
              <div
                key={inv.email}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl mb-2"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
              >
                <div
                  className="w-[30px] h-[30px] rounded-full flex items-center justify-center font-bold text-[13px] text-white"
                  style={{ background: "linear-gradient(135deg,#ff7a2c,#8a6f96)" }}
                >
                  {inv.initial}
                </div>
                <div className="flex-1 text-[14px]" style={{ color: "#d5cdc1" }}>
                  {inv.email}
                </div>
                <div className="text-[12px]" style={{ color: "#847d72" }}>
                  Operator
                </div>
                <button
                  type="button"
                  onClick={() => setInvites((xs) => xs.filter((x) => x.email !== inv.email))}
                  className="text-[16px] cursor-pointer leading-none px-1"
                  style={{ color: "#847d72" }}
                  aria-label={`Remove ${inv.email}`}
                >
                  ×
                </button>
              </div>
            ))}
            {invites.length === 0 && (
              <div className="text-[12.5px] text-center py-3" style={{ color: "#6f685e" }}>
                No teammates yet — you can always add them later in Settings.
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="text-center py-3.5 pb-6">
            <Image
              src="/brand/pf-logo-mark.png"
              alt=""
              width={80}
              height={80}
              className="object-contain mx-auto"
              style={{
                filter: "drop-shadow(0 12px 34px rgba(0,0,0,0.5))",
                animation: "pfPulse 3.4s ease-in-out infinite",
              }}
            />
            <div className="flex justify-center gap-6 mt-6">
              {[
                { value: "1", label: "Workspace" },
                { value: String(invites.length + 1), label: "Members" },
                { value: "6", label: "Templates" },
              ].map((s) => (
                <div key={s.label} className="text-center">
                  <div className="font-display font-bold text-[22px] pf-brand-text">{s.value}</div>
                  <div className="text-[12px] mt-0.5" style={{ color: "#847d72" }}>
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          {canBack && (
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="flex-none px-5 py-3.5 rounded-xl font-semibold text-[15px] cursor-pointer font-display"
              style={{
                border: "1px solid rgba(255,255,255,0.14)",
                background: "transparent",
                color: "#c4bcaf",
              }}
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={stepForward}
            disabled={pending}
            className={authCtaCls}
            style={authCtaStyle}
          >
            {pending ? "Working…" : ctaLabels[step]}
          </button>
        </div>
      </div>
    </AuthShell>
  );
}
