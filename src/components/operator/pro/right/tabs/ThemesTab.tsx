"use client";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useTier } from "@/hooks/useTier";
import { canAccess } from "@/lib/tier";
import { LockedTile } from "@/components/tier/MaxUpgradePrompt";
import { useCustomThemes, useBlankSlides } from "@/hooks/useCustomThemes";

// Y11: Intentional demo swatches — these represent PREVIEWS of user-defined
// themes (backgrounds/accents a user might design), not app-chrome tokens.
// Do not replace with CSS variables; they are content, not chrome.
const DEMO_THEME_SWATCHES = ["#0e0b12", "#1c1820", "#ff7a2c", "#ff9048", "#4fd18b", "#f0b35a"];

const BASE_THEMES = [
  { id: "dark", name: "Dark" },
  { id: "light", name: "Light" },
  { id: "brand", name: "Brand" },
];

const FONT_FAMILIES = [
  { id: "inter", name: "Inter", css: "Inter, system-ui, sans-serif" },
  { id: "serif", name: "Serif", css: "Georgia, serif" },
  { id: "mono", name: "Mono", css: "ui-monospace, SFMono-Regular, monospace" },
  { id: "display", name: "Display", css: "system-ui, sans-serif" },
];

// P10: Mock premium theme thumbnails. Locked behind Max.
const PREMIUM_THEMES: Array<{ label: string; gradient: string }> = [
  { label: "Cinematic", gradient: "linear-gradient(135deg,#0b1220 0%,#1a2a5e 100%)" },
  { label: "Modern", gradient: "linear-gradient(135deg,#111 0%,#3a3a3a 100%)" },
  { label: "Elegant", gradient: "linear-gradient(135deg,#2b1b3d 0%,#8a4fbf 100%)" },
  { label: "Youth", gradient: "linear-gradient(135deg,#ff5c8a 0%,#ffb85c 100%)" },
];

export function ThemesTab() {
  const swatches = DEMO_THEME_SWATCHES;
  const { tier } = useTier();
  const canPremiumThemes = tier !== null && canAccess(tier, "premium-themes");
  const { themes: customThemes, add: addCustomTheme, remove: removeCustomTheme } = useCustomThemes();
  const { slides: blankSlides, add: addBlankSlide, remove: removeBlankSlide } = useBlankSlides();

  return (
    <div className="flex flex-col gap-3">
      <select className="w-full h-8 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded">
        <option>Default Collection</option>
      </select>
      <div className="eyebrow">Themes</div>
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
        {swatches.map((c) => (
          <div
            key={c}
            className="aspect-video rounded border border-[var(--color-border)]"
            style={{ background: c }}
          />
        ))}
      </div>

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

      <CreateThemeDialog onAdd={addCustomTheme} />

      <div className="eyebrow mt-2 flex items-center gap-1">
        Premium
        <span className="text-[9px] uppercase tracking-wider bg-[var(--color-brand)]/15 text-[var(--color-brand)] px-1 rounded">Max</span>
      </div>
      {tier === null ? (
        <div className="h-8" aria-hidden />
      ) : (
      <div className="grid grid-cols-2 gap-2">
        {PREMIUM_THEMES.map((t) =>
          canPremiumThemes ? (
            <button
              key={t.label}
              type="button"
              disabled
              title="Coming soon"
              className="relative aspect-video rounded border border-[var(--color-border)] overflow-hidden opacity-70 cursor-not-allowed"
              style={{ background: t.gradient }}
            >
              <span className="absolute bottom-1 left-1 text-[10px] font-medium text-white uppercase tracking-wider">
                {t.label}
              </span>
            </button>
          ) : (
            <LockedTile
              key={t.label}
              label={t.label}
              gradient={t.gradient}
              feature="premium-themes"
            />
          ),
        )}
      </div>
      )}
    </div>
  );
}

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
        <button className="w-full h-8 rounded border border-[var(--color-border)] text-[11px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-elevated)]">
          + Add New Blank Slide
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

function CreateThemeDialog({ onAdd }: { onAdd: (t: { name: string; textColor: string; bgColor: string; accentColor: string; fontFamily: string }) => void }) {
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
    setName("");
    setOpen(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="w-full h-8 rounded border border-[var(--color-border)] text-[11px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-elevated)]">
          + Create Your Own Theme
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[640px] h-[480px] bg-[var(--color-panel)] border border-[var(--color-border)] rounded p-4 flex gap-4">
          <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
            <Dialog.Title className="text-sm font-semibold">Create Your Own Theme</Dialog.Title>
            <label className="text-[11px] flex flex-col gap-1">
              Theme name
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
              <button onClick={save} className="h-8 px-3 rounded bg-[var(--color-brand)] text-white text-[11px]">Save</button>
            </div>
          </div>
          <div className="flex-1 rounded border border-[var(--color-border)] flex items-center justify-center p-4" style={{ background: bgColor, color: textColor, fontFamily: font.css }}>
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
