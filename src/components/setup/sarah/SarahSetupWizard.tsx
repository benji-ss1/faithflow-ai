"use client";

/**
 * Sarah — AI audio setup wizard (Audio Lock-In, 2026-09-15; hardened after the 7-agent gate).
 *
 * Flow: context (beta application / start fresh) → computer → desk → ways to
 * connect → do the steps → pick input (+ auto-spot channel) → quiet check →
 * voice check → save → success. Back works everywhere; Sarah's chat is always open.
 *
 * Pass/fail comes ONLY from audioDiagnostics. Sarah (Groq, /api/ai/audio-guide)
 * explains and converses, grounded on server-side knowledge; without a key/entitlement
 * she falls back to scripted guidance. Never starts live capture — meters come from
 * the read-only level probe. All timers are cancelled on Back/unmount and every
 * long-running step is guarded by a run id so a stale timer can't score the wrong device.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import s from "./sarah.module.css";
import { SarahAvatar, type SarahMood } from "./SarahAvatar";
import { SarahShader } from "./SarahShader";
import { SarahSuccess } from "./SarahSuccess";
import { SarahSpotlight } from "./SarahSpotlight";
import { topWatchNote } from "@/lib/audio/sarahWatchers";
import { NATIVE_AUDIO_INPUT_CHANGED_EVENT, readNativeDevicePref } from "@/lib/audio/nativeDeviceStore";
import { listSetupDevices, useLevelFeed, type SetupDevice } from "./useLevelFeed";
import type { ApplicationMatch } from "@/lib/audio/applicationMatch";
import { rankConnections, type Connection, type ConnectionOption, type Os } from "@/lib/audio/connectionPlans";
import { checkNoiseFloor, checkSpeech, detectActiveChannels, levelBand, overallStatus, type DiagnosticCheck } from "@/lib/audio/audioDiagnostics";
import { saveWorkingDevice, listSavedDevices } from "@/lib/audio/savedAudioDevices";
import { writeNativeDevicePref, type NativeDeviceMode } from "@/lib/audio/nativeDeviceStore";

type Phase = "loading" | "context" | "os" | "desk" | "connection" | "steps" | "input" | "quiet" | "speak" | "save" | "tryit";
const PROGRESS: Phase[] = ["context", "os", "desk", "connection", "steps", "input", "quiet", "speak", "save", "tryit"];

type Msg = { id: number; role: "sarah" | "user"; text: string };
type Profile = {
  desk?: string; os?: Os; connection?: Connection; mixType?: "main" | "aux" | "unsure";
  failedRoutes?: { connection: string; reason: string; at: number }[];
  corrections?: { field: string; from?: string; to: string; at: number }[];
  completedAt?: number;
};
type Opt = { label: string; sub?: string; onPick: () => void; selected?: boolean; warn?: boolean; disabled?: boolean };

const DESK_BRANDS = ["Behringer / Midas", "Yamaha", "Allen & Heath", "Soundcraft", "PreSonus"];
const DESKS = [
  { label: "Behringer / Midas", sub: "X32, M32, Wing" },
  { label: "Yamaha", sub: "TF, DM3, QL/CL" },
  { label: "Allen & Heath", sub: "SQ, Qu, dLive" },
  { label: "Soundcraft", sub: "Ui24R, Si" },
  { label: "PreSonus", sub: "StudioLive" },
  { label: "Small analog desk", sub: "Xenyx, MG, ProFX" },
  { label: "No desk / not sure", sub: "We'll find a way" },
];

const FIX: Record<string, string> = {
  signal: "Nothing is coming through yet. Check the cable is in, the send on the desk is turned up and not muted, you've picked the right input here, and (on a Mac) that PresentFlow is allowed to use the microphone.",
  "noise-floor": "I can hear a hum. Check nothing is playing, then plug this computer into the same power socket as the sound desk. Still humming? Tap “Ask Sarah” and I'll take you through the cable fix.",
  "speech-level-low": "That's too quiet for me. Turn up the send on the desk — the one feeding this computer — until talking reaches the green “Good” part of the bar.",
  "speech-level-hot": "That's too loud — it'll distort. Turn the send down a little, or press the pad button on your interface.",
  clipping: "It's crackling — the sound is too strong. Turn the send down, or press the pad button on your interface.",
};
const OS_LABEL: Record<Os, string> = { mac: "macOS", windows: "Windows" };
const deviceToOs = (d?: string): Os | undefined => (/mac/i.test(d ?? "") ? "mac" : /windows|pc/i.test(d ?? "") ? "windows" : undefined);
const nextId = (() => { let i = 0; return () => ++i; })();
const QUIET_MS = 8000;
const SPEAK_MS = 10000;
/** Enough clean speech to judge a level — we pass early rather than run the full timer. */
const SPEAK_MIN_MS = 3500;
const SPEAK_MIN_FRAMES = 60; // ≈3s at the native 20 Hz probe rate
const SPOT_MS = 6500;
const AI_TIMEOUT_MS = 12000;

export type SarahLive = {
  listening: boolean;
  ready?: boolean;
  transcript?: string;
  interim?: string;
  /** Scripture detections from the live engine (shape kept loose on purpose). */
  suggestions?: { id?: string; reference?: string }[];
  onListen?: () => void;
  noAudioSignal?: boolean;
  clipping?: boolean;
  reconnectAttempts?: number;
  reconnectFailed?: boolean;
  audioQuality?: "good" | "ok" | "low";
};

type Coach = "audio-panel" | "ai-pill" | "live-preview";

