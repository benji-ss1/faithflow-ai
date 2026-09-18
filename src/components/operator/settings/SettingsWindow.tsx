"use client";

/**
 * SettingsWindow — one place for every setting (2026-09-16).
 *
 * Replaces the scattered settings entry points (old 9-tab modal + /settings pages)
 * with a single sidebar window, modelled on ProPresenter/EasyWorship/OBS but with
 * the thing all three lack: a search box that filters every section.
 *
 * Opened by the gear in the operator top bar, by ⌘, / Ctrl+, , or by dispatching
 * `presentflow:open-settings` (detail: { section }) so any part of the app can
 * deep-link into a section. Existing tab components are REUSED as section bodies —
 * nothing that worked before was rewritten.
 */
import { useShortcutLabel } from "@/lib/usePlatformLabel";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getLayersEngineSetting, setLayersEngineEnabled, getDesktopPreferences, getTeamData } from "@/lib/actions";
import { TeamManager } from "@/components/settings/TeamManager";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { SignOutAllDevices } from "@/components/settings/SignOutAllDevices";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X, Search, SlidersHorizontal, Monitor, Volume2, Cast, Radio, Palette, BookOpen,
  Music, Users, CreditCard, Plug, RefreshCw, Wrench, HelpCircle, MessageSquare,
  Languages, BarChart3, Wand2, ExternalLink, Laptop, Shield, MonitorSpeaker, Image, Download, Upload, RotateCcw, ChevronDown, Settings, Workflow,
} from "lucide-react";
import type { OperatorShellCtx } from "../shell/types";
import { NdiTab } from "./tabs/NdiTab";
// 2026-09-17: Bible licensing (CCLI + API.Bible) and Automations moved here from
// the retired bottom-right gear popover in the operator icon row. Same component
// bodies — nothing was rewritten, so nothing was lost.
import dynamic from "next/dynamic";
// Both are loaded ON DEMAND — the operator console mounts SettingsWindow, and
// the Automations tab was deliberately kept off the operator hot path when it
// lived in the sidebar (next/dynamic). That property is preserved here.
const BibleLicensingTab = dynamic(() => import("../pro/right/tabs/BibleLicensingTab").then((m) => m.BibleLicensingTab), { ssr: false });
const MacrosTab = dynamic(() => import("../pro/right/tabs/MacrosTab").then((m) => m.MacrosTab), { ssr: false });
import { AudioTab } from "./tabs/AudioTab";
import { LanguageTab } from "./tabs/LanguageTab";
import { UsageTab } from "./tabs/UsageTab";
import { BibleStoreTab } from "./tabs/BibleStoreTab";
import { LicenseTab } from "./tabs/LicenseTab";
import { HelpTab } from "./tabs/HelpTab";
import { FeedbackTab } from "./tabs/FeedbackTab";
import { MaxUpgradePrompt } from "@/components/tier/MaxUpgradePrompt";
import { DeepReloadButton } from "../pro/DeepReloadButton";
import { DiagnosticsPanel } from "@/components/setup/DiagnosticsPanel";
import { shouldIgnore } from "@/hooks/useOperatorHotkeys";
import { SAFE_MODE_KEY } from "../pro/operatorConstants";

export const OPEN_SETTINGS_EVENT = "presentflow:open-settings";
const SECTION_KEY = "presentflow.pro.settings.section.v1";
const LEGACY_SAFE_MODE_KEY = "presentflow.safeMode";

type SectionId =
  | "general" | "bible" | "songs" | "privacy" | "automations"
  | "screens" | "stage" | "audio" | "ndi" | "livestream" | "themes" | "media"
  | "team" | "billing" | "integrations"
  | "updates" | "language" | "usage" | "advanced" | "help" | "feedback";

type Section = {
  id: SectionId;
  label: string;
  group: "Service" | "Output" | "Organisation" | "System";
  icon: React.ComponentType<{ className?: string }>;
  /** extra words the search box should match */
  keywords: string;
};

