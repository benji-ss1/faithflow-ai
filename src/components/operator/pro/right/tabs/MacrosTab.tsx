"use client";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, Trash2 } from "lucide-react";

const KEY = "presentflow.pro.macros.v1";

type Macro = {
  id: string;
  name: string;
  trigger: "hotkey" | "onSlideShow";
  action: "goToSlide" | "startTimer" | "sendMessage" | "killLive";
};

export function MacrosTab() {
  const [macros, setMacros] = useState<Macro[]>([]);
  const [dlg, setDlg] = useState(false);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<Macro["trigger"]>("hotkey");
  const [action, setAction] = useState<Macro["action"]>("goToSlide");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) setMacros(JSON.parse(raw));
    } catch { /* noop */ }
  }, []);

  const persist = (m: Macro[]) => {
    setMacros(m);
    try { window.localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* noop */ }
  };

  const add = () => {
    if (!name.trim()) return;
    persist([...macros, { id: crypto.randomUUID(), name: name.trim(), trigger, action }]);
    setName(""); setDlg(false);
  };

  const remove = (id: string) => persist(macros.filter((m) => m.id !== id));

  return (
    <div className="flex flex-col gap-3">
      <Dialog.Root open={dlg} onOpenChange={setDlg}>
        <Dialog.Trigger asChild>
          <button className="h-9 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-elevated)] flex items-center justify-center gap-2">
            <Plus className="w-4 h-4" /> Add Macro
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[380px] bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg z-50 p-4 flex flex-col gap-3">
            <Dialog.Title className="font-semibold text-[14px]">New Macro</Dialog.Title>
            <label className="flex flex-col gap-1">
              <span className="eyebrow">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="h-8 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="eyebrow">Trigger</span>
              <select value={trigger} onChange={(e) => setTrigger(e.target.value as Macro["trigger"])} className="h-8 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded">
                <option value="hotkey">Hotkey</option>
                <option value="onSlideShow">On Slide Show</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="eyebrow">Action</span>
              <select value={action} onChange={(e) => setAction(e.target.value as Macro["action"])} className="h-8 px-2 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded">
                <option value="goToSlide">Go to slide</option>
                <option value="startTimer">Start timer</option>
                <option value="sendMessage">Send message</option>
                <option value="killLive">Kill live</option>
              </select>
            </label>
            <div className="flex gap-2 justify-end mt-2">
              <button onClick={() => setDlg(false)} className="h-8 px-3 rounded border border-[var(--color-border)]">Cancel</button>
              <button onClick={add} className="h-8 px-3 rounded bg-[var(--color-brand)] text-black font-semibold">Save</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {macros.length === 0 ? (
        <div className="text-[var(--color-muted-foreground)] py-6 text-center">No macros yet.</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {macros.map((m) => (
            <li key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-[var(--color-elevated)]">
              <div className="flex-1 min-w-0">
                <div className="truncate">{m.name}</div>
                <div className="text-[10px] text-[var(--color-muted-foreground)]">{m.trigger} → {m.action}</div>
              </div>
              <button onClick={() => remove(m.id)} className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-panel)] text-[var(--color-muted-foreground)]" title="Remove">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="eyebrow text-right">{macros.length} items</div>
    </div>
  );
}
