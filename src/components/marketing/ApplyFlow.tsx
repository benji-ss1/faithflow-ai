"use client";

/**
 * Beta application — "The Road to Wave I".
 *
 * A parchment book: a cover, three chapters (The House / The Steward / The
 * Covenant), the real twelve beta questions spread across them, and a closing
 * covenant seal. Pages turn with a 3D flip; a donkey walks a dashed road toward
 * a cross as you progress.
 *
 * This is a full reskin of the old dark typeform-style flow — the QUESTIONS and
 * the submission automation (`submitApplication` → Resend team notify + applicant
 * confirmation, honeypot, per-type validation) are preserved exactly. Answers are
 * keyed by their original QUESTIONS index so `buildAnswers()` is order-independent.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { submitApplication } from "@/app/actions/apply";

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

type Field = { key: string; label: string; placeholder: string };
type Question = {
  kicker: string;
  label: string;
  sub: string;
  why: string;
  type: "fields" | "options" | "text" | "textarea";
  fields?: Field[];
  options?: string[];
  placeholder?: string;
  otherWhen?: string[];
  otherPlaceholder?: string;
};

// The real twelve beta questions (unchanged content + types + otherWhen logic).
const QUESTIONS: Question[] = [
  {
    kicker: "The basics",
    label: "What's your church called, and where?",
    sub: "The name you use on Sunday, and the city you call home.",
    why: "So we can address you by name and match your Sunday timezone and region.",
    type: "fields",
    fields: [
      { key: "churchName", label: "Church name", placeholder: "e.g. Redemption House" },
      { key: "city", label: "City", placeholder: "e.g. Peckham, London" },
      { key: "country", label: "Country", placeholder: "e.g. United Kingdom" },
    ],
  },
  {
    kicker: "Your room",
    label: "How many gather on a Sunday?",
    sub: "Rough is fine.",
    why: "So we know your room — not to gate you. Small churches walk with us first.",
    type: "options",
    options: ["Under 100", "100–250", "250–500", "500–1,000", "1,000+"],
  },
  {
    kicker: "Your library",
    label: "How large is your song & slide library?",
    sub: "Best guess — this shapes your migration.",
    why: "We bring your library across. Knowing the size tells us how much Saturday we save you.",
    type: "options",
    options: ["Small — under 100 songs", "Medium — 100–500", "Large — 500–2,000", "Huge — 2,000+"],
  },
  {
    kicker: "Scripture",
    label: "Which Bible translation(s) do you preach from?",
    sub: "One or a few.",
    why: "So Wave I speaks in your translation from the first Sunday.",
    type: "text",
    placeholder: "NIV, ESV, KJV…",
  },
  {
    kicker: "Today",
    label: "What do you run today — and for how long?",
    sub: "ProPresenter, EasyWorship, PowerPoint, anything.",
    why: "So we know what we're bringing you across from, and what feels like home.",
    type: "text",
    placeholder: "ProPresenter 7, about 4 years",
  },
  {
    kicker: "Your device",
    label: "What device runs your presentations?",
    sub: "The beta is macOS-first; Windows is next.",
    why: "So we can tell you honestly whether Wave I fits your booth today.",
    type: "options",
    options: ["Mac", "Windows", "Other", "Not sure"],
    otherWhen: ["Other", "Not sure"],
    otherPlaceholder: "Tell us what you use",
  },
  {
    kicker: "Your desk",
    label: "What soundboard / mixer does your church use?",
    sub: "Brand and model if you know it.",
    why: "It helps us plan how PresentFlow listens to the room for automatic follow.",
    type: "textarea",
    placeholder: "e.g. Behringer X32, Allen & Heath SQ-5, Yamaha MG…",
  },
  {
    kicker: "Your workflow",
    label: "How long does one Sunday's presentation take to prepare?",
    sub: "Across the whole team.",
    why: "So we can measure the Saturday we're trying to give you back.",
    type: "options",
    options: ["Under 30 minutes", "30–60 minutes", "1–2 hours", "2–4 hours", "4+ hours", "Not sure"],
  },
  {
    kicker: "The story",
    label: "Tell us about a Sunday that went sideways.",
    sub: "A missed verse. A dead slide. A song stuck on the second when the third had come.",
    why: "Your story tells us what to build first. It's worth ten stats.",
    type: "textarea",
    placeholder: "Last Sunday our pastor jumped to a passage and…",
  },
  {
    kicker: "The dream",
    label: "If we could transform one part of your Sunday, what would you choose?",
    sub: "Pick the one that would matter most.",
    why: "So Wave I is shaped by what actually moves the needle in your room.",
    type: "options",
    options: [
      "Create presentations much faster",
      "AI-generated sermon slides",
      "Instant song & Bible verse formatting",
      "Easier last-minute changes",
      "Real-time team collaboration",
      "Beautiful slides automatically",
      "Easier volunteer training",
      "More reliable live presenting",
    ],
  },
  {
    kicker: "Reaching you",
    label: "What's your name?",
    sub: "So we know what to call you.",
    why: "A human reads every application. We'd like to greet you properly.",
    type: "fields",
    fields: [
      { key: "firstName", label: "First name", placeholder: "e.g. Sam" },
      { key: "lastName", label: "Last name", placeholder: "e.g. Lee" },
    ],
  },
  {
    kicker: "Your invite",
    label: "Where should we write to you?",
    sub: "One address. We'll reply personally — no drip sequences.",
    why: "This is where your Wave I invite goes. We onboard oldest application first.",
    type: "fields",
    fields: [{ key: "email", label: "Email", placeholder: "e.g. sam@yourchurch.org" }],
  },
];

type Chapter = { roman: string; name: string; verse: string; ref: string; qs: number[] };

// Twelve questions grouped into three chapters (four each). qs are indices into
// QUESTIONS — order here defines the page order and the global I..XII numbering.
const CHAPTERS: Chapter[] = [
  {
    roman: "I",
    name: "The House",
    verse: "Unless the Lord builds the house, the builders labour in vain.",
    ref: "Psalm 127:1 · NIV",
    qs: [0, 1, 2, 3], // church basics · attendance · library · translation
  },
  {
    roman: "II",
    name: "The Steward",
    verse: "Each of you should use whatever gift you have received to serve others.",
    ref: "1 Peter 4:10 · NIV",
    qs: [4, 5, 6, 7], // current tools · device · mixer · prep time
  },
  {
    roman: "III",
    name: "The Covenant",
    verse: "Let us hold unswervingly to the hope we profess, for he who promised is faithful.",
    ref: "Hebrews 10:23 · NIV",
    qs: [8, 9, 10, 11], // the story · the dream · name · email
  },
];

type Page =
  | { kind: "cover" }
  | { kind: "chapter"; ci: number }
  | { kind: "question"; qi: number; roman: string; chapter: Chapter }
  | { kind: "final" };

// Flatten chapters into the linear page sequence + assign global roman numerals.
const PAGES: Page[] = (() => {
  const out: Page[] = [{ kind: "cover" }];
  let g = 0;
  CHAPTERS.forEach((ch, ci) => {
    out.push({ kind: "chapter", ci });
    ch.qs.forEach((qi) => {
      out.push({ kind: "question", qi, roman: ROMAN[g], chapter: ch });
      g += 1;
    });
  });
  out.push({ kind: "final" });
  return out;
})();
const TOTAL = PAGES.length;

// Chapter stops for the progress road (position % + label).
const STOPS = [
  { pct: 0, label: "Start" },
  ...PAGES.map((p, i) => ({ p, i }))
    .filter((x) => x.p.kind === "chapter")
    .map((x) => ({ pct: (x.i / (TOTAL - 1)) * 100, label: (x.p as { ci: number }).ci >= 0 ? CHAPTERS[(x.p as { ci: number }).ci].name : "" })),
  { pct: 100, label: "The Cross" },
];

type FieldsValue = Record<string, string>;
type AnswerMap = Record<number, string | FieldsValue>;

const KIND_LABEL = (q: Question): string => {
  if (q.type === "fields") {
    if (q.fields?.some((f) => f.key === "email")) return "Email · required";
    if (q.fields?.some((f) => f.key === "firstName")) return "Your name · required";
    return "The basics · required";
  }
  if (q.type === "options") return q.otherWhen ? "Pick one" : "Pick one · optional";
  if (q.type === "textarea") return "Long answer · optional";
  return "Short answer · optional";
};

const CSS = `
.pfbeta{--ivory:#efeae0;--ivory-hi:#f5f0e5;--ivory-lo:#dcd4c2;--scorch:#1a1410;--ash:#5c534a;
  --oxblood:#8a2410;--blood:#a02a15;--ember:#c95a1c;--gold:#9c7a2c;--ink:#161310;
  color:var(--ink);font-family:var(--pf-lora),Georgia,serif;font-weight:500;min-height:100vh;
  background:
    radial-gradient(ellipse at 20% 5%, rgba(201,90,28,.06), transparent 45%),
    radial-gradient(ellipse at 85% 100%, rgba(138,36,16,.05), transparent 50%),
    var(--ivory);}
.pfbeta *{box-sizing:border-box}
.pfbeta .stage{max-width:1100px;margin:0 auto;padding:16px 40px 90px;position:relative}

/* ===== progress · donkey → cross ===== */
.pfbeta .progress{position:sticky;top:0;z-index:10;padding:18px 20px 14px;margin:0 -40px 8px;
  background:linear-gradient(180deg, rgba(239,234,224,.98), rgba(239,234,224,.85) 70%, transparent);
  backdrop-filter:blur(4px)}
