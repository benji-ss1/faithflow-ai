"use client";
/**
 * MessagesPanel (Wave 7) — the operator's dedicated Messages surface (rec6).
 * Combines:
 *   - the legacy single-message composer (existing MessagesTab, wire slot
 *     "default", authoritative for old projectors),
 *   - "Save as template" from the composer,
 *   - a template picker (activate / edit / delete) — church-persisted,
 *   - the ACTIVE-messages list with per-message hide + a Clear Messages cue.
 * The {{timer}} / {{timer:ID}} token in a template/message renders the bound
 * timer's live value on /live and /stage.
 * Tokens/lucide only — no emojis. Honest empty states.
 */
import { MessagesTab } from "./tabs/MessagesTab";
import type { MessagesApi, MessagesBoardApi } from "../hooks";
import { Play, Trash2, X, Bookmark } from "lucide-react";

export function MessagesPanel({ compose, board }: { compose: MessagesApi; board: MessagesBoardApi }) {
  const saveAsTemplate = async () => {
    const name = window.prompt("Template name?", compose.state.text.slice(0, 40) || "Message");
    if (!name) return;
    await board.addTemplate({
      name, text: compose.state.text, position: compose.state.position,
      config: {
        scroll: compose.state.scroll, scrollDir: compose.state.scrollDir,
        scrollSec: compose.state.scrollSec, allowWeb: compose.state.allowWeb,
        dismiss: compose.state.dismiss,
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="eyebrow mb-1">Compose</div>
        <MessagesTab api={compose} />
        <button
          onClick={saveAsTemplate}
          disabled={!compose.state.text.trim()}
          className="mt-2 w-full h-8 rounded border border-[var(--color-border)] text-[12px] flex items-center justify-center gap-1 disabled:opacity-40"
        >
          <Bookmark className="w-3.5 h-3.5" /> Save as template
        </button>
      </div>

      <div className="border-t border-[var(--color-border)] pt-3">
        <div className="eyebrow mb-2">Templates</div>
        {board.loadingTemplates ? (
          <div className="text-[11px] text-[var(--color-muted-foreground)] py-1">Loading templates…</div>
        ) : board.templates.length === 0 ? (
          <div className="text-[11px] text-[var(--color-muted-foreground)] py-1">
            No templates yet. Compose a message and press &ldquo;Save as template&rdquo; to reuse it.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {board.templates.map((t) => (
              <div key={t.id} className="flex items-center gap-1 rounded border border-[var(--color-border)] px-2 h-8">
                <span className="flex-1 truncate text-[12px]" title={t.text}>{t.name}</span>
                <button onClick={() => board.activateTemplate(t)} title="Show now" className="w-6 h-6 rounded flex items-center justify-center text-[var(--color-brand)]">
                  <Play className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => board.removeTemplate(t.id)} title="Delete template" className="w-6 h-6 rounded flex items-center justify-center text-red-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-[var(--color-border)] pt-3">
        <div className="flex items-center justify-between mb-2">
          <div className="eyebrow">Active messages</div>
          {board.active.length > 0 && (
            <button onClick={board.clearAll} className="text-[11px] text-red-400 hover:underline">Clear Messages</button>
          )}
        </div>
        {board.active.length === 0 ? (
          <div className="text-[11px] text-[var(--color-muted-foreground)] py-1">
            No extra messages showing. Activate a template above to show several at once.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {board.active.map((m) => (
              <div key={m.id} className="flex items-center gap-1 rounded border border-[var(--color-border)] px-2 h-8 bg-[var(--color-elevated)]">
                <span className="flex-1 truncate text-[12px]">{m.text}</span>
                <span className="text-[10px] text-[var(--color-muted-foreground)]">{m.position}</span>
                <button onClick={() => board.hide(m.id)} title="Hide" className="w-6 h-6 rounded flex items-center justify-center">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