const SECTIONS: Section[] = [
  { id: "general", label: "General", group: "Service", icon: SlidersHorizontal, keywords: "safe mode click confirm startup shortcuts version app" },
  { id: "bible", label: "Bible & Detection", group: "Service", icon: BookOpen, keywords: "scripture translation verse confidence auto approve detection kjv niv esv licence license store purchase" },
  { id: "songs", label: "Songs & Library", group: "Service", icon: Music, keywords: "lyrics library import propresenter easyworship ccli arrangement" },
  { id: "automations", label: "Automations", group: "Service", icon: Workflow, keywords: "macro macros action chain trigger slide run automation sequence" },
  { id: "privacy", label: "Privacy & Transcripts", group: "Service", icon: Shield, keywords: "recording retention delete data sermon transcript gdpr storage" },
  { id: "screens", label: "Screens & Outputs", group: "Output", icon: Monitor, keywords: "display projector stage audience resolution monitor blank identify layers clear lyrics hide" },
  { id: "stage", label: "Stage Display & Transitions", group: "Output", icon: MonitorSpeaker, keywords: "confidence monitor clock notes next slide fade dissolve cut speed" },
  { id: "audio", label: "Audio Input", group: "Output", icon: Volume2, keywords: "microphone mixer desk channel sarah wizard setup level meter interface dante blackmagic" },
  { id: "ndi", label: "NDI Output", group: "Output", icon: Cast, keywords: "network video obs stream send receive" },
  { id: "livestream", label: "Livestream & Overlay", group: "Output", icon: Radio, keywords: "obs overlay lower third browser source lan" },
  { id: "themes", label: "Themes & Look", group: "Output", icon: Palette, keywords: "font background colour color look slide design" },
  { id: "media", label: "Media & Backgrounds", group: "Output", icon: Image, keywords: "video image loop motion background bin upload storage" },
  { id: "team", label: "Team & Church", group: "Organisation", icon: Users, keywords: "members invite roles permissions admin operator volunteer church profile" },
  { id: "billing", label: "Billing & Plan", group: "Organisation", icon: CreditCard, keywords: "subscription invoice payment upgrade tier plan stripe" },
  { id: "integrations", label: "Integrations", group: "Organisation", icon: Plug, keywords: "planning center ccli songselect webhook api connect" },
  { id: "updates", label: "Updates & Desktop", group: "System", icon: RefreshCw, keywords: "version download dmg install release notes what's new" },
  { id: "language", label: "Language", group: "System", icon: Languages, keywords: "locale translate interface english" },
  { id: "usage", label: "Usage", group: "System", icon: BarChart3, keywords: "minutes quota limits ai transcription" },
  { id: "advanced", label: "Advanced & Diagnostics", group: "System", icon: Wrench, keywords: "reset cache reload logs diagnostics developer troubleshoot" },
  { id: "help", label: "Help", group: "System", icon: HelpCircle, keywords: "support docs guide shortcuts contact" },
  { id: "feedback", label: "Send Feedback", group: "System", icon: MessageSquare, keywords: "bug report suggestion contact" },
];

/** Row-level search index — reference apps only match section names; matching the
 *  actual setting is what people are looking for. */
const ROW_INDEX: { section: SectionId; label: string }[] = [
  { section: "general", label: "Safe Mode (double-click to go live)" },
  { section: "general", label: "Keyboard shortcuts" },
  { section: "general", label: "App version" },
  { section: "bible", label: "Default Bible translation" },
  { section: "bible", label: "Detection confidence & auto-approve" },
  { section: "bible", label: "Bible licences" },
  { section: "bible", label: "CCLI number" },
  { section: "bible", label: "API.Bible key" },
  { section: "automations", label: "Automations (macros)" },
  { section: "automations", label: "Create or edit an automation" },
  { section: "songs", label: "Song library" },
  { section: "songs", label: "Import songs & slides" },
  { section: "privacy", label: "Transcript retention" },
  { section: "privacy", label: "Sermon archive" },
  { section: "screens", label: "Configure output screens" },
  { section: "screens", label: "Paired devices" },
  { section: "screens", label: "Layers (hide words, background, camera, logo)" },
  { section: "stage", label: "Stage display (clock, notes, next slide)" },
  { section: "stage", label: "Slide transitions" },
  { section: "audio", label: "Run Sarah's audio setup" },
  { section: "audio", label: "Audio input device & channel" },
  { section: "ndi", label: "NDI output" },
  { section: "livestream", label: "OBS browser source URL" },
  { section: "themes", label: "Theme editor" },
  { section: "media", label: "Media library" },
  { section: "team", label: "Team members & roles" },
  { section: "billing", label: "Billing portal" },
  { section: "updates", label: "Download the desktop app" },
  { section: "updates", label: "What's new" },
  { section: "advanced", label: "Export settings" },
  { section: "advanced", label: "Import settings" },
  { section: "advanced", label: "Reset this computer's settings" },
  { section: "advanced", label: "Reload and clear cache" },
  { section: "advanced", label: "AI listener diagnostic" },
];

const GROUPS: Section["group"][] = ["Service", "Output", "Organisation", "System"];

/* ── shared bits ─────────────────────────────────────────────────────────── */

function SectionHead({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-[17px] font-semibold text-[var(--color-foreground)]">{title}</h2>
      {description && <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-muted-foreground)] max-w-[60ch]">{description}</p>}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]/60 divide-y divide-[var(--color-border)]">{children}</div>;
}

function Row({ label, help, children }: { label: string; help?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-[var(--color-foreground)]">{label}</div>
        {help && <div className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--color-muted-foreground)] max-w-[52ch]">{help}</div>}
      </div>
      <div className="flex-none flex items-center gap-2">{children}</div>
    </div>
  );
}

/** Opens in a NEW window on purpose: navigating the current one would tear down the
 *  live operator console (mic capture, output sync, the slide that is on screen). */
