"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * DEV PREVIEW — extensive in-app WINDOWS desktop onboarding.
 *
 * Two parts (per 2026-09-02 direction):
 *   PART 1 · Get ready to go live — a forced 7-step setup sequence: extend the
 *   screen (Windows+P), identify + test the projector, connect the Behringer,
 *   turn on AI + the magic moment. Grounded in real Windows behaviour + how
 *   ProPresenter does screen setup.
 *   PART 2 · How do I…? — a tappable grid of ~12 teaching topics they can take
 *   in any order and revisit. Each topic DIMS a mock operator console and
 *   SPOTLIGHTS the real control (library tabs, Playlist +, Edit slide, Themes,
 *   Announcements, AI chips vs Detections, service modes, Stage, Settings). The
 *   same grid is intended to live on as a persistent "How do I…" help hub.
 *
 * Mockup at /preview/coachmark-onboarding for approval — does NOT touch the live
 * operator app. Nothing drives real hardware; the console is a static
 * representation. Steps flagged (build) describe behaviour the real wiring adds
 * (e.g. screen persistence auto-reopen) so the preview never over-promises.
 */

type Phase = "setup" | "learn" | "topic" | "done";
type Branch = "yes" | "no" | null;

type TopicKey =
  | "library" | "playlist" | "golive" | "editsong" | "editscripture" | "themes"
  | "announce" | "chips" | "detectsettings" | "servicemode" | "stage" | "settings";

type Topic = { key: TopicKey; title: string; one: string; target: string; body: string; tip: string };

const TOPICS: Topic[] = [
  { key: "library", title: "Your library", one: "Songs · Bible · Media · Themes", target: "libtabs", body: "Everything you present lives across these four tabs at the top. Songs and scripture, your images and videos, and the looks that style them.", tip: "Tap a tab to browse — then drag or click an item into today's service." },
  { key: "playlist", title: "Build today's service", one: "Add to the Playlist", target: "playlist", body: "The Playlist on the left is today's running order. Add the songs, verses, and media you'll use, in the order you'll use them.", tip: "Tap + on Playlist, then pick from your library — reorder by dragging." },
  { key: "golive", title: "Go live", one: "Send a slide to the screen", target: "slide", body: "Tap any slide and it goes straight to the projector. The play / next controls at the bottom move you through, and you can blank the screen anytime.", tip: "Click a slide to project it; use ▶ / next to advance." },
  { key: "editsong", title: "Edit a song slide", one: "Fix a typo, restyle", target: "editbtn", body: "Select a song slide and tap Edit slide. Change the words, the line breaks, or the styling — it updates everywhere that slide is used.", tip: "Select the slide → Edit slide → type your change → done." },
  { key: "editscripture", title: "Edit a scripture slide", one: "Text locked, look editable", target: "editbtn", body: "For Bible verses the words are locked (so scripture is never altered), but you can restyle it — font size, background, position — with the same Edit slide.", tip: "Scripture text stays true; only its look changes." },
  { key: "themes", title: "Themes", one: "Change the whole look", target: "themestab", body: "A Theme is the look of your slides — background, font, colour. Apply one and it restyles everything at once, so your service looks consistent.", tip: "Themes tab → tap a theme to apply it live." },
  { key: "announce", title: "Announcements", one: "Put a notice on screen", target: "detpanel", body: "For the preacher's notices — offerings, events, 'turn to your neighbour'. Show a message as a lower-third strip or full screen, with an optional scrolling ticker.", tip: "Open the Messages panel → type it → choose position → Show." },
  { key: "chips", title: "AI chips vs Detections", one: "Fire now vs review", target: "chips", body: "The AI CHIPS along the bottom are live tap-to-fire suggestions — the AI heard something, tap to project it. The Detections panel on the right is the running list + how detections display.", tip: "Chips = act now. Panel = review + settings." },
  { key: "detectsettings", title: "Detection display", one: "Position, ticker, dismiss", target: "gear", body: "Control how a detected verse appears: lower-third or centre, auto-dismiss or manual, scroll it as a ticker, and whether it shows on your web/livestream output.", tip: "Gear tab → Messages → set position, ticker, dismiss." },
  { key: "servicemode", title: "Service modes", one: "Worship · Auto · Preacher", target: "mode", body: "Tell the AI the moment it's in. Worship leans detection toward your songs; Preacher leans toward spoken scripture; Auto balances both. It only nudges — it never takes over.", tip: "Top bar → tap Worship / Auto / Preacher." },
  { key: "stage", title: "Stage display", one: "The platform's monitor", target: "stage", body: "The Stage screen is the confidence monitor facing the platform — what's live, what's next, timers — so the worship leader and preacher stay in sync without looking at the congregation's screen.", tip: "Assign a Stage screen in Hardware → Screens." },
  { key: "settings", title: "Settings", one: "Audio, translations, capture", target: "gear", body: "In Settings you choose your audio source, your Bible translations (KJV, NIV…), capture mode, and more. Set once — it's remembered.", tip: "Gear icon → Settings tabs." },
];

