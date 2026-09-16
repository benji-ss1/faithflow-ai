// Operator shell panel sizing (2026-09-16 Windows polish round 2). Pure.
import { LEFT_PANEL_MIN_WIDTH } from "@/components/operator/pro/operatorConstants";
import { isWindowsUA, rightPanelWidthFor } from "@/lib/platform";

/** Center column must keep at least this much room on small Windows screens. */
export const CENTER_MIN_WIDTH_WIN = 480;
/** Layers clear-cues rail (VerticalClearRail w-10) — counted conservatively. */
const RAIL_W = 40;

/**
 * Max width of the resizable left panel. Mac/other: floor(w*0.5), exactly the
 * original. Windows: also leaves the center >= CENTER_MIN_WIDTH_WIN so a width
 * saved on a big display can't crush the slide grid on a small laptop.
 */
export function leftPanelMaxWidth(viewportW: number, win: boolean = isWindowsUA()): number {
  const half = Math.floor(viewportW * 0.5);
  if (!win) return half;
  const room = viewportW - rightPanelWidthFor(viewportW, true) - RAIL_W - CENTER_MIN_WIDTH_WIN;
  return Math.max(LEFT_PANEL_MIN_WIDTH, Math.min(half, room));
}
