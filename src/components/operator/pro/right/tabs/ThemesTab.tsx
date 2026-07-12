"use client";
import { useTier } from "@/hooks/useTier";
import { LockedTile } from "@/components/tier/MaxUpgradePrompt";

// Y11: Intentional demo swatches — these represent PREVIEWS of user-defined
// themes (backgrounds/accents a user might design), not app-chrome tokens.
// Do not replace with CSS variables; they are content, not chrome.
const DEMO_THEME_SWATCHES = ["#0e0b12", "#1c1820", "#ff7a2c", "#ff9048", "#4fd18b", "#f0b35a"];

// P10: Mock premium theme thumbnails. Locked behind Max.
const PREMIUM_THEMES: Array<{ label: string; gradient: string }> = [
  { label: "Cinematic", gradient: "linear-gradient(135deg,#0b1220 0%,#1a2a5e 100%)" },
  { label: "Modern", gradient: "linear-gradient(135deg,#111 0%,#3a3a3a 100%)" },
  { label: "Elegant", gradient: "linear-gradient(135deg,#2b1b3d 0%,#8a4fbf 100%)" },
  { label: "Youth", gradient: "linear-gradient(135deg,#ff5c8a 0%,#ffb85c 100%)" },
];

export function ThemesTab() {
  const swatches = DEMO_THEME_SWATCHES;
  const { isMax } = useTier();
  return (
    <div className="flex flex-col gap-3">
      <select className="w-full h-8 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded">
        <option>Default Collection</option>
      </select>
      <div className="eyebrow">Themes (coming soon)</div>
      <div className="grid grid-cols-3 gap-2">
        {swatches.map((c) => (
          <div
            key={c}
            className="aspect-video rounded border border-[var(--color-border)]"
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <button data-todo="1" className="flex-1 h-8 rounded border border-[var(--color-border)]">Edit</button>
        <button data-todo="1" className="flex-1 h-8 rounded border border-[var(--color-border)]">Create</button>
      </div>

      <div className="eyebrow mt-2 flex items-center gap-1">
        Premium
        <span className="text-[9px] uppercase tracking-wider bg-[var(--color-brand)]/15 text-[var(--color-brand)] px-1 rounded">Max</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {PREMIUM_THEMES.map((t) =>
          isMax ? (
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
    </div>
  );
}
