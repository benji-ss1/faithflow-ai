"use client";
// "Put lyrics on your live stream" — a dead-simple guided wizard + a full OBS
// EDITOR for non-technical operators to show live lyrics/scripture on their
// Facebook/YouTube stream via OBS. Placed in Hardware → Screens.
//
// TWO transports:
//  - LAN (desktop only, RECOMMENDED for a separate streaming PC on the same
//    network): electron/lan/LanOverlayServer.ts; OBS points at the LAN address.
//  - Internet link (works everywhere, incl. web): private pair-code Realtime link.
//
// THREE looks, all editable BEFORE and AFTER a link exists (2026-09-14):
//  - Over your camera (transparent full-frame words)
//  - Lower third (broadcast band)
//  - Full projector look (theme background + words)
// Every control is published LIVE as OutputState.obsLook / obsLowerThird via the
// operator console (BroadcastChannel primary, Realtime + LAN fan-out) and read
// ONLY by /livestream — the projector/stage never change. The preview renders the
// ACTUAL live slide through the same OutputCompositor + resolveObsRender path the
// OBS page uses, in a 1920×1080 frame scaled into the card → preview == OBS.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Wifi, Globe, Copy, Check, HelpCircle, Download, ChevronDown, ChevronRight, CircleCheck, CircleDot, Radio } from "lucide-react";
import { mintPairCode, revokePairCode } from "@/lib/device-pair-actions";
import { obsBandParams, clampObsBand, placementToTop, topToPlacement, DEFAULT_OBS_BAND, OBS_BAND_STYLES, OBS_BAND_STYLE_META, type ObsBandConfig } from "@/lib/obs-lowerthird";
import {
  OBS_EDITOR_KEY, LEGACY_BAND_KEY, LEGACY_LOOK_KEY, DEFAULT_OBS_LOOK_SETTINGS, OBS_PREVIEW_EVENT, OBS_PREVIEW_SAMPLES,
  readObsEditorStore, readObsPreviewState, resolveObsRender, obsThemeColorsOf,
  type ObsEditorStore, type ObsLook, type ObsLookSettings, type ObsTextColor,
} from "@/lib/obs-look";
import { sanitizeOutputState, type OutputState, type SlidePayload } from "@/lib/broadcast";
import { OutputCompositor } from "@/components/live/OutputCompositor";

const CODE_KEY = "presentflow.obs.pairCode";
const CHURCH_KEY = "presentflow.obs.pairChurch";
const EXP_KEY = "presentflow.obs.pairExpiresAt";

type Look = ObsLook;
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

/** Build the OBS Browser Source URL for the chosen transport + look. `&live=1`
 *  opts THIS link into following the editor's live look choice; links pasted
 *  before (no live=1) keep their URL look. */
function buildUrl(opts: { transport: Transport; look: Look; code?: string | null; churchId?: string; lan?: LanInfo | null; band?: ObsBandConfig }): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const extra = opts.look === "camera"
    ? "&bg=transparent"
    : opts.look === "lowerthird"
      ? `&obs=lowerthird&${obsBandParams(opts.band ?? DEFAULT_OBS_BAND)}`
      : "";
  const extra2 = `${extra}&live=1`;
  if (opts.transport === "lan" && opts.lan?.ip && opts.lan.port) {
    const base = `http://${opts.lan.ip}:${opts.lan.port}`;
    return `${base}/livestream?lan=${opts.lan.ip}:${opts.lan.port}${extra2}`;
  }
  const churchQ = opts.churchId ? `&church=${encodeURIComponent(opts.churchId)}` : "";
  return `${origin}/livestream?pair=${opts.code ?? ""}${churchQ}${extra2}`;
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

/** Swatch colours for the style picker tiles only (the big preview is the real renderer). */
function bandSwatch(style: ObsBandConfig["style"]): string {
  switch (style) {
    case "grey": return "rgba(75,85,99,.8)";
    case "black": return "rgba(0,0,0,.85)";
    case "clear": return "transparent";
    case "gradient": return "linear-gradient(180deg, rgba(0,0,0,.8), rgba(0,0,0,0))";
    case "frost": return "rgba(255,255,255,.8)";
    case "theme": return "linear-gradient(135deg, rgba(67,56,202,.8), rgba(124,58,237,.8))";
  }
}

