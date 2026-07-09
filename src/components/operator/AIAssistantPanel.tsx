"use client";
import { Mic, MicOff, Check, X, Sparkles, AlertCircle, Music, Terminal, Activity, Bookmark, Zap, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AudioStreamState, Detection, SongSuggestion, CommandSuggestion, PipelineStage } from "./useAudioStream";
import type { BankedVerse } from "./useVerseBank";

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
        {audio.detections.length === 0 ? (
          <p className="text-xs text-muted-foreground">Bible references you speak will appear here.</p>
        ) : (
          <ul className="space-y-2">
            {audio.detections.map((d) => (
              <DetectionCard key={d.id} d={d} threshold={confidenceThreshold} onApprove={onApprove} onReject={onReject} onEdit={onEditDetection} />
            ))}
          </ul>
        )}
      </div>

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

function DetectionCard({ d, threshold, onApprove, onReject, onEdit }: { d: Detection; threshold: number; onApprove: (d: Detection) => void | Promise<void>; onReject: (d: Detection) => void | Promise<void>; onEdit?: (d: Detection) => void }) {
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
