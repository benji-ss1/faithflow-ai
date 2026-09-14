"use client";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Plus, Trash2, Loader2, ChevronUp, ChevronDown, X, Tag } from "lucide-react";
import { toast } from "sonner";
import {
  getSongArrangementModel,
  createSongGroup,
  renameSongGroup,
  recolorSongGroup,
  deleteSongGroup,
  assignSlidesToGroup,
  createArrangement,
  renameArrangement,
  deleteArrangement,
  reorderArrangement,
} from "@/lib/actions";
import { GROUP_KINDS, GROUP_KIND_COLORS, groupColor } from "@/engine/arrangements";

type Group = { id: string; name: string; kind: string; color: string | null; order: number };
type Arrangement = { id: string; name: string; isDefault: boolean; order: string[]; sort: number };
type SlideGroup = { slideId: string; groupId: string | null };
type SlideMeta = { id: string; lyrics: string };

/**
 * Groups & Arrangements manager (ProPresenter §12 / MVP §9). Functional, minimal,
 * ProPresenter-familiar. Lives under the song editor. Honest empty states.
 *
 * KNOWN LIMIT (surfaced in the UI): the simple lyrics autosave editor above
 * (updateSongSlides) rewrites ALL slide rows on save, which reassigns slide ids
 * and clears their group. Assign groups AFTER the lyrics are settled; a full
 * lyric re-save clears assignments. Per-slide rich edits preserve groups.
 */
