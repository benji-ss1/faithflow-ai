"use client";
/*
 * OpenFlow composer — autosizing textarea + attach/voice buttons, the mode
 * selector, and the solid send key. Shared by the welcome screen and the chat
 * dock. Enter sends; Shift+Enter is a newline. Attach/voice are placeholders
 * for Increment 1 (Phase 2 wires files + voice) and are visibly disabled so
 * they don't promise something that isn't there yet.
 */
import { useEffect, useRef, useState } from "react";
import {
  IconPlus, IconMicrophone, IconArrowUp, IconChevronDown, IconCheck,
  IconMessageCircle, IconLayoutList, IconPhoto, IconBook2, IconMusic,
} from "@tabler/icons-react";
import type { OpenFlowMode } from "@/hooks/useOpenFlowChat";

type ModeDef = { id: OpenFlowMode; label: string; icon: React.ReactNode; ready: boolean };

const MODES: ModeDef[] = [
  { id: "chat", label: "Chat", icon: <IconMessageCircle size={17} stroke={1.7} />, ready: true },
  { id: "service_builder", label: "Service Builder", icon: <IconLayoutList size={17} stroke={1.7} />, ready: true },
  { id: "scripture", label: "Scripture", icon: <IconBook2 size={17} stroke={1.7} />, ready: true },
  { id: "songs", label: "Songs", icon: <IconMusic size={17} stroke={1.7} />, ready: true },
  { id: "image_generator", label: "Image Generator", icon: <IconPhoto size={17} stroke={1.7} />, ready: false },
];

function ModeDropdown({ mode, onModeChange }: { mode: OpenFlowMode; onModeChange: (m: OpenFlowMode) => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const active = MODES.find((m) => m.id === mode) ?? MODES[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="of-dd-anchor" ref={anchorRef}>
      <button type="button" className="of-mode-pill" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}>
        {active.label}
        <IconChevronDown size={14} stroke={1.7} />
      </button>
      {open ? (
        <div className="of-dd" role="listbox" aria-label="OpenFlow mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={m.id === mode}
              className={`of-dd-item${m.id === mode ? " active" : ""}`}
              disabled={!m.ready}
              style={!m.ready ? { opacity: 0.45, cursor: "default" } : undefined}
              onClick={() => { if (m.ready) { onModeChange(m.id); setOpen(false); } }}
            >
              <span className="chk">{m.id === mode ? <IconCheck size={15} stroke={2.2} /> : null}</span>
              <span className="ic">{m.icon}</span>
              {m.label}
              {!m.ready ? <span style={{ marginLeft: "auto", fontFamily: "var(--of-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--of-faint)" }}>Soon</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function OpenFlowInput({
  value, onChange, onSend, mode, onModeChange, disabled, placeholder, autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  mode: OpenFlowMode;
  onModeChange: (m: OpenFlowMode) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Autosize.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [value]);

  useEffect(() => { if (autoFocus) taRef.current?.focus(); }, [autoFocus]);

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div className="of-composer-wrap">
      <div className="of-composer">
        <textarea
          ref={taRef}
          className="of-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "How can I help you prepare for Sunday?"}
          rows={1}
          spellCheck
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (canSend) onSend(); }
          }}
        />
        <div className="of-composer-row">
          <button type="button" className="of-icon-btn" aria-label="Attach a file (coming soon)" disabled title="Attach — coming soon">
            <IconPlus size={18} stroke={1.6} />
          </button>
          <button type="button" className="of-icon-btn" aria-label="Voice input (coming soon)" disabled title="Voice — coming soon">
            <IconMicrophone size={18} stroke={1.6} />
          </button>
          <span className="of-spacer" />
          <ModeDropdown mode={mode} onModeChange={onModeChange} />
          <button type="button" className="of-send" aria-label="Send" disabled={!canSend} onClick={() => { if (canSend) onSend(); }}>
            <IconArrowUp size={18} stroke={2} />
          </button>
        </div>
      </div>
    </div>
  );
}
