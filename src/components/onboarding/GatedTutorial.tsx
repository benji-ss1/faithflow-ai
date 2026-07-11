"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Lock, CheckCircle2, ArrowRight, PlayCircle,
  LayoutDashboard, ListOrdered, Music, BookOpen, Presentation, Image as ImageIcon,
  Monitor, Radio, Mic, Sparkles, ShieldAlert, Archive,
} from "lucide-react";

/**
 * 12-channel gated tutorial with bubble cards. Each channel:
 *   - is locked until the previous is confirmed
 *   - explains WHAT it is and WHY it matters
 *   - has one clear "Try it" action (link or button)
 *   - reserves a slot for an AI walkthrough video
 *
 * Progress persists in localStorage per user browser. No server round-trip
 * during tutorial — deliberate: volunteers may take this at home before Sunday.
 */
type Channel = {
  key: string;
  icon: typeof LayoutDashboard;
  title: string;      // WHAT
  why: string;        // WHY (1-2 sentences)
  action: { label: string; href?: string; instruction: string };
  video?: string;     // slot label for future AI walkthrough
};

const CHANNELS: Channel[] = [
  { key: "dashboard", icon: LayoutDashboard, title: "Dashboard",
    why: "Your home base. Shows recent service plans, quick actions, and system health. Whenever you're lost, click the FaithFlow logo to come back here.",
    action: { label: "Open Dashboard", href: "/dashboard", instruction: "Click open in a new tab, then return here and mark done." },
    video: "AI walkthrough: dashboard tour" },

  { key: "services", icon: ListOrdered, title: "Service plans",
    why: "A service plan is the ordered list of items your service will run through — songs, scripture, sermon, prayer, blank moments. You'll create one per Sunday.",
    action: { label: "See existing plans", href: "/services", instruction: "Take a look at the demo plan there. You don't have to build one yet." } },

  { key: "songs", icon: Music, title: "Song library",
    why: "Your imported or manually-added songs live here with their slides. Lyrics for song content are church-owned or public-domain — no scraping. You add songs once, use them every Sunday.",
    action: { label: "Open Songs library", href: "/library/songs", instruction: "Click a song to see its slides. That's what a volunteer sees when they add it to a service." } },

  { key: "bible", icon: BookOpen, title: "Bible library",
    why: "Seven public-domain translations pre-loaded. When the AI hears a scripture reference (or you type one), FaithFlow generates slides from the selected translation.",
    action: { label: "Open Bible browser", href: "/library/bible", instruction: "Search 'John 3:16' — verse and neighbours appear instantly." } },

  { key: "sermon", icon: Presentation, title: "Sermon slides (PPTX)",
    why: "Upload a PowerPoint deck; FaithFlow converts each slide to a projector-ready image AND extracts speaker text for the AI to follow along. During service you either advance manually or let the sermon-follow AI do it.",
    action: { label: "See sermon imports", href: "/library/imports", instruction: "In production, drop a real .pptx here and watch it convert." } },

  { key: "media", icon: ImageIcon, title: "Media (images + video)",
    why: "Backgrounds, worship videos, announcement graphics. Everything uploaded here lives in your church's private storage bucket — nobody else can access it.",
    action: { label: "Open Media bin", href: "/library/media", instruction: "Uploads use presigned URLs — never round-trip through our server." } },

  { key: "projector", icon: Monitor, title: "Projector setup",
    why: "Before your first service, run this wizard so your Mac/PC knows which display is the projector. It saves the preset and tests the full pipeline with a real test pattern.",
    action: { label: "Run Projector wizard", href: "/setup/projector", instruction: "Even without a real projector connected, walk through the steps — the flow itself is educational." } },

  { key: "audio", icon: Mic, title: "Microphone / mixer setup",
    why: "Pick which mic FaithFlow's AI listens to. If your church uses a USB mixer feeding a laptop, this wizard finds it and shows a live meter so you can confirm signal.",
    action: { label: "Run Audio wizard", href: "/setup/audio", instruction: "Grant mic permission when Chrome asks, then watch the meter move as you speak." } },

  { key: "operator", icon: Radio, title: "Operator console",
    why: "The Sunday-morning cockpit. Left = library + playlist; center = slide canvas; right = output preview + AI tab; bottom = drawer + panic buttons. This is the ONE screen you'll spend the whole service on.",
    action: { label: "Open the Operator", href: "/services", instruction: "From /services pick a plan → click Operate. Everything else you learn hangs off this screen." },
    video: "AI walkthrough: operator layout" },

  { key: "ai", icon: Sparkles, title: "AI listening + modes",
    why: "The right inspector's AI tab. Four modes: Manual (off), Suggestion (default — you approve everything), Armed (autopilot loaded but paused), Active (auto-stages high-confidence scripture only). Song lyrics never auto-project regardless of mode.",
    action: { label: "Read the Autopilot section", href: "/help/first-sunday#autopilot", instruction: "Understand the difference between Armed and Active — the safety story matters." } },

  { key: "panic", icon: ShieldAlert, title: "Panic buttons",
    why: "BLANK, LOGO, KILL OUTPUT — three buttons that make the projector safe within one click. Practice them until they're muscle memory. Whatever is on the projector, these fix it.",
    action: { label: "Read Panic section", href: "/help/first-sunday#panic", instruction: "Also try them in Practice mode (/practice) with no real audience." } },

  { key: "archive", icon: Archive, title: "After the service",
    why: "Hit 'End service & archive' to snapshot everything — transcript, scripture list, slide timeline, sermon summary placeholder. Nothing you did during service is lost.",
    action: { label: "See existing archives", href: "/archive", instruction: "You'll come back here for the sermon summary AI to draft after service." } },
];

