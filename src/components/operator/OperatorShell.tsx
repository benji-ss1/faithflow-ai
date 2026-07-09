"use client";
import { TopToolbar } from "./shell/TopToolbar";
import { LeftColumn } from "./shell/LeftColumn";
import { CenterWorkspace } from "./shell/CenterWorkspace";
import { RightInspector, useInspectorTab } from "./shell/RightInspector";
import { BottomDrawer } from "./shell/BottomDrawer";
import { ActionBar } from "./shell/ActionBar";
import type { OperatorShellCtx } from "./shell/types";

/**
 * Phase 5C operator shell — subtracts visible density by moving AI + preview
 * surfaces into the right inspector tabs. OperatorConsole remains the state
 * container; this component is a pure layout composer.
 */
export function OperatorShell({ ctx }: { ctx: OperatorShellCtx }) {
  const [tab, setTab] = useInspectorTab();
  return (
    <div className="ff-operator-dark h-screen flex flex-col min-h-0"
      style={{ background: "#171c1c", color: "#e4e4e7" }}>
      <TopToolbar ctx={ctx} onSwitchInspector={setTab} planTitle={ctx.plan.title} />

      <div className="flex-1 min-h-0 flex">
        <LeftColumn ctx={ctx} />
        <CenterWorkspace ctx={ctx} />
        <RightInspector ctx={ctx} tab={tab} onTabChange={setTab} />
      </div>

      <BottomDrawer ctx={ctx} />
      <ActionBar ctx={ctx} />
    </div>
  );
}
