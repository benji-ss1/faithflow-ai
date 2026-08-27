"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Settings } from "lucide-react";

// Y1: unified namespace with the rest of the Pro shell (presentflow.pro.*)
const KEY = "presentflow.pro.bible.v1";

type BibleOpts = {
  showVerseNumbers: boolean;
  breakOnNewVerse: boolean;
  displayTranslation: boolean;
  refFormat: "each" | "last" | "none";
  library: string;
  bibles: Record<string, boolean>;
};

const DEFAULT: BibleOpts = {
  showVerseNumbers: true,
  breakOnNewVerse: false,
  displayTranslation: true,
  refFormat: "each",
  library: "Default",
  bibles: { KJV: true, WEB: false, ASV: false },
};

type BibleOptsTuple = readonly [BibleOpts, (n: BibleOpts) => void];

// R4: was two independent useState instances (one in this file's popover,
// one called separately inside BibleMode) — toggling a checkbox here never
// reached BibleMode's renderer because each had its own copy of state that
// only read localStorage once at mount. Now a single Provider (mounted once
// in BibleMode, above both consumers) owns the one source of truth.
const BibleOptionsContext = createContext<BibleOptsTuple | null>(null);

export function BibleOptionsProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<BibleOpts>(DEFAULT);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) setOpts({ ...DEFAULT, ...JSON.parse(raw) });
    } catch { /* noop */ }
  }, []);
  const save = (n: BibleOpts) => {
    setOpts(n);
    try { window.localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* noop */ }
  };
  const value: BibleOptsTuple = [opts, save] as const;
  return <BibleOptionsContext.Provider value={value}>{children}</BibleOptionsContext.Provider>;
}

export function useBibleOptions(): BibleOptsTuple {
  const ctx = useContext(BibleOptionsContext);
  if (!ctx) throw new Error("useBibleOptions must be used within a BibleOptionsProvider");
  return ctx;
}

export function BibleOptionsPopover() {
  const [opts, setOpts] = useBibleOptions();

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="h-9 px-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-muted-foreground)] shadow-[var(--edge-top),var(--shadow-sm)] transition-all duration-150 [transition-timing-function:var(--ease-spring)] hover:-translate-y-px hover:text-[var(--color-foreground)] hover:border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))] hover:shadow-[var(--edge-top),var(--shadow-md)] active:scale-[0.97]">
          <Settings className="w-3.5 h-3.5" /> Options
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          className="w-[300px] rounded-xl bg-[var(--color-panel)] border border-[var(--color-border)] p-1.5 text-[12px] text-[var(--color-foreground)] shadow-[var(--edge-top),var(--shadow-lg)]"
        >
          <div className="px-2 pt-1.5 pb-1 text-[10px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Slide Options
          </div>

          {/* Toggles — brand-accented, whole row clickable + hover. */}
          <div className="flex flex-col">
            {([
              ["showVerseNumbers", "Show verse numbers"],
              ["breakOnNewVerse", "Break on new verse"],
              ["displayTranslation", "Show translation"],
            ] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2.5 px-2 py-1.5 rounded-md cursor-pointer hover:bg-[var(--color-elevated)] transition-colors">
                <input
                  type="checkbox"
                  checked={opts[k]}
                  onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })}
                  className="w-4 h-4 accent-[var(--color-brand)] cursor-pointer"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <div className="my-1 border-t" style={{ borderColor: "var(--color-border)" }} />

          {/* Reference footer control. */}
          <div className="px-2 pt-1 pb-1 text-[10px] font-mono uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Reference footer
          </div>
          <div className="flex flex-col">
            {([
              ["each", "Show on every verse"],
              ["last", "Show on last verse only"],
              ["none", "Hide reference"],
            ] as const).map(([v, label]) => (
              <label key={v} className="flex items-center gap-2.5 px-2 py-1.5 rounded-md cursor-pointer hover:bg-[var(--color-elevated)] transition-colors">
                <input
                  type="radio"
                  name="bible-refformat"
                  checked={opts.refFormat === v}
                  onChange={() => setOpts({ ...opts, refFormat: v })}
                  className="w-4 h-4 accent-[var(--color-brand)] cursor-pointer"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
