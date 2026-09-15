"use client";
import { useEffect, useMemo, useState } from "react";
import { Star, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { TRANSITIONS, TransitionPreviewBox, TransitionPreviewStyle } from "../BottomBar/TransitionChooser";
import { TRANSITION_KEY, TRANSITION_UPDATED_EVENT, TRANSITION_PREVIEW_EVENT } from "../BottomBar";

const FAV_KEY = "presentflow.pro.transitions.favorites.v1";

/**
 * F1 (2026-09-10): the full-screen Transitions picker in the CENTER panel, opened
 * from the left-rail "Transitions" section (was "Media"). It is the big sibling of
 * the (now-removed, 2026-09-15) bottom-bar TransitionChooser and shares the SAME persisted state
 * (TRANSITION_KEY): selecting here writes the key and fires
 * `presentflow:transition-updated`, which the BottomBar listens for and applies to
 * the live output (so the two controls never disagree, and the projector updates).
 */
type Persisted = { name: string; durationMs: number; off: boolean };

function readState(): Persisted {
  if (typeof window === "undefined") return { name: "Amoeba", durationMs: 600, off: false };
  try {
    const raw = window.localStorage.getItem(TRANSITION_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        name: typeof p.name === "string" ? p.name : "Amoeba",
        durationMs: typeof p.durationMs === "number" ? p.durationMs : (typeof p.duration === "number" ? p.duration * 1000 : 600),
        off: typeof p.off === "boolean" ? p.off : false,
      };
    }
  } catch { /* noop */ }
  return { name: "Amoeba", durationMs: 600, off: false };
}

