"use client";
/*
 * OpenFlow welcome — the first screen before a conversation starts. Shader-lit,
 * with the OpenFlow lockup, a time-aware greeting to the church, the composer,
 * and (first run only) a row of starting-point pills.
 */
import { IconLayoutList, IconPhoto, IconBook2, IconMusic } from "@tabler/icons-react";
import { OpenFlowShader } from "./OpenFlowShader";
import { OpenFlowMark, OpenFlowWordmark } from "./OpenFlowMark";
import { OpenFlowInput } from "./OpenFlowInput";
import type { OpenFlowMode } from "@/hooks/useOpenFlowChat";

function greetingWord(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const PILLS = [
  { icon: <IconLayoutList size={14} stroke={1.7} />, text: "Build a Sunday service" },
  { icon: <IconPhoto size={14} stroke={1.7} />, text: "Suggest an idea for a convention graphic" },
  { icon: <IconBook2 size={14} stroke={1.7} />, text: "What does the Hebrew word Chesed mean?" },
  { icon: <IconMusic size={14} stroke={1.7} />, text: "Recommend songs about grace" },
];

export function OpenFlowWelcome({
  churchName, greeting, configured = true, value, onChange, onSend, onPill, mode, onModeChange, disabled, showFirstRun,
}: {
  churchName: string;
  greeting?: string;
  configured?: boolean;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onPill: (text: string) => void;
  mode: OpenFlowMode;
  onModeChange: (m: OpenFlowMode) => void;
  disabled?: boolean;
  showFirstRun: boolean;
}) {
  return (
    <div className="of-hero of-fade">
      <OpenFlowShader className="of-shader" />
      <div className="of-scrim" />
      <div className="of-hero-inner">
        <div className="of-lockup">
          <OpenFlowMark size={46} />
          <OpenFlowWordmark />
        </div>
        <h1 className="of-greeting">{greeting ?? greetingWord()}, {churchName}.</h1>
        {configured ? (
          <p className="of-brag">Ask for anything. <span className="hot">I already know your church.</span></p>
        ) : (
          <p className="of-brag" style={{ color: "var(--of-muted)" }}>OpenFlow needs a server key before it can chat. Ask your admin to set it up.</p>
        )}

        <OpenFlowInput
          value={value}
          onChange={onChange}
          onSend={onSend}
          mode={mode}
          onModeChange={onModeChange}
          disabled={disabled || !configured}
          autoFocus
        />

        {showFirstRun && configured ? (
          <>
            <div className="of-pills">
              {PILLS.map((p) => (
                <button key={p.text} type="button" className="of-pill" onClick={() => onPill(p.text)} disabled={disabled}>
                  {p.icon}{p.text}
                </button>
              ))}
            </div>
            <p className="of-firstrun">First run only — these fade once you have used OpenFlow</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
