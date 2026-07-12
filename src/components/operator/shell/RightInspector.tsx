"use client";
import { useEffect, useRef, useState } from "react";
import {
  Monitor, MessageSquare, Package, Volume2, Layers, Sparkles, Radio, Activity,
  Trash2, ChevronDown, ChevronRight, Layout, Type as TypeIcon, Square,
  Megaphone, Wand2, Palette,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SlideRenderer } from "@/components/live/SlideRenderer";
import { AIAssistantPanel } from "../AIAssistantPanel";
import { AIHelpersPanel } from "../AIHelpersPanel";
import { SuggestionHistory } from "../SuggestionHistory";
import { isVerseLikelyMisheard, getChapterVerseCount } from "@/lib/bible-chapter-verses";
import type { OperatorShellCtx, InspectorTab } from "./types";
import { useSlideEditorCtx } from "../editor/SlideEditorContext";
import type { SlideObject, TextObject, ShapeObject } from "@/lib/slide-objects";
import { EFFECTS, ensureEffectKeyframes, getEffect, type EffectId, type Effect } from "@/lib/effects";
import type { AnnouncementPayload, AnnouncementPosition, AnnouncementStyle, TransitionSpec } from "@/lib/broadcast";
import {
  createAnnouncement, saveAnnouncementPreset, deleteAnnouncementPreset,
  createTheme, updateTheme, duplicateTheme, deleteTheme, exportTheme, importTheme, applyThemeToSong,
} from "@/lib/actions";
import { toast } from "sonner";

const TABS: { key: InspectorTab; label: string; icon: typeof Monitor }[] = [
  { key: "output",   label: "Output",   icon: Monitor },
  { key: "slide",    label: "Slide",    icon: Layout },
  { key: "text",     label: "Text",     icon: TypeIcon },
  { key: "shape",    label: "Shape",    icon: Square },
  { key: "announce", label: "Announce", icon: Megaphone },
  { key: "effects",  label: "Effects",  icon: Wand2 },
  { key: "theme",    label: "Theme",    icon: Palette },
  { key: "messages", label: "Messages", icon: MessageSquare },
  { key: "props",    label: "Props",    icon: Package },
  { key: "audio",    label: "Audio",    icon: Volume2 },
  { key: "layers",   label: "Layers",   icon: Layers },
  { key: "ai",       label: "AI",       icon: Sparkles },
  { key: "stage",    label: "Stage",    icon: Radio },
  { key: "status",   label: "Status",   icon: Activity },
];

