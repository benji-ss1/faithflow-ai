"use client";
import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Download, FolderInput, Library, Rocket, SkipForward } from "lucide-react";
import { createChurchAndAttachUser, completeOnboarding } from "@/lib/onboarding-actions";
import { inviteTeammate } from "@/lib/invitation-actions";
import { addBuiltInHymnsToMyChurch } from "@/lib/actions";
import { ChurchBrandingUploader } from "@/components/organization/ChurchBrandingUploader";
import { OnboardingSplash } from "@/components/onboarding/OnboardingSplash";
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
 * PresentFlow onboarding wizard — six steps, dark-themed AuthShell.
 *
 *  0. Welcome hero      — brand-forward "get started" screen
 *  1. Church profile    — creates the church row + attaches user as admin
 *  2. Branding          — optional logo upload (reuses ChurchBrandingUploader)
 *  3. Songs             — three-way pick: import wizard, built-in hymns, skip
 *  4. Team              — optional multi-email invite (via Resend)
 *  5. Download desktop  — final CTA + "Go to dashboard" finish
 *
 * Steps 2–5 are all skippable. Only step 1 is required (it's the
 * gate that creates the church_id row). Every step after 1 uses
 * server actions that re-read the user by email via requireUser(),
 * so the freshly-attached churchId is visible immediately without
 * an explicit session refresh.
 */

type Invite = { email: string; role: "admin" | "operator" | "pastor" };
type ImportChoice = "wizard" | "hymns" | "skip" | null;

const TOTAL_STEPS = 6;
const STEP_TITLES = [
  "Welcome to PresentFlow",
  "Tell us about your church",
  "Add your church logo",
  "Bring in your songs",
  "Invite your team",
  "Get the desktop app",
];
const STEP_SUBS = [
  "Let's get your church set up in a few minutes.",
  "Basic identity — you can polish everything else later from Settings.",
  "Appears in your sidebar, on the desktop splash, and as a Logo slide.",
  "Import from another tool, start with our built-in hymns, or add later.",
  "Presenting is a team sport. Add the operators who help run services.",
  "The desktop app is where you actually present on Sundays.",
];

const MAX_WIZARD_INVITES = 20;
const SPLASH_DURATION_MS = 2600;
const SPLASH_DONE_KEY = "pf_onboarding_splash_done";

