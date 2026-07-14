"use client";
import { Mic, MicOff, Check, X, Sparkles, AlertCircle, Music, Terminal, Activity, Bookmark, Zap, Pencil, BookOpen, Radio, Plus, Eye, Globe, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AudioStreamState, Detection, SongSuggestion, CommandSuggestion, PipelineStage, UnifiedSuggestion } from "./useAudioStream";
import type { BankedVerse } from "./useVerseBank";
import { SimulatePhraseInput } from "./SimulatePhraseInput";

export type InternetMetadataCard = {
  id: string;
  title: string;
  artist: string;
  source: "musicbrainz" | "degraded_stub";
  externalId?: string;
  confidence: number;
  url?: string;
  degraded?: boolean;
  matchedText: string;
};

const STAGE_ORDER: PipelineStage[] = [
  "requesting_ticket", "ticket_ok", "opening_ws", "ws_open",
  "requesting_mic", "mic_granted", "audioctx_ready",
  "worklet_loaded", "worklet_connected", "first_chunk_sent",
  "deepgram_ready", "receiving_interim", "receiving_final",
];
const STAGE_LABEL: Record<PipelineStage, string> = {
  idle: "idle",
  requesting_ticket: "1. Request ticket",
  ticket_ok: "2. Ticket received",
  opening_ws: "3. Opening WebSocket",
  ws_open: "4. WebSocket open",
  requesting_mic: "5. Request microphone",
  mic_granted: "6. Microphone granted",
  audioctx_ready: "7. AudioContext ready",
  worklet_loaded: "8. Audio worklet loaded",
  worklet_connected: "9. Worklet connected",
  first_chunk_sent: "10. First audio chunk sent",
  deepgram_ready: "11. Deepgram ready",
  receiving_interim: "12. Receiving interim",
  receiving_final: "13. Receiving final",
  paused: "14. Paused (silence)",
};

const COMMAND_LABEL: Record<CommandSuggestion["verb"], string> = {
  next_slide: "Next slide",
  prev_slide: "Previous slide",
  blank: "Blank the screen",
  logo: "Show logo",
  clear_live: "Clear live",
  show_reference: "Show scripture / song",
  show_song: "Show song",
};

/**
 * AI Assistant panel — collapsible right dock.
 *
 * ⚠️ Safety gate: Approve stages the detected verse to Preview ONLY.
 * There is no code path in this component that pushes to Live. The parent
 * OperatorConsole owns `send(slide)`; this panel only owns `stageToPreview`.
 * Visual: Approve uses a green outlined style, deliberately different from
 * the orange filled "SEND TO LIVE" button.
 */
