"use client";
import { useEffect, useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Tabs from "@radix-ui/react-tabs";
import { Star } from "lucide-react";

const FAV_KEY = "presentflow.pro.transitions.favorites.v1";

export const TRANSITIONS = [
  "Cut", "Fade", "Dissolve", "Slide (L→R)", "Slide (R→L)",
  "Wipe", "Amoeba", "Dispersion Blur", "Color Burn", "Iris", "Push",
];

function useFavorites(): [Set<string>, (name: string) => void] {
  const [favs, setFavs] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FAV_KEY);
      if (raw) setFavs(new Set(JSON.parse(raw) as string[]));
    } catch { /* noop */ }
  }, []);
  const toggle = (name: string) => {
    setFavs((cur) => {
      const n = new Set(cur);
      if (n.has(name)) n.delete(name); else n.add(name);
      try { window.localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(n))); } catch { /* noop */ }
      return n;
    });
  };
  return [favs, toggle];
}

export function TransitionChooser({
  transitionName, transitionDuration, onSelect, onDurationChange,
}: {
  transitionName: string;
  transitionDuration: number;
  onSelect: (name: string) => void;
  onDurationChange: (d: number) => void;
}) {
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<"all" | "favs">("all");
  const [open, setOpen] = useState(false);
  const [favs, toggleFav] = useFavorites();

  const filtered = useMemo(() => {
    const q = filter.toLowerCase().trim();
    let list = TRANSITIONS;
    if (tab === "favs") list = list.filter((t) => favs.has(t));
    if (q) list = list.filter((t) => t.toLowerCase().includes(q));
    return list;
  }, [filter, tab, favs]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="font-mono hover:text-[var(--color-foreground)]" title="Transition settings">
          {transitionName}: {transitionDuration.toFixed(1)}s
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="center" className="rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] p-3 text-[12px] shadow-lg z-50 w-[420px] flex flex-col gap-2">
          <Tabs.Root value={tab} onValueChange={(v) => setTab(v as "all" | "favs")}>
            <Tabs.List className="flex gap-1 border-b border-[var(--color-border)] mb-2">
              <Tabs.Trigger value="all" className="px-2 py-1 text-[11px] data-[state=active]:border-b-2 data-[state=active]:border-[var(--color-brand)]">All</Tabs.Trigger>
              <Tabs.Trigger value="favs" className="px-2 py-1 text-[11px] data-[state=active]:border-b-2 data-[state=active]:border-[var(--color-brand)]">Favorites</Tabs.Trigger>
            </Tabs.List>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter transitions..."
              className="w-full h-7 px-2 mb-2 rounded border border-[var(--color-border)] bg-[var(--color-panel)] text-[12px]"
            />
            <Tabs.Content value="all">
              <TransitionGrid items={filtered} selected={transitionName} favs={favs} onToggleFav={toggleFav} onSelect={(n) => { onSelect(n); setOpen(false); }} />
            </Tabs.Content>
            <Tabs.Content value="favs">
              {filtered.length === 0 ? (
                <div className="text-[var(--color-muted-foreground)] text-center py-4 text-[11px]">
                  No Favorite Transitions — Click the star to favorite a transition.
                </div>
              ) : (
                <TransitionGrid items={filtered} selected={transitionName} favs={favs} onToggleFav={toggleFav} onSelect={(n) => { onSelect(n); setOpen(false); }} />
              )}
            </Tabs.Content>
          </Tabs.Root>
          <div className="eyebrow mt-1">Duration: {transitionDuration.toFixed(1)}s</div>
          <input
            type="range"
            min={0}
            max={5}
            step={0.1}
            value={transitionDuration}
            onChange={(e) => onDurationChange(parseFloat(e.target.value))}
            className="w-full accent-[var(--color-brand)]"
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function TransitionGrid({
  items, selected, favs, onToggleFav, onSelect,
}: {
  items: string[];
  selected: string;
  favs: Set<string>;
  onToggleFav: (n: string) => void;
  onSelect: (n: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 max-h-[280px] overflow-y-auto">
      {items.map((t) => {
        const isSel = t === selected;
        const isFav = favs.has(t);
        return (
          <div key={t} className={`relative rounded border ${isSel ? "border-[var(--color-brand)]" : "border-[var(--color-border)]"} p-1`}>
            <button
              onClick={() => onSelect(t)}
              className="w-full h-[80px] rounded bg-gradient-to-br from-[var(--color-panel)] to-[var(--color-elevated)] flex items-center justify-center text-[10px] text-[var(--color-muted-foreground)]"
              style={{ width: 110 - 8 }}
              title={`Select ${t}`}
            >
              {t.slice(0, 6)}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleFav(t); }}
              className="absolute top-1 right-1 p-0.5 rounded hover:bg-[var(--color-panel)]"
              title={isFav ? "Unfavorite" : "Favorite"}
            >
              <Star className={`w-3 h-3 ${isFav ? "fill-[var(--color-brand)] text-[var(--color-brand)]" : "text-[var(--color-muted-foreground)]"}`} />
            </button>
            <div className="text-center text-[10px] mt-1 truncate">{t}</div>
          </div>
        );
      })}
    </div>
  );
}
