"use client";
import { useEffect, useState } from "react";
import {
  Monitor, MessageSquare, Package, Volume2, Layers, Sparkles, Radio, Activity,
  Trash2, ChevronDown, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { AIAssistantPanel } from "../AIAssistantPanel";
import { SuggestionHistory } from "../SuggestionHistory";
import { isVerseLikelyMisheard, getChapterVerseCount } from "@/lib/bible-chapter-verses";
import type { OperatorShellCtx, InspectorTab } from "./types";

const TABS: { key: InspectorTab; label: string; icon: typeof Monitor }[] = [
  { key: "output",   label: "Output",   icon: Monitor },
  { key: "messages", label: "Messages", icon: MessageSquare },
  { key: "props",    label: "Props",    icon: Package },
  { key: "audio",    label: "Audio",    icon: Volume2 },
  { key: "layers",   label: "Layers",   icon: Layers },
  { key: "ai",       label: "AI",       icon: Sparkles },
  { key: "stage",    label: "Stage",    icon: Radio },
  { key: "status",   label: "Status",   icon: Activity },
];

const TAB_KEY = "faithflow.inspector.tab";

export function RightInspector({ ctx, tab, onTabChange }: {
  ctx: OperatorShellCtx;
  tab: InspectorTab;
  onTabChange: (t: InspectorTab) => void;
}) {
  return (
    <aside className="w-72 shrink-0 flex flex-col border-l min-h-0"
      style={{ borderColor: "#2a3232", background: "#1e2525" }}>
      {/* Mini live monitor */}
      <div className="shrink-0 p-2 border-b" style={{ borderColor: "#2a3232" }}>
        <div className="aspect-video w-full rounded-md overflow-hidden border relative"
          style={{ borderColor: "#2a3232", background: "#000" }}>
          <SlideRenderer slide={ctx.liveSlide} />
          <span className={cn(
            "absolute top-1 left-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm",
            ctx.liveSlide.kind !== "empty"
              ? "bg-red-500/80 text-white"
              : "bg-zinc-800/80 text-zinc-400",
          )}>
            {ctx.liveSlide.kind !== "empty" ? "Live" : "Off-Air"}
          </span>
        </div>
      </div>

      {/* Tab strip */}
      <div className="shrink-0 border-b flex items-center gap-0 px-1 overflow-x-auto" style={{ borderColor: "#2a3232" }}>
        {TABS.map(({ key, label, icon: Icon }) => {
          const on = tab === key;
          return (
            <button key={key} title={label} onClick={() => onTabChange(key)}
              className={cn(
                "h-8 px-2 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider shrink-0 border-b-2",
                on ? "border-teal-400 text-teal-200" : "border-transparent text-zinc-400 hover:text-zinc-100",
              )}>
              <Icon className="w-3 h-3" />
              <span className="hidden 2xl:inline">{label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === "output"   && <OutputTab ctx={ctx} />}
        {tab === "messages" && <MessagesTab ctx={ctx} />}
        {tab === "props"    && <PropsTab />}
        {tab === "audio"    && <AudioTab ctx={ctx} />}
        {tab === "layers"   && <LayersTab ctx={ctx} />}
        {tab === "ai"       && <AITab ctx={ctx} />}
        {tab === "stage"    && <StageTab ctx={ctx} />}
        {tab === "status"   && <StatusTab ctx={ctx} />}
      </div>
    </aside>
  );
}

// ------------------------- Tabs -------------------------

function OutputTab({ ctx }: { ctx: OperatorShellCtx }) {
  const item = ctx.plan.items[ctx.liveItemIdx >= 0 ? ctx.liveItemIdx : ctx.previewItemIdx];
  return (
    <div className="p-3 space-y-3">
      <Section label="Live item">
        <div className="text-[12px] font-medium text-zinc-200 truncate">{item?.title || "—"}</div>
        <div className="text-[10px] font-mono text-zinc-500">Slide {ctx.previewSlideIdx + 1} / {item?.slides.length ?? 0}</div>
      </Section>

      <Section label="Aspect ratio">
        <SegPill<"16:9" | "4:3" | "custom">
          value={ctx.aspectRatio}
          onChange={ctx.onAspectChange}
          options={[
            { key: "16:9", label: "16:9" },
            { key: "4:3", label: "4:3" },
            { key: "custom", label: "Custom" },
          ]} />
      </Section>

      <Section label="Fit mode">
        <SegPill<"contain" | "fill" | "crop">
          value={ctx.fitMode}
          onChange={ctx.onFitChange}
          options={[
            { key: "contain", label: "Fit" },
            { key: "fill", label: "Fill" },
            { key: "crop", label: "Crop" },
          ]} />
      </Section>

      <Section label="Safe area">
        <button onClick={ctx.onSafeAreaToggle}
          className={cn(
            "h-7 px-2 rounded-md text-[10px] font-bold uppercase tracking-wider border",
            ctx.safeArea
              ? "bg-teal-500/15 border-teal-500/60 text-teal-200"
              : "border-[#2a3232] text-zinc-400 hover:text-zinc-100",
          )}>
          {ctx.safeArea ? "On" : "Off"}
        </button>
      </Section>

      <Section label="Screens">
        <div className="flex flex-col gap-1.5">
          <button onClick={ctx.onOpenProjector}
            className="h-8 px-2 rounded-md border text-[11px] text-zinc-200 hover:bg-white/5 inline-flex items-center gap-2"
            style={{ borderColor: "#2a3232" }}>
            <Monitor className="w-3.5 h-3.5" /> Open projector
          </button>
          <button onClick={ctx.onOpenStage}
            className="h-8 px-2 rounded-md border text-[11px] text-zinc-200 hover:bg-white/5 inline-flex items-center gap-2"
            style={{ borderColor: "#2a3232" }}>
            <Radio className="w-3.5 h-3.5" /> Open stage display
          </button>
          <button onClick={ctx.onOpenStream}
            className="h-8 px-2 rounded-md border text-[11px] text-zinc-200 hover:bg-white/5 inline-flex items-center gap-2"
            style={{ borderColor: "#2a3232" }}>
            <Radio className="w-3.5 h-3.5" /> Open livestream
          </button>
        </div>
      </Section>
    </div>
  );
}

function MessagesTab({ ctx }: { ctx: OperatorShellCtx }) {
  const [l1, setL1] = useState("");
  const [l2, setL2] = useState("");
  return (
    <div className="p-3 space-y-3">
      <Section label="Stage message / Lower third">
        <input value={l1} onChange={(e) => setL1(e.target.value)} placeholder="Line 1 (name)"
          className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 placeholder:text-zinc-500 border focus:outline-none"
          style={{ background: "#1a2020", borderColor: "#2a3232" }} />
        <input value={l2} onChange={(e) => setL2(e.target.value)} placeholder="Line 2 (role / subtitle)"
          className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 placeholder:text-zinc-500 border focus:outline-none mt-2"
          style={{ background: "#1a2020", borderColor: "#2a3232" }} />
        <div className="flex items-center gap-2 mt-2">
          <button onClick={() => { ctx.onSendLowerThird(l1, l2); }}
            disabled={!l1 && !l2}
            className="h-8 px-3 rounded-md bg-teal-500/20 border border-teal-500/60 text-teal-200 text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">
            Send
          </button>
          <button onClick={() => { setL1(""); setL2(""); ctx.onClearLowerThird(); }}
            className="h-8 px-3 rounded-md border text-[11px] text-zinc-300 hover:bg-white/5"
            style={{ borderColor: "#2a3232" }}>
            Clear
          </button>
        </div>
      </Section>
      <p className="text-[10px] text-zinc-500 italic px-1">
        Coming next: presets, timed auto-clear, per-speaker templates.
      </p>
    </div>
  );
}

function PropsTab() {
  return (
    <div className="p-3">
      <Section label="Props / Logos">
        <div className="text-[12px] text-zinc-300 font-medium">No church props uploaded yet.</div>
        <p className="text-[11px] text-zinc-500 leading-relaxed mt-1">
          Upload logos and overlays from Settings → Display, then click one here to broadcast it.
        </p>
        <ul className="text-[10px] text-zinc-500 mt-2 space-y-0.5 list-disc pl-4">
          <li>Logo swap-in</li>
          <li>Sponsor / event overlays</li>
          <li>QR codes for offering</li>
        </ul>
      </Section>
    </div>
  );
}

function AudioTab({ ctx }: { ctx: OperatorShellCtx }) {
  const meter = Math.min(1, ctx.audio.chunksSent % 20 / 20);
  return (
    <div className="p-3 space-y-3">
      <Section label="Listening">
        <div className="flex items-center gap-2 text-[11px]">
          <span className={cn("w-2 h-2 rounded-full", ctx.audio.listening ? "bg-emerald-400 animate-pulse" : "bg-zinc-600")} />
          <span className="text-zinc-200">{ctx.audio.listening ? "Streaming" : "Idle"}</span>
          <button onClick={ctx.onListenToggle}
            className="ml-auto h-6 px-2 rounded-md border text-[10px] font-bold uppercase tracking-wider text-zinc-300"
            style={{ borderColor: "#2a3232" }}>
            {ctx.audio.listening ? "Stop" : "Start"}
          </button>
        </div>
      </Section>
      <Section label="Device">
        <div className="text-[11px] text-zinc-400">System default (readonly)</div>
      </Section>
      <Section label="Input level">
        <div className="h-2 rounded-full overflow-hidden" style={{ background: "#1a2020" }}>
          <div className="h-full bg-emerald-400/70 transition-all"
            style={{ width: ctx.audio.listening ? `${20 + meter * 60}%` : "0%" }} />
        </div>
        <div className="text-[10px] font-mono text-zinc-500 mt-1">
          Chunks {ctx.audio.chunksSent} · DG msgs {ctx.audio.dgMessagesReceived}
        </div>
      </Section>
      <Section label="Audio bed">
        <div className="text-[11px] text-zinc-400">Not wired.</div>
        <ul className="text-[10px] text-zinc-500 mt-1 space-y-0.5 list-disc pl-4">
          <li>Underscore beds</li>
          <li>Cue markers</li>
          <li>Fade-out on live change</li>
        </ul>
      </Section>
    </div>
  );
}

function LayersTab({ ctx }: { ctx: OperatorShellCtx }) {
  const rows = [
    { label: "Slide",       kind: ctx.liveSlide.kind !== "empty" ? "Active" : "Empty", clear: ctx.onClearSlide },
    { label: "Media",       kind: "None", clear: ctx.onClearMedia },
    { label: "Lower Third", kind: "None", clear: ctx.onClearLowerThird },
    { label: "Props",       kind: "None", clear: () => { /* noop */ } },
  ];
  return (
    <div className="p-3 space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 h-9 px-2 rounded-md border"
          style={{ borderColor: "#2a3232", background: "#1a2020" }}>
          <span className="text-[11px] font-medium text-zinc-200 flex-1">{r.label}</span>
          <span className="text-[10px] font-mono text-zinc-500">{r.kind}</span>
          <button onClick={r.clear}
            title={`Clear ${r.label}`}
            className="h-6 px-2 rounded-md text-[10px] font-bold uppercase tracking-wider text-red-300 border border-red-500/40 hover:bg-red-500/10">
            Clear
          </button>
        </div>
      ))}
    </div>
  );
}

function AITab({ ctx }: { ctx: OperatorShellCtx }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  // Filter out verse-mis-heard detections from Approve/Send visibility handled
  // inside AIAssistantPanel via detections list, but the note is here.
  const misheardNotes = ctx.audio.detections
    .filter((d) => isVerseLikelyMisheard(d.book, d.chapter, d.verseStart))
    .map((d) => ({
      id: d.id,
      ref: `${d.book} ${d.chapter}:${d.verseStart}`,
      max: getChapterVerseCount(d.book, d.chapter) ?? 0,
    }));

  return (
    <div className="flex flex-col">
      {misheardNotes.length > 0 && (
        <div className="mx-3 mt-3 p-2 rounded-md border border-amber-500/40 bg-amber-500/5">
          <div className="text-[10px] uppercase tracking-[0.16em] text-amber-300 mb-1">Verse guard</div>
          <ul className="text-[11px] text-amber-200 italic space-y-0.5">
            {misheardNotes.map((n) => (
              <li key={n.id}>Reference likely mis-heard: {n.ref} (chapter has only {n.max} verses)</li>
            ))}
          </ul>
        </div>
      )}

      <AIAssistantPanel
        audio={ctx.audio}
        onApprove={(d) => {
          if (isVerseLikelyMisheard(d.book, d.chapter, d.verseStart)) return; // guard blocks Preview/Send
          ctx.onApproveDetection(d);
        }}
        onReject={ctx.onRejectDetection}
        onApproveSong={ctx.onApproveSong}
        onRejectSong={ctx.onRejectSong}
        onApproveCommand={ctx.onApproveCommand}
        onRejectCommand={ctx.onRejectCommand}
        confidenceThreshold={ctx.confidenceThreshold}
        bank={ctx.bank}
        currentBankIdx={ctx.currentBankIdx}
        onRecall={ctx.onRecallBanked}
        autoApproveOn={ctx.autoApproveOn}
        onEditSong={ctx.onEditSong}
        onEditCommand={ctx.onEditCommand}
        bibleSourceLabel={`Bible ${ctx.defaultTranslationCode.toUpperCase()}`}
        onSimulate={ctx.onSimulate}
        onPreviewUnified={ctx.onPreviewUnified}
        onSendLiveUnified={ctx.onSendLiveUnified}
        onQueueUnified={ctx.onQueueUnified}
        onRejectUnified={ctx.onRejectUnified}
        onImportSong={ctx.onImportSong}
        internetMatches={ctx.internetMatches}
        onInternetSearchLibrary={ctx.onInternetSearchLibrary}
        onInternetImport={ctx.onInternetImport}
        onInternetCreateDraft={ctx.onInternetCreateDraft}
        onInternetReject={ctx.onInternetReject}
      />

      <div className="border-t px-3 py-2" style={{ borderColor: "#2a3232" }}>
        <button onClick={() => setHistoryOpen((v) => !v)}
          className="w-full flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-zinc-400 hover:text-zinc-100">
          {historyOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Suggestion history
        </button>
        {historyOpen && (
          <div className="mt-2 max-h-64 overflow-y-auto">
            <SuggestionHistory planId={ctx.planId} refreshKey={ctx.historyKey} />
          </div>
        )}
      </div>
    </div>
  );
}

function StageTab({ ctx }: { ctx: OperatorShellCtx }) {
  const remaining = ctx.countdownEndsAt ? Math.max(0, Math.round((ctx.countdownEndsAt - Date.now()) / 1000)) : null;
  const nextItem = ctx.plan.items[ctx.previewItemIdx + 1];
  return (
    <div className="p-3 space-y-3">
      <Section label="Stage preview">
        <div className="aspect-video rounded-md overflow-hidden border" style={{ borderColor: "#2a3232", background: "#000" }}>
          <iframe src="/stage" title="Stage" className="w-full h-full" />
        </div>
        <button onClick={ctx.onOpenStage}
          className="mt-2 w-full h-8 rounded-md border text-[11px] text-zinc-200 hover:bg-white/5"
          style={{ borderColor: "#2a3232" }}>
          Pop out stage display
        </button>
      </Section>
      <Section label="Up next">
        <div className="text-[12px] text-zinc-200 truncate">{nextItem?.title || "End of service"}</div>
      </Section>
      <Section label="Countdown">
        <div className="text-[16px] font-mono text-teal-200">
          {remaining !== null ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : "—"}
        </div>
        <div className="flex gap-1.5 mt-2">
          {[300, 600, 900].map((s) => (
            <button key={s} onClick={() => ctx.onStartCountdown(s)}
              className="h-7 px-2 rounded-md border text-[10px] font-bold text-zinc-300 hover:bg-white/5"
              style={{ borderColor: "#2a3232" }}>
              {s / 60}m
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

function StatusTab({ ctx }: { ctx: OperatorShellCtx }) {
  const rows = [
    { label: "Projector",       ok: true },
    { label: "Stage display",   ok: true },
    { label: "Livestream",      ok: true },
    { label: "Audio pipeline",  ok: ctx.audio.listening },
    { label: "Transcription",   ok: ctx.audio.stage === "receiving_final" || ctx.audio.stage === "receiving_interim" },
  ];
  return (
    <div className="p-3 space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 h-8 px-2 rounded-md border"
          style={{ borderColor: "#2a3232", background: "#1a2020" }}>
          <span className={cn("w-2 h-2 rounded-full", r.ok ? "bg-emerald-400" : "bg-zinc-600")} />
          <span className="text-[11px] text-zinc-200 flex-1">{r.label}</span>
          <span className="text-[10px] font-mono text-zinc-500">{r.ok ? "OK" : "IDLE"}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------- Utilities -------------------------

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function SegPill<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { key: T; label: string }[];
}) {
  return (
    <div className="inline-flex items-center rounded-md border" style={{ borderColor: "#2a3232" }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button key={o.key} onClick={() => onChange(o.key)}
            className={cn(
              "h-7 px-2.5 text-[10px] font-bold uppercase tracking-wider border-r last:border-r-0",
              on ? "bg-teal-500/15 text-teal-200" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100",
            )}
            style={{ borderColor: "#2a3232" }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function useInspectorTab(): [InspectorTab, (t: InspectorTab) => void] {
  // Always init to "output" so SSR + first client render match. Hydrate from
  // localStorage in a post-mount effect to avoid hydration mismatch.
  const [tab, setTab] = useState<InspectorTab>("output");
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TAB_KEY);
      if (raw && TABS.some((t) => t.key === raw)) setTab(raw as InspectorTab);
    } catch { /* noop */ }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { window.localStorage.setItem(TAB_KEY, tab); } catch { /* noop */ }
  }, [tab, hydrated]);
  return [tab, setTab];
}
