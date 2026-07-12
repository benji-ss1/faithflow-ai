"use client";
import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Tabs from "@radix-ui/react-tabs";
import { Settings } from "lucide-react";

// Y1: unified namespace with the rest of the Pro shell (presentflow.pro.*)
const KEY = "presentflow.pro.bible.v1";

type BibleOpts = {
  showVerseNumbers: boolean;
  breakOnNewVerse: boolean;
  displayTranslation: boolean;
  preserveFontColor: boolean;
  refFormat: "each" | "last" | "none";
  library: string;
  bibles: Record<string, boolean>;
};

const DEFAULT: BibleOpts = {
  showVerseNumbers: true,
  breakOnNewVerse: false,
  displayTranslation: true,
  preserveFontColor: false,
  refFormat: "each",
  library: "Default",
  bibles: { KJV: true, WEB: false, ASV: false },
};

export function useBibleOptions() {
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
  return [opts, save] as const;
}

export function BibleOptionsPopover() {
  const [opts, setOpts] = useBibleOptions();

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="h-8 px-2 rounded-md border border-[var(--color-border)] flex items-center gap-1 text-[12px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
          <Settings className="w-3.5 h-3.5" /> Options
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          className="w-[320px] rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-2 text-[12px] shadow-xl"
        >
          <Tabs.Root defaultValue="slide">
            <Tabs.List className="flex border-b border-[var(--color-border)] mb-2">
              <Tabs.Trigger value="slide" className="flex-1 px-2 py-1 eyebrow data-[state=active]:text-[var(--color-foreground)] data-[state=active]:border-b-2 data-[state=active]:border-[var(--color-brand)]">
                Slide Options
              </Tabs.Trigger>
              <Tabs.Trigger value="bibles" className="flex-1 px-2 py-1 eyebrow data-[state=active]:text-[var(--color-foreground)] data-[state=active]:border-b-2 data-[state=active]:border-[var(--color-brand)]">
                Bibles
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="slide" className="flex flex-col gap-2">
              {([
                ["showVerseNumbers", "Show Verse Numbers"],
                ["breakOnNewVerse", "Break on New Verse"],
                ["displayTranslation", "Display Translation"],
                ["preserveFontColor", "Preserve Font Color"],
              ] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={opts[k]}
                    onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
              <div className="eyebrow mt-2">Reference</div>
              {(["each", "last", "none"] as const).map((v) => (
                <label key={v} className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={opts.refFormat === v}
                    onChange={() => setOpts({ ...opts, refFormat: v })}
                  />
                  {v === "each" ? "Passage Each" : v === "last" ? "Passage Last" : "No Reference"}
                </label>
              ))}
              <div className="eyebrow mt-2">Theme</div>
              <div className="h-10 rounded border border-[var(--color-border)] bg-[var(--color-panel)]" />
              <div className="eyebrow mt-2">Import Library</div>
              <select className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded px-2 py-1">
                <option>Default</option>
              </select>
            </Tabs.Content>

            <Tabs.Content value="bibles">
              <Tabs.Root defaultValue="free">
                <Tabs.List className="flex border-b border-[var(--color-border)] mb-2">
                  <Tabs.Trigger value="purchased" className="flex-1 py-1 eyebrow data-[state=active]:text-[var(--color-foreground)]">Purchased</Tabs.Trigger>
                  <Tabs.Trigger value="free" className="flex-1 py-1 eyebrow data-[state=active]:text-[var(--color-foreground)]">Free</Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content value="purchased" className="py-2 text-[var(--color-muted-foreground)]">
                  Activate Present Flow to purchase Bibles.
                </Tabs.Content>
                <Tabs.Content value="free" className="flex flex-col gap-1">
                  {(["KJV", "WEB", "ASV"] as const).map((code) => (
                    <label key={code} className="flex items-center justify-between py-1">
                      <span>{code}</span>
                      <input
                        type="checkbox"
                        checked={!!opts.bibles[code]}
                        onChange={(e) => setOpts({ ...opts, bibles: { ...opts.bibles, [code]: e.target.checked } })}
                      />
                    </label>
                  ))}
                </Tabs.Content>
              </Tabs.Root>
            </Tabs.Content>
          </Tabs.Root>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
