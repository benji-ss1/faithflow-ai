"use client";
// "Put lyrics on your live stream" — a dead-simple, baby-steps guided wizard for
// non-technical operators to show live lyrics/scripture as an overlay on their
// Facebook/YouTube stream via OBS. Placed in Hardware → Screens.
//
// It offers TWO transports and picks the most reliable one it can:
//  - LAN (desktop only, RECOMMENDED for a separate streaming PC on the same
//    network): the app runs a local server (electron/lan/LanOverlayServer.ts);
//    OBS points at the operator PC's LAN address. No internet/cloud dependency,
//    lowest latency, and it shows a live "device connected" count.
//  - Internet link (works everywhere, incl. web): a private cloud link (pair
//    code) fanned out via Supabase Realtime.
//
// And TWO looks:
//  - Over your camera (transparent) — words key over the live camera.
//  - Full projector look — the church's theme background + words, exactly like
//    the projector (for a words-on-a-background scene, no camera behind).
//
// The wizard reuses the EXISTING /livestream render page for both transports, so
// whatever the projector shows, the stream shows (same theme/appearance path).
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Wifi, Globe, Copy, Check, HelpCircle, Download, ChevronDown, ChevronRight, CircleCheck, CircleDot, Radio } from "lucide-react";
import { mintPairCode, revokePairCode } from "@/lib/device-pair-actions";

const CODE_KEY = "presentflow.obs.pairCode";
const CHURCH_KEY = "presentflow.obs.pairChurch";
const EXP_KEY = "presentflow.obs.pairExpiresAt";
const LOOK_KEY = "presentflow.obs.look"; // "camera" | "full"

type Look = "camera" | "full";
type Transport = "lan" | "cloud";
type LanInfo = { running: boolean; ip: string | null; port: number | null; clients: number };
type LanApi = {
  start: (port?: number) => Promise<LanInfo>;
  stop: () => Promise<LanInfo>;
  status: () => Promise<LanInfo>;
  publish: (state: unknown) => void;
};

function getLanApi(): LanApi | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { electronAPI?: { lan?: LanApi } }).electronAPI?.lan ?? null;
}

function announce(code: string | null) {
  try { window.dispatchEvent(new CustomEvent("presentflow:obs-pair-code", { detail: { code } })); } catch { /* ignore */ }
}

