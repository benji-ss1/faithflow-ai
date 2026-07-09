"use client";
import { useState } from "react";
import Link from "next/link";
import { Timer, Type, Monitor, Radio, FileStack, Archive, Settings, ExternalLink, Play } from "lucide-react";
import type { RailSection } from "./ProductionRail";

/**
 * Workspace shells for rail sections that don't have a dedicated
 * WorkspaceTabs mode yet. Every shell is a polished stand-in — title,
 * one-line description, primary action, and 2-3 "coming next" bullets.
 */

export function TimersShell({ onStartCountdown }: { onStartCountdown: (seconds: number) => void }) {
  const [seconds, setSeconds] = useState(300);
  return (
    <Shell
      icon={<Timer className="w-5 h-5" />}
      title="Countdowns & rehearsal timers"
      description="Broadcast a target time to Stage Display, Livestream, and Live output."
      next={["Multi-timer stacking", "Auto-start on service item boundaries", "Countdown-then-media chains"]}
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {[300, 600, 900].map((s) => (
          <button
            key={s}
            onClick={() => setSeconds(s)}
            className={"h-8 px-3 rounded-md text-[11px] font-semibold border transition-colors " +
              (seconds === s ? "bg-[color:var(--color-brand)]/15 border-[color:var(--color-brand)] text-[color:var(--color-brand)]" : "border-[color:var(--color-border)] hover:bg-[color:var(--color-panel)]")}
          >{Math.round(s / 60)} min</button>
        ))}
        <input
          type="number" min={5} step={5}
          value={seconds}
          onChange={(e) => setSeconds(Math.max(5, Number(e.target.value) || 0))}
          className="h-8 w-24 px-2 rounded-md border text-[11px]"
          style={{ background: "var(--color-panel)", borderColor: "var(--color-border)" }}
        />
        <span className="text-[10px] text-[color:var(--color-muted-foreground)]">seconds</span>
      </div>
      <button
        onClick={() => onStartCountdown(seconds)}
        className="h-10 px-4 rounded-md bg-[color:var(--color-brand)] text-black font-semibold text-[12px] inline-flex items-center gap-2"
      >
        <Play className="w-4 h-4" /> Start countdown
      </button>
    </Shell>
  );
}

export function LowerThirdsShell({ onSend }: { onSend: (l1: string, l2: string) => void }) {
  const [l1, setL1] = useState("");
  const [l2, setL2] = useState("");
  return (
    <Shell
      icon={<Type className="w-5 h-5" />}
      title="Lower thirds"
      description="Broadcast overlay text to Stage Display + Livestream."
      next={["Speaker preset library", "Scripture-triggered auto lower-thirds", "Animations + brand kit"]}
    >
      <label className="block text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-muted-foreground)] mb-1">Line 1</label>
      <input value={l1} onChange={(e) => setL1(e.target.value)} className="h-9 w-full px-2 rounded-md border text-[12px] mb-2" style={{ background: "var(--color-panel)", borderColor: "var(--color-border)" }} />
      <label className="block text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-muted-foreground)] mb-1">Line 2</label>
      <input value={l2} onChange={(e) => setL2(e.target.value)} className="h-9 w-full px-2 rounded-md border text-[12px] mb-3" style={{ background: "var(--color-panel)", borderColor: "var(--color-border)" }} />
      <button
        onClick={() => onSend(l1, l2)}
        disabled={!l1.trim() && !l2.trim()}
        className="h-9 px-3 rounded-md bg-[color:var(--color-brand)] text-black font-semibold text-[11px] disabled:opacity-40"
      >Send lower third</button>
    </Shell>
  );
}

export function StageDisplayShell({ onOpen }: { onOpen: () => void }) {
  return (
    <Shell
      icon={<Monitor className="w-5 h-5" />}
      title="Stage Display Preview"
      description="Confidence monitor for the platform — current slide, next slide, clock, countdown, notes."
      next={["Per-role stage layouts", "Cue-to-cue script mode", "Countdown-only worship mode"]}
    >
      <button onClick={onOpen} className="h-9 px-3 rounded-md border font-semibold text-[11px] inline-flex items-center gap-1.5 mb-3" style={{ borderColor: "var(--color-border)" }}>
        <ExternalLink className="w-3.5 h-3.5" /> Open Stage Display in new window
      </button>
      <div className="aspect-video border rounded-md overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
        <iframe src="/stage" className="w-full h-full" title="Stage Display Preview" />
      </div>
    </Shell>
  );
}

