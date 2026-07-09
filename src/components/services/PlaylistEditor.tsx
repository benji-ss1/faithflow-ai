"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2, Plus, Play } from "lucide-react";
import { addServiceItem, removeServiceItem, reorderServiceItems } from "@/lib/actions";
import { toast } from "sonner";
import { GenerateSummaryButton } from "./GenerateSummaryButton";

type Item = { id: string; order: number; type: string; title: string };
type Song = { id: string; title: string };
type Media = { id: string; fileName: string; kind: "image" | "video" };
type Pptx = { id: string; originalFileName: string; status: string };

export function PlaylistEditor({ planId, planTitle, initialItems, songs, media, pptx }:
  { planId: string; planTitle: string; initialItems: Item[]; songs: Song[]; media: Media[]; pptx: Pptx[] }) {
  const [items, setItems] = useState<Item[]>(initialItems);
  const [showPicker, setShowPicker] = useState(false);
  const [, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  // dnd-kit assigns aria-describedby ids via a global counter that increments
  // differently between SSR and client hydration. Gate the sortable render
  // until after mount so we hydrate to plain <li>s first, then swap to the
  // fully-interactive dnd tree. Prevents the "aria-describedby mismatch"
  // hydration warning without disabling reordering.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    const next = arrayMove(items, oldIdx, newIdx);
    setItems(next);
    startTransition(async () => {
      const res = await reorderServiceItems(planId, next.map((i) => i.id));
      if (!res.ok) toast.error(res.error);
    });
  }

  async function add(type: Item["type"], title: string, payload: Record<string, unknown>) {
    const res = await addServiceItem(planId, type as never, title, payload);
    if (!res.ok) { toast.error(res.error); return; }
    setShowPicker(false);
    location.reload();
  }

  async function remove(id: string) {
    setItems((cur) => cur.filter((i) => i.id !== id));
    const res = await removeServiceItem(id);
    if (!res.ok) toast.error(res.error);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="eyebrow text-muted-foreground mb-1">Service plan</div>
          <h1 className="text-2xl md:text-3xl font-semibold font-display">{planTitle}</h1>
        </div>
        <div className="flex gap-2">
          <GenerateSummaryButton planId={planId} />
          <button onClick={() => setShowPicker(true)}
            className="h-9 px-4 border border-border rounded-md text-sm font-semibold hover:bg-accent inline-flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Add item
          </button>
          <Link href={`/services/${planId}/operate`}
            className="h-9 px-4 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90 inline-flex items-center gap-1.5">
            <Play className="w-4 h-4" /> Operate
          </Link>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="border border-dashed border-border rounded-md p-12 text-center">
          <div className="text-sm text-muted-foreground mb-4">Empty playlist.</div>
          <button onClick={() => setShowPicker(true)}
            className="h-9 px-4 bg-foreground text-background rounded-md text-sm font-semibold hover:opacity-90">Add first item</button>
        </div>
      ) : !mounted ? (
        // SSR + first-paint fallback: plain list with the same visual output
        // but no dnd attributes. Post-mount effect swaps in the dnd tree.
        <ul className="border border-border rounded-md overflow-hidden">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-3 py-3 border-b border-border last:border-b-0 bg-background">
              <span className="text-muted-foreground"><GripVertical className="w-4 h-4" /></span>
              <span className="eyebrow text-muted-foreground w-20">{item.type}</span>
              <span className="text-sm font-medium flex-1">{item.title}</span>
            </li>
          ))}
        </ul>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <ul className="border border-border rounded-md overflow-hidden">
              {items.map((item) => <Row key={item.id} item={item} onRemove={remove} />)}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {showPicker && (
        <ItemPicker onClose={() => setShowPicker(false)} onAdd={add} songs={songs} media={media} pptx={pptx} />
      )}
    </div>
  );
}

function Row({ item, onRemove }: { item: Item; onRemove: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-3 px-3 py-3 border-b border-border last:border-b-0 bg-background">
      <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground">
        <GripVertical className="w-4 h-4" />
      </button>
      <span className="eyebrow text-muted-foreground w-20">{item.type}</span>
      <span className="text-sm font-medium flex-1">{item.title}</span>
      <button onClick={() => onRemove(item.id)} className="text-muted-foreground hover:text-destructive p-1">
        <Trash2 className="w-4 h-4" />
      </button>
    </li>
  );
}

