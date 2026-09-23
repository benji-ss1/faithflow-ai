"use client";
/**
 * Church defaults (2026-09-23, user-approved) — ONE simple card for the three
 * church-wide defaults: Bible translation, main theme, animated background.
 * Reused in the operator Settings modal ("Church defaults" tab), /organization,
 * and the onboarding wizard. Admin-only writes (setChurchDefaults); others see
 * it read-only. Saving never changes what is on the projector right now — the
 * defaults load the next time the app starts.
 */
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { getChurchDefaults, setChurchDefaults } from "@/lib/actions";
import { DEFAULT_BACKGROUND_CHOICES } from "@/lib/church-defaults";
import { cn } from "@/lib/utils";

type View = {
  translationId: string | null;
  mainThemeId: string | null;
  backgroundId: string | null;
  translations: { id: string; code: string; name: string }[];
  themes: { id: string; name: string; config: Record<string, unknown>; isDefault: boolean }[];
  canEdit: boolean;
};

function themeThumbStyle(cfg: Record<string, unknown>): React.CSSProperties {
  const bgType = (cfg.bgType as string) || "solid";
  const bg1 = (cfg.bgColor as string) || "#0B0B0B";
  const bg2 = (cfg.bgColor2 as string) || "#1A0A14";
  const img = (cfg.bgImageUrl as string) || "";
  if (bgType === "gradient") return { background: `linear-gradient(135deg, ${bg1}, ${bg2})` };
  if (bgType === "image" && img) return { backgroundImage: `url("${img}")`, backgroundSize: "cover", backgroundPosition: "center" };
  return { background: bg1 };
}

export function ChurchDefaultsCard({ compact = false, onSaved }: { compact?: boolean; onSaved?: () => void }) {
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [translationId, setTranslationId] = useState<string>("");
  const [mainThemeId, setMainThemeId] = useState<string>("");
  const [backgroundId, setBackgroundId] = useState<string>("none");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    getChurchDefaults()
      .then((res) => {
        if (!alive) return;
        if (!res.ok || !res.data) { setLoadError(true); return; }
        const d = res.data;
        setView(d);
        setTranslationId(d.translationId ?? "");
        setMainThemeId(d.mainThemeId ?? "");
        setBackgroundId(d.backgroundId ?? "none");
      })
      .catch(() => { if (alive) setLoadError(true); });
    return () => { alive = false; };
  }, []);

  if (loadError) return <div className="text-sm text-muted-foreground">Couldn&apos;t load church defaults. Check your connection and try again.</div>;
  if (!view) return <div className="text-sm text-muted-foreground">Loading church defaults…</div>;

  const disabled = !view.canEdit || pending;
  const dirty =
    (translationId || null) !== (view.translationId ?? null) ||
    (mainThemeId || null) !== (view.mainThemeId ?? null) ||
    (backgroundId === "none" ? null : backgroundId) !== (view.backgroundId ?? null);

  function save() {
    if (!view) return;
    const patch: { translationId?: string | null; mainThemeId?: string | null; backgroundId?: string | null } = {};
    if ((translationId || null) !== (view.translationId ?? null)) patch.translationId = translationId || null;
    if (mainThemeId && mainThemeId !== view.mainThemeId) patch.mainThemeId = mainThemeId;
    const bg = backgroundId === "none" ? null : backgroundId;
    if (bg !== (view.backgroundId ?? null)) patch.backgroundId = bg;
    startTransition(async () => {
      const res = await setChurchDefaults(patch);
      if (!res.ok) { toast.error(res.error || "Could not save church defaults"); return; }
      setView({ ...view, translationId: translationId || null, mainThemeId: mainThemeId || view.mainThemeId, backgroundId: bg,
        themes: view.themes.map((t) => ({ ...t, isDefault: t.id === (mainThemeId || view.mainThemeId) })) });
      // Other operator surfaces refresh their theme lists (badges). Does NOT
      // change what is live right now.
      try { window.dispatchEvent(new CustomEvent("presentflow:themes-changed")); } catch { /* noop */ }
      toast.success("Church defaults saved — they load every time the app starts");
      onSaved?.();
    });
  }

  const label = "mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground";

  return (
    <div className="space-y-5">
      {!view.canEdit && (
        <div className="rounded-lg border border-border px-3 py-2 text-[12px] text-muted-foreground">
          Only church admins can change these. You can still switch translation, theme and background during a service — those changes last for that session only.
        </div>
      )}

      <label className="block">
        <div className={label}>Default Bible translation</div>
        <select
          value={translationId}
          disabled={disabled}
          onChange={(e) => setTranslationId(e.target.value)}
          className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none disabled:opacity-60"
        >
          <option value="">King James Version (KJV) — built-in default</option>
          {view.translations.map((t) => (
            <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
          ))}
        </select>
        <div className="mt-1 text-[11px] text-muted-foreground">Scripture opens in this translation. Switching during a service only lasts for that service.</div>
      </label>

      <div>
        <div className={label}>Main theme</div>
        {view.themes.length === 0 ? (
          <div className="text-[12px] text-muted-foreground">No themes yet — create one in Themes, then pick it here.</div>
        ) : (
          <div className={cn("grid gap-2", compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3")} role="radiogroup" aria-label="Main theme">
            {view.themes.map((t) => {
              const selected = mainThemeId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() => setMainThemeId(t.id)}
                  className={cn(
                    "relative aspect-video overflow-hidden rounded-lg border text-left disabled:cursor-not-allowed",
                    selected ? "border-[var(--color-brand)] ring-2 ring-[var(--color-brand)]/50" : "border-border",
                  )}
                  style={themeThumbStyle(t.config)}
                  title={t.name}
                >
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">{t.name}</span>
                  {selected && <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-[var(--color-brand)] text-white"><Check className="h-3 w-3" /></span>}
                </button>
              );
            })}
          </div>
        )}
        <div className="mt-1 text-[11px] text-muted-foreground">Loads every time the app starts. Applying another theme during a service is live-only.</div>
      </div>

      <div>
        <div className={label}>Default animated background</div>
        <div className={cn("grid gap-2", compact ? "grid-cols-4" : "grid-cols-3 sm:grid-cols-4")} role="radiogroup" aria-label="Default animated background">
          {[{ id: "none", name: "None", primary: "#111", secondary: "#222" }, ...DEFAULT_BACKGROUND_CHOICES].map((b) => {
            const selected = backgroundId === b.id;
            return (
              <button
                key={b.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => setBackgroundId(b.id)}
                className={cn(
                  "relative aspect-video overflow-hidden rounded-lg border disabled:cursor-not-allowed",
                  selected ? "border-[var(--color-brand)] ring-2 ring-[var(--color-brand)]/50" : "border-border",
                )}
                style={{ background: `linear-gradient(135deg, ${b.primary}, ${b.secondary})` }}
                title={b.name}
              >
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{b.name}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">Used on a computer that hasn&apos;t picked a background yet. A computer that already chose one keeps its choice.</div>
      </div>

      {view.canEdit && (
        <div className="flex items-center justify-end gap-2">
          {dirty ? <span className="text-xs text-muted-foreground">Unsaved changes</span> : null}
          <button
            type="button"
            onClick={save}
            disabled={!dirty || pending}
            className="h-10 rounded-xl bg-[var(--color-brand)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save church defaults"}
          </button>
        </div>
      )}
    </div>
  );
}
