"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { parseReferences } from "@/lib/bible-parser";
import { lookupDemoVerse, DEMO_VERSE_SUGGESTIONS, type DemoVerse } from "@/lib/preview-onboarding/demoVerses";

// DEV PREVIEW of the DESKTOP-app onboarding — the hardware-forward "get ready for
// Sunday" flow that lives ON the church computer: connect screens → connect the
// mixer → the magic moment → bring your songs. Isolated mockup at
// /preview/desktop-onboarding; does NOT touch the real desktop app. Same locked
// design language as the login/web preview.
const LoginScene = dynamic(() => import("@/components/auth/LoginScene"), { ssr: false });

const SECTIONS = ["Welcome", "Your screens", "Your sound", "The magic moment", "Your songs", "Ready"];
const IMPORT_SOURCES = ["VideoPsalm", "ProPresenter", "EasyWorship (CSV)", "OpenLP", "OpenLyrics", "PowerPoint", "CSV / text"];

const CSS = `
.pfd{--ink:#0a0908;--paper:#ECE7E0;--paper-2:#c9c2b8;--paper-dim:#8a847b;--paper-faint:#4a4640;
  --orange:#ff7a2c;--orange-glow:#ffb861;--hair:rgba(236,231,224,0.12);--hair-strong:rgba(236,231,224,0.28);--good:#46c08a;
  position:fixed;inset:0;overflow:hidden;background:var(--ink);color:var(--paper);
  font-family:"Plus Jakarta Sans",system-ui,sans-serif;letter-spacing:-0.005em;-webkit-font-smoothing:antialiased}
.pfd *{box-sizing:border-box}
.pfd .scene{position:absolute;inset:0;z-index:0}
.pfd .vig{position:absolute;inset:0;z-index:1;pointer-events:none;background:radial-gradient(120% 80% at 50% 55%,transparent 55%,rgba(0,0,0,.6) 100%)}
.pfd .grid{position:relative;z-index:2;height:100%;display:grid;grid-template-columns:1.25fr 0.75fr}
.pfd .brand{position:absolute;top:28px;left:36px;z-index:4;display:flex;align-items:center;gap:11px}
.pfd .brand img{height:28px}.pfd .brand b{font-family:"Sora",sans-serif;font-weight:700;font-size:18px;letter-spacing:-0.03em}
.pfd .brand b em{font-style:normal;color:var(--orange)}
.pfd .tag{position:absolute;top:30px;right:36px;z-index:4;font-family:ui-monospace,Menlo,monospace;font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--orange);border:1px solid var(--hair-strong);border-radius:999px;padding:5px 11px}
.pfd .stage{position:relative;display:flex;align-items:center;justify-content:center;padding:60px}
.pfd .card{width:100%;max-width:680px;aspect-ratio:16/9;border-radius:14px;border:1px solid var(--hair);background:linear-gradient(180deg,#0e0d12,#08070a);box-shadow:0 40px 120px -50px #000;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px;position:relative;overflow:hidden;transition:border-color .4s,box-shadow .4s}
.pfd .card.live{border-color:color-mix(in oklab,var(--orange) 55%,var(--hair));box-shadow:0 40px 120px -40px rgba(255,122,44,.4)}
.pfd .big{font-family:"Sora",sans-serif;font-weight:700;font-size:clamp(24px,3.2vw,42px);letter-spacing:-.03em;line-height:1.06;text-wrap:balance}
.pfd .big em{font-style:normal;color:var(--orange)}
.pfd .verse{font-family:"Sora",sans-serif;font-weight:600;font-size:clamp(18px,2.4vw,29px);line-height:1.28;color:#fff;text-wrap:balance;animation:pfin .5s ease both}
.pfd .vref{margin-top:20px;font-family:ui-monospace,Menlo,monospace;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--orange-glow)}
.pfd .livedot{position:absolute;top:14px;left:16px;display:flex;gap:6px;align-items:center;font-family:ui-monospace,Menlo,monospace;font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:#ff5a5a}
.pfd .livedot i{width:7px;height:7px;border-radius:50%;background:#ff3b3b;animation:pfp 1.4s infinite}
@keyframes pfp{0%{box-shadow:0 0 0 0 rgba(255,59,59,.55)}70%{box-shadow:0 0 0 9px rgba(255,59,59,0)}100%{box-shadow:0 0 0 0 rgba(255,59,59,0)}}
@keyframes pfin{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.pfd .screens{display:flex;gap:16px;flex-wrap:wrap;justify-content:center}
.pfd .mon{width:150px}
.pfd .mon .glass{height:84px;border-radius:8px;border:1px solid var(--hair-strong);background:linear-gradient(180deg,#14131a,#0b0a10);display:grid;place-items:center;color:var(--paper-faint);font-size:10px;font-family:ui-monospace,Menlo,monospace;position:relative}
.pfd .mon.aud .glass{border-color:color-mix(in oklab,var(--orange) 50%,var(--hair));color:var(--orange)}
.pfd .mon .lbl{margin-top:8px;font-size:11px;text-align:center;color:var(--paper-2)}
.pfd .mon .stand{width:34px;height:8px;background:var(--hair-strong);margin:5px auto 0;border-radius:0 0 3px 3px}
.pfd .panel{border-left:1px solid var(--hair);background:linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.4));backdrop-filter:blur(2px);padding:88px 50px 52px;display:flex;flex-direction:column;overflow-y:auto}
.pfd .rail{display:flex;gap:5px;margin-bottom:28px}
.pfd .rail i{height:3px;flex:1;border-radius:2px;background:var(--hair);transition:background .4s}
.pfd .rail i.on{background:linear-gradient(90deg,var(--orange-glow),var(--orange))}
.pfd .eyebrow{font-family:ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:var(--orange);margin-bottom:13px}
.pfd h1{font-family:"Sora",sans-serif;font-weight:700;font-size:clamp(24px,2.6vw,33px);line-height:1.1;letter-spacing:-.03em;margin:0 0 12px;text-wrap:balance}
.pfd h1 em{font-style:normal;color:var(--orange)}
.pfd .sub{color:var(--paper-dim);font-size:14.5px;line-height:1.55;margin:0 0 22px;max-width:44ch}
.pfd label.fl{display:block;font-family:ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--paper-dim);margin:0 0 8px}
.pfd select.sel,.pfd input.txt{width:100%;background:transparent;border:0;border-bottom:1px solid var(--hair-strong);padding:11px 2px;color:var(--paper);font-family:"Plus Jakarta Sans";font-size:16px;outline:none;margin-bottom:20px}
.pfd select.sel option{background:#14131a}
.pfd .chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px}
.pfd .chip{font-size:12.5px;padding:7px 13px;border-radius:999px;border:1px solid var(--hair-strong);background:transparent;color:var(--paper-2);cursor:pointer;font-family:inherit;transition:all .15s}
.pfd .chip.sel{border-color:var(--orange);background:color-mix(in oklab,var(--orange) 16%,transparent);color:#fff}
.pfd button.cta{margin-top:auto;width:100%;background:linear-gradient(180deg,var(--orange-glow),var(--orange));color:#0a0908;border:0;padding:15px 20px;border-radius:11px;font-family:"Sora",sans-serif;font-weight:700;font-size:16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;box-shadow:0 8px 32px -12px rgba(255,122,44,.55);transition:filter .2s,transform .09s}
.pfd button.cta:hover{filter:brightness(1.06)}.pfd button.cta:active{transform:scale(.99)}
.pfd button.cta:disabled{opacity:.5;cursor:default;filter:grayscale(.3)}
.pfd button.gh{background:none;border:0;color:var(--paper-dim);font-size:13px;cursor:pointer;text-decoration:underline;margin-top:13px;font-family:inherit}
.pfd .meter{height:12px;border-radius:6px;background:var(--hair);overflow:hidden;margin:6px 0 8px}
.pfd .meter>i{display:block;height:100%;width:0%;background:linear-gradient(90deg,var(--good),var(--orange-glow),var(--orange));transition:width .08s linear}
.pfd .heard{display:inline-flex;gap:7px;color:var(--good);font-size:14px;font-weight:600;opacity:0;transition:opacity .3s}.pfd .heard.on{opacity:1}
.pfd .transcript{min-height:42px;border:1px dashed var(--hair-strong);border-radius:10px;padding:11px 13px;color:var(--paper-2);font-size:15px;margin-bottom:12px}
.pfd .transcript .m{color:var(--paper-faint)}
.pfd .detect{display:flex;gap:10px;align-items:center;border:1px solid color-mix(in oklab,var(--orange) 45%,var(--hair));background:color-mix(in oklab,var(--orange) 10%,transparent);border-radius:10px;padding:11px 14px;margin-bottom:14px;animation:pfin .35s ease both}
.pfd .detect b{color:#fff;font-family:"Sora";font-weight:700}.pfd .detect .pct{margin-left:auto;font-family:ui-monospace;font-size:11px;color:var(--good)}
.pfd .note{font-size:12.5px;color:var(--paper-faint);line-height:1.5;margin-top:12px}
.pfd .checks{display:flex;flex-direction:column;gap:10px;margin:4px 0 22px}
.pfd .checks .r{display:flex;gap:11px;align-items:center;font-size:15px;color:var(--paper-2)}
.pfd .checks .t{width:22px;height:22px;border-radius:50%;background:color-mix(in oklab,var(--good) 22%,transparent);color:var(--good);display:grid;place-items:center;font-size:12px;flex:none}
.pfd .banner{position:absolute;bottom:0;left:0;right:0;z-index:5;text-align:center;font-size:11px;color:var(--paper-faint);padding:9px;background:rgba(0,0,0,.4);border-top:1px solid var(--hair);font-family:ui-monospace,Menlo,monospace;letter-spacing:.04em}
@media (max-width:940px){.pfd .grid{grid-template-columns:1fr}.pfd .stage{display:none}.pfd .panel{border-left:0;padding-top:78px}}
@media (prefers-reduced-motion:reduce){.pfd .verse,.pfd .detect{animation:none}}
`;