export function TransitionsPanel() {
  const [state, setState] = useState<Persisted>(() => readState());
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"all" | "favorites">("all");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FAV_KEY);
      if (raw) setFavs(new Set(JSON.parse(raw) as string[]));
    } catch { /* noop */ }
  }, []);

  // Keep in sync if the selection changes elsewhere (e.g. BottomBar restoring saved state) while this is open.
  useEffect(() => {
    const onUpdate = () => setState(readState());
    window.addEventListener(TRANSITION_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(TRANSITION_UPDATED_EVENT, onUpdate);
  }, []);

  // Write the shared key + notify the BottomBar (which applies it to /live).
  const publish = (next: Persisted) => {
    setState(next);
    try { window.localStorage.setItem(TRANSITION_KEY, JSON.stringify(next)); } catch { /* noop */ }
    try { window.dispatchEvent(new CustomEvent(TRANSITION_UPDATED_EVENT, { detail: next })); } catch { /* noop */ }
  };

  // Demo the picked transition in the right-sidebar live monitor so the operator
  // sees how it will look on the projector.
  const previewOnMonitor = (name: string, durationMs: number) => {
    try { window.dispatchEvent(new CustomEvent(TRANSITION_PREVIEW_EVENT, { detail: { name, durationMs } })); } catch { /* noop */ }
  };

  const toggleFav = (name: string) => {
    setFavs((cur) => {
      const n = new Set(cur);
      if (n.has(name)) n.delete(name); else n.add(name);
      try { window.localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(n))); } catch { /* noop */ }
      return n;
    });
  };

  const list = useMemo(() => (tab === "favorites" ? TRANSITIONS.filter((t) => favs.has(t)) : TRANSITIONS), [tab, favs]);

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Same animated-preview keyframes as TransitionChooser.tsx. */}
      <TransitionPreviewStyle />
      <div className="max-w-[900px] mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-[18px] font-semibold tracking-[-0.01em]">Transitions</h2>
          <span className="text-[8.5px] font-mono font-bold uppercase tracking-[0.1em] px-1.5 py-[2px] rounded-full bg-[#4fd18b]/16 text-[#5fd89a]">Free</span>
          <div className="flex-1" />
          {/* Master OFF — hard cut on every send regardless of the selected effect. */}
          <button
            onClick={() => publish({ ...state, off: !state.off })}
            className={cn(
              "h-8 px-3 rounded-lg border text-[11.5px] font-bold uppercase tracking-wide transition-colors",
              state.off
                ? "border-[var(--color-brand)] text-[var(--color-brand)] bg-[var(--color-brand)]/10"
                : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
            )}
            title="When on, every slide hard-cuts with no transition"
          >
            {state.off ? "Transitions OFF" : "Transitions ON"}
          </button>
        </div>

        {/* All / Favorites filter */}
        <div className="flex items-center gap-1 mb-4">
          {(["all", "favorites"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "h-7 px-3 rounded-lg text-[11.5px] font-semibold capitalize transition-colors",
                tab === t ? "bg-[var(--color-elevated)] text-[var(--color-foreground)] shadow-[var(--edge-top),var(--shadow-sm)]" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Transition grid (dimmed + inert while OFF) */}
        <div className={cn("grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 transition-opacity", state.off && "opacity-40 pointer-events-none")}>
          {list.length === 0 && (
            <div className="col-span-full text-[12px] text-[var(--color-muted-foreground)] py-8 text-center">No favourites yet — tap the star on a transition.</div>
          )}
          {list.map((name) => {
            const active = !state.off && state.name === name;
            return (
              <button
                key={name}
                onClick={() => { publish({ ...state, name, off: false }); previewOnMonitor(name, state.durationMs); }}
                title={`Use “${name}” transition`}
                className={cn(
                  "group relative rounded-xl border p-1.5 text-left transition-[transform,box-shadow,border-color] duration-200 [transition-timing-function:var(--ease-spring)] active:scale-[0.97]",
                  active
                    ? "border-[var(--color-brand)] bg-[var(--color-brand)]/[0.07] shadow-[0_0_0_1px_var(--color-brand),var(--shadow-ember)]"
                    : "border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--edge-top),var(--shadow-sm)] motion-safe:hover:-translate-y-px hover:border-[color-mix(in_oklab,var(--color-brand)_45%,var(--color-border))] hover:shadow-[var(--edge-top),var(--shadow-md)]",
                )}
              >
                {/* The animated orange preview from TransitionChooser.tsx. */}
                <TransitionPreviewBox name={name} className="h-[84px]" />
                {active && <Check className="absolute top-2.5 left-2.5 w-4 h-4 text-[var(--color-brand)]" />}
                <div className="flex items-center justify-between mt-1.5 pl-1">
                  <span className={cn("text-[12.5px] font-semibold truncate", active ? "text-[var(--color-foreground)]" : "text-[var(--color-muted-foreground)] group-hover:text-[var(--color-foreground)]")}>{name}</span>
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => { e.stopPropagation(); toggleFav(name); }}
                    className="shrink-0 p-1 rounded-md hover:bg-[var(--color-brand)]/10"
                    title={favs.has(name) ? "Remove from favourites" : "Add to favourites"}
                  >
                    <Star className={cn("w-3.5 h-3.5 transition-colors", favs.has(name) ? "fill-[var(--color-brand)] text-[var(--color-brand)]" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]")} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Duration (dimmed + inert while OFF) */}
        <div className={cn("mt-6 flex items-center gap-3 max-w-[420px] transition-opacity", state.off && "opacity-40 pointer-events-none")}>
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-muted-foreground)] w-20">Duration</span>
          <input
            // Keep the persisted-duration grid (0–5s on a 100ms step)
            // so a value picked here is always representable there — otherwise the
            // two controls show different rounded durations (e.g. 0.65s vs 0.7s).
            type="range" min={0} max={5000} step={100} value={state.durationMs}
            onChange={(e) => publish({ ...state, durationMs: Number(e.target.value) })}
            className="flex-1 accent-[var(--color-brand)]"
          />
          <span className="text-[12px] font-bold tabular-nums w-14 text-right">{(state.durationMs / 1000).toFixed(1)}s</span>
        </div>
      </div>
    </div>
  );
}
