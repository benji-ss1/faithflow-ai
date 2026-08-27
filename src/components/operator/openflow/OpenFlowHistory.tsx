"use client";
/*
 * OpenFlowHistory — the conversation rail (A2). A left drawer over the OpenFlow
 * panel that lists this church's saved conversations (pinned first, then most
 * recent), grouped by day. Restore one by clicking it; rename / pin / delete via
 * hover actions; "New chat" returns to the welcome screen. All reads/writes are
 * church-scoped server actions and fail-soft (no history if the table is absent).
 */
import { useCallback, useEffect, useState } from "react";
import {
  IconPlus, IconX, IconTrash, IconPencil, IconPin, IconPinFilled, IconMessageCircle, IconCheck,
} from "@tabler/icons-react";
import {
  listOpenFlowConversations, renameOpenFlowConversation, deleteOpenFlowConversation,
  setOpenFlowConversationPinned, type OpenFlowConversationSummary,
} from "@/lib/openflow/conversations";

function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days < 7 ? `${days}d ago` : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function groupOf(iso: string): "Pinned" | "Today" | "Yesterday" | "Earlier" {
  const d = new Date(iso); const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (day(now) - day(d)) / 86400000;
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  return "Earlier";
}

export function OpenFlowHistory({
  open, onClose, onSelect, onNewChat, activeId, reloadKey,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  activeId: string | null;
  reloadKey: number; // bump to refetch (e.g. after a turn is saved)
}) {
  const [rows, setRows] = useState<OpenFlowConversationSummary[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const load = useCallback(() => {
    listOpenFlowConversations().then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(() => { if (open) load(); }, [open, reloadKey, load]);
  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const commitRename = async (id: string) => {
    const title = draft.trim();
    setEditing(null);
    if (!title) return;
    setRows((r) => r?.map((c) => (c.id === id ? { ...c, title } : c)) ?? r);
    await renameOpenFlowConversation(id, title);
  };
  const doDelete = async (id: string) => {
    setConfirmDel(null);
    setRows((r) => r?.filter((c) => c.id !== id) ?? r);
    await deleteOpenFlowConversation(id);
    if (id === activeId) onNewChat();
  };
  const togglePin = async (c: OpenFlowConversationSummary) => {
    setRows((r) => r?.map((x) => (x.id === c.id ? { ...x, pinned: !x.pinned } : x)) ?? r);
    await setOpenFlowConversationPinned(c.id, !c.pinned);
    load();
  };

  if (!open) return null;

  const groups: Record<string, OpenFlowConversationSummary[]> = {};
  for (const c of rows ?? []) {
    const g = c.pinned ? "Pinned" : groupOf(c.updatedAt);
    (groups[g] ||= []).push(c);
  }
  const order = ["Pinned", "Today", "Yesterday", "Earlier"].filter((g) => groups[g]?.length);

  return (
    <div className="of-hist-overlay" role="dialog" aria-label="Conversation history" aria-modal="true">
      <button type="button" className="of-hist-scrim" aria-label="Close history" onClick={onClose} />
      <aside className="of-hist">
        <header className="of-hist-head">
          <span className="of-hist-title">History</span>
          <button type="button" className="of-hist-x" onClick={onClose} aria-label="Close"><IconX size={16} /></button>
        </header>

        <button type="button" className="of-hist-new" onClick={() => { onNewChat(); onClose(); }}>
          <IconPlus size={16} stroke={2.2} /> New chat
        </button>

        <div className="of-hist-list">
          {rows === null ? (
            <p className="of-hist-empty">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="of-hist-empty-state">
              <IconMessageCircle size={26} stroke={1.6} />
              <p>No conversations yet.<br />Your chats with OpenFlow will show up here.</p>
            </div>
          ) : (
            order.map((g) => (
              <div key={g} className="of-hist-group">
                <div className="of-hist-glabel">{g}</div>
                {groups[g].map((c) => (
                  <div key={c.id} className={`of-hist-row${c.id === activeId ? " active" : ""}`}>
                    {editing === c.id ? (
                      <input
                        autoFocus
                        className="of-hist-rename"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => commitRename(c.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); void commitRename(c.id); }
                          else if (e.key === "Escape") { e.preventDefault(); setEditing(null); }
                        }}
                        maxLength={80}
                      />
                    ) : (
                      <button type="button" className="of-hist-open" onClick={() => { onSelect(c.id); onClose(); }} title={c.title}>
                        <span className="of-hist-name">{c.title}</span>
                        <span className="of-hist-meta">{relTime(c.updatedAt)} · {c.messageCount} msg{c.messageCount === 1 ? "" : "s"}</span>
                      </button>
                    )}
                    <div className="of-hist-actions">
                      <button type="button" title={c.pinned ? "Unpin" : "Pin"} aria-label={c.pinned ? "Unpin" : "Pin"} onClick={() => togglePin(c)}>
                        {c.pinned ? <IconPinFilled size={15} /> : <IconPin size={15} />}
                      </button>
                      <button type="button" title="Rename" aria-label="Rename" onClick={() => { setEditing(c.id); setDraft(c.title); }}>
                        <IconPencil size={15} />
                      </button>
                      {confirmDel === c.id ? (
                        <button type="button" className="of-hist-confirm" title="Confirm delete" aria-label="Confirm delete" onClick={() => doDelete(c.id)}>
                          <IconCheck size={15} />
                        </button>
                      ) : (
                        <button type="button" title="Delete" aria-label="Delete" onClick={() => setConfirmDel(c.id)}>
                          <IconTrash size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
