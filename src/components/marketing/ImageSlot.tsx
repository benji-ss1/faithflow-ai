import type { CSSProperties } from "react";

/**
 * Styled placeholder box standing in for a design-tool <image-slot>.
 * No real image — shows the placeholder text centered in muted mono type,
 * like a "drop screenshot here" slot. Fills its (already sized) parent.
 */
export default function ImageSlot({ placeholder }: { placeholder: string }) {
  const style: CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: "18px",
    background:
      "repeating-linear-gradient(135deg,rgba(255,255,255,.015) 0 12px,rgba(255,255,255,0) 12px 24px), #0E0E10",
    color: "var(--faint)",
    font: "500 11px 'JetBrains Mono', ui-monospace, monospace",
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    lineHeight: 1.5,
  };
  return (
    <div style={style}>
      <span>{placeholder}</span>
    </div>
  );
}
