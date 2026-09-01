"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * DEV PREVIEW — in-app coachmark onboarding.
 *
 * Mocks the real operator console (the on-church-computer surface) and overlays
 * a guided spotlight tour that points at the ACTUAL controls a church touches on
 * first run: Hardware → Screens, Hardware → Audio, the AI toggle, and the magic
 * moment. This is a MOCKUP at /preview/coachmark-onboarding so the flow/feel can
 * be approved before wiring the real coachmarks into ProOperatorShell. It does
 * NOT touch the live operator console.
 *
 * The tour dims the whole console and cuts a spotlight over the step's target
 * element (measured live via getBoundingClientRect, so it tracks resizes), with
 * a tooltip card beside it. "Welcome" and "Ready" steps are centered with no
 * target. Nothing here drives real hardware — it's a visual walkthrough.
 */

type StepId = "welcome" | "screens" | "audio" | "ai" | "magic" | "ready";
type TargetKey = "screens" | "audio" | "ai" | "magic" | null;

type Step = {
  id: StepId;
  target: TargetKey;
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
};

const STEPS: Step[] = [
  {
    id: "welcome",
    target: null,
    eyebrow: "Get ready for Sunday",
    title: "Let's set up your church.",
    body: "Five quick steps, right here in the app you'll run every service from. We'll connect your screen, your sound, and put a verse on the projector — so the first time you go live, nothing is a surprise.",
    cta: "Start setup",
  },
  {
    id: "screens",
    target: "screens",
    eyebrow: "Step 1 · Your screen",
    title: "Connect your projector.",
    body: "Open Screens and pick the display your congregation sees. PresentFlow sends a test card so you can confirm it's showing before the service — then everything you make live lands there.",
    cta: "Next — sound",
  },
  {
    id: "audio",
    target: "audio",
    eyebrow: "Step 2 · Your sound",
    title: "Connect your mixer.",
    body: "Open Audio and choose your mixer or USB interface (Behringer, X32, Allen & Heath…). Speak, and the level should move. This is the feed PresentFlow listens to during the service.",
    cta: "Next — turn on AI",
  },
  {
    id: "ai",
    target: "ai",
    eyebrow: "Step 3 · Turn it on",
    title: "Switch AI on.",
    body: "This is the switch that makes PresentFlow listen. When it's on, it follows the service — hearing scripture and songs as they happen — and cues them for you.",
    cta: "Next — the magic moment",
  },
  {
    id: "magic",
    target: "magic",
    eyebrow: "Step 4 · The magic moment",
    title: "Say a verse out loud.",
    body: "With AI on, say “John 3:16.” PresentFlow hears it, finds it, and puts it on the church screen — right here in the live panel. That's the whole thing your team does on Sunday.",
    cta: "Next — you're ready",
  },
  {
    id: "ready",
    target: null,
    eyebrow: "Ready for Sunday",
    title: "That's it — you're set.",
    body: "Screen connected, sound coming in, AI listening, a verse on the projector. Everything from here is the same four moves. Your team can keep their eyes on the congregation.",
    cta: "Finish",
  },
];

type Rect = { top: number; left: number; width: number; height: number };