function LinkRow({ label, help, href, cta = "Open", onOpen }: { label: string; help?: string; href: string; cta?: string; onOpen?: () => void }) {
  if (onOpen) {
    return (
      <Row label={label} help={help}>
        <button type="button" onClick={onOpen}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-semibold bg-[var(--color-brand)] text-white hover:opacity-90">{cta}</button>
      </Row>
    );
  }
  return (
    <Row label={label} help={help}>
      <a href={href} target="_blank" rel="noreferrer"
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-semibold bg-[var(--color-brand)] text-white hover:opacity-90">
        {cta} <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </Row>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-6 w-11 rounded-full transition-colors ${on ? "bg-[var(--color-brand)]" : "bg-[var(--color-border)]"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

/** Screen assignment lives in the operator's own Hardware → Screens panel (it has
 *  the desktop display access) — open that instead of a browser page. */
function openScreensPanel(close: () => void) {
  close();
  requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("presentflow:open-hardware", { detail: { panel: "screens" } })));
}

/** Layers on/off for the church (default ON, 2026-09-16). Anyone sees it; only a
 *  church admin can change it (enforced server-side). */
function LayersRow() {
  const [state, setState] = useState<{ enabled: boolean; canEdit: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    getLayersEngineSetting()
      .then((r) => { if (!live) return; if (r.ok && r.data) setState(r.data); else setMsg("Couldn't load this setting."); })
      .catch(() => { if (live) setMsg("Couldn't load this setting."); });
    return () => { live = false; };
  }, []);
  const change = async (next: boolean) => {
    if (!state?.canEdit || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await setLayersEngineEnabled(next);
      if (!r.ok) { setMsg(r.error); return; }
      setState({ ...state, enabled: next });
      setMsg("Saved. Reload the app (Advanced → Reload and clear cache) to apply it on this computer.");
    } catch { setMsg("Couldn't save. Check your connection and try again."); }
    finally { setBusy(false); }
  };
  const help = "The strip on the right of the operator for hiding the words, background, camera or logo one at a time, and the X that clears the whole screen."
    + (state && !state.canEdit ? " Only a church admin can change this." : "");
  return (
    <>
      <Row label="Layers" help={help}>
        {state
          ? <span className={state.canEdit && !busy ? "" : "opacity-50 pointer-events-none"}><Toggle on={state.enabled} onChange={change} label="Layers" /></span>
          : <span className="text-[12px] text-[var(--color-muted-foreground)]">Loading…</span>}
      </Row>
      {msg && <Row label="" help={msg} />}
    </>
  );
}

/** The church preferences form (translation, detection, auto-approve, transcript
 *  retention…) rendered IN the desktop Settings window — the same component and
 *  server actions as /settings, so nothing is duplicated. */
function PreferencesInline() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getDesktopPreferences>> | null>(null);
  useEffect(() => {
    let live = true;
    getDesktopPreferences().then((r) => { if (live) setData(r); }).catch(() => { if (live) setData({ ok: false, error: "Couldn't load settings." }); });
    return () => { live = false; };
  }, []);
  if (!data) return <p className="text-[13px] text-[var(--color-muted-foreground)]">Loading…</p>;
  if (!data.ok || !data.data) return <p className="text-[13px] text-[var(--color-muted-foreground)]">{data.ok ? "Couldn't load settings." : data.error}</p>;
  return (<>
    <p className="mb-3 text-[12.5px] text-[var(--color-muted-foreground)]">Changes save for your whole church. Some take effect after the app reloads (Advanced → Reload and clear cache).</p>
    <SettingsForm display={data.data.display} prefs={data.data.prefs} translations={data.data.translations} previewTheme={false} />
  </>);
}

/** Open an in-app centre browser (Songs — incl. its Import — or Media) and close
 *  Settings, so the desktop app never sends these to the web app. */
function openCenter(close: () => void, mode: "songs" | "media") {
  close();
  requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("presentflow:set-center-mode", { detail: { mode } })));
}

/** Team members + invites inside the desktop Settings window — the same
 *  TeamManager and invitation actions as /settings/team. */
function TeamInline() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getTeamData>> | null>(null);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    let live = true;
    getTeamData().then((r) => { if (live) setData(r); }).catch(() => { if (live) setData({ ok: false, error: "Couldn't load your team." }); });
    return () => { live = false; };
  }, [rev]);
  if (!data) return <p className="text-[13px] text-[var(--color-muted-foreground)]">Loading…</p>;
  if (!data.ok || !data.data) return <p className="text-[13px] text-[var(--color-muted-foreground)]">{data.ok ? "Couldn't load your team." : data.error}</p>;
  return <TeamManager currentUserId={data.data.currentUserId} members={data.data.members} pendingInvites={data.data.pendingInvites} onChanged={() => setRev((v) => v + 1)} />;
}

/* ── sections that aren't just an existing tab ───────────────────────────── */