const TAB_KEY = "presentflow.inspector.tab";

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
      <div className="shrink-0 border-b flex items-center gap-0 px-1 overflow-x-auto sticky top-0 z-10" style={{ borderColor: "#2a3232", background: "#1e2525" }}>
        {TABS.map(({ key, label, icon: Icon }) => {
          const on = tab === key;
          return (
            <button key={key} title={label} onClick={() => onTabChange(key)}
              className={cn(
                "h-8 px-2 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider shrink-0 border-b-2 focus-visible:ring-1 focus-visible:ring-teal-400/50 focus-visible:outline-none",
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
        {tab === "slide"    && <SlideTab />}
        {tab === "text"     && <TextTab />}
        {tab === "shape"    && <ShapeTab />}
        {tab === "announce" && <AnnounceTab ctx={ctx} />}
        {tab === "effects"  && <EffectsTab ctx={ctx} />}
        {tab === "theme"    && <ThemeTab ctx={ctx} />}
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

      <AIHelpersPanel />

      <div className="border-t px-3 py-2" style={{ borderColor: "#2a3232" }}>
        <button onClick={() => setHistoryOpen((v) => !v)}
          className="w-full flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-zinc-400 hover:text-zinc-100 focus-visible:ring-1 focus-visible:ring-teal-400/50 focus-visible:outline-none">
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

// ------------------------- Phase 5D editor tabs -------------------------

const SAFE_FONTS = ["Inter", "Helvetica Neue", "Arial", "Georgia", "Times New Roman", "Courier New"];

function SlideTab() {
  const editor = useSlideEditorCtx();
  if (!editor) return <div className="p-3 text-[11px] text-zinc-500">Editor unavailable.</div>;
  if (!editor.currentSlide) {
    return <div className="p-3 text-[11px] text-zinc-500 italic">No slide selected.</div>;
  }
  const slide = editor.currentSlide;
  const disabled = !editor.isEditable;
  return (
    <div className="p-3 space-y-3">
      <Section label="Background color">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={slide.bgColor || "#0b0b0b"}
            onChange={(e) => editor.setBg({ bgColor: e.target.value })}
            disabled={disabled}
            className="h-8 w-12 rounded-md border cursor-pointer disabled:opacity-40"
            style={{ borderColor: "#2a3232", background: "#1a2020" }}
          />
          <input
            type="text"
            value={slide.bgColor || ""}
            placeholder="#0b0b0b"
            onChange={(e) => editor.setBg({ bgColor: e.target.value })}
            disabled={disabled}
            className="flex-1 h-8 px-2 rounded-md text-[12px] text-zinc-100 placeholder:text-zinc-500 border focus:outline-none disabled:opacity-40"
            style={{ background: "#1a2020", borderColor: "#2a3232" }}
          />
        </div>
      </Section>

      <Section label="Background image URL">
        <input
          type="text"
          value={slide.bgImageUrl || ""}
          placeholder="https://…"
          onChange={(e) => editor.setBg({ bgImageUrl: e.target.value || undefined })}
          disabled={disabled}
          className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 placeholder:text-zinc-500 border focus:outline-none disabled:opacity-40"
          style={{ background: "#1a2020", borderColor: "#2a3232" }}
        />
      </Section>

      <Section label="Transition">
        <SlideTransitionPicker
          value={slide.transition ?? null}
          onChange={(t) => editor.updateSlideDirect({ transition: t ?? undefined })}
          disabled={disabled}
        />
      </Section>

      <Section label="Enabled">
        <button
          disabled
          title="Enable / hotkey wiring ships in Run 2"
          className="h-7 px-2 rounded-md border text-[10px] font-bold uppercase tracking-wider opacity-40"
          style={{ borderColor: "#2a3232", background: "#1a2020", color: "#e4e4e7" }}
        >
          On
        </button>
      </Section>

      <Section label="Hotkey">
        <input
          type="text"
          placeholder="e.g. F5"
          disabled
          title="Hotkey wiring ships in Run 2"
          className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 placeholder:text-zinc-500 border focus:outline-none opacity-40"
          style={{ background: "#1a2020", borderColor: "#2a3232" }}
        />
      </Section>

      <Section label="Add object">
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={editor.addTextObject}
            disabled={disabled}
            className="h-7 px-2 rounded-md border text-[10px] font-bold uppercase tracking-wider disabled:opacity-40"
            style={{ borderColor: "#2a3232", background: "#1a2020", color: "#e4e4e7" }}
          >
            + Text
          </button>
          <button
            onClick={() => editor.addShape("rect")}
            disabled={disabled}
            className="h-7 px-2 rounded-md border text-[10px] font-bold uppercase tracking-wider disabled:opacity-40"
            style={{ borderColor: "#2a3232", background: "#1a2020", color: "#e4e4e7" }}
          >
            + Rect
          </button>
          <button
            onClick={() => editor.addShape("ellipse")}
            disabled={disabled}
            className="h-7 px-2 rounded-md border text-[10px] font-bold uppercase tracking-wider disabled:opacity-40"
            style={{ borderColor: "#2a3232", background: "#1a2020", color: "#e4e4e7" }}
          >
            + Ellipse
          </button>
        </div>
      </Section>
    </div>
  );
}

function TextTab() {
  const editor = useSlideEditorCtx();
  if (!editor) return <div className="p-3 text-[11px] text-zinc-500">Editor unavailable.</div>;
  const sel = editor.selectedObjectId
    ? editor.currentSlide?.objects.find((o) => o.id === editor.selectedObjectId)
    : null;
  if (!sel || sel.kind !== "text") {
    return (
      <div className="p-3 text-[11px] text-zinc-500 italic leading-relaxed">
        Select a text object to edit its font, color, alignment and content.
      </div>
    );
  }
  const t = sel as TextObject;
  const patch = (p: Partial<SlideObject>) => editor.updateObject(t.id, p);

  return (
    <div className="p-3 space-y-3">
      <Section label="Text content">
        <textarea
          value={t.text}
          onChange={(e) => patch({ text: e.target.value })}
          rows={4}
          className="w-full px-2 py-1.5 rounded-md text-[12px] text-zinc-100 border focus:outline-none resize-y"
          style={{ background: "#1a2020", borderColor: "#2a3232" }}
        />
      </Section>

      <Section label="Font family">
        <select
          value={t.fontFamily || "Inter"}
          onChange={(e) => patch({ fontFamily: e.target.value })}
          className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none"
          style={{ background: "#1a2020", borderColor: "#2a3232" }}
        >
          {SAFE_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </Section>

      <Section label="Weight">
        <div className="inline-flex items-center rounded-md border" style={{ borderColor: "#2a3232" }}>
          {[400, 500, 600, 700].map((w) => {
            const on = (t.fontWeight ?? 600) === w;
            return (
              <button key={w} onClick={() => patch({ fontWeight: w })}
                className={cn(
                  "h-7 px-2 text-[10px] font-bold border-r last:border-r-0",
                  on ? "bg-teal-500/15 text-teal-200" : "text-zinc-400 hover:text-zinc-100 hover:bg-white/5",
                )}
                style={{ borderColor: "#2a3232" }}>
                {w}
              </button>
            );
          })}
        </div>
      </Section>

      <Section label="Size (px)">
        <input
          type="number"
          min={8}
          value={t.fontSize ?? 96}
          onChange={(e) => patch({ fontSize: Number(e.target.value) || 0 })}
          className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none"
          style={{ background: "#1a2020", borderColor: "#2a3232" }}
        />
      </Section>

      <Section label="Color">
        <div className="flex items-center gap-2">
          <input type="color" value={t.color || "#ffffff"} onChange={(e) => patch({ color: e.target.value })}
            className="h-8 w-12 rounded-md border cursor-pointer"
            style={{ borderColor: "#2a3232", background: "#1a2020" }} />
          <input type="text" value={t.color || ""} onChange={(e) => patch({ color: e.target.value })}
            className="flex-1 h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none"
            style={{ background: "#1a2020", borderColor: "#2a3232" }} />
        </div>
      </Section>

      <Section label="Align">
        <div className="inline-flex items-center rounded-md border" style={{ borderColor: "#2a3232" }}>
          {(["left", "center", "right"] as const).map((a) => {
            const on = (t.align ?? "center") === a;
            return (
              <button key={a} onClick={() => patch({ align: a })}
                className={cn(
                  "h-7 px-2 text-[10px] font-bold uppercase border-r last:border-r-0",
                  on ? "bg-teal-500/15 text-teal-200" : "text-zinc-400 hover:text-zinc-100 hover:bg-white/5",
                )}
                style={{ borderColor: "#2a3232" }}>
                {a}
              </button>
            );
          })}
        </div>
      </Section>

      <Section label="Style">
        <div className="flex gap-1.5">
          <button onClick={() => patch({ italic: !t.italic })}
            className={cn(
              "h-7 px-2 rounded-md border text-[10px] font-bold italic",
              t.italic ? "bg-teal-500/15 border-teal-500/60 text-teal-200" : "text-zinc-400",
            )}
            style={{ borderColor: t.italic ? undefined : "#2a3232", background: t.italic ? undefined : "#1a2020" }}
          >I</button>
          <button onClick={() => patch({ underline: !t.underline })}
            className={cn(
              "h-7 px-2 rounded-md border text-[10px] font-bold underline",
              t.underline ? "bg-teal-500/15 border-teal-500/60 text-teal-200" : "text-zinc-400",
            )}
            style={{ borderColor: t.underline ? undefined : "#2a3232", background: t.underline ? undefined : "#1a2020" }}
          >U</button>
        </div>
      </Section>
    </div>
  );
}

function ShapeTab() {
  const editor = useSlideEditorCtx();
  if (!editor) return <div className="p-3 text-[11px] text-zinc-500">Editor unavailable.</div>;
  const sel = editor.selectedObjectId
    ? editor.currentSlide?.objects.find((o) => o.id === editor.selectedObjectId)
    : null;
  if (!sel || sel.kind !== "shape") {
    return (
      <div className="p-3 text-[11px] text-zinc-500 italic leading-relaxed">
        Select a shape object to edit fill, stroke, and radius.
      </div>
    );
  }
  const s = sel as ShapeObject;
  const patch = (p: Partial<SlideObject>) => editor.updateObject(s.id, p);

  return (
    <div className="p-3 space-y-3">
      <Section label="Fill">
        <div className="flex items-center gap-2">
          <input type="color" value={s.fill || "#14b8a6"} onChange={(e) => patch({ fill: e.target.value })}
            className="h-8 w-12 rounded-md border cursor-pointer"
            style={{ borderColor: "#2a3232", background: "#1a2020" }} />
          <input type="text" value={s.fill || ""} onChange={(e) => patch({ fill: e.target.value })}
            className="flex-1 h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none"
            style={{ background: "#1a2020", borderColor: "#2a3232" }} />
        </div>
      </Section>

      <Section label="Stroke">
        <div className="flex items-center gap-2">
          <input type="color" value={s.stroke || "#0f766e"} onChange={(e) => patch({ stroke: e.target.value })}
            className="h-8 w-12 rounded-md border cursor-pointer"
            style={{ borderColor: "#2a3232", background: "#1a2020" }} />
          <input type="text" value={s.stroke || ""} onChange={(e) => patch({ stroke: e.target.value })}
            className="flex-1 h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none"
            style={{ background: "#1a2020", borderColor: "#2a3232" }} />
        </div>
      </Section>

      <Section label="Stroke width (px)">
        <input type="number" min={0} value={s.strokeWidth ?? 0}
          onChange={(e) => patch({ strokeWidth: Number(e.target.value) || 0 })}
          className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none"
          style={{ background: "#1a2020", borderColor: "#2a3232" }} />
      </Section>

      <Section label="Corner radius (px)">
        <input type="number" min={0} value={s.radius ?? 0}
          onChange={(e) => patch({ radius: Number(e.target.value) || 0 })}
          disabled={s.shape === "ellipse"}
          title={s.shape === "ellipse" ? "Ellipse is fully rounded" : ""}
          className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none disabled:opacity-40"
          style={{ background: "#1a2020", borderColor: "#2a3232" }} />
      </Section>

      <Section label="Opacity">
        <input type="number" min={0} max={1} step={0.05} value={s.opacity ?? 1}
          onChange={(e) => patch({ opacity: Math.max(0, Math.min(1, Number(e.target.value))) })}
          className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none"
          style={{ background: "#1a2020", borderColor: "#2a3232" }} />
      </Section>
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

// ============================================================================
// Phase 5D-2 — Announce / Effects / Theme tabs
// ============================================================================

const ANN_POSITIONS: { key: AnnouncementPosition; label: string }[] = [
  { key: "lower_third", label: "Lower 3rd" },
  { key: "top_banner",  label: "Top" },
  { key: "ticker",      label: "Ticker" },
  { key: "center_card", label: "Center" },
];

const DEFAULT_ANN_STYLE: AnnouncementStyle = {
  fontFamily: "Inter",
  fontSizePx: 32,
  fontWeight: 600,
  textColor: "#ffffff",
  bgColor: "#000000",
  bgOpacity: 70,
  padding: 20,
  borderRadius: 8,
  align: "left",
};

type PresetRow = { id: string; name: string; config: unknown };

function AnnounceTab({ ctx }: { ctx: OperatorShellCtx }) {
  const [name, setName] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [position, setPosition] = useState<AnnouncementPosition>("lower_third");
  const [style, setStyle] = useState<AnnouncementStyle>(DEFAULT_ANN_STYLE);
  const [presets, setPresets] = useState<PresetRow[] | null>(null);
  const [presetId, setPresetId] = useState("");
  const [saving, setSaving] = useState(false);
  const churchId = ctx.churchId;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/announcements/presets?churchId=${encodeURIComponent(churchId)}`).then((r) => r.json()).then((res) => {
      if (cancelled) return;
      if (Array.isArray(res.presets)) setPresets(res.presets);
      else setPresets([]);
    }).catch(() => { if (!cancelled) setPresets([]); });
    return () => { cancelled = true; };
  }, [churchId]);

  const payload: AnnouncementPayload = { line1, line2: line2 || undefined, position, style };

  const patchStyle = (p: Partial<AnnouncementStyle>) => setStyle((s) => ({ ...s, ...p }));

  const showLive = () => { ctx.onSetAnnouncement(payload); toast.success("Announcement live"); };
  const hideLive = () => { ctx.onSetAnnouncement(null); toast("Announcement hidden"); };
  const preview = () => { ctx.onSetAnnouncement(payload); };

  const savePreset = async () => {
    if (!name.trim()) { toast.error("Give the preset a name"); return; }
    setSaving(true);
    try {
      const res = await saveAnnouncementPreset(name.trim(), { line1, line2, position, style });
      if (res.ok) {
        toast.success("Preset saved");
        const r = await fetch(`/api/announcements/presets?churchId=${encodeURIComponent(churchId)}`).then((r) => r.json());
        if (Array.isArray(r.presets)) setPresets(r.presets);
      } else toast.error(res.error);
    } finally { setSaving(false); }
  };

  const loadPreset = (id: string) => {
    setPresetId(id);
    const p = presets?.find((x) => x.id === id);
    if (!p) return;
    const c = (p.config as Partial<{ line1: string; line2: string; position: AnnouncementPosition; style: AnnouncementStyle }>) ?? {};
    if (c.line1 !== undefined) setLine1(c.line1);
    if (c.line2 !== undefined) setLine2(c.line2);
    if (c.position) setPosition(c.position);
    if (c.style) setStyle({ ...DEFAULT_ANN_STYLE, ...c.style });
  };

  const delPreset = async () => {
    if (!presetId) return;
    const res = await deleteAnnouncementPreset(presetId);
    if (res.ok) {
      setPresets((prev) => (prev ?? []).filter((p) => p.id !== presetId));
      setPresetId("");
      toast("Preset removed");
    }
  };

  return (
    <div className="p-3 space-y-3">
      {/* Live preview strip */}
      <div className="relative w-full h-16 rounded-md overflow-hidden border" style={{ borderColor: "#2a3232", background: "#0a0a0a" }}>
        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-zinc-600">preview</div>
        <div className="absolute inset-0 pointer-events-none">
          <div style={{
            position: "absolute",
            bottom: position === "lower_third" ? 6 : position === "ticker" ? 0 : "auto",
            top: position === "top_banner" ? 0 : position === "center_card" ? "50%" : "auto",
            left: position === "center_card" ? "50%" : 6,
            transform: position === "center_card" ? "translate(-50%, -50%)" : undefined,
            right: position === "top_banner" || position === "ticker" ? 0 : "auto",
            padding: Math.min(style.padding, 8),
            borderRadius: style.borderRadius,
            background: hexAlpha(style.bgColor, style.bgOpacity / 100),
            color: style.textColor,
            fontFamily: style.fontFamily,
            fontWeight: style.fontWeight,
            fontSize: Math.min(style.fontSizePx * 0.4, 14),
            textAlign: style.align,
            maxWidth: "80%",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>
            {line1 || "Announcement preview"}
          </div>
        </div>
      </div>

      <Section label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Guest speaker card"
          className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 placeholder:text-zinc-500 border focus:outline-none"
          style={{ background: "#1a2020", borderColor: "#2a3232" }} />
      </Section>

      <Section label="Line 1">
        <input value={line1} onChange={(e) => setLine1(e.target.value)} placeholder="Pastor John Smith"
          className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 placeholder:text-zinc-500 border focus:outline-none"
          style={{ background: "#1a2020", borderColor: "#2a3232" }} />
      </Section>

      <Section label="Line 2 (optional)">
        <input value={line2} onChange={(e) => setLine2(e.target.value)} placeholder="Guest speaker"
          className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 placeholder:text-zinc-500 border focus:outline-none"
          style={{ background: "#1a2020", borderColor: "#2a3232" }} />
      </Section>

      <Section label="Position">
        <SegPill<AnnouncementPosition> value={position} onChange={setPosition} options={ANN_POSITIONS} />
      </Section>

      <Section label="Font family">
        <select value={style.fontFamily} onChange={(e) => patchStyle({ fontFamily: e.target.value })}
          className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none"
          style={{ background: "#1a2020", borderColor: "#2a3232" }}>
          {SAFE_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </Section>

      <Section label="Font size (px)">
        <input type="number" min={10} max={120} value={style.fontSizePx}
          onChange={(e) => patchStyle({ fontSizePx: Math.max(10, Math.min(120, Number(e.target.value) || 32)) })}
          className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none"
          style={{ background: "#1a2020", borderColor: "#2a3232" }} />
      </Section>

      <Section label="Weight">
        <div className="inline-flex rounded-md border" style={{ borderColor: "#2a3232" }}>
          {[400, 500, 600, 700].map((w) => {
            const on = style.fontWeight === w;
            return (
              <button key={w} onClick={() => patchStyle({ fontWeight: w })}
                className={cn(
                  "h-7 px-2 text-[10px] font-bold border-r last:border-r-0",
                  on ? "bg-teal-500/15 text-teal-200" : "text-zinc-400 hover:text-zinc-100 hover:bg-white/5",
                )}
                style={{ borderColor: "#2a3232" }}>{w}</button>
            );
          })}
        </div>
      </Section>

      <Section label="Text color">
        <div className="flex items-center gap-2">
          <input type="color" value={style.textColor} onChange={(e) => patchStyle({ textColor: e.target.value })}
            className="h-8 w-12 rounded-md border cursor-pointer"
            style={{ borderColor: "#2a3232", background: "#1a2020" }} />
          <input type="text" value={style.textColor} onChange={(e) => patchStyle({ textColor: e.target.value })}
            className="flex-1 h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none"
            style={{ background: "#1a2020", borderColor: "#2a3232" }} />
        </div>
      </Section>

      <Section label="Background color">
        <div className="flex items-center gap-2">
          <input type="color" value={style.bgColor} onChange={(e) => patchStyle({ bgColor: e.target.value })}
            className="h-8 w-12 rounded-md border cursor-pointer"
            style={{ borderColor: "#2a3232", background: "#1a2020" }} />
          <input type="text" value={style.bgColor} onChange={(e) => patchStyle({ bgColor: e.target.value })}
            className="flex-1 h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none"
            style={{ background: "#1a2020", borderColor: "#2a3232" }} />
        </div>
      </Section>

      <Section label={`Background opacity — ${style.bgOpacity}%`}>
        <input type="range" min={0} max={100} value={style.bgOpacity}
          onChange={(e) => patchStyle({ bgOpacity: Number(e.target.value) })}
          className="w-full" />
      </Section>

      <Section label={`Padding — ${style.padding}px`}>
        <input type="range" min={0} max={64} value={style.padding}
          onChange={(e) => patchStyle({ padding: Number(e.target.value) })} className="w-full" />
      </Section>

      <Section label={`Border radius — ${style.borderRadius}px`}>
        <input type="range" min={0} max={48} value={style.borderRadius}
          onChange={(e) => patchStyle({ borderRadius: Number(e.target.value) })} className="w-full" />
      </Section>

      <Section label="Align">
        <SegPill<AnnouncementStyle["align"]> value={style.align} onChange={(a) => patchStyle({ align: a })}
          options={[{ key: "left", label: "Left" }, { key: "center", label: "Center" }, { key: "right", label: "Right" }]} />
      </Section>

      <Section label="Actions">
        <div className="flex flex-wrap gap-1.5">
          <button onClick={preview} disabled={!line1}
            className="h-7 px-2 rounded-md border text-[10px] font-bold uppercase text-zinc-200 hover:bg-white/5 disabled:opacity-40"
            style={{ borderColor: "#2a3232", background: "#1a2020" }}>Preview</button>
          <button onClick={showLive} disabled={!line1}
            className="h-7 px-3 rounded-md bg-teal-500/20 border border-teal-500/60 text-teal-200 text-[10px] font-bold uppercase disabled:opacity-40">Show</button>
          <button onClick={hideLive}
            className="h-7 px-2 rounded-md border text-[10px] font-bold uppercase text-red-300 border-red-500/40 hover:bg-red-500/10">Hide</button>
          <button onClick={savePreset} disabled={saving || !name.trim()}
            className="h-7 px-2 rounded-md border text-[10px] font-bold uppercase text-zinc-200 hover:bg-white/5 disabled:opacity-40"
            style={{ borderColor: "#2a3232", background: "#1a2020" }}>{saving ? "…" : "Save preset"}</button>
        </div>
      </Section>

      <Section label="Presets">
        {presets === null ? (
          <div className="text-[11px] text-zinc-500 italic">Loading…</div>
        ) : presets.length === 0 ? (
          <div className="text-[11px] text-zinc-500 italic">No presets yet. Fill the form then click Save preset.</div>
        ) : (
          <div className="flex items-center gap-1.5">
            <select value={presetId} onChange={(e) => loadPreset(e.target.value)}
              className="flex-1 h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none"
              style={{ background: "#1a2020", borderColor: "#2a3232" }}>
              <option value="">Load preset…</option>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button onClick={delPreset} disabled={!presetId}
              title={presetId ? "Delete selected preset" : "Select a preset first"}
              className="h-8 w-8 grid place-items-center rounded-md border text-red-300 border-red-500/40 hover:bg-red-500/10 disabled:opacity-40">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </Section>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Effects tab
// -----------------------------------------------------------------------------

function SlideTransitionPicker({
  value, onChange, disabled,
}: { value: TransitionSpec | null; onChange: (v: TransitionSpec | null) => void; disabled?: boolean }) {
  const cur = value ?? { effectId: "", durationMs: 500, easing: "ease" };
  return (
    <div className="space-y-2">
      <select
        value={cur.effectId}
        onChange={(e) => {
          const id = e.target.value;
          if (!id) onChange(null);
          else onChange({ effectId: id, durationMs: cur.durationMs, easing: cur.easing });
        }}
        disabled={disabled}
        className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none disabled:opacity-40"
        style={{ background: "#1a2020", borderColor: "#2a3232" }}
      >
        <option value="">— none —</option>
        {EFFECTS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
      </select>
      {value && (
        <>
          <div className="text-[10px] text-zinc-500">Duration: {value.durationMs}ms</div>
          <input type="range" min={0} max={5000} step={50} value={value.durationMs} disabled={disabled}
            onChange={(e) => onChange({ ...value, durationMs: Number(e.target.value) })}
            className="w-full" />
          <select value={value.easing} disabled={disabled}
            onChange={(e) => onChange({ ...value, easing: e.target.value })}
            className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none disabled:opacity-40"
            style={{ background: "#1a2020", borderColor: "#2a3232" }}>
            {["linear", "ease", "ease-in", "ease-out", "ease-in-out"].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </>
      )}
    </div>
  );
}

function EffectsTab({ ctx }: { ctx: OperatorShellCtx }) {
  const editor = useSlideEditorCtx();
  const [selectedId, setSelectedId] = useState<EffectId | "">("");
  const [durationMs, setDurationMs] = useState(500);
  const [easing, setEasing] = useState("ease");
  const [previewNonce, setPreviewNonce] = useState(0);

  useEffect(() => { ensureEffectKeyframes(); }, []);

  const eff = selectedId ? getEffect(selectedId) : null;
  const previewCss = eff ? eff.css(durationMs, easing).in : undefined;

  const previewOnCanvas = () => {
    if (!selectedId) { toast("Pick an effect first"); return; }
    // Broadcast to /live so the operator's projector demo plays it
    ctx.onSetTransitionSpec({ effectId: selectedId, durationMs, easing });
    setPreviewNonce((n) => n + 1);
    toast(`Previewing ${eff?.label}`);
  };

  const setAsSlideDefault = () => {
    if (!editor || !editor.currentSlide) { toast.error("No slide selected"); return; }
    if (!selectedId) { toast("Pick an effect first"); return; }
    editor.updateSlideDirect({ transition: { effectId: selectedId, durationMs, easing } });
    toast.success("Slide default set");
  };

  return (
    <div className="p-3 space-y-3">
      <Section label="Duration (ms)">
        <input type="range" min={0} max={5000} step={50} value={durationMs}
          onChange={(e) => setDurationMs(Number(e.target.value))} className="w-full" />
        <div className="text-[10px] text-zinc-500">{durationMs} ms ({(durationMs / 1000).toFixed(2)}s)</div>
      </Section>

      <Section label="Easing">
        <select value={easing} onChange={(e) => setEasing(e.target.value)}
          className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none"
          style={{ background: "#1a2020", borderColor: "#2a3232" }}>
          {["linear", "ease", "ease-in", "ease-out", "ease-in-out"].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </Section>

      <Section label="Catalog">
        <div className="grid grid-cols-2 gap-1.5">
          {EFFECTS.map((e) => (
            <EffectCard key={e.id} effect={e} selected={selectedId === e.id}
              durationMs={durationMs} easing={easing}
              onSelect={() => setSelectedId(e.id)} />
          ))}
        </div>
      </Section>

      <Section label="Preview area">
        {editor?.currentSlide ? (
          <div className="relative h-16 rounded-md border overflow-hidden" style={{ borderColor: "#2a3232", background: "#0a0a0a" }}>
            <div key={previewNonce}
              className="absolute inset-0 flex items-center justify-center text-teal-200 text-[13px] font-bold"
              style={{ animation: previewCss }}>
              {eff?.label ?? "Select an effect"}
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-zinc-500 italic">Select a slide to preview effects.</div>
        )}
      </Section>

      <Section label="Actions">
        <div className="flex flex-wrap gap-1.5">
          <button onClick={previewOnCanvas} disabled={!selectedId}
            className="h-7 px-2 rounded-md border text-[10px] font-bold uppercase text-zinc-200 hover:bg-white/5 disabled:opacity-40"
            style={{ borderColor: "#2a3232", background: "#1a2020" }}>Preview on canvas</button>
          <button onClick={setAsSlideDefault}
            disabled={!selectedId || !editor?.currentSlide}
            title={!editor?.currentSlide ? "Select a slide first" : ""}
            className="h-7 px-2 rounded-md border text-[10px] font-bold uppercase text-zinc-200 hover:bg-white/5 disabled:opacity-40"
            style={{ borderColor: "#2a3232", background: "#1a2020" }}>Set default for slide</button>
          <button
            disabled
            title="Per-deck default requires song-context: coming when Effects tab is opened from a song item"
            className="h-7 px-2 rounded-md border text-[10px] font-bold uppercase opacity-40"
            style={{ borderColor: "#2a3232", background: "#1a2020", color: "#e4e4e7" }}>Set default for deck</button>
        </div>
      </Section>
    </div>
  );
}

function EffectCard({ effect, selected, durationMs, easing, onSelect }: {
  effect: Effect; selected: boolean; durationMs: number; easing: string; onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => { if (hovered) setNonce((n) => n + 1); }, [hovered]);
  const anim = hovered ? effect.css(Math.min(durationMs, 800), easing).in : undefined;
  return (
    <button onClick={onSelect}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      className={cn(
        "text-left h-14 rounded-md border p-1.5 relative overflow-hidden",
        selected ? "border-teal-500/60 bg-teal-500/10" : "hover:bg-white/5",
      )}
      style={{ borderColor: selected ? undefined : "#2a3232", background: selected ? undefined : "#1a2020" }}>
      <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-200">{effect.label}</div>
      <div className="text-[9px] text-zinc-500">{effect.category}</div>
      <div key={nonce} className="absolute right-1 bottom-1 h-5 px-1.5 grid place-items-center rounded-sm bg-black/40 text-[9px] text-teal-200"
        style={{ animation: anim }}>
        aa
      </div>
    </button>
  );
}

// -----------------------------------------------------------------------------
// Theme tab
// -----------------------------------------------------------------------------

type ThemeRow = { id: string; name: string; config: Record<string, unknown> };

function ThemeTab({ ctx }: { ctx: OperatorShellCtx }) {
  const [themes, setThemes] = useState<ThemeRow[] | null>(null);
  const [sel, setSel] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const churchId = ctx.churchId;

  const refresh = async () => {
    try {
      const res = await fetch(`/api/themes?churchId=${encodeURIComponent(churchId)}`).then((r) => r.json());
      if (Array.isArray(res.themes)) setThemes(res.themes);
      else setThemes([]);
    } catch { setThemes([]); }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [churchId]);

  const current = themes?.find((t) => t.id === sel) ?? null;

  const doNew = async () => {
    setBusy(true);
    try {
      const r = await createTheme("New theme", { bgColor: "#0b0b0b", fontFamily: "Inter", fontSizePx: 96, fontWeight: 600, textColor: "#ffffff", align: "center" });
      if (r.ok && r.data) { await refresh(); setSel(r.data.id); toast.success("Theme created"); }
      else if (!r.ok) toast.error(r.error);
    } finally { setBusy(false); }
  };
  const doDuplicate = async () => {
    if (!sel) return;
    const r = await duplicateTheme(sel);
    if (r.ok && r.data) { await refresh(); setSel(r.data.id); }
  };
  const doDelete = async () => {
    if (!sel) return;
    const r = await deleteTheme(sel);
    if (r.ok) { await refresh(); setSel(""); toast("Theme deleted"); }
  };
  const doExport = async () => {
    if (!sel || !current) return;
    const r = await exportTheme(sel);
    if (!r.ok) { toast.error(r.error); return; }
    const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${(r.data?.name ?? "theme").replace(/\W+/g, "_")}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };
  const doImportClick = () => fileRef.current?.click();
  const doImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const parsed = JSON.parse(text);
      const r = await importTheme(parsed);
      if (r.ok && r.data) {
        toast.success(r.data.rejectedFields.length ? `Imported (skipped: ${r.data.rejectedFields.join(", ")})` : "Imported");
        await refresh();
        setSel(r.data.id);
      } else if (!r.ok) toast.error(r.error);
    } catch (err) {
      toast.error("Invalid theme JSON: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const patchConfig = async (p: Record<string, unknown>) => {
    if (!current) return;
    const cfg = { ...current.config, ...p };
    setThemes((prev) => (prev ?? []).map((t) => t.id === current.id ? { ...t, config: cfg } : t));
    await updateTheme(current.id, { config: cfg });
  };
  const patchName = async (name: string) => {
    if (!current) return;
    setThemes((prev) => (prev ?? []).map((t) => t.id === current.id ? { ...t, name } : t));
    await updateTheme(current.id, { name });
  };

  const cfg = (current?.config ?? {}) as {
    bgColor?: string; bgImageUrl?: string; fontFamily?: string; fontSizePx?: number;
    fontWeight?: number; textColor?: string; align?: "left" | "center" | "right";
    safeArea?: boolean; transition?: TransitionSpec;
  };

  // Determine the selected song (from currently selected service item) to enable "apply to song".
  const editor = useSlideEditorCtx();
  const currentSongId = editor?.songId ?? null;

  const doApply = async () => {
    if (!current || !currentSongId) return;
    setBusy(true);
    try {
      const r = await applyThemeToSong(current.id, currentSongId);
      if (r.ok) toast.success(`Applied to ${r.data?.slidesUpdated ?? 0} slide(s). Reload to see changes.`);
      else toast.error(r.error);
    } finally { setBusy(false); }
  };

  return (
    <div className="p-3 space-y-3">
      <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={doImportFile} />

      <Section label="Themes">
        {themes === null ? (
          <div className="text-[11px] text-zinc-500 italic">Loading…</div>
        ) : themes.length === 0 ? (
          <div className="space-y-2">
            <div className="text-[11px] text-zinc-500 italic">No themes yet. Click New to create one.</div>
            <button onClick={doNew} disabled={busy}
              className="h-7 px-3 rounded-md bg-teal-500/20 border border-teal-500/60 text-teal-200 text-[10px] font-bold uppercase disabled:opacity-40">
              New theme
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {themes.map((t) => (
              <button key={t.id} onClick={() => setSel(t.id)}
                className={cn("w-full flex items-center gap-2 h-8 px-2 rounded-md border text-left",
                  sel === t.id ? "border-teal-500/60 bg-teal-500/10" : "hover:bg-white/5")}
                style={{ borderColor: sel === t.id ? undefined : "#2a3232", background: sel === t.id ? undefined : "#1a2020" }}>
                <span className="w-3 h-3 rounded-sm border border-white/20" style={{ background: (t.config as { bgColor?: string })?.bgColor || "#0b0b0b" }} />
                <span className="text-[11px] text-zinc-200 flex-1 truncate">{t.name}</span>
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section label="Actions">
        <div className="flex flex-wrap gap-1.5">
          <button onClick={doNew} disabled={busy}
            className="h-7 px-2 rounded-md border text-[10px] font-bold uppercase text-zinc-200 hover:bg-white/5"
            style={{ borderColor: "#2a3232", background: "#1a2020" }}>New</button>
          <button onClick={doDuplicate} disabled={!sel}
            className="h-7 px-2 rounded-md border text-[10px] font-bold uppercase text-zinc-200 hover:bg-white/5 disabled:opacity-40"
            style={{ borderColor: "#2a3232", background: "#1a2020" }}>Duplicate</button>
          <button onClick={doDelete} disabled={!sel}
            className="h-7 px-2 rounded-md border text-[10px] font-bold uppercase text-red-300 border-red-500/40 hover:bg-red-500/10 disabled:opacity-40">Delete</button>
          <button onClick={doImportClick}
            className="h-7 px-2 rounded-md border text-[10px] font-bold uppercase text-zinc-200 hover:bg-white/5"
            style={{ borderColor: "#2a3232", background: "#1a2020" }}>Import</button>
          <button onClick={doExport} disabled={!sel}
            className="h-7 px-2 rounded-md border text-[10px] font-bold uppercase text-zinc-200 hover:bg-white/5 disabled:opacity-40"
            style={{ borderColor: "#2a3232", background: "#1a2020" }}>Export</button>
        </div>
      </Section>

      {current && (
        <>
          <Section label="Name">
            <input value={current.name} onChange={(e) => patchName(e.target.value)}
              className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none"
              style={{ background: "#1a2020", borderColor: "#2a3232" }} />
          </Section>

          <Section label="Background color">
            <div className="flex items-center gap-2">
              <input type="color" value={cfg.bgColor || "#0b0b0b"} onChange={(e) => patchConfig({ bgColor: e.target.value })}
                className="h-8 w-12 rounded-md border cursor-pointer" style={{ borderColor: "#2a3232", background: "#1a2020" }} />
              <input type="text" value={cfg.bgColor || ""} onChange={(e) => patchConfig({ bgColor: e.target.value })}
                className="flex-1 h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none"
                style={{ background: "#1a2020", borderColor: "#2a3232" }} />
            </div>
          </Section>

          <Section label="Background image URL">
            <input value={cfg.bgImageUrl || ""} onChange={(e) => patchConfig({ bgImageUrl: e.target.value })}
              className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none"
              style={{ background: "#1a2020", borderColor: "#2a3232" }} />
          </Section>

          <Section label="Font family">
            <select value={cfg.fontFamily || "Inter"} onChange={(e) => patchConfig({ fontFamily: e.target.value })}
              className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none"
              style={{ background: "#1a2020", borderColor: "#2a3232" }}>
              {SAFE_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Section>

          <Section label="Font size (px)">
            <input type="number" min={10} max={200} value={cfg.fontSizePx ?? 96}
              onChange={(e) => patchConfig({ fontSizePx: Number(e.target.value) || 96 })}
              className="w-full h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none"
              style={{ background: "#1a2020", borderColor: "#2a3232" }} />
          </Section>

          <Section label="Weight">
            <div className="inline-flex rounded-md border" style={{ borderColor: "#2a3232" }}>
              {[400, 500, 600, 700].map((w) => {
                const on = (cfg.fontWeight ?? 600) === w;
                return (
                  <button key={w} onClick={() => patchConfig({ fontWeight: w })}
                    className={cn("h-7 px-2 text-[10px] font-bold border-r last:border-r-0",
                      on ? "bg-teal-500/15 text-teal-200" : "text-zinc-400 hover:text-zinc-100 hover:bg-white/5")}
                    style={{ borderColor: "#2a3232" }}>{w}</button>
                );
              })}
            </div>
          </Section>

          <Section label="Text color">
            <div className="flex items-center gap-2">
              <input type="color" value={cfg.textColor || "#ffffff"} onChange={(e) => patchConfig({ textColor: e.target.value })}
                className="h-8 w-12 rounded-md border cursor-pointer" style={{ borderColor: "#2a3232", background: "#1a2020" }} />
              <input type="text" value={cfg.textColor || ""} onChange={(e) => patchConfig({ textColor: e.target.value })}
                className="flex-1 h-8 px-2 rounded-md text-[12px] text-zinc-100 border focus:outline-none"
                style={{ background: "#1a2020", borderColor: "#2a3232" }} />
            </div>
          </Section>

          <Section label="Align">
            <SegPill<"left" | "center" | "right"> value={cfg.align ?? "center"}
              onChange={(a) => patchConfig({ align: a })}
              options={[{ key: "left", label: "Left" }, { key: "center", label: "Center" }, { key: "right", label: "Right" }]} />
          </Section>

          <Section label="Safe area">
            <button onClick={() => patchConfig({ safeArea: !cfg.safeArea })}
              className={cn("h-7 px-3 rounded-md border text-[10px] font-bold uppercase",
                cfg.safeArea ? "bg-teal-500/15 border-teal-500/60 text-teal-200" : "text-zinc-400")}
              style={{ borderColor: cfg.safeArea ? undefined : "#2a3232", background: cfg.safeArea ? undefined : "#1a2020" }}>
              {cfg.safeArea ? "On" : "Off"}
            </button>
          </Section>

          <Section label="Default transition">
            <SlideTransitionPicker value={cfg.transition ?? null}
              onChange={(t) => patchConfig({ transition: t ?? undefined })} />
          </Section>

          <Section label="Apply">
            <button onClick={doApply}
              disabled={busy || !currentSongId}
              title={currentSongId ? "" : "Select a song item to enable"}
              className="h-8 px-3 rounded-md bg-teal-500/20 border border-teal-500/60 text-teal-200 text-[11px] font-bold uppercase disabled:opacity-40">
              Apply to current song
            </button>
          </Section>
        </>
      )}
    </div>
  );
}

function hexAlpha(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(0,0,0,${alpha})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}
