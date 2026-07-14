"use client";
import { useEffect, useState } from "react";
import { SectionHeader, Row } from "./DisplayTab";

const CHURCH_KEY = "presentflow.pro.churchName.v1";
// Y3: Legacy plaintext localStorage key. On desktop we migrate its contents
// into Electron safeStorage on first read and delete the plaintext copy.
// On web we keep using it (with a UI note) because browsers don't expose a
// keychain we can bind to a single machine.
const LICENSE_KEY = "presentflow.pro.licenseKey.v1";

type ElectronLicense = {
  get: () => Promise<{ ok: boolean; key: string | null; reason?: string }>;
  set: (key: string) => Promise<{ ok: boolean; reason?: string }>;
  clear: () => Promise<{ ok: boolean; reason?: string }>;
};
function getLicenseApi(): ElectronLicense | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { electronAPI?: { license?: ElectronLicense } }).electronAPI;
  return api?.license ?? null;
}

export function LicenseTab() {
  const [church, setChurch] = useState("");
  const [key, setKey] = useState("");
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    try {
      setChurch(localStorage.getItem(CHURCH_KEY) || "");
    } catch {}
    const api = getLicenseApi();
    if (api) {
      setIsDesktop(true);
      (async () => {
        const res = await api.get();
        if (res.ok && res.key) {
          setKey(res.key);
        } else {
          // First-time migration: promote plaintext localStorage value into
          // the keychain and wipe the plaintext copy.
          try {
            const legacy = localStorage.getItem(LICENSE_KEY);
            if (legacy) {
              const w = await api.set(legacy);
              if (w.ok) {
                setKey(legacy);
                localStorage.removeItem(LICENSE_KEY);
              } else {
                setKey(legacy);
              }
            }
          } catch {}
        }
      })().catch(() => { /* noop */ });
    } else {
      // Web: still cleartext in localStorage — flagged in the UI.
      try { setKey(localStorage.getItem(LICENSE_KEY) || ""); } catch {}
    }
  }, []);

  function onKeyChange(next: string) {
    setKey(next);
    const api = getLicenseApi();
    if (api) {
      // Fire-and-forget; if safeStorage isn't available (rare) we accept the
      // in-memory value and skip persistence rather than silently downgrade
      // to plaintext.
      void api.set(next);
    } else {
      try { localStorage.setItem(LICENSE_KEY, next); } catch {}
    }
  }

  async function onDeactivate() {
    const api = getLicenseApi();
    if (api) {
      await api.clear();
    } else {
      try { localStorage.removeItem(LICENSE_KEY); } catch {}
    }
    setKey("");
    alert("Device deactivated.");
  }

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
          onChange={(e) => onKeyChange(e.target.value)}
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

      {!isDesktop && (
        <div className="text-[10px] text-amber-300/80">
          Web build stores the license key in browser localStorage (cleartext).
          Use the desktop app for keychain-backed storage.
        </div>
      )}

      <div className="pt-2">
        <button
          onClick={onDeactivate}
          className="h-8 px-3 rounded-md border text-[11px] text-zinc-200 hover:bg-white/5"
          style={{ borderColor: "#2a3232", background: "#1a2020" }}
        >
          Deactivate this device
        </button>
      </div>
    </div>
  );
}
