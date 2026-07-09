"use client";
import { useState } from "react";
import { Eye, Radio, Monitor, Wifi, WifiOff, Maximize2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import type { SlidePayload } from "@/lib/broadcast";

export type OutputTab = "preview" | "live" | "stage" | "livestream";

const TABS: { key: OutputTab; label: string; icon: typeof Eye; short: string }[] = [
  { key: "preview",    label: "Preview / Staged",     icon: Eye,     short: "PVW" },
  { key: "live",       label: "Live / On Projector",  icon: Radio,   short: "PGM" },
  { key: "stage",      label: "Stage Display",        icon: Monitor, short: "STG" },
  { key: "livestream", label: "Livestream Output",    icon: Wifi,    short: "STR" },
];

export function OutputStack({
  previewSlide, liveSlide,
  previewLabel, liveLabel, previewSlideInfo, liveSlideInfo,
  aspectRatio, fitMode, safeArea,
  onAspectChange, onFitChange, onSafeAreaToggle,
  onOpenProjector, onOpenStage, onOpenStream,
  liveIsLive,
}: {
  previewSlide: SlidePayload;
  liveSlide: SlidePayload;
  previewLabel: string;
  liveLabel: string;
  previewSlideInfo: string;
  liveSlideInfo: string;
  aspectRatio: "16:9" | "4:3" | "custom";
  fitMode: "contain" | "fill" | "crop";
  safeArea: boolean;
  onAspectChange: (a: "16:9" | "4:3" | "custom") => void;
  onFitChange: (f: "contain" | "fill" | "crop") => void;
  onSafeAreaToggle: () => void;
  onOpenProjector: () => void;
  onOpenStage: () => void;
  onOpenStream: () => void;
  liveIsLive: boolean;
}) {
  const [tab, setTab] = useState<OutputTab>("preview");

  return (
    <div className="w-[560px] shrink-0 flex flex-col min-h-0 border-l" style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}>
      {/* Tab strip */}
      <div className="h-10 shrink-0 flex items-center gap-0.5 px-2 border-b" style={{ borderColor: "var(--color-border)" }}>
        {TABS.map(({ key, label, icon: Icon, short }) => {
          const active = tab === key;
          const isLive = key === "live";
          return (
            <button key={key} onClick={() => setTab(key)} title={label}
              className={cn(
                "h-8 px-3 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors relative",
                active
                  ? isLive
                    ? "bg-[color:var(--color-destructive)]/15 text-[color:var(--color-destructive)]"
                    : "bg-[color:var(--color-elevated)] text-[color:var(--color-foreground)]"
                  : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-raised-shell)]",
              )}>
              <Icon className="w-3.5 h-3.5" strokeWidth={active ? 2 : 1.75} />
              <span className="hidden lg:inline">{label}</span>
              <span className="lg:hidden font-mono">{short}</span>
              {isLive && liveIsLive && (
                <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-destructive)] animate-pulse ml-1" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab bodies — Preview + Live are always rendered (state carried by
          the operator console). Stage + Livestream are shell views. */}
      {tab === "preview" && (
        <OutputSurface
          kind="preview"
          slide={previewSlide}
          headerLabel="Preview"
          statusText="Staged"
          statusColor="var(--color-brand)"
          itemLabel={previewLabel}
          slideInfo={previewSlideInfo}
          aspectRatio={aspectRatio}
          safeArea={safeArea}
        />
      )}
      {tab === "live" && (
        <OutputSurface
          kind="live"
          slide={liveSlide}
          headerLabel="Live"
          statusText={liveSlideStatus(liveSlide)}
          statusColor="var(--color-destructive)"
          itemLabel={liveLabel}
          slideInfo={liveSlideInfo}
          aspectRatio={aspectRatio}
          safeArea={safeArea}
        />
      )}
      {tab === "stage" && (
        <StageOutputPlaceholder previewSlide={previewSlide} liveSlide={liveSlide} onOpenStage={onOpenStage} />
      )}
      {tab === "livestream" && (
        <StreamOutputPlaceholder liveSlide={liveSlide} onOpenStream={onOpenStream} />
      )}

      {/* Common output settings + open-window buttons */}
      <OutputSettingsBar
        aspectRatio={aspectRatio} fitMode={fitMode} safeArea={safeArea}
        onAspectChange={onAspectChange} onFitChange={onFitChange} onSafeAreaToggle={onSafeAreaToggle}
        onOpenProjector={onOpenProjector}
        onOpenStage={onOpenStage}
        onOpenStream={onOpenStream}
      />
    </div>
  );
}