export function OnboardingWizard({
  hasChurch,
  initialLogoUrl,
}: {
  userName: string;
  userEmail: string;
  hasChurch: boolean;
  emailVerified: boolean;
  initialLogoUrl: string | null;
}) {
  const router = useRouter();
  // Returning users mid-flow (church already attached) skip past the welcome
  // + profile steps straight to branding.
  const [step, setStep] = useState(hasChurch ? 2 : 0);
  const [pending, startTransition] = useTransition();

  // Splash gate — the one place in the app we intentionally show the
  // PresentFlow animated splash. Shows for ~2.6s on the very first entry
  // to /onboarding, then never again for the same browser profile (localStorage
  // flag). Returning users mid-flow (hasChurch=true) skip the splash entirely
  // — they've already seen it.
  const [showSplash, setShowSplash] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    if (hasChurch) return false;
    return window.localStorage.getItem(SPLASH_DONE_KEY) !== "1";
  });
  useEffect(() => {
    if (!showSplash) return;
    const t = window.setTimeout(() => {
      setShowSplash(false);
      try { window.localStorage.setItem(SPLASH_DONE_KEY, "1"); } catch { /* ignore quota / private-mode */ }
    }, SPLASH_DURATION_MS);
    return () => window.clearTimeout(t);
  }, [showSplash]);

  // Step 1 — church profile
  const [churchName, setChurchName] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [denomination, setDenomination] = useState("");
  const [congregationSize, setCongregationSize] = useState<string>("");
  const detectedTz =
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : "UTC";

  // Step 3 — song import choice + result
  const [importChoice, setImportChoice] = useState<ImportChoice>(null);
  const [hymnResult, setHymnResult] = useState<{ added: number; skipped: number } | null>(null);

  // Step 4 — invites
  const [inviteInput, setInviteInput] = useState("");
  const [invites, setInvites] = useState<Invite[]>([]);

  function addInvite() {
    const email = inviteInput.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Enter a valid email address");
      return;
    }
    if (invites.some((i) => i.email === email)) {
      toast.error("Already added");
      return;
    }
    // F2 (Phase 3B security): cap wizard-side invites so a single onboarding
    // session can't blast Resend with hundreds of sends on our shared
    // allowance. Real churches invite 3-8 people in one sitting; 20 gives
    // plenty of headroom without making the surface abusable.
    if (invites.length >= MAX_WIZARD_INVITES) {
      toast.error(`You can invite up to ${MAX_WIZARD_INVITES} teammates during onboarding. Add the rest later from Team.`);
      return;
    }
    setInvites((xs) => [...xs, { email, role: "operator" }]);
    setInviteInput("");
  }

  function submitProfile() {
    startTransition(async () => {
      const name = churchName.trim();
      if (!name) { toast.error("Church name is required"); return; }
      const sizeNum = congregationSize.trim() === "" ? undefined : Math.max(0, Math.floor(Number(congregationSize)) || 0);
      const res = await createChurchAndAttachUser({
        name,
        city: city.trim() || undefined,
        country: country.trim() || undefined,
        timezone: detectedTz,
        denomination: denomination.trim() || undefined,
        congregationSize: sizeNum,
      });
      if (!res.ok) { toast.error(res.error); return; }
      setStep(2);
    });
  }

  function submitHymnLibrary() {
    // Reviewer 🟡 (Phase 3B): mark the choice so the "Add to my library"
    // button's post-click state (✓ Added N) renders correctly. The button's
    // stopPropagation prevents the card's onClick from firing, so without
    // this the card would look unselected even though we're mid-seed.
    setImportChoice("hymns");
    startTransition(async () => {
      const res = await addBuiltInHymnsToMyChurch();
      if (!res.ok) { toast.error(res.error || "Could not seed hymns"); return; }
      setHymnResult(res.data ?? { added: 0, skipped: 0 });
      toast.success(`Added ${res.data?.added ?? 0} hymns to your library`);
      // No auto-advance here — the user should see the ✓ confirmation on
      // the card and click Continue themselves, so they know what happened
      // and can go Back if they want to also open the migration wizard.
    });
  }

  function submitInvites() {
    startTransition(async () => {
      if (invites.length === 0) { setStep(5); return; }
      // Reviewer 🟡 (Phase 3B): consolidate partial failures into a single
      // summary toast instead of one toast per failed email. If the user
      // pasted 15 emails and 3 belong to another church, the previous
      // behaviour dumped 3 red toasts on top of each other with no
      // context of how many succeeded.
      const failed: { email: string; error: string }[] = [];
      let sent = 0;
      for (const inv of invites) {
        const res = await inviteTeammate({ email: inv.email, role: inv.role });
        if (res.ok) { sent++; } else { failed.push({ email: inv.email, error: res.error }); }
      }
      if (failed.length === 0) {
        toast.success(`Invited ${sent} teammate${sent === 1 ? "" : "s"}`);
      } else if (sent === 0) {
        toast.error(`None of the ${failed.length} invites went through — check emails and try again from Team.`);
      } else {
        toast.success(`Invited ${sent}. ${failed.length} skipped: ${failed.map((f) => f.email).join(", ")}`);
      }
      setStep(5);
    });
  }

  function finish() {
    startTransition(async () => {
      const res = await completeOnboarding();
      if (!res.ok) { toast.error(res.error); return; }
      router.push("/dashboard");
    });
  }

  // Reviewer 🔴 (Phase 3B): returning users (hasChurch=true) start at step 2.
  // Backing to step 1 (Profile) → hitting Continue → createChurchAndAttachUser
  // → "You already have a church" → dead loop. So the floor for canBack is
  // the entry step itself. Fresh users start at 0 and can back through
  // Welcome; returning users start at 2 and can't back below Branding.
  const backFloor = hasChurch ? 2 : 0;
  const canBack = step > backFloor && step < 5;
  const stepNum = step + 1;

  if (showSplash) return <OnboardingSplash />;

  return (
    <AuthShell>
      {/* Six-segment progress bar */}
      <div className="mb-7 flex items-center gap-1.5">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <div
            key={i}
            className="h-[4px] flex-1 rounded-[3px] transition-all"
            style={{
              background: i <= step ? "linear-gradient(90deg,#ffb861,#ff7a2c)" : "rgba(255,255,255,0.09)",
            }}
          />
        ))}
      </div>

      <div key={step} style={{ animation: "pfRise 0.4s ease both" }}>
        <div className="text-[13px] font-semibold uppercase tracking-[0.12em]" style={{ color: "#ff9048" }}>
          Step {stepNum} of {TOTAL_STEPS}
        </div>
        <h2 className="mb-1.5 mt-2 font-display text-[26px] font-bold tracking-[-0.02em]" style={{ color: "#f4f1ea" }}>
          {STEP_TITLES[step]}
        </h2>
        <p className="mb-6 text-[15px] leading-[1.5]" style={{ color: "#9c958b" }}>
          {STEP_SUBS[step]}
        </p>

        {/* Step 0 — Welcome hero */}
        {step === 0 && (
          <div className="mb-5">
            <div
              className="mb-6 rounded-2xl px-6 py-8 text-center"
              style={{
                background: "linear-gradient(135deg,#1a0a14 0%,#0b0b0b 40%,#0b0b0b 100%)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <Image
                src="/brand/pf-logo-mark.png"
                alt=""
                width={64}
                height={64}
                className="mx-auto object-contain"
                style={{
                  filter: "drop-shadow(0 12px 34px rgba(232,116,42,0.35))",
                  animation: "pfPulse 3.4s ease-in-out infinite",
                }}
              />
              <div className="mt-4 text-[15px] leading-[1.55]" style={{ color: "#c4bcaf" }}>
                Six quick steps and you&rsquo;ll be ready to present on Sunday.
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-left text-[12px]" style={{ color: "#847d72" }}>
                <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-[#ff9048]" /> Church profile</div>
                <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-[#ff9048]" /> Songs library</div>
                <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-[#ff9048]" /> Desktop app</div>
              </div>
            </div>
          </div>
        )}

        {/* Step 1 — Church profile */}
        {step === 1 && (
          <div className="mb-5 space-y-4">
            <div>
              <label className={authLabelCls} style={authLabelStyle}>Church name</label>
              <input
                value={churchName}
                onChange={(e) => setChurchName(e.target.value)}
                placeholder="Grace Community Church"
                maxLength={200}
                className={authInputCls}
                style={authInputStyle}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={authLabelCls} style={authLabelStyle}>City</label>
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Dublin"
                  maxLength={120}
                  className={authInputCls}
                  style={authInputStyle}
                />
              </div>
              <div>
                <label className={authLabelCls} style={authLabelStyle}>Country</label>
                <input
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="Ireland"
                  maxLength={120}
                  className={authInputCls}
                  style={authInputStyle}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={authLabelCls} style={authLabelStyle}>Denomination</label>
                <input
                  value={denomination}
                  onChange={(e) => setDenomination(e.target.value)}
                  placeholder="Non-denominational"
                  maxLength={120}
                  className={authInputCls}
                  style={authInputStyle}
                />
              </div>
              <div>
                <label className={authLabelCls} style={authLabelStyle}>Congregation size</label>
                <input
                  value={congregationSize}
                  onChange={(e) => setCongregationSize(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="120"
                  inputMode="numeric"
                  className={authInputCls}
                  style={authInputStyle}
                />
              </div>
            </div>
            <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: "rgba(255,255,255,0.03)", color: "#9c958b" }}>
              Timezone auto-detected as <span style={{ color: "#f1ede6" }}>{detectedTz}</span>. Change it later in Organization → Church profile.
            </div>
          </div>
        )}

        {/* Step 2 — Branding (logo upload) */}
        {step === 2 && (
          <div className="mb-5">
            <div className="pf-admin-scope">
              <ChurchBrandingUploader initialLogoUrl={initialLogoUrl} />
            </div>
          </div>
        )}

        {/* Step 3 — Songs */}
        {step === 3 && (
          <div className="mb-5 space-y-3">
            <ImportOptionCard
              icon={<FolderInput className="h-5 w-5" />}
              title="Import from your current tool"
              desc="ProPresenter (.pro6), plain text, CSV, and more. Reviewed before anything commits."
              selected={importChoice === "wizard"}
              action={
                <Link
                  href="/library/imports/wizard"
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold"
                  style={{ background: "rgba(255,144,72,0.16)", color: "#ff9048" }}
                >
                  Open wizard →
                </Link>
              }
              onClick={() => setImportChoice("wizard")}
            />
            <ImportOptionCard
              icon={<Library className="h-5 w-5" />}
              title="Start with built-in hymns"
              desc="50 individually-verified public-domain hymns (Christmas, Easter, classic worship). Free."
              selected={importChoice === "hymns"}
              action={
                hymnResult ? (
                  <span className="text-[12px] font-medium" style={{ color: "#4fd18b" }}>
                    ✓ Added {hymnResult.added}
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={(e) => { e.stopPropagation(); submitHymnLibrary(); }}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
                    style={{ background: "rgba(255,144,72,0.16)", color: "#ff9048" }}
                  >
                    {pending && importChoice === "hymns" ? "Adding…" : "Add to my library"}
                  </button>
                )
              }
              onClick={() => setImportChoice("hymns")}
            />
            <ImportOptionCard
              icon={<SkipForward className="h-5 w-5" />}
              title="I'll add songs later"
              desc="You can always add or import from the Songs library in the sidebar."
              selected={importChoice === "skip"}
              onClick={() => setImportChoice("skip")}
            />
          </div>
        )}

        {/* Step 4 — Team */}
        {step === 4 && (
          <div className="mb-5">
            <div className="mb-3.5 flex gap-2.5">
              <input
                type="email"
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addInvite(); }
                }}
                placeholder="teammate@example.com"
                className={authInputCls}
                style={authInputStyle}
              />
              <button
                type="button"
                onClick={addInvite}
                className="flex-none cursor-pointer rounded-xl px-4 text-[14px] font-semibold"
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
                className="mb-2 flex items-center gap-2.5 rounded-xl px-3 py-2.5"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
              >
                <div
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-[13px] font-bold text-white"
                  style={{ background: "linear-gradient(135deg,#ff7a2c,#8a6f96)" }}
                >
                  {inv.email[0]?.toUpperCase()}
                </div>
                <div className="flex-1 text-[14px]" style={{ color: "#d5cdc1" }}>{inv.email}</div>
                <select
                  value={inv.role}
                  onChange={(e) => {
                    const role = e.target.value as Invite["role"];
                    setInvites((xs) => xs.map((x) => (x.email === inv.email ? { ...x, role } : x)));
                  }}
                  className="cursor-pointer rounded-md bg-transparent px-1.5 py-0.5 text-[12px]"
                  style={{ color: "#c4bcaf", border: "1px solid rgba(255,255,255,0.1)" }}
                >
                  <option value="operator" style={{ background: "#171319" }}>Operator</option>
                  <option value="admin" style={{ background: "#171319" }}>Admin</option>
                  <option value="pastor" style={{ background: "#171319" }}>Pastor</option>
                </select>
                <button
                  type="button"
                  onClick={() => setInvites((xs) => xs.filter((x) => x.email !== inv.email))}
                  className="cursor-pointer px-1 text-[16px] leading-none"
                  style={{ color: "#847d72" }}
                  aria-label={`Remove ${inv.email}`}
                >
                  ×
                </button>
              </div>
            ))}
            {invites.length === 0 && (
              <div className="py-3 text-center text-[12.5px]" style={{ color: "#6f685e" }}>
                No teammates yet — you can always add them later from Team.
              </div>
            )}
          </div>
        )}

        {/* Step 5 — Download */}
        {step === 5 && (
          <div className="mb-5 space-y-3">
            <Link
              href="/onboarding/download"
              className="flex items-center gap-3 rounded-xl px-4 py-3 transition-colors hover:brightness-110"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: "rgba(255,144,72,0.15)" }}>
                <Download className="h-5 w-5" style={{ color: "#ff9048" }} />
              </div>
              <div className="flex-1">
                <div className="text-[15px] font-semibold" style={{ color: "#f1ede6" }}>Download PresentFlow desktop</div>
                <div className="text-[12.5px]" style={{ color: "#9c958b" }}>Presenting-focused Electron shell — macOS + Windows</div>
              </div>
              <span className="text-[13px]" style={{ color: "#ff9048" }}>Open →</span>
            </Link>
            <div
              className="rounded-xl px-4 py-3 text-[13px]"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "#9c958b" }}
            >
              <div className="mb-1 flex items-center gap-2" style={{ color: "#f1ede6" }}>
                <Rocket className="h-4 w-4" style={{ color: "#ff9048" }} />
                <span className="text-[13px] font-semibold">You&rsquo;re ready</span>
              </div>
              Everything you set up here shows up in the dashboard: songs, team, branding. You can revisit any step later from the sidebar.
            </div>
          </div>
        )}

        {/* Navigation row */}
        <div className="flex gap-3">
          {canBack && (
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="flex-none cursor-pointer rounded-xl px-5 py-3.5 font-display text-[15px] font-semibold"
              style={{
                border: "1px solid rgba(255,255,255,0.14)",
                background: "transparent",
                color: "#c4bcaf",
              }}
            >
              Back
            </button>
          )}
          {step === 0 && (
            <button type="button" onClick={() => setStep(1)} className={authCtaCls} style={authCtaStyle}>
              Get started →
            </button>
          )}
          {step === 1 && (
            <button
              type="button"
              onClick={submitProfile}
              disabled={pending || !churchName.trim()}
              className={authCtaCls}
              style={authCtaStyle}
            >
              {pending ? "Saving…" : "Continue"}
            </button>
          )}
          {step === 2 && (
            <button type="button" onClick={() => setStep(3)} className={authCtaCls} style={authCtaStyle}>
              Continue
            </button>
          )}
          {step === 3 && (
            <button
              type="button"
              onClick={() => setStep(4)}
              disabled={!importChoice}
              className={authCtaCls}
              style={authCtaStyle}
            >
              Continue
            </button>
          )}
          {step === 4 && (
            <button
              type="button"
              onClick={submitInvites}
              disabled={pending}
              className={authCtaCls}
              style={authCtaStyle}
            >
              {pending
                ? "Sending…"
                : invites.length > 0
                  ? `Send ${invites.length} invitation${invites.length === 1 ? "" : "s"}`
                  : "Skip for now"}
            </button>
          )}
          {step === 5 && (
            <button
              type="button"
              onClick={finish}
              disabled={pending}
              className={authCtaCls}
              style={authCtaStyle}
            >
              {pending ? "Finishing…" : "Go to dashboard →"}
            </button>
          )}
        </div>
      </div>
    </AuthShell>
  );
}

// Local card for the "Songs" step's three-way pick. Selected state gets an
// orange border + subtle glow to signal the row is the current choice; the
// nested action button (Open wizard / Add to my library) is optional per row
// and stops click propagation so the enclosing card selection doesn't fight
// the action's own click handler.
function ImportOptionCard({
  icon,
  title,
  desc,
  selected,
  action,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  selected: boolean;
  action?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full cursor-pointer rounded-xl px-4 py-3.5 text-left transition-all"
      style={{
        background: selected ? "rgba(255,144,72,0.10)" : "rgba(255,255,255,0.03)",
        border: selected ? "1px solid rgba(255,144,72,0.55)" : "1px solid rgba(255,255,255,0.08)",
        boxShadow: selected ? "0 8px 26px rgba(255,122,44,0.22)" : "none",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ background: "rgba(255,144,72,0.14)", color: "#ff9048" }}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-semibold" style={{ color: "#f1ede6" }}>{title}</div>
          <div className="mt-0.5 text-[12.5px] leading-[1.45]" style={{ color: "#948d83" }}>{desc}</div>
        </div>
        {action ? <div className="shrink-0" onClick={(e) => e.stopPropagation()}>{action}</div> : null}
      </div>
    </button>
  );
}

