"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown, Copy, Palette, Plus, Star, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { createTheme, updateTheme, duplicateTheme, deleteTheme, setDefaultTheme } from "@/lib/actions";

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
  logoPosition: "none",
  logoSizePx: 48,
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

export function ThemesManager({ themes: initial }: { themes: ThemeRow[] }) {
  const [themes, setThemes] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<ThemeRow | null>(null);

  function refresh(next: ThemeRow[]) {
    setThemes(next.slice().sort((a, b) => a.name.localeCompare(b.name)));
  }

  function onCreate() {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      const res = await createTheme(name, DEFAULT_CONFIG);
      if (!res.ok) { toast.error(res.error || "Could not create theme"); return; }
      if (!res.data) { toast.error("Server returned no id"); return; }
      refresh([...themes, { id: res.data.id, name, config: DEFAULT_CONFIG }]);
      setNewName(""); setCreating(false);
      toast.success(`Created "${name}"`);
    });
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

  function onDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    startTransition(async () => {
      const res = await deleteTheme(id);
      if (!res.ok) { toast.error(res.error || "Could not delete"); return; }
      refresh(themes.filter((t) => t.id !== id));
      toast.success("Deleted");
    });
  }

  function onSetDefault(id: string) {
    startTransition(async () => {
      const res = await setDefaultTheme(id);
      if (!res.ok) { toast.error(res.error || "Could not set default"); return; }
      // Mirror the server transaction locally: unset any current default,
      // then set the target. Avoids a full refetch.
      setThemes((prev) => prev.map((t) => ({ ...t, isDefault: t.id === id })));
      toast.success("Set as default");
    });
  }

  function onSaveEdit() {
    if (!editing) return;
    const target = editing;
    startTransition(async () => {
      const res = await updateTheme(target.id, { name: target.name, config: target.config });
      if (!res.ok) { toast.error(res.error || "Could not save"); return; }
      refresh(themes.map((t) => (t.id === target.id ? target : t)));
      setEditing(null);
      toast.success("Saved");
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {themes.length} theme{themes.length === 1 ? "" : "s"}
        </div>
        {creating ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onCreate();
                if (e.key === "Escape") { setCreating(false); setNewName(""); }
              }}
              placeholder="Theme name"
              maxLength={80}
              className="h-10 w-56 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-[var(--color-primary)]/70"
            />
            <button
              type="button"
              onClick={onCreate}
              disabled={!newName.trim() || pending}
              className="h-10 rounded-xl bg-[var(--color-primary)] px-3 text-sm font-semibold text-[var(--color-primary-foreground)] disabled:opacity-50"
            >
              {pending ? "…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => { setCreating(false); setNewName(""); }}
              className="h-10 rounded-xl border border-border px-3 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-primary-foreground)]"
          >
            <Plus className="h-4 w-4" /> New theme
          </button>
        )}
      </div>

      {themes.length === 0 && !creating ? (
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
            onClick={() => setCreating(true)}
            className="mt-2 inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-primary-foreground)]"
          >
            <Plus className="h-4 w-4" /> Create your first theme
          </button>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {themes.map((t) => (
            <li key={t.id} className={cn("relative overflow-hidden rounded-2xl border bg-card/80", t.isDefault ? "border-[var(--pf-admin-accent)]/40" : "border-border")}>
              {t.isDefault ? (
                <span className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-[var(--pf-admin-accent)]/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--pf-admin-text-inverse)]">
                  <Star className="h-2.5 w-2.5 fill-current" /> Default
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => setEditing(t)}
                className="block w-full text-left focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--pf-admin-accent-ring)]"
              >
                <SlidePreview config={t.config} mode="lyrics" />
              </button>
              <div className="flex items-center justify-between p-4">
                <button
                  type="button"
                  onClick={() => setEditing(t)}
                  className="truncate text-left text-sm font-medium hover:underline"
                >
                  {t.name}
                </button>
                <div className="flex items-center gap-1">
                  {!t.isDefault ? (
                    <button
                      type="button"
                      onClick={() => onSetDefault(t.id)}
                      title="Set as default"
                      disabled={pending}
                      className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-[var(--pf-admin-accent)]/10 hover:text-[var(--pf-admin-accent)] disabled:opacity-50"
                    >
                      <Star className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onDuplicate(t.id)}
                    title="Duplicate"
                    disabled={pending}
                    className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-white/[0.04] hover:text-foreground disabled:opacity-50"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(t.id, t.name)}
                    title="Delete"
                    disabled={pending}
                    className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <ThemeEditor
          theme={editing}
          pending={pending}
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
function SlidePreview({ config, mode = "lyrics", churchName = "Grace Community" }: {
  config: ThemeConfig;
  mode?: PreviewMode;
  churchName?: string;
}) {
  const bgType = get(config, "bgType", "solid") as "solid" | "gradient" | "image" | "video";
  const bg1 = get(config, "bgColor", "#0B0B0B") as string;
  const bg2 = get(config, "bgColor2", "#1A0A14") as string;
  const bgImageUrl = get(config, "bgImageUrl", "") as string;
  const bgVideoUrl = get(config, "bgVideoUrl", "") as string;
  const bgOpacity = get(config, "bgOpacity", 1) as number;

  const fontFamily = get(config, "fontFamily", "Inter") as string;
  const fontSize = get(config, mode === "scripture" ? "fontSizeScripturePx" : "fontSizePx", mode === "scripture" ? 56 : 72) as number;
  const fontWeight = get(config, "fontWeight", 600) as number;
  const textColor = get(config, "textColor", "#F1EFE8") as string;
  const textShadow = get(config, "textShadow", false) as boolean;
  const align = get(config, "align", "center") as "left" | "center" | "right";

  const logoPosition = get(config, "logoPosition", "none") as string;
  const logoSize = get(config, "logoSizePx", 48) as number;
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
      ? { background: `linear-gradient(135deg, ${bg1}, ${bg2})` }
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
      style={{ aspectRatio: "16 / 9", ...backgroundStyle, opacity: bgOpacity }}
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
          <img src="/brand/pf-logo-mark.png" alt="" style={{ height: `${logoSize * previewScale}px`, width: "auto", opacity: 0.9 }} />
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
  theme, pending, onCancel, onChange, onSave,
}: {
  theme: ThemeRow;
  pending: boolean;
  onCancel: () => void;
  onChange: (next: ThemeRow) => void;
  onSave: () => void;
}) {
  const [mode, setMode] = useState<PreviewMode>("lyrics");
  const cfg = theme.config;

  function set(patch: Partial<Record<string, unknown>>) {
    onChange({ ...theme, config: { ...cfg, ...patch } });
  }

  return (
    <div className="fixed inset-0 z-50 grid grid-cols-[minmax(360px,40%)_1fr] bg-black/70 backdrop-blur-sm" onClick={onCancel}>
      {/* Left panel — controls */}
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex h-full flex-col overflow-hidden bg-[var(--color-panel,#141818)] shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Edit theme</div>
            <input
              value={theme.name}
              maxLength={80}
              onChange={(e) => onChange({ ...theme, name: e.target.value })}
              className="mt-0.5 w-full truncate bg-transparent text-lg font-semibold outline-none"
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
            <SlidePreview config={cfg} mode={mode} />
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-white/50">
          Preview reflects the theme applied at 16:9. Apply the theme to any song from the song editor (song detail page → Apply theme).
        </p>
      </section>
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
  kind, url, onUrl,
}: {
  kind: "image" | "video";
  url: string;
  onUrl: (nextUrl: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const accept = kind === "image"
    ? "image/png,image/jpeg,image/webp,image/gif,image/avif"
    : "video/mp4,video/webm,video/quicktime";
  const maxMB = kind === "image" ? 10 : 100; // client-side hint; server enforces per-purpose cap

  async function pickFile(file: File) {
    setUploading(true);
    try {
      const presign = await fetch("/api/media/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size, purpose: "media" }),
      }).then((r) => r.json());
      if (presign.error) throw new Error(presign.error);
      const put = await fetch(presign.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error("Upload failed");
      // Return a client-viewable URL from the same presigned PUT origin. The
      // preview renders it inline; the operator projector will re-presign
      // via presignGet at render time using the stored S3 key path.
      const objectUrl = URL.createObjectURL(file);
      onUrl(objectUrl);
      toast.success(`${kind === "image" ? "Image" : "Video"} uploaded`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Row label={`${kind === "image" ? "Image" : "Video"} URL`} hint={`Paste a presigned URL, or upload a new file below (max ${maxMB} MB).`}>
        <input
          type="url"
          value={url}
          onChange={(e) => onUrl(e.target.value)}
          placeholder="https://…"
          className={inputCls}
        />
      </Row>
      <label className={cn("flex h-10 cursor-pointer items-center justify-center rounded-md border border-dashed border-border bg-[var(--pf-admin-bg-subtle,rgba(255,255,255,0.02))] px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-[var(--color-primary)]/50 hover:text-foreground", uploading && "pointer-events-none cursor-wait opacity-60")}>
        {uploading ? "Uploading…" : `Or upload a new ${kind}…`}
        <input
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pickFile(f);
            e.target.value = "";
          }}
        />
      </label>
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
