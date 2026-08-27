"use client";
import * as Tabs from "@radix-ui/react-tabs";
import { Music, ScreenShare, Timer, Send, Layers, Zap } from "lucide-react";
import type { OperatorShellCtx } from "../../shell/types";
import type { TimerApi, MessagesApi } from "../hooks";
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

export function RightTabs({
  ctx, timer, messages,
}: {
  ctx: OperatorShellCtx;
  timer: TimerApi;
  messages: MessagesApi;
}) {
  return (
    <Tabs.Root defaultValue="stage" className="h-full flex flex-col">
      <Tabs.List className="flex border-b border-[var(--color-border)] bg-[linear-gradient(180deg,var(--color-panel),transparent)] overflow-x-auto shrink-0">
        {TABS.map(({ v, Icon, label }) => (
          <Tabs.Trigger
            key={v}
            value={v}
            title={label}
            className={cn(
              "group/rt relative flex-1 min-w-0 h-10 flex items-center justify-center text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)]",
              "data-[state=active]:text-[var(--color-brand)]",
              "after:absolute after:bottom-0 after:left-1/2 after:-translate-x-1/2 after:h-[2.5px] after:w-0 after:rounded-full after:bg-[var(--color-brand)] after:shadow-[0_0_8px_var(--color-glow)] after:transition-[width] after:duration-200 data-[state=active]:after:w-2/3",
            )}
          >
            <Icon className="w-[18px] h-[18px] transition-transform duration-200 [transition-timing-function:var(--ease-spring)] group-data-[state=active]/rt:scale-110" strokeWidth={2.2} />
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 text-[12px]">
        <Tabs.Content value="audio"><AudioTab /></Tabs.Content>
        <Tabs.Content value="stage"><StageTab ctx={ctx} /></Tabs.Content>
        <Tabs.Content value="timers"><TimersTab api={timer} /></Tabs.Content>
        <Tabs.Content value="messages"><MessagesTab api={messages} /></Tabs.Content>
        <Tabs.Content value="themes"><ThemesTab /></Tabs.Content>
        <Tabs.Content value="macros"><MacrosTab /></Tabs.Content>
      </div>
    </Tabs.Root>
  );
}
