"use client";
import { useCallback, useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Palette } from "lucide-react";
import { toast } from "sonner";
import { fetchThemes, switchToTheme, type QuickTheme } from "@/lib/theme-quick-apply";
import { cn } from "@/lib/utils";

/**
 * Top-bar quick theme switcher. Lists the church's themes and applies one to the
 * LIVE projector/stage/livestream in a click — the fast path for changing the
 * look mid-service without opening the full Themes editor. Stays in sync with the
 * Themes modal via the `presentflow:themes-changed` event.
 */
function swatch(config: Record<string, unknown>): React.CSSProperties {
  const bgType = (config.bgType as string) || "solid";
  const c1 = (config.bgColor as string) || "#0B0B0B";
  const c2 = (config.bgColor2 as string) || "#1A0A14";
  if (bgType === "gradient") return { background: `linear-gradient(135deg, ${c1}, ${c2})` };
  if (bgType === "image" && config.bgImageUrl) return { backgroundImage: `url(${config.bgImageUrl as string})`, backgroundSize: "cover", backgroundPosition: "center" };
  return { background: c1 };
}

export function ThemeQuickSwitch() {
  const [open, setOpen] = useState(false);
  const [themes, setThemes] = useState<QuickTheme[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => { void fetchThemes().then(setThemes); }, []);
  useEffect(() => {
    const onChanged = () => load();
    window.addEventListener("presentflow:themes-changed", onChanged);
    return () => window.removeEventListener("presentflow:themes-changed", onChanged);
  }, [load]);
  useEffect(() => { if (open) load(); }, [open, load]);

  async function choose(t: QuickTheme) {
    if (t.isDefault) { setOpen(false); return; }
    setBusy(t.id);
    const ok = await switchToTheme(t);
    setBusy(null);
    if (!ok) { toast.error("Could not switch theme"); return; }
    setThemes((prev) => prev.map((x) => ({ ...x, isDefault: x.id === t.id })));
    toast.success(`Theme “${t.name}” is live`);
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="Change the live theme"
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[12px] font-medium transition-colors",
            "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-white/5",
          )}
        >
          <Palette className="w-3.5 h-3.5" /> Change theme <ChevronDown className="w-3 h-3 opacity-70" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align="start"
          className="z-[75] w-56 rounded-lg border p-1 shadow-2xl outline-none"
          style={{ borderColor: "var(--color-border)", background: "var(--color-elevated)" }}
        >
          <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-[var(--color-muted-foreground)]">Live theme</div>
          {themes.length === 0 ? (
            <div className="px-2 py-2 text-[11px] text-[var(--color-muted-foreground)]">No themes yet — open Themes to create one.</div>
          ) : (
            themes.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => void choose(t)}
                disabled={busy === t.id}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-[var(--color-foreground)] hover:bg-white/[0.06] disabled:opacity-50"
              >
                <span className="h-5 w-8 shrink-0 rounded border" style={{ ...swatch(t.config), borderColor: "var(--color-border)" }} />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                {t.isDefault ? <Check className="h-3.5 w-3.5 shrink-0 text-[var(--color-brand)]" /> : busy === t.id ? <span className="text-[10px]">…</span> : null}
              </button>
            ))
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
