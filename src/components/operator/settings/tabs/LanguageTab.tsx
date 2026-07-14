"use client";
import { useEffect, useState } from "react";
import { SectionHeader, Row } from "./DisplayTab";

const UI_LANG_KEY = "presentflow.pro.uiLang.v1";
const BIBLE_LANG_KEY = "presentflow.pro.bibleLang.v1";

const LANGS = [
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
];

export function LanguageTab() {
  const [ui, setUi] = useState("en");
  const [bible, setBible] = useState("en");

  useEffect(() => {
    try {
      setUi(localStorage.getItem(UI_LANG_KEY) || "en");
      setBible(localStorage.getItem(BIBLE_LANG_KEY) || "en");
    } catch {}
  }, []);

  return (
    <div className="space-y-6">
      <SectionHeader title="Language" description="UI language and default Bible display language." />

      <Row label="UI Language">
        <select
          value={ui}
          onChange={(e) => { setUi(e.target.value); try { localStorage.setItem(UI_LANG_KEY, e.target.value); } catch {} }}
          className="h-8 px-2 rounded-md border text-[11px] text-zinc-100"
          style={{ borderColor: "#2a3232", background: "#1a2020" }}
        >
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </Row>

      <Row label="Bible Display Language">
        <select
          value={bible}
          onChange={(e) => { setBible(e.target.value); try { localStorage.setItem(BIBLE_LANG_KEY, e.target.value); } catch {} }}
          className="h-8 px-2 rounded-md border text-[11px] text-zinc-100"
          style={{ borderColor: "#2a3232", background: "#1a2020" }}
        >
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </Row>

      <div className="text-[11px] text-zinc-500 italic">
        Note: UI localization strings are not yet wired — these are display placeholders for the pilot.
      </div>
    </div>
  );
}
