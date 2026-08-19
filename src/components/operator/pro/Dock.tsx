"use client";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// macOS-style dock: icons magnify based on cursor proximity (adapted from the
// requested reference to this app's stack — no framer-motion, just a shared
// pointer-X + per-item distance falloff).

const DockCtx = createContext<{ mouseX: number | null; influence: number; maxScale: number }>({
  mouseX: null, influence: 90, maxScale: 1.6,
});

export function Dock({ children, className, influence = 90, maxScale = 1.6 }: {
  children: ReactNode;
  className?: string;
  influence?: number;
  maxScale?: number;
}) {
  const [mouseX, setMouseX] = useState<number | null>(null);
  return (
    <DockCtx.Provider value={{ mouseX, influence, maxScale }}>
      <div
        onPointerMove={(e) => setMouseX(e.clientX)}
        onPointerLeave={() => setMouseX(null)}
        className={cn(
          "inline-flex items-end gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)]/80 backdrop-blur-md px-3 py-2",
          className,
        )}
        style={{ boxShadow: "0 10px 30px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)" }}
      >
        {children}
      </div>
    </DockCtx.Provider>
  );
}

export function DockItem({ children, onClick, label, className }: {
  children: ReactNode;
  onClick?: () => void;
  label?: string;
  className?: string;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const { mouseX, influence, maxScale } = useContext(DockCtx);

  let scale = 1;
  if (mouseX !== null && ref.current) {
    const rect = ref.current.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const dist = Math.abs(mouseX - center);
    scale = 1 + (maxScale - 1) * Math.max(0, 1 - dist / influence);
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn("grid place-items-center h-11 w-11 rounded-xl text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]", className)}
      style={{ transform: `scale(${scale.toFixed(3)}) translateY(${((scale - 1) * -8).toFixed(1)}px)`, transformOrigin: "bottom", transition: "transform .12s ease-out" }}
    >
      {children}
    </button>
  );
}
