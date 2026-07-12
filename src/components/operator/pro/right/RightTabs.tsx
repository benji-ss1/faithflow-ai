"use client";
import * as Tabs from "@radix-ui/react-tabs";
import { Music, ScreenShare, Timer, Send, Layers, Zap } from "lucide-react";
import type { OperatorShellCtx } from "../../shell/types";
import { AudioTab } from "./tabs/AudioTab";
import { StageTab } from "./tabs/StageTab";
import { TimersTab } from "./tabs/TimersTab";
import { MessagesTab } from "./tabs/MessagesTab";
import { ThemesTab } from "./tabs/ThemesTab";
import { MacrosTab } from "./tabs/MacrosTab";
import { cn } from "@/lib/utils";

const TABS = [
  { v: "audio", Icon: Music, label: "Audio" },
  { v: "stage", Icon: ScreenShare, label: "Stage" },
  { v: "timers", Icon: Timer, label: "Timers" },
  { v: "messages", Icon: Send, label: "Messages" },
  { v: "themes", Icon: Layers, label: "Themes" },
  { v: "macros", Icon: Zap, label: "Macros" },
];

export function RightTabs({ ctx }: { ctx: OperatorShellCtx }) {
  return (
    <Tabs.Root defaultValue="stage" className="h-full flex flex-col">
      <Tabs.List className="flex border-b border-[var(--color-border)] overflow-x-auto shrink-0">
        {TABS.map(({ v, Icon, label }) => (
          <Tabs.Trigger
            key={v}
            value={v}
            title={label}
            className={cn(
              "flex-1 min-w-0 h-9 flex items-center justify-center text-[var(--color-muted-foreground)]",
              "data-[state=active]:text-[var(--color-foreground)] data-[state=active]:border-b-2 data-[state=active]:border-[var(--color-brand)]",
            )}
          >
            <Icon className="w-4 h-4" />
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 text-[12px]">
        <Tabs.Content value="audio"><AudioTab /></Tabs.Content>
        <Tabs.Content value="stage"><StageTab ctx={ctx} /></Tabs.Content>
        <Tabs.Content value="timers"><TimersTab /></Tabs.Content>
        <Tabs.Content value="messages"><MessagesTab /></Tabs.Content>
        <Tabs.Content value="themes"><ThemesTab /></Tabs.Content>
        <Tabs.Content value="macros"><MacrosTab /></Tabs.Content>
      </div>
    </Tabs.Root>
  );
}
