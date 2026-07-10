"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { UseSlideEditorReturn } from "./useSlideEditor";

type SaveState = "idle" | "saving" | "error";

export type SlideEditorContextValue = UseSlideEditorReturn & {
  itemId: string | null;
  itemType: "song" | "scripture" | "media" | "sermon" | "blank" | "logo" | null;
  songId: string | null;
  saveState: SaveState;
  onSave: () => void;
  onShow: () => void;
};

const Ctx = createContext<SlideEditorContextValue | null>(null);

export function SlideEditorProvider({ value, children }: { value: SlideEditorContextValue; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSlideEditorCtx(): SlideEditorContextValue | null {
  return useContext(Ctx);
}
