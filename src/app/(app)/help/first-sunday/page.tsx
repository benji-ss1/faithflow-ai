import Link from "next/link";
import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Monitor, Mic, Radio, Clock, Play, AlertTriangle, Archive,
  Zap, ShieldAlert, PanelTop, MoveRight, PlayCircle,
} from "lucide-react";

/**
 * First Sunday playbook — the volunteer-facing operational manual.
 *
 * Structured by WHEN the volunteer needs it:
 *   - Before Sunday (setup, practice)
 *   - 15 min before service (pre-flight checklist)
 *   - During service (transport, panic buttons, autopilot modes)
 *   - Recovery (what to click when something breaks)
 *   - After service (archive)
 *
 * Every section leaves a placeholder slot for an AI-generated video walkthrough
 * (video prop coming later via Claude Design). Text works standalone today.
 */
export default async function FirstSundayPage() {
  await requireUser();
  return (
    <div className="space-y-8 max-w-4xl">
      <PageHeader
        eyebrow="Help"
        title="First Sunday playbook"
        description="Everything a volunteer needs to run FaithFlow through a real service — even if they've never used church production software."
      />

      <Callout>
        <strong>New to FaithFlow?</strong> Skim this once end-to-end. Then bookmark it — during
        Sunday morning you'll want to jump straight to the section you need.
      </Callout>

      <Section id="before" title="Before Sunday — one-time setup" icon={PanelTop}>
        <p>Two wizards; run each once per venue. They take about 3 minutes together and remember your preferences.</p>
        <ul className="space-y-2 mt-3">
          <li>
            <Link href="/setup/projector" className="text-brand underline">Projector setup wizard →</Link>
            <span className="text-muted-foreground"> Verifies the projector is on an extended display, sends a test pattern, teaches you the fullscreen shortcut.</span>
          </li>
          <li>
            <Link href="/setup/audio" className="text-brand underline">Microphone / mixer setup →</Link>
            <span className="text-muted-foreground"> Picks the right audio input, meters the signal, records a 3-second test clip.</span>
          </li>
          <li>
            <Link href="/setup/diagnostics" className="text-brand underline">Install diagnostics →</Link>
            <span className="text-muted-foreground"> One-shot health check across DB / storage / AI / audio bridge.</span>
          </li>
        </ul>
        <VideoSlot label="AI walkthrough: setup wizards" />
      </Section>

      <Section id="practice" title="Practice Mode — run a fake service anytime" icon={Play}>
        <p>
          <Link href="/practice" className="text-brand underline">/practice</Link> is a sandbox: real operator UI, simulated audio,
          zero risk to real service data or the projector. Great for volunteer training.
        </p>
        <p className="text-sm text-muted-foreground">
          Pick a preset transcript (Sunday morning, Wednesday small group, Baptism), or paste a custom one, and
          FaithFlow feeds it through the identical detection pipeline as real audio. You can approve, edit,
          reject — nothing broadcasts.
        </p>
      </Section>

      <Section id="preflight" title="15 minutes before the service" icon={Clock}>
        <p>The volunteer's pre-flight checklist. Do these in order:</p>
        <Checklist items={[
          "Log in as your church operator.",
          "Open your service plan for today (Services → click the plan title).",
          "Click Operate. The operator console opens.",
          "In the top toolbar click Open Projector. A projector window opens.",
          "Drag that window onto the projector display, press F for fullscreen.",
          "Test SEND TO LIVE with the first slide of the plan. Confirm it shows on the wall.",
          "Test BLANK — projector should go dark. Then bring the slide back.",
          "In the AI tab (right inspector), pick your audio device from the Simulate section if you want to demo AI. For real audio: flip AI Listening ON in the top bar and speak.",
          "Verify the input meter jumps (green = signal). If it doesn't, run the Audio setup wizard again.",
        ]} />
        <VideoSlot label="AI walkthrough: pre-flight" />
      </Section>

      <Section id="during" title="During the service — transport controls" icon={Radio}>
        <p>Every control has a keyboard shortcut. Learn these three first:</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
          <ShortcutCard k="Space" label="Next slide" />
          <ShortcutCard k="←" label="Previous slide" />
          <ShortcutCard k="B" label="Blank the projector (safe)" />
        </div>
        <p className="mt-4">The big orange <strong>SEND TO LIVE</strong> button stages your Preview → the projector. Every slide-navigation happens in Preview first; nothing reaches the projector without you.</p>
      </Section>

      <Section id="panic" title="Panic buttons — never more than one click away" icon={ShieldAlert}>
        <p className="text-sm">Whatever is on the projector, these fix it immediately. All red-outlined:</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <PanicCard title="BLANK" desc="Instant black screen. Congregation sees nothing. Doesn't affect your Preview — you can keep working while the projector is blank." />
          <PanicCard title="LOGO" desc="Instant church logo. Good default 'holding' screen between elements." />
          <PanicCard title="KILL OUTPUT" desc="Nuke everything: slides, media, lower thirds. Projector becomes an empty black frame. Use this if audio and video are stuck and you need a hard reset." />
          <PanicCard title="CLEAR SLIDE / MEDIA / LOWER THIRD" desc="Surgical: clear one layer, keep the others. If a scripture verse got stuck, Clear Slide keeps your song lyrics running." />
        </div>
      </Section>

      <Section id="autopilot" title="Autopilot modes — what each one means" icon={Zap}>
        <p>The top toolbar has a pill switcher: <strong>Manual · Suggestion · Armed · Active</strong>. Volunteers get confused here. Here's the plain-English version:</p>
        <div className="space-y-2 mt-3">
          <ModeCard label="Manual" desc="AI turned off entirely. No suggestions. You click everything. Use during silent moments (offering, communion)." />
          <ModeCard label="Suggestion" desc="Default. AI detects scripture / songs / commands and shows cards. You approve each one manually. Nothing reaches Preview or Live without you." />
          <ModeCard label="Armed" desc="Autopilot loaded but not firing. Shows you what would auto-approve if you flipped to Active. Use this to build trust before going fully hands-off." />
          <ModeCard label="Active" desc="Only high-confidence scripture detections auto-stage to Preview. You still send to Live. Song content never auto-projects (copyright safety). Requires confirmation and re-arms after every reload." />
        </div>
        <Callout>
          <strong>Safety principle:</strong> songs never auto-project regardless of mode. Bible verses only auto-stage if confidence is above your threshold AND the translation is public-domain (KJV/WEB).
        </Callout>
      </Section>

      <Section id="recovery" title="Recovery — 'something broke, what do I click'" icon={AlertTriangle}>
        <Recovery
          symptom="Projector went black and won't come back"
          fix="Top toolbar → SEND TO LIVE. If that doesn't work, click LOGO. If STILL nothing, the projector window may have crashed — re-open /live in a new tab, drag to projector, fullscreen."
        />
        <Recovery
          symptom="AI stopped listening mid-service"
          fix="The client auto-reconnects on transient WebSocket drops (up to 8 attempts, exponential backoff). If the pill still shows a persistent error, flip AI Listening OFF then ON, then check the mic meter — a dead meter means the mixer channel muted or the USB cable dropped; reseat and retry."
        />
        <Recovery
          symptom="Wrong slide is on the projector"
          fix="BLANK first (safety). Then find the right slide in the Center workspace. Then SEND TO LIVE. Never chase a mistake by pressing arrows — BLANK gives you time to think."
        />
        <Recovery
          symptom="AI put a bad Bible reference on Preview"
          fix="Rejection is safe — no one sees Preview but you. Click Reject on the card. The AI history logs it as a false positive."
        />
        <Recovery
          symptom="Operator laptop battery died"
          fix="Any laptop can be an operator: log in, open Services → the plan → Operate. Bookmark this URL: /services. The projector window stays on the projector until you actively close it."
        />
      </Section>

      <Section id="after" title="After the service — archive it" icon={Archive}>
        <p>In the operator top bar (or More menu), click <strong>End service & archive</strong>. FaithFlow scaffolds:</p>
        <ul className="space-y-1 mt-2 list-disc pl-5">
          <li>Full transcript (retained per your privacy setting)</li>
          <li>Scripture list (approved references)</li>
          <li>Slide timeline (which slide went live when)</li>
          <li>Sermon summary placeholder (regenerate anytime)</li>
        </ul>
        <p className="mt-3">Archive lives at <Link href="/archive" className="text-brand underline">/archive</Link>.</p>
      </Section>

      <Section id="tutorial" title="Prefer a 1-1 walkthrough?" icon={PlayCircle}>
        <p>
          The <Link href="/tutorial" className="text-brand underline">gated tutorial</Link> walks you through each channel in turn, unlocking the next
          only when you've confirmed you understand the current one. About 10 minutes.
        </p>
      </Section>

      <div className="border-t border-border pt-6 text-xs text-muted-foreground">
        <p>Missing something? <Link href="/settings" className="underline">Feedback in Settings</Link>. This page is versioned in the codebase — improvements ship every release.</p>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------
// helpers
// -----------------------------------------------------------------

function Section({ id, title, icon: Icon, children }: { id: string; title: string; icon: typeof Monitor; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-16 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-brand" />
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <div className="text-sm leading-relaxed space-y-2 text-foreground">{children}</div>
    </section>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-l-4 border-brand pl-4 py-2 bg-brand/5 text-sm">
      {children}
    </div>
  );
}

function Checklist({ items }: { items: string[] }) {
  return (
    <ol className="space-y-1.5 mt-2 list-decimal pl-5 text-sm">
      {items.map((s, i) => <li key={i}>{s}</li>)}
    </ol>
  );
}

function ShortcutCard({ k, label }: { k: string; label: string }) {
  return (
    <div className="border border-border rounded-md p-3 flex items-center gap-3 bg-card">
      <kbd className="font-mono text-xs bg-muted px-2 py-1 rounded-sm border border-border">{k}</kbd>
      <div className="text-sm">{label}</div>
    </div>
  );
}

function PanicCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="border-l-4 border-destructive pl-3 py-2 bg-destructive/5">
      <div className="text-sm font-bold">{title}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
    </div>
  );
}