function liveSlideStatus(s: SlidePayload): string {
  if (s.kind === "empty") return "Killed";
  if (s.kind === "blank") return "Blanked";
  if (s.kind === "logo") return "Logo";
  return "On Air";
}

function OutputSurface({
  kind, slide, headerLabel, statusText, statusColor,
  itemLabel, slideInfo, aspectRatio, safeArea,
}: {
  kind: "preview" | "live";
  slide: SlidePayload;
  headerLabel: string;
  statusText: string;
  statusColor: string;
  itemLabel: string;
  slideInfo: string;
  aspectRatio: "16:9" | "4:3" | "custom";
  safeArea: boolean;
}) {
  const borderColor = kind === "live" ? "var(--color-destructive)" : "var(--color-brand)";
  return (
    <div className="flex-1 min-h-0 flex flex-col p-3 gap-2">
      <header className="flex items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: statusColor }} />
          <span className="eyebrow" style={{ color: statusColor }}>{headerLabel}</span>
        </span>
        <span className="font-mono text-[10px] text-[color:var(--color-muted-foreground)]">{statusText}</span>
        <span className="ml-auto text-[10px] text-[color:var(--color-muted-foreground)] truncate max-w-[240px]">
          {itemLabel}{slideInfo && <> · {slideInfo}</>}
        </span>
      </header>

      <div className="flex-1 min-h-0 min-w-0 rounded-md overflow-hidden relative"
        style={{
          border: kind === "live" ? `4px solid ${borderColor}` : `1px solid ${borderColor}`,
          background: "#000",
        }}>
        <SlideRenderer slide={slide} />
        {safeArea && (
          <div className="absolute inset-[5%] pointer-events-none border-2 border-dashed border-white/25 rounded-sm" />
        )}
      </div>

      <footer className="flex items-center gap-3 text-[10px] font-mono text-[color:var(--color-muted-foreground)]">
        <span>{aspectRatio}</span>
        <span>1920×1080</span>
        <span className="ml-auto">{slide.kind}</span>
      </footer>
    </div>
  );
}

function StageOutputPlaceholder({ previewSlide, liveSlide, onOpenStage }: {
  previewSlide: SlidePayload; liveSlide: SlidePayload; onOpenStage: () => void;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col p-3 gap-2">
      <header className="flex items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[color:var(--color-brand)]" />
          <span className="eyebrow text-[color:var(--color-brand)]">Stage Display</span>
        </span>
        <span className="font-mono text-[10px] text-[color:var(--color-muted-foreground)]">Confidence monitor</span>
        <button onClick={onOpenStage}
          className="ml-auto h-7 px-2 rounded-sm text-[10px] font-semibold border border-[color:var(--color-border)] hover:bg-[color:var(--color-raised-shell)] inline-flex items-center gap-1">
          <ExternalLink className="w-3 h-3" /> Open window
        </button>
      </header>
      <div className="flex-1 min-h-0 grid grid-cols-2 gap-2 rounded-md overflow-hidden border" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex flex-col bg-black relative min-h-0">
          <div className="absolute top-1.5 left-2 text-[9px] font-mono uppercase tracking-wider text-white/60 z-10">Current</div>
          <SlideRenderer slide={liveSlide} />
        </div>
        <div className="flex flex-col bg-black relative min-h-0">
          <div className="absolute top-1.5 left-2 text-[9px] font-mono uppercase tracking-wider text-white/60 z-10">Next</div>
          <SlideRenderer slide={previewSlide} />
        </div>
      </div>
      <div className="text-[10px] text-[color:var(--color-muted-foreground)] leading-relaxed">
        Route: <code className="font-mono">/stage</code>. Also shows clock, countdown, sermon notes, confidence lyrics.
      </div>
    </div>
  );
}

