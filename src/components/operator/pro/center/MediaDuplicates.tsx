"use client";
/**
 * Duplicate media — small yellow caution badge + a resolve dialog (2026-09-23).
 *
 * Shared by MediaBrowser (center) and MediaBinSection (dock) so both surfaces
 * flag and clean duplicates identically. The dialog lets the operator pick
 * WHICH copy to keep (default: the one currently set as the background, else
 * the oldest — the one most likely already in playlists), then removes the
 * rest via `removeDuplicateMedia`, which re-points playlist items to the kept
 * copy before deleting — cleaning duplicates never drops a playlist item.
 */
import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, X, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { removeDuplicateMedia } from "@/lib/actions";
import { notifyMediaChanged } from "@/lib/media-sync";
import { readActiveBackgroundId, removeCustomBackground } from "@/backgrounds/store/backgroundStore";
import { clearMediaFrame, loadMediaFrame, saveMediaFrame } from "./mediaFrame";

export type DupAsset = {
  id: string;
  fileName: string;
  kind: string;
  sizeBytes: number;
  createdAt?: string;
  url: string;
  thumbUrl?: string;
  mediaKey?: string;
};

/** True when this asset is on the projector right now (the live slide carries
 *  its storage key inside the presigned URL). Used to LOCK it as "keep". */
export function isAssetLive(liveSlide: unknown, a: { mediaKey?: string | null }): boolean {
  if (!a.mediaKey || !liveSlide) return false;
  try { return JSON.stringify(liveSlide).includes(a.mediaKey); } catch { return false; }
}

