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
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { openFlowFontVars } from "@/lib/openflow/fonts";
import { OpenFlowGradientDefs } from "./OpenFlowMark";
import { OpenFlowWelcome } from "./OpenFlowWelcome";
import { OpenFlowChat } from "./OpenFlowChat";
import { useOpenFlowChat, type OpenFlowMode } from "@/hooks/useOpenFlowChat";
import type { OpenFlowActions } from "@/lib/openflow/types";
import type { OperatorShellCtx } from "../shell/types";

const SEEN_KEY = "pf.openflow.seen.v1";

export function OpenFlowPanel({ ctx }: { ctx: OperatorShellCtx }) {
  const router = useRouter();
  const { messages, streaming, error, send, stop } = useOpenFlowChat();
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<OpenFlowMode>("chat");
  const [church, setChurch] = useState<{ churchName: string; greeting: string; configured: boolean }>({ churchName: "your church", greeting: "Welcome", configured: true });
  const [showFirstRun, setShowFirstRun] = useState(true);
  // Mode transition — an ember shader-like sweep across the panel when the
  // operator switches Chat -> Service Builder -> Scripture etc.
  const [wipe, setWipe] = useState(0);
  const prevMode = useRef(mode);
  useEffect(() => {
    if (prevMode.current === mode) return;
    prevMode.current = mode;
    setWipe((w) => w + 1);
    const t = setTimeout(() => setWipe(0), 650);
    return () => clearTimeout(t);
  }, [mode]);

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

  return (
    <div className={`of-panel openflow-scope ${openFlowFontVars}`}>
      <OpenFlowGradientDefs />
      {wipe > 0 ? <div key={wipe} className="of-mode-wipe" aria-hidden="true" /> : null}
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
