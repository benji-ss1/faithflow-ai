"use client";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Palette, X, Plus, Upload, ChevronDown, ChevronRight, Check } from "lucide-react";
import { useTier } from "@/hooks/useTier";
import { canAccess } from "@/lib/tier";
import { useCustomThemes, useBlankSlides } from "@/hooks/useCustomThemes";
import { cn } from "@/lib/utils";
import { ThemeImportDialog } from "@/components/library/ThemeImportDialog";
import { toast } from "sonner";

type DbTheme = {
  id: string;
  name: string;
  config: Record<string, unknown>;
  isDefault?: boolean;
};

function bgStyle(cfg: Record<string, unknown>): React.CSSProperties {
  const bgType = (cfg.bgType as string) || "solid";
  const bg1 = (cfg.bgColor as string) || "#0B0B0B";
  const bg2 = (cfg.bgColor2 as string) || "#1A0A14";
  const bgImageUrl = (cfg.bgImageUrl as string) || "";
  if (bgType === "gradient") return { background: `linear-gradient(135deg, ${bg1}, ${bg2})` };
  if (bgType === "image" && bgImageUrl) return { backgroundImage: `url(${bgImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" };
  return { background: bg1 };
}

export function ThemesTab() {
  const { tier } = useTier();
  const canPremiumThemes = tier !== null && canAccess(tier, "premium-themes");
  const { themes: customThemes, add: addCustomTheme, remove: removeCustomTheme } = useCustomThemes();
  const [importOpen, setImportOpen] = useState(false);
  const [showExtras, setShowExtras] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);

  const [dbThemes, setDbThemes] = useState<DbTheme[]>([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbError, setDbError] = useState(false);
  useEffect(() => {
    setDbLoading(true);
    setDbError(false);
    fetch("/api/themes")
      .then((r) => r.json())
      .then((data: unknown) => setDbThemes((data as { themes?: DbTheme[] }).themes ?? []))
      .catch(() => setDbError(true))
      .finally(() => setDbLoading(false));
  }, []);

  async function applyTheme(t: DbTheme) {
    setApplying(t.id);
    try {
      const res = await fetch(`/api/themes/${t.id}/apply`, { method: "POST" });
      if (!res.ok) {
        toast.error("Could not apply theme");
      } else {
        // Refresh local isDefault flags so the badge updates without a page reload.
        setDbThemes((prev) => prev.map((th) => ({ ...th, isDefault: th.id === t.id })));
        toast.success(`Theme "${t.name}" applied`);
      }
    } catch {
      toast.error("Could not apply theme");
    } finally {
      setApplying(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ThemeImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="eyebrow">Themes</div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            title="Import from ProPresenter"
            className="flex items-center gap-1 h-6 px-2 rounded border border-[var(--color-border)] text-[10px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-elevated)] transition-colors"
          >
            <Upload className="w-2.5 h-2.5" /> Import
          </button>
        </div>
      </div>

      {/* DB themes */}
      {dbLoading ? (
        <div className="text-[10px] text-[var(--color-muted-foreground)]">Loading themes…</div>
      ) : dbError ? (
        <div className="text-[10px] text-[var(--color-destructive)]">
          Could not load themes — check your connection and try again.
        </div>
      ) : dbThemes.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 h-20 rounded border border-dashed border-[var(--color-border)] text-[11px] text-[var(--color-muted-foreground)]">
          <Palette className="w-4 h-4" />
          Use + Create Quick Swatch below
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {dbThemes.map((t) => {
            const cfg = t.config;
            const textColor = (cfg.textColor as string) || "#F1EFE8";
            return (
              <div
                key={t.id}
                className={cn(
                  "relative aspect-video rounded border group overflow-hidden cursor-pointer",
                  t.isDefault ? "border-[var(--color-brand)]" : "border-[var(--color-border)]",
                )}
                style={bgStyle(cfg)}
                title={t.name}
              >
                {/* Default badge */}
                {t.isDefault && (
                  <span className="absolute top-0.5 left-0.5 text-[7px] uppercase tracking-wider bg-[var(--color-brand)]/80 text-white px-1 rounded">
                    Default
                  </span>
                )}
                {/* Theme name */}
                <div
                  className="absolute inset-0 flex items-center justify-center text-[9px] font-medium px-1 text-center leading-tight"
                  style={{ color: textColor }}
                >
                  {t.name}
                </div>
                {/* Hover overlay: Apply + Edit */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 px-1">
                  <button
                    type="button"
                    onClick={() => void applyTheme(t)}
                    disabled={applying === t.id}
                    className="w-full h-5 rounded bg-[var(--color-brand)] text-white text-[9px] font-medium flex items-center justify-center gap-1 disabled:opacity-50"
                  >
                    {applying === t.id ? "…" : <><Check className="w-2.5 h-2.5" /> Apply</>}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}


      {/* Quick swatches + extras (collapsible) */}
      {(customThemes.length > 0) && (
        <>
          <button
            type="button"
            onClick={() => setShowExtras((v) => !v)}
            className="flex items-center gap-1 text-[10px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] mt-1"
          >
            {showExtras ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Quick Swatches ({customThemes.length})
          </button>
          {showExtras && (
            <div className="grid grid-cols-3 gap-2">
              {customThemes.map((t) => (
                <div
                  key={t.id}
                  className="relative aspect-video rounded border border-[var(--color-brand)] group"
                  style={{ background: t.bgColor, color: t.textColor, fontFamily: t.fontFamily }}
                  title={t.name}
                >
                  <span className="absolute top-0.5 left-0.5 text-[7px] uppercase tracking-wider bg-[var(--color-brand)]/70 text-white px-1 rounded">Custom</span>
                  <button
                    type="button"
                    onClick={() => removeCustomTheme(t.id)}
                    className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 bg-black/60 rounded-full w-4 h-4 flex items-center justify-center text-white"
                    title="Delete"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                  <span className="absolute bottom-1 left-1 text-[9px] truncate max-w-[80%]">{t.name}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Utility buttons */}
      <div className="flex flex-col gap-1 mt-1">
        <CreateSwatchDialog onAdd={addCustomTheme} />
        <AddBlankSlideDialog />
      </div>
    </div>
  );
}

function AddBlankSlideDialog() {
  const { add: addBlankSlide } = useBlankSlides();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [bgColor, setBgColor] = useState("#000000");

  const save = () => {
    if (!name.trim()) return;
    addBlankSlide({ name: name.trim(), baseThemeId: "dark", bgColor });
    setName(""); setOpen(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="w-full h-7 rounded border border-[var(--color-border)] text-[10px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-elevated)] flex items-center justify-center gap-1">
          <Plus className="w-2.5 h-2.5" /> Add Blank Slide
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[360px] bg-[var(--color-panel)] border border-[var(--color-border)] rounded p-4 flex flex-col gap-3">
          <Dialog.Title className="text-sm font-semibold">New Blank Slide</Dialog.Title>
          <label className="text-[11px] flex flex-col gap-1">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="h-8 px-2 rounded border border-[var(--color-border)] bg-[var(--color-elevated)]" />
          </label>
          <label className="text-[11px] flex flex-col gap-1">
            Background Color
            <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="h-8 rounded border border-[var(--color-border)] bg-[var(--color-elevated)]" />
          </label>
          <div className="flex justify-end gap-2">
            <Dialog.Close asChild><button className="h-8 px-3 rounded border border-[var(--color-border)] text-[11px]">Cancel</button></Dialog.Close>
            <button onClick={save} disabled={!name.trim()} className="h-8 px-3 rounded bg-[var(--color-brand)] text-white text-[11px] disabled:opacity-50">Save</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const FONT_FAMILIES = [
  { id: "inter", name: "Inter", css: "Inter, system-ui, sans-serif" },
  { id: "serif", name: "Serif", css: "Georgia, serif" },
  { id: "mono", name: "Mono", css: "ui-monospace, SFMono-Regular, monospace" },
];

function CreateSwatchDialog({ onAdd }: { onAdd: (t: { name: string; textColor: string; bgColor: string; accentColor: string; fontFamily: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [textColor, setTextColor] = useState("#ffffff");
  const [bgColor, setBgColor] = useState("#111111");
  const [accentColor, setAccentColor] = useState("#ff7a2c");
  const [fontFamilyId, setFontFamilyId] = useState(FONT_FAMILIES[0].id);
  const font = FONT_FAMILIES.find((f) => f.id === fontFamilyId) || FONT_FAMILIES[0];

  const save = () => {
    if (!name.trim()) return;
    onAdd({ name: name.trim(), textColor, bgColor, accentColor, fontFamily: font.css });
    setName(""); setOpen(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="w-full h-7 rounded border border-[var(--color-border)] text-[10px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-elevated)] flex items-center justify-center gap-1">
          <Plus className="w-2.5 h-2.5" /> Create Quick Swatch
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[480px] bg-[var(--color-panel)] border border-[var(--color-border)] rounded p-4 flex gap-4">
          <div className="flex-1 flex flex-col gap-3">
            <Dialog.Title className="text-sm font-semibold">Quick Swatch</Dialog.Title>
            <p className="text-[10px] text-[var(--color-muted-foreground)]">
              Quick color + font swatch. Apply it from the Themes panel.
            </p>
            <label className="text-[11px] flex flex-col gap-1">Name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="h-8 px-2 rounded border border-[var(--color-border)] bg-[var(--color-elevated)]" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[11px] flex flex-col gap-1">Text color
                <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="h-8 rounded border border-[var(--color-border)] bg-[var(--color-elevated)]" />
              </label>
              <label className="text-[11px] flex flex-col gap-1">Background
                <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="h-8 rounded border border-[var(--color-border)] bg-[var(--color-elevated)]" />
              </label>
            </div>
            <label className="text-[11px] flex flex-col gap-1">Font
              <select value={fontFamilyId} onChange={(e) => setFontFamilyId(e.target.value)} className="h-8 px-2 rounded border border-[var(--color-border)] bg-[var(--color-elevated)]">
                {FONT_FAMILIES.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <div className="flex justify-end gap-2 mt-auto">
              <Dialog.Close asChild><button className="h-8 px-3 rounded border border-[var(--color-border)] text-[11px]">Cancel</button></Dialog.Close>
              <button onClick={save} disabled={!name.trim()} className="h-8 px-3 rounded bg-[var(--color-brand)] text-white text-[11px] disabled:opacity-50">Save</button>
            </div>
          </div>
          <div
            className="w-32 rounded border border-[var(--color-border)] flex items-center justify-center p-2"
            style={{ background: bgColor, color: textColor, fontFamily: font.css }}
          >
            <div className="text-center text-[10px] leading-snug">
              <div className="mb-1 text-[8px]" style={{ color: accentColor }}>JOHN 3:16</div>
              For God so loved the world…
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
