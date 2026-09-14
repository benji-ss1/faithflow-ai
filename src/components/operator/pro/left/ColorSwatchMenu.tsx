"use client";
import type { ComponentType } from "react";
import { Check } from "lucide-react";
import { SECTION_COLORS } from "./sectionColors";

// One shared swatch-menu body used by all three colour menus on the left rail
// (Wave 3 dedup): the Library-row context menu + kebab, and the Playlist
// section-header kebab + context menu. Radix `ContextMenu` and `DropdownMenu`
// expose the same `.Item` / `.Separator` shape, so the caller passes whichever
// namespace it is rendering inside and we stay primitive-agnostic. Uses the
// lucide <Check> component (no literal ✓ glyph) per the icon-components rule.
type MenuItemProps = {
  onSelect?: (e: Event) => void;
  className?: string;
  children?: React.ReactNode;
};
export type SwatchMenuPrimitives = {
  Item: ComponentType<MenuItemProps>;
  Separator: ComponentType<{ className?: string }>;
};

const ITEM_CLS = "px-3 py-1.5 min-h-[28px] rounded hover:bg-[var(--color-panel)] outline-none cursor-pointer flex items-center gap-2";

export function ColorSwatchItems({
  menu,
  current,
  onPick,
  includeNoLabel = false,
}: {
  menu: SwatchMenuPrimitives;
  /** The currently-selected colour (#rrggbb) or null/undefined for "no label". */
  current?: string | null;
  /** Pick a colour, or null to clear the label (only reachable when includeNoLabel). */
  onPick: (color: string | null) => void;
  /** Show the trailing "No label" (clear) row — used by Library labels. */
  includeNoLabel?: boolean;
}) {
  const Item = menu.Item;
  const Separator = menu.Separator;
  const norm = (current ?? "").toLowerCase();
  return (
    <>
      {SECTION_COLORS.map((c) => (
        <Item key={c.value} onSelect={() => onPick(c.value)} className={ITEM_CLS}>
          <span className="w-3 h-3 rounded-full shrink-0" style={{ background: c.value }} />
          <span>{c.name}</span>
          {norm === c.value.toLowerCase() && <Check className="ml-auto w-3.5 h-3.5 text-[var(--color-brand)]" />}
        </Item>
      ))}
      {includeNoLabel && (
        <>
          <Separator className="h-px my-1 bg-[var(--color-border)]" />
          <Item onSelect={() => onPick(null)} className={ITEM_CLS}>
            <span className="w-3 h-3 rounded-full shrink-0 border border-[var(--color-border)]" />
            <span>No label</span>
            {!current && <Check className="ml-auto w-3.5 h-3.5 text-[var(--color-brand)]" />}
          </Item>
        </>
      )}
    </>
  );
}
