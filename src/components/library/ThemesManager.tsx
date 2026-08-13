"use client";
import { useState, useEffect, useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown, Copy, Download, GripVertical, Image as ImageIcon, Palette, Plus, Star, Trash2, X } from "lucide-react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { createTheme, updateTheme, duplicateTheme, deleteTheme, setDefaultTheme, reorderThemes, extractLogoPalette, exportTheme, importTheme } from "@/lib/actions";
import { buildColorwayFromPalette } from "@/lib/colorway";
import { ThemeImportDialog } from "@/components/library/ThemeImportDialog";

// Kept minimal + additive — see `type ThemeConfig` in src/lib/actions.ts for
// the full sanitised shape. Everything below is optional; the preview + the
// operator projector fall back to sensible defaults per field.
type ThemeConfig = Record<string, unknown>;

type ThemeRow = { id: string; name: string; config: ThemeConfig; isDefault?: boolean };

type PreviewMode = "lyrics" | "scripture" | "sermon" | "blank";

const FONT_CHOICES = ["Inter", "Sora", "Plus Jakarta Sans", "Georgia", "Helvetica", "Arial", "Times New Roman"];
const LOGO_GRID: { key: string; row: number; col: number }[] = [
  { key: "top-left", row: 0, col: 0 }, { key: "top-center", row: 0, col: 1 }, { key: "top-right", row: 0, col: 2 },
  { key: "middle-left", row: 1, col: 0 }, { key: "middle-center", row: 1, col: 1 }, { key: "middle-right", row: 1, col: 2 },
  { key: "bottom-left", row: 2, col: 0 }, { key: "bottom-center", row: 2, col: 1 }, { key: "bottom-right", row: 2, col: 2 },
];

// Sensible seed for brand-new themes so the preview isn't a blank void.
const DEFAULT_CONFIG: ThemeConfig = {
  fontFamily: "Inter",
  fontSizePx: 72,
  fontSizeScripturePx: 56,
  fontWeight: 600,
  textColor: "#F1EFE8",
  textShadow: false,
  align: "center",
  bgType: "solid",
  bgColor: "#0B0B0B",
  bgColor2: "#1A0A14",
  bgOpacity: 1,
  bgImageUrl: "",
  bgVideoUrl: "",
  logoPosition: "none",
  logoSizePx: 48,
  logoUrl: "", // church uploads their own logo; falls back to church branding if empty
  churchNameVisible: false,
  churchNamePosition: "bottom",
  lowerThirdEnabled: false,
  lowerThirdStyle: "bar",
  lowerThirdColor: "#000000",
  scriptureShowReference: true,
  scriptureReferencePosition: "above",
  scriptureTranslationVisible: true,
  transitionType: "fade",
  transitionDurationMs: 300,
};

function get<T>(cfg: ThemeConfig, key: string, fallback: T): T {
  const v = cfg[key];
  return (v === undefined || v === null ? fallback : v) as T;
}

