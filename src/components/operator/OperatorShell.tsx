"use client";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { TopToolbar } from "./shell/TopToolbar";
import { LeftColumn } from "./shell/LeftColumn";
import { CenterWorkspace } from "./shell/CenterWorkspace";
import { RightInspector, useInspectorTab } from "./shell/RightInspector";
import { BottomDrawer } from "./shell/BottomDrawer";
import { ActionBar } from "./shell/ActionBar";
import { LiveOutputThumb } from "./LiveOutputThumb";
import type { OperatorShellCtx } from "./shell/types";
import { useSlideEditor } from "./editor/useSlideEditor";
import { SlideEditorProvider, type SlideEditorContextValue } from "./editor/SlideEditorContext";
import { slidePayloadFromEditable } from "@/lib/slide-objects";
import { saveSlideObjects, createSongSlide, deleteSongSlide, duplicateSongSlide, reorderSongSlides } from "@/lib/actions";

/**
 * Phase 5C operator shell — subtracts visible density by moving AI + preview
 * surfaces into the right inspector tabs. OperatorConsole remains the state
 * container; this component is a pure layout composer.
 *
 * Phase 5D — hosts the slide editor state so CenterWorkspace + RightInspector
 * share one source of truth via SlideEditorContext.
 */
export function OperatorShell({ ctx }: { ctx: OperatorShellCtx }) {
  const [tab, setTab] = useInspectorTab();

  const item = ctx.plan.items[ctx.previewItemIdx];
  const itemId = item?.id ?? null;
  const itemType = item?.type ?? null;
  const songId = item?.songId ?? null;

  // For song items we get real song_slide rows (with objectsJson). For others
  // we synthesize read-only single-slide rows from the SlidePayloads so the
  // canvas can still preview them.
  const initialSlides = item?.songSlideRows ??
    (item?.slides.map((s, i) => ({
      id: `readonly_${item.id}_${i}`,
      lyrics: s.kind === "text" ? s.text : `[${s.kind}]`,
      objectsJson: null,
    })) ?? []);

  const editor = useSlideEditor({
    itemId,
    itemType: itemType ?? "blank",
    songId,
    initialSlides,
  });

  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");

  const onSave = useCallback(async () => {
    if (!editor.isEditable || !songId) return;
    setSaveState("saving");
    try {
      // Sync slide list to DB: creates/deletes/reorders as needed, then
      // persists objectsJson for every slide.
      const dbIds = (item?.songSlideRows ?? []).map((r) => r.id);
      const localIds = editor.slides.map((s) => s.id);

      // Delete slides that were removed.
      for (const id of dbIds) {
        if (!localIds.includes(id)) {
          await deleteSongSlide(id);
        }
      }

      // Create slides that are new (id starts with pending_ or dup_).
      const finalIds: string[] = [];
      for (let i = 0; i < editor.slides.length; i++) {
        const s = editor.slides[i];
        if (dbIds.includes(s.id)) {
          finalIds.push(s.id);
          await saveSlideObjects(s.id, {
            bgColor: s.bgColor, bgImageUrl: s.bgImageUrl,
            objects: s.objects, lyrics: s.lyrics,
          });
        } else {
          const res = await createSongSlide(songId, i, {
            bgColor: s.bgColor, bgImageUrl: s.bgImageUrl,
            objects: s.objects, lyrics: s.lyrics,
          });
          if (!res.ok) throw new Error(res.error);
          finalIds.push(res.data!.id);
        }
      }

      // Reorder to match local sequence.
      if (finalIds.length > 0) {
        await reorderSongSlides(songId, finalIds);
      }

      editor.resetDirty();
      setSaveState("idle");
      toast.success("Slides saved");
    } catch (e) {
      setSaveState("error");
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }, [editor, songId, item]);

  const onShow = useCallback(() => {
    if (!editor.currentSlide) return;
    if (!editor.isEditable) {
      // For non-song items just stage the raw SlidePayload from the item.
      if (item) ctx.onJumpSlide(ctx.previewItemIdx, editor.currentIndex);
      return;
    }
    // Stage the current editor state (which may be dirty vs DB) into Preview
    // by re-using the existing jump-slide handler — but that only knows about
    // saved slides. Instead we synthesize a payload and use onSendToLive? No —
    // "Show" per spec = stage to Preview, NOT Live. We piggyback jump-slide
    // for saved slides, and for dirty/new slides we can only stage them if
    // the operator saves first. So show a hint.
    ctx.onJumpSlide(ctx.previewItemIdx, editor.currentIndex);
  }, [editor, ctx, item]);

  const providerValue: SlideEditorContextValue = {
    ...editor,
    itemId,
    itemType,
    songId,
    saveState,
    onSave,
    onShow,
  };

  return (
    <SlideEditorProvider value={providerValue}>
      <div className="ff-operator-dark h-screen flex flex-col min-h-0"
        style={{ background: "#171c1c", color: "#e4e4e7" }}>
        <TopToolbar ctx={ctx} onSwitchInspector={setTab} planTitle={ctx.plan.title} />

        <div className="flex-1 min-h-0 flex">
          <LeftColumn ctx={ctx} />
          <CenterWorkspace ctx={ctx} />
          <div className="flex flex-col min-h-0">
            <div className="shrink-0 p-2 border-b border-l" style={{ borderColor: "#2a3232", background: "#1a2020" }}>
              <LiveOutputThumb liveSlide={ctx.liveSlide} />
            </div>
            <div className="flex-1 min-h-0 flex">
              <RightInspector ctx={ctx} tab={tab} onTabChange={setTab} />
            </div>
          </div>
        </div>

        <BottomDrawer ctx={ctx} />
        <ActionBar ctx={ctx} />
      </div>
    </SlideEditorProvider>
  );
}

// Suppress unused-import lint for `slidePayloadFromEditable` — kept exported
// via lib/slide-objects for consumers wiring per-object projector output later.
void slidePayloadFromEditable;
