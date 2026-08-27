"use client";
/*
 * ServicePlanCard — a generated service rendered with REAL, theme-accurate slide
 * previews (via ThemedSlideCard, the projector's own renderer). Each block shows
 * a thumbnail of its first slide; click to expand the full slide list it will
 * create. Blocks drag-reorder; Apply builds the real running order.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { IconGripVertical, IconCheck, IconRefresh, IconBulb, IconChevronDown } from "@tabler/icons-react";
import { applyOpenFlowServicePlan, hydrateOpenFlowPlan, type OpenFlowHydratedBlock } from "@/lib/openflow/actions";
import type { ServicePlan, ServicePlanBlock } from "@/lib/openflow/parse";
import type { OpenFlowActions } from "@/lib/openflow/types";
import { OpenFlowSlidePreview } from "./SlidePreview";

function fmtDur(mins: number): string {
  if (mins <= 0) return "";
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h ${m ? `${m}m` : ""}`.trim() : `${m}m`;
}

type Row = { id: string; block: ServicePlanBlock; h: OpenFlowHydratedBlock | null };

function BlockRow({
  row, actions, expanded, onToggle,
}: { row: Row; actions: OpenFlowActions; expanded: boolean; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const { block, h } = row;
  const first = h?.slides[0];
  const slideCount = h?.slides.length ?? 0;

  return (
    <div ref={setNodeRef} style={style}>
      <div className="of-block">
        <span className="of-grip" {...attributes} {...listeners} aria-label="Drag to reorder"><IconGripVertical size={14} /></span>
        <div className="of-thumb">
          {first ? (
            <OpenFlowSlidePreview slide={first} actions={actions} />
          ) : (
            <div className={`of-thumb-ph of-k-bg-${block.type}`}><span>{block.name}</span></div>
          )}
          {slideCount > 1 ? <span className="of-thumb-cnt">{slideCount}</span> : null}
        </div>
        <button type="button" className="of-block-body" onClick={onToggle} aria-expanded={expanded}>
          <div className="of-bname">
            <span className={`of-kdot of-k-${block.type}`} />
            <span className="nm">{block.name}</span>
            {slideCount > 0 ? <IconChevronDown size={14} className="of-chev" style={{ transform: expanded ? "rotate(180deg)" : undefined }} /> : null}
          </div>
          <div className="of-chips">
            {(h?.chips ?? block.items).map((c, i) => <span key={i} className={`of-chip${block.type === "scripture" ? " gold" : ""}`}>{c}</span>)}
            {(h?.missing ?? []).map((c, i) => <span key={`m${i}`} className="of-chip miss">{c} — not in library</span>)}
          </div>
        </button>
        <div className="of-eb-dur"><span className="d">{fmtDur(block.durationMin)}</span><span className="s">{block.type}</span></div>
      </div>
      {expanded && slideCount > 0 ? (
        <div className="of-expand">
          <div className="of-expand-lbl">The {slideCount} slide{slideCount === 1 ? "" : "s"} this block creates</div>
          <div className="of-exgrid">
            {h!.slides.map((s, i) => <OpenFlowSlidePreview key={i} slide={s} actions={actions} textMinPx={8} />)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ServicePlanCard({ plan, actions }: { plan: ServicePlan; actions: OpenFlowActions }) {
  const [rows, setRows] = useState<Row[]>(() => plan.blocks.map((b, i) => ({ id: `b${i}`, block: b, h: null })));
  const [applying, setApplying] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // A stable signature of the plan CONTENT — so the hydrate effect fires once,
  // not on every streamed token (AIMessage re-parses a fresh plan object as the
  // trailing prose keeps arriving, which would otherwise re-hydrate repeatedly).
  const planKey = useMemo(
    () => JSON.stringify(plan.blocks.map((b) => [b.type, b.name, b.items])),
    [plan.blocks],
  );

  // Hydrate the plan into real slides (song lyrics, resolved verses) once.
  useEffect(() => {
    let cancelled = false;
    hydrateOpenFlowPlan(plan.blocks)
      .then((res) => {
        if (cancelled || !res.ok) return;
        setRows((prev) => prev.map((r) => ({ ...r, h: res.data![parseInt(r.id.slice(1), 10)] ?? null })));
      })
      .catch(() => { /* previews just stay as labels */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setRows((rs) => {
      const from = rs.findIndex((r) => r.id === active.id);
      const to = rs.findIndex((r) => r.id === over.id);
      return from < 0 || to < 0 ? rs : arrayMove(rs, from, to);
    });
  };

  const total = useMemo(() => rows.reduce((s, r) => s + r.block.durationMin, 0) || plan.totalMin, [rows, plan.totalMin]);

  const apply = async () => {
    setApplying(true);
    try {
      const res = await applyOpenFlowServicePlan(actions.planId, rows.map((r) => r.block));
      if (!res.ok) { toast.error(res.error || "Couldn't apply the plan."); return; }
      const { added, skipped } = res.data!;
      actions.onApplied();
      toast.success(skipped.length
        ? `Applied ${added} item${added === 1 ? "" : "s"}. Not in your library: ${skipped.join(", ")}`
        : `Service applied to playlist — ${added} item${added === 1 ? "" : "s"}`);
    } finally { setApplying(false); }
  };

  return (
    <div className="of-card">
      <div className="of-card-head"><h3>{plan.serviceType}</h3><span className="tag">Service plan</span></div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          {rows.map((r) => (
            <BlockRow key={r.id} row={r} actions={actions} expanded={expandedId === r.id} onToggle={() => setExpandedId((id) => (id === r.id ? null : r.id))} />
          ))}
        </SortableContext>
      </DndContext>
      <div className="of-total"><span className="lbl">Total estimate</span><span className="val">~{fmtDur(total)}</span></div>
      {plan.insights.length ? (
        <div className="of-insight"><IconBulb size={16} stroke={1.8} /><div>{plan.insights.map((t, i) => <p key={i}>{t}</p>)}</div></div>
      ) : null}
      <div className="of-card-actions">
        <button type="button" className="of-btn of-btn-primary" onClick={apply} disabled={applying}>
          <IconCheck size={15} stroke={2} />{applying ? "Applying…" : "Apply to Service"}
        </button>
        <button type="button" className="of-btn of-btn-ghost" onClick={() => actions.onSeedComposer("Adjust the plan: ")} disabled={applying}>Edit</button>
        <button type="button" className="of-btn of-btn-ghost" onClick={actions.onRegenerate} disabled={applying}><IconRefresh size={14} stroke={1.8} />Regenerate</button>
      </div>
    </div>
  );
}