function GeneralSection() {
  const [safeMode, setSafeMode] = useState(false);
  const [version, setVersion] = useState<string>("");
  useEffect(() => {
    try {
      // Same migration the old modal does, so a legacy value isn't silently lost.
      const legacy = localStorage.getItem(LEGACY_SAFE_MODE_KEY);
      if (legacy !== null && localStorage.getItem(SAFE_MODE_KEY) === null) localStorage.setItem(SAFE_MODE_KEY, legacy);
      if (legacy !== null) localStorage.removeItem(LEGACY_SAFE_MODE_KEY);
      setSafeMode(localStorage.getItem(SAFE_MODE_KEY) === "1");
    } catch { /* ignore */ }
    const api = (globalThis as unknown as { electronAPI?: { app?: { version: () => Promise<string> } } }).electronAPI;
    void api?.app?.version().then(setVersion).catch(() => {});
  }, []);
  const setSafe = (v: boolean) => {
    setSafeMode(v);
    try { localStorage.setItem(SAFE_MODE_KEY, v ? "1" : "0"); } catch { /* ignore */ }
  };
  return (
    <>
      <SectionHead title="General" description="How the operator console behaves during a service." />
      <Card>
        <Row label="Safe Mode" help="Require a double-click to send a slide live. Off means one click sends it — faster, but less forgiving.">
          <Toggle on={safeMode} onChange={setSafe} label="Safe Mode" />
        </Row>
        <Row label="Keyboard shortcuts" help="Press ? anywhere in the operator console for the full list, or see Help below.">
          <kbd className="px-2 py-1 rounded-md text-[12px] font-mono border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-foreground)_6%,transparent)]">?</kbd>
        </Row>
        <Row label="Version" help="The version of PresentFlow running on this computer.">
          <span className="text-[13px] font-mono text-[var(--color-muted-foreground)]">{version || "web"}</span>
        </Row>
      </Card>
    </>
  );
}

function AudioSection({ close }: { close: () => void }) {
  // Sarah opens INSIDE the desktop app, over the operator console — never a browser
  // tab. Close Settings first so she isn't rendered behind this dialog.
  const openWizard = () => {
    close();
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("presentflow:open-sarah")));
  };
  return (
    <>
      <SectionHead title="Audio Input" description="What PresentFlow listens to. A clean feed from your sound desk is what makes detection accurate." />
      <div className="mb-4 rounded-xl border border-[var(--color-brand)]/40 bg-[var(--color-brand)]/10 p-4 flex items-start gap-3">
        <span className="mt-0.5 flex-none w-9 h-9 rounded-full bg-[var(--color-brand)]/20 grid place-items-center">
          <Wand2 className="w-4.5 h-4.5 text-[var(--color-brand-hi,#ff8a52)]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-[var(--color-foreground)]">Set up your audio with Sarah</div>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--color-muted-foreground)] max-w-[52ch]">
            Sarah walks you through connecting your sound desk step by step, listens to the feed, and tells you exactly what to fix.
            Run it any time — when you change desk, move computer, or something stops working.
          </p>
        </div>
        <button type="button" onClick={openWizard}
          className="flex-none h-9 px-4 rounded-lg text-[13px] font-semibold bg-[var(--color-brand)] text-white hover:opacity-90">
          Run setup
        </button>
      </div>
      <AudioTab />
    </>
  );
}

function ScreensSection({ close }: { close: () => void }) {
  return (
    <>
      <SectionHead title="Screens & Outputs" description="Which display shows the projector, the stage screen and the livestream overlay." />
      <Card>
        <LinkRow label="Configure output screens" help="Assign each connected display to Projector, Stage or Livestream." href="/settings/screens" cta="Configure" onOpen={() => openScreensPanel(close)} />
        <LinkRow label="Paired devices" help="Phones, tablets and other computers showing your outputs." href="/settings/devices" />
        <LayersRow />
        <Row label="Aspect ratio & safe-area guides" help="These are set live from the operator toolbar and the output inspector, so they always match what's on the projector." />
      </Card>
    </>
  );
}