const STORAGE_KEY = "ff.tutorial.done";

export function GatedTutorial() {
  // Track which channels have been "confirmed understood"
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setDone(JSON.parse(raw));
    } catch { /* noop */ }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(done)); } catch { /* noop */ }
  }, [done, hydrated]);

  const firstUnlockedIdx = CHANNELS.findIndex((c) => !done[c.key]);
  const activeIdx = firstUnlockedIdx === -1 ? CHANNELS.length - 1 : firstUnlockedIdx;
  const completed = Object.values(done).filter(Boolean).length;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 border border-border rounded-full overflow-hidden bg-muted/40">
          <div
            className="h-full bg-brand transition-all"
            style={{ width: `${(completed / CHANNELS.length) * 100}%` }}
          />
        </div>
        <div className="text-xs font-mono text-muted-foreground w-16 text-right">
          {completed} / {CHANNELS.length}
        </div>
      </div>

      <div className="space-y-3">
        {CHANNELS.map((c, i) => {
          const unlocked = i <= activeIdx;
          const isDone = !!done[c.key];
          const active = i === activeIdx && !isDone;
          return (
            <ChannelCard key={c.key} channel={c}
              locked={!unlocked} done={isDone} active={active}
              onConfirm={() => setDone((d) => ({ ...d, [c.key]: true }))}
              onReset={() => setDone((d) => { const n = { ...d }; delete n[c.key]; return n; })}
            />
          );
        })}
      </div>

      {completed === CHANNELS.length && (
        <div className="border border-success/40 bg-success/5 rounded-lg p-4 space-y-2">
          <div className="text-sm font-semibold text-success flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Tutorial complete
          </div>
          <p className="text-sm">
            Now for real practice: open <Link href="/practice" className="text-brand underline">/practice</Link> and
            run through a simulated service. Nothing goes to a real projector or persists.
          </p>
        </div>
      )}
    </div>
  );
}

function ChannelCard({ channel, locked, done, active, onConfirm, onReset }: {
  channel: Channel;
  locked: boolean; done: boolean; active: boolean;
  onConfirm: () => void; onReset: () => void;
}) {
  const Icon = channel.icon;
  return (
    <div className={`border rounded-lg p-4 transition-all ${
      locked ? "opacity-40 border-border" :
      done ? "border-success/40 bg-success/5" :
      active ? "border-brand shadow-sm bg-card" : "border-border"
    }`}>
      <div className="flex items-start gap-3">
        <div className={`shrink-0 w-10 h-10 rounded-md border flex items-center justify-center ${
          locked ? "border-border text-muted-foreground" :
          done ? "border-success text-success" :
          "border-brand text-brand"
        }`}>
          {locked ? <Lock className="w-4 h-4" /> :
           done ? <CheckCircle2 className="w-4 h-4" /> :
           <Icon className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold flex items-center gap-2">
            {channel.title}
            {locked && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Locked</span>}
            {done && <span className="text-[10px] uppercase tracking-wider text-success">Done</span>}
          </div>

          {(active || done) && (
            <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {channel.why}
            </div>
          )}

          {active && (
            <div className="mt-3 space-y-2">
              <div className="text-xs">
                <strong>Try it:</strong> {channel.action.instruction}
              </div>
              {channel.action.href && (
                <Link href={channel.action.href} target="_blank"
                  className="inline-flex items-center gap-1 h-8 px-3 text-xs border border-border rounded-md hover:bg-accent">
                  {channel.action.label} <ArrowRight className="w-3 h-3" />
                </Link>
              )}
              {channel.video && (
                <div className="border border-dashed border-border rounded-md p-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <PlayCircle className="w-3.5 h-3.5" /> Video coming soon: {channel.video}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button onClick={onConfirm}
                  className="h-8 px-3 text-xs bg-foreground text-background rounded-md font-semibold">
                  I understand — unlock next
                </button>
              </div>
            </div>
          )}

          {done && (
            <div className="mt-2 flex items-center gap-2">
              {channel.action.href && (
                <Link href={channel.action.href} className="text-xs text-brand underline">
                  Revisit
                </Link>
              )}
              <button onClick={onReset} className="text-xs text-muted-foreground underline">
                Redo
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