export function LivestreamShell({ onOpen }: { onOpen: () => void }) {
  return (
    <Shell
      icon={<Radio className="w-5 h-5" />}
      title="Livestream Preview"
      description="Broadcast-safe output surface with lower-thirds + scripture chrome."
      next={["OBS browser-source preset", "Scene switcher hooks", "Auto-hide slides during sermon"]}
    >
      <button onClick={onOpen} className="h-9 px-3 rounded-md border font-semibold text-[11px] inline-flex items-center gap-1.5 mb-3" style={{ borderColor: "var(--color-border)" }}>
        <ExternalLink className="w-3.5 h-3.5" /> Open Livestream in new window
      </button>
      <div className="aspect-video border rounded-md overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
        <iframe src="/livestream" className="w-full h-full" title="Livestream Preview" />
      </div>
    </Shell>
  );
}

export function ImportsShell() {
  return (
    <Shell
      icon={<FileStack className="w-5 h-5" />}
      title="Imports"
      description="Pending PPTX / ProPresenter / OpenSong / CSV parse jobs and a jump to the full wizard."
      next={["Drag-drop-in-cockpit", "Auto-map to service items", "Batch song intake"]}
    >
      <Link href="/library/imports" className="h-9 px-3 rounded-md border font-semibold text-[11px] inline-flex items-center gap-1.5" style={{ borderColor: "var(--color-border)" }}>
        <ExternalLink className="w-3.5 h-3.5" /> Open Imports library
      </Link>
    </Shell>
  );
}

export function ArchiveShell({ churchArchiveHref }: { churchArchiveHref: string }) {
  return (
    <Shell
      icon={<Archive className="w-5 h-5" />}
      title="Sermon archive"
      description="Past services with AI-scaffolded summaries, transcripts, and slide banks."
      next={["Auto-scaffold on service end", "AI sermon-title suggestions", "Congregation share links"]}
    >
      <Link href={churchArchiveHref} className="h-9 px-3 rounded-md border font-semibold text-[11px] inline-flex items-center gap-1.5" style={{ borderColor: "var(--color-border)" }}>
        <ExternalLink className="w-3.5 h-3.5" /> Open Archive
      </Link>
    </Shell>
  );
}

export function SettingsShell() {
  return (
    <Shell
      icon={<Settings className="w-5 h-5" />}
      title="Church settings"
      description="AI defaults, Bible translation, Autopilot floors, brand kit — all managed church-wide."
      next={["Per-plan overrides", "Role-based rail visibility", "Multi-campus branch settings"]}
    >
      <Link href="/settings" className="h-9 px-3 rounded-md border font-semibold text-[11px] inline-flex items-center gap-1.5" style={{ borderColor: "var(--color-border)" }}>
        <ExternalLink className="w-3.5 h-3.5" /> Open Settings
      </Link>
    </Shell>
  );
}

function Shell({ icon, title, description, next, children }: {
  icon: React.ReactNode; title: string; description: string; next: string[]; children?: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: "var(--color-app-bg)" }}>
      <div className="max-w-xl">
        <div className="flex items-center gap-2 mb-2 text-[color:var(--color-brand)]">{icon}<span className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[color:var(--color-muted-foreground)]">Workspace</span></div>
        <h2 className="text-lg font-semibold mb-1">{title}</h2>
        <p className="text-[12px] text-[color:var(--color-muted-foreground)] mb-4 leading-relaxed">{description}</p>
        <div className="rounded-md border p-4 mb-4" style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}>
          {children}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[color:var(--color-muted-foreground)] mb-1.5">Coming next</div>
          <ul className="space-y-1 text-[11px] text-[color:var(--color-muted-foreground)]">
            {next.map((n, i) => <li key={i} className="flex gap-2"><span className="opacity-40">•</span>{n}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Sections that render a custom shell instead of the WorkspaceTabs modes. */
export const SHELL_SECTIONS: RailSection[] = [
  "timers", "lower_thirds", "stage", "livestream", "imports", "archive", "settings",
];

/** Map a rail section to a WorkspaceTabs mode when the pairing exists. */
export function railSectionToWorkspaceMode(section: RailSection): "flow" | "grid" | "editor" | "bible" | "reflow" | "sermon" | "media" | null {
  switch (section) {
    case "service": return "flow";
    case "songs":   return "reflow";
    case "bible":   return "bible";
    case "sermon":  return "sermon";
    case "media":   return "media";
    default: return null;
  }
}
