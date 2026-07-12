"use client";
import { useEffect, useRef } from "react";
import type { MessagesApi } from "../../hooks";

const DISMISS_MS: Record<string, number> = {
  "5s": 5000, "10s": 10000, "30s": 30000, "1min": 60000, "5min": 300000,
};

export function MessagesTab({ api }: { api: MessagesApi }) {
  const { state, setText, setDismiss, setAllowWeb, toggleShow } = api;
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-dismiss timer: when showing and dismiss !== manual, hide after N ms.
  useEffect(() => {
    if (!state.showing) return;
    const ms = DISMISS_MS[state.dismiss];
    if (!ms) return;
    const id = setTimeout(() => toggleShow(), ms);
    return () => clearTimeout(id);
  }, [state.showing, state.dismiss, toggleShow]);

  const insertToken = (token: string) => {
    const ta = taRef.current;
    if (!ta) { setText(state.text + token); return; }
    const s = ta.selectionStart ?? state.text.length;
    const e = ta.selectionEnd ?? state.text.length;
    setText(state.text.slice(0, s) + token + state.text.slice(e));
  };

  return (
    <div className="flex flex-col gap-3">
      <button data-todo="1" title="Presets coming soon" disabled className="h-9 rounded-md border border-[var(--color-border)] opacity-50 cursor-not-allowed">
        + New Message
      </button>
      <div className="eyebrow">Message Detail</div>
      <textarea
        ref={taRef}
        value={state.text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2 py-1"
        placeholder="Message text…"
      />
      <div className="flex items-center gap-2">
        <button data-todo="1" title="Upload — coming soon" disabled className="flex-1 h-8 rounded border border-[var(--color-border)] opacity-50 cursor-not-allowed">Upload</button>
        <select
          onChange={(e) => {
            const v = e.target.value;
            if (v) insertToken(v);
            e.target.value = "";
          }}
          className="flex-1 h-8 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded"
          defaultValue=""
        >
          <option value="">Add Token…</option>
          <option value="{{time}}">Time</option>
          <option value="{{date}}">Date</option>
          <option value="{{currentSlide}}">Current Slide</option>
        </select>
      </div>
      <div>
        <div className="eyebrow mb-1">Theme</div>
        <div className="h-10 rounded border border-[var(--color-border)] bg-[var(--color-panel)]" title="Themes coming soon" />
      </div>
      <div>
        <div className="eyebrow mb-1">Dismiss</div>
        <select
          value={state.dismiss}
          onChange={(e) => setDismiss(e.target.value)}
          className="w-full h-8 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded"
        >
          <option value="manual">Manually</option>
          <option value="5s">5s</option>
          <option value="10s">10s</option>
          <option value="30s">30s</option>
          <option value="1min">1min</option>
          <option value="5min">5min</option>
        </select>
      </div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={state.allowWeb}
          onChange={(e) => setAllowWeb(e.target.checked)}
        />
        Allow Web Notifications
      </label>
      <button
        onClick={toggleShow}
        className="h-9 rounded-md bg-[var(--color-brand)] text-black font-semibold"
      >
        {state.showing ? "Hide" : "Show"}
      </button>
      {state.showing && (
        <div className="text-[10px] text-center text-[var(--color-muted-foreground)]">
          Message active {state.dismiss !== "manual" && `(auto-dismiss in ${state.dismiss})`}
        </div>
      )}
    </div>
  );
}
