"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import Link from "next/link";
import { submitApplication } from "@/app/actions/apply";

const MONO = "var(--pf-mono)";
const SANS = "var(--pf-sans)";

type Field = { key: string; label: string; placeholder: string };
type Question = {
  kicker: string;
  label: string;
  sub: string;
  type: "fields" | "options" | "text" | "textarea";
  fields?: Field[];
  options?: string[];
  placeholder?: string;
  // For options questions: selecting one of these values reveals a required
  // free-text box instead of auto-advancing (e.g. "Other" / "Not sure").
  otherWhen?: string[];
  otherPlaceholder?: string;
};

const QUESTIONS: Question[] = [
  {
    kicker: "THE BASICS",
    label: "Tell us about your church.",
    sub: "So we know who and where you are.",
    type: "fields",
    fields: [
      { key: "churchName", label: "Church name", placeholder: "e.g. Grace Chapel" },
      { key: "city", label: "City", placeholder: "e.g. Austin, TX" },
      { key: "country", label: "Country", placeholder: "e.g. United States" },
    ],
  },
  {
    kicker: "YOUR ROOM",
    label: "Average weekend attendance?",
    sub: "Rough is fine.",
    type: "options",
    options: ["Under 100", "100–250", "250–500", "500–1,000", "1,000+"],
  },
  {
    kicker: "TODAY",
    label: "What do you use for presentation now — and for how long?",
    sub: "ProPresenter, EasyWorship, PowerPoint, anything.",
    type: "text",
    placeholder: "ProPresenter 7, about 4 years",
  },
  {
    kicker: "YOUR LIBRARY",
    label: "How large is your song & slide library?",
    sub: "Best guess — this shapes your migration.",
    type: "options",
    options: ["Small — under 100 songs", "Medium — 100–500", "Large — 500–2,000", "Huge — 2,000+"],
  },
  {
    kicker: "YOUR SETUP",
    label: "What soundboard / mixer does your church currently use, with model?",
    sub: "Brand and model if you know it — it helps us plan audio capture.",
    type: "textarea",
    placeholder: "e.g. Behringer X32, Allen & Heath SQ-5, Yamaha MG…",
  },
  {
    kicker: "YOUR DEVICE",
    label: "What device do you currently use to run your church presentations?",
    sub: "The beta is macOS-first; Windows is next.",
    type: "options",
    options: ["Mac", "Windows", "Other", "Not sure"],
    otherWhen: ["Other", "Not sure"],
    otherPlaceholder: "Tell us what you use",
  },
  {
    kicker: "SCRIPTURE",
    label: "Preferred Bible translation(s)?",
    sub: "",
    type: "text",
    placeholder: "NIV, ESV, KJV…",
  },
  {
    kicker: "IN YOUR WORDS",
    label: "What made you want to try this?",
    sub: "Two or three sentences — the moment that made you look for something better.",
    type: "textarea",
    placeholder: "Last Sunday our pastor jumped to a passage and…",
  },
  {
    kicker: "YOUR WORKFLOW",
    label: "How long does your team usually spend preparing the presentation for one Sunday?",
    sub: "",
    type: "options",
    options: ["Under 30 minutes", "30–60 minutes", "1–2 hours", "2–4 hours", "4+ hours", "Not sure"],
  },
  {
    kicker: "THE DREAM",
    label:
      "If PresentFlow could dramatically improve one part of your Sunday workflow, what would you choose?",
    sub: "Pick the one that would matter most.",
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
    kicker: "REACHING YOU",
    label: "Your name, role & email?",
    sub: "Phone or WhatsApp optional.",
    type: "text",
    placeholder: "Sam Lee, Tech Director, sam@church.org",
  },
];

type FieldsValue = Record<string, string>;
type AnswerMap = Record<number, string | FieldsValue>;

