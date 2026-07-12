"use client";

export function ThemesTab() {
  const swatches = ["#0e0b12", "#1c1820", "#ff7a2c", "#ff9048", "#4fd18b", "#f0b35a"];
  return (
    <div className="flex flex-col gap-3">
      <select className="w-full h-8 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded">
        <option>Default Collection</option>
      </select>
      <div className="eyebrow">Themes (coming soon)</div>
      <div className="grid grid-cols-3 gap-2">
        {swatches.map((c) => (
          <div
            key={c}
            className="aspect-video rounded border border-[var(--color-border)]"
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <button data-todo="1" className="flex-1 h-8 rounded border border-[var(--color-border)]">Edit</button>
        <button data-todo="1" className="flex-1 h-8 rounded border border-[var(--color-border)]">Create</button>
      </div>
    </div>
  );
}
