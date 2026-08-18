/**
 * Shared parchment/editorial shell for legal pages (Privacy, Terms). Serif
 * headings, readable body, matching the light editorial surfaces (CtaSection /
 * OurStory). Content is passed in as structured sections so each page file is
 * just data.
 */
import Link from "next/link";

export type LegalSection = {
  heading: string;
  paragraphs: (string | { list: string[] })[];
};

const CSS = `
.pflegal{--cream:#F5F1EA;--cream-hi:#faf7f0;--ink:#1a140d;--muted:#6a635a;--faint:#8c8478;
  --oxblood:#8F2C10;--line:#e3ddd2;
  position:relative;background:var(--cream);color:var(--ink);min-height:100vh;font-family:var(--pf-sans)}
.pflegal .wrap{max-width:820px;margin:0 auto;padding:clamp(116px,15vw,190px) clamp(28px,6vw,72px) clamp(80px,12vw,140px)}
.pflegal .kicker{font-family:var(--pf-mono);font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--oxblood)}
.pflegal h1{margin:20px 0 0;font-family:var(--pf-serif),"Iowan Old Style",Georgia,serif;font-weight:300;
  font-size:clamp(40px,6.5vw,76px);line-height:1.02;letter-spacing:-.02em}
.pflegal .eff{margin:16px 0 0;font-family:var(--pf-mono);font-size:12px;letter-spacing:.06em;color:var(--faint)}
.pflegal .intro{margin:26px 0 0;font-family:var(--pf-cormorant),Georgia,serif;font-size:clamp(19px,2vw,24px);
  line-height:1.5;color:#3f382f;max-width:60ch}
.pflegal section{margin-top:clamp(36px,5vw,56px)}
.pflegal h2{font-family:var(--pf-serif),Georgia,serif;font-weight:400;font-size:clamp(23px,2.6vw,30px);
  line-height:1.15;letter-spacing:-.01em;margin:0 0 4px;color:var(--ink)}
.pflegal h2 .n{font-family:var(--pf-mono);font-size:13px;color:var(--oxblood);margin-right:12px;letter-spacing:.04em}
.pflegal p{margin:14px 0 0;font-size:16px;line-height:1.7;color:#3f382f;max-width:70ch;text-wrap:pretty}
.pflegal ul{margin:12px 0 0;padding-left:22px;max-width:70ch}
.pflegal li{font-size:16px;line-height:1.7;color:#3f382f;margin:4px 0}
.pflegal a{color:var(--oxblood);text-decoration:underline;text-underline-offset:2px}
.pflegal .back{display:inline-block;margin-top:clamp(48px,7vw,72px);font-family:var(--pf-mono);font-size:12px;
  letter-spacing:.1em;text-transform:uppercase;color:var(--muted);text-decoration:none;border-bottom:1px solid rgba(92,83,74,.3)}
.pflegal .back:hover{color:var(--oxblood);border-color:var(--oxblood)}
.pflegal .note{margin-top:clamp(40px,6vw,64px);padding-top:20px;border-top:1px solid var(--line);
  font-size:13px;line-height:1.6;color:var(--faint);max-width:70ch}
`;

export default function LegalPage({
  kicker,
  title,
  effective,
  intro,
  sections,
  footNote,
}: {
  kicker: string;
  title: string;
  effective: string;
  intro: string;
  sections: LegalSection[];
  footNote?: string;
}) {
  return (
    <main className="pflegal">
      <style>{CSS}</style>
      <div className="wrap">
        <div className="kicker">{kicker}</div>
        <h1>{title}</h1>
        <div className="eff">{effective}</div>
        <p className="intro">{intro}</p>

        {sections.map((s, i) => (
          <section key={i}>
            <h2><span className="n">{String(i + 1).padStart(2, "0")}</span>{s.heading}</h2>
            {s.paragraphs.map((para, k) =>
              typeof para === "string" ? (
                <p
                  key={k}
                  dangerouslySetInnerHTML={{ __html: para }}
                />
              ) : (
                <ul key={k}>
                  {para.list.map((li, j) => (
                    <li key={j} dangerouslySetInnerHTML={{ __html: li }} />
                  ))}
                </ul>
              ),
            )}
          </section>
        ))}

        {footNote && <div className="note">{footNote}</div>}
        <Link href="/" className="back">← Back to PresentFlow</Link>
      </div>
    </main>
  );
}