function ItemPicker({ onClose, onAdd, songs, media, pptx }:
  { onClose: () => void; onAdd: (type: Item["type"], title: string, payload: Record<string, unknown>) => void; songs: Song[]; media: Media[]; pptx: Pptx[] }) {
  const [tab, setTab] = useState<"song" | "scripture" | "media" | "sermon" | "blank" | "logo">("song");
  const [scriptureRef, setScriptureRef] = useState("");
  const [scriptureText, setScriptureText] = useState("");

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={onClose}>
      <div className="bg-background border border-border rounded-md w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Add service item</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-sm">Close</button>
        </div>
        <div className="border-b border-border px-2 flex gap-1">
          {(["song", "scripture", "media", "sermon", "blank", "logo"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-2 text-xs font-semibold uppercase tracking-wider ${tab === t ? "text-foreground border-b-2 border-foreground" : "text-muted-foreground"}`}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {tab === "song" && (
            <ul className="space-y-1">
              {songs.length === 0 && <li className="text-sm text-muted-foreground">No songs. Create one in the Songs library.</li>}
              {songs.map((s) => (
                <li key={s.id}>
                  <button onClick={() => onAdd("song", s.title, { songId: s.id })}
                    className="w-full text-left px-3 py-2 rounded-md text-sm hover:bg-accent">{s.title}</button>
                </li>
              ))}
            </ul>
          )}
          {tab === "scripture" && (
            <div className="space-y-3">
              <input value={scriptureRef} onChange={(e) => setScriptureRef(e.target.value)} placeholder="Reference (e.g. John 3:16)"
                className="w-full h-9 px-3 border border-border rounded-md bg-background text-sm" />
              <textarea value={scriptureText} onChange={(e) => setScriptureText(e.target.value)} placeholder="Paste scripture text. Blank lines separate slides."
                rows={8} className="w-full px-3 py-2 border border-border rounded-md bg-background text-sm resize-none" />
              <button onClick={() => {
                const slides = scriptureText.split(/\n\s*\n/).map((t) => ({ text: t.trim() })).filter((s) => s.text);
                onAdd("scripture", scriptureRef || "Scripture", { reference: scriptureRef, slides });
              }} className="h-9 px-4 bg-foreground text-background rounded-md text-sm font-semibold">Add</button>
            </div>
          )}
          {tab === "media" && (
            <ul className="grid grid-cols-2 gap-2">
              {media.length === 0 && <li className="text-sm text-muted-foreground col-span-2">No media. Upload in the Media library.</li>}
              {media.map((m) => (
                <li key={m.id}>
                  <button onClick={() => onAdd("media", m.fileName, { mediaAssetId: m.id, fitMode: "contain" })}
                    className="w-full text-left px-3 py-2 rounded-md text-sm border border-border hover:bg-accent">
                    <div className="eyebrow text-muted-foreground">{m.kind}</div>
                    <div className="font-medium truncate">{m.fileName}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {tab === "sermon" && (
            <ul className="space-y-1">
              {pptx.filter((p) => p.status === "ready").length === 0 && <li className="text-sm text-muted-foreground">No ready PPTX imports.</li>}
              {pptx.filter((p) => p.status === "ready").map((p) => (
                <li key={p.id}>
                  <button onClick={() => onAdd("sermon", p.originalFileName, { pptxImportId: p.id })}
                    className="w-full text-left px-3 py-2 rounded-md text-sm hover:bg-accent">{p.originalFileName}</button>
                </li>
              ))}
            </ul>
          )}
          {tab === "blank" && (
            <button onClick={() => onAdd("blank", "Blank", {})} className="h-9 px-4 bg-foreground text-background rounded-md text-sm font-semibold">Add blank</button>
          )}
          {tab === "logo" && (
            <button onClick={() => onAdd("logo", "Logo", {})} className="h-9 px-4 bg-foreground text-background rounded-md text-sm font-semibold">Add logo</button>
          )}
        </div>
      </div>
    </div>
  );
}