function LivestreamSection() {
  return (
    <>
      <SectionHead title="Livestream & Overlay" description="Lower thirds and lyrics for your stream, through OBS or any browser source." />
      <Card>
        <Row label="OBS browser source" help="Add the livestream overlay to OBS as a browser source. It has a transparent background.">
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}/livestream`); }}
            className="h-8 px-3 rounded-lg text-[13px] font-semibold border border-[var(--color-border)] hover:bg-[color-mix(in_srgb,var(--color-foreground)_8%,transparent)]">Copy URL</button>
        </Row>
        <Row label="Open the overlay" help="Check what your stream audience sees.">
          <a href="/livestream" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-semibold border border-[var(--color-border)] hover:bg-[color-mix(in_srgb,var(--color-foreground)_8%,transparent)]">
            Open <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </Row>
      </Card>
    </>
  );
}

function ThemesSection({ close }: { close: () => void }) {
  return (
    <>
      <SectionHead title="Themes & Look" description="Fonts, colours and backgrounds for your slides." />
      <Card>
        <Row label="Theme editor" help="Open the themes panel in the operator console.">
          <button type="button" onClick={() => { close(); requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("presentflow:open-themes-settings"))); }}
            className="h-8 px-3 rounded-lg text-[13px] font-semibold bg-[var(--color-brand)] text-white hover:opacity-90">Open themes</button>
        </Row>
      </Card>
    </>
  );
}

function BibleSection({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <>
      <SectionHead title="Bible & Detection" description="Translations, and how confident the AI must be before it projects anything." />
      <div className="mb-6"><PreferencesInline /></div>
      <BibleStoreTab onUpgrade={onUpgrade} />
      <div className="mt-6">
        <SectionHead title="Bible licences" description="Licensed translations your church has activated." />
        <LicenseTab />
      </div>
      {/* CCLI number + API.Bible key + licensed-translation status. Moved here
          2026-09-17 from the operator bottom-right gear popover. */}
      <div className="mt-6">
        <SectionHead title="CCLI & API.Bible" description="Your church's CCLI licence number and an optional API.Bible key for your own translation quota." />
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]/60 px-4 py-3">
          <BibleLicensingTab />
        </div>
      </div>
    </>
  );
}

function AutomationsSection({ ctx }: { ctx?: OperatorShellCtx }) {
  return (
    <>
      <SectionHead title="Automations" description="Chain actions together — start a timer and show a message, clear layers, and so on — then fire them in one tap, or from a song slide's Actions menu." />
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]/60 px-4 py-3">
        <MacrosTab ctx={ctx} />
      </div>
      {!ctx && (
        <p className="mt-3 text-[12.5px] text-[var(--color-muted-foreground)]">
          Open Settings from the operator console to test-run an automation on the live output.
        </p>
      )}
    </>
  );
}

function SongsSection({ close }: { close: () => void }) {
  return (
    <>
      <SectionHead title="Songs & Library" description="Your song library, imports and arrangements." />
      <Card>
        <LinkRow label="Song library" help="Browse, edit and organise every song." href="/library/songs" onOpen={() => openCenter(close, "songs")} />
        <LinkRow label="Import songs & slides" help="Bring in ProPresenter, VideoPsalm or text song files. Use Import in the Songs browser, or drag files onto it." href="/library/imports" cta="Import" onOpen={() => openCenter(close, "songs")} />
      </Card>
    </>
  );
}

function OrgSection({ kind, close }: { kind: "team" | "billing" | "integrations"; close: () => void }) {
  if (kind === "team") return (
    <>
      <SectionHead title="Team & Church" description="Who can operate services, edit the library and change settings." />
      <Card>
        <LinkRow label="Church details" help="Name, city and timezone." href="/organization" />
      </Card>
      <div className="mt-6"><TeamInline /></div>
    </>
  );
  if (kind === "billing") return (
    <>
      <SectionHead title="Billing & Plan" description="Your subscription and invoices." />
      <Card><LinkRow label="Billing portal" help="Change plan, update payment details, download invoices." href="/settings/billing" cta="Open billing" /></Card>
    </>
  );
  return (
    <>
      <SectionHead title="Integrations" description="Connect PresentFlow to the other tools your church uses." />
      <Card>
        <Row label="Planning Center" help="Coming soon — import your service plan automatically." ><span className="text-[12px] text-[var(--color-muted-foreground)]">Coming soon</span></Row>
        <LinkRow label="ProPresenter / EasyWorship import" help="Bring your existing library across from the Songs browser." href="/library/imports" cta="Import" onOpen={() => openCenter(close, "songs")} />
      </Card>
    </>
  );
}

function UpdatesSection({ close }: { close: () => void }) {
  return (
    <>
      <SectionHead title="Updates & Desktop" description="Keep the desktop app current." />
      <div className="mb-4"><Card>
        <LinkRow label="Download the desktop app" help="The desktop app is what drives projectors, NDI and audio capture." href="/settings/download" cta="Download" />
        <Row label="What's new" help="See what changed in recent releases.">
          <button type="button" onClick={() => { close(); requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("presentflow:open-whats-new"))); }}
            className="h-8 px-3 rounded-lg text-[13px] font-semibold border border-[var(--color-border)] hover:bg-[color-mix(in_srgb,var(--color-foreground)_8%,transparent)]">Open</button>
        </Row>
      </Card></div>
    </>
  );
}

function AdvancedSection() {
  const [cleared, setCleared] = useState(false);
  const [showRare, setShowRare] = useState(false);
  return (
    <>
      <SectionHead title="Advanced & Diagnostics" description="Troubleshooting tools. Everything here is safe to use during a service unless it says otherwise." />
      <Card>
        <Row label="Reload and clear cache" help="Pulls the newest version. Your outputs go blank for a moment — avoid doing this mid-service.">
          <DeepReloadButton />
        </Row>
        <Row label="Forget this computer's audio device" help="Clears the remembered input so Sarah picks it again next time.">
          <button type="button"
            onClick={() => { try { localStorage.removeItem("presentflow.pro.savedAudioDevices.v1"); setCleared(true); } catch { /* ignore */ } }}
            className="h-8 px-3 rounded-lg text-[13px] font-semibold border border-[var(--color-border)] hover:bg-[color-mix(in_srgb,var(--color-foreground)_8%,transparent)]">{cleared ? "Forgotten" : "Forget"}</button>
        </Row>
      </Card>
      <SignOutAllDevices />
      <div className="mt-6">
        <SectionHead title="Settings file" description="Move this computer's setup to another machine, or start over." />
        <SettingsPortability />
      </div>
      <div className="mt-6">
        <button type="button" onClick={() => setShowRare((v) => !v)} aria-expanded={showRare}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-brand-hi,#ff8a52)]">
          <ChevronDown className={`w-4 h-4 transition-transform ${showRare ? "rotate-180" : ""}`} /> {showRare ? "Hide" : "Show"} diagnostic tools
        </button>
      </div>
      <div className="mt-4" hidden={!showRare}>
        <SectionHead title="AI listener diagnostic" description="Traces each step of the listening pipeline and shows exactly where it stops." />
        <DiagnosticsPanel />
      </div>
    </>
  );
}


function StageSection({ close }: { close: () => void }) {
  return (
    <>
      <SectionHead title="Stage Display & Transitions" description="What the people on stage see, and how slides change on the projector." />
      <Card>
        {/* 2026-09-17: this button opened the operator's bottom-right gear popover,
            which only ever contained Automations + Bible (no stage controls) and has
            now been retired. Stage display is assigned in Screens & Outputs below. */}
        <Row label="Stage display" help="Clock, current and next slide, and speaker notes for the preacher's monitor. Assign which display shows it below." />
        <LinkRow label="Assign the stage screen" help="Choose which physical display shows the stage view." href="/settings/screens" cta="Configure" onOpen={() => openScreensPanel(close)} />
        <Row label="Slide transitions" help="Transitions are chosen per slide from the slide menu in the operator console, so what you set is what you see on the projector." />
      </Card>
    </>
  );
}

function MediaSection({ close }: { close: () => void }) {
  return (
    <>
      <SectionHead title="Media & Backgrounds" description="Videos, images and motion backgrounds for your slides." />
      <Card>
        <LinkRow label="Media library" help="Upload and organise videos, images and motion backgrounds." href="/library/media" cta="Open" onOpen={() => openCenter(close, "media")} />
        <Row label="Backgrounds" help="Set a background for one slide, a whole song, or every screen from the slide menu's Background option in the operator console." />
      </Card>
    </>
  );
}

function PrivacySection() {
  return (
    <>
      <SectionHead title="Privacy & Transcripts" description="What PresentFlow keeps from your services, and for how long." />
      <Card>
        <Row label="What is recorded" help="PresentFlow transcribes speech to find scripture and songs. Audio itself is never stored — only the text, and only for your church." />
        <Row label="Transcript retention" help="Set how long transcripts are kept in Bible & Detection, in this window." />
        <LinkRow label="Sermon archive" help="Past transcripts and summaries your church has kept." href="/archive" />
      </Card>
    </>
  );
}

/** Keys we own. Used by export / import / reset so nothing outside PresentFlow is touched. */
const SETTINGS_PREFIX = "presentflow.";

function collectSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(SETTINGS_PREFIX)) out[k] = localStorage.getItem(k) ?? "";
    }
  } catch { /* ignore */ }
  return out;
}

function SettingsPortability() {
  const [status, setStatus] = useState<string>("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const doExport = () => {
    const data = collectSettings();
    const blob = new Blob([JSON.stringify({ app: "presentflow", exportedAt: new Date().toISOString(), settings: data }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `presentflow-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setStatus(`Exported ${Object.keys(data).length} settings.`);
  };

  const doImport = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as { app?: string; settings?: Record<string, unknown> };
      if (parsed?.app !== "presentflow" || !parsed.settings || typeof parsed.settings !== "object") {
        setStatus("That doesn't look like a PresentFlow settings file."); return;
      }
      let n = 0;
      for (const [k, v] of Object.entries(parsed.settings)) {
        // Only ever write OUR keys, and only strings.
        if (!k.startsWith(SETTINGS_PREFIX) || typeof v !== "string") continue;
        try { localStorage.setItem(k, v); n++; } catch { /* quota */ }
      }
      setStatus(`Imported ${n} settings. Reload PresentFlow to use them.`);
    } catch { setStatus("Couldn't read that file."); }
  };

  const doReset = () => {
    if (!window.confirm("Reset this computer's PresentFlow settings? Your songs, services and church data are not touched — only this computer's preferences (audio device, safe mode, panel layout).")) return;
    let n = 0;
    try {
      for (const k of Object.keys(collectSettings())) { localStorage.removeItem(k); n++; }
    } catch { /* ignore */ }
    setStatus(`Reset ${n} settings. Reload PresentFlow to start fresh.`);
  };

  return (
    <Card>
      <Row label="Export settings" help="Save this computer's setup as a file — useful for setting up a second machine or a multi-campus church.">
        <button type="button" onClick={doExport} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-semibold border border-[var(--color-border)] hover:bg-[color-mix(in_srgb,var(--color-foreground)_8%,transparent)]">
          <Download className="w-3.5 h-3.5" /> Export
        </button>
      </Row>
      <Row label="Import settings" help="Load a settings file exported from another PresentFlow computer.">
        <>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ""; }} />
          <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-semibold border border-[var(--color-border)] hover:bg-[color-mix(in_srgb,var(--color-foreground)_8%,transparent)]">
            <Upload className="w-3.5 h-3.5" /> Import
          </button>
        </>
      </Row>
      <Row label="Reset this computer's settings" help="Puts every preference on this computer back to its default. Your church's songs, services and settings on the server are untouched.">
        <button type="button" onClick={doReset} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-semibold border border-amber-500/50 text-amber-200 hover:bg-amber-500/10">
          <RotateCcw className="w-3.5 h-3.5" /> Reset
        </button>
      </Row>
      {status && <Row label="" help={status} />}
    </Card>
  );
}

