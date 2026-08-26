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
import { useEffect, useState } from "react";
import { openFlowFontVars } from "@/lib/openflow/fonts";
import { OpenFlowGradientDefs } from "./OpenFlowMark";
import { OpenFlowWelcome } from "./OpenFlowWelcome";
import { OpenFlowChat } from "./OpenFlowChat";
import { useOpenFlowChat, type OpenFlowMode } from "@/hooks/useOpenFlowChat";

const SEEN_KEY = "pf.openflow.seen.v1";

export function OpenFlowPanel() {
  const { messages, streaming, error, send, stop } = useOpenFlowChat();
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<OpenFlowMode>("chat");
  const [church, setChurch] = useState<{ churchName: string; greeting: string; configured: boolean }>({ churchName: "your church", greeting: "Welcome", configured: true });
  const [showFirstRun, setShowFirstRun] = useState(true);

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

  const started = messages.length > 0;

  return (
    <div className={`of-panel openflow-scope ${openFlowFontVars}`}>
      <OpenFlowGradientDefs />
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