type SpeechRec = { start: () => void; stop: () => void; abort: () => void; onresult: ((e: unknown) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; continuous: boolean; interimResults: boolean; lang: string };

export function PreviewDesktop() {
  const [step, setStep] = useState(0);
  const [church, setChurch] = useState("");
  const [device, setDevice] = useState("");
  const [devices, setDevices] = useState<string[]>([]);

  const [micOn, setMicOn] = useState(false);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const micStream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const [transcript, setTranscript] = useState("");
  const [typed, setTyped] = useState("");
  const [verse, setVerse] = useState<DemoVerse | null>(null);
  const [conf, setConf] = useState(0);
  const [listening, setListening] = useState(false);
  const [speechOk, setSpeechOk] = useState(true);
  const recRef = useRef<SpeechRec | null>(null);

  const [importFrom, setImportFrom] = useState<string | null>("VideoPsalm");

  const stopMic = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    micStream.current?.getTracks().forEach((t) => t.stop());
    micStream.current = null;
    audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    setMicOn(false); setLevel(0);
  }, []);

  const startMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStream.current = stream;
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        setDevices(list.filter((d) => d.kind === "audioinput").map((d) => d.label || "Audio input").slice(0, 8));
      } catch { /* labels need permission */ }
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC(); audioCtx.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser(); analyser.fftSize = 512; src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      setMicOn(true);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0; for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128));
        const pct = Math.min(100, Math.round((peak / 90) * 100));
        setLevel(pct); if (pct > 14) setHeard(true);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch { setMicOn(false); }
  }, []);

  const tryDetect = useCallback((text: string) => {
    if (!text.trim()) return;
    for (const r of parseReferences(text)) {
      const v = lookupDemoVerse(r.book, r.chapter, r.verseStart);
      if (v) { setVerse(v); setConf(90 + (text.length % 9)); return; }
    }
  }, []);

  const startListening = useCallback(() => {
    const SR = (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec; SpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition
      || (window as unknown as { SpeechRecognition?: new () => SpeechRec }).SpeechRecognition;
    if (!SR) { setSpeechOk(false); return; }
    try {
      const rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = "en-US";
      rec.onresult = (e: unknown) => {
        const ev = e as { results: ArrayLike<ArrayLike<{ transcript: string }>> };
        let t = ""; for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
        setTranscript(t); tryDetect(t);
      };
      rec.onerror = () => setListening(false); rec.onend = () => setListening(false);
      recRef.current = rec; rec.start(); setListening(true);
    } catch { setSpeechOk(false); }
  }, [tryDetect]);
  const stopListening = useCallback(() => { recRef.current?.stop(); recRef.current = null; setListening(false); }, []);

  useEffect(() => () => { stopMic(); recRef.current?.abort?.(); }, [stopMic]);
  useEffect(() => { if (step !== 2) stopMic(); if (step !== 3) stopListening(); }, [step, stopMic, stopListening]);

  return (
    <div className="pfd">
      <style>{CSS}</style>
      <div className="scene"><LoginScene /></div>
      <div className="vig" />
      <div className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/pf-logo-mark.png" alt="PresentFlow" /><b>Present<em>Flow</em></b>
      </div>
      <div className="tag">Desktop preview · {SECTIONS[step]}</div>

      <div className="grid">
        <div className="stage">
          <div className={`card${verse && step === 3 ? " live" : ""}`}>
            {step === 1 ? (
              <div className="screens">
                <div className="mon"><div className="glass">Operator</div><div className="stand" /><div className="lbl">This computer</div></div>
                <div className="mon aud"><div className="glass">PresentFlow ✓</div><div className="stand" /><div className="lbl">Audience screen</div></div>
                <div className="mon"><div className="glass">Notes · timer</div><div className="stand" /><div className="lbl">Stage screen</div></div>
              </div>
            ) : verse && step === 3 ? (
              <><div className="livedot"><i />Live</div><div className="verse">{verse.text}</div><div className="vref">{verse.ref} · {verse.translation}</div></>
            ) : step === 2 ? (
              <div className="big" style={{ color: "var(--paper-faint)" }}>Your mixer<br /><em style={{ fontSize: "0.6em" }}>→ PresentFlow</em></div>
            ) : step === 4 ? (
              <div className="big">Bring your<br /><em>whole library.</em></div>
            ) : step === 5 ? (
              <div className="big">Ready for<br /><em>Sunday.</em></div>
            ) : (
              <div className="big">Every service,<br /><em>on autopilot.</em></div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="rail">{SECTIONS.map((_, i) => <i key={i} className={i <= step ? "on" : ""} />)}</div>

          {step === 0 && (<>
            <div className="eyebrow">On the church computer</div>
            <h1>Let&apos;s get <em>{church || "your church"}</em> ready.</h1>
            <p className="sub">This is the PresentFlow desktop app — where your team runs live services. In a few minutes we&apos;ll connect your screens, your mixer, and put a verse on the projector.</p>
            <label className="fl">Church name</label>
            <input className="txt" value={church} onChange={(e) => setChurch(e.target.value)} placeholder="Grace Chapel" />
            <button className="cta" onClick={() => setStep(1)}>Start setup <span>→</span></button>
          </>)}

          {step === 1 && (<>
            <div className="eyebrow">1 · Your screens</div>
            <h1>Connect your <em>screens</em>.</h1>
            <p className="sub">PresentFlow found your displays. Tell it which is the <b>audience screen</b> (the projector / TV your congregation sees) and which is the optional <b>stage screen</b> (notes + timer for the platform). Then we send a test card so you can confirm it&apos;s showing.</p>
            <button className="cta" style={{ marginTop: 0 }} onClick={() => { /* preview: pretend test */ }}>Send a test to the audience screen</button>
            <p className="note">In the desktop app this opens a full-screen &ldquo;Screen connected ✓&rdquo; card on the projector — you confirm you can see it before moving on.</p>
            <button className="cta" onClick={() => setStep(2)}>My screens are set <span>→</span></button>
          </>)}

          {step === 2 && (<>
            <div className="eyebrow">2 · Your sound</div>
            <h1>Connect your <em>mixer</em>.</h1>
            <p className="sub">Bring your service audio in from your mixer (Behringer, X32, Allen &amp; Heath…) over USB, or through a USB audio interface. Pick it here and speak — the meter should move.</p>
            {!micOn ? (
              <button className="cta" style={{ marginTop: 0 }} onClick={startMic}>Detect my audio inputs <span>→</span></button>
            ) : (<>
              {devices.length > 0 && (<><label className="fl">Audio input</label>
                <select className="sel" value={device} onChange={(e) => setDevice(e.target.value)}>
                  <option value="">Choose your mixer / interface…</option>
                  {devices.map((d, i) => <option key={i} value={d}>{d}</option>)}
                </select></>)}
              <label className="fl">Input level — say a few words</label>
              <div className="meter"><i style={{ width: `${level}%` }} /></div>
              <span className={`heard${heard ? " on" : ""}`}>✓ Getting a clean signal</span>
            </>)}
            <p className="note">Tip: for the strongest detection, feed PresentFlow a direct <b>mixer / USB line</b> rather than a room mic — a clean board feed is what it hears best.</p>
            <button className="cta" disabled={!heard} onClick={() => setStep(3)}>{heard ? "Sound is coming in — continue" : "Speak to continue…"} <span>→</span></button>
            <button className="gh" onClick={() => { setHeard(true); setStep(3); }}>Skip for now</button>
          </>)}

          {step === 3 && (<>
            <div className="eyebrow">3 · The magic moment</div>
            <h1>Say a <em>Bible reference</em>.</h1>
            <p className="sub">Say a verse out loud — &ldquo;John 3:16&rdquo;, &ldquo;Romans 8:1&rdquo; — and PresentFlow hears it, finds it, and puts it on the church screen. This is what your team just does, live, every Sunday.</p>
            <div className="transcript">{transcript || <span className="m">{listening ? "Listening…" : "Press start and speak, or type a reference."}</span>}</div>
            {verse && <div className="detect"><b>{verse.ref}</b> detected<span className="pct">{conf}%</span></div>}
            {speechOk && (!listening
              ? <button className="cta" style={{ marginTop: 0 }} onClick={startListening}>Start listening <span>→</span></button>
              : <button className="cta" style={{ marginTop: 0, background: "var(--hair-strong)", color: "var(--paper)", boxShadow: "none" }} onClick={stopListening}>Stop <span>■</span></button>)}
            <label className="fl" style={{ marginTop: 16 }}>{speechOk ? "…or type it" : "Type a reference"}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="txt" style={{ marginBottom: 0 }} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="John 3:16"
                onKeyDown={(e) => { if (e.key === "Enter") { setTranscript(typed); tryDetect(typed); } }} />
              <button className="cta" style={{ marginTop: 0, width: "auto", padding: "0 18px" }} onClick={() => { setTranscript(typed); tryDetect(typed); }}>Detect</button>
            </div>
            <p className="note">Try: {DEMO_VERSE_SUGGESTIONS.join(" · ")}</p>
            <button className="cta" disabled={!verse} onClick={() => setStep(4)}>{verse ? "That's PresentFlow — continue" : "Detect a verse to continue…"} <span>→</span></button>
          </>)}

          {step === 4 && (<>
            <div className="eyebrow">4 · Your songs &amp; library</div>
            <h1>Bring your <em>whole library</em>.</h1>
            <p className="sub">Import everything you already use — songs, media, and themes — from wherever you have it. Your Bibles (NIV, NKJV, NLT, KJV) are already here.</p>
            <label className="fl">Import songs from</label>
            <div className="chips">
              {IMPORT_SOURCES.map((s) => <button key={s} className={`chip${importFrom === s ? " sel" : ""}`} onClick={() => setImportFrom(s)}>{s}</button>)}
            </div>
            <p className="note">{importFrom === "VideoPsalm"
              ? "VideoPsalm: export your songbook to .json (File → Export → JSON) and drop it in — your whole library imports at once."
              : `${importFrom}: drop your export files in and PresentFlow brings the songs across.`}</p>
            <button className="cta" onClick={() => setStep(5)}>Library ready <span>→</span></button>
          </>)}

          {step === 5 && (<>
            <div className="eyebrow">Ready for Sunday</div>
            <h1>That&apos;s <em>PresentFlow</em>.</h1>
            <p className="sub">{church || "Your church"} is set up. Screens, sound, verses, and your library — all ready. Your team runs the whole service from here.</p>
            <div className="checks">
              <div className="r"><span className="t">✓</span> Screens connected + tested</div>
              <div className="r"><span className="t">✓</span> Mixer / audio coming in clean</div>
              <div className="r"><span className="t">✓</span> Live Bible detection working</div>
              <div className="r"><span className="t">✓</span> Library imported{importFrom ? ` from ${importFrom}` : ""}</div>
            </div>
            <Link href="/operator" style={{ textDecoration: "none" }}><button className="cta">Open the operator console <span>→</span></button></Link>
            <button className="gh" onClick={() => { setStep(0); setVerse(null); setTranscript(""); setTyped(""); setHeard(false); }}>Restart the preview</button>
          </>)}
        </div>
      </div>

      <div className="banner">Desktop preview — a mockup of the on-computer setup flow. Screens/audio here use your browser to demo the feel; the real desktop app drives your projector, stage, and mixer directly.</div>
    </div>
  );
}