.pfbeta .progress-inner{max-width:1020px;margin:0 auto;position:relative}
.pfbeta .head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;
  font-size:12px;color:var(--ash);opacity:.85}
.pfbeta .head .now{color:var(--oxblood);opacity:1}
.pfbeta .head a{color:var(--ash);text-decoration:none;border-bottom:1px solid rgba(92,83,74,.3)}
.pfbeta .head a:hover{color:var(--oxblood);border-color:var(--oxblood)}
.pfbeta .track{position:relative;height:72px}
.pfbeta .ground{position:absolute;left:0;right:0;bottom:16px;height:2px;
  background:repeating-linear-gradient(90deg, rgba(22,19,16,.55) 0 8px, transparent 8px 14px)}
.pfbeta .stop{position:absolute;bottom:8px;width:2px;height:16px;background:rgba(22,19,16,.4)}
.pfbeta .stop-label{position:absolute;bottom:-4px;transform:translateX(-50%);font-size:10.5px;color:rgba(22,19,16,.6);white-space:nowrap}
.pfbeta .cross{position:absolute;right:6px;bottom:14px;color:var(--oxblood)}
.pfbeta .donkey{position:absolute;bottom:16px;left:0;transition:left 1.2s cubic-bezier(.2,0,.2,1);color:var(--scorch)}
.pfbeta .donkey svg{display:block}
.pfbeta .donkey .leg{transform-origin:top center;animation:pfstep 700ms ease-in-out infinite alternate}
.pfbeta .donkey .leg.b{animation-delay:-350ms}
@keyframes pfstep{from{transform:rotate(-12deg)}to{transform:rotate(12deg)}}
@media (prefers-reduced-motion:reduce){.pfbeta .donkey{transition:none}.pfbeta .donkey .leg{animation:none}}

