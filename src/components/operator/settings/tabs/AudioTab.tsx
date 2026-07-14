"use client";
import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, X, Plus } from "lucide-react";
import { SectionHeader, Row, Toggle } from "./DisplayTab";

const AUDIO_INPUT_KEY = "presentflow.pro.audioInput.v1";
const INPUT_GAIN_KEY = "presentflow.pro.inputGain.v1";
const TRANSCRIPTION_MODE_KEY = "presentflow.pro.transcriptionMode.v1";
const VOICE_COMMANDS_KEY = "presentflow.pro.voiceCommandsEnabled.v1";
const CUSTOM_COMMANDS_KEY = "presentflow.pro.voiceCommands.v1";

type AudioInputSel = { kind: "device" | "ndi"; id: string; label: string };

const NDI_PLACEHOLDERS = [
  { id: "ndi:JPDBROACASTCOMP", label: "JPDBROACASTCOMP (macOS AV Output)" },
  { id: "ndi:JPDBROPRESENTER", label: "JPDBROPRESENTER (JPD's Mac mini - NDI 1)" },
  { id: "ndi:JPDSBROASTAUDIO", label: "JPDSBROASTAUDIO (macOS AV Output)" },
];

const BUILT_IN_COMMANDS = ["next verse", "previous verse", "give me NIV", "show blank", "kill live", "go back"];
const ACTIONS = [
  { value: "next_verse", label: "Next verse" },
  { value: "prev_verse", label: "Previous verse" },
  { value: "give_me_niv", label: "Give me NIV" },
  { value: "blank_screen", label: "Show blank" },
  { value: "kill_live", label: "Kill live" },
];

type CustomCommand = { id: string; phrase: string; action: string };