function StreamOutputPlaceholder({ liveSlide, onOpenStream }: {
  liveSlide: SlidePayload; onOpenStream: () => void;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col p-3 gap-2">
      <header className="flex items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[color:var(--color-warning)]" />
          <span className="eyebrow text-[color:var(--color-warning)]">Livestream</span>
        </span>
        <span className="font-mono text-[10px] text-[color:var(--color-muted-foreground)]">Broadcast surface</span>
        <button onClick={onOpenStream}
          className="ml-auto h-7 px-2 rounded-sm text-[10px] font-semibold border border-[color:var(--color-border)] hover:bg-[color:var(--color-raised-shell)] inline-flex items-center gap-1">
          <ExternalLink className="w-3 h-3" /> Open window
        </button>
      </header>
      <div className="flex-1 min-h-0 rounded-md overflow-hidden border bg-black relative"
        style={{ borderColor: "var(--color-border)" }}>
        <SlideRenderer slide={liveSlide} />
        {/* Lower third placeholder overlay */}
        <div className="absolute bottom-6 left-6 right-6 bg-black/60 border-l-2 border-[color:var(--color-brand)] p-3 opacity-40">
          <div className="text-[9px] font-mono uppercase tracking-wider text-white/60">Lower Third · placeholder</div>
          <div className="text-white text-sm font-semibold">Pastor Name</div>
        </div>
      </div>
      <div className="text-[10px] text-[color:var(--color-muted-foreground)] leading-relaxed">
        Route: <code className="font-mono">/livestream</code>. Configurable overlay: full slide, lower-third scripture, lower-third speaker.
      </div>
    </div>
  );
}

function OutputSettingsBar({
  aspectRatio, fitMode, safeArea,
  onAspectChange, onFitChange, onSafeAreaToggle,
  onOpenProjector, onOpenStage, onOpenStream,
}: {
  aspectRatio: "16:9" | "4:3" | "custom";
  fitMode: "contain" | "fill" | "crop";
  safeArea: boolean;
  onAspectChange: (a: "16:9" | "4:3" | "custom") => void;
  onFitChange: (f: "contain" | "fill" | "crop") => void;
  onSafeAreaToggle: () => void;
  onOpenProjector: () => void;
  onOpenStage: () => void;
  onOpenStream: () => void;
}) {
  return (
    <div className="shrink-0 border-t p-2 flex items-center gap-1.5 flex-wrap"
      style={{ borderColor: "var(--color-border)" }}>
      <SegmentedControl value={aspectRatio} options={[["16:9", "16:9"], ["4:3", "4:3"], ["custom", "Custom"]]} onChange={onAspectChange} />
      <SegmentedControl value={fitMode} options={[["contain", "Fit"], ["fill", "Fill"], ["crop", "Crop"]]} onChange={onFitChange} />
      <button onClick={onSafeAreaToggle}
        className={cn(
          "h-7 px-2 rounded-sm text-[10px] font-semibold border transition-colors",
          safeArea ? "border-[color:var(--color-brand)] text-[color:var(--color-brand)] bg-[color:var(--color-brand)]/10" : "border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-raised-shell)]",
        )}>
        Safe area
      </button>
      <div className="ml-auto flex gap-1.5">
        <button onClick={onOpenProjector} title="Open dedicated audience/projector window"
          className="h-7 px-2 rounded-sm text-[10px] font-semibold border border-[color:var(--color-border)] hover:bg-[color:var(--color-raised-shell)] inline-flex items-center gap-1">
          <Maximize2 className="w-3 h-3" /> Projector
        </button>
        <button onClick={onOpenStage}
          className="h-7 px-2 rounded-sm text-[10px] font-semibold border border-[color:var(--color-border)] hover:bg-[color:var(--color-raised-shell)] inline-flex items-center gap-1">
          <Monitor className="w-3 h-3" /> Stage
        </button>
        <button onClick={onOpenStream}
          className="h-7 px-2 rounded-sm text-[10px] font-semibold border border-[color:var(--color-border)] hover:bg-[color:var(--color-raised-shell)] inline-flex items-center gap-1">
          <Wifi className="w-3 h-3" /> Stream
        </button>
      </div>
    </div>
  );
}

function SegmentedControl<T extends string>({ value, options, onChange }: {
  value: T; options: [T, string][]; onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-sm border overflow-hidden"
      style={{ borderColor: "var(--color-border)" }}>
      {options.map(([v, l], i) => {
        const active = v === value;
        return (
          <button key={v} onClick={() => onChange(v)}
            className={cn(
              "h-7 px-2 text-[10px] font-semibold transition-colors",
              i > 0 && "border-l",
              active ? "bg-[color:var(--color-elevated)] text-[color:var(--color-foreground)]" : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-raised-shell)]",
            )}
            style={i > 0 ? { borderColor: "var(--color-border)" } : undefined}>
            {l}
          </button>
        );
      })}
    </div>
  );
}
