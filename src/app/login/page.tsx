"use client";
import { Suspense, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { requestPasswordReset } from "@/lib/auth-actions";

const LoginScene = dynamic(() => import("./LoginScene"), { ssr: false });

const HELP_EMAIL = "contact@presentflow.org";

const CSS = `
.pflogin{--ink:#0a0908;--paper:#ECE7E0;--paper-2:#c9c2b8;--paper-dim:#8a847b;--paper-faint:#4a4640;
  --orange:#ff7a2c;--orange-glow:#ffb861;--hair:rgba(236,231,224,0.12);--hair-strong:rgba(236,231,224,0.28);
  position:fixed;inset:0;overflow:hidden;background:var(--ink);color:var(--paper);
  font-family:"Plus Jakarta Sans",system-ui,sans-serif;font-weight:400;letter-spacing:-0.005em;-webkit-font-smoothing:antialiased}
.pflogin *{box-sizing:border-box}
.pflogin .scene{position:absolute;inset:0;z-index:0}
.pflogin .noise{position:absolute;inset:0;z-index:1;pointer-events:none;opacity:.35;mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.93 0 0 0 0 0.90 0 0 0 0 0.86 0 0 0 0.06 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}
.pflogin .vignette{position:absolute;inset:0;z-index:2;pointer-events:none;background:radial-gradient(120% 80% at 50% 55%, transparent 55%, rgba(0,0,0,0.55) 100%)}
.pflogin .projectors{position:absolute;left:0;top:0;width:57%;height:100%;z-index:2;pointer-events:none;overflow:hidden}
.pflogin .proj{position:absolute;border:1px solid rgba(236,231,224,0.55);background:#0a0908;padding:6px;border-radius:2px;
  box-shadow:0 30px 80px -30px rgba(0,0,0,0.9),0 0 0 1px rgba(236,231,224,0.08);opacity:0;
  animation-fill-mode:both;animation-iteration-count:infinite;animation-timing-function:cubic-bezier(0.33,0.05,0.2,1);animation-duration:32s;animation-delay:var(--delay,0s);will-change:transform,opacity}
.pflogin .proj-inner{overflow:hidden;background:#000;position:relative;aspect-ratio:16/9}
.pflogin .proj-inner img{display:block;width:100%;height:100%;object-fit:cover;filter:saturate(0.9) brightness(0.95)}
.pflogin .proj-tag{position:absolute;left:8px;bottom:-22px;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:9px;letter-spacing:0.22em;text-transform:uppercase;color:var(--paper-faint);white-space:nowrap}
@keyframes pflane1{0%{opacity:0;transform:translate(12vw,78vh) scale(0.75) rotate(-4deg)}18%{opacity:1}55%{opacity:1}100%{opacity:0;transform:translate(12vw,22vh) scale(0.95) rotate(-4deg)}}
@keyframes pflane2{0%{opacity:0;transform:translate(30vw,80vh) scale(0.7) rotate(3deg)}18%{opacity:1}55%{opacity:1}100%{opacity:0;transform:translate(30vw,20vh) scale(0.9) rotate(3deg)}}
@keyframes pflane3{0%{opacity:0;transform:translate(6vw,82vh) scale(0.8) rotate(-2deg)}18%{opacity:1}55%{opacity:1}100%{opacity:0;transform:translate(6vw,24vh) scale(1.0) rotate(-2deg)}}
@keyframes pflane4{0%{opacity:0;transform:translate(38vw,78vh) scale(0.72) rotate(5deg)}18%{opacity:1}55%{opacity:1}100%{opacity:0;transform:translate(38vw,20vh) scale(0.92) rotate(5deg)}}
@keyframes pflane5{0%{opacity:0;transform:translate(20vw,84vh) scale(0.78) rotate(-3deg)}18%{opacity:1}55%{opacity:1}100%{opacity:0;transform:translate(20vw,22vh) scale(1.0) rotate(-3deg)}}
.pflogin .p1{--delay:.8s;width:210px;animation-name:pflane1}.pflogin .p2{--delay:7s;width:180px;animation-name:pflane2}
.pflogin .p3{--delay:14s;width:230px;animation-name:pflane3}.pflogin .p4{--delay:21s;width:200px;animation-name:pflane4}.pflogin .p5{--delay:28s;width:210px;animation-name:pflane5}

.pflogin .page{position:relative;z-index:3;height:100%;display:grid;grid-template-columns:1.15fr 0.85fr}
.pflogin .hero{padding:44px 56px 44px 64px;display:flex;flex-direction:column;justify-content:space-between;position:relative}
.pflogin .brand{display:flex;align-items:center;gap:14px}
.pflogin .brand img{height:34px;width:auto;display:block}
.pflogin .wordmark{font-family:"Sora",sans-serif;font-weight:700;font-size:24px;letter-spacing:-0.03em;color:var(--paper)}
.pflogin .wordmark em{font-style:normal;font-weight:700;color:var(--orange)}
.pflogin .hero-copy{max-width:640px;margin-top:auto;margin-bottom:8vh}
.pflogin .eyebrow{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:var(--orange);margin-bottom:28px;display:flex;align-items:center;gap:12px}
.pflogin .eyebrow::before{content:"";width:22px;height:1px;background:var(--orange)}
.pflogin h1.headline{font-family:"Sora",sans-serif;font-weight:700;font-size:clamp(42px,5.4vw,86px);line-height:1.02;letter-spacing:-0.035em;color:var(--paper);text-wrap:balance}
.pflogin h1.headline em{font-style:normal;font-weight:700;color:var(--orange)}
.pflogin .lede{margin-top:28px;font-size:16px;line-height:1.55;color:var(--paper-dim);max-width:52ch}
.pflogin .heroFoot{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:var(--orange)}

.pflogin .aside{padding:44px 64px 44px 40px;display:flex;flex-direction:column;border-left:1px solid var(--hair);background:linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(0,0,0,0.35) 100%);backdrop-filter:blur(2px)}
.pflogin .aside-top{display:flex;justify-content:space-between;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:var(--paper-faint)}
.pflogin .aside-top .o{color:var(--orange)}
.pflogin .form-wrap{margin:auto 0;max-width:400px;width:100%}
.pflogin .welcome{font-family:"Sora",sans-serif;font-weight:500;font-size:15px;letter-spacing:-0.01em;color:var(--paper-2);margin-bottom:14px}
.pflogin h2.signin{font-family:"Sora",sans-serif;font-weight:700;font-size:40px;line-height:1.05;letter-spacing:-0.035em;color:var(--paper)}
.pflogin h2.signin .o,.pflogin h2.signin em{font-style:normal;font-weight:700;color:var(--orange)}
.pflogin .subtle{margin-top:14px;color:var(--paper-dim);font-size:15px;line-height:1.5}
.pflogin .banner{margin-top:18px;border-radius:10px;border:1px solid rgba(255,144,72,0.35);background:rgba(255,144,72,0.08);color:#ff9048;padding:10px 12px;font-size:12.5px;line-height:1.4}
.pflogin .field{margin-top:26px;display:flex;flex-direction:column;gap:9px}
.pflogin .field label{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:var(--paper-dim);display:flex;justify-content:space-between}
.pflogin .field label button{background:none;border:0;cursor:pointer;color:var(--paper-2);font:inherit;border-bottom:1px solid var(--hair-strong);padding:0}
.pflogin .field input{background:transparent;border:0;border-bottom:1px solid var(--hair-strong);padding:12px 2px;color:var(--paper);font-family:"Plus Jakarta Sans",sans-serif;font-size:16px;letter-spacing:-0.005em;outline:none;transition:border-color .2s}
.pflogin .field input::placeholder{color:var(--paper-faint)}
.pflogin .field input:focus{border-bottom-color:var(--paper)}
.pflogin button.signin-btn{margin-top:36px;width:100%;background:linear-gradient(180deg,var(--orange-glow) 0%,var(--orange) 100%);color:#fff;border:0;padding:15px 20px;cursor:pointer;border-radius:10px;font-family:"Sora",sans-serif;font-weight:700;font-size:16px;letter-spacing:-0.01em;display:flex;justify-content:space-between;align-items:center;transition:filter .2s,transform .09s;box-shadow:0 8px 32px -12px rgba(255,122,44,0.55)}
.pflogin button.signin-btn:hover{filter:brightness(1.06)}
.pflogin button.signin-btn:active{transform:scale(0.99)}
.pflogin button.signin-btn:disabled{opacity:.7;cursor:default}
.pflogin button.signin-btn .arr{font-family:ui-monospace,monospace;font-size:12px;letter-spacing:0.2em}
.pflogin .note{margin-top:24px;font-size:13px;line-height:1.55;color:var(--paper-faint);max-width:42ch}
.pflogin .note .o{color:var(--orange)}
.pflogin .aside-foot{margin-top:auto;padding-top:32px;display:flex;justify-content:space-between;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:var(--paper-faint);border-top:1px solid var(--hair)}
.pflogin .aside-foot > div{padding-top:16px}
.pflogin .aside-foot button{background:none;border:0;cursor:pointer;color:var(--orange);font:inherit}
.pflogin .expand{max-height:0;opacity:0;overflow:hidden;transition:max-height .55s cubic-bezier(0.2,0,0.2,1),opacity .35s ease,margin .55s cubic-bezier(0.2,0,0.2,1)}
.pflogin .expand.open{max-height:240px;opacity:1;margin-top:14px}
.pflogin .reset-card,.pflogin .help-card{border:1px solid var(--hair-strong);background:rgba(28,24,32,0.6);backdrop-filter:blur(8px);border-radius:12px;padding:16px 18px;color:var(--paper-2);font-size:13px;line-height:1.5}
.pflogin .rc-title{font-family:"Sora",sans-serif;font-weight:600;color:var(--paper);font-size:14px;letter-spacing:-0.01em;margin-bottom:6px}
.pflogin .reset-card input{margin-top:10px;width:100%;background:transparent;border:0;border-bottom:1px solid var(--hair-strong);padding:8px 2px;color:var(--paper);font-family:"Plus Jakarta Sans",sans-serif;font-size:14px;outline:none}
.pflogin .rc-actions{margin-top:14px;display:flex;gap:10px;justify-content:flex-end}
.pflogin .rc-actions button{background:var(--orange);color:#fff;border:0;border-radius:8px;padding:8px 14px;font-family:"Sora",sans-serif;font-weight:600;font-size:12px;cursor:pointer;transition:filter .2s}
.pflogin .rc-actions button.ghost{background:transparent;color:var(--paper-dim)}
.pflogin .help-card a{color:var(--orange);text-decoration:none;border-bottom:1px solid var(--hair-strong)}
@media (max-width:1100px){.pflogin .projectors{width:100%}.pflogin .p2,.pflogin .p4{display:none}}
@media (max-width:900px){.pflogin .page{grid-template-columns:1fr}.pflogin .hero{display:none}.pflogin .aside{border-left:0}}
@media (prefers-reduced-motion:reduce){.pflogin .proj{display:none}}
`;

const SLIDES = [
  { src: "/login/slide-1.png", tag: "Scripture · Exodus 4:7" },
  { src: "/login/slide-2.png", tag: "Scripture · Psalms 23:4" },
  { src: "/login/slide-3.png", tag: "Song · Revelation Song" },
  { src: "/login/slide-4.png", tag: "Song · Worthy Is Your Name" },
  { src: "/login/slide-5.png", tag: "Song · Alleluia" },
];

function LoginForm() {
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next");
  const reason = searchParams.get("reason");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetting, setResetting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      toast.error("Invalid credentials");
      return;
    }
    let safe = false;
    if (nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") && !nextParam.includes("\\")) {
      try {
        const u = new URL(nextParam, window.location.origin);
        safe = u.origin === window.location.origin && !u.pathname.startsWith("/login") && !u.pathname.startsWith("/signup");
      } catch { safe = false; }
    }
    window.location.href = safe ? nextParam! : "/dashboard";
  }

  async function sendReset() {
    const target = (resetEmail || email).trim();
    if (!target) { toast.error("Enter your church email first"); return; }
    setResetting(true);
    await requestPasswordReset(target).catch(() => {});
    setResetting(false);
    setForgotOpen(false);
    // Non-enumerating: always the same message.
    toast.success("If that email has an account, a reset link is on its way.");
  }

  return (
    <div className="pflogin">
      <style>{CSS}</style>
      <div className="scene"><LoginScene /></div>
      <div className="noise" />
      <div className="projectors" aria-hidden="true">
        {SLIDES.map((s, i) => (
          <div key={i} className={`proj p${i + 1}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <div className="proj-inner"><img src={s.src} alt="" /></div>
            <div className="proj-tag">{s.tag}</div>
          </div>
        ))}
      </div>
      <div className="vignette" />

      <div className="page">
        <section className="hero">
          <div className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/pf-logo-mark.png" alt="PresentFlow" />
            <span className="wordmark">Present<em>Flow</em></span>
          </div>
          <div className="hero-copy">
            <div className="eyebrow">AI presentation &amp; operations for churches</div>
            <h1 className="headline">Every service, <em>on autopilot.</em></h1>
            <p className="lede">
              <span style={{ color: "var(--orange)" }}>PresentFlow listens to the room,</span>{" "}
              <span style={{ color: "var(--paper)" }}>detects the scripture, cues the song, and runs the operations of your service — so your team can keep their eyes on the congregation.</span>
            </p>
          </div>
          <div className="heroFoot">Wave I · Invite only</div>
        </section>

        <aside className="aside">
          <div className="aside-top"><span className="o">Access</span><span>01 / 01</span></div>
          <div className="form-wrap">
            <div className="welcome">Welcome back.</div>
            <h2 className="signin"><span className="o">Sign in</span> to <em>continue</em>.</h2>
            <p className="subtle">Pick up right where your last service left off.</p>

            {reason === "session_expired" && (
              <div className="banner" role="status">You were signed out. Sign back in to return to your live plan.</div>
            )}
            {reason === "device_link_invalid" && (
              <div className="banner" role="status">That desktop sign-in link expired or was already used. Open PresentFlow again from the desktop app for a fresh one.</div>
            )}

            <form onSubmit={onSubmit}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" required autoComplete="email" placeholder="you@yourchurch.org" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="pw">Password <button type="button" onClick={() => setForgotOpen((v) => !v)}>Forgot?</button></label>
                <input id="pw" type="password" required autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>

              <div className={`expand${forgotOpen ? " open" : ""}`}>
                <div className="reset-card">
                  <div className="rc-title">Reset your password</div>
                  <div>Enter your church email. We&apos;ll send a reset link within a minute.</div>
                  <input type="email" placeholder="you@yourchurch.org" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} />
                  <div className="rc-actions">
                    <button className="ghost" type="button" onClick={() => setForgotOpen(false)}>Cancel</button>
                    <button type="button" onClick={sendReset} disabled={resetting}>{resetting ? "Sending…" : "Send link"}</button>
                  </div>
                </div>
              </div>

              <button className="signin-btn" type="submit" disabled={loading}>
                <span className="label">{loading ? "Signing in…" : "Sign in"}</span>
                <span className="arr">→</span>
              </button>
            </form>

            <p className="note"><span className="o">Wave I is invite-only.</span> Your login was sent to you — no account yet? Ask your team lead.</p>
          </div>

          <div className="aside-foot">
            <div><span className="o">Trusted for churches</span></div>
            <div><button type="button" onClick={() => setHelpOpen((v) => !v)}>Need help?</button></div>
          </div>
          <div className={`expand${helpOpen ? " open" : ""}`}>
            <div className="help-card">
              <div className="rc-title">We&apos;re here.</div>
              <div>Email <a href={`mailto:${HELP_EMAIL}`}>{HELP_EMAIL}</a> or ask your team lead — pilot churches get a same-day reply.</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