function ModeCard({ label, desc }: { label: string; desc: string }) {
  return (
    <div className="border border-border rounded-md p-3 bg-card">
      <div className="text-sm font-semibold">{label}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
    </div>
  );
}

function Recovery({ symptom, fix }: { symptom: string; fix: string }) {
  return (
    <div className="border border-border rounded-md p-3 bg-card mb-2">
      <div className="text-sm font-semibold flex items-start gap-2">
        <MoveRight className="w-4 h-4 mt-0.5 text-warning shrink-0" /> {symptom}
      </div>
      <div className="text-xs text-muted-foreground mt-1 ml-6">{fix}</div>
    </div>
  );
}

function VideoSlot({ label, src, poster }: { label: string; src?: string; poster?: string }) {
  // When we have a real walkthrough clip (AI-generated or hand-recorded),
  // pass `src` to render inline. Falls back to a labelled placeholder so
  // the doc structure holds while content is being produced.
  if (src) {
    return (
      <div className="border border-border rounded-md overflow-hidden bg-black mt-2">
        <video controls preload="metadata" poster={poster} className="w-full max-h-80" aria-label={label}>
          <source src={src} />
        </video>
        <div className="px-3 py-2 text-xs text-muted-foreground bg-card">{label}</div>
      </div>
    );
  }
  return (
    <div className="border border-dashed border-border rounded-md p-3 bg-muted/20 flex items-center gap-2 text-xs text-muted-foreground mt-2">
      <PlayCircle className="w-4 h-4" />
      <div>Video coming soon: <em>{label}</em></div>
    </div>
  );
}