/** Build the OBS Browser Source URL for the chosen transport + look. */
function buildUrl(opts: { transport: Transport; look: Look; code?: string | null; churchId?: string; lan?: LanInfo | null }): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const bg = opts.look === "camera" ? "&bg=transparent" : ""; // full look = theme background renders
  if (opts.transport === "lan" && opts.lan?.ip && opts.lan.port) {
    const base = `http://${opts.lan.ip}:${opts.lan.port}`;
    return `${base}/livestream?lan=${opts.lan.ip}:${opts.lan.port}${bg}`;
  }
  const churchQ = opts.churchId ? `&church=${encodeURIComponent(opts.churchId)}` : "";
  return `${origin}/livestream?pair=${opts.code ?? ""}${churchQ}${bg}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
    throw new Error("no clipboard");
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }
}

export function ObsOverlayCard() {
  const lanApi = getLanApi();
  const isDesktop = !!lanApi;

  const [look, setLook] = useState<Look>("camera");
  const [transport, setTransport] = useState<Transport>(isDesktop ? "lan" : "cloud");
  const [showWhat, setShowWhat] = useState(false);
  const [showSteps, setShowSteps] = useState(true);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  // Cloud (pair) state
  const [code, setCode] = useState<string | null>(null);
  const [churchId, setChurchId] = useState<string>("");

  // LAN state
  const [lan, setLan] = useState<LanInfo | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Restore the look preference + any still-valid cloud code on mount.
  useEffect(() => {
    try {
      const savedLook = localStorage.getItem(LOOK_KEY);
      if (savedLook === "camera" || savedLook === "full") setLook(savedLook);
      const c = localStorage.getItem(CODE_KEY);
      const ch = localStorage.getItem(CHURCH_KEY) || "";
      const exp = localStorage.getItem(EXP_KEY);
      if (c && exp && Number(exp) > Date.now()) { setCode(c); setChurchId(ch); announce(c); }
      else { localStorage.removeItem(CODE_KEY); localStorage.removeItem(CHURCH_KEY); localStorage.removeItem(EXP_KEY); }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { try { localStorage.setItem(LOOK_KEY, look); } catch { /* ignore */ } }, [look]);

  // Poll LAN status (device count) while the LAN transport is selected.
  useEffect(() => {
    if (!lanApi || transport !== "lan") { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } return; }
    let cancelled = false;
    const tick = async () => { try { const s = await lanApi.status(); if (!cancelled) setLan(s); } catch { /* ignore */ } };
    void tick();
    pollRef.current = setInterval(tick, 2000);
    return () => { cancelled = true; if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [lanApi, transport]);

  const startLan = useCallback(async () => {
    if (!lanApi) return;
    setBusy(true);
    try {
      const info = await lanApi.start();
      setLan(info);
      if (info.running && info.ip) toast.success("Stream server started on your network");
      else if (info.running && !info.ip) toast.error("Server started but no network found — connect this PC to the church WiFi/Ethernet");
      else toast.error("Couldn't start the stream server");
    } finally { setBusy(false); }
  }, [lanApi]);

  const stopLan = useCallback(async () => {
    if (!lanApi) return;
    setBusy(true);
    try { const info = await lanApi.stop(); setLan(info); toast.success("Stream server stopped"); }
    finally { setBusy(false); }
  }, [lanApi]);

  const createCloud = useCallback(async () => {
    setBusy(true);
    try {
      const res = await mintPairCode({ screenKind: "stream", label: "OBS overlay" });
      if (!res.ok) { toast.error(res.error); return; }
      setCode(res.data.code); setChurchId(res.data.churchId);
      announce(res.data.code);
      try {
        localStorage.setItem(CODE_KEY, res.data.code);
        localStorage.setItem(CHURCH_KEY, res.data.churchId);
        localStorage.setItem(EXP_KEY, String(new Date(res.data.expiresAt).getTime()));
      } catch { /* ignore */ }
      toast.success("Internet stream link created");
    } finally { setBusy(false); }
  }, []);

  const revokeCloud = useCallback(async () => {
    if (!code) return;
    setBusy(true);
    try {
      await revokePairCode(code).catch(() => {});
      setCode(null); setChurchId("");
      announce(null);
      try { localStorage.removeItem(CODE_KEY); localStorage.removeItem(CHURCH_KEY); localStorage.removeItem(EXP_KEY); } catch { /* ignore */ }
      toast.success("Internet stream link revoked");
    } finally { setBusy(false); }
  }, [code]);

  // Is the link ready to copy?
  const lanReady = transport === "lan" && !!lan?.running && !!lan?.ip;
  const cloudReady = transport === "cloud" && !!code;
  const ready = lanReady || cloudReady;
  const url = ready ? buildUrl({ transport, look, code, churchId, lan }) : "";

  const doCopy = useCallback(async () => {
    if (!url) return;
    const ok = await copyText(url);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); toast.success("Link copied — now paste it into OBS"); }
    else toast.error("Couldn't copy — select the link and copy it manually");
  }, [url]);

  const openObsDownload = useCallback(() => {
    const dl = "https://obsproject.com/download";
    try {
      const ext = (window as unknown as { electronAPI?: { shell?: { openExternal: (u: string) => void } } }).electronAPI?.shell;
      if (ext) ext.openExternal(dl); else window.open(dl, "_blank", "noopener");
    } catch { window.open(dl, "_blank", "noopener"); }
  }, []);

  // Live status label
  const status: { tone: "off" | "wait" | "on"; label: string } = (() => {
    if (transport === "lan") {
      if (!lan?.running) return { tone: "off", label: "Stream link is off" };
      if (!lan.ip) return { tone: "off", label: "This PC isn't on the church network — connect its WiFi or Ethernet cable" };
      if ((lan.clients ?? 0) > 0) return { tone: "on", label: `Connected — ${lan.clients} ${lan.clients === 1 ? "device" : "devices"}` };
      return { tone: "wait", label: "Waiting for OBS to connect…" };
    }
    // Cloud can't confirm OBS actually connected (no device count), so say
    // "ready", not "live" — don't imply a connection we can't verify.
    return cloudReady ? { tone: "on", label: "Link ready — add it in OBS" } : { tone: "off", label: "No link yet" };
  })();

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-4 space-y-4">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-[var(--color-brand)]/12 text-[var(--color-brand)]">
            <Radio className="w-4 h-4" />
          </div>
          <div className="text-[13px] font-semibold text-[var(--color-foreground)]">Put lyrics on your live stream</div>
        </div>
        <p className="text-[11px] text-[var(--color-muted-foreground)] leading-relaxed">
          Show your song words and Bible verses on your Facebook or YouTube broadcast — in sync with the service, automatically.
        </p>
        <button type="button" onClick={() => setShowWhat((v) => !v)}
          className="text-[10px] text-[var(--color-brand)] hover:underline inline-flex items-center gap-1">
          <HelpCircle className="w-3 h-3" /> What is this? Do I need it?
        </button>
        {showWhat && (
          <div className="mt-1 rounded-md bg-[var(--color-muted)]/40 p-2 text-[10px] text-[var(--color-muted-foreground)] leading-relaxed space-y-1">
            <p><span className="text-[var(--color-foreground)]">In one line:</span> this shows your lyrics and verses on top of the video people watch online, so folks at home can follow along.</p>
            <p><span className="text-[var(--color-foreground)]">OBS</span> is the free program most churches use to send their service to Facebook/YouTube. Your words live on a private web page with a see-through background; OBS lays it over the camera. You just copy one link.</p>
            <p><span className="text-[var(--color-foreground)]">Do you need it?</span> Yes if you stream online and want viewers to see the words. No if you only show words on the screens inside the building — the projector already does that.</p>
          </div>
        )}
      </div>

      {/* Step 1 — the look */}
      <div className="space-y-1.5">
        <div className="eyebrow">1 · How should the words look?</div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setLook("camera")}
            className={`text-left rounded-md border p-2 transition ${look === "camera" ? "border-[var(--color-brand)] bg-[var(--color-brand)]/10" : "border-[var(--color-border)] hover:border-[var(--color-brand)]/40"}`}>
            <div className="text-[11px] font-semibold text-[var(--color-foreground)]">Over your camera</div>
            <div className="text-[10px] text-[var(--color-muted-foreground)] leading-tight">Words on a see-through layer, over the live camera.</div>
          </button>
          <button type="button" onClick={() => setLook("full")}
            className={`text-left rounded-md border p-2 transition ${look === "full" ? "border-[var(--color-brand)] bg-[var(--color-brand)]/10" : "border-[var(--color-border)] hover:border-[var(--color-brand)]/40"}`}>
            <div className="text-[11px] font-semibold text-[var(--color-foreground)]">Full projector look</div>
            <div className="text-[10px] text-[var(--color-muted-foreground)] leading-tight">The theme background + words, exactly like the projector. Best as its own scene (it covers the camera).</div>
          </button>
        </div>
      </div>

      {/* Step 2 — the connection + link */}
      <div className="space-y-2">
        <div className="eyebrow">2 · Create your link</div>
        {isDesktop && (
          <div className="inline-flex rounded-md border border-[var(--color-border)] p-0.5 text-[10px]">
            <button type="button" onClick={() => setTransport("lan")}
              className={`px-2 py-1 rounded inline-flex items-center gap-1 ${transport === "lan" ? "bg-[var(--color-brand)] text-white" : "text-[var(--color-muted-foreground)]"}`}>
              <Wifi className="w-3 h-3" /> Same network <span className="opacity-70">(best)</span>
            </button>
            <button type="button" onClick={() => setTransport("cloud")}
              className={`px-2 py-1 rounded inline-flex items-center gap-1 ${transport === "cloud" ? "bg-[var(--color-brand)] text-white" : "text-[var(--color-muted-foreground)]"}`}>
              <Globe className="w-3 h-3" /> Internet
            </button>
          </div>
        )}

        {transport === "lan" ? (
          <p className="text-[10px] text-[var(--color-muted-foreground)] leading-relaxed">
            For a <span className="text-[var(--color-foreground)]">separate streaming computer on the same WiFi/Ethernet</span>. Most reliable — no internet needed.
          </p>
        ) : (
          <p className="text-[10px] text-[var(--color-muted-foreground)] leading-relaxed">
            Works on any computer with internet — even one at a different location. Uses your private cloud link.
          </p>
        )}

        {/* Persistent warning when the LAN server is on but this PC has no network
            (transient toast alone left a non-technical user at a dead-end). */}
        {transport === "lan" && lan?.running && !lan.ip && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[10px] text-amber-500 leading-relaxed">
            The stream link is on, but this computer isn't on the church network. Connect it to the church WiFi or plug in the Ethernet cable, then turn it off and on again.
          </div>
        )}

        {/* Create / show link */}
        {!ready ? (
          <button type="button"
            onClick={transport === "lan" ? startLan : createCloud}
            disabled={busy}
            className="w-full text-[12px] font-semibold px-3 py-2 rounded-md bg-[var(--color-brand)] text-white hover:opacity-90 disabled:opacity-40">
            {busy ? "Working…" : transport === "lan" ? "Turn on your stream link" : "Create your internet link"}
          </button>
        ) : (
          <>
            <button type="button" onClick={doCopy}
              className="w-full text-left text-[10px] font-mono text-sky-400 hover:text-sky-300 break-all rounded-md border border-[var(--color-border)] p-2"
              title="Copy the OBS Browser Source URL">
              {url}
            </button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={doCopy}
                className="flex-1 text-[12px] font-semibold px-3 py-2 rounded-md bg-[var(--color-brand)] text-white hover:opacity-90 inline-flex items-center justify-center gap-1.5">
                {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy link</>}
              </button>
              <button type="button" onClick={transport === "lan" ? stopLan : revokeCloud} disabled={busy}
                className="text-[11px] font-semibold px-3 py-2 rounded-md border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-red-400 hover:border-red-400/50 disabled:opacity-40">
                {transport === "lan" ? "Turn off" : "Revoke"}
              </button>
            </div>
          </>
        )}

        {/* Live status pill */}
        <div className="flex items-center gap-1.5 text-[10px]">
          {status.tone === "on" ? <CircleCheck className="w-3.5 h-3.5 text-emerald-500" />
            : status.tone === "wait" ? <CircleDot className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
            : <CircleDot className="w-3.5 h-3.5 text-[var(--color-muted-foreground)]" />}
          <span className={status.tone === "on" ? "text-emerald-500 font-semibold" : status.tone === "wait" ? "text-amber-500" : "text-[var(--color-muted-foreground)]"}>
            {status.label}
          </span>
        </div>
      </div>

      {/* Step 3 — add it in OBS */}
      <div className="space-y-2">
        <button type="button" onClick={() => setShowSteps((v) => !v)}
          className="eyebrow flex items-center gap-1 w-full text-left">
          {showSteps ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} 3 · Add it in OBS (about 30 seconds)
        </button>
        {showSteps && (
          <div className="space-y-2">
            <ol className="text-[11px] text-[var(--color-muted-foreground)] leading-relaxed list-decimal pl-4 space-y-1">
              <li>In OBS, find the <span className="text-[var(--color-foreground)]">Sources</span> panel near the bottom.</li>
              <li>Click the <span className="text-[var(--color-foreground)]">+</span> → choose <span className="text-[var(--color-foreground)]">Browser</span>.</li>
              <li>Leave <span className="text-[var(--color-foreground)]">Create new</span> selected, name it <span className="text-[var(--color-foreground)]">Lyrics</span>, click OK.</li>
              <li>Paste your link into the <span className="text-[var(--color-foreground)]">URL</span> box (Ctrl+V).</li>
              <li>Set <span className="text-[var(--color-foreground)]">Width 1920</span> and <span className="text-[var(--color-foreground)]">Height 1080</span>.</li>
              <li>Make sure these two boxes stay <span className="text-[var(--color-foreground)]">unchecked</span> (this keeps the words from disappearing mid-service):</li>
            </ol>
            <div className="ml-6 space-y-1">
              <div className="flex items-start gap-1.5 text-[10px] text-[var(--color-muted-foreground)]">
                <span className="inline-block w-3 h-3 mt-0.5 rounded-sm border border-[var(--color-muted-foreground)]" />
                <span><span className="text-[var(--color-foreground)]">Shutdown source when not visible</span> — leave unchecked</span>
              </div>
              <div className="flex items-start gap-1.5 text-[10px] text-[var(--color-muted-foreground)]">
                <span className="inline-block w-3 h-3 mt-0.5 rounded-sm border border-[var(--color-muted-foreground)]" />
                <span><span className="text-[var(--color-foreground)]">Refresh browser when scene becomes active</span> — leave unchecked</span>
              </div>
            </div>
            <ol start={7} className="text-[11px] text-[var(--color-muted-foreground)] leading-relaxed list-decimal pl-4 space-y-1">
              <li>Click OK. Drag the red handles to move or resize the words.</li>
              {look === "camera" && (
                <li>Make sure <span className="text-[var(--color-foreground)]">Lyrics</span> sits <span className="text-[var(--color-foreground)]">above your camera</span> in the Sources list — if you don&apos;t see the words, drag it to the top.</li>
              )}
              <li>The status above turns <span className="text-emerald-500 font-semibold">green</span> the moment OBS connects — send any slide to test.</li>
            </ol>
            <button type="button" onClick={openObsDownload}
              className="text-[10px] text-[var(--color-brand)] hover:underline inline-flex items-center gap-1">
              <Download className="w-3 h-3" /> Don't have OBS yet? Download it free (2 min)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