export function AIAssistantPanel({
  audio,
  onApprove,
  onReject,
  onApproveSong,
  onRejectSong,
  onApproveCommand,
  onRejectCommand,
  confidenceThreshold,
  bank,
  currentBankIdx,
  onRecall,
  autoApproveOn,
  onEditDetection,
  onEditSong,
  onEditCommand,
  bibleSourceLabel,
  onSimulate,
  onPreviewUnified,
  onSendLiveUnified,
  onQueueUnified,
  onRejectUnified,
  onImportSong,
  internetMatches = [],
  onInternetSearchLibrary,
  onInternetImport,
  onInternetCreateDraft,
  onInternetReject,
}: {
  audio: AudioStreamState;
  onApprove: (d: Detection) => Promise<void> | void;
  onReject: (d: Detection) => Promise<void> | void;
  onApproveSong: (s: SongSuggestion) => Promise<void> | void;
  onRejectSong: (s: SongSuggestion) => Promise<void> | void;
  onApproveCommand: (c: CommandSuggestion) => Promise<void> | void;
  onRejectCommand: (c: CommandSuggestion) => Promise<void> | void;
  confidenceThreshold: number;
  bank: BankedVerse[];
  currentBankIdx: number | null;
  onRecall: (idx: number) => void;
  autoApproveOn: boolean;
  onEditDetection?: (d: Detection) => void;
  onEditSong?: (s: SongSuggestion) => void;
  onEditCommand?: (c: CommandSuggestion) => void;
  bibleSourceLabel?: string; // e.g. "Bible KJV", "Bible WEB"
  onSimulate?: (text: string) => void;
  onPreviewUnified?: (s: UnifiedSuggestion) => void;
  onSendLiveUnified?: (s: UnifiedSuggestion) => void;
  onQueueUnified?: (s: UnifiedSuggestion) => void;
  onRejectUnified?: (s: UnifiedSuggestion) => void;
  onImportSong?: (title: string) => void;
  internetMatches?: InternetMetadataCard[];
  onInternetSearchLibrary?: (m: InternetMetadataCard) => void;
  onInternetImport?: (m: InternetMetadataCard) => void;
  onInternetCreateDraft?: (m: InternetMetadataCard) => void;
  onInternetReject?: (m: InternetMetadataCard) => void;
}) {
  return (
    <div className="w-80 shrink-0 border-l border-border bg-background flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" />
          <div className="eyebrow text-muted-foreground">AI Assistant</div>
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs">
          {audio.listening ? (
            <>
              <span className="inline-flex items-end gap-[2px] h-3">
                <span className="ff-wave-bar" />
                <span className="ff-wave-bar" />
                <span className="ff-wave-bar" />
                <span className="ff-wave-bar" />
                <span className="ff-wave-bar" />
                <span className="ff-wave-bar" />
              </span>
              <span className="text-[color:var(--color-ai-listening)] font-semibold uppercase tracking-wider text-[10px]">Live audio</span>
            </>
          ) : (
            <><span className="w-2 h-2 rounded-full bg-muted-foreground/50 inline-block" /> <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Not listening</span></>
          )}
        </div>
        {audio.error && (
          <div className="mt-2 text-[11px] text-destructive flex items-start gap-1.5">
            <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" /> {audio.error}
          </div>
        )}
        {autoApproveOn && (
          <div className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-warning border border-warning/40 bg-warning/5 rounded-sm px-1.5 py-0.5">
            <Zap className="w-2.5 h-2.5" /> Autopilot on
          </div>
        )}
      </div>

      {/* Verse bank (per-service history) */}
      {bank.length > 0 && (
        <div className="px-4 py-3 border-b border-border max-h-[25%] overflow-y-auto">
          <div className="eyebrow text-muted-foreground mb-2 flex items-center gap-1.5">
            <Bookmark className="w-3 h-3" /> Verse bank <span className="ml-auto text-muted-foreground/60">{bank.length}</span>
          </div>
          <ul className="space-y-1">
            {bank.slice().reverse().map((v, revIdx) => {
              const idx = bank.length - 1 - revIdx;
              const isCurrent = idx === currentBankIdx;
              return (
                <li key={v.approvedAt + v.id}>
                  <button onClick={() => onRecall(idx)}
                    className={cn(
                      "w-full text-left px-2 py-1.5 rounded-sm border text-xs transition-colors",
                      isCurrent ? "border-success bg-success/10 text-success" : "border-border hover:bg-accent"
                    )}>
                    <div className="font-mono text-[10px]">{v.book} {v.chapter}:{v.verseStart}{v.verseStart !== v.verseEnd ? `-${v.verseEnd}` : ""} <span className="text-muted-foreground/60">· {v.translation}</span></div>
                    <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{v.text.split("\n\n")[0]}</div>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[10px] text-muted-foreground italic">
            Say "next verse", "continue" or "back" during the sermon to advance from the current one.
          </p>
        </div>
      )}

      {/* Pipeline diagnostics — visible per-stage progress */}
      {audio.listening && (
        <div className="px-4 py-2 border-b border-border bg-muted/20">
          <details open={audio.stage !== "receiving_final" && audio.stage !== "receiving_interim"}>
            <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 select-none">
              <Activity className="w-3 h-3" /> Pipeline · {STAGE_LABEL[audio.stage]}
            </summary>
            <ul className="mt-2 space-y-0.5 text-[10px] font-mono">
              {STAGE_ORDER.map((stage) => {
                const idx = STAGE_ORDER.indexOf(audio.stage);
                const stageIdx = STAGE_ORDER.indexOf(stage);
                const reached = stageIdx <= idx && idx >= 0;
                return (
                  <li key={stage} className={cn(
                    "flex items-center gap-2",
                    reached ? "text-success" : "text-muted-foreground/50",
                  )}>
                    <span>{reached ? "✓" : "○"}</span>
                    <span>{STAGE_LABEL[stage]}</span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 text-[10px] text-muted-foreground font-mono">
              Audio chunks sent: {audio.chunksSent} · DG messages: {audio.dgMessagesReceived}
            </div>
          </details>
        </div>
      )}

      {/* Voice commands (top — highest urgency) */}
      {audio.commandSuggestions.length > 0 && (
        <div className="px-4 py-3 border-b border-border max-h-[30%] overflow-y-auto">
          <div className="eyebrow text-muted-foreground mb-2 flex items-center gap-1.5"><Terminal className="w-3 h-3" /> Voice commands</div>
          <ul className="space-y-2">
            {audio.commandSuggestions.map((c) => (
              <CommandCard key={c.suggestionId} c={c} threshold={confidenceThreshold} onApprove={onApproveCommand} onReject={onRejectCommand} onEdit={onEditCommand} />
            ))}
          </ul>
        </div>
      )}

      {/* Detections */}
      <div className="px-4 py-3 border-b border-border max-h-[35%] overflow-y-auto">
        <div className="eyebrow text-muted-foreground mb-2">Detected references</div>
        {audio.detections.length === 0 && audio.suggestions.filter((s) => s.type === "scripture").length === 0 ? (
          <p className="text-xs text-muted-foreground">Bible references you speak will appear here.</p>
        ) : (
          <ul className="space-y-2">
            {audio.detections.map((d) => (
              <DetectionCard key={d.id} d={d} threshold={confidenceThreshold} onApprove={onApprove} onReject={onReject} onEdit={onEditDetection} sourceLabel={bibleSourceLabel} />
            ))}
          </ul>
        )}
      </div>

      {/* Song / Lyric — Phase 5A unified section */}
      {audio.suggestions.filter((s) => s.type === "song" || s.type === "lyric" || s.type === "section").length > 0 && (
        <div className="px-4 py-3 border-b border-border max-h-[40%] overflow-y-auto">
          <div className="eyebrow text-muted-foreground mb-2 flex items-center gap-1.5">
            <Music className="w-3 h-3" /> Song / Lyric
          </div>
          <ul className="space-y-2">
            {audio.suggestions
              .filter((s) => s.type === "song" || s.type === "lyric" || s.type === "section")
              .map((s) => (
                <UnifiedCard
                  key={s.id}
                  s={s}
                  threshold={confidenceThreshold}
                  autopilotOn={autoApproveOn}
                  onPreview={onPreviewUnified}
                  onSendLive={onSendLiveUnified}
                  onQueue={onQueueUnified}
                  onReject={onRejectUnified}
                  onImportSong={onImportSong}
                />
              ))}
          </ul>
        </div>
      )}

      {/* Internet metadata (song identified online, no lyrics available locally) */}
      {internetMatches.length > 0 && (
        <div className="px-4 py-3 border-b border-border max-h-[30%] overflow-y-auto">
          <div className="eyebrow text-muted-foreground mb-2 flex items-center gap-1.5">
            <Globe className="w-3 h-3" /> Internet metadata
          </div>
          <ul className="space-y-2">
            {internetMatches.map((m) => (
              <li key={m.id} className="border rounded-md p-2 text-xs bg-card border-border">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">{m.title}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{m.confidence}%</span>
                </div>
                <div className="text-[11px] text-muted-foreground mb-1">by {m.artist}</div>
                <div className="text-[11px] text-muted-foreground italic mb-2 line-clamp-1">"{m.matchedText}"</div>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-border bg-muted/30 text-muted-foreground">
                    <Globe className="w-2.5 h-2.5" /> Internet metadata
                  </span>
                  {m.degraded && (
                    <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-warning/40 bg-warning/10 text-warning">
                      Lookup unavailable
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-warning italic mb-2">
                  Song identified online — lyrics not available in your local or licensed library
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  <button onClick={() => onInternetSearchLibrary?.(m)}
                    className="h-8 rounded-md border border-border text-[10px] font-semibold uppercase tracking-wider hover:bg-accent flex items-center justify-center gap-1">
                    <Search className="w-2.5 h-2.5" /> Search Library
                  </button>
                  <button onClick={() => onInternetImport?.(m)}
                    className="h-8 rounded-md border-2 border-success text-success bg-success/5 hover:bg-success/10 text-[10px] font-semibold uppercase tracking-wider flex items-center justify-center gap-1">
                    <Plus className="w-2.5 h-2.5" /> Import Song
                  </button>
                  <button onClick={() => onInternetCreateDraft?.(m)}
                    className="h-8 rounded-md border border-border text-[10px] font-semibold uppercase tracking-wider hover:bg-accent flex items-center justify-center gap-1">
                    <Pencil className="w-2.5 h-2.5" /> Create Draft
                  </button>
                  <button onClick={() => onInternetReject?.(m)}
                    className="h-8 rounded-md border border-border text-muted-foreground hover:bg-accent text-[10px] font-semibold uppercase tracking-wider flex items-center justify-center gap-1">
                    <X className="w-2.5 h-2.5" /> Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Song suggestions */}
      {audio.songSuggestions.length > 0 && (
        <div className="px-4 py-3 border-b border-border max-h-[30%] overflow-y-auto">
          <div className="eyebrow text-muted-foreground mb-2 flex items-center gap-1.5"><Music className="w-3 h-3" /> Songs</div>
          <ul className="space-y-2">
            {audio.songSuggestions.map((s) => (
              <SongCard key={s.suggestionId} s={s} threshold={confidenceThreshold} onApprove={onApproveSong} onReject={onRejectSong} onEdit={onEditSong} />
            ))}
          </ul>
        </div>
      )}

      {/* Simulate phrase (Phase 5A testing helper) */}
      {onSimulate && <SimulatePhraseInput onSimulate={onSimulate} />}

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="eyebrow text-muted-foreground mb-2">Live transcript</div>
        {audio.transcript.length === 0 && !audio.interim ? (
          <p className="text-xs text-muted-foreground">Waiting for speech…</p>
        ) : (
          <div className="space-y-1.5 text-xs leading-relaxed">
            {audio.transcript.slice(-30).map((t) => (
              <div key={t.id} className="text-foreground">{t.text}</div>
            ))}
            {audio.interim && (
              <div className="text-muted-foreground italic">{audio.interim}…</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DetectionCard({ d, threshold, onApprove, onReject, onEdit, sourceLabel }: { d: Detection; threshold: number; onApprove: (d: Detection) => void | Promise<void>; onReject: (d: Detection) => void | Promise<void>; onEdit?: (d: Detection) => void; sourceLabel?: string }) {
  const low = d.confidence < threshold;
  return (
    <li className={cn(
      "border rounded-md p-2 text-xs bg-card",
      low ? "border-warning/60" : "border-border"
    )}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-sm">
          {d.book} {d.chapter}:{d.verseStart}{d.verseStart !== d.verseEnd ? `-${d.verseEnd}` : ""}
        </span>
        <span className={cn("font-mono text-[10px]", low ? "text-warning" : "text-muted-foreground")}>
          {d.confidence}%
        </span>
      </div>
      {sourceLabel && (
        <div className="mb-1">
          <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-border bg-muted/30 text-muted-foreground">
            <BookOpen className="w-2.5 h-2.5" /> {sourceLabel}
          </span>
        </div>
      )}
      <div className="text-[11px] text-muted-foreground italic mb-2 line-clamp-1">
        “{d.matchedText}”
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          onClick={() => onApprove(d)}
          title="Stage this verse to the Preview pane. Does not send to Live."
          className="h-8 rounded-md border-2 border-success text-success bg-success/5 hover:bg-success/10 text-[11px] font-bold uppercase tracking-wider transition-all active:scale-[0.98] flex items-center justify-center gap-1">
          <Check className="w-3 h-3" /> Approve → Preview
        </button>
        <button
          onClick={() => onReject(d)}
          className="h-8 rounded-md border border-border text-muted-foreground hover:bg-accent text-[11px] font-semibold uppercase tracking-wider transition-all active:scale-[0.98] flex items-center justify-center gap-1">
          <X className="w-3 h-3" /> Reject
        </button>
      </div>
      {onEdit && (
        <button onClick={() => onEdit(d)} title="Edit reference before staging"
          className="mt-1 w-full h-7 rounded-md border border-border text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent inline-flex items-center justify-center gap-1">
          <Pencil className="w-2.5 h-2.5" /> Edit
        </button>
      )}
      {low && (
        <div className="mt-1 text-[10px] text-warning flex items-center gap-1">
          <AlertCircle className="w-2.5 h-2.5" /> Below confidence threshold
        </div>
      )}
    </li>
  );
}

function SongCard({ s, threshold, onApprove, onReject, onEdit }: { s: SongSuggestion; threshold: number; onApprove: (s: SongSuggestion) => void | Promise<void>; onReject: (s: SongSuggestion) => void | Promise<void>; onEdit?: (s: SongSuggestion) => void }) {
  const low = s.confidence < threshold;
  const unknown = !s.songId;
  return (
    <li className={cn("border rounded-md p-2 text-xs bg-card", low ? "border-warning/60" : "border-border")}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-sm">{s.title}{unknown && <span className="text-muted-foreground text-xs ml-1">(not in library)</span>}</span>
        <span className={cn("font-mono text-[10px]", low ? "text-warning" : "text-muted-foreground")}>{s.confidence}%</span>
      </div>
      <div className="text-[11px] text-muted-foreground italic mb-2 line-clamp-1">“{s.matchedText}”</div>
      <div className="grid grid-cols-2 gap-1.5">
        <button onClick={() => onApprove(s)} disabled={unknown}
          title="Stage this song to the Preview pane. Does not send to Live."
          className="h-8 rounded-md border-2 border-success text-success bg-success/5 hover:bg-success/10 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-bold uppercase tracking-wider transition-all active:scale-[0.98] flex items-center justify-center gap-1">
          <Check className="w-3 h-3" /> Approve → Preview
        </button>
        <button onClick={() => onReject(s)}
          className="h-8 rounded-md border border-border text-muted-foreground hover:bg-accent text-[11px] font-semibold uppercase tracking-wider transition-all active:scale-[0.98] flex items-center justify-center gap-1">
          <X className="w-3 h-3" /> Reject
        </button>
      </div>
      {onEdit && (
        <button onClick={() => onEdit(s)} title="Edit title before staging"
          className="mt-1 w-full h-7 rounded-md border border-border text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent inline-flex items-center justify-center gap-1">
          <Pencil className="w-2.5 h-2.5" /> Edit
        </button>
      )}
      {low && (
        <div className="mt-1 text-[10px] text-warning flex items-center gap-1">
          <AlertCircle className="w-2.5 h-2.5" /> Below confidence threshold
        </div>
      )}
    </li>
  );
}

function CommandCard({ c, threshold, onApprove, onReject, onEdit }: { c: CommandSuggestion; threshold: number; onApprove: (c: CommandSuggestion) => void | Promise<void>; onReject: (c: CommandSuggestion) => void | Promise<void>; onEdit?: (c: CommandSuggestion) => void }) {
  const low = c.confidence < threshold;
  return (
    <li className={cn("border rounded-md p-2 text-xs bg-card", low ? "border-warning/60" : "border-border")}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-sm">{COMMAND_LABEL[c.verb] || c.verb}</span>
        <span className={cn("font-mono text-[10px]", low ? "text-warning" : "text-muted-foreground")}>{c.confidence}%</span>
      </div>
      <div className="text-[11px] text-muted-foreground italic mb-2 line-clamp-1">“{c.matchedText}”</div>
      <div className="grid grid-cols-2 gap-1.5">
        <button onClick={() => onApprove(c)}
          title="Execute this voice command. Advance / prev goes to Preview; BLANK/LOGO/CLEAR go straight to Live because they are the same explicit operator actions the sidebar buttons are."
          className="h-8 rounded-md border-2 border-success text-success bg-success/5 hover:bg-success/10 text-[11px] font-bold uppercase tracking-wider transition-all active:scale-[0.98] flex items-center justify-center gap-1">
          <Check className="w-3 h-3" /> Approve
        </button>
        <button onClick={() => onReject(c)}
          className="h-8 rounded-md border border-border text-muted-foreground hover:bg-accent text-[11px] font-semibold uppercase tracking-wider transition-all active:scale-[0.98] flex items-center justify-center gap-1">
          <X className="w-3 h-3" /> Reject
        </button>
      </div>
      {onEdit && (
        <button onClick={() => onEdit(c)} title="Edit query before running"
          className="mt-1 w-full h-7 rounded-md border border-border text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent inline-flex items-center justify-center gap-1">
          <Pencil className="w-2.5 h-2.5" /> Edit
        </button>
      )}
    </li>
  );
}

function UnifiedCard({
  s, threshold, autopilotOn, onPreview, onSendLive, onQueue, onReject, onImportSong,
}: {
  s: UnifiedSuggestion;
  threshold: number;
  autopilotOn: boolean;
  onPreview?: (s: UnifiedSuggestion) => void;
  onSendLive?: (s: UnifiedSuggestion) => void;
  onQueue?: (s: UnifiedSuggestion) => void;
  onReject?: (s: UnifiedSuggestion) => void;
  onImportSong?: (title: string) => void;
}) {
  // Hidden below 60% (see Phase 5A auto-accept rules)
  if (s.confidence < 60) return null;
  const low = s.confidence < threshold;

  if (s.type === "section") {
    return (
      <li className={cn("border rounded-md p-2 text-xs bg-card", "border-border")}>
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-sm capitalize">Jump to {s.section}{s.index !== undefined ? ` ${s.index}` : ""}</span>
          <span className="font-mono text-[10px] text-muted-foreground">{s.confidence}%</span>
        </div>
        <div className="text-[11px] text-muted-foreground italic mb-2 line-clamp-1">“{s.matchedText}”</div>
        <div className="grid grid-cols-2 gap-1.5">
          <button onClick={() => onPreview?.(s)}
            className="h-8 rounded-md border-2 border-success text-success bg-success/5 hover:bg-success/10 text-[11px] font-bold uppercase tracking-wider">
            <Check className="w-3 h-3 inline mr-1" /> Approve
          </button>
          <button onClick={() => onReject?.(s)}
            className="h-8 rounded-md border border-border text-muted-foreground hover:bg-accent text-[11px] font-semibold uppercase tracking-wider">
            <X className="w-3 h-3 inline mr-1" /> Reject
          </button>
        </div>
      </li>
    );
  }

  // song / lyric
  if (s.type === "scripture") return null; // scripture handled elsewhere
  const match = s.match;
  const sourceLabel = match.source === "playlist" ? "Playlist" : match.source === "local_library" ? "Library" : "Public Domain";
  const sourceClass = match.source === "playlist" ? "border-success/50 bg-success/10 text-success" : match.source === "public_domain" ? "border-border bg-muted/30 text-muted-foreground" : "border-border bg-muted/30 text-muted-foreground";
  const hasLyrics = match.previewPayload.kind === "text" && !!(match.previewPayload).text?.trim();
  // SAFETY: no lyrics ⇒ no Send Live button, show Import Song instead.
  // (In practice matchSongCue already gates this, but belt-and-brace.)
  const isStub = !hasLyrics;
  const showAutoPreviewHint = autopilotOn && s.confidence >= 90 && s.confidence < 95;
  const showAutoActiveHint = autopilotOn && s.confidence >= 95;

  return (
    <li className={cn("border rounded-md p-2 text-xs bg-card", low ? "border-warning/60" : "border-border")}>
      <div className="text-[11px] text-muted-foreground italic mb-1 line-clamp-1">“{s.matchedText}”</div>
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-sm">
          {match.title}
          {match.matchedSection && <span className="text-muted-foreground text-xs ml-1">· {match.matchedSection}</span>}
        </span>
        <span className={cn("font-mono text-[10px]", low ? "text-warning" : "text-muted-foreground")}>{s.confidence}%</span>
      </div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className={cn("inline-flex items-center gap-1 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border", sourceClass)}>
          <Music className="w-2.5 h-2.5" /> {sourceLabel}
        </span>
        {s.type === "lyric" && <span className="text-[9px] uppercase tracking-wider text-muted-foreground">lyric fragment</span>}
        {s.type === "song" && <span className="text-[9px] uppercase tracking-wider text-muted-foreground">title cue</span>}
      </div>
      {isStub ? (
        <div className="space-y-1.5">
          <p className="text-[10px] text-warning italic">
            No local/licensed match found — Import Song / Search Library
          </p>
          <button
            onClick={() => onImportSong?.(match.title)}
            className="w-full h-8 rounded-md border border-border text-[11px] font-semibold uppercase tracking-wider hover:bg-accent"
          >
            <Plus className="w-3 h-3 inline mr-1" /> Import Song
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <button onClick={() => onPreview?.(s)}
              title="Stage to Preview only"
              className="h-8 rounded-md border-2 border-success text-success bg-success/5 hover:bg-success/10 text-[11px] font-bold uppercase tracking-wider flex items-center justify-center gap-1">
              <Eye className="w-3 h-3" /> Preview
            </button>
            <button onClick={() => onSendLive?.(s)}
              title="Send this slide to Live"
              className="h-8 rounded-md border-2 border-orange-500 text-orange-600 bg-orange-500/5 hover:bg-orange-500/10 text-[11px] font-bold uppercase tracking-wider flex items-center justify-center gap-1">
              <Radio className="w-3 h-3" /> Send Live
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5 mt-1">
            <button onClick={() => onQueue?.(s)}
              className="h-7 rounded-md border border-border text-[10px] font-semibold uppercase tracking-wider hover:bg-accent flex items-center justify-center gap-1">
              <Bookmark className="w-2.5 h-2.5" /> Queue
            </button>
            <button onClick={() => onReject?.(s)}
              className="h-7 rounded-md border border-border text-muted-foreground hover:bg-accent text-[10px] font-semibold uppercase tracking-wider flex items-center justify-center gap-1">
              <X className="w-2.5 h-2.5" /> Reject
            </button>
          </div>
        </>
      )}
      {(showAutoPreviewHint || showAutoActiveHint) && (
        <div className="mt-1 text-[10px] text-warning flex items-center gap-1">
          <Zap className="w-2.5 h-2.5" /> {showAutoActiveHint ? "Auto-staged to Preview (song/lyric never auto-Live)" : "Auto-Preview-eligible"}
        </div>
      )}
      {low && s.confidence >= 60 && s.confidence < 80 && (
        <div className="mt-1 text-[10px] text-warning flex items-center gap-1">
          <AlertCircle className="w-2.5 h-2.5" /> Below confidence threshold — manual only
        </div>
      )}
    </li>
  );
}

export function ListeningToggle({ listening, onToggle }: { listening: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition-all border",
        listening
          ? "border-success bg-success/5 text-success hover:bg-success/10"
          : "border-border text-muted-foreground hover:bg-accent"
      )}>
      {listening ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
      AI Listening {listening ? "ON" : "OFF"}
    </button>
  );
}