export default function ApplyFlow() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [hp, setHp] = useState("");
  // Free-text for options questions whose selected value triggers a write-in.
  const [otherText, setOtherText] = useState<Record<number, string>>({});
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const q = QUESTIONS[step];
  const val = answers[step] ?? (q.type === "fields" ? {} : "");
  const needsOther =
    q.type === "options" &&
    !!q.otherWhen &&
    typeof val === "string" &&
    q.otherWhen.includes(val);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current && inputRef.current.focus(), 250);
    return () => clearTimeout(t);
  }, [step]);

  const setVal = (v: string | FieldsValue) =>
    setAnswers((prev) => ({ ...prev, [step]: v }));

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
      if (res.ok) {
        setDone(true);
      } else {
        setError(res.error);
      }
    } catch {
      setError("Something went wrong sending your application. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    if (q.type === "fields") {
      const v = (answers[step] as FieldsValue) || {};
      if (!(q.fields || []).every((f) => (v[f.key] || "").trim())) return;
    }
    if (needsOther && !(otherText[step] || "").trim()) return;
    if (step < QUESTIONS.length - 1) {
      setStep(step + 1);
    } else {
      void doSubmit();
    }
  };

  const isLast = step === QUESTIONS.length - 1;
  const fieldsOk =
    q.type !== "fields" ||
    (q.fields || []).every((f) => (((val as FieldsValue) || {})[f.key] || "").trim());
  const otherOk = !needsOther || (otherText[step] || "").trim().length > 0;
  const nextOk = fieldsOk && otherOk && !submitting;

  const progressStyle: CSSProperties = {
    height: 2,
    borderRadius: 2,
    background: "linear-gradient(90deg,#F7941D,#FDB748)",
    width: ((done ? QUESTIONS.length : step + 1) / QUESTIONS.length) * 100 + "%",
    transition: "width .5s cubic-bezier(.22,1,.36,1)",
  };

  const nextStyle: CSSProperties = {
    cursor: nextOk ? "pointer" : "not-allowed",
    fontWeight: 700,
    fontSize: 15,
    padding: "13px 26px",
    borderRadius: 10,
    background: nextOk ? "linear-gradient(100deg,#F7941D,#FDB748)" : "rgba(255,255,255,.07)",
    color: nextOk ? "#1A1005" : "#5C5852",
    transition: "all .25s ease",
  };

  const nextLabel = submitting
    ? "Submitting…"
    : isLast
      ? "Submit application"
      : "Continue";
  const enterHint = q.type === "text" || q.type === "fields" ? "press Enter ↩" : "";

  return (
    <main
      style={{
        maxWidth: 660,
        margin: "0 auto",
        padding: "140px 24px 80px",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div
          style={{
            font: `500 12px ${MONO}`,
            letterSpacing: "0.16em",
            color: "var(--ember)",
          }}
        >
          BETA APPLICATION&nbsp;&nbsp;·&nbsp;&nbsp;{step + 1} OF {QUESTIONS.length}
        </div>
        <Link
          href="/"
          className="pf-link-gold"
          style={{
            font: `500 12px ${MONO}`,
            letterSpacing: "0.14em",
            color: "var(--faint)",
          }}
        >
          ← BACK TO SITE
        </Link>
      </div>
      <div
        style={{
          height: 2,
          background: "rgba(255,255,255,.08)",
          borderRadius: 2,
          marginTop: 16,
        }}
      >
        <div style={progressStyle} />
      </div>

      {/* honeypot */}
      <input
        type="text"
        name="company_website"
        tabIndex={-1}
        autoComplete="off"
        value={hp}
        onChange={(e) => setHp(e.target.value)}
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-9999px",
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "none",
        }}
      />

      {!done && (
        <div
          key={step}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "56px 0",
            animation: "pfFadeUp .5s cubic-bezier(.22,1,.36,1) both",
          }}
        >
          <div
            style={{
              font: `500 12px ${MONO}`,
              letterSpacing: "0.16em",
              color: "var(--faint)",
            }}
          >
            {q.kicker}
          </div>
          <h1
            style={{
              margin: "14px 0 0",
              fontWeight: 800,
              fontSize: "clamp(26px,3.6vw,40px)",
              letterSpacing: "-.02em",
              lineHeight: 1.15,
              textWrap: "balance",
            }}
          >
            {q.label}
          </h1>
          <p style={{ margin: "12px 0 0", fontSize: 15, lineHeight: 1.6, color: "var(--muted)" }}>
            {q.sub}
          </p>

          <div style={{ marginTop: 34 }}>
            {q.type === "fields" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                {(q.fields || []).map((f, i) => (
                  <div key={f.key} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label
                      style={{
                        font: `500 11px ${MONO}`,
                        letterSpacing: "0.16em",
                        textTransform: "uppercase",
                        color: "var(--faint)",
                      }}
                    >
                      {f.label}
                    </label>
                    <input
                      ref={i === 0 ? (inputRef as React.Ref<HTMLInputElement>) : undefined}
                      value={((val as FieldsValue) || {})[f.key] || ""}
                      onChange={(e) =>
                        setVal({
                          ...((typeof val === "object" ? (val as FieldsValue) : {}) || {}),
                          [f.key]: e.target.value,
                        })
                      }
                      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (i === (q.fields || []).length - 1) next();
                        }
                      }}
                      placeholder={f.placeholder}
                      className="pf-input"
                      style={{
                        width: "100%",
                        background: "none",
                        border: "none",
                        borderBottom: "2px solid rgba(247,148,29,.35)",
                        padding: "10px 2px",
                        font: `600 20px ${SANS}`,
                        color: "var(--ink)",
                        borderRadius: 0,
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

            {q.type === "text" && (
              <input
                ref={inputRef as React.Ref<HTMLInputElement>}
                value={val as string}
                onChange={(e) => setVal(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    next();
                  }
                }}
                placeholder={q.placeholder || ""}
                className="pf-input"
                style={{
                  width: "100%",
                  background: "none",
                  border: "none",
                  borderBottom: "2px solid rgba(255,255,255,.16)",
                  padding: "12px 2px",
                  font: `600 22px ${SANS}`,
                  color: "var(--ink)",
                  borderRadius: 0,
                }}
              />
            )}

            {q.type === "textarea" && (
              <textarea
                ref={inputRef as React.Ref<HTMLTextAreaElement>}
                value={val as string}
                onChange={(e) => setVal(e.target.value)}
                placeholder={q.placeholder || ""}
                rows={4}
                className="pf-textarea"
                style={{
                  width: "100%",
                  background: "var(--panel)",
                  border: "1px solid rgba(255,255,255,.14)",
                  borderRadius: 12,
                  padding: 16,
                  font: `500 17px/1.55 ${SANS}`,
                  color: "var(--ink)",
                  resize: "vertical",
                }}
              />
            )}

            {q.type === "options" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(q.options || []).map((op, i) => {
                  const selected = val === op;
                  return (
                    <a
                      key={op}
                      onClick={() => {
                        setVal(op);
                        // Options that reveal a write-in box must not auto-advance;
                        // the operator needs to type first, then hit Continue.
                        if (!q.otherWhen?.includes(op)) {
                          setTimeout(() => next(), 260);
                        }
                      }}
                      className="pf-option"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        cursor: "pointer",
                        padding: "14px 18px",
                        borderRadius: 12,
                        border: selected
                          ? "1px solid #F7941D"
                          : "1px solid rgba(255,255,255,.14)",
                        background: selected ? "rgba(247,148,29,.1)" : "var(--panel)",
                        color: selected ? "var(--ink)" : "var(--muted)",
                        fontWeight: 600,
                        fontSize: 16,
                      }}
                    >
                      <span
                        style={{
                          font: `600 11px ${MONO}`,
                          width: 22,
                          height: 22,
                          borderRadius: 6,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          border:
                            "1px solid " +
                            (selected ? "rgba(247,148,29,.6)" : "rgba(255,255,255,.18)"),
                          color: selected ? "var(--ember)" : "var(--faint)",
                        }}
                      >
                        {String.fromCharCode(65 + i)}
                      </span>
                      {op}
                    </a>
                  );
                })}
                {needsOther && (
                  <input
                    value={otherText[step] || ""}
                    onChange={(e) =>
                      setOtherText((prev) => ({ ...prev, [step]: e.target.value }))
                    }
                    onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (nextOk) next();
                      }
                    }}
                    placeholder={q.otherPlaceholder || "Tell us more"}
                    className="pf-input"
                    autoFocus
                    style={{
                      width: "100%",
                      marginTop: 4,
                      background: "none",
                      border: "none",
                      borderBottom: "2px solid rgba(247,148,29,.35)",
                      padding: "10px 2px",
                      font: `600 18px ${SANS}`,
                      color: "var(--ink)",
                      borderRadius: 0,
                    }}
                  />
                )}
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 38 }}>
            {(q.type !== "options" || needsOther) && (
              <a
                onClick={() => nextOk && next()}
                className="pf-next"
                style={nextStyle}
              >
                {nextLabel}
              </a>
            )}
            {step > 0 && (
              <a
                onClick={() => setStep(Math.max(0, step - 1))}
                className="pf-link-gold"
                style={{
                  cursor: "pointer",
                  font: `500 12px ${MONO}`,
                  letterSpacing: "0.14em",
                  color: "var(--faint)",
                }}
              >
                ← BACK
              </a>
            )}
            <span style={{ font: `400 11px ${MONO}`, color: "#3F3C37" }}>{enterHint}</span>
          </div>

          {error && (
            <div
              style={{
                marginTop: 18,
                font: `500 13px ${SANS}`,
                color: "#F87171",
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
          )}
        </div>
      )}

      {done && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            textAlign: "center",
            padding: "56px 0",
            animation: "pfFadeUp .5s cubic-bezier(.22,1,.36,1) both",
          }}
        >
          <div
            style={{
              width: 74,
              height: 74,
              borderRadius: "50%",
              background: "linear-gradient(120deg,#F7941D,#FDB748)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 32,
              color: "#1A1005",
              boxShadow: "0 14px 50px rgba(247,148,29,.4)",
            }}
          >
            ✓
          </div>
          <h1
            style={{
              margin: "30px 0 0",
              fontWeight: 800,
              fontSize: "clamp(32px,4.6vw,52px)",
              letterSpacing: "-.03em",
            }}
          >
            You&apos;re on the list.
          </h1>
          <p
            style={{
              margin: "16px auto 0",
              maxWidth: 420,
              fontSize: 16,
              lineHeight: 1.65,
              color: "var(--muted)",
            }}
          >
            Wave one invitations go out by email, oldest application first. We&apos;ll be
            in touch before your first live Sunday.
          </p>
          <Link
            href="/"
            className="pf-btn-ghost"
            style={{
              marginTop: 34,
              fontWeight: 600,
              fontSize: 14,
              padding: "13px 24px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,.16)",
              color: "var(--ink)",
            }}
          >
            Back to the site
          </Link>
        </div>
      )}
    </main>
  );
}