export function ThemesManager({ themes: initial, churchLogoUrl, onThemeActivated }: {
  themes: ThemeRow[];
  churchLogoUrl?: string | null;
  // Optional: called with a theme's config when it becomes the active look
  // (set-as-default, or saving edits to the current default). The desktop
  // operator uses this to push the theme to the LIVE projector immediately.
  onThemeActivated?: (config: ThemeConfig) => void;
}) {
  const [themes, setThemes] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<ThemeRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  function refresh(next: ThemeRow[]) {
    setThemes(next.slice().sort((a, b) => a.name.localeCompare(b.name)));
  }

  function onNewTheme() {
    // Open the editor immediately with a placeholder — name is set inside the editor.
    setEditing({ id: "", name: "Untitled Theme", config: DEFAULT_CONFIG });
  }

  function onDuplicate(id: string) {
    startTransition(async () => {
      const res = await duplicateTheme(id);
      if (!res.ok) { toast.error(res.error || "Could not duplicate"); return; }
      if (!res.data) return;
      const source = themes.find((t) => t.id === id);
      if (source) {
        refresh([...themes, { id: res.data.id, name: `${source.name} copy`, config: source.config }]);
        toast.success("Duplicated");
      }
    });
  }

  // Export a theme as a portable .json file the church can back up or share
  // with another PresentFlow church. The shape ({ name, config }) is exactly
  // what importTheme (via ThemeImportDialog) round-trips back in.
  function onExport(id: string, name: string) {
    startTransition(async () => {
      const res = await exportTheme(id);
      if (!res.ok || !res.data) { toast.error((!res.ok && res.error) || "Could not export"); return; }
      try {
        const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
        const href = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = href;
        a.download = `${name.replace(/[^\w.-]+/g, "-").toLowerCase() || "theme"}.pftheme.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(href);
        toast.success("Theme exported");
      } catch {
        toast.error("Could not save the file");
      }
    });
  }

  function onDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    startTransition(async () => {
      const res = await deleteTheme(id);
      if (!res.ok) { toast.error(res.error || "Could not delete"); return; }
      refresh(themes.filter((t) => t.id !== id));
      toast.success("Deleted");
    });
  }

  // dnd-kit — only fire the reorder server action if the drag actually
  // resulted in a change. Optimistic local reorder + revert on server
  // failure keeps the list stable.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = themes.findIndex((t) => t.id === active.id);
    const newIndex = themes.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(themes, oldIndex, newIndex);
    setThemes(next);
    startTransition(async () => {
      const res = await reorderThemes(next.map((t) => t.id));
      if (!res.ok) {
        toast.error(res.error || "Could not save order");
        setThemes(themes);
      }
    });
  }

  function onSetDefault(id: string) {
    startTransition(async () => {
      const res = await setDefaultTheme(id);
      if (!res.ok) { toast.error(res.error || "Could not set default"); return; }
      // Mirror the server transaction locally: unset any current default,
      // then set the target. Avoids a full refetch.
      setThemes((prev) => prev.map((t) => ({ ...t, isDefault: t.id === id })));
      // Drive the live output immediately (operator only — no-op on web).
      onThemeActivated?.(themes.find((t) => t.id === id)?.config ?? {});
      toast.success("Set as default");
    });
  }

  function onSaveEdit() {
    if (!editing) return;
    const target = editing;
    const name = target.name.trim() || "Untitled Theme";
    startTransition(async () => {
      if (!target.id) {
        // Brand-new theme — create it on the server.
        const res = await createTheme(name, target.config);
        if (!res.ok) { toast.error(res.error || "Could not create theme"); return; }
        if (!res.data) { toast.error("Server returned no id"); return; }
        refresh([...themes, { id: res.data.id, name, config: target.config }]);
        setEditing(null);
        toast.success(`Created "${name}"`);
      } else {
        const res = await updateTheme(target.id, { name, config: target.config });
        if (!res.ok) { toast.error(res.error || "Could not save"); return; }
        refresh(themes.map((t) => (t.id === target.id ? { ...target, name } : t)));
        // If we just edited the active (default) theme, refresh the live look.
        if (themes.find((t) => t.id === target.id)?.isDefault) onThemeActivated?.(target.config);
        setEditing(null);
        toast.success("Saved");
      }
    });
  }

  // Import a .pftheme.json produced by the per-card Export button (round-trip
  // via the importTheme server action, which re-sanitises the config).
  function onImportFile(file: File) {
    startTransition(async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        toast.error("That file isn't valid theme JSON");
        return;
      }
      const res = await importTheme(parsed);
      if (!res.ok || !res.data) { toast.error((!res.ok && res.error) || "Could not import theme"); return; }
      const obj = parsed as { name?: unknown; config?: unknown };
      const name = typeof obj?.name === "string" && obj.name.trim() ? obj.name.trim() : "Imported theme";
      const config = (obj?.config && typeof obj.config === "object" ? obj.config : {}) as ThemeConfig;
      refresh([...themes, { id: res.data.id, name, config }]);
      toast.success(
        res.data.rejectedFields.length
          ? `Imported "${name}" (${res.data.rejectedFields.length} unsupported field${res.data.rejectedFields.length === 1 ? "" : "s"} skipped)`
          : `Imported "${name}"`,
      );
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {themes.length} theme{themes.length === 1 ? "" : "s"}
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium text-foreground hover:bg-accent">
            <Download className="h-4 w-4 rotate-180" /> Import file
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImportFile(f);
                e.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium text-foreground hover:bg-accent"
          >
            Import from ProPresenter
          </button>
          <button
            type="button"
            onClick={onNewTheme}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-primary-foreground)]"
          >
            <Plus className="h-4 w-4" /> New theme
          </button>
        </div>
      </div>
      <ThemeImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

      {themes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-white/[0.02] p-12 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
            <Palette className="h-5 w-5" />
          </div>
          <div className="text-base font-semibold text-foreground">No themes yet</div>
          <p className="max-w-md text-sm text-muted-foreground">
            A theme is a saved bundle of colours, fonts, transitions, layout, and lower-third styles you can apply to any song or scripture with one click.
          </p>
          <button
            type="button"
            onClick={onNewTheme}
            className="mt-2 inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-primary-foreground)]"
          >
            <Plus className="h-4 w-4" /> Create your first theme
          </button>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={themes.map((t) => t.id)} strategy={rectSortingStrategy}>
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {themes.map((t) => (
                <SortableThemeCard
                  key={t.id}
                  theme={t}
                  pending={pending}
                  churchLogoUrl={churchLogoUrl}
                  onEdit={() => setEditing(t)}
                  onSetDefault={() => onSetDefault(t.id)}
                  onDuplicate={() => onDuplicate(t.id)}
                  onExport={() => onExport(t.id, t.name)}
                  onDelete={() => onDelete(t.id, t.name)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {editing ? (
        <ThemeEditor
          theme={editing}
          pending={pending}
          churchLogoUrl={churchLogoUrl}
          onCancel={() => setEditing(null)}
          onChange={(next) => setEditing(next)}
          onSave={onSaveEdit}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live 16:9 slide preview — the single render used both in the list-card
// thumbnails and inside the editor's right panel. Every visual field on
// ThemeConfig flows through here so the preview genuinely reflects the
// operator projector's output. Mode controls what sample content shows.
// ---------------------------------------------------------------------------
function SlidePreview({ config, mode = "lyrics", churchName = "Grace Community", churchLogoUrl }: {
  config: ThemeConfig;
  mode?: PreviewMode;
  churchName?: string;
  churchLogoUrl?: string | null;
}) {
  const bgType = get(config, "bgType", "solid") as "solid" | "gradient" | "image" | "video";
  const bg1 = get(config, "bgColor", "#0B0B0B") as string;
  const bg2 = get(config, "bgColor2", "#1A0A14") as string;
  const bgImageUrl = get(config, "bgImageUrl", "") as string;
  const bgVideoUrl = get(config, "bgVideoUrl", "") as string;
  const bgOpacity = get(config, "bgOpacity", 1) as number;
  // Match the projector: it uses bgAngle (mapper defaults gradient to 135°).
  const bgAngle = get(config, "bgAngle", 135) as number;
  const bgAnimation = get(config, "bgAnimation", "none") as string;
  // Same GPU-transform presets the projector uses (globals.css). Solid/gradient only.
  const animActive = (bgType === "solid" || bgType === "gradient") && ["drift", "aurora", "pulse"].includes(bgAnimation);
  const ANIM_CSS: Record<string, string> = {
    drift: "pf-bg-drift 26s ease-in-out infinite",
    aurora: "pf-bg-aurora 48s ease-in-out infinite",
    pulse: "pf-bg-pulse 10s ease-in-out infinite",
  };

  const fontFamily = get(config, "fontFamily", "Inter") as string;
  const fontSize = get(config, mode === "scripture" ? "fontSizeScripturePx" : "fontSizePx", mode === "scripture" ? 56 : 72) as number;
  const fontWeight = get(config, "fontWeight", 600) as number;
  const textColor = get(config, "textColor", "#F1EFE8") as string;
  const textShadow = get(config, "textShadow", false) as boolean;
  const align = get(config, "align", "center") as "left" | "center" | "right";

  const logoPosition = get(config, "logoPosition", "none") as string;
  const logoSize = get(config, "logoSizePx", 48) as number;
  // Use theme-specific logo first, then church logo, then PF placeholder
  const logoUrl = (get(config, "logoUrl", "") as string) || churchLogoUrl || "/brand/pf-logo-mark.png";
  const churchNameVisible = get(config, "churchNameVisible", false) as boolean;
  const churchNamePos = get(config, "churchNamePosition", "bottom") as "top" | "bottom";

  const ltEnabled = get(config, "lowerThirdEnabled", false) as boolean;
  const ltStyle = get(config, "lowerThirdStyle", "bar") as "bar" | "gradient-fade" | "minimal";
  const ltColor = get(config, "lowerThirdColor", "#000000") as string;

  const scriptureShowRef = get(config, "scriptureShowReference", true) as boolean;
  const scriptureRefPos = get(config, "scriptureReferencePosition", "above") as "above" | "below" | "inline";
  const scriptureTranslation = get(config, "scriptureTranslationVisible", true) as boolean;

  const previewScale = mode === "lyrics" || mode === "scripture" ? 0.32 : 0.32; // 16:9 card scales down; slide font sizes are set for 1080p

  const backgroundStyle: React.CSSProperties =
    bgType === "gradient"
      ? { background: `linear-gradient(${bgAngle}deg, ${bg1}, ${bg2})` }
      : bgType === "image" && bgImageUrl
        ? { background: `#000 url(${bgImageUrl}) center/cover no-repeat` }
        : bgType === "video"
          ? { background: "#000" } // video element renders on top; keep base black in case url fails
          : { background: bg1 };

  const sample =
    mode === "lyrics" ? "Amazing grace, how sweet the sound" :
    mode === "scripture" ? "For God so loved the world" :
    mode === "sermon" ? "Grace is unearned favour" :
    "";

  // Logo grid → flex justify/align mapping
  const [logoRow, logoCol] = (() => {
    const g = LOGO_GRID.find((x) => x.key === logoPosition);
    if (!g) return [-1, -1];
    return [g.row, g.col];
  })();

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{ aspectRatio: "16 / 9", ...backgroundStyle }}
    >
      {/* Video background — muted autoplay loop. Rendered first so overlays
          (logo, text block, lower-third) sit on top. Silent by design; a
          projector output plays without audio. */}
      {bgType === "video" && bgVideoUrl ? (
        <video
          key={bgVideoUrl}
          src={bgVideoUrl}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}

      {/* Animated background (Themes 3) — GPU-transform gradient layer, matching
          the projector's AnimatedThemeBg. Sits over the static base, under text. */}
      {animActive ? (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div
            className="pf-anim-bg absolute inset-[-20%]"
            style={{
              background: bgType === "gradient" ? `linear-gradient(${bgAngle}deg, ${bg1}, ${bg2})` : bg1,
              animation: ANIM_CSS[bgAnimation],
              transform: bgAnimation === "aurora" ? "scale(1.6)" : bgAnimation === "drift" ? "scale(1.2)" : "scale(1.1)",
              willChange: "transform",
            }}
          />
        </div>
      ) : null}

      {/* Readability dim — matches the projector, which maps the Opacity slider
          (bgOpacity) to a dark overlay over the background (NOT the text). */}
      {bgOpacity < 1 ? (
        <div className="pointer-events-none absolute inset-0" style={{ background: `rgba(0,0,0,${1 - bgOpacity})` }} />
      ) : null}

      {/* Logo placement — 3x3 positional grid */}
      {logoPosition !== "none" && logoRow >= 0 ? (
        <div
          className="pointer-events-none absolute inset-0 flex p-3"
          style={{
            justifyContent: logoCol === 0 ? "flex-start" : logoCol === 2 ? "flex-end" : "center",
            alignItems: logoRow === 0 ? "flex-start" : logoRow === 2 ? "flex-end" : "center",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl} alt="" style={{ height: `${logoSize * previewScale}px`, width: "auto", opacity: 0.9 }} />
        </div>
      ) : null}

      {/* Church name — top or bottom slot */}
      {churchNameVisible ? (
        <div
          className="absolute left-0 right-0 px-4 text-center"
          style={{
            top: churchNamePos === "top" ? 8 : undefined,
            bottom: churchNamePos === "bottom" ? 8 : undefined,
            color: textColor,
            fontFamily,
            fontSize: `${Math.max(8, 14 * previewScale)}px`,
            opacity: 0.7,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          {churchName}
        </div>
      ) : null}

      {/* Main text block */}
      {mode !== "blank" ? (
        <div
          className="absolute inset-0 flex flex-col p-6"
          style={{
            justifyContent: "center",
            textAlign: align,
            alignItems: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
          }}
        >
          {mode === "scripture" && scriptureShowRef && scriptureRefPos === "above" ? (
            <div style={{ color: textColor, opacity: 0.7, fontSize: `${Math.max(8, 20 * previewScale)}px`, fontFamily, marginBottom: 6, letterSpacing: "0.05em" }}>
              John 3:16{scriptureTranslation ? " · KJV" : ""}
            </div>
          ) : null}
          <div
            style={{
              color: textColor,
              fontFamily,
              fontSize: `${Math.max(11, fontSize * previewScale)}px`,
              fontWeight,
              lineHeight: 1.2,
              textShadow: textShadow ? "0 2px 8px rgba(0,0,0,0.55)" : "none",
              maxWidth: "100%",
            }}
          >
            {sample}
            {mode === "scripture" && scriptureRefPos === "inline" ? (
              <span style={{ opacity: 0.6, marginLeft: 8, fontSize: `${Math.max(8, 20 * previewScale)}px` }}>
                · John 3:16
              </span>
            ) : null}
          </div>
          {mode === "scripture" && scriptureShowRef && scriptureRefPos === "below" ? (
            <div style={{ color: textColor, opacity: 0.7, fontSize: `${Math.max(8, 20 * previewScale)}px`, fontFamily, marginTop: 6, letterSpacing: "0.05em" }}>
              John 3:16{scriptureTranslation ? " · KJV" : ""}
            </div>
          ) : null}
        </div>
      ) : (
        // Blank+logo mode still respects logo placement above; add a subtle vignette so
        // the card doesn't look like a bug.
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(circle at center, rgba(0,0,0,0) 30%, rgba(0,0,0,0.25) 100%)" }} />
      )}

      {/* Lower third — rendered last so it overlays main text */}
      {ltEnabled ? (
        <div
          className="absolute bottom-0 left-0 right-0"
          style={{
            height:
              ltStyle === "minimal" ? "16%" :
              ltStyle === "gradient-fade" ? "40%" :
              "22%",
            background:
              ltStyle === "gradient-fade"
                ? `linear-gradient(to top, ${ltColor}, transparent)`
                : ltStyle === "minimal"
                  ? `${ltColor}22`
                  : ltColor,
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full-screen 2-panel editor overlay. Left = collapsible control groups
// (Typography / Background / Layout / Lower third / Scripture / Transitions).
// Right = live preview + mode toggle. Every control update mutates the
// editing theme immediately so the preview reflects the intended output.
// ---------------------------------------------------------------------------
function ThemeEditor({
  theme, pending, churchLogoUrl, onCancel, onChange, onSave,
}: {
  theme: ThemeRow;
  pending: boolean;
  churchLogoUrl?: string | null;
  onCancel: () => void;
  onChange: (next: ThemeRow) => void;
  onSave: () => void;
}) {
  const [mode, setMode] = useState<PreviewMode>("lyrics");
  const [paletteBusy, setPaletteBusy] = useState(false);
  const cfg = theme.config;

  function set(patch: Partial<Record<string, unknown>>) {
    onChange({ ...theme, config: { ...cfg, ...patch } });
  }

  async function autoColorway() {
    const logo = (get(cfg, "logoUrl", "") as string) || churchLogoUrl || "";
    if (!logo) { toast.error("Add a logo image first"); return; }
    setPaletteBusy(true);
    try {
      const res = await extractLogoPalette(logo);
      if (!res.ok || !res.data) { toast.error((!res.ok && res.error) || "Couldn't read the logo"); return; }
      const cw = buildColorwayFromPalette(res.data.colors);
      if (!cw) { toast.error("No usable colours found in the logo"); return; }
      set(cw); // gradient bg from the brand hue + auto-contrast text
      toast.success("Colourway generated from your logo");
    } catch {
      toast.error("Couldn't generate a colourway");
    } finally {
      setPaletteBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[85] grid grid-cols-[minmax(360px,40%)_1fr] bg-black/70 backdrop-blur-sm" onClick={onCancel}>
      {/* Left panel — controls */}
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex h-full flex-col overflow-hidden bg-[var(--color-panel,#141818)] shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {theme.id ? "Edit theme" : "New theme"}
            </div>
            <input
              value={theme.name}
              maxLength={80}
              autoFocus={!theme.id}
              placeholder="Theme name…"
              onChange={(e) => onChange({ ...theme, name: e.target.value })}
              className="mt-0.5 w-full truncate bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground/50"
            />
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
            aria-label="Close editor"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          <Section title="Typography" defaultOpen>
            <Row label="Headline font">
              <select value={get(cfg, "fontFamily", "Inter") as string} onChange={(e) => set({ fontFamily: e.target.value })} className={selectCls}>
                {FONT_CHOICES.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </Row>
            <Row label="Text color">
              <input type="color" value={get(cfg, "textColor", "#F1EFE8") as string} onChange={(e) => set({ textColor: e.target.value })} className={colorCls} />
            </Row>
            <div className="grid grid-cols-2 gap-3">
              <Row label="Lyrics size (px)">
                <input type="number" min={12} max={200} value={get(cfg, "fontSizePx", 72) as number} onChange={(e) => set({ fontSizePx: Number(e.target.value) })} className={inputCls} />
              </Row>
              <Row label="Scripture size (px)">
                <input type="number" min={12} max={200} value={get(cfg, "fontSizeScripturePx", 56) as number} onChange={(e) => set({ fontSizeScripturePx: Number(e.target.value) })} className={inputCls} />
              </Row>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Row label="Weight">
                <select value={String(get(cfg, "fontWeight", 600) as number)} onChange={(e) => set({ fontWeight: Number(e.target.value) })} className={selectCls}>
                  {[300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </Row>
              <Row label="Alignment">
                <div className="flex gap-1">
                  {(["left", "center", "right"] as const).map((a) => (
                    <button key={a} type="button" onClick={() => set({ align: a })}
                      className={cn("h-9 flex-1 rounded-md border text-xs capitalize", get(cfg, "align", "center") === a ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10" : "border-border text-muted-foreground")}>
                      {a}
                    </button>
                  ))}
                </div>
              </Row>
            </div>
            <Row label="Text shadow">
              <Toggle value={get(cfg, "textShadow", false)} onChange={(v) => set({ textShadow: v })} />
            </Row>
          </Section>

          <Section title="Background">
            <Row label="Type">
              <div className="grid grid-cols-4 gap-1">
                {(["solid", "gradient", "image", "video"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => set({ bgType: t })}
                    className={cn("h-9 rounded-md border text-xs capitalize", get<"solid" | "gradient" | "image" | "video">(cfg, "bgType", "solid") === t ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10" : "border-border text-muted-foreground")}>
                    {t}
                  </button>
                ))}
              </div>
            </Row>
            <div className="grid grid-cols-2 gap-3">
              <Row label={get<"solid" | "gradient" | "image" | "video">(cfg, "bgType", "solid") === "gradient" ? "Color 1" : "Background color"}>
                <input type="color" value={get(cfg, "bgColor", "#0B0B0B") as string} onChange={(e) => set({ bgColor: e.target.value })} className={colorCls} />
              </Row>
              {get<"solid" | "gradient" | "image" | "video">(cfg, "bgType", "solid") === "gradient" && (
                <Row label="Color 2">
                  <input type="color" value={get(cfg, "bgColor2", "#1A0A14") as string} onChange={(e) => set({ bgColor2: e.target.value })} className={colorCls} />
                </Row>
              )}
            </div>
            {get<"solid" | "gradient" | "image" | "video">(cfg, "bgType", "solid") === "image" && (
              <BgAssetPicker
                kind="image"
                url={get(cfg, "bgImageUrl", "") as string}
                onUrl={(url) => set({ bgImageUrl: url })}
              />
            )}
            {get<"solid" | "gradient" | "image" | "video">(cfg, "bgType", "solid") === "video" && (
              <BgAssetPicker
                kind="video"
                url={get(cfg, "bgVideoUrl", "") as string}
                onUrl={(url) => set({ bgVideoUrl: url })}
              />
            )}
            <Row label={`Opacity — ${Math.round((get(cfg, "bgOpacity", 1) as number) * 100)}%`}>
              <input type="range" min={0} max={100} value={(get(cfg, "bgOpacity", 1) as number) * 100} onChange={(e) => set({ bgOpacity: Number(e.target.value) / 100 })} className="w-full" />
            </Row>
            {(get<"solid" | "gradient" | "image" | "video">(cfg, "bgType", "solid") === "solid"
              || get<"solid" | "gradient" | "image" | "video">(cfg, "bgType", "solid") === "gradient") && (
              <Row label="Motion" hint="Subtle looping animation behind verses & lyrics. Solid/gradient only.">
                <div className="grid grid-cols-4 gap-1">
                  {(["none", "drift", "aurora", "pulse"] as const).map((m) => (
                    <button key={m} type="button" onClick={() => set({ bgAnimation: m })}
                      className={cn("h-9 rounded-md border text-xs capitalize", get(cfg, "bgAnimation", "none") === m ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10" : "border-border text-muted-foreground")}>
                      {m}
                    </button>
                  ))}
                </div>
              </Row>
            )}
          </Section>

          <Section title="Layout">
            <Row label="Logo placement" hint="Choose a position on the slide, or None to hide.">
              <div className="grid w-32 grid-cols-3 gap-1">
                {LOGO_GRID.map((p) => (
                  <button key={p.key} type="button" onClick={() => set({ logoPosition: p.key })}
                    className={cn("h-8 rounded", get(cfg, "logoPosition", "none") === p.key ? "bg-[var(--color-primary)]" : "border border-border bg-white/[0.02] hover:bg-white/[0.06]")}
                    aria-label={p.key} title={p.key}
                  />
                ))}
              </div>
              <button type="button" onClick={() => set({ logoPosition: "none" })}
                className={cn("mt-2 h-8 rounded-md border px-3 text-xs", get(cfg, "logoPosition", "none") === "none" ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10" : "border-border text-muted-foreground")}>
                None
              </button>
            </Row>
            <Row label={`Logo size — ${get(cfg, "logoSizePx", 48) as number}px`}>
              <input type="range" min={24} max={200} value={get(cfg, "logoSizePx", 48) as number} onChange={(e) => set({ logoSizePx: Number(e.target.value) })} className="w-full" />
            </Row>
            <BgAssetPicker
              kind="image"
              url={get(cfg, "logoUrl", "") as string}
              onUrl={(url) => set({ logoUrl: url })}
              label="Logo image"
              hint="Upload your church logo (PNG with transparent background works best). Displayed at the position above."
              maxMBOverride={5}
            />
            <button
              type="button"
              onClick={autoColorway}
              disabled={paletteBusy || !((get(cfg, "logoUrl", "") as string) || churchLogoUrl)}
              title="Generate a matching gradient + readable text colour from your logo"
              className="mt-1 w-full h-8 rounded-md border border-border text-xs font-semibold hover:bg-accent disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
            >
              {paletteBusy ? "Reading logo…" : "✨ Auto-colourway from logo"}
            </button>
            <Row label="Church name">
              <Toggle value={get(cfg, "churchNameVisible", false)} onChange={(v) => set({ churchNameVisible: v })} />
            </Row>
            {(get(cfg, "churchNameVisible", false) as boolean) && (
              <Row label="Church name position">
                <div className="flex gap-1">
                  {(["top", "bottom"] as const).map((p) => (
                    <button key={p} type="button" onClick={() => set({ churchNamePosition: p })}
                      className={cn("h-9 flex-1 rounded-md border text-xs capitalize", get(cfg, "churchNamePosition", "bottom") === p ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10" : "border-border text-muted-foreground")}>
                      {p}
                    </button>
                  ))}
                </div>
              </Row>
            )}
          </Section>

          <Section title="Lower third">
            <Row label="Enabled">
              <Toggle value={get(cfg, "lowerThirdEnabled", false)} onChange={(v) => set({ lowerThirdEnabled: v })} />
            </Row>
            {(get(cfg, "lowerThirdEnabled", false) as boolean) && (
              <>
                <Row label="Style">
                  <div className="flex gap-1">
                    {(["bar", "gradient-fade", "minimal"] as const).map((s) => (
                      <button key={s} type="button" onClick={() => set({ lowerThirdStyle: s })}
                        className={cn("h-9 flex-1 rounded-md border text-[11px] capitalize", get(cfg, "lowerThirdStyle", "bar") === s ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10" : "border-border text-muted-foreground")}>
                        {s.replace("-", " ")}
                      </button>
                    ))}
                  </div>
                </Row>
                <Row label="Color">
                  <input type="color" value={get(cfg, "lowerThirdColor", "#000000") as string} onChange={(e) => set({ lowerThirdColor: e.target.value })} className={colorCls} />
                </Row>
              </>
            )}
          </Section>

          <Section title="Scripture">
            <Row label="Show reference">
              <Toggle value={get(cfg, "scriptureShowReference", true)} onChange={(v) => set({ scriptureShowReference: v })} />
            </Row>
            <Row label="Reference position">
              <div className="flex gap-1">
                {(["above", "below", "inline"] as const).map((p) => (
                  <button key={p} type="button" onClick={() => set({ scriptureReferencePosition: p })}
                    className={cn("h-9 flex-1 rounded-md border text-xs capitalize", get(cfg, "scriptureReferencePosition", "above") === p ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10" : "border-border text-muted-foreground")}>
                    {p}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Show translation">
              <Toggle value={get(cfg, "scriptureTranslationVisible", true)} onChange={(v) => set({ scriptureTranslationVisible: v })} />
            </Row>
          </Section>

          <Section title="Transitions">
            <Row label="Effect">
              <select value={get(cfg, "transitionType", "fade") as string} onChange={(e) => set({ transitionType: e.target.value })} className={selectCls}>
                <option value="fade">Fade</option>
                <option value="slide">Slide</option>
                <option value="none">None</option>
              </select>
            </Row>
            <Row label={`Duration — ${get(cfg, "transitionDurationMs", 300) as number}ms`}>
              <input type="range" min={0} max={1500} step={50} value={get(cfg, "transitionDurationMs", 300) as number} onChange={(e) => set({ transitionDurationMs: Number(e.target.value) })} className="w-full" />
            </Row>
          </Section>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border p-4">
          <button type="button" onClick={onCancel} className="h-10 rounded-xl border border-border px-4 text-sm text-muted-foreground hover:text-foreground">
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={pending || !theme.name.trim()}
            className="h-10 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-primary-foreground)] disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save theme"}
          </button>
        </footer>
      </aside>

      {/* Right panel — live preview + mode toggle */}
      <section onClick={(e) => e.stopPropagation()} className="flex h-full flex-col overflow-hidden bg-black/40 p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(["lyrics", "scripture", "sermon", "blank"] as PreviewMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "h-8 rounded-md px-3 text-xs font-medium capitalize transition-colors",
                mode === m
                  ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                  : "border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white",
              )}
            >
              {m === "sermon" ? "Sermon point" : m === "blank" ? "Blank + logo" : m}
            </button>
          ))}
          <div className="ml-auto text-[11px] uppercase tracking-[0.14em] text-white/50">
            16:9 preview
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-3xl overflow-hidden rounded-lg shadow-2xl ring-1 ring-white/10">
            <SlidePreview config={cfg} mode={mode} churchLogoUrl={churchLogoUrl} />
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-white/50">
          Preview reflects the theme applied at 16:9. Apply the theme to any song from the song editor (song detail page → Apply theme).
        </p>
      </section>
    </div>
  );
}

// -- sortable theme card --
//
// One theme card in the /library/themes grid. Attaches a dnd-kit drag
// handle so admins can reorder cards; the parent's onDragEnd (which
// calls the reorderThemes server action) persists the order.
function SortableThemeCard({
  theme, pending, churchLogoUrl, onEdit, onSetDefault, onDuplicate, onExport, onDelete,
}: {
  theme: ThemeRow;
  pending: boolean;
  churchLogoUrl?: string | null;
  onEdit: () => void;
  onSetDefault: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: theme.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn("relative overflow-hidden rounded-2xl border bg-card/80", theme.isDefault ? "border-[var(--color-brand)]/40" : "border-border")}
    >
      {theme.isDefault ? (
        <span className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-[var(--color-brand)]/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-primary-foreground)]">
          <Star className="h-2.5 w-2.5 fill-current" /> Default
        </span>
      ) : null}
      <button
        type="button"
        onClick={onEdit}
        className="block w-full text-left focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-brand)]"
      >
        <SlidePreview config={theme.config} mode="lyrics" churchLogoUrl={churchLogoUrl} />
      </button>
      <div className="flex items-center justify-between p-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            className="grid h-8 w-6 shrink-0 cursor-grab place-items-center rounded text-muted-foreground opacity-40 transition hover:opacity-90 active:cursor-grabbing"
            title="Drag to reorder"
            aria-label={`Drag ${theme.name}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="min-w-0 truncate text-left text-sm font-medium hover:underline"
          >
            {theme.name}
          </button>
        </div>
        <div className="flex items-center gap-1">
          {!theme.isDefault ? (
            <button
              type="button"
              onClick={onSetDefault}
              title="Set as default"
              disabled={pending}
              className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-[var(--color-brand)]/10 hover:text-[var(--color-brand)] disabled:opacity-50"
            >
              <Star className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDuplicate}
            title="Duplicate"
            disabled={pending}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-white/[0.04] hover:text-foreground disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onExport}
            title="Export theme (.json)"
            disabled={pending}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-white/[0.04] hover:text-foreground disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete"
            disabled={pending}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}

// -- media library picker (modal) --
//
// Opens the church's existing Media library (GET /api/media/list, already
// auth-gated + church-scoped) filtered to the asset kind, so an operator can
// re-use a video/image they've already uploaded instead of re-uploading. The
// list route mints fresh presigned GET URLs, so clicking a tile hands back a
// ready-to-use URL — exactly what the theme bg/logo fields store.
type LibraryAsset = { id: string; fileName: string; kind: string; url: string };

function MediaLibraryPicker({
  kind, onPick, onClose,
}: {
  kind: "image" | "video";
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const [assets, setAssets] = useState<LibraryAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/media/list").then((r) => r.json()) as { assets?: LibraryAsset[]; error?: string };
        if (!alive) return;
        if (res.error) { setError(res.error); return; }
        // The library stores images and videos together; show only the kind
        // this picker wants. `kind` on the media row is "image"/"video".
        setAssets((res.assets ?? []).filter((a) => a.kind === kind));
      } catch {
        if (alive) setError("Couldn't load your media library");
      }
    })();
    return () => { alive = false; };
  }, [kind]);

  return (
    <div
      className="fixed inset-0 z-[95] grid place-items-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-[var(--color-panel,#141818)] shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-border p-4">
          <div className="text-sm font-semibold">Choose {kind === "image" ? "an image" : "a video"} from your library</div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-white/[0.05] hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          {error ? (
            <div className="py-10 text-center text-sm text-muted-foreground">{error}</div>
          ) : assets === null ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading your library…</div>
          ) : assets.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No {kind}s in your library yet. Upload one below and it'll appear here next time.
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {assets.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => { onPick(a.url); onClose(); }}
                    className="group block w-full overflow-hidden rounded-lg border border-border bg-black/40 text-left transition hover:border-[var(--color-primary)]"
                    title={a.fileName}
                  >
                    <div className="aspect-video w-full overflow-hidden bg-black/60">
                      {a.kind === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.url} alt={a.fileName} className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <video src={a.url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                      )}
                    </div>
                    <div className="truncate px-2 py-1.5 text-[11px] text-muted-foreground group-hover:text-foreground">{a.fileName}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// -- background asset picker (image + video) --
//
// Two-input row: paste a presigned URL from your Media library, OR upload
// a fresh file which the component sends to /api/media/presign, PUTs to S3
// with the returned presign URL, then stores the resulting S3 key path as
// the theme's bgImageUrl/bgVideoUrl.
//
// Uses the same `media` purpose as the rest of the app — the S3 key ends
// up under `{churchId}/media/...` which the existing media library reader
// (getExpandedServicePlan etc.) also reads. So a theme background upload
// becomes a real Media entry, browsable + reusable elsewhere.
function BgAssetPicker({
  kind, url, onUrl, label, hint, maxMBOverride,
}: {
  kind: "image" | "video";
  url: string;
  onUrl: (nextUrl: string) => void;
  label?: string;
  hint?: string;
  maxMBOverride?: number;
}) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const accept = kind === "image"
    ? "image/png,image/jpeg,image/webp,image/gif,image/avif"
    : "video/mp4,video/webm,video/quicktime";
  const maxMB = maxMBOverride ?? (kind === "image" ? 10 : 100);

  async function pickFile(file: File) {
    setUploading(true);
    try {
      const presign = await fetch("/api/media/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size, purpose: "media" }),
      }).then((r) => r.json()) as { url?: string; key?: string; error?: string };
      if (presign.error) throw new Error(presign.error);
      if (!presign.url || !presign.key) throw new Error("Presign response missing url or key");
      const put = await fetch(presign.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error("Upload failed");
      const getResult = await fetch("/api/media/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: presign.key }),
      }).then((r) => r.json()) as { url?: string; error?: string };
      if (getResult.error) throw new Error(getResult.error);
      if (!getResult.url) throw new Error("Could not get download URL");
      onUrl(getResult.url);
      toast.success(`${kind === "image" ? "Image" : "Video"} uploaded`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // Use native Electron file dialog when available (desktop app); fall back
  // to the hidden <input type="file"> otherwise.
  async function openNativePicker() {
    const api = typeof window !== "undefined" && (window as any).electronAPI;
    if (api?.dialog?.openFile) {
      const extFilters = kind === "image"
        ? [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif"] }]
        : [{ name: "Videos", extensions: ["mp4", "webm", "mov"] }];
      const result = await api.dialog.openFile({ filters: extFilters, properties: ["openFile"] });
      if (result?.canceled || !result?.filePaths?.length) return;
      // In Electron the path is a local filesystem path — fetch as a blob.
      try {
        const blob = await fetch(`file://${result.filePaths[0]}`).then((r) => r.blob());
        const fileName = result.filePaths[0].split(/[/\\]/).pop() ?? "upload";
        await pickFile(new File([blob], fileName, { type: blob.type || "application/octet-stream" }));
      } catch {
        toast.error("Could not read file");
      }
      return;
    }
    // Web fallback handled by the hidden <input> click below.
    document.getElementById(`bg-picker-${kind}-${Math.random()}`)?.click();
  }

  return (
    <div className="space-y-2">
      <Row label={label ?? `${kind === "image" ? "Image" : "Video"} URL`} hint={hint ?? `Paste a URL, drag a file here, or pick from your library (max ${maxMB} MB).`}>
        <input
          type="url"
          value={url}
          onChange={(e) => onUrl(e.target.value)}
          placeholder="https://…"
          className={inputCls}
        />
      </Row>
      <button
        type="button"
        onClick={() => setLibOpen(true)}
        className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border text-xs font-medium text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
      >
        <ImageIcon className="h-3.5 w-3.5" /> Choose from media library
      </button>
      {libOpen && (
        <MediaLibraryPicker kind={kind} onPick={onUrl} onClose={() => setLibOpen(false)} />
      )}
      {/* Drag-and-drop zone — works in both Electron (Finder drag) and web (file drag) */}
      <div
        className={cn(
          "relative flex h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed text-xs font-medium transition-colors",
          dragOver
            ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
            : "border-border bg-[var(--pf-admin-bg-subtle,rgba(255,255,255,0.02))] text-muted-foreground hover:border-[var(--color-primary)]/50 hover:text-foreground",
          uploading && "pointer-events-none cursor-wait opacity-60",
        )}
        onClick={() => void openNativePicker()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void pickFile(f);
        }}
      >
        {uploading ? (
          <span>Uploading…</span>
        ) : (
          <>
            <span>{dragOver ? `Drop ${kind} here` : `Drag & drop or click to browse`}</span>
            <span className="text-[10px] opacity-60">{kind === "image" ? "PNG, JPG, WEBP, GIF" : "MP4, WEBM, MOV"} · max {maxMB} MB</span>
          </>
        )}
        {/* Hidden fallback for non-Electron / older browsers */}
        <input
          type="file"
          accept={accept}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pickFile(f);
            e.target.value = "";
          }}
        />
      </div>
      {url && (
        <button
          type="button"
          onClick={() => onUrl("")}
          className="text-[11px] text-destructive hover:opacity-80"
        >
          Remove {kind}
        </button>
      )}
    </div>
  );
}

// -- small building blocks --

const inputCls = "h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-[var(--color-primary)]/70";
const selectCls = "h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-[var(--color-primary)]/70";
const colorCls = "h-9 w-full cursor-pointer rounded-md border border-border bg-background";

function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details open={defaultOpen} className="group rounded-md border border-border bg-white/[0.02]">
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-3 py-2 text-sm font-medium hover:bg-white/[0.04]">
        <span>{title}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 p-3 pt-2">{children}</div>
    </details>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</label>
      {children}
      {hint ? <div className="mt-1 text-[10.5px] text-muted-foreground/70">{hint}</div> : null}
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        value ? "bg-[var(--color-primary)]" : "bg-white/[0.08]",
      )}
    >
      <span className={cn("inline-block h-5 w-5 transform rounded-full bg-white transition-transform", value ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}
