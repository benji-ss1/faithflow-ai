"use client";
import { useEffect, useState } from "react";
import { SectionHeader, Row } from "./DisplayTab";

const CHURCH_KEY = "presentflow.pro.churchName.v1";
const LICENSE_KEY = "presentflow.pro.licenseKey.v1";

export function LicenseTab() {
  const [church, setChurch] = useState("");
  const [key, setKey] = useState("");

  useEffect(() => {
    try {
      setChurch(localStorage.getItem(CHURCH_KEY) || "");
      setKey(localStorage.getItem(LICENSE_KEY) || "");
    } catch {}
  }, []);

  return (
    <div className="space-y-6">
      <SectionHeader title="License" description="Church activation and device management." />

      <Row label="Church name">
        <input
          value={church}
          onChange={(e) => { setChurch(e.target.value); try { localStorage.setItem(CHURCH_KEY, e.target.value); } catch {} }}
          placeholder="Your church name"
          className="h-8 w-[240px] px-2 rounded-md border text-[11px] text-zinc-100 placeholder:text-zinc-500"
          style={{ borderColor: "#2a3232", background: "#1a2020" }}
        />
      </Row>

      <Row label="License key">
        <input
          value={key}
          onChange={(e) => { setKey(e.target.value); try { localStorage.setItem(LICENSE_KEY, e.target.value); } catch {} }}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          className="h-8 w-[240px] px-2 rounded-md border text-[11px] font-mono text-zinc-100 placeholder:text-zinc-600"
          style={{ borderColor: "#2a3232", background: "#1a2020" }}
        />
      </Row>

      <Row label="Activation status">
        <span
          className="text-[10px] font-mono px-2 py-0.5 rounded"
          style={{ background: key ? "rgba(16,185,129,0.15)" : "rgba(148,163,184,0.15)", color: key ? "#6ee7b7" : "#94a3b8" }}
        >
          {key ? "Active" : "Not activated"}
        </span>
      </Row>

      <div className="pt-2">
        <button
          onClick={() => { alert("Device deactivation coming soon."); }}
          className="h-8 px-3 rounded-md border text-[11px] text-zinc-200 hover:bg-white/5"
          style={{ borderColor: "#2a3232", background: "#1a2020" }}
        >
          Deactivate this device
        </button>
      </div>
    </div>
  );
}
