"use client";
import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Paperclip } from "lucide-react";
import { SectionHeader, Toggle } from "./DisplayTab";

export function FeedbackTab() {
  const [type, setType] = useState<"problem" | "feature">("problem");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [blocker, setBlocker] = useState(false);
  const [status, setStatus] = useState<{ kind: "idle" | "sending" | "ok" | "error"; msg?: string }>({ kind: "idle" });

  async function submit() {
    if (!message.trim()) {
      setStatus({ kind: "error", msg: "Message is required." });
      return;
    }
    setStatus({ kind: "sending" });
    try {
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type, email: email || undefined, message, blocker }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setStatus({ kind: "error", msg: j.error || `Failed (${r.status})` });
        return;
      }
      setStatus({ kind: "ok", msg: "Thanks — feedback received." });
      setMessage(""); setBlocker(false);
    } catch (e) {
      setStatus({ kind: "error", msg: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="space-y-5">
      <SectionHeader title="Send Feedback" description="Report a bug or request a feature." />

      <Tabs.Root value={type} onValueChange={(v) => setType(v as any)}>
        <Tabs.List className="inline-flex rounded-md p-0.5 mb-4" style={{ background: "#1a2020", border: "1px solid #2a3232" }}>
          {(["problem", "feature"] as const).map((k) => (
            <Tabs.Trigger
              key={k}
              value={k}
              className="h-7 px-3 rounded text-[11px] font-medium capitalize data-[state=active]:text-white text-zinc-400"
              style={type === k ? { background: "#f97316" } : {}}
            >
              {k === "problem" ? "Problem" : "Feature request"}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Email (optional)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@church.org"
              className="mt-1 w-full h-8 px-2 rounded-md border text-[11px] text-zinc-100 placeholder:text-zinc-500"
              style={{ borderColor: "#2a3232", background: "#1a2020" }}
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              {type === "problem" ? "Report a bug" : "Describe the feature"}
            </label>
            <textarea
              rows={6}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={type === "problem"
                ? `Steps: After my notes were generated, I clicked "All Templates." Expected: ... Actual: ...`
                : `Describe the feature you'd like…`}
              className="mt-1 w-full px-2 py-2 rounded-md border text-[11px] text-zinc-100 placeholder:text-zinc-500 resize-none"
              style={{ borderColor: "#2a3232", background: "#1a2020" }}
            />
          </div>

          <button
            disabled
            title="Coming soon"
            className="h-8 px-3 rounded-md border text-[11px] text-zinc-500 inline-flex items-center gap-2 cursor-not-allowed"
            style={{ borderColor: "#2a3232", background: "#171c1c" }}
          >
            <Paperclip className="w-3.5 h-3.5" /> + Add screenshot or video
          </button>

          {type === "problem" && (
            <div className="flex items-center justify-between py-2">
              <div className="text-[11px] text-zinc-300">This bug completely blocks me from using PresentFlow</div>
              <Toggle on={blocker} onChange={setBlocker} />
            </div>
          )}

          <button
            onClick={submit}
            disabled={status.kind === "sending"}
            className="w-full h-10 rounded-md text-[12px] font-semibold text-white disabled:opacity-60"
            style={{ background: "#f97316" }}
          >
            {status.kind === "sending" ? "Sending…" : type === "problem" ? "Report bug" : "Send request"}
          </button>

          {status.kind === "ok" && (
            <div className="text-[11px] text-emerald-400">{status.msg}</div>
          )}
          {status.kind === "error" && (
            <div className="text-[11px] text-red-400">{status.msg}</div>
          )}
        </div>
      </Tabs.Root>
    </div>
  );
}