/* ===== the book ===== */
.pfbeta .book{position:relative;perspective:2200px;margin-top:10px;min-height:560px;
  transition:height .5s cubic-bezier(.55,.05,.35,1)}
.pfbeta .page{position:absolute;top:0;left:0;right:0;
  display:flex;flex-direction:column;padding:64px 78px 60px;
  transform-origin:left center;transform-style:preserve-3d;
  transition:transform 900ms cubic-bezier(.55,.05,.35,1), opacity 200ms 700ms;
  background:
    radial-gradient(ellipse at 12% 18%, rgba(220,212,194,.5), transparent 24%),
    radial-gradient(ellipse at 88% 14%, rgba(138,36,16,.06), transparent 22%),
    radial-gradient(ellipse at 78% 82%, rgba(220,212,194,.4), transparent 22%),
    repeating-linear-gradient(92deg, transparent 0 5px, rgba(120,105,80,.045) 5px 6px),
    linear-gradient(180deg, var(--ivory-hi), var(--ivory) 40%, var(--ivory-lo) 100%);
  box-shadow:inset 20px 0 40px rgba(180,164,132,.2), inset -6px 0 20px rgba(180,164,132,.15), 0 20px 40px rgba(120,100,72,.15);
  clip-path:polygon(0% 3%,3% 1%,8% 2%,14% 0%,20% 2%,28% 1%,36% 3%,44% 1%,52% 2%,60% 0%,68% 2%,76% 1%,84% 3%,92% 1%,97% 2%,100% 3%,99% 10%,100% 20%,98% 32%,100% 44%,99% 56%,100% 68%,98% 80%,100% 92%,97% 99%,90% 100%,82% 98%,72% 100%,62% 99%,52% 100%,42% 98%,32% 100%,22% 99%,14% 100%,6% 98%,2% 100%,0% 96%,1% 84%,0% 72%,2% 60%,0% 48%,1% 36%,0% 24%,1% 12%)}
.pfbeta .page.past{transform:rotateY(-176deg);opacity:0;pointer-events:none}
.pfbeta .page.future{transform:rotateY(0deg);opacity:0;pointer-events:none;transition:none}
.pfbeta .page.active{transform:rotateY(0deg);opacity:1;pointer-events:auto;z-index:5}

