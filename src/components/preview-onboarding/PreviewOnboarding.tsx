"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { parseReferences } from "@/lib/bible-parser";
import { lookupDemoVerse, DEMO_VERSE_SUGGESTIONS, type DemoVerse } from "@/lib/preview-onboarding/demoVerses";

// DEV PREVIEW of the new onboarding — "get your church ready for Sunday".
// Isolated at /preview/onboarding; does NOT touch the live wizard. Uses the
// locked "Every service, on autopilot" design language + the WebGL backdrop.
// Web-demoable pieces only: live mic meter (getUserMedia) + the magic moment
// (Web Speech / typed → parse → project a bundled KJV verse). Real projector
// output happens in the desktop app — the banner says so.
const LoginScene = dynamic(() => import("@/components/auth/LoginScene"), { ssr: false });

const SECTIONS = ["Welcome", "Let it listen", "Try it live", "Ready for Sunday"];
const COMING_FROM = ["ProPresenter", "EasyWorship", "VideoPsalm", "Proclaim", "PowerPoint / Keynote", "OpenLP", "MediaShout", "First system"];

const CSS = `
.pfob{--ink:#0a0908;--paper:#ECE7E0;--paper-2:#c9c2b8;--paper-dim:#8a847b;--paper-faint:#4a4640;
  --orange:#ff7a2c;--orange-glow:#ffb861;--hair:rgba(236,231,224,0.12);--hair-strong:rgba(236,231,224,0.28);--good:#46c08a;
  position:fixed;inset:0;overflow:hidden;background:var(--ink);color:var(--paper);
  font-family:"Plus Jakarta Sans",system-ui,sans-serif;letter-spacing:-0.005em;-webkit-font-smoothing:antialiased}
.pfob *{box-sizing:border-box}
.pfob .scene{position:absolute;inset:0;z-index:0}
.pfob .vignette{position:absolute;inset:0;z-index:1;pointer-events:none;background:radial-gradient(120% 80% at 50% 55%,transparent 55%,rgba(0,0,0,.6) 100%)}
.pfob .grid{position:relative;z-index:2;height:100%;display:grid;grid-template-columns:1.25fr 0.75fr}
.pfob .brandbar{position:absolute;top:28px;left:36px;z-index:4;display:flex;align-items:center;gap:11px}
.pfob .brandbar img{height:28px}
.pfob .brandbar b{font-family:"Sora",sans-serif;font-weight:700;font-size:18px;letter-spacing:-0.03em}
.pfob .brandbar b em{font-style:normal;color:var(--orange)}
.pfob .pill{position:absolute;top:30px;right:36px;z-index:4;font-family:ui-monospace,Menlo,monospace;font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--orange);border:1px solid var(--hair-strong);border-radius:999px;padding:5px 11px}
/* STAGE (left) */
.pfob .stage{position:relative;display:flex;align-items:center;justify-content:center;padding:64px}
.pfob .stagecard{width:100%;max-width:660px;aspect-ratio:16/9;border-radius:14px;border:1px solid var(--hair);background:linear-gradient(180deg,#0e0d12,#08070a);box-shadow:0 40px 120px -50px #000,inset 0 1px 0 rgba(255,255,255,.04);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:44px;position:relative;overflow:hidden;transition:border-color .4s,box-shadow .4s}
.pfob .stagecard.live{border-color:color-mix(in oklab,var(--orange) 55%,var(--hair));box-shadow:0 40px 120px -40px rgba(255,122,44,.4),inset 0 1px 0 rgba(255,255,255,.05)}
.pfob .stage-idle{color:var(--paper-faint);font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.22em;text-transform:uppercase}
.pfob .stage-brand{font-family:"Sora",sans-serif;font-weight:700;font-size:clamp(26px,3.4vw,44px);letter-spacing:-.03em;line-height:1.05;text-wrap:balance}
.pfob .stage-brand em{font-style:normal;color:var(--orange)}
.pfob .verse{font-family:"Sora",sans-serif;font-weight:600;font-size:clamp(19px,2.5vw,30px);line-height:1.28;letter-spacing:-.01em;color:#fff;text-wrap:balance;animation:pfvin .5s ease both}
.pfob .verseref{margin-top:22px;font-family:ui-monospace,Menlo,monospace;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--orange-glow)}
@keyframes pfvin{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.pfob .livedot{position:absolute;top:14px;left:16px;display:flex;align-items:center;gap:6px;font-family:ui-monospace,Menlo,monospace;font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:#ff5a5a}
.pfob .livedot i{width:7px;height:7px;border-radius:50%;background:#ff3b3b;box-shadow:0 0 0 0 rgba(255,59,59,.6);animation:pfpulse 1.4s infinite}
@keyframes pfpulse{0%{box-shadow:0 0 0 0 rgba(255,59,59,.55)}70%{box-shadow:0 0 0 9px rgba(255,59,59,0)}100%{box-shadow:0 0 0 0 rgba(255,59,59,0)}}
/* CONTROLS (right) */
.pfob .panel{border-left:1px solid var(--hair);background:linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.4));backdrop-filter:blur(2px);padding:88px 52px 44px;display:flex;flex-direction:column;overflow-y:auto}
.pfob .rail{display:flex;gap:6px;margin-bottom:30px}
.pfob .rail i{height:3px;flex:1;border-radius:2px;background:var(--hair);transition:background .4s}
.pfob .rail i.on{background:linear-gradient(90deg,var(--orange-glow),var(--orange))}
.pfob .eyebrow{font-family:ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:var(--orange);margin-bottom:14px}
.pfob h1{font-family:"Sora",sans-serif;font-weight:700;font-size:clamp(26px,2.8vw,36px);line-height:1.08;letter-spacing:-.03em;margin:0 0 12px;text-wrap:balance}
.pfob h1 em{font-style:normal;color:var(--orange)}
.pfob .sub{color:var(--paper-dim);font-size:15px;line-height:1.55;margin:0 0 26px;max-width:42ch}
.pfob label.fld{display:block;font-family:ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--paper-dim);margin:0 0 8px}
.pfob input.txt{width:100%;background:transparent;border:0;border-bottom:1px solid var(--hair-strong);padding:11px 2px;color:var(--paper);font-family:"Plus Jakarta Sans";font-size:16px;outline:none;transition:border-color .2s;margin-bottom:24px}
.pfob input.txt:focus{border-bottom-color:var(--paper)}
.pfob .chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:28px}
.pfob .chip{font-size:12.5px;padding:7px 13px;border-radius:999px;border:1px solid var(--hair-strong);background:transparent;color:var(--paper-2);cursor:pointer;transition:all .15s;font-family:inherit}
.pfob .chip:hover{border-color:var(--paper-dim)}
.pfob .chip.sel{border-color:var(--orange);background:color-mix(in oklab,var(--orange) 16%,transparent);color:#fff}
.pfob button.cta{margin-top:auto;width:100%;background:linear-gradient(180deg,var(--orange-glow),var(--orange));color:#0a0908;border:0;padding:15px 20px;border-radius:11px;font-family:"Sora",sans-serif;font-weight:700;font-size:16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;box-shadow:0 8px 32px -12px rgba(255,122,44,.55);transition:filter .2s,transform .09s}
.pfob button.cta:hover{filter:brightness(1.06)}
.pfob button.cta:active{transform:scale(.99)}
.pfob button.cta:disabled{opacity:.5;cursor:default;filter:grayscale(.3)}
.pfob button.ghost{background:none;border:0;color:var(--paper-dim);font-size:13px;cursor:pointer;text-decoration:underline;text-underline-offset:2px;margin-top:14px;font-family:inherit}
.pfob .meter{height:12px;border-radius:6px;background:var(--hair);overflow:hidden;margin:6px 0 8px}
.pfob .meter>i{display:block;height:100%;width:0%;background:linear-gradient(90deg,var(--good),var(--orange-glow),var(--orange));border-radius:6px;transition:width .08s linear}
.pfob .heard{display:inline-flex;align-items:center;gap:7px;color:var(--good);font-size:14px;font-weight:600;margin-top:6px;opacity:0;transition:opacity .3s}
.pfob .heard.on{opacity:1}
.pfob .transcript{min-height:44px;border:1px dashed var(--hair-strong);border-radius:10px;padding:12px 14px;color:var(--paper-2);font-size:15px;line-height:1.4;margin-bottom:14px}
.pfob .transcript .muted{color:var(--paper-faint)}
.pfob .detect{display:flex;align-items:center;gap:10px;border:1px solid color-mix(in oklab,var(--orange) 45%,var(--hair));background:color-mix(in oklab,var(--orange) 10%,transparent);border-radius:10px;padding:11px 14px;margin-bottom:16px;animation:pfvin .35s ease both}
.pfob .detect b{color:#fff;font-family:"Sora",sans-serif;font-weight:700}
.pfob .detect .pct{margin-left:auto;font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--good)}
.pfob .note{font-size:12.5px;color:var(--paper-faint);line-height:1.5;margin-top:14px}
.pfob .checks{display:flex;flex-direction:column;gap:11px;margin:6px 0 26px}
.pfob .checks .row{display:flex;align-items:center;gap:11px;font-size:15px;color:var(--paper-2)}
.pfob .checks .tick{width:22px;height:22px;border-radius:50%;background:color-mix(in oklab,var(--good) 22%,transparent);color:var(--good);display:grid;place-items:center;font-size:12px;flex:none}
.pfob .banner{position:absolute;bottom:0;left:0;right:0;z-index:5;text-align:center;font-size:11px;color:var(--paper-faint);padding:9px;background:rgba(0,0,0,.4);border-top:1px solid var(--hair);font-family:ui-monospace,Menlo,monospace;letter-spacing:.04em}
@media (max-width:940px){.pfob .grid{grid-template-columns:1fr}.pfob .stage{display:none}.pfob .panel{border-left:0;padding-top:80px}}
@media (prefers-reduced-motion:reduce){.pfob .verse,.pfob .detect{animation:none}}
`;

