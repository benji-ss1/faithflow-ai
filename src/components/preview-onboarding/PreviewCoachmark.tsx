"use client";
import { useState } from "react";

/**
 * DEV PREVIEW — extensive in-app WINDOWS desktop onboarding.
 *
 * A baby-step, ProPresenter-grade first-run flow for a church operator on
 * Windows who has never set up a projector: extend the screen (Windows+P),
 * identify + test the projector, connect the Behringer over USB, turn on AI +
 * the magic moment, then a console tour of where Media / Themes / Edit slide /
 * Hardware live. Grounded in real Windows behaviour + how ProPresenter does it.
 *
 * Mockup at /preview/coachmark-onboarding for approval — does NOT touch the live
 * operator app. Nothing here drives real hardware; the console behind the tour
 * steps is a static representation. Steps flagged (build) describe behaviour the
 * real wiring will add (e.g. screen persistence auto-reopen) — called out so the
 * preview never over-promises.
 */

type Branch = "yes" | "no" | null;

export function PreviewCoachmark() {
  const [step, setStep] = useState(0);
  const [testSeen, setTestSeen] = useState<Branch>(null);
  const [tsOpen, setTsOpen] = useState(false); // "can't find your screen?" ladder
  const [micOn, setMicOn] = useState(false);
  const [aiOn, setAiOn] = useState(false);

  const TOTAL = 9;
  const next = () => { setTsOpen(false); setStep((s) => Math.min(s + 1, TOTAL)); };
  const back = () => { setTsOpen(false); setStep((s) => Math.max(s - 1, 0)); };
  const restart = () => { setStep(0); setTestSeen(null); setMicOn(false); setAiOn(false); };

  return (
    <div className="pfw">
      <style>{CSS}</style>

      {/* Brand + progress */}
      <div className="pfw-top">
        <div className="brand"><span className="logo" /><b>Present<em>Flow</em></b><span className="tag">Windows setup</span></div>
        <div className="rail">{Array.from({ length: TOTAL }).map((_, i) => <i key={i} className={i <= step ? "on" : ""} />)}</div>
      </div>

      <div className="pfw-body">
        {/* ============ LEFT: illustration ============ */}
        <div className="stage">
          {step === 0 && <WelcomeArt />}
          {step === 1 && <WinPArt />}
          {step === 2 && <IdentifyArt />}
          {step === 3 && <TestArt seen={testSeen} />}
          {step === 4 && <PersistArt />}
          {step === 5 && <AudioArt micOn={micOn} />}
          {step === 6 && <MagicArt aiOn={aiOn} />}
          {step === 7 && <ConsoleTourArt />}
          {step === 8 && <ReadyArt />}
          {step >= TOTAL && <ReadyArt />}
        </div>

        {/* ============ RIGHT: guidance ============ */}
        <aside className="panel">
          {step === 0 && (
            <Card eyebrow="Get ready for Sunday" title="Let's set up your church computer." cta="Start — 5 easy steps" onNext={next}>
              <p>We'll do this once, together: get your projector showing, your sound coming in, and the AI listening. Every step is checked before we move on — you'll never be left wondering if it worked.</p>
              <p className="soft">Nothing here is permanent guesswork. If a step doesn't work, we show you exactly what to try.</p>
            </Card>
          )}

          {step === 1 && (
            <Card eyebrow="Step 1 of 7 · Your screen" title="Show your projector the screen." cta="Done — I tapped Extend" onNext={next} onBack={back}>
              <p><b>Plug the HDMI cable</b> into the laptop and the projector, and turn the projector on.</p>
              <p>Now hold the <b>Windows key</b> (the flag key, bottom-left) and tap <b>P</b>. A little menu slides in from the right. Tap <b className="hot">Extend</b>.</p>
              <p className="soft">Extend — not Duplicate — is what lets PresentFlow put clean slides on the projector while you keep your controls on the laptop.</p>
              <Troubleshoot open={tsOpen} onToggle={() => setTsOpen((v) => !v)} title="Can't find your screen / nothing on the projector?">
                <ol>
                  <li><b>Reseat the cable</b> — unplug HDMI at both ends and push it firmly back in (the #1 cause).</li>
                  <li><b>Projector input</b> — on the projector remote press <b>Source</b> and pick the HDMI port you used (HDMI 1 vs 2 matters).</li>
                  <li><b>Ask Windows to look again</b> — right-click the desktop → <b>Display settings</b> → <b>Detect</b>.</li>
                  <li><b>Wake the graphics</b> — press <b>Windows + Ctrl + Shift + B</b> (screen blinks once). This restarts the display driver without a reboot.</li>
                  <li>Still nothing? Power-cycle the projector, then restart the laptop with it already plugged in.</li>
                </ol>
              </Troubleshoot>
            </Card>
          )}

          {step === 2 && (
            <Card eyebrow="Step 2 of 7 · Your screen" title="Which one is the projector?" cta="That's my projector" onNext={next} onBack={back}>
              <p>PresentFlow found <b>2 screens</b> and flashed a big number on each one — look up.</p>
              <p>Tap the screen that lit up <b>on your projector wall</b>. (We keep your laptop as the control screen, so your slides never cover your buttons.)</p>
              <p className="soft">On Windows, monitors often have no name — that's why we flash the number instead of making you guess "Display 1 or 2".</p>
            </Card>
          )}

          {step === 3 && (
            <Card
              eyebrow="Step 3 of 7 · Your screen"
              title="Let's make sure it's really showing."
              cta={testSeen === "yes" ? "Yes — continue" : "Send the test"}
              onNext={testSeen === "yes" ? next : undefined}
              onBack={back}
            >
              <p>We put a <b>test card</b> on your projector. Walk out front (or glance at the wall) — <b>can you read it?</b></p>
              <div className="yn">
                <button className={`yn-b${testSeen === "yes" ? " sel" : ""}`} onClick={() => setTestSeen("yes")}>Yes, I can see it</button>
                <button className={`yn-b${testSeen === "no" ? " sel ghost" : " ghost"}`} onClick={() => setTestSeen("no")}>No, nothing there</button>
              </div>
              {testSeen === "yes" && <p className="ok">Perfect — your projector is live. That's the hard part done.</p>}
              {testSeen === "no" && (
                <div className="ts-inline">
                  <p>No worries — this is almost always one of these:</p>
                  <ol>
                    <li>Windows is on <b>Duplicate</b> instead of <b>Extend</b> — press <b>Windows + P</b> → <b>Extend</b>.</li>
                    <li>The projector is on the <b>wrong input</b> — press <b>Source</b> on its remote.</li>
                    <li>Slides landed on the laptop instead — tap <b>Swap screens</b> below.</li>
                  </ol>
                  <button className="mini" onClick={() => setTestSeen(null)}>I fixed it — send the test again</button>
                </div>
              )}
            </Card>
          )}

          {step === 4 && (
            <Card eyebrow="Step 4 of 7 · Your screen" title="Set once. Ready every Sunday." cta="Nice — next, sound" onNext={next} onBack={back}>
              <p>PresentFlow <b>remembers this projector</b>. Next week you open the app and it's already on the big screen — no setup, no fiddling.</p>
              <p className="soft">Change projectors or venue? Just run this step again. <span className="wip">(persistence auto-reopen is the piece we're wiring for the desktop build)</span></p>
            </Card>
          )}

          {step === 5 && (
            <Card eyebrow="Step 5 of 7 · Your sound" title="Bring your service audio in." cta="The bar moved — continue" onNext={micOn ? next : undefined} onBack={back}>
              <p>Plug your <b>Behringer into the laptop over USB</b>. Then pick it here and say a few words — the level bar should move.</p>
              {!micOn ? (
                <button className="do" onClick={() => setMicOn(true)}>Detect my audio &nbsp;→</button>
              ) : (
                <p className="ok">Got a clean signal from your Behringer. That's the feed the AI listens to.</p>
              )}
              <Troubleshoot open={tsOpen} onToggle={() => setTsOpen((v) => !v)} title="No sound, or the projector stole it?">
                <ol>
                  <li>Plugging in HDMI can make Windows send audio to the <b>projector</b>. Click the <b>speaker icon</b> in the taskbar → the <b>&gt;</b> arrow → pick your <b>mixer / USB</b>, not HDMI.</li>
                  <li>Make sure the mixer channel isn't muted and your vocal mic is routed to the mixer's <b>USB send</b>.</li>
                  <li>Bar still flat? Try a different USB port and re-open this step.</li>
                </ol>
              </Troubleshoot>
            </Card>
          )}

          {step === 6 && (
            <Card eyebrow="Step 6 of 7 · The magic moment" title="Turn on the AI. Say a verse." cta="I saw it project — continue" onNext={aiOn ? next : undefined} onBack={back}>
              <p>Flip <b>AI on</b> (top-right). Now PresentFlow is listening to your service.</p>
              {!aiOn ? (
                <button className="do" onClick={() => setAiOn(true)}>Turn AI on &nbsp;→</button>
              ) : (
                <p className="ok">Say <b>&ldquo;John 3:16&rdquo;</b> out loud — PresentFlow hears it, finds it, and puts it on the projector. That&rsquo;s your whole Sunday, right there.</p>
              )}
            </Card>
          )}

          {step === 7 && (
            <Card eyebrow="Step 7 of 7 · Know your way around" title="Where everything lives." cta="Got it — finish" onNext={next} onBack={back}>
              <p>The highlighted spots are all you need on a Sunday:</p>
              <ul className="where">
                <li><b>Songs / Bible / Media / Themes</b> — top bar. Your whole library and looks.</li>
                <li><b>Edit slide</b> — above the slides. Fix a typo or restyle in seconds.</li>
                <li><b>Hardware</b> — bottom-left. Screens, Audio, Video Input live here (kept tucked away until you need it).</li>
                <li><b>AI</b> — top-right. On during service, off when you're setting up.</li>
              </ul>
            </Card>
          )}

          {step >= 8 && (
            <Card eyebrow="Ready for Sunday" title="That's it — you're set." cta="Replay the tour" onNext={restart}>
              <p>Projector showing, sound coming in, AI listening, and you know where everything is. Everything from here is the same few moves.</p>
              <p className="soft">Your team can keep their eyes on the congregation — PresentFlow keeps up with the service.</p>
            </Card>
          )}
        </aside>
      </div>

      <div className="pfw-foot">Preview — extensive Windows desktop onboarding mockup. The screens/audio here are illustrations of the real first-run flow; the actual desktop app drives your projector, mixer, and AI directly.</div>
    </div>
  );
}

/* ---------------- guidance card ---------------- */
function Card({ eyebrow, title, children, cta, onNext, onBack }: {
  eyebrow: string; title: string; children: React.ReactNode; cta: string;
  onNext?: () => void; onBack?: () => void;
}) {
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
  return (
    <div className={`ts${open ? " open" : ""}`}>
      <button className="ts-h" onClick={onToggle}>{open ? "▾" : "▸"} {title}</button>
      {open && <div className="ts-body">{children}</div>}
    </div>
  );
}

/* ---------------- illustrations ---------------- */
function WelcomeArt() {
  return (
    <div className="art center">
      <div className="hero-screens">
        <div className="mon big"><div className="scr"><span>Your church<br />screen</span></div><div className="stand" /></div>
        <div className="mon small"><div className="scr dim"><span>Your controls</span></div><div className="stand" /></div>
      </div>
      <div className="hero-cap">Projector + laptop, working together</div>
    </div>
  );
}

function WinPArt() {
  const rows = [
    { t: "PC screen only", d: "projector stays black" },
    { t: "Duplicate", d: "mirror — not this one" },
    { t: "Extend", d: "separate screen — tap this", hot: true },
    { t: "Second screen only", d: "laptop goes black" },
  ];
  return (
    <div className="art">
      <div className="winp">
        <div className="winp-h">Project</div>
        {rows.map((r) => (
          <div key={r.t} className={`winp-row${r.hot ? " hot" : ""}`}>
            <span className="winp-ic" />
            <div><div className="winp-t">{r.t}</div><div className="winp-d">{r.d}</div></div>
          </div>
        ))}
      </div>
      <div className="kbd-cap"><span className="kbd">Win</span> + <span className="kbd">P</span> opens this</div>
    </div>
  );
}

function IdentifyArt() {
  return (
    <div className="art center">
      <div className="ident">
        <div className="mon big"><div className="scr num">2<span className="lbl">projector wall</span></div><div className="stand" /></div>
        <div className="mon small"><div className="scr num dim">1<span className="lbl">your laptop</span></div><div className="stand" /></div>
      </div>
      <div className="hero-cap">Tap the number showing on your wall</div>
    </div>
  );
}

function TestArt({ seen }: { seen: Branch }) {
  return (
    <div className="art center">
      <div className="mon big">
        <div className={`scr test${seen === "no" ? " blank" : ""}`}>
          {seen === "no" ? <span className="dim">nothing yet…</span> : (<><b>TEST</b><span>If you can read this on the projector,<br />tap “Yes”</span><i className="chk">✓</i></>)}
        </div>
        <div className="stand" />
      </div>
      <div className="hero-cap">A test card on your projector</div>
    </div>
  );
}

function PersistArt() {
  return (
    <div className="art center">
      <div className="persist">
        <div className="mon big"><div className="scr"><span className="ok-tick">✓</span><span>Remembered</span></div><div className="stand" /></div>
      </div>
      <div className="hero-cap">Set once — ready every Sunday</div>
    </div>
  );
}

function AudioArt({ micOn }: { micOn: boolean }) {
  return (
    <div className="art">
      <div className="audio">
        <div className="a-h">Audio input</div>
        <div className="a-list">
          <div className="a-row sel">BEHRINGER USB Audio <span className="mixtag">MIXER</span></div>
          <div className="a-row dim">Laptop microphone</div>
          <div className="a-row dim">HDMI (projector)</div>
        </div>
        <div className="a-meter-l">Level</div>
        <div className="a-meter"><i style={{ width: micOn ? "62%" : "0%" }} /></div>
        <div className={`a-status${micOn ? " on" : ""}`}>{micOn ? "✓ Getting a clean signal" : "Say a few words…"}</div>
      </div>
    </div>
  );
}

function MagicArt({ aiOn }: { aiOn: boolean }) {
  return (
    <div className="art">
      <div className="mini-console">
        <div className="mc-top"><span className={`ai-pill${aiOn ? " on" : ""}`}><i />{aiOn ? "AI ON" : "AI OFF"}</span></div>
        <div className="mc-live">
          {aiOn ? (<><div className="mc-dot">● LIVE</div><div className="mc-verse">“For God so loved the world…”</div><div className="mc-ref">John 3:16</div></>)
                : <div className="mc-idle">Turn AI on, then say a verse</div>}
        </div>
      </div>
      <div className="hero-cap">Say it — watch it hit the screen</div>
    </div>
  );
}

function ConsoleTourArt() {
  return (
    <div className="art">
      <div className="tour">
        <div className="t-top"><span className="spot">Songs · Bible · Media · Themes</span><span className="spot ai">AI</span></div>
        <div className="t-mid">
          <div className="t-side"><span className="spot small">Hardware ▸<br /><em>Screens · Audio</em></span></div>
          <div className="t-center"><span className="spot small">Edit slide</span><div className="t-slides"><i /><i /><i /></div></div>
        </div>
      </div>
      <div className="hero-cap">Everything you need, highlighted</div>
    </div>
  );
}

function ReadyArt() {
  return (
    <div className="art center">
      <div className="ready-big">Ready for<br /><em>Sunday.</em></div>
    </div>
  );
}

const CSS = `
.pfw{--ink:#0a0a0b;--panel:#0e0d10;--card:#141216;--line:rgba(255,255,255,0.09);--line2:rgba(255,255,255,0.16);
  --txt:#ECE7E0;--dim:#9a938a;--faint:#57524b;--orange:#ff7a2c;--glow:#ffb861;--green:#33d17a;
  position:fixed;inset:0;overflow:hidden;background:radial-gradient(120% 90% at 50% -10%,#161318,#0a0a0b 60%);color:var(--txt);
  font-family:"Sora","Plus Jakarta Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column}
.pfw *{box-sizing:border-box}
.pfw button{font-family:inherit;cursor:pointer}

.pfw-top{display:flex;align-items:center;justify-content:space-between;padding:18px 28px;border-bottom:1px solid var(--line)}
.pfw .brand{display:flex;align-items:center;gap:11px}
.pfw .logo{width:22px;height:22px;border-radius:6px;background:conic-gradient(from 210deg,var(--orange),var(--glow),var(--orange))}
.pfw .brand b{font-weight:700;font-size:19px;letter-spacing:-0.03em}
.pfw .brand b em{font-style:normal;color:var(--orange)}
.pfw .tag{margin-left:6px;font-family:ui-monospace,Menlo,monospace;font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--orange);border:1px solid var(--line2);border-radius:999px;padding:4px 10px}
.pfw .rail{display:flex;gap:6px;width:min(46%,420px)}
.pfw .rail i{height:3px;flex:1;border-radius:2px;background:var(--line);transition:background .4s}
.pfw .rail i.on{background:linear-gradient(90deg,var(--glow),var(--orange))}

.pfw-body{flex:1;display:grid;grid-template-columns:1.15fr 0.85fr;min-height:0}
.pfw .stage{display:flex;align-items:center;justify-content:center;padding:40px 48px;border-right:1px solid var(--line);position:relative;overflow:hidden}
.pfw .panel{display:flex;align-items:center;padding:40px 52px;overflow-y:auto}

/* card */
.pfw .card{max-width:420px;width:100%;animation:pfin .4s cubic-bezier(.2,0,.2,1) both}
@keyframes pfin{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.pfw .c-eyebrow{font-family:ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--orange);margin-bottom:14px}
.pfw .card h1{font-size:clamp(26px,2.7vw,34px);font-weight:700;letter-spacing:-.03em;line-height:1.1;text-wrap:balance;margin:0 0 16px}
.pfw .c-body p{color:var(--dim);font-size:14.5px;line-height:1.6;margin:0 0 12px}
.pfw .c-body p b{color:var(--txt);font-weight:600}
.pfw .c-body p b.hot{color:var(--orange)}
.pfw .c-body .soft{font-size:13px;color:var(--faint)}
.pfw .c-body .soft .wip{color:var(--orange);opacity:.85}
.pfw .c-body .ok{color:var(--green);font-size:13.5px}
.pfw .c-body ul.where{list-style:none;padding:0;margin:6px 0 0;display:flex;flex-direction:column;gap:9px}
.pfw .c-body ul.where li{font-size:13.5px;color:var(--dim);line-height:1.45;padding-left:16px;position:relative}
.pfw .c-body ul.where li::before{content:"";position:absolute;left:0;top:7px;width:6px;height:6px;border-radius:50%;background:var(--orange)}
.pfw .c-body ul.where li b{color:var(--txt)}
.pfw .c-actions{margin-top:24px;display:flex;align-items:center;gap:12px}
.pfw .c-next{flex:1;background:linear-gradient(180deg,var(--glow),var(--orange));color:#1a0f06;border:0;border-radius:11px;padding:14px 18px;font-weight:700;font-size:15px;display:flex;justify-content:center;align-items:center;gap:8px;box-shadow:0 10px 30px -12px rgba(255,122,44,.6);transition:filter .15s,transform .08s}
.pfw .c-next:hover:not(:disabled){filter:brightness(1.06)}
.pfw .c-next:active:not(:disabled){transform:scale(.99)}
.pfw .c-next:disabled{opacity:.4;cursor:default;filter:grayscale(.4)}
.pfw .c-next span{font-family:ui-monospace,monospace;font-size:12px}
.pfw .c-back{background:none;border:0;color:var(--dim);font-size:13px}

/* action buttons inside body */
.pfw .do{background:rgba(255,122,44,.12);border:1px solid var(--orange);color:var(--orange);border-radius:10px;padding:11px 16px;font-weight:600;font-size:14px;margin:4px 0 8px}
.pfw .yn{display:flex;gap:10px;margin:6px 0 10px}
.pfw .yn-b{flex:1;border:1px solid var(--line2);background:transparent;color:var(--txt);border-radius:10px;padding:12px;font-size:13.5px;font-weight:600}
.pfw .yn-b.sel{border-color:var(--green);background:rgba(51,209,122,.12);color:var(--green)}
.pfw .yn-b.ghost{color:var(--dim)}
.pfw .yn-b.ghost.sel{border-color:var(--orange);background:rgba(255,122,44,.1);color:var(--orange)}
.pfw .mini{margin-top:8px;background:none;border:0;color:var(--orange);font-size:13px;text-decoration:underline;text-underline-offset:2px}
.pfw .ts-inline{background:rgba(255,122,44,.06);border:1px solid rgba(255,122,44,.25);border-radius:10px;padding:12px 14px;margin-top:6px}
.pfw .ts-inline p{color:var(--dim);font-size:13px;margin:0 0 8px}
.pfw .ts-inline ol,.pfw .ts-body ol{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px}
.pfw .ts-inline li,.pfw .ts-body li{color:var(--dim);font-size:12.5px;line-height:1.5}
.pfw .ts-inline b,.pfw .ts-body b{color:var(--txt);font-weight:600}

/* troubleshoot accordion */
.pfw .ts{margin-top:16px;border-top:1px solid var(--line);padding-top:12px}
.pfw .ts-h{background:none;border:0;color:var(--orange);font-size:13px;font-weight:600;padding:0}
.pfw .ts-body{margin-top:10px}

/* ---- illustrations ---- */
.pfw .art{width:100%;max-width:560px;display:flex;flex-direction:column;align-items:center;gap:22px;animation:pfin .45s cubic-bezier(.2,0,.2,1) both}
.pfw .art.center{justify-content:center}
.pfw .hero-cap,.pfw .kbd-cap{font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)}
.pfw .kbd{display:inline-block;border:1px solid var(--line2);border-bottom-width:2px;border-radius:6px;padding:2px 8px;color:var(--txt);font-size:12px;margin:0 2px}

/* monitors */
.pfw .mon{display:flex;flex-direction:column;align-items:center}
.pfw .mon .scr{border:1px solid var(--line2);border-radius:8px;background:#050506;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--dim);font-size:13px;line-height:1.3;position:relative;overflow:hidden}
.pfw .mon .stand{width:14%;height:14px;background:var(--line2);border-radius:0 0 3px 3px}
.pfw .mon.big .scr{width:340px;height:191px}
.pfw .mon.small .scr{width:200px;height:112px}
.pfw .mon .scr.dim{color:var(--faint);background:#0a0a0c}
.pfw .hero-screens,.pfw .ident,.pfw .persist{display:flex;align-items:flex-end;gap:26px}
.pfw .mon .scr.num{font-family:"Sora";font-weight:800;font-size:64px;color:var(--orange)}
.pfw .mon .scr.num.dim{color:var(--faint);font-size:44px}
.pfw .mon .scr .lbl{position:absolute;bottom:8px;font-size:9.5px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}
.pfw .big .scr.num{box-shadow:inset 0 0 0 2px var(--orange),0 0 40px -8px rgba(255,122,44,.5)}
.pfw .scr.test{gap:6px;color:var(--txt)}
.pfw .scr.test b{font-size:26px;letter-spacing:.2em;color:#fff}
.pfw .scr.test span{font-size:11px;color:var(--dim)}
.pfw .scr.test .chk{font-style:normal;color:var(--green);font-size:22px;margin-top:2px}
.pfw .scr.test.blank{color:var(--faint)}
.pfw .scr .ok-tick{font-style:normal;color:var(--green);font-size:34px;margin-bottom:4px}

/* Windows+P panel */
.pfw .winp{width:300px;background:#1b1b1f;border:1px solid var(--line2);border-radius:12px;padding:8px;box-shadow:0 30px 80px -30px #000}
.pfw .winp-h{font-size:13px;font-weight:600;color:var(--txt);padding:8px 10px}
.pfw .winp-row{display:flex;align-items:center;gap:12px;padding:11px 10px;border-radius:8px}
.pfw .winp-row.hot{background:rgba(255,122,44,.16);box-shadow:inset 0 0 0 1px var(--orange)}
.pfw .winp-ic{width:26px;height:18px;border:1.5px solid var(--dim);border-radius:3px;flex:0 0 26px}
.pfw .winp-row.hot .winp-ic{border-color:var(--orange)}
.pfw .winp-t{font-size:13px;color:var(--txt);font-weight:500}
.pfw .winp-row.hot .winp-t{color:var(--orange);font-weight:700}
.pfw .winp-d{font-size:11px;color:var(--faint)}

/* audio */
.pfw .audio{width:360px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
.pfw .a-h,.pfw .a-meter-l{font-family:ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--faint);margin-bottom:10px}
.pfw .a-row{border:1px solid var(--line);border-radius:9px;padding:11px 13px;font-size:13.5px;margin-bottom:7px;display:flex;align-items:center;gap:8px}
.pfw .a-row.sel{border-color:var(--orange);background:rgba(255,122,44,.1)}
.pfw .a-row.dim{color:var(--faint)}
.pfw .mixtag{margin-left:auto;font-size:9px;font-weight:800;letter-spacing:.1em;color:var(--green);border:1px solid rgba(51,209,122,.5);border-radius:4px;padding:1px 5px}
.pfw .a-meter-l{margin:14px 0 6px}
.pfw .a-meter{height:12px;border-radius:6px;background:var(--line);overflow:hidden}
.pfw .a-meter i{display:block;height:100%;background:linear-gradient(90deg,var(--green),var(--glow),var(--orange));transition:width .5s ease}
.pfw .a-status{margin-top:10px;font-size:13px;color:var(--faint)}
.pfw .a-status.on{color:var(--green);font-weight:600}

/* mini console + tour */
.pfw .mini-console,.pfw .tour{width:420px;background:#0c0c0e;border:1px solid var(--line);border-radius:14px;overflow:hidden}
.pfw .mc-top{padding:12px;border-bottom:1px solid var(--line);display:flex;justify-content:flex-end}
.pfw .ai-pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line2);color:var(--faint);border-radius:999px;padding:6px 12px;font-size:12px;font-weight:700}
.pfw .ai-pill i{width:7px;height:7px;border-radius:50%;background:var(--faint)}
.pfw .ai-pill.on{border-color:rgba(51,209,122,.5);color:var(--green);background:rgba(51,209,122,.1)}
.pfw .ai-pill.on i{background:var(--green);box-shadow:0 0 8px var(--green)}
.pfw .mc-live{min-height:150px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px;position:relative}
.pfw .mc-dot{position:absolute;top:12px;left:14px;color:#ff5a5a;font-size:9px;letter-spacing:.18em}
.pfw .mc-verse{font-weight:600;font-size:17px;color:#fff;line-height:1.35}
.pfw .mc-ref{margin-top:10px;font-size:12px;color:var(--dim)}
.pfw .mc-idle{color:var(--faint);font-size:13px}

.pfw .t-top{display:flex;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--line)}
.pfw .t-mid{display:flex;min-height:150px}
.pfw .t-side{width:130px;border-right:1px solid var(--line);padding:14px;display:flex;align-items:flex-end}
.pfw .t-center{flex:1;padding:14px;display:flex;flex-direction:column;gap:12px}
.pfw .t-slides{display:flex;gap:8px}
.pfw .t-slides i{width:60px;height:34px;border-radius:5px;border:1px solid var(--line);background:#050506}
.pfw .spot{font-size:11px;color:var(--txt);border:1px dashed var(--orange);background:rgba(255,122,44,.08);border-radius:7px;padding:6px 9px;line-height:1.3}
.pfw .spot.small{font-size:10.5px}
.pfw .spot.ai{color:var(--green);border-color:var(--green);background:rgba(51,209,122,.08)}
.pfw .spot em{font-style:normal;color:var(--dim);font-size:9.5px}

.pfw .ready-big{font-size:clamp(40px,6vw,68px);font-weight:700;letter-spacing:-.04em;line-height:1;text-align:center}
.pfw .ready-big em{font-style:normal;color:var(--orange)}

.pfw-foot{text-align:center;font-family:ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:.02em;color:var(--faint);padding:8px;border-top:1px solid var(--line)}

@media (max-width:900px){.pfw-body{grid-template-columns:1fr}.pfw .stage{display:none}.pfw .panel{padding:28px}}
`;