/* ===== type ===== */
.pfbeta .stamp{font-size:11px;letter-spacing:.02em;color:var(--gold)}
.pfbeta .p-head{display:flex;align-items:baseline;gap:14px;padding-bottom:12px;border-bottom:1px solid rgba(22,19,16,.28);margin-bottom:22px}
.pfbeta .p-head .rune{font-weight:700;font-size:24px;color:var(--oxblood);line-height:1;letter-spacing:.08em}
.pfbeta .p-head .chapter{font-family:var(--pf-cormorant),serif;font-style:italic;font-size:21px;font-weight:600;color:var(--scorch)}
.pfbeta .p-head .fill{flex:1;height:1px;background:repeating-linear-gradient(90deg, rgba(22,19,16,.4) 0 10px, transparent 10px 18px)}
.pfbeta .p-head .folio{font-size:10px;letter-spacing:.04em;color:var(--ash);text-transform:uppercase}

.pfbeta .q-num{display:inline-flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:50%;
  color:var(--oxblood);font-size:19px;letter-spacing:.06em;font-weight:600;border:1.5px solid var(--oxblood);margin-bottom:16px}
.pfbeta .kind{font-size:10.5px;letter-spacing:.03em;color:var(--ash);margin-bottom:8px;text-transform:uppercase}
.pfbeta .q-title{font-family:var(--pf-cormorant),serif;font-weight:700;font-size:clamp(30px,4.4vw,46px);line-height:1.08;color:var(--scorch);margin:0 0 12px;letter-spacing:-.005em}
.pfbeta .q-lede{font-weight:400;font-size:18px;color:var(--scorch);margin:0 0 22px;max-width:640px;line-height:1.5;opacity:.86}

/* real inputs, styled as ink on paper */
.pfbeta .fields{display:flex;flex-direction:column;gap:18px;max-width:560px}
.pfbeta .fieldrow{display:flex;flex-direction:column;gap:6px}
.pfbeta .fieldrow label{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ash)}
.pfbeta .ink-input{width:100%;background:transparent;border:none;border-bottom:1.5px solid var(--scorch);
  padding:8px 2px;font-family:var(--pf-cormorant),serif;font-size:26px;font-weight:600;color:var(--scorch);outline:none;border-radius:0}
.pfbeta .ink-input::placeholder{color:rgba(22,19,16,.34);font-weight:500}
.pfbeta .ink-input:focus{border-bottom-color:var(--oxblood)}
.pfbeta .single{max-width:560px}

.pfbeta textarea.ink-area{width:100%;max-width:640px;min-height:118px;resize:vertical;border:none;outline:none;
  background:repeating-linear-gradient(180deg, transparent 0 27px, rgba(22,19,16,.22) 27px 28px);
  font-family:var(--pf-lora),serif;font-size:17px;line-height:28px;color:var(--scorch);padding:0 2px}
.pfbeta textarea.ink-area::placeholder{color:rgba(22,19,16,.34)}

.pfbeta .opts{list-style:none;padding:0;margin:4px 0 6px;display:flex;flex-wrap:wrap;gap:9px;max-width:720px}
.pfbeta .opts li{font-size:14px;padding:11px 18px;border:1.5px solid var(--scorch);border-radius:2px;background:transparent;
  color:var(--scorch);cursor:pointer;font-weight:500;transition:transform 120ms ease, background 120ms ease}
.pfbeta .opts li:hover{transform:translateY(-1px);background:rgba(22,19,16,.05)}
.pfbeta .opts li.acc{background:var(--scorch);color:var(--ivory-hi);border-color:var(--scorch)}
.pfbeta .other{margin-top:12px}

.pfbeta .why{font-weight:400;font-size:15px;color:var(--ash);border-top:1px solid rgba(22,19,16,.18);
  padding-top:11px;margin:18px 0 0;max-width:640px;line-height:1.5}
.pfbeta .why b{font-family:var(--pf-lora),serif;font-size:10px;letter-spacing:.06em;color:var(--oxblood);font-weight:600;text-transform:uppercase}

/* nav */
.pfbeta .p-nav{display:flex;justify-content:space-between;align-items:center;margin-top:28px;padding-top:8px}
.pfbeta .btn{display:inline-flex;align-items:center;gap:9px;padding:13px 26px;font-family:var(--pf-cormorant),serif;
  font-size:16px;font-weight:600;letter-spacing:.01em;color:var(--ivory-hi);background:var(--scorch);
  border:1.5px solid var(--scorch);border-radius:6px;cursor:pointer;transition:transform 120ms ease, background 200ms ease}