/* ── the window ──────────────────────────────────────────────────────────── */

export function SettingsWindow({ ctx }: { ctx?: OperatorShellCtx } = {}) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SectionId>("general");
  const [query, setQuery] = useState("");
  const [showUpgrade, setShowUpgrade] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const openAt = useCallback((id?: SectionId) => {
    if (id && SECTIONS.some((s) => s.id === id)) setSection(id);
    else { try { const t = localStorage.getItem(SECTION_KEY) as SectionId | null; if (t && SECTIONS.some((s) => s.id === t)) setSection(t); } catch { /* ignore */ } }
    setOpen(true);
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => openAt((e as CustomEvent<{ section?: SectionId }>).detail?.section);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        // Same predicate the operator hotkeys use (covers contenteditable, selects,
        // Radix textboxes), and never stack on top of another open dialog.
        if (shouldIgnore(e.target) || shouldIgnore(document.activeElement)) return;
        if (document.querySelector('[role="dialog"][data-state="open"]')) return;
        e.preventDefault(); openAt();
      }
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen); window.removeEventListener("keydown", onKey); };
  }, [openAt]);

  const rowHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return ROW_INDEX.filter((r) => r.label.toLowerCase().includes(q)).slice(0, 6);
  }, [query]);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const select = (id: SectionId) => {
    setSection(id);
    try { localStorage.setItem(SECTION_KEY, id); } catch { /* ignore */ }
    // Move focus into the pane so screen-reader users hear the new section.
    requestAnimationFrame(() => paneRef.current?.focus());
  };

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS.map((s) => ({ ...s, hit: undefined as string | undefined }));
    return SECTIONS
      .filter((s) => `${s.label} ${s.group} ${s.keywords}`.toLowerCase().includes(q))
      .map((s) => ({
        ...s,
        // Show the matching term so "confidence" doesn't just silently reveal "Bible & Detection".
        hit: s.label.toLowerCase().includes(q) ? undefined : s.keywords.split(/\s+/).find((w) => w.includes(q)),
      }));
  }, [query]);

  const body = () => {
    switch (section) {
      case "general": return <GeneralSection />;
      case "bible": return <BibleSection onUpgrade={() => setShowUpgrade(true)} />;
      case "songs": return <SongsSection close={() => setOpen(false)} />;
      case "automations": return <AutomationsSection ctx={ctx} />;
      case "screens": return <ScreensSection close={() => setOpen(false)} />;
      case "audio": return <AudioSection close={() => setOpen(false)} />;
      case "ndi": return <><SectionHead title="NDI Output" description="Send your slides to OBS or another computer over the network." /><NdiTab /></>;
      case "livestream": return <LivestreamSection />;
      case "themes": return <ThemesSection close={() => setOpen(false)} />;
      case "stage": return <StageSection close={() => setOpen(false)} />;
      case "media": return <MediaSection close={() => setOpen(false)} />;
      case "privacy": return <PrivacySection />;
      case "team": return <OrgSection kind="team" close={() => setOpen(false)} />;
      case "billing": return <OrgSection kind="billing" close={() => setOpen(false)} />;
      case "integrations": return <OrgSection kind="integrations" close={() => setOpen(false)} />;
      case "updates": return <UpdatesSection close={() => setOpen(false)} />;
      case "language": return <><SectionHead title="Language" /><LanguageTab /></>;
      case "usage": return <><SectionHead title="Usage" /><UsageTab onUpgrade={() => setShowUpgrade(true)} /></>;
      case "advanced": return <AdvancedSection />;
      case "help": return <><SectionHead title="Help" /><HelpTab /></>;
      case "feedback": return <><SectionHead title="Send Feedback" /><FeedbackTab /></>;
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          onOpenAutoFocus={(e) => { e.preventDefault(); searchRef.current?.focus(); }}
          className="fixed z-[81] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(1040px,94vw)] h-[min(720px,90vh)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] shadow-2xl flex flex-col sm:flex-row"
        >
          <Dialog.Title className="sr-only">Settings</Dialog.Title>
          <Dialog.Description className="sr-only">Every PresentFlow setting, grouped by area.</Dialog.Description>

          {/* sidebar */}
          <div role="tablist" aria-orientation="vertical" aria-label="Settings sections" className="flex-none w-full sm:w-[248px] border-b sm:border-b-0 sm:border-r border-[var(--color-border)] bg-[var(--color-card)]/50 flex flex-col">
            <div className="p-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-muted-foreground)]" aria-hidden />
                <input
                  ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search settings" aria-label="Search settings"
                  className="w-full h-9 pl-8 pr-3 rounded-lg text-[13px] bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-3 max-h-[28vh] sm:max-h-none">
              {rowHits.length > 0 && (
                <div className="mb-2">
                  <div className="px-2 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Settings</div>
                  {rowHits.map((r) => (
                    <button key={`${r.section}-${r.label}`} type="button" onClick={() => select(r.section)}
                      className="w-full text-left px-2 py-2 rounded-lg text-[13px] text-[var(--color-muted-foreground)] hover:bg-[color-mix(in_srgb,var(--color-foreground)_8%,transparent)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]">
                      <span className="block truncate text-[var(--color-foreground)]">{r.label}</span>
                      <span className="block truncate text-[11px]">in {SECTIONS.find((x) => x.id === r.section)?.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {GROUPS.map((g) => {
                const items = matches.filter((s) => s.group === g);
                if (!items.length) return null;
                return (
                  <div key={g} className="mb-2">
                    <div className="px-2 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">{g}</div>
                    {items.map((s) => {
                      const Icon = s.icon;
                      const active = s.id === section;
                      return (
                        <button key={s.id} type="button" role="tab" id={`pf-set-tab-${s.id}`} aria-selected={active}
                          aria-controls="pf-settings-pane" tabIndex={active ? 0 : -1} onClick={() => select(s.id)}
                          className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-[13.5px] text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] ${
                            active ? "bg-[var(--color-brand)]/15 text-[var(--color-foreground)] font-semibold" : "text-[var(--color-muted-foreground)] hover:bg-[color-mix(in_srgb,var(--color-foreground)_8%,transparent)] hover:text-[var(--color-foreground)]"}`}>
                          <span className={`flex-none w-6 h-6 rounded-md grid place-items-center ${active ? "bg-[var(--color-brand)] text-white" : "bg-[color-mix(in_srgb,var(--color-foreground)_6%,transparent)]"}`}>
                            <Icon className="w-3.5 h-3.5" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate">{s.label}</span>
                            {s.hit && <span className="block truncate text-[11px] font-normal text-[var(--color-muted-foreground)]">matches “{s.hit}”</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              <p role="status" aria-live="polite" className={matches.length === 0 ? "px-3 py-6 text-[13px] text-[var(--color-muted-foreground)]" : "sr-only"}>
                {matches.length === 0 ? `Nothing matches “${query}”.` : query ? `${matches.length} section${matches.length === 1 ? "" : "s"} match “${query}”.` : ""}
              </p>
            </div>
          </div>

          {/* content */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex-none flex items-center justify-between gap-3 px-5 py-3 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-2 text-[12px] text-[var(--color-muted-foreground)]">
                <Laptop className="w-3.5 h-3.5" aria-hidden />
                <span>Settings</span>
                <span aria-hidden>›</span>
                <span className="text-[var(--color-foreground)] font-medium">{SECTIONS.find((s) => s.id === section)?.label}</span>
              </div>
              <Dialog.Close asChild>
                <button type="button" aria-label="Close settings"
                  className="w-8 h-8 grid place-items-center rounded-lg text-[var(--color-muted-foreground)] hover:bg-[color-mix(in_srgb,var(--color-foreground)_8%,transparent)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]">
                  <X className="w-4 h-4" />
                </button>
              </Dialog.Close>
            </div>
            <div ref={paneRef} id="pf-settings-pane" role="tabpanel" tabIndex={-1}
              aria-labelledby={`pf-set-tab-${section}`}
              className="flex-1 overflow-y-auto p-5 focus-visible:outline-none">{body()}</div>
          </div>

          {showUpgrade && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-black/70 p-6">
              <div className="max-w-md w-full">
                <MaxUpgradePrompt feature="unlimited access" variant="card" />
                <button type="button" onClick={() => setShowUpgrade(false)}
                  className="mt-3 w-full h-9 rounded-lg text-[13px] font-semibold border border-[var(--color-border)] hover:bg-[color-mix(in_srgb,var(--color-foreground)_8%,transparent)]">Not now</button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Gear button for the operator top bar. */
export function SettingsButton({ className }: { className?: string }) {
  const settingsKey = useShortcutLabel({ mod: true, key: "," });
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT))}
      title={`Settings (${settingsKey})`}
      aria-label="Open settings"
      className={className ?? "ml-1 w-[26px] h-[26px] grid place-items-center rounded-md text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-brand)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"}
    >
      <Settings className="w-[18px] h-[18px]" aria-hidden />
    </button>
  );
}
