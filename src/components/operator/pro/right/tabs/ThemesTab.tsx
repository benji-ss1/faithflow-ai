"use client";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ExternalLink, Palette, X, Plus } from "lucide-react";
import { useTier } from "@/hooks/useTier";
import { canAccess } from "@/lib/tier";
import { LockedTile } from "@/components/tier/MaxUpgradePrompt";
import { useCustomThemes, useBlankSlides } from "@/hooks/useCustomThemes";
import { cn } from "@/lib/utils";

// P10: Mock premium theme thumbnails. Locked behind Max.
const PREMIUM_THEMES: Array<{ label: string; gradient: string }> = [
  { label: "Cinematic", gradient: "linear-gradient(135deg,#0b1220 0%,#1a2a5e 100%)" },
  { label: "Modern", gradient: "linear-gradient(135deg,#111 0%,#3a3a3a 100%)" },
  { label: "Elegant", gradient: "linear-gradient(135deg,#2b1b3d 0%,#8a4fbf 100%)" },
  { label: "Youth", gradient: "linear-gradient(135deg,#ff5c8a 0%,#ffb85c 100%)" },
];

const FONT_FAMILIES = [
  { id: "inter", name: "Inter", css: "Inter, system-ui, sans-serif" },
  { id: "serif", name: "Serif", css: "Georgia, serif" },
  { id: "mono", name: "Mono", css: "ui-monospace, SFMono-Regular, monospace" },
  { id: "display", name: "Display", css: "system-ui, sans-serif" },
];

const BASE_THEMES = [
  { id: "dark", name: "Dark" },
  { id: "light", name: "Light" },
  { id: "brand", name: "Brand" },
];

type DbTheme = {
  id: string;
  name: string;
  config: Record<string, unknown>;
  isDefault?: boolean;
};

