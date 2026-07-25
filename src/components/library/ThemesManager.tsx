"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Palette, Plus, Copy, Trash2 } from "lucide-react";
import { createTheme, updateTheme, duplicateTheme, deleteTheme } from "@/lib/actions";

type ThemeRow = {
  id: string;
  name: string;
  config: Record<string, unknown>;
};

const DEFAULT_CONFIG = {
  bgColor: "#0B0B0B",
  textColor: "#F1EFE8",
  fontFamily: "Inter",
  fontSizePx: 72,
  fontWeight: 600,
  align: "center" as const,
};

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
      refresh([...themes, { id: res.data.id, name, config: DEFAULT_CONFIG as Record<string, unknown> }]);
      setNewName("");
      setCreating(false);
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
            A theme is a saved bundle of colours, fonts, and transitions you can apply to any song with one click.
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
            <li key={t.id} className="overflow-hidden rounded-2xl border border-border bg-card/80">
              <ThemePreview config={t.config} />
              <div className="flex items-center justify-between p-4">
                <button
                  type="button"
                  onClick={() => setEditing(t)}
                  className="truncate text-left text-sm font-medium hover:underline"
                >
                  {t.name}
                </button>
                <div className="flex items-center gap-1">
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

function ThemePreview({ config }: { config: Record<string, unknown> }) {
  const bg = (config.bgColor as string) || "#0B0B0B";
  const fg = (config.textColor as string) || "#F1EFE8";
  const font = (config.fontFamily as string) || "Inter";
  const size = Math.min(56, Math.max(14, ((config.fontSizePx as number) || 72) / 2));
  const weight = (config.fontWeight as number) || 600;
  const align = ((config.align as string) || "center") as "left" | "center" | "right";
  return (
    <div
      className="flex h-32 items-center justify-center px-4"
      style={{ background: bg, color: fg, fontFamily: font, fontSize: `${size}px`, fontWeight: weight, textAlign: align }}
    >
      Sample slide
    </div>
  );
}

function ThemeEditor({
  theme, pending, onCancel, onChange, onSave,
}: {
  theme: ThemeRow;
  pending: boolean;
  onCancel: () => void;
  onChange: (next: ThemeRow) => void;
  onSave: () => void;
}) {
  function set<K extends keyof Record<string, unknown>>(key: K, value: unknown) {
    onChange({ ...theme, config: { ...theme.config, [key]: value } });
  }
  const cfg = theme.config;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-[var(--color-panel,#141818)] shadow-2xl"
      >
        <div className="border-b border-border p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Edit theme</div>
          <input
            value={theme.name}
            maxLength={80}
            onChange={(e) => onChange({ ...theme, name: e.target.value })}
            className="mt-1 w-full bg-transparent text-2xl font-semibold outline-none"
          />
        </div>
        <div className="grid gap-6 p-5 md:grid-cols-2">
          <div className="space-y-4">
            <Row label="Background color">
              <input type="color" value={(cfg.bgColor as string) || "#0B0B0B"} onChange={(e) => set("bgColor", e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background" />
            </Row>
            <Row label="Text color">
              <input type="color" value={(cfg.textColor as string) || "#F1EFE8"} onChange={(e) => set("textColor", e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background" />
            </Row>
            <Row label="Font family">
              <select
                value={(cfg.fontFamily as string) || "Inter"}
                onChange={(e) => set("fontFamily", e.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
              >
                {["Inter", "Sora", "Plus Jakarta Sans", "Georgia", "Helvetica", "Arial"].map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </Row>
            <Row label="Font size (px)">
              <input
                type="number" min={12} max={200}
                value={(cfg.fontSizePx as number) || 72}
                onChange={(e) => set("fontSizePx", Number(e.target.value))}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
              />
            </Row>
            <Row label="Font weight">
              <select
                value={String((cfg.fontWeight as number) || 600)}
                onChange={(e) => set("fontWeight", Number(e.target.value))}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
              >
                {[300, 400, 500, 600, 700, 800].map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </Row>
            <Row label="Alignment">
              <div className="flex gap-2">
                {(["left", "center", "right"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => set("align", a)}
                    className={`h-10 flex-1 rounded-xl border text-sm ${((cfg.align as string) || "center") === a ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-foreground" : "border-border text-muted-foreground"}`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </Row>
          </div>
          <div>
            <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Preview</div>
            <ThemePreview config={cfg} />
            <p className="mt-3 text-xs text-muted-foreground">
              Apply this theme to any song from the song editor (song detail page → Apply theme).
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border p-4">
          <button type="button" onClick={onCancel} className="h-10 rounded-xl border border-border px-4 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button
            type="button"
            onClick={onSave}
            disabled={pending || !theme.name.trim()}
            className="h-10 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-primary-foreground)] disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
