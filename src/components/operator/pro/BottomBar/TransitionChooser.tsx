"use client";
import { useEffect, useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Tabs from "@radix-ui/react-tabs";
import { Star, Search, Check } from "lucide-react";

const FAV_KEY = "presentflow.pro.transitions.favorites.v1";

export const TRANSITIONS = [
  "Cut", "Fade", "Dissolve", "Slide (L→R)", "Slide (R→L)",
  "Wipe", "Amoeba", "Dispersion Blur", "Color Burn", "Iris", "Push",
];

// Map each display name to a preview-animation class (see PREVIEW_CSS below).
// Exotic effects that share an engine substitute reuse a fitting preview.
function previewKind(name: string): string {
  switch (name) {
    case "Cut": return "cut";
    case "Fade": return "fade";
    case "Dissolve": return "dissolve";
    case "Slide (L→R)": return "slide-lr";
    case "Slide (R→L)": return "slide-rl";
    case "Wipe": return "wipe";
    case "Push": return "push";
    case "Iris": return "iris";
    case "Amoeba": return "dissolve";
    case "Dispersion Blur": return "dissolve";
    case "Color Burn": return "burn";
    default: return "fade";
  }
}

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
  transitionName, transitionDuration, transitionsOff = false, onToggleOff, onSelect, onDurationChange,
}: {
  transitionName: string;
  transitionDuration: number;
  transitionsOff?: boolean;
  onToggleOff?: (off: boolean) => void;
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
        <button className="font-mono hover:text-[var(--color-foreground)]" title={transitionsOff ? "Transitions are OFF (instant cut)" : `Transition: ${transitionName}, ${transitionDuration.toFixed(1)}s`}>
          {transitionsOff ? "Off" : transitionName}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="center"
          sideOffset={10}
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-0 text-[12px] shadow-[var(--edge-top),var(--shadow-lg)] z-50 w-[460px] overflow-hidden"
        >
          <style>{PREVIEW_CSS}</style>

          {/* Header: tabs + search */}
          <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2 border-b border-[var(--color-border)]">
            <Tabs.Root value={tab} onValueChange={(v) => setTab(v as "all" | "favs")}>
              <Tabs.List className="relative flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-app-bg)] p-[3px] shadow-[var(--edge-top),inset_0_1px_2px_rgba(0,0,0,0.28)]">
                {(["all", "favs"] as const).map((v) => (
                  <Tabs.Trigger
                    key={v}
                    value={v}
                    className="relative z-10 px-3.5 h-7 rounded-full text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] transition-[color,background,box-shadow] duration-200 [transition-timing-function:var(--ease-spring)] hover:text-[var(--color-foreground)] data-[state=active]:text-black data-[state=active]:font-bold data-[state=active]:bg-[image:var(--grad-ember)] data-[state=active]:shadow-[var(--edge-top),var(--shadow-md)]"
                  >
                    {v === "all" ? "All" : "Favorites"}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            </Tabs.Root>
            <div className="flex items-center gap-2">
              {/* Master OFF toggle — disables ALL transitions (instant hard cut
                  on every send) regardless of the selected effect. */}
              <button
                type="button"
                onClick={() => onToggleOff?.(!transitionsOff)}
                title={transitionsOff ? "Transitions are OFF — click to turn on" : "Turn transitions OFF (instant cut)"}
                className={`h-8 px-3 rounded-full text-[11px] font-semibold uppercase tracking-wide inline-flex items-center gap-1 transition-[transform,box-shadow,border-color,color] duration-200 [transition-timing-function:var(--ease-spring)] active:scale-[0.97] ${
                  transitionsOff
                    ? "bg-[image:var(--grad-ember)] text-black font-bold shadow-[var(--edge-top),var(--shadow-ember)] motion-safe:hover:-translate-y-px hover:shadow-[var(--edge-top),var(--shadow-ember-lg)]"
                    : "border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] shadow-[var(--edge-top),var(--shadow-sm)] motion-safe:hover:-translate-y-px hover:text-[var(--color-foreground)] hover:border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))] hover:shadow-[var(--edge-top),var(--shadow-md)]"
                }`}
              >
                {transitionsOff && <Check className="w-3.5 h-3.5" />} Off
              </button>
              <div className="relative w-[150px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search"
                  className="w-full h-8 pl-8 pr-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] text-[12px] text-[var(--color-foreground)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.28)] outline-none transition-colors duration-200 focus:border-[var(--color-brand)]"
                />
              </div>
            </div>
          </div>

          {/* Grid (dimmed + non-interactive while transitions are OFF) */}
          <div className={`px-4 py-3 transition-opacity ${transitionsOff ? "opacity-40 pointer-events-none" : ""}`}>
            {filtered.length === 0 ? (
              <div className="text-[var(--color-muted-foreground)] text-center py-8 text-[11px]">
                {tab === "favs"
                  ? "No favourite transitions yet — tap the star on any card."
                  : "No transitions match your search."}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2.5 max-h-[300px] overflow-y-auto pr-0.5">
                {filtered.map((t) => (
                  <TransitionCard
                    key={t}
                    name={t}
                    selected={t === transitionName}
                    fav={favs.has(t)}
                    onToggleFav={() => toggleFav(t)}
                    onSelect={() => { onSelect(t); setOpen(false); }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Duration (or OFF banner) */}
          <div className={`px-4 pt-2.5 pb-4 border-t border-[var(--color-border)] ${transitionsOff ? "opacity-40 pointer-events-none" : ""}`}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="eyebrow">{transitionsOff ? "Transitions off — instant cut" : "Duration"}</span>
              <span className="text-[12px] font-mono font-bold tabular-nums text-[var(--color-brand)]">{transitionDuration.toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min={0}
              max={5}
              step={0.1}
              value={transitionDuration}
              onChange={(e) => onDurationChange(parseFloat(e.target.value))}
              className="w-full"
              style={{ accentColor: "var(--color-brand)" }}
            />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function TransitionCard({
  name, selected, fav, onToggleFav, onSelect,
}: {
  name: string;
  selected: boolean;
  fav: boolean;
  onToggleFav: () => void;
  onSelect: () => void;
}) {
  const kind = previewKind(name);
  return (
    <button
      onClick={onSelect}
      title={`Use “${name}” transition`}
      className={`group relative rounded-xl border p-1.5 text-left transition-[transform,box-shadow,border-color] duration-200 [transition-timing-function:var(--ease-spring)] active:scale-[0.97] ${
        selected
          ? "border-[var(--color-brand)] bg-[var(--color-brand)]/[0.07] shadow-[0_0_0_1px_var(--color-brand),var(--shadow-ember)]"
          : "border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--edge-top),var(--shadow-sm)] motion-safe:hover:-translate-y-px hover:border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))] hover:shadow-[var(--edge-top),var(--shadow-md)]"
      }`}
    >
      {/* Animated mini-preview */}
      <div className={`pf-tp pf-tp--${kind} relative w-full h-[62px] rounded-lg overflow-hidden`}>
        <span className="pf-tp-out" />
        <span className="pf-tp-in" />
      </div>
      <div className="flex items-center justify-between mt-1.5 pl-1">
        <span className={`text-[11px] font-semibold truncate ${selected ? "text-[var(--color-foreground)]" : "text-[var(--color-muted-foreground)] group-hover:text-[var(--color-foreground)]"}`}>{name}</span>
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); onToggleFav(); }}
          className="shrink-0 p-1 rounded-md hover:bg-[var(--color-brand)]/10"
          title={fav ? "Remove favourite" : "Add favourite"}
        >
          <Star className={`w-3.5 h-3.5 transition-colors ${fav ? "fill-[var(--color-brand)] text-[var(--color-brand)]" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"}`} />
        </span>
      </div>
    </button>
  );
}

// Two-layer looping previews. `.pf-tp-out` = outgoing slide, `.pf-tp-in` =
// incoming slide. Each `.pf-tp--<kind>` drives the incoming layer's reveal so
// the card visually demonstrates the effect on a ~2.4s loop.
const PREVIEW_CSS = `
.pf-tp { background: #0a0a0c; }
.pf-tp-out, .pf-tp-in { position: absolute; inset: 0; display: block; }
.pf-tp-out { background: linear-gradient(135deg, #26262b, #17171b); }
.pf-tp-in  { background: linear-gradient(135deg, var(--color-brand, #e8501a), #c23e0f); }
.pf-tp-out::after, .pf-tp-in::after {
  content: ""; position: absolute; left: 14%; right: 14%; top: 42%; height: 3px; border-radius: 2px;
  background: rgba(255,255,255,0.55); box-shadow: 0 8px 0 -1px rgba(255,255,255,0.32), 0 -8px 0 -1px rgba(255,255,255,0.32);
}
@media (prefers-reduced-motion: reduce) { .pf-tp-in { animation: none !important; opacity: 1 !important; } .pf-tp-out { animation: none !important; } }

.pf-tp--fade    .pf-tp-in { animation: pfTpFade 2.4s ease-in-out infinite; }
.pf-tp--cut     .pf-tp-in { animation: pfTpCut 2.4s steps(1,end) infinite; }
.pf-tp--dissolve .pf-tp-in { animation: pfTpDissolve 2.4s ease-in-out infinite; }
.pf-tp--burn    .pf-tp-in { animation: pfTpBurn 2.4s ease-in-out infinite; }
.pf-tp--slide-lr .pf-tp-in { animation: pfTpSlideLR 2.4s cubic-bezier(.4,0,.2,1) infinite; }
.pf-tp--slide-rl .pf-tp-in { animation: pfTpSlideRL 2.4s cubic-bezier(.4,0,.2,1) infinite; }
.pf-tp--wipe    .pf-tp-in { animation: pfTpWipe 2.4s cubic-bezier(.4,0,.2,1) infinite; }
.pf-tp--iris    .pf-tp-in { animation: pfTpIris 2.4s ease-in-out infinite; }
.pf-tp--push    .pf-tp-in { animation: pfTpSlideRL 2.4s cubic-bezier(.4,0,.2,1) infinite; }
.pf-tp--push    .pf-tp-out { animation: pfTpPushOut 2.4s cubic-bezier(.4,0,.2,1) infinite; }

@keyframes pfTpFade { 0%,10%{opacity:0} 45%,80%{opacity:1} 100%{opacity:0} }
@keyframes pfTpCut { 0%,49%{opacity:0} 50%,90%{opacity:1} 91%,100%{opacity:0} }
@keyframes pfTpDissolve { 0%,10%{opacity:0;filter:blur(6px)} 45%,80%{opacity:1;filter:blur(0)} 100%{opacity:0;filter:blur(6px)} }
@keyframes pfTpBurn { 0%,10%{opacity:0;filter:saturate(3) contrast(1.6)} 45%,80%{opacity:1;filter:saturate(1) contrast(1)} 100%{opacity:0;filter:saturate(3) contrast(1.6)} }
@keyframes pfTpSlideLR { 0%,10%{transform:translateX(-101%)} 45%,80%{transform:translateX(0)} 100%{transform:translateX(-101%)} }
@keyframes pfTpSlideRL { 0%,10%{transform:translateX(101%)} 45%,80%{transform:translateX(0)} 100%{transform:translateX(101%)} }
@keyframes pfTpPushOut { 0%,10%{transform:translateX(0)} 45%,80%{transform:translateX(-101%)} 100%{transform:translateX(0)} }
@keyframes pfTpWipe { 0%,10%{clip-path:inset(0 100% 0 0)} 45%,80%{clip-path:inset(0 0 0 0)} 100%{clip-path:inset(0 100% 0 0)} }
@keyframes pfTpIris { 0%,10%{clip-path:circle(0% at 50% 50%)} 45%,80%{clip-path:circle(75% at 50% 50%)} 100%{clip-path:circle(0% at 50% 50%)} }
`;
