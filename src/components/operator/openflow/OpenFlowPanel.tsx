"use client";
/*
 * OpenFlowPanel — the center-panel host for OpenFlow. Applies the .openflow-scope
 * token layer + the OpenFlow font variables, owns the conversation state, and
 * swaps between the welcome screen (no messages) and the chat thread. Rendered
 * by ProOperatorShell when centerMode === "openflow".
 *
 * Increment 1 scope: Chat mode streaming from Groq with real church context.
 * Service Builder / Scripture / Songs / Image and their cards arrive next.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { openFlowFontVars } from "@/lib/openflow/fonts";
import { OpenFlowGradientDefs } from "./OpenFlowMark";
import { OpenFlowShader } from "./OpenFlowShader";
import { OpenFlowHeader } from "./OpenFlowHeader";
import { OpenFlowHistory } from "./OpenFlowHistory";
import { OpenFlowWelcome } from "./OpenFlowWelcome";
import { OpenFlowChat } from "./OpenFlowChat";
import { useOpenFlowChat, type OpenFlowMode } from "@/hooks/useOpenFlowChat";
import type { OpenFlowActions } from "@/lib/openflow/types";
import type { OperatorShellCtx } from "../shell/types";

const SEEN_KEY = "pf.openflow.seen.v1";

export function OpenFlowPanel({ ctx }: { ctx: OperatorShellCtx }) {
  const router = useRouter();
  const { messages, streaming, error, send, stop, reset, conversationId, loadConversation } = useOpenFlowChat();
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<OpenFlowMode>("chat");
  const [historyOpen, setHistoryOpen] = useState(false);
  // Bump to refetch the history list — when a conversation is created/switched
  // (its id changes) or when a turn finishes streaming (a save just happened).
  const [historyReload, setHistoryReload] = useState(0);
  useEffect(() => { setHistoryReload((k) => k + 1); }, [conversationId]);
  useEffect(() => { if (!streaming) setHistoryReload((k) => k + 1); }, [streaming]);
  const [church, setChurch] = useState<{ churchName: string; greeting: string; configured: boolean }>({ churchName: "your church", greeting: "Welcome", configured: true });
  const [showFirstRun, setShowFirstRun] = useState(true);

  // New conversation / "back to the first OpenFlow screen". A1: an in-memory
  // reset (persisted history + a conversation rail arrive in A2/A3, which reuse
  // this same entry point).
  const newChat = () => {
    if (streaming) stop();
    reset();
    setDraft("");
    setMode("chat");
  };

  // First-run pills only until OpenFlow has been used once (per browser).
  useEffect(() => {
    try { if (sessionStorage.getItem(SEEN_KEY) === "1") setShowFirstRun(false); } catch { /* no storage */ }
  }, []);

  // Church name + greeting for the welcome screen.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/openflow/context")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.churchName) setChurch({ churchName: d.churchName, greeting: d.greeting || "Welcome", configured: d.configured !== false }); })
      .catch(() => { /* keep default greeting */ });
    return () => { cancelled = true; };
  }, []);

  const markSeen = () => {
    setShowFirstRun(false);
    try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* ignore */ }
  };

  const submit = () => {
    const text = draft;
    if (!text.trim() || streaming) return;
    setDraft("");
    markSeen();
    void send(text, mode);
  };

  const sendPill = (text: string) => {
    if (streaming) return;
    setDraft("");
    markSeen();
    void send(text, mode);
  };

  // Actions the structured cards use to touch the real service. Rebuilt only
  // when the plan or send fn changes.
  const actions: OpenFlowActions = useMemo(() => ({
    planId: ctx.planId,
    appearance: ctx.appearance,
    background: ctx.background ?? null,
    projectScripture: (verses, reference) => {
      const text = verses.map((v) => v.text).join(" ").trim();
      if (!text) return;
      ctx.onSendSlideToLive({ kind: "text", text, reference });
    },
    onApplied: () => router.refresh(),
    onSeedComposer: (seed) => setDraft(seed),
    onRegenerate: () => {
      if (streaming) return;
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      // Regenerate lives only on the service-plan card, so always re-run in
      // service_builder mode even if the composer's mode was changed since.
      if (lastUser) void send(lastUser.content, "service_builder");
    },
  }), [ctx, router, messages, send, streaming]);

  const started = messages.length > 0;
  // A1 conversation title = the first thing the operator asked (trimmed). A2/A3
  // replace this with a stored, auto-generated title.
  const title = useMemo(() => {
    const first = messages.find((m) => m.role === "user")?.content?.trim();
    if (!first) return null;
    return first.length > 48 ? `${first.slice(0, 48)}…` : first;
  }, [messages]);

  return (
    <div className={`of-panel openflow-scope ${openFlowFontVars}`} data-started={started ? "true" : "false"}>
      <OpenFlowGradientDefs />
      {/* One ambient shader behind the whole panel — bold on the welcome screen,
          gently dimmed once a conversation is live (CSS keys off data-started),
          so OpenFlow always feels alive without the jarring full-screen wipe. */}
      <OpenFlowShader className="of-ambient" />

      <OpenFlowHeader
        started={started}
        title={title}
        onNewChat={newChat}
        onOpenHistory={() => setHistoryOpen(true)}
      />

      <OpenFlowHistory
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelect={(id) => { void loadConversation(id); }}
        onNewChat={newChat}
        activeId={conversationId}
        reloadKey={historyReload}
      />

      {started ? (
        <OpenFlowChat
          messages={messages}
          streaming={streaming}
          error={error}
          value={draft}
          onChange={setDraft}
          onSend={submit}
          onStop={stop}
          mode={mode}
          onModeChange={setMode}
          actions={actions}
        />
      ) : (
        <OpenFlowWelcome
          churchName={church.churchName}
          greeting={church.greeting}
          configured={church.configured}
          value={draft}
          onChange={setDraft}
          onSend={submit}
          onPill={sendPill}
          mode={mode}
          onModeChange={setMode}
          disabled={streaming}
          showFirstRun={showFirstRun}
        />
      )}
    </div>
  );
}
