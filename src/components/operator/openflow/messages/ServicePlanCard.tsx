"use client";
/*
 * ServicePlanCard — renders a generated service plan as reorderable blocks and
 * applies it to the real running order in one click. Songs are matched to the
 * church's library, scripture is resolved to real text, and other blocks become
 * labelled placeholders (all via applyOpenFlowServicePlan). Blocks drag-reorder
 * locally so the operator can tweak order before applying.
 */
import { useState } from "react";
import { toast } from "sonner";
import {
  DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { IconGripVertical, IconCheck, IconRefresh, IconBulb } from "@tabler/icons-react";
import { applyOpenFlowServicePlan } from "@/lib/openflow/actions";
import type { ServicePlan, ServicePlanBlock } from "@/lib/openflow/parse";
import type { OpenFlowActions } from "@/lib/openflow/types";

function fmtDur(mins: number): string {
  if (mins <= 0) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m ? `${m}m` : ""}`.trim() : `${m}m`;
}

function BlockRow({ block, id }: { block: ServicePlanBlock; id: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const isScripture = block.type === "scripture";
  return (
    <div ref={setNodeRef} style={style} className="of-block">
      <span className="of-grip" {...attributes} {...listeners} aria-label="Drag to reorder">
        <IconGripVertical size={14} />
      </span>
      <div className="of-bname">
        <span className={`of-kdot of-k-${block.type}`} />
        <span className="nm">{block.name}</span>
        {block.items.length ? <span className={`sub${isScripture ? " gold" : ""}`}>{block.items.join(" · ")}</span> : null}
      </div>
      <span className="of-dur">{fmtDur(block.durationMin)}</span>
    </div>
  );
}

export function ServicePlanCard({ plan, actions }: { plan: ServicePlan; actions: OpenFlowActions }) {
  const [blocks, setBlocks] = useState<ServicePlanBlock[]>(plan.blocks);
  const [applying, setApplying] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = blocks.map((_, i) => `blk-${i}`);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    setBlocks((b) => arrayMove(b, from, to));
  };

  const total = blocks.reduce((s, b) => s + b.durationMin, 0) || plan.totalMin;

  const apply = async () => {
    setApplying(true);
    try {
      const res = await applyOpenFlowServicePlan(actions.planId, blocks);
      if (!res.ok) { toast.error(res.error || "Couldn't apply the plan."); return; }
      const { added, skipped } = res.data!;
      actions.onApplied();
      if (skipped.length) {
        toast.success(`Applied ${added} item${added === 1 ? "" : "s"}. Not in your library: ${skipped.join(", ")}`);
      } else {
        toast.success(`Service applied to playlist — ${added} item${added === 1 ? "" : "s"}`);
      }
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="of-card">
      <div className="of-card-head">
        <h3>{plan.serviceType}</h3>
        <span className="tag">Service plan</span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {blocks.map((b, i) => <BlockRow key={ids[i]} id={ids[i]} block={b} />)}
        </SortableContext>
      </DndContext>
      <div className="of-total">
        <span className="lbl">Total estimate</span>
        <span className="val">~{fmtDur(total)}</span>
      </div>
      {plan.insights.length ? (
        <div className="of-insight">
          <IconBulb size={16} stroke={1.8} />
          <div>{plan.insights.map((t, i) => <p key={i}>{t}</p>)}</div>
        </div>
      ) : null}
      <div className="of-card-actions">
        <button type="button" className="of-btn of-btn-primary" onClick={apply} disabled={applying}>
          <IconCheck size={15} stroke={2} />{applying ? "Applying…" : "Apply to Service"}
        </button>
        <button type="button" className="of-btn of-btn-ghost" onClick={() => actions.onSeedComposer("Adjust the plan: ")} disabled={applying}>
          Edit
        </button>
        <button type="button" className="of-btn of-btn-ghost" onClick={actions.onRegenerate} disabled={applying}>
          <IconRefresh size={14} stroke={1.8} />Regenerate
        </button>
      </div>
    </div>
  );
}
