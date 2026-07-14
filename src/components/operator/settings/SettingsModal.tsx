"use client";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Monitor, Volume2, Languages, BarChart3, BookOpen, KeyRound, HelpCircle, MessageSquare, Shield } from "lucide-react";
import { DisplayTab } from "./tabs/DisplayTab";
import { AudioTab } from "./tabs/AudioTab";
import { LanguageTab } from "./tabs/LanguageTab";
import { UsageTab } from "./tabs/UsageTab";
import { BibleStoreTab } from "./tabs/BibleStoreTab";
import { LicenseTab } from "./tabs/LicenseTab";
import { HelpTab } from "./tabs/HelpTab";
import { FeedbackTab } from "./tabs/FeedbackTab";
import { MaxUpgradePrompt } from "@/components/tier/MaxUpgradePrompt";

const TAB_KEY = "presentflow.pro.settings.tab.v1";
// Unified Safe Mode key across the operator shell (SlideGrid, useOperatorHotkeys,
// ProOperatorShell all read this). The legacy `presentflow.safeMode` key wrote
// here from the settings modal but was ignored by SlideGrid — meaning toggling
// Safe Mode in Settings had no effect and users saw stale double-click behaviour
// from an old value. One key now, everywhere.
const SAFE_MODE_KEY = "presentflow.operator.safeMode";
const LEGACY_SAFE_MODE_KEY = "presentflow.safeMode";

type TabId = "display" | "audio" | "language" | "usage" | "bible" | "license" | "help" | "feedback";

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "display", label: "Display", icon: Monitor },
  { id: "audio", label: "Audio", icon: Volume2 },
  { id: "language", label: "Language", icon: Languages },
  { id: "usage", label: "Usage", icon: BarChart3 },
  { id: "bible", label: "Bible Store", icon: BookOpen },
  { id: "license", label: "License", icon: KeyRound },
  { id: "help", label: "Help", icon: HelpCircle },
  { id: "feedback", label: "Send Feedback", icon: MessageSquare },
];

/**
 * Expanded operator Settings modal. 8-tab layout with left rail nav.
 * Individual tab components live in `./tabs/*`. Selected tab persists
 * to localStorage (`presentflow.pro.settings.tab.v1`).
 *
 * Safe Mode toggle is preserved as a compact chip in the header — the
 * user directive is that Safe Mode is off by default (single-click
 * sends live).
 */
export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<TabId>("display");
  const [safeMode, setSafeMode] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  useEffect(() => {
    if (!open) return;
    try {
      const t = localStorage.getItem(TAB_KEY) as TabId | null;
      if (t && TABS.some((x) => x.id === t)) setTab(t);
      // Migrate any lingering value from the legacy key so users who toggled
      // Safe Mode in old builds keep their choice — then delete the legacy key.
      const legacy = localStorage.getItem(LEGACY_SAFE_MODE_KEY);
      if (legacy !== null && localStorage.getItem(SAFE_MODE_KEY) === null) {
        localStorage.setItem(SAFE_MODE_KEY, legacy);
      }
      if (legacy !== null) localStorage.removeItem(LEGACY_SAFE_MODE_KEY);
      setSafeMode(localStorage.getItem(SAFE_MODE_KEY) === "1");
    } catch {}
  }, [open]);

  function selectTab(id: TabId) {
    setTab(id);
    try { localStorage.setItem(TAB_KEY, id); } catch {}
  }

  function toggleSafe() {
    setSafeMode((v) => {
      const nv = !v;
      try { localStorage.setItem(SAFE_MODE_KEY, nv ? "1" : "0"); } catch {}
      return nv;
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60]" style={{ background: "rgba(0,0,0,0.7)" }} />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[61] w-full max-w-[880px] h-[640px] max-h-[90vh] -translate-x-1/2 -translate-y-1/2 rounded-lg border shadow-2xl focus:outline-none overflow-hidden flex flex-col"
          style={{ borderColor: "#2a3232", background: "#1e2525" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between h-11 px-4 border-b shrink-0" style={{ borderColor: "#2a3232" }}>
            <Dialog.Title className="text-[12px] font-semibold uppercase tracking-[0.16em] text-zinc-200">Settings</Dialog.Title>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleSafe}
                title="Safe Mode"
                className="h-7 px-2 rounded-md inline-flex items-center gap-1.5 text-[10px] font-mono border"
                style={{
                  borderColor: "#2a3232",
                  background: safeMode ? "rgba(20,184,166,0.15)" : "#1a2020",
                  color: safeMode ? "#5eead4" : "#a1a1aa",
                }}
              >
                <Shield className="w-3 h-3" />
                Safe Mode {safeMode ? "ON" : "OFF"}
              </button>
              <Dialog.Close asChild>
                <button className="h-7 w-7 rounded-md inline-flex items-center justify-center text-zinc-400 hover:bg-white/5 hover:text-zinc-100" aria-label="Close settings">
                  <X className="w-4 h-4" />
                </button>
              </Dialog.Close>
            </div>
          </div>

          {/* Body: left rail + content */}
          <div className="flex flex-1 min-h-0">
            <nav className="w-[200px] shrink-0 border-r py-3 overflow-y-auto" style={{ borderColor: "#2a3232", background: "#191f1f" }}>
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => selectTab(t.id)}
                    className={"w-full flex items-center gap-2 text-left px-3 py-2 text-[12px] transition-colors " + (active ? "text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5")}
                    style={active ? { background: "rgba(249,115,22,0.10)", borderLeft: "3px solid #f97316", paddingLeft: "9px" } : { borderLeft: "3px solid transparent" }}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="flex-1 min-w-0 overflow-y-auto p-6">
              {tab === "display" && <DisplayTab />}
              {tab === "audio" && <AudioTab />}
              {tab === "language" && <LanguageTab />}
              {tab === "usage" && <UsageTab onUpgrade={() => setShowUpgrade(true)} />}
              {tab === "bible" && <BibleStoreTab onUpgrade={() => setShowUpgrade(true)} />}
              {tab === "license" && <LicenseTab />}
              {tab === "help" && <HelpTab />}
              {tab === "feedback" && <FeedbackTab />}
            </div>
          </div>

          {showUpgrade && (
            <div className="fixed inset-0 z-[80] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }}>
              <div className="relative">
                <MaxUpgradePrompt feature="unlimited access" variant="card" />
                <button
                  onClick={() => setShowUpgrade(false)}
                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full inline-flex items-center justify-center text-zinc-200"
                  style={{ background: "#2a3232" }}
                  aria-label="Close"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
