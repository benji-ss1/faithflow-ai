"use client";

/**
 * Sarah — AI audio setup wizard (Audio Lock-In, 2026-09-15).
 *
 * Flow: context (beta application / start fresh) → computer → desk → ways to
 * connect → do the steps → pick input (+ auto-spot channel) → quiet check →
 * voice check → save → success. Back works everywhere; Sarah's chat is always open.
 *
 * Pass/fail comes ONLY from audioDiagnostics. Sarah (Groq, /api/ai/audio-guide)
 * explains and converses; without a key she falls back to scripted guidance.
 * Never starts live capture — meters come from the read-only level probe.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import s from "./sarah.module.css";
import { SarahAvatar, type SarahMood } from "./SarahAvatar";
import { SarahShader } from "./SarahShader";
import { SarahSuccess } from "./SarahSuccess";
import { listSetupDevices, useLevelFeed, type SetupDevice } from "./useLevelFeed";
import type { ApplicationMatch } from "@/lib/audio/applicationMatch";
import { rankConnections, type Connection, type ConnectionOption, type Os } from "@/lib/audio/connectionPlans";
import { checkNoiseFloor, checkSpeech, detectActiveChannels, overallStatus, type DiagnosticCheck } from "@/lib/audio/audioDiagnostics";
import { saveWorkingDevice } from "@/lib/audio/savedAudioDevices";
import { writeNativeDevicePref, type NativeDeviceMode } from "@/lib/audio/nativeDeviceStore";

type Phase = "loading" | "context" | "os" | "desk" | "connection" | "steps" | "input" | "quiet" | "speak" | "save";
const PROGRESS: Phase[] = ["context", "os", "desk", "connection", "steps", "input", "quiet", "speak", "save"];

type Msg = { id: number; role: "sarah" | "user"; text: string };
type Profile = {
  desk?: string; os?: Os; connection?: Connection; mixType?: "main" | "aux" | "unsure";
  failedRoutes?: { connection: string; reason: string; at: number }[];
  corrections?: { field: string; from?: string; to: string; at: number }[];
  completedAt?: number;
};
type Opt = { label: string; sub?: string; onPick: () => void; selected?: boolean; warn?: boolean };

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
  signal: "Nothing is reaching this input yet. Check the right input and channel are picked, the desk's USB or aux send is turned up and not muted, the cable is in, and (on a Mac) microphone access is allowed for PresentFlow.",
  "noise-floor": "I'm hearing hum or background noise in a quiet room. Make sure no music is playing, use balanced cables, plug this computer into the same power as the desk, or add a DI box with ground lift on the audio cable. Never remove a power earth.",
  "speech-level-low": "The voice is too quiet. Turn up the aux or USB send on the desk (or the interface gain) until talking fills the green part of the bar.",
  "speech-level-hot": "The voice is too hot. Lower the send, or switch on the pad on your interface.",
  clipping: "It's distorting. Lower the send or interface gain, or turn on the pad. If it's a mic input fed by a line output, use a line input instead.",
};
const KNOWLEDGE: Partial<Record<Phase, string>> = {
  connection: "Golden rule: send a post-fader FULL mix (pulpit mics AND band). X32: Routing → Out 1-16 put Main LR on 15/16, Card Out block 9-16. Wing: Routing → Outputs → USB. TF: Stereo → USB 33/34 default. SQ: USB out 1/2 = Main LR default. Qu: Setup → I/O Patch → USB Audio. StudioLive III: Universal Control USB Send 1/2 = Main L/R. Dante VSC: route in Dante Controller, 48 kHz, 4-10 ms latency, wired. Blackmagic: Desktop Video Setup → audio input Embedded, needs live video. Other desks: send Main to a USB pair, check the manual.",
  steps: "Same as connection knowledge. Stuck? Ask: do the desk's USB/Card output meters move when someone talks? Is the computer plugged straight in (no hub)? Is it 48 kHz on both?",
  input: "Pick the device that matches the connection. Multichannel desks: the moving channel pair is the send. Built-in mic is a last resort (room echo).",
  quiet: "Quiet-room noise above -50 dBFS = hum/buzz/open mic. Fixes: balanced cables, same power as desk, DI ground lift (audio path only), no music playing.",
  speak: "Target speech peaks -18 to -12 dBFS; below -24 hurts detection; clipping at -1 dBFS. Too quiet: raise send/gain. Too hot: lower send or pad. Line output into mic input: use a line input or pad. 48V off for line sources.",
};

const deviceToOs = (d?: string): Os | undefined => (/mac/i.test(d ?? "") ? "mac" : /windows|pc/i.test(d ?? "") ? "windows" : undefined);
const nextId = (() => { let i = 0; return () => ++i; })();

export function SarahSetupWizard() {
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
  const [chosen, setChosen] = useState<ConnectionOption | null>(null);
  const [doneSteps, setDoneSteps] = useState<Set<number>>(new Set());
  const [devices, setDevices] = useState<SetupDevice[]>([]);
  const [device, setDevice] = useState<SetupDevice | null>(null);
  const [channels, setChannels] = useState<number[]>([]);
  const [checks, setChecks] = useState<DiagnosticCheck[]>([]);
  const [measuring, setMeasuring] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const feed = useLevelFeed();
  const logRef = useRef<HTMLDivElement | null>(null);
  const aiDisabled = useRef(false);

  const say = useCallback((text: string, m?: SarahMood, st?: string) => {
    setMsgs((x) => [...x, { id: nextId(), role: "sarah", text }]);
    if (m) setMood(m);
    if (st) setStatus(st);
  }, []);
  const saySoon = useCallback((text: string, m: SarahMood, st: string, ms = 650) => {
    setTyping(true); setMood("think"); setStatus("Sarah is thinking");
    setTimeout(() => { setTyping(false); say(text, m, st); }, ms);
  }, [say]);
  const userSays = (text: string) => setMsgs((x) => [...x, { id: nextId(), role: "user", text }]);

  useEffect(() => { logRef.current?.scrollTo({ top: 1e6 }); }, [msgs, typing]);

  const saveProfile = useCallback(async (p: Profile) => {
    try {
      await fetch("/api/audio-setup/context", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: p, confirmedApplicationId: useApp && match?.confidence !== "none" ? match?.applicationId ?? null : null }),
      });
    } catch { /* non-blocking */ }
  }, [match, useApp]);

  const go = useCallback((next: Phase) => { setTrail((t) => [...t, phase]); setPhase(next); setExtraChips([]); }, [phase]);
  const back = () => {
    setTrail((t) => {
      if (!t.length) return t;
      const prev = t[t.length - 1];
      if (phase === "input" || phase === "quiet" || phase === "speak") void feed.stop();
      setPhase(prev); setExtraChips([]); setMood("nod"); setStatus("Going back");
      return t.slice(0, -1);
    });
  };

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
      if (m?.confidence === "high") {
        say(`Hi, I'm Sarah — I'll get your sound connected. I found your church's application for ${st?.churchName ?? "your church"}.`, "ooh", "Sarah found your application");
        say(`It says you use ${st?.desk ?? "an unknown desk"}${st?.device ? ` on ${st.device}` : ""}. Is that still right?`, "listen", "Sarah is listening");
      } else if (m?.confidence === "possible") {
        say(`Hi, I'm Sarah — I'll get your sound connected. I think I found your application, but I want to be sure.`, "think", "Sarah is checking");
        say(`Is this your church: ${st?.churchName ?? "unknown"}${st?.applicantName ? `, applied by ${st.applicantName}` : ""}${st?.city ? ` in ${st.city}` : ""}?`, "listen", "Sarah is listening");
      } else if (saved.desk || saved.connection) {
        say(`Welcome back — I'm Sarah. Last time you set up ${saved.desk ?? "your audio"}${saved.connection ? ` using ${saved.connection}` : ""}. Want to use that again?`, "nod", "Sarah remembers you");
      } else {
        say("Hi, I'm Sarah — I'll help you connect your church's sound to PresentFlow. It takes about 3 minutes. Ready?", "neutral", "Sarah is ready");
      }
    })();
    return () => { cancelled = true; };
  }, [say]);

  const setField = useCallback(<K extends keyof Profile>(field: K, value: Profile[K], from?: string) => {
    setProfile((p) => {
      const prevVal = p[field] as string | undefined;
      const corr = prevVal && value && prevVal !== value
        ? [...(p.corrections ?? []), { field: String(field), from: prevVal ?? from, to: String(value), at: Date.now() }]
        : p.corrections;
      return { ...p, [field]: value, corrections: corr };
    });
  }, []);

  // ── phase entry scripts ──
  const enter = useCallback((p: Phase, prof: Profile) => {
    if (p === "os") saySoon("First — is PresentFlow running on a Mac or a Windows computer?", "listen", "Sarah is listening");
    if (p === "desk") saySoon("What sound desk (mixer) does your church use? Tap one, or type the model below.", "listen", "Sarah is listening");
    if (p === "connection") {
      const n = rankConnections({ desk: prof.desk, os: prof.os, failedRoutes: prof.failedRoutes }).filter((o) => o.connection !== "builtin").length;
      saySoon(`For ${prof.desk || "your setup"}${prof.os ? ` on ${prof.os === "mac" ? "a Mac" : "Windows"}` : ""}, churches usually connect one of these ${n} ways. Pick the one you have — you can always come back and try another.`, "think", "Sarah is thinking");
    }
    if (p === "input") saySoon("Now pick the input below. I've put the most likely one first.", "focus", "Sarah is checking your inputs");
    if (p === "quiet") saySoon("Quick quiet check: please make sure no one is talking and no music is playing. I'll listen for 8 seconds for hum or noise.", "listen", "Sarah is listening");
    if (p === "speak") saySoon("Now have someone speak into the pastor's mic, like they're preaching. Try: “For God so loved the world, that he gave his only begotten Son.” I'm watching the green bar.", "listen", "Sarah is listening");
  }, [saySoon]);

  const goTo = useCallback((p: Phase, prof = profile) => { go(p); enter(p, prof); }, [go, enter, profile]);

  // ── device list when entering input ──
  useEffect(() => {
    if (phase !== "input") return;
    let cancelled = false;
    (async () => {
      const list = await listSetupDevices();
      if (cancelled) return;
      const want: Record<string, string[]> = {
        "usb-desk": ["desk", "interface"], interface: ["interface", "desk"], ndi: ["ndi"], dante: ["dante"], "sdi-capture": ["sdi-capture", "usb-switcher", "hdmi-capture"], builtin: ["builtin"],
      };
      const pref = want[profile.connection ?? ""] ?? [];
      const rank = (d: SetupDevice) => { const i = pref.indexOf(d.kind.kind); return i === -1 ? (d.kind.recommended ? 10 : 20) : i; };
      setDevices([...list].sort((a, b) => rank(a) - rank(b)));
      if (list.length === 0) say("I can't see any audio inputs. Check the cable or interface is plugged in, then tap “Look again”.", "focus", "Sarah can't find inputs");
    })();
    return () => { cancelled = true; };
  }, [phase, profile.connection, say]);

  const pickDevice = async (d: SetupDevice) => {
    userSays(d.name);
    setDevice(d); setChannels([]);
    const ok = await feed.start(d);
    if (!ok) { saySoon(feed.error ?? "I couldn't open that input. If AI listening is on in the operator screen, stop it first, then try again.", "focus", "Sarah hit a snag"); return; }
    if (d.channelCount > 2) {
      saySoon(`That's a ${d.kind.label.toLowerCase()} with ${d.channelCount} channels. Talk into the pastor's mic — I'll spot which channel is moving.`, "listen", "Sarah is watching the channels");
      setMeasuring(true);
      setTimeout(() => {
        const found = detectActiveChannels(feed.snapshotHistory());
        setMeasuring(false);
        if (found.length) {
          setChannels(found); feed.setChannels(found);
          say(`Ooh — I can see it on channel${found.length > 1 ? "s" : ""} ${found.map((c) => c + 1).join(" & ")}!`, "ooh", "Sarah found your channel");
          setExtraChips(["Continue"]);
        } else {
          say("I didn't see any channel move. Is someone talking into the mic, and is the desk sending to USB? Tap “Try again” when ready.", "focus", "Sarah is checking");
          setExtraChips(["Try again"]);
        }
      }, 6500);
    } else {
      saySoon(`${d.kind.label} selected. ${d.kind.hint}`, "nod", "Sarah is ready for the check");
      setExtraChips(["Continue"]);
    }
  };

  const measure = (kind: "quiet" | "speak") => {
    feed.resetFrames(); setMeasuring(true); setChecks([]);
    setTimeout(() => {
      setMeasuring(false);
      const frames = feed.snapshotFrames();
      const result = kind === "quiet" ? [checkNoiseFloor(frames)] : checkSpeech(frames);
      setChecks(result);
      const overall = overallStatus(result);
      if (overall === "pass") {
        if (kind === "quiet") { say("Lovely and quiet — no hum. 👌", "nod", "Quiet check passed"); setExtraChips(["Continue"]); }
        else { say("Ooh, I can hear you clearly! Level is healthy and there's no distortion.", "ooh", "Voice check passed"); setExtraChips(["Save my setup"]); }
        return;
      }
      const worst = result.find((c) => c.status === "fail") ?? result.find((c) => c.status === "warn")!;
      const key = worst.id === "speech-level" ? ((worst.value ?? 0) > -6 ? "speech-level-hot" : "speech-level-low") : worst.id;
      say(`${worst.detail} ${FIX[key] ?? ""}`.trim(), "focus", overall === "fail" ? "Sarah found a problem" : "Sarah has a tip");
      setExtraChips(overall === "fail" ? ["Test again", "Try another way", "Ask Sarah"] : ["Test again", "Continue anyway"]);
    }, kind === "quiet" ? 8000 : 10000);
  };

  const recordFailure = (reason: string) => {
    if (!profile.connection) return profile;
    const next: Profile = { ...profile, failedRoutes: [...(profile.failedRoutes ?? []), { connection: profile.connection, reason: reason.slice(0, 180), at: Date.now() }] };
    setProfile(next); void saveProfile(next);
    return next;
  };

  const finish = async () => {
    if (device) {
      const mode: NativeDeviceMode = channels.length === 1 ? "mono" : channels.length === 2 ? "stereo" : "sum-all";
      saveWorkingDevice({ uid: device.uid, name: device.name, transport: device.transport, channelCount: device.channelCount, mode, selectedChannels: channels, gainDb: 0, role: "primary" });
      if (device.source === "native" && device.index != null) {
        writeNativeDevicePref({ index: device.index, name: device.name, mode, selectedChannels: channels, gainDb: 0 });
      }
    }
    await feed.stop();
    const done: Profile = { ...profile, completedAt: Date.now() };
    setProfile(done); await saveProfile(done);
    setMood("celebrate"); setStatus("All set!");
    setShowSuccess(true);
  };

  // ── chat ──
  const ask = async (text: string) => {
    const t = text.trim(); if (!t) return;
    userSays(t); setDraft(""); setTyping(true); setMood("think"); setStatus("Sarah is thinking");
    const history = msgs.slice(-8).map((m) => ({ role: m.role === "sarah" ? "assistant" : "user", content: m.text }));
    let answered = false;
    if (!aiDisabled.current) {
      try {
        const res = await fetch("/api/ai/audio-guide", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: t, history,
            context: {
              step: phase,
              setup: { desk: profile.desk, os: profile.os, connection: profile.connection, mixType: profile.mixType, deviceName: device?.name, deviceKind: device?.kind.kind, channel: channels.map((c) => c + 1).join("/") },
              diagnostics: checks, knowledge: KNOWLEDGE[phase] ?? KNOWLEDGE.connection,
            },
          }),
        });
        const j = await res.json();
        if (j?.ok) {
          answered = true;
          const d = j.data as { reply: string; mood: SarahMood; suggestions: string[]; correction?: { field: string; to: string } };
          setTyping(false); say(d.reply, d.mood === "celebrate" ? "nod" : d.mood, "Sarah replied");
          if (d.suggestions?.length) setExtraChips(d.suggestions);
          if (d.correction) {
            const f = d.correction.field as keyof Profile;
            if (f === "desk" || f === "mixType" || f === "os" || f === "connection") {
              setField(f, d.correction.to as never);
              say(`I've updated your ${d.correction.field} to “${d.correction.to}” and saved it.`, "nod", "Profile updated");
            }
          }
        } else if (j?.code === "MISSING_API_KEY") aiDisabled.current = true;
      } catch { /* fall back */ }
    }
    if (!answered) {
      setTyping(false);
      const worst = checks.find((c) => c.status !== "pass");
      say(worst ? (FIX[worst.id] ?? worst.detail) : "I can't chat right now, but follow the steps on screen — and remember the feed needs pulpit mics AND band. Tap “Try another way” if this route isn't working.", "focus", "Sarah's tip");
    }
  };

  // ── options per phase ──
  const opts: Opt[] = useMemo(() => {
    const st = match?.setup;
    const withRipple = (fn: () => void) => fn;
    switch (phase) {
      case "context": {
        if (match && match.confidence !== "none" && useApp) {
          const apply = () => {
            const next: Profile = { ...profile, desk: profile.desk ?? st?.desk, os: profile.os ?? deviceToOs(st?.device) };
            setProfile(next);
            return next;
          };
          return match.confidence === "high"
            ? [
                { label: "Yes, that's right", sub: "Use my application", onPick: () => { userSays("Yes, that's right"); const n = apply(); goTo(n.os ? "connection" : "os", n); } },
                { label: "Something's changed", sub: "I'll correct it", onPick: () => { userSays("Something's changed"); const n = apply(); goTo("os", n); } },
                { label: "Start fresh", sub: "Ignore the application", onPick: () => { userSays("Start fresh"); setUseApp(false); goTo("os", {}); } },
              ]
            : [
                { label: "Yes, that's us", sub: "Use it", onPick: () => { userSays("Yes, that's us"); const n = apply(); goTo("os", n); } },
                { label: "No, start fresh", onPick: () => { userSays("No, start fresh"); setUseApp(false); goTo("os", {}); } },
              ];
        }
        if (profile.desk || profile.connection) {
          return [
            { label: "Use that again", onPick: () => { userSays("Use that again"); goTo(profile.connection ? "input" : "connection"); } },
            { label: "Start fresh", onPick: () => { userSays("Start fresh"); setProfile({ failedRoutes: profile.failedRoutes }); goTo("os", {}); } },
          ];
        }
        return [{ label: "Let's go", sub: "About 3 minutes", onPick: () => { userSays("Let's go"); goTo("os"); } }];
      }
      case "os":
        return (["mac", "windows"] as Os[]).map((o) => ({
          label: o === "mac" ? "Mac" : "Windows", sub: o === "mac" ? "MacBook, iMac, Mac mini" : "PC or laptop", selected: profile.os === o,
          onPick: withRipple(() => { userSays(o === "mac" ? "Mac" : "Windows"); setField("os", o); goTo(profile.desk ? "connection" : "desk", { ...profile, os: o }); }),
        }));
      case "desk":
        return DESKS.map((d) => ({
          label: d.label, sub: d.sub, selected: !!profile.desk && profile.desk.toLowerCase().includes(d.label.split(" ")[0].toLowerCase()),
          onPick: () => {
            userSays(d.label);
            if (d.label.startsWith("Behringer") || d.label === "Yamaha" || d.label === "Allen & Heath") {
              say(`Which ${d.label} model? Type it below (e.g. ${d.sub}) — it helps me give exact steps. Or tap Next to keep it general.`, "listen", "Sarah is listening");
              setField("desk", d.label); setExtraChips(["Next"]);
              return;
            }
            const desk = d.label.startsWith("No desk") ? "" : d.label;
            setField("desk", desk || undefined); goTo("connection", { ...profile, desk });
          },
        }));
      case "connection":
        return rankConnections({ desk: profile.desk, os: profile.os, failedRoutes: profile.failedRoutes }).map((o, i) => ({
          label: `${o.connection === "builtin" ? "Last resort · " : `${i + 1}. `}${o.title}`,
          sub: o.previouslyFailed ? `Didn't work last time: ${o.previouslyFailed}` : o.subtitle,
          warn: !!o.previouslyFailed, selected: profile.connection === o.connection,
          onPick: () => { userSays(o.title); setField("connection", o.connection); setChosen(o); setDoneSteps(new Set()); go("steps"); saySoon(o.verified ? "Here's exactly what to do. Tick each step as you go, then tap Done." : "Here's the general way to do it — your desk's manual will have the exact menu names. Tick each step, then tap Done.", "focus", "Sarah is walking you through it"); },
        }));
      case "steps":
        return [
          { label: "Done — I've done the steps", onPick: () => { userSays("Done"); goTo("input"); } },
          { label: "I'm stuck", sub: "Ask Sarah", onPick: () => { void ask("I'm stuck on these steps. What should I check?"); } },
          { label: "Try another way", onPick: () => { userSays("Try another way"); goTo("connection"); } },
        ];
      case "input":
        return devices.map((d): Opt => ({
          label: d.name, sub: `${d.kind.label}${d.channelCount > 2 ? ` · ${d.channelCount} ch` : ""}`, selected: device?.key === d.key, warn: !d.kind.recommended,
          onPick: () => { void pickDevice(d); },
        })).concat([{ label: "Look again", sub: "Refresh the list", onPick: () => { setPhase("loading"); setTimeout(() => setPhase("input"), 50); } }]);
      case "quiet":
        return measuring ? [] : [{ label: "Start quiet check", sub: "8 seconds of silence", onPick: () => { userSays("Start quiet check"); measure("quiet"); } }];
      case "speak":
        return measuring ? [] : [{ label: "Start voice check", sub: "Speak for 10 seconds", onPick: () => { userSays("Start voice check"); measure("speak"); } }];
      case "save":
        return [{ label: "Save and finish", sub: device?.name, onPick: () => { userSays("Save and finish"); void finish(); } }];
      default:
        return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, match, useApp, profile, devices, device, measuring]);

  const onExtraChip = (label: string) => {
    if (label === "Continue" || label === "Continue anyway") {
      userSays(label);
      if (phase === "input") goTo("quiet");
      else if (phase === "quiet") goTo("speak");
      return;
    }
    if (label === "Next" && phase === "desk") { userSays("Next"); goTo("connection"); return; }
    if (label === "Save my setup") { userSays(label); go("save"); saySoon("Perfect. I'll remember this setup on this computer so it's picked automatically next time.", "celebrate", "Ready to save"); return; }
    if (label === "Test again") { userSays(label); measure(phase === "quiet" ? "quiet" : "speak"); return; }
    if (label === "Try again" && device) { userSays(label); void pickDevice(device); return; }
    if (label === "Try another way") {
      userSays(label); const worst = checks.find((c) => c.status === "fail");
      const next = recordFailure(worst?.detail ?? "didn't pass the checks");
      void feed.stop(); goTo("connection", next);
      return;
    }
    if (label === "Ask Sarah") { void ask("That check failed. What should I do?"); return; }
    void ask(label);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = draft.trim(); if (!t) return;
    if (phase === "desk" && !profile.desk?.match(/\d|wing|studio/i)) {
      userSays(t); setDraft(""); setField("desk", t);
      goTo("connection", { ...profile, desk: t });
      return;
    }
    void ask(t);
  };

  const ripple = (e: React.MouseEvent<HTMLButtonElement>) => {
    const b = e.currentTarget; const r = b.getBoundingClientRect(); const size = Math.max(r.width, r.height);
    const span = document.createElement("span");
    span.className = s.ripple;
    Object.assign(span.style, { width: `${size}px`, height: `${size}px`, left: `${e.clientX - r.left - size / 2}px`, top: `${e.clientY - r.top - size / 2}px` });
    b.appendChild(span); setTimeout(() => span.remove(), 650);
  };

  // live level for halo + meter
  const shown = channels.length ? feed.levels.filter((l) => channels.includes(l.channel)) : feed.levels;
  const topPeak = shown.reduce((m, l) => Math.max(m, l.peak || 0), 0);
  const topDb = topPeak > 0 ? 20 * Math.log10(topPeak) : -120;
  const pct = Math.max(0, Math.min(100, ((topDb + 60) / 60) * 100));
  const liveLevel = feed.running ? pct / 100 : 0;
  const lastPct = useRef(0);
  useEffect(() => {
    if (!feed.running || phase === "quiet") return;
    if (pct > 55 && lastPct.current <= 55 && mood === "listen") { setMood("ooh"); setStatus("Sarah can hear you"); setTimeout(() => setMood("listen"), 1400); }
    lastPct.current = pct;
  }, [pct, feed.running, phase, mood]);

  const idx = PROGRESS.indexOf(phase);
  const title: Record<Phase, string> = {
    loading: "Getting ready", context: "Welcome", os: "Your computer", desk: "Your sound desk", connection: "Ways to connect",
    steps: "Do these steps", input: "Pick your input", quiet: "Quiet check", speak: "Voice check", save: "Save your setup",
  };

  return (
    <div className={s.root}>
      <SarahShader energy={liveLevel} />
      <div className={s.bar}>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
          <strong style={{ fontSize: 20, fontWeight: 800 }}>Sarah</strong>
          <span style={{ fontSize: 13, color: "var(--color-muted-foreground)" }}>Audio setup assistant</span>
        </div>
        {profile.desk && <span key={profile.desk} className={s.pill}>{profile.desk}</span>}
        {profile.os && <span key={profile.os} className={`${s.pill} ${s.pillDim}`}>{profile.os === "mac" ? "macOS" : "Windows"}</span>}
        {device && <span key={device.key} className={`${s.pill} ${s.pillDim}`}>{device.kind.label}{channels.length ? ` · ch ${channels.map((c) => c + 1).join("/")}` : ""}</span>}
        <div style={{ flex: 1 }} />
        <div className={s.progress} aria-label={`Step ${Math.max(1, idx + 1)} of ${PROGRESS.length}`}>
          {PROGRESS.map((p, i) => <i key={p} data-on={i <= idx} data-current={i === idx} />)}
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
              <div className={s.track}><div className={s.fill} style={{ width: `${pct}%` }} /><div className={s.target} title="Target speech level" /></div>
              <div className={s.meterRow}><span>{device?.name}{channels.length ? ` · ch ${channels.map((c) => c + 1).join("/")}` : ""}</span><span>{topDb <= -119 ? "−∞" : topDb.toFixed(1)} dBFS</span></div>
            </div>
          )}
          {feed.running && device && device.channelCount > 2 && phase === "input" && (
            <div className={s.channels}>
              {Array.from({ length: Math.min(device.channelCount, 32) }, (_, c) => {
                const l = feed.levels.find((x) => x.channel === c);
                const h = l && l.peak > 0 ? Math.max(0, Math.min(100, ((20 * Math.log10(l.peak) + 60) / 60) * 100)) : 0;
                return (
                  <button key={c} type="button" className={`${s.ch} ${channels.includes(c) ? s.chHit : ""}`} style={{ background: "none", border: 0, color: "inherit", cursor: "pointer" }}
                    onClick={() => { const next = channels.includes(c) ? channels.filter((x) => x !== c) : [...channels, c].slice(-2).sort((a, b) => a - b); setChannels(next); feed.setChannels(next.length ? next : null); if (next.length) setExtraChips(["Continue"]); }}
                    aria-label={`Channel ${c + 1}`} aria-pressed={channels.includes(c)}>
                    <div className={s.chBar}><div className={s.chFill} style={{ height: `${h}%` }} /></div>{c + 1}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className={s.chat} aria-label="Conversation with Sarah">
          <div className={s.chatHead}>
            <strong style={{ fontSize: 16 }}>{title[phase]}</strong>
            {match && match.confidence !== "none" && phase !== "loading" && (
              <button type="button" className={s.link} onClick={() => { setUseApp((u) => !u); userSays(useApp ? "Start fresh" : "Use my application"); setTrail([]); setPhase("context"); if (useApp) { setProfile({ failedRoutes: profile.failedRoutes }); goTo("os", {}); } }}>
                {useApp ? "Start fresh instead" : "Use my application"}
              </button>
            )}
          </div>

          <div className={s.log} ref={logRef}>
            {msgs.map((m) => (
              <div key={m.id} className={`${s.msg} ${m.role === "sarah" ? s.msgSarah : s.msgUser}`}>{m.text}</div>
            ))}
            {phase === "context" && match && match.confidence !== "none" && useApp && (
              <div className={s.card}>
                <span className={s.cardK}>From your beta application</span>
                <div>{[match.setup.churchName, match.setup.desk, match.setup.device, match.setup.currentSoftware].filter(Boolean).join(" · ")}</div>
                <div className={s.sigs}>
                  {match.signals.filter((x) => x.matched).map((x) => <span key={x.key} className={s.sig}>✓ {x.label}</span>)}
                  {match.signals.filter((x) => !x.matched && x.strength === "strong").slice(0, 2).map((x) => <span key={x.key} className={`${s.sig} ${s.sigNo}`}>– {x.label}</span>)}
                </div>
              </div>
            )}
            {phase === "steps" && chosen && (
              <div className={s.stepsList} style={{ padding: 0 }}>
                {chosen.steps.map((step, i) => (
                  <div key={i} className={s.stepItem} data-done={doneSteps.has(i)} role="checkbox" aria-checked={doneSteps.has(i)} tabIndex={0}
                    style={{ animationDelay: `${i * 70}ms` }}
                    onClick={() => setDoneSteps((d) => { const n = new Set(d); if (n.has(i)) n.delete(i); else n.add(i); if (n.size === chosen.steps.length) { setMood("nod"); setStatus("All steps ticked"); } return n; })}
                    onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                    <span className={s.tick}>{doneSteps.has(i) ? "✓" : ""}</span><span>{step}</span>
                  </div>
                ))}
              </div>
            )}
            {typing && <div className={s.typing}><span className={s.dots} aria-label="Sarah is typing"><i /><i /><i /></span></div>}
          </div>

          <div className={s.opts}>
            {[...opts.map((o) => ({ ...o, extra: false })), ...extraChips.map((c) => ({ label: c, onPick: () => onExtraChip(c), extra: true } as Opt & { extra: boolean }))].map((o, i) => (
              <button key={`${phase}-${o.label}-${i}`} type="button" style={{ animationDelay: `${i * 55}ms` }}
                className={`${s.opt} ${o.selected ? s.optSel : ""} ${o.warn ? s.optWarn : ""}`}
                onClick={(e) => { ripple(e); o.onPick(); }}>
                <span>{o.label}</span>{o.sub && <small>{o.sub}</small>}
              </button>
            ))}
          </div>

          <form className={s.compose} onSubmit={onSubmit}>
            <label htmlFor="sarah-say" className="sr-only">Message Sarah</label>
            <input id="sarah-say" className={s.input} value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off"
              placeholder={phase === "desk" ? "Type your desk model, e.g. Behringer X32" : "Type to Sarah — e.g. “we actually have a Yamaha now”"} />
            <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={!draft.trim() || typing}>Send</button>
          </form>
          <div className={s.nav}>
            <button type="button" className={s.btn} onClick={back} disabled={trail.length === 0}>Back</button>
            <button type="button" className={s.btn} onClick={() => router.push("/dashboard")}>Exit setup</button>
          </div>
        </section>
      </div>

      {showSuccess && (
        <SarahSuccess
          deviceLabel={`${device?.name ?? "your input"}${channels.length ? ` · ch ${channels.map((c) => c + 1).join("/")}` : ""}`}
          onClose={() => { setShowSuccess(false); router.push("/dashboard"); }}
        />
      )}
    </div>
  );
}