/** A compact labelled slider. */
function BandSlider(props: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="flex items-center justify-between text-[10px] text-[var(--color-muted-foreground)] mb-0.5">
        <span>{props.label}</span>
        <span className="tabular-nums text-[var(--color-foreground)]">{props.step < 1 ? props.value.toFixed(2) : Math.round(props.value)}{props.suffix ?? ""}</span>
      </div>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-brand)] cursor-pointer" />
    </label>
  );
}

/** Segmented picker. */
function Segmented<T extends string>(props: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-[var(--color-muted-foreground)]">{props.label}</div>
      <div className="flex rounded-md border border-[var(--color-border)] p-0.5 text-[10px]">
        {props.options.map((o) => (
          <button key={o.id} type="button" onClick={() => props.onChange(o.id)} aria-pressed={props.value === o.id}
            className={`flex-1 px-1.5 py-1 rounded ${props.value === o.id ? "bg-[var(--color-brand)] text-white" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Text colour: Auto / White / Black / Theme / custom hex. */
function TextColorPicker(props: { value: ObsTextColor; onChange: (v: ObsTextColor) => void }) {
  const isCustom = props.value.startsWith("#");
  const named: { id: ObsTextColor; label: string }[] = [
    { id: "auto", label: "Auto" }, { id: "white", label: "White" }, { id: "black", label: "Black" }, { id: "theme", label: "Theme" },
  ];
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-[var(--color-muted-foreground)]">Text colour</div>
      <div className="flex items-center gap-1 text-[10px]">
        {named.map((o) => (
          <button key={o.id} type="button" onClick={() => props.onChange(o.id)} aria-pressed={props.value === o.id}
            className={`px-1.5 py-1 rounded border ${props.value === o.id ? "border-[var(--color-brand)] bg-[var(--color-brand)]/15 text-[var(--color-foreground)]" : "border-[var(--color-border)] text-[var(--color-muted-foreground)]"}`}>
            {o.label}
          </button>
        ))}
        <label className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer ${isCustom ? "border-[var(--color-brand)] bg-[var(--color-brand)]/15" : "border-[var(--color-border)]"}`} title="Custom colour">
          <input type="color" value={isCustom ? (props.value.length === 4 ? `#${props.value.slice(1).split("").map((c) => c + c).join("")}` : props.value) : "#ffd400"}
            onChange={(e) => props.onChange(e.target.value as ObsTextColor)} className="w-4 h-4 p-0 border-0 bg-transparent cursor-pointer" />
          <span className="text-[var(--color-muted-foreground)]">Custom</span>
        </label>
      </div>
    </div>
  );
}

/** Live 16:9 preview — the REAL renderer at 1920×1080, scaled into the card. */
function ObsPreview(props: { store: ObsEditorStore; state: OutputState | null; sample: "song" | "verse" }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / 1920);
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const st = props.state;
  const liveSlide: SlidePayload | null = st?.live ?? null;
  const hasLive = !!liveSlide && liveSlide.kind !== "empty";
  const slide = hasLive ? liveSlide! : OBS_PREVIEW_SAMPLES[props.sample];
  const appearance = st?.appearance ?? null;
  const themeColors = obsThemeColorsOf(appearance);
  const { store } = props;
  // Preview shows the SELECTED look (even before it's published live) with the
  // editor's band + settings — resolved exactly as /livestream resolves them.
  const r = resolveObsRender({
    url: { transparent: store.look !== "full", mode: store.look === "lowerthird" ? "lower_third" : "full", band: store.band, live: true },
    liveLook: { ...store.settings, look: store.look },
    liveBand: store.band,
    fontScale: typeof st?.fontScale === "number" ? st.fontScale : 1,
    appearance,
    themeColors,
    lowerThird: st?.lowerThird ?? null,
    hasTemplateBackground: !!st?.background,
  });
  const lt = st?.lowerThird ?? null;
  return (
    <div ref={boxRef} className="relative w-full rounded overflow-hidden border border-[var(--color-border)]"
      style={{ aspectRatio: "16 / 9", background: r.transparent ? "linear-gradient(135deg,#3b4a5a,#6b7c8c)" : "#000" }}
      data-obs-preview-look={r.look}>
      {r.transparent && (
        // Mock camera: a stage + a person silhouette so contrast is judged honestly.
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          <div className="absolute inset-x-0 bottom-0 h-1/3" style={{ background: "linear-gradient(180deg,#5b4a3a,#2e241b)" }} />
          <div className="absolute left-1/2 -translate-x-1/2 bottom-[18%] w-[9%] h-[46%] rounded-t-full" style={{ background: "#1f2937" }} />
          <div className="absolute left-1/2 -translate-x-1/2 bottom-[60%] w-[5%] aspect-square rounded-full" style={{ background: "#c8a27a" }} />
        </div>
      )}
      {scale > 0 && (
        <div className="absolute top-0 left-0" style={{ width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          <OutputCompositor
            mode="livestream"
            slide={slide}
            appearance={r.appearance}
            background={st?.background ?? null}
            videoInput={null}
            fontScale={r.fontScale}
            referenceScale={typeof st?.referenceScale === "number" ? st.referenceScale : 1}
            referenceColor={typeof st?.referenceColor === "string" ? st.referenceColor : undefined}
            transparent={r.transparent}
            obsBand={r.obsBand}
            obsThemeColors={themeColors}
            obsBandExtras={r.obsBandExtras}
            obsOverlay={r.obsOverlay}
            backgroundDim={r.backgroundDim}
            videoMuted
            previewFrozen
            {...(st?.layerOrderV3 === true ? { layerOrderV3: true, ...(st?.themeLayerHidden === true ? { themeLayerHidden: true } : {}) } : {})}
          />
          {r.mode === "full" && lt && (
            <div className="absolute bottom-16 left-16 right-16 max-w-[70%]">
              <div className="bg-black/70 border-l-4 border-[color:var(--color-brand)] p-5">
                <div className="text-white font-semibold text-2xl leading-tight">{lt.line1}</div>
                {lt.line2 && <div className="text-white/70 text-lg mt-1">{lt.line2}</div>}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="absolute top-1 left-1 text-[8px] font-semibold px-1 py-0.5 rounded bg-black/60 text-white/90 pointer-events-none">
        {hasLive ? "LIVE NOW" : "SAMPLE"}
      </div>
    </div>
  );
}

export function ObsOverlayCard() {
  const lanApi = getLanApi();
  const isDesktop = !!lanApi;

  const [store, setStore] = useState<ObsEditorStore>(() => readObsEditorStore(null, null, null));
  const [hydrated, setHydrated] = useState(false);
  const look = store.look;
  const band = store.band;
  const settings = store.settings;
  const [transport, setTransport] = useState<Transport>(isDesktop ? "lan" : "cloud");
  const [showWhat, setShowWhat] = useState(false);
  const [showSteps, setShowSteps] = useState(true);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewState, setPreviewState] = useState<OutputState | null>(null);
  const [sample, setSample] = useState<"song" | "verse">("song");

  // Cloud (pair) state
  const [code, setCode] = useState<string | null>(null);
  const [churchId, setChurchId] = useState<string>("");

  // LAN state
  const [lan, setLan] = useState<LanInfo | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Restore the editor (migrating the legacy band/look) + any still-valid cloud code.
  useEffect(() => {
    try {
      setStore(readObsEditorStore(localStorage.getItem(OBS_EDITOR_KEY), localStorage.getItem(LEGACY_BAND_KEY), localStorage.getItem(LEGACY_LOOK_KEY)));
      const c = localStorage.getItem(CODE_KEY);
      const ch = localStorage.getItem(CHURCH_KEY) || "";
      const exp = localStorage.getItem(EXP_KEY);
      if (c && exp && Number(exp) > Date.now()) { setCode(c); setChurchId(ch); announce(c); }
      else { localStorage.removeItem(CODE_KEY); localStorage.removeItem(CHURCH_KEY); localStorage.removeItem(EXP_KEY); }
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  // Persist the editor AND publish it live: OperatorConsole folds it into
  // OutputState (obsLook + obsLowerThird) so OBS updates INSTANTLY over every
  // transport. Legacy keys are kept in sync so an older build still has the band.
  // Gated on hydration so the mount default never clobbers a saved store.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(OBS_EDITOR_KEY, JSON.stringify(store));
      localStorage.setItem(LEGACY_BAND_KEY, JSON.stringify(store.band));
      localStorage.setItem(LEGACY_LOOK_KEY, store.look);
      window.dispatchEvent(new CustomEvent("presentflow:obs-editor-changed", { detail: store }));
    } catch { /* ignore */ }
  }, [store, hydrated]);

  // Real preview feed: the console's last emitted OutputState (same window).
  useEffect(() => {
    const take = (raw: unknown) => { const s = raw ? sanitizeOutputState(raw) : null; if (s) setPreviewState(s); };
    take(readObsPreviewState());
    const on = (e: Event) => take((e as CustomEvent).detail);
    window.addEventListener(OBS_PREVIEW_EVENT, on);
    return () => window.removeEventListener(OBS_PREVIEW_EVENT, on);
  }, []);

  const pickLook = useCallback((l: Look) => setStore((s) => ({ ...s, look: l, lookLive: true })), []);
  const setBand = useCallback((fn: (b: ObsBandConfig) => ObsBandConfig) => setStore((s) => ({ ...s, band: clampObsBand(fn(s.band)) })), []);
  const setSetting = useCallback(<K extends keyof ObsLookSettings>(k: K, v: ObsLookSettings[K]) => setStore((s) => ({ ...s, settings: { ...s.settings, [k]: v } })), []);
  const resetLook = useCallback(() => setStore((s) => {
    const d = DEFAULT_OBS_LOOK_SETTINGS;
    if (s.look === "lowerthird") return { ...s, band: DEFAULT_OBS_BAND, settings: { ...s.settings, ltText: d.ltText, ltRef: d.ltRef } };
    if (s.look === "camera") return { ...s, settings: { ...s.settings, camScale: d.camScale, camPos: d.camPos, camText: d.camText, camEffect: d.camEffect, camScrim: d.camScrim, camBandPosition: d.camBandPosition, camBandOffsetPct: d.camBandOffsetPct, camBandHeightPct: d.camBandHeightPct, camBandScale: d.camBandScale, camBandOpacity: d.camBandOpacity, camBandStyle: d.camBandStyle } };
    return { ...s, settings: { ...s.settings, fullScale: d.fullScale, fullDim: d.fullDim } };
  }), []);

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
  const url = ready ? buildUrl({ transport, look, code, churchId, lan, band }) : "";

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
    return cloudReady ? { tone: "on", label: "Link ready — add it in OBS" } : { tone: "off", label: "No link yet" };
  })();

  const previewHasLive = !!previewState?.live && previewState.live.kind !== "empty";

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

      {/* Step 1 — the look + the editor (always visible) */}
      <div className="space-y-1.5">
        <div className="eyebrow">1 · How should the words look?</div>
        <div className="space-y-1.5">
          {([
            { id: "camera" as const, title: "Over your camera", desc: "See-through words over the live camera — a lower third or the full frame." },
            { id: "lowerthird" as const, title: "Lower third", desc: "Words in a neat band near the bottom, over the camera. Broadcast style." },
            { id: "full" as const, title: "Full projector look", desc: "Theme background + words, exactly like the projector. Its own scene." },
          ]).map((opt) => (
            <button key={opt.id} type="button" onClick={() => pickLook(opt.id)} aria-pressed={look === opt.id}
              className={`w-full text-left rounded-md border px-2.5 py-2 transition flex items-baseline gap-2 ${look === opt.id ? "border-[var(--color-brand)] bg-[var(--color-brand)]/10" : "border-[var(--color-border)] hover:border-[var(--color-brand)]/40"}`}>
              <span className="text-[11px] font-semibold text-[var(--color-foreground)] shrink-0">{opt.title}</span>
              <span className="text-[10px] text-[var(--color-muted-foreground)] leading-tight">{opt.desc}</span>
            </button>
          ))}
        </div>
        <p className="text-[10px] text-[var(--color-muted-foreground)] leading-relaxed">
          This only changes your <span className="text-[var(--color-foreground)]">OBS stream</span>. Your projector and operator screen stay exactly as they are.
        </p>
        <p className="text-[10px] text-[var(--color-muted-foreground)] leading-relaxed" data-obs-link-note>
          Changes here reach links made with this editor straight away. Older OBS links don&apos;t follow these changes — copy a new link to use them.
        </p>

        <div className="mt-1 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-2.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold text-[var(--color-foreground)]">OBS editor <span className="font-normal text-[var(--color-muted-foreground)]">— {look === "camera" ? "Over your camera" : look === "lowerthird" ? "Lower third" : "Full projector look"}</span></div>
            <div className="flex items-center gap-1.5">
              {look === "camera" && <span className="text-[9px] text-[var(--color-muted-foreground)]" data-obs-reset-hint>Reset keeps your Layout choice</span>}
              <button type="button" onClick={() => { if (window.confirm("Reset this look to its defaults? If you're streaming, viewers will see the change straight away.")) resetLook(); }} className="text-[10px] text-[var(--color-brand)] hover:underline">Reset</button>
            </div>
          </div>
          <ObsPreview store={store} state={previewState} sample={sample} />
          {!previewHasLive && (
            <div className="flex items-center gap-1 text-[10px] text-[var(--color-muted-foreground)]">
              <span>Nothing live — preview with a sample</span>
              {(["song", "verse"] as const).map((s) => (
                <button key={s} type="button" onClick={() => setSample(s)} aria-pressed={sample === s}
                  className={`px-1.5 py-0.5 rounded border ${sample === s ? "border-[var(--color-brand)] text-[var(--color-foreground)]" : "border-[var(--color-border)]"}`}>{s === "song" ? "Song" : "Verse"}</button>
              ))}
            </div>
          )}

          {look === "lowerthird" && (
            <>
              <div className="space-y-1">
                <div className="text-[10px] text-[var(--color-muted-foreground)]">Background</div>
                <div className="grid grid-cols-3 gap-1">
                  {OBS_BAND_STYLES.map((s) => (
                    <button key={s} type="button" onClick={() => setBand((b) => ({ ...b, style: s }))} title={OBS_BAND_STYLE_META[s].hint} aria-pressed={band.style === s}
                      className={`rounded border overflow-hidden transition ${band.style === s ? "border-[var(--color-brand)] ring-1 ring-[var(--color-brand)]" : "border-[var(--color-border)] hover:border-[var(--color-brand)]/50"}`}>
                      <span className="block h-6 relative" style={{ background: "linear-gradient(135deg,#3b4a5a,#6b7c8c)" }}>
                        <span className="absolute inset-x-0 bottom-0 h-3 flex items-center justify-center" style={{ background: bandSwatch(s) }}>
                          <span className="text-[6px] font-bold leading-none" style={{ color: s === "frost" ? "#111" : "#fff" }}>Aa</span>
                        </span>
                      </span>
                      <span className="block text-[8px] text-center py-0.5 text-[var(--color-muted-foreground)] leading-none truncate px-0.5">{OBS_BAND_STYLE_META[s].label}</span>
                    </button>
                  ))}
                </div>
                {band.style === "theme" && (
                  <p className="text-[9.5px] text-[var(--color-muted-foreground)] leading-relaxed">Uses your church&apos;s real theme background &amp; text colour — exactly like the projector.</p>
                )}
              </div>
              <BandSlider label="Height" value={band.heightPct} min={10} max={60} step={1} suffix="%" onChange={(v) => setBand((b) => { const place = topToPlacement(b.topPct, b.heightPct); return { ...b, heightPct: v, topPct: placementToTop(place, v) }; })} />
              <BandSlider label="Position (0 = top · 100 = bottom)" value={topToPlacement(band.topPct, band.heightPct)} min={0} max={100} step={1} suffix="%" onChange={(v) => setBand((b) => ({ ...b, topPct: placementToTop(v, b.heightPct) }))} />
              <BandSlider label="Text size (smaller / bigger)" value={band.fontScale} min={0.5} max={2} step={0.05} onChange={(v) => setBand((b) => ({ ...b, fontScale: v }))} />
              {band.style !== "clear" && (
                <BandSlider label="Background opacity (see-through)" value={Math.round(band.opacity * 100)} min={0} max={100} step={5} suffix="%" onChange={(v) => setBand((b) => ({ ...b, opacity: v / 100 }))} />
              )}
              <TextColorPicker value={settings.ltText} onChange={(v) => setSetting("ltText", v)} />
              <label className="flex items-center gap-1.5 text-[10px] text-[var(--color-muted-foreground)] cursor-pointer">
                <input type="checkbox" checked={settings.ltRef} onChange={(e) => setSetting("ltRef", e.target.checked)} className="accent-[var(--color-brand)]" />
                Show the verse reference (e.g. John 3:16)
              </label>
              <p className="text-[9.5px] text-[var(--color-muted-foreground)] leading-relaxed">Your own lower-third titles (name / title lines) show in this band too, ahead of the lyrics.</p>
            </>
          )}

          {look === "camera" && (
            <Segmented label="Layout" value={settings.camLayout} options={[{ id: "lowerthird", label: "Lower third" }, { id: "full", label: "Full projector" }]} onChange={(v) => setSetting("camLayout", v)} />
          )}

          {look === "camera" && settings.camLayout === "lowerthird" && (
            <>
              <Segmented label="Band position" value={settings.camBandPosition} options={[{ id: "upper", label: "Upper" }, { id: "mid", label: "Mid" }, { id: "lower", label: "Lower" }, { id: "custom", label: "Custom" }]} onChange={(v) => setSetting("camBandPosition", v)} />
              {settings.camBandPosition === "custom" && (
                <BandSlider label="Position (0 = top · 100 = bottom)" value={settings.camBandOffsetPct} min={0} max={100} step={1} suffix="%" onChange={(v) => setSetting("camBandOffsetPct", v)} />
              )}
              <div className="space-y-1">
                <div className="text-[10px] text-[var(--color-muted-foreground)]">Band background</div>
                <div className="grid grid-cols-3 gap-1">
                  {OBS_BAND_STYLES.map((st) => (
                    <button key={st} type="button" onClick={() => setSetting("camBandStyle", st)} title={OBS_BAND_STYLE_META[st].hint} aria-pressed={settings.camBandStyle === st}
                      className={`rounded border overflow-hidden transition ${settings.camBandStyle === st ? "border-[var(--color-brand)] ring-1 ring-[var(--color-brand)]" : "border-[var(--color-border)] hover:border-[var(--color-brand)]/50"}`}>
                      <span className="block h-6 relative" style={{ background: "linear-gradient(135deg,#3b4a5a,#6b7c8c)" }}>
                        <span className="absolute inset-x-0 bottom-0 h-3 flex items-center justify-center" style={{ background: bandSwatch(st) }}>
                          <span className="text-[6px] font-bold leading-none" style={{ color: st === "frost" ? "#111" : "#fff" }}>Aa</span>
                        </span>
                      </span>
                      <span className="block text-[8px] text-center py-0.5 text-[var(--color-muted-foreground)] leading-none truncate px-0.5">{OBS_BAND_STYLE_META[st].label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <BandSlider label="Band height" value={settings.camBandHeightPct} min={10} max={60} step={1} suffix="%" onChange={(v) => setSetting("camBandHeightPct", v)} />
              <BandSlider label="Text size (smaller / bigger)" value={settings.camBandScale} min={0.5} max={2} step={0.05} onChange={(v) => setSetting("camBandScale", v)} />
              {settings.camBandStyle !== "clear" && (
                <BandSlider label="Background opacity (see-through)" value={Math.round(settings.camBandOpacity * 100)} min={0} max={100} step={5} suffix="%" onChange={(v) => setSetting("camBandOpacity", v / 100)} />
              )}
              <TextColorPicker value={settings.camText} onChange={(v) => setSetting("camText", v)} />
            </>
          )}

          {look === "camera" && settings.camLayout === "full" && (
            <>
              <BandSlider label="Text size (smaller / bigger)" value={settings.camScale} min={0.5} max={2} step={0.05} onChange={(v) => setSetting("camScale", v)} />
              <Segmented label="Text position" value={settings.camPos} options={[{ id: "top", label: "Top" }, { id: "middle", label: "Middle" }, { id: "bottom", label: "Bottom" }]} onChange={(v) => setSetting("camPos", v)} />
              <TextColorPicker value={settings.camText} onChange={(v) => setSetting("camText", v)} />
              <Segmented label="Make words easy to read" value={settings.camEffect} options={[{ id: "shadow", label: "Shadow" }, { id: "outline", label: "Outline" }, { id: "none", label: "None" }]} onChange={(v) => setSetting("camEffect", v)} />
              <BandSlider label="Dark background behind words" value={Math.round(settings.camScrim * 100)} min={0} max={90} step={5} suffix="%" onChange={(v) => setSetting("camScrim", v / 100)} />
            </>
          )}

          {look === "full" && (
            <>
              <BandSlider label="Text size (smaller / bigger)" value={settings.fullScale} min={0.5} max={2} step={0.05} onChange={(v) => setSetting("fullScale", v)} />
              <BandSlider label="Darken background" value={Math.round(settings.fullDim * 100)} min={0} max={90} step={5} suffix="%" onChange={(v) => setSetting("fullDim", v / 100)} />
            </>
          )}

          {ready ? (
            <div className="rounded bg-emerald-500/10 border border-emerald-500/30 px-2 py-1.5">
              <p className="text-[10px] text-[var(--color-foreground)] leading-relaxed"><span className="font-semibold text-emerald-500">Changes apply to OBS live</span> — as long as the app is open and OBS is connected, every tweak shows on the stream instantly (a look change reaches links created here). You only need the link the first time you add it in OBS.</p>
            </div>
          ) : (
            <div className="rounded bg-[var(--color-muted)]/30 border border-[var(--color-border)] px-2 py-1.5">
              <p className="text-[10px] text-[var(--color-muted-foreground)] leading-relaxed"><span className="font-semibold text-[var(--color-foreground)]">Preview only</span> — create your link below to send these to OBS.</p>
            </div>
          )}
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
              {(look === "camera" || look === "lowerthird") && (
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
