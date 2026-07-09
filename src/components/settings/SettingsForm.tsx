"use client";
import { useState, useTransition, useEffect } from "react";
import { toast } from "sonner";
import { Moon, Sun, Palette, BookOpen, Sparkles } from "lucide-react";
import { updateSettings, updatePreferences } from "@/lib/actions";

type Display = { blankBgColor: string };
type Prefs = {
  defaultTranslationId: string | null;
  aiListeningDefault: boolean;
  audioInputDeviceLabel: string | null;
  detectionConfidenceThreshold: number;
  productionMode: boolean;
  transcriptRetentionDays: number;
  commandPrefix: string;
  autoApproveEnabled: boolean;
  autoApproveThreshold: number;
  autoSendToLive: boolean;
};

export function SettingsForm({ display, prefs, translations }: {
  display: Display;
  prefs: Prefs;
  translations: { id: string; code: string; name: string }[];
}) {
  const [d, setD] = useState<Display>(display);
  const [p, setP] = useState<Prefs>(prefs);
  const [mics, setMics] = useState<{ deviceId: string; label: string }[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // Apply production mode client-side immediately so the toggle previews before save
    document.documentElement.classList.toggle("dark", p.productionMode);
    // Also persist as a cookie so the server RSC layout renders with the
    // correct class on next hard reload — no flash of the wrong theme.
    document.cookie = `ff_dark=${p.productionMode ? "1" : "0"}; path=/; max-age=31536000; SameSite=Lax`;
  }, [p.productionMode]);

  useEffect(() => {
    // Enumerate mic devices for the AI & Audio picker. Requires prior mic
    // permission grant on this origin, otherwise labels are blank.
    navigator.mediaDevices?.enumerateDevices?.().then((devs) => {
      setMics(devs.filter((x) => x.kind === "audioinput").map((x) => ({ deviceId: x.deviceId, label: x.label || "Unnamed input" })));
    }).catch(() => { /* ignore */ });
  }, []);

  function save() {
    startTransition(async () => {
      const [dRes, pRes] = await Promise.all([
        updateSettings({ blankBgColor: d.blankBgColor }),
        updatePreferences({
          defaultTranslationId: p.defaultTranslationId,
          aiListeningDefault: p.aiListeningDefault,
          audioInputDeviceLabel: p.audioInputDeviceLabel,
          detectionConfidenceThreshold: p.detectionConfidenceThreshold,
          productionMode: p.productionMode,
          transcriptRetentionDays: p.transcriptRetentionDays,
          commandPrefix: p.commandPrefix,
          autoApproveEnabled: p.autoApproveEnabled,
          autoApproveThreshold: p.autoApproveThreshold,
          autoSendToLive: p.autoSendToLive,
        }),
      ]);
      if (dRes.ok && pRes.ok) toast.success("Settings saved");
      else toast.error(!dRes.ok ? dRes.error : (!pRes.ok ? pRes.error : "Save failed"));
    });
  }

  return (
    <div className="space-y-4">
      {/* Display */}
      <Section icon={<Palette className="w-4 h-4" />} title="Display" description="How slides appear on the projector.">
        <Row label="Blank screen colour" hint="Shown when you hit BLANK. Solid black is safest for LCD projectors.">
          <input type="color" value={d.blankBgColor} onChange={(e) => setD({ blankBgColor: e.target.value })}
            className="h-9 w-16 border border-border rounded-md cursor-pointer" />
        </Row>
        <Row label="Production mode (dark UI)" hint="Inverts the operator console to a dark theme for low-light booths. Preview / Live panes stay unchanged.">
          <button type="button" onClick={() => setP({ ...p, productionMode: !p.productionMode })}
            className={`h-9 px-3 rounded-md border text-xs font-semibold inline-flex items-center gap-1.5 transition-all ${p.productionMode ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent"}`}>
            {p.productionMode ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
            {p.productionMode ? "Dark" : "Light (default)"}
          </button>
        </Row>
      </Section>

      {/* Bible */}
      <Section icon={<BookOpen className="w-4 h-4" />} title="Bible" description="Default translation for scripture staging and detection results.">
        <Row label="Default translation" hint="Used when approving AI-detected references and when the Bible browser opens.">
          <select value={p.defaultTranslationId || ""} onChange={(e) => setP({ ...p, defaultTranslationId: e.target.value || null })}
            className="h-9 w-64 px-3 border border-border rounded-md bg-background text-sm">
            <option value="">— none —</option>
            {translations.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
          </select>
        </Row>
      </Section>

      {/* AI & Audio */}
      <Section icon={<Sparkles className="w-4 h-4" />} title="AI &amp; Audio" description="Live transcription and Bible reference detection.">
        <Row label="AI Listening default" hint="When ON, the AI Listening toggle in the operator console starts enabled. You can still switch it off per-session.">
          <button type="button" onClick={() => setP({ ...p, aiListeningDefault: !p.aiListeningDefault })}
            className={`h-9 px-3 rounded-md border text-xs font-semibold transition-all ${p.aiListeningDefault ? "bg-success/10 border-success text-success" : "border-border hover:bg-accent"}`}>
            {p.aiListeningDefault ? "ON" : "OFF"}
          </button>
        </Row>
        <Row label="Preferred audio input" hint="Which microphone / mixer channel the browser should use for the transcript feed.">
          <select value={p.audioInputDeviceLabel || ""} onChange={(e) => setP({ ...p, audioInputDeviceLabel: e.target.value || null })}
            className="h-9 w-64 px-3 border border-border rounded-md bg-background text-sm">
            <option value="">Default system input</option>
            {mics.map((m) => <option key={m.deviceId} value={m.label}>{m.label}</option>)}
          </select>
        </Row>
        <Row label={`Detection confidence threshold (${p.detectionConfidenceThreshold}%)`}
             hint="References below this confidence are still shown but flagged for extra scrutiny. Raise if you get too many false positives.">
          <input type="range" min={40} max={95} step={5} value={p.detectionConfidenceThreshold}
            onChange={(e) => setP({ ...p, detectionConfidenceThreshold: Number(e.target.value) })}
            className="w-64" />
        </Row>
        {/*
         * "Voice command prefix" removed — slide/screen navigation now
         * uses the same wake-word-free, context-anchored pattern as the
         * Verse Bank ("next slide" only fires when a slide is up, "next
         * verse" only when a verse is banked). See lib/context-parser.ts.
         */}
        <Row label="Transcript retention"
             hint="Raw transcripts age out after this window. Sermon summaries (once generated) are kept independently, so archives survive.">
          <select value={p.transcriptRetentionDays} onChange={(e) => setP({ ...p, transcriptRetentionDays: Number(e.target.value) })}
            className="h-9 w-40 px-3 border border-border rounded-md bg-background text-sm">
            <option value={30}>30 days</option>
            <option value={90}>90 days (default)</option>
            <option value={365}>365 days</option>
            <option value={0}>Forever</option>
          </select>
        </Row>

        <Row label="Autopilot: auto-approve detections"
             hint="When ON, high-confidence scripture detections auto-stage to Preview without waiting for operator approval. Opt-in — leave OFF to preserve the safety gate.">
          <button type="button" onClick={() => setP({ ...p, autoApproveEnabled: !p.autoApproveEnabled })}
            className={`h-9 px-3 rounded-md border text-xs font-semibold transition-all ${p.autoApproveEnabled ? "bg-warning/10 border-warning text-warning" : "border-border hover:bg-accent"}`}>
            {p.autoApproveEnabled ? "ON" : "OFF"}
          </button>
        </Row>

        {p.autoApproveEnabled && (
          <>
            <Row label={`Autopilot confidence floor (${p.autoApproveThreshold}%)`}
                 hint="Only auto-approve detections at or above this confidence. Raise if you get false-positive scripture references from the sermon.">
              <input type="range" min={60} max={98} step={1} value={p.autoApproveThreshold}
                onChange={(e) => setP({ ...p, autoApproveThreshold: Number(e.target.value) })}
                className="w-64" />
            </Row>
            <Row label="Autopilot: also auto-SEND to Live"
                 hint="Danger zone: skip Preview entirely and put approved verses straight on the projector. Requires trust in the confidence floor + Bible parser.">
              <button type="button" onClick={() => setP({ ...p, autoSendToLive: !p.autoSendToLive })}
                className={`h-9 px-3 rounded-md border text-xs font-semibold transition-all ${p.autoSendToLive ? "bg-destructive/10 border-destructive text-destructive" : "border-border hover:bg-accent"}`}>
                {p.autoSendToLive ? "ON — projector auto-updates" : "OFF — Preview only"}
              </button>
            </Row>
          </>
        )}
      </Section>

      <div className="flex justify-end pt-2">
        <button onClick={save} disabled={pending}
          className="h-10 px-6 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          {pending ? "Saving…" : "Save settings"}
        </button>
      </div>
    </div>
  );
}

function Section({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="border border-border rounded-md bg-card">
      <header className="px-4 py-3 border-b border-border flex items-center gap-2">
        <div className="text-muted-foreground">{icon}</div>
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
      </header>
      <div className="divide-y divide-border">
        {children}
      </div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3 flex items-start gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