export function PreviewCoachmark() {
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const screensRef = useRef<HTMLButtonElement | null>(null);
  const audioRef = useRef<HTMLButtonElement | null>(null);
  const aiRef = useRef<HTMLButtonElement | null>(null);
  const magicRef = useRef<HTMLDivElement | null>(null);

  const step = STEPS[stepIdx]!;
  const done = stepIdx >= STEPS.length;

  const targetRef = useCallback(
    (key: TargetKey): HTMLElement | null => {
      if (key === "screens") return screensRef.current;
      if (key === "audio") return audioRef.current;
      if (key === "ai") return aiRef.current;
      if (key === "magic") return magicRef.current;
      return null;
    },
    [],
  );

  const measure = useCallback(() => {
    if (done) return;
    const el = targetRef(step.target);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    const pad = 8;
    setRect({ top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
  }, [done, step.target, targetRef]);

  useLayoutEffect(() => { measure(); }, [measure, stepIdx]);
  useEffect(() => {
    const on = () => measure();
    window.addEventListener("resize", on);
    const t = setTimeout(measure, 60); // after fonts/layout settle
    return () => { window.removeEventListener("resize", on); clearTimeout(t); };
  }, [measure]);

  const next = () => setStepIdx((i) => i + 1);
  const skip = () => setStepIdx(STEPS.length);
  const restart = () => setStepIdx(0);

  // Tooltip placement: beside the target on whichever side has room; centered
  // when there's no target (welcome/ready).
  let tip: React.CSSProperties;
  if (!rect) {
    tip = { top: "50%", left: "50%", transform: "translate(-50%,-50%)", maxWidth: 460 };
  } else {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
    const vh = typeof window !== "undefined" ? window.innerHeight : 900;
    const W = 340;
    const preferRight = rect.left + rect.width + 20 + W < vw;
    const left = preferRight ? rect.left + rect.width + 18 : Math.max(18, rect.left - W - 18);
    const top = Math.min(Math.max(18, rect.top - 8), vh - 260);
    tip = { top, left, width: W };
  }

  return (
    <div className="pfcm">
      <style>{CSS}</style>

      {/* ===== Operator console mock (Image #19) ===== */}
      <div className="console" aria-hidden={!done}>
        {/* Top bar */}
        <div className="topbar">
          <div className="tb-left">
            <span className="logo" />
            <span className="search">Search lyrics, songs, Bible…</span>
          </div>
          <div className="tb-mid">
            <span className="tab">Songs</span><span className="tab">Bible</span>
            <span className="tab">Media</span><span className="tab">Themes</span>
          </div>
          <div className="tb-right">
            <button ref={aiRef} className="ai-toggle" type="button">
              <i /> AI ON
            </button>
            <span className="mode">Worship</span>
            <span className="mode on">Auto</span>
            <span className="mode">Preacher</span>
            <span className="auto-pill">AUTO</span>
          </div>
        </div>

        {/* Body: sidebar / center / right */}
        <div className="body">
          <aside className="sidebar">
            <div className="s-group">
              <div className="s-head">Library</div>
              <div className="s-item on">Default</div>
            </div>
            <div className="s-group">
              <div className="s-head">Playlist</div>
              <div className="s-item">My Daddy My Daddy</div>
            </div>
            <div className="s-group grow">
              <div className="s-head open">Open<em>Flow</em></div>
              <div className="s-head">Media <span className="pro">PRO</span></div>
              <div className="s-item dim">Cinematic</div>
              <div className="s-item">Free</div>
              <div className="s-item dim">Creators</div>
            </div>
            <div className="s-group hw">
              <div className="s-head">Hardware</div>
              <button ref={screensRef} className="s-item hw-item" type="button"><span className="ic ic-screen" /> Screens</button>
              <button ref={audioRef} className="s-item hw-item" type="button"><span className="ic ic-audio" /> Audio</button>
              <button className="s-item hw-item" type="button"><span className="ic ic-video" /> Video Input</button>
            </div>
          </aside>

          <main className="center">
            <div className="c-head"><span className="c-title">My Daddy My Daddy</span><span className="c-btn">Edit slide</span><span className="c-btn">+ Add slide</span><span className="c-btn">Tidy</span></div>
            <div className="slides">
              {[1, 2, 3].map((n) => (
                <div key={n} className={`slide${n === 1 ? " sel" : ""}`}><span className="sn">{n}</span><span className="stext">{n === 1 ? "MY DADDY, MY DADDY YOUR BABY IS SINGING…" : n === 2 ? "ONLY YOU, ONLY YOU (ONLY YOU, ONLY YOU)…" : "TILL THE END ITS ONLY YOU TIL WE MEET…"}</span></div>
              ))}
            </div>
            <div className="stage-label">Stage</div>
            <div className="stage-row">
              {[1, 2, 3].map((n) => <div key={n} className="stage-cell" />)}
            </div>
          </main>

          <section className="right">
            <div ref={magicRef} className="live-card">
              <div className="live-dot">● LIVE</div>
              <div className="live-verse">“For this is how God loved the world: He gave his one and only Son…”</div>
              <div className="live-ref">John 3:16 (NLT)</div>
            </div>
            <div className="transcript-h">Live transcript</div>
            <div className="transcript">Say something with AI Live on…</div>
            <div className="detect-h">Bible detections</div>
            <div className="detect-empty">No Bible references detected yet.</div>
          </section>
        </div>

        {/* Bottom AI chips */}
        <div className="chips">
          <span className="chips-label">AI CHIPS</span>
          <span className="chip">Psalms 23:4 <b>69%</b></span>
          <span className="chip on">John 3:16 <b>85%</b></span>
          <span className="chip">Joshua 1:8 <b>72%</b></span>
        </div>
      </div>

      {/* ===== Coachmark overlay ===== */}
      {!done && (
        <>
          {rect ? (
            <div className="spotlight" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />
          ) : (
            <div className="dim-full" />
          )}

          <div className="tip" style={tip} role="dialog" aria-label={step.title}>
            <div className="tip-eyebrow">{step.eyebrow}</div>
            <div className="tip-title">{step.title}</div>
            <div className="tip-body">{step.body}</div>
            <div className="tip-foot">
              <div className="dots">
                {STEPS.map((s, i) => <i key={s.id} className={i === stepIdx ? "on" : i < stepIdx ? "done" : ""} />)}
              </div>
              <div className="tip-actions">
                {stepIdx < STEPS.length - 1 && <button className="ghost" type="button" onClick={skip}>Skip</button>}
                <button className="primary" type="button" onClick={next}>{step.cta} <span>→</span></button>
              </div>
            </div>
          </div>
        </>
      )}

      {done && (
        <div className="finished">
          <div className="fin-card">
            <div className="fin-title">Tour complete</div>
            <div className="fin-body">This is the in-app coachmark preview. In the real desktop app these steps drive the actual Screens, Audio, and AI controls you just saw highlighted.</div>
            <button className="primary" type="button" onClick={restart}>Replay the tour <span>↺</span></button>
          </div>
        </div>
      )}

      <div className="pv-banner">Preview — in-app coachmark onboarding mockup. The console behind is a static representation of the real operator app; the real thing drives your projector, mixer, and AI directly.</div>
    </div>
  );
}

const CSS = `
.pfcm{--ink:#0a0a0b;--panel:#101012;--panel-2:#0c0c0e;--line:rgba(255,255,255,0.08);--line-2:rgba(255,255,255,0.14);
  --txt:#ECE7E0;--dim:#8a847b;--faint:#54504a;--orange:#ff7a2c;--orange-glow:#ffb861;--green:#33d17a;
  position:fixed;inset:0;overflow:hidden;background:var(--ink);color:var(--txt);
  font-family:"Sora","Plus Jakarta Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased;font-size:13px}
.pfcm *{box-sizing:border-box}
.pfcm button{font-family:inherit}

/* ---- console mock ---- */
.pfcm .console{position:absolute;inset:0;display:flex;flex-direction:column;filter:saturate(0.98)}
.pfcm .topbar{height:52px;flex:0 0 52px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid var(--line);background:var(--panel-2)}
.pfcm .tb-left{display:flex;align-items:center;gap:12px;min-width:260px}
.pfcm .logo{width:20px;height:20px;border-radius:5px;background:conic-gradient(from 210deg,var(--orange),var(--orange-glow),var(--orange))}
.pfcm .search{color:var(--faint);font-size:12.5px;border:1px solid var(--line);border-radius:8px;padding:7px 12px;width:210px}
.pfcm .tb-mid{display:flex;gap:16px;color:var(--dim);font-size:13px}
.pfcm .tb-mid .tab{opacity:.85}
.pfcm .tb-right{display:flex;align-items:center;gap:10px}
.pfcm .ai-toggle{display:inline-flex;align-items:center;gap:7px;background:rgba(51,209,122,0.12);border:1px solid rgba(51,209,122,0.5);color:var(--green);border-radius:999px;padding:6px 13px;font-weight:700;font-size:12.5px;cursor:default}
.pfcm .ai-toggle i{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green)}
.pfcm .mode{color:var(--dim);font-size:12px;padding:5px 9px;border-radius:7px}
.pfcm .mode.on{color:var(--orange);background:rgba(255,122,44,0.12)}
.pfcm .auto-pill{background:linear-gradient(180deg,var(--orange-glow),var(--orange));color:#1a0f06;font-weight:800;font-size:11.5px;letter-spacing:.08em;border-radius:999px;padding:6px 14px}

.pfcm .body{flex:1;display:grid;grid-template-columns:210px 1fr 340px;min-height:0}
.pfcm .sidebar{border-right:1px solid var(--line);background:var(--panel-2);padding:14px 12px;display:flex;flex-direction:column;gap:18px;overflow:hidden}
.pfcm .s-group{display:flex;flex-direction:column;gap:4px}
.pfcm .s-group.grow{flex:1}
.pfcm .s-head{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--faint);margin-bottom:3px}
.pfcm .s-head.open{font-size:15px;letter-spacing:-.02em;text-transform:none;color:var(--txt);font-weight:600}
.pfcm .s-head.open em{font-style:italic;color:var(--orange)}
.pfcm .s-head .pro{color:var(--orange);font-size:9px;border:1px solid var(--line-2);border-radius:4px;padding:1px 4px;margin-left:6px}
.pfcm .s-item{color:var(--txt);font-size:13px;padding:7px 9px;border-radius:8px;background:transparent;border:0;text-align:left;width:100%;display:flex;align-items:center;gap:9px}
.pfcm .s-item.on{background:rgba(255,255,255,0.05)}
.pfcm .s-item.dim{color:var(--faint)}
.pfcm .s-group.hw{border-top:1px solid var(--line);padding-top:12px}
.pfcm .hw-item{cursor:default}
.pfcm .ic{width:15px;height:15px;border-radius:3px;border:1.5px solid var(--dim);display:inline-block;flex:0 0 15px}
.pfcm .ic-audio{border-radius:50% 50% 4px 4px}
.pfcm .ic-video{border-radius:4px}

.pfcm .center{padding:14px 18px;display:flex;flex-direction:column;gap:12px;min-width:0;overflow:hidden}
.pfcm .c-head{display:flex;align-items:center;gap:12px;color:var(--dim)}
.pfcm .c-title{color:var(--txt);font-weight:600;font-size:14px}
.pfcm .c-btn{font-size:12px;border:1px solid var(--line);border-radius:7px;padding:5px 10px;color:var(--dim)}
.pfcm .slides{display:flex;gap:10px}
.pfcm .slide{width:150px;height:86px;border-radius:8px;border:1px solid var(--line);background:#000;padding:9px;position:relative;overflow:hidden}
.pfcm .slide.sel{border-color:var(--orange);box-shadow:0 0 0 1px var(--orange)}
.pfcm .slide .sn{position:absolute;top:6px;left:7px;width:16px;height:16px;border-radius:50%;background:var(--orange);color:#000;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center}
.pfcm .slide .stext{display:block;margin-top:16px;font-size:9.5px;line-height:1.3;color:#cfc9c0}
.pfcm .stage-label{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--faint);margin-top:auto}
.pfcm .stage-row{display:flex;gap:10px}
.pfcm .stage-cell{width:120px;height:66px;border-radius:7px;border:1px solid var(--line);background:#050506}

.pfcm .right{border-left:1px solid var(--line);background:var(--panel-2);padding:14px;display:flex;flex-direction:column;gap:12px;overflow:hidden}
.pfcm .live-card{border:1px solid var(--orange);border-radius:12px;background:#000;padding:16px;position:relative}
.pfcm .live-dot{color:#ff5a5a;font-size:9px;letter-spacing:.14em;position:absolute;top:10px;left:12px}
.pfcm .live-verse{font-weight:600;font-size:14px;line-height:1.4;margin-top:16px;text-align:center;color:#fff}
.pfcm .live-ref{margin-top:12px;text-align:center;font-size:11px;color:var(--dim)}
.pfcm .transcript-h,.pfcm .detect-h{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--faint)}
.pfcm .transcript{border:1px solid var(--line);border-radius:9px;padding:12px;color:var(--faint);font-style:italic;font-size:12.5px;min-height:56px}
.pfcm .detect-empty{color:var(--faint);font-size:12px}

.pfcm .chips{height:44px;flex:0 0 44px;border-top:1px solid var(--line);background:var(--panel-2);display:flex;align-items:center;gap:10px;padding:0 16px}
.pfcm .chips-label{font-size:10px;letter-spacing:.16em;color:var(--faint)}
.pfcm .chip{font-size:12px;border:1px solid var(--line);border-radius:999px;padding:5px 11px;color:var(--txt)}
.pfcm .chip b{color:var(--dim);font-weight:600;margin-left:4px}
.pfcm .chip.on{border-color:rgba(51,209,122,0.5);color:var(--green)}
.pfcm .chip.on b{color:var(--green)}

/* ---- coachmark overlay ---- */
.pfcm .dim-full{position:absolute;inset:0;background:rgba(6,5,8,0.74);backdrop-filter:blur(1px);z-index:40;animation:pfcmfade .3s ease both}
.pfcm .spotlight{position:absolute;z-index:41;border-radius:12px;box-shadow:0 0 0 9999px rgba(6,5,8,0.74),0 0 0 2px var(--orange),0 0 30px -4px rgba(255,122,44,0.6);transition:top .4s cubic-bezier(.2,0,.2,1),left .4s cubic-bezier(.2,0,.2,1),width .4s cubic-bezier(.2,0,.2,1),height .4s cubic-bezier(.2,0,.2,1);pointer-events:none;animation:pfcmpulse 2.2s ease-in-out infinite}
@keyframes pfcmpulse{0%,100%{box-shadow:0 0 0 9999px rgba(6,5,8,0.74),0 0 0 2px var(--orange),0 0 24px -6px rgba(255,122,44,0.5)}50%{box-shadow:0 0 0 9999px rgba(6,5,8,0.74),0 0 0 2px var(--orange),0 0 40px 0px rgba(255,122,44,0.75)}}
@keyframes pfcmfade{from{opacity:0}to{opacity:1}}

.pfcm .tip{position:absolute;z-index:50;background:linear-gradient(180deg,#141216,#0e0d10);border:1px solid var(--line-2);border-radius:16px;padding:20px;box-shadow:0 30px 90px -30px #000,inset 0 1px 0 rgba(255,255,255,0.05);animation:pfcmtip .35s cubic-bezier(.2,0,.2,1) both}
@keyframes pfcmtip{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
.pfcm .tip[style*="translate(-50%"]{animation-name:pfcmtipc}
@keyframes pfcmtipc{from{opacity:0}to{opacity:1}}
.pfcm .tip-eyebrow{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--orange);margin-bottom:11px}
.pfcm .tip-title{font-size:21px;font-weight:700;letter-spacing:-.02em;line-height:1.12;text-wrap:balance;margin-bottom:9px}
.pfcm .tip-body{color:var(--dim);font-size:13.5px;line-height:1.55}
.pfcm .tip-foot{margin-top:18px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.pfcm .dots{display:flex;gap:6px}
.pfcm .dots i{width:6px;height:6px;border-radius:50%;background:var(--faint);transition:all .3s}
.pfcm .dots i.on{background:var(--orange);width:18px;border-radius:3px}
.pfcm .dots i.done{background:var(--dim)}
.pfcm .tip-actions{display:flex;align-items:center;gap:8px}
.pfcm .tip-actions .ghost{background:none;border:0;color:var(--dim);font-size:13px;cursor:pointer;padding:8px 6px}
.pfcm .tip-actions .primary,.pfcm .fin-card .primary{background:linear-gradient(180deg,var(--orange-glow),var(--orange));color:#1a0f06;border:0;border-radius:10px;padding:10px 15px;font-weight:700;font-size:13.5px;cursor:pointer;display:inline-flex;align-items:center;gap:7px;box-shadow:0 8px 26px -12px rgba(255,122,44,0.6)}
.pfcm .tip-actions .primary span,.pfcm .fin-card .primary span{font-family:ui-monospace,monospace;font-size:11px}

.pfcm .finished{position:absolute;inset:0;z-index:60;background:rgba(6,5,8,0.82);display:flex;align-items:center;justify-content:center;animation:pfcmfade .3s ease both}
.pfcm .fin-card{max-width:440px;text-align:center;background:linear-gradient(180deg,#141216,#0e0d10);border:1px solid var(--line-2);border-radius:18px;padding:32px}
.pfcm .fin-title{font-size:22px;font-weight:700;letter-spacing:-.02em;margin-bottom:10px}
.pfcm .fin-body{color:var(--dim);font-size:13.5px;line-height:1.55;margin-bottom:22px}

.pfcm .pv-banner{position:absolute;bottom:0;left:0;right:0;z-index:70;text-align:center;font-family:ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:.02em;color:var(--faint);padding:6px;background:rgba(6,5,8,0.6);border-top:1px solid var(--line);pointer-events:none}
@media (prefers-reduced-motion:reduce){.pfcm .spotlight{animation:none}}
`;
