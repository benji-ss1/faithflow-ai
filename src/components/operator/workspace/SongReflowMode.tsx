"use client";
import { useMemo, useState } from "react";
import { Music, ChevronRight, Send, Eye, Type as TypeIcon, Palette, Copyright } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExpandedItem } from "@/lib/server/services";
import type { SlidePayload } from "@/lib/broadcast";

/**
 * Song Reflow workspace mode.
 *
 * Reads the current song item's slides and infers section labels from
 * common lyric conventions ([V1], [C1], [B], etc). Provides:
 *  - Section list with V/C/B/T/I/O buckets
 *  - Font size control (per-slide runtime only for now)
 *  - Theme selector placeholder
 *  - CCLI / copyright metadata display (song artist)
 *  - Send section to Preview or Live
 *  - Quick jump to verse/chorus/bridge
 *
 * DOES NOT persist edits back to the DB — the full editor lives at
 * /library/songs/[id]. This mode is a fast operator-time workflow for
 * during-service reordering + section sending.
 */

type Section = { kind: "verse" | "chorus" | "bridge" | "tag" | "intro" | "outro" | "other"; label: string; slideIdx: number };

const SECTION_TAGS: [RegExp, Section["kind"]][] = [
  [/^\s*\[V\d*\]|^\s*VERSE\s*\d*/i, "verse"],
  [/^\s*\[C\d*\]|^\s*CHORUS/i, "chorus"],
  [/^\s*\[B\d*\]|^\s*BRIDGE/i, "bridge"],
  [/^\s*\[T\d*\]|^\s*TAG/i, "tag"],
  [/^\s*\[I\d*\]|^\s*INTRO/i, "intro"],
  [/^\s*\[O\d*\]|^\s*OUTRO/i, "outro"],
];

function inferSections(slides: SlidePayload[]): Section[] {
  const out: Section[] = [];
  let verseCount = 0, chorusCount = 0, bridgeCount = 0;
  slides.forEach((slide, idx) => {
    if (slide.kind !== "text") { out.push({ kind: "other", label: `Slide ${idx + 1}`, slideIdx: idx }); return; }
    const firstLine = slide.text.split("\n")[0];
    let matched: Section["kind"] | null = null;
    for (const [re, k] of SECTION_TAGS) if (re.test(firstLine)) { matched = k; break; }
    if (matched === "verse") { verseCount++; out.push({ kind: "verse", label: `Verse ${verseCount}`, slideIdx: idx }); }
    else if (matched === "chorus") { chorusCount++; out.push({ kind: "chorus", label: chorusCount === 1 ? "Chorus" : `Chorus ${chorusCount}`, slideIdx: idx }); }
    else if (matched === "bridge") { bridgeCount++; out.push({ kind: "bridge", label: bridgeCount === 1 ? "Bridge" : `Bridge ${bridgeCount}`, slideIdx: idx }); }
    else if (matched) out.push({ kind: matched, label: matched[0].toUpperCase() + matched.slice(1), slideIdx: idx });
    // Not tagged — heuristic: alternate assumed verse/chorus by position, but that's noisy;
    // just call it "Slide N".
    else out.push({ kind: "verse", label: `Slide ${idx + 1}`, slideIdx: idx });
  });
  return out;
}

const KIND_COLOR: Record<Section["kind"], string> = {
  verse: "var(--color-brand)",
  chorus: "var(--color-warning)",
  bridge: "var(--color-success)",
  tag: "var(--color-muted-foreground)",
  intro: "var(--color-muted-foreground)",
  outro: "var(--color-muted-foreground)",
  other: "var(--color-muted-foreground)",
};

const THEMES = [
  { key: "default", label: "Default", bg: "#0b0b0b" },
  { key: "midnight", label: "Midnight", bg: "#0a1120" },
  { key: "warm",     label: "Warm",     bg: "#1a0d05" },
  { key: "forest",   label: "Forest",   bg: "#0a1d0f" },
];