export function PreviewCoachmark() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [step, setStep] = useState(0);
  const [testSeen, setTestSeen] = useState<Branch>(null);
  const [tsOpen, setTsOpen] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [aiOn, setAiOn] = useState(false);
  const [viewed, setViewed] = useState<Set<TopicKey>>(new Set());
  const [topic, setTopic] = useState<Topic | null>(null);

  const SETUP_TOTAL = 7; // welcome + 6 steps
  const setupNext = () => { setTsOpen(false); if (step >= SETUP_TOTAL - 1) { setPhase("learn"); } else setStep((s) => s + 1); };
  const setupBack = () => { setTsOpen(false); setStep((s) => Math.max(s - 1, 0)); };

  const openTopic = (t: Topic) => { setTopic(t); setPhase("topic"); };
  const closeTopic = () => { if (topic) setViewed((v) => new Set(v).add(topic.key)); setTopic(null); setPhase("learn"); };
  const restart = () => { setPhase("setup"); setStep(0); setTestSeen(null); setMicOn(false); setAiOn(false); setViewed(new Set()); setTopic(null); };

  return (
    <div className="pfw">
      <style>{CSS}</style>

      <div className="pfw-top">
        <div className="brand"><span className="logo" /><b>Present<em>Flow</em></b><span className="tag">Windows setup</span></div>
        {phase === "setup" && <div className="rail">{Array.from({ length: SETUP_TOTAL }).map((_, i) => <i key={i} className={i <= step ? "on" : ""} />)}</div>}
        {(phase === "learn" || phase === "topic") && <div className="rail-txt">{viewed.size} / {TOPICS.length} topics explored</div>}
      </div>

      {/* ============ PART 1 · SETUP ============ */}
      {phase === "setup" && (
        <div className="pfw-body">
          <div className="stage">
            {step === 0 && <WelcomeArt />}
            {step === 1 && <WinPArt />}
            {step === 2 && <IdentifyArt />}
            {step === 3 && <TestArt seen={testSeen} />}
            {step === 4 && <PersistArt />}
            {step === 5 && <AudioArt micOn={micOn} />}
            {step === 6 && <MagicArt aiOn={aiOn} />}
          </div>
          <aside className="panel">
            {step === 0 && <Card eyebrow="Get ready for Sunday" title="Let's set up your church computer." cta="Start — 5 easy steps" onNext={setupNext}>
              <p>We'll do this once, together: get your projector showing, your sound coming in, and the AI listening. Every step is checked before we move on.</p>
              <p className="soft">Then we'll show you around — where everything is and how to use it.</p>
            </Card>}
            {step === 1 && <Card eyebrow="Step 1 of 6 · Your screen" title="Show your projector the screen." cta="Done — I tapped Extend" onNext={setupNext} onBack={setupBack}>
              <p><b>Plug in the HDMI</b> and turn the projector on. Hold the <b>Windows key</b> and tap <b>P</b> — a menu slides in from the right. Tap <b className="hot">Extend</b>.</p>
              <p className="soft">Extend (not Duplicate) is what lets us put clean slides on the projector while your controls stay on the laptop.</p>
              <Troubleshoot open={tsOpen} onToggle={() => setTsOpen((v) => !v)} title="Can't find your screen?">
                <ol><li><b>Reseat the HDMI</b> at both ends (the #1 cause).</li><li><b>Projector Source</b> — press Source on the remote, pick the right HDMI.</li><li>Right-click desktop → <b>Display settings</b> → <b>Detect</b>.</li><li>Press <b>Windows + Ctrl + Shift + B</b> to restart the display driver (screen blinks once).</li></ol>
              </Troubleshoot>
            </Card>}
            {step === 2 && <Card eyebrow="Step 2 of 6 · Your screen" title="Which one is the projector?" cta="That's my projector" onNext={setupNext} onBack={setupBack}>
              <p>We flashed a big number on each screen — look up. Tap the one showing <b>on your wall</b>. We keep your laptop as the control screen.</p>
              <p className="soft">Windows monitors often have no name — that's why we flash the number instead of making you guess.</p>
            </Card>}
            {step === 3 && <Card eyebrow="Step 3 of 6 · Your screen" title="Make sure it's really showing." cta={testSeen === "yes" ? "Yes — continue" : "Send the test"} onNext={testSeen === "yes" ? setupNext : undefined} onBack={setupBack}>
              <p>We put a <b>test card</b> on your projector. Glance at the wall — <b>can you read it?</b></p>
              <div className="yn">
                <button className={`yn-b${testSeen === "yes" ? " sel" : ""}`} onClick={() => setTestSeen("yes")}>Yes, I see it</button>
                <button className={`yn-b ghost${testSeen === "no" ? " sel" : ""}`} onClick={() => setTestSeen("no")}>No, nothing</button>
              </div>
              {testSeen === "yes" && <p className="ok">Perfect — projector's live. Hard part done.</p>}
              {testSeen === "no" && <div className="ts-inline"><ol><li>Windows on <b>Duplicate</b>? Press <b>Win+P → Extend</b>.</li><li>Projector on the <b>wrong input</b>? Press Source.</li></ol><button className="mini" onClick={() => setTestSeen(null)}>Fixed — test again</button></div>}
            </Card>}
            {step === 4 && <Card eyebrow="Step 4 of 6 · Your screen" title="Set once. Ready every Sunday." cta="Nice — next, sound" onNext={setupNext} onBack={setupBack}>
              <p>PresentFlow <b>remembers this projector</b>. Next week it's already on the big screen — no setup.</p>
              <p className="soft">Change venue? Just run this step again. <span className="wip">(auto-reopen is the piece we're wiring for the desktop build)</span></p>
            </Card>}
            {step === 5 && <Card eyebrow="Step 5 of 6 · Your sound" title="Bring your service audio in." cta="The bar moved — continue" onNext={micOn ? setupNext : undefined} onBack={setupBack}>
              <p>Plug your <b>Behringer in over USB</b>, pick it here, and say a few words — the bar should move.</p>
              {!micOn ? <button className="do" onClick={() => setMicOn(true)}>Detect my audio &nbsp;→</button> : <p className="ok">Clean signal from your Behringer — that's what the AI listens to.</p>}
              <Troubleshoot open={tsOpen} onToggle={() => setTsOpen((v) => !v)} title="Projector stole your sound?">
                <ol><li>Click the <b>speaker icon</b> → the <b>&gt;</b> arrow → pick your <b>mixer / USB</b>, not HDMI.</li><li>Check the mixer channel isn't muted and your mic is on the USB send.</li></ol>
              </Troubleshoot>
            </Card>}
            {step === 6 && <Card eyebrow="Step 6 of 6 · The magic moment" title="Turn on AI. Say a verse." cta="I saw it — show me around" onNext={aiOn ? setupNext : undefined} onBack={setupBack}>
              <p>Flip <b>AI on</b> (top-right). Now PresentFlow is listening.</p>
              {!aiOn ? <button className="do" onClick={() => setAiOn(true)}>Turn AI on &nbsp;→</button> : <p className="ok">Say <b>&ldquo;John 3:16&rdquo;</b> — it hears it, finds it, projects it. That's your whole Sunday.</p>}
            </Card>}
          </aside>
        </div>
      )}

      {/* ============ PART 2 · LEARN GRID ============ */}
      {phase === "learn" && (
        <div className="learn">
          <div className="learn-h">
            <div className="c-eyebrow">You're ready to go live</div>
            <h1>How do I…?</h1>
            <p>Tap any card to see exactly where it is and how to use it. Take them in any order — this same guide stays in the app under <b>Help</b> whenever you need it.</p>
          </div>
          <div className="grid">
            {TOPICS.map((t) => (
              <button key={t.key} className={`gcard${viewed.has(t.key) ? " done" : ""}`} onClick={() => openTopic(t)}>
                <div className="gc-top"><span className="gc-title">{t.title}</span>{viewed.has(t.key) && <span className="gc-check">✓</span>}</div>
                <div className="gc-one">{t.one}</div>
              </button>
            ))}
          </div>
          <div className="learn-foot">
            <button className="c-back" onClick={() => { setPhase("setup"); setStep(6); }}>← Setup</button>
            <button className="c-next" onClick={() => setPhase("done")}>{viewed.size === TOPICS.length ? "All done — finish" : "Finish (explore the rest anytime)"} <span>→</span></button>
          </div>
        </div>
      )}

      {/* ============ PART 2 · TOPIC SPOTLIGHT ============ */}
      {phase === "topic" && topic && (
        <TopicSpotlight topic={topic} onClose={closeTopic} />
      )}

      {/* ============ DONE ============ */}
      {phase === "done" && (
        <div className="pfw-body">
          <div className="stage"><ReadyArt /></div>
          <aside className="panel">
            <Card eyebrow="Ready for Sunday" title="That's it — you're set." cta="Replay the tour" onNext={restart}>
              <p>Projector showing, sound coming in, AI listening, and you know your way around. Everything from here is the same few moves.</p>
              <p className="soft">Anything you skipped is always in <b>Help → How do I…?</b> in the app. Your team can keep their eyes on the congregation.</p>
            </Card>
          </aside>
        </div>
      )}

      <div className="pfw-foot">Preview — extensive Windows desktop onboarding mockup (setup + &ldquo;How do I…?&rdquo; learn grid). The screens/audio/console here are illustrations; the real desktop app drives your projector, mixer, and AI directly, and each topic spotlights the real control.</div>
    </div>
  );
}

/* ---------------- topic spotlight over a mock console ---------------- */
function TopicSpotlight({ topic, onClose }: { topic: Topic; onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  const measure = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const el = host.querySelector<HTMLElement>(`[data-t="${topic.target}"]`);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    const pad = 7;
    setRect({ top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
  }, [topic.target]);

  useLayoutEffect(() => { measure(); }, [measure]);
  useEffect(() => {
    const on = () => measure();
    window.addEventListener("resize", on);
    const t = setTimeout(measure, 60);
    return () => { window.removeEventListener("resize", on); clearTimeout(t); };
  }, [measure]);

  let tip: React.CSSProperties;
  if (!rect) tip = { top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 340 };
  else {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
    const vh = typeof window !== "undefined" ? window.innerHeight : 900;
    const W = 330;
    const right = rect.left + rect.width + 18 + W < vw;
    tip = { top: Math.min(Math.max(70, rect.top - 6), vh - 280), left: right ? rect.left + rect.width + 16 : Math.max(16, rect.left - W - 16), width: W };
  }

  return (
    <div className="topic" ref={hostRef}>
      <ConsoleMock />
      {rect ? <div className="spot" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} /> : <div className="dimfull" />}
      <div className="tcard" style={tip}>
        <div className="c-eyebrow">How do I…</div>
        <div className="tc-title">{topic.title}</div>
        <p className="tc-body">{topic.body}</p>
        <div className="tc-tip"><b>Try it:</b> {topic.tip}</div>
        <button className="c-next" onClick={onClose}>Got it <span>✓</span></button>
      </div>
    </div>
  );
}

/* ---------------- guidance card + accordion ---------------- */
function Card({ eyebrow, title, children, cta, onNext, onBack }: { eyebrow: string; title: string; children: React.ReactNode; cta: string; onNext?: () => void; onBack?: () => void }) {
  return (
    <div className="card">
      <div className="c-eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <div className="c-body">{children}</div>
      <div className="c-actions">
        {onBack && <button className="c-back" onClick={onBack}>← Back</button>}
        <button className="c-next" disabled={!onNext} onClick={onNext}>{cta} <span>→</span></button>
      </div>
    </div>
  );
}
function Troubleshoot({ open, onToggle, title, children }: { open: boolean; onToggle: () => void; title: string; children: React.ReactNode }) {
  return (<div className={`ts${open ? " open" : ""}`}><button className="ts-h" onClick={onToggle}>{open ? "▾" : "▸"} {title}</button>{open && <div className="ts-body">{children}</div>}</div>);
}

/* ---------------- setup illustrations ---------------- */
function WelcomeArt() { return (<div className="art center"><div className="hero-screens"><div className="mon big"><div className="scr"><span>Your church<br />screen</span></div><div className="stand" /></div><div className="mon small"><div className="scr dim"><span>Your controls</span></div><div className="stand" /></div></div><div className="hero-cap">Projector + laptop, together</div></div>); }
function WinPArt() {
  const rows = [{ t: "PC screen only", d: "projector stays black" }, { t: "Duplicate", d: "mirror — not this one" }, { t: "Extend", d: "separate screen — tap this", hot: true }, { t: "Second screen only", d: "laptop goes black" }];
  return (<div className="art"><div className="winp"><div className="winp-h">Project</div>{rows.map((r) => <div key={r.t} className={`winp-row${r.hot ? " hot" : ""}`}><span className="winp-ic" /><div><div className="winp-t">{r.t}</div><div className="winp-d">{r.d}</div></div></div>)}</div><div className="kbd-cap"><span className="kbd">Win</span> + <span className="kbd">P</span> opens this</div></div>);
}
function IdentifyArt() { return (<div className="art center"><div className="ident"><div className="mon big"><div className="scr num">2<span className="lbl">projector wall</span></div><div className="stand" /></div><div className="mon small"><div className="scr num dim">1<span className="lbl">your laptop</span></div><div className="stand" /></div></div><div className="hero-cap">Tap the number on your wall</div></div>); }
function TestArt({ seen }: { seen: Branch }) { return (<div className="art center"><div className="mon big"><div className={`scr test${seen === "no" ? " blank" : ""}`}>{seen === "no" ? <span className="dim">nothing yet…</span> : (<><b>TEST</b><span>If you can read this,<br />tap “Yes”</span><i className="chk">✓</i></>)}</div><div className="stand" /></div><div className="hero-cap">A test card on your projector</div></div>); }
function PersistArt() { return (<div className="art center"><div className="mon big"><div className="scr"><span className="ok-tick">✓</span><span>Remembered</span></div><div className="stand" /></div><div className="hero-cap">Set once — ready every Sunday</div></div>); }
function AudioArt({ micOn }: { micOn: boolean }) { return (<div className="art"><div className="audio"><div className="a-h">Audio input</div><div className="a-row sel">BEHRINGER USB Audio <span className="mixtag">MIXER</span></div><div className="a-row dim">Laptop microphone</div><div className="a-row dim">HDMI (projector)</div><div className="a-meter-l">Level</div><div className="a-meter"><i style={{ width: micOn ? "62%" : "0%" }} /></div><div className={`a-status${micOn ? " on" : ""}`}>{micOn ? "✓ Getting a clean signal" : "Say a few words…"}</div></div></div>); }
function MagicArt({ aiOn }: { aiOn: boolean }) { return (<div className="art"><div className="mini-console"><div className="mc-top"><span className={`ai-pill${aiOn ? " on" : ""}`}><i />{aiOn ? "AI ON" : "AI OFF"}</span></div><div className="mc-live">{aiOn ? (<><div className="mc-dot">● LIVE</div><div className="mc-verse">“For God so loved the world…”</div><div className="mc-ref">John 3:16</div></>) : <div className="mc-idle">Turn AI on, then say a verse</div>}</div></div><div className="hero-cap">Say it — watch it hit the screen</div></div>); }
function ReadyArt() { return (<div className="art center"><div className="ready-big">Ready for<br /><em>Sunday.</em></div></div>); }

/* ---------------- mock console (targets carry data-t) ---------------- */
function ConsoleMock() {
  return (
    <div className="console">
      <div className="topbar">
        <div className="tb-left"><span className="clogo" /><span className="search">Search…</span></div>
        <div className="tb-mid" data-t="libtabs"><span>Songs</span><span>Bible</span><span>Media</span><span data-t="themestab" className="th">Themes</span></div>
        <div className="tb-right"><span className="mode" data-t="mode">Worship · Auto · Preacher</span><span className="ai" data-t="ai">AI ON</span></div>
      </div>
      <div className="cbody">
        <aside className="side">
          <div className="s-head">Library</div><div className="s-item">Default</div>
          <div className="s-head pl" data-t="playlist">Playlist +</div><div className="s-item">My service</div>
          <div className="s-head hw">Hardware</div><div className="s-item" data-t="stage">Screens · Audio</div>
        </aside>
        <main className="cmain">
          <div className="c-head"><span className="ct">My service</span><span className="cbtn" data-t="editbtn">Edit slide</span><span className="cbtn">+ Add</span></div>
          <div className="cslides"><div className="cslide sel" data-t="slide"><span>1</span></div><div className="cslide"><span>2</span></div><div className="cslide"><span>3</span></div></div>
          <div className="clabel">Stage</div><div className="cstage"><i /><i /></div>
        </main>
        <section className="cright" data-t="detpanel">
          <div className="tabrow"><span data-t="gear" className="g">Settings</span></div>
          <div className="clive"><div className="dot">● LIVE</div><div className="cv">“…God so loved the world”</div><div className="cr">John 3:16</div></div>
          <div className="cdet">Bible detections</div>
        </section>
      </div>
      <div className="cchips" data-t="chips"><span className="cl">AI CHIPS</span><span className="chip">Psalm 23:4 69%</span><span className="chip on">John 3:16 85%</span></div>
    </div>
  );
}

const CSS = `
.pfw{--ink:#0a0a0b;--card:#141216;--line:rgba(255,255,255,0.09);--line2:rgba(255,255,255,0.16);--txt:#ECE7E0;--dim:#9a938a;--faint:#57524b;--orange:#ff7a2c;--glow:#ffb861;--green:#33d17a;
  position:fixed;inset:0;overflow:hidden;background:radial-gradient(120% 90% at 50% -10%,#161318,#0a0a0b 60%);color:var(--txt);font-family:"Sora","Plus Jakarta Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column}
.pfw *{box-sizing:border-box}
.pfw button{font-family:inherit;cursor:pointer}
.pfw-top{display:flex;align-items:center;justify-content:space-between;padding:16px 28px;border-bottom:1px solid var(--line)}
.pfw .brand{display:flex;align-items:center;gap:11px}
.pfw .logo{width:22px;height:22px;border-radius:6px;background:conic-gradient(from 210deg,var(--orange),var(--glow),var(--orange))}
.pfw .brand b{font-weight:700;font-size:19px;letter-spacing:-0.03em}.pfw .brand b em{font-style:normal;color:var(--orange)}
.pfw .tag{margin-left:6px;font-family:ui-monospace,Menlo,monospace;font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--orange);border:1px solid var(--line2);border-radius:999px;padding:4px 10px}
.pfw .rail{display:flex;gap:6px;width:min(42%,380px)}
.pfw .rail i{height:3px;flex:1;border-radius:2px;background:var(--line);transition:background .4s}.pfw .rail i.on{background:linear-gradient(90deg,var(--glow),var(--orange))}
.pfw .rail-txt{font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.1em;color:var(--faint)}

.pfw-body{flex:1;display:grid;grid-template-columns:1.15fr 0.85fr;min-height:0}
.pfw .stage{display:flex;align-items:center;justify-content:center;padding:40px 48px;border-right:1px solid var(--line);overflow:hidden}
.pfw .panel{display:flex;align-items:center;padding:40px 52px;overflow-y:auto}
.pfw .card{max-width:420px;width:100%;animation:pfin .4s cubic-bezier(.2,0,.2,1) both}
@keyframes pfin{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.pfw .c-eyebrow{font-family:ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--orange);margin-bottom:12px}
.pfw h1{font-size:clamp(26px,2.7vw,34px);font-weight:700;letter-spacing:-.03em;line-height:1.1;text-wrap:balance;margin:0 0 16px}
.pfw .c-body p{color:var(--dim);font-size:14.5px;line-height:1.6;margin:0 0 12px}.pfw .c-body p b{color:var(--txt);font-weight:600}.pfw .c-body p b.hot{color:var(--orange)}
.pfw .c-body .soft{font-size:13px;color:var(--faint)}.pfw .c-body .soft .wip{color:var(--orange);opacity:.85}.pfw .c-body .ok{color:var(--green);font-size:13.5px}
.pfw .c-actions{margin-top:24px;display:flex;align-items:center;gap:12px}
.pfw .c-next{background:linear-gradient(180deg,var(--glow),var(--orange));color:#1a0f06;border:0;border-radius:11px;padding:13px 18px;font-weight:700;font-size:15px;display:inline-flex;justify-content:center;align-items:center;gap:8px;box-shadow:0 10px 30px -12px rgba(255,122,44,.6);transition:filter .15s,transform .08s}
.pfw .card .c-next,.pfw .learn-foot .c-next{flex:1}
.pfw .c-next:hover:not(:disabled){filter:brightness(1.06)}.pfw .c-next:active:not(:disabled){transform:scale(.99)}.pfw .c-next:disabled{opacity:.4;cursor:default;filter:grayscale(.4)}
.pfw .c-next span{font-family:ui-monospace,monospace;font-size:12px}
.pfw .c-back{background:none;border:0;color:var(--dim);font-size:13px}
.pfw .do{background:rgba(255,122,44,.12);border:1px solid var(--orange);color:var(--orange);border-radius:10px;padding:11px 16px;font-weight:600;font-size:14px;margin:4px 0 8px}
.pfw .yn{display:flex;gap:10px;margin:6px 0 10px}.pfw .yn-b{flex:1;border:1px solid var(--line2);background:transparent;color:var(--txt);border-radius:10px;padding:12px;font-size:13.5px;font-weight:600}.pfw .yn-b.sel{border-color:var(--green);background:rgba(51,209,122,.12);color:var(--green)}.pfw .yn-b.ghost{color:var(--dim)}.pfw .yn-b.ghost.sel{border-color:var(--orange);background:rgba(255,122,44,.1);color:var(--orange)}
.pfw .mini{margin-top:6px;background:none;border:0;color:var(--orange);font-size:13px;text-decoration:underline;text-underline-offset:2px}
.pfw .ts-inline{background:rgba(255,122,44,.06);border:1px solid rgba(255,122,44,.25);border-radius:10px;padding:10px 12px;margin-top:6px}
.pfw .ts-inline ol,.pfw .ts-body ol{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:5px}.pfw .ts-inline li,.pfw .ts-body li{color:var(--dim);font-size:12.5px;line-height:1.5}.pfw .ts-inline b,.pfw .ts-body b{color:var(--txt);font-weight:600}
.pfw .ts{margin-top:14px;border-top:1px solid var(--line);padding-top:10px}.pfw .ts-h{background:none;border:0;color:var(--orange);font-size:13px;font-weight:600;padding:0}.pfw .ts-body{margin-top:8px}

/* learn grid */
.pfw .learn{flex:1;overflow-y:auto;padding:34px 48px;display:flex;flex-direction:column}
.pfw .learn-h{max-width:640px}.pfw .learn-h p{color:var(--dim);font-size:14.5px;line-height:1.6;margin:8px 0 0}.pfw .learn-h p b{color:var(--txt)}
.pfw .grid{margin:26px 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.pfw .gcard{text-align:left;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:15px;transition:border-color .15s,transform .08s}
.pfw .gcard:hover{border-color:var(--orange);transform:translateY(-1px)}.pfw .gcard.done{border-color:rgba(51,209,122,.4)}
.pfw .gc-top{display:flex;align-items:center;justify-content:space-between}.pfw .gc-title{font-size:15px;font-weight:600;color:var(--txt)}
.pfw .gc-check{color:var(--green);font-size:14px}.pfw .gc-one{margin-top:5px;font-size:12.5px;color:var(--faint)}
.pfw .learn-foot{margin-top:auto;padding-top:12px;display:flex;align-items:center;justify-content:space-between;gap:16px}

/* topic spotlight */
.pfw .topic{flex:1;position:relative;overflow:hidden}
.pfw .console{position:absolute;inset:0;display:flex;flex-direction:column;font-size:12px}
.pfw .topbar{height:46px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-bottom:1px solid var(--line);background:#0c0c0e}
.pfw .tb-left{display:flex;align-items:center;gap:10px}.pfw .clogo{width:18px;height:18px;border-radius:5px;background:conic-gradient(from 210deg,var(--orange),var(--glow),var(--orange))}.pfw .search{color:var(--faint);border:1px solid var(--line);border-radius:7px;padding:6px 34px 6px 10px}
.pfw .tb-mid{display:flex;gap:14px;color:var(--dim);padding:6px 8px;border-radius:8px}.pfw .tb-mid .th{color:var(--dim)}
.pfw .tb-right{display:flex;align-items:center;gap:10px}.pfw .tb-right .mode{color:var(--dim);padding:5px 9px;border-radius:7px}.pfw .tb-right .ai{color:var(--green);border:1px solid rgba(51,209,122,.5);background:rgba(51,209,122,.1);border-radius:999px;padding:5px 11px;font-weight:700}
.pfw .cbody{flex:1;display:grid;grid-template-columns:190px 1fr 300px;min-height:0}
.pfw .side{border-right:1px solid var(--line);background:#0c0c0e;padding:12px;display:flex;flex-direction:column;gap:4px}
.pfw .s-head{font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin-top:8px;padding:4px 6px;border-radius:6px}.pfw .s-head.pl,.pfw .s-head.hw{color:var(--dim)}
.pfw .s-item{font-size:13px;color:var(--txt);padding:6px 8px}
.pfw .cmain{padding:12px 16px;display:flex;flex-direction:column;gap:10px}
.pfw .c-head{display:flex;align-items:center;gap:10px;color:var(--dim)}.pfw .ct{color:var(--txt);font-weight:600}.pfw .cbtn{font-size:12px;border:1px solid var(--line);border-radius:6px;padding:5px 9px;color:var(--dim)}
.pfw .cslides{display:flex;gap:8px}.pfw .cslide{width:120px;height:68px;border-radius:7px;border:1px solid var(--line);background:#000;position:relative}.pfw .cslide.sel{border-color:var(--orange)}.pfw .cslide span{position:absolute;top:5px;left:6px;width:15px;height:15px;border-radius:50%;background:var(--orange);color:#000;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center}
.pfw .clabel{font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--faint);margin-top:auto}.pfw .cstage{display:flex;gap:8px}.pfw .cstage i{width:96px;height:52px;border-radius:6px;border:1px solid var(--line);background:#050506}
.pfw .cright{border-left:1px solid var(--line);background:#0c0c0e;padding:12px}.pfw .tabrow{display:flex;justify-content:flex-end}.pfw .g{color:var(--orange)}
.pfw .clive{border:1px solid var(--orange);border-radius:11px;background:#000;padding:14px;margin-top:8px;text-align:center;position:relative}.pfw .dot{position:absolute;top:8px;left:10px;color:#ff5a5a;font-size:8px;letter-spacing:.16em}.pfw .cv{font-weight:600;font-size:13px;color:#fff;margin-top:10px}.pfw .cr{font-size:11px;color:var(--dim);margin-top:8px}
.pfw .cdet{margin-top:12px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)}
.pfw .cchips{height:40px;border-top:1px solid var(--line);background:#0c0c0e;display:flex;align-items:center;gap:9px;padding:0 14px}.pfw .cl{font-size:9.5px;letter-spacing:.14em;color:var(--faint)}.pfw .chip{font-size:11.5px;border:1px solid var(--line);border-radius:999px;padding:4px 10px;color:var(--txt)}.pfw .chip.on{border-color:rgba(51,209,122,.5);color:var(--green)}

.pfw .dimfull{position:absolute;inset:0;background:rgba(6,5,8,.76);z-index:40;animation:pfin .3s ease both}
.pfw .spot{position:absolute;z-index:41;border-radius:10px;box-shadow:0 0 0 9999px rgba(6,5,8,.76),0 0 0 2px var(--orange),0 0 30px -4px rgba(255,122,44,.6);pointer-events:none;transition:all .35s cubic-bezier(.2,0,.2,1);animation:pfpulse 2.2s ease-in-out infinite}
@keyframes pfpulse{0%,100%{box-shadow:0 0 0 9999px rgba(6,5,8,.76),0 0 0 2px var(--orange),0 0 22px -6px rgba(255,122,44,.5)}50%{box-shadow:0 0 0 9999px rgba(6,5,8,.76),0 0 0 2px var(--orange),0 0 40px 0 rgba(255,122,44,.75)}}
.pfw .tcard{position:absolute;z-index:50;background:linear-gradient(180deg,#151317,#0e0d10);border:1px solid var(--line2);border-radius:15px;padding:18px;box-shadow:0 30px 90px -30px #000;animation:pfin .3s cubic-bezier(.2,0,.2,1) both}
.pfw .tc-title{font-size:19px;font-weight:700;letter-spacing:-.02em;margin-bottom:8px}
.pfw .tc-body{color:var(--dim);font-size:13.5px;line-height:1.55;margin:0 0 12px}
.pfw .tc-tip{font-size:12.5px;color:var(--glow);background:rgba(255,122,44,.08);border:1px solid rgba(255,122,44,.22);border-radius:9px;padding:9px 11px;line-height:1.5;margin-bottom:14px}.pfw .tc-tip b{color:var(--orange)}
.pfw .tcard .c-next{width:100%}

.pfw .art{width:100%;max-width:560px;display:flex;flex-direction:column;align-items:center;gap:22px;animation:pfin .45s cubic-bezier(.2,0,.2,1) both}
.pfw .hero-cap,.pfw .kbd-cap{font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)}
.pfw .kbd{display:inline-block;border:1px solid var(--line2);border-bottom-width:2px;border-radius:6px;padding:2px 8px;color:var(--txt);font-size:12px;margin:0 2px}
.pfw .mon{display:flex;flex-direction:column;align-items:center}.pfw .mon .scr{border:1px solid var(--line2);border-radius:8px;background:#050506;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--dim);font-size:13px;line-height:1.3;position:relative;overflow:hidden}.pfw .mon .stand{width:14%;height:14px;background:var(--line2);border-radius:0 0 3px 3px}
.pfw .mon.big .scr{width:340px;height:191px}.pfw .mon.small .scr{width:200px;height:112px}.pfw .mon .scr.dim{color:var(--faint);background:#0a0a0c}
.pfw .hero-screens,.pfw .ident{display:flex;align-items:flex-end;gap:26px}
.pfw .mon .scr.num{font-family:"Sora";font-weight:800;font-size:64px;color:var(--orange)}.pfw .mon .scr.num.dim{color:var(--faint);font-size:44px}.pfw .mon .scr .lbl{position:absolute;bottom:8px;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}.pfw .big .scr.num{box-shadow:inset 0 0 0 2px var(--orange),0 0 40px -8px rgba(255,122,44,.5)}
.pfw .scr.test{gap:6px;color:var(--txt)}.pfw .scr.test b{font-size:26px;letter-spacing:.2em;color:#fff}.pfw .scr.test span{font-size:11px;color:var(--dim)}.pfw .scr.test .chk{font-style:normal;color:var(--green);font-size:22px}.pfw .scr .ok-tick{font-style:normal;color:var(--green);font-size:34px;margin-bottom:4px}
.pfw .winp{width:300px;background:#1b1b1f;border:1px solid var(--line2);border-radius:12px;padding:8px}.pfw .winp-h{font-size:13px;font-weight:600;padding:8px 10px}.pfw .winp-row{display:flex;align-items:center;gap:12px;padding:11px 10px;border-radius:8px}.pfw .winp-row.hot{background:rgba(255,122,44,.16);box-shadow:inset 0 0 0 1px var(--orange)}.pfw .winp-ic{width:26px;height:18px;border:1.5px solid var(--dim);border-radius:3px}.pfw .winp-row.hot .winp-ic{border-color:var(--orange)}.pfw .winp-t{font-size:13px;font-weight:500}.pfw .winp-row.hot .winp-t{color:var(--orange);font-weight:700}.pfw .winp-d{font-size:11px;color:var(--faint)}
.pfw .audio{width:360px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}.pfw .a-h,.pfw .a-meter-l{font-family:ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--faint);margin-bottom:10px}.pfw .a-row{border:1px solid var(--line);border-radius:9px;padding:11px 13px;font-size:13.5px;margin-bottom:7px;display:flex;align-items:center;gap:8px}.pfw .a-row.sel{border-color:var(--orange);background:rgba(255,122,44,.1)}.pfw .a-row.dim{color:var(--faint)}.pfw .mixtag{margin-left:auto;font-size:9px;font-weight:800;color:var(--green);border:1px solid rgba(51,209,122,.5);border-radius:4px;padding:1px 5px}.pfw .a-meter-l{margin:14px 0 6px}.pfw .a-meter{height:12px;border-radius:6px;background:var(--line);overflow:hidden}.pfw .a-meter i{display:block;height:100%;background:linear-gradient(90deg,var(--green),var(--glow),var(--orange));transition:width .5s ease}.pfw .a-status{margin-top:10px;font-size:13px;color:var(--faint)}.pfw .a-status.on{color:var(--green);font-weight:600}
.pfw .mini-console{width:420px;background:#0c0c0e;border:1px solid var(--line);border-radius:14px;overflow:hidden}.pfw .mc-top{padding:12px;border-bottom:1px solid var(--line);display:flex;justify-content:flex-end}.pfw .ai-pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line2);color:var(--faint);border-radius:999px;padding:6px 12px;font-size:12px;font-weight:700}.pfw .ai-pill i{width:7px;height:7px;border-radius:50%;background:var(--faint)}.pfw .ai-pill.on{border-color:rgba(51,209,122,.5);color:var(--green);background:rgba(51,209,122,.1)}.pfw .ai-pill.on i{background:var(--green);box-shadow:0 0 8px var(--green)}.pfw .mc-live{min-height:150px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px;position:relative}.pfw .mc-dot{position:absolute;top:12px;left:14px;color:#ff5a5a;font-size:9px;letter-spacing:.18em}.pfw .mc-verse{font-weight:600;font-size:17px;color:#fff;line-height:1.35}.pfw .mc-ref{margin-top:10px;font-size:12px;color:var(--dim)}.pfw .mc-idle{color:var(--faint);font-size:13px}
.pfw .ready-big{font-size:clamp(40px,6vw,68px);font-weight:700;letter-spacing:-.04em;line-height:1;text-align:center}.pfw .ready-big em{font-style:normal;color:var(--orange)}
.pfw-foot{text-align:center;font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--faint);padding:8px;border-top:1px solid var(--line)}
@media (max-width:900px){.pfw-body{grid-template-columns:1fr}.pfw .stage{display:none}.pfw .panel{padding:28px}.pfw .cbody{grid-template-columns:1fr}}
`;
