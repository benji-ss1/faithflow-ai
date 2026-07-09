"use client";
import { useState } from "react";
import { Image as ImageIcon, Sun, Timer, MessageSquare, Type, Layers, Volume2, Upload, Square, XCircle, Radio, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import type { ExpandedItem } from "@/lib/server/services";

type TrayTab = "media" | "logos" | "timers" | "messages" | "lower_thirds" | "backgrounds" | "audio" | "recent";

const TABS: { key: TrayTab; label: string; icon: typeof ImageIcon }[] = [
  { key: "media",        label: "Media",         icon: ImageIcon },
  { key: "logos",        label: "Logos",         icon: Sun },
  { key: "timers",       label: "Timers",        icon: Timer },
  { key: "messages",     label: "Messages",      icon: MessageSquare },
  { key: "lower_thirds", label: "Lower Thirds",  icon: Type },
  { key: "backgrounds",  label: "Backgrounds",   icon: Layers },
  { key: "audio",        label: "Audio",         icon: Volume2 },
  { key: "recent",       label: "Recent Imports",icon: Upload },
];

export function BottomTray({
  activeItem, activeSlideIdx, onJumpSlide,
  onSendPreview, onBlank, onLogo, onKill, onClearSlide, onClearMedia, onClearLowerThird, onStageMessage,
  autopilotOn,
}: {
  activeItem: ExpandedItem | undefined;
  activeSlideIdx: number;
  onJumpSlide: (s: number) => void;
  onSendPreview: () => void;
  onBlank: () => void;
  onLogo: () => void;
  onKill: () => void;
  onClearSlide: () => void;
  onClearMedia: () => void;
  onClearLowerThird: () => void;
  onStageMessage: () => void;
  autopilotOn: boolean;
}) {
  const [tab, setTab] = useState<TrayTab>("media");
  const [open, setOpen] = useState(true);

  return (
    <div className="shrink-0 border-t flex flex-col" style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}>
      {/* Safety control bar — always visible */}
      <div className="h-14 shrink-0 flex items-center gap-1.5 px-3 border-b" style={{ borderColor: "var(--color-border)" }}>
        <SafetyButton onClick={onSendPreview} tone="brand" label="Send to Live" hint="Push Preview to the audience projector">
          <span className="text-base">⏎</span>
        </SafetyButton>
        <div className="w-px h-8 mx-1" style={{ background: "var(--color-border)" }} />
        <SafetyButton onClick={onBlank} tone="neutral" label="Blank" hint="Black the screen"><Square className="w-4 h-4" /></SafetyButton>
        <SafetyButton onClick={onLogo} tone="neutral" label="Logo"><Sun className="w-4 h-4" /></SafetyButton>
        <SafetyButton onClick={onKill} tone="danger" label="Kill Output" hint="Immediately clear Live"><XCircle className="w-4 h-4" /></SafetyButton>
        <div className="w-px h-8 mx-1" style={{ background: "var(--color-border)" }} />
        <SafetyButton onClick={onClearSlide}      tone="ghost" label="Clear Slide" small />
        <SafetyButton onClick={onClearMedia}      tone="ghost" label="Clear Media" small />
        <SafetyButton onClick={onClearLowerThird} tone="ghost" label="Clear Lower Third" small />
        <SafetyButton onClick={onStageMessage}    tone="ghost" label="Stage Message" small icon={<MessageSquare className="w-3 h-3" />} />

        <div className="ml-auto flex items-center gap-2">
          {autopilotOn && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[color:var(--color-warning)]">
              <Sparkles className="w-3 h-3" /> Autopilot on
            </span>
          )}
          <button onClick={() => setOpen((v) => !v)}
            className="h-8 px-2 rounded-md text-[10px] font-semibold text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-raised-shell)]">
            {open ? "Hide tray" : "Show tray"}
          </button>
        </div>
      </div>

      {/* Tab strip */}
      {open && (
        <>
          <div className="h-9 shrink-0 flex items-center gap-0.5 px-2 border-b overflow-x-auto"
            style={{ borderColor: "var(--color-border)" }}>
            {TABS.map(({ key, label, icon: Icon }) => {
              const active = tab === key;
              return (
                <button key={key} onClick={() => setTab(key)}
                  className={cn(
                    "h-7 px-2.5 rounded-md text-[11px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors",
                    active
                      ? "bg-[color:var(--color-elevated)] text-[color:var(--color-foreground)]"
                      : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-raised-shell)]",
                  )}>
                  <Icon className="w-3 h-3" strokeWidth={active ? 2 : 1.75} /> {label}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className="h-40 overflow-y-auto">
            {tab === "media"        && <SlideStrip activeItem={activeItem} activeSlideIdx={activeSlideIdx} onJumpSlide={onJumpSlide} />}
            {tab === "logos"        && <TrayStub label="Logo library" hint="Church logo variants + branding. Set primary logo in Settings → Display." />}
            {tab === "timers"       && <TrayStub label="Countdowns" hint="Service starts in 5:00, Offering countdown, etc. Fires on Stage Display + Livestream lower third." />}
            {tab === "messages"     && <TrayStub label="Stage messages" hint="Send text-only messages to the platform team via Stage Display." />}
            {tab === "lower_thirds" && <TrayStub label="Lower thirds" hint="Speaker + scripture overlays for the livestream." />}
            {tab === "backgrounds"  && <TrayStub label="Backgrounds" hint="Full-screen motion + still backgrounds for song/scripture slides." />}
            {tab === "audio"        && <TrayStub label="Audio cues" hint="Playback tracks, stings, and audio bed control. Requires wiring in a later phase." />}
            {tab === "recent"       && <TrayStub label="Recent imports" hint="Everything you've imported in this session." />}
          </div>
        </>
      )}
    </div>
  );
}

function SlideStrip({ activeItem, activeSlideIdx, onJumpSlide }: {
  activeItem: ExpandedItem | undefined; activeSlideIdx: number; onJumpSlide: (s: number) => void;
}) {
  if (!activeItem || activeItem.slides.length === 0) {
    return <div className="p-4 text-xs text-[color:var(--color-muted-foreground)]">No slides in the current item.</div>;
  }
  return (
    <div className="px-3 py-3 flex gap-2 overflow-x-auto">
      {activeItem.slides.map((s, i) => (
        <button key={i} onClick={() => onJumpSlide(i)}
          className={cn(
            "shrink-0 w-40 aspect-video rounded-sm overflow-hidden border-2 transition-colors relative",
            activeSlideIdx === i
              ? "border-[color:var(--color-brand)]"
              : "border-[color:var(--color-border)] hover:border-[color:var(--color-muted-foreground)]",
          )}>
          <div className="absolute inset-0 pointer-events-none">
            <SlideRenderer slide={s} />
          </div>
          <div className="absolute top-1 left-1 bg-black/70 text-white text-[10px] font-mono px-1 rounded-sm">{i + 1}</div>
        </button>
      ))}
    </div>
  );
}

function TrayStub({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="p-4 flex items-start gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        <p className="text-xs text-[color:var(--color-muted-foreground)] mt-1 leading-relaxed">{hint}</p>
      </div>
    </div>
  );
}

function SafetyButton({ onClick, label, tone, hint, small, children, icon }: {
  onClick: () => void;
  label: string;
  tone: "brand" | "neutral" | "danger" | "ghost";
  hint?: string;
  small?: boolean;
  children?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  const base = "inline-flex items-center gap-1.5 font-bold uppercase tracking-wider transition-colors active:scale-[0.98] whitespace-nowrap";
  const size = small ? "h-8 px-2.5 rounded-md text-[10px]" : "h-10 px-4 rounded-md text-xs";
  const tones: Record<typeof tone, string> = {
    brand:   "bg-[color:var(--color-brand)] text-[color:var(--color-app-bg)] hover:opacity-90",
    neutral: "border border-[color:var(--color-border)] text-[color:var(--color-foreground)] bg-[color:var(--color-raised-shell)] hover:bg-[color:var(--color-elevated)]",
    danger:  "border-2 border-[color:var(--color-destructive)] text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive)]/10",
    ghost:   "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-raised-shell)] hover:text-[color:var(--color-foreground)]",
  } as const;
  return (
    <button onClick={onClick} title={hint || label}
      className={cn(base, size, tones[tone])}>
      {icon}
      {children}
      <span>{label}</span>
    </button>
  );
}