export function ThemesTab() {
  const { tier } = useTier();
  const canPremiumThemes = tier !== null && canAccess(tier, "premium-themes");
  const { themes: customThemes, add: addCustomTheme, remove: removeCustomTheme } = useCustomThemes();
  const { slides: blankSlides, add: addBlankSlide, remove: removeBlankSlide } = useBlankSlides();

  // Fetch real DB themes from the API
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

  return (
    <div className="flex flex-col gap-3">
      <div className="eyebrow">Themes</div>

      {/* DB themes from /library/themes — real, editable, church-owned */}
      {dbLoading ? (
        <div className="text-[10px] text-[var(--color-muted-foreground)]">Loading themes…</div>
      ) : dbError ? (
        <div className="text-[10px] text-[var(--color-destructive)]">
          Could not load themes.{" "}
          <a href="/library/themes" target="_blank" rel="noopener noreferrer" className="underline">Open editor</a>
        </div>
      ) : dbThemes.length > 0 ? (
        <>
          <div className="text-[10px] text-[var(--color-muted-foreground)] leading-relaxed">
            Your saved themes. Click any to preview in the slide editor.
          </div>
          <div className="grid grid-cols-2 gap-2">
            {dbThemes.map((t) => {
              const cfg = t.config;
              const bgType = (cfg.bgType as string) || "solid";
              const bg1 = (cfg.bgColor as string) || "#0B0B0B";
              const bg2 = (cfg.bgColor2 as string) || "#1A0A14";
              const bgImageUrl = (cfg.bgImageUrl as string) || "";
              const textColor = (cfg.textColor as string) || "#F1EFE8";
              const bgStyle: React.CSSProperties =
                bgType === "gradient"
                  ? { background: `linear-gradient(135deg, ${bg1}, ${bg2})` }
                  : bgType === "image" && bgImageUrl
                    ? { backgroundImage: `url(${bgImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                    : { background: bg1 };

              return (
                <div
                  key={t.id}
                  className={cn(
                    "relative aspect-video rounded border group cursor-default overflow-hidden",
                    t.isDefault ? "border-[var(--color-brand)]" : "border-[var(--color-border)]",
                  )}
                  style={bgStyle}
                  title={t.name}
                >
                  {t.isDefault && (
                    <span className="absolute top-0.5 left-0.5 text-[8px] uppercase tracking-wider bg-[var(--color-brand)]/80 text-white px-1 rounded">
                      Default
                    </span>
                  )}
                  <div
                    className="absolute inset-0 flex items-center justify-center text-[9px] font-medium px-1 text-center leading-tight"
                    style={{ color: textColor }}
                  >
                    {t.name}
                  </div>
                </div>
              );
            })}
          </div>
          <a
            href="/library/themes"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[11px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Edit themes in full editor
          </a>
        </>
      ) : (
        <>
          <div className="text-[10px] text-[var(--color-muted-foreground)] leading-relaxed">
            No saved themes yet. Create one to set colours, fonts, backgrounds, and logo placement.
          </div>
          <a
            href="/library/themes"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 h-8 rounded border border-[var(--color-border)] text-[11px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-elevated)] transition-colors"
          >
            <Palette className="w-3 h-3" />
            Create your first theme
          </a>
        </>
      )}

      {/* Custom local themes (localStorage — quick operator swatches) */}
      {customThemes.length > 0 && (
        <>
          <div className="eyebrow mt-1">Quick Swatches</div>
          <div className="grid grid-cols-3 gap-2">
            {customThemes.map((t) => (
              <div
                key={t.id}
                className="relative aspect-video rounded border border-[var(--color-brand)] group"
                style={{ background: t.bgColor, color: t.textColor, fontFamily: t.fontFamily }}
                title={t.name}
              >
                <span className="absolute top-0.5 left-0.5 text-[8px] uppercase tracking-wider bg-[var(--color-brand)]/70 text-white px-1 rounded">Custom</span>
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
        </>
      )}

      {/* Blank slides */}
      <AddBlankSlideDialog onAdd={addBlankSlide} />

      {blankSlides.length > 0 && (
        <>
          <div className="eyebrow mt-2">My Blank Slides</div>
          <div className="grid grid-cols-3 gap-2">
            {blankSlides.map((s) => (
              <div
                key={s.id}
                className="relative aspect-video rounded border border-[var(--color-border)] group flex items-center justify-center text-[10px]"
                style={{ background: s.bgColor || "var(--color-panel)" }}
                title={s.name}
              >
                <span className="truncate max-w-[80%]">{s.name}</span>
                <button
                  type="button"
                  onClick={() => removeBlankSlide(s.id)}
                  className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 bg-black/60 rounded-full w-4 h-4 flex items-center justify-center text-white"
                  title="Delete"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Quick swatch creator */}
      <CreateSwatchDialog onAdd={addCustomTheme} />

      {/* Premium themes */}
      <div className="eyebrow mt-2 flex items-center gap-1">
        Premium
        <span className="text-[9px] uppercase tracking-wider bg-[var(--color-brand)]/15 text-[var(--color-brand)] px-1 rounded">Max</span>
      </div>
      {tier === null ? (
        <div className="h-8" aria-hidden />
      ) : canPremiumThemes ? (
        <div className="text-[11px] text-[var(--color-muted-foreground)]">
          Premium themes are included in your plan. Apply themes via the slide editor.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {PREMIUM_THEMES.map((t) => (
            <LockedTile
              key={t.label}
              label={t.label}
              gradient={t.gradient}
              feature="premium-themes"
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add blank slide dialog (unchanged)
// ---------------------------------------------------------------------------
function AddBlankSlideDialog({ onAdd }: { onAdd: (s: { name: string; baseThemeId: string; bgColor?: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [baseThemeId, setBaseThemeId] = useState(BASE_THEMES[0].id);
  const [bgColor, setBgColor] = useState("");

  const save = () => {
    if (!name.trim()) return;
    onAdd({ name: name.trim(), baseThemeId, bgColor: bgColor || undefined });
    setName(""); setBgColor(""); setBaseThemeId(BASE_THEMES[0].id);
    setOpen(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="w-full h-8 rounded border border-[var(--color-border)] text-[11px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-elevated)] flex items-center justify-center gap-1">
          <Plus className="w-3 h-3" /> Add New Blank Slide
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] bg-[var(--color-panel)] border border-[var(--color-border)] rounded p-4 flex flex-col gap-3">
          <Dialog.Title className="text-sm font-semibold">New Blank Slide</Dialog.Title>
          <label className="text-[11px] flex flex-col gap-1">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} className="h-8 px-2 rounded border border-[var(--color-border)] bg-[var(--color-elevated)]" />
          </label>
          <label className="text-[11px] flex flex-col gap-1">
            Base Theme
            <select value={baseThemeId} onChange={(e) => setBaseThemeId(e.target.value)} className="h-8 px-2 rounded border border-[var(--color-border)] bg-[var(--color-elevated)]">
              {BASE_THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="text-[11px] flex flex-col gap-1">
            Background Color (optional)
            <input type="color" value={bgColor || "#000000"} onChange={(e) => setBgColor(e.target.value)} className="h-8 rounded border border-[var(--color-border)] bg-[var(--color-elevated)]" />
          </label>
          <div className="flex justify-end gap-2 mt-2">
            <Dialog.Close asChild><button className="h-8 px-3 rounded border border-[var(--color-border)] text-[11px]">Cancel</button></Dialog.Close>
            <button onClick={save} className="h-8 px-3 rounded bg-[var(--color-brand)] text-white text-[11px]">Save</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// Quick swatch creator — enhanced with background image upload + logo upload
// ---------------------------------------------------------------------------
function CreateSwatchDialog({ onAdd }: { onAdd: (t: { name: string; textColor: string; bgColor: string; accentColor: string; fontFamily: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [textColor, setTextColor] = useState("#ffffff");
  const [bgColor, setBgColor] = useState("#111111");
  const [accentColor, setAccentColor] = useState("#ff7a2c");
  const [fontFamilyId, setFontFamilyId] = useState(FONT_FAMILIES[0].id);
  const [bgImageUrl, setBgImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const font = FONT_FAMILIES.find((f) => f.id === fontFamilyId) || FONT_FAMILIES[0];

  async function pickBgFile(file: File) {
    setUploading(true);
    try {
      const presign = await fetch("/api/media/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size, purpose: "media" }),
      }).then((r) => r.json()) as { url?: string; key?: string; error?: string };
      if (presign.error) throw new Error(presign.error);
      if (!presign.url || !presign.key) throw new Error("Presign missing url or key");
      const put = await fetch(presign.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error("Upload failed");
      // Get a presigned GET URL so the preview survives page reload
      const getResult = await fetch("/api/media/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: presign.key }),
      }).then((r) => r.json()) as { url?: string; error?: string };
      if (!getResult.url) throw new Error(getResult.error ?? "Could not get download URL");
      setBgImageUrl(getResult.url);
    } catch (e) {
      const { toast } = await import("sonner");
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const save = () => {
    if (!name.trim()) return;
    onAdd({ name: name.trim(), textColor, bgColor, accentColor, fontFamily: font.css });
    setName(""); setBgImageUrl(""); setOpen(false);
  };

  const previewStyle: React.CSSProperties = bgImageUrl
    ? { backgroundImage: `url(${bgImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
    : { background: bgColor };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="w-full h-8 rounded border border-[var(--color-border)] text-[11px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-elevated)] flex items-center justify-center gap-1">
          <Plus className="w-3 h-3" /> Create Quick Swatch
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[640px] max-h-[90vh] overflow-y-auto bg-[var(--color-panel)] border border-[var(--color-border)] rounded p-4 flex gap-4">
          <div className="flex-1 flex flex-col gap-3">
            <Dialog.Title className="text-sm font-semibold">Create Quick Swatch</Dialog.Title>
            <p className="text-[10px] text-[var(--color-muted-foreground)]">
              Quick swatches are operator shortcuts. For full themes with logo placement, transitions, and scripture layouts, use <a href="/library/themes" target="_blank" rel="noopener noreferrer" className="underline">Library → Themes</a>.
            </p>

            <label className="text-[11px] flex flex-col gap-1">
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} className="h-8 px-2 rounded border border-[var(--color-border)] bg-[var(--color-elevated)]" />
            </label>
            <label className="text-[11px] flex flex-col gap-1">
              Text color
              <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="h-8 rounded border border-[var(--color-border)] bg-[var(--color-elevated)]" />
            </label>
            <label className="text-[11px] flex flex-col gap-1">
              Background color
              <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="h-8 rounded border border-[var(--color-border)] bg-[var(--color-elevated)]" />
            </label>
            <label className="text-[11px] flex flex-col gap-1">
              Background image (optional)
              <label className={cn("flex h-8 cursor-pointer items-center justify-center rounded border border-dashed border-[var(--color-border)] text-[11px] text-[var(--color-muted-foreground)] hover:border-[var(--color-brand)]/50 hover:text-[var(--color-foreground)]", uploading && "opacity-50 pointer-events-none")}>
                {uploading ? "Uploading…" : bgImageUrl ? "Replace image…" : "Upload background image…"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickBgFile(f); e.target.value = ""; }}
                />
              </label>
              {bgImageUrl && (
                <button type="button" onClick={() => setBgImageUrl("")} className="mt-1 text-[10px] text-red-400 hover:text-red-300 text-left">
                  Remove image
                </button>
              )}
            </label>
            <label className="text-[11px] flex flex-col gap-1">
              Accent color
              <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="h-8 rounded border border-[var(--color-border)] bg-[var(--color-elevated)]" />
            </label>
            <label className="text-[11px] flex flex-col gap-1">
              Font family
              <select value={fontFamilyId} onChange={(e) => setFontFamilyId(e.target.value)} className="h-8 px-2 rounded border border-[var(--color-border)] bg-[var(--color-elevated)]">
                {FONT_FAMILIES.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <div className="flex justify-end gap-2 mt-auto">
              <Dialog.Close asChild><button className="h-8 px-3 rounded border border-[var(--color-border)] text-[11px]">Cancel</button></Dialog.Close>
              <button onClick={save} disabled={!name.trim()} className="h-8 px-3 rounded bg-[var(--color-brand)] text-white text-[11px] disabled:opacity-50">Save</button>
            </div>
          </div>

          {/* Live preview */}
          <div
            className="flex-1 rounded border border-[var(--color-border)] flex items-center justify-center p-4 min-h-[200px]"
            style={{ ...previewStyle, color: textColor, fontFamily: font.css }}
          >
            <div className="text-center">
              <div className="text-xs mb-2" style={{ color: accentColor }}>PSALM 23:1</div>
              <div className="text-lg leading-snug">The Lord is my shepherd; I shall not want.</div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