export function AudioTab() {
  const [mode, setMode] = useState<"online" | "offline">("online");
  const [gain, setGain] = useState(75);
  const [voiceOn, setVoiceOn] = useState(true);
  const [selected, setSelected] = useState<AudioInputSel>({ kind: "ndi", id: "ndi:default", label: "NDI Audio (Routed)" });
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [ndiSources, setNdiSources] = useState<{ id: string; label: string }[]>(NDI_PLACEHOLDERS);
  const [customs, setCustoms] = useState<CustomCommand[]>([]);
  const [newPhrase, setNewPhrase] = useState("");
  const [newAction, setNewAction] = useState(ACTIONS[0].value);

  useEffect(() => {
    try {
      const m = localStorage.getItem(TRANSCRIPTION_MODE_KEY);
      if (m === "offline" || m === "online") setMode(m);
      const g = Number(localStorage.getItem(INPUT_GAIN_KEY));
      if (!Number.isNaN(g) && g > 0) setGain(g);
      const v = localStorage.getItem(VOICE_COMMANDS_KEY);
      setVoiceOn(v !== "0");
      const raw = localStorage.getItem(AUDIO_INPUT_KEY);
      if (raw) { try { setSelected(JSON.parse(raw)); } catch {} }
      const cRaw = localStorage.getItem(CUSTOM_COMMANDS_KEY);
      if (cRaw) { try { setCustoms(JSON.parse(cRaw)); } catch {} }
    } catch {}
    // enumerate devices
    if (navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then((all) => {
        setDevices(all.filter((d) => d.kind === "audioinput"));
      }).catch(() => {});
    }
    // NDI IPC probe
    try {
      const api = (window as any).electronAPI?.audio;
      if (api?.listNdiSources) {
        Promise.resolve(api.listNdiSources()).then((r: any) => {
          if (Array.isArray(r) && r.length) setNdiSources(r.map((s: any) => ({ id: s.id || s.name, label: s.label || s.name })));
        }).catch(() => {});
      }
    } catch {}
  }, []);

  function persistSelection(sel: AudioInputSel) {
    setSelected(sel);
    try { localStorage.setItem(AUDIO_INPUT_KEY, JSON.stringify(sel)); } catch {}
  }
  function persistCustoms(next: CustomCommand[]) {
    setCustoms(next);
    try { localStorage.setItem(CUSTOM_COMMANDS_KEY, JSON.stringify(next)); } catch {}
  }
  function addCustom() {
    if (!newPhrase.trim()) return;
    persistCustoms([...customs, { id: crypto.randomUUID(), phrase: newPhrase.trim(), action: newAction }]);
    setNewPhrase("");
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="Audio" description="Transcription mode, input device, gain, and voice commands." />

      <Row label="Transcription Mode">
        <div className="inline-flex rounded-md p-0.5" style={{ background: "#1a2020", border: "1px solid #2a3232" }}>
          {(["online", "offline"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); try { localStorage.setItem(TRANSCRIPTION_MODE_KEY, m); } catch {} }}
              className={"h-6 px-3 rounded text-[11px] font-medium capitalize " + (mode === m ? "text-white" : "text-zinc-400 hover:text-zinc-200")}
              style={mode === m ? { background: "#f97316" } : {}}
            >
              {m}
            </button>
          ))}
        </div>
      </Row>

      <Row label="Audio Input">
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              className="h-8 min-w-[260px] px-3 rounded-md border text-[11px] text-zinc-100 hover:bg-white/5 inline-flex items-center justify-between gap-2"
              style={{ borderColor: "#2a3232", background: "#1a2020" }}
            >
              <span className="truncate">{selected.label}</span>
              <ChevronDown className="w-3.5 h-3.5 opacity-60" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              sideOffset={4}
              align="end"
              className="z-[70] w-[320px] max-h-[380px] overflow-y-auto rounded-md border shadow-2xl p-2"
              style={{ borderColor: "#2a3232", background: "#1e2525" }}
            >
              <Group label="Microphones & Devices">
                {devices.length === 0 && <Empty>No microphones detected</Empty>}
                {devices.map((d) => (
                  <Item
                    key={d.deviceId}
                    selected={selected.kind === "device" && selected.id === d.deviceId}
                    onClick={() => persistSelection({ kind: "device", id: d.deviceId, label: d.label || "Microphone" })}
                  >
                    {d.label || "Microphone"}
                  </Item>
                ))}
              </Group>
              <Group label="NDI Audio (Routed) (Default)">
                <Item
                  selected={selected.kind === "ndi" && selected.id === "ndi:default"}
                  onClick={() => persistSelection({ kind: "ndi", id: "ndi:default", label: "NDI Audio (Routed)" })}
                >
                  NDI Audio (Routed)
                </Item>
              </Group>
              <Group label="NDI Sources">
                {ndiSources.map((s) => (
                  <Item
                    key={s.id}
                    selected={selected.kind === "ndi" && selected.id === s.id}
                    onClick={() => persistSelection({ kind: "ndi", id: s.id, label: s.label })}
                  >
                    {s.label}
                  </Item>
                ))}
              </Group>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </Row>

      <Row label={`Input Gain — ${gain}%`}>
        <input
          type="range"
          min={0}
          max={100}
          value={gain}
          onChange={(e) => { const v = Number(e.target.value); setGain(v); try { localStorage.setItem(INPUT_GAIN_KEY, String(v)); } catch {} }}
          className="w-[220px] accent-orange-500"
        />
      </Row>

      <div className="pt-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-semibold text-zinc-100">Voice Commands</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">Scan speech for command phrases like "next verse".</div>
          </div>
          <Toggle
            on={voiceOn}
            onChange={(v) => { setVoiceOn(v); try { localStorage.setItem(VOICE_COMMANDS_KEY, v ? "1" : "0"); } catch {} }}
          />
        </div>

        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Add custom voice command</div>
          <div className="flex items-center gap-2">
            <input
              value={newPhrase}
              onChange={(e) => setNewPhrase(e.target.value)}
              placeholder="e.g. go forward"
              className="flex-1 h-8 px-2 rounded-md border text-[11px] text-zinc-100 placeholder:text-zinc-500"
              style={{ borderColor: "#2a3232", background: "#1a2020" }}
            />
            <select
              value={newAction}
              onChange={(e) => setNewAction(e.target.value)}
              className="h-8 px-2 rounded-md border text-[11px] text-zinc-100"
              style={{ borderColor: "#2a3232", background: "#1a2020" }}
            >
              {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
            <button
              onClick={addCustom}
              className="h-8 px-3 rounded-md text-[11px] font-semibold text-white inline-flex items-center gap-1"
              style={{ background: "#f97316" }}
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
        </div>

        {customs.length > 0 && (
          <div className="space-y-1">
            {customs.map((c) => (
              <div key={c.id} className="flex items-center justify-between h-8 px-2 rounded border" style={{ borderColor: "#2a3232", background: "#171c1c" }}>
                <div className="text-[11px] text-zinc-200">
                  <span className="font-mono">{c.phrase}</span>
                  <span className="text-zinc-500 ml-2">→ {ACTIONS.find((a) => a.value === c.action)?.label || c.action}</span>
                </div>
                <button
                  onClick={() => persistCustoms(customs.filter((x) => x.id !== c.id))}
                  className="text-zinc-500 hover:text-zinc-200"
                  aria-label="Remove"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 mb-2">Built-in</div>
          <div className="flex flex-wrap gap-1.5">
            {BUILT_IN_COMMANDS.map((p) => (
              <span key={p} className="text-[10px] px-2 py-0.5 rounded-full font-mono" style={{ background: "#1a2020", color: "#a3a3a3", border: "1px solid #2a3232" }}>{p}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 px-2 py-1">{label}</div>
      {children}
    </div>
  );
}
function Item({ children, selected, onClick }: { children: React.ReactNode; selected?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={"w-full text-left px-2 py-1.5 rounded text-[11px] " + (selected ? "text-white" : "text-zinc-200 hover:bg-white/5")}
      style={selected ? { background: "rgba(249,115,22,0.15)" } : {}}
    >
      {children}
    </button>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-1.5 text-[11px] text-zinc-500 italic">{children}</div>;
}
