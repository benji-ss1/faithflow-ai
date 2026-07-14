"use client";
import { ExternalLink, PlayCircle, BookOpenText, Mail } from "lucide-react";
import { SectionHeader } from "./DisplayTab";
import { NAV_ROWS, ACTION_ROWS } from "../../pro/ShortcutsHelpOverlay";

export function HelpTab() {
  function openTour(variant?: string) {
    try {
      window.dispatchEvent(new CustomEvent("presentflow:open-tour", { detail: { variant } }));
    } catch {}
    // Fallback IPC
    try {
      const api = (window as any).electronAPI;
      api?.on && api.on("presentflow:open-tour", () => {});
    } catch {}
  }

  function openExternal(url: string) {
    const api = (window as any).electronAPI?.shell;
    if (api?.openExternal) api.openExternal(url);
    else window.open(url, "_blank", "noopener");
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="Help" description="Tutorials, keyboard shortcuts, and support." />

      <div className="space-y-2">
        <TutorialRow
          title="Dashboard Tutorial"
          desc="Learn how to use PresentFlow with an interactive guide"
          onClick={() => openTour()}
        />
        <TutorialRow
          title="Theme Designer Tutorial"
          desc="Walk through building custom slide themes"
          onClick={() => openTour("theme-designer")}
        />
      </div>

      <div>
        <div className="text-[11px] font-semibold text-zinc-200 mb-2">Keyboard Shortcuts</div>
        <div className="grid grid-cols-2 gap-4">
          <ShortcutColumn title="Navigation" rows={NAV_ROWS} />
          <ShortcutColumn title="Actions" rows={ACTION_ROWS} />
        </div>
      </div>

      <div>
        <div className="text-[11px] font-semibold text-zinc-200 mb-2">Support</div>
        <div className="space-y-1.5">
          <SupportRow icon={<BookOpenText className="w-3.5 h-3.5" />} label="Documentation" onClick={() => openExternal("https://presentflow.app/docs")} />
          <SupportRow icon={<Mail className="w-3.5 h-3.5" />} label="Contact Support" onClick={() => openExternal("mailto:support@presentflow.app")} />
        </div>
      </div>
    </div>
  );
}

function TutorialRow({ title, desc, onClick }: { title: string; desc: string; onClick: () => void }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-md border" style={{ borderColor: "#2a3232", background: "#171c1c" }}>
      <div className="flex items-start gap-2.5">
        <PlayCircle className="w-4 h-4 text-orange-500 mt-0.5" />
        <div>
          <div className="text-[12px] font-semibold text-zinc-100">{title}</div>
          <div className="text-[11px] text-zinc-500 mt-0.5">{desc}</div>
        </div>
      </div>
      <button
        onClick={onClick}
        className="h-8 px-3 rounded-md text-[11px] font-semibold text-white"
        style={{ background: "#f97316" }}
      >
        Restart Tutorial
      </button>
    </div>
  );
}

function ShortcutColumn({ title, rows }: { title: string; rows: { keys: string; label: string }[] }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 mb-1.5">{title}</div>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.keys} className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] text-zinc-400 truncate">{r.label}</span>
            <kbd className="text-[9.5px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap" style={{ background: "#1a2020", border: "1px solid #2a3232", color: "#e4e4e7" }}>{r.keys}</kbd>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SupportRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between p-2.5 rounded-md border text-left hover:bg-white/5"
      style={{ borderColor: "#2a3232", background: "#171c1c" }}
    >
      <span className="inline-flex items-center gap-2 text-[11px] text-zinc-200">
        {icon} {label}
      </span>
      <ExternalLink className="w-3.5 h-3.5 text-zinc-500" />
    </button>
  );
}