/** Small yellow caution triangle shown on a tile that has duplicates. */
export function DuplicateBadge({ copies, onClick, className }: { copies: number; onClick: () => void; className?: string }) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Duplicate — ${copies} copies. Click to review`}
      title={`Duplicate — you have ${copies} copies of this. Click to choose which to keep.`}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); onClick(); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onClick(); } }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        "z-10 inline-flex items-center gap-0.5 rounded px-1 h-5 cursor-pointer",
        "bg-black/70 text-[var(--color-warning)] ring-1 ring-[var(--color-warning)]/60 hover:bg-black/85",
        className,
      )}
    >
      <AlertTriangle className="w-3 h-3" />
      <span className="text-[10px] font-bold leading-none">{copies}</span>
    </span>
  );
}

/** Toolbar banner: "You have N duplicates — Review" (N = copies in duplicate
 *  groups, matching the tile badge count). Renders nothing when clean. */
export function DuplicatesBanner({ extra, onReview, compact }: { extra: number; onReview: () => void; compact?: boolean }) {
  if (extra <= 0) return null;
  return (
    <button
      type="button"
      onClick={onReview}
      title="Review duplicate media and choose which copies to delete"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-[var(--color-warning)]/50 bg-[var(--color-warning)]/10 text-[var(--color-warning)] font-semibold hover:bg-[var(--color-warning)]/20 transition-colors",
        compact ? "h-6 px-1.5 text-[10px]" : "h-8 px-2.5 text-[12px]",
      )}
    >
      <AlertTriangle className={compact ? "w-3 h-3" : "w-3.5 h-3.5"} />
      {compact ? `${extra} duplicate${extra === 1 ? "" : "s"}` : `You have ${extra} duplicate${extra === 1 ? "" : "s"} — Review`}
    </button>
  );
}

function defaultKeep(group: DupAsset[]): string {
  const active = (() => { try { return readActiveBackgroundId(); } catch { return ""; } })();
  const bg = group.find((a) => `media-bg-${a.id}` === active);
  return (bg ?? group[0]).id; // groups arrive oldest-first
}

const sigOf = (g: DupAsset[]) => g.map((a) => a.id).join(",");

export function MediaDuplicatesDialog({
  open, onClose, groups, churchId, onResolved, liveIds,
}: {
  open: boolean;
  onClose: () => void;
  groups: DupAsset[][];
  churchId: string | undefined;
  /** Called with the ids the SERVER actually removed. */
  onResolved: (removedIds: string[]) => void;
  /** Assets on the projector right now — locked as KEEP (never deleted mid-service). */
  liveIds?: Set<string>;
}) {
  // Local working copy: resolved groups drop out; the dialog closes when none remain.
  const [work, setWork] = useState<DupAsset[][]>([]);
  // Per-copy choice, keyed by asset id: true = delete. Every group always keeps >= 1.
  const [del, setDel] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const groupSig = useMemo(() => groups.map(sigOf).join("|"), [groups]);
  // Copies that must stay: on the projector now, or this machine's active background.
  const lockReason = (a: DupAsset): string | null => {
    if (liveIds?.has(a.id)) return "ON SCREEN";
    try { if (readActiveBackgroundId() === `media-bg-${a.id}`) return "BACKGROUND"; } catch { /* ignore */ }
    return null;
  };
  useEffect(() => {
    if (!open) return;
    setWork(groups);
    const d: Record<string, boolean> = {};
    for (const g of groups) {
      const k = defaultKeep(g);
      for (const a of g) d[a.id] = a.id !== k && !lockReason(a);
    }
    setDel(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, groupSig]);

  const toggle = (g: DupAsset[], id: string) => setDel((p) => {
    const a = g.find((x) => x.id === id);
    if (a && lockReason(a)) return p; // in use right now — can't be deleted
    const next = { ...p, [id]: !p[id] };
    // Never allow deleting every copy — at least one must stay.
    if (g.every((a) => next[a.id])) return p;
    return next;
  });

  const totalCopies = work.reduce((n, g) => n + g.length, 0);
  const toDelete = work.reduce((n, g) => n + g.filter((a) => del[a.id] && !lockReason(a)).length, 0);

  const resolve = async (targets: DupAsset[][]) => {
    setBusy(true);
    const removed: string[] = [];
    const doneSigs = new Set<string>();
    let failed = 0;
    try {
      for (const g of targets) {
        // Re-check locks at DELETE time: a copy sent live / set as background
        // while this dialog was open must never be deleted.
        const isDel = (a: DupAsset) => !!del[a.id] && !lockReason(a);
        const keepers = g.filter((a) => !isDel(a));
        const drop = g.filter(isDel).map((a) => a.id);
        if (keepers.length === 0 || drop.length === 0) continue;
        const keepId = keepers[0].id;
        try {
          const res = await removeDuplicateMedia(keepId, drop);
          if (res?.ok) {
            const ids = res.data?.removedIds ?? [];
            removed.push(...ids);
            for (const id of ids) {
              // Carry a saved crop/frame over to the kept copy if it has none.
              const f = loadMediaFrame(churchId, id);
              if (f && !loadMediaFrame(churchId, keepId)) saveMediaFrame(churchId, keepId, f);
              clearMediaFrame(churchId, id);
              removeCustomBackground(`media-bg-${id}`);
            }
            doneSigs.add(sigOf(g));
          } else failed++;
        } catch { failed++; /* network drop — keep going, report below */ }
      }
    } finally {
      setBusy(false); // the dialog must ALWAYS be closable again
    }
    if (removed.length) {
      toast.success(`Deleted ${removed.length} duplicate${removed.length === 1 ? "" : "s"} — playlists and songs now use the copy you kept`);
      onResolved(removed);
      notifyMediaChanged();
    }
    if (failed) toast.error(`${failed} group${failed === 1 ? "" : "s"} couldn't be cleaned — try again`);
    const gone = new Set(removed);
    const remaining = work
      .filter((g) => !doneSigs.has(sigOf(g)))
      .map((g) => g.filter((a) => !gone.has(a.id)))
      .filter((g) => g.length > 1);
    setWork(remaining);
    if (remaining.length === 0) onClose();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[81] w-[min(640px,94vw)] max-h-[82vh] -translate-x-1/2 -translate-y-1/2 flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-elevated)] shadow-[var(--shadow-lg)]"
        >
          <div className="flex items-start gap-2 px-4 pt-4 pb-3 border-b border-[var(--color-border)]">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-[var(--color-warning)] shrink-0" />
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-[14px] font-semibold text-[var(--color-foreground)]">
                {work.length === 1
                  ? `You currently have ${totalCopies} duplicates of this`
                  : `You currently have ${totalCopies} duplicates across ${work.length} files`}
              </Dialog.Title>
              <Dialog.Description className="text-[12px] text-[var(--color-muted-foreground)] mt-0.5">
                Same name, type and size. Tap a copy to switch it between KEEP and DELETE — at least one always stays. Deleted copies disappear from Media and the Media Bin; playlists and songs that used them switch to a copy you keep.
              </Dialog.Description>
            </div>
            <Dialog.Close className="p-1 rounded hover:bg-[var(--color-muted)] text-[var(--color-muted-foreground)]" aria-label="Close" disabled={busy}>
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
            {work.map((g) => {
              const n = g.filter((a) => del[a.id] && !lockReason(a)).length;
              return (
                <div key={sigOf(g)} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-[var(--color-foreground)] truncate flex-1" title={g[0].fileName}>
                      {g[0].fileName} <span className="text-[var(--color-warning)]">· {g.length} copies</span>
                    </span>
                    <button
                      type="button"
                      disabled={busy || n === 0}
                      onClick={() => void resolve([g])}
                      className="shrink-0 h-7 px-2.5 rounded-md text-[11px] font-semibold bg-[var(--color-destructive)]/15 text-[var(--color-destructive)] border border-[var(--color-destructive)]/40 hover:bg-[var(--color-destructive)]/25 disabled:opacity-50"
                    >
                      Delete {n}, keep {g.length - n}
                    </button>
                  </div>
                  <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}>
                    {g.map((a) => {
                      const lock = lockReason(a);
                      const kept = !del[a.id] || !!lock;
                      return (
                        <button
                          key={a.id}
                          type="button"
                          disabled={busy}
                          onClick={() => toggle(g, a.id)}
                          aria-pressed={!kept}
                          aria-label={`${a.fileName} — ${kept ? "keep" : "delete"}. Tap to switch.`}
                          className={cn(
                            "relative aspect-video rounded-md overflow-hidden bg-black text-left",
                            kept ? "ring-2 ring-[var(--color-brand)]" : "ring-2 ring-[var(--color-destructive)] opacity-60 hover:opacity-90",
                          )}
                        >
                          {a.kind.startsWith("video") ? (
                            // eslint-disable-next-line jsx-a11y/media-has-caption
                            <video src={`${a.url}#t=0.1`} className="w-full h-full object-contain" muted playsInline preload="metadata" />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={a.thumbUrl ?? a.url} alt={a.fileName} loading="lazy" className="w-full h-full object-contain" />
                          )}
                          <span className={cn(
                            "absolute left-1 top-1 inline-flex items-center gap-0.5 rounded px-1 h-4 text-[9px] font-bold",
                            kept ? "bg-[var(--color-brand)] text-white" : "bg-[var(--color-destructive)] text-white",
                          )}>
                            {kept ? <><Check className="w-2.5 h-2.5" /> {lock ? `KEEP · ${lock}` : "KEEP"}</> : <><Trash2 className="w-2.5 h-2.5" /> DELETE</>}
                          </span>
                          {a.createdAt && (
                            <span className="absolute bottom-0 inset-x-0 bg-black/60 px-1 py-0.5 text-[9px] text-white/80 truncate">
                              Added {new Date(a.createdAt).toLocaleDateString()}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-border)]">
            <button type="button" disabled={busy} onClick={onClose}
              className="h-8 px-3 rounded-md text-[12px] font-medium text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]">
              Keep everything
            </button>
            {work.length > 1 && (
              <button type="button" disabled={busy || toDelete === 0} onClick={() => void resolve(work)}
                className="h-8 px-3 rounded-md text-[12px] font-semibold bg-[var(--color-destructive)] text-white hover:opacity-90 disabled:opacity-50">
                {busy ? "Deleting…" : `Delete all ${toDelete} marked`}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