.pfbeta .btn:hover{transform:translateY(-1px);background:#000}
.pfbeta .btn.ghost{background:transparent;color:var(--scorch);border-color:transparent}
.pfbeta .btn.ghost:hover{background:rgba(22,19,16,.06)}
.pfbeta .btn:disabled{opacity:.38;cursor:not-allowed;transform:none;background:var(--scorch)}
.pfbeta .btn.ghost:disabled{background:transparent}

/* cover / chapter / covenant */
.pfbeta .cover{text-align:center;padding-top:44px}
.pfbeta .cover .crest{width:104px;height:104px;margin:0 auto 10px}
.pfbeta .cover .title{font-family:var(--pf-cormorant),serif;font-weight:700;font-size:clamp(44px,7.2vw,72px);line-height:1.02;color:var(--scorch);letter-spacing:-.01em;margin:8px 0 16px}
.pfbeta .cover .title em{font-style:italic;color:var(--oxblood);font-weight:600}
.pfbeta .cover .lede{font-weight:500;font-size:18px;color:var(--scorch);max-width:560px;margin:0 auto;line-height:1.55}
.pfbeta .cover .ref{display:block;font-size:10.5px;letter-spacing:.02em;color:var(--gold);margin-top:12px}
.pfbeta .chapter-cover{text-align:center;padding-top:88px}
.pfbeta .chapter-cover .cap{font-size:12px;letter-spacing:.04em;color:var(--ash);margin-bottom:16px}
.pfbeta .chapter-cover h1{font-family:var(--pf-cormorant),serif;font-weight:700;font-size:clamp(44px,7vw,72px);color:var(--scorch);margin:6px 0 22px;line-height:1;letter-spacing:-.01em}
.pfbeta .chapter-cover .verse-block{font-weight:400;font-size:21px;color:var(--scorch);max-width:520px;margin:20px auto 0;line-height:1.55}
.pfbeta .chapter-cover .ref{display:block;font-size:10.5px;letter-spacing:.02em;color:var(--gold);margin-top:14px}
.pfbeta .center-nav{justify-content:center;gap:16px;margin-top:40px}
.pfbeta .covenant{text-align:center;padding-top:36px;position:relative}
.pfbeta .covenant .halo{position:absolute;top:-10px;left:50%;transform:translateX(-50%);width:380px;height:120px;background:radial-gradient(ellipse, rgba(201,90,28,.14), transparent 70%);pointer-events:none}
.pfbeta .covenant h2{font-family:var(--pf-cormorant),serif;font-weight:700;font-size:clamp(42px,6vw,60px);line-height:1;color:var(--scorch);margin:14px 0 8px;letter-spacing:-.01em}
.pfbeta .covenant h2 em{font-style:italic;color:var(--oxblood)}
.pfbeta .covenant .sub{font-weight:400;font-size:19px;color:var(--scorch);margin:14px auto 26px;max-width:480px;line-height:1.45}
.pfbeta .covenant .fine{font-size:11px;letter-spacing:.02em;color:var(--ash);margin-top:18px}
.pfbeta .seal{width:96px;height:96px;margin:0 auto 8px;border-radius:50%;background:radial-gradient(circle at 38% 34%, var(--blood), var(--oxblood) 62%, #5a1206);
  display:flex;align-items:center;justify-content:center;color:var(--ivory-hi);font-family:var(--pf-cormorant),serif;font-size:34px;
  box-shadow:0 12px 30px rgba(138,36,16,.35), inset 0 2px 6px rgba(255,255,255,.25)}
.pfbeta .err{margin-top:16px;font-size:14px;color:var(--blood);line-height:1.5}

@media (max-width:820px){
  .pfbeta .stage{padding:8px 14px 44px}
  .pfbeta .progress{margin:0 -14px 6px;padding:12px 10px 10px}
  .pfbeta .stop-label{font-size:9px}
  .pfbeta .page{padding:40px 26px 44px}
  .pfbeta .book{min-height:520px}
  .pfbeta .ink-input{font-size:22px}
  .pfbeta .p-nav{margin-top:22px}
}
`;

export default function ApplyFlow() {
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [otherText, setOtherText] = useState<Record<number, string>>({});
  const [hp, setHp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const bookRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const firstInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const page = PAGES[idx];

  // Size the book to the active page (pages are absolute; measure content height).
  useLayoutEffect(() => {
    const measure = () => {
      const el = pageRefs.current[idx];
      if (el && bookRef.current) bookRef.current.style.height = `${el.offsetHeight}px`;
    };
    measure();
    const t = setTimeout(measure, 60); // after fonts/flip settle
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
    };
  }, [idx]);

  // Focus the first input on question pages.
  useEffect(() => {
    const t = setTimeout(() => firstInputRef.current?.focus(), 260);
    return () => clearTimeout(t);
  }, [idx]);

  const setFieldVal = (qi: number, v: string | FieldsValue) =>
    setAnswers((p) => ({ ...p, [qi]: v }));

  // Whether the current page may be left going forward (validation gate).
  const canAdvance = (p: Page): boolean => {
    if (p.kind !== "question") return true;
    const q = QUESTIONS[p.qi];
    if (q.type === "fields") {
      const v = (answers[p.qi] as FieldsValue) || {};
      if (!(q.fields || []).every((f) => (v[f.key] || "").trim())) return false;
      if (q.fields?.some((f) => f.key === "email") && !EMAIL_RE.test((v.email || "").trim()))
        return false;
    }
    if (q.type === "options" && q.otherWhen) {
      const val = answers[p.qi];
      if (typeof val === "string" && q.otherWhen.includes(val) && !(otherText[p.qi] || "").trim())
        return false;
    }
    return true;
  };

  const go = (target: number) => {
    const t = Math.max(0, Math.min(TOTAL - 1, target));
    if (t === idx) return;
    if (t > idx && !canAdvance(page)) return;
    setDir(t > idx ? 1 : -1);
    setIdx(t);
  };

  const buildAnswers = () =>
    QUESTIONS.map((question, i) => {
      const a = answers[i];
      let answer = "";
      if (question.type === "fields") {
        const obj = (a as FieldsValue) || {};
        answer = (question.fields || [])
          .map((f) => `${f.label}: ${(obj[f.key] || "").trim()}`)
          .filter((s) => !s.endsWith(": "))
          .join(" · ");
      } else {
        answer = typeof a === "string" ? a.trim() : "";
        if (question.otherWhen && question.otherWhen.includes(answer)) {
          const ot = (otherText[i] || "").trim();
          if (ot) answer = `${answer} — ${ot}`;
        }
      }
      return { question: question.label, answer };
    }).filter((x) => x.answer);

  const doSubmit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const res = await submitApplication({ answers: buildAnswers(), hp });
      if (res.ok) setDone(true);
      else setError(res.error);
    } catch {
      setError("Something went wrong sending your application. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Keyboard: arrows turn pages (unless typing); Enter advances on text/fields.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (e.key === "ArrowRight" && !typing) go(idx + 1);
      if (e.key === "ArrowLeft" && !typing) go(idx - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, answers, otherText]);

  const cls = (i: number) => (i < idx ? "past" : i > idx ? "future" : "active");
  const headChapter =
    page.kind === "question" ? page.chapter.name
    : page.kind === "chapter" ? CHAPTERS[page.ci].name
    : page.kind === "final" ? "The Cross"
    : "The Journey Begins";
  const donkeyPct = (idx / (TOTAL - 1)) * 100;

  const enterAdvance = (e: KeyboardEvent, isLastField: boolean) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (isLastField) go(idx + 1);
    }
  };

  return (
    <main className="pfbeta">
      <style>{CSS}</style>

      {/* honeypot */}
      <input
        type="text"
        name="company_website"
        tabIndex={-1}
        autoComplete="off"
        value={hp}
        onChange={(e) => setHp(e.target.value)}
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
      />

      <div className="stage">
        {/* progress */}
        <div className="progress">
          <div className="progress-inner">
            <div className="head">
              <span><span className="now">Page {idx + 1}</span> · of {TOTAL}</span>
              <span>{headChapter} &nbsp;·&nbsp; <Link href="/">leave the road ↗</Link></span>
            </div>
            <div className="track">
              <div className="ground" />
              {STOPS.map((s, i) => (
                <span key={i}>
                  <span className="stop" style={{ left: `${s.pct}%` }} />
                  <span className="stop-label" style={{ left: `${s.pct}%`, transform: s.pct >= 100 ? "translateX(-100%)" : undefined }}>{s.label}</span>
                </span>
              ))}
              <div className="cross">
                <svg width="30" height="46" viewBox="0 0 34 52" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M17 4v46M6 18h22" />
                  <path d="M14 50h6" strokeWidth="3" />
                </svg>
              </div>
              <div className="donkey" style={{ left: `calc(${donkeyPct}% - ${donkeyPct * 0.5}px)` }}>
                <svg width="50" height="44" viewBox="0 0 52 46" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 26 q0 -8 8 -9 q4 -.5 8 0 q3 -6 8 -6 q6 0 8 6 q6 2 6 9 v4 q0 3 -3 3 h-32 q-3 0 -3 -3 z" fill="#8a6f45" fillOpacity=".55" />
                  <path d="M22 17 q3 -3 6 -3 q3 0 6 3" stroke="#5a3a1a" strokeWidth="1" />
                  <path d="M34 17 q4 -3 8 -1 q3 2 3 6 q0 3 -2 5 q-2 2 -5 1 q-3 -1 -4 -4 z" fill="#8a6f45" fillOpacity=".55" />
                  <path d="M41 23 q3 0 3 3 q0 2 -3 2 q-2 0 -2 -2 q0 -3 2 -3 z" fill="#d8bf8a" fillOpacity=".6" stroke="none" />
                  <circle cx="40" cy="20" r=".9" fill="currentColor" stroke="none" />
                  <path d="M36 15 q-1 -6 1 -9 q1 3 1 7" fill="#8a6f45" fillOpacity=".55" />
                  <path d="M40 14 q1 -6 3 -8 q0 3 -1 7" fill="#8a6f45" fillOpacity=".55" />
                  <path d="M10 24 q-4 2 -5 6" />
                  <circle cx="5" cy="31" r="1.4" fill="currentColor" stroke="none" />
                  <line className="leg" x1="16" y1="31" x2="16" y2="40" />
                  <line className="leg b" x1="22" y1="31" x2="22" y2="40" />
                  <line className="leg" x1="36" y1="31" x2="36" y2="40" />
                  <line className="leg b" x1="42" y1="31" x2="42" y2="40" />
                  <line x1="14" y1="40" x2="18" y2="40" strokeWidth="2" />
                  <line x1="20" y1="40" x2="24" y2="40" strokeWidth="2" />
                  <line x1="34" y1="40" x2="38" y2="40" strokeWidth="2" />
                  <line x1="40" y1="40" x2="44" y2="40" strokeWidth="2" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* book */}
        <div className="book" ref={bookRef}>
          {PAGES.map((p, i) => (
            <div
              key={i}
              data-dir={dir}
              ref={(el) => { pageRefs.current[i] = el; }}
              className={`page ${cls(i)}`}
            >
              {p.kind === "cover" && (
                <div className="cover">
                  <div className="crest">
                    <svg viewBox="0 0 120 120" fill="none" stroke="#5a1206" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="60" cy="60" r="56" strokeDasharray="2 3" />
                      <circle cx="60" cy="60" r="48" />
                      <path d="M60 22v18M54 28h12" />
                      <path d="M40 42v14M35 46h10" />
                      <path d="M80 42v14M75 46h10" />
                      <path d="M18 78q42-24 84 0" />
                      <path d="M40 96h40M42 100h36" stroke="#9c7a2c" />
                    </svg>
                  </div>
                  <div className="stamp">PresentFlow · Beta Application · 2026</div>
                  <h1 className="title">The Road to <em>Wave I</em></h1>
                  <p className="lede">
                    Twelve short questions, three chapters. We&apos;ll reply personally — then your first
                    Sunday together.
                    <span className="ref">Psalm 23:3 · NIV</span>
                  </p>
                  <div className="p-nav center-nav">
                    <button className="btn" onClick={() => go(idx + 1)}>Begin the road →</button>
                  </div>
                </div>
              )}

              {p.kind === "chapter" && (
                <div className="chapter-cover">
                  <div className="cap">Chapter {CHAPTERS[p.ci].roman}</div>
                  <h1>{CHAPTERS[p.ci].name}</h1>
                  <div className="verse-block">
                    &ldquo;{CHAPTERS[p.ci].verse}&rdquo;
                    <span className="ref">{CHAPTERS[p.ci].ref}</span>
                  </div>
                  <div className="p-nav center-nav">
                    <button className="btn ghost" onClick={() => go(idx - 1)}>← Back</button>
                    <button className="btn" onClick={() => go(idx + 1)}>Turn the page →</button>
                  </div>
                </div>
              )}

              {p.kind === "question" && (() => {
                const q = QUESTIONS[p.qi];
                const val = answers[p.qi] ?? (q.type === "fields" ? {} : "");
                const isActive = i === idx;
                const needsOther =
                  q.type === "options" && !!q.otherWhen && typeof val === "string" && q.otherWhen.includes(val);
                const isLastQuestion = p.qi === 11 || idx === TOTAL - 2;
                return (
                  <>
                    <div className="p-head">
                      <span className="rune">{p.chapter.roman}</span>
                      <span className="chapter">{p.chapter.name}</span>
                      <span className="fill" />
                      <span className="folio">Question {p.roman}</span>
                    </div>
                    <span className="q-num">{p.roman}</span>
                    <div className="kind">{KIND_LABEL(q)}</div>
                    <h2 className="q-title">{q.label}</h2>
                    {q.sub && <p className="q-lede">{q.sub}</p>}

                    {q.type === "fields" && (
                      <div className="fields">
                        {(q.fields || []).map((f, fi) => (
                          <div className="fieldrow" key={f.key}>
                            <label>{f.label}</label>
                            <input
                              ref={isActive && fi === 0 ? (firstInputRef as React.Ref<HTMLInputElement>) : undefined}
                              className="ink-input"
                              type={f.key === "email" ? "email" : "text"}
                              value={((val as FieldsValue) || {})[f.key] || ""}
                              onChange={(e) =>
                                setFieldVal(p.qi, {
                                  ...((typeof val === "object" ? (val as FieldsValue) : {}) || {}),
                                  [f.key]: e.target.value,
                                })
                              }
                              onKeyDown={(e) => enterAdvance(e, fi === (q.fields || []).length - 1)}
                              placeholder={f.placeholder}
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {q.type === "text" && (
                      <input
                        ref={isActive ? (firstInputRef as React.Ref<HTMLInputElement>) : undefined}
                        className="ink-input single"
                        value={val as string}
                        onChange={(e) => setFieldVal(p.qi, e.target.value)}
                        onKeyDown={(e) => enterAdvance(e, true)}
                        placeholder={q.placeholder || ""}
                      />
                    )}

                    {q.type === "textarea" && (
                      <textarea
                        ref={isActive ? (firstInputRef as React.Ref<HTMLTextAreaElement>) : undefined}
                        className="ink-area"
                        rows={4}
                        value={val as string}
                        onChange={(e) => setFieldVal(p.qi, e.target.value)}
                        placeholder={q.placeholder || ""}
                      />
                    )}

                    {q.type === "options" && (
                      <>
                        <ul className="opts">
                          {(q.options || []).map((op) => (
                            <li
                              key={op}
                              className={val === op ? "acc" : ""}
                              onClick={() => setFieldVal(p.qi, op)}
                            >
                              {op}
                            </li>
                          ))}
                        </ul>
                        {needsOther && (
                          <input
                            className="ink-input other"
                            value={otherText[p.qi] || ""}
                            onChange={(e) => setOtherText((pv) => ({ ...pv, [p.qi]: e.target.value }))}
                            onKeyDown={(e) => enterAdvance(e, true)}
                            placeholder={q.otherPlaceholder || "Tell us more"}
                            autoFocus
                          />
                        )}
                      </>
                    )}

                    <p className="why"><b>Why we ask —</b> {q.why}</p>

                    <div className="p-nav">
                      <button className="btn ghost" onClick={() => go(idx - 1)}>← Back</button>
                      <button className="btn" disabled={!canAdvance(p)} onClick={() => go(idx + 1)}>
                        {isLastQuestion ? "To the covenant →" : "Continue →"}
                      </button>
                    </div>
                  </>
                );
              })()}

              {p.kind === "final" && (
                <div className="covenant">
                  <div className="halo" />
                  {!done ? (
                    <>
                      <div className="stamp">✦ Wave I · 15 churches · free through the beta ✦</div>
                      <h2>Let the church <em>go first.</em></h2>
                      <div className="sub">
                        You&apos;ve walked the road. Seal it, and a human replies — oldest application first.
                      </div>
                      <button
                        className="btn"
                        style={{ fontSize: 15, padding: "16px 34px" }}
                        disabled={submitting}
                        onClick={() => void doSubmit()}
                      >
                        {submitting ? "Sealing…" : "✝ Seal the covenant"}
                      </button>
                      {error && <div className="err">{error}</div>}
                      <div className="p-nav center-nav">
                        <button className="btn ghost" onClick={() => go(idx - 1)}>← Back</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="seal">✝</div>
                      <div className="stamp">Sealed · Wave I · 2026</div>
                      <h2>You&apos;re on the <em>list.</em></h2>
                      <div className="sub">
                        Wave one invitations go out by email, oldest application first. We&apos;ll be in
                        touch before your first live Sunday.
                      </div>
                      <div className="p-nav center-nav">
                        <Link className="btn" href="/">Back to the site</Link>
                      </div>
                      <div className="fine">A confirmation is on its way to your inbox.</div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