export function SongArrangements({ songId, slides, onChanged }: { songId: string; slides: SlideMeta[]; onChanged?: () => void }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [arrangements, setArrangements] = useState<Arrangement[]>([]);
  const [slideGroups, setSlideGroups] = useState<SlideGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [, startTransition] = useTransition();
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupKind, setNewGroupKind] = useState<string>("verse");
  const [activeArr, setActiveArr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await getSongArrangementModel(songId);
    if (res.ok && res.data) {
      setGroups(res.data.groups);
      setArrangements(res.data.arrangements);
      setSlideGroups(res.data.slideGroups);
    }
    setLoading(false);
  }, [songId]);

  useEffect(() => { reload(); }, [reload]);

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const slideGroupMap = useMemo(() => new Map(slideGroups.map((s) => [s.slideId, s.groupId])), [slideGroups]);

  function run(p: Promise<{ ok: boolean; error?: string }>, okMsg?: string) {
    startTransition(async () => {
      const res = await p;
      if (!res.ok) { toast.error(res.error ?? "Failed"); return; }
      if (okMsg) toast.success(okMsg);
      await reload();
      // Let an embedding surface (e.g. the operator shell's inline manager)
      // reflow its own view — the library page ignores this (server-rendered).
      onChanged?.();
    });
  }

  // ── Group actions ──
  function addGroup() {
    const name = newGroupName.trim();
    if (!name) { toast.error("Group name required"); return; }
    run(createSongGroup(songId, name, newGroupKind), "Group added");
    setNewGroupName("");
  }

  const activeArrangement = arrangements.find((a) => a.id === activeArr) ?? null;

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]"><Loader2 className="w-4 h-4 animate-spin" /> Loading arrangements…</div>;
  }

  return (
    <div className="space-y-8">
      {/* GROUPS */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-[var(--color-muted-foreground)]" />
          <h3 className="text-sm font-medium text-[var(--color-foreground)]">Groups</h3>
          <span className="text-xs text-[var(--color-muted-foreground)]">Name sections (Verse 1, Chorus…) so you can reorder them without duplicating slides.</span>
        </div>

        {groups.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)] italic">No groups yet. Add one below, then tag slides with it.</p>
        ) : (
          <ul className="space-y-2">
            {groups.map((g) => (
              <li key={g.id} className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: groupColor(g) }} />
                <input
                  defaultValue={g.name}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== g.name) run(renameSongGroup(g.id, v)); }}
                  className="text-sm bg-transparent border border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-border)] rounded px-2 py-1 outline-none"
                />
                <select
                  value={(GROUP_KINDS as readonly string[]).includes(g.kind) ? g.kind : "custom"}
                  onChange={(e) => run(recolorSongGroup(g.id, g.color, e.target.value))}
                  className="text-xs bg-[var(--color-panel)] border border-[var(--color-border)] rounded px-1.5 py-1"
                >
                  {GROUP_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <div className="flex items-center gap-1">
                  {Object.values(GROUP_KIND_COLORS).map((c) => (
                    <button
                      key={c}
                      title={c}
                      onClick={() => run(recolorSongGroup(g.id, c))}
                      className="w-4 h-4 rounded-full border border-[var(--color-border)]"
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <button
                  onClick={() => run(deleteSongGroup(g.id), "Group deleted")}
                  className="ml-auto p-1 text-[var(--color-muted-foreground)] hover:text-red-500"
                  title="Delete group (slides are kept, just ungrouped)"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2">
          <input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addGroup(); }}
            placeholder="Group name (e.g. Verse 1)"
            className="text-sm bg-[var(--color-panel)] border border-[var(--color-border)] rounded px-2 py-1.5 flex-1 max-w-xs outline-none"
          />
          <select value={newGroupKind} onChange={(e) => setNewGroupKind(e.target.value)} className="text-xs bg-[var(--color-panel)] border border-[var(--color-border)] rounded px-1.5 py-1.5">
            {GROUP_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <button onClick={addGroup} className="inline-flex items-center gap-1 text-sm px-2.5 py-1.5 rounded bg-[var(--color-brand)] text-white">
            <Plus className="w-4 h-4" /> Add group
          </button>
        </div>
      </section>

      {/* SLIDE → GROUP ASSIGNMENT */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-[var(--color-foreground)]">Tag slides</h3>
        {slides.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)] italic">This song has no slides yet.</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)] italic">Add a group first, then tag each slide.</p>
        ) : (
          <ul className="space-y-1.5">
            {slides.map((s, i) => {
              const gid = slideGroupMap.get(s.id) ?? null;
              const g = gid ? groupById.get(gid) : null;
              return (
                <li key={s.id} className="flex items-center gap-3 text-sm">
                  <span className="w-6 text-xs text-[var(--color-muted-foreground)] tabular-nums">{i + 1}</span>
                  {g && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: groupColor(g) }} />}
                  <span className="flex-1 truncate text-[var(--color-muted-foreground)]">{s.lyrics.split("\n")[0] || "(blank)"}</span>
                  <select
                    value={gid ?? ""}
                    onChange={(e) => run(assignSlidesToGroup(songId, [s.id], e.target.value || null))}
                    className="text-xs bg-[var(--color-panel)] border border-[var(--color-border)] rounded px-1.5 py-1"
                  >
                    <option value="">— ungrouped —</option>
                    {groups.map((gg) => <option key={gg.id} value={gg.id}>{gg.name}</option>)}
                  </select>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ARRANGEMENTS */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-[var(--color-foreground)]">Arrangements</h3>
            <span className="text-xs text-[var(--color-muted-foreground)]">Named orderings of your groups (Chorus can repeat). Master = natural slide order.</span>
          </div>
          <button
            onClick={() => run(createArrangement(songId, `Arrangement ${arrangements.length + 1}`).then((r) => { if (r.ok) setActiveArr((r as { data: { id: string } }).data.id); return r; }), "Arrangement created")}
            className="inline-flex items-center gap-1 text-sm px-2.5 py-1.5 rounded border border-[var(--color-border)]"
          >
            <Plus className="w-4 h-4" /> New arrangement
          </button>
        </div>

        {arrangements.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)] italic">No custom arrangements. Playlist items without one use the natural (master) order — exactly as today.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {arrangements.map((a) => (
              <button
                key={a.id}
                onClick={() => setActiveArr(a.id === activeArr ? null : a.id)}
                className={`text-sm px-3 py-1.5 rounded border ${a.id === activeArr ? "border-[var(--color-brand)] bg-[var(--color-brand)]/10" : "border-[var(--color-border)]"}`}
              >
                {a.name} <span className="text-xs text-[var(--color-muted-foreground)]">({a.order.length})</span>
              </button>
            ))}
          </div>
        )}

        {activeArrangement && (
          <ArrangementEditor
            key={activeArrangement.id}
            arrangement={activeArrangement}
            groups={groups}
            onRename={(name) => run(renameArrangement(activeArrangement.id, name))}
            onDelete={() => { run(deleteArrangement(activeArrangement.id), "Arrangement deleted"); setActiveArr(null); }}
            onSaveOrder={(order) => run(reorderArrangement(activeArrangement.id, order), "Arrangement saved")}
          />
        )}
      </section>
    </div>
  );
}