export function SarahSetupWizard({ onDone, live, onCoachChange }: { onDone?: () => void; live?: SarahLive; onCoachChange?: (coaching: boolean) => void } = {}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [trail, setTrail] = useState<Phase[]>([]);
  const [mood, setMood] = useState<SarahMood>("think");
  const [status, setStatus] = useState("Sarah is getting ready");
  const [typing, setTyping] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [extraChips, setExtraChips] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [match, setMatch] = useState<ApplicationMatch | null>(null);
  const [useApp, setUseApp] = useState(true);
  const [profile, setProfile] = useState<Profile>({});
  const [editingFromApp, setEditingFromApp] = useState(false);
  const [chosen, setChosen] = useState<ConnectionOption | null>(null);
  const [doneSteps, setDoneSteps] = useState<Set<number>>(new Set());
  const [devices, setDevices] = useState<SetupDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [device, setDevice] = useState<SetupDevice | null>(null);
  const [channels, setChannels] = useState<number[]>([]);
  const [checks, setChecks] = useState<DiagnosticCheck[]>([]);
  const [measuring, setMeasuring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiOffline, setAiOffline] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  // Coach mode: Sarah steps out of her panel and spotlights the REAL app.
  const [coach, setCoach] = useState<Coach | null>(null);
  const [coachPick, setCoachPick] = useState<string | null>(null);
  const [coachWin, setCoachWin] = useState<string | null>(null);
  const inputEnteredAt = useRef<number>(0);
  const [lastDevice, setLastDevice] = useState<string | null>(null);
  // Returning operator re-checking a known-good setup: skip the quiet-room step.
  const [quickCheck, setQuickCheck] = useState(false);
  // Typing is the exception, not the default: most steps are a straight choice, so the
  // box only appears where an answer must be typed (desk model) or they ask for it.
  const [forceType, setForceType] = useState(false);
  const feed = useLevelFeed();
  const logRef = useRef<HTMLDivElement | null>(null);

  // refs that keep callbacks/timers honest
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const runId = useRef(0);
  const phaseRef = useRef<Phase>("loading");
  const profileRef = useRef<Profile>({});
  const msgsRef = useRef<Msg[]>([]);
  const checksRef = useRef<DiagnosticCheck[]>([]);
  const deviceRef = useRef<SetupDevice | null>(null);
  const channelsRef = useRef<number[]>([]);
  const finishedRef = useRef(false);
  phaseRef.current = phase; profileRef.current = profile; msgsRef.current = msgs;
  checksRef.current = checks; deviceRef.current = device; channelsRef.current = channels;

  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => { timers.current.delete(id); fn(); }, ms);
    timers.current.add(id);
    return id;
  }, []);
  const clearTimers = useCallback(() => { for (const id of timers.current) clearTimeout(id); timers.current.clear(); }, []);
  useEffect(() => () => { clearTimers(); }, [clearTimers]);

  const say = useCallback((text: string, m?: SarahMood, st?: string) => {
    setMsgs((x) => [...x, { id: nextId(), role: "sarah", text }]);
    if (m) setMood(m);
    if (st) setStatus(st);
  }, []);
  const saySoon = useCallback((text: string, m: SarahMood, st: string, ms = 650) => {
    setTyping(true); setMood("think"); setStatus("Sarah is thinking");
    later(() => { setTyping(false); say(text, m, st); }, ms);
  }, [say, later]);
  const userSays = useCallback((text: string) => setMsgs((x) => [...x, { id: nextId(), role: "user", text }]), []);

  useEffect(() => { logRef.current?.scrollTo({ top: 1e6 }); }, [msgs, typing]);

  const saveProfile = useCallback(async (p: Profile) => {
    try {
      await fetch("/api/audio-setup/context", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: p, confirmedApplicationId: useApp ? match?.applicationId ?? null : null }),
      });
    } catch { /* non-blocking */ }
  }, [match, useApp]);

  /** Any phase change cancels in-flight timers and invalidates their run id. */
  const go = useCallback((next: Phase) => {
    clearTimers(); runId.current += 1; setMeasuring(false); setBusy(false); setForceType(false);
    setTrail((t) => [...t, phaseRef.current]);
    setPhase(next); setExtraChips([]);
  }, [clearTimers]);

  const back = useCallback(() => {
    clearTimers(); runId.current += 1; setMeasuring(false); setBusy(false);
    const from = phaseRef.current;
    if (from === "input" || from === "quiet" || from === "speak") void feed.stop();
    setTrail((t) => {
      if (!t.length) return t;
      setPhase(t[t.length - 1]);
      return t.slice(0, -1);
    });
    setExtraChips([]); setChecks([]); setMood("nod"); setStatus("Going back");
  }, [clearTimers, feed]);

  const setField = useCallback(<K extends keyof Profile>(field: K, value: Profile[K]) => {
    setProfile((p) => {
      const prevVal = p[field] as string | undefined;
      const corr = prevVal && value && prevVal !== value
        ? [...(p.corrections ?? []), { field: String(field), from: prevVal, to: String(value), at: Date.now() }]
        : p.corrections;
      return { ...p, [field]: value, corrections: corr };
    });
  }, []);

  const enter = useCallback((p: Phase, prof: Profile) => {
    if (p === "os") saySoon("First — is this a Mac or a Windows computer?", "listen", "Sarah is listening");
    if (p === "desk") saySoon("Which sound desk does your church use? Tap one, or type the model below.", "listen", "Sarah is listening");
    if (p === "connection") {
      const n = rankConnections({ desk: prof.desk, os: prof.os, failedRoutes: prof.failedRoutes }).filter((o) => o.connection !== "builtin").length;
      saySoon(`For ${prof.desk || "your setup"}${prof.os ? ` on ${OS_LABEL[prof.os]}` : ""}, churches usually connect one of these ${n} ways. Pick the one you have — you can always come back and try another.`, "think", "Sarah is thinking");
    }
    if (p === "input") {
      inputEnteredAt.current = Date.now();
      if (onDone) {
        // Inside the desktop app: open the real Audio panel and coach them through it,
        // so they learn where it lives — not a Sarah-only copy of it.
        setCoachPick(null);
        window.dispatchEvent(new CustomEvent("presentflow:open-hardware", { detail: { panel: "audio" } }));
        setCoach("audio-panel");
      } else {
        saySoon("Now pick where the sound comes in — the most likely one is first.", "focus", "Sarah is checking your inputs");
      }
    }
    if (p === "quiet") saySoon("Quick quiet check. Ask everyone to stop talking and stop the music, then start it — I'll listen for 8 seconds for hum.", "listen", "Sarah is listening");
    if (p === "speak") saySoon("Now talk into the preacher's mic like it's a normal Sunday — try reading John 3:16. I'm watching the bar.", "listen", "Sarah is listening");
  }, [saySoon]);

  const goTo = useCallback((p: Phase, prof?: Profile) => { go(p); enter(p, prof ?? profileRef.current); }, [go, enter]);

  // ── load context ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let m: ApplicationMatch | null = null; let saved: Profile = {};
      try {
        const res = await fetch("/api/audio-setup/context", { cache: "no-store" });
        const j = await res.json();
        if (j?.ok) { m = j.data.match; saved = j.data.profile ?? {}; }
      } catch { /* start fresh */ }
      if (cancelled) return;
      setMatch(m); setProfile(saved); setPhase("context");
      const st = m?.setup;
      // What we remembered on THIS computer last time (device + channel), so a
      // repeat visit starts from "here's what worked" rather than question one.
      const savedDevice = listSavedDevices().find((d) => d.role === "primary");
      setLastDevice(savedDevice ? `${savedDevice.name}${savedDevice.selectedChannels.length ? ` · channel ${savedDevice.selectedChannels.map((c) => c + 1).join(" & ")}` : ""}` : null);
      if (savedDevice || saved.desk || saved.connection) {
        const how = saved.connection ? rankConnections({ desk: saved.desk, os: saved.os }).find((o) => o.connection === saved.connection)?.title : undefined;
        const bits = [how ? how.toLowerCase() : undefined, savedDevice?.name ? `into ${savedDevice.name}` : undefined].filter(Boolean).join(", ");
        say(`Welcome back — I'm Sarah. Last time your sound came in ${bits || "using this computer's saved setup"}${savedDevice?.selectedChannels.length ? ` on channel ${savedDevice.selectedChannels.map((c) => c + 1).join(" & ")}` : ""}. Shall I just check that still works?`, "nod", "Sarah remembers your setup");
      } else if (m?.confidence === "high") {
        say(`Hi, I'm Sarah — I'll get your sound connected. Your application says you use ${st?.desk ?? "a sound desk"}${st?.device ? ` on ${st.device}` : ""}. Is that still right?`, "ooh", "Sarah found your application");
      } else if (m?.confidence === "possible") {
        say(`Hi, I'm Sarah. I may have found your church's application (${st?.churchName ?? "unknown"}), but I'm not sure it's yours — so I'll ask you everything fresh. Ready?`, "think", "Sarah is checking");
      } else {
        say("Hi, I'm Sarah. I'll help you connect your church's sound. It takes about 3 minutes. Ready?", "neutral", "Sarah is ready");
      }
    })();
    return () => { cancelled = true; };
  }, [say]);

  // ── device list when entering input ──
  const loadDevices = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingDevices(true);
    const list = await listSetupDevices({ probe: !quiet });
    const want: Record<string, string[]> = {
      "usb-desk": ["desk", "interface"], interface: ["interface", "desk"], ndi: ["ndi"], dante: ["dante"],
      "sdi-capture": ["sdi-capture", "usb-switcher", "hdmi-capture"],
    };
    const pref = want[profileRef.current.connection ?? ""] ?? [];
    const rank = (d: SetupDevice) => { const i = pref.indexOf(d.kind.kind); return i === -1 ? (d.kind.recommended ? 10 : 20) : i; };
    setDevices([...list].sort((a, b) => rank(a) - rank(b)));
    if (!quiet) setLoadingDevices(false);
    if (list.length === 0 && !quiet) {
      say("I can't see any audio inputs at all. Check the cable, then tap “Look again”.", "focus", "Sarah can't find inputs");
      setExtraChips(["Look again", "Try another way"]);
    }
  }, [say]);
  useEffect(() => { if (phase === "input") void loadDevices(); }, [phase, loadDevices]);

  const pickDevice = useCallback(async (d: SetupDevice) => {
    if (busy) return;
    // The desktop helper has ONE capture slot: while AI listening is running it
    // reports levels for the LIVE input no matter which device we asked for, so a
    // check here would measure — and then save — the wrong thing.
    if (live?.listening) {
      userSays(d.name);
      saySoon("AI listening is running, so I'd end up measuring that input instead of this one. Turn listening off and I'll test it properly.", "focus", "Sarah needs listening off");
      setExtraChips(live?.onListen ? ["Turn off AI listening"] : []);
      return;
    }
    setBusy(true);
    const my = ++runId.current;
    userSays(d.name);
    setDevice(d); setChannels([]); feed.setChannels(null);
    const res = await feed.start(d);
    if (runId.current !== my) return;
    setBusy(false);
    if (!res.ok) {
      if (res.error === "superseded") return;
      saySoon(res.error ?? "I couldn't open that input.", "focus", "Sarah hit a snag");
      setExtraChips(["Try again", "Look again", "Try another way"]);
      return;
    }
    if (d.channelCount > 2) {
      saySoon(`That's a ${d.kind.label.toLowerCase()} with ${d.channelCount} channels. Talk into the pastor's mic — I'll spot which channel is moving.`, "listen", "Sarah is watching the channels");
      setMeasuring(true);
      later(() => {
        if (runId.current !== my) return;
        const found = detectActiveChannels(feed.snapshotHistory());
        setMeasuring(false);
        if (found.length) {
          setChannels(found); feed.setChannels(found);
          say(`Found it — channel${found.length > 1 ? "s" : ""} ${found.map((c) => c + 1).join(" & ")}.`, "ooh", "Sarah found your channel");
          setExtraChips(["Continue"]);
        } else {
          say("I didn't see any channel move. Is someone talking into the mic, and is the desk sending to USB? Tap “Try again” when you're ready, or tap the channel yourself below.", "focus", "Sarah is checking");
          setExtraChips(["Try again", "Try another way"]);
        }
      }, SPOT_MS);
    } else {
      saySoon(`${d.kind.label} selected. ${d.kind.hint}`, "nod", "Sarah is ready for the check");
      setExtraChips(["Continue"]);
    }
  }, [busy, feed, later, say, saySoon, userSays]);

  const measure = useCallback((kind: "quiet" | "speak") => {
    if (measuring) return;
    const my = ++runId.current;
    feed.resetFrames(); setMeasuring(true); setChecks([]); setExtraChips([]);
    setMood("listen"); setStatus(kind === "quiet" ? "Sarah is listening to the room" : "Sarah is listening");

    // Voice check: as soon as there IS enough good speech, say so and move on —
    // don't make someone keep talking to a timer (2026-09-16 owner directive).
    const finish = (frames: { db: number; peak: number }[]) => {
      if (runId.current !== my) return;
      setMeasuring(false);
      const result = kind === "quiet" ? [checkNoiseFloor(frames)] : checkSpeech(frames);
      setChecks(result);
      const overall = overallStatus(result);
      if (overall === "pass") {
        if (kind === "quiet") { say("Nice and quiet — no hum.", "nod", "Quiet check passed"); setExtraChips(["Continue"]); }
        else { say("I can hear you clearly — good level, no crackle. That's your sound sorted.", "ooh", "Voice check passed"); setExtraChips(["Save my setup"]); }
        return;
      }
      const worst = result.find((c) => c.status === "fail") ?? result.find((c) => c.status === "warn")!;
      const key = worst.id === "speech-level" ? ((worst.value ?? -99) > -6 ? "speech-level-hot" : "speech-level-low") : worst.id;
      say(`${worst.detail} ${FIX[key] ?? ""}`.trim(), "focus", overall === "fail" ? "Sarah found a problem" : "Sarah has a tip");
      setExtraChips(overall === "fail" ? ["Test again", "Try another way", "Ask Sarah"] : ["Test again", "Continue anyway"]);
    };

    if (kind === "quiet") { later(() => finish(feed.snapshotFrames()), QUIET_MS); return; }

    // Poll from SPEAK_MIN_MS: the moment there's a solid run of good speech we stop
    // early and pass. Otherwise we still stop at SPEAK_MS and report what we heard.
    const started = Date.now();
    const tick = () => {
      if (runId.current !== my) return;
      const frames = feed.snapshotFrames();
      const elapsed = Date.now() - started;
      if (elapsed >= SPEAK_MIN_MS && frames.length >= SPEAK_MIN_FRAMES && overallStatus(checkSpeech(frames)) === "pass") { finish(frames); return; }
      if (elapsed >= SPEAK_MS) { finish(frames); return; }
      later(tick, 500);
    };
    later(tick, SPEAK_MIN_MS);
  }, [feed, later, measuring, say]);

  const recordFailure = useCallback((reason: string) => {
    const p = profileRef.current;
    if (!p.connection) return p;
    const next: Profile = { ...p, failedRoutes: [...(p.failedRoutes ?? []), { connection: p.connection, reason: reason.slice(0, 180), at: Date.now() }] };
    setProfile(next); void saveProfile(next);
    return next;
  }, [saveProfile]);

  const heardRef = useRef(false);
  const baselineRef = useRef<Set<string> | null>(null);
  const finish = useCallback(async () => {
    if (finishedRef.current) return;
    if (live?.listening && !window.confirm("Saving this input restarts AI listening for a moment. If a service is running right now, that's a short gap. Save anyway?")) return;
    finishedRef.current = true;
    setBusy(true);
    const d = deviceRef.current; const chs = channelsRef.current;
    let savedOk = true;
    if (d) {
      const mode: NativeDeviceMode = chs.length === 1 ? "mono" : chs.length === 2 ? "stereo" : "sum-all";
      savedOk = !!saveWorkingDevice({ uid: d.uid, name: d.name, transport: d.transport, channelCount: d.channelCount, mode, selectedChannels: chs, gainDb: 0, role: "primary" });
      if (d.source === "native" && d.index != null) {
        writeNativeDevicePref({ index: d.index, name: d.name, mode, selectedChannels: chs, gainDb: 0 });
      }
    }
    await feed.stop();
    const done: Profile = { ...profileRef.current, completedAt: Date.now() };
    setProfile(done); await saveProfile(done);
    if (!savedOk) say("Heads up: this browser wouldn't let me remember the device on this computer (storage is full or blocked). Your church setup is saved, but you may need to pick the input again next time.", "focus", "Saved with a warning");
    setMood("celebrate"); setStatus("Saved");
    // First win: prove the whole thing works end to end before we let them go.
    go("tryit");
    if (onDone) { setCoachWin(null); setCoach(live?.listening ? "live-preview" : "ai-pill"); }
    saySoon(
      live?.listening
        ? "Saved. Now the fun bit — say this out loud, just like on a Sunday: “Let's turn to John chapter three, verse sixteen.”"
        : "Saved. Now the fun bit. Switch AI listening on, then say out loud: “Let's turn to John chapter three, verse sixteen.”",
      "listen", "Sarah is listening for your first verse");
  }, [feed, saveProfile, say]);

  // First win — watch the REAL detection engine (read-only) and celebrate the
  // moment it catches a verse. This is the moment a church realises what the app does.
  useEffect(() => {
    if (phase !== "tryit" || heardRef.current) return;
    const current = live?.suggestions ?? [];
    // Snapshot what the console had already detected BEFORE this step, so an old
    // verse from earlier in the service can't be celebrated as "your first win".
    if (!baselineRef.current) { baselineRef.current = new Set(current.map((x, i) => x?.id ?? `${x?.reference ?? ""}#${i}`)); return; }
    const hit = current.find((x) => typeof x?.reference === "string" && x.reference.trim()
      && !baselineRef.current!.has(x?.id ?? `${x.reference}#${current.indexOf(x)}`));
    if (!hit) return;
    heardRef.current = true;
    say(`That's it — I heard ${hit.reference}. Your sound, the AI and PresentFlow are all working together.`, "celebrate", "It works!");
    setCoachWin(hit.reference ?? "your verse");
    setExtraChips(["Finish"]);
    setMood("celebrate");
  }, [phase, live?.suggestions, say]);

  useEffect(() => { onCoachChange?.(!!coach); }, [coach, onCoachChange]);
  // Keep the device list fresh while coaching (hotplug, NDI discovery) — quietly, with
  // no mic-permission probe and no repeated "can't see inputs" messages.
  useEffect(() => {
    if (!coach) return;
    const iv = setInterval(() => { void loadDevices(true); }, 3000);
    return () => clearInterval(iv);
  }, [coach, loadDevices]);

  // Held level + how long it has stayed silent: a gap between words is not "broken gear".
  const levelHist = useRef<{ t: number; db: number }[]>([]);
  const silentSince = useRef<number | null>(null);
  // An input must be missing on TWO polls in a row before Sarah calls it unplugged.
  const missingPolls = useRef(0);
  const coachStartedAt = useRef<number>(0);
  useEffect(() => { if (coach) coachStartedAt.current = coachStartedAt.current || Date.now(); else coachStartedAt.current = 0; }, [coach]);
  // Held level over ~6s + how long it has stayed silent.
  useEffect(() => {
    if (!coach) { levelHist.current = []; silentSince.current = null; return; }
    if (!feed.running) { levelHist.current = []; silentSince.current = null; return; }
    const now = Date.now();
    const peak = feed.levels.reduce((m, l) => Math.max(m, Math.abs(l.peak) || 0), 0);
    const db = peak > 0 ? 20 * Math.log10(peak) : -120;
    levelHist.current = [...levelHist.current, { t: now, db }].filter((x) => now - x.t < 6000);
    const held = Math.max(...levelHist.current.map((x) => x.db));
    silentSince.current = held <= -60 ? (silentSince.current ?? now) : null;
  }, [coach, feed.running, feed.levels]);
  // Count consecutive device polls where the chosen input is absent. An EMPTY list
  // counts as absent too (unplugging the only device).
  useEffect(() => {
    if (!coach) { missingPolls.current = 0; return; }
    const pref = readNativeDevicePref() as { name?: string; uid?: string } | null;
    const name = coachPick ?? device?.name ?? null;
    if (!name) { missingPolls.current = 0; return; }
    const found = (pref?.uid ? devices.some((d) => d.uid === pref.uid) : false) || devices.some((d) => d.name === name);
    missingPolls.current = found ? 0 : missingPolls.current + 1;
  }, [coach, devices, coachPick, device]);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!coach) return;
    const iv = setInterval(() => setTick((n) => n + 1), 1000); // lets time-based watchers advance
    return () => clearInterval(iv);
  }, [coach]);

  // While coaching the Audio panel, notice the moment they pick an input there.
  const [coachPickId, setCoachPickId] = useState<string | null>(null);
  useEffect(() => {
    if (coach !== "audio-panel") return;
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ name?: string; deviceId?: string; label?: string } | null>).detail;
      const pref = readNativeDevicePref();
      const name = pref?.name ?? detail?.label ?? detail?.name ?? null;
      if (name) setCoachPick(name);
      setCoachPickId(detail?.deviceId ?? null);
    };
    window.addEventListener(NATIVE_AUDIO_INPUT_CHANGED_EVENT, onChanged);
    window.addEventListener("presentflow:audio-input-changed", onChanged);
    return () => {
      window.removeEventListener(NATIVE_AUDIO_INPUT_CHANGED_EVENT, onChanged);
      window.removeEventListener("presentflow:audio-input-changed", onChanged);
    };
  }, [coach]);

  // First win: once listening is on, glide from the AI switch to the live preview.
  useEffect(() => {
    if (coach === "ai-pill" && live?.listening) setCoach("live-preview");
    else if (coach === "live-preview" && !live?.listening && !coachWin) setCoach("ai-pill");
  }, [coach, live?.listening, coachWin]);

  const endSetup = useCallback(() => {
    setCoach(null); void feed.stop(); clearTimers(); if (onDone) onDone();
  }, [feed, clearTimers, onDone]);
  const [audioPanelShown, setAudioPanelShown] = useState(true);

  const coachDone = useCallback(() => {
    // They picked in the real panel — match it (uid first, then deviceId, then name) and run the checks.
    const pref = readNativeDevicePref() as { name?: string; uid?: string } | null;
    const name = coachPick ?? null;
    setCoach(null);
    const d = (pref?.uid ? devices.find((x) => x.uid === pref.uid) : undefined)
      ?? (coachPickId ? devices.find((x) => x.deviceId === coachPickId) : undefined)
      ?? (name ? devices.find((x) => x.name === name) : undefined);
    if (d) { void pickDevice(d); return; }
    say("I couldn't tell which input you picked — choose it from my list here instead.", "focus", "Sarah is checking your inputs");
  }, [coachPick, coachPickId, devices, pickDevice, say]);

  // ── chat ──
  const ask = useCallback(async (text: string) => {
    const t = text.trim(); if (!t) return;
    userSays(t); setDraft(""); setTyping(true); setMood("think"); setStatus("Sarah is thinking");
    const history = msgsRef.current.slice(-8).map((m) => ({ role: m.role === "sarah" ? "assistant" : "user", content: m.text }));
    let answered = false;
    if (!aiOffline) {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
      try {
        const res = await fetch("/api/ai/audio-guide", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
          body: JSON.stringify({
            message: t, history,
            context: {
              step: phaseRef.current,
              setup: {
                desk: profileRef.current.desk, os: profileRef.current.os, connection: profileRef.current.connection, mixType: profileRef.current.mixType,
                deviceName: deviceRef.current?.name, deviceKind: deviceRef.current?.kind.kind, channel: channelsRef.current.map((c) => c + 1).join("/"),
              },
              diagnostics: checksRef.current.map((c) => ({ id: c.id, status: c.status, value: c.value })),
            },
          }),
        });
        const j = await res.json();
        if (j?.ok) {
          answered = true;
          const d = j.data as { reply: string; mood: SarahMood; suggestions: string[]; correction?: { field: string; to: string } };
          setTyping(false);
          say(d.reply, d.mood === "celebrate" ? "nod" : d.mood, "Sarah replied");
          if (d.suggestions?.length) setExtraChips(d.suggestions.slice(0, 3));
          if (d.correction) {
            const f = d.correction.field as keyof Profile;
            if (f === "desk" || f === "mixType" || f === "os" || f === "connection") {
              setField(f, d.correction.to as never);
              const next = { ...profileRef.current, [f]: d.correction.to } as Profile;
              void saveProfile(next);
              say(`I've updated your ${d.correction.field} to “${d.correction.to}” and saved it.`, "nod", "Profile updated");
            }
          }
        } else if (j?.code === "MISSING_API_KEY" || j?.code === "NOT_ENTITLED") setAiOffline(true);
      } catch { /* aborted, offline or bad JSON → fall back */ }
      clearTimeout(to);
    }
    if (!answered) {
      setTyping(false);
      const worst = checksRef.current.find((c) => c.status !== "pass");
      say(worst ? (FIX[worst.id] ?? worst.detail) : "I can't chat right now. Keep going with the steps on screen — the sound you send me needs the preacher's mic AND the band in it. If this way isn't working, tap “Try another way”.", "focus", "Sarah's tip");
    }
  }, [aiOffline, say, setField, userSays, saveProfile]);

  // ── options per phase ──
  const opts: Opt[] = useMemo(() => {
    const st = match?.setup;
    switch (phase) {
      case "context": {
        if (match && match.confidence !== "none" && useApp) {
          const applyApp = (): Profile => {
            const next: Profile = { ...profile, desk: profile.desk ?? st?.desk, os: profile.os ?? deviceToOs(st?.device) };
            setProfile(next);
            return next;
          };
          return match.confidence === "high"
            ? [
                { label: "Yes, that's right", sub: "Use my application", onPick: () => { userSays("Yes, that's right"); const n = applyApp(); setEditingFromApp(false); goTo(n.os ? "connection" : "os", n); } },
                { label: "Something's changed", sub: "I'll correct it", onPick: () => { userSays("Something's changed"); const n = applyApp(); setEditingFromApp(true); goTo("os", n); } },
                { label: "Start fresh", sub: "Ignore the application", onPick: () => { userSays("Start fresh"); setUseApp(false); setProfile({ failedRoutes: profile.failedRoutes }); setEditingFromApp(true); goTo("os", { failedRoutes: profile.failedRoutes }); } },
              ]
            : [
                { label: "Yes, that's us", onPick: () => { userSays("Yes, that's us"); setEditingFromApp(true); goTo("os"); } },
                { label: "No, start fresh", onPick: () => { userSays("No, start fresh"); setUseApp(false); setEditingFromApp(true); goTo("os"); } },
              ];
        }
        if (lastDevice || profile.desk || profile.connection) {
          return [
            { label: "Yes, check it", sub: lastDevice ?? undefined,
              onPick: () => { userSays("Yes, check it"); setQuickCheck(true); goTo(profile.connection ? "input" : "connection"); } },
            { label: "Something's changed", sub: "Set it up a different way", onPick: () => { userSays("Set it up fresh"); setProfile({ failedRoutes: profile.failedRoutes }); setEditingFromApp(true); goTo("os", { failedRoutes: profile.failedRoutes }); } },
          ];
        }
        return [{ label: "Let's go", sub: "About 3 minutes", onPick: () => { userSays("Let's go"); goTo("os"); } }];
      }
      case "os":
        return (["mac", "windows"] as Os[]).map((o) => ({
          label: o === "mac" ? "Mac" : "Windows", sub: o === "mac" ? "MacBook, iMac, Mac mini" : "PC or laptop", selected: profile.os === o,
          onPick: () => {
            userSays(o === "mac" ? "Mac" : "Windows"); setField("os", o);
            const next = { ...profile, os: o };
            // Editing (or nothing known yet) always visits the desk step.
            goTo(!editingFromApp && profile.desk ? "connection" : "desk", next);
          },
        }));
      case "desk":
        return DESKS.map((d) => ({
          label: d.label, sub: d.sub, selected: profile.desk === d.label || (!!profile.desk && d.label.startsWith(profile.desk.split(" ")[0])),
          onPick: () => {
            userSays(d.label);
            if (DESK_BRANDS.includes(d.label)) {
              setField("desk", d.label);
              say(`Which ${d.label} model? Type it below (e.g. ${d.sub}) — it helps me give exact steps. Or tap “Skip the model” to keep it general.`, "listen", "Sarah is listening");
              setExtraChips(["Skip the model"]);
              return;
            }
            const desk = d.label.startsWith("No desk") ? undefined : d.label;
            setField("desk", desk); goTo("connection", { ...profile, desk });
          },
        }));
      case "connection":
        return rankConnections({ desk: profile.desk, os: profile.os, failedRoutes: profile.failedRoutes }).map((o, i): Opt => ({
          label: `${o.connection === "builtin" ? "Last resort · " : `${i + 1}. `}${o.title}`,
          sub: o.previouslyFailed ? `Didn't work last time: ${o.previouslyFailed}` : o.subtitle,
          warn: !!o.previouslyFailed, selected: profile.connection === o.connection,
          onPick: () => {
            userSays(o.title); setField("connection", o.connection); setChosen(o); setDoneSteps(new Set()); go("steps");
            saySoon(o.verified ? "Here's exactly what to do. Tick each step as you go, then tap Done." : "Here's the general way to do it — your desk's manual will have the exact menu names. Tick each step, then tap Done.", "focus", "Sarah is walking you through it");
          },
        })).concat([{
          label: "I don't have any of these",
          sub: "Tell me what to get",
          onPick: () => {
            userSays("I don't have any of these");
            saySoon(
              "No problem. The cheapest way in is a small USB audio interface — a Behringer U-PHORIA UMC202HD or a Focusrite Scarlett Solo is plenty, plus one cable from your desk's aux output to its line input. " +
              "If another computer already has the sound (a streaming PC, for example), NDI over a wired network works with no extra hardware. " +
              "And until either arrives, this computer's own microphone will do — pick it at the bottom of the list. It's less accurate, but it works.",
              "focus", "Sarah's suggestions");
            setExtraChips(["Use this computer's mic for now", "I'll get an interface"]);
          },
        }]);
      case "steps":
        return [
          { label: "Done", sub: "I've finished these steps", onPick: () => { userSays("Done"); goTo("input"); } },
          { label: "I'm stuck", sub: "Ask Sarah", onPick: () => { void ask("I'm stuck on these steps. What should I check?"); } },
          { label: "Try another way", onPick: () => { userSays("Try another way"); goTo("connection"); } },
        ];
      case "input":
        return [
          ...devices.map((d): Opt => ({
            label: d.name, sub: `${d.kind.label}${d.channelCount > 2 ? ` · ${d.channelCount} ch` : ""}`,
            selected: device?.key === d.key, warn: !d.kind.recommended, disabled: busy,
            onPick: () => { void pickDevice(d); },
          })),
          { label: loadingDevices ? "Looking…" : "Look again", sub: "Refresh the list", disabled: loadingDevices, onPick: () => { void loadDevices(); } },
        ];
      case "quiet":
        return measuring ? [] : [{ label: "Start quiet check", sub: "8 seconds of silence", onPick: () => { userSays("Start quiet check"); measure("quiet"); } }];
      case "speak":
        return measuring ? [] : [{ label: "Start voice check", sub: "Just talk until I say stop", onPick: () => { userSays("Start voice check"); measure("speak"); } }];
      case "save":
        return [{ label: "Save my setup", sub: device?.name, disabled: busy, onPick: () => { userSays("Save my setup"); void finish(); } }];
      case "tryit": {
        const out: Opt[] = [];
        if (!live?.listening) out.push({ label: "Turn on AI listening", sub: "Then say the line out loud", onPick: () => { userSays("Turn on AI listening"); live?.onListen?.(); } });
        out.push({ label: "Skip this", sub: "I'll try it later", onPick: () => { userSays("Skip this"); if (onDone) { void feed.stop(); clearTimers(); onDone(); } else setShowSuccess(true); } });
        return out;
      }
      default:
        return [];
    }
  }, [phase, match, useApp, profile, devices, device, measuring, busy, loadingDevices, editingFromApp, lastDevice, live, quickCheck, ask, finish, go, goTo, loadDevices, measure, pickDevice, say, saySoon, setField, userSays]);

  const onExtraChip = (label: string) => {
    if (measuring && label !== "Ask Sarah") return;
    if (label === "Continue" || label === "Continue anyway") {
      userSays(label);
      if (phase === "input") goTo(quickCheck ? "speak" : "quiet");
      else if (phase === "quiet") goTo("speak");
      return;
    }
    if (label === "Skip the model" && phase === "desk") { userSays(label); goTo("connection"); return; }
    if (label === "Save my setup") { userSays(label); go("save"); saySoon("Perfect. I'll remember this on this computer and pick it for you next time.", "celebrate", "Ready to save"); return; }
    if (label === "Test again") { userSays(label); measure(phase === "quiet" ? "quiet" : "speak"); return; }
    if (label === "Try again" && device) { userSays(label); void pickDevice(device); return; }
    if (label === "Look again") { userSays(label); void loadDevices(); return; }
    if (label === "Try another way") {
      userSays(label);
      const worst = checksRef.current.find((c) => c.status === "fail");
      const next = recordFailure(worst?.detail ?? "didn't pass the checks");
      void feed.stop(); goTo("connection", next);
      return;
    }
    if (label === "Finish") { userSays(label); if (onDone) { void feed.stop(); clearTimers(); onDone(); } else setShowSuccess(true); return; }
    if (label === "Turn off AI listening") { userSays(label); live?.onListen?.(); say("Thanks — pick your input again and I'll test it.", "nod", "Ready to test"); setExtraChips([]); return; }
    if (label === "Ask Sarah") { void ask("That check failed. What should I do?"); return; }
    if (label === "Use this computer's mic for now") {
      userSays(label);
      const builtin = rankConnections({ desk: profile.desk, os: profile.os }).find((o) => o.connection === "builtin");
      if (builtin) { setField("connection", "builtin"); setChosen(builtin); setDoneSteps(new Set()); go("steps"); saySoon("Fine for now — here's how to get the best out of it.", "nod", "Sarah is walking you through it"); }
      return;
    }
    if (label === "I'll get an interface") {
      userSays(label);
      say("Good call. When it arrives, open Settings → Audio Input and tap Run setup again — I'll pick up from here.", "nod", "Sarah will be here");
      return;
    }
    void ask(label);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = draft.trim(); if (!t) return;
    // On the desk step a SHORT model-looking answer names the desk; anything
    // sentence-like (or a question) goes to Sarah as a question.
    const looksLikeModel = t.length <= 28 && !/[?]/.test(t) && t.split(/\s+/).length <= 4;
    if (phase === "desk" && looksLikeModel) {
      userSays(t); setDraft("");
      const brand = profile.desk && DESK_BRANDS.includes(profile.desk) ? profile.desk.split(" /")[0] : "";
      const full = brand && !new RegExp(brand, "i").test(t) ? `${brand} ${t}` : t;
      setField("desk", full);
      goTo("connection", { ...profile, desk: full });
      return;
    }
    void ask(t);
  };

  const ripple = (e: React.MouseEvent<HTMLButtonElement>) => {
    const b = e.currentTarget; const r = b.getBoundingClientRect(); const size = Math.max(r.width, r.height);
    const x = e.clientX || r.left + r.width / 2; const y = e.clientY || r.top + r.height / 2;
    const span = document.createElement("span");
    span.className = s.ripple;
    Object.assign(span.style, { width: `${size}px`, height: `${size}px`, left: `${x - r.left - size / 2}px`, top: `${y - r.top - size / 2}px` });
    b.appendChild(span); setTimeout(() => span.remove(), 650);
  };

  // live level for halo + meter
  const shown = channels.length ? feed.levels.filter((l) => channels.includes(l.channel)) : feed.levels;
  const topPeak = shown.reduce((m, l) => Math.max(m, Math.abs(l.peak) || 0), 0);
  const topDb = topPeak > 0 ? 20 * Math.log10(topPeak) : -120;
  const pct = Math.max(0, Math.min(100, ((topDb + 60) / 60) * 100));
  const liveLevel = feed.running ? pct / 100 : 0;
  const band = levelBand(topDb);
  const bandLabel = { silent: "No sound", quiet: "Too quiet", good: "Good", loud: "Too loud" }[band];
  const bandClass = band === "good" ? s.bandGood : band === "silent" ? s.bandBad : s.bandWarn;
  const lastPct = useRef(0);
  useEffect(() => {
    if (!feed.running || phaseRef.current === "quiet") return;
    if (pct > 55 && lastPct.current <= 55 && mood === "listen") {
      setMood("ooh"); setStatus("Sarah can hear you");
      const t = setTimeout(() => setMood("listen"), 1400);
      timers.current.add(t);
    }
    lastPct.current = pct;
  }, [pct, feed.running, mood]);

  const canType = forceType || phase === "desk" || phase === "steps";
  const idx = PROGRESS.indexOf(phase);
  const title: Record<Phase, string> = {
    loading: "Getting ready", context: "Welcome", os: "Your computer", desk: "Your sound desk", connection: "Ways to connect",
    steps: "Do these steps", input: "Pick your input", quiet: "Quiet check", speak: "Voice check", save: "Save your setup",
    tryit: "Your first verse",
  };

  return (
    <div className={`${s.root} ${onDone ? s.spotlight : ""}`}>
      <SarahShader energy={liveLevel} paused={showSuccess} />
      <div className={s.bar}>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
          <strong className={s.barName}>Sarah</strong>
          <span className={s.barRole}>Audio setup assistant</span>
        </div>
        {profile.desk && <span key={profile.desk} className={s.pill}>{profile.desk}</span>}
        {profile.os && <span key={profile.os} className={`${s.pill} ${s.pillDim}`}>{OS_LABEL[profile.os]}</span>}
        {device && <span key={device.key} className={`${s.pill} ${s.pillDim}`}>{device.kind.label}{channels.length ? ` · ch ${channels.map((c) => c + 1).join("/")}` : ""}</span>}
        <div style={{ flex: 1 }} />
        <div className={s.progressWrap}>
          <span className={s.progressText}>Step {Math.max(1, idx + 1)} of {PROGRESS.length}</span>
          <div className={s.progress} aria-hidden>
            {PROGRESS.map((p, i) => <i key={p} data-on={i <= idx} data-current={i === idx} />)}
          </div>
        </div>
      </div>

      <div className={s.main}>
        <section className={s.stage} aria-label="Sarah">
          <SarahAvatar mood={mood} level={liveLevel} />
          <div className={s.status} aria-live="polite">
            {status}{(typing || measuring) && <span className={s.dots} aria-hidden><i /><i /><i /></span>}
          </div>
          {feed.running && (
            <div className={s.meter}>
              <div className={s.track} role="meter" aria-label="Input level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-valuetext={bandLabel}>
                <div className={s.fill} style={{ transform: `scaleX(${pct / 100})` }} />
                <div className={s.target} />
              </div>
              <div className={s.meterRow}>
                <span className={bandClass}>{bandLabel}</span>
                <span>{device?.name}{channels.length ? ` · ch ${channels.map((c) => c + 1).join("/")}` : ""}</span>
              </div>
            </div>
          )}
          {phase === "tryit" && (
            <div className={s.meter} aria-live="polite">
              <div className={s.meterRow}><span>{live?.listening ? "AI listening — say the line out loud" : "AI listening is off"}</span></div>
              <div className={s.heard}>{live?.interim || live?.transcript || "…"}</div>
            </div>
          )}
          {feed.running && device && device.channelCount > 2 && phase === "input" && (
            <div className={s.channels}>
              {Array.from({ length: Math.min(device.channelCount, 64) }, (_, c) => {
                const l = feed.levels.find((x) => x.channel === c);
                const p = l ? Math.abs(l.peak) : 0;
                const h = p > 0 ? Math.max(0, Math.min(100, ((20 * Math.log10(p) + 60) / 60) * 100)) : 0;
                return (
                  <button key={c} type="button" className={`${s.ch} ${channels.includes(c) ? s.chHit : ""}`}
                    onClick={() => {
                      const next = channels.includes(c) ? channels.filter((x) => x !== c) : [...channels, c].slice(-2).sort((a, b) => a - b);
                      setChannels(next); feed.setChannels(next.length ? next : null);
                      if (next.length) setExtraChips(["Continue"]);
                    }}
                    aria-label={`Channel ${c + 1}`} aria-pressed={channels.includes(c)}>
                    <span className={s.chBar}><span className={s.chFill} style={{ height: `${h}%` }} /></span>{c + 1}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className={s.chat} aria-label="Conversation with Sarah">
          <div className={s.chatHead}>
            <strong className={s.chatTitle}>{title[phase]}</strong>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {aiOffline && <span className={s.offlinePill} title="Sarah's chat needs a Groq key / active subscription">Offline guide</span>}
              {match && match.confidence !== "none" && phase !== "loading" && phase !== "context" && (
                <button type="button" className={s.link} onClick={() => {
                  const useIt = !useApp;
                  setUseApp(useIt);
                  userSays(useIt ? "Use my application" : "Start fresh");
                  void feed.stop(); clearTimers(); runId.current += 1; setMeasuring(false);
                  setChecks([]); setDevice(null); setChannels([]); setEditingFromApp(true);
                  if (!useIt) setProfile((p) => ({ failedRoutes: p.failedRoutes }));
                  setTrail(["context"]); setPhase("os"); setExtraChips([]);
                  enter("os", useIt ? profileRef.current : { failedRoutes: profileRef.current.failedRoutes });
                }}>
                  {useApp ? "Start fresh instead" : "Use my application"}
                </button>
              )}
            </div>
          </div>

          <div className={s.log} ref={logRef} role="log" aria-live="polite">
            {msgs.map((m) => (
              <div key={m.id} className={`${s.msg} ${m.role === "sarah" ? s.msgSarah : s.msgUser}`}>{m.text}</div>
            ))}
            {phase === "context" && match && match.confidence !== "none" && useApp && (
              <div className={s.card}>
                <span className={s.cardK}>{match.identityMatched ? "From your beta application" : "Possible application — not confirmed"}</span>
                <div>{[match.setup.churchName, match.setup.desk, match.setup.device, match.setup.currentSoftware].filter(Boolean).join(" · ")}</div>
                <div className={s.sigs}>
                  {match.signals.filter((x) => x.matched).map((x) => <span key={x.key} className={s.sig}>✓ {x.label}</span>)}
                  {match.signals.filter((x) => !x.matched && x.strength === "strong").slice(0, 2).map((x) => <span key={x.key} className={`${s.sig} ${s.sigNo}`}>– {x.label}</span>)}
                </div>
              </div>
            )}
            {phase === "steps" && chosen && (
              <div className={s.stepsList}>
                {chosen.steps.map((step, i) => (
                  <button key={i} type="button" className={s.stepItem} role="checkbox" aria-checked={doneSteps.has(i)}
                    style={{ animationDelay: `${i * 70}ms` }}
                    onClick={() => setDoneSteps((d) => {
                      const n = new Set(d); if (n.has(i)) n.delete(i); else n.add(i);
                      if (n.size === chosen.steps.length) { setMood("nod"); setStatus("All steps ticked"); }
                      return n;
                    })}>
                    <span className={s.tick} aria-hidden>{doneSteps.has(i) ? "✓" : ""}</span><span>{step}</span>
                  </button>
                ))}
              </div>
            )}
            {typing && <div className={s.typing}><span className={s.dots} aria-label="Sarah is typing"><i /><i /><i /></span></div>}
          </div>

          <div className={s.opts}>
            {[...opts, ...extraChips.map((c): Opt => ({ label: c, onPick: () => onExtraChip(c) }))].map((o, i) => (
              <button key={`${phase}-${o.label}-${i}`} type="button" style={{ animationDelay: `${i * 55}ms` }}
                disabled={o.disabled}
                className={`${s.opt} ${o.selected ? s.optSel : ""} ${o.warn ? s.optWarn : ""}`}
                onClick={(e) => { ripple(e); o.onPick(); }}>
                <span>{o.label}</span>{o.sub && <small>{o.sub}</small>}
              </button>
            ))}
          </div>

          {canType && (
          <form className={s.compose} onSubmit={onSubmit}>
            <label htmlFor="sarah-say" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Message Sarah</label>
            <input id="sarah-say" className={s.input} value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off"
              placeholder={phase === "desk" ? "Type your desk model, e.g. X32" : "Type to Sarah — e.g. “we actually have a Yamaha now”"} />
            <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={!draft.trim() || typing}>Send</button>
          </form>
          )}
          {!canType && (
            <div className={s.askRow}>
              <button type="button" className={s.link} onClick={() => setForceType(true)}>Something else? Ask Sarah</button>
            </div>
          )}
          <div className={s.nav}>
            <button type="button" className={s.btn} onClick={back} disabled={trail.length === 0}>Back</button>
            <button type="button" className={s.btn} onClick={() => { clearTimers(); void feed.stop(); if (onDone) onDone(); else router.push("/dashboard"); }}>Close</button>
          </div>
        </section>
      </div>

      {coach && (() => {
        const now = Date.now();
        // Read-only here: level history and unplug counting are maintained in effects
        // (render can run twice in development and must not double-count).
        const held = levelHist.current.length ? Math.max(...levelHist.current.map((x) => x.db)) : undefined;
        const silentSeconds = silentSince.current ? (now - silentSince.current) / 1000 : 0;
        const pref = readNativeDevicePref() as { name?: string; uid?: string } | null;
        const selName = coachPick ?? device?.name ?? null;
        const selDev = (pref?.uid ? devices.find((d) => d.uid === pref.uid) : undefined) ?? (selName ? devices.find((d) => d.name === selName) : undefined);

        const note = topWatchNote({
          listening: !!live?.listening,
          ready: live?.ready,
          online: typeof navigator === "undefined" ? true : navigator.onLine,
          noAudioSignal: live?.noAudioSignal,
          clipping: live?.clipping,
          reconnectAttempts: live?.reconnectAttempts,
          reconnectFailed: live?.reconnectFailed,
          audioQuality: live?.audioQuality,
          selected: selName ? { name: selName, kind: selDev?.kind.kind, transport: selDev?.transport } : null,
          selectedMissing: !!selName && missingPolls.current >= 2,
          levelDb: held,
          silentSeconds,
          route: profile.connection,
          ndiSources: devices.filter((d) => d.transport === "ndi").map((d) => d.name.replace(/^NDI:\s*/, "")),
          // Only the macOS helper (which reports device uids) can list NDI sources.
          ndiDiscoveryAvailable: devices.some((d) => d.source === "native" && !!d.uid),
          ndiScanSeconds: coachStartedAt.current ? (now - coachStartedAt.current) / 1000 : 0,
        });
        const noteEl = note ? (
          <div className={`rounded-lg px-3 py-2 text-[13px] leading-relaxed border ${
            note.severity === "problem" ? "border-red-400/45 bg-red-500/12 text-red-50"
              : note.severity === "warn" ? "border-[#e8501a]/45 bg-[#e8501a]/12 text-[#ffe2d4]"
              : "border-[#8fd6a8]/40 bg-[#8fd6a8]/10 text-[#e6f7ec]"}`}>
            <div className="font-semibold">{note.message}</div>
            {note.fix && <div className="mt-0.5">{note.fix}</div>}
          </div>
        ) : null;

        if (coach === "audio-panel") return (
          <SarahSpotlight
            target="hardware-audio"
            mood={coachPick ? "nod" : "listen"}
            title={!audioPanelShown ? "The Audio panel closed" : coachPick ? `Got it — ${coachPick}` : "Pick your input here"}
            body={!audioPanelShown
              ? "No problem — tap “Show me again” and I'll open it back up."
              : coachPick
                ? "That's where your sound comes in. Tap Done and I'll check the level."
                : "This is your Audio panel — you'll use it every Sunday. Click the device your sound comes in on."}
            onTargetChange={setAudioPanelShown}
            actions={[
              !audioPanelShown
                ? { label: "Show me again", onClick: () => window.dispatchEvent(new CustomEvent("presentflow:open-hardware", { detail: { panel: "audio" } })) }
                : { label: "Show me a simple list", onClick: () => setCoach(null) },
              { label: "Done", primary: true, disabled: !coachPick, onClick: coachDone },
            ]}
            onClose={() => setCoach(null)}
          >{noteEl}</SarahSpotlight>
        );

        if (coach === "ai-pill") return (
          <SarahSpotlight
            target="ai-pill"
            mood="listen"
            title="Switch AI listening on"
            body="Click the AI switch in the top bar to turn listening on. I'll wait."
            actions={[{ label: "Skip — finish setup later", onClick: endSetup }]}
            onClose={() => setCoach(null)}
          >{noteEl}</SarahSpotlight>
        );

        return (
          <SarahSpotlight
            target="live-preview"
            mood={coachWin ? "celebrate" : "listen"}
            title={coachWin ? `That's it — ${coachWin}` : "Now say the verse"}
            body={coachWin
              ? "Your sound, the AI and PresentFlow are working together. This screen is what your congregation sees."
              : "Into the mic your sound comes in on, say: “Let's turn to John chapter three, verse sixteen.” Watch this screen — it's what goes on the projector."}
            actions={coachWin
              ? [{ label: "I'm done", primary: true, onClick: endSetup }]
              : [{ label: "Skip — finish setup later", onClick: endSetup }]}
            onClose={() => setCoach(null)}
          >
            {!coachWin && (
              // Not a live region: interim words update constantly and would flood a screen reader.
              <div aria-live="off" className="rounded-lg px-3 py-2 text-[13px] border border-white/10 bg-white/5 min-h-[2.6em]">
                {live?.interim || live?.transcript || "Listening…"}
              </div>
            )}
            {!coachWin && noteEl && <div className="mt-2">{noteEl}</div>}
          </SarahSpotlight>
        );
      })()}

      {showSuccess && (
        <SarahSuccess
          deviceLabel={`${device?.name ?? "your input"}${channels.length ? ` · ch ${channels.map((c) => c + 1).join("/")}` : ""}`}
          onClose={() => { setShowSuccess(false); if (onDone) onDone(); else router.push("/dashboard"); }}
        />
      )}
    </div>
  );
}
