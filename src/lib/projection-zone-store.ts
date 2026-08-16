"use client";
/**
 * Projection Zone profile store — per-machine persistence + CRUD.
 *
 * The spec called for a JSON file in ~/Library/Application Support. In the
 * Electron RENDERER the equivalent per-machine store is localStorage, which is
 * exactly how every other operator-machine preference is persisted here
 * (fontScale, aspectRatio, autoApprove…). Kept as one JSON blob so it survives
 * restarts and is trivially portable; a cross-tab/‑window `storage`-style event
 * keeps the editor and the operator console in sync.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_ZONE, normalizeZone,
  type ProjectionZone, type ProjectionZoneProfile,
} from "./projection-zone";

const STORAGE_KEY = "presentflow.projectionZones.v1";
const CHANGE_EVENT = "presentflow:projection-zones-changed";

type Persisted = { profiles: ProjectionZoneProfile[]; activeProfileId: string | null };

function now(): string { return new Date().toISOString(); }
function uid(): string {
  try { return crypto.randomUUID(); } catch { return `pz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
}

function makeDefaultProfile(): ProjectionZoneProfile {
  return {
    id: uid(), name: "Default", isDefault: true,
    ...DEFAULT_ZONE,
    targetScreenName: null, outputResolution: { width: 1920, height: 1080 },
    createdAt: now(), updatedAt: now(),
  };
}

function readRaw(): Persisted {
  if (typeof window === "undefined") return { profiles: [], activeProfileId: null };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { profiles: [], activeProfileId: null };
    const o = JSON.parse(raw) as Partial<Persisted>;
    const profiles = Array.isArray(o.profiles)
      ? o.profiles.filter((p): p is ProjectionZoneProfile => !!p && typeof p.id === "string" && typeof p.name === "string")
        .map((p) => ({ ...p, ...normalizeZone(p) }))
      : [];
    return { profiles, activeProfileId: typeof o.activeProfileId === "string" ? o.activeProfileId : null };
  } catch { return { profiles: [], activeProfileId: null }; }
}

function writeRaw(state: Persisted) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch { /* quota / private mode — non-fatal */ }
}

/** Non-hook read of the ACTIVE zone — used by the operator console to seed
 *  OutputState before the hook mounts, and anywhere a one-shot read is enough. */
export function readActiveZone(): ProjectionZone {
  const { profiles, activeProfileId } = readRaw();
  if (profiles.length === 0) return DEFAULT_ZONE;
  const active = profiles.find((p) => p.id === activeProfileId)
    ?? profiles.find((p) => p.isDefault)
    ?? profiles[0];
  return normalizeZone(active);
}

export type ProjectionZoneStore = {
  profiles: ProjectionZoneProfile[];
  activeId: string | null;
  activeProfile: ProjectionZoneProfile | null;
  create: (name: string, copyFromActive: boolean) => string;
  update: (id: string, patch: Partial<ProjectionZone> & { name?: string; targetScreenName?: string | null; outputResolution?: { width: number; height: number } | null }) => void;
  remove: (id: string) => void;
  setActive: (id: string) => void;
  setDefault: (id: string) => void;
  rename: (id: string, name: string) => void;
};

export function useProjectionZoneStore(): ProjectionZoneStore {
  const [state, setState] = useState<Persisted>(() => {
    const s = readRaw();
    if (s.profiles.length === 0) {
      const def = makeDefaultProfile();
      const seeded = { profiles: [def], activeProfileId: def.id };
      writeRaw(seeded);
      return seeded;
    }
    if (!s.activeProfileId || !s.profiles.some((p) => p.id === s.activeProfileId)) {
      s.activeProfileId = (s.profiles.find((p) => p.isDefault) ?? s.profiles[0]).id;
    }
    return s;
  });

  // Re-hydrate on external changes (editor ↔ console, other windows).
  const selfWriteRef = useRef(false);
  useEffect(() => {
    const onChange = () => { if (selfWriteRef.current) { selfWriteRef.current = false; return; } setState(readRaw()); };
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => { window.removeEventListener(CHANGE_EVENT, onChange); window.removeEventListener("storage", onChange); };
  }, []);

  const commit = useCallback((next: Persisted) => {
    selfWriteRef.current = true;
    setState(next);
    writeRaw(next);
  }, []);

  const create = useCallback((name: string, copyFromActive: boolean): string => {
    let newId = "";
    setState((prev) => {
      const base = copyFromActive
        ? (prev.profiles.find((p) => p.id === prev.activeProfileId) ?? prev.profiles[0])
        : undefined;
      const p: ProjectionZoneProfile = {
        id: uid(), name: name.trim() || "New profile", isDefault: prev.profiles.length === 0,
        ...(base ? normalizeZone(base) : DEFAULT_ZONE),
        targetScreenName: base?.targetScreenName ?? null,
        outputResolution: base?.outputResolution ?? { width: 1920, height: 1080 },
        createdAt: now(), updatedAt: now(),
      };
      newId = p.id;
      const next = { profiles: [...prev.profiles, p], activeProfileId: p.id };
      selfWriteRef.current = true; writeRaw(next);
      return next;
    });
    return newId;
  }, []);

  const update = useCallback((id: string, patch: Partial<ProjectionZone> & { name?: string; targetScreenName?: string | null; outputResolution?: { width: number; height: number } | null }) => {
    setState((prev) => {
      const profiles = prev.profiles.map((p) => p.id === id
        ? { ...p, ...normalizeZone({ ...p, ...patch }), name: patch.name ?? p.name,
            targetScreenName: patch.targetScreenName !== undefined ? patch.targetScreenName : p.targetScreenName,
            outputResolution: patch.outputResolution !== undefined ? patch.outputResolution : p.outputResolution,
            updatedAt: now() }
        : p);
      const next = { ...prev, profiles };
      selfWriteRef.current = true; writeRaw(next);
      return next;
    });
  }, []);

  const rename = useCallback((id: string, name: string) => update(id, { name }), [update]);

  const remove = useCallback((id: string) => {
    setState((prev) => {
      if (prev.profiles.length <= 1) return prev; // cannot delete the last one
      const profiles = prev.profiles.filter((p) => p.id !== id);
      if (!profiles.some((p) => p.isDefault)) profiles[0] = { ...profiles[0], isDefault: true };
      const activeProfileId = prev.activeProfileId === id
        ? (profiles.find((p) => p.isDefault) ?? profiles[0]).id
        : prev.activeProfileId;
      const next = { profiles, activeProfileId };
      selfWriteRef.current = true; writeRaw(next);
      return next;
    });
  }, []);

  const setActive = useCallback((id: string) => {
    setState((prev) => { const next = { ...prev, activeProfileId: id }; selfWriteRef.current = true; writeRaw(next); return next; });
  }, []);

  const setDefault = useCallback((id: string) => {
    setState((prev) => {
      const profiles = prev.profiles.map((p) => ({ ...p, isDefault: p.id === id }));
      const next = { ...prev, profiles };
      selfWriteRef.current = true; writeRaw(next);
      return next;
    });
  }, []);

  const activeProfile = state.profiles.find((p) => p.id === state.activeProfileId) ?? null;
  return { profiles: state.profiles, activeId: state.activeProfileId, activeProfile, create, update, remove, setActive, setDefault, rename };
}