/** Two-row editor per MVP §9: available groups (top) → arrangement order (bottom).
 *  Click a group to append it (repeatable); reorder / remove in the bottom row. */
function ArrangementEditor({
  arrangement, groups, onRename, onDelete, onSaveOrder,
}: {
  arrangement: Arrangement;
  groups: Group[];
  onRename: (name: string) => void;
  onDelete: () => void;
  onSaveOrder: (order: string[]) => void;
}) {
  const [order, setOrder] = useState<string[]>(arrangement.order);
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const dirty = JSON.stringify(order) !== JSON.stringify(arrangement.order);

  function move(idx: number, dir: -1 | 1) {
    setOrder((cur) => {
      const j = idx + dir;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-[var(--color-border)] p-4 space-y-4 bg-[var(--color-panel)]/40">
      <div className="flex items-center gap-2">
        <input
          defaultValue={arrangement.name}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== arrangement.name) onRename(v); }}
          className="text-sm font-medium bg-transparent border border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-border)] rounded px-2 py-1 outline-none"
        />
        <button onClick={onDelete} className="ml-auto p-1 text-[var(--color-muted-foreground)] hover:text-red-500" title="Delete arrangement"><Trash2 className="w-4 h-4" /></button>
      </div>

      {/* Available groups */}
      <div>
        <div className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)] mb-1.5">Available groups — click to add</div>
        {groups.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)] italic">No groups yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => setOrder((cur) => [...cur, g.id])}
                className="inline-flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-full border border-[var(--color-border)] hover:bg-[var(--color-panel)]"
              >
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: groupColor(g) }} />
                {g.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Arrangement order */}
      <div>
        <div className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)] mb-1.5">Play order</div>
        {order.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)] italic">Empty — click groups above to build the order.</p>
        ) : (
          <ol className="space-y-1.5">
            {order.map((gid, idx) => {
              const g = groupById.get(gid);
              return (
                <li key={`${gid}-${idx}`} className="flex items-center gap-2 text-sm">
                  <span className="w-5 text-xs text-[var(--color-muted-foreground)] tabular-nums">{idx + 1}</span>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g ? groupColor(g) : "#888" }} />
                  <span className="flex-1">{g?.name ?? "(deleted group)"}</span>
                  <button onClick={() => move(idx, -1)} disabled={idx === 0} className="p-1 disabled:opacity-30"><ChevronUp className="w-4 h-4" /></button>
                  <button onClick={() => move(idx, 1)} disabled={idx === order.length - 1} className="p-1 disabled:opacity-30"><ChevronDown className="w-4 h-4" /></button>
                  <button onClick={() => setOrder((cur) => cur.filter((_, i) => i !== idx))} className="p-1 text-[var(--color-muted-foreground)] hover:text-red-500"><X className="w-4 h-4" /></button>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onSaveOrder(order)}
          disabled={!dirty}
          className="text-sm px-3 py-1.5 rounded bg-[var(--color-brand)] text-white disabled:opacity-40"
        >
          Save order
        </button>
        {dirty && <button onClick={() => setOrder(arrangement.order)} className="text-sm px-3 py-1.5 rounded border border-[var(--color-border)]">Reset</button>}
      </div>
    </div>
  );
}
