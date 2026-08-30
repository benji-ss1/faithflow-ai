"use client";

/**
 * BibleLicensingTab — CCLI number + API.Bible key setup.
 *
 * Displayed inside the Settings popover (RightIconBar) under the "Bible" sub-tab.
 * Lets an admin/operator:
 *  1. Save their CCLI number (informational — used for record-keeping).
 *  2. Enter their API.Bible API key, which unlocks NIV, NKJV, NLT, and AMP.
 *
 * The API key is NEVER sent back to the client after saving — the GET endpoint
 * only returns which translations are active. The input shows a placeholder
 * ("••••••••" if configured) and a fresh value replaces the stored key.
 */

import { useEffect, useState } from "react";
import { BookKey, CheckCircle2, Lock, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";

type TranslationStatus = { code: string; name: string; active: boolean };

export function BibleLicensingTab() {
  const [ccliNumber, setCcliNumber] = useState("");
  const [ccliSaving, setCcliSaving] = useState(false);
  const [ccliSaved, setCcliSaved] = useState(false);
  const [ccliError, setCcliError] = useState<string | null>(null);

  const [apiKey, setApiKey] = useState("");
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);

  // Contextual awareness (beta) — the Context Engine on/off, read live by
  // useAudioStream on the next detection (no reload). Same key as the Audio-tab
  // toggle; surfaced here because operators look for it in this Bible/AI popover.
  const CONTEXT_ENGINE_KEY = "presentflow.pro.contextEngine.v1";
  const [ctxOn, setCtxOn] = useState(false);
  useEffect(() => { try { setCtxOn(localStorage.getItem(CONTEXT_ENGINE_KEY) === "1"); } catch { /* noop */ } }, []);

  const [translations, setTranslations] = useState<TranslationStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const [loadError, setLoadError] = useState<string | null>(null);

  // Load current state on mount.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    Promise.all([
      fetch("/api/settings/ccli").then((r) => {
        if (!r.ok) throw new Error("ccli");
        return r.json() as Promise<{ ccliNumber: string | null }>;
      }),
      fetch("/api/settings/bible-api-key").then((r) => {
        if (!r.ok) throw new Error("bible-api-key");
        return r.json() as Promise<{ status: TranslationStatus[] }>;
      }),
    ])
      .then(([ccliData, bibleData]) => {
        if (cancelled) return;
        setCcliNumber(ccliData.ccliNumber ?? "");
        const statuses = bibleData.status ?? [];
        setTranslations(statuses);
        setApiKeyConfigured(statuses.some((t) => t.active));
      })
      .catch(() => {
        if (!cancelled) setLoadError("Could not load settings. Check your connection.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  async function saveCcli() {
    setCcliSaving(true);
    setCcliError(null);
    setCcliSaved(false);
    // Strip internal whitespace before saving (e.g. "123 456" → "123456").
    const cleanCcli = ccliNumber.replace(/\s+/g, "");
    try {
      const res = await fetch("/api/settings/ccli", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ccliNumber: cleanCcli }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setCcliError(data.error ?? "Failed to save");
      } else {
        setCcliSaved(true);
        setTimeout(() => setCcliSaved(false), 2500);
      }
    } catch {
      setCcliError("Network error");
    } finally {
      setCcliSaving(false);
    }
  }

  async function saveApiKey() {
    if (!apiKey.trim()) return;
    setApiKeySaving(true);
    setApiKeyError(null);
    setApiKeySaved(false);
    try {
      const res = await fetch("/api/settings/bible-api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setApiKeyError(data.error ?? "Failed to save");
      } else {
        setApiKeySaved(true);
        setApiKeyConfigured(true);
        setApiKey(""); // clear the input — never echo back the key
        setTimeout(() => setApiKeySaved(false), 2500);
        // Re-fetch translation status; fire-and-forget, errors are silent
        // (UI already optimistically shows all 4 as configured).
        fetch("/api/settings/bible-api-key")
          .then((r) => r.ok ? r.json() as Promise<{ status: TranslationStatus[] }> : null)
          .then((data) => { if (data?.status) setTranslations(data.status); })
          .catch(() => { /* degraded gracefully — optimistic state is shown */ });
      }
    } catch {
      setApiKeyError("Network error");
    } finally {
      setApiKeySaving(false);
    }
  }

  async function revokeApiKey() {
    try {
      const res = await fetch("/api/settings/bible-api-key", { method: "DELETE" });
      if (res.ok) {
        setApiKeyConfigured(false);
        setTranslations((prev) => prev.map((t) => ({ ...t, active: false })));
      } else {
        setApiKeyError("Could not revoke — please try again");
      }
    } catch {
      setApiKeyError("Network error — could not revoke");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-20 text-[11px] text-[var(--color-muted-foreground)]">
        Loading...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-20 gap-2 text-[11px]">
        <p className="text-red-400 text-center">{loadError}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-[10px] underline text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-1">
      {/* Contextual awareness (beta) — the Context Engine toggle */}
      <section>
        <div className="flex items-start justify-between gap-3 rounded-lg border border-[var(--color-brand)]/30 bg-[var(--color-brand)]/5 p-3">
          <div>
            <div className="text-[12px] font-semibold text-[var(--color-foreground)]">
              Contextual awareness <span className="text-[9px] uppercase tracking-wide text-[var(--color-brand)] ml-1">beta</span>
            </div>
            <p className="text-[10px] text-[var(--color-muted-foreground)] leading-relaxed mt-1">
              Understands the moment — a prayer/sermon that just uses worship words
              (&ldquo;in the mighty name of Jesus&rdquo;) won&apos;t auto-fire a song, and an
              ambiguous &ldquo;continue&rdquo; mid-story won&apos;t step the verse. Takes effect on the next detection.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={ctxOn}
            onClick={() => { const v = !ctxOn; setCtxOn(v); try { localStorage.setItem(CONTEXT_ENGINE_KEY, v ? "1" : "0"); } catch { /* noop */ } }}
            className={cn(
              "relative shrink-0 w-10 h-6 rounded-full transition-colors",
              ctxOn ? "bg-[var(--color-brand)]" : "bg-[var(--color-muted)]",
            )}
          >
            <span className={cn("absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform", ctxOn && "translate-x-4")} />
          </button>
        </div>
      </section>
      {/* CCLI Number */}
      <section>
        <label className="block text-[10px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)] mb-1">
          CCLI Number
        </label>
        <p className="text-[10px] text-[var(--color-muted-foreground)] leading-relaxed mb-2">
          Your church&apos;s CCLI licence number — required to legally display licensed song lyrics
          and Bible translations in a worship setting.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={ccliNumber}
            onChange={(e) => setCcliNumber(e.target.value)}
            placeholder="e.g. 1234567"
            maxLength={10}
            className={cn(
              "flex-1 h-7 rounded px-2 text-[12px] bg-[var(--color-input,#1a1a1a)] border border-[var(--color-border)]",
              "text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)]",
              "focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]",
            )}
          />
          <button
            type="button"
            onClick={saveCcli}
            disabled={ccliSaving}
            className={cn(
              "h-7 px-3 rounded text-[11px] font-medium transition-colors",
              ccliSaved
                ? "bg-green-700/40 text-green-300"
                : "bg-[var(--color-brand)] text-white hover:opacity-90",
              "disabled:opacity-50",
            )}
          >
            {ccliSaved ? "Saved" : ccliSaving ? "Saving..." : "Save"}
          </button>
        </div>
        {ccliError && (
          <p className="text-[10px] text-red-400 mt-1">{ccliError}</p>
        )}
      </section>

      {/* Divider */}
      <div className="border-t border-[var(--color-border)]" />

      {/* API.Bible Key */}
      <section>
        <div className="flex items-center gap-1.5 mb-1">
          <BookKey className="w-3.5 h-3.5 text-[var(--color-muted-foreground)]" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)]">
            API.Bible Key
          </span>
          {apiKeyConfigured && (
            <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-green-700/30 text-green-300">
              Configured
            </span>
          )}
        </div>
        <p className="text-[10px] text-[var(--color-muted-foreground)] leading-relaxed mb-2">
          NIV, NKJV and NLT are already included for your church — no key needed.
          You can optionally add your own{" "}
          <a
            href="https://scripture.api.bible"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-[var(--color-foreground)]"
          >
            api.scripture.api.bible
          </a>{" "}
          key to use your own quota. The key is stored encrypted.
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={apiKeyConfigured ? "Enter new key to replace" : "Paste API.Bible key"}
            className={cn(
              "flex-1 h-7 rounded px-2 text-[12px] bg-[var(--color-input,#1a1a1a)] border border-[var(--color-border)]",
              "text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)]",
              "focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]",
            )}
          />
          <button
            type="button"
            onClick={saveApiKey}
            disabled={apiKeySaving || !apiKey.trim()}
            className={cn(
              "h-7 px-3 rounded text-[11px] font-medium transition-colors",
              apiKeySaved
                ? "bg-green-700/40 text-green-300"
                : "bg-[var(--color-brand)] text-white hover:opacity-90",
              "disabled:opacity-50",
            )}
          >
            {apiKeySaved ? "Saved" : apiKeySaving ? "Saving..." : "Save"}
          </button>
        </div>
        {apiKeyError && (
          <p className="text-[10px] text-red-400 mt-1">{apiKeyError}</p>
        )}
      </section>

      {/* Translation status grid */}
      <section>
        <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)] mb-2">
          Licensed Translations
        </p>
        <div className="flex flex-col gap-1">
          {translations.length === 0
            ? (["NIV", "NKJV", "NLT"] as const).map((code) => (
                <TranslationRow key={code} code={code} active={false} />
              ))
            : translations.map((t) => (
                <TranslationRow key={t.code} code={t.code} name={t.name} active={t.active} />
              ))}
        </div>
        {apiKeyConfigured && (
          <button
            type="button"
            onClick={revokeApiKey}
            className="mt-3 text-[10px] text-red-400 hover:text-red-300 underline"
          >
            Revoke API key
          </button>
        )}
      </section>

      {/* Help note */}
      <p className="text-[9px] text-[var(--color-muted-foreground)] leading-relaxed">
        Verse text is fetched live from API.Bible — no licensed content is stored in PresentFlow&apos;s
        database. Your CCLI licence covers public performance; the API.Bible key covers digital
        display rights.
      </p>
    </div>
  );
}

function TranslationRow({ code, name, active }: { code: string; name?: string; active: boolean }) {
  const displayName = name ?? { NIV: "New International Version", NKJV: "New King James Version", NLT: "New Living Translation", AMP: "Amplified Bible" }[code] ?? code;
  return (
    <div className={cn(
      "flex items-center gap-2 px-2 py-1.5 rounded",
      active ? "bg-green-900/20" : "bg-[var(--color-panel,#111)]",
    )}>
      {active
        ? <Unlock className="w-3 h-3 text-green-400 shrink-0" />
        : <Lock className="w-3 h-3 text-[var(--color-muted-foreground)] shrink-0" />}
      <span className="text-[11px] font-medium text-[var(--color-foreground)]">{code}</span>
      <span className="text-[10px] text-[var(--color-muted-foreground)] truncate flex-1">{displayName}</span>
      {active && <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />}
    </div>
  );
}
