"use client";
import { useEffect, useState } from "react";

const KEY = "presentflow.pro.messages.v1";

type MsgState = {
  text: string;
  dismiss: string;
  allowWeb: boolean;
};

const DEFAULT: MsgState = { text: "", dismiss: "manual", allowWeb: false };

export function MessagesTab() {
  const [state, setState] = useState<MsgState>(DEFAULT);
  const [showing, setShowing] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) setState({ ...DEFAULT, ...JSON.parse(raw) });
    } catch { /* noop */ }
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* noop */ }
  }, [state]);

  return (
    <div className="flex flex-col gap-3">
      <button data-todo="1" className="h-9 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-elevated)]">
        + New Message
      </button>
      <div className="eyebrow">Message Detail</div>
      <textarea
        value={state.text}
        onChange={(e) => setState({ ...state, text: e.target.value })}
        rows={3}
        className="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2 py-1"
        placeholder="Message text…"
      />
      <div className="flex items-center gap-2">
        <button data-todo="1" className="flex-1 h-8 rounded border border-[var(--color-border)]">Upload</button>
        <select data-todo="1" className="flex-1 h-8 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded">
          <option>Add Token…</option>
          <option>Time</option>
          <option>Date</option>
          <option>Current Slide</option>
        </select>
      </div>
      <div>
        <div className="eyebrow mb-1">Theme</div>
        <div className="h-10 rounded border border-[var(--color-border)] bg-[var(--color-panel)]" />
      </div>
      <div>
        <div className="eyebrow mb-1">Dismiss</div>
        <select
          value={state.dismiss}
          onChange={(e) => setState({ ...state, dismiss: e.target.value })}
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
          onChange={(e) => setState({ ...state, allowWeb: e.target.checked })}
        />
        Allow Web Notifications
      </label>
      <button
        onClick={() => setShowing((v) => !v)}
        className="h-9 rounded-md bg-[var(--color-brand)] text-black font-semibold"
      >
        {showing ? "Hide" : "Show"}
      </button>
    </div>
  );
}