export function SongReflowMode({
  item, activeSlideIdx, onJumpSlide, onSendPreview, onSendLive,
}: {
  item: ExpandedItem | undefined;
  activeSlideIdx: number;
  onJumpSlide: (s: number) => void;
  onSendPreview: (slide: SlidePayload) => void;
  onSendLive: (slide: SlidePayload) => void;
}) {
  const sections = useMemo(() => (item ? inferSections(item.slides) : []), [item]);
  const [themeKey, setThemeKey] = useState("default");
  const [fontScale, setFontScale] = useState(1);

  if (!item || item.type !== "song") {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-3">
          <Music className="w-8 h-8 mx-auto text-[color:var(--color-muted-foreground)]" />
          <div className="text-sm font-semibold">Song Reflow</div>
          <p className="text-xs text-[color:var(--color-muted-foreground)] leading-relaxed">
            Pick a song item from the Service Order rail to reflow its verses, choruses, and bridges.
          </p>
        </div>
      </div>
    );
  }

  const theme = THEMES.find((t) => t.key === themeKey) || THEMES[0];
  const applyTheme = (s: SlidePayload): SlidePayload => {
    if (s.kind !== "text") return s;
    return { ...s, bgColor: theme.bg };
  };

  const currentSlide = item.slides[activeSlideIdx];

  return (
    <div className="h-full flex min-h-0">
      {/* Section list */}
      <div className="w-64 shrink-0 border-r overflow-y-auto" style={{ borderColor: "var(--color-border)" }}>
        <header className="sticky top-0 z-10 backdrop-blur-sm px-3 py-2 border-b flex items-center gap-2"
          style={{ borderColor: "var(--color-border)", background: "color-mix(in oklab, var(--color-panel) 92%, transparent)" }}>
          <Music className="w-4 h-4 text-[color:var(--color-brand)]" />
          <div className="text-xs font-semibold truncate flex-1">{item.title}</div>
          <span className="text-[10px] font-mono text-[color:var(--color-muted-foreground)]">{sections.length}</span>
        </header>
        <ul className="p-2 space-y-1">
          {sections.map((s, i) => (
            <li key={i}>
              <button
                onClick={() => onJumpSlide(s.slideIdx)}
                className={cn(
                  "w-full text-left rounded-md px-2 py-2 flex items-center gap-2 border transition-colors",
                  s.slideIdx === activeSlideIdx
                    ? "border-[color:var(--color-brand)] bg-[color:var(--color-brand)]/10"
                    : "border-transparent hover:bg-[color:var(--color-raised-shell)]",
                )}
              >
                <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: KIND_COLOR[s.kind] }}>
                  {s.kind}
                </span>
                <span className="text-xs font-medium flex-1 truncate">{s.label}</span>
                <ChevronRight className="w-3 h-3 text-[color:var(--color-muted-foreground)]" />
              </button>
            </li>
          ))}
        </ul>
        {/* Copyright / CCLI display */}
        {item.title && (
          <div className="p-3 border-t text-[10px] text-[color:var(--color-muted-foreground)] leading-relaxed flex items-start gap-2" style={{ borderColor: "var(--color-border)" }}>
            <Copyright className="w-3 h-3 shrink-0 mt-0.5" />
            <div>
              Metadata comes from the song row. Edit CCLI + copyright at <code className="font-mono opacity-70">/library/songs/[id]</code>.
            </div>
          </div>
        )}
      </div>

      {/* Editing area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Controls */}
        <div className="h-12 shrink-0 border-b flex items-center gap-2 px-3" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex items-center gap-1.5 text-xs">
            <TypeIcon className="w-3.5 h-3.5 text-[color:var(--color-muted-foreground)]" />
            <span className="text-[color:var(--color-muted-foreground)]">Font</span>
            <input type="range" min="0.7" max="1.5" step="0.1" value={fontScale}
              onChange={(e) => setFontScale(Number(e.target.value))} className="w-24" />
            <span className="font-mono text-[10px] text-[color:var(--color-muted-foreground)] w-8">{Math.round(fontScale * 100)}%</span>
          </div>
          <div className="w-px h-6 mx-1" style={{ background: "var(--color-border)" }} />
          <div className="flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5 text-[color:var(--color-muted-foreground)]" />
            <div className="flex gap-1">
              {THEMES.map((t) => (
                <button key={t.key} onClick={() => setThemeKey(t.key)}
                  className={cn(
                    "w-6 h-6 rounded-sm border-2 transition-colors",
                    themeKey === t.key ? "border-[color:var(--color-brand)]" : "border-[color:var(--color-border)]",
                  )}
                  style={{ background: t.bg }}
                  title={t.label}
                />
              ))}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              disabled={!currentSlide}
              onClick={() => currentSlide && onSendPreview(applyTheme(currentSlide))}
              className="h-8 px-3 rounded-md text-xs font-semibold border border-[color:var(--color-brand)] text-[color:var(--color-brand)] bg-[color:var(--color-brand)]/10 hover:bg-[color:var(--color-brand)]/20 inline-flex items-center gap-1.5 disabled:opacity-40">
              <Eye className="w-3 h-3" /> Send to Preview
            </button>
            <button
              disabled={!currentSlide}
              onClick={() => currentSlide && onSendLive(applyTheme(currentSlide))}
              className="h-8 px-3 rounded-md text-xs font-bold bg-[color:var(--color-destructive)] text-white hover:opacity-90 inline-flex items-center gap-1.5 disabled:opacity-40">
              <Send className="w-3 h-3" /> Send to Live
            </button>
          </div>
        </div>

        {/* Editable lyrics view */}
        <div className="flex-1 overflow-y-auto p-6">
          {currentSlide?.kind === "text" ? (
            <div className="max-w-2xl mx-auto rounded-md overflow-hidden shadow-lg" style={{ background: theme.bg }}>
              <div className="p-10 min-h-[400px] flex items-center justify-center">
                <div className="text-white font-display font-semibold text-center whitespace-pre-wrap"
                  style={{ fontSize: `${28 * fontScale}px`, lineHeight: 1.3, letterSpacing: "-0.02em" }}>
                  {currentSlide.text}
                </div>
              </div>
              <div className="border-t border-white/10 px-4 py-2 text-[10px] font-mono text-white/40 flex items-center gap-2">
                <span>Slide {activeSlideIdx + 1} / {item.slides.length}</span>
                <span className="ml-auto">Theme: {theme.label}</span>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-[color:var(--color-muted-foreground)]">
              Non-text slide selected.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
