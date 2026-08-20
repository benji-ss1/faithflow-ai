"use client";
/**
 * NativeMicBoardModal — the Mic Board for NATIVE (Electron/ffmpeg) capture mode
 * (increment 2c). This is where the pro USB mixers Chromium can't handle
 * (X32 / XR18 / Allen & Heath SQ …) actually run.
 *
 * It reuses the native channel-level PROBE (the same 20Hz multi-channel ffmpeg
 * level stream the native channel picker already uses) for live VU, and the
 * `nativeDeviceStore` for the LEAD pick — writing selectedChannels:[lead] fires
 * the native-input-changed event, which re-routes the live ffmpeg capture to
 * that channel. Channel LABELS are written SILENTLY (no restart).
 *
 * Scope vs the browser board: native ffmpeg routing (`buildChannelFilter`) can
 * only SELECT a channel today, not gain/mute/duck it — so this board does VU +
 * labels + lead pick. Per-channel mute/duck/gain and metering DURING a live
 * service need Electron main-process work (documented as the next increment).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Crown, Mic } from "lucide-react";
import {
  readNativeDevicePref,
  writeNativeDevicePref,
  writeNativeDevicePrefSilent,
  type NativeDevicePref,
} from "@/lib/audio/nativeDeviceStore";

type NativeLevel = { channel: number; rms: number; db: number; peak: number };

interface NativeAudioApi {
  startChannelProbe: (o: { deviceIndex: number; channelCount: number }) => Promise<{ ok: boolean; error?: string }>;
  stopChannelProbe: () => Promise<void>;
  onChannelLevels: (cb: (levels: NativeLevel[]) => void) => () => void;
}

function getNativeApi(): NativeAudioApi | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { electronAPI?: { audio?: { native?: NativeAudioApi } } })
    .electronAPI?.audio?.native;
}

interface NativeMicBoardModalProps {
  open: boolean;
  onClose: () => void;
  deviceIndex: number;
  deviceName: string;
  channelCount: number;
}

export function NativeMicBoardModal({ open, onClose, deviceIndex, deviceName, channelCount }: NativeMicBoardModalProps) {
  const startedRef = useRef(false);
  const unsubRef = useRef<null | (() => void)>(null);
  const activeSinceRef = useRef<number[]>([]);

  const [levels, setLevels] = useState<NativeLevel[]>([]);
  const [active, setActive] = useState<boolean[]>([]);
  const [labels, setLabels] = useState<Record<number, string>>({});
  const [lead, setLead] = useState<number | null>(null);

  const chCount = Math.max(1, channelCount);

  // Load persisted labels + lead for this device.
  useEffect(() => {
    if (!open) return;
    const pref = readNativeDevicePref();
    // Only trust the stored labels/lead if the pref is for THIS device.
    const forThisDevice = pref && pref.index === deviceIndex;
    setLabels(forThisDevice && pref.channelLabels ? pref.channelLabels : {});
    setLead(
      forThisDevice && pref.mode === "mono" && pref.selectedChannels?.length === 1
        ? pref.selectedChannels[0]!
        : null,
    );
  }, [open, deviceIndex]);

  // Native probe lifecycle (mirrors AudioTab's native channel probe).
  useEffect(() => {
    if (!open) return;
    const nb = getNativeApi();
    if (!nb || chCount <= 1) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await nb.startChannelProbe({ deviceIndex, channelCount: chCount });
        if (!res?.ok || cancelled) {
          if (res?.ok) { try { void nb.stopChannelProbe(); } catch { /* noop */ } }
          return;
        }
        startedRef.current = true;
        const unsub = nb.onChannelLevels((lvls) => {
          if (cancelled) return;
          setLevels(lvls);
          const now = Date.now();
          const since = activeSinceRef.current;
          const act: boolean[] = new Array(lvls.length);
          for (const l of lvls) {
            if (l.rms > 0.02) since[l.channel] = now;
            act[l.channel] = (since[l.channel] ?? 0) > now - 250;
          }
          setActive(act);
        });
        unsubRef.current = unsub;
      } catch { /* noop */ }
    })();
    return () => {
      cancelled = true;
      if (unsubRef.current) { try { unsubRef.current(); } catch { /* noop */ } unsubRef.current = null; }
      if (startedRef.current) {
        startedRef.current = false;
        try { void nb.stopChannelProbe(); } catch { /* noop */ }
      }
    };
  }, [open, deviceIndex, chCount]);

  // Base pref carrying identity + labels, so writes preserve the other fields.
  const basePref = useCallback((): NativeDevicePref => {
    const existing = readNativeDevicePref();
    const forThis = existing && existing.index === deviceIndex ? existing : null;
    return {
      index: deviceIndex,
      name: deviceName,
      ...(forThis?.channelLabels ? { channelLabels: forThis.channelLabels } : {}),
    };
  }, [deviceIndex, deviceName]);

  const setLabel = (ch: number, value: string) => {
    const next = { ...labels };
    if (value.trim()) next[ch] = value.slice(0, 40); else delete next[ch];
    setLabels(next);
    // Labels are display-only — write SILENTLY so we never restart the live feed.
    const pref = readNativeDevicePref();
    const forThis = pref && pref.index === deviceIndex ? pref : basePref();
    writeNativeDevicePrefSilent({ ...forThis, index: deviceIndex, name: deviceName, channelLabels: next });
  };

  const chooseLead = (ch: number) => {
    const next = lead === ch ? null : ch;
    setLead(next);
    // Routing change — fire the event so useAudioStream re-routes the live feed.
    const base = basePref();
    if (next == null) {
      writeNativeDevicePref({ ...base, mode: "sum-all", selectedChannels: [] });
    } else {
      writeNativeDevicePref({ ...base, mode: "mono", selectedChannels: [next] });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(1100px,94vw)] max-h-[88vh] -translate-x-1/2 -translate-y-1/2 flex flex-col rounded-xl border shadow-2xl overflow-hidden"
          style={{ background: "var(--color-panel)", borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor: "var(--color-border)" }}>
            <div className="flex items-center gap-2.5 min-w-0">
              <Mic className="w-4 h-4 shrink-0" style={{ color: "var(--color-brand)" }} />
              <div className="min-w-0">
                <Dialog.Title className="text-[13px] font-semibold text-[var(--color-foreground)] truncate">Mic Board — Native mixer</Dialog.Title>
                <div className="text-[11px] text-[var(--color-muted-foreground)] truncate">{deviceName} · {chCount} channels</div>
              </div>
            </div>
            <Dialog.Close asChild>
              <button aria-label="Close" className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-[var(--color-elevated)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="px-5 py-2 text-[11px] text-[var(--color-muted-foreground)] border-b" style={{ borderColor: "var(--color-border)" }}>
            Label each mic and set the <span className="font-semibold" style={{ color: "var(--color-brand)" }}>Lead</span> — the one mic the AI listens to. Per-mic mute/gain for native mixers is coming in a desktop update.
          </div>

          <div className="overflow-auto p-4">
            <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
              {Array.from({ length: chCount }).map((_, ch) => {
                const lv = levels.find((l) => l.channel === ch);
                const rmsPct = lv ? Math.min(100, Math.round(lv.rms * 140)) : 0;
                const isLead = lead === ch;
                const isActive = active[ch] === true;
                return (
                  <div
                    key={ch}
                    className="flex flex-col rounded-lg border overflow-hidden transition-colors"
                    style={{
                      borderColor: isLead ? "var(--color-brand)" : "var(--color-border)",
                      background: "var(--color-elevated)",
                      boxShadow: isLead ? "0 0 0 1px var(--color-brand)" : "none",
                    }}
                  >
                    <div className="px-2 pt-2">
                      <input
                        value={labels[ch] ?? ""}
                        placeholder={`Ch ${ch + 1}`}
                        onChange={(e) => setLabel(ch, e.target.value)}
                        className="w-full bg-transparent text-[12px] font-semibold text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none"
                      />
                    </div>
                    <div className="px-2 text-[9px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)]">Ch {ch + 1}</div>

                    <div className="mx-2 mt-1.5 mb-2 relative rounded-md overflow-hidden" style={{ height: 96, background: "rgba(0,0,0,0.35)" }}>
                      <div className="absolute inset-x-0 bottom-0" style={{
                        height: `${rmsPct}%`,
                        background: "linear-gradient(180deg, var(--color-success), color-mix(in oklab, var(--color-success) 55%, transparent))",
                      }} />
                      {isActive && (
                        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-success)" }} />
                      )}
                    </div>

                    <div className="p-2 pt-1.5">
                      <button
                        onClick={() => chooseLead(ch)}
                        title="Set as the mic the AI listens to"
                        className="w-full h-7 inline-flex items-center justify-center gap-1 rounded-md text-[10px] font-semibold transition-colors"
                        style={isLead
                          ? { background: "var(--color-brand)", color: "var(--color-primary-foreground)" }
                          : { background: "var(--color-panel)", color: "var(--color-muted-foreground)", border: "1px solid var(--color-border)" }}
                      >
                        <Crown className="w-3 h-3" /> Lead
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between px-5 py-3 border-t" style={{ borderColor: "var(--color-border)" }}>
            <div className="text-[11px] text-[var(--color-muted-foreground)]">
              {lead != null
                ? <>AI is listening to <span className="font-semibold" style={{ color: "var(--color-brand)" }}>{labels[lead] || `Ch ${lead + 1}`}</span>.</>
                : <>No lead set — the AI hears the summed mix. Pick a Lead for cleaner detection.</>}
            </div>
            <button onClick={onClose} className="h-8 px-4 rounded-md text-[12px] font-semibold" style={{ background: "var(--color-brand)", color: "var(--color-primary-foreground)" }}>
              Done
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