type SpeechRec = { start: () => void; stop: () => void; abort: () => void; onresult: ((e: unknown) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; continuous: boolean; interimResults: boolean; lang: string };

export function PreviewOnboarding() {
  const [step, setStep] = useState(0);
  const [church, setChurch] = useState("");
  const [from, setFrom] = useState<string | null>(null);

  // Listen step
  const [micOn, setMicOn] = useState(false);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const micStream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  // Magic moment
  const [transcript, setTranscript] = useState("");
  const [typed, setTyped] = useState("");
  const [verse, setVerse] = useState<DemoVerse | null>(null);
  const [conf, setConf] = useState(0);
  const [listening, setListening] = useState(false);
  const [speechOk, setSpeechOk] = useState(true);
  const recRef = useRef<SpeechRec | null>(null);

  const stopMic = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    micStream.current?.getTracks().forEach((t) => t.stop());
    micStream.current = null;
    audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    setMicOn(false);
    setLevel(0);
  }, []);

  const startMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStream.current = stream;
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      audioCtx.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      setMicOn(true);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128));
        const pct = Math.min(100, Math.round((peak / 90) * 100));
        setLevel(pct);
        if (pct > 14) setHeard(true);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setMicOn(false);
    }
  }, []);

  // Detect a reference from a piece of text → bundled verse.
  const tryDetect = useCallback((text: string) => {
    if (!text.trim()) return;
    const refs = parseReferences(text);
    for (const r of refs) {
      const v = lookupDemoVerse(r.book, r.chapter, r.verseStart);
      if (v) {
        setVerse(v);
        setConf(90 + Math.floor((text.length % 9)));
        return;
      }
    }
  }, []);

  const startListening = useCallback(() => {
    const SR = (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec; SpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition
      || (window as unknown as { SpeechRecognition?: new () => SpeechRec }).SpeechRecognition;
    if (!SR) { setSpeechOk(false); return; }
    try {
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";
      rec.onresult = (e: unknown) => {
        const ev = e as { results: ArrayLike<ArrayLike<{ transcript: string }>> };
        let t = "";
        for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
        setTranscript(t);
        tryDetect(t);
      };
      rec.onerror = () => { setListening(false); };
      rec.onend = () => { setListening(false); };
      recRef.current = rec;
      rec.start();
      setListening(true);
    } catch { setSpeechOk(false); }
  }, [tryDetect]);

  const stopListening = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }, []);

  useEffect(() => () => { stopMic(); recRef.current?.abort?.(); }, [stopMic]);
  // Leaving the Listen or Try-it steps releases the mic / recognizer.
  useEffect(() => { if (step !== 1) stopMic(); if (step !== 2) stopListening(); }, [step, stopMic, stopListening]);

  const rail = SECTIONS.map((_, i) => <i key={i} className={i <= step ? "on" : ""} />);

  return (
    <div className="pfob">
      <style>{CSS}</style>
      <div className="scene"><LoginScene /></div>
      <div className="vignette" />
      <div className="brandbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/pf-logo-mark.png" alt="PresentFlow" />
        <b>Present<em>Flow</em></b>
      </div>
      <div className="pill">Preview · {SECTIONS[step]}</div>

      <div className="grid">
        {/* STAGE */}
        <div className="stage">
          <div className={`stagecard${verse && step === 2 ? " live" : ""}`}>
            {verse && step === 2 ? (
              <>
                <div className="livedot"><i />Live</div>
                <div className="verse">{verse.text}</div>
                <div className="verseref">{verse.ref} · {verse.translation}</div>
              </>
            ) : step === 3 ? (
              <div className="stage-brand">You&apos;re ready for<br /><em>Sunday.</em></div>
            ) : step === 2 ? (
              <div className="stage-idle">Your church screen</div>
            ) : (
              <div className="stage-brand">Every service,<br /><em>on autopilot.</em></div>
            )}
          </div>
        </div>

        {/* CONTROLS */}
        <div className="panel">
          <div className="rail">{rail}</div>

          {step === 0 && (
            <>
              <div className="eyebrow">Let&apos;s get you ready</div>
              <h1>Welcome to <em>PresentFlow</em>.</h1>
              <p className="sub">In a few minutes you&apos;ll connect your screens, test your audio, and put a Bible verse on the projector — everything you need for Sunday.</p>
              <label className="fld">Church name</label>
              <input className="txt" value={church} onChange={(e) => setChurch(e.target.value)} placeholder="Grace Chapel" />
              <label className="fld">What are you coming from?</label>
              <div className="chips">
                {COMING_FROM.map((c) => (
                  <button key={c} className={`chip${from === c ? " sel" : ""}`} onClick={() => setFrom(c)}>{c}</button>
                ))}
              </div>
              <button className="cta" onClick={() => setStep(1)}>Set up my church <span>→</span></button>
            </>
          )}

          {step === 1 && (
            <>
              <div className="eyebrow">Section 2 · Let it listen</div>
              <h1>Can PresentFlow <em>hear</em> your service?</h1>
              <p className="sub">PresentFlow listens to your service to show verses and lyrics automatically. Let&apos;s make sure it hears you — connect your mic or mixer and speak.</p>
              {!micOn ? (
                <button className="cta" style={{ marginTop: 0 }} onClick={startMic}>Turn on the microphone <span>🎙</span></button>
              ) : (
                <>
                  <label className="fld">Input level — say &ldquo;Welcome to PresentFlow&rdquo;</label>
                  <div className="meter"><i style={{ width: `${level}%` }} /></div>
                  <span className={`heard${heard ? " on" : ""}`}>✓ We can hear you</span>
                </>
              )}
              <p className="note">On the desktop app you&apos;ll pick your exact device — a USB mic, or your Behringer / mixer via USB or an audio interface. In this web preview we just use your computer mic to prove the flow.</p>
              <button className="cta" disabled={!heard} onClick={() => setStep(2)}>{heard ? "It hears me — continue" : "Speak to continue…"} <span>→</span></button>
              <button className="ghost" onClick={() => { setHeard(true); setStep(2); }}>Skip the mic test</button>
            </>
          )}

          {step === 2 && (
            <>
              <div className="eyebrow">Section 2 · Try it live ⭐</div>
              <h1>Say a <em>Bible reference</em>.</h1>
              <p className="sub">This is the moment. Say a verse out loud — like &ldquo;John 3:16&rdquo; or &ldquo;Romans 8:1&rdquo; — and watch PresentFlow hear it, find it, and put it on the screen.</p>
              <div className="transcript">{transcript ? transcript : <span className="muted">{listening ? "Listening…" : "Press the button and speak, or type a reference below."}</span>}</div>
              {verse && <div className="detect"><b>{verse.ref}</b> detected<span className="pct">{conf}%</span></div>}
              {speechOk ? (
                !listening ? (
                  <button className="cta" style={{ marginTop: 0 }} onClick={startListening}>Start listening <span>🎙</span></button>
                ) : (
                  <button className="cta" style={{ marginTop: 0, background: "var(--hair-strong)", color: "var(--paper)", boxShadow: "none" }} onClick={stopListening}>Stop listening <span>■</span></button>
                )
              ) : null}
              <label className="fld" style={{ marginTop: 18 }}>{speechOk ? "…or type it" : "Type a reference (your browser doesn't support voice here)"}</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="txt" style={{ marginBottom: 0 }} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="John 3:16"
                  onKeyDown={(e) => { if (e.key === "Enter") { setTranscript(typed); tryDetect(typed); } }} />
                <button className="cta" style={{ marginTop: 0, width: "auto", padding: "0 18px" }} onClick={() => { setTranscript(typed); tryDetect(typed); }}>Detect</button>
              </div>
              <p className="note">Try: {DEMO_VERSE_SUGGESTIONS.join(" · ")} <br />(Preview uses a few built-in verses; the real app has every verse + your translations.)</p>
              <button className="cta" disabled={!verse} onClick={() => setStep(3)}>{verse ? "That's PresentFlow — continue" : "Detect a verse to continue…"} <span>→</span></button>
            </>
          )}

          {step === 3 && (
            <>
              <div className="eyebrow">Ready for Sunday</div>
              <h1>That&apos;s <em>PresentFlow</em>.</h1>
              <p className="sub">{church ? `${church} is` : "You're"} set up. In the desktop app this is exactly how your team runs a live service — screens, audio, and verses on the projector automatically.</p>
              <div className="checks">
                <div className="row"><span className="tick">✓</span> Church set up{from ? ` — coming from ${from}` : ""}</div>
                <div className="row"><span className="tick">✓</span> Audio tested — it can hear you</div>
                <div className="row"><span className="tick">✓</span> Live Bible detection working</div>
                <div className="row"><span className="tick">✓</span> Verse on the church screen</div>
              </div>
              <p className="note">Next (in the full flow): bring your songs, learn Bible search, add media, pick a theme, and build your first service. Real projector + stage output run in the desktop app.</p>
              <Link href="/dashboard" style={{ textDecoration: "none" }}><button className="cta">Open my dashboard <span>→</span></button></Link>
              <button className="ghost" onClick={() => { setStep(0); setVerse(null); setTranscript(""); setTyped(""); setHeard(false); }}>Restart the preview</button>
            </>
          )}
        </div>
      </div>

      <div className="banner">Preview mode — real projector &amp; stage output, mixer selection, and full Bible + song libraries run in the desktop app.</div>
    </div>
  );
}
